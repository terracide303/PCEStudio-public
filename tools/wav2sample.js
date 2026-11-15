#!/usr/bin/env node
/*
 * tools/wav2sample.js — the sample importer: WAV files in, the toy's samples.json out (the way
 * tools/bake-art.js turns pictures into art files).
 *
 *   node tools/wav2sample.js TOYDIR/samples.json NAME=file.wav[,div=2][,bits=5] [NAME=file.wav ...]
 *
 * div 1..4 is the timer divisor: 6,991 / div Hz (default 2: 3,496 Hz); bits 4 or 5 (default 5).
 * The file is replaced.  Prints each sample's size and the ROM's sample-bank budget.
 * The converter is renderer/pce-sample.js, the one the studio uses.
 */
"use strict";
const fs = require("fs");
const sample = require("../renderer/pce-sample.js");

const [out, ...specs] = process.argv.slice(2);
if (!out || !specs.length) {
  console.error("usage: node tools/wav2sample.js samples.json NAME=file.wav[,div=2][,bits=5] ...");
  process.exit(2);
}
try {
  const list = specs.map((spec) => {
    const m = /^([^=]+)=([^,]+)((?:,[a-z]+=\d+)*)$/.exec(spec);
    if (!m) throw new Error("sample-file: expected NAME=file.wav[,div=N][,bits=N], got " + spec);
    const opt = {};
    m[3].split(",").filter(Boolean).forEach((kv) => { const [k, v] = kv.split("="); opt[k] = +v; });
    const c = sample.convert(sample.parseWav(fs.readFileSync(m[2])), opt);
    return { name: m[1], div: c.div, bits: c.bits, data: c.data };
  });
  const budget = sample.check(list);
  fs.writeFileSync(out, sample.stringify(list));
  list.forEach((s) => console.log(s.name + ": " + s.data.length + " steps, " +
    Math.round(sample.rateOf(s.div)) + " Hz, " + (s.data.length / sample.rateOf(s.div)).toFixed(2) + " s, " + s.bits + " bit"));
  console.log("sample bank: " + budget.bytes + " of " + budget.max + " bytes" + (budget.ok ? "" : " — OVER (" + budget.code + ")"));
  if (!budget.ok) process.exit(1);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
