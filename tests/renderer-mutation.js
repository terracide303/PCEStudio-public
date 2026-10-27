#!/usr/bin/env node
/*
 * tests/renderer-mutation.js — card #6.
 *
 * tests/check.js says the renderer matches Mednafen pixel for pixel.  This
 * script asks the only question that makes that sentence worth anything:
 * DOES THE DIFF TEST ACTUALLY FAIL WHEN THE RENDERER IS BROKEN?
 *
 * It runs the real tests/check.js over the three scene dumps once unmodified
 * (the baseline), then again over copies of renderer/pce-bg.js that have two
 * deliberate defects, one per class the card names:
 *
 *   palette-index  the BAT palette nibble is ignored; every tile draws from
 *                  palette 0 instead of the palette the BAT selects.
 *   tile-row       tile rows are shifted by one; the tile row the renderer
 *                  reads is not the row the BAT selects.
 *
 * The real renderer and the real check.js are never modified.  Each mutant is
 * written to a throwaway directory with a copy of check.js and a symlink to
 * tests/dumps, so check.js is exercised exactly as shipped.
 *
 * Every result class is separated; none may stand in for another:
 *
 *   DETECTED     check.js exited 1 and reported, for every scene whose pixels
 *                the mutation actually changed, exactly the number of differing
 *                bytes the two renders differ by (and reported diff 0 for the
 *                scenes it did not change).  This is the pass.
 *   MISSED       check.js exited 0 although the mutant's output differs from
 *                the reference.  This is the defect #6 exists to catch.
 *   CRASH        check.js exited non-zero without the per-scene diff report a
 *                detection needs (a thrown error looks like a failure but
 *                proves nothing about the comparison).
 *   NO-OP        the mutation changed no rendered byte.  A checker cannot be
 *                asked to catch a break that changes nothing, and treating
 *                "unchanged" as "detected" would be a lie.  Reported, failed.
 *   NOT APPLIED  the source line the mutation edits was not found exactly once.
 *   UNEXPECTED   check.js exited 0 with output that is not a clean three-scene
 *                pass (so the baseline cannot be trusted either).
 *   INPUT-ERROR  a dump could not be read or rendered; distinct from every
 *                statement about the checker above.
 *
 * Ground truth for the comparison is computed in this process by rendering the
 * unmodified and mutated modules side by side from the same dumps; check.js is
 * then checked against that, not against its own opinion.
 *
 * The script also tests ITSELF, because a checker that has never failed has not
 * been tested:
 *   - a copy of check.js with the pixel comparison gutted (`if (false)`) must
 *     be reported MISSED for both mutations, not DETECTED;
 *   - a semantically identical mutation must be reported NO-OP, not DETECTED.
 *
 * Exit code 0 only when the baseline is diff 0 and both real mutations are
 * detected.  Run:  node tests/renderer-mutation.js
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const TESTS = __dirname;
const ROOT = path.join(TESTS, "..");
const CHECK_PATH = path.join(TESTS, "check.js");
const RENDERER_PATH = path.join(ROOT, "renderer", "pce-bg.js");
const DUMPS = path.join(TESTS, "dumps");

const CHECK_SRC = fs.readFileSync(CHECK_PATH, "utf8");
const RENDERER_SRC = fs.readFileSync(RENDERER_PATH, "utf8");

/* The two defects the card names, plus one that changes nothing (self-test). */
const MUTATIONS = [
  {
    id: "palette-index",
    what: "BAT palette nibble ignored: every tile is drawn with palette 0",
    from: "var pal = (bat >> 12) & 0xF;",
    to: "var pal = 0;",
  },
  {
    id: "tile-row",
    what: "tile rows shifted by one: row r reads row r+1",
    from: "var row = bgY & 7;",
    to: "var row = (bgY + 1) & 7;",
  },
];

const NOOP_MUTATION = {
  id: "no-op self-test",
  what: "semantically identical substitution must be reported NO-OP",
  from: "var pal = (bat >> 12) & 0xF;",
  to: "var pal = ((bat >> 12) & 0xF) | 0;",
};

