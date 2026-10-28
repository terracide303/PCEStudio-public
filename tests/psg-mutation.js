#!/usr/bin/env node
/*
 * tests/psg-mutation.js — card #63.
 *
 * REVIEW-34 (docs/REVIEW-34.md) broke renderer/pce-psg.js 15 ways and ran
 * tests/check-psg.js: 11 DETECTED, 4 MISSED, 1 NO-OP control.  The four
 * misses were register states no recording reached:
 *
 *   M02  R3's bit 11 (the 12-bit frequency high nibble) — every recorded R3
 *        write was 0x00
 *   M08  R7 while channel 3 (0-based) is selected — `select >= 4` -> >= 3
 *   M10  LFCTL=3 — only mode 1 (psg6) and mode 2 (psg6b) were recorded
 *   M14  the wave-index reset when a channel leaves DDA — psg7 enters DDA
 *        and never leaves it, and every other ROM has control & 0x40 == 0
 *
 * #63 closes the gaps with new fixtures and asserts they reach the state:
 *
 *   psg8   F=0x8FE (R2=0xFE, R3=0x08) -> 48.6 Hz        — M02
 *   psg9   R7=0x8F with ch3 selected, then ch3 enabled   — M08
 *   psg10  DDA (R4=0x40/0xDF, R6=0x1F) then R4=0x9F      — M14
 *
 * All three are Mednafen recordings (tools/capture-psg.sh 8/9/10), compared
 * sample for sample by tests/check-psg.js, which also refuses a fixture that
 * no longer reaches its state (see assertFixture there).
 *
 * #62's wave3 already covers M10: it writes R9=0x83 then 0x03 and
 * tests/check-wave.js compares the recording sample for sample.  Measured
 * here, not assumed.  #62's wave1 does NOT cover M02: its R3 writes are all
 * 0x00 except one 0x04 (channel 4's bass at F=1151 = 0x47F), and the M02
 * mask `(V & 0x07) << 8` keeps bits 0-2 of the nibble, so 0x04 passes
 * through unchanged.  That is why psg8 exists.
 *
 * This script re-runs all 15 breaks as one source substitution each against
 * the current model and asks: DOES THE SHIPPED PSG TEST FAIL WHEN THE PSG
 * MODEL IS BROKEN?  The mutant is written to a throwaway tree containing a
 * copy of check-psg.js / check-wave.js, the real dumps (symlinked read-
 * only), the real generator and the PCEAS-built wave images; ground truth is
 * computed here by rendering every recording with the pristine and the
 * mutated module side by side.
 *
 * Result classes (each is reported, and the run fails if any is off):
 *
 *   DETECTED      the designated checker exited non-zero and reported a
 *                 first differing sample on a dump the mutation changed.
 *                 "Designated" is check-psg.js except M10, where it is
 *                 check-wave.js (wave3).
 *   MISSED        the mutation changed PCM on at least one recording but the
 *                 designated checker exited 0 / printed PASS.  Fails the run
 *                 (the other suite's result is printed for context).
 *   CRASH         the checker exited non-zero without a first-differing-
 *                 sample report on a changed dump (provenance, frame-count
 *                 or size failure) — a broken test, not a detection.
 *   NO-OP         the mutation changed no rendered sample on any recording.
 *                 The documented class for the C15 control; a FAILURE for
 *                 any of the 15 breaks (it would mean the break is inert).
 *   NOT APPLIED   the source string the mutation edits was not found exactly
 *                 once (a refactor moved it — the mutation would be a
 *                 tautology otherwise).
 *   INPUT-ERROR   a dump's WAV/trace could not be read, or no whole-frame
 *                 count matches its WAV length.
 *   UNEXPECTED    the no-op control is not green in the shipped checkers, or
 *                 a checker failed naming a dump the mutation did not change.
 *
 * It also tests ITSELF:
 *   - check-psg.js with its PCM comparison gutted must report MISSED on M02,
 *     not DETECTED (a check that cannot say no proves nothing);
 *   - a semantically identical substitution must be NO-OP;
 *   - check-psg.js's fixture-coverage assertion must fire when psg8's trace
 *     loses R3's bit 11 ("FIXTURE NO LONGER COVERS ITS STATE"), and when
 *     psg8 is paired with psg1's 440 Hz WAV ("pitch 440.00 Hz, not the
 *     ~48.59 Hz").
 *
 * WHAT THIS DOES NOT PROVE (read together with the verdict):
 *   - It is still Mednafen against the model.  If pce_fast is wrong about a
 *     register (GAP-14's LFSR polynomial is the known one), matching it
 *     proves nothing about hardware.
 *   - It breaks the model's source, not genpsg.py's cycle simulation, the
 *     trace provenance check or solveFrames' WAV arithmetic — REVIEW-34
 *     lists those as a separate breaker surface.
 *   - 15 handed-over breaks are not a complete break of the PSG: other
 *     register states (R8 mid-recording, select > 5, wave rewrites while
 *     enabled, frame boundaries) are not measured here.
 *   - The fixture assertions prove each fixture reaches its register state
 *     and its claimed sound; they do not prove that state is the *only* way
 *     to reach the break, or that a future break in the same area is
 *     covered.
 *
 * Run: node tests/psg-mutation.js
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const TESTS = __dirname;
const ROOT = path.join(TESTS, "..");
const PSG_PATH = path.join(ROOT, "renderer", "pce-psg.js");
const CHECK_PSG_PATH = path.join(TESTS, "check-psg.js");
const CHECK_WAVE_PATH = path.join(TESTS, "check-wave.js");
const GEN = path.join(ROOT, "tools", "gen");
const DUMPS = path.join(TESTS, "dumps");

const PSG_SRC = fs.readFileSync(PSG_PATH, "utf8");
const CHECK_PSG_SRC = fs.readFileSync(CHECK_PSG_PATH, "utf8");
const TWO32 = 4294967296;

/* REVIEW-34's 15 breaks, in its order.  `by` is the suite the card's
 * coverage rests on: check-psg.js for the fixtures, check-wave.js for M10
 * (#62's wave3).  The `from` strings are the current source; the exact-once
 * assertions below refuse to run if a refactor moved one. */
