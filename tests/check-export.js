#!/usr/bin/env node
/*
 * tests/check-export.js — the browser's .pce equals PCEAS's, byte for byte
 * (card #9's closing measurement).
 *
 * NOTE: written by @design because the card's close condition needs a diff
 * script; per the workshop role split this is flagged for @review to read
 * cold (same arrangement as tests/check.js and tests/check-viewer.js).
 *
 * For each sample scene the browser export module renderer/pce-rom.js — the
 * exact code renderer/index.html loads — builds a ROM from
 * tests/dumps/sceneN/{vram.bin,cram.bin,regs.json,regions.json} and the
 * constant code bank renderer/viewer-bank0.bin.  That ROM must be byte-for-
 * byte equal to the PCEAS build of tools/gen/viewerN.asm
 * (tools/gen/viewerN.pce, made by `make -C tools`).
 *
 * It also loads renderer/pce-rom.js a second time through its browser-global
 * branch (a vm context with `self` and no `module`) and requires the same
 * bytes, so the page's code path is not an untested copy.
 *
 *   node tests/check-export.js            # compare all three scenes
 *   node tests/check-export.js --write N  # write tools/gen/browserN.pce
 *                                         # (used by tools/capture.sh browser)
 *
 * Exit 0 only if every scene matches.  What this does NOT prove: that the
 * page's fetch/download wiring runs (only the module it calls), and that the
 * picture is correct — that is tests/check-viewer.js's diff of a Mednafen
 * capture of the ROM.
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
  return sandbox.PCEStudio.rom;
}

function compare(got, ref, label) {
  if (got.length !== ref.length)
    return `${label}: SIZE ${got.length} bytes vs PCEAS ${ref.length} bytes`;
  let diffs = 0, first = -1;
  for (let i = 0; i < got.length; i++) {
    if (got[i] !== ref[i]) {
      diffs++;
      if (first < 0) first = i;
    }
  }
  if (diffs === 0) return null;
  return `${label}: ${diffs} differing bytes of ${ref.length}; first at ` +
         `0x${first.toString(16)} (browser 0x${got[first].toString(16).padStart(2, "0")}, ` +
         `PCEAS 0x${ref[first].toString(16).padStart(2, "0")})`;
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function writeRom(scene) {
  const out = path.join(GEN, `browser${scene}.pce`);
  fs.mkdirSync(GEN, { recursive: true });
  fs.writeFileSync(out, rom.buildRom(loadScene(scene)));
  console.log(`wrote ${out}`);
}

function checkScenes() {
  const browser = loadBrowserGlobal();
  let failed = 0;

  for (const scene of [1, 2, 3]) {
    const picture = loadScene(scene);
    const got = rom.buildRom(picture);
    const pceasPath = path.join(GEN, `viewer${scene}.pce`);
    if (!fs.existsSync(pceasPath)) {
      console.error(`missing ${pceasPath} — run make -C tools first`);
      return 2;
    }
    const ref = new Uint8Array(fs.readFileSync(pceasPath));

    // the browser-global branch must produce the same bytes as CommonJS
    const globalGot = browser.buildRom(picture);

    const problems = [];
    const p = compare(got, ref, `scene${scene}`);
    if (p) problems.push(p);
    const g = compare(globalGot, got, `scene${scene} (browser-global branch)`);
    if (g) problems.push(g);

    if (problems.length === 0) {
      console.log(`scene${scene}: OK — ${got.length} bytes, sha256 ` +
                  `${sha256(got).slice(0, 16)}…, byte-for-byte equal to ` +
                  `PCEAS (${path.relative(HERE, pceasPath)})`);
    } else {
      problems.forEach((s) => console.log(s));
      failed++;
    }
  }

  console.log(failed === 0
    ? "PASS: the browser's .pce is byte-for-byte equal to PCEAS's on 3 scene(s)"
    : `FAIL: ${failed} scene(s) differ`);
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
      console.error("usage: check-export.js --write [1|2|3]");
      return 2;
    }
    writeRom(Number(scene));
    return 0;
  }
  if (args.length !== 0) {
    console.error("usage: check-export.js [--write [1|2|3]]");
    return 2;
  }
  return checkScenes();
}

process.exitCode = main();
