#!/usr/bin/env node
/*
 * tests/check-cgen-pow2.js — `x // 2^k` and `x % 2^k` lower to a shift and a mask in the generated C,
 * and give Lua's floor results for negative and positive dividends (tests/native-pow2 through
 * tools/host-c-compare.js: the C on this machine against the browser runtime, 300 frames).
 * Divisors that are not powers of two keep the division helpers.  SKIP without a C compiler.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const il = require("../renderer/pce-il.js");
const cgen = require("../renderer/pce-cgen.js");
let checks = 0; const failures = [];
function check(ok, name) { checks++; if (!ok) { failures.push(name); console.log("FAIL  " + name); } }
const src = fs.readFileSync(path.join(ROOT, "tests", "native-pow2", "main.lua"), "utf8");
const r = cgen.emitC(il.compile(src, { chunkName: "@main.lua" }), { target: "llvm" });
const c = typeof r === "string" ? r : r.c || String(r);
check(/>> 1\)/.test(c) && />> 3\)/.test(c) && />> 6\)/.test(c) && />> 10\)/.test(c), "// by 2, 8, 64 and 1024 are arithmetic shifts");
check(/& 0x7u\)/.test(c) && /& 0x3fu\)/.test(c) && /& 0x3ffu\)/.test(c), "% by 8, 64 and 1024 are masks");
check(/il_lua_idiv\(/.test(c) && /il_lua_mod\(/.test(c), "// and % by 3 still call the division helpers");
if (spawnSync("bash", ["-c", "command -v cc"]).status !== 0) { console.log("SKIP: no C compiler; the results were not compared"); }
else {
  const o = spawnSync("node", [path.join(ROOT, "tools", "host-c-compare.js"), path.join("tests", "native-pow2", "main.lua"), "300"], { cwd: ROOT, encoding: "utf8" });
  const line = (o.stdout || o.stderr || "").trim().split("\n")[0];
  check(o.status === 0 && /300 of 300 frames equal/.test(line), "the C's results equal the browser's floor division and remainder over 300 frames (" + line.slice(0, 100) + ")");
}
if (failures.length) { console.log("FAIL  " + failures.length + " of " + checks + " checks failed"); process.exit(1); }
console.log("PASS  " + checks + " checks, constant power-of-two // and % lower to shifts and masks and match Lua");
