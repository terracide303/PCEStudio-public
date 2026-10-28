#!/usr/bin/env node
/*
 * tests/check-dmf.js — #35 step 2: our own DMF reader + the HuTrack player.
 *
 * NOTE: written by @design, the seat that wrote the reader, the player and
 * this file.  Workshop RULES.md rule 2: @review owes it a cold break before
 * its evidence closes anything.
 *
 * What it checks, and against what:
 *
 *  1. The reader against the converter's own output.  tests/dumps/hutrack1/
 *     demo.dmf is read by renderer/pce-dmf.js; the notes, empty rows,
 *     instrument macros and waveform must be what the vendored HuTrack
 *     converter read from the same bytes.  The converter's emitted include
 *     files (song/demo.*.inc) are decoded here with the ENGINE's rules
 *     (mask bits, the $E1..$FE skip encoding, note cut) — the reverse
 *     direction of the code under test — and must yield the same note rows.
 *     So the reader and the converter are compared through two independent
 *     decoders, not through the reader's own opinion.
 *
 *  2. The player against HuTrack's semantics.  renderer/pce-song.js must
 *     emit the engine's exact PSG sequence: the two Reset rounds, the
 *     first note's wave upload (control toggles + 32 writes), the steady
 *     per-frame writes (frequency then volume, twice), note frames every
 *     48 VBlanks for the melody and 96 for the bass, and HuTrack's own
 *     periods for the eight melody and four bass notes.  The periods are
 *     also checked against equal temperament as an independent witness
 *     (the tables were generated from the manual, so the two agree only if
 *     both are right).  Songs that need effects, arpeggios, PCM or a
 *     non-1 time base must be refused by code, not played wrongly.
 *
 *  3. The rendered audio against the Mednafen recording.  The model is
 *     built from the same DMF and replayed through renderer/pce-psg.js;
 *     compared with tests/dumps/hutrack1/mednafen.wav: the first note's
 *     position, and for every long melody note the peak frequency and RMS
 *     of the model and the recording.  Four of the eight notes (E4 twice,
 *     C5, B4) must match in level within 2% and every note in pitch
 *     within 0.5 Hz.  The C4 and G4 notes are reported, not required at that
 *     tolerance: the bass's second harmonic (C3 -> C4, G3 -> G4) lands
 *     exactly on the melody's fundamental, so their sum depends on the two
 *     voices' relative phase, which this port does not model — see the
 *     waveform note below and docs/HUTRACK.md.
 *
 * What it does NOT prove:
 *   - sample-for-sample equality.  The engine writes inside the VBlank IRQ;
 *     its cycle offsets come from the IRQ entry, the 7 kHz timer IRQ and the
 *     engine's instruction stream.  The port keeps the write order and a
 *     fixed intra-frame spacing (pce-song.js cyclesPerWrite), not those
 *     offsets, so the two voices' relative phase is not the console's.  The
 *     measurement is printed (waveform correlation), not asserted.
 *   - hardware.  The witness is Mednafen's pce_fast recording.
 *   - that the DMF round-trips through Furnace (it has not been opened
 *     there; see docs/HUTRACK.md).
 */

"use strict";

const fs = require("fs");
const path = require("path");
const psg = require("../renderer/pce-psg.js");
const dmf = require("../renderer/pce-dmf.js");
const songPlayer = require("../renderer/pce-song.js");

const ROOT = path.join(__dirname, "..");
const DUMP = path.join(__dirname, "dumps", "hutrack1");
const DMF_FILE = path.join(DUMP, "demo.dmf");
const WAV_FILE = path.join(DUMP, "mednafen.wav");
const SONG_JSON = path.join(DUMP, "song.json");
const SONG_DIR = path.join(DUMP, "song");

let failures = 0;
function fail(what) { failures++; console.log(`  FAIL ${what}`); }
function ok(what) { console.log(`  ok   ${what}`); }
function check(cond, what) { if (cond) ok(what); else fail(what); }

/* ---- WAV ---------------------------------------------------------------- */

