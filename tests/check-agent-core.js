#!/usr/bin/env node
/*
 * tests/check-agent-core.js — the #166 evidence: renderer/pce-agent-tools.js
 * is the ONE tool core, and it runs without Node.
 *
 *   1. the core needs no files, no environment and no buffers: a grep of its
 *      text refuses the Node-only tokens (require("fs"), and the words
 *      process / Buffer / os), so a Node dependency smuggled back in fails
 *      this test;
 *   2. tools/list is byte-identical in both branches of the core: the
 *      committed tests/dumps/mcp-tools-list.json is a capture of the
 *      server's tools/list, and the new server must send the same JSON, byte
 *      for byte — and the core's own TOOLS table, in both its branches, must
 *      match it.  (The capture was taken from the old tools/mcp/server.js
 *      the day of the #166 split, to prove the split changed nothing; #163
 *      added project_save and project_open, and the fixture was re-taken
 *      then.  A tool the core gains without the fixture being re-taken fails
 *      here.)
 *   3. the core RUNS in a node:vm context that has nothing but the renderer
 *      modules: no require, no process, no fs, no Buffer, no module — the
 *      browser branch of the UMD, the one the studio tab will load (#167).
 *      Recipes 02 and 06 from the skill run through it, and every tool
 *      reply — frame_png's image data and its frame hash in the meta
 *      included — is byte-identical to the one the real server over stdio
 *      gives for the same calls;
 *   4. the CommonJS branch works too: requiring the core in Node gives the
 *      same TOOLS table the fixture carries.
 *
 *   node tests/check-agent-core.js
 *
 * Written by @design because the card names this test.  Rule 2: a cold
 * break by another seat is owed before the card closes.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const zlib = require("zlib");
const { spawn } = require("child_process");
const readline = require("readline");

const ROOT = path.join(__dirname, "..");
const CORE_FILE = path.join(ROOT, "renderer", "pce-agent-tools.js");
const SERVER = path.join(ROOT, "tools", "mcp", "server.js");
const FIXTURE = path.join(ROOT, "tests", "dumps", "mcp-tools-list.json");
const RECIPES = path.join(ROOT, "plugin", "skills", "creating-pce-toys",
                          "recipes");

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

/* ---- 1. the core is its own language, not Node's ------------------------ */

function checkBannedTokens() {
  const src = fs.readFileSync(CORE_FILE, "utf8");
  const banned = [
    [/require\s*\(\s*["']fs["']/, 'require("fs")'],
    [/\bprocess\b/, "the word process"],
    [/\bBuffer\b/, "the word Buffer"],
    [/\bos\b/, "the word os"]
  ];
  for (const [re, what] of banned) {
    check(!re.test(src),
          "the core's text has no " + what + " (a Node dependency smuggled " +
          "back in fails here)");
  }
  /* the mcp-pack walker reads every require( in the file; a require( that
   * only lives in a comment would make the pack fail or carry junk */
  const commentLine = /^\s*(\/\*|\*|\/\/)/;
  src.split("\n").forEach(function (line, i) {
    check(!(commentLine.test(line) && /require\s*\(/.test(line)),
          "the core has no require( in a comment (line " + (i + 1) + ")");
  });
}

/* ---- 2. tools/list: before and after the split -------------------------- */

class Client {
  constructor(proc) {
    this.proc = proc;
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = "";
    proc.stderr.on("data", (d) => { this.stderr += d.toString(); });
    this.rl = readline.createInterface({ input: proc.stdout,
                                         crlfDelay: Infinity });
    this.rl.on("line", (line) => this.onLine(line));
  }
  onLine(line) {
    const msg = JSON.parse(line);
    if (msg.id == null || !this.pending.has(msg.id)) return;
    const waiter = this.pending.get(msg.id);
    this.pending.delete(msg.id);
    waiter(msg);
  }
  request(method, params, timeoutMs) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("timeout waiting for " + method +
                         "\nserver stderr:\n" + this.stderr.slice(-2000)));
      }, timeoutMs || 30000);
      this.pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
      this.proc.stdin.write(JSON.stringify({
        jsonrpc: "2.0", id: id, method: method,
        params: params === undefined ? {} : params
      }) + "\n");
    });
  }
  /* the raw tool result, the shape the core's call() returns */
  async call(name, args) {
    const msg = await this.request("tools/call",
                                   { name: name, arguments: args || {} });
    if (msg.error) throw new Error("JSON-RPC error from " + name + ": " +
                                   JSON.stringify(msg.error));
    return msg.result;
  }
  close() {
    try { this.proc.stdin.end(); } catch (e) { /* already closed */ }
    this.rl.close();
    if (this.proc.exitCode == null) this.proc.kill("SIGTERM");
  }
}

