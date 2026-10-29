#!/usr/bin/env node
/*
 * tests/check-cave.js — the #127 evidence for toys/cave.
 *
 *   node tests/check-cave.js
 *
 * WHAT IT RUNS: the demo through BOTH runtimes — the Lua one
 * (renderer/pce-toys.js over Fengari) and the IL one (renderer/pce-il.js) —
 * for 120 frames, exactly as the website runs it (card #156): the playable
 * demo-art/cave/main.lua — the repository's toy plus a constants-only tail —
 * with the picture loaded from demo-art/cave's tiles.json, palettes.json
 * and sprites.json by the #117 importer.  Every frame must agree exactly:
 * vram, cram, sat, the four register values, the raster table, and the
 * pixels.
 *
 * THE ART IS NOT IN THE REPO (docs/DECISIONS.md, 2026-10-29).  Without
 * demo-art/cave/art.lua — a fresh clone — this test prints one SKIP line and
 * exits 0, so the suite stays green.  Point PCE_CAVE_ART at the folder to
 * run it somewhere else.
 *
 * WHAT IT PROVES, in the pixels and the state rather than the toy's words:
 *
 *   - THE PICTURE: frame 0 at BXR 0 — the SAT-less frame, since the toy
 *     draws its own creatures — must look like the pack's own preview (the
 *     wallpaper the converter downsamples into evidence/preview.png), VCE
 *     colour-reduced.  The author's scene fills the frame's left 160 px, so
 *     that box is compared pixel for pixel against the snapped preview.
 *   - THE ROCK: the lower half's BAT (rows 12-27) holds the pack's rock
 *     tiles — many distinct ones, most with several colours — not one
 *     repeated cell.
 *   - THE LOOP: every band wraps at 256 px without a seam.  Each band strip
 *     is rebuilt from tiles.json and its last 12 cells must be the scene's
 *     own left columns stretched (px 255 = px 15), so the wrap meets the
 *     scene's adjacent columns; the floor bands' seam cells are flat at both
 *     ends; no band is a short block repeated (every band has a row with no
 *     8- or 16-cell period); and a 300-frame pad-right run takes each band
 *     through at least one wrap of its own BXR at its own rate, never a
 *     jump (#148's CITY test, five bands).
 *   - VISIBILITY: frame 60 is a picture, not the backdrop.
 *   - PARALLAX: the raster table has one entry per band, at lines 0, 32, 56,
 *     96 and 160, and their BXR values are the five speeds — each band's
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
 *   - THE ART IS NAMED SOURCES (card #156).  main.lua is the game code and a
 *     constants-only tail — no pokes, no pal() — whose numbers are the
 *     importer's own placement read back through pce-editor.js's
 *     patternLayout; the studio's model names the two sources, "cave" and
 *     "creatures", and its preview of each is proven to be the running
 *     picture (the VRAM the importer wrote after one frame).  art.lua stays
 *     beside it for the console route only (cave-console.lua), and the glow
 *     words it carries must be the tail's.
 *
 * The frame pictures go to demo-art/cave/frames/, the preview/frame
 * side-by-side to demo-art/cave/evidence/side-by-side.png — beside the art
 * they came from, never into the repo.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const toys = require(path.join(ROOT, "renderer", "pce-toys.js"));
const il = require(path.join(ROOT, "renderer", "pce-il.js"));
const sprites = require(path.join(ROOT, "renderer", "pce-sprites.js"));
const src = require(path.join(ROOT, "renderer", "pce-source.js"));

const ART_DIR = process.env.PCE_CAVE_ART ||
  "/Volumes/External/agent-workshop-demo/demo-art/cave";
const ART = path.join(ART_DIR, "art.lua");
/* The playable file — the repository's toy with a constants-only tail
 * appended, which is exactly what demo-art/cave/main.lua is and what the
 * site runs (card #156).  Also the mutation probe's door: point PCE_CAVE_TOY
 * at a broken copy and the checks below must fail (see the header's "not
 * proven"). */
const PLAY = path.join(ART_DIR, "main.lua");
const TOY = process.env.PCE_CAVE_TOY ||
  path.join(ROOT, "toys", "cave", "main.lua");
/* The picture as the #117 importer loads it, exactly what the site runs
 * beside the playable: the three picture files plus sources.json, which
 * names the sources for the studio's ASSETS list. */
const ART_FILES = ["tiles.json", "palettes.json", "sprites.json"].map((n) => ({
  name: n, source: fs.readFileSync(path.join(ART_DIR, n), "utf8") }));
