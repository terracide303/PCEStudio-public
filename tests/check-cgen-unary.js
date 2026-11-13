#!/usr/bin/env node
/*
 * tests/check-cgen-unary.js — the C backend lowers `-a`, `~a` and `not a`
 * (compiler step 1: NOVA TIDE and DUSK RUN were refused on `unm`).
 *
 *   node tests/check-cgen-unary.js
 *
 * The three instructions are checked against the interpreter's meaning in
 * pce-il.js (unm: 0 - a, bnot: ~a, not: truthiness of a bool), on the
 * emitted C text — llvm-mos is not called.  A fixed-point `-a` still refuses
 * cgen-fixed.
 */
"use strict";
const il = require("../renderer/pce-il.js");
const cgen = require("../renderer/pce-cgen.js");

let checks = 0;
const failures = [];
function check(ok, name) {
  checks++;
  if (!ok) { failures.push(name); console.log("FAIL  " + name); }
}
function emit(src) {
  return cgen.emitC(il.compile(src, { chunkName: "@main.lua" }), { target: "llvm" });
}
function text(r) { return typeof r === "string" ? r : r.c || String(r); }

const src = [
  "n = 0",
  "on = false",
  "function frame(t, f)",
  "  local a = f % 7",
  "  local b = -a",
  "  local c = ~a",
  "  on = not on",
  "  n = b + c",
  "  if on then n = n + 1 end",
  "end"
].join("\n");
let c = "";
try { c = text(emit(src)); } catch (e) { check(false, "emits: " + e.message); }
check(/= \(int32_t\)\(0 - \(uint32_t\)/.test(c), "unm lowers to a two's-complement 0 - a");
check(/= \(int32_t\)\(~\(uint32_t\)/.test(c), "bnot lowers to ~a");
check(/r\[\d+\] = \(r\[\d+\] == 0\);/.test(c), "not lowers to (a == 0)");

let code = null;
try { emit("function frame(t, f)\n  local x = f * 0.5\n  x = -x\nend"); }
catch (e) { code = e.code; }
check(code === "cgen-fixed" || code === "cgen-op", "fixed-point negation is still refused (" + code + ")");

if (failures.length) {
  console.log("FAIL  " + failures.length + " of " + checks + " checks failed");
  process.exit(1);
}
console.log("PASS  " + checks + " checks, the C backend's unary lowering");
