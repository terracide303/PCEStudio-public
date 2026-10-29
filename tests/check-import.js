#!/usr/bin/env node
/*
 * tests/check-import.js — card #117's evidence: the asset importer.
 *
 * The card closes on: "a toy whose only art is the panels' three files renders
 * frame 600 pixel-equal to pce-editor's preview of those files in Lua and the
 * IL, with no generated Lua block in between."
 *
 * So this file takes ONE toy — the bare program below, which writes no VRAM,
 * no CRAM, no SAT and no register — and the three files the SCREEN, SPRITES
 * and PALETTES panels write for toys/demo-game.  It runs 600 frames of that
 * toy through both runtimes with `options.files`, and asserts:
 *
 *   1. THE FILES ARE THE PANELS'.  `node tools/demo-game-assets.js --check`
 *      exits 0, so tiles.json / sprites.json / palettes.json are exactly what
 *      the panels' own writers produce (the Node bridge that used to make the
 *      picture for demo-game is a fixed point, tests/check-demo-game.js).
 *   2. THE PICTURE REACHES VRAM AND CRAM.  After createHost with `files`,
 *      VRAM (32768 words), CRAM (512 entries) and the SAT are byte-equal to
 *      pce-editor.js's toPicture() of the same files, and the config
 *      registers are the picture's: BXR/BYR from tiles.json's scroll, MWR 0,
 *      CR = $C0 (BB | SB, because the picture has sprites).
 *   3. FRAME 600 IS THE PREVIEW, IN LUA.  The 600th frame's pixels are
 *      pixel-equal to pce-editor.js's renderPreview() of the same files, in
 *      the toy's own 256x224 window (the editor previews the picture's
 *      240-line window; its top 224 rows are the toy's frame — the only rows
 *      the host draws, and the test says so rather than cropping silently).
 *      The toy writes no art, and there is no generated Lua block: the
 *      program's text is asserted to hold no `vram[`, no `pal(` and no
 *      tools/demo-game-assets.js marker.
 *   4. FRAME 600 IS THE PREVIEW, IN THE IL.  The same source, files and
 *      frames through renderer/pce-il.js: the same pixels, and vram/cram/sat/
 *      regs byte-equal to the Lua run's.
 *   5. IT LANDS BEFORE THE TOY RUNS, AND THE TOY STILL WINS.  A toy that
 *      reads vram[0] in init() reads the imported BAT word, and its own
 *      vram[0] write replaces it.
 *   6. EMPTY FILES IMPORT NOTHING.  A new toy's default files leave VRAM,
 *      CRAM and SAT all zero and CR at the host's $80 — the importer does not
 *      paint a blank BAT into a toy that draws its own picture.
 *   7. A BROKEN FILE IS THE PANELS' REFUSAL.  tiles.json that is not JSON is
 *      `asset-json` from create(), not a silent empty screen.
 *   8. THE PAGE HANDS THE FILES TO THE RUNTIME.  renderer/studio.html's
 *      rebuild() passes the toy's `files` to the factory (a structural check:
 *      the pixel proof is 3-4; this says the person's path is wired).
 *
 * NOTE ON THE FILE: the checks live here rather than in check-studio.js
 * because this working tree is shared and studio.html carries another seat's
 * in-flight #120 hunk; the precedent is check-assets.js (#99) and
 * check-breaker-78.js (#91).  They belong beside check-studio.js when the
 * tree settles.
 *
 * NOTE ON AUTHORSHIP: written by @design because the card names this file.
 * Per workshop rule 2 this is the author's own mutant and proves only what
 * its author thought of; a cold break by another seat is owed before the card
 * closes.
 *
 *   node tests/check-import.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const toys = require("../renderer/pce-toys.js");
const il = require("../renderer/pce-il.js");
const editor = require("../renderer/pce-editor.js");
const sat = require("../renderer/pce-sat.js");
const toyhost = require("../renderer/pce-toyhost.js");
const importer = toyhost.importer;

const REPO = path.join(__dirname, "..");
const TOY = path.join(REPO, "toys", "demo-game");
const PAGE = path.join(REPO, "renderer", "studio.html");
const ASSET_NAMES = ["tiles.json", "palettes.json", "sprites.json"];
const FRAMES = 600;              /* the card's frame 600 is f = 599 */
const WIDTH = 256;
const HEIGHT = 224;
const CHANNELS = 3;              /* pce-bg.js/pce-sprites.js draw RGB */

