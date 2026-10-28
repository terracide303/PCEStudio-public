#!/usr/bin/env python3
"""genroms.py — generate the PCEStudio test-scene ROMs (cards #5, #39, #12, #15).

Each scene is a HuCard ROM that initialises the VDC/VCE (the canonical HuDK
256x224 init values, see docs/BUILD.md and hello.asm), fills the VCE colour
table and VDC VRAM (tiles + BAT, and for the sprite scenes the SG patterns +
SAT) with a deterministic picture, turns the background/sprites on and
loops.  Mednafen runs the ROM; its save state is the "VRAM+palette dump" and
its screenshot the pixel reference (see capture.sh and tests/).

The scenes differ in what they exercise in the renderer:
  scene1 "flat"    32x32 BAT, no scroll, tiles 0x040+/0xF00+ (12-bit tile
                   numbers), all 16 palettes, VCE CG bits set on some entries
  scene2 "scroll"  64x32 BAT, BXR=100, BYR=53 (sub-tile scroll), single-pixel
                   checkerboard tiles (bit-order torture)
  scene3 "wide"    128x32 BAT, BXR=290, BYR=117, tiles 0x100+/0x1F0+; its BAT
                   is filled by a small formula loop in the ROM itself so the
                   data fits in one 8 KiB ROM bank
  scene4 "64"      64x32 BAT, BXR=256 — scrolls BAT columns 32..63 into view;
                   the BAT is NOT 32-periodic, so a width mask of 31 changes it
  scene5 "128c3"   128x32 BAT addressed through SCREEN code 3 (MWR=0x30),
                   BXR=1000 — wraps the BAT mask (cols 125..127,0..28)
  scene6 "64row"   64x64 BAT (MWR=0x50, bit 6), BYR=400 — wraps rows
                   50..63,0..14; a 32-row BAT changes the picture
  scene7 "2bank"   128x64 BAT (MWR=0x70) = 8192 words, two VRAM banks
  scene8 "bgoff"   scene 1's picture with CR bit 7 clear: the frame must be
                   the sprite colour-0 entry CRAM[0x100] everywhere — the
                   blanking-period video data SPBG=1, VD7..0=0 (2.3.6 p.
                   H7-18); measured: 59392/59392 pixels 0x049
  scene8b "bgoff2" same, DCR=0x00 (sprite hardware off): still CRAM[0x100]
                   everywhere (the DCR experiment)
  scene8c "bgoff3" CR=0x40: sprites on, background off, no burst mode (SB=1,
                   BB=0 — 8/8b are SB=BB=0, burst): still CRAM[0x100]
  scene9 "ch800"   BAT reads real tiles at 0x700 and tiles at 0xF00+, beyond
                   the 32768-word VRAM (writes dropped, reads = colour 0)

Scenes 4-9 are #39's: each turns one of docs/REVIEW.md finding 1's renderer
breaks into a visible picture change (see tests/renderer-mutation.js).
Scenes 5/6/7 fill their BATs with small formula loops in the ROM (their BATs
do not fit as data in one 8 KiB bank); bat_formula() below is the generator's
mirror of those loops.

Generated assembly lands in tools/gen/sceneN.asm; build with `make -C tools`.
This script is tooling for #5's evidence, not part of the renderer.

Every VRAM copy loop in the ROM reads one 256-byte table per page (the 6280's
`lda tab, X` cannot span a page), so the generator emits per-page tables with
unique names.  All data lives in bank 0 ($e000-$ffff), reached through MPR7.
"""

import json
import math
import os
import sys

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gen")

# Canonical HuDK VDC init for 256x224 (include/vdc.s vdc_init_table), with
# BXR/BYR/MWR per scene.
HSR = 0x0202   # HDS=2, HSW=2
HDR = 0x041F   # HDW=31 (32 chars), HDE=4
VPR = 0x0F02   # VSW=2, VDS=15
VDW = 0x00EF   # 240 display lines
VCR = 0x000C
DCR = 0x0010   # SATB auto-repeat (harmless, sprites disabled)
SATB = 0x7F00


def cr_words():
    """VCE colour table: 512 9-bit values, plus 0x100 OR'd onto three entries.

    Entry i -> colour (i * 7) & 0x1FF (a bijection mod 512, so every 9-bit
    value appears exactly once), OR'd with 0x100 on a few entries.  Bit 8 is
    the top bit of green, not a separate CG bit, so that OR changes the
    colour — it does not test a no-op (docs/REVIEW.md, finding 3).  Measured
    on the dumps: 258 of the 512 values end with bit 8 set, and the scenes
    display many of them (the backdrop 0x1FF always).  The data is left as it
    was published so the captures stay comparable.
    """
    cg = {0x010, 0x0F5, 0x155}
    words = [((i * 7) & 0x1FF) | (0x100 if i in cg else 0) for i in range(512)]
    # Distinct backdrop (BG colour 0) and blanking (sprite colour 0) canaries.
    words[0x000] = 0x1FF
    words[0x100] = 0x049
    return words


def tile_word(scene, t, plane, row):
    """16-bit CG word for tile t, bitplane plane (0..3), row (0..7).

    plane 0/1 -> CH0/CH1 of VRAM word char*16+row (bits 0-7 / 8-15)
    plane 2/3 -> CH2/CH3 of VRAM word char*16+8+row
    Bit 7 (MSB) of a plane byte is the leftmost pixel of the row — the
    renderer's decode (pce-bg.js: bit = 7 - col), diff-0 against Mednafen on
    every scene.  (An earlier version of this comment said LSB/bit x, which
    the captures contradict; #40, via sprite3's stripes.)
    """
    if scene in RASTER_BANDS:
        # #43's bands tiles: tile t is solid colour ((t - 0x040) % 7) + 1 —
        # palette 0's seven bright hues (RASTER_HUES_CRAM).  32 mod 7 != 0,
        # so a BYR row shift or a BXR column shift changes which hue each
        # column shows, and the diagonal colour bands are visible to a
        # person (REVIEW-15: r3's split and r2's wobble sat on noise).
        c = ((t - 0x040) % 7) + 1
        v = 0xFF if (c >> plane) & 1 else 0x00
        return v if plane in (0, 2) else v << 8
    if scene in RASTER_STRIPES:
        # r7's stripes: tile 0x040 transparent (colour 0 -> CRAM[0x000]),
        # tile 0x041 solid colour 7 — CH0..CH2 = 0xFF, CH3 = 0x00 (the #40
        # stripes decode, MSB-first).
        v = 0x00 if t == 0x040 else (0xFF if plane != 3 else 0x00)
        return v if plane in (0, 2) else v << 8
    if scene == 2:
        # single-pixel checkerboard per plane: 0xAA / 0x55 by parity
        v = 0xAA if ((row + t + plane) & 1) else 0x55
    elif scene == 3:
        # broad stripes: bit x = ((x + 2*row + t + 3*plane) >> 4) & 1
        v = 0xF0 if (((2 * row + t + 3 * plane) >> 4) & 1) else 0x0F
    else:
        # scenes 1 and 4-9: pseudo-random per tile/row/plane
        v = (t * 73 + row * 13 + plane * 29) & 0xFF
        v ^= (t * 3 + plane * 5) & 0xFF
    # CH1/CH3 occupy the high byte of the VRAM word
    return v if plane in (0, 2) else v << 8


def bat_entry(scene, x, y):
    """BAT word at (x, y): bits 0-11 tile (char code), bits 12-15 palette."""
    if scene in RASTER_BANDS:
        # #43's bands BAT: tile (x, y) = 0x040 + (x + 2y) & 31, palette 0 —
        # diagonal seven-colour bands, non-periodic in both shifts
        return 0x040 | ((x + 2 * y) & 31)
    if scene in RASTER_STRIPES:
        # r7's stripes BAT: transparent left of display column 128
        return 0x040 if x < 16 else 0x041
    if scene == 3:
        pal = (x + 3 * y) & 0xF
    elif scene in (4, 8):
        pal = (x + 2 * y) & 0xF
    else:
        pal = (x + 2 * y) & 0xF if scene != 9 else (x + y) & 0xF
    if scene in (1, 8, "8b"):
        if x & 1:
            tile = 0xF00 | ((x * 3 + y * 5) & 0xF)
        else:
            tile = 0x040 | ((x * 3 + y * 5) & 0x1F)
    elif scene == 2:
        if (x + y) & 7 == 0:
            tile = 0xF00 | (x & 0xF)
        else:
            tile = 0x080 | ((x + y) & 0x1F)
    elif scene == 4:
        # 64-periodic only: (x + 2y) & 0x3F differs for x and x + 32, so a
        # BAT width mask of 31 (or an 8-bit BXR) changes the picture.
        tile = 0x080 | ((x + 2 * y) & 0x3F)
    elif scene == 9:
        # ch >= 0x800 witness: even columns read real tiles at 0x700, odd
        # columns read 0xF00+ (beyond the 32768-word VRAM -> colour 0).
        if x & 1:
            tile = 0xF00 | ((x + y) & 0xF)
        else:
            tile = 0x700 | ((x + y) & 0xF)
    else:  # scene 3 — kept in sync with the formula loop in the ROM
        if x & 0x10:
            tile = 0x1F0 | (((x * 3) & 0x1F) + y & 0x1F)
        else:
            tile = 0x100 | (((x * 7) & 0x1F) + y & 0x1F)
    return (pal << 12) | tile


SCENES = {
    1: dict(mwr=0x00, bxr=0, byr=0, cr=0x80, dcr=DCR,
            bat_w=32, bat_h=32, bat_tables=True,
            tiles=[(0x040, 32), (0xF00, 16)]),
    2: dict(mwr=0x10, bxr=100, byr=53, cr=0x80, dcr=DCR,
            bat_w=64, bat_h=32, bat_tables=True,
            tiles=[(0x080, 32), (0xF00, 16)]),
    3: dict(mwr=0x20, bxr=290, byr=117, cr=0x80, dcr=DCR,
            bat_w=128, bat_h=32, bat_tables=False, bat_loop="s3",
            tiles=[(0x100, 32), (0x1F0, 32)]),
    # #39: scenes whose BATs are NOT 32-periodic, so a renderer that gets the
    # BAT width, height, stride, BXR/BYR width or CR wrong changes the picture
    # (docs/REVIEW.md finding 1).  Scene 4 = 64-wide BAT (MWR=0x10, BXR=256
    # scrolls the second half of the BAT into view); 5 = 128-wide with SCREEN
    # code 3 (MWR=0x30) and a BXR that wraps the BAT mask (1000 -> columns
    # 125..127,0..28); 6 = 64-row BAT (MWR=0x50, bit 6) with a BYR that wraps
    # (400 -> rows 50..63,0..14); 7 = the two-bank BAT, 128x64 = 8192 words
    # (MWR=0x70); 8 = the same picture as scene 1 with the background off
    # (CR=0x00: the frame must be the backdrop everywhere); 9 = ch>=0x800
    # witness (real tiles at 0x700, dropped writes at 0xF00).
    4: dict(mwr=0x10, bxr=256, byr=0, cr=0x80, dcr=DCR,
            bat_w=64, bat_h=32, bat_tables=True,
            tiles=[(0x080, 64)]),
    5: dict(mwr=0x30, bxr=1000, byr=0, cr=0x80, dcr=DCR,
            bat_w=128, bat_h=32, bat_tables=False, bat_loop="s5",
            tiles=[(0x100, 64)]),
    6: dict(mwr=0x50, bxr=0, byr=400, cr=0x80, dcr=DCR,
            bat_w=64, bat_h=64, bat_tables=False, bat_loop="s6",
            tiles=[(0x100, 64)]),
    7: dict(mwr=0x70, bxr=1000, byr=0, cr=0x80, dcr=DCR,
            bat_w=128, bat_h=64, bat_tables=False, bat_loop="s7",
            tiles=[(0x200, 64)]),
    8: dict(mwr=0x00, bxr=0, byr=0, cr=0x00, dcr=0x10,
            bat_w=32, bat_h=32, bat_tables=True,
            tiles=[(0x040, 32), (0xF00, 16)]),
    "8b": dict(mwr=0x00, bxr=0, byr=0, cr=0x00, dcr=0x00,
               bat_w=32, bat_h=32, bat_tables=True,
               tiles=[(0x040, 32), (0xF00, 16)]),
    "8c": dict(mwr=0x00, bxr=0, byr=0, cr=0x40, dcr=0x10,
               bat_w=32, bat_h=32, bat_tables=True,
               tiles=[(0x040, 32), (0xF00, 16)]),
    9: dict(mwr=0x00, bxr=0, byr=0, cr=0x80, dcr=DCR,
            bat_w=32, bat_h=32, bat_tables=True,
            tiles=[(0x700, 16), (0xF00, 16)]),
}

