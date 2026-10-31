#!/usr/bin/env node
/*
 * tests/raster-mutation.js — card #43.
 *
 * REVIEW-15 (docs/REVIEW-15.md) ran a breaker against the #15 renderer and
 * scored 20 breaks: 16 DETECTED, 3 MISSED on the raster captures, 1 NO-OP.
 * The three misses are the ones whose effects no raster capture could show:
 *
 *   M6  the frame-start BXR latch taken from raster.base instead of the
 *       previous frame's last write — r2/r9's tables cover every captured
 *       line, so no captured row ever reads the latch
 *   M16 vdwLine0 hard-wired to 1 — every raster capture had vdwLine0 = 1
 *       arithmetically, so hard-wiring changed nothing
 *   M19 sprite pixels decoded through the flat CRAM table — no raster
 *       capture had sprites under per-line colour writes
 *
 * and the one NO-OP, which the review called correctly:
 *
 *   M17 the 9-bit wrap mask on bgY removed — aliased by the BAT mask (below)
 *
 * #43 closes those gaps with five new captures on structured tiles, where the
 * effects are visible to a person and not buried in noise (tests/dumps/):
 *
 *   raster6   the two-step BYR split on diagonal seven-colour bands
 *   raster7   per-line writes to the two solid regions (two full-screen
 *             staircases, CRAM[0x000] ramping up and CRAM[0x007] down)
 *   raster8   the BXR wobble, but the chain starts at line 50: the first
 *             49 captured rows (VCE lines 18..66) display the previous
 *             frame's last write (wobble(182) = 45), not raster.base 0 —
 *             the M6 witness
 *   raster9   the wobble captured with SLSTART=6 so vdwLine0 = 3 — the M16
 *             witness (hard-wiring 1 lands every entry two rows off)
 *   raster10  two solid sprites whose every pixel is sprite colour 1
 *             (CRAM[0x101]), which the chain ramps per line — the M19
 *             witness
 *
 * This script re-runs the three misses (semantically equivalent mutations of
 * the current renderer, one source replacement each) and the no-op, and asks
 * what renderer-mutation.js asks: DOES CHECK.JS ACTUALLY FAIL WHEN THE
 * RASTER RENDERER IS BROKEN?  Each mutant is written to a throwaway
 * directory with a copy of check.js and a symlink to tests/dumps, so check.js
 * is exercised exactly as shipped; ground truth is computed here by
 * rendering every dump with the pristine and mutated modules side by side.
 *
 * Result classes (as in renderer-mutation.js):
 *
 *   DETECTED     check.js exited 1 and reported, for every dump whose pixels
 *                the mutation changed, exactly the measured byte count (and
 *                diff 0 for the dumps it did not change).
 *   MISSED       check.js exited 0 although the mutant's output differs from
 *                the reference.
 *   CRASH        check.js exited non-zero without the per-scene diff report.
 *   NO-OP        the mutation changed no rendered byte; reported as such
 *                (the suite fails — every M6/M16/M19 mutation must land in
 *                DETECTED).
 *   noop-documented  M17's class: the mutation changed no rendered byte AND
 *                the real check.js is green on it.  A checker cannot be asked
 *                to catch a break that changes nothing; the honest result is
 *                the review's own: NO-OP, with the aliasing reason below.
 *   NOT APPLIED  the source line the mutation edits was not found exactly once.
 *   UNEXPECTED   check.js behaved in a way neither detection nor a clean pass
 *                (e.g. a checker bug on a no-op).
 *   INPUT-ERROR  a dump could not be read or rendered.
 *
 * M17's aliasing (why no capture can show it): bgY is consumed only as
 * `(bgY >> 3) & geom.hmask` (hmask = 31/63 for the 32/64-row BATs) and
 * `bgY & 7` — and 512 ≡ 0 mod 64 and mod 8, so a bgY one wrap above 0x1FF
 * fetches the same BAT row, tile row and pixel.  The 9-bit mask on bgY is
 * redundant with the BAT mask on every dump; removing it changes nothing.
 *
 * The script also tests ITSELF:
 *   - a copy of check.js with the pixel comparison gutted must be reported
 *     MISSED for M6/M16/M19, not DETECTED;
 *   - a semantically identical mutation must be reported NO-OP.
 *
 * Exit code 0 only when the baseline is diff 0 on every dump, M6 changes
 * exactly {raster8}, M16 exactly {raster9}, M19 exactly {raster10} — each
 * DETECTED with check.js reporting the measured counts — M17 is
 * noop-documented, and both self-tests hold.  Run:
 *   node tests/raster-mutation.js
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const TESTS = __dirname;
const ROOT = path.join(TESTS, "..");
const CHECK_PATH = path.join(TESTS, "check.js");
const BG_PATH = path.join(ROOT, "renderer", "pce-bg.js");
const SPRITES_PATH = path.join(ROOT, "renderer", "pce-sprites.js");
const DUMPS = path.join(TESTS, "dumps");

const CHECK_SRC = fs.readFileSync(CHECK_PATH, "utf8");
const BG_SRC = fs.readFileSync(BG_PATH, "utf8");
const SPRITES_SRC = fs.readFileSync(SPRITES_PATH, "utf8");

/* The four REVIEW-15 breaks, with the result class each is required to land
 * in.  `detected` means on the real captures; `noop-documented` is M17.  The
 * source replacements are semantically equivalent to the breaker's edits,
 * written against the current renderer (the breaker's tree is ddbe106); the
 * exact-once assertions below fail loudly if a refactor moves them. */
