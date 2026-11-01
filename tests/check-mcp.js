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
 *      source_add, frame_png, registers_get, register_set, validate,
 *      export_pce, docs — each an object schema with properties.
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
 *  10. `source_add` (#153): a 16x16 PNG becomes a sprite through the Add
 *      Source importer and the toy's sat()/sprite() placement shows it at
 *      the right pixel (a control without the import is blank); a second
 *      add appends its pattern and takes a free palette row; the budget
 *      report carries the importer's stats and the merged picture's VRAM
 *      words; refused adds (a bad size, a bad grid, a toy whose asset files
 *      the panels cannot read) leave the toy alone.  A toy whose
 *      tiles.json/palettes.json name a checkerboard renders through MCP
 *      exactly the frame an independent il.create(source, {files}) +
 *      pce-sprites run renders (diff 0), and toy_run reports the #117
 *      import summary.
 *  11. Songs (#161): toys/oak-woods/song.json in toy_write's files is the
 *      runtime's options.songs, so music(0) plays it — PSG writes are
 *      recorded, every channel the compiled song uses starts notes (with its
 *      instrument), and the run matches an independent il.create(source,
 *      {songs}) run's write count — while the same toy WITHOUT the file is
 *      refused music-range, the card's control.  A .mid through source_add
 *      kind song becomes song.json through the Add Source importer and
 *      music(0) plays it; song_write composes from a step list with the
 *      SEQUENCER's built-in instruments; toy_write refuses a song file the
 *      model cannot compile and leaves the loaded toy alone.  The song
 *      written is the one the studio's own open path (pce-source.js
 *      importStudio) carries, and the SEQUENCER's read-back (pce-seq.js
 *      fromJSON) returns the same grid — so the saved toy opens in the
 *      studio with the song in the SEQUENCER.
 *  11. `toy_save` (#160): the loaded toy — main.lua, the art source_add
 *      made, the named source in sources.json — written as ONE
 *      pce.studio/1 envelope, the studio's own Save format (its key order,
 *      its two-space text and last newline); the studio's own open path
 *      (renderer/pce-source.js importStudio, then the host's import) reads
 *      the file and draws the frame the MCP run drew, diff 0; a control
 *      saved without the source opens and draws the sky where the saved toy
 *      draws its sprite.  A path outside the working folder (a relative
 *      climb or an absolute one) is refused with save-path and nothing is
 *      written; a second server started in another folder with nothing set
 *      saves into that folder, so the fence is the process's own.
 *  12. `project_save` / `project_open` (#163): session 1 writes a toy with
 *      source_add's art and a NOTES.md and saves it as a project — one
 *      .pcestudio file and, through a trailing /, the same layout unpacked
 *      into a folder (the route for Claude Code, so git holds the history);
 *      the studio's own project reader (renderer/pce-project.js parseBytes)
 *      opens the archive and draws the MCP run's frame, diff 0.  Session 2
 *      is a FRESH server process: project_open loads the file (and then the
 *      folder) and answers with NOTES.md's text as the reply's first block,
 *      and its run draws session 1's frame, diff 0.  A project without a
 *      NOTES.md gets the studio's template; a path outside the working
 *      folder (open-path), a missing project (open-path) and a ZIP that is
 *      not a project (project-format) are refused, and a refused open leaves
 *      the loaded toy alone.
 *
 * The test writes its .pce and .pce.json files under $TMPDIR (the server's
 * working folder is PCE_MCP_WORKDIR under it), never into the repository.
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
const seqLib = require("../renderer/pce-seq.js");
const sourceLib = require("../renderer/pce-source.js");
const projectLib = require("../renderer/pce-project.js");

const ROOT = path.join(__dirname, "..");
const SERVER = path.join(ROOT, "tools", "mcp", "server.js");
const TOY_DIR = path.join(ROOT, "toys");
const EXAMPLES = path.join(ROOT, "tests", "dumps", "examples");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pcestudio-mcp-"));
/* toy_save's working folder for this run: the server is started with
 * PCE_MCP_WORKDIR pointing here, so nothing is written into the checkout */
const WORK = path.join(TMP, "work");
fs.mkdirSync(WORK, { recursive: true });

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

/* ---- PNG: write one (source_add's input), independently of the server --- */

const CRC_TABLE = (function () {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function encodePng(rgb, width, height) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;                       /* colour type: RGB */
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < stride; x++) {
      raw[y * (stride + 1) + 1 + x] = rgb[y * stride + x];
    }
  }
  return Buffer.concat([
    Buffer.from("\x89PNG\r\n\x1a\n", "latin1"),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}
function solidPng(width, height, rgb) {
  const px = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    px[i * 3] = rgb[0]; px[i * 3 + 1] = rgb[1]; px[i * 3 + 2] = rgb[2];
  }
  return encodePng(px, width, height).toString("base64");
}

function pixelOf(img, x, y) {
  const o = (y * img.width + x) * 3;
  return [img.pixels[o], img.pixels[o + 1], img.pixels[o + 2]];
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

/* project_open answers with NOTES.md's text as the FIRST text block and the
 * JSON summary as the second, so the generic call() — which reads the first
 * text block as the body — does not fit.  This reads both. */
async function openProject(client, p) {
  const msg = await client.request("tools/call",
                                   { name: "project_open",
                                     arguments: { path: p } });
  const res = msg.result || {};
  const texts = (res.content || []).filter((c) => c.type === "text");
  if (res.isError) {
    let body = null;
    try { body = JSON.parse(texts[0].text); } catch (e) { body = null; }
    return { isError: true, head: null, body: body, content: res.content || [] };
  }
  let body = null;
  try { body = JSON.parse(texts[1] && texts[1].text); } catch (e) { body = null; }
  return { isError: false, head: texts[0] ? texts[0].text : null,
           body: body, content: res.content || [] };
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

/* The independent run this test compares the art import with: the same
 * file set through il.create with files (the #117 host path) and the frame
 * rendered by pce-sprites — not the server's code path. */
function independentArtFrames(files, count, overrides) {
  const main = files.filter((f) => f.name === "main.lua")[0];
  const rt = il.create(main.source, { chunkName: "main.lua", files: files });
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

/* The #153 test toys.  source_add's import already placed the sprite in the
 * SAT (the panels' own placement); the toy moves it with sat() and places a
 * copy with sprite(), reading the pattern's CG code back from the SAT's own
 * copy in VRAM at $7F00.  SAT Y 64 is display row 0 and SAT X 32 is display
 * column 0, so SAT (100, 100) is the pixel (68, 36). */
function movedSpriteToy() {
  return "function init()\n" +
         "  reg(\"CR\", 0xC0)\n" +
         "  pal(0, 7)\n" +
         "  sat(0, 0, 100)\n" +
         "  sat(0, 1, 100)\n" +
         "end\nfunction frame(t, f)\nend\n";
}
function placedSpritesToy() {
  return "function init()\n" +
         "  reg(\"CR\", 0xC0)\n" +
         "  pal(0, 7)\n" +
         "  sat(0, 0, 100)\n" +
         "  sat(0, 1, 100)\n" +
         "  sat(1, 0, 100)\n" +
         "  sat(1, 1, 140)\n" +
         "  local code = vram[0x7F00 + 2] // 2\n" +
         "  sprite(2, { x = 180, y = 100, pattern = code, palette = 0 })\n" +
         "end\nfunction frame(t, f)\nend\n";
}

/* A checkerboard tiles.json + palettes.json the panels' readers accept:
 * two tiles ($40 red, $41 white) over the 32x32 BAT. */
function checkerFiles() {
  const row0 = new Array(16).fill(0);
  row0[1] = 56;                      /* vce 56: [252, 0, 0] */
  row0[2] = 511;                     /* vce 511: [252, 252, 252] */
  const cells = new Array(1024);
  for (let i = 0; i < 1024; i++) {
    cells[i] = (Math.floor(i / 32) + i) % 2 ? 64 : 65;
  }
  return [
    { name: "tiles.json", source: JSON.stringify({
      version: 1, video: 256,
      tiles: [{ char: 64, palette: 0, pixels: new Array(64).fill(1) },
              { char: 65, palette: 0, pixels: new Array(64).fill(2) }],
      map: { mwr: 0, bxr: 0, byr: 0, cells: cells }
    }, null, 2) + "\n" },
    { name: "palettes.json", source: JSON.stringify({
      version: 1, backdrop: 0, background: [row0], sprites: []
    }, null, 2) + "\n" }
  ];
}
function checkerCell(cells, x, y) {
  return cells[Math.floor(y / 8) * 32 + Math.floor(x / 8)];
}

/* ---- #161 song helpers ------------------------------------------------- */

/* A toy whose only sound is its song slot: music(0) in init(), silence in
 * frame().  With no song file it is exactly the card's failing case. */
function musicToy() {
  return "function init()\n  music(0)\nend\n" +
         "function frame(t, f)\nend\n";
}

/* A Standard MIDI File, format 0, 480 ticks a quarter, 120 BPM — the same
 * builder tests/check-source-import.js uses for the importer. */
function makeMidi(notes) {
  const track = [];
  const push = (...bytes) => { for (const b of bytes) track.push(b & 0xFF); };
  const varInt = (v) => {
    const out = [v & 0x7F];
    v >>>= 7;
    while (v) { out.unshift((v & 0x7F) | 0x80); v >>>= 7; }
    return out;
  };
  push(0x00, 0xFF, 0x51, 0x03, 0x07, 0xA1, 0x20);   /* 120 BPM */
  push(0x00, 0xFF, 0x03, 0x04, 0x52, 0x49, 0x46, 0x46); /* "RIFF" */
  let tick = 0;
  const events = [];
  for (const n of notes) {
    events.push({ at: n.start, bytes: [0x90, n.note, 0x64] });
    events.push({ at: n.end, bytes: [0x80, n.note, 0x40] });
  }
  events.sort((a, b) => a.at - b.at);
  for (const e of events) {
    push(...varInt(e.at - tick));
    tick = e.at;
    push(...e.bytes);
  }
  push(0x00, 0xFF, 0x2F, 0x00);
  const header = Buffer.alloc(14);
  header.write("MThd", 0, "latin1");
  header.writeUInt32BE(6, 4);
  header.writeUInt16BE(0, 8);       /* format 0 */
  header.writeUInt16BE(1, 10);      /* one track */
  header.writeUInt16BE(480, 12);    /* division */
  const len = Buffer.alloc(4);
  len.writeUInt32BE(track.length, 0);
  return Buffer.concat([header, Buffer.from("MTrk", "latin1"), len,
                        Buffer.from(track)]);
}

/* The channels a compiled song actually starts notes on — the test's own
 * reading of the player's module, so "all used channels active" is not the
 * server's word for it. */
function usedChannels(song) {
  const used = [];
  for (let ch = 0; ch < 6; ch++) {
    const orders = song.patterns[ch] || [];
    let on = false;
    for (const rows of orders)
      for (const row of rows)
        if (row.note && !row.note.cut) on = true;
    if (on) used.push(ch);
  }
  return used;
}

/* ---- main -------------------------------------------------------------- */

(async function main() {
  const proc = spawn(process.execPath, [SERVER], {
    cwd: ROOT, stdio: ["pipe", "pipe", "pipe"],
    env: Object.assign({}, process.env, { PCE_MCP_WORKDIR: WORK })
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
    eq("tools/list lists exactly the server's thirteen tools", names, [
      "docs", "export_pce", "frame_png", "project_open", "project_save",
      "register_set", "registers_get", "song_write", "source_add", "toy_run",
      "toy_save", "toy_write", "validate"
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
    eq("source_add requires kind",
       list.result.tools.filter((t) => t.name === "source_add")[0]
           .inputSchema.required, ["kind"]);
    eq("toy_save requires path",
       list.result.tools.filter((t) => t.name === "toy_save")[0]
           .inputSchema.required, ["path"]);
    eq("project_save requires path",
       list.result.tools.filter((t) => t.name === "project_save")[0]
           .inputSchema.required, ["path"]);
    eq("project_save takes the updated NOTES.md as notes",
       list.result.tools.filter((t) => t.name === "project_save")[0]
           .inputSchema.properties.notes.type, "string");
    eq("project_open requires path",
       list.result.tools.filter((t) => t.name === "project_open")[0]
           .inputSchema.required, ["path"]);
    eq("source_add's kinds are the picture kinds and song",
       list.result.tools.filter((t) => t.name === "source_add")[0]
           .inputSchema.properties.kind.enum,
       ["bg", "sprites", "tilesheet", "palette", "song"]);
    eq("song_write publishes notes and song",
       list.result.tools.filter((t) => t.name === "song_write")[0]
           .inputSchema.properties.notes.type, "array");
    eq("source_add documents the .mid input",
       list.result.tools.filter((t) => t.name === "source_add")[0]
           .inputSchema.properties.mid.type, "string");

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

    /* 9 — the toy's art (#153): a PNG becomes sprites through source_add */

    const redPng = solidPng(16, 16, [252, 0, 0]);
    const whitePng = solidPng(16, 16, [252, 252, 252]);

    const artToy = await client.call("toy_write", {
      files: [{ name: "main.lua", source: movedSpriteToy() }]
    });
    check(!artToy.isError && artToy.body.ok, "the sprite-mover toy compiles");

    /* the control: the same toy without the import shows no sprite */
    const controlRun = await client.call("toy_run", { frames: 1 });
    check(!controlRun.isError && controlRun.body.ok, "the control toy runs");
    const controlPng = await client.call("frame_png", { frame: 0 });
    eq("without the import the sprite's pixel is the sky",
       pixelOf(imageOf(controlPng), 68, 36), [0, 0, 252]);

    const added = await client.call("source_add", {
      kind: "sprites", name: "red-square", png: redPng
    });
    check(!added.isError && added.body.ok, "source_add imports the PNG as sprites");
    eq("the report names the kind", added.body.kind, "sprites");
    eq("the report names the source", added.body.name, "red-square");
    eq("the importer's stats: one 16x16 pattern", added.body.stats.tiles, 1);
    eq("one sprite palette row", added.body.stats.palettes, 1);
    eq("two colours (entry 0 is the transparent zero)", added.body.stats.colours, 2);
    eq("the toy's files now carry the sprite",
       added.body.files.slice().sort(),
       ["main.lua", "palettes.json", "sprites.json"]);
    eq("the budget counts the placed sprite", added.body.budget.sprites, 1);
    eq("one pattern packed after the blank tile", added.body.budget.patterns, 1);
    eq("VRAM words: BAT + blank tile + pattern cell + SAT",
       added.body.budget.vram_words, 1024 + 16 + 64 + 256);
    eq("the budget names the VRAM total", added.body.budget.vram_total, 32768);
    eq("no warnings", added.body.warnings, []);

    const artRun = await client.call("toy_run", { frames: 1 });
    check(!artRun.isError && artRun.body.ok, "the toy runs with the import");
    eq("toy_run reports the #117 import summary", artRun.body.assets && {
      files: artRun.body.assets.files,
      tiles: artRun.body.assets.tiles,
      patterns: artRun.body.assets.patterns,
      sprites: artRun.body.assets.sprites
    }, { files: ["tiles.json", "palettes.json", "sprites.json"],
         tiles: 1, patterns: 1, sprites: 1 });
    const artPng = await client.call("frame_png", { frame: 0 });
    eq("the imported sprite's pixel is the PNG's red",
       pixelOf(imageOf(artPng), 68, 36), [252, 0, 0]);
    eq("the pixel left of the sprite is still the sky",
       pixelOf(imageOf(artPng), 67, 36), [0, 0, 252]);

    /* a second add appends its pattern and takes a free palette row */
    const placed = await client.call("toy_write", {
      files: [{ name: "main.lua", source: placedSpritesToy() }]
    });
    check(!placed.isError && placed.body.ok, "the placer toy compiles");
    const first = await client.call("source_add", {
      kind: "sprites", name: "red-square", png: redPng
    });
    check(!first.isError && first.body.ok, "the first sprite is added");
    const second = await client.call("source_add", {
      kind: "sprites", name: "white-square", png: whitePng
    });
    check(!second.isError && second.body.ok, "the second sprite appends");
    eq("two sprites are placed now", second.body.budget.sprites, 2);
    eq("two patterns are packed now", second.body.budget.patterns, 2);
    eq("the file set still has one of each",
       second.body.files.slice().sort(),
       ["main.lua", "palettes.json", "sprites.json"]);
    const bothRun = await client.call("toy_run", { frames: 1 });
    check(!bothRun.isError && bothRun.body.ok, "the two-sprite toy runs");
    const bothPng = await client.call("frame_png", { frame: 0 });
    eq("the first sprite is still the red square",
       pixelOf(imageOf(bothPng), 68, 36), [252, 0, 0]);
    eq("the appended sprite draws its own pattern in its own palette row",
       pixelOf(imageOf(bothPng), 108, 36), [252, 252, 252]);
    eq("sprite() places a copy by the code the SAT's VRAM copy carries",
       pixelOf(imageOf(bothPng), 148, 36), [252, 0, 0]);

    /* refused adds leave the toy alone */
    const badSize = await client.call("source_add", {
      kind: "sprites", png: redPng, size: [20, 20]
    });
    check(badSize.isError, "a sprite size the VDC cannot draw is refused");
    eq("the refusal carries the importer's code", badSize.body.code,
       "source-size");
    const afterRefusal = await client.call("toy_run", { frames: 1 });
    eq("the refused add changed nothing: two sprites still placed",
       afterRefusal.body.assets.sprites, 2);
    const badGrid = await client.call("source_add", {
      kind: "bg", grid: { width: 2, height: 2, pixels: [0, 0, 1, 2] },
      palette: [[252, 0, 0], [0, 252, 0]]
    });
    check(badGrid.isError && badGrid.body.code === "source-grid",
          "a grid pixel past its palette is refused by source-grid");
    const bothKinds = await client.call("source_add", {
      kind: "sprites", png: redPng,
      grid: { width: 1, height: 1, pixels: [0] },
      palette: [[0, 0, 0]]
    });
    check(bothKinds.isError && bothKinds.body.code === "source-picture",
          "passing png and grid both is refused by source-picture");
    const badSong = await client.call("source_add", {
      kind: "song", png: redPng
    });
    check(badSong.isError && badSong.body.code === "source-song",
          "a song add without its .mid is refused by source-song");
    const badKind = await client.call("source_add", {
      kind: "movie", png: redPng
    });
    check(badKind.isError && badKind.body.code === "source-kind",
          "a kind that is not a source is refused by source-kind");

    /* a toy whose asset files the panels cannot read: source_add refuses
     * with the panels' own code and leaves the files alone */
    const broken = await client.call("toy_write", {
      files: [
        { name: "main.lua", source: movedSpriteToy() },
        { name: "palettes.json", source: "not json {{{" }
      ]
    });
    check(!broken.isError, "a toy with a broken palettes.json writes");
    const brokenAdd = await client.call("source_add", {
      kind: "sprites", png: redPng
    });
    check(brokenAdd.isError, "an add into a toy the panels cannot read is refused");
    eq("the refusal is the panels' own code", brokenAdd.body.code, "asset-json");
    const brokenRun = await client.call("toy_run", { frames: 1 });
    check(brokenRun.isError && brokenRun.body.code === "asset-json",
          "toy_run's import refuses the same broken file by the same code");

    /* tiles.json through MCP is the studio host's own frame, diff 0 */
    const checker = checkerFiles();
    const checkerMain = { name: "main.lua",
                          source: "function init()\nend\nfunction frame(t, f)\nend\n" };
    const checkerToy = await client.call("toy_write", {
      files: [checkerMain].concat(checker)
    });
    check(!checkerToy.isError && checkerToy.body.ok,
          "the checkerboard toy writes");
    const checkerRun = await client.call("toy_run", { frames: 1 });
    check(!checkerRun.isError && checkerRun.body.ok, "the checkerboard runs");
    eq("toy_run reports the import: two tiles, no sprites",
       checkerRun.body.assets && {
         tiles: checkerRun.body.assets.tiles,
         patterns: checkerRun.body.assets.patterns,
         sprites: checkerRun.body.assets.sprites
       }, { tiles: 2, patterns: 0, sprites: 0 });
    const checkerPng = await client.call("frame_png", { frame: 0 });
    const checkerImg = imageOf(checkerPng);
    const model = independentArtFrames([checkerMain].concat(checker), 1, {});
    sameImage("the MCP frame is the studio host's own frame (diff 0)",
              checkerImg, model);
    const cells = JSON.parse(checker[0].source).map.cells;
    const checkerColour = (x, y) =>
      checkerCell(cells, x, y) === 64 ? [252, 0, 0] : [252, 252, 252];
    eq("the checkerboard's first cell draws its tile",
       pixelOf(checkerImg, 4, 4), checkerColour(4, 4));
    eq("the next cell draws the other tile",
       pixelOf(checkerImg, 12, 4), checkerColour(12, 4));

    /* 10 — songs (#161): a toy's song.json is its music(0) */

    const oakMain = fs.readFileSync(path.join(TOY_DIR, "oak-woods", "main.lua"),
                                    "utf8");
    const oakSongText = fs.readFileSync(
      path.join(TOY_DIR, "oak-woods", "song.json"), "utf8");
    const oakFiles = [{ name: "main.lua", source: oakMain },
                      { name: "song.json", source: oakSongText }];

    /* the card's control: the same toy WITHOUT its song file is refused
     * music-range — that was the bug #161 fixes */
    const noSong = await client.call("toy_write", {
      files: [{ name: "main.lua", source: oakMain }]
    });
    check(!noSong.isError, "OAK WOODS without its song.json still compiles");
    const noSongRun = await client.call("toy_run", { frames: 60 });
    check(noSongRun.isError,
          "without a song file music(0) is refused (the card's control)");
    eq("the control's refusal is the runtime's music-range",
       noSongRun.body.code, "music-range");
    contains("... and it names options.songs", noSongRun.body.message,
             "options.songs");

    const oakWrite = await client.call("toy_write", { files: oakFiles });
    check(!oakWrite.isError && oakWrite.body.ok,
          "OAK WOODS' song.json writes with the toy");
    eq("toy_write reports the song slot",
       oakWrite.body.songs.map((s) => s.name), ["Oak Woods"]);

    const oakRun = await client.call("toy_run", { frames: 60 });
    check(!oakRun.isError && oakRun.body.ok, "OAK WOODS runs 60 frames");
    check(oakRun.body.sound_writes > 0,
          "the song writes the PSG (" + oakRun.body.sound_writes + " writes)");
    eq("the runtime was given one song", oakRun.body.sound.songs, 1);
    eq("music(0) is playing the toy's own song", {
      index: oakRun.body.sound.music.index,
      name: oakRun.body.sound.music.name,
      playing: oakRun.body.sound.music.playing
    }, { index: 0, name: "Oak Woods", playing: true });

    /* "all used channels active": the used channels are the test's own
     * reading of the compiled song, not the server's report */
    const oakCompiled = seqLib.songsFromFiles(oakFiles)[0];
    const oakUsed = usedChannels(oakCompiled);
    check(oakUsed.length >= 3,
          "OAK WOODS' song uses at least three PSG channels (" +
          oakUsed.join(", ") + ")");
    const oakNames = oakCompiled.instruments.map((i) => i.name);
    for (const ch of oakUsed) {
      const row = oakRun.body.sound.channels[ch];
      check(row.notes > 0,
            "used channel " + ch + " started notes (" + row.notes + ")");
      check(oakNames.indexOf(row.instrument) >= 0,
            "channel " + ch + " reports the instrument it sounds with (" +
            row.instrument + ")");
    }
    for (const ch of [0, 1, 2, 3, 4, 5]) {
      if (oakUsed.indexOf(ch) >= 0) continue;
      eq("unused channel " + ch + " started no notes",
         oakRun.body.sound.channels[ch].notes, 0);
    }
    eq("the per-channel counts are every note the player started",
       oakRun.body.sound.channels.reduce((n, c) => n + c.notes, 0),
       oakRun.body.sound.music.notes);

    /* the wiring, not the engine: an independent il.create with the same
     * songs is the run the server must be — 60 frames, same writes, same
     * channel counts */
    const indSongs = seqLib.songsFromFiles(oakFiles);
    const indRt = il.create(oakMain, { chunkName: "main.lua", files: oakFiles,
                                       songs: indSongs });
    indRt.load();
    for (let f = 0; f < 60; f++) indRt.frame(f);
    eq("the run is the independent il.create(songs) run's write count",
       oakRun.body.sound_writes, indRt.sound.events.length);
    eq("... and its per-channel note starts",
       oakRun.body.sound.channels.map((c) => c.notes),
       [0, 1, 2, 3, 4, 5].map((ch) => indRt.sound.player.notes
         .filter((n) => n.channel === ch).length));

    /* a .mid through source_add is the toy's song.json, and music(0) plays
     * it — the Add Source importer, then the player */
    const midiNotes = [{ start: 0, end: 240, note: 60 },
                       { start: 240, end: 480, note: 64 },
                       { start: 480, end: 720, note: 67 },
                       { start: 720, end: 960, note: 72 }];
    const midi = makeMidi(midiNotes);
    const midToy = await client.call("toy_write", {
      files: [{ name: "main.lua", source: musicToy() }]
    });
    check(!midToy.isError, "the music-only toy compiles with no song yet");
    const fromMid = await client.call("source_add", {
      kind: "song", name: "four", mid: midi.toString("base64")
    });
    check(!fromMid.isError && fromMid.body.ok,
          "source_add kind song imports the .mid" +
          (fromMid.isError ? " (" + JSON.stringify(fromMid.body) + ")" : ""));
    eq("the report names the song", fromMid.body.name, "four");
    eq("the .mid becomes the toy's song.json",
       fromMid.body.files.slice().sort(), ["main.lua", "song.json"]);
    eq("the importer placed the .mid's four notes", fromMid.body.notes, 4);
    const independentMidi = sourceLib.importMidi(midi, { name: "four" });
    eq("the song.json is the Add Source importer's own document",
       fromMid.body.song, JSON.parse(independentMidi.files["song.json"]));
    eq("it is music slot 0", fromMid.body.music_index, 0);

    const midRun = await client.call("toy_run", { frames: 120 });
    check(!midRun.isError && midRun.body.ok, "the .mid toy runs");
    check(midRun.body.sound_writes > 0,
          "the imported .mid writes the PSG (" + midRun.body.sound_writes +
          " writes)");
    eq("music(0) plays the imported .mid", midRun.body.sound.music && {
      index: midRun.body.sound.music.index,
      name: midRun.body.sound.music.name,
      playing: midRun.body.sound.music.playing
    }, { index: 0, name: "four", playing: true });
    const midCompiled = seqLib.songsFromFiles(
      [{ name: "song.json", source: JSON.stringify(fromMid.body.song) }])[0];
    for (const ch of usedChannels(midCompiled)) {
      check(midRun.body.sound.channels[ch].notes > 0,
            "the .mid's channel " + ch + " started notes");
    }

    /* a .mid the importer refuses leaves the toy's song alone */
    const badMid = await client.call("source_add", {
      kind: "song", mid: Buffer.from("not a midi file").toString("base64")
    });
    check(badMid.isError, "a .mid the importer cannot read is refused");
    eq("the refusal is the importer's mid-signature", badMid.body.code,
       "mid-signature");
    const afterBadMid = await client.call("toy_run", { frames: 120 });
    eq("the refused .mid left the toy's song playing",
       afterBadMid.body.sound.music.name, "four");

    /* song_write: compose from a step list with the SEQUENCER's built-in
     * instruments, then music(0) plays it */
    const composeToy = await client.call("toy_write", {
      files: [{ name: "main.lua", source: musicToy() }]
    });
    check(!composeToy.isError, "the toy for song_write compiles");
    const composed = await client.call("song_write", {
      name: "step tune", tempo: 140, steps: 16,
      notes: [
        { channel: 0, step: 0, note: "C4", length: 2 },
        { channel: 0, step: 4, note: "E4", length: 2 },
        { channel: 0, step: 8, note: "G4", length: 4 },
        { channel: 1, step: 0, note: "C3", length: 8, instrument: "bass" },
        { channel: 2, step: 4, note: "C5", length: 2, instrument: "bell" }
      ]
    });
    check(!composed.isError && composed.body.ok,
          "song_write composes from a step list" +
          (composed.isError ? " (" + JSON.stringify(composed.body) + ")" : ""));
    eq("it writes song.json", composed.body.file, "song.json");
    eq("the built-in instruments are the SEQUENCER's",
       composed.body.instruments,
       ["lead", "bass", "bell", "strings", "kick", "snare"]);
    eq("five notes are placed", composed.body.notes_placed, 5);
    const compRun = await client.call("toy_run", { frames: 120 });
    check(!compRun.isError && compRun.body.ok, "the composed toy runs");
    eq("music(0) plays the composed song", compRun.body.sound.music.name,
       "step tune");
    eq("channel 0 plays the lead", compRun.body.sound.channels[0].instrument,
       "lead");
    eq("channel 1 plays the bass", compRun.body.sound.channels[1].instrument,
       "bass");
    eq("channel 2 plays the bell the step list named",
       compRun.body.sound.channels[2].instrument, "bell");
    check(compRun.body.sound.channels[0].notes > 0 &&
          compRun.body.sound.channels[1].notes > 0 &&
          compRun.body.sound.channels[2].notes > 0,
          "the composed song starts notes on the three channels it names");

    /* the saved toy opens in the studio with the song in the SEQUENCER, and
     * toy_save (#160) is what keeps it: the whole session, songs included,
     * as the studio's own pce.studio/1 file.  Open it with the studio's own
     * path (renderer/pce-source.js importStudio), then read the song back
     * with the SEQUENCER panel's own function (pce-seq.js fromJSON). */
    const savedSong = await client.call("toy_save", {
      path: "step-tune.pce.json", title: "step tune"
    });
    check(!savedSong.isError && savedSong.body.ok,
          "toy_save writes the composed toy" +
          (savedSong.isError ? " (" + JSON.stringify(savedSong.body) + ")" : ""));
    check((savedSong.body.files || []).indexOf("song.json") >= 0,
          "the saved envelope carries song.json (" +
          (savedSong.body.files || []).join(", ") + ")");
    const savedSongText = fs.readFileSync(savedSong.body.path, "utf8");
    const openedSongFile = sourceLib.importStudio(savedSongText);
    eq("the studio's open path accepts the saved toy",
       openedSongFile.files.map((f) => f.name).sort(),
       ["main.lua", "song.json"]);
    const openedSongSource = openedSongFile.files.filter(
      (f) => f.name === "song.json")[0].source;
    eq("... and its song.json is the one song_write wrote, byte for byte",
       openedSongSource, JSON.stringify(composed.body.song, null, 2) + "\n");
    const savedSongs = seqLib.songsFromFiles(openedSongFile.files);
    eq("the opened toy carries one playable song slot", savedSongs.length, 1);
    const openedMainSource = openedSongFile.files.filter(
      (f) => f.name === "main.lua")[0].source;
    const savedRt = il.create(openedMainSource, { chunkName: "main.lua",
                                           files: openedSongFile.files,
                                           songs: savedSongs });
    savedRt.load();
    for (let f = 0; f < 120; f++) savedRt.frame(f);
    check(savedRt.sound.events.length > 0,
          "the studio's own runtime plays the opened toy's song (" +
          savedRt.sound.events.length + " writes)");
    const readBack = seqLib.fromJSON(openedSongSource);
    eq("the SEQUENCER reads the song back", readBack.name, "step tune");
    eq("... with the note the step list put first",
       readBack.patterns[0].channels[0][0],
       { note: 36, instrument: 0, length: 2 });
    eq("... and the same instruments",
       readBack.instruments.map((i) => i.name), composed.body.instruments);

    /* a song file the model cannot compile is refused at toy_write, and the
     * loaded toy — song and all — is left alone */
    const brokenSong = await client.call("toy_write", {
      files: [{ name: "main.lua", source: musicToy() },
              { name: "song.json", source: "not json {{{" }]
    });
    check(brokenSong.isError,
          "toy_write refuses a song.json the model cannot compile");
    eq("the refusal is the sequencer's seq-json", brokenSong.body.code,
       "seq-json");
    const afterRefusalSong = await client.call("toy_run", { frames: 120 });
    eq("the refused write left the loaded toy's song playing",
       afterRefusalSong.body.sound.music.name, "step tune");
    /* 11 — toy_save (#160): the studio's own file, with the art inside -----
     * The toy is the sprite-mover with its named source (sources.json,
     * #156) written beside it; the art comes from source_add.  toy_save
     * must hand over ONE pce.studio/1 envelope holding all three, and the
     * studio's own open path (renderer/pce-source.js importStudio, then the
     * host's import) must draw the frame the MCP run drew. */
    const savedMain = movedSpriteToy();
    const namedSources = JSON.stringify({
      version: 1,
      sources: [{ name: "red-square", kind: "sprites",
                  patterns: { first: 0, count: 1 },
                  sprites: { first: 0, count: 1 },
                  palettes: { side: "spr", first: 0, count: 1 } }]
    }, null, 2) + "\n";
    const saveToy = await client.call("toy_write", {
      files: [{ name: "main.lua", source: savedMain },
              { name: "sources.json", source: namedSources }]
    });
    check(!saveToy.isError && saveToy.body.ok,
          "the toy to save writes, with its named source");
    const saveAdd = await client.call("source_add", {
      kind: "sprites", name: "red-square", png: redPng
    });
    check(!saveAdd.isError && saveAdd.body.ok,
          "its sprite is added before the save");
    const saveRun = await client.call("toy_run", { frames: 1 });
    check(!saveRun.isError && saveRun.body.ok, "the toy runs before the save");
    const mcpPng = imageOf(await client.call("frame_png", { frame: 0 }));
    eq("the MCP run draws the sprite before the save",
       pixelOf(mcpPng, 68, 36), [252, 0, 0]);

    const saved = await client.call("toy_save", { path: "red-toy.pce.json" });
    check(!saved.isError && saved.body.ok, "toy_save writes the toy");
    const savedPath = path.join(WORK, "red-toy.pce.json");
    eq("the reply names the file inside the working folder",
       saved.body.path, savedPath);
    check(fs.existsSync(savedPath), "the saved file is on disk");
    const savedText = fs.existsSync(savedPath)
      ? fs.readFileSync(savedPath, "utf8") : "";
    eq("the reply's byte count is the file's", saved.body.bytes,
       Buffer.byteLength(savedText));
    let envDoc = null;
    try { envDoc = JSON.parse(savedText); } catch (e) { envDoc = null; }
    check(envDoc != null, "the saved file is JSON");
    eq("it is one pce.studio/1 envelope, not a second format",
       envDoc && envDoc.version, "pce.studio/1");
    eq("the envelope's keys are the studio's, in the studio's own order",
       envDoc && Object.keys(envDoc),
       ["version", "title", "description", "files", "sources"]);
    eq("binary sources stay empty, as the studio's Save writes them",
       envDoc && envDoc.sources, []);
    eq("the title comes from the file's own name", envDoc && envDoc.title,
       "red-toy");
    eq("every file is in the envelope — art, named source, code",
       envDoc && envDoc.files.map((f) => f.name).sort(),
       ["main.lua", "palettes.json", "sources.json", "sprites.json"]);
    eq("main.lua travels byte for byte",
       envDoc && envDoc.files.filter((f) => f.name === "main.lua")[0].source,
       savedMain);
    eq("sources.json travels byte for byte",
       envDoc && envDoc.files.filter((f) => f.name === "sources.json")[0].source,
       namedSources);
    eq("the text is the studio's own serialisation of that object",
       savedText,
       JSON.stringify({ version: "pce.studio/1", title: "red-toy",
                        description: "", files: envDoc && envDoc.files,
                        sources: [] }, null, 2) + "\n");

    /* the studio's open path, headless: importStudio reads the envelope and
     * the host imports its files before init() */
    const opened = sourceLib.importStudio(savedText);
    eq("the studio's open path reads the envelope as a toy",
       opened.kind, "studio");
    eq("and every file the save wrote is in it",
       opened.files.map((f) => f.name).sort(),
       ["main.lua", "palettes.json", "sources.json", "sprites.json"]);
    const studioFrame = independentArtFrames(opened.files, 1, {});
    sameImage("the studio's open path draws the MCP run's frame (diff 0)",
              studioFrame, mcpPng);
    eq("the opened toy's sprite pixel is the PNG's red",
       pixelOf(studioFrame, 68, 36), [252, 0, 0]);

    /* the control: the same toy saved WITHOUT the art — the studio opens a
     * file with no sprite where the saved one draws its own */
    const bareWrite = await client.call("toy_write", {
      files: [{ name: "main.lua", source: savedMain }]
    });
    check(!bareWrite.isError && bareWrite.body.ok, "the control toy writes");
    const bareSave = await client.call("toy_save", { path: "bare-toy.pce.json" });
    check(!bareSave.isError && bareSave.body.ok, "the control toy saves");
    const bareOpen = sourceLib.importStudio(
      fs.readFileSync(path.join(WORK, "bare-toy.pce.json"), "utf8"));
    eq("the control's file carries main.lua and no art",
       bareOpen.files.map((f) => f.name), ["main.lua"]);
    const bareFrame = independentArtFrames(bareOpen.files, 1, {});
    eq("the control renders the sky where the saved toy draws its sprite",
       pixelOf(bareFrame, 68, 36), [0, 0, 252]);
    check(diffCount(bareFrame.pixels, mcpPng.pixels).n > 0,
          "the control's frame is not the saved toy's frame");

    /* the extension the studio's Open offers: a bare name gets .pce.json */
    const bareName = await client.call("toy_save", { path: "named-toy" });
    check(!bareName.isError && bareName.body.ok,
          "a path without the extension saves");
    eq("the file is named .pce.json", bareName.body.path,
       path.join(WORK, "named-toy.pce.json"));
    check(fs.existsSync(path.join(WORK, "named-toy.pce.json")),
          "and it is on disk under that name");

    /* the working folder is the fence: nothing outside it */
    const outside = await client.call("toy_save", { path: "../escape.pce.json" });
    check(outside.isError, "a path outside the working folder is refused");
    eq("the refusal is save-path", outside.body.code, "save-path");
    check(!fs.existsSync(path.join(TMP, "escape.pce.json")),
          "and nothing was written outside the folder");
    const absolute = await client.call("toy_save", {
      path: path.join(os.tmpdir(), "pce-mcp-escape.pce.json")
    });
    check(absolute.isError && absolute.body.code === "save-path",
          "an absolute path outside the working folder is refused too");
    check(!fs.existsSync(path.join(os.tmpdir(), "pce-mcp-escape.pce.json")),
          "and that file was not written either");

    /* With nothing naming a folder, it is the one the server was started
     * in — Claude Code starts it in the person's project folder. */
    const work2 = path.join(TMP, "work2");
    fs.mkdirSync(work2, { recursive: true });
    const proc2 = spawn(process.execPath, [SERVER], {
      cwd: work2, stdio: ["pipe", "pipe", "pipe"]
    });
    const client2 = new Client(proc2);
    try {
      await client2.request("initialize", {
        protocolVersion: "2024-11-05", capabilities: {}
      });
      client2.notify("notifications/initialized");
      const wrote2 = await client2.call("toy_write", {
        files: [{ name: "main.lua", source: savedMain }]
      });
      check(!wrote2.isError && wrote2.body.ok, "a second server writes the toy");
      const defaultSave = await client2.call("toy_save", { path: "here.pce.json" });
      check(!defaultSave.isError && defaultSave.body.ok,
            "the default folder is the server's own and saves there");
      eq("the file lands in the folder the server was started in",
         defaultSave.body.path, path.join(fs.realpathSync(work2), "here.pce.json"));
      check(fs.existsSync(path.join(work2, "here.pce.json")),
            "the file is in that folder");
      const defaultOut = await client2.call("toy_save", {
        path: "../outside.pce.json"
      });
      check(defaultOut.isError && defaultOut.body.code === "save-path",
            "and outside the default folder is refused too");
    } finally {
      client2.close();
    }

    /* 12 — project_save / project_open (#163): a game over two sessions ----
     * Session 1: a toy with art from source_add and a NOTES.md, saved as a
     * project — one .pcestudio AND the same layout unpacked into a folder
     * (the route for Claude Code, so git holds the history); at the end of
     * the session the note is updated through project_save's `notes`.
     * Session 2 is a NEW server process: project_open must answer with
     * NOTES.md's text FIRST and then run to session 1's frame, diff 0.  The
     * studio's own open path (renderer/pce-project.js parseBytes, which is
     * what the page's OPEN calls) reads the same file and draws the same
     * frame, so the person can open what Claude saved.
     */
    const projectNotes = "# Red square — resume note\n\n" +
      "## Goal\nA red square that draws at (68, 36).\n\n" +
      "## What works\n- the square is on screen\n\n" +
      "## Next steps\n1. make it move with the pad\n";
    const projectNotes2 = "# Red square — resume note\n\n" +
      "## Goal\nA red square that draws at (68, 36).\n\n" +
      "## What I did\n- added the sprite with source_add\n\n" +
      "## What works\n- the square is on screen (frame 0, pixel (68, 36))\n\n" +
      "## Next steps\n1. make it move with the pad\n2. add a second square\n";

    const projWrite = await client.call("toy_write", {
      files: [{ name: "main.lua", source: savedMain },
              { name: "sources.json", source: namedSources },
              { name: "NOTES.md", source: projectNotes }]
    });
    check(!projWrite.isError && projWrite.body.ok,
          "session 1: the project's toy writes, with its NOTES.md");
    const projAdd = await client.call("source_add", {
      kind: "sprites", name: "red-square", png: redPng
    });
    check(!projAdd.isError && projAdd.body.ok, "session 1: its art is added");
    const projRun = await client.call("toy_run", { frames: 1 });
    check(!projRun.isError && projRun.body.ok, "session 1: the toy runs");
    const projectFrame = imageOf(await client.call("frame_png", { frame: 0 }));
    eq("session 1: the run draws the sprite",
       pixelOf(projectFrame, 68, 36), [252, 0, 0]);

    const projSave = await client.call("project_save",
                                       { path: "red-project.pcestudio" });
    check(!projSave.isError && projSave.body.ok,
          "project_save writes the project" +
          (projSave.isError ? " (" + JSON.stringify(projSave.body) + ")" : ""));
    const projPath = path.join(WORK, "red-project.pcestudio");
    eq("the reply names the file inside the working folder",
       projSave.body.path, projPath);
    check(fs.existsSync(projPath), "the .pcestudio is on disk");
    eq("it is the studio's project format", projSave.body.format, "pcestudio/1");
    eq("the project carries the session's every file",
       (projSave.body.files || []).slice().sort(),
       ["NOTES.md", "main.lua", "palettes.json", "sources.json",
        "sprites.json"]);
    eq("the reply says the notes went in", projSave.body.notes, "NOTES.md");

    const projBytes = fs.readFileSync(projPath);
    check(projBytes[0] === 0x50 && projBytes[1] === 0x4B,
          "the project is a ZIP, as the format says");
    const projRead = projectLib.parseBytes(projBytes);
    eq("the studio's project reader opens it",
       projRead.format, "pcestudio/1");
    eq("... with every file",
       projRead.files.map((f) => f.name).sort(),
       ["NOTES.md", "main.lua", "palettes.json", "sources.json",
        "sprites.json"]);
    eq("... NOTES.md byte for byte", projRead.notes, projectNotes);
    eq("... main.lua byte for byte",
       projRead.files.filter((f) => f.name === "main.lua")[0].source,
       savedMain);
    const studioProjectFrame = independentArtFrames(
      projRead.files.map((f) => ({ name: f.name, source: f.source })), 1, {});
    sameImage("the studio's open path draws session 1's frame (diff 0)",
              studioProjectFrame, projectFrame);

    /* the folder route: a trailing / writes the SAME layout unpacked, so the
     * folder can be a git repository */
    const folderPath = path.join(WORK, "red-project");
    const folderSave = await client.call("project_save", { path: "red-project/" });
    check(!folderSave.isError && folderSave.body.ok,
          "project_save writes the folder route" +
          (folderSave.isError ? " (" + JSON.stringify(folderSave.body) + ")" : ""));
    eq("the reply says it is the unpacked folder",
       folderSave.body.folder, true);
    check(fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory(),
          "the folder is on disk");
    eq("the folder is the project layout",
       fs.readdirSync(folderPath).sort(),
       ["NOTES.md", "main.lua", "palettes.json", "project.json",
        "sources.json", "sprites.json"]);
    eq("... with the project.json",
       JSON.parse(fs.readFileSync(path.join(folderPath, "project.json"), "utf8"))
         .format, "pcestudio/1");
    eq("... and NOTES.md's own text",
       fs.readFileSync(path.join(folderPath, "NOTES.md"), "utf8"),
       projectNotes);

    /* the end of session 1: update NOTES.md and save, in one call */
    const notesSave = await client.call("project_save", {
      path: "red-project.pcestudio", notes: projectNotes2
    });
    check(!notesSave.isError && notesSave.body.ok,
          "project_save takes the updated NOTES.md");
    const notesFolder = await client.call("project_save", {
      path: "red-project/", notes: projectNotes2
    });
    check(!notesFolder.isError && notesFolder.body.ok,
          "... on the folder route too");
    eq("the .pcestudio now holds the updated note",
       projectLib.parseBytes(fs.readFileSync(projPath)).notes, projectNotes2);
    eq("and so does the folder",
       fs.readFileSync(path.join(folderPath, "NOTES.md"), "utf8"),
       projectNotes2);

    /* session 2 — a fresh server process, started in the same folder */
    const proc3 = spawn(process.execPath, [SERVER], {
      cwd: WORK, stdio: ["pipe", "pipe", "pipe"]
    });
    const client3 = new Client(proc3);
    try {
      await client3.request("initialize", {
        protocolVersion: "2024-11-05", capabilities: {}
      });
      client3.notify("notifications/initialized");

      const opened = await openProject(client3, "red-project.pcestudio");
      check(!opened.isError,
            "session 2: project_open reads the .pcestudio" +
            (opened.isError ? " (" + JSON.stringify(opened.body) + ")" : ""));
      eq("... and NOTES.md's text is the reply's FIRST block",
         opened.head, projectNotes2);
      eq("... with the project loaded", opened.body && opened.body.title,
         "red-project");
      eq("... and every file in the session",
         (opened.body.files || []).slice().sort(),
         ["NOTES.md", "main.lua", "palettes.json", "sources.json",
          "sprites.json"]);
      check(opened.body.notes === true, "... and the reply says the notes are there");
      const ran2 = await client3.call("toy_run", { frames: 1 });
      check(!ran2.isError && ran2.body.ok, "session 2: the resumed toy runs");
      const frame2 = imageOf(await client3.call("frame_png", { frame: 0 }));
      sameImage("session 2 draws session 1's frame (diff 0)", frame2,
                projectFrame);

      /* the folder route opens the same way, with the note first */
      const folderOpen = await openProject(client3, "red-project");
      check(!folderOpen.isError && folderOpen.body.folder === true,
            "session 2: project_open reads the unpacked folder" +
            (folderOpen.isError ? " (" + JSON.stringify(folderOpen.body) + ")" : ""));
      eq("... and still returns NOTES.md first", folderOpen.head, projectNotes2);
      const ran3 = await client3.call("toy_run", { frames: 1 });
      check(!ran3.isError && ran3.body.ok, "the folder's toy runs");
      const frame3 = imageOf(await client3.call("frame_png", { frame: 0 }));
      sameImage("the folder's toy draws session 1's frame (diff 0)", frame3,
                projectFrame);

      /* The folder is a git repository, so it holds files that are not the
       * project's: .git/, a README, a committed screenshot.  project.json is
       * the manifest — a root file it does not list is not loaded (and a
       * binary file is never fed to the text decoder). */
      fs.writeFileSync(path.join(folderPath, "README.md"), "# my game\n");
      fs.writeFileSync(path.join(folderPath, "screenshot.png"),
                       Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x00, 0xFF, 0x80]));
      fs.mkdirSync(path.join(folderPath, ".git"), { recursive: true });
      fs.writeFileSync(path.join(folderPath, ".git", "HEAD"),
                       "ref: refs/heads/main\n");
      const gitFolder = await openProject(client3, "red-project");
      check(!gitFolder.isError,
            "a git folder opens with its other files present" +
            (gitFolder.isError ? " (" + JSON.stringify(gitFolder.body) + ")" : ""));
      eq("... loading only the files project.json lists",
         (gitFolder.body.files || []).slice().sort(),
         ["NOTES.md", "main.lua", "palettes.json", "sources.json",
          "sprites.json"]);
      check((gitFolder.body.files || []).indexOf("README.md") < 0 &&
            (gitFolder.body.files || []).indexOf("screenshot.png") < 0,
            "... and not the README or the screenshot");
      eq("... still with NOTES.md first", gitFolder.head, projectNotes2);

      /* a project with no NOTES.md gets the studio's template, so the next
       * session has something to read */
      const bareProjWrite = await client3.call("toy_write", {
        files: [{ name: "main.lua", source: savedMain }]
      });
      check(!bareProjWrite.isError, "a toy without NOTES.md writes");
      const bareProjSave = await client3.call("project_save",
                                             { path: "templated",
                                               title: "templated" });
      check(!bareProjSave.isError && bareProjSave.body.ok,
            "project_save without notes still writes");
      const templated = projectLib.parseBytes(
        fs.readFileSync(path.join(WORK, "templated.pcestudio")));
      check(templated.notes && templated.notes.indexOf("resume note") >= 0,
            "the project gets the studio's NOTES.md template");
      contains("the template asks for the next step",
               templated.notes || "", "## Next steps");

      /* the fences and refusals */
      const outsideOpen = await openProject(client3, "../escape.pcestudio");
      check(outsideOpen.isError && outsideOpen.body &&
            outsideOpen.body.code === "open-path",
            "a project path outside the working folder is refused (open-path)");
      const missingOpen = await openProject(client3, "no-such.pcestudio");
      check(missingOpen.isError && missingOpen.body &&
            missingOpen.body.code === "open-path",
            "a missing project is refused (open-path)");
      const notProjectPath = path.join(WORK, "no-project.pcestudio");
      fs.writeFileSync(notProjectPath,
                       Buffer.from(require("../renderer/pce-zip.js")
                         .write([{ name: "main.lua",
                                   bytes: Buffer.from("function frame(t, f) end\n") }])));
      const notProject = await openProject(client3, "no-project.pcestudio");
      check(notProject.isError && notProject.body &&
            notProject.body.code === "project-format",
            "a ZIP with no project.json is refused by the format " +
            "(project-format)");
      const stillRan = await client3.call("toy_run", { frames: 1 });
      check(!stillRan.isError && stillRan.body.ok,
            "a refused open leaves the loaded toy alone");
    } finally {
      client3.close();
    }

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
              "the validator refuses an over-budget toy with file:line; " +
              "export_pce is the #100 build byte for byte; source_add's " +
              "PNG reaches VRAM as sprites while tiles.json renders through " +
              "MCP exactly as through the studio host; a toy's song.json is " +
              "its music(0), with a .mid through source_add and a song_write " +
              "tune both playing and the SEQUENCER reading the saved song " +
              "back; and toy_save's one pce.studio/1 envelope opens through " +
              "the studio's own importStudio to the same frame, its art " +
              "included; and a project saved as one .pcestudio or an unpacked " +
              "folder reopens in a fresh process with NOTES.md first and the " +
              "same frame");
  process.exit(0);
})();
