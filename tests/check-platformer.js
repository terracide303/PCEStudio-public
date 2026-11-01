#!/usr/bin/env node
/*
 * tests/check-platformer.js — the #147 evidence for toys/platformer.
 *
 *   node tests/check-platformer.js
 *
 * WHAT IT RUNS: the demo through the host — renderer/pce-toys.js over
 * Fengari — for 600 frames with a scripted pad, and through the IL runtime
 * (renderer/pce-il.js) alongside it.  Every frame must agree exactly: vram,
 * cram, sat, the four register values, the raster table and the pixels.  The
 * same scripted pad runs in both, so the two runs are the same game.
 *
 * WHAT IT PROVES, in the pixels and the state rather than the toy's words:
 *
 *   - IT PLAYS: J/L move the hero (a second, short run holds L and the SAT
 *     x climbs); N jumps, the hero leaves the ground and LANDS ON A PLATFORM
 *     — the scripted jump takes it from the grass at SAT y 240 to the brick
 *     ledge at SAT y 200 and it stays there, and the BAT cell under its feet
 *     at that height is the brick tile (0x43), not the sky.
 *   - 600 FRAMES CLEAN: no runtime error, every Lua frame inside the #30
 *     budget, and the #50 sprite budget on every line (16 strips, no OR, no
 *     CC).
 *   - VISIBLE: frame 599 is a picture, not the backdrop, and the SPRITES
 *     draw it — the same frame with an empty SAT loses the hero's pixels.
 *     The check's own control is the empty SAT: the same threshold rejects
 *     it (0 px), so "sprites off" cannot pass this test.
 *   - THE VALIDATOR: renderer/pce-validate.js accepts the toy (ok), frame()
 *     fits one 60 Hz frame, VRAM fits 32,768 words and no sprite line
 *     overflows.
 *
 * WHAT IT DOES NOT PROVE, and says so in a NOTE when it runs: the console
 * Export path builds the toy since #186 carried `sat` (the sprite table
 * write) — tests/check-export-games.js pins its ROM and its Mednafen
 * picture — but if a later kind lands first the refusal is noted here, not
 * failed, as toys/platformer/README.md says.  Also per workshop rule 2 a
 * cold break by another seat is owed before this closes the card.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const toys = require(path.join(ROOT, "renderer", "pce-toys.js"));
const il = require(path.join(ROOT, "renderer", "pce-il.js"));
const sprites = require(path.join(ROOT, "renderer", "pce-sprites.js"));
const validate = require(path.join(ROOT, "renderer", "pce-validate.js"));
const ilbc = require(path.join(ROOT, "renderer", "pce-ilbc.js"));

const TOY = path.join(ROOT, "toys", "platformer", "main.lua");
const DUMPS = path.join(__dirname, "dumps", "platformer");
const FRAMES = 600;
const PNG_FRAME = 599;
const LUA_BUDGET_MS = 100;          /* renderer/pce-toys.js DEFAULT_BUDGET_MS */

/* SAT slot 0 is the hero (toys/platformer/main.lua writes sat(0, ...)). */
const SLOT_HERO = 0;
const GROUND_Y = 240;               /* feet on the grass: (192 - 16) + 64 */
const PLATFORM_Y = 200;             /* feet on the row-19 bricks: 136 + 64 */
const PLATFORM_ROW = 19;
const BRICK_CHAR = 0x43;

let checks = 0;
const failures = [];
function check(ok, name) {
  checks++;
  if (!ok) { failures.push(name); console.log("FAIL  " + name); }
}
function eq(name, got, want) {
  check(JSON.stringify(got) === JSON.stringify(want),
        name + " (got " + JSON.stringify(got) + ", want " +
        JSON.stringify(want) + ")");
}
function note(text) { console.log("NOTE  " + text); }

/* ---- the SAT readers --------------------------------------------------- *
 * HuC6270 manual 2.4: each entry is four little-endian words — Y, X, the
 * pattern code (stored shifted left one) and the attribute. */
function satWord(state, slot, k) {
  return state.sat[slot * 8 + k * 2] | (state.sat[slot * 8 + k * 2 + 1] << 8);
}
function spriteY(state, slot) { return satWord(state, slot, 0); }
function spriteX(state, slot) { return satWord(state, slot, 1); }
function visible(state, slot) { return spriteY(state, slot) !== 0; }

