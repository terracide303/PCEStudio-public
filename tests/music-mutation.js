#!/usr/bin/env node
/*
 * tests/music-mutation.js — card #72.
 *
 * REVIEW-35 (docs/REVIEW-35.md) broke the music path thirteen ways and found
 * three MISSED, each shown real by a probe:
 *
 *   M05  the volume envelope's loop   `loop !== 0xff` forced false, so the
 *                                     envelope holds its last value forever
 *   M06  the waveform envelope        wave forced to 0, the envelope never
 *                                     consulted
 *   M11  buildSongRom                 copies 15 of the 16 engine banks; the
 *                                     one committed engine's tail is filler,
 *                                     so the ROMs stayed identical
 *
 * #72 closes the three gaps in the checks themselves: tests/check-dmf.js now
 * traces a legal song with a four-step looping volume envelope and a
 * three-waveform looping waveform envelope (section 2b), and
 * tests/check-export-song.js now drives buildSongRom with a 16-bank engine
 * whose every bank, tail included, is in use (check 5).
 *
 * This script asks the only question that makes those assertions worth
 * anything: DOES EACH CHECK FAIL WHEN THE BREAK IS PUT BACK?  The breaks are
 * REVIEW-35's; the source edits below are this seat's re-expression of them,
 * applied one at a time to a throwaway copy of the working tree.  Each `from`
 * must occur exactly once (NOT APPLIED otherwise): a refactor that moves a
 * string must not silently turn the break into a tautology.
 *
 * Result classes (each is reported; the run fails if any is off):
 *
 *   DETECTED     the designated checker exits non-zero and its output names
 *                the assertion that should have caught it (`witness`).
 *   MISSED       the designated checker exits 0 — the break is invisible.
 *   CRASH        the checker neither exits 0 nor printed a FAIL line (it threw
 *                or died): a broken test, not a detection.
 *   UNEXPECTED   the checker failed, but not on the new assertion — the break
 *                reached something else first, so this run does not show the
 *                new assertion doing its job.
 *   NOT APPLIED  `from` did not occur exactly once in the current source.
 *   GREEN        a control edit: both checkers exit 0.  Required only for
 *                GREEN_EXPECTED rows; a GREEN result for a real break is a
 *                MISSED.
 *
 * It tests itself too, because a check that cannot say no proves nothing:
 *   - blind copies of both checkers (the new comparisons gutted) must report
 *     MISSED on the same breaks — the DETECTED above must come from the new
 *     assertions, not from older ones;
 *   - a semantically identical substitution must be GREEN (no false alarm);
 *   - a doctored check-dmf fixture whose loop reloads to the value it would
 *     have held must be refused by the fixture self-check — otherwise the
 *     fixture could weaken to a vacuous pass without anything noticing.
 *
 * WHAT THIS DOES NOT PROVE (read together with the verdict):
 *   - It proves these two checks catch these three breaks.  It is not a break
 *     of the music path: REVIEW-35's other ten breaks are not re-run here, and
 *     a fourth break in the same code, which REVIEW-35 did not choose, is not
 *     covered by construction.
 *   - Where REVIEW-35 did not record its literal edit, the edit here has the
 *     same effect as its stated direction but is not necessarily the same
 *     text.  A different edit with the same claimed effect could behave
 *     differently.
 *   - The baseline only shows the shipped checkers are green on the shipped
 *     tree.  check-dmf's audio comparison (Mednafen) and check-export-song's
 *     PCEAS comparison carry their own blind spots, in their headers; nothing
 *     here is hardware.
 *   - The M11 assertion's witness is a synthetic engine image.  The committed
 *     engine does not use bank $0F, so "the tail is copied" is proven for an
 *     image no song builds, not for a recorded ROM.
 *
 * Run: node tests/music-mutation.js
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const TESTS = __dirname;
const ROOT = path.join(TESTS, "..");
const DUMPS = path.join(TESTS, "dumps");
const CHECK_DMF_PATH = path.join(TESTS, "check-dmf.js");
const CHECK_EXPORT_PATH = path.join(TESTS, "check-export-song.js");

const SOURCES = {};
for (const f of ["pce-song.js", "pce-rom.js"])
  SOURCES[f] = fs.readFileSync(path.join(ROOT, "renderer", f), "utf8");
const CHECK_DMF_SRC = fs.readFileSync(CHECK_DMF_PATH, "utf8");
const CHECK_EXPORT_SRC = fs.readFileSync(CHECK_EXPORT_PATH, "utf8");

/* REVIEW-35's three MISSED breaks, in its order.  `by` is the checker the
 * card's coverage rests on; `witness` is the line that detection must print. */
