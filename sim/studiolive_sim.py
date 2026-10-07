#!/usr/bin/env python3
"""
studiolive_sim.py - PreSonus StudioLive Series III console simulator.

Pretends to be a "StudioLive 32" on the network so a Universal Control / UC Surface
style client can be tested without hardware.

What it does
  * UDP discovery: broadcasts "DA" announce packets every 3 s (src port 53000 ->
    <broadcast>:47809) and answers "DQ" queries.
  * TCP control on port 53000: UM hello, JM Subscribe -> SubscriptionReply + ZB
    (zlib-compressed UBJSON state tree), PV/PS parameter changes (applied and
    echoed to every subscribed client), FR file requests -> FD, KA keep-alive.
  * UDP metering: "MS"/"levl" frames sent to the port each client announced in UM.
  * Interactive prompt to push changes from the "console" side (type `help`).
  * JSONL packet capture (--log-file) so you can diff what your client sends.

Source of truth for the wire format: featherbear's reverse-engineering notes
(https://featherbear.cc/presonus-studiolive-api/). PreSonus never published this protocol.
Confidence per area:
  HIGH    packet framing, C-bytes mirroring, UM, JM Subscribe, DA discovery, ZB framing
  MEDIUM  PV payload layout (key\\0 + 2 byte part-A + float32 LE), CK chunk layout
  LOW     state-tree schema inside the UBJSON, PS layout, FD layout, MS/levl layout,
          SubscriptionReply contents. Everything LOW is isolated in clearly named
          functions so it is cheap to fix once you compare against a real capture.
          Best fix: --state-file <dump from a real console> to replay a real tree.

Requires Python 3.9+, stdlib only.
"""
from __future__ import annotations

import argparse
import asyncio
import ipaddress
import itertools
import json
import logging
import os
import math
import random
import re
import socket
import struct
import sys
import time
import uuid
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

log = logging.getLogger("slsim")

HEADER = b"UC\x00\x01"
CONTROL_PORT = 53000
DISCOVERY_PORT = 47809
DEFAULT_CBYTES = b"\x68\x00\x65\x00"
MAX_PACKET_PAYLOAD = 0xFFFF
STATE_PAYLOAD_ID = "Synchronize"
SUBSCRIPTION_REPLY = {"id": "SubscriptionReply"}  # LOW confidence: real reply may carry more fields


# --------------------------------------------------------------------------- framing
@dataclass
class Packet:
    ptype: bytes
    cbytes: bytes
    body: bytes


def encode(ptype: bytes, body: bytes = b"", cbytes: bytes = DEFAULT_CBYTES) -> bytes:
    """header(4) + size(2,LE) + type(2) + c-bytes(4) + body.  size = len(type+cbytes+body)."""
    payload = ptype + cbytes + body
    if len(payload) > MAX_PACKET_PAYLOAD:
        raise ValueError(f"packet too large ({len(payload)} bytes)")
    return HEADER + struct.pack("<H", len(payload)) + payload


def reply_cbytes(req: bytes) -> bytes:
    """Request {A,B} -> response {B,A} so the client can match replies."""
    if len(req) == 4:
        return bytes([req[2], 0, req[0], 0])
    return DEFAULT_CBYTES


class PacketParser:
    """Incremental TCP stream parser with resync on garbage."""

    def __init__(self) -> None:
        self.buf = bytearray()

    def feed(self, data: bytes) -> list[Packet]:
        self.buf += data
        out: list[Packet] = []
        while len(self.buf) >= 6:
            if bytes(self.buf[:4]) != HEADER:
                idx = self.buf.find(HEADER, 1)
                if idx < 0:
                    log.warning("stream desync, dropping %d bytes", len(self.buf) - 3)
                    del self.buf[:-3]
                    break
                log.warning("stream desync, skipping %d bytes", idx)
                del self.buf[:idx]
                continue
            size = struct.unpack_from("<H", self.buf, 4)[0]
            if len(self.buf) < 6 + size:
                break
            payload = bytes(self.buf[6:6 + size])
            del self.buf[:6 + size]
            out.append(Packet(payload[:2], payload[2:6], payload[6:]))
        return out


# --------------------------------------------------------------------------- UBJSON
def _ub_int(n: int) -> bytes:
    if -128 <= n <= 127:
        return b"i" + struct.pack(">b", n)
    if -2**31 <= n < 2**31:
        return b"l" + struct.pack(">i", n)
    return b"L" + struct.pack(">q", n)


def ub_encode(v: Any) -> bytes:
    if v is None:
        return b"Z"
    if v is True:
        return b"T"
    if v is False:
        return b"F"
    if isinstance(v, int):
        return _ub_int(v)
    if isinstance(v, float):
        return b"d" + struct.pack(">f", v)
    if isinstance(v, str):
        b = v.encode("utf-8")
        return b"S" + _ub_int(len(b)) + b
    if isinstance(v, dict):
        out = bytearray(b"{")
        for k, val in v.items():
            kb = str(k).encode("utf-8")
            out += _ub_int(len(kb)) + kb + ub_encode(val)
        return bytes(out + b"}")
    if isinstance(v, (list, tuple)):
        return b"[" + b"".join(ub_encode(x) for x in v) + b"]"
    raise TypeError(f"cannot UBJSON-encode {type(v)}")


def _ub_read_int(d: bytes, p: int) -> tuple[int, int]:
    t = d[p:p + 1]
    p += 1
    fmt = {b"i": ">b", b"U": ">B", b"I": ">h", b"l": ">i", b"L": ">q"}.get(t)
    if not fmt:
        raise ValueError(f"expected int marker at {p - 1}, got {t!r}")
    n = struct.calcsize(fmt)
    return struct.unpack_from(fmt, d, p)[0], p + n


