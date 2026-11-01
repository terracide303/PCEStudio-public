#!/usr/bin/env node
/*
 * tests/check-hutrack-seq.js — the SEQUENCER's song and the studio's 15
 * built-in instruments as HuTrack data (#199, part of #194's ROM sound).
 *
 * The browser's SEQUENCER model (renderer/pce-seq.js) compiles a song into
 * the DMF-shaped module renderer/pce-song.js plays, and its writes are what
 * renderer/pce-psg.js renders.  The console plays the same music from
 * HuTrack's compressed song bank.  This check closes the gap between them:
 *
 *   1. renderer/pce-hutrack.js's fromSequencer() fills the two fields
 *      pce-seq.compile() does not write (`fxSlots` on every row,
 *      `legacyArpSpeed` in the header) and turns a noise drum into the
 *      engine's noise effect on channels 5-6.
 *   2. Each of renderer/pce-assets.js's 15 built-ins goes through the whole
 *      path — pce-seq.instrumentFromAsset() → compile() → fromSequencer() →
 *      convert() → assemble() — and the song bank is decoded back with the
 *      ENGINE's rules (HuTrack_parser.asm's mask bits, $E1..$FE skip runs,
 *      note cut).  The decoded instrument is compared with the studio's
 *      own write stream for that instrument (pce-assets.traceFor): the
 *      volume envelope, the 32-step wave and every register value are
 *      equal, with the one measured exception the engine forces — its noise
 *      pitch is NoiseTable[semitone], twelve legacy values, so a drum's NF
 *      lands on the nearest one (reported, bound asserted).
 *   3. A two-pattern song with drums that start, cut, run across an order
 *      boundary and hand a channel back to a wave instrument is converted
 *      the same way; its decoded rows equal the compiled module's, and the
 *      register stream rebuilt from the decoded bank equals the studio's
 *      stream (renderer/pce-seq.js events) frame by frame, except the two
 *      documented drum differences: R2/R3 from the retimed noise pitch and
 *      R7's quantised NF.
 *
 * The second opinion the card asks for "where possible" — the vendored
 * Python converter — is not possible for this song yet: it reads DMF files,
 * and the studio has no DMF export (#96).  The check says so and SKIPs that
 * comparison rather than pretending it ran.
 *
 * NOTE: written by @design, the seat that wrote the adapter.  Under workshop
 * RULES.md rule 2 this is not proof of itself — a different seat owes it a
 * cold break (a wrong effect slot, a missing off, a drum retimed to the
 * wrong entry, a dropped row) before #199 can close.
 */

"use strict";

const path = require("path");
const RENDERER = path.join(__dirname, "..", "renderer");
const assets = require(path.join(RENDERER, "pce-assets.js"));
const seq = require(path.join(RENDERER, "pce-seq.js"));
const hutrack = require(path.join(RENDERER, "pce-hutrack.js"));
const player = require(path.join(RENDERER, "pce-song.js"));

const FX_NONE = 0xffff;
const NOISE_FX = 0x11;
const BANK = 8 * 1024;

let checks = 0;
let failures = 0;
function ok(msg) { checks++; console.log("ok   " + msg); }
function fail(msg) { checks++; failures++; console.log("FAIL: " + msg); }
function check(cond, msg) { if (cond) ok(msg); else fail(msg); }
function eq(a, b, msg) {
  const same = JSON.stringify(a) === JSON.stringify(b);
  check(same, msg + (same ? "" : ": got " + JSON.stringify(a) +
                      ", expected " + JSON.stringify(b)));
}
function refused(fn, code, msg) {
  try { fn(); fail(msg + ": no refusal (expected " + code + ")"); }
  catch (e) {
    if (e.code === code) ok(msg + ": " + code);
    else fail(msg + ": refused with " + (e.code || e.message) +
              ", expected " + code);
  }
}

/* ---- reading the include files back with the engine's rules ------------ */