const MUTATIONS = [
  {
    id: "M05", by: "check-dmf.js", file: "pce-song.js",
    what: "volume envelope never loops (holds its last value forever)",
    from: "        if (c.volEnv.loop !== 0xff) {",
    to: "        if (false) {",
    witness: /the volume envelope loops back to step 1/,
    note: "fixture frame 10: pristine level 20 ($94), the break holds 0 " +
      "($80) — REVIEW-35's probe values, reached by this check's fixture.",
  },
  {
    id: "M06", by: "check-dmf.js", file: "pce-song.js",
    what: "waveform envelope never consulted (wave forced to 0)",
    from: "      if (!c.waveEnv || c.waveEnv.size === 0) {",
    to: "      if (true) {",
    witness: /the waveform envelope walks waves/,
    note: "fixture frame 7: pristine uploads wave 1's 32 steps; the break " +
      "uploads nothing after frame 6, because every wave is 0 now.",
  },
  {
    id: "M11", by: "check-export-song.js", file: "pce-rom.js",
    what: "buildSongRom copies 15 of the 16 engine banks (the tail lost)",
    from: "    rom.set(engine, 0);",
    to: "    rom.set(engine.subarray(0, 15 * BANK), 0);",
    witness: /buildSongRom copies all 16 engine banks/,
    note: "the tail bank lands at byte 122880; the committed engine's bank " +
      "$0F is 0xff filler, which is why the PCEAS comparison stayed green.",
  },
];

/* An inert edit: both checkers must stay green.  A PASS on it says nothing
 * about a break — that is the point of having it. */
const CONTROL = {
  id: "C1", file: "pce-song.js", expect: "green",
  what: "an unused variable beside the player's CHANNELS constant (control)",
  from: "  var CHANNELS = 6;",
  to: "  var CHANNELS = 6;\n  var UNUSED_CONTROL = 1;",
  note: "changes no behaviour; both checkers must stay green.",
};

/* A semantically identical substitution: must be GREEN, not a false alarm. */
const NOOP_SUBSTITUTION = {
  id: "no-op self-test", file: "pce-song.js", expect: "green",
  what: "`loop !== 0xff` -> `loop !== 255`",
  from: "        if (c.volEnv.loop !== 0xff) {",
  to: "        if (c.volEnv.loop !== 255) {",
  note: "the same comparison for every value the reader can produce.",
};

/* The checkers with their new eyes removed.  Each replacement must match
 * exactly once; assertThat() below refuses otherwise. */
const BLIND_DMF = (() => {
  let s = CHECK_DMF_SRC;
  s = replaceOnce(s, "    if (!waveBad && (steps.length !== want.length ||",
                     "    if (false && (steps.length !== want.length ||");
  s = replaceOnce(s, "    if (!volBad && last !== (vol | 0x80))",
                     "    if (false)");
  return s;
})();
const BLIND_EXPORT = (() => {
  let s = CHECK_EXPORT_SRC;
  s = replaceOnce(s,
    "  for (let i = 0; i < engine.length; i++)\n" +
    "    if (rom[i] !== engine[i]) { diff = i; break; }", "");
  s = replaceOnce(s,
    "  for (let i = 0; i < BANK; i++)\n" +
    "    if (rom[(banks - 1) * BANK + i] !== tail[i]) { tailDiff = i; break; }",
    "");
  return s;
})();

/* The fixture weakened so its loop reloads to the level a hold would keep:
 * the fixture self-check must refuse it, whatever the player does. */
const WEAK_FIXTURE_DMF = replaceOnce(CHECK_DMF_SRC,
  "  f.instruments[0].volumeEnv = { size: 4, data: [31, 20, 10, 0], loop: 1 };",
  "  f.instruments[0].volumeEnv = { size: 4, data: [31, 20, 10, 20], loop: 3 };");

function replaceOnce(src, from, to) {
  const n = src.split(from).length - 1;
  if (n !== 1)
    throw new Error(`self-test source string occurs ${n} time(s), not 1: ` +
                    JSON.stringify(from.slice(0, 60)));
  return src.replace(from, to);
}

