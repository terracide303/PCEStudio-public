#!/usr/bin/env node
/*
 * tests/check-bank-affinity.js — the bank packer puts functions that call each other into the same bank.
 *
 * A direct call (IL_DIRECT in pce-cgen.js's C) is a plain call only when caller and callee share a bank
 * (or the callee is in the fixed page); across banks it falls back to il_call, hundreds of cycles
 * dearer.  tools/bank-toyc.py now packs by call affinity: pce-cgen.js marks each direct call site
 * `/* AFF caller callee weight *\/` and the packer clusters along the heaviest edges.
 *
 * This builds TOWER (the one gallery game with many calls and several banks) with the build script, then
 * runs the packer by hand on the same C and object three times: affinity on, affinity on again (the
 * result must be byte-identical), and off (BANK_AFFINITY=0, the old size-only packing).  It checks that
 * the build makes a ROM, that the call sites carry weights, that the share of call weight that is
 * same-bank is high with affinity and higher than without, and that packing is deterministic.
 * Needs llvm-mos; SKIP without.
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
const llvm = process.env.LLVM_MOS || "/Volumes/External II/pce-tools/llvm-mos/llvm-mos";
if (!fs.existsSync(llvm + "/bin/mos-pce-clang")) { console.log("SKIP: llvm-mos not found"); process.exit(0); }
const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "bank-affinity-"));

const name = "affinity-test-" + process.pid;
const b = spawnSync("bash", [path.join(ROOT, "tools", "build-toyc-banked.sh"), "toys/tower/main.lua", name],
  { cwd: ROOT, encoding: "utf8", env: Object.assign({}, process.env, { TMPDIR: scratch }) });
check(b.status === 0, "TOWER builds with affinity packing (" + (b.status === 0 ? "ok" : (b.stderr || "").trim().split("\n").slice(-1)[0]) + ")");
const G = path.join(ROOT, "tools", "gen", name);
if (b.status !== 0 || !fs.existsSync(G + ".c")) { console.log("FAIL  cannot continue"); process.exit(1); }
check(fs.existsSync(G + ".pce") && fs.statSync(G + ".pce").size >= 32768, "a ROM comes out");
const c = fs.readFileSync(G + ".c", "utf8");
const sites = (c.match(/\/\* AFF il_fn_\S+ il_fn_\S+ \d+ \*\//g) || []).length;
check(sites > 20, "the direct call sites carry affinity weights (" + sites + ")");

function pack(affinity, out) {
  const r = spawnSync("python3", ["-I", path.join(ROOT, "tools", "bank-toyc.py"), G + ".c", G + ".o", out, llvm],
    { cwd: ROOT, encoding: "utf8", env: Object.assign({}, process.env, { BANK_AFFINITY: affinity, BANK_IDS: process.env.BANK_IDS || "" }) });
  const m = /call affinity \((on|off)\): (\d+) of (\d+) edge weight is same-bank \((\d+)%\)/.exec(r.stderr || "");
  return { status: r.status, pct: m ? +m[4] : -1, out: out };
}
const on1 = pack("1", path.join(scratch, "on1.c"));
const on2 = pack("1", path.join(scratch, "on2.c"));
const off = pack("0", path.join(scratch, "off.c"));
check(on1.status === 0 && off.status === 0, "the packer runs in both modes (exit " + on1.status + "/" + off.status + ")");
check(on1.pct >= 90, "with affinity at least 90% of the call weight is same-bank (" + on1.pct + "%)");
check(on1.pct > off.pct, "that is more than size-only packing gives (" + off.pct + "%)");
check(fs.readFileSync(on1.out, "utf8") === fs.readFileSync(on2.out, "utf8"), "packing is deterministic: two runs give the same C");
for (const ext of [".pce", ".c", ".o", ".banked.c"]) { try { fs.unlinkSync(G + ext); } catch (e) { /* none */ } }
console.log(failures.length ? "FAIL  " + failures.length + " of " + checks + " checks failed" : "PASS  " + checks + " checks, the packer puts callers and callees in the same bank");
process.exit(failures.length ? 1 : 0);
