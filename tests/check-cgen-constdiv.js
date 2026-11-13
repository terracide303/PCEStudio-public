#!/usr/bin/env node
/*
 * tests/check-cgen-constdiv.js — the C backend's floor division and modulo (il_lua_idiv, il_lua_mod in
 * renderer/pce-cgen.js) equal Lua's, over a wide grid: divisors 1..1,000, powers of two, 255/256,
 * 10/100/60/7/3, 16-bit and 32-bit limits, negatives; dividends negative, 0, +-1, around +-32768 and
 * +-65536, the 32-bit limits and seeded random values.  The two helpers carry a 16-bit fast path
 * (the console's 32-bit software division costs ~1,500 cycles, 16-bit ~300); this checks the fast path
 * and the fallback agree with a BigInt reference.  The helpers are cut out of the C the backend emits
 * for tests/native-constdiv and compiled with the host C compiler, as tests/check-cgen-mul.js does.
 * Division by zero is not checked (it keeps whatever the backend does).
 */
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const il = require(ROOT + "/renderer/pce-il.js");
const cgen = require(ROOT + "/renderer/pce-cgen.js");
let bad = 0, n = 0;
function ok(name, cond, extra) { n++; if (!cond) { bad++; console.log("  FAIL " + name + (extra ? " — " + extra : "")); } else console.log("  ok   " + name); }

const src = fs.readFileSync(path.join(__dirname, "native-constdiv/main.lua"), "utf8");
const c = cgen.emitC(il.compile(src, { chunkName: "main.lua" }), { target: "llvm" });
const cut = (name) => new RegExp("static (?:__attribute__\\(\\(noinline\\)\\) )?int32_t " + name + "\\(int32_t x, int32_t y\\) \\{[\\s\\S]*?\\n\\}\\n").exec(c);
const mi = cut("il_lua_idiv"), mm = cut("il_lua_mod");
ok("the emitted C carries il_lua_idiv and il_lua_mod", !!mi && !!mm);
if (!mi || !mm) process.exit(1);

const ys = [];
for (let y = 1; y <= 1000; y++) ys.push(y);
[1024, 4096, 16384, 32767, 32768, 32769, 40000, 65535, 65536, 65537, 100000, 0x7fffffff, -1, -2, -3, -7, -10, -255, -256, -32768, -65535, -65536, -0x80000000]
  .forEach((v) => ys.push(v));
const xs = [0, 1, -1, 2, -2, 9, 10, 11, -9, -10, -11, 99, 100, 255, 256, 257, 32767, 32768, 32769, -32767, -32768, -32769, 65534, 65535, 65536, 65537, -65535, -65536, -65537, 100000, -100000, 0x7fffffff, -0x80000000, 0x7ffffffe, -0x7fffffff];
let s = 987654321;
function rnd() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s; }
for (let i = 0; i < 400; i++) xs.push(rnd() % 70000, -(rnd() % 40000), ((rnd() << 1) ^ rnd()) | 0);
const pairs = [];
for (const y of ys) for (let i = 0; i < 12; i++) pairs.push([xs[(((y * 31 + i * 17) % xs.length) + xs.length) % xs.length], y]);
for (const x of xs) for (const y of [3, 7, 10, 60, 100, 255, 256, -7, 65535, 65536]) pairs.push([x, y]);

const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "constdiv-"));
fs.writeFileSync(path.join(dir, "t.c"), "#include <stdint.h>\n#include <stdio.h>\n" + mi[0] + mm[0] +
  "int main(void){ int32_t a,b; while (scanf(\"%d %d\", &a, &b)==2) printf(\"%d %d\\n\", il_lua_idiv(a,b), il_lua_mod(a,b)); return 0; }\n");
