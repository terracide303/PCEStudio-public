/*
 * studio-panel-audio.js — the AUDIO panel (the honest state of #71), a module
 * of the studio since #102.
 *
 * There is nothing to draw: the PSG is modelled in renderer/pce-psg.js and
 * checked by tests/check-psg.js, but toys have no sound surface until #71, so
 * the panel is the static note in the layout and this module only adds the
 * tab, its Panels-menu entry and its Guide chapter.  A draw function is
 * deliberately absent: the page's refresh calls nothing for a panel with no
 * draw, so the panel cannot paint a state it does not have.
 */
(function (root) {
  "use strict";
  var P = root.PCEStudio = root.PCEStudio || {};
  P.studioPanelModules = P.studioPanelModules || [];

  P.studioPanelModules.push({
    id: "audio",
    register: function (studio) {
      studio.panels.register({
        id: "audio",
        label: "AUDIO",
        group: "chip",
        chapter: "sound",
        gloss: "The PSG is its own card (#71); toys have no sound surface yet."
      });
    }
  });
})(typeof self !== "undefined" ? self : this);
