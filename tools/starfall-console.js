#!/usr/bin/env node
/*
 * tools/starfall-console.js — what the studio's Export makes of STARFALL
 * (card #131), reproduced in Node with the same modules the page runs.
 *
 *   node tools/starfall-console.js [toy.lua] [--song song.json]
 *
 * Default toy: toys/demo-game/main.lua (STARFALL).  --song gives the
 * validator the module the toy's music() plays, the way the runtime gets it;
 * without it a toy that calls music(0) is refused with music-range, which is
 * a missing argument and not a finding about the toy.
 *
 * The page's Export is three stages, in this order (renderer/studio.html's
 * exportAnalysis(), which mirrors renderer/studio-panel-console.js's
 * analyse()):
 *
 *   1. the CONSOLE tab's checks: pce-il.js compile, pce-validate.js budgets,
 *      pce-cgen.js emitC (the C backend, llvm-mos)
 *   2. if stage 1 reported any error, STOP: the encoder is never reached
 *      (renderer/studio.html:3494)
 *   3. pce-ilbc.js encode -> pce-rom.js buildToyRom over renderer/ilvm.bin
 *
 * Stage 1's cgen refuses the FIRST instruction it cannot lower, so the page
 * shows one finding where the toy has a dozen kinds of blocker.  This tool
 * prints both: the page's report verbatim, then the complete inventory of
 * every IL instruction kind either backend cannot carry, counted over the
 * toy's whole IL rather than stopping at the first hit.
 *
 * Exit status is 0 whatever the verdict: this is a measuring instrument, not
 * a pass/fail check.  Read the tables.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const il = require(path.join(ROOT, "renderer/pce-il.js"));
const validate = require(path.join(ROOT, "renderer/pce-validate.js"));
const cgen = require(path.join(ROOT, "renderer/pce-cgen.js"));
const ilbc = require(path.join(ROOT, "renderer/pce-ilbc.js"));
const romLib = require(path.join(ROOT, "renderer/pce-rom.js"));

const ARGS = process.argv.slice(2);
const songAt = ARGS.indexOf("--song");
const SONG_FILE = songAt >= 0 ? ARGS[songAt + 1] : null;
const songs = SONG_FILE
  ? [JSON.parse(fs.readFileSync(path.resolve(ROOT, SONG_FILE), "utf8"))] : [];
const positionals = ARGS.filter((a, i) =>
  a !== "--song" && !(songAt >= 0 && i === songAt + 1));
const REL = positionals[0] || "toys/demo-game/main.lua";
const SRC = path.resolve(ROOT, REL);
const FRAMES = 8;              /* renderer/studio-panel-console.js's run length */

/* The accepted sets, read off the two backends' own dispatch tables:
 * pce-ilbc.js's OPS (its `default` refuses ilbc-op) and pce-cgen.js's
 * `switch (ins.t)` in the lowering pass (its `default` refuses cgen-op).
 * The tool does not trust this list: it also RUNS both encoders below and
 * prints their own refusals. */
const ILBC_OPS = new Set(Object.keys(ilbc.OPS || {}));
const CGEN_OPS = new Set(["const", "move", "getupval", "jmp", "pal", "vset",
  "forprep", "fornext", "closure", "ret", "getglobal", "setglobal", "reg",
  "arith", "cmp", "br", "call", "sat", "padget", "padref", "timer",
  "builtin"]);
const ILBC_ARITH = new Set(["add", "sub", "mul", "mod", "idiv", "band",
  "bor", "bxor", "shl", "shr"]);
const ILBC_CMP = new Set(["eq", "lt", "le"]);
const ILBC_REG = new Set(["BXR", "BYR", "CR"]);
const ILBC_BUILTIN = new Set(["rgb"]);
const KEY_OK = new Set(["int", "bool", "nil"]);

const source = fs.readFileSync(SRC, "utf8");

function stage(fn) {
  try { return { ok: true, value: fn() }; }
  catch (e) { return { ok: false, code: e.code || e.name, message: e.message }; }
}
function oneLine(s) { return String(s == null ? "" : s).replace(/\s+/g, " "); }

console.log("toy: " + REL + " (" + source.length + " bytes)");
console.log("");

/* ---- stage 1: the CONSOLE tab's checks ---------------------------------- */
const comp = stage(() => il.compile(source, { chunkName: "@main.lua" }));
if (!comp.ok) {
  console.log("IL compile refused: " + comp.code + ": " + oneLine(comp.message));
  process.exit(0);
}
const program = comp.value;
const vr = stage(() => validate.validateProgram(program, {
  chunkName: "@main.lua", frames: FRAMES, songs: songs }));
const report = vr.ok ? vr.value : null;
const cgenR = stage(() => cgen.emitC(program, { target: "llvm" }));