/* The .db values under a column-0 label (check-dmf.js's reader shape). */
function dbValues(text, label) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l === label);
  if (start < 0) throw new Error("label " + label + " not found");
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

/* HuTrack_parser.asm's ParseEntry: <0x80 is a field mask, 0x80..0xD3 a bare
 * note (+128), 0xD4..0xDF unsupported, 0xE0 a note cut, 0xE1..0xFE n+1
 * empty rows.  Returns one entry per row. */
function decodePattern(bytes) {
  const out = [];
  const empty = () => ({ note: null, cut: false, instrument: null,
                         volume: null, fx: [] });
  let pos = 0;
  while (pos < bytes.length) {
    const b = bytes[pos++];
    if (b < 0x80) {
      const row = empty();
      if (b & 0x01) {
        const note = bytes[pos++];
        if (note === 0xe0) row.cut = true;   /* a cut inside a field mask */
        else row.note = note;
      }
      if (b & 0x04) row.instrument = bytes[pos++];
      if (b & 0x08) row.volume = bytes[pos++];
      let code = FX_NONE, arg = FX_NONE;
      if (b & 0x10) code = bytes[pos++];
      if (b & 0x20) arg = bytes[pos++];
      if (code !== FX_NONE || arg !== FX_NONE) row.fx.push({ code, arg });
      if (b & 0x40) {                     /* FX2..FX4: one byte each */
        const ext = bytes[pos++];
        let n = 0;
        while (ext & (1 << n)) { row.fx.push({ code: bytes[pos++], arg: FX_NONE }); n++; }
      }
      out.push(row);
    } else if (b < 0xd4) {
      const row = empty();
      row.note = b - 0x80;
      out.push(row);
    } else if (b === 0xe0) {
      const row = empty();
      row.cut = true;
      out.push(row);
    } else if (b < 0xff) {
      out.push(empty());
      for (let i = 0; i < b - 0xe1; i++) out.push(empty());
    } else {
      throw new Error("reserved pattern byte $FF");
    }
  }
  return out;
}

function includeFiles(files, songName) {
  const pre = songName + "/" + songName;
  const head = files[pre + ".header.inc"];
  if (!head) throw new Error("no header include for " + songName);
  return {
    header: head,
    instrData: files[pre + ".instrData.inc"],
    patternMatrix: files[pre + ".patternMatrix.inc"],
    patternData: files[pre + ".patternData.inc"],
    wfData: files[pre + ".wfData.inc"]
  };
}

function decodeInstruments(inc) {
  const count = dbValues(inc.header, ".attributes.instrumentLen")[0];
  const out = [];
  for (let i = 0; i < count; i++) {
    const l = ".instrument." + i + ".";
    out.push({
      volumeEnv: {
        size: dbValues(inc.instrData, l + "volEnv.size")[0],
        loop: dbValues(inc.instrData, l + "volEnv.loop")[0],
        data: dbValues(inc.instrData, l + "volEnv.data")
      },
      arpeggioEnv: {
        size: dbValues(inc.instrData, l + "arpEnv.size")[0],
        loop: dbValues(inc.instrData, l + "arpEnv.loop")[0],
        data: dbValues(inc.instrData, l + "arpEnv.data")
      },
      wavetableEnv: {
        size: dbValues(inc.instrData, l + "waveFormEnv.size")[0],
        loop: dbValues(inc.instrData, l + "waveFormEnv.loop")[0],
        data: dbValues(inc.instrData, l + "waveFormEnv.data")
      }
    });
  }
  return out;
}

function decodeWaves(inc) {
  const count = dbValues(inc.header, ".attributes.waveformsLen")[0];
  const out = [];
  for (let w = 0; w < count; w++)
    out.push(dbValues(inc.wfData, ".waveform." + w));
  return out;
}