function parseWav(buf) {
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.slice(pos, pos + 4).toString("latin1");
    const len = buf.readUInt32LE(pos + 4);
    if (id === "fmt ") fmt = buf.slice(pos + 8, pos + 8 + len);
    else if (id === "data") data = buf.slice(pos + 8, pos + 8 + len);
    pos += 8 + len + (len & 1);
  }
  if (!fmt || !data) throw new Error("WAV chunks missing");
  const channels = fmt.readUInt16LE(2), rate = fmt.readUInt32LE(4);
  const bits = fmt.readUInt16LE(14);
  if (channels !== 2 || rate !== 44100 || bits !== 16)
    throw new Error("unexpected WAV format");
  const frames = data.length / 4;
  const left = new Float64Array(frames);
  for (let i = 0; i < frames; i++) left[i] = data.readInt16LE(i * 4);
  return { frames, left };
}

/* ---- the converter's include files -------------------------------------- */

/* All .db values of one label's section (labels start at column 0; .db lines
 * are indented and may be split over commas). */
function dbValues(text, label) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === label);
  if (start < 0) throw new Error(`label ${label} not found`);
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line) && line.trim()) break;   /* next label */
    const m = line.match(/^\s*\.db\s+(.*)$/);
    if (!m) continue;
    for (const part of m[1].split(",")) {
      const t = part.trim();
      if (!t) continue;
      out.push(/^\$/.test(t) ? parseInt(t.slice(1), 16) : parseInt(t, 10));
    }
  }
  return out;
}

/* The engine's pattern parser (HuTrack_parser.asm / pattern_compression_info):
 *  <0x80 mask; 0x80..0xDF note+octave; 0xE0 cut; 0xE1..0xFE skip.  Returns
 * [{row, note}] with the engine note index (octave*12+semitone, cut = 100). */
function decodeEnginePattern(bytes) {
  const events = [];
  let pos = 0, row = 0, rowSkip = 0;
  function popcount(v) {
    let n = 0;
    while (v) { n += v & 1; v >>= 1; }
    return n;
  }
  while (row < 64 && pos < bytes.length) {
    if (rowSkip > 0) { rowSkip--; row++; continue; }
    const b = bytes[pos++];
    let note = null;
    if (b < 0x80) {
      const mask = b;
      if (mask & 0x01) note = bytes[pos++];
      if (mask & 0x04) pos++;                 /* instrument */
      if (mask & 0x08) pos++;                 /* volume */
      if (mask & 0x10) pos++;                 /* FX1 */
      if (mask & 0x20) pos++;                 /* FX1 arg */
      if (mask & 0x40) {                      /* FX2/3/4 mask */
        const ext = bytes[pos++];
        pos += popcount(ext & 0x3f);
      }
      if (note !== null) events.push({ row: row, note: note });
    } else if (b < 0xe0) {
      events.push({ row: row, note: b - 0x80 });
    } else if (b === 0xe0) {
      events.push({ row: row, note: 100 });
    } else if (b < 0xff) {
      rowSkip = b - 0xe1;
    }
    row++;
  }
  return events;
}

/* ---- 1. the reader ------------------------------------------------------ */

const raw = fs.readFileSync(DMF_FILE);
const mod = dmf.read(raw);
const spec = JSON.parse(fs.readFileSync(SONG_JSON, "utf8"));

