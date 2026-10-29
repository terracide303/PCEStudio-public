#!/usr/bin/env node
/*
 * tests/check-staff.js — the SEQUENCER's staff view model (#95).
 *
 * NOTE: written by @design because the card's evidence is this suite and the
 * panel's checks live in tests/check-studio.js.  Under the workshop role
 * split a test written by the builder is flagged for @review to read cold
 * (rule 2), the same arrangement as check-sequencer.js.
 *
 * What it measures:
 *
 *  1. Key signatures.  Every one of the twelve major keys the panel's Key
 *     menu offers, with the exact accidentals and the conventional order
 *     (sharps F C G D A E B, flats B E A D G C F).
 *
 *  2. Spelling.  A scale degree takes its key's letter; a chromatic note
 *     takes the key's own direction (sharp key -> a sharp, flat key -> a
 *     flat); a natural of a letter the signature alters is printed with a
 *     natural sign; a note the signature already covers prints nothing.
 *     Octaves are solved so the letter and the pitch agree at the edges
 *     (B#5 = C6, Gb4 = F#4).
 *
 *  3. Clefs.  Bass below middle C, treble from it up; middle C sits on the
 *     first ledger line below the treble staff and above the bass staff.
 *
 *  4. Note values.  1/16 .. whole, dots for 1.5, 1.75 and 1.875 times, and
 *     `exact` false where a length is not a drawn value.
 *
 *  5. Octave marks.  The four marks' thresholds, each reachable inside the
 *     engine's 0..83 range, and `loco` written where a run returns to the
 *     written octave.  Marks restart at every bar.
 *
 *  6. The layout reads the song and changes nothing.  One bar per order
 *     entry; every cell on every channel appears once, with its step, its
 *     channel and its length's value; the song object is deep-equal before
 *     and after.
 *
 * Not measured here: the painted canvas (tests/check-studio.js drives the
 * panel's drawing through the stub context), and a screenshot.
 */

"use strict";

const seq = require("../renderer/pce-seq.js");
const staff = require("../renderer/pce-staff.js");

let failures = 0;
function fail(what) { console.log(`  FAIL ${what}`); failures++; }
function ok(what) { console.log(`  ok   ${what}`); }

function eq(what, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) ok(what);
  else fail(`${what}\n        got  ${JSON.stringify(got)}\n        want ` +
            `${JSON.stringify(want)}`);
}

function check(what, cond) {
  if (cond) ok(what); else fail(what);
}

/* ---- 1. the key signatures -------------------------------------------- */

function checkKeys() {
  console.log("== 1. the twelve major key signatures");
  const want = {
    0: ["C", "none", ""],
    1: ["Db", "flat", "Bb,Eb,Ab,Db,Gb"],
    2: ["D", "sharp", "F#,C#"],
    3: ["Eb", "flat", "Bb,Eb,Ab"],
    4: ["E", "sharp", "F#,C#,G#,D#"],
    5: ["F", "flat", "Bb"],
    6: ["F#", "sharp", "F#,C#,G#,D#,A#,E#"],
    7: ["G", "sharp", "F#"],
    8: ["Ab", "flat", "Bb,Eb,Ab,Db"],
    9: ["A", "sharp", "F#,C#,G#"],
    10: ["Bb", "flat", "Bb,Eb"],
    11: ["B", "sharp", "F#,C#,G#,D#,A#"]
  };
  for (let k = 0; k < 12; k++) {
    const sig = staff.keySignature(k);
    eq(`key ${seq.KEY_NAMES[k]} has ${want[k][1]} of ${want[k][2] || "nothing"}`,
       [sig.kind,
        sig.marks.map((m) => m.letter + m.accidental).join(",")],
       [want[k][1], want[k][2]]);
  }
  /* The seven degrees are one of each letter, starting on the tonic. */
  const db = staff.keySignature(1);
  eq("a key signature spells one letter per degree, from the tonic",
     db.degrees.map((d) => d.letter + d.accidental).join(" "),
     "Db Eb F Gb Ab Bb C");
}

/* ---- 2. spelling ------------------------------------------------------- */