console.log("== 1. the CONSOLE tab's checks (what the page shows) ==");
console.log("   validator: " + (report
  ? (report.ok ? "ok (no error)" : "REFUSED, code " + report.code) +
    ", " + report.problems.length + " problem(s)"
  : "threw " + vr.code));
if (report && report.problems.length) {
  for (const p of report.problems)
    console.log("     " + p.severity + " " + p.code + " line " + p.line +
                ": " + oneLine(p.message));
}
console.log("   C emitter: " + (cgenR.ok ? "lowered " + cgenR.value.length +
  " bytes of C" : cgenR.code + ": " + oneLine(cgenR.message)));
const errors = (report ? report.problems.filter((p) =>
  p.severity !== "warn").length : 1) + (cgenR.ok ? 0 : 1);
console.log("   page verdict: " + (errors
  ? "BLOCKED (" + errors + " error) - renderer/studio.html:3494 returns here, " +
    "so pce-ilbc.js is never run"
  : "proceeds to the encoder"));
console.log("");

if (report && report.budgets) {
  const b = report.budgets;
  console.log("   budgets (the model's estimate, NOT a capture):");
  console.log("     frame(): " + b.frameCycles + " cycles");
  console.log("     collection (frame() plus the 224 raster() calls): " +
              b.collectionCycles + " cycles, " +
              (b.ratio60 * 100).toFixed(2) + "% of a 60 Hz frame, " +
              b.hz.toFixed(1) + " Hz on the COMPILED route's model");
  console.log("     route 1 (the interpreter, what the Export builds): " +
              b.route1.collectionCycles + " cycles = " +
              b.route1.ratio60.toFixed(3) + " display frames, " +
              b.route1.hz.toFixed(1) + " Hz, meets60 " + b.route1.meets60 +
              " (factor " + b.route1.factor + ", " + b.route1.shape + ")");
  console.log("     sprites " + b.sprites.sprites + " / " + b.sprites.strips +
              " strips, busiest line " + b.sprites.line + "; VRAM " +
              b.vram.maxWord + " words; blank " + b.blank.cycles + " cycles; " +
              "ROM ~" + b.rom.bytes + " B (" + b.rom.banks + " banks)");
  console.log("");
}

/* ---- stage 3: the encoder, when the page would reach it ----------------- */
const enc = stage(() => ilbc.encode(program));
console.log("== 3. the encoder (reached only when the console tab is clean) ==");
if (!enc.ok) {
  console.log("   pce-ilbc.js refused: " + enc.code + ": " + oneLine(enc.message));
} else {
  const rom = stage(() => romLib.buildToyRom({
    bank0: fs.readFileSync(path.join(ROOT, "renderer/ilvm.bin")),
    bytecode: enc.value.bytes }));
  console.log(rom.ok
    ? "   bytecode " + enc.value.bytes.length + " B -> .pce " +
      rom.value.length + " B"
    : "   buildToyRom refused: " + rom.code + ": " + oneLine(rom.message));
}
console.log("");

/* ---- the complete inventory, by KIND ------------------------------------ */
const kinds = new Map();
function note(kind, line, backend) {
  const key = kind + " | " + backend;
  if (!kinds.has(key)) kinds.set(key, { kind, backend, n: 0, lines: new Set() });
  const k = kinds.get(key);
  k.n++;
  if (line != null) k.lines.add(line);
}

let total = 0;
const refused = new Set();     /* one entry per instruction, both backends */
for (const fn of program.functions) {
  fn.code.forEach((ins, pc) => {
    total++;

    if (!ILBC_OPS.has(ins.t)) note(ins.t, ins.line, "route 1 (ilbc)");
    if (!CGEN_OPS.has(ins.t)) note(ins.t, ins.line, "C backend (cgen)");
    if (ins.t === "builtin" && !ILBC_BUILTIN.has(ins.name)) {
      note("builtin " + ins.name, ins.line, "C backend (cgen)");
    }
    if (!ILBC_OPS.has(ins.t) || !CGEN_OPS.has(ins.t) ||
        (ins.t === "builtin" && !ILBC_BUILTIN.has(ins.name))) {
      refused.add(fn.id + ":" + pc);
    }
    if (ins.t === "arith" && !ILBC_ARITH.has(ins.op))
      note("arith " + ins.op, ins.line, "route 1 (ilbc)");
    if (ins.t === "cmp" && !ILBC_CMP.has(ins.op))
      note("cmp " + ins.op, ins.line, "route 1 (ilbc)");
    if (ins.t === "reg" && !ILBC_REG.has(ins.name))
      note("reg " + ins.name, ins.line, "route 1 (ilbc)");
    if (ins.t === "builtin" && !ILBC_BUILTIN.has(ins.name))
      note("builtin " + ins.name, ins.line, "route 1 (ilbc)");
    for (const f of ["k", "src", "a", "b", "cond", "value"]) {
      const v = ins[f];
      if (v && v.k && !KEY_OK.has(v.k.t))
        note("constant " + v.k.t, ins.line, "route 1 (ilbc)");
    }
  });
}