const MUTATIONS = [
  {
    id: "M6",
    target: "bg",
    what: "frame-start BXR latch from raster.base instead of the previous " +
      "frame's last write",
    from: "    var curBxr = lastBxr != null ? lastBxr\n" +
          "        : (base.bxr != null ? base.bxr & 0x3FF : regs.BXR & 0x3FF);",
    to: "    var curBxr = (base.bxr != null ? base.bxr & 0x3FF : regs.BXR & 0x3FF);",
    expect: "detected",
    note: "caught on raster8: its table starts at line 50, so rows 0..48 " +
      "(49 rows) display the previous frame's last write (wobble(182) = 45, " +
      "a 45-px BXR scroll) where the mutant latches base 0 — every pixel of " +
      "the latch band changes (measured 12544 px = 49 x 256).  r2/r9's " +
      "tables cover every captured line, so their latch is never read — " +
      "unchanged.",
  },
  {
    id: "M16",
    target: "bg",
    what: "vdwLine0 hard-wired to 1 (the raster path's scanline calibration)",
    from: "    var vdwLine0 = regs.RCRCount - regs.scanline + firstScanline;",
    to: "    var vdwLine0 = 1;",
    expect: "detected",
    note: "caught on raster9: captured with SLSTART=6 SLEND=237, so " +
      "vdwLine0 = 3 there (every other raster capture is arithmetically 1).  " +
      "Hard-wiring 1 applies every table entry two rows late.  This is the " +
      "buildRows copy — renderer-mutation.js's vdw1 targets the " +
      "renderIndices copy (scene5b); the two copies are written so the " +
      "source lines stay unique per harness.",
  },
  {
    id: "M17",
    target: "bg",
    what: "the 9-bit wrap mask on bgY removed",
    from: "      bgY[r] = (curByrV + (L - curByrN) + (curByrN === 0 ? 0 : 1)) & 0x1FF;",
    to: "      bgY[r] = (curByrV + (L - curByrN) + (curByrN === 0 ? 0 : 1));",
    expect: "noop-documented",
    note: "REVIEW-15's NO-OP, kept as such: bgY is consumed only as " +
      "(bgY >> 3) & hmask (31/63) and bgY & 7, and 512 ≡ 0 mod 64 and mod 8, " +
      "so the 9-bit wrap is aliased by the BAT mask on every dump — no " +
      "capture can show this break, and the checker is not asked to catch " +
      "a break that changes nothing.",
  },
  {
    id: "M19",
    target: "sprites",
    what: "sprite pixels decoded through the flat CRAM table",
    from: "        px[o0 + x * 3] = rgb[ci * 3];\n" +
          "        px[o0 + x * 3 + 1] = rgb[ci * 3 + 1];\n" +
          "        px[o0 + x * 3 + 2] = rgb[ci * 3 + 2];",
    to: "        var sprgb = ci > 0x100 ? flatRgb : rgb;\n" +
        "        px[o0 + x * 3] = sprgb[ci * 3];\n" +
        "        px[o0 + x * 3 + 1] = sprgb[ci * 3 + 1];\n" +
        "        px[o0 + x * 3 + 2] = sprgb[ci * 3 + 2];",
    expect: "detected",
    note: "caught on raster10: its sprites' every visible pixel is sprite " +
      "colour 1 (CRAM[0x101]), which the chain ramps per line — decoded flat, " +
      "both sprite bodies lose their per-line gradient.  Sprite pixels are " +
      "exactly the indices > 0x100 (0x100 + pal*16 + colour, colour >= 1 — " +
      "colour 0 is transparent and never drawn); the BB blanking fill (0x100) " +
      "is the bg module's pixel, not a sprite pixel, and keeps the per-line " +
      "table.  Every other sprite capture has no raster table (rows is null) " +
      "or no per-line colour writes (rows.rgb == flatRgb), so nothing else " +
      "changes.",
  },
];

