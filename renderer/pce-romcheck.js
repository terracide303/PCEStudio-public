/*
 * pce-romcheck.js — what the exported ROM can and cannot run, while the toy
 * is being written (card #193).
 *
 * The two questions a toy author asks are "does this run in the page?" and
 * "will it run on a cartridge?".  The first is the CONSOLE tab (#98); this
 * module answers the second WITHOUT building anything:
 *
 *   main.lua --pce-il--> IL --+-- pce-cgen.check()  the C route (the page's
 *                              |                    Export -> llvm-mos)
 *                              +-- pce-ilbc.check()  the bytecode route (the
 *                                                   interpreter image every
 *                                                   exported .pce carries)
 *
 * Both checks run the compiler's own front end and rules and return every
 * refusal at once, in source order, so the drawer lists the whole job and
 * not one line at a time.  Nothing here is a second model: the findings are
 * the CGenError/ILBCError/ToyError objects the compilers raise, and the
 * carried/refused lists are renderer/pce-cgen.js's and renderer/pce-ilbc.js's
 * own FEATURES/REFUSALS tables — a feature added to either compiler appears
 * here, in the drawer, in the MCP tool and in the generated docs with no
 * second edit.
 *
 * The Studio's ROM CHECK drawer (renderer/studio.html), the MCP tool
 * rom_check (renderer/pce-agent-tools.js) and tools/docs.js all call
 * check(); tests/check-romcheck.js drives the drawer and the tool through
 * their real entry points and compares the findings.
 *
 * UMD like its neighbours: CommonJS in Node, PCEStudio.romcheck in the page.
 * No Node tokens: the same file runs in the tab and in the tests.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./pce-il.js"),
                             require("./pce-cgen.js"),
                             require("./pce-ilbc.js"),
                             require("./pce-rom.js"));
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.romcheck = factory(root.PCEStudio.il,
                                      root.PCEStudio.cgen,
                                      root.PCEStudio.ilbc,
                                      root.PCEStudio.rom);
  }
})(typeof self !== "undefined" ? self : this, function (il, cgen, ilbc, rom) {
  "use strict";

  var CHUNK = "@main.lua";

  /* ---- the budget (card #261) ------------------------------------------ *
   * Every capacity the console's interpreter enforces, with where its
   * number comes from.  The numbers are literals here because the C
   * interpreter's #defines (tools/ilvm/ilvm.c) are not visible to a UMD
   * module that runs in the page; tests/check-rom-budget.js reads the C
   * source and fails if one differs, so this table cannot go stale.  The
   * data bank, the constant pool, the table pool and the argument count are
   * read from the JavaScript modules that already own them. */
  var LIMITS = [
    { id: "data-bank", label: "data bank", limit: rom.SONG_TABLE_OFF,
      unit: "B", refusal: "toy-data-bank-full",
      source: "renderer/pce-rom.js SONG_TABLE_OFF (an 8,192 B bank less " +
              "the 32 B song trailer)",
      what: "the bytecode the interpreter reads" },
    { id: "constants", label: "constants", limit: ilbc.MAX_CONST,
      refusal: "ilbc-range", source: "renderer/pce-ilbc.js MAX_CONST",
      what: "distinct int/bool/nil constants in the container" },
    { id: "functions", label: "functions", limit: 41,
      refusal: "rom-budget", source: "tools/ilvm/ilvm.c MAX_FUNCS",
      what: "function ids the interpreter's table holds" },
    { id: "registers", label: "registers", limit: 41,
      refusal: "rom-budget", source: "tools/ilvm/ilvm.c MAX_REGS",
      what: "registers in the toy's busiest function" },
    { id: "upvalues", label: "upvalues", limit: 20,
      refusal: "rom-budget", source: "tools/ilvm/ilvm.c MAX_UPS",
      what: "upvalues in the toy's most-capturing function" },
    { id: "upvalue-cells", label: "upvalue cells at boot", limit: 72,
      refusal: "rom-budget", source: "tools/ilvm/ilvm.c UP_PERM",
      what: "captured cells the boot closures take from the permanent " +
            "pool (a loop can capture more)", approximate: true },
    { id: "globals", label: "globals", limit: 32,
      refusal: "rom-budget", source: "tools/ilvm/ilvm.c MAX_GLOBALS",
      what: "named globals" },
    { id: "closures", label: "closures at boot", limit: 48,
      refusal: "rom-budget", source: "tools/ilvm/ilvm.c MAX_CLOS",
      what: "closure sites in the chunk and init() (a loop can make more)",
      approximate: true },
    { id: "table-slots", label: "table slots", limit: 16,
      refusal: "rom-budget",
      source: "tools/ilvm/ilvm.c MAX_SLOTS",
      what: "table sites with their own fixed pool slot" },
    { id: "table-cells", label: "table cells", limit: ilbc.TABLE_POOL_CELLS,
      refusal: "ilbc-table-ram",
      source: "tools/ilvm/ilvm.c MAX_TABLE_CELLS (renderer/pce-ilbc.js " +
              "TABLE_POOL_CELLS)",
      what: "cells in the fixed table pool" },
    { id: "arguments", label: "arguments", limit: ilbc.MAX_ARGS,
      refusal: "ilbc-arity", source: "renderer/pce-ilbc.js MAX_ARGS " +
              "(tools/ilvm/ilvm.c MAX_ARGS)",
      what: "parameters a function takes or a call passes" }
  ];

  /* "near" past 80%, "over" past 100%, exactly as the card defines them. */
  var NEAR_PERCENT = 80, OVER_PERCENT = 100;

  function round1(n) { return Math.round(n * 10) / 10; }

  function statusOf(percent) {
    if (percent == null) return "unknown";
    if (percent > OVER_PERCENT) return "over";
    if (percent > NEAR_PERCENT) return "near";
    return "ok";
  }

  /* The C interpreter's #define, for a source string that names it. */
  function interpreterConstants() {
    return {
      "data-bank": rom.SONG_TABLE_OFF,
      "constants": ilbc.MAX_CONST,
      "functions": 41,
      "registers": 41,
      "upvalues": 20,
      "upvalue-cells": 72,
      "globals": 32,
      "closures": 48,
      "table-slots": 16,
      "table-cells": ilbc.TABLE_POOL_CELLS,
      "arguments": ilbc.MAX_ARGS
    };
  }

  /* Count the encoder's constant pool when encode() itself refuses (a toy
   * over 127 constants has no container, but its count is still useful).
   * This mirrors pce-ilbc.js's seeOperand walk; it is a measurement, not a
   * second encoder: a mistake here shows a number, never a byte. */
  function countConstants(program) {
    var seen = {}, n = 0, f, pc, i;
    function key(k) {
      if (!k || k.v == null) return null;
      return k.t + ":" + String(k.v);
    }
    function see(op) {
      if (!op || op.r != null || !op.k) return;
      var k = key(op.k);
      if (k == null || seen[k]) return;
      seen[k] = true;
      n++;
    }
    var functions = program.functions || [];
    for (f = 0; f < functions.length; f++) {
      var code = functions[f].code || [];
      for (pc = 0; pc < code.length; pc++) {
        var ins = code[pc];
        if (ins.t === "const" && ins.k) see({ k: ins.k });
        ["a", "b", "cond", "src", "addr", "word", "value", "song", "ch",
         "freq", "volume", "frames"].forEach(function (field) {
          if (ins[field]) see(ins[field]);
        });
        if (ins.args) for (i = 0; i < ins.args.length; i++) see(ins.args[i]);
        if (ins.t === "sat") { see(ins.i); see(ins.k); see(ins.v); }
        if ((ins.t === "tget" || ins.t === "tset") && ins.key &&
            ins.key.k && ins.key.k.t === "int") {
          see({ k: ins.key.k });
        }
      }
    }
    return n;
  }

  /* The toy's use of each capacity.  Everything except the container size
   * and the constant count comes from the IL; encode() supplies the two
   * that only the layout knows. */
  function measure(program) {
    var functions = program.functions || [];
    var maxRegs = 0, maxUps = 0, maxArgs = 0, boot = 0;
    var sprites = 0, rasterTables = 0, usesTables = false;
    var f, pc, i;
    for (f = 0; f < functions.length; f++) {
      var fn = functions[f];
      var code = fn.code || [];
      maxRegs = Math.max(maxRegs, fn.registers || 0);
      maxUps = Math.max(maxUps, (fn.upvalues || []).length);
      maxArgs = Math.max(maxArgs, (fn.params || []).length);
      for (pc = 0; pc < code.length; pc++) {
        var ins = code[pc];
        if (ins.t === "call") maxArgs = Math.max(maxArgs, (ins.args || []).length);
        if (ins.t === "closure" &&
            (f === 0 || f === (program.hooks && program.hooks.init))) boot++;
        if (ins.t === "sprite") sprites++;
        if (ins.t === "raster") rasterTables++;
        if (ins.t === "table" || ins.t === "setlist" || ins.t === "tget" ||
            ins.t === "tset") usesTables = true;
      }
    }
    /* The boot closures' upvalue cells: the functions the chunk and init()
     * create closures for, each taking its `nups` cells from UP_PERM. */
    var bootCells = 0, initFid = program.hooks && program.hooks.init;
    for (f = 0; f < functions.length; f++) {
      if (f !== 0 && f !== initFid) continue;
      var bootCode = functions[f].code || [];
      for (pc = 0; pc < bootCode.length; pc++) {
        if (bootCode[pc].t !== "closure") continue;
        var target = functions[bootCode[pc].fid];
        if (target) bootCells += (target.upvalues || []).length;
      }
    }
    var layout = null;
    try { layout = ilbc.tableLayout(program); } catch (e) { layout = null; }
    var encoded = null, size = null, constants = null;
    try {
      encoded = ilbc.encode(program);
      size = encoded.size;
      constants = encoded.constants;
    } catch (e) {
      encoded = null;
      constants = countConstants(program);
    }
    return {
      "data-bank": size,
      "constants": constants,
      "functions": functions.length,
      "registers": maxRegs,
      "upvalues": maxUps,
      "upvalue-cells": bootCells,
      "globals": (program.globals || []).length,
      "closures": boot,
      "table-slots": layout ? layout.nslots : (usesTables ? null : 0),
      "table-cells": layout ? layout.cells : (usesTables ? null : 0),
      "arguments": maxArgs,
      features: { sprites: sprites, rasterTables: rasterTables },
      exact: {
        "data-bank": size != null,
        "constants": encoded != null,
        "table-slots": layout != null || !usesTables,
        "table-cells": layout != null || !usesTables
      }
    };
  }

  function budgetOf(program) {
    if (!program) return null;
    var used = measure(program);
    var rows = LIMITS.map(function (limit) {
      var u = used[limit.id];
      var pct = u == null || !limit.limit ? null
              : round1(u * 100 / limit.limit);
      var row = {
        id: limit.id, label: limit.label, used: u, limit: limit.limit,
        unit: limit.unit || null, left: u == null ? null : limit.limit - u,
        percent: pct, status: statusOf(pct),
        refusal: limit.refusal, source: limit.source, what: limit.what
      };
      if (limit.approximate) row.approximate = true;
      if (used.exact && used.exact[limit.id] === false) row.exact = false;
      return row;
    });
    var near = rows.filter(function (r) { return r.status === "near"; }).length;
    var over = rows.filter(function (r) { return r.status === "over"; }).length;
    return {
      ok: over === 0,
      near: near,
      over: over,
      rows: rows,
      features: used.features,
      note: "each limit is the console interpreter's (tools/ilvm/ilvm.c); " +
            "near is past " + NEAR_PERCENT + "%, over past " + OVER_PERCENT +
            "% and is refused by the finding in `refusal`. A sprite spec the " +
            "walker cannot resolve and a raster(line, spec) table are " +
            "findings, not capacities. A row with approximate:true is a " +
            "static count of closure sites; a loop can create more."
    };
  }

  /* The over-limit rows as findings, for the report.  A code the compiler
   * checks already raised is not repeated: one cause, one finding. */
  function budgetFindings(budget, findings) {
    if (!budget) return [];
    var have = {};
    for (var i = 0; i < findings.length; i++) have[findings[i].code] = true;
    var out = [];
    for (var j = 0; j < budget.rows.length; j++) {
      var row = budget.rows[j];
      /* A compiler code is reported once (one cause, one finding); the
       * budget's own code names a capacity, so two capacities over are two
       * findings. */
      if (row.status !== "over" || (have[row.refusal] &&
          row.refusal !== "rom-budget")) continue;
      var message;
      if (row.id === "data-bank") {
        message = "the bytecode (" + row.used + " B) needs " + row.used +
                  " bytes; the data bank has " + row.limit + " usable bytes " +
                  "after the 32-byte song trailer";
      } else {
        message = row.label + ": " + row.used + " used, " + row.limit +
                  " the interpreter holds (" + row.source + "); the toy " +
                  "stops at load with a blank screen";
      }
      out.push(finding(row.refusal, null, message));
      have[row.refusal] = true;
    }
    return out;
  }

  /* The Lua line a compiler message points at.  The IL's own refusals say
   * "line N:" or name the chunk; the C backend says "IL line N,"; a bytecode
   * message may not name a line at all (its structured .line is preferred). */
  function lineOfMessage(message) {
    var text = String(message == null ? "" : message);
    var m = /(?:^|[^\w])(?:main|toy)\.lua:(\d+)\b/.exec(text);
    if (m) return Number(m[1]);
    var re = /\bline (\d+)\b/gi, hit;
    while ((hit = re.exec(text))) {
      var before = text.slice(Math.max(0, hit.index - 4), hit.index)
        .toLowerCase();
      if (before === "vdw ") continue;       /* the display line, not Lua's */
      return Number(hit[1]);
    }
    return null;
  }

  function finding(code, line, message) {
    return { code: code || "romcheck-error",
             line: line == null ? null : Number(line),
             message: String(message == null ? "" : message) };
  }

  /* The two route tables, copied field for field from the compilers. */
  function carriedTables() {
    function copy(list) {
      return (list || []).map(function (f) {
        var out = { id: f.id, label: f.label, detail: f.detail };
        if (f.ops) out.ops = f.ops.slice();
        return out;
      });
    }
    return { cgen: copy(cgen.FEATURES.carried),
             ilbc: copy(ilbc.FEATURES.carried) };
  }

  function refusedTables() {
    function copy(map) {
      var out = {};
      for (var k in map) {
        if (Object.prototype.hasOwnProperty.call(map, k)) out[k] = map[k];
      }
      return out;
    }
    return { cgen: copy(cgen.FEATURES.refused),
             ilbc: copy(ilbc.FEATURES.refused) };
  }

  function report(findings, budget) {
    var seen = {}, out = [];
    for (var i = 0; i < findings.length; i++) {
      var f = findings[i];
      var key = f.code + "\u0000" + (f.line == null ? "" : f.line) +
                "\u0000" + f.message;
      if (seen[key]) continue;
      seen[key] = true;
      out.push(f);
    }
    out.sort(function (a, b) {
      var la = a.line == null ? Infinity : a.line;
      var lb = b.line == null ? Infinity : b.line;
      return la - lb || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
    });
    return {
      ok: out.length === 0,
      findings: out,
      carried: carriedTables(),
      refused: refusedTables(),
      routes: { cgen: cgen.FEATURES.route, ilbc: ilbc.FEATURES.route },
      budget: budget || null
    };
  }

  /* check(source, { chunkName }) -> the report above.  A Lua or IL refusal is
   * the first finding and the compiler checks are skipped (there is no IL to
   * check); otherwise both back ends are run and their findings merged. */
  function check(source, options) {
    var chunkName = options && options.chunkName || CHUNK;
    var findings = [];
    var program = null;
    try {
      program = il.compile(String(source == null ? "" : source),
                           { chunkName: chunkName });
    } catch (e) {
      findings.push(finding(e && e.code || "il-error",
                            lineOfMessage(e && e.message),
                            "the IL front end refuses this toy: " +
                            (e && e.message || String(e))));
      return report(findings, null);
    }

    try {
      var cg = cgen.check(program);
      for (var i = 0; i < cg.length; i++) {
        findings.push(finding(cg[i].code, cg[i].line, cg[i].message));
      }
    } catch (e) {
      findings.push(finding(e && e.code || "cgen-error",
                            lineOfMessage(e && e.message),
                            "the C backend check failed: " +
                            (e && e.message || String(e))));
    }

    try {
      var bc = ilbc.check(program);
      for (var j = 0; j < bc.length; j++) {
        findings.push(finding(bc[j].code, bc[j].line, bc[j].message));
      }
    } catch (e) {
      findings.push(finding(e && e.code || "ilbc-error",
                            lineOfMessage(e && e.message),
                            "the bytecode check failed: " +
                            (e && e.message || String(e))));
    }
    var budget = budgetOf(program);
    findings = findings.concat(budgetFindings(budget, findings));
    return report(findings, budget);
  }

  /* checkProgram(program) is check() for a caller that already holds the IL
   * (tests and tools that compile once). */
  function checkProgram(program) {
    var findings = [];
    try {
      var cg = cgen.check(program);
      for (var i = 0; i < cg.length; i++) {
        findings.push(finding(cg[i].code, cg[i].line, cg[i].message));
      }
    } catch (e) {
      findings.push(finding(e && e.code || "cgen-error",
                            lineOfMessage(e && e.message),
                            String(e && e.message || e)));
    }
    try {
      var bc = ilbc.check(program);
      for (var j = 0; j < bc.length; j++) {
        findings.push(finding(bc[j].code, bc[j].line, bc[j].message));
      }
    } catch (e) {
      findings.push(finding(e && e.code || "ilbc-error",
                            lineOfMessage(e && e.message),
                            String(e && e.message || e)));
    }
    var budget = budgetOf(program);
    findings = findings.concat(budgetFindings(budget, findings));
    return report(findings, budget);
  }

  return {
    CHUNK: CHUNK,
    /* #261: the capacities and the toy's use of them, for callers that want
     * the numbers without a report. */
    LIMITS: LIMITS,
    constants: interpreterConstants,
    budget: budgetOf,
    check: check,
    checkProgram: checkProgram,
    carried: function () { return carriedTables(); },
    refused: function () { return refusedTables(); },
    routes: function () {
      return { cgen: cgen.FEATURES.route, ilbc: ilbc.FEATURES.route };
    },
    lineOfMessage: lineOfMessage,
    /* The compilers' tables, for a caller that wants them without a check. */
    FEATURES: { cgen: cgen.FEATURES, ilbc: ilbc.FEATURES }
  };
});
