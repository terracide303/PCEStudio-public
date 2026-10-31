#!/usr/bin/env node
/*
 * tests/check-relay.js — the #165 evidence: the relay (tools/relay/)
 * spoken to exactly as Claude Code and the studio tab will speak it.
 *
 * What it asserts:
 *
 *   1. relay-core's handleMcp over a REAL node:http wrapper (an http
 *      server on an ephemeral port, POST /mcp/<token>): initialize
 *      echoes the protocol version it knows and answers the default
 *      for one it does not, with capabilities.tools, serverInfo and
 *      instructions text; notifications/initialized is a 202 with an
 *      empty body; ping answers {}; tools/list is byte-equal to the
 *      embedded tools/relay/tools.json — the exact list the worker
 *      serves.
 *   2. tools/call round-trips to a fake tab: attachTab wires a fake
 *      {send, close} socket; the call is delivered as
 *      {"type":"call","id","name","arguments"}; the tab's
 *      {"type":"result"} comes back as the MCP result verbatim, and
 *      its {"type":"error"} as an isError result carrying the message.
 *      The tab's hello is accepted, ping is answered with pong, an
 *      unknown message type is ignored, and a result for an id the
 *      relay no longer holds is dropped without a crash.
 *   3. The two failures the card pins, with their exact texts: a call
 *      with NO tab connected answers the "Open https://pcestudio…"
 *      text at once; a call the tab never answers times out (with a
 *      short injected timeout, standing in for the 120 s default) with
 *      "the studio tab did not answer".  A tab that closes or is taken
 *      over mid-call fails its pending calls with the disconnected
 *      text.
 *   4. A second tab on the same token takes over: the older one is
 *      sent {"type":"taken"} and closed, and calls go to the new one.
 *      A second TOKEN cannot see the first's calls: the first tab's
 *      call is delivered to it and to nobody else, a result sent by
 *      the other tab does not answer it, and a fresh token with no tab
 *      gets the no-tab error.
 *   5. The limits: a token that is not 32 hex is a 404 (both at the
 *      core and through the HTTP route); a body over the injected
 *      message limit is a 413; the 21st request inside one second is a
 *      429 and the next second is allowed again; a room with no tab
 *      that has not been seen for the forget window is forgotten whole
 *      — its rate bucket resets to full.
 *   6. JSON-RPC edges: a parse error is 400/-32700, a non-object body
 *      is -32600, an unknown method is -32601, an unknown tool or a
 *      tools/call without a name is -32602, a batch answers as one
 *      array, an empty batch is -32600.
 *   7. The worker: `node --check` parses worker.js, relay-core.js and
 *      build-tools.js; the structural checks pin the routes
 *      (/mcp/<32-hex>, /ws/<32-hex>, everything else 404), the Origin
 *      rule (the studio site, 127.0.0.1/localhost with any port, and
 *      nothing else), the Room's hibernation-API shape
 *      (fetch/webSocketMessage/webSocketClose), and wrangler.toml's
 *      worker/main/binding/migration lines.
 *   8. tools/relay/tools.json equals the one tool core's list —
 *      renderer/pce-agent-tools.js (#166).  While the core is not in
 *      the tree yet, that check prints SKIP and the file is instead
 *      held byte-equal to tools/mcp/server.js's TOOLS export, the
 *      list #166 must keep byte-identical (its card says the tools/
 *      list JSON before and after is byte-identical).  The build that
 *      wrote the file is tools/relay/build-tools.js.
 *
 * Everything runs under $TMPDIR (the http server binds an ephemeral
 * port); nothing is written into the repository.
 *
 * Written by @design because the card names this file.  Per workshop
 * rule 2 this test is the author's own mutant and proves only what its
 * author thought of: a cold break by another seat is owed before #165
 * closes.
 *
 *   node tests/check-relay.js
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const relayLib = require(path.join(ROOT, "tools", "relay", "relay-core.js"));
const TOOLS_JSON = require(path.join(ROOT, "tools", "relay", "tools.json"));
const WORKER = path.join(ROOT, "tools", "relay", "worker.js");

const TOKEN = "0123456789abcdef0123456789abcdef";
const TOKEN_B = "fedcba9876543210fedcba9876543210";

let checks = 0;
const failures = [];

function check(ok, name) {
  checks++;
  if (!ok) { failures.push(name); console.log("FAIL  " + name); }
}
function eq(name, got, want) {
  check(JSON.stringify(got) === JSON.stringify(want),
        name + " (got " + JSON.stringify(got) + ", want " +
        JSON.stringify(want) + ")");
}

/* ---- the HTTP wrapper: relay-core behind a real node:http server -------- */

