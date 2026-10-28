#!/usr/bin/env node
/*
 * tests/check-python-builder.js — the Python builder and the browser builder
 * agree on the region counts no committed fixture reaches (card #60).
 *
 * Why this exists: docs/REVIEW-46.md's breaker (89a9ba5) broke the two ROM
 * builders 20 ways. G11 (`MAX_REGIONS` 13 -> 8) and G16 (13 -> 255) both ran
 * every existing suite green: tests/check-export.js compares
 * renderer/pce-rom.js against a COMMITTED tools/gen/*.pce, and the largest
 * committed picture (scene10) has 2 copy regions, so tools/genviewer.py's
 * 13-descriptor cap is exercised in neither direction. REVIEW-46's probes on
 * a 9-region and a 14-region scene1 showed the two builders disagreeing.
 *
 * What it does: builds the SAME synthetic pictures with both paths and
 * requires the same outcome —
 *
 *   nine      9 regions x 16 chars   both build, byte-equal (G11's witness:
 *                                    a cap of 8 refuses this picture)
 *   thirteen  13 regions x 16 chars  both build, byte-equal (the cap's upper
 *                                    edge is accepted, not just "not 8")
 *   fourteen  14 regions x 16 chars  both refuse, for the descriptor count
 *                                    (G16's witness: a removed cap builds)
 *   largest   13 regions x 2048 chars both build, byte-equal, 108 banks
 *                                    (the biggest picture the config can
 *                                    describe; G15's evidence, below)
 *
 * The Python path is the real one: a scratch copy of the tree with
 * tests/dumps/scene1/{vram.bin,cram.bin,regs.json}, a regions.json for the
 * fixture, `python3 -I genviewer.py 1`, then PCEAS 3.23 `-raw` on the
 * generated .asm.  The browser path is renderer/pce-rom.js with the same
 * data and renderer/viewer-bank0.bin.  The two ROMs are compared byte for
 * byte.  Nothing in tools/ or renderer/ is edited.
 *
 * G15 (`PCEAS_MAX_BANKS` 128 -> 256) stays a NO-OP, and this check does not
 * try to detect it.  The largest legal picture is 13 descriptors x 32768
 * VRAM words = 851,968 B of tiles = 104 tile banks -> 108 ROM banks, which
 * is below the guard's 128 for every legal input, so the Python builder's
 * bank-ceiling branch cannot fire and raising it changes no observable
 * behaviour.  The `largest` case measures the 108-bank ceiling through both
 * builders; the run prints the reason.  The guard becomes reachable only if
 * the config ever holds 16+ descriptors (16 x 2048 chars = 128 tile banks =
 * 132 ROM banks > 128) — the choice #58 must make.  See REVIEW-46.md
 * residual weakness 3.
 *
 * Results, each meaning exactly one thing:
 *   exit 0 PASS            every one of the four pictures had the same
 *                          outcome through both builders.
 *   exit 1 FAIL            a disagreement (a refusal mismatch naming G11 or
 *                          G16, differing bytes, or an unclassified
 *                          failure), or the comparator's self-test failed
 *                          (then no PASS below it would mean anything).
 *   exit 2 NOT RUN         python3 or pceas could not be started, the scene1
 *                          dump is incomplete, or the scratch tree could not
 *                          be made.  The check did not measure anything; this
 *                          is not a pass and not a builder disagreement.
 *
 *   node tests/check-python-builder.js
 *
 * WHAT THIS DOES NOT PROVE:
 *   - Only these four synthetic region lists, made from scene1's VRAM/CRAM/
 *     registers, are compared.  Agreement on them is not agreement on every
 *     picture: other BAT sizes, region shapes, overlapping destinations and
 *     the sprite scenes' SG regions are not exercised here.
 *   - It builds genviewer.py in a scratch tree, not `make -C tools` against
 *     the committed fixtures; a stale committed tools/gen/*.asm or *.pce is
 *     tests/check-export.js's business, not this check's.
 *   - Byte equality says the two builders agree, not that the ROM is right:
 *     whether the bytes show the picture on a console is tests/check-viewer.js
 *     (a Mednafen capture), and neither is a HuCard on hardware.
 *   - The Python refusal is classified as the descriptor cap because the same
 *     data builds with 13 regions and refuses with 14 (only the count
 *     differs).  The two builders' messages are NOT identical — genviewer.py
 *     raises AssertionError with the region list, pce-rom.js throws "14
 *     regions, the config block holds 13" — so this check compares outcomes
 *     and the stated count, not message text.
 *   - It depends on PCEAS 3.23 being installed (docs/BUILD.md); without it the
 *     check exits 2 and has proven nothing.
 *   - The 109-127-bank range still has no fixture, because no legal picture
 *     reaches it (REVIEW-46 residual weakness 2).
 */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const rom = require("../renderer/pce-rom.js");

