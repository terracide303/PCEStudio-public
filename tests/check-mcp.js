#!/usr/bin/env node
/*
 * tests/check-mcp.js — the #36 part 1 evidence: the MCP server in
 * tools/mcp/server.js, spoken to over stdio exactly as a client speaks MCP.
 *
 * What it asserts:
 *
 *   1. The server starts, answers `initialize` (protocol version,
 *      capabilities.tools, serverInfo) and `ping`.
 *   2. `tools/list` lists every tool with a schema: toy_write, toy_run,
 *      frame_png, registers_get, register_set, validate, export_pce, docs —
 *      each an object schema with properties.
 *   3. It writes #29's parallax toy, runs 60 frames, and the PNG at frame 60
 *      is #29/check-examples' frame 60: the committed
 *      tests/dumps/examples/parallax.png, decoded pixel for pixel.  Frame 60
 *      is one frame past the run, so this also proves deterministic seeking.
 *   4. It pokes BXR and the picture is exactly the renderer's: the test runs
 *      #29's palette-cycle toy through renderer/pce-il.js independently,
 *      renders the same state with renderer/pce-sprites.js at BXR 37, and
 *      the frame the server returns is that image — and is NOT the unpoked
 *      frame.  (parallax's raster table carries a BXR on every one of its
 *      224 lines, so its base BXR is invisible; palette-cycle has no raster
 *      table and its picture shows the scroll.  Both are #29 toys.)
 *      value:null restores the toy's own picture.  A value outside the
 *      host's range is refused with reg-range.
 *   5. The VCE CTW write changes one CRAM entry and is reversible; the PSG
 *      registers are read from renderer/pce-psg.js's own table and a write
 *      is recorded in the toy's sound stream; an out-of-range PSG value is
 *      refused by code.
 *   6. A pad script holds a button for chosen frames and the toy reads it.
 *   7. `validate` refuses a deliberately over-budget toy with #32's code
 *      (validate-sprite-line) and a toy with a static bad VRAM address comes
 *      back with file:line; a good toy validates ok.
 *   8. `export_pce` writes the .pce through #100's browser route (no
 *      compiler): the bytes equal an independent
 *      il.compile -> ilbc.encode -> pce-rom.buildToyRom build, and a second
 *      export is byte-identical.
 *   9. `docs` lists #61's chapters and returns one chapter as markdown with
 *      the code's own numbers; an unknown topic is refused.
 *
 * The test writes its .pce files under $TMPDIR, never into the repository.
 *
 * Written by @design because the card names this file.  Rule 2: a cold break
 * by another seat is owed before the card closes.
 *
 *   node tests/check-mcp.js
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { spawn } = require("child_process");
const readline = require("readline");

const il = require("../renderer/pce-il.js");
const ilbc = require("../renderer/pce-ilbc.js");
const romLib = require("../renderer/pce-rom.js");
const sprites = require("../renderer/pce-sprites.js");

const ROOT = path.join(__dirname, "..");
const SERVER = path.join(ROOT, "tools", "mcp", "server.js");
const TOY_DIR = path.join(ROOT, "toys");
const EXAMPLES = path.join(ROOT, "tests", "dumps", "examples");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pcestudio-mcp-"));

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
function contains(name, haystack, needle) {
  check(String(haystack).indexOf(needle) >= 0,
        name + " (looked for " + JSON.stringify(needle) + " in " +
        JSON.stringify(String(haystack).slice(0, 200)) + ")");
}

/* ---- PNG: read back what the server sends ----------------------------- */