/* A semantically identical substitution: must be reported NO-OP.  lastBxr is
 * null or a number (the table loop only assigns numbers), so `!= null` and
 * `!== null` pick the same branch everywhere. */
const NOOP_MUTATION = {
  id: "no-op self-test",
  target: "bg",
  what: "semantically identical substitution must be reported NO-OP",
  from: "    var curBxr = lastBxr != null ? lastBxr\n" +
        "        : (base.bxr != null ? base.bxr & 0x3FF : regs.BXR & 0x3FF);",
  to: "    var curBxr = lastBxr !== null ? lastBxr\n" +
        "        : (base.bxr != null ? base.bxr & 0x3FF : regs.BXR & 0x3FF);",
  expect: "detected",
};

/* A checker that has had its eyes removed: still prints OK, still exits 0. */
const BLIND_CHECK_SRC = CHECK_SRC.replace(
  "if (got.pixels[i] !== ref.pixels[i]) {",
  "if (false) {"
);

/* Every picture dump except the ones check.js skips by name.  The names are
 * read from check.js's own NOT_PICTURES in CHECK_SRC — the same source the
 * throwaway trees run — so a toy capture added there (#81's toypalette, #83's
 * toyparallax) cannot silently stay in this script's universe and make the
 * baseline red for a reason that is not the renderer.  Rendering all the
 * others is what turns "the mutation changed raster8" into "the mutation
 * changed exactly raster8".  If the declaration cannot be read, this script
 * refuses rather than guessing. */
const NOT_PICTURES = (() => {
  const body = /const NOT_PICTURES = \{([\s\S]*?)\n\};/.exec(CHECK_SRC);
  if (!body) {
    console.error("ERROR: check.js's NOT_PICTURES declaration not found");
    process.exit(2);
  }
  /* The keys are either bare identifiers or quoted: #108's palette-huc,
   * toypalette-ilvm and friends carry hyphens, so a bare [A-Za-z0-9_]+
   * pattern would read "palette-huc" as no name and leave the dump in this
   * script's universe, turning the baseline red for a non-renderer reason. */
  return new Set([...body[1].matchAll(
    /^\s{2}(?:"([A-Za-z0-9_-]+)"|([A-Za-z0-9_-]+)):/gm)]
    .map((m) => m[1] || m[2]));
})();
if (NOT_PICTURES.size === 0) {
  console.error("ERROR: check.js's NOT_PICTURES parsed to no names");
  process.exit(2);
}
const DUMP_NAMES = fs.readdirSync(DUMPS)
  .filter((d) => fs.existsSync(path.join(DUMPS, d, "mednafen.png")))
  .filter((d) => !NOT_PICTURES.has(d))
  .sort();

/* If a source line is refactored these substitutions silently become
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
for (const m of [...MUTATIONS, NOOP_MUTATION]) {
  requireOneOccurrence(
    m.target === "bg" ? BG_SRC : SPRITES_SRC,
    m.from, `mutation ${m.id} source line`);
}
if (DUMP_NAMES.length === 0) {
  console.error(`ERROR: no picture dumps with mednafen.png in ${DUMPS}`);
  process.exit(2);
}

/* #175: a dump name may carry a hyphen (tableops-ilvm); \w does not. */
const OK_RE = /^([\w-]+): OK \((\d+)x(\d+), diff 0\)$/gm;
const DIFF_RE = /^([\w-]+): (\d+) differing pixels of (\d+) bytes$/gm;
const DISAGREE_RE = /^([\w-]+): sprites renderer disagrees with bg renderer on a sprite-free dump$/gm;
const RASTER_ERR_RE = /^([\w-]+): raster\.json does not match the save state:$/gm;
/* #28: a tree that carries the flicker capture adds " and N flicker
 * capture(s)" to the summary; the count and the FAIL line are unchanged. */
