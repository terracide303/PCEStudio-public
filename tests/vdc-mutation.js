#!/usr/bin/env node
/*
 * tests/vdc-mutation.js — card #76.
 *
 * docs/REVIEW-48-50.md (50a179d) broke the window/DMA/status/wide-mode
 * renderer 16 ways and the checks caught 12.  The four it MISSED were not
 * wrong code that slipped through a bad check: they were code whose only
 * differing input no capture carried.  #76 added the captures; this script
 * asks whether the checks now see the breaks REVIEW-48-50 named.
 *
 *   D06  pce-vram.js   SI/D and DI/D exchanged in decodeDcr — caught by
 *                      check-dma.js on dma4 (SI/D alone, $14) and dma5
 *                      (DI/D alone, $18);
 *   S09  pce-sprites.js  OR at `requested >= 16` instead of `> 16` — caught
 *                      by check-status.js on sprite14 (exactly 16 strips);
 *   S10  pce-sprites.js  collision counts every covered column, not only
 *                      non-zero pixels — caught by check-status.js on
 *                      sprite16 (a transparent sprite over sprite 0);
 *   M16  pce-bg.js     dot clock `cr & 3` instead of `(cr & 2) ? 2 : (cr & 1)`
 *                      — caught by check.js on wide512b (VCE CR $07).
 *
 * Each break is applied to a throwaway copy of renderer/, one at a time; the
 * real renderer and the real checks are never modified.  The checks run in
 * that tree with a symlink to tests/dumps.
 *
 * The result classes are separated, and none may stand in for another:
 *
 *   DETECTED     the check named the fixture with the defect's own problem
 *                (D06: a word/counter mismatch on dma4 and dma5; S09: the
 *                model's OR true where the raw-byte oracle says false AND
 *                the saved status $00; S10: the same for CC on sprite16;
 *                M16: wide512b no longer reports diff 0).  Everything else
 *                is a failure, however red the run looks.
 *   MISSED       the same mutant against a dumps tree with the fixture
 *                REMOVED leaves the check green on it.  This is not a
 *                self-test decoration: it is the measurement that the new
 *                capture is what closes the gap — before #76 every one of
 *                these four breaks was in exactly this state.
 *   NO-OP        the mutation changed nothing the model can observe (a
 *                behaviourally identical edit, measured by running both
 *                modules side by side).  Treating that as DETECTED would be
 *                a lie; it is required to be reported as NO-OP.
 *   CRASH        the check exited non-zero without the fixture's own problem
 *                lines (a thrown error looks like a failure and proves
 *                nothing about the comparison).
 *   NOT APPLIED  the source line the mutation edits was not found exactly
 *                once — fails loudly instead of silently testing nothing.
 *   UNEXPECTED   the baseline does not show the fixture green, so the run
 *                cannot be read either way.
 *   INPUT-ERROR  a dump or module could not be read.
 *
 * The baseline checks are NOT all green in this tree and the script says so
 * rather than hiding it: tests/dumps/toypalette (#31 part A, another card)
 * fails check.js and check-status.js on HEAD.  Every verdict here is about
 * the named fixture's own lines, never about the exit code alone — which is
 * also why "the check exited 1" cannot be counted as detection.
 *
 *   node tests/vdc-mutation.js
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const TESTS = __dirname;
const ROOT = path.join(TESTS, "..");
const DUMPS = path.join(TESTS, "dumps");
const RENDERER_DIR = path.join(ROOT, "renderer");

const CHECKERS = ["check.js", "check-dma.js", "check-status.js",
                  "check-raster.js"];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/* ---- the four breaks, one source edit each ------------------------------ */

