#!/usr/bin/env node
/*
 * tests/check-oak-woods.js — card #128's evidence: toys/oak-woods is a game,
 * and this plays it headlessly with a scripted pad.
 *
 * THE ART IS NOT IN THE REPOSITORY (docs/DECISIONS.md, 2026-10-29).  The
 * playable file is demo-art/oak-woods/main.lua, written by
 * tools/oak-woods-art.js from the pack through the #123 importer.  When that
 * folder is absent this check prints SKIP and exits 0 — a fresh clone stays
 * green, and nothing here pretends the pack's art is committed.
 *
 * What it asserts:
 *
 *   1. THE ART IS THE TOOL'S OUTPUT.  `node tools/oak-woods-art.js --check`
 *      exits 0, so the playable file is exactly the toy's Lua with the block
 *      the importer generates — a hand edit cannot drift from the import.
 *   2. THE VALIDATOR ACCEPTS IT.  renderer/pce-validate.js (given the song,
 *      as the runtime is) reports ok, frame() under one 60 Hz video frame,
 *      no sprite line over 16 strips, VRAM inside 32,768 words.
 *   3. LUA == IL, EVERY FRAME, 760 frames of the scripted pad: vram, cram,
 *      sat, regs, the raster table and the rendered pixels are byte-equal.
 *   4. IT PLAYS.  Four rocks are jumped and score one each; the sign adds
 *      ten and ends the run; the same run with no jump loses all three lives
 *      and never reaches the sign (the control).
 *   5. THE STATUS BAR IS A SPLIT.  The raster table holds line 0 at BXR 0
 *      (the bar never moves) and lines 24/72/128 at a quarter, a half and
 *      the full scroll (the three tree bands), and the bar's cells do not
 *      change while the playfield's do.
 *   6. THE SONG PLAYS.  The PSG writes are recorded and the PCM renders
 *      non-silent (music() sets the master amplitude, so this is the first
 *      demo game whose sound is audible — card #113's symptom is absent).
 *   7. THE PICTURES are written to demo-art/oak-woods/dumps/ and read back
 *      pixel for pixel.
 *
 * WHAT IT DOES NOT PROVE:
 *   - Nothing runs on the console: the Export cannot carry a game yet
 *     (docs/STARFALL-CONSOLE.md, #132..#138, #141, #143);
 *     tools/starfall-console.js <this file> --song toys/oak-woods/song.json
 *     prints this toy's own findings, and there is no Mednafen capture.
 *   - The art itself is not in the repo, so this test's art checks are only
 *     as good as the folder `tools/oak-woods-art.js` wrote.
 *   - Rule 2: written by the card's author.  A cold break by another seat is
 *     owed before the card closes.
 *
 *   node tests/check-oak-woods.js
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
const TOY = path.join(REPO, "toys", "oak-woods", "main.lua");
const SONG = path.join(REPO, "toys", "oak-woods", "song.json");
const DEMO_ART = process.env.DEMO_ART ||
  "/Volumes/External/agent-workshop-demo/demo-art";
const ART = path.join(DEMO_ART, "oak-woods");
const GAME = path.join(ART, "main.lua");
const DUMPS = path.join(ART, "dumps");
const FRAMES = 760;
const JUMPS = [64, 204, 394, 564];   /* the four rocks' collision centres */
const WIN_SCORE = 14;                 /* four rocks passed, plus the sign's 10 */

let checks = 0;
const failures = [];
function check(ok, name) {
  checks++;
  if (!ok) { failures.push(name); console.log("FAIL  " + name); }
}
function eq(name, got, want) {
  check(JSON.stringify(got) === JSON.stringify(want), name +
        (JSON.stringify(got) === JSON.stringify(want) ? "" :
         " (got " + JSON.stringify(got) + ", want " + JSON.stringify(want) + ")"));
}
function note(text) { console.log("NOTE  " + text); }

/* ---- the skip ---------------------------------------------------------- */

