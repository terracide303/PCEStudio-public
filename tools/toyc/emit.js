#!/usr/bin/env node
/*
 * tools/toyc/emit.js — Lua toy in, generated C out (#31 part A).
 *
 *   node tools/toyc/emit.js toy.lua out.c
 *
 * Compiles the toy with renderer/pce-il.js (Fengari's parser, the same front
 * end the browser runs), then emits C with renderer/pce-cgen.js.  Any refusal
 * from either stage is printed with its code and exits 1; the build script
 * turns that into a failed build rather than a wrong ROM.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const il = require("../../renderer/pce-il.js");
const cgen = require("../../renderer/pce-cgen.js");

const srcPath = process.argv[2];
const outPath = process.argv[3];
if (!srcPath || !outPath) {
  console.error("usage: node tools/toyc/emit.js TOY.lua OUT.c");
  process.exit(2);
}

const source = fs.readFileSync(srcPath, "utf8");
try {
  const program = il.compile(source, { chunkName: path.basename(srcPath) });
  fs.writeFileSync(outPath, cgen.emitC(program));
} catch (e) {
  const code = e && (e.code || e.name) || "error";
  console.error("emit failed: " + code + ": " + (e && e.message));
  process.exit(1);
}
