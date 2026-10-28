#!/usr/bin/env python3
"""genviewer.py — build the picture-data banks for the #8/#14 viewer ROM.

    python3 -I genviewer.py 1|2|3|7|10
    python3 -I genviewer.py vsprite1..vsprite12

Takes a picture's sample data (tests/dumps/sceneN or spriteN/
{vram.bin,cram.bin,regs.json,regions.json} — the same dumps the renderer
diff tests read) and lays it out at the fixed places docs/ROM_LAYOUT.md
defines, so `viewer.asm` finds it:

  gen/NAME/config.bin   64-byte config block (BXR/BYR/MWR/CR + regions)
  gen/NAME/palette.bin  1024 bytes = VCE entries 0-511 (BG + sprite palettes)
  gen/NAME/bat.bin      the BAT: 2 x (width x height) bytes from VRAM 0
  gen/NAME/tiles.bin    the copy regions, concatenated in descriptor order
                        (the tile regions; for the sprite scenes the region
                        list also carries the SG pattern block at VRAM
                        $2000)
  gen/NAME/sat.bin      512 bytes = the SAT (64 entries x 4 words) from
                        VRAM $7f00, the source of the SATB DMA (card #14)
  gen/NAME/NAME.asm     includes viewer.asm + the data banks (.incbin)

The copy regions come from tests/dumps/<dir>/regions.json — the same file
renderer/pce-rom.js reads for #9's browser export, so both builders lay out
the same picture from the same description.  The data itself is read back
out of the dump's vram.bin: the viewer shows the sample data, not a
regenerated copy of it.

This script is tooling for #8's and #14's evidence; the viewer itself knows
none of this — it follows the config block.
"""

import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

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
# 13 descriptors fit between CFG_REG0 and the palette at 0x40 (#46: was 8).
MAX_REGIONS = 13
PALETTE_OFFSET = 0x40          # 512 words, LE (entries 0-511)
SAT_OFFSET = 0x440             # 256 words, LE (64 SAT entries x 4) — #14
SAT_ADDR = 0x7F00              # the SAT's VRAM word address (DVSSR)

# PCEAS 3.23's own limit, not the hardware's: `.bank` refuses an index above
# 0x7F (huc-src/src/mkit/as/main.c `bank_limit = 0x7F`), so this path can
# assemble 128 x 8 KiB = 1 MB.  The HuC6280 itself maps 256 blocks of
# physical address space = 2 MB (hardware manual H8-7, H8-10/11;
# docs/MANUALS.md §5.1) — renderer/pce-rom.js builds up to that, with no
# PCEAS reference above 1 MB.
PCEAS_MAX_BANKS = 128


def bat_words(mwr):
    width = [32, 64, 128, 128][(mwr >> 4) & 3]
    height = 64 if mwr & 0x40 else 32
    return width * height


def load_regions(dumpdir):
    """The picture's tile regions, as [char0, count] pairs in descriptor order.

    This file is picture data, not tooling: renderer/pce-rom.js reads the same
    one for the browser export (#9).  See docs/ROM_LAYOUT.md.
    """
    with open(os.path.join(dumpdir, "regions.json")) as f:
        doc = json.load(f)
    return [(int(char0), int(count)) for char0, count in doc["tile_regions"]]