const cc = spawnSync("cc", ["-O1", "-o", path.join(dir, "t"), path.join(dir, "t.c")], { encoding: "utf8" });
ok("the helpers compile on the host", cc.status === 0, cc.stderr);
const run = spawnSync(path.join(dir, "t"), [], { input: pairs.map((p) => p[0] + " " + p[1]).join("\n") + "\n", encoding: "utf8", maxBuffer: 1 << 26 });
const got = run.stdout.trim().split("\n");
function floorDiv(a, b) { const q = a / b; return (a % b !== 0n && ((a < 0n) !== (b < 0n))) ? q - 1n : q; }
let wrongQ = 0, wrongM = 0, first = null;
pairs.forEach((p, i) => {
  const a = BigInt(p[0]), b = BigInt(p[1]);
  const q = BigInt.asIntN(32, floorDiv(a, b)), m = BigInt.asIntN(32, a - floorDiv(a, b) * b);
  const g = (got[i] || "").split(" ");
  if (Number(g[0]) !== Number(q)) { wrongQ++; if (!first) first = "// " + p + " got " + g[0] + " want " + q; }
  if (Number(g[1]) !== Number(m)) { wrongM++; if (!first) first = "% " + p + " got " + g[1] + " want " + m; }
});
ok(pairs.length + " floor quotients equal Lua's", wrongQ === 0, first);
ok(pairs.length + " floor remainders equal Lua's", wrongM === 0, first);
/* ---- constant divisors: the reciprocal-multiply helpers il_idivc_<c> / il_modc_<c> ------------------ */
const CONSTS = [3, 5, 6, 7, 9, 10, 11, 12, 13, 15, 17, 24, 25, 31, 33, 60, 99, 100, 101, 127, 255, 257, 360, 500, 1000, 1023, 1025, 4095, 12345, 32767, 20000, 30000];
let lua = "gy = 0\nfunction frame(t, f)\n  local x = f\n";
CONSTS.forEach((k) => { lua += "  gy = gy + x // " + k + " + x % " + k + "\n"; });
lua += "end\n";
const c2 = cgen.emitC(il.compile(lua, { chunkName: "main.lua" }), { target: "llvm" });
const helpers = [];
const re = /\/\* x (?:\/\/|%) \d+ for [\s\S]*?\n\}\n/g;
let mm2;
while ((mm2 = re.exec(c2))) helpers.push(mm2[0]);
ok("the emitted C carries " + CONSTS.length * 2 + " constant-divisor helpers", helpers.length === CONSTS.length * 2, "found " + helpers.length);
const gen2 = cut2("il_lua_idiv", c2) + cut2("il_lua_mod", c2);
function cut2(name, text) { const m = new RegExp("static (?:__attribute__\\(\\(noinline\\)\\) )?int32_t " + name + "\\(int32_t x, int32_t y\\) \\{[\\s\\S]*?\\n\\}\\n").exec(text); return m ? m[0] : ""; }
let drv = "int main(void){ long x; int32_t bad = 0;\n";
const probes = [];
for (let x = -32768; x <= 65535; x++) probes.push(x);
[65536, 65537, 100000, -32769, -32770, -65536, 0x7fffffff, -0x80000000, 0x7ffffffe].forEach((v) => probes.push(v));
CONSTS.forEach((k) => {
  drv += "  for (x = -32768; x <= 65535; x++) { if (il_idivc_" + k + "(x) != il_lua_idiv(x, " + k + ") || il_modc_" + k + "(x) != il_lua_mod(x, " + k + ")) { printf(\"BAD " + k + " %ld\\n\", x); bad++; break; } }\n";
  [65536, 65537, 100000, -32769, -65536, 0x7fffffff, -0x7fffffff - 1].forEach((v) => {
    drv += "  if (il_idivc_" + k + "(" + v + "L) != il_lua_idiv(" + v + "L, " + k + ") || il_modc_" + k + "(" + v + "L) != il_lua_mod(" + v + "L, " + k + ")) { printf(\"BAD " + k + " " + v + "\\n\"); bad++; }\n";
  });
});
drv += "  printf(\"done %d\\n\", bad); return bad != 0; }\n";
fs.writeFileSync(path.join(dir, "c.c"), "#include <stdint.h>\n#include <stdio.h>\n" + gen2 + helpers.join("\n") + drv);
const cc2 = spawnSync("cc", ["-O1", "-o", path.join(dir, "c"), path.join(dir, "c.c")], { encoding: "utf8" });
ok("the constant-divisor helpers compile on the host", cc2.status === 0, cc2.stderr);
const r2 = spawnSync(path.join(dir, "c"), [], { encoding: "utf8" });
ok("every constant-divisor helper equals the generic helper for all dividends -32768..65535 and the 32-bit extremes (" + CONSTS.length + " constants)", r2.status === 0 && /done 0/.test(r2.stdout), (r2.stdout || "").trim().split("\n")[0]);
/* ---- constant multipliers: il_mulc_<K> (16-bit shift-add path with the il_lua_mul fallback) ------------ */
const MULKS = [3, 5, 6, 7, 9, 10, 11, 12, 13, 15, 18, 19, 20, 26, 37, 50, 75, 100, 255, 1000, 4095];
let lua2 = "gy = 0\nfunction frame(t, f)\n  local x = f\n";
MULKS.forEach((k) => { lua2 += "  gy = gy + x * " + k + "\n"; });
lua2 += "end\n";
const c3 = cgen.emitC(il.compile(lua2, { chunkName: "main.lua" }), { target: "llvm" });
const mulHelpers = [];
const re3 = /static inline __attribute__\(\(always_inline\)\) int32_t il_mulc_\d+\(int32_t x\) \{[\s\S]*?\n\}\n/g;
let m3;
while ((m3 = re3.exec(c3))) mulHelpers.push(m3[0]);
ok("the emitted C carries " + MULKS.length + " constant-multiplier helpers", mulHelpers.length === MULKS.length, "found " + mulHelpers.length);
const lm = /static int32_t il_lua_mul\(int32_t a, int32_t b\) \{[\s\S]*?\n\}\n/.exec(c3);
let drv3 = "int main(void){ long x; int bad = 0;\n";
MULKS.forEach((k) => {
  drv3 += "  for (x = -140000; x <= 140000; x++) { if (il_mulc_" + k + "((int32_t)x) != (int32_t)((uint32_t)x * " + k + "u)) { printf(\"BAD " + k + " %ld\\n\", x); bad++; break; } }\n";
  [0x7fffffff, -0x7fffffff - 1, 0x12345678, -0x12345678, 1000000, -1000000].forEach((v) => {
    drv3 += "  if (il_mulc_" + k + "(" + v + "L) != (int32_t)((uint32_t)" + v + "L * " + k + "u)) { printf(\"BAD " + k + " " + v + "\\n\"); bad++; }\n";
  });
});
drv3 += "  printf(\"done %d\\n\", bad); return bad != 0; }\n";
fs.writeFileSync(path.join(dir, "m.c"), "#include <stdint.h>\n#include <stdio.h>\n" + (lm ? lm[0] : "") + mulHelpers.join("\n") + drv3);
const cc3 = spawnSync("cc", ["-O1", "-o", path.join(dir, "m"), path.join(dir, "m.c")], { encoding: "utf8" });
ok("the constant-multiplier helpers compile on the host", cc3.status === 0, cc3.stderr);
const r3 = spawnSync(path.join(dir, "m"), [], { encoding: "utf8" });
ok("every constant-multiplier helper equals the wrapping 32-bit product for x in -140000..140000 and the 32-bit extremes (" + MULKS.length + " constants)", r3.status === 0 && /done 0/.test(r3.stdout), (r3.stdout || "").trim().split("\n")[0]);
console.log((bad ? "FAIL " : "PASS ") + " " + n + " checks, floor division, modulo and constant multiplication equal Lua's");
process.exit(bad ? 1 : 0);
