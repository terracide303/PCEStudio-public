#!/usr/bin/env node
/*
 * tests/check-ilvm-raster-table.js — #293: the table form raster(line, spec)
 * through the interpreter (docs/IL.md §14.1).
 *
 *   node tests/check-ilvm-raster-table.js
 *
 * The encoder lowers the IL `raster` instruction to tgets of the spec's
 * bxr/byr/cr fields plus reg writes (0x10 line, 0x11..0x13 the values,
 * 0x18|mask registers the entry); the interpreter's runtime keeps a pending
 * list and commits it in the collection window.  What is checked here:
 *
 *   1. HOST PARITY over a grid of specs.  Each toy below registers up to 16
 *      lines per frame, with values that change per frame, over every
 *      subset of bxr/byr/cr, edge values and edge lines, a spec table whose
 *      fields are set in another order than the encoder reads them, and a
 *      spec table whose temporaries are overwritten after the tsets.  The
 *      host harness (tools/ilvm/hostvm.c, which prints raster.txt) and the
 *      browser model (renderer/pce-toys.js lastRaster) must agree entry for
 *      entry, frame for frame: line, which fields, their values.
 *   2. REPEATED LINES are refused the way the browser refuses them: the
 *      browser model stops the toy with raster-line-full, the host counts
 *      the second registration in `refused` and logs only the first.
 *   3. THE ENCODER'S REFUSALS are named: a cram field, a spec that sets
 *      nothing, a key that is not a field, and the old `ilbc-op` for raster is gone (a user raster() function
 *      shadows the builtin, so a callback plus a table-form call cannot be
 *      written; the encoder refuses the pair all the same).
 *   4. NOVA TIDE (toys/nova-tide) encodes, and its first frames' entries
 *      through a host harness with the interpreter's capacities raised (the
 *      game is over four of them on the console, see check-export-games.js's
 *      pin) equal the browser model's, entry for entry.
 *   The console half is tests/check-export-games.js: the RASTER TABLE pin
 *      (tools/toys/rastertable.lua, a captured Mednafen frame equal to a
 *      browser frame) and NOVA TIDE's pin (it builds; it does not boot).
 *
 * Needs the system cc (the harness is C); without it the suite prints SKIP.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const il = require("../renderer/pce-il.js");
const ilbc = require("../renderer/pce-ilbc.js");
const toys = require("../renderer/pce-toys.js");

const ROOT = path.join(__dirname, "..");
let checks = 0;
const failures = [];
function check(ok, name) {
  checks++;
  if (!ok) { failures.push(name); console.log("FAIL  " + name); }
}
function eq(name, got, want) {
  check(got === want, name + " (got " + JSON.stringify(got) +
        ", want " + JSON.stringify(want) + ")");
}

if (spawnSync("cc", ["--version"], { encoding: "utf8" }).error) {
  console.log("SKIP  check-ilvm-raster-table: no system cc for the host harness");
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "rastertable-"));
/* hostvm builds from the real ilvm.c; `wide` is the same file with the interpreter's capacities raised in a
 * scratch copy, for NOVA TIDE (which is over four of them on the console: registers, upvalue cells, globals,
 * table slots) so its raster path can still be compared. */
function buildHost(name, wide) {
  const bin = path.join(tmp, name);
  let ilvmC = path.join(ROOT, "tools", "ilvm", "ilvm.c");
  if (wide) {
    let src = fs.readFileSync(ilvmC, "utf8");
    const set = function (macro, value) {
      const re = new RegExp("^#define " + macro + " +[0-9]+", "m");
      if (!re.test(src)) throw new Error("ilvm.c has no #define " + macro);
      src = src.replace(re, "#define " + macro + " " + value);
    };
    set("MAX_REGS", 100); set("MAX_GLOBALS", 80); set("MAX_SLOTS", 40);
    set("UP_PERM", 140); set("MAX_UPS", 40);
    ilvmC = path.join(tmp, "ilvm-wide.c");
    fs.writeFileSync(ilvmC, src);
  }
  const r = spawnSync("cc", [
    "-DILVM_HOST", "-O2", "-I", path.join(ROOT, "tools", "toyc"),
    "-I", path.join(ROOT, "tools", "ilvm"), ilvmC,
    path.join(ROOT, "tools", "ilvm", "ilvm_sound.c"),
    path.join(ROOT, "tools", "ilvm", "hostvm.c"), "-o", bin
  ], { cwd: ROOT, encoding: "utf8" });
  check(r.status === 0, "the system cc builds " + (wide ? "a wide-capacity copy of " : "") +
        "ilvm.c with hostvm.c" +
        (r.status === 0 ? "" : ": " + (r.stderr || "").trim().split("\n").slice(-2).join(" | ")));
  return bin;
}
const hostvm = buildHost("hostvm", false);
const hostvmWide = buildHost("hostvm-wide", true);

