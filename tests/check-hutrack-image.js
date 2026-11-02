#!/usr/bin/env node
/*
 * tests/check-hutrack-image.js — card #212: the HuTrack engine as a
 * standalone PCEAS image (first slice of #198; design docs/ROM-SOUND.md).
 *
 * NOTE: written by @design as part of #212 because the card's close
 * condition needs a check; per the workshop role split it is flagged for
 * @review to read cold (rule 2).
 *
 * What it proves, and how:
 *   0. vendor/hutrack is pristine.  Every file matches MANIFEST.sha256 (the
 *      pinned upstream bytes) before and after the build, and the code
 *      sources hold exactly three full-window call sites (MAP_BANK.4):
 *      HuTrack_lib.asm:377 (playSong), HuTrack_parser.asm:31 (Parser) and
 *      HuTrack_parser.asm:1774 (Process.envelopes).  The macro definition in
 *      hutrack.inc is not a call site and is not counted.
 *   1. The staged copy is a copy, and the patch is exactly three lines.
 *      tools/ilvm/build-engine.sh is run into a scratch OUT (so a developer's
 *      tools/gen is untouched); every staged file is a regular file (a
 *      symlink would let the patch edit vendor/), and a line-by-line diff
 *      against vendor/hutrack/lib differs at exactly those three lines, each
 *      MAP_BANK.4 -> MAP_BANK.  PUSHBANK.4/PULLBANK.4 are byte-identical.
 *   2. The image's shape.  engine.bin is 32,768 B (four physical banks); the
 *      extracted banks are 8,192 B each; code ends at $BEC4 (7,876 B used,
 *      316 free in bank 2) and the tables end at $8B34 (2,868 B used, 5,324
 *      free in bank 3) — the numbers docs/ROM-SOUND.md §2 measured.  Bytes
 *      after each extent are $FF, and the extracted banks equal the raw
 *      image's banks 2 and 3 byte for byte.
 *   3. The symbol header.  Every entry point docs/ROM-SOUND.md §7 names has
 *      a fixed address in bank 2 (page 5), the RAM interface symbols sit at
 *      the §5 addresses ($2080, $2200), and tools/gen/hutrack-symbols.h
 *      carries the same numbers as hutrack-image.json.
 *
 * Honest limits: this is the engine image only.  It does not link either
 * bank into renderer/ilvm.bin or make a toy ROM (that is #213), and it does
 * not play a note (that is #215/#200).  Without PCEAS 4.x the build half is
 * SKIP, not a pass — the static vendor and macro-site checks still run.
 */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

const ROOT = path.join(__dirname, "..");
const VENDOR = path.join(ROOT, "vendor", "hutrack");
const SCRIPT = path.join(ROOT, "tools", "ilvm", "build-engine.sh");

const BANK_BYTES = 8192;
const CODE_BANK = 2;
const TABLES_BANK = 3;
const CODE_START = 0xa000;
const CODE_END = 0xbec4;
const CODE_BYTES = 7876;
const TABLES_START = 0x8000;
const TABLES_END = 0x8b34;
const TABLES_BYTES = 2868;

/* The three call sites the staged copy narrows, and the files they live in.
 * The line numbers are the vendored ones; the patch asserts the content. */
const PATCH_SITES = [
  { file: "HuTrack/HuTrack_lib.asm", line: 377, owner: "playSong" },
  { file: "HuTrack/engine/HuTrack_parser.asm", line: 31, owner: "Parser" },
  { file: "HuTrack/engine/HuTrack_parser.asm", line: 1774,
    owner: "Process.envelopes" },
];

/* docs/ROM-SOUND.md §7: what ilvm.c calls by fixed address. */
const INTERFACE = [
  "HuTrackTick", "HuTrackEngine.EngineCall", "HuTrackEngine.Init",
  "HuTrackEngine.QueueSong", "HuTrackEngine.playSong", "HuTrackEngine.stop",
  "HuTrackEngine.setChanForSFX", "HuTrackEngine.chanReleaseSFX",
  "HuTrack.returnVec", "_hk.R1", "_hk.EAX0",
];
const RAM = { "HuTrack.returnVec": 0x2200, "_hk.R1": 0x2080,
              "_hk.EAX0": 0x2086 };

let failures = 0;
function fail(msg) {
  failures++;
  console.log(`FAIL: ${msg}`);
}
function skip(msg) {
  console.log(`SKIP: ${msg}`);
}

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function walk(dir, base, out) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.lstatSync(p);
    if (st.isDirectory()) walk(p, base, out);
    else out.push(path.relative(base, p).split(path.sep).join("/"));
  }
  return out;
}

