#!/usr/bin/env python3
"""raster-patch.py — fold a raster ROM's runtime state into the dump's raster.json.

#15 evidence pipeline step, run by capture.sh after mcs-extract.py: the
renderer's raster table (tools/gen/rasterN.raster.json, written by
genroms.py at build time) describes the ROM's per-scanline writes, but a
table with the frame-counter flag has values that depend on a runtime
counter (ZP <$31>, bumped once per chain), which the save state carries in
the HuC6280 RAM (ram.bin).  This script rewrites such a table's entries
with the values the captured frame actually wrote (cram) and the previous
frame's values (cramPrev) — the pair the renderer needs for the colour
table's cross-frame persistence — and records the counter in the note.
Every CRAM word in a step gets the same per-frame add, so the fold is
applied to every word of every entry (r4 writes one word, r11 two — the
#68 / REVIEW-16 B15 combination).  For a table without the counter flag it
only asserts that the chain is at the step the save line implies (ZP <$30> step
# counter vs the entries fired so far: every entry whose line <= RCRCount
# has fired, so a scene whose last entry fires after the save line — r5's
# line 240 — sits at step 2, not wrapped; the capture is in steady state
# either way).  #16's viewer runs the same chain from the same BaseRAM
# cells (step [0x30], counter [0x31]), so the scene names cover the viewer
# captures too; effect1 is the editor's table (no counter, every entry
# fires before the save).  The viewer chain bumps the counter at the wrap
# — after the last entry's writes — so a viewer capture's saved colour
# table carries the previous frame's counter: capture.sh passes the scene
# name with a "v" suffix for viewer captures and the fold below uses
# counter-1 for them (the #15 r4 chain bumps at its step-0 fire, before
# the frame's first write, so its table carries the counter itself).  The
# counter is a 5-bit value (`and #$1f`), so a save right after a 31 -> 0
# wrap folds 31, not -1.

usage: raster-patch.py DUMPDIR SCENE   (SCENE = 1..11 [v], or effect1)
"""

import json
import os
import sys


def main():
    if len(sys.argv) != 3:
        print(f"usage: {sys.argv[0]} DUMPDIR SCENE", file=sys.stderr)
        return 2
    dumpdir, scene = sys.argv[1], sys.argv[2]
    viewer = scene.endswith("v")
    if viewer:
        scene = scene[:-1]
    jpath = os.path.join(dumpdir, "raster.json")
    raster = json.load(open(jpath))
    # ZP logical $2030/$2031 maps onto the RAM base through MPR1 (the 8KB
    # RAM lives at $F80000, mirrored at $FFE000): BaseRAM[0x30]/[0x31] —
    # mcs-extract.py writes ram.bin from the save state's MAIN.BaseRAM record
    ram = open(os.path.join(dumpdir, "ram.bin"), "rb").read()
    step, counter = ram[0x30], ram[0x31]
    if not raster.get("frameCounter"):
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
        print(f"{jpath}: frame-counter chain not wrapped at save "
              f"(step={step})", file=sys.stderr)
        return 1
    if counter >= 32:
        print(f"{jpath}: frame counter {counter} out of range",
              file=sys.stderr)
        return 1
    # The frame the saved table was written with: the #15 scene chains bump
    # the counter at their step-0 fire (before the frame's writes), the
    # viewer bumps it at the wrap (after the last write) — so a viewer save's
    # cell is one ahead of the table.  The add is a 5-bit value and the
    # table's own entries are the base the ROM adds to, so every CRAM word
    # (r4's one, r11's two) is folded the same way.
    frame = (counter - (1 if viewer else 0)) & 0x1F
    prev = (frame - 1) & 0x1F
    for e in raster["entries"]:
        cram = e.get("cram") or []
        e["cram"] = [[a, (v + frame) & 0x1FF] for (a, v) in cram]
        e["cramPrev"] = [[a, (v + prev) & 0x1FF] for (a, v) in cram]
    raster["note"] += (f"; frame counter at save: {counter} (ZP <$31> = "
                       "ram.bin[0x31]) — cram = this frame's value "
                       f"(counter {frame}), cramPrev = the previous frame's "
                       f"({prev})"
                       + (", the viewer's wrap-bump deferred by one frame"
                          if viewer else ""))
    json.dump(raster, open(jpath, "w"), indent=1, sort_keys=True)
    print(f"patched {jpath}: frame counter {counter}"
          + (f" (viewer fold: {frame})" if viewer else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
