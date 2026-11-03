#!/usr/bin/env node
/*
 * tests/check-starfall-console.js — card #131's evidence, re-based on the
 * 2026-11-03 gallery rework (#273) as a PASS/FAIL check rather than a table
 * a person has to read.
 *
 * What this pins (all of it measured on this tree, none of it typed from the
 * write-up):
 *
 *   1. THE PAGE'S OWN CONSOLE PANEL ACCEPTS STARFALL.  renderer/
 *      studio-panel-console.js's `analyse()` — the code the CONSOLE tab and
 *      the Export button's `exportAnalysis()` read — is loaded in a vm with a
 *      fake studio whose toy source is toys/demo-game/main.lua.  It reports
 *      banner "ok", errors 0, warnings 1 and exactly one finding: the
 *      slow-frame warning at line 588 (the 224 raster() callbacks cost
 *      279,353 cycles, 2.34 of a 60 Hz frame, in the validator's console
 *      model).  The same panel on toys/parallax.lua reports the same shape
 *      (the control), so "accepted" is not a panel that cannot see a
 *      warning.
 *   2. THE VALIDATOR'S BUDGETS.  pce-validate.js returns ok with one warning
 *      and 8 frames of 9,730–9,889 cycles: 9,730 cycles of frame() plus
 *      224 raster callbacks at 1,203.7 mean; 6 sprites / 6 strips with 4 on
 *      the busiest line, 2,010 VRAM words, 100 blank cycles, a ~27,253 B ROM.
 *   3. THE FULL REFUSAL INVENTORY, by kind, for both backends.  Since #273
 *      STARFALL has none: 0 of 1,428 instructions are refused by either
 *      backend.  The instrument is not blind — the same analysis on NOVA
 *      TIDE still reports the `raster` kind (5 instruction sites on each
 *      backend) and the C route's one `unm`, so a refusal reintroduced into
 *      STARFALL would appear here.
 *   4. NO cgen OPERAND REFUSAL.  #176 widened cgen's global-type allow-list
 *      to fn/vram/int/bool/padset/table, and #273 removed the `abs`/`sr`
 *      builtins and the unpinnable sprite specs, so cgenExtra's
 *      getglobal/setglobal count, its operand checks and its next refusal are
 *      all empty.  A mutation probe (parallax's g_f retyped str) proves the
 *      cgen-global refusal is live code, not a source reading.
 *   5. THE 8 KiB DATA BANK (#138).  The size model reproduces the two
 *      committed containers to ≤3 B; STARFALL's exact projection is 6,050 B
 *      and 6,212/6,266/6,374 B at 3/4/6 B per still-refused instruction —
 *      all under 8,192 B, where it used to be over at 9,186 B.  The limit
 *      itself is exercised behaviourally: a valid container of exactly
 *      8,192 B builds, 8,193 B is refused with toy-data-bank-full.
 *   6. THE WRITE-UP'S CITATIONS.  Every file:line the report names still
 *      holds its stated code (a merge moved one before, #131/a223320), so the
 *      next merge that moves one fails here instead of quietly aging the doc.
 *
 * What it does NOT prove, printed as NOTE lines when it runs:
 *
 *   - This suite builds no .pce and runs no emulator.  The export and the
 *     Mednafen run are tests/check-export-games.js's (it lists STARFALL as
 *     built; its picture is not the browser's yet, #227).
 *   - The page's `exportAnalysis()` was not executed here: this machine has
 *     no chrome-headless-shell (#114), so the real-page run in the write-up
 *     is not re-verified.  The panel function it reads was executed, and the
 *     early return in studio.html's exportAnalysis() is asserted from source.
 *   - The inventory is dispatch-table membership plus the operand checks
 *     modelled here.  A refusal raised only deeper in cgen's lowering
 *     (cgen-target, cgen-hook, the closure rules) would not be counted.
 *   - Rule 2: this seat wrote the instrument, the reading and this check.  A
 *     cold break by a different seat is still owed.
 *
 * Rule 1 — the check has been run against breaks (scratch copies under
 * $TMPDIR, each mutation applied to one file, the unmodified check re-run):
 *   M1 pce-cgen.js's allow-list loses `table`  -> the table toy's determinism
 *      pin fails (check-il-console)
 *   M2 pce-cgen.js lowers a field tget as an int key -> the table toy's emitC
 *      throws (check-il-console)
 *   M3 pce-cgen.js drops the escapes-and-repeats check -> the held-table
 *      refusal toy is accepted (check-il-console)
 *   M4 starfall-console.js sizes tget 5 B as 4 B -> STARFALL's capacity
 *      projections drop by its tget count (42 B; this check)
 * The first three are in the #176 commit message; M4 is re-derived here on
 * the reworked toy.
 *
 *   node tests/check-starfall-console.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const STARFALL = "toys/demo-game/main.lua";
const CONTROL = "toys/parallax.lua";
const REFUSER = "toys/nova-tide/main.lua";

const il = require(path.join(ROOT, "renderer/pce-il.js"));
const validate = require(path.join(ROOT, "renderer/pce-validate.js"));
const cgen = require(path.join(ROOT, "renderer/pce-cgen.js"));
const ilbc = require(path.join(ROOT, "renderer/pce-ilbc.js"));
const romLib = require(path.join(ROOT, "renderer/pce-rom.js"));
const tool = require(path.join(ROOT, "tools/starfall-console.js"));

let checks = 0;
const failures = [];
function ok(name, cond, detail) {
  checks++;
  if (cond) {
    console.log("  ok   " + name);
  } else {
    failures.push(name + (detail ? " — " + detail : ""));
    console.log("  FAIL " + name + (detail ? " — " + detail : ""));
  }
}
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(name, g === w, g === w ? "" : "got " + g + ", want " + w);
}
function near(name, got, want, tol) {
  ok(name, Math.abs(got - want) <= tol,
     "got " + got + ", want " + want + " ±" + tol);
}

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }
function lineOf(rel, n) {
  const lines = read(rel).split("\n");
  return lines[n - 1] == null ? "" : lines[n - 1];
}

/* ---- the CONSOLE panel, which is the page's own analysis code ----------- *
 * The panel is an IIFE that pushes { register(studio) } into
 * PCEStudio.studioPanelModules; register() stores api.state().  This is the
 * same function exportAnalysis() reads through panelApi("console"). */