const PASS_RE = /^PASS: renderer matches Mednafen pixel for pixel on (\d+) scene\(s\)(?: and \d+ flicker capture\(s\))?$/m;
const FAIL_RE = /^FAIL: (\d+) scene\(s\) differ$/m;

/* ---- renderer loading ---------------------------------------------------- */

/* Write a bg + sprites pair into a uniquely named temp directory and require
 * them, so a mutant and the real renderer coexist in one process without
 * require cache collisions (pce-sprites.js resolves ./pce-bg in its own
 * directory, so the pair is loaded as one tree). */
let treeSeq = 0;
const tempDirs = [];
function loadTree(bgSource, spritesSource) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pce-rast-"));
  tempDirs.push(dir);
  const tag = `tree-${treeSeq++}`;
  const bgFile = path.join(dir, `${tag}-pce-bg.js`);
  const spritesFile = path.join(dir, `${tag}-pce-sprites.js`);
  fs.writeFileSync(bgFile, bgSource);
  /* the sprites module's require("./pce-bg.js") resolves next to ITS file,
   * so the pair is self-contained per tree */
  fs.writeFileSync(spritesFile, spritesSource.replace('require("./pce-bg.js")',
    `require("./${tag}-pce-bg.js")`));
  return {
    bg: require(bgFile),
    sprites: require(spritesFile),
  };
}

