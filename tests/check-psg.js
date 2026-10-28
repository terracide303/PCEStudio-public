#!/usr/bin/env node
/*
 * tests/check-psg.js — diff the #34 PSG model against Mednafen's audio
 * recordings.
 *
 * NOTE: written by @design as part of #34 because the card's close condition
 * needs a diff script; per the workshop role split this is flagged for @review
 * to read cold.
 *
 * For every tests/dumps/psgN/ directory it reads mednafen.wav (the audio
 * Mednafen recorded from the PSG test ROM — PCM16 LE stereo at 44100 Hz,
 * the pce_fast core's HuC6280 through Blip_Buffer with the resampler and
 * volume bypassed, see tools/capture-psg.sh), regenerates the ROM's
 * register-write trace with tools/genpsg.py and requires the dump's
 * trace.json to be byte-identical to the fresh one (provenance: the trace
 * describes the ROM that ran), solves the recorded frame count N from the
 * WAV length alone (the recording holds whole frames, so
 * length = floor(sum of frame durations * FACTOR / 2^32)), replays the
 * trace through renderer/pce-psg.js and requires sample-for-sample equality
 * with the WAV (first mismatch reported with its neighbourhood).
 *
 * The WAV is the pure PSG witness: the ROMs never touch the VDC/VCE/timer/
 * IRQ hardware, so once the register writes (a few frames) are done the
 * recording is the PSG clocking its channels for minutes of frame budgets
 * whose per-frame overshoot cycles through the trace's frames.pattern.
 * Exit code 0 only if every recording matches exactly.
 *
 * Beyond the equality each dump prints diagnostics for the report — the
 * measured pitch, levels and spectra that say what the sound actually is
 * (psg3: per-side RMS; psg4: segment levels in dB; psg6/6b: the wobble's
 * min/max pitch; psg7: the number of distinct DDA levels).  These are
 * measurements of the recording, not pass criteria.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const psg = require("../renderer/pce-psg.js");

const TWO32 = 4294967296;

/* ---- minimal WAV reader: PCM16 LE ---- */
function parseWav(buf) {
  if (buf.slice(0, 4).toString("latin1") !== "RIFF" ||
      buf.slice(8, 12).toString("latin1") !== "WAVE")
    throw new Error("not a RIFF/WAVE file");
  let pos = 12;
  let fmt = null;
  let data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.slice(pos, pos + 4).toString("latin1");
    const len = buf.readUInt32LE(pos + 4);
    if (id === "fmt ") {
      fmt = buf.slice(pos + 8, pos + 8 + len);
    } else if (id === "data") {
      data = buf.slice(pos + 8, pos + 8 + len);
    }
    pos += 8 + len + (len & 1);
  }
  if (!fmt || !data) throw new Error("fmt/data chunks missing");
  const format = fmt.readUInt16LE(0);
  const channels = fmt.readUInt16LE(2);
  const rate = fmt.readUInt32LE(4);
  const bits = fmt.readUInt16LE(14);
  if (format !== 1 || channels !== 2 || rate !== 44100 || bits !== 16)
    throw new Error(`unsupported WAV ${format}/${channels}ch/${rate}/${bits}`);
  const samples = new Int16Array(data.length / 2);
  for (let i = 0; i < samples.length; i++)
    samples[i] = data.readInt16LE(i * 2);
  return { samples, frames: samples.length / 2 };
}

/* ---- the recorded frame count: the unique N with avail(total clocks) == L.
 * Blip_Buffer's offset_ accumulates frame budgets without rounding between
 * frames (end_frame does offset_ += t*factor_), so the samples available
 * after N frames is floor(total_clocks * FACTOR / 2^32) — not a sum of
 * per-frame floors (the fractional part carries over).  Frame durations
 * come from the trace: t0, the non-steady frames (extra), then the
 * periodic idle tail. ---- */
function frameT(trace, k) {
  if (k === 0) return trace.frames.t0;
  const extra = trace.frames.extra;
  if (k <= extra.length) return extra[k - 1];
  return trace.frames.pattern[(k - 1 - extra.length) % trace.frames.pattern.length];
}

