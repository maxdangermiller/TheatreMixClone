"""
console_prompt.py - the simulator's command prompt.

Log messages and command output print above the line being typed, and the half-typed command is
redrawn under them, so a busy log doesn't break up what you're typing. Keys are read one at a time,
so Enter works even if something left the terminal in a raw mode (Enter showing as "^M"), and the
terminal's settings are put back on exit (with echo and Enter working, even if they weren't before).

A status (e.g. the playback position) can be shown in front of the prompt and kept up to date,
and keys pressed on an empty line can be handed to a callback (e.g. arrows to skip around).

Keys: Enter runs the command, Backspace, Ctrl-U clears the line, Up / Down go through history,
Ctrl-C quits.
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
import termios
import threading
from typing import Callable, Optional

PROMPT = "> "
CLEAR_LINE = "\r\x1b[2K"


# Keys passed to on_key (only when nothing has been typed on the line)
KEY_NAMES = {"\x1b[D": "left", "\x1b[C": "right", "\x1bOD": "left", "\x1bOC": "right",
             "\x1b[1;2D": "shift-left", "\x1b[1;2C": "shift-right", " ": "space"}
STATUS_REFRESH = 0.25   # seconds between status redraws


class Prompt:
    """
    status: () -> text shown in front of the prompt (redrawn every STATUS_REFRESH), or None
    on_key: (key name) -> bool, for KEY_NAMES keys pressed on an empty line; True = handled
    """

    def __init__(self, fd: int = 0, out=None, status: Optional[Callable[[], str]] = None,
                 on_key: Optional[Callable[[str], bool]] = None) -> None:
        self.fd = fd
        self.out = out or sys.stdout
        self.status = status
        self.on_key = on_key
        self._timer: Optional[asyncio.TimerHandle] = None
        self.buffer = ""
        self.history: list[str] = []
        self.history_pos = 0
        self.lines: asyncio.Queue[str] = asyncio.Queue()
        self.lock = threading.RLock()
        self.saved: Optional[list] = None
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self._escape = ""          # partial escape sequence (arrow keys)
        self._last_cr = False      # swallow the \n of a \r\n pair

    # ----------------------------------------------------------------- terminal
    def start(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop
        self.saved = termios.tcgetattr(self.fd)
        self._set_mode()
        loop.add_reader(self.fd, self._on_input)
        self._draw()
        if self.status:
            self._tick()

    def _tick(self) -> None:
        self._draw()
        self._timer = self.loop.call_later(STATUS_REFRESH, self._tick)

    def stop(self) -> None:
        if self._timer:
            self._timer.cancel()
        if self.loop:
            try:
                self.loop.remove_reader(self.fd)
            except (ValueError, RuntimeError):
                pass
        if self.saved is not None:
            # Put the terminal back, but always usable: if it came to us broken (no echo, Enter
            # showing as "^M"), the shell gets it back working
            self.saved[0] |= termios.ICRNL
            self.saved[3] |= termios.ECHO | termios.ICANON | termios.ISIG
            termios.tcsetattr(self.fd, termios.TCSADRAIN, self.saved)
            self.saved = None
        self.out.write(CLEAR_LINE)
        self.out.flush()

    def _set_mode(self) -> None:
        """Keys one at a time, no terminal echo (the prompt draws them); Ctrl-C still interrupts"""
        attrs = termios.tcgetattr(self.fd)
        attrs[3] &= ~(termios.ECHO | termios.ICANON)
        attrs[3] |= termios.ISIG
        attrs[1] |= termios.OPOST | termios.ONLCR      # "\n" in output starts a new line
        attrs[6][termios.VMIN], attrs[6][termios.VTIME] = 1, 0
        termios.tcsetattr(self.fd, termios.TCSADRAIN, attrs)

    # ----------------------------------------------------------------- output
    def print(self, *args, sep: str = " ") -> None:
        """Print above the prompt (safe from any thread)"""
        text = sep.join(str(a) for a in args)
        with self.lock:
            self.out.write(CLEAR_LINE + text + "\n")      # ONLCR turns "\n" into a new line
            self._draw()

    def _draw(self) -> None:
        with self.lock:
            status = ""
            if self.status:
                try:
                    status = self.status()
                except Exception:
                    status = ""
            self.out.write(CLEAR_LINE + (status + " " if status else "") + PROMPT + self.buffer)
            self.out.flush()

    # ----------------------------------------------------------------- input
    async def readline(self) -> str:
        line = await self.lines.get()
        self._set_mode()   # in case something else changed the terminal meanwhile
        return line

    def _on_input(self) -> None:
        try:
            data = os.read(self.fd, 1024).decode("utf-8", errors="ignore")
        except OSError:
            return
        if not data:
            return
        for ch in data:
            self._key(ch)
        self._draw()

    def _key(self, ch: str) -> None:
        if self._escape:
            self._escape += ch
            seq = self._escape
            # ESC [ ... final byte (arrows, shift-arrows), or ESC O x; anything else ends it
            done = (len(seq) == 2 and ch not in "[O") or (seq[1] == "O" and len(seq) == 3) \
                or (seq[1] == "[" and len(seq) >= 3 and "@" <= ch <= "~") or len(seq) > 8
            if done:
                self._escape = ""
                if seq == "\x1b[A":
                    self._recall(-1)
                elif seq == "\x1b[B":
                    self._recall(1)
                else:
                    self._special(seq)
            return

        if ch == " " and not self.buffer and self._special(ch):
            return

        was_cr, self._last_cr = self._last_cr, ch == "\r"
        if ch == "\x1b":
            self._escape = ch
        elif ch in "\r\n":
            if ch == "\n" and was_cr:
                return
            line, self.buffer = self.buffer, ""
            with self.lock:
                self.out.write(CLEAR_LINE + PROMPT + line + "\n")   # leave the command on screen
            if line.strip() and (not self.history or self.history[-1] != line):
                self.history.append(line)
            self.history_pos = len(self.history)
            self.lines.put_nowait(line)
        elif ch in ("\x7f", "\x08"):
            self.buffer = self.buffer[:-1]
        elif ch == "\x15":                      # Ctrl-U
            self.buffer = ""
        elif ch == "\x04" and not self.buffer:  # Ctrl-D on an empty line: quit
            self.lines.put_nowait("quit")
        elif ch >= " ":
            self.buffer += ch

    def _special(self, seq: str) -> bool:
        """Hand a transport key to on_key when nothing is typed; True if it was used"""
        name = KEY_NAMES.get(seq)
        if name and self.on_key and not self.buffer:
            return bool(self.on_key(name))
        return False

    def _recall(self, step: int) -> None:
        if not self.history:
            return
        self.history_pos = max(0, min(len(self.history), self.history_pos + step))
        self.buffer = self.history[self.history_pos] if self.history_pos < len(self.history) else ""


class PromptLogHandler(logging.Handler):
    """Sends log messages through the prompt so they print above the line being typed"""

    def __init__(self, prompt: Prompt) -> None:
        super().__init__()
        self.prompt = prompt

    def emit(self, record: logging.LogRecord) -> None:
        try:
            self.prompt.print(self.format(record))
        except Exception:
            self.handleError(record)
