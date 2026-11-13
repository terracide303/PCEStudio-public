#!/usr/bin/env node
/*
 * tests/check-native-raster-sprites.js — a raster build keeps the sprite layer on.
 *
 * The raster main loop used to write CR = $008C, which has no SB bit (bit 6, sprites), so every
 * sprite of a raster game was switched off while the sprite list in VRAM was exact (found
 * 2026-11-13 by looking at NOVA TIDE's picture: no ship, no enemies; its "65 differing rows"
 * were all sprites).  Now the raster loop keeps the CR the toy asked for.
 *
 * This builds NOVA TIDE (the table form of raster) and tests/native-dusk-fast (the callback
 * form), runs each in Geargrafx for 300 video frames and reads the VDC's CR: bit 6 (sprites)
 * and bit 7 (background) must be set, and the sprite list must hold sprites.
 * Needs llvm-mos and Geargrafx; SKIP without.
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
let checks = 0;
const failures = [];
function check(ok, name) { checks++; if (!ok) { failures.push(name); console.log("FAIL  " + name); } else console.log("  ok  " + name); }
const gg = process.env.GEARGRAFX || "/Volumes/External II/pce-tools/geargrafx/app/Geargrafx.app/Contents/MacOS/geargrafx";
const llvm = (process.env.LLVM_MOS || "/Volumes/External II/pce-tools/llvm-mos/llvm-mos") + "/bin/mos-pce-clang";
if (!fs.existsSync(gg) || !fs.existsSync(llvm)) { console.log("SKIP: Geargrafx or llvm-mos not found"); process.exit(0); }
const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "native-rsprites-"));

const PY = `
import sys, json
sys.path.insert(0, "tools")
from ggmcp import GG
g = GG(sys.argv[1])
g.tool("debug_step_frame", {"frames": 300, "mode": "sync"})
regs = {str(r[0]): int(r[1], 16) for r in json.loads(g.tool("get_huc6270_registers", {}))["registers"] if isinstance(r[0], int)}
areas = {a["name"]: a for a in json.loads(g.tool("list_memory_areas"))["areas"]}
t = json.loads(g.tool("read_memory", {"area": areas["VRAM"]["id"], "offset": "7F00", "size": 512}))
b = bytes.fromhex(t["data"].replace(" ", ""))
sat = [b[i] | (b[i + 1] << 8) for i in range(0, 512, 2)]
print(json.dumps({"cr": regs["5"], "sprites": sum(1 for i in range(0, 256, 4) if sat[i] or sat[i + 1] or sat[i + 2])}))
g.close()
`;

[["NOVA TIDE, table form", "toys/nova-tide/main.lua", "rs-nova", "-Oz", true],
 ["the DUSK RUN copy, callback form", "tests/native-dusk-fast/main.lua", "rs-dusk", "-Os", false]].forEach(function (g) {
  const b = spawnSync("bash", [path.join(ROOT, "tools", "build-toyc-banked.sh"), g[1], g[2]],
    { cwd: ROOT, encoding: "utf8", env: Object.assign({}, process.env, { TMPDIR: scratch, OPT: g[3] }) });
  check(b.status === 0, g[0] + ": builds (" + (b.status === 0 ? "ok" : (b.stderr || "").trim().split("\n").slice(-1)[0]) + ")");
  if (b.status !== 0) return;
  const r = spawnSync("python3", ["-I", "-c", PY, path.join(ROOT, "tools", "gen", g[2] + ".pce")], { cwd: ROOT, encoding: "utf8" });
  let v = null;
  try { v = JSON.parse(r.stdout.trim().split("\n").pop()); } catch (e) { /* reported below */ }
  check(!!v, g[0] + ": the emulator reports the VDC (" + (r.stderr || "").trim().split("\n").slice(-1)[0] + ")");
  if (!v) return;
  check((v.cr & 0x40) !== 0, g[0] + ": CR bit 6 (sprites) is set, CR = $" + v.cr.toString(16).toUpperCase());
  check((v.cr & 0x80) !== 0, g[0] + ": CR bit 7 (background) is set");
  if (g[4]) check(v.sprites > 0, g[0] + ": the sprite list holds sprites (" + v.sprites + ")");
});
console.log(failures.length ? "FAIL  " + failures.length + " of " + checks + " checks failed" : "PASS  " + checks + " checks, a raster build keeps the sprite layer on");
process.exit(failures.length ? 1 : 0);