console.log("== every instruction kind a backend cannot carry ==");
console.log("   " + program.functions.length + " IL functions, " + total +
            " instructions");
const rows = Array.from(kinds.values()).sort((a, b) => b.n - a.n);
for (const k of rows) {
  const ls = Array.from(k.lines).sort((a, b) => a - b);
  console.log("   " + k.kind.padEnd(16) + String(k.n).padStart(4) + "  " +
              k.backend + ", first main.lua:" + (ls[0] == null ? "-" : ls[0]) +
              ", " + ls.length + " distinct line(s)");
}
console.log("   " + refused.size + " of " + total + " instructions (" +
            (100 * refused.size / total).toFixed(1) + "%) are refused by at " +
            "least one backend");
console.log("");

/* ---- capacity: would the bytecode fit the one 8 KiB data bank? ---------- *
 * The container layout is renderer/pce-ilbc.js's own (its header comment and
 * the per-op sizes at renderer/pce-ilbc.js:195).  The model is checked
 * against the two committed containers before it is used: it must reproduce
 * them to within a few bytes (it lands 1 B and 4 B short).  A kind route 1
 * cannot carry has no defined size, so it is counted at an assumed size and
 * the answer is reported across a range; the smallest assumption that is
 * still realistic is 3 B. */
const ILBC_SIZE = {
  const: 3, move: 3, getglobal: 3, setglobal: 3, getupval: 3, setupval: 3,
  closure: 3, ret: 2, jmp: 3, br: 5, forprep: 2, fornext: 4, arith: 5,
  unm: 3, bnot: 3, cmp: 5, pal: 3, reg: 3, vset: 3, vget: 3
};
function opSize(ins) {
  if (ins.t === "call") return 4 + ins.args.length;
  if (ins.t === "builtin") return 3 + ins.args.length;
  return ILBC_SIZE[ins.t] || 0;
}
function projectSize(prog, unknownSize) {
  const consts = [], seen = new Set();
  let ups = 0, code = 0, unknown = 0;
  const add = (o) => {
    if (!o || !o.k) return;
    const key = o.k.t + ":" + JSON.stringify(o.k.v);
    if (seen.has(key)) return;
    seen.add(key); consts.push(o.k);
  };
  for (const fn of prog.functions) {
    ups += fn.upvalues.length;
    for (const ins of fn.code) {
      const s = opSize(ins);
      if (s) code += s; else { unknown++; code += unknownSize; }
      if (ins.k) add({ k: ins.k });
      for (const f of ["dst", "src", "callee", "cond", "value", "a", "b",
                       "addr", "word", "lineArg"]) {
        if (ins[f] && typeof ins[f] === "object") add(ins[f]);
      }
      for (const f of ["args", "addrs"]) {
        if (Array.isArray(ins[f])) for (const o of ins[f]) add(o);
      }
    }
  }
  let constSize = 0;
  for (const k of consts) {
    if (k.t === "int") constSize += 5;
    else if (k.t === "bool") constSize += 2;
    else if (k.t === "nil") constSize += 1;
    else if (k.t === "string") constSize += 2 + k.v.length;
  }
  let globalSize = 0;
  for (const g of prog.globals || []) globalSize += 1 + g.name.length;
  return 24 + prog.functions.length * 10 + ups * 2 + constSize + globalSize +
         code;
}

/* the model's own control: the two committed containers */
const CONTROLS = [["tools/toys/palette.lua", 578], ["toys/parallax.lua", 1100]];
let worst = 0;
for (const [rel, want] of CONTROLS) {
  const p = il.compile(fs.readFileSync(path.join(ROOT, rel), "utf8"),
                       { chunkName: "@main.lua" });
  worst = Math.max(worst, Math.abs(projectSize(p, 3) - want));
}
console.log("== would the bytecode fit the interpreter's 8 KiB data bank? ==");
console.log("   size model checked on the two committed containers: worst " +
            "error " + worst + " B");
for (const assumed of [3, 4, 6]) {
  const n = projectSize(program, assumed);
  console.log("   projected " + String(n).padStart(5) + " B with each of the " +
              refused.size + " uncarried instructions at " + assumed + " B  (" +
              (n > romLib.BANK ? "OVER" : "fits") + " the " +
              romLib.BANK + " B bank by " + Math.abs(n - romLib.BANK) + " B)");
}
console.log("   renderer/pce-rom.js:618 refuses such a build with " +
            "toy-data-bank-full");