/* The toy: no art of its own, and nothing that touches the hardware.  It is
 * here, not in toys/, because its whole point is that the FILE SET is the art
 * — a copy of this source beside three copied JSON files would invite the
 * files to drift from the panels' output this test reads. */
const BARE = [
  "-- The picture is tiles.json, palettes.json and sprites.json (#117).",
  "-- This program draws nothing: the runtime imports the assets before",
  "-- the top-level statements and init() run.",
  "N = 0",
  "function frame(t, f)",
  "  N = N + 1",
  "end",
  ""
].join("\n");

let checks = 0;
const failures = [];
function check(ok, name) {
  checks++;
  if (!ok) { failures.push(name); console.log("FAIL  " + name); }
}

function eq(name, got, want) {
  const same = JSON.stringify(got) === JSON.stringify(want);
  check(same, name + (same ? "" : " (got " + JSON.stringify(got) +
        ", want " + JSON.stringify(want) + ")"));
}

function assetFiles() {
  return ASSET_NAMES.map((name) => ({
    name: name, source: fs.readFileSync(path.join(TOY, name), "utf8")
  }));
}

function bytes(a) { return Buffer.from(a.buffer || a, a.byteOffset || 0, a.length); }

function sameBytes(a, b) { return a.length === b.length && bytes(a).equals(bytes(b)); }

function wordAt(vram, word) { return vram[word * 2] | (vram[word * 2 + 1] << 8); }

/* ---- 1. the files are the panels' -------------------------------------- */

function checkFiles() {
  const run = spawnSync(process.execPath,
                        [path.join(REPO, "tools", "demo-game-assets.js"), "--check"],
                        { encoding: "utf8" });
  eq("tools/demo-game-assets.js --check exits 0 (the three files are the panels' own output)",
     run.status, 0);
}

/* ---- 2. the picture is the hardware's words ---------------------------- */

function checkWords(files) {
  const pic = sat.pictureFromFiles(files);
  const data = editor.toPicture(pic);
  const read = importer.read(files);
  check(!!read, "the files hold a picture (toyhost.importer.read is not null)");
  if (!read) return null;

  eq("the import's VRAM is toPicture()'s 32768 words",
     sameBytes(read.vram, data.vram), true);
  eq("the import's CRAM is toPicture()'s 512 entries",
     sameBytes(read.cram, data.cram), true);
  eq("the import's SAT is VRAM $7F00's 256 words",
     sameBytes(read.sat, data.vram.slice(editor.SAT_ADDR * 2,
                                         editor.SAT_ADDR * 2 + 512)), true);
  eq("the import's registers are the picture's",
     read.regs, { BXR: data.regs.BXR, BYR: data.regs.BYR,
                  MWR: data.regs.MWR, CR: data.regs.CR });
  eq("CR is $C0: background and sprites on (the picture has sprites)",
     read.regs.CR, 0xC0);
  eq("the import counts the picture's own tiles/patterns/sprites",
     [read.tiles, read.patterns, read.sprites], [5, 14, 17]);
  return { pic: pic, data: data, read: read };
}

/* The host the runtimes build, with the files: the same words, on the toy. */
function checkHost(files, data) {
  const host = toyhost.createHost({ files: files });
  check(!!host.assets, "createHost({files}) reports an import (host.assets)");
  eq("the host's VRAM is toPicture()'s",
     sameBytes(host.state.vram, data.vram), true);
  eq("the host's CRAM is toPicture()'s",
     sameBytes(host.state.cram, data.cram), true);
  eq("the host's SAT is the picture's SAT",
     sameBytes(host.state.sat, data.vram.slice(editor.SAT_ADDR * 2,
                                               editor.SAT_ADDR * 2 + 512)), true);
  eq("the host's registers are the picture's",
     [host.state.regs.BXR, host.state.regs.BYR, host.state.regs.MWR,
      host.state.regs.CR],
     [data.regs.BXR, data.regs.BYR, data.regs.MWR, data.regs.CR]);
}

/* ---- 3/4. frame 600 is the preview, in both runtimes ------------------- */

/* How many of the frame's pixels differ from the preview's top `height` rows.
 * The preview's width is its own (the picture's dot clock); the host's is
 * 256.  Returns {diff, first} so a failure names a pixel, not a count. */
