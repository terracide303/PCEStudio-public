#!/usr/bin/env node
/*
 * tests/check-ilvm-construns.js — #218's evidence: a straight-line run of
 * constant vram[] writes becomes one data-bank blob and one copyv
 * (renderer/pce-ilbc.js constVramRuns; docs/IL.md §14.1).
 *
 *   node tests/check-ilvm-construns.js
 *
 *   1. A toy that writes a 256x224-shaped BAT (28 rows of 32 words, 64
 *      apart) and 125 tiles (16 words each) as literal writes in init()
 *      encodes with no ilbc-range refusal (the card's measured wall: more
 *      than 127 constants).  The runs become 29 copyv ops over a 5,792-byte
 *      blob, and the pool keeps well under 127 entries.
 *   2. The same toy's bytecode on the host harness (tools/ilvm/hostvm.c,
 *      compiled with the system cc; SKIP without cc) leaves VRAM byte for
 *      byte equal to the browser IL run (renderer/pce-il.js) after three
 *      frames.  The blob is laid out the way the studio lays it out: the
 *      container on whole banks, the blob on the bank after it.
 *   3. Short runs (seven words) and writes inside frame() keep their vset
 *      ops: no blob, no constRuns.
 *   4. A run whose blob would overflow one 8 KiB data bank is refused by
 *      name (toy-const-bank-full) with the sizes.
 *
 * The check was written by the seat that wrote the encoder change, so it is
 * the author's evidence: rule 2's cold break by another seat is owed.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const il = require(path.join(ROOT, "renderer", "pce-il.js"));
const ilbc = require(path.join(ROOT, "renderer", "pce-ilbc.js"));

let passed = 0, failed = 0;
function check(ok, name, detail) {
  if (ok) { passed++; return; }
  failed++;
  console.log("FAIL  " + name + (detail ? " — " + detail : ""));
}
function eq(name, got, want) {
  check(JSON.stringify(got) === JSON.stringify(want), name,
        "got " + JSON.stringify(got) + ", want " + JSON.stringify(want));
}
function refusal(fn) {
  try { fn(); } catch (e) { return e; }
  return null;
}

const BANK = 0x2000;

/* A toy of literal writes: the picture's shape, straight-line in init(). */
function literalToy() {
  const L = ["function init()"];
  for (let r = 0; r < 28; r++) {
    for (let c = 0; c < 32; c++) {
      L.push("  vram[" + (r * 64 + c) + "] = " + (((r * 32 + c) * 7 + 3) & 0x7FF));
    }
  }
  for (let t = 0; t < 125; t++) {
    for (let k = 0; k < 16; k++) {
      L.push("  vram[" + (0x1000 + t * 16 + k) + "] = " +
             (((t * 16 + k) * 37 + 11) & 0xFFFF));
    }
  }
  L.push("end", "function frame(t, f)", "end");
  return L.join("\n") + "\n";
}

/* The reference: the browser IL run's VRAM after `frames` frames. */
function browserVram(source, frames) {
  const rt = il.create(source);
  rt.load();
  for (let f = 0; f < frames; f++) rt.frame(f);
  return Buffer.from(rt.state.vram.buffer, rt.state.vram.byteOffset,
                     rt.state.vram.byteLength);
}

/* The studio's ROM layout for a v1 container: the container on bank 0,
 * then the asset blob (here only the constant blob) on the banks after. */
function hostFile(enc) {
  const cont = Buffer.alloc(Math.ceil(enc.bytes.length / BANK) * BANK, 0xFF);
  Buffer.from(enc.bytes).copy(cont);
  return Buffer.concat([cont, Buffer.from(enc.constBlob || [])]);
}

function hasCC() {
  return !spawnSync("cc", ["--version"], { encoding: "utf8" }).error;
}

