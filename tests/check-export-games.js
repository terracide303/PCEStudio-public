#!/usr/bin/env node
/*
 * tests/check-export-games.js — #180's evidence, re-routed by #284: the five
 * real games through the studio's Export button, and what the emulator
 * actually does with each ROM that comes out.
 *
 *   node tests/check-export-games.js
 *
 * THE ROUTE (since #284).  The five gallery games are built the way the
 * studio's Export button builds them, with the file set the gallery gives
 * the studio (renderer/gallery-toys.js — the same data the page loads):
 *
 *   pce-il.js compile ("@main.lua") -> pce-validate.js validateProgram
 *   (8 frames) -> pce-cgen.js emitC   [the CONSOLE tab's three stages]
 *   -- any error finding refuses, exactly as the Export dialog blocks --
 *   -> pce-ilbc.js -> pce-rom.js buildToyRom over renderer/ilvm.bin,
 *   with the toy's asset tail (its project's tiles/palettes/sprites and
 *   any other non-default files, the page's exportAssetTail envelope).
 *
 * No compiler is called.  A refusal here is the refusal the Export dialog
 * shows, with its exact text, so a refusal in the studio is a refusal in
 * this test (the maintainer's 2026-11-04 finding: the old suite built
 * main.lua alone and said STARFALL exports while the studio refused it
 * `toy-data-bank-full`).
 *
 * The MCP's export_pce stays the bytecode route (no C emitter, no assets).
 * The controls and the `kind: "toy"` pins run it, and a game the studio
 * refuses whose interpreter ROM is still measured (STARFALL, DUSK RUN) is
 * built by it and pinned as `bytecodeOnly` — the pin is that ROM's, and the
 * suite says so, never "exports".
 *
 * WHAT IS CHECKED
 *
 *   1. Each of the five games (STARFALL, TOWER, NOVA TIDE, DUSK RUN,
 *      PLATFORMER) reaches the outcome docs/ROM_SPEED.md's table records:
 *      a refusal with the studio's exact code and message, or a built
 *      40,960-byte ROM with its pinned sha.  The source line the table
 *      names is checked against the IL (the refused instruction's own
 *      line, derived from the message's function and line), so the table's
 *      "line" column is reproducible and not a comment.  A blocker that
 *      lands moves the refusal: this pin goes red and asks for the table
 *      and the pin to be updated — a tripwire, not a broken test.
 *   2. Every game that builds is measured with tools/measure-rom.js
 *      (Mednafen, headless) and its picture is compared with the browser's
 *      frames of the same toy: the tail of a `-qtrecord` capture must be
 *      diff 0 against one of the browser's first BROWSER_FRAMES frames.
 *      A game whose one-time build outlasts the default 300-frame measure
 *      or 5.5 s capture tail is pinned with its own measure frame count and
 *      capture length (GAME_PINS) — PLATFORMER is that game since #186.
 *      A game that builds on the bytecode route and runs but whose
 *      displayed frame is not the browser's yet (STARFALL, after #227 left
 *      its status bar's two edge columns different) is pinned as its ROM
 *      sha plus `unmatched`: the capture must be not black AND not a
 *      browser frame, so either half going stale fails and asks for a
 *      re-pin.
 *      Two controls prove the capture-and-compare instrument works on a
 *      toy that exports: tools/toys/palette.lua (its ROM sha and its
 *      eight-frame picture cycle are pinned) and, for #183,
 *      tools/toys/arity.lua, whose five- to eight-parameter functions reach
 *      the screen through the interpreter's extra-argument block (its ROM
 *      sha and sixteen-frame picture cycle are pinned); #187 adds
 *      tools/toys/not.lua, whose picture is painted by the logical not
 *      (its ROM sha and four-picture cycle are pinned); #191 adds
 *      tools/toys/sprite.lua to GAME_PINS — its three constant sprite
 *      specs export and draw on both routes, and its ROM sha and static
 *      picture are pinned (the same toy is the console dump
 *      tests/check-ilvm.js registers, where the SAT words are compared).
 *   3. The control's ROM bytes are the browser route's: emitted a second
 *      time from the same modules, byte-identical.
 *
 * When Mednafen is missing the suite prints SKIP with the reason and still
 * checks every refusal and every build (the export side needs no emulator).
 *
 * docs/ROM_SPEED.md § "The real games, measured" is this suite's table.
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { spawn, spawnSync } = require("child_process");

const il = require("../renderer/pce-il.js");
const ilbc = require("../renderer/pce-ilbc.js");
const cgen = require("../renderer/pce-cgen.js");
const romLib = require("../renderer/pce-rom.js");
const toys = require("../renderer/pce-toys.js");
const validate = require("../renderer/pce-validate.js");
const gallery = require("../renderer/gallery-toys.js");

const ROOT = path.join(__dirname, "..");
const MEDNAFEN = process.env.MEDNAFEN || "/opt/homebrew/bin/mednafen";
const MEASURE = path.join(ROOT, "tools", "measure-rom.js");
const MOVFRAMES = path.join(ROOT, "tools", "movframes.py");
const BANK0 = path.join(ROOT, "renderer", "ilvm.bin");

const BROWSER_FRAMES = 60;          /* the browser frames a capture may match */
const CAPTURE_TAIL = 12;            /* the movie's last frames, like check-ilvm */
const ROM_BYTES = 40960;            /* 32 KiB image + one data bank */

/* #284: the studio's default asset files (renderer/studio.html's
 * DEFAULT_ASSET_FILES, byte for byte).  A file whose source equals its
 * default is not part of the Export's asset tail, so a single-file toy
 * builds exactly the old no-asset bytes. */
const DEFAULT_ASSET_FILES = [
  { name: "tiles.json", kind: "tiles",
    source: '{\n  "version": 1,\n  "tiles": []\n}\n' },
  { name: "palettes.json", kind: "palettes",
    source: '{\n  "version": 1,\n  "backdrop": 0,\n  "background": [],\n  "sprites": []\n}\n' },
  { name: "sprites.json", kind: "sprites",
    source: '{\n  "version": 1,\n  "sprites": []\n}\n' },
  { name: "waves.json", kind: "waves",
    source: '{\n  "version": 1,\n  "channels": []\n}\n' }
];

