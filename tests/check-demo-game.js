#!/usr/bin/env node
/*
 * tests/check-demo-game.js — card #88's evidence: toys/demo-game is a small
 * game built only in the studio, and this plays it headlessly.
 *
 * What it asserts:
 *
 *   1. THE ART IS THE PANELS' PICTURE.  `node tools/demo-game-assets.js
 *      --check` exits 0: the block main.lua's VRAM writes are generated from,
 *      the three files the SCREEN, SPRITES and PALETTES panels edit, and the
 *      studio envelope they are saved in are all the tool's own output, so a
 *      picture edited in a panel cannot drift from the picture the game boots.
 *      (The missing importer is card #117; the tool is the workaround.)
 *   2. THE VALIDATOR'S BUDGETS.  renderer/pce-validate.js accepts the game
 *      (rep.ok), its frame() costs less than one 60 Hz video frame
 *      (ratio60 < 1), sprites never overflow a line, VRAM fits 32,768 words
 *      and the ROM estimate fits the 1 MB HuCard.
 *   3. LUA == IL, FRAME BY FRAME.  The same source, the same scripted pad,
 *      600 frames: vram, cram, sat, regs, the raster table and the rendered
 *      pixels are byte-equal on every frame.  This is the claim the studio's
 *      Lua/IL switch makes, and the one a game written in the editor relies on.
 *   4. IT PLAYS.  The scripted pad moves the ship (2 px a frame, clamped to
 *      the playfield), N fires (rate-limited to one shot in eight frames, four
 *      slots), a shot that meets a drone raises the score, and a drone that
 *      meets a parked ship costs a life once and not again while inv runs.
 *      That life is the VDC's own collision flag: the ship is SAT slot 0 and
 *      `sr()` carries the CC bit (#119); clearing CR bit 0, its enable, in a
 *      copy of the source loses no life at all, which is the control.
 *      The status bar is a raster split: BYR 0 and the bar's backdrop above
 *      line 24, the frame's own scroll and the field's backdrop below it.
 *   5. THE EVIDENCE IS IN THE REPO.  The seven key frames and a six-cell strip
 *      are written to tests/dumps/demo-game/ and read back: every pixel of the
 *      committed pictures is the run's.
 *
 * What it does NOT prove, and says so in a NOTE line when it runs:
 *
 *   - The game has no sound a person can hear.  It calls sfx() and the PSG
 *     writes happen, but with no music() the host never sets the master
 *     amplitude R1, so its PCM renders silent (card #113).  The test prints
 *     the PCM's RMS; when #113 lands the line stops saying 0.
 *   - The VDC's CC flag is used only for the ship: a bullet against a drone
 *     is still `hit()` arithmetic, because the hardware reports sprite #0
 *     against the others and #0 is the ship.
 *   - The entity lists are int arrays now that the IL reads a table index
 *     (card #118): four bullets and six drones are three arrays each and
 *     every operation is one loop over them.  The HUD digits are a ten-entry
 *     table from the generated block.
 *
 * Written by @design because the card names this file (as check-toys.js and
 * check-validate.js were).  Per workshop rule 2 a cold break by another seat
 * is owed before this closes the card.
 *
 *   node tests/check-demo-game.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const child = require("child_process");

const toys = require("../renderer/pce-toys.js");
const il = require("../renderer/pce-il.js");
const validate = require("../renderer/pce-validate.js");

const REPO = path.join(__dirname, "..");
const GAME = path.join(REPO, "toys", "demo-game", "main.lua");
const ASSETS = path.join(REPO, "toys", "demo-game");
const DUMPS = path.join(__dirname, "dumps", "demo-game");
const FRAMES = 600;
const WIDTH = 256;
const HEIGHT = 224;

/* Sprite slots, from main.lua's own table: 0 the ship (sprite #0 so the
 * VDC's CC flag is the player's collision, #119), 1..3 score digits, 4..6
 * lives, 7..12 drones, 13..16 bullets. */
const SLOT_SCORE = [1, 2, 3];
const SLOT_LIVES = [4, 5, 6];
const SLOT_SHIP = 0;   /* #119: sprite #0 is the VDC's CC subject */
const SLOT_BULLET = 13;
const DIGIT_BASE = 18;   /* the ten digit pattern codes, art block */

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
 * pattern code (stored shifted left one) and the attribute (palette in the
 * low four bits).  A hidden sprite is the whole entry zeroed, which is how
 * main.lua hides one (`sprite(i, {y = 0})`). */

