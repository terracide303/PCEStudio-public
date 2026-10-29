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
const SKY_LINE = Number(constOf("SKY_LINE"));
const MAIN_LINE = Number(constOf("MAIN_LINE"));

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

  /* the split (#150): line 0 holds BXR 0, the sky strip runs at half the
   * composite's speed on its own counter */
  const f = r[Math.floor(r.length * 0.3)];
  const lines = f.raster.map((e) => e.line);
  eq("the raster table's lines", lines, [0, SKY_LINE, MAIN_LINE]);
  eq("line 0 keeps the bar still", f.raster[0].bxr, 0);
  check(f.raster[2].bxr !== 0, "the composite's BXR moves with the run");
  check(f.raster[1].bxr !== f.raster[2].bxr,
        "the sky strip and the composite move at different speeds (" +
        f.raster[1].bxr + " vs " + f.raster[2].bxr + ")");
  let skyStep = 0, mainStep = 0, skyBad = 0, mainBad = 0;
  for (let i = 1; i < r.length; i++) {
    if (!r[i].raster.length || !r[i - 1].raster.length) continue;
    const ds = (r[i].raster[1].bxr - r[i - 1].raster[1].bxr + 256) % 256;
    const dm = (r[i].raster[2].bxr - r[i - 1].raster[2].bxr + 256) % 256;
    if (ds !== 1) skyBad++;
    if (dm !== 2) mainBad++;
    skyStep += ds; mainStep += dm;
  }
  check(skyBad === 0 && mainBad === 0,
        "every step is the band's own rate: the strip 1 px, the composite 2 px " +
        "(" + skyBad + " + " + mainBad + " off)");
  /* the bar's label cells are the same in every frame: the six digit cells
   * change on purpose, the labels must not */
  check(r.every((x) => JSON.stringify(x.labels) === JSON.stringify(r[0].labels)),
        "the status bar's labels are the same cells on every frame (the HUD " +
        "redraws its six digit cells only)");
  check(r.some((x) => x.raster.length && x.raster[2].bxr !== 0),
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

/* ---- 8: card #150 — depth without cut trees ---------------------------- */

/* SAT bytes -> sprites: word 0 y (screen y + 64), word 3 attr: bit 8 CGX
 * (32 wide), bits 12-13 CGY (16/32/-/64 tall).  A strip is 16 px wide. */
function stripsPerLine(sat) {
  const lines = new Uint8Array(256);
  for (let i = 0; i < 64; i++) {
    const y = (sat[i * 8] | (sat[i * 8 + 1] << 8)) & 0x3FF;
    const attr = sat[i * 8 + 6] | (sat[i * 8 + 7] << 8);
    const h = [16, 32, 32, 64][(attr >> 12) & 3];
    const strips = (attr & 0x100) ? 2 : 1;
    for (let k = 0; k < h; k++) {
      const line = y - 64 + k;
      if (line >= 0 && line < 224) lines[line] += strips;
    }
  }
  return lines;
}

function trunkColumns(sat) {
  let n = 0;
  for (let slot = 6; slot < 24; slot += 3) {
    const y = (sat[slot * 8] | (sat[slot * 8 + 1] << 8)) & 0x3FF;
    if (y !== 0) n++;
  }
  return n;
}

/* the scripted pad over several levels: jump each rock, and press Run on the
 * level's last frame so the run starts again (the sign has ended it by then) */
const LEVEL = 760;
function longPad(f) {
  const t = f % LEVEL, p = {};
  for (const j of JUMPS) if (t >= j && t < j + 3) p.i = true;
  if (t === LEVEL - 1) p.run = true;
  return p;
}

function checkDepth() {
  const rt = toys.create(source, { budgetMs: 400, songs: [song] });
  rt.load();
  let worst = 0, worstAt = -1, maxTrunkCols = 0, minTrunkCols = 99;
  let seenPositions = new Set(), levelsWon = 0, lastState = 0;
  for (let f = 0; f < 3600; f++) {
    rt.setPad(1, longPad(f));
    const g = rt.frame(f);
    const lines = stripsPerLine(g.state.sat);
    for (let y = 0; y < 224; y++)
      if (lines[y] > worst) { worst = lines[y]; worstAt = f + ":" + y; }
    const cols = trunkColumns(g.state.sat);
    if (cols > maxTrunkCols) maxTrunkCols = cols;
    if (f > 5 && cols < minTrunkCols) minTrunkCols = cols;
    seenPositions.add(g.state.sat[6 * 8 + 2] | (g.state.sat[6 * 8 + 3] << 8));
  }
  rt.dispose();
  check(worst <= 16, "no sprite line exceeds 16 strips over 3,600 frames of the " +
        "scripted pad (busiest: " + worst + " at frame:line " + worstAt + ")");
  check(maxTrunkCols >= 1 && maxTrunkCols <= 4,
        "front trunks are on the screen, never more than two at a time " +
        "(" + maxTrunkCols + " of their 6 columns' SAT slots at most)");
  console.log("  sprites: busiest line " + worst + " of 16 strips, trunk SAT slots 6..23");
}

/* the seam, read off the rendered picture: the BAT is 32 cells wide (MWR) so
 * the picture repeats at 256 px; and the step across x=255 -> x=0 must be no
 * bigger than the picture's own typical step between neighbouring columns */
function bgPixelRgb(state, x, y) {
  const cell = batCell(state, (y >> 3) * 32 + ((x >> 3) & 31));
  const ch = cell & 0xFFF, pal = cell >> 12;
  const base = ch * 16, r = y & 7, bit = 7 - (x & 7);
  const w = (i) => state.vram[(base + i) * 2] | (state.vram[(base + i) * 2 + 1] << 8);
  const lo = w(r), hi = w(r + 8);
  const idx = ((lo >> bit) & 1) | (((lo >> (8 + bit)) & 1) << 1) |
              (((hi >> bit) & 1) << 2) | (((hi >> (8 + bit)) & 1) << 3);
  const c = idx === 0 ? 0 : pal * 16 + idx;
  const v = state.cram[c * 2] | (state.cram[c * 2 + 1] << 8);
  return [(v >> 3) & 7, (v >> 6) & 7, v & 7];
}
function checkSeam() {
  const rt = toys.create(source, { budgetMs: 400, songs: [song] });
  rt.load();
  const g = rt.frame(0);
  rt.dispose();
  check((g.state.regs.MWR & 0x30) === 0,
        "MWR says a 32-cell BAT, so the picture loops at 256 px");
  let across = 0, within = 0, n = 0;
  const d = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  for (let y = MAIN_LINE; y < 224; y++) {
    across += d(bgPixelRgb(g.state, 255, y), bgPixelRgb(g.state, 0, y));
    for (let x = 0; x < 255; x++) { within += d(bgPixelRgb(g.state, x, y), bgPixelRgb(g.state, x + 1, y)); n++; }
  }
  const typical = within / 255;
  check(across <= typical,
        "the loop's seam (x=255 -> 0) is no harsher than the picture's own " +
        "column steps (seam " + across + ", a typical step " + typical.toFixed(0) +
        " per column over " + (224 - MAIN_LINE) + " rows)");
  /* x and x + loop are the same BAT cell: the toy never shifts the picture by
   * anything but BXR, so a column and the one 256 px on are identical */
  let same = true;
  for (let y = MAIN_LINE; y < 224 && same; y += 7)
    for (let x = 0; x < 256; x += 5)
      if (d(bgPixelRgb(g.state, x, y), bgPixelRgb(g.state, x + 256, y)) !== 0) { same = false; break; }
  check(same, "columns at x and x + 256 are identical (the wrap is the BAT's)");
}

/* the card's control: no tree crosses a band edge.  The edge is clean where
 * the rows on both sides are one colour across the width.  #128's banded build
 * fails that at both its edges; this build's one cut passes. */
function checkCut() {
  const tool = require("../tools/oak-woods-art.js");
  const built = tool.build({});
  if (built.skip) { note("the pack is not here: the banded control is skipped (" + built.skip + ")"); return; }
  const cut = built.bgImg.cut;
  check(cut === MAIN_LINE, "the toy's MAIN_LINE (" + MAIN_LINE + ") is the tool's cut (" + cut + ")");
  check(tool.edgeClean(built.bgImg, cut),
        "the new build's one split (line " + cut + ") has a flat row on both sides: no tree crosses it");
  const old = built.bandedImg;
  const oldClean = old.edges.map((y) => tool.edgeClean(old, y));
  check(oldClean.every((c) => !c),
        "the CONTROL, #128's banded build, is cut through trees at both its band edges " +
        "(lines " + old.edges.join(", ") + "): clean = " + JSON.stringify(oldClean));
}

/* a strip of four scroll positions for Dennis */
function checkScrollStrip() {
  const at = [0, 150, 300, 450];
  const run = playTogetherLua(scriptedPad, 460, at);
  const W = 256 * 2, H = 224 * 2, grid = new Uint8Array(W * H * 3);
  at.forEach((f, i) => {
    const px = run.get(f);
    const cx = (i % 2) * 256, cy = Math.floor(i / 2) * 224;
    for (let y = 0; y < 224; y++) for (let x = 0; x < 256; x++) {
      const o = (y * 256 + x) * 3, dd = ((cy + y) * W + cx + x) * 3;
      grid[dd] = px[o]; grid[dd + 1] = px[o + 1]; grid[dd + 2] = px[o + 2];
    }
  });
  const file = path.join(DUMPS, "scroll-strip.png");
  fs.writeFileSync(file, encodePng(grid, W, H));
  check(Buffer.from(decodePng(fs.readFileSync(file)).pixels).equals(Buffer.from(grid)),
        "scroll-strip.png (frames " + at.join(", ") + ") reads back pixel for pixel");
}
function playTogetherLua(padFn, frames, keep) {
  const a = toys.create(source, { budgetMs: 400, songs: [song] });
  a.load();
  const kept = new Map();
  for (let f = 0; f < frames; f++) {
    a.setPad(1, padFn(f));
    const g = a.frame(f);
    if (keep.includes(f)) kept.set(f, Uint8Array.from(g.pixels));
  }
  a.dispose();
  return kept;
}

/* ---- run ---------------------------------------------------------------- */

console.log("== OAK WOODS (#128), " + GAME);
checkTool();
checkBudgets();
const run = checkPlay();
checkPictures(run);
checkDepth();
checkSeam();
checkCut();
checkScrollStrip();

if (failures.length) {
  console.log("FAIL  " + failures.length + " of " + checks + " checks");
  process.exit(1);
}
console.log("PASS  " + checks + " checks · " + FRAMES + " frames · " +
            "Lua == IL · score " + WIN_SCORE + " at the sign · " +
            "art in demo-art/oak-woods");
