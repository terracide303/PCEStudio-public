#!/usr/bin/env node
/*
 * tests/check-dusk-run.js — the #151 evidence for toys/dusk-run.
 *
 *   node tests/check-dusk-run.js
 *
 * WHAT IT RUNS: the demo through the host — renderer/pce-toys.js over
 * Fengari — for 600 frames with a scripted pad, and through the IL runtime
 * (renderer/pce-il.js) alongside it.  Every frame must agree exactly: vram,
 * cram, sat, the four register values, the raster table and the pixels.  The
 * same scripted pad runs in both, so the two runs are the same game.
 *
 * WHAT IT PROVES, in the pixels and the state rather than the toy's words:
 *
 *   - IT BUILDS, THEN RUNS: the first 137 frames are the toy drawing its
 *     tiles a few at a time (BUILD_STEPS), so the hero has no SAT entry
 *     until frame 137; from then it stands on the ground at SAT y 216.
 *   - IT JUMPS A ROCK: the scripted pad presses N (pad[1].i) on frames
 *     500-513.  The hero leaves the ground (SAT y 216 -> 185), and the same
 *     600 frames with no pad is the CONTROL: it loses a life the frame the
 *     first rock reaches the hero (the object at the hero's x and y carries
 *     ROCK's pattern, 0x102), while the scripted run is still on three lives
 *     at that frame and airborne over it.  So "it jumps a rock" is measured
 *     against a run that does not.
 *   - 600 FRAMES CLEAN: no runtime error, every Lua frame inside the #30
 *     budget, and the #50 sprite budget on every line (16 strips, no
 *     overflow).  The CC condition does fire — the hero is sprite 0 and the
 *     rock that hits it is another sprite — so the check proves every CC
 *     frame is that rock at the hero's own x and y, not a stray overlap.
 *   - VISIBLE: frame 599 is a picture, not the backdrop, and the SPRITES
 *     draw the hero, the rock and the lives — the same frame with an empty
 *     SAT loses them.  The check's own control is the empty SAT: the same
 *     threshold rejects it (0 px), so "sprites off" cannot pass this test.
 *   - THE VALIDATOR: renderer/pce-validate.js accepts the toy (ok, with its
 *     findings printed), VRAM fits 32,768 words and no sprite line
 *     overflows.  The one finding is validate-slow-frame: the sunset writes
 *     the backdrop colour on ~152 sky lines, so a console frame costs 3.27
 *     of a 60 Hz frame (18.3 Hz).  That is listed, not hidden.
 *
 * WHAT IT DOES NOT PROVE, and says so in a NOTE when it runs: the console
 * Export path refuses the toy — renderer/pce-ilbc.js has no bytecode form
 * for `table`, which is how DUSK RUN keeps its rocks, birds, hearts and
 * state — so the toy is browser-only for now, as toys/dusk-run/README.md
 * says.  Also per workshop rule 2 a cold break by another seat is owed
 * before this closes the card.
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

const TOY = path.join(ROOT, "toys", "dusk-run", "main.lua");
const DUMPS = path.join(__dirname, "dumps", "dusk-run");
const FRAMES = 600;
const PNG_FRAME = 599;
const LUA_BUDGET_MS = 100;          /* renderer/pce-toys.js DEFAULT_BUDGET_MS */

/* SAT slots, from toys/dusk-run/main.lua's own comment: 0 hero, 1..4
 * rocks/birds/hearts, 5..9 the lives. */
const SLOT_HERO = 0;
const SLOT_LIVES = 5;
const LIVES_MAX = 5;

/* The hero's SAT y on the ground is py//16 + 64 = (168 - 16) + 64.  The
 * game's own collision compares screen y, which is SAT y - 64. */
const GROUND_Y = 216;
const GROUND_HY = GROUND_Y - 64;
const HERO_X = 48;                  /* HERO_X in the toy, before +32 */
const HERO_SAT_X = HERO_X + 32;
const BUILD_DONE = 137;             /* BUILD_STEPS + 1 frames of drawing */

/* Patterns from the toy's own locals. */
const ROCK = 0x102;

/* The jump the card names: N (pad[1].i) from frame 500, held 14 frames, so
 * the hero is high over the first rock as it reaches x 80. */
const JUMP_FROM = 500;
const JUMP_TO = 514;
function jumpPad(f) { return { i: f >= JUMP_FROM && f < JUMP_TO }; }
function idlePad() { return {}; }

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
function spritePattern(state, slot) { return satWord(state, slot, 2) >> 1; }
function visible(state, slot) { return spriteY(state, slot) !== 0; }

/* The lives are SAT slots 5..9, one drawn per life (up to five). */
function lives(state) {
  let n = 0;
  for (let k = 0; k < LIVES_MAX; k++)
    if (visible(state, SLOT_LIVES + k)) n++;
  return n;
}

/* The object the game's own collision test would hit this frame: the toy
 * compares dist(ox, HERO_X) < 11 and dist(oy, hy) < 12, where ox/oy are its
 * screen position and hy is py//16.  The SAT carries x + 32 and y + 64. */