# The formula loops' BAT entries (the ROM computes them; these are the
# generator's mirror for the scene header and the #39 notes).
def bat_formula(scene, x, y):
    if scene == 5:
        pal = (x + 3 * y) & 0xF
        tile = 0x100 | (((x + 2 * y) & 0x7F) >> 1)
    elif scene == 7:
        # tiles live at chars 0x200+ (the 8192-word BAT consumes VRAM words
        # 0..8191, so 0x100+ would overlap rows 32-39 — measured, fixed)
        pal = (x + 3 * y) & 0xF
        tile = 0x200 | (((x + 2 * y) & 0x7F) >> 1)
    elif scene == 6:
        # tiles at chars 0x100+ (the 4096-word BAT consumes words 0..4095)
        pal = (x + 2 * y) & 0xF
        tile = 0x100 | ((x + y) & 0x3F)
    else:
        raise AssertionError(scene)
    return (pal << 12) | tile


def tile_region_bytes(scene, tiles):
    """VRAM word bytes for tile regions: per (char0, count) -> words
    char*16+row for row 0..7 (CH0/CH1 = bits 0-7/8-15 of word char*16+row,
    CH2/CH3 = word char*16+8+row).  Returns (bytes, [(vbase, char0, count)])."""
    tile_bytes = bytearray()
    regions = []
    for char0, count in tiles:
        vbase = char0 * 16
        for t in range(count):
            for row in range(8):
                w = (tile_word(scene, char0 + t, 0, row)
                     | tile_word(scene, char0 + t, 1, row))
                tile_bytes += bytes((w & 0xFF, (w >> 8) & 0xFF))
            for row in range(8):
                w = (tile_word(scene, char0 + t, 2, row)
                     | tile_word(scene, char0 + t, 3, row))
                tile_bytes += bytes((w & 0xFF, (w >> 8) & 0xFF))
        regions.append((vbase, char0, count))
    return tile_bytes, regions


def bat_bytes_full(scene, w, h):
    out = bytearray()
    for y in range(h):
        for x in range(w):
            v = bat_entry(scene, x, y)
            out += bytes((v & 0xFF, (v >> 8) & 0xFF))
    return out


def pages_of(word_bytes):
    """Split a bytes object of 16-bit words into (lo_pages, hi_pages), each a
    list of 256-byte chunks (256 words per page); the last page is zero-padded
    to a full 256 bytes.  emit_copy_loop always copies whole pages (its clx/
    inx/bne loop runs 256 iterations), so without the padding a short region
    copied the next table's ROM bytes into VRAM — the #14 viewer check found
    sprite3/sprite10's stripes tiles (16-word regions) carrying 240 garbage
    words each into VRAM $420-$50f, invisible to the renderer because the BAT
    never names those characters."""
    lo = word_bytes[0::2]
    hi = word_bytes[1::2]
    lo += b"\x00" * (-len(lo) % 256)
    hi += b"\x00" * (-len(hi) % 256)
    return ([lo[i:i + 256] for i in range(0, len(lo), 256)],
            [hi[i:i + 256] for i in range(0, len(hi), 256)])


def emit_copy_loop(out, label_prefix, lo_pages, hi_pages):
    """Emit per-page copy loops; MAWR must already point at the destination
    and VWR ($0002/$0003) must be selected.  256 words per loop."""
    for p in range(len(lo_pages)):
        out.append("        clx")
        out.append(f"{label_prefix}pg{p}:")
        out.append(f"        lda {label_prefix}{p}_lo, X")
        out.append("        sta $0002")
        out.append(f"        lda {label_prefix}{p}_hi, X")
        out.append("        sta $0003")
        out.append("        inx")
        out.append(f"        bne {label_prefix}pg{p}")


def emit_byte_table(name, data):
    out = [f"{name}:"]
    for i in range(0, len(data), 16):
        out.append("        .db " + ",".join(f"${b:02x}" for b in data[i:i + 16]))
    return out


def emit_vdc_regs(out, s):
    regs = [
        (0x05, 0x0000),          # CR: everything off (BG enabled later)
        (0x06, 0x0000),          # RCR
        (0x07, s["bxr"]),        # BXR
        (0x08, s["byr"]),        # BYR
        (0x09, s["mwr"]),        # MWR
        (0x0A, HSR),
        (0x0B, HDR),
        (0x0C, VPR),
        (0x0D, VDW),
        (0x0E, VCR),
        (0x0F, s["dcr"]),        # DCR: bit 4 = sprite layer on
        (0x13, SATB),
    ]
    for reg, val in regs:
        out.append(f"        st0 #${reg:02x}")
        out.append(f"        st1 #${val & 0xff:02x}")
        out.append(f"        st2 #${(val >> 8) & 0xff:02x}")


BAT_FORMULA_ASM = """\
        ; BAT at VRAM 0, 128x32 = 4096 words; entry = formula (see genroms.py)
        ; NOTE: every zp operand is written <$xx — pceas emits bare $12 as a
        ; 16-bit absolute address, which through MPR0=0xFF aliases the VDC
        ; registers on the I/O page ($1FE012 & 3 = 2 = write_latch, etc.).
        st0 #$00
        st1 #$00
        st2 #$00                ; MAWR = 0
        st0 #$02
        stz <$12                ; y = 0
row3:
        lda <$12
        asl A
        clc
        adc <$12
        and #$0f                ; 3*y & 0xF
        sta <$13
        clx                     ; x = 0
        stz <$14                ; (7*x) & 0x1F
        stz <$15                ; (3*x) & 0x1F
xcol3:
        txa
        clc
        adc <$13
        and #$0f                ; palette = (x + 3y) & 0xF
        asl A
        asl A
        asl A
        asl A
        sta <$19                ; palette << 4
        txa
        and #$10
        bne high3
        lda <$14
        clc
        adc <$12
        and #$1f
        sta <$17                ; tile = 0x100 + v
        lda #$01
        sta <$18
        bra store3
high3:
        lda <$15
        clc
        adc <$12
        and #$1f
        ora #$f0                ; low byte of tile 0x1F0 + v
        sta <$17
        lda #$01
        sta <$18
store3:
        lda <$19
        ora <$18                ; high byte = (palette << 4) | tile high
        sta <$19
        lda <$17
        sta $0002
        lda <$19
        sta $0003
        lda <$14
        clc
        adc #$07
        and #$1f
        sta <$14
        lda <$15
        clc
        adc #$03
        and #$1f
        sta <$15
        inx
        cpx #$80
        bne xcol3
        inc <$12
        lda <$12
        cmp #$20
        beq bat3done
        jmp row3
bat3done:
"""

BAT_FORMULA5_ASM = """\
        ; BAT at VRAM 0, 128x32 = 4096 words; entry = formula (see genroms.py)
        ; NOTE: every zp operand is written <$xx — pceas emits bare $12 as a
        ; 16-bit absolute address, which through MPR0=0xFF aliases the VDC
        ; registers on the I/O page ($1FE012 & 3 = 2 = write_latch, etc.).
        ; tile = 0x100 | (((x + 2y) & 0x7F) >> 1)  (64 tiles, period 128 cols)
        ; palette = (x + 3y) & 0xF.  x+2y <= 189 and x+3y <= 220 fit 8 bits.
        st0 #$00
        st1 #$00
        st2 #$00                ; MAWR = 0
        st0 #$02
        stz <$12                ; y = 0
row5:
        lda <$12
        asl A
        sta <$14                ; x + 2y (starts at 2y, +1 per x)
        clx                     ; x = 0
xcol5:
        lda <$14
        clc
        adc <$12
        and #$0f                ; palette = (x + 3y) & 0xF
        asl A
        asl A
        asl A
        asl A
        sta <$19                ; palette << 4
        lda <$14
        and #$7f
        lsr A                   ; tile low = 0x100 | (((x + 2y) & 0x7F) >> 1)
        sta <$17
        lda #$01
        sta <$18                ; tile high nibble 0x1
        lda <$19
        ora <$18                ; high byte = (palette << 4) | 0x1
        sta <$19
        lda <$17
        sta $0002
        lda <$19
        sta $0003
        inc <$14
        inx
        cpx #$80
        bne xcol5
        inc <$12
        lda <$12
        cmp #$20
        beq bat5done
        jmp row5
bat5done:
"""

BAT_FORMULA6_ASM = """\
        ; BAT at VRAM 0, 64x64 = 4096 words; entry = formula (see genroms.py)
        ; NOTE: every zp operand is written <$xx (see the scene-3 loop note).
        ; tile = 0x100 | ((x + y) & 0x3F)  (odd y-coefficient: rows 32 apart
        ; differ; tiles live at chars 0x100+, above the 4096-word BAT),
        ; palette = (x + 2y) & 0xF.  x+y <= 126, x+2y <= 189: 8 bits.
        st0 #$00
        st1 #$00
        st2 #$00                ; MAWR = 0
        st0 #$02
        stz <$12                ; y = 0
row6:
        lda <$12
        sta <$14                ; x + y (starts at y, +1 per x)
        clx                     ; x = 0
xcol6:
        lda <$14
        clc
        adc <$12
        and #$0f                ; palette = (x + 2y) & 0xF
        asl A
        asl A
        asl A
        asl A
        sta <$19                ; palette << 4
        lda <$14
        and #$3f                ; tile low = 0x100 | ((x + y) & 0x3F)
        sta <$17
        lda #$01
        sta <$18                ; tile high nibble 0x1 (0x100 = bit 8)
        lda <$19
        ora <$18                ; high byte = (palette << 4) | 0x1
        sta <$19
        lda <$17
        sta $0002
        lda <$19
        sta $0003
        inc <$14
        inx
        cpx #$40
        bne xcol6
        inc <$12
        lda <$12
        cmp #$40
        beq bat6done
        jmp row6
bat6done:
"""

