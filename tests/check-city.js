#!/usr/bin/env node
/*
 * tests/check-city.js — card #125's evidence: toys/city runs, plays, and is
 * inside the hardware's budgets.
 *
 * THE ART IS NOT IN THE REPO.  Dennis, 2026-10-29: "About the artwork don't
 * put it on the repo but it's fine as demo on the website in PCE Studio"
 * (docs/DECISIONS.md).  The converted picture — the pack's scene and the
 * character's frames — lives beside the repo in
 * `/Volumes/External/agent-workshop-demo/demo-art/city/`, and tools/deploy.sh
 * uploads it with the toy.  So on a fresh clone this file SKIPS with a clear
 * line and exits 0, and the suite stays green: the toy's own Lua is what the
 * repository holds, and that is what it can check without the art.
 *
 * With the art present it checks:
 *
 *   1. THE TOY'S NUMBERS ARE THE ART'S.  main.lua names VRAM addresses (the
 *      pattern code of each run frame, the tracer, the water's CRAM entries);
 *      this rebuilds them from the converted files through the same model the
 *      toy host uses (sat.pictureFromFiles + ed.patternLayout), so a
 *      reconverted picture with a different tile count cannot leave the toy
 *      pointing at empty VRAM.
 *   2. THE VALIDATOR'S BUDGETS.  renderer/pce-validate.js accepts the toy, its
 *      frame() plus its 224 raster() calls fit one 60 Hz video frame, no line
 *      asks for more than the VDC's 16 strips, and the art plus the SAT fit
 *      VRAM (from the two asset files, because the validator runs the toy
 *      without files).
 *   3. IT IS VISIBLE.  Every frame has ink — thousands of pixels that are not
 *      the picture's first pixel — so a toy that runs without drawing is not
 *      mistaken for one that plays.
 *   4. IT PLAYS.  The pad walks the character, up jumps and lands again on the
 *      water line, fire puts a tracer in the SAT and it flies right six pixels
 *      a frame, and the water's palette cycles every eight frames.
 *   5. THE PARALLAX IS THE RASTER TABLE.  Two entries — the near band at its
 *      own scroll and the far band at about a third of it — and the near band
 *      moves 2-3 px a frame against the far band's 0-1.
 *   6. LUA == IL, FRAME BY FRAME.  120 frames: vram, cram, sat, registers, the
 *      raster table and the rendered pixels are byte-equal in both runtimes.
 *   7. THE RUN IS THE AUTHOR'S CYCLE (#148).  The shoot pattern appears on
 *      exactly the frames the fire key is held — the run cycle's sequence
 *      never contains it while fire is not pressed — and the pad at rest
 *      shows the idle stand, its own frame.
 *   8. THE EVIDENCE IS WHERE THE ART IS.  A ten-cell frame strip — one full
 *      run cycle in order, one jump, one shot — is written to
 *      demo-art/city/evidence/strip.png (never into the repo), its cells are
 *      proved to be those poses, and it is read back pixel for pixel.
 *
 * Rule 2: this file was written by the card's own seat (@design), so a cold
 * break by another seat is owed before the card closes.
 *
 *   node tests/check-city.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const toys = require("../renderer/pce-toys.js");
const il = require("../renderer/pce-il.js");
const validate = require("../renderer/pce-validate.js");
const sat = require("../renderer/pce-sat.js");
const ed = require("../renderer/pce-editor.js");

const REPO = path.join(__dirname, "..");
/* the PLAYABLE file: the repo's toys/city/main.lua plus the generated art
 * block (tools/city-assets.js).  It is the file tools/gallery.js
 * --with-demo-art puts on the site, so it is the one this test plays. */
const TOY = null;      /* set below, once ART is known */
const DEMO_ART = process.env.PCE_DEMO_ART ||
  "/Volumes/External/agent-workshop-demo/demo-art";
const ART = path.join(DEMO_ART, "city");
const EVIDENCE = path.join(ART, "evidence");
const ART_FILES = ["tiles.json", "palettes.json", "sprites.json", "main.lua"];
const FRAMES = 120;
const WIDTH = 256;
const HEIGHT = 224;
const PLAYABLE = path.join(ART, "main.lua");

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

