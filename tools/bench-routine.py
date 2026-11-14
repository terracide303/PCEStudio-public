#!/usr/bin/env python3
"""tools/bench-routine.py — race our compiler against real HuCard routines.

Subcommands (Geargrafx through tools/ggmcp.py; scratch goes to $TMPDIR, never into the repo):

  scan ROM NAME OUT.json [POINTS]
      Plays the game as tools/study-idioms.py does, traces POINTS frames (default 3) and reduces the trace to the
      subroutines (JSR/BSR targets): calls per frame, mean CPU cycles per call (nested calls included, interrupt
      handlers excluded), instructions per call, whether the routine is a leaf, whether it loops, and the
      memory operands it touches.  Prints the best self-contained candidates.  Nothing but counts is written.

  capture ROM ENTRY_HEX N OUT.json [BANK_HEX]
      Breaks at the routine's entry N times and, at each call, stores A/X/Y and the bytes of the addresses the
      routine touches (given in OUT.json's "addrs" if it exists, else the zero page and $2200-$22FF are read),
      then runs to the routine's return and stores them again.  For OUR use only: the file stays in scratch.

  measure ROM.pce [FRAMES]
      Reads the runtime's timer cells ($2100) of a native ROM built from tests/native-routines/NAME: the mean
      frame() cost in CPU cycles.  The harnesses call the routine CALLS times in frame() (see their
      `CALLS = N` line), so cycles per call = (frame cost - empty-loop cost) / CALLS.

Units: the trace's time stamps are master-clock cycles, 3 per CPU cycle.  The cost of an instruction is the time
stamp difference to the NEXT trace entry (a trace line's own delta is the cost of the previous instruction)."""
import collections
import importlib.util
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from ggmcp import GG

_spec = importlib.util.spec_from_file_location("study_idioms", os.path.join(HERE, "study-idioms.py"))
si = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(si)

HEXT = re.compile(r"^\$([0-9A-Fa-f]{4})")


def play(g, rounds=4):
    """the same pattern of key presses study-idioms.py uses, so a title screen starts the game"""
    g.tool("debug_step_frame", {"frames": 240, "mode": "sync"})
    for k in range(rounds):
        g.tool("controller_button", {"action": "press_and_release", "button": "run"})
        g.tool("debug_step_frame", {"frames": 60, "mode": "sync"})
        for j, b in enumerate(("i", "right", "ii", "down", "i", "left", "up", "ii")):
            g.tool("controller_button", {"action": "press_and_release", "button": b})
            g.tool("debug_step_frame", {"frames": 12 + 4 * (j % 3), "mode": "sync"})


def calls_of(ins):
    """routine = (bank, target); returns {key: [call records]}.  cost[i] = master clocks of ins[i]."""
    n = len(ins)
    cost = [0] * n
    for i in range(n - 1):
        cost[i] = ins[i + 1]["cyc"]
    out = collections.defaultdict(list)
    stack = []
    for i in range(n):
        x = ins[i]
        mn = x["mn"]
        for fr in stack:
            if not x["irq"]:
                fr["cyc"] += cost[i]
            fr["n"] += 1
            if mn in ("JSR", "BSR") and fr is stack[-1]:
                fr["leaf"] = False
            if mn in si.BRANCH and i + 1 < n and ins[i + 1]["pc"] <= x["pc"] and ins[i + 1]["bank"] == x["bank"] and not x["irq"]:
                fr["loops"] += 1
            if not x["irq"]:
                cls, addr = si.mode_of(mn, x["op"])
                if addr is not None and cls in ("zp", "zpx", "zpy", "abs", "absx", "absy", "zpind", "zpindy", "zpindx"):
                    fr["addrs"].add((cls, addr))
        if mn in ("JSR", "BSR") and i + 1 < n and not x["irq"]:
            stack.append(dict(key=(ins[i + 1]["bank"], ins[i + 1]["pc"]), S=x["S"], cyc=0, n=0, leaf=True, loops=0,
                              addrs=set(), A=ins[i + 1]["A"], X=ins[i + 1]["X"], Y=ins[i + 1]["Y"]))
        elif mn == "RTS" and stack:
            while stack and stack[-1]["S"] - 2 != x["S"] and len(stack) > 0:
                if stack[-1]["S"] - 2 < x["S"]:
                    break
                stack.pop()
            if stack and stack[-1]["S"] - 2 == x["S"]:
                fr = stack.pop()
                out[fr["key"]].append(fr)
    return out


