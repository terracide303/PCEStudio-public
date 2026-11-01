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
                             require("./pce-ilbc.js"));
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.romcheck = factory(root.PCEStudio.il,
                                      root.PCEStudio.cgen,
                                      root.PCEStudio.ilbc);
  }
})(typeof self !== "undefined" ? self : this, function (il, cgen, ilbc) {
  "use strict";

  var CHUNK = "@main.lua";

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

  function report(findings) {
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
      routes: { cgen: cgen.FEATURES.route, ilbc: ilbc.FEATURES.route }
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
      return report(findings);
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
    return report(findings);
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
    return report(findings);
  }

  return {
    CHUNK: CHUNK,
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
