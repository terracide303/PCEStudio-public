#!/usr/bin/env node
/*
 * tests/check-pad-buttons.js — the ROM pad test's permanent checks: the
 * exported padtest ROM reading real buttons, and the pad witness toy in
 * both runtimes.
 *
 * Everything here runs without an emulator:
 *
 *   1. THE TOY READS EVERY BIT, IN BOTH RUNTIMES.  toys/padtest/main.lua
 *      plays tools/mkmovie.js's buttonsAt script in the Lua runtime
 *      (renderer/pce-toys.js) and the IL (renderer/pce-il.js) through
 *      setPad — the same route a gamepad or a key frame takes.  At every
 *      step exactly the held button's cell is lit in the BAT (palette 2
 *      for pad 1, 4 for pad 2) and every other cell stays at palette 1;
 *      the ever-held masks in vram[$3F01]/[$3F02] grow bit by bit to
 *      $FF/$FF; and the two runtimes' vram/cram/sat agree byte for byte
 *      at every sampled frame.
 *   2. THE EXPORT.  The studio's own route — validate → il.compile →
 *      ilbc.encode → buildToyRom over renderer/ilvm.bin — builds the ROM
 *      and its sha256 is pinned: the bytes a person downloads.  The toy's
 *      pad reads are the padref/padget ops (#185/#186), read on the
 *      console by joy_scan() (docs/PADS.md).
 *   3. THE MOVIE EVIDENCE, WHEN PRESENT.  tests/dumps/pads/
 *      buttons-evidence.json is written by tools/capture-pad-buttons.sh:
 *      the instrumented Mednafen runs the exported ROM and replays the
 *      same buttons through a movie of its own input records.  When the
 *      file exists this asserts every bit reached the console (the ever
 *      masks read $FF/$FF), the console's final VRAM/CRAM/SAT are
 *      byte-equal to the browser run's, and the ROM the console ran has
 *      the pinned sha.  Without the file this SKIPs with the capture
 *      command — a skip is not a pass, and the movie itself is the
 *      evidence a second machine can re-run.
 *   4. GEARGRAFX, THE CARD'S EMULATOR.  Not installed or scriptable here,
 *      so the person-run is the skip line: run the exported ROM in
 *      Geargrafx (or any emulator) and press every button — every cell
 *      must light.  The toy exists for exactly that.
 *
 * Written by @design because the card names the pad-test toy and its ROM
 * test.  Per workshop rule 2 a cold break by another seat is owed before
 * this closes the card.
 *
 *   node tests/check-pad-buttons.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const toys = require("../renderer/pce-toys.js");
const il = require("../renderer/pce-il.js");
const ilbc = require("../renderer/pce-ilbc.js");
const romLib = require("../renderer/pce-rom.js");
const validate = require("../renderer/pce-validate.js");
const { buttonsAt, BUTTONS, BUTTON_STEPS, BUTTON_HOLD, BUTTON_GAP,
        BUTTON_LENGTH } = require("../tools/mkmovie.js");

const ROOT = path.join(__dirname, "..");
const TOY = "toys/padtest/main.lua";
const BANK0 = path.join(ROOT, "renderer", "ilvm.bin");
const EVIDENCE = path.join(ROOT, "tests", "dumps", "pads",
                           "buttons-evidence.json");
const ROM_DUMP = path.join(ROOT, "tests", "dumps", "pads",
                           "padtest-rom.bin");

/* The exported ROM's pinned bytes (2 below): the sha moves with any
 * interpreter or bytecode change, like every GAME_PINS entry. */
const ROM_PIN = {
  sha: "dedbfd636f6735fa636c1d7ed746103dc4cd2faeb381c0b50545f891a31b9ff7",
  bytes: 40960,
  bytecodeBytes: 2063
};

/* The script the toy, the movie and the browser all replay: first hold at
 * frame 100, a fixed start the assertions below are written against. */
const START = 100;

let checks = 0;
const failures = [];

function check(ok, name) {
  checks++;
  if (!ok) { failures.push(name); console.log("FAIL  " + name); }
}

const w = (b, a) => b[a * 2] | (b[a * 2 + 1] << 8);

/* the BAT word at cell (x, y) */
function bat(state, x, y) { return w(state.vram, y * 32 + x); }