/* ---- the throwaway tree ------------------------------------------------ */

let treeSeq = 0;
const tempDirs = [];
function cleanup() {
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}
process.on("exit", cleanup);

function makeTree() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pce-music-mut-"));
  tempDirs.push(tmp);
  fs.mkdirSync(path.join(tmp, "renderer"));
  fs.mkdirSync(path.join(tmp, "tests"));
  fs.mkdirSync(path.join(tmp, "tools"));
  for (const f of ["pce-dmf.js", "pce-song.js", "pce-psg.js", "pce-hutrack.js",
                   "pce-rom.js", "hutrack-engine.bin"])
    fs.copyFileSync(path.join(ROOT, "renderer", f),
                    path.join(tmp, "renderer", f));
  fs.copyFileSync(CHECK_DMF_PATH, path.join(tmp, "tests", "check-dmf.js"));
  fs.copyFileSync(CHECK_EXPORT_PATH,
                  path.join(tmp, "tests", "check-export-song.js"));
  /* read-only inputs: the real dumps and the vendored engine's sources */
  fs.symlinkSync(DUMPS, path.join(tmp, "tests", "dumps"), "dir");
  fs.symlinkSync(path.join(ROOT, "vendor"), path.join(tmp, "vendor"), "dir");
  for (const f of ["build-hutrack.sh", "hutrack.asm"])
    fs.copyFileSync(path.join(ROOT, "tools", f), path.join(tmp, "tools", f));
  fs.chmodSync(path.join(tmp, "tools", "build-hutrack.sh"), 0o755);
  return tmp;
}

const TREE = makeTree();

function writeSource(file, src) {
  fs.writeFileSync(path.join(TREE, "renderer", file), src);
}
function writePristine() {
  for (const f of Object.keys(SOURCES)) writeSource(f, SOURCES[f]);
}
function runChecker(script) {
  const r = spawnSync(process.execPath, [path.join(TREE, "tests", script)],
    { cwd: TREE, encoding: "utf8", timeout: 300000 });
  return {
    status: r.status,
    signal: r.signal,
    error: r.error || null,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
  };
}
function green(r) {
  return r.status === 0 && /all checks passed/.test(r.stdout);
}

/* ---- applying and judging --------------------------------------------- */

function apply(mutation) {
  const src = SOURCES[mutation.file];
  const n = src.split(mutation.from).length - 1;
  if (n !== 1) return { error: `found ${n} time(s), expected exactly 1` };
  return { src: src.replace(mutation.from, mutation.to) };
}

function judge(mutation, applied) {
  writeSource(mutation.file, applied.src);
  const r = runChecker(mutation.by);
  writePristine();

  if (r.error || r.signal)
    return { kind: "crash", detail: `the checker did not run ` +
             `(${r.signal || r.error})` };
  if (r.status === 0) {
    return { kind: mutation.expect === "green" ? "green" : "missed",
             detail: "the checker exited 0" };
  }
  const lines = r.stdout.split("\n");
  const witness = lines.find((l) => mutation.witness && mutation.witness.test(l));
  if (witness)
    return { kind: "detected", detail: witness.trim() };
  const fails = lines.filter((l) => /FAIL/.test(l));
  if (!fails.length)
    return { kind: "crash", detail: "exited " + r.status +
             " with no FAIL line" +
             (r.stderr.trim() ? ": " + r.stderr.trim().split("\n").pop() : "") };
  return { kind: "unexpected", detail: "failed, but not on the new " +
           `assertion: ${fails[0].trim()}` };
}

function judgeControl(mutation, applied) {
  writeSource(mutation.file, applied.src);
  const dmf = runChecker("check-dmf.js");
  const exp = runChecker("check-export-song.js");
  writePristine();
  if (green(dmf) && green(exp)) return { kind: "green", detail: "both green" };
  return { kind: "unexpected", detail: `not both green (check-dmf ${dmf.status}` +
    `, check-export-song ${exp.status})` };
}

/* ---- output ------------------------------------------------------------ */

const failures = [];
function fail(msg) { failures.push(msg); console.log(`  FAIL  ${msg}`); }
function pass(msg) { console.log(`  ok    ${msg}`); }