function cleanup() {
  for (const dir of tempDirs) {
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

function framesEqual(a, b) {
  if (a.pixels.length !== b.pixels.length) return false;
  for (let i = 0; i < a.pixels.length; i++) {
    if (a.pixels[i] !== b.pixels[i]) return false;
  }
  return true;
}

/* One dump, loaded the way check.js loads it (minus its own raster.json
 * verification, which is about the save state, not the renderer). */
function loadDump(name) {
  const dir = path.join(DUMPS, name);
  const vram = fs.readFileSync(path.join(dir, "vram.bin"));
  const cram = fs.readFileSync(path.join(dir, "cram.bin"));
  const regs = JSON.parse(fs.readFileSync(path.join(dir, "regs.json"), "utf8"));
  const satPath = path.join(dir, "sat.bin");
  const hasSat = fs.existsSync(satPath);
  const rasterPath = path.join(dir, "raster.json");
  const opts = {
    vram, cram, regs,
    width: 256, height: 232,
    firstScanline: 14 + (regs.slstart != null ? regs.slstart : 4),
    raster: fs.existsSync(rasterPath)
      ? JSON.parse(fs.readFileSync(rasterPath, "utf8")) : null,
  };
  return {
    name,
    opts,
    sat: hasSat ? fs.readFileSync(satPath) : null,
  };
}

/* The frame check.js compares against mednafen.png for this dump: the
 * sprites renderer where sat.bin marks the #12-style scene, else the bg
 * renderer. */
function renderDump(tree, dump) {
  const opts = dump.opts;
  if (dump.sat) {
    return tree.sprites.renderFrame(Object.assign({ sat: dump.sat }, opts));
  }
  return tree.bg.renderFrame(opts);
}

/* ---- running a copy of check.js against a given renderer tree ------------ */

function runCheck(bgSource, spritesSource, checkerSource) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pce-check-"));
  try {
    fs.mkdirSync(path.join(tmp, "renderer"));
    fs.mkdirSync(path.join(tmp, "tests"));
    fs.writeFileSync(path.join(tmp, "renderer", "pce-bg.js"), bgSource);
    fs.writeFileSync(path.join(tmp, "renderer", "pce-sprites.js"), spritesSource);
    /* #28: check.js also requires pce-flicker.js when it loads; without it
     * every run looks like a CRASH with no per-dump report. */
    fs.copyFileSync(path.join(ROOT, "renderer", "pce-flicker.js"),
                    path.join(tmp, "renderer", "pce-flicker.js"));
    /* #16 moved the raster-table check out of check.js into the shared
     * tests/check-raster.js; check.js requires it from its own directory, so
     * a copy without it throws on load and every run looks like a CRASH. */
    fs.copyFileSync(path.join(TESTS, "check-raster.js"),
                    path.join(tmp, "tests", "check-raster.js"));
    fs.writeFileSync(path.join(tmp, "tests", "check.js"), checkerSource);
    /* check.js resolves dumps from its own directory; symlink avoids copying
     * megabytes per mutant (fall back to a copy where symlinks are
     * unavailable). */
    const dest = path.join(tmp, "tests", "dumps");
    try {
      fs.symlinkSync(DUMPS, dest, "dir");
    } catch (_) {
      fs.cpSync(DUMPS, dest, { recursive: true });
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
  const disagrees = [];
  for (const m of stdout.matchAll(DISAGREE_RE)) disagrees.push(m[1]);
  const rasterErrors = [];
  for (const m of stdout.matchAll(RASTER_ERR_RE)) rasterErrors.push(m[1]);
  return {
    ok,
    diffs,
    disagrees,
    rasterErrors,
    pass: PASS_RE.exec(stdout),
    fail: FAIL_RE.exec(stdout),
    scenesReported: new Set([...ok.keys(), ...diffs.keys()]),
  };
}

/* ---- one scenario: mutate the renderer, judge check.js ------------------- */

function applyMutation(mutation) {
  const src = mutation.target === "bg" ? BG_SRC : SPRITES_SRC;
  const occurrences = src.split(mutation.from).length - 1;
  if (occurrences !== 1) {
    return { error: `source line found ${occurrences} time(s), expected exactly 1` };
  }
  const mutated = src.replace(mutation.from, mutation.to);
  return {
    bgSource: mutation.target === "bg" ? mutated : BG_SRC,
    spritesSource: mutation.target === "sprites" ? mutated : SPRITES_SRC,
  };
}

function evaluate(mutation, checkerSource) {
  const applied = applyMutation(mutation);
  if (applied.error) {
    return { kind: "not-applied", detail: applied.error, scenes: [] };
  }

  /* Ground truth: what the mutation actually changed, measured here. */
  const pristine = loadTree(BG_SRC, SPRITES_SRC);
  const mutant = loadTree(applied.bgSource, applied.spritesSource);
  const truth = DUMP_NAMES.map((name) => {
    const dump = loadDump(name);
    const ref = renderDump(pristine, dump);
    const got = renderDump(mutant, dump);
    if (!dump.sat) {
      /* check.js's regression net: on a sprite-free dump the mutated sprites
       * module must agree with the mutated bg module, or the checker reports
       * a "disagrees" error instead of a diff line. */
      const viaSprites = mutant.sprites.renderFrame(dump.opts);
      if (!framesEqual(viaSprites, got)) {
        return { name, error: "mutant sprites render disagrees with the " +
          "mutant bg render on a sprite-free dump" };
      }
    }
    const changed = compareFrames(ref, got);
    return { name, changedBytes: changed.bytes, changedPixels: changed.pixels };
  });
  const broken = truth.find((t) => t.error);
  if (broken) {
    return { kind: "crash", detail: broken.error, scenes: truth };
  }
  const changedAny = truth.some((t) => t.changedBytes > 0);

  if (mutation.expect === "noop-documented") {
    /* M17: the mutation must change nothing AND the real checker must be
     * green on it — the review's NO-OP, reproduced. */
    if (changedAny) {
      return {
        kind: "no-op",
        detail: "expected a no-op (the wrap is aliased by the BAT mask) " +
                "but the mutation changed rendered bytes",
        scenes: truth,
      };
    }
    const run = runCheck(applied.bgSource, applied.spritesSource, CHECK_SRC);
    const report = parseReport(run.stdout);
    const clean = run.status === 0 && !!report.pass &&
      truth.every((t) => report.ok.has(t.name)) &&
      report.scenesReported.size === truth.length;
    if (clean) {
      return {
        kind: "noop-documented",
        detail: "changed no rendered byte and check.js is diff 0 on the " +
                "mutant (exit 0) — the checker is not asked to catch a " +
                "break that changes nothing",
        scenes: truth,
      };
    }
    return {
      kind: "unexpected",
      detail: `check.js is not green on the no-op mutant (exit ${run.status})`,
      scenes: truth,
      run,
      report,
    };
  }

  if (!changedAny) {
    return { kind: "no-op", detail: "mutation changed no rendered byte", scenes: truth };
  }

  const run = runCheck(applied.bgSource, applied.spritesSource, checkerSource);
  const report = parseReport(run.stdout);

  if (run.error || run.signal) {
    return { kind: "crash", detail: `did not run: ${run.signal || run.error}`, scenes: truth, run };
  }
  if (run.status === 0) {
    /* The dangerous one: a broken renderer and a green check. */
    return {
      kind: "missed",
      detail: "check.js exited 0",
      scenes: truth,
      run,
      report,
    };
  }

  /* Non-zero exit.  It counts as detection only if the report matches ground
   * truth dump by dump: every changed dump reports exactly the byte count
   * measured above, every unchanged dump reports diff 0, and no side
   * channel (the sprites-regression net, the raster.json check) explains the
   * failure instead. */
  const problems = [];
  for (const t of truth) {
    if (t.changedBytes > 0) {
      const d = report.diffs.get(t.name);
      if (!d) problems.push(`${t.name}: renderer changed ${t.changedBytes} bytes but check.js reported no diff`);
      else if (d.pixels !== t.changedBytes)
        problems.push(`${t.name}: check.js reported ${d.pixels} differing bytes, measured ${t.changedBytes}`);
    } else if (!report.ok.has(t.name)) {
      problems.push(`${t.name}: renderer unchanged but check.js did not report diff 0`);
    }
  }
  if (!report.fail) problems.push("no FAIL summary line");
  if (report.disagrees.length > 0)
    problems.push(`sprites-regression net fired on: ${report.disagrees.join(", ")}`);
  if (report.rasterErrors.length > 0)
    problems.push(`raster.json verification failed on: ${report.rasterErrors.join(", ")}`);
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
  const changed = result.scenes.filter((t) => t.changedBytes > 0);
  for (const t of changed) {
    const reported = result.report && result.report.diffs.get(t.name);
    const shown = reported ? `${reported.pixels} differing bytes reported`
                           : "no report";
    console.log(`        ${t.name}: measured ${t.changedBytes} differing bytes / ` +
                `${t.changedPixels} pixels, ${shown}`);
  }
  if (changed.length > 0 && result.scenes.length > changed.length) {
    console.log(`        (${result.scenes.length - changed.length} other ` +
                `dump(s) unchanged)`);
  }
  if (result.detail && result.kind !== "detected") console.log(`        ${result.detail}`);
}

console.log(`raster mutation test — ${DUMP_NAMES.length} dump(s)`);

/* 1. Baseline: the shipped check.js against the shipped renderer. */
console.log("\nbaseline: tests/check.js, unmodified renderer");
{
  const run = spawnSync(process.execPath, [CHECK_PATH], { encoding: "utf8", timeout: 120000 });
  const report = parseReport(run.stdout || "");
  const all = DUMP_NAMES.every((n) => report.ok.has(n)) &&
    report.scenesReported.size === DUMP_NAMES.length;
  if (run.status === 0 && report.pass && all) {
    pass(`diff 0 on all ${DUMP_NAMES.length} dumps`);
  } else {
    console.log(run.stdout || "");
    console.error(run.stderr || "");
    fail(`baseline is not a clean pass (status ${run.status})`);
  }
}

/* 2. The four breaks: each must land in its expected class. */
for (const mutation of MUTATIONS) {
  console.log(`\nmutation ${mutation.id}: ${mutation.what}`);
  const result = evaluateSafely(mutation, CHECK_SRC);
  printScenes(result);
  if (mutation.expect === "noop-documented") {
    if (result.kind === "noop-documented") {
      pass(`${mutation.id}: NO-OP — ${result.detail}`);
    } else {
      fail(`${mutation.id}: ${result.kind.toUpperCase()} — ${result.detail || ""}`);
    }
  } else if (result.kind === "detected") {
    pass(`${mutation.id}: DETECTED — ${result.detail}`);
  } else {
    fail(`${mutation.id}: ${result.kind.toUpperCase()} — ${result.detail || ""}`);
  }
  if (mutation.note) console.log(`        note: ${mutation.note}`);
}

/* 3. Self-tests: this script must be able to say no. */
console.log("\nself-test: a checker with the pixel comparison gutted");
for (const mutation of MUTATIONS.filter((m) => m.expect === "detected")) {
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
  console.log("PASS: M6/M16/M19 are DETECTED with exactly the measured diffs " +
              "(raster8 / raster9 / raster10), M17 is NO-OP with check.js " +
              "green on it, and both self-tests hold");
  process.exitCode = 0;
} else {
  console.log(`FAIL: ${failures.length} check(s) did not hold`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
