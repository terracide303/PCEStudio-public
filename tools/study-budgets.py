#!/usr/bin/env python3
"""tools/study-budgets.py — the hardware budget of a real HuCard, per frame.

    python3 -I tools/study-budgets.py run ROM.pce NAME OUT.json
    python3 -I tools/study-budgets.py analyse OUT.json
    python3 -I tools/study-budgets.py --all DIR

run: starts ROM in Geargrafx (tools/ggmcp.py, docs/GEARGRAFX-MCP.md), drives it
with the fixed press pattern of tools/study-idioms.py (RUN, then I/right/II/
down/I/left/up/II), and at each point samples the console's state — the sprite
attribute table, the VCE palettes, the PSG, the VDC registers, the BAT map —
and records one frame of VDC register/DMA/interrupt trace; at two points it
also records one frame of CPU instruction trace, for the PSG and VCE write
counts and their spread across the frame's lines.  Then it plays on for two
stretches of 30 consecutive frames each, reading the SAT every frame, for the
per-line sprite counts and the flicker/multiplexing question.

OUT.json holds counts and ranges only; nothing from the ROM is stored (the
hard rule of docs/ENGINE-STUDY.md).  The traces land beside OUT.json as
NAME-pN-vdc.txt and NAME-pN-cpu.txt — put OUT.json in the scratch directory on
External II, never in the repository.

analyse: prints the counts per point and the min/typical/max per game.
--all DIR: the same pooled over every game's OUT.json, feeding the min/typical/
max tables of docs/HUCARD-BUDGETS.md.

Decoding follows the VDC manual as modelled by renderer/pce-sprites.js (the
project's own model): a SAT entry's top row is y - 64, its left column x - 32,
CGX doubles the width to 32, CGY picks 16/32/64/64 tall, and a display line
draws at most 16 sprite strips (a CGX sprite asks for two), later SAT entries
dropped.  The SATB register (VDC reg 19) says where the SAT lives in VRAM.
"""
import sys, json, re, os, glob, collections, statistics

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ggmcp import GG
# study-hucard.py has a hyphen, so it cannot be imported by name; load it by path
import importlib.util
_spec = importlib.util.spec_from_file_location("study_hucard",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "study-hucard.py"))
_study = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_study)
INS_LINE, analyse_cpu = _study.LINE, _study.analyse

FRAME_CLK = 358986       # master clocks per frame, as study-scene.py counts it
LINE_CLK = 1365          # master clocks per line (455 CPU cycles x 3); the frame
LINES = 263              # is 263 lines and the last one is shorter than 1365
CGY_HEIGHT = (16, 32, 64, 64)
PSG_PORTS = tuple(range(0x0800, 0x080C))   # channel select, data, volume, LFO
VCE_PORTS = tuple(range(0x0400, 0x0406))   # colour address and data
T = re.compile(r"@(\d+)")


