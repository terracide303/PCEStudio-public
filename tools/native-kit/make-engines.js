#!/usr/bin/env node
/*
 * tools/native-kit/make-engines.js — the prebuilt HuTrack engine images the
 * native build kit ships (docs/NATIVE-KIT.md).
 *
 *   node tools/native-kit/make-engines.js
 *
 * The engine's RAM (.bss) sits just above the compiled program's __heap_start,
 * and its code carries those addresses, so a kit without an assembler needs an
 * image per possible base.  This builds one per base in BASES with
 * tools/ilvm/build-engine.sh (PCEAS 4.x, the maintainer's machine only) and
 * writes tools/native-kit/engines/<base>/{hutrack-code.bin, hutrack-tables.bin,
 * hutrack-symbols.h} plus engines/index.json.  The kit's build script picks the
 * smallest base at or above the program's heap; tools/build-toyc-banked.sh does
 * the same when ENGINE_BASES lists these bases, so the two routes build the
 * same ROM.  The zero page is $2080 in every image.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const ROOT = path.resolve(__dirname, "..", "..");
const BASES = [0x2400, 0x2800, 0x2C00, 0x3000, 0x3400, 0x3800];
const out = path.join(__dirname, "engines");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || require("os").tmpdir(), "kit-engines-"));
const index = { zeroPage: "0x2080", stackFloor: "0x3E00", bases: [] };
for (const base of BASES) {
  const hex = "0x" + base.toString(16).toUpperCase();
  const dir = path.join(scratch, hex);
  fs.mkdirSync(dir);
  const r = cp.spawnSync("bash", [path.join(ROOT, "tools", "ilvm", "build-engine.sh")], {
    cwd: ROOT, encoding: "utf8",
    env: Object.assign({}, process.env, { ENGINE_ZP_BASE: "0x2080", ENGINE_BSS_BASE: hex, OUT: dir, STAGE: path.join(dir, "stage") })
  });
  if (r.status !== 0) { console.error(r.stdout + r.stderr); process.exit(1); }
  const info = JSON.parse(fs.readFileSync(path.join(dir, "hutrack-image.json"), "utf8"));
  const dest = path.join(out, hex);
  fs.mkdirSync(dest);
  for (const f of ["hutrack-code.bin", "hutrack-tables.bin", "hutrack-symbols.h"]) fs.copyFileSync(path.join(dir, f), path.join(dest, f));
  index.bases.push({ base: hex, bssEnd: "0x" + info.ram.bss.end.toString(16).toUpperCase(), zeroPageEnd: "0x" + info.ram.zero_page.end.toString(16).toUpperCase() });
  console.log(hex + ": bss ends at " + index.bases[index.bases.length - 1].bssEnd);
}
fs.writeFileSync(path.join(out, "index.json"), JSON.stringify(index, null, 1) + "\n");
fs.rmSync(scratch, { recursive: true, force: true });