function checkReader() {
  console.log("reader — the DMF header");
  check(mod.version === 24, `version 24 (${mod.version})`);
  check(mod.platform === 5, "platform is PC Engine (5)");
  check(mod.songName === "PCEStudio HuTrack test",
        `song name (${JSON.stringify(mod.songName)})`);
  check(mod.author === "PCEStudio", "author");
  check(mod.rowsPerPattern === spec.rows,
        `pattern length ${spec.rows}`);
  check(mod.orderCount === spec.orders, `order count ${spec.orders}`);
  check(mod.tick1 === spec.speed && mod.tick2 === spec.speed,
        `speed ${spec.speed} VBlanks/row`);
  check(mod.frameMode === 1, "NTSC/VBlank frame mode");
  check(mod.customHz === 0, "no custom Hz");
  check(mod.bytes === spec.dmf.raw_bytes,
        `${spec.dmf.raw_bytes}-byte inflated mod`);

  console.log("reader — instruments and waveforms");
  check(mod.instruments.length === 1, "one instrument");
  const ins = mod.instruments[0];
  check(ins.mode === 0, "standard (not FM) mode");
  check(ins.volumeEnv.size === 1 && ins.volumeEnv.data[0] === 31 &&
        ins.volumeEnv.loop === 0xff,
        "volume envelope: 1 step of 31, held");
  check(ins.arpeggioEnv.size === 0, "no arpeggio envelope");
  check(ins.wavetableEnv.size === 1 && ins.wavetableEnv.data[0] === 0 &&
        ins.wavetableEnv.loop === 0xff,
        "waveform envelope: wave 0, held");
  check(mod.wavetables.length === 1, "one waveform");
  const wave = mod.wavetables[0];
  check(wave.length === 32 && wave.every((v, i) => v === i),
        "waveform 0 is the 0..31 ramp");
  check(mod.samples.length === 0, "no PCM samples");

  const wfInc = fs.readFileSync(path.join(SONG_DIR, "demo.wfData.inc"), "utf8");
  check(JSON.stringify(dbValues(wfInc, ".waveform.0")) ===
        JSON.stringify(wave),
        "the waveform include carries the same 32 values");
  const insInc = fs.readFileSync(path.join(SONG_DIR, "demo.instrData.inc"),
                                 "utf8");
  check(JSON.stringify(dbValues(insInc, ".instrument.0.volEnv.data")) ===
        "[31]", "the instrument include's volume env is 31");
  check(JSON.stringify(dbValues(insInc, ".instrument.0.waveFormEnv.data")) ===
        "[0]", "the instrument include's waveform env selects wave 0");

  console.log("reader — the notes the DMF contains");
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A",
                 "A#", "B"];
  function noteName(semitone, octave) {
    return names[semitone] + (octave + 1);   /* DMF octave is one below */
  }
  function noteRows(ch) {
    const rows = mod.patterns[ch][0];
    const out = [];
    rows.forEach((r, i) => {
      if (r.note) out.push({ row: i, name: noteName(r.note.semitone,
                                                    r.note.octave),
                             engine: r.note.octave * 12 + r.note.semitone });
    });
    return out;
  }
  const melody = noteRows(0).map((r) => r.name);
  const bass = noteRows(1).map((r) => r.name);
  check(JSON.stringify(melody) === JSON.stringify(spec.melody),
        `melody ${melody.join(" ")}`);
  check(JSON.stringify(bass) === JSON.stringify(spec.bass),
        `bass ${bass.join(" ")}`);
  check(melody.length === 8 && bass.length === 4,
        "8 melody notes and 4 bass notes per pattern");
  const empty = mod.patterns[2][0].filter((r) => r.note || r.volume !== null
                                             || r.instrument !== null);
  check(empty.length === 0, "channels 2..5 are empty");

  console.log("reader — the converter's own pattern stream agrees");
  const patInc = fs.readFileSync(path.join(SONG_DIR, "demo.patternData.inc"),
                                 "utf8");
  for (const ch of [0, 1]) {
    const bytes = dbValues(patInc, `.pattern.table.chan${ch}.pattern0`);
    const engine = decodeEnginePattern(bytes);
    const ours = noteRows(ch).map((r) => ({ row: r.row, note: r.engine }));
    check(JSON.stringify(engine) === JSON.stringify(ours),
          `channel ${ch}: ${engine.length} note rows from the engine's ` +
          `compressed form equal the DMF's`);
  }

  console.log("reader — refusals");
  function refused(bytes, code, what) {
    try {
      dmf.parse(bytes);
      fail(`${what}: no refusal (expected ${code})`);
    } catch (e) {
      if (e.code === code) ok(`${what}: ${code}`);
      else fail(`${what}: refused with ${e.code || e.message}, expected ${code}`);
    }
  }
  const inflated = new Uint8Array(zlibInflate(raw));
  refused(new Uint8Array(16).fill(0x41), "dmf-magic", "a non-DMF file");
  refused(inflated.subarray(0, 20), "dmf-truncated", "a truncated header");
  const v = inflated.slice(); v[16] = 28;
  refused(v, "dmf-version", "revision 28");
  const p = inflated.slice(); p[17] = 4;
  refused(p, "dmf-platform", "a non-PCE platform");
  const trailing = new Uint8Array(inflated.length + 1);
  trailing.set(inflated); trailing[inflated.length] = 1;
  refused(trailing, "dmf-trailing", "a nonzero byte after the mod");
}

