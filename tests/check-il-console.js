#!/usr/bin/env node
/*
 * tests/check-il-console.js — #31 part A's evidence: the palette toy through
 * IL → C → llvm-mos → a HuCard ROM, run in Mednafen, compared with the
 * browser's own run of the same toy.
 *
 * Four things are checked:
 *
 *   1. The emitter is real and refuses by code.  renderer/pce-cgen.js turns
 *      the IL into C; the emitted program has toy_boot/toy_frame, lowers the
 *      palette writes and reads to the runtime's port functions, and is
 *      deterministic.  Constructs outside part A's scope raise cgen-op,
 *      cgen-fixed, cgen-hook, cgen-arity, cgen-closure-loop, cgen-target,
 *      cgen-global and cgen-key (with the offending IL line).
 *
 *   2. The ROM is reproducible.  tools/build-toyc.sh (llvm-mos's mos-pce-clang
 *      -Os) rebuilds tools/gen/toypalette.pce; its sha256 must equal the
 *      committed dump's meta.json.  Without llvm-mos on the machine this
 *      section prints SKIP and the dump checks still run (the same rule as
 *      check-hutrack's PCEAS rebuild).
 *
 *   3. The console ran the same toy.  tests/dumps/toypalette/frames/ holds
 *      every video frame Mednafen recorded.  The last 8 are compared with the
 *      browser's frames f0..f0+7 (renderer/pce-toys.js, the Fengari runtime);
 *      exactly one alignment f0 in 0..7 must make every frame diff 0, and all
 *      8 are then required byte-equal.
 *
 *   4. The console's state is the browser's.  vram.bin, cram.bin and sat.bin
 *      are byte-equal to the browser runtime's at the aligned frame, and the
 *      captured VDC registers equal its BXR/BYR/MWR/CR — except CR bit 3,
 *      which the runtime sets only so the VDC generates the VBlank status bit
 *      the frame loop waits on (Mednafen's DoVBIRQTest tests CR & 0x08).  It
 *      does not change the picture; the check asserts it is the only
 *      difference and says why.
 *
 * The captured RAM also carries the TMA timer measurement (BaseRAM $2100):
 * frame() is bracketed by timer reads, so the report is Mednafen's own
 * timing, one tick per 1024 CPU clocks, not an estimate.  Code sizes come
 * from the build's llvm-size/llvm-nm report in meta.json.
 *
 * Written by @design because the card names this evidence; per workshop
 * rule 2 a cold break by another seat is owed.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { spawnSync } = require("child_process");

const toys = require("../renderer/pce-toys.js");
const il = require("../renderer/pce-il.js");
const cgen = require("../renderer/pce-cgen.js");
const ilTest = require("./check-il.js");      /* the one toy source */

const ROOT = path.join(__dirname, "..");
const DUMP = path.join(ROOT, "tests/dumps/toypalette");
const TOY_FILE = path.join(ROOT, "tools/toys/palette.lua");
const LLVM_DEFAULT = "/Volumes/External II/pce-tools/llvm-mos/llvm-mos";
const FRAMES = 8;                              /* one palette cycle */

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

/* ---- a minimal PNG reader: 8-bit RGB, non-interlaced ------------------ */

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

/* ---- 1. the emitter ---------------------------------------------------- */

