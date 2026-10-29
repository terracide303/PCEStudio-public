#!/usr/bin/env node
/*
 * tests/check-sequencer.js — the #94 step sequencer's model, end to end.
 *
 * NOTE: written by @design because the card names check-studio.js as the
 * evidence and the panel's checks live there; this file is the model's own
 * longer evidence.  Under the workshop role split a test written by the
 * builder is flagged for @review to read cold (rule 2), the same arrangement
 * as check.js, check-editor.js, check-wave.js and check-studio.js.
 *
 * What it measures, and against what:
 *
 *  1. The model's refusals.  Every machine-readable code the header of
 *     renderer/pce-seq.js names is asserted below by forcing it.
 *
 *  2. The compiled song is the DMF shape pce-song.js takes.  A grid is
 *     written with the model's own setters and compile()'s output is compared
 *     field by field with a song object written HERE by hand — the shape
 *     renderer/pce-dmf.js hands the player for a .dmf file (one pattern copy
 *     per order position, a note-cut row where a note's length ends, an
 *     instrument per DMF's own fields).  The hand-written object, not the
 *     compiled one, is what the playback below is compared with, so the two
 *     halves cannot agree by construction.
 *
 *  3. Timing is the player's, measured.  pce-song.js alternates tick1 and
 *     tick2 every row; the model's row schedule is compared with the frame
 *     pce-song.js actually applies each note on, straight and with swing, for
 *     two order entries.
 *
 *  4. What the panel plays is what the console's model plays.  The PCM from
 *     seq.render() must equal pce-psg.js's render of pce-song.js's trace of
 *     the hand-written song, sample for sample; the event streams must be
 *     equal too (there are no drums in that grid).
 *
 *  5. Noise drums.  pce-song.js has no effect columns, so the drum's R7
 *     writes are the model's (HuTrack_parser.asm .platFX.Noise): asserted at
 *     the frames pce-song.js applies the drum's own note, with the drum's
 *     volume still the driver's R4 envelope pce-song.js writes.  Removing the
 *     R7 writes changes the PCM, so they are audible.
 *
 *  6. Note lengths are cut rows, and a note is cut by the next note on its
 *     channel rather than by a spurious cut.
 *
 *  7. The voice count (the 6-voice limit the panel's bar shows), the key's
 *     spelling, and song.json's round trip.
 *
 * Not measured here: the panel's DOM (tests/check-studio.js drives it), a
 * Mednafen recording of a sequencer song (none exists; the PSG model's own
 * proof is check-psg.js/check-dmf.js), and the DMF export (#96).
 */

"use strict";

const seq = require("../renderer/pce-seq.js");
const song = require("../renderer/pce-song.js");
const psg = require("../renderer/pce-psg.js");

let failures = 0;
function fail(what) { console.log(`  FAIL ${what}`); failures++; }
function ok(what) { console.log(`  ok   ${what}`); }

function eq(what, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) ok(what);
  else fail(`${what}\n        got  ${JSON.stringify(got)}\n        want ` +
            `${JSON.stringify(want)}`);
}

function refuses(code, what, fn) {
  let got = null;
  try { fn(); } catch (e) { got = e.code || e.message; }
  if (got === code) ok(`${what} (${code})`);
  else fail(`${what}: expected ${code}, got ${JSON.stringify(got)}`);
}

/* ---- the grids and the hand-written songs they must compile to --------- */

/* Eight steps at 150 BPM: six ticks a step, no swing.  Channel 1 holds C4 for
 * two steps then E4 for two; channel 2 holds C3 for four.  Both end on step
 * 5 (index 4), where a note-cut row belongs. */
function waveGrid() {
  const s = seq.newSong(8);
  for (let ch = 0; ch < 6; ch++)
    for (let st = 0; st < 8; st++) s.patterns[0].channels[ch][st] = null;
  seq.setTempo(s, 150);
  seq.setSwing(s, 0);
  seq.setCell(s, 0, 0, 0, { note: 36, instrument: 0, length: 2 });   /* C4 */
  seq.setCell(s, 0, 0, 2, { note: 40, instrument: 0, length: 2 });   /* E4 */
  seq.setCell(s, 0, 1, 0, { note: 24, instrument: 1, length: 4 });   /* C3 */
  return s;
}

function drumGrid() {
  const s = waveGrid();
  seq.setCell(s, 0, 4, 4, { note: 36, instrument: 4, length: 1 });
  return s;
}

