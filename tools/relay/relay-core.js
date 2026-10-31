"use strict";
/*
 * tools/relay/relay-core.js — the PCEStudio relay, card #165.
 *
 * The ppu.toys-style agent link, the relay half: a hosted MCP endpoint
 * (POST /mcp/<token>) plus one open studio tab as the agent's hands
 * (WebSocket /ws/<token>).  Claude Code speaks MCP JSON-RPC 2.0 to the
 * relay; the relay forwards each tools/call to the tab; the tab runs the
 * tool through the studio's own modules (#166/#167) and answers.  The
 * relay holds no toy state — code and art only pass through.
 *
 * This file is PLATFORM-NEUTRAL on purpose.  It knows nothing about
 * Cloudflare, Node's http, or browsers: the tab is an injected
 * {send(text), close()} socket, time is an injected clock, and
 * handleMcp() returns {status, json} for whatever HTTP layer wraps it
 * (tools/relay/worker.js in production, a node:http wrapper in
 * tests/check-relay.js).  No require('fs'), no process, no buffers.
 *
 * The wire protocol it speaks is the one docs/AGENT-LINK.md pins; the
 * message names and the two tools/call error texts are part of that
 * protocol, so they are constants here, not prose that can drift.
 *
 * CommonJS (module.exports), not ESM: worker.js bundles it with
 * wrangler, and `node --check` must be able to parse every file.
 */

var TOKEN_RE = /^[0-9a-f]{32}$/;

/* The limits docs/AGENT-LINK.md states.  handleMcp enforces them on the
 * body it is handed; the worker enforces the same numbers at its edge
 * (Content-Length before reading, Origin before upgrading). */
var DEFAULT_LIMITS = {
  messageLimitBytes: 8 * 1024 * 1024,  /* 8 MB per message, HTTP and WS */
  ratePerSecond: 20,                  /* MCP requests per second per token */
  rateCapacity: 20,                   /* the burst the bucket holds */
  callTimeoutMs: 120000,              /* a tools/call waits at most 2 min */
  forgetAfterMs: 24 * 3600 * 1000     /* a room with no tab is forgotten */
};

/* The exact texts the card pins for the two tools/call failures. */
var NO_TAB_TEXT =
  "Open https://pcestudio.terracides.com/renderer/studio.html, open the " +
  "AGENT panel and press Connect, then try again.";
var TIMEOUT_TEXT = "the studio tab did not answer";
var DISCONNECTED_TEXT = "the studio tab disconnected";

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id: id, result: result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id, error: { code: code, message: message } };
}

function defaultMakeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  /* platform without crypto.randomUUID: counter + time + random is enough
   * to make ids unique within one room's pending calls */
  defaultMakeId.n = (defaultMakeId.n || 0) + 1;
  return "call-" + Date.now() + "-" + defaultMakeId.n + "-" +
         Math.random().toString(16).slice(2, 10);
}

function Relay(opts) {
  opts = opts || {};

  this.tools = opts.tools || [];
  this.instructions = opts.instructions ||
    "PCEStudio's studio link. Every tools/call runs in the open studio " +
    "tab — the person watches what happens there. If a call answers " +
    "'open the studio tab', it is not connected: ask the person to open " +
    "it and press Connect, then try again.";
  this.serverInfo = opts.serverInfo || { name: "pcestudio", version: "0.1.0" };
  this.protocols = opts.protocols ||
    ["2025-06-18", "2025-03-26", "2024-11-05"];
  this.defaultProtocol = opts.defaultProtocol || "2025-06-18";

  this.now = opts.now || function () { return Date.now(); };
  this.callTimeoutMs = opts.callTimeoutMs === undefined
    ? DEFAULT_LIMITS.callTimeoutMs : opts.callTimeoutMs;
  this.messageLimitBytes = opts.messageLimitBytes === undefined
    ? DEFAULT_LIMITS.messageLimitBytes : opts.messageLimitBytes;
  this.ratePerSecond = opts.ratePerSecond === undefined
    ? DEFAULT_LIMITS.ratePerSecond : opts.ratePerSecond;
  this.rateCapacity = opts.rateCapacity === undefined
    ? Math.max(1, this.ratePerSecond) : opts.rateCapacity;
  this.forgetAfterMs = opts.forgetAfterMs === undefined
    ? DEFAULT_LIMITS.forgetAfterMs : opts.forgetAfterMs;

  this.noTabText = opts.noTabText === undefined ? NO_TAB_TEXT : opts.noTabText;
  this.timeoutText = opts.timeoutText === undefined
    ? TIMEOUT_TEXT : opts.timeoutText;
  this.disconnectedText = opts.disconnectedText === undefined
    ? DISCONNECTED_TEXT : opts.disconnectedText;
  this.makeId = opts.makeId || defaultMakeId;

  /* one room per token: { tab, calls, bucket, lastActive }.  Memory
   * only — nothing here is ever persisted, and a room with no tab that
   * has not been seen for forgetAfterMs is dropped whole. */
  this.rooms = new Map();

  this.toolByName = {};
  for (var i = 0; i < this.tools.length; i++) {
    this.toolByName[this.tools[i].name] = true;
  }
}

