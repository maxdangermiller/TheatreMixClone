"""
audio_tracks.py - drive the simulator's line channel meters from real recordings.

Each line channel can play an audio file (m4a, wav, mp3, aiff... anything ffmpeg or macOS's
afconvert can read). The file is decoded once into a peak envelope (100 readings a second), and
while it plays the channel's input meters (groups 0 and 4-6) follow it, so the app sees real mic
behavior: pauses between lines, loud peaks, a mic going quiet.

A file with "music" or "tape" in its name plays on Tape In (the console's stereo 2-track
input, return 3) instead of a line, so a show's music feed comes in the way it does live.

Every track runs off one shared clock, so tracks exported from a multitrack recording stay in
sync, and they all loop when the longest one ends. Nothing is played out loud; only the meters
move (the real console's input meters are pre-fader, so mutes and faders don't change them).

Stdlib only: decoding shells out to ffmpeg if it's installed, otherwise afconvert (macOS).
"""
from __future__ import annotations

import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import wave
from array import array
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable, Optional

AUDIO_EXTENSIONS = {".m4a", ".wav", ".aif", ".aiff", ".mp3", ".caf", ".flac", ".aac", ".mp4"}
SAMPLE_RATE = 16000       # decoded mono rate; plenty for peak meters
ENVELOPE_HZ = 100         # peak readings per second of audio
# A recording fault (e.g. the recorder losing sync) can turn a track into full-scale noise. Every
# reading above -6 dBFS for 10 s straight can't be a real mic (even belting, words have gaps), so
# the track is flagged from there
NOISE_LEVEL = 16400
NOISE_SECONDS = 10

# Tracks are keyed by line channel (1-32); Tape In uses this key
TAPE = 0
TAPE_FILE = re.compile(r"(?<![a-z])(music|tape)(?![a-z])", re.IGNORECASE)


def target_name(channel: int) -> str:
    """How a track's destination is shown: "ch 12" or "Tape In" """
    return "Tape In" if channel == TAPE else f"ch {channel}"


def parse_target(text: str) -> int:
    """A channel typed in a command: a number, or "tape" """
    return TAPE if text.lower() == "tape" else int(text)


class Track:
    def __init__(self, channel: int, path: Path, envelope: array, gain_db: float = 0.0) -> None:
        self.channel = channel
        self.path = path
        self.envelope = envelope      # peak per 1/ENVELOPE_HZ s, 0-32768
        self.gain_db = gain_db
        self.noise_from = find_noise(envelope)   # seconds, or None

    def _clean(self) -> array:
        """The envelope before any full-scale noise"""
        return self.envelope[:int(self.noise_from * ENVELOPE_HZ)] if self.noise_from is not None else self.envelope

    @property
    def peak_db(self) -> float:
        """Loudest peak in the recording (before gain, and before any full-scale noise), dBFS"""
        top = max(self._clean(), default=0)
        return to_db(top)

    @property
    def loud_db(self) -> float:
        """How loud its loud passages are (99.9th percentile; ignores the odd click or bump), dBFS"""
        clean = sorted(self._clean())
        return to_db(clean[int(0.999 * (len(clean) - 1))]) if clean else -math.inf

    @property
    def duration(self) -> float:
        return len(self.envelope) / ENVELOPE_HZ

    def peak(self, start: float, end: float) -> float:
        """Peak (0-1, after gain) between two positions in seconds; 0 past the end of the track"""
        a, b = int(start * ENVELOPE_HZ), int(end * ENVELOPE_HZ) + 1
        if a >= len(self.envelope):
            return 0.0
        return max(self.envelope[a:b]) / 32768 * 10 ** (self.gain_db / 20)


def to_db(value: int) -> float:
    return 20 * math.log10(value / 32768) if value else -math.inf


def find_noise(envelope: array) -> Optional[float]:
    """Where a track turns into continuous full-scale noise (see NOISE_LEVEL), in seconds"""
    run, needed = 0, NOISE_SECONDS * ENVELOPE_HZ
    for i, value in enumerate(envelope):
        run = run + 1 if value >= NOISE_LEVEL else 0
        if run >= needed:
            return (i - run + 1) / ENVELOPE_HZ
    return None


