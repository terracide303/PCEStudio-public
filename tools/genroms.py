#!/usr/bin/env python3
"""genroms.py — generate the three PCEStudio test-scene ROMs (card #5).

Each scene is a HuCard ROM that initialises the VDC/VCE (the canonical HuDK
256x224 init values, see docs/BUILD.md and hello.asm), fills the VCE colour
table and VDC VRAM (tiles + BAT) with a deterministic picture, turns the
background on and loops.  Mednafen runs the ROM; its save state is the
"VRAM+palette dump" and its screenshot the pixel reference (see capture.sh
and tests/).

The three scenes differ in what they exercise in the renderer:
  scene1 "flat"    32x32 BAT, no scroll, tiles 0x040+/0xF00+ (12-bit tile
                   numbers), all 16 palettes, VCE CG bits set on some entries
  scene2 "scroll"  64x32 BAT, BXR=100, BYR=53 (sub-tile scroll), single-pixel
                   checkerboard tiles (bit-order torture)
  scene3 "wide"    128x32 BAT, BXR=290, BYR=117, tiles 0x100+/0x1F0+; its BAT
                   is filled by a small formula loop in the ROM itself so the
                   data fits in one 8 KiB ROM bank

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
    """VCE colour table: all 512 entries distinct, plus CG bits on a few.

    Entry i -> colour (i * 7) & 0x1FF (a bijection mod 512, so every 9-bit
    value appears exactly once).  The CG bit (bit 8, written via $0405) is set
    on a few entries that scene 1 displays, to verify it is a no-op for RGB
    output.
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
    if scene == 1:
        v = (t * 73 + row * 13 + plane * 29) & 0xFF
        v ^= (t * 3 + plane * 5) & 0xFF
    elif scene == 2:
        # single-pixel checkerboard per plane: 0xAA / 0x55 by parity
        v = 0xAA if ((row + t + plane) & 1) else 0x55
    else:
        # broad stripes: bit x = ((x + 2*row + t + 3*plane) >> 4) & 1
        v = 0xF0 if (((2 * row + t + 3 * plane) >> 4) & 1) else 0x0F
    # CH1/CH3 occupy the high byte of the VRAM word
    return v if plane in (0, 2) else v << 8


def bat_entry(scene, x, y):
    """BAT word at (x, y): bits 0-11 tile (char code), bits 12-15 palette."""
    if scene == 3:
        pal = (x + 3 * y) & 0xF
    else:
        pal = (x + 2 * y) & 0xF
    if scene == 1:
        if x & 1:
            tile = 0xF00 | ((x * 3 + y * 5) & 0xF)
        else:
            tile = 0x040 | ((x * 3 + y * 5) & 0x1F)
    elif scene == 2:
        if (x + y) & 7 == 0:
            tile = 0xF00 | (x & 0xF)
        else:
            tile = 0x080 | ((x + y) & 0x1F)
    else:  # scene 3 — kept in sync with the formula loop in the ROM
        if x & 0x10:
            tile = 0x1F0 | (((x * 3) & 0x1F) + y & 0x1F)
        else:
            tile = 0x100 | (((x * 7) & 0x1F) + y & 0x1F)
    return (pal << 12) | tile


SCENES = {
    1: dict(mwr=0x00, bxr=0, byr=0,
            bat_w=32, bat_h=32, bat_tables=True,
            tiles=[(0x040, 32), (0xF00, 16)]),
    2: dict(mwr=0x10, bxr=100, byr=53,
            bat_w=64, bat_h=32, bat_tables=True,
            tiles=[(0x080, 32), (0xF00, 16)]),
    3: dict(mwr=0x20, bxr=290, byr=117,
            bat_w=128, bat_h=32, bat_tables=False,
            tiles=[(0x100, 32), (0x1F0, 32)]),
}


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
        (0x0F, DCR),
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
    out.append(f";; {s['bat_w']}x{s['bat_h']} BAT, BXR={s['bxr']}, BYR={s['byr']}, MWR=${s['mwr']:02x}")
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
        out.append(BAT_FORMULA_ASM)
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
    out.append("        ; turn the background on (CR bit 7)")
    out.append("        st0 #$05")
    out.append("        st1 #$80")
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
