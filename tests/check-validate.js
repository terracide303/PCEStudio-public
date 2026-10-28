#!/usr/bin/env node
/*
 * tests/check-validate.js — the #32 evidence: renderer/pce-validate.js on
 * the IL.
 *
 * What it asserts:
 *
 *   1. The five #29 toys (toys/*.lua) pass the validator, and their budgets
 *      are printed: frame() cycles, the mean and worst raster() call, the
 *      whole toy frame against the 60 Hz budget (119,318 clocks), VRAM words
 *      used, the ROM estimate, the worst sprite line, and the worst replay
 *      step against part C's ~123-cycle horizontal blank.
 *   2. Parallax's prediction is the model's held-out measurement: its
 *      frame() must be within 15% of part C's TMA 1,204 cycles and its mean
 *      raster() call within 15% of 1,510 (docs/IL.md §10.3).  The cycle table
 *      is calibrated on the palette frame and the parallax frame() only.
 *   3. Deliberately over-budget toys are refused by code:
 *        - a frame() loop too long           -> validate-frame-budget
 *        - 17 sprites on one line            -> validate-sprite-line
 *          (16 on a line is the boundary and must pass)
 *        - a ROM estimated past 1 MB         -> validate-rom
 *        - a value outside its range         -> reg-range (the host's code)
 *   4. The export refuses them: tools/toyc/emit.js exits 1 and prints the
 *      code.  The 17-sprite toy would also be refused by the C emitter
 *      (cgen-op), so its code proves the validator runs first.  The
 *      committed palette toy still exports (exit 0).
 *
 * The warnings are real data, not decoration: the #29 toys run at 17-26 Hz
 * on this route, and road.lua's three writes per line are 135 cycles — over
 * part C's blank.  They are printed and asserted; only errors stop an export.
 *
 * Written by @design because the card names this file.  Rule 2: a cold break
 * by another seat is owed before the card closes.
 *
 *   node tests/check-validate.js
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const child = require("child_process");
const validate = require("../renderer/pce-validate.js");

const HERE = __dirname;
const TOY_DIR = path.join(HERE, "..", "toys");
const REPO = path.join(HERE, "..");
const FRAMES = 8;
const TOYS = ["palette-cycle", "parallax", "road", "sky-gradient", "status-bar"];

/* part C's TMA measurements (docs/IL.md §10.3) */
const PARALLAX_FRAME = 1204;
const PARALLAX_RASTER = 1510;

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
function within(name, got, want, tolerance) {
  const rel = Math.abs(got - want) / want;
  check(rel <= tolerance, name + " (got " + got + ", want " + want +
        " +/-" + (tolerance * 100) + "%, off " + (rel * 100).toFixed(1) + "%)");
  return rel;
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pce-validate-"));
process.on("exit", function () {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

/* ---- 1 + 2: the five toys, their budgets, and parallax's held-out check -- */

const reports = {};
for (const name of TOYS) {
  const source = fs.readFileSync(path.join(TOY_DIR, name + ".lua"), "utf8");
  const rep = validate.validate(source, { chunkName: name + ".lua", frames: FRAMES });
  reports[name] = rep;
  check(rep.ok, name + " passes the validator" + (rep.ok ? "" : ": " + rep.code));
  check(rep.budgets != null, name + " has budgets");
  if (!rep.budgets) continue;

  const b = rep.budgets;
  const hasRaster = name !== "palette-cycle";
  check(b.frames.length === FRAMES, name + ": " + FRAMES + " frames analysed");
  for (let f = 0; f < b.frames.length; f++) {
    check(b.frames[f].frameCycles > 0, name + " frame " + f + " has a cost");
    if (hasRaster) {
      eq(name + " frame " + f + ": 224 raster calls",
         b.frames[f].rasterCycles.length, 224);
    }
  }
  check(b.rom.bytes > 0 && b.rom.bytes < b.rom.limit,
        name + ": ROM estimate " + Math.round(b.rom.bytes) + " B inside 1 MB");
  check(b.vram.words <= 32768, name + ": VRAM " + b.vram.words + " words");
  check(b.sprites.requested <= 16, name + ": no sprite overflow");
  check(b.collectionCycles > 0, name + ": collection has a cost");

  const blank = b.blank ? (b.blank.cycles + " cyc on line " + b.blank.line)
                        : "no writes";
  console.log("  " + name.padEnd(13) +
              " frame " + String(b.frameCycles).padStart(6) +
              "  raster mean " + String(Math.round(b.rasterMean)).padStart(5) +
              "  worst " + String(b.rasterWorst).padStart(5) +
              "  toy frame " + String(b.collectionCycles).padStart(7) +
              " (" + b.ratio60.toFixed(2) + "x60 Hz, " + b.hz.toFixed(1) + " Hz)" +
              "  VRAM " + String(b.vram.words).padStart(5) +
              "  ROM ~" + String(Math.round(b.rom.bytes)).padStart(6) +
              " B  blank " + blank);
}

/* parallax is the held-out cycle prediction */
{
  const b = reports.parallax.budgets;
  console.log("\nparallax vs part C's TMA: frame " + b.frameCycles + " / " +
              PARALLAX_FRAME + ", raster mean " + Math.round(b.rasterMean) +
              " / " + PARALLAX_RASTER);
  within("parallax frame() inside the stated tolerance",
         b.frameCycles, PARALLAX_FRAME, validate.MODEL.TOLERANCE);
  within("parallax raster() mean inside the stated tolerance",
         b.rasterMean, PARALLAX_RASTER, validate.MODEL.TOLERANCE);
  check(validate.MODEL.TOLERANCE === 0.15, "the stated tolerance is 15%");
  /* the calibration used the palette frame and the parallax frame(), so the
   * palette toy's own cost is a prediction too: it must be a plausible
   * non-zero share of a 60 Hz frame */
  check(reports["palette-cycle"].budgets.collectionCycles <
        validate.MODEL.FRAME_CLOCKS,
        "palette-cycle fits inside one 60 Hz frame");
}

/* road.lua's three writes a line are over the blank; the validator says so,
 * and still lets the toy pass: part C's handler is for one or two registers */
{
  const road = reports.road;
  const blank = road.problems.filter((p) => p.code === "validate-raster-blank");
  eq("road.lua reports the blank overrun once", blank.length, 1);
  check(blank.length === 1 && /135 cycles/.test(blank[0].message),
        "road.lua's replay step is 135 cycles: " +
        (blank[0] ? blank[0].message : "missing"));
  eq("road.lua's over-blank lines", road.budgets.blankOverLines.length, 224);
  const slow = road.problems.filter((p) => p.code === "validate-slow-frame");
  eq("road.lua reports its rate", slow.length, 1);
  check(reports.parallax.budgets.blank.cycles === 64,
        "parallax's one register is 64 cycles, inside the blank");
  check(reports["sky-gradient"].budgets.blank.cycles === 101,
        "sky-gradient's two colour words are 101 cycles, inside the blank");
  check(reports["status-bar"].budgets.blank.cycles === 99,
        "status-bar's two registers are 99 cycles, inside the blank");
}

/* ---- 3: deliberate over-budget toys, refused by code -------------------- */

function longFrameToy() {
  let s = "g = 0\nfunction frame(t, f)\n";
  for (let i = 0; i < 20000; i++) s += "  g = g + 1\n";
  return s + "end\n";
}

function spriteToy(n) {
  let s = "function init()\n";
  for (let i = 0; i < n; i++) {
    s += "  sprite(" + i + ", {x = " + (40 + i) +
         ", y = 80, pattern = 0, palette = 0})\n";
  }
  return s + "end\nfunction frame(t, f)\nend\n";
}

function bigRomToy() {
  let s = "g = 0\nlocal function junk()\n";
  for (let i = 0; i < 26000; i++) s += "  g = g + 1\n";
  return s + "end\nfunction frame(t, f)\nend\n";
}

const fixtures = {
  "long-frame": { source: longFrameToy(), code: "validate-frame-budget" },
  "sprites-17": { source: spriteToy(17), code: "validate-sprite-line" },
  "rom-1mb": { source: bigRomToy(), code: "validate-rom" },
  "range": {
    source: "function frame(t, f)\n  reg(\"BXR\", 2000)\nend\n",
    code: "reg-range"
  }
};

for (const name of Object.keys(fixtures)) {
  const f = fixtures[name];
  const rep = validate.validate(f.source, { chunkName: name + ".lua", frames: 2 });
  check(!rep.ok, name + " is refused");
  eq(name + " refusal code", rep.code, f.code);
  const first = rep.problems.filter((p) => p.severity === "error")[0];
  console.log("  refused " + name.padEnd(11) + " " + rep.code + ": " +
              (first ? first.message : ""));
  fs.writeFileSync(path.join(TMP, name + ".lua"), f.source);
}

/* the 16-sprite boundary passes: 16 strips are exactly 256 px */
{
  const rep = validate.validate(spriteToy(16), { chunkName: "sprites-16.lua", frames: 2 });
  check(rep.ok, "16 sprites on a line pass (256 px exactly)");
  eq("16 sprites ask for 16 strips", rep.budgets.sprites.requested, 16);
  eq("16 sprites overflow no line", rep.budgets.spriteOverflowLines.length, 0);
}

/* ---- 4: the export refuses a toy that fails ----------------------------- */

function emit(name) {
  const out = path.join(TMP, name + ".c");
  const r = child.spawnSync(process.execPath,
    [path.join(REPO, "tools", "toyc", "emit.js"),
     path.join(TMP, name + ".lua"), out],
    { encoding: "utf8" });
  return { status: r.status, stderr: r.stderr || "", out: out };
}

for (const name of Object.keys(fixtures)) {
  const r = emit(name);
  check(r.status === 1, "emit.js refuses " + name);
  const code = fixtures[name].code;
  check(r.stderr.indexOf(code) !== -1,
        "emit.js prints " + code + " for " + name + " (stderr: " +
        r.stderr.trim() + ")");
  check(!fs.existsSync(r.out), "emit.js wrote no C for " + name);
}

/* the validator runs before cgen: 17 sprites are also cgen-op */
check(emit("sprites-17").stderr.indexOf("cgen-op") === -1,
      "the 17-sprite refusal is the validator's, not cgen's");

/* and a toy that passes still exports */
{
  const r = child.spawnSync(process.execPath,
    [path.join(REPO, "tools", "toyc", "emit.js"),
     path.join(REPO, "tools", "toys", "palette.lua"),
     path.join(TMP, "palette.c")],
    { encoding: "utf8" });
  eq("the committed palette toy still exports", r.status, 0);
}

/* ---- report ------------------------------------------------------------ */

console.log("\n" + (failures.length ? "FAILED " + failures.length + " of " + checks
                                      : "PASS  " + checks + " checks") +
            " — 5 toys, 4 refusals by code, the export refuses them");
if (failures.length) {
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
