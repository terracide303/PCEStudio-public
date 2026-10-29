/*
 * studio-panel-registers.js — the REGISTERS panel (card #26), a module of the
 * studio since #102.
 *
 * All 20 VDC registers (R00-R13) for the followed line, each with the source
 * that supplied it (the picture, the viewer's fixed sequence, or null for the
 * addresses and DMA registers a picture does not carry), plus the SR
 * conditions — pce-panels.js vdcRegisters/status.  docs/STUDIO.md §3.
 */
(function (root) {
  "use strict";
  var P = root.PCEStudio = root.PCEStudio || {};
  P.studioPanelModules = P.studioPanelModules || [];

  P.studioPanelModules.push({
    id: "registers",
    register: function (studio) {
      studio.panels.register({
        id: "registers",
        label: "REGISTERS",
        group: "chip",
        chapter: "registers",
        gloss: "The VDC's R00–R13 for one line, with where each value came from.",
        draw: function (st) {
          if (!st || !P.panels) return;
          var row = studio.render.panelLine(st);
          var v = P.panels.lineValues(st, row);
          var regs = P.panels.vdcRegisters(st, row);
          var out = "VDW line " + v.line + " · BXR " + v.BXR + " · BYR " +
            v.BYR + " · CR " + studio.hex(v.CR, 2) + "\n\n";
          out += " #  name     value   source\n";
          for (var i = 0; i < regs.length; i++) {
            var r = regs[i];
            out += "R" + r.number.toString(16).toUpperCase().padStart(2, "0") +
              "  " + r.name.padEnd(8) + " " +
              (r.value == null ? "-" : studio.hex(r.value, 4)).padStart(7) +
              "  " + (r.source || "-") + "\n";
          }
          var s = P.panels.status(st);
          out += "\nstatus (VDC SR): OR " + s.orLines.length + " · CC " +
            s.ccLines.length + " · RR " + s.rrLines.length + " · SR " +
            studio.hex(s.sr, 2);
          studio.$("reg-table").textContent = out;
        }
      });
    }
  });
})(typeof self !== "undefined" ? self : this);
