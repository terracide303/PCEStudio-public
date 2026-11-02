#!/usr/bin/env node
/*
 * tests/check-rom-sound.js — cards #215, #220 and #200: the interpreter's
 * sound ops (note/sfx/release/music and the per-frame sound tick), end to
 * end, with the studio's host as the model (docs/ROM-SOUND.md §7), and
 * #200's Mednafen PSG-write trace (§8).
 *
 * NOTE: written by @design as part of #215/#220/#200 because the cards'
 * close conditions need a check; per the workshop role split it is flagged for
 * @review to read cold (rule 2).
 *
 * What it proves, and how:
 *
 *   0. The interpreter carries the four sound ops and runs them.  The
 *      system cc builds tools/ilvm/ilvm.c + hostvm.c into a host harness
 *      (the console's ILVM_HOST half of ilvm_sound.c; SKIP without cc), the
 *      same source both builds share.  A note()/sfx() toy and an
 *      sfx()/release() toy encode as version 3 containers, run on the
 *      harness, and their psg.txt write streams are non-empty and equal,
 *      frame for frame and write for write, to the studio host's
 *      rt.sound.events for the same frames — the sfx reserve/wave-upload
 *      streams, note()'s 12-bit F, the release tail, and the tick order
 *      (a finished SFX releases before the frame body) all pinned in
 *      place, not just counted.
 *
 *   1. The console's substitutes for the browser's runtime refusals (a ROM
 *      has no error channel; docs/ROM-SOUND.md §7) clamp instead of
 *      throwing.  A substitutes toy runs out-of-range channels, frequencies,
 *      volumes, frames counts, note midis, release channels and music
 *      indexes through the harness, and the exact clamped write stream is
 *      pinned: bad channels and music writes nothing; freq keeps 12 bits,
 *      volume 5, frames 1..600; note(-1) is F 4095 and note(512)/note(700)
 *      are F 0; a 1-frame SFX gives its channel back on the next tick.  The
 *      same toy under the studio host is pinned to REFUSE (its runtime
 *      throws before the first write) — the divergence this check exists to
 *      record, not to hide.
 *
 *   2. The sound path is silent without a sound op.  A version 1 pal toy
 *      runs on the harness and its psg.txt is empty — the engine mapping,
 *      trailer read and tick are lazy (ilvm_sound.c's header), and a toy
 *      that never calls the ops must cause no PSG write at all.
 *
 * 3. the console trace (#200).  A trace build of the interpreter
 *    (TRACE=1, never renderer/ilvm.bin) appends every PSG write the console
 *    makes — the glue's own writes and, through line-pinned patches in the
 *    staged vendor copy, the two SFX reservation routines' — to three
 *    parallel BaseRAM arrays for toy frames 0..23 (docs/ROM-SOUND.md §8).
 *    tools/toys/note.lua and tools/toys/sfx.lua are exported against that
 *    image, run in Mednafen, and the autosaved state's log is compared with
 *    the studio runtime's rt.sound.events (renderer/pce-il.js, which drives
 *    renderer/pce-toyhost.js) for the same frames: same order, same
 *    registers, same values.  The arrays are filled with $EE at reset and
 *    the test checks the tail beyond the count still holds it, so a log the
 *    stack had overwritten cannot pass silently.  This needs Mednafen,
 *    llvm-mos and PCEAS 4.x (SKIP without them); it does not need the
 *    system cc.
 *
 *    The trace pinned #238 and #239: note(60)'s F arrived as 268 (the
 *    low-byte clamp) and the first SFX's reserve was missing (SndGlueMap's
 *    zero-song loop overran snd_owned).
 *
 * Honest limits of 0-2: the harness runs the HOST half of ilvm_sound.c —
 * the same logic the console's glue runs, but not the 6502.  The console
 * half's own code is the SndGlue routines pinned by
 * tests/check-hutrack-image.js (fixed addresses, extents, bss), and the
 * image they live in is pinned by check-ilvm/check-export-games' ROM shas.
 * Section 3 runs Mednafen, one machine, frames 0..23 and at most 100 writes;
 * docs/ROM-SOUND.md §8 carries its limits.
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const il = require("../renderer/pce-il.js");
const ilbc = require("../renderer/pce-ilbc.js");
const romLib = require("../renderer/pce-rom.js");

const ROOT = path.join(__dirname, "..");
const ILVM_C = path.join(ROOT, "tools", "ilvm", "ilvm.c");
const HOSTVM_C = path.join(ROOT, "tools", "ilvm", "hostvm.c");

const FRAMES = 12;
let hostvmBin = null;          /* set when the system cc is available */

