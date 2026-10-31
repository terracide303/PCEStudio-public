#!/usr/bin/env node
/*
 * tests/check-guide.js — the #105 evidence: renderer/pcestudio-for-claude.md
 * is the generator's bytes, its API names and ranges are the code's, its
 * examples run, and a fresh seat given only this file made a working toy.
 *
 * What it proves, in order:
 *
 *   1. The artifact is generated.  renderer/pcestudio-for-claude.md is byte
 *      for byte what `node tools/docs.js --claude` writes, `--check` exits 0,
 *      and a hand-written edit to the file makes `--check` fail.  A number
 *      typed into the guide cannot pass.
 *   2. Every API name in the guide is one the runtime has.  Each `name(` in
 *      every fenced lua block is either defined in that same block, a Lua
 *      standard-library call, or one of the globals renderer/pce-toys.js
 *      installs (read from its surface here, and cross-checked against a
 *      run: a toy calling each name is created).  An invented ppu.toys or
 *      SNES call fails.
 *   3. Every range the guide prints is the one the code enforces: each
 *      register's 0..max, pal/vram/sat/raster/pad/sprite/password/sound/
 *      budget range is in the guide AND provoked at its boundary through
 *      renderer/pce-toyhost.js, where the refusal code must be the one the
 *      guide names.
 *   4. Changing a code table changes the guide: twelve live tables are
 *      changed in place, the guide regenerated, and the new value required
 *      and the old one required gone, then the table is restored.
 *   5. The examples run.  The starter program and the five toys/ listings
 *      are run through the Lua runtime for frames, must be VISIBLE (more
 *      than 1000 non-backdrop pixels), and must be validator-clean
 *      (renderer/pce-validate.js report.ok).  The starter's sprite must
 *      move with the pad.
 *   6. The cold seat's transcript (docs/GUIDE-TRANSCRIPT.md) carries its
 *      main.lua; that file is run the same way, and must be visible,
 *      validator-clean, and move with the pad.
 *   7. The guide fits a chat: under 12,000 words, and it ends every code
 *      answer with the exact Paste & Run line.
 *   8. The cold review's seven findings stay fixed (#141): every BXR that
 *      grows with the frame is wrapped (and parallax runs past frame 2048),
 *      the starter is table-free and pce-cgen lowers it, the pattern range is
 *      the default layout's real one, every example runs 3,600 frames clean,
 *      the sound example needs no song, pad buttons and keys are named apart,
 *      the four missing refusal codes are in section 9, and no internal card
 *      number or personal attribution survives in the stranger-facing page.
 *   9. The guide opens with the MCP route (#142): the repository clone URL,
 *      the download URL (the route without git), the `claude mcp add` line,
 *      the skill to link, and every tool tools/mcp/server.js's TOOLS array
 *      has — the list is read from the server, so a tool it gains without
 *      the guide naming it fails here.
 *
 * Written by @design because the card names this file.  Per workshop rule 2
 * a cold break by another seat is owed before it closes the card.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const docs = require("../renderer/pce-docs.js");
const guide = require("../renderer/pce-guide.js");
const host = require("../renderer/pce-toyhost.js");
const editor = require("../renderer/pce-editor.js");
const toys = require("../renderer/pce-toys.js");
const il = require("../renderer/pce-il.js");
const psg = require("../renderer/pce-psg.js");
const validate = require("../renderer/pce-validate.js");
const cgen = require("../renderer/pce-cgen.js");

const ROOT = path.resolve(__dirname, "..");
const GUIDE_PATH = path.join(ROOT, "renderer", "pcestudio-for-claude.md");
const TRANSCRIPT_PATH = path.join(ROOT, "docs", "GUIDE-TRANSCRIPT.md");
const WIDTH = host.WIDTH;
const HEIGHT = host.HEIGHT;
const WORD_LIMIT = 12000;

let checks = 0;
const failures = [];

function check(ok, name) {
  checks++;
  if (!ok) failures.push(name);
}
function eq(name, got, want) {
  check(JSON.stringify(got) === JSON.stringify(want),
        name + " (got " + JSON.stringify(got) + ", want " +
        JSON.stringify(want) + ")");
}

/* ---- pixels ------------------------------------------------------------ */

function cramWord(cram, addr) {
  return cram[addr * 2] | (cram[addr * 2 + 1] << 8);
}
/* the model's 3-bit channel -> 8-bit picture value (x36), as check-toys and
 * check-examples read it */