/* ---- 3. the core in a bare node:vm context ------------------------------ */

function buildSandbox() {
  const core = fs.readFileSync(CORE_FILE, "utf8");
  const ctx = vm.createContext({});
  /* The context holds ONLY the renderer modules — the page's globals, the
   * browser branch of the UMD.  The core must run on that and nothing else:
   * not on require, not on the file system, not on zlib.  (The modules
   * themselves were loaded by Node — the test's convenience; inside the
   * context nothing but their exports exists.) */
  const PCEStudio = {
    il: require(path.join(ROOT, "renderer", "pce-il.js")),
    ilbc: require(path.join(ROOT, "renderer", "pce-ilbc.js")),
    rom: require(path.join(ROOT, "renderer", "pce-rom.js")),
    docs: require(path.join(ROOT, "renderer", "pce-docs.js")),
    validate: require(path.join(ROOT, "renderer", "pce-validate.js")),
    sprites: require(path.join(ROOT, "renderer", "pce-sprites.js")),
    toyhost: require(path.join(ROOT, "renderer", "pce-toyhost.js")),
    panels: require(path.join(ROOT, "renderer", "pce-panels.js")),
    psg: require(path.join(ROOT, "renderer", "pce-psg.js")),
    source: require(path.join(ROOT, "renderer", "pce-source.js")),
    sat: require(path.join(ROOT, "renderer", "pce-sat.js")),
    editor: require(path.join(ROOT, "renderer", "pce-editor.js")),
    seq: require(path.join(ROOT, "renderer", "pce-seq.js")),
    project: require(path.join(ROOT, "renderer", "pce-project.js")),
    romcheck: require(path.join(ROOT, "renderer", "pce-romcheck.js")),
    assets: require(path.join(ROOT, "renderer", "pce-assets.js"))
  };
  ctx.PCEStudio = PCEStudio;
  vm.runInContext(core, ctx, { filename: "pce-agent-tools.js" });

  for (const name of ["require", "process", "fs", "Buffer", "module",
                      "zlib", "os"]) {
    check(vm.runInContext("typeof " + name, ctx) === "undefined",
          "the sandbox context has no " + name + " — the core ran in it " +
          "without it");
  }

  const coreApi = ctx.PCEStudio.agentTools;
  check(!!coreApi && typeof coreApi.createSession === "function",
        "the browser branch exposes createSession");

  /* The sandbox host: zlib from the TEST's side — the host is the outside
   * world, and in the page #167's adapter will hand the same steps to the
   * platform.  The recipes never save or export, so those doors throw. */
  const host = {
    deflate: function (bytes) { return zlib.deflateSync(Buffer.from(bytes)); },
    inflate: function (bytes) { return zlib.inflateSync(Buffer.from(bytes)); },
    readBank0: function () {
      throw new Error("readBank0: the recipes never export");
    },
    savePath: function () {
      throw new Error("savePath: the recipes never save");
    },
    saveEnvelope: function () {
      throw new Error("saveEnvelope: the recipes never save");
    },
    writeRom: function () {
      throw new Error("writeRom: the recipes never export");
    }
  };
  const session = coreApi.createSession(host);

  /* Arguments cross the realm boundary: rebuild them with the context's own
   * JSON (the inner global's parse — the contextified object does not
   * expose its builtins from outside) so the core's Array.isArray and
   * friends see ITS arrays. */
  const sandboxParse = vm.runInContext("JSON.parse", ctx);
  function sandboxCall(name, args) {
    const sandboxArgs = sandboxParse(JSON.stringify(args || {}));
    return session.call(name, sandboxArgs);
  }
  return { ctx: ctx, call: sandboxCall, TOOLS: coreApi.TOOLS };
}

/* ---- the recipes, through both worlds ----------------------------------- */

function recipeSource(name) {
  return fs.readFileSync(path.join(RECIPES, name), "utf8");
}
function gridOf(source) {
  const m = /-- GRID (\{.*\})/.exec(source);
  return m ? JSON.parse(m[1]) : null;
}

/* One sequence: the calls check-skill drives for the recipe, as a list of
 * [tool, args].  A caller runs each through its world and keeps the raw
 * result ({content, isError}), so the transcripts compare reply for reply,
 * image bytes and frame hashes included. */