function checkEmitter() {
  const source = fs.readFileSync(TOY_FILE, "utf8");
  eq("tools/toys/palette.lua is tests/check-il.js's TOY_PALETTE",
     source, ilTest.TOY_PALETTE);

  const program = il.compile(source, { chunkName: "palette.lua" });
  const c = cgen.emitC(program);
  const c2 = cgen.emitC(program);
  eq("the C emitter is deterministic", c, c2);
  check(/void toy_boot\(void\)/.test(c) && /void toy_frame\(int32_t f\)/.test(c),
        "the C has the boot/frame entry points");
  check(/toy_pal\(/.test(c), "the IL pal instruction lowers to toy_pal()");
  check(/toy_vram_set\(/.test(c), "the IL vset instruction lowers to toy_vram_set()");
  check(/il_fn_4/.test(c) && /il_lua_mod\(/.test(c),
        "the frame function and Lua's modulo helper are emitted");
  check(!/\b(double|float)\b/.test(c), "the C carries no floating-point type");
}

/* ---- 2. the emitter refuses by code ----------------------------------- */

function refusal(name, source, code, mutate) {
  let program = null;
  try {
    program = il.compile(source, { chunkName: "refusal.lua" });
    if (mutate) mutate(program);
    cgen.emitC(program);
    check(false, "cgen refusal " + name + " was accepted (wanted " + code + ")");
  } catch (e) {
    check(e instanceof cgen.CGenError && e.code === code,
          "cgen refusal " + name + " code " + (e && e.code) +
          " (wanted " + code + "): " + (e && e.message));
  }
}

function checkRefusals() {
  refusal("a reg() instruction (no VDC register writes in part A)", `
function init() reg("BXR", 1) end
function frame(t, f) end`, "cgen-op");
  refusal("a fixed-point constant", `
function init() local x = 1.5 print(x) end
function frame(t, f) end`, "cgen-fixed");
  refusal("a fixed-point parameter that is read", `
function frame(t, f) print(t) end`, "cgen-fixed");
  refusal("no frame hook", `
function init() end`, "cgen-hook");
  refusal("three parameters", `
local function f(a, b, c) return a end
function init() f(1, 2, 3) end
function frame(t, f) end`, "cgen-arity");
  refusal("a closure created in a loop", `
function frame(t, f)
  local i = 0
  while i < 2 do
    local g = function() return i end
    i = i + 1
  end
end`, "cgen-closure-loop");
  refusal("an int global", `
x = 5
function init() end
function frame(t, f) vram[0] = x end`, "cgen-global");
  refusal("a string constant", ilTest.TOY_PALETTE, "cgen-key", function (p) {
    const fn = p.functions[p.hooks.frame];
    const ins = fn.code.filter(function (i) { return i.t === "const"; })[0];
    ins.k = { t: "str", v: "hello" };
  });
  refusal("a jump target past the function", ilTest.TOY_PALETTE, "cgen-target",
          function (p) {
    const fn = p.functions[p.hooks.frame];
    const ins = fn.code.filter(function (i) {
      return i.t === "jmp" || i.t === "br" || i.t === "fornext";
    })[0];
    ins.target = 9999;
  });
}

/* ---- 3. the ROM is reproducible --------------------------------------- */

function checkRebuild(meta) {
  const llvm = process.env.LLVM_MOS || LLVM_DEFAULT;
  if (!fs.existsSync(path.join(llvm, "bin/mos-pce-clang"))) {
    skipped.push("ROM rebuild (llvm-mos not found at " + llvm + ")");
    console.log("SKIP  ROM rebuild: llvm-mos not found at " + llvm);
    return;
  }
  const r = spawnSync(path.join(ROOT, "tools/build-toyc.sh"),
                      [TOY_FILE, "toypalette"],
                      { cwd: ROOT, encoding: "utf8", env: process.env });
  check(r.status === 0, "tools/build-toyc.sh exits 0 (" +
        (r.stderr || "").trim().split("\n").slice(-1)[0] + ")");
  if (r.status !== 0) return;
  const rom = fs.readFileSync(path.join(ROOT, "tools/gen/toypalette.pce"));
  const crypto = require("crypto");
  const sha = crypto.createHash("sha256").update(rom).digest("hex");
  eq("the rebuilt ROM is byte-equal to the committed ROM",
     sha, meta.rom_sha256);
  eq("the ROM is the 8 KiB fixed bank", rom.length, meta.rom_bytes);
  eq("the ROM is 8192 bytes", rom.length, 8192);
}

/* ---- 4. the console's frames and state -------------------------------- */

function checkDump(meta) {
  const frameDir = path.join(DUMP, "frames");
  const files = fs.readdirSync(frameDir).filter(function (f) {
    return /^frame\d+\.png$/.test(f);
  }).sort();
  check(files.length >= FRAMES,
        "the dump carries at least " + FRAMES + " recorded frames (" +
        files.length + ")");
  if (files.length < FRAMES) return;

  const movie = files.slice(-FRAMES).map(function (f) {
    return decodePng(fs.readFileSync(path.join(frameDir, f)));
  });
  check(movie.every(function (m) {
    return m.width === toys.WIDTH && m.height === toys.HEIGHT;
  }), "every recorded frame is " + toys.WIDTH + "x" + toys.HEIGHT);

  const browser = toys.create(ilTest.TOY_PALETTE, { budgetMs: 500 });
  browser.load();
  const want = [];
  for (let f = 0; f < 16; f++) want.push(browser.frame(f));

  const alignments = [];
  for (let f0 = 0; f0 < 8; f0++) {
    let ok = true;
    for (let i = 0; i < FRAMES; i++) {
      const d = diff(movie[i].pixels, want[(f0 + i) % 8].pixels);
      if (d.n !== 0) { ok = false; break; }
    }
    if (ok) alignments.push(f0);
  }
  eq("exactly one frame alignment matches the browser's run", alignments.length, 1);
  if (alignments.length !== 1) { browser.dispose(); return; }

  const f0 = alignments[0];
  let total = 0;
  for (let i = 0; i < FRAMES; i++) {
    const d = diff(movie[i].pixels, want[(f0 + i) % 8].pixels);
    total += d.n;
    check(d.n === 0, "console frame f" + (f0 + i) + " is diff 0 against " +
          "the browser's frame f" + (f0 + i) +
          (d.n ? " (first byte " + d.first + ")" : ""));
  }
  eq("all " + FRAMES + " console frames are diff 0", total, 0);

  /* The captured state is the browser's state at the frame whose picture the
   * save followed.  The palette repeats every 8 frames, so search one cycle
   * (the aligned window) and require exactly one state match. */
  const vram = fs.readFileSync(path.join(DUMP, "vram.bin"));
  const cram = fs.readFileSync(path.join(DUMP, "cram.bin"));
  const sat = fs.readFileSync(path.join(DUMP, "sat.bin"));
  const regs = JSON.parse(fs.readFileSync(path.join(DUMP, "regs.json")));
  const lastAligned = (f0 + FRAMES - 1) % 8;

  let stateMatches = [];
  for (let i = 0; i < FRAMES; i++) {
    const st = want[(f0 + i) % 8].state;
    if (diff(Buffer.from(st.vram), vram).n === 0 &&
        diff(Buffer.from(st.cram), cram).n === 0 &&
        diff(Buffer.from(st.sat), sat).n === 0) {
      stateMatches.push((f0 + i) % 8);
    }
  }
  eq("exactly one browser frame in the window has the captured state",
     stateMatches.length, 1);
  if (stateMatches.length === 1) {
    const fm = stateMatches[0];
    check(Math.abs(((fm - lastAligned + 8) % 8)) <= 1,
          "the captured state is the last displayed frame's (" + fm +
          " vs " + lastAligned + ")");
    const st = want[fm].state;
    eq("vram is byte-equal to the browser's", diff(Buffer.from(st.vram), vram).n, 0);
    eq("cram is byte-equal to the browser's", diff(Buffer.from(st.cram), cram).n, 0);
    eq("sat is byte-equal to the browser's", diff(Buffer.from(st.sat), sat).n, 0);
    eq("BXR/BYR/MWR equal", [regs.BXR, regs.BYR, regs.MWR],
       [st.regs.BXR, st.regs.BYR, st.regs.MWR]);
    eq("CR is the browser's with only the VBlank-status bit set",
       regs.CR, st.regs.CR | 0x08);
    console.log("      (captured CR $" + regs.CR.toString(16) +
                " vs the browser's $" + st.regs.CR.toString(16) +
                "; bit 3 is the VBlank status enable)");
  }

  /* The measured frame cost, from the timer the runtime reads around
   * toy_frame(): the TMA timer ticks once per 1024 CPU clocks. */
  const ram = fs.readFileSync(path.join(DUMP, "ram.bin"));
  const sumTicks = ram.readUInt32LE(0x100);
  const count = ram.readUInt16LE(0x104);
  const meanTicks = count ? sumTicks / count : 0;
  const cycles = meanTicks * 1024;
  check(count > 10, "the timer measured more than 10 frames (" + count + ")");
  check(meanTicks > 1 && meanTicks < 20,
        "the measured frame cost is sane (" + meanTicks.toFixed(3) + " ticks)");
  eq("meta.json carries the same measurement",
     [meta.capture.measure.count, meta.capture.measure.sum_ticks],
     [count, sumTicks]);
  check(Math.abs(meta.capture.measure.cycles_per_frame - cycles) < 0.01,
        "meta.json's cycles/frame is the RAM measurement");

  /* Code size, from the build report. */
  eq("the ROM is 8192 bytes", meta.rom_bytes, 8192);
  check(meta.functions && meta.functions.il_fn_4 > 0,
        "the frame function's size is recorded (" +
        (meta.functions && meta.functions.il_fn_4) + " B)");
  check(meta.sections && meta.sections.text > 0,
        "the ROM's text size is recorded");
  const ilCode = meta.functions ? (meta.functions.il_fn_0 +
    meta.functions.il_fn_1 + meta.functions.il_fn_2 +
    meta.functions.il_fn_3 + meta.functions.il_fn_4 +
    meta.functions.il_call) : 0;

  console.log("      frames: " + files.length + " recorded, " + FRAMES +
              " compared (browser f" + f0 + ".." + (f0 + FRAMES - 1) + ")");
  console.log("      timer: " + count + " frames, " + sumTicks + " ticks, " +
              "mean " + meanTicks.toFixed(3) + " ticks = " +
              cycles.toFixed(1) + " cycles/frame (" +
              ram[0x107] + ".." + ram[0x106] + " ticks)");
  const ss = meta.section_sizes || {};
  console.log("      code:   ROM " + meta.rom_bytes + " B, used .text " +
              (ss[".text"] || 0) + " B + .rodata " + (ss[".rodata"] || 0) +
              " B; the toy's IL functions " + ilCode + " B (il_fn_4 " +
              meta.functions.il_fn_4 + " B, il_fn_2 " +
              meta.functions.il_fn_2 + " B, il_call " +
              meta.functions.il_call + " B)");
  browser.dispose();
}

/* ---- main ------------------------------------------------------------- */

function main() {
  checkEmitter();
  checkRefusals();

  const metaPath = path.join(DUMP, "meta.json");
  if (!fs.existsSync(metaPath)) {
    check(false, "tests/dumps/toypalette/meta.json exists (run tools/capture-toy.sh)");
  } else {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    eq("the dump's toy is tools/toys/palette.lua", meta.source,
       "tools/toys/palette.lua");
    checkRebuild(meta);
    checkDump(meta);
  }

  if (failures.length) {
    console.log("FAIL  " + failures.length + " of " + checks + " checks failed" +
                (skipped.length ? " (" + skipped.length + " skipped)" : ""));
    process.exit(1);
  }
  console.log("PASS  " + checks + " checks, #31 part A: IL -> C -> llvm-mos -> " +
              "Mednafen equals the browser's toy" +
              (skipped.length ? "; SKIP " + skipped.join("; ") : ""));
}

main();