function cramRgb(cram, addr) {
  const v = cramWord(cram, addr);
  return [36 * ((v >> 3) & 7), 36 * ((v >> 6) & 7), 36 * (v & 7)];
}
function visibleIn(img, box) {
  const bg = cramRgb(img.state.cram, 0);
  let n = 0;
  for (let y = box[1]; y < box[3] && y < HEIGHT; y++) {
    for (let x = box[0]; x < box[2] && x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 3;
      if (img.pixels[i] === bg[0] && img.pixels[i + 1] === bg[1] &&
          img.pixels[i + 2] === bg[2]) continue;
      n++;
    }
  }
  return n;
}
/* A SAT entry's X word (word 1; SAT X 32 is display column 0).  Movement is
 * measured in the hardware's own table, so a toy that scrolls the
 * background instead of moving a sprite is not credited with a moving ship. */
function satX(frame, i) {
  return frame.state.sat[i * 8 + 2] | (frame.state.sat[i * 8 + 3] << 8);
}
function movedBySat(before, after) {
  for (let i = 0; i < host.SAT_ENTRIES; i++) {
    const a = satX(before, i), b = satX(after, i);
    if (b > a) return { entry: i, from: a, to: b };
  }
  return null;
}

/* ---- 1. the artifact is the generator's output ------------------------ */

function checkArtifact() {
  const want = guide.markdown();
  const have = fs.existsSync(GUIDE_PATH)
    ? fs.readFileSync(GUIDE_PATH, "utf8") : "";
  check(have === want,
        "renderer/pcestudio-for-claude.md is byte-equal to the generator's " +
        "Markdown (" + have.length + " vs " + want.length + " bytes)");

  const tool = spawnSync(process.execPath,
                         [path.join(ROOT, "tools", "docs.js"), "--check"],
                         { encoding: "utf8" });
  eq("tools/docs.js --check exits 0", tool.status, 0);

  const gen = spawnSync(process.execPath,
                        [path.join(ROOT, "tools", "docs.js"), "--claude"],
                        { encoding: "utf8" });
  eq("tools/docs.js --claude exits 0", gen.status, 0);
  eq("--claude regenerates the same bytes",
     fs.readFileSync(GUIDE_PATH, "utf8"), want);
}

function checkHandEditFails() {
  const original = fs.readFileSync(GUIDE_PATH, "utf8");
  try {
    fs.writeFileSync(GUIDE_PATH,
                     original.replace("The toy API", "The toy API 99999"));
    const tool = spawnSync(process.execPath,
                           [path.join(ROOT, "tools", "docs.js"), "--check"],
                           { encoding: "utf8" });
    check(tool.status !== 0,
          "a hand-written edit to the guide fails --check");
  } finally {
    fs.writeFileSync(GUIDE_PATH, original);
  }
  const after = spawnSync(process.execPath,
                          [path.join(ROOT, "tools", "docs.js"), "--check"],
                          { encoding: "utf8" });
  eq("the restored guide passes --check again", after.status, 0);
}

/* ---- the guide's lua blocks ------------------------------------------- */