const MUTATIONS = [
  {
    id: "D06",
    what: "DMA decrement flags swapped (SI/D read from bit 3, DI/D bit 2)",
    file: "pce-vram.js",
    checker: "check-dma.js",
    fixtures: ["dma4", "dma5"],
    from:
      "      siDec: !!(dcr & 0x04), /* bit 2: SI/D, source decrements */\n" +
      "      diDec: !!(dcr & 0x08), /* bit 3: DI/D, destination decrements */",
    to:
      "      siDec: !!(dcr & 0x08), /* bit 2: SI/D, source decrements */\n" +
      "      diDec: !!(dcr & 0x04), /* bit 3: DI/D, destination decrements */",
    /* behaviour, measured: runDma on each new descriptor differs */
    measure(mod) {
      const base = fs.readFileSync(path.join(DUMPS, "scene4", "vram.bin"));
      const out = [];
      for (const n of this.fixtures) {
        const dma = JSON.parse(
          fs.readFileSync(path.join(DUMPS, n, "dma.json"), "utf8"));
        const r = mod.runDma(base, dma);
        let words = 0;
        for (let w = 0; w < r.vram.length / 2; w++) {
          const a = r.vram[w * 2] | (r.vram[w * 2 + 1] << 8);
          const b = base[w * 2] | (base[w * 2 + 1] << 8);
          if (a !== b) words++;
        }
        out.push({ name: n, sour: r.sour, desr: r.desr, words });
      }
      return out;
    },
    changed: (a, b) => a.some((x, i) =>
      x.sour !== b[i].sour || x.desr !== b[i].desr || x.words !== b[i].words),
    /* what the check must print: a real mismatch on BOTH new captures */
    detected(stdout) {
      const problems = [];
      for (const n of this.fixtures) {
        const line = new RegExp(`^${n}: .*(word\\(s\\) differ|SOUR ends|` +
                                `DESR ends|LENR ends)`, "m").test(stdout);
        if (!line) problems.push(`no mismatch line for ${n}`);
      }
      return problems;
    }
  },
  {
    id: "S09",
    what: "OR set at 16 strips instead of 17 (`requested > 16` -> `>= 16`)",
    file: "pce-sprites.js",
    checker: "check-status.js",
    fixtures: ["sprite14"],
    from: "      overflow: c.requested > 16,",
    to: "      overflow: c.requested >= 16,",
    measure(mod) {
      const d = loadDump("sprite14");
      return [mod.lineStatus(d.vram, d.sat, 2, 256).overflow];
    },
    changed: (a, b) => a[0] !== b[0],
    detected(stdout) {
      const problems = [];
      if (!/^FAIL\s+sprite14:/m.test(stdout))
        problems.push("check-status did not fail sprite14");
      if (!/row \d+ \(VDW line \d+\) OR: model true, oracle false/.test(stdout))
        problems.push("the model's OR is not reported true against the oracle");
      /* The saved status (Mednafen's own witness, compared inside
       * compareMednafen) is a second problem on the same dump; the check
       * prints at most 10 problems per dump and the oracle rows fill the
       * list first, so this harness does not require that line.  The
       * fixture's saved status is asserted by name in check-status itself. */
      return problems;
    }
  },
  {
    id: "S10",
    what: "CC counts every covered column, not only non-zero pixels",
    file: "pce-sprites.js",
    checker: "check-status.js",
    fixtures: ["sprite16"],
    from: "        if (stripPixel(words, s.hflip, x)) mask[dx] = 1;",
    to: "        mask[dx] = 1;",
    measure(mod) {
      const d = loadDump("sprite16");
      return [mod.lineStatus(d.vram, d.sat, 2, 256).collision];
    },
    changed: (a, b) => a[0] !== b[0],
    detected(stdout) {
      const problems = [];
      if (!/^FAIL\s+sprite16:/m.test(stdout))
        problems.push("check-status did not fail sprite16");
      if (!/row \d+ \(VDW line \d+\) CC: model true, oracle false/.test(stdout))
        problems.push("the model's CC is not reported true against the oracle");
      /* see S09: the saved status is compared inside the check but its line
       * can fall past the 10-problem print cap */
      return problems;
    }
  },
  {
    id: "M16",
    what: "DCC code 11 given its own clock index (`cr & 3`)",
    file: "pce-bg.js",
    checker: "check.js",
    fixtures: ["wide512b"],
    from: "    return (cr & 2) ? 2 : (cr & 1);",
    to: "    return cr & 3;",
    measure(mod) {
      return [mod.frameWidth({ regs: { VCECR: 7 } })];
    },
    changed: (a, b) => a[0] !== b[0],
    detected(stdout) {
      const problems = [];
      if (/^wide512b: OK /m.test(stdout))
        problems.push("check.js still reports wide512b diff 0");
      if (!/^wide512b: /m.test(stdout))
        problems.push("check.js does not name wide512b at all");
      return problems;
    }
  },
];

/* The NO-OP self-test: a semantically identical edit must not be counted as
 * detected, or a mutation harness with a dead measurement would look green. */
const NOOP = {
  id: "NO-OP",
  file: "pce-vram.js",
  from: "    dcr = dcr & 0x1F;",
  to: "    dcr = (dcr & 0x1F) | 0;",
  measure(mod) {
    return [mod.decodeDcr(0x1F)];
  },
  changed: (a, b) => JSON.stringify(a) !== JSON.stringify(b)
};

/* ---- dumps ------------------------------------------------------------- */