const MUTATIONS = [
  {
    id: "M01", by: "psg",
    what: "frequency divider off by one",
    from: "      ch.freqCache = (ch.frequency ? ch.frequency : 4096) << 1;",
    to: "      ch.freqCache = ((ch.frequency ? ch.frequency : 4096) + 1) << 1;",
    note: "caught on every tone recording (psg1/2/3/4/6/6b...).",
  },
  {
    id: "M02", by: "psg",
    what: "12-bit frequency high nibble masked wrong (bit 11 dropped)",
    from: "((V & 0x0F) << 8)",
    to: "((V & 0x07) << 8)",
    note: "psg8 is the witness: F=0x8FE plays 48.6 Hz, the mutant 440.4 Hz.  " +
      "#62's wave1 R3=0x04 does not reach it (the mask drops bit 3 of the " +
      "nibble, not 0x04).",
  },
  {
    id: "M03", by: "psg",
    what: "channel volume table off by one 1.5 dB step",
    from: "flub /= Math.pow(2, 0.25 * vl);",
    to: "flub /= Math.pow(2, 0.25 * (vl + 1));",
    note: "caught on psg4 (and every recording with a non-zero level).",
  },
  {
    id: "M04", by: "psg",
    what: "balance nibbles swapped L/R",
    from: "(ch.balance >> (lr ? 0 : 4))",
    to: "(ch.balance >> (lr ? 4 : 0))",
    note: "caught on psg3 (left-only/right-only phases).",
  },
  {
    id: "M05", by: "psg",
    what: "master volume ignored",
    from: "var gbal = 0x1F - SCALE_TAB[(this.globalbalance >> (lr ? 0 : 4)) & 0xF];",
    to: "var gbal = 0;",
    note: "caught on psg4 (R1 0xFF/0x88/0x00).",
  },
  {
    id: "M06", by: "psg",
    what: "noise frequency inverted the wrong way",
    from: "var freq = 0x1F - (ch.noisectrl & 0x1F);",
    to: "var freq = ch.noisectrl & 0x1F;",
    note: "caught on psg5 (noise NF 0x0F/0x03).",
  },
  {
    id: "M07", by: "psg",
    what: "noise LFSR tap moved (bit 11 -> bit 10)",
    from: "(lfsr >> 11)",
    to: "(lfsr >> 10)",
    note: "caught on psg5.",
  },
  {
    id: "M08", by: "psg",
    what: "noise register R7 accepted on channel 3",
    from: "if (this.select >= 4) {",
    to: "if (this.select >= 3) {",
    note: "psg9 is the witness: ch3 selected, R7=0x8F written, then ch3 " +
      "enabled.  Mednafen ignores R7 there and plays the tone; the mutant " +
      "holds a level.",
  },
  {
    id: "M09", by: "psg",
    what: "LFO depth shift wrong (mode 2/3)",
    from: "var shift = ((this.lfoctrl & 0x3) - 1) << 1;",
    to: "var shift = ((this.lfoctrl & 0x3) - 1);",
    note: "caught on psg6b (LFCTL=2); psg6 (mode 1) has shift 0 either way.",
  },
  {
    id: "M10", by: "wave",
    what: "LFO mode 3 treated as off",
    from: "var lfoOn = !!(this.lfoctrl & 0x03);",
    to: "var lfoOn = !!(this.lfoctrl & 0x03) && ((this.lfoctrl & 0x03) !== 3);",
    note: "no psg6c was added: #62's wave3 already writes R9=0x83 then 0x03 " +
      "and check-wave.js compares it sample for sample.  Measured: the psg " +
      "suite is green on the mutant, the wave suite fails on wave3.",
  },
  {
    id: "M11", by: "psg",
    what: "DDA ignores the latch (R6 only outside DDA mode)",
    from: "        if (ch.control & 0x80) {\n" +
          "          /* updates the waveform value cache/latch regardless of DDA mode\n" +
          "           * being enabled (psg.cpp:305) */\n" +
          "          ch.dda = V;\n" +
          "        }",
    to: "        if ((ch.control & 0x80) && !(ch.control & 0x40)) {\n" +
        "          ch.dda = V;\n" +
        "        }",
    note: "caught on psg7 (16 held DDA levels) and psg10.",
  },
  {
    id: "M12", by: "psg",
    what: "wave index not stepped on channel enable",
    from: "          if (!(V & 0x40)) {\n" +
          "            ch.waveformIndex = (ch.waveformIndex + 1) & 0x1F;\n" +
          "            ch.dda = ch.waveform[ch.waveformIndex];\n" +
          "          }",
    to: "          if (!(V & 0x40)) {\n" +
        "            ch.dda = ch.waveform[ch.waveformIndex];\n" +
        "          }",
    note: "caught on psg1/2/3/4/6/6b (six recordings in REVIEW-34).",
  },
  {
    id: "M13", by: "psg",
    what: "Blip_Synth treble filter skipped",
    from: "genSinc(fimp, HALF_SIZE, BLIP_RES * oversample, -2.0, 0.0);",
    to: "genSinc(fimp, HALF_SIZE, BLIP_RES * oversample, 0.0, 0.0);",
    note: "caught on all recordings.",
  },
  {
    id: "M13b", by: "psg",
    what: "Blip_Buffer bass high-pass skipped",
    from: "accum = (accum + buf[i] - (accum >> 10)) | 0;",
    to: "accum = (accum + buf[i]) | 0;",
    note: "caught on all recordings.",
  },
  {
    id: "M14", by: "psg",
    what: "wave index not reset when a channel leaves DDA",
    from: "          ch.waveformIndex = 0;\n" +
          "          ch.dda = ch.waveform[ch.waveformIndex];",
    to: "          ch.dda = ch.waveform[ch.waveformIndex];",
    note: "psg10 is the witness: it enters DDA, holds 0x1F, then returns to " +
      "waveform mode with R4=0x9F.  The pristine model (and Mednafen) " +
      "restart at sample 0; the mutant re-latches at index 10.",
  },
];