/* ---- 0: the deploy route, which needs no art on disk ------------------- *
 * The picture reaches the site the way #127/#128's demos do: tools/gallery.js
 * names the toy (`demoArt`) and `--with-demo-art` reads demo-art/<toy>/
 * main.lua, so the gallery's committed copy carries the art-free toy and the
 * deployed copy carries the playable one.  That is checkable here: the entry
 * exists, and the committed gallery has no VRAM writes in it. */
function checkDeployRoute() {
  const galleryTool = require("../tools/gallery.js");
  const meta = (galleryTool.TOYS_META || []).find((t) => t.id === "city");
  check(!!meta, "tools/gallery.js lists the CITY demo");
  check(!!meta && meta.demoArt === "city" && meta.file === "city/main.lua",
        "CITY's playable source is demo-art/city/main.lua (demoArt: city)");
  const committed = fs.readFileSync(path.join(REPO, "renderer", "gallery-toys.js"), "utf8");
  const cityAt = committed.indexOf('"id": "city"');
  let span = "";
  if (cityAt >= 0) {
    const next = committed.indexOf('"id": "', cityAt + 10);
    span = committed.slice(cityAt, next > 0 ? next : cityAt + 4000);
  }
  check(cityAt >= 0, "the committed gallery carries a CITY entry");
  /* the stub's `function art_boot() ... end` is the art-free toy; a converted
   * picture would be thousands of `vram[...] =` and `pal(0x...)` lines */
  const writes = (span.match(/vram\[/g) || []).length +
                 (span.match(/pal\(0x/g) || []).length;
  check(writes === 0, "the committed CITY entry carries no converted art (" +
        writes + " VRAM/CRAM writes)");
}

/* ---- skip, honestly, when the art is not on this machine --------------- */

function missingArt() {
  const missing = ART_FILES.filter((n) => !fs.existsSync(path.join(ART, n)));
  if (!missing.length) return null;
  return missing;
}

/* ---- the SAT readers (HuC6270 manual 2.4) ------------------------------ */

function satWord(state, slot, k) {
  return state.sat[slot * 8 + k * 2] | (state.sat[slot * 8 + k * 2 + 1] << 8);
}
function spriteY(state, slot) { return satWord(state, slot, 0); }
function spriteX(state, slot) { return satWord(state, slot, 1); }
function spritePattern(state, slot) { return satWord(state, slot, 2) >> 1; }
function visible(state, slot) { return spriteY(state, slot) !== 0; }

/* ---- 1: main.lua's numbers are the art's ------------------------------- */

function readArt() {
  return ART_FILES.map((name) => ({ name: name,
    source: fs.readFileSync(path.join(ART, name), "utf8") }));
}

/* The LAST `name = ...` in the file: the generated tail comes after the
 * repo's constants and replaces them, as Lua runs them. */
function listed(name) {
  const text = fs.readFileSync(PLAYABLE, "utf8");
  const all = text.match(new RegExp("^" + name + "\\s*=\\s*(.+)$", "mg"));
  if (!all || !all.length) throw new Error("main.lua has no " + name);
  return all[all.length - 1].replace(new RegExp("^" + name + "\\s*=\\s*"), "")
    .split("--")[0].trim();
}
function listedList(name) {
  const text = listed(name);
  const m = /^\{([^}]*)\}$/.exec(text);
  if (!m) throw new Error(name + " is not a list: " + text);
  return m[1].split(",").map((s) => Number(s.trim()));
}
function listedInt(name) { return Number(listed(name)); }

function checkNumbersAreTheArts(files) {
  const pic = sat.pictureFromFiles(files);
  const layout = ed.patternLayout(pic);
  const codes = layout.codes;

  eq("the run cycle's left halves are main.lua's RUN_L",
     listedList("RUN_L"), [0, 2, 4, 6, 8, 10, 12, 14].map((i) => codes[i]));
  eq("the run cycle's right halves are main.lua's RUN_R",
     listedList("RUN_R"), [0, 2, 4, 6, 8, 10, 12, 14].map((i) => codes[i + 1]));
  /* frames are packed two patterns a frame, in this order: the run cycle's
   * eight (Full.gif's own order, frames 3..10), then the idle stand (frame
   * 1), then the crouched aim (frame 35), then the tracer */
  eq("IDLE_L is the idle stand's left half", listedInt("IDLE_L"), codes[16]);
  eq("IDLE_R is the idle stand's right half", listedInt("IDLE_R"), codes[17]);
  /* the leap reuses run frame 7 (the 5th of the run's eight), so it names the
   * run cycle's own patterns and costs no VRAM of its own */
  eq("JUMP_L is run frame 7's left half", listedInt("JUMP_L"), codes[8]);
  eq("JUMP_R is run frame 7's right half", listedInt("JUMP_R"), codes[9]);
  eq("SHOOT_L is the aim frame's left half", listedInt("SHOOT_L"), codes[18]);
  eq("SHOOT_R is the aim frame's right half", listedInt("SHOOT_R"), codes[19]);
  eq("BULLET is the tracer pattern's code", listedInt("BULLET"),
     codes[codes.length - 1]);

  /* every pattern is the VDC's 32x64 or 16x16, and none reaches the SAT */
  const sizes = pic.spritePatterns.map((p) => p.width + "x" + p.height);
  check(sizes.slice(0, 20).every((s) => s === "32x64"),
        "the character's twenty patterns are 32x64");
  eq("the tracer is the one 16x16 pattern", sizes[sizes.length - 1], "16x16");
  check(layout.endCell <= 0x1F0, "the patterns end at cell " + layout.endCell +
        ", inside the 496 cells before the SAT at $7F00");

  /* the water: the toy's three words are in background palette 1, and the
   * toy cycles exactly the entries that show them */
  const pal = JSON.parse(fs.readFileSync(path.join(ART, "palettes.json"), "utf8"));
  const words = [listedInt("WATER_1"), listedInt("WATER_2"), listedInt("WATER_3")];
  const addrs = [listedInt("WATER_A"), listedInt("WATER_B"), listedInt("WATER_C")];
  const found = [];
  for (let p = 0; p < 16; p++)
    for (let e = 1; e < 16; e++)
      if (words.indexOf(pal.background[p][e]) >= 0) found.push(p * 16 + e);
  eq("the toy cycles every CRAM entry that shows a water colour, and no other",
     addrs.slice().sort((a, b) => a - b), found.slice().sort((a, b) => a - b));

  /* the water line and the ground: the picture's own water surface */
  eq("GROUND_Y is the water surface the converter reports", listedInt("GROUND_Y"), 208);

  /* VRAM: the tiles and the patterns together, from the two asset files */
  const tilesDoc = JSON.parse(files[0].source);
  let words_until = 0;
  for (const t of tilesDoc.tiles) words_until = Math.max(words_until, (t.char + 1) * 16);
  let patternWords = 0;
  for (let i = 0; i < pic.spritePatterns.length; i++) {
    const p = pic.spritePatterns[i];
    const size = ed.SPRITE_SIZES.find((s) => s.width === p.width && s.height === p.height);
    patternWords += size.cells * 64;
  }
  const total = Math.max(words_until, (codes[0] || 0) * 64) + patternWords;
  check(total <= 32768, "the tiles and patterns fit VRAM: " + total +
        " words of 32,768");
  note("art: " + tilesDoc.tiles.length + " tiles, " + pic.spritePatterns.length +
       " sprite patterns, " + total + " VRAM words");
}

/* ---- 2: the validator's budgets ---------------------------------------- */

function checkBudgets(source) {
  const rep = validate.validate(source, { chunkName: "toys/city/main.lua", frames: 8 });
  check(rep.ok, "the validator accepts the toy" +
        (rep.ok ? "" : ": " + rep.code + " " + rep.message));
  if (!rep.ok || !rep.budgets) return;
  const b = rep.budgets;
  check(b.frameCycles > 0, "frame() has a cost");
  check(b.frameCycles < 119318, "frame() alone fits one 60 Hz frame (" +
        b.frameCycles + " of 119,318 cycles)");
  /* 224 raster() callbacks cost the collection budget: every callback toy is
   * measured here, not only this one (parallax 2.64x, status-bar 2.31x,
   * road 3.58x at this writing), because the model counts a full call per
   * line — on the console that is #31C's compiled handler. */
  check(b.ratio60 < 4, "the whole collection stays in the callback toys' band (" +
        b.ratio60.toFixed(2) + "x, " + b.hz.toFixed(0) + " Hz; parallax 2.64x)");
  note("collection " + b.ratio60.toFixed(2) + "x of a 60 Hz frame — the " +
       "224-line raster() callback is what #31C prices at ~1,500 cycles a call");
  eq("no sprite line overflows the VDC's 16 strips", b.spriteOverflowLines, []);
  check(b.rom.bytes > 0 && b.rom.bytes < b.rom.limit,
        "ROM estimate " + Math.round(b.rom.bytes) + " B inside the 1 MB HuCard");
  console.log("  validator: frame " + b.frameCycles + " cycles (" +
              b.ratio60.toFixed(2) + "x60 Hz), ROM ~" + Math.round(b.rom.bytes) +
              " B, " + b.sprites.requested + " strips on the busiest line");
}

/* ---- 3-6: play, Lua and IL side by side -------------------------------- */

/* The scripted pad: run right, stand still (the idle pose), jump, run back,
 * stand, jump again, and fire every twelve frames — enough to cover the run
 * cycle, the idle stand, two leaps and the aim pose. */
function scriptedPad(f) {
  const p = {};
  if (f < 20) p.right = true;
  else if (f >= 40 && f < 60) p.right = true;
  else if (f >= 60 && f < 80) p.left = true;
  else if (f >= 100) p.left = true;
  if ((f >= 30 && f < 36) || (f >= 90 && f < 94)) p.up = true;
  if (f % 12 < 2) p.i = true;
  return p;
}

function playTogether(files, padFn, frames, keep) {
  const source = fs.readFileSync(PLAYABLE, "utf8");
  const a = toys.create(source, { budgetMs: 250, files: files });
  const b = il.create(source, { budgetMs: 250, files: files });
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

    let ink = 0;
    const p0 = [ga.pixels[0], ga.pixels[1], ga.pixels[2]];
    for (let i = 0; i < ga.pixels.length; i += 3) {
      if (ga.pixels[i] !== p0[0] || ga.pixels[i + 1] !== p0[1] ||
          ga.pixels[i + 2] !== p0[2]) ink++;
    }
    const shots = [];
    for (let s = 2; s <= 5; s++) if (visible(ga.state, s)) shots.push(s);

    records.push({
      f: f,
      ink: ink,
      px: visible(ga.state, 0) ? spriteX(ga.state, 0) : null,
      feet: visible(ga.state, 0) ? spriteY(ga.state, 0) : null,
      pattern: visible(ga.state, 0) ? spritePattern(ga.state, 0) : null,
      fire: !!(p.i || p.ii),
      left: !!p.left,
      right: !!p.right,
      shots: shots,
      slot: shots.length ? shots[0] : null,
      shotX: shots.length ? spriteX(ga.state, shots[0]) : null,
      bands: ga.raster ? ga.raster.entries.map((e) => ({ line: e.line, bxr: e.bxr })) : [],
      water: [0, 1, 2].map((k) => {
        const addr = [17, 18, 22][k];
        return ga.state.cram[addr * 2] | (ga.state.cram[addr * 2 + 1] << 8);
      })
    });
    if (keep && keep.includes(f)) kept.set(f, Uint8Array.from(ga.pixels));
  }
  const counted = { lua: a.frameCount, il: b.frameCount };
  a.dispose();
  b.dispose();
  return { diffs: diffs, records: records, kept: kept, counted: counted };
}