let failures = 0;
const skipped = [];
function check(ok, msg) {
  if (!ok) failures++;
  console.log((ok ? "ok   " : "FAIL ") + msg);
}
function eq(msg, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log((ok ? "ok   " : "FAIL ") + msg +
              (ok ? "" : " (got " + JSON.stringify(got) + ", want " +
                         JSON.stringify(want) + ")"));
}

/* The browser's note formula (renderer/pce-toyhost.js's noteFrequency):
 * F(midi) = round(7,159,090 / (64 * 440 * 2^((midi-69)/12))) in 0..4095. */
function F(midi) {
  return Math.max(0, Math.min(4095, Math.floor(
    7159090 / (64 * 440 * Math.pow(2, (midi - 69) / 12)) + 0.5)));
}

function buildHostvm(bin) {
  /* ilvm_sound.c is the console's host half: the same op logic, recording
   * through hostvm.c's ilvm_host_psg_write. */
  const r = spawnSync("cc", [
    "-DILVM_HOST", "-O2", "-I", path.join(ROOT, "tools", "toyc"),
    "-I", path.join(ROOT, "tools", "ilvm"),
    ILVM_C, path.join(ROOT, "tools", "ilvm", "ilvm_sound.c"),
    HOSTVM_C, "-o", bin
  ], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) {
    const out = ((r.stderr || "") + (r.stdout || "")).trim().split("\n");
    console.log("      cc: " + out.slice(-3).join(" | "));
  }
  return r.status === 0;
}

/* the harness's psg.txt (one "frame reg value" line per write) -> per-frame
 * [reg, value] lists; the studio's rt.sound.events -> the same shape. */
function framesFromPsg(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const m = /^(\d+) (\d+) (\d+)$/.exec(line.trim());
    if (!m) continue;
    (out[Number(m[1])] = out[Number(m[1])] || []).push(
      [Number(m[2]), Number(m[3])]);
  }
  return out;
}
function framesFromEvents(events) {
  const out = [];
  for (const e of events)
    (out[e.f] = out[e.f] || []).push([e.reg, e.value]);
  return out;
}

/* ---- the console trace (#200) ---------------------------------------- *
 * The trace build's symbols (tools/gen/hutrack-image.json's psg_trace) and
 * a Mednafen run are the only emulator-side pieces; this file's other
 * checks stay host-only and cheap. */
const TRACE_FRAMES = 24;           /* the image's PSG_TRACE_FRAMES */
const TRACE_FILL = 0xEE;           /* PsgTraceReset's tail witness */

function haveCommand(cmd) {
  return spawnSync("bash", ["-c", "command -v " + cmd],
                   { encoding: "utf8" }).status === 0;
}
function findLlvmMos() {
  const roots = [process.env.LLVM_MOS,
                 "/Volumes/External/pce-tools/llvm-mos",
                 "/Volumes/External II/pce-tools/llvm-mos"];
  for (const r of roots)
    if (r && fs.existsSync(path.join(r, "bin", "mos-pce-clang"))) return r;
  return null;
}
function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/* Run one ROM in Mednafen and return its autosaved state (or null).  The
 * route is capture-toy.sh's: pce module, SDL video (the OpenGL driver can
 * stall at video init when the display sleeps), -autosave 1 and SIGINT for
 * a clean exit between frames — never a synthesized key event. */
function mednafenState(rom, scratch) {
  const home = path.join(scratch, "mednafen-home");
  const mcs = path.join(home, "mcs");
  fs.mkdirSync(mcs, { recursive: true });
  const started = Date.now();
  const child = spawn("mednafen", [
    "-force_module", "pce", "-video.driver", "sdl",
    "-autosave", "1", "-sound", "0", rom
  ], { env: Object.assign({}, process.env, { MEDNAFEN_HOME: home }),
       stdio: "ignore" });
  sleepMs(7000);
  child.kill("SIGINT");
  for (let i = 0; i < 40 && child.exitCode === null; i++) sleepMs(500);
  if (child.exitCode === null) child.kill("SIGKILL");
  sleepMs(1000);
  const states = fs.readdirSync(mcs).filter((f) => f.endsWith(".mca"))
    .map((f) => path.join(mcs, f))
    .filter((f) => fs.statSync(f).mtimeMs >= started - 1000);
  return states.length ? states[0] : null;
}

