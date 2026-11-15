#!/usr/bin/env node
/*
 * tests/check-cgen-tables.js — fast table access in the C backend (#292).
 *
 * A table read in compiled code used to go through il_table_get(): a slot lookup, two 32-bit range
 * checks and four byte loads of a 32-bit cell.  Now, when the value of the table operand provably
 * comes from ONE `table` site (a global assigned once, a local captured by a function, a move), the
 * emitter reads the cell directly with the slot's base and capacity as constants; it drops the bounds
 * check when the index is a constant or provably inside the slot (a for-loop variable, a masked
 * expression); and it stores the slot's cells as bytes or 16-bit words when every value any store can
 * put in the slot fits.  Out of range still reads 0 and writes nothing.
 *
 *   1. UNIT TESTS of the emitted C: which accesses resolve, which keep the helper, which cell pool a
 *      slot lands in, which guards stay.
 *   2. THE C EQUALS THE BROWSER: tests/native-tables/main.lua through tools/host-c-compare.js, 300
 *      frames (in-range indexes only: the browser faults outside the slot).
 *   3. OUT OF RANGE, OLD PATH VS NEW: the same toy with indexes below, inside and above the slot,
 *      emitted twice (helpers and int32 cells everywhere = the previous output; and the fast path) and
 *      run on this machine: the sprite lists must be identical.
 *
 * SKIP (parts 2 and 3) without a C compiler.
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const il = require("../renderer/pce-il.js");
const cgen = require("../renderer/pce-cgen.js");
let checks = 0; const failures = [];
function check(ok, name) { checks++; if (!ok) { failures.push(name); console.log("FAIL  " + name); } }

function emit(src, opts) {
  const r = cgen.emitC(il.compile(src, { chunkName: "@main.lua" }), Object.assign({ target: "llvm" }, opts || {}));
  return typeof r === "string" ? r : r.c || String(r);
}
/* the body of one generated function, helpers excluded */
function body(c, name) {
  const i = c.indexOf("static int32_t " + name + "(struct il_closure");
  const j = c.indexOf("\n}\n", c.indexOf("{", c.indexOf("{", i) < 0 ? i : c.indexOf(") {", i)));
  return c.slice(i, j);
}
const calls = (c, re) => (c.match(re) || []).length;
const HELPERCALL = /\bil_table_(get|set|getf|setf)\(r\[/g;   /* a call site, not a definition */

/* ---- 1. unit tests --------------------------------------------------------- */

/* a global table read in a function resolves: no helper call, a direct cell */
{
  const c = emit(`
flags = { 0, 0, 0, 0, 0, 0, 0, 0 }
function frame(t, f)
  local k = (f & 7) + 1
  flags[k] = (flags[k] + f) & 63
  sat(0, 0, flags[3] + flags[k])
end`);
  check(calls(c, HELPERCALL) === 0, "a global table's reads and writes resolve to its slot: no helper call");
  check(/il_cells8\[/.test(c) && !/il_cells16/.test(c), "masked stores (& 63) and constant stores put the slot in byte cells");
  check(/static uint8_t il_cells8\[8\]/.test(c), "the byte pool holds exactly the slot's 8 cells");
  check(/IL_TABLE_CELLS 1\b/.test(c), "the int32 pool is empty (one placeholder cell)");
  check(!/uint32_t ti/.test(c), "an index masked to 1..8 on a slot of 8 needs no bounds check, and a constant 3 none");
  check(/il_cells8\[0 \+ \(uint8_t\)\(r\[\d+\] - 1\)\]/.test(c), "the in-range dynamic index is one byte offset into the pool");
}

/* a store that can be anything (a table read plus one) keeps the slot in int32 cells */
{
  const c = emit(`
wide = { 0, 0, 0, 0 }
function frame(t, f)
  local j = (f & 3) + 1
  wide[j] = wide[j] + 1
  sat(0, 0, wide[j])
end`);
  check(calls(c, HELPERCALL) === 0 && !/il_cells8|il_cells16/.test(c), "an unbounded store keeps int32 cells (and still resolves)");
}

/* small negative values: 16-bit cells */
{
  const c = emit(`
sig = { 0, 0, 0 }
function frame(t, f)
  local s = (f % 3) + 1
  sig[s] = (f & 255) - 200
  sat(0, 0, sig[s] + 1000)
end`);
  check(/static int16_t il_cells16\[3\]/.test(c) && !/il_cells8/.test(c), "values in -200..55 go to 16-bit cells");
  check(/\(int32_t\)il_cells16\[/.test(c), "a 16-bit cell is sign-extended on a read");
}

/* values above 65535 or unknown: int32 */
{
  const c = emit(`
big = { 0, 0 }
function frame(t, f)
  big[1] = f * 70000
  sat(0, 0, big[1] & 255)
end`);
  check(!/il_cells8|il_cells16/.test(c), "a value past 16 bits keeps int32 cells");
}

/* records: field cells share the slot's kind */
{
  const c = emit(`
rec = { hp = 0, mp = 0 }
function frame(t, f)
  rec.hp = f & 127
  rec.mp = 7
  sat(0, 0, rec.hp + rec.mp)
end`);
  check(calls(c, HELPERCALL) === 0 && /static uint8_t il_cells8\[2\]/.test(c), "a record of small values: direct field cells in the byte pool");
  check(!/il_table_getf\(r\[/.test(c), "a field read has no helper call");
}

/* a local table captured as an upvalue resolves too */
{
  const c = emit(`
local lcl = { 3, 1, 4, 1 }
local function peek(i) return lcl[i] end
function frame(t, f)
  sat(0, 0, peek((f & 3) + 1))
end`);
  check(calls(c, HELPERCALL) === 0, "a local table read through an upvalue resolves (the key is a parameter: guarded, not helper)");
  check(/uint32_t ti/.test(c), "a key that is a parameter keeps its bounds check");
}

/* a table that arrives as a parameter is not resolvable: helper path, and its stores widen every slot */
{
  const c = emit(`
a = { 0, 0, 0, 0 }
b = { 0, 0, 0, 0 }
local function put(t, i, v) t[i] = v end
function frame(t, f)
  a[1] = 5
  put(b, 2, f)
  sat(0, 0, a[1] + b[2])
end`);
  check(calls(c, HELPERCALL) === 1 && /il_table_set\(r\[/.test(c), "a table passed as a parameter keeps the helper call");
  check(!/il_cells8|il_cells16/.test(c), "an unresolved store of an unknown value keeps every slot in int32 cells");
}
/* ... but an unresolved store of a small value leaves narrowing alone, and reads through the helper dispatch on the kind */
{
  const c = emit(`
a = { 0, 0, 0, 0 }
local function put(t, i) t[i] = 3 end
local function pick(t, i) return t[i] end
function frame(t, f)
  put(a, (f & 3) + 1)
  sat(0, 0, pick(a, 2))
end`);
  check(/static uint8_t il_cells8\[4\]/.test(c) && /il_slot_kind/.test(c), "an unresolved store of a small constant keeps byte cells; the helpers dispatch on the slot's kind");
  check(/case 1: return \(int32_t\)il_cells8\[/.test(c), "the dynamic read helper reads the byte pool for a byte slot");
}

/* a global assigned twice does not resolve */
{
  const c = emit(`
t1 = { 0, 0 }
t1 = { 0, 0, 0 }
function frame(t, f) sat(0, 0, t1[1]) end`);
  check(calls(c, HELPERCALL) === 1, "a global assigned at two sites is not one slot: helper call kept");
}

/* loops: a loop variable inside the slot needs no check, one that runs past the slot keeps it */
{
  const c = emit(`
a = { 0, 0, 0, 0, 0, 0 }
function frame(t, f)
  for i = 1, 6 do a[i] = i end
  local n = 0
  for i = 1, 6 do n = n + a[i] end
  sat(0, 0, n)
end`);
  check(!/uint32_t ti/.test(c) && calls(c, HELPERCALL) === 0, "for i = 1, 6 over a 6-cell slot: reads and writes without a check");
  const d = emit(`
a = { 0, 0, 0, 0, 0, 0 }
function frame(t, f)
  for i = 1, 9 do a[i] = i end
  local n = 0
  for i = 0, 5 do n = n + a[i] end
  sat(0, 0, n)
end`);
  check(calls(d, /uint32_t ti/g) === 2, "a loop that runs past the slot (1..9) or starts below it (0..5) keeps both guards");
}
{
  /* the limit in a local or a once-assigned global is a constant too; a limit that can change is not */
  const c = emit(`
local N = 6
M = 6
a = { 0, 0, 0, 0, 0, 0 }
local function sum()
  local n = 0
  for i = 1, N do n = n + a[i] end
  for i = 1, M do n = n + a[i] end
  return n
end
function frame(t, f) sat(0, 0, sum()) end`);
  check(!/uint32_t ti/.test(c), "a loop limit kept in a local or a once-assigned global is a constant");
  const d = emit(`
a = { 0, 0, 0, 0, 0, 0 }
function frame(t, f)
  local n = 0
  for i = 1, f & 7 do n = n + a[i] end
  sat(0, 0, n)
end`);
  check(/uint32_t ti/.test(d), "a loop limit that can reach 7 on a 6-cell slot keeps the check");
}
{
  /* a loop variable the body reassigns is not the loop's range */
  const c = emit(`
a = { 0, 0, 0 }
function frame(t, f)
  for i = 1, 3 do
    i = i + f
    a[i] = 1
  end
  sat(0, 0, a[1])
end`);
  check(/uint32_t ti/.test(c), "a loop variable the body assigns keeps the check");
}

/* the old path stays available and is what the layout pins describe */
{
  const src = `
flags = { 0, 0, 0 }
function frame(t, f) flags[(f & 1) + 1] = 1; sat(0, 0, flags[1]) end`;
  const old = emit(src, { noStaticTables: true, noNarrowCells: true });
  check(calls(old, HELPERCALL) >= 2 && !/il_cells8/.test(old), "noStaticTables + noNarrowCells is the previous output: helper calls and one int32 pool");
}

/* ---- 2 and 3. the C against the browser, and old path against new, out of range ----------------- */

if (spawnSync("bash", ["-c", "command -v cc"]).status !== 0) {
  console.log("SKIP: no C compiler; parts 2 and 3 (the C's results) were not run");
} else {
  const o = spawnSync("node", [path.join(ROOT, "tools", "host-c-compare.js"), path.join("tests", "native-tables", "main.lua"), "300"], { cwd: ROOT, encoding: "utf8" });
  const line = (o.stdout || o.stderr || "").trim().split("\n")[0];
  check(o.status === 0 && /300 of 300 frames equal/.test(line), "the C's sprite list equals the browser's over 300 frames, byte, 16-bit and 32-bit cells (" + line.slice(0, 90) + ")");

  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "tables-"));
  const base = fs.readFileSync(path.join(ROOT, "tests", "native-tables", "main.lua"), "utf8");
  /* out-of-range accesses on top of the in-range toy: keys from -2 to 13 on slots of 8, 4 and 3 cells */
  const oob = base.replace(/^function frame\(t, f\)\n/m, `function frame(t, f)
  local q = (f % 16) - 2
  flags[q] = f & 15
  wide[q] = f
  sig[q] = q
  sat(7, 0, flags[q] + 1000)
  sat(7, 1, (wide[q] & 4095) + 1000)
  sat(8, 0, sig[q] + 1000)
  sat(8, 1, pick(flags, q) + 1000)
  sat(9, 0, pick(wide, q + 1) + 1000)
  for i = 1, 12 do flags[i] = flags[i] + 1 & 31 end
  for i = 0, 5 do sat(10, i, wide[i] % 8 + 1000) end
`);
  check(oob !== base, "the out-of-range variant was built");
  const stub = path.join(ROOT, "tests", "hostc", "stub_runtime.c");
  function build(tag, opts) {
    const c = emit(oob, opts).replace(/__attribute__\(\(section\("[^"]*"\)\)\)/g, "")
      .replace(/__attribute__\(\(noinline, section\("[^"]*"\)\)\)/g, "__attribute__((noinline))");
    const cf = path.join(tmp, tag + ".c"), bin = path.join(tmp, tag);
    fs.writeFileSync(cf, c);
    const b = spawnSync("cc", ["-O1", "-w", "-I" + path.join(ROOT, "tools", "toyc"), "-o", bin, stub, cf], { encoding: "utf8" });
    if (b.status !== 0) { console.log(b.stderr.slice(0, 600)); return null; }
    const r = spawnSync(bin, ["300"], { encoding: "utf8", maxBuffer: 1 << 28 });
    return r.status === 0 ? r.stdout : null;
  }
  const oldOut = build("old", { noStaticTables: true, noNarrowCells: true });
  const newOut = build("new", {});
  check(oldOut && newOut && oldOut.length > 1000, "both builds ran");
  check(oldOut === newOut, "out-of-range reads give 0 and writes change nothing: the fast path's 300 sprite lists equal the helpers'");
  /* the instrument sees: the toy's out-of-range reads do reach sprite words (0 + 1000) */
  check(oldOut && /\b3e8\b/.test(oldOut), "the out-of-range reads show as 0 (+1000) in the sprite list");
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (failures.length) { console.log("FAIL  " + failures.length + " of " + checks + " checks failed"); process.exit(1); }
console.log("PASS  " + checks + " checks, tables with a known slot read and write their cells directly, in byte, 16-bit and 32-bit cells, and out of range reads 0 and writes nothing");