/* The studio's exportAssetTail(): only files that differ from the empty
 * defaults, as the UTF-8 JSON envelope the page encodes and buildToyRom
 * carries after the bytecode.  JSON.stringify here and the page's
 * exportUtf8(JSON.stringify(...)) are the same string, so the bytes match
 * the studio's (STARFALL's 68,702 B tail is the maintainer's measured
 * number). */
function assetTail(files) {
  const tail = [];
  for (const f of files || []) {
    if (f.name === "main.lua") continue;
    const def = DEFAULT_ASSET_FILES.find(function (a) { return a.name === f.name; });
    if (def && f.source === def.source) continue;
    tail.push({ name: f.name, source: f.source });
  }
  if (!tail.length) return null;
  return Buffer.from(JSON.stringify({ version: 1, files: tail }), "utf8");
}

/* The file set the studio installs for a gallery toy (studio.html's
 * loadExample): the gallery's own files list, or main.lua plus the four
 * defaults for a single-file toy.  The main.lua source is the gallery's —
 * the same text the page runs. */
function galleryToy(id) {
  return gallery.toys.find(function (t) { return t.id === id; }) || null;
}
function studioFiles(id) {
  const t = galleryToy(id);
  if (!t) return null;
  if (Array.isArray(t.files) && t.files.length) {
    return t.files.map(function (f) {
      return { name: f.name, kind: f.kind, source: f.source };
    });
  }
  const out = [{ name: "main.lua", kind: "lua", source: t.source }];
  for (const a of DEFAULT_ASSET_FILES) {
    out.push({ name: a.name, kind: a.kind, source: a.source });
  }
  return out;
}

/* The card's five games and the outcome docs/ROM_SPEED.md records
 * (re-routed by #284, 2026-11-04): the studio's Export button runs the
 * CONSOLE tab's three stages first, so NOVA TIDE and DUSK RUN are refused
 * by the C emitter (`unm` has no C form) before the bytecode encoder —
 * their studio refusal is `cgen-op`, not the bytecode route's refusal the
 * MCP's export_pce returns.  STARFALL reaches the encoder and is refused
 * `toy-data-bank-full`: its bytecode is 6,285 B and its asset tail (the
 * three art files) 68,702 B against one 8 KiB data bank — the maintainer's
 * 2026-11-04 screenshot.  The three games with no art files: TOWER and
 * PLATFORMER build, DUSK RUN is refused by the C emitter before any asset
 * is involved.
 * `expect.message` is the dialog's exact text, asserted whole, so a
 * refusal that loses or rewords its detail fails.  `where` is the source
 * line the table names, re-derived from the IL; null is what the refusal
 * itself can say (the data bank's plain Error names no line).
 * `bytecode` records the MCP route's own refusal where it differs (NOVA
 * TIDE), still checked so export_pce's verdict stays tripwired. */
const GAMES = [
  {
    name: "NOVA TIDE", toy: "toys/nova-tide/main.lua", galleryId: "nova-tide",
    expect: { code: "cgen-op",
              message: "function fn@28, IL line 29, instruction `unm`: " +
                "not lowered by this backend (init/frame/raster and the " +
                "reg/pal/vset/sat/sprite/pad/table instructions, the " +
                "timer and the sound surface only; no fixed point or print)" },
    where: "main.lua:29",
    bytecode: { code: "ilbc-op",
                message: "instruction raster (function 34, pc 53) has no bytecode form" },
    bytecodeWhere: "main.lua:530"
  },
  {
    name: "DUSK RUN", toy: "toys/dusk-run/main.lua", galleryId: "dusk-run",
    expect: { code: "cgen-op",
              message: "function fn@59, IL line 62, instruction `unm`: " +
                "not lowered by this backend (init/frame/raster and the " +
                "reg/pal/vset/sat/sprite/pad/table instructions, the " +
                "timer and the sound surface only; no fixed point or print)" },
    where: "main.lua:62"
  },
  {
    name: "STARFALL", toy: "toys/demo-game/main.lua", galleryId: "starfall",
    expect: { code: "toy-data-bank-full",
              message: "pce-rom: toy-data-bank-full: the bytecode (6285 B) " +
                "and assets (68702 B) need 74987 bytes; a data bank holds " +
                "8,160 usable (its last 32 bytes are the song trailer)" },
    where: null
  }
];

/* A game that builds gets {rom, frames} here (its ROM sha, its
 * picture-cycle hashes, and the measure/capture wall time its boot needs —
 * see PLATFORMER's comment), added with its row in docs/ROM_SPEED.md.
 * TOWER and PLATFORMER build on the studio's route (no art files, the C
 * emitter accepts them) — their ROM is the same bytes the bytecode route
 * built before #284.  STARFALL and DUSK RUN are refused by the studio's
 * Export (GAMES above) but still build on the bytecode route, so they are
 * pinned `bytecodeOnly`: the pin's ROM and picture are that route's, and
 * the suite's verdict for them is the studio's refusal. */
