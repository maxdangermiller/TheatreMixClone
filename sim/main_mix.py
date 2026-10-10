"""
main_mix.py - play the simulator's main mix out of this computer's default audio output.

The tracks playing on line channels (audio_tracks.py) are mixed the way the console builds its
main (LR) mix, live from the simulated console's state:
  - each line's fader, mute, pan and main (LR) assign
  - every DCA it's in: the DCA fader adds its level, a muted DCA mutes it
  - mute groups that are on and include it
  - the main fader and mute
So moving a fader or firing a cue in the app (or in Universal Control) is heard straight away.

Each track is streamed from its file by an ffmpeg decoder, kept in step with the track player's
clock (it follows seek, loop and pause), mixed with audioop and played with ffplay.
Needs ffmpeg + ffplay (brew install ffmpeg), and audioop: built into Python up to 3.12; on 3.13+
`pip install audioop-lts`.
"""
from __future__ import annotations

import math
import shutil
import subprocess
import threading
import time
from typing import Callable, Optional

from audio_tracks import TAPE, target_name

try:
    import audioop
except ImportError:          # Python 3.13+ without audioop-lts
    audioop = None

RATE = 48000
BLOCK = RATE // 50            # 20 ms per mix block
SAMPLE_BYTES = 2              # 16-bit
LEAD = 0.15                   # how far ahead of the player's clock the mix runs (s)
RESYNC = 0.3                  # re-seek the decoders when they're this far off the player's clock (s)


