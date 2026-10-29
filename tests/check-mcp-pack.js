#!/usr/bin/env node
/*
 * tests/check-mcp-pack.js — the #142 evidence: the download a stranger gets
 * from the site runs on its own, with no repository anywhere near it.
 *
 * The repo is private, so tools/mcp/server.js cannot be cloned by a tester.
 * tools/mcp-pack.sh builds pcestudio-mcp.zip; this test is the stranger:
 *
 *   1. it builds the pack with `sh tools/mcp-pack.sh <tmp>/pcestudio-mcp.zip`
 *      and requires exit 0, a non-empty zip, and a zip that carries
 *      tools/mcp/server.js, the walked renderer modules, renderer/ilvm.bin,
 *      the skill (plugin/skills/creating-pce-toys/SKILL.md + its recipes),
 *      LICENSE and a 10-line README.txt — and NOT tests/ or docs/;
 *   2. it unzips it into a NEW EMPTY directory under $TMPDIR, whose only
 *      entry is pcestudio-mcp/, and starts
 *      pcestudio-mcp/tools/mcp/server.js over stdio with that directory as
 *      the working directory: every module it loads comes out of the zip, not
 *      out of this checkout;
 *   3. it speaks MCP: initialize, tools/list (all 11 tools, each with a
 *      schema), then runs one recipe FROM THE UNPACKED SKILL through
 *      toy_write, toy_run and frame_png, and the frame it gets back is a
 *      visible 256x224 picture (more than 1000 non-backdrop pixels) — the
 *      same bar check-examples uses.
 *
 * A module the walk missed is not a subtle failure: server.js throws on the
 * require and initialize never answers, which is the timeout message this
 * test prints with the server's stderr.
 *
 *   node tests/check-mcp-pack.js
 *
 * Written by @design because the card names this test. Rule 2: a cold break
 * by another seat is owed before the card closes.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { spawn, spawnSync } = require("child_process");
const readline = require("readline");

const ROOT = path.join(__dirname, "..");
const PACKER = path.join(ROOT, "tools", "mcp-pack.sh");
const RECIPE = "plugin/skills/creating-pce-toys/recipes/01-parallax.lua";
const WIDTH = 256;
const HEIGHT = 224;
const VISIBLE_MIN = 1000;

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

/* ---- PNG --------------------------------------------------------------- */

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

/* Non-backdrop pixels: the frame's top-left pixel is the backdrop when the
 * toy paints a solid wall, and parallax does; count everything that differs
 * from the most common colour instead, so the test does not depend on a
 * particular toy's palette. */
