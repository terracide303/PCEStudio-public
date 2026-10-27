#!/usr/bin/env node
/*
 * tests/check-review-fixes.js — card #38: each small fix from docs/REVIEW.md
 * has a test that failed before it.
 *
 * The fixes (all found by #11's cold read):
 *   1. renderer/pce-bg.js: BAT row stride for SCREEN code 3 (MWR 0x30/0x70)
 *      was 8; the VDC manual's SCREEN table makes it 128 words, shift 7.
 *   2. docs/RENDERER.md: the "CG bit is a no-op" claim removed — bit 8 is the
 *      top bit of green.
 *   3. tests/check.js: tests/dumps/us1 no longer counted as a diff-0 picture.
 *   4. renderer/pce-rom.js: a tile region that starts inside VRAM and runs
 *      past its end throws, as docs/EXPORT.md says.
 *   5. docs/RENDERER.md: every Hudson-manual citation carries a page number.
 *
 * The point is "failed before it".  Each check runs over the shipped code or
 * text AND over the pre-fix version of it — a source-string substitution that
 * reproduces exactly what the review measured, or the review's own quoted
 * output/claim — and requires the same predicate to reject that.  A check
 * that cannot say no to the broken version is not evidence for the fix.
 *
 * NOTE: written by @design.  Per the workshop role split this is flagged for
 * @review to read cold; the fix author's test checks what the author already
 * believes.
 *
 *   node tests/check-review-fixes.js
 *
 * Exit 0 only if every fix holds and every pre-fix version is rejected.
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const failures = [];
const tmpDirs = [];

function fail(message) { failures.push(message); console.log(`  FAIL  ${message}`); }
function pass(message) { console.log(`  ok    ${message}`); }

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }

function tmpdir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
process.on("exit", () => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

/* Write `source` as a module in a throwaway directory and require it, so the
 * shipped module and its pre-fix copy can be compared in one process. */
function loadModuleSource(source, name) {
  const file = path.join(tmpdir("pce-src-"), name);
  fs.writeFileSync(file, source);
  return require(file);
}

/* Build the pre-fix version of a source file from the fixed one.  If the
 * shipped tree is ALREADY the pre-fix version (running this test against the
 * commit before the fix, to show it fails), `isPreFix` recognises it and the
 * shipped source stands in for the old one.  If neither holds the source was
 * refactored and the pre-fix copy would silently stop being pre-fix — refuse
 * loudly instead. */
function preFixSource(source, fixedLine, oldLine, isPreFix, what) {
  const n = source.split(fixedLine).length - 1;
  if (n === 1) return source.replace(fixedLine, oldLine);
  if (n === 0 && isPreFix(source)) return source;
  throw new Error(`${what}: cannot build the pre-fix source ` +
                  `(fixed line found ${n} time(s), isPreFix ${isPreFix(source)})`);
}

/* ====================================================================== *
 * 1. pce-bg.js — BAT row stride for SCREEN code 3 (review finding 2)
 * ====================================================================== */

console.log("\n1. pce-bg.js: SCREEN code 3 BAT stride");

const BG_SRC = read("renderer/pce-bg.js");
const bg = require(path.join(ROOT, "renderer", "pce-bg.js"));

/* The pre-fix line was `shift = 5 + ((mwr >> 4) & 3)`; the fixed code puts
 * the width code in `mode` and shifts by the width.  This reproduces it. */
const OLD_BG_SRC = preFixSource(BG_SRC, "var shift = shifts[mode];",
  "var shift = 5 + mode;",
  (src) => src.includes("var shift = 5 + ((mwr >> 4) & 3);"),
  "pce-bg pre-fix stride");
const oldBg = loadModuleSource(OLD_BG_SRC, "pce-bg-prefix.js");

/* MWR code -> [width, height, shift]; the SCREEN table is p. H7-8/H7-9. */
const GEOMETRY = [
  [0x00, 32, 32, 5], [0x10, 64, 32, 6], [0x20, 128, 32, 7],
  [0x30, 128, 32, 7], [0x40, 32, 64, 5], [0x50, 64, 64, 6],
  [0x60, 128, 64, 7], [0x70, 128, 64, 7],
];

function geometryProblems(mod) {
  const problems = [];
  for (const [mwr, width, height, shift] of GEOMETRY) {
    const g = mod.batGeometry(mwr);
    if (g.width !== width || g.height !== height || g.shift !== shift ||
        g.wmask !== width - 1 || g.hmask !== height - 1) {
      problems.push(`MWR 0x${mwr.toString(16)}: got ` +
        `${g.width}x${g.height} shift ${g.shift}, expected ` +
        `${width}x${height} shift ${shift}`);
    }
  }
  return problems;
}