/* cell c of band b: box rows are label + 1 .. + 3, x = 4 + (c % 4) * 7 */
function boxCells(b, c) {
  const y0 = (b === 1) ? 3 : 16;
  const x = 4 + (c % 4) * 7;
  const y = y0 + Math.floor(c / 4) * 6 + 1;
  const out = [];
  for (let r = 0; r < 3; r++) for (let col = 0; col < 3; col++) {
    out.push([x + col, y + r]);
  }
  return out;
}

/* every one of band b's eight cells is lit exactly when `mask` has its bit
 * (palette 2 lights pad 1, 4 pad 2; 1 is the unlit box) */
function checkBand(state, b, mask) {
  const lit = (b === 1) ? 2 : 4;
  for (let c = 0; c < 8; c++) {
    const want = (mask >> c) & 1 ? (0x41 | (lit << 12)) : (0x41 | (1 << 12));
    for (const [x, y] of boxCells(b, c)) {
      if (bat(state, x, y) !== want) return c;
    }
  }
  return -1;
}

/* ---- 1. the toy reads every bit, in both runtimes ---------------------- */

function playAndAssert(name, mk) {
  const src = fs.readFileSync(path.join(ROOT, TOY), "utf8");
  const rt = mk(src);
  rt.load();

  let ever1 = 0, ever2 = 0;
  const samples = [];            /* {f, vram, cram, sat} at held midpoints */

  for (let f = 0; f < START; f++) {
    rt.setPad(1, {}); rt.setPad(2, {}); rt.frame(f);
  }
  check(w(rt.state.vram, 0x3F00) === START - 1, name + ": frame counter");
  check(checkBand(rt.state, 1, 0) === -1 &&
        checkBand(rt.state, 2, 0) === -1, name + ": all cells unlit at rest");

  for (let s = 0; s < BUTTON_STEPS; s++) {
    /* steps 0..15 hold one button of pad 1 then pad 2; steps 16 and 17
     * hold all eight of pad 1 / pad 2 at once */
    const all = s >= 16;
    const pad = all ? (s - 15) : 1 + Math.floor(s / 8);
    const mask = all ? 0xFF : 1 << (s % 8);
    const button = all ? "all eight" : BUTTONS[s % 8];
    const hold = START + s * (BUTTON_HOLD + BUTTON_GAP);

    for (let f = hold; f < hold + BUTTON_HOLD; f++) {
      const p = buttonsAt(f, START);
      rt.setPad(1, p[1]); rt.setPad(2, p[2]); rt.frame(f);
    }
    if (pad === 1) ever1 |= mask; else ever2 |= mask;

    const mid = hold + Math.floor(BUTTON_HOLD / 2);
    const litBand = checkBand(rt.state, pad, mask);
    const otherBand = checkBand(rt.state, 3 - pad, 0);
    check(litBand === -1,
          name + ": step " + s + " lights only " + button + " (band " +
          pad + ")" + (litBand >= 0 ? ", cell " + litBand + " wrong" : ""));
    check(otherBand === -1,
          name + ": step " + s + " leaves the other band unlit");
    check(w(rt.state.vram, 0x3F01) === ever1,
          name + ": step " + s + " pad 1 ever mask " +
          ever1.toString(16));
    check(w(rt.state.vram, 0x3F02) === ever2,
          name + ": step " + s + " pad 2 ever mask " +
          ever2.toString(16));

    /* the gap releases the button and the cell goes dark again */
    for (let f = hold + BUTTON_HOLD; f < hold + BUTTON_HOLD + BUTTON_GAP;
         f++) {
      rt.setPad(1, {}); rt.setPad(2, {}); rt.frame(f);
    }
    check(checkBand(rt.state, pad, 0) === -1,
          name + ": step " + s + " gap unlights the cell");

    samples.push({
      f: mid,
      vram: Buffer.from(rt.state.vram),
      cram: Buffer.from(rt.state.cram),
      sat: Buffer.from(rt.state.sat)
    });
  }

  check(ever1 === 0xFF && ever2 === 0xFF,
        name + ": every bit of both pads was read (ff/ff)");
  check(w(rt.state.vram, 0x3F01) === 0xFF &&
        w(rt.state.vram, 0x3F02) === 0xFF,
        name + ": the latched masks read ff/ff");

  /* after the script: all released, both bands dark */
  for (let f = START + BUTTON_LENGTH; f < START + BUTTON_LENGTH + 20; f++) {
    rt.setPad(1, {}); rt.setPad(2, {}); rt.frame(f);
  }
  check(checkBand(rt.state, 1, 0) === -1 &&
        checkBand(rt.state, 2, 0) === -1,
        name + ": all cells unlit after the script");

  rt.dispose();
  return samples;
}

