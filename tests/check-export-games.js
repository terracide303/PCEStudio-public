#!/usr/bin/env node
/*
 * tests/check-export-games.js — #180's evidence: the five real games through
 * the studio's own export route, and what the emulator actually does with
 * each ROM that comes out.
 *
 *   node tests/check-export-games.js
 *
 * THE ROUTE.  renderer/pce-agent-tools.js's export_pce is the instrument:
 * renderer/pce-validate.js first (8 frames), then renderer/pce-il.js ->
 * renderer/pce-ilbc.js -> renderer/pce-rom.js buildToyRom over the
 * committed renderer/ilvm.bin.  No compiler is called.  This suite makes
 * the same calls in the same order, so a refusal here is the refusal the
 * MCP tool returns and docs/ROM_SPEED.md's table records.
 *
 * WHAT IS CHECKED
 *
 *   1. The five games the card names (STARFALL, TOWER, NOVA TIDE, DUSK RUN,
 *      PLATFORMER) each reach the outcome the table records: either a
 *      refusal with that code and message, or a built 40,960-byte ROM.  The
 *      source line the table names is checked against the IL (a function's
 *      definition line, the 128th constant, the refused instruction's own
 *      line, or the first refused builtin's line — or null, when the
 *      refusal names none: the data bank's plain Error), so the
 *      table's "line" column is reproducible and not a comment.  A blocker
 *      that lands moves the refusal: this pin goes red and asks for the
 *      table and the pin to be updated — a tripwire, not a broken test.
 *   2. Every game that exports is measured with tools/measure-rom.js
 *      (Mednafen, headless) and its picture is compared with the browser's
 *      frames of the same toy: the tail of a `-qtrecord` capture must be
 *      diff 0 against one of the browser's first BROWSER_FRAMES frames.
 *      A game whose one-time build outlasts the default 300-frame measure
 *      or 5.5 s capture tail is pinned with its own measure frame count and
 *      capture length (GAME_PINS) — PLATFORMER is that game since #186.
 *      A game that exports and runs but whose displayed frame is not the
 *      browser's yet (DUSK RUN, #222/#223) is pinned as its ROM sha plus
 *      `unmatched`: the capture must be not black AND not a browser frame,
 *      so either half going stale fails and asks for a re-pin.
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
const romLib = require("../renderer/pce-rom.js");
const toys = require("../renderer/pce-toys.js");
const validate = require("../renderer/pce-validate.js");

const ROOT = path.join(__dirname, "..");
const MEDNAFEN = process.env.MEDNAFEN || "/opt/homebrew/bin/mednafen";
const MEASURE = path.join(ROOT, "tools", "measure-rom.js");
const MOVFRAMES = path.join(ROOT, "tools", "movframes.py");
const BANK0 = path.join(ROOT, "renderer", "ilvm.bin");

const BROWSER_FRAMES = 60;          /* the browser frames a capture may match */
const CAPTURE_TAIL = 12;            /* the movie's last frames, like check-ilvm */
const ROM_BYTES = 40960;            /* 32 KiB image + one data bank */

/* The card's five games and the outcome docs/ROM_SPEED.md records (2026-10-31;
 * DUSK RUN moved to the encoder's refusal by #184, the three games' sat
 * refusals moved on by #186, PLATFORMER now builds and moved to GAME_PINS
 * below, #197 carried note and the sfx instruction, and #215's interpreter
 * reads the version-3 container: TOWER now stops at the data bank and NOVA
 * TIDE at its first raster, 2026-11-02.  DUSK RUN builds, loads, runs and
 * draws since #222, and moved to GAME_PINS below; its displayed frame is
 * not the browser's yet (#223) — see its pin).
 * `where` is the source line the table names; null is what the validator's
 * own finding can say (it names no line for a frame-wide budget) or what a
 * refusal without function or pc says (the data bank).  `message` is
 * a substring of the refusal the suite insists on, so a message that loses
 * its detail fails too. */
