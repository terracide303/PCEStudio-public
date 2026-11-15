#!/usr/bin/env node
/*
 * tests/check-native-art.js — a native ROM's art is the importer's picture, word for word.
 *
 *   node tests/check-native-art.js
 *
 * tests/native-art is a game that draws nothing itself: only STARFALL's three art files
 * (tiles, palettes, sprites) and an empty frame().  It is compiled with
 * tools/build-toyc-banked.sh (so the art travels as tools/native-assets.js data in a ROM
 * bank and tools/toyc/toy_assets.c replays it at boot), run in Geargrafx for 60 frames
 * (VRAM is cleared first, which takes about ten), and the console's VRAM (32,768 words)
 * and colour table (512) are compared with what renderer/pce-toyhost.js's importer
 * produces.  Zero words may differ.  Needs llvm-mos and Geargrafx; prints SKIP without.
 * (Found by this test: the blob was dropped by the linker as unreferenced, and the run
 * table was a zero-page copy that was all zeros at run time.)
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const toyhost = require("../renderer/pce-toyhost.js");
let checks = 0;
const failures = [];
function check(ok, name) { checks++; if (!ok) { failures.push(name); console.log("FAIL  " + name); } }

const gg = process.env.GEARGRAFX || "/Volumes/External II/pce-tools/geargrafx/app/Geargrafx.app/Contents/MacOS/geargrafx";
const llvm = (process.env.LLVM_MOS || "/Volumes/External II/pce-tools/llvm-mos/llvm-mos") + "/bin/mos-pce-clang";
if (!fs.existsSync(gg) || !fs.existsSync(llvm)) { console.log("SKIP: Geargrafx or llvm-mos not found"); process.exit(0); }

const dir = path.join(ROOT, "tests", "native-art");
const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "native-art-"));
const b = spawnSync("bash", [path.join(ROOT, "tools", "build-toyc-banked.sh"), path.join("tests", "native-art", "main.lua"), "native-art"],
  { cwd: ROOT, encoding: "utf8", env: Object.assign({}, process.env, { TMPDIR: scratch }) });
check(b.status === 0, "the art-only game links (" + (b.stderr || b.stdout).trim().split("\n").slice(-1)[0].slice(0, 100) + ")");
if (b.status === 0) {
  const out = path.join(scratch, "vram.bin");
  const r = spawnSync("python3", ["-I", path.join(ROOT, "tools", "ggmcp.py"), path.join(ROOT, "tools", "gen", "native-art.pce"), "vramdump", out, "60"],
    { cwd: ROOT, encoding: "utf8", timeout: 300000 });
  check(r.status === 0, "Geargrafx ran the ROM and dumped VRAM and colours");
  if (r.status === 0) {
    const files = toyhost.importer.FILES.filter((n) => fs.existsSync(path.join(dir, n))).map((n) => ({ name: n, source: fs.readFileSync(path.join(dir, n), "utf8") }));
    const w = toyhost.importer.read(files);
    const raw = fs.readFileSync(out);
    const W = (buf, off, len) => new Uint16Array(buf.buffer.slice(buf.byteOffset + off, buf.byteOffset + off + len));
    const gotV = W(raw, 0, 65536), gotC = W(raw, 65536, 1024);
    const wantV = new Uint16Array(w.vram.buffer.slice(w.vram.byteOffset, w.vram.byteOffset + w.vram.length));
    const wantC = new Uint16Array(w.cram.buffer.slice(w.cram.byteOffset, w.cram.byteOffset + w.cram.length));
    let dv = 0, dc = 0, nonzero = 0;
    for (let i = 0; i < wantV.length; i++) { if (wantV[i]) nonzero++; if (wantV[i] !== gotV[i]) dv++; }
    for (let i = 0; i < wantC.length; i++) if (wantC[i] !== gotC[i]) dc++;
    check(nonzero > 1000, "the picture has real data to compare (" + nonzero + " non-zero VRAM words)");
    check(dv === 0, "every one of the 32,768 VRAM words equals the importer's (" + dv + " differ)");
    check(dc === 0, "all 512 colours equal the importer's (" + dc + " differ)");
  }
}
if (failures.length) { console.log("FAIL  " + failures.length + " of " + checks + " checks failed"); process.exit(1); }
console.log("PASS  " + checks + " checks, the native ROM's art equals the importer's picture word for word");