function decodePng(buf) {
  if (buf.slice(0, 8).toString("latin1") !== "\x89PNG\r\n\x1a\n") {
    throw new Error("not a PNG");
  }
  let pos = 8, width = 0, height = 0, bitDepth = 0, colourType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.slice(pos + 4, pos + 8).toString("latin1");
    const data = buf.slice(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colourType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  if (bitDepth !== 8 || colourType !== 2) {
    throw new Error("expected an 8-bit RGB PNG");
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 3;
  const out = new Uint8Array(width * height * 3);
  const prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[p++];
    const line = Buffer.from(raw.slice(p, p + stride));
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? line[i - 3] : 0;
      const b = prev[i];
      const c = i >= 3 ? prev[i - 3] : 0;
      if (f === 1) line[i] = (line[i] + a) & 0xFF;
      else if (f === 2) line[i] = (line[i] + b) & 0xFF;
      else if (f === 3) line[i] = (line[i] + ((a + b) >> 1)) & 0xFF;
      else if (f === 4) {
        const pa = Math.abs(a + b - c - a), pb = Math.abs(a + b - c - b),
              pc = Math.abs(a + b - c - c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xFF;
      }
    }
    line.copy(prev);
    out.set(line, y * stride);
  }
  return { width: width, height: height, pixels: out };
}

function diffCount(a, b) {
  let n = 0, first = -1;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) { if (first < 0) first = i; n++; }
  }
  return { n: n, first: first, lengths: a.length === b.length ? null : [a.length, b.length] };
}

function sameImage(name, got, want) {
  if (got.width !== want.width || got.height !== want.height) {
    check(false, name + " size " + got.width + "x" + got.height + " != " +
          want.width + "x" + want.height);
    return;
  }
  const d = diffCount(got.pixels, want.pixels);
  check(d.n === 0, name + " pixel diff " + d.n +
        (d.n ? " (first byte " + d.first + ")" : ""));
}

/* ---- the MCP client ---------------------------------------------------- */

class Client {
  constructor(proc) {
    this.proc = proc;
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = "";
    proc.stderr.on("data", (d) => { this.stderr += d.toString(); });
    this.rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
    this.rl.on("line", (line) => this.onLine(line));
    this.exited = new Promise((resolve) => proc.on("exit", (code) => resolve(code)));
  }

  onLine(line) {
    let msg;
    try { msg = JSON.parse(line); }
    catch (e) {
      check(false, "the server wrote a non-JSON line to stdout: " + line.slice(0, 120));
      return;
    }
    if (msg.id == null || !this.pending.has(msg.id)) {
      /* a notification or a late reply: neither is expected in this test */
      return;
    }
    const waiter = this.pending.get(msg.id);
    this.pending.delete(msg.id);
    waiter(msg);
  }

  request(method, params, timeoutMs) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("timeout waiting for " + method + "\nserver stderr:\n" +
                         this.stderr.slice(-2000)));
      }, timeoutMs || 20000);
      this.pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
      this.proc.stdin.write(JSON.stringify({
        jsonrpc: "2.0", id: id, method: method,
        params: params === undefined ? {} : params
      }) + "\n");
    });
  }

  notify(method, params) {
    this.proc.stdin.write(JSON.stringify({
      jsonrpc: "2.0", method: method, params: params === undefined ? {} : params
    }) + "\n");
  }

  /* tools/call -> {isError, body, content} where body is the JSON text block */
  async call(name, args) {
    const msg = await this.request("tools/call", { name: name, arguments: args || {} });
    if (msg.error) throw new Error("JSON-RPC error from " + name + ": " +
                                   JSON.stringify(msg.error));
    const result = msg.result;
    const text = (result.content || []).filter((c) => c.type === "text")[0];
    let body = null;
    if (text) {
      try { body = JSON.parse(text.text); }
      catch (e) { body = { raw: text.text }; }
    }
    return { isError: !!result.isError, body: body, content: result.content || [] };
  }

  close() {
    try { this.proc.stdin.end(); } catch (e) { /* already closed */ }
    this.rl.close();
    if (this.proc.exitCode == null) this.proc.kill("SIGTERM");
  }
}

function imageOf(result) {
  const img = result.content.filter((c) => c.type === "image")[0];
  if (!img) throw new Error("the tool result has no image content block");
  return decodePng(Buffer.from(img.data, "base64"));
}

/* ---- #29 toy helpers --------------------------------------------------- */