/* The review's control, not a break: an unused variable must be inert. */
const CONTROL = {
  id: "C15", by: "psg", expect: "noop",
  what: "unused variable added next to TWO32 (control)",
  from: "  var TWO32 = 4294967296;",
  to: "  var TWO32 = 4294967296;\n  var UNUSED_CONTROL = 1;",
  note: "changes no behaviour; both checkers must stay green.",
};

/* A semantically identical substitution: must be NO-OP. */
const NOOP_SUBSTITUTION = {
  id: "no-op self-test", by: "psg", expect: "noop",
  what: "`!!x` -> `Boolean(x)` on the LFO switch",
  from: "var lfoOn = !!(this.lfoctrl & 0x03);",
  to: "var lfoOn = Boolean(this.lfoctrl & 0x03);",
  note: "same value for every 32-bit input.",
};

/* check-psg.js with its eyes removed: still prints OK, still exits 0. */
const BLIND_PSG_SRC = CHECK_PSG_SRC.replace(
  "if (got.pcm[i] !== wav.samples[i]) { first = i; break; }",
  "if (false) { first = i; break; }"
);

/* ---- dumps and their ground truth ------------------------------------- */

function wavFrames(buf) {
  /* the data chunk's byte length / 4 = sample frames; check-psg.js has
   * already validated the format of every dump it reads */
  let pos = 12, frames = -1;
  while (pos + 8 <= buf.length) {
    const id = buf.slice(pos, pos + 4).toString("latin1");
    const len = buf.readUInt32LE(pos + 4);
    if (id === "data") frames = len / 4;
    pos += 8 + len + (len & 1);
  }
  if (frames < 0) throw new Error("no data chunk");
  return frames;
}