BAT_FORMULA7_ASM = """\
        ; BAT at VRAM 0, 128x64 = 8192 words (two VRAM banks); entry = formula
        ; NOTE: every zp operand is written <$xx (see the scene-3 loop note).
        ; tile = 0x200 | (((x + 2y) & 0x7F) >> 1), palette = (x + 3y) & 0xF.
        ; Tiles live at chars 0x200+ (words 0x2000+): the 8192-word BAT
        ; consumes words 0..8191, so 0x100+ would overlap rows 32-39.
        ; x+2y <= 253 fits 8 bits; x+3y reaches 316, but the wrap subtracts
        ; 256 and 256 & 0xF = 0, so the 8-bit sum's low nibble is still
        ; (x + 3y) & 0xF.
        st0 #$00
        st1 #$00
        st2 #$00                ; MAWR = 0
        st0 #$02
        stz <$12                ; y = 0
row7:
        lda <$12
        asl A
        sta <$14                ; x + 2y (starts at 2y, +1 per x)
        clx                     ; x = 0
xcol7:
        lda <$14
        clc
        adc <$12
        and #$0f                ; palette = (x + 3y) & 0xF (wrap-safe, see above)
        asl A
        asl A
        asl A
        asl A
        sta <$19                ; palette << 4
        lda <$14
        and #$7f
        lsr A                   ; tile low = 0x200 | (((x + 2y) & 0x7F) >> 1)
        sta <$17
        lda #$02
        sta <$18                ; tile high nibble 0x2 (0x200 = bit 9)
        lda <$19
        ora <$18                ; high byte = (palette << 4) | 0x2
        sta <$19
        lda <$17
        sta $0002
        lda <$19
        sta $0003
        inc <$14
        inx
        cpx #$80
        bne xcol7
        inc <$12
        lda <$12
        cmp #$40
        beq bat7done
        jmp row7
bat7done:
"""

BAT_LOOPS = {"s3": BAT_FORMULA_ASM,
             "s5": BAT_FORMULA5_ASM,
             "s6": BAT_FORMULA6_ASM,
             "s7": BAT_FORMULA7_ASM}


# ---- sprite scenes (#12; sprite9-11 close REVIEW-12's three misses, #40) ----
# Sprite model (VDC manual 2.4 p. H7-19..H7-24; Mednafen vdc.cpp and HuDK
# sprites.inc as references — see docs/RENDERER.md): SAT word 0 = Y (bits
# 0-9, 64 = display row 0), word 1 = X (bits 0-9, 32 = display column 0),
# word 2 = pattern << 1 (bit 0 = 4-colour mode, not used), word 3 = palette
# bits 0-3, SPBG bit 7, CGX bit 8, HFLIP bit 11, CGY bits 12-13, VFLIP 15.
# Sizes: CGY 00/01/10/11 -> 16/32/64/64 rows, CGX -> 32 columns (two 16-px
# strips).  Pattern p (word 2 >> 1) addresses a 64-word VRAM cell at p*64:
# SG0..SG3 planes at +0/+16/+32/+48 words + row.  The VDC masks p's low
# bits per size and adds the block/half select: 16x16 = cell p; 16x32 =
# cells p&~2, p&~2+2 (the manual's 2CGY: blocks are pattern codes with
# PC2 = pattern bit 1); 16x64 = p&~6+{0,2,4,6} (4CGY: PC3,PC2); 32-px wide
# = halves at p&~1, p&~1+1 (CGX: PC1), HFLIP swapping them.  Scale sources:
# Mednafen vdc.cpp FetchSpriteData reads no*64; MagicKit spr_pattern stores
# addr>>5 into word 2 whose bit 0 is the CG bit, so the cell is addr>>6 —
# the MiSTer core's tile select (PC(10:4)&TILE_N, 64-word tiles) agrees.
# The SAT lives at VRAM 0x7F00 (DVSSR) and DCR bit 4 = SATB DMA moves it
# into the SATB at every VBlank.  At most 16 strips per display line, in
# SATB order (lowest SAT index = highest priority): later sprites on the
# line are dropped.  Pixel 0 is transparent; the sprite wins over a BG
# pixel of colour 0, and SPBG=1 wins over any BG pixel.

# SG pattern word (plane pl, row r) of pattern p: ROTL16(P_pl, (r + p) & 0xF).
# Plane constants P_0..P_3.  P_3 = 0x00FF has rotation period exactly 16, so
# all 16 rows of every pattern differ; the formula also keeps every word's
# two bytes different from any other plane's, so flips/size mistakes change
# pixels.  The ROM computes the same words with a rotate loop (SG_FORMULA_ASM
# below); this is the generator's mirror for verification.
SG_PLANES = [0x5555, 0x3333, 0x0F0F, 0x00FF]


def sg_word(pat, plane, row):
    n = (row + pat) & 0xF
    w = SG_PLANES[plane]
    return ((w << n) | (w >> (16 - n))) & 0xFFFF if n else w


def _spr(x, y, pal=0, spbg=1, cgx=0, cgy=0, hflip=0, vflip=0):
    """One SAT entry: x/y are SAT field values (display column/row + 32/64)."""
    return dict(x=x, y=y, pal=pal, spbg=spbg, cgx=cgx, cgy=cgy,
                hflip=hflip, vflip=vflip)


def pack_patterns(sprites):
    """Assign contiguous SG pattern bases from 0x80 (VRAM 0x2000+).  The SAT
    pattern code addresses 64-word cells (cell p -> VRAM word p*64, planes
    at +0/+16/+32/+48 + row); one sprite's SG data is one or more cells:
    16x16 = 1 cell; 16x32 = cells p&~2, p&~2+2 (the odd cells of the span
    are free but reserved — packing stays contiguous); 16x64 = p&~6 +
    {0,2,4,6}; 32x16 = p&~1, p&~1+1; 32x32 = p&~3..p&~3+3; 32x64 =
    p&~7..p&~7+7.  Returns (pat0, nblocks, [base per sprite])."""
    cursor = 0x80
    bases = []
    blocks = []
    for s in sprites:
        h = [16, 32, 64, 64][s["cgy"]]
        # cells the VDC reads, and the reserved span (CGX cells are
        # consecutive; CGY-only blocks sit 2 apart, span 2*blocks)
        if s["cgx"]:
            size, align = {16: (2, 2), 32: (4, 4), 64: (8, 8)}[h]
        else:
            size, align = {16: (1, 1), 32: (4, 4), 64: (8, 8)}[h]
        base = (cursor + align - 1) & ~(align - 1)
        bases.append(base)
        blocks += list(range(base, base + size))
        cursor = max(blocks[-size:]) + 1
    return 0x80, max(blocks) - 0x80 + 1, bases


def sat_words(sprites, bases):
    words = []
    for s, pat in zip(sprites, bases):
        w3 = ((s["pal"] & 0xF) | ((s["spbg"] & 1) << 7) | ((s["cgx"] & 1) << 8)
              | ((s["hflip"] & 1) << 11) | ((s["cgy"] & 3) << 12)
              | ((s["vflip"] & 1) << 15))
        words += [s["y"] & 0x3FF, s["x"] & 0x3FF, (pat << 1) & 0x7FF, w3]
    assert len(words) <= 256
    words += [0] * (256 - len(words))
    return words


def _sprites(*args):
    return [_spr(*a) for a in args]


