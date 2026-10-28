#!/usr/bin/env node
/*
 * tests/check-panels.js — the closing measurement of #26 (the model's panels).
 *
 * NOTE: written by @design because the card's close condition needs a diff
 * script; per the workshop role split this is flagged for @review to read
 * cold (same arrangement as check.js, check-editor.js, check-viewer.js).
 *
 * The card asks the panels in renderer/editor.html to be drawn from the same
 * state the renderer draws — no second copy.  This check takes that
 * literally: it calls renderer/pce-panels.js with the dump's own vram, cram,
 * sat, regs and raster.json, and compares every panel against an
 * INDEPENDENT computation written here from the raw bytes.  Nothing in this
 * file calls the panel's follow, map or register functions to compute the
 * expected value; the expected value is rebuilt from the Hudson rules:
 *
 *   - the BAT geometry from MWR (32/64/128 wide, 32/64 rows);
 *   - the per-line BXR/BYR/CR from raster.json, with the manual's BYR+1
 *     mid-frame rule and the frame-start latch (the rules pce-bg.js's
 *     buildRows documents; re-derived here from the table, not called);
 *   - the background pixel from the BAT word -> character/palette -> two
 *     plane words (bit 7 leftmost);
 *   - the sprite layer from the 64 SAT entries: CGX/CGY sizes, block masking,
 *     VFLIP before the block select, the 16-strip line budget in SAT order,
 *     HFLIP, pixel 0 transparent, and the lower SAT index winning;
 *   - the BB/SB gates from CR bit 7/6 and SPBG priority;
 *   - the VCE colour table per line (baseCram, this frame's write at or
 *     before the line, the previous frame's afterwards) and 9-bit colour.
 *
 * For dumps it also compares the panel's colour with tests/dumps/<name>/
 * mednafen.png at the same pixel — the captured frame is the third witness,
 * so a panel that agrees with this file but not with the console fails.
 *
 * What it checks, per dump:
 *   1. follow-a-pixel at >= 20 chosen pixels (a 13x12 grid plus pixels on
 *      every non-empty SAT sprite): the layer, the 9-bit colour index and
 *      word, the BAT entry/tile/palette/colour number or the sprite
 *      number/pattern/palette/colour number, the per-line registers, and the
 *      RGB vs the Mednafen frame.
 *   2. the VRAM map: its copy regions equal regions.json's tile_regions where
 *      that file exists; its segments partition all 32768 words exactly once;
 *      the BAT size follows MWR and the SAT sits at the dump's DVSSR/SATB.
 *   3. the per-line register panel vs raster.json (every entry appears on its
 *      line, the values between entries carry, the RCR chain arm matches).
 *   4. the VCE panel: 32 palettes of 16; per-line tables on the raster dumps,
 *      the flat CRAM table on the others.
 *   5. the SAT panel: 64 rows whose words are sat.bin's (or VRAM $7F00) and
 *      whose CGX/CGY cells follow the sprite size.
 *
 * The dumps are a background scene (scene1), a sprite scene (sprite1), raster
 * scenes (raster1 BYR, raster4 per-line colour, raster5 per-line CR), the
 * painted picture (painted, the #10 editor's ROM captured from Mednafen) and
 * a 64-wide BAT (scene4); scene9 (characters >= $800) is the BAT-boundary
 * case.  The editor's own demo and sprite pictures are checked through the
 * same file so the page's model path is exercised, and the browser-global
 * branch (no `module`, a `self`) gives the same traces.
 *
 *   node tests/check-panels.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const vm = require("vm");
const panels = require("../renderer/pce-panels.js");

let checks = 0;
let failures = 0;
function fail(message) {
  failures++;
  console.log(`FAIL  ${message}`);
}
function ok(what, got, want) {
  checks++;
  if (got !== want) {
    fail(`${what}: got ${JSON.stringify(got)}, expected ` +
         `${JSON.stringify(want)}`);
    return false;
  }
  return true;
}
function okv(what, problems) {
  checks++;
  if (problems.length) {
    fail(`${what}:`);
    problems.slice(0, 8).forEach((p) => console.log(`        ${p}`));
    return false;
  }
  return true;
}

/* ---- PNG: 8-bit, non-interlaced, colour types 0/2/6 (same as check.js) -- */
function decodePng(buf) {
  if (buf.slice(0, 8).toString("latin1") !== "\x89PNG\r\n\x1a\n")
    throw new Error("not a PNG");
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colourType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.slice(pos + 4, pos + 8).toString("latin1");
    const data = buf.slice(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colourType = data[9];
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
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) &
                  0xFF;
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

/* ---- dumps ------------------------------------------------------------- */
function loadDump(name) {
  const dir = path.join(__dirname, "dumps", name);
  const regs = JSON.parse(fs.readFileSync(path.join(dir, "regs.json"), "utf8"));
  const firstScanline = 14 + (regs.slstart != null ? regs.slstart : 4);
  const d = {
    name,
    dir,
    regs,
    firstScanline,
    vram: fs.readFileSync(path.join(dir, "vram.bin")),
    cram: fs.readFileSync(path.join(dir, "cram.bin")),
    sat: null,
    raster: null,
    regions: null,
    png: decodePng(fs.readFileSync(path.join(dir, "mednafen.png")))
  };
  if (fs.existsSync(path.join(dir, "sat.bin")))
    d.sat = fs.readFileSync(path.join(dir, "sat.bin"));
  if (fs.existsSync(path.join(dir, "raster.json")))
    d.raster = JSON.parse(fs.readFileSync(path.join(dir, "raster.json"), "utf8"));
  if (fs.existsSync(path.join(dir, "regions.json")))
    d.regions = JSON.parse(
      fs.readFileSync(path.join(dir, "regions.json"), "utf8")).tile_regions;
  d.opts = {
    vram: d.vram,
    cram: d.cram,
    sat: d.sat || undefined,
    regs: d.regs,
    raster: d.raster || undefined,
    firstScanline,
    width: 256,
    height: 232,
    regions: d.regions || undefined
  };
  return d;
}

/* ---- the independent model (raw bytes -> expected panel values) -------- */

const WIDTHS = [32, 64, 128, 128];
const SHIFTS = [5, 6, 7, 7];
const CGY_HEIGHT = [16, 32, 64, 64];
const CGY_BLOCKS = [1, 2, 4, 4];
const CGY_MASK = [0x3FF, 0x3FF & ~2, 0x3FF & ~6, 0x3FF & ~6];

function wordAt(bytes, word) {
  return bytes[word * 2] | (bytes[word * 2 + 1] << 8);
}

function cramWords(cram) {
  const out = new Array(512);
  for (let i = 0; i < 512; i++) out[i] = wordAt(cram, i);
  return out;
}

/* pce-bg.js's documented per-line rules, re-derived from raster.json. */
function independentModel(opts) {
  const regs = opts.regs || {};
  const width = opts.width || 256;
  const height = opts.height || 232;
  const firstScanline = opts.firstScanline != null ? opts.firstScanline : 18;
  const vdwLine0 = (regs.RCRCount != null && regs.scanline != null)
    ? regs.RCRCount - (regs.scanline - firstScanline) : 0;
  const raster = opts.raster;
  const entries = raster && raster.entries
    ? raster.entries.slice().sort((a, b) => a.line - b.line) : [];
  const base = (raster && raster.base) || {};
  const geom = (() => {
    const mode = ((regs.MWR || 0) >> 4) & 3;
    const w = WIDTHS[mode], h = ((regs.MWR || 0) & 0x40) ? 64 : 32;
    return { width: w, height: h, shift: SHIFTS[mode],
             wmask: w - 1, hmask: h - 1 };
  })();
  const satAddr = regs.DVSSR != null ? regs.DVSSR
                : regs.SATB != null ? regs.SATB : 0x7F00;
  const sat = opts.sat || opts.vram.slice(satAddr * 2, satAddr * 2 + 512);

  /* frame-start values: the previous frame's last write per kind */
  let lastBxr = null, lastByr = null, lastCr = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (lastBxr == null && e.bxr != null) lastBxr = e.bxr;
    if (lastByr == null && e.byr != null) lastByr = e.byr;
    if (lastCr == null && e.cr != null) lastCr = e.cr;
  }
  let bxr = lastBxr != null ? lastBxr & 0x3FF
          : base.bxr != null ? base.bxr & 0x3FF : (regs.BXR || 0) & 0x3FF;
  let byrN = 0;
  let byrV = lastByr != null ? lastByr & 0x1FF
           : base.byr != null ? base.byr & 0x1FF : (regs.BYR || 0) & 0x1FF;
  let cr = lastCr != null ? lastCr & 0xFF
         : base.cr != null ? base.cr & 0xFF : (regs.CR || 0) & 0xFF;
  const flat = cramWords(opts.cram);
  let words = raster && raster.baseCram ? raster.baseCram.slice() : flat.slice();
  for (const e of entries) {
    if (!e.cram) continue;
    for (const [a, v] of (e.cramPrev || e.cram)) words[a] = v & 0x1FF;
  }

  const rows = [];
  let cursor = 0, applied = null;
  for (let r = 0; r < height; r++) {
    const line = vdwLine0 + r;
    let atLine = null;
    while (cursor < entries.length && entries[cursor].line <= line) {
      const e = entries[cursor++];
      applied = e;
      if (e.bxr != null) bxr = e.bxr & 0x3FF;
      if (e.byr != null) { byrN = e.line; byrV = e.byr & 0x1FF; }
      if (e.cr != null) cr = e.cr & 0xFF;
      if (e.cram) for (const [a, v] of e.cram) words[a] = v & 0x1FF;
      atLine = e;
    }
    const lineWords = words.slice();
    const nextEntry = entries.length ? entries[cursor % entries.length] : null;
    rows.push({
      row: r,
      line,
      bxr,
      byr: byrV,
      cr,
      bgY: (byrV + (line - byrN) + (byrN === 0 ? 0 : 1)) & 0x1FF,
      words: lineWords,
      entry: applied,
      entryAtLine: atLine != null && atLine.line === line,
      entryRcr: atLine != null && atLine.line === line ? atLine.rcr : null,
      rcr: nextEntry ? 0x40 + nextEntry.line : null
    });
  }
  return { opts, regs, width, height, vdwLine0, geom, sat, vram: opts.vram,
           entries, rows };
}

