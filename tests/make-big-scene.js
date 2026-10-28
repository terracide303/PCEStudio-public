#!/usr/bin/env node
/*
 * tests/make-big-scene.js — writes tests/dumps/scene10, card #46's picture.
 *
 * The picture is the one the >80 KB card needs: a 64x64 BAT (8192 bytes of
 * VRAM), a full 32 KiB tile set (1024 tiles at character $100), and 160
 * sprite-pattern cells (10,240 words at character $500), with 8 visible
 * 32x32 sprites whose SAT lives at VRAM $7f00.  Its copy regions are
 * 32,768 + 20,480 = 53,248 bytes, so the ROM is
 *   4 + ceil(53248 / 8192) = 11 banks = 90,112 bytes (88 KiB),
 * larger than the old 10-bank (80 KiB) cap.
 *
 * A 128x64 BAT cannot exceed that cap: the BAT is 16 KiB, leaving only
 * 48,640 bytes of regions in 64 KiB of VRAM = 6 tile banks = exactly the old
 * 80 KiB.  The 64x64 BAT leaves room for the sprite patterns that push the
 * image past it.
 *
 * Everything is deterministic and derived from the VRAM word rules the
 * renderer and the hardware share (docs/RENDERER.md): tiles are planar 16-word
 * cells (word = character*16 + row; plane 1 at +8), sprite cells are 64 words
 * (planes at +0/+16/+32/+48), and a BAT word is character bits 0-11 plus
 * palette bits 12-15.  Run it once; the dump is committed and the tests read
 * it like any other scene:
 *
 *   node tests/make-big-scene.js
 *
 * The PCEAS reference is tools/gen/viewer10.pce (genviewer.py 10, the
 * Makefile's gen/viewer%.pce rule); the browser's bytes are compared against
 * it by tests/check-export.js, and the Mednafen capture is
 * tools/capture.sh 10 browser -> tests/dumps/browser10.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "dumps", "scene10");
const VRAM_BYTES = 65536;
const WORDS = VRAM_BYTES / 2;

/* The picture's MWR: 64 columns (bits 4-5 = 1) and 64 rows (bit 6). */
const MWR = 0x50;
const BAT_WIDTH = 64, BAT_HEIGHT = 64;
const BAT_WORDS = BAT_WIDTH * BAT_HEIGHT;

const TILE_CHAR0 = 0x100, TILE_COUNT = 1024;      /* 1024 x 16 words = 32 KiB */
const PATTERN_CHAR0 = 0x500, PATTERN_CELLS = 160; /* 160 x 64 words = 20 KiB */
const SAT_ADDR = 0x7f00;

const vram = new Uint8Array(VRAM_BYTES);
function putWord(at, word) {
  vram[at * 2] = word & 0xff;
  vram[at * 2 + 1] = (word >> 8) & 0xff;
}

/* ---- the BAT: every cell a character in the tile set, a palette per cell */
for (let y = 0; y < BAT_HEIGHT; y++) {
  for (let x = 0; x < BAT_WIDTH; x++) {
    const ch = TILE_CHAR0 + ((x * 37 + y * 101) % TILE_COUNT);
    const pal = (x * 3 + y * 5) & 15;
    putWord(y * BAT_WIDTH + x, ch | (pal << 12));
  }
}

/* ---- the tile set: each tile one solid colour 1..15 (never 0, so the
 * background is opaque and the SPBG=1 sprites show over it).  Planar layout:
 * character c's row r is word c*16+r (planes 0/1); the other two planes are
 * word c*16+8+r. */
for (let t = 0; t < TILE_COUNT; t++) {
  const base = (TILE_CHAR0 + t) * 16;
  const colour = 1 + (t % 15);
  for (let row = 0; row < 8; row++) {
    let lo = 0, hi = 0;
    for (let c = 0; c < 8; c++) {
      const bit = 7 - c;
      if (colour & 1) lo |= 1 << bit;
      if (colour & 2) lo |= 1 << (bit + 8);
      if (colour & 4) hi |= 1 << bit;
      if (colour & 8) hi |= 1 << (bit + 8);
    }
    putWord(base + row, lo);
    putWord(base + 8 + row, hi);
  }
}

/* ---- sprite patterns: 160 64-word cells, each a solid colour.  A cell's
 * four 16-word planes sit at +0/+16/+32/+48; each word is 16 pixels. */
for (let cell = 0; cell < PATTERN_CELLS; cell++) {
  const base = (PATTERN_CHAR0 / 4 + cell) * 64;   /* cell index = char / 4 */
  const colour = 1 + (cell % 15);
  for (let plane = 0; plane < 4; plane++) {
    const word = (colour >> plane) & 1 ? 0xffff : 0x0000;
    for (let row = 0; row < 16; row++) putWord(base + plane * 16 + row, word);
  }
}

