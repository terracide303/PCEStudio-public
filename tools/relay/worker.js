"use strict";
/*
 * tools/relay/worker.js — the relay as a Cloudflare Worker, card #165.
 *
 *   POST /mcp/<token>   MCP JSON-RPC 2.0 over streamable HTTP (Claude
 *                       Code's side: `claude mcp add --transport http
 *                       pcestudio https://<relay>/mcp/<token>`)
 *   GET  /ws/<token>    the studio tab's side (upgrade to WebSocket;
 *                       Origin must be the studio site or a localhost
 *                       development server)
 *
 * Each token routes to its own Durable Object `Room` (env.ROOM,
 * idFromName(token)) so the per-token rate limit, the pending calls and
 * the tab's socket all live in one place.  The Room uses the WebSocket
 * Hibernation API: the tab's socket stays connected while the DO
 * sleeps for free, and the DO wakes on the tab's 25 s ping or on any
 * MCP request.  Hibernation discards in-memory state, so the relay
 * itself (tools/relay/relay-core.js) is re-created per wake, and the
 * connection's identity + token ride on the WebSocket attachment
 * (serializeAttachment), which survives hibernation — nothing is ever
 * written to DO storage.  The relay stores NOTHING (docs/AGENT-LINK.md).
 *
 * Deliberately CommonJS (module.exports), not ESM: the repository has
 * no package.json by design, so `node --check` must be able to parse
 * this file, and wrangler bundles CommonJS module workers fine.
 * tests/check-relay.js requires this file for its structural checks
 * (routePath, originAllowed) — nothing here touches the network at
 * require time.
 */
const { Relay, DEFAULT_LIMITS, NO_TAB_TEXT } = require("./relay-core.js");
const TOOLS = require("./tools.json");

const SERVER_INFO = { name: "pcestudio", version: "0.1.0" };

const INSTRUCTIONS =
  "PCEStudio's studio link. Write a toy with toy_write, add art with " +
  "source_add (a PNG or pixel grid becomes tiles, sprites, a tilesheet " +
  "or a palette; a .mid becomes song.json), compose music with " +
  "song_write, run it with toy_run, look with frame_png, read or poke " +
  "registers with registers_get/register_set, check it with validate, " +
  "save the whole toy for the studio with toy_save, export a .pce with " +
  "export_pce, and read the toy language with docs. Every call runs in " +
  "the open studio tab (https://pcestudio.terracides.com/renderer/" +
  "studio.html — the person opens the AGENT panel and presses Connect), " +
  "and the person sees what you do there. If a call answers '" +
  NO_TAB_TEXT + "', the tab is not connected: ask the person to open " +
  "it, then try again. Every tool wraps the same modules the studio " +
  "and the tests use; there is no second model.";

/* ---- routing and the Origin rule ---------------------------------------- *
 * The card's rule: the WebSocket upgrade is only for the studio site or
 * a localhost development server.  The Origin header is what a browser
 * always sends on an upgrade; a client without one (curl, wscat) is
 * refused unless it sends one matching the list. */

function originAllowed(origin) {
  if (typeof origin !== "string" || origin === "null") return false;
  if (origin === "https://pcestudio.terracides.com") return true;
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
}

/* /mcp/<token> or /ws/<token> where the token is exactly 32 hex
 * characters; anything else — a bad token included — is a 404, so a
 * garbage path never creates a Durable Object. */
function routePath(pathname) {
  const m = /^\/(mcp|ws)\/([0-9a-f]{32})$/.exec(pathname);
  if (!m) return { error: 404 };
  return { kind: m[1], token: m[2] };
}

function jsonResponse(status, body, extraHeaders) {
  const headers = { "content-type": "application/json" };
  if (extraHeaders) Object.assign(headers, extraHeaders);
  return new Response(JSON.stringify(body), { status: status, headers: headers });
}

/* The tab, as relay-core wants it: an injected {send, close}.  The
 * socket wrapper closes over the WebSocket the upgrade accepted. */
function tabSocket(ws) {
  return {
    send: function (text) { ws.send(text); },
    close: function () { ws.close(1000, "relay closed"); }
  };
}

/* ---- the Durable Object: one Room per token ----------------------------- */