{
  const problems = geometryProblems(bg);
  if (problems.length === 0)
    pass("batGeometry matches the SCREEN table for all 8 MWR codes " +
         "(codes 2 and 3 both shift 7)");
  else problems.forEach(fail);
}

{
  const problems = geometryProblems(oldBg);
  const code3 = problems.filter((p) => /MWR 0x(30|70)/.test(p));
  if (code3.length === 2)
    pass("self-test: the pre-fix stride is rejected on exactly codes 0x30 " +
         "and 0x70 (shift 8, measured by #11)");
  else
    fail("self-test: the pre-fix stride was not rejected as expected " +
         `(${problems.length} problem(s): ${problems.join("; ")})`);
}

/* End to end: with MWR=0x30, BXR=512 and BYR=0, the pixel at (0, 8) comes
 * from BAT word 192 (row 1, column 64) at the correct stride 7, and from
 * BAT word 320 at the pre-fix stride 8.  The two words hold different tiles,
 * so the rendered colour says which stride was used. */
function strideDump() {
  const vram = new Uint8Array(65536);
  const cram = new Uint8Array(1024);
  const put = (word, v) => {
    vram[word * 2] = v & 0xFF;
    vram[word * 2 + 1] = (v >> 8) & 0xFF;
  };
  cram[2] = 0x01;                 /* CRAM[1] = 0x001: blue 1 -> 36 */
  cram[4] = 0x02;                 /* CRAM[2] = 0x002: blue 2 -> 72 */
  put(192, 1);                    /* BAT row 1, col 64 at stride 7 */
  put(320, 2);                    /* BAT row 1, col 64 at stride 8 */
  for (let r = 0; r < 8; r++) put(1 * 16 + r, 0x00FF); /* tile 1 -> colour 1 */
  for (let r = 0; r < 8; r++) put(2 * 16 + r, 0xFF00); /* tile 2 -> colour 2 */
  return {
    vram, cram,
    regs: { BYR: 0, BXR: 512, MWR: 0x30, RCRCount: 0, scanline: 18 },
  };
}

{
  const dump = strideDump();
  const opts = Object.assign({ width: 256, height: 232 }, dump);
  const blue = (frame, x, y) => frame.pixels[(y * frame.width + x) * 3 + 2];
  const fixed = blue(bg.renderFrame(opts), 0, 8);
  const before = blue(oldBg.renderFrame(opts), 0, 8);
  if (fixed === 36)
    pass("render: MWR=0x30 column 64 reads BAT word 192 (blue 36)");
  else
    fail(`render: fixed renderer read blue ${fixed}, expected 36 from BAT word 192`);
  if (before === 72)
    pass("self-test: pre-fix renderer reads BAT word 320 (blue 72) — the " +
         "wrong stride is visible in pixels, not just in geometry");
  else
    fail(`self-test: pre-fix renderer read blue ${before}, expected 72 from BAT word 320`);
}

/* ====================================================================== *
 * 2 + 5. docs/RENDERER.md — CG-bit claim removed, page numbers present
 * ====================================================================== */

console.log("\n2. docs/RENDERER.md: 'CG bit is a no-op' claim removed");
console.log("5. docs/RENDERER.md: Hudson manual page numbers");

const RENDERER_MD = read("docs/RENDERER.md");

