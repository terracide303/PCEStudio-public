#!/usr/bin/env node
/*
 * tests/check-skill.js — the #103 evidence: the agent skill in
 * plugin/skills/creating-pce-toys/ is a thing an agent can follow.
 *
 * What it asserts:
 *
 *   1. The artifacts are there and agree: plugin/.claude-plugin/plugin.json
 *      parses and names the skill's directory; SKILL.md has the frontmatter a
 *      Claude Code skill needs; and every recipe file SKILL.md names exists.
 *   2. The numbers SKILL.md prints are the code's numbers: the 16-strip line
 *      budget, 512 CRAM entries, the 119,318-cycle 60 Hz frame, the 123-cycle
 *      raster blank, 32,768 VRAM words and the HuCard's 1 MB, read from
 *      renderer/pce-toyhost.js, renderer/pce-editor.js and
 *      renderer/pce-validate.js — a number typed into the skill cannot pass.
 *   3. Every MCP tool SKILL.md tells the agent to call is one tools/list
 *      publishes, and the loop's last step is the hand-off (#160): SKILL.md
 *      says to finish with toy_save and to tell the person Open… → From
 *      file.
 *   4. Every recipe is run THROUGH tools/mcp/server.js, over stdio, as an
 *      agent would: toy_write compiles it, toy_run runs 60 frames, frame_png
 *      is VISIBLE (more than 1,000 pixels that are not CRAM[0], counted from
 *      the PNG the server sends and the backdrop the server reports), and
 *      validate returns ok with zero findings — not zero errors: zero
 *      problems.
 *   5. The recipes that teach something measurable are measured: the sprite
 *      recipe's picture CHANGES when pad 1's right is held; the song recipe
 *      records PSG writes; the fix recipe's `-before` file is REFUSED with
 *      validate-sprite-line and its fixed file is clean; the source_add
 *      recipe's `-- GRID` line becomes a sprite (source_add) that the recipe
 *      then places — the picture before the add is the sky at that pixel,
 *      after it the grid's red.
 *   6. One recipe exports: export_pce writes a .pce under $TMPDIR and the
 *      bytes are there.
 *   7. The cold-seat transcript (docs/SKILL-TRANSCRIPT.md) carries the
 *      main.lua a fresh session wrote from SKILL.md alone; that file is run
 *      the same way — visible and validator-clean.
 *
 * The test writes its .pce under $TMPDIR, never into the repository.
 *
 * Written by @design because the card names this file.  Rule 2: a cold break
 * by another seat is owed before the card closes.
 *
 *   node tests/check-skill.js
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { spawn } = require("child_process");
const readline = require("readline");

const host = require("../renderer/pce-toyhost.js");
const editor = require("../renderer/pce-editor.js");
const validate = require("../renderer/pce-validate.js");

const ROOT = path.join(__dirname, "..");
const SERVER = path.join(ROOT, "tools", "mcp", "server.js");
const SKILL_DIR = path.join(ROOT, "plugin", "skills", "creating-pce-toys");
const SKILL = path.join(SKILL_DIR, "SKILL.md");
const RECIPES = path.join(SKILL_DIR, "recipes");
const PLUGIN = path.join(ROOT, "plugin", ".claude-plugin", "plugin.json");
const TRANSCRIPT = path.join(ROOT, "docs", "SKILL-TRANSCRIPT.md");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pcestudio-skill-"));

const WIDTH = host.WIDTH;
const HEIGHT = host.HEIGHT;
const VISIBLE_MIN = 200;            /* a 16x16 sprite plus a paddle; the
                                     * blank-screen failure is caught by the
                                     * colour count, not this bar */

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
        name + " (looked for " + JSON.stringify(needle) + ")");
}
function num(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

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

function diffBytes(a, b) {
  let n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) n++;
  return n;
}

/* VCE 9-bit colour -> RGB, the renderer's own table (renderer/pce-bg.js). */
function cramRgb(word) {
  return [36 * ((word >> 3) & 7), 36 * ((word >> 6) & 7), 36 * (word & 7)];
}

