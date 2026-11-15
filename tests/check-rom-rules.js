#!/usr/bin/env node
/*
 * tests/check-rom-rules.js — the ROM RULES evidence (the rom-rules docs
 * topic, the MCP server's instructions, and the Writing-for-the-ROM
 * chapter of the Claude Code manual).
 *
 * What it proves, in the order it proves it:
 *
 *   1. The docs topic resolves.  docs('rom-rules') through the real MCP
 *      session (tools/mcp/server.js, the very call the connected Claude
 *      makes) answers the chapter; renderer/docs.html carries the
 *      <section id="rom-rules">, and the Claude Code manual's generated
 *      Writing-for-the-ROM chapter carries the same rules.
 *   2. Every refusal code a rule names is a code the code raises: the
 *      budget rows' and idiom rows' codes, and every fix's code, exist in
 *      the merged reference index (renderer/pce-docs.js refusalIndex),
 *      the two compilers' own REFUSALS tables (renderer/pce-cgen.js,
 *      renderer/pce-ilbc.js), romcheck's LIMITS refusals, or the ROM
 *      builder's refuse() literals (renderer/pce-rom.js).  A fix whose
 *      meaning the modules own must print the module's own string.
 *   3. Every number the rules print is a module constant: each budget
 *      row's value is re-read from the module field its `from` names
 *      (romcheck's LIMITS rows ride the same table the drawer prints),
 *      and every digit in the chapter's prose and tables is one of the
 *      constants the modules export (plus the derived values the
 *      compilers' own meaning strings use).
 *   4. The state table is the code's: rom_check is run on each toy the
 *      table names, and the verdict and the refusal code must match.
 *   5. The toy template is real: rom_check is clean on it (both routes),
 *      no budget row is over, and the MCP's export route — ilbc.encode
 *      over the committed interpreter — builds the 40,960 B ROM.
 *   6. The server instructions say it: before writing a game call
 *      docs('rom-rules'), run validate and rom_check after every change,
 *      export_pce at the end.
 *
 * Written by @design because the card names this file.  Per workshop rule
 * 2 this test is the author's own mutant and proves only what its author
 * thought of: a cold break by another seat is owed before the card
 * closes.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const docs = require("../renderer/pce-docs.js");
const host = require("../renderer/pce-toyhost.js");
const editor = require("../renderer/pce-editor.js");
const toys = require("../renderer/pce-toys.js");
const cgen = require("../renderer/pce-cgen.js");
const ilbc = require("../renderer/pce-ilbc.js");
const rom = require("../renderer/pce-rom.js");
const romcheck = require("../renderer/pce-romcheck.js");
const songbank = require("../renderer/pce-songbank.js");
const server = require("../tools/mcp/server.js");

const ROOT = path.resolve(__dirname, "..");
const HTML_PATH = path.join(ROOT, "renderer", "docs.html");
const MANUAL_PATH = path.join(ROOT, "renderer", "claude-code.html");
const SERVER_PATH = path.join(ROOT, "tools", "mcp", "server.js");

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

/* ---- the rule data and the chapter ------------------------------------ */

const RULES = docs.ROM_RULES;
const SECTION_ID = "rom-rules";

function rulesSection() {
  const ref = docs.reference();
  return ref.sections.find((s) => s.id === SECTION_ID);
}

function blocksText(blocks, keepTables) {
  /* The prose and table cells of the rules chapter (code blocks hold Lua,
   * not claims). */
  const out = [];
  for (const b of blocks) {
    if (b.type === "p" || b.type === "h3") out.push(b.text);
    else if (b.type === "table" && keepTables !== false) {
      for (const row of b.rows) out.push(row.join(" | "));
    }
  }
  return out.join("\n");
}

/* ---- 1. the topic resolves where the Claude reads it ------------------ */