function totalSamples(trace, n) {
  let clocks = 0;
  for (let k = 0; k < n; k++) clocks += frameT(trace, k);
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

/* ---- measurements of the recording (report, not pass criteria) ----
 * All of these read one channel of the interleaved PCM: from/len are in
 * sample frames (L at samples[2f], R at samples[2f+1]). ---- */
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
  /* radix-2 FFT of a Hann-windowed block, top `count` magnitude peaks */
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
    if (i < j) {
      const t = re[i]; re[i] = re[j]; re[j] = t;
    }
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

/* sample FRAME index of cycle t in frame f: Blip_Buffer's offset_ accumulates
 * frame budgets continuously, so floor(total_clocks * FACTOR / 2^32) — one
 * frame holds the L/R sample pair (L at samples[2f], R at samples[2f+1]) */
function sampleIdx(trace, f, t) {
  let clocks = t;
  for (let k = 0; k < f; k++) clocks += frameT(trace, k);
  return Math.floor(clocks * psg.FACTOR / TWO32);
}

/* RMS of one channel over the sample-frame range [s0, s1) */
function segRms(samples, s0, s1, ch) {
  const f0 = Math.floor(s0);
  const f1 = Math.floor(s1);
  return rms(samples, f0, f1 - f0, ch);
}

function diagnose(name, samples, trace) {
  const L = samples.length / 2;
  console.log(`  ${name} diagnostics (measurements of the recording):`);
  if (name === "psg1") {
    console.log(`    pitch ${zcPitch(samples, 22050, 22050, 44100, 0).toFixed(2)} Hz ` +
                `(F=254 -> 440.45 Hz), RMS L ${rms(samples, 22050, 22050, 0).toFixed(1)}`);
  } else if (name === "psg2") {
    const peaks = fftPeaks(samples, 22050, 32768, 44100, 12, 0);
    console.log(`    FFT peaks (expect 440.5/522.7/658.0/782.4/880.9/1045.7): ` +
                peaks.join(", "));
  } else if (name === "psg3") {
    /* the three balance phases, bounded by the R5 writes */
    const toneOn = trace.events.find((e) => e.reg === 4 && (e.value & 0x80));
    const onIdx = trace.events.indexOf(toneOn);
    let a = sampleIdx(trace, toneOn.f, toneOn.t);
    const phases = [];
    for (const e of trace.events.slice(onIdx + 1).filter((ev) => ev.reg === 5)) {
      const b = sampleIdx(trace, e.f, e.t);
      phases.push([a, b]);
      a = b;
    }
    phases.push([a, L]);
    const mid = ([s0, s1], ch) => segRms(samples,
      s0 + (s1 - s0) * 0.4, s0 + (s1 - s0) * 0.8, ch);
    console.log(`    both L ${mid(phases[0], 0).toFixed(1)} ` +
                `R ${mid(phases[0], 1).toFixed(1)} | ` +
                `L-only L ${mid(phases[1], 0).toFixed(1)} ` +
                `R ${mid(phases[1], 1).toFixed(1)} | ` +
                `R-only L ${mid(phases[2], 0).toFixed(1)} ` +
                `R ${mid(phases[2], 1).toFixed(1)}`);
  } else if (name === "psg4") {
    /* the six volume phases, bounded by the R1/R4 writes */
    const toneOn = trace.events.find((e) => e.reg === 4 && (e.value & 0x80));
    const onIdx = trace.events.indexOf(toneOn);
    const bounds = [sampleIdx(trace, toneOn.f, toneOn.t)];
    for (const e of trace.events.slice(onIdx + 1)) {
      if (e.reg === 1 || (e.reg === 4 && (e.value & 0x80)))
        bounds.push(sampleIdx(trace, e.f, e.t));
    }
    const parts = ["on (0x9F/0xFF)", "0x88 (-15/4 -> -22.6 dB)", "0x00",
                   "0xFF", "AL=0x10", "AL=0x00"];
    const segs = parts.map((p, i) => [bounds[i],
      i + 1 < bounds.length ? bounds[i + 1] : L]);
    const base = segRms(samples, segs[0][0] + (segs[0][1] - segs[0][0]) * 0.4,
      segs[0][0] + (segs[0][1] - segs[0][0]) * 0.8, 0);
    const db = (i) => (20 * Math.log10(segRms(samples,
      segs[i][0] + (segs[i][1] - segs[i][0]) * 0.4,
      segs[i][0] + (segs[i][1] - segs[i][0]) * 0.8, 0) / base)).toFixed(2);
    console.log(`    segment levels: ${parts.map((p, i) => `${p} ${db(i)} dB`)
      .join(", ")}`);
  } else if (name === "psg5") {
    console.log(`    RMS L ${rms(samples, 22050, 22050, 0).toFixed(1)} ` +
                `R ${rms(samples, 22050, 22050, 1).toFixed(1)} (noise, both ` +
                `channels)`);
  } else if (name === "psg6" || name === "psg6b") {
    const win = 4096, hop = 1024;
    const pitches = [];
    for (let f = 0; f + win < L; f += hop) {
      if (rms(samples, f, win, 0) > 50)
        pitches.push(zcPitch(samples, f, win, 44100, 0));
    }
    const min = Math.min(...pitches), max = Math.max(...pitches);
    console.log(`    pitch min ${min.toFixed(1)} max ${max.toFixed(1)} Hz ` +
                `(${name === "psg6" ? "~416..470" : "~352..589"} expected); ` +
                `${pitches.length} windows`);
  } else if (name === "psg7") {
    /* the 16 DDA holds: the accumulated output at each hold's centre */
    const evs = trace.events.filter((e) => e.reg === 6);
    const centers = evs.map((e) => {
      const si = sampleIdx(trace, e.f, e.t) + 37;
      return samples[2 * si];
    });
    const distinct = new Set(centers.map((v) => Math.round(v / 8)));
    console.log(`    ${evs.length} DDA holds, centre levels: ` +
                `${centers.join(", ")} (${distinct.size} distinct)`);
  }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function checkDump(dir) {
  const name = path.basename(dir);
  const wav = parseWav(fs.readFileSync(path.join(dir, "mednafen.wav")));
  const trace = JSON.parse(fs.readFileSync(path.join(dir, "trace.json"), "utf8"));
  const log = fs.readFileSync(path.join(dir, "mednafen.log"), "utf8");
  if (log.indexOf("Using module: pce_fast") < 0) {
    console.log(`${name}: mednafen.log does not say 'Using module: pce_fast'`);
    return false;
  }
  if (log.indexOf("CPU overclock") >= 0) {
    console.log(`${name}: the run used a CPU overclock (pce_fast.ocmultiplier ` +
                `must be 1 — the model assumes 1x)`);
    return false;
  }

  /* provenance: the dump's trace must be what genpsg.py produces today */
  const fresh = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "tools", "gen", `${name}.trace.json`), "utf8"));
  if (!deepEqual(trace, fresh)) {
    console.log(`${name}: dump's trace.json differs from tools/gen/'s — ` +
                `re-run tools/capture-psg.sh (or genpsg.py changed since)`);
    return false;
  }

  /* the recorded frame count, from the WAV length alone */
  const L = wav.frames;
  const n = solveFrames(trace, L);
  if (n < 0) {
    console.log(`${name}: no whole-frame count matches ${L} sample frames ` +
                `(search window ${Math.floor(L / 700) + 20})`);
    return false;
  }

  const got = psg.render(trace.events, trace.frames, n);
  if (got.pcm.length !== wav.samples.length) {
    console.log(`${name}: SIZE MISMATCH model ${got.pcm.length} vs wav ` +
                `${wav.samples.length} samples`);
    return false;
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
    console.log(`${name}: ${first}st sample differs (frame ${n}, ` +
                `${L} recorded frames)${ctx}`);
    return false;
  }
  console.log(`${name}: OK (${n} frames, ${wav.samples.length} samples, ` +
              `diff 0)`);
  diagnose(name, wav.samples, trace);
  return true;
}

function main() {
  /* the dumps carry the trace they were recorded with; the generator must
   * still produce byte-identical ones (checked per dump above) */
  cp.execFileSync("python3", ["-I",
    path.join(__dirname, "..", "tools", "genpsg.py")], { stdio: "inherit" });
  const dumps = path.join(__dirname, "dumps");
  if (!fs.existsSync(dumps)) {
    console.error(`no dumps in ${dumps} — run tools/capture-psg.sh first`);
    return 2;
  }
  const dirs = fs.readdirSync(dumps).filter((d) =>
    /^psg/.test(d) && fs.existsSync(path.join(dumps, d, "mednafen.wav")))
    .sort().map((d) => path.join(dumps, d));
  if (dirs.length === 0) {
    console.error("no psg dumps with mednafen.wav found");
    return 2;
  }
  let failed = 0;
  for (const dir of dirs) {
    if (!checkDump(dir)) failed++;
  }
  if (failed === 0) {
    console.log(`PASS: the PSG model matches Mednafen sample for sample on ` +
                `${dirs.length} recording(s)`);
  } else {
    console.log(`FAIL: ${failed} recording(s) differ`);
  }
  return failed === 0 ? 0 : 1;
}

process.exitCode = main();