def scan(rom, name, outp, points=3):
    g = GG(rom)
    play(g)
    agg = collections.defaultdict(lambda: dict(calls=0, cyc=0, n=0, leaf=True, loops=0, addrs=set(), frames=0, samples=[]))
    for p in range(points):
        for j, b in enumerate(("i", "right", "ii", "down", "left", "up")):
            g.tool("controller_button", {"action": "press_and_release", "button": b})
            g.tool("debug_step_frame", {"frames": 10, "mode": "sync"})
        lines, over = si.capture(g, 1)
        ins = si.parse(lines)
        total = sum(i["cyc"] for i in ins) // 3
        for key, frs in calls_of(ins).items():
            a = agg[key]
            a["calls"] += len(frs)
            a["frames"] += 1
            for fr in frs:
                a["cyc"] += fr["cyc"] // 3
                a["n"] += fr["n"]
                a["leaf"] = a["leaf"] and fr["leaf"]
                a["loops"] += fr["loops"]
                a["addrs"] |= fr["addrs"]
                if len(a["samples"]) < 6:
                    a["samples"].append((fr["A"], fr["X"], fr["Y"]))
        agg["__total__"]["cyc"] += total
    g.close()
    tot = agg.pop("__total__")["cyc"] or 1
    rows = []
    for key, a in agg.items():
        if a["calls"] == 0:
            continue
        rows.append(dict(bank=key[0], entry="%04X" % key[1], calls_per_frame=round(a["calls"] / points, 1),
                         cycles_per_call=round(a["cyc"] / a["calls"], 1), instr_per_call=round(a["n"] / a["calls"], 1),
                         leaf=a["leaf"], loops_per_call=round(a["loops"] / a["calls"], 2),
                         share_of_frame=round(a["cyc"] / tot, 4), addrs=sorted("%s:%04X" % (c, ad) for c, ad in a["addrs"])[:40]))
    rows.sort(key=lambda r: -r["share_of_frame"])
    json.dump(dict(game=name, points=points, routines=rows), open(outp, "w"))
    print(name, "| routines seen", len(rows))
    shown = 0
    for r in rows:
        if r["leaf"] and 6 <= r["instr_per_call"] <= 70 and r["calls_per_frame"] >= 3:
            print("  %s:%s  calls/frame %5.1f  cycles/call %6.1f  instr/call %5.1f  loops/call %4.2f  share %5.2f%%  addrs %d" % (
                r["bank"] and "%02X" % r["bank"], r["entry"], r["calls_per_frame"], r["cycles_per_call"], r["instr_per_call"],
                r["loops_per_call"], 100 * r["share_of_frame"], len(r["addrs"])))
            shown += 1
            if shown >= 14:
                break


def snapshot(g, addrs):
    st = json.loads(g.tool("get_huc6280_status"))
    mem = {}
    for a in addrs:
        mem[a] = g.ram(a, 1)[0]
    return dict(A=int(st["A"], 16), X=int(st["X"], 16), Y=int(st["Y"], 16), PC=st["PC"], mem=mem)


def capture(rom, entry, n, outp, bank=None):
    entry_i = int(entry, 16)
    spec = json.load(open(outp)) if os.path.exists(outp) else {}
    addrs = [int(a) for a in spec.get("addrs", [])] or list(range(0x2000, 0x2100)) + list(range(0x2200, 0x2300))
    g = GG(rom)
    play(g)
    g.tool("set_breakpoint", {"address": "%04X" % entry_i})
    calls = []
    for k in range(n * 3):
        g.tool("debug_continue", {})
        for _ in range(40):
            time.sleep(0.05)
            st = json.loads(g.tool("get_huc6280_status"))
            if int(st["PC"], 16) == entry_i:
                break
        else:
            g.tool("debug_pause", {})
            g.tool("debug_step_frame", {"frames": 3, "mode": "sync"})
            continue
        pre = snapshot(g, addrs)
        g.tool("debug_step_out", {})
        time.sleep(0.1)
        post = snapshot(g, addrs)
        calls.append(dict(pre=pre, post=post))
        if len(calls) >= n:
            break
        g.tool("debug_step_frame", {"frames": 1 + (k % 3), "mode": "sync"})
    g.close()
    json.dump(dict(entry="%04X" % entry_i, addrs=addrs, calls=calls), open(outp, "w"))
    print("captured", len(calls), "calls of", entry)


