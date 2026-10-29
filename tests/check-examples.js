#!/usr/bin/env node
/*
 * tests/check-examples.js — the #29 evidence: the five example toys under
 * toys/ are run for 120 frames through BOTH runtimes — the Lua one
 * (renderer/pce-toys.js over Fengari) and the IL one (renderer/pce-il.js) —
 * and every frame must agree exactly:
 *
 *   - vram, cram, sat and the four register values byte-equal;
 *   - the raster table identical (deep, including base/baseCram/cramPrev);
 *   - pixels diff 0 through the one model both draw with
 *     (renderer/pce-sprites.js over pce-bg.js), and the same frame size.
 *
 * Every frame must also stay inside the budgets the two cards enforce:
 *
 *   #30 — the Lua runtime's frame budget (100 ms; it throws toy-timeout past
 *         it) and the IL's instruction budget (5,000,000 per hook, the
 *         default; the IL throws past it).  The wall time of every Lua frame
 *         is measured here as well and the worst must stay under the budget.
 *   #50 — the VDC's sprite budget, per line: at most 16 strips asked for on
 *         any line and no overflow (OR) or sprite-0 collision (CC).  These
 *         toys draw no sprites, so the numbers are 0 — the check is here so
 *         a toy that later grows sprites cannot close the card past budget.
 *
 * Finally each toy must actually show its effect at frame 60:
 *
 *   - the frame's PNG is written to tests/dumps/examples/<name>.png and read
 *     back, pixel for pixel, so the committed image is the frame;
 *   - a measurement in the pixels (not in the toy's own words) checks the
 *     effect: the four parallax bars stand at the four BXR offsets, the sky
 *     is a gradient with the sun in it, the road is wider below the horizon
 *     than at it and its left edge is bent, the status bar's 24 rows are the
 *     same in frames 0 and 60 while the playfield's are not, and the water/
 *     fire palettes are rotated between frames 0 and 1.
 *
 * Written by @design because the card names this file.  Per workshop rule 2 a
 * cold break by another seat (and a cold review of the pictures) is owed
 * before this closes the card.
 *
 * #82 (REVIEW-31A E19): checkILIdentity() asserts the IL side is the IL - a
 * pce-il program, a construct the IL refuses and the Lua runtime accepts, and
 * the IL's own instruction budget - because a comparison of two runtimes
 * cannot tell a real agreement from one runtime compared with itself.
 *
 *   node tests/check-examples.js          # run everything, rewrite the PNGs
 */
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const toys = require("../renderer/pce-toys.js");
const il = require("../renderer/pce-il.js");
const sprites = require("../renderer/pce-sprites.js");

const HERE = __dirname;
const TOY_DIR = path.join(HERE, "..", "toys");
const OUT_DIR = path.join(HERE, "dumps", "examples");
const FRAMES = 120;
const PNG_FRAME = 60;
const LUA_BUDGET_MS = 100;          /* renderer/pce-toys.js DEFAULT_BUDGET_MS */

let checks = 0;
let failures = [];

function check(ok, name) {
  checks++;
  if (!ok) { failures.push(name); console.log("FAIL  " + name); }
}
function eq(name, got, want) {
  check(JSON.stringify(got) === JSON.stringify(want),
        name + " (got " + JSON.stringify(got) + ", want " +
        JSON.stringify(want) + ")");
}
function diffCount(a, b) {
  let n = 0, first = -1;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) if (a[i] !== b[i]) { if (first < 0) first = i; n++; }
  return { n, first, length: a.length !== b.length ? [a.length, b.length] : null };
}
function sameBytes(name, got, want) {
  if (got.length !== want.length) {
    check(false, name + " length " + got.length + " != " + want.length);
    return;
  }
  const d = diffCount(got, want);
  check(d.n === 0, name + " diff " + d.n + (d.n ? " (first byte " + d.first + ")" : ""));
}
function samePixels(name, got, want) {
  if (got.length !== want.length) {
    check(false, name + " pixel bytes " + got.length + " != " + want.length);
    return;
  }
  const d = diffCount(got, want);
  check(d.n === 0, name + " diff " + d.n + (d.n ? " (first byte " + d.first + ")" : ""));
}

/* ---- the toys ---------------------------------------------------------- */

const TOYS = [
  { name: "parallax", file: "parallax.lua", form: true },
  { name: "sky-gradient", file: "sky-gradient.lua", form: true },
  { name: "road", file: "road.lua", form: true },
  { name: "status-bar", file: "status-bar.lua", form: true },
  { name: "palette-cycle", file: "palette-cycle.lua", form: false },
];