function loadDump(name) {
  const dir = path.join(DUMPS, name);
  const regs = JSON.parse(fs.readFileSync(path.join(dir, "regs.json"), "utf8"));
  return {
    vram: fs.readFileSync(path.join(dir, "vram.bin")),
    sat: fs.readFileSync(path.join(dir, "sat.bin")),
    regs
  };
}

/* A dumps directory that is every real dump except the named ones, as
 * symlinks.  Removing the fixture is how this script proves the capture is
 * what makes the break visible, instead of asserting it. */
function dumpsWithout(names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pce76-dumps-"));
  for (const n of fs.readdirSync(DUMPS)) {
    if (names.indexOf(n) >= 0) continue;
    fs.symlinkSync(path.join(DUMPS, n), path.join(dir, n), "dir");
  }
  return dir;
}

/* ---- running a check against a mutated renderer ------------------------ */

let seq = 0;
const scratchDirs = [];

/* Build a tree: renderer/ = copies with `mutation` applied, tests/ = the
 * checkers, tests/dumps = the given dump tree.  Returns the check output. */
function runCheck(mutation, checker, dumpsDir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pce76-run-"));
  scratchDirs.push(tmp);
  fs.mkdirSync(path.join(tmp, "renderer"));
  fs.mkdirSync(path.join(tmp, "tests"));
  for (const f of fs.readdirSync(RENDERER_DIR)) {
    if (!f.endsWith(".js")) continue;
    let src = fs.readFileSync(path.join(RENDERER_DIR, f), "utf8");
    if (f === mutation.file) src = mutation.source;
    fs.writeFileSync(path.join(tmp, "renderer", f), src);
  }
  for (const c of CHECKERS) {
    fs.copyFileSync(path.join(TESTS, c), path.join(tmp, "tests", c));
  }
  fs.symlinkSync(dumpsDir, path.join(tmp, "tests", "dumps"), "dir");
  const r = spawnSync(process.execPath,
    [path.join(tmp, "tests", checker)],
    { encoding: "utf8", timeout: 180000 });
  return {
    status: r.status, signal: r.signal, error: r.error || null,
    stdout: r.stdout || "", stderr: r.stderr || ""
  };
}

/* Load a module (the real one, or the mutated copy) from a unique path so
 * both can coexist in this process. */
function loadModule(file, source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pce76-mod-"));
  scratchDirs.push(dir);
  for (const f of fs.readdirSync(RENDERER_DIR)) {
    if (!f.endsWith(".js")) continue;
    let src = fs.readFileSync(path.join(RENDERER_DIR, f), "utf8");
    if (f === file) src = source;
    fs.writeFileSync(path.join(dir, f), src);
  }
  return require(path.join(dir, file));
}

function cleanup() {
  for (const d of scratchDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
  }
}
process.on("exit", cleanup);

/* ---- verdicts ---------------------------------------------------------- */

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function applySource(mutation) {
  const src = read(path.join("renderer", mutation.file));
  const n = count(src, mutation.from);
  if (n !== 1) return { error: `source line found ${n} time(s), expected 1` };
  return { source: src.replace(mutation.from, mutation.to) };
}

/* The fixture's baseline state: green, and green in a way this script can
 * name (so a check that silently skipped it cannot pass for green). */
function baselineGreen(m, run) {
  if (m.id === "M16") return /^wide512b: OK \(512x232, diff 0\)$/m.test(run.stdout);
  if (m.id === "D06")
    return m.fixtures.every((n) => new RegExp(`^${n}: OK \\(`, "m").test(run.stdout));
  /* check-status prints a problem only on failure; the fixture's name must
   * appear nowhere in a green run (the notes list only the first three
   * dumps, and the fixtures are not among them) */
  return m.fixtures.every((n) => count(run.stdout, n) === 0);
}

