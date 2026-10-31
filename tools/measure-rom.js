#!/usr/bin/env node
/*
 * tools/measure-rom.js — #169: measure a toy ROM's real speed in Mednafen.
 *
 *   node tools/measure-rom.js <rom.pce> [--frames N]
 *
 * Runs the ROM in Mednafen for about N video frames, reads the interpreter
 * ROM's own counters out of the emulator's save state, and prints:
 *
 *   {"frames":..., "overruns":..., "worstUpdateLines":..., "verdict":"..."}
 *
 * The ROM is tools/ilvm/ilvm_runtime.c's: one "update" is frame() for a toy
 * with no raster() callback and frame() plus its 224-call collection for
 * one with a raster hook.  It counts an OVERRUN when a VBlank arrives
 * before the update finishes, and keeps the longest update in scanlines.
 * The cells and their fixed BaseRAM addresses are in docs/ROM_LAYOUT.md
 * (§ "The interpreter ROM's speed counters"); docs/ROM_SPEED.md explains
 * the method, the verdict and why the save state is the readback route.
 *
 * THE ROUTE.  Mednafen 1.32.1 has no scriptable debug read: its debugger is
 * an interactive on-screen UI, and the only machine-readable state it
 * writes is the autosave .mca on a clean exit.  That is the route this repo
 * already proves in tools/capture-ilvm.sh (Mednafen -> SIGINT -> .mca ->
 * tools/mcs-extract.py), so this tool drives exactly that and parses the
 * same BaseRAM image.  A debug read would need a second, unproven channel.
 * SDL's dummy video driver keeps the run windowless; no key or mouse event
 * is ever sent.
 *
 * Exit status: 0 with the JSON on stdout; 2 when Mednafen or the save state
 * is missing (tests/check-measure-rom.js turns that into a SKIP).
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const MEDNAFEN = process.env.MEDNAFEN || "/opt/homebrew/bin/mednafen";
const MCS_EXTRACT = path.join(ROOT, "tools", "mcs-extract.py");

/* One console frame is 262 scanlines (240 displayed + 22 blanking); the
 * verdict is about how many of them the longest update needs. */
const FRAME_LINES = 262;

/* Fixed BaseRAM cells, docs/ROM_LAYOUT.md.  ram.bin starts at $2000. */
const CELLS = {
  updates: 0x120,        /* $2120 u16 */
  overruns: 0x122,       /* $2122 u16 */
  worstLines: 0x124,     /* $2124 u16 */
  totalLines: 0x126      /* $2126 u32 */
};

function usage(msg) {
  if (msg) console.error("measure-rom: " + msg);
  console.error("usage: node tools/measure-rom.js <rom.pce> [--frames N]");
  process.exit(2);
}

function parseArgs(argv) {
  let rom = null;
  let frames = 300;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--frames") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1) usage("--frames needs a positive integer");
      frames = n;
    } else if (a === "--help" || a === "-h") {
      usage();
    } else if (a[0] === "-") {
      usage("unknown option " + a);
    } else if (!rom) {
      rom = a;
    } else {
      usage("one ROM at a time");
    }
  }
  if (!rom) usage("no ROM given");
  return { rom: path.resolve(rom), frames: frames };
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

/* SIGINT, then wait for the process to exit (Mednafen saves on CloseGame);
 * SIGKILL after 30 s so a wedged run cannot hang the suite. */
function stop(child) {
  return new Promise(function (resolve) {
    let done = false;
    const finish = function (ok) {
      if (done) return;
      done = true;
      resolve(ok);
    };
    /* the listener goes on first, so an exit between the check and the
     * signal cannot be missed */
    child.once("exit", function () { finish(true); });
    if (child.exitCode !== null || child.signalCode !== null) {
      finish(true);
      return;
    }
    try { child.kill("SIGINT"); } catch (e) { /* already gone */ }
    const timer = setTimeout(function () {
      try { child.kill("SIGKILL"); } catch (e) { /* already gone */ }
      finish(false);
    }, 30000);
    timer.unref();
  });
}

function read16(buf, off) {
  return buf[off] | (buf[off + 1] << 8);
}