def effective(op, x, y):
    """the CPU address a trace operand names for zero-page and absolute modes (indexed ones add X or Y), or None"""
    m = re.match(r"^\$([0-9A-Fa-f]+)(,X|,Y)?$", op.strip())
    if not m:
        return None
    a = int(m.group(1), 16)
    if len(m.group(1)) <= 2:
        a += 0x2000
    if m.group(2) == ",X":
        a += x
    elif m.group(2) == ",Y":
        a += y
    return a


LOADS = {"LDA": "A", "LDX": "X", "LDY": "Y"}
STORES = {"STA": "A", "STX": "X", "STY": "Y"}


def trace_calls(rom, entry, n, outp, frames=6):
    """For the first N calls of the routine at ENTRY (any bank), write {regs in, reads [(addr, value)], writes [(addr, value)],
    cycles, regs out} reconstructed from the instruction trace alone.  Scratch use only (OUT.json goes under $TMPDIR)."""
    e = int(entry, 16)
    g = GG(rom)
    play(g)
    calls = []
    for k in range(frames):
        for b in ("i", "right", "ii", "down", "left", "up"):
            g.tool("controller_button", {"action": "press_and_release", "button": b})
            g.tool("debug_step_frame", {"frames": 7, "mode": "sync"})
        lines, over = si.capture(g, 1)
        ins = si.parse(lines)
        stack = []
        for i, x in enumerate(ins):
            mn = x["mn"]
            for fr in stack:
                fr["cyc"] += ins[i]["cyc"] if i > 0 else 0
            if mn in ("JSR", "BSR") and i + 1 < len(ins) and ins[i + 1]["pc"] == e and not x["irq"]:
                stack.append(dict(S=x["S"], cyc=0, regs=(ins[i + 1]["A"], ins[i + 1]["X"], ins[i + 1]["Y"]), reads=[], writes=[], nested=0, body=[]))
                continue
            if not stack:
                continue
            fr = stack[-1]
            if x["irq"]:
                continue
            if mn in ("JSR", "BSR"):
                fr["nested"] += 1
            if mn == "RTS" and fr["S"] - 2 == x["S"]:
                fr["regs_out"] = (ins[i + 1]["A"], ins[i + 1]["X"], ins[i + 1]["Y"]) if i + 1 < len(ins) else None
                if i + 1 < len(ins):
                    fr["cyc"] += ins[i + 1]["cyc"]     # the RTS itself; the JSR was counted on the first body entry
                fr["cyc"] = fr["cyc"] // 3             # master clocks -> CPU cycles: JSR + body + RTS
                stack.pop()
                calls.append(fr)
                continue
            a = effective(x["op"], x["X"], x["Y"])
            nxt = ins[i + 1] if i + 1 < len(ins) else x
            if mn in LOADS and a is not None:
                fr["reads"].append((a, nxt[LOADS[mn]]))
            elif mn in LOADS and x["op"].strip().startswith("("):
                fr["reads"].append((-1, nxt[LOADS[mn]]))      # through a pointer: the value only, in order
            elif mn in STORES and a is not None:
                fr["writes"].append((a, x[STORES[mn]]))
            elif mn == "STZ" and a is not None:
                fr["writes"].append((a, 0))
            elif mn in ("ST1", "ST2"):
                fr["writes"].append((0x0002 if mn == "ST1" else 0x0003, int(x["op"].split("#$")[1][:2], 16) if "#$" in x["op"] else None))
            fr["body"].append("%04X %s %s" % (x["pc"], mn, x["op"]))
        if len(calls) >= n:
            break
    g.close()
    json.dump(dict(entry=entry, calls=calls[:n]), open(outp, "w"))
    c = calls[:n]
    print("traced", len(c), "calls; cycles", sorted(set(x["cyc"] for x in c)), "| first call body:")
    if c:
        print("  " + "\n  ".join(c[0]["body"]))