function frameT(trace, k) {
  if (k === 0) return trace.frames.t0;
  const extra = trace.frames.extra;
  if (k <= extra.length) return extra[k - 1];
  return trace.frames.pattern[(k - 1 - extra.length) % trace.frames.pattern.length];
}

function totalSamples(trace, n, factor) {
  let clocks = 0;
  for (let k = 0; k < n; k++) clocks += frameT(trace, k);
  return Math.floor(clocks * factor / TWO32);
}

function solveFrames(trace, L, factor) {
  let lo = 1, hi = Math.floor(L / 700) + 20;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (totalSamples(trace, mid, factor) >= L) hi = mid;
    else lo = mid + 1;
  }
  return totalSamples(trace, lo, factor) === L ? lo : -1;
}

const DUMP_NAMES = fs.readdirSync(DUMPS)
  .filter((d) => /^(psg|wave)/.test(d) &&
                 fs.existsSync(path.join(DUMPS, d, "mednafen.wav")))
  .sort();

const pristine = require(PSG_PATH);

/* Load every recording once: trace, frame count and the pristine PCM the
 * mutant is compared against. */
function loadDumps() {
  return DUMP_NAMES.map((name) => {
    const dir = path.join(DUMPS, name);
    const trace = JSON.parse(fs.readFileSync(path.join(dir, "trace.json"), "utf8"));
    const L = wavFrames(fs.readFileSync(path.join(dir, "mednafen.wav")));
    const n = solveFrames(trace, L, pristine.FACTOR);
    if (n < 0) throw new Error(`${name}: no whole-frame count matches ${L}`);
    return { name, trace, n, pcm: pristine.render(trace.events, trace.frames, n).pcm };
  });
}

let dumps;
try {
  dumps = loadDumps();
} catch (e) {
  console.error(`INPUT-ERROR: ${e.message}`);
  process.exit(2);
}

/* ---- applying a mutation and measuring what it changed ---------------- */

let treeSeq = 0;
const tempDirs = [];
function cleanup() {
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}
process.on("exit", cleanup);

function apply(src, mutation) {
  const n = src.split(mutation.from).length - 1;
  if (n !== 1) return { error: `found ${n} time(s), expected exactly 1` };
  return { src: src.replace(mutation.from, mutation.to) };
}

/* Render every dump with the mutant; return [{name, first, maxdelta}]. */
function measure(mutantSrc) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pce-psg-mut-"));
  tempDirs.push(dir);
  const file = path.join(dir, `mutant-${treeSeq++}.js`);
  fs.writeFileSync(file, mutantSrc);
  const mutant = require(file);
  return dumps.map((d) => {
    const got = mutant.render(d.trace.events, d.trace.frames, d.n).pcm;
    if (got.length !== d.pcm.length)
      return { name: d.name, first: -2, maxdelta: Infinity };
    let first = -1, maxdelta = 0;
    for (let i = 0; i < got.length; i++) {
      if (got[i] !== d.pcm[i]) {
        if (first < 0) first = i;
        const delta = Math.abs(got[i] - d.pcm[i]);
        if (delta > maxdelta) maxdelta = delta;
      }
    }
    return { name: d.name, first, maxdelta };
  });
}