/* The song bank read back as the module renderer/pce-song.js takes. */
function decodeBank(files, songName) {
  const inc = includeFiles(files, songName);
  const rows = dbValues(inc.header, ".attributes.rowLength")[0];
  const orderCount = dbValues(inc.header, ".attributes.patternListLen")[0];
  const instruments = decodeInstruments(inc);
  const wavetables = decodeWaves(inc);
  const orderMatrix = [];
  const patterns = [];
  for (let ch = 0; ch < 6; ch++) {
    const matrix = dbValues(inc.patternMatrix, ".patternList.chan" + ch);
    orderMatrix.push(matrix);
    const unique = [];
    const count = Math.max.apply(null, matrix) + 1;
    for (let p = 0; p < count; p++) {
      const bytes = dbValues(inc.patternData,
                             ".pattern.table.chan" + ch + ".pattern" + p);
      const decoded = decodePattern(bytes);
      if (decoded.length !== rows)
        throw new Error("channel " + ch + " pattern " + p + " has " +
                        decoded.length + " rows, header says " + rows);
      unique.push(decoded);
    }
    patterns.push(unique);
  }
  return {
    timeBase: 1, tick1: dbValues(inc.header, ".attributes.tick1")[0],
    tick2: dbValues(inc.header, ".attributes.tick2")[0],
    frameMode: 1, customHz: 0,
    rowsPerPattern: rows, orderCount, orderMatrix,
    instruments, wavetables, patterns, samples: []
  };
}

/* A decoded row in the shape renderer/pce-song.js plays, with the noise
 * effect removed (the player refuses effect columns; the effect's register
 * writes are compared separately). */
function playableRow(row) {
  let note = null;
  if (row.note !== null) {
    note = { semitone: row.note % 12, octave: Math.floor(row.note / 12) };
  } else if (row.cut) {
    note = { cut: true };
  }
  return {
    note,
    octave: 0,
    volume: row.volume,
    effects: [],
    instrument: row.instrument
  };
}

function playableModule(decoded) {
  return {
    timeBase: decoded.timeBase, tick1: decoded.tick1, tick2: decoded.tick2,
    frameMode: decoded.frameMode, customHz: decoded.customHz,
    rowsPerPattern: decoded.rowsPerPattern, orderCount: decoded.orderCount,
    orderMatrix: decoded.orderMatrix,
    instruments: decoded.instruments.map((i) => ({
      volumeEnv: i.volumeEnv, arpeggioEnv: i.arpeggioEnv,
      wavetableEnv: i.wavetableEnv
    })),
    wavetables: decoded.wavetables,
    patterns: decoded.patterns.map((list) =>
      list.map((rows) => rows.map(playableRow))),
    samples: []
  };
}

/* The noise effect rows in the decoded bank: {channel, order, row, arg}. */
function decodedNoise(decoded) {
  const out = [];
  for (let ch = 0; ch < 6; ch++)
    for (let o = 0; o < decoded.orderCount; o++) {
      const rows = decoded.patterns[ch][decoded.orderMatrix[ch][o]];
      rows.forEach((row, r) => {
        row.fx.forEach((fx) => {
          if (fx.code === NOISE_FX) out.push({ ch, o, r, arg: fx.arg });
        });
      });
    }
  return out;
}

/* The same rows computed from the compiled module (the studio's own rows,
 * before the adapter): the browser's noiseWrites() rule, per channel and
 * across the order. */
function expectedNoise(mod) {
  const out = [];
  for (const ch of [4, 5]) {
    let on = false;
    for (let o = 0; o < mod.orderCount; o++) {
      mod.patterns[ch][o].forEach((row, r) => {
        let want = on;
        if (row.note) {
          want = !row.note.cut && row.instrument !== null &&
            row.instrument !== undefined &&
            mod.instruments[row.instrument].kind === "noise";
        }
        if (want !== on) { out.push({ ch, o, r, arg: want ? 1 : 0 }); on = want; }
      });
    }
  }
  return out;
}

/* ---- the conversion path ---------------------------------------------- */