function distinctColours(img) {
  const seen = new Map();
  for (let i = 0; i < img.pixels.length; i += 3) {
    const k = (img.pixels[i] << 16) | (img.pixels[i + 1] << 8) | img.pixels[i + 2];
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  return seen;
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
  }

  onLine(line) {
    let msg;
    try { msg = JSON.parse(line); }
    catch (e) {
      check(false, "the server wrote a non-JSON line to stdout: " +
            line.slice(0, 120));
      return;
    }
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

/* ---- 1. build the pack ------------------------------------------------- */

function pack(tmp) {
  const zip = path.join(tmp, "pcestudio-mcp.zip");
  const r = spawnSync("sh", [PACKER, zip], { encoding: "utf8", cwd: ROOT });
  check(r.status === 0, "tools/mcp-pack.sh exits 0" +
        (r.status === 0 ? "" : " (stderr: " + (r.stderr || "").trim() + ")"));
  check(fs.existsSync(zip) && fs.statSync(zip).size > 0,
        "the pack exists and is not empty");
  return zip;
}

function listZip(zip) {
  const r = spawnSync("unzip", ["-Z1", zip], { encoding: "utf8" });
  check(r.status === 0, "unzip can read the pack");
  const entries = (r.stdout || "").split("\n").filter(Boolean);
  const has = (p) => entries.indexOf("pcestudio-mcp/" + p) >= 0;
  return { entries: entries, has: has };
}

/* ---- main -------------------------------------------------------------- */

(async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pce-mcp-pack-"));
  const zip = pack(tmp);
  const listing = listZip(zip);

  /* Shape: what the card says is in it, and nothing of the repository that
   * a download should not carry. */
  for (const f of ["tools/mcp/server.js", "renderer/ilvm.bin", "LICENSE",
                   "README.txt", "plugin/skills/creating-pce-toys/SKILL.md",
                   RECIPE, "vendor/fengari/fengari-node.js",
                   "vendor/fengari/fengari-web.js"]) {
    check(listing.has(f), "the pack carries " + f);
  }
  for (const f of ["renderer/pce-il.js", "renderer/pce-sprites.js",
                   "renderer/pce-validate.js", "renderer/pce-docs.js",
                   "renderer/pce-toyhost.js", "renderer/pce-rom.js",
                   "renderer/pce-ilbc.js", "renderer/pce-psg.js",
                   "renderer/pce-panels.js", "renderer/pce-bg.js",
                   "renderer/pce-vram.js", "renderer/pce-editor.js",
                   "renderer/pce-toys.js", "renderer/pce-song.js",
                   "renderer/pce-sat.js", "renderer/pce-screen.js"]) {
    check(listing.has(f), "the require walk put " + f + " in the pack");
  }
  check(!listing.entries.some((e) => e.indexOf("/tests/") >= 0 ||
                                 e.indexOf("/docs/") >= 0 ||
                                 e.indexOf("/toys/") >= 0),
        "the pack carries no tests/, docs/ or toys/");

  /* A new, empty directory: the unpacked folder and nothing else. */
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pce-mcp-stranger-"));
  const un = spawnSync("unzip", ["-q", zip, "-d", home], { encoding: "utf8" });
  check(un.status === 0, "unzip -q into the empty folder exits 0");
  const top = fs.readdirSync(home);
  eq("the folder holds only the unpacked pack", top, ["pcestudio-mcp"]);
  const folder = path.join(home, "pcestudio-mcp");

  /* README is 10 lines: the download's first page. */
  const readme = fs.readFileSync(path.join(folder, "README.txt"), "utf8");
  eq("README.txt is 10 lines", readme.split("\n").length - 1, 10);
  check(readme.includes("claude mcp add pcestudio -- node"),
        "README.txt gives the install command");
  check(fs.readFileSync(path.join(folder, "LICENSE"), "utf8")
          .indexOf("GNU GENERAL PUBLIC LICENSE") >= 0,
        "LICENSE is the GPL");

  /* 2. start the server that came out of the zip, with the temp folder as
   * its working directory: nothing beside it is this checkout. */
  const server = path.join(folder, "tools", "mcp", "server.js");
  const proc = spawn(process.execPath, [server], {
    cwd: home, stdio: ["pipe", "pipe", "pipe"]
  });
  const client = new Client(proc);

  try {
    const init = await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "check-mcp-pack", version: "1" }
    }, 30000);
    check(!init.error, "initialize answers from the unpacked server" +
          (init.error ? ": " + JSON.stringify(init.error) : ""));
    eq("the unpacked server names itself",
       init.result && init.result.serverInfo && init.result.serverInfo.name,
       "pcestudio");
    client.notify("notifications/initialized");

    /* tools/list */
    const list = await client.request("tools/list", {});
    const tools = (list.result && list.result.tools) || [];
    const names = tools.map((t) => t.name).sort();
    eq("the unpacked server lists every tool", names,
       ["docs", "export_pce", "frame_png", "register_set", "registers_get",
        "song_write", "source_add", "toy_run", "toy_save", "toy_write",
        "validate"]);
    for (const t of tools) {
      check(t.inputSchema && t.inputSchema.type === "object" &&
            t.inputSchema.properties,
            "tool " + t.name + " has an object schema with properties");
    }

    /* 3. one recipe, from the unpacked skill, through the unpacked server */
    const recipePath = path.join(folder, RECIPE);
    check(fs.existsSync(recipePath), "the recipe is in the unpacked folder");
    const source = fs.readFileSync(recipePath, "utf8");

    const wrote = await client.call("toy_write", {
      files: [{ name: "main.lua", source: source }]
    });
    check(!wrote.isError && wrote.body && wrote.body.ok !== false,
          "toy_write accepts the unpacked recipe" +
          (wrote.isError ? ": " + JSON.stringify(wrote.body) : ""));

    const ran = await client.call("toy_run", { frames: 60 });
    check(!ran.isError && ran.body && ran.body.ok !== false,
          "toy_run runs 60 frames from the unpacked server" +
          (ran.isError ? ": " + JSON.stringify(ran.body) : ""));

    const pic = await client.call("frame_png", { frame: 60 });
    check(!pic.isError, "frame_png answers with a picture");
    const img = imageOf(pic);
    eq("the frame is the screen's size", [img.width, img.height],
       [WIDTH, HEIGHT]);

    const colours = distinctColours(img);
    const total = WIDTH * HEIGHT;
    let common = 0;
    for (const n of colours.values()) if (n > common) common = n;
    const visible = total - common;
    check(colours.size >= 3, "the frame has at least 3 colours (" +
          colours.size + ")");
    check(visible >= VISIBLE_MIN, "the frame is visible (" + visible +
          " of " + total + " pixels are not the most common colour)");

    /* The pack's server must not have reached into this checkout: the two
     * module paths it would use are the unpacked ones. */
    check(fs.existsSync(path.join(folder, "renderer", "pce-sprites.js")),
          "the pixel code the frame came from is the unpacked copy");
  } catch (e) {
    check(false, "the unpacked server ran a toy end to end: " + e.message);
  } finally {
    client.close();
  }

  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });

  if (failures.length) {
    for (const f of failures) console.log("FAIL  " + f);
    console.log("FAIL  " + failures.length + " of " + checks +
                " checks failed");
    process.exit(1);
  }
  console.log("PASS  " + checks + " checks: the pack builds, unzips alone " +
              "into an empty folder, starts over stdio, lists all 11 tools, " +
              "and runs a recipe from the unpacked skill to a visible " +
              WIDTH + "x" + HEIGHT + " frame");
})();