const GAMES = [
  {
    name: "STARFALL", toy: "toys/demo-game/main.lua",
    expect: { code: "ilbc-range", message: "more than 127 constants" },
    where: "main.lua:168"
  },
  {
    /* #186 carried sat, #187 `not`, and #197 carried the sfx instruction —
     * so TOWER's bytecode route encodes fully and buildToyRom refused the
     * version-3 container (the committed interpreter only read versions 1
     * and 2).  #215's interpreter reads version 3, so TOWER's encoding now
     * passes the version gate and stops at the data bank instead: its
     * bytecode (8,524 B) is over the 8 KiB data bank the interpreter reads.
     * The refusal names no function or pc, so the table's `where` is null
     * and exportToy records the buildToyRom code. */
    name: "TOWER", toy: "toys/tower/main.lua",
    expect: { code: "toy-data-bank-full",
              message: "the interpreter reads one 8 KiB data bank" },
    where: null
  },
  {
    /* #186 carried sat and #197 carried note and sfx; NOVA TIDE's next
     * blocker is its first raster (the raster instruction has no bytecode
     * form). */
    name: "NOVA TIDE", toy: "toys/nova-tide/main.lua",
    expect: { code: "ilbc-op",
              message: "instruction raster (function 34, pc 53) has no bytecode form" },
    where: "main.lua:530"
  }
];

/* A game that starts exporting gets {rom, frames} here (its ROM sha, its
 * picture-cycle hashes, and the measure/capture wall time its boot needs —
 * see PLATFORMER's comment), added with its row in docs/ROM_SPEED.md. */
const GAME_PINS = {
  /* #186: sat carried, so PLATFORMER builds.  Its one-time build (init()
   * draws the whole map and the sprite patterns through the interpreter)
   * takes ~7 s of wall on the dummy SDL driver: the default 300-frame
   * measure (≈7 s) lands inside the boot and reads 0 updates, and the
   * default 5.5 s capture tail is still pre-scene.  The pin records the
   * wall time that clears the boot: 900 measured frames (312 updates, all
   * overrunning, worst 311 lines — "30 Hz") and a 12 s capture.  The
   * picture is the game's static no-input scene (the hero stands on the
   * grass), so the pin holds that one hash. */
  /* Every ROM embeds the committed renderer/ilvm.bin, so these shas move
   * with any interpreter change (#187's opcode moved all three). */
  "PLATFORMER": {
    toy: "toys/platformer/main.lua",
    rom: "378b0fcf7341fef34a327353e0fbc5b9934cacf6a1fa495bad363ecd3d6e7223",
    frames: [1261564552],
    measureFrames: 900,
    captureMs: 12000
  },
  /* #222: DUSK RUN's container now loads and runs: MAX_REGS 41 carries the
   * frame hook's 41 registers, MAX_FUNCS 41 its 41 functions, and the upvalue
   * pool carries function 39's 19 upvalues.  **It draws, and it is not yet
   * the browser's picture.**  The interpreter's VRAM/CRAM/SAT are byte-equal
   * to the browser's at frame 3 (a Mednafen save state, `-DILVM_HOST` parity
   * in check-ilvm), but the raster backend shows a collected frame on one
   * display frame per toy frame: DUSK's build step takes ~37 display frames
   * (docs/ROM_SPEED.md's 0.26 Hz build projection), so a short capture's
   * tail is a stale screen, and the best replay frame found in a 20 s movie
   * differs by 16 bytes on one scanline (row 16, the raster write's line
   * latency).  Until that is pinned, the pin records the ROM sha and asserts
   * the game is NOT black and NOT yet a browser frame; a capture that does
   * match fails here and asks for its hash.  Card #223 carries the raster
   * picture.  It also needs its own capture window: the boot that draws the
   * base takes ~7 s on the dummy SDL driver. */
  "DUSK RUN": {
    toy: "toys/dusk-run/main.lua",
    rom: "6524513ae6879f823d1a6a68f5a6e538cdd8786e1b3327e1915bd18e99d31148",
    frames: [],
    unmatched: "the container runs and draws; no captured frame is the browser's picture yet (raster scanline latency, #223)",
    measureFrames: 600,
    captureMs: 12000
  },
  /* #191: tools/toys/sprite.lua, the sprite op on the exported route.  It
   * is not one of the card's five games, so `kind: "toy"` keeps it out of
   * the five-game tripwire below; it rides GAME_PINS so it is measured,
   * captured and pinned by the same instrument as a game that exports.
   * Its three sprite specs are constants (#188), so the picture is the
   * same every frame: one pinned hash is the whole cycle.  The console's
   * SAT words for this toy are compared in tests/check-ilvm.js's
   * tests/dumps/toysprite-ilvm dump. */
  "SPRITE": {
    kind: "toy",
    toy: "tools/toys/sprite.lua",
    rom: "467ce0c80258b1eddfd549370dc85ad7bf2b39ebc1db9a8282b6be0665a0a259",
    frames: [1994475180]
  }
};