function checkTopic() {
  const sec = rulesSection();
  check(!!sec, "the reference has a rom-rules chapter");
  if (!sec) return;
  eq("the chapter's title", sec.title, "ROM rules");
  check(sec.blocks.some((b) => b.type === "table"),
        "the chapter has tables");
  check(sec.blocks.some((b) => b.type === "code"),
        "the chapter has code blocks");

  /* the docs tool's own topic resolution (id and title match) */
  const byId = docs.reference().sections.filter(
    (s) => s.id === SECTION_ID || s.title.toLowerCase() === SECTION_ID);
  eq("exactly one section resolves the topic id",
     byId.length, 1);

  const page = fs.readFileSync(HTML_PATH, "utf8");
  check(page.includes('<section id="rom-rules">'),
        "docs.html carries the rom-rules section");
  check(page.includes('<a href="#rom-rules">'),
        "docs.html's nav links the rom-rules chapter");

  /* the Claude Code manual's generated chapter carries the rules too */
  const manual = fs.readFileSync(MANUAL_PATH, "utf8");
  for (const want of ["The loop", "Common refusals and the fix",
                      "A toy template", "The preflight checklist"])
    check(manual.includes(want),
          "claude-code.html's Writing-for-the-ROM carries " +
          JSON.stringify(want));

  const tool = spawnSync(process.execPath,
                         [path.join(ROOT, "tools", "docs.js"), "--check"],
                         { encoding: "utf8" });
  eq("tools/docs.js --check exits 0 with the new chapter",
     tool.status, 0);

  /* no board cards on the public pages this chapter reaches */
  const md = docs.markdown({
    title: "t", intro: "", sources: [], footer: "",
    sections: [sec]
  });
  check(!/#\d{1,3}\b/.test(md),
        "the rules chapter names no board cards");
}

/* ---- 2. the codes the rules name exist -------------------------------- */

/* The union of codes the code raises: the merged reference index, the two
 * compilers' own tables, the budget's refusals, and the ROM builder's
 * refuse() literals (scanned, so a code added there is known). */