function luaBlocks(md) {
  const blocks = [];
  const re = /```lua\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(md))) blocks.push(m[1]);
  return blocks;
}

/* The calls the runtime installs, read from the module that installs them:
 * the Lua surface is setGlobalFn("name", ...) plus the prelude's functions. */
function runtimeSurface() {
  const src = fs.readFileSync(path.join(ROOT, "renderer", "pce-toys.js"),
                              "utf8");
  const names = new Set();
  let m;
  const setter = /setGlobalFn\("([A-Za-z_]\w*)"/g;
  while ((m = setter.exec(src))) names.add(m[1]);
  /* the prelude's `function name(` lines, and its aliases */
  const fn = /"function ([A-Za-z_]\w*)\(/g;
  while ((m = fn.exec(src))) names.add(m[1]);
  for (const h of ["clamp", "lerp", "lerp_color", "ease", "ramp", "ramp_int",
                   "ramp_color", "rgb", "note"])
    names.add(h);
  for (const h of ["min", "max", "floor", "sin", "cos", "abs", "sqrt", "pi"])
    names.add(h);
  /* installed as globals without setGlobalFn: the vram proxy table, the pad
   * tables, and the password module */
  names.add("vram");
  names.add("pad");
  names.add("password");
  return names;
}

const LUA_BUILTINS = new Set([
  "assert", "error", "ipairs", "next", "pairs", "pcall", "print", "rawequal",
  "rawget", "rawlen", "rawset", "select", "setmetatable", "getmetatable",
  "tonumber", "tostring", "type", "xpcall", "unpack",
  "math", "string", "table", "utf8", "math.abs", "math.ceil", "math.floor",
  "math.huge", "math.max", "math.min", "math.random", "math.sqrt",
  "string.byte", "string.char", "string.find", "string.format", "string.len",
  "string.lower", "string.rep", "string.sub", "string.upper",
  "table.concat", "table.insert", "table.remove", "table.sort",
  "table.unpack"
]);

/* names defined in the block itself: its functions and their parameters
 * (a helper passed in as `fn` is called as fn(col, row), not an API name) */
function definedIn(block) {
  const names = new Set();
  const re = /\bfunction\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(block))) {
    names.add(m[1]);
    for (const param of m[2].split(",")) {
      const p = param.trim();
      if (/^[A-Za-z_]\w*$/.test(p)) names.add(p);
    }
  }
  return names;
}

function checkApiNames() {
  const md = guide.markdown();
  const surface = runtimeSurface();
  const blocks = luaBlocks(md);
  check(blocks.length >= 6, "the guide has its lua listings (" +
        blocks.length + " blocks)");

  /* A toy calling every surface name must be created without error: this is
   * what makes the surface set above the runtime's, not a list typed here. */
  const probe = toys.create(
    "function init() end\n" +
    "function frame(t, f)\n" +
    "  local a = clamp(1, 0, 2)\n" +
    "  local b = lerp(0, 10, 0)\n" +
    "  local c = lerp_color(0, 15, 0)\n" +
    "  local d = ease(0, \"smooth\")\n" +
    "  local e = ramp_int({ { 0, 0 } }, 0)\n" +
    "  local g = ramp_color({ { 0, 0 } }, 0)\n" +
    "  local h = rgb(0, 0, 0)\n" +
    "  local i = floor(0)\n" +
    "end\n", { budgetMs: 250 });
  probe.load();
  check(true, "a toy using the prelude helpers is created");

  for (const name of ["raster", "reg", "pal", "vram", "sat", "sprite", "pad",
                      "print", "music", "sfx", "release", "password", "rgb",
                      "note"])
    check(surface.has(name), "the runtime surface carries " + name);
  for (const hook of ["init()", "frame(t, f)", "raster(line)"])
    check(md.includes(hook), "the guide names the hook " + hook);

  let calls = 0;
  const unknown = new Set();
  for (const block of blocks) {
    const defined = definedIn(block);
    /* a comment's prose is not a call: `-- asphalt (raster rewrites it)` */
    const codeOnly = block.replace(/--[^\n]*/g, "");
    const re = /\b([A-Za-z_][\w.]*)\s*\(/g;
    let m;
    while ((m = re.exec(codeOnly))) {
      const name = m[1];
      if (["if", "for", "while", "return", "function", "local", "end",
           "then", "do", "else", "elseif", "and", "or", "not", "in"].includes(name))
        continue;
      calls++;
      if (defined.has(name) || surface.has(name) || LUA_BUILTINS.has(name))
        continue;
      /* a member call through a known table is the table's */
      const head = name.split(".")[0];
      if (surface.has(head) || LUA_BUILTINS.has(head) ||
          ["password", "math", "string", "table", "utf8"].includes(head))
        continue;
      unknown.add(name);
    }
  }
  check(calls > 100, "the guide's code calls the API (" + calls + " calls)");
  eq("no invented call name in the guide's code", [...unknown].sort(), []);

  /* every register, pad field and sound call is named (they are the API the
   * card names, and the generator reads them from the tables) */
  for (const r of host.REGISTERS)
    check(md.includes("reg(\"" + r.name + "\""),
          "the guide names reg(\"" + r.name + "\")");
  for (const f of host.PAD_FIELDS)
    check(md.includes("." + f), "the guide names pad[]. " + f);
  for (const a of host.SOUND_API) {
    const name = a.call.slice(0, a.call.indexOf("("));
    check(md.includes(name + "("), "the guide names " + name + "()");
  }
  check(md.includes("password.pack") && md.includes("password.unpack"),
        "the guide names password.pack/unpack");
}

/* ---- 3. the ranges, and the code enforcing them ---------------------- */

function boundary(name, fn, code) {
  let got = null;
  try { fn(); } catch (e) { got = e && e.code; }
  eq(name + " is " + code, got, code);
}

function checkRanges() {
  const md = guide.markdown();
  const h = host.createHost();
  for (const r of host.REGISTERS) {
    check(md.includes("0.." + r.max),
          "the guide prints " + r.name + "'s 0.." + r.max);
    eq("reg(" + r.name + ", " + r.max + ") is stored",
       h.reg(r.name, r.max), r.max);
    boundary("reg(" + r.name + ", " + (r.max + 1) + ")",
             () => h.reg(r.name, r.max + 1), "reg-range");
  }
  check(md.includes("0.." + (host.CRAM_ENTRIES - 1)) &&
        md.includes("0.." + host.CRAM_WORD_MAX),
        "the guide prints pal's address and word ranges");
  boundary("pal(" + host.CRAM_ENTRIES + ", 0)",
           () => h.pal(host.CRAM_ENTRIES, 0), "pal-range");
  boundary("pal(0, " + (host.CRAM_WORD_MAX + 1) + ")",
           () => h.pal(0, host.CRAM_WORD_MAX + 1), "pal-range");

  check(md.includes("0.." + (host.VRAM_WORDS - 1)),
        "the guide prints vram's address range");
  boundary("vram[" + host.VRAM_WORDS + "]",
           () => h.vramSet(host.VRAM_WORDS, 0), "vram-range");

  check(md.includes("0.." + (host.SAT_ENTRIES - 1)),
        "the guide prints the SAT entry range");
  boundary("sat(" + host.SAT_ENTRIES + ", 0, 0)",
           () => h.sat(host.SAT_ENTRIES, 0, 0), "sat-range");
  boundary("sat(0, " + host.SAT_WORDS + ", 0)",
           () => h.sat(0, host.SAT_WORDS, 0), "sat-range");

  const F = host.SAT_FIELD_RANGES;
  for (const f of ["x", "y", "pattern", "palette", "cgy"])
    check(md.includes("0.." + F[f][1]),
          "the guide prints sprite " + f + "'s 0.." + F[f][1]);
  boundary("sprite x " + (F.x[1] + 1),
           () => h.sprite(0, { x: F.x[1] + 1 }), "sprite-range");
  boundary("sprite palette " + (F.palette[1] + 1),
           () => h.sprite(0, { palette: F.palette[1] + 1 }), "sprite-range");

  check(md.includes("0.." + (host.VDW_LINES - 1)),
        "the guide prints the raster line range");
  boundary("raster line " + host.VDW_LINES,
           () => h.raster(host.VDW_LINES, { bxr: 0 }), "raster-line");

  check(md.includes("at most " + host.RASTER_WRITES_MAX + " colour writes"),
        "the guide prints the per-line colour-write cap");
  boundary("a second raster entry on one line", () => {
    h.raster(0, { bxr: 0 });
    h.raster(0, { bxr: 1 });
  }, "raster-line-full");

  check(md.includes("n 1.." + host.PAD_COUNT),
        "the guide prints the pad count");
  boundary("pad " + (host.PAD_COUNT + 1),
           () => h.setPad(host.PAD_COUNT + 1, {}), "pad-range");

  const P = toys.PASSWORD;
  check(md.includes(P.minInt + ".." + P.maxInt),
        "the guide prints the password integer range");
  check(md.includes("at most " + P.maxString + " bytes"),
        "the guide prints the password string cap");
  boundary("password code", () => {
    const rt = toys.create("function init() password.unpack(\"nope\") end",
                            { budgetMs: 250 });
    rt.load();
  }, "password-code");
  boundary("password value", () => {
    const rt = toys.create("function init() password.pack(1.5) end",
                            { budgetMs: 250 });
    rt.load();
  }, "password-value");

  check(md.includes("channel 0.." + (host.SOUND_CHANNELS - 1)) &&
        md.includes("freq 0.." + host.PITCH_MAX) &&
        md.includes("volume 0.." + host.SOUND_VOLUME_MAX) &&
        md.includes("frames 1.." + host.SFX_FRAMES_MAX),
        "the guide prints the sound ranges");
  boundary("sfx channel " + host.SOUND_CHANNELS,
           () => h.sfx(host.SOUND_CHANNELS, 0, 0, 1), "sfx-range");

  check(md.includes(toys.BUDGET_MS + " ms"),
        "the guide prints the Lua hook budget");
  check(md.includes(formatNum(il.MAX_INSTRUCTIONS) + " IL instructions"),
        "the guide prints the IL instruction budget");
  check(md.includes(formatNum(validate.MODEL.ROM_LIMIT) + " bytes"),
        "the guide prints the cartridge limit");
  check(md.includes(editor.LINE_STRIPS + " strips of " + editor.STRIP_PX +
                    " pixels"),
        "the guide prints the per-line sprite budget");
}

function formatNum(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/* ---- 4. a code change moves the guide --------------------------------- */

function checkFollowsCode() {
  const cases = [
    { name: "the BXR register range", holder: host.REGISTERS[0], key: "max",
      was: host.REGISTERS[0].max, now: 0x2FF,
      inDoc: "| 0..767 (10 bits); reg-range |",
      gone: "| 0..1023 (10 bits); reg-range |" },
    { name: "the colour-table size", holder: host, key: "CRAM_ENTRIES",
      was: host.CRAM_ENTRIES, now: 256,
      inDoc: "addr 0..255", gone: "addr 0..511" },
    { name: "the raster write cap", holder: host, key: "RASTER_WRITES_MAX",
      was: host.RASTER_WRITES_MAX, now: 32,
      inDoc: "at most 32 colour writes", gone: "at most 64 colour writes" },
    { name: "the SAT size", holder: host, key: "SAT_ENTRIES",
      was: host.SAT_ENTRIES, now: 32,
      inDoc: "i 0..31", gone: "i 0..63" },
    { name: "the pad count", holder: host, key: "PAD_COUNT",
      was: host.PAD_COUNT, now: 3,
      inDoc: "n 1..3", gone: "n 1..5" },
    { name: "the password string cap", holder: toys.PASSWORD, key: "maxString",
      was: toys.PASSWORD.maxString, now: 32,
      inDoc: "at most 32 bytes", gone: "at most 64 bytes" },
    { name: "the PSG channel count", holder: psg, key: "CHANNELS",
      was: psg.CHANNELS, now: 8,
      inDoc: "The HuC6280 PSG has 8 channels", gone: "PSG has 6 channels" },
    { name: "the IL instruction budget", holder: il, key: "MAX_INSTRUCTIONS",
      was: il.MAX_INSTRUCTIONS, now: 1000,
      inDoc: "1,000 IL instructions", gone: "5,000,000 IL instructions" },
    { name: "the per-line sprite budget", holder: editor, key: "LINE_STRIPS",
      was: editor.LINE_STRIPS, now: 8,
      inDoc: "8 strips of 16 pixels (128 pixels)",
      gone: "16 strips of 16 pixels (256 pixels)" },
    { name: "the cartridge limit", holder: validate.MODEL, key: "ROM_LIMIT",
      was: validate.MODEL.ROM_LIMIT, now: 524288,
      inDoc: "524,288 bytes", gone: "1,048,576 bytes" },
    { name: "the tile budget", holder: editor, key: "MAX_TILES",
      was: editor.MAX_TILES, now: 1024,
      inDoc: "1024 tiles", gone: "1536 tiles" },
    { name: "the display lines", holder: host, key: "VDW_LINES",
      was: host.VDW_LINES, now: 112,
      inDoc: "every display line 0..111 after frame()",
      gone: "every display line 0..223 after frame()" }
  ];

  for (const c of cases) {
    c.holder[c.key] = c.now;
    let md;
    try { md = guide.markdown(); }
    finally { c.holder[c.key] = c.was; }
    check(md.includes(c.inDoc),
          "change " + c.name + " -> the guide carries " +
          JSON.stringify(c.inDoc));
    check(!md.includes(c.gone),
          "change " + c.name + " -> the guide loses " +
          JSON.stringify(c.gone));
    check(guide.markdown().includes(c.gone),
          "restoring " + c.name + " -> the guide returns to " +
          JSON.stringify(c.gone));
  }
}

/* ---- 5. the examples run ---------------------------------------------- */

function runToy(source, frames) {
  const rt = toys.create(source, { budgetMs: 250 });
  rt.load();
  const out = [];
  for (let f = 0; f < frames; f++) {
    rt.setPad(1, f >= 2 ? { right: true } : {});
    out.push(rt.frame(f));
  }
  return out;
}

function checkExample(name, source, needsMovement) {
  let frames = null, err = null;
  try { frames = runToy(source, 10); } catch (e) { err = e; }
  check(!err, name + " runs in the Lua runtime" +
        (err ? " (" + err.code + ": " + err.message + ")" : ""));
  if (err) return;
  const vis = visibleIn(frames[9], [0, 0, WIDTH, HEIGHT]);
  check(vis > 1000, name + " is VISIBLE at frame 9 (" + vis +
        " non-backdrop pixels)");

  const report = validate.validate(source, { frames: 3 });
  check(report.ok, name + " is validator-clean" +
        (report.ok ? "" : " (" + report.problems.filter(
          (p) => p.severity === "error").map((p) => p.code).join(",") + ")"));

  if (needsMovement) {
    const moved = movedBySat(frames[1], frames[9]);
    check(!!moved, name + " moves a sprite right with pad 1" +
          (moved ? " (entry " + moved.entry + ": X " + moved.from + " -> " +
                   moved.to + ")" : ""));
  }
}

function checkExamples() {
  checkExample("the starter program", guide.STARTER, true);
  const md = guide.markdown();
  const blocks = luaBlocks(md);
  for (const file of guide.TOY_FILES) {
    const source = fs.readFileSync(path.join(ROOT, "toys", file), "utf8");
    check(blocks.some((b) => b.trimEnd() === source.trimEnd()),
          "the guide carries toys/" + file + " verbatim");
    checkExample("toys/" + file, source, false);
  }
}

function checkColdSeat() {
  check(fs.existsSync(TRANSCRIPT_PATH),
        "docs/GUIDE-TRANSCRIPT.md records the cold seat");
  if (!fs.existsSync(TRANSCRIPT_PATH)) return;
  const transcript = fs.readFileSync(TRANSCRIPT_PATH, "utf8");
  const m = /```lua\n([\s\S]*?)```/.exec(transcript);
  check(!!m, "the transcript carries the seat's main.lua");
  if (!m) return;
  checkExample("the cold seat's main.lua", m[1], true);
}

/* ---- 6b. the cold review's findings (#141) ---------------------------- */

function refSection(id) {
  return docs.reference().sections.find((s) => s.id === id);
}
function codeOf(sec) {
  const b = sec && sec.blocks.find((block) => block.type === "code");
  return b ? b.text : "";
}
function parasOf(sec) {
  return sec ? sec.blocks.filter((b) => b.type === "p")
                      .map((b) => b.text).join(" ") : "";
}

/* Each check below is written so the OLD text fails it: the old string is
 * asserted gone, not just the new one present.  That is the control — run
 * this file against HEAD's generator and it reports one failure per item. */
function checkReviewFixes() {
  const md = guide.markdown();
  const h = host;
  const firstPattern = h.BAT_WORDS / 64;
  const lastPattern = editor.SAT_ADDR / 64 - 1;

  /* (1) every BXR that grows with the frame is wrapped, and 10.1 is integer */
  const parallax = fs.readFileSync(path.join(ROOT, "toys", "parallax.lua"),
                                   "utf8");
  check(!/reg\("BXR", g_f \/\/ 2\)/.test(parallax),
        "parallax's g_f // 2 band is wrapped (old line gone)");
  check(!/reg\("BXR", g_f\)/.test(parallax),
        "parallax's g_f band is wrapped (old line gone)");
  check(!md.includes("floor(t * 32)"),
        "the 10.1 example no longer does floor(t * 32) (old line gone)");
  check(md.includes('reg("BXR", (f * 2) % ' + (h.ALLOWED_REGS.BXR + 1) + ")"),
        "the 10.1/10.2 examples wrap BXR with the integer frame number f");

  /* (2) the starter is cartridge-ready: no table, and pce-cgen lowers it */
  check(!/sprite\(\s*0\s*,\s*\{/.test(guide.STARTER.replace(/--[^\n]*/g, "")),
        "the starter no longer calls sprite(0, {...}) (old line gone)");
  check(/sat\(0, 0, sy\)/.test(guide.STARTER) &&
        /sat\(0, 3, 0\)/.test(guide.STARTER),
        "the starter places SAT entry 0 with four sat() words");
  let starterC = null, starterErr = null;
  try { starterC = cgen.emitC(il.compile(guide.STARTER,
                                         { chunkName: "main.lua" })); }
  catch (e) { starterErr = e; }
  check(!starterErr && typeof starterC === "string" && starterC.length > 0,
        "the starter really is cartridge-ready: pce-cgen lowers it" +
        (starterErr ? " (" + (starterErr.code || starterErr.name) + ": " +
                      starterErr.message + ")" : ""));

  /* (3) the real free pattern range, and a sprites example that shows */
  check(md.includes(firstPattern + ".." + lastPattern),
        "the guide prints the default layout's free sprite-pattern range " +
        firstPattern + ".." + lastPattern);
  check(!md.includes("below 512"),
        "the old 'below 512' pattern claim is gone");
  const sprCode = codeOf(refSection("sprites"));
  check(/reg\("CR", 0xC0\)/.test(sprCode),
        "the sprites example turns sprites on with reg(\"CR\", 0xC0)");
  check(!/pattern = 0[,}]/.test(sprCode),
        "the sprites example does not use pattern 0 (old line gone)");

  /* (4) examples follow the guide's own rules */
  check(!md.includes("64 + floor(32 * sin(t))"),
        "the 10.2 example no longer uses sin(t)/floor (old line gone)");
  const pwCode = codeOf(refSection("passwords"));
  check(/function init\(\)/.test(pwCode) && !/function frame/.test(pwCode),
        "the password example prints once in init(), not every frame " +
        "(old frame() line gone)");

  /* (5) sound works from a paste: no music(0), and note() is in section 4 */
  const sndCode = codeOf(refSection("sound"));
  check(!sndCode.includes("music(0)"),
        "the sound example no longer calls music(0) (old line gone)");
  check(sndCode.includes("sfx(") && sndCode.includes("note("),
        "the sound example uses sfx() with note()");
  const sndText = parasOf(refSection("sound"));
  check(sndText.includes("music-range") && sndText.includes("song.json") &&
        sndText.includes("songsFromFiles"),
        "the sound chapter says a toy's song.json is its music() list " +
        "(pce-seq songsFromFiles), and no song file is music-range");
  const apiSec = guide.guide().sections.find((s) => s.id === "api");
  const apiRows = apiSec.blocks.find((b) => b.type === "table").rows;
  check(apiRows.some((r) => /^note\(/.test(r[0])),
        "the section 4 API table lists note()");

  /* (6) pad BUTTON names and keyboard keys are told apart */
  check(md.includes("I button (key N)") && md.includes("Up (key I)"),
        "the guide says \"I button (key N)\" and \"Up (key I)\", never " +
        "an ambiguous \"press I\"");
  check(!md.includes("(I up,") &&
        !md.includes("N and M as the I and II buttons"),
        "the old ambiguous keyboard sentence is gone");
  /* the key table the guide prints is the pages' own binding */
  const studioHtml = fs.readFileSync(path.join(ROOT, "renderer", "studio.html"),
                                     "utf8");
  const toyHtml = fs.readFileSync(path.join(ROOT, "renderer", "toy.html"),
                                  "utf8");
  const keys = h.PAD_KEYS || {};
  for (const field of h.PAD_FIELDS) {
    const binding = "Key" + keys[field] + ': "' + field + '"';
    check(studioHtml.includes(binding) && toyHtml.includes(binding),
          "pad button " + field + " is key " + keys[field] +
          " on both pages");
  }

  /* (7) the four missing refusal codes are in section 9, with meanings */
  const index = docs.refusalIndex();
  const errorRows = guide.guide().sections.find((s) => s.id === "errors")
    .blocks.find((b) => b.type === "table").rows;
  for (const code of ["il-pad-write", "tile-space", "validate-rom",
                      "cgen-op"]) {
    check(index[code] && index[code].description,
          "the refusal index has a meaning for " + code);
    check(errorRows.some((r) => r[0] === code),
          "section 9 lists " + code);
  }

  /* (7b) the page a stranger reads carries no internal bookkeeping */
  check(!/#\d/.test(md), "the guide carries no internal card number");
  check(!md.includes("(Dennis"), "the guide carries no personal attribution");
}

/* ---- 6c. every example runs 3,600 frames (past frame 2048) ------------ */

function checkLongExamples() {
  const md = guide.markdown();
  const blocks = luaBlocks(md);
  const parallax = fs.readFileSync(path.join(ROOT, "toys", "parallax.lua"),
                                   "utf8");
  let parallaxErr = null, sawParallax = false;
  for (let i = 0; i < blocks.length; i++) {
    let err = null;
    try {
      const rt = toys.create(blocks[i], { budgetMs: 250 });
      rt.load();
      for (let f = 0; f < 3600; f++) rt.frame(f);
    } catch (e) { err = e; }
    check(!err, "guide lua block " + (i + 1) + " runs 3,600 frames clean" +
          (err ? " (" + (err.code || err.name) + ": " + err.message + ")" : ""));
    if (blocks[i].trimEnd() === parallax.trimEnd()) {
      sawParallax = true;
      parallaxErr = err;
    }
  }
  check(sawParallax, "the guide's listing of parallax is the one long-run");
  check(!parallaxErr, "toys/parallax.lua runs past frame 2048 without " +
        "reg-range (3,600 frames)" +
        (parallaxErr ? " (" + (parallaxErr.code || parallaxErr.name) + ": " +
                       parallaxErr.message + ")" : ""));
}

/* ---- 7. it fits a chat, and ends with the button's name --------------- */

function checkSize() {
  const md = guide.markdown();
  const words = md.split(/\s+/).filter(Boolean).length;
  check(words <= WORD_LIMIT, "the guide is " + words + " words, within " +
        formatNum(WORD_LIMIT));
  check(md.includes(guide.COPY_LINE),
        "the guide carries the exact line: " + guide.COPY_LINE);
  eq("the line names the button exactly", guide.COPY_LINE,
     "Copy this code, then press Paste & Run in the studio");
}

/* ---- 8. the MCP route near the top (#142) ----------------------------- */

/* The tools the server really has, read out of renderer/pce-agent-tools.js's
 * TOOLS array — not typed here, so a tool the core gains without the guide
 * naming it fails this test.  (#166: the TOOLS array moved from
 * tools/mcp/server.js into the one tool core; the server takes it from its
 * session now, and this extraction follows it.) */
function serverToolNames() {
  const src = fs.readFileSync(path.join(ROOT, "renderer", "pce-agent-tools.js"),
                              "utf8");
  const start = src.indexOf("const TOOLS = [");
  const end = start < 0 ? -1 : src.indexOf("\n  ];", start);
  const body = start < 0 ? "" : src.slice(start, end < 0 ? src.length : end);
  const names = [];
  for (const m of body.matchAll(/\bname:\s*"([a-z_]+)"/g)) names.push(m[1]);
  return names;
}

function checkMcpSection() {
  const g = guide.guide();
  const idx = g.sections.findIndex((s) => s.id === "mcp");
  check(idx >= 0, "the guide carries the MCP section (#142)");
  check(idx === 0, "the MCP section is the guide's first section, near the " +
        "top (it is at " + idx + ")");
  if (idx < 0) return;

  const md = guide.markdown();
  const from = md.indexOf("## " + g.sections[idx].title);
  const next = md.indexOf("\n## ", from + 1);
  const sec = from < 0 ? "" : md.slice(from, next < 0 ? md.length : next);
  check(sec.length > 0, "the MCP section is in the generated Markdown");

  const url = guide.STUDIO_URL + "/pcestudio-mcp.zip";
  check(sec.includes("git clone https://github.com/terracide303/PCEStudio-public"),
        "the section offers the clone of the now-public repository (#146 " +
        "draft)");
  check(sec.includes(url), "the section gives the download: " + url);
  check(sec.includes("claude mcp add pcestudio -- node <folder>/tools/mcp/server.js"),
        "the section gives the exact install command");
  check(sec.includes("plugin/skills/creating-pce-toys"),
        "the section says which skill to link");

  const tools = serverToolNames();
  check(tools.length >= 8, "tools/mcp/server.js's TOOLS was read (" +
        tools.length + " tools)");
  for (const t of tools) {
    check(sec.includes(t), "the MCP section names the tool " + t);
  }

  check(/paste-and-run route/.test(sec),
        "the section says the chat AI without tools keeps the paste-and-run " +
        "route");
}

/* ---- main ------------------------------------------------------------- */

function main() {
  checkArtifact();
  checkHandEditFails();
  checkApiNames();
  checkRanges();
  checkFollowsCode();
  checkExamples();
  checkColdSeat();
  checkReviewFixes();
  checkLongExamples();
  checkSize();
  checkMcpSection();

  if (failures.length) {
    for (const f of failures) console.log("FAIL  " + f);
    console.log("FAIL  " + failures.length + " of " + checks +
                " checks failed");
    process.exit(1);
  }
  const words = guide.markdown().split(/\s+/).filter(Boolean).length;
  console.log("PASS  " + checks + " checks: the guide is the generator's " +
              "bytes, every API name and range is the code's, the 12 tables " +
              "move it, the starter and the five toys run visible and " +
              "validator-clean, the cold seat's main.lua runs too, the cold " +
              "review's seven findings stay fixed, every listing runs 3,600 " +
              "frames clean, the MCP section is first and names every tool " +
              "the server has, and it is " + words + " words");
}

if (require.main === module) main();