/* The same music as a DMF reader would hand pce-song.js: every field its
 * checkSong reads, and nothing the sequencer adds. */
function referenceSong(withDrum) {
  const empty = { size: 0, data: [], loop: 0xff };
  function inst(name, env, waveIndex, loop) {
    return {
      name: name, mode: 0,
      volumeEnv: { size: env.length, data: env.slice(),
                   loop: loop === undefined ? 0xff : loop },
      arpeggioEnv: { size: 0, data: [], loop: 0xff, mode: 0 },
      noiseEnv: empty,
      wavetableEnv: waveIndex === null ? empty
        : { size: 1, data: [waveIndex], loop: 0xff }
    };
  }
  function row(note, instrument) {
    const r = { note: null, octave: 0, volume: null, effects: [],
                instrument: null };
    if (note === "cut") r.note = { cut: true };
    else if (note) {
      r.note = { semitone: note % 12, octave: Math.floor(note / 12) };
      r.instrument = instrument;
    }
    return r;
  }
  function blank() {
    const rows = [];
    for (let i = 0; i < 8; i++) rows.push(row(null));
    return rows;
  }
  const ch0 = blank();
  ch0[0] = row(36, 0);
  ch0[2] = row(40, 0);
  ch0[4] = row("cut");
  const ch1 = blank();
  ch1[0] = row(24, 1);
  ch1[4] = row("cut");
  const ch2 = blank(), ch3 = blank(), ch5 = blank();
  const ch4 = blank();
  if (withDrum) {
    ch4[4] = row(36, 4);
    ch4[5] = row("cut");
  }
  return {
    timeBase: 1,
    frameMode: 1,
    customHz: 0,
    tick1: 6,
    tick2: 6,
    rowsPerPattern: 8,
    orderCount: 1,
    orderMatrix: [[0], [0], [0], [0], [0], [0]],
    instruments: [
      inst("lead", [31], 0),
      inst("bass", [31, 28, 24], 1, 2),
      inst("bell", [31, 27, 21, 13, 6, 0], 2),
      inst("strings", [20, 26, 31], 3, 2),
      inst("kick", [31, 26, 15, 5, 0], null),
      inst("snare", [31, 23, 11, 0], null)
    ],
    wavetables: [
      waveShape("pulse"), waveShape("square"),
      waveShape("sine"), waveShape("saw")
    ],
    /* one copy per order position, as renderer/pce-dmf.js builds it */
    patterns: [ch0, ch1, ch2, ch3, ch4, ch5].map(function (rows) {
      return [rows];
    }),
    samples: []
  };
}

function waveShape(name) {
  const wave = require("../renderer/pce-wave.js");
  return wave.PRESETS[name].slice();
}

/* compile() carries a few fields pce-dmf.js does not (source, kind, nf) and
 * the reader's extra header fields; compare what the player reads. */
function compareCompiled(what, got, want) {
  eq(what + ": pattern shape",
     [got.rowsPerPattern, got.orderCount, got.timeBase, got.frameMode,
      got.customHz, got.tick1, got.tick2].join(","),
     [want.rowsPerPattern, want.orderCount, want.timeBase, want.frameMode,
      want.customHz, want.tick1, want.tick2].join(","));
  eq(what + ": order matrix", got.orderMatrix, want.orderMatrix);
  eq(what + ": wavetables", got.wavetables, want.wavetables);
  eq(what + ": instruments", got.instruments.map((i) => ({
    name: i.name,
    volumeEnv: i.volumeEnv,
    wavetableEnv: i.wavetableEnv,
    arpeggio: i.arpeggioEnv.size
  })), want.instruments.map((i) => ({
    name: i.name,
    volumeEnv: i.volumeEnv,
    wavetableEnv: i.wavetableEnv,
    arpeggio: i.arpeggioEnv.size
  })));
  for (let ch = 0; ch < 6; ch++) {
    const note = (row) => row.note
      ? (row.note.cut ? "cut" : row.note.semitone + "/" + row.note.octave)
      : "-";
    eq(what + ": channel " + (ch + 1) + " rows",
       got.patterns[ch][0].map((r) => note(r) + ":" + r.instrument),
       want.patterns[ch][0].map((r) => note(r) + ":" + r.instrument));
  }
}

/* ---- 1. the model's refusals ------------------------------------------ */

