#!/usr/bin/env python3
"""tools/bench-frame.py — what does one toy frame() cost on the console, and how long is the boot?

    python3 -I tools/bench-frame.py ROM.pce [VIDEO_FRAMES]

Runs the native ROM in Geargrafx (tools/ggmcp.py) and prints, from the runtime's timer cells at $2100
(toy_runtime.c MEAS: the TMA timer ticks every 1024 CPU cycles, 117 ticks make a video frame), the mean
frame() cost in ticks and cycles and the toy-frame count; and the boot time, taken as the first video frame
at which VRAM word $7FFE holds $BEEF (the benchmark toys' init writes it last).  The 7-bit timer wraps at
128 ticks, so a frame() above about 1.1 video frames reads wrong; keep benchmark frames short."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ggmcp import GG
rom = sys.argv[1]; n = int(sys.argv[2]) if len(sys.argv) > 2 else 300
g = GG(rom)
areas = {a["name"]: a for a in json.loads(g.tool("list_memory_areas"))["areas"]}
def vword(addr):
    t = json.loads(g.tool("read_memory", {"area": areas["VRAM"]["id"], "offset": "%04X" % addr, "size": 2}))
    b = bytes.fromhex(t["data"].replace(" ", "")); return b[0] | (b[1] << 8)
boot = None
for f in range(1, n + 1):
    g.tool("debug_step_frame", {"frames": 1, "mode": "sync"})
    if boot is None and f % 1 == 0 and vword(0x7FFE) == 0xBEEF: boot = f
m = g.ram(0x2100, 16); u32 = lambda o: m[o] | (m[o+1] << 8) | (m[o+2] << 16) | (m[o+3] << 24)
cnt = m[4] | (m[5] << 8)
print("boot: first toy init at video frame", boot, "| toy frames", cnt, "of", n - (boot or 0),
      "| frame() mean %.2f ticks = %.0f cycles" % (u32(0) / max(cnt, 1), 1024.0 * u32(0) / max(cnt, 1)), "max", m[6])
g.close()
