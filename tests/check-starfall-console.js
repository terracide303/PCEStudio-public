#!/usr/bin/env node
/*
 * tests/check-starfall-console.js — card #131's evidence, as a PASS/FAIL
 * check rather than a table a person has to read.
 *
 * What this pins (all of it measured on this tree, none of it typed from the
 * write-up):
 *
 *   1. THE PAGE'S OWN CONSOLE PANEL REFUSES STARFALL.  renderer/
 *      studio-panel-console.js's `analyse()` — the code the CONSOLE tab and
 *      the Export button's `exportAnalysis()` read — is loaded in a vm with a
 *      fake studio whose toy source is toys/demo-game/main.lua.  It reports
 *      banner "bad", errors 1, warnings 0 and exactly one finding: cgen-op at
 *      line 47, the `table` for the DIGIT array.  The same panel on
 *      toys/parallax.lua reports 0 errors (the control), so "refused" is not a
 *      panel that cannot pass.
 *   2. THE VALIDATOR DOES NOT REFUSE IT.  pce-validate.js returns ok with 0
 *      problems, 8 frames of 9,530–9,637 cycles, 6 sprites / 6 strips with 4
 *      on the busiest line, 2,010 VRAM words, 100 blank cycles, a ~30,480 B
 *      ROM.  A green check-demo-game says nothing about the console.
 *   3. THE FULL REFUSAL INVENTORY, by kind, for both backends: 246 of 1,919
 *      instructions (12.8%) over the 11 kinds the write-up names, with the
 *      first main.lua line of each and the two route-1-only pad kinds.
 *   4. THE NEXT BLOCKER AFTER #132 (#143).  cgen refuses getglobal/setglobal
 *      on a global whose declared type is outside fn/vram/int/bool/padset
 *      (pce-cgen.js:400).  STARFALL has 36 such instructions over 7 table
 *      globals; the first is `setglobal DIGIT` at function 0 pc 14,
 *      main.lua:47 — the instruction right after the table constructor.  So
 *      #132 carrying the four table kinds still leaves the page blocked.  A
 *      mutation probe (parallax's g_f retyped table) proves that refusal is
 *      live code, not a source reading.
 *   5. THE 8 KiB DATA BANK (#138).  The size model reproduces the two
 *      committed containers to ≤4 B; STARFALL projects 8,585/8,828/9,314 B at
 *      3/4/6 B per uncarried instruction, all over 8,192.  The limit itself is
 *      exercised behaviourally: a valid container of exactly 8,192 B builds,
 *      8,193 B is refused with toy-data-bank-full.
 *   6. THE WRITE-UP'S CITATIONS.  Every file:line the report names still
 *      holds its stated code (a merge moved one before, #131/a223320), so the
 *      next merge that moves one fails here instead of quietly aging the doc.
 *
 * What it does NOT prove, printed as NOTE lines when it runs:
 *
 *   - No .pce was built for STARFALL and no emulator ran, because the export
 *     refuses.  There is no 20-frame browser/Mednafen diff and no TMA-timer
 *     cycle count; those stay conditional on #132–#143.
 *   - The page's `exportAnalysis()` was not executed here: this machine has
 *     no chrome-headless-shell (#114), so the real-page run in the write-up
 *     is not re-verified.  The panel function it reads was executed, and the
 *     early return in studio.html's exportAnalysis() is asserted from source.
 *   - The inventory is dispatch-table membership plus the operand checks
 *     modelled here.  A refusal raised only deeper in cgen's lowering
 *     (cgen-target, cgen-hook, the closure rules) would not be counted.
 *   - Rule 2: this seat wrote the instrument, the reading and this check.  A
 *     cold break by a different seat is still owed before #131 closes.
 *
 * Rule 1 — the check has been run against breaks (scratch copies under
 * $TMPDIR, each mutation applied to one file, the unmodified check re-run):
 *   M1 pce-ilbc.js OPS gains `table`      -> the ilbc-op finding check fails
 *   M2 pce-cgen.js's allow-list gains table -> the cgen-global probe fails
 *   M3 studio.html's early return disabled  -> the page verdict / citation fails
 *   M4 pce-rom.js BANK 8192 -> 16384        -> the capacity checks fail
 * The results are in the #131 commit message.
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

  eq("STARFALL banner is bad", S.banner.state, "bad");
  ok("STARFALL banner says 1 problem", /1 problem/.test(S.banner.text),
     S.banner.text);
  eq("STARFALL errors", S.errors, 1);
  eq("STARFALL warnings", S.warnings, 0);
  eq("STARFALL findings", S.findings.length, 1);
  const f = S.findings[0] || {};
  eq("the one finding's severity", f.severity, "error");
  eq("the one finding's code", f.code, "cgen-op");
  eq("the one finding's line", f.line, 47);
  ok("the finding names the `table` instruction",
     /instruction `table`/.test(String(f.message)), String(f.message));
  ok("the finding says it is not lowered", /not lowered by this backend/
     .test(String(f.message)));

  eq("panel stats.frameCycles", S.stats.frameCycles, 9530);
  eq("panel stats.route1.collectionCycles", S.stats.route1.collectionCycles,
     305913);
  near("panel stats.route1.ratio60", S.stats.route1.ratio60, 2.564, 0.001);
  near("panel stats.route1.hz", S.stats.route1.hz, 23.4, 0.05);
  eq("panel stats.route1.meets60", S.stats.route1.meets60, false);
  eq("panel stats.route1.factor", S.stats.route1.factor, 32.10);
  eq("panel stats.route1.shape", S.stats.route1.shape, "no raster");
  eq("panel stats.romBytes", S.stats.romBytes, 30480);
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
  eq("the validator's problem count", r.report.problems.length, 0);

  const b = r.report.budgets;
  eq("8 budget frames", b.frames.map(function (x) { return x.frameCycles; }),
     [9530, 9530, 9637, 9637, 9637, 9637, 9530, 9530]);
  eq("frame() cost (last frame)", b.frameCycles, 9530);
  eq("collection cost", b.collectionCycles, 9530);
  eq("route 1 collection cost", b.route1.collectionCycles, 305913);
  eq("sprites requested / strips", [b.sprites.sprites, b.sprites.strips],
     [6, 6]);
  eq("busiest sprite line", b.sprites.line, 4);
  eq("VRAM words", b.vram.maxWord, 2010);
  eq("blank cycles", b.blank.cycles, 100);
  eq("ROM estimate", [b.rom.bytes, b.rom.banks], [30480, 4]);
}

/* ---- 3. the refusal inventory ------------------------------------------ */
const INVENTORY = [
  /* kind, count, route-1 count, cgen count, first main.lua line */
  ["tset", 124, 124, 124, 406],
  ["table", 44, 44, 44, 47],
  ["setlist", 11, 11, 11, 47],
  ["tget", 18, 18, 18, 444],
  ["sprite", 31, 31, 31, 406],
  ["padref", 5, 5, 0, 649],
  ["padget", 5, 5, 0, 649],
  ["sfx", 3, 3, 3, 475],
  ["raster", 2, 2, 2, 498],
  ["builtin abs", 2, 2, 2, 466],
  ["builtin sr", 1, 1, 1, 570]
];