function convertSong(song, name) {
  const mod = seq.compile(song);
  const adapted = hutrack.fromSequencer(mod);
  const converted = hutrack.convert(adapted,
                                    { songName: name, subFolder: name });
  const bank = hutrack.assemble(converted.files, converted.entry);
  return { mod, adapted, files: converted.files, bank,
           decoded: decodeBank(converted.files, name) };
}

function keyOf(e) { return e.ch + "/" + e.o + "/" + e.r + "=" + e.arg; }

/* R4 = $80 | level, or 0 when the engine is off; the envelope bytes the
 * studio writes and the instrument the converter wrote must agree. */
function expectedLoop(asset) {
  const size = asset.envelope.size;
  return asset.envelope.loop === undefined || asset.envelope.loop === null ||
         asset.envelope.loop >= size ? 0xff : asset.envelope.loop;
}

/* ---- 1. the 15 built-ins as HuTrack instruments ------------------------ */

function checkBuiltIns() {
  console.log("the 15 built-ins — pce-assets.js -> HuTrack instrument data");
  check(assets.INSTRUMENTS.length === 15,
        "the palette has 15 built-ins (" + assets.INSTRUMENTS.length + ")");
  const drums = assets.INSTRUMENTS.filter((i) => i.kind === "noise");
  check(drums.length === 7 && assets.INSTRUMENTS.length - drums.length === 8,
        "8 wave instruments and 7 noise drums");

  let waveExact = 0, drumExact = 0, quantised = 0, worst = 0;
  for (const asset of assets.INSTRUMENTS) {
    const song = seq.newSong(1);
    song.name = "inst-" + asset.id;
    song.instruments = [seq.instrumentFromAsset(asset)];
    song.patterns[0].channels[asset.kind === "noise" ? 4 : 0][0] =
      { note: 36, instrument: 0, length: 1 };
    const got = convertSong(song, "inst");
    check(got.bank.length <= BANK,
          asset.id + ": the song bank fits an 8 KiB bank (" +
          got.bank.length + " B)");

    const decoded = got.decoded;
    eq(decoded.instruments.length, 1, asset.id + ": one instrument decoded");
    const ins = decoded.instruments[0];
    eq(ins.volumeEnv.data, asset.envelope.data.slice(0, 32),
       asset.id + ": the volume envelope is the studio's, byte for byte");
    eq(ins.volumeEnv.size, asset.envelope.size, asset.id + ": envelope size");
    eq(ins.volumeEnv.loop, expectedLoop(asset),
       asset.id + ": envelope loop (hold is HuTrack's $FF)");

    let decodedWave = null;
    let decodedNf = null;
    if (asset.kind === "wave") {
      eq(ins.wavetableEnv.data, [0], asset.id + ": selects waveform 0");
      decodedWave = decoded.wavetables[0];
      eq(decodedWave, asset.wave,
         asset.id + ": the 32-step wave is the studio's, byte for byte");
    } else {
      eq(ins.wavetableEnv.size, 0, asset.id + ": a drum has no waveform");
      const drumRow = decoded.patterns[4][0][0];
      check(drumRow.note !== null,
            asset.id + ": the drum row carries a note");
      decodedNf = hutrack.NOISE_TABLE[drumRow.note % 12];
      check(drumRow.fx.some((fx) => fx.code === NOISE_FX && fx.arg === 1),
            asset.id + ": the drum row carries noise effect $11 on");
    }

    /* The studio's write stream for this instrument, and the stream the
     * converted data produces when played by the same model. */
    const studio = assets.traceFor(asset, { channel: 0, frames: 30 });
    const convertedInst = {
      kind: asset.kind, channel: asset.channel, name: asset.name,
      envelope: { size: ins.volumeEnv.size,
                  loop: ins.volumeEnv.loop === 0xff ? undefined
                                                     : ins.volumeEnv.loop,
                  data: ins.volumeEnv.data },
      wave: decodedWave, nf: decodedNf
    };
    const converted = assets.traceFor(convertedInst,
                                     { channel: 0, frames: 30 });
    eq(studio.count, converted.count, asset.id + ": same frame count");
    eq(studio.events.length, converted.events.length,
       asset.id + ": same number of PSG writes (" + studio.events.length +
       ")");

    let differing = [];
    const n = Math.min(studio.events.length, converted.events.length);
    for (let i = 0; i < n; i++) {
      const a = studio.events[i], b = converted.events[i];
      if (a.f !== b.f || a.reg !== b.reg || a.value !== b.value)
        differing.push({ i, a, b });
    }
    if (asset.kind === "wave") {
      eq(differing, [], asset.id + ": every PSG write is the studio's");
      waveExact++;
    } else {
      const bad = differing.filter((d) =>
        d.a.reg !== 7 || d.b.reg !== 7 ||
        (d.a.value & 0x80) === 0 || (d.b.value & 0x80) === 0);
      eq(bad, [], asset.id + ": every write except R7's NF is the studio's");
      const r7 = differing.find((d) => d.a.reg === 7);
      if (!r7) {
        check(asset.nf === decodedNf,
              asset.id + ": R7 is $80|" + asset.nf + " on both sides");
        drumExact++;
      } else {
        const delta = Math.abs((r7.b.value & 0x1f) - asset.nf);
        const nearest = hutrack.noisePitch(asset.nf);
        check(delta === nearest.delta && delta <= 2,
              asset.id + ": R7 lands on the nearest legacy NF " +
              (r7.b.value & 0x1f) + " (studio " + asset.nf + ", delta " +
              delta + " <= 2)");
        quantised++;
        worst = Math.max(worst, delta);
      }
    }
  }
  check(waveExact === 8, "the eight wave instruments match in every write (" +
        waveExact + ")");
  check(drumExact === 1, "one drum's NF is already an engine pitch (" +
        drumExact + ")");
  check(quantised === 6, "the other six drums differ only in R7's NF (" +
        quantised + "), worst delta " + worst);

  /* The measured size docs/ROM-SOUND.md §6 pins. */
  const palette = seq.newSong(16);
  palette.name = "builtins";
  palette.instruments = assets.INSTRUMENTS.map(seq.instrumentFromAsset);
  const builtins = convertSong(palette, "builtins");
  eq(builtins.bank.length, 935,
     "the 15 built-ins + 8 waves assemble to 935 B (ROM-SOUND.md §6)");
  const demo = convertSong(seq.demoSong(), "demo");
  eq(demo.bank.length, 521,
     "the SEQUENCER demo song assembles to 521 B (it carries its drums' " +
     "noise effects; ROM-SOUND.md §6)");
}

