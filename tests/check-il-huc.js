#!/usr/bin/env node
/*
 * tests/check-il-huc.js — #31 part B's evidence: the same IL through HuC
 * instead of llvm-mos, run in Mednafen, compared with the browser's own run
 * of the same toys.
 *
 * What is checked:
 *
 *   1. The HuC dialect of the emitter.  renderer/pce-cgen.js with
 *      {target: "huc"} emits C that HuC's compiler accepts: int (16-bit)
 *      instead of int32_t, no <stdint.h>, no __attribute__, no initialiser
 *      lists on local arrays, declarations before statements, and the same
 *      IL lowering.  The default dialect's output is untouched (asserted by
 *      part A/C's committed ROMs rebuilding, in check-il-console.js).  The
 *      refusals still come back by code.  #91 (REVIEW-78 H01/H04/H05) adds
 *      the dialect's three edges: 65535 emitted as (-1), the `>>` helper's
 *      guard at 16 bits, and four argument slots for a three-parameter
 *      function — the first and third also compiled through vendor HuC.
 *
 *   2. The ROMs rebuild.  tools/build-huc.sh (HuC's own compiler and
 *      PCEAS, fetched and built by the script itself as an external tool
 *      under /Volumes/External/pce-tools, #152) builds the palette and
 *      parallax toys; their sha256 must equal the committed dumps'
 *      meta.json.  Without HuC the section prints SKIP (the llvm-mos/PCEAS
 *      rule) and the dumps are still checked.
 *
 *   3. The console ran the same toys.  tests/dumps/palette-huc/frames/ and
 *      tests/dumps/parallax-huc/frames/ hold every video frame Mednafen
 *      recorded.  Captured frames are hashed and matched to the browser's
 *      frames (renderer/pce-toys.js); at least eight consecutive browser
 *      frames must be present in order, each a full pixel diff 0.  The
 *      palette toy is compared across its 8-frame colour cycle; the raster
 *      toy exactly as check-il-console.js compares part C's.
 *
 *   4. The state and the cost.  vram/cram/sat are byte-equal to the
 *      browser's at the matched frame (CR carries the runtime's VC/RC
 *      enables in the raster toy, as in part C).  The TMA timer sums in the
 *      save's BaseRAM measure cycles per frame() and per raster() call.
 *      These are the numbers docs/IL.md §12's table uses; the bounds here
 *      are sanity bounds, not the comparison.
 *
 * Written by @design because the card names this evidence; per workshop
 * rule 2 a cold break by another seat is owed.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const toys = require("../renderer/pce-toys.js");
const il = require("../renderer/pce-il.js");
const cgen = require("../renderer/pce-cgen.js");
const ilTest = require("./check-il.js");

const ROOT = path.join(__dirname, "..");
const HUC_DEFAULT = "/Volumes/External/pce-tools/huc-src";
const PALETTE_FILE = path.join(ROOT, "tools/toys/palette.lua");
const RASTER_FILE = path.join(ROOT, "toys/parallax.lua");
const PALETTE_DUMP = path.join(ROOT, "tests/dumps/palette-huc");
const RASTER_DUMP = path.join(ROOT, "tests/dumps/parallax-huc");
const PALETTE_RUNS = 8;                 /* one full colour cycle */
const RASTER_RUNS = 8;                  /* consecutive raster frames */

let checks = 0;
let failures = [];
let skipped = [];

function check(ok, name) {
  checks++;
  if (!ok) { failures.push(name); console.log("FAIL  " + name); }
}
function eq(name, got, want) {
  check(JSON.stringify(got) === JSON.stringify(want),
        name + " (got " + JSON.stringify(got) + ", want " +
        JSON.stringify(want) + ")");
}

/* ---- a minimal PNG reader: 8-bit RGB, non-interlaced (the same reader as
 * check-il-console.js; kept local so the two suites stay independent) ---- */