function pixelDiffs(frame, preview) {
  const W = frame.width, PW = preview.width;
  let diff = 0, first = null;
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < W; x++) {
      const a = (y * W + x) * CHANNELS, b = (y * PW + x) * CHANNELS;
      if (frame.pixels[a] !== preview.pixels[b] ||
          frame.pixels[a + 1] !== preview.pixels[b + 1] ||
          frame.pixels[a + 2] !== preview.pixels[b + 2]) {
        diff++;
        if (!first) {
          first = { x: x, y: y,
                    frame: [frame.pixels[a], frame.pixels[a + 1], frame.pixels[a + 2]],
                    preview: [preview.pixels[b], preview.pixels[b + 1],
                              preview.pixels[b + 2]] };
        }
      }
    }
  }
  return { diff: diff, first: first };
}

function play(factory, files) {
  const rt = factory.create(BARE, { budgetMs: 250, files: files });
  rt.load();
  let frame = null;
  for (let f = 0; f < FRAMES; f++) frame = rt.frame(f);
  return { rt: rt, frame: frame };
}

function checkRuntimes(files, evidence) {
  /* The toy has no art of its own: if any of these appear, the picture the
   * test compares is the Lua block's, not the importer's. */
  check(BARE.indexOf("vram[") < 0 && BARE.indexOf("pal(") < 0 &&
        BARE.indexOf("PCEStudio demo art") < 0,
        "the toy's source writes no VRAM/CRAM and carries no generated art block");
  check(BARE.indexOf("sprite(") < 0 && BARE.indexOf("sat(") < 0 &&
        BARE.indexOf("reg(") < 0,
        "the toy's source touches no sprite, SAT entry or register");

  const preview = editor.renderPreview(evidence.pic, 0);
  eq("the editor's preview of the files is 256x240 (the picture's 240-line window)",
     [preview.width, preview.height], [256, 240]);

  const lua = play(toys, files);
  const ilRun = play(il, files);
  eq("the Lua toy ran " + FRAMES + " frames (the 600th is f = 599)",
     [lua.frame.frame, lua.rt.frameCount], [FRAMES - 1, FRAMES - 1]);
  eq("the IL toy ran " + FRAMES + " frames (the 600th is f = 599)",
     [ilRun.frame.frame, ilRun.rt.frameCount], [FRAMES - 1, FRAMES - 1]);
  eq("the toy's frame is the host's 256x224",
     [lua.frame.width, lua.frame.height], [WIDTH, HEIGHT]);

  for (const run of [["Lua", lua], ["IL", ilRun]]) {
    const name = run[0], frame = run[1].frame;
    const d = pixelDiffs(frame, preview);
    check(d.diff === 0, name + ": frame 600 is pixel-equal to the panels' " +
          "preview in the toy's 224 lines (" + d.diff + " differing pixels" +
          (d.first ? ", first at " + d.first.x + "," + d.first.y + ": frame " +
                     d.first.frame + " vs preview " + d.first.preview : "") + ")");
    eq(name + ": frame 600's VRAM is the picture's 32768 words",
       sameBytes(frame.state.vram, evidence.data.vram), true);
    eq(name + ": frame 600's CRAM is the picture's 512 entries",
       sameBytes(frame.state.cram, evidence.data.cram), true);
    eq(name + ": frame 600's SAT is the picture's 256 words",
       sameBytes(frame.state.sat, evidence.data.vram.slice(editor.SAT_ADDR * 2,
                                                           editor.SAT_ADDR * 2 + 512)),
       true);
    eq(name + ": the toy changed no register",
       [frame.state.regs.BXR, frame.state.regs.BYR, frame.state.regs.MWR,
        frame.state.regs.CR],
       [evidence.data.regs.BXR, evidence.data.regs.BYR, evidence.data.regs.MWR,
        evidence.data.regs.CR]);
  }

  eq("Lua and the IL draw the same frame 600",
     sameBytes(lua.frame.pixels, ilRun.frame.pixels), true);
  eq("Lua and the IL hold the same VRAM at frame 600",
     sameBytes(lua.frame.state.vram, ilRun.frame.state.vram), true);
  eq("Lua and the IL hold the same CRAM at frame 600",
     sameBytes(lua.frame.state.cram, ilRun.frame.state.cram), true);
  eq("Lua and the IL hold the same SAT at frame 600",
     sameBytes(lua.frame.state.sat, ilRun.frame.state.sat), true);
}

