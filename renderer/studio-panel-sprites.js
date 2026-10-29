/*
 * studio-panel-sprites.js — the SPRITES panel (card #26), a module of the
 * studio since #102.
 *
 * The 64-entry SAT as a table: Y, X, pattern, palette, size, the SPBG/flip
 * flags and the 64-word cells, from pce-panels.js satTable over the frame's
 * own state.  docs/STUDIO.md §3.
 */
(function (root) {
  "use strict";
  var P = root.PCEStudio = root.PCEStudio || {};
  P.studioPanelModules = P.studioPanelModules || [];

  P.studioPanelModules.push({
    id: "sprites",
    register: function (studio) {
      studio.panels.register({
        id: "sprites",
        label: "SPRITES",
        group: "chip",
        chapter: "sprites",
        gloss: "The 64-entry SAT: position, pattern, palette, size and flags.",
        draw: function (st) {
          if (!st || !P.panels) return;
          var sat = P.panels.satTable(st);
          var out = " #    Y    X  pattern pal size   flags cells\n";
          for (var i = 0; i < sat.length; i++) {
            var s = sat[i];
            if (s.empty) {
              out += String(s.number).padStart(2) + "   (empty)\n";
              continue;
            }
            var flags = (s.spbg ? "P" : "-") + (s.hflip ? "H" : "-") +
                        (s.vflip ? "V" : "-") + (s.cgx ? "X" : "-");
            out += String(s.number).padStart(2) + " " +
              String(s.y).padStart(4) + " " + String(s.x).padStart(4) + " " +
              studio.hex(s.pattern, 3).padStart(6) + " " +
              String(s.palette).padStart(3) + "  " + s.width + "x" + s.height +
              "  " + flags + "   " + s.cells.join(",") + "\n";
          }
          studio.$("sat-table").textContent = out;
        }
      });
    }
  });
})(typeof self !== "undefined" ? self : this);
