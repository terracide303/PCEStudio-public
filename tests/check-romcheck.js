#!/usr/bin/env node
/*
 * tests/check-romcheck.js — the #193 evidence.
 *
 * What it measures:
 *   1. The carried/refused lists the check reports ARE the compilers' own
 *      tables: renderer/pce-romcheck.js's carried(), refused() and FEATURES
 *      are renderer/pce-cgen.js's and renderer/pce-ilbc.js's FEATURES /
 *      REFUSALS field for field, and every IL opcode is either in a carried
 *      group or named as refused.
 *   2. Each refusal code fires on a minimal toy, with the Lua line the
 *      construct starts on.  Source-reachable codes are compiled from Lua;
 *      the defensive ones (cgen-key, cgen-target, cgen-cond, the table rules,
 *      ilbc-key, ilbc-jump, ilbc-table-key) are raised from a mutator on the
 *      compiled IL, because the IL front end never emits them.
 *   3. PLATFORMER reports ok — every finding empty — which is the one game
 *      of the five the ROM_SPEED table says both routes carry.
 *   4. The studio drawer's findings and the MCP tool's findings are the same
 *      object: studio-panel-romcheck.run() is what studio.html calls, and
 *      rom_check through the real tool core returns its findings.
 *   5. studio.html wires the drawer: the script, the status span, the tab,
 *      the panel and the debounced edit path.
 *
 *   node tests/check-romcheck.js
 *
 * Written by @design because the card names this test.  Rule 2: a cold break
 * by another seat is owed before the card closes.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const il = require("../renderer/pce-il.js");
const ilbc = require("../renderer/pce-ilbc.js");
const cgen = require("../renderer/pce-cgen.js");
const romcheck = require("../renderer/pce-romcheck.js");
const panel = require("../renderer/studio-panel-romcheck.js");
const agentTools = require("../renderer/pce-agent-tools.js");

const ROOT = path.join(__dirname, "..");
const STUDIO = path.join(ROOT, "renderer", "studio.html");
const PLATFORMER = path.join(ROOT, "toys", "platformer", "main.lua");
const DUSK_RUN = path.join(ROOT, "toys", "dusk-run", "main.lua");

let checks = 0;
const failures = [];
const skips = [];

function check(ok, name) {
  checks++;
  if (!ok) { failures.push(name); console.log("FAIL  " + name); }
}
function eq(name, got, want) {
  check(JSON.stringify(got) === JSON.stringify(want),
        name + " (got " + JSON.stringify(got) + ", want " +
        JSON.stringify(want) + ")");
}

/* ---- the test's own compiler front end -------------------------------- */

function compile(source, chunk) {
  return il.compile(source, { chunkName: chunk || "@main.lua" });
}
function findingsOf(source, mutate) {
  const program = compile(source);
  if (mutate) mutate(program);
  return romcheck.checkProgram(program).findings;
}
function find(findings, code) {
  return findings.filter(function (f) { return f.code === code; })[0] || null;
}
function refusal(name, findings, code, line) {
  const f = find(findings, code);
  check(!!f, name + ": " + code + " fires (got " +
        findings.map(function (x) { return x.code; }).join(", ") + ")");
  if (f) {
    check(f.line === line, name + ": " + code + " names line " + line +
          " (got " + f.line + ")");
  }
}

/* A register operand with a non-bool type: the only way to reach cgen-cond,
 * because il.compile's typer refuses the Lua form first. */
function firstBr(program) {
  for (const fn of program.functions) {
    for (const ins of fn.code) if (ins.t === "br") return ins;
  }
  return null;
}

/* ---- 1. the lists are the compilers' tables --------------------------- */