/* ---- one scratch tree, reused per mutation (the checkers regenerate
 * tools/gen deterministically; the dumps are read-only) ------------------ */

function makeTree() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pce-psg-check-"));
  tempDirs.push(tmp);
  fs.mkdirSync(path.join(tmp, "renderer"));
  fs.mkdirSync(path.join(tmp, "tests"));
  fs.mkdirSync(path.join(tmp, "tools", "gen"), { recursive: true });
  fs.copyFileSync(PSG_PATH, path.join(tmp, "renderer", "pce-psg.js"));
  fs.copyFileSync(path.join(ROOT, "renderer", "pce-wave.js"),
                  path.join(tmp, "renderer", "pce-wave.js"));
  fs.copyFileSync(CHECK_PSG_PATH, path.join(tmp, "tests", "check-psg.js"));
  fs.copyFileSync(CHECK_WAVE_PATH, path.join(tmp, "tests", "check-wave.js"));
  for (const f of ["genpsg.py", "genwave.py", "wavesounds.js"])
    fs.copyFileSync(path.join(ROOT, "tools", f), path.join(tmp, "tools", f));
  for (const w of ["wave1", "wave2", "wave3"])
    fs.copyFileSync(path.join(GEN, `${w}.pce`),
                    path.join(tmp, "tools", "gen", `${w}.pce`));
  fs.symlinkSync(DUMPS, path.join(tmp, "tests", "dumps"), "dir");
  return tmp;
}

const TREE = makeTree();
function writeMutant(src) {
  fs.writeFileSync(path.join(TREE, "renderer", "pce-psg.js"), src);
}
function runChecker(script) {
  const r = spawnSync(process.execPath, [path.join(TREE, "tests", script)],
    { cwd: TREE, encoding: "utf8", timeout: 180000 });
  return {
    status: r.status,
    signal: r.signal,
    error: r.error || null,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
  };
}

const SAMPLE_DIFF_RE = /^(\S+): (\d+)st sample differs/gm;
function sampleDiffs(stdout) {
  const out = [];
  let m;
  while ((m = SAMPLE_DIFF_RE.exec(stdout)) !== null)
    out.push({ name: m[1], sample: Number(m[2]) });
  return out;
}
function passed(stdout) { return /^PASS: /m.test(stdout); }

/* ---- judging one mutation --------------------------------------------- */

function judge(mutation, mutantSrc, truth) {
  const changed = truth.filter((t) => t.first >= 0);
  const changedNames = new Set(changed.map((t) => t.name));
  if (truth.some((t) => t.first === -2))
    return { kind: "input-error", detail: "mutant changed the PCM length", truth };

  if (mutation.expect === "noop") {
    if (changed.length > 0)
      return { kind: "no-op", detail: "expected an inert edit but it changed " +
        changed.map((c) => `${c.name}@${c.first}`).join(", "), truth };
    writeMutant(mutantSrc);
    const psg = runChecker("check-psg.js");
    const wave = runChecker("check-wave.js");
    if (psg.status === 0 && wave.status === 0 && passed(psg.stdout) &&
        passed(wave.stdout))
      return { kind: "noop-documented", truth,
        detail: "changed no sample; check-psg.js and check-wave.js both " +
                "PASS on it" };
    return { kind: "unexpected", truth,
      detail: `checkers are not both green (psg ${psg.status}, wave ${wave.status})` };
  }

  if (changed.length === 0)
    return { kind: "no-op", detail: "changed no rendered sample anywhere", truth };

  writeMutant(mutantSrc);
  const designated = mutation.by === "wave"
    ? runChecker("check-wave.js") : runChecker("check-psg.js");
  const other = mutation.by === "wave"
    ? runChecker("check-psg.js") : runChecker("check-wave.js");

  const diffs = sampleDiffs(designated.stdout);
  const hit = diffs.filter((d) => changedNames.has(d.name));
  const otherDiffs = sampleDiffs(other.stdout)
    .filter((d) => changedNames.has(d.name));

  if (designated.error || designated.signal)
    return { kind: "crash", truth,
      detail: `designated checker did not run (${designated.signal || designated.error})` };

  if (designated.status === 0 || diffs.length === 0) {
    return { kind: "missed", truth,
      detail: `the ${mutation.by} checker exited ${designated.status} and ` +
        `reported no sample diff` +
        (otherDiffs.length
          ? `; the other suite caught ${otherDiffs.map((d) => d.name).join(", ")}`
          : "; the other suite missed it too") };
  }

  if (hit.length === 0)
    return { kind: "unexpected", truth,
      detail: `the checker failed on ${diffs.map((d) => d.name).join(", ")}, ` +
        `but the mutation changed ${[...changedNames].join(", ")}` };

  return { kind: "detected", truth, by: mutation.by,
    detail: `${hit[0].name} @ sample ${hit[0].sample} (max delta ` +
      `${changed.find((c) => c.name === hit[0].name).maxdelta})` +
      (otherDiffs.length ? `; the other suite also caught it` : "") };
}