function checkInventory() {
  console.log("\n== 3. every kind a backend cannot carry ==");
  const r = tool.analyse(STARFALL);
  const inv = r.inventory;
  eq("IL functions", inv.functions, 18);
  eq("IL instructions", inv.total, 1919);
  eq("refused instructions", inv.refusedCount, 246);
  near("refused percentage", 100 * inv.refusedCount / inv.total, 12.8, 0.05);

  for (const [kind, n, ilbcN, cgenN, first] of INVENTORY) {
    const rows = inv.rows.filter(function (x) { return x.kind === kind; });
    const gotIlbc = rows.filter(function (x) {
      return x.backend === "route 1 (ilbc)";
    }).reduce(function (a, x) { return a + x.n; }, 0);
    const gotCgen = rows.filter(function (x) {
      return x.backend === "C backend (cgen)";
    }).reduce(function (a, x) { return a + x.n; }, 0);
    const total = Math.max(gotIlbc, gotCgen);
    const lines = rows.reduce(function (a, x) { return a.concat(x.lines); }, []);
    const firstLine = lines.length ? Math.min.apply(null, lines) : null;
    ok(kind + ": " + n + " instructions (ilbc " + ilbcN + ", cgen " + cgenN +
       ", first main.lua:" + first + ")",
       total === n && gotIlbc === ilbcN && gotCgen === cgenN &&
       firstLine === first,
       "got " + total + " instructions, ilbc " + gotIlbc + ", cgen " +
       gotCgen + ", first " + firstLine);
  }

  const kinds = INVENTORY.length;
  const both = INVENTORY.filter(function (x) { return x[2] && x[3]; }).length;
  const route1Only = INVENTORY.filter(function (x) {
    return x[2] && !x[3];
  }).map(function (x) { return x[0]; });
  eq("kinds in the table", kinds, 11);
  eq("kinds refused by both backends", both, 9);
  eq("route-1-only kinds", route1Only, ["padref", "padget"]);
}