function checkTables() {
  const carried = romcheck.carried();
  const refused = romcheck.refused();
  eq("carried.cgen is cgen.FEATURES.carried", carried.cgen,
     cgen.FEATURES.carried);
  eq("carried.ilbc is ilbc.FEATURES.carried", carried.ilbc,
     ilbc.FEATURES.carried);
  eq("refused.cgen is cgen.FEATURES.refused", refused.cgen,
     cgen.FEATURES.refused);
  eq("refused.ilbc is ilbc.FEATURES.refused", refused.ilbc,
     ilbc.FEATURES.refused);
  eq("romcheck.FEATURES exposes both compilers' tables",
     { cgen: romcheck.FEATURES.cgen, ilbc: romcheck.FEATURES.ilbc },
     { cgen: cgen.FEATURES, ilbc: ilbc.FEATURES });
  eq("the routes are the compilers' own", romcheck.routes(),
     { cgen: cgen.FEATURES.route, ilbc: ilbc.FEATURES.route });

  for (const code of cgen.CODES) {
    check(Object.prototype.hasOwnProperty.call(cgen.FEATURES.refused, code),
          "cgen code " + code + " has a meaning in FEATURES.refused");
  }
  for (const code of ilbc.CODES) {
    check(Object.prototype.hasOwnProperty.call(ilbc.FEATURES.refused, code),
          "ilbc code " + code + " has a meaning in FEATURES.refused");
  }
  eq("ilbc.CODES is the key order of its REFUSALS table",
     ilbc.CODES, Object.keys(ilbc.REFUSALS));

  /* Every opcode in the bytecode's own table is either carried (some group's
   * `ops`) or explicitly refused.  The one refused opcode is vget, which
   * ilbc.check reports as ilbc-op. */
  const carriedOps = {};
  for (const f of cgen.FEATURES.carried) for (const op of f.ops || []) carriedOps[op] = true;
  const cgenMissing = Object.keys(ilbc.OPS).filter(function (op) {
    return !carriedOps[op];
  }).sort();
  eq("the C route's carried ops leave exactly the refused opcodes", cgenMissing,
     ["bnot", "not", "setupval", "sprite", "unm", "vget"]);

  const byteOps = {};
  for (const f of ilbc.FEATURES.carried) for (const op of f.ops || []) byteOps[op] = true;
  const byteMissing = Object.keys(ilbc.OPS).filter(function (op) {
    return !byteOps[op];
  }).sort();
  eq("the bytecode route's carried ops leave only vget", byteMissing, ["vget"]);
}

/* ---- 2. source-reachable refusals, with their lines -------------------- */