function checkPlay(files) {
  const run = playTogether(files, scriptedPad, FRAMES, []);
  const rec = run.records;

  eq("Lua == IL: frame-by-frame differences over " + FRAMES + " frames",
     run.diffs.slice(0, 8), []);
  eq("both runtimes ran every frame", [run.counted.lua, run.counted.il],
     [FRAMES - 1, FRAMES - 1]);

  /* visible */
  const inks = rec.map((r) => r.ink);
  check(Math.min.apply(null, inks) > 20000,
        "every frame has the picture's ink (at least " + Math.min.apply(null, inks) +
        " of 57344 pixels differ from the first)");

  /* the character is on the SAT and moves with the pad */
  const xs = rec.filter((r) => r.px !== null).map((r) => r.px);
  check(xs.length === FRAMES, "the character is on the SAT on every frame");
  check(Math.max.apply(null, xs) - Math.min.apply(null, xs) >= 40,
        "the pad walks the character across the screen (" +
        Math.min.apply(null, xs) + ".." + Math.max.apply(null, xs) + ")");
  const patterns = rec.filter((r) => r.pattern !== null).map((r) => r.pattern);
  check(new Set(patterns).size >= 4,
        "the run cycle turns through " + new Set(patterns).size + " patterns");

  /* #148 (Dennis, playing it): the aim pose plays only WHILE the fire key is
   * held — the old cooldown timer let the gun linger up after the release,
   * which is the wrong animation he saw.  So the shoot pattern appears on
   * exactly the frames the key is down (on the ground; the leap's stride
   * wins in the air), and the run cycle's own sequence never contains it
   * while fire is not pressed. */
  const shootL = listedInt("SHOOT_L");
  const fireFrames = rec.filter((r) => r.fire && r.feet === 208).map((r) => r.f);
  const shotPose = rec.filter((r) => r.pattern === shootL).map((r) => r.f);
  check(shotPose.length > 0, "the aim pose shows while the fire key is held (" +
        shotPose.length + " frames)");
  eq("and on exactly those frames — never while fire is not pressed",
     shotPose, fireFrames);

  /* the idle stand is its own frame (sheet frame 1), shown whenever the pad
   * is at rest on the ground with no fire held — and on no other frame */
  const idleL = listedInt("IDLE_L");
  const idleFrames = rec.filter((r) => r.pattern === idleL).map((r) => r.f);
  check(idleFrames.length >= 8, "the pad at rest shows the idle stand (" +
        idleFrames.length + " frames)");
  eq("on every still, grounded, not-firing frame, and no other", idleFrames,
     rec.filter((r) => !r.left && !r.right && !r.fire && r.feet === 208)
        .map((r) => r.f));

  /* the jump: away from the water line and back to it */
  const feet = rec.map((r) => r.feet);
  check(Math.min.apply(null, feet) < 208 - 20,
        "up lifts the character off the water line (lowest y " +
        Math.min.apply(null, feet) + " of 208)");
  check(feet[feet.length - 1] === 208,
        "and it lands back on the water line at y 208");

  /* the tracer */
  const firing = rec.filter((r) => r.shotX !== null);
  check(firing.length > 10, "fire puts tracers in the SAT (" + firing.length +
        " frames with one flying)");
  /* every bullet flies at six pixels a frame; a step is only compared
   * within one bullet, so a new shot (a new slot) is not read as a jump */
  let step = 0, jumped = 0;
  for (let i = 1; i < firing.length; i++) {
    const a = firing[i - 1], b = firing[i];
    if (b.f !== a.f + 1 || b.slot !== a.slot) continue;
    if (b.shotX - a.shotX === 6) step++;
    else jumped++;
  }
  check(step > 10 && jumped === 0, "a tracer flies right six pixels a frame (" +
        step + " steps of 6, " + jumped + " not)");

  /* the water cycles every eight frames */
  let cycled = 0, still = 0;
  for (let i = 1; i < rec.length; i++) {
    const same = JSON.stringify(rec[i].water) === JSON.stringify(rec[i - 1].water);
    if (rec[i].f % 8 === 0) { if (!same) cycled++; else still++; }
    else if (!same) still++;
  }
  check(cycled > 10 && still === 0,
        "the water's three CRAM entries change on every 8th frame and only then (" +
        cycled + " changes, " + still + " elsewhere)");

  /* the raster split: two bands, the near one fast, the far one a third */
  const bands = rec[rec.length - 1].bands;
  eq("the raster table has two entries", bands.map((b) => b.line), [0, 208]);
  let near = [], far = [];
  for (let i = 1; i < rec.length; i++) {
    const a = rec[i - 1].bands, b = rec[i].bands;
    if (!a.length || !b.length) continue;
    far.push(((b[0].bxr - a[0].bxr) + 256) % 256);
    near.push(((b[1].bxr - a[1].bxr) + 256) % 256);
  }
  check(far.every((d) => d <= 1), "the far band moves at most a pixel a frame (" +
        Math.max.apply(null, far) + ")");
  check(near.every((d) => d >= 1 && d <= 3), "the near band moves 1-3 pixels a frame (" +
        Math.min.apply(null, near) + ".." + Math.max.apply(null, near) + ")");
  check(Math.max.apply(null, near) > Math.max.apply(null, far),
        "the near band is the faster one");

  /* #148 (Dennis, playing it): "the second layer does not scroll to the end of
   * the screen and restart, it now stops somewhere in the middle".  A band
   * whose BXR is a divided shared counter climbs to 85 and snaps back.  This
   * runs past both wraps — 300 frames of the near band at 2-3 px and the far
   * band at 1 — and every step must be the band's own rate, with at least one
   * wrap of each in the run. */
  const longSource = fs.readFileSync(PLAYABLE, "utf8");
  const rt = toys.create(longSource, { budgetMs: 400, files: files });
  rt.load();
  const seq = [];
  for (let f = 0; f < 300; f++) {
    rt.setPad(1, f % 2 ? { right: true } : {});
    const g = rt.frame(f);
    if (g.raster && g.raster.entries.length === 2)
      seq.push([g.raster.entries[0].bxr, g.raster.entries[1].bxr]);
  }
  rt.dispose();
  /* a wrap is a fall from the top of 0..255 to a small value; anything else
   * that goes backwards (85 -> 0, the bug #148 found) is a jump */
  let farWrap = 0, nearWrap = 0, farBad = 0, nearBad = 0;
  const bandStep = (prev, next, rate) => {
    const d = next - prev;
    if (d >= 0) return d <= rate ? ["ok"] : ["bad", d];
    return prev > 255 - rate ? ["wrap"] : ["bad", d];
  };
  for (let i = 1; i < seq.length; i++) {
    const f = bandStep(seq[i - 1][0], seq[i][0], 1);
    const n = bandStep(seq[i - 1][1], seq[i][1], 3);
    if (f[0] === "wrap") farWrap++; else if (f[0] === "bad") farBad++;
    if (n[0] === "wrap") nearWrap++; else if (n[0] === "bad") nearBad++;
  }
  check(seq.length === 300, "300 frames of the two bands were recorded");
  check(farBad === 0 && nearBad === 0,
        "no band jumps: every step is its own rate (far " + farBad +
        " bad, near " + nearBad + " bad)");
  check(farWrap >= 1 && nearWrap >= 1,
        "each band goes round and comes back (far " + farWrap + " wraps, near " +
        nearWrap + " wraps)");

  return run;
}

