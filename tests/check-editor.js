#!/usr/bin/env node
/*
 * tests/check-editor.js — the closing measurement of #10 (tiles, palettes,
 * the background map) and #13 (sprite patterns, sprite palettes, the SAT).
 *
 * NOTE: written by @design because the cards' close conditions need a diff
 * script; per the workshop role split this is flagged for @review to read
 * cold (same arrangement as tests/check.js, check-viewer.js, check-export.js).
 *
 * What it measures:
 *  1. The refusals.  Every call that would store something the VDC cannot
 *     show throws with its documented code: a 17th colour in a tile (pixel
 *     number 16), a 17th palette, a 17th colour in a palette, a colour the
 *     tile's own palette does not hold, a character past the 32768-word
 *     VRAM, the range guards — and (#13) a 65th sprite, a sprite pattern
 *     whose cells reach the SAT at VRAM $7F00, a 17th colour in a sprite
 *     palette, and a sprite size the VDC cannot draw.
 *  2. A 256x224 picture painted from scratch.  renderer/pce-editor.js's
 *     demoPicture() paints it through the editor's own calls (nothing is
 *     loaded from tests/dumps/); the result is checked by the editor's own
 *     validate(), and its pixels are recomputed from the editor model and
 *     compared with renderer/pce-bg.js drawing the picture through
 *     toPicture() — the model that #5 matched to Mednafen pixel for pixel.
 *  3. The export.  renderer/pce-rom.js (#9) turns the picture into a .pce;
 *     the bytes in bank 1 (config + palettes + SAT), banks 2-3 (the BAT) and
 *     bank 4+ (each copy region, tiles then sprite patterns) must be the
 *     editor's data at the documented places.
 *  4. The console check, when tests/dumps/painted/ exists (the capture of
 *     that ROM from Mednafen): the captured VRAM/CRAM/regs must be exactly
 *     what the editor wrote, and Mednafen's recorded frame must equal
 *     pce-bg.js drawing the EDITOR's picture with the capture's own
 *     calibration — so "what I painted" is what the console showed, not
 *     just what the dump round-trips to.
 *  5. The browser-global branch (a vm context with `self`, no `module`) does
 *     the same refusals and produces the same bytes, so the page's code
 *     path is exercised rather than assumed.
 *
 * Card #13 adds, on the same pattern:
 *  6. spriteDemoPicture() — a sprite scene painted from scratch through the
 *     editor's calls: six patterns (every VDC size), all 16 sprite palettes,
 *     36 sprites into the SAT (X, Y, size, palette, priority, both flips), a
 *     crowded line that asks for 21 strips and is shown 16.  Its pixels are
 *     recomputed from the editor's own model (BG map/tile -> colour number,
 *     then sprites in SAT order with the 16-strip budget, SPBG and the
 *     lower-index-wins rule) and compared with pce-bg.js + pce-sprites.js
 *     drawing toPicture()'s VRAM/CRAM/SAT — two paths, one picture.
 *  7. The per-line budget: for every line, spriteLineBudget() must say how
 *     many strips pce-sprites.js actually collects, the crowded line must
 *     report the dropped strips the renderer drops, and the frame above must
 *     show them dropped.  Going past 16 is allowed; it is reported.
 *  8. The sprite capture, tests/dumps/spainted/: the captured VRAM and SAT
 *     must be exactly the editor's, and Mednafen's frame must equal
 *     pce-sprites.js drawing the editor's picture — diff 0.
 *
 *   node tests/check-editor.js                 # check both captures
 *   node tests/check-editor.js --write         # write tools/gen/painted.pce
 *   node tests/check-editor.js --write sprite  # write tools/gen/spainted.pce
 *
 *   tools/capture.sh painted    # builds + captures the background picture
 *   tools/capture.sh spainted   # builds + captures the sprite scene
 *
 * Exit 0 only if everything above holds.
 *
 * What this does NOT prove: that the page's mouse handlers paint what a
 * person expects (they call the same functions the check does, but the
 * page's event wiring is read, not executed), that the download wiring runs,
 * or that the picture is one someone wanted.
 */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const zlib = require("zlib");
const ed = require("../renderer/pce-editor.js");
const bg = require("../renderer/pce-bg.js");
const sprites = require("../renderer/pce-sprites.js");
const rom = require("../renderer/pce-rom.js");

const HERE = __dirname;
const GEN = path.join(HERE, "..", "tools", "gen");
const BANK0 = path.join(HERE, "..", "renderer", "viewer-bank0.bin");
const CAPTURE = path.join(HERE, "dumps", "painted");
const SPRITE_CAPTURE = path.join(HERE, "dumps", "spainted");
const SAT_BYTE = 0x7F00 * 2;   /* the SAT at VRAM word $7F00 */
const EDITOR_SRC = fs.readFileSync(
  path.join(HERE, "..", "renderer", "pce-editor.js"), "utf8");