def _ub_value(d: bytes, p: int, t: Optional[bytes] = None) -> tuple[Any, int]:
    if t is None:
        t = d[p:p + 1]
        p += 1
    if t in (b"Z", b"N"):
        return None, p
    if t == b"T":
        return True, p
    if t == b"F":
        return False, p
    num = {b"i": ">b", b"U": ">B", b"I": ">h", b"l": ">i", b"L": ">q", b"d": ">f", b"D": ">d"}
    if t in num:
        n = struct.calcsize(num[t])
        return struct.unpack_from(num[t], d, p)[0], p + n
    if t == b"C":
        return d[p:p + 1].decode("latin-1"), p + 1
    if t in (b"S", b"H"):
        n, p = _ub_read_int(d, p)
        return d[p:p + n].decode("utf-8", "replace"), p + n
    if t in (b"[", b"{"):
        is_obj = t == b"{"
        end = b"}" if is_obj else b"]"
        typ = count = None
        if d[p:p + 1] == b"$":
            typ = d[p + 1:p + 2]
            p += 2
        if d[p:p + 1] == b"#":
            count, p = _ub_read_int(d, p + 1)
        res: Any = {} if is_obj else []
        i = 0
        while (i < count) if count is not None else (d[p:p + 1] != end):
            key = None
            if is_obj:
                n, p = _ub_read_int(d, p)
                key = d[p:p + n].decode("utf-8", "replace")
                p += n
            val, p = _ub_value(d, p, typ)
            if is_obj:
                res[key] = val
            else:
                res.append(val)
            i += 1
        if count is None:
            p += 1  # closing bracket
        return res, p
    raise ValueError(f"unsupported UBJSON marker {t!r} at {p - 1}")


def ub_decode(data: bytes) -> Any:
    return _ub_value(data, 0)[0]


def _color_to_wire(v: Any) -> int:
    """Client turns the wire int into hex with writeInt32LE(); inverse: hex bytes -> signed LE int32."""
    try:
        return struct.unpack("<i", bytes.fromhex(v)[:4].ljust(4, b"\0"))[0]
    except (ValueError, TypeError):
        return 0


def _value_to_wire(path: tuple, v: Any) -> Any:
    """
    Invert the client's fromUB value transformers (VERIFIED against the library source):
      booleans   (mute, solo, 48v, link, select, assign_*, ...)  wire int 0/1   (client: 1->true, 0->false, else throws)
      */ch*/volume                                               wire 0..1      (client multiplies by 100)
      **/color                                                   wire int32     (client: writeInt32LE -> hex)
    Returns None for values that cannot be sent (they are left out).
    """
    key = path[-1]
    if isinstance(v, bool):
        return int(v)
    if v is None:
        return 0 if key == "color" else None
    if key == "color" and isinstance(v, str):
        return _color_to_wire(v)
    if len(path) == 3 and path[1].startswith("ch") and key == "volume" and isinstance(v, (int, float)):
        return v / 100.0
    if isinstance(v, str) and len(v.encode("utf-8")) > 127:
        # the client's UBJSON reader only accepts int8 string lengths
        return v.encode("utf-8")[:127].decode("utf-8", "ignore")
    return v


def to_wire(node: dict, path: tuple = ()) -> dict:
    """
    Convert a state node from the client's parsed form (what client.dumpState() writes: leaf values directly under
    "children", metadata as {"value","range","strings"}) into what the console sends in the ZB payload:
        {"children": {name: node}, "values": {name: v}, "strings": {name: [...]}, "ranges": {name: {...}}}
    Order matters: the client needs a key to exist (children/values) before it attaches strings/ranges to it.
    """
    children: dict = {}
    values: dict = {}
    strings: dict = {}
    ranges: dict = {}
    for k, d in (node.get("children") or {}).items():
        p = path + (k,)
        if isinstance(d, dict):
            has_meta = any(x in d for x in ("value", "strings", "range"))
            if d.get("children") or not has_meta:
                children[k] = to_wire(d, p)
            if "value" in d:
                w = _value_to_wire(p, d["value"])
                if w is not None:
                    values[k] = w
            if "strings" in d:
                strings[k] = d["strings"]
            if "range" in d:
                ranges[k] = d["range"]
        else:
            w = _value_to_wire(p, d)
            if w is not None:
                values[k] = w
    out: dict = {}
    for name, part in (("children", children), ("values", values), ("strings", strings), ("ranges", ranges)):
        if part:
            out[name] = part
    return out


_BOOL_LAST = {"mute", "solo", "anysolo", "48v", "link", "select", "keylisten", "expander"}


def pv_to_state(key: str, v: float) -> Any:
    """A PV float arrives raw (0/1 for switches, 0..1 for faders); the state holds the client-parsed form."""
    toks = [t for t in key.replace(".", "/").split("/") if t]
    last = toks[-1] if toks else ""
    if last in _BOOL_LAST or last.startswith("assign_"):
        return v >= 0.5
    if len(toks) == 3 and toks[1].startswith("ch") and last == "volume":
        return v * 100.0
    return v


# --------------------------------------------------------------------------- DCA display
# A DCA is filtergroup/chN. Its members are the 0/1 keys lineM / returnM / fxreturnM (what the client's
# assign_dca() writes: "filtergroup/ch2/line5" = 1.0). The auxN / fxN keys on a DCA are send levels, not members.
DCA_FAMILIES = (("line", "L"), ("return", "R"), ("fxreturn", "FXR"))
DCA_KEY = re.compile(r"filtergroup/ch(\d+)/(line|return|fxreturn)(\d+)$")


def _chan_label(state: "StateTree", family: str, short: str, n: int) -> str:
    for k in ("username", "name"):
        v = state.get(f"{family}/ch{n}/{k}")
        if isinstance(v, str) and v:
            return f"{v} [{short}{n}]"
    return f"[{short}{n}]"


def dca_members(state: "StateTree", dca: int) -> list[str]:
    node = state._walk(["filtergroup", f"ch{dca}"], create=False)
    out: list[tuple[int, int, str]] = []
    for fi, (family, short) in enumerate(DCA_FAMILIES):
        for k in (node or {}).get("children", {}):
            m = re.fullmatch(family + r"(\d+)", k)
            if not m:
                continue
            v = state.get(f"filtergroup/ch{dca}/{k}")
            if isinstance(v, (int, float)) and float(v) >= 0.5:
                n = int(m.group(1))
                # the console reserves up to 64 line slots; only list channels that exist
                if state._walk([family, f"ch{n}"], create=False) is not None:
                    out.append((fi, n, _chan_label(state, family, short, n)))
    return [label for _, _, label in sorted(out)]


def _fader_curve(db: float) -> float:
    """The client library's fit of the console's fader taper (logVolumeToLinear): dB (-84..10) -> 0..100."""
    return 72.5204177782 + 2.473473992 * db + 0.026567557 * db ** 2 + 880866e-10 * db ** 3