const GAME_PINS = {
  /* STARFALL's bytecode-route ROM (the studio refuses the export — see
   * GAMES): the art block computes its VRAM addresses instead of listing
   * 225 of them and the sprites are placed with sat(), so the bytecode is
   * 6,285 B of the 8,160 B data bank and the constant pool is 111 of 127 —
   * no capacity is over, and it builds a 40,960 B ROM with the art left
   * out.  What it does NOT have yet is the browser's picture on the
   * console.  #227 fixed the two causes this pin used to name: the chain
   * is re-armed on every display frame (so the tail is a real frame, not
   * the collection's static screen) and each line's entry is preloaded and
   * written inside the blank (so row 16's first pixels are this line's
   * colour).  The capture's closest browser frame is now 48 bytes off, all
   * in the status bar's first tile row — two one-pixel columns at the
   * screen edges (x=1 and x=249, rows 0-7).  Before #227 the same capture
   * showed the armed replay 16 bytes off on row 24 (the split line's
   * palette write) and 372-632 bytes on the moving picture rows (measured
   * 2026-11-03); why the two edge columns differ is not proven.  So this
   * pin stays the DUSK RUN shape: the ROM sha, the counters, and the
   * screen asserted not black and not yet a browser frame.  The measured
   * run needs its own window: 600 frames of counters and a 12 s capture,
   * the latter long enough that the movie holds the running game, not the
   * boot. */
  "STARFALL": {
    toy: "toys/demo-game/main.lua",
    bytecodeOnly: true,
    rom: "a9f5140e1143f47a5c0ced8aafe6429f90ac137c5bd28efd8d6d6cdd40757471",
    frames: [],
    unmatched: "the bytecode-route ROM runs and draws; no captured frame " +
               "is the browser's picture yet — the closest is 48 bytes " +
               "off, in the status bar's first tile row (two one-pixel " +
               "edge columns); #227's replay and row-16 lag are fixed, " +
               "the cause of these columns is not proven",
    measureFrames: 600,
    captureMs: 12000,
    captureTail: true,
    browserFrames: 600
  },
  /* TOWER builds on the studio's route (no art files; the C emitter
   * accepts it): the bytecode is 7,862 B of the 8,160 B data bank and no
   * interpreter capacity is over, so it builds a 40,960 B ROM.  Its init
   * draws the tower through the interpreter and takes ~20 s of wall on
   * the dummy SDL driver (the art loops are thousands of interpreted
   * instructions), then a frame() takes ~11 video frames; the measure
   * therefore runs 1,800 frames and the capture 40 s, and only the
   * movie's last 12 frames are decoded (--tail; decoding every frame of a
   * 40 s movie in pure Python takes minutes).  The game state moves every
   * frame (boulders, hearts, the gem), so the pin is the ROM sha plus
   * "the captured picture is one of the browser's frames" over the
   * browser's first 600 frames: the ROM's toy frame at the capture is what
   * it is, and framesAny says the sha, not a small hash cycle, is the
   * stable half of the pin. */
  "TOWER": {
    toy: "toys/tower/main.lua",
    galleryId: "tower",
    rom: "048948fe18f9d43254520cf7738bc6c1fc792437cc0ad401bfb58ff0493d2428",
    framesAny: true,
    measureFrames: 1800,
    captureMs: 40000,
    captureTail: true,
    browserFrames: 600
  },
  /* #186: sat carried, so PLATFORMER builds (on the studio's route since
   * #284 — no art files, the C emitter accepts it).  Its one-time build
   * (init() draws the whole map and the sprite patterns through the
   * interpreter) takes ~7 s of wall on the dummy SDL driver: the default
   * 300-frame measure (≈7 s) lands inside the boot and reads 0 updates,
   * and the default 5.5 s capture tail is still pre-scene.  The pin
   * records the wall time that clears the boot: 900 measured frames (312
   * updates, all overrunning, worst 311 lines — "30 Hz") and a 12 s
   * capture.  The picture is the game's static no-input scene (the hero
   * stands on the grass), so the pin holds that one hash. */
  /* Every ROM embeds the committed renderer/ilvm.bin, so these shas move
   * with any interpreter change (#187's opcode moved all three). */
  "PLATFORMER": {
    toy: "toys/platformer/main.lua",
    galleryId: "platformer",
    rom: "109efcb8fbb7d9ce517c2cf6761098b6d9ce9aeb1633829fe61f6a4799b358da",
    frames: [1261564552],
    measureFrames: 900,
    captureMs: 12000
  },
  /* DUSK RUN's bytecode-route ROM (the studio refuses the export — see
   * GAMES): the container loads and runs: MAX_REGS 41 carries the frame
   * hook's 41 registers, MAX_FUNCS 41 its 41 functions, and the upvalue
   * pool carries function 39's 19 upvalues.  #227 made the displayed
   * picture the browser's: the RCR chain is re-armed on every display
   * frame (before, only one frame per ~37 — DUSK's build step — replayed
   * the table and a capture's tail was the static screen), and the line
   * entry is written from a zero-page preload inside the blank (before,
   * its last store was ~28 CPU cycles late and the first 16 pixels of row
   * 16 kept the old colour).  The pin is the ROM sha plus the
   * browser-frame hashes: DUSK's first toy frames are one static early
   * picture, so browser frames 1-6 share hash 3584516448 and frame 0 is
   * 2819597916; both are pinned.  It needs its own capture window: the
   * boot that draws the base takes ~7 s on the dummy SDL driver, so the
   * measure runs 600 frames and the capture 12 s. */
  "DUSK RUN": {
    toy: "toys/dusk-run/main.lua",
    bytecodeOnly: true,
    rom: "cabf674e632725d6e39b24fde6da34a436b61fd113cf4a665bcbb4dbdfff860a",
    frames: [2819597916, 3584516448],
    measureFrames: 600,
    captureMs: 12000,
    captureTail: true
  },
  /* #191: tools/toys/sprite.lua, the sprite op on the exported route.  It
   * is not one of the card's five games, so `kind: "toy"` keeps it out of
   * the five-game tripwire below; it rides GAME_PINS so it is measured,
   * captured and pinned by the same instrument as a game that builds.
   * Its three sprite specs are constants (#188), so the picture is the
   * same every frame: one pinned hash is the whole cycle.  The console's
   * SAT words for this toy are compared in tests/check-ilvm.js's
   * tests/dumps/toysprite-ilvm dump. */
  "SPRITE": {
    kind: "toy",
    toy: "tools/toys/sprite.lua",
    rom: "4f212ee9128f76d548ae92c4b9ea20c095e91282fde885317edeeda1cfdceb78",
    frames: [1994475180]
  }
};

/* The control, pinned now so the pinning path is itself covered: the palette
 * toy builds to one ROM and its picture repeats every eight frames.  The
 * controls run the bytecode route (the MCP's export_pce), which is what
 * they were written for; the card's games run the studio's route above. */
const CONTROL = {
  toy: "tools/toys/palette.lua",
  rom: "b12ec9c961006cff5de33c81d6e66dbe6dc123673a5fc6fb2b063b75764d13b6",
  frames: [3869706156, 2643445924, 3538915532, 947327828,
           812752556, 3014706084, 1954942252, 1817623796]
};