SPRITE_SCENES = {
    # sprite1 "sizes": all six sizes on one row, distinct palettes.  Every
    # sprite has a different pattern range, so a renderer that misreads CGX/
    # CGY (e.g. draws a 16x16 from a 32x64's pattern, or the right CGY
    # blocks) shows the wrong pixels everywhere.
    "sprite1": dict(mwr=0x00, bxr=0, byr=0, cr=0xC0, dcr=DCR,
                    bat_w=32, bat_h=32, bat_tables=True, bg="scene1",
                    tiles=[(0x040, 32), (0xF00, 16)],
                    sprites=_sprites(
                        (40, 66, 0), (64, 66, 1, 1, 0, 1), (88, 66, 2, 1, 0, 3),
                        (112, 66, 3, 1, 1), (152, 66, 4, 1, 1, 1),
                        (192, 66, 5, 1, 1, 3))),
    # sprite2 "flips": normal / X / Y / XY, then a 32-px X-flip (halves
    # swapped) and a 16x32 Y-flip (blocks reversed).  Each sprite its own
    # pattern so a wrong flip direction (or no flip) is visible per-sprite.
    "sprite2": dict(mwr=0x00, bxr=0, byr=0, cr=0xC0, dcr=DCR,
                    bat_w=32, bat_h=32, bat_tables=True, bg="scene1",
                    tiles=[(0x040, 32), (0xF00, 16)],
                    sprites=_sprites(
                        (40, 66, 0), (72, 66, 1, 1, 0, 0, 1),
                        (104, 66, 2, 1, 0, 0, 0, 1), (136, 66, 3, 1, 0, 0, 1, 1),
                        (168, 66, 4, 1, 1, 0, 1), (200, 66, 5, 1, 0, 1, 0, 1))),
    # sprite3 "priority": the BG is transparent (colour 0) left of display
    # column 128 and solid colour 7 right of it (#40 found that right half
    # was colour 0 in every capture — the stripes tiles were written into
    # the BAT — and fixed the addresses; sprite3 re-captured).  Every sprite
    # here sits over the transparent half: SPBG=0 shows over colour 0 (s0,
    # s2) and an SPBG=1 control shows too (s1).  s3/s4 overlap: s3 (SPBG=0,
    # lower SAT index) wins the overlap pixels where both show.  The solid
    # half's cases live in sprite10: an SPBG=0 sprite is hidden over colour
    # 7 there, an SPBG=1 sprite shows over it.
    "sprite3": dict(mwr=0x00, bxr=0, byr=0, cr=0xC0, dcr=DCR,
                    bat_w=32, bat_h=32, bat_tables=True, bg="stripes",
                    tiles=[],
                    sprites=_sprites(
                        (56, 66, 0, 0), (72, 66, 1, 1), (88, 66, 2, 0),
                        (56, 90, 3, 0), (56, 94, 4, 1))),
    # sprite4 "17line": 19 sprites on row 66 — 16 strips fit a line, so the
    # VDC shows SAT indices 0..15 and drops 16..18 (SATB order).  The last
    # sprite sits on its own line and must still show: the limit is per
    # line, not per frame.  Spacing 13 px < 16 px width, so neighbours
    # overlap 3 columns and the higher SAT index must lose the overlap.
    "sprite4": dict(mwr=0x00, bxr=0, byr=0, cr=0xC0, dcr=DCR,
                    bat_w=32, bat_h=32, bat_tables=True, bg="scene1",
                    tiles=[(0x040, 32), (0xF00, 16)],
                    sprites=_sprites(*[(32 + 13 * i, 66, i & 0xF)
                                       for i in range(19)]
                                     + [(32, 150, 3)])),
    # sprite5 "palettes": 16 sprites, one per sprite palette, 4x4 grid.
    # Each palette's CRAM entries (0x100 + pal*16 + pixel) are distinct, so
    # a wrong palette shift changes every pixel of that sprite.
    "sprite5": dict(mwr=0x00, bxr=0, byr=0, cr=0xC0, dcr=DCR,
                    bat_w=32, bat_h=32, bat_tables=True, bg="scene1",
                    tiles=[(0x040, 32), (0xF00, 16)],
                    sprites=_sprites(*[(32 + (i & 3) * 56, 66 + (i >> 2) * 40, i)
                                       for i in range(16)])),
    # sprite6 "clip": left/right/top/bottom clipping (s0..s3), a fully
    # visible reference (s4) and one entirely above the picture (s5, must
    # not draw).  Each clipped sprite keeps a distinctive slice visible.
    "sprite6": dict(mwr=0x00, bxr=0, byr=0, cr=0xC0, dcr=DCR,
                    bat_w=32, bat_h=32, bat_tables=True, bg="scene1",
                    tiles=[(0x040, 32), (0xF00, 16)],
                    sprites=_sprites(
                        (24, 66, 0), (280, 66, 1), (40, 60, 2), (80, 290, 3),
                        (100, 66, 4), (120, 30, 5))),
    # sprite7 "cgy": 16x64 straight (blocks at p+0/+2/+4/+6 in order), the
    # same Y-flipped (blocks reversed, rows reversed within each block),
    # 16x32, and a 32x64 (8 consecutive patterns).  All four CGY code
    # points, both directions.
    "sprite7": dict(mwr=0x00, bxr=0, byr=0, cr=0xC0, dcr=DCR,
                    bat_w=32, bat_h=32, bat_tables=True, bg="scene1",
                    tiles=[(0x040, 32), (0xF00, 16)],
                    sprites=_sprites(
                        (40, 66, 0, 1, 0, 3), (72, 66, 1, 1, 0, 3, 0, 1),
                        (104, 66, 2, 1, 0, 1), (136, 66, 3, 1, 1, 3))),
    # sprite8 "bgon": background off (CR=0x40: SB set, BB clear).  Every BG
    # pixel is the blanking colour 0x100 — whose low nibble is 0, so an
    # SPBG=0 sprite shows over it like over any BG colour 0 (s0, s2); an
    # SPBG=1 sprite shows everywhere (s1).  A renderer that hides sprites
    # when BB is clear, or hides SPBG=0 sprites on the blank fill, diffs.
    "sprite8": dict(mwr=0x00, bxr=0, byr=0, cr=0x40, dcr=DCR,
                    bat_w=32, bat_h=32, bat_tables=True, bg="scene1",
                    tiles=[(0x040, 32), (0xF00, 16)],
                    sprites=_sprites(
                        (40, 66, 0, 0), (72, 66, 1, 1), (104, 66, 2, 0, 0, 3))),
    # sprite9 "cgy2": a 16x64 sprite with CGY=2 — the one CGY code no
    # earlier scene carries (REVIEW-12: 0 of the 64 SAT entries across
    # sprite1-8; CGY 0/1/3 have 56/4/6).  REVIEW-12's M2 (CGY_HEIGHT[2]
    # 64 -> 32) passed for lack of it; under M2 this sprite draws 32 tall
    # and rows 34..65 of it disappear into the background -> diff.
    "sprite9": dict(mwr=0x00, bxr=0, byr=0, cr=0xC0, dcr=DCR,
                    bat_w=32, bat_h=32, bat_tables=True, bg="scene1",
                    tiles=[(0x040, 32), (0xF00, 16)],
                    sprites=_sprites(
                        (112, 66, 0, 1, 0, 2))),
    # sprite10 "spbg0": an SPBG=0 sprite over an opaque BG tile.  The
    # stripes background is colour 7 right of display column 128 (a
    # nonzero low nibble), so s0 (SPBG=0, cols 128..143) must be HIDDEN by
    # the background.  REVIEW-12's M9 (SPBG ignored: every opaque sprite
    # pixel replaces the BG) passed because no scene had an SPBG=0 sprite
    # over a nonzero-nibble BG pixel; under M9 s0 is drawn -> diff.  s1
    # (SPBG=1 over the solid half) and s2 (SPBG=0 over colour 0, which
    # must SHOW) keep the scene honest — M10 (SPBG=0 never draws) still
    # fails here too.
    "sprite10": dict(mwr=0x00, bxr=0, byr=0, cr=0xC0, dcr=DCR,
                     bat_w=32, bat_h=32, bat_tables=True, bg="stripes",
                     tiles=[],
                     sprites=_sprites(
                         (160, 66, 0, 0), (184, 66, 1, 1), (104, 66, 2, 0))),
    # sprite11 "cgx16": a line of 15 strips with a CGX sprite as the 16th
    # SAT entry.  15 single-strip sprites fill the line's budget; the CGX
    # sprite's left half is strip 16 (drawn), its right half strip 17
    # (dropped) — REVIEW-12's M24 (the CGX guard pushed the right half
    # anyway) passed because no scene reached a CGX entry with 15 strips
    # already collected (max was 7).  Under M24 the right half appears at
    # cols 226..241 -> diff.  Spacing 14 px: neighbours overlap 2 columns
    # and the higher SAT index wins, so the scene also re-proves SATB
    # priority on the same line as the limit.
    "sprite11": dict(mwr=0x00, bxr=0, byr=0, cr=0xC0, dcr=DCR,
                     bat_w=32, bat_h=32, bat_tables=True, bg="scene1",
                     tiles=[(0x040, 32), (0xF00, 16)],
                     sprites=_sprites(*[(32 + 14 * i, 66, i & 0xF)
                                        for i in range(15)]
                                      + [(242, 66, 15, 1, 1, 0)])),
    # sprite12 "sat2063" (#42): 64 sprites in an 8x8 grid, one per SAT entry,
    # so entries 20-63 are all live and entry 63 (bottom-right) is visible.
    # REVIEW-14's A2 (a viewer copying only the first 20 SAT entries) was
    # MISSED because every scene stopped at entry 19; here the A2 copy loses
    # 44 sprites and sat.bin differs at byte 160 (entry 20).  Eight 16-px
    # sprites per row = 128 px: inside the 16-strip / 256-px line budget, so
    # the hardware drops nothing.  pal = i & 0xF (sprite5's grid extended),
    # each sprite its own pattern cell.
    "sprite12": dict(mwr=0x00, bxr=0, byr=0, cr=0xC0, dcr=DCR,
                     bat_w=32, bat_h=32, bat_tables=True, bg="scene1",
                     tiles=[(0x040, 32), (0xF00, 16)],
                     sprites=_sprites(*[(32 + (i & 7) * 28, 66 + (i >> 3) * 24,
                                         i & 0xF) for i in range(64)])),
}

SG_FORMULA_ASM = """\
        ; sprite generator (SG): 64 words per pattern cell, plane-major — the
        ; VDC reads plane pl, row r of cell p at word p*64 + pl*16 + r
        ; (SG0..SG3 = +0/+16/+32/+48), for the contiguous cells $80..
        ; (pack_patterns in genroms.py).
        ; word (plane, row) of cell p = ROTL16(P_plane, (row + p) & 0xF)
        ; with P = 0x5555, 0x3333, 0x0F0F, 0x00FF — sg_word() in genroms.py
        ; is the generator's mirror.  NOTE: every zp operand is written <$xx
        ; (pceas emits bare $12 as a 16-bit absolute address aliasing the
        ; VDC I/O page — see the scene-3 loop note).
        st0 #$02                ; MAWR was set to $80*64 = $2000 before this
        stz <$20                ; block counter (cell = $80 + counter)
sgnext:
        stz <$22                ; plane = 0
sgplane:
        lda <$22
        tax
        lda sgconst_lo, X
        sta <$25
        lda sgconst_hi, X
        sta <$26                ; constant P_plane (kept: rotate consumes <$23)
        stz <$21                ; row = 0
sgrow:
        lda <$25
        sta <$23
        lda <$26
        sta <$24                ; word = P_plane
        lda <$20
        clc
        adc <$21
        and #$0f                ; n = (row + cell) & 0xF ($80 low nibble 0)
        tax
        beq sgstore
sgrot:
        asl <$23                ; 16-bit rotate left: lo <<= 1, carry -> hi
        rol <$24                ; hi = hi<<1 | carry; carry = old bit 15
        bcc sgrot1
        inc <$23                ; old bit 15 -> lo bit 0
sgrot1:
        dex
        bne sgrot
sgstore:
        lda <$23
        sta $0002
        lda <$24
        sta $0003
        inc <$21
        lda <$21
        cmp #16
        bne sgrow
        inc <$22
        lda <$22
        cmp #4
        bne sgplane
        inc <$20
        lda <$20
        cmp #%d
        bne sgnext
"""


