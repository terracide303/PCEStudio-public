#!/usr/bin/env node
/*
 * tests/check-cave.js — the #127 evidence for toys/cave.
 *
 *   node tests/check-cave.js
 *
 * WHAT IT RUNS: the demo through BOTH runtimes — the Lua one
 * (renderer/pce-toys.js over Fengari) and the IL one (renderer/pce-il.js) —
 * for 120 frames, with the pack's converted picture appended exactly as the
 * website appends it (demo-art/cave/art.lua).  Every frame must agree
 * exactly: vram, cram, sat, the four register values, the raster table, and
 * the pixels.
 *
 * THE ART IS NOT IN THE REPO (docs/DECISIONS.md, 2026-10-29).  Without
 * demo-art/cave/art.lua — a fresh clone — this test prints one SKIP line and
 * exits 0, so the suite stays green.  Point PCE_CAVE_ART at the folder to
 * run it somewhere else.
 *
 * WHAT IT PROVES, in the pixels and the state rather than the toy's words:
 *
 *   - VISIBILITY: frame 60 is a picture, not the backdrop.
 *   - PARALLAX: the raster table has one entry per band, at lines 0, 16, 48,
 *     80 and 104, and their BXR values are the five speeds — each band's
 *     scroll is strictly faster than the one above it, and all five move
 *     between two frames.
 *   - THE GLOW: the pack's warm palette entry is COLD, then its own colour,
 *     then HOT, six frames at a time (three consecutive samples of the CRAM
 *     word, which is what the console's colour table holds).
 *   - THE CREATURES: the frames differ from the same state with an empty SAT
 *     (so something is drawn by sprites, not by the background), and the SAT
 *     entries move between frames.
 *   - BUDGETS: the #50 sprite budget per line (at most 16 strips, no OR, no
 *     CC) and the #30 Lua frame budget.
 *
 * The frame-60 picture is written to demo-art/cave/frames/, beside the art it
 * came from — never into the repo.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const toys = require(path.join(ROOT, "renderer", "pce-toys.js"));
const il = require(path.join(ROOT, "renderer", "pce-il.js"));
const sprites = require(path.join(ROOT, "renderer", "pce-sprites.js"));

const ART_DIR = process.env.PCE_CAVE_ART ||
  "/Volumes/External/agent-workshop-demo/demo-art/cave";
const ART = path.join(ART_DIR, "art.lua");
/* also the mutation probe's door: point PCE_CAVE_TOY at a broken copy and the
 * checks below must fail (see the header's "not proven") */
const TOY = process.env.PCE_CAVE_TOY ||
  path.join(ROOT, "toys", "cave", "main.lua");
const FRAMES = 120;
const PNG_FRAME = 60;
const LUA_BUDGET_MS = 100;          /* renderer/pce-toys.js DEFAULT_BUDGET_MS */

if (!fs.existsSync(ART)) {
  console.log("SKIP  cave: the pack's converted art is not on this machine (" +
              ART + ")");
  console.log("      the demo art is never committed (docs/DECISIONS.md, " +
              "2026-10-29); run tools/cave-assets.js to make it, or set " +
              "PCE_CAVE_ART");
  process.exit(0);
}

let checks = 0;
const failures = [];

function check(ok, name) {
  checks++;
  if (!ok) { failures.push(name); console.log("FAIL  " + name); }
}
function eq(name, got, want) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  check(a === b, name + " (got " + a + ", want " + b + ")");
}
function sameBytes(name, got, want) {
  let same = got.length === want.length;
  if (same) for (let i = 0; i < got.length; i++) if (got[i] !== want[i]) same = false;
  check(same, name + " (lengths " + got.length + "/" + want.length + ")");
}

/* ---- pixel helpers ------------------------------------------------------ */

function cramWord(cram, i) { return cram[i * 2] | (cram[i * 2 + 1] << 8); }
function cramRgb(cram, i) {
  const w = cramWord(cram, i);
  return [(w >> 3 & 7) * 36, (w >> 6 & 7) * 36, (w & 7) * 36];
}

/* The picture in a box, measured against ITS OWN most common colour rather
 * than the backdrop.  The cave's rock interior is the same near-black the
 * pack uses for the backdrop, so "not CRAM[0]" under-counts a cave that is
 * drawn perfectly: what must be true is that the box is not flat, and that
 * every band draws something.  `distinct` is the second half of that — a
 * frame of one colour has one. */
function pictureIn(img, box) {
  const counts = new Map();
  let n = 0;
  for (let y = box[1]; y < box[3] && y < img.height; y++) {
    for (let x = box[0]; x < box[2] && x < img.width; x++) {
      const i = (y * img.width + x) * 3;
      const key = (img.pixels[i] << 16) | (img.pixels[i + 1] << 8) |
                  img.pixels[i + 2];
      counts.set(key, (counts.get(key) || 0) + 1);
      n++;
    }
  }
  let modal = 0;
  for (const c of counts.values()) if (c > modal) modal = c;
  return { area: n, modal: modal, notModal: n - modal, distinct: counts.size };
}

