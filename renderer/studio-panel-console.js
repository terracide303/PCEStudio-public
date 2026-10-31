/*
 * studio-panel-console.js — the CONSOLE panel (card #98), a module of the
 * studio since #102.
 *
 * ppu.toys' SNES tab is the working example: a banner that says whether the
 * toy can run on the real console, the findings that stop it with a clickable
 * file:line, the frame time, the code and ROM size, and an honest note about
 * what the numbers are.  This is the PC Engine counterpart, and it runs the
 * whole console pipeline in the browser as the toy changes:
 *
 *   pce-il.js       the Lua -> IL lowering and its refusals
 *   pce-validate.js cycles per frame and per raster line, sprites per line,
 *                   VRAM fit, the ROM estimate
 *   pce-cgen.js     the IL -> C emitter and its refusals (#31 part A/C)
 *
 * The panel reads the toy through the studio API (studio.toy.source,
 * studio.editorLine, studio.render.lastError) and the three modules through
 * PCEStudio.il / .validate / .cgen — it does not parse Lua itself and keeps
 * no second copy of the report.  docs/STUDIO.md §3.6.
 */
(function (root) {
  "use strict";
  var P = root.PCEStudio = root.PCEStudio || {};
  P.studioPanelModules = P.studioPanelModules || [];

  /* The frame length the STATS show.  The project carries two numbers for
   * the same 60 Hz frame: docs/MANUALS.md (Tech Notes) says 119,904 machine
   * cycles, and pce-validate.js calibrates its budget against 119,318
   * (7.15909 MHz / 60).  Card #98 names 119,904 for the percentage here; a
   * finding from the validator quotes the validator's own number, so the two
   * are never presented as the same figure without saying so. */
  var FRAME_CLOCKS = 119904;
  var ROM_LIMIT = 1048576;
  var FRAMES = 8;                  /* the validator's measured run length */

  P.studioPanelModules.push({
    id: "console",
    register: function (studio) {
      var cache = { source: null, state: null };
      var last = null;
      /* #167: what the agent link put here.  toy_run's log is the tool
       * core's own (what Claude was told), and validate's report is the
       * validator's — the studio mirrors both, it does not re-derive them. */
      var runLog = { lines: [], frames: 0, at: null };
      var checkReport = null;

      function el(tag, cls, text) {
        var e = studio.document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = String(text);
        return e;
      }

      function thousands(n) {
        return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      }

      /* The Lua line a finding points at.  The validator's and the C
       * emitter's messages name it in their own formats ("line 12: ...",
       * "IL line 12,"); a Lua compile error names the chunk.  A "VDW line"
       * is the display line, not a Lua line, so it is skipped. */
      function lineOfMessage(message) {
        var text = String(message || "");
        var m = /(?:^|[^\w])(?:main|toy)\.lua:(\d+)\b/.exec(text);
        if (m) return Number(m[1]);
        var re = /\bline (\d+)\b/gi, hit;
        while ((hit = re.exec(text))) {
          var before = text.slice(Math.max(0, hit.index - 4), hit.index)
            .toLowerCase();
          if (before === "vdw ") continue;
          return Number(hit[1]);
        }
        return null;
      }

      /* A finding with no line of its own but which is about the frame as a
       * whole points at the toy's `function frame(` definition. */
      function hookLine(source, hook) {
        var re = new RegExp("(^|\\n)\\s*(?:local\\s+)?function\\s+" + hook +
                            "\\s*\\(");
        var m = re.exec(source);
        if (!m) return null;
        return source.slice(0, m.index + m[1].length).split("\n").length;
      }

      function findingLine(p, source) {
        var direct = p.line != null ? p.line : lineOfMessage(p.message);
        if (direct != null) return direct;
        if (/frame/.test(p.code || "")) return hookLine(source, "frame");
        if (/raster/.test(p.code || "")) return hookLine(source, "raster");
        return null;
      }

      /* Run the three stages over one source.  Returns the report the panel
       * draws; nothing here touches the page's DOM. */
      function analyse(source) {
        var findings = [];
        var program = null;
        var report = null;
        var codeBytes = null;
        var pipelineError = "";

        if (!P.il || !P.validate) {
          pipelineError = "the IL/validator modules did not load " +
            "(pce-il.js, pce-validate.js)";
          findings.push({
            severity: "error", code: "pipeline-missing",
            message: pipelineError, line: null
          });
          return finish(source, findings, null, codeBytes, pipelineError);
        }

        try {
          program = P.il.compile(source, { chunkName: "@main.lua" });
        } catch (e) {
          findings.push({
            severity: "error", code: e.code || "il-error",
            message: String(e && e.message || e),
            line: lineOfMessage(e && e.message)
          });
        }

        if (program) {
          try {
            report = P.validate.validateProgram(program, {
              chunkName: "@main.lua", frames: FRAMES
            });
            for (var i = 0; i < report.problems.length; i++) {
              var p = report.problems[i];
              findings.push({
                severity: p.severity === "warn" ? "warn" : "error",
                code: p.code, message: p.message,
                line: findingLine(p, source)
              });
            }
          } catch (e) {
            findings.push({
              severity: "error", code: e.code || "validate-error",
              message: String(e && e.message || e), line: null
            });
          }

          if (P.cgen) {
            try {
              codeBytes = P.cgen.emitC(program, { target: "llvm" }).length;
            } catch (e) {
              findings.push({
                severity: "error", code: e.code || "cgen-error",
                message: String(e && e.message || e),
                line: lineOfMessage(e && e.message)
              });
            }
          } else {
            findings.push({
              severity: "error", code: "pipeline-missing",
              message: "the C emitter did not load (pce-cgen.js)",
              line: null
            });
          }
        }

        return finish(source, findings, report, codeBytes, pipelineError);
      }

      function finish(source, findings, report, codeBytes, pipelineError) {
        var errors = 0, warnings = 0;
        for (var i = 0; i < findings.length; i++) {
          if (findings[i].severity === "warn") warnings++;
          else errors++;
        }
        var budgets = report && report.budgets ? report.budgets : null;
        var stats = {
          frameCycles: null, collectionCycles: null, framePct: null,
          rasterMean: null, rasterWorst: null, rasterCells: null,
          strips: null, stripLine: null, vramWord: null, vramLimit: 32768,
          codeBytes: codeBytes, romBytes: null, romBanks: null,
          romLimit: ROM_LIMIT, frameClocks: FRAME_CLOCKS,
          /* #115: route 1's projection for the Export dialog — the same
           * validator report, not a second estimate. */
          route1: budgets ? budgets.route1 : null
        };
        if (budgets) {
          stats.frameCycles = budgets.frameCycles;
          stats.collectionCycles = budgets.collectionCycles;
          stats.framePct = budgets.collectionCycles / FRAME_CLOCKS;
          stats.rasterMean = budgets.rasterMean;
          stats.rasterWorst = budgets.rasterWorst;
          stats.strips = budgets.sprites.requested;
          stats.stripLine = budgets.sprites.line;
          stats.vramWord = budgets.vram.maxWord;
          stats.romBytes = budgets.rom.bytes;
          stats.romBanks = budgets.rom.banks;
        }
        var banner;
        if (errors > 0) {
          banner = {
            state: "bad",
            text: "Can't run on the PC Engine as written yet: " + errors +
              " problem" + (errors === 1 ? "" : "s") + " to fix"
          };
        } else if (!report && pipelineError) {
          banner = { state: "bad", text: pipelineError };
        } else {
          banner = { state: "ok", text: "Can run on the PC Engine" };
        }
        return {
          source: source, banner: banner, errors: errors,
          warnings: warnings, findings: findings, stats: stats,
          compiled: !!report, hooks: report ? report.hooks : null,
          functions: report ? report.functions : 0
        };
      }

      function state() {
        var source = studio.toy.source() || "";
        if (!cache.state || cache.source !== source) {
          cache.state = analyse(source);
          cache.source = source;
        }
        last = cache.state;
        return cache.state;
      }

      function gotoLine(line) {
        if (!studio.editorLine || line == null) return false;
        if (studio.activeFile && studio.activeFile() !== "main.lua" &&
            studio.selectFile) {
          studio.selectFile("main.lua");
        }
        studio.editorLine(line);
        return true;
      }

      /* ---- the drawing -------------------------------------------------- */
      function drawBanner(S) {
        var banner = studio.$("console-banner");
        if (!banner) return;
        banner.textContent = S.banner.text;
        banner.className = "con-banner is-" + S.banner.state;
        banner.setAttribute("data-state", S.banner.state);
        banner.setAttribute("role", "status");
      }

      function drawFindings(S) {
        var host = studio.$("console-findings");
        var count = studio.$("console-count");
        if (count) {
          count.textContent = S.errors + " error" + (S.errors === 1 ? "" : "s") +
            (S.warnings ? " · " + S.warnings + " warning" +
              (S.warnings === 1 ? "" : "s") : "");
        }
        if (!host) return;
        host.innerHTML = "";
        if (!S.findings.length) {
          var none = el("li", "con-finding is-none",
                        "No findings: the IL lowers, the budgets fit and " +
                        "the C emitter accepts it.");
          host.appendChild(none);
          return;
        }
        for (var i = 0; i < S.findings.length; i++) {
          (function (f) {
            var li = el("li", "con-finding is-" + f.severity);
            if (f.line != null) {
              var button = el("button", "con-line",
                              "main.lua:" + f.line);
              button.type = "button";
              button.title = "Go to main.lua line " + f.line;
              button.addEventListener("click", function () {
                gotoLine(f.line);
              });
              li.appendChild(button);
            } else {
              li.appendChild(el("span", "con-line is-plain", "main.lua"));
            }
            li.appendChild(el("span", "con-code", f.code));
            li.appendChild(el("span", "con-msg", f.message));
            host.appendChild(li);
          })(S.findings[i]);
        }
      }

      function statRow(label, value, note) {
        var row = el("div", "con-row");
        row.appendChild(el("span", "con-label", label));
        var v = el("span", "con-value", value);
        if (note) v.appendChild(el("span", "con-subnote", note));
        row.appendChild(v);
        return row;
      }

      function drawStats(S) {
        var host = studio.$("console-stats");
        if (!host) return;
        var b = S.stats;
        host.innerHTML = "";
        if (b.collectionCycles == null) {
          host.appendChild(statRow("FRAME", "not measured",
            "the toy did not run a frame"));
          host.appendChild(statRow("CODE", b.codeBytes == null ? "not emitted" :
            thousands(b.codeBytes) + " B of C"));
          host.appendChild(statRow("ROM", "not estimated",
            "needs the IL to lower and the validator to run"));
          return;
        }
        host.appendChild(statRow("FRAME",
          thousands(b.collectionCycles) + " cycles",
          (100 * b.framePct).toFixed(2) + "% of " +
          thousands(b.frameClocks)));
        host.appendChild(statRow("PER LINE",
          b.rasterWorst ? thousands(b.rasterWorst) + " cycles worst" :
            "no raster() calls",
          "frame() " + thousands(b.frameCycles) + " · raster() mean " +
          thousands(Math.round(b.rasterMean))));
        host.appendChild(statRow("SPRITES",
          b.strips ? b.strips + " strip" + (b.strips === 1 ? "" : "s") +
            " on the worst line" : "none on any line",
          (b.strips ? "line " + b.stripLine + " · " : "") +
          "16 strips = 256 px is the limit"));
        host.appendChild(statRow("VRAM",
          thousands(b.vramWord) + " / " + thousands(b.vramLimit) + " words",
          "the highest word written"));
        host.appendChild(statRow("CODE",
          b.codeBytes == null ? "not emitted" :
            thousands(b.codeBytes) + " B of C",
          "pce-cgen.js, the browser's own emitter"));
        host.appendChild(statRow("ROM",
          thousands(b.romBytes) + " B / " + thousands(b.romLimit),
          (100 * b.romBytes / b.romLimit).toFixed(1) + "% · " +
          b.romBanks + " x 8 KiB banks (estimate)"));
      }

      /* The rig, and the last failure in the error line's own words (#107):
       * a person can copy one line back to the chat AI that wrote the code.
       * A toy that did not compile has no state, so this line draws without
       * one — that is exactly when it matters. */
      function drawRig(S, st) {
        var table = studio.$("console-table");
        if (!table) return;
        var count = 0;
        if (st && P.panels && P.panels.satTable) {
          var sat = P.panels.satTable(st);
          for (var i = 0; i < sat.length; i++) if (!sat[i].empty) count++;
        }
        var runtime = studio.render.runtime();
        var err = studio.render.lastError ? studio.render.lastError() : null;
        table.textContent =
          "PC Engine frame: " + thousands(FRAME_CLOCKS) +
          " CPU cycles (7.16 MHz, 60 Hz)\n" +
          "per-line trigger: RCR interrupt (no HDMA)\n" +
          "sprite entries in the SAT: " + count + "\n" +
          "runtime: " + (studio.toy.mode() === "il" ?
            "IL interpreter (#31)" : "Fengari Lua 5.3") + "\n" +
          "frames run this session: " + (runtime ? runtime.frameCount : 0) +
          "\ncompiler: IL -> C (pce-cgen), machine code is #31's next half\n" +
          "last error: " + (err ? err.code + ": " + err.message :
                                   "none this session");
      }

      /* #167 — the agent link's two blocks.  The RUN LOG is the toy's own
       * print() output from a toy_run the AGENT panel mirrored: the lines
       * are the tool core's reply, so they are what Claude was told.  The
       * CHECK block is the validator's report from a validate call (file,
       * line, code, message), the same findings the Export dialog reads. */
      function drawLog() {
        var host = studio.$("console-log");
        if (!host) return;
        if (!runLog.lines.length) { host.hidden = true; host.textContent = ""; return; }
        host.hidden = false;
        host.textContent = "RUN LOG · " + runLog.frames + " frame" +
          (runLog.frames === 1 ? "" : "s") + " through the agent link\n" +
          runLog.lines.join("\n");
      }

      function drawCheck() {
        var host = studio.$("console-check");
        if (!host) return;
        while (host.firstChild) host.removeChild(host.firstChild);
        if (!checkReport) { host.hidden = true; return; }
        host.hidden = false;
        var head = el("p", "con-check-head",
          "VALIDATE · from the agent link · " +
          (checkReport.ok ? "ok, no findings" : "not ok"));
        host.appendChild(head);
        var problems = checkReport.problems || [];
        if (!problems.length && checkReport.ok) {
          host.appendChild(el("p", "con-check-none",
            "The validator found nothing to fix."));
          return;
        }
        var list = el("ul", "con-check-list");
        for (var i = 0; i < problems.length; i++) {
          var p = problems[i];
          var li = el("li", "con-check-row is-" + (p.severity || "error"));
          li.appendChild(el("span", "con-line is-plain",
                             p.location || p.file || "main.lua"));
          li.appendChild(el("span", "con-code", p.code || ""));
          li.appendChild(el("span", "con-msg", String(p.message || "")));
          list.appendChild(li);
        }
        host.appendChild(list);
      }

      function draw(st) {
        var S = state();
        drawBanner(S);
        drawFindings(S);
        drawStats(S);
        drawRig(S, st);
        drawLog();
        drawCheck();
      }

      var api = {
        state: function () { return state(); },
        refresh: function () { cache.source = null; return state(); },
        goto: gotoLine,
        /* #167: the AGENT panel's mirror — toy_run's log and validate's
         * report, as the tool core answered them */
        setRunLog: function (lines, frames) {
          runLog = {
            lines: Array.isArray(lines) ? lines.slice() : [],
            frames: Number(frames) || 0,
            at: Date.now()
          };
          if (studio.panels && studio.panels.get) {
            var def = studio.panels.get("console");
            if (def && def.id === "console" && studio.$("panel-console") &&
                !studio.$("panel-console").hidden) draw(studio.render.state());
          }
          return runLog;
        },
        runLog: function () {
          return { lines: runLog.lines.slice(), frames: runLog.frames };
        },
        setCheck: function (report) {
          checkReport = report && typeof report === "object" ? report : null;
          if (studio.panels && studio.panels.get) {
            var def = studio.panels.get("console");
            if (def && def.id === "console" && studio.$("panel-console") &&
                !studio.$("panel-console").hidden) draw(studio.render.state());
          }
          return checkReport;
        },
        checkReport: function () { return checkReport; }
      };

      studio.panels.register({
        id: "console",
        label: "CONSOLE",
        group: "chip",
        chapter: "budgets",
        gloss: "Whether the toy runs on a real PC Engine: findings, frame " +
               "time, code and ROM size (#98).",
        draw: draw,
        api: api
      });
    }
  });
})(typeof self !== "undefined" ? self : this);
