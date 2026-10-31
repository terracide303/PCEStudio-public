#!/usr/bin/env node
"use strict";
/*
 * tools/relay/build-tools.js — generate tools/relay/tools.json, the
 * static tools/list the relay embeds (#165).
 *
 *   node tools/relay/build-tools.js [out.json]
 *
 * ONE source, no second model: the list comes from the tool core of
 * #166 — renderer/pce-agent-tools.js, the UMD module the Node MCP
 * server and the studio tab share (createSession(host).tools).  Until
 * #166 lands, the core is not in the tree, and the build falls back to
 * tools/mcp/server.js's TOOLS export — the exact list #166 must keep
 * byte-identical ("the tools/list JSON before and after is
 * byte-identical"), so the committed tools.json stays right either way.
 *
 * The written file is the definitions as tools/list serves them:
 * [{name, description, inputSchema}, ...], resolved — the inputSchema
 * constants (MAX_FRAMES, PAD_FIELDS, ...) are values by the time the
 * module exports them.  JSON.stringify resolves them; nothing is typed
 * twice.
 *
 * tests/check-relay.js holds this file to account: tools.json must
 * equal the core's list (SKIPped while the core is absent, compared
 * with server.js's list instead), and the relay serves tools.json
 * verbatim, so a tool change that skips this build turns a test red.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, "tools.json");

let tools = null;
let source = null;

try {
  const core = require(path.join(ROOT, "renderer", "pce-agent-tools.js"));
  const session = core.createSession({});
  if (session && Array.isArray(session.tools) && session.tools.length) {
    tools = session.tools;
    source = "renderer/pce-agent-tools.js (#166, the tool core)";
  }
} catch (e) {
  /* #166 has not landed: fall through to the interim source */
}

if (!tools) {
  const server = require(path.join(ROOT, "tools", "mcp", "server.js"));
  if (server.TOOLS && server.TOOLS.length) {
    tools = server.TOOLS;
    source = "tools/mcp/server.js (interim until #166 lands)";
    console.log("note: renderer/pce-agent-tools.js is not in this tree; " +
                "building from tools/mcp/server.js, whose list #166 keeps " +
                "byte-identical");
  }
}

if (!tools) {
  console.error("build-tools: no tool list — neither " +
                "renderer/pce-agent-tools.js nor tools/mcp/server.js " +
                "exports the tools");
  process.exit(1);
}

for (const t of tools) {
  if (!t || typeof t.name !== "string" || typeof t.description !== "string" ||
      !t.inputSchema || typeof t.inputSchema !== "object") {
    console.error("build-tools: a tool definition is missing name, " +
                  "description or inputSchema: " + JSON.stringify(t));
    process.exit(1);
  }
}

const text = JSON.stringify(tools, null, 2) + "\n";
fs.writeFileSync(OUT, text);
console.log("wrote " + tools.length + " tools from " + source +
            " -> " + path.relative(ROOT, OUT));