/* ---- 2. a SEQUENCER song ---------------------------------------------- */

function testSong() {
  const song = seq.newSong(8);
  song.name = "rom-sound";
  song.instruments = assets.INSTRUMENTS.map(seq.instrumentFromAsset);
  seq.addPattern(song);                  /* B */
  song.order = [0, 1];
  const A = song.patterns[0].channels;
  const B = song.patterns[1].channels;
  function put(pat, ch, step, note, instrument, length) {
    pat[ch][step] = { note, instrument, length };
  }
  /* waves on channels 1-3 */
  put(A, 0, 0, seq.noteIndex("C4"), 0, 3);
  put(A, 0, 4, seq.noteIndex("E4"), 2, 2);
  put(A, 1, 0, seq.noteIndex("C3"), 1, 4);
  put(A, 1, 4, seq.noteIndex("G3"), 4, 4);
  put(A, 2, 2, seq.noteIndex("C5"), 3, 2);
  put(A, 2, 6, seq.noteIndex("D5"), 5, 2);
  put(B, 0, 0, seq.noteIndex("G4"), 6, 2);
  put(B, 1, 0, seq.noteIndex("E3"), 7, 4);
  put(B, 2, 4, seq.noteIndex("A4"), 0, 2);
  /* drums: start, cut, a note that runs into the next order, and a wave
   * note that hands the channel back */
  put(A, 4, 0, seq.noteIndex("C4"), 8, 2);      /* kick on, cut at 2 */
  put(A, 4, 4, seq.noteIndex("C4"), 9, 1);      /* snare on, cut at 5 */
  put(A, 4, 7, seq.noteIndex("C4"), 8, 1);      /* runs into pattern B */
  put(B, 4, 0, seq.noteIndex("C4"), 8, 1);      /* still the same drum */
  put(B, 4, 3, seq.noteIndex("C4"), 12, 1);     /* tom on, cut at 4 */
  put(A, 5, 2, seq.noteIndex("C4"), 10, 2);     /* hat on, cut at 4 */
  put(A, 5, 6, seq.noteIndex("C4"), 14, 2);     /* crash runs into B */
  put(B, 5, 2, seq.noteIndex("G4"), 0, 2);      /* a wave note: noise off */
  put(B, 5, 6, seq.noteIndex("C4"), 13, 1);     /* clap on, cut at 7 */
  return song;
}

