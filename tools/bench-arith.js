#!/usr/bin/env node
/*
 * tools/bench-arith.js — cycles per Lua integer operation on the console, measured.
 *
 *   node tools/bench-arith.js "x // 10" "x % 10" "x * 7" ...      (each expression uses x, a 16-bit value)
 *   node tools/bench-arith.js --base-only
 *
 * For each expression it writes a toy whose frame() runs the expression N times (--n N, default 32; use 256 for cheap operations) in a loop
 * (x = (x + 4099) & 65535; gy = gy + EXPR, gy a global), builds it with tools/build-toyc-banked.sh, runs it in
 * Geargrafx for 150 video frames and reads the runtime's timer cells ($2100: sum and count of the
 * frame() time in 1,024-cycle ticks).  The baseline toy (gy = gy + x) is subtracted, so the number
 * printed is the cycles one operation costs above an add.  Resolution is about 1,024/N cycles
 * (a tick is 1,024 cycles over N iterations); read differences smaller than that as noise.
 * Scratch goes to $TMPDIR (External II).
 */
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const tmp = process.env.TMPDIR || os.tmpdir();
let N = 32;
const argv = process.argv.slice(2);
const ni = argv.indexOf("--n"); if (ni >= 0) { N = +argv[ni + 1]; argv.splice(ni, 2); }
const args = argv.filter((a) => a !== "--base-only");
const exprs = ["x"].concat(args);
const PY = `
import sys, json
sys.path.insert(0, "tools")
from ggmcp import GG
g = GG(sys.argv[1]); g.tool("debug_step_frame", {"frames": 150, "mode": "sync"})
m = g.ram(0x2100, 16)
s = m[0] | (m[1] << 8) | (m[2] << 16) | (m[3] << 24); c = m[4] | (m[5] << 8)
print(json.dumps({"sum": s, "count": c, "max": m[6]}))
g.close()
`;
let base = null;
exprs.forEach(function (e, i) {
  const name = "bench-arith-" + i;
  const dir = fs.mkdtempSync(path.join(tmp, "bench-"));
  /* the result goes into a global (a volatile 32-bit cell), so no high byte can be optimised away */
  const lua = "gy = 0\nfunction frame(t, f)\n  local x = f\n  for k = 1, " + N + " do\n    x = (x + 4099) & 65535\n    gy = gy + (" + e + ")\n  end\nend\n";
  fs.writeFileSync(path.join(dir, "main.lua"), lua);
  const b = spawnSync("sh", [path.join(ROOT, "tools/build-toyc-banked.sh"), path.join(dir, "main.lua"), name],
    { cwd: ROOT, encoding: "utf8", env: Object.assign({}, process.env, { TMPDIR: tmp }) });
  const rom = path.join(ROOT, "tools/gen", name + ".pce");
  if (b.status !== 0 || !fs.existsSync(rom)) { console.log(e.padEnd(28), "BUILD FAILED", (b.stderr || "").trim().split("\n").slice(-1)[0]); return; }
  const r = spawnSync("python3", ["-I", "-c", PY, rom], { cwd: ROOT, encoding: "utf8" });
  let v; try { v = JSON.parse(r.stdout.trim().split("\n").pop()); } catch (er) { console.log(e.padEnd(28), "RUN FAILED"); return; }
  const cyc = v.sum / Math.max(v.count, 1) * 1024 / N;
  if (i === 0) base = cyc;
  console.log(e.padEnd(28), i === 0 ? "baseline " + cyc.toFixed(0) + " cycles/iteration" : "+" + (cyc - base).toFixed(0) + " cycles", "(max tick " + v.max + ")");
});
