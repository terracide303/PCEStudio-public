#!/usr/bin/env node
/*
 * tests/check-shadow-highlight.js — card #252: the guard for #241's finding.
 *
 * #241 (docs/SHADOW-HIGHLIGHT.md) found that the PC Engine has no shadow or
 * highlight mode: the VDC and VCE carry no such bit, so colour 14 and colour
 * 15 are ordinary CRAM entries in every palette. The Mega Drive VDP does have
 * it (sprite palette 3, colour 14 = highlight, 15 = shadow). This suite keeps
 * the studio's model that way: an invented S/H path would change the picture,
 * and these checks would catch it.
 *
 * Three checks on renderer/pce-sprites.js (which composes pce-bg.js):
 *
 *   1. A synthetic frame whose background tiles and sprites paint colour 14
 *      and colour 15 in every background palette 0-15 and every sprite
 *      palette 0-15. Each pixel must be exactly CRAM[pal<<4|colour] (or
 *      CRAM[0x100|pal<<4|colour] for a sprite), with the RGB the VCE's own
 *      channel rule gives that CRAM word and no brighten or darken. The
 *      expected RGB is computed here from the word, not from the module.
 *   2. The SAT word 3 bits the manual names no function for (4-6, 9-10, 14;
 *      H7-20/21) are read by no code: flipping them in all 64 entries of a
 *      frame with visible sprites leaves renderIndices byte-identical.
 *      (pce-sprites.js:151-159 reads 0-3, 7, 8, 11, 12-13, 15.)
 *   3. SPBG = 0 over an opaque background tile still obeys the composition
 *      rule at pce-sprites.js:471-476: the background wins where its colour
 *      number is non-zero, and the sprite shows where it is zero. SPBG = 1
 *      shows the sprite over the opaque tile.
 *
 * The mutation control: a copy of renderer/ with a palette-3 S/H mutant in
 * pce-sprites.js renderFrame (colour 14 brightened, colour 15 halved, in
 * the RGB of every entry with that colour number in palette 3, background or
 * sprite). The same checks must FAIL on it. A guard that passes the mutant
 * proves nothing.
 *
 * NOTE: written by @design (the card is tagged @test; the author's test
 * checks what the author already believes). Flagged for @review to read
 * cold, and a cold break by another seat is still owed.
 *
 * Dual use: plain Node, run by tests/all.sh.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const RENDERER = path.join(ROOT, "renderer");

/* ---- the synthetic frame ----------------------------------------------- */

const WIDTH = 256, HEIGHT = 232;

/* VRAM layout: the BAT is words 0..1023 (MWR 0), so every pattern sits above
 * it. Tiles are characters (x16 words), sprite patterns are cells (x64). */
const CH14 = 0x100, CH15 = 0x101, CH0 = 0x300;   /* 0x300: zero words */
const CELL14 = 0x20, CELL15 = 0x21;

function setWord(buf, w, v) {                 /* VRAM / SAT: little-endian */
  buf[w * 2] = v & 0xFF;
  buf[w * 2 + 1] = (v >> 8) & 0xFF;
}

/* A background tile of one colour everywhere: the plane words of
 * pce-bg.js's backgroundPixel (word at addr = planes 0/1, at addr+8 = planes
 * 2/3, bit 7 of a byte the leftmost pixel). */
function bgTile(vram, ch, colour) {
  for (let row = 0; row < 8; row++) {
    const addr = ch * 16 + row;
    setWord(vram, addr, ((colour & 1) ? 0x00FF : 0) | ((colour & 2) ? 0xFF00 : 0));
    setWord(vram, addr + 8, ((colour & 4) ? 0x00FF : 0) | ((colour & 8) ? 0xFF00 : 0));
  }
}

/* A 16x16 sprite pattern of one colour in cell `cell`: four 16-word planes at
 * +0/+16/+32/+48 words from cell*64 + row (renderer/pce-sprites.js). */
function spritePattern(vram, cell, colour) {
  for (let row = 0; row < 16; row++) {
    const base = cell * 64 + row;
    for (let plane = 0; plane < 4; plane++) {
      setWord(vram, base + plane * 16, (colour >> plane) & 1 ? 0xFFFF : 0);
    }
  }
}

function bgCell(vram, col, row, ch, pal) {     /* MWR 0: 32x32 BAT */
  setWord(vram, row * 32 + col, ch | (pal << 12));
}

function satEntry(sat, i, y, x, pattern, attr) {
  setWord(sat, i * 4, y);
  setWord(sat, i * 4 + 1, x);
  setWord(sat, i * 4 + 2, pattern << 1);
  setWord(sat, i * 4 + 3, attr);
}

/* A CRAM with a different word in every entry, all non-zero, so that a
 * brighten or darken changes a channel. */
