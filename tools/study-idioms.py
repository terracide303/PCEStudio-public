#!/usr/bin/env python3
"""tools/study-idioms.py — HOW does a real HuCard write its code?  Statistics only.

    python3 -I tools/study-idioms.py ROM.pce NAME OUT.json [POINTS]

Runs the ROM in Geargrafx (tools/ggmcp.py, docs/GEARGRAFX-MCP.md), presses RUN a few times and, at
POINTS places (default 4) after the title, records the CPU instruction trace of one whole video frame
(about 30,000 to 60,000 instructions) and reduces it to counts and percentages:

  * addressing modes of the memory operands (zero page, indexed, indirect, absolute, I/O, ROM),
  * HuC6280 and 65C02 instructions used (block transfers, ST0/1/2, SXY/SAX/SAY, CSL/CSH, TAM/TMA,
    SET, CLA/CLX/CLY, BSR, TST; STZ, BRA, TSB/TRB, (zp), JMP (abs,x), PHX/PLX ...),
  * control flow: JSR/BSR/JMP-indirect counts, RTS that do not return to their call (dispatch),
    deepest call nesting, size of the routines that take the time,
  * where the frame goes: idle spin, interrupt handlers, VDC/PSG/pad I/O,
  * loops: iterations per run, cycles per iteration, X stride per iteration (array of structures
    versus structure of arrays), shift-and-add loops (software multiply/divide),
  * 16-bit arithmetic chains (ADC/SBC on adjacent addresses),
  * bank mapping (TAM masks, cycles in TAM/TMA),
  * VDC use (register selects, VRAM words written, SAT DMA registers).

Nothing from the ROM is stored: only counts.  The trace is read in memory and dropped.  Results are
summarised in docs/ORIGINAL-CODE-IDIOMS.md.  Needs Geargrafx (see tools/ggmcp.py)."""
import collections
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ggmcp import GG

LINE = re.compile(r"^@(\d+) \+(\d+)\s+([0-9A-F]{2}):([0-9A-F]{4})\s+A:(\w\w) X:(\w\w) Y:(\w\w) S:(\w\w)\s+(\S{8})\s+(.*?)\s{2,}([0-9A-F ]+)\s*$")
IRQ = re.compile(r"\[CPU\]\s+(IRQ|NMI|BRK)")

BRANCH = {"BEQ", "BNE", "BCC", "BCS", "BMI", "BPL", "BVC", "BVS", "BRA"}
BLOCK = {"TAI", "TDD", "TIA", "TII", "TIN"}
HUC_ONLY = {"ST0", "ST1", "ST2", "SXY", "SAX", "SAY", "CSL", "CSH", "TAM", "TMA", "SET", "CLA", "CLX", "CLY", "BSR", "TST"} | BLOCK
C65 = {"STZ", "BRA", "TSB", "TRB", "PHX", "PHY", "PLX", "PLY"}
SHIFT = {"ASL", "LSR", "ROL", "ROR"}
WRITES = {"STA", "STX", "STY", "STZ", "INC", "DEC", "ASL", "LSR", "ROL", "ROR", "TSB", "TRB", "ST0", "ST1", "ST2", "PHA", "PHX", "PHY"} | BLOCK
NOMEM = {"NOP", "TAX", "TAY", "TXA", "TYA", "TSX", "TXS", "INX", "INY", "DEX", "DEY", "CLC", "SEC", "CLI", "SEI", "CLD", "SED", "CLV", "PHA", "PLA", "PHP", "PLP", "PHX", "PHY", "PLX", "PLY", "RTS", "RTI", "CLA", "CLX", "CLY", "SXY", "SAX", "SAY", "CSL", "CSH", "SET", "ST0", "ST1", "ST2", "TAM", "TMA"}

HEX = r"\$([0-9A-Fa-f]+)"