function checkRefusals() {
  console.log("== 1. the model's refusals");
  const s = seq.newSong(8);
  refuses("seq-tempo", "a tempo below 30 BPM", () => seq.setTempo(s, 20));
  refuses("seq-tempo", "a tempo above 300 BPM", () => seq.setTempo(s, 400));
  refuses("seq-swing", "swing above 60 percent", () => seq.setSwing(s, 61));
  refuses("seq-swing", "a negative swing", () => seq.setSwing(s, -1));
  refuses("seq-key", "a key outside 0..11", () => seq.setKey(s, 12));
  refuses("seq-steps", "a pattern longer than 64 steps",
          () => seq.setSteps(s, 65));
  refuses("seq-steps", "a pattern of zero steps", () => seq.setSteps(s, 0));
  refuses("seq-pattern", "a pattern index the song does not have",
          () => seq.setCell(s, 3, 0, 0, { note: 36, instrument: 0, length: 1 }));
  refuses("seq-order", "an order naming a missing pattern",
          () => seq.setOrder(s, [2]));
  refuses("seq-order", "an order of zero entries", () => seq.setOrder(s, []));
  refuses("seq-order", "the one-line order naming a missing pattern",
          () => seq.parseOrder(s, "A,Z"));
  refuses("seq-channel", "a seventh channel",
          () => seq.setCell(s, 0, 6, 0, { note: 36, instrument: 0, length: 1 }));
  refuses("seq-note", "a note above the engine's B7",
          () => seq.setCell(s, 0, 0, 0, { note: 84, instrument: 0, length: 1 }));
  refuses("seq-length", "a length of zero",
          () => seq.setCell(s, 0, 0, 0, { note: 36, instrument: 0, length: 0 }));
  refuses("seq-length", "a length past the pattern",
          () => seq.setCell(s, 0, 0, 0, { note: 36, instrument: 0, length: 9 }));
  refuses("seq-instrument", "an instrument the song does not have",
          () => seq.setCell(s, 0, 0, 0, { note: 36, instrument: 99,
                                          length: 1 }));
  refuses("seq-voice", "a noise drum on a channel without the generator",
          () => seq.setCell(seq.demoSong(), 0, 0, 0,
                            { note: 36, instrument: 4, length: 1 }));

  const shortWave = seq.newSong(8);
  shortWave.instruments[0].wave = shortWave.instruments[0].wave.slice(0, 31);
  refuses("seq-wave", "a wave that is not 32 steps", () => seq.check(shortWave));
  const loudWave = seq.newSong(8);
  loudWave.instruments[0].wave[3] = 32;
  refuses("seq-wave", "a wave step above 31", () => seq.check(loudWave));
  const noEnv = seq.newSong(8);
  noEnv.instruments[0].env = { size: 0, data: [], loop: 0xff };
  refuses("seq-env", "an empty envelope", () => seq.check(noEnv));
  const badLevel = seq.newSong(8);
  badLevel.instruments[0].env = { size: 2, data: [31, 32], loop: 0xff };
  refuses("seq-env", "an envelope level above 31", () => seq.check(badLevel));
  const badLoop = seq.newSong(8);
  badLoop.instruments[0].env = { size: 2, data: [31, 20], loop: 5 };
  refuses("seq-env", "an envelope loop past its last step",
          () => seq.check(badLoop));
  const badNf = seq.newSong(8);
  badNf.instruments[4].nf = 32;
  refuses("seq-noise", "a noise frequency above 31", () => seq.check(badNf));

  refuses("seq-json", "text that is not JSON", () => seq.fromJSON("nope"));
  refuses("seq-json", "a song from another version",
          () => seq.fromJSON(JSON.stringify({ version: 2 })));
  refuses("seq-tempo", "a song with no tempo is refused by its field's code",
          () => {
    const doc = JSON.parse(seq.toJSON(seq.newSong(8)));
    delete doc.tempo;
    seq.fromJSON(JSON.stringify(doc));
  });
}

/* ---- 2. the compiled song is the hand-written DMF shape --------------- */

function checkCompile() {
  console.log("== 2. compile() is the DMF song pce-song.js takes");
  const got = seq.compile(waveGrid());
  const want = referenceSong(false);
  compareCompiled("wave grid", got, want);
  eq("compile() refuses nothing checkSong refuses",
     song.checkSong(Object.assign({}, got)), true);

  const gotDrum = seq.compile(drumGrid());
  compareCompiled("drum grid", gotDrum, referenceSong(true));
  eq("… and the drum's song passes checkSong",
     song.checkSong(Object.assign({}, gotDrum)), true);
}

