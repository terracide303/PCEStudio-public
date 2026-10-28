#!/usr/bin/env node
/*
 * tests/check-wave.js — the #35 wave editor's export, end to end.
 *
 * NOTE: written by @design as part of #35 because the card's close condition
 * needs a diff script; per the workshop role split this is flagged for @review
 * to read cold (rule 2).
 *
 * What it proves, and by which comparison:
 *
 *  1. The editor's refusals.  pce-wave.js refuses what the PSG cannot take,
 *     each with a machine-readable code (wave-step, wave-range, freq-range,
 *     al-range, balance-range, noise-channel, noise-range, lfo-range,
 *     channel-range).  Each is asserted below with its code.
 *
 *  2. The exported ROM is the assembler's ROM.  The sound the dump carries is
 *     re-derived from renderer/pce-wave.js (tools/wavesounds.js) and compared
 *     with the dump's sound.json; tools/genwave.py then regenerates the
 *     reference asm and trace, PCEAS assembles tools/gen/waveN.pce, and
 *     pce-wave.js's buildRom() must produce the same 8 KiB image byte for
 *     byte.  So the browser's exporter and an independent PCEAS program agree
 *     on the ROM — the same shape as #9's check-export.js.
 *
 *  3. The two schedule simulators agree.  pce-wave.js ports #34's
 *     genpsg.py simulate(); the dump's trace.json (Python) must equal the
 *     JS trace(), both derived from the same sound.  A trace that is wrong in
 *     either place changes the PCM, and the replay below would fail — this is
 *     the provenance step.
 *
 *  4. What the editor hears is what the ROM plays.  tests/dumps/waveN/ holds
 *     Mednafen's recording of the exported ROM (tools/capture-wave.sh).  The
 *     recorded frame count is solved from the WAV length alone, the trace is
 *     replayed through renderer/pce-psg.js, and the PCM must equal the WAV
 *     sample for sample (first mismatch reported with its neighbourhood).
 *
 * The per-dump diagnostics after the equality (peaks, per-side RMS, the LFO
 * sweep) are measurements of the recording, not pass criteria.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const psg = require("../renderer/pce-psg.js");
const wave = require("../renderer/pce-wave.js");

const HERE = __dirname;
const ROOT = path.join(HERE, "..");
const GEN = path.join(ROOT, "tools", "gen");
const DUMPS = path.join(HERE, "dumps");
const TWO32 = 4294967296;

let failures = 0;
function fail(what) { console.log(`  FAIL ${what}`); failures++; }
function ok(what) { console.log(`  ok   ${what}`); }

/* ---- 1. the editor's refusals ------------------------------------------ */

function refuses(fn, code, what) {
  try {
    fn();
    fail(`${what}: no refusal (expected code ${code})`);
  } catch (e) {
    if (e.code === code) ok(`${what}: refused with ${code}`);
    else fail(`${what}: refused with ${e.code || e.message}, expected ${code}`);
  }
}

function checkRefusals() {
  const s = wave.newSound();
  refuses(() => wave.paintStep(s, 0, 32, 1), "wave-step", "step 32");
  refuses(() => wave.paintStep(s, 0, 0, 32), "wave-range", "wave value 32");
  refuses(() => wave.paintStep(s, 6, 0, 1), "channel-range", "channel 6");
  refuses(() => wave.setFreq(s, 0, 4096), "freq-range", "frequency 4096");
  refuses(() => wave.setLevel(s, 0, 32), "al-range", "AL 32");
  refuses(() => wave.setBalance(s, 0, 256), "balance-range", "balance 256");
  refuses(() => wave.setMainVolume(s, 256), "balance-range",
          "main volume 256");
  refuses(() => wave.setNoise(s, 3, { on: true, nf: 1 }), "noise-channel",
          "noise on channel 4 (0-based 3)");
  refuses(() => wave.setNoise(s, 4, { on: true, nf: 32 }), "noise-range",
          "NF 32");
  refuses(() => wave.setLfo(s, { freq: 256, ctl: 1 }), "lfo-range",
          "LFO frequency 256");
  refuses(() => wave.setLfo(s, { freq: 255, ctl: 4 }), "lfo-range", "LFCTL 4");
  refuses(() => wave.setWave(s, 0, [0, 1, 2]), "wave-range",
          "a 3-step wave");
  /* and the six presets are inside the PSG's 5 bits */
  for (const name of Object.keys(wave.PRESETS)) {
    try {
      wave.setPreset(wave.newSound(), 0, name);
      ok(`preset '${name}' accepted`);
    } catch (e) { fail(`preset '${name}': ${e.code || e.message}`); }
  }
}

/* ---- shared with check-psg.js: WAV, frame count, measurements ----------- */