function docProblems(text) {
  const problems = [];
  /* Markdown wraps the long file names; compare on collapsed whitespace. */
  const flat = text.replace(/\s+/g, " ");
  if (/CG bit\s*\(bit 8/i.test(flat))
    problems.push("still presents bit 8 as a separate CG bit");
  if (/no-op for RGB output/i.test(flat))
    problems.push("still says bit 8 is a no-op for RGB output");
  if (!/top bit of \**green/i.test(flat))
    problems.push("does not say bit 8 is the top bit of green");
  const pages = ["H7-7", "H7-8", "H7-9", "H7-13", "H7-14", "H7-15",
                 "H6-4", "H6-5"];
  const missing = pages.filter((p) => !flat.includes(p));
  if (missing.length > 0)
    problems.push("missing manual page(s): " + missing.join(", "));
  const files = [
    "HuC6270 VDC Manual - registers, VRAM write sequence, slots.txt",
    "HuC6260 VCE Manual - 0400 physical 1FE400, dot clock select.txt",
  ];
  const missingFiles = files.filter((f) => !flat.includes(f));
  if (missingFiles.length > 0)
    problems.push("manual cited without its file name: " + missingFiles.join(", "));
  return problems;
}

{
  const problems = docProblems(RENDERER_MD);
  if (problems.length === 0)
    pass("no CG-bit claim; cites VDC p. H7-7/H7-8/H7-9/H7-13/H7-14/H7-15 " +
         "and VCE p. H6-4/H6-5 by file name");
  else problems.forEach(fail);
}

{
  /* #11's quoted claim (REVIEW.md finding 3) and the pre-fix citation
   * (REVIEW.md finding 9) — the same predicate must reject both. */
  const oldClaim = "The CG bit (bit 8 of the 16-bit storage, written via " +
    "$0405) is a no-op for RGB output.";
  const oldCitation = "Source: Hudson HuC6270 VDC manual (PCEHeroTN " +
    "`docs/datasheets/text/HuC6270 VDC Manual …`), register and BAT entry " +
    "chapters";
  const claimProblems = docProblems(oldClaim);
  const citationProblems = docProblems(oldCitation);
  if (claimProblems.length > 0 && citationProblems.length > 0)
    pass("self-test: the pre-fix claim and page-less citation are rejected " +
         `(${claimProblems.length} and ${citationProblems.length} problem(s))`);
  else
    fail("self-test: the pre-fix text was not rejected " +
         `(${claimProblems.length} and ${citationProblems.length} problem(s))`);
}

/* ====================================================================== *
 * 3. tests/check.js — us1 is not a diff-0 picture (review finding 4)
 * ====================================================================== */

console.log("\n3. tests/check.js: us1 is not counted as a picture");

const CHECK_SRC = read("tests/check.js");
const US1_REGS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "dumps", "us1", "regs.json"), "utf8"));

function outputProblems(stdout, status) {
  const problems = [];
  if (status !== 0) problems.push(`check.js exited ${status}`);
  if (/^us1:\s*OK\b/m.test(stdout))
    problems.push("us1 is still reported OK, i.e. counted as diff 0");
  const m = /^PASS: renderer matches Mednafen pixel for pixel on (\d+) scene\(s\)$/m
    .exec(stdout);
  if (!m) problems.push("no PASS summary line");
  else if (Number(m[1]) !== 10)
    problems.push(`PASS counts ${m[1]} scene(s), expected 10`);
  if (!/^us1: not a picture, skipped/m.test(stdout))
    problems.push("us1 is not reported as skipped by name");
  return problems;
}

{
  if (US1_REGS.CR & 0x80)
    fail(`us1's regs.CR is 0x${US1_REGS.CR.toString(16)}: bit 7 is set, so ` +
         "us1 cannot be the background-off dump this fix is about");
  else
    pass(`us1's regs.CR = 0x${US1_REGS.CR.toString(16)}: background off, ` +
         "so it is not a picture");
}

{
  const run = spawnSync(process.execPath, [path.join(__dirname, "check.js")],
    { encoding: "utf8", timeout: 120000 });
  const problems = outputProblems(run.stdout || "", run.status);
  if (problems.length === 0)
    pass("check.js: 10 scene(s) diff 0, us1 skipped and not counted");
  else problems.forEach(fail);
}

{
  /* #11's measured pre-fix output (REVIEW.md finding 4). */
  const oldOutput = "us1: OK (256x232, diff 0)\n" +
    "PASS: renderer matches Mednafen pixel for pixel on 11 scene(s)\n";
  const problems = outputProblems(oldOutput, 0);
  if (problems.length > 0)
    pass(`self-test: the pre-fix output (us1 OK, 11 scene(s)) is rejected ` +
         `(${problems.length} problem(s))`);
  else fail("self-test: the pre-fix output was not rejected");
}

/* The skip list must not become a hiding place: a dump with the background
 * off that is NOT named in check.js has to fail the run. */
{
  const run = runCheckGuardDump();
  const stdout = run.stdout || "";
  if (run.status !== 0 && /^bgoff: NOT A PICTURE .* FAIL$/m.test(stdout))
    pass("guard: an unlisted background-off dump fails check.js");
  else
    fail("guard: an unlisted background-off dump did not fail check.js " +
         `(exit ${run.status})`);
}