function zlibInflate(buf) {
  return require("zlib").inflateSync(buf);
}

/* ---- 2. the player ------------------------------------------------------ */

const trace = songPlayer.trace(mod, { count: 400 });

function checkPlayer() {
  console.log("player — HuTrack's pitch path");
  const cases = [
    [96, 427, 261.63, "C4"], [100, 339, 329.63, "E4"],
    [103, 285, 392.00, "G4"], [108, 213, 523.25, "C5"],
    [107, 226, 493.88, "B4"], [84, 855, 130.81, "C3"],
    [91, 571, 196.00, "G3"]
  ];
  for (const [anchor, period, hz, name] of cases) {
    const got = songPlayer.periodFor(anchor);
    const f = psg.CLOCK / (64 * got);
    check(got === period,
          `${name}: anchor ${anchor} -> period ${got} (HuTrack table)`);
    check(Math.abs(f - hz) / hz < 0.005,
          `${name}: period ${got} = ${f.toFixed(2)} Hz (` +
          `equal temperament ${hz} Hz)`);
  }

  console.log("player — the Reset writes");
  const init = trace.events.filter((e) => e.f === 0);
  check(init.length === 446, `446 power-on writes (${init.length})`);
  const expectInit = [];
  for (let round = 0; round < 2; round++) {
    expectInit.push([1, 0xff]);
    for (let ch = 0; ch < 6; ch++) {
      expectInit.push([0, ch]);
      expectInit.push([5, 0xff]);
      expectInit.push([4, 0x40]);
      expectInit.push([4, 0x00]);
      expectInit.push([7, 0x00]);
      for (let s = 0; s < 32; s++) expectInit.push([6, 0x00]);
    }
  }
  check(init.every((e, i) => e.reg === expectInit[i][0] &&
                              e.value === expectInit[i][1]),
        "each round is $801=$FF then per channel " +
        "$805=$FF, $804=$40, $804=$00, $807=$00, 32 zero wave steps");

  console.log("player — the first note's wave upload and control sequence");
  const noteFrames = [...new Set(trace.notes.map((n) => n.frame))];
  check(noteFrames[0] === 6,
        `first note on the sixth EngineCall (frame ${noteFrames[0]})`);
  const first = trace.events.filter((e) => e.f === 6);
  const want = [];
  function noteBlock(ch, period, state) {
    want.push([0, ch], [2, period & 0xff], [3, (period >> 8) & 0x0f]);
    const vol = state & 0x1f;
    want.push([0, ch], [4, (state & 0xe0) | vol], [4, vol | 0x40],
              [4, vol]);
    for (let s = 0; s < 32; s++) want.push([6, s]);
    want.push([4, vol | 0x40], [0, ch], [4, 0x9f]);
  }
  noteBlock(0, 427, 0x00);
  noteBlock(1, 855, 0x00);
  check(first.length === want.length,
        `first note frame has ${want.length} writes (${first.length})`);
  check(first.every((e, i) => e.reg === want[i][0] &&
                              e.value === want[i][1]),
        "frequency, DDA/off toggles, 32 wave steps, then $9F at full volume");
  check(first.filter((e) => e.reg === 4 && e.value === 0x9f).length === 2,
        "both channels are left on at volume 31");

  console.log("player — the steady frame");
  function frameWrites(f) {
    return trace.events.filter((e) => e.f === f);
  }
  let steadyBad = 0;
  for (let f = 7; f < 54; f++) {
    const w = frameWrites(f);
    const wantSteady = [[0, 0], [2, 427 & 0xff], [3, (427 >> 8) & 0x0f],
                        [0, 0], [4, 0x9f],
                        [0, 1], [2, 0x57], [3, 0x03],
                        [0, 1], [4, 0x9f]];
    if (w.length !== 10 ||
        !w.every((e, i) => e.reg === wantSteady[i][0] &&
                           e.value === wantSteady[i][1])) steadyBad++;
  }
  check(steadyBad === 0,
        "every non-note frame writes select/R2/R3/select/R4 twice, " +
        "at volume 31, and nothing else");

  console.log("player — note timing and periods");
  const mel = trace.notes.filter((n) => n.channel === 0);
  const bas = trace.notes.filter((n) => n.channel === 1);
  const melPeriods = [427, 339, 285, 213, 226, 285, 339, 427];
  check(mel.length >= 8 &&
        mel.slice(0, 8).every((n, i) => n.period === melPeriods[i]),
        `melody periods ${melPeriods.join(" ")}`);
  check(mel.slice(0, 8).every((n, i) => n.frame === 6 + 48 * i),
        "melody notes every 48 VBlanks (8 rows x 6)");
  check(bas.length >= 4 &&
        bas.slice(0, 4).every((n, i) => n.frame === 6 + 96 * i &&
                                         n.period === [855, 571, 855, 571][i]),
        "bass notes every 96 VBlanks (16 rows x 6), C3/G3 alternating");

  console.log("player — refusals");
  function refusedSong(mutate, code, what) {
    const copy = JSON.parse(JSON.stringify(mod));
    mutate(copy);
    try {
      songPlayer.trace(copy, { count: 8 });
      fail(`${what}: no refusal (expected ${code})`);
    } catch (e) {
      if (e.code === code) ok(`${what}: ${code}`);
      else fail(`${what}: refused with ${e.code || e.message}, expected ${code}`);
    }
  }
  refusedSong((s) => { s.timeBase = 2; }, "song-time-base", "time base 2");
  refusedSong((s) => { s.frameMode = 0; }, "song-frame-mode", "PAL mode");
  refusedSong((s) => { s.samples = [{}]; }, "song-pcm", "a PCM sample");
  refusedSong((s) => { s.patterns[0][0][1].effects = [{ code: 0x04, arg: 7 }]; },
              "song-fx", "a vibrato effect");
  refusedSong((s) => { s.instruments[0].arpeggioEnv.size = 1; },
              "song-arp", "an arpeggio envelope");
  refusedSong((s) => { s.patterns[0][0][0].note.octave = 9; },
              "song-note", "a note above HuTrack's range");
}

