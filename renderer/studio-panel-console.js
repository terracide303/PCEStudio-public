/*
 * studio-panel-console.js — the CONSOLE panel (card #26), a module of the
 * studio since #102.
 *
 * The PC Engine's frame budget, the RCR-not-HDMA line mechanism, the SAT
 * count, the runtime in use and where the compiler stands (#31).  It reads
 * the studio's current mode and runtime through the API, so it cannot claim a
 * runtime the page is not running.  docs/STUDIO.md §3.
 */
(function (root) {
  "use strict";
  var P = root.PCEStudio = root.PCEStudio || {};
  P.studioPanelModules = P.studioPanelModules || [];

  P.studioPanelModules.push({
    id: "console",
    register: function (studio) {
      studio.panels.register({
        id: "console",
        label: "CONSOLE",
        group: "chip",
        chapter: "budgets",
        gloss: "The PC Engine's frame budget and where the compiler stands (#31).",
        draw: function (st) {
          if (!P.panels) return;
          var count = 0;
          if (st) {
            var sat = P.panels.satTable(st);
            for (var i = 0; i < sat.length; i++) if (!sat[i].empty) count++;
          }
          var runtime = studio.render.runtime();
          /* #107: the last failure in the error line's own words, so a person
           * can copy one line back to the chat AI that wrote the code. A toy
           * that did not compile has no state, so this line draws without
           * one — that is exactly when it matters. */
          var err = studio.render.lastError ? studio.render.lastError() : null;
          studio.$("console-table").textContent =
            "PC Engine frame: 119904 CPU cycles (7.16 MHz, 60 Hz)\n" +
            "per-line trigger: RCR interrupt (no HDMA)\n" +
            "sprite entries in the SAT: " + count + "\n" +
            "runtime: " + (studio.toy.mode() === "il" ?
              "IL interpreter (#31)" : "Fengari Lua 5.3") + "\n" +
            "frames run this session: " + (runtime ? runtime.frameCount : 0) +
            "\ncompiler: IL only — machine code is #31's next half\n" +
            "export: second half of #75\n" +
            "last error: " + (err ? err.code + ": " + err.message :
                                     "none this session");
        }
      });
    }
  });
})(typeof self !== "undefined" ? self : this);
