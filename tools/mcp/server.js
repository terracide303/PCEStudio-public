#!/usr/bin/env node
/*
 * tools/mcp/server.js — the PCEStudio MCP server: the stdio transport plus
 * the Node side of the outside world (cards #36, #166).
 *
 *   node tools/mcp/server.js
 *
 * A MODEL CONTEXT PROTOCOL SERVER over stdio.  A client (Claude Code, or any
 * MCP client) starts it, then calls the tools that write, run, look at,
 * check and export a toy.  This file is ONLY the wire and the Node host
 * adapter now: the tools themselves — every refusal, every frame, every
 * byte of a reply — live in renderer/pce-agent-tools.js (#166), one UMD
 * module that the studio tab loads too, so the page and the server run the
 * SAME tool code.  There is no second model in either file.
 *
 * WHY A MINIMAL JSON-RPC STDIO IMPLEMENTATION, NOT THE OFFICIAL SDK:
 *   - the repository has no package.json and no node_modules, and `tests/
 *     all.sh` runs from a fresh checkout with nothing installed.  The
 *     official @modelcontextprotocol/sdk would add an npm install step (and a
 *     network fetch) to a project whose only other dependency is vendored
 *     Fengari;
 *   - this server uses four requests — initialize, tools/list, tools/call,
 *     ping — and three notifications.  The stdio transport is one JSON-RPC
 *     2.0 message per line (the MCP stdio transport, spec 2024-11-05 and
 *     later); implementing that is ~120 lines and is testable in the same
 *     style as the rest of tests/;
 *   - no dependency means no version skew between a client's protocol
 *     revision and a third-party library's.
 * The wire format is the standard one, so an official-SDK client is a
 * normal client to this server; tests/check-mcp.js is one.
 *
 * THE HOST ADAPTER: renderer/pce-agent-tools.js createSession(host) — the
 * core's only door out of pure JavaScript, and this file's whole tool-side
 * job.  The Node host is:
 *   - zlib for the PNG reader's inflation and the PNG writer's deflation;
 *   - the file system for toy_save's envelope, under the same path rules as
 *     before (docs/STUDIO.md §3.7a): inside the folder the server was
 *     started in — for Claude Code, the person's project folder — or
 *     PCE_MCP_WORKDIR when it names one, with a path outside it refused
 *     (save-path), and a failed write refused (save-io);
 *   - the file system for project_save/project_open (#163): one .pcestudio,
 *     or the SAME layout unpacked into a folder (a trailing / on the name or
 *     an existing folder) so git can hold the history; opening reads either
 *     the archive or the folder's project.json, main.lua, art/ and versions/.
 *     The same folder fence applies (save-path / open-path);
 *   - the file system for export_pce's .pce: $TMPDIR/pce-mcp/<name>.pce by
 *     default, `out` when the caller names one;
 *   - renderer/ilvm.bin for export_pce's committed interpreter image.
 * The browser's adapter is the AGENT panel's job (#167): downloads instead
 * of writes.  The core runs unchanged in both.
 *
 * stdout carries JSON-RPC only; logs go to stderr.  Nothing in this file
 * calls a compiler or an emulator: export_pce is #100's browser route
 * (renderer/pce-il.js -> renderer/pce-ilbc.js -> renderer/pce-rom.js's
 * buildToyRom over the committed renderer/ilvm.bin).
 *
 * docs/MCP.md is the tool reference with an example call for every tool.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const zlib = require("zlib");
const readline = require("readline");

const ROOT = path.join(__dirname, "..", "..");
const agentTools = require(path.join(ROOT, "renderer", "pce-agent-tools.js"));

const SERVER_INFO = { name: "pcestudio", version: "0.1.0" };
const DEFAULT_PROTOCOL = "2025-06-18";
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

/* ---- the Node host adapter ---------------------------------------------- *
 * WHERE toy_save MAY WRITE.  Inside the folder the server was started in —
 * for Claude Code, the person's project folder — or PCE_MCP_WORKDIR when it
 * names one.  A path outside that folder is refused (save-path): an agent
 * must not be able to write over files it was never pointed at. */
function saveWorkdir() {
  const env = process.env.PCE_MCP_WORKDIR;
  return path.resolve(env && env.trim() ? env : process.cwd());
}

