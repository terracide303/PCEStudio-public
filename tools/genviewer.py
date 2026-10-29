#!/usr/bin/env python3
"""genviewer.py — build the picture-data banks for the #8/#14/#16 viewer ROM.

    python3 -I genviewer.py 1|2|3|7|10
    python3 -I genviewer.py vsprite1..vsprite12
    python3 -I genviewer.py vraster1..vraster10

Takes a picture's sample data (tests/dumps/sceneN, spriteN or rasterN/
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

For the #16 vrasterN specs the build also emits:

  gen/vrasterN/raster.bin   the raster table image, always 3856 bytes: the
                        4-byte header (size lo, size hi, flags, step count)
                        and the 16 parallel per-step arrays at the fixed
                        offsets of docs/ROM_LAYOUT.md, laid into bank 1 at
                        offset 0x640 ($4640) for the viewer's fixed 16-page
                        RAM copy ($2800, tools/viewer.asm)
  gen/vrasterN.raster.json a copy of tools/gen/rasterN.raster.json — the
                        scene's table, for capture.sh to drop into the
                        dump (the capture then proves the viewer ROM ran
                        the same table the #15 scene ROM ran)

The raster table itself comes from tools/gen/rasterN.raster.json (written
by tools/genroms.py from RASTER_SCENES — the #15 scene's table verbatim);
the dump's save-time registers are NOT used for the config base: the table
owns the base (BXR/BYR/CR from its `base` block, CR ORed with 0x04 = RC)
and the boot colour table (baseCram), and the dump's MWR picks the BAT
size.

The copy regions come from tests/dumps/<dir>/regions.json — the same file
renderer/pce-rom.js reads for #9's browser export, so both builders lay out
the same picture from the same description.  The data itself is read back
out of the dump's vram.bin: the viewer shows the sample data, not a
regenerated copy of it.

This script is tooling for the viewer ROMs' evidence; the viewer itself
knows none of this — it follows the config block.
"""

import json
import os
import shutil
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
CFG_RASTER = 9               # 1 = the #16 raster table is present (bank 1,
                             # offset 0x640); the viewer's boot copies and
                             # runs it when set
CFG_FLICKER_STEP = 0x3E      # #28: 0 = no flicker; else the SAT-order
                             # rotation per frame, in entries (viewer.asm
                             # flicker_setup)
CFG_FLICKER_PHASES = 0x3F    # #28: the number of rotated copies the viewer
                             # builds (1..8; copy p at VRAM $7f00 - p*$100)
CFG_REG0 = 0x0A
REG_SIZE = 4
# 13 descriptors fit between CFG_REG0 and the palette at 0x40 (#46: was 8).
MAX_REGIONS = 13
PALETTE_OFFSET = 0x40          # 512 words, LE (entries 0-511)
SAT_OFFSET = 0x440             # 256 words, LE (64 SAT entries x 4) — #14
SAT_ADDR = 0x7F00              # the SAT's VRAM word address (DVSSR)

# ---- #70: the wide-window block (docs/ROM_LAYOUT.md)
# A picture whose VCE CR selects a non-/4 dot clock (DCC bits 1-0 != 00) is
# a 336- or 512-dot picture: the viewer cannot use the 256-dot HSR/HDR
# constants, so config version 2 says the block at bank 1 offset 0x1F00 is
# present.  The block sits after the raster table (which ends at 0x1550) and
# is 0xFF padding in every version 1 picture, so no existing ROM changes.
# viewer.asm reads it at $5F00 through MPR2 before any data bank is mapped.
WIDE_OFFSET = 0x1F00
WIDE_VCE_CR = 0
WIDE_HSR_LO = 2
WIDE_HSR_HI = 3
WIDE_HDR_LO = 4
WIDE_HDR_HI = 5
WIDE_SIZE = 8


def is_wide(regs):
    """A picture is wide when its VCE CR asks for a /3 or /2 dot clock
    (DCC bits 1-0 != 00; H6-3 and pcetech §6/§9).  The 256-dot /4 clock is
    every picture before #70."""
    return (int(regs.get("VCECR", 0x04)) & 0x03) != 0


