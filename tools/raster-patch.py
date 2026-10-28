#!/usr/bin/env python3
"""raster-patch.py — fold a raster ROM's runtime state into the dump's raster.json.

#15 evidence pipeline step, run by capture.sh after mcs-extract.py: the
renderer's raster table (tools/gen/rasterN.raster.json, written by
genroms.py at build time) describes the ROM's per-scanline writes, but r4's
values depend on a runtime frame counter (ZP <$31>, bumped once per chain),
which the save state carries in the HuC6280 RAM (ram.bin).  This script
rewrites raster.json's r4 entries with the values the captured frame
actually wrote (cram) and the previous frame's values (cramPrev) — the
pair the renderer needs for the colour table's cross-frame persistence —
and records the counter in the note.  For the other scenes it only asserts
# that the chain is at the step the save line implies (ZP <$30> step
# counter vs the entries fired so far: every entry whose line <= RCRCount
# has fired, so a scene whose last entry fires after the save line — r5's
# line 240 — sits at step 2, not wrapped; the capture is in steady state
# either way).

usage: raster-patch.py DUMPDIR SCENE   (SCENE = 1..5)
"""

import json
import os
import sys


def grad(s):
    """r4's per-entry colour value, genroms.py's raster_grad."""
    return ((s * 13 + 0x40) & 0x1FF)


def main():
    if len(sys.argv) != 3:
        print(f"usage: {sys.argv[0]} DUMPDIR SCENE", file=sys.stderr)
        return 2
    dumpdir, scene = sys.argv[1], sys.argv[2]
    jpath = os.path.join(dumpdir, "raster.json")
    raster = json.load(open(jpath))
    # ZP logical $2030/$2031 maps onto the RAM base through MPR1 (the 8KB
    # RAM lives at $F80000, mirrored at $FFE000): BaseRAM[0x30]/[0x31] —
    # mcs-extract.py writes ram.bin from the save state's MAIN.BaseRAM record
    ram = open(os.path.join(dumpdir, "ram.bin"), "rb").read()
    step, counter = ram[0x30], ram[0x31]
    if scene != "4":
        # the save lands at VDW line 237 (RCRCount=237).  Entries whose line
        # is <= that have fired (each firing advances the step, wrapping at
        # n); r5's last entry fires at line 240 — after the save — so its
        # chain is at step 2, not wrapped
        expected = 0
        if scene == "5":
            regs = json.load(open(os.path.join(dumpdir, "regs.json")))
            rcr = regs["RCRCount"]
            n = len(raster["entries"])
            expected = (sum(1 for e in raster["entries"] if e["line"] <= rcr)
                        % n)
        if step != expected:
            print(f"{jpath}: chain step at save is {step}, expected "
                  f"{expected}", file=sys.stderr)
            return 1
        print(f"{jpath}: chain step at save is {step} (expected "
              f"{expected}), no patch needed")
        return 0
    if step != 0:
        print(f"{jpath}: r4 chain not wrapped at save (step={step})",
              file=sys.stderr)
        return 1
    if counter >= 32:
        print(f"{jpath}: r4 frame counter {counter} out of range",
              file=sys.stderr)
        return 1
    for e in raster["entries"]:
        s, _ = e["cram"][0]
        cur = (grad(s) + counter) & 0x1FF
        prev = (grad(s) + counter - 1) & 0x1FF
        e["cram"] = [[s, cur]]
        e["cramPrev"] = [[s, prev]]
    raster["note"] += (f"; r4 frame counter at save: {counter} (ZP <$31> = "
                       "ram.bin[0x31]) — cram = this frame's value, "
                       "cramPrev = the previous frame's")
    json.dump(raster, open(jpath, "w"), indent=1, sort_keys=True)
    print(f"patched {jpath}: frame counter {counter}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
