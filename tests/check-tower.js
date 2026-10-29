#!/usr/bin/env node
/*
 * tests/check-tower.js — the #147 evidence for toys/tower.
 *
 *   node tests/check-tower.js
 *
 * WHAT IT RUNS: the demo through the host — renderer/pce-toys.js over
 * Fengari — for 600 frames with a scripted pad, and through the IL runtime
 * (renderer/pce-il.js) alongside it.  Every frame must agree exactly: vram,
 * cram, sat, the four register values, the raster table and the pixels.  The
 * same scripted pad runs in both, so the two runs are the same game.
 *
 * WHAT IT PROVES, in the pixels and the state rather than the toy's words:
 *
 *   - IT CLIMBS A LADDER: the scripted pad walks the hero right to the first
 *     ladder (x 176 px) and holds I; the hero's SAT x locks to 208 (the
 *     ladder's +32 offset) while its y falls one pixel a frame, 48 pixels
 *     from the ground floor (SAT y 256) to the floor above (SAT y 208), and
 *     the BAT cells it climbed on are the ladder tile (0x42).
 *   - THE BOULDERS ROLL: a boulder sprite is visible on consecutive frames
 *     and its SAT x moves — the spawner and the roll are running, not just
 *     drawn once.
 *   - 600 FRAMES CLEAN: no runtime error, every Lua frame inside the #30
 *     budget, the #50 sprite budget on every line (16 strips, no OR, no CC),
 *     and the three lives it starts with are still there at the end.
 *   - VISIBLE: frame 599 is a picture, not the backdrop, and the SPRITES
 *     draw the hero, the boulders and the pickups — the same frame with an
 *     empty SAT loses them.  The check's own control is the empty SAT: the
 *     same threshold rejects it (0 px), so "sprites off" cannot pass.
 *   - THE VALIDATOR: renderer/pce-validate.js accepts the toy (ok), frame()
 *     fits one 60 Hz frame, VRAM fits 32,768 words and no sprite line
 *     overflows.
 *
 * WHAT IT DOES NOT PROVE, and says so in a NOTE when it runs: the console
 * Export path refuses the toy — renderer/pce-ilbc.js has no bytecode form
 * for `table`, which is how TOWER keeps its boulders, hearts and state — so
 * the toy is browser-only for now, as toys/tower/README.md says.  Also per
 * workshop rule 2 a cold break by another seat is owed before this closes
 * the card.
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

const TOY = path.join(ROOT, "toys", "tower", "main.lua");
const DUMPS = path.join(__dirname, "dumps", "tower");
const FRAMES = 600;
const PNG_FRAME = 599;
const LUA_BUDGET_MS = 100;          /* renderer/pce-toys.js DEFAULT_BUDGET_MS */

/* SAT slots, from toys/tower/main.lua's own comment: 0 hero, 1 hammer in
 * hand, 2..7 boulders, 8 hammer pickup, 9..11 hearts, 12 gem, 13..17 lives. */
const SLOT_HERO = 0;
const SLOT_FIRST_ROCK = 2;
const NROCKS = 6;
const SLOT_LIVES = 13;
const N_LIVES = 5;

const GROUND_Y = 256;               /* feet on the ground floor: 192 + 64 */
const UPPER_Y = 208;                /* feet on floor 20: 144 + 64 */
const LADDER_X = 208;               /* ladder 0 at 176 px + the SAT's 32 */
const LADDER_CHAR = 0x42;

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
function lives(state) {
  let n = 0;
  for (let k = 0; k < N_LIVES; k++) if (visible(state, SLOT_LIVES + k)) n++;
  return n;
}

/* ---- pixels ------------------------------------------------------------- */

