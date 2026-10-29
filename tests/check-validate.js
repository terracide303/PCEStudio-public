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
 *   5. #89 (docs/REVIEW-31C.md, the seven #32 breaks it found MISSED): the
 *      op-cycle table exactly (row by row and as a fixed IL program's sum),
 *      a CGX sprite spending two strips, the raster line range at 0/223/224,
 *      the 7-to-8-display-frame ceiling, the ROM estimate against the built
 *      ROM's size, three colour words on one line, and a VRAM write from
 *      raster().  Each break was re-run against this file: see
 *      tests/README.md § #89.
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
const il = require("../renderer/pce-il.js");

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
  /* #115: route 1 — the interpreter the studio's Export button builds.  The
   * report carries a projection per toy and the 60 Hz answer; the factor is
   * the measured one for the toy's hook shape. */
  check(b.route1 != null, name + ": the report has route 1's projection");
  if (b.route1) {
    check(b.route1.factor === (hasRaster ? validate.MODEL.ROUTE1.RASTER :
                               validate.MODEL.ROUTE1.NO_RASTER),
          name + ": route 1 uses the " + (hasRaster ? "raster" : "no-raster") +
          " factor (" + b.route1.factor + ")");
    eq(name + ": route 1's shape", b.route1.shape,
       hasRaster ? "raster" : "no raster");
    check(b.route1.collectionCycles ===
          Math.round(b.collectionCycles * b.route1.factor),
          name + ": route 1's projection is the collection times the factor");
    check(b.route1.meets60 ===
          (b.route1.collectionCycles <= validate.MODEL.FRAME_CLOCKS),
          name + ": route 1's meets60 follows its own projection");
    check(b.route1.hz > 0 && b.route1.ratio60 > 0,
          name + ": route 1 has a positive rate");
  }

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

/* #115: route 1's projection is calibrated on the two captures in
 * docs/IL.md §14.5, so it must reproduce both by construction — and the
 * third capture (status-bar) is held out.  The held-out error is what the
 * document quotes; the 60 Hz answer must agree with the measurement. */
{
  const R = validate.MODEL.ROUTE1;
  /* the palette capture's toy is tools/toys/palette.lua, the estimator's
   * first calibration point; palette-cycle.lua is a different, smaller toy */
  const pal = validate.validate(fs.readFileSync(
    path.join(REPO, "tools", "toys", "palette.lua"), "utf8"),
    { frames: FRAMES }).budgets.route1;
  const par = reports.parallax.budgets.route1;
  const bar = reports["status-bar"].budgets.route1;
  check(Math.abs(R.PALETTE_MEASURED / R.PALETTE_ESTIMATE - R.NO_RASTER) < 0.01,
        "route 1's no-raster factor is the palette capture's ratio");
  check(Math.abs(R.PARALLAX_MEASURED / R.PARALLAX_ESTIMATE - R.RASTER) < 0.01,
        "route 1's raster factor is the parallax capture's ratio");
  check(Math.abs(par.collectionCycles - R.PARALLAX_MEASURED) /
        R.PARALLAX_MEASURED < 0.01,
        "route 1 reproduces the parallax capture (projected " +
        par.collectionCycles + " vs " + R.PARALLAX_MEASURED + " measured)");
  check(Math.abs(pal.collectionCycles - R.PALETTE_MEASURED) /
        R.PALETTE_MEASURED < 0.01,
        "route 1 reproduces the palette capture (projected " +
        pal.collectionCycles + " vs " + R.PALETTE_MEASURED + " measured)");
  /* status-bar is held out: the raster factor overestimates it, and the
   * overestimate is inside 2x, so the "no" is conservative, not a coin flip */
  const heldOut = bar.collectionCycles / R.STATUS_MEASURED;
  check(heldOut > 1 && heldOut < 2,
        "status-bar's held-out projection is " + heldOut.toFixed(2) +
        "x the measurement (inside 2x, conservative)");
  for (const name of TOYS) {
    check(reports[name].budgets.route1.meets60 === false,
          name + ": route 1 does not meet 60 Hz (the measured captures " +
          "are 0.9-38x the budget)");
  }
  console.log("  route 1: palette " + pal.collectionCycles + " (est " +
              R.PALETTE_MEASURED + " measured), parallax " +
              par.collectionCycles + " (est " + R.PARALLAX_MEASURED +
              " measured), status-bar " + bar.collectionCycles +
              " (est; " + R.STATUS_MEASURED + " measured)");
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

/* ---- 5: the gaps a cold break found (#89) ------------------------------ */
/* docs/REVIEW-31C.md broke this instrument 26 ways; seven were MISSED.  Each
 * fixture below is the one that review says would catch its break, and each
 * break was re-run against this check before the card closed (#89).  This
 * section is written by @test, a different seat from the validator's author
 * (workshop rule 2). */

/* V01 — the cycle table's row for each op class.  The estimate's ±15%
 * tolerance cannot see one row: pricing reg as pal moves the parallax frame
 * 1,203 -> 1,207 (0.25%).  So the table is pinned twice: a literal copy of
 * the numbers the header cites, and a fixed IL program whose exact cost is
 * the sum of those numbers over its own instructions.  A changed row breaks
 * both; a changed lookup rule (which row an op class takes) breaks the
 * second. */
const GOLDEN_OP_CYCLES = {
  "const": 6, "move": 13, "inttofixed": 8, "getglobal": 14,
  "setglobal": 14, "getbuiltin": 8, "table": 16, "tset": 16,
  "setlist": 24, "arith": 24, "mul": 48, "mod": 64, "div": 48,
  "unm": 12, "bnot": 8, "not": 4, "cmp": 19, "br": 3, "jmp": 1,
  "call": 48, "ret": 3, "closure": 18, "getupval": 18, "setupval": 8,
  "forprep": 24, "fornext": 48, "reg": 24, "pal": 28, "sat": 24,
  "sprite": 28, "raster": 24, "print": 24, "vget": 28, "vset": 28,
  "padref": 8, "padget": 8, "builtin": 36,
  "music": 64, "sfx": 64, "release": 24
};
const FIXED_IL_TOY = [
  "local g = 0",
  "function frame(t, f)",
  "  local a = 1",
  "  local b = a + 2",
  "  local c = b * 3",
  "  g = c",
  "  reg(\"BXR\", 5)",
  "end",
  ""
].join("\n");

function fixedOpCycles(ins) {
  if (ins.t === "arith" && GOLDEN_OP_CYCLES[ins.op] != null) {
    return GOLDEN_OP_CYCLES[ins.op];
  }
  return GOLDEN_OP_CYCLES[ins.t] != null ? GOLDEN_OP_CYCLES[ins.t] : 24;
}

{
  eq("V01 the op-cycle table is the numbers the header cites, row by row",
     validate.MODEL.OP_CYCLES, GOLDEN_OP_CYCLES);

  /* Straight-line, no branch and no call: every instruction in frame()'s
   * code array executes exactly once, so the exact cost is the table's sum. */
  const fixed = il.compile(FIXED_IL_TOY, { chunkName: "fixed-ops.lua" });
  const fixedFn = fixed.functions[fixed.hooks.frame];
  const classes = fixedFn.code.map((i) => i.t + (i.op ? ":" + i.op : ""));
  let expected = validate.MODEL.HOOK_CYCLES;
  for (const ins of fixedFn.code) expected += fixedOpCycles(ins);
  check(classes.indexOf("reg") >= 0 && classes.indexOf("arith:mul") >= 0 &&
        classes.indexOf("setupval") >= 0,
        "V01 the fixed program covers reg, mul and setupval (" +
        classes.join(" ") + ")");
  const fixedRep = validate.validateProgram(fixed, { frames: 2 });
  eq("V01 the fixed IL program's frame costs the exact sum of its ops (" +
     classes.join(" ") + ")", fixedRep.budgets.frameCycles, expected);
}

/* V03 — a CGX sprite spends two 16-px strips (manual 2.4.3).  The existing
 * 16/17 fixture is one-strip sprites only, so a validator that counts a CGX
 * sprite as one still refuses 17 plain sprites.  These fixtures set the CGX
 * bit through sat(i, 3, 0x100) — the SAT word the hardware reads — because
 * the IL lowers `cgx = true` in a sprite spec to nil today (a separate bug,
 * outside #89; the fixture must not depend on it). */
function cgxSpriteToy(cgxCount, plainCount) {
  let s = "function init()\n";
  for (let i = 0; i < cgxCount; i++) {
    s += "  sprite(" + i + ", {x = " + (40 + i * 20) + ", y = 80, pattern = " +
         (i * 2) + "})\n  sat(" + i + ", 3, 0x100)\n";
  }
  for (let j = 0; j < plainCount; j++) {
    const i = cgxCount + j;
    s += "  sprite(" + i + ", {x = " + (40 + i * 20) + ", y = 80, pattern = " +
         (i * 2) + "})\n";
  }
  return s + "end\nfunction frame(t, f)\nend\n";
}

{
  const eight = validate.validate(cgxSpriteToy(8, 0),
                                  { chunkName: "cgx-8.lua", frames: 2 });
  check(eight.ok, "V03 eight CGX sprites are exactly 16 strips and pass");
  eq("V03 eight CGX sprites ask for 16 strips", eight.budgets.sprites.requested, 16);

  const seventeen = validate.validate(cgxSpriteToy(8, 1),
                                      { chunkName: "cgx-17.lua", frames: 2 });
  check(!seventeen.ok, "V03 eight CGX sprites plus one plain (17 strips) are refused");
  eq("V03 the 17-strip line's refusal code", seventeen.code, "validate-sprite-line");
  eq("V03 the 17-strip line asks for 17 strips",
     seventeen.budgets.sprites.requested, 17);

  const eighteen = validate.validate(cgxSpriteToy(9, 0),
                                     { chunkName: "cgx-18.lua", frames: 2 });
  check(!eighteen.ok, "V03 nine CGX sprites (18 strips) are refused");
  eq("V03 nine CGX sprites ask for 18 strips",
     eighteen.budgets.sprites.requested, 18);
}

/* V06 — the static raster-line range.  The branch only fires for a constant
 * lineArg, and the IL lowers a literal into a register, so the review found
 * the off-by-one latent: the host's own raster-line refusal reported 224 in
 * both trees.  The fixture hands the validator what the export API can be
 * handed — a program whose lineArg is a constant — and requires the
 * validator's own validate-range at the boundary. */
function constantLineProgram(line) {
  const p = il.compile(
    "function init() end\nfunction frame(t, f)\n  raster(" + line +
    ", {bxr = 0})\nend\n", { chunkName: "raster-line-" + line + ".lua" });
  const fn = p.functions[p.hooks.frame];
  fn.code.filter((i) => i.t === "raster")[0].lineArg =
    { k: { t: "int", v: line } };
  return p;
}

{
  const at0 = validate.validateProgram(constantLineProgram(0), { frames: 1 });
  check(at0.ok, "V06 a constant raster line 0 is legal");
  const at223 = validate.validateProgram(constantLineProgram(223), { frames: 1 });
  check(at223.ok, "V06 a constant raster line 223 is legal");
  const at224 = validate.validateProgram(constantLineProgram(224), { frames: 1 });
  check(!at224.ok, "V06 a constant raster line 224 is refused");
  check(at224.problems.some((p) => p.code === "validate-range" &&
        /raster line 224/.test(p.message)),
        "V06 the validator's static range reports raster line 224, not only " +
        "the host's run-time refusal (" +
        at224.problems.map((p) => p.code).join(", ") + ")");
  check(at224.problems.filter((p) => p.code === "raster-line").length === 1,
        "V06 the host also refuses line 224 at run time");
}

/* V07 — the hard ceiling is 8 display frames, not 7.  The long-frame fixture
 * costs 1,041,159 cycles, over both 7x119,318 and 8x119,318, so it cannot
 * tell them apart.  This fixture costs ~880,000: inside 8 frames (slow, not
 * refused) and outside 7. */
function frameLinesToy(n) {
  let s = "g = 0\nfunction frame(t, f)\n";
  for (let i = 0; i < n; i++) s += "  g = g + 1\n";
  return s + "end\n";
}

{
  const boundary = validate.validate(frameLinesToy(16900),
                                     { chunkName: "seven-to-eight.lua", frames: 2 });
  const cyc = boundary.budgets ? boundary.budgets.collectionCycles : 0;
  check(cyc > 7 * validate.MODEL.FRAME_CLOCKS &&
        cyc < 8 * validate.MODEL.FRAME_CLOCKS,
        "V07 the boundary toy costs " + cyc +
        " cycles, strictly between 7 and 8 display frames");
  check(boundary.ok, "V07 a toy between 7 and 8 display frames is slow, not " +
        "refused (" + (boundary.code || "ok") + ")");
  check(boundary.problems.some((p) => p.code === "validate-slow-frame"),
        "V07 the boundary toy is reported as a slow frame");

  const over = validate.validate(longFrameToy(),
                                 { chunkName: "over-eight.lua", frames: 2 });
  check(!over.ok, "V07 a toy over the ceiling is refused");
  const msg = over.problems.filter((p) => p.code === "validate-frame-budget")[0];
  check(!!msg && /over the 8-display-frame ceiling \(954544 cycles\)/
          .test(msg.message),
        "V07 the refusal names the 8-display-frame ceiling and 954,544 cycles (" +
        (msg ? msg.message : "missing") + ")");
}

/* V09 — the ROM estimate's runtime baseline, against a built ROM's size.
 * Every toy is under 1 MB, so only the ceiling was asserted and a 5.8 KB
 * baseline error (6,200 -> 12,000 in the review's break) was invisible.
 * Each entry is a committed capture's meta.json: it names the toy source
 * that was built and the size of the ROM that was built, so the estimate is
 * compared with a real build, not with another estimate.  (tools/gen/ is
 * gitignored; the dump's meta is the committed record of the same build.) */
{
  const BUILT = [
    { meta: "tests/dumps/toypalette/meta.json", name: "toypalette" },
    { meta: "tests/dumps/toyparallax/meta.json", name: "toyparallax" }
  ];
  /* The band the unmodified model holds: palette +0.4% of its built ROM,
   * parallax +27.7% (the model does not count the raster runtime the build
   * adds).  V09's error moves them to +84% and +98%. */
  const ROM_TOLERANCE = 0.35;
  for (const b of BUILT) {
    const meta = JSON.parse(fs.readFileSync(path.join(REPO, b.meta), "utf8"));
    check(meta.rom_bytes === 8192 && /^[0-9a-f]{64}$/.test(meta.rom_sha256),
          b.name + "'s committed meta names the 8 KiB ROM that was built (" +
          meta.rom_bytes + " B)");
    const src = fs.readFileSync(path.join(REPO, meta.source), "utf8");
    const rep = validate.validate(src, { chunkName: meta.source, frames: 2 });
    check(rep.ok, b.name + " (" + meta.source + ") passes the validator");
    if (!rep.budgets) continue;
    const est = rep.budgets.rom.bytes;
    const rel = Math.abs(est - meta.rom_bytes) / meta.rom_bytes;
    check(rel <= ROM_TOLERANCE,
          "V09 " + b.name + "'s ROM estimate " + Math.round(est) +
          " B is within " + (ROM_TOLERANCE * 100) + "% of its built ROM " +
          meta.rom_bytes + " B (off " + (rel * 100).toFixed(1) + "%)");
  }
}

/* V10 — part C's replay handler carries at most two colour words per line.
 * No shipped toy has three (sky-gradient's two are asserted at 101 cycles in
 * §2). */
function colourLineToy(n) {
  let s = "function init() end\nfunction frame(t, f) end\n" +
          "function raster(line)\n  if line == 8 then\n";
  for (let i = 0; i < n; i++) s += "    pal(" + i + ", " + (i + 1) + ")\n";
  return s + "  end\nend\n";
}

{
  const three = validate.validate(colourLineToy(3),
                                  { chunkName: "three-colours.lua", frames: 2 });
  check(!three.ok, "V10 three colour words on one line are refused");
  eq("V10 the three-colour refusal code", three.code, "validate-raster-line");
  const msg = three.problems.filter((p) => p.code === "validate-raster-line")[0];
  check(!!msg && /at most 2/.test(msg.message) && /line 8/.test(msg.message),
        "V10 the refusal says line 8 carries at most 2 (" +
        (msg ? msg.message : "missing") + ")");

  const two = validate.validate(colourLineToy(2),
                                { chunkName: "two-colours.lua", frames: 2 });
  check(two.ok, "V10 two colour words on one line pass");
  eq("V10 two colour words are 101 cycles inside part C's blank",
     two.budgets.blank.cycles, 101);
}

/* V11 — a raster() callback that writes VRAM.  Part C cannot apply a vset
 * from the replay handler, and no fixture wrote one. */
{
  const src = [
    "function init() end",
    "function frame(t, f) end",
    "function raster(line)",
    "  if line == 4 then vram[0] = 1 end",
    "end",
    ""
  ].join("\n");
  const rep = validate.validate(src, { chunkName: "vram-from-raster.lua", frames: 2 });
  check(!rep.ok, "V11 a VRAM write from raster() is refused");
  eq("V11 the VRAM-from-raster refusal code", rep.code, "validate-raster-line");
  const msg = rep.problems.filter((p) => p.code === "validate-raster-line")[0];
  check(!!msg && /writes VRAM/.test(msg.message) && /line 4/.test(msg.message),
        "V11 the refusal names the line (" + (msg ? msg.message : "missing") + ")");

  /* the same write from frame() is legal: the rule is about the replay */
  const inFrame = validate.validate(
    "function frame(t, f)\n  vram[0] = 1\nend\n",
    { chunkName: "vram-from-frame.lua", frames: 2 });
  check(inFrame.ok, "V11 the same VRAM write from frame() passes");
}

/* ---- report ------------------------------------------------------------ */

console.log("\n" + (failures.length ? "FAILED " + failures.length + " of " + checks
                                      : "PASS  " + checks + " checks") +
            " — 5 toys, 4 refusals by code, the export refuses them");
if (failures.length) {
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