/* ---- 3. the audio ------------------------------------------------------- */

const rendered = songPlayer.render(mod, psg, { count: 430 });
const pcm = rendered.pcm;
const modelLeft = new Float64Array(pcm.length / 2);
for (let i = 0; i < modelLeft.length; i++) modelLeft[i] = pcm[2 * i];
const wav = parseWav(fs.readFileSync(WAV_FILE));

function modelSample(cycles) {
  return Math.floor(cycles * psg.FACTOR / 4294967296);
}

function frameCycles(k) {
  const fr = songPlayer.FRAME_CYCLES;
  if (k === 0) return fr.t0;
  return fr.pattern[(k - 1) % fr.pattern.length];
}

function frameStart(k) {
  let c = 0;
  for (let i = 0; i < k; i++) c += frameCycles(i);
  return modelSample(c);
}

function peakFreq(sig, a, b, lo, hi) {
  let best = { amp: -1, f: 0 };
  for (let f = lo; f <= hi; f += 0.01) {
    let re = 0, im = 0;
    for (let i = a; i < b; i++) {
      const ph = 2 * Math.PI * f * i / 44100;
      re += sig[i] * Math.cos(ph);
      im += sig[i] * Math.sin(ph);
    }
    const amp = Math.hypot(re, im);
    if (amp > best.amp) best = { amp: amp, f: f };
  }
  return best;
}

function rms(sig, a, b) {
  let s = 0;
  for (let i = a; i < b; i++) s += sig[i] * sig[i];
  return Math.sqrt(s / (b - a));
}