function makeCram() {
  const cram = new Uint8Array(1024);
  for (let i = 0; i < 512; i++) {
    setWord(cram, i, ((i * 5 + 1) % 511) + 1);
  }
  return cram;
}

/* The VCE's channel rule, written here independently of the module:
 * G = bits 6-8, R = bits 3-5, B = bits 0-2, each channel x 36. */
function expectedRgb(cram, index) {
  const w = cram[index * 2] | (cram[index * 2 + 1] << 8);
  return [((w >> 3) & 7) * 36, ((w >> 6) & 7) * 36, (w & 7) * 36];
}

function makeOpts(vram, sat, cram) {
  return {
    vram, sat, cram,
    regs: { CR: 0xC0,           /* SB (bit 6) and BB (bit 7) set */
            MWR: 0, BXR: 0, BYR: 0, RCRCount: 0, scanline: 18,
            VCECR: 0 },
    firstScanline: 18
  };
}

/* ---- the three checks, run against one renderer directory -------------- */

function guard(dir) {
  const sprites = require(path.join(dir, "pce-sprites.js"));
  const failures = [];
  let ran = 0;
  const check = (ok, msg) => { ran++; if (!ok) failures.push(msg); };

  /* (1) colour 14 and 15 in bg palettes 0-15 and sprite palettes 0-15 */
  {
    const vram = new Uint8Array(65536);
    const sat = new Uint8Array(512);
    const cram = makeCram();
    bgTile(vram, CH14, 14);                     /* colour 14 */
    bgTile(vram, CH15, 15);                     /* colour 15 */
    spritePattern(vram, CELL14, 14);            /* colour 14 */
    spritePattern(vram, CELL15, 15);            /* colour 15 */
    /* background: rows 4..28 (y 32..231), char by row parity, pal = col & 15 */
    for (let row = 4; row < 29; row++) {
      for (let col = 0; col < 32; col++) {
        bgCell(vram, col, row, (row & 1) ? CH15 : CH14, col & 15);
      }
    }
    /* sprites: band 0 (y 0-15) colour 14, band 1 (y 16-31) colour 15, sprite
     * palette = x / 16; SPBG = 1 so they cover the background. Each line
     * holds 16 sprites, the strip budget. */
    for (let band = 0; band < 2; band++) {
      for (let pal = 0; pal < 16; pal++) {
        const i = band * 16 + pal;
        satEntry(sat, i, 64 + 16 * band, 32 + 16 * pal,
                 band ? CELL15 : CELL14, 0x80 | pal);
      }
    }
    const opts = makeOpts(vram, sat, cram);
    const img = sprites.renderIndices(opts);
    const frame = sprites.renderFrame(opts);
    let bad = 0, firstBad = null;
    let spriteBad = 0, bgBad = 0;
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        let want;
        if (y < 32) {
          const band = y >> 4, pal = x >> 4;
          want = 0x100 | (pal << 4) | (band ? 15 : 14);
        } else {
          const pal = (x >> 3) & 15, row = y >> 3;
          want = (pal << 4) | ((row & 1) ? 15 : 14);
        }
        const got = img.indices[y * WIDTH + x];
        const r = expectedRgb(cram, want);
        const o = (y * WIDTH + x) * 3;
        const rgbOk = frame.pixels[o] === r[0] && frame.pixels[o + 1] === r[1] &&
                      frame.pixels[o + 2] === r[2];
        if (got !== want || !rgbOk) {
          bad++;
          if (y < 32) spriteBad++; else bgBad++;
          if (!firstBad) firstBad = `(${x},${y}) index ${got.toString(16)} ` +
            `want ${want.toString(16)}, rgb ${[...frame.pixels.slice(o, o + 3)]} ` +
            `want ${r}`;
        }
      }
    }
    check(bad === 0,
      `(1) colour 14/15 not ordinary: ${bad} px wrong (${spriteBad} sprite, ` +
      `${bgBad} background); first ${firstBad}`);
  }

  /* (2) unnamed SAT word 3 bits do not change the picture */
  {
    const vram = new Uint8Array(65536);
    const sat = new Uint8Array(512);
    const cram = makeCram();
    spritePattern(vram, CELL14, 14);
    spritePattern(vram, CELL15, 15);
    for (let i = 0; i < 32; i++) {
      const band = i >> 4, pal = i & 15;
      satEntry(sat, i, 64 + 16 * band, 32 + 16 * pal,
               band ? CELL15 : CELL14, (i & 1 ? 0x80 : 0) | pal);
    }
    const opts = makeOpts(vram, sat, cram);
    const before = sprites.renderIndices(opts).indices;
    const bgOnly = sprites.renderIndices(Object.assign({}, opts, { sat: null }))
                          .indices;
    let visible = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== bgOnly[i]) visible++;
    check(visible > 0,
      "(2) the frame has no visible sprite, so the bit flip proves nothing");
    const flipped = new Uint8Array(sat);
    const MASK = 0x0070 | 0x0600 | 0x4000;   /* bits 4-6, 9-10, 14 */
    for (let i = 0; i < 64; i++) {
      const w = flipped[i * 8 + 6] | (flipped[i * 8 + 7] << 8);
      setWord(flipped, i * 4 + 3, w ^ MASK);
    }
    const after = sprites.renderIndices(Object.assign({}, opts, { sat: flipped }))
                         .indices;
    let diff = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) diff++;
    check(diff === 0,
      `(2) flipping SAT word 3 bits 4-6, 9-10, 14 changed ${diff} index(es)`);
  }

  /* (3) SPBG = 0 over an opaque tile obeys pce-sprites.js:471-476 */
  {
    const cram = makeCram();
    const sprite = 0x100 | (5 << 4) | 15;     /* sprite pal 5, colour 15 */
    const bgOpaque = (2 << 4) | 14;           /* bg pal 2, colour 14 */
    const cases = [
      { name: "SPBG 0 over an opaque tile", ch: CH14, spbg: 0,
        want: bgOpaque },
      { name: "SPBG 0 over colour 0", ch: CH0, spbg: 0, want: sprite },
      { name: "SPBG 1 over an opaque tile", ch: CH14, spbg: 1, want: sprite }
    ];
    for (const c of cases) {
      const vram = new Uint8Array(65536);
      const sat = new Uint8Array(512);
      bgTile(vram, CH14, 14);
      spritePattern(vram, CELL15, 15);
      for (let row = 0; row < 29; row++) {
        for (let col = 0; col < 32; col++) bgCell(vram, col, row, c.ch, 2);
      }
      satEntry(sat, 0, 64, 32, CELL15, 0x80 * c.spbg | 5);
      const img = sprites.renderIndices(makeOpts(vram, sat, cram));
      let bad = 0;
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          if (img.indices[y * WIDTH + x] !== c.want) bad++;
        }
      }
      check(bad === 0,
        `(3) ${c.name}: ${bad} of 256 sprite-area px not ${c.want.toString(16)}`);
    }
  }

  return { ran, failures };
}

