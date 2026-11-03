#!/usr/bin/env node
/*
 * tests/check-asm-project.js — card #230's evidence: an assembly project.
 *
 * An assembly project is a file set with .s/.asm sources and .inc includes,
 * no main.lua, and no ROM yet.  It is saved as a .pcestudio whose project.json
 * says kind "assembly", it assembles with the SAME wrapper the studio runs
 * (renderer/pce-asm.js, PCEAS 3.23 in WebAssembly), and the MCP tools
 * (file_read, file_write, asm_build) read and write it over stdio.
 *
 *   1. the project format: build -> parse round-trips an assembly project
 *      (main.asm, lib.inc, NOTES.md) with kind "assembly" and every source
 *      byte-identical; a toy still refuses without main.lua, and an assembly
 *      project without a .s/.asm refuses with the format's own code;
 *   2. renderer/pce-asm.js's project helpers: entryName picks main.asm then
 *      main.s then the first source; bankSizes reads bytes per bank from a
 *      real listing and does not count a source word like `adc` as bytes;
 *   3. the MCP server over stdio: file_write builds the project, file_read
 *      reads it back, asm_build reports the error's file, line and message,
 *      a fixed file assembles, and its sha256 and bytes equal a direct
 *      renderer/pce-asm.js assembly of the same inputs;
 *   4. project_save / project_open: the saved .pcestudio carries kind
 *      "assembly" and NOTES.md, a new session opens it, and asm_build there
 *      returns the same bytes (sha256) — the save/open round trip.
 *
 * The studio half — the editor tab per file, the gutter marking the error's
 * line, the listing and the bytes-per-bank readout, the fixed file
 * assembling, and the page's own save/open — is tests/check-studio.js's
 * checkAssemblyProject().
 *
 *   node tests/check-asm-project.js
 *
 * Written by @design because the card names this test.  Rule 2: a cold break
 * by another seat is owed before the card closes.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const zip = require(path.join(ROOT, "renderer", "pce-zip.js"));
const P = require(path.join(ROOT, "renderer", "pce-project.js"));
const asm = require(path.join(ROOT, "renderer", "pce-asm.js"));

let checks = 0;
const failures = [];
function check(ok, name) {
  checks++;
  if (!ok) { failures.push(name); console.log("FAIL  " + name); }
  else console.log("ok    " + name);
}
function eq(name, got, want) {
  check(JSON.stringify(got) === JSON.stringify(want),
        name + " (got " + JSON.stringify(got) + ", want " +
        JSON.stringify(want) + ")");
}

const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(),
                                    "check-asm-project-"));
function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); }
  catch (e) { /* leave it */ }
}

const GOOD = [
  "\t.code",
  "\t.bank 0",
  "\t.org $E000",
  "\t.include \"lib.inc\"",
  "start:",
  "\tlda #VALUE",
  "\tsta $0000",
  "\trts",
  "\t.org $FFF6",
  "\t.dw start, start, start, start, start",
  ""
].join("\n");
const LIB = "VALUE = $12\n";
const BROKEN = GOOD.replace("\tlda #VALUE", "\tlda #$GG");

/* ---- 1. the project format -------------------------------------------- */
function checkProjectFormat() {
  const project = {
    kind: P.KIND_ASSEMBLY,
    title: "asm demo",
    author: "",
    created: "2026-11-03T00:00:00.000Z",
    modified: "2026-11-03T00:00:00.000Z",
    files: [
      { name: "main.asm", source: GOOD },
      { name: "lib.inc", source: LIB },
      { name: "NOTES.md", source: "# asm demo\n\n## Goal\nassemble\n" }
    ],
    art: [],
    versions: []
  };
  const bytes = P.build(project);
  const back = P.parseBytes(bytes);
  eq("1. an assembly project reads back as kind assembly",
     back.kind, "assembly");
  eq("1. no main.lua is required and every file comes back",
     back.files.map((f) => f.name + ":" + f.kind),
     ["main.asm:asm", "lib.inc:inc", "NOTES.md:notes"]);
  const before = {};
  for (const f of project.files) before[f.name] = f.source;
  let same = back.files.length === project.files.length;
  for (const f of back.files) if (before[f.name] !== f.source) same = false;
  check(same, "1. every source and the notes are byte-identical after the round trip");
  check(back.notes === project.files[2].source,
        "1. NOTES.md is the project's resume note");

  const doc = JSON.parse(zip.utf8Decode(
    zip.read(bytes).filter((e) => e.name === "project.json")[0].bytes));
  eq("1. project.json says kind assembly", doc.kind, "assembly");

  let refused = null;
  try { P.build({ kind: P.KIND_ASSEMBLY, title: "x", files: [
    { name: "NOTES.md", source: "# x\n" }] }); }
  catch (e) { refused = e; }
  check(refused && refused.code === "project-code",
        "1. an assembly save with no .s/.asm refuses (project-code)");

  refused = null;
  const noSource = zip.write([
    { name: "project.json", bytes: zip.utf8Encode(JSON.stringify({
      format: P.FORMAT, kind: "assembly", title: "x", author: "",
      created: "", modified: "", files: [], art: [], versions: [] })) },
    { name: "NOTES.md", bytes: zip.utf8Encode("# x\n") }
  ]);
  try { P.parseBytes(noSource); } catch (e) { refused = e; }
  check(refused && refused.code === "project-asm",
        "1. an assembly archive with no source refuses (project-asm)");

  refused = null;
  try { P.build({ kind: P.KIND_TOY, title: "t", files: [
    { name: "main.asm", source: GOOD }] }); }
  catch (e) { refused = e; }
  check(refused && refused.code === "project-code",
        "1. a toy project still needs main.lua (project-code)");

  eq("1. assembly files are code, so the code tick keeps them",
     [P.groupOf({ name: "main.asm" }), P.groupOf({ name: "lib.inc" })],
     ["code", "code"]);
}

