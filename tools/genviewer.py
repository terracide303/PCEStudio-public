#!/usr/bin/env python3
"""genviewer.py — build the picture-data banks for the #8 viewer ROM.

    python3 -I genviewer.py 1|2|3

Takes #5's sample data (tests/dumps/sceneN/{vram.bin,cram.bin,regs.json} —
the same dumps the renderer diff test reads) and lays it out at the fixed
places docs/ROM_LAYOUT.md defines, so `viewer.asm` finds it:

  gen/viewerN/config.bin   64-byte config block (BXR/BYR/MWR/CR + regions)
  gen/viewerN/palette.bin  512 bytes = VCE entries 0-255 (16 BG palettes)
  gen/viewerN/bat.bin      the BAT: 2 x (width x height) bytes from VRAM 0
  gen/viewerN/tiles.bin    the tile regions, concatenated in descriptor order
  gen/viewerN/viewerN.asm  includes viewer.asm + the data banks (.incbin)

The tile regions are the same ones genroms.py wrote for the scene ROMs
(SCENES[scene]["tiles"]), now read back out of the dump's vram.bin — the
viewer shows the sample data, not a regenerated copy of it.

This script is tooling for #8's evidence; the viewer itself knows none of
this — it follows the config block.
"""

import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)          # -I does not add the script's dir
from genroms import SCENES

OUT = os.path.join(HERE, "gen")

# ROM_LAYOUT.md, bank 1, offsets in bytes
CONFIG_SIZE = 64
CFG_VERSION = 0
CFG_BXR = 2
CFG_BYR = 4
CFG_MWR = 6
CFG_CR = 7
CFG_RGNS = 8
CFG_REG0 = 0x0A
REG_SIZE = 4
MAX_REGIONS = 8
PALETTE_OFFSET = 0x40          # 256 words, LE


def bat_words(mwr):
    width = [32, 64, 128, 128][(mwr >> 4) & 3]
    height = 64 if mwr & 0x40 else 32
    return width * height


def build(scene):
    name = f"viewer{scene}"
    dumpdir = os.path.join(HERE, "..", "tests", "dumps", f"scene{scene}")
    with open(os.path.join(dumpdir, "regs.json")) as f:
        regs = json.load(f)
    with open(os.path.join(dumpdir, "vram.bin"), "rb") as f:
        vram = f.read()
    with open(os.path.join(dumpdir, "cram.bin"), "rb") as f:
        cram = f.read()
    assert len(vram) == 65536 and len(cram) == 1024, (len(vram), len(cram))

    bxr, byr, mwr, cr = regs["BXR"], regs["BYR"], regs["MWR"], regs["CR"]
    words = bat_words(mwr)

    regions = []
    for char0, count in SCENES[scene]["tiles"]:
        dest = char0 * 16
        if dest >= 32768:
            # matches the renderer model (and the scene ROMs): VRAM writes
            # beyond 32768 words are dropped, so the viewer does not load
            # these tiles either
            continue
        regions.append((dest, count * 16))
    assert len(regions) <= MAX_REGIONS, regions

    # config block
    cfg = bytearray(CONFIG_SIZE)
    cfg[CFG_VERSION] = 1
    cfg[CFG_BXR:CFG_BXR + 2] = struct.pack("<H", bxr)
    cfg[CFG_BYR:CFG_BYR + 2] = struct.pack("<H", byr)
    cfg[CFG_MWR] = mwr
    cfg[CFG_CR] = cr
    cfg[CFG_RGNS] = len(regions)
    for r, (dest, count) in enumerate(regions):
        off = CFG_REG0 + r * REG_SIZE
        cfg[off:off + 2] = struct.pack("<H", dest)
        cfg[off + 2:off + 4] = struct.pack("<H", count)

    # palette: VCE entries 0-255 (the 16 BG palettes the picture uses)
    palette = cram[:512]

    # BAT: words 0..words-1 of VRAM
    bat = vram[:words * 2]

    # tiles: the regions, concatenated in descriptor order
    tiles = bytearray()
    for dest, count in regions:
        tiles += vram[dest * 2:(dest + count) * 2]

    outdir = os.path.join(OUT, name)
    os.makedirs(outdir, exist_ok=True)
    with open(os.path.join(outdir, "config.bin"), "wb") as f:
        f.write(cfg)
    with open(os.path.join(outdir, "palette.bin"), "wb") as f:
        f.write(palette)
    with open(os.path.join(outdir, "bat.bin"), "wb") as f:
        f.write(bat)
    with open(os.path.join(outdir, "tiles.bin"), "wb") as f:
        f.write(tiles)

    # the asm: viewer.asm (bank 0) + the data banks at the fixed places.
    # BAT and tiles are split into 8 KiB banks so the .incbins never spill
    # past a bank boundary (pceas -raw would pad/truncate silently).
    BANK = 8 * 1024
    assert len(bat) <= 2 * BANK, len(bat)
    assert len(tiles) <= 6 * BANK, len(tiles)
    bat_banks = (len(bat) + BANK - 1) // BANK
    tiles_banks = max(1, (len(tiles) + BANK - 1) // BANK)
    for i in range(bat_banks):
        with open(os.path.join(outdir, f"bat{i}.bin"), "wb") as f:
            f.write(bat[i * BANK:(i + 1) * BANK])
    for i in range(tiles_banks):
        with open(os.path.join(outdir, f"tiles{i}.bin"), "wb") as f:
            f.write(tiles[i * BANK:(i + 1) * BANK])

    rel = f"gen/{name}"
    banks = [f"""\
        .data
        .bank 1
        .org $4000
        .incbin "{rel}/config.bin"
        .org $4040
        .incbin "{rel}/palette.bin"
"""]
    for i in range(bat_banks):
        banks.append(f"""\
        .data
        .bank {2 + i}
        .org $4000
        .incbin "{rel}/bat{i}.bin"
""")
    for i in range(tiles_banks):
        banks.append(f"""\
        .data
        .bank {4 + i}
        .org $4000
        .incbin "{rel}/tiles{i}.bin"
""")
    asm = f"""\
;; PCEStudio viewer {scene} — generated by tools/genviewer.py, do not edit.
;; Data for #5's scene {scene} at the fixed places of docs/ROM_LAYOUT.md.
        .include "viewer.asm"
""" + "".join(banks)
    with open(os.path.join(OUT, f"viewer{scene}.asm"), "w") as f:
        f.write(asm)
    print(f"wrote {rel}/{{config,palette,bat,tiles}}.bin and "
          f"gen/viewer{scene}.asm "
          f"(BXR={bxr}, BYR={byr}, MWR=${mwr:02x}, CR=${cr:02x}, "
          f"BAT {words} words, {len(regions)} tile regions, "
          f"tiles {len(tiles)} B)")


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in "123":
        print(f"usage: {sys.argv[0]} 1|2|3", file=sys.stderr)
        return 2
    os.makedirs(OUT, exist_ok=True)
    build(int(sys.argv[1]))


if __name__ == "__main__":
    sys.exit(main())