/* #183's second control: a toy with five-, six-, seven- and eight-parameter
 * functions.  It exports (the interpreter's extra-argument block carries
 * arguments 5..8), runs in Mednafen, and its picture is diff 0 against the
 * browser's — the evidence the card asks for, on the route export_pce uses.
 * Its picture repeats every 16 frames, so the 16 pinned hashes are the whole
 * cycle. */
const WIDE = {
  toy: "tools/toys/arity.lua",
  rom: "ea4f014915bb597556e67f171a332e254e703c8127409b6439da4c91718e9077",
  frames: [2193764624, 244294368, 1782875976, 2412359456, 4229270688,
           77057856, 2598679444, 284441580, 4128389208, 3185272652,
           1493917472, 1001242492, 3182251664, 971588316, 1975998004,
           3998485784]
};

/* #187's control: a toy whose picture is painted by the logical not
 * (tools/toys/not.lua: pal 0-3 and the BXR scroll are each the answer of a
 * `not`, so an interpreter that aliased `not` to bnot's ~ would paint the
 * wrong branches and no capture could match — the host parity in
 * tests/check-ilvm.js pins the same semantics value for value).  It
 * exports, runs in Mednafen, and its picture is diff 0 against the
 * browser's.  Its picture repeats every 6 frames, so the four pinned
 * hashes are the whole cycle.  (The studio's Export would refuse this toy
 * at the C emitter — `not` has no C form — which is the games' story, not
 * the controls'.) */
const NOT = {
  toy: "tools/toys/not.lua",
  rom: "fe9672f4ee2b93a7bb8c9cbc52ec0e92bd9b3b6ddb774822d11fd15d2a3a23ab",
  frames: [2266090996, 2632876444, 887268600, 1464026320]
};

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
function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/* ---- the studio's Export route, exactly the button's order ------------- */

/* Returns {rom, source, program, bytecodeBytes, warn} or {code, message,
 * warn} — never throws.  `files` is the toy's file set as the studio
 * installs it (studioFiles above); the asset tail is the page's
 * exportAssetTail() over it.  The order is the Export button's: the
 * CONSOLE tab's three stages (compile, validator 8 frames, C emitter),
 * whose first error finding refuses the dialog, then the bytecode encoder
 * and buildToyRom with the assets. */
function exportStudio(toyPath, files, frames) {
  const source = fs.readFileSync(path.join(ROOT, toyPath), "utf8");
  const findings = [];
  let program = null;
  try {
    program = il.compile(source, { chunkName: "@main.lua" });
  } catch (e) {
    return { code: e && e.code || "il-error",
             message: String(e && e.message || e), warn: [] };
  }
  let report;
  try {
    report = validate.validateProgram(program, {
      chunkName: "@main.lua", frames: frames || 8
    });
  } catch (e) {
    findings.push({ severity: "error", code: e && e.code || "validate-error",
                    message: String(e && e.message || e) });
  }
  if (report) {
    for (const p of report.problems || []) {
      findings.push({ severity: p.severity === "warn" ? "warn" : "error",
                      code: p.code, message: p.message });
    }
  }
  try {
    cgen.emitC(program, { target: "llvm" });
  } catch (e) {
    findings.push({ severity: "error", code: e && e.code || "cgen-error",
                    message: String(e && e.message || e) });
  }
  const errors = findings.filter(function (f) { return f.severity !== "warn"; });
  const warn = findings.filter(function (f) { return f.severity === "warn"; });
  if (errors.length) {
    return { code: errors[0].code, message: errors[0].message, warn: warn };
  }
  try {
    const encoded = ilbc.encode(program);
    const bank0 = fs.readFileSync(BANK0);
    const rom = romLib.buildToyRom({
      bank0: bank0, bytecode: encoded.bytes, assets: assetTail(files)
    });
    return { rom: Buffer.from(rom), source: source, program: program,
             bytecodeBytes: encoded.bytes.length, warn: warn };
  } catch (e) {
    return { code: e && e.code || "error",
             message: String(e && e.message || e), warn: warn };
  }
}

/* ---- the MCP's export_pce route (no C emitter, no assets) --------------
 *
 * The controls and the bytecodeOnly pins run this: renderer/
 * pce-agent-tools.js's export_pce order — pce-validate.js first (8
 * frames), then pce-il.js -> pce-ilbc.js -> pce-rom.js buildToyRom over
 * the committed renderer/ilvm.bin. */
function exportToy(toyPath, frames) {
  const source = fs.readFileSync(path.join(ROOT, toyPath), "utf8");
  let report;
  try {
    report = validate.validate(source, { chunkName: "main.lua",
                                         frames: frames || 8 });
  } catch (e) {
    return { code: e && e.code || "validate-error",
             message: String(e && e.message || e) };
  }
  if (!report.ok) {
    const first = (report.problems || [])[0] || {};
    return { code: report.code || first.code,
             message: first.message || "the validator refused the toy" };
  }
  try {
    const program = il.compile(source, { chunkName: "main.lua" });
    const encoded = ilbc.encode(program);
    const bank0 = fs.readFileSync(BANK0);
    const rom = romLib.buildToyRom({ bank0: bank0, bytecode: encoded.bytes });
    return { rom: Buffer.from(rom), source: source, program: program,
             bytecodeBytes: encoded.bytes.length };
  } catch (e) {
    return { code: e && e.code || "error",
             message: String(e && e.message || e) };
  }
}

/* The source line the table names, re-derived from the IL:
 *   - a cgen-op refusal's "function fn@N, IL line L, instruction `t`"
 *     (the studio's lineOfMessage reads the same L as main.lua:L),
 *   - an ilbc-op refusal's "(function N, pc P)" instruction,
 *   - an ilbc-builtin refusal's first uncarried builtin (only rgb and note
 *     have a bytecode form; the message names no function or pc).
 * A game whose `where` is null (STARFALL: the data bank's plain Error
 * names no line) skips this entirely. */
