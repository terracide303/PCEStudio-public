#!/usr/bin/env python3
"""tools/pctrace.py — exact CPU cycles per function of a natively compiled ROM, from Geargrafx's trace log.

    python3 -I tools/pctrace.py ROM.pce ROM.elf [SKIP_FRAMES] [FRAMES] [TOPN]

tools/pcprof.py samples the PC once a video frame, always at the same phase of the frame, so a game that
waits for VBlank is sampled mostly inside its wait.  This records EVERY instruction of FRAMES video frames
(default 6, after SKIP_FRAMES, default 300) and adds up the cycles each instruction took, by function
(llvm-nm symbols, banked code as bank<<16|pc), plus the busiest instruction addresses.  Time in the wait
for VBlank and in the interrupt handlers is reported on its own lines.  The trace counts master clocks (21.48 MHz, 3 to a CPU\nclock); the lines below divide by 3, so a video frame is about 119,600 CPU cycles."""
import bisect, collections, json, os, re, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ggmcp import GG

rom, elf = sys.argv[1:3]
skip = int(sys.argv[3]) if len(sys.argv) > 3 else 300
n = int(sys.argv[4]) if len(sys.argv) > 4 else 6
top = int(sys.argv[5]) if len(sys.argv) > 5 else 14
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
def gf():
    m = g.ram(0x2100, 16); return m[4] | (m[5] << 8)      # the runtime's toy-frame counter
gf0 = gf()
g.tool("set_trace_log", {"enabled": True, "filters": ["cpu.instructions"]})
g.tool("debug_step_frame", {"frames": n, "mode": "sync"})
games = gf() - gf0
total = json.loads(g.tool("get_trace_log", {"count": 1}))["total_entries"]
line = re.compile(r"@\d+ \+(\d+)\s+([0-9A-F]{2}):([0-9A-F]{4})")
rows = []; pos = 0; CH = 1000
while pos < total:
    d = json.loads(g.tool("get_trace_log", {"start": pos, "count": CH}))
    for s in d["lines"]:
        m = line.match(s)
        if m: rows.append((int(m.group(1)), int(m.group(2), 16), int(m.group(3), 16)))
    pos = d["next_sequence"] if d["lines"] else total
g.close()
fn = collections.Counter(); pcs = collections.Counter(); cyc = 0
for i in range(1, len(rows)):          # a line's +N is the cost of the instruction BEFORE it
    d, _, _ = rows[i]; b, pc = rows[i - 1][1], rows[i - 1][2]
    a = (b << 16) | pc if 0xC000 <= pc < 0xE000 else pc
    fn[name(a)] += d; pcs[a] += d; cyc += d
print("%d instructions, %d CPU cycles over %d video frames (%.0f a frame)" % (len(rows), cyc / 3, n, cyc / 3 / n))
idle = sum(v for a, v in pcs.most_common(2) if v > 0.05 * cyc)   # the wait loop: two instructions that dominate
print("waiting for VBlank: %.0f%%; working: %.0f CPU cycles a video frame (%.2f video frames)" % (100.0 * idle / cyc, (cyc - idle) / 3 / n, (cyc - idle) / cyc))
print("%d game frames: working %.0f CPU cycles (%.2f video frames) per game frame" % (games, (cyc - idle) / 3 / max(games, 1), (cyc - idle) / 3 / max(games, 1) / 119664))
for k, v in fn.most_common(top): print("%5.1f%%  %8.0f cyc/frame  %s" % (100.0 * v / cyc, v / n / 3, k))
if os.environ.get("LINES"):
    # LINES=1 and an ELF built with -g (OPT="-Os -g"): cycles by C source line of the generated .c
    ad = sorted(pcs)
    out = subprocess.run([llvm + "/bin/llvm-addr2line", "-e", elf] + ["0x%X" % a for a in ad], capture_output=True, text=True).stdout.splitlines()
    byl = collections.Counter()
    for a, l in zip(ad, out): byl[os.path.basename(l)] += pcs[a]
    print("by source line:")
    for k, v in byl.most_common(top * 3): print("%5.1f%%  %7.0f cyc/frame  %s" % (100.0 * v / cyc, v / n / 3, k))
print("busiest addresses:")
for a, v in pcs.most_common(top): print("  %06X %5.1f%%  %s" % (a, 100.0 * v / cyc, name(a)))
