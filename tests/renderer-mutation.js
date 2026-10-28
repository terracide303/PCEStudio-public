#!/usr/bin/env node
/*
 * tests/renderer-mutation.js — cards #6 and #39.
 *
 * tests/check.js says the renderer matches Mednafen pixel for pixel.  This
 * script asks the only question that makes that sentence worth anything:
 * DOES THE DIFF TEST ACTUALLY FAIL WHEN THE RENDERER IS BROKEN?
 *
 * #6 did that for the two defects the card named.  #39 extends it to the ten
 * breaks #11's cold read listed (docs/REVIEW.md finding 1): one deliberate
 * source mutation per break, each required to be DETECTED — check.js must
 * fail and report, scene by scene, exactly the byte count the mutation
 * changed, and diff 0 for the scenes it did not change.  The scenes that
 * make each break visible are #39's captures (tests/dumps/scene4-9, 8b, 8c;
 * see tools/genroms.py — each BAT is NOT periodic in the dimension the
 * break cuts).
 *
 *   wmask31     BAT column mask forced to 31              -> scenes 2-5, 7
 *   widths64    BAT width table [32,64,64,64]             -> scenes 3, 5, 7
 *   height32    BAT height always 32 (MWR bit 6 ignored)  -> scenes 6, 7
 *   strideCode3 BAT row stride for SCREEN code 3 = 8      -> scenes 5, 7
 *   ch800       the ch >= 0x800 rule removed              -> synthetic witness
 *   bxr8/bxr9   BXR masked to 8 / 9 bits                  -> scenes 3-5, 7
 *   byr8        BYR masked to 8 bits                      -> scene 6
 *   vdw1        vdwLine0 hard-wired to 1                  -> scene5b (shifted crop)
 *   cr0         CR ignored (the picture drawn for CR-off) -> scenes 8, 8b, 8c
 *   green3      green channel (v>>6)&7 -> &3              -> every picture
 *
 * One of the ten cannot be caught by the standard captures, and this script
 * says so instead of pretending:
 *
 *   ch800 — every real dump's VRAM is 32768 words (Mednafen's state size),
 *           so a read at ch >= 0x800 is out of bounds and returns 0 exactly
 *           like the rule; scene9 measured the VDC dropping those writes and
 *           reading colour 0 (odd BAT columns all CRAM[0x000]).  The mutant
 *           is therefore DETECTED on a synthetic 65536-word dump whose tiles
 *           at words 0x8000+ hold real data (built here; the reference PNG
 *           is the shipped renderer's frame, so the test is "does check.js
 *           catch the mutant", not "is the rule right" — the rule's truth is
 *           scene9's capture).
 *
 * vdw1 is caught on scene5b: captured with the crop shifted two lines down
 * (slstart 6, slend 237), so captured row 0 is VCE line 20 and vdwLine0 =
 * RCRCount - (scanline - 20) = 3.  Hard-wiring 1 shifts the picture two rows
 * and check.js fails it.  On the standard crop vdwLine0 is arithmetically 1
 * for every save made during VDW (RCRCount = scanline - 17 there), so the
 * standard captures alone could not catch this break — that is why scene5b
 * exists.  (The sleep time cannot change the save scanline: measured 254 for
 * sleeps 8.5..9.5 s.)
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
 *                the reference.  This is the defect #39 exists to catch.
 *   CRASH        check.js exited non-zero without the per-scene diff report a
 *                detection needs (a thrown error looks like a failure but
 *                proves nothing about the comparison).
 *   NO-OP        the mutation changed no rendered byte.  A checker cannot be
 *                asked to catch a break that changes nothing, and treating
 *                "unchanged" as "detected" would be a lie.  Reported, failed
 *                — every mutation here is required to land in DETECTED.
 *   NOT APPLIED  the source line the mutation edits was not found exactly once.
 *   UNEXPECTED   check.js exited 0 with output that is not a clean pass (so
 *                the baseline cannot be trusted either).
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
 *     be reported MISSED for real mutations, not DETECTED;
 *   - a semantically identical mutation must be reported NO-OP, not DETECTED.
 *
 * Exit code 0 only when the baseline is diff 0 and every one of the ten
 * breaks is DETECTED except the two documented above (ch800 on the synthetic
 * witness dump, vdw1 NO-OP for the reason given).  Run:
 *   node tests/renderer-mutation.js
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { spawnSync } = require("child_process");

const TESTS = __dirname;
const ROOT = path.join(TESTS, "..");
const CHECK_PATH = path.join(TESTS, "check.js");
const RENDERER_PATH = path.join(ROOT, "renderer", "pce-bg.js");
const DUMPS = path.join(TESTS, "dumps");

const CHECK_SRC = fs.readFileSync(CHECK_PATH, "utf8");
const RENDERER_SRC = fs.readFileSync(RENDERER_PATH, "utf8");

/* The CR block is a multi-line mutation source (cr0 removes it whole — the
 * comment, the per-row BB gate and the loop opening; cr0's `to` re-adds the
 * loop opening so the mutant still parses). */