if (!fs.existsSync(GAME)) {
  console.log("SKIP  no demo-art/oak-woods/main.lua in this clone — the art " +
              "is not committed (docs/DECISIONS.md, 2026-10-29). Run\n" +
              "      node tools/oak-woods-art.js\n" +
              "      with the pack at /Volumes/External/Download/oak_woods_v1.0.zip " +
              "(or OAK_WOODS_PACK) to build it.");
  process.exit(0);
}

const source = fs.readFileSync(GAME, "utf8");
const song = JSON.parse(fs.readFileSync(SONG, "utf8"));

/* the generated block's own constants, so the checks read the same numbers
 * the toy does rather than a copy of them */
function constOf(name) {
  const m = source.match(new RegExp("^" + name + " = (.+)$", "m"));
  if (!m) throw new Error("the art block has no " + name);
  return m[1];
}
function intArray(name) {
  return JSON.parse("[" + constOf(name).replace(/[{}]/g, "").replace(/\s+/g, "") + "]");
}
const DIGIT_CHARS = intArray("DIGIT_CHARS");
const HUD_TIME = intArray("HUD_TIME");
const HUD_SCORE = intArray("HUD_SCORE");
const GROUND = Number(constOf("GROUND"));
const FAR_LINE = Number(constOf("FAR_LINE"));
const MID_LINE = Number(constOf("MID_LINE"));
const NEAR_LINE = Number(constOf("NEAR_LINE"));

function batCell(state, cell) {
  return state.vram[cell * 2] | (state.vram[cell * 2 + 1] << 8);
}
function digits(state, cells) {
  return cells.map((c) => DIGIT_CHARS.indexOf(batCell(state, c) & 0xFFF));
}
function number(state, cells) {
  const d = digits(state, cells);
  return d[0] * 100 + d[1] * 10 + d[2];
}

/* ---- 1: the playable file is the tool's output ------------------------- */

function checkTool() {
  const r = child.spawnSync(process.execPath,
    [path.join(REPO, "tools", "oak-woods-art.js"), "--check"],
    { cwd: REPO, encoding: "utf8" });
  if (r.status === 0) {
    check(/^(PASS|SKIP)/.test((r.stdout || "").trim()),
          "the art tool agrees the playable file is current" +
          (/^SKIP/.test((r.stdout || "").trim())
             ? " (it cannot re-import: the pack is not on this machine)" : ""));
  } else {
    check(false, "the art tool's --check: " + (r.stdout || r.stderr || "").trim());
  }
}

/* ---- 2: the validator -------------------------------------------------- */

function checkBudgets() {
  const rep = validate.validate(source, { songs: [song], frames: 8 });
  check(rep.ok, "the validator accepts the game" +
        (rep.ok ? "" : ": " + (rep.code || "") + " " +
         JSON.stringify(rep.problems)));
  if (!rep.ok || !rep.budgets) return;
  const b = rep.budgets;
  check(b.ratio60 < 1, "frame() fits one 60 Hz video frame (" +
        b.ratio60.toFixed(2) + "x, " + b.hz.toFixed(0) + " Hz, " +
        b.collectionCycles + " cycles)");
  check(b.vram.words <= 32768, "VRAM " + b.vram.words + " words inside 32,768");
  eq("no sprite line overflows", b.spriteOverflowLines, []);
  console.log("  validator: " + b.collectionCycles + " cycles (" +
              b.ratio60.toFixed(2) + "x 60 Hz), VRAM " + b.vram.words +
              " words, " + b.sprites.strips + " strips on the busiest line " +
              "(" + b.sprites.line + ")");
}

/* ---- 3 + 4: play in both runtimes -------------------------------------- */

function scriptedPad(f) {
  const p = {};
  for (const j of JUMPS) if (f >= j && f < j + 3) p.i = true;
  return p;
}