Relay.TOKEN_RE = TOKEN_RE;
Relay.DEFAULT_LIMITS = DEFAULT_LIMITS;
Relay.NO_TAB_TEXT = NO_TAB_TEXT;
Relay.TIMEOUT_TEXT = TIMEOUT_TEXT;

function http(status, json) {
  return { status: status, json: json };
}

Relay.prototype.room = function (token) {
  var now = this.now();
  var room = this.rooms.get(token);
  if (room && !room.tab && now - room.lastActive >= this.forgetAfterMs) {
    /* a token nobody has talked to for a day is forgotten: its rate
     * bucket, its hello and any pending call state go with it */
    this.rooms.delete(token);
    room = null;
  }
  if (!room) {
    room = {
      token: token,
      tab: null,          /* { socket, attachedAt } while a tab is wired */
      calls: new Map(),   /* pending call id -> { timer, resolve } */
      hello: null,        /* the tab's { version, title } — memory only */
      lastActive: now,
      bucket: { tokens: this.rateCapacity, last: now }
    };
    this.rooms.set(token, room);
  }
  return room;
};

/* One MCP request costs one bucket token; the bucket refills at
 * ratePerSecond per second and holds at most rateCapacity.  Returns
 * false when the request must be refused with 429. */
Relay.prototype.consume = function (room) {
  var now = this.now();
  var b = room.bucket;
  b.tokens = Math.min(this.rateCapacity,
                      b.tokens + (now - b.last) * this.ratePerSecond / 1000);
  b.last = now;
  room.lastActive = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
};

/* Fail every pending call of a room (the tab was taken over, closed, or
 * its socket stopped sending) and clear the timers. */
Relay.prototype.failCalls = function (room, text) {
  room.calls.forEach(function (pending) {
    clearTimeout(pending.timer);
    pending.resolve({
      content: [{ type: "text", text: text }],
      isError: true
    });
  });
  room.calls.clear();
};

/* ---- the tab side ------------------------------------------------------ */

Relay.prototype.attachTab = function (token, socket) {
  if (!TOKEN_RE.test(token)) {
    throw new Error("bad token " + JSON.stringify(token));
  }
  var room = this.room(token);
  if (room.tab && room.tab.socket !== socket) {
    /* another tab connected with the same token: the older one is told
     * and closed, its in-flight calls fail immediately */
    try { room.tab.socket.send(JSON.stringify({ type: "taken" })); } catch (e) {}
    try { room.tab.socket.close(); } catch (e) {}
    this.failCalls(room, this.disconnectedText);
  }
  room.tab = { socket: socket, attachedAt: this.now() };
  room.lastActive = this.now();
};

Relay.prototype.onTabMessage = function (token, text) {
  var room = this.rooms.get(token);
  if (!room || !room.tab) return;  /* nothing to answer on */

  if (typeof text !== "string" || text.length > this.messageLimitBytes) {
    try { room.tab.socket.close(); } catch (e) {}
    return;
  }
  var msg;
  try { msg = JSON.parse(text); } catch (e) {
    try { room.tab.socket.close(); } catch (e) {}
    return;
  }
  if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;
  room.lastActive = this.now();

  switch (msg.type) {
  case "hello":
    /* version/title are recorded in memory only (shown nowhere yet);
     * the relay does not refuse a version it does not know */
    room.hello = { version: msg.version, title: msg.title };
    break;
  case "ping":
    try {
      room.tab.socket.send(JSON.stringify({ type: "pong" }));
    } catch (e) { this.detachTab(token); }
    break;
  case "result": {
    var pending = room.calls.get(String(msg.id));
    if (!pending) break;  /* a result for a call we no longer hold */
    clearTimeout(pending.timer);
    room.calls.delete(String(msg.id));
    pending.resolve(msg.result && typeof msg.result === "object"
      ? msg.result : { content: [], isError: false });
    break;
  }
  case "error": {
    var failed = room.calls.get(String(msg.id));
    if (!failed) break;
    clearTimeout(failed.timer);
    room.calls.delete(String(msg.id));
    failed.resolve({
      content: [{
        type: "text",
        text: typeof msg.message === "string" ? msg.message : ""
      }],
      isError: true
    });
    break;
  }
  default:
    break;  /* unknown types are ignored, not refused */
  }
};

Relay.prototype.detachTab = function (token) {
  var room = this.rooms.get(token);
  if (!room || !room.tab) return;
  this.failCalls(room, this.disconnectedText);
  room.tab = null;
  room.lastActive = this.now();
};

/* ---- the MCP side ------------------------------------------------------ */