/* ---- minimal PNG reader (same as tests/check.js) ----------------------- */
function decodePng(buf) {
  if (buf.slice(0, 8).toString("latin1") !== "\x89PNG\r\n\x1a\n")
    throw new Error("not a PNG");
  let pos = 8, width = 0, height = 0, bitDepth = 0, colourType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.slice(pos + 4, pos + 8).toString("latin1");
    const data = buf.slice(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colourType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  if (bitDepth !== 8 || [0, 2, 6].indexOf(colourType) < 0)
    throw new Error(`unsupported PNG ${bitDepth}bpp type ${colourType}`);
  const chans = { 0: 1, 2: 3, 6: 4 }[colourType];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * chans;
  const out = Buffer.alloc(width * height * 3);
  const prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[p++];
    const line = raw.slice(p, p + stride);
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= chans ? line[i - chans] : 0;
      const b = prev[i];
      const c = i >= chans ? prev[i - chans] : 0;
      if (f === 1) line[i] = (line[i] + a) & 0xFF;
      else if (f === 2) line[i] = (line[i] + b) & 0xFF;
      else if (f === 3) line[i] = (line[i] + ((a + b) >> 1)) & 0xFF;
      else if (f === 4) {
        const pa = Math.abs(a + b - c - a), pb = Math.abs(a + b - c - b),
              pc = Math.abs(a + b - c - c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xFF;
      }
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 3;
      if (chans === 1) out[o] = out[o + 1] = out[o + 2] = line[x];
      else {
        out[o] = line[x * chans];
        out[o + 1] = line[x * chans + 1];
        out[o + 2] = line[x * chans + 2];
      }
    }
    line.copy(prev);
  }
  return { width, height, pixels: out };
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/* ---- the picture the editor model says it painted ---------------------- */
/* Recomputed from the editor's own data (map -> tile -> colour number ->
 * palette entry -> 9-bit colour -> RGB), independently of toPicture()'s VRAM
 * encoding, so 2 below compares two paths rather than one path with itself. */
function modelFrame(pic) {
  const W = ed.VIEW_W, H = ed.VIEW_H;
  const px = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const char = ed.mapCell(pic, x >> 3, y >> 3);
      const tile = pic.tiles[char];
      const v = tile.pixels[(y & 7) * 8 + (x & 7)];
      const colour = v === 0 ? pic.backdrop : pic.palettes[tile.palette][v];
      const o = (y * W + x) * 3;
      px[o] = 36 * ((colour >> 3) & 7);
      px[o + 1] = 36 * ((colour >> 6) & 7);
      px[o + 2] = 36 * (colour & 7);
    }
  }
  return { width: W, height: H, pixels: px };
}

/* The sprite scene recomputed from the editor's own model — independently of
 * toPicture()'s VRAM encoding and of pce-sprites.js.  The background comes
 * from map -> tile -> colour number exactly as modelFrame(); the sprites are
 * composed from pic.sprites/patterns/spritePalettes with the hardware rules
 * spelled out again: only the first 16 strips on a line in SAT order are
 * kept, a 32-px sprite is two strips, HFLIP mirrors within a strip and swaps
 * a 32-px sprite's halves, VFLIP reverses the rows, a 32-px sprite's right
 * half can be dropped while the left shows, pixel 0 is transparent, SPBG=0
 * is hidden by a background colour number != 0, and the lowest SAT index
 * wins an overlap. */
function modelSpriteFrame(pic) {
  const W = ed.VIEW_W, H = ed.VIEW_H;
  const px = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    const num = new Array(W), col = new Array(W);
    for (let x = 0; x < W; x++) {
      const char = ed.mapCell(pic, x >> 3, y >> 3);
      const tile = pic.tiles[char];
      const v = tile.pixels[(y & 7) * 8 + (x & 7)];
      num[x] = v;
      col[x] = v === 0 ? pic.backdrop : pic.palettes[tile.palette][v];
    }
    /* collect the line's strips in SAT order, stop at 16 */
    const kept = [];
    for (let i = 0; i < pic.sprites.length && kept.length < ed.LINE_STRIPS;
         i++) {
      const s = pic.sprites[i];
      const pat = pic.spritePatterns[s.pattern];
      if (y < s.y || y >= s.y + pat.height) continue;
      const halves = pat.width === 32 ? 2 : 1;
      for (let h = 0; h < halves && kept.length < ed.LINE_STRIPS; h++)
        kept.push({ s: s, pat: pat, half: h });
    }
    /* paint last-to-first so the lowest SAT index wins */
    const out = col.slice();
    for (let k = kept.length - 1; k >= 0; k--) {
      const s = kept[k].s, pat = kept[k].pat, half = kept[k].half;
      const rowoff = y - s.y;
      const row = s.vflip ? pat.height - 1 - rowoff : rowoff;
      const srcHalf = (s.hflip && pat.width === 32) ? 1 - half : half;
      for (let xin = 0; xin < 16; xin++) {
        const patX = srcHalf * 16 + (s.hflip ? 15 - xin : xin);
        const v = pat.pixels[row * pat.width + patX];
        if (!v) continue;
        const x = s.x + half * 16 + xin;
        if (x < 0 || x >= W) continue;
        if (!s.priority && num[x] !== 0) continue;
        out[x] = pic.spritePalettes[s.palette][v];
      }
    }
    for (let x = 0; x < W; x++) {
      const cw = out[x];
      const o = (y * W + x) * 3;
      px[o] = 36 * ((cw >> 3) & 7);
      px[o + 1] = 36 * ((cw >> 6) & 7);
      px[o + 2] = 36 * (cw & 7);
    }
  }
  return { width: W, height: H, pixels: px };
}

