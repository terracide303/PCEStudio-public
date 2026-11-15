#!/usr/bin/env node
/*
 * tools/gen-sample-wav.js — synthesise the repo's own sample sources (no recordings of anyone's games).
 *
 *   node tools/gen-sample-wav.js OUTDIR     writes thump.wav and click.wav (16-bit mono, 22,050 Hz)
 *
 * thump: a sine that falls from 130 Hz to 45 Hz with an exponential decay, 0.30 s, plus a 3 ms burst
 * of a fixed-seed noise at the start.  click: 12 ms of a decaying 1.6 kHz square.  Deterministic.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const RATE = 22050;

function wav(pcm) {
  const b = Buffer.alloc(44 + pcm.length * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + pcm.length * 2, 4); b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(pcm.length * 2, 40);
  pcm.forEach((v, i) => b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), 44 + i * 2));
  return b;
}

function thump() {
  const n = Math.floor(RATE * 0.30), out = [];
  let phase = 0, seed = 12345;
  for (let i = 0; i < n; i++) {
    const t = i / RATE, f = 45 + (130 - 45) * Math.exp(-t * 18);
    phase += 2 * Math.PI * f / RATE;
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const burst = t < 0.003 ? ((seed >> 8) / 0x800000 - 1) * 0.5 : 0;
    out.push(Math.sin(phase) * Math.exp(-t * 9) * 0.9 + burst);
  }
  return out;
}

function click() {
  const n = Math.floor(RATE * 0.012), out = [];
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    out.push((Math.floor(t * 1600 * 2) % 2 ? 1 : -1) * Math.exp(-t * 300) * 0.9);
  }
  return out;
}

const dir = process.argv[2];
if (!dir) { console.error("usage: node tools/gen-sample-wav.js OUTDIR"); process.exit(2); }
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "thump.wav"), wav(thump()));
fs.writeFileSync(path.join(dir, "click.wav"), wav(click()));