def pct_to_db(pct: float) -> Optional[float]:
    """Approximate inverse of the fader taper. None means 'below the usable range' (shown as < -60)."""
    if pct < 1.0:
        return None
    lo, hi = -60.0, 10.0              # the fitted curve is monotonic here (it flattens and dips below -70 dB)
    for _ in range(50):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if _fader_curve(mid) < pct else (lo, mid)
    return (lo + hi) / 2


def chan_level(state: "StateTree", group: str, n: int) -> Optional[float]:
    """Fader position in percent (0-100), as the client parses it, or None if the channel has none."""
    v = state.get(f"{group}/ch{n}/volume")
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def dca_level(state: "StateTree", dca: int) -> Optional[float]:
    return chan_level(state, "filtergroup", dca)


def _render_table(header: tuple, rows: list, right: set = frozenset()) -> tuple[str, str, list[str]]: # type: ignore
    """Plain-text table: returns (header line, rule line, row lines). Columns in `right` are right-aligned."""
    widths = [max([len(h)] + [len(r[i]) for r in rows]) for i, h in enumerate(header)]

    def fmt(cells: tuple) -> str:
        return "  ".join(c.rjust(widths[i]) if i in right else c.ljust(widths[i]) for i, c in enumerate(cells)).rstrip()

    return fmt(header), "  ".join("-" * w for w in widths), [fmt(r) for r in rows]


def _level_cells(pct: Optional[float]) -> tuple[str, str]:
    if pct is None:
        return "-", "-"
    db = pct_to_db(pct)
    return f"{pct:.1f}%", ("< -60" if db is None else f"{db:+.1f}")


def dca_row(state: "StateTree", n: int) -> tuple[str, str, str, str, str, str]:
    members = dca_members(state, n)
    level, db = _level_cells(dca_level(state, n))
    name = state.get(f"filtergroup/ch{n}/name") or f"DCA {n}"
    return (str(n), str(name), level, db, str(len(members)), ", ".join(members) if members else "-")


# TheatreMix colours a DCA label by what happens to it in the NEXT cue (theatremix.com/features#dcaColours).
# The console has no cues, so only two states come from the console itself: grey = no channels (placeholder) and
# inverted = 2+ channels (ensemble DCA). The cue-based ones are set by hand with the `tag` command.
DCA_TAGS = {
    "white": "DCA assignment changes next",
    "green": "exact same channels/positions/profiles next",
    "cyan": "same channels, position changes next",
    "orange": "same channels, FX changes next",
    "yellow": "same channels, profile changes next",
    "magenta": "channels move in/out of ensemble DCAs next",
    "cut": "DCA has been cut (strikethrough)",
    "skip": "cue will be skipped (purple)",
}
_ANSI = {"white": "97", "green": "32", "cyan": "36", "orange": "38;5;208", "yellow": "33", "magenta": "35",
         "skip": "38;5;129", "grey": "90"}   # orange/purple use the 256-colour palette (Terminal.app has no truecolor)


def _style_row(text: str, members: int, tag: Optional[str]) -> str:
    codes = []
    if members >= 2:
        codes.append("7")                                    # inverted: ensemble DCA
    if tag == "cut":
        codes.append("9")                                    # strikethrough
    colour = _ANSI.get(tag) if tag else ("90" if members == 0 else None)   # grey placeholder unless tagged
    if colour:
        codes.append(colour)
    return f"\x1b[{';'.join(codes)}m{text}\x1b[0m" if codes else text


DCA_TABLE_ROWS = 8
_DCA_HEADER = ("DCA", "Name", "Level", "~dB", "Ch", "Channels")
_DCA_RIGHT = {2, 3, 4}               # right-align Level, ~dB, Ch


def format_dca(state: "StateTree", only: Optional[int] = None, show_all: bool = False,
               color: bool = False, tags: Optional[dict] = None) -> str:
    """Table of the first 8 DCAs (all of them with show_all, or just `only`): level and assigned channels.
    With color=True each row is styled the TheatreMix way (see DCA_TAGS); `tags` maps DCA number -> status."""
    fg = state._walk(["filtergroup"], create=False)
    if not fg:
        return "no DCAs (filtergroup) in the state tree"
    nums = sorted(int(m.group(1)) for k in fg.get("children", {}) if (m := re.fullmatch(r"ch(\d+)", k)))
    if not nums:
        return "no DCAs"
    if only is not None:
        if only not in nums:
            return f"DCA {only} does not exist (this console has DCAs {nums[0]}-{nums[-1]})"
        nums = [only]
    elif not show_all:
        nums = nums[:DCA_TABLE_ROWS]
    rows = [dca_row(state, n) for n in nums]
    head, rule, lines = _render_table(_DCA_HEADER, rows, _DCA_RIGHT)
    body = [_style_row(text, int(r[4]), (tags or {}).get(int(r[0]))) if color else text for text, r in zip(lines, rows)]
    return "\n".join([head, rule] + body)


# --------------------------------------------------------------------------- line channel table
_LINE_HEADER = ("Ch", "Name", "Level", "~dB")


def format_lines(state: "StateTree") -> str:
    """Every line channel: its name (username, else the default label) and fader level."""
    node = state._walk(["line"], create=False)
    nums = sorted(int(m.group(1)) for k in (node or {}).get("children", {}) if (m := re.fullmatch(r"ch(\d+)", k)))
    if not nums:
        return "no line channels in the state tree"
    rows = []
    for n in nums:
        name = state.get(f"line/ch{n}/username") or state.get(f"line/ch{n}/name") or f"Ch {n}"
        level, db = _level_cells(chan_level(state, "line", n))
        rows.append((str(n), str(name), level, db))
    head, rule, lines = _render_table(_LINE_HEADER, rows, {0, 2, 3})
    return "\n".join([head, rule] + lines)


def format_legend(color: bool = False) -> str:
    def paint(label: str, codes: str) -> str:
        label = label.ljust(8)
        return f"\x1b[{codes}m{label}\x1b[0m" if color and codes else label

    rows = [f"{paint(tag, '9' if tag == 'cut' else _ANSI.get(tag, ''))} {meaning}" for tag, meaning in DCA_TAGS.items()]
    rows.append(f"{paint('grey', _ANSI['grey'])} no channels assigned (automatic)")
    rows.append(f"{paint('inverted', '7')} 2+ channels assigned: ensemble DCA (automatic)")
    return "\n".join(rows)


