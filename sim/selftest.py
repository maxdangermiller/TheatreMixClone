#!/usr/bin/env python3
"""
Smoke test: runs the simulator in-process and drives it with a minimal hand-rolled
client (Hello -> Subscribe -> state -> PV echo -> FR -> meters).

This proves the simulator is internally consistent and matches the documented sample
bytes. It does NOT prove compatibility with real firmware or a real client.
"""
import asyncio
import json
import struct
import zlib

import studiolive_sim as sl

# Discovery sample from the public protocol notes (StudioLive 24R).
DOC_GUID = bytes.fromhex("481c48672360514f924e1e46915051d1")
DOC_DA = (
    bytes.fromhex("5543000108cf4441" "65000000" "00040080")
    + DOC_GUID
    + b"StudioLive 24R\x00AUD\x00RA2E18030226\x00StudioLive 24R\x00"
)


async def read_until(reader, parser, want):
    """Read packets until one whose type is in `want`; return (all_seen, match)."""
    seen = []
    while True:
        data = await asyncio.wait_for(reader.read(65536), 5)
        assert data, "server closed connection"
        for p in parser.feed(data):
            seen.append(p)
            if p.ptype in want:
                return seen, p


async def main() -> None:
    # 1. discovery packet matches documented bytes
    got = sl.build_discovery_packet("StudioLive 24R", "RA2E18030226", "StudioLive 24R", DOC_GUID)
    assert got == DOC_DA, f"discovery mismatch:\n{got.hex()}\n{DOC_DA.hex()}"
    print("ok  discovery packet == documented sample")

    # 2. run the simulator
    args = sl.parse_args(["--port", "53100", "--no-discovery", "--meter-hz", "50", "--no-repl",
                          "--single-zb", "--no-handshake"])  # the minimal protocol this test checks
    sim = sl.Simulator(args)
    await sim.start()
    try:
        reader, writer = await asyncio.open_connection("127.0.0.1", 53100)
        parser = sl.PacketParser()
        client_cb = b"\x6a\x00\x65\x00"

        # UDP socket for meters
        loop = asyncio.get_running_loop()
        meter_q: asyncio.Queue = asyncio.Queue()

        class MeterProto(asyncio.DatagramProtocol):
            def datagram_received(self, data, addr):
                meter_q.put_nowait(data)

        mt, _ = await loop.create_datagram_endpoint(MeterProto, local_addr=("127.0.0.1", 0))
        meter_port = mt.get_extra_info("sockname")[1]

        writer.write(sl.encode(b"UM", struct.pack("<H", meter_port), client_cb))
        sub = {"id": "Subscribe", "clientName": "Universal Control", "clientInternalName": "ucapp",
               "clientType": "PC", "clientDescription": "selftest", "clientIdentifier": "selftest",
               "clientOptions": "perm users levl redu rtan", "clientEncoding": 23106}
        writer.write(sl.encode(b"JM", sl.json_body(sub), client_cb))
        await writer.drain()

        seen, zb = await read_until(reader, parser, {b"ZB"})
        assert seen[0].ptype == b"JM" and seen[0].cbytes == b"\x65\x00\x6a\x00", "C-bytes not mirrored"
        n = struct.unpack_from("<I", seen[0].body)[0]
        assert json.loads(seen[0].body[4:4 + n])["id"] == "SubscriptionReply"
        csz = struct.unpack_from("<I", zb.body)[0]
        tree = sl.ub_decode(zlib.decompress(zb.body[4:4 + csz]))
        line = tree["children"]["line"]["children"]
        assert len(line) == 32 and "volume" in line["ch1"]["values"]
        print(f"ok  subscribe -> SubscriptionReply + ZB state ({len(line)} line channels)")

        # 3. PV change is applied and echoed
        pv = sl.build_pv("line/ch3/mute", 1.0)
        writer.write(sl.encode(b"PV", pv, client_cb))
        await writer.drain()
        _, echo = await read_until(reader, parser, {b"PV"})
        assert echo.body == pv and sim.state.get("line/ch3/mute") == 1.0
        print("ok  PV applied to state and echoed")

        # 4. server-side push
        sim.push_pv("main/ch1/volume", 0.9)
        _, push = await read_until(reader, parser, {b"PV"})
        assert push.body == sl.build_pv("main/ch1/volume", 0.9)
        print("ok  console-initiated PV push")

        # 5. file request
        writer.write(sl.encode(b"FR", b"\x01\x00Listpresets/channel\x00", client_cb))
        await writer.drain()
        _, fd = await read_until(reader, parser, {b"FD"})
        assert fd.body[2:4] == b"\x01\x00"
        print("ok  FR -> FD")

        # 6. meters
        frame = await asyncio.wait_for(meter_q.get(), 3)
        p = sl.PacketParser().feed(frame)[0]
        assert p.ptype == b"MS" and p.body[:4] == b"levl" and struct.unpack_from("<H", p.body, 6)[0] == 32
        print("ok  UDP meter frame received")

        writer.write(sl.encode(b"KA", b"", client_cb))
        await writer.drain()
        writer.close()
        mt.close()
    finally:
        await sim.stop()
    print("all checks passed")


if __name__ == "__main__":
    asyncio.run(main())