/* ---- 3. timing is the player's, measured ------------------------------ */

/* The frame pce-song.js applied each note on, in row order, compared with the
 * model's row schedule.  The notes come from the player; the schedule comes
 * from the model. */
function playerRowFrames(grid, compiled) {
  const t = seq.timing(grid);
  const played = seq.events(grid);
  const frames = played.notes
    .filter((n) => n.frame < t.framesPerOrder)
    .map((n) => n.frame).sort((a, b) => a - b);
  const expected = [];
  for (let o = 0; o < grid.order.length; o++) {
    for (let ch = 0; ch < 6; ch++) {
      const cells = grid.patterns[grid.order[o]].channels[ch];
      for (let st = 0; st < grid.steps; st++)
        if (cells[st])
          expected.push({ ch: ch, frame: t.rowFrame(o * grid.steps + st) });
    }
  }
  return { frames: frames, expected: expected, timing: t, played: played };
}

function checkTiming() {
  console.log("== 3. the row schedule is pce-song.js's");
  eq("150 BPM is six ticks a step", seq.timing(waveGrid()).base, 6);

  for (const [tempo, ticks] of [[60, 15], [120, 8], [150, 6], [200, 5],
                                [300, 3]]) {
    const g = waveGrid();
    seq.setTempo(g, tempo);
    eq(tempo + " BPM is " + ticks + " ticks a step", seq.timing(g).base, ticks);
  }

  const straight = waveGrid();
  let t = seq.timing(straight);
  eq("no swing keeps tick1 = tick2",
     [t.tick1, t.tick2].join(","), "6,6");
  seq.setSwing(straight, 25);
  t = seq.timing(straight);
  eq("25% swing lengthens the on-beat and shortens the off-beat by the same",
     [t.tick1, t.tick2].join(","), "8,4");
  /* eight steps: four on-beats at 8 and four off-beats at 4, after the
   * first row's tick2 — 4 + 4*8 + 4*4.  Alternating +2/-2 does shift the
   * rounded average by a frame against the straight pass (54). */
  eq("… and the pass is the eight alternating steps",
     t.framesPerOrder, 4 + 4 * 8 + 4 * 4);

  for (const swing of [0, 25, 60]) {
    for (const order of [[0], [0, 0]]) {
      const g = drumGrid();
      seq.setSwing(g, swing);
      if (order.length > 1) seq.setOrder(g, order);
      const compiled = seq.compile(g);
      const got = playerRowFrames(g, compiled);
      got.expected.sort((a, b) => a.frame - b.frame || a.ch - b.ch);
      const want = got.played.notes
        .filter((n) => n.frame < got.timing.framesPerOrder)
        .map((n) => ({ ch: n.channel, frame: n.frame }))
        .sort((a, b) => a.frame - b.frame || a.ch - b.ch);
      eq(`swing ${swing}%, ${order.length} bar(s): pce-song's note frames ` +
         `are the row schedule`, got.expected, want);
    }
  }
}

/* ---- 4. the sound is pce-song.js's and pce-psg.js's ------------------- */

function checkPlayback() {
  console.log("== 4. the PCM is the hand-written song's");
  const grid = waveGrid();
  const got = seq.events(grid);
  const reference = song.trace(referenceSong(false), { count: got.count });
  eq("the event stream is pce-song.js's own trace of the hand-written song",
     got.events, reference.events);

  const rendered = psg.render(reference.events, got.frames, got.count);
  const mine = seq.render(grid);
  eq("the sample count is pce-psg.js's", mine.pcm.length, rendered.pcm.length);
  let firstbad = -1;
  for (let i = 0; i < mine.pcm.length; i++)
    if (mine.pcm[i] !== rendered.pcm[i]) { firstbad = i; break; }
  if (firstbad < 0) ok(`every one of ${mine.pcm.length} samples is equal`);
  else fail(`first differing sample ${firstbad}: ${mine.pcm[firstbad]} vs ` +
            `${rendered.pcm[firstbad]}`);
  let peak = 0;
  for (let i = 0; i < mine.pcm.length; i++)
    peak = Math.max(peak, Math.abs(mine.pcm[i]));
  checkSilence(peak, "the song sounds (peak " + peak + ")");
}

function checkSilence(peak, what) {
  if (peak > 0) ok(what);
  else fail(what + ": the render is silent");
}

/* ---- 5. noise drums --------------------------------------------------- */

