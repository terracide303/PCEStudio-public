#!/usr/bin/env node
/*
 * tools/oak-woods-song.js — write toys/oak-woods/song.json (card #128).
 *
 * The toy needs a song music(0) can play.  #129 collects licensed PC Engine
 * tunes; until one is cleared, this is an original six-channel module in the
 * shape renderer/pce-dmf.js returns, so renderer/pce-song.js's player (the
 * HuTrack engine's own write order) plays it with no DMF binary and nothing
 * borrowed.  The melody is four bars in A minor; channel 0 is the lead,
 * channel 1 a fifth below and channel 2 the bass.  Everything is written
 * here, so the song can be edited as notes rather than bytes.
 *
 *   node tools/oak-woods-song.js           rewrite toys/oak-woods/song.json
 *   node tools/oak-woods-song.js --check    exit 1 if the file is not this
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "toys", "oak-woods", "song.json");
const CHANNELS = 6;

/* C=0 … B=11 (the DMF's note numbering). */
const N = { C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7,
            "G#": 8, A: 9, "A#": 10, B: 11 };

function note(name, octave) {
  return { semitone: N[name], octave: octave };
}

/* Four bars of eight rows: the lead, the same a fifth below, the bass. */
const LEAD = [
  ["A", 4], ["C", 5], ["E", 5], ["A", 5], ["G", 5], ["E", 5], ["C", 5], ["A", 4],
  ["G", 4], ["B", 4], ["D", 5], ["G", 5], ["F", 5], ["D", 5], ["B", 4], ["G", 4],
  ["F", 4], ["A", 4], ["C", 5], ["F", 5], ["E", 5], ["C", 5], ["A", 4], ["F", 4],
  ["E", 4], ["G#", 4], ["B", 4], ["E", 5], ["D", 5], ["B", 4], ["G#", 4], ["E", 4],
];
const BASS = [
  ["A", 2], ["A", 2], ["E", 2], ["E", 2], ["A", 2], ["A", 2], ["E", 2], ["E", 2],
  ["G", 2], ["G", 2], ["D", 2], ["D", 2], ["G", 2], ["G", 2], ["D", 2], ["D", 2],
  ["F", 2], ["F", 2], ["C", 2], ["C", 2], ["F", 2], ["F", 2], ["C", 2], ["C", 2],
  ["E", 2], ["E", 2], ["B", 2], ["B", 2], ["E", 2], ["E", 2], ["B", 2], ["B", 2],
];

const SQUARE = [];
for (let i = 0; i < 32; i++) SQUARE.push(i < 16 ? 31 : 0);

function row(pair, instrument) {
  if (!pair) return { note: null, octave: 0, volume: null, effects: [],
                      fxSlots: [], instrument: null };
  const n = note(pair[0], pair[1]);
  return { note: n, octave: n.octave, volume: null, effects: [],
           fxSlots: [], instrument: instrument };
}

function pattern(rows) {
  const out = [];
  for (let r = 0; r < 16; r++) out.push(rows[r] || row(null));
  return out;
}

function song() {
  const nullChannel = () => [pattern([]), pattern([])];
  const lead0 = pattern(LEAD.slice(0, 16).map((p, i) => (i % 2 === 0 ? row(p, 0) : null)));
  const lead1 = pattern(LEAD.slice(16, 32).map((p, i) => (i % 2 === 0 ? row(p, 0) : null)));
  const fifth = (p) => {
    const semi = (N[p[0]] + 7) % 12;
    const name = Object.keys(N).find((k) => N[k] === semi);
    return [name, p[1]];
  };
  const harm0 = pattern(LEAD.slice(0, 16).map((p, i) => (i % 4 === 2 ? row(fifth(p), 0) : null)));
  const harm1 = pattern(LEAD.slice(16, 32).map((p, i) => (i % 4 === 2 ? row(fifth(p), 0) : null)));
  const bass0 = pattern(BASS.slice(0, 16).map((p, i) => (i % 2 === 0 ? row(p, 0) : null)));
  const bass1 = pattern(BASS.slice(16, 32).map((p, i) => (i % 2 === 0 ? row(p, 0) : null)));

  const instruments = [{
    name: "square", mode: 0,
    volumeEnv: { size: 1, data: [31], loop: 0xff },
    arpeggioEnv: { size: 0, data: [], loop: 0xff, mode: 0 },
    noiseEnv: { size: 0, data: [], loop: 0xff },
    wavetableEnv: { size: 1, data: [0], loop: 0xff },
  }];

  return {
    version: 24, platform: 5,
    songName: "Oak Woods",
    author: "PCEStudio",
    timeBase: 1, tick1: 6, tick2: 6, frameMode: 1, customHz: 0,
    rowsPerPattern: 16, orderCount: 2,
    orderMatrix: [
      [0, 1], [0, 1], [0, 1], [0, 0], [0, 0], [0, 0],
    ],
    instruments: instruments,
    wavetables: [SQUARE],
    patterns: [
      [lead0, lead1], [harm0, harm1], [bass0, bass1],
      nullChannel(), nullChannel(), nullChannel(),
    ],
    samples: [],
    legacyArpSpeed: 1,
    bytes: 0,
  };
}

const text = JSON.stringify(song(), null, 1) + "\n";
const at = process.argv.indexOf("--check");
if (at >= 0) {
  const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (have !== text) {
    console.log("FAIL  toys/oak-woods/song.json is not what this tool writes");
    process.exit(1);
  }
  console.log("PASS  toys/oak-woods/song.json is the tool's output");
} else {
  fs.writeFileSync(OUT, text);
  console.log("wrote " + OUT);
}
