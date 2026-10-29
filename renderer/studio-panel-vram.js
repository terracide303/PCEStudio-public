/*
 * studio-panel-vram.js — the VRAM panel (card #26), a module of the studio
 * since #102.
 *
 * Every studio panel is its own file: it pushes one module with a
 * register(studio) here, and studio.html only loads it.  register() adds the
 * panel to the studio's Panels registry (its tab, its Panels-menu entry, its
 * Guide chapter and its draw function); the page never names the panel.
 *
 * VRAM is all 32768 words as a map: the BAT, the tile and sprite-pattern copy
 * regions, the SAT at $7F00 and what is free (renderer/pce-panels.js vramMap
 * over the same state the renderer is given).  docs/STUDIO.md §3/§6.1.
 */
(function (root) {
  "use strict";
  var P = root.PCEStudio = root.PCEStudio || {};
  P.studioPanelModules = P.studioPanelModules || [];

  P.studioPanelModules.push({
    id: "vram",
    register: function (studio) {
      studio.panels.register({
        id: "vram",
        label: "VRAM",
        group: "chip",
        chapter: "the-toy",
        gloss: "All 32768 words: the BAT, tiles, sprite patterns and the SAT.",
        draw: function (st) {
          if (!st || !P.panels) return;
          var map = P.panels.vramMap(st);
          var canvas = studio.$("vrammap");
          var c = canvas.getContext("2d");
          var w = canvas.width || 512, h = canvas.height || 44;
          c.fillStyle = "#08090c"; c.fillRect(0, 0, w, h);
          var colour = function (kind) {
            return kind.indexOf("sprite patterns") === 0 ? "#c08040" :
              kind === "BAT" ? "#3f8f6f" :
              kind === "tiles" ? "#4f6fd0" :
              kind === "SAT" ? "#b05090" : "#3a3f49";
          };
          for (var i = 0; i < map.segments.length; i++) {
            var seg = map.segments[i];
            var x0 = Math.floor(seg.start * w / 32768);
            var x1 = Math.max(x0 + 1,
                             Math.floor((seg.start + seg.words) * w / 32768));
            c.fillStyle = colour(seg.kind);
            c.fillRect(x0, 0, x1 - x0, h);
          }
          var out = "whole VRAM, 0..32767 words\n";
          for (var j = 0; j < map.segments.length; j++) {
            var s = map.segments[j];
            out += s.kind.padEnd(16).slice(0, 16) + " " +
              String(s.start).padStart(5) + ".." +
              String(s.start + s.words - 1).padStart(5) + "  (" + s.words + ")\n";
          }
          var free = map.free.reduce(function (a, b) { return a + b.words; }, 0);
          out += "free: " + free + " of 32768 words";
          studio.$("vram-legend").textContent = out;
        }
      });
    }
  });
})(typeof self !== "undefined" ? self : this);