/* ---- 5. before the toy, and the toy still wins ------------------------- */

function checkOrder(files, evidence) {
  const source = [
    "function init()",
    "  vram[20000] = vram[0]   -- the imported BAT word, read by the toy",
    "  vram[0] = 0x1234        -- the toy's own write replaces it",
    "end",
    "function frame(t, f) end",
    ""
  ].join("\n");
  const imported = wordAt(evidence.data.vram, 0);
  for (const run of [["Lua", toys], ["IL", il]]) {
    const rt = run[1].create(source, { budgetMs: 250, files: files });
    rt.load();
    const frame = rt.frame(0);
    eq(run[0] + ": init() reads the imported BAT word (vram[0] = $0040)",
       wordAt(frame.state.vram, 20000), imported);
    eq(run[0] + ": init() = $0040 is the blank tile's BAT cell", imported, 0x0040);
    eq(run[0] + ": the toy's own vram[0] write wins",
       wordAt(frame.state.vram, 0), 0x1234);
  }
}

/* ---- 6. empty files import nothing ------------------------------------- */

function checkEmpty() {
  const files = [
    { name: "tiles.json", source: '{\n  "version": 1,\n  "tiles": []\n}\n' },
    { name: "palettes.json", source: '{\n  "version": 1,\n  "backdrop": 0,\n' +
      '  "background": [],\n  "sprites": []\n}\n' },
    { name: "sprites.json", source: '{\n  "version": 1,\n  "sprites": []\n}\n' }
  ];
  const host = toyhost.createHost({ files: files });
  eq("a new toy's empty files import nothing (host.assets is null)",
     host.assets, null);
  let nonzero = 0;
  for (let i = 0; i < host.state.vram.length; i++) if (host.state.vram[i]) nonzero++;
  for (let i = 0; i < host.state.cram.length; i++) if (host.state.cram[i]) nonzero++;
  for (let i = 0; i < host.state.sat.length; i++) if (host.state.sat[i]) nonzero++;
  eq("empty files leave VRAM, CRAM and SAT all zero", nonzero, 0);
  eq("empty files leave CR at the host's $80",
     host.state.regs.CR, 0x80);

  /* No `files` at all is the same host as empty files. */
  const bare = toyhost.createHost({});
  eq("no files option is no import", bare.assets, undefined);
}

/* ---- 7. a broken file is the panels' refusal --------------------------- */

function checkBroken() {
  const files = [
    { name: "tiles.json", source: "{\n  \"tiles\": [" },
    { name: "palettes.json", source: "{}" },
    { name: "sprites.json", source: "{}" }
  ];
  let caught = null;
  try { toys.create(BARE, { budgetMs: 250, files: files }); }
  catch (e) { caught = e; }
  eq("tiles.json that is not JSON is asset-json from create()",
     [caught && caught.code, /not JSON/.test(caught ? caught.message : "")],
     ["asset-json", true]);
}

/* ---- 8. the page hands the files to the runtime ------------------------ */

function checkPage() {
  const text = fs.readFileSync(PAGE, "utf8");
  const at = text.indexOf("factory.create(current.source");
  const call = at < 0 ? "" : text.slice(at, at + 200);
  check(/factory\.create\(current\.source,\s*\{[^}]*files:\s*files/.test(call),
        "studio.html's rebuild() passes the toy's files to the runtime");
}

/* ---- main ------------------------------------------------------------- */

function main() {
  console.log("check-import — the asset importer, card #117\n");
  checkFiles();
  const files = assetFiles();
  const evidence = checkWords(files);
  if (!evidence) {
    console.log("\n" + checks + " checks, " + failures.length + " failed");
    return 1;
  }
  checkHost(files, evidence.data);
  checkRuntimes(files, evidence);
  checkOrder(files, evidence);
  checkEmpty();
  checkBroken();
  checkPage();

  console.log("\n" + checks + " checks, " + failures.length + " failed");
  if (failures.length) {
    for (const f of failures) console.log("  FAILED: " + f);
    return 1;
  }
  console.log("PASS  check-import — frame 600 of a toy whose only art is the " +
              "panels' three files is pce-editor's preview, in Lua and the IL, " +
              "with no generated Lua block");
  return 0;
}

process.exit(main());