/* The last R4 value written in each frame to one channel: the level the
 * driver's envelope settled on after the frame's other writes. */
function lastR4ByFrame(events, channel) {
  const byFrame = new Map();
  let selected = 0;
  for (const e of events) {
    if (e.reg === 0) selected = e.value;
    if (e.reg === 4 && selected === channel) byFrame.set(e.f, e.value);
  }
  return Array.from(byFrame.entries()).map(([f, v]) => ({ f: f, v: v }))
    .sort((a, b) => a.f - b.f);
}

function checkDrums() {
  console.log("== 5. noise drums");
  const grid = drumGrid();
  const t = seq.timing(grid);
  const got = seq.events(grid);
  const noise = got.events.filter((e) => e.kind && /^noise/.test(e.kind));

  const drumRow = 4;                     /* step 5 (index 4) */
  eq("the drum switches R7 on at its own row",
     noise.filter((e) => e.kind === "noise-on" && e.reg === 7)
       .map((e) => [e.f, e.value].join("@")),
     [t.rowFrame(drumRow) + "@" + (0x80 | 28)]);
  eq("… selects the drum's channel first",
     noise.filter((e) => e.kind === "noise-on" && e.reg === 0)
       .map((e) => e.value), [4]);
  eq("… and switches it off where the note is cut",
     noise.filter((e) => e.kind === "noise-off" && e.reg === 7)
       .map((e) => [e.f, e.value].join("@")),
     [t.rowFrame(drumRow + 1) + "@0"]);

  /* the drum's note is pce-song.js's, at the frame the player applies it */
  const drumNote = got.notes.find((n) => n.channel === 4);
  if (drumNote) {
    eq("the drum's note is the player's, on the R7 row",
       [drumNote.frame, drumNote.note].join(","),
       [t.rowFrame(drumRow), 36].join(","));
  } else fail("pce-song.js played no note for the drum");

  /* its volume is the driver envelope pce-song.js writes */
  const r4 = lastR4ByFrame(got.events, 4)
    .filter((e) => e.f >= t.rowFrame(drumRow));
  eq("the drum's volume is the driver's R4 envelope",
     r4.slice(0, 5).map((e) => e.v),
     [31, 26, 15, 5, 0].map((v) => 0x80 | v));

  /* the R7 writes are audible: without them the PCM is different */
  const without = got.events.filter((e) => !(e.kind && /^noise/.test(e.kind)));
  const a = psg.render(got.events, got.frames, got.count).pcm;
  const b = psg.render(without, got.frames, got.count).pcm;
  let different = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) different++;
  checkSilence(different, "the noise writes change the sound (" + different +
               " samples differ)");

  /* and the drum's own wave upload is silent, so the difference is noise */
  const drumWave = seq.compile(grid).wavetables;
  eq("the drum's channel carries no wave of its own", drumWave.length, 4);
}

/* ---- 6. note lengths are cut rows ------------------------------------- */

function checkLengths() {
  console.log("== 6. note lengths are cut rows");
  const compiled = seq.compile(waveGrid());
  const ch0 = compiled.patterns[0][0];
  eq("C4 at step 1 lasts two steps", ch0[0].note,
     { semitone: 0, octave: 3 });
  eq("E4 replaces it at step 3 (no cut between)", ch0[2].note,
     { semitone: 4, octave: 3 });
  eq("the second note is cut two steps later", ch0[4].note, { cut: true });
  eq("the cut row carries no instrument", ch0[4].instrument, null);

  /* a note clipped by the next one needs no cut row of its own */
  const g = seq.newSong(8);
  for (let ch = 0; ch < 6; ch++)
    for (let st = 0; st < 8; st++) g.patterns[0].channels[ch][st] = null;
  seq.setCell(g, 0, 0, 0, { note: 36, instrument: 0, length: 6 });
  seq.setCell(g, 0, 0, 3, { note: 40, instrument: 0, length: 2 });
  const rows = seq.compile(g).patterns[0][0];
  eq("a note's next note clips it, and the clipped step is the new note",
     rows[3].note, { semitone: 4, octave: 3 });
  eq("… with no cut written before it", rows[2].note, null);
  eq("… and the new note cuts at its own length", rows[5].note, { cut: true });
  /* the clipped note's own length would have reached step 6: no cut may be
   * written there, because the note it would cut is already gone */
  eq("… and the clipped note writes no cut of its own", rows[6].note, null);

  /* the case a spurious cut would break: the second note outlasts the first
   * note's length, so a cut at the first note's end would silence it */
  const outlast = seq.newSong(8);
  for (let ch = 0; ch < 6; ch++)
    for (let st = 0; st < 8; st++) outlast.patterns[0].channels[ch][st] = null;
  seq.setCell(outlast, 0, 0, 0, { note: 36, instrument: 0, length: 3 });
  seq.setCell(outlast, 0, 0, 1, { note: 40, instrument: 0, length: 6 });
  const rows2 = seq.compile(outlast).patterns[0][0];
  eq("a longer note after a short one is not cut by the short one",
     rows2.map((r) => r.note ? (r.note.cut ? "cut" : r.note.semitone) : "-"),
     [0, 4, "-", "-", "-", "-", "-", "cut"]);

  /* a note whose length reaches the pattern end is cut by the next pattern */
  const last = seq.newSong(4);
  for (let ch = 0; ch < 6; ch++)
    for (let st = 0; st < 4; st++) last.patterns[0].channels[ch][st] = null;
  seq.setCell(last, 0, 0, 2, { note: 36, instrument: 0, length: 2 });
  eq("a note ending at the pattern's end writes no cut",
     seq.compile(last).patterns[0][0].map((r) => r.note ? Object.keys(r.note)
                                                        .join() : "-"),
     ["-", "-", "semitone,octave", "-"]);
}