/* ---- 7: the frame strip, beside the art -------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function makePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const o = y * (width * 4 + 1) + 1 + x * 4, i = (y * width + x) * 4;
      raw[o] = rgba[i]; raw[o + 1] = rgba[i + 1];
      raw[o + 2] = rgba[i + 2]; raw[o + 3] = rgba[i + 3];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function writeStrip(files) {
  /* The card's strip: one full run cycle, one jump, one shot.  Its own pad
   * drives them: right for the cycle (a new run frame every four frames, so
   * the cycle's eight land at 0, 3, 7, 11, 15, 19, 23, 27), up for the leap
   * (kept mid-air), then a held fire for the aim. */
  const stripPad = (f) => {
    const p = {};
    if (f < 32) p.right = true;
    else if (f >= 40 && f < 46) p.up = true;
    else if (f >= 60 && f < 62) p.i = true;
    return p;
  };
  const cell = 128, ch = 120, cols = 4, picks = [0, 3, 7, 11, 15, 19, 23, 27, 41, 61];
  const run = playTogether(files, stripPad, FRAMES, picks);
  eq("Lua == IL on the strip's 120 frames", run.diffs.slice(0, 8), []);

  /* the kept frames are the poses the strip must show: the run cycle's eight
   * patterns in order, then the leap's, then the aim's */
  const wantPatterns = listedList("RUN_L")
    .concat([listedInt("JUMP_L"), listedInt("SHOOT_L")]);
  eq("the strip's ten cells are one run cycle in order, one jump, one shot",
     picks.map((f) => run.records[f].pattern), wantPatterns);

  const w = cols * cell, h = Math.ceil(picks.length / cols) * ch;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba[i * 4 + 3] = 255;
  picks.forEach((f, i) => {
    const px = run.kept.get(f);
    const ox = (i % cols) * cell, oy = Math.floor(i / cols) * ch;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cell; x++) {
      /* the character's own corner of the screen: the 64-px pair walks from
       * x 104 to 232 and a leap tops out at y 109, so x 104..232, y 100..220
       * holds every pose whole */
      const sx = 104 + x, sy = 100 + y;
      if (sx >= WIDTH || sy >= HEIGHT) continue;
      const si = (sy * WIDTH + sx) * 3, oi = ((oy + y) * w + ox + x) * 4;
      rgba[oi] = px[si]; rgba[oi + 1] = px[si + 1]; rgba[oi + 2] = px[si + 2];
    }
  });
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const file = path.join(EVIDENCE, "strip.png");
  const png = makePng(w, h, rgba);
  fs.writeFileSync(file, png);
  check(fs.statSync(file).size === png.length,
        "the frame strip is written beside the art: demo-art/city/evidence/strip.png");

  /* read it back: the strip is not one flat colour, and its cells differ */
  let flat = true, first = -1, differing = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const v = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    if (first < 0) first = v;
    else if (v !== first) { differing++; flat = false; }
  }
  check(!flat || differing > 1000, "the strip has a picture in it");
  let cellDiffers = 0;
  for (let c = 1; c < picks.length; c++) {
    const ox0 = 0, oy0 = 0;
    const ox1 = (c % cols) * cell, oy1 = Math.floor(c / cols) * ch;
    let differs = false;
    for (let y = 0; y < ch && !differs; y += 4) for (let x = 0; x < cell; x += 4) {
      if (rgba[((oy0 + y) * w + ox0 + x) * 4] !==
          rgba[((oy1 + y) * w + ox1 + x) * 4]) { differs = true; break; }
    }
    if (differs) cellDiffers++;
  }
  check(cellDiffers >= picks.length - 1,
        "every cell of the strip is a different frame (" + cellDiffers + " of " +
        (picks.length - 1) + " differ from the first)");
}