function playTogether(padFn, frames, keep) {
  const a = toys.create(source, { budgetMs: 400, songs: [song] });
  const b = il.create(source, { budgetMs: 400, songs: [song] });
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
      if (!Buffer.from(ga.state[k]).equals(Buffer.from(gb.state[k])))
        diffs.push(k + " @" + f);
    }
    if (!Buffer.from(ga.pixels).equals(Buffer.from(gb.pixels)))
      diffs.push("pixels @" + f);
    if (JSON.stringify(ga.state.regs) !== JSON.stringify(gb.state.regs))
      diffs.push("regs @" + f);
    if (JSON.stringify(ga.raster) !== JSON.stringify(gb.raster))
      diffs.push("raster @" + f);

    records.push({
      f: f,
      score: number(ga.state, HUD_SCORE),
      time: number(ga.state, HUD_TIME),
      /* after the sign (or a lost run) frame() returns at once, so the frame
       * carries no raster entries — an empty table, not a crash */
      raster: ga.raster ? ga.raster.entries.map((e) => ({ line: e.line, bxr: e.bxr })) : [],
      labels: [33, 34, 35, 36, 49, 50, 51, 52, 53].map((c) => batCell(ga.state, c)),
      play: FAR_LINE + 1 < 32 ? batCell(ga.state, FAR_LINE * 32 + 8) : 0,
      playerY: ga.state.sat[0] | (ga.state.sat[1] << 8),
      playerX: ga.state.sat[2] | (ga.state.sat[3] << 8),
    });
    if (keep && keep.includes(f)) kept.set(f, Uint8Array.from(ga.pixels));
  }
  const sound = { events: a.sound.events.length, pcm: a.renderSound(frames) };
  a.dispose();
  b.dispose();
  return { diffs: diffs, records: records, kept: kept, sound: sound };
}

function checkPlay() {
  const keep = [0, 120, 240, 400, 560, 660, 700, 759];
  const run = playTogether(scriptedPad, FRAMES, keep);
  eq("Lua and the IL differ nowhere over " + FRAMES + " frames",
     run.diffs.slice(0, 6), []);

  const r = run.records;
  const last = r[r.length - 1];

  /* the score rises and never falls; the timer falls */
  let mono = true, timerFalls = true;
  for (let i = 1; i < r.length; i++) {
    if (r[i].score < r[i - 1].score) mono = false;
    if (r[i].time > r[i - 1].time) timerFalls = false;
  }
  check(mono, "the score never goes down over the run");
  check(timerFalls, "the timer never goes up over the run");
  check(last.score === WIN_SCORE,
        "the sign ends the run at " + WIN_SCORE + " (four rocks and its ten), " +
        "got " + last.score);
  check(r.some((x) => x.playerY !== 204 + 1),
        "the scripted jumps lift the player off the ground (SAT Y moved)");

  /* the control: the same run with no jump loses the three lives */
  const still = playTogether(() => ({}), FRAMES, null);
  const s = still.records;
  const stillLast = s[s.length - 1];
  check(stillLast.score < WIN_SCORE,
        "with no jump the run does not reach the sign (score " +
        stillLast.score + ")");
  check(s[Math.floor(FRAMES * 0.8)].time === stillLast.time,
        "with no jump the run ends early (the HUD freezes), so the rocks are " +
        "a real hazard");

  /* the split: line 0 holds BXR 0, the three bands move at 1/4, 1/2 and full */
  const f = r[Math.floor(r.length * 0.3)];
  const lines = f.raster.map((e) => e.line);
  eq("the raster table's lines", lines, [0, FAR_LINE, MID_LINE, NEAR_LINE]);
  eq("line 0 keeps the bar still", f.raster[0].bxr, 0);
  check(f.raster[3].bxr !== 0, "the near band's BXR moves with the run");
  check(f.raster[1].bxr !== f.raster[3].bxr,
        "the far band and the near band move at different speeds (" +
        f.raster[1].bxr + " vs " + f.raster[3].bxr + ")");
  /* the bar's label cells are the same in every frame: the six digit cells
   * change on purpose, the labels must not */
  check(r.every((x) => JSON.stringify(x.labels) === JSON.stringify(r[0].labels)),
        "the status bar's labels are the same cells on every frame (the HUD " +
        "redraws its six digit cells only)");
  check(r.some((x) => x.raster.length && x.raster[3].bxr !== 0),
        "the playfield's BXR moves with the run (the BAT itself is fixed)");

  /* 6: the song is audible */
  check(run.sound.events > 0, "the run makes PSG writes (" +
        run.sound.events + ")");
  const pcm = run.sound.pcm.pcm;
  let sum = 0;
  for (const v of pcm) sum += v * v;
  const rms = Math.sqrt(sum / pcm.length);
  check(rms > 0, "the PCM renders non-silent (RMS " + rms.toFixed(1) + "), " +
        "because music() sets the master amplitude — #113's silence is not here");
  console.log("  play: " + FRAMES + " frames, score " + last.score +
              ", timer " + last.time + " s, " + run.sound.events +
              " PSG writes, PCM " + pcm.length + " samples");
  return run;
}

