/*
 * studio-panel-romcheck.js — the ROM CHECK drawer's own module (card #193).
 *
 * The drawer is not a second check: run() calls renderer/pce-romcheck.js,
 * which runs the two compilers' front ends.  This file owns the small part
 * that is the studio's: the status words beside Export, the lines the gutter
 * marks, and the drawer's DOM.  Keeping it here (rather than inline in
 * studio.html) is what lets tests/check-romcheck.js compare the drawer's
 * findings with the MCP tool's: both call run() on the same source and get
 * the same object.
 *
 * UMD like its neighbours: CommonJS in Node (the test), PCEStudio.romcheckPanel
 * in the page.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.romcheckPanel = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function api() {
    return typeof PCEStudio !== "undefined" ? PCEStudio
         : (typeof self !== "undefined" ? self.PCEStudio : null);
  }

  /* The check, through the page's PCEStudio.romcheck (or the Node require
   * the test wired into the global).  A missing module is a report with one
   * finding, not an exception the page would have to catch. */
  function run(source, options) {
    var P = api();
    var R = P && P.romcheck;
    if (!R || typeof R.check !== "function") {
      return {
        ok: false,
        findings: [{ code: "romcheck-missing", line: null,
          message: "renderer/pce-romcheck.js did not load" }],
        carried: { cgen: [], ilbc: [] },
        refused: { cgen: {}, ilbc: {} },
        routes: {}
      };
    }
    try {
      return R.check(source, options || { chunkName: "@main.lua" });
    } catch (e) {
      return {
        ok: false,
        findings: [{ code: (e && e.code) || "romcheck-error", line: null,
          message: String((e && e.message) || e) }],
        carried: { cgen: [], ilbc: [] },
        refused: { cgen: {}, ilbc: {} },
        routes: {}
      };
    }
  }

  /* The one line beside Export. */
  function statusText(report) {
    if (!report) return "ROM: —";
    var n = (report.findings || []).length;
    return n ? "ROM: " + n + " problems" : "ROM: ok";
  }

  /* The Lua lines the gutter marks, sorted and unique. */
  function lines(report) {
    var seen = {}, out = [];
    var list = report && report.findings || [];
    for (var i = 0; i < list.length; i++) {
      var n = list[i].line;
      if (n == null || seen[n]) continue;
      seen[n] = true;
      out.push(n);
    }
    return out.sort(function (a, b) { return a - b; });
  }

  /* The drawer.  `doc` is the page's document, `host` the panel element, and
   * onLine(n) is how a finding's main.lua:N link reaches the editor. */
  function render(doc, host, report, onLine) {
    if (!host) return;
    while (host.firstChild) host.removeChild(host.firstChild);
    function el(tag, cls, text) {
      var e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = String(text);
      return e;
    }
    host.appendChild(el("div", "rom-head", "ROM CHECK"));
    if (!report) {
      host.appendChild(el("p", "rom-summary is-bad",
        "The ROM check module did not load (renderer/pce-romcheck.js)."));
      return;
    }
    var n = report.findings.length;
    host.appendChild(el("p", "rom-summary " + (n ? "is-bad" : "is-ok"),
      n ? n + " problem" + (n === 1 ? "" : "s") +
          " — the exported ROM will refuse this toy until they are fixed."
        : "ok — both cartridge routes carry this toy."));
    if (n) {
      var list = el("ul", "rom-list");
      for (var i = 0; i < report.findings.length; i++) {
        var f = report.findings[i];
        var item = el("li", "rom-item");
        if (f.line != null) {
          (function (line) {
            var b = el("button", "rom-line-btn", "main.lua:" + line);
            b.type = "button";
            b.title = "Go to this line";
            b.addEventListener("click", function () {
              if (typeof onLine === "function") onLine(line);
            });
            item.appendChild(b);
          })(f.line);
        } else {
          item.appendChild(el("span", "rom-line-btn", "main.lua"));
        }
        item.appendChild(el("span", "rom-code", f.code));
        item.appendChild(el("span", "rom-msg", f.message));
        list.appendChild(item);
      }
      host.appendChild(list);
    }

    var count = 0;
    var keys = ["cgen", "ilbc"];
    for (var k = 0; k < keys.length; k++)
      count += ((report.carried[keys[k]]) || []).length;
    var details = el("details", "rom-carried");
    details.appendChild(el("summary", null,
      "Carried today (" + count + " features)"));
    var names = { cgen: "C compiler", ilbc: "bytecode interpreter" };
    for (var j = 0; j < keys.length; j++) {
      var p = el("p");
      p.appendChild(el("b", null, names[keys[j]] + ": "));
      p.appendChild(el("span", null, (report.carried[keys[j]] || [])
        .map(function (feature) { return feature.label; }).join("; ")));
      details.appendChild(p);
    }
    host.appendChild(details);
  }

  return { run: run, statusText: statusText, lines: lines, render: render };
});