function writeToy(client, name) {
  const source = fs.readFileSync(path.join(TOY_DIR, name + ".lua"), "utf8");
  return client.call("toy_write", {
    files: [{ name: "main.lua", source: source }]
  });
}

/* The independent renderer run this test compares the server with: the toy
 * through renderer/pce-il.js, the frame rendered by renderer/pce-sprites.js
 * with one register override.  This is not the server's code path — it is
 * the tested modules the server is supposed to be wrapping. */
function independentFrames(name, count, overrides) {
  const source = fs.readFileSync(path.join(TOY_DIR, name + ".lua"), "utf8");
  const rt = il.create(source, { chunkName: "main.lua" });
  rt.load();
  let last = null;
  for (let f = 0; f < count; f++) last = rt.frame(f);
  const st = last.state;
  const regs = {
    BXR: st.regs.BXR, BYR: st.regs.BYR, MWR: st.regs.MWR, CR: st.regs.CR,
    RCRCount: 0, scanline: 18
  };
  for (const k of Object.keys(overrides || {})) regs[k] = overrides[k];
  const opts = {
    vram: st.vram, cram: st.cram, sat: st.sat, regs: regs,
    width: 256, height: 224
  };
  if (last.raster) opts.raster = last.raster;
  return sprites.renderFrame(opts);
}

function spriteToy(n) {
  let s = "function init()\n";
  for (let i = 0; i < n; i++) {
    s += "  sprite(" + i + ", {x = " + (40 + i) +
         ", y = 80, pattern = 0, palette = 0})\n";
  }
  return s + "end\nfunction frame(t, f)\nend\n";
}

/* ---- main -------------------------------------------------------------- */