const CR_BLOCK = `    /* CR bit 7 = BB (background blanking): when it is clear the VDC clears
     * the background and every pixel shows the blanking-period video data —
     * SPBG = 1, VD7..VD0 = 0, i.e. the 9-bit colour index 0x100, CRAM[0x100]
     * (sprite colour 0).  VDC manual, CR R05 p. H7-5, 2.3.6 p. H7-18.
     * Measured on tests/dumps/scene8, scene8b and scene8c (a full picture in
     * VRAM, BB clear, burst mode or not, DCR set or clear): 59392/59392
     * pixels are CRAM[0x100] = 0x049 = 36,36,36; us1's white frame is its
     * CRAM[0x100] = 0x1FF, the same rule.  With a raster table CR is latched
     * per line: each row is gated on its own CR (SB/BB become valid from the
     * next horizontal display period), so the gate below runs per row for
     * every dump — there is no separate whole-frame fill. */
    for (var r = 0; r < height; r++) {
      var crRow = rows ? rows.cr[r] : regs.CR;
      if (!(crRow & 0x80)) {
        /* BB clear on this line: the blanking fill, whole row */
        for (var x = 0; x < width; x++) {
          idx[r * width + x] = 0x100;
        }
        continue;
      }
`;

/* The ten breaks, in docs/REVIEW.md finding 1's order, with the result class
 * each is required to land in.  `detected` means on the real captures;
 * `detected-synthetic` is ch800; `noop-documented` is vdw1. */