function runCheckGuardDump() {
  const tmp = tmpdir("pce-check-guard-");
  fs.mkdirSync(path.join(tmp, "renderer"));
  fs.mkdirSync(path.join(tmp, "tests"));
  fs.writeFileSync(path.join(tmp, "renderer", "pce-bg.js"), BG_SRC);
  fs.writeFileSync(path.join(tmp, "tests", "check.js"), CHECK_SRC);
  const dumps = path.join(tmp, "tests", "dumps");
  fs.mkdirSync(dumps);
  const scene1 = path.join(__dirname, "dumps", "scene1");
  fs.symlinkSync(scene1, path.join(dumps, "scene1"), "dir");
  const bgoff = path.join(dumps, "bgoff");
  fs.mkdirSync(bgoff);
  for (const f of ["vram.bin", "cram.bin", "mednafen.png"])
    fs.copyFileSync(path.join(scene1, f), path.join(bgoff, f));
  const regs = JSON.parse(
    fs.readFileSync(path.join(scene1, "regs.json"), "utf8"));
  regs.CR = 0x00;
  fs.writeFileSync(path.join(bgoff, "regs.json"), JSON.stringify(regs));
  return spawnSync(process.execPath, [path.join(tmp, "tests", "check.js")],
    { encoding: "utf8", timeout: 120000 });
}

/* ====================================================================== *
 * 4. pce-rom.js — a tile region past VRAM throws (review finding 7)
 * ====================================================================== */

console.log("\n4. pce-rom.js: a tile region that runs past VRAM throws");

const ROM_SRC = read("renderer/pce-rom.js");
const rom = require(path.join(ROOT, "renderer", "pce-rom.js"));
const OLD_ROM_SRC = preFixSource(ROM_SRC,
  "      need(dest + count * 16 <= 32768,\n" +
  "           \"region \" + r + \": words \" + dest + \"..\" + (dest + count * 16) +\n" +
  "           \" run past the 32768-word VRAM\");\n",
  "      /* pre-fix: no check, the region was sliced short */\n",
  (src) => !src.includes("run past the 32768-word VRAM"),
  "pce-rom pre-fix straddle check");
const oldRom = loadModuleSource(OLD_ROM_SRC, "pce-rom-prefix.js");

const BANK0 = new Uint8Array(
  fs.readFileSync(path.join(ROOT, "renderer", "viewer-bank0.bin")));

function buildWith(mod, regions) {
  return mod.buildRom({
    bank0: BANK0,
    vram: new Uint8Array(65536),
    cram: new Uint8Array(1024),
    regs: { BXR: 0, BYR: 0, MWR: 0x00, CR: 0x80 },
    regions,
  });
}

/* [char0, tiles]: dest = char0*16, size = tiles*16 words. */
const STRADDLING = [[0x7FF, 2], [0x40, 1]]; /* words 32752..32784 */
const EXACT_END = [[2040, 8]];              /* words 32640..32768 */
const WHOLLY_PAST = [[3840, 16]];           /* dest 61440: dropped */

{
  let threw = null;
  try { buildWith(rom, STRADDLING); } catch (e) { threw = e; }
  if (threw && /run past the 32768-word VRAM/.test(threw.message))
    pass("a region at words 32752..32784 throws, naming the range");
  else
    fail("the straddling region did not throw with the documented message " +
         `(got ${threw ? threw.message : "no error"})`);
}

{
  const problems = [];
  try { buildWith(rom, EXACT_END); }
  catch (e) { problems.push(`a region ending exactly at 32768 threw: ${e.message}`); }
  try { buildWith(rom, WHOLLY_PAST); }
  catch (e) { problems.push(`a wholly-past region was not dropped: ${e.message}`); }
  if (problems.length === 0)
    pass("the boundary is exact: ending at word 32768 builds, wholly past " +
         "is still dropped as documented");
  else problems.forEach(fail);
}

{
  /* The pre-fix module built the straddling ROM silently: that is the defect,
   * and it shows the new test is not passing by accident. */
  let built = null;
  try { built = buildWith(oldRom, STRADDLING); } catch (e) { /* unexpected */ }
  if (built)
    pass(`self-test: the pre-fix builder emitted the truncated ROM silently ` +
         `(${built.length} bytes) — the check above is what catches it`);
  else
    fail("self-test: the pre-fix builder did not build the straddling ROM " +
         "(the substitution may not have reproduced the defect)");
}

/* ====================================================================== */

console.log("");
if (failures.length === 0) {
  console.log("PASS: all five #38 fixes hold, and each pre-fix version is " +
              "rejected by the same check");
  process.exitCode = 0;
} else {
  console.log(`FAIL: ${failures.length} check(s) did not hold`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