class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.relayInstance = null;
    /* the id of the connection currently attached to the relay.  Both
     * are set together in upgrade() and lost together on hibernation,
     * so they never disagree: after a wake, tabWsId is null exactly
     * when the relay holds no tab. */
    this.tabWsId = null;
  }

  relay() {
    if (!this.relayInstance) {
      this.relayInstance = new Relay({
        tools: TOOLS,
        instructions: INSTRUCTIONS,
        serverInfo: SERVER_INFO
      });
    }
    return this.relayInstance;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const route = routePath(url.pathname);
    if (route.error) return jsonResponse(404, { error: "not-found" });

    if (route.kind === "ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return jsonResponse(426, {
          error: "not-a-websocket",
          message: "this endpoint upgrades to WebSocket only"
        });
      }
      /* the worker already checked the Origin; keep the rule here too
       * so the DO can never be reached with a foreign origin */
      if (!originAllowed(request.headers.get("Origin"))) {
        return jsonResponse(403, {
          error: "bad-origin",
          message: "the Origin is not the studio site or a localhost " +
                   "development server"
        });
      }
      return this.upgrade(request, route.token);
    }

    if (request.method !== "POST") {
      return jsonResponse(405, {
        error: "method-not-allowed",
        message: "POST only"
      }, { allow: "POST" });
    }

    /* refuse an oversize body before reading it (Content-Length), then
     * let the core re-check the real size on the text itself */
    const length = Number(request.headers.get("Content-Length") || 0);
    if (length > DEFAULT_LIMITS.messageLimitBytes) {
      return jsonResponse(413, {
        error: "oversize",
        message: "the body is larger than " +
                 DEFAULT_LIMITS.messageLimitBytes + " bytes"
      });
    }
    const body = await request.text();
    const out = await this.relay().handleMcp(route.token, body);
    const headers = {};
    if (out.status === 429) headers["retry-after"] = "1";
    if (out.json === null || out.json === undefined) {
      /* a 202 (notification): an empty body, not a JSON payload */
      return new Response(null, { status: out.status, headers: headers });
    }
    return jsonResponse(out.status, out.json, headers);
  }

  upgrade(request, token) {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    /* Hibernation API: the connection outlives the DO's memory.  The
     * attachment carries the connection id and the token across the
     * sleep — webSocketMessage reads it back to know WHICH connection
     * spoke and which token it belongs to.  No DO storage is written;
     * the relay stores nothing. */
    this.state.acceptWebSocket(server);
    const id = crypto.randomUUID();
    server.serializeAttachment({ id: id, token: token });
    this.tabWsId = id;
    this.relay().attachTab(token, tabSocket(server));
    return new Response(null, { status: 101, webSocket: client });
  }

  /* Wakes on every message the tab sends (its 25 s ping included).  If
   * the relay lost its tab to hibernation, this message re-attaches it
   * (the socket wrapper is rebuilt around the ws the wake delivers).
   * A message from any OTHER connection — the stale tab a takeover
   * closed before hibernation — is told and closed. */
  async webSocketMessage(ws, message) {
    const attachment =
      (ws.deserializeAttachment && ws.deserializeAttachment()) || {};
    if (this.tabWsId !== null && attachment.id !== this.tabWsId) {
      try { ws.send(JSON.stringify({ type: "taken" })); } catch (e) {}
      try { ws.close(4001, "taken"); } catch (e) {}
      return;
    }
    const relay = this.relay();
    if (this.tabWsId === null) {
      this.tabWsId = attachment.id || crypto.randomUUID();
      if (!attachment.id && ws.serializeAttachment) {
        ws.serializeAttachment({ id: this.tabWsId, token: attachment.token });
      }
      relay.attachTab(attachment.token, tabSocket(ws));
    }
    relay.onTabMessage(attachment.token, message);
  }

  async webSocketClose(ws) {
    const attachment =
      (ws.deserializeAttachment && ws.deserializeAttachment()) || {};
    if (attachment.id && attachment.id === this.tabWsId) {
      this.relay().detachTab(attachment.token);
      this.tabWsId = null;
    }
  }

  async webSocketError(ws) {
    this.webSocketClose(ws);
  }
}

/* ---- the worker: route to the right Room -------------------------------- */

module.exports = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const route = routePath(url.pathname);
    if (route.error) return jsonResponse(404, { error: "not-found" });

    if (route.kind === "ws") {
      /* the tab side: origin-checked at the edge, then the upgrade
       * itself runs inside the Room (acceptWebSocket lives there) */
      if (request.headers.get("Upgrade") !== "websocket") {
        return jsonResponse(426, {
          error: "not-a-websocket",
          message: "this endpoint upgrades to WebSocket only"
        });
      }
      if (!originAllowed(request.headers.get("Origin"))) {
        return jsonResponse(403, {
          error: "bad-origin",
          message: "the Origin is not the studio site or a localhost " +
                   "development server"
        });
      }
      return env.ROOM.get(env.ROOM.idFromName(route.token)).fetch(request);
    }

    if (request.method !== "POST") {
      return jsonResponse(405, {
        error: "method-not-allowed",
        message: "POST only"
      }, { allow: "POST" });
    }
    return env.ROOM.get(env.ROOM.idFromName(route.token)).fetch(request);
  },

  Room: Room,
  routePath: routePath,
  originAllowed: originAllowed
};