function checkSpelling() {
  console.log("== 2. spelling the notes");
  const name = (n, k) => {
    const s = staff.spell(n, k);
    return s.letter + s.accidental + s.octave + (s.printed ? " (" + s.printed + ")" : "");
  };
  eq("C major, C4 is a plain degree", name(36, 0), "C4");
  eq("C major, C#4 is a sharp", name(37, 0), "C#4 (#)");
  eq("C major, Eb4 is a flat", name(39, 0), "D#4 (#)");
  eq("G major, F#4 is in the signature and prints nothing",
     name(42, 7), "F#4");
  eq("G major, F natural is a natural sign", name(41, 7), "F4 (n)");
  eq("D major, E4 is a plain degree", name(40, 2), "E4");
  eq("D major, C natural is a natural sign", name(36, 2), "C4 (n)");
  eq("a sharp key spells a black note sharp", name(61, 0), "C#6 (#)");
  eq("a flat key spells the same black note flat", name(61, 5), "Db6 (b)");
  eq("a flat spelling still sits on the letter's own line",
     [staff.spell(66, 5).letter, staff.spell(66, 5).octave,
      staff.spell(66, 5).diatonic], ["G", 6, 6 * 7 + 4]);
  eq("… which is F#6", name(66, 0), "F#6 (#)");
  eq("F# major's E# is in the signature and prints nothing",
     name(65, 6), "E#6");
  eq("F# major's C natural takes a natural sign", name(60, 6), "C6 (n)");
}

/* ---- 3. clefs ---------------------------------------------------------- */

function checkClefs() {
  console.log("== 3. the two clefs");
  eq("B3 is on the bass clef", staff.clefFor(35), "bass");
  eq("C4 is on the treble clef", staff.clefFor(36), "treble");
  eq("C1 is on the bass clef", staff.clefFor(0), "bass");
  eq("B7 is on the treble clef", staff.clefFor(83), "treble");
  /* E4 is the treble's bottom line (step 0) and G2 the bass's. */
  const c4 = staff.spell(36, 0);
  eq("C4 is two steps below the treble staff's bottom line",
     staff.staffStep(c4.diatonic, "treble"), -2);
  eq("… and that is the first ledger line, one space below it",
     staff.staffStep(c4.diatonic, "bass"), 10);
}

/* ---- 4. note values ---------------------------------------------------- */

function checkValues() {
  console.log("== 4. note values");
  const v = (n) => staff.noteValue(n);
  eq("one step is a sixteenth", [v(1).name, v(1).flags, v(1).filled],
     ["1/16", 2, true]);
  eq("two steps an eighth", [v(2).name, v(2).flags], ["1/8", 1]);
  eq("three a dotted eighth", [v(3).name, v(3).dots, v(3).exact],
     ["1/8", 1, true]);
  eq("four a quarter", [v(4).name, v(4).filled, v(4).flags],
     ["1/4", true, 0]);
  eq("six a dotted quarter", [v(6).name, v(6).dots], ["1/4", 1]);
  eq("eight a half", [v(8).name, v(8).filled, v(8).stem],
     ["1/2", false, true]);
  eq("twelve a dotted half", [v(12).name, v(12).dots], ["1/2", 1]);
  eq("sixteen a whole, with no stem",
     [v(16).name, v(16).stem, v(16).filled], ["whole", false, false]);
  check("a length that is no drawn value still draws one and says so",
        v(5).name === "1/4" && v(5).exact === false);
  check("a length past a whole is a whole and says it is not exact",
        v(32).name === "whole" && v(32).exact === false);
}

/* ---- 5. the octave marks ----------------------------------------------- */

function checkMarks() {
  console.log("== 5. the octave marks");
  const at = (n, key) => staff.octaveMark(staff.spell(n, key || 0).diatonic,
                                          staff.clefFor(n));
  eq("a note inside the treble staff has no mark", at(52), { mark: null, shift: 0 });
  eq("C6 is 8va", at(60), { mark: "8va", shift: 1 });
  eq("B6 is still 8va", at(71), { mark: "8va", shift: 1 });
  eq("C7 is 15ma", at(72), { mark: "15ma", shift: 2 });
  eq("B7 is 15ma", at(83), { mark: "15ma", shift: 2 });
  eq("C2 is low, but not low enough for 8vb", at(12), { mark: null, shift: 0 });
  eq("G1 in the bass is 8vb", at(7), { mark: "8vb", shift: -1 });
  eq("C1 is 15mb", at(0), { mark: "15mb", shift: -2 });
  /* Each of the four labels is reachable in the engine's own range. */
  const seen = {};
  for (let n = seq.NOTE_MIN; n <= seq.NOTE_MAX; n++) {
    const m = at(n);
    if (m.mark) seen[m.mark] = true;
  }
  eq("the engine's range reaches every octave mark",
     Object.keys(seen).sort(), ["15ma", "15mb", "8va", "8vb"]);
  check("a natural sign is reachable where the key alters the letter",
        staff.spell(41, 7).printed === "n");
}