const luaSamples = playAndAssert("lua", (src) => toys.create(src));
const ilSamples = playAndAssert("il", (src) => il.create(src));

check(luaSamples.length === BUTTON_STEPS && ilSamples.length === BUTTON_STEPS,
      "both runtimes sampled every step");
for (let i = 0; i < Math.min(luaSamples.length, ilSamples.length); i++) {
  const a = luaSamples[i], b = ilSamples[i];
  check(a.f === b.f && a.vram.equals(b.vram) && a.cram.equals(b.cram) &&
        a.sat.equals(b.sat),
        "lua == il at step " + i + " (frame " + a.f + ")");
}

/* ---- 2. the export ------------------------------------------------------ */

const source = fs.readFileSync(path.join(ROOT, TOY), "utf8");
const report = validate.validate(source, { chunkName: "main.lua" });
check(report.ok, "the validator accepts the toy");
if (report.ok) {
  check(report.budgets.vram.words === 16131,
        "the validator's VRAM word count is pinned (16131)");
  const program = il.compile(source, { chunkName: "main.lua" });
  const encoded = ilbc.encode(program);
  const rom = romLib.buildToyRom({ bank0: fs.readFileSync(BANK0),
                                   bytecode: encoded.bytes });
  check(encoded.bytes.length === ROM_PIN.bytecodeBytes,
        "the bytecode size is pinned (" + ROM_PIN.bytecodeBytes + ")");
  check(rom.length === ROM_PIN.bytes,
        "the ROM is 40960 bytes (the 32 KiB image + one data bank)");
  check(crypto.createHash("sha256").update(Buffer.from(rom)).digest("hex") ===
        ROM_PIN.sha, "the exported ROM's sha256 is pinned");
}

/* ---- 3. the movie evidence, when it exists ------------------------------ */

if (!fs.existsSync(EVIDENCE)) {
  console.log("");
  console.log("SKIP  no tests/dumps/pads/buttons-evidence.json: the console " +
              "half needs the instrumented Mednafen and a movie run, and " +
              "this machine's capture is not committed.");
  console.log("      Capture it with: tools/capture-pad-buttons.sh");
  console.log("      (a skip is not a pass — the evidence is the card's " +
              "proof a ROM reads every button)");
} else {
  const ev = JSON.parse(fs.readFileSync(EVIDENCE, "utf8"));
  check(ev.toy === TOY, "the evidence names the padtest toy");
  check(ev.romSha === ROM_PIN.sha,
        "the ROM the console ran has the pinned sha (re-capture after a " +
        "re-pin)");
  check(ev.everyButtonReached === true,
        "every bit of both pads reached the console (ever masks ff/ff)");
  check(ev.picture && ev.picture.vramEqual === true &&
        ev.picture.cramEqual === true && ev.picture.satEqual === true,
        "the console's final VRAM/CRAM/SAT are byte-equal to the browser's");
  check(ev.equal === true, "the evidence's equal flag is set");
}

/* ---- 4. Geargrafx, the card's emulator ---------------------------------- */

console.log("");
console.log("SKIP  Geargrafx is not installed or scriptable here; the " +
            "person-run is: open " + ROM_DUMP + " (from the capture) in " +
            "Geargrafx, press every button on both pads, and watch every " +
            "labeled cell light — the toy is built for exactly that.");
console.log("      (a skip is not a pass — this line stays until a human " +
            "has done it)");

console.log("");
if (failures.length) {
  console.log("FAILED " + failures.length + " of " + checks + " checks");
  process.exit(1);
}
console.log("PASS  " + checks + " checks: every bit of both pads in both " +
            "runtimes, the exported ROM pinned, the movie evidence " +
            (fs.existsSync(EVIDENCE) ? "asserted" : "skipped"));