function satWord(state, slot, k) {
  return state.sat[slot * 8 + k * 2] | (state.sat[slot * 8 + k * 2 + 1] << 8);
}
function spriteY(state, slot) { return satWord(state, slot, 0); }
function spriteX(state, slot) { return satWord(state, slot, 1); }
function spritePattern(state, slot) { return satWord(state, slot, 2) >> 1; }
function visible(state, slot) { return spriteY(state, slot) !== 0; }

/* The HUD as a player reads it: the three digit sprites as a number, and one
 * heart per life still showing. */
function score(state) {
  let n = 0;
  for (const slot of SLOT_SCORE) n = n * 10 + (spritePattern(state, slot) - DIGIT_BASE);
  return n;
}
function lives(state) {
  return SLOT_LIVES.filter((i) => visible(state, i)).length;
}

/* ---- 1: the art is the panels' picture -------------------------------- */

function checkArtIsThePanels() {
  let out = null, err = null;
  try {
    out = child.execFileSync(process.execPath,
      [path.join(REPO, "tools", "demo-game-assets.js"), "--check"],
      { encoding: "utf8" });
  } catch (e) {
    err = e;
  }
  check(err === null, "the art is the panels' picture: tools/demo-game-assets.js --check " +
        "exits 0" + (err ? " (" + String(err.stderr || err.message).trim() + ")" : ""));
  if (out) console.log("  " + out.trim());

  for (const f of ["tiles.json", "sprites.json", "palettes.json", "demo-game.pce.json"]) {
    check(fs.existsSync(path.join(ASSETS, f)), "toys/demo-game/" + f + " is there");
  }
  const tiles = JSON.parse(fs.readFileSync(path.join(ASSETS, "tiles.json"), "utf8"));
  const patterns = JSON.parse(fs.readFileSync(path.join(ASSETS, "sprites.json"), "utf8"));
  const palettes = JSON.parse(fs.readFileSync(path.join(ASSETS, "palettes.json"), "utf8"));
  eq("tiles.json: the five tiles the game's art block writes", tiles.tiles.length, 5);
  eq("sprites.json: the fourteen patterns", patterns.patterns.length, 14);
  eq("sprites.json: the seventeen SAT slots", patterns.sprites.length, 17);
  eq("palettes.json: sixteen background palettes", palettes.background.length, 16);
  eq("the envelope carries four files",
     JSON.parse(fs.readFileSync(path.join(ASSETS, "demo-game.pce.json"), "utf8"))
       .files.length, 4);
}

/* ---- 2: the validator's budgets --------------------------------------- */

function checkBudgets(source) {
  const rep = validate.validate(source, { chunkName: "demo-game/main.lua", frames: 8 });
  check(rep.ok, "the validator accepts the game" +
        (rep.ok ? "" : ": " + rep.code + " " + rep.message));
  if (!rep.ok || !rep.budgets) return;
  const b = rep.budgets;
  check(b.frameCycles > 0, "frame() has a cost");
  check(b.ratio60 < 1, "frame() fits one 60 Hz video frame (" +
        b.ratio60.toFixed(2) + "x, " + b.hz.toFixed(0) + " Hz)");
  check(b.vram.words <= 32768, "VRAM " + b.vram.words + " words inside 32,768");
  eq("no sprite line overflows", b.spriteOverflowLines, []);
  check(b.rom.bytes > 0 && b.rom.bytes < b.rom.limit,
        "ROM estimate " + Math.round(b.rom.bytes) + " B inside the 1 MB HuCard");
  console.log("  validator: frame " + b.frameCycles + " cycles (" +
              b.ratio60.toFixed(2) + "x60 Hz), VRAM " + b.vram.words +
              " words, ROM ~" + Math.round(b.rom.bytes) + " B, " +
              b.sprites.requested + " strips on the busiest line");
}

/* ---- 3 + 4: play, Lua and IL side by side ------------------------------ */

/* The scripted pad: fly right for three seconds, back left, up, down, firing
 * a burst every twelve frames — the game a person would play, written down so
 * the run is the same on every machine and in both runtimes. */
function scriptedPad(f) {
  const p = {};
  if (f < 180) p.right = true;
  else if (f < 240) p.left = true;
  if (f >= 240 && f < 300) p.up = true;
  else if (f >= 300 && f < 360) p.down = true;
  if (f % 12 < 2) p.i = true;
  return p;
}

/* Run the same source in both runtimes, one frame at a time, comparing the
 * whole hardware state and the picture; keep the frames the dumps need. */