def mode_of(mn, op):
    """(class, address or None).  class is one of imm, zp, zpx, zpy, zpind, zpindx, zpindy, abs, absx, absy,
    absind, absindx, rel, none."""
    op = op.strip()
    if mn in BRANCH or mn == "BSR" or mn.startswith("BB") and mn[2:].isdigit():
        return "rel", None
    if mn in NOMEM or op == "" or op == "A":
        return "none", None
    if op.startswith("#"):
        return "imm", None
    m = re.match(r"^\(" + HEX + r"\),Y", op)
    if m:
        return "zpindy", int(m.group(1), 16)
    m = re.match(r"^\(" + HEX + r",X\)", op)
    if m:
        return ("zpindx" if len(m.group(1)) <= 2 else "absindx"), int(m.group(1), 16)
    m = re.match(r"^\(" + HEX + r"\)", op)
    if m:
        return ("zpind" if len(m.group(1)) <= 2 else "absind"), int(m.group(1), 16)
    m = re.match(r"^" + HEX + r"(,X|,Y)?", op)
    if m:
        w = len(m.group(1)) <= 2
        idx = (m.group(2) or "")[-1:].lower()
        return ("zp" if w else "abs") + idx, int(m.group(1), 16)
    return "none", None


def parse(lines):
    ins = []
    phases = []  # 0 main, 1 interrupt
    depth = 0
    for l in lines:
        m = LINE.match(l)
        if not m:
            if IRQ.search(l):
                depth += 1
            continue
        cyc = int(m.group(2))
        pc = int(m.group(4), 16)
        bank = int(m.group(3), 16)
        txt = m.group(10).split()
        mn = txt[0]
        op = " ".join(txt[1:])
        op = re.sub(r"\s*\[.*?\]\s*$", "", op)
        ins.append(dict(cyc=cyc, bank=bank, pc=pc, mn=mn, op=op, A=int(m.group(5), 16), X=int(m.group(6), 16),
                        Y=int(m.group(7), 16), S=int(m.group(8), 16), irq=depth > 0, length=len(m.group(11).split())))
        if mn == "RTI" and depth > 0:
            depth -= 1
    return ins[1:]  # the first entry's delta spans the time since the previous capture


