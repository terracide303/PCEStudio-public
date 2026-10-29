#!/usr/bin/env node
/*
 * tests/check-docs.js — the #61 evidence: the toy author's reference is the
 * runtime's own tables, not prose that can drift.
 *
 * What it proves, in the order it proves it:
 *
 *   1. renderer/docs.html is exactly what `node tools/docs.js --html` writes
 *      (byte for byte), and `--check` says so.  A hand-written edit to the
 *      page — a number typed in by hand — fails this, because the generator
 *      never produces it.  The same is proven for the Markdown the command
 *      prints.
 *   2. Every register row is host.REGISTERS: name, 0..max, width, meaning,
 *      manual page.  The range in the page is the range reg() enforces:
 *      reg(name, max) stores, reg(name, max + 1) is reg-range, and any other
 *      name is reg-forbidden.
 *   3. Every refusal code the docs list is a code the source raises: the
 *      code's `refuse("...")`, `code: "..."` and `p_fail("...")` literals are
 *      scanned, and a code used in the source but missing from the page (or
 *      listed but not known to any module) fails.
 *   4. Changing a table in the code changes the docs.  Each of the register
 *      range, the tile limit, the raster write cap, the SAT size, the
 *      password string cap, the PSG channel count and the IL instruction
 *      budget is changed in the live module, and the regenerated page must
 *      carry the new value and lose the old one.  The table is restored.
 *   5. The limits the page states are the ones the host enforces: pal, sat,
 *      vram, raster-line and pad-range are each provoked at the boundary the
 *      page prints.
 *
 * Written by @design because the card names this file.  Per workshop rule 2
 * this test is the author's own mutant and proves only what its author
 * thought of: a cold break by another seat is owed before #61 closes.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const docs = require("../renderer/pce-docs.js");
const host = require("../renderer/pce-toyhost.js");
const editor = require("../renderer/pce-editor.js");
const toys = require("../renderer/pce-toys.js");
const il = require("../renderer/pce-il.js");
const psg = require("../renderer/pce-psg.js");
const cgen = require("../renderer/pce-cgen.js");

const ROOT = path.resolve(__dirname, "..");
const HTML_PATH = path.join(ROOT, "renderer", "docs.html");
const SOURCES = ["renderer/pce-toyhost.js", "renderer/pce-toys.js",
                 "renderer/pce-il.js", "renderer/pce-editor.js",
                 "renderer/pce-cgen.js"];

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

function section(ref, id) {
  return ref.sections.find((s) => s.id === id);
}

function tableIn(sec, headers0) {
  return sec.blocks.find((b) => b.type === "table" && b.headers[0] === headers0);
}

function markdownNow() { return docs.markdown(docs.reference()); }

/* ---- 1. the artifact is the generator's output ------------------------ */

function checkArtifact() {
  const ref = docs.reference();
  const wantHtml = docs.html(ref);
  const haveHtml = fs.readFileSync(HTML_PATH, "utf8");
  check(haveHtml === wantHtml,
        "renderer/docs.html is byte-equal to the generator's HTML (" +
        haveHtml.length + " vs " + wantHtml.length + " bytes)");

  const tool = spawnSync(process.execPath,
                         [path.join(ROOT, "tools", "docs.js"), "--check"],
                         { encoding: "utf8" });
  eq("tools/docs.js --check exits 0", tool.status, 0);

  const stdout = spawnSync(process.execPath,
                           [path.join(ROOT, "tools", "docs.js")],
                           { encoding: "utf8" });
  eq("tools/docs.js prints the same Markdown the module builds",
     stdout.stdout, docs.markdown(ref));

  const ids = ref.sections.map((s) => s.id);
  eq("chapter ids are unique", new Set(ids).size, ids.length);
  for (const id of ids) {
    check(wantHtml.includes('<section id="' + id + '">'),
          "docs.html has the chapter section #" + id);
    check(wantHtml.includes('<a href="#' + id + '">'),
          "docs.html links the chapter #" + id + " in its nav");
  }
  for (const want of ["The toy", "Registers", "Palettes and colour",
                      "Sprites and the SAT", "Raster: changes per line", "Pads",
                      "Passwords", "Sound: the PSG", "Budgets and limits",
                      "Refusal codes"])
    check(ref.sections.some((s) => s.title === want),
          "chapter exists: " + want);
}

/* A hand-written number in the page: change one, and the check must fail. */
function checkHandEditFails() {
  const original = fs.readFileSync(HTML_PATH, "utf8");
  try {
    fs.writeFileSync(HTML_PATH,
                     original.replace("<body>", "<body>\n<!-- 99999 -->"));
    const tool = spawnSync(process.execPath,
                           [path.join(ROOT, "tools", "docs.js"), "--check"],
                           { encoding: "utf8" });
    check(tool.status !== 0, "a hand-written number in docs.html fails --check");
  } finally {
    fs.writeFileSync(HTML_PATH, original);
  }
  const after = spawnSync(process.execPath,
                          [path.join(ROOT, "tools", "docs.js"), "--check"],
                          { encoding: "utf8" });
  eq("the restored page passes --check again", after.status, 0);
}