function panelState(source, label) {
  const P = {
    il: il, validate: validate, cgen: cgen,
    ilbc: ilbc, rom: romLib
  };
  let api = null;
  const studio = {
    toy: { source: function () { return source; } },
    panels: { register: function (m) { api = m.api; } },
    document: { createElement: function () { return {}; } },
    $: function () { return null; },
    editorLine: function () { return false; }
  };
  const ctx = { self: { PCEStudio: P }, console: console };
  vm.createContext(ctx);
  vm.runInContext(read("renderer/studio-panel-console.js"), ctx,
                  { filename: "studio-panel-console.js" });
  const mods = P.studioPanelModules || [];
  ok(label + ": the CONSOLE panel module loads once", mods.length === 1,
     "got " + mods.length);
  if (mods.length !== 1) return null;
  mods[0].register(studio);
  ok(label + ": the panel registers an api.state()", !!(api && api.state));
  return api ? api.state() : null;
}

/* ---- 1. the panel on STARFALL and the control -------------------------- */
function checkPanel() {
  console.log("\n== 1. the CONSOLE panel (renderer/studio-panel-console.js) ==");
  const S = panelState(read(STARFALL), "STARFALL");
  if (!S) return;

  eq("STARFALL banner is ok", S.banner.state, "ok");
  eq("STARFALL banner says it can run on the PC Engine", S.banner.text,
     "Can run on the PC Engine");
  eq("STARFALL errors", S.errors, 0);
  eq("STARFALL warnings", S.warnings, 1);
  eq("STARFALL findings", S.findings.length, 1);
  const f = S.findings[0] || {};
  eq("the one finding's severity", f.severity, "warn");
  eq("the one finding is the slow-frame warning", f.code,
     "validate-slow-frame");
  eq("the one finding's line", f.line, 588);
  ok("the finding names the raster callback's cost",
     /279353 cycles/.test(String(f.message)) &&
     /2\.34 of a 60 Hz frame/.test(String(f.message)), String(f.message));

  eq("panel stats.frameCycles", S.stats.frameCycles, 9730);
  eq("panel stats.collectionCycles", S.stats.collectionCycles, 279353);
  eq("panel stats.route1.collectionCycles", S.stats.route1.collectionCycles,
     7246417);
  near("panel stats.route1.ratio60", S.stats.route1.ratio60, 60.732, 0.001);
  near("panel stats.route1.hz", S.stats.route1.hz, 0.988, 0.001);
  eq("panel stats.route1.meets60", S.stats.route1.meets60, false);
  eq("panel stats.route1.factor", S.stats.route1.factor, 25.94);
  eq("panel stats.route1.shape", S.stats.route1.shape, "raster");
  eq("panel stats.romBytes", S.stats.romBytes, 27253);
  eq("panel stats.romBanks", S.stats.romBanks, 4);

  /* the control: a toy that is known to export */
  const C = panelState(read(CONTROL), "parallax");
  if (!C) return;
  eq("parallax banner is ok", C.banner.state, "ok");
  eq("parallax errors", C.errors, 0);
  eq("parallax warnings", C.warnings, 1);
  eq("parallax findings", C.findings.length, 1);
  eq("parallax's one finding is the slow-frame warning", C.findings[0].code,
     "validate-slow-frame");
  eq("parallax's warning is a warn", C.findings[0].severity, "warn");
}

