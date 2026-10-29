/*
 * studio-panel-palettes.js — the PALETTES panel (card #26), a module of the
 * studio since #102.
 *
 * The VCE's 512 colours as 32 palettes of 16, decoded from the line's colour
 * table through pce-panels.js vcePalettes; entry 0 of a background palette is
 * the shared backdrop.  Each swatch's tooltip is its CRAM address and 9-bit
 * word.  The swatch cells are built once and repainted.  docs/STUDIO.md §3.
 */
(function (root) {
  "use strict";
  var P = root.PCEStudio = root.PCEStudio || {};
  P.studioPanelModules = P.studioPanelModules || [];

  P.studioPanelModules.push({
    id: "palettes",
    register: function (studio) {
      var cells = null;         /* [palette][entry] swatch elements */

      function draw(st) {
        if (!st || !P.panels) return;
        var vce = P.panels.vcePalettes(st, studio.render.panelLine(st));
        var host = studio.$("pal32");
        if (!cells) {
          cells = [];
          for (var p = 0; p < 32; p++) {
            var row = studio.document.createElement("div");
            row.className = "prow";
            var num = studio.document.createElement("span");
            num.className = "pnum";
            num.textContent = String(p);
            row.appendChild(num);
            var rowCells = [];
            for (var e = 0; e < 16; e++) {
              var sw = studio.document.createElement("span");
              sw.className = "psw" + (e === 0 && p < 16 ? " entry0" : "");
              row.appendChild(sw);
              rowCells.push(sw);
            }
            host.appendChild(row);
            cells.push(rowCells);
          }
        }
        for (var pal = 0; pal < 32; pal++) {
          for (var entry = 0; entry < 16; entry++) {
            var c = vce.palettes[pal][entry];
            var cell = cells[pal][entry];
            cell.style.background = "rgb(" + c.r + "," + c.g + "," + c.b + ")";
            cell.title = "palette " + pal + " entry " + entry + " · CRAM " +
              studio.hex(c.index, 3) + " · word " + studio.hex(c.word, 3);
          }
        }
      }

      studio.panels.register({
        id: "palettes",
        label: "PALETTES",
        group: "chip",
        chapter: "palettes",
        gloss: "The VCE's 512 colours as 32 palettes of 16 — the picture's only colours.",
        draw: draw
      });
    }
  });
})(typeof self !== "undefined" ? self : this);