/* ---- the SAT: 8 visible 32x32 sprites (CGX=1, CGY=1) on two rows, using
 * the first 32 pattern cells (4 cells each).  SPBG=1 shows them over the
 * opaque background; Y is display row + 64 and X is display column + 32. */
const sat = new Uint8Array(512);
function satWord(i, word) {
  sat[i * 2] = word & 0xff;
  sat[i * 2 + 1] = (word >> 8) & 0xff;
}
for (let i = 0; i < 8; i++) {
  const y = 16 + (i % 2) * 80;        /* display rows 16 and 96 */
  const x = 16 + (i >> 1) * 60;       /* columns 16, 76, 136, 196 */
  const pattern = 0x140 + i * 4;      /* cell index (VRAM word / 64) */
  const pal = 1 + (i % 15);
  satWord(i * 4, y + 64);
  satWord(i * 4 + 1, x + 32);
  satWord(i * 4 + 2, (pattern << 1) & 0xffff);
  satWord(i * 4 + 3, pal | (1 << 7) /* SPBG */ | (1 << 8) /* CGX */ |
                      (1 << 12) /* CGY=1: 32 rows */);
}
vram.set(sat, SAT_ADDR * 2);          /* the SATB DMA source (card #14) */

/* ---- the colour table: all 512 entries, a deterministic 9-bit colour */
const cram = new Uint8Array(1024);
for (let n = 0; n < 512; n++) {
  const g = (n * 7 + 1) & 7, r = (n * 3 + 2) & 7, b = (n * 5 + 3) & 7;
  const word = (g << 6) | (r << 3) | b;
  cram[n * 2] = word & 0xff;
  cram[n * 2 + 1] = (word >> 8) & 0xff;
}

/* ---- the registers the viewer leaves behind.  The VDC values are what
 * viewer.asm writes (MWR from the config; CR = BB|SB); RCRCount/scanline are
 * the save-state calibration values every scene dump carries (the capture's
 * crop makes VDW line 0 of captured row 0 = 1, the same as scene1..7). */
const regs = {
  BXR: 0, BYR: 0, MWR, CR: 0xc0,
  VSR: 3842, VDR: 239, HSR: 514, HDR: 1055, DCR: 16, SATB: SAT_ADDR,
  RCR: 0, RCRCount: 237, scanline: 254,
  VCR: 12, VCECR: 4, VRAM: 64, VRAM_bytes: VRAM_BYTES,
  color_table: 511, color_table_bytes: 1024, SAT_bytes: 512,
  BG_XOffset: 0, BG_YOffset: 0, BG_YMoo: 236,
  _stateversion: 1061377, _preview: [0, 0], status: 0,
  HDE_cache: 4, HDS_cache: 2, HDW_cache: 31, HSW_cache: 2,
  VCR_cache: 12, VDS_cache: 15, VDW_cache: 239, VSW_cache: 2,
  ctaddress: 0, pixel_offset: 2016, SAT: 0
};

const regions = {
  comment: "Copy regions of scene10 (card #46's >80 KB picture) for " +
           "docs/ROM_LAYOUT.md: [char0, 16-word chunk count] in descriptor " +
           "order.  [0x100, 1024] is the 32 KiB tile set, [0x500, 640] the " +
           "160 sprite-pattern cells.  Read by tools/genviewer.py (viewer10) " +
           "and renderer/pce-rom.js; the SAT has its fixed place in bank 1.",
  tile_regions: [[TILE_CHAR0, TILE_COUNT], [PATTERN_CHAR0, PATTERN_CELLS * 4]]
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "vram.bin"), vram);
fs.writeFileSync(path.join(OUT, "cram.bin"), cram);
fs.writeFileSync(path.join(OUT, "sat.bin"), sat);
fs.writeFileSync(path.join(OUT, "regs.json"), JSON.stringify(regs, null, 1) + "\n");
fs.writeFileSync(path.join(OUT, "regions.json"),
                 JSON.stringify(regions, null, 2) + "\n");

const regionWords = TILE_COUNT * 16 + PATTERN_CELLS * 64;
const regionBytes = regionWords * 2;
const banks = 4 + Math.ceil(regionBytes / 8192);
console.log(`wrote ${path.relative(path.join(__dirname, ".."), OUT)}: ` +
            `BAT ${BAT_WORDS} words (${BAT_WORDS * 2} B), ` +
            `${TILE_COUNT} tiles (${TILE_COUNT * 32} B), ` +
            `${PATTERN_CELLS} pattern cells (${PATTERN_CELLS * 128} B), ` +
            `regions ${regionBytes} B -> ${banks} banks = ${banks * 8192} B` +
            (banks * 8192 > 80 * 1024 ? " (> 80 KiB)" : ""));