function startHttp(relay) {
  const server = http.createServer(function (req, res) {
    const m = /^\/mcp\/([0-9a-f]{32})$/.exec(req.url || "");
    if (req.method !== "POST" || !m) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not-found" }));
      return;
    }
    let body = "";
    req.on("data", function (c) { body += c; });
    req.on("end", function () {
      relay.handleMcp(m[1], body).then(function (out) {
        res.writeHead(out.status, { "content-type": "application/json" });
        res.end(out.json === null || out.json === undefined
          ? "" : JSON.stringify(out.json));
      }).catch(function (e) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "wrapper: " + e.message }));
      });
    });
  });
  return new Promise(function (resolve) {
    server.listen(0, "127.0.0.1", function () { resolve(server); });
  });
}

/* one POST; {status, body} where body is the parsed JSON (null for an
 * empty reply) */
function post(port, token, msg) {
  const body = JSON.stringify(msg);
  return new Promise(function (resolve, reject) {
    const req = http.request({
      host: "127.0.0.1", port: port, method: "POST",
      path: "/mcp/" + token,
      headers: { "content-type": "application/json" }
    }, function (res) {
      let text = "";
      res.on("data", function (c) { text += c; });
      res.on("end", function () {
        resolve({
          status: res.statusCode,
          body: text ? JSON.parse(text) : null
        });
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

function postRaw(port, token, rawText) {
  return new Promise(function (resolve, reject) {
    const req = http.request({
      host: "127.0.0.1", port: port, method: "POST",
      path: "/mcp/" + token,
      headers: { "content-type": "application/json" }
    }, function (res) {
      let text = "";
      res.on("data", function (c) { text += c; });
      res.on("end", function () {
        resolve({ status: res.statusCode,
                  body: text ? JSON.parse(text) : null });
      });
    });
    req.on("error", reject);
    req.end(rawText);
  });
}

function fakeSocket() {
  return {
    sent: [],
    closed: false,
    send: function (text) { this.sent.push(JSON.parse(text)); },
    close: function () { this.closed = true; }
  };
}

function rpc(method, params, id) {
  const msg = { jsonrpc: "2.0", method: method, params: params || {} };
  if (id !== undefined) msg.id = id;
  return msg;
}

/* wait until cond() is true (polled — the call is answered from the
 * other side while the POST is in flight) */
async function until(cond, what) {
  for (let i = 0; i < 500; i++) {
    if (cond()) return;
    await new Promise(function (r) { setTimeout(r, 5); });
  }
  throw new Error("timed out waiting for " + what);
}

/* ---- the suites ---------------------------------------------------------- */

async function run() {
  const clock = { t: 1000000 };
  const relay = new relayLib.Relay({
    now: function () { return clock.t; },
    tools: TOOLS_JSON
  });
  const server = await startHttp(relay);
  const port = server.address().port;

  /* 1. the MCP handshake over HTTP */
  const init = await post(port, TOKEN, rpc("initialize",
    { protocolVersion: "2025-06-18" }, 1));
  eq("initialize status", init.status, 200);
  eq("initialize echoes a known protocolVersion",
     init.body.result.protocolVersion, "2025-06-18");
  eq("initialize serverInfo", init.body.result.serverInfo,
     { name: "pcestudio", version: "0.1.0" });
  check(init.body.result.capabilities &&
        typeof init.body.result.capabilities.tools === "object",
        "initialize carries capabilities.tools");
  check(typeof init.body.result.instructions === "string" &&
        init.body.result.instructions.length > 40 &&
        /studio/i.test(init.body.result.instructions),
        "initialize carries instructions text naming the studio");

  const initOld = await post(port, TOKEN, rpc("initialize",
    { protocolVersion: "2024-11-05" }, 2));
  eq("initialize echoes an older known protocolVersion",
     initOld.body.result.protocolVersion, "2024-11-05");

  const initNew = await post(port, TOKEN, rpc("initialize",
    { protocolVersion: "2099-01-01" }, 3));
  eq("initialize answers the default for an unknown protocolVersion",
     initNew.body.result.protocolVersion, "2025-06-18");

  const notif = await post(port, TOKEN,
    { jsonrpc: "2.0", method: "notifications/initialized" });
  eq("notifications/initialized status", notif.status, 202);
  check(notif.body === null, "notifications/initialized has an empty body");

  const ping = await post(port, TOKEN, rpc("ping", {}, 4));
  eq("ping answers {}", ping.body,
     { jsonrpc: "2.0", id: 4, result: {} });

  const list = await post(port, TOKEN, rpc("tools/list", {}, 5));
  eq("tools/list is the embedded tools.json, byte for byte",
     list.body.result, { tools: TOOLS_JSON });
  check(TOOLS_JSON.length >= 11 &&
        TOOLS_JSON.every(function (t) {
          return t.name && t.description && t.inputSchema;
        }),
        "tools.json holds " + TOOLS_JSON.length + " complete definitions");

  /* 2. a tools/call round-trips to the tab */
  const tab = fakeSocket();
  relay.attachTab(TOKEN, tab);
  relay.onTabMessage(TOKEN, JSON.stringify(
    { type: "hello", version: 1, title: "my toy" }));
  check(tab.sent.length === 0, "hello is recorded, not answered");

  relay.onTabMessage(TOKEN, JSON.stringify({ type: "ping" }));
  eq("the tab's ping is answered with pong", tab.sent,
     [{ type: "pong" }]);
  tab.sent.length = 0;

  const callP = post(port, TOKEN, rpc("tools/call",
    { name: "toy_write", arguments: { files: [
      { name: "main.lua", source: "x = 1" } ] } }, 6));
  await until(function () { return tab.sent.length === 1; },
              "the call reaching the tab");
  eq("the tab receives the call with id, name and arguments",
     tab.sent[0],
     { type: "call",
       id: tab.sent[0].id,
       name: "toy_write",
       arguments: { files: [{ name: "main.lua", source: "x = 1" }] } });
  check(/^[0-9a-f-]{8,}$/.test(tab.sent[0].id),
        "the call id is a uuid");
  relay.onTabMessage(TOKEN, JSON.stringify({
    type: "result", id: tab.sent[0].id,
    result: { content: [{ type: "text", text: "ok" }], isError: false }
  }));
  const callOut = await callP;
  eq("tools/call returns the tab's result verbatim",
     callOut.body,
     { jsonrpc: "2.0", id: 6,
       result: { content: [{ type: "text", text: "ok" }], isError: false } });
  tab.sent.length = 0;

  const errP = post(port, TOKEN, rpc("tools/call",
    { name: "toy_run", arguments: { frames: 10 } }, 7));
  await until(function () { return tab.sent.length === 1; },
              "the second call reaching the tab");
  relay.onTabMessage(TOKEN, JSON.stringify(
    { type: "error", id: tab.sent[0].id, message: "boom" }));
  const errOut = await errP;
  eq("the tab's error is an isError result carrying the message",
     errOut.body,
     { jsonrpc: "2.0", id: 7,
       result: { content: [{ type: "text", text: "boom" }],
                 isError: true } });

  relay.onTabMessage(TOKEN, JSON.stringify(
    { type: "result", id: "no-such-call", result: { content: [] } }));
  relay.onTabMessage(TOKEN, JSON.stringify({ type: "what-is-this" }));
  check(!tab.closed, "unknown ids and message types are dropped, not fatal");

  /* 3. the two pinned failures */
  const noTab = await post(port, TOKEN_B, rpc("tools/call",
    { name: "toy_run", arguments: { frames: 1 } }, 8));
  eq("a call with no tab answers the card's exact text",
     noTab.body,
     { jsonrpc: "2.0", id: 8,
       result: {
         content: [{ type: "text", text: relayLib.NO_TAB_TEXT }],
         isError: true
       } });

  const slowRelay = new relayLib.Relay({
    now: function () { return clock.t; },
    tools: TOOLS_JSON,
    callTimeoutMs: 50
  });
  const slowServer = await startHttp(slowRelay);
  const slowPort = slowServer.address().port;
  const slowTab = fakeSocket();
  slowRelay.attachTab(TOKEN, slowTab);
  const slowOut = await post(slowPort, TOKEN, rpc("tools/call",
    { name: "validate", arguments: {} }, 9));
  eq("a call the tab never answers times out with the card's exact text",
     slowOut.body,
     { jsonrpc: "2.0", id: 9,
       result: {
         content: [{ type: "text", text: relayLib.TIMEOUT_TEXT }],
         isError: true
       } });
  check(slowTab.sent.length === 1,
        "the timed-out call was delivered to the tab first");

  /* detach fails the pending calls */
  const detachTab = fakeSocket();
  relay.attachTab(TOKEN, detachTab);
  const detachP = post(port, TOKEN, rpc("tools/call",
    { name: "validate", arguments: {} }, 10));
  await until(function () { return detachTab.sent.length === 1; },
              "the pending call reaching the tab");
  relay.detachTab(TOKEN);
  const detachOut = await detachP;
  eq("detaching the tab fails its pending calls with the disconnected text",
     detachOut.body.result,
     { content: [{ type: "text", text: relayLib.DISCONNECTED_TEXT }],
       isError: true });
  const afterDetach = await post(port, TOKEN, rpc("tools/call",
    { name: "validate", arguments: {} }, 11));
  eq("after a detach, a call sees no tab",
     afterDetach.body.result.content[0].text, relayLib.NO_TAB_TEXT);

  /* 4. takeover and isolation */
  const first = fakeSocket();
  relay.attachTab(TOKEN, first);
  const second = fakeSocket();
  relay.attachTab(TOKEN, second);
  eq("the older tab is told it was taken", first.sent,
     [{ type: "taken" }]);
  check(first.closed, "the older tab's socket is closed");
  const takenP = post(port, TOKEN, rpc("tools/call",
    { name: "docs", arguments: {} }, 12));
  await until(function () { return second.sent.length === 1; },
              "the call reaching the new tab");
  check(first.sent.length === 1,
        "the taken tab gets no further calls");
  relay.onTabMessage(TOKEN, JSON.stringify({
    type: "result", id: second.sent[0].id,
    result: { content: [{ type: "text", text: "docs" }], isError: false }
  }));
  const takenOut = await takenP;
  eq("the new tab answers the call", takenOut.body.result,
     { content: [{ type: "text", text: "docs" }], isError: false });

  const tabA = fakeSocket();
  const tabB = fakeSocket();
  relay.attachTab(TOKEN, tabA);
  relay.attachTab(TOKEN_B, tabB);
  const isoP = post(port, TOKEN, rpc("tools/call",
    { name: "docs", arguments: {} }, 13));
  await until(function () { return tabA.sent.length === 1; },
              "the call reaching tab A");
  check(tabB.sent.length === 0,
        "a second token's tab never sees the first token's calls");
  /* B cannot answer A's call — A still can */
  relay.onTabMessage(TOKEN_B, JSON.stringify({
    type: "result", id: tabA.sent[0].id,
    result: { content: [{ type: "text", text: "spoof" }], isError: false }
  }));
  relay.onTabMessage(TOKEN, JSON.stringify({
    type: "result", id: tabA.sent[0].id,
    result: { content: [{ type: "text", text: "real" }], isError: false }
  }));
  const isoOut = await isoP;
  eq("only the first token's tab can answer the call", isoOut.body.result,
     { content: [{ type: "text", text: "real" }], isError: false });
  const isoB = post(port, TOKEN_B, rpc("tools/call",
    { name: "docs", arguments: {} }, 14));
  await until(function () { return tabB.sent.length === 1; },
              "B's own call reaching tab B");
  relay.onTabMessage(TOKEN_B, JSON.stringify({
    type: "result", id: tabB.sent[0].id,
    result: { content: [{ type: "text", text: "B's" }], isError: false }
  }));
  const isoBOut = await isoB;
  eq("the second token runs its own calls", isoBOut.body.result,
     { content: [{ type: "text", text: "B's" }], isError: false });

  /* 5. the limits */
  const badPath = await new Promise(function (resolve, reject) {
    const req = http.request({
      host: "127.0.0.1", port: port, method: "POST",
      path: "/mcp/not-a-token",
      headers: { "content-type": "application/json" }
    }, function (res) {
      res.resume();
      res.on("end", function () { resolve(res.statusCode); });
    });
    req.on("error", reject);
    req.end("{}");
  });
  eq("a path without a 32-hex token is a 404", badPath, 404);
  const badCore = await relay.handleMcp("XYZ", "{}");
  eq("the core itself refuses a bad token with 404",
     badCore.status, 404);

  const smallRelay = new relayLib.Relay({
    now: function () { return clock.t; },
    tools: TOOLS_JSON,
    messageLimitBytes: 2048
  });
  const smallServer = await startHttp(smallRelay);
  const smallPort = smallServer.address().port;
  const big = await postRaw(smallPort, TOKEN,
    "{\"pad\":\"" + "x".repeat(4000) + "\"}");
  eq("a body over the message limit is a 413", big.status, 413);
  const okSmall = await post(smallPort, TOKEN, rpc("ping", {}, 15));
  eq("a body inside the limit still answers", okSmall.status, 200);

  const rateRelay = new relayLib.Relay({
    now: function () { return clock.t; },
    tools: TOOLS_JSON,
    ratePerSecond: 2,
    rateCapacity: 2
  });
  const rateServer = await startHttp(rateRelay);
  const ratePort = rateServer.address().port;
  const r1 = await post(ratePort, TOKEN, rpc("ping", {}, 16));
  const r2 = await post(ratePort, TOKEN, rpc("ping", {}, 17));
  const r3 = await post(ratePort, TOKEN, rpc("ping", {}, 18));
  eq("the first two requests pass", [r1.status, r2.status], [200, 200]);
  eq("the third request inside one second is a 429", r3.status, 429);
  clock.t += 1000;
  const r4 = await post(ratePort, TOKEN, rpc("ping", {}, 19));
  eq("a second later the bucket refills", r4.status, 200);

  /* forgetting resets the room (its rate bucket included): with a
   * refill of 0.1/s, only a forgotten room can serve two requests
   * back to back */
  const forgetRelay = new relayLib.Relay({
    now: function () { return clock.t; },
    tools: TOOLS_JSON,
    ratePerSecond: 0.1,
    rateCapacity: 2,
    forgetAfterMs: 60000
  });
  const forgetServer = await startHttp(forgetRelay);
  const forgetPort = forgetServer.address().port;
  const f1 = await post(forgetPort, TOKEN, rpc("ping", {}, 20));
  const f2 = await post(forgetPort, TOKEN, rpc("ping", {}, 21));
  const f3 = await post(forgetPort, TOKEN, rpc("ping", {}, 22));
  eq("two requests exhaust the small bucket",
     [f1.status, f2.status, f3.status], [200, 200, 429]);
  clock.t += 1500;   /* 0.1/s refills only 0.15 — still refused */
  const f4 = await post(forgetPort, TOKEN, rpc("ping", {}, 23));
  eq("without the forget window, the tiny refill still refuses",
     f4.status, 429);
  clock.t += 60000;  /* past forgetAfterMs with no tab: the room goes */
  const f5 = await post(forgetPort, TOKEN, rpc("ping", {}, 24));
  const f6 = await post(forgetPort, TOKEN, rpc("ping", {}, 25));
  eq("a forgotten room comes back with a full bucket",
     [f5.status, f6.status], [200, 200]);

  /* a tab message over the limit closes the socket */
  const wsTab = fakeSocket();
  smallRelay.attachTab(TOKEN, wsTab);
  smallRelay.onTabMessage(TOKEN, "{\"type\":\"ping\"}");
  eq("a small tab message is fine", wsTab.closed, false);
  smallRelay.onTabMessage(TOKEN, "x".repeat(3000));
  check(wsTab.closed, "a tab message over the limit closes the socket");
  const badJsonTab = fakeSocket();
  smallRelay.attachTab(TOKEN, badJsonTab);
  smallRelay.onTabMessage(TOKEN, "not json");
  check(badJsonTab.closed, "a non-JSON tab message closes the socket");

  /* 6. JSON-RPC edges */
  const parseErr = await postRaw(port, TOKEN, "{not json");
  eq("unparseable JSON is a 400", parseErr.status, 400);
  eq("its body is -32700", parseErr.body,
     { jsonrpc: "2.0", id: null,
       error: { code: -32700, message: "parse error" } });
  const notObj = await postRaw(port, TOKEN, "42");
  eq("a non-object body is -32600", notObj.body,
     { jsonrpc: "2.0", id: null,
       error: { code: -32600,
                message: "invalid request: expected one JSON-RPC object" } });
  const noMethod = await post(port, TOKEN,
    { jsonrpc: "2.0", method: "fly_to_the_moon", id: 26 });
  eq("an unknown method is -32601", noMethod.body,
     { jsonrpc: "2.0", id: 26,
       error: { code: -32601, message: "method not found: fly_to_the_moon" } });
  const badTool = await post(port, TOKEN, rpc("tools/call",
    { name: "nope", arguments: {} }, 27));
  eq("an unknown tool is -32602", badTool.body,
     { jsonrpc: "2.0", id: 27,
       error: { code: -32602, message: "unknown tool \"nope\"" } });
  const noName = await post(port, TOKEN, rpc("tools/call", {}, 28));
  eq("tools/call without a name is -32602", noName.body,
     { jsonrpc: "2.0", id: 28,
       error: { code: -32602, message: "tools/call needs a tool name" } });
  const batch = await post(port, TOKEN,
    [rpc("ping", {}, 29), rpc("ping", {}, 30)]);
  eq("a batch answers as one array", batch.body,
     [{ jsonrpc: "2.0", id: 29, result: {} },
      { jsonrpc: "2.0", id: 30, result: {} }]);
  const emptyBatch = await post(port, TOKEN, []);
  eq("an empty batch is -32600", emptyBatch.body,
     { jsonrpc: "2.0", id: null,
       error: { code: -32600, message: "empty batch" } });

  /* 7. the worker: node --check and the structural pins */
  for (const f of [WORKER,
                   path.join(ROOT, "tools", "relay", "relay-core.js"),
                   path.join(ROOT, "tools", "relay", "build-tools.js")]) {
    const chk = spawnSync("node", ["--check", f], { encoding: "utf8" });
    check(chk.status === 0,
          "node --check parses " + path.relative(ROOT, f) +
          (chk.status === 0 ? "" : ": " + chk.stderr.trim()));
  }

  const worker = require(WORKER);
  check(typeof worker.fetch === "function", "worker.js exports fetch");
  check(typeof worker.Room === "function" &&
        typeof worker.Room.prototype.fetch === "function" &&
        typeof worker.Room.prototype.webSocketMessage === "function" &&
        typeof worker.Room.prototype.webSocketClose === "function",
        "worker.js exports a Room with the hibernation-API shape");
  check(worker.routePath && worker.originAllowed,
        "worker.js exports routePath and originAllowed for the tests");

  eq("route /mcp/<token>", worker.routePath("/mcp/" + TOKEN),
     { kind: "mcp", token: TOKEN });
  eq("route /ws/<token>", worker.routePath("/ws/" + TOKEN),
     { kind: "ws", token: TOKEN });
  eq("route a bad token is a 404", worker.routePath("/mcp/zzz"),
     { error: 404 });
  eq("route a 31-hex token is a 404",
     worker.routePath("/mcp/" + "a".repeat(31)), { error: 404 });
  eq("route an uppercase token is a 404",
     worker.routePath("/mcp/" + TOKEN.toUpperCase()), { error: 404 });
  eq("route an extra segment is a 404",
     worker.routePath("/mcp/" + TOKEN + "/extra"), { error: 404 });
  eq("route any other path is a 404", worker.routePath("/favicon.ico"),
     { error: 404 });

  check(worker.originAllowed("https://pcestudio.terracides.com"),
        "Origin: the studio site is allowed");
  check(worker.originAllowed("http://127.0.0.1:8080"),
        "Origin: 127.0.0.1 with a port is allowed");
  check(worker.originAllowed("http://localhost:3000"),
        "Origin: localhost with a port is allowed");
  check(!worker.originAllowed("https://evil.example"),
        "Origin: another site is refused");
  check(!worker.originAllowed("null") && !worker.originAllowed("") &&
        !worker.originAllowed(undefined),
        "Origin: null/missing is refused");

  const toml = fs.readFileSync(
    path.join(ROOT, "tools", "relay", "wrangler.toml"), "utf8");
  check(/^main\s*=\s*"worker\.js"\s*$/m.test(toml),
        "wrangler.toml names worker.js as main");
  check(/class_name\s*=\s*"Room"/.test(toml) &&
        /name\s*=\s*"ROOM"/.test(toml),
        "wrangler.toml binds ROOM to the Room class");
  check(/\[\[migrations\]\]/.test(toml) &&
        /new_classes\s*=\s*\["Room"\]/.test(toml),
        "wrangler.toml migrates the Room class");

  /* 8. tools.json equals the one tool core's list */
  let coreTools = null;
  try {
    const core = require(path.join(ROOT, "renderer", "pce-agent-tools.js"));
    const session = core.createSession({});
    if (session && Array.isArray(session.tools)) coreTools = session.tools;
  } catch (e) {
    coreTools = null;
  }
  if (coreTools) {
    eq("tools.json equals the tool core's list (#166)",
       TOOLS_JSON, coreTools);
  } else {
    const server = require(path.join(ROOT, "tools", "mcp", "server.js"));
    if (server.TOOLS) {
      eq("tools.json equals tools/mcp/server.js's list (the interim " +
         "source, byte-identical per #166)", TOOLS_JSON, server.TOOLS);
    } else {
      check(false, "tools.json has no source in this tree: neither " +
                   "renderer/pce-agent-tools.js nor tools/mcp/server.js " +
                   "exports the tools");
    }
    console.log("SKIP: tools.json vs renderer/pce-agent-tools.js — the " +
                "tool core (#166) is not in this tree yet; compared with " +
                "tools/mcp/server.js instead (its list #166 keeps " +
                "byte-identical)");
  }

  /* 9. the token shape the whole protocol hangs on */
  check(relayLib.TOKEN_RE.test(TOKEN), "a 32-hex token is valid");
  check(!relayLib.TOKEN_RE.test(TOKEN + "0") &&
        !relayLib.TOKEN_RE.test(TOKEN.slice(0, 31)) &&
        !relayLib.TOKEN_RE.test(TOKEN.toUpperCase()) &&
        !relayLib.TOKEN_RE.test("g".repeat(32)),
        "shorter, longer, uppercase and non-hex tokens are invalid");
  let attachThrew = false;
  try { relay.attachTab("zzz", fakeSocket()); } catch (e) {
    attachThrew = true;
  }
  check(attachThrew, "attachTab refuses a bad token");

  server.close();
  slowServer.close();
  smallServer.close();
  rateServer.close();
  forgetServer.close();

  console.log("");
  if (failures.length) {
    console.log("FAILED " + failures.length + " of " + checks + " checks");
    process.exit(1);
  }
  console.log("PASS  " + checks + " checks: the relay speaks MCP " +
              "initialize/tools/list/tools/call over a real node:http " +
              "server; a tools/call round-trips to the tab (and a " +
              "taken-over tab is closed and cut off); the no-tab, " +
              "timeout and disconnect results carry the card's texts; " +
              "bad tokens are 404, oversize bodies 413, the rate limit " +
              "429 and a forgotten token starts fresh; a second token " +
              "sees nothing; node --check parses the worker and the " +
              "structural checks pin its routes, Origin rule and " +
              "wrangler.toml; tools.json equals the tool core's list");
  process.exit(0);
}

run().catch(function (e) {
  console.log("FAIL  the run threw: " + (e && e.stack || e));
  process.exit(1);
});