/* A checker that has had its eyes removed: still prints OK, still exits 0. */
const BLIND_CHECK_SRC = CHECK_SRC.replace(
  "if (got.pixels[i] !== ref.pixels[i]) {",
  "if (false) {"
);

/* The three #5 scene dumps.  Other captures in dumps/ (viewerN, browserN,
 * usN, painted) are other cards' evidence: check.js checks them too, but this
 * mutation test only knows the sceneN pictures, and its parsers read
 * `sceneN:` lines.  Before 2026-10-28 this filter took every dump with a
 * mednafen.png, so it started reporting CRASH on the viewer/browser/us
 * captures as soon as #8/#9/#25 added them — found while running #10. */
const SCENES = fs.readdirSync(DUMPS)
  .filter((d) => /^scene\d+$/.test(d))
  .filter((d) => fs.existsSync(path.join(DUMPS, d, "mednafen.png")))
  .sort();

/* If the source text is refactored these substitutions silently become
 * no-ops, which would turn the mutation and its self-test into tautologies.
 * Refuse to run instead. */
function requireOneOccurrence(haystack, needle, what) {
  const n = haystack.split(needle).length - 1;
  if (n !== 1) {
    console.error(`ERROR: ${what}: expected exactly 1 occurrence, found ${n}`);
    process.exit(2);
  }
}
requireOneOccurrence(CHECK_SRC, "if (got.pixels[i] !== ref.pixels[i]) {", "check.js comparison line");
for (const m of [...MUTATIONS, NOOP_MUTATION])
  requireOneOccurrence(RENDERER_SRC, m.from, `mutation ${m.id} source line`);
if (SCENES.length === 0) {
  console.error(`ERROR: no scene dumps with mednafen.png in ${DUMPS}`);
  process.exit(2);
}

const OK_RE = /^(scene\w+): OK \((\d+)x(\d+), diff 0\)$/gm;
const DIFF_RE = /^(scene\w+): (\d+) differing pixels of (\d+) bytes$/gm;
const PASS_RE = /^PASS: renderer matches Mednafen pixel for pixel on (\d+) scene\(s\)$/m;
const FAIL_RE = /^FAIL: (\d+) scene\(s\) differ$/m;

/* ---- renderer loading ---------------------------------------------------- */

function loadDumps(scene) {
  const dir = path.join(DUMPS, scene);
  return {
    vram: fs.readFileSync(path.join(dir, "vram.bin")),
    cram: fs.readFileSync(path.join(dir, "cram.bin")),
    regs: JSON.parse(fs.readFileSync(path.join(dir, "regs.json"), "utf8")),
    width: 256,
    height: 232,
  };
}

/* Write `source` as a uniquely named module and require it, so a mutant and
 * the real renderer coexist in one process without require cache collisions. */
let moduleSeq = 0;
const moduleDirs = [];
function loadRendererSource(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pce-render-"));
  moduleDirs.push(dir);
  const file = path.join(dir, `pce-bg-${moduleSeq++}.js`);
  fs.writeFileSync(file, source);
  return require(file);
}