function decodePng(buf) {
  if (buf.slice(0, 8).toString("latin1") !== "\x89PNG\r\n\x1a\n") {
    throw new Error("not a PNG");
  }
  let pos = 8, width = 0, height = 0, bitDepth = 0, colourType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.slice(pos + 4, pos + 8).toString("latin1");
    const body = buf.slice(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      bitDepth = body[8]; colourType = body[9];
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
  }
  if (bitDepth !== 8 || colourType !== 2) {
    throw new Error("PNG must be 8-bit RGB");
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 3;
  const out = Buffer.alloc(width * height * 3);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = Buffer.from(raw.slice(p, p + stride));
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? line[i - 3] : 0;
      const b = prev[i];
      const c = i >= 3 ? prev[i - 3] : 0;
      let v = line[i];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      line[i] = v;
    }
    for (let x = 0; x < width; x++) {
      out[(y * width + x) * 3] = line[x * 3];
      out[(y * width + x) * 3 + 1] = line[x * 3 + 1];
      out[(y * width + x) * 3 + 2] = line[x * 3 + 2];
    }
    prev = line;
  }
  return { width: width, height: height, pixels: out };
}

function diff(a, b) {
  const n = Math.min(a.length, b.length);
  let count = 0, first = -1;
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) { if (first < 0) first = i; count++; }
  }
  return { n: count, first: first, lengths: [a.length, b.length] };
}