function checkSong() {
  console.log("a SEQUENCER song — rows, effects and the register stream");
  const song = testSong();
  const got = convertSong(song, "romsound");
  check(got.bank.length <= BANK,
        "the song bank fits an 8 KiB bank (" + got.bank.length + " B)");

  const mod = got.mod;
  const decoded = got.decoded;
  eq(decoded.rowsPerPattern, mod.rowsPerPattern, "rows per pattern");
  eq(decoded.orderCount, mod.orderCount, "order count");
  eq(decoded.instruments.length, 15, "all 15 built-ins in the bank");
  eq(decoded.wavetables.length, 8, "the 8 distinct waves in the bank");

  /* The rows: every note, instrument and volume is the compiled module's,
   * except a drum row's semitone, which the engine's noise table chooses. */
  let rows = 0, drums = 0;
  for (let ch = 0; ch < 6; ch++)
    for (let o = 0; o < mod.orderCount; o++) {
      const want = mod.patterns[ch][o];
      const gotRows = decoded.patterns[ch][decoded.orderMatrix[ch][o]];
      eq(gotRows.length, want.length, "channel " + ch + " order " + o +
         " row count");
      for (let r = 0; r < want.length; r++) {
        const w = want[r], g = gotRows[r];
        rows++;
        if (!w.note) {
          check(g.note === null && !g.cut,
                "channel " + ch + " order " + o + " row " + r + " empty");
        } else if (w.note.cut) {
          check(g.cut, "channel " + ch + " order " + o + " row " + r +
                " is the note cut");
        } else {
          const isDrum = w.instrument !== null &&
            mod.instruments[w.instrument].kind === "noise";
          const wantNote = isDrum
            ? hutrack.noisePitch(mod.instruments[w.instrument].nf).semitone +
              w.note.octave * 12
            : w.note.semitone + w.note.octave * 12;
          check(g.note === wantNote,
                "channel " + ch + " order " + o + " row " + r + " note " +
                wantNote + (isDrum ? " (the drum's legacy noise pitch)" : ""));
          if (isDrum) drums++;
        }
        eq(g.instrument, w.instrument === undefined ? null : w.instrument,
           "channel " + ch + " order " + o + " row " + r + " instrument");
        eq(g.volume, w.volume === undefined ? null : w.volume,
           "channel " + ch + " order " + o + " row " + r + " volume");
      }
    }
  check(rows === 6 * mod.orderCount * mod.rowsPerPattern,
        "every row decoded (" + rows + ")");
  check(drums === 8, "the drum rows decoded at the noise table (" + drums +
        ")");

  /* The noise effect: exactly the rows pce-seq.js would write R7 on. */
  const wantNoise = expectedNoise(mod);
  const gotNoise = decodedNoise(decoded);
  eq(gotNoise.map(keyOf), wantNoise.map(keyOf),
     "the noise effect $11 is on exactly the drum on/off rows (" +
     gotNoise.map(keyOf).join(", ") + ")");
  check(gotNoise.length > 0, "the song exercises the noise effect");
  check(gotNoise.some((e) => e.arg === 1) && gotNoise.some((e) => e.arg === 0),
        "it has both on and off events");

  /* The register stream: the studio's events for this song, and the stream
   * rebuilt from the converted data (the decoded rows through the same
   * player, plus the decoded $11 rows' R0/R7 writes at their row frames). */
  const timing = seq.timing(song);
  const studio = seq.events(song);
  const count = studio.count;
  const trace = player.trace(playableModule(decoded), { count });
  const byFrame = [];
  trace.events.forEach((e) => { (byFrame[e.f] = byFrame[e.f] || []).push(e); });
  for (const e of gotNoise) {
    const ch = e.ch;
    const f = timing.rowFrame(e.o * decoded.rowsPerPattern + e.r);
    if (f >= count) continue;
    const row = decoded.patterns[ch][decoded.orderMatrix[ch][e.o]][e.r];
    const value = e.arg === 0 ? 0x00
                              : 0x80 | hutrack.NOISE_TABLE[row.note % 12];
    (byFrame[f] = byFrame[f] || []).push({ f, t: 0, reg: 0, value: ch });
    (byFrame[f] = byFrame[f] || []).push({ f, t: 1, reg: 7, value });
  }
  let rebuilt = [];
  for (let f = 0; f < count; f++)
    if (byFrame[f]) rebuilt = rebuilt.concat(byFrame[f]);

  const want = studio.events;
  eq(rebuilt.length, want.length, "the converted data writes the same " +
     "number of registers (" + want.length + ")");

  /* Walk both streams.  On drum channels the note's R2/R3 are the retimed
   * noise pitch and R7 is the quantised NF; everything else is equal. */
  let same = 0, pitchDiffs = 0, nfDiffs = 0, nfWorst = 0;
  const bad = [];
  let channel = -1, wantChannel = -1;
  const n = Math.min(rebuilt.length, want.length);
  for (let i = 0; i < n; i++) {
    const a = want[i], b = rebuilt[i];
    if (a.reg === 0) wantChannel = a.value;
    if (b.reg === 0) channel = b.value;
    if (a.f === b.f && a.reg === b.reg && a.value === b.value) { same++; continue; }
    if (a.f !== b.f || a.reg !== b.reg) {
      bad.push({ i, why: "frame/register", a, b });
      continue;
    }
    if (a.reg === 2 || a.reg === 3) {
      if (wantChannel === 4 || wantChannel === 5) { pitchDiffs++; continue; }
      bad.push({ i, why: "pitch on channel " + wantChannel, a, b });
      continue;
    }
    if (a.reg === 7 && (a.value & 0x80) && (b.value & 0x80)) {
      const d = Math.abs((a.value & 0x1f) - (b.value & 0x1f));
      nfDiffs++;
      nfWorst = Math.max(nfWorst, d);
      if (d > 2) bad.push({ i, why: "R7 delta " + d, a, b });
      continue;
    }
    bad.push({ i, why: "value", a, b });
  }
  eq(bad.slice(0, 6), [], "every other register write is the studio's");
  check(same > 1000, "the streams are mostly identical (" + same + " writes)");
  check(pitchDiffs > 0,
        "R2/R3 differ only on drum frames (" + pitchDiffs + " writes, the " +
        "retimed noise pitch)");
  const onCount = gotNoise.filter((e) => e.arg === 1).length;
  check(nfDiffs <= onCount,
        "at most one R7 on-write per noise start (" + nfDiffs + " of " +
        onCount + " differ; the rest are already legacy values)");
  check(nfWorst <= 2, "the R7 NF is within 2 of the studio's (worst " +
        nfWorst + ")");

  /* The drum events' frames are the studio's: pce-seq.js's noiseWrites. */
  const studioNoise = seq.noiseWrites(song);
  const onFrames = studioNoise.filter((e) => e.reg === 7 && e.value)
    .map((e) => e.f).sort((a, b) => a - b);
  const rebuiltOn = rebuilt.filter((e) => e.reg === 7 && e.value)
    .map((e) => e.f).sort((a, b) => a - b);
  eq(rebuiltOn, onFrames, "R7 turns on in the studio's frames (" +
     onFrames.join(",") + ")");
}

