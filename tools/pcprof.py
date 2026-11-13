#!/usr/bin/env python3
"""tools/pcprof.py — where does a natively compiled ROM spend its time?

    python3 -I tools/pcprof.py ROM.pce ROM.elf [SKIP_FRAMES] [SAMPLES]

Runs the ROM in Geargrafx (tools/ggmcp.py), skips SKIP_FRAMES video frames (default 300, so boot and
loading are not counted), then reads the CPU's PC once per video frame for SAMPLES frames (default
300) and groups the samples by function using the ELF's symbols (llvm-nm), banked code included
(address = bank << 16 | PC for $C000-$DFFF).  One sample a frame is coarse but unbiased for a loop
that does not sync to the frame; it says which function to optimise first, not by how much."""
import bisect, collections, json, os, subprocess, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
from ggmcp import GG

rom, elf = sys.argv[1:3]
skip = int(sys.argv[3]) if len(sys.argv) > 3 else 300
n = int(sys.argv[4]) if len(sys.argv) > 4 else 300
llvm = os.environ.get("LLVM_MOS", "/Volumes/External II/pce-tools/llvm-mos/llvm-mos")
syms = []
for l in subprocess.run([llvm + "/bin/llvm-nm", "-n", "-S", elf], capture_output=True, text=True).stdout.splitlines():
    p = l.split()
    if len(p) == 4:
        try: syms.append((int(p[0], 16), int(p[1], 16), p[3]))
        except ValueError: pass
syms.sort(); addrs = [s[0] for s in syms]

def name(a):
    i = bisect.bisect_right(addrs, a) - 1
    if i >= 0 and syms[i][0] <= a < syms[i][0] + max(syms[i][1], 1): return syms[i][2]
    return "?%X" % a

g = GG(rom)
g.tool("debug_step_frame", {"frames": skip, "mode": "sync"})
c = collections.Counter()
for _ in range(n):
    g.tool("debug_step_frame", {"frames": 1, "mode": "sync"})
    st = json.loads(g.tool("get_huc6280_status"))
    pc = int(st["PC"], 16); b6 = int(st["MPR"][6]["value"], 16)
    c[name((b6 << 16) | pc if 0xC000 <= pc < 0xE000 else pc)] += 1
g.close()
tot = sum(c.values())
for k, v in c.most_common(14):
    print("%5.1f%%  %s" % (100.0 * v / tot, k))