function independentBackground(m, row, x) {
  if (!(row.cr & 0x80))
    return { blanking: true, index: 0x100 };
  const g = m.geom;
  const col = (row.bxr + x) & 7;
  const batIndex = (((row.bxr + x) >> 3) & g.wmask) |
                   (((row.bgY >> 3) & g.hmask) << g.shift);
  const batWord = wordAt(m.vram, batIndex);
  const char = batWord & 0xFFF;
  const palette = (batWord >> 12) & 0xF;
  const tileRow = row.bgY & 7;
  let colourNumber = 0;
  if (char < 0x800) {
    const addr = char * 16 + tileRow;
    const bit = 7 - col;
    const w0 = wordAt(m.vram, addr);
    const w1 = wordAt(m.vram, addr + 8);
    colourNumber = ((w0 >> bit) & 1) |
                   (((w0 >> (bit + 8)) & 1) << 1) |
                   (((w1 >> bit) & 1) << 2) |
                   (((w1 >> (bit + 8)) & 1) << 3);
  }
  return {
    blanking: false,
    index: colourNumber === 0 ? 0 : (palette << 4) | colourNumber,
    batIndex, batWord, char, palette, tileRow, tileColumn: col,
    colourNumber, beyondVram: char >= 0x800
  };
}

/* The sprite strips of one VDW line, in SAT order, at most 16 (the manual's
 * line limit).  Re-derived from the SAT words, not from collectStrips. */
