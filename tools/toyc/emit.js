#!/usr/bin/env node
/*
 * tools/toyc/emit.js — Lua toy in, generated C out (#31 part A).
 *
 *   node tools/toyc/emit.js toy.lua out.c [llvm|huc]
 *
 * The third argument picks the C dialect: `llvm` (default, parts A/C) or
 * `huc` (part B, the HuC compiler's 16-bit C).
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
const target = process.argv[4] || "llvm";
if (!srcPath || !outPath) {
  console.error("usage: node tools/toyc/emit.js TOY.lua OUT.c [llvm|huc]");
  process.exit(2);
}
if (target !== "llvm" && target !== "huc") {
  console.error("emit failed: unknown C dialect `" + target + "`");
  process.exit(2);
}

const source = fs.readFileSync(srcPath, "utf8");
try {
  const program = il.compile(source, { chunkName: path.basename(srcPath) });
  /* the songs music(index) plays: the toy folder's song.json and songs.json,
   * as the studio hands them to the runtime (pce-seq.js songsFromFiles) */
  const songFiles = [];
  for (const nm of ["song.json", "songs.json"]) {
    const sp = path.join(path.dirname(srcPath), nm);
    if (fs.existsSync(sp)) songFiles.push({ name: nm, source: fs.readFileSync(sp, "utf8") });
  }
  /* the toy folder's art files: the native ROM replays the importer's picture at boot */
  const artFiles = require("../../renderer/pce-toyhost.js").importer.FILES
    .filter((nm) => fs.existsSync(path.join(path.dirname(srcPath), nm)))
    .map((nm) => ({ name: nm, source: fs.readFileSync(path.join(path.dirname(srcPath), nm), "utf8") }));
  const hasArt = artFiles.length > 0 && !!require("../../renderer/pce-toyhost.js").importer.read(artFiles);
  const songs = songFiles.length ? require("../../renderer/pce-seq.js").songsFromFiles(songFiles) : [];
  const report = validate.validateProgram(program, {
    chunkName: path.basename(srcPath),
    songs: songs
  });
  if (!report.ok) {
    const first = report.problems.filter((p) => p.severity === "error")[0];
    console.error("validate failed: " + (first ? first.code : "validate") +
                  ": " + (first ? first.message : "the toy failed"));
    process.exit(1);
  }
  fs.writeFileSync(outPath, cgen.emitC(program, { target: target, assets: hasArt,
    splitOver: +process.env.PCE_SPLIT_OVER || undefined,
    splitChunk: +process.env.PCE_SPLIT_CHUNK || undefined,
    splitOnly: process.env.PCE_SPLIT_ONLY ? process.env.PCE_SPLIT_ONLY.split(",").map(Number) : undefined }));
} catch (e) {
  const code = e && (e.code || e.name) || "error";
  console.error("emit failed: " + code + ": " + (e && e.message));
  process.exit(1);
}