/* The control, pinned now so the pinning path is itself covered: the palette
 * toy builds to one ROM and its picture repeats every eight frames. */
const CONTROL = {
  toy: "tools/toys/palette.lua",
  rom: "83a3f912c1b83cc1027bfebf176f2d9c2c92b4f5168ceef9c29d3d376ecd3e94",
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
  rom: "73925817a04be835b864ea737dbee96b20ee22fad39a1baa43571bd8e97502a5",
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
 * hashes are the whole cycle. */
const NOT = {
  toy: "tools/toys/not.lua",
  rom: "a29563f29100536f32cd31f3cb101c66000949e9fb6eeec747eb4f1cf9c321e6",
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

/* ---- the export route, exactly export_pce's order ---------------------- */

/* Returns {rom, source, program} or {code, message} — never throws. */
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

/* Replays pce-ilbc.js's pass-1 constant scan: each function in order, each
 * instruction's `k` first and then its operands, deduped by key.  The
 * encoder refuses on the 128th; this returns the instruction that would
 * cross the ceiling, so the table can name a line the encoder does not. */
function constantCeiling(program) {
  const MAX_CONST = 127;
  function kKey(k) {
    if (!k) return null;
    if (k.t === "int") return "i:" + (k.v | 0);
    if (k.t === "bool") return "b:" + (k.v ? 1 : 0);
    if (k.t === "nil") return "n:";
    return "?" + k.t;
  }
  const seen = new Set();
  function see(op, ins) {
    if (!op || op.r != null || !op.k) return null;
    const key = kKey(op.k);
    if (seen.has(key)) return null;
    if (seen.size >= MAX_CONST) return { line: ins.line, t: ins.t, k: op.k };
    seen.add(key);
    return null;
  }
  const operands = ["a", "b", "cond", "src", "addr", "word", "value"];
  for (let f = 0; f < program.functions.length; f++) {
    const code = program.functions[f].code || [];
    for (let pc = 0; pc < code.length; pc++) {
      const ins = code[pc];
      let hit = see(ins.k ? { k: ins.k } : null, ins);
      if (hit) return hit;
      for (const field of operands) {
        hit = see(ins[field], ins);
        if (hit) return hit;
      }
      if (ins.args) for (const a of ins.args) {
        hit = see(a, ins);
        if (hit) return hit;
      }
    }
  }
  return null;
}

/* The source line the table names, re-derived from the IL:
 *   - STARFALL's 128th constant (the encoder names no line),
 *   - an ilbc-op refusal's "(function N, pc P)" instruction,
 *   - an ilbc-builtin refusal's first uncarried builtin (only rgb and note
 *     have a bytecode form; the message names no function or pc).
 * A game whose `where` is null (TOWER: the data bank's plain Error names no
 * line) skips this entirely. */
function checkedWhere(game, program) {
  if (game.name === "STARFALL") {
    const hit = constantCeiling(program);
    check(!!hit, "STARFALL: the constant scan finds the 128th constant");
    return hit ? "main.lua:" + hit.line : null;
  }
  if (game.expect.code === "ilbc-op") {
    const m = /function (\d+), pc (\d+)/.exec(game.expect.message);
    if (!m) return null;
    const fid = Number(m[1]), pc = Number(m[2]);
    const ins = program.functions[fid] && program.functions[fid].code[pc];
    check(!!ins, game.name + ": fn " + fid + " pc " + pc + " is an instruction");
    return ins ? "main.lua:" + ins.line : null;
  }
  if (game.expect.code === "ilbc-builtin") {
    const m = /builtin `(\w+)`/.exec(game.expect.message);
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
async function captureFrames(romPath, outDir, sleepMs) {
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
    ["-I", MOVFRAMES, movie, "--all", frames, "256", "224", "4"],
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

/* The browser's run of the same toy: the first BROWSER_FRAMES frames. */
function browserFrames(toyPath) {
  const source = fs.readFileSync(path.join(ROOT, toyPath), "utf8");
  const browser = toys.create(source, { budgetMs: 2000 });
  browser.load();
  const frames = [];
  for (let f = 0; f < BROWSER_FRAMES; f++) {
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

/* The captured frames that have any non-black pixel.  A game that exports
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
  console.log("check-export-games: #180 the five games through export_pce's " +
              "route, and Mednafen on what builds");

  /* The five card games: three are refused in GAMES, and each that starts
   * exporting moves to GAME_PINS — the card's games are still all five.
   * GAME_PINS also holds toys that are not card games (#191's SPRITE,
   * marked kind: "toy"), so the five-game tripwire counts only the game
   * pins.  DUSK RUN's pin is a build with no picture (all black, #221);
   * the loop below still measures it and asserts the screen. */
  const gamePins = Object.keys(GAME_PINS).filter(function (n) {
    return GAME_PINS[n].kind !== "toy";
  });
  const toyPins = Object.keys(GAME_PINS).filter(function (n) {
    return GAME_PINS[n].kind === "toy";
  });
  const cardGames = GAMES.concat(gamePins.map(function (n) {
    return { name: n, toy: GAME_PINS[n].toy, expect: null };
  }));
  eq("the card's five games are the ones measured",
     cardGames.map(function (g) { return g.name; }).sort().join(", "),
     "DUSK RUN, NOVA TIDE, PLATFORMER, STARFALL, TOWER");
  for (const game of cardGames) {
    check(fs.existsSync(path.join(ROOT, game.toy)),
          game.name + ": " + game.toy + " exists");
  }

  const builtGames = [];
  for (const game of cardGames) {
    const out = exportToy(game.toy);
    if (out.rom) {
      builtGames.push({ game: game, out: out });
      eq(game.name + ": builds a " + ROM_BYTES + "-byte ROM",
         out.rom.length, ROM_BYTES);
      check(!!GAME_PINS[game.name],
            game.name + " exports now: add its ROM sha and picture hashes " +
            "to GAME_PINS and its row to docs/ROM_SPEED.md");
      continue;
    }
    if (!game.expect) {
      check(false, game.name + ": a pinned game refused — " + out.code +
            " — " + out.message);
      continue;
    }
    eq(game.name + ": refusal code", out.code, game.expect.code);
    check(out.message.indexOf(game.expect.message) >= 0,
          game.name + ": refusal message names `" + game.expect.message +
          "` (got " + JSON.stringify(out.message) + ")");
    console.log("      " + game.name + ": refused " + out.code + " — " +
                out.message);

    /* The table's line column, re-derived from the IL. */
    if (game.where) {
      let program;
      try {
        program = il.compile(fs.readFileSync(path.join(ROOT, game.toy), "utf8"),
                             { chunkName: "main.lua" });
      } catch (e) {
        check(false, game.name + ": the IL compiles for the line check");
      }
      if (program) {
        eq(game.name + ": the table's line is the IL's",
           checkedWhere(game, program), game.where);
      }
    }
  }
  eq("the number of exporting games matches the pins", builtGames.length,
     gamePins.length);
  if (!builtGames.length) {
    console.log("      no game exports today — docs/ROM_SPEED.md's table " +
                "records the five refusals");
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
    for (const b of builtGames) {
      work.push({ name: b.game.name, key: b.game.name, toy: b.game.toy,
                  out: b.out });
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
      const cap = await captureFrames(romPath, dir, pin.captureMs);
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
        want = browserFrames(w.toy);
        cmp = compareCapture(cap.frames, cap.files, want);
        check(cmp.match < 0, w.name + ": no captured frame is the browser's " +
              "picture yet; one is (browser frame " + cmp.match +
              ") — pin its hash and delete `unmatched`");
        console.log("      " + w.name + ": " + cap.files.length +
                    " captured frames, not black, no browser match (closest " +
                    "frame " + cmp.best + ", " + cmp.diff + " bytes differ); " +
                    pin.unmatched);
      } else {
        want = browserFrames(w.toy);
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