# --------------------------------------------------------------------------- state tree
class StateTree:
    """
    Parameter tree in the client's PARSED form, i.e. exactly what client.dumpState()["internal"] contains:
        node = {"children": {name: scalar | node, ...}}
        node (leaf with metadata) = {"value": v, "range": {...}, "strings": [...]}
    This is NOT the wire format (see to_wire). PV keys are slash separated: "line/ch1/mute".
    """

    def __init__(self, root: Optional[dict] = None) -> None:
        self.root: dict = root if root is not None else {"children": {}}

    def _walk(self, parts: list[str], create: bool) -> Optional[dict]:
        node = self.root
        for p in parts:
            kids = node.get("children")
            if not isinstance(kids, dict):
                if not create:
                    return None
                kids = node["children"] = {}
            nxt = kids.get(p)
            if not isinstance(nxt, dict):
                if not create:
                    return None
                nxt = kids[p] = {}
            node = nxt
        return node

    @staticmethod
    def _split(key: str) -> list[str]:
        return [p for p in key.replace(".", "/").split("/") if p]

    def set(self, key: str, value: Any) -> None:
        parts = self._split(key)
        node = self._walk(parts[:-1], create=True)
        assert node is not None
        if not isinstance(node.get("children"), dict):
            node["children"] = {}
        cur = node["children"].get(parts[-1])
        if isinstance(cur, dict) and any(x in cur for x in ("value", "range", "strings")):
            cur["value"] = value  # keep the range/strings metadata
        else:
            node["children"][parts[-1]] = value

    def get(self, key: str, default: Any = None) -> Any:
        parts = self._split(key)
        node = self._walk(parts[:-1], create=False)
        if node is None:
            return default
        cur = node.get("children", {}).get(parts[-1], default)
        if isinstance(cur, dict) and "value" in cur:
            return cur["value"]
        return cur

    def count(self) -> int:
        def rec(n: dict) -> int:
            total = 0
            for v in n.get("children", {}).values():
                total += (rec(v) + (1 if "value" in v else 0)) if isinstance(v, dict) else 1
            return total
        return rec(self.root)


# Group names/counts taken from a real StudioLive 32 state dump
CHANNEL_LAYOUT = {"line": 32, "return": 3, "talkback": 1, "aux": 16, "sub": 4, "fxbus": 4, "fxreturn": 4,
                  "main": 1, "fx": 4}
UNITY_VOLUME = 0.73  # ~0 dB on the linear 0..1 fader scale


def build_synthetic_state(model: str, serial: str, name: str) -> StateTree:
    """A small stand-in tree (parsed form). Prefer --state-file with a real client.dumpState() dump."""
    st = StateTree()
    st.set("global/mixer_name", model)
    st.set("global/devicename", name)
    st.set("global/mixer_serial", serial)
    st.set("global/mixer_version", "3.3.0.109659")
    for group, n in CHANNEL_LAYOUT.items():
        for i in range(1, n + 1):
            base = f"{group}/ch{i}"
            st.set(f"{base}/chnum", str(i))
            st.set(f"{base}/name", f"Ch. {i}")
            st.set(f"{base}/username", f"{group.title()} {i}")
            st.set(f"{base}/color", "ffffffff")
            st.set(f"{base}/volume", UNITY_VOLUME * 100 if group != "line" else 50.0)  # percent, like the client
            st.set(f"{base}/pan", 0.5)
            st.set(f"{base}/mute", False)
            if group not in ("main", "talkback"):
                st.set(f"{base}/solo", False)
            if group in ("line", "return", "fxreturn"):
                st.set(f"{base}/link", False)
            if group == "line":
                st.set(f"{base}/48v", False)
                st.set(f"{base}/preampgain", 0.3)
                for a_ in range(1, CHANNEL_LAYOUT["aux"] + 1):
                    st.set(f"{base}/aux{a_}", 0.0)
                    st.set(f"{base}/assign_aux{a_}", True)
    return st