function checkedWhere(game, program, expect) {
  if (expect.code === "cgen-op") {
    const m = /function (fn@\d+), IL line (\d+), instruction `(\w+)`/
      .exec(expect.message);
    if (!m) return null;
    const fn = program.functions.find(function (f) { return f.name === m[1]; });
    const line = Number(m[2]);
    const ins = fn && fn.code.find(function (i) {
      return i.line === line && i.t === m[3];
    });
    check(!!ins, game.name + ": " + m[1] + " line " + line + " is the " +
          "refused instruction");
    return ins ? "main.lua:" + ins.line : null;
  }
  if (expect.code === "ilbc-op") {
    const m = /function (\d+), pc (\d+)/.exec(expect.message);
    if (!m) return null;
    const fid = Number(m[1]), pc = Number(m[2]);
    const ins = program.functions[fid] && program.functions[fid].code[pc];
    check(!!ins, game.name + ": fn " + fid + " pc " + pc + " is an instruction");
    return ins ? "main.lua:" + ins.line : null;
  }
  if (expect.code === "ilbc-builtin") {
    const m = /builtin `(\w+)`/.exec(expect.message);
    for (let f = 0; f < program.functions.length; f++) {
      const code = program.functions[f].code || [];
      for (let pc = 0; pc < code.length; pc++) {
        const ins = code[pc];
        if (ins.t === "builtin" && ins.name !== "rgb") {
          check(!!m && ins.name === m[1],
                game.name + ": the first uncarried builtin is the one the " +
                "message names (got " + ins.name + ")");
          return "main.lua:" + ins.line;
        }
      }
    }
    check(false, game.name + ": a builtin other than rgb exists to refuse");
    return null;
  }
  return null;
}

/* ---- the emulator: measure, then record and compare a picture ---------- */

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

/* tools/measure-rom.js, the card's instrument.  Its JSON is the contract.
 * A toy whose one-time build outlasts the default 300 frames is measured at
 * its pin's frame count instead (GAME_PINS). */
function measure(romPath, frames) {
  const m = spawnSync(process.execPath,
                      [MEASURE, romPath, "--frames", String(frames || 300)],
                      { cwd: ROOT, encoding: "utf8", timeout: 120000 });
  if (m.status !== 0) {
    return { error: "measure-rom exited " + m.status + ": " +
                    (m.stderr || m.stdout || "").trim().split("\n").slice(-1)[0] };
  }
  try {
    return { json: JSON.parse(m.stdout) };
  } catch (e) {
    return { error: "measure-rom printed no JSON: " +
                    JSON.stringify((m.stdout || "").slice(0, 120)) };
  }
}

/* A `-qtrecord` run: the route tools/capture-ilvm.sh proves.  The movie's
 * frames are the emulated picture, so the dummy SDL video driver is enough
 * and no key or mouse event is sent.  Returns the frame directory. */
async function captureFrames(romPath, outDir, sleepMs, tailOnly) {
  const movie = path.join(outDir, "capture.mov");
  const home = path.join(outDir, "home");
  fs.mkdirSync(path.join(home, "mcs"), { recursive: true });
  const env = Object.assign({}, process.env, {
    MEDNAFEN_HOME: home,
    SDL_VIDEODRIVER: "dummy",
    SDL_AUDIODRIVER: "dummy"
  });
  const args = [
    "-force_module", "pce", "-sound", "0", "-autosave", "1",
    "-pce.slstart", "3", "-pce.slend", "234",
    "-pce.xscale", "1", "-pce.yscale", "1",
    "-qtrecord", movie, "-qtrecord.vcodec", "png",
    "-qtrecord.w_double_threshold", "0",
    "-qtrecord.h_double_threshold", "0",
    romPath
  ];
  const child = spawn(MEDNAFEN, args, { env: env,
                                        stdio: ["ignore", "ignore", "pipe"] });
  let log = "";
  child.stderr.on("data", function (d) { log += d; });
  /* boot, OSD fade, a run of frames; a toy whose one-time build outlasts
   * the default is captured at its pin's length instead (GAME_PINS). */
  await sleep(sleepMs || 5500);
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill("SIGINT"); } catch (e) { /* already gone */ }
  }
  const deadline = Date.now() + 30000;
  while (child.exitCode === null && child.signalCode === null &&
         Date.now() < deadline) {
    await sleep(100);
  }
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill("SIGKILL"); } catch (e) { /* already gone */ }
    return { error: "Mednafen did not stop; log tail: " +
                    log.trim().split("\n").slice(-2).join(" | ") };
  }
  if (!fs.existsSync(movie) || !fs.statSync(movie).size) {
    return { error: "Mednafen recorded no movie; log tail: " +
                    log.trim().split("\n").slice(-2).join(" | ") };
  }
  const frames = path.join(outDir, "frames");
  const m = spawnSync("python3",
    ["-I", MOVFRAMES, movie, tailOnly ? "--tail" : "--all",
     ...(tailOnly ? [String(CAPTURE_TAIL)] : []), frames, "256", "224", "4"],
    { cwd: ROOT, encoding: "utf8", timeout: 120000 });
  if (m.status !== 0) {
    return { error: "movframes.py failed: " +
                    (m.stderr || m.stdout || "").trim() };
  }
  const files = fs.readdirSync(frames)
    .filter(function (f) { return /^frame\d+\.png$/.test(f); }).sort();
  if (!files.length) return { error: "the movie held no complete PNG frame" };
  return { frames: frames, files: files };
}

/* ---- a minimal PNG reader (8-bit RGB, non-interlaced) ------------------ */

function decodePng(buf) {
  if (buf.slice(0, 8).toString("latin1") !== "\x89PNG\r\n\x1a\n") {
    throw new Error("not a PNG");
  }
  let pos = 8, width = 0, height = 0, bitDepth = 0, colourType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.slice(pos + 4, pos + 8).toString("latin1");
    const body = buf.slice(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      bitDepth = body[8]; colourType = body[9];
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
  }
  if (bitDepth !== 8 || colourType !== 2) {
    throw new Error("PNG must be 8-bit RGB");
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 3;
  const out = Buffer.alloc(width * height * 3);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = Buffer.from(raw.slice(p, p + stride));
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? line[i - 3] : 0;
      const b = prev[i];
      const c = i >= 3 ? prev[i - 3] : 0;
      let v = line[i];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      line[i] = v;
    }
    out.set(line, y * stride);
    prev = line;
  }
  return { width: width, height: height, pixels: out };
}