def read_vram(g, area, off, size):
    out = b""
    while len(out) < size:
        n = min(4096, size - len(out))
        r = json.loads(g.tool("read_memory", {"area": area, "offset": "%04X" % (off + len(out) // 2), "size": n}))
        out += bytes.fromhex(r["data"].replace(" ", ""))
    return out


def decode_sat(b, keep=False):
    """512 bytes of SAT -> per-entry facts + the per-line counts."""
    entries = []
    for i in range(64):
        y = (b[i * 8] | (b[i * 8 + 1] << 8)) & 0x3FF
        x = (b[i * 8 + 2] | (b[i * 8 + 3] << 8)) & 0x3FF
        w2 = b[i * 8 + 4] | (b[i * 8 + 5] << 8)
        w3 = b[i * 8 + 6] | (b[i * 8 + 7] << 8)
        height = CGY_HEIGHT[(w3 >> 12) & 3]
        row0 = y - 64
        active = row0 < LINES and row0 + height > 0
        entries.append(dict(i=i, y=y, x=x, pattern=(w2 >> 1) & 0x3FF, pal=w3 & 0xF,
                            spbg=(w3 >> 7) & 1, cgx=(w3 >> 8) & 1, hflip=(w3 >> 11) & 1,
                            cgy=(w3 >> 12) & 3, vflip=(w3 >> 15) & 1,
                            w=32 if (w3 >> 8) & 1 else 16, h=height, row0=row0,
                            active=active))
    per_line_sprites = [0] * LINES
    per_line_strips = [0] * LINES
    for e in entries:
        if not e["active"]:
            continue
        lo = max(0, e["row0"])
        hi = min(LINES, e["row0"] + e["h"])
        for ln in range(lo, hi):
            per_line_sprites[ln] += 1
            per_line_strips[ln] += 2 if e["cgx"] else 1
    act = [e for e in entries if e["active"]]
    sizes = collections.Counter("%dx%d" % (e["w"], e["h"]) for e in act)
    out = dict(
        n_entries=64, n_active=len(act),
        n_parked=sum(1 for e in entries if not e["active"] and (e["y"] >= 0x1C0 or e["row0"] + e["h"] <= 0)),
        sizes=dict(sizes), palettes=sorted({e["pal"] for e in act}),
        patterns=len({e["pattern"] for e in act}), spbg=sum(e["spbg"] for e in act),
        max_line_sprites=max(per_line_sprites), max_line_strips=max(per_line_strips),
        lines_full=sum(1 for s in per_line_strips if s >= 16),
        lines_over=sum(1 for s in per_line_strips if s > 16),
        per_line=per_line_strips)
    if keep:
        out["entries"] = entries
    return out


def sample_state(g, full_vram=True):
    """The console's state right now: VDC registers, PSG, SAT, palettes, BAT, VRAM."""
    r = json.loads(g.tool("get_huc6270_registers"))
    regs = {k: int(v, 16) for k, v in r["registers"] if isinstance(k, int)}
    psg = json.loads(g.tool("get_psg_status"))["channels"]
    areas = {a["name"]: a["id"] for a in json.loads(g.tool("list_memory_areas"))["areas"]}
    satb = regs[19]
    sat = read_vram(g, areas["VRAM"], satb, 512)
    sprites = decode_sat(sat)
    pal = read_vram(g, areas["PALETTES"], 0, 1024)
    pal_words = [pal[i] | (pal[i + 1] << 8) for i in range(0, 1024, 2)]
    used = [sum(1 for j in range(16) if pal_words[i * 16 + j]) for i in range(32)]
    mwr = regs[9]
    w = (32, 64, 128, 128)[(mwr >> 4) & 3]
    h = 64 if (mwr & 0x40) else 32
    bat_base = 0x1000 if (mwr & 1) else 0
    bat = read_vram(g, areas["VRAM"], bat_base, w * h * 2)
    bat_words = [bat[i] | (bat[i + 1] << 8) for i in range(0, len(bat), 2)]
    vram_nonzero = None
    if full_vram:
        vram = read_vram(g, areas["VRAM"], 0, 65536)
        vram_nonzero = sum(1 for i in range(0, 65536, 2) if vram[i] | vram[i + 1])
    return dict(
        vdc=regs, bat_geometry=dict(mwr=mwr, width=w, height=h, base=bat_base,
                                    words=len(bat_words),
                                    distinct_patterns=len({t & 0x0FFF for t in bat_words}),
                                    distinct_palettes=len({t >> 12 for t in bat_words})),
        vram_nonzero_words=vram_nonzero,
        psg=dict(channels_enabled=sum(1 for c in psg if c["enabled"]),
                 noise=sum(1 for c in psg if c["noise"]), dda=sum(1 for c in psg if c["dda"]),
                 wave_indexes=sorted({c["wave_index"] for c in psg if c["enabled"]}),
                 frequencies=sorted({c["frequency"] for c in psg if c["enabled"] and c["frequency"]})),
        sprites=sprites,
        palettes=dict(bg_used=sum(1 for u in used[:16] if u), sp_used=sum(1 for u in used[16:] if u),
                      bg_entries=sum(used[:16]), sp_entries=sum(used[16:]),
                      distinct_colours=len({v for v in pal_words if v})))


def capture_trace(g, filters, frames=1):
    g.tool("set_trace_log", {"enabled": True, "filters": filters, "memory_size": "5M"})
    try:
        base = json.loads(g.tool("get_trace_log", {"count": 1, "start": -1}))["total_logged"]
    except Exception:
        base = 0
    g.tool("debug_step_frame", {"frames": frames, "mode": "sync"})
    d = json.loads(g.tool("get_trace_log", {"count": 1, "start": -1}))
    total = d["total_logged"]
    lines, start = [], base
    while start < total:
        r = json.loads(g.tool("get_trace_log", {"count": 1000, "start": start}))
        if not r["lines"]:
            break
        lines += r["lines"]
        start = r["next_sequence"]
    g.tool("set_trace_log", {"enabled": False})
    return lines, d.get("overrun")


def anchor_and_lines(events):
    """(frame anchor timestamp, per-event line number) — the first VBlank IRQ
    starts the frame; a line is 1365 master clocks."""
    anchor = next((t for t, _ in events if _ == "irq"), None)
    if anchor is None:
        anchor = events[0][0] if events else 0
    return anchor, [(max(0, t - anchor)) // LINE_CLK for t, _ in events]


def analyse_vdc(lines):
    events = []          # (timestamp, kind, payload)
    reg_writes = collections.Counter()
    for l in lines:
        m = T.search(l)
        if not m:
            continue
        t = int(m.group(1))
        if "[VDC1]" in l and "REG" in l:
            r = re.search(r"REG\s+(\w+)\(\$(\w+)\)\s+(LSB|MSB):\$(\w+)\s+Value:\$(\w+)", l)
            if r:
                events.append((t, ("reg", r.group(1), r.group(3),
                                   int(r.group(4), 16), int(r.group(5), 16))))
        elif "[VDC1]" in l and "DMA" in l:
            m2 = re.search(r"(\w+) DMA", l)
            src = re.search(r"Src:\$(\w+)", l)
            events.append((t, ("dma", m2.group(1) if m2 else "?", int(src.group(1), 16) if src else None)))
        elif "[CPU]" in l and "IRQ" in l:
            v = re.search(r"Vector:\$(\w+)", l)
            events.append((t, ("irq", int(v.group(1), 16) if v else None)))
    anchor, lines_of = anchor_and_lines(events)
    out = dict(events=len(events), anchor=anchor, irq=sum(1 for _, k in events if k == "irq"))
    regs = collections.Counter()
    vwr = mawr = rcr = cr = mwr = satb = dma_other = 0
    scroll = {}          # line -> (bxr, byr) replayed in write order
    bxr = byr = None
    per_line_writes = [0] * LINES
    rcr_values, cr_values, mwr_values = [], [], []
    bxr_values, byr_values = set(), set()
    for (t, k), ln in zip(events, lines_of):
        per_line_writes[min(ln, LINES - 1)] += 1
        if k[0] != "reg":
            if k[0] == "dma" and k[1] == "SATB":
                satb += 1
            elif k[0] == "dma":
                dma_other += 1
            continue
        _, name, half, byte, value = k
        regs[name] += 1
        if name == "VWR" and half == "LSB":
            vwr += 1
        elif name == "MAWR" and half == "LSB":
            mawr += 1
        elif name == "BXR":
            bxr = value
            if half == "MSB":
                bxr_values.add(value)
        elif name == "BYR":
            byr = value
            if half == "MSB":
                byr_values.add(value)
        elif name == "RCR" and half == "LSB":
            rcr += 1
            rcr_values.append(value)
        elif name == "CR" and half == "LSB":
            cr += 1
            cr_values.append(value)
        elif name == "MWR" and half == "LSB":
            mwr += 1
            mwr_values.append(value)
        if bxr is not None or byr is not None:
            scroll[ln] = (bxr, byr)
    # replay the scroll values across the lines they cover
    for ln in range(1, LINES):
        if ln not in scroll:
            scroll[ln] = scroll.get(ln - 1)
    pairs = {v for v in scroll.values() if v is not None}
    out.update(vram_words=vwr, mawr_writes=mawr, raster_cmp_writes=rcr,
               rcr_values=rcr_values[:12], cr_writes=cr, cr_values=cr_values[:8],
               mwr_writes=mwr, mwr_values=mwr_values, satb_dma=satb, dma_other=dma_other,
               reg_writes=dict(regs.most_common(12)),
               scroll_pairs=len(pairs), distinct_bxr=len(bxr_values),
               distinct_byr=len(byr_values), lines_with_reg_writes=sum(1 for n in per_line_writes if n),
               max_writes_in_a_line=max(per_line_writes))
    return out


def analyse_cpu_frame(lines):
    """One frame of cpu.instructions + cpu.irqs: instructions, interrupts, and
    the PSG/VCE/VDC stores with their line spread."""
    events = []
    for l in lines:
        m = T.search(l)
        if not m:
            continue
        events.append((int(m.group(1)), l))
    anchor = None
    for t, l in events:
        if "[CPU]" in l and "IRQ" in l:
            anchor = t
            break
    if anchor is None:
        anchor = events[0][0] if events else 0
    ins = []
    psg_lines = [0] * LINES
    vce_lines = [0] * LINES
    psg_w = vce_w = st0 = st1 = st2 = 0
    for t, l in events:
        m = INS_LINE.match(l)
        if not m:
            continue
        ins.append(l)
        mn = m.group(10).split()[0]
        addr = m.group(10).split()
        ln = min(max(0, t - anchor) // LINE_CLK, LINES - 1)
        if mn in ("STA", "STX", "STY", "STZ") and len(addr) > 1 and addr[1].startswith("$"):
            tok = addr[1].split(",")[0].rstrip(")")
            if tok[1:].strip() and all(c in "0123456789abcdefABCDEF" for c in tok[1:]):
                a = int(tok[1:], 16)
                if PSG_PORTS[0] <= a <= PSG_PORTS[-1]:
                    psg_w += 1
                    psg_lines[ln] += 1
                elif VCE_PORTS[0] <= a <= VCE_PORTS[-1]:
                    vce_w += 1
                    vce_lines[ln] += 1
        elif mn == "ST0":
            st0 += 1
        elif mn == "ST1":
            st1 += 1
        elif mn == "ST2":
            st2 += 1
    a = analyse_cpu(ins)
    bursts = 0
    for arr in (psg_lines, vce_lines):
        in_run = False
        for n in arr:
            if n and not in_run:
                bursts += 1
            in_run = bool(n)
    return dict(instructions=a["instr"], cycles=round(a["cycles"] / 3),
                idle_spin_share=a["spin_share"], interrupts=a["rti"], jsr=a["jsr"],
                tam=sum(a["tam"].values()) + a["tma"], st0=st0, st1=st1, st2=st2,
                vdc_data_by_reg=a["vdc_data_writes_by_reg"],
                psg_writes=psg_w, vce_writes=vce_w,
                psg_lines_with_writes=sum(1 for n in psg_lines if n),
                vce_lines_with_writes=sum(1 for n in vce_lines if n),
                psg_max_in_a_line=max(psg_lines), vce_max_in_a_line=max(vce_lines),
                write_bursts=bursts)


def press_round(g, run=True):
    """The fixed drive pattern of tools/study-idioms.py: RUN, then buttons and
    directions, so a game that waits for I/II or a direction starts."""
    if run:
        g.tool("controller_button", {"action": "press_and_release", "button": "run"})
    g.tool("debug_step_frame", {"frames": 60, "mode": "sync"})
    for j, b in enumerate(("i", "right", "ii", "down", "i", "left", "up", "ii")):
        g.tool("controller_button", {"action": "press_and_release", "button": b})
        g.tool("debug_step_frame", {"frames": 12 + 4 * (j % 3), "mode": "sync"})


def sample_sat_frame(g, regs, areas=None, keep=False):
    if areas is None:
        areas = {a["name"]: a["id"] for a in json.loads(g.tool("list_memory_areas"))["areas"]}
    b = read_vram(g, areas["VRAM"], regs[19], 512)
    return decode_sat(b, keep)


def run(rom, name, outp):
    if os.path.exists(outp) and os.path.getsize(outp) > 100:
        print(name, "already done ->", outp)
        return
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except Exception:
        pass
    g = GG(rom)
    try:
        try:                                  # step the boring frames at speed
            g.tool("toggle_fast_forward", {"enabled": True})
            try:
                g.tool("set_fast_forward_speed", {"speed": 4})
            except Exception:
                pass
        except Exception:
            pass
        g.tool("debug_step_frame", {"frames": 240, "mode": "sync"})
        points = []
        base = os.path.splitext(outp)[0]
        for k in range(1, 9):
            press_round(g)
            st = sample_state(g, full_vram=(k % 2 == 0))
            row = dict(after_run_presses=k, state=st)
            if k in (2, 4, 6, 8):
                lines, over = capture_trace(g, ["vdc.registers", "vdc.dma", "cpu.irqs"])
                row["vdc_trace"] = analyse_vdc(lines)
                row["vdc_trace"]["events_logged"] = len(lines)
                row["vdc_trace"]["overrun"] = over
                with open("%s-p%d-vdc.txt" % (base, k), "w") as f:
                    f.write("\n".join(lines))
            if k in (4, 8):
                lines, over = capture_trace(g, ["cpu.instructions", "cpu.irqs"])
                row["cpu"] = analyse_cpu_frame(lines)
                row["cpu"]["overrun"] = over
                with open("%s-p%d-cpu.txt" % (base, k), "w") as f:
                    f.write("\n".join(lines))
            points.append(row)
            json.dump(dict(game=name, rom_size=os.path.getsize(rom),
                           banks=os.path.getsize(rom) // 8192, points=points,
                           play_stretch=[]), open(outp, "w"), indent=1)
            print(name, "press", k, "| sprites", st["sprites"]["n_active"],
                  "sizes", st["sprites"]["sizes"], "| max line",
                  st["sprites"]["max_line_strips"], "| pal BG", st["palettes"]["bg_used"],
                  "SP", st["palettes"]["sp_used"], "| psg on", st["psg"]["channels_enabled"],
                  "| bat", "%dx%d" % (st["bat_geometry"]["width"], st["bat_geometry"]["height"]),
                  "pats", st["bat_geometry"]["distinct_patterns"], "| vram", st["vram_nonzero_words"],
                  "| vdc wr", row["vdc_trace"]["vram_words"] if "vdc_trace" in row else "-",
                  "splits", row["vdc_trace"]["raster_cmp_writes"] if "vdc_trace" in row else "-",
                  "| psg wr", row["cpu"]["psg_writes"] if "cpu" in row else "-",
                  "vce wr", row["cpu"]["vce_writes"] if "cpu" in row else "-")
        # the play stretch: two runs of 30 consecutive frames of SAT, for the
        # per-line limit and flicker question
        regs = points[-1]["state"]["vdc"]
        areas = {a["name"]: a["id"] for a in json.loads(g.tool("list_memory_areas"))["areas"]}
        stretch = []
        g.tool("controller_button", {"action": "press_and_release", "button": "run"})
        g.tool("debug_step_frame", {"frames": 300, "mode": "sync"})
        for block in (1, 2):
            frames = []
            for i in range(30):
                g.tool("debug_step_frame", {"frames": 1, "mode": "sync"})
                frames.append(sample_sat_frame(g, regs, areas, keep=True))
            prev = None
            changed = []
            for f in frames:
                if prev is not None:
                    ch = 0
                    for i in range(64):
                        e0, e1 = prev["entries"][i], f["entries"][i]
                        if (e0["y"], e0["x"], e0["pattern"]) != (e1["y"], e1["x"], e1["pattern"]):
                            ch += 1
                    changed.append(ch)
                prev = f
            full = sum(1 for f in frames if f["lines_full"])
            # which entries serve the busiest line, over the whole block (a
            # round-robin flicker would rotate this set from frame to frame)
            busiest = max(range(LINES), key=lambda ln: max(f["per_line"][ln] for f in frames))
            serving = set()
            for f in frames:
                for e in f["entries"]:
                    if e["active"] and e["row0"] <= busiest < e["row0"] + e["h"]:
                        serving.add(e["i"])
            stretch.append(dict(block=block, frames=30,
                                n_active_min=min(f["n_active"] for f in frames),
                                n_active_max=max(f["n_active"] for f in frames),
                                max_line_strips=max(f["max_line_strips"] for f in frames),
                                max_line_sprites=max(f["max_line_sprites"] for f in frames),
                                frames_with_full_line=full,
                                busiest_line=busiest,
                                entries_serving_busiest_line=sorted(serving),
                                mean_sat_changes_between_frames=round(statistics.mean(changed), 1) if changed else 0,
                                size_hist=dict(collections.Counter(s for f in frames for s in f["sizes"]))))
            print(name, "stretch", block, "| active", stretch[-1]["n_active_min"], "-",
                  stretch[-1]["n_active_max"], "| max line", stretch[-1]["max_line_strips"],
                  "| frames full", full, "of 30 | sat churn", stretch[-1]["mean_sat_changes_between_frames"],
                  "| line", busiest, "served by", len(serving), "entries")
            if block == 1:
                g.tool("debug_step_frame", {"frames": 600, "mode": "sync"})
        json.dump(dict(game=name, rom_size=os.path.getsize(rom),
                       banks=os.path.getsize(rom) // 8192, points=points,
                       play_stretch=stretch), open(outp, "w"), indent=1)
    finally:
        g.close()


def analyse_one(outp):
    j = json.load(open(outp))
    print("== %s: %d bytes, %d banks" % (j["game"], j["rom_size"], j["banks"]))
    for p in j["points"]:
        st = p["state"]
        print(" press %d | sprites %d (sizes %s) | max line %d strips, %d full lines | pal BG %d SP %d | psg on %d noise %d dda %d waves %s | bat %dx%d %d pats | vram %d words |"
              % (p["after_run_presses"], st["sprites"]["n_active"], st["sprites"]["sizes"],
                 st["sprites"]["max_line_strips"], st["sprites"]["lines_full"],
                 st["palettes"]["bg_used"], st["palettes"]["sp_used"],
                 st["psg"]["channels_enabled"], st["psg"]["noise"], st["psg"]["dda"], st["psg"]["wave_indexes"],
                 st["bat_geometry"]["width"], st["bat_geometry"]["height"],
                 st["bat_geometry"]["distinct_patterns"], st["vram_nonzero_words"]))
        if "vdc_trace" in p:
            v = p["vdc_trace"]
            print("   vdc: %d events, %d VRAM words, %d MAWR, splits %d, scroll pairs %d (bxr %d, byr %d), SATB %d, CR %d %s, regs %s"
                  % (v["events_logged"], v["vram_words"], v["mawr_writes"], v["raster_cmp_writes"],
                     v["scroll_pairs"], v["distinct_bxr"], v["distinct_byr"], v["satb_dma"],
                     v["cr_writes"], v["cr_values"], v["reg_writes"]))
        if "cpu" in p:
            c = p["cpu"]
            print("   cpu: %d instr, %d cyc, idle %.0f%%, irq %d, jsr %d, tam %d, st0 %d st1 %d st2 %d, psg %d writes on %d lines (max %d), vce %d writes on %d lines (max %d), bursts %d"
                  % (c["instructions"], c["cycles"], 100 * c["idle_spin_share"], c["interrupts"], c["jsr"],
                     c["tam"], c["st0"], c["st1"], c["st2"], c["psg_writes"], c["psg_lines_with_writes"],
                     c["psg_max_in_a_line"], c["vce_writes"], c["vce_lines_with_writes"], c["vce_max_in_a_line"],
                     c["write_bursts"]))
    for s in j["play_stretch"]:
        print(" stretch %d: active %d-%d, max line %d strips (%d sprites), %d/30 frames hit the 16-strip line limit, churn %.1f SAT entries/frame, sizes %s"
              % (s["block"], s["n_active_min"], s["n_active_max"], s["max_line_strips"], s["max_line_sprites"],
                 s["frames_with_full_line"], s["mean_sat_changes_between_frames"], s["size_hist"]))


def med(v):
    v = [x for x in v if x is not None]
    return round(statistics.median(v), 1) if v else None


def pool(outps):
    rows = []
    for o in outps:
        j = json.load(open(o))
        sts = [p["state"] for p in j["points"]]
        vdcs = [p["vdc_trace"] for p in j["points"] if "vdc_trace" in p]
        cpus = [p["cpu"] for p in j["points"] if "cpu" in p]
        rows.append((j["game"], j["rom_size"], j["banks"], sts, vdcs, cpus, j["play_stretch"]))
    print("game | size banks | sprites min/med/max | max-line min/med/max | pal BG/SP | psg on | bat | vram")
    for name, size, banks, sts, vdcs, cpus, stre in rows:
        sp = [s["sprites"]["n_active"] for s in sts]
        ml = [s["sprites"]["max_line_strips"] for s in sts] + [x["max_line_strips"] for x in stre]
        full = [x["frames_with_full_line"] for x in stre]
        print("%s | %d %d | %d/%s/%d | %d/%s/%d | %s/%s | %s | %s | %s | full %s" %
              (name, size, banks, min(sp), med(sp), max(sp), min(ml), med(ml), max(ml),
               med([s["palettes"]["bg_used"] for s in sts]), med([s["palettes"]["sp_used"] for s in sts]),
               med([s["psg"]["channels_enabled"] for s in sts]),
               sorted({(s["bat_geometry"]["width"], s["bat_geometry"]["height"]) for s in sts}),
               med([s["vram_nonzero_words"] for s in sts]), full))
    return rows


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--all":
        paths = []
        for a in sys.argv[2:]:
            paths += [a] if os.path.isfile(a) else sorted(glob.glob(os.path.join(a, "*.json")))
        pool(paths)
    elif len(sys.argv) >= 4 and sys.argv[1] == "run":
        run(sys.argv[2], sys.argv[3], sys.argv[4])
    elif len(sys.argv) == 3 and sys.argv[1] == "analyse":
        analyse_one(sys.argv[2])
    else:
        sys.exit(__doc__)