function main() {
  const src = literalToy();
  const prog = il.compile(src, { chunkName: "construns.lua" });

  /* 1. the encoding. */
  const enc = ilbc.encode(prog);
  eq("the literal BAT and tile toy is version 1", enc.bytes[4], 1);
  eq("29 runs: 28 BAT rows of 32 words and one 2,000-word tile run",
     enc.constRuns, 29);
  eq("the constant blob is 5,792 bytes (896 + 2,000 words)",
     enc.constBlob ? enc.constBlob.length : -1, 5792);
  check(enc.constants < 127, "the constant pool stays under 127 entries",
        "constants " + enc.constants);

  /* 2. the host harness against the browser. */
  if (!hasCC()) {
    console.log("SKIP  host parity: no cc on this machine");
  } else {
    const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(),
                                         "construns-"));
    const hostBin = path.join(tmp, "hostvm");
    const cc = spawnSync("cc", [
      "-DILVM_HOST", "-O2", "-I", path.join(ROOT, "tools", "toyc"),
      "-I", path.join(ROOT, "tools", "ilvm"),
      path.join(ROOT, "tools", "ilvm", "ilvm.c"),
      path.join(ROOT, "tools", "ilvm", "ilvm_sound.c"),
      path.join(ROOT, "tools", "ilvm", "hostvm.c"), "-o", hostBin
    ], { cwd: ROOT, encoding: "utf8" });
    check(cc.status === 0, "the system cc builds ilvm.c with hostvm.c",
          ((cc.stderr || "") + (cc.stdout || "")).slice(-300));
    if (cc.status === 0) {
      const file = path.join(tmp, "prog.ilbc");
      fs.writeFileSync(file, hostFile(enc));
      const out = path.join(tmp, "out");
      fs.mkdirSync(out);
      const frames = 3;
      const run = spawnSync(hostBin, [file, out, String(frames)], { encoding: "utf8" });
      check(run.status === 0, "hostvm exits 0", (run.stderr || "").slice(-200));
      if (run.status === 0) {
        const got = fs.readFileSync(path.join(out, "vram.bin"));
        const want = browserVram(src, frames);
        let diff = 0;
        for (let i = 0; i < want.length; i++) if (got[i] !== want[i]) diff++;
        eq("host VRAM is the browser IL run's, byte for byte, after 3 frames",
           diff, 0);
        check(want.some(function (b) { return b !== 0; }),
              "the browser run wrote VRAM (the comparison is not 0 against 0)");
      }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  /* 3. the short run and the frame() run keep vset. */
  const short = il.compile("function init()\n" +
    Array.from({ length: 7 }, (_, i) => "  vram[" + i + "] = " + (i + 1)).join("\n") +
    "\nend\nfunction frame(t, f)\nend\n", { chunkName: "short.lua" });
  eq("a run of seven words stays vset (no blob)",
     ilbc.encode(short).constRuns, 0);
  const inFrame = il.compile("function init()\nend\nfunction frame(t, f)\n" +
    Array.from({ length: 20 }, (_, i) => "  vram[" + i + "] = " + (i + 9)).join("\n") +
    "\nend\n", { chunkName: "frame.lua" });
  eq("writes inside frame() stay vset (copyv would land during display)",
     ilbc.encode(inFrame).constRuns, 0);

  /* 4. the named overflow. */
  const big = il.compile("function init()\n" +
    Array.from({ length: 5000 }, (_, i) => "  vram[" + (0x2000 + i) + "] = " + (i & 0xFFFF)).join("\n") +
    "\nend\nfunction frame(t, f)\nend\n", { chunkName: "big.lua" });
  const err = refusal(function () { ilbc.encode(big); });
  eq("a blob past one 8 KiB bank is refused by name",
     err && err.code, "toy-const-bank-full");
  check(err && /10000 B/.test(err.message) && /8192 B/.test(err.message),
        "the refusal names the 10,000 B blob and the 8,192 B bank",
        err && err.message);

  console.log((failed ? "FAIL " : "PASS ") + passed + " checks" +
              (failed ? ", " + failed + " failed" : ""));
  process.exit(failed ? 1 : 0);
}

main();