/* ---- 7. voices, key, notes ------------------------------------------- */

function checkVoicesAndNotes() {
  console.log("== 7. voices, key and note names");
  const g = seq.newSong(8);
  for (let ch = 0; ch < 6; ch++)
    for (let st = 0; st < 8; st++) g.patterns[0].channels[ch][st] = null;
  for (let ch = 0; ch < 6; ch++)
    seq.setCell(g, 0, ch, 0, { note: 36, instrument: ch >= 4 ? 4 : 0,
                                length: 4 });
  eq("six channels sound at step 1", seq.voicesAt(g, 0, 0), 6);
  eq("… and none at step 6", seq.voicesAt(g, 0, 5), 0);
  eq("the voices bar is one count per step", seq.voiceBars(g, 0),
     [6, 6, 6, 6, 0, 0, 0, 0]);
  eq("the chip's limit is six", seq.VOICE_LIMIT, 6);

  eq("C4 is the engine's note 36", seq.noteIndex("C4"), 36);
  eq("C#4 and Db4 are the same note",
     [seq.noteIndex("C#4"), seq.noteIndex("Db4")].join(","), "37,37");
  eq("note 36 is C4", seq.noteName(36, 0), "C4");
  eq("key F spells A# as Bb", seq.noteName(34, 5), "Bb3");
  eq("key G spells it A#", seq.noteName(34, 7), "A#3");
  eq("C4 is in C major", seq.inScale(36, 0), true);
  eq("C#4 is not", seq.inScale(37, 0), false);
}

/* ---- 8. song.json ----------------------------------------------------- */

function checkJSON() {
  console.log("== 8. song.json");
  const s = drumGrid();
  seq.setSwing(s, 20);
  seq.setKey(s, 5);
  const text = seq.toJSON(s);
  eq("the song round-trips byte for byte", seq.toJSON(seq.fromJSON(text)), text);
  const back = seq.fromJSON(text);
  eq("… with its settings", [back.tempo, back.swing, back.key, back.steps],
     [150, 20, 5, 8]);
  eq("… its notes", back.patterns[0].channels[0][0],
     { note: 36, instrument: 0, length: 2 });
  eq("… and its instruments", back.instruments.map((i) => i.kind),
     ["wave", "wave", "wave", "wave", "noise", "noise"]);
  eq("the demo song is a legal song", seq.check(seq.demoSong()), true);
  eq("a new song is one empty pattern of sixteen steps",
     [seq.newSong().patterns.length, seq.newSong().steps], [1, 16]);
}

/* ---- main ------------------------------------------------------------- */

function main() {
  checkRefusals();
  checkCompile();
  checkTiming();
  checkPlayback();
  checkDrums();
  checkLengths();
  checkVoicesAndNotes();
  checkJSON();
  if (failures === 0) {
    console.log("PASS: the step grid compiles to the DMF song pce-song.js " +
                "plays, its timing is the player's, and its sound is the " +
                "hand-written song's through pce-psg.js");
    return 0;
  }
  console.log(`FAIL: ${failures} check(s) failed`);
  return 1;
}

process.exitCode = main();