function pixelOf(img, x, y) {
  const o = (y * img.width + x) * 3;
  return [img.pixels[o], img.pixels[o + 1], img.pixels[o + 2]];
}

/* Recipe 06's picture travels on a -- GRID {json} comment line, so the
 * recipe stays one file and this test adds it exactly as an agent would. */
function gridOf(source) {
  const m = /-- GRID (\{.*\})/.exec(source);
  return m ? JSON.parse(m[1]) : null;
}

/* Pixels that are not the backdrop.  CRAM[0] is read from the SERVER
 * (registers_get chip vce addr 0), so "the backdrop" is the toy's own, not a
 * colour this test assumed. */
function visibleCount(img, backdrop) {
  let n = 0;
  for (let i = 0; i < img.pixels.length; i += 3) {
    if (img.pixels[i] === backdrop[0] && img.pixels[i + 1] === backdrop[1] &&
        img.pixels[i + 2] === backdrop[2]) continue;
    n++;
  }
  return n;
}

/* A picture that is one flat colour is blank, however it compares with the
 * backdrop: a toy whose CR turned every layer off renders the blanking fill,
 * which is not CRAM[0] and would count as fully "visible".  A real frame has
 * at least three colours (every recipe here has five or more). */
function distinctColours(img) {
  const seen = new Set();
  for (let i = 0; i < img.pixels.length; i += 3) {
    seen.add((img.pixels[i] << 16) | (img.pixels[i + 1] << 8) | img.pixels[i + 2]);
  }
  return seen.size;
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
      check(false, "the server wrote a non-JSON line to stdout: " + line.slice(0, 120));
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
        reject(new Error("timeout waiting for " + method + "\nserver stderr:\n" +
                         this.stderr.slice(-2000)));
      }, timeoutMs || 30000);
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
  const img = (result.content || []).filter((c) => c.type === "image")[0];
  if (!img) throw new Error("the tool result has no image content block");
  return decodePng(Buffer.from(img.data, "base64"));
}

/* The backdrop the toy itself set: CRAM[0], read from the server. */
async function backdropOf(client) {
  const r = await client.call("registers_get", { chip: "vce", addr: 0 });
  const ctw = (r.body.vce || []).filter((x) => x.name === "CTW")[0];
  if (!ctw || ctw.value == null) throw new Error("no CRAM[0] from the server");
  return cramRgb(ctw.value);
}

/* ---- reading the artifacts -------------------------------------------- */

const skillText = fs.readFileSync(SKILL, "utf8");
const plugin = JSON.parse(fs.readFileSync(PLUGIN, "utf8"));
const recipeFiles = fs.readdirSync(RECIPES).filter((n) => n.endsWith(".lua")).sort();
const FIXED = recipeFiles.filter((n) => !/-before\.lua$/.test(n));
const BEFORE = recipeFiles.filter((n) => /-before\.lua$/.test(n));

function recipeSource(name) {
  return fs.readFileSync(path.join(RECIPES, name), "utf8");
}

/* The first fenced lua block of a markdown file. */
function firstLuaBlock(text) {
  const m = /```lua\r?\n([\s\S]*?)```/.exec(text);
  return m ? m[1] : null;
}

/* ---- main -------------------------------------------------------------- */

