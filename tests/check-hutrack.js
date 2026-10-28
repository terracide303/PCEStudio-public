#!/usr/bin/env node
/*
 * tests/check-hutrack.js — #35 step (1): HuTrack's engine + converter play
 * our own DMF in a ROM that Mednafen records.
 *
 * NOTE: written by @design as part of #35 because the card's close condition
 * needs a check; per the workshop role split it is flagged for @review to
 * read cold.  It is not a test of HuTrack itself — it measures the recording
 * and the committed fixtures.
 *
 * What it proves, and how:
 *   0. The vendored copy.  Every file under vendor/hutrack must match
 *      MANIFEST.sha256 (the pinned upstream commit's bytes), and nothing
 *      unlisted may be added.
 *   1. Fixture provenance.  tests/dumps/hutrack1/song.json records the DMF
 *      and every converter include file with its sha256; the files on disk
 *      must match.  Running tools/genhutrack.py --song-only (stdlib only)
 *      must reproduce the same DMF byte for byte.
 *   2. ROM provenance (when a PCEAS 4.x is available — PCEAS4 env or
 *      `pceas4` on PATH).  The committed song + tools/hutrack.asm are
 *      rebuilt and the ROM's sha256 must equal run.json's.  Without PCEAS 4
 *      the rebuild is reported as skipped, not passed.
 *   3. What the recording is.  The WAV must be the 44100 Hz PCM16 stereo
 *      output run.json describes (hash, frame count, duration), non-silent
 *      and balanced; a per-100 ms narrowband classifier must recover the
 *      melody (C4 E4 G4 C5 B4 G4 E4 C4) and the bass (C3 G3 C3 G3) that
 *      tests/dumps/hutrack1/song.json says the DMF contains, with a note
 *      every 0.8 s (six VBlanks per row at 60 Hz).  The classifier picks the
 *      loudest of the expected note frequencies in each block and ignores
 *      blocks where nothing is dominant; it does not assume note onsets.
 *
 * Honest limits: the witness is Mednafen's pce_fast PSG, not hardware; the
 * checker was written by the seat that wrote the fixture (rule 2 — @review
 * owes it a cold break); pitch is established by narrowband power, not by a
 * sample-exact model (that comparison is #35's next step, the JS DMF player
 * against this same recording).
 */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

const ROOT = path.join(__dirname, "..");
const DUMP = path.join(__dirname, "dumps", "hutrack1");
const SONG = path.join(DUMP, "song.json");
const RUN = path.join(DUMP, "run.json");
const WAV = path.join(DUMP, "mednafen.wav");
const DMF = path.join(DUMP, "demo.dmf");
const SONG_DIR = path.join(DUMP, "song");
const TOOLS = path.join(ROOT, "tools");

const FREQ = {
  C3: 130.81, G3: 196.00,
  C4: 261.63, E4: 329.63, G4: 392.00, B4: 493.88, C5: 523.25,
};
const BLOCK = 0.1;       // classifier window, seconds
const NOTE_SECONDS = 0.8; // 8 rows x 6 VBlanks at 60 Hz

let failures = 0;
function fail(msg) {
  failures++;
  console.log(`FAIL: ${msg}`);
}