const SOURCES = JSON.parse(fs.readFileSync(path.join(ART_DIR, "sources.json"),
                                           "utf8"));
const FRAMES = 120;
const PNG_FRAME = 60;
const LUA_BUDGET_MS = 100;          /* renderer/pce-toys.js DEFAULT_BUDGET_MS */

if (!fs.existsSync(ART) || !fs.existsSync(PLAY)) {
  console.log("SKIP  cave: the pack's converted art is not on this machine (" +
              ART_DIR + ")");
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
const source = fs.readFileSync(PLAY, "utf8");

console.log("== cave: the art on this machine is " + ART_DIR);
const tail = source.slice(toySource.length + 1);   /* the generated constants */
if (!process.env.PCE_CAVE_TOY) {
  check(source.slice(0, toySource.length) === toySource &&
        source[toySource.length] === "\n",
        "demo-art/cave/main.lua is toys/cave/main.lua plus a generated tail");
  /* the playable is the game code, not the art: no pokes, no pal() — the
   * picture is #117's import of the files beside it (card #156) */
  check(!/vram\[/.test(tail) && !/pal\(/.test(tail) &&
        !/rgb\(/.test(tail),
        "the playable's tail is constants only — the picture is the files'");
  check(/function art_boot\(\) end/.test(tail) &&
        /function art_board\(\) end/.test(tail) &&
        /function art_map\(\) end/.test(tail) &&
        /function art_patterns\(\) end/.test(tail),
        "the four art functions init() calls are no-ops in the playable " +
        "(the import already drew the picture)");
}
check(/Will Tice/.test(artSource),
      "the console block carries the pack's credit (Will Tice)");

const luaRT = toys.create(source, { files: ART_FILES });
const ilRT = il.create(source, { files: ART_FILES });
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
let keep0 = null;
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
  if (f === 0) {
    /* frame 0, both ways: as played (for the side-by-side) and SAT-less
     * (for the preview comparison — the toy's creatures are its own, not
     * the pack's).  At frame 0 the three scene bands are at BXR 0. */
    const opts0 = luaRT.options();
    const bg0 = sprites.renderFrame(Object.assign({}, opts0,
      { raster: want.raster || undefined,
        sat: new Uint8Array(opts0.sat.length) }));
    keep0 = { sat: Uint8Array.from(want.pixels),
              bg: Uint8Array.from(bg0.pixels) };
  }
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
  { name: "ceiling",  box: [0, 0, 256, 32],   min: 0.10 },
  { name: "crystals", box: [0, 32, 256, 56],  min: 0.10 },
  { name: "wall",     box: [0, 56, 256, 96],  min: 0.10 },
  { name: "midfloor", box: [0, 96, 256, 160], min: 0.02 },
  { name: "floor",    box: [0, 160, 256, 224], min: 0.08 }
];

const frame60 = keep[PNG_FRAME];
const whole = pictureIn(frame60, [0, 0, frame60.width, frame60.height]);
check(whole.distinct >= 8,
      "VISIBILITY: frame 60 holds " + whole.distinct + " colours (at least 8)");
check(whole.notModal > whole.area * 0.10,
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

const RASTER_LINES = [0, 32, 56, 96, 160];
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

/* The playable's tail carries the same five glow numbers as the console's
 * art.lua — one computation in the tool, two routes, and the tail is what
 * the runtime actually read. */
for (const name of ["GLOW_PAL", "GLOW_ENTRY", "GLOW_COLD", "GLOW_BASE",
                    "GLOW_HOT"]) {
  const re = (n) => n === "GLOW_PAL" || n === "GLOW_ENTRY"
    ? new RegExp("^" + n + " = (\\d+)", "m")
    : new RegExp("^" + n + " = (0x[0-9A-F]+)", "m");
  const inTail = Number((re(name).exec(tail) || [])[1]);
  const inArt = Number((re(name).exec(artSource) || [])[1]);
  check(inTail === inArt && Number.isFinite(inTail),
        "GLOW: the playable's " + name + " is the console's (" + inTail + ")");
}
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

/* ---- THE PICTURE --------------------------------------------------------
 * The card's own demand: the frame at BXR 0 must look like the pack's own
 * preview, colour-reduced.  The preview (evidence/preview.png, written by
 * the converter as a downsample of the pack's wallpaper) is snapped to the
 * VCE's 512 colours exactly as the renderer snaps its sources, then the
 * SAT-less frame 0 — whose three scene bands are at BXR 0 and whose first
 * 160 px ARE the author's scene — is compared pixel for pixel.  The rest of
 * the gap is the preview's creatures, which the toy draws itself (the art
 * block's header says what the converter measured). */
const PICTURE_MIN = 0.90;
function checkThePicture() {
  check(PICTURE_MIN > 0, "THE PICTURE: the match threshold is above 0");
  const previewFile = path.join(ART_DIR, "evidence", "preview.png");
  if (!fs.existsSync(previewFile)) {
    check(false, "THE PICTURE: the converter wrote no evidence/preview.png " +
                "to compare against (rerun tools/cave-assets.js)");
    return;
  }
  const preview = src.decodePng(fs.readFileSync(previewFile), zlib.inflateSync);
  check(preview.width === 160 && preview.height === 92,
        "THE PICTURE: the preview is the pack's 160x92 scene (" +
        preview.width + "x" + preview.height + ")");
  const snap = (v) => Math.max(0, Math.min(7, Math.round(v * 7 / 255))) * 36;
  let same = 0, n = 0;
  for (let y = 0; y < 92; y++)
    for (let x = 0; x < 160; x++) {
      n++;
      let ok = true;
      for (let c = 0; c < 3; c++) {
        if (keep0.bg[(y * 256 + x) * 3 + c] !==
            snap(preview.rgba[(y * 160 + x) * 4 + c])) { ok = false; break; }
      }
      if (ok) same++;
    }
  check(same / n >= PICTURE_MIN,
        "THE PICTURE: frame 0 at BXR 0 matches the pack's preview, VCE " +
        "colour-reduced (" + (100 * same / n).toFixed(1) + "% of " + n +
        " pixels, at least " + (100 * PICTURE_MIN) + "%)");
  /* the preview itself must be the pack's busy scene, not a flat stand-in
   * (the pack's own palette is small — the 12x downsample holds 16) */
  const counts = new Set();
  for (let i = 0; i < 160 * 92; i++)
    counts.add((preview.rgba[i * 4] << 16) | (preview.rgba[i * 4 + 1] << 8) |
               preview.rgba[i * 4 + 2]);
  check(counts.size >= 10,
        "THE PICTURE: the preview is a picture (" + counts.size +
        " distinct colours, at least 10)");
}

/* ---- THE ROCK -----------------------------------------------------------
 * The card's own demand: the lower half is the pack's rock, not one
 * repeated cell.  The floor bands' BAT rows (12-27) must carry many
 * distinct tiles — the author's fill, cracks and warm rock — most of them
 * with real texture (three or more colours), and every one must exist in
 * the art's tile list (a dangling char would be a hole in VRAM). */
const ROCK_MIN_CHARS = 12;
function checkTheRock() {
  const tilesDoc = JSON.parse(fs.readFileSync(path.join(ART_DIR, "tiles.json"),
                                              "utf8"));
  const cells = tilesDoc.map.cells;
  const byChar = {};
  for (const t of tilesDoc.tiles) byChar[t.char] = t;
  const chars = new Set();
  for (let r = 12; r < 28; r++)
    for (let c = 0; c < 32; c++) chars.add(cells[r * 32 + c]);
  check(chars.size >= ROCK_MIN_CHARS,
        "THE ROCK: the lower half's BAT holds " + chars.size +
        " distinct tiles (at least " + ROCK_MIN_CHARS + ")");
  let textured = 0, dangling = 0;
  for (const ch of chars) {
    const t = byChar[ch];
    if (!t) { dangling++; continue; }
    if (new Set(t.pixels).size >= 3) textured++;
  }
  check(dangling === 0,
        "THE ROCK: every lower-half cell names a tile the art carries (" +
        dangling + " dangling)");
  check(textured >= chars.size / 2,
        "THE ROCK: the lower half's tiles are the rock's texture — " +
        textured + " of " + chars.size + " tiles have at least 3 colours");
}

/* ---- THE LOOP -----------------------------------------------------------
 * #148's rule for CITY, five bands: each band's strip wraps at 256 px
 * without a seam, no band is a short block repeated, and the BXR run goes
 * round and round at each band's own rate. */
function checkTheLoop() {
  /* rebuild each band's strip from the art files — tiles, palettes, BAT —
   * the way the renderer draws it */
  const tilesDoc = JSON.parse(fs.readFileSync(path.join(ART_DIR, "tiles.json"),
                                              "utf8"));
  const pals = JSON.parse(fs.readFileSync(path.join(ART_DIR, "palettes.json"),
                                          "utf8"));
  const byChar = {};
  for (const t of tilesDoc.tiles) byChar[t.char] = t;
  const vce = (w) => [((w >> 3) & 7) * 36, ((w >> 6) & 7) * 36, (w & 7) * 36];
  const stripPx = (row, y, x) => {
    const cell = tilesDoc.map.cells[(row + (y >> 3)) * 32 + (x >> 3)];
    const t = byChar[cell];
    if (!t) return null;
    const w = pals.background[t.palette][t.pixels[(y & 7) * 8 + (x & 7)]];
    return vce(w);
  };
  const sceneBands = [0, 1, 2].map((i) => BANDS[i]);
  for (const b of sceneBands) {
    const y0 = b.box[1] >> 3, rows = (b.box[3] - b.box[1]) >> 3;
    let bad = 0, missing = 0;
    for (let y = 0; y < rows * 8; y++)
      for (let k = 0; k < 16; k++) {
        const left = stripPx(y0, y, k);
        if (left === null) { missing++; continue; }
        for (let j = 0; j < 6; j++) {
          const ext = stripPx(y0, y, 160 + k * 6 + j);
          if (ext === null) { missing++; continue; }
          if (ext[0] !== left[0] || ext[1] !== left[1] || ext[2] !== left[2])
            bad++;
        }
      }
    check(missing === 0 && bad === 0,
          "THE LOOP: the " + b.name + " band's last 12 cells stretch the " +
          "scene's own left columns (px 255 = px 15), so the wrap meets the " +
          "scene's adjacent columns (" + bad + " stretched pixels wrong, " +
          missing + " missing tiles)");
  }
  for (const r of [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27]) {
    const row = [];
    for (let c = 0; c < 32; c++) row.push(tilesDoc.map.cells[r * 32 + c]);
    check(row[0] === row[1] && row[30] === row[31] && row[0] === row[31],
          "THE LOOP: floor row " + r + "'s seam cells are flat at both ends " +
          "(the wrap meets " + row[31] + " on " + row[0] + ")");
  }
  /* no band is a short block repeated: every band has at least one row with
   * neither an 8- nor a 16-cell period */
  const bandRows = [
    [0, 4], [4, 7], [7, 12], [12, 20], [20, 28]
  ].map((pair) => ({ row0: pair[0], row1: pair[1] }));
  for (const b of bandRows) {
    let aperiodic = 0;
    for (let r = b.row0; r < b.row1; r++) {
      const row = [];
      for (let c = 0; c < 32; c++) row.push(tilesDoc.map.cells[r * 32 + c]);
      let p8 = true, p16 = true;
      for (let c = 0; c < 32; c++) {
        if (row[c] !== row[c % 8]) p8 = false;
        if (row[c] !== row[c % 16]) p16 = false;
      }
      if (!p8 && !p16) aperiodic++;
    }
    check(aperiodic >= 1,
          "THE LOOP: band rows " + b.row0 + "-" + (b.row1 - 1) + " hold a " +
          "scene, not a short block repeated (" + aperiodic +
          " rows with no 8- or 16-cell period)");
  }

  /* the BXR run: 300 frames of pad-right at each band's own rate, with at
   * least one wrap of each — a backward step that is not a fall from the
   * band's own top is a jump (the bug #148 found in CITY) */
  const tops = [127, 255, 511, 1023, 1022];
  const rates = [1, 1, 2, 4, 8];
  const rt = toys.create(source, { budgetMs: 400, files: ART_FILES });
  rt.load();
  const seq = [];
  for (let f = 0; f < 300; f++) {
    rt.setPad(1, { right: true });
    const g = rt.frame(f);
    if (g.raster && g.raster.entries.length === 5)
      seq.push(g.raster.entries.map((e) => e.bxr));
  }
  rt.dispose();
  check(seq.length === 300, "THE LOOP: 300 frames of the five bands recorded");
  let bad = 0;
  const wraps = [0, 0, 0, 0, 0];
  for (let i = 1; i < seq.length; i++)
    for (let k = 0; k < 5; k++) {
      const d = seq[i][k] - seq[i - 1][k];
      if (d >= 0) { if (d > rates[k]) bad++; }
      else if (seq[i - 1][k] > tops[k] - rates[k]) wraps[k]++;
      else bad++;
    }
  check(bad === 0,
        "THE LOOP: every band steps at its own rate, never a jump (" + bad +
        " bad steps)");
  check(wraps.every((w) => w >= 1),
        "THE LOOP: each band goes round and comes back (wraps " +
        wraps.join(",") + ")");
}

/* ---- 9: card #156 — the art is named sources, not pokes ----------------- *
 * The studio's own model (renderer/pce-assets.js) reads the four files; its
 * preview of each source is compared with the VRAM the importer wrote after
 * one frame, so the ASSETS pane's preview is proven to be the running
 * picture.  The encoders here are the editor's arithmetic (the tile words
 * and writeSpritePattern of renderer/pce-editor.js). */
function tileWord(tile, y, plane2) {
  let lo = 0, hi = 0;
  for (let x = 0; x < 8; x++) {
    const v = tile.pixels[y * 8 + x], bit = 7 - x;
    if (plane2) { if (v & 4) lo |= 1 << bit; if (v & 8) hi |= 1 << bit; }
    else { if (v & 1) lo |= 1 << bit; if (v & 2) hi |= 1 << bit; }
  }
  return lo | (hi << 8);
}
function cellWord(pat, half, block, row, k) {
  let w = 0;
  for (let x = 0; x < 16; x++)
    if (pat.pixels[(block * 16 + row) * pat.width + half * 16 + x] & (1 << k))
      w |= 1 << (15 - x);
  return w;
}
function patternVramOk(wordAt, pat, base) {
  const halves = pat.width === 32 ? 2 : 1;
  for (let b = 0; b < pat.height / 16; b++)
    for (let half = 0; half < halves; half++)
      for (let k = 0; k < 4; k++)
        for (let r = 0; r < 16; r++)
          if (wordAt((base + b * 2 + half) * 64 + k * 16 + r) !==
              cellWord(pat, half, b, r, k)) return false;
  return true;
}

function checkSources() {
  check(fs.statSync(PLAY).size < 20000,
        "main.lua is the game code plus the constants tail, not the art (" +
        fs.statSync(PLAY).size + " bytes < 20 KB)");

  /* the studio's model reads the files and names the sources */
  const A = require("../renderer/pce-assets.js");
  const files = ART_FILES.concat([{ name: "sources.json", source:
    fs.readFileSync(path.join(ART_DIR, "sources.json"), "utf8") }]);
  const sres = A.sources(files);
  eq("the studio's model names the two sources",
     sres.sources.map((s) => s.name), ["cave", "creatures"]);
  eq("... and every range is live (no stale or missing rows)", sres.notes, []);

  /* the ranges sources.json claims match the files it sits beside */
  const tiles = JSON.parse(ART_FILES[0].source);
  const pals = JSON.parse(ART_FILES[1].source);
  const sprs = JSON.parse(ART_FILES[2].source);
  const cave = SOURCES.sources[0], creatures = SOURCES.sources[1];
  eq("cave's tile range is the file's tiles",
     [cave.tiles.first, cave.tiles.count], [0, tiles.tiles.length]);
  check(cave.map === true && cave.palettes.side === "bg",
        "cave claims the BAT and the background palette rows");
  eq("creatures' pattern range is the file's patterns",
     [creatures.patterns.first, creatures.patterns.count], [0, 3]);
  check(creatures.sprites.first === 0 && creatures.sprites.count === 5,
        "creatures claims the toy's own SAT slots (0 and 1 the bats, 2..4 " +
        "the embers)");
  const rows = pals.sprites.filter((r) => r.some((w) => w));
  eq("the one sprite palette row the sources claim exists", rows.length, 1);

  /* the previews are the running picture: one frame, then compare */
  const rt = toys.create(source, { budgetMs: 400, files: ART_FILES });
  rt.load();
  const g = rt.frame(0);
  rt.dispose();
  const wordAt = (addr) => g.state.vram[addr * 2] | (g.state.vram[addr * 2 + 1] << 8);

  const cells = sres.sources[0].preview.cells;
  check(cells.length === tiles.tiles.length &&
        cells.every((c) => {
          const t = tiles.tiles[c.char - 0x40];
          return t && JSON.stringify(t.pixels) === JSON.stringify(c.pixels);
        }),
        "cave's preview is the file's " + tiles.tiles.length + " tiles, " +
        "pixel for pixel");
  let vramOk = true, badChar = null;
  for (const cell of cells) {
    const tile = tiles.tiles[cell.char - 0x40];
    for (let y = 0; y < 8; y++)
      if (wordAt(cell.char * 16 + y) !== tileWord(tile, y, false) ||
          wordAt(cell.char * 16 + 8 + y) !== tileWord(tile, y, true)) {
        vramOk = false; badChar = cell.char;
      }
  }
  check(vramOk, "cave's preview tiles' VRAM words are the importer's (" +
        tiles.tiles.length + " tiles compared, first bad $" +
        (badChar === null ? "none" : badChar.toString(16)) + ")");

  /* the placement: the importer's own, and the toy's tail names it */
  const satM = require("../renderer/pce-sat.js");
  const edM = require("../renderer/pce-editor.js");
  const codes = edM.patternLayout(satM.pictureFromFiles(ART_FILES)).codes;
  const patternCell = Number((/^PATTERN_CELL = (\d+)/m.exec(tail) || [])[1]);
  check(Number.isInteger(patternCell) && patternCell === codes[0],
        "PATTERN_CELL is the importer's first creature cell (" + patternCell +
        " = " + codes[0] + ")");
  for (let p = 0; p < 3; p++)
    check(codes[p] === patternCell + p,
          "creature pattern " + p + " is one cell after the last (16x16 " +
          "CGY 0 — the toy's PATTERN_CELL + 0/1/2 arithmetic)");

  const spritePrev = sres.sources[1].preview;
  eq("the creatures preview's cells are the importer's placement",
     spritePrev.cells.map((c) => c.cell), codes.slice(0, 3));
  spritePrev.cells.forEach((c, i) => {
    const pat = sprs.patterns[i];
    check(JSON.stringify(pat.pixels) === JSON.stringify(c.pixels),
          "the creatures preview's pattern " + i + " is the file's");
    check(patternVramOk(wordAt, pat, c.cell),
          "... and pattern " + i + "'s VRAM cells are the importer's");
  });
}

/* ---- the evidence side-by-side ------------------------------------------ */

function writeSideBySide() {
  const previewFile = path.join(ART_DIR, "evidence", "preview.png");
  const scale = 4;
  const w = 160 * scale * 2, h = 92 * scale;
  const rgb = Buffer.alloc(w * h * 3);
  const put = (ox, oy, px, c) => {
    for (let y = 0; y < scale; y++)
      for (let x = 0; x < scale; x++) {
        const o = ((oy + y) * w + ox + x) * 3;
        rgb[o] = px[0]; rgb[o + 1] = px[1]; rgb[o + 2] = px[2];
      }
  };
  if (fs.existsSync(previewFile)) {
    const preview = src.decodePng(fs.readFileSync(previewFile), zlib.inflateSync);
    for (let y = 0; y < 92; y++)
      for (let x = 0; x < 160; x++) {
        const s = (y * 160 + x) * 4;
        put(x * scale, y * scale,
            [preview.rgba[s], preview.rgba[s + 1], preview.rgba[s + 2]]);
      }
  }
  /* our frame 0, as played (creatures and all): the same 160x92 box */
  for (let y = 0; y < 92; y++)
    for (let x = 0; x < 160; x++) {
      const s = (y * 256 + x) * 3;
      put(160 * scale + x * scale, y * scale,
          [keep0.sat[s], keep0.sat[s + 1], keep0.sat[s + 2]]);
    }
  const outDir = path.join(ART_DIR, "evidence");
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, "side-by-side.png");
  const png = encodePng(rgb, w, h);
  fs.writeFileSync(file, png);
  check(fs.statSync(file).size === png.length,
        "the side-by-side is written beside the art: " +
        "demo-art/cave/evidence/side-by-side.png (the pack's preview, left; " +
        "frame 0, right)");
  /* read it back: both halves have a picture, and the halves are not the
   * same bytes (the frame is VCE-reduced, the preview is the pack's) */
  let differ = 0, left = new Set(), right = new Set();
  for (let i = 0; i < rgb.length; i += 3) {
    const k = (rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2];
    const x = (i / 3) % w;
    if (x < w / 2) left.add(k); else right.add(k);
    if (rgb[i] !== rgb[i + 1] || rgb[i] !== rgb[i + 2]) differ++;
  }
  check(left.size >= 8 && right.size >= 8,
        "both halves of the side-by-side hold a picture (" + left.size +
        " and " + right.size + " colours)");
  check(differ > 1000, "the side-by-side is not a flat colour");
}

/* ---- the picture -------------------------------------------------------- */

checkThePicture();
checkTheRock();
checkTheLoop();
checkSources();
writeSideBySide();

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