def dis(rom, entry, length):
    """print the disassembly of the routine as the game has it mapped during play (to the terminal only)"""
    e = int(entry, 16)
    g = GG(rom)
    play(g)
    for _ in range(2):
        g.tool("debug_step_frame", {"frames": 1, "mode": "sync"})
    d = json.loads(g.tool("get_disassembly", {"start_address": "%04X" % e, "end_address": "%04X" % (e + length)}))
    for l in d.get("instructions", d.get("lines", [])):
        print(l)
    g.close()


def fixture(name, frames=150):
    """Build tests/native-routines/NAME (the routine called CALLS times a frame) and a baseline with the same loop and an
    empty body, run both in Geargrafx and print the extra CPU cycles one call costs: (frame - baseline) / CALLS.
    The frame() time comes from the runtime's timer cells ($2100); one tick is 1,024 cycles, so the resolution is
    about 1,024 / CALLS cycles per call (16 for 64 calls)."""
    import subprocess
    root = os.path.dirname(HERE)
    src = open(os.path.join(root, "tests", "native-routines", name, "main.lua")).read()
    calls = int(re.search(r"^CALLS = (\d+)", src, re.M).group(1))
    m = re.search(r"(for k = 1, CALLS do\n)(.*?)(\n  end\n)", src, re.S)
    body = m.group(2).split("\n")
    # only the call line changes: it carries `-- @base STATEMENT`, the statement that uses the same arguments
    # without the call, so the argument code (and its cost) stays in the baseline
    body[-1] = "    " + body[-1].split("-- @base", 1)[1].strip()
    base = src[:m.start(2)] + "\n".join(body) + src[m.end(2):]
    tmp = os.environ.get("TMPDIR", "/tmp")
    res = {}
    for tag, text in (("full", src), ("base", base)):
        d = os.path.join(tmp, "rt-%s-%s" % (name, tag))
        os.makedirs(d, exist_ok=True)
        open(os.path.join(d, "main.lua"), "w").write(text)
        r = subprocess.run(["sh", os.path.join(root, "tools", "build-toyc-banked.sh"), os.path.join(d, "main.lua"), "rt-%s-%s" % (name, tag)],
                           cwd=root, capture_output=True, text=True, env=dict(os.environ, TMPDIR=tmp))
        rom = os.path.join(root, "tools", "gen", "rt-%s-%s.pce" % (name, tag))
        if not os.path.exists(rom):
            print(name, "BUILD FAILED:", (r.stderr or r.stdout).strip().splitlines()[-1:]); return
        g = GG(rom)
        g.tool("debug_step_frame", {"frames": frames, "mode": "sync"})
        m_ = g.ram(0x2100, 16)
        sm = m_[0] | (m_[1] << 8) | (m_[2] << 16) | (m_[3] << 24); c = m_[4] | (m_[5] << 8)
        g.close()
        res[tag] = 1024.0 * sm / max(c, 1)
    print(json.dumps(dict(fixture=name, calls=calls, full=round(res["full"]), base=round(res["base"]),
                          cycles_per_call=round((res["full"] - res["base"]) / calls, 1))))


def measure(rom, frames=300):
    g = GG(rom)
    g.tool("debug_step_frame", {"frames": frames, "mode": "sync"})
    m = g.ram(0x2100, 16)
    s = m[0] | (m[1] << 8) | (m[2] << 16) | (m[3] << 24)
    c = m[4] | (m[5] << 8)
    g.close()
    print(json.dumps(dict(frames=c, cycles_per_frame=round(1024.0 * s / max(c, 1), 1), max_ticks=m[6])))


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "scan":
        scan(sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5]) if len(sys.argv) > 5 else 3)
    elif cmd == "capture":
        capture(sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5], sys.argv[6] if len(sys.argv) > 6 else None)
    elif cmd == "trace":
        trace_calls(sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5])
    elif cmd == "dis":
        dis(sys.argv[2], sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 64)
    elif cmd == "fixture":
        fixture(sys.argv[2])
    elif cmd == "measure":
        measure(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 300)
    else:
        print(__doc__)
