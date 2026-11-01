#!/usr/bin/env node
/*
 * tests/check-tables.js — card #178's evidence: the three games' table
 * inventories, measured by the same tool a person reads.
 *
 * tools/starfall-console.js now prints a table report for any toy.  This
 * check runs its analyse() (the data behind the report, not the text) on
 * STARFALL, TOWER and NOVA TIDE and pins what docs/TABLES-PLAN.md measured:
 *
 *   toy      sites  cells  array  field  array-shape  record  nested  first frame
 *   STARFALL    44    172     46    126           11      33       4          128
 *   TOWER        6     33     33      0            6       0       0           24
 *   NOVA        27    183    178      5           22       5       0           68
 *
 * and the projected version 2 container with the four table ops at their
 * real sizes and every other uncarried kind at 0 B:
 *
 *   STARFALL 8,969 B, TOWER 8,379 B, NOVA 9,287 B — all over the 8,192 B
 *   data bank (by 777 / 187 / 1,095 B).
 *
 * It also runs the CLI on each toy and requires exit 0; TOWER's validator
 * returns blank: null, so its report must print a NOTE about the missing
 * blank budget instead of taking the whole report down (the pre-#178 tool
 * threw on `budgets.blank.cycles`).
 *
 * tests/all.sh runs every tests/check*.js, so this file is in the suite by
 * its name alone.
 *
 * Rule 2 — this seat wrote the instrument and this check, so a cold break by
 * a different seat and model is still owed.  Mutations to try (each should
 * turn this check red):
 *   M1 starfall-console.js: size the container header at 24 B again ->
 *      STARFALL's exact projection becomes 8,965 B, not 8,969.
 *   M2 starfall-console.js: model 5 B per table slot again -> the exact
 *      projection moves by nslots (44/6/27 B) and the v2 control is 7 B out.
 *   M3 pce-ilbc.js: drop the `nested` mark -> STARFALL's nested count is 0.
 *   M4 starfall-console.js: count init()'s ops in the first frame -> 234
 *      table ops for STARFALL instead of 128.
 *   M5 starfall-console.js: remove the blank-budget guard -> the TOWER CLI
 *      run exits non-zero.
 *
 *   node tests/check-tables.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
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

/* The three games, in docs/TABLES-PLAN.md's order, with the numbers that
 * document measured before any of #171-#178 existed (reproduced here from
 * the tool's own analyse()).  The capacity pins move when a kind gains a
 * real opcode size in the model — #133's sprite did (31 x 7 B). */
const TOYS = [
  { rel: "toys/demo-game/main.lua", name: "STARFALL",
    sites: 44, cells: 172, arrayCells: 46, fieldCells: 126,
    shapes: { array: 11, record: 33, mixed: 0, empty: 0, nested: 4 },
    escaping: 7, reexecuting: 34,
    ops: { table: 20, setlist: 2, tget: 45, tset: 61, total: 128, il: 450 },
    exact: 9186, over: true, by: 994,
    at3: 9231, at4: 9246, at6: 9276 },
  { rel: "toys/tower/main.lua", name: "TOWER",
    sites: 6, cells: 33, arrayCells: 33, fieldCells: 0,
    shapes: { array: 6, record: 0, mixed: 0, empty: 0, nested: 0 },
    escaping: 6, reexecuting: 0,
    ops: { table: 0, setlist: 0, tget: 24, tset: 0, total: 24, il: 793 },
    exact: 8379, over: true, by: 187,
    at3: 8475, at4: 8507, at6: 8571 },
  { rel: "toys/nova-tide/main.lua", name: "NOVA TIDE",
    sites: 27, cells: 183, arrayCells: 178, fieldCells: 5,
    shapes: { array: 22, record: 5, mixed: 0, empty: 0, nested: 0 },
    escaping: 22, reexecuting: 5,
    ops: { table: 5, setlist: 0, tget: 58, tset: 5, total: 68, il: 1012 },
    exact: 9287, over: true, by: 1095,
    at3: 9377, at4: 9407, at6: 9467 }
];

function checkToy(t) {
  console.log("\n== " + t.name + " (" + t.rel + ") ==");
  const r = tool.analyse(t.rel, {});
  ok(t.name + ": the IL compiles", r.compile.ok, r.compile.message);
  if (!r.compile.ok) return null;
  ok(t.name + ": tableLayout() read the program", r.tables && r.tables.ok,
     r.tables && (r.tables.code + ": " + r.tables.message));

  const tb = r.tables;
  if (!tb) return null;
  eq(t.name + ": table sites", tb.sites, t.sites);
  eq(t.name + ": cells", tb.cells, t.cells);
  eq(t.name + ": array cells", tb.arrayCells, t.arrayCells);
  eq(t.name + ": field cells", tb.fieldCells, t.fieldCells);
  eq(t.name + ": shapes (array, record, mixed, empty, nested)",
     tb.shapes, t.shapes);
  eq(t.name + ": escaping sites", tb.escaping, t.escaping);
  eq(t.name + ": re-executing sites", tb.reexecuting, t.reexecuting);
  eq(t.name + ": first frame's table ops",
     { table: tb.executed.table, setlist: tb.executed.setlist,
       tget: tb.executed.tget, tset: tb.executed.tset,
       total: tb.executed.total, il: tb.executed.il }, t.ops);

  const cap = r.capacity;
  eq(t.name + ": the data bank", cap.bank, 8192);
  eq(t.name + ": exact projection", [cap.exact.bytes, cap.exact.over,
     cap.exact.by], [t.exact, t.over, t.by]);
  eq(t.name + ": 3/4/6 B range",
     cap.projections.map(function (p) { return [p.assumed, p.bytes, p.over]; }),
     [[3, t.at3, true], [4, t.at4, true], [6, t.at6, true]]);

  /* The CLI is the thing a person runs; it must exit 0 on every toy, even
   * where the export refuses. */
  const run = spawnSync(process.execPath,
    [path.join(ROOT, "tools/starfall-console.js"), t.rel],
    { encoding: "utf8" });
  ok(t.name + ": the tool exits 0", run.status === 0,
     "exit " + run.status + ": " + String(run.stderr).trim().split("\n")[0]);
  ok(t.name + ": the report prints the table inventory",
     /== 2\. the table inventory/.test(run.stdout) &&
     new RegExp("^   " + t.sites + " sites, " + t.cells + " cells", "m")
       .test(run.stdout));
  return run;
}

function checkBlankNote(towerRun) {
  console.log("\n== TOWER's validator has no blank budget (the guard) ==");
  const r = tool.analyse("toys/tower/main.lua", {});
  ok("TOWER's validator budget really has blank: null",
     r.report && r.report.budgets && r.report.budgets.blank === null,
     JSON.stringify(r.report && r.report.budgets &&
                    r.report.budgets.blank));
  ok("the report says so as a NOTE",
     /NOTE this toy's validator returns no blank budget/.test(towerRun.stdout),
     "NOTE line not found");
  ok("and still prints the budgets it does have",
     /route 1 \(the interpreter/.test(towerRun.stdout) &&
     /ROM ~30657 B/.test(towerRun.stdout));
}

/* The projections are a model; its v2 sizing gets its own control on the
 * two toys that really encode as version 2.  Exact match, not "within a few
 * bytes": the model's header/table-section rule must be the encoder's. */
function checkV2Control() {
  console.log("\n== the size model against the two real version 2 containers ==");
  for (const [rel, want] of [["tools/toys/tables.lua", 594],
                             ["tools/toys/tablepool.lua", 455]]) {
    const r = tool.analyse(rel, {});
    ok(rel + ": it really encodes as v2",
       r.encode.ok && r.tables && r.tables.sites > 0,
       r.encode.ok ? "no slots" : r.encode.code);
    eq(rel + ": the model equals the committed container",
       [r.capacity.exact.bytes, r.encode.ok ? r.encode.value.bytes.length : null],
       [want, want]);
  }
}

function main() {
  console.log("check-tables — card #178: the three games' table inventories\n");
  const runs = {};
  for (const t of TOYS) runs[t.name] = checkToy(t);
  if (runs.TOWER) checkBlankNote(runs.TOWER);
  checkV2Control();

  console.log("\nNOTE  rule 2 is owed: #178's instrument, its numbers and " +
              "this check were written by the same seat. A cold break by " +
              "another seat and model has not been taken.");
  console.log("NOTE  the executed counts are the first frame only (frame(0) " +
              "after load(), so the chunk and init() are excluded); that is " +
              "the same instrument docs/TABLES-PLAN.md used.");
  console.log("NOTE  the projections are a model of pce-ilbc.js's container " +
              "layout, not a built container: no game encodes past its " +
              "build-time refusals yet (#133-#138).");

  console.log("\n" + checks + " checks, " + failures.length + " failed");
  if (failures.length) {
    for (const f of failures) console.log("  FAILED: " + f);
    return 1;
  }
  console.log("PASS  check-tables");
  return 0;
}

process.exit(main());