function judgeMutations() {
  const results = [];
  for (const m of MUTATIONS) {
    const applied = applySource(m);
    const rec = { id: m.id, what: m.what, class: "", detail: "" };
    if (applied.error) {
      rec.class = "NOT APPLIED"; rec.detail = applied.error;
      results.push(rec); continue;
    }
    let pristine, mutant;
    try {
      pristine = loadModule(m.file, read(path.join("renderer", m.file)));
      mutant = loadModule(m.file, applied.source);
    } catch (e) {
      rec.class = "INPUT-ERROR"; rec.detail = `module did not load: ${e.message}`;
      results.push(rec); continue;
    }
    const before = m.measure(pristine), after = m.measure(mutant);
    if (!m.changed(before, after)) {
      rec.class = "NO-OP";
      rec.detail = `mutation changed nothing observable (${JSON.stringify(before)})`;
      results.push(rec); continue;
    }
    m.source = applied.source;

    /* the baseline: the check green on the fixture before the break */
    const baseRun = runCheck({ file: "__none__" }, m.checker, DUMPS);
    if (!baselineGreen(m, baseRun)) {
      rec.class = "UNEXPECTED";
      rec.detail = "the baseline does not show the fixture green";
      results.push(rec); continue;
    }

    /* DETECTED: with the fixture in place */
    const withRun = runCheck(m, m.checker, DUMPS);
    if (withRun.error || withRun.signal) {
      rec.class = "CRASH";
      rec.detail = `check did not run: ${withRun.signal || withRun.error}`;
      results.push(rec); continue;
    }
    const withProblems = m.detected(withRun.stdout);
    if (withProblems.length) {
      rec.class = "CRASH";
      rec.detail = withProblems.join("; ") +
        ` (exit ${withRun.status})`;
      results.push(rec); continue;
    }

    /* MISSED without the fixture — the gap the card closes, measured */
    const bare = dumpsWithout(m.fixtures);
    scratchDirs.push(bare);
    const withoutRun = runCheck(m, m.checker, bare);
    if (withoutRun.error || withoutRun.signal) {
      rec.class = "CRASH";
      rec.detail = `check did not run without the fixture: ` +
                   `${withoutRun.signal || withoutRun.error}`;
      results.push(rec); continue;
    }
    const still = m.detected(withoutRun.stdout);
    if (still.length === 0) {
      rec.class = "CRASH";
      rec.detail = "the check reports the break even without the fixture — " +
                   "the fixture is not the witness";
      results.push(rec); continue;
    }

    rec.class = "DETECTED";
    rec.detail = `fixture ${m.fixtures.join("+")}: caught with it, MISSED ` +
                 `without it (${m.file} ${m.id})`;
    results.push(rec);
  }
  return results;
}

function judgeNoop() {
  const applied = applySource(NOOP);
  if (applied.error)
    return { class: "NOT APPLIED", detail: applied.error };
  const pristine = loadModule(NOOP.file, read(path.join("renderer", NOOP.file)));
  const mutant = loadModule(NOOP.file, applied.source);
  const changed = NOOP.changed(NOOP.measure(pristine), NOOP.measure(mutant));
  return changed
    ? { class: "CRASH", detail: "an identical edit changed the decode" }
    : { class: "NO-OP", detail: "identical edit: nothing observable changed" };
}

/* ---- main -------------------------------------------------------------- */

function main() {
  if (!fs.existsSync(DUMPS)) {
    console.error(`no dumps in ${DUMPS}`);
    return 2;
  }
  /* every fixture must exist, or every verdict below is meaningless */
  const missing = [];
  for (const m of MUTATIONS)
    for (const f of m.fixtures)
      if (!fs.existsSync(path.join(DUMPS, f, "regs.json"))) missing.push(f);
  if (missing.length) {
    console.error(`INPUT-ERROR: missing dump(s) ${missing.join(", ")} — run ` +
                  `tools/capture.sh first`);
    return 2;
  }
  /* the source lines must be there exactly once before anything runs */
  for (const m of [...MUTATIONS, NOOP]) {
    const src = read(path.join("renderer", m.file));
    if (count(src, m.from) !== 1) {
      console.error(`NOT APPLIED: ${m.id}: expected exactly 1 occurrence of ` +
                    `${JSON.stringify(m.from)} in renderer/${m.file}, found ` +
                    count(src, m.from));
      return 2;
    }
  }

  const results = judgeMutations();
  const noop = judgeNoop();
  let failed = 0;
  for (const r of results) {
    const ok = r.class === "DETECTED";
    if (!ok) failed++;
    console.log(`${ok ? "DETECTED " : r.class.padEnd(10)}${r.id}: ${r.what}` +
                (ok ? "" : `\n           ${r.detail}`));
  }
  console.log(`${noop.class === "NO-OP" ? "NO-OP     " : noop.class.padEnd(10)}` +
              `self-test: ${noop.detail}`);
  if (noop.class !== "NO-OP") failed++;

  const detected = results.filter((r) => r.class === "DETECTED").length;
  if (failed) {
    console.log(`FAIL: ${detected}/${results.length} of REVIEW-48-50's ` +
                `missed breaks are DETECTED`);
    return 1;
  }
  console.log(`PASS: ${detected}/${results.length} of REVIEW-48-50's missed ` +
              `breaks are DETECTED — and each is MISSED again when its new ` +
              `capture is removed, so the captures are the witness`);
  return 0;
}

process.exitCode = main();