/* ---- pixels and palettes ----------------------------------------------- */

function rgbAt(img, x, y) {
  const i = (y * img.width + x) * 3;
  return [img.pixels[i], img.pixels[i + 1], img.pixels[i + 2]];
}

/* A CRAM word to RGB, the VCE's 3-bit channels scaled by 36 (pce-bg.js). */
function cramRgb(cram, addr) {
  const v = cram[addr * 2] | (cram[addr * 2 + 1] << 8);
  return [36 * ((v >> 3) & 7), 36 * ((v >> 6) & 7), 36 * (v & 7)];
}
function sameRgb(a, b) { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]; }

/* Every x on row y whose pixel is `rgb`. */
function columnsOf(img, y, rgb) {
  const out = [];
  for (let x = 0; x < img.width; x++) if (sameRgb(rgbAt(img, x, y), rgb)) out.push(x);
  return out;
}

/* ---- the PNG writer (the encodePng of tests/renderer-mutation.js) ------ */

const CRC_TABLE = (function () {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function encodePng(rgb, width, height) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;                       /* colour type: RGB */
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride)
      .copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from("\x89PNG\r\n\x1a\n", "latin1"),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* Read one of our own RGB PNGs back (the reader of tests/check.js). */
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
  if (bitDepth !== 8 || colourType !== 2)
    throw new Error(`expected an 8-bit RGB PNG, got ${bitDepth}bpp type ${colourType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 3;
  const out = new Uint8Array(width * height * 3);
  const prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[p++];
    const line = Buffer.from(raw.slice(p, p + stride));
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? line[i - 3] : 0;
      const b = prev[i];
      const c = i >= 3 ? prev[i - 3] : 0;
      if (f === 1) line[i] = (line[i] + a) & 0xFF;
      else if (f === 2) line[i] = (line[i] + b) & 0xFF;
      else if (f === 3) line[i] = (line[i] + ((a + b) >> 1)) & 0xFF;
      else if (f === 4) {
        const pa = Math.abs(a + b - c - a), pb = Math.abs(a + b - c - b),
              pc = Math.abs(a + b - c - c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xFF;
      }
    }
    line.copy(prev);
    out.set(line, y * stride);
  }
  return { width: width, height: height, pixels: out };
}

/* ---- #82/E19: the IL side is the IL, not the Lua runtime -------------- */

/* This suite compares two runtimes.  If il.create delegated to
 * renderer/pce-toys.js's create (REVIEW-31A E19), both sides would be the
 * same run and all 4,288 comparisons would agree trivially.  These are the
 * identity assertions the comparison cannot make:
 *
 *   - il.create's runtime carries a compiled pce-il program (the Lua
 *     runtime has no .program at all);
 *   - a construct the IL refuses by its own code - pairs is a generic for,
 *     il-for-in - while the Lua runtime accepts it: a real, deliberate
 *     difference between the two sides;
 *   - the IL's own instruction budget counts its own instructions: a busy
 *     hook stops with a toy-timeout naming the instruction count, which only
 *     the IL interpreter's step loop produces (the Lua side names
 *     milliseconds). */
function checkILIdentity() {
  const program = il.compile("function frame(t, f) pal(1, 1) end");
  check(program && program.lang === "pce-il",
        "il.compile returns a pce-il program");
  check(program.functions.length >= 1 && program.hooks.frame != null,
        "the pce-il program has functions and a frame hook");

  let ilCode = "accepted";
  try {
    il.create("function frame(t, f) for k in pairs({}) do end end");
  } catch (e) {
    ilCode = e && e.code;
  }
  eq("the IL refuses generic iteration by its own code", ilCode, "il-for-in");

  const lua = toys.create(
    "function frame(t, f) local n = 0 for k in pairs({ a = 1 }) do n = n + 1 end end");
  let luaAccepted = true;
  try {
    lua.load();
    lua.frame(0);
  } catch (e) {
    luaAccepted = false;
  }
  lua.dispose();
  check(luaAccepted,
        "the Lua runtime accepts pairs, so the refusal above is the IL's own");

  let budget = null;
  try {
    const rt = il.create(
      "function frame(t, f) local i = 0 while true do i = i + 1 end end",
      { maxInstructions: 1000 });
    rt.load();
    rt.frame(0);
  } catch (e) {
    budget = { code: e && e.code, message: String(e && e.message) };
  }
  eq("the IL's own instruction budget stops a busy hook",
     budget && budget.code, "toy-timeout");
  check(/ran longer than 1000 instructions/.test(budget && budget.message || ""),
        "the IL interpreter counted its own instructions (>1000): " +
        (budget && budget.message || "it did not stop"));
}

/* ---- the run ----------------------------------------------------------- */

function runToy(spec) {
  const source = fs.readFileSync(path.join(TOY_DIR, spec.file), "utf8");
  const luaRT = toys.create(source);                  /* the #30 budget */
  const ilRT = il.create(source);                     /* the IL's budget */
  luaRT.load();
  ilRT.load();
  check(luaRT.initialized === true, spec.name + ": the Lua runtime loaded");
  check(ilRT.initialized === true, spec.name + ": the IL runtime loaded");
  check(!!ilRT.program && ilRT.program.lang === "pce-il",
        spec.name + ": the IL runtime carries a pce-il program, not the Lua one");
  eq(spec.name + ": both runtimes agree on the raster form",
     ilRT.callbackRaster, luaRT.callbackRaster);
  eq(spec.name + ": it uses the form the toy is meant to teach",
     luaRT.callbackRaster, spec.form);

  const keep = {};                                     /* frame 0, 1, 60 */
  let worstMs = 0;
  let worstFrame = -1;
  let maxStrips = 0;
  let overflowLines = 0;
  let collision = false;

  for (let f = 0; f < FRAMES; f++) {
    const t0 = Date.now();
    const want = luaRT.frame(f);
    const ms = Date.now() - t0;
    if (ms > worstMs) { worstMs = ms; worstFrame = f; }
    const got = ilRT.frame(f);

    sameBytes(spec.name + " f" + f + " vram", got.state.vram, want.state.vram);
    sameBytes(spec.name + " f" + f + " cram", got.state.cram, want.state.cram);
    sameBytes(spec.name + " f" + f + " sat", got.state.sat, want.state.sat);
    eq(spec.name + " f" + f + " regs", got.state.regs, want.state.regs);
    eq(spec.name + " f" + f + " raster", got.raster, want.raster);
    samePixels(spec.name + " f" + f + " pixels", got.pixels, want.pixels);
    eq(spec.name + " f" + f + " size", [got.width, got.height],
       [want.width, want.height]);

    /* #50's sprite budget, from the model's own SAT search on this frame */
    const st = sprites.status(Object.assign({}, luaRT.options(), {
      raster: want.raster || undefined
    }));
    for (const line of st.lines) {
      if (line.strips > maxStrips) maxStrips = line.strips;
      if (line.OR) overflowLines++;
      if (line.CC) collision = true;
    }

    if (f === 0 || f === 1 || f === PNG_FRAME) keep[f] = want;
  }

  check(worstMs < LUA_BUDGET_MS,
        spec.name + ": the worst Lua frame (" + worstMs + " ms at frame " +
        worstFrame + ") is inside the #30 budget of " + LUA_BUDGET_MS + " ms");
  check(maxStrips <= 16, spec.name + ": no line asks for more than 16 sprite " +
        "strips (#50), most seen: " + maxStrips);
  check(overflowLines === 0, spec.name + ": no sprite overflow (OR) on any line");
  check(!collision, spec.name + ": no sprite-0 collision (CC) on any line");

  luaRT.dispose();
  ilRT.dispose();

  const stats = { name: spec.name, worstMs: worstMs, maxStrips: maxStrips,
                  frame0: keep[0], frame1: keep[1], frame60: keep[PNG_FRAME] };
  spec.effect(stats);
  writePng(spec, keep[PNG_FRAME]);
  return stats;
}

function writePng(spec, frame) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, spec.name + ".png");
  fs.writeFileSync(file, encodePng(frame.pixels, frame.width, frame.height));
  const back = decodePng(fs.readFileSync(file));
  eq(spec.name + ": the PNG's size is the frame's",
     [back.width, back.height], [frame.width, frame.height]);
  samePixels(spec.name + ": the PNG holds frame " + PNG_FRAME + " pixel for pixel",
             back.pixels, frame.pixels);
}

/* ---- what each picture must show --------------------------------------- */

/* parallax: one bright bar per band, each standing at its band's BXR.  The
 * bar is colour 3 of the band's palette, at map x 43..44 (BAT cell 5, tile
 * column 3); the screen x is (43 - BXR) mod 256. */
function effectParallax(s) {
  const img = s.frame60, cram = s.frame60.state.cram;
  const raster = s.frame60.raster;
  check(!!raster && raster.entries.length === 4,
        "parallax: four raster entries, one per band (got " +
        (raster ? raster.entries.length : 0) + ")");
  const byLine = {};
  if (raster) for (const e of raster.entries) byLine[e.line] = e;
  const xs = [];
  for (let band = 0; band < 4; band++) {
    const line = band * 56;
    const entry = byLine[line];
    check(!!entry && entry.bxr != null && entry.byr == null,
          "parallax: band " + band + " has a BXR entry at line " + line +
          " and no BYR");
    const bxr = entry ? entry.bxr : 0;
    const marker = cramRgb(cram, band * 16 + 3);
    const found = columnsOf(img, band * 56 + 28, marker);
    check(found.length > 0, "parallax: band " + band + "'s marker is on screen");
    const x = found.length ? found[0] : -1;
    xs.push(x);
    eq("parallax: band " + band + "'s marker stands at (43 - BXR) mod 256",
       x, (43 - bxr + 4096) % 256);
  }
  const unique = new Set(xs);
  eq("parallax: the four bands' markers are at four different x (the parallax)",
     unique.size, 4);
  check(Math.abs(xs[0] - xs[3]) > 32,
        "parallax: the nearest band is far from the farthest (|" + xs[0] +
        " - " + xs[3] + "| > 32)");
}

/* sky: a vertical gradient (many distinct colours down one column) and the
 * sun's disc in its 16-line band, in the sun colour the frame's palette
 * holds (rgb(7, 5+(60//30)%3, 1) at frame 60). */
function effectSky(s) {
  const img = s.frame60, cram = s.frame60.state.cram;
  const column = [];
  for (let y = 0; y < 224; y++) column.push(rgbAt(img, 20, y).join(","));
  let changes = 0;
  for (let y = 1; y < 224; y++) if (column[y] !== column[y - 1]) changes++;
  check(changes >= 6, "sky: the column changes colour at least 6 times down " +
        "the screen (a gradient), got " + changes);
  check(column[5] !== column[210], "sky: the zenith and the horizon differ (" +
        column[5] + " vs " + column[210] + ")");
  const sun = cramRgb(cram, 2);
  eq("sky: the sun's colour is rgb(7,7,1) at frame 60", sun, [252, 252, 36]);
  eq("sky: the disc's centre shows the sun colour", rgbAt(img, 112, 72), sun);
  check(!sameRgb(rgbAt(img, 104, 64), sun),
        "sky: the disc's corner is sky, not sun (the tiles are round)");
}

/* road: the road is wider far below the horizon than at it (the BYR row
 * mapping), and its left edge leans left as it comes forward (the BXR bend).
 * The edge lines are palette 0 colour 5, a fixed colour. */
function effectRoad(s) {
  const img = s.frame60, cram = s.frame60.state.cram;
  const edge = cramRgb(cram, 5);
  function span(y) {
    const cols = columnsOf(img, y, edge);
    if (cols.length === 0) return null;
    return { left: cols[0], right: cols[cols.length - 1],
             width: cols[cols.length - 1] - cols[0] + 1 };
  }
  const far = span(100), near = span(200);
  check(!!far && !!near, "road: both edge lines are drawn at lines 100 and 200");
  if (far && near) {
    check(near.width > far.width + 32,
          "road: the road is far wider near the viewer (" + near.width +
          " px at line 200) than near the horizon (" + far.width + " px at line 100)");
    check(near.left < far.left - 16,
          "road: the left edge leans left toward the viewer (" + far.left +
          " -> " + near.left + "), i.e. the BXR bend");
  }
  const raster = s.frame60.raster;
  check(!!raster && raster.entries.length >= 200,
        "road: the table carries a per-line write on almost every line (got " +
        (raster ? raster.entries.length : 0) + ")");
  const at = {};
  if (raster) for (const e of raster.entries) at[e.line] = e;
  const bounds = [0, 87, 88, 120, 223].filter(function (l) { return at[l]; });
  eq("road: BXR, BYR and a palette write reach the lines the toy writes",
     bounds, [0, 87, 88, 120, 223]);
  check(at[223] && at[88] && at[223].bxr > at[88].bxr,
        "road: the bend grows with the distance below the horizon");
  check(at[223] && at[223].cram && at[223].cram.length >= 1,
        "road: the asphalt is recoloured on the line (the distance shade)");
}

/* status bar: display lines 0..23 are identical in frames 0 and 60 while the
 * playfield below them is not — the RCR split, measured in pixels. */
function effectStatusBar(s) {
  const a = s.frame0, b = s.frame60;
  check(a.raster && a.raster.entries.length === 2 &&
        a.raster.entries[0].line === 0 && a.raster.entries[1].line === 24,
        "status-bar: exactly two raster entries, at lines 0 and 24");
  let barDiff = 0, fieldDiff = 0;
  for (let y = 0; y < 224; y++) {
    for (let x = 0; x < 256; x++) {
      const i = (y * 256 + x) * 3;
      let same = true;
      for (let k = 0; k < 3; k++) if (a.pixels[i + k] !== b.pixels[i + k]) same = false;
      if (same) continue;
      if (y < 24) barDiff++; else fieldDiff++;
    }
  }
  eq("status-bar: the bar's 24 rows are the same in frames 0 and 60 (fixed)",
     barDiff, 0);
  check(fieldDiff > 1000, "status-bar: the playfield below them moves (" +
        fieldDiff + " pixels differ > 1000)");
  const colours = new Set();
  for (let y = 0; y < 24; y++) for (let x = 0; x < 256; x++)
    colours.add(rgbAt(a, x, y).join(","));
  check(colours.size >= 3, "status-bar: the bar is drawn, not blank (" +
        colours.size + " colours)");
}

/* palette cycle: the water's and the fire's palette runs are rotated between
 * frames 0 and 1, and the picture with them. */
function effectPaletteCycle(s) {
  const a = s.frame0, b = s.frame1;
  let waterMoved = 0, fireMoved = 0;
  for (let k = 1; k <= 6; k++) {
    if (a.state.cram[k * 2] !== b.state.cram[k * 2] ||
        a.state.cram[k * 2 + 1] !== b.state.cram[k * 2 + 1]) waterMoved++;
    const addr = 16 + k;
    if (a.state.cram[addr * 2] !== b.state.cram[addr * 2] ||
        a.state.cram[addr * 2 + 1] !== b.state.cram[addr * 2 + 1]) fireMoved++;
  }
  eq("palette-cycle: all six water colours change between frames 0 and 1",
     waterMoved, 6);
  eq("palette-cycle: all six fire colours change between frames 0 and 1",
     fireMoved, 6);
  check(diffCount(a.pixels, b.pixels).n > 1000,
        "palette-cycle: the picture changes with the palette (" +
        diffCount(a.pixels, b.pixels).n + " pixels)");
  const water = new Set(), fire = new Set();
  for (let y = 5; y < 108; y += 7) water.add(rgbAt(s.frame60, 128, y).join(","));
  for (let y = 120; y < 220; y += 7) fire.add(rgbAt(s.frame60, 128, y).join(","));
  check(water.size >= 3, "palette-cycle: the water shows several shades (" +
        water.size + ")");
  check(fire.size >= 3, "palette-cycle: the fire shows several shades (" +
        fire.size + ")");
  eq("palette-cycle: no raster table (the whole picture is the palette)",
     s.frame60.raster, null);
}

TOYS[0].effect = effectParallax;
TOYS[1].effect = effectSky;
TOYS[2].effect = effectRoad;
TOYS[3].effect = effectStatusBar;
TOYS[4].effect = effectPaletteCycle;

/* ---- main -------------------------------------------------------------- */

const names = fs.readdirSync(TOY_DIR).filter(function (f) {
  return f.endsWith(".lua");
}).sort();
eq("toys/ holds exactly the five example toys", names,
   TOYS.map(function (t) { return t.file; }).sort());

const rows = [];
checkILIdentity();
for (const spec of TOYS) rows.push(runToy(spec));

console.log("");
for (const r of rows) {
  console.log("  " + r.name.padEnd(14) + " 120 frames  worst Lua frame " +
              String(r.worstMs).padStart(3) + " ms  sprite strips/line " +
              r.maxStrips + "  dumps/examples/" + r.name + ".png");
}
console.log("");
if (failures.length) {
  console.log("FAILED " + failures.length + " of " + checks + " checks");
  process.exit(1);
}
console.log("PASS  " + checks + " checks: " + TOYS.length +
            " example toys x " + FRAMES + " frames Lua == IL (state, raster, " +
            "pixels), every frame inside the #30 and #50 budgets, and frame " +
            PNG_FRAME + " of each written to tests/dumps/examples/");