function parseWav(buf) {
  if (buf.slice(0, 4).toString("latin1") !== "RIFF" ||
      buf.slice(8, 12).toString("latin1") !== "WAVE")
    throw new Error("not a RIFF/WAVE file");
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.slice(pos, pos + 4).toString("latin1");
    const len = buf.readUInt32LE(pos + 4);
    if (id === "fmt ") fmt = buf.slice(pos + 8, pos + 8 + len);
    else if (id === "data") data = buf.slice(pos + 8, pos + 8 + len);
    pos += 8 + len + (len & 1);
  }
  if (!fmt || !data) throw new Error("fmt/data chunks missing");
  if (fmt.readUInt16LE(0) !== 1 || fmt.readUInt16LE(2) !== 2 ||
      fmt.readUInt32LE(4) !== 44100 || fmt.readUInt16LE(14) !== 16)
    throw new Error("unsupported WAV format");
  const samples = new Int16Array(data.length / 2);
  for (let i = 0; i < samples.length; i++)
    samples[i] = data.readInt16LE(i * 2);
  return { samples, frames: samples.length / 2 };
}

function totalSamples(trace, n) {
  let clocks = 0;
  for (let k = 0; k < n; k++) clocks += wave.frameT(trace, k);
  return Math.floor(clocks * psg.FACTOR / TWO32);
}

function solveFrames(trace, L) {
  let lo = 1;
  let hi = Math.floor(L / 700) + 20;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (totalSamples(trace, mid) >= L) hi = mid;
    else lo = mid + 1;
  }
  return totalSamples(trace, lo) === L ? lo : -1;
}

function rms(samples, from, len, ch) {
  let s = 0;
  for (let f = from; f < from + len; f++) {
    const v = samples[2 * f + ch];
    s += v * v;
  }
  return Math.sqrt(s / len);
}

function zcPitch(samples, from, len, rate, ch) {
  let crossings = 0;
  for (let f = from + 1; f < from + len; f++) {
    const a = samples[2 * (f - 1) + ch];
    const b = samples[2 * f + ch];
    if ((a < 0 && b >= 0) || (a >= 0 && b < 0)) crossings++;
  }
  return crossings / 2 * rate / len;
}

function fftPeaks(samples, from, n, rate, count, ch) {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
    re[i] = samples[2 * (from + i) + ch] * w;
  }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const wRe = Math.cos(-2 * Math.PI / len);
    const wIm = Math.sin(-2 * Math.PI / len);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        const uRe = re[i + k], uIm = im[i + k];
        re[i + k] = uRe + vRe; im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe; im[i + k + len / 2] = uIm - vIm;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nRe;
      }
    }
  }
  let max = 0;
  const mag = new Float64Array(n / 2);
  for (let i = 1; i < n / 2; i++) {
    mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    if (mag[i] > max) max = mag[i];
  }
  const peaks = [];
  for (let i = 2; i < n / 2 - 1; i++) {
    if (mag[i] > max / 100 && mag[i] >= mag[i - 1] && mag[i] >= mag[i + 1])
      peaks.push({ hz: i * rate / n, mag: mag[i] });
  }
  peaks.sort((a, b) => b.mag - a.mag);
  return peaks.slice(0, count).map((p) => `${p.hz.toFixed(1)} Hz`);
}

/* ---- canonical JSON, so field order does not matter -------------------- */

function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = canon(v[k]);
    return o;
  }
  return v;
}