# 128 banks = 1 MB is the HuCard's decode ($00-$7F: sgxtech.txt "HuC6280
# memory map"; pcetech.txt §3 "Memory map"; hes spec [MEMORY MAP] ROM
# 0x000000-0x0FFFFF; docs/MANUALS.md §15.1 GAP 4) as well as PCEAS 3.23's
# own limit — `.bank` refuses an index above 0x7F
# (huc-src/src/mkit/as/main.c `bank_limit = 0x7F`).  The HuC6280's 2 MB /
# 256-block physical space (hardware manual H8-7, H8-10/11) is the CPU's
# address space, not the card's: no ROM above 1 MB can map on a HuCard.
PCEAS_MAX_BANKS = 128

# ---- #16: the raster table image (docs/ROM_LAYOUT.md).  The image is
# laid into bank 1 at RASTER_OFFSET and the viewer copies 16 pages of bank
# 1 from there to RAM $2800 — the arrays land at the fixed addresses
# tools/viewer.asm indexes (r_op $2804, r_chain_lo $2900, ...): the image
# offset of every array is its RAM address minus $2800.  r_op sits right
# after the 4-byte header; r_chain_lo starts on a page boundary ($2900),
# so 12 bytes of padding separate the two — the image is
# 4 + 12 + 16 * 240 = 3856 bytes, not 3844.  Each array holds RASTER_STEPS
# bytes, the padding beyond the step count is zero; the builders agree on
# every byte (renderer/pce-rom.js encodes the same image).
RASTER_OFFSET = 0x640         # bank 1 byte offset ($4640 in the MPR2 window)
RASTER_STEPS = 240            # steps a table may hold (one per VDW line cap)
RASTER_IMAGE = 4 + 12 + 16 * RASTER_STEPS          # 3856, always
RASTER_HEADER_SIZE = 4        # size lo, size hi, flags (bit 0 frame), count
# The arrays in image order; image offset = header + 12-pad gap after r_op
# + 240 * index.  They are packed 240 bytes apart (NOT page-aligned): only
# the chain arrays and r_op are read once a step outside the line budget;
# the write-value arrays cross a page for the higher steps and those reads
# cost 5 cycles — the handler's worst step (r7's two CRAM writes at step
# 231, all eight reads crossing) still lands inside the ~111-cycle window
# (tools/viewer.asm, the irq1_plain cycle notes).
RASTER_ARRAYS = ("op", "chain_lo", "chain_hi",
                 "bxr_lo", "bxr_hi", "byr_lo", "byr_hi", "cr",
                 "a1_lo", "a1_hi", "v1_lo", "v1_hi",
                 "a2_lo", "a2_hi", "v2_lo", "v2_hi")