function checkSourceRefusals() {
  refusal("cgen-op sprite", findingsOf([
    "function init()",
    "  sprite(0, { x = 1, y = 2 })",
    "end",
    "function frame(t, f) end",
    ""
  ].join("\n")), "cgen-op", 2);

  refusal("cgen-fixed", findingsOf([
    "function frame(t, f)",
    "  print(t)",
    "end",
    ""
  ].join("\n")), "cgen-fixed", 2);

  refusal("cgen-hook (no frame)", findingsOf([
    "function init()",
    "  pal(0, 1)",
    "end",
    ""
  ].join("\n")), "cgen-hook", null);

  const nine = findingsOf([
    "local function nine(a, b, c, d, e, g, h, i, j)",
    "  return a",
    "end",
    "function frame(t, f) nine(1, 2, 3, 4, 5, 6, 7, 8, 9) end",
    ""
  ].join("\n"));
  refusal("cgen-arity", nine, "cgen-arity", 2);
  refusal("ilbc-arity", nine, "ilbc-arity", 2);

  refusal("cgen-closure-loop", findingsOf([
    "j = 0",
    "function frame(t, f)",
    "  while j < 2 do",
    "    saved = function() return 1 end",
    "    j = j + 1",
    "  end",
    "end",
    ""
  ].join("\n")), "cgen-closure-loop", 4);

  refusal("cgen-table-escape", findingsOf([
    "held = { x = 0 }",
    "function frame(t, f)",
    "  local s = { x = f }",
    "  held = s",
    "end",
    ""
  ].join("\n")), "cgen-table-escape", 3);

  const big = [];
  for (let i = 0; i < 300; i++) big.push("0");
  refusal("cgen-table-ram", findingsOf([
    "BIG = {" + big.join(", ") + "}",
    "function frame(t, f) end",
    ""
  ].join("\n")), "cgen-table-ram", 1);

  refusal("ilbc-op sfx", findingsOf([
    "function frame(t, f)",
    "  sfx(0, 100, 8, 4)",
    "end",
    ""
  ].join("\n")), "ilbc-op", 2);

  refusal("ilbc-builtin note", findingsOf([
    "function frame(t, f)",
    "  pal(1, note(60))",
    "end",
    ""
  ].join("\n")), "ilbc-builtin", 2);

  refusal("ilbc-fixed", findingsOf([
    "function frame(t, f)",
    "  local x = 1.5",
    "  print(x)",
    "end",
    ""
  ].join("\n")), "ilbc-fixed", 2);

  /* 128 distinct int constants cross MAX_CONST (127).  vram[k] = k adds one
   * distinct constant per line, so the 128th is line 129 (line 1 is the
   * function) — the encoder's own message says "more than 127 constants". */
  const lines = ["function frame(t, f)"];
  for (let k = 0; k < 128; k++) lines.push("  vram[" + k + "] = " + k);
  lines.push("end", "");
  refusal("ilbc-range (the 128th constant)", findingsOf(lines.join("\n")),
          "ilbc-range", 129);

  /* 17 tables of 16 cells = 272 cells, past the interpreter's 256. */
  const many = [];
  for (let t = 0; t < 17; t++) {
    many.push("T" + t + " = {" + new Array(16).fill("0").join(", ") + "}");
  }
  many.push("function frame(t, f) end", "");
  refusal("ilbc-table-ram (the pool overflows)", findingsOf(many.join("\n")),
          "ilbc-table-ram", null);
}

/* ---- 3. the defensive codes, from a mutated IL ------------------------ */