function sequences() {
  const two = recipeSource("02-sprite-on-the-pad.lua");
  const six = recipeSource("06-add-a-sprite-from-a-png.lua");
  const grid = gridOf(six);
  return [
    ["recipe 02 - sprite on the pad", [
      ["toy_write", { files: [{ name: "main.lua", source: two }] }],
      ["toy_run", { frames: 60 }],
      ["frame_png", { frame: 59 }],
      ["toy_run", { frames: 31 }],
      ["frame_png", { frame: 30 }],
      ["toy_run", { frames: 31,
                    pad: [{ from: 0, to: 30, pad: 1, buttons: ["right"] }] }],
      ["frame_png", { frame: 30 }],
      ["validate", { frames: 8 }]
    ]],
    ["recipe 06 - a sprite from a grid", [
      ["toy_write", { files: [{ name: "main.lua", source: six }] }],
      ["toy_run", { frames: 60 }],
      ["frame_png", { frame: 59 }],
      ["source_add", { kind: "sprites", name: "square",
                       grid: { width: grid.width, height: grid.height,
                               pixels: grid.pixels },
                       palette: grid.palette }],
      ["toy_run", { frames: 60 }],
      ["frame_png", { frame: 59 }],
      ["validate", { frames: 8 }]
    ]]
  ];
}

async function runSequence(call, seq) {
  const out = [];
  for (const [name, args] of seq) {
    out.push({ call: name, result: await call(name, args) });
  }
  return out;
}

/* ---- main ---------------------------------------------------------------- */

(async function main() {
  checkBannedTokens();

  /* the fixture is the committed tools/list capture */
  const wantTools = fs.readFileSync(FIXTURE, "utf8");
  check(wantTools.length > 1000, "the fixture is a real tools/list capture");

  /* the core's TOOLS, in both branches */
  const nodeCore = require(CORE_FILE);
  eq("the CommonJS branch's TOOLS are the fixture", JSON.stringify(nodeCore.TOOLS),
     wantTools);

  const proc = spawn(process.execPath, [SERVER], {
    cwd: ROOT, stdio: ["pipe", "pipe", "pipe"]
  });
  const client = new Client(proc);

  try {
    await client.request("initialize", {
      protocolVersion: "2025-06-18", capabilities: {},
      clientInfo: { name: "check-agent-core", version: "1" }
    });
    const list = await client.request("tools/list", {});
    check(!list.error, "the new server answers tools/list");
    eq("the new server's tools/list is the committed capture, byte for byte",
       JSON.stringify(list.result && list.result.tools), wantTools);

    const sandbox = buildSandbox();
    eq("the browser branch's TOOLS are the fixture",
       JSON.stringify(sandbox.TOOLS), wantTools);

    /* the recipes, through the real server and through the bare context */
    for (const [label, seq] of sequences()) {
      const serverRun = await runSequence((n, a) => client.call(n, a), seq);
      const sandboxRun = await runSequence(sandbox.call, seq);

      check(serverRun.every((r) => !r.result.isError),
            label + ": every call succeeds on the server");
      check(sandboxRun.every((r) => !r.result.isError),
            label + ": every call succeeds in the sandbox");

      for (let i = 0; i < seq.length; i++) {
        const got = JSON.stringify(sandboxRun[i].result);
        const want = JSON.stringify(serverRun[i].result);
        check(got === want,
              label + ": " + seq[i][0] + " reply is byte-identical across " +
              "the server and the bare context" +
              (got === want ? "" : " (sandbox " + got.length + " chars, " +
               "server " + want.length + " chars)"));
        if (seq[i][0] === "frame_png" && got === want) {
          const meta = serverRun[i].result.content
            .filter((c) => c.type === "text")
            .map((c) => JSON.parse(c.text))[0];
          check(typeof meta.sha256 === "string" && meta.sha256.length === 64,
                label + ": frame_png frame " + seq[i][1].frame +
                " hashes with the same sha256 in both worlds (" +
                meta.sha256.slice(0, 12) + "…)");
        }
      }
    }
  } catch (e) {
    check(false, "the core's two worlds answered every call: " + e.message);
  } finally {
    client.close();
  }

  if (failures.length) {
    for (const f of failures) console.log("FAIL  " + f);
    console.log("FAIL  " + failures.length + " of " + checks + " checks failed");
    process.exit(1);
  }
  console.log("PASS  " + checks + " checks: the one tool core carries no " +
              "Node tokens, tools/list is byte-identical to the committed " +
              "capture in both of the core's branches, and " +
              "recipes 02 and 06 run in a node:vm context with nothing but " +
              "the renderer modules, reply for byte-identical reply with the " +
              "stdio server — frame hashes included");
})();