/* ---- the mutant: palette-3 S/H in the RGB output ------------------------ */

function makeMutant() {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(),
                                       "sh-mutant-"));
  for (const f of fs.readdirSync(RENDERER)) {
    if (f.endsWith(".js")) fs.copyFileSync(path.join(RENDERER, f), path.join(dir, f));
  }
  const file = path.join(dir, "pce-sprites.js");
  const src = fs.readFileSync(file, "utf8");
  const anchor = "px[o0 + x * 3 + 2] = rgb[ci * 3 + 2];";
  if (src.split(anchor).length !== 2) {
    throw new Error("mutant anchor not unique in pce-sprites.js");
  }
  /* palette 3, colour 14 brightens, colour 15 halves: the S/H rule, applied
   * to background and sprite pixels alike. */
  const sh = anchor + `
        if ((ci & 0xF0) === 0x30 && (ci & 0xF) === 14) {
          px[o0 + x * 3] = Math.min(255, px[o0 + x * 3] + 36);
          px[o0 + x * 3 + 1] = Math.min(255, px[o0 + x * 3 + 1] + 36);
          px[o0 + x * 3 + 2] = Math.min(255, px[o0 + x * 3 + 2] + 36);
        } else if ((ci & 0xF0) === 0x30 && (ci & 0xF) === 15) {
          px[o0 + x * 3] >>= 1;
          px[o0 + x * 3 + 1] >>= 1;
          px[o0 + x * 3 + 2] >>= 1;
        }`;
  fs.writeFileSync(file, src.replace(anchor, sh));
  return dir;
}

/* ---- run --------------------------------------------------------------- */

const real = guard(RENDERER);
console.log(`  ${real.ran - real.failures.length}/${real.ran} shadow/highlight ` +
            `guard checks hold on renderer/`);
for (const f of real.failures) console.log(`  FAIL  ${f}`);

const mutantDir = makeMutant();
let mutant;
try {
  mutant = guard(mutantDir);
} finally {
  fs.rmSync(mutantDir, { recursive: true, force: true });
}
console.log(`  mutant (palette-3 S/H): ${mutant.failures.length} of ${mutant.ran} ` +
            `checks fail, as they must`);
for (const f of mutant.failures.slice(0, 3)) console.log(`        ${f}`);

console.log("");
let ok = true;
if (real.failures.length) { ok = false; console.log("FAIL: the tree is not ordinary colour 14/15"); }
if (mutant.failures.length === 0) {
  ok = false;
  console.log("FAIL: the palette-3 S/H mutant passed; the guard is blind to it");
}
if (ok) console.log("PASS: colour 14/15 ordinary, SAT unnamed bits inert, SPBG=0 " +
                    "obeys the composition rule; the S/H mutant is caught");
process.exitCode = ok ? 0 : 1;
