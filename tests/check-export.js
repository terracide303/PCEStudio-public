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
 * tests/dumps/<dump>/{vram.bin,cram.bin,regs.json,regions.json} and the
 * constant code bank renderer/viewer-bank0.bin.  That ROM must be byte-for-
 * byte equal to the PCEAS build of tools/gen/<name>.asm
 * (tools/gen/<name>.pce, made by `make -C tools`).  #14 adds the sprite
 * scenes (dump spriteN vs PCEAS vspriteN): the browser export must carry
 * the SG regions and the SAT block exactly like the PCEAS path.  #46 adds
 * scene10, the 88 KiB picture (a 64x64 BAT + a full 32 KiB tile set + 160
 * sprite-pattern cells), requires it to be over the old 80 KiB cap, and
 * requires a request over the HuCard's ceiling to be refused with the code
 * rom-too-big.  #57 corrects that ceiling: a HuCard decodes banks $00-$7F
 * = 128 banks = 1 MB, not the HuC6280's 2 MB physical space (sgxtech.txt
 * "HuC6280 memory map"; pcetech.txt §3 "Memory map"; hes spec [MEMORY MAP]
 * ROM 0x000000-0x0FFFFF; docs/MANUALS.md §15.1 GAP 4).  Exactly 1 MB is
 * accepted by the size guard; 1 MB + 1 bank is refused.
 *
 * It also loads renderer/pce-rom.js a second time through its browser-global
 * branch (a vm context with `self` and no `module`) and requires the same
 * bytes, so the page's code path is not an untested copy.
 *
 *   node tests/check-export.js               # compare all sample scenes
 *   node tests/check-export.js --write N     # write tools/gen/browserN.pce
 *                                            # (used by tools/capture.sh browser)
 *   node tests/check-export.js --write spriteN  # write tools/gen/bspriteN.pce
 *                                            # (#42: tools/capture.sh N bsprite)
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

function loadScene(dump) {
  const dir = path.join(DUMP_ROOT, dump);
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
  /* "1".."3" -> browserN.pce from sceneN; "spriteN" -> bspriteN.pce from
   * spriteN (#42: REVIEW-14's J-gap — the browser export of a sprite scene
   * is captured and run, not only byte-compared); "10" -> browser10.pce
   * (#46: the >80 KB picture). */
  const sprite = scene.startsWith("sprite");
  const dump = sprite ? scene : `scene${scene}`;
  const out = path.join(GEN, `${sprite ? "bsprite" + scene.slice(6) : "browser" + scene}.pce`);
  fs.mkdirSync(GEN, { recursive: true });
  fs.writeFileSync(out, rom.buildRom(loadScene(dump)));
  console.log(`wrote ${out}`);
}

/* The compared pairs: dump directory -> PCEAS build in tools/gen/.  #14
 * adds the sprite scenes (vspriteN = the viewer ROM of spriteN); #42 adds
 * sprite12 (SAT entries 20-63 live); #46 adds scene10, the 88 KiB picture
 * (a 64x64 BAT + a full 32 KiB tile set + 160 sprite-pattern cells). */
const PAIRS = [1, 2, 3].map((n) => ({ dump: `scene${n}`, pceas: `viewer${n}.pce` }))
  .concat(Array.from({ length: 12 }, (_, i) => i + 1)
    .map((n) => ({ dump: `sprite${n}`, pceas: `vsprite${n}.pce` })))
  .concat([{ dump: "scene10", pceas: "viewer10.pce" }]);

/* #57: the HuCard decodes physical banks $00-$7F = 128 banks of 8 KiB =
 * 1 MB (sgxtech.txt "HuC6280 memory map"; pcetech.txt §3 "Memory map";
 * hes spec [MEMORY MAP] ROM 0x000000-0x0FFFFF; docs/MANUALS.md §15.1
 * GAP 4).  The size guard runs before the descriptor cap, so the boundary
 * is exercised with region lists that are legal per region but too many for
 * the config's 13 descriptors:
 *
 *   exactly 128 banks (1 MB)  -> the size guard accepts it; the descriptor
 *                                cap is the refusal that follows, which is
 *                                what proves the guard passed at 1 MB
 *   129 banks (1 MB + 1 bank) -> refused with rom-too-big, naming 128/1 MB
 *
 * A legal picture cannot reach 1 MB: 13 descriptors, each at most one
 * 32768-word VRAM = 65,536 B, are at most 851,968 tile bytes = 104 tile
 * banks, 108 with the code/config/BAT banks = 864 KiB.  The 1 MB figure is
 * the hardware ceiling, not a size a single legal picture reaches; the max
 * reachable picture is checked below so a change that made 1 MB legal would
 * be seen rather than assumed. */
