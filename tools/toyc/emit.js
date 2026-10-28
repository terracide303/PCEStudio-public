#!/usr/bin/env node
/*
 * tools/toyc/emit.js — Lua toy in, generated C out (#31 part A).
 *
 *   node tools/toyc/emit.js toy.lua out.c
 *
 * Compiles the toy with renderer/pce-il.js (Fengari's parser, the same front
 * end the browser runs), validates the IL with renderer/pce-validate.js
 * (#32: frame time, sprites per line, VRAM/ROM fit, the blank, value ranges),
 * then emits C with renderer/pce-cgen.js.  Any refusal from any stage is
 * printed with its code and exits 1; the build script turns that into a
 * failed build rather than a wrong ROM.  The validator runs BEFORE cgen, so a
 * toy that both exceeds a budget and uses a construct part A cannot lower is
 * refused for the budget it missed (e.g. validate-sprite-line, not cgen-op).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const il = require("../../renderer/pce-il.js");
const cgen = require("../../renderer/pce-cgen.js");
const validate = require("../../renderer/pce-validate.js");

const srcPath = process.argv[2];
const outPath = process.argv[3];
if (!srcPath || !outPath) {
  console.error("usage: node tools/toyc/emit.js TOY.lua OUT.c");
  process.exit(2);
}

const source = fs.readFileSync(srcPath, "utf8");
try {
  const program = il.compile(source, { chunkName: path.basename(srcPath) });
  const report = validate.validateProgram(program, {
    chunkName: path.basename(srcPath)
  });
  if (!report.ok) {
    const first = report.problems.filter((p) => p.severity === "error")[0];
    console.error("validate failed: " + (first ? first.code : "validate") +
                  ": " + (first ? first.message : "the toy failed"));
    process.exit(1);
  }
  fs.writeFileSync(outPath, cgen.emitC(program));
} catch (e) {
  const code = e && (e.code || e.name) || "error";
  console.error("emit failed: " + code + ": " + (e && e.message));
  process.exit(1);
}