function objectAtHero(state) {
  for (let i = 1; i <= 4; i++) {
    if (!visible(state, i)) continue;
    const x = spriteX(state, i) - 32;
    const y = spriteY(state, i) - 64;
    if (Math.abs(x - HERO_X) < 11 && Math.abs(y - GROUND_HY) < 12)
      return { slot: i, x: x, y: y, pattern: spritePattern(state, i) };
  }
  return null;
}

/* The sprites whose 16x16 boxes overlap the hero's, in the SAT's own
 * coordinates: what the VDC's CC condition sees on a line. */
function overlappingHero(state) {
  const out = [];
  for (let i = 1; i <= 4; i++) {
    if (!visible(state, i)) continue;
    if (Math.abs(spriteX(state, i) - HERO_SAT_X) < 16 &&
        Math.abs(spriteY(state, i) - GROUND_Y) < 16)
      out.push({ slot: i, pattern: spritePattern(state, i) });
  }
  return out;
}

/* ---- pixels ------------------------------------------------------------- */

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

/* ---- the runs ----------------------------------------------------------- */

/* Both runtimes, frame for frame.  `keep` is the frames whose pixels are
 * copied out for the dump and the visibility check. */
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
  const ccFrames = [];
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
    let cc = false;
    for (const line of st.lines) {
      if (line.strips > maxStrips) maxStrips = line.strips;
      if (line.OR) overflowLines++;
      if (line.CC) cc = true;
    }
    if (cc) ccFrames.push(f);

    records.push({
      f: f,
      y: visible(ga.state, SLOT_HERO) ? spriteY(ga.state, SLOT_HERO) : null,
      x: visible(ga.state, SLOT_HERO) ? spriteX(ga.state, SLOT_HERO) : null,
      lives: lives(ga.state),
      hit: objectAtHero(ga.state),
      overlap: overlappingHero(ga.state)
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
           overflowLines, ccFrames, options, state };
}

/* One runtime, for the control and for the first-hit search. */
function playLua(padFn, frames) {
  const source = fs.readFileSync(TOY, "utf8");
  const a = toys.create(source, { budgetMs: 250 });
  a.load();
  const records = [];
  let error = null;
  try {
    for (let f = 0; f < frames; f++) {
      a.setPad(1, padFn(f));
      const g = a.frame(f);
      records.push({
        f: f,
        y: visible(g.state, SLOT_HERO) ? spriteY(g.state, SLOT_HERO) : null,
        lives: lives(g.state),
        hit: objectAtHero(g.state)
      });
    }
  } catch (e) {
    error = e;
  }
  a.dispose();
  return { records, error };
}

/* The first frame a life is lost, from after the build; null if never. */
function firstHit(records) {
  for (let i = 1; i < records.length; i++) {
    if (records[i].f < BUILD_DONE) continue;
    if (records[i].lives < records[i - 1].lives) return records[i];
  }
  return null;
}

/* ---- the play evidence -------------------------------------------------- */