function knownCodes() {
  const out = {};
  const index = docs.refusalIndex();
  for (const c in index) out[c] = index[c].description;
  for (const c in cgen.REFUSALS) if (!out[c]) out[c] = cgen.REFUSALS[c];
  for (const c in ilbc.REFUSALS) if (!out[c]) out[c] = ilbc.REFUSALS[c];
  for (const L of romcheck.LIMITS) if (!out[L.refusal])
    out[L.refusal] = "the budget finding for " + L.label;
  for (const file of ["pce-rom.js", "pce-songbank.js"]) {
    const src = fs.readFileSync(path.join(ROOT, "renderer", file), "utf8");
    const re = /refuse\(\s*"([a-z0-9-]+)"/g;
    let m;
    while ((m = re.exec(src))) if (!out[m[1]]) out[m[1]] = file + " refusal";
  }
  return out;
}

function checkFixCodes(fixes, tag) {
  const known = knownCodes();
  let bad = 0;
  for (const f of fixes) {
    if (!known[f.code]) { bad++; failures.push(tag + ": code " + f.code +
      " is not a refusal the code raises"); }
  }
  checks++;
  return bad;
}

function checkCodes() {
  const known = knownCodes();
  check(Object.keys(known).length > 20,
        "the known-code union has the modules' codes");

  /* budget rows: their refusal is the row's own, held to the tables */
  const budgets = RULES.budgets();
  for (const r of budgets) {
    check(Object.prototype.hasOwnProperty.call(known, r.refusal),
          "budget row " + r.label + " names refusal " + r.refusal);
  }

  /* idiom rows that name a code */
  for (const d of RULES.idioms) {
    if (d.code)
      check(Object.prototype.hasOwnProperty.call(known, d.code),
            "idiom \"" + d.rule + "\" names refusal " + d.code);
  }

  /* the card's eight idioms are all there */
  const rules = RULES.idioms.map((d) => d.rule).join("\n");
  for (const want of ["powers of two", "band mask", "arithmetic small",
                      "call local functions directly", "table cell once",
                      "specs as constants", "division by a variable",
                      "no strings"])
    check(rules.indexOf(want) >= 0, "the idioms name " + JSON.stringify(want));

  /* the fixes: code exists, and a meaning the modules own is the module's
   * own string */
  const fixes = RULES.fixes();
  checkFixCodes(fixes, "fix");
  const seen = {};
  for (const f of fixes) {
    check(!seen[f.code], "fix codes are distinct (" + f.code + ")");
    seen[f.code] = true;
    if (known[f.code] &&
        f.code !== "rom-budget" && f.code !== "toy-data-bank-full") {
      eq("fix " + f.code + " prints the module's meaning",
         f.meaning, known[f.code]);
    }
    check(typeof f.fix === "string" && f.fix.length > 0,
          "fix " + f.code + " has advice");
  }

  /* the state table's refusal code */
  for (const s of RULES.state)
    if (s.code)
      check(Object.prototype.hasOwnProperty.call(known, s.code),
            "state row " + s.game + " names refusal " + s.code);

  /* the checker itself checks: a fake code must fail it */
  const before = failures.length;
  checkFixCodes([{ code: "ilbc-nope", meaning: "x", fix: "y" }],
                "mutation probe");
  check(failures.length > before,
        "a made-up fix code fails the code check");
  failures.length = before;   /* the probe is not a real finding */
}

/* ---- 3. every number is a module constant ----------------------------- */

function allowedNumbers() {
  const set = new Set();
  const add = (v) => { if (typeof v === "number" && isFinite(v)) set.add(v); };
  [host.SAT_ENTRIES, host.VRAM_WORDS, host.CRAM_ENTRIES, host.VDW_LINES,
   host.RASTER_WRITES_MAX, host.FRAME_HZ,
   editor.LINE_STRIPS, editor.STRIP_PX,
   toys.BUDGET_MS,
   rom.BANK, rom.SONG_TABLE_OFF, rom.MAX_ROM_BANKS, rom.ILVM_BYTES,
   ilbc.MAX_CONST, ilbc.MAX_ARGS, ilbc.TABLE_POOL_CELLS,
   romcheck.NEAR_PERCENT, romcheck.OVER_PERCENT,
   /* the values the compilers' own meaning strings use */
   rom.BANK - rom.SONG_TABLE_OFF,          /* the song trailer */
   ilbc.MAX_CONST + 1,                     /* a one-byte register range */
   256 - 1                                 /* a byte's top */
  ].forEach(add);
  for (const L of romcheck.LIMITS) add(L.limit);
  /* the music and background budget rows: each value is re-read from its
   * module field below; their unit and what strings quote these too */
  for (const r of RULES.budgets()) add(r.value);
  [editor.ENTRIES, editor.SPRITE_ENTRIES, editor.PALETTES,
   editor.SPRITE_PALETTES, host.SOUND_CHANNELS - 1, host.WIDTH / 8,
   editor.PALETTES * editor.ENTRIES, RULES.stateWindow,
   0, 1,                                        /* first index, one */
   Math.round(Math.log2(host.PITCH_MAX + 1)),   /* the divider's 12 bits */
   Math.round(Math.log2(editor.ENTRIES))        /* a pixel's 4 bits */
  ].forEach(add);
  /* the state table's figures: each is held to the live rom_check or
   * docs/NATIVE.md in checkState() */
  for (const s of RULES.state) {
    add(s.pace);
    for (const row of s.near.concat(s.over)) add(row[1]);
  }
  return set;
}

function numbersIn(text) {
  const out = [];
  const re = /\d+/g;
  let m;
  while ((m = re.exec(text))) out.push(Number(m[0]));
  return out;
}

function checkNumberScan(blocks, tag) {
  const allowed = allowedNumbers();
  let bad = 0;
  const nums = numbersIn(blocksText(blocks));
  for (const n of nums) {
    if (!allowed.has(n)) {
      bad++;
      failures.push(tag + ": the number " + n + " is not a module " +
                    "constant");
    }
  }
  checks++;
  return bad;
}

function checkNumbers() {
  const sec = rulesSection();
  checkNumberScan(sec.blocks, "rules chapter");

  /* each budget row's value is re-read from the module field it names */
  const live = {
    host: host, editor: editor, toys: toys, cgen: cgen, ilbc: ilbc,
    rom: rom, romcheck: romcheck, songbank: songbank
  };
  const byLabel = {};
  for (const L of romcheck.LIMITS) byLabel[L.id] = L;
  for (const r of RULES.budgets()) {
    if (r.from.indexOf("romcheck.LIMITS:") === 0) {
      const L = byLabel[r.from.slice("romcheck.LIMITS:".length)];
      check(!!L, "budget row " + r.label + " names a LIMITS row");
      if (L) {
        eq("budget " + r.label + " value is LIMITS'",
           r.value, L.limit);
        eq("budget " + r.label + " unit is LIMITS'",
           r.unit, L.unit || "");
        eq("budget " + r.label + " refusal is LIMITS'",
           r.refusal, L.refusal);
        eq("budget " + r.label + " what is LIMITS'",
           r.what, L.what);
      }
    } else {
      /* a dotted path: module.field, or module.field.0.max */
      const parts = r.from.split(".");
      let val = live[parts[0]];
      for (let k = 1; k < parts.length && val !== undefined; k++)
        val = val[parts[k]];
      check(val !== undefined,
            "budget row " + r.label + " names live field " + r.from);
      if (val !== undefined)
        eq("budget " + r.label + " value is " + r.from, r.value, val);
    }
  }

  /* the scanner itself scans: a planted number must fail it */
  const before = failures.length;
  checkNumberScan([{ type: "p", text: "a planted 99999" }],
                  "mutation probe");
  check(failures.length > before,
        "a planted number fails the number check");
  failures.length = before;
}

/* ---- 4. the state table is the code's --------------------------------- */

const nativeText = fs.readFileSync(path.join(ROOT, "docs", "NATIVE.md"),
                                   "utf8");

function checkState() {
  eq("the state table names the card's five games",
     RULES.state.map((s) => s.game).sort(),
     ["DUSK RUN", "NOVA TIDE", "PLATFORMER", "STARFALL", "TOWER"]);
  for (const s of RULES.state) {
    const src = fs.readFileSync(path.join(ROOT, s.toy), "utf8");
    const rep = romcheck.check(src, { chunkName: s.toy });
    eq(s.game + "'s verdict is rom_check's", rep.ok, s.builds);
    if (s.code) {
      check(rep.findings.some((f) => f.code === s.code),
            s.game + " is refused " + s.code + " by the code");
    } else {
      check(rep.ok && rep.findings.length === 0,
            s.game + " rom_checks clean today");
    }
    check(typeof s.verdict === "string" && s.verdict.length > 0 &&
          typeof s.native === "string" && s.native.length > 0,
          s.game + "'s row says what that means on both routes");
    /* the near and over figures are rom_check's own, row for row */
    const rows = rep.budget.rows;
    const want = (st) => rows.filter((x) => x.status === st)
      .map((x) => [x.id, x.used]);
    eq(s.game + "'s near rows are rom_check's", s.near, want("near"));
    eq(s.game + "'s over rows are rom_check's", s.over, want("over"));
    /* the native pace is docs/NATIVE.md's measured figure, on a line that
     * names the game */
    const line = nativeText.split("\n").some((l) =>
      l.indexOf(s.game) >= 0 &&
      new RegExp("(^|[^0-9,])" + s.pace + "([^0-9,]|$)").test(l));
    check(line, s.game + "'s pace " + s.pace +
          " is a figure in docs/NATIVE.md's measured lines");
  }
}

/* ---- 5. the template is real ------------------------------------------ */

function checkTemplate() {
  const src = RULES.template;
  check(src.indexOf("function frame") >= 0 &&
        src.indexOf("function init") >= 0,
        "the template is a toy with the two hooks");
  /* the browser host runs it too, long past frame 2048 */
  let rtErr = null;
  try {
    const rt = toys.create(src, { budgetMs: 250 });
    rt.load();
    for (let f = 0; f < 3600; f++) rt.frame(f);
  } catch (e) { rtErr = e; }
  check(!rtErr, "the template runs 3,600 frames in the browser host" +
        (rtErr ? " (" + (rtErr.code || rtErr.name) + ": " +
                 rtErr.message + ")" : ""));
  const rep = romcheck.check(src, { chunkName: "@template.lua" });
  eq("the template rom_checks clean", rep.ok, true);
  check(rep.findings.length === 0,
        "the template has no findings");
  const over = rep.budget
    ? rep.budget.rows.filter((r) => r.status === "over").map((r) => r.id)
    : [];
  eq("no template budget row is over", over, []);
  const il = require("../renderer/pce-il.js");
  const program = il.compile(src, { chunkName: "@template.lua" });
  const cg = cgen.check(program);
  eq("the C route accepts the template", cg.length, 0);
  const enc = ilbc.encode(program);
  const bytes = rom.buildToyRom({
    bank0: fs.readFileSync(path.join(ROOT, "renderer", "ilvm.bin")),
    bytecode: enc.bytes
  });
  eq("the MCP's export route builds the template ROM",
     bytes.length, rom.ILVM_BYTES + rom.BANK);
}

/* ---- 6. the server instructions say it --------------------------------- */

async function checkInstructions() {
  const src = fs.readFileSync(SERVER_PATH, "utf8");
  check(/topic \\"rom-rules\\"/.test(src),
        "tools/mcp/server.js instructions point at the rom-rules topic");
  check(/run validate and rom_check after every change/.test(src),
        "the instructions say run validate and rom_check after every change");

  /* the wire: the initialize reply the connected Claude actually reads */
  const wire = spawnSync(process.execPath, [SERVER_PATH],
                         { encoding: "utf8",
                           input: '{"jsonrpc":"2.0","id":1,"method":' +
                                  '"initialize","params":{}}\n' });
  const replyLine = (wire.stdout || "").trim().split("\n")
    .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } })
    .find((m) => m && m.id === 1);
  check(!!replyLine && !!replyLine.result &&
        typeof replyLine.result.instructions === "string",
        "the server's initialize answers with instructions");
  if (replyLine && replyLine.result && replyLine.result.instructions) {
    const text = replyLine.result.instructions;
    check(text.indexOf("rom-rules") >= 0,
          "the wire instructions name the rom-rules topic");
    check(/validate and rom_check after every change/.test(text),
          "the wire instructions say run validate and rom_check after " +
          "every change");
    check(/export_pce at the end/.test(text),
          "the wire instructions say call export_pce at the end");
  }

  /* the very call the connected Claude makes (the session wraps the value
   * in one MCP text block, as tools/call sends it over the wire) */
  const reply = await server.session.call("docs", { topic: "rom-rules" });
  const value = reply && Array.isArray(reply.content)
    ? JSON.parse(reply.content[0].text) : reply;
  eq("docs('rom-rules') resolves through the server session",
     value.ok, true);
  check(value.markdown.indexOf("## ROM rules") >= 0,
        "the topic's markdown is the ROM rules chapter");
  check(value.markdown.indexOf("| sprites | 64 SAT entries |") >= 0,
        "the topic's markdown carries the budgets");
  check(src.indexOf('topic \\"hardware-design\\"') >= 0,
        "the instructions point at the hardware-design topic");
  const listing = await server.session.call("docs", {});
  const listed = listing && Array.isArray(listing.content)
    ? JSON.parse(listing.content[0].text) : listing;
  check(Array.isArray(listed.topics) &&
        listed.topics.some((t) => t.id === "rom-rules"),
        "the docs tool's topic list names rom-rules");
}

/* ---- main ------------------------------------------------------------- */

async function main() {
  checkTopic();
  checkCodes();
  checkNumbers();
  checkState();
  checkTemplate();
  await checkInstructions();

  if (failures.length) {
    for (const f of failures) console.log("FAIL  " + f);
    console.log("FAIL  " + failures.length + " of " + checks +
                " checks failed");
    process.exit(1);
  }
  console.log("PASS  " + checks + " checks: the ROM rules are the code's — " +
              "the topic resolves where the Claude reads it, every named " +
              "code is a refusal the code raises, every number a module " +
              "constant, the state table and the template are the live " +
              "compilers', and the server's instructions say the loop");
}

main().catch(function (e) {
  console.error("ERROR " + (e && e.stack || e));
  process.exit(1);
});