/* ---- 2. the validator and its budgets ---------------------------------- */
function checkBudgets() {
  console.log("\n== 2. the validator (renderer/pce-validate.js) ==");
  const r = tool.analyse(STARFALL);
  ok("STARFALL's IL compiles", r.compile.ok, r.compile.message);
  ok("the validator accepts STARFALL", r.report && r.report.ok === true,
     r.report && r.report.code);
  eq("the validator's one problem is the slow-frame warning",
     r.report.problems.map(function (x) { return x.code; }),
     ["validate-slow-frame"]);

  const b = r.report.budgets;
  eq("8 budget frames", b.frames.map(function (x) { return x.frameCycles; }),
     [9730, 9730, 9889, 9889, 9889, 9889, 9730, 9730]);
  eq("frame() cost (last frame)", b.frameCycles, 9730);
  /* the 224 raster() callbacks are the collection, priced apart from frame() */
  eq("collection cost", b.collectionCycles, 279353);
  near("mean raster call", b.rasterMean, 1203.7, 0.1);
  eq("route 1 collection cost", b.route1.collectionCycles, 7246417);
  eq("sprites requested / strips", [b.sprites.sprites, b.sprites.strips],
     [6, 6]);
  eq("busiest sprite line", b.sprites.line, 4);
  eq("VRAM words", b.vram.maxWord, 2010);
  eq("blank cycles", b.blank.cycles, 100);
  eq("ROM estimate", [b.rom.bytes, b.rom.banks], [27253, 4]);
}

/* ---- 3. the refusal inventory ------------------------------------------ */
function checkInventory() {
  console.log("\n== 3. every kind a backend cannot carry ==");
  const r = tool.analyse(STARFALL);
  const inv = r.inventory;
  eq("IL functions", inv.functions, 17);
  eq("IL instructions", inv.total, 1428);
  eq("refused instructions", inv.refusedCount, 0);
  eq("refused rows", inv.rows, []);
  eq("refused percentage", 100 * inv.refusedCount / inv.total, 0);

  /* The instrument is not blind: NOVA TIDE's first raster and the C route's
   * one unary minus are still refusals, and the analysis still names them. */
  const no = tool.analyse(REFUSER).inventory;
  eq("NOVA TIDE: refused instructions", no.refusedCount, 6);
  eq("NOVA TIDE: the refused rows",
     no.rows.map(function (x) {
       return [x.kind, x.backend, x.n, x.lines];
     }),
     [["raster", "route 1 (ilbc)", 5, [530, 531, 532, 533, 534]],
      ["raster", "C backend (cgen)", 5, [530, 531, 532, 533, 534]],
      ["unm", "C backend (cgen)", 1, [29]]]);
}