/* ---- 4. the next blocker after #132 (#143) ----------------------------- */
function checkGlobals() {
  console.log("\n== 4. refusals that name an operand: the next blocker ==");
  const r = tool.analyse(STARFALL);
  const ex = r.cgenExtra;
  eq("getglobal/setglobal outside cgen's allow-list", ex.n, 36);
  eq("of those, getglobal", ex.get, 29);
  eq("of those, setglobal", ex.set, 7);
  eq("the typed globals they name", ex.names,
     { "DIGIT:table": 2, "bl:table": 8, "bx:table": 4, "by:table": 7,
       "ex:table": 5, "ey:table": 8, "es:table": 2 });
  eq("the first one", ex.first,
     { fn: 0, fnName: "main", pc: 14, line: 47, kind: "setglobal",
       name: "DIGIT", type: "table" });
  eq("with #132's four table kinds skipped, the next refusal", ex.nextAfterTables,
     { code: "cgen-global", fn: 0, fnName: "main", pc: 14, line: 47,
       kind: "setglobal", name: "DIGIT", type: "table" });
  eq("other operand checks that would fire", ex.otherChecks,
     { fixed: 0, cond: 0, arity: 0, closure: 0 });

  /* the refusal is live code, not a reading of pce-cgen.js: retype the
   * control's one int global as a table and the emitter must refuse it with
   * cgen-global; unmutated, it emits C. */
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
    g[0].type = "table";
    let threw = null;
    try { cgen.emitC(mutant, { target: "llvm" }); } catch (e) { threw = e; }
    ok("a table-typed global is refused with cgen-global",
       threw && threw.code === "cgen-global",
       threw ? threw.code : "the emitter accepted it");
    ok("that refusal names pce-cgen.js's allow-list",
       threw && /this backend carries fn\/vram\/int\/bool\/pad/
         .test(String(threw.message)), threw && threw.message);
  }
}

/* ---- 5. the 8 KiB data bank -------------------------------------------- */
function checkCapacity() {
  console.log("\n== 5. the interpreter's one 8 KiB data bank (#138) ==");
  const r = tool.analyse(STARFALL);
  const cap = r.capacity;
  eq("the model's worst error on the two committed containers", cap.worst, 4);
  eq("palette: committed vs modelled", [cap.controls[0].committed,
     cap.controls[0].modelled], [578, 577]);
  eq("parallax: committed vs modelled", [cap.controls[1].committed,
     cap.controls[1].modelled], [1115, 1111]);
  eq("projection at 3/4/6 B per uncarried instruction",
     cap.projections.map(function (p) { return [p.assumed, p.bytes, p.over]; }),
     [[3, 8585, true], [4, 8828, true], [6, 9314, true]]);

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
  ["renderer/studio.html", 4195, "if (errors) return"],
  ["renderer/studio-panel-console.js", 145, "emitC"],
  ["renderer/studio-panel-console.js", 148, "severity: \"error\""],
  ["renderer/pce-cgen.js", 400, "fn|vram|int|bool|padset"],
  ["renderer/pce-cgen.js", 458, "case \"padget\""],
  ["renderer/pce-cgen.js", 467, "case \"padref\""],
  ["renderer/pce-cgen.js", 485, "builtin `"],
  ["renderer/pce-cgen.js", 490, "refuse(\"cgen-op\""],
  ["renderer/pce-ilbc.js", 116, "var OPS = {"],
  ["renderer/pce-ilbc.js", 127, "var BUILTIN = {"],
  ["renderer/pce-ilbc.js", 220, "refuse(\"ilbc-op\""],
  ["renderer/pce-ilbc.js", 245, "refuse(\"ilbc-builtin\""],
  ["renderer/pce-ilbc.js", 286, "hookSlot(\"raster\""],
  ["renderer/pce-rom.js", 618, "if (dataLen > BANK)"],
  ["renderer/pce-il.js", 1619, "t: \"raster\""]
];

function checkCitations() {
  console.log("\n== 6. the write-up's file:line citations ==");
  for (const [rel, n, text] of CITATIONS) {
    const line = lineOf(rel, n);
    ok(rel + ":" + n + " holds `" + text + "`", line.indexOf(text) >= 0,
       "line " + n + " is: " + line.trim().slice(0, 120));
  }
  /* the early return must precede the encoder in exportAnalysis, or "the
   * page never reaches pce-ilbc.js" is false */
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

  console.log("\nNOTE  nothing was built for STARFALL and no emulator ran: the " +
              "export refuses, so there is no Mednafen run, no 20-frame " +
              "browser diff and no TMA-timer cycles. Those stay conditional " +
              "on #132-#143.");
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