/* ---- 2. the register table is the code's ------------------------------ */

function checkRegisters() {
  const ref = docs.reference();
  const rows = tableIn(section(ref, "registers"), "register").rows;
  eq("one register row per REGISTERS entry", rows.length, host.REGISTERS.length);
  for (let i = 0; i < host.REGISTERS.length; i++) {
    const r = host.REGISTERS[i];
    eq("register row " + r.name,
       rows[i], [r.name, "0.." + r.max, r.bits + "-bit", r.what, r.manual]);
  }

  const h = host.createHost();
  for (const r of host.REGISTERS) {
    eq("reg(" + r.name + ", " + r.max + ") is the page's top of range",
       h.reg(r.name, r.max), r.max);
    let threw = null;
    try { h.reg(r.name, r.max + 1); } catch (e) { threw = e; }
    eq("reg(" + r.name + ", " + (r.max + 1) + ") is reg-range",
       threw && threw.code, "reg-range");
  }
  let forbidden = null;
  try { h.reg("MWR", 0); } catch (e) { forbidden = e; }
  eq("a register the page does not list is reg-forbidden",
     forbidden && forbidden.code, "reg-forbidden");

  const md = markdownNow();
  for (const r of host.REGISTERS)
    check(md.includes("| " + r.name + " | 0.." + r.max + " | " + r.bits +
                      "-bit |"),
          "Markdown register row carries the code's range: " + r.name);
}

/* ---- 3. the refusal codes are the source's ---------------------------- */

function sourceCodes(file) {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const codes = new Set();
  const patterns = [/refuse\(\s*"([a-z0-9-]+)"/g,
                    /code:\s*"([a-z0-9-]+)"/g,
                    /p_fail\(\s*"([a-z0-9-]+)"/g];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src))) codes.add(m[1]);
  }
  return codes;
}

function checkRefusals() {
  const ref = docs.reference();
  const index = docs.refusalIndex();
  const md = docs.markdown(ref);
  const page = docs.html(ref);

  for (const file of SOURCES) {
    const codes = sourceCodes(file);
    check(codes.size > 0, "the scan finds refusal codes in " + file);
    for (const code of codes)
      check(Object.prototype.hasOwnProperty.call(index, code),
            "source code " + code + " (" + file + ") is in the reference");
  }
  for (const code of Object.keys(index)) {
    check(md.includes("| " + code + " |"),
          "Markdown lists refusal " + code);
    check(page.includes("<td>" + code + "</td>"),
          "docs.html lists refusal " + code);
  }
  /* every code the refusals chapter prints is one this build knows */
  const start = page.indexOf('<section id="refusals">');
  const end = page.indexOf("</main>");
  const refusalHtml = start >= 0 ? page.slice(start, end) : "";
  const printed = new Set();
  const re = /<td>([a-z0-9-]+)<\/td>/g;
  let m;
  while ((m = re.exec(refusalHtml))) printed.add(m[1]);
  check(printed.size > 0, "the refusal chapter prints its codes");
  for (const code of printed)
    check(Object.prototype.hasOwnProperty.call(index, code),
          "printed code " + code + " is a module's refusal");

  /* the C backend's two tables stay one list: CODES is what it can raise,
   * REFUSALS is what the page prints, and neither may drift from the other */
  eq("cgen.REFUSALS describes exactly cgen.CODES",
     Object.keys(cgen.REFUSALS).sort(), cgen.CODES.slice().sort());

  /* the merged index keeps one description per code and names its module */
  eq("the merged index has no duplicate keys",
     Object.keys(index).length,
     new Set(Object.keys(index)).size);
  check(Object.keys(index).every((c) => /^renderer\/pce-/.test(index[c].source)),
        "every refusal names the module that raises it");
}

/* ---- 4. a code change moves the docs ---------------------------------- */

/* Change one live table, regenerate, require the new value and the loss of
 * the old one, then restore.  These are the tables the page reads. */