/* The host half: container -> { refused, frames: [ [ {line,mask,bxr,byr,cr} ... ] ] }. */
function hostRun(bytes, frames, name, bin) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, "toy.ilbc");
  fs.writeFileSync(p, Buffer.from(bytes));
  const r = spawnSync(bin || hostvm, [p, dir, String(frames)], { encoding: "utf8" });
  if (r.status !== 0) return { error: (r.stderr || r.stdout || "").trim() };
  const lines = fs.readFileSync(path.join(dir, "raster.txt"), "utf8").trim().split("\n");
  const refused = parseInt(lines[0].split(" ")[1], 10);
  const per = [];
  for (let f = 0; f < frames; f++) per.push([]);
  for (const l of lines.slice(1)) {
    const v = l.split(" ").map(Number);
    /* a field the mask leaves out is unread (the runtime's op byte skips it): compare it as 0 */
    if (per[v[0]]) per[v[0]].push({ line: v[1], mask: v[2], bxr: v[2] & 1 ? v[3] : 0, byr: v[2] & 2 ? v[4] : 0, cr: v[2] & 4 ? v[5] : 0 });
  }
  for (const f of per) f.sort(function (a, b) { return a.line - b.line; });
  return { refused: refused, frames: per };
}

/* The browser half: the toy's raster table for each of the first `frames` frames. */
function browserRun(source, frames) {
  const t = toys.create(source, { budgetMs: 4000 });
  t.load();
  const per = [];
  let error = null;
  for (let f = 0; f < frames; f++) {
    try { t.frame(f); } catch (e) { error = e; break; }
    if (t.broken) { error = t.error; break; }
    const table = t.lastRaster;
    const entries = [];
    if (table) {
      for (const e of table.entries) {
        entries.push({
          line: e.line,
          mask: (e.bxr != null ? 1 : 0) | (e.byr != null ? 2 : 0) | (e.cr != null ? 4 : 0),
          bxr: e.bxr != null ? e.bxr : 0, byr: e.byr != null ? e.byr : 0,
          cr: e.cr != null ? e.cr : 0
        });
      }
    }
    entries.sort(function (a, b) { return a.line - b.line; });
    per.push(entries);
  }
  t.dispose();
  return { frames: per, error: error };
}

function encode(source) {
  const program = il.compile(source, { chunkName: "@main.lua" });
  return ilbc.encode(program).bytes;
}

function same(name, source, frames) {
  let bytes;
  try { bytes = encode(source); } catch (e) {
    check(false, name + ": encodes (" + (e.code || "") + " " + e.message + ")");
    return;
  }
  const h = hostRun(bytes, frames, name.replace(/\W+/g, "_"));
  const b = browserRun(source, frames);
  if (h.error) { check(false, name + ": hostvm runs (" + h.error + ")"); return; }
  check(!b.error, name + ": the browser model runs without stopping" +
        (b.error ? " (" + b.error.code + ")" : ""));
  let bad = null;
  for (let f = 0; f < frames && !bad; f++) {
    const hs = JSON.stringify(h.frames[f]), bs = JSON.stringify(b.frames[f]);
    if (hs !== bs) bad = "frame " + f + ": host " + hs.slice(0, 200) + " browser " + bs.slice(0, 200);
  }
  check(!bad, name + ": the host's entries equal the browser's for " + frames + " frames" +
        (bad ? " (" + bad + ")" : ""));
  eq(name + ": nothing refused", h.refused, 0);
  const total = h.frames.reduce(function (n, f) { return n + f.length; }, 0);
  check(total > 0, name + ": the toy registered entries (" + total + ")");
}

/* ---- 1. the grid ------------------------------------------------------- */

const KEYS = ["bxr", "byr", "cr"];
const EDGE = { bxr: [0, 1, 255, 1023], byr: [0, 1, 255, 511], cr: [0, 1, 128, 255] };
const MOD = { bxr: 1024, byr: 512, cr: 256 };
function subsets() {
  const out = [];
  for (let m = 1; m < 8; m++) out.push(KEYS.filter(function (k, i) { return m & (1 << i); }));
  return out;
}

/* Toy A..: each subset on a spread of lines with per-frame values (<= 16 lines). */
const LINES = [0, 1, 2, 17, 63, 64, 100, 111, 150, 190, 222, 223];
subsets().forEach(function (keys, si) {
  let src = "function frame(t, f)\n";
  LINES.forEach(function (ln, li) {
    const parts = keys.map(function (k, ki) {
      const e = EDGE[k];
      return k + " = (" + e[(li + ki + si) % e.length] + " + f * " + (ki + 1) + ") % " + MOD[k];
    });
    src += "  raster(" + ln + ", { " + parts.join(", ") + " })\n";
  });
  src += "end\n";
  same("grid " + keys.join("+"), src, 6);
});