/* ---- 3. refusals and the missing second opinion ------------------------ */

function checkRefusals() {
  console.log("refusals");
  function moduleWith(patterns, instruments) {
    return {
      timeBase: 1, tick1: 6, tick2: 6, frameMode: 1, customHz: 0,
      rowsPerPattern: 1, orderCount: 1,
      orderMatrix: [[0], [0], [0], [0], [0], [0]],
      songName: "probe", instruments, wavetables: [[15]], samples: [],
      patterns
    };
  }
  const drum = {
    name: "kick", mode: 0, kind: "noise", nf: 3,
    volumeEnv: { size: 1, data: [31], loop: 0xff },
    arpeggioEnv: { size: 0, data: [], loop: 0xff, mode: 0 },
    wavetableEnv: { size: 0, data: [], loop: 0xff }
  };
  const row = (note, instrument) => ({
    note, octave: 0, volume: null, effects: [], instrument
  });
  const empty = () => ({
    note: null, octave: 0, volume: null, effects: [], instrument: null
  });
  function probe(ch) {
    const patterns = [];
    for (let c = 0; c < 6; c++)
      patterns.push([[c === ch ? row({ semitone: 0, octave: 3 }, 0) : empty()]]);
    return moduleWith(patterns, [drum]);
  }
  refused(() => hutrack.fromSequencer(probe(0)), "song-noise-channel",
          "a drum on channel 1 (the engine ignores the noise effect there)");
  let accepted = false;
  try { hutrack.fromSequencer(probe(4)); accepted = true; }
  catch (e) { accepted = false; }
  check(accepted, "the same drum on channel 5 is accepted");
  const adapted = accepted ? hutrack.fromSequencer(probe(4)) : null;
  if (adapted) {
    refused(() => hutrack.fromSequencer(adapted), "song-shape",
            "an adapted module is refused, not adapted twice (its effect " +
            "columns would be dropped)");
  }
  refused(() => hutrack.fromSequencer({ patterns: [[]] }), "song-shape",
          "a module without six channel lists");
  refused(() => hutrack.fromSequencer(
            moduleWith([[[empty()]], [[empty()]], [[empty()]], [[empty()]],
                        [[empty()]], [[empty()]]], [])), "song-shape",
          "a module without instruments");
  refused(() => hutrack.fromSequencer(
            moduleWith([[[empty()]], [[empty()]], [[empty()]], [[empty()]],
                        [[empty()]], [[empty()]]],
                       [Object.assign({}, drum, { nf: null })])),
          "song-noise", "a noise drum without an NF");
}

function checkPythonOpinion() {
  console.log("the vendored Python converter");
  if (!process.env.HUTRACK_PYTHON) {
    console.log("SKIP: HUTRACK_PYTHON is not set (the converter needs " +
                "numpy and resampy)");
    return;
  }
  console.log("SKIP: the vendored converter reads DMF files and the studio " +
              "has no DMF export yet (#96), so it cannot produce this " +
              "song's includes");
}

/* ---- run -------------------------------------------------------------- */

try {
  checkBuiltIns();
  checkSong();
  checkRefusals();
  checkPythonOpinion();
} catch (e) {
  /* A refusal escaping the check is still a failure: name it rather than
   * letting the stack be the only witness (a broken adapter should read
   * FAIL, not a TypeError). */
  fail("the conversion threw " + (e.code ? e.code + ": " : "") + e.message);
}

console.log(failures === 0
  ? "PASS " + checks + " checks — the SEQUENCER song and its 15 built-ins " +
    "convert to HuTrack data"
  : "FAIL " + failures + " of " + checks + " checks");
process.exit(failures === 0 ? 0 : 1);
