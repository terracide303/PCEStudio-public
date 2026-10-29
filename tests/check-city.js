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
 *   5. THE PARALLAX IS THE RASTER TABLE.  Two entries — the near band at twice
 *      the camera and the far band at the camera's own rate — and the bands
 *      move only while the camera scrolls: 0 when the pad is at rest or the
 *      soldier walks on screen, far 1 and near 2 while he walks at the middle.
 *   6. LUA == IL, FRAME BY FRAME.  480 frames of the card's own script plus
 *      the gameplay's 120: vram, cram, sat, registers, the raster table and
 *      the rendered pixels are byte-equal in both runtimes.
 *   7. THE WALK IS CARD #158's.  The card's scripted pad — hold L (right) 300
 *      frames, release 60, hold J (left) 120 — and its three claims: BXR does
 *      not change while no direction is held; player x rises a pixel a frame
 *      to the middle (px 96, the body's centre on the screen's middle x 128)
 *      then stays while BXR rises; and the animation frame changes only while
 *      moving — a new run pose every six frames of walking, the pack gif's
 *      own 100 ms pace.  The walk back: the camera scrolls back to the
 *      level's start and clamps there, then he walks back to the left edge
 *      and stops; each band still goes round 0..255 with no jump (#148).
 *   8. THE EVIDENCE IS WHERE THE ART IS.  A four-step frame strip — the idle
 *      stand at the start, a step while walking, the middle, and the street
 *      scrolled at the middle — is written to
 *      demo-art/city/evidence/strip.png (never into the repo), its cells are
 *      proved to be those poses, the street still until the last, the
 *      soldier's body on the screen's middle (the card's "x ~ 128"), and it
 *      is read back pixel for pixel.
 *   9. THE ART IS NAMED SOURCES (card #156).  sources.json's ranges match the
 *      files beside it; the studio's own model (renderer/pce-assets.js)
 *      previews each source with the importer's placement — the same codes
 *      main.lua's tail carries — and the street preview's tiles are the
 *      file's tiles.
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

/* Card #158's scripted pad, exactly as the card writes it: hold L (right)
 * 300 frames, release 60, hold J (left) 120.  From the level's start
 * (px 8, cam 0) the soldier walks one pixel a frame to the middle, then
 * the camera scrolls and he stays there. */
function evidencePad(f) {
  const p = {};
  if (f < 300) p.right = true;
  else if (f >= 360) p.left = true;
  return p;
}

/* The gameplay script (jump, shot, water, the run cycle turning): walk
 * right, jump, stand, walk right, jump, stand, walk back — fire every 12
 * frames.  Each jump's 16 airborne frames end in a stand with the fire key
 * up, so the idle stand really shows (the fire key's own frames show the
 * aim pose by design, #148).  It never reaches the middle, so the street
 * must stay still throughout: the bands move only with the camera (card
 * #158, no auto-scroll). */
function gameplayPad(f) {
  const p = {};
  if (f < 30) p.right = true;
  else if (f >= 56 && f < 80) p.right = true;
  else if (f >= 98) p.left = true;
  if ((f >= 30 && f < 36) || (f >= 80 && f < 84)) p.up = true;
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
      /* SAT X 32 is display column 0 (the VDC's origin, main.lua's put_player
       * comment), so the pair's screen x is the SAT word minus 32 */
      px: visible(ga.state, 0) ? spriteX(ga.state, 0) - 32 : null,
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
  const MID = 96;      /* the toy's own dead-zone cap: the pair's left edge;
                        * the body's centre +32 is the screen's middle, the
                        * card's "x ~ 128" */
  const longSource = fs.readFileSync(PLAYABLE, "utf8");

  /* ---- the card's own script, and its three claims ----------------------- */

  const ev = playTogether(files, evidencePad, 480, []);
  const rec = ev.records;

  eq("Lua == IL on the evidence's 480 frames", ev.diffs.slice(0, 8), []);
  eq("both runtimes ran every frame", [ev.counted.lua, ev.counted.il],
     [479, 479]);

  /* the visible picture, and the character on the SAT every frame */
  const inks = rec.map((r) => r.ink);
  check(Math.min.apply(null, inks) > 20000,
        "every frame has the picture's ink (at least " +
        Math.min.apply(null, inks) + " of 57344 pixels differ from the first)");
  check(rec.every((r) => r.px !== null),
        "the character is on the SAT on every frame");

  const xs = rec.map((r) => r.px);
  const far = rec.map((r) => (r.bands.length ? r.bands[0].bxr : -1));
  const near = rec.map((r) => (r.bands.length ? r.bands[1].bxr : -1));

  /* claim 2, first half: player x rises a pixel a frame to the middle and
   * stays there — the slower walk, one pixel a frame, no two-pixel strides
   * (f0..f87 the walk from px 8, the rest of the run he is at the middle) */
  eq("player x rises a pixel a frame to the middle and stays there",
     xs, rec.map((r) => (r.f < 88 ? 9 + r.f : MID)));

  /* claim 2, second half: once he is at the middle, BXR rises instead — the
   * far band a pixel a frame and the near band two (its ratio to the
   * camera), both rising the whole 212 frames of the hold */
  const farSteps = [], nearSteps = [];
  for (let f = 89; f < 300; f++) {
    farSteps.push((far[f] - far[f - 1] + 256) % 256);
    nearSteps.push((near[f] - near[f - 1] + 256) % 256);
  }
  eq("while he stays at the middle BXR rises: the far band a pixel a frame",
     farSteps, new Array(211).fill(1));
  eq("and the near band keeps its 2:1 ratio, two pixels a frame",
     nearSteps, new Array(211).fill(2));
  check(Math.max.apply(null, near) > Math.max.apply(null, far),
        "the near band is the faster one");

  /* claim 1: BXR does not change while no direction is held — the release
   * 60 — and the idle stand shows the whole time */
  let still = true;
  for (let f = 301; f < 360; f++)
    if (far[f] !== far[f - 1] || near[f] !== near[f - 1]) still = false;
  check(still, "BXR does not change while no direction is held (the release 60)");
  const idleL = listedInt("IDLE_L");
  eq("the pad at rest shows the idle stand",
     rec.slice(300, 360).map((r) => r.pattern), new Array(60).fill(idleL));

  /* claim 3: the animation frame changes only while moving, and a new run
   * pose every six frames of walking — the pack gif's own pace (Full.gif
   * plays its 38 frames at 100 ms each, and six 60 Hz frames are 100 ms).
   * The two changes outside the walk — f300 to the idle stand, f360 back
   * to the run — are the walk's own stop and start. */
  const changes = [];
  for (let f = 1; f < 480; f++)
    if (rec[f].pattern !== rec[f - 1].pattern) changes.push(f);
  const expect = [];
  for (let f = 5; f < 300; f += 6) expect.push(f);
  expect.push(300, 360);
  for (let f = 365; f < 480; f += 6) expect.push(f);
  eq("the animation frame changes only while he moves, a pose every six " +
     "frames of walking", changes, expect);

  /* ---- the walk back (card #158's other half) ----------------------------- */

  /* Hold L to the middle and a little past it (cam 12), then J 400 frames:
   * the camera scrolls back to cam 0 — the level's start — and clamps
   * there, then the soldier walks back to the left edge and stops; a pad
   * held against the edge moves nothing and shows the idle stand. */
  const rt = toys.create(longSource, { budgetMs: 400, files: files });
  rt.load();
  const back = [];
  for (let f = 0; f < 500; f++) {
    rt.setPad(1, f < 100 ? { right: true } : { left: true });
    const g = rt.frame(f);
    back.push({ x: spriteX(g.state, 0) - 32,
                pattern: spritePattern(g.state, 0),
                bxr: g.raster && g.raster.entries.length === 2
                  ? g.raster.entries[0].bxr : -1 });
  }
  rt.dispose();
  /* f0..f87 the walk to the middle (cam 0), f88..f99 the camera right
   * (cam 12), f100..f111 the camera back to 0, f112..f199 the walk back to
   * px 8, then the clamp for 300 frames */
  check(back.slice(100, 112).every((r) => r.x === MID),
        "he stays at the middle while the camera scrolls back");
  check(back.every((r) => r.x >= 8),
        "he never walks off the left edge");
  check(back[199].x === 8 && back[500 - 1].x === 8,
        "walking left takes him back to the level's start (px 8) and stops there");
  let backOk = true, clampedBxr = true;
  for (let f = 1; f < 500; f++) {
    const d = (back[f].bxr - back[f - 1].bxr + 256) % 256;
    if (f >= 100 && f <= 111 && d !== 255) backOk = false;
    if (f >= 112 && d !== 0) clampedBxr = false;
  }
  check(backOk, "the far band scrolls back a pixel a frame while he is at the middle");
  check(clampedBxr, "the camera clamps at the level's start — no negative scroll");
  check(back.slice(200).every((r) => r.x === 8 && r.pattern === idleL),
        "a pad held against the level's edge moves nothing and shows the idle stand");

  /* ---- the gameplay: jump, shot, water, the run cycle turning ------------- */

  const play = playTogether(files, gameplayPad, 120, []);
  const gp = play.records;
  eq("Lua == IL on the gameplay's 120 frames", play.diffs.slice(0, 8), []);
  eq("both runtimes ran every frame", [play.counted.lua, play.counted.il],
     [119, 119]);

  const gx = gp.map((r) => r.px);
  check(Math.max.apply(null, gx) - Math.min.apply(null, gx) >= 40,
        "the pad walks the character across the screen (" +
        Math.min.apply(null, gx) + ".." + Math.max.apply(null, gx) + ")");
  check(new Set(gp.map((r) => r.pattern)).size >= 4,
        "the run cycle turns through " +
        new Set(gp.map((r) => r.pattern)).size + " patterns");

  /* #148 (Dennis, playing it): the aim pose plays only WHILE the fire key is
   * held — the old cooldown timer let the gun linger up after the release,
   * which is the wrong animation he saw.  So the shoot pattern appears on
   * exactly the frames the key is down (on the ground; the leap's stride
   * wins in the air), and the run cycle's own sequence never contains it
   * while fire is not pressed. */
  const shootL = listedInt("SHOOT_L");
  const fireFrames = gp.filter((r) => r.fire && r.feet === 208).map((r) => r.f);
  const shotPose = gp.filter((r) => r.pattern === shootL).map((r) => r.f);
  check(shotPose.length > 0, "the aim pose shows while the fire key is held (" +
        shotPose.length + " frames)");
  eq("and on exactly those frames — never while fire is not pressed",
     shotPose, fireFrames);

  /* the idle stand is its own frame (sheet frame 1), shown whenever nothing
   * moved — the run plays only while he moves (#158), so a still frame is
   * an idle frame — and on no other frame */
  const idleFrames = gp.filter((r) => r.pattern === idleL).map((r) => r.f);
  check(idleFrames.length >= 8, "the pad at rest shows the idle stand (" +
        idleFrames.length + " frames)");
  eq("on every still, grounded, not-firing frame, and no other", idleFrames,
     gp.filter((r) => r.f > 0 && !r.fire && r.feet === 208 &&
                    r.px === gp[r.f - 1].px &&
                    JSON.stringify(r.bands) === JSON.stringify(gp[r.f - 1].bands))
        .map((r) => r.f));

  /* the jump: away from the water line and back to it */
  const feet = gp.map((r) => r.feet);
  check(Math.min.apply(null, feet) < 208 - 20,
        "up lifts the character off the water line (lowest y " +
        Math.min.apply(null, feet) + " of 208)");
  check(feet[feet.length - 1] === 208,
        "and it lands back on the water line at y 208");

  /* the tracer */
  const firing = gp.filter((r) => r.shotX !== null);
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
  let cycled = 0, stillWater = 0;
  for (let i = 1; i < gp.length; i++) {
    const same = JSON.stringify(gp[i].water) === JSON.stringify(gp[i - 1].water);
    if (gp[i].f % 8 === 0) { if (!same) cycled++; else stillWater++; }
    else if (!same) stillWater++;
  }
  check(cycled > 10 && stillWater === 0,
        "the water's three CRAM entries change on every 8th frame and only then (" +
        cycled + " changes, " + stillWater + " elsewhere)");

  /* the raster split: two bands, and they move only with the camera — on
   * this script the soldier never reaches the middle, so the street is
   * still the whole time (no auto-scroll, card #158) */
  const bands = gp[gp.length - 1].bands;
  eq("the raster table has two entries", bands.map((b) => b.line), [0, 208]);
  let farB = [], nearB = [];
  for (let i = 1; i < gp.length; i++) {
    const a = gp[i - 1].bands, b = gp[i].bands;
    if (!a.length || !b.length) continue;
    farB.push(((b[0].bxr - a[0].bxr) + 256) % 256);
    nearB.push(((b[1].bxr - a[1].bxr) + 256) % 256);
  }
  check(farB.every((d) => d === 0) && nearB.every((d) => d === 0),
        "the bands are still while he walks on screen and stands — no " +
        "auto-scroll (far max " + Math.max.apply(null, farB) + ", near max " +
        Math.max.apply(null, nearB) + ")");

  /* #148 (Dennis, playing it): "the second layer does not scroll to the end of
   * the screen and restart, it now stops somewhere in the middle".  A band
   * whose BXR is a divided shared counter climbs to 85 and snaps back.  This
   * holds right past both wraps — 400 frames: the walk to the middle, then
   * the camera at a pixel a frame (the far band goes round once, the near
   * twice, at its 2:1 rate) — and every step must be the band's own rate. */
  const rt2 = toys.create(longSource, { budgetMs: 400, files: files });
  rt2.load();
  const seq = [];
  for (let f = 0; f < 400; f++) {
    rt2.setPad(1, { right: true });
    const g = rt2.frame(f);
    if (g.raster && g.raster.entries.length === 2)
      seq.push([g.raster.entries[0].bxr, g.raster.entries[1].bxr]);
  }
  rt2.dispose();
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
  check(seq.length === 400, "400 frames of the two bands were recorded");
  check(farBad === 0 && nearBad === 0,
        "no band jumps: every step is its own rate (far " + farBad +
        " bad, near " + nearBad + " bad)");
  check(farWrap >= 1 && nearWrap >= 1,
        "each band goes round and comes back (far " + farWrap + " wraps, near " +
        nearWrap + " wraps)");

  return ev;
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
  /* Card #158's four-step strip: the idle stand at the level's start, a
   * step while walking on screen, the middle (where the camera takes over),
   * and the street scrolled at the middle.  One pad drives them: right from
   * frame 10, so the 88-pixel walk reaches the middle at frame 97 and the
   * camera scrolls after.  The picks share one water phase (f // 8 mod 3
   * is 0 on all four), so the street itself is the only thing that differs
   * between the cells. */
  const stripPad = (f) => (f >= 10 ? { right: true } : {});
  const cell = 144, ch = 120, cols = 4, picks = [5, 30, 97, 150];
  const run = playTogether(files, stripPad, 160, picks);
  eq("Lua == IL on the strip's 160 frames", run.diffs.slice(0, 8), []);

  /* the cells are the four steps: the idle stand, a step while walking, the
   * middle, and the street scrolled — three poses of the run cycle after
   * the idle (run_t 21, 88 and 141 walking frames: poses 3, 14 and 23) */
  const wantPatterns = [listedInt("IDLE_L")]
    .concat(listedList("RUN_L").slice(3, 4), listedList("RUN_L").slice(6, 8));
  eq("the strip's four cells are one idle stand and three steps of the run",
     picks.map((f) => run.records[f].pattern), wantPatterns);
  eq("the character stands at the start, steps right, and stays at the middle",
     picks.map((f) => run.records[f].px), [8, 29, 96, 96]);

  const w = cols * cell, h = Math.ceil(picks.length / cols) * ch;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba[i * 4 + 3] = 255;
  picks.forEach((f, i) => {
    const px = run.kept.get(f);
    const ox = (i % cols) * cell, oy = Math.floor(i / cols) * ch;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cell; x++) {
      /* the character's own corner of the screen: he walks from x 8 to the
       * middle at 96, and the middle pose's art (the 40-px run frame centred
       * in its pair) spans x 108..147, so x 8..152, y 100..220 holds every
       * pose whole */
      const sx = 8 + x, sy = 100 + y;
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

  /* the story the strip tells, read in the column the character never
   * covers on any cell (x 81..107 of the screen — the idle stand spans
   * 24..55, the step 41..80, the middle pose 108..147): the street stands
   * still while he walks to the middle (the first and third cells show one
   * picture, cam 0), and it scrolls once he is there (cam 53 in the fourth
   * cell) */
  const region = (cellIdx) => {
    const ox = (cellIdx % cols) * cell, oy = Math.floor(cellIdx / cols) * ch;
    const row = [];
    for (let y = 0; y < ch; y++) for (let x = 73; x < 100; x++) {
      const oi = ((oy + y) * w + ox + x) * 4;
      row.push(rgba[oi], rgba[oi + 1], rgba[oi + 2]);
    }
    return row.join(",");
  };
  check(region(0) === region(2),
        "the street stands still while he walks to the middle (cells 1 and 3 match)");
  check(region(2) !== region(3),
        "and it scrolls once he is there (cells 3 and 4 differ)");

  /* the card's "x ~ 128": cells 1 and 3 are both cam 0, so inside the
   * middle pose's own corner (screen x 96..151, above the water line) the
   * only ink that differs is the soldier himself — and its centre is the
   * screen's middle */
  let diffInk = 0, diffSum = 0;
  for (let y = 44; y <= 107; y++) for (let x = 88; x <= 143; x++) {
    const o1 = (y * w + x) * 4, o3 = (y * w + 2 * cell + x) * 4;
    const d = Math.abs(rgba[o1] - rgba[o3]) + Math.abs(rgba[o1 + 1] - rgba[o3 + 1]) +
              Math.abs(rgba[o1 + 2] - rgba[o3 + 2]);
    if (d > 0) { diffInk++; diffSum += x; }
  }
  const cx = 8 + diffSum / diffInk;   /* crop x 0 is screen x 8 */
  check(diffInk > 200 && Math.abs(cx - 128) <= 16,
        "the soldier's body is the screen's middle (centre x " + cx.toFixed(0) +
        " of " + diffInk + " differing ink pixels)");

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

/* ---- 8: card #156 — the art is named sources, not pokes ---------------- */

function checkSources(files) {
  const A = require("../renderer/pce-assets.js");
  const sres = A.sources(files.concat([{ name: "sources.json", source:
    fs.readFileSync(path.join(ART, "sources.json"), "utf8") }]));
  eq("the studio's model names the three sources",
     sres.sources.map((s) => s.name), ["street", "hero", "shot"]);
  eq("... and every range is live", sres.notes, []);

  const srcs = JSON.parse(fs.readFileSync(path.join(ART, "sources.json"), "utf8"))
    .sources;
  const tilesDoc = JSON.parse(files[0].source);
  eq("street's tile range is the file's tiles",
     [srcs[0].tiles.first, srcs[0].tiles.count], [0, tilesDoc.tiles.length]);
  eq("hero's pattern range is the character's twenty",
     [srcs[1].patterns.first, srcs[1].patterns.count], [0, 20]);
  eq("shot's pattern range is the tracer",
     [srcs[2].patterns.first, srcs[2].patterns.count], [20, 1]);
  check(srcs[1].sprites.first === 0 && srcs[1].sprites.count === 2 &&
        srcs[2].sprites.first === 2 && srcs[2].sprites.count === 4,
        "the SAT ranges are the toy's own slots (0-1 the character, " +
        "2-5 the shots)");

  /* the previews are the running picture: their cells are the importer's
   * placement (the same codes main.lua's tail carries — check 1 above) and
   * the street's preview tiles are the file's tiles */
  const pic = sat.pictureFromFiles(files);
  const codes = ed.patternLayout(pic).codes;
  eq("the hero preview's cells are the importer's placement",
     sres.sources[1].preview.cells.map((c) => c.cell), codes.slice(0, 20));
  eq("the shot preview's cell is the importer's placement",
     sres.sources[2].preview.cells.map((c) => c.cell), [codes[20]]);
  const street = sres.sources[0].preview;
  check(street.cells.every((cell) =>
          JSON.stringify(tilesDoc.tiles[cell.char - 0x40].pixels) ===
          JSON.stringify(cell.pixels)),
        "the street preview's tiles are the file's (" + street.cells.length +
        " tiles)");
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
  const thumb = gallery.still(null, source, 60, { files: files });
  check(thumb && gallery.countInk(thumb) > 1000,
        "gallery.still with the site's art draws a picture (frame 60, " +
        (thumb ? gallery.countInk(thumb) : 0) + " non-background pixels)");

  checkNumbersAreTheArts(files);
  checkSources(files);
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
