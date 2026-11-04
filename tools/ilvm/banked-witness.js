#!/usr/bin/env node
/*
 * tools/ilvm/banked-witness.js — generate the 2-code-bank witness toy for
 * card #280's Mednafen proof (docs/BANKED-DATA.md §5.7).
 *
 *   node tools/ilvm/banked-witness.js OUT.lua [ADDS]
 *
 * The toy's chunk, init() and frame() live in code bank 1; a big straight-
 * line function lives in code bank 2 and init() calls it, so boot and the
 * call exercise both a bank map and the caller's bank restore.  It writes a
 * static BAT/tile/palette picture and no jumps, because container v4's jump
 * targets are still function-relative (#286).  The generator is here so the
 * evidence can be rebuilt:
 *
 *   node tools/ilvm/banked-witness.js $TMPDIR/witness.lua
 *   node tools/ilvm/emit.js $TMPDIR/witness.lua $TMPDIR/witness.pce
 *
 * With the committed interpreter (renderer/ilvm.bin, sha f661ab16…) this is
 * version 4, 24,576 B (tables + 2 code banks), a 57,344 B ROM with sha
 * 16bf4249d2732bdd…, and its static picture matches the browser frame for
 * frame (the capture method is tools/capture-ilvm.sh's).  `seed` is a
 * captured local, so init's closure reads an upvalue descriptor from the
 * tables bank — a PROG read there would change CRAM.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const out = process.argv[2];
const adds = Number(process.argv[3] || 1580);
if (!out) {
  console.error("usage: node tools/ilvm/banked-witness.js OUT.lua [ADDS]");
  process.exit(2);
}

const lines = [];
/* A captured local: creating init's and frame's closures reads their upvalue
 * descriptors from the tables bank while MPR2 holds the chunk's code bank,
 * and init reads the cell (palette 2) — a PROG read instead of TABLES would
 * put code bytes in the kind/index and change CRAM. */
lines.push("local seed = 0x0A5");
/* A visible picture: one tile, three BAT rows, three palettes. */
lines.push("function init()");
for (let i = 0; i < 16; i++) lines.push("  vram[" + (0x40 * 16 + i) + "] = 0xFFFF");
for (let i = 0; i < 32; i++) lines.push("  vram[" + i + "] = 0x0040");
for (let i = 0; i < 32; i++) lines.push("  vram[" + (32 + i) + "] = 0x1040");
for (let i = 0; i < 32; i++) lines.push("  vram[" + (64 + i) + "] = 0x2040");
lines.push("  pal(0, 0x1FF)");
lines.push("  pal(1, 0x0E3)");
lines.push("  pal(16, 0x03F)");
lines.push("  pal(17, 0x1C0)");
lines.push("  pal(2, seed)");
lines.push("  big()");
/* Writes after the cross-bank call: if MPR2 is not restored to init's bank
 * the next instruction fetch reads big()'s bank at init's pc. */
lines.push("  vram[1001] = 0x1234");
lines.push("  vram[1002] = 0x2345");
lines.push("end");
lines.push("function frame(t, f)");
lines.push("  vram[2000] = 0");
lines.push("end");
lines.push("function big()");
lines.push("  local x = 0");
for (let i = 0; i < adds; i++) lines.push("  x = x + 1");
lines.push("  vram[1000] = x");
lines.push("  return x");
lines.push("end");
fs.writeFileSync(out, lines.join("\n") + "\n");

const il = require(path.join(__dirname, "..", "..", "renderer", "pce-il.js"));
const ilbc = require(path.join(__dirname, "..", "..", "renderer", "pce-ilbc.js"));
const enc = ilbc.encode(il.compile(fs.readFileSync(out, "utf8"),
                                   { chunkName: path.basename(out) }));
console.log("wrote " + out + ": version " + enc.version + ", container " +
            enc.bytes.length + " B, code " + enc.codeBytes + " B, " +
            enc.codeBanks + " code bank(s)");
if (enc.version !== 4 || enc.codeBanks !== 2) {
  console.error("expected a version 4 container with 2 code banks; bump ADDS");
  process.exit(1);
}