def analyse(ins):
    n = len(ins)
    if n < 100:
        return None
    total = sum(i["cyc"] for i in ins) or 1
    out = dict(instructions=n, cycles_cpu=total // 3)

    # ---- spin / loops --------------------------------------------------------------------------
    by_pc = collections.defaultdict(list)
    for k, i in enumerate(ins):
        by_pc[(i["bank"], i["pc"])].append(k)
    # back-edges: an instruction whose successor has a lower pc in the same bank, via a branch or JMP
    loops = {}
    for k in range(n - 1):
        a, b = ins[k], ins[k + 1]
        if a["mn"] in BRANCH or a["mn"] == "JMP":
            if b["bank"] == a["bank"] and b["pc"] <= a["pc"] and a["pc"] - b["pc"] <= 2048:
                key = (a["bank"], b["pc"], a["pc"])
                loops.setdefault(key, []).append(k + 1)  # index of the header visit that follows
    pc_cyc = collections.defaultdict(int)
    pc_cnt = collections.defaultdict(int)
    for i in ins:
        pc_cyc[(i["bank"], i["pc"])] += i["cyc"]
        pc_cnt[(i["bank"], i["pc"])] += 1
    loop_rows = []
    spin_cyc = 0
    spin_keys = set()
    for (bank, h, bpc), visits in loops.items():
        in_range = [k for (bk, p) in pc_cnt if bk == bank and h <= p <= bpc for k in by_pc[(bk, p)]]
        cyc = sum(pc_cyc[(bank, p)] for (bk, p) in pc_cnt if bk == bank and h <= p <= bpc)
        mns = collections.Counter(ins[k]["mn"] for k in in_range)
        backedges = len(visits)
        # episodes: header entered from outside the range
        episodes = 0
        for k in by_pc.get((bank, h), []):
            if k == 0 or not (ins[k - 1]["bank"] == bank and h <= ins[k - 1]["pc"] <= bpc):
                episodes += 1
        episodes = max(episodes, 1)
        iters = backedges + episodes
        writes = sum(v for m_, v in mns.items() if m_ in WRITES and m_ not in ("PHA", "PHX", "PHY"))
        row = dict(bank=bank, head=h, tail=bpc, span=bpc - h, backedges=backedges, episodes=episodes, iters_per_run=round(iters / episodes, 1),
                   cycles=cyc, cycles_per_iter=round(cyc / iters, 1), has_shift=any(m_ in SHIFT for m_ in mns), has_add=("ADC" in mns or "SBC" in mns or "CMP" in mns),
                   writes=writes, x_steps=None, bases=None)
        # X stride per iteration at the header
        xs = [ins[k]["X"] for k in by_pc.get((bank, h), [])]
        steps = collections.Counter()
        for a, b in zip(xs, xs[1:]):
            d = (b - a) & 0xFF
            if d > 127:
                d -= 256
            if abs(d) <= 16:
                steps[d] += 1
        row["x_steps"] = steps.most_common(2)
        bases = set()
        for k in in_range:
            c, addr = mode_of(ins[k]["mn"], ins[k]["op"])
            if c in ("absx", "zpx", "absy", "zpy") and addr is not None:
                bases.add(addr)
        row["bases"] = sorted(bases)
        loop_rows.append(row)
        if span_ok(row) and writes == 0 and iters >= 150 and cyc >= total * 0.02:
            spin_cyc += cyc
            spin_keys.add((bank, h, bpc))
    out["idle_spin_share"] = round(min(1.0, spin_cyc / total), 3)

    # ---- memory operand addressing ------------------------------------------------------------
    cls = collections.Counter()
    cls_cyc = collections.Counter()
    io = collections.Counter()
    for i in ins:
        c, addr = mode_of(i["mn"], i["op"])
        if c in ("none", "rel", "imm"):
            continue
        key = c
        if c in ("abs", "absx", "absy") and addr is not None:
            if addr < 0x2000:
                key = "io"
                if addr <= 3:
                    io["vdc"] += 1
                elif 0x400 <= addr <= 0x405:
                    io["vce"] += 1
                elif 0x800 <= addr <= 0x809:
                    io["psg"] += 1
                elif addr == 0x1000:
                    io["pad"] += 1
                else:
                    io["other"] += 1
            elif addr < 0x4000:
                key = c + "_ram"
            else:
                key = c + "_rom"
        cls[key] += 1
        cls_cyc[key] += i["cyc"]
    mem_n = sum(cls.values()) or 1
    out["mem_operands"] = {k: round(100.0 * v / mem_n, 1) for k, v in cls.most_common()}
    out["mem_operands_count"] = mem_n
    out["io_by_target"] = dict(io)
    zp_total = sum(v for k, v in cls.items() if k.startswith("zp"))
    ram_total = zp_total + sum(v for k, v in cls.items() if k.endswith("_ram"))
    out["zero_page_share_of_ram_operands"] = round(100.0 * zp_total / ram_total, 1) if ram_total else None
    out["indexed_share_of_ram_operands"] = round(100.0 * sum(v for k, v in cls.items() if k in ("zpx", "zpy") or k.startswith(("absx_ram", "absy_ram"))) / ram_total, 1) if ram_total else None

    # ---- instruction mix -----------------------------------------------------------------------
    mn = collections.Counter(i["mn"] for i in ins)
    out["huc6280"] = {m_: mn[m_] for m_ in sorted(HUC_ONLY) if mn[m_]}
    out["w65c02"] = {m_: mn[m_] for m_ in sorted(C65) if mn[m_]}
    out["mnemonic_top"] = {m_: round(100.0 * v / n, 1) for m_, v in mn.most_common(10)}
    ind_zp = sum(1 for i in ins if mode_of(i["mn"], i["op"])[0] == "zpind")
    out["w65c02"]["(zp) indirect"] = ind_zp
    out["jmp_abs_x"] = sum(1 for i in ins if i["mn"] == "JMP" and mode_of(i["mn"], i["op"])[0] == "absindx")
    out["jmp_abs_ind"] = sum(1 for i in ins if i["mn"] == "JMP" and mode_of(i["mn"], i["op"])[0] == "absind")
    out["jmp_abs"] = sum(1 for i in ins if i["mn"] == "JMP" and mode_of(i["mn"], i["op"])[0] == "abs")
    out["jsr"] = mn["JSR"]
    out["bsr"] = mn["BSR"]
    out["rts"] = mn["RTS"]
    out["rti"] = mn["RTI"]
    out["block_xfer_cycles_pct"] = round(100.0 * sum(i["cyc"] for i in ins if i["mn"] in BLOCK) / total, 1)
    out["tam"] = dict(collections.Counter(i["op"] for i in ins if i["mn"] == "TAM"))
    out["tma"] = mn["TMA"]
    out["tam_tma_cycles_pct"] = round(100.0 * sum(i["cyc"] for i in ins if i["mn"] in ("TAM", "TMA")) / total, 2)

    # ---- calls: shadow stack, RTS that does not return to its call, depth --------------------------
    shadow = {}
    mismatch = 0
    rts_n = 0
    s0 = max(i["S"] for i in ins)
    smin = min(i["S"] for i in ins if not i["irq"]) if any(not i["irq"] for i in ins) else s0
    pha_rts = 0
    for k in range(n - 1):
        a, b = ins[k], ins[k + 1]
        if a["mn"] in ("JSR", "BSR"):
            shadow[(a["S"] - 2) & 0xFF] = (a["pc"] + (3 if a["mn"] == "JSR" else 2)) & 0xFFFF
        elif a["mn"] == "RTS":
            rts_n += 1
            exp = shadow.get(a["S"])
            if exp is not None and b["pc"] != exp:
                mismatch += 1
    # inclusive cost of each call (JSR/BSR to its RTS, interrupts excluded), in CPU cycles
    pref = [0]
    for i in ins:
        pref.append(pref[-1] + i["cyc"])
    open_calls = {}
    incl = []
    for k in range(n - 1):
        a = ins[k]
        if a["irq"]:
            continue
        if a["mn"] in ("JSR", "BSR"):
            open_calls[(a["S"] - 2) & 0xFF] = k
        elif a["mn"] == "RTS" and a["S"] in open_calls:
            ks = open_calls.pop(a["S"])
            incl.append((pref[k + 1] - pref[ks]) / 3.0)
    if incl:
        incl.sort()
        out["call_inclusive_cpu_cycles"] = dict(calls=len(incl), median=round(incl[len(incl) // 2], 1), p90=round(incl[int(len(incl) * 0.9)], 1),
                                                under_60_pct=round(100.0 * sum(1 for x in incl if x < 60) / len(incl), 1))
        out["call_return_overhead_pct"] = round(100.0 * len(incl) * 14 * 3 / total, 2)  # JSR 7 + RTS 7 CPU cycles each
    out["rts_not_returning_to_call"] = mismatch
    out["rts_total"] = rts_n
    main_depth = [i["S"] for i in ins if not i["irq"]]
    out["max_stack_bytes_main"] = (max(main_depth) - min(main_depth)) if main_depth else None
    # routines by contiguous executed code (gap <= 6 bytes), top by cycles
    pcs = sorted(pc_cyc)
    groups = []
    for key in pcs:
        if groups and groups[-1][0] == key[0] and key[1] - groups[-1][2] <= 6:
            groups[-1][2] = key[1]
            groups[-1][3] += pc_cyc[key]
        else:
            groups.append([key[0], key[1], key[1], pc_cyc[key]])
    top = sorted(groups, key=lambda g: -g[3])[:8]
    out["hot_regions"] = [dict(bytes=g[2] - g[1] + 3, cycles_pct=round(100.0 * g[3] / total, 1)) for g in top]

    # ---- where the frame goes ---------------------------------------------------------------------
    irq_cyc = sum(i["cyc"] for i in ins if i["irq"])
    out["interrupt_share"] = round(irq_cyc / total, 3)
    out["work_share"] = round(max(0.0, 1 - out["idle_spin_share"]), 3)
    cat = collections.Counter()
    for i in ins:
        c, addr = mode_of(i["mn"], i["op"])
        t = None
        if i["mn"] in BLOCK:
            t = "block_xfer"
        elif i["mn"] in ("ST0", "ST1", "ST2"):
            t = "vdc"
        elif addr is not None and c.startswith("abs") and addr < 0x2000:
            t = {0: "vdc", 1: "vdc", 2: "vdc", 3: "vdc"}.get(addr) or ("vce" if 0x400 <= addr <= 0x405 else "psg" if 0x800 <= addr <= 0x809 else "pad" if addr == 0x1000 else "io")
        if t:
            cat[t] += i["cyc"]
    out["io_cycles_pct"] = {k: round(100.0 * v / total, 1) for k, v in cat.most_common()}

    # ---- loops: the biggest, objects vs structure ----------------------------------------------------
    loop_rows.sort(key=lambda r: -r["cycles"])
    show = []
    for r in loop_rows:
        if (r["bank"], r["head"], r["tail"]) in spin_keys:
            continue
        if r["iters_per_run"] < 3:
            continue
        show.append(dict(span_bytes=r["span"], iters_per_run=r["iters_per_run"], cycles_per_iter=r["cycles_per_iter"], cycles_pct=round(100.0 * r["cycles"] / total, 1),
                         x_step=(r["x_steps"][0][0] if r["x_steps"] else None), indexed_bases=len(r["bases"]),
                         min_base_gap=(min(b - a for a, b in zip(r["bases"], r["bases"][1:])) if len(r["bases"]) > 1 else None)))
        if len(show) >= 8:
            break
    out["top_loops"] = show
    # shift-and-add loops of 8 or 16 iterations
    sm = [r for r in loop_rows if r["has_shift"] and r["has_add"] and round(r["iters_per_run"]) in (8, 16) and r["span"] <= 48]
    out["shift_add_loops"] = dict(count=len(sm), cycles_pct=round(100.0 * sum(r["cycles"] for r in sm) / total, 2))
    # strides: structure of arrays (step 1) vs array of structures (step > 1) among loops with indexed operands
    stride = collections.Counter()
    for r in loop_rows:
        if r["bases"] and r["iters_per_run"] >= 3 and r["x_steps"]:
            d = abs(r["x_steps"][0][0])
            stride["1" if d == 1 else "2-4" if 2 <= d <= 4 else "5+" if d >= 5 else "0"] += 1
    out["loop_x_stride"] = dict(stride)

    # ---- 16-bit arithmetic chains -------------------------------------------------------------------------
    chains = 0
    singles = 0
    for k in range(n):
        a = ins[k]
        if a["mn"] in ("ADC", "SBC"):
            c1, ad1 = mode_of(a["mn"], a["op"])
            singles += 1
            if ad1 is None:
                continue
            for j in range(k + 1, min(k + 7, n)):
                b = ins[j]
                if b["mn"] in ("CLC", "SEC"):
                    break
                if b["mn"] == a["mn"]:
                    c2, ad2 = mode_of(b["mn"], b["op"])
                    if ad2 is not None and ad2 == ad1 + 1 and c2 == c1:
                        chains += 1
                    elif c2 == "imm" and c1 == "imm":
                        chains += 1
                    break
    out["adc_sbc"] = dict(total=singles, sixteen_bit_chains=chains)
    # ---- VDC use ---------------------------------------------------------------------------------------------
    sel = None
    sel_hist = collections.Counter()
    data_words = collections.Counter()
    mawr_runs = 0
    in_run = False
    for i in ins:
        mnn, op = i["mn"], i["op"]
        port = None
        val = None
        if mnn == "ST0":
            port = 0
            mm = re.search(r"#\$([0-9A-Fa-f]+)", op)
            val = int(mm.group(1), 16) if mm else None
        elif mnn in ("ST1", "ST2"):
            port = 2 if mnn == "ST1" else 3
        elif mnn in ("STA", "STX", "STY", "STZ"):
            mm = re.match(r"^\$(0000|0002|0003)\b", op)
            if mm:
                port = int(mm.group(1), 16)
                val = {"STA": i["A"], "STX": i["X"], "STY": i["Y"], "STZ": 0}[mnn]
        if port is None:
            continue
        if port == 0 and val is not None:
            sel = val & 0x1F
            sel_hist[sel] += 1
        elif port == 3:  # the high byte completes a word
            data_words[sel] += 1
    out["vdc_selects"] = {"R%02X" % k_: v for k_, v in sel_hist.most_common(8)}
    out["vdc_words_by_reg"] = {("R%02X" % k_) if k_ is not None else "R??": v for k_, v in data_words.most_common(5)}
    out["sat_dma_registers_written"] = bool(sel_hist.get(0x13) or sel_hist.get(0x0F))
    out["vram_words_by_stores"] = data_words.get(0x02, 0)
    out["block_xfers_to_vdc"] = sum(1 for i in ins if i["mn"] in BLOCK and re.match(r"^\$[0-9A-Fa-f]{4},\$0002", i["op"].replace(" ", "")) is not None or (i["mn"] in BLOCK and ",$0002," in i["op"].replace(" ", "")))
    return out


def span_ok(row):
    return row["span"] <= 40


def capture(g, frames=1):
    g.tool("set_trace_log", {"enabled": True, "filters": ["cpu.instructions", "cpu.irqs"]})
    try:
        base = json.loads(g.tool("get_trace_log", {"count": 1, "start": -1}))["total_logged"]
    except Exception:
        base = 0
    g.tool("debug_step_frame", {"frames": frames, "mode": "sync"})
    d = json.loads(g.tool("get_trace_log", {"count": 1, "start": -1}))
    total = d["total_logged"]
    lines = []
    start = base
    while start < total:
        r = json.loads(g.tool("get_trace_log", {"count": 1000, "start": start}))
        lines += r["lines"]
        start = r["next_sequence"]
        if not r["lines"]:
            break
    g.tool("set_trace_log", {"enabled": False})
    return lines, d.get("overrun")


def summarize(d):
    """python3 -I tools/study-idioms.py --summarize DIR: one line per game from DIR/*.json (the files this tool wrote), median over
    its sample points, then the pooled medians.  Points where the CPU did almost nothing (a frozen title) are ignored."""
    import statistics

    def med(v):
        v = [x for x in v if x is not None]
        return round(statistics.median(v), 1) if v else None
    rows = []
    for f in sorted(os.listdir(d)):
        if not f.endswith(".json"):
            continue
        j = json.load(open(os.path.join(d, f)))
        pts = [p for p in j["points"] if p["instructions"] > 8000]
        if not pts:
            continue
        zp = med([p["zero_page_share_of_ram_operands"] for p in pts])
        ix = med([p["indexed_share_of_ram_operands"] for p in pts])
        calls = med([p["jsr"] + p["bsr"] for p in pts])
        ind = med([p["jmp_abs_x"] + p["jmp_abs_ind"] for p in pts])
        tam = med([sum(p["tam"].values()) for p in pts])
        blk = med([sum(v for k, v in p["huc6280"].items() if k in BLOCK) for p in pts])
        st = med([sum(v for k, v in p["huc6280"].items() if k in ("ST0", "ST1", "ST2")) for p in pts])
        busy = med([1 - p["idle_spin_share"] for p in pts])
        irq = med([p["interrupt_share"] for p in pts])
        ch = med([p["adc_sbc"]["sixteen_bit_chains"] * 100.0 / max(1, p["adc_sbc"]["total"]) for p in pts])
        rows.append((j["game"], dict(points=len(pts), busy=busy, irq=irq, zp_pct=zp, indexed_pct=ix, calls=calls, indirect_jmp=ind, tam=tam, block=blk, st012=st,
                                     sixteen_bit_pct=ch, mul_loops=med([p["shift_add_loops"]["count"] for p in pts]))))
    for g_, r in rows:
        print(g_, r)
    keys = rows[0][1].keys() if rows else []
    print("POOLED", {k: med([r[k] for _, r in rows]) for k in keys})


if __name__ == "__main__":
    if sys.argv[1] == "--summarize":
        summarize(sys.argv[2])
        sys.exit(0)
    rom, name, outp = sys.argv[1:4]
    points = int(sys.argv[4]) if len(sys.argv) > 4 else 4
    g = GG(rom)
    g.tool("debug_step_frame", {"frames": 240, "mode": "sync"})
    rows = []
    for k in range(1, points * 2 + 1):
        g.tool("controller_button", {"action": "press_and_release", "button": "run"})
        g.tool("debug_step_frame", {"frames": 60, "mode": "sync"})
        # a fixed pattern of presses (buttons, then directions) so a game that waits for I/II or a direction starts
        for j, b in enumerate(("i", "right", "ii", "down", "i", "left", "up", "ii")):
            g.tool("controller_button", {"action": "press_and_release", "button": b})
            g.tool("debug_step_frame", {"frames": 12 + 4 * (j % 3), "mode": "sync"})
        if k % 2 == 0:
            lines, over = capture(g, 1)
            a = analyse(parse(lines))
            if a:
                a["after_run_presses"] = k
                a["overrun"] = over
                rows.append(a)
    g.close()
    json.dump(dict(game=name, points=rows), open(outp, "w"))
    for a in rows:
        print(name, "presses", a["after_run_presses"], "| instr", a["instructions"], "| idle", a["idle_spin_share"], "| irq", a["interrupt_share"],
              "| zp%ram", a["zero_page_share_of_ram_operands"], "| jsr", a["jsr"], "bsr", a["bsr"], "| jmp(abs,x)", a["jmp_abs_x"], "| rts!=call", a["rts_not_returning_to_call"],
              "| tam", sum(a["tam"].values()), "| block", sum(v for k_, v in a["huc6280"].items() if k_ in BLOCK), "| shift-add", a["shift_add_loops"]["count"])