function readTrace(ram, trace) {   /* ram.bin -> [{f, reg, value}] + checks */
  const at = (a) => a - 0x2000;
  const ok = ram[at(trace.psg_trace_ok)];
  const count = ram[at(trace.psg_trace_count)];
  const f = ram.slice(at(trace.psg_trace_f),
                      at(trace.psg_trace_f) + trace.capacity);
  const r = ram.slice(at(trace.psg_trace_r),
                      at(trace.psg_trace_r) + trace.capacity);
  const v = ram.slice(at(trace.psg_trace_v),
                      at(trace.psg_trace_v) + trace.capacity);
  const events = [];
  for (let i = 0; i < count; i++)
    events.push({ f: f[i], reg: r[i], value: v[i] });
  let tail = true;
  for (let i = count; i < trace.capacity; i++)
    if (f[i] !== TRACE_FILL || r[i] !== TRACE_FILL || v[i] !== TRACE_FILL)
      tail = false;
  return { ok, count, events, tail };
}

/* One toy: build it against the trace image, run it, compare the log with
 * the studio's writes for the same frames, and check the log's own health. */
function checkOneTrace(toy, label, image, scratch) {
  const trace = JSON.parse(fs.readFileSync(
    path.join(ROOT, "tools", "gen", "hutrack-image.json"), "utf8")).psg_trace;
  check(!!trace, label + ": the trace build reports its log addresses");
  if (!trace) return;

  const source = fs.readFileSync(toy, "utf8");
  const encoded = ilbc.encode(il.compile(source,
    { chunkName: path.basename(toy) }));
  const romPath = path.join(scratch, label + "-trace.pce");
  fs.writeFileSync(romPath, Buffer.from(romLib.buildToyRom({
    bank0: fs.readFileSync(image), bytecode: encoded.bytes })));

  const state = mednafenState(romPath, scratch);
  check(!!state, label + ": Mednafen autosaved a state");
  if (!state) return;
  const dump = path.join(scratch, label + "-dump");
  const ex = spawnSync("python3", ["-I",
    path.join(ROOT, "tools", "mcs-extract.py"), state, dump, "--ram"],
    { encoding: "utf8" });
  check(ex.status === 0, label + ": mcs-extract reads BaseRAM");
  if (ex.status !== 0) return;

  const got = readTrace(fs.readFileSync(path.join(dump, "ram.bin")), trace);
  eq(label + ": the trace build's reset ran (ok byte is $A5)",
     got.ok, 0xA5);

  /* the studio's PSG writes for the same frames */
  const rt = il.create(source, { chunkName: path.basename(toy) });
  rt.load();
  for (let f = 0; f < TRACE_FRAMES; f++) rt.frame(f);
  const want = rt.sound.events.filter((e) => e.f < TRACE_FRAMES)
    .map((e) => [e.f, e.reg, e.value]);
  const mine = got.events.map((e) => [e.f, e.reg, e.value]);

  check(got.events.length > 0,
        label + ": the log recorded PSG writes (" + got.events.length + ")");
  eq(label + ": the console wrote exactly the studio's stream over " +
     TRACE_FRAMES + " frames (" + want.length + " writes, frame for frame)",
     mine, want);
  check(got.tail,
        label + ": the log's unfilled tail is still $" + TRACE_FILL.toString(16)
        .toUpperCase() + " (the stack did not overwrite it)");
  eq(label + ": the last recorded frame is inside the window",
     got.events.length ? got.events[got.events.length - 1].f : null,
     want.length ? want[want.length - 1][0] : null);
}

/* compile + encode + run one toy on both hosts, then compare the write
 * streams frame for frame.  Returns the harness's per-frame lists. */