const MUTATIONS = [
  {
    id: "wmask31",
    what: "BAT column mask forced to 31 (every BAT 32 columns)",
    /* #26 moved the per-pixel decode into pce-bg.js's backgroundPixel (so
     * the panels read the same decode); the mask is still this one line. */
    from: "(((bgX + x) >> 3) & geom.wmask) |",
    to: "(((bgX + x) >> 3) & 31) |",
    expect: "detected",
  },
  {
    id: "widths64",
    what: "BAT width table [32, 64, 64, 64] (128 drawn as 64)",
    from: "var widths = [32, 64, 128, 128];",
    to: "var widths = [32, 64, 64, 64];",
    expect: "detected",
  },
  {
    id: "height32",
    what: "BAT height always 32 (MWR bit 6 ignored)",
    from: "var h = (mwr & 0x40) ? 64 : 32;",
    to: "var h = 32;",
    expect: "detected",
  },
  {
    id: "strideCode3",
    what: "BAT row stride for SCREEN code 3 = 8 (the #38 break)",
    from: "var shifts = [5, 6, 7, 7];",
    to: "var shifts = [5, 6, 7, 8];",
    expect: "detected",
  },
  {
    id: "ch800",
    what: "the ch >= 0x800 rule removed (reads past VRAM are tile 0)",
    from: "if (ch >= 0x800) {",
    to: "if (false) {",
    expect: "detected-synthetic",
  },
  {
    id: "bxr8",
    what: "BXR masked to 8 bits",
    from: "var bxr = regs.BXR & 0x3FF;",
    to: "var bxr = regs.BXR & 0xFF;",
    expect: "detected",
  },
  {
    id: "bxr9",
    what: "BXR masked to 9 bits",
    from: "var bxr = regs.BXR & 0x3FF;",
    to: "var bxr = regs.BXR & 0x1FF;",
    expect: "detected",
  },
  {
    id: "byr8",
    what: "BYR masked to 8 bits",
    from: "var byr = regs.BYR & 0x1FF;",
    to: "var byr = regs.BYR & 0xFF;",
    expect: "detected",
  },
  {
    id: "vdw1",
    what: "vdwLine0 hard-wired to 1 (the scanline calibration ignored)",
    from: "var vdwLine0 = regs.RCRCount - (regs.scanline - firstScanline);",
    to: "var vdwLine0 = 1;",
    expect: "detected",
    note: "caught on scene5b (crop shifted 2 lines: vdwLine0 = 3 there, " +
      "hard-wiring 1 shifts the picture two rows).  On the standard crop " +
      "vdwLine0 is arithmetically 1 for every VDW-phase save (RCRCount = " +
      "scanline - 17), so no other capture can show this break.",
  },
  {
    id: "cr0",
    what: "the CR BB gate removed (a CR-off picture drawn as a picture)",
    from: CR_BLOCK,
    to: "    for (var r = 0; r < height; r++) {",
    expect: "detected",
  },
  {
    id: "green3",
    what: "green channel (v>>6)&7 -> &3 (the break #6 already caught)",
    from: "table[i * 3 + 1] = 36 * ((v >> 6) & 7);",
    to: "table[i * 3 + 1] = 36 * ((v >> 6) & 3);",
    expect: "detected",
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

/* The scene dumps.  Other captures in dumps/ (viewerN, browserN, usN,
 * painted) are other cards' evidence: check.js checks them too, but this
 * mutation test only knows the sceneN pictures, and its parsers read
 * `sceneN:` lines. */
const SCENES = fs.readdirSync(DUMPS)
  .filter((d) => /^scene/.test(d))
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
  const regs = JSON.parse(fs.readFileSync(path.join(dir, "regs.json"), "utf8"));
  return {
    vram: fs.readFileSync(path.join(dir, "vram.bin")),
    cram: fs.readFileSync(path.join(dir, "cram.bin")),
    regs,
    width: 256,
    height: 232,
    /* same crop convention as check.js: captured row 0 = VCE line
     * 14 + slstart */
    firstScanline: 14 + (regs.slstart != null ? regs.slstart : 4),
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

function runCheck(rendererSource, checkerSource, dumpsDir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pce-check-"));
  try {
    fs.mkdirSync(path.join(tmp, "renderer"));
    fs.mkdirSync(path.join(tmp, "tests"));
    fs.writeFileSync(path.join(tmp, "renderer", "pce-bg.js"), rendererSource);
    /* check.js also requires pce-sprites.js (#12); the sprite scenes are not
     * in this harness's scene list, but the module must load. */
    fs.copyFileSync(path.join(ROOT, "renderer", "pce-sprites.js"),
                    path.join(tmp, "renderer", "pce-sprites.js"));
    fs.writeFileSync(path.join(tmp, "tests", "check.js"), checkerSource);
    /* check.js resolves dumps from its own directory; symlink avoids copying
     * megabytes per mutant (fall back to a copy where symlinks are
     * unavailable).  The synthetic witness uses its own dumps tree. */
    const dest = path.join(tmp, "tests", "dumps");
    try {
      fs.symlinkSync(dumpsDir, dest, "dir");
    } catch (_) {
      fs.cpSync(dumpsDir, dest, { recursive: true });
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
    if (mutation.expect === "detected-synthetic") {
      return evaluateSynthetic(mutation, applied.source, truth);
    }
    return { kind: "no-op", detail: "mutation changed no rendered byte", scenes: truth };
  }

  const run = runCheck(applied.source, checkerSource, DUMPS);
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

/* ---- the ch800 synthetic witness ---------------------------------------- */

/* The VDC addresses 65536 VRAM words; Mednafen's state carries 32768, so no
 * real capture can hold data the rule would zero.  This synthetic dump has
 * tiles at words 0x8000+ and a BAT that reads them: the shipped renderer
 * (the rule) shows the backdrop everywhere, a renderer without the rule
 * shows the tile data.  The reference PNG is the shipped renderer's frame —
 * this proves "check.js catches the mutant", not the rule itself; the rule's
 * truth is scene9's capture (odd BAT columns read 0xF00+ and show CRAM[0]). */
function syntheticDump() {
  const vram = new Uint8Array(131072); /* 65536 words: the VDC's address space */
  const put = (word, v) => {
    vram[word * 2] = v & 0xFF;
    vram[word * 2 + 1] = (v >> 8) & 0xFF;
  };
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      put(y * 32 + x, (((x + y) & 0xF) << 12) | (0x800 | ((x * 3 + y) & 0x1F)));
    }
  }
  /* tiles 0x800..0x81F: all pixels colour 15 (0xFFFF words) */
  for (let w = 0x800 * 16; w < 0x820 * 16; w++) put(w, 0xFFFF);
  const cram = fs.readFileSync(path.join(DUMPS, "scene1", "cram.bin"));
  return {
    vram,
    cram,
    regs: { BYR: 0, BXR: 0, MWR: 0x00, CR: 0x80, RCRCount: 0, scanline: 18 },
    width: 256,
    height: 232,
  };
}

/* Minimal PNG writer: 8-bit RGB, filter 0, one IDAT — enough for check.js's
 * reader (colour type 2). */
const CRC_TABLE = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function encodePng(rgb, width, height) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   /* bit depth */
  ihdr[9] = 2;   /* colour type: RGB */
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; /* filter: none */
    Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride)
      .copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from("\x89PNG\r\n\x1a\n", "latin1"),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function writeSyntheticTree(dump, referenceFrame) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pce-synth-"));
  moduleDirs.push(tmp); /* cleaned up on exit */
  const dir = path.join(tmp, "dumps", "sceneS");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "vram.bin"), dump.vram);
  fs.writeFileSync(path.join(dir, "cram.bin"), dump.cram);
  fs.writeFileSync(path.join(dir, "regs.json"), JSON.stringify(dump.regs));
  fs.writeFileSync(path.join(dir, "mednafen.png"),
    encodePng(referenceFrame.pixels, referenceFrame.width, referenceFrame.height));
  return path.join(tmp, "dumps");
}