function checkPlay() {
  const run = playTogether(jumpPad, FRAMES, [0, BUILD_DONE, JUMP_TO, PNG_FRAME]);
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
  /* DUSK RUN is a game: its hero is SAT slot 0 and the rock that hits it is
   * another sprite, so the CC condition is EXPECTED on those frames.  What
   * must hold is that every CC frame is the game's own hit — the rock's
   * 16x16 box overlapping the hero's — and not a sprite somewhere else. */
  const strayCC = run.ccFrames.filter((f) =>
    !run.records[f].overlap.some((o) => o.pattern === ROCK));
  eq("every sprite-0 collision is the rock overlapping the hero, not a " +
     "stray sprite", strayCC.slice(0, 8), []);
  check(run.ccFrames.length > 0,
        "the model saw the hero's rock hit (CC on " + run.ccFrames.length +
        " frame(s): " + run.ccFrames.slice(0, 8).join(", ") + ")");

  /* the build finishes, then the hero stands on the ground */
  check(rec.slice(0, BUILD_DONE).every((r) => r.y === null),
        "the first " + BUILD_DONE + " frames are the build (no hero yet)");
  eq("the hero appears on the ground at frame " + BUILD_DONE,
     rec[BUILD_DONE].y, GROUND_Y);
  eq("it is still standing on the ground at frame " + (JUMP_FROM - 1),
     rec[JUMP_FROM - 1].y, GROUND_Y);

  /* N lifts the hero */
  const ys = rec.map((r) => r.y).filter((y) => y !== null);
  check(ys.some((y) => y < GROUND_Y - 20),
        "N lifted the hero off the ground (highest SAT y " + Math.min(...ys) +
        ", seen from " + GROUND_Y + ")");

  /* THE ROCK.  The control is the same toy with no pad: it loses a life the
   * frame the first rock reaches the hero, and that object is a rock. */
  const control = playLua(idlePad, FRAMES);
  check(!control.error, "the control run has no runtime error" +
        (control.error ? ": " + control.error.message : ""));
  const controlHit = firstHit(control.records);
  check(!!controlHit, "the no-pad control loses a life inside " + FRAMES +
        " frames (it runs into the first rock)");
  if (controlHit) {
    check(!!controlHit.hit,
          "at its hit frame " + controlHit.f + " an object overlaps the hero");
    eq("the object the control hits is a rock (pattern 0x" +
       ROCK.toString(16) + ")", controlHit.hit && controlHit.hit.pattern, ROCK);
    eq("the control starts with three lives", control.records[BUILD_DONE].lives,
       3);
    check(controlHit.lives === 2,
          "the control is on two lives at frame " + controlHit.f + " (" +
          controlHit.lives + ")");

    const sameFrame = rec[controlHit.f];
    eq("the scripted run is still on three lives at the control's hit frame " +
       controlHit.f, sameFrame.lives, 3);
    check(sameFrame.y !== null && sameFrame.y < GROUND_Y - 12,
          "… and it is airborne over the rock at that frame (SAT y " +
          sameFrame.y + " < " + (GROUND_Y - 12) + ")");

    const scriptedHit = firstHit(rec);
    check(!!scriptedHit && scriptedHit.f > controlHit.f,
          "the scripted run's first hit is a later object, not this rock (" +
          (scriptedHit ? "frame " + scriptedHit.f : "none") + " vs " +
          controlHit.f + ")");
    console.log("  rock: the control hits it at frame " + controlHit.f +
                " (pattern 0x" + controlHit.hit.pattern.toString(16) +
                "); the jump clears it, next hit at " +
                (scriptedHit ? "frame " + scriptedHit.f : "none"));
  }

  /* VISIBLE: frame 599 is a picture, and the sprites are what makes the hero,
   * the rock and the lives show.  The control is the same frame with an
   * empty SAT (0 px). */
  const frame = run.kept.get(PNG_FRAME);
  const whole = pictureIn(frame, 256, 224, [0, 0, 256, 224]);
  check(whole.distinct >= 5,
        "VISIBILITY: frame " + PNG_FRAME + " holds " + whole.distinct +
        " colours (at least 5)");
  check(whole.notModal >= 3000,
        "VISIBILITY: the sky bands, ground and sprites draw " + whole.notModal +
        " pixels that are not the backdrop (at least 3000)");
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

  console.log("  play: " + FRAMES + " frames, hero y " + GROUND_Y + " -> " +
              Math.min(...ys) + " on the jump, " + ink +
              " sprite pixels at frame " + PNG_FRAME);
  return { kept: run.kept, frame: frame };
}

/* ---- the validator ------------------------------------------------------ */

function checkBudgets() {
  const source = fs.readFileSync(TOY, "utf8");
  const rep = validate.validate(source, { chunkName: "dusk-run/main.lua",
                                          frames: FRAMES });
  check(rep.ok, "the validator accepts the toy" +
        (rep.ok ? "" : ": " + rep.code + " " + rep.message));
  /* the findings are LISTED, not hidden: the sunset's per-line backdrop
   * write is a warn (validate-slow-frame), and no finding is an error. */
  const findings = rep.problems || rep.findings || [];
  console.log("  validator findings (" + findings.length + "):");
  for (const f of findings)
    console.log("    " + (f.severity || "?") + " " + (f.code || "?") + ": " +
                (f.message || ""));
  check(findings.every((f) => f.severity !== "error"),
        "every validator finding is a warning, none an error");
  check(findings.some((f) => f.code === "validate-slow-frame"),
        "the slow-frame finding is listed (the sky's per-line palette write)");
  if (!rep.ok || !rep.budgets) return;
  const b = rep.budgets;
  check(b.ratio60 < 8, "frame() and its raster() are inside the 8-frame " +
        "hard ceiling (" + b.ratio60.toFixed(2) + "x, " + b.hz.toFixed(0) +
        " Hz)");
  check(b.vram.words <= 32768, "VRAM " + b.vram.words + " words inside 32,768");
  eq("no sprite line overflows", b.spriteOverflowLines, []);
  console.log("  budget: frame " + b.frameCycles + " cycles (" +
              b.ratio60.toFixed(2) + "x60 Hz, " + b.hz.toFixed(0) + " Hz), " +
              "VRAM " + b.vram.words + " words, " + b.sprites.requested +
              " strips on the busiest line");

  /* the browser-only finding, recorded rather than failed: the console
   * encoder cannot carry a Lua table yet. */
  try {
    ilbc.encode(il.compile(source));
    note("the console export carries this toy now — toys/dusk-run/README.md " +
         "says it is browser-only for tables; update it");
  } catch (e) {
    note("browser-only for now: the console export refuses the toy (" +
         e.code + ": " + e.message + ") — toys/dusk-run/README.md says so");
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
  console.log("check-dusk-run — toys/dusk-run (DUSK RUN), card #151\n");
  const play = checkPlay();
  checkBudgets();
  writeDump(play.kept);

  console.log("\n" + checks + " checks, " + failures.length + " failed");
  if (failures.length) {
    for (const f of failures) console.log("  FAILED: " + f);
    return 1;
  }
  console.log("PASS  check-dusk-run");
  return 0;
}

process.exit(main());