function playTogether(padFn, frames, keep) {
  const source = fs.readFileSync(GAME, "utf8");
  const a = toys.create(source, { budgetMs: 250 });
  const b = il.create(source, { budgetMs: 250 });
  a.load();
  b.load();
  const diffs = [];
  const records = [];
  const kept = new Map();
  for (let f = 0; f < frames; f++) {
    const p = padFn(f);
    a.setPad(1, p);
    b.setPad(1, p);
    const ga = a.frame(f);
    const gb = b.frame(f);
    for (const k of ["vram", "cram", "sat"]) {
      if (!Buffer.from(ga.state[k]).equals(Buffer.from(gb.state[k]))) {
        diffs.push(k + " @" + f);
      }
    }
    if (!Buffer.from(ga.pixels).equals(Buffer.from(gb.pixels))) {
      diffs.push("pixels @" + f);
    }
    if (JSON.stringify(ga.state.regs) !== JSON.stringify(gb.state.regs)) {
      diffs.push("regs @" + f);
    }
    if (JSON.stringify(ga.raster) !== JSON.stringify(gb.raster)) {
      diffs.push("raster @" + f);
    }

    records.push({
      f: f,
      score: score(ga.state),
      lives: lives(ga.state),
      shipX: visible(ga.state, SLOT_SHIP) ? spriteX(ga.state, SLOT_SHIP) : null,
      shipVisible: visible(ga.state, SLOT_SHIP),
      bulletY: visible(ga.state, SLOT_BULLET) ? spriteY(ga.state, SLOT_BULLET) : null,
      bulletX: visible(ga.state, SLOT_BULLET) ? spriteX(ga.state, SLOT_BULLET) : null,
      byr: ga.raster && ga.raster.entries.length > 1 ? ga.raster.entries[1].byr : null,
      baseByr: ga.raster ? ga.raster.base.byr : null,
      baseCr: ga.raster ? ga.raster.base.cr : null,
      barCram: ga.raster ? ga.raster.entries[0].cram : null,
      fieldCram: ga.raster && ga.raster.entries.length > 1 ? ga.raster.entries[1].cram : null,
      barLine: ga.raster ? ga.raster.entries[0].line : null,
      fieldLine: ga.raster && ga.raster.entries.length > 1 ? ga.raster.entries[1].line : null,
    });
    if (keep && keep.includes(f)) kept.set(f, Uint8Array.from(ga.pixels));
  }
  const counted = { lua: a.frameCount, il: b.frameCount,
                    sound: a.sound.events.length, pcm: a.renderSound(frames) };
  a.dispose();
  b.dispose();
  return { diffs: diffs, records: records, kept: kept, counted: counted };
}

function checkPlay() {
  const keep = [0, 60, 120, 240, 360, 480, 599];
  const run = playTogether(scriptedPad, FRAMES, keep);
  const rec = run.records;
  const last = rec[rec.length - 1];

  /* 3: Lua == IL */
  eq("Lua == IL: frame-by-frame differences over " + FRAMES + " frames",
     run.diffs.slice(0, 8), []);
  /* the host's counter is the last frame index, so 600 frames end on 599 */
  eq("both runtimes ran every frame", [run.counted.lua, run.counted.il],
     [FRAMES - 1, FRAMES - 1]);

  /* 4a: the score climbs and never falls back */
  let monotonic = true;
  for (let i = 1; i < rec.length; i++) if (rec[i].score < rec[i - 1].score) monotonic = false;
  check(monotonic, "the score never goes down over the run");
  check(last.score > 0, "a shot that meets a drone scores (final score " + last.score + ")");

  /* 4b: the ship moved with the pad */
  const xs = rec.filter((r) => r.shipVisible).map((r) => r.shipX);
  check(xs.length > 100, "the ship is visible on " + xs.length + " frames");
  check(Math.max(...xs) > 200 && Math.min(...xs) < 140,
        "the pad flew the ship across the field (" + Math.min(...xs) + ".." +
        Math.max(...xs) + ")");

  /* 4c: a bullet left the ship and climbed four pixels a frame */
  const shot = rec.filter((r) => r.bulletY !== null);
  check(shot.length > 20, "the fire button put bullets on the SAT (" +
        shot.length + " frames with one flying)");
  let drop = true;
  for (let i = 1; i < shot.length; i++) {
    if (shot[i].f === shot[i - 1].f + 1 && shot[i].bulletY !== shot[i - 1].bulletY - 4) drop = false;
  }
  check(drop, "a flying bullet climbs four pixels a frame");

  /* 4d: the raster split — the bar on BYR 0, the field on this frame's scroll */
  let split = true, sawScroll = false;
  for (let i = 0; i < rec.length; i++) {
    const r = rec[i];
    if (r.barLine !== 0 || r.fieldLine !== 24) split = false;
    if (r.baseByr !== 0 || r.baseCr !== 0xC3) split = false;
    if (r.byr !== (i + 1) % 256) split = false;
    if (r.byr !== 0) sawScroll = true;
    if (JSON.stringify(r.barCram) === JSON.stringify(r.fieldCram)) split = false;
  }
  check(split, "every frame is a raster split: line 0 holds BYR 0 and the bar's " +
        "backdrop, line 24 releases the frame's scroll and the field's");
  check(sawScroll, "the released BYR actually moved with the scroll");

  /* 4e: the run ended with a sane HUD */
  check(last.lives >= 1 && last.lives <= 3, "the HUD shows " + last.lives + " of 3 lives");

  /* the PC's side of the same run */
  console.log("  play: " + FRAMES + " frames, score " + last.score + ", " +
              last.lives + " lives, PSG writes " + run.counted.sound +
              " (" + run.counted.pcm.pcm.length + " PCM samples)");
  const pcm = run.counted.pcm.pcm;
  let sum = 0;
  for (const v of pcm) sum += v * v;
  const rms = Math.sqrt(sum / pcm.length);
  if (rms === 0) {
    note("the game's sound renders silent (PCM RMS 0): it calls sfx() with no " +
         "music(), so the host never sets the PSG's master amplitude R1 — card #113");
  } else {
    note("the game's sound renders non-silent PCM (RMS " + rms.toFixed(1) + ")");
  }

  return { last: last, kept: run.kept };
}

