#!/usr/bin/env node
/*
 * tests/check-us-card.js — the US HuCard image is the exact bit-reverse of
 * the .pce (card #25's software close condition).
 *
 * NOTE: written by @design because the card's close condition needs a check
 * script; per the workshop role split this is flagged for @review to read
 * cold (same arrangement as tests/check.js, check-viewer.js, check-export.js).
 *
 * For each sample scene the browser export module renderer/pce-rom.js builds
 * the .pce from tests/dumps/sceneN/ and renderer/viewer-bank0.bin (that path
 * is #9's, checked by tests/check-export.js), then builds the US image with
 * its reverseBits().  The US image must:
 *
 *   - be the same length as the .pce;
 *   - have every byte equal to the bit-reverse of the .pce's byte at the same
 *     offset, measured against an independent bit loop written here (so the
 *     module's lookup table is checked, not trusted);
 *   - reverse back to the .pce exactly (the transform is its own inverse);
 *   - actually differ from the .pce on this data (a no-op reversal would pass
 *     the first three checks on a ROM made only of 0x00/0xff bytes).
 *
 * It also loads renderer/pce-rom.js through its browser-global branch (a vm
 * context with `self` and no `module`) and requires the same bytes, so the
 * page's code path is exercised and not a Node-only copy.
 *
 * The comparison is itself tested: the same checker is run on the un-reversed
 * .pce and on a US image with one byte's bits put back, and it must report
 * each as a failure.  A comparison that cannot fail proves nothing.
 *
 *   node tests/check-us-card.js            # all three scenes
 *   node tests/check-us-card.js --write N  # write tools/gen/usN.pce
 *                                          # (used by tools/capture.sh N us)
 *
 * Exit 0 only if every scene passes.  What this does NOT prove: that a US
 * image runs on a TurboGrafx-16 or a flash cart — that is hardware, and the
 * capture route can only say what an emulator that does not model a US card
 * shows (see docs/EXPORT.md).
 */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const rom = require("../renderer/pce-rom.js");

const HERE = __dirname;
const DUMP_ROOT = path.join(HERE, "dumps");
const GEN = path.join(HERE, "..", "tools", "gen");
const BANK0 = path.join(HERE, "..", "renderer", "viewer-bank0.bin");
const PCE_ROM_SRC = fs.readFileSync(
  path.join(HERE, "..", "renderer", "pce-rom.js"), "utf8");

/* The reference transform, written as a bit loop rather than a table, so the
 * module's table is checked against something independent of it. */
function slowReverseByte(b) {
  let r = 0;
  for (let i = 0; i < 8; i++) r |= ((b >> i) & 1) << (7 - i);
  return r;
}

function loadScene(scene) {
  const dir = path.join(DUMP_ROOT, `scene${scene}`);
  return {
    bank0: new Uint8Array(fs.readFileSync(BANK0)),
    vram: new Uint8Array(fs.readFileSync(path.join(dir, "vram.bin"))),
    cram: new Uint8Array(fs.readFileSync(path.join(dir, "cram.bin"))),
    regs: JSON.parse(fs.readFileSync(path.join(dir, "regs.json"), "utf8")),
    regions: JSON.parse(
      fs.readFileSync(path.join(dir, "regions.json"), "utf8")).tile_regions,
  };
}

/* The page's branch: a global PCEStudio.rom, no CommonJS module object. */
function loadBrowserGlobal() {
  const sandbox = { self: null };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(PCE_ROM_SRC, sandbox, { filename: "pce-rom.js" });
  if (!sandbox.PCEStudio || !sandbox.PCEStudio.rom)
    throw new Error("pce-rom.js did not install PCEStudio.rom as a global");
  if (typeof sandbox.PCEStudio.rom.reverseBits !== "function")
    throw new Error("pce-rom.js did not install reverseBits as a global");
  return sandbox.PCEStudio.rom;
}

/* The card's comparison, parameterised so the same code can be shown to fail
 * on a wrong image.  Returns null on success, a message otherwise. */
function compareBitReverse(us, pce, label) {
  if (us.length !== pce.length)
    return `${label}: SIZE ${us.length} bytes vs .pce ${pce.length} bytes`;
  let differ = 0, first = -1;
  for (let i = 0; i < pce.length; i++) {
    const want = slowReverseByte(pce[i]);
    if (us[i] !== want) {
      differ++;
      if (first < 0) first = i;
    }
  }
  if (differ !== 0)
    return `${label}: ${differ} bytes are not the bit-reverse of the .pce; ` +
           `first at 0x${first.toString(16)} (image 0x` +
           `${us[first].toString(16).padStart(2, "0")}, want 0x` +
           `${slowReverseByte(pce[first]).toString(16).padStart(2, "0")})`;
  return null;
}