function runBoth(source, label) {
  const encoded = ilbc.encode(il.compile(source,
    { chunkName: "romsound-" + label + ".lua" }));

  /* the studio host: the model */
  const rt = il.create(source, { chunkName: "romsound-" + label + ".lua" });
  rt.load();
  for (let f = 0; f < FRAMES; f++) rt.frame(f);
  const want = framesFromEvents(rt.sound.events);

  /* the interpreter (host harness): the console's half of ilvm_sound.c */
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "romsound-"));
  const container = path.join(runDir, "toy.ilbc");
  fs.writeFileSync(container, Buffer.from(encoded.bytes));
  const r = spawnSync(hostvmBin, [container, runDir, String(FRAMES)],
                      { encoding: "utf8" });
  check(r.status === 0, label + ": hostvm exits 0 (" +
        ((r.stderr || "").trim().split("\n").slice(-1)[0] || "ok") + ")");
  const got = framesFromPsg(fs.readFileSync(path.join(runDir, "psg.txt"),
                                            "utf8"));
  fs.rmSync(runDir, { recursive: true, force: true });

  const n = Math.max(want.length, got.length);
  let same = true;
  for (let f = 0; f < n; f++)
    if (JSON.stringify(want[f] || []) !== JSON.stringify(got[f] || [])) {
      same = false;
      check(false, label + ": frame " + f + "'s writes are the studio's " +
            JSON.stringify(want[f] || []) + " (harness " +
            JSON.stringify(got[f] || []) + ")");
    }
  check(same, label + ": every frame's PSG writes equal the studio's " +
        "(" + rt.sound.events.length + " writes over " + FRAMES + " frames)");
  return { want, got, events: rt.sound.events };
}

/* ---- the parity toys -------------------------------------------------- */

/* f0: sfx(0, note(60), 9, 4) and sfx(1, note(69), 7, 6).  The reserve and
 * the 32-step square upload for each channel, note(60)'s F 428 and
 * note(69)'s F 254 in R2/R3, then the 4-frame SFX releases at frame 4's
 * tick and the 6-frame one at frame 6's — the tick order: releases before
 * the frame body, and a finished SFX gives its channel back. */
const NOTE_TOY = [
  "function frame(t, f)",
  "  if f == 0 then",
  "    sfx(0, note(60), 9, 4)",
  "    sfx(1, note(69), 7, 6)",
  "  end",
  "end",
  ""
].join("\n");

/* f0: sfx(1, note(48), 15, 3); f1: sfx(2, 1200, 7, 1); f2: channel 2's
 * 1-frame SFX releases in the tick (its three writes first), then release(1)
 * takes channel 1 back early; f3: sfx(1, ...) re-fires with a fresh
 * reserve.  The interleaving pins the tick-before-body order, not just the
 * writes. */
const SFX_TOY = [
  "function frame(t, f)",
  "  if f == 0 then sfx(1, note(48), 15, 3) end",
  "  if f == 1 then sfx(2, 1200, 7, 1) end",
  "  if f == 2 then release(1) end",
  "  if f == 3 then sfx(1, note(48), 15, 3) end",
  "end",
  ""
].join("\n");

/* ---- the substitutes (host-only; the studio refuses these operands) --- */

/* Every operand out of range, the console's clamps (docs/ROM-SOUND.md §7):
 *   sfx(9, ...)          bad channel: no writes at all
 *   sfx(0, 65535, 100, -5)  freq 0xFFF, volume 4, frames 1 (auto-release
 *                           at frame 1's tick)
 *   sfx(1, -3, -2, 700)  freq 0xFFD, volume 30, frames 600 (never releases
 *                           within the run)
 *   release(7)           bad channel: no writes
 *   music(3), music(0)   n = 0 trailer: no writes (and no init stream)
 *   sfx(2..4, note(-1)/note(512)/note(700), 3, 2)  F 4095, 0, 0
 *   sfx(5, note(76), 1, 2)  the last channel, normal operands: F 170
 */
const SUBS_TOY = [
  "function frame(t, f)",
  "  if f == 0 then",
  "    sfx(9, 1, 1, 1)",
  "    sfx(0, 65535, 100, -5)",
  "    sfx(1, -3, -2, 700)",
  "    release(7)",
  "    music(3)",
  "    music(0)",
  "    sfx(2, note(-1), 3, 2)",
  "    sfx(3, note(512), 3, 2)",
  "    sfx(4, note(700), 3, 2)",
  "    sfx(5, note(76), 1, 2)",
  "  end",
  "end",
  ""
].join("\n");