function independentStrips(m, vdwLine) {
  const strips = [];
  for (let i = 0; i < 64 && strips.length < 16; i++) {
    const w0 = wordAt(m.sat, i * 4);
    const w3 = wordAt(m.sat, i * 4 + 3);
    const w2 = wordAt(m.sat, i * 4 + 2);
    const cgy = (w3 >> 12) & 3;
    const height = CGY_HEIGHT[cgy];
    const row0 = (w0 & 0x3FF) - 64;
    if (vdwLine < row0 || vdwLine >= row0 + height) continue;
    let yoff = vdwLine - row0;
    if (w3 & 0x8000) yoff = height - 1 - yoff;
    const p = (w2 >> 1) & 0x3FF;
    let cell = (p & CGY_MASK[cgy]) | ((yoff & 0x30) >> 3);
    const row = yoff & 15;
    const hflip = (w3 >> 11) & 1;
    const spbg = (w3 >> 7) & 1;
    const pal = w3 & 0xF;
    const leftX = (wordAt(m.sat, i * 4 + 1) & 0x3FF) - 32;
    if ((w3 >> 8) & 1) {
      cell &= ~1;
      strips.push({ number: i, cell: hflip ? cell | 1 : cell, x: leftX,
                    row, pal, spbg, hflip });
      if (strips.length < 16)
        strips.push({ number: i, cell: hflip ? cell : cell | 1,
                      x: leftX + 16, row, pal, spbg, hflip });
    } else {
      strips.push({ number: i, cell, x: leftX, row, pal, spbg, hflip });
    }
  }
  return strips;
}

function independentSprite(m, vdwLine, x) {
  for (const s of independentStrips(m, vdwLine)) {
    const dx = x - s.x;
    if (dx < 0 || dx >= 16) continue;
    const base = s.cell * 64 + s.row;
    const w0 = wordAt(m.vram, base), w1 = wordAt(m.vram, base + 16);
    const w2 = wordAt(m.vram, base + 32), w3 = wordAt(m.vram, base + 48);
    const bit = s.hflip ? dx : 15 - dx;
    const pix = ((w0 >> bit) & 1) | (((w1 >> bit) & 1) << 1) |
                (((w2 >> bit) & 1) << 2) | (((w3 >> bit) & 1) << 3);
    if (pix) {
      const w3sat = wordAt(m.sat, s.number * 4 + 3);
      return {
        number: s.number,
        pattern: (wordAt(m.sat, s.number * 4 + 2) >> 1) & 0x3FF,
        palette: w3sat & 0xF,
        colourNumber: pix,
        index: 0x100 | ((w3sat & 0xF) << 4) | pix,
        spbg: s.spbg,
        cell: s.cell,
        cellRow: s.row,
        stripColumn: dx
      };
    }
  }
  return null;
}

