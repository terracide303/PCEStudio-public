/*
 * studio-panel-agent.js — the AGENT drawer (the honest state of #24), a module
 * of the studio since #102.
 *
 * The agent link is card #36: tools/mcp/server.js, a local MCP server over
 * stdio that wraps the same tested modules this page runs. The drawer's text
 * and its Sign-in placeholder follow ppu.toys' `.agent-panel` before an agent
 * connects (#87); the live link into this tab is #104 and accounts are #37,
 * so the Sign-in button says what it is instead of inventing an account.
 */
(function (root) {
  "use strict";
  var P = root.PCEStudio = root.PCEStudio || {};
  P.studioPanelModules = P.studioPanelModules || [];

  P.studioPanelModules.push({
    id: "agent",
    register: function (studio) {
      /* #87: the placeholder must not pretend to sign in. It names what is
       * really there — the local MCP server — and what is not yet (#37). */
      if (studio.$("btn-agent-signin"))
        studio.$("btn-agent-signin").addEventListener("click", function () {
          studio.toast("Sign in is a placeholder: accounts and publishing are " +
                       "card #37. The MCP server (tools/mcp/server.js, #36) " +
                       "runs locally and needs no account.");
        });

      studio.panels.register({
        id: "agent",
        label: "Agent",
        group: "workspace",
        open: function () { studio.layout.drawer("agent"); }
      });
    }
  });
})(typeof self !== "undefined" ? self : this);
