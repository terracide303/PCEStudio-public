#!/usr/bin/env node
/*
 * tests/check-native-vblank.js — a native ROM's scroll write never lands in the visible picture.
 *
 * A game without a raster() callback runs frame() right after the VBlank starts.  A slow frame
 * (the music tick) used to push frame()'s scroll write past the blanking period, into the first
 * visible lines, and the picture jumped about once a second (reported on real hardware and in a
 * web emulator for PCEHero's intro, 2026-11-13).  tools/toyc/toy_runtime.c now holds the scroll,
 * control and colour writes and applies them at the start of the next VBlank (TOY_HOLD_BUILD).
 *
 * This builds tests/native-vblank (music plus a BYR write every frame) twice, with the hold
 * (the default) and without it (NO_HOLD=1, the control), runs each in Geargrafx for 400 frames
 * with Geargrafx's VDC trace, and measures how many scanlines after the VBlank interrupt each BYR
 * write lands.  The VBlank lasts 22 lines.  With the hold every write must be inside it; the
 * control must have at least one outside it, or the test measures nothing.
 * Needs llvm-mos, PCEAS 4.x and Geargrafx; SKIP without.
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
let checks = 0;
const failures = [];
function check(ok, name) { checks++; if (!ok) { failures.push(name); console.log("FAIL  " + name); } }
const gg = process.env.GEARGRAFX || "/Volumes/External II/pce-tools/geargrafx/app/Geargrafx.app/Contents/MacOS/geargrafx";
const llvm = (process.env.LLVM_MOS || "/Volumes/External II/pce-tools/llvm-mos/llvm-mos") + "/bin/mos-pce-clang";
if (!fs.existsSync(gg) || !fs.existsSync(llvm)) { console.log("SKIP: Geargrafx or llvm-mos not found"); process.exit(0); }
const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "native-vblank-"));

function late(noHold) {
  const name = noHold ? "native-vblank-control" : "native-vblank";
  const b = spawnSync("bash", [path.join(ROOT, "tools", "build-toyc-banked.sh"), path.join("tests", "native-vblank", "main.lua"), name],
    { cwd: ROOT, encoding: "utf8", env: Object.assign({}, process.env, { TMPDIR: scratch }, noHold ? { NO_HOLD: "1" } : {}) });
  if (b.status !== 0) return { err: (b.stderr || b.stdout).trim().split("\n").slice(-1)[0] };
  const py = `
import sys, json, re
sys.path.insert(0, "tools")
from ggmcp import GG
g = GG(sys.argv[1])
g.tool("debug_step_frame", {"frames": 60, "mode": "sync"})
g.tool("set_trace_log", {"enabled": True, "filters": ["vdc.registers", "vdc.irqs"], "memory_size": "2M"})
base = json.loads(g.tool("get_trace_log", {"count": 1, "start": -1}))["total_logged"]
g.tool("debug_step_frame", {"frames": 400, "mode": "sync"})
tot = json.loads(g.tool("get_trace_log", {"count": 1, "start": -1}))["total_logged"]
lines = []; start = base
while start < tot:
    r = json.loads(g.tool("get_trace_log", {"count": 1000, "start": start}))
    if not r["lines"]: break
    lines += r["lines"]; start = r["next_sequence"]
g.close()
vb = None; pos = []
for l in lines:
    m = re.match(r"@(\\d+)", l)
    if not m: continue
    c = int(m.group(1))
    if "VBLANK" in l and "IRQ" in l: vb = c; continue
    if vb is not None and "BYR($08) LSB" in l: pos.append((c - vb) / 1365.0)
print(json.dumps(pos))
`;
  const r = spawnSync("python3", ["-I", "-c", py, path.join(ROOT, "tools", "gen", name + ".pce")],
    { cwd: ROOT, encoding: "utf8", timeout: 300000, maxBuffer: 1 << 26 });
  if (r.status !== 0) return { err: (r.stderr || "").slice(-200) };
  const pos = JSON.parse(r.stdout);
  return { n: pos.length, late: pos.filter((x) => x > 22).length, max: Math.max.apply(null, pos) };
}

const held = late(false), control = late(true);
check(!held.err, "the held build runs (" + (held.err || "") + ")");
check(!control.err, "the control build runs (" + (control.err || "") + ")");
if (!held.err && !control.err) {
  check(held.n >= 300, "the held build made its scroll writes in the 400 frames (" + held.n + ")");
  check(control.late > 0, "CONTROL: without the hold some scroll writes land outside the 22-line VBlank (" + control.late + " of " + control.n + ", worst " + control.max.toFixed(1) + " lines)");
  check(held.late === 0, "with the hold every scroll write lands inside the VBlank (" + held.late + " late of " + held.n + ", worst " + held.max.toFixed(1) + " lines)");
}
if (failures.length) { console.log("FAIL  " + failures.length + " of " + checks + " checks failed"); process.exit(1); }
console.log("PASS  " + checks + " checks, the scroll write stays inside the VBlank");