class MainMixOutput:
    """
    player: the TrackPlayer whose tracks are mixed
    gains: () -> ({channel: (left gain, right gain)}, main gain); channels left out are silent
    """

    def __init__(self, player, gains: Callable[[], tuple[dict[int, tuple[float, float]], float]]) -> None:
        self.player = player
        self.gains = gains
        self.thread: Optional[threading.Thread] = None
        self.running = False
        self.volume_db = 0.0          # extra trim on what's sent to the computer (`listen volume`)
        self.error: Optional[str] = None

    # ----------------------------------------------------------------- control
    @staticmethod
    def missing() -> Optional[str]:
        if audioop is None:
            return "needs audioop: built into Python up to 3.12; on 3.13+  pip install audioop-lts"
        for tool in ("ffmpeg", "ffplay"):
            if not shutil.which(tool):
                return f"needs {tool} (brew install ffmpeg)"
        return None

    def start(self) -> str:
        problem = self.missing()
        if problem:
            return f"can't play the main mix: {problem}"
        if self.running:
            return "already playing the main mix out of this computer"
        self.running, self.error = True, None
        self.thread = threading.Thread(target=self._run, name="main-mix", daemon=True)
        self.thread.start()
        return "playing the main mix out of this computer's default audio output"

    def stop(self) -> str:
        self.running = False
        if self.thread:
            self.thread.join(timeout=2)
            self.thread = None
        return "stopped playing the main mix"

    def status(self) -> str:
        if self.error:
            return f"main mix output stopped: {self.error}"
        if not self.running:
            return "main mix output is off (listen on)"
        chans, main = self.gains()
        audible = sorted((ch for ch, (l, r) in chans.items() if (l or r) and ch in self.player.tracks), key=lambda c: (c == TAPE, c))
        trim = f", trim {self.volume_db:+.1f} dB" if self.volume_db else ""
        if main == 0:
            return f"main mix output is on{trim}, but the main fader is down or muted"
        return (f"main mix output is on{trim}; audible: " + (", ".join(target_name(c) for c in audible) or "nothing") +
                "  (line faders, mutes, DCAs, mute groups and the main fader all apply)")

    # ----------------------------------------------------------------- audio thread
    def _run(self) -> None:
        out = subprocess.Popen(
            ["ffplay", "-nodisp", "-loglevel", "error", "-fflags", "nobuffer", "-flags", "low_delay",
             "-probesize", "32", "-analyzeduration", "0",
             "-f", "s16le", "-ar", str(RATE), "-ch_layout", "stereo", "-i", "-"],
            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        decoders: dict[int, subprocess.Popen] = {}
        opened_for: Optional[dict[int, str]] = None   # {channel: file} the decoders were opened for
        decoded_at = 0.0                 # position (s) of the next block the decoders will give
        written_at = time.monotonic()    # wall clock the mix has been written up to
        gains, main, gains_at = {}, 0.0, 0.0
        silence = bytes(BLOCK * SAMPLE_BYTES * 2)

        def close_decoders() -> None:
            for p in decoders.values():
                p.kill()
            for p in decoders.values():
                p.wait()
            decoders.clear()

        def open_decoders(position: float) -> None:
            close_decoders()
            for ch, track in self.player.tracks.items():
                if position >= track.duration:
                    continue
                # Tape In is a stereo input; lines are mono
                decoders[ch] = subprocess.Popen(
                    ["ffmpeg", "-nostdin", "-v", "error", "-ss", f"{position:.3f}", "-i", str(track.path),
                     "-ac", "2" if ch == TAPE else "1", "-ar", str(RATE), "-f", "s16le", "-"],
                    stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)

        try:
            while self.running:
                now = time.monotonic()
                if out.poll() is not None:
                    self.error = "ffplay quit: " + (out.stderr.read().decode(errors="replace").strip() or "no reason given")
                    break

                # Keep the output about LEAD ahead of real time
                if written_at > now + LEAD:
                    time.sleep(0.005)
                    continue
                if written_at < now - 0.5:          # fell behind (or just started): skip ahead
                    written_at = now

                playing = self.player.started_at is not None and bool(self.player.tracks)
                if not playing:
                    if opened_for is not None:
                        close_decoders()
                        opened_for = None
                    out.stdin.write(silence)
                    written_at += BLOCK / RATE
                    continue

                # Follow the player: seek / loop / pause, or tracks added or stopped
                target = self.player.position() + (written_at - now)
                current = {ch: str(t.path) for ch, t in self.player.tracks.items()}
                if current != opened_for or abs(target - decoded_at) > RESYNC:
                    open_decoders(target)
                    opened_for, decoded_at = current, target

                # Console state changes (faders, mutes, cues) are picked up every 50 ms
                if now - gains_at > 0.05:
                    gains, main = self.gains()
                    main *= 10 ** (self.volume_db / 20)
                    gains_at = now

                mix = silence
                for ch, proc in list(decoders.items()):
                    size = BLOCK * SAMPLE_BYTES * (2 if ch == TAPE else 1)
                    data = _read_exactly(proc, size)
                    if len(data) < size:
                        data += bytes(size - len(data))   # track ended
                    left, right = gains.get(ch, (0.0, 0.0))
                    track = self.player.tracks.get(ch)
                    if main and (left or right) and track:
                        # the track's `gain` (like the mic's preamp gain) applies to the mix too
                        g = main * 10 ** (track.gain_db / 20)
                        if ch == TAPE:
                            # stereo: each side keeps its own channel (gains from balance_gains)
                            l_in = audioop.tomono(data, SAMPLE_BYTES, 1, 0)
                            r_in = audioop.tomono(data, SAMPLE_BYTES, 0, 1)
                            stereo = audioop.add(audioop.tostereo(l_in, SAMPLE_BYTES, left * g, 0),
                                                 audioop.tostereo(r_in, SAMPLE_BYTES, 0, right * g), SAMPLE_BYTES)
                        else:
                            stereo = audioop.tostereo(data, SAMPLE_BYTES, left * g, right * g)
                        mix = audioop.add(mix, stereo, SAMPLE_BYTES)
                out.stdin.write(mix)
                decoded_at += BLOCK / RATE
                written_at += BLOCK / RATE
        except (BrokenPipeError, OSError) as e:
            self.error = f"audio output closed ({e})"
        finally:
            self.running = False
            close_decoders()
            try:
                out.stdin.close()
            except OSError:
                pass
            out.kill()
            out.wait()


def _read_exactly(proc: subprocess.Popen, size: int) -> bytes:
    data = b""
    while len(data) < size:
        chunk = proc.stdout.read(size - len(data))
        if not chunk:
            break
        data += chunk
    return data


def pan_gains(pan: float) -> tuple[float, float]:
    """Constant-power pan: 0 = left, 0.5 = center (-3 dB each side), 1 = right"""
    pan = min(1.0, max(0.0, pan))
    return math.cos(pan * math.pi / 2), math.sin(pan * math.pi / 2)


def balance_gains(pan: float) -> tuple[float, float]:
    """Balance for a stereo channel: 0.5 = both sides at unity; turning it one way fades the other side"""
    pan = min(1.0, max(0.0, pan))
    return min(1.0, 2 * (1 - pan)), min(1.0, 2 * pan)