/* ---- output ------------------------------------------------------------ */

const failures = [];
function fail(msg) { failures.push(msg); console.log(`  FAIL  ${msg}`); }
function pass(msg) { console.log(`  ok    ${msg}`); }

function printTruth(truth) {
  const changed = truth.filter((t) => t.first >= 0);
  if (changed.length === 0) return;
  console.log(`        changed: ${changed.map((t) =>
    `${t.name}@${t.first} (max ${t.maxdelta})`).join(", ")}`);
}

console.log(`PSG mutation test — ${dumps.length} recording(s): ` +
  `${dumps.filter((d) => /^psg/.test(d.name)).length} psg, ` +
  `${dumps.filter((d) => /^wave/.test(d.name)).length} wave`);

/* 1. Baseline: the shipped checkers against the shipped model. */
console.log("\nbaseline: shipped checkers, unmodified model");
{
  writeMutant(PSG_SRC);
  const psg = runChecker("check-psg.js");
  const wave = runChecker("check-wave.js");
  if (psg.status === 0 && passed(psg.stdout) &&
      wave.status === 0 && passed(wave.stdout)) {
    pass("check-psg.js and check-wave.js both PASS on the pristine model");
  } else {
    console.log(psg.stdout); console.error(psg.stderr);
    console.log(wave.stdout); console.error(wave.stderr);
    fail(`baseline is not green (psg ${psg.status}, wave ${wave.status})`);
  }
}

/* 2. THE 15 BREAKS + the control: each must land in its required class. */
for (const mutation of MUTATIONS.concat([CONTROL])) {
  console.log(`\n${mutation.id}: ${mutation.what}`);
  const applied = apply(PSG_SRC, mutation);
  if (applied.error) {
    fail(`${mutation.id}: NOT APPLIED — ${applied.error}`);
    continue;
  }
  let result;
  try {
    result = judge(mutation, applied.src, measure(applied.src));
  } catch (e) {
    result = { kind: "input-error", detail: String((e && e.message) || e) };
  }
  printTruth(result.truth);
  if (mutation.note) console.log(`        note: ${mutation.note}`);
  const required = mutation.expect === "noop" ? "noop-documented" : "detected";
  if (result.kind === required) pass(`${mutation.id}: ${result.kind.toUpperCase()} — ${result.detail || ""}`);
  else fail(`${mutation.id}: ${result.kind.toUpperCase()} — ${result.detail || ""}`);
}

/* 3. Self-tests: this script must be able to say no. */
console.log("\nself-test: check-psg.js with the PCM comparison gutted");
{
  /* the blind checker lives beside the real one so its paths resolve */
  fs.writeFileSync(path.join(TREE, "tests", "check-psg-blind.js"), BLIND_PSG_SRC);
  writeMutant(apply(PSG_SRC, MUTATIONS[1]).src);   /* M02 */
  const r = runChecker("check-psg-blind.js");
  if (r.status === 0 && passed(r.stdout))
    pass("M02 was MISSED by the blind checker, not DETECTED");
  else
    fail(`the blind checker did not pass M02 (exit ${r.status}) — the ` +
      `self-test cannot distinguish a real detection`);
}

console.log("\nself-test: a semantically identical substitution");
{
  const applied = apply(PSG_SRC, NOOP_SUBSTITUTION);
  writeMutant(PSG_SRC);
  if (applied.error) fail(`NO-OP substitution NOT APPLIED — ${applied.error}`);
  else {
    const result = judge(NOOP_SUBSTITUTION, applied.src, measure(applied.src));
    if (result.kind === "noop-documented")
      pass("reported NO-OP (changed nothing), not DETECTED");
    else fail(`reported ${result.kind.toUpperCase()} (expected NO-OP)`);
  }
}