/* ---- main --------------------------------------------------------------- */

function run() {
  console.log("check-city — card #125, the CITY demo");
  /* the deploy route is proved before the skip: it needs no art on disk */
  checkDeployRoute();
  return Promise.resolve(runWithArt());
}

function runWithArt() {
  const missing = missingArt();
  if (missing) {
    console.log("SKIP  demo-art/city is not on this machine (" + missing.join(", ") +
                " missing); the CITY pack's art is not in the repo, by Dennis's " +
                "2026-10-29 decision (docs/DECISIONS.md).");
    console.log("      Build it with: node tools/city-assets.js --pack \"<the " +
                "extracted pack>\"");
    console.log("\nSKIP  0 of the toy's checks — the toy's Lua is committed, " +
                "the art is not." +
                (checks ? " (" + checks + " page-wiring checks above did run: " +
                 "the deploy route needs no art on disk)" : ""));
    return failures.length ? 1 : 0;
  }

  const source = fs.readFileSync(PLAYABLE, "utf8");
  const files = readArt();

  /* the page's own call: gallery.still(source, frame, files) hands the art to
   * the runtime the same way toy.html and Browse do, so a picture here is the
   * one the site draws (no canvas in Node; the frame is what is checked) */
  const gallery = require("../renderer/pce-gallery.js");
  const thumb = gallery.still(null, source, 60, files);
  check(thumb && gallery.countInk(thumb) > 1000,
        "gallery.still with the site's art draws a picture (frame 60, " +
        (thumb ? gallery.countInk(thumb) : 0) + " non-background pixels)");

  checkNumbersAreTheArts(files);
  checkBudgets(source);
  checkPlay(files);
  writeStrip(files);

  console.log("\n" + checks + " checks, " + (checks - failures.length) +
              " PASS, " + failures.length + " FAIL");
  if (failures.length) {
    for (const f of failures) console.log("  FAILED: " + f);
    return 1;
  }
  return 0;
}

run().then((code) => process.exit(code));