function checkMutatedRefusals() {
  /* cgen-global: a name the IL's type map does not carry.  The first
   * occurrence is the top-level `g = 0` on line 1. */
  {
    const src = "g = 0\nfunction frame(t, f) g = g + 1 end\n";
    const line = 1;
    const fs2 = findingsOf(src, function (p) {
      for (const fn of p.functions) {
        for (const ins of fn.code) {
          if (ins.t === "getglobal" || ins.t === "setglobal")
            ins.name = "__no_such_global";
        }
      }
    });
    refusal("cgen-global", fs2, "cgen-global", line);
  }

  /* cgen-key: a string constant, which il.compile never emits as a value. */
  {
    const src = "function frame(t, f)\n  local x = 1\n  vram[0] = x\nend\n";
    const target = compile(src).functions[compile(src).hooks.frame].code
      .filter((i) => i.t === "const")[0];
    const fs2 = findingsOf(src, function (p) {
      const ins = p.functions[p.hooks.frame].code
        .filter((i) => i.t === "const")[0];
      ins.k = { t: "str", v: "hello" };
    });
    refusal("cgen-key", fs2, "cgen-key", target.line);
  }

  /* cgen-target: a jump past the function. */
  {
    const src = "function frame(t, f)\n  while f < 2 do f = f + 1 end\nend\n";
    const p0 = compile(src);
    const ins0 = p0.functions[p0.hooks.frame].code
      .filter((i) => i.t === "jmp" || i.t === "br" || i.t === "fornext")[0];
    const fs2 = findingsOf(src, function (p) {
      const ins = p.functions[p.hooks.frame].code
        .filter((i) => i.t === "jmp" || i.t === "br" || i.t === "fornext")[0];
      ins.target = 9999;
    });
    refusal("cgen-target", fs2, "cgen-target", ins0.line);
  }

  /* cgen-cond: a branch condition typed as int. */
  {
    const src = "function frame(t, f)\n  if f < 2 then f = f + 1 end\nend\n";
    const p0 = compile(src);
    const br0 = firstBr(p0);
    const fs2 = findingsOf(src, function (p) {
      const br = firstBr(p);
      br.cond.tt = "int";
    });
    refusal("cgen-cond", fs2, "cgen-cond", br0.line);
  }

  /* cgen-width: the HuC dialect's 16-bit int.  check() applies the emitter's
   * own constant rule without emitting. */
  {
    const src = "function frame(t, f)\n  vram[0] = 100000\nend\n";
    const p = compile(src);
    const findings = cgen.check(p, { target: "huc" });
    refusal("cgen-width", findings, "cgen-width", 2);
  }

  /* ilbc-program: no IL at all. */
  {
    const findings = ilbc.check({ lang: "pce-il", version: 1, functions: [],
                                  globals: {}, hooks: {} });
    refusal("ilbc-program", findings, "ilbc-program", null);
  }

  /* ilbc-key: a constant type the bytecode has no form for. */
  {
    const src = "function frame(t, f)\n  local x = 1\n  vram[0] = x\nend\n";
    const p0 = compile(src);
    const ins0 = p0.functions[p0.hooks.frame].code
      .filter((i) => i.t === "const")[0];
    const p = compile(src);
    p.functions[p.hooks.frame].code.filter((i) => i.t === "const")[0]
      .k = { t: "table", v: null };
    refusal("ilbc-key", ilbc.check(p), "ilbc-key", ins0.line);
  }

  /* ilbc-jump: a target past the code. */
  {
    const src = "function frame(t, f)\n  while f < 2 do f = f + 1 end\nend\n";
    const p0 = compile(src);
    const ins0 = p0.functions[p0.hooks.frame].code
      .filter((i) => i.t === "jmp" || i.t === "br" || i.t === "fornext")[0];
    const p = compile(src);
    const ins = p.functions[p.hooks.frame].code
      .filter((i) => i.t === "jmp" || i.t === "br" || i.t === "fornext")[0];
    ins.target = 9999;
    refusal("ilbc-jump", ilbc.check(p), "ilbc-jump", ins0.line);
  }

  /* ilbc-table-key: a table base that is a constant, not a register. */
  {
    const src = "g = { 1, 2 }\nfunction frame(t, f)\n  vram[0] = g[1]\nend\n";
    const p0 = compile(src);
    let tget0 = null;
    for (const fn of p0.functions) {
      for (const ins of fn.code) if (ins.t === "tget") tget0 = ins;
    }
    const p = compile(src);
    let tget = null;
    for (const fn of p.functions) {
      for (const ins of fn.code) if (ins.t === "tget") tget = ins;
    }
    tget.base = { k: { t: "int", v: 1 } };
    refusal("ilbc-table-key", ilbc.check(p), "ilbc-table-key",
            tget0 ? tget0.line : null);
  }

  /* ilbc-table-escape (the bytecode's copy of the C rule). */
  {
    const src = [
      "held = { x = 0 }",
      "function frame(t, f)",
      "  local s = { x = f }",
      "  held = s",
      "end",
      ""
    ].join("\n");
    refusal("ilbc-table-escape", findingsOf(src), "ilbc-table-escape", 3);
  }
}

/* ---- 4. PLATFORMER is ok ---------------------------------------------- */

function checkPlatformer() {
  const source = fs.readFileSync(PLATFORMER, "utf8");
  const report = romcheck.check(source);
  check(report.ok, "PLATFORMER reports ok (got " + report.findings.length +
        " findings: " + report.findings.map((f) => f.code).join(", ") + ")");
  eq("PLATFORMER's findings are empty", report.findings, []);
}

/* ---- 5. the drawer and the MCP tool give the same findings ------------- */