/* ---- 0. vendor/hutrack is byte-identical to its pristine copy ---- */
function checkVendorPristine(when) {
  const manifest = path.join(VENDOR, "MANIFEST.sha256");
  if (!fs.existsSync(manifest)) { fail("vendor/hutrack/MANIFEST.sha256 missing"); return; }
  const listed = new Set();
  let bad = 0;
  for (const line of fs.readFileSync(manifest, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const m = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (!m) { fail(`malformed manifest line: ${line}`); bad++; continue; }
    const [, hash, rel] = m;
    listed.add(rel);
    const p = path.join(VENDOR, rel);
    if (!fs.existsSync(p)) { fail(`vendored file missing: ${rel}`); bad++; continue; }
    if (sha256(fs.readFileSync(p)) !== hash) {
      fail(`vendored file modified ${when}: ${rel}`);
      bad++;
    }
  }
  const ours = new Set(["MANIFEST.sha256", "VENDORED.md"]);
  for (const rel of walk(VENDOR, VENDOR, [])) {
    if (!ours.has(rel) && !listed.has(rel)) {
      fail(`unlisted file in vendor/hutrack ${when}: ${rel}`); bad++;
    }
  }
  if (bad === 0)
    console.log(`vendor: ${listed.size} HuTrack files match MANIFEST.sha256 ${when}`);
}

function mapBank4CallSites() {
  const sites = [];
  const lib = path.join(VENDOR, "lib");
  for (const rel of walk(lib, lib, [])) {
    if (!rel.endsWith(".asm")) continue;
    const lines = fs.readFileSync(path.join(lib, rel), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (/^\s*_htk\.MAP_BANK\.4\s/.test(line))
        sites.push({ file: rel, line: i + 1, text: line.trim() });
    });
  }
  return sites;
}

