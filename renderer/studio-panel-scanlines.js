/*
 * studio-panel-scanlines.js — the SCANLINES panel (card #26), a module of the
 * studio since #102.
 *
 * One row per VDW line: the BXR/BYR/CR that line used, whether the raster
 * table writes it, and the RCR the chain arms after it (pce-panels.js
 * registerLines).  A PCE line is an RCR interrupt, not HDMA.  docs/STUDIO.md
 * §3.
 */
(function (root) {
  "use strict";
  var P = root.PCEStudio = root.PCEStudio || {};
  P.studioPanelModules = P.studioPanelModules || [];

  P.studioPanelModules.push({
    id: "scanlines",
    register: function (studio) {
      studio.panels.register({
        id: "scanlines",
        label: "SCANLINES",
        group: "chip",
        chapter: "raster",
        gloss: "Per-line BXR/BYR/CR from the raster table — the RCR interrupt, not HDMA.",
        draw: function (st) {
          if (!st || !P.panels) return;
          var lines = P.panels.registerLines(st);
          var out = "  line  BXR  BYR  CR  entry RCR\n";
          for (var i = 0; i < lines.length; i++) {
            var l = lines[i];
            out += (l.entryAtLine ? "*" : " ") + String(l.line).padStart(5) +
              " " + String(l.BXR).padStart(4) + " " +
              String(l.BYR).padStart(4) + " " +
              studio.hex(l.CR, 2).padStart(4) + "  " +
              (l.entryAtLine ? "yes " : "  . ") +
              (l.rcr == null ? "  -  " : studio.hex(l.rcr, 4)) + "\n";
          }
          studio.$("scan-table").textContent = out;
        }
      });
    }
  });
})(typeof self !== "undefined" ? self : this);