def gen_sprite_asm(name):
    """Sprite scenes: scene 1's background (or the sprite3 stripes), the SG
    patterns, the SAT at VRAM 0x7F00 and sprites on."""
    s = SPRITE_SCENES[name]
    cram = cr_words()
    cram_lo = [w & 0xFF for w in cram]
    cram_hi = [(w >> 8) & 1 for w in cram]

    if s["bg"] == "stripes":
        # left half of the BAT reads an all-transparent tile (colour 0 ->
        # CRAM[0x000]), right half an all-colour-7 tile.  vbase is char*16
        # like tile_region_bytes' regions (#40: was 0x040/0x041 — the tile
        # data landed in the BAT at words 0x0040/0x0050 and the real cells
        # stayed zero, so both halves were colour 0 and the "solid right
        # half" was never in any capture; sprite3 re-captured with the fix).
        # A solid pixel value 7 decodes MSB-first (bit 7-col, like the
        # renderer's FixTileCache reference): CH0..CH2 = 0xFF, CH3 = 0x00 —
        # word (row) = 0xFFFF, word (row+8) = 0x00FF.  The old 0x7777 was
        # nibble/LSB thinking and displayed as 0x0/0xF stripes, not colour 7.
        tile_bytes = bytearray(bytes(32)) + bytearray(
            bytes([0xFF, 0xFF]) * 8 + bytes([0xFF, 0x00]) * 8)
        regions = [(0x400, 0x040, 1), (0x410, 0x041, 1)]
        bat_bytes = bytearray()
        for y in range(32):
            for x in range(32):
                bat_bytes += bytes((0x040 if x < 16 else 0x041, 0x00))
    else:  # scene 1's picture
        tile_bytes, regions = tile_region_bytes(1, s["tiles"])
        bat_bytes = bat_bytes_full(1, s["bat_w"], s["bat_h"])

    pat0, nblocks, bases = pack_patterns(s["sprites"])
    assert pat0 == 0x80, "SG loop assumes PAT0 = $80"
    sat_bytes = bytearray()
    for w in sat_words(s["sprites"], bases):
        sat_bytes += bytes((w & 0xFF, (w >> 8) & 0xFF))

    out = []
    out.append(f";; PCEStudio sprite scene {name} — generated by "
               "tools/genroms.py, do not edit")
    out.append(f";; {s['bat_w']}x{s['bat_h']} BAT, CR=${s['cr']:02x}, "
               f"{len(s['sprites'])} SAT entries, SG patterns "
               f"${pat0:03x}..${pat0 + nblocks - 1:03x}")
    out.append("        .code")
    out.append("        .bank 0")
    out.append("        .org $fff6")
    out.append("        .dw irq2")
    out.append("        .dw irq1")
    out.append("        .dw timer")
    out.append("        .dw nmi")
    out.append("        .dw reset")
    out.append("")
    out.append("        .code")
    out.append("        .bank 0")
    out.append("        .org $e000")
    out.append("")
    out.append("reset:")
    out.append("        sei")
    out.append("        csh")
    out.append("        cld")
    out.append("        ldx #$ff")
    out.append("        txs")
    out.append("        lda #$ff")
    out.append("        tam0")
    out.append("        lda #$f8")
    out.append("        tam1")
    out.append("")
    out.append("        ; VCE: 263-line mode, 5.37 MHz dot clock (256 px)")
    out.append("        lda #$04")
    out.append("        sta $0400")
    out.append("")
    out.append("        ; colour table: 512 entries (CTA autoincrements on high write)")
    out.append("        stz $0402")
    out.append("        stz $0403")
    out.append("        clx")
    out.append("cram0:")
    out.append("        lda cram0_lo, X")
    out.append("        sta $0404")
    out.append("        lda cram0_hi, X")
    out.append("        sta $0405")
    out.append("        inx")
    out.append("        bne cram0")
    out.append("        clx")
    out.append("cram1:")
    out.append("        lda cram1_lo, X")
    out.append("        sta $0404")
    out.append("        lda cram1_hi, X")
    out.append("        sta $0405")
    out.append("        inx")
    out.append("        bne cram1")
    out.append("")
    out.append("        ; VDC init (HuDK vdc_init_table values; DCR bit 4 =")
    out.append("        ; SATB DMA — the SAT is written below and the SATB")
    out.append("        ; follows it on the next VBlank)")
    emit_vdc_regs(out, s)
    out.append("")

    out.append(f"        ; BAT: {len(bat_bytes) // 2} words at VRAM 0")
    out.append("        st0 #$00")
    out.append("        st1 #$00")
    out.append("        st2 #$00")
    out.append("        st0 #$02")
    lo_pages, hi_pages = pages_of(bytes(bat_bytes))
    emit_copy_loop(out, "bat_", lo_pages, hi_pages)
    out.append("")

    # ---- tiles, one copy region per (char0, count)
    out.append(f"        ; tiles: {len(tile_bytes) // 2} words")
    page_tables = []
    remaining = bytes(tile_bytes)
    for vbase, char0, count in regions:
        words = count * 16
        region = remaining[0:words * 2]
        remaining = remaining[words * 2:]
        lo_pages, hi_pages = pages_of(region)
        out.append(f"        ; region at VRAM ${vbase:04x}")
        out.append("        st0 #$00")
        out.append(f"        st1 #${vbase & 0xff:02x}")
        out.append(f"        st2 #${(vbase >> 8) & 0xff:02x}")
        out.append("        st0 #$02")
        label = f"tile{len(page_tables)}_"
        emit_copy_loop(out, label, lo_pages, hi_pages)
        out.append("")
        for p in range(len(lo_pages)):
            page_tables.append((label, p, lo_pages[p], hi_pages[p]))

    # ---- SG patterns (formula loop, 64 words per cell)
    out.append(f"        ; SG cells ${pat0:03x}..${pat0 + nblocks - 1:03x} "
               f"at VRAM ${pat0 * 64:04x} ({nblocks * 64} words)")
    out.append("        st0 #$00")
    out.append("        st1 #$00")
    out.append("        st2 #$20")
    out.append(SG_FORMULA_ASM % nblocks)
    out.append("")

    # ---- SAT (64 entries x 4 words at VRAM 0x7F00)
    out.append("        ; SAT: 64 entries at VRAM 0x7F00 (DVSSR); the SATB")
    out.append("        ; DMA (DCR bit 4) copies it into the SATB every VBlank")
    out.append("        st0 #$00")
    out.append("        st1 #$00")
    out.append("        st2 #$7f")
    out.append("        st0 #$02")
    lo_pages, hi_pages = pages_of(bytes(sat_bytes))
    emit_copy_loop(out, "sat_", lo_pages, hi_pages)
    out.append("")

    out.append("        ; sprites on (CR bit 6 = SB); "
               + ("background on (BB)" if s["cr"] & 0x80
                  else "background off (BB clear): every BG pixel is the "
                       "blanking colour CRAM[0x100]"))
    out.append("        st0 #$05")
    out.append(f"        st1 #${s['cr']:02x}")
    out.append("        st2 #$00")
    out.append("")
    out.append("loop:")
    out.append("        bra loop")
    out.append("")
    out.append("irq2:")
    out.append("irq1:")
    out.append("timer:")
    out.append("nmi:")
    out.append("        rti")
    out.append("")
    # ---- data tables
    out += emit_byte_table("cram0_lo", bytes(cram_lo[0:256]))
    out += emit_byte_table("cram0_hi", bytes(cram_hi[0:256]))
    out += emit_byte_table("cram1_lo", bytes(cram_lo[256:512]))
    out += emit_byte_table("cram1_hi", bytes(cram_hi[256:512]))
    out.append("")
    out += emit_byte_table("sgconst_lo", bytes([w & 0xFF for w in SG_PLANES]))
    out += emit_byte_table("sgconst_hi", bytes([w >> 8 for w in SG_PLANES]))
    out.append("")
    lo_pages, hi_pages = pages_of(bytes(bat_bytes))
    for p in range(len(lo_pages)):
        out += emit_byte_table(f"bat_{p}_lo", lo_pages[p])
        out += emit_byte_table(f"bat_{p}_hi", hi_pages[p])
    out.append("")
    lo_pages, hi_pages = pages_of(bytes(sat_bytes))
    for p in range(len(lo_pages)):
        out += emit_byte_table(f"sat_{p}_lo", lo_pages[p])
        out += emit_byte_table(f"sat_{p}_hi", hi_pages[p])
    out.append("")
    for label, p, lo, hi in page_tables:
        out += emit_byte_table(f"{label}{p}_lo", lo)
        out += emit_byte_table(f"{label}{p}_hi", hi)
    out.append("")
    return "\n".join(out)


# ---- raster scenes (#15) ---------------------------------------------------
# Per-scanline CPU writes to BXR, BYR, CR and the VCE colour table, driven
# from the RCR line interrupt (CR bit 2 = RC).  Each ROM arms a
# self-chaining RCR interrupt at boot: the interrupt fires when the VDC's
# line counter reaches RCR - 0x40, i.e. at the END of VDW line L-1, so the
# step's writes land during the HBlank before line L and take effect on
# line L (BXR/BYR "valid with the next scanning line", CR "from the next
# horizontal display period").  Step counter <$30, entry tables indexed by
# step; every step re-arms RCR to 0x40 + the next entry's line and the
# last step wraps to step 0, so the chain runs every frame without the VD
# interrupt.  raster_json() writes the same entries (plus the base
# register and CRAM values) into tools/gen/rasterN.raster.json for the
# renderer; tests/check.js checks both against the save state.
#
#   r1 "statusbar"  scene-1 picture; steps at VDW lines 160..232 write
#                   BYR=0x1FF -> a 73-line band frozen at BAT row 0 that
#                   does not scroll while the picture above scrolls.  The
#                   frame-start latch (VDW line 0, RCRCount reset) takes
#                   the BYR register — which keeps the previous frame's
#                   last write — so lines 1..159 of every frame show
#                   bgY = 0x1FF + L: the cross-frame register persistence
#                   witness.
#   r2 "wobble"     steps at lines 1..232 write BXR = wob[s]
#                   (128+100*sin(2*pi*s/64)): per-line horizontal wobble
#                   of the BAT columns.
#   r3 "byr"        two mid-frame BYR writes (line 80 -> 0x30, line 160
#                   -> 8): three bands, each shifted differently, and the
#                   top band witnesses the frame-start value = the table's
#                   LAST byr entry (8), not the base (0).
#   r4 "palette"    steps at lines 1..232 write CRAM entry s = grad[s] +
#                   frame ((s*13+0x40)&0x1FF plus a frame counter bumped
#                   once per chain, ZP <$31>): the values shift by 1 every
#                   frame, so at any row the entries past it still show the
#                   previous frame's values — the picture proves the
#                   per-line CRAM application (a renderer applying all
#                   entries to all rows, or a line late, diffs).  CTA reset
#                   per step; the gradient covers palettes 0..14 with many
#                   green-top-bit (bit 8) values; the colour table persists
#                   across frames (no reset).  raster-patch.py writes the
#                   captured frame counter into the dump's raster.json.
#   r5 "cr"         scene-1 picture + two sprites (SATB DMA); steps write
#                   CR=0x84 at line 100 (SB off: the sprite's bottom rows
#                   vanish), CR=0x44 at line 160 (BB off: blanking fill,
#                   the SPBG=0 sprite still shows over it), CR=0xC4 at
#                   line 240 (restore for the next frame — the table's
#                   last entry is what the next frame's line 0 latches,
#                   closing the loop).


def raster_wobble(s):
    """r2's BXR value for step s (s = 0..231)."""
    return (128 + round(100 * math.sin(2 * math.pi * s / 64))) & 0x3FF


def raster_grad(s):
    """r4's CRAM value for entry s (s = 0..231): 232 distinct 9-bit
    values, all with bit 6 set (0x40 <= v <= 0x1FF), many with the green
    top bit (bit 8) set."""
    return ((s * 13 + 0x40) & 0x1FF)


def raster_ramp(s):
    """r7/r10's per-line colour value for step s (s = 0..231): the full
    9-bit linear ramp (s * 511) // 231, 0 -> 511.  Consecutive lines differ
    (the blue channel steps every ~3 lines, red and green every ~29), so a
    write one line early or late changes a whole solid region on most rows
    (REVIEW-15's M10/M11 were 1-2 px per row on r4's noise), and the eye
    sees a staircase gradient."""
    return (s * 511) // 231


# #43 (REVIEW-15's misses and weak witnesses): palette 0's colours 1..7
# become seven bright, pairwise-distinct hues — cr_words()'s entries 1..7
# are nearly-black blues that no eye tells apart.  The bands tiles display
# colour ((t & 31) % 7) + 1, so the picture is seven-colour diagonal bands;
# r7's per-line writes ramp CRAM[0x000] (backdrop, left half) and
# CRAM[0x007] (palette-0 colour 7, right half) — the review's "a colour
# that covers a large area each line".
RASTER_HUES_CRAM = {0x001: 0x038, 0x002: 0x1C0, 0x003: 0x007, 0x004: 0x1F8,
                    0x005: 0x1C7, 0x006: 0x03F, 0x007: 0x1FF}
RASTER_BANDS = {"r6", "r8", "r9", "r10"}
RASTER_STRIPES = {"r7"}


def scene_cram_words(name):
    """The colour table a raster scene's ROM boots with: cr_words() plus the
    scene's overrides (the #43 hues).  gen_raster_asm and raster_json must
    agree — check.js verifies the save state against baseCram."""
    words = cr_words()
    for addr, val in RASTER_SCENES.get(name, {}).get("cram_ov", {}).items():
        words[addr] = val
    return words


