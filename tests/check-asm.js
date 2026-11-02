#!/usr/bin/env node
/*
 * tests/check-asm.js — PCEAS in WebAssembly assembles what the native binary
 * assembles (card #224's closing measurement).
 *
 *   node tests/check-asm.js
 *
 * NOTE ON AUTHORSHIP: written by the builder (@design) because the card's
 * close condition needs this diff script.  Per the workshop's role split it
 * is flagged for a cold read/break by another seat before the card closes.
 *
 * What it proves, and how:
 *
 *   six sources   tools/hello.asm, tools/viewer.asm, the generated
 *                 tools/gen/scene1.asm and tools/gen/viewer1.asm, and
 *                 tests/asm/features.asm + tests/asm/banks.asm are assembled
 *                 twice: once by renderer/pce-asm.js (the WebAssembly build in
 *                 vendor/pceas/) and once by the native PCEAS named in the
 *                 card (/Volumes/External/pce-tools/bin/pceas, v3.23).  The
 *                 two ROMs must be byte-for-byte equal.  viewer1 carries
 *                 .include and five .incbin files (one binary per bank
 *                 region), so the include path and binary files are covered,
 *                 not just text accepted on stdin.
 *   listing       features.asm contains .list, exactly as PCEAS documents it;
 *                 the listing pce-asm.js returns must equal the native .lst
 *                 byte-for-byte.  For a source *without* .list the wrapper
 *                 prepends one, renumbers the listing back to the caller's
 *                 lines and returns it — hello.asm is checked for that
 *                 (non-empty, starts at line 1, no injected .list line).
 *   error         tests/asm/error.asm has a deliberate `lda #$GG` on line 5.
 *                 assemble() must return status 1, no bytes, and exactly
 *                 [{line: 5, message: "Syntax error in expression!"}]; the
 *                 native binary's own stdout is required to carry the same
 *                 line and message, so the expected text is not invented here.
 *   repeatable    the same source assembled twice yields the same bytes
 *                 (each call gets a fresh module instance).
 *
 * The interpreter image source (tools/ilvm/hutrack_engine.asm) is included in
 * the parity check as a REFUSAL, not an assembly: the native binary this card
 * names is PCEAS 3.23, and 3.23 cannot assemble that file — it uses PCEAS
 * 4.x's `&`/`<` expressions and dotted labels.  `tools/ilvm/build-engine.sh`
 * builds it with `pceas4` (docs/BUILD.md), not with /Volumes/External/
 * pce-tools/bin/pceas.  This test requires the wasm to reproduce the native
 * 3.23 diagnostics exactly (same lines, same messages), which is all a 3.23
 * build can do with that file.  Assembling it would need a PCEAS 4.x wasm;
 * that is not what card #224 asked this directory to be built from.
 *
 * NOT PROVEN: the native binary is the only reference, so a shared PCEAS bug
 * (or a wrong native build) would cancel; the wasm is not run in a browser
 * page (Node only); the banner/version text is not compared; and the 4.x
 * interpreter build path is out of reach of this 3.23 artefact.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PCEAS = process.env.PCEAS || "/Volumes/External/pce-tools/bin/pceas";
const NATIVE = PCEAS;
const asm = require(path.join(ROOT, "renderer", "pce-asm.js"));

let checks = 0;
const failures = [];
function check(ok, what) {
  checks++;
  if (!ok) failures.push(what);
}

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "check-asm-"));
process.on("exit", () => fs.rmSync(SCRATCH, { recursive: true, force: true }));

function readText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}
function readBytes(rel) {
  return new Uint8Array(fs.readFileSync(path.join(ROOT, rel)));
}
function binaryName(p) {
  return /\.(bin|pcx|png)$/i.test(p);
}

// Copy a source and every .include/.incbin it names into a scratch tree,
// preserving paths relative to pceas's working directory.  `cwdRel` is that
// directory in the repo: tools/ for the generated sources (the Makefile runs
// pceas there), tests/asm/ for the fixtures, the repo root otherwise.
function stage(cwdRel, entryRel, extra) {
  const from = path.join(ROOT, cwdRel);
  const dir = fs.mkdtempSync(path.join(SCRATCH, "case-"));
  const files = {};
  const seen = new Set();
  function put(rel, data) {
    files[rel] = binaryName(rel) ? new Uint8Array(data) : data.toString("utf8");
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), data);
  }
  function walk(rel) {
    if (seen.has(rel)) return;
    seen.add(rel);
    const data = fs.readFileSync(path.join(from, rel));
    put(rel, data);
    if (!binaryName(rel)) {
      const re = /^[ \t]*\.(include|incbin)[ \t]+"([^"]+)"/gim;
      let m;
      while ((m = re.exec(files[rel])) !== null) walk(m[2]);
    }
  }
  walk(entryRel);
  for (const rel of extra || []) {
    if (seen.has(rel)) continue;
    put(rel, fs.readFileSync(path.join(ROOT, rel)));
  }
  return { dir, entry: entryRel, files };
}

function runNative(dir, entry) {
  const res = spawnSync(NATIVE, ["-raw", entry], {
    cwd: dir, encoding: "utf8", maxBuffer: 16 * 1024 * 1024
  });
  if (res.error) {
    throw new Error("cannot run the native PCEAS at " + NATIVE + ": " +
                    res.error.message);
  }
  return res;
}

if (PCEAS.includes("/") && !fs.existsSync(NATIVE)) {
  console.error("missing native PCEAS at " + NATIVE +
                " — docs/BUILD.md installs it (set PCEAS to override)");
  process.exit(2);
}

// ---- six assembled sources, byte-identical to native --------------------
const SAMPLES = [
  { name: "hello", cwd: ".", entry: "tools/hello.asm" },
  { name: "viewer", cwd: ".", entry: "tools/viewer.asm" },
  { name: "scene1", cwd: "tools", entry: "gen/scene1.asm" },
  { name: "viewer1", cwd: "tools", entry: "gen/viewer1.asm" },
  { name: "features", cwd: "tests/asm", entry: "features.asm" },
  { name: "banks", cwd: "tests/asm", entry: "banks.asm" }
];

// make(1) treats the generated .asm files as intermediates and deletes them
// once the .pce exists, so after `make -C tools` they can be absent.  The
// generators are deterministic and write the same files into tools/gen/;
// run them here when needed (the path the Makefile itself uses).
function ensureGenerated() {
  const needs = SAMPLES.some(s => s.cwd === "tools" &&
                            !fs.existsSync(path.join(ROOT, s.cwd, s.entry)));
  if (!needs) return null;
  const a = spawnSync("python3", ["-I", "genroms.py"], {
    cwd: path.join(ROOT, "tools"), encoding: "utf8", maxBuffer: 16 * 1024 * 1024
  });
  if (a.status !== 0) {
    return "genroms.py failed: " + (a.stdout + a.stderr).trim().split("\n").pop();
  }
  const b = spawnSync("python3", ["-I", "genviewer.py", "1"], {
    cwd: path.join(ROOT, "tools"), encoding: "utf8", maxBuffer: 16 * 1024 * 1024
  });
  if (b.status !== 0) {
    return "genviewer.py 1 failed: " +
           (b.stdout + b.stderr).trim().split("\n").pop();
  }
  return null;
}
const generatedError = ensureGenerated();

for (const sample of SAMPLES) {
  const entryPath = path.join(ROOT, sample.cwd, sample.entry);
  if (!fs.existsSync(entryPath)) {
    failures.push(`${sample.name}: ${path.join(sample.cwd, sample.entry)} is ` +
                  "missing" + (generatedError ? " — " + generatedError :
                  " — run make -C tools first"));
    checks++;
    continue;
  }
  const staged = stage(sample.cwd, sample.entry);
  const native = runNative(staged.dir, sample.entry);
  const outRel = sample.entry.replace(/\.[^.\/]*$/, ".pce");
  const nativeFile = path.join(staged.dir, outRel);
  check(native.status === 0 && fs.existsSync(nativeFile),
        `${sample.name}: native pceas did not write ${outRel}: ` +
        (native.stdout + native.stderr).trim().split("\n").slice(-3).join(" | "));
  if (!fs.existsSync(nativeFile)) continue;

  const r = asm.assemble(staged.files[sample.entry], {
    filename: sample.entry,
    includes: staged.files
  });
  check(r.status === 0, `${sample.name}: wasm pceas failed: ` +
        JSON.stringify(r.errors.slice(0, 3)));
  check(r.errors.length === 0,
        `${sample.name}: wasm reported ${r.errors.length} diagnostic(s) on a ` +
        "source the native binary assembles");
  const nativeBytes = fs.readFileSync(nativeFile);
  check(r.bytes.length === nativeBytes.length,
        `${sample.name}: wasm ${r.bytes.length} B vs native ` +
        `${nativeBytes.length} B`);
  check(Buffer.compare(Buffer.from(r.bytes), nativeBytes) === 0,
        `${sample.name}: wasm ROM differs from native pceas byte-for-byte`);
  if (sample.name === "features") {
    const nativeLst = fs.readFileSync(
      path.join(staged.dir, "features.lst"), "utf8");
    check(r.listing === nativeLst,
          "features: the listing differs from the native .lst");
    check(r.listing.length > 0, "features: the listing is empty");
  }
  if (sample.name === "hello") {
    check(r.listing.length > 0, "hello: no listing returned without .list");
    check(/^#\[1\]\s+tools\/hello\.asm$/m.test(r.listing),
          "hello: listing does not start at tools/hello.asm");
    check(!/^[ \t]*\.list\b/m.test(r.listing),
          "hello: the injected .list line leaked into the listing");
    const numbered = r.listing.split("\n").filter(l => /^\s*\d+\s/.test(l));
    check(numbered.length === 134,
          `hello: listing has ${numbered.length} numbered lines, want 134`);
  }
}

// ---- error: line and message, cross-checked against native --------------
{
  const staged = stage("tests/asm", "error.asm");
  const native = runNative(staged.dir, "error.asm");
  check(native.status !== 0, "error: native pceas accepted error.asm");
  const nativeOut = native.stdout + native.stderr;
  check(/\n\s+5\s/.test(nativeOut) &&
        /Syntax error in expression!/.test(nativeOut),
        "error: native pceas did not report line 5 as expected");
  const r = asm.assemble(staged.files["error.asm"], {
    filename: "error.asm",
    includes: staged.files
  });
  check(r.status !== 0, "error: wasm pceas accepted error.asm");
  check(r.bytes.length === 0, "error: wasm returned bytes for a failed assembly");
  check(r.errors.length === 1, `error: ${r.errors.length} diagnostics, want 1`);
  check(r.errors[0] && r.errors[0].line === 5,
        "error: the diagnostic line is " +
        (r.errors[0] && r.errors[0].line) + ", want 5");
  check(r.errors[0] &&
        r.errors[0].message === "Syntax error in expression!",
        "error: the diagnostic message is " +
        JSON.stringify(r.errors[0] && r.errors[0].message));
}

// ---- repeatability ------------------------------------------------------
{
  const src = readText("tools/hello.asm");
  const a = asm.assemble(src, { filename: "hello.asm" });
  const b = asm.assemble(src, { filename: "hello.asm" });
  check(a.status === 0 && b.status === 0, "repeat: hello failed");
  check(Buffer.compare(Buffer.from(a.bytes), Buffer.from(b.bytes)) === 0,
        "repeat: two assemblies of hello.asm differ");
  check(a.errors.length === 0 && b.errors.length === 0,
        "repeat: diagnostics leaked between instances");
}

// ---- the interpreter source: identical refusal, not an assembly ---------
{
  const entry = "tools/ilvm/hutrack_engine.asm";
  // No includes: the real build stages vendor/hutrack/lib and PCE_INCLUDE.
  // This check is about the two 3.23 builds agreeing on the file's 4.x
  // syntax (and on the first include they cannot find), not about staging
  // an image only PCEAS 4.x can assemble.
  const dir = fs.mkdtempSync(path.join(SCRATCH, "ilvm-"));
  const text = readText(entry);
  fs.writeFileSync(path.join(dir, "hutrack_engine.asm"), text);
  const native = runNative(dir, "hutrack_engine.asm");
  const r = asm.assemble(text, { filename: "hutrack_engine.asm" });
  check(native.status !== 0 && r.status !== 0,
        "ilvm: expected both PCEAS 3.23 builds to refuse " + entry +
        " (it is a PCEAS 4.x source)");
  check(r.errors.length > 0, "ilvm: wasm returned no diagnostics");
  // Re-derive the expected diagnostics from the native stdout with the same
  // two-line shape pceas uses, then compare the pair list.
  const nativeErrs = [];
  let line = null;
  for (const s of (native.stdout + native.stderr).split(/\r?\n/)) {
    const field = s.slice(0, 5);
    if (/^\s*\d+\s*$/.test(field)) { line = parseInt(field, 10); continue; }
    if (line !== null && /^ {7}\S/.test(s)) {
      nativeErrs.push({ line, message: s.slice(7).trim() });
      line = null;
    }
  }
  check(nativeErrs.length > 0, "ilvm: native pceas printed no diagnostics");
  const got = r.errors.map(e => ({ line: e.line, message: e.message }));
  check(JSON.stringify(got) === JSON.stringify(nativeErrs),
        "ilvm: wasm diagnostics differ from native PCEAS 3.23's: " +
        JSON.stringify(got.slice(0, 3)) + " vs " +
        JSON.stringify(nativeErrs.slice(0, 3)));
}

if (failures.length === 0) {
  console.log(`PASS: ${checks} checks — six sources assemble byte-identically ` +
              `to the native PCEAS 3.23 (hello, viewer, generated scene1 and ` +
              `viewer1 with .include/.incbin, features with macros, banks), ` +
              `the listing matches the native .lst, error.asm reports line 5 ` +
              `and its message, and the interpreter 4.x source is refused ` +
              `identically by both 3.23 builds`);
  process.exitCode = 0;
} else {
  console.log(`FAIL: ${failures.length} of ${checks} checks failed`);
  for (const f of failures) console.log("  - " + f);
  process.exitCode = 1;
}