function report(mutation, result) {
  if (mutation.note) console.log(`        note: ${mutation.note}`);
  console.log(`        ${result.detail}`);
  const required = mutation.expect === "green" ? "green" : "detected";
  if (result.kind === required)
    pass(`${mutation.id}: ${result.kind.toUpperCase()} — ${mutation.what}`);
  else
    fail(`${mutation.id}: ${result.kind.toUpperCase()} (expected ` +
         `${required.toUpperCase()}) — ${mutation.what}`);
}

console.log("music mutation test — REVIEW-35's three MISSED breaks (#72)");
console.log(`tree: ${TREE}`);

/* 1. Baseline: the shipped checkers on the shipped sources. */
console.log("\nbaseline: both checkers, unmodified sources");
{
  writePristine();
  const dmf = runChecker("check-dmf.js");
  const exp = runChecker("check-export-song.js");
  if (green(dmf) && green(exp))
    pass("check-dmf.js and check-export-song.js both pass on the pristine tree");
  else {
    if (!green(dmf)) { console.log(dmf.stdout); console.error(dmf.stderr); }
    if (!green(exp)) { console.log(exp.stdout); console.error(exp.stderr); }
    fail(`baseline is not green (check-dmf ${dmf.status}, ` +
         `check-export-song ${exp.status})`);
  }
}

/* 2. The three breaks. */
for (const mutation of MUTATIONS) {
  console.log(`\n${mutation.id}: ${mutation.what}`);
  const applied = apply(mutation);
  if (applied.error) {
    fail(`${mutation.id}: NOT APPLIED — ${applied.error}`);
    continue;
  }
  report(mutation, judge(mutation, applied));
}

/* 3. The control and the identical substitution. */
for (const mutation of [CONTROL, NOOP_SUBSTITUTION]) {
  console.log(`\n${mutation.id}: ${mutation.what}`);
  const applied = apply(mutation);
  if (applied.error) {
    fail(`${mutation.id}: NOT APPLIED — ${applied.error}`);
    continue;
  }
  report(mutation, judgeControl(mutation, applied));
}

/* 4. Self-tests: each check must be able to say no. */
function blindTest(label, mutation, blindSrc, blindName) {
  console.log(`\nself-test: ${label}`);
  const applied = apply(mutation);
  if (applied.error) { fail(`${label}: NOT APPLIED — ${applied.error}`); return; }
  fs.writeFileSync(path.join(TREE, "tests", blindName), blindSrc);
  writeSource(mutation.file, applied.src);
  const r = runChecker(blindName);
  writePristine();
  if (green(r))
    pass(`${mutation.id} was MISSED by the blind checker, not DETECTED`);
  else
    fail(`the blind checker did not pass ${mutation.id} (exit ${r.status}) — ` +
         `this self-test cannot tell a real detection from a broken check`);
}

blindTest("check-dmf.js with the new envelope comparisons gutted — M05",
          MUTATIONS[0], BLIND_DMF, "check-dmf-blind.js");
blindTest("check-dmf.js with the new envelope comparisons gutted — M06",
          MUTATIONS[1], BLIND_DMF, "check-dmf-blind.js");
blindTest("check-export-song.js with the engine-copy comparison gutted — M11",
          MUTATIONS[2], BLIND_EXPORT, "check-export-song-blind.js");

console.log("\nself-test: a doctored fixture whose loop reloads to the level " +
            "a hold would keep");
{
  fs.writeFileSync(path.join(TREE, "tests", "check-dmf-fixture.js"),
                   WEAK_FIXTURE_DMF);
  writePristine();
  const r = runChecker("check-dmf-fixture.js");
  if (r.status !== 0 &&
      /a loop and a hold write different levels/.test(r.stdout))
    pass("the weakened fixture was refused by the fixture self-check");
  else
    fail(`the weakened fixture was not refused (exit ${r.status})`);
}

cleanup();
console.log("");
if (failures.length === 0) {
  console.log("PASS: REVIEW-35's M05, M06 and M11 are all DETECTED by the " +
    "assertions #72 added (M05/M06 by check-dmf.js, M11 by " +
    "check-export-song.js), the control and the identical substitution are " +
    "GREEN, and the blind checkers and the weakened fixture all said no.");
  process.exitCode = 0;
} else {
  console.log(`FAIL: ${failures.length} check(s) did not hold`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