function independentFollow(m, x, y) {
  const row = m.rows[y];
  if (!row) throw new Error(`row ${y} outside the independent model`);
  const bg = independentBackground(m, row, x);
  const sprite = (row.cr & 0x40) ? independentSprite(m, row.line, x) : null;
  let layer = bg.blanking ? "blanking" : "background";
  let index = bg.index;
  if (sprite && (sprite.spbg || (bg.index & 0xF) === 0)) {
    layer = "sprite";
    index = sprite.index;
  }
  return {
    layer, index, background: bg, sprite,
    word: row.words[index] & 0x1FF,
    registers: { BXR: row.bxr, BYR: row.byr, CR: row.cr,
                 BG_YOffset: row.bgY, line: row.line },
    words: row.words
  };
}

/* ---- 1. follow a pixel ------------------------------------------------- */

function chosenPixels(m, maxY) {
  const xs = [0, 1, 7, 31, 32, 63, 64, 100, 127, 128, 191, 224, 255];
  const ys = [0, 1, 7, 8, 17, 33, 64, 100, 150, 199, 223, 231];
  const out = [];
  for (const y of ys) {
    if (y > maxY) continue;
    for (const x of xs) out.push([x, y]);
  }
  /* every non-empty SAT sprite gets pixels on its top, middle and bottom
   * rows so the sprite layer (and a lost-over-background sprite) is hit */
  for (let i = 0; i < 64; i++) {
    const w0 = wordAt(m.sat, i * 4), w1 = wordAt(m.sat, i * 4 + 1);
    const w2 = wordAt(m.sat, i * 4 + 2), w3 = wordAt(m.sat, i * 4 + 3);
    if (!(w0 | w1 | w2 | w3)) continue;
    const cgy = (w3 >> 12) & 3;
    const h = CGY_HEIGHT[cgy], w = ((w3 >> 8) & 1) ? 32 : 16;
    const left = (w1 & 0x3FF) - 32;
    const top = (w0 & 0x3FF) - 64;
    const xsAt = [left, left + (w >> 1), left + w - 1];
    const ysAt = [top, top + (h >> 1), top + h - 1];
    for (const sy of ysAt) {
      const row = sy - m.vdwLine0;
      if (row < 0 || row > maxY) continue;
      for (const sx of xsAt) {
        if (sx >= 0 && sx < 256) out.push([sx, row]);
      }
    }
  }
  return out;
}

function checkFollow(m, name, png, wantAtLeast) {
  const pixels = chosenPixels(m, m.height - 1);
  if (pixels.length < wantAtLeast) {
    fail(`${name}: only ${pixels.length} pixels chosen, need ` +
         `${wantAtLeast}`);
    return { pixels: pixels.length, layers: {} };
  }
  const layers = { sprite: 0, background: 0, blanking: 0 };
  let trace = null;
  try {
    trace = panels.state(m.opts);
  } catch (e) {
    fail(`${name}: panels.state threw: ${e.message}`);
    return { pixels: pixels.length, layers };
  }
  for (const [x, y] of pixels) {
    const want = independentFollow(m, x, y);
    const got = panels.followPixel(trace, x, y);
    const where = `${name} px(${x},${y})`;
    layers[want.layer]++;
    if (!ok(`${where} layer`, got.layer, want.layer)) continue;
    ok(`${where} colour index`, got.index, want.index);
    ok(`${where} colour word`, got.colour.word, want.word);
    ok(`${where} line`, got.line, want.registers.line);
    ok(`${where} BXR`, got.registers.BXR, want.registers.BXR);
    ok(`${where} BYR`, got.registers.BYR, want.registers.BYR);
    ok(`${where} CR`, got.registers.CR, want.registers.CR);
    ok(`${where} BG_YOffset`, got.registers.BG_YOffset,
       want.registers.BG_YOffset);
    if (!want.background.blanking) {
      const gb = got.background || {};
      ok(`${where} BAT word`, gb.batWord, want.background.batWord);
      ok(`${where} BAT index`, gb.batIndex, want.background.batIndex);
      ok(`${where} character`, gb.char, want.background.char);
      ok(`${where} palette`, gb.palette, want.background.palette);
      ok(`${where} colour number`, gb.colourNumber,
         want.background.colourNumber);
      ok(`${where} tile row`, gb.tileRow, want.background.tileRow);
      ok(`${where} tile column`, gb.tileColumn, want.background.tileColumn);
    } else {
      ok(`${where} blanking`, got.background && got.background.blanking, true);
    }
    if (want.sprite) {
      const gs = got.sprite || {};
      ok(`${where} sprite number`, gs.number, want.sprite.number);
      ok(`${where} sprite pattern`, gs.pattern, want.sprite.pattern);
      ok(`${where} sprite palette`, gs.palette, want.sprite.palette);
      ok(`${where} sprite colour`, gs.colourNumber,
         want.sprite.colourNumber);
      ok(`${where} sprite cell`, gs.cell, want.sprite.cell);
      ok(`${where} sprite strip column`, gs.stripColumn,
         want.sprite.stripColumn);
    }
    if (png) {
      const o = (y * png.width + x) * 3;
      const rgb = [png.pixels[o], png.pixels[o + 1], png.pixels[o + 2]];
      const gotRgb = [got.colour.r, got.colour.g, got.colour.b];
      checks++;
      if (rgb[0] !== gotRgb[0] || rgb[1] !== gotRgb[1] ||
          rgb[2] !== gotRgb[2]) {
        fail(`${where} RGB: panel ${gotRgb.join(",")}, Mednafen ` +
             `${rgb.join(",")}`);
      }
    }
  }
  return { pixels: pixels.length, layers, trace };
}