function cleanup() {
  for (const dir of moduleDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}
process.on("exit", cleanup);

/* Count what the checker is supposed to count: differing RGB bytes. */
function compareFrames(a, b) {
  let bytes = 0;
  let pixels = 0;
  for (let i = 0; i < a.pixels.length; i += 3) {
    if (a.pixels[i] !== b.pixels[i] ||
        a.pixels[i + 1] !== b.pixels[i + 1] ||
        a.pixels[i + 2] !== b.pixels[i + 2]) {
      pixels++;
    }
    for (let c = 0; c < 3; c++) {
      if (a.pixels[i + c] !== b.pixels[i + c]) bytes++;
    }
  }
  return { bytes, pixels };
}

/* ---- running a copy of check.js against a given renderer source ---------- */

function runCheck(rendererSource, checkerSource) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pce-check-"));
  try {
    fs.mkdirSync(path.join(tmp, "renderer"));
    fs.mkdirSync(path.join(tmp, "tests"));
    fs.writeFileSync(path.join(tmp, "renderer", "pce-bg.js"), rendererSource);
    fs.writeFileSync(path.join(tmp, "tests", "check.js"), checkerSource);
    /* check.js resolves dumps from its own directory; symlink avoids copying
     * 264 KB per mutant (fall back to a copy where symlinks are unavailable). */
    try {
      fs.symlinkSync(DUMPS, path.join(tmp, "tests", "dumps"), "dir");
    } catch (_) {
      fs.cpSync(DUMPS, path.join(tmp, "tests", "dumps"), { recursive: true });
    }
    const r = spawnSync(process.execPath, [path.join(tmp, "tests", "check.js")],
      { encoding: "utf8", timeout: 120000 });
    return {
      status: r.status,
      signal: r.signal,
      error: r.error || null,
      stdout: r.stdout || "",
      stderr: r.stderr || "",
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function parseReport(stdout) {
  const ok = new Map();
  for (const m of stdout.matchAll(OK_RE)) ok.set(m[1], true);
  const diffs = new Map();
  for (const m of stdout.matchAll(DIFF_RE)) {
    diffs.set(m[1], { pixels: Number(m[2]), bytes: Number(m[3]) });
  }
  return {
    ok,
    diffs,
    pass: PASS_RE.exec(stdout),
    fail: FAIL_RE.exec(stdout),
    scenesReported: new Set([...ok.keys(), ...diffs.keys()]),
  };
}

/* ---- one scenario: mutate the renderer, judge check.js ------------------- */

function applyMutation(mutation) {
  const occurrences = RENDERER_SRC.split(mutation.from).length - 1;
  if (occurrences !== 1) {
    return { error: `source line found ${occurrences} time(s), expected exactly 1` };
  }
  return { source: RENDERER_SRC.replace(mutation.from, mutation.to) };
}

function evaluate(mutation, checkerSource) {
  const applied = applyMutation(mutation);
  if (applied.error) {
    return { kind: "not-applied", detail: applied.error, scenes: [] };
  }

  /* Ground truth: what the mutation actually changed, measured here. */
  const real = require(RENDERER_PATH);
  const mutant = loadRendererSource(applied.source);
  const truth = SCENES.map((scene) => {
    const dumps = loadDumps(scene);
    const changed = compareFrames(real.renderFrame(dumps), mutant.renderFrame(dumps));
    return { scene, changedBytes: changed.bytes, changedPixels: changed.pixels };
  });
  if (truth.every((t) => t.changedBytes === 0)) {
    return { kind: "no-op", detail: "mutation changed no rendered byte", scenes: truth };
  }

  const run = runCheck(applied.source, checkerSource);
  const report = parseReport(run.stdout);

  if (run.error || run.signal) {
    return { kind: "crash", detail: `did not run: ${run.signal || run.error}`, scenes: truth, run };
  }
  if (run.status === 0) {
    /* The dangerous one: a broken renderer and a green check. */
    const missed = truth.some((t) => t.changedBytes > 0);
    return {
      kind: missed ? "missed" : "unexpected",
      detail: "check.js exited 0",
      scenes: truth,
      run,
      report,
    };
  }

  /* Non-zero exit.  It counts as detection only if the report matches ground
   * truth scene by scene: every changed scene reports exactly the byte count
   * measured above, every unchanged scene reports diff 0. */
  const problems = [];
  for (const t of truth) {
    if (t.changedBytes > 0) {
      const d = report.diffs.get(t.scene);
      if (!d) problems.push(`${t.scene}: renderer changed ${t.changedBytes} bytes but check.js reported no diff`);
      else if (d.pixels !== t.changedBytes)
        problems.push(`${t.scene}: check.js reported ${d.pixels} differing bytes, measured ${t.changedBytes}`);
    } else if (!report.ok.has(t.scene)) {
      problems.push(`${t.scene}: renderer unchanged but check.js did not report diff 0`);
    }
  }
  if (!report.fail) problems.push("no FAIL summary line");
  if (problems.length > 0) {
    return { kind: "crash", detail: problems.join("; "), scenes: truth, run, report };
  }
  return { kind: "detected", detail: "check.js failed and matched the measured diff", scenes: truth, run, report };
}

/* ---- output -------------------------------------------------------------- */

const failures = [];
function fail(msg) { failures.push(msg); console.log(`  FAIL  ${msg}`); }
function pass(msg) { console.log(`  ok    ${msg}`); }

function evaluateSafely(mutation, checkerSource) {
  try {
    return evaluate(mutation, checkerSource);
  } catch (e) {
    return { kind: "input-error", detail: String((e && e.message) || e) };
  }
}

function printScenes(result) {
  if (!result.scenes) return;
  for (const t of result.scenes) {
    const reported = result.report && result.report.diffs.get(t.scene);
    const shown = reported ? `${reported.pixels} differing bytes reported`
                           : (result.report && result.report.ok.has(t.scene) ? "reported diff 0" : "no report");
    console.log(`        ${t.scene}: measured ${t.changedBytes} differing bytes / ` +
                `${t.changedPixels} pixels, ${shown}`);
  }
  if (result.detail && result.kind !== "detected") console.log(`        ${result.detail}`);
}

console.log(`renderer mutation test — ${SCENES.length} scene(s): ${SCENES.join(", ")}`);

/* 1. Baseline: the shipped check.js against the shipped renderer. */
console.log("\nbaseline: tests/check.js, unmodified renderer");
{
  const run = spawnSync(process.execPath, [CHECK_PATH], { encoding: "utf8", timeout: 120000 });
  const report = parseReport(run.stdout || "");
  const all = SCENES.every((s) => report.ok.has(s)) && report.scenesReported.size === SCENES.length;
  if (run.status === 0 && report.pass && all) {
    pass(`diff 0 on all ${SCENES.length} scenes`);
  } else {
    console.log(run.stdout || "");
    console.error(run.stderr || "");
    fail(`baseline is not a clean pass (status ${run.status})`);
  }
}

/* 2. The real mutations: check.js must fail, and fail accurately. */
for (const mutation of MUTATIONS) {
  console.log(`\nmutation ${mutation.id}: ${mutation.what}`);
  const result = evaluateSafely(mutation, CHECK_SRC);
  printScenes(result);
  if (result.kind === "detected") pass(`${mutation.id}: DETECTED — check.js failed and reported the measured diff`);
  else fail(`${mutation.id}: ${result.kind.toUpperCase()} — ${result.detail || ""}`);
}

/* 3. Self-tests: this script must be able to say no. */
console.log("\nself-test: a checker with the pixel comparison gutted");
for (const mutation of MUTATIONS) {
  const result = evaluateSafely(mutation, BLIND_CHECK_SRC);
  if (result.kind === "missed") pass(`${mutation.id}: blind checker reported MISSED, not DETECTED`);
  else fail(`${mutation.id}: blind checker was reported ${result.kind.toUpperCase()} (expected MISSED)`);
}

console.log("\nself-test: a mutation that changes nothing");
{
  const result = evaluateSafely(NOOP_MUTATION, CHECK_SRC);
  if (result.kind === "no-op") pass("no-op mutation reported NO-OP, not DETECTED");
  else fail(`no-op mutation reported ${result.kind.toUpperCase()} (expected NO-OP)`);
}

cleanup();

console.log("");
if (failures.length === 0) {
  console.log(`PASS: the diff test fails on a deliberately broken palette index ` +
              `and a deliberately broken tile row (${SCENES.length} dumps, diff 0 baseline)`);
  process.exitCode = 0;
} else {
  console.log(`FAIL: ${failures.length} check(s) did not hold`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