const ROOT = path.join(__dirname, "..");
const TOOLS = path.join(ROOT, "tools");
const SCENE1 = path.join(__dirname, "dumps", "scene1");
const BANK0 = path.join(ROOT, "renderer", "viewer-bank0.bin");
const PYTHON = process.env.PYTHON || "python3";
const PCEAS = process.env.PCEAS || "pceas";
const BANK = rom.BANK;

/* exit 2: the check did not run.  Never let this read as PASS or FAIL. */
function notRun(message) {
  console.error(`NOT RUN: ${message}`);
  return 2;
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/* The picture the browser builder is given, from the real scene1 dump. */
function scene1Picture(regions) {
  return {
    bank0: new Uint8Array(fs.readFileSync(BANK0)),
    vram: new Uint8Array(fs.readFileSync(path.join(SCENE1, "vram.bin"))),
    cram: new Uint8Array(fs.readFileSync(path.join(SCENE1, "cram.bin"))),
    regs: JSON.parse(fs.readFileSync(path.join(SCENE1, "regs.json"), "utf8")),
    regions,
  };
}

/* The browser builder's outcome for a picture: a ROM, or the refusal. */
function jsBuild(regions) {
  try {
    return { ok: true, bytes: rom.buildRom(scene1Picture(regions)) };
  } catch (err) {
    return { ok: false, error: err };
  }
}

/* A scratch tree genviewer.py can build in: it derives the dump directory
 * from its own location (<tools>/../tests/dumps/sceneN) and writes <tools>/gen.
 * The dump is scene1's data with this fixture's regions.json. */
function makeSandbox(regions, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pce60-${label}-`));
  const tools = path.join(dir, "tools");
  const dump = path.join(dir, "tests", "dumps", "scene1");
  fs.mkdirSync(tools, { recursive: true });
  fs.mkdirSync(dump, { recursive: true });
  fs.copyFileSync(path.join(TOOLS, "genviewer.py"),
                  path.join(tools, "genviewer.py"));
  fs.copyFileSync(path.join(TOOLS, "viewer.asm"),
                  path.join(tools, "viewer.asm"));
  for (const name of ["vram.bin", "cram.bin", "regs.json"])
    fs.copyFileSync(path.join(SCENE1, name), path.join(dump, name));
  fs.writeFileSync(path.join(dump, "regions.json"), JSON.stringify({
    comment: `check-python-builder.js fixture (${label})`,
    tile_regions: regions,
  }, null, 1) + "\n");
  return { dir, tools, asm: path.join(tools, "gen", "viewer1.asm"),
           pce: path.join(tools, "gen", "viewer1.pce") };
}

function pythonBuild(sandbox) {
  const r = spawnSync(PYTHON, ["-I", "genviewer.py", "1"],
                      { cwd: sandbox.tools, encoding: "utf8" });
  if (r.error) return { ran: false, error: r.error };
  return { ran: true, ok: r.status === 0, status: r.status,
           stdout: r.stdout || "", stderr: r.stderr || "" };
}

function assemble(sandbox) {
  const r = spawnSync(PCEAS, ["-raw", "-o", "gen/viewer1.pce",
                              "gen/viewer1.asm"],
                      { cwd: sandbox.tools, encoding: "utf8" });
  if (r.error) return { ran: false, error: r.error };
  return { ran: true, ok: r.status === 0, status: r.status,
           stdout: r.stdout || "", stderr: r.stderr || "" };
}

/* Byte comparison.  Returns null on equality, or a sentence naming the size
 * or the first differing byte.  A difference in bank 0 means the committed
 * code-bank asset (used by pce-rom.js) is stale against the current
 * tools/viewer.asm; that is a different fault from a data-layout mismatch,
 * so it is named as such. */
function compare(got, ref) {
  if (got.length !== ref.length)
    return `SIZE ${got.length} bytes vs PCEAS ${ref.length} bytes`;
  let diffs = 0, first = -1;
  for (let i = 0; i < got.length; i++) {
    if (got[i] !== ref[i]) {
      diffs++;
      if (first < 0) first = i;
    }
  }
  if (diffs === 0) return null;
  const where = first < BANK
    ? " (in bank 0, the code bank: renderer/viewer-bank0.bin is stale against " +
      "tools/viewer.asm — rebuild with make -C tools bank0)"
    : "";
  return `${diffs} differing bytes of ${ref.length}; first at ` +
         `0x${first.toString(16)} (browser 0x${got[first].toString(16).padStart(2, "0")}, ` +
         `PCEAS 0x${ref[first].toString(16).padStart(2, "0")})${where}`;
}

/* The comparator must be able to say "different" before its "equal" counts.
 * Pure in-memory: no second mutant tree needed for this part. */
function selfTest() {
  const a = new Uint8Array([1, 2, 3, 4]);
  if (compare(a, a.slice()) !== null)
    return "the comparator reports a difference between identical bytes";
  const b = a.slice();
  b[2] = 9;
  const changed = compare(b, a);
  if (!changed || !/1 differing byte/.test(changed) || !/0x2\b/.test(changed))
    return `the comparator did not name a changed byte: ${changed}`;
  const short = compare(a.slice(0, 3), a);
  if (!short || !/SIZE 3 bytes/.test(short))
    return `the comparator did not report a size difference: ${short}`;
  return null;
}

/* A non-zero genviewer.py exit means the descriptor cap only if it is the
 * `assert len(regions) <= MAX_REGIONS` failure.  A crash for any other reason
 * (a missing file, a bad register, an import error) must NOT be reported as
 * "the cap is too low" — different cause, different fix. */
function pyRefusal(py, count) {
  if (!/AssertionError/.test(py.stderr)) return "other";
  const tuples = (py.stderr.match(/\(\d+, \d+\)/g) || []).length;
  if (/MAX_REGIONS/.test(py.stderr) || tuples === count) return "descriptor";
  return "other";
}

/* Build one picture through both paths and require the same outcome.
 * Returns null on agreement, or a sentence for the FAIL count; on a
 * successful build the sandbox carries the ROM length (romLength). */
function agree(label, regions, expect, sandboxes) {
  const sandbox = makeSandbox(regions, label);
  sandboxes.push(sandbox);
  const py = pythonBuild(sandbox);
  if (!py.ran)
    throw new Error(`could not start ${PYTHON}: ${py.error.message}`);

  if (expect === "refuse") {
    /* Python: the builder must refuse, before writing an .asm. */
    if (py.ok)
      return `${label}: genviewer.py BUILT a ${regions.length}-region ` +
             `picture the browser builder refuses — the Python descriptor ` +
             `cap is too high or gone (G16)`;
    if (fs.existsSync(sandbox.asm))
      return `${label}: genviewer.py failed but wrote gen/viewer1.asm anyway`;
    if (pyRefusal(py, regions.length) !== "descriptor")
      return `${label}: genviewer.py refused for a reason this check cannot ` +
             `classify as the descriptor cap: ` +
             `${py.stderr.trim().split("\n").slice(-1)[0]}`;

    /* Browser: the same refusal, from the descriptor count. */
    const js = jsBuild(regions);
    if (js.ok)
      return `${label}: pce-rom.js BUILT a ${regions.length}-region picture`;
    const m = /^pce-rom: (\d+) regions, the config block holds (\d+)$/
      .exec(js.error.message);
    if (!m || Number(m[1]) !== regions.length)
      return `${label}: pce-rom.js refused for another reason: ` +
             `${js.error.message}`;
    const cap = Number(m[2]);
    if (cap !== regions.length - 1)
      return `${label}: pce-rom.js holds ${cap} descriptors, so this fixture ` +
             `is not the cap's first refusal (expected ${regions.length - 1})`;

    console.log(`${label}: both refuse at the descriptor cap — genviewer.py: ` +
                `AssertionError (${regions.length} regions); pce-rom.js: ` +
                `"${js.error.message}"`);
    return null;
  }

  /* expect === "build": both build, and the ROMs are byte-equal. */
  if (!py.ok) {
    const last = py.stderr.trim().split("\n").slice(-1)[0];
    if (pyRefusal(py, regions.length) !== "descriptor")
      return `${label}: genviewer.py failed for a reason this check cannot ` +
             `classify as the descriptor cap (not a G11 witness): ${last}`;
    return `${label}: genviewer.py REFUSED a ${regions.length}-region ` +
           `picture the browser builder builds — the Python descriptor cap ` +
           `is too low (G11): ${last}`;
  }
  const as = assemble(sandbox);
  if (!as.ran)
    throw new Error(`could not start ${PCEAS}: ${as.error.message}`);
  if (!as.ok)
    return `${label}: PCEAS failed on genviewer.py's output: ` +
           `${(as.stderr || as.stdout).trim().split("\n").slice(-1)[0]}`;
  const js = jsBuild(regions);
  if (!js.ok)
    return `${label}: pce-rom.js refused a ${regions.length}-region picture ` +
           `genviewer.py builds: ${js.error.message}`;
  const ref = new Uint8Array(fs.readFileSync(sandbox.pce));
  const problem = compare(js.bytes, ref);
  if (problem) return `${label}: the builders disagree — ${problem}`;
  sandbox.romLength = ref.length;
  console.log(`${label}: both build byte-equal — ${ref.length} bytes, ` +
              `sha256 ${sha256(ref).slice(0, 16)}…, ` +
              `${regions.length} regions` +
              (label === "largest" ? " x 2048 chars (the layout's ceiling)" : ""));
  return null;
}