/* ---- 7: the pictures ---------------------------------------------------- */

function crcTable() {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const CRC = crcTable();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const cb = Buffer.alloc(4); cb.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, cb]);
}
function encodePng(rgb, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride)
      .copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from("\x89PNG\r\n\x1a\n", "latin1"),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))]);
}
function decodePng(buf) {
  if (buf.slice(0, 8).toString("latin1") !== "\x89PNG\r\n\x1a\n")
    throw new Error("not a PNG");
  let pos = 8, width = 0, height = 0, idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.slice(pos + 4, pos + 8).toString("latin1");
    const data = buf.slice(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 3;
  const out = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const at = y * (stride + 1) + 1;
    out.set(raw.subarray(at, at + stride), y * stride);
  }
  return { width: width, height: height, pixels: out };
}
function checkPictures(run) {
  fs.mkdirSync(DUMPS, { recursive: true });
  const frames = Array.from(run.kept.keys());
  eq("the kept frames", frames, [0, 120, 240, 400, 560, 660, 700, 759]);
  for (const f of frames) {
    const px = run.kept.get(f);
    const file = path.join(DUMPS, "frame-" + String(f).padStart(3, "0") + ".png");
    fs.writeFileSync(file, encodePng(px, 256, 224));
    const back = decodePng(fs.readFileSync(file));
    check(Buffer.from(back.pixels).equals(Buffer.from(px)),
          "dump " + f + " reads back pixel for pixel");
    let ink = 0;
    for (let i = 3; i < px.length; i += 3)
      if (px[i] !== px[0] || px[i + 1] !== px[1] || px[i + 2] !== px[2]) ink++;
    check(ink > 20000, "dump " + f + " is a picture, not a flat rectangle (" +
          ink + " ink)");
  }
  /* one strip, 2x4 at 2x, the way check-examples lays them out */
  const cols = 2, rows = 4, W = 256 * cols, H = 224 * rows;
  const grid = new Uint8Array(W * H * 3);
  frames.forEach((f, i) => {
    const px = run.kept.get(f);
    const cx = (i % cols) * 256, cy = Math.floor(i / cols) * 224;
    for (let y = 0; y < 224; y++) for (let x = 0; x < 256; x++) {
      const o = (y * 256 + x) * 3, d = ((cy + y) * W + cx + x) * 3;
      grid[d] = px[o]; grid[d + 1] = px[o + 1]; grid[d + 2] = px[o + 2];
    }
  });
  const strip = path.join(DUMPS, "strip.png");
  fs.writeFileSync(strip, encodePng(grid, W, H));
  const back = decodePng(fs.readFileSync(strip));
  check(Buffer.from(back.pixels).equals(Buffer.from(grid)),
        "strip.png reads back pixel for pixel");
}

/* ---- run ---------------------------------------------------------------- */

console.log("== OAK WOODS (#128), " + GAME);
checkTool();
checkBudgets();
const run = checkPlay();
checkPictures(run);

if (failures.length) {
  console.log("FAIL  " + failures.length + " of " + checks + " checks");
  process.exit(1);
}
console.log("PASS  " + checks + " checks · " + FRAMES + " frames · " +
            "Lua == IL · score " + WIN_SCORE + " at the sign · " +
            "art in demo-art/oak-woods");