function same(a, b) {
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

/* ---- 2..4, one dump ---------------------------------------------------- */

function checkDump(dir) {
  const name = path.basename(dir);
  const dumpSound = JSON.parse(fs.readFileSync(path.join(dir, "sound.json"),
                                             "utf8"));
  const dumpTrace = JSON.parse(fs.readFileSync(path.join(dir, "trace.json"),
                                              "utf8"));
  const log = fs.readFileSync(path.join(dir, "mednafen.log"), "utf8");
  const wav = parseWav(fs.readFileSync(path.join(dir, "mednafen.wav")));

  /* the sound is the editor's, today (tools/wavesounds.js) */
  const freshSound = JSON.parse(fs.readFileSync(
    path.join(GEN, `${name}.sound.json`), "utf8"));
  if (!same(dumpSound, freshSound)) {
    console.log(`${name}: dump's sound.json differs from the editor's — ` +
                `re-run tools/capture-wave.sh ${name.replace(/^wave/, "")}`);
    failures++; return;
  }
  const sound = dumpSound.sound;

  /* provenance: the recording ran the core the model replicates */
  if (log.indexOf("Using module: pce_fast") < 0) {
    console.log(`${name}: mednafen.log does not say 'Using module: pce_fast'`);
    failures++; return;
  }
  if (log.indexOf("CPU overclock") >= 0) {
    console.log(`${name}: the run used a CPU overclock (ocmultiplier must ` +
                `be 1 — the model assumes 1x)`);
    failures++; return;
  }

  /* 2. the editor's ROM is PCEAS's ROM */
  const refPath = path.join(GEN, `${name}.pce`);
  if (!fs.existsSync(refPath)) {
    console.log(`${name}: missing ${path.relative(ROOT, refPath)} — run ` +
                `make -C tools (or tools/capture-wave.sh)`);
    failures++; return;
  }
  const mine = Buffer.from(wave.buildRom(sound));
  const ref = fs.readFileSync(refPath);
  if (!mine.equals(ref)) {
    let at = -1;
    for (let i = 0; i < Math.max(mine.length, ref.length); i++)
      if (mine[i] !== ref[i]) { at = i; break; }
    console.log(`${name}: buildRom() differs from the PCEAS image at byte ` +
                `${at} (${mine.length} vs ${ref.length} bytes)`);
    failures++; return;
  }
  ok(`${name}: buildRom() == PCEAS (${ref.length} bytes, byte for byte)`);

  /* 3. the two schedule simulators agree */
  const jsTrace = wave.trace(sound, dumpSound.name, dumpSound.what);
  if (!same(jsTrace, dumpTrace)) {
    console.log(`${name}: pce-wave.js's trace() differs from genwave.py's`);
    failures++; return;
  }
  ok(`${name}: trace() == tools/genwave.py (${dumpTrace.events.length} ` +
     `writes, all in frame ${dumpTrace.events[dumpTrace.events.length - 1].f})`);

  /* 4. the model's PCM is the recording, sample for sample */
  const L = wav.frames;
  const n = solveFrames(dumpTrace, L);
  if (n < 0) {
    console.log(`${name}: no whole-frame count matches ${L} sample frames`);
    failures++; return;
  }
  const got = psg.render(dumpTrace.events, dumpTrace.frames, n);
  if (got.pcm.length !== wav.samples.length) {
    console.log(`${name}: SIZE MISMATCH model ${got.pcm.length} vs wav ` +
                `${wav.samples.length} samples`);
    failures++; return;
  }
  let first = -1;
  for (let i = 0; i < got.pcm.length; i++) {
    if (got.pcm[i] !== wav.samples[i]) { first = i; break; }
  }
  if (first >= 0) {
    const lo = Math.max(0, first - 8), hi = Math.min(got.pcm.length, first + 8);
    let ctx = "";
    for (let i = lo; i < hi; i++)
      ctx += `\n    [${i}] model ${got.pcm[i]} wav ${wav.samples[i]}`;
    console.log(`${name}: ${first}st sample differs (${n} frames, ${L} ` +
                `recorded)${ctx}`);
    failures++; return;
  }
  ok(`${name}: model == Mednafen WAV (${n} frames, ${wav.samples.length} ` +
     `samples, diff 0)`);

  /* measurements of the recording */
  const s = wav.samples;
  console.log(`  ${name} diagnostics (measurements of the recording):`);
  if (name === "wave1") {
    console.log(`    FFT peaks: ${fftPeaks(s, 22050, 32768, 44100, 8, 0)
      .join(", ")}`);
    console.log(`    RMS L ${rms(s, 22050, 22050, 0).toFixed(1)} R ` +
                `${rms(s, 22050, 22050, 1).toFixed(1)} (six voices, ` +
                `balance 0xFF/0xFF/0xF0/0x0F/0xFF/0xFF)`);
  } else if (name === "wave2") {
    const win = 4096, hop = 1024, pitches = [];
    for (let f = 0; f + win < L; f += hop) {
      if (rms(s, f, win, 0) > 50) pitches.push(zcPitch(s, f, win, 44100, 0));
    }
    console.log(`    pitch min ${Math.min(...pitches).toFixed(1)} max ` +
                `${Math.max(...pitches).toFixed(1)} Hz (the LFCTL 1 sweep ` +
                `#34's psg6 measures at 414..470); ${pitches.length} windows`);
  }
}

/* ---- main -------------------------------------------------------------- */

function main() {
  console.log("== refusals (pce-wave.js)");
  checkRefusals();
  if (failures) return 1;

  /* regenerate the editor's sounds and the PCEAS reference from them */
  cp.execFileSync("node", [path.join(ROOT, "tools", "wavesounds.js")],
                  { stdio: "inherit" });
  cp.execFileSync("python3", ["-I", path.join(ROOT, "tools", "genwave.py")],
                  { stdio: "inherit" });

  if (!fs.existsSync(DUMPS)) {
    console.error(`no dumps in ${DUMPS} — run tools/capture-wave.sh 1 first`);
    return 2;
  }
  const dirs = fs.readdirSync(DUMPS)
    .filter((d) => /^wave/.test(d) &&
                   fs.existsSync(path.join(DUMPS, d, "mednafen.wav")))
    .sort().map((d) => path.join(DUMPS, d));
  if (dirs.length === 0) {
    console.error("no wave dumps with mednafen.wav found");
    return 2;
  }
  console.log("== the exported ROM and its recording");
  for (const dir of dirs) checkDump(dir);

  if (failures === 0) {
    console.log(`PASS: the wave editor's export is PCEAS's ROM and ` +
                `Mednafen's sound on ${dirs.length} patch(es)`);
    return 0;
  }
  console.log(`FAIL: ${failures} check(s) failed`);
  return 1;
}

process.exitCode = main();
