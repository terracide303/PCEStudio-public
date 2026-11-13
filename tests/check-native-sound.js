#!/usr/bin/env node
/*
 * tests/check-native-sound.js — the natively compiled ROM's sound is the
 * studio's (docs/NATIVE-SOUND.md, option C).
 *
 *   node tests/check-native-sound.js
 *
 * tools/toys/sfx.lua and note.lua are compiled to banked native ROMs with the
 * HuTrack engine and the engine's PSG write log (PSG_TRACE=1, never a shipped
 * ROM), run in Mednafen (windowless, a private home), and the log in the
 * autosaved BaseRAM is compared with the studio runtime's own sound events
 * (renderer/pce-il.js, rt.sound.events) for toy frames 0..23: same order, same
 * registers, same values — the proof tests/check-rom-sound.js gives the
 * interpreter ROM.  Needs llvm-mos, PCEAS 4.x and Mednafen; prints SKIP lines
 * without them.
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const il = require("../renderer/pce-il.js");

const ROOT = path.join(__dirname, "..");
const FRAMES = 24, FILL = 0xEE;
let checks = 0;
const failures = [], skipped = [];
function check(ok, name) { checks++; if (!ok) { failures.push(name); console.log("FAIL  " + name); } }
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  check(ok, name + (ok ? "" : ": got " + JSON.stringify(got).slice(0, 200) + " want " + JSON.stringify(want).slice(0, 200)));
}
function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
const have = (c) => spawnSync("bash", ["-c", "command -v " + c]).status === 0;

function run(toy, label, scratch) {
  const name = "native-sound-" + label;
  const b = spawnSync("bash", [path.join(ROOT, "tools", "build-toyc-banked.sh"), toy, name],
    { cwd: ROOT, encoding: "utf8", env: Object.assign({}, process.env, { PSG_TRACE: "1", TMPDIR: scratch }) });
  check(b.status === 0, label + ": the trace build links (" + (b.stderr || b.stdout).trim().split("\n").slice(-1)[0] + ")");
  if (b.status !== 0) return;
  const rom = path.join(ROOT, "tools", "gen", name + ".pce");
  const trace = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "gen", name + ".eng", "hutrack-image.json"), "utf8")).psg_trace;
  check(!!trace, label + ": the engine build reports its log addresses");
  if (!trace) return;

  const home = path.join(scratch, label + "-home");
  fs.mkdirSync(path.join(home, "mcs"), { recursive: true });
  const child = spawn("mednafen", ["-force_module", "pce", "-autosave", "1", "-sound", "0", rom],
    { env: Object.assign({}, process.env, { MEDNAFEN_HOME: home, SDL_VIDEODRIVER: "dummy", SDL_AUDIODRIVER: "dummy" }), stdio: "ignore" });
  sleep(7000);
  child.kill("SIGINT");
  for (let i = 0; i < 40 && child.exitCode === null; i++) sleep(500);
  if (child.exitCode === null) child.kill("SIGKILL");
  sleep(500);
  const states = fs.readdirSync(path.join(home, "mcs")).filter((f) => f.endsWith(".mca"));
  check(states.length > 0, label + ": Mednafen autosaved a state");
  if (!states.length) return;
  const dump = path.join(scratch, label + "-dump");
  const ex = spawnSync("python3", ["-I", path.join(ROOT, "tools", "mcs-extract.py"),
    path.join(home, "mcs", states[0]), dump, "--ram"], { encoding: "utf8" });
  check(ex.status === 0, label + ": mcs-extract reads BaseRAM");
  if (ex.status !== 0) return;
  const ram = fs.readFileSync(path.join(dump, "ram.bin"));
  const at = (a) => a - 0x2000;
  eq(label + ": the log's reset ran (ok byte $A5)", ram[at(trace.psg_trace_ok)], 0xA5);
  const count = ram[at(trace.psg_trace_count)];
  const f = ram.slice(at(trace.psg_trace_f), at(trace.psg_trace_f) + trace.capacity);
  const r = ram.slice(at(trace.psg_trace_r), at(trace.psg_trace_r) + trace.capacity);
  const v = ram.slice(at(trace.psg_trace_v), at(trace.psg_trace_v) + trace.capacity);
  const got = [];
  for (let i = 0; i < count; i++) got.push([f[i], r[i], v[i]]);
  let tail = true;
  for (let i = count; i < trace.capacity; i++) if (f[i] !== FILL || r[i] !== FILL || v[i] !== FILL) tail = false;
  const source = fs.readFileSync(path.join(ROOT, toy), "utf8");
  const rt = il.create(source, { chunkName: path.basename(toy) });
  rt.load();
  for (let k = 0; k < FRAMES; k++) rt.frame(k);
  const want = rt.sound.events.filter((e) => e.f < FRAMES).map((e) => [e.f, e.reg, e.value]);
  check(got.length > 0, label + ": the log recorded PSG writes (" + got.length + ")");
  eq(label + ": the native ROM wrote exactly the studio's stream over " + FRAMES +
     " frames (" + want.length + " writes, frame for frame)", got, want);
  check(tail, label + ": the log's unfilled tail is still $EE");
}

if (!have("mednafen") || !fs.existsSync("/Volumes/External II/pce-tools/llvm-mos/llvm-mos/bin/mos-pce-clang") && !process.env.LLVM_MOS) {
  skipped.push("mednafen or llvm-mos not found");
} else {
  const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "native-sound-"));
  run("tools/toys/sfx.lua", "sfx", scratch);
  run("tools/toys/note.lua", "note", scratch);
}
skipped.forEach((s) => console.log("SKIP: " + s));
if (failures.length) { console.log("FAIL  " + failures.length + " of " + checks + " checks failed"); process.exit(1); }
console.log("PASS  " + checks + " checks, the native ROM's PSG writes equal the studio's" + (skipped.length ? " (SKIPPED: " + skipped.join("; ") + ")" : ""));