/* ---- the run ---------------------------------------------------------- */

const probe = spawnSync("cc", ["--version"], { encoding: "utf8" });
if (probe.error) {
  skipped.push("the harness runs (no system cc)");
  console.log("SKIP  the harness runs: no system cc");
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "romsound-cc-"));
  hostvmBin = path.join(tmp, "hostvm");
  check(buildHostvm(hostvmBin), "the system cc builds ilvm.c + hostvm.c");
  if (fs.existsSync(hostvmBin)) {

    /* 0. the four ops, in range: harness == studio, write for write */
    const note = runBoth(NOTE_TOY, "note");
    check(note.events.length > 40,
          "note toy: the run recorded PSG writes (" + note.events.length +
          ") — a toy whose sfx never fired would record none");
    eq("note toy: the harness's frame 0 writes (45 per channel: R1 $FF, " +
       "the 5-write reserve and the 39-write upload)",
       note.got[0] ? note.got[0].length : 0, 90);
    eq("note toy: note(60)'s F 428 reaches R2/R3 in frame 0",
       note.want[0].filter((w) => w[0] === 2 || w[0] === 3).slice(0, 2),
       [[2, F(60) & 0xff], [3, (F(60) >> 8) & 0x0f]]);
    eq("note toy: note(69)'s F 254 follows channel 1's select",
       note.want[0].filter((w) => w[0] === 2 || w[0] === 3).slice(2, 4),
       [[2, F(69) & 0xff], [3, (F(69) >> 8) & 0x0f]]);
    eq("note toy: frame 4's tick releases channel 0 (its four writes)",
       note.want[4], [[0, 0], [4, 0], [7, 0], [9, 0]]);
    eq("note toy: frame 6's tick releases channel 1", note.want[6],
       [[0, 1], [4, 0], [7, 0], [9, 0]]);
    eq("note toy: the released channels stay silent for the rest of the run",
       [7, 8, 9, 10, 11].map((f) => note.want[f] || []),
       [[], [], [], [], []]);

    const sfx = runBoth(SFX_TOY, "sfx/release");
    eq("sfx toy: frame 0 is R1 $FF, channel 1's reserve (5) + upload (39)",
       sfx.want[0].length, 45);
    eq("sfx toy: note(48)'s F 855 reaches R2/R3",
       sfx.want[0].filter((w) => w[0] === 2 || w[0] === 3),
       [[2, F(48) & 0xff], [3, (F(48) >> 8) & 0x0f]]);
    eq("sfx toy: frame 1 is R1 $FF, channel 2's reserve (4, no R9) + " +
       "upload (39)", sfx.want[1].length, 44);
    eq("sfx toy: the 1200 Hz F is 0x4B0 in R2/R3",
       sfx.want[1].filter((w) => w[0] === 2 || w[0] === 3),
       [[2, 0xb0], [3, 0x04]]);
    eq("sfx toy: frame 2 opens with channel 2's auto-release in the tick " +
       "(three writes, no R9) then release(1)'s four",
       sfx.want[2],
       [[0, 2], [4, 0], [7, 0],
        [0, 1], [4, 0], [7, 0], [9, 0]]);
    eq("sfx toy: frame 3 re-fires channel 1 with R1 $FF, a fresh reserve (5) " +
       "and upload (39)",
       sfx.want[3],
       [[1, 0xff],
        [0, 1], [4, 0], [7, 0], [9, 0], [5, 0xff],
        [0, 1], [4, 0x40], [4, 0]].concat(
          Array.from({ length: 32 }, (_, i) => [6, i < 16 ? 31 : 0])).concat(
          [[0, 1], [2, F(48) & 0xff], [3, (F(48) >> 8) & 0x0f],
           [4, 0x80 | 15]]));
    eq("sfx toy: channel 1's re-fired 3-frame SFX releases at frame 6",
       sfx.want[6], [[0, 1], [4, 0], [7, 0], [9, 0]]);

    /* 1. the substitutes: the harness clamps; the studio refuses */
    const encodedSubs = ilbc.encode(il.compile(SUBS_TOY,
      { chunkName: "romsound-subs.lua" }));
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "romsound-subs-"));
    const container = path.join(runDir, "toy.ilbc");
    fs.writeFileSync(container, Buffer.from(encodedSubs.bytes));
    const r = spawnSync(hostvmBin, [container, runDir, String(FRAMES)],
                        { encoding: "utf8" });
    check(r.status === 0, "substitutes: hostvm exits 0 (" +
          ((r.stderr || "").trim().split("\n").slice(-1)[0] || "ok") + ")");
    const subs = framesFromPsg(fs.readFileSync(path.join(runDir, "psg.txt"),
                                               "utf8"));

    eq("substitutes: frame 0's clamped stream (the six live sfx, the two " +
       "bad channels, release and music wrote nothing)",
       subs[0],
       [/* sfx(0, 65535, 100, -5): R1 $FF, reserve, freq 0xFFF, vol 4,
         * frames 1 */
        [1, 0xff], [0, 0], [4, 0], [7, 0], [9, 0], [5, 0xff],
        [0, 0], [4, 0x40], [4, 0]]
         .concat(Array.from({ length: 32 }, (_, i) => [6, i < 16 ? 31 : 0]))
         .concat([[0, 0], [2, 0xff], [3, 0x0f], [4, 0x80 | 4],
                  /* sfx(1, -3, -2, 700): R1 $FF, freq 0xFFD, vol 30,
                   * frames 600 */
                  [1, 0xff], [0, 1], [4, 0], [7, 0], [9, 0], [5, 0xff],
                  [0, 1], [4, 0x40], [4, 0]])
         .concat(Array.from({ length: 32 }, (_, i) => [6, i < 16 ? 31 : 0]))
         .concat([[0, 1], [2, 0xfd], [3, 0x0f], [4, 0x80 | 30],
                  /* sfx(2, note(-1), 3, 2): R1 $FF, F 4095 */
                  [1, 0xff], [0, 2], [4, 0], [7, 0], [5, 0xff],
                  [0, 2], [4, 0x40], [4, 0]])
         .concat(Array.from({ length: 32 }, (_, i) => [6, i < 16 ? 31 : 0]))
         .concat([[0, 2], [2, 0xff], [3, 0x0f], [4, 0x80 | 3],
                  /* sfx(3, note(512), 3, 2): R1 $FF, F 0 */
                  [1, 0xff], [0, 3], [4, 0], [7, 0], [5, 0xff],
                  [0, 3], [4, 0x40], [4, 0]])
         .concat(Array.from({ length: 32 }, (_, i) => [6, i < 16 ? 31 : 0]))
         .concat([[0, 3], [2, 0x00], [3, 0x00], [4, 0x80 | 3],
                  /* sfx(4, note(700), 3, 2): R1 $FF, F 0 (clamped to
                   * entry 511) */
                  [1, 0xff], [0, 4], [4, 0], [7, 0], [5, 0xff],
                  [0, 4], [4, 0x40], [4, 0]])
         .concat(Array.from({ length: 32 }, (_, i) => [6, i < 16 ? 31 : 0]))
         .concat([[0, 4], [2, 0x00], [3, 0x00], [4, 0x80 | 3],
                  /* sfx(5, note(76), 1, 2): R1 $FF, F 170, a normal last
                   * channel */
                  [1, 0xff], [0, 5], [4, 0], [7, 0], [5, 0xff],
                  [0, 5], [4, 0x40], [4, 0]])
         .concat(Array.from({ length: 32 }, (_, i) => [6, i < 16 ? 31 : 0]))
         .concat([[0, 5], [2, F(76) & 0xff], [3, (F(76) >> 8) & 0x0f],
                  [4, 0x80 | 1]]));
    eq("substitutes: frame 1's tick releases channel 0 (frames 1 ran out); " +
       "channel 1 still counts its 600", subs[1],
       [[0, 0], [4, 0], [7, 0], [9, 0]]);
    eq("substitutes: frame 2's tick releases channels 2, 3, 4 and 5",
       subs[2],
       [[0, 2], [4, 0], [7, 0],
        [0, 3], [4, 0], [7, 0],
        [0, 4], [4, 0], [7, 0],
        [0, 5], [4, 0], [7, 0]]);
    eq("substitutes: frames 3..11 are silent (channel 1's 600-frame count " +
       "has not run out)", [3, 4, 5, 6, 7, 8, 9, 10, 11].map(
         (f) => subs[f] || []),
       [[], [], [], [], [], [], [], [], []]);
    fs.rmSync(runDir, { recursive: true, force: true });

    /* the studio host refuses the same toy before its first write */
    let refused = null;
    const rtSubs = il.create(SUBS_TOY, { chunkName: "romsound-subs.lua" });
    rtSubs.load();
    try { rtSubs.frame(0); } catch (e) { refused = String(e && e.message || e); }
    check(/an SFX channel must be 0\.\.5|music-range|note-range/.test(refused || ""),
          "substitutes: the studio host refuses the same operands (" +
          refused + ") — the clamps are the console's documented substitute");
    eq("substitutes: the refusal fired before the first write",
       rtSubs.sound.events.length, 0);

    /* 2. no sound op, no writes: a version 1 pal toy leaves psg.txt empty */
    const SILENT_TOY = [
      "function frame(t, f)",
      "  pal(0, rgb(f % 4 * 2, f % 8 * 3, 5))",
      "end",
      ""
    ].join("\n");
    const silent = ilbc.encode(il.compile(SILENT_TOY,
      { chunkName: "romsound-silent.lua" }));
    check(silent.bytes[4] === 1,
          "silent toy: still a version 1 container (no sound construct)");
    const silentDir = fs.mkdtempSync(path.join(os.tmpdir(), "romsound-sil-"));
    const silentContainer = path.join(silentDir, "toy.ilbc");
    fs.writeFileSync(silentContainer, Buffer.from(silent.bytes));
    const sr = spawnSync(hostvmBin, [silentContainer, silentDir,
                                     String(FRAMES)], { encoding: "utf8" });
    check(sr.status === 0, "silent toy: hostvm exits 0");
    eq("silent toy: psg.txt is empty — the sound path writes nothing " +
       "without a sound op",
       fs.readFileSync(path.join(silentDir, "psg.txt"), "utf8").trim(), "");
    fs.rmSync(silentDir, { recursive: true, force: true });
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---- 3. the console trace (#200) -------------------------------------- */
{
  const llvm = findLlvmMos();
  const missing = [];
  if (!haveCommand("mednafen")) missing.push("Mednafen");
  if (!haveCommand("pceas4")) missing.push("PCEAS 4.x");
  if (!llvm) missing.push("llvm-mos");
  if (!haveCommand("python3")) missing.push("python3");
  if (missing.length) {
    skipped.push("the Mednafen PSG trace (" + missing.join(", ") + " missing)");
    console.log("SKIP  the Mednafen PSG trace: " + missing.join(", ") +
                " missing");
  } else {
    /* One Mednafen at a time: another seat may be running one from this
     * account, and two runs make both captures wrong (docs/ROM_SPEED.md). */
    let busy = false;
    for (let i = 0; i < 30; i++) {
      if (spawnSync("pgrep", ["-x", "mednafen"]).status !== 0) break;
      busy = i === 29;
      sleepMs(2000);
    }
    if (busy) {
      skipped.push("the Mednafen PSG trace (another mednafen is running)");
      console.log("SKIP  the Mednafen PSG trace: another mednafen is running");
    } else {
      const scratch = fs.mkdtempSync(
        path.join(os.tmpdir(), "romsound-trace-"));
      const image = path.join(scratch, "ilvm-trace.bin");
      const build = spawnSync(
        path.join(ROOT, "tools", "ilvm", "build.sh"), [],
        { cwd: ROOT, encoding: "utf8",
          env: Object.assign({}, process.env,
                             { TRACE: "1", BIN: image, LLVM_MOS: llvm }) });
      check(build.status === 0,
            "trace image builds (TRACE=1, never renderer/ilvm.bin)");
      if (build.status === 0) {
        for (const spec of [["tools/toys/note.lua", "note"],
                            ["tools/toys/sfx.lua", "sfx"]])
          checkOneTrace(path.join(ROOT, spec[0]), spec[1], image, scratch);
      } else {
        console.log("      " + ((build.stderr || build.stdout || "")
          .trim().split("\n").slice(-3).join(" | ")));
      }
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }
}

if (skipped.length) console.log("SKIP  " + skipped.join("; "));
if (failures) {
  console.log(`\ncheck-rom-sound: ${failures} failure(s)`);
  process.exit(1);
}
console.log("check-rom-sound: PASS");