/* ---- 2. the VRAM map --------------------------------------------------- */

function checkVramMap(m, name, regionsJson) {
  const map = panels.vramMap(panels.state(m.opts));
  const problems = [];

  /* a partition of all 32768 words: contiguous, no overlap, covers 0..32767 */
  let expect = 0;
  for (const s of map.segments) {
    if (s.start !== expect)
      problems.push(`segment at ${s.start} leaves a gap/overlap from ${expect}`);
    if (s.words <= 0) problems.push(`segment at ${s.start} has ${s.words} words`);
    expect = s.start + s.words;
  }
  if (expect !== 32768)
    problems.push(`segments cover ${expect} words, expected 32768`);
  const free = map.free.reduce((a, b) => a + b.words, 0);
  const occupied = 32768 - free;

  /* BAT and SAT follow the state */
  const wantBat = m.geom.width * m.geom.height;
  if (map.bat.words !== wantBat)
    problems.push(`BAT is ${map.bat.words} words, MWR says ${wantBat}`);
  if (map.sat.start !== m.opts.regs.SATB && map.sat.start !== 0x7F00)
    problems.push(`SAT at ${map.sat.start}, DVSSR/SATB is ` +
                  `${m.opts.regs.SATB}`);
  if (map.sat.words !== 256)
    problems.push(`SAT is ${map.sat.words} words, expected 256`);

  /* regions.json is the dump's own descriptor list: the map must carry the
   * same word ranges, no more and no fewer */
  if (regionsJson) {
    const want = regionsJson.map(([char0, count]) =>
      ({ start: char0 * 16, words: count * 16 }));
    const got = map.copyRegions.map((r) => ({ start: r.start, words: r.words }));
    if (got.length !== want.length) {
      problems.push(`${map.copyRegions.length} copy regions, regions.json ` +
                    `has ${regionsJson.length}`);
    } else {
      for (let i = 0; i < want.length; i++) {
        if (got[i].start !== want[i].start ||
            got[i].words !== want[i].words) {
          problems.push(`copy region ${i}: map [${got[i].start},+` +
                        `${got[i].words}], regions.json ` +
                        `[${want[i].start},+${want[i].words}]`);
        }
      }
    }
    /* and the map must say what each region is */
    for (let i = 0; i < map.copyRegions.length; i++) {
      if (!map.copyRegions[i].kind)
        problems.push(`copy region ${i} has no kind`);
    }
  } else if (map.copyRegions.length) {
    problems.push(`${map.copyRegions.length} copy regions but the dump has ` +
                  `no regions.json`);
  }

  /* every non-empty SAT sprite's pattern cells are claimed by the map */
  const cellMap = panels.patternCells(panels.state(m.opts));
  const cells = Object.keys(cellMap).map(Number).sort((a, b) => a - b);
  for (const cell of cells) {
    const at = map.segments.find((s) =>
      cell * 64 >= s.start && cell * 64 + 64 <= s.start + s.words);
    if (!at || (at.kind !== "sprite patterns" &&
                at.kind.indexOf("sprite patterns") < 0))
      problems.push(`SAT pattern cell ${cell} (words ` +
                    `${cell * 64}..${cell * 64 + 63}) is not in a ` +
                    `sprite-pattern segment (found ${at ? at.kind : "nothing"})`);
  }

  okv(`${name}: VRAM map partition, BAT/SAT, regions.json and SAT cells ` +
      `(${occupied} words used, ${free} free)`, problems);
  return { map, problems };
}

/* ---- 3. the per-line register panel vs raster.json -------------------- */