/* ---- hashing and file helpers ---- */
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${path.relative(ROOT, file)}: ${e.message}`);
  }
}

/* ---- minimal WAV reader: PCM16 LE stereo 44100 ---- */
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
    if (id === "fmt ") fmt = buf.slice(pos + 8, pos + 8 + len);
    else if (id === "data") data = buf.slice(pos + 8, pos + 8 + len);
    pos += 8 + len + (len & 1);
  }
  if (!fmt || !data) throw new Error("fmt/data chunks missing");
  const format = fmt.readUInt16LE(0);
  const channels = fmt.readUInt16LE(2);
  const rate = fmt.readUInt32LE(4);
  const bits = fmt.readUInt16LE(14);
  if (format !== 1 || channels !== 2 || rate !== 44100 || bits !== 16)
    throw new Error(`unsupported WAV ${format}/${channels}ch/${rate}/${bits}`);
  const samples = new Float64Array(data.length / 2);
  for (let i = 0; i < samples.length; i++)
    samples[i] = data.readInt16LE(i * 2);
  return { channels, rate, bits, dataBytes: data.length,
           frames: data.length / 4, samples };
}

/* Average of the two channels, indexed by sample frame. */
function mono(wav) {
  const n = wav.frames;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++)
    out[i] = (wav.samples[2 * i] + wav.samples[2 * i + 1]) / 2;
  return out;
}

/* Narrowband amplitude at f over [start, start+len) seconds (naive DFT, O(N)
 * per frequency; enough for a handful of note windows). */
function tone(m, rate, start, len, f) {
  const a = Math.max(0, Math.floor(start * rate));
  const b = Math.min(m.length, Math.floor((start + len) * rate));
  let re = 0, im = 0;
  const w = -2 * Math.PI * f / rate;
  for (let i = a; i < b; i++) {
    const ph = w * i;
    re += m[i] * Math.cos(ph);
    im += m[i] * Math.sin(ph);
  }
  return Math.hypot(re, im) / Math.max(1, b - a);
}

function rms(values) {
  let s = 0;
  for (const v of values) s += v * v;
  return Math.sqrt(s / values.length);
}

/* Classify each BLOCK-second slice against the note names given: the loudest
 * wins when it is at least `margin` times the runner-up, else the block is
 * ambiguous and skipped.  Returns the collapsed sequence with onset times. */
function classify(m, rate, notes, untilSec, margin) {
  const out = [];
  let last = null;
  for (let t = 0; t + BLOCK <= untilSec; t += BLOCK) {
    const powers = notes.map((n) => [n, tone(m, rate, t, BLOCK, FREQ[n])]);
    powers.sort((x, y) => y[1] - x[1]);
    const [name, p] = powers[0];
    const second = powers[1][1];
    if (p < 50 || p < margin * second) continue;
    if (name !== last) {
      out.push({ note: name, onset: t });
      last = name;
    }
  }
  return out;
}

/* ---- 0. the vendored engine/converter is unmodified ---- */
/* Python writes __pycache__ the first time the converter's modules are
 * imported, and a .pyc records the interpreter's magic and the source's
 * mtime, so it is generated output, not an upstream byte.  #83: the cache is
 * neither hashed nor counted as "unlisted" — the .py files it was built from
 * are in the manifest and are what the check holds.  Anything else under
 * vendor/hutrack must be listed. */
const GENERATED = /(^|\/)__pycache__(\/|$)|\.pyc$/;
function walk(dir, base, out) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const rel = path.relative(base, p).split(path.sep).join("/");
    if (GENERATED.test(rel)) continue;
    if (fs.statSync(p).isDirectory()) walk(p, base, out);
    else out.push(rel);
  }
}

function checkVendor() {
  const vendor = path.join(ROOT, "vendor", "hutrack");
  const manifest = path.join(vendor, "MANIFEST.sha256");
  if (!fs.existsSync(manifest)) { fail("vendor/hutrack/MANIFEST.sha256 missing"); return; }
  const listed = new Set();
  let bad = 0;
  for (const line of fs.readFileSync(manifest, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const m = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (!m) { fail(`malformed manifest line: ${line}`); continue; }
    const [, hash, rel] = m;
    listed.add(rel);
    const p = path.join(vendor, rel);
    if (!fs.existsSync(p)) { fail(`vendored file missing: ${rel}`); bad++; continue; }
    if (sha256(fs.readFileSync(p)) !== hash) {
      fail(`vendored file modified: ${rel}`);
      bad++;
    }
  }
  const all = [];
  walk(vendor, vendor, all);
  const ours = new Set(["MANIFEST.sha256", "VENDORED.md"]);
  for (const rel of all) {
    if (!ours.has(rel) && !listed.has(rel)) {
      fail(`unlisted file in vendor/hutrack: ${rel}`);
      bad++;
    }
  }
  if (bad === 0) console.log(`vendor: ${listed.size} HuTrack files match MANIFEST.sha256`);
}

/* ---- 1. committed fixture hashes ---- */
function checkFixtures(song) {
  const dmf = fs.readFileSync(DMF);
  if (dmf.length !== song.dmf.file_bytes)
    fail(`demo.dmf is ${dmf.length} B, song.json says ${song.dmf.file_bytes}`);
  if (sha256(dmf) !== song.dmf.file_sha256)
    fail("demo.dmf sha256 differs from song.json");

  const onDisk = fs.readdirSync(SONG_DIR).filter((n) => n.endsWith(".inc")).sort();
  const recorded = Object.keys(song.includes || {}).sort();
  if (onDisk.join(",") !== recorded.join(","))
    fail(`converter include set differs: disk ${onDisk.join(",")}; ` +
         `song.json ${recorded.join(",")}`);
  for (const name of recorded) {
    const p = path.join(SONG_DIR, name);
    if (!fs.existsSync(p)) { fail(`missing converter include ${name}`); continue; }
    const buf = fs.readFileSync(p);
    const rec = song.includes[name];
    if (buf.length !== rec.bytes)
      fail(`${name}: ${buf.length} B, song.json says ${rec.bytes}`);
    if (sha256(buf) !== rec.sha256)
      fail(`${name}: sha256 differs from song.json`);
  }
}

/* ---- 2. the DMF is reproducible with the stdlib alone ---- */
function checkGenerator(song) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hutrack-dmf-"));
  try {
    const out = cp.spawnSync("python3",
      ["-I", path.join(TOOLS, "genhutrack.py"), "--song-only", "--out", tmp],
      { encoding: "utf8" });
    if (out.status !== 0) {
      fail(`tools/genhutrack.py --song-only failed: ${out.stderr || out.stdout}`);
      return;
    }
    const made = fs.readFileSync(path.join(tmp, "demo.dmf"));
    if (sha256(made) !== song.dmf.file_sha256)
      fail("regenerated DMF differs from the committed fixture");
    const madeSong = JSON.parse(fs.readFileSync(path.join(tmp, "song.json"), "utf8"));
    for (const key of ["raw_bytes", "raw_sha256", "file_bytes", "file_sha256"])
      if (madeSong.dmf[key] !== song.dmf[key])
        fail(`regenerated song.json dmf.${key} differs`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/* ---- 3. the ROM rebuilds byte-identically (needs PCEAS 4.x) ---- */
function findPceas4() {
  if (process.env.PCEAS4 && fs.existsSync(process.env.PCEAS4))
    return process.env.PCEAS4;
  const which = cp.spawnSync("sh", ["-c", "command -v pceas4"],
                             { encoding: "utf8" });
  return which.status === 0 && which.stdout.trim() ? which.stdout.trim() : null;
}

function checkRom(run) {
  const pceas = findPceas4();
  const romPath = path.join(TOOLS, "gen", "hutrack", "hutrack-demo.pce");
  if (!pceas) {
    console.log("SKIP: ROM rebuild (no PCEAS 4.x: set PCEAS4 or put pceas4 " +
                "on PATH; the repo's PCEAS 3.23 cannot assemble HuTrack)");
    return;
  }
  const res = cp.spawnSync("bash",
    [path.join(TOOLS, "build-hutrack.sh")],
    { encoding: "utf8", env: { ...process.env, PCEAS4: pceas } });
  if (res.status !== 0) {
    fail(`ROM rebuild failed:\n${res.stdout}\n${res.stderr}`);
    return;
  }
  const rom = fs.readFileSync(romPath);
  if (rom.length !== run.rom.bytes)
    fail(`rebuilt ROM is ${rom.length} B, run.json says ${run.rom.bytes}`);
  if (sha256(rom) !== run.rom.sha256)
    fail(`rebuilt ROM sha256 ${sha256(rom).slice(0, 16)}... differs from ` +
         `run.json ${run.rom.sha256.slice(0, 16)}...`);
  else
    console.log(`ROM: rebuilt byte-identically (${rom.length} B, ` +
                `sha256 ${run.rom.sha256.slice(0, 16)}...)`);
}

/* ---- 4. what the recording actually contains ---- */
function checkRecording(song, run) {
  const buf = fs.readFileSync(WAV);
  const wav = parseWav(buf);
  const m = mono(wav);

  if (sha256(buf) !== run.wav.sha256)
    fail("mednafen.wav sha256 differs from run.json");
  if (wav.frames !== run.wav.frames)
    fail(`WAV has ${wav.frames} frames, run.json says ${run.wav.frames}`);
  const seconds = wav.frames / wav.rate;
  if (Math.abs(seconds - run.wav.seconds) > 0.01)
    fail(`WAV is ${seconds.toFixed(3)} s, run.json says ${run.wav.seconds}`);
  if (seconds < 6.5)
    fail(`recording is only ${seconds.toFixed(2)} s; needs the full 8-note ` +
         `phrase (6.4 s)`);

  /* non-silent and balanced */
  const left = [], right = [];
  for (let i = 0; i < wav.frames; i++) {
    left.push(wav.samples[2 * i]);
    right.push(wav.samples[2 * i + 1]);
  }
  const rl = rms(left), rr = rms(right);
  if (rl < 1000) fail(`left channel RMS ${rl.toFixed(1)} — recording is silent`);
  if (Math.abs(rl - rr) / Math.max(rl, rr) > 0.05)
    fail(`channels differ (RMS L ${rl.toFixed(1)}, R ${rr.toFixed(1)})`);

  /* Melody and bass sequences.  The margin is modest because a bass C3's
   * harmonics land on C4/C5: the melody is still the louder of the two, but
   * not by a factor of three (measured: C4 2783 vs the C3 harmonic 1281). */
  /* Exactly the eight-note phrase: at 6.4 s the four-order pattern loops and
   * the bass changes again, which would look like a fifth bass note. */
  const until = Math.min(seconds, 8 * NOTE_SECONDS);
  const melodyNotes = ["C4", "E4", "G4", "C5", "B4"];
  const gotMelody = classify(m, wav.rate, melodyNotes, until, 1.4)
    .map((x) => x.note);
  const gotBass = classify(m, wav.rate, ["C3", "G3"], until, 1.4)
    .map((x) => x.note);

  const wantMelody = song.melody;
  const wantBass = [];
  for (let i = 0; i < wantMelody.length; i += 2)
    wantBass.push(song.bass[(i / 2) % song.bass.length]);

  if (gotMelody.join(" ") !== wantMelody.join(" "))
    fail(`melody from audio [${gotMelody.join(" ")}], DMF says ` +
         `[${wantMelody.join(" ")}]`);
  if (gotBass.join(" ") !== wantBass.join(" "))
    fail(`bass from audio [${gotBass.join(" ")}], DMF says ` +
         `[${wantBass.join(" ")}]`);

  /* note onsets: one every 0.8 s, first within the first half-second */
  const onsets = classify(m, wav.rate, melodyNotes, until, 1.4)
    .map((x) => x.onset);
  if (onsets.length >= 2) {
    if (onsets[0] > 0.5)
      fail(`first note starts at ${onsets[0].toFixed(2)} s — expected the ` +
           `ROM to start the song immediately`);
    for (let i = 1; i < onsets.length; i++) {
      const gap = onsets[i] - onsets[i - 1];
      if (Math.abs(gap - NOTE_SECONDS) > 0.15)
        fail(`note ${i} follows note ${i - 1} after ${gap.toFixed(2)} s, ` +
             `expected ${NOTE_SECONDS} s (8 rows x 6 VBlanks at 60 Hz)`);
    }
  }

  console.log(`WAV: ${seconds.toFixed(3)} s, RMS L ${rl.toFixed(1)} ` +
              `R ${rr.toFixed(1)}`);
  console.log(`melody: ${gotMelody.join(" ")}`);
  console.log(`bass:   ${gotBass.join(" ")}`);
  console.log(`onsets: ${onsets.map((t) => t.toFixed(2)).join(" ")}`);
}

function main() {
  for (const file of [SONG, RUN, WAV, DMF, SONG_DIR]) {
    if (!fs.existsSync(file)) {
      console.error(`missing ${path.relative(ROOT, file)} — run ` +
                    `tools/genhutrack.py and tools/capture-hutrack.sh first`);
      return 2;
    }
  }
  const song = readJson(SONG);
  const run = readJson(RUN);
  checkVendor();
  checkFixtures(song);
  checkGenerator(song);
  checkRom(run);
  checkRecording(song, run);
  if (failures === 0) {
    console.log("PASS: the HuTrack ROM plays the DMF's melody and bass as " +
                "recorded by Mednafen");
    return 0;
  }
  console.log(`FAIL: ${failures} check(s) failed`);
  return 1;
}

process.exitCode = main();