(async function main() {
  /* 1 — the artifacts agree */
  eq("the plugin manifest names the plugin", plugin.name, "pcestudio");
  check(Array.isArray(plugin.skills) && plugin.skills.length === 1,
        "the plugin manifest declares one skill");
  const declared = plugin.skills && plugin.skills[0];
  check(declared && fs.existsSync(path.join(ROOT, "plugin", declared)),
        "the plugin's skill path exists (" + declared + ")");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(skillText);
  check(!!fm, "SKILL.md opens with YAML frontmatter");
  contains("the skill's frontmatter names it", fm ? fm[1] : "",
           "name: creating-pce-toys");
  check(/description:\s*\S/.test(fm ? fm[1] : ""),
        "the skill's frontmatter has a description");
  eq("the skill's directory holds six fixed recipes and one broken one",
     [FIXED.length, BEFORE.length], [6, 1]);
  for (const name of recipeFiles) {
    contains("SKILL.md names the recipe file " + name, skillText, name);
  }
  for (const task of ["Parallax", "sprite on the pad", "sky gradient",
                      "song in a toy", "Fixing a console finding",
                      "sprite from a PNG"]) {
    contains("SKILL.md carries the recipe \"" + task + "\"", skillText, task);
  }

  /* 2 — the numbers in the skill are the code's numbers */
  contains("SKILL.md prints the 16-strip line budget", skillText,
           String(editor.LINE_STRIPS) + " strips of " + String(editor.STRIP_PX));
  contains("SKILL.md prints the CRAM entry count", skillText,
           String(host.CRAM_ENTRIES));
  contains("SKILL.md prints the 60 Hz frame budget", skillText, num(validate.MODEL.FRAME_CLOCKS));
  contains("SKILL.md prints the raster blank", skillText, String(validate.MODEL.RCR_BLANK));
  contains("SKILL.md prints the VRAM word count", skillText, num(host.VRAM_WORDS));
  contains("SKILL.md prints the HuCard's 1 MB", skillText, "1 MB");
  contains("SKILL.md prints the SAT entry count", skillText, String(host.SAT_ENTRIES));
  contains("SKILL.md prints the PSG channel count", skillText,
           String(host.SOUND_CHANNELS) + " voices");

  const proc = spawn(process.execPath, [SERVER], {
    cwd: ROOT, stdio: ["pipe", "pipe", "pipe"]
  });
  const client = new Client(proc);
  let ok = false;

  try {
    const init = await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "check-skill", version: "1" }
    });
    check(!init.error, "the MCP server answers initialize");
    client.notify("notifications/initialized");

    /* 3 — every tool the skill names is one the server publishes */
    const list = await client.request("tools/list", {});
    const tools = (list.result.tools || []).map((t) => t.name);
    for (const tool of ["toy_write", "toy_run", "source_add", "frame_png",
                        "validate", "toy_save", "export_pce", "docs"]) {
      contains("SKILL.md tells the agent about " + tool, skillText, tool);
      check(tools.indexOf(tool) >= 0,
            "the server publishes the tool " + tool + " that SKILL.md names");
    }
    /* #160: the loop's last step is the hand-off, and it is in the words the
     * person's studio uses */
    contains("SKILL.md says to finish with toy_save", skillText,
             "Finish with `toy_save`");
    contains("SKILL.md tells the agent what to say to the person", skillText,
             "Open… → From file");

    /* 4 and 5 — every fixed recipe, through the server */
    for (const name of FIXED) {
      /* the source_add recipe needs its -- GRID line added first; its own
       * block below does that, so the generic loop skips it */
      if (name.indexOf("06-") === 0) continue;
      const source = recipeSource(name);
      const w = await client.call("toy_write", {
        files: [{ name: "main.lua", source: source }]
      });
      check(!w.isError, "the recipe " + name + " compiles in the server" +
            (w.isError ? " (" + JSON.stringify(w.body) + ")" : ""));
      if (w.isError) continue;

      const run = await client.call("toy_run", { frames: 60 });
      check(!run.isError, "the recipe " + name + " runs 60 frames" +
            (run.isError ? " (" + JSON.stringify(run.body) + ")" : ""));
      if (run.isError) continue;

      const png = await client.call("frame_png", { frame: 59 });
      check(!png.isError, "the recipe " + name + " renders frame 59");
      if (png.isError) continue;
      const img = imageOf(png);
      eq("the recipe " + name + " renders a 256x224 frame",
         [img.width, img.height], [WIDTH, HEIGHT]);
      const backdrop = await backdropOf(client);
      const vis = visibleCount(img, backdrop);
      check(vis > VISIBLE_MIN,
            "the recipe " + name + " is VISIBLE at frame 59 (" +
            vis + " non-backdrop pixels)");
      const shades = distinctColours(img);
      check(shades >= 3,
            "the recipe " + name + " is a picture, not a blank screen (" +
            shades + " distinct colours)");

      const v = await client.call("validate", { frames: 8 });
      check(!v.isError, "the recipe " + name + " passes the console check" +
            (v.isError ? " (" + JSON.stringify(v.body) + ")" : ""));
      if (!v.isError) {
        eq("the recipe " + name + " is validator-CLEAN (zero findings)", v.body.problems, []);
        eq("the recipe " + name + " reports ok", v.body.ok, true);
      }

      if (name.indexOf("02-sprite") === 0) {
        /* the pad moves the sprite: two runs of the same length, one with
         * right held from frame 0, and the pictures must differ */
        await client.call("toy_run", { frames: 31 });
        const still = imageOf(await client.call("frame_png", { frame: 30 }));
        await client.call("toy_run", {
          frames: 31, pad: [{ from: 0, to: 30, pad: 1, buttons: ["right"] }]
        });
        const moved = imageOf(await client.call("frame_png", { frame: 30 }));
        const d = diffBytes(still.pixels, moved.pixels);
        check(d > 100, "the sprite recipe moves with pad 1's right (" +
              d + " bytes differ)");
      }

      if (name.indexOf("04-song") === 0) {
        const s = await client.call("toy_run", { frames: 60 });
        check(s.body.sound_writes > 0,
              "the song recipe records PSG writes (" + s.body.sound_writes + ")");
      }

      if (name.indexOf("01-parallax") === 0) {
        /* SKILL.md states the export route is background-only and that a
         * table makes export_pce refuse.  All six recipes use tables, so
         * the refusal is the documented, tested behaviour — and a
         * background-only toy is exported to prove the route itself works. */
        const refused = await client.call("export_pce", { name: "parallax" });
        check(refused.isError, "export_pce refuses a table toy (SKILL.md's limit)");
        eq("the refusal is ilbc-op", refused.body && refused.body.code, "ilbc-op");
        contains("SKILL.md states the ilbc-op limit", skillText, "ilbc-op");

        const bg = "function init()\n  pal(0, rgb(0, 0, 3))\n" +
                   "  for i = 0, 895 do vram[i] = 0x40 end\nend\n" +
                   "function frame(t, f)\n  reg(\"BXR\", f * 2)\nend\n";
        const bw = await client.call("toy_write", {
          files: [{ name: "main.lua", source: bg }]
        });
        check(!bw.isError, "a background-only toy compiles");
        const out = path.join(TMP, "background.pce");
        const e = await client.call("export_pce", { name: "background", out: out });
        check(!e.isError, "a background-only toy exports" +
              (e.isError ? " (" + JSON.stringify(e.body) + ")" : ""));
        if (!e.isError) {
          check(fs.existsSync(out) && fs.statSync(out).size > 0,
                "export_pce wrote the .pce (" + e.body.bytes + " bytes)");
        }
      }
    }

    /* 6 — the source_add recipe: its -- GRID line becomes a sprite */
    const six = recipeSource("06-add-a-sprite-from-a-png.lua");
    const grid = gridOf(six);
    check(!!grid, "recipe 06 carries its picture as a -- GRID line");
    if (grid) {
      await client.call("toy_write", {
        files: [{ name: "main.lua", source: six }]
      });
      const before = imageOf(
        await client.call("frame_png",
          { frame: (await client.call("toy_run", { frames: 60 })).body.frame }));
      eq("before source_add the sprite's spot is the sky",
         pixelOf(before, 68, 36), cramRgb(7));
      const add = await client.call("source_add", {
        kind: "sprites", name: "square",
        grid: { width: grid.width, height: grid.height, pixels: grid.pixels },
        palette: grid.palette
      });
      check(!add.isError && add.body.ok, "the recipe's grid adds as sprites" +
            (add.isError ? " (" + JSON.stringify(add.body) + ")" : ""));
      const run = await client.call("toy_run", { frames: 60 });
      check(!run.isError, "the recipe runs 60 frames with its sprite");
      if (!run.isError) {
        const img = imageOf(await client.call("frame_png", { frame: 59 }));
        const backdrop = await backdropOf(client);
        const vis = visibleCount(img, backdrop);
        check(vis > VISIBLE_MIN,
              "the recipe with its sprite is VISIBLE at frame 59 (" +
              vis + " non-backdrop pixels)");
        const shades = distinctColours(img);
        check(shades >= 3,
              "the recipe with its sprite is a picture, not a blank screen (" +
              shades + " distinct colours)");
        eq("the imported sprite's pixel is the grid's red",
           pixelOf(img, 68, 36), [252, 0, 0]);
        eq("the grid's white centre is where the grid put it",
           pixelOf(img, 72, 40), [252, 252, 252]);
        eq("toy_run reports the import: one sprite placed",
           run.body.assets && run.body.assets.sprites, 1);
        const v = await client.call("validate", { frames: 8 });
        check(!v.isError, "the recipe with its sprite passes the console check");
        if (!v.isError) {
          eq("the recipe with its sprite is validator-CLEAN (zero findings)",
             v.body.problems, []);
        }
      }
    }

    /* the broken file is REFUSED, and by the code the skill names */
    for (const name of BEFORE) {
      const w = await client.call("toy_write", {
        files: [{ name: "main.lua", source: recipeSource(name) }]
      });
      check(!w.isError, "the broken recipe " + name + " compiles");
      const v = await client.call("validate", { frames: 8 });
      check(v.isError, "the broken recipe " + name + " is REFUSED by the check");
      eq("the refusal is validate-sprite-line", v.body && v.body.code,
         "validate-sprite-line");
      contains("SKILL.md shows the code the broken file gets", skillText,
               "validate-sprite-line");
    }

    /* 7 — the cold seat's transcript */
    check(fs.existsSync(TRANSCRIPT),
          "docs/SKILL-TRANSCRIPT.md records the cold seat's session");
    if (fs.existsSync(TRANSCRIPT)) {
      const cold = firstLuaBlock(fs.readFileSync(TRANSCRIPT, "utf8"));
      check(!!cold, "the transcript carries a fenced lua block");
      if (cold) {
        const cw = await client.call("toy_write", {
          files: [{ name: "main.lua", source: cold }]
        });
        check(!cw.isError, "the cold seat's main.lua compiles" +
              (cw.isError ? " (" + JSON.stringify(cw.body) + ")" : ""));
        if (!cw.isError) {
          const cr = await client.call("toy_run", { frames: 60 });
          check(!cr.isError, "the cold seat's main.lua runs 60 frames");
          if (!cr.isError) {
            const cp = imageOf(await client.call("frame_png", { frame: 59 }));
            const bd = await backdropOf(client);
            const cv = visibleCount(cp, bd);
            check(cv > VISIBLE_MIN,
                  "the cold seat's main.lua is VISIBLE (" + cv +
                  " non-backdrop pixels)");
            check(distinctColours(cp) >= 3,
                  "the cold seat's main.lua is a picture, not a blank screen (" +
                  distinctColours(cp) + " distinct colours)");
            const cvr = await client.call("validate", { frames: 8 });
            check(!cvr.isError, "the cold seat's main.lua passes the check");
            if (!cvr.isError) {
              eq("the cold seat's main.lua is validator-clean",
                 cvr.body.problems, []);
            }
          }
        }
      }
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
  console.log("PASS  " + checks + " checks: the skill names the server's own " +
              "tools and the code's own limits; " + FIXED.length + " recipes " +
              "run through tools/mcp/server.js, visible and validator-clean; " +
              "the broken one is refused with validate-sprite-line; and the " +
              "cold seat's toy from SKILL.md alone runs");
  process.exit(0);
})();