function saveInside(work, outPath) {
  const rel = path.relative(work, outPath);
  if (rel === "" || rel === ".." || path.isAbsolute(rel) ||
      rel.split(path.sep)[0] === "..") {
    agentTools.refuse("save-path", "toy_save writes inside the working folder only: " +
           JSON.stringify(outPath) + " is outside " + JSON.stringify(work) +
           "; pass a path inside it (PCE_MCP_WORKDIR names another folder)");
  }
}

/* project_open's fence: the same one, with its own code, so a reply says
 * which tool refused. */
function openInside(work, inPath) {
  const rel = path.relative(work, inPath);
  if (rel === "" || rel === ".." || path.isAbsolute(rel) ||
      rel.split(path.sep)[0] === "..") {
    agentTools.refuse("open-path", "project_open reads inside the working " +
           "folder only: " + JSON.stringify(inPath) + " is outside " +
           JSON.stringify(work) + "; pass a path inside it (PCE_MCP_WORKDIR " +
           "names another folder)");
  }
}

/* ---- the project folder (#163) -----------------------------------------
 * The unpacked route is the SAME layout as the archive (docs/PROJECT-
 * FORMAT.md): root files, art/ originals and versions/<n>-<label>/.  A
 * folder is a git repository, so it also holds .git/, a README and whatever
 * else the person keeps there — and README.md would be read as a project
 * file, a committed screenshot would not even decode.  The manifest is the
 * answer: project.json lists every file the project has, so the reader takes
 * exactly those (and its absence is what the core then refuses).  A file the
 * manifest lists but the folder lacks is simply not there, and the format's
 * own check (main.lua required) says whether that matters. */
function isFile(abs) {
  try { return fs.statSync(abs).isFile(); } catch (e) { return false; }
}

function readProjectFolder(root) {
  const manifest = path.join(root, "project.json");
  if (!isFile(manifest)) return [];
  const out = [{ name: "project.json", bytes: fs.readFileSync(manifest) }];
  let doc = null;
  try { doc = JSON.parse(fs.readFileSync(manifest, "utf8")); }
  catch (e) { return out; }               /* the core refuses project-json */
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return out;

  const put = function (rel) {
    const abs = path.join(root, rel);
    if (isFile(abs)) out.push({ name: rel, bytes: fs.readFileSync(abs) });
  };
  const leaf = function (name) {
    return typeof name === "string" && name && name !== "." && name !== ".." &&
           name.indexOf("/") < 0 && name.indexOf("\\") < 0;
  };

  /* the root files: main.lua, the asset files, NOTES.md */
  for (const f of (Array.isArray(doc.files) ? doc.files : [])) {
    if (f && leaf(f.name)) put(f.name);
  }
  /* art/<name>: the originals, flat */
  for (const a of (Array.isArray(doc.art) ? doc.art : [])) {
    if (a && leaf(a.name)) put("art/" + a.name);
  }
  /* versions/<n>-<label>/<file> */
  for (const v of (Array.isArray(doc.versions) ? doc.versions : [])) {
    if (!v || typeof v.dir !== "string") continue;
    const dir = v.dir.replace(/\/+$/, "");
    if (!dir || dir.indexOf("..") >= 0) continue;
    for (const f of (Array.isArray(v.files) ? v.files : [])) {
      if (f && leaf(f.name)) put(dir + "/" + f.name);
    }
  }
  return out;
}

/* A project entry's name is one the format built (renderer/pce-project.js
 * safeName), so this is the second lock on the same door: nothing a project
 * carries may land outside the folder it names. */
function entryPath(base, name) {
  const dest = path.resolve(base, name);
  const rel = path.relative(base, dest);
  if (rel === "" || rel === ".." || path.isAbsolute(rel) ||
      rel.split(path.sep)[0] === "..") {
    agentTools.refuse("save-path", "project entry " + JSON.stringify(name) +
                       " is outside " + JSON.stringify(base));
  }
  return dest;
}