function diff(a, b) {
  const n = Math.min(a.length, b.length);
  let count = 0;
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) count++;
  return count;
}

/* The first row where two pictures differ (1-based), or 0. */
function firstDifferingLine(a, b, width) {
  const row = width * 3;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += row) {
    const end = Math.min(i + row, n);
    for (let k = i; k < end; k++) if (a[k] !== b[k]) return i / row + 1;
  }
  return 0;
}

function sampleHash(pixels) {
  let h = 2166136261;
  for (let i = 0; i < pixels.length; i += 97) {
    h = ((h ^ pixels[i]) * 16777619) >>> 0;
  }
  return h;
}

/* The browser's run of the same toy: the first `count` frames (60 by
 * default).  A game with a long one-time build may be captured hundreds of
 * toy frames in, so its pin asks for a wider window (TOWER: 600). */
function browserFrames(toyPath, count) {
  const source = fs.readFileSync(path.join(ROOT, toyPath), "utf8");
  const browser = toys.create(source, { budgetMs: 2000 });
  browser.load();
  const frames = [];
  const n = count || BROWSER_FRAMES;
  for (let f = 0; f < n; f++) {
    const g = browser.frame(f);
    frames.push({ pixels: g.pixels, hash: sampleHash(g.pixels) });
  }
  browser.dispose();
  return frames;
}

/* Compare the capture's tail against the browser's frames.  Returns
 * { match: k, line: 0 } on diff 0, else { match: -1, line, best, diff }. */
function compareCapture(framesDir, files, want) {
  const tail = files.slice(-CAPTURE_TAIL);
  let best = { match: -1, line: 0, best: null, diff: Infinity, file: null };
  for (const file of tail) {
    const img = decodePng(fs.readFileSync(path.join(framesDir, file)));
    for (let k = 0; k < want.length; k++) {
      const d = diff(img.pixels, want[k].pixels);
      if (d === 0) return { match: k, line: 0, file: file };
      if (d < best.diff) {
        best = { match: -1, file: file, best: k, diff: d,
                 line: firstDifferingLine(img.pixels, want[k].pixels,
                                          img.width) };
      }
    }
  }
  return best;
}

/* The captured frames that have any non-black pixel.  A game that builds
 * but does not play is pinned as an all-black screen: this is the
 * frame-by-frame assertion of that verdict, not a stand-in for a picture it
 * never drew.  An empty list is the verdict (DUSK RUN, #221). */
function notBlack(framesDir, files) {
  const lit = [];
  for (const file of files) {
    const img = decodePng(fs.readFileSync(path.join(framesDir, file)));
    let any = false;
    for (let i = 0; i < img.pixels.length; i++) {
      if (img.pixels[i] !== 0) { any = true; break; }
    }
    if (any) lit.push(file);
  }
  return lit;
}

/* ---- checks ------------------------------------------------------------ */