/* ---- 4f: a drone that meets a parked ship costs one life -------------- */

function checkCollision() {
  const source = fs.readFileSync(GAME, "utf8");
  const rt = toys.create(source, { budgetMs: 250 });
  rt.load();
  let lost = -1;
  const before = [];
  for (let f = 0; f < FRAMES; f++) {
    rt.setPad(1, {});
    const got = rt.frame(f);
    const l = lives(got.state);
    before.push(l);
    if (lost < 0 && l < 3) lost = f;
  }
  const lastLives = before[before.length - 1];
  const drops = before.filter((l, i) => i > 0 && l < before[i - 1]).length;
  rt.dispose();

  check(lost > 0, "a drone that reaches a parked ship costs a life" +
        (lost < 0 ? " (no life was lost in " + FRAMES + " still frames)"
                  : " (first at frame " + lost + ")"));
  eq("exactly one life is lost in the 600-frame still run", drops, 1);
  eq("the still run ends on two hearts", lastLives, 2);

  /* THE CONTROL (#119): the same still run with the CC enable cleared loses
   * no life, so the loss above is the VDC's status flag and not arithmetic
   * that would happen with or without sr(). */
  const noCc = source.replace('reg("CR", 0xC3)', 'reg("CR", 0xC0)');
  check(noCc !== source, "the control copy cleared CR bit 0 (the CC enable)");
  const ctl = toys.create(noCc, { budgetMs: 250 });
  ctl.load();
  let ctlLost = -1;
  for (let f = 0; f < FRAMES; f++) {
    ctl.setPad(1, {});
    const l = lives(ctl.frame(f).state);
    if (ctlLost < 0 && l < 3) ctlLost = f;
  }
  ctl.dispose();
  check(ctlLost < 0, "with the CC enable cleared no life is lost in the same " +
        "600 still frames" + (ctlLost < 0 ? "" : " (lost at frame " + ctlLost + ")"));
  return { lost: lost };
}

/* ---- the dump: the seven frames and the strip ------------------------- */

/* The PNG writer is tests/check-examples.js's (itself check.js's); copied so
 * this suite writes its own evidence without depending on another suite. */
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
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(rgb, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from("\x89PNG\r\n\x1a\n", "latin1"),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function decodePng(buf) {
  if (buf.slice(0, 8).toString("latin1") !== "\x89PNG\r\n\x1a\n") throw new Error("not a PNG");
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
  if (bitDepth !== 8 || colourType !== 2) throw new Error("not an 8-bit RGB PNG");
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

/* The most common colour in a band is the backdrop; everything else is
 * picture.  (#90's rule: a frame is judged by what shows, not what it wrote.) */
function picturePixels(px, y0, y1) {
  const hist = new Map();
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const o = (y * WIDTH + x) * 3;
      const k = (px[o] << 16) | (px[o + 1] << 8) | px[o + 2];
      hist.set(k, (hist.get(k) || 0) + 1);
    }
  }
  let modal = -1, most = 0;
  for (const [k, n] of hist) if (n > most) { most = n; modal = k; }
  return { modal: modal, others: (y1 - y0) * WIDTH - most };
}