def decode_envelope(path: Path) -> array:
    """Decode a file to mono 16-bit samples and reduce it to a peak envelope"""
    if shutil.which("ffmpeg"):
        # -nostdin / DEVNULL: ffmpeg otherwise reads the keyboard and switches the terminal to raw
        # mode (no echo); with several decoding at once it isn't restored and the prompt goes dead
        result = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(path), "-ac", "1",
                                 "-ar", str(SAMPLE_RATE), "-f", "s16le", "-"],
                                stdin=subprocess.DEVNULL, capture_output=True, check=False)
        if result.returncode != 0:
            raise ValueError(f"ffmpeg couldn't read {path.name}: {result.stderr.decode(errors='replace').strip()}")
        raw = result.stdout
    elif shutil.which("afconvert"):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "decoded.wav"
            result = subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI16@{SAMPLE_RATE}", "-c", "1",
                                     str(path), str(out)], stdin=subprocess.DEVNULL, capture_output=True, check=False)
            if result.returncode != 0:
                raise ValueError(f"afconvert couldn't read {path.name}: {result.stderr.decode(errors='replace').strip()}")
            with wave.open(str(out)) as w:
                raw = w.readframes(w.getnframes())
    else:
        raise ValueError("need ffmpeg (brew install ffmpeg) or afconvert (macOS) to decode audio")

    samples = array("h")
    samples.frombytes(raw[: len(raw) - len(raw) % 2])
    if sys.byteorder == "big":
        samples.byteswap()

    window = SAMPLE_RATE // ENVELOPE_HZ
    envelope = array("H")
    for i in range(0, len(samples), window):
        chunk = samples[i:i + window]
        envelope.append(min(32768, max(max(chunk), -min(chunk))))
    return envelope


def channel_for_file(path: Path, line_names: dict[int, str], max_channel: int) -> Optional[int]:
    """
    Which line a file belongs to:
      - "music" or "tape" in the name: Tape In ("18-Music.m4a", "tape.m4a")
      - a number in the name: "12.m4a", "ch12.m4a", "Track 12.m4a", "12 Otis King.m4a"
      - otherwise a line's name: "Otis King.m4a" -> the line named Otis King
    """
    stem = path.stem
    if TAPE_FILE.search(stem):
        return TAPE
    numbers = re.findall(r"\d+", stem)
    if numbers:
        n = int(numbers[0])
        return n if 1 <= n <= max_channel else None
    wanted = stem.strip().lower()
    for ch, name in line_names.items():
        if name and name.strip().lower() == wanted:
            return ch
    return None