function checkRegisterLines(m, name) {
  if (!m.opts.raster) {
    const lines = panels.registerLines(panels.state(m.opts));
    const problems = [];
    if (lines.length !== m.height)
      problems.push(`${lines.length} rows for a ${m.height}-line frame`);
    const r0 = lines[0], regs = m.opts.regs;
    if (r0.BXR !== (regs.BXR & 0x3FF))
      problems.push(`row 0 BXR ${r0.BXR}, saved ${regs.BXR}`);
    if (r0.BYR !== (regs.BYR & 0x1FF))
      problems.push(`row 0 BYR ${r0.BYR}, saved ${regs.BYR}`);
    if (r0.CR !== (regs.CR & 0xFF))
      problems.push(`row 0 CR ${r0.CR}, saved ${regs.CR}`);
    okv(`${name}: register panel without a raster table`, problems);
    return;
  }
  const lines = panels.registerLines(panels.state(m.opts));
  const problems = [];
  if (lines.length !== m.height)
    problems.push(`${lines.length} rows, expected ${m.height}`);
  for (const row of m.rows) {
    const got = lines[row.row];
    if (!got) { problems.push(`no panel row ${row.row}`); continue; }
    if (got.line !== row.line)
      problems.push(`row ${row.row} line ${got.line}, expected ${row.line}`);
    if (got.BXR !== row.bxr)
      problems.push(`line ${row.line} BXR ${got.BXR}, raster says ${row.bxr}`);
    if (got.BYR !== row.byr)
      problems.push(`line ${row.line} BYR ${got.BYR}, raster says ${row.byr}`);
    if (got.CR !== row.cr)
      problems.push(`line ${row.line} CR ${got.CR}, raster says ${row.cr}`);
    if (got.BG_YOffset !== row.bgY)
      problems.push(`line ${row.line} BG_YOffset ${got.BG_YOffset}, ` +
                    `expected ${row.bgY}`);
    const wantEntryLine = row.entry ? row.entry.line : null;
    const gotEntryLine = got.entry ? got.entry.line : null;
    if (gotEntryLine !== wantEntryLine)
      problems.push(`line ${row.line} entry ${gotEntryLine}, expected ` +
                    `${wantEntryLine}`);
    if (got.entryAtLine !== row.entryAtLine)
      problems.push(`line ${row.line} entryAtLine ${got.entryAtLine}, ` +
                    `expected ${row.entryAtLine}`);
    if (got.entryRcr !== row.entryRcr)
      problems.push(`line ${row.line} entryRcr ${got.entryRcr}, expected ` +
                    `${row.entryRcr}`);
    if (got.rcr !== row.rcr)
      problems.push(`line ${row.line} chain arm ${got.rcr}, expected ${row.rcr}`);
  }
  /* every raster entry inside the rendered lines appears on its own line
   * with its values and rcr (a table may also carry the HBlank restore past
   * the last display line, e.g. raster5's line 240) */
  for (const e of m.entries) {
    const row = m.rows.find((r) => r.line === e.line);
    if (!row) {
      if (e.line < m.rows[0].line ||
          e.line > m.rows[m.rows.length - 1].line)
        continue;   /* outside the captured frame's lines */
      problems.push(`entry line ${e.line} is inside the frame but has no row`);
      continue;
    }
    const got = lines[row.row];
    if (!got.entryAtLine)
      problems.push(`entry line ${e.line} is not marked on its row`);
    if (got.entryRcr !== e.rcr)
      problems.push(`entry line ${e.line} rcr ${got.entryRcr}, table says ` +
                    `${e.rcr}`);
    if (e.bxr != null && got.wrote.bxr !== true)
      problems.push(`entry line ${e.line} BXR write not marked`);
    if (e.byr != null && got.wrote.byr !== true)
      problems.push(`entry line ${e.line} BYR write not marked`);
    if (e.cr != null && got.wrote.cr !== true)
      problems.push(`entry line ${e.line} CR write not marked`);
    if (e.cram && got.wrote.cram !== e.cram.length)
      problems.push(`entry line ${e.line} colour writes ${got.wrote.cram}, ` +
                    `table has ${e.cram.length}`);
  }
  /* the 20-register view is 20 rows and carries the per-line values */
  const regs = panels.vdcRegisters(panels.state(m.opts), 0);
  if (regs.length !== 20) problems.push(`${regs.length} registers, expected 20`);
  const byName = {};
  regs.forEach((r) => { byName[r.name] = r; });
  if (byName.CR.value !== lines[0].CR) problems.push("R05 CR not per-line");
  if (byName.BXR.value !== lines[0].BXR) problems.push("R07 BXR not per-line");
  if (byName.BYR.value !== lines[0].BYR) problems.push("R08 BYR not per-line");
  okv(`${name}: register panel vs raster.json (${m.entries.length} entries)`,
      problems);
}

/* ---- 4. the VCE panel -------------------------------------------------- */