function evaluateSynthetic(mutation, mutantSource, truth) {
  const dump = syntheticDump();
  const real = require(RENDERER_PATH);
  const mutant = loadRendererSource(mutantSource);
  const ref = real.renderFrame(dump);
  const changed = compareFrames(ref, mutant.renderFrame(dump));
  if (changed.bytes === 0) {
    return {
      kind: "unexpected",
      detail: "the ch800 mutant changed nothing even on the synthetic 65536-word dump",
      scenes: truth,
    };
  }

  const tree = writeSyntheticTree(dump, ref);

  /* Sanity: the shipped checker is green on the shipped renderer for the
   * synthetic dump (the reference PNG is what the rule draws). */
  const sane = runCheck(RENDERER_SRC, CHECK_SRC, tree);
  if (sane.status !== 0 || !/^sceneS: OK/m.test(sane.stdout || "")) {
    return {
      kind: "input-error",
      detail: "shipped renderer + shipped check.js are not diff 0 on the " +
              `synthetic dump (exit ${sane.status})`,
      scenes: truth,
    };
  }

  const run = runCheck(mutantSource, CHECK_SRC, tree);
  const report = parseReport(run.stdout);
  const d = report.diffs.get("sceneS");
  if (run.status !== 0 && d && d.pixels === changed.bytes && report.fail) {
    return {
      kind: "detected",
      detail: `on the synthetic witness dump: check.js failed and reported ` +
              `the measured ${changed.bytes}-byte diff (${changed.pixels} pixels)`,
      scenes: truth,
      synthetic: changed,
    };
  }
  return {
    kind: "crash",
    detail: `synthetic run: exit ${run.status}, reported ` +
            `${d ? d.pixels + " bytes" : "no diff"} vs measured ${changed.bytes}`,
    scenes: truth,
    run,
    report,
  };
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
  if (result.synthetic) {
    console.log(`        sceneS (synthetic): measured ${result.synthetic.bytes} ` +
                `differing bytes / ${result.synthetic.pixels} pixels`);
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

/* 2. The ten breaks: each must land in its expected class. */
for (const mutation of MUTATIONS) {
  console.log(`\nmutation ${mutation.id}: ${mutation.what}`);
  const result = evaluateSafely(mutation, CHECK_SRC);
  printScenes(result);
  if (result.kind === "detected") {
    pass(`${mutation.id}: DETECTED — ${result.detail}`);
    if (mutation.note) console.log(`        note: ${mutation.note}`);
  } else {
    fail(`${mutation.id}: ${result.kind.toUpperCase()} — ${result.detail || ""}`);
  }
}

/* 3. Self-tests: this script must be able to say no. */
console.log("\nself-test: a checker with the pixel comparison gutted");
for (const mutation of [MUTATIONS[0], MUTATIONS[MUTATIONS.length - 1]]) {
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
  console.log(`PASS: all ten #39 breaks are DETECTED — nine on the standard ` +
              `captures, vdw1 on scene5b (the shifted-crop capture), ch800 on ` +
              `the synthetic witness dump`);
  process.exitCode = 0;
} else {
  console.log(`FAIL: ${failures.length} check(s) did not hold`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