class TrackPlayer:
    """Plays tracks on line channels and writes their levels into the meter values"""

    def __init__(self, groups: tuple, channel_count: int, line_names: Callable[[], dict[int, str]],
                 tape_meters: tuple = ()) -> None:
        self.groups = groups
        # Tape In's meters: ((group, left index), (group, right index), ...)
        self.tape_meters = tape_meters
        self.channel_count = channel_count
        self.line_names = line_names
        self.tracks: dict[int, Track] = {}
        self.started_at: Optional[float] = None   # monotonic time the loop last started, None when paused
        self.paused_at = 0.0
        self.last_position = 0.0
        # Part of the recordings that plays (and loops); loop_end None = to the end of the longest
        self.loop_start = 0.0
        self.loop_end: Optional[float] = None

    # ----------------------------------------------------------------- transport
    @property
    def length(self) -> float:
        return max((t.duration for t in self.tracks.values()), default=0.0)

    @property
    def end(self) -> float:
        return min(self.loop_end, self.length) if self.loop_end is not None else self.length

    def position(self) -> float:
        if self.started_at is None:
            return self.paused_at
        region = self.end - self.loop_start
        elapsed = time.monotonic() - self.started_at
        return self.loop_start + (elapsed % region if region > 0 else 0.0)

    def seek(self, seconds: float) -> None:
        seconds = max(self.loop_start, min(seconds, self.end))
        self.last_position = seconds
        if self.started_at is None:
            self.paused_at = seconds
        else:
            self.started_at = time.monotonic() - (seconds - self.loop_start)

    def pause(self) -> None:
        if self.started_at is not None:
            self.paused_at = self.position()
            self.started_at = None

    def resume(self) -> None:
        if self.started_at is None and self.tracks:
            self.started_at = time.monotonic() - (self.paused_at - self.loop_start)

    def skip(self, seconds: float) -> None:
        """Jump forward (or back, negative) from where playback is now, within the loop"""
        if self.tracks:
            self.seek(self.position() + seconds)

    def toggle_pause(self) -> None:
        if self.started_at is None:
            self.resume()
        else:
            self.pause()

    def transport_line(self, width: int = 16) -> str:
        """e.g. "▶ 15:02.4 ━━━━━━━━──────── 25:59.9" (empty when nothing's loaded)"""
        if not self.tracks:
            return ""
        pos, start, end = self.position(), self.loop_start, self.end
        done = 0 if end <= start else round(width * (pos - start) / (end - start))
        done = max(0, min(width, done))
        icon = "⏸" if self.started_at is None else "▶"
        return f"{icon} {format_time(pos)} {'━' * done}{'─' * (width - done)} {format_time(end)}"

    def set_loop(self, start: Optional[float], end: Optional[float]) -> str:
        """Play only start-end (None, None = all of it), from start"""
        self.loop_start = max(0.0, start or 0.0)
        self.loop_end = end
        if self.loop_end is not None and self.loop_end <= self.loop_start:
            self.loop_start, self.loop_end = 0.0, None
            return "the end has to be after the start; playing all of it"
        self.seek(self.loop_start)
        return self.status()

    # ----------------------------------------------------------------- loading
    def find_files(self, target: Path, channel: Optional[int]) -> tuple[list[tuple[int, Path]], list[str]]:
        """[(channel, file)] to load, and notes about files that were skipped"""
        if target.is_file():
            ch = channel if channel is not None else channel_for_file(target, self.line_names(), self.channel_count)
            if ch is None:
                return [], [f"{target.name}: no channel in its name; use  play <file> <channel>"]
            return [(ch, target)], []
        if not target.is_dir():
            return [], [f"no such file or folder: {target}"]

        found, notes, used = [], [], {}
        files = sorted(p for p in target.iterdir() if p.suffix.lower() in AUDIO_EXTENSIONS and not p.name.startswith("."))
        names = self.line_names()
        for f in files:
            ch = channel_for_file(f, names, self.channel_count)
            if ch is None:
                notes.append(f"{f.name}: skipped (no channel number or line name in the file name)")
            elif ch in used:
                notes.append(f"{f.name}: skipped ({target_name(ch)} already has {used[ch].name})")
            else:
                used[ch] = f
                found.append((ch, f))
        if not files:
            notes.append(f"no audio files in {target}")
        return found, notes

    def load(self, target: Path, channel: Optional[int] = None, gain_db: float = 0.0) -> str:
        """Decode and start playing (blocking; run it off the event loop). Returns a report."""
        found, notes = self.find_files(target, channel)
        if not found:
            return "\n".join(notes) or "nothing to play"

        def decode(item):
            ch, f = item
            try:
                return ch, f, decode_envelope(f), None
            except ValueError as e:
                return ch, f, None, str(e)

        t0 = time.monotonic()
        with ThreadPoolExecutor(max_workers=min(8, os.cpu_count() or 4)) as pool:
            results = list(pool.map(decode, found))

        loaded = []
        for ch, f, envelope, error in sorted(results, key=lambda r: (r[0] == TAPE, r[0])):
            if error:
                notes.append(error)
                continue
            track = self.tracks[ch] = Track(ch, f, envelope, gain_db)
            loaded.append(f"  {self._label(ch)} {f.name}  ({format_time(track.duration)}, peak {track.peak_db:.1f} dB)")

        # Start everything together from the top (of the loop, if one is set)
        if loaded:
            self.started_at = time.monotonic()
            self.seek(self.loop_start)
        lines = [f"playing {len(loaded)} track(s), decoded in {time.monotonic() - t0:.1f}s, "
                 f"looping every {format_time(self.end - self.loop_start)}:"] + loaded

        # Tracks that turn into full-scale noise part way through: offer to loop the part before it
        noisy = sorted((t for t in self.tracks.values() if t.noise_from is not None), key=lambda t: t.noise_from)
        if noisy:
            first = noisy[0].noise_from
            chans = ", ".join(target_name(t.channel) for t in sorted(noisy, key=lambda t: t.channel))
            notes.append(f"{len(noisy)} track(s) turn into constant full-scale noise from {format_time(first)} "
                         f"(a recording fault?): {chans}. They'll show as clipping from there; to play only "
                         f"the part before it:  loop 0 {format_time(max(0.0, first - 2))}")

        # Recordings made with lots of headroom barely move the meters; suggest bringing them up so
        # the loud passages land around -6 dBFS, like mics with their gain set properly. Uses the
        # middle track, so one hot track (e.g. a mix) doesn't decide it for all the mics.
        louds = sorted(t.loud_db for t in self.tracks.values() if t.loud_db > -math.inf)
        if louds:
            typical = louds[len(louds) // 2]
            if typical + gain_db < -15:
                notes.append(f"these recordings are quiet (loud passages around {typical:.0f} dB), so the meters will "
                             f"barely move; try  gain all +{round(-6 - typical)}")
        return "\n".join(lines + notes)

    def stop(self, meter_values: dict, channel: Optional[int] = None) -> str:
        chans = [channel] if channel is not None else list(self.tracks)
        for ch in chans:
            if self.tracks.pop(ch, None):
                self._write(meter_values, ch, 0)
        if not self.tracks:
            self.started_at, self.paused_at = None, self.loop_start
        return f"stopped {target_name(channel) if channel is not None else 'all tracks'}"

    def set_gain(self, target: str, gain_db: float) -> str:
        chans = list(self.tracks) if target == "all" else [parse_target(target)]
        for ch in chans:
            if ch not in self.tracks:
                return f"{target_name(ch)} has no track"
            self.tracks[ch].gain_db = gain_db
        return f"gain {gain_db:+.1f} dB on {'all tracks' if target == 'all' else target_name(chans[0])}"

    # ----------------------------------------------------------------- metering
    def update(self, meter_values: dict) -> None:
        """Called before each meter frame: each track's peak since the last frame"""
        if not self.tracks:
            return
        pos = self.position()
        start = self.last_position if self.last_position <= pos else self.loop_start   # wrapped around
        self.last_position = pos
        for ch, track in self.tracks.items():
            peak = track.peak(start, pos) if self.started_at is not None else 0.0
            self._write(meter_values, ch, int(min(1.0, peak) * 65535))

    def _write(self, meter_values: dict, channel: int, value: int) -> None:
        if channel == TAPE:
            for key in self.tape_meters:
                meter_values[key] = value
            return
        for group in self.groups:
            meter_values[(group, channel - 1)] = value

    def _label(self, channel: int) -> str:
        """Fixed-width name for tables, e.g. "ch  1 Otis King" or "Tape In" """
        if channel == TAPE:
            return f"{'Tape In':<19}"
        return f"ch {channel:>2} {self.line_names().get(channel, '')!s:<14}"

    def status(self) -> str:
        if not self.tracks:
            return "no tracks playing.  play <folder>  or  play <file> <channel>"
        state = "paused" if self.started_at is None else "playing"
        loop = (f", looping {format_time(self.loop_start)}-{format_time(self.end)}"
                if self.loop_start or self.loop_end is not None else "")
        lines = [f"{state} at {format_time(self.position())} of {format_time(self.length)}{loop}"]
        for ch in sorted(self.tracks, key=lambda c: (c == TAPE, c)):
            t = self.tracks[ch]
            gain = f"  gain {t.gain_db:+.1f} dB" if t.gain_db else ""
            lines.append(f"  {self._label(ch)} {t.path.name}  ({format_time(t.duration)}){gain}")
        return "\n".join(lines)


def format_time(seconds: float) -> str:
    return f"{int(seconds // 60)}:{seconds % 60:04.1f}"
