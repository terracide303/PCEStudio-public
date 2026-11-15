#!/usr/bin/env node
/*
 * tests/check-cgen-split.js — the C backend splits a function that is too big
 * for one ROM bank into chunks (compiler step 1).
 *
 *   node tests/check-cgen-split.js
 *
 * Checks the emitted C of TOWER with its biggest functions split: a dispatcher
 * of the function's own name, one C function per chunk, a re-entry guard, the
 * register file in .bss (a zero-page array is zeroed through a pointer the
 * toolchain gets wrong, measured), every chunk-crossing jump returning a pc,
 * and that nothing changes when no split is asked for.  The behaviour is
 * proved by tools/native-compare.js: the split ROM's picture is the
 * browser's (docs/NATIVE.md); llvm-mos is not called here.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const il = require("../renderer/pce-il.js");
const cgen = require("../renderer/pce-cgen.js");

let checks = 0;
const failures = [];
function check(ok, name) {
  checks++;
  if (!ok) { failures.push(name); console.log("FAIL  " + name); }
}
const src = fs.readFileSync(path.join(__dirname, "..", "toys", "tower", "main.lua"), "utf8");
const program = il.compile(src, { chunkName: "@main.lua" });
function text(r) { return typeof r === "string" ? r : r.c || String(r); }

const plain = text(cgen.emitC(program, { target: "llvm" }));
check(!/il_fn_\d+_c\d+/.test(plain), "no split unless asked: no chunk functions in the default C");
check(!/IL_CHUNK_CALL/.test(plain), "no split unless asked: no chunk hook in the default C");

const big = program.functions.map(function (f, i) { return [i, f.code.length]; })
  .filter(function (x) { return x[1] > 150; }).map(function (x) { return x[0]; });
check(big.length >= 2, "TOWER has functions over 150 IL instructions (" + big.join(",") + ")");
const split = text(cgen.emitC(program, { target: "llvm", splitOver: 1, splitOnly: big }));
big.forEach(function (fid) {
  const n = program.functions[fid].code.length;
  /* #300: a cut moves up to 40% either way to keep a loop in one chunk, so the count is no longer
   * ceil(n/100): every chunk is 60..140 instructions (the last may be shorter), numbered without gaps */
  const found = new Set();
  split.replace(new RegExp("il_fn_" + fid + "_c(\\d+)\\(struct il_closure \\*cl, int16_t pc, int32_t \\*rv\\)", "g"), function (m, k) { found.add(+k); return m; });
  const chunks = found.size;
  check(chunks >= Math.ceil(n / 140) && chunks <= Math.ceil(n / 60),
        "fn " + fid + ": " + chunks + " chunks for " + n + " instructions (between ceil(n/140) and ceil(n/60))");
  for (let k = 0; k < chunks; k++) check(found.has(k), "fn " + fid + ": chunk " + k + " of " + chunks + " exists");
  const lens = []; split.replace(new RegExp("pc < (\\d+)\\) pc = IL_CHUNK_CALL\\(il_fn_" + fid + "_c", "g"), function (m, e) { lens.push(+e); return m; });
  lens.push(n);
  check(lens.every(function (e, i) { return e - (i ? lens[i - 1] : 0) <= 140 && (i === lens.length - 1 || e - (i ? lens[i - 1] : 0) >= 60); }),
        "fn " + fid + ": every chunk is 60..140 instructions (" + lens.join(",") + ")");
  check(new RegExp("static int32_t il_fn_" + fid + "_r\\[\\d+\\]\\s+__attribute__\\(\\(section\\(\"\\.bss\"\\)\\)\\);").test(split),
        "fn " + fid + ": the register file is in .bss");
  check(split.indexOf("if (il_fn_" + fid + "_busy) { il_split_reentered = 1; return 0; }") >= 0,
        "fn " + fid + ": the re-entry guard");
});
check(/\{ return \d+; \}/.test(split), "a jump out of a chunk returns the target pc");
check(/\{ \*rv = [^;]+; return -1; \}/.test(split), "a ret inside a chunk returns through *rv");
check(split.indexOf("#define IL_CHUNK_CALL(sym, e) (e)") >= 0, "the bank hook defaults to the plain call");

if (failures.length) {
  console.log("FAIL  " + failures.length + " of " + checks + " checks failed");
  process.exit(1);
}
console.log("PASS  " + checks + " checks, the C backend's function splitting");