function frameHash(pixels) {
  let h = 0x811c9dc5;
  for (let i = 0; i < pixels.length; i += 97) {
    h ^= pixels[i];
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

/* ---- 1. the HuC C dialect -------------------------------------------- */

function refusal(name, source, code) {
  try {
    const program = il.compile(source, { chunkName: "refusal.lua" });
    cgen.emitC(program, { target: "huc" });
    check(false, "HuC refusal " + name + " was accepted (wanted " + code + ")");
  } catch (e) {
    check(e instanceof cgen.CGenError && e.code === code,
          "HuC refusal " + name + " code " + (e && e.code) + " (wanted " +
          code + ")");
  }
}

function checkDialect() {
  const source = fs.readFileSync(PALETTE_FILE, "utf8");
  const program = il.compile(source, { chunkName: "palette.lua" });
  const huc = cgen.emitC(program, { target: "huc" });
  eq("the HuC emitter is deterministic", huc,
     cgen.emitC(program, { target: "huc" }));

  check(!/\bint32_t\b/.test(huc) && !/\buint32_t\b/.test(huc),
        "the HuC C carries no 32-bit type (HuC's int is 16 bits)");
  check(!/#include\s*<stdint\.h>/.test(huc) &&
        !/__attribute__/.test(huc),
        "the HuC C carries no stdint.h and no llvm-mos attributes");
  check(/void toy_boot\(void\)/.test(huc) &&
        /void toy_frame\(int f\)/.test(huc),
        "the HuC C has the boot/frame entry points over int");
  check(/static int il_fn_0\(struct il_closure \*cl, int a0, int a1\) \{/.test(huc),
        "the IL functions are C functions over 16-bit ints");
  check(/toy_pal\(|toy_vram_set\(/.test(huc),
        "the toy surface is the same runtime calls");
  check(!/int [A-Za-z_][A-Za-z0-9_]*\[[0-9]+\] = \{/.test(huc),
        "no local array initialiser list (HuC cannot compile one)");
  /* HuC cannot initialise a local array, so the registers the IL would
   * read as 0 are zeroed explicitly.  The linear pass must actually fire
   * for this toy (it does; the Huc run below would be the silent
   * difference otherwise). */
  check(/\n  r\[\d+\] = 0;/.test(huc),
        "registers read before any write are zeroed explicitly " +
        "(HuC has no local initialiser list)");

  const raster = cgen.emitC(
    il.compile(fs.readFileSync(RASTER_FILE, "utf8"), { chunkName: "p.lua" }),
    { target: "huc" });
  check(/void toy_raster\(int line\)/.test(raster),
        "the raster hook lowers to toy_raster(int line) under HuC");
  check(/il_lua_idiv\(/.test(raster),
        "Lua's // is still the floor helper under HuC");

  /* The defaults did not move: part A/C emit the llvm-mos dialect. */
  const llvm = cgen.emitC(program);
  check(/int32_t/.test(llvm) && /void toy_frame\(int32_t f\)/.test(llvm),
        "the default dialect is still llvm-mos's int32_t C");

  refusal("a sprite instruction (no SAT writes on the console yet)", `
function init() sprite(0, {x = 1, y = 2}) end
function frame(t, f) end`, "cgen-op");
  refusal("a fixed-point constant", `
function init() local x = 1.5 print(x) end
function frame(t, f) end`, "cgen-fixed");
  refusal("a constant wider than HuC's 16-bit int", `
function init() pal(1, 70000) end
function frame(t, f) end`, "cgen-width");
  refusal("no frame hook", `
function init() end`, "cgen-hook");
  refusal("five parameters", `
local function f(a, b, c, d, e) return a end
function init() f(1, 2, 3, 4, 5) end
function frame(t, f) end`, "cgen-arity");

  /* ---- #91 / REVIEW-78 H01/H04/H05: the dialect's edges -------------- *
   * The two shipped toys never reach these branches — they use no `>>`, no
   * function with exactly three parameters, and no constant at the 16-bit
   * boundary — so the pinned ROM shas proved the two ROMs, not the dialect.
   * One fixture per edge, at the emitter (always) and through the real
   * HuC toolchain where it is present. */
  function emitHuc(source, chunkName) {
    try {
      return { c: cgen.emitC(il.compile(source, { chunkName: chunkName }),
                             { target: "huc" }) };
    } catch (e) {
      return { error: e };
    }
  }

  /* H01: HuC's `int` is a 16-bit signed int, so 65535 is the bit pattern of
   * -1.  The range check's top value is 65535; dropping it refuses a
   * constant HuC represents legally. */
  /* The constant rides in a local and is reduced to a legal BXR so the
   * validator's range checks have nothing to refuse: the edge under test is
   * the emitter's 16-bit width, not a register's range. */
  const boundary = emitHuc(`function frame(t, f)
  local v = 65535
  reg("BXR", v % 1024)
end`, "huc-const.lua");
  check(!boundary.error,
        "H01: the HuC emitter accepts 65535 (the 16-bit boundary)" +
        (boundary.error ? ": refused with " +
          (boundary.error.code || boundary.error.message) : ""));
  check(!!boundary.c && /r\[\d+\] = \(-1\);/.test(boundary.c),
        "H01: 65535 is emitted as (-1), the 16-bit value HuC compiles" +
        (boundary.c ? "" : " (no C was emitted)"));

  /* H04: a runtime right shift.  The helper's guard is the dialect's width
   * (16 for HuC, 32 for llvm-mos); 32 leaves a count the 16-bit int cannot
   * hold.  Both guards compile, so the emitter's text is the witness. */
  const shr = emitHuc(`local function half(x) return x >> 1 end
function frame(t, f) local v = half(20) reg("BXR", v) end`, "huc-shr.lua");
  const shrGuard = shr.c &&
    /static int il_lua_shr\(int x, int n\) \{\s*if \(n < 0 \|\| n >= (\d+)\)/.exec(shr.c);
  check(!!shrGuard && shrGuard[1] === "16",
        "H04: the HuC right-shift guard refuses a count >= 16 (HuC's int is " +
        "16 bits)" + (shrGuard ? ", got " + shrGuard[1] : ", no helper emitted"));

  /* H05: exactly three parameters.  The argument-slot rule is "more than
   * two", so a three-parameter function must get all four slots; at "> 3"
   * it gets two, and `r[2] = a2` names a variable its signature lacks. */
  const three = emitHuc(`local function mix(a, b, c) return a + b + c end
function frame(t, f) reg("BXR", mix(1, 2, 3)) end`, "huc-three.lua");
  check(!!three.c &&
        /static int il_fn_0\(struct il_closure \*cl, int a0, int a1, int a2, int a3\) \{/.test(three.c),
        "H05: a three-parameter function gets four argument slots" +
        (three.c ? "" : " (no C was emitted)"));

  /* The two programs whose evidence is the compiler itself.  H04's guard
   * is an emitter branch both values compile through, so it stays above. */
  const tool = hucToolchain();
  if (!tool) {
    skipped.push("the H01/H05 edge programs' HuC build");
    console.log("SKIP  the H01/H05 edge programs' HuC build: HuC not found");
  } else {
    const programs = [
      ["huc-edge-const", `function frame(t, f)
  local v = 65535
  reg("BXR", v % 1024)
end`],
      ["huc-edge-three", `local function mix(a, b, c) return a + b + c end
function frame(t, f) reg("BXR", mix(1, 2, 3)) end`]
    ];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pce91-huc-"));
    for (const [name, source] of programs) {
      const file = path.join(dir, name.replace("huc-edge-", "") + ".lua");
      fs.writeFileSync(file, source);
      const r = spawnSync(path.join(ROOT, "tools/build-huc.sh"),
                          [file, name],
                          { cwd: ROOT, encoding: "utf8",
                            env: Object.assign({}, process.env,
                                               { HUC_DIR: tool }) });
      check(r.status === 0, "the " + name + " edge program compiles through " +
            "HuC (" + (r.status === 0 ? "built" :
              (r.stderr || r.stdout || "").trim().split("\n").slice(-1)[0]) +
            ")");
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ---- 2. the ROMs rebuild --------------------------------------------- */

function hucToolchain() {
  const dir = process.env.HUC_DIR || HUC_DEFAULT;
  return fs.existsSync(path.join(dir, "bin/huc")) &&
         fs.existsSync(path.join(dir, "bin/pceas")) ? dir : null;
}

/* ---- 3/4. the console's frames, state and cost ------------------------ */

function loadMovie(dir, count) {
  const frameDir = path.join(dir, "frames");
  const files = fs.readdirSync(frameDir).filter(function (f) {
    return /^frame\d+\.png$/.test(f);
  }).sort();
  const take = files.slice(-count);
  return {
    files: take,
    movie: take.map(function (f) {
      return decodePng(fs.readFileSync(path.join(frameDir, f)));
    })
  };
}

/* Match captured frames to browser frames by hash, confirm each with a full
 * pixel diff, and return the longest run of consecutive browser frames seen
 * in order. */
function matchRun(movie, want) {
  const byHash = new Map();
  want.forEach(function (w, f) {
    const h = frameHash(w.pixels);
    if (!byHash.has(h)) byHash.set(h, []);
    byHash.get(h).push(f);
  });
  const matches = [];
  movie.forEach(function (img, i) {
    const candidates = byHash.get(frameHash(img.pixels)) || [];
    for (let k = 0; k < candidates.length; k++) {
      if (diff(img.pixels, want[candidates[k]].pixels).n === 0) {
        matches.push({ captured: i, browser: candidates[k] });
        break;
      }
    }
  });
  let best = [], run = matches.length ? [matches[0]] : [];
  for (let i = 1; i < matches.length; i++) {
    if (matches[i].browser === matches[i - 1].browser + 1 &&
        matches[i].captured > matches[i - 1].captured) {
      run.push(matches[i]);
    } else {
      if (run.length > best.length) best = run;
      run = [matches[i]];
    }
  }
  if (run.length > best.length) best = run;
  return { matches: matches, best: best };
}

function checkPaletteDump(meta) {
  const dir = PALETTE_DUMP;
  if (!fs.existsSync(path.join(dir, "meta.json"))) {
    check(false, "tests/dumps/palette-huc/meta.json exists " +
          "(run tools/capture-huc.sh palette tools/toys/palette.lua)");
    return;
  }
  const { files, movie } = loadMovie(dir, 32);
  check(files.length >= PALETTE_RUNS,
        "the HuC palette dump carries frames (" + files.length + ")");
  if (files.length < PALETTE_RUNS) return;
  check(movie.every(function (m) {
    return m.width === toys.WIDTH && m.height === toys.HEIGHT;
  }), "every HuC palette frame is " + toys.WIDTH + "x" + toys.HEIGHT);

  const browser = toys.create(fs.readFileSync(PALETTE_FILE, "utf8"),
                              { budgetMs: 500 });
  browser.load();
  const want = [];
  for (let f = 0; f < 40; f++) want.push(browser.frame(f));
  const { matches, best } = matchRun(movie, want);
  check(best.length >= PALETTE_RUNS,
        "at least " + PALETTE_RUNS + " consecutive browser frames are present " +
        "in the HuC palette capture (" + best.length + ")");
  if (best.length < PALETTE_RUNS) { browser.dispose(); return; }

  let total = 0;
  for (let i = 0; i < best.length; i++) {
    const d = diff(movie[best[i].captured].pixels,
                   want[best[i].browser].pixels);
    total += d.n;
    check(d.n === 0, "HuC palette frame " + files[best[i].captured] +
          " is diff 0 against the browser's frame " + best[i].browser);
  }
  eq("every matched HuC palette frame is diff 0", total, 0);

  /* The save is a display frame; the last matched one is the state's. */
  const lastF = best[best.length - 1].browser;
  const st = want[lastF].state;
  eq("the HuC palette toy's vram is byte-equal to the browser's",
     diff(Buffer.from(st.vram), fs.readFileSync(path.join(dir, "vram.bin"))).n, 0);
  eq("the HuC palette toy's cram is byte-equal to the browser's",
     diff(Buffer.from(st.cram), fs.readFileSync(path.join(dir, "cram.bin"))).n, 0);
  eq("the HuC palette toy's sat is byte-equal to the browser's",
     diff(Buffer.from(st.sat), fs.readFileSync(path.join(dir, "sat.bin"))).n, 0);

  const m = meta.capture.measure;
  check(m.count > 100, "the timer measured the HuC palette frames (" +
        m.count + ")");
  check(m.cycles_per_frame > 5000 && m.cycles_per_frame < 200000,
        "HuC frame() measures " + m.cycles_per_frame.toFixed(0) + " cycles");
  console.log("      HuC palette: " + matches.length + " captured frames " +
              "matched, run of " + best.length + "; frame() " +
              m.cycles_per_frame.toFixed(0) + " cycles (" +
              (m.cycles_per_frame / 119318 * 100).toFixed(0) + "% of a video " +
              "frame); ROM " + meta.rom_bytes + " B");
  browser.dispose();
}

function checkRasterDump(meta) {
  const dir = RASTER_DUMP;
  if (!fs.existsSync(path.join(dir, "meta.json"))) {
    check(false, "tests/dumps/parallax-huc/meta.json exists " +
          "(run tools/capture-huc.sh parallax toys/parallax.lua)");
    return;
  }
  const { files, movie } = loadMovie(dir, 200);
  check(files.length > 100,
        "the HuC raster dump carries a long recording (" + files.length + ")");
  if (files.length <= 100) return;

  const browser = toys.create(fs.readFileSync(RASTER_FILE, "utf8"),
                              { budgetMs: 2000 });
  browser.load();
  const want = [];
  for (let f = 0; f < 60; f++) want.push(browser.frame(f));
  const { matches, best } = matchRun(movie, want);
  check(best.length >= RASTER_RUNS,
        "at least " + RASTER_RUNS + " consecutive browser frames are present " +
        "in the HuC raster capture (" + best.length + ")");
  if (best.length < RASTER_RUNS) { browser.dispose(); return; }

  let total = 0;
  for (let i = 0; i < best.length; i++) {
    const d = diff(movie[best[i].captured].pixels, want[best[i].browser].pixels);
    total += d.n;
    check(d.n === 0, "HuC raster display frame " + files[best[i].captured] +
          " is diff 0 against the browser's frame " + best[i].browser);
  }
  eq("every matched HuC raster frame is diff 0", total, 0);

  const lastF = best[best.length - 1].browser;
  const st = want[lastF].state;
  const vram = fs.readFileSync(path.join(dir, "vram.bin"));
  const cram = fs.readFileSync(path.join(dir, "cram.bin"));
  const sat = fs.readFileSync(path.join(dir, "sat.bin"));
  const regs = JSON.parse(fs.readFileSync(path.join(dir, "regs.json")));
  eq("the HuC raster toy's vram is byte-equal to the browser's",
     diff(Buffer.from(st.vram), vram).n, 0);
  eq("the HuC raster toy's cram is byte-equal to the browser's",
     diff(Buffer.from(st.cram), cram).n, 0);
  eq("the HuC raster toy's sat is byte-equal to the browser's",
     diff(Buffer.from(st.sat), sat).n, 0);
  eq("BYR/MWR equal", [regs.BYR, regs.MWR], [st.regs.BYR, st.regs.MWR]);
  eq("CR is the browser's with only the VBlank and RCR enables set",
     regs.CR, st.regs.CR | 0x0C);

  const m = meta.capture.measure;
  check(m.raster_calls > 1000,
        "the timer measured the HuC raster calls (" + m.raster_calls + ")");
  check(m.cycles_per_raster_call > 123 && m.cycles_per_raster_call < 20000,
        "one HuC raster() call measures " +
        m.cycles_per_raster_call.toFixed(0) + " cycles, over the " +
        "~123-cycle blank");
  check(m.cycles_per_collection > 50000 && m.cycles_per_collection < 2000000,
        "one HuC 224-call collection measures " +
        m.cycles_per_collection.toFixed(0) + " cycles");
  eq("no console-side list overflowed and no vset came from raster()",
     m.flags, 0);

  console.log("      HuC raster: " + matches.length + " captured frames " +
              "matched, run of " + best.length + "; " +
              m.cycles_per_raster_call.toFixed(0) + " cycles/call, " +
              m.cycles_per_collection.toFixed(0) + " cycles/collection (" +
              (m.cycles_per_collection / 119318).toFixed(2) + " video frames), " +
              "frame() " + m.cycles_per_frame.toFixed(0) + " cycles; ROM " +
              meta.rom_bytes + " B");
  browser.dispose();
}

/* ---- 0. nothing may read the vendored HuC copy ------------------------ *
 * #152: the public repo ships without the vendored copy, so nothing under
 * tools/, tests/ or renderer/ may reference it — tools/build-huc.sh
 * fetches the toolchain itself.  The needle is split below so this very
 * file does not contain the path it greps for. */
function checkNoVendoredReads() {
  const needle = "vendor/" + "huc";
  const r = spawnSync("git", ["grep", "-l", "-F", "-e", needle, "--",
                              "tools", "tests", "renderer"],
                      { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0 && r.status !== 1) {
    check(false, "the vendored-copy grep runs (git grep exit " + r.status +
          ": " + (r.stderr || "").trim() + ")");
    return;
  }
  const hits = (r.stdout || "").trim().split("\n").filter(Boolean);
  check(hits.length === 0,
        "nothing in tools/, tests/ or renderer/ references the vendored " +
        "HuC copy" + (hits.length ? ": " + hits.join(", ") : ""));
}

/* ---- main ------------------------------------------------------------- */

function rebuildAndCompare(tool, name, toy, dump) {
  const metaPath = path.join(dump, "meta.json");
  if (!fs.existsSync(metaPath)) return;
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  eq("the HuC dump's route is huc", meta.route, "huc");
  eq("the HuC dump's toy is " + path.relative(ROOT, toy),
     path.basename(meta.source), path.basename(toy));
  const dir = tool || hucToolchain();
  if (!dir) {
    skipped.push(name + " ROM rebuild (HuC not found)");
    console.log("SKIP  " + name + " ROM rebuild: HuC not found");
    return meta;
  }
  const r = spawnSync(path.join(ROOT, "tools/build-huc.sh"),
                      [toy, name], { cwd: ROOT, encoding: "utf8",
                                       env: Object.assign({}, process.env,
                                                          { HUC_DIR: dir }) });
  check(r.status === 0, "tools/build-huc.sh (" + name + ") exits 0" +
        (r.status === 0 ? "" : ": " + (r.stderr || "").trim().split("\n")
          .slice(-1)[0]));
  if (r.status !== 0) return meta;
  const romPath = path.join(ROOT, "tools/gen/" + name + "-huc.pce");
  const rom = fs.readFileSync(romPath);
  const sha = crypto.createHash("sha256").update(rom).digest("hex");
  eq("the rebuilt " + name + " HuC ROM is byte-equal to the committed one",
     sha, meta.rom_sha256);
  eq("the " + name + " HuC ROM size", rom.length, meta.rom_bytes);
  return meta;
}

function main() {
  checkNoVendoredReads();
  checkDialect();

  const paletteMeta = rebuildAndCompare(null, "palette", PALETTE_FILE,
                                        PALETTE_DUMP);
  if (paletteMeta) checkPaletteDump(paletteMeta);

  const rasterMeta = rebuildAndCompare(null, "parallax", RASTER_FILE,
                                       RASTER_DUMP);
  if (rasterMeta) checkRasterDump(rasterMeta);

  if (failures.length) {
    console.log("FAIL  " + failures.length + " of " + checks + " checks failed" +
                (skipped.length ? " (" + skipped.length + " skipped)" : ""));
    process.exit(1);
  }
  console.log("PASS  " + checks + " checks, #31 part B: IL -> C -> HuC -> " +
              "Mednafen equals the browser's toys" +
              (skipped.length ? "; SKIP " + skipped.join("; ") : ""));
}

main();