function checkVce(m, name) {
  const st = panels.state(m.opts);
  const problems = [];
  const rows = m.opts.raster ? [0, 50, 100, 199, 231] : [0];
  for (const r of rows) {
    const want = m.rows[r];
    const got = panels.vcePalettes(st, r);
    if (got.palettes.length !== 32)
      problems.push(`${got.palettes.length} palettes, expected 32`);
    for (let p = 0; p < 32; p++) {
      if (got.palettes[p].length !== 16) {
        problems.push(`palette ${p} has ${got.palettes[p].length} entries`);
        break;
      }
      for (let e = 0; e < 16; e++) {
        const g = got.palettes[p][e];
        const w = want.words[p * 16 + e] & 0x1FF;
        if (g.word !== w) {
          problems.push(`row ${r} palette ${p} entry ${e}: word ` +
                        `${g.word}, expected ${w}`);
          p = 99;
          break;
        }
      }
    }
    if (problems.length) break;
  }
  okv(`${name}: VCE panel 32x16 against ${m.opts.raster ? "the per-line " +
      "colour tables" : "the saved CRAM"}`, problems);
}

/* ---- 5. the SAT panel -------------------------------------------------- */

function checkSat(m, name) {
  const st = panels.state(m.opts);
  const table = panels.satTable(st);
  const problems = [];
  if (table.length !== 64) problems.push(`${table.length} rows, expected 64`);
  let used = 0;
  for (let i = 0; i < 64; i++) {
    const want = [wordAt(m.sat, i * 4), wordAt(m.sat, i * 4 + 1),
                  wordAt(m.sat, i * 4 + 2), wordAt(m.sat, i * 4 + 3)];
    const got = table[i];
    for (let k = 0; k < 4; k++) {
      if (got.words[k] !== want[k])
        problems.push(`entry ${i} word ${k} ${got.words[k]}, sat.bin ` +
                      `${want[k]}`);
    }
    if (!got.empty) used++;
    const cgy = (want[3] >> 12) & 3;
    const cgx = (want[3] >> 8) & 1;
    if (got.height !== CGY_HEIGHT[cgy])
      problems.push(`entry ${i} CGY ${cgy} height ${got.height}`);
    if (got.width !== (cgx ? 32 : 16))
      problems.push(`entry ${i} CGX ${cgx} width ${got.width}`);
    const wantCells = CGY_BLOCKS[cgy] * (cgx ? 2 : 1);
    if (got.empty) {
      if (got.cells.length)
        problems.push(`entry ${i} is empty but names cells`);
    } else if (got.cells.length !== wantCells) {
      problems.push(`entry ${i} ${got.cells.length} cells, expected ` +
                    `${wantCells}`);
    }
    if (got.palette !== (want[3] & 0xF) || got.spbg !== ((want[3] >> 7) & 1) ||
        got.hflip !== ((want[3] >> 11) & 1) ||
        got.vflip !== ((want[3] >> 15) & 1))
      problems.push(`entry ${i} palette/flags do not match its words`);
    if (((want[2] >> 1) & 0x3FF) !== got.pattern)
      problems.push(`entry ${i} pattern ${got.pattern}`);
  }
  okv(`${name}: SAT panel 64 rows (${used} in use)`, problems);
  return used;
}

/* ---- a dump, end to end ----------------------------------------------- */

function checkDump(name, expectLayers) {
  const d = loadDump(name);
  const m = independentModel(d.opts);
  const f = checkFollow(m, name, d.png, 20);
  checkVramMap(m, name, d.regions);
  checkRegisterLines(m, name);
  checkVce(m, name);
  const used = checkSat(m, name);
  if (d.sat && expectLayers && expectLayers.sprite &&
      !f.layers.sprite) {
    fail(`${name}: no chosen pixel landed on a sprite (${JSON.stringify(
      f.layers)})`);
  }
  return { d, m, f, satUsed: used };
}

/* ---- the editor's own model (the page's state) ------------------------ */