function read32(buf, off) {
  return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) |
          (buf[off + 3] << 24)) >>> 0;
}

function verdictOf(overruns, worstLines) {
  if (overruns === 0) return "60 Hz";
  if (worstLines <= 2 * FRAME_LINES) return "30 Hz";
  return "too slow";
}

async function measure(rom, frames) {
  if (!fs.existsSync(rom)) usage("no such ROM: " + rom);
  if (!fs.existsSync(MEDNAFEN)) {
    throw new Error("mednafen not found at " + MEDNAFEN +
                    " (set MEDNAFEN to its path)");
  }
  if (!fs.existsSync(MCS_EXTRACT)) {
    throw new Error("missing " + MCS_EXTRACT);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pce-measure-"));
  const home = path.join(tmp, "home");
  const mcs = path.join(home, "mcs");
  fs.mkdirSync(mcs, { recursive: true });

  const env = Object.assign({}, process.env, {
    MEDNAFEN_HOME: home,
    /* The dummy SDL video driver keeps the run windowless; the audio driver
     * is moot with -sound 0 but keeps SDL from touching the host's audio. */
    SDL_VIDEODRIVER: "dummy",
    SDL_AUDIODRIVER: "dummy"
  });

  const args = ["-force_module", "pce", "-sound", "0", "-autosave", "1", rom];
  let log = "";
  let child;
  try {
    child = spawn(MEDNAFEN, args, { env: env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", function (d) { log += d; });
    child.stderr.on("data", function (d) { log += d; });

    /* Boot is ~1 s; 55 fps is the floor the wall clock is asked for, so a
     * loaded host still runs at least the requested emulated frames.  The
     * ROM never exits on its own, so the run is stopped after the sleep. */
    await sleep(1500 + Math.ceil(frames * 1000 / 55));
    await stop(child);
  } catch (e) {
    throw new Error("could not run Mednafen: " + e.message);
  }

  const state = fs.readdirSync(mcs)
    .filter(function (f) { return /\.mca$/.test(f); })
    .map(function (f) { return path.join(mcs, f); })[0];
  if (!state) {
    throw new Error("Mednafen wrote no save state in " + mcs +
                    " (log tail: " + log.trim().split("\n").slice(-3).join(" | ") +
                    ")");
  }

  const out = path.join(tmp, "out");
  const extract = spawnSync("python3",
    ["-I", MCS_EXTRACT, state, out, "--ram"],
    { cwd: ROOT, encoding: "utf8" });
  if (extract.status !== 0) {
    throw new Error("mcs-extract.py failed: " +
                    (extract.stderr || extract.stdout || "").trim());
  }
  const ram = fs.readFileSync(path.join(out, "ram.bin"));
  if (ram.length < 0x12A) {
    throw new Error("ram.bin is " + ram.length + " B; the counters need 0x12A");
  }

  const result = {
    frames: read16(ram, CELLS.updates),
    overruns: read16(ram, CELLS.overruns),
    worstUpdateLines: read16(ram, CELLS.worstLines)
  };
  /* A ROM that crashed, or one with no frame() hook, runs no update.  That
   * is "no measurement", not a 60 Hz result (0 overruns would say 60). */
  if (result.frames === 0) {
    throw new Error("the ROM measured no update (it crashed, or its toy " +
                    "has no frame() hook); nothing to read at $2120");
  }
  result.verdict = verdictOf(result.overruns, result.worstUpdateLines);

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ok */ }
  return {
    json: result,
    meanLines: result.frames
      ? read32(ram, CELLS.totalLines) / result.frames : 0
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  try {
    const m = await measure(opts.rom, opts.frames);
    /* The JSON is the contract (tests parse it); the human line goes to
     * stderr so a pipe of stdout stays machine-readable. */
    console.error("measure-rom: " + path.basename(opts.rom) + ": " +
                  m.json.frames + " updates, " + m.json.overruns +
                  " overruns, worst " + m.json.worstUpdateLines +
                  " lines (mean " + m.meanLines.toFixed(1) +
                  "), " + m.json.verdict);
    console.log(JSON.stringify(m.json));
  } catch (e) {
    console.error("measure-rom: " + e.message);
    process.exit(2);
  }
}

main();