function pixelAt(img, x, y) {
  const o = (y * img.width + x) * 3;
  return [img.pixels[o], img.pixels[o + 1], img.pixels[o + 2]];
}

function samePixel(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function diffPixels(got, ref, label) {
  if (got.width !== ref.width || got.height !== ref.height)
    return `${label}: SIZE ${got.width}x${got.height} vs ${ref.width}x${ref.height}`;
  let diffs = 0, first = -1;
  for (let i = 0; i < got.pixels.length; i++) {
    if (got.pixels[i] !== ref.pixels[i]) {
      diffs++;
      if (first < 0) first = i;
    }
  }
  if (diffs === 0) return null;
  return `${label}: ${diffs} differing bytes of ${got.pixels.length}; first ` +
         `at pixel ${(first / 3) | 0}`;
}

/* ---- 1. the refusals --------------------------------------------------- */
function refusal(editor, fn, code, label) {
  try {
    fn(editor);
  } catch (e) {
    if (e.code !== code)
      return `${label}: refused with code "${e.code}", expected "${code}" ` +
             `(${e.message})`;
    return null;
  }
  return `${label}: accepted — it must be refused`;
}

function checkRefusals(editor) {
  const pic = editor.newPicture();
  editor.setPaletteColour(pic, 0, 1, editor.colourWord(7, 0, 0));
  const blank = editor.FIRST_CHAR;
  const tile = editor.newTile(pic, 0);
  const cases = [
    ["17th colour in a tile (pixel number 16)",
     (e) => e.paintTileIndex(pic, tile, 0, 0, 16), "17th-colour"],
    ["pixel number 255",
     (e) => e.paintTileIndex(pic, tile, 0, 0, 255), "17th-colour"],
    ["pixel number -1",
     (e) => e.paintTileIndex(pic, tile, 0, 0, -1), "colour-index"],
    ["17th palette (setPaletteColour)",
     (e) => e.setPaletteColour(pic, 16, 1, 0), "17th-palette"],
    ["17th palette (newTile)",
     (e) => e.newTile(pic, 16), "17th-palette"],
    ["17th palette (setTilePalette)",
     (e) => e.setTilePalette(pic, tile, 16), "17th-palette"],
    ["17th colour in a palette (entry 16)",
     (e) => e.setPaletteColour(pic, 0, 16, 0), "17th-colour"],
    ["VCE colour 512",
     (e) => e.setPaletteColour(pic, 0, 1, 512), "colour-range"],
    ["a colour the tile's palette does not hold",
     (e) => e.paintTileColour(pic, tile, 0, 0, e.colourWord(0, 7, 0)),
     "not-in-palette"],
    ["a map column past the 32x32 BAT",
     (e) => e.paintMapCell(pic, 32, 0, blank), "map-range"],
    ["a character past the 32768-word VRAM",
     (e) => e.paintMapCell(pic, 0, 0, 0x800), "vram-range"],
    ["a character with no tile",
     (e) => e.paintMapCell(pic, 0, 0, 0x7FF), "no-tile"]
  ];
  const problems = [];
  for (const [label, fn, code] of cases) {
    const p = refusal(editor, fn, code, label);
    if (p) problems.push(p);
  }
  /* a legal paint must still work */
  try {
    editor.paintTileIndex(pic, tile, 0, 0, 15);
    editor.paintTileColour(pic, tile, 1, 0, editor.colourWord(7, 0, 0));
    editor.paintMapCell(pic, 0, 0, tile);
  } catch (e) {
    problems.push(`a legal paint was refused: ${e.message}`);
  }

  /* ---- #13: the sprite refusals ---------------------------------------- */
  const spic = editor.newPicture();
  const spat = editor.newSpritePattern(spic, 16, 16);
  const spriteCases = [
    ["an illegal sprite size (16x48)",
     () => editor.newSpritePattern(spic, 16, 48), "sprite-size"],
    ["an illegal sprite size (24x24)",
     () => editor.newSpritePattern(spic, 24, 24), "sprite-size"],
    ["a 17th colour in a sprite palette (entry 16)",
     () => editor.setSpritePaletteColour(spic, 0, 16, 0), "17th-colour"],
    ["a 17th sprite palette",
     () => editor.setSpritePaletteColour(spic, 16, 1, 0),
     "17th-sprite-palette"],
    ["a sprite pixel colour 16",
     () => editor.paintSpriteIndex(spic, spat, 0, 0, 16), "17th-colour"],
    ["a sprite past the screen edge",
     () => editor.addSprite(spic, { x: 256, y: 0, pattern: spat }),
     "sprite-range"],
    ["a 17th sprite palette in a SAT entry",
     () => editor.addSprite(spic, { x: 0, y: 0, pattern: spat, palette: 16 }),
     "17th-sprite-palette"]
  ];
  for (const [label, fn, code] of spriteCases) {
    const p = refusal(editor, fn, code, label);
    if (p) problems.push(p);
  }

  /* the 65th sprite: 64 are legal, the next is refused */
  let made = 0, code = null;
  try {
    for (let i = 0; i < editor.MAX_SPRITES; i++) {
      editor.addSprite(spic, { x: i % 256, y: 0, pattern: spat });
      made++;
    }
    editor.addSprite(spic, { x: 0, y: 0, pattern: spat });
    problems.push("a 65th sprite: accepted — it must be refused");
  } catch (e) {
    code = e.code;
    if (code !== "65th-sprite")
      problems.push(`a 65th sprite: refused with code "${code}", expected ` +
                    `"65th-sprite" (${e.message})`);
    if (made !== editor.MAX_SPRITES)
      problems.push(`only ${made} of ${editor.MAX_SPRITES} legal sprites ` +
                    `were accepted before the refusal`);
  }
  spriteCases.push(["a 65th sprite", () => {}, "65th-sprite"]);

  /* a sprite pattern past VRAM: patterns are packed after the tiles, and one
   * whose cells would reach the SAT at $7F00 is refused, leaving the picture
   * unchanged */
  const full = editor.newPicture();
  made = 0;
  code = null;
  try {
    for (;;) {
      editor.newSpritePattern(full, 16, 64);
      made++;
      if (made > 4096) throw new Error("no refusal");
    }
  } catch (e) {
    code = e.code || e.message;
  }
  if (code !== "sprite-pattern-vram")
    problems.push(`a sprite pattern past VRAM: refused with "${code}", ` +
                  `expected "sprite-pattern-vram"`);
  if (made === 0)
    problems.push("a sprite pattern past VRAM: no pattern was accepted at all");
  if (full.spritePatterns.length !== made)
    problems.push(`a refused pattern was stored (${full.spritePatterns.length} ` +
                  `patterns after ${made} accepted)`);
  spriteCases.push(["a sprite pattern past VRAM", () => {},
                    "sprite-pattern-vram"]);

  /* a legal sprite add must still work on a picture the refusals left */
  try {
    editor.addSprite(full, { x: 0, y: 0, pattern: 0 });
  } catch (e) {
    problems.push(`a legal sprite add was refused: ${e.message}`);
  }

  return { problems, count: cases.length + spriteCases.length };
}

/* ---- 2. a picture painted from scratch -------------------------------- */
function checkPicture(pic) {
  const problems = [];
  const st = ed.stats(pic);
  const invalid = ed.validate(pic);
  if (invalid.length) problems.push(...invalid.map((s) => `validate: ${s}`));
  if (st.tiles > ed.MAX_TILES)
    problems.push(`${st.tiles} tiles, the layout gives ${ed.MAX_TILES}`);
  if (st.palettesUsed > ed.PALETTES)
    problems.push(`${st.palettesUsed} palettes, the VDC has ${ed.PALETTES}`);
  for (let c = ed.FIRST_CHAR; c < pic.nextChar; c++) {
    const n = ed.coloursInTile(pic, c).length;
    if (n > ed.ENTRIES)
      problems.push(`tile $${c.toString(16)} shows ${n} colours`);
  }

  /* the visible 28x32 cells are painted; the invisible rows are the blank */
  let painted = 0;
  for (let my = 0; my < 28; my++)
    for (let mx = 0; mx < ed.BAT_W; mx++) {
      const c = ed.mapCell(pic, mx, my);
      if (c !== ed.FIRST_CHAR) painted++;
    }
  if (painted === 0)
    problems.push("the demo painted no map cells");

  /* two independent paths to the same 256x224 frame */
  const data = ed.toPicture(pic);
  if (data.vram.length !== 65536)
    problems.push(`vram ${data.vram.length} bytes, expected 65536`);
  if (data.cram.length !== 1024)
    problems.push(`cram ${data.cram.length} bytes, expected 1024`);
  const drawn = bg.renderFrame({
    vram: data.vram, cram: data.cram, regs: ed.viewRegs(pic),
    width: ed.VIEW_W, height: ed.VIEW_H
  });
  const expected = modelFrame(pic);
  const p = diffPixels(drawn, expected, "model vs renderer");
  if (p) problems.push(p);

  return { problems, st, painted, data, drawn };
}

/* ---- 2b. the sprite scene (card #13) ----------------------------------- */
function checkSpritePicture(pic) {
  const problems = [];
  const W = ed.VIEW_W, H = ed.VIEW_H;
  const st = ed.stats(pic);
  const invalid = ed.validate(pic);
  if (invalid.length) problems.push(...invalid.map((s) => `validate: ${s}`));
  if (st.sprites !== 36)
    problems.push(`${st.sprites} sprites in the scene, expected 36`);
  if (st.spritePatterns !== 6)
    problems.push(`${st.spritePatterns} sprite patterns, expected 6`);

  /* every VDC size exists */
  const sizes = pic.spritePatterns.map((p) => p.width + "x" + p.height);
  for (const s of ["16x16", "32x16", "16x32", "32x32", "16x64", "32x64"])
    if (sizes.indexOf(s) < 0) problems.push(`no ${s} sprite pattern`);

  /* all 16 sprite palettes are chosen by some sprite */
  const pals = {};
  pic.sprites.forEach((s) => { pals[s.palette] = true; });
  if (Object.keys(pals).length !== ed.SPRITE_PALETTES)
    problems.push(`${Object.keys(pals).length} sprite palettes used, expected ` +
                  ed.SPRITE_PALETTES);

  /* the live budget: going past 16 strips is allowed but reported the way
   * the renderer draws it */
  const budget = ed.spriteBudget(pic);
  if (budget.limitStrips !== 16 || budget.limitPixels !== 256)
    problems.push(`budget limit is ${budget.limitStrips} strips / ` +
                  `${budget.limitPixels} px, expected 16 / 256`);
  if (!budget.worst || budget.worst.strips !== 16)
    problems.push("no line reaches the 16-strip budget");
  if (!budget.worst || budget.worst.dropped < 1)
    problems.push("the crowded line reports no dropped strips");
  if (budget.droppedLines < 1)
    problems.push("no line reports dropped strips");
  const crowd = ed.spriteLineBudget(pic, 200);
  if (crowd.strips !== 16 || crowd.dropped !== 5)
    problems.push(`line 200: ${crowd.strips} strips kept, ${crowd.dropped} ` +
                  `dropped; expected 16 and 5`);
  const half = crowd.entries.filter((e) => e.sprite === 31)[0];
  if (!half || half.kept !== 1 || half.dropped !== 1)
    problems.push("line 200: the 32-px sprite's left strip should be kept " +
                  "and its right strip dropped");

  /* the encoded picture */
  const data = ed.toPicture(pic);
  if (data.vram.length !== 65536)
    problems.push(`vram ${data.vram.length} bytes, expected 65536`);
  if (data.cram.length !== 1024)
    problems.push(`cram ${data.cram.length} bytes, expected 1024`);
  if (data.regions.length !== 2)
    problems.push(`${data.regions.length} copy regions, expected 2 ` +
                  `(tiles, sprite patterns)`);
  if (data.regs.CR !== 0xC0)
    problems.push(`CR=${data.regs.CR.toString(16)}, expected c0 (BG + sprites)`);
  if (data.regs.MWR !== 0x00) problems.push("MWR is not 0 (32x32 BAT)");

  /* the SAT at VRAM $7F00 is the editor's own SAT words */
  const sat = data.vram.slice(SAT_BYTE, SAT_BYTE + 512);
  const words = ed.satWords(pic);
  let satDiffs = 0;
  for (let i = 0; i < 256; i++) {
    const got = sat[i * 2] | (sat[i * 2 + 1] << 8);
    if (got !== (words[i] & 0xFFFF)) satDiffs++;
  }
  if (satDiffs) problems.push(`${satDiffs}/256 SAT words differ from ` +
                              `satWords()`);

  /* for every line, the editor's budget must equal what pce-sprites.js
   * actually collects — the preview and the renderer agree on the drops */
  let lineDiffs = 0;
  for (let y = 0; y < H; y++) {
    const b = ed.spriteLineBudget(pic, y);
    const strips = sprites.collectStrips(sat, y);
    if (b.strips !== strips.length) lineDiffs++;
  }
  if (lineDiffs)
    problems.push(`${lineDiffs} line(s) where the editor budget and ` +
                  `pce-sprites.js collectStrips disagree`);

  /* two independent paths to the same 256x224 frame */
  const drawn = sprites.renderFrame({
    vram: data.vram, cram: data.cram, regs: ed.viewRegs(pic),
    sat: sat, width: W, height: H
  });
  const expected = modelSpriteFrame(pic);
  const p = diffPixels(drawn, expected, "sprite model vs renderer");
  if (p) problems.push(p);

  /* the readable witnesses: the dropped right half shows the background, the
   * kept 16th strip does not; SPBG=0 is hidden on the opaque half and shows
   * on the transparent half */
  const bgOnly = modelFrame(pic);
  if (!samePixel(pixelAt(drawn, 220, 205), pixelAt(bgOnly, 220, 205)))
    problems.push("the dropped right half of the 32-px sprite was drawn " +
                  "(pixel 220,205)");
  if (samePixel(pixelAt(drawn, 210, 205), pixelAt(bgOnly, 210, 205)))
    problems.push("the kept 16th strip was not drawn (pixel 210,205)");
  if (!samePixel(pixelAt(drawn, 170, 155), pixelAt(bgOnly, 170, 155)))
    problems.push("an SPBG=0 sprite showed over an opaque background pixel " +
                  "(170,155)");
  if (samePixel(pixelAt(drawn, 190, 155), pixelAt(bgOnly, 190, 155)))
    problems.push("an SPBG=1 sprite over the opaque half was hidden (190,155)");
  if (samePixel(pixelAt(drawn, 10, 155), pixelAt(bgOnly, 10, 155)))
    problems.push("an SPBG=0 sprite was hidden over the transparent half " +
                  "(10,155)");

  return { problems, st, data, sat, budget, drawn };
}

/* ---- 3. the export ----------------------------------------------------- */
function checkExport(data, romBytes, bank0) {
  const problems = [];
  const BANK = 8192;
  const batBytes = rom.batWords(data.regs.MWR) * 2;

  /* bank 1: config block, the 512 colour-table entries at 0x40 and the
   * SAT at 0x440 (card #14) */
  const cfg = romBytes.subarray(BANK, BANK + 64);
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  if (cfg[0] !== 1) problems.push("config version is not 1");
  if (u16(cfg, 2) !== data.regs.BXR) problems.push("config BXR differs");
  if (u16(cfg, 4) !== data.regs.BYR) problems.push("config BYR differs");
  if (cfg[6] !== data.regs.MWR) problems.push("config MWR differs");
  if (cfg[7] !== data.regs.CR) problems.push("config CR differs");
  if (cfg[8] !== data.regions.length) problems.push("config region count differs");
  for (let d = 0; d < data.regions.length; d++) {
    const at = 0x0A + d * 4;
    if (u16(cfg, at) !== data.regions[d][0] * 16)
      problems.push(`region ${d} destination differs`);
    if (u16(cfg, at + 2) !== data.regions[d][1] * 16)
      problems.push(`region ${d} word count differs`);
  }
  const paletteAt = BANK + 0x40;
  if (!Buffer.from(romBytes.subarray(paletteAt, paletteAt + 1024))
        .equals(Buffer.from(data.cram.subarray(0, 1024))))
    problems.push("the ROM's palettes are not the editor's CRAM");
  const satAt = BANK + 0x440;
  if (!Buffer.from(romBytes.subarray(satAt, satAt + 512))
        .equals(Buffer.from(data.vram.subarray(0xFE00, 0xFE00 + 512))))
    problems.push("the ROM's SAT is not the editor's VRAM words $7f00..");

  /* banks 2-3: the BAT */
  const batAt = 2 * BANK;
  if (!Buffer.from(romBytes.subarray(batAt, batAt + batBytes))
        .equals(Buffer.from(data.vram.subarray(0, batBytes))))
    problems.push("the ROM's BAT is not the editor's VRAM words 0..1023");

  /* bank 4+: the copy regions concatenated in descriptor order — for the
   * sprite scene, the tiles and then the sprite patterns */
  const regionsAt = 4 * BANK;
  const expected = [];
  let regionBytes = 0;
  for (let d = 0; d < data.regions.length; d++) {
    const dest = data.regions[d][0] * 16 * 2;      /* bytes into VRAM */
    const count = data.regions[d][1] * 32;         /* bytes */
    expected.push(Buffer.from(data.vram.subarray(dest, dest + count)));
    regionBytes += count;
  }
  const want = Buffer.concat(expected);
  if (!Buffer.from(romBytes.subarray(regionsAt, regionsAt + regionBytes))
        .equals(want))
    problems.push("the ROM's copy regions are not the editor's VRAM regions");

  /* the whole image is 4 + ceil(region bytes / 8 KiB) banks, as
   * ROM_LAYOUT.md */
  const banks = 4 + Math.max(1, Math.ceil(regionBytes / BANK));
  if (romBytes.length !== banks * BANK)
    problems.push(`${romBytes.length} bytes, the layout says ${banks * BANK}`);
  if (bank0.length !== BANK) problems.push("bank0 is not 8 KiB");
  return problems;
}

/* ---- 4. the Mednafen capture ------------------------------------------ */
function checkCapture(pic, data, sprite, captureDir) {
  const problems = [];
  const dir = captureDir || CAPTURE;
  const vram = fs.readFileSync(path.join(dir, "vram.bin"));
  const cram = fs.readFileSync(path.join(dir, "cram.bin"));
  const regs = JSON.parse(fs.readFileSync(path.join(dir, "regs.json"), "utf8"));
  const sat = data.vram.slice(SAT_BYTE, SAT_BYTE + 512);

  if (!vram.equals(Buffer.from(data.vram)))
    problems.push("captured VRAM is not the editor's VRAM");
  if (!cram.equals(Buffer.from(data.cram)))
    problems.push("captured CRAM is not the editor's 512 colour-table entries");
  for (const r of ["MWR", "BXR", "BYR", "CR"])
    if (regs[r] !== data.regs[r])
      problems.push(`captured ${r}=${regs[r]}, the editor wrote ${data.regs[r]}`);

  /* the SATB mirror: the VDC's DMA carried exactly the editor's SAT */
  const satPath = path.join(dir, "sat.bin");
  if (sprite) {
    if (!fs.existsSync(satPath)) {
      problems.push("the capture has no sat.bin (the SATB was not extracted)");
    } else {
      const captured = fs.readFileSync(satPath);
      if (!captured.equals(Buffer.from(sat)))
        problems.push("captured SATB is not the editor's SAT (VRAM $7F00)");
    }
  }

  /* the frame: the renderer drawing the EDITOR's picture, with the capture's
   * own scanline calibration (the capture starts one VDW line in) */
  const opts = { vram: data.vram, cram: data.cram, regs,
                 width: 256, height: 232 };
  if (sprite) opts.sat = sat;
  const drawn = sprite ? sprites.renderFrame(opts) : bg.renderFrame(opts);
  const png = decodePng(fs.readFileSync(path.join(dir, "mednafen.png")));
  const p = diffPixels(drawn, png, "capture vs editor picture");
  if (p) problems.push(p);

  /* what the capture shows of the visible picture: rows 0..222 are the
   * editor's rows 1..223 (the capture crops the first VDW line) */
  const previewOpts = {
    vram: data.vram, cram: data.cram, regs: ed.viewRegs(pic),
    width: 256, height: 224
  };
  if (sprite) previewOpts.sat = sat;
  const preview = sprite ? sprites.renderFrame(previewOpts)
                         : bg.renderFrame(previewOpts);
  let shiftedDiffs = 0;
  for (let y = 0; y < 223; y++)
    for (let x = 0; x < 256; x++)
      for (let k = 0; k < 3; k++)
        if (preview.pixels[((y + 1) * 256 + x) * 3 + k] !==
            png.pixels[(y * 256 + x) * 3 + k]) shiftedDiffs++;
  if (shiftedDiffs !== 0)
    problems.push(`preview vs capture rows 1..223: ${shiftedDiffs} differing ` +
                  `bytes (the capture should be the preview one row up)`);

  return problems;
}

/* ---- 5. the browser-global branch ------------------------------------- */
function loadBrowserGlobal() {
  const sandbox = { self: null };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(EDITOR_SRC, sandbox, { filename: "pce-editor.js" });
  if (!sandbox.PCEStudio || !sandbox.PCEStudio.editor)
    throw new Error("pce-editor.js did not install PCEStudio.editor");
  return sandbox.PCEStudio.editor;
}

/* ---- main -------------------------------------------------------------- */
function main() {
  const argv = process.argv.slice(2);
  const write = argv.indexOf("--write") >= 0;
  const writeSprite = write && argv.indexOf("sprite") >= 0;
  const writeBg = write && !writeSprite;
  let failed = 0;
  const out = (s) => console.log(s);
  const fail = (s) => { out(s); failed++; };

  /* 1. refusals */
  const ref = checkRefusals(ed);
  if (ref.problems.length) ref.problems.forEach(fail);
  else out(`refusals: ${ref.count}/${ref.count} refused with the documented ` +
           `code (tiles: 17th colour, 17th palette, not in the tile's ` +
           `palette, past VRAM; sprites: 65th sprite, pattern past VRAM, ` +
           `17th colour in a sprite palette, illegal size)`);

  /* 2. the background picture */
  const pic = ed.demoPicture();
  const picture = checkPicture(pic);
  if (picture.problems.length) picture.problems.forEach(fail);
  else out(`picture: ${ed.VIEW_W}x${ed.VIEW_H} painted from scratch, ` +
           `${picture.painted} visible cells, ${picture.st.tiles} tiles ` +
           `($${picture.st.charsFirst.toString(16)}-` +
           `$${picture.st.charsLast.toString(16)}), ` +
           `${picture.st.palettesUsed} palettes, validate 0 problems, ` +
           `model == renderer`);

  /* 2b. the sprite scene */
  const spic = ed.spriteDemoPicture();
  const spritePicture = checkSpritePicture(spic);
  if (spritePicture.problems.length) spritePicture.problems.forEach(fail);
  else {
    const b = spritePicture.budget;
    out(`sprite scene: ${spritePicture.st.sprites} sprites, ` +
        `${spritePicture.st.spritePatterns} patterns (all six sizes), ` +
        `${ed.SPRITE_PALETTES}/16 sprite palettes, ` +
        `${spritePicture.st.spritePatternCells} pattern cells; ` +
        `budget worst line ${b.worst.line}: ${b.worst.strips}/16 strips ` +
        `(${b.worst.pixels}/256 px), ${b.worst.dropped} dropped on it, ` +
        `${b.droppedLines} line(s) drop strips; model == pce-sprites.js`);
  }

  /* 3. the exports */
  const bank0 = new Uint8Array(fs.readFileSync(BANK0));
  const data = picture.data;
  const romBytes = rom.buildRom({
    bank0, vram: data.vram, cram: data.cram,
    regs: data.regs, regions: data.regions
  });
  const exportProblems = checkExport(data, romBytes, bank0);
  if (exportProblems.length) exportProblems.forEach(fail);
  else out(`export: ${romBytes.length} bytes, sha256 ${sha256(romBytes).slice(0, 16)}… ` +
           `(#9's builder) — config, palettes, BAT and tiles are the ` +
           `editor's data`);

  const sdata = spritePicture.data;
  const spriteRom = rom.buildRom({
    bank0, vram: sdata.vram, cram: sdata.cram,
    regs: sdata.regs, regions: sdata.regions
  });
  const spriteExportProblems = checkExport(sdata, spriteRom, bank0);
  if (spriteExportProblems.length) spriteExportProblems.forEach(fail);
  else out(`sprite export: ${spriteRom.length} bytes, ` +
           `sha256 ${sha256(spriteRom).slice(0, 16)}… — config, sprite ` +
           `palettes, SAT, BAT and both copy regions are the editor's data`);

  if (writeBg) {
    fs.mkdirSync(GEN, { recursive: true });
    const out2 = path.join(GEN, "painted.pce");
    fs.writeFileSync(out2, romBytes);
    out(`wrote ${path.relative(HERE, out2)} (${romBytes.length} bytes) — ` +
        `run: tools/capture.sh painted`);
  }
  if (writeSprite) {
    fs.mkdirSync(GEN, { recursive: true });
    const out2 = path.join(GEN, "spainted.pce");
    fs.writeFileSync(out2, spriteRom);
    out(`wrote ${path.relative(HERE, out2)} (${spriteRom.length} bytes) — ` +
        `run: tools/capture.sh spainted`);
  }

  /* 5. the browser-global branch */
  const globalEditor = loadBrowserGlobal();
  const gref = checkRefusals(globalEditor);
  const gpic = globalEditor.demoPicture();
  const gdata = globalEditor.toPicture(gpic);
  const grom = rom.buildRom({
    bank0, vram: gdata.vram, cram: gdata.cram,
    regs: gdata.regs, regions: gdata.regions
  });
  const gspic = globalEditor.spriteDemoPicture();
  const gsdata = globalEditor.toPicture(gspic);
  const gsrom = rom.buildRom({
    bank0, vram: gsdata.vram, cram: gsdata.cram,
    regs: gsdata.regs, regions: gsdata.regions
  });
  const sameBytes = Buffer.from(grom).equals(Buffer.from(romBytes)) &&
                    Buffer.from(gsrom).equals(Buffer.from(spriteRom));
  if (gref.problems.length || !sameBytes)
    fail(`browser-global branch: ${gref.problems.join("; ") ||
         "same refusals, different bytes"}`);
  else out(`browser-global branch: same ${gref.count}/${gref.count} ` +
           `refusals, same ${grom.length} and ${gsrom.length} bytes`);

  /* 4. the captures */
  const haveCapture = fs.existsSync(path.join(CAPTURE, "mednafen.png"));
  if (!haveCapture) {
    out(`capture: not present — run tools/capture.sh painted once the ROM ` +
        `is written`);
    /* --write is the build step that comes before the capture; the check
     * without --write requires the capture */
    if (!write) failed++;
  } else {
    const problems = checkCapture(pic, data, false, CAPTURE);
    if (problems.length) problems.forEach(fail);
    else out(`capture: tests/dumps/painted is the editor's VRAM/CRAM/regs ` +
             `and Mednafen's frame equals the editor's picture (diff 0)`);
  }

  const haveSpriteCapture =
    fs.existsSync(path.join(SPRITE_CAPTURE, "mednafen.png"));
  if (!haveSpriteCapture) {
    out(`sprite capture: not present — run tools/capture.sh spainted once ` +
        `the ROM is written`);
    if (!write) failed++;
  } else {
    const problems = checkCapture(spic, sdata, true, SPRITE_CAPTURE);
    if (problems.length) problems.forEach(fail);
    else out(`sprite capture: tests/dumps/spainted is the editor's VRAM/` +
             `CRAM/regs/SAT and Mednafen's frame equals the editor's sprite ` +
             `picture (diff 0)`);
  }

  out(failed === 0
    ? (haveCapture && haveSpriteCapture
      ? "PASS: the editor paints tiles and sprites, refuses what the VDC " +
        "cannot show, exports #9's ROM and Mednafen shows both pictures"
      : "PASS: the editor paints tiles and sprites, refuses what the VDC " +
        "cannot show and exports #9's ROM — a Mednafen capture is still to " +
        "be made")
    : `FAIL: ${failed} problem(s)`);
  return failed === 0 ? 0 : 1;
}

process.exitCode = main();