function pictureIn(pixels, width, height, box) {
  const counts = new Map();
  let n = 0;
  for (let y = box[1]; y < box[3] && y < height; y++) {
    for (let x = box[0]; x < box[2] && x < width; x++) {
      const i = (y * width + x) * 3;
      const key = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
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
 * same comparison the picture check uses (#90/#106). */
const MIN_SPRITE = 500;
function spriteVisible(n) { return n >= MIN_SPRITE; }

/* ---- the scripted pad --------------------------------------------------- *
 * Walk right until the hero reaches the first ladder (x 176), and hold I
 * around that moment: the toy joins the ladder when the hero stands in its
 * six-pixel window.  Then nothing: it stands on the floor above. */
function climbPad(f) {
  return { right: f < 140, up: f >= 120 && f < 240 };
}

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

    const rocks = [];
    for (let i = 0; i < NROCKS; i++) {
      const slot = SLOT_FIRST_ROCK + i;
      rocks.push(visible(ga.state, slot)
        ? { x: spriteX(ga.state, slot), y: spriteY(ga.state, slot) } : null);
    }
    records.push({
      f: f,
      y: visible(ga.state, SLOT_HERO) ? spriteY(ga.state, SLOT_HERO) : null,
      x: visible(ga.state, SLOT_HERO) ? spriteX(ga.state, SLOT_HERO) : null,
      lives: lives(ga.state),
      rocks: rocks,
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
  a.dispose();
  b.dispose();
  return { diffs, records, kept, counted, worstMs, worstFrame, maxStrips,
           overflowLines, collision, options, state: lastState };
}

/* ---- the play evidence -------------------------------------------------- */

function checkPlay() {
  const run = playTogether(climbPad, FRAMES, [0, 120, 180, 240, PNG_FRAME]);
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

  /* the hero starts on the ground */
  eq("the hero starts on the ground floor (SAT y " + GROUND_Y + ")",
     rec[0].y, GROUND_Y);

  /* CLIMBS A LADDER: consecutive frames on the ladder's x while y falls one
   * pixel a frame, for the 48-pixel climb to the floor above. */
  let climbFrames = 0;
  for (let i = 1; i < rec.length; i++) {
    if (rec[i].x === LADDER_X && rec[i - 1].x === LADDER_X &&
        rec[i].y === rec[i - 1].y - 1) climbFrames++;
  }
  check(climbFrames >= 40,
        "I climbed the first ladder: " + climbFrames +
        " consecutive frames at SAT x " + LADDER_X + " falling one pixel " +
        "a frame (at least 40)");
  const ys = rec.map((r) => r.y).filter((y) => y !== null);
  eq("the climb reached the floor above (SAT y " + UPPER_Y + ")",
     Math.min(...ys), UPPER_Y);
  const tail = rec.slice(-100);
  check(tail.every((r) => r.y === UPPER_Y && r.x === LADDER_X),
        "the hero stands on the floor above for the last 100 frames");

  /* ...and the cells it climbed are the ladder tile in the BAT, not a
   * number in this file.  Ladder 0 is at x 176, so BAT columns 22 and 23,
   * between row 20 and row 26. */
  const ladderCol = 176 / 8;
  const upperCell = run.state.vram[(25 * 32 + ladderCol) * 2] |
                    (run.state.vram[(25 * 32 + ladderCol) * 2 + 1] << 8);
  eq("the BAT cells the hero climbed are the ladder (0x" +
     LADDER_CHAR.toString(16) + ")", upperCell & 0x3ff, LADDER_CHAR);

  /* THE BOULDERS ROLL: one boulder sprite is visible on consecutive frames
   * and its x moves. */
  let rolled = 0, rolling = null;
  for (let i = 1; i < rec.length; i++) {
    for (let k = 0; k < NROCKS; k++) {
      const now = rec[i].rocks[k], before = rec[i - 1].rocks[k];
      if (now && before && now.y === before.y && now.x !== before.x) {
        rolled++;
        if (!rolling) rolling = { f: i, from: before.x, to: now.x };
      }
    }
  }
  check(rolled >= 20, "the boulders roll: " + rolled +
        " consecutive-frame x changes across the six boulders" +
        (rolling ? " (first at frame " + rolling.f + ": " + rolling.from +
                   " -> " + rolling.to + ")" : ""));

  /* 600 frames clean: the three lives it starts with are still there */
  eq("the run starts with 3 lives", rec[0].lives, 3);
  eq("no boulder or fall took a life in the 600 frames",
     rec[PNG_FRAME].lives, 3);

  /* VISIBLE: frame 599 is a picture, and the sprites are what makes the
   * hero and the pickups show.  The control is the same frame with an empty
   * SAT (0 px). */
  const frame = run.kept.get(PNG_FRAME);
  const whole = pictureIn(frame, 256, 224, [0, 0, 256, 224]);
  check(whole.distinct >= 5,
        "VISIBILITY: frame " + PNG_FRAME + " holds " + whole.distinct +
        " colours (at least 5)");
  check(whole.notModal >= 8000,
        "VISIBILITY: the tower's stone draws " + whole.notModal +
        " pixels that are not its most common colour (at least 8000)");
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

  console.log("  play: " + FRAMES + " frames, climbed " + climbFrames +
              " px at x " + LADDER_X + " to SAT y " + UPPER_Y + ", " + ink +
              " sprite pixels at frame " + PNG_FRAME);
  return { kept: run.kept, frame: frame };
}

/* ---- the validator ------------------------------------------------------ */

function checkBudgets() {
  const source = fs.readFileSync(TOY, "utf8");
  const rep = validate.validate(source, { chunkName: "tower/main.lua",
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

  /* the browser-only finding, recorded rather than failed: the console
   * encoder cannot carry a table yet. */
  try {
    ilbc.encode(il.compile(source));
    note("the console export carries this toy now — toys/tower/README.md " +
         "says it is browser-only for tables; update it");
  } catch (e) {
    note("browser-only for now: the console export refuses the toy (" +
         e.code + ": " + e.message + ") — toys/tower/README.md says so");
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
  console.log("check-tower — toys/tower (TOWER), card #147\n");
  const play = checkPlay();
  checkBudgets();
  writeDump(play.kept);

  console.log("\n" + checks + " checks, " + failures.length + " failed");
  if (failures.length) {
    for (const f of failures) console.log("  FAILED: " + f);
    return 1;
  }
  console.log("PASS  check-tower");
  return 0;
}

process.exit(main());