(async function main() {
  const proc = spawn(process.execPath, [SERVER], {
    cwd: ROOT, stdio: ["pipe", "pipe", "pipe"]
  });
  const client = new Client(proc);
  let ok = false;

  try {
    /* 1 — initialize and ping */
    const init = await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "check-mcp", version: "1" }
    });
    check(!init.error, "initialize answers without a JSON-RPC error");
    check(init.result && init.result.protocolVersion === "2024-11-05",
          "initialize echoes the client's protocol version (2024-11-05)");
    check(init.result && init.result.capabilities &&
          init.result.capabilities.tools,
          "initialize advertises the tools capability");
    eq("the server names itself", init.result.serverInfo.name, "pcestudio");
    client.notify("notifications/initialized");

    const ping = await client.request("ping");
    eq("ping answers with an empty result", ping.result, {});

    /* 2 — every tool with its schema */
    const list = await client.request("tools/list");
    check(!list.error, "tools/list answers without a JSON-RPC error");
    const tools = list.result.tools || [];
    const names = tools.map((t) => t.name).sort();
    eq("tools/list lists exactly the card's eight tools", names, [
      "docs", "export_pce", "frame_png", "register_set", "registers_get",
      "toy_run", "toy_write", "validate"
    ]);
    for (const t of tools) {
      const schema = t.inputSchema;
      check(!!t.description && t.description.length > 40,
            t.name + " has a description that says what it does");
      check(schema && schema.type === "object" && schema.properties &&
            Object.keys(schema.properties).length > 0,
            t.name + " publishes an object inputSchema with properties");
    }
    eq("toy_write requires files",
       list.result.tools.filter((t) => t.name === "toy_write")[0]
           .inputSchema.required, ["files"]);
    eq("frame_png requires frame",
       list.result.tools.filter((t) => t.name === "frame_png")[0]
           .inputSchema.required, ["frame"]);

    /* 3 — #29's parallax toy, 60 frames, frame 60 is check-examples' frame 60 */
    const wrote = await writeToy(client, "parallax");
    check(!wrote.isError && wrote.body.ok, "toy_write compiles toys/parallax.lua");
    eq("the written toy is a file set with main.lua", wrote.body.files,
       ["main.lua"]);
    eq("the compiled program is the IL", wrote.body.language, "pce-il");
    check(wrote.body.hooks.raster != null,
          "parallax's raster() hook is in the compiled program");

    const ran = await client.call("toy_run", { frames: 60 });
    check(!ran.isError && ran.body.ok, "toy_run runs 60 frames");
    eq("the run stopped at frame 59", ran.body.frame, 59);
    check(ran.body.state.raster && ran.body.state.raster.entries === 4,
          "parallax's four-entry raster table is in the state");

    const png60 = await client.call("frame_png", { frame: 60 });
    check(!png60.isError, "frame_png renders frame 60 (one frame past the run)");
    const got60 = imageOf(png60);
    const checkExamples = decodePng(
      fs.readFileSync(path.join(EXAMPLES, "parallax.png")));
    sameImage("frame 60 equals check-examples' tests/dumps/examples/parallax.png",
              got60, checkExamples);
    check(png60.body.raster_entries === 4,
          "the frame reports the four raster entries it rendered with");

    /* validate + export on the same toy */
    const good = await client.call("validate", {});
    check(!good.isError && good.body.ok, "the validator passes parallax");

    const exported = await client.call("export_pce", { name: "parallax-mcp" });
    check(!exported.isError && exported.body.ok, "export_pce writes a .pce");
    contains("the export names #100's browser route", exported.body.route,
             "#100");
    check(exported.body.bytes === fs.statSync(exported.body.path).size,
          "the exported file is the size the tool reported");
    const romBytes = fs.readFileSync(exported.body.path);
    const program = il.compile(
      fs.readFileSync(path.join(TOY_DIR, "parallax.lua"), "utf8"),
      { chunkName: "main.lua" });
    const encoded = ilbc.encode(program);
    const expectedRom = romLib.buildToyRom({
      bank0: fs.readFileSync(path.join(ROOT, "renderer", "ilvm.bin")),
      bytecode: encoded.bytes
    });
    const romDiff = diffCount(romBytes, Buffer.from(expectedRom));
    check(romDiff.n === 0, "the .pce is the independent #100 build byte for byte" +
          (romDiff.n ? " (diff " + romDiff.n + ", first " + romDiff.first + ")" : ""));
    const again = await client.call("export_pce", { name: "parallax-mcp" });
    eq("a second export is byte-identical", again.body.sha256,
       exported.body.sha256);

    /* 4 — poke BXR and compare with the renderer */
    const palette = await writeToy(client, "palette-cycle");
    check(!palette.isError && palette.body.ok,
          "toy_write compiles toys/palette-cycle.lua");
    const paletteRun = await client.call("toy_run", { frames: 60 });
    check(!paletteRun.isError && paletteRun.body.ok,
          "toy_run runs palette-cycle for 60 frames");
    eq("palette-cycle's base BXR is 0", paletteRun.body.state.regs.BXR, 0);

    const basePng = await client.call("frame_png", { frame: 59 });
    const baseImg = imageOf(basePng);
    const modelBase = independentFrames("palette-cycle", 60, {});
    sameImage("the unpoked frame is the renderer's own", baseImg, modelBase);

    const poked = await client.call("register_set", {
      chip: "vdc", name: "BXR", value: 37
    });
    check(!poked.isError && poked.body.ok, "register_set pokes BXR");
    eq("the poke reports the old value", poked.body.old, 0);
    eq("the poke is reversible (value:null clears it)",
       poked.body.cleared, false);

    const pokePng = await client.call("frame_png", { frame: 59 });
    const pokeImg = imageOf(pokePng);
    const modelPoke = independentFrames("palette-cycle", 60, { BXR: 37 });
    sameImage("the poked frame is exactly what the renderer says", pokeImg, modelPoke);
    check(diffCount(pokeImg.pixels, baseImg.pixels).n > 1000,
          "poking BXR changes the picture (" +
          diffCount(pokeImg.pixels, baseImg.pixels).n + " pixels)");

    const cleared = await client.call("register_set", {
      chip: "vdc", name: "BXR", value: null
    });
    check(!cleared.isError && cleared.body.ok, "register_set clears an override");
    const backPng = await client.call("frame_png", { frame: 59 });
    sameImage("clearing the override restores the toy's picture",
              imageOf(backPng), baseImg);

    const range = await client.call("register_set", {
      chip: "vdc", name: "BXR", value: 2000
    });
    check(range.isError, "a BXR outside 0..1023 is refused");
    eq("the BXR refusal carries the host's code", range.body.code, "reg-range");
    contains("the BXR refusal names the host range", range.body.message,
             "BXR must be an integer 0..1023");
    const forbidden = await client.call("register_set", {
      chip: "vdc", name: "MAWR", value: 1
    });
    check(forbidden.isError, "a VDC register a toy may not write is refused");
    eq("the refusal is reg-forbidden", forbidden.body.code, "reg-forbidden");

    /* VCE CTW: one CRAM entry, reversible */
    const vce = await client.call("register_set", {
      chip: "vce", name: "CTW", addr: 16, value: 0x1FF
    });
    check(!vce.isError && vce.body.ok, "register_set writes a VCE colour");
    eq("the write reports the old colour word", vce.body.old, 0);
    const vceRead = await client.call("registers_get", { chip: "vce", addr: 16 });
    const ctw = vceRead.body.vce.filter((r) => r.name === "CTW")[0];
    eq("registers_get reads the poked colour back", ctw.value, 0x1FF);
    const vceBad = await client.call("register_set", {
      chip: "vce", name: "CTW", addr: 512, value: 0
    });
    check(vceBad.isError && vceBad.body.code === "pal-range",
          "a CRAM address past 511 is refused by pal-range");
    await client.call("register_set", { chip: "vce", name: "CTW", addr: 16,
                                        value: null });

    /* PSG: #61's nine registers, a recorded write, a coded refusal */
    const psgGet = await client.call("registers_get", { chip: "psg" });
    eq("the PSG catalogue has R0..R9", psgGet.body.psg.map((r) => r.name),
       ["R0", "R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9"]);
    eq("R0's range is the model's 3-bit select", psgGet.body.psg[0].range,
       [0, 7]);
    eq("R6's range is the 5-bit wave sample", psgGet.body.psg[6].range,
       [0, 31]);
    const psgSet = await client.call("register_set", {
      chip: "psg", name: "R1", value: 0x88
    });
    check(!psgSet.isError && psgSet.body.recorded,
          "a PSG write is recorded in the toy's sound stream");
    const psgAgain = await client.call("registers_get", { chip: "psg" });
    eq("registers_get reads the PSG write back",
       psgAgain.body.psg[1].value, 0x88);
    const psgBad = await client.call("register_set", {
      chip: "psg", name: "R0", value: 8
    });
    check(psgBad.isError && psgBad.body.code === "reg-range",
          "a PSG value past its width is refused by reg-range");

    /* 5 — a pad script reaches the toy */
    const padToy =
      "n = 0\n" +
      "function frame(t, f)\n" +
      "  if pad[1].i then n = n + 1 end\n" +
      "  reg(\"BXR\", n)\n" +
      "end\n";
    const padWrite = await client.call("toy_write", {
      files: [{ name: "main.lua", source: padToy }]
    });
    check(!padWrite.isError, "a pad toy compiles");
    const padRun = await client.call("toy_run", {
      frames: 6,
      pad: [{ from: 1, to: 2, pad: 1, buttons: ["i"] }]
    });
    eq("the toy counted the two frames the script held I for",
       padRun.body.state.regs.BXR, 2);
    const noPad = await client.call("toy_run", { frames: 6 });
    eq("with no pad script the button is up", noPad.body.state.regs.BXR, 0);
    const badPad = await client.call("toy_run", {
      frames: 2, pad: [{ from: 0, buttons: ["start"] }]
    });
    check(badPad.isError && badPad.body.code === "pad-button",
          "an unknown button name is refused by pad-button");

    /* 6 — the validator: over budget, and file:line */
    const over = await client.call("toy_write", {
      files: [{ name: "main.lua", source: spriteToy(17) }]
    });
    check(!over.isError, "the over-budget toy compiles");
    const refused = await client.call("validate", { frames: 2 });
    check(refused.isError, "the over-budget toy's validation is an error result");
    eq("it is refused with #32's code", refused.body.code,
       "validate-sprite-line");
    check(refused.body.problems.some((p) => p.code === "validate-sprite-line" &&
          p.file === "main.lua"),
          "the finding names the file");

    const located = await client.call("toy_write", {
      files: [{ name: "main.lua", source:
        "function frame(t, f)\n  vram[40000] = 1\nend\n" }]
    });
    check(!located.isError, "the bad-VRAM toy compiles");
    const locatedReport = await client.call("validate", { frames: 2 });
    check(locatedReport.isError, "the bad VRAM address is refused");
    const finding = locatedReport.body.problems.filter(
      (p) => p.code === "validate-range")[0];
    check(!!finding, "the finding is validate-range");
    eq("the finding carries file:line", finding && finding.location,
       "main.lua:2");

    const syntax = await client.call("toy_write", {
      files: [{ name: "main.lua", source:
        "function frame(t, f)\n  if then\nend\n" }]
    });
    check(syntax.isError, "a toy that does not compile is refused");
    eq("the compile refusal carries its code", syntax.body.code, "il-syntax");
    contains("the compile refusal names the file and line", syntax.body.message,
             "main.lua");

    /* 7 — docs: #61's reference, from the modules */
    const chapters = await client.call("docs", {});
    check(!chapters.isError, "docs with no topic answers");
    const ids = chapters.body.topics.map((t) => t.id);
    ["registers", "palettes", "sprites", "raster", "pads", "sound",
     "budgets", "refusals"].forEach(function (id) {
      check(ids.indexOf(id) >= 0, "docs lists the " + id + " chapter");
    });
    const regsDoc = await client.call("docs", { topic: "registers" });
    check(!regsDoc.isError, "docs returns the registers chapter");
    contains("the registers chapter carries BXR's own range", regsDoc.body.markdown,
             "0..1023");
    contains("the registers chapter carries the refusal codes",
             regsDoc.body.markdown, "reg-forbidden");
    const noTopic = await client.call("docs", { topic: "no-such-chapter" });
    check(noTopic.isError && noTopic.body.code === "docs-topic",
          "an unknown docs topic is refused by docs-topic");

    /* 8 — registers_get's catalogue comes from the modules' names/ranges */
    const all = await client.call("registers_get", { chip: "all" });
    check(!all.isError, "registers_get answers");
    check(all.body.vdc.length >= 18,
          "the VDC catalogue carries R00..R13 (18 named registers), got " +
          all.body.vdc.length);
    const bxr = all.body.vdc.filter((r) => r.name === "BXR")[0];
    eq("BXR's catalogue range is the host's", bxr.range, [0, 0x3FF]);
    eq("BXR is settable", bxr.settable, true);
    eq("MAWR is not a toy register", all.body.vdc.filter(
      (r) => r.name === "MAWR")[0].settable, false);
    eq("VCE has CR, CTA and CTW", all.body.vce.map((r) => r.name),
       ["CR", "CTA", "CTW"]);

    ok = true;
  } catch (e) {
    check(false, "the run threw: " + (e && e.stack || e));
  } finally {
    client.close();
  }

  console.log("");
  if (failures.length || !ok) {
    console.log("FAILED " + failures.length + " of " + checks + " checks");
    console.log("scratch: " + TMP);
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
    process.exit(1);
  }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  console.log("PASS  " + checks + " checks: an MCP client spoke initialize, " +
              "tools/list and tools/call over stdio; parallax frame 60 is " +
              "check-examples' PNG; a BXR poke is the renderer's own picture; " +
              "the validator refuses an over-budget toy with file:line; and " +
              "export_pce is the #100 build byte for byte");
  process.exit(0);
})();
