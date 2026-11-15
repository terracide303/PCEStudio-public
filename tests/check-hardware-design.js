#!/usr/bin/env node
/*
 * tests/check-hardware-design.js — the hardware-design docs topic and the
 * three example toys it points at.
 *
 *   1. The topic resolves where the Claude reads it: docs('hardware-design')
 *      through the MCP session, docs.html's section and nav entry, the Claude
 *      Code manual's generated chapter; it names no board cards.
 *   2. Every number in the topic is accounted for: a module constant (host,
 *      editor, psg, songbank, validate's model), a figure derived from them
 *      and recomputed here, or a range from docs/HUCARD-BUDGETS.md.  Each
 *      commercial range carries the sentence of the study it comes from; the
 *      sentence must be in the study and every number in the range's text
 *      (digits or spelled out) must be in that sentence.
 *   3. The three examples exist, are named by the topic, and each passes
 *      validate, rom_check and export_pce through the MCP session (the very
 *      calls the connected Claude makes); the budgets in each header comment
 *      equal what validate and rom_check measure; the ROM export is the
 *      independent il -> ilbc -> rom build byte for byte.
 *   4. The server's instructions point at the topic.
 *
 * Written by @design.  Per workshop rule 2 it is the author's own test and
 * proves only what the author thought of; a cold break by another seat is
 * owed before the card closes.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const docs = require("../renderer/pce-docs.js");
const host = require("../renderer/pce-toyhost.js");
const editor = require("../renderer/pce-editor.js");
const psg = require("../renderer/pce-psg.js");
const validate = require("../renderer/pce-validate.js");
const songbank = require("../renderer/pce-songbank.js");
const romcheck = require("../renderer/pce-romcheck.js");
const rom = require("../renderer/pce-rom.js");
const il = require("../renderer/pce-il.js");
const ilbc = require("../renderer/pce-ilbc.js");
const server = require("../tools/mcp/server.js");

const ROOT = path.resolve(__dirname, "..");
let checks = 0;
const failures = [];
function check(ok, name) { checks++; if (!ok) failures.push(name); }
function eq(name, got, want) {
  check(JSON.stringify(got) === JSON.stringify(want),
        name + " (got " + JSON.stringify(got) + ", want " +
        JSON.stringify(want) + ")");
}

const HW = docs.HARDWARE_DESIGN;
const TOPIC = "hardware-design";

function section() {
  return docs.reference().sections.find((s) => s.id === TOPIC);
}

function blocksText(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.type === "p" || b.type === "h3") out.push(b.text);
    else if (b.type === "table") {
      out.push(b.headers.join(" | "));
      for (const row of b.rows) out.push(row.join(" | "));
    }
  }
  return out.join("\n");
}

/* "one" is left out: it is a pronoun as often as a count */
const SPELLED = { zero: 0, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

/* the numbers in a text, digits and spelled-out small numbers, with the
 * thousands commas removed */
function numbersIn(text) {
  const out = [];
  const t = String(text).replace(/(\d),(\d)/g, "$1$2");
  let m;
  const re = /\d+|\b(zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi;
  while ((m = re.exec(t))) {
    out.push(/\d/.test(m[0]) ? Number(m[0]) : SPELLED[m[0].toLowerCase()]);
  }
  return out;
}

/* ---- 1. the topic resolves --------------------------------------------- */

async function checkTopic() {
  const sec = section();
  check(!!sec, "the reference has a hardware-design chapter");
  if (!sec) return;
  eq("exactly one section resolves the topic id",
     docs.reference().sections.filter((s) => s.id === TOPIC).length, 1);
  const html = fs.readFileSync(path.join(ROOT, "renderer", "docs.html"),
                               "utf8");
  check(html.includes('<section id="hardware-design">'),
        "docs.html carries the hardware-design section");
  check(html.includes('<a href="#hardware-design">'),
        "docs.html's nav links the chapter");
  const manual = fs.readFileSync(path.join(ROOT, "renderer",
                                           "claude-code.html"), "utf8");
  for (const want of ["Sprites: ", "Music and sound", "Three complete " +
                      "examples", "The self-check: the usage report"]) {
    check(manual.includes(want),
          "claude-code.html's generated chapter carries " +
          JSON.stringify(want));
  }
  const text = blocksText(sec.blocks);
  check(!/#\d{1,3}\b/.test(text), "the topic names no board cards");
  for (const want of ["multiplex", "keep rows clear", "Park idle sprites",
                      "BXR", "validate-sprite-line", "toy-song-bank-full",
                      "validate-slow-frame", "usage"]) {
    check(text.toLowerCase().indexOf(want.toLowerCase()) >= 0,
          "the topic says " + JSON.stringify(want));
  }
  const reply = await server.session.call("docs", { topic: TOPIC });
  const value = JSON.parse(reply.content[0].text);
  eq("docs('hardware-design') resolves through the server session",
     value.ok, true);
  check(value.markdown.indexOf("## Designing for the hardware") >= 0,
        "the topic's markdown is the chapter");
  const listing = JSON.parse((await server.session.call("docs", {}))
                               .content[0].text);
  check(listing.topics.some((t) => t.id === TOPIC),
        "the docs tool's topic list names hardware-design");
  const src = fs.readFileSync(path.join(ROOT, "tools", "mcp", "server.js"),
                              "utf8");
  check(src.indexOf('topic \\"hardware-design\\"') >= 0 &&
        src.indexOf("usage object") >= 0,
        "the server's instructions point at the topic and the usage object");
  const gen = spawnSync(process.execPath,
                        [path.join(ROOT, "tools", "docs.js"), "--check"],
                        { encoding: "utf8" });
  eq("tools/docs.js --check exits 0", gen.status, 0);
}

/* ---- 2. every number is accounted for ---------------------------------- */

function checkNumbers() {
  const study = fs.readFileSync(path.join(ROOT, "docs",
                                          "HUCARD-BUDGETS.md"), "utf8")
    .replace(/\s+/g, " ");
  /* the commercial ranges: the sentence is in the study, and the range's
   * numbers are the sentence's */
  const commercialNumbers = new Set();
  for (const key of Object.keys(HW.commercial)) {
    const c = HW.commercial[key];
    const sentences = [].concat(c.doc);
    for (const d of sentences) {
      check(study.indexOf(d) >= 0,
            "commercial " + key + ": the study says " + JSON.stringify(d));
    }
    const inDoc = new Set(numbersIn(sentences.join(" ")));
    for (const n of numbersIn(c.text)) {
      check(inDoc.has(n), "commercial " + key + ": the number " + n +
            " of the text is in the study's " + JSON.stringify(c.doc));
      commercialNumbers.add(n);
    }
    for (const n of inDoc) commercialNumbers.add(n);
  }

  /* the figures, recomputed here without the generator's helpers */
  const f = HW.figures();
  eq("a pixel is 4 bits", f.bpp, 4);
  eq("a tile is 16 words", f.tileWords, 16);
  eq("a 16 x 16 sprite pattern is 64 words", f.cellWords, 64);
  eq("the example scene's words", f.scene.words,
     1024 + 256 * 16 + 24 * 64);
  eq("half rate", f.halfRate, 30);
  eq("a song's even share", f.songAverage, Math.floor(8160 / 8));
  eq("noise channels", f.noise, [4, 5]);
  for (const c of f.cost) {
    eq("cost row " + c.op + " per frame", c.perFrame,
       Math.floor(119318 / c.cycles));
  }
  /* the hand-held constants the figures rest on, pinned to the modules */
  eq("a frame is 119,318 cycles", validate.MODEL.FRAME_CLOCKS, 119318);
  eq("the PSG has six channels", psg.CHANNELS, 6);
  eq("a song bank holds 8,160 bytes", songbank.TRAILER, 8160);
  eq("a ROM carries eight songs", songbank.MAX_SONGS, 8);

  const allowed = new Set();
  const add = (v) => { if (typeof v === "number" && isFinite(v)) allowed.add(v); };
  [host.SAT_ENTRIES, host.VRAM_WORDS, host.BAT_WORDS, host.VDW_LINES,
   host.FRAME_HZ, host.WIDTH / 8, host.SFX_FRAMES_MAX,
   host.CRAM_WORD_MAX >> 6, host.REGISTERS[0].bits, editor.TILE, editor.STRIP_PX,
   editor.LINE_STRIPS, editor.PALETTES, editor.SPRITE_PALETTES,
   editor.ENTRIES, psg.CHANNELS, psg.WAVE_STEPS, songbank.MAX_SONGS,
   songbank.TRAILER, validate.MODEL.FRAME_CLOCKS, validate.MODEL.HARD_FRAMES,
   rom.SONG_TABLE_OFF, romcheck.NEAR_PERCENT,
   f.bpp, f.tileWords, f.cellWords, f.scene.tiles, f.scene.patterns,
   f.scene.words, f.scene.percent, f.halfRate, f.songAverage,
   f.interpRaster, f.interpPlain].forEach(add);
  f.noise.forEach(add);
  f.cost.forEach((c) => { add(c.cycles); add(c.perFrame); });
  editor.SPRITE_SIZES.forEach((z) => {
    add(z.width); add(z.height); add(z.cells * f.cellWords);
    add(z.width / editor.STRIP_PX);
  });
  commercialNumbers.forEach(add);
  /* plain counting words that are not budget claims: indices, "two
   * channels", "one strip", "three examples", "four bands" */
  [0, 1, 2, 3, 4].forEach(add);

  const sec = section();
  const bad = [];
  for (const n of numbersIn(blocksText(sec.blocks)
        .replace(/[A-Za-z_]+\.lua|BXR|BYR|CR\b|Hz/g, ""))) {
    if (!allowed.has(n)) bad.push(n);
  }
  eq("every number in the topic is a constant, a recomputed figure or the " +
     "study's", Array.from(new Set(bad)), []);

  /* the scanner scans: a planted number fails it */
  const planted = numbersIn("a planted 99999 here").filter((n) => !allowed.has(n));
  eq("a planted number is caught", planted, [99999]);
}

/* ---- 3. the examples ---------------------------------------------------- */

async function call(name, args) {
  const reply = await server.session.call(name, args || {});
  return JSON.parse(reply.content[0].text);
}

/* The header lines of an example: "--   label: A of B". */
function headerBudgets(src) {
  const out = [];
  const re = /^--   ([a-z ]+): (\d+) of (\d+)\s*$/gm;
  let m;
  while ((m = re.exec(src))) {
    out.push({ label: m[1], used: Number(m[2]), limit: Number(m[3]) });
  }
  return out;
}

async function checkExamples() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pce-examples-"));
  eq("the topic names the three examples", HW.examples.map((e) => e.file),
     ["toys/examples/shooter.lua", "toys/examples/platformer.lua",
      "toys/examples/raster-scroll.lua"]);
  const listed = fs.readdirSync(path.join(ROOT, "toys", "examples"))
    .filter((n) => /\.lua$/.test(n)).sort();
  /* the sound guide's two single-file examples live beside them
   * (tests/check-sound-guide.js holds those) */
  eq("toys/examples holds exactly the named toys", listed,
     HW.examples.map((e) => path.basename(e.file))
       .concat(["sound-jump-shoot.lua", "noise-explosion.lua"]).sort());
  const topicText = blocksText(section().blocks);

  for (const ex of HW.examples) {
    const file = path.join(ROOT, ex.file);
    const source = fs.readFileSync(file, "utf8");
    const name = path.basename(ex.file);
    check(topicText.indexOf(ex.file) >= 0, "the topic names " + ex.file);
    check(/^-- [a-z-]+\.lua — /.test(source),
          name + " opens with a header comment");
    check(!/#\d{1,3}\b/.test(source.split("\n").filter((l) =>
          /^--/.test(l)).join("\n")), name + "'s comments name no cards");

    const wrote = await call("toy_write", {
      files: [{ name: "main.lua", source: source }]
    });
    check(wrote.ok !== false, name + " loads through toy_write");
    const v = await call("validate", {});
    check(v.ok && v.problems.filter((p) => p.severity === "error").length ===
          0, name + " passes validate" +
          (v.ok ? "" : " (" + v.code + ")"));
    eq(name + " has no validate findings at all", v.problems, []);
    const rc = await call("rom_check", {});
    check(rc.ok && rc.findings.length === 0, name + " rom_checks clean");
    check(rc.budget.rows.every((r) => r.status === "ok"),
          name + "'s every budget row is under " + romcheck.NEAR_PERCENT +
          " percent");
    const out = path.join(tmp, name + ".pce");
    const ex2 = await call("export_pce", { name: name, out: out });
    check(ex2.ok === true, name + " exports through export_pce");
    if (ex2.ok) {
      const program = il.compile(source, { chunkName: "main.lua" });
      const bytes = rom.buildToyRom({
        bank0: fs.readFileSync(path.join(ROOT, "renderer", "ilvm.bin")),
        bytecode: ilbc.encode(program).bytes
      });
      const got = fs.readFileSync(ex2.path);
      check(Buffer.compare(got, Buffer.from(bytes)) === 0,
            name + "'s export is the independent build byte for byte");
    }

    /* the header's budgets are what the tools measure */
    const usage = rc.usage;
    const rows = (id) => rc.budget.rows.filter((r) => r.id === id)[0];
    const want = {
      "sprites used": usage.sprites,
      "strips on the busiest line": usage.sprite_strips_on_busiest_line,
      "sprite palettes used": usage.sprite_palettes,
      "background palettes used": usage.bg_palettes,
      "raster entries": usage.raster_entries,
      "interpreter functions": rows("functions"),
      "bytecode bytes": rows("data-bank"),
      "registers": rows("registers"),
      "globals": rows("globals"),
      "table slots": rows("table-slots")
    };
    const header = headerBudgets(source);
    check(header.length >= 5, name + "'s header lists its budgets (" +
          header.length + " lines)");
    for (const h of header) {
      const w = want[h.label];
      check(!!w, name + ": the header label " + JSON.stringify(h.label) +
            " is one the usage report has");
      if (w) eq(name + ": header '" + h.label + "'",
                [h.used, h.limit], [w.used, w.limit]);
    }
    for (const must of ["sprites used", "raster entries",
                        "interpreter functions"]) {
      check(header.some((h) => h.label === must),
            name + "'s header lists " + must);
    }
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
}

async function main() {
  await checkTopic();
  checkNumbers();
  await checkExamples();
  if (failures.length) {
    for (const f of failures) console.log("FAIL  " + f);
    console.log("FAIL  " + failures.length + " of " + checks +
                " checks failed");
    process.exit(1);
  }
  console.log("PASS  " + checks + " checks: the hardware-design topic " +
              "resolves, every number in it is a module constant, a " +
              "recomputed figure or a range the HuCard study states, and " +
              "the three example toys pass validate, rom_check and " +
              "export_pce with the budgets their headers list");
}

main().catch((e) => {
  console.error("ERROR " + (e && e.stack || e));
  process.exit(1);
});