Relay.prototype.initialise = function (params) {
  var asked = params && params.protocolVersion;
  var version = this.protocols.indexOf(asked) >= 0
    ? asked : this.defaultProtocol;
  return {
    protocolVersion: version,
    capabilities: { tools: {} },
    serverInfo: this.serverInfo,
    instructions: this.instructions
  };
};

/* One tools/call, dispatched to the tab.  Resolves to the MCP tool
 * result object (content + isError), never to a JSON-RPC error; the
 * name checks live in answer() so they answer as JSON-RPC errors,
 * exactly as tools/mcp/server.js does. */
Relay.prototype.callTool = function (room, token, params) {
  var name = params.name;
  if (!room.tab) {
    /* no tab connected: the card's exact text, answered at once */
    return Promise.resolve({
      content: [{ type: "text", text: this.noTabText }],
      isError: true
    });
  }

  var relay = this;
  var id = this.makeId();
  return new Promise(function (resolve) {
    var timer = setTimeout(function () {
      if (!room.calls.has(id)) return;
      room.calls.delete(id);
      resolve({
        content: [{ type: "text", text: relay.timeoutText }],
        isError: true
      });
    }, relay.callTimeoutMs);
    if (timer.unref) timer.unref();
    room.calls.set(id, { timer: timer, resolve: resolve });

    var sent = false;
    try {
      room.tab.socket.send(JSON.stringify({
        type: "call",
        id: id,
        name: name,
        arguments: params.arguments || {}
      }));
      sent = true;
    } catch (e) {}
    if (!sent) {
      clearTimeout(timer);
      room.calls.delete(id);
      relay.detachTab(token);
      resolve({
        content: [{ type: "text", text: relay.disconnectedText }],
        isError: true
      });
    }
  });
};

/* One JSON-RPC message -> its reply object, or null for a notification.
 * Mirrors tools/mcp/server.js's answer() over HTTP instead of stdio. */
Relay.prototype.answer = async function (room, token, msg) {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
    return rpcError(null, -32600,
                    "invalid request: expected one JSON-RPC object");
  }
  var hasId = Object.prototype.hasOwnProperty.call(msg, "id");
  var id = hasId ? msg.id : null;
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return hasId ? rpcError(id, -32600, "invalid request") : null;
  }
  var params = msg.params || {};

  /* notifications (no id) are never answered — initialized included */
  if (!hasId) return null;

  switch (msg.method) {
  case "initialize":
    return rpcResult(id, this.initialise(params));
  case "ping":
    return rpcResult(id, {});
  case "tools/list":
    return rpcResult(id, { tools: this.tools });
  case "tools/call":
    if (typeof params.name !== "string") {
      return rpcError(id, -32602, "tools/call needs a tool name");
    }
    if (!this.toolByName[params.name]) {
      return rpcError(id, -32602,
                      "unknown tool " + JSON.stringify(params.name));
    }
    return rpcResult(id, await this.callTool(room, token, params));
  default:
    return rpcError(id, -32601, "method not found: " + msg.method);
  }
};

/* The whole HTTP surface: POST /mcp/<token> with the raw body text.
 * Resolves to {status, json} — json is the body to send back, null for
 * an empty 202.  Statuses: 404 bad token, 429 over the rate limit, 413
 * body over 8 MB, 400 unparseable JSON, 202 notifications, 200 replies
 * (JSON-RPC errors included). */
Relay.prototype.handleMcp = async function (token, bodyText) {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) {
    return http(404, {
      error: "bad-token",
      message: "the token in the path is not 32 hex characters"
    });
  }
  var room = this.room(token);
  if (!this.consume(room)) {
    return http(429, {
      error: "rate-limit",
      message: "more than " + this.ratePerSecond + " requests per second"
    });
  }
  var text = typeof bodyText === "string" ? bodyText : "";
  if (text.length > this.messageLimitBytes) {
    return http(413, {
      error: "oversize",
      message: "the body is larger than " + this.messageLimitBytes + " bytes"
    });
  }

  var msg;
  try {
    msg = JSON.parse(text);
  } catch (e) {
    return http(400, rpcError(null, -32700, "parse error"));
  }

  if (Array.isArray(msg)) {
    if (!msg.length) {
      return http(200, rpcError(null, -32600, "empty batch"));
    }
    var replies = [];
    for (var i = 0; i < msg.length; i++) {
      var reply = await this.answer(room, token, msg[i]);
      if (reply) replies.push(reply);
    }
    if (!replies.length) return http(202, null);
    return http(200, replies);
  }
  var one = await this.answer(room, token, msg);
  if (!one) return http(202, null);
  return http(200, one);
};

module.exports = {
  Relay: Relay,
  TOKEN_RE: TOKEN_RE,
  DEFAULT_LIMITS: DEFAULT_LIMITS,
  NO_TAB_TEXT: NO_TAB_TEXT,
  TIMEOUT_TEXT: TIMEOUT_TEXT,
  DISCONNECTED_TEXT: DISCONNECTED_TEXT
};