/* ---- 4. refusals that name an operand ---------------------------------- */
function checkGlobals() {
  console.log("\n== 4. refusals that name an operand: none for STARFALL ==");
  const r = tool.analyse(STARFALL);
  const ex = r.cgenExtra;
  eq("getglobal/setglobal outside cgen's allow-list", ex.n, 0);
  eq("of those, getglobal", ex.get, 0);
  eq("of those, setglobal", ex.set, 0);
  eq("the typed globals they name", ex.names, {});
  eq("the first one", ex.first, null);
  eq("the next cgen refusal, in traversal order", ex.nextRefusal, null);
  eq("other operand checks that would fire", ex.otherChecks,
     { fixed: 0, cond: 0, arity: 0, closure: 0 });

  /* the refusal is live code, not a reading of pce-cgen.js: retype the
   * control's one int global as a str and the emitter must refuse it with
   * cgen-global; unmutated, it emits C.  (Retyping to `table` no longer
   * refuses: #176 carried table-typed globals.) */
  const prog = il.compile(read(CONTROL), { chunkName: "@main.lua" });
  try {
    cgen.emitC(prog, { target: "llvm" });
    ok("the control emits C unmutated", true);
  } catch (e) {
    ok("the control emits C unmutated", false, e.code + ": " + e.message);
  }
  const mutant = JSON.parse(JSON.stringify(prog));
  const g = mutant.globals.filter(function (x) { return x.type === "int"; });
  ok("the control has exactly one int global to retype", g.length === 1,
     "got " + g.length);
  if (g.length === 1) {
    g[0].type = "str";
    let threw = null;
    try { cgen.emitC(mutant, { target: "llvm" }); } catch (e) { threw = e; }
    ok("a str-typed global is refused with cgen-global",
       threw && threw.code === "cgen-global",
       threw ? threw.code : "the emitter accepted it");
    ok("that refusal names pce-cgen.js's allow-list",
       threw && /this backend carries fn\/vram\/int\/bool\/pad\/table/
         .test(String(threw.message)), threw && threw.message);
  }
}

/* ---- 5. the 8 KiB data bank -------------------------------------------- */
function checkCapacity() {
  console.log("\n== 5. the interpreter's one 8 KiB data bank (#138) ==");
  const r = tool.analyse(STARFALL);
  const cap = r.capacity;
  eq("the model's worst error on the two committed containers", cap.worst, 3);
  eq("palette: committed vs modelled", [cap.controls[0].committed,
     cap.controls[0].modelled], [578, 578]);
  eq("parallax: committed vs modelled", [cap.controls[1].committed,
     cap.controls[1].modelled], [1115, 1112]);
  eq("the exact projection", [cap.exact.bytes, cap.exact.over, cap.exact.by],
     [6050, false, 2142]);
  eq("projection at 3/4/6 B per uncarried instruction",
     cap.projections.map(function (p) { return [p.assumed, p.bytes, p.over]; }),
     [[3, 6212, false], [4, 6266, false], [6, 6374, false]]);

  /* the limit itself, behaviourally: 8 KiB exactly builds, 8 KiB + 1 refuses */
  const bank0 = fs.readFileSync(path.join(ROOT, "renderer/ilvm.bin"));
  function container(n) {
    const b = new Uint8Array(n);
    b[0] = 0x49; b[1] = 0x4C; b[2] = 0x42; b[3] = 0x43; b[4] = 1;
    return b;
  }
  const at = romLib.buildToyRom({ bank0: bank0,
    bytecode: container(romLib.BANK) });
  eq("a container of exactly 8,192 B builds",
     [at.length, bank0.length + romLib.BANK],
     [bank0.length + 8192, bank0.length + 8192]);
  let over = null;
  try {
    romLib.buildToyRom({ bank0: bank0,
      bytecode: container(romLib.BANK + 1) });
  } catch (e) { over = e; }
  ok("a container of 8,193 B is refused", !!over,
     over ? "accepted" : "no refusal");
  eq("with code toy-data-bank-full", over && over.code,
     "toy-data-bank-full");
  ok("and the message names the 8 KiB bank",
     over && /one 8 KiB data bank/.test(String(over.message)),
     over && over.message);
}

