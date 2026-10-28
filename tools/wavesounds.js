#!/usr/bin/env node
/*
 * tools/wavesounds.js — write the #35 wave-editor demo patches as JSON.
 *
 * PCEStudio's one definition of a sound is renderer/pce-wave.js (the editor's
 * document).  This script is the bridge to the PCEAS reference path: it writes
 * the two demo patches to tools/gen/waveN.sound.json, which
 *
 *   tools/genwave.py   turns into tools/gen/waveN.asm + waveN.trace.json
 *   pceas              assembles the asm into tools/gen/waveN.pce
 *   tests/check-wave.js compares that ROM and trace against what
 *                      pce-wave.js builds from the same sound — the editor's
 *                      export against the assembler's, byte for byte — and
 *                      compares the model's PCM against Mednafen's recording
 *                      of the ROM (tests/dumps/waveN/, tools/capture-wave.sh).
 *
 * The JSON is the whole sound, so a reader can see exactly what the two
 * builders were given.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const wave = require("../renderer/pce-wave.js");

const GEN = path.join(__dirname, "gen");

const SOUNDS = {
  wave1: {
    what: "the six-voice chord: six wave shapes, the manual's scale-table " +
          "frequencies (PB-12) at F=254/214/170/127/107 plus a bass at " +
          "F=1151 (R3's high nibble in use), AL and balance varied per " +
          "channel, noise on channel 6 (NF 10) under the sine",
    sound: wave.demoSound()
  },
  wave2: {
    what: "the LFO: ch1 square tone wobbled by ch2's saw carrier (LFCTL 1, " +
          "R8=255 -> 1.727 Hz), ch2 silent, the rest off",
    sound: wave.lfoSound()
  },
  wave3: {
    what: "the model's worst LFO case: the wave2 patch with LFCTL 3 (x16 " +
          "deviation, shift 4), so the 12-bit sum runs 4094, 4095, 0 " +
          "(->4096), 1, 17 ... 494 — 27 Hz, the tiny-F fast path, then 6.6 " +
          "kHz down to 226 Hz",
    sound: wave.lfo3Sound()
  }
};

function json(sound) {
  /* the register order genwave.py and pce-wave.js both read */
  return {
    channels: sound.channels.map((c) => ({
      wave: c.wave.slice(),
      freq: c.freq,
      al: c.al,
      balance: c.balance,
      on: c.on,
      noise: c.noise ? { on: c.noise.on, nf: c.noise.nf } : null
    })),
    mainVolume: sound.mainVolume,
    lfo: { freq: sound.lfo.freq, ctl: sound.lfo.ctl }
  };
}

function main() {
  fs.mkdirSync(GEN, { recursive: true });
  for (const name of Object.keys(SOUNDS)) {
    const doc = { name: name, what: SOUNDS[name].what,
                  sound: json(SOUNDS[name].sound) };
    fs.writeFileSync(path.join(GEN, `${name}.sound.json`),
                     JSON.stringify(doc, null, 1) + "\n");
    const st = wave.stats(SOUNDS[name].sound);
    console.log(`${name}: ${st.writes} writes, ${st.cycles} cycles, ` +
                `${st.bytes}-byte ROM, ${st.on} channel(s) on, ` +
                `${st.noise} noise, lfo ${st.lfo ? "on" : "off"}`);
  }
}

main();