const host = {
  /* the PNG steps: the core builds the container, zlib does the one step
   * plain JavaScript does not */
  deflate: function (bytes) { return zlib.deflateSync(bytes); },
  inflate: function (bytes) { return zlib.inflateSync(bytes); },

  /* export_pce's committed interpreter image (#100).  The mcp-pack walk
   * (tools/mcp-pack.sh) follows this readFileSync(path.join(ROOT, ...)) to
   * carry the file in the download. */
  readBank0: function () {
    return fs.readFileSync(path.join(ROOT, "renderer", "ilvm.bin"));
  },

  /* toy_save's path rules, before the envelope is built (the envelope's
   * title defaults to the resolved name's): resolve against the working
   * folder, add the studio's own extension — docs/STUDIO.md §3.7a: .pce.json
   * (or the newer .pce.studio); a bare name gets it appended rather than
   * written as a file the studio's Open will not offer — and refuse a path
   * outside it. */
  savePath: async function (p) {
    const work = saveWorkdir();
    let outPath = path.resolve(work, p.trim());
    if (!/\.(pce\.json|pce\.studio)$/i.test(outPath)) outPath += ".pce.json";
    saveInside(work, outPath);
    return { path: outPath, name: path.basename(outPath) };
  },

  saveEnvelope: async function (req) {
    try {
      fs.mkdirSync(path.dirname(req.path), { recursive: true });
      fs.writeFileSync(req.path, req.text);
    } catch (e) {
      agentTools.refuse("save-io", req.path + " could not be written: " +
                        agentTools.errorMessage(e));
    }
    return { path: req.path, name: path.basename(req.path) };
  },

  /* project_save's path rules (#163): a trailing separator or an EXISTING
   * folder is the unpacked route; any other name is one .pcestudio (the
   * extension is added, as toy_save adds .pce.json). */
  projectPath: async function (p) {
    const work = saveWorkdir();
    const raw = String(p == null ? "" : p).trim();
    let full = path.resolve(work, raw);
    const folder = /[\\/]$/.test(raw) ||
      (fs.existsSync(full) && fs.statSync(full).isDirectory());
    if (!folder && !/\.pcestudio$/i.test(full)) full += ".pcestudio";
    saveInside(work, full);
    return { path: full, name: path.basename(full), folder: folder };
  },

  /* project_save's write: the archive's bytes for the file route, each entry
   * as a file for the folder route. */
  writeProject: async function (req) {
    const base = req.path;
    if (req.folder) {
      const wrote = [];
      try {
        for (const e of (req.entries || [])) {
          const dest = entryPath(base, e.name);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, Buffer.from(e.bytes));
          wrote.push(e.name);
        }
      } catch (e) {
        if (e instanceof agentTools.Refusal) throw e;
        agentTools.refuse("save-io", base + " could not be written: " +
                          agentTools.errorMessage(e));
      }
      return { path: base, name: req.name, folder: true, files: wrote };
    }
    try {
      fs.mkdirSync(path.dirname(base), { recursive: true });
      fs.writeFileSync(base, Buffer.from(req.zip || []));
    } catch (e) {
      agentTools.refuse("save-io", base + " could not be written: " +
                        agentTools.errorMessage(e));
    }
    return { path: base, name: req.name, folder: false,
             files: (req.entries || []).map(function (e) { return e.name; }) };
  },

  /* project_open's read (#163): a folder is its entries, a .pcestudio its
   * bytes.  The parse is the core's (renderer/pce-project.js), so the
   * format's own refusals are the ones a bad file gets. */
  readProject: async function (p) {
    const work = saveWorkdir();
    const full = path.resolve(work, String(p == null ? "" : p).trim());
    openInside(work, full);
    if (!fs.existsSync(full)) {
      agentTools.refuse("open-path", JSON.stringify(full) +
                         " does not exist (the path is relative to " +
                         JSON.stringify(work) + ")");
    }
    if (fs.statSync(full).isDirectory()) {
      return { path: full, folder: true, entries: readProjectFolder(full) };
    }
    try {
      return { path: full, folder: false, bytes: fs.readFileSync(full) };
    } catch (e) {
      agentTools.refuse("open-path", full + " could not be read: " +
                        agentTools.errorMessage(e));
    }
  },

  /* project.json's created/modified: the format never reads the clock. */
  now: function () { return new Date().toISOString(); },

  /* export_pce's write: the core built the .pce bytes; this side only picks
   * the path and writes it.  A failed write throws the file system's own
   * error and the core wraps it (errorCode), as it always did. */
  writeRom: async function (req) {
    const outPath = req.out
      ? path.resolve(String(req.out))
      : path.join(os.tmpdir(), "pce-mcp", req.name + ".pce");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, Buffer.from(req.bytes));
    return { path: outPath };
  }
};

/* ---- the session (the tools are the core's) ----------------------------- */

const session = agentTools.createSession(host);
const TOOLS = session.tools;
const TOOL_BY_NAME = {};
for (const t of TOOLS) TOOL_BY_NAME[t.name] = t;