/* The same frame with an empty SAT: what the sprites add, measured.  The
 * background cannot fake this — it is the same VRAM and CRAM both times. */
function spritePixels(frame, options) {
  const opts = Object.assign({}, options,
                             { raster: frame.raster || undefined });
  const withSprites = sprites.renderFrame(opts);
  const without = sprites.renderFrame(Object.assign({}, opts,
    { sat: new Uint8Array(opts.sat.length) }));
  let n = 0;
  for (let i = 0; i < withSprites.pixels.length; i++)
    if (withSprites.pixels[i] !== without.pixels[i]) n++;
  return n;
}

function satWord(sat, slot, k) {
  const o = (slot * 4 + k) * 2;
  return sat[o] | (sat[o + 1] << 8);
}

/* ---- PNG out (the frame is the evidence) -------------------------------- */

function crc32(buf) {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  let x = 0xFFFFFFFF;
  for (const b of buf) x = t[(x ^ b) & 0xFF] ^ (x >>> 8);
  return (x ^ 0xFFFFFFFF) >>> 0;
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
  ihdr[9] = 2;
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
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/* ---- the run ------------------------------------------------------------ */

const toySource = fs.readFileSync(TOY, "utf8");
const artSource = fs.readFileSync(ART, "utf8");
const source = toySource + "\n" + artSource;

console.log("== cave: the art on this machine is " + ART);
check(/Will Tice/.test(artSource),
      "the converted block carries the pack's credit (Will Tice)");

const luaRT = toys.create(source);
const ilRT = il.create(source);
luaRT.load();
ilRT.load();
check(luaRT.initialized === true, "the Lua runtime loaded");
check(ilRT.initialized === true, "the IL runtime loaded");
check(!!ilRT.program && ilRT.program.lang === "pce-il",
      "the IL runtime carries a pce-il program, not the Lua one");
eq("both runtimes agree on the raster form",
   ilRT.callbackRaster, luaRT.callbackRaster);
eq("the toy uses the callback raster form (one write per band boundary)",
   luaRT.callbackRaster, true);

const keep = {};
let worstMs = 0, worstFrame = -1, maxStrips = 0, overflowLines = 0;
let collision = false, spriteSeen = 0;

for (let f = 0; f < FRAMES; f++) {
  const t0 = Date.now();
  const want = luaRT.frame(f);
  const ms = Date.now() - t0;
  if (ms > worstMs) { worstMs = ms; worstFrame = f; }
  const got = ilRT.frame(f);

  sameBytes("f" + f + " vram", got.state.vram, want.state.vram);
  sameBytes("f" + f + " cram", got.state.cram, want.state.cram);
  sameBytes("f" + f + " sat", got.state.sat, want.state.sat);
  eq("f" + f + " regs", got.state.regs, want.state.regs);
  eq("f" + f + " raster", got.raster, want.raster);
  sameBytes("f" + f + " pixels", got.pixels, want.pixels);
  eq("f" + f + " size", [got.width, got.height], [want.width, want.height]);

  /* #50's sprite budget, from the model's own SAT search on this frame */
  const st = sprites.status(Object.assign({}, luaRT.options(),
    { raster: want.raster || undefined }));
  for (const line of st.lines) {
    if (line.strips > maxStrips) maxStrips = line.strips;
    if (line.OR) overflowLines++;
    if (line.CC) collision = true;
  }

  if (f === 0 || f === 1 || f === 6 || f === 12 || f === PNG_FRAME) keep[f] = want;
  if (f === PNG_FRAME) spriteSeen = spritePixels(want, luaRT.options());
}

check(worstMs < LUA_BUDGET_MS,
      "the worst Lua frame (" + worstMs + " ms at frame " + worstFrame +
      ") is inside the #30 budget of " + LUA_BUDGET_MS + " ms");
check(maxStrips <= 16, "no line asks for more than 16 sprite strips (#50), " +
      "most seen: " + maxStrips);
check(overflowLines === 0, "no sprite overflow (OR) on any line");
check(!collision, "no sprite-0 collision (CC) on any line");

/* ---- VISIBILITY ---------------------------------------------------------
 * Every band must draw something, and the frame must be more than one colour.
 * The thresholds are pinned to what the pack's picture measures (the message
 * prints the figure), and each is asserted above zero first, so a threshold
 * that a breaker set to 0 cannot pass silently (#90's M12).
 */
const BANDS = [
  { name: "ceiling", box: [0, 0, 256, 16],  min: 0.10 },
  { name: "bg3",     box: [0, 16, 256, 48], min: 0.10 },
  { name: "bg2",     box: [0, 48, 256, 80], min: 0.10 },
  { name: "bg1",     box: [0, 80, 256, 104], min: 0.10 },
  { name: "floor",   box: [0, 104, 256, 224], min: 0.10 }
];

const frame60 = keep[PNG_FRAME];
const whole = pictureIn(frame60, [0, 0, frame60.width, frame60.height]);
check(whole.distinct >= 8,
      "VISIBILITY: frame 60 holds " + whole.distinct + " colours (at least 8)");
check(whole.notModal > whole.area * 0.25,
      "VISIBILITY: frame 60 is a picture, not a flat colour (" + whole.notModal +
      " of " + whole.area + " pixels are not its most common colour, " +
      (100 * whole.notModal / whole.area).toFixed(1) + "%)");
for (const b of BANDS) {
  check(b.min > 0, "VISIBILITY: the " + b.name + " band's threshold is above 0");
  const p = pictureIn(frame60, b.box);
  check(p.notModal >= p.area * b.min,
        "VISIBILITY: the " + b.name + " band draws something (" + p.notModal +
        " of " + p.area + " pixels, " +
        (100 * p.notModal / p.area).toFixed(1) + "%, at least " +
        (100 * b.min) + "%)");
}

/* ---- PARALLAX ----------------------------------------------------------- */

const RASTER_LINES = [0, 16, 48, 80, 104];
const entries = (frame60.raster && frame60.raster.entries) || [];
eq("PARALLAX: one raster entry per band", entries.map((e) => e.line),
   RASTER_LINES);
check(entries.length === RASTER_LINES.length,
      "PARALLAX: the table has " + entries.length + " entries");
const bxr = entries.map((e) => e.bxr);
check(bxr.every((v, i) => i === 0 || v > bxr[i - 1]),
      "PARALLAX: every band scrolls faster than the one above it (" +
      bxr.join(" < ") + ")");
check(entries.every((e) => e.byr == null),
      "PARALLAX: no band scrolls vertically (BYR stays 0)");
const f1 = keep[1];
const bxr1 = (f1.raster.entries || []).map((e) => e.bxr);
check(bxr1.length === bxr.length && bxr1.every((v, i) => v !== bxr[i]),
      "PARALLAX: all five bands move between frames 1 and 60 (" +
      bxr1.join(",") + " -> " + bxr.join(",") + ")");

/* ---- THE GLOW ----------------------------------------------------------- */

/* The art block names where to cycle; the test does not trust it and reads
 * the CRAM words the toy actually wrote. */
const glowPal = Number((/^GLOW_PAL = (\d+)/m.exec(artSource) || [])[1]);
const glowEntry = Number((/^GLOW_ENTRY = (\d+)/m.exec(artSource) || [])[1]);
const cold = Number((/^GLOW_COLD = (0x[0-9A-F]+)/m.exec(artSource) || [])[1]);
const base = Number((/^GLOW_BASE = (0x[0-9A-F]+)/m.exec(artSource) || [])[1]);
const hot = Number((/^GLOW_HOT = (0x[0-9A-F]+)/m.exec(artSource) || [])[1]);
check(Number.isInteger(glowPal) && Number.isInteger(glowEntry),
      "GLOW: the art block names a palette entry to cycle");
const at = glowPal * 16 + glowEntry;
eq("GLOW: frame 0 holds the cold word", cramWord(keep[0].state.cram, at), cold);
eq("GLOW: frame 6 holds the pack's own word", cramWord(keep[6].state.cram, at),
   base);
eq("GLOW: frame 12 holds the hot word", cramWord(keep[12].state.cram, at), hot);
check(cold !== hot && base !== cold && base !== hot,
      "GLOW: the three words are three different colours");

/* ---- THE CREATURES ------------------------------------------------------ */

check(spriteSeen > 100,
      "CREATURES: the sprites draw " + spriteSeen + " pixels frame 60 shows " +
      "and the same state with an empty SAT does not");
const s0f60 = [0, 1].map((k) => satWord(frame60.state.sat, 0, k));
const s0f1 = [0, 1].map((k) => satWord(f1.state.sat, 0, k));
check(s0f60[0] !== s0f1[0] || s0f60[1] !== s0f1[1],
      "CREATURES: SAT entry 0 moves between frames 1 and 60 (" + s0f1.join(",") +
      " -> " + s0f60.join(",") + ")");
check(satWord(frame60.state.sat, 0, 3) & 0x80,
      "CREATURES: SAT entry 0 carries SPBG, so it draws over the opaque cave " +
      "instead of only over colour 0");
check(satWord(frame60.state.sat, 0, 2) >> 1 >= 0 &&
      satWord(frame60.state.sat, 0, 2) >> 1 <= 1023,
      "CREATURES: SAT entry 0's pattern code is inside the VDC's 10 bits");

/* ---- the picture -------------------------------------------------------- */

const outDir = path.join(ART_DIR, "frames");
fs.mkdirSync(outDir, { recursive: true });
for (const f of [0, 1, 60]) {
  fs.writeFileSync(path.join(outDir, "frame" + String(f).padStart(3, "0") +
                               ".png"),
                   encodePng(keep[f].pixels, keep[f].width, keep[f].height));
}
console.log("      frames 0, 1, 60 written to " + outDir);

luaRT.dispose();
ilRT.dispose();

console.log((failures.length ? "FAIL" : "PASS") + "  " + checks +
            " checks, " + failures.length + " failure(s)" +
            (failures.length ? ":\n  " + failures.join("\n  ") : ""));
process.exit(failures.length ? 1 : 0);
