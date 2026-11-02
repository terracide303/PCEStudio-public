#!/usr/bin/env node
/*
 * tools/rom-sound-pitch.js — what a recorded toy ROM actually sounds like,
 * one slot at a time (card #216; design: docs/ROM-SOUND.md §11).
 *
 *   # a Mednafen -soundrecord WAV (PCM16 LE stereo, 44,100 Hz)
 *   node tools/rom-sound-pitch.js WAV [--period-ms 200.6] [--slots 12]
 *                                    [--onset-ms 336]
 *
 *   # the studio's own pce-psg render of the same toy, for the same frames
 *   node tools/rom-sound-pitch.js --studio TOY.lua --frames 48
 *                                    [--period-ms 200.6] [--slots 4]
 *
 * The toy is a repeating pattern, so the recording is measured in slots of
 * one toy frame-cycle each: the first sound's onset is found (RMS over 5 ms
 * blocks, 10% of the loudest block), then every slot's fundamental is the
 * peak of a Hann-windowed DFT over 50..1500 Hz, measured in the middle of
 * the slot so a neighbour's release tail does not decide it.  One line per
 * slot: the slot's start in ms, its fundamental in Hz and its RMS.
 *
 * --window-ms START:END measures one window instead, in ms from the onset —
 * for a pattern that is not a slot per cycle (tools/toys/sfx.lua sounds for
 * 20 of its 60 frames).
 *
 * --studio runs the toy in the browser host (renderer/pce-il.js) and renders
 * renderer/pce-psg.js through rt.renderSound() — the studio's own output for
 * those frames, the model tests/check-psg.js proves sample-exact against
 * Mednafen.  It prints the same table for the render.  On the tree as it
 * stands an sfx-only toy renders SILENT (docs/ROM-SOUND.md §11: nothing
 * writes the PSG's main amplitude R1; card #113), which is itself a result.
 *
 * This is an instrument, not a test: it prints measurements and exits 0.
 * Silence prints as peak 0 with no slots.
 */
"use strict";

const fs = require("fs");
const path = require("path");

function die(msg) {
  console.error("rom-sound-pitch: " + msg);
  process.exit(2);
}

/* ---- PCM: a WAV (PCM16 LE) or the renderer's Int16Array ---- */
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
  const channels = fmt.readUInt16LE(2);
  const rate = fmt.readUInt32LE(4);
  const bits = fmt.readUInt16LE(14);
  if (fmt.readUInt16LE(0) !== 1 || bits !== 16)
    throw new Error("only PCM16 is supported");
  const n = Math.floor(data.length / 2 / channels);
  const m = new Float64Array(n);           /* the L/R mix, one number a frame */
  for (let i = 0; i < n; i++) {
    let a = 0;
    for (let c = 0; c < channels; c++) a += data.readInt16LE((i * channels + c) * 2);
    m[i] = a / channels;
  }
  return { rate, m, channels, seconds: n / rate };
}

function rms(m, a, b) {
  let s = 0;
  for (let i = a; i < b; i++) s += m[i] * m[i];
  return Math.sqrt(s / Math.max(1, b - a));
}

/* Hann-windowed DFT magnitude at one frequency (the recording is short, so
 * this is cheaper and less biased than an FFT bin grid). */
function mag(m, a, b, hz, rate) {
  const N = b - a;
  const w = 2 * Math.PI * hz / rate;
  let re = 0, im = 0;
  for (let i = 0; i < N; i++) {
    const h = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
    const v = m[a + i] * h;
    re += v * Math.cos(w * i);
    im -= v * Math.sin(w * i);
  }
  return Math.sqrt(re * re + im * im) / N;
}

function peakHz(m, a, b, rate) {
  let best = 0, hz = 0;
  for (let f = 50; f <= 1500; f++) {
    const v = mag(m, a, b, f, rate);
    if (v > best) { best = v; hz = f; }
  }
  return hz;
}

/* The first 5 ms block over 10% of the loudest one. */
function onset(m, rate) {
  const block = Math.max(1, Math.round(rate * 0.005));
  const nb = Math.floor(m.length / block);
  let peak = 0;
  const r = [];
  for (let i = 0; i < nb; i++) {
    const v = rms(m, i * block, (i + 1) * block);
    r.push(v);
    if (v > peak) peak = v;
  }
  for (let i = 0; i < nb; i++) if (r[i] > peak * 0.10) return i * block;
  return -1;
}