def raster_entries(name):
    if name == "r1":
        return [{"line": L, "byr": 0x1FF} for L in range(160, 233)]
    if name == "r2":
        return [{"line": s + 1, "bxr": raster_wobble(s)} for s in range(232)]
    if name == "r3":
        return [{"line": 80, "byr": 0x30}, {"line": 160, "byr": 8}]
    if name == "r4":
        return [{"line": s + 1, "cram": [[s, raster_grad(s)]]}
                for s in range(232)]
    if name == "r5":
        return [{"line": 100, "cr": 0x84}, {"line": 160, "cr": 0x44},
                {"line": 240, "cr": 0xC4}]
    if name == "r6":
        # r3's two-step BYR split, on the bands picture (the band edges at
        # lines 80/160 are visible; band 1 and band 3 scroll alike, band 2
        # is offset — the top band keeps witnessing the frame-start latch)
        return [{"line": 80, "byr": 0x30}, {"line": 160, "byr": 8}]
    if name == "r7":
        # per-line writes to the two solid regions: left half = backdrop
        # CRAM[0x000] ramps 0 -> 511, right half = colour 7 CRAM[0x007]
        # ramps 511 -> 0 — two large-area per-line gradients
        return [{"line": s + 1,
                 "cram": [[0x000, raster_ramp(s)],
                          [0x007, 511 - raster_ramp(s)]]}
                for s in range(232)]
    if name == "r8":
        # r2's wobble, but the chain starts at line 50: rows 1..49 display
        # the previous frame's last write (wobble(182) = 45), not
        # raster.base 0 — REVIEW-15's M6 witness (the BXR frame-start
        # latch).  Under M6 the top 49 rows shift back by 5 columns.
        return [{"line": s + 50, "bxr": raster_wobble(s)}
                for s in range(183)]
    if name == "r9":
        # r2's wobble on the bands picture; captured with SLSTART=6
        # SLEND=237 so vdwLine0 = 3 — REVIEW-15's M16 witness (hard-wiring
        # 1 lands every entry two rows off)
        return [{"line": s + 1, "bxr": raster_wobble(s)} for s in range(232)]
    if name == "r10":
        # per-line writes to CRAM[0x101] — sprite palette 0's colour 1 —
        # over two solid-pattern sprites (SAT y=104: rows 40..103 and
        # 40..55): the sprite bodies show the per-line ramp, REVIEW-15's
        # M19 witness (sprite pixels decoded through the flat CRAM)
        return [{"line": s + 1, "cram": [[0x101, raster_ramp(s)]]}
                for s in range(232)]
    raise AssertionError(name)


RASTER_SCENES = {
    "r1": dict(kind="byr_const", mwr=0x00, bxr=0, byr=0, cr=0x84, dcr=DCR,
               tiles=[(0x040, 32), (0xF00, 16)], entries=raster_entries("r1")),
    "r2": dict(kind="bxr_table", mwr=0x00, bxr=0, byr=0, cr=0x84, dcr=DCR,
               tiles=[(0x040, 32), (0xF00, 16)], entries=raster_entries("r2")),
    "r3": dict(kind="byr_table", mwr=0x00, bxr=0, byr=0, cr=0x84, dcr=DCR,
               tiles=[(0x040, 32), (0xF00, 16)], entries=raster_entries("r3")),
    "r4": dict(kind="cram_seq", mwr=0x00, bxr=0, byr=0, cr=0x84, dcr=DCR,
               tiles=[(0x040, 32), (0xF00, 16)], entries=raster_entries("r4"),
               frame_counter=True),
    # r5: scene-1 picture + two sprites.  s0 (16x64, SPBG=1, SAT y=104:
    # rows 40..103) shows in the top band and its bottom rows 100..103
    # must vanish when CR=0x84 clears SB at line 100.  s1 (16x16, SPBG=0,
    # SAT y=244: rows 180..195) sits in the CR=0x44 band: BB off, so every
    # BG pixel is the blanking fill 0x100 (low nibble 0) and the SPBG=0
    # sprite must still show over it.
    "r5": dict(kind="cr_table", mwr=0x00, bxr=0, byr=0, cr=0xC4, dcr=DCR,
               tiles=[(0x040, 32), (0xF00, 16)], entries=raster_entries("r5"),
               sprites=_sprites((40, 104, 1, 1, 0, 3), (220, 244, 2, 0))),
    # #43 (REVIEW-15): the same effects on structured tiles, so a person can
    # see them.  r6/r8/r9/r10 share the bands picture: BAT tile (x, y) =
    # 0x040 + (x + 2y) & 31, each tile solid colour ((t & 31) % 7) + 1 of
    # palette 0 — diagonal bands of seven bright hues (RASTER_HUES_CRAM),
    # where a BYR or BXR change shifts the pattern.  r7 is the #40 stripes
    # picture (colour 0 left of display column 128, colour 7 right): its
    # per-line writes ramp CRAM[0x000] and CRAM[0x007], two solid regions
    # covering the whole screen.  r9 uses r2's wobble table but is captured
    # with the crop shifted (SLSTART=6) so its vdwLine0 is 3, not 1.
    "r6": dict(kind="byr_table", mwr=0x00, bxr=0, byr=0, cr=0x84, dcr=DCR,
               bg="bands", tiles=[(0x040, 32)], entries=raster_entries("r6"),
               cram_ov=RASTER_HUES_CRAM),
    "r7": dict(kind="cram_dual", mwr=0x00, bxr=0, byr=0, cr=0x84, dcr=DCR,
               bg="stripes", tiles=[(0x040, 2)], entries=raster_entries("r7"),
               cram_ov=RASTER_HUES_CRAM),
    "r8": dict(kind="bxr_table", mwr=0x00, bxr=0, byr=0, cr=0x84, dcr=DCR,
               bg="bands", tiles=[(0x040, 32)], entries=raster_entries("r8"),
               cram_ov=RASTER_HUES_CRAM),
    "r9": dict(kind="bxr_table", mwr=0x00, bxr=0, byr=0, cr=0x84, dcr=DCR,
               bg="bands", tiles=[(0x040, 32)], entries=raster_entries("r9"),
               cram_ov=RASTER_HUES_CRAM),
    # r10: bands picture + two solid-pattern sprites (SPBG=1, sprite palette
    # 0, every visible pixel colour 1 -> CRAM[0x101], which the chain ramps
    # per line).  s0 is a 16x64 at SAT x=72 y=104 (display cols 40..55,
    # rows 40..103), s1 a 16x16 at x=182 y=104 (cols 150..165, rows
    # 40..55) — the per-line colour writes are visible on both sprite
    # bodies, over the opaque bands picture.
    "r10": dict(kind="cram_sprite", mwr=0x00, bxr=0, byr=0, cr=0xC4,
                dcr=DCR, bg="bands", tiles=[(0x040, 32)],
                entries=raster_entries("r10"), cram_ov=RASTER_HUES_CRAM,
                sprites=_sprites((72, 104, 0, 1, 0, 3), (182, 104, 0, 1, 0, 0)),
                solid_sprites=True),
}