function reverseBack(us, pce, label) {
  if (us.length !== pce.length) return `${label}: SIZE differs reversing back`;
  let differ = 0, first = -1;
  for (let i = 0; i < us.length; i++) {
    let r = 0;
    for (let b = 0; b < 8; b++) r |= ((us[i] >> b) & 1) << (7 - b);
    if (r !== pce[i]) {
      differ++;
      if (first < 0) first = i;
    }
  }
  if (differ !== 0)
    return `${label}: reversing the image back differs from the .pce in ` +
           `${differ} bytes; first at 0x${first.toString(16)}`;
  return null;
}

function countDiffer(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function writeRom(scene) {
  const out = path.join(GEN, `us${scene}.pce`);
  fs.mkdirSync(GEN, { recursive: true });
  fs.writeFileSync(out, rom.reverseBits(rom.buildRom(loadScene(scene))));
  console.log(`wrote ${out}`);
}

/* The checker must be able to say "no". */
function selfTest() {
  const problems = [];
  const pce = new Uint8Array(256);
  for (let i = 0; i < 256; i++) pce[i] = i;
  const good = new Uint8Array(256);
  for (let i = 0; i < 256; i++) good[i] = slowReverseByte(pce[i]);

  if (!compareBitReverse(pce, pce, "self-test (unreversed)"))
    problems.push("the checker did not reject the un-reversed .pce");
  const bad = good.slice();
  bad[0x80] = pce[0x80];       // put one byte back
  if (!compareBitReverse(bad, pce, "self-test (one byte)"))
    problems.push("the checker did not reject a one-byte error");
  if (compareBitReverse(good, pce, "self-test (good)"))
    problems.push("the checker rejected the correct bit-reverse");
  return problems;
}

function checkScenes() {
  const browser = loadBrowserGlobal();
  let failed = 0;

  const st = selfTest();
  if (st.length === 0) {
    console.log("self-test: OK — the comparison rejects the .pce itself and " +
                "a one-byte error, and accepts the true bit-reverse");
  } else {
    st.forEach((s) => console.log(`SELF-TEST FAIL: ${s}`));
    failed++;
  }

  for (const scene of [1, 2, 3]) {
    const pce = rom.buildRom(loadScene(scene));
    const us = rom.reverseBits(pce);
    const globalUs = browser.reverseBits(pce);

    const differ = countDiffer(us, pce);
    const problems = [];
    let p = compareBitReverse(us, pce, `scene${scene}`);
    if (p) problems.push(p);
    p = reverseBack(us, pce, `scene${scene}`);
    if (p) problems.push(p);
    if (differ === 0)
      problems.push(`scene${scene}: the image is identical to the .pce — ` +
                    `no byte was reversed`);
    p = compareBitReverse(globalUs, pce, `scene${scene} (browser-global branch)`);
    if (p) problems.push(p);

    if (problems.length === 0) {
      console.log(`scene${scene}: OK — ${us.length} bytes, sha256 ` +
                  `${sha256(us).slice(0, 16)}…, every byte the bit-reverse of ` +
                  `the .pce (${differ} differ, ${us.length - differ} are ` +
                  `self-reverse 0x00/0xff and equal)`);
    } else {
      problems.forEach((s) => console.log(s));
      failed++;
    }
  }

  console.log(failed === 0
    ? "PASS: the US HuCard image is byte-for-byte the bit-reverse of the .pce " +
      "on 3 scene(s)"
    : `FAIL: ${failed} scene(s) or the self-test failed`);
  return failed === 0 ? 0 : 1;
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--write") {
    const scene = args[1];
    if (scene === undefined) {
      [1, 2, 3].forEach(writeRom);
      return 0;
    }
    if (!/^[123]$/.test(scene)) {
      console.error("usage: check-us-card.js --write [1|2|3]");
      return 2;
    }
    writeRom(Number(scene));
    return 0;
  }
  if (args.length !== 0) {
    console.error("usage: check-us-card.js [--write [1|2|3]]");
    return 2;
  }
  return checkScenes();
}

process.exitCode = main();
