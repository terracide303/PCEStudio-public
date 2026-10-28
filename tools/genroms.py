#!/usr/bin/env python3
"""genroms.py — generate the PCEStudio test-scene ROMs (cards #5 and #39).

Each scene is a HuCard ROM that initialises the VDC/VCE (the canonical HuDK
256x224 init values, see docs/BUILD.md and hello.asm), fills the VCE colour
table and VDC VRAM (tiles + BAT) with a deterministic picture, turns the
background on and loops.  Mednafen runs the ROM; its save state is the
"VRAM+palette dump" and its screenshot the pixel reference (see capture.sh
and tests/).

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
    Bit 0 (LSB) of a plane byte is the leftmost pixel of the row (VDC decode
    per Mednafen vdc.cpp FixTileCache: tc[x] = bit x).
    """
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


def pages_of(word_bytes):
    """Split a bytes object of 16-bit words into (lo_pages, hi_pages), each a
    list of 256-byte chunks (256 words per page)."""
    lo = word_bytes[0::2]
    hi = word_bytes[1::2]
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


def gen_asm(scene):
    s = SCENES[scene]
    cram = cr_words()
    cram_lo = [w & 0xFF for w in cram]
    cram_hi = [(w >> 8) & 1 for w in cram]

    # tiles: per (char0, count) region -> VRAM words char*16+row for row 0..7
    # (CH0/CH1 = bits 0-7/8-15 of word char*16+row, CH2/CH3 = word char*16+8+row)
    tile_bytes = bytearray()
    regions = []
    for char0, count in s["tiles"]:
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

    bat_bytes = bytearray()
    if s["bat_tables"]:
        for y in range(s["bat_h"]):
            for x in range(s["bat_w"]):
                w = bat_entry(scene, x, y)
                bat_bytes += bytes((w & 0xFF, (w >> 8) & 0xFF))

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
    # sanity: scene 3 BAT formula in ROM == formula in generator
    for x in range(128):
        for y in range(32):
            if x & 0x10:
                t = 0x1F0 | (((x * 3) & 0x1F) + y & 0x1F)
            else:
                t = 0x100 | (((x * 7) & 0x1F) + y & 0x1F)
            assert bat_entry(3, x, y) == (((x + 3 * y) & 0xF) << 12) | t, (x, y)


if __name__ == "__main__":
    sys.exit(main())