def gen_raster_asm(name):
    """Raster scenes: scene 1's picture, [the SATB sprites for r5,] and the
    RCR-chained per-scanline writes in the irq2 handler."""
    s = RASTER_SCENES[name]
    entries = s["entries"]
    n = len(entries)
    cram = scene_cram_words(name)
    cram_lo = [w & 0xFF for w in cram]
    cram_hi = [(w >> 8) & 1 for w in cram]

    bg_scene = name if (name in RASTER_BANDS or name in RASTER_STRIPES) else 1
    tile_bytes, regions = tile_region_bytes(name, s["tiles"])
    bat_bytes = bat_bytes_full(bg_scene, 32, 32)

    sprites = s.get("sprites")
    if sprites:
        pat0, nblocks, bases = pack_patterns(sprites)
        assert pat0 == 0x80
        sat_bytes = bytearray()
        for w in sat_words(sprites, bases):
            sat_bytes += bytes((w & 0xFF, (w >> 8) & 0xFF))
    else:
        nblocks = 0
        sat_bytes = b""

    # the chain table: chain[i] is the RCR value that fires entry i —
    # the handler, having just fired entry i-1, arms chain[i] (its new
    # step); the boot arms chain[0]
    chain = [0x40 + entries[i]["line"] for i in range(n)]

    # the step's write values (raster_json() emits the same values as the
    # JSON entries — one source of truth, two consumers)
    step2_lo = step2_hi = []
    if s["kind"] in ("byr_const", "byr_table"):
        step_lo = [e["byr"] & 0xFF for e in entries]
        step_hi = [(e["byr"] >> 8) & 0xFF for e in entries]
    elif s["kind"] == "bxr_table":
        step_lo = [e["bxr"] & 0xFF for e in entries]
        step_hi = [(e["bxr"] >> 8) & 0xFF for e in entries]
    elif s["kind"] == "cr_table":
        step_lo = [e["cr"] for e in entries]
        step_hi = [0] * n
    elif s["kind"] == "cram_seq":
        step_lo = [e["cram"][0][1] & 0xFF for e in entries]
        step_hi = [(e["cram"][0][1] >> 8) & 0xFF for e in entries]
    elif s["kind"] in ("cram_dual", "cram_sprite"):
        step_lo = [e["cram"][0][1] & 0xFF for e in entries]
        step_hi = [(e["cram"][0][1] >> 8) & 0xFF for e in entries]
        if s["kind"] == "cram_dual":
            step2_lo = [e["cram"][1][1] & 0xFF for e in entries]
            step2_hi = [(e["cram"][1][1] >> 8) & 0xFF for e in entries]
    else:
        raise AssertionError(s["kind"])

    out = []
    out.append(f";; PCEStudio raster scene {name} — generated by "
               "tools/genroms.py, do not edit")
    out.append(f";; #15: {n} RCR-chained per-scanline writes (kind "
               f"{s['kind']}), base CR=${s['cr']:02x} BXR={s['bxr']} "
               f"BYR={s['byr']}")
    out.append("        .code")
    out.append("        .bank 0")
    out.append("        .org $fff6")
    out.append("        .dw irq2")
    out.append("        .dw irq1")
    out.append("        .dw timer")
    out.append("        .dw nmi")
    out.append("        .dw reset")
    out.append("")
    out.append("        .code")
    out.append("        .bank 0")
    out.append("        .org $e000")
    out.append("")
    out.append("reset:")
    out.append("        sei")
    out.append("        csh")
    out.append("        cld")
    out.append("        ldx #$ff")
    out.append("        txs")
    out.append("        lda #$ff")
    out.append("        tam0")
    out.append("        lda #$f8")
    out.append("        tam1")
    out.append("")
    out.append("        ; VCE: 263-line mode, 5.37 MHz dot clock (256 px)")
    out.append("        lda #$04")
    out.append("        sta $0400")
    out.append("")
    out.append("        ; colour table: 512 entries (CTA autoincrements on high write)")
    out.append("        stz $0402")
    out.append("        stz $0403")
    out.append("        clx")
    out.append("cram0:")
    out.append("        lda cram0_lo, X")
    out.append("        sta $0404")
    out.append("        lda cram0_hi, X")
    out.append("        sta $0405")
    out.append("        inx")
    out.append("        bne cram0")
    out.append("        clx")
    out.append("cram1:")
    out.append("        lda cram1_lo, X")
    out.append("        sta $0404")
    out.append("        lda cram1_hi, X")
    out.append("        sta $0405")
    out.append("        inx")
    out.append("        bne cram1")
    out.append("")
    out.append("        ; VDC init (HuDK vdc_init_table values; CR is set")
    out.append("        ; last, after the chain is armed)")
    emit_vdc_regs(out, s)
    out.append("")

    out.append(f"        ; BAT: {len(bat_bytes) // 2} words at VRAM 0")
    out.append("        st0 #$00")
    out.append("        st1 #$00")
    out.append("        st2 #$00")
    out.append("        st0 #$02")
    lo_pages, hi_pages = pages_of(bytes(bat_bytes))
    emit_copy_loop(out, "bat_", lo_pages, hi_pages)
    out.append("")

    out.append(f"        ; tiles: {len(tile_bytes) // 2} words")
    page_tables = []
    remaining = bytes(tile_bytes)
    for vbase, char0, count in regions:
        words = count * 16
        region = remaining[0:words * 2]
        remaining = remaining[words * 2:]
        lo_pages, hi_pages = pages_of(region)
        out.append(f"        ; region at VRAM ${vbase:04x}")
        out.append("        st0 #$00")
        out.append(f"        st1 #${vbase & 0xff:02x}")
        out.append(f"        st2 #${(vbase >> 8) & 0xff:02x}")
        out.append("        st0 #$02")
        label = f"tile{len(page_tables)}_"
        emit_copy_loop(out, label, lo_pages, hi_pages)
        out.append("")
        for p in range(len(lo_pages)):
            page_tables.append((label, p, lo_pages[p], hi_pages[p]))

    if sprites:
        out.append(f"        ; SG cells ${pat0:03x}..${pat0 + nblocks - 1:03x} "
                   f"at VRAM ${pat0 * 64:04x} ({nblocks * 64} words)")
        out.append("        st0 #$00")
        out.append("        st1 #$00")
        out.append("        st2 #$20")
        out.append(SG_FORMULA_ASM % nblocks)
        out.append("")
        if s.get("solid_sprites"):
            # #43 r10: overwrite the cells the sprites READ (CGY blocks sit
            # 2 apart) with a solid colour-1 pattern — SG0 = sixteen 0xFFFF
            # words, SG1..SG3 = zero — so every visible pixel reads sprite
            # palette 0's colour 1, CRAM[0x101], the entry the chain ramps
            # per line (REVIEW-15's M19: visible sprites under per-line
            # colour writes).
            for spr, base in zip(sprites, bases):
                h = [16, 32, 64, 64][spr["cgy"]]
                for cell in [base + 2 * k for k in range(h // 16)]:
                    lo = (cell * 64) & 0xFF
                    hi = (cell * 64) >> 8
                    out.append(f"        ; solid pix=1 pattern: SG cell "
                               f"${cell:03x} (VRAM ${cell * 64:04x})")
                    out.append("        st0 #$00")
                    out.append(f"        st1 #${lo:02x}")
                    out.append(f"        st2 #${hi:02x}")
                    out.append("        st0 #$02")
                    out.append("        clx")
                    out.append(f"solid{cell:03x}:")
                    out.append("        cpx #16")
                    out.append(f"        bcs solid{cell:03x}z")
                    out.append("        lda #$ff")
                    out.append("        sta $0002")
                    out.append("        sta $0003")
                    out.append(f"        bra solid{cell:03x}n")
                    out.append(f"solid{cell:03x}z:")
                    out.append("        stz $0002")
                    out.append("        stz $0003")
                    out.append(f"solid{cell:03x}n:")
                    out.append("        inx")
                    out.append("        cpx #64")
                    out.append(f"        bne solid{cell:03x}")
                    out.append("")
        out.append("        ; SAT: 64 entries at VRAM 0x7F00 (DVSSR); the SATB")
        out.append("        ; DMA (DCR bit 4) copies it into the SATB every VBlank")
        out.append("        st0 #$00")
        out.append("        st1 #$00")
        out.append("        st2 #$7f")
        out.append("        st0 #$02")
        lo_pages, hi_pages = pages_of(bytes(sat_bytes))
        emit_copy_loop(out, "sat_", lo_pages, hi_pages)
        out.append("")

    out.append("        ; arm the chain: step 0, RCR = 0x40 + entries[0].line")
    out.append("        stz <$30")
    if s.get("frame_counter"):
        out.append("        stz <$31                ; frame counter (r4)")
    out.append("        st0 #$06")
    out.append(f"        st1 #${(0x40 + entries[0]['line']) & 0xff:02x}")
    out.append(f"        st2 #${((0x40 + entries[0]['line']) >> 8) & 0xff:02x}")
    out.append("")
    out.append("        ; CR last: bit 2 (RC) enables the RCR interrupt")
    out.append("        st0 #$05")
    out.append(f"        st1 #${s['cr']:02x}")
    out.append("        st2 #$00")
    out.append("")
    out.append("        ; interrupts on: the chain's RCR match (status RR) and")
    out.append("        ; the VBlank flag (status VD) both drive IRQ2; the")
    out.append("        ; handler checks RR and ignores everything else")
    out.append("        cli")
    out.append("")
    out.append("loop:")
    out.append("        bra loop")
    out.append("")
    out.append("        ; #15 raster chain.  The RCR interrupt fires when the")
    out.append("        ; VDC's line counter reaches RCR - 0x40, i.e. at the END")
    out.append("        ; of VDW line L-1, so the step's writes land during")
    out.append("        ; the HBlank before line L and take effect on line L")
    out.append("        ; (BXR/BYR valid with the next scanning line, CR from")
    out.append("        ; the next horizontal display period).  Each step")
    out.append("        ; re-arms RCR for the next entry; the last step wraps")
    out.append("        ; to step 0.  <$30 = step; X = step in the handler")
    out.append("        ; (the main loop never uses X, so it needs no save).")
    out.append("        ; The handler lives on irq1: Mednafen's PCE core wires")
    out.append("        ; the VDC's IRQ to the CPU's IRQ1 ($fff8) — vce.cpp")
    out.append("        ; IRQChangeCheck -> IQIRQ1 (the HuC6280 manual lists")
    out.append("        ; IRQ1/IRQ2 as plain external inputs, so the ROM")
    out.append("        ; targets the emulator's wiring, noted in RENDERER.md).")
    out.append("        ; The VBlank flag also drives this IRQ; the RR check")
    out.append("        ; below ignores it (the status read clears both).")
    out.append("irq1:")
    out.append("        pha")
    out.append("        lda $0000               ; status: Mednafen's VDC returns")
    out.append("        and #$04                ; and clears it on this read (bit 2")
    out.append("        beq irq1ret             ; = RR, the RCR match).  The manual's")
    out.append("                                ; R00 + data-port read is the")
    out.append("                                ; hardware way; the emulator's port")
    out.append("                                ; is noted in docs/RENDERER.md")
    out.append("        ldx <$30                ; step")
    if s["kind"] == "cram_seq":
        out.append("        bne irq1cram            ; step 0 = first step of a")
        out.append("        inc <$31                ; frame: bump the frame counter —")
        out.append("        lda <$31                ; the values shift by 1 per frame,")
        out.append("        and #$1f                ; so the rows before an entry show")
        out.append("        sta <$31                ; the previous frame's values")
        out.append("irq1cram:")
        out.append("        stx $0402               ; CTA = step s (the boot load's")
        out.append("        stz $0403               ; autoincrement ran to 512; every")
        out.append("        lda r_step_lo, X        ; step rewrites entry s)")
        out.append("        clc")
        out.append("        adc <$31                ; value = grad[s] + frame, 9-bit")
        out.append("        sta $0404               ; add: carry into the high bit,")
        out.append("        lda r_step_hi, X        ; masked")
        out.append("        adc #$00")
        out.append("        and #$01")
        out.append("        sta $0405")
    elif s["kind"] == "cram_dual":
        out.append("        stz $0402               ; CTA = 0x000 (backdrop entry,")
        out.append("        stz $0403               ; the left half's colour)")
        out.append("        lda r_step_lo, X")
        out.append("        sta $0404")
        out.append("        lda r_step_hi, X")
        out.append("        sta $0405")
        out.append("        lda #$07                ; CTA = 0x007 (palette 0 colour 7,")
        out.append("        sta $0402               ; the right half's colour)")
        out.append("        stz $0403")
        out.append("        lda r_step2_lo, X")
        out.append("        sta $0404")
        out.append("        lda r_step2_hi, X")
        out.append("        sta $0405")
    elif s["kind"] == "cram_sprite":
        out.append("        lda #$01                ; CTA = 0x101 (sprite palette 0's")
        out.append("        sta $0402               ; colour 1 — the sprites' body)")
        out.append("        sta $0403")
        out.append("        lda r_step_lo, X")
        out.append("        sta $0404")
        out.append("        lda r_step_hi, X")
        out.append("        sta $0405")
    else:
        out.append("        st0 #$" + {"byr_const": "08", "byr_table": "08",
                                      "bxr_table": "07",
                                      "cr_table": "05"}[s["kind"]])
        out.append("        lda r_step_lo, X")
        out.append("        sta $0002")
        out.append("        lda r_step_hi, X")
        out.append("        sta $0003")
    out.append("        lda <$30")
    out.append("        clc")
    out.append("        adc #$01")
    out.append(f"        cmp #{n}")
    out.append("        bne irq1arm")
    out.append("        lda #$00                ; wrap to step 0")
    out.append("irq1arm:")
    out.append("        sta <$30")
    out.append("        tax")
    out.append("        st0 #$06")
    out.append("        lda r_chain_lo, X")
    out.append("        sta $0002")
    out.append("        lda r_chain_hi, X")
    out.append("        sta $0003")
    out.append("irq1ret:")
    out.append("        pla")
    out.append("        rti")
    out.append("irq2:")
    out.append("timer:")
    out.append("nmi:")
    out.append("        rti")
    out.append("")
    # ---- data tables
    out += emit_byte_table("cram0_lo", bytes(cram_lo[0:256]))
    out += emit_byte_table("cram0_hi", bytes(cram_hi[0:256]))
    out += emit_byte_table("cram1_lo", bytes(cram_lo[256:512]))
    out += emit_byte_table("cram1_hi", bytes(cram_hi[256:512]))
    out.append("")
    if sprites:
        out += emit_byte_table("sgconst_lo",
                               bytes([w & 0xFF for w in SG_PLANES]))
        out += emit_byte_table("sgconst_hi",
                               bytes([w >> 8 for w in SG_PLANES]))
        out.append("")
    lo_pages, hi_pages = pages_of(bytes(bat_bytes))
    for p in range(len(lo_pages)):
        out += emit_byte_table(f"bat_{p}_lo", lo_pages[p])
        out += emit_byte_table(f"bat_{p}_hi", hi_pages[p])
    out.append("")
    if sprites:
        lo_pages, hi_pages = pages_of(bytes(sat_bytes))
        for p in range(len(lo_pages)):
            out += emit_byte_table(f"sat_{p}_lo", lo_pages[p])
            out += emit_byte_table(f"sat_{p}_hi", hi_pages[p])
        out.append("")
    for label, p, lo, hi in page_tables:
        out += emit_byte_table(f"{label}{p}_lo", lo)
        out += emit_byte_table(f"{label}{p}_hi", hi)
    out.append("")
    out += emit_byte_table("r_chain_lo", bytes([c & 0xFF for c in chain]))
    out += emit_byte_table("r_chain_hi", bytes([c >> 8 for c in chain]))
    out.append("")
    out += emit_byte_table("r_step_lo", bytes(step_lo))
    out += emit_byte_table("r_step_hi", bytes(step_hi))
    out.append("")
    if step2_lo:
        out += emit_byte_table("r_step2_lo", bytes(step2_lo))
        out += emit_byte_table("r_step2_hi", bytes(step2_hi))
        out.append("")
    return "\n".join(out)


def raster_json(name):
    """The renderer's #15 raster table for scene `name`: the base register
    values and the colour table the boot load leaves (baseCram — the
    values CRAM holds after boot and before the first entry of a frame),
    plus the entries with the RCR value that armed them.  capture.sh
    copies it into the dump as raster.json; tests/check.js checks it
    against the save state and passes it to the renderer."""
    s = RASTER_SCENES[name]
    return {
        "note": (f"#15 raster scene {name}: {len(s['entries'])} RCR-chained "
                 "per-scanline writes, one step per VDW line — the values "
                 "and the chain live in tools/genroms.py (gen_raster_asm)"),
        "base": {"bxr": s["bxr"], "byr": s["byr"], "cr": s["cr"],
                 "dcr": s["dcr"]},
        "baseCram": scene_cram_words(name),
        "frameCounter": s.get("frame_counter", False),
        "entries": [dict(e, rcr=0x40 + e["line"]) for e in s["entries"]],
    }


def gen_asm(scene):
    s = SCENES[scene]
    cram = cr_words()
    cram_lo = [w & 0xFF for w in cram]
    cram_hi = [(w >> 8) & 1 for w in cram]

    # tiles: per (char0, count) region -> VRAM words char*16+row for row 0..7
    # (CH0/CH1 = bits 0-7/8-15 of word char*16+row, CH2/CH3 = word char*16+8+row)
    tile_bytes, regions = tile_region_bytes(scene, s["tiles"])

    bat_bytes = bytearray()
    if s["bat_tables"]:
        bat_bytes = bat_bytes_full(scene, s["bat_w"], s["bat_h"])

    out = []
    out.append(f";; PCEStudio scene {scene} — generated by tools/genroms.py, do not edit")
    out.append(f";; {s['bat_w']}x{s['bat_h']} BAT, BXR={s['bxr']}, BYR={s['byr']}, MWR=${s['mwr']:02x}, CR=${s['cr']:02x}")
    out.append("        .code")
    out.append("        .bank 0")
    out.append("        .org $fff6")
    out.append("        .dw irq2")
    out.append("        .dw irq1")
    out.append("        .dw timer")
    out.append("        .dw nmi")
    out.append("        .dw reset")
    out.append("")
    out.append("        .code")
    out.append("        .bank 0")
    out.append("        .org $e000")
    out.append("")
    out.append("reset:")
    out.append("        sei")
    out.append("        csh")
    out.append("        cld")
    out.append("        ldx #$ff")
    out.append("        txs")
    out.append("        lda #$ff")
    out.append("        tam0")
    out.append("        lda #$f8")
    out.append("        tam1")
    out.append("")
    out.append("        ; VCE: 263-line mode, 5.37 MHz dot clock (256 px)")
    out.append("        lda #$04")
    out.append("        sta $0400")
    out.append("")
    out.append("        ; colour table: 512 entries (CTA autoincrements on high write)")
    out.append("        stz $0402")
    out.append("        stz $0403")
    out.append("        clx")
    out.append("cram0:")
    out.append("        lda cram0_lo, X")
    out.append("        sta $0404")
    out.append("        lda cram0_hi, X")
    out.append("        sta $0405")
    out.append("        inx")
    out.append("        bne cram0")
    out.append("        clx")
    out.append("cram1:")
    out.append("        lda cram1_lo, X")
    out.append("        sta $0404")
    out.append("        lda cram1_hi, X")
    out.append("        sta $0405")
    out.append("        inx")
    out.append("        bne cram1")
    out.append("")
    out.append("        ; VDC init (HuDK vdc_init_table values)")
    emit_vdc_regs(out, s)
    out.append("")

    # ---- BAT
    if s["bat_tables"]:
        lo_pages, hi_pages = pages_of(bytes(bat_bytes))
        out.append(f"        ; BAT: {len(bat_bytes) // 2} words at VRAM 0")
        out.append("        st0 #$00")
        out.append("        st1 #$00")
        out.append("        st2 #$00")
        out.append("        st0 #$02")
        emit_copy_loop(out, "bat_", lo_pages, hi_pages)
        out.append("")
    else:
        out.append(BAT_LOOPS[s["bat_loop"]])
        out.append("")

    # ---- tiles, one copy region per (char0, count)
    out.append(f"        ; tiles: {len(tile_bytes) // 2} words")
    page_tables = []
    remaining = bytes(tile_bytes)
    for vbase, char0, count in regions:
        words = count * 16
        region = remaining[0:words * 2]
        remaining = remaining[words * 2:]
        lo_pages, hi_pages = pages_of(region)
        out.append(f"        ; region at VRAM ${vbase:04x}")
        out.append("        st0 #$00")
        out.append(f"        st1 #${vbase & 0xff:02x}")
        out.append(f"        st2 #${(vbase >> 8) & 0xff:02x}")
        out.append("        st0 #$02")
        label = f"tile{len(page_tables)}_"
        emit_copy_loop(out, label, lo_pages, hi_pages)
        out.append("")
        for p in range(len(lo_pages)):
            page_tables.append((label, p, lo_pages[p], hi_pages[p]))
    if s["cr"] & 0x80:
        out.append("        ; turn the background on (CR bit 7)")
    else:
        out.append("        ; background OFF: CR bit 7 (BB) stays clear, every")
        out.append("        ; pixel is the blanking-period video data SPBG=1,")
        out.append("        ; VD7..0=0 -> CRAM[0x100] (scenes 8/8b/8c; 8c sets")
        out.append("        ; SB (bit 6) so it is not burst mode)")
    out.append("        st0 #$05")
    out.append(f"        st1 #${s['cr']:02x}")
    out.append("        st2 #$00")
    out.append("")
    out.append("loop:")
    out.append("        bra loop")
    out.append("")
    out.append("irq2:")
    out.append("irq1:")
    out.append("timer:")
    out.append("nmi:")
    out.append("        rti")
    out.append("")
    # ---- data tables
    out += emit_byte_table("cram0_lo", bytes(cram_lo[0:256]))
    out += emit_byte_table("cram0_hi", bytes(cram_hi[0:256]))
    out += emit_byte_table("cram1_lo", bytes(cram_lo[256:512]))
    out += emit_byte_table("cram1_hi", bytes(cram_hi[256:512]))
    out.append("")
    if s["bat_tables"]:
        lo_pages, hi_pages = pages_of(bytes(bat_bytes))
        for p in range(len(lo_pages)):
            out += emit_byte_table(f"bat_{p}_lo", lo_pages[p])
            out += emit_byte_table(f"bat_{p}_hi", hi_pages[p])
    out.append("")
    for label, p, lo, hi in page_tables:
        out += emit_byte_table(f"{label}{p}_lo", lo)
        out += emit_byte_table(f"{label}{p}_hi", hi)
    out.append("")
    return "\n".join(out)


def main():
    os.makedirs(OUT, exist_ok=True)
    for scene in SCENES:
        path = os.path.join(OUT, f"scene{scene}.asm")
        with open(path, "w") as f:
            f.write(gen_asm(scene))
        print(f"wrote {path}")
    for name in SPRITE_SCENES:
        path = os.path.join(OUT, f"{name}.asm")
        with open(path, "w") as f:
            f.write(gen_sprite_asm(name))
        print(f"wrote {path}")
    for name in RASTER_SCENES:
        path = os.path.join(OUT, f"raster{name[1:]}.asm")
        with open(path, "w") as f:
            f.write(gen_raster_asm(name))
        print(f"wrote {path}")
        jpath = os.path.join(OUT, f"raster{name[1:]}.raster.json")
        with open(jpath, "w") as f:
            json.dump(raster_json(name), f, indent=1, sort_keys=True)
        print(f"wrote {jpath}")
    # sanity: scene 3 BAT formula in ROM == formula in generator
    for x in range(128):
        for y in range(32):
            if x & 0x10:
                t = 0x1F0 | (((x * 3) & 0x1F) + y & 0x1F)
            else:
                t = 0x100 | (((x * 7) & 0x1F) + y & 0x1F)
            assert bat_entry(3, x, y) == (((x + 3 * y) & 0xF) << 12) | t, (x, y)
    # sanity: sprite scenes' SG regions and SATs
    for name, s in SPRITE_SCENES.items():
        pat0, nblocks, bases = pack_patterns(s["sprites"])
        assert pat0 == 0x80 and pat0 * 64 + nblocks * 64 <= 0x7F00, name
        for spr, b in zip(s["sprites"], bases):
            h = [16, 32, 64, 64][spr["cgy"]]
            # the cells this sprite's rows read (CGY blocks 2 apart, CGX
            # halves consecutive — see the sprite-model comment above)
            if spr["cgx"]:
                cells = [b + 2 * k + hlf
                         for k in range(h // 16) for hlf in (0, 1)]
            else:
                cells = [b + 2 * k for k in range(h // 16)]
            for cell in cells:
                # every cell's 16 rows give distinct 4-plane word tuples
                # (P_3 = 0x00FF rotates with period exactly 16, so the tuple
                # differs per row — the flip/size witnesses depend on it)
                rows = [tuple(sg_word(cell, pl, r) for pl in range(4))
                        for r in range(16)]
                assert len(set(rows)) == 16, (name, hex(cell))
        sat = sat_words(s["sprites"], bases)
        assert len(sat) == 256, name
    # sanity: raster scenes' entries, chains and tables
    for name, s in RASTER_SCENES.items():
        entries = s["entries"]
        lines = [e["line"] for e in entries]
        assert lines == sorted(set(lines)), (name, "lines not strictly increasing")
        # the RCR mechanism only fires on VDW lines; VDW = 0xEF gives lines
        # 0..239, and r5's restore entry fires in the HBlank after the last
        # display line (RCR = 0x40+240 -> line counter 240 at line 239's
        # end), so 240 is allowed: no display row shows it, it leaves the
        # register value the next frame's line 0 latches.  RCR is 10 bits.
        assert all(0 <= L <= 240 for L in lines), name
        assert all(0x40 + L <= 0x3FF for L in lines), name
        # the write kinds the ROM's step code emits == the entries' kinds
        kinds = set()
        for e in entries:
            kinds.update(k for k in ("bxr", "byr", "cr", "cram") if k in e)
        want = {"byr_const": {"byr"}, "bxr_table": {"bxr"}, "byr_table": {"byr"},
                "cram_seq": {"cram"}, "cr_table": {"cr"},
                "cram_dual": {"cram"}, "cram_sprite": {"cram"}}[s["kind"]]
        assert kinds == want, (name, kinds, want)
        for e in entries:
            assert all(0 <= a < 512 and 0 <= v < 512
                       for a, v in e.get("cram", [])), name
        if "sprites" in s:
            pat0, nblocks, bases = pack_patterns(s["sprites"])
            assert pat0 == 0x80 and pat0 * 64 + nblocks * 64 <= 0x7F00, name
        # the first entry must fire before the capture's first rendered row
        # (the dump saves at VDW line 237 and the crop starts at VDW line 1,
        # so every scene's first entry fires — but keep the invariant loud)
        assert lines[0] <= 232, name


if __name__ == "__main__":
    sys.exit(main())