function checkVendorSites() {
  const found = mapBank4CallSites();
  if (found.length !== PATCH_SITES.length) {
    fail(`vendor has ${found.length} MAP_BANK.4 call sites; expected ${PATCH_SITES.length}`);
    return;
  }
  for (const want of PATCH_SITES) {
    const hit = found.find((s) => s.file === want.file && s.line === want.line);
    if (!hit) fail(`vendor no MAP_BANK.4 at ${want.file}:${want.line} (${want.owner})`);
    else if (!/HuTrack\.song\.windowBank|#?\s*A,/.test(hit.text))
      fail(`${want.file}:${want.line} is not a window mapping: ${hit.text}`);
  }
  if (failures === 0)
    console.log(`vendor: exactly ${found.length} four-bank window call sites`);
}

/* ---- PCEAS 4.x ---- */
function pceas4() {
  const cmd = process.env.PCEAS4 || "pceas4";
  const r = cp.spawnSync(cmd, [], { encoding: "utf8" });
  return r.error ? null : cmd;
}

/* Line-by-line proof that the staged copy differs only at the patch. */
function checkStagedPatch(stage) {
  const stagedLib = path.join(stage, "lib");
  const vendorLib = path.join(VENDOR, "lib");
  let diffs = 0;
  const expected = PATCH_SITES.map((s) => ({ ...s, seen: false }));

  for (const rel of walk(vendorLib, vendorLib, [])) {
    if (!rel.endsWith(".asm") && !rel.endsWith(".inc")) continue;
    const vendored = fs.readFileSync(path.join(vendorLib, rel), "utf8").split("\n");
    const stagedPath = path.join(stagedLib, rel);
    const st = fs.lstatSync(stagedPath);
    if (st.isSymbolicLink()) { fail(`staged ${rel} is a symlink, not a copy`); continue; }
    if (!st.isFile()) { fail(`staged ${rel} is not a regular file`); continue; }
    const staged = fs.readFileSync(stagedPath, "utf8").split("\n");
    if (staged.length !== vendored.length) {
      fail(`staged ${rel} has ${staged.length} lines; vendor has ${vendored.length}`);
      continue;
    }
    staged.forEach((line, i) => {
      if (line === vendored[i]) return;
      diffs++;
      const site = expected.find((s) => s.file === rel && s.line === i + 1);
      if (!site) { fail(`staged ${rel}:${i + 1} changed outside the patch`); return; }
      site.seen = true;
      const want = vendored[i].replace("_htk.MAP_BANK.4 ", "_htk.MAP_BANK ");
      if (line !== want)
        fail(`staged ${rel}:${i + 1} is '${line}'; expected '${want}'`);
    });
  }
  if (diffs !== expected.length)
    fail(`staged copy differs at ${diffs} lines; expected exactly ${expected.length}`);
  for (const site of expected)
    if (!site.seen) fail(`patch site ${site.file}:${site.line} (${site.owner}) unchanged`);

  /* PUSHBANK.4/PULLBANK.4 are deliberately left alone (docs/ROM-SOUND.md §3). */
  const count = (tree, needle) => {
    let n = 0;
    for (const rel of walk(path.join(tree, "lib"), path.join(tree, "lib"), []))
      if (/\.(asm|inc)$/.test(rel))
        n += fs.readFileSync(path.join(tree, "lib", rel), "utf8")
               .split("\n").filter((l) => l.includes(needle)).length;
    return n;
  };
  for (const macro of ["_htk.PUSHBANK.4", "_htk.PULLBANK.4"]) {
    if (count(stage, macro) !== count(VENDOR, macro))
      fail(`${macro} changed in the staged copy`);
  }
  if (failures === 0)
    console.log("staged: a copy, differing from vendor at exactly the 3 window sites");
}

/* ---- 2/3. banks and symbols ---- */
function hex(n) { return "0x" + n.toString(16).toUpperCase(); }

function readManifest(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { fail(`tools/gen/hutrack-image.json: ${e.message}`); return null; }
}

function checkImage(out) {
  const codePath = path.join(out, "hutrack-code.bin");
  const tablesPath = path.join(out, "hutrack-tables.bin");
  const headerPath = path.join(out, "hutrack-symbols.h");
  const manifestPath = path.join(out, "hutrack-image.json");
  for (const p of [codePath, tablesPath, headerPath, manifestPath])
    if (!fs.existsSync(p)) { fail(`${path.basename(p)} missing`); return; }

  const code = fs.readFileSync(codePath);
  const tables = fs.readFileSync(tablesPath);
  const json = readManifest(manifestPath);
  if (!json) return;

  if (code.length !== BANK_BYTES)
    fail(`hutrack-code.bin is ${code.length} B; expected ${BANK_BYTES}`);
  if (tables.length !== BANK_BYTES)
    fail(`hutrack-tables.bin is ${tables.length} B; expected ${BANK_BYTES}`);

  const c = json.banks.code;
  const t = json.banks.tables;
  if (c.bank !== CODE_BANK || c.start !== CODE_START || c.end !== CODE_END ||
      c.bytes !== CODE_BYTES)
    fail(`code bank is ${hex(c.start)}-${hex(c.end)} (${c.bytes} B); expected ` +
         `${hex(CODE_START)}-${hex(CODE_END)} (${CODE_BYTES} B)`);
  if (t.bank !== TABLES_BANK || t.start !== TABLES_START || t.end !== TABLES_END ||
      t.bytes !== TABLES_BYTES)
    fail(`tables bank is ${hex(t.start)}-${hex(t.end)} (${t.bytes} B); expected ` +
         `${hex(TABLES_START)}-${hex(TABLES_END)} (${TABLES_BYTES} B)`);

  /* the used extent is not empty and the rest of each bank is erased ($FF) */
  for (const [name, buf, used] of [["code", code, CODE_BYTES],
                                   ["tables", tables, TABLES_BYTES]]) {
    if (buf[used - 1] === 0xff) fail(`${name} bank's last used byte is $FF`);
    for (let i = used; i < buf.length; i++)
      if (buf[i] !== 0xff) { fail(`${name} bank has data at ${hex(i)} past its extent`); break; }
  }

  /* the banks are the raw image's physical banks 2 and 3, byte for byte */
  const rawPath = path.join(out, "hutrack-stage", "engine.bin");
  if (!fs.existsSync(rawPath)) fail("staged engine.bin missing");
  else {
    const raw = fs.readFileSync(rawPath);
    if (raw.length !== 4 * BANK_BYTES)
      fail(`engine.bin is ${raw.length} B; expected ${4 * BANK_BYTES}`);
    else {
      const rawCode = raw.subarray(CODE_BANK * BANK_BYTES, (CODE_BANK + 1) * BANK_BYTES);
      const rawTables = raw.subarray(TABLES_BANK * BANK_BYTES,
                                     (TABLES_BANK + 1) * BANK_BYTES);
      if (!rawCode.equals(code)) fail("hutrack-code.bin is not engine.bin bank 2");
      if (!rawTables.equals(tables)) fail("hutrack-tables.bin is not engine.bin bank 3");
    }
  }

  /* every interface symbol is in the code bank (or RAM), in range */
  for (const name of INTERFACE) {
    const s = json.symbols[name];
    if (!s) { fail(`symbol ${name} missing from the image manifest`); continue; }
    if (name in RAM) {
      if (s.bank !== null) fail(`${name} has bank ${s.bank}; expected RAM`);
      if (s.addr !== RAM[name])
        fail(`${name} is at ${hex(s.addr)}; docs/ROM-SOUND.md §5 says ${hex(RAM[name])}`);
    } else {
      if (s.bank !== CODE_BANK)
        fail(`${name} is in bank ${s.bank}; expected the code bank ${CODE_BANK}`);
      if (s.addr < CODE_START || s.addr >= CODE_END)
        fail(`${name} at ${hex(s.addr)} is outside page 5`);
    }
  }

  /* the generated header carries the same numbers */
  const header = fs.readFileSync(headerPath, "utf8");
  const expectDefines = {
    HUTRACK_CODE_BANK: CODE_BANK,
    HUTRACK_CODE_BASE: CODE_START,
    HUTRACK_CODE_BYTES: CODE_BYTES,
    HUTRACK_TABLES_BANK: TABLES_BANK,
    HUTRACK_TABLES_BASE: TABLES_START,
    HUTRACK_TABLES_BYTES: TABLES_BYTES,
  };
  for (const [define, value] of Object.entries(expectDefines)) {
    const m = new RegExp(`^#define\\s+${define}\\s+(0x[0-9A-Fa-f]+|\\d+)`,
                         "m").exec(header);
    if (!m) { fail(`hutrack-symbols.h has no ${define}`); continue; }
    if (Number(m[1]) !== value)
      fail(`${define} is ${m[1]}; expected ${value}`);
  }
  for (const name of INTERFACE) {
    const s = json.symbols[name];
    if (!s) continue;
    const define = {
      HuTrackTick: "HUTRACK_TICK",
      "HuTrackEngine.EngineCall": "HUTRACK_ENGINE_CALL",
      "HuTrackEngine.Init": "HUTRACK_INIT",
      "HuTrackEngine.QueueSong": "HUTRACK_QUEUE_SONG",
      "HuTrackEngine.playSong": "HUTRACK_PLAY_SONG",
      "HuTrackEngine.stop": "HUTRACK_STOP",
      "HuTrackEngine.setChanForSFX": "HUTRACK_SET_CHAN_SFX",
      "HuTrackEngine.chanReleaseSFX": "HUTRACK_CHAN_RELEASE_SFX",
      "HuTrack.returnVec": "HUTRACK_RETURN_VEC",
      "_hk.R1": "HUTRACK_HK_R1",
      "_hk.EAX0": "HUTRACK_HK_EAX0",
    }[name];
    const m = new RegExp(`^#define\\s+${define}\\s+(0x[0-9A-Fa-f]+)`, "m")
      .exec(header);
    if (!m) fail(`hutrack-symbols.h has no ${define} for ${name}`);
    else if (Number(m[1]) !== s.addr)
      fail(`${define} is ${m[1]}; the .sym put ${name} at ${hex(s.addr)}`);
  }

  if (failures === 0)
    console.log(`image: code $A000-$BEC4 (${CODE_BYTES} B, 316 free), ` +
                `tables $8000-$8B34 (${TABLES_BYTES} B, 5324 free), ` +
                `${INTERFACE.length} symbols`);
}

/* ---- run ---- */
checkVendorPristine("before the build");
checkVendorSites();

const pceas = pceas4();
if (!pceas) {
  skip("PCEAS 4.x not found (PCEAS4 or pceas4): engine image not rebuilt");
} else {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "pce-hutrack-image-"));
  const r = cp.spawnSync("bash", [SCRIPT], {
    cwd: ROOT, encoding: "utf8",
    env: { ...process.env, PCEAS4: pceas, OUT: out },
  });
  if (r.status !== 0) {
    fail(`tools/ilvm/build-engine.sh exited ${r.status}`);
    console.log((r.stderr || r.stdout || "").split("\n").slice(-15)
      .map((l) => "    " + l).join("\n"));
  } else {
    checkStagedPatch(path.join(out, "hutrack-stage"));
    checkImage(out);
    checkVendorPristine("after the build");
  }
  fs.rmSync(out, { recursive: true, force: true });
}

if (failures) {
  console.log(`\ncheck-hutrack-image: ${failures} failure(s)`);
  process.exit(1);
}
console.log("check-hutrack-image: PASS");
