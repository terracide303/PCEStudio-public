#!/usr/bin/env node
/*
 * tools/mkmovie.js — build Mednafen input movies for scripted pads
 * (cards #45 and #262).
 *
 *   node tools/mkmovie.js STATE.raw OUT.mcm FIRST_FRAME FRAMES
 *   node tools/mkmovie.js --buttons STATE.raw OUT.mcm FIRST_FRAME FRAMES [START]
 *
 * STATE.raw is a Mednafen save state with its gzip wrapper removed (the
 * bytes a .mca holds); OUT.mcm is that state followed by the input records
 * for toy frames FIRST_FRAME+1 .. FIRST_FRAME+FRAMES.
 *
 * The record layout is Mednafen's own (src/movie.cpp MDFNMOV_ProcessInput):
 * one $00 command byte, then each port's data — 2 bytes per port, port 1
 * being multitap controller 1, port 2 at offset 3.  Mednafen processes TWO
 * records per video frame (the frontend calls the movie reader at the
 * mid-frame sync and again at the end; measured: 200 records of Right moved
 * the sprite 100 frames), so each frame's value is written twice — which is
 * also what a movie Mednafen itself records contains.
 *
 * The pad word is Mednafen's gamepad bitfield (src/pce/input/gamepad.cpp):
 * bits 0..3 II, I, Select, Run; bits 4..7 Up, Right, Down, Left.
 *
 * The default script is padmove's d-pad walk (card #45).  --buttons writes
 * the pad-test script (card #262): each of pad 1's eight buttons alone,
 * then pad 2's, then all eight of each pad at once, for the padtest toy —
 * its vram[$3F01]/[$3F02] ever-held masks must read $FF/$FF at the end,
 * which is how a ROM proves every bit of both pads reaches the console.
 */
"use strict";
const fs = require("fs");

/* The pad script, keyed by the toy's own frame number (vram[$3F00] in
 * tools/toys/padmove.lua).  It starts after the base state is captured, so
 * the browser and the console see the same sequence at the same frames. */
function padAt(f) {
  if (f >= 700 && f < 730) return { right: true };   /* 30 frames right */
  if (f >= 730 && f < 750) return { down: true };    /* 20 down  */
  if (f >= 750 && f < 770) return { left: true };    /* 20 left  */
  if (f >= 770 && f < 780) return { up: true };      /* 10 up    */
  return {};
}

/* The pad-test script (toys/padtest/main.lua): one held button at a time,
 * both pads, then all eight of each pad.  The steps are closed-form in f,
 * the same way a movie and the browser's setPad replay them.
 *
 * `start` is the toy frame the first hold begins at.  The movie can only
 * drive frames AFTER the base state was captured (the .mca restores that
 * state's frame counter), so the capture passes start = F0 + 60 and both
 * sides use the same value; the default keeps the tools/toys/padmove.lua
 * convention (frame 700) for a run whose base state sits well before it. */
const BUTTONS = ["up", "down", "left", "right", "i", "ii", "select", "run"];
const BUTTON_START = 700;
const BUTTON_HOLD = 20;
const BUTTON_GAP = 10;
const BUTTON_STEPS = 18;           /* 8 buttons x 2 pads + 2 all-at-once */
const BUTTON_LENGTH = BUTTON_STEPS * (BUTTON_HOLD + BUTTON_GAP);

function buttonsAt(f, start) {
  const s = (start === undefined) ? BUTTON_START : start;
  const out = { 1: {}, 2: {} };
  if (f < s) return out;
  const step = Math.floor((f - s) / (BUTTON_HOLD + BUTTON_GAP));
  const inStep = (f - s) % (BUTTON_HOLD + BUTTON_GAP);
  if (inStep >= BUTTON_HOLD) return out;        /* the gap between holds */
  if (step < 16) {
    const pad = 1 + Math.floor(step / 8);
    out[pad][BUTTONS[step % 8]] = true;
    return out;
  }
  if (step === 16) {                            /* pad 1: all eight at once */
    for (const b of BUTTONS) out[1][b] = true;
    return out;
  }
  if (step === 17) {                            /* pad 2: all eight at once */
    for (const b of BUTTONS) out[2][b] = true;
    return out;
  }
  return out;
}

const WORD = { ii: 1, i: 2, select: 4, run: 8, up: 0x10, right: 0x20,
               down: 0x40, left: 0x80 };

function word(p) {
  let w = 0;
  for (const k of Object.keys(WORD)) if (p[k]) w |= WORD[k];
  return w;
}

/* One movie record.  The default script drives port 1 and leaves every
 * other port at zero — the bytes --buttons writes for port 2 (offset 3)
 * are the only difference between the modes. */
function record(pad1, pad2) {
  const rec = Buffer.alloc(11);
  rec[0] = 0;                       /* no command this frame */
  rec.writeUInt16LE(word(pad1), 1);
  rec.writeUInt16LE(word(pad2), 3);
  return rec;
}

function main(argv) {
  const buttons = argv[2] === "--buttons";
  const args = buttons ? argv.slice(3) : argv.slice(2);
  const [statePath, outPath, first, frames, startArg] = args;
  if (!statePath || !outPath || !first || !frames) {
    console.error("usage: node tools/mkmovie.js [--buttons] STATE.raw " +
                  "OUT.mcm FIRST FRAMES [START]");
    return 2;
  }
  const f0 = parseInt(first, 10);
  const n = parseInt(frames, 10);
  const start = (startArg !== undefined) ? parseInt(startArg, 10) : BUTTON_START;
  const out = [fs.readFileSync(statePath)];
  for (let i = 1; i <= n; i++) {
    const f = f0 + i;
    let p1 = padAt(f), p2 = {};
    if (buttons) {
      const p = buttonsAt(f, start);
      p1 = p[1];
      p2 = p[2];
    }
    const rec = record(p1, p2);
    out.push(Buffer.from(rec), Buffer.from(rec));   /* two records per frame */
  }
  fs.writeFileSync(outPath, Buffer.concat(out));
  console.log("movie: " + (buttons ? "buttons" : "pad") + ", toy frames " +
              (f0 + 1) + ".." + (f0 + n) + ", " + (2 * n) + " records" +
              (buttons ? ", first hold at frame " + start : ""));
  return 0;
}

if (require.main === module) process.exit(main(process.argv));
module.exports = { padAt, buttonsAt, word, BUTTONS, BUTTON_START,
                   BUTTON_HOLD, BUTTON_GAP, BUTTON_STEPS, BUTTON_LENGTH };