/* The fixture-coverage assertions must be live, not dead code.  Two trees
 * over a copy of dumps/psg8: one loses R3's bit 11 from the trace, one is
 * paired with psg1's 440 Hz WAV. */
console.log("\nself-test: fixture coverage — psg8 no longer reaches R3 bit 11");
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pce-psg-cov-"));
  tempDirs.push(tmp);
  fs.mkdirSync(path.join(tmp, "renderer"));
  fs.mkdirSync(path.join(tmp, "tests", "dumps"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "tools", "gen"), { recursive: true });
  fs.copyFileSync(PSG_PATH, path.join(tmp, "renderer", "pce-psg.js"));
  fs.copyFileSync(CHECK_PSG_PATH, path.join(tmp, "tests", "check-psg.js"));
  const genSrc = fs.readFileSync(path.join(ROOT, "tools", "genpsg.py"), "utf8");
  const doctored = genSrc.replace("psg(3, 0x08)", "psg(3, 0x00)");
  if (doctored === genSrc) fail("could not doctor psg8's R3 write");
  fs.writeFileSync(path.join(tmp, "tools", "genpsg.py"), doctored);
  fs.cpSync(path.join(DUMPS, "psg8"), path.join(tmp, "tests", "dumps", "psg8"),
            { recursive: true });
  const run = () => spawnSync(process.execPath,
    [path.join(tmp, "tests", "check-psg.js")],
    { cwd: tmp, encoding: "utf8", timeout: 120000 });
  run();   /* generates the doctored trace; the first run fails provenance */
  fs.copyFileSync(path.join(tmp, "tools", "gen", "psg8.trace.json"),
                  path.join(tmp, "tests", "dumps", "psg8", "trace.json"));
  const r = run();
  if (r.status !== 0 && /FIXTURE NO LONGER COVERS ITS STATE/.test(r.stdout) &&
      /no R3 write sets bit 11/.test(r.stdout))
    pass("the doctored psg8 trace was refused by name");
  else
    fail(`a psg8 with no R3 bit 11 was not refused (exit ${r.status})`);
}

console.log("\nself-test: fixture coverage — psg8 paired with a 440 Hz WAV");
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pce-psg-cov-"));
  tempDirs.push(tmp);
  fs.mkdirSync(path.join(tmp, "renderer"));
  fs.mkdirSync(path.join(tmp, "tests", "dumps"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "tools", "gen"), { recursive: true });
  fs.copyFileSync(PSG_PATH, path.join(tmp, "renderer", "pce-psg.js"));
  fs.copyFileSync(CHECK_PSG_PATH, path.join(tmp, "tests", "check-psg.js"));
  fs.copyFileSync(path.join(ROOT, "tools", "genpsg.py"),
                  path.join(tmp, "tools", "genpsg.py"));
  fs.cpSync(path.join(DUMPS, "psg8"), path.join(tmp, "tests", "dumps", "psg8"),
            { recursive: true });
  fs.copyFileSync(path.join(DUMPS, "psg1", "mednafen.wav"),
                  path.join(tmp, "tests", "dumps", "psg8", "mednafen.wav"));
  const r = spawnSync(process.execPath,
    [path.join(tmp, "tests", "check-psg.js")],
    { cwd: tmp, encoding: "utf8", timeout: 120000 });
  if (r.status !== 0 &&
      /pitch 440\.\d+ Hz, not the ~48\.\d+ Hz/.test(r.stdout))
    pass("the 440 Hz recording was refused (psg8's stated sound)");
  else
    fail(`psg8 with a 440 Hz WAV was not refused (exit ${r.status})`);
}

cleanup();
console.log("");
if (failures.length === 0) {
  console.log("PASS: REVIEW-34's 15 breaks are all DETECTED (M10 by " +
    "check-wave.js/wave3, the rest by check-psg.js), the control and the " +
    "identical substitution are NO-OP, and the blind checker and the " +
    "fixture-coverage self-tests all said no.");
  process.exitCode = 0;
} else {
  console.log(`FAIL: ${failures.length} check(s) did not hold`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