function checkHuCardLimit() {
  const base = loadScene("scene10");

  /* 15 x 2048 chars (15 x 65,536 B = 983,040 B = 120 banks) + 1024 chars
   * (32,768 B = 4 banks) = 1,015,808 tile bytes = exactly 124 tile banks,
   * so the ROM is exactly 128 banks = 1 MB. */
  const exactly1MB = {
    bank0: base.bank0, vram: base.vram, cram: base.cram, regs: base.regs,
    regions: Array.from({ length: 15 }, () => [0, 2048]).concat([[0, 1024]])
  };
  let one = null;
  try {
    rom.buildRom(exactly1MB);
  } catch (err) {
    one = err;
  }
  if (!one)
    return "a 128-bank (1 MB) request built — unexpected: its 16 descriptors " +
           "are past the config's 13";
  if (one.code === "rom-too-big")
    return `a 128-bank (1 MB) request was refused as rom-too-big: ${one.message}`;
  if (!/regions, the config block holds/.test(one.message))
    return `a 128-bank request was refused by something other than the ` +
           `descriptor cap: ${one.message}`;

  /* one more bank: 15 x 2048 + 1025 chars = 1,015,840 tile bytes = 125 tile
   * banks -> 129 ROM banks, 1 MB + 1 bank. */
  const over = {
    bank0: base.bank0, vram: base.vram, cram: base.cram, regs: base.regs,
    regions: Array.from({ length: 15 }, () => [0, 2048]).concat([[0, 1025]])
  };
  let e = null;
  try {
    rom.buildRom(over);
  } catch (err) {
    e = err;
  }
  if (!e) return "a 129-bank (1 MB + 1 bank) request was built, not refused";
  if (e.code !== "rom-too-big")
    return `a 129-bank request was refused with code ${JSON.stringify(e.code)}` +
           `, not rom-too-big: ${e.message}`;
  if (!/128 banks/.test(e.message) || !/1 MB/.test(e.message))
    return `rom-too-big does not name the limit: ${e.message}`;

  /* the same over-count with small regions is still a descriptor refusal,
   * not a size refusal: the size guard did not swallow the layout check */
  const many = {
    bank0: base.bank0, vram: base.vram, cram: base.cram, regs: base.regs,
    regions: Array.from({ length: 33 }, () => [0, 16])
  };
  try {
    rom.buildRom(many);
    return "a 33-region request under the size limit was built";
  } catch (err2) {
    if (err2.code === "rom-too-big")
      return "a 33-region request under 1 MB was refused as rom-too-big";
  }

  /* the largest picture the config can describe: 13 x 2048 chars = 13 x
   * 65,536 B = 851,968 tile bytes = 104 tile banks, + 4 = 108 banks =
   * 864 KiB.  It builds — the real reachable ceiling under the 1 MB guard. */
  const maxLegal = {
    bank0: base.bank0, vram: base.vram, cram: base.cram, regs: base.regs,
    regions: Array.from({ length: 13 }, () => [0, 2048])
  };
  let built = null;
  try {
    built = rom.buildRom(maxLegal);
  } catch (err3) {
    return `the largest legal picture (13 x 2048 chars) was refused: ${err3.message}`;
  }
  if (built.length !== 108 * rom.BANK)
    return `the largest legal picture built ${built.length} B, not 108 banks ` +
           `(${108 * rom.BANK} B)`;

  console.log(`scene10: exactly 1 MB (128 banks) is accepted by the size ` +
              `guard (refused next by the 13-descriptor cap); a 129-bank ` +
              `ROM is refused with code rom-too-big ` +
              `(${e.message.slice(0, 120)}…)`);
  return null;
}

function checkScenes() {
  const browser = loadBrowserGlobal();
  let failed = 0;

  const limitProblem = checkHuCardLimit();
  if (limitProblem) {
    console.log(`scene10: ${limitProblem}`);
    failed++;
  }

  for (const pair of PAIRS) {
    const picture = loadScene(pair.dump);
    const got = rom.buildRom(picture);
    const pceasPath = path.join(GEN, pair.pceas);
    if (!fs.existsSync(pceasPath)) {
      console.error(`missing ${pceasPath} — run make -C tools first`);
      return 2;
    }
    const ref = new Uint8Array(fs.readFileSync(pceasPath));

    // the browser-global branch must produce the same bytes as CommonJS
    const globalGot = browser.buildRom(picture);

    const problems = [];
    /* #46: the picture this card is about must actually be over the old
     * 80 KiB / 10-bank cap, or it proves nothing about growing the ROM. */
    if (pair.dump === "scene10" && got.length <= 80 * 1024)
      problems.push(`${pair.dump}: ${got.length} bytes, not over the old ` +
                    `80 KiB cap`);
    const p = compare(got, ref, pair.dump);
    if (p) problems.push(p);
    const g = compare(globalGot, got, `${pair.dump} (browser-global branch)`);
    if (g) problems.push(g);

    if (problems.length === 0) {
      console.log(`${pair.dump}: OK — ${got.length} bytes` +
                  (pair.dump === "scene10" ? " (> 80 KiB)" : "") +
                  `, sha256 ` +
                  `${sha256(got).slice(0, 16)}…, byte-for-byte equal to ` +
                  `PCEAS (${path.relative(HERE, pceasPath)})`);
    } else {
      problems.forEach((s) => console.log(s));
      failed++;
    }
  }

  console.log(failed === 0
    ? `PASS: the browser's .pce is byte-for-byte equal to PCEAS's on ` +
      `${PAIRS.length} scene(s)`
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
    if (!/^(?:[123]|10)$/.test(scene) && !/^sprite[0-9]+$/.test(scene)) {
      console.error("usage: check-export.js --write [1|2|3|10|spriteN]");
      return 2;
    }
    writeRom(scene);
    return 0;
  }
  if (args.length !== 0) {
    console.error("usage: check-export.js [--write [1|2|3|10|spriteN]]");
    return 2;
  }
  return checkScenes();
}

process.exitCode = main();