def build(spec):
    """spec: '1'..'3' -> viewerN from tests/dumps/sceneN; 'vspriteN' ->
    vspriteN from tests/dumps/spriteN (#14: the #12 sprite scenes)."""
    if spec.startswith("vsprite"):
        name = spec
        dumpdir = os.path.join(HERE, "..", "tests", "dumps",
                               f"sprite{spec[len('vsprite'):]}")
    else:
        name = f"viewer{spec}"
        dumpdir = os.path.join(HERE, "..", "tests", "dumps", f"scene{spec}")
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
    for char0, count in load_regions(dumpdir):
        dest = char0 * 16
        if dest >= 32768:
            # matches the renderer model (and the scene ROMs): VRAM writes
            # beyond 32768 words are dropped, so the viewer does not load
            # these tiles either
            continue
        if dest + count * 16 > 32768:
            # starts inside VRAM but runs past it: slicing would truncate the
            # data while the descriptor still promises the full length, so the
            # viewer would read the next region's bytes as this one's tail.
            # renderer/pce-rom.js refuses the same input; docs/EXPORT.md.
            raise ValueError(
                f"region [{char0}, {count}]: words {dest}..{dest + count * 16} "
                f"run past the 32768-word VRAM")
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

    # palette: VCE entries 0-511 (the 16 BG palettes and the 16 sprite
    # palettes the picture uses)
    palette = cram[:1024]

    # BAT: words 0..words-1 of VRAM
    bat = vram[:words * 2]

    # tiles: the regions, concatenated in descriptor order
    tiles = bytearray()
    for dest, count in regions:
        tiles += vram[dest * 2:(dest + count) * 2]

    # SAT: 64 entries x 4 words at VRAM $7f00 (DVSSR) — the SATB DMA source
    # the viewer re-creates (card #14, docs/ROM_LAYOUT.md)
    sat = vram[SAT_ADDR * 2:SAT_ADDR * 2 + 512]

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
    with open(os.path.join(outdir, "sat.bin"), "wb") as f:
        f.write(sat)

    # the asm: viewer.asm (bank 0) + the data banks at the fixed places.
    # BAT and tiles are split into 8 KiB banks so the .incbins never spill
    # past a bank boundary (pceas -raw would pad/truncate silently).  #46:
    # there is no 6-tile-bank cap any more — banks 4..127 are the regions,
    # streamed through the viewer's 8 KiB MPR2 window (viewer.asm
    # copy_words re-maps the bank on every $6000 crossing), up to what
    # PCEAS 3.23 itself can assemble.  Beyond that this path refuses; the
    # browser builder (renderer/pce-rom.js) goes to the hardware's 2 MB.
    BANK = 8 * 1024
    assert len(bat) <= 2 * BANK, len(bat)
    bat_banks = (len(bat) + BANK - 1) // BANK
    tiles_banks = max(1, (len(tiles) + BANK - 1) // BANK)
    if 4 + tiles_banks > PCEAS_MAX_BANKS:
        raise ValueError(
            f"pceas-bank-limit: {4 + tiles_banks} banks of 8 KiB "
            f"({(4 + tiles_banks) * BANK} bytes); PCEAS 3.23 assembles at "
            f"most {PCEAS_MAX_BANKS} banks (1 MB) because its .bank index "
            f"stops at 0x7F. The HuC6280's 2 MB physical limit "
            f"(256 banks, docs/MANUALS.md §5.1) has no PCEAS reference: "
            f"build that with renderer/pce-rom.js")
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
        .org $4440
        .incbin "{rel}/sat.bin"
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
;; PCEStudio viewer {name[6:]} — generated by tools/genviewer.py, do not edit.
;; Data for {os.path.basename(dumpdir)} at the fixed places of docs/ROM_LAYOUT.md.
        .include "viewer.asm"
""" + "".join(banks)
    with open(os.path.join(OUT, f"{name}.asm"), "w") as f:
        f.write(asm)
    print(f"wrote {rel}/{{config,palette,bat,tiles,sat}}.bin and "
          f"gen/{name}.asm "
          f"(BXR={bxr}, BYR={byr}, MWR=${mwr:02x}, CR=${cr:02x}, "
          f"BAT {words} words, {len(regions)} copy regions, "
          f"tiles {len(tiles)} B, SAT {len(sat)} B)")


def main():
    # 1|2|3 -> viewerN from sceneN; 7 -> viewer7 (#42: scene7's 128x64 BAT is
    # 16384 bytes, the first picture whose BAT copy crosses the 8 KiB MPR2
    # window); 10 -> viewer10 (#46: the >80 KB picture — a 64x64 BAT plus a
    # 32 KiB tile set plus 160 sprite-pattern cells = 11 banks / 88 KB);
    # vsprite1..vsprite12 -> the viewer ROMs of the sprite scenes.
    valid = [str(i) for i in (1, 2, 3, 7, 10)] + \
        [f"vsprite{i}" for i in range(1, 13)]
    if len(sys.argv) != 2 or sys.argv[1] not in valid:
        print(f"usage: {sys.argv[0]} 1|2|3|7|10|vsprite1..vsprite12",
              file=sys.stderr)
        return 2
    os.makedirs(OUT, exist_ok=True)
    build(sys.argv[1])


if __name__ == "__main__":
    sys.exit(main())