async function main() {
  console.log("check-export-games: #180/#284 the five games through the " +
              "studio's Export route, and Mednafen on what builds");

  /* The five card games: three are refused by the studio in GAMES, and
   * each that the studio builds is in GAME_PINS (a game the studio refuses
   * whose bytecode-route ROM is still measured is in both, pinned
   * bytecodeOnly) — the card's games are still all five.  GAME_PINS also
   * holds toys that are not card games (#191's SPRITE, marked kind:
   * "toy"), so the five-game tripwire counts only the game pins. */
  const gamePins = Object.keys(GAME_PINS).filter(function (n) {
    return GAME_PINS[n].kind !== "toy";
  });
  const toyPins = Object.keys(GAME_PINS).filter(function (n) {
    return GAME_PINS[n].kind === "toy";
  });
  const cardNames = [];
  for (const g of GAMES) {
    if (cardNames.indexOf(g.name) < 0) cardNames.push(g.name);
  }
  for (const n of gamePins) {
    if (cardNames.indexOf(n) < 0) cardNames.push(n);
  }
  eq("the card's five games are the ones measured",
     cardNames.sort().join(", "),
     "DUSK RUN, NOVA TIDE, PLATFORMER, STARFALL, TOWER");
  for (const g of GAMES) {
    check(fs.existsSync(path.join(ROOT, g.toy)),
          g.name + ": " + g.toy + " exists");
  }

  /* The studio's Export on each refused game: the dialog's exact text,
   * whole, and the table's line re-derived from the IL. */
  for (const game of GAMES) {
    const files = studioFiles(game.galleryId);
    check(!!files, game.name + ": the gallery has the studio's file set");
    const out = exportStudio(game.toy, files);
    if (out.rom) {
      check(false, game.name + ": the studio refused the export, got a " +
            "built ROM instead — its refusal moved; update GAMES and the " +
            "table");
      continue;
    }
    eq(game.name + ": the studio's refusal code", out.code, game.expect.code);
    eq(game.name + ": the studio's refusal message, exact text",
       out.message, game.expect.message);
    console.log("      " + game.name + " (studio): refused " + out.code +
                " — " + out.message);
    if (out.warn && out.warn.length) {
      console.log("      " + game.name + ": " + out.warn.length +
                  " warning(s), not a refusal — " +
                  out.warn.map(function (w) { return w.code; }).join(", "));
    }
    if (game.where) {
      let program;
      try {
        program = il.compile(fs.readFileSync(path.join(ROOT, game.toy), "utf8"),
                             { chunkName: "@main.lua" });
      } catch (e) {
        check(false, game.name + ": the IL compiles for the line check");
      }
      if (program) {
        eq(game.name + ": the table's line is the IL's",
           checkedWhere(game, program, game.expect), game.where);
      }
    }
    /* A game the bytecode route refuses differently: export_pce's verdict
     * is tripwired too, with its own line. */
    if (game.bytecode) {
      const bc = exportToy(game.toy);
      if (bc.rom) {
        check(false, game.name + ": the bytecode route refused the toy, " +
              "got a built ROM — update the bytecode expect");
        continue;
      }
      eq(game.name + " (bytecode route): refusal code",
         bc.code, game.bytecode.code);
      eq(game.name + " (bytecode route): refusal message",
         bc.message, game.bytecode.message);
      let program;
      try {
        program = il.compile(fs.readFileSync(path.join(ROOT, game.toy), "utf8"),
                             { chunkName: "main.lua" });
      } catch (e) {
        check(false, game.name + ": the IL compiles for the bytecode line " +
              "check");
      }
      if (program) {
        eq(game.name + " (bytecode route): the table's line is the IL's",
           checkedWhere(game, program, game.bytecode), game.bytecodeWhere);
      }
    }
  }

  /* The games the studio builds, and the bytecodeOnly pins (the studio
   * refuses them — GAMES above — but their interpreter ROM is still
   * measured, so the bytecode route builds them). */
  const studioBuilt = [];
  const bytecodeBuilt = [];
  for (const n of gamePins) {
    const pin = GAME_PINS[n];
    let out;
    if (pin.bytecodeOnly) {
      out = exportToy(pin.toy);
    } else {
      const files = studioFiles(pin.galleryId);
      check(!!files, n + ": the gallery has the studio's file set");
      out = exportStudio(pin.toy, files);
      /* A no-art game's studio build is the bytecode route's bytes: the
       * asset tail is empty and the C emitter accepted it, so the pinned
       * sha (made by the old no-asset route) still holds. */
      if (out.rom) {
        const bc = exportToy(pin.toy);
        eq(n + ": the studio's build is the bytecode route's (no assets)",
           sha256(out.rom), bc.rom ? sha256(bc.rom) : "refused");
      }
    }
    if (out.rom) {
      (pin.bytecodeOnly ? bytecodeBuilt : studioBuilt)
        .push({ game: pin, name: n, out: out });
      eq(n + ": builds a " + ROM_BYTES + "-byte ROM",
         out.rom.length, ROM_BYTES);
      eq(n + ": the ROM is the pinned one", sha256(out.rom), pin.rom);
      continue;
    }
    check(false, n + ": a pinned game refused on " +
          (pin.bytecodeOnly ? "the bytecode route" : "the studio's route") +
          " — " + out.code + " — " + out.message);
  }
  eq("the number of exporting games matches the pins",
     studioBuilt.length + bytecodeBuilt.length, gamePins.length);

  /* NOVA TIDE's asset tail: the table records it (192,089 B) as the data
   * bank's next refusal after the C emitter's, so the suite computes it. */
  {
    const nova = GAMES.find(function (g) { return g.name === "NOVA TIDE"; });
    const tail = assetTail(studioFiles(nova.galleryId));
    eq("NOVA TIDE's asset tail is the table's 192,089 B",
       tail ? tail.length : 0, 192089);
  }

  /* The control: the route, the counters and the comparison all work on a
   * toy that exports, so "nothing built" is not an instrument that cannot
   * see a success. */
  const control = exportToy(CONTROL.toy);
  check(!!control.rom, "control: " + CONTROL.toy + " exports");
  if (control.rom) {
    eq("control: builds a " + ROM_BYTES + "-byte ROM",
       control.rom.length, ROM_BYTES);
    eq("control: the ROM is the pinned one", sha256(control.rom),
       CONTROL.rom);
  }

  /* #183: the 5-8 argument toy builds through the same route and is what
   * proves the extra-argument block on the console, not just on the host. */
  const wide = exportToy(WIDE.toy);
  check(!!wide.rom, "wide: " + WIDE.toy + " exports (5-8 parameters)");
  if (wide.rom) {
    eq("wide: builds a " + ROM_BYTES + "-byte ROM", wide.rom.length,
       ROM_BYTES);
    eq("wide: the ROM is the pinned one", sha256(wide.rom), WIDE.rom);
  }

  /* #187: the not toy builds through the same route and is what proves the
   * logical not on the console, not just on the host. */
  const nott = exportToy(NOT.toy);
  check(!!nott.rom, "not: " + NOT.toy + " exports (branches on not)");
  if (nott.rom) {
    eq("not: builds a " + ROM_BYTES + "-byte ROM", nott.rom.length,
       ROM_BYTES);
    eq("not: the ROM is the pinned one", sha256(nott.rom), NOT.rom);
  }

  /* #191: the sprite toy rides GAME_PINS as a kind: "toy" pin, not one of
   * the five games.  It builds through the same route and the loop below
   * measures it, captures it and checks its ROM sha and picture against
   * the pin. */
  const toyOut = {};
  for (const n of toyPins) {
    const out = exportToy(GAME_PINS[n].toy);
    toyOut[n] = out;
    check(!!out.rom, n + ": " + GAME_PINS[n].toy + " exports (sprite op)");
    if (out.rom) {
      eq(n + ": builds a " + ROM_BYTES + "-byte ROM", out.rom.length,
         ROM_BYTES);
      eq(n + ": the ROM is the pinned one", sha256(out.rom),
         GAME_PINS[n].rom);
    }
  }

  if (!fs.existsSync(MEDNAFEN)) {
    console.log("SKIP  mednafen not found at " + MEDNAFEN +
                " (set MEDNAFEN to its path); the counters and the picture " +
                "comparison cannot run, but every export refusal and build " +
                "above was checked");
    return report();
  }
  if (!fs.existsSync(MOVFRAMES)) {
    console.log("SKIP  " + MOVFRAMES + " is missing; the picture capture " +
                "cannot run");
    return report();
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pce-games-"));
  try {
    const work = [];
    if (control.rom) {
      work.push({ name: "control", key: "control", toy: CONTROL.toy,
                  out: control });
    }
    if (wide.rom) {
      work.push({ name: "wide-arity", key: "wide", toy: WIDE.toy,
                  out: wide });
    }
    if (nott.rom) {
      work.push({ name: "not", key: "not", toy: NOT.toy, out: nott });
    }
    for (const n of toyPins) {
      if (toyOut[n] && toyOut[n].rom) {
        work.push({ name: n, key: n, toy: GAME_PINS[n].toy, out: toyOut[n] });
      }
    }
    for (const b of studioBuilt.concat(bytecodeBuilt)) {
      work.push({ name: b.name, key: b.name, toy: b.game.toy, out: b.out });
    }

    for (const w of work) {
      const dir = path.join(tmp, w.name.replace(/[^A-Za-z0-9]+/g, "-"));
      fs.mkdirSync(dir, { recursive: true });
      const romPath = path.join(dir, "toy.pce");
      fs.writeFileSync(romPath, w.out.rom);
      const pin = GAME_PINS[w.key] || {};

      /* 1. the speed counters, through the card's own instrument */
      const m = measure(romPath, pin.measureFrames);
      check(!!m.json, w.name + ": tools/measure-rom.js reads the counters" +
            (m.error ? " — " + m.error : ""));
      if (m.json) {
        check(m.json.frames > 0, w.name + ": the ROM ran updates (" +
              m.json.frames + ")");
        check(["60 Hz", "30 Hz", "too slow"].indexOf(m.json.verdict) >= 0,
              w.name + ": verdict is one of the three bands (" +
              JSON.stringify(m.json.verdict) + ")");
        console.log("      " + w.name + ": " + m.json.frames + " updates, " +
                    m.json.overruns + " overruns, worst " +
                    m.json.worstUpdateLines + " lines, " + m.json.verdict);
      }

      /* 2. the picture, against the browser's frames — or, for a game that
       * exports but does not play, the all-black screen and the reason. */
      let want = null, cmp = null;
      const cap = await captureFrames(romPath, dir, pin.captureMs,
                                      pin.captureTail);
      if (cap.error) {
        check(false, w.name + ": the picture captured — " + cap.error);
        continue;
      }
      if (pin.black) {
        const lit = notBlack(cap.frames, cap.files);
        check(lit.length === 0, w.name + ": every captured frame is black " +
              "(the screen Mednafen shows: does not play)" +
              (lit.length ? " — " + lit.length + " of " + cap.files.length +
               " frames have pixels, first " + lit[0] : ""));
        console.log("      " + w.name + ": " + cap.files.length +
                    " captured frames, all black; " + pin.black);
      } else if (pin.unmatched) {
        /* #222: the game draws but no frame is the browser's yet.  Both
         * halves are asserted, so the pin cannot go stale silently. */
        const lit = notBlack(cap.frames, cap.files);
        check(lit.length > 0, w.name + ": the screen is not black — the " +
              "container runs and draws");
        want = browserFrames(w.toy, pin.browserFrames);
        cmp = compareCapture(cap.frames, cap.files, want);
        check(cmp.match < 0, w.name + ": no captured frame is the browser's " +
              "picture yet; one is (browser frame " + cmp.match +
              ") — pin its hash and delete `unmatched`");
        console.log("      " + w.name + ": " + cap.files.length +
                    " captured frames, not black, no browser match (closest " +
                    "frame " + cmp.best + ", " + cmp.diff + " bytes differ); " +
                    pin.unmatched);
      } else {
        want = browserFrames(w.toy, pin.browserFrames);
        cmp = compareCapture(cap.frames, cap.files, want);
        if (cmp.match >= 0) {
          console.log("      " + w.name + ": captured frame " + cmp.file +
                      " is diff 0 against browser frame " + cmp.match);
        }
        check(cmp.match >= 0, w.name + ": the emulator's picture is diff 0 " +
              "against a browser frame" +
              (cmp.match < 0 ? " (closest browser frame " + cmp.best +
               ", first differing line " + cmp.line + ", " + cmp.diff +
               " bytes differ)" : ""));
      }

      /* 3. the pin: the ROM sha, and for the controls their picture cycle */
      if (w.key === "control") {
        if (cmp.match >= 0) {
          check(CONTROL.frames.indexOf(want[cmp.match].hash) >= 0,
                "control: the emulator matches one of the pinned eight " +
                "pictures (browser frame " + cmp.match + ", " +
                "hash " + want[cmp.match].hash + ")");
        }
      } else if (w.key === "wide") {
        if (cmp.match >= 0) {
          check(WIDE.frames.indexOf(want[cmp.match].hash) >= 0,
                "wide-arity: the emulator matches one of the pinned sixteen " +
                "pictures (browser frame " + cmp.match + ", " +
                "hash " + want[cmp.match].hash + ")");
        }
      } else if (w.key === "not") {
        if (cmp.match >= 0) {
          check(NOT.frames.indexOf(want[cmp.match].hash) >= 0,
                "not: the emulator matches one of the pinned four pictures " +
                "(browser frame " + cmp.match + ", " +
                "hash " + want[cmp.match].hash + ")");
        }
      } else if (pin.rom) {
        eq(w.name + ": the ROM is the pinned one", sha256(w.out.rom),
           pin.rom);
        if (pin.black) {
          /* The pin's picture evidence is the black screen the branch above
           * asserted; there is no browser frame to match. */
          check(!!m.json && m.json.frames > 0,
                w.name + ": the counters advance on the black screen");
        } else if (pin.unmatched) {
          /* The unmatched branch above asserted the picture's state. */
          check(!!m.json && m.json.frames > 0,
                w.name + ": the counters advance while it draws");
        } else if (pin.framesAny) {
          /* A game whose picture changes every frame cannot pin a small
           * cycle of hashes; the ROM sha pins the bytes and the comparison
           * above proves the captured frame is the browser's at the toy
           * frame the ROM reached. */
          check(cmp.match >= 0,
                w.name + ": the emulator's picture is one of the browser's " +
                "frames");
          check(!!m.json && m.json.frames > 0,
                w.name + ": the counters advance while it draws");
        } else {
          check(cmp.match >= 0 &&
                pin.frames.indexOf(want[cmp.match].hash) >= 0,
                w.name + ": the emulator matches one of the pinned pictures");
        }
      }
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ok */ }
  }

  return report();
}

function report() {
  if (failures.length) {
    console.log("FAIL " + failures.length + " of " + checks + " checks");
    process.exit(1);
  }
  console.log("PASS " + checks + " checks");
}

main().catch(function (e) {
  console.log("FAIL  the suite threw: " + (e && e.stack || e));
  process.exit(1);
});