/* ---- 6. the layout reads the song -------------------------------------- */

function songWith(puts, opts) {
  const song = seq.newSong((opts && opts.steps) || 16);
  song.key = (opts && opts.key) || 0;
  for (const p of puts)
    song.patterns[0].channels[p[0]][p[1]] =
      { note: p[2], instrument: p[3] === undefined ? 0 : p[3],
        length: p[4] === undefined ? 1 : p[4] };
  return song;
}

function checkLayout() {
  console.log("== 6. the layout");
  const deep = (v) => JSON.parse(JSON.stringify(v));
  const song = songWith([
    [0, 0, 36, 0, 2],      /* C4 quarter? no: 2 steps */
    [0, 4, 72, 0, 4],      /* C7 - 15ma */
    [3, 8, 0, 1, 4],       /* C1 - 15mb */
    [4, 12, 60, 4, 1]      /* a drum */
  ]);
  const before = deep(song);
  const lay = staff.layout(song);
  eq("one bar per order entry", lay.bars.length, song.order.length);
  eq("the bar names the pattern it reads", lay.bars[0].name, "A");
  eq("every cell of every channel is a note", lay.notes.length, 4);
  eq("the notes are in time order",
     lay.notes.map((n) => n.step).join(","), "0,4,8,12");
  eq("each note keeps its channel and its length",
     [lay.notes[0].channel, lay.notes[0].length].join(","), "0,2");
  eq("a two-step note is an eighth",
     [lay.notes[0].value.name, lay.notes[0].value.flags].join(","), "1/8,1");
  eq("C4 on the treble clef", [lay.notes[0].clef, lay.notes[0].staffStep].join(","),
     "treble,-2");
  eq("C7 is drawn 15ma and shifted two octaves down",
     [lay.notes[1].mark, lay.notes[1].markShift,
      lay.notes[1].shifted - lay.notes[1].diatonic], ["15ma", 2, -14]);
  eq("C1 is drawn 15mb and shifted two octaves up",
     [lay.notes[2].mark, lay.notes[2].markShift,
      lay.notes[2].shifted - lay.notes[2].diatonic], ["15mb", -2, 14]);
  eq("the noise channel keeps its instrument", lay.notes[3].instrument, 4);
  eq("the layout changes nothing in the song", deep(song), before);

  /* loco: a shifted run returns to the written octave and says so. */
  const run = songWith([
    [0, 0, 72, 0, 1],      /* C7: 15ma */
    [0, 4, 74, 0, 1],      /* D7: still 15ma, no new mark printed */
    [0, 8, 40, 0, 1]       /* E4: back, so loco */
  ]);
  const runLay = staff.layout(run);
  eq("the runs marks", runLay.notes.map((n) => n.mark || "").join(","),
     "15ma,15ma,");
  eq("loco is written once, where the written octave returns",
     runLay.notes.map((n) => n.loco).join(","), "false,false,true");

  /* Marks restart at every bar rather than running across the bar line. */
  const two = songWith([[0, 0, 72, 0, 1], [0, 4, 40, 0, 1]]);
  two.order = [0, 0];
  const tl = staff.layout(two);
  eq("a mark restarts in the next bar (its first note is 15ma again)",
     tl.notes.map((n) => n.order + ":" + (n.mark || (n.loco ? "loco" : "-")))
       .join(","), "0:15ma,0:loco,1:15ma,1:loco");

  /* The demo song the panel opens with lays out whole. */
  const demo = staff.layout(seq.demoSong());
  check("the demo song's 20 notes all lay out",
        demo.notes.length === 20 && demo.notes.every((n) => n.value && n.clef));
  check("the demo uses both clefs",
        demo.notes.some((n) => n.clef === "bass") &&
        demo.notes.some((n) => n.clef === "treble"));
}

function main() {
  checkKeys();
  checkSpelling();
  checkClefs();
  checkValues();
  checkMarks();
  checkLayout();
  if (failures === 0) {
    console.log("PASS: pce-staff.js spells a song for its key, places it on " +
                "the clef the pitch belongs to, values its notes and marks " +
                "the octaves — without changing the song");
    return 0;
  }
  console.log(`FAIL: ${failures} check(s) failed`);
  return 1;
}

process.exitCode = main();