def load_state_dump(path: Path) -> StateTree:
    """
    Load a state tree written by the client library's dumpState() (JSON: {"internal": {...}, "cache": {...}}),
    or just the "internal" object. Raw wire dumps (UBJSON/zlib) are not supported: the wire format differs from the
    parsed form this simulator stores.
    """
    try:
        root = json.loads(path.read_bytes().decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise ValueError(f"{path}: not JSON ({e}). Write it with JSON.stringify(client.dumpState())") from e
    if isinstance(root, dict) and "children" not in root and isinstance(root.get("internal"), dict):
        log.info("state file: using the 'internal' subtree")
        root = root["internal"]
    if not isinstance(root, dict) or "children" not in root:
        raise ValueError(f"state dump has no top-level 'children' (keys: {list(root)[:10] if isinstance(root, dict) else type(root)})")
    return StateTree(root)


# --------------------------------------------------------------------------- payload builders
def json_body(obj: Any) -> bytes:
    s = json.dumps(obj, separators=(",", ":")).encode()
    return struct.pack("<I", len(s)) + s


def build_discovery_packet(model: str, serial: str, name: str, guid: bytes, port: int = CONTROL_PORT) -> bytes:
    """'DA' announce. Not standard framing: bytes 4-5 are the console's source port."""
    return (HEADER + struct.pack("<H", port) + b"DA" + b"\x65\x00\x00\x00" + b"\x00\x04\x00\x80" + guid
            + model.encode() + b"\0" + b"AUD\0" + serial.encode() + b"\0" + name.encode() + b"\0")


def build_pv(key: str, value: float) -> bytes:
    return key.encode() + b"\0" + b"\x00\x00" + struct.pack("<f", value)


def build_ps(key: str, value: str) -> bytes:  # LOW confidence layout
    return key.encode() + b"\0" + b"\x00\x00" + value.encode() + b"\0"


def build_fd(req_id: bytes, offset: int, total: int, chunk: bytes) -> bytes:
    """Layout from the client's parseChunk(): id(2, as sent) | bytesRead u16 | 2 skip | totalSize u16 | 4 skip | size u16."""
    return req_id + struct.pack("<H2xH4xH", offset, total, len(chunk)) + chunk


def build_ck(offset: int, total: int, chunk: bytes) -> bytes:
    """Layout from the client's handleCKPacket(): 4 skipped bytes | offset u32 | total u32 | size u32 | data.
    The data of all chunks together is the raw zlib stream (no 4-byte size prefix)."""
    return struct.pack("<2sHIII", b"ZB", 0, offset, total, len(chunk)) + chunk


# (group number, value count). The frame layout is verified against the client's parseDataFrame; what each group
# number *means* is NOT known. Numbering/counts mirror the fader-position groups (0 line, 1 return, 2 fxreturn, 3 talkback,
# 4 aux, 5 fx, 6 sub, 7 main, 8 mono); the rest are filler so a consumer indexing any group 0-15 finds something.
METER_GROUPS = [(0, 32), (1, 3), (2, 4), (3, 1), (4, 16), (5, 4), (6, 4), (7, 1), (8, 1)] + [(g, 2) for g in range(9, 16)]


def build_meter_body(t: float) -> bytes:
    """
    'levl' meter frame, as parsed by the client:
      "levl" | 2 unknown | u16 valueCount | valueCount x u16 LE | u8 groupCount |
      groupCount x (int16 BE group, int16 LE offset, int16 LE count)
    The client requires: total packet length == 21 + valueCount*2 + groupCount*6.
    """
    values: list[int] = []
    desc = b""
    for group, n in METER_GROUPS:
        desc += struct.pack(">h", group) + struct.pack("<hh", len(values), n)
        for i in range(n):
            level = 0.45 + 0.4 * math.sin(t * (0.7 + i * 0.13) + i) + random.uniform(-0.05, 0.05)
            values.append(int(max(0.0, min(1.0, level)) * 65535))
    return (b"levl" + struct.pack("<HH", 0, len(values)) + struct.pack(f"<{len(values)}H", *values)
            + bytes([len(METER_GROUPS)]) + desc)


# --------------------------------------------------------------------------- packet capture
class PacketLog:
    def __init__(self, path: Optional[str]) -> None:
        self.f = open(path, "a", encoding="utf-8") if path else None

    def write(self, direction: str, peer: Any, p: Packet) -> None:
        if self.f:
            self.f.write(json.dumps({
                "ts": time.time(), "dir": direction, "peer": f"{peer[0]}:{peer[1]}" if peer else None,
                "type": p.ptype.decode("latin-1"), "cbytes": p.cbytes.hex(), "body": p.body.hex(),
            }) + "\n")
            self.f.flush()
        if log.isEnabledFor(logging.DEBUG):
            log.debug("%s %s %s cb=%s len=%d %s", direction, peer, p.ptype.decode("latin-1"),
                      p.cbytes.hex(), len(p.body), p.body[:48].hex() + ("..." if len(p.body) > 48 else ""))


# --------------------------------------------------------------------------- session
class Session:
    _ids = itertools.count(1)

    def __init__(self, sim: "Simulator", reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self.sim, self.reader, self.writer = sim, reader, writer
        self.id = next(Session._ids)
        self.peer = writer.get_extra_info("peername")
        self.parser = PacketParser()
        self.lock = asyncio.Lock()
        self.meter_port: Optional[int] = None
        self.subscribed = False
        self.client: dict = {}

    def __str__(self) -> str:
        return f"#{self.id} {self.peer[0]}:{self.peer[1]} ({self.client.get('clientDescription', '?')})"

    async def send(self, ptype: bytes, body: bytes = b"", cbytes: bytes = DEFAULT_CBYTES) -> None:
        async with self.lock:
            if self.sim.args.latency_ms:
                await asyncio.sleep(self.sim.args.latency_ms / 1000)
            try:
                self.writer.write(encode(ptype, body, cbytes))
                await self.writer.drain()
            except ConnectionError:
                return
            self.sim.plog.write("tx", self.peer, Packet(ptype, cbytes, body))

    async def run(self) -> None:
        log.info("client connected: %s", self)
        try:
            while True:
                data = await self.reader.read(65536)
                if not data:
                    break
                for pkt in self.parser.feed(data):
                    self.sim.plog.write("rx", self.peer, pkt)
                    await self.handle(pkt)
        except (ConnectionError, asyncio.CancelledError):
            pass
        finally:
            self.writer.close()
            log.info("client disconnected: %s", self)

    async def handle(self, p: Packet) -> None:
        cb = reply_cbytes(p.cbytes)
        t = p.ptype
        if t == b"UM":
            if len(p.body) >= 2:
                self.meter_port = struct.unpack_from("<H", p.body)[0]
                log.info("%s hello, meter UDP port %d", self, self.meter_port)
        elif t == b"JM":
            await self.on_json(p, cb)
        elif t == b"KA":
            # a real console does not answer KA (captures show none), and the client library logs "Unhandled message
            # code KA" if it gets one. Its keep-alive is the FR/FD exchange below.
            if self.sim.args.ka_reply:
                await self.send(b"KA", b"", cb)
        elif t == b"PV":
            key, _, rest = p.body.partition(b"\0")
            key_s = key.decode("latin-1")
            if rest[:2] == b"\0\0" and len(rest) >= 6:
                val = struct.unpack("<f", rest[2:6])[0]
                before = self.sim.state.get(key_s)
                self.sim.state.set(key_s, pv_to_state(key_s, val))
                log.info("%s PV %s = %g", self, key_s, val)
                self.sim.note_dca(key_s, str(self), before)
            else:
                log.info("%s PV %s (no scalar, part-A=%s)", self, key_s, rest[:2].hex())
            self.sim.broadcast(b"PV", p.body, exclude=self if self.sim.args.no_echo_sender else None,
                               sender=self, sender_cb=cb)
        elif t == b"PS":
            key, _, rest = p.body.partition(b"\0")
            text = rest[2:].split(b"\0")[0].decode("utf-8", "replace")
            self.sim.state.set(key.decode("latin-1"), text)
            log.info("%s PS %s = %r", self, key.decode("latin-1"), text)
            self.sim.broadcast(b"PS", p.body, exclude=self if self.sim.args.no_echo_sender else None,
                               sender=self, sender_cb=cb)
        elif t == b"PC":
            key, _, rest = p.body.partition(b"\0")
            self.sim.state.set(key.decode("latin-1"), rest[2:].hex())
            log.info("%s PC %s = %s", self, key.decode("latin-1"), rest[2:].hex())
            self.sim.broadcast(b"PC", p.body, exclude=self if self.sim.args.no_echo_sender else None,
                               sender=self, sender_cb=cb)
        elif t == b"FR":
            await self.on_file_request(p, cb)
        else:
            log.warning("%s unhandled packet %r body=%s", self, t, p.body[:64].hex())

    async def on_json(self, p: Packet, cb: bytes) -> None:
        if len(p.body) < 4:
            log.warning("%s short JM", self)
            return
        n = struct.unpack_from("<I", p.body)[0]
        try:
            msg = json.loads(p.body[4:4 + n])
        except json.JSONDecodeError as e:
            log.warning("%s bad JSON: %s", self, e)
            return
        if msg.get("id") == "Subscribe":
            self.client = msg
            self.subscribed = True
            log.info("%s Subscribe %s", self, {k: v for k, v in msg.items() if k != "id"})
            await self.send(b"JM", json_body(SUBSCRIPTION_REPLY), cb)
            await self.send_state(cb)
        elif msg.get("id") == "Unsubscribe":
            log.info("%s Unsubscribe", self)
            self.subscribed = False
        else:
            log.warning("%s unhandled JM id=%r: %s", self, msg.get("id"), msg)

    async def send_state(self, cb: bytes) -> None:
        payload = {"id": STATE_PAYLOAD_ID, **to_wire(self.sim.state.root)}
        comp = zlib.compress(ub_encode(payload))
        body = struct.pack("<I", len(comp)) + comp
        if not self.sim.args.force_chunks and len(body) + 6 <= MAX_PACKET_PAYLOAD:
            await self.send(b"ZB", body, cb)
            return
        step = self.sim.args.chunk_size
        for off in range(0, len(comp), step):
            await self.send(b"CK", build_ck(off, len(comp), comp[off:off + step]), cb)

    async def on_file_request(self, p: Packet, cb: bytes) -> None:
        req_id = p.body[:2].ljust(2, b"\0")
        path = p.body[2:].split(b"\0")[0].decode("utf-8", "replace")
        data = self.sim.read_file(path)
        if len(data) > 0xFFFF:
            log.warning("%s FR %r: %d bytes exceeds the 64 KB the FD header can describe; truncating", self, path, len(data))
            data = data[:0xFFFF]
        log.debug("%s FR %r -> %d bytes", self, path, len(data))
        step = 8192
        if not data:
            await self.send(b"FD", build_fd(req_id, 0, 0, b""), cb)
        for off in range(0, len(data), step):
            await self.send(b"FD", build_fd(req_id, off, len(data), data[off:off + step]), cb)


# --------------------------------------------------------------------------- simulator
def make_udp_socket(ip: str, port: int, broadcast: bool = False, reuse_port: bool = False) -> socket.socket:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    if reuse_port and hasattr(socket, "SO_REUSEPORT"):
        try:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
        except OSError:
            pass
    if broadcast:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    s.setblocking(False)
    s.bind((ip, port))
    return s


class _DQListener(asyncio.DatagramProtocol):
    def __init__(self, sim: "Simulator") -> None:
        self.sim = sim

    def datagram_received(self, data: bytes, addr: Any) -> None:
        ptype = data[6:8] if data[:4] == HEADER else b"??"
        if ptype == b"DA":
            return  # our own broadcast looping back, or another console
        if ptype in (b"DQ", b"NO"):
            # "NO" observed from a current Universal Control (hex 5543000100004e4f00000000); assumed to be a
            # discovery probe like "DQ". Answer by broadcast, to its listening port, and back to its source port.
            log.info("discovery probe %r from %s:%d -> answering", ptype, *addr)
            self.sim.announce(extra_targets=[(addr[0], self.sim.args.discovery_port), (addr[0], addr[1])])
        else:
            # Diagnostic: if a client is on the network this shows what it actually sends.
            log.info("unexpected datagram on discovery port from %s:%d type=%r hex=%s",
                     addr[0], addr[1], ptype, data[:64].hex())


class Simulator:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.sessions: set[Session] = set()
        self.plog = PacketLog(args.log_file)
        if args.state_file:
            self.state = load_state_dump(Path(args.state_file))
        else:
            args.model = args.model or "StudioLive 32"
            args.serial = args.serial or "SL3E21000001"
            args.name = args.name or args.model
            self.state = build_synthetic_state(args.model, args.serial, args.name)
        # identity: explicit flags win, then the loaded state, then defaults
        args.model = args.model or self.state.get("global/mixer_name") or "StudioLive 32"
        args.serial = args.serial or self.state.get("global/mixer_serial") or "SL3E21000001"
        args.name = args.name or self.state.get("global/devicename") or args.model
        self.guid = uuid.uuid5(uuid.NAMESPACE_DNS, args.serial).bytes
        self.tx: Optional[asyncio.DatagramTransport] = None
        self._announced: set = set()
        self.dca_tags: dict[int, str] = {}
        self.broadcast_addr = args.broadcast_addr
        if args.netmask:
            iface = ipaddress.ip_interface(f"{args.bind_ip}/{args.netmask}")
            self.broadcast_addr = str(iface.network.broadcast_address)
        self.server: Optional[asyncio.AbstractServer] = None
        self.tasks: list[asyncio.Task] = []

    # -- helpers
    def read_file(self, path: str) -> bytes:
        if self.args.files_dir:
            root = Path(self.args.files_dir).resolve()
            target = (root / path.strip("/")).resolve()
            if root in target.parents and target.is_file():
                return target.read_bytes()
        if path.startswith("List"):  # e.g. "Listpresets/proj": answer with an empty JSON listing instead of timing out
            return b'{"files":[]}'
        return b""  # also what the client's keep-alive file request gets

    def broadcast(self, ptype: bytes, body: bytes, exclude: Optional[Session] = None,
                  sender: Optional[Session] = None, sender_cb: Optional[bytes] = None) -> None:
        for s in list(self.sessions):
            if s is not exclude and s.subscribed:
                # a real console's echo of a client's PS mirrors the client's C-bytes (seen in a real capture)
                cb = sender_cb if (s is sender and sender_cb) else DEFAULT_CBYTES
                asyncio.ensure_future(s.send(ptype, body, cb))

    def use_color(self, stream: Any) -> bool:
        return (not self.args.no_color) and "NO_COLOR" not in os.environ and bool(getattr(stream, "isatty", lambda: False)())

    def note_dca(self, key: str, who: str = "", before: Any = None) -> None:
        """Log a DCA change: membership (filtergroup/chN/lineM ...) or fader (filtergroup/chN/volume)."""
        by = f" (by {who})" if who else ""
        mv = re.fullmatch(r"filtergroup/ch(\d+)/volume", key)
        if mv:
            n = int(mv.group(1))
            level, db = _level_cells(dca_level(self.state, n))
            log.info("DCA %d level -> %s (~%s dB)%s", n, level, db, by)
            return
        m = DCA_KEY.fullmatch(key)
        if not m:
            return
        dca, family, n = int(m.group(1)), m.group(2), int(m.group(3))
        short = dict(DCA_FAMILIES)[family]
        on = float(self.state.get(key) or 0) >= 0.5
        if isinstance(before, (int, float)) and (float(before) >= 0.5) == on:
            # e.g. the client's assign_dca() re-sends every assigned channel on each call
            log.debug("DCA %d %s re-sent, unchanged", dca, _chan_label(self.state, family, short, n))
            return
        log.info("DCA %d %s %s%s", dca, "+ added" if on else "- removed", _chan_label(self.state, family, short, n), by)
        num, name, level, db, count, members = dca_row(self.state, dca)
        log.info("  now: DCA %s %r  level %s (~%s dB)  %s ch: %s", num, name, level, db, count, members)

    def push_pv(self, key: str, value: float) -> None:
        before = self.state.get(key)
        self.state.set(key, pv_to_state(key, value))
        self.note_dca(key, "console", before)
        self.broadcast(b"PV", build_pv(key, value))

    def push_ps(self, key: str, value: str) -> None:
        self.state.set(key, value)
        self.broadcast(b"PS", build_ps(key, value))

    def announce(self, extra_targets: Optional[list] = None) -> None:
        if not self.tx:
            return
        pkt = build_discovery_packet(self.args.model, self.args.serial, self.args.name, self.guid, self.args.port)
        port = self.args.discovery_port
        targets = [(self.broadcast_addr, port)] + [(ip, port) for ip in self.args.announce_to]
        for t in extra_targets or []:
            if t not in targets:
                targets.append(t)
        for t in targets:
            try:
                self.tx.sendto(pkt, t)
                if t not in self._announced:
                    self._announced.add(t)
                    log.info("announcing %s (%d bytes) to %s:%d from %s:%d", self.args.name, len(pkt),
                             *t, *self.tx.get_extra_info("sockname")[:2])
            except OSError as e:
                log.warning("announce to %s failed: %s", t, e)

    # -- lifecycle
    async def start(self) -> None:
        a = self.args
        loop = asyncio.get_running_loop()
        self.server = await asyncio.start_server(self._on_client, a.bind_ip, a.port)
        try:
            sock = make_udp_socket(a.bind_ip, a.port, broadcast=True)
        except OSError as e:
            log.warning("could not bind UDP source port %d (%s); using an ephemeral port", a.port, e)
            sock = make_udp_socket(a.bind_ip, 0, broadcast=True)
        self.tx, _ = await loop.create_datagram_endpoint(asyncio.DatagramProtocol, sock=sock)
        if not a.no_discovery:
            if not a.no_dq_listener:
                try:
                    rx = make_udp_socket("0.0.0.0", a.discovery_port, reuse_port=True)
                    await loop.create_datagram_endpoint(lambda: _DQListener(self), sock=rx)
                except OSError as e:
                    log.warning("not listening for discovery queries on %d: %s", a.discovery_port, e)
            self.tasks.append(asyncio.create_task(self._announce_loop()))
        if a.meter_hz > 0:
            self.tasks.append(asyncio.create_task(self._meter_loop()))
        if a.bind_ip == "0.0.0.0" and not a.announce_to and not a.no_discovery:
            log.warning("bound to 0.0.0.0: the broadcast leaves via the OS default route, which is often the "
                        "wrong NIC (esp. Windows/VPN/Docker). Use --bind-ip <LAN ip> [--netmask 255.255.255.0] "
                        "and/or --announce-to <ip of the machine running Universal Control>.")
        dca_text = format_dca(self.state, color=self.use_color(sys.stderr), tags=self.dca_tags)
        if not dca_text.startswith("no DCA"):
            log.info("DCA assignments:\n  %s", dca_text.replace("\n", "\n  "))
        line_text = format_lines(self.state)
        if not line_text.startswith("no line"):
            log.info("Line channels:\n  %s", line_text.replace("\n", "\n  "))
        log.info("%s %r serial=%s listening on %s:%d (%d parameters)",
                 a.model, a.name, a.serial, a.bind_ip, a.port, self.state.count())

    async def stop(self) -> None:
        for t in self.tasks:
            t.cancel()
        for s in list(self.sessions):
            s.writer.close()
        if self.server:
            self.server.close()
        if self.tx:
            self.tx.close()

    async def _on_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        s = Session(self, reader, writer)
        self.sessions.add(s)
        try:
            await s.run()
        finally:
            self.sessions.discard(s)

    async def _announce_loop(self) -> None:
        while True:
            self.announce()
            await asyncio.sleep(self.args.announce_interval)

    async def _meter_loop(self) -> None:
        t0 = time.monotonic()
        period = 1.0 / self.args.meter_hz
        while True:
            await asyncio.sleep(period)
            targets = [(s.peer[0], s.meter_port) for s in self.sessions if s.meter_port]
            if not targets or not self.tx:
                continue
            pkt = encode(b"MS", build_meter_body(time.monotonic() - t0))
            for tgt in targets:
                self.tx.sendto(pkt, tgt)


# --------------------------------------------------------------------------- interactive prompt
HELP = """commands:
  set <key> <float>     push a parameter change, e.g.  set line/ch1/mute 1
  name <key> <text>     push a string change,           e.g.  name line/ch1/username Kick
  get <key>             read a value from the state tree
  dca [n|all]           DCA table: first 8 DCAs with level and channels (n = just DCA n; all = every DCA)
  tag <n|all> <status>  set a DCA's next-cue colour (the console has no cues): white green cyan orange yellow
                        magenta cut skip, or clear.  `tag clear` resets all
  legend                what the DCA colours mean
  lines                 table of every line channel's name and level
  clients               list connected clients
  kick [id]             disconnect one client (or all)
  quit"""


async def repl(sim: Simulator) -> None:
    loop = asyncio.get_running_loop()
    print(HELP)
    while True:
        line = await loop.run_in_executor(None, sys.stdin.readline)
        if not line:
            return  # stdin closed: keep serving
        parts = line.strip().split(None, 2)
        if not parts:
            continue
        cmd = parts[0].lower()
        try:
            if cmd == "set" and len(parts) == 3:
                sim.push_pv(parts[1], float(parts[2]))
            elif cmd == "name" and len(parts) == 3:
                sim.push_ps(parts[1], parts[2])
            elif cmd == "get" and len(parts) >= 2:
                print(sim.state.get(parts[1]))
            elif cmd == "dca":
                arg = parts[1].lower() if len(parts) > 1 else ""
                if arg.isdigit():
                    print(format_dca(sim.state, only=int(arg), color=sim.use_color(sys.stdout), tags=sim.dca_tags))
                else:
                    print(format_dca(sim.state, show_all=(arg == "all"), color=sim.use_color(sys.stdout),
                                     tags=sim.dca_tags))
            elif cmd == "lines":
                print(format_lines(sim.state))
            elif cmd == "legend":
                print(format_legend(sim.use_color(sys.stdout)))
            elif cmd == "tag" and len(parts) >= 2:
                target, status = parts[1].lower(), (parts[2].lower() if len(parts) > 2 else "")
                if target == "clear" and not status:
                    sim.dca_tags.clear()
                else:
                    if status != "clear" and status not in DCA_TAGS:
                        raise ValueError(f"status must be one of: {', '.join(DCA_TAGS)}, clear")
                    fg = sim.state._walk(["filtergroup"], create=False) or {}
                    avail = sorted(int(k[2:]) for k in fg.get("children", {}) if re.fullmatch(r"ch\d+", k))
                    if target == "all":
                        nums = avail
                    elif target.isdigit() and int(target) in avail:
                        nums = [int(target)]
                    else:
                        raise ValueError(f"no such DCA: {target!r} (use 1-{avail[-1] if avail else 0} or all)")
                    for n in nums:
                        if status == "clear":
                            sim.dca_tags.pop(n, None)
                        else:
                            sim.dca_tags[n] = status
                print(format_dca(sim.state, color=sim.use_color(sys.stdout), tags=sim.dca_tags))
            elif cmd == "clients":
                for s in sim.sessions:
                    print(s, "meter port:", s.meter_port)
            elif cmd == "kick":
                for s in list(sim.sessions):
                    if len(parts) < 2 or str(s.id) == parts[1]:
                        s.writer.close()
            elif cmd in ("quit", "exit"):
                raise asyncio.CancelledError
            else:
                print(HELP)
        except ValueError as e:
            print("error:", e)


# --------------------------------------------------------------------------- main
def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="PreSonus StudioLive Series III console simulator")
    ap.add_argument("--model", help="default: from --state-file, else 'StudioLive 32'")
    ap.add_argument("--name", help="friendly name shown in discovery (default: from --state-file)")
    ap.add_argument("--serial", help="default: from --state-file, else a made-up serial")
    ap.add_argument("--bind-ip", default="0.0.0.0", help="interface for TCP + UDP (also selects the broadcast interface)")
    ap.add_argument("--port", type=int, default=CONTROL_PORT)
    ap.add_argument("--discovery-port", type=int, default=DISCOVERY_PORT)
    ap.add_argument("--broadcast-addr", default="255.255.255.255", help="e.g. 192.168.1.255 on multi-homed hosts")
    ap.add_argument("--netmask", help="with --bind-ip: derive the subnet broadcast address (e.g. 255.255.255.0)")
    ap.add_argument("--announce-to", action="append", default=[], metavar="IP",
                    help="also unicast the announce to this IP (repeatable) - bypasses broadcast problems")
    ap.add_argument("--announce-interval", type=float, default=3.0)
    ap.add_argument("--no-discovery", action="store_true")
    ap.add_argument("--no-dq-listener", action="store_true",
                    help="announce only; don't bind UDP 47809 (use when a client runs on this same machine)")
    ap.add_argument("--meter-hz", type=float, default=0.0,
                    help="UDP meter frames per second (default 0 = off; the frame format is still a guess "
                         "and real clients reject it)")
    ap.add_argument("--latency-ms", type=float, default=0.0, help="delay every outgoing TCP packet")
    ap.add_argument("--no-color", action="store_true", help="plain DCA table (also automatic when not a terminal or NO_COLOR is set)")
    ap.add_argument("--ka-reply", action="store_true",
                    help="answer KA packets with a KA (a real console doesn't; the client logs 'Unhandled message code')")
    ap.add_argument("--force-chunks", action="store_true", help="send the state as CK chunks even when it fits one ZB")
    ap.add_argument("--chunk-size", type=int, default=32768, help="bytes of zlib data per CK packet")
    ap.add_argument("--no-echo-sender", action="store_true", help="don't echo PV/PS back to the client that sent it")
    ap.add_argument("--state-file", help="replay a state tree from a real console (UBJSON / zlib / ZB body)")
    ap.add_argument("--files-dir", help="directory served for FR file requests (e.g. presets/channel)")
    ap.add_argument("--log-file", help="append every rx/tx packet as JSONL")
    ap.add_argument("--no-repl", action="store_true")
    ap.add_argument("-v", "--verbose", action="store_true", help="log every packet")
    return ap.parse_args(argv)


async def amain(args: argparse.Namespace) -> None:
    sim = Simulator(args)
    await sim.start()
    try:
        if args.no_repl or not sys.stdin.isatty():
            await asyncio.Event().wait()
        else:
            await repl(sim)
    finally:
        await sim.stop()


def main() -> None:
    args = parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    try:
        asyncio.run(amain(args))
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass


if __name__ == "__main__":
    main()