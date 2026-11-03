#!/usr/bin/env node
/*
 * tests/check-rom-budget.js — the ROM budget's evidence.
 *
 * What it measures:
 *
 *   1. The numbers are the code's.  Every limit in renderer/pce-romcheck.js's
 *      LIMITS table equals the constant that owns it: tools/ilvm/ilvm.c's
 *      MAX_FUNCS / MAX_REGS / MAX_UPS / MAX_GLOBALS / MAX_CLOS / MAX_ARGS /
 *      MAX_SLOTS / MAX_TABLE_CELLS (read from the C source here, the way
 *      check-ilvm reads its DATA_BANK), renderer/pce-ilbc.js's MAX_CONST,
 *      MAX_ARGS and TABLE_POOL_CELLS, and renderer/pce-rom.js's data bank
 *      (SONG_TABLE_OFF, the 8 KiB bank less the 32 B song trailer).
 *   2. A real toy's budget is arithmetic: for PLATFORMER, DUSK RUN and
 *      TOWER every row's `left` is limit - used, `percent` is used/limit
 *      rounded to 0.1, and `status` is ok / near past 80 / over past 100.
 *      PLATFORMER is all ok; DUSK RUN's near rows are the ones docs/ROM_SPEED
 *      records (data bank 91.5%, constants 89.8%, functions 100%, registers
 *      100%, globals 96.9%, upvalues 95%); TOWER, reworked in place for the
 *      gallery export, is near on the data bank (7,862 B of 8,160, 96.3%),
 *      constants and globals, and over on no capacity — its report has no
 *      finding and the interpreter's boot check accepts it.
 *   3. The finding is in the report when a capacity is over.  TOWER no
 *      longer is; DUSK RUN's arithmetic above covers the over case, and this
 *      file's own guide/SKILL checks keep the refusal codes honest.
 *   4. The guide and the skill print the same numbers.  The guide's budget
 *      table is generated from LIMITS (changing a limit in the module
 *      changes the generated Markdown); SKILL.md's table is parsed and
 *      compared field for field, and the parser is shown to catch a changed
 *      number.  The five rules are in all three places a toy author reads:
 *      the guide, SKILL.md and docs/MCP.md.
 *   5. The drawer shows it.  studio-panel-romcheck.render() draws a BUDGET
 *      block with the rows, and the drawer's report and the MCP tool's
 *      reply carry the same budget object.
 *
 *   node tests/check-rom-budget.js
 *
 * Written by @design because the card names this test.  Per workshop rule 2
 * a cold break by another seat is owed before the card closes.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ilbc = require("../renderer/pce-ilbc.js");
const rom = require("../renderer/pce-rom.js");
const romcheck = require("../renderer/pce-romcheck.js");
const panel = require("../renderer/studio-panel-romcheck.js");
const agentTools = require("../renderer/pce-agent-tools.js");
const guide = require("../renderer/pce-guide.js");

const ROOT = path.join(__dirname, "..");
const ILVM_C = path.join(ROOT, "tools", "ilvm", "ilvm.c");
const GUIDE_PATH = path.join(ROOT, "renderer", "pcestudio-for-claude.md");
const SKILL = path.join(ROOT, "plugin", "skills", "creating-pce-toys",
                        "SKILL.md");
const MCP_DOC = path.join(ROOT, "docs", "MCP.md");
const TOYS = {
  "PLATFORMER": path.join(ROOT, "toys", "platformer", "main.lua"),
  "DUSK RUN": path.join(ROOT, "toys", "dusk-run", "main.lua"),
  "TOWER": path.join(ROOT, "toys", "tower", "main.lua")
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
function num(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function round1(n) { return Math.round(n * 10) / 10; }
function flat(s) { return String(s).replace(/\s+/g, " "); }
function has(haystack, needle) {
  check(flat(haystack).indexOf(flat(needle)) >= 0,
        "carries: " + JSON.stringify(needle));
}

function limit(id) {
  return romcheck.LIMITS.filter(function (l) { return l.id === id; })[0];
}
function cDefine(name) {
  const src = fs.readFileSync(ILVM_C, "utf8");
  const m = new RegExp("#define\\s+" + name + "\\s+(\\d+)").exec(src);
  return m ? Number(m[1]) : null;
}
function reportOf(name) {
  return romcheck.check(fs.readFileSync(TOYS[name], "utf8"));
}
function row(report, id) {
  return report.budget.rows.filter(function (r) { return r.id === id; })[0];
}

/* ---- 1. the limits are the code's constants --------------------------- */

function checkLimits() {
  eq("data bank is SONG_TABLE_OFF", limit("data-bank").limit,
     rom.SONG_TABLE_OFF);
  eq("data bank is the 8 KiB bank less the 32 B trailer",
     limit("data-bank").limit, rom.BANK - 32);
  eq("data bank is 8,160", limit("data-bank").limit, 8160);
  eq("constants is MAX_CONST", limit("constants").limit, ilbc.MAX_CONST);
  eq("constants is 127", limit("constants").limit, 127);
  eq("functions is MAX_FUNCS", limit("functions").limit, cDefine("MAX_FUNCS"));
  eq("registers is MAX_REGS", limit("registers").limit, cDefine("MAX_REGS"));
  eq("upvalues is MAX_UPS", limit("upvalues").limit, cDefine("MAX_UPS"));
  eq("upvalue cells is UP_PERM", limit("upvalue-cells").limit,
     cDefine("UP_PERM"));
  eq("globals is MAX_GLOBALS", limit("globals").limit, cDefine("MAX_GLOBALS"));
  eq("closures is MAX_CLOS", limit("closures").limit, cDefine("MAX_CLOS"));
  eq("table slots is MAX_SLOTS", limit("table-slots").limit,
     cDefine("MAX_SLOTS"));
  eq("table cells is MAX_TABLE_CELLS", limit("table-cells").limit,
     cDefine("MAX_TABLE_CELLS"));
  eq("table cells is the encoder's TABLE_POOL_CELLS",
     limit("table-cells").limit, ilbc.TABLE_POOL_CELLS);
  eq("arguments is MAX_ARGS", limit("arguments").limit, ilbc.MAX_ARGS);
  eq("arguments is the interpreter's MAX_ARGS", limit("arguments").limit,
     cDefine("MAX_ARGS"));

  const constants = romcheck.constants();
  eq("constants() reports the limit table's values", constants, {
    "data-bank": rom.SONG_TABLE_OFF,
    "constants": ilbc.MAX_CONST,
    "functions": cDefine("MAX_FUNCS"),
    "registers": cDefine("MAX_REGS"),
    "upvalues": cDefine("MAX_UPS"),
    "upvalue-cells": cDefine("UP_PERM"),
    "globals": cDefine("MAX_GLOBALS"),
    "closures": cDefine("MAX_CLOS"),
    "table-slots": cDefine("MAX_SLOTS"),
    "table-cells": ilbc.TABLE_POOL_CELLS,
    "arguments": ilbc.MAX_ARGS
  });

  /* Each row names a real refusal: the code exists in one of the compilers'
   * tables or is the budget's own interpreter-capacity finding. */
  const known = {};
  for (const f of ilbc.FEATURES.carried) known[f.id] = true;
  Object.keys(ilbc.FEATURES.refused).forEach(function (c) { known[c] = true; });
  Object.keys(require("../renderer/pce-cgen.js").FEATURES.refused)
    .forEach(function (c) { known[c] = true; });
  known["toy-data-bank-full"] = true;      /* renderer/pce-rom.js */
  known["rom-budget"] = true;              /* this module's own */
  for (const l of romcheck.LIMITS) {
    check(known[l.refusal], "limit " + l.id + " names a known refusal (" +
          l.refusal + ")");
    check(typeof l.source === "string" && l.source.length > 0,
          "limit " + l.id + " names its source");
  }
}

/* ---- 2. a real toy's budget is arithmetic ----------------------------- */

function checkArithmetic(name, report) {
  check(!!report.budget, name + ": the report carries a budget");
  if (!report.budget) return;
  const rows = report.budget.rows;
  eq(name + ": one row per limit", rows.length, romcheck.LIMITS.length);
  let near = 0, over = 0;
  for (const r of rows) {
    check(r.used != null && r.limit != null,
          name + ": " + r.id + " has used and limit");
    eq(name + ": " + r.id + " left is limit - used", r.left, r.limit - r.used);
    eq(name + ": " + r.id + " percent is used/limit", r.percent,
       round1(r.used * 100 / r.limit));
    const want = r.percent > 100 ? "over" : r.percent > 80 ? "near" : "ok";
    eq(name + ": " + r.id + " status is " + want, r.status, want);
    if (r.status === "near") near++;
    if (r.status === "over") over++;
  }
  eq(name + ": budget.near counts the near rows", report.budget.near, near);
  eq(name + ": budget.over counts the over rows", report.budget.over, over);
  eq(name + ": budget.ok is no over row", report.budget.ok, over === 0);
  check(report.budget.features &&
        typeof report.budget.features.sprites === "number" &&
        typeof report.budget.features.rasterTables === "number",
        name + ": the budget counts sprite specs and raster tables");
}

function checkPlatformer() {
  const r = reportOf("PLATFORMER");
  checkArithmetic("PLATFORMER", r);
  eq("PLATFORMER: no near row", r.budget.near, 0);
  eq("PLATFORMER: no over row", r.budget.over, 0);
  eq("PLATFORMER: the findings are still empty", r.findings, []);
  eq("PLATFORMER: data bank used is the container's 2,410 B",
     row(r, "data-bank").used, 2410);
  eq("PLATFORMER: 5,750 B left", row(r, "data-bank").left, 5750);
}

function checkDuskRun() {
  const r = reportOf("DUSK RUN");
  checkArithmetic("DUSK RUN", r);
  const near = r.budget.rows.filter(function (x) {
    return x.status === "near";
  }).map(function (x) { return x.id; }).sort();
  eq("DUSK RUN: the near rows are the data bank, constants, functions, " +
     "registers, globals, upvalues and boot upvalue cells", near,
     ["constants", "data-bank", "functions", "globals", "registers",
      "upvalue-cells", "upvalues"]);
  eq("DUSK RUN: the data bank is 91.5%", row(r, "data-bank").percent, 91.5);
  eq("DUSK RUN: the constants are 89.8%", row(r, "constants").percent, 89.8);
  eq("DUSK RUN: the functions are exactly full", row(r, "functions").percent,
     100);
  eq("DUSK RUN: the registers are exactly full", row(r, "registers").percent,
     100);
  eq("DUSK RUN: no over row", r.budget.over, 0);
}

function checkTower() {
  const r = reportOf("TOWER");
  checkArithmetic("TOWER", r);
  const bank = row(r, "data-bank");
  eq("TOWER: the data bank is 7,862 B", bank.used, 7862);
  eq("TOWER: the data bank is near, not over", bank.status, "near");
  eq("TOWER: 298 B left in the 8,160 B usable bank", bank.left, 298);
  eq("TOWER: 96.3% of the data bank", bank.percent, 96.3);
  eq("TOWER: no over row", r.budget.over, 0);
  eq("TOWER: the budget is ok", r.budget.ok, true);
  eq("TOWER: rom_check has no finding", r.findings, []);
  eq("TOWER: rom_check is ok", r.ok, true);
  /* The four rows past 80% are the reworked toy's headroom; no row is over
   * an interpreter capacity. */
  const near = r.budget.rows.filter(function (x) {
    return x.status === "near";
  }).map(function (x) { return x.id; }).sort();
  eq("TOWER: the near rows are the data bank, constants and globals", near,
     ["constants", "data-bank", "globals"]);
  eq("TOWER: 27 functions against 41", row(r, "functions").used, 27);
  eq("TOWER: the functions are ok", row(r, "functions").status, "ok");
  eq("TOWER: 32 registers against 41", row(r, "registers").used, 32);
  eq("TOWER: the registers are ok", row(r, "registers").status, "ok");
  eq("TOWER: 47 boot upvalue cells against 72",
     row(r, "upvalue-cells").used, 47);
  eq("TOWER: the boot upvalue cells are ok",
     row(r, "upvalue-cells").status, "ok");
  eq("TOWER: 6 arguments on the widest call", row(r, "arguments").used, 6);
}

/* ---- 3. the guide and the skill print the same numbers ----------------- */

/* The guide's table, from the generated Markdown. */
function guideBudgetRows(markdown) {
  const rows = {};
  const lines = markdown.split("\n");
  for (const line of lines) {
    const m = /^\|\s*([^|]+?)\s*\|\s*([\d,]+)(?:\s*B)?\s*\|/.exec(line);
    if (!m) continue;
    const label = m[1].trim();
    if (label === "limit" || label === "value") continue;
    rows[label] = Number(m[2].replace(/,/g, ""));
  }
  return rows;
}

/* SKILL.md's budget table. */
function skillBudgetRows(text) {
  const at = text.indexOf("### The ROM budget");
  if (at < 0) return null;
  const rows = {};
  for (const line of text.slice(at).split("\n")) {
    const m = /^\|\s*([^|]+?)\s*\|\s*\*\*([\d,]+)(?:\s*B)?\*\*\s*\|/
      .exec(line);
    if (m) rows[m[1].trim()] = Number(m[2].replace(/,/g, ""));
  }
  return rows;
}

function compareRows(name, rows) {
  check(!!rows, name + ": the budget table is there");
  if (!rows) return;
  for (const l of romcheck.LIMITS) {
    eq(name + ": " + l.label + " is " + l.limit, rows[l.label], l.limit);
  }
}

function checkDocs() {
  const markdown = guide.markdown();
  compareRows("the guide", guideBudgetRows(markdown));

  /* The committed guide too, not only the generator: a hand-typed number in
   * renderer/pcestudio-for-claude.md must fail here as well as in
   * check-guide's artifact test. */
  const committed = fs.readFileSync(GUIDE_PATH, "utf8");
  compareRows("the committed guide", guideBudgetRows(committed));
  const guideMutated = committed.replace("| data bank | 8,160 B |",
                                         "| data bank | 8,192 B |");
  check(guideBudgetRows(guideMutated)["data bank"] === 8192 &&
        guideBudgetRows(guideMutated)["data bank"] !==
          limit("data-bank").limit,
        "a changed number in the committed guide differs from the constant");

  /* The guide is generated: changing a limit in the module changes its
   * bytes.  This is what makes a number typed into the guide impossible. */
  const original = limit("data-bank").limit;
  try {
    limit("data-bank").limit = 9999;
    const changed = guide.markdown();
    check(changed.indexOf("9,999 B") >= 0,
          "the guide prints a changed data bank limit");
    check(changed.indexOf("8,160 B") < 0,
          "the guide no longer prints the old data bank limit");
  } finally {
    limit("data-bank").limit = original;
  }

  const skill = fs.readFileSync(SKILL, "utf8");
  compareRows("SKILL.md", skillBudgetRows(skill));
  /* A changed number in the skill must not pass the comparison. */
  const mutated = skill.replace("**8,160 B**", "**8,192 B**");
  const rows = skillBudgetRows(mutated);
  check(rows && rows["data bank"] === 8192,
        "the skill parser reads a changed number");
  check(rows && rows["data bank"] !== limit("data-bank").limit,
        "a changed number in the skill differs from the constant");

  const mcp = fs.readFileSync(MCP_DOC, "utf8");
  has(mcp, "**8,160 B**");

  /* The five rules, in the three places a toy author reads. */
  const RULES = [
    "Run `rom_check` before you write the first line and after every change.",
    "A change that turns the budget red is undone or reworked before you " +
      "move on.",
    "Stop adding content at 80% of any limit, and say so.",
    "When the person asks for something that will not fit, name the limit " +
      "and offer a smaller version instead of building it.",
    "A toy that only runs in the browser is allowed only when the person " +
      "says so in words — \"browser only\" — and the toy's NOTES.md then " +
      "says it."
  ];
  for (const rule of RULES) {
    has(markdown, rule);
    has(skill, rule);
    has(mcp, rule);
  }
}

/* ---- 4. the drawer draws it, and the MCP tool returns the same budget -- */

function fakeDocument() {
  function node(tag) {
    return {
      tagName: tag, className: "", textContent: "", title: "", open: false,
      children: [],
      appendChild: function (child) { this.children.push(child); return child; },
      addEventListener: function () {}
    };
  }
  return { createElement: node };
}
function textOf(node) {
  return (node.textContent || "") + " " +
         node.children.map(textOf).join(" ");
}

async function checkDrawerAndTool() {
  const source = fs.readFileSync(TOYS.TOWER, "utf8");
  const report = romcheck.check(source);

  const doc = fakeDocument();
  const host = doc.createElement("div");
  panel.render(doc, host, report, null);
  const drawn = flat(textOf(host));
  check(drawn.indexOf("BUDGET") >= 0, "the drawer draws a BUDGET block");
  check(drawn.indexOf("data bank") >= 0, "the drawer lists the data bank");
  check(drawn.indexOf("96.3%") >= 0, "the drawer prints the percent");
  check(drawn.indexOf("near") >= 0, "the drawer marks the near row");

  global.PCEStudio = { romcheck: romcheck };
  const session = agentTools.createSession({});
  await session.call("toy_write", {
    files: [{ name: "main.lua", source: source }]
  });
  const reply = await session.call("rom_check", {});
  check(reply && reply.content && reply.content[0] &&
        typeof reply.content[0].text === "string",
        "rom_check answers with a JSON content block");
  const body = JSON.parse(reply.content[0].text);
  eq("the MCP tool's budget is the drawer's", body.budget, report.budget);
  eq("the MCP tool's findings are the drawer's", body.findings,
     report.findings);
  delete global.PCEStudio;
}

/* ---- main -------------------------------------------------------------- */

(async function main() {
  checkLimits();
  checkPlatformer();
  checkDuskRun();
  checkTower();
  checkDocs();
  await checkDrawerAndTool();

  console.log("");
  console.log(checks + " checks, " + failures.length + " failure" +
              (failures.length === 1 ? "" : "s"));
  if (failures.length) {
    console.log(failures.map(function (f) { return "  - " + f; }).join("\n"));
    process.exitCode = 1;
  } else {
    console.log("PASS  ROM budget: the limits are the code's, PLATFORMER " +
                "ok, DUSK RUN near, TOWER near and exportable, the guide " +
                "and skill print the same numbers, the rules are in all " +
                "three files, drawer == MCP");
  }
})().catch(function (e) {
  console.error("check-rom-budget crashed: " + (e && e.stack || e));
  process.exitCode = 1;
});