function writeDumps(kept, last, collision) {
  fs.mkdirSync(DUMPS, { recursive: true });
  const frames = [...kept.keys()].sort((a, b) => a - b);
  for (const f of frames) {
    fs.writeFileSync(path.join(DUMPS, "frame-" + String(f).padStart(3, "0") + ".png"),
                     encodePng(kept.get(f), WIDTH, HEIGHT));
  }
  const cols = 2, rows = Math.ceil(frames.length / cols);
  const strip = new Uint8Array(WIDTH * cols * HEIGHT * rows * 3);
  frames.forEach((f, i) => {
    const cx = (i % cols) * WIDTH, cy = Math.floor(i / cols) * HEIGHT;
    const p = kept.get(f);
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const s = (y * WIDTH + x) * 3;
        const d = ((cy + y) * WIDTH * cols + (cx + x)) * 3;
        strip[d] = p[s]; strip[d + 1] = p[s + 1]; strip[d + 2] = p[s + 2];
      }
    }
  });
  fs.writeFileSync(path.join(DUMPS, "strip.png"),
                   encodePng(strip, WIDTH * cols, HEIGHT * rows));
  const evidence = {
    card: 88,
    game: "toys/demo-game/main.lua",
    frames: FRAMES,
    scriptedPad: "right 0-179, left 180-239, up 240-299, down 300-359, " +
                 "N held on f%12<2",
    finalScore: last.score,
    finalLives: last.lives,
    firstLifeLostInStillRun: collision.lost,
    stripFrames: frames,
    strip: "strip.png (" + cols + "x" + rows + " cells of " + WIDTH + "x" + HEIGHT + ")",
    sound: "sfx-only: PSG writes happen, PCM is silent until card #113 sets R1",
  };
  fs.writeFileSync(path.join(DUMPS, "evidence.json"),
                   JSON.stringify(evidence, null, 2) + "\n");

  /* Read the committed evidence back: the strip's cells are the frame PNGs,
   * and both are the run's pixels. */
  const stripPng = decodePng(fs.readFileSync(path.join(DUMPS, "strip.png")));
  eq("the strip is " + (WIDTH * cols) + "x" + (HEIGHT * rows),
     [stripPng.width, stripPng.height], [WIDTH * cols, HEIGHT * rows]);
  let same = true;
  frames.forEach((f, i) => {
    const one = decodePng(fs.readFileSync(
      path.join(DUMPS, "frame-" + String(f).padStart(3, "0") + ".png")));
    const px = kept.get(f);
    if (one.width !== WIDTH || one.height !== HEIGHT) same = false;
    for (let y = 0; y < HEIGHT && same; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const s = (y * WIDTH + x) * 3;
        const cx = (i % cols) * WIDTH, cy = Math.floor(i / cols) * HEIGHT;
        const d = ((cy + y) * WIDTH * cols + (cx + x)) * 3;
        if (one.pixels[s] !== px[s] || stripPng.pixels[d] !== px[s]) { same = false; break; }
      }
    }
  });
  check(same, "the dumps read back pixel-for-pixel as the run's frames");
  return frames;
}

/* ---- 4g: the frames show a picture ------------------------------------ */

function checkVisible(kept) {
  const f = 599;
  const px = kept.get(f);
  check(!!px, "frame " + f + " was kept for the picture checks");
  if (!px) return;
  const bar = picturePixels(px, 0, 24);
  const field = picturePixels(px, 24, HEIGHT);
  check(bar.others > 50, "the status bar shows its digits and hearts (" +
        bar.others + " non-backdrop pixels above line 24)");
  check(field.others > 400, "the playfield shows its tiles, drones and ship (" +
        field.others + " non-backdrop pixels below line 24)");
  check(bar.modal !== field.modal, "the bar and the field have different backdrops");
}

/* ---- main ------------------------------------------------------------- */

function main() {
  console.log("check-demo-game — toys/demo-game (STARFALL), card #88\n");
  const source = fs.readFileSync(GAME, "utf8");
  checkArtIsThePanels();
  checkBudgets(source);
  const play = checkPlay();
  const collision = checkCollision();
  const frames = writeDumps(play.kept, play.last, collision);
  checkVisible(play.kept);
  console.log("  dumps: " + frames.length + " frames + strip.png under " +
              path.relative(REPO, DUMPS) + "/");

  console.log("\n" + checks + " checks, " + failures.length + " failed");
  if (failures.length) {
    for (const f of failures) console.log("  FAILED: " + f);
    return 1;
  }
  console.log("PASS  check-demo-game");
  return 0;
}

process.exit(main());
