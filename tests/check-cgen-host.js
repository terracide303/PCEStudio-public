#!/usr/bin/env node
/*
 * tests/check-cgen-host.js — the C that pce-cgen.js emits computes what the
 * browser computes.  For each gallery game that compiles to C (STARFALL, TOWER,
 * DUSK RUN, PLATFORMER) tools/host-c-compare.js runs 120 toy frames of the
 * generated C on this machine against a stub runtime and compares the sprite
 * list after every frame with renderer/pce-toys.js.  No emulator and no llvm-mos:
 * it separates the compiler's logic from the console runtime (docs/NATIVE.md).
 * NOVA TIDE is not in the list: its raster(line, spec) is not lowered yet.
 * SKIP without a C compiler.
 */
"use strict";
const path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
let checks = 0;
const failures = [];
function check(ok, name) { checks++; if (!ok) { failures.push(name); console.log("FAIL  " + name); } }

if (spawnSync("bash", ["-c", "command -v cc"]).status !== 0) {
  console.log("SKIP: no C compiler (cc)");
  process.exit(0);
}
const games = ["platformer", "tower", "dusk-run", "demo-game"];
for (const g of games) {
  const r = spawnSync("node", [path.join(ROOT, "tools", "host-c-compare.js"), path.join("toys", g, "main.lua"), "120"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 });
  const line = (r.stdout || r.stderr || "").trim().split("\n")[0];
  check(r.status === 0 && /120 of 120 frames equal/.test(line), g + ": the generated C's sprite list equals the browser's for 120 frames (" + line.slice(0, 120) + ")");
}
if (failures.length) { console.log("FAIL  " + failures.length + " of " + checks + " checks failed"); process.exit(1); }
console.log("PASS  " + checks + " checks, the generated C computes the browser's sprite list for the four games that compile");