function main() {
  for (const [name, file] of [["python3", PYTHON], ["pceas", PCEAS]]) {
    const r = spawnSync(file, name === "python3" ? ["-I", "-c", "pass"] : [],
                        { encoding: "utf8" });
    if (r.error && r.error.code === "ENOENT")
      return notRun(`${name} is not on PATH (docs/BUILD.md); nothing was ` +
                    `built or compared`);
  }
  for (const name of ["vram.bin", "cram.bin", "regs.json"])
    if (!fs.existsSync(path.join(SCENE1, name)))
      return notRun(`tests/dumps/scene1/${name} is missing`);
  if (!fs.existsSync(BANK0))
    return notRun(`renderer/viewer-bank0.bin is missing (make -C tools bank0)`);

  const st = selfTest();
  if (st) {
    console.log(`SELF-TEST FAILED: ${st}`);
    console.log(`FAIL: the byte comparison cannot report a difference, so a ` +
                `PASS below would mean nothing`);
    return 1;
  }
  console.log(`self-test: the comparison reports a changed byte and a size ` +
              `change, and passes identical bytes`);

  const sandboxes = [];
  const problems = [];
  /* Print each case's disagreement as it happens, so the log reads in case
   * order even when an earlier case fails. */
  function report(problem) {
    if (!problem) return false;
    console.log(problem);
    problems.push(problem);
    return true;
  }
  try {
    /* 9 regions: genviewer.py's pre-#46 cap (8) refuses what pce-rom.js
     * builds — REVIEW-46's G11. */
    const nine = Array.from({ length: 9 }, (_, i) => [i * 16, 16]);
    report(agree("nine", nine, "build", sandboxes));

    /* 13 regions: the cap's upper edge is accepted by both — a lowered cap
     * fails here even if 9 still passes. */
    const thirteen = Array.from({ length: 13 }, (_, i) => [i * 16, 16]);
    report(agree("thirteen", thirteen, "build", sandboxes));

    /* 14 regions: genviewer.py must refuse, and so must pce-rom.js — G16. */
    const fourteen = Array.from({ length: 14 }, (_, i) => [i * 16, 16]);
    report(agree("fourteen", fourteen, "refuse", sandboxes));

    /* The largest picture the 13-descriptor config can describe: 13 x 2048
     * chars = 851,968 B of tiles = 104 tile banks = 108 ROM banks.  Both
     * build it byte-equal, and it never reaches genviewer.py's 128-bank
     * guard — G15's NO-OP, measured. */
    const largest = Array.from({ length: 13 }, () => [0, 2048]);
    const biggest = sandboxes.length;
    if (!report(agree("largest", largest, "build", sandboxes))) {
      const got = sandboxes[biggest].romLength;
      if (got !== 108 * BANK)
        report(`largest: the ceiling built ${got} bytes, not 108 banks ` +
               `(${108 * BANK} B) — G15's arithmetic below assumed 13 x ` +
               `32768-word regions`);
    }
  } catch (err) {
    return notRun(err.message);
  } finally {
    for (const s of sandboxes)
      fs.rmSync(s.dir, { recursive: true, force: true });
  }

  if (problems.length) {
    console.log(`FAIL: ${problems.length} builder disagreement(s)`);
    return 1;
  }

  console.log(`G15 stays NO-OP, by measurement: the largest legal picture ` +
              `(13 x 2048 chars) is 104 tile banks + 4 = 108 ROM banks < 128, ` +
              `so genviewer.py's PCEAS_MAX_BANKS guard cannot fire for any ` +
              `legal input and 128 -> 256 changes nothing observable.  It ` +
              `becomes reachable only with 16+ descriptors (132 banks), ` +
              `which is #58's layout decision; this check does not detect ` +
              `G15 (REVIEW-46.md residual weakness 3).`);
  console.log(`PASS: genviewer.py and renderer/pce-rom.js agree on 9, 13 and ` +
              `14 small regions and on the 108-bank ceiling — both build ` +
              `byte-equal or both refuse at the descriptor cap`);
  return 0;
}

process.exitCode = main();