function slots(m, rate, onsetAt, periodMs, count) {
  const out = [];
  const period = periodMs * rate / 1000;
  for (let k = 0; k < count; k++) {
    const A = Math.round(onsetAt + period * (k + 0.30));
    const B = Math.round(onsetAt + period * (k + 0.70));
    if (B > m.length) break;
    out.push({ slot: k, ms: Math.round((A / rate) * 1000),
               hz: peakHz(m, A, B, rate),
               rms: +rms(m, A, B).toFixed(1) });
  }
  return out;
}

function report(label, pcm) {
  const at = onset(pcm.m, pcm.rate);
  console.log(label + ": " + pcm.seconds.toFixed(3) + " s, " +
              pcm.rate + " Hz, peak " + peakOf(pcm.m).toFixed(1));
  if (at < 0) { console.log("  silent (no block over 10% of the peak)"); return null; }
  return at;
}

function peakOf(m) {
  let p = 0;
  for (let i = 0; i < m.length; i++) p = Math.max(p, Math.abs(m[i]));
  return p;
}

/* ---- the studio side: the toy in the browser host, rendered to PCM ---- */
function studio(toyPath, frames) {
  const root = path.join(__dirname, "..");
  const il = require(path.join(root, "renderer", "pce-il.js"));
  const source = fs.readFileSync(toyPath, "utf8");
  const rt = il.create(source, { chunkName: path.basename(toyPath) });
  let loadError = null;
  try { rt.load(); } catch (e) { loadError = e; }
  if (loadError) die("the studio host refused " + toyPath + ": " +
                     (loadError.code || "") + " " + loadError.message);
  for (let f = 0; f < frames; f++) rt.frame(f);
  const got = rt.renderSound(frames);
  const n = got.pcm.length / 2;
  const m = new Float64Array(n);
  for (let i = 0; i < n; i++)
    m[i] = (got.pcm[i * 2] + got.pcm[i * 2 + 1]) / 2;
  console.log("studio: " + toyPath + ", " + frames + " frames, " +
              rt.sound.events.length + " PSG writes");
  return { rate: got.sampleRate, m, seconds: n / got.sampleRate };
}

/* ---- the command line ---- */
const args = process.argv.slice(2);
let file = null, toy = null, frames = 48, periodMs = 200.6, count = 0,
    onsetMs = null, windowMs = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--studio") toy = args[++i];
  else if (a === "--frames") frames = Number(args[++i]);
  else if (a === "--period-ms") periodMs = Number(args[++i]);
  else if (a === "--slots") count = Number(args[++i]);
  else if (a === "--onset-ms") onsetMs = Number(args[++i]);
  else if (a === "--window-ms") {
    const m = /^(\d+):(\d+)$/.exec(args[++i] || "");
    if (!m) die("--window-ms takes START:END in ms");
    windowMs = [Number(m[1]), Number(m[2])];
  }
  else if (a[0] === "-") die("unknown option " + a);
  else file = a;
}
if (!file && !toy) die("usage: rom-sound-pitch.js WAV | --studio TOY.lua --frames N");

let pcm;
if (toy) {
  pcm = studio(toy, frames);
} else {
  pcm = parseWav(fs.readFileSync(file));
  console.log("wav: " + file + ", " + pcm.channels + " channel(s)");
}
const at = report(toy ? "render" : "recording", pcm);
if (at === null) process.exit(0);
let start = onsetMs === null ? at : Math.round(onsetMs * pcm.rate / 1000);
if (windowMs) {
  const A = Math.round(start + windowMs[0] * pcm.rate / 1000);
  const B = Math.round(start + windowMs[1] * pcm.rate / 1000);
  console.log("window " + windowMs[0] + "-" + windowMs[1] + " ms after the " +
              "onset: " + peakHz(pcm.m, A, B, pcm.rate) + " Hz" +
              " (rms " + rms(pcm.m, A, B).toFixed(1) + ")");
  process.exit(0);
}
const n = count || Math.max(1, Math.round(pcm.seconds * 1000 / periodMs));
const got = slots(pcm.m, pcm.rate, start, periodMs, n);
console.log("slots of " + periodMs + " ms from " + (start / pcm.rate * 1000).toFixed(1) + " ms:");
for (const s of got)
  console.log("  slot " + String(s.slot).padStart(2) + "  " +
              String(s.ms).padStart(5) + " ms  " + String(s.hz).padStart(4) +
              " Hz  rms " + s.rms);
