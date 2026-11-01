/*
 * relay-config.js — the one constant that points the studio at the relay
 * (#167).
 *
 * The agent link is a hosted MCP endpoint plus the open studio tab as the
 * agent's hands (docs/AGENT-LINK.md, #165).  The relay's deployment is the
 * person's — tools/relay/README.md says how to deploy it — so the studio
 * cannot know its URL at build time.  This file is the whole configuration:
 *
 *   RELAY_URL   the relay's base URL, no trailing slash, e.g.
 *               "https://pcestudio-relay.example.workers.dev"
 *
 * Set it to the worker's URL and the AGENT panel offers Connect; leave it
 * empty and the panel says the agent link is not switched on yet and offers
 * nothing else — a button that cannot work is worse than no button.
 *
 * The panel builds the two URLs the protocol names from it:
 *
 *   claude mcp add --transport http pcestudio <RELAY_URL>/mcp/<token>
 *   wss://<relay>/ws/<token>        (http:// becomes ws:// for local dev)
 */
(function (root) {
  "use strict";
  root.PCEStudio = root.PCEStudio || {};

  root.PCEStudio.RELAY_URL = "https://pcestudio-relay.pcestudio.workers.dev";
})(typeof self !== "undefined" ? self : this);