function checkEditorModel() {
  const ed = require("../renderer/pce-editor.js");
  const problems = [];
  const pics = [
    { name: "editor demo", pic: ed.demoPicture(), frame: 0 },
    { name: "editor sprite demo", pic: ed.spriteDemoPicture(), frame: 0 }
  ];
  let checked = 0;
  for (const { name, pic, frame } of pics) {
    const data = ed.toPicture(pic);
    const opts = {
      vram: data.vram,
      cram: data.cram,
      sat: data.vram.slice(ed.SAT_ADDR * 2, ed.SAT_ADDR * 2 + 512),
      regs: ed.viewRegs(pic),
      width: ed.VIEW_W,
      height: ed.VIEW_H,
      regions: data.regions
    };
    const raster = ed.toRaster(pic, frame);
    if (raster) opts.raster = raster;
    const m = independentModel(opts);
    const f = checkFollow(m, name, null, 20);
    const map = panels.vramMap(panels.state(opts));
    /* toPicture's regions are the editor's own copy descriptors */
    if (map.copyRegions.length !== data.regions.length) {
      problems.push(`${name}: ${map.copyRegions.length} copy regions, ` +
                    `toPicture has ${data.regions.length}`);
    } else {
      for (let i = 0; i < data.regions.length; i++) {
        const want = { start: data.regions[i][0] * 16,
                       words: data.regions[i][1] * 16 };
        const got = map.copyRegions[i];
        if (got.start !== want.start || got.words !== want.words)
          problems.push(`${name}: region ${i} [${got.start},+${got.words}], ` +
                        `toPicture [${want.start},+${want.words}]`);
      }
    }
    /* the map is a partition, and the SAT panel is 64 rows */
    let cursor = 0;
    for (const s of map.segments) {
      if (s.start !== cursor)
        problems.push(`${name}: map gap/overlap at ${cursor}`);
      cursor = s.start + s.words;
    }
    if (cursor !== 32768) problems.push(`${name}: map covers ${cursor}`);
    const sat = panels.satTable(panels.state(opts));
    if (sat.length !== 64) problems.push(`${name}: ${sat.length} SAT rows`);
    if (pic.sprites && sat.filter((r) => !r.empty).length !== pic.sprites.length)
      problems.push(`${name}: SAT has ${sat.filter((r) => !r.empty).length} ` +
                    `used rows, the picture has ${pic.sprites.length} sprites`);
    const regs = panels.vdcRegisters(panels.state(opts), 0);
    if (regs.length !== 20) problems.push(`${name}: ${regs.length} registers`);
    const vce = panels.vcePalettes(panels.state(opts), 0);
    if (vce.palettes.length !== 32 || vce.palettes[0].length !== 16)
      problems.push(`${name}: VCE panel is not 32x16`);
    checked += f.pixels;
    if (!f.layers.sprite && pic.sprites && pic.sprites.length)
      problems.push(`${name}: no chosen pixel landed on a sprite`);
  }
  okv(`editor model: demo and sprite pictures through the same panels ` +
      `(${checked} pixels)`, problems);
}

/* ---- the browser-global branch ---------------------------------------- */

function loadBrowserGlobal() {
  const sandbox = { self: null };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", "renderer", f),
                                      "utf8");
  vm.runInContext(read("pce-bg.js"), sandbox, { filename: "pce-bg.js" });
  vm.runInContext(read("pce-sprites.js"), sandbox,
                  { filename: "pce-sprites.js" });
  vm.runInContext(read("pce-panels.js"), sandbox,
                  { filename: "pce-panels.js" });
  return sandbox.PCEStudio.panels;
}

function checkBrowserGlobal(globalPanels) {
  const d = loadDump("sprite1");
  const m = independentModel(d.opts);
  const a = panels.state(d.opts), b = globalPanels.state(d.opts);
  const problems = [];
  for (const [x, y] of [[0, 0], [100, 100], [128, 150], [255, 231], [60, 90]]) {
    const want = independentFollow(m, x, y);
    const got = globalPanels.followPixel(b, x, y);
    if (got.layer !== want.layer || got.index !== want.index)
      problems.push(`px(${x},${y}) browser ${got.layer}/` +
                    `${got.index.toString(16)}, expected ${want.layer}/` +
                    `${want.index.toString(16)}`);
  }
  const ma = panels.vramMap(a), mb = globalPanels.vramMap(b);
  if (JSON.stringify(ma.copyRegions) !== JSON.stringify(mb.copyRegions))
    problems.push("browser map copyRegions differ from the Node branch");
  if (globalPanels.vdcRegisters(b, 0).length !== 20)
    problems.push("browser register panel is not 20 rows");
  if (globalPanels.satTable(b).length !== 64)
    problems.push("browser SAT panel is not 64 rows");
  okv("browser-global branch: same follow, map, registers and SAT", problems);
}

/* ---- main -------------------------------------------------------------- */

function main() {
  /* a background scene, a sprite scene, three raster scenes, the painted
   * picture, a 64-wide BAT and the >=$800 character case */
  const dumps = [
    { name: "scene1" },
    { name: "sprite1", layers: { sprite: true } },
    { name: "raster1" },
    { name: "raster4" },
    { name: "raster5", layers: { sprite: true } },
    { name: "painted" },
    { name: "scene4" },
    { name: "scene9" }
  ];
  let pixelTotal = 0, satTotal = 0;
  for (const spec of dumps) {
    const r = checkDump(spec.name, spec.layers);
    pixelTotal += r.f.pixels;
    satTotal += r.satUsed;
    console.log(`${spec.name}: follow-a-pixel ${r.f.pixels} pixels ` +
                `(${r.f.layers.sprite} sprite, ` +
                `${r.f.layers.background} background, ` +
                `${r.f.layers.blanking} blanking), SAT ${r.satUsed} used`);
  }
  checkEditorModel();
  checkBrowserGlobal(loadBrowserGlobal());

  if (failures) {
    console.log(`FAIL: ${failures} problem(s) in ${checks} checks`);
    return 1;
  }
  console.log(`PASS: the panels are drawn from the renderer's model — ` +
              `${checks} checks, ${pixelTotal} follow-a-pixel traces across ` +
              `${dumps.length} dumps, ${satTotal} SAT entries in use`);
  return 0;
}

process.exitCode = main();