/* ---- the MCP wire -------------------------------------------------------- */

const INSTRUCTIONS =
  "PCEStudio's toy engine. Write a toy with toy_write, add art with " +
  "source_add (a PNG or pixel grid becomes tiles, sprites, a tilesheet or " +
  "a palette, merged into the toy's asset files; a .mid becomes song.json), " +
  "compose music with song_write or add a .mid with source_add kind song, " +
  "run it with toy_run (its sound report says what each PSG channel played), " +
  "look with frame_png, read or poke registers with registers_get/" +
  "register_set, check it with validate, save the whole toy for the studio " +
  "with toy_save (one .pce.json the person opens with Open… → From file), " +
  "save or resume a whole project over sessions with project_save/" +
  "project_open (project_open answers with NOTES.md's text first — read it " +
  "before anything else, and pass the updated NOTES.md to project_save), " +
  "export a .pce with export_pce, and read the toy language with docs. " +
  "Every tool wraps the same modules the studio and the tests use; there is " +
  "no second model.";

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function resultMessage(id, result) {
  return { jsonrpc: "2.0", id: id, result: result };
}

function errorMessage_(id, code, message, data) {
  const err = { code: code, message: message };
  if (data !== undefined) err.data = data;
  return { jsonrpc: "2.0", id: id, error: err };
}

/* rpcError writes one error immediately (the parse-error path, outside a
 * request); handleMessage returns its reply so a batch can be answered as
 * one JSON array. */
function rpcError(id, code, message, data) {
  send(errorMessage_(id, code, message, data));
}

function initialise(params) {
  const asked = params && params.protocolVersion;
  const version = SUPPORTED_PROTOCOLS.indexOf(asked) >= 0 ? asked
                                                        : DEFAULT_PROTOCOL;
  return {
    protocolVersion: version,
    capabilities: { tools: { listChanged: false } },
    serverInfo: SERVER_INFO,
    instructions: INSTRUCTIONS
  };
}

/* handleMessage is async: the tool call runs in the core, where the PNG
 * steps and the writes may be a Promise (they are not, on this side — the
 * Node host is synchronous — but the same wire code must not care). */
async function handleMessage(msg) {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
    return errorMessage_(null, -32600, "invalid request: expected one JSON-RPC object");
  }
  const hasId = Object.prototype.hasOwnProperty.call(msg, "id");
  const id = hasId ? msg.id : null;
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return hasId ? errorMessage_(id, -32600, "invalid request") : null;
  }
  const params = msg.params || {};

  /* notifications have no id and must not be answered */
  if (!hasId) return null;

  switch (msg.method) {
  case "initialize":
    return resultMessage(id, initialise(params));
  case "ping":
    return resultMessage(id, {});
  case "tools/list":
    return resultMessage(id, { tools: TOOLS });
  case "tools/call": {
    if (typeof params.name !== "string") {
      return errorMessage_(id, -32602, "tools/call needs a tool name");
    }
    if (!TOOL_BY_NAME[params.name]) {
      return errorMessage_(id, -32602,
                           "unknown tool " + JSON.stringify(params.name));
    }
    return resultMessage(id, await session.call(params.name,
                                                params.arguments || {}));
  }
  default:
    return errorMessage_(id, -32601, "method not found: " + msg.method);
  }
}

async function answer(msg) {
  if (Array.isArray(msg)) {
    if (!msg.length) return errorMessage_(null, -32600, "empty batch");
    const replies = [];
    for (const one of msg) {
      const reply = await handleMessage(one);
      if (reply) replies.push(reply);
    }
    return replies.length ? replies : null;
  }
  return handleMessage(msg);
}

function main() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", async function (line) {
    const text = line.trim();
    if (!text) return;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch (e) {
      rpcError(null, -32700, "parse error: " + agentTools.errorMessage(e));
      return;
    }
    const reply = await answer(msg);
    if (reply) send(reply);
  });
}

/* Only listen when run as the server, so a test can require this file for
 * its tool table without stealing stdin. */
if (require.main === module) {
  main();
  process.stdin.on("end", function () { process.exit(0); });
}

module.exports = {
  TOOLS: TOOLS,
  TOOL_BY_NAME: TOOL_BY_NAME,
  session: session,
  SERVER_INFO: SERVER_INFO,
  PROTOCOL_VERSION: DEFAULT_PROTOCOL
};