/* ---- 2. entryName and bankSizes --------------------------------------- */
function checkHelpers() {
  eq("2. main.asm is the entry by convention",
     asm.entryName(["NOTES.md", "lib.inc", "main.asm", "other.s"]), "main.asm");
  eq("2. main.s is next",
     asm.entryName(["lib.inc", "other.s", "main.s"]), "main.s");
  eq("2. then the first .s/.asm",
     asm.entryName(["NOTES.md", "z.inc", "first.s", "second.s"]), "first.s");

  const fixture = path.join(__dirname, "asm", "banks.asm");
  const r = asm.assemble(fs.readFileSync(fixture, "utf8"),
                         { filename: "banks.asm" });
  eq("2. bankSizes reads three banks",
     asm.bankSizes(r.listing).map((b) => [b.bank, b.bytes]),
     [[0, 3], [1, 8], [2, 6]]);
  check(asm.bankSizes(r.listing)[0].from === 0xE000 &&
        asm.bankSizes(r.listing)[0].to === 0xE003,
        "2. bankSizes carries each bank's address span");

  const adc = asm.assemble(
    "\t.code\n\t.bank 0\n\t.org $E000\nstart:\n\trts\n\t.org $F000\n" +
    "\tadc #$01\n", { filename: "main.asm" });
  eq("2. a source word that starts with hex letters is not counted as bytes",
     asm.bankSizes(adc.listing).map((b) => [b.bytes, b.from, b.to]),
     [[3, 0xE000, 0xF002]]);
}

/* ---- the stdio client -------------------------------------------------- */
function startServer(cwd) {
  const child = spawn(process.execPath,
    [path.join(ROOT, "tools", "mcp", "server.js")],
    { cwd: cwd, env: Object.assign({}, process.env, { PCE_MCP_WORKDIR: cwd }) });
  let buf = "", id = 0;
  const waiters = new Map();
  child.stdout.on("data", (d) => {
    buf += d.toString();
    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch (e) { continue; }
      const w = waiters.get(msg.id);
      if (w) { waiters.delete(msg.id); w(msg); }
    }
  });
  function request(method, params) {
    const mid = ++id;
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: mid,
                                       method: method, params: params }) + "\n");
    return new Promise((resolve) => waiters.set(mid, resolve));
  }
  return {
    async init() {
      await request("initialize", { protocolVersion: "2025-06-18",
                                    capabilities: {},
                                    clientInfo: { name: "check-asm-project",
                                                  version: "1" } });
    },
    async call(name, args) {
      const msg = await request("tools/call", { name: name,
                                                arguments: args || {} });
      const result = msg.result || {};
      const blocks = (result.content || []).map((b) => b.text || "");
      let body = {};
      try { body = JSON.parse(blocks.length ? blocks[blocks.length - 1] : "{}"); }
      catch (e) { body = { raw: blocks[0] || "" }; }
      return { isError: !!result.isError, body: body, blocks: blocks,
               result: result };
    },
    close() { try { child.kill(); } catch (e) { /* gone */ } }
  };
}

