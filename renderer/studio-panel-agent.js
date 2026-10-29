/*
 * studio-panel-agent.js — the AGENT drawer (the honest state of #24), a module
 * of the studio since #102.
 *
 * The agent link is card #24: a coding agent will drive this studio over MCP.
 * Until then the drawer is the static "NOT CONNECTED" note in the layout, so
 * this module registers the drawer's Panels-menu entry and the way it is
 * opened and draws nothing.  The page's own layout helper shows the drawer.
 */
(function (root) {
  "use strict";
  var P = root.PCEStudio = root.PCEStudio || {};
  P.studioPanelModules = P.studioPanelModules || [];

  P.studioPanelModules.push({
    id: "agent",
    register: function (studio) {
      studio.panels.register({
        id: "agent",
        label: "Agent",
        group: "workspace",
        open: function () { studio.layout.drawer("agent"); }
      });
    }
  });
})(typeof self !== "undefined" ? self : this);