async function checkSameFindings() {
  /* The drawer's module reads PCEStudio.romcheck, the page's global. */
  global.PCEStudio = { romcheck: romcheck };
  const session = agentTools.createSession({});
  const cases = [["PLATFORMER", fs.readFileSync(PLATFORMER, "utf8")],
                 ["DUSK RUN", fs.readFileSync(DUSK_RUN, "utf8")]];

  for (const [name, source] of cases) {
    const drawer = panel.run(source);
    check(drawer && Array.isArray(drawer.findings),
          name + ": the drawer module returns a report");
    await session.call("toy_write", {
      files: [{ name: "main.lua", source: source }]
    });
    const reply = await session.call("rom_check", {});
    /* The core marks every ok:false reply isError:true (the MCP convention
     * for a refusal), so a toy with findings sets it — the reply is still a
     * JSON body with findings, not a transport failure. */
    check(reply && reply.content && reply.content[0] &&
          typeof reply.content[0].text === "string",
          name + ": rom_check answers with a JSON content block");
    if (drawer.findings.length) {
      check(reply.isError, name + ": a refused toy answers isError:true");
    } else {
      check(!reply.isError, name + ": a clean toy answers isError:false");
    }
    const body = JSON.parse(reply.content[0].text);
    eq(name + ": the MCP tool's findings are the drawer's", body.findings,
       drawer.findings);
    eq(name + ": the MCP tool's carried lists are the drawer's",
       body.carried, drawer.carried);
    eq(name + ": the MCP tool's refused lists are the drawer's",
       body.refused, drawer.refused);
    eq(name + ": the status line is the report's",
       panel.statusText(drawer),
       drawer.findings.length ? "ROM: " + drawer.findings.length + " problems"
                              : "ROM: ok");
    const lines = panel.lines(drawer);
    const wantLines = Array.from(new Set(drawer.findings
      .map((f) => f.line).filter((n) => n != null))).sort((a, b) => a - b);
    eq(name + ": the gutter lines are the findings' lines", lines, wantLines);
  }
  delete global.PCEStudio;
}

/* ---- 6. the studio wires the drawer ---------------------------------- */

function checkStudioWiring() {
  const html = fs.readFileSync(STUDIO, "utf8");
  check(/<script src="pce-romcheck\.js"><\/script>/.test(html),
        "studio.html loads renderer/pce-romcheck.js");
  check(/<script src="studio-panel-romcheck\.js"><\/script>/.test(html),
        "studio.html loads the drawer module");
  check(/id="rom-status"/.test(html),
        "studio.html has the ROM status line beside Export");
  check(/id="tab-rom"/.test(html) && /id="bottom-rom"/.test(html),
        "studio.html has the ROM CHECK tab and panel");
  check(/scheduleRomCheck\(\)/.test(html) &&
        /if \(f && f\.name === "main\.lua"\)[\s\S]{0,160}scheduleRomCheck\(\)/
          .test(html),
        "an edit to main.lua schedules the debounced ROM check");
  check(/panel\.run\(mainSource\(\)/.test(html),
        "the drawer runs the shared check on the current source");
  check(/romCheck: \(\) => romReport/.test(html),
        "the studio API exposes the drawer's report");
}

/* ---- main -------------------------------------------------------------- */

(async function main() {
  checkTables();
  checkSourceRefusals();
  checkMutatedRefusals();
  checkPlatformer();
  await checkSameFindings();
  checkStudioWiring();

  console.log("");
  if (skips.length) console.log("SKIP  " + skips.length + " (" +
                                skips.join("; ") + ")");
  console.log(checks + " checks, " + failures.length + " failure" +
              (failures.length === 1 ? "" : "s"));
  if (failures.length) {
    console.log(failures.map(function (f) { return "  - " + f; }).join("\n"));
    process.exitCode = 1;
  } else {
    console.log("PASS  rom check: both compilers' tables, every refusal code " +
                "with its line, PLATFORMER ok, drawer == MCP");
  }
})().catch(function (e) {
  console.error("check-romcheck crashed: " + (e && e.stack || e));
  process.exitCode = 1;
});