/* ---- 3 and 4: the MCP tools ------------------------------------------- */
async function checkMcp(work) {
  const server = startServer(work);
  try {
    await server.init();

    const list = await server.call("file_write", { name: "bad", source: 1 });
    check(list.isError, "3. file_write refuses a non-text source");

    let r = await server.call("file_write", { name: "main.asm", source: GOOD });
    check(!r.isError && r.body.ok, "3. file_write adds main.asm");
    eq("3. the file set with a source and no main.lua is an assembly project",
       r.body.project_kind, "assembly");
    r = await server.call("file_write", { name: "lib.inc", source: LIB });
    eq("3. file_write adds the include and the project stays assembly",
       r.body.project_kind, "assembly");

    r = await server.call("file_read", { name: "lib.inc" });
    check(!r.isError && r.body.source === LIB,
          "3. file_read returns the include exactly as written");
    r = await server.call("file_read", { name: "missing.asm" });
    check(r.isError && r.body.code === "file-missing",
          "3. file_read refuses a name the session does not hold");

    r = await server.call("file_write", { name: "main.asm", source: BROKEN });
    r = await server.call("asm_build", {});
    check(r.isError, "3. asm_build marks a syntax error as an error result");
    eq("3. the error names the file, the line and the message",
       r.body.errors.map((e) => [e.file, e.line, e.message]),
       [["main.asm", 6, "Syntax error in expression!"]]);
    eq("3. an error reply has no bytes", r.body.bytes, 0);
    check(r.body.sha256 == null, "3. ... and no sha256");

    r = await server.call("file_write", {
      name: "main.asm", source: GOOD });
    r = await server.call("file_write", {
      name: "lib.inc", source: LIB + "\tlda #$GG\n" });
    r = await server.call("asm_build", {});
    eq("3. an error in an included file names that file",
       r.body.errors.map((e) => [e.file, e.line]),
       [["lib.inc", 2]]);
    r = await server.call("file_write", { name: "lib.inc", source: LIB });

    r = await server.call("asm_build", {});
    check(!r.isError && r.body.ok, "3. a fixed file assembles");
    const built = r.body;
    check(built.bytes > 0 && typeof built.sha256 === "string",
          "3. the build returns a byte count and a sha256 (" +
          built.bytes + " B)");
    eq("3. bytes per bank come from the listing",
       built.banks.map((b) => [b.bank, b.bytes]), [[0, 16]]);
    check(/start/.test(built.sym), "3. the reply carries the symbol table");
    check(/start:/.test(built.listing), "3. the reply carries the listing");

    const direct = asm.assemble(GOOD, { filename: "main.asm",
                                        includes: { "lib.inc": LIB } });
    const crypto = require("crypto");
    const sha = crypto.createHash("sha256").update(direct.bytes).digest("hex");
    eq("3. asm_build's bytes equal a direct renderer/pce-asm.js assembly",
       built.bytes, direct.bytes.length);
    eq("3. ... byte for byte (sha256)", built.sha256, sha);

    /* 4. save and open the project through the MCP tools */
    r = await server.call("project_save", {
      path: "asm-demo.pcestudio",
      notes: "# asm demo\n\n## Goal\nassemble the demo\n" });
    check(!r.isError && r.body.ok && r.body.kind === "assembly",
          "4. project_save writes the assembly project");
    const saved = path.join(work, "asm-demo.pcestudio");
    check(fs.existsSync(saved), "4. the .pcestudio exists on disk");
    const entries = zip.read(fs.readFileSync(saved));
    const doc = JSON.parse(zip.utf8Decode(
      entries.filter((e) => e.name === "project.json")[0].bytes));
    eq("4. the saved project.json says kind assembly", doc.kind, "assembly");
    eq("4. the saved project carries the sources and the notes",
       entries.map((e) => e.name).sort(),
       ["NOTES.md", "lib.inc", "main.asm", "project.json"]);

    const second = startServer(work);
    try {
      await second.init();
      const openedReply = await second.call("project_open",
                                            { path: "asm-demo.pcestudio" });
      check(!openedReply.isError, "4. project_open loads the assembly project");
      check(/## Goal/.test(openedReply.blocks[0] || ""),
            "4. project_open answers with NOTES.md first");
      const opened = openedReply.body;
      check(opened.ok && opened.kind === "assembly",
            "4. the opened project says kind assembly");
      eq("4. the reopened project's files and entry are the saved ones",
         [opened.files, opened.entry],
         [["main.asm", "lib.inc", "NOTES.md"], "main.asm"]);
      const again = (await second.call("asm_build", {})).body;
      check(again.ok, "4. the reopened project assembles");
      eq("4. the reopened project returns the same bytes (sha256)",
         again.sha256, built.sha256);
      eq("4. ... and the same byte count", again.bytes, built.bytes);
    } finally { second.close(); }
  } finally { server.close(); }
}

async function main() {
  checkProjectFormat();
  checkHelpers();
  await checkMcp(TMP);
  cleanup();
  if (failures.length) {
    console.log("FAIL  " + failures.length + " of " + checks + " checks failed");
    process.exit(1);
  }
  console.log("PASS  " + checks + " checks: an assembly project round-trips " +
              "through .pcestudio, its error lines are right, a fixed file " +
              "assembles, and the MCP asm_build returns the same bytes");
}

main().catch((e) => {
  cleanup();
  console.log("FAIL  " + (e && e.stack ? e.stack : e));
  process.exit(1);
});