def encode_raster_table(table):
    """The fixed-layout table image for the viewer's irq1 chain.

    `table` is a raster.json document — the shape genroms.raster_json()
    emits (base, baseCram, frameCounter, entries with line/bxr/byr/cr/cram)
    — and the returned bytes are exactly what the viewer copies to RAM
    $2800 (docs/ROM_LAYOUT.md; renderer/pce-rom.js encodes the same
    bytes).  One step per entry, in entry order: r_op bits 0..4 = BXR,
    BYR, CR, first CRAM word, second CRAM word; r_chain = 0x40 + the
    entry's line (the RCR value arming the NEXT step — the #15
    convention); the CRAM entries hold the table's base values, the frame
    counter (flag bit 0) is added by the viewer's handler at write time.
    """
    entries = table["entries"]
    n = len(entries)
    assert 1 <= n <= RASTER_STEPS, n
    arr = {name: bytearray(RASTER_STEPS) for name in RASTER_ARRAYS}
    for i, e in enumerate(entries):
        line = e["line"]
        rcr = e.get("rcr", 0x40 + line)
        assert 0 <= line <= 240, line
        assert rcr == 0x40 + line, (line, rcr)   # the #15 convention
        op = 0
        if "bxr" in e:
            op |= 0x01
            arr["bxr_lo"][i] = e["bxr"] & 0xFF
            arr["bxr_hi"][i] = (e["bxr"] >> 8) & 0xFF
        if "byr" in e:
            op |= 0x02
            arr["byr_lo"][i] = e["byr"] & 0xFF
            arr["byr_hi"][i] = (e["byr"] >> 8) & 0xFF
        if "cr" in e:
            op |= 0x04
            arr["cr"][i] = e["cr"]
        cram = e.get("cram") or []
        assert len(cram) <= 2, (i, cram)
        for w, (addr, value) in enumerate(cram):
            op |= 0x08 << w
            arr[f"a{w + 1}_lo"][i] = addr & 0xFF
            arr[f"a{w + 1}_hi"][i] = (addr >> 8) & 0xFF
            arr[f"v{w + 1}_lo"][i] = value & 0xFF
            arr[f"v{w + 1}_hi"][i] = (value >> 8) & 0xFF
        arr["chain_lo"][i] = rcr & 0xFF
        arr["chain_hi"][i] = (rcr >> 8) & 0xFF
        arr["op"][i] = op
    image = bytearray(RASTER_IMAGE)
    image[0:2] = struct.pack("<H", RASTER_IMAGE)
    image[2] = 1 if table.get("frameCounter") else 0
    image[3] = n
    off = RASTER_HEADER_SIZE
    image[off:off + RASTER_STEPS] = arr["op"]
    off += RASTER_STEPS + 12        # r_chain_lo is page-aligned ($2900)
    for name in RASTER_ARRAYS[1:]:
        image[off:off + RASTER_STEPS] = arr[name]
        off += RASTER_STEPS
    assert off == RASTER_IMAGE, off
    return bytes(image)


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
    vspriteN from tests/dumps/spriteN (#14: the #12 sprite scenes);
    'vrasterN' -> vrasterN from tests/dumps/rasterN and the scene's
    raster table tools/gen/rasterN.raster.json (#16); 'flicker' -> the
    #28 flicker viewer from tests/dumps/sprite13 and the rotation rule
    tools/gen/sprite13.flicker.json."""
    flicker = None
    if spec == "flicker":
        # #28: the same picture data as vsprite13, but the config carries
        # the rotation (step, phases) and the ROM is assembled with FLICKER
        # defined — the flicker code is kept out of the shared bank 0
        # (browser export, #68 trace fixtures).
        name = "flicker"
        dumpdir = os.path.join(HERE, "..", "tests", "dumps", "sprite13")
        with open(os.path.join(OUT, "sprite13.flicker.json")) as f:
            flicker = json.load(f)
    elif spec.startswith("vsprite"):
        name = spec
        dumpdir = os.path.join(HERE, "..", "tests", "dumps",
                               f"sprite{spec[len('vsprite'):]}")
    elif spec.startswith("vraster"):
        name = spec
        dumpdir = os.path.join(HERE, "..", "tests", "dumps",
                               f"raster{spec[len('vraster'):]}")
    elif spec.startswith("vwide"):
        # #70: the viewer ROMs of #27's wide pictures (336 and 512 dots).
        name = spec
        dumpdir = os.path.join(HERE, "..", "tests", "dumps",
                               f"wide{spec[len('vwide'):]}")
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

    # #16: the table owns the base registers and the boot colour table —
    # the dump's save-time BXR/BYR/CR and cram.bin are what the chain and
    # the save left behind, not what the picture starts from.  CR gets the
    # RC bit (0x04) — the VDC interrupt enable that fires the chain.
    raster = None
    if spec.startswith("vraster"):
        with open(os.path.join(OUT,
                               f"raster{spec[len('vraster'):]}.raster.json")) \
                as f:
            raster = json.load(f)
        base = raster["base"]
        bxr, byr, cr = base["bxr"], base["byr"], base["cr"] | 0x04
        mwr = regs["MWR"]
        palette_words = raster["baseCram"]
    else:
        bxr, byr, mwr, cr = regs["BXR"], regs["BYR"], regs["MWR"], regs["CR"]
        palette_words = None
    words = bat_words(mwr)

    # #70: a 336- or 512-dot picture carries its VCE CR and the HSR/HDR of
    # its window in the wide-window block (docs/ROM_LAYOUT.md).  #27's wide
    # dumps record both the live registers and the latched *_cache fields;
    # the live HSR/HDR are what the scene ROM wrote and the *_cache values
    # agree (the viewer writes the same registers before enabling display).
    wide = is_wide(regs)

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

    if flicker:
        # the viewer builds `phases` rotated SAT copies at word
        # $7f00 - p*$100 (docs/ROM_LAYOUT.md): a picture region landing in
        # that span would be overwritten by the copies (and the frame would
        # not be the picture's).  The fixture's regions end at $2600, well
        # below; refuse rather than silently corrupt.
        step, phases = flicker["step"], flicker["phases"]
        assert 1 <= step <= 63 and 1 <= phases <= 8 and step * 4 <= 255, \
            (step, phases)
        copy_lo = SAT_ADDR - (phases - 1) * 0x100
        for dest, count in regions:
            if dest < SAT_ADDR + 0x100 and dest + count > copy_lo:
                raise ValueError(
                    f"flicker: region words {dest}..{dest + count} overlap "
                    f"the rotated SAT copies {copy_lo}..{SAT_ADDR + 0xff}")

    # config block.  Version 2 = the wide-window block is present (#70); a
    # wide and a flicker picture are mutually exclusive (the flicker bytes
    # $3E/$3F stay 0), and a raster table never comes with a wide window.
    assert not (wide and flicker), "wide and flicker are mutually exclusive"
    assert not (wide and raster), "wide and raster are mutually exclusive"
    cfg = bytearray(CONFIG_SIZE)
    cfg[CFG_VERSION] = 2 if wide else 1
    cfg[CFG_BXR:CFG_BXR + 2] = struct.pack("<H", bxr)
    cfg[CFG_BYR:CFG_BYR + 2] = struct.pack("<H", byr)
    cfg[CFG_MWR] = mwr
    cfg[CFG_CR] = cr
    cfg[CFG_RGNS] = len(regions)
    cfg[CFG_RASTER] = 1 if raster else 0
    if flicker:
        cfg[CFG_FLICKER_STEP] = flicker["step"]
        cfg[CFG_FLICKER_PHASES] = flicker["phases"]
    for r, (dest, count) in enumerate(regions):
        off = CFG_REG0 + r * REG_SIZE
        cfg[off:off + 2] = struct.pack("<H", dest)
        cfg[off + 2:off + 4] = struct.pack("<H", count)

    # #70: the wide-window block (bank 1 offset 0x1F00) — the picture's VCE
    # CR and the HSR/HDR its window needs.  The values come from the dump's
    # own registers, not from a width table, so a future window is carried
    # the same way.
    wide_block = None
    if wide:
        wide_block = bytearray(WIDE_SIZE)
        wide_block[WIDE_VCE_CR] = int(regs["VCECR"]) & 0xFF
        hsr, hdr = int(regs["HSR"]) & 0xFFFF, int(regs["HDR"]) & 0xFFFF
        wide_block[WIDE_HSR_LO] = hsr & 0xFF
        wide_block[WIDE_HSR_HI] = (hsr >> 8) & 0xFF
        wide_block[WIDE_HDR_LO] = hdr & 0xFF
        wide_block[WIDE_HDR_HI] = (hdr >> 8) & 0xFF

    # palette: VCE entries 0-511 (the 16 BG palettes and the 16 sprite
    # palettes the picture uses).  A raster picture's boot colour table is
    # the table's baseCram (the values CRAM holds after boot and before the
    # first entry of a frame), not the dump's save-time cram.bin.
    if palette_words is None:
        palette = cram[:1024]
    else:
        assert len(palette_words) == 512, len(palette_words)
        palette = struct.pack("<512H", *palette_words)

    # BAT: words 0..words-1 of VRAM
    bat = vram[:words * 2]

    # tiles: the regions, concatenated in descriptor order
    tiles = bytearray()
    for dest, count in regions:
        tiles += vram[dest * 2:(dest + count) * 2]

    # SAT: 64 entries x 4 words at VRAM $7f00 (DVSSR) — the SATB DMA source
    # the viewer re-creates (card #14, docs/ROM_LAYOUT.md)
    sat = vram[SAT_ADDR * 2:SAT_ADDR * 2 + 512]

    # #16: the raster table image at bank 1 offset 0x640 — always the same
    # size (the viewer copies a fixed 16 pages).  The copy of the scene's
    # raster.json goes next to it for capture.sh (the capture drops it into
    # the dump as raster.json, so the renderer checks the viewer's table —
    # the scene's table — against the save state).
    raster_bin = encode_raster_table(raster) if raster else None

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
    if raster:
        with open(os.path.join(outdir, "raster.bin"), "wb") as f:
            f.write(raster_bin)
        shutil.copyfile(os.path.join(OUT, f"raster{name[7:]}.raster.json"),
                        os.path.join(OUT, f"{name}.raster.json"))
    if wide:
        with open(os.path.join(outdir, "wide.bin"), "wb") as f:
            f.write(wide_block)

    # the asm: viewer.asm (bank 0) + the data banks at the fixed places.
    # BAT and tiles are split into 8 KiB banks so the .incbins never spill
    # past a bank boundary (pceas -raw would pad/truncate silently).  #46:
    # there is no 6-tile-bank cap any more — banks 4..127 are the regions,
    # streamed through the viewer's 8 KiB MPR2 window (viewer.asm
    # copy_words re-maps the bank on every $6000 crossing), up to 1 MB — the
    # HuCard's decode and PCEAS 3.23's .bank limit agree at 128 banks.
    # Beyond that this path refuses, and so does renderer/pce-rom.js: nothing
    # above 1 MB can map on a HuCard.
    BANK = 8 * 1024
    assert len(bat) <= 2 * BANK, len(bat)
    bat_banks = (len(bat) + BANK - 1) // BANK
    tiles_banks = max(1, (len(tiles) + BANK - 1) // BANK)
    if 4 + tiles_banks > PCEAS_MAX_BANKS:
        raise ValueError(
            f"pceas-bank-limit: {4 + tiles_banks} banks of 8 KiB "
            f"({(4 + tiles_banks) * BANK} bytes); a HuCard decodes at most "
            f"{PCEAS_MAX_BANKS} banks (1 MB, physical banks $00-$7F; "
            f"sgxtech.txt \"HuC6280 memory map\", pcetech.txt §3, "
            f"hes spec [MEMORY MAP]); PCEAS 3.23's .bank index also stops "
            f"at 0x7F")
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
    if raster:
        banks.append(f"""\
        .org $4640
        .incbin "{rel}/raster.bin"
""")
    if wide:
        banks.append(f"""\
        .org ${0x4000 + WIDE_OFFSET:04x}
        .incbin "{rel}/wide.bin"
""")
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
    display = "flicker" if flicker else name[6:]
    flicker_def = ("FLICKER = 1\n" if flicker else "")
    asm = f"""\
;; PCEStudio viewer {display} — generated by tools/genviewer.py, do not edit.
;; Data for {os.path.basename(dumpdir)} at the fixed places of docs/ROM_LAYOUT.md.
{flicker_def}        .include "viewer.asm"
""" + "".join(banks)
    with open(os.path.join(OUT, f"{name}.asm"), "w") as f:
        f.write(asm)
    raster_note = ""
    if raster:
        raster_note = (f", raster table {len(raster['entries'])} steps "
                       f"(flags ${raster_bin[2]:02x})")
    if flicker:
        raster_note = (f", flicker step {flicker['step']} x "
                       f"{flicker['phases']} phases")
    if wide:
        raster_note += (f", wide window VCE CR=${wide_block[WIDE_VCE_CR]:02x}"
                        f" HSR=${regs['HSR']:04x} HDR=${regs['HDR']:04x}")
    print(f"wrote {rel}/{{config,palette,bat,tiles,sat}}.bin and "
          f"gen/{name}.asm "
          f"(BXR={bxr}, BYR={byr}, MWR=${mwr:02x}, CR=${cr:02x}, "
          f"BAT {words} words, {len(regions)} copy regions, "
          f"tiles {len(tiles)} B, SAT {len(sat)} B{raster_note})")


def main():
    # 1|2|3 -> viewerN from sceneN; 7 -> viewer7 (#42: scene7's 128x64 BAT is
    # 16384 bytes, the first picture whose BAT copy crosses the 8 KiB MPR2
    # window); 10 -> viewer10 (#46: the >80 KB picture — a 64x64 BAT plus a
    # 32 KiB tile set plus 160 sprite-pattern cells = 11 banks / 88 KB);
    # vsprite1..vsprite12 -> the viewer ROMs of the sprite scenes;
    # vraster1..vraster10 -> the viewer ROMs of the #15 raster scenes (#16);
    # vwide336/vwide512 -> the viewer ROMs of #27's wide pictures (#70).
    valid = [str(i) for i in (1, 2, 3, 7, 10)] + \
        [f"vsprite{i}" for i in range(1, 14)] + \
        [f"vraster{i}" for i in range(1, 11)] + \
        ["vwide336", "vwide512", "flicker"]
    if len(sys.argv) != 2 or sys.argv[1] not in valid:
        print(f"usage: {sys.argv[0]} 1|2|3|7|10|vsprite1..vsprite13|"
              f"vraster1..vraster10|vwide336|vwide512|flicker",
              file=sys.stderr)
        return 2
    os.makedirs(OUT, exist_ok=True)
    build(sys.argv[1])


if __name__ == "__main__":
    sys.exit(main())