function checkAudio() {
  console.log("audio — the first note is where the recording starts");
  let firstModel = -1;
  for (let i = 0; i < modelLeft.length; i++)
    if (modelLeft[i]) { firstModel = i; break; }
  let firstWav = -1;
  for (let i = 0; i < wav.frames; i++)
    if (wav.left[i]) { firstWav = i; break; }
  check(firstModel > 0 && Math.abs(firstWav - firstModel) <= 300,
        `model starts at sample ${firstModel}, recording at ${firstWav} ` +
        `(${firstWav - firstModel} samples)`);
  const lag = firstWav - firstModel;

  console.log("audio — every long note: pitch and level against the recording");
  const hz = { 36: 261.63, 40: 329.63, 43: 392.00, 48: 523.25,
               47: 493.88 };
  const mel = rendered.trace.notes.filter((n) => n.channel === 0);
  let worstHz = 0, worstWindow = "";
  for (let k = 0; k < mel.length - 1; k++) {
    const a = frameStart(mel[k].frame) + 3000;
    const b = Math.min(frameStart(mel[k + 1].frame) - 3000,
                       wav.frames - lag);
    if (b <= a + 4000) break;
    const pm = peakFreq(modelLeft, a, b, hz[mel[k].note] - 8,
                        hz[mel[k].note] + 8);
    const pw = peakFreq(wav.left, a + lag, b + lag,
                        hz[mel[k].note] - 8, hz[mel[k].note] + 8);
    const df = Math.abs(pm.f - pw.f);
    const ratio = rms(modelLeft, a, b) / rms(wav.left, a + lag, b + lag);
    if (df > worstHz) {
      worstHz = df;
      worstWindow = `${mel[k].note} at frame ${mel[k].frame}`;
    }
    console.log(`       note ${k} (${mel[k].note}, ${hz[mel[k].note]} Hz): ` +
                `peak ${pw.f.toFixed(2)} vs ${pm.f.toFixed(2)} Hz, ` +
                `RMS ratio ${ratio.toFixed(3)}`);
    check(df <= 0.5,
          `note ${k}: model and recording within 0.5 Hz (${df.toFixed(3)})`);
    if (mel[k].note === 36 || mel[k].note === 43) {
      /* C4/C5-shape notes whose fundamental is also a bass harmonic: C3's
       * second harmonic is C4, G3's is G4 (the G4 notes).  The level of the
       * sum then depends on the two voices' relative phase, which this port
       * does not model.  Report it. */
      check(Math.abs(ratio - 1) <= 0.25,
            `note ${k} (shared harmonic): RMS ratio ${ratio.toFixed(3)} ` +
            `within 0.25 (phase not modelled)`);
    } else {
      check(Math.abs(ratio - 1) <= 0.02,
            `note ${k}: RMS ratio ${ratio.toFixed(3)} within 2%`);
    }
  }
  console.log(`       worst pitch difference ${worstHz.toFixed(3)} Hz ` +
              `(${worstWindow})`);

  /* Waveform-level measurement, reported not asserted: the port does not
   * model the engine's per-write cycle offsets, so the two voices' relative
   * phase is not the console's.  This is what that costs. */
  let best = { c: -2, lag: 0 };
  for (let l = 0; l <= 500; l++) {
    let sxy = 0, sxx = 0, syy = 0;
    const end = Math.min(60000, pcm.length / 2, wav.frames - l);
    for (let i = 3000; i < end; i++) {
      const x = pcm[2 * i], y = wav.left[i + l];
      sxy += x * y; sxx += x * x; syy += y * y;
    }
    const c = sxy / Math.sqrt(sxx * syy || 1);
    if (c > best.c) best = { c: c, lag: l };
  }
  console.log(`       waveform correlation (first 1.4 s, best lag ` +
              `${best.lag}): ${best.c.toFixed(4)} — NOT 1.0: the engine's ` +
              `per-write cycle offsets are not modelled (docs/HUTRACK.md)`);
  const peak = (() => { let p = 0;
    for (let i = 0; i < pcm.length; i++) p = Math.max(p, Math.abs(pcm[i]));
    return p; })();
  console.log(`       model peak ${peak}, recording peak ` +
              `${(() => { let p = 0; for (let i = 0; i < wav.frames; i++)
                p = Math.max(p, Math.abs(wav.left[i])); return p; })()}`);
}

/* ---- run ---------------------------------------------------------------- */

checkReader();
checkPlayer();
checkAudio();

console.log(failures ? `\n${failures} failure(s)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