/* ---- 6. the write-up's citations --------------------------------------- */
const CITATIONS = [
  ["renderer/studio.html", 4784, "if (errors) return"],
  ["renderer/studio-panel-console.js", 145, "emitC"],
  ["renderer/studio-panel-console.js", 148, "severity: \"error\""],
  ["renderer/pce-cgen.js", 536, "fn|vram|int|bool|padset|table"],
  ["renderer/pce-cgen.js", 607, "case \"padget\""],
  ["renderer/pce-cgen.js", 616, "case \"padref\""],
  ["renderer/pce-cgen.js", 636, "builtin `"],
  ["renderer/pce-cgen.js", 697, "refuse(\"cgen-op\""],
  ["renderer/pce-ilbc.js", 205, "var OPS = {"],
  ["renderer/pce-ilbc.js", 221, "var BUILTIN = {"],
  ["renderer/pce-ilbc.js", 338, "refuse(\"ilbc-op\""],
  ["renderer/pce-ilbc.js", 363, "refuse(\"ilbc-builtin\""],
  ["renderer/pce-ilbc.js", 415, "hookSlot(\"raster\""],
  ["renderer/pce-rom.js", 631, "if (dataLen > BANK)"],
  ["renderer/pce-il.js", 1619, "t: \"raster\""]
];

function checkCitations() {
  console.log("\n== 6. the write-up's file:line citations ==");
  for (const [rel, n, text] of CITATIONS) {
    const line = lineOf(rel, n);
    ok(rel + ":" + n + " holds `" + text + "`", line.indexOf(text) >= 0,
       "line " + n + " is: " + line.trim().slice(0, 120));
  }
  /* the early return must precede the encoder in exportAnalysis, or the
   * page's Export path is not what the panel reports */
  const html = read("renderer/studio.html");
  const fnAt = html.indexOf("function exportAnalysis()");
  const ret = html.indexOf("if (errors) return", fnAt);
  const enc = html.indexOf("BC.encode", fnAt);
  ok("exportAnalysis() exists", fnAt >= 0);
  ok("its early return comes before the encoder", ret > fnAt &&
     enc > ret, "return at " + ret + ", encode at " + enc);
}

/* ---- main --------------------------------------------------------------- */
function main() {
  console.log("check-starfall-console — card #131: STARFALL on the console\n");
  checkPanel();
  checkBudgets();
  checkInventory();
  checkGlobals();
  checkCapacity();
  checkCitations();

  console.log("\nNOTE  this suite builds no .pce and runs no emulator: " +
              "tests/check-export-games.js builds the 40,960 B ROM, lists " +
              "STARFALL as built, and pins its Mednafen picture as not yet " +
              "the browser's (#227: the raster backend's one-armed-frame " +
              "latency).");
  console.log("NOTE  the page's exportAnalysis() was not executed here (no " +
              "chrome-headless-shell on this machine, #114). The CONSOLE " +
              "panel's own analyse() was, over the same three modules; the " +
              "early return is asserted from source.");
  console.log("NOTE  the inventory is dispatch-table membership plus the " +
              "operand checks modelled here; a refusal only deeper in cgen " +
              "(cgen-target, cgen-hook, the closure rules) is not counted.");
  console.log("NOTE  rule 2 is owed: the instrument, the reading and this " +
              "check were written by the same seat. A cold break by another " +
              "seat has not been taken.");

  console.log("\n" + checks + " checks, " + failures.length + " failed");
  if (failures.length) {
    for (const f of failures) console.log("  FAILED: " + f);
    return 1;
  }
  console.log("PASS  check-starfall-console");
  return 0;
}

process.exit(main());