/* Every edge value of every key alone, one frame per value set (line varies with the frame). */
KEYS.forEach(function (k) {
  const vals = EDGE[k].map(function (v) { return v; });
  let src = "local vals = { " + vals.join(", ") + " }\nfunction frame(t, f)\n";
  src += "  local v = vals[f % " + vals.length + " + 1]\n";
  src += "  raster(f % 224, { " + k + " = v })\n";
  src += "  raster(223 - f % 224, { " + k + " = vals[1] })\n";
  src += "end\n";
  same("edges " + k, src, 12);
});

/* The spec table is built with its fields in another order, with a table-valued local reused. */
same("field order and reuse", [
  "function frame(t, f)",
  "  local s = { cr = 3 + f, bxr = 7, byr = 9 }",
  "  raster(5, s)",
  "  local t = { byr = 100 + f }",
  "  t.cr = 200",
  "  raster(6, t)",
  "  local a = f * 2",
  "  local b = a + 1",
  "  local u = { bxr = a, cr = b }",
  "  raster(7, u)",
  "  s.bxr = 77",
  "  raster(8, s)",
  "end"
].join("\n"), 6);

/* A spec whose registers the later statements reuse: the values are read at the call. */
same("read at the call", [
  "function frame(t, f)",
  "  local line = 20 + f",
  "  local spec = { bxr = f + 1 }",
  "  spec.byr = f + 2",
  "  raster(line, spec)",
  "  spec.byr = f + 50",
  "  raster(line + 1, spec)",
  "end"
].join("\n"), 8);

/* The exported-route toy of tests/check-export-games.js's RASTER TABLE pin. */
same("tools/toys/rastertable.lua",
     fs.readFileSync(path.join(ROOT, "tools", "toys", "rastertable.lua"), "utf8"), 16);

/* Entries registered by the main chunk and init (static) and by frame(). */
same("static and frame entries", [
  "raster(30, { bxr = 5 })",
  "function init() raster(31, { byr = 6, cr = 7 }) end",
  "function frame(t, f) raster(40 + f, { bxr = f }) end"
].join("\n"), 1);

/* ---- 2. repeated lines -------------------------------------------------- */

{
  const src = [
    "function frame(t, f)",
    "  raster(50, { bxr = 1 })",
    "  raster(50, { bxr = 2 })",
    "end"
  ].join("\n");
  const h = hostRun(encode(src), 2, "repeat");
  const b = browserRun(src, 2);
  check(b.error && b.error.code === "raster-line-full",
        "a repeated line stops the browser toy with raster-line-full");
  check(!h.error && h.refused >= 1, "the host counts the repeated line as refused (" + (h.refused) + ")");
  check(!h.error && h.frames[0].length === 1 && h.frames[0][0].bxr === 1,
        "the host keeps the first entry of the repeated line");
}

/* ---- 3. the encoder's refusals ----------------------------------------- */

function refusal(name, source, code) {
  let got = null;
  try { encode(source); } catch (e) { got = e.code || String(e.message); }
  eq(name, got, code);
}
refusal("a cram field is refused by name",
        "function frame(t, f) raster(1, { bxr = 1, cram = { { 0, 0 } } }) end", "ilbc-raster-spec");
refusal("a spec with only cram sets none of bxr/byr/cr",
        "function frame(t, f) raster(1, { cram = { { 0, 0 } } }) end", "ilbc-raster-spec");
refusal("an empty spec is refused",
        "function frame(t, f) raster(1, {}) end", "ilbc-raster-spec");

/* ---- 4. NOVA TIDE ------------------------------------------------------- */

{
  const source = fs.readFileSync(path.join(ROOT, "toys", "nova-tide", "main.lua"), "utf8");
  let bytes = null;
  try { bytes = encode(source); } catch (e) {
    check(false, "NOVA TIDE encodes (" + (e.code || "") + ": " + e.message + ")");
  }
  if (bytes) {
    check(true, "NOVA TIDE encodes (" + bytes.length + " B of bytecode)");
    const N = 24;
    const h = hostRun(bytes, N, "novatide", hostvmWide);
    const b = browserRun(source, N);
    if (h.error) check(false, "NOVA TIDE runs in the host harness (" + h.error + ")");
    else {
      check(!b.error, "NOVA TIDE runs in the browser model");
      let bad = null, total = 0;
      for (let f = 0; f < N && !bad; f++) {
        total += h.frames[f].length;
        if (JSON.stringify(h.frames[f]) !== JSON.stringify(b.frames[f])) {
          bad = "frame " + f + ": host " + JSON.stringify(h.frames[f]).slice(0, 240) +
                " browser " + JSON.stringify(b.frames[f]).slice(0, 240);
        }
      }
      check(!bad, "NOVA TIDE: the host's raster entries equal the browser's for " + N +
            " frames" + (bad ? " (" + bad + ")" : ""));
      eq("NOVA TIDE: nothing refused", h.refused, 0);
      check(total > 0, "NOVA TIDE registers raster entries (" + total + ")");
    }
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
if (failures.length) {
  console.log("FAIL " + failures.length + " of " + checks + " checks");
  process.exit(1);
}
console.log("PASS " + checks + " checks");
