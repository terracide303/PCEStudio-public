#!/usr/bin/env node
/*
 * tools/mkmovie.js — build a Mednafen input movie for the scripted pad
 * (card #45).
 *
 *   node tools/mkmovie.js STATE.raw OUT.mcm FIRST_FRAME FRAMES
 *
 * STATE.raw is a Mednafen save state with its gzip wrapper removed (the
 * bytes a .mca holds); OUT.mcm is that state followed by the input records
 * for toy frames FIRST_FRAME+1 .. FIRST_FRAME+FRAMES.
 *
 * The record layout is Mednafen's own (src/movie.cpp MDFNMOV_ProcessInput):
 * one $00 command byte, then each port's data — 2 bytes per port, port 1
 * being multitap controller 1.  Mednafen processes TWO records per video
 * frame (the frontend calls the movie reader at the mid-frame sync and again
 * at the end; measured: 200 records of Right moved the sprite 100 frames), so
 * each frame's value is written twice — which is also what a movie Mednafen
 * itself records contains.
 *
 * The pad word is Mednafen's gamepad bitfield (src/pce/input/gamepad.cpp):
 * bits 0..3 II, I, Select, Run; bits 4..7 Up, Right, Down, Left.
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

const WORD = { ii: 1, i: 2, select: 4, run: 8, up: 0x10, right: 0x20,
               down: 0x40, left: 0x80 };

function word(p) {
  let w = 0;
  for (const k of Object.keys(WORD)) if (p[k]) w |= WORD[k];
  return w;
}

function main(argv) {
  const [statePath, outPath, first, frames] = argv.slice(2);
  if (!statePath || !outPath || !first || !frames) {
    console.error("usage: node tools/mkmovie.js STATE.raw OUT.mcm FIRST FRAMES");
    return 2;
  }
  const f0 = parseInt(first, 10);
  const n = parseInt(frames, 10);
  const out = [fs.readFileSync(statePath)];
  for (let i = 1; i <= n; i++) {
    const rec = Buffer.alloc(11);
    rec[0] = 0;                       /* no command this frame */
    rec.writeUInt16LE(word(padAt(f0 + i)), 1);
    out.push(Buffer.from(rec), Buffer.from(rec));   /* two records per frame */
  }
  fs.writeFileSync(outPath, Buffer.concat(out));
  console.log("movie: toy frames " + (f0 + 1) + ".." + (f0 + n) +
              ", " + (2 * n) + " records");
  return 0;
}

if (require.main === module) process.exit(main(process.argv));
module.exports = { padAt, word };