/* ---- pixels ------------------------------------------------------------- */

function cramWord(cram, i) { return cram[i * 2] | (cram[i * 2 + 1] << 8); }
function cramRgb(cram, i) {
  const w = cramWord(cram, i);
  return [(w >> 3 & 7) * 36, (w >> 6 & 7) * 36, (w & 7) * 36];
}

/* The picture in a box, measured against ITS OWN most common colour: the
 * backdrop is CRAM[0]'s sky, and a frame that is only sky is flat. */
function pictureIn(pixels, width, height, box) {
  const counts = new Map();
  let n = 0;
  for (let y = box[1]; y < box[3] && y < height; y++) {
    for (let x = box[0]; x < box[2] && x < width; x++) {
      const i = (y * width + x) * 3;
      const key = (pixels[i] << 16) | (pixels[i + 1] << 8) |
                  pixels[i + 2];
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
function spriteInk(frame, options) {
  const opts = Object.assign({}, options,
                             { raster: (frame && frame.raster) || undefined });
  const withSprites = sprites.renderFrame(opts);
  const without = sprites.renderFrame(Object.assign({}, opts,
    { sat: new Uint8Array(opts.sat.length) }));
  let n = 0;
  for (let i = 0; i < withSprites.pixels.length; i++)
    if (withSprites.pixels[i] !== without.pixels[i]) n++;
  return n;
}

/* The visibility assertion as a function, so the control below exercises the
 * same comparison the picture check uses (#90/#106): a frame passes when its
 * sprites draw at least MIN_SPRITE pixels.  With the SAT emptied it draws 0,
 * and that must fail — otherwise "the sprites are visible" is not tested. */
const MIN_SPRITE = 100;
function spriteVisible(n) { return n >= MIN_SPRITE; }

/* ---- the scripted pads -------------------------------------------------- */

/* The jump the card names: N pressed on frame 10 and held 14 frames, so the
 * hero leaves the grass, rises and lands on the first brick ledge. */
function jumpPad(f) { return { i: f >= 10 && f < 24 }; }

/* ---- the run ------------------------------------------------------------ */

function playTogether(padFn, frames, keep) {
  const source = fs.readFileSync(TOY, "utf8");
  const a = toys.create(source, { budgetMs: 250 });
  const b = il.create(source, { budgetMs: 250 });
  a.load();
  b.load();
  check(a.initialized === true, "the Lua runtime loaded");
  check(b.initialized === true, "the IL runtime loaded");
  check(!!b.program && b.program.lang === "pce-il",
        "the IL runtime carries a pce-il program, not the Lua one");
  eq("both runtimes agree on the raster form",
     b.callbackRaster, a.callbackRaster);

  const diffs = [];
  const records = [];
  const kept = new Map();
  let worstMs = 0, worstFrame = -1, maxStrips = 0, overflowLines = 0;
  let collision = false;
  let lastState = null;

  for (let f = 0; f < frames; f++) {
    const p = padFn(f);
    a.setPad(1, p);
    b.setPad(1, p);
    const t0 = Date.now();
    const ga = a.frame(f);
    const ms = Date.now() - t0;
    if (ms > worstMs) { worstMs = ms; worstFrame = f; }
    const gb = b.frame(f);

    for (const k of ["vram", "cram", "sat"]) {
      if (!Buffer.from(ga.state[k]).equals(Buffer.from(gb.state[k])))
        diffs.push(k + " @" + f);
    }
    if (!Buffer.from(ga.pixels).equals(Buffer.from(gb.pixels)))
      diffs.push("pixels @" + f);
    if (JSON.stringify(ga.state.regs) !== JSON.stringify(gb.state.regs))
      diffs.push("regs @" + f);
    if (JSON.stringify(ga.raster) !== JSON.stringify(gb.raster))
      diffs.push("raster @" + f);

    /* #50's sprite budget, from the model's own SAT search on this frame */
    const st = sprites.status(Object.assign({}, a.options(),
      { raster: ga.raster || undefined }));
    for (const line of st.lines) {
      if (line.strips > maxStrips) maxStrips = line.strips;
      if (line.OR) overflowLines++;
      if (line.CC) collision = true;
    }

    records.push({
      f: f,
      y: visible(ga.state, SLOT_HERO) ? spriteY(ga.state, SLOT_HERO) : null,
      x: visible(ga.state, SLOT_HERO) ? spriteX(ga.state, SLOT_HERO) : null,
    });
    if (keep && keep.includes(f)) kept.set(f, Uint8Array.from(ga.pixels));
    lastState = {
      vram: Uint8Array.from(ga.state.vram),
      cram: Uint8Array.from(ga.state.cram),
      sat: Uint8Array.from(ga.state.sat)
    };
  }

  const counted = { lua: a.frameCount, il: b.frameCount };
  const options = a.options();
  const state = lastState;
  a.dispose();
  b.dispose();
  return { diffs, records, kept, counted, worstMs, worstFrame, maxStrips,
           overflowLines, collision, options, state };
}

/* ---- the play evidence -------------------------------------------------- */

function checkPlay() {
  const run = playTogether(jumpPad, FRAMES, [0, 9, 24, PNG_FRAME]);
  const rec = run.records;

  eq("Lua == IL: frame-by-frame differences over " + FRAMES + " frames",
     run.diffs.slice(0, 8), []);
  eq("both runtimes ran every frame", [run.counted.lua, run.counted.il],
     [FRAMES - 1, FRAMES - 1]);
  check(run.worstMs < LUA_BUDGET_MS,
        "the worst Lua frame (" + run.worstMs + " ms at frame " +
        run.worstFrame + ") is inside the #30 budget of " + LUA_BUDGET_MS +
        " ms");
  check(run.maxStrips <= 16, "no line asks for more than 16 sprite strips " +
        "(#50), most seen: " + run.maxStrips);
  check(run.overflowLines === 0, "no sprite overflow (OR) on any line");
  check(!run.collision, "no sprite-0 collision (CC) on any line");

  /* it starts on the grass and the jump lifts it */
  eq("the hero starts on the grass (SAT y " + GROUND_Y + ")",
     rec[0].y, GROUND_Y);
  const ys = rec.map((r) => r.y).filter((y) => y !== null);
  check(ys.some((y) => y < GROUND_Y - 20),
        "N lifted the hero off the grass (lowest SAT y " + Math.min(...ys) +
        ", seen from " + GROUND_Y + ")");

  /* LANDS ON A PLATFORM: from the frame the jump has run its course to the
   * last frame, the hero stands on the row-19 bricks — the y the ledge's top
   * gives (152 - 16 + 64 = 200), not back on the grass. */
  const after = rec.slice(40);
  check(after.length > 0 && after.every((r) => r.y === PLATFORM_Y),
        "the hero landed on the platform and stayed (" + after.filter(
          (r) => r.y === PLATFORM_Y).length + " of " + after.length +
        " frames after frame 40 at SAT y " + PLATFORM_Y + ")");
  eq("it never fell back to the grass after landing",
     after.filter((r) => r.y === GROUND_Y).length, 0);

  /* and the tile under its feet there is the brick, in the frame's VRAM:
   * the ledge is the map the land test reads, not a number in this file. */
  const feetCell = (PLATFORM_Y - 64 + 16) / 8;     /* feet row: 19 */
  const heroCol = Math.floor((rec[PNG_FRAME].x - 32) / 8);
  eq("the landed tile row", feetCell, PLATFORM_ROW);
  const cell = run.state.vram[(PLATFORM_ROW * 32 + heroCol) * 2] |
               (run.state.vram[(PLATFORM_ROW * 32 + heroCol) * 2 + 1] << 8);
  eq("the BAT cell under the landed hero is the brick (0x" +
     BRICK_CHAR.toString(16) + ")", cell & 0x3ff, BRICK_CHAR);

  /* J/L run: a second, short run holds L and the hero's x climbs. */
  const walk = playTogether((f) => ({ right: true }), 60, []);
  const wx = walk.records.filter((r) => r.x !== null).map((r) => r.x);
  check(wx.length > 50 && wx[wx.length - 1] > wx[0] + 60,
        "J/L run the hero right (" + wx[0] + " -> " + wx[wx.length - 1] +
        " px in 60 frames)");

  /* VISIBLE: frame 599 is a picture, and the sprites are what makes the hero
   * show.  The control is the same frame with an empty SAT (0 px). */
  const frame = run.kept.get(PNG_FRAME);
  const whole = pictureIn(frame, 256, 224, [0, 0, 256, 224]);
  check(whole.distinct >= 5,
        "VISIBILITY: frame " + PNG_FRAME + " holds " + whole.distinct +
        " colours (at least 5)");
  check(whole.notModal >= 3000,
        "VISIBILITY: the ground, ledges and hero draw " + whole.notModal +
        " pixels that are not the sky (at least 3000)");
  const ink = spriteInk(frame, run.options);
  check(spriteVisible(ink),
        "VISIBILITY: the sprites draw " + ink + " pixels frame " +
        PNG_FRAME + " shows (at least " + MIN_SPRITE + ")");
  check(MIN_SPRITE > 0 && !spriteVisible(0),
        "VISIBILITY control: the same threshold rejects a frame with sprites " +
        "off (0 px)");
  check(!spriteVisible(MIN_SPRITE - 1),
        "VISIBILITY control: one pixel short of the threshold fails (" +
        (MIN_SPRITE - 1) + " of " + MIN_SPRITE + ")");

  console.log("  play: " + FRAMES + " frames, landed at SAT y " +
              rec[PNG_FRAME].y + " (platform), " + ink +
              " sprite pixels at frame " + PNG_FRAME);
  return { kept: run.kept, frame: frame };
}

/* ---- the validator ------------------------------------------------------ */

function checkBudgets() {
  const source = fs.readFileSync(TOY, "utf8");
  const rep = validate.validate(source, { chunkName: "platformer/main.lua",
                                          frames: 8 });
  check(rep.ok, "the validator accepts the toy" +
        (rep.ok ? "" : ": " + rep.code + " " + rep.message));
  if (!rep.ok || !rep.budgets) return;
  const b = rep.budgets;
  check(b.ratio60 < 1, "frame() fits one 60 Hz video frame (" +
        b.ratio60.toFixed(2) + "x, " + b.hz.toFixed(0) + " Hz)");
  check(b.vram.words <= 32768, "VRAM " + b.vram.words + " words inside 32,768");
  eq("no sprite line overflows", b.spriteOverflowLines, []);
  console.log("  validator: frame " + b.frameCycles + " cycles (" +
              b.ratio60.toFixed(2) + "x60 Hz), VRAM " + b.vram.words +
              " words, " + b.sprites.requested + " strips on the busiest line");

  /* the export finding, recorded rather than failed: the console encoder
   * carries the toy since #186 (sat), so a refusal here is a regression. */
  try {
    ilbc.encode(il.compile(source));
    note("the console export carries this toy (#186 sat) — " +
         "check-export-games.js pins its ROM and Mednafen picture");
  } catch (e) {
    note("the console export refuses the toy again (" +
         e.code + ": " + e.message + ") — toys/platformer/README.md says so");
  }
  return rep;
}

/* ---- the dump ----------------------------------------------------------- */

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
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
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
    throw new Error("expected an 8-bit RGB PNG");
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

function writeDump(kept) {
  fs.mkdirSync(DUMPS, { recursive: true });
  const frame = kept.get(PNG_FRAME);
  const file = path.join(DUMPS, "frame-" + PNG_FRAME + ".png");
  fs.writeFileSync(file, encodePng(frame, 256, 224));
  const back = decodePng(fs.readFileSync(file));
  eq("the dump's size is the frame's", [back.width, back.height], [256, 224]);
  let same = back.pixels.length === frame.length;
  if (same) for (let i = 0; i < frame.length; i++)
    if (back.pixels[i] !== frame[i]) same = false;
  check(same, "the dump reads back pixel-for-pixel as frame " + PNG_FRAME);
  console.log("  dump: " + path.relative(ROOT, file));
}

/* ---- main --------------------------------------------------------------- */

function main() {
  console.log("check-platformer — toys/platformer (PLATFORMER), card #147\n");
  const play = checkPlay();
  checkBudgets();
  writeDump(play.kept);

  console.log("\n" + checks + " checks, " + failures.length + " failed");
  if (failures.length) {
    for (const f of failures) console.log("  FAILED: " + f);
    return 1;
  }
  console.log("PASS  check-platformer");
  return 0;
}

process.exit(main());
