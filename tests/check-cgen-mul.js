#!/usr/bin/env node
/*
 * tests/check-cgen-mul.js — the C backend's il_lua_mul (renderer/pce-cgen.js) multiplies
 * exactly like the IL's wrapping 32-bit multiply: signs, zero, the 16-bit limits and the
 * full-width fallback, over a fixed grid plus seeded random pairs.  The helper is cut out of
 * the C the backend emits for tests/native-mul and compiled with the host C compiler.
 */
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const il = require(ROOT + "/renderer/pce-il.js");
const cgen = require(ROOT + "/renderer/pce-cgen.js");
let bad = 0, n = 0;
function ok(name, cond, extra) { n++; if (!cond) { bad++; console.log("  FAIL " + name + (extra ? " — " + extra : "")); } else console.log("  ok   " + name); }

const src = fs.readFileSync(path.join(__dirname, "native-mul/main.lua"), "utf8");
const c = cgen.emitC(il.compile(src, { chunkName: "main.lua" }), { target: "llvm" });
const m = /static int32_t il_lua_mul\(int32_t a, int32_t b\) \{[\s\S]*?\n\}\n/.exec(c);
ok("the emitted C carries il_lua_mul", !!m);
ok("the toy's multiply calls it", /il_lua_mul\(/.test(c.replace(m ? m[0] : "", "")));
if (!m) process.exit(1);

const vals = [0, 1, -1, 2, -2, 3, 7, 255, 256, -256, 32767, -32768, 65535, 65536, -65536, 65537,
  0x7fffffff, -0x80000000, 0x12345678, -0x12345678, 100000, -100000, 46341, -46341];
let s = 12345;
function rnd() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s; }
for (let i = 0; i < 400; i++) vals.push(((rnd() << 1) ^ rnd()) | 0, (rnd() % 600) - 300, rnd() % 70000);
const pairs = [];
for (let i = 0; i < vals.length; i++) for (let j = 0; j < 24; j++) pairs.push([vals[i], vals[(i * 7 + j * 13) % vals.length]]);
for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) pairs.push([vals[i], vals[j]]);

const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "mul-"));
fs.writeFileSync(path.join(dir, "t.c"), "#include <stdint.h>\n#include <stdio.h>\n" + m[0] +
  "int main(void){ int32_t a,b; while (scanf(\"%d %d\", &a, &b)==2) printf(\"%d\\n\", il_lua_mul(a,b)); return 0; }\n");
const cc = spawnSync("cc", ["-O1", "-o", path.join(dir, "t"), path.join(dir, "t.c")], { encoding: "utf8" });
ok("the helper compiles on the host", cc.status === 0, cc.stderr);
const run = spawnSync(path.join(dir, "t"), [], { input: pairs.map((p) => p[0] + " " + p[1]).join("\n") + "\n", encoding: "utf8", maxBuffer: 1 << 26 });
const got = run.stdout.trim().split("\n");
let wrong = 0, first = null;
pairs.forEach((p, i) => {
  const want = Number(BigInt.asIntN(32, BigInt(p[0]) * BigInt(p[1])));
  if (Number(got[i]) !== want) { wrong++; if (!first) first = p + " got " + got[i] + " want " + want; }
});
ok(pairs.length + " products equal the wrapping 32-bit multiply", wrong === 0, first);
console.log((bad ? "FAIL " : "PASS ") + " " + n + " checks, il_lua_mul equals the IL's wrapping multiply");
process.exit(bad ? 1 : 0);