function checkFollowsCode() {
  const cases = [
    { name: "the BXR register range", holder: host.REGISTERS[0], key: "max",
      was: host.REGISTERS[0].max, now: 0x2FF,
      inDoc: "BXR | 0..767", gone: "BXR | 0..1023" },
    { name: "the tile limit", holder: editor, key: "MAX_TILES",
      was: editor.MAX_TILES, now: 1024,
      inDoc: "| tiles in the ROM layout | 1024 |",
      gone: "| tiles in the ROM layout | 1536 |" },
    { name: "the raster write cap", holder: host, key: "RASTER_WRITES_MAX",
      was: host.RASTER_WRITES_MAX, now: 32,
      inDoc: "more than 32 colour writes",
      gone: "more than 64 colour writes" },
    { name: "the SAT size", holder: host, key: "SAT_ENTRIES",
      was: host.SAT_ENTRIES, now: 32,
      inDoc: "holds 32 entries of 4 words",
      gone: "holds 64 entries of 4 words" },
    { name: "the password string cap", holder: toys.PASSWORD, key: "maxString",
      was: toys.PASSWORD.maxString, now: 32,
      inDoc: "| a password string | 32 bytes |",
      gone: "| a password string | 64 bytes |" },
    { name: "the PSG channel count", holder: psg, key: "CHANNELS",
      was: psg.CHANNELS, now: 8,
      inDoc: "The HuC6280 PSG has 8 channels",
      gone: "The HuC6280 PSG has 6 channels" },
    { name: "the IL instruction budget", holder: il, key: "MAX_INSTRUCTIONS",
      was: il.MAX_INSTRUCTIONS, now: 1000,
      inDoc: "| one hook's IL instructions | 1000 |",
      gone: "| one hook's IL instructions | 5000000 |" }
  ];

  for (const c of cases) {
    c.holder[c.key] = c.now;
    let md;
    try { md = markdownNow(); }
    finally { c.holder[c.key] = c.was; }
    check(md.includes(c.inDoc),
          "change " + c.name + " -> docs carry " + JSON.stringify(c.inDoc));
    check(!md.includes(c.gone),
          "change " + c.name + " -> docs lose " + JSON.stringify(c.gone));
    check(markdownNow().includes(c.gone),
          "restoring " + c.name + " -> the docs return to " +
          JSON.stringify(c.gone));
  }
}

/* ---- 5. the limits the page states are enforced ----------------------- */

function checkLimitsEnforced() {
  const h = host.createHost();
  const boundary = (name, fn, code) => {
    let got = null;
    try { fn(); } catch (e) { got = e && e.code; }
    eq(name + " is " + code, got, code);
  };
  boundary("pal(" + host.CRAM_ENTRIES + ", 0)",
           () => h.pal(host.CRAM_ENTRIES, 0), "pal-range");
  boundary("pal(0, " + (host.CRAM_WORD_MAX + 1) + ")",
           () => h.pal(0, host.CRAM_WORD_MAX + 1), "pal-range");
  boundary("sat(" + host.SAT_ENTRIES + ", 0, 0)",
           () => h.sat(host.SAT_ENTRIES, 0, 0), "sat-range");
  boundary("vram[" + host.VRAM_WORDS + "]",
           () => h.vramSet(host.VRAM_WORDS, 0), "vram-range");
  boundary("raster line " + host.VDW_LINES,
           () => h.raster(host.VDW_LINES, { bxr: 0 }), "raster-line");
  boundary("pad " + (host.PAD_COUNT + 1),
           () => h.setPad(host.PAD_COUNT + 1, {}), "pad-range");

  const ref = docs.reference();
  const budgets = tableIn(section(ref, "budgets"), "budget").rows;
  const budget = (label) => {
    const row = budgets.find((r) => r[0] === label);
    return row ? String(row[1]) : undefined;
  };
  eq("docs VRAM budget is the host's", budget("VRAM"),
     host.VRAM_WORDS + " words");
  eq("docs CRAM budget is the host's", budget("CRAM"),
     host.CRAM_ENTRIES + " entries");
  eq("docs SAT budget is the host's", budget("SAT"),
     host.SAT_ENTRIES + " entries");
  eq("docs raster-write budget is the host's",
     budget("raster colour writes on one line"),
     String(host.RASTER_WRITES_MAX));
  eq("docs password byte cap is the runtime's",
     budget("a password's value bytes"), String(toys.PASSWORD.maxBytes));  check(markdownNow().includes(psg.WAVE_STEPS + "-step waveform of 5-bit samples"),
        "docs PSG wave is the model's " + psg.WAVE_STEPS + "-step wave");

  const pads = tableIn(section(ref, "pads"), "field").rows;
  eq("one pad row per button", pads.length, host.PAD_FIELDS.length);
  eq("pads chapter counts the host's pads",
     section(ref, "pads").blocks[0].text.includes("1.." + host.PAD_COUNT), true);
}

/* ---- main ------------------------------------------------------------- */

function main() {
  checkArtifact();
  checkHandEditFails();
  checkRegisters();
  checkRefusals();
  checkFollowsCode();
  checkLimitsEnforced();

  if (failures.length) {
    for (const f of failures) console.log("FAIL  " + f);
    console.log("FAIL  " + failures.length + " of " + checks + " checks failed");
    process.exit(1);
  }
  console.log("PASS  " + checks + " checks: the reference is the code's " +
              "tables — docs.html is the generator's bytes, every register, " +
              "refusal and limit tracks its module, and a hand-written " +
              "number fails the check");
}

if (require.main === module) main();
