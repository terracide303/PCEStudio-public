/*
 * pce-staff.js — the SEQUENCER's staff view model (card #95, part 2).
 *
 * The card: the song the step grid edits, read as music — a treble and a
 * bass clef, note values, the sharps, flats and naturals the key asks for,
 * and the octave marks 15mb / 8vb / loco / 8va / 15ma.  This file answers
 * everything about the notation; renderer/studio-panel-sequencer.js draws it
 * and binds it.  The song itself stays renderer/pce-seq.js's: `layout()`
 * reads a song and returns notes, never a second song.
 *
 * The four decisions this file makes, each one the card asks for and each
 * spelled out in docs/SEQ.md §11:
 *
 *  1. SPELLING.  A song stores a chromatic engine note (0..83, C1..B7) and a
 *     key (0..11, its major tonic).  The staff needs a letter and an
 *     accidental.  A note that is a degree of the key's major scale takes
 *     that degree's letter and the key signature covers its accidental.  A
 *     chromatic note takes the letter whose natural pitch is a semitone away
 *     (a sharp or a flat); when both letters fit, a sharp key spells it
 *     sharp and a flat key spells it flat — the same split pce-seq.js's
 *     noteName() already uses for the grid.  A natural sign is written when
 *     the note is the natural of a letter the key signature alters (key G,
 *     the note F natural).
 *
 *  2. CLEF.  Bass below C4 (middle C, engine note 36), treble from C4 up.
 *     Middle C therefore sits on the first ledger line above the bass staff
 *     and the first below the treble, which is where a grand staff puts it.
 *
 *  3. NOTE VALUES.  A step is a sixteenth (docs/SEQ.md §2), so a length in
 *     steps is a note value: 1 = 1/16, 2 = 1/8, 3 = dotted 1/8, 4 = 1/4,
 *     6 = dotted 1/4, 8 = 1/2, 12 = dotted 1/2, 16 = whole.  A length that is
 *     not an exact value still draws the value below it, and `exact` says so;
 *     the grid's fill is the same number.
 *
 *  4. OCTAVE MARKS.  A note far enough outside its staff is drawn shifted
 *     and labelled: above the treble 8va from C6 and 15ma from C7, below the
 *     bass 8vb from G1 and down and 15mb from C1 (diatonic positions 42/49
 *     and 11/7).  `loco` is written at the first note that returns to the
 *     written octave after a shifted run.  The mark is per note (a run of
 *     shifted notes repeats none), and it restarts at every bar.
 *
 * Dual use: CommonJS module (tests/check-staff.js) and a browser global
 * (renderer/studio.html), like pce-seq.js.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./pce-seq.js"));
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.staff = factory(root.PCEStudio.seq);
  }
})(typeof self !== "undefined" ? self : this, function (seq) {
  "use strict";

  /* The seven letters, the natural semitone of each, and the letter each key
   * name starts on (KEY_NAMES' tonic: C Db D Eb E F F# G Ab A Bb B). */
  var LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
  var NATURAL = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  var TONIC_LETTER = ["C", "D", "D", "E", "E", "F", "F", "G", "A", "A", "B", "B"];

  /* The conventional order of the accidentals in a key signature: sharps
   * F C G D A E B, flats B E A D G C F.  docs/SEQ.md §11. */
  var SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];
  var FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"];

  /* The staff each clef is drawn against, as a diatonic index (see
   * diatonic()): the bottom line of the treble staff is E4 and of the bass
   * staff G2.  Each line is two diatonic steps, each space one. */
  var CLEF_BOTTOM = { treble: 30 /* E4 */, bass: 18 /* G2 */ };

  /* The octave marks' thresholds, as diatonic indexes.  Treble: C6 and C7;
   * bass: G1 and down for 8vb, C1 and down for 15mb.  docs/SEQ.md §11. */
  var TREBLE_8VA = 42;      /* C6 */
  var TREBLE_15MA = 49;     /* C7 */
  var BASS_8VB = 11;        /* G1 */
  var BASS_15MB = 7;        /* C1 */

  /* 1/16 .. whole.  baseSteps is the length in steps the value itself is. */
  var VALUES = [
    { base: 1, name: "1/16", filled: true, stem: true, flags: 2 },
    { base: 2, name: "1/8", filled: true, stem: true, flags: 1 },
    { base: 4, name: "1/4", filled: true, stem: true, flags: 0 },
    { base: 8, name: "1/2", filled: false, stem: true, flags: 0 },
    { base: 16, name: "whole", filled: false, stem: false, flags: 0 }
  ];

  function refuse(code, message) {
    var e = new Error(message);
    e.code = code;
    throw e;
  }

  function mod12(v) { return ((v % 12) + 12) % 12; }

  /* ---- pitches ---------------------------------------------------------- */

  /* A note's absolute diatonic index, C1 = 7: octave * 7 + the letter's place
   * in C D E F G A B.  C4 (middle C) is 28; the treble staff's bottom line
   * E4 is 30 and the bass staff's G2 is 18. */
  function diatonic(letter, octave) {
    var at = LETTERS.indexOf(letter);
    if (at < 0) refuse("staff-letter", "no letter " + letter);
    return octave * 7 + at;
  }

  /* The key signature of one of the twelve major keys: the seven degrees in
   * order from the tonic, the letter each is written on, its pitch class and
   * the accidental the signature carries (# , b or none). */
  function keySignature(key) {
    key = mod12(key || 0);
    var start = LETTERS.indexOf(TONIC_LETTER[key]);
    var degrees = [];
    var kind = "none";
    for (var d = 0; d < 7; d++) {
      var letter = LETTERS[(start + d) % 7];
      var pc = mod12(key + seq.MAJOR[d]);
      var diff = mod12(pc - NATURAL[letter]);
      var acc = diff === 0 ? "" : (diff === 1 ? "#" : (diff === 11 ? "b" : "!"));
      if (acc === "!") refuse("staff-key", "key " + key + " is not a major key");
      if (acc === "#") kind = "sharp";
      else if (acc === "b" && kind !== "sharp") kind = "flat";
      degrees.push({ degree: d, letter: letter, pitchClass: pc,
                     accidental: acc });
    }
    /* The signature's glyphs, in the conventional order. */
    var order = kind === "sharp" ? SHARP_ORDER
              : kind === "flat" ? FLAT_ORDER : [];
    var marks = [];
    for (var i = 0; i < order.length; i++) {
      for (var j = 0; j < degrees.length; j++) {
        if (degrees[j].letter === order[i] && degrees[j].accidental !== "")
          marks.push({ letter: degrees[j].letter,
                       accidental: degrees[j].accidental,
                       degree: degrees[j].degree });
      }
    }
    return { key: key, kind: kind, degrees: degrees, marks: marks };
  }

  function signatureFor(sig, letter) {
    for (var i = 0; i < sig.degrees.length; i++)
      if (sig.degrees[i].letter === letter) return sig.degrees[i].accidental;
    return "";
  }

  /* A chromatic engine note, spelled for a key.
   *
   *   { letter, accidental, octave, printed, diatonic, pitchClass, engine }
   *
   * letter/accidental are the note's spelling; printed is the sign the staff
   * draws ("", "#", "b" or "n") — empty when the key signature already
   * carries it. */
  function spell(n, key) {
    if (typeof n !== "number" || n % 1 !== 0)
      refuse("staff-note", "a note must be an integer engine note");
    var sig = keySignature(key);
    var pc = mod12(n);
    var candidates = [];
    for (var d = 0; d < 7; d++) {
      var letter = sig.degrees[d].letter;
      var diff = mod12(pc - NATURAL[letter]);
      if (diff === 0) candidates.push({ letter: letter, acc: "", delta: 0 });
      else if (diff === 1) candidates.push({ letter: letter, acc: "#", delta: 1 });
      else if (diff === 11) candidates.push({ letter: letter, acc: "b", delta: -1 });
    }
    if (!candidates.length)
      refuse("staff-note", "note " + n + " has no spelling in key " + key);

    /* 1. a degree of the key's scale */
    var chosen = null;
    for (var i = 0; i < candidates.length; i++)
      if (signatureFor(sig, candidates[i].letter) === candidates[i].acc) {
        chosen = candidates[i];
        break;
      }
    /* 2. a natural note in a key that alters its letter (the natural sign) */
    if (!chosen)
      for (var j = 0; j < candidates.length; j++)
        if (candidates[j].acc === "" &&
            signatureFor(sig, candidates[j].letter) !== "") {
          chosen = candidates[j];
          break;
        }
    /* 3. the key's own direction: sharps in a sharp key, flats in a flat key */
    if (!chosen) {
      var want = sig.kind === "flat" ? -1 : 1;
      for (var k = 0; k < candidates.length; k++)
        if (candidates[k].delta === want) { chosen = candidates[k]; break; }
    }
    /* 4. anything that fits (a key with a flat signature and a raised note) */
    if (!chosen) chosen = candidates[0];

    var sigAcc = signatureFor(sig, chosen.letter);
    var printed;
    if (chosen.acc === "") printed = sigAcc === "" ? "" : "n";
    else printed = chosen.acc === sigAcc ? "" : chosen.acc;

    var natural = n - chosen.delta;          /* the letter's own semitone */
    var octave = Math.floor(natural / 12) + 1;
    return { letter: chosen.letter, accidental: chosen.acc, octave: octave,
             printed: printed, diatonic: diatonic(chosen.letter, octave),
             pitchClass: pc, engine: n };
  }

  /* Bass below middle C (engine 36), treble from it up. */
  function clefFor(n) { return n < 36 ? "bass" : "treble"; }

  /* The position of a note on its clef's staff: 0 is the clef's bottom line,
   * 1 the space above it, 2 the second line, and so on (negative below). */
  function staffStep(diatonicIndex, clef) {
    return diatonicIndex - CLEF_BOTTOM[clef === "bass" ? "bass" : "treble"];
  }

  /* The octave mark a note needs on its clef, and how many octaves the staff
   * shifts it by (positive: written an octave up, so drawn an octave lower). */
  function octaveMark(diatonicIndex, clef) {
    if (clef === "bass") {
      if (diatonicIndex <= BASS_15MB) return { mark: "15mb", shift: -2 };
      if (diatonicIndex <= BASS_8VB) return { mark: "8vb", shift: -1 };
    } else {
      if (diatonicIndex >= TREBLE_15MA) return { mark: "15ma", shift: 2 };
      if (diatonicIndex >= TREBLE_8VA) return { mark: "8va", shift: 1 };
    }
    return { mark: null, shift: 0 };
  }

  /* A length in steps as a note value. */
  function noteValue(length) {
    var base = 1;
    while (base * 2 <= length) base *= 2;
    var capped = base > 16;
    if (capped) base = 16;
    var dots = 0;
    if (length === base * 1.5) dots = 1;
    else if (length === base * 1.75) dots = 2;
    else if (length === base * 1.875) dots = 3;
    var v = VALUES[VALUES.length - 1];
    for (var i = 0; i < VALUES.length; i++)
      if (VALUES[i].base === base) { v = VALUES[i]; break; }
    /* A whole note is worth the whole bar only when the bar is 16 steps;
     * `exact` says whether the length is one of the drawn values. */
    var exact = !capped && (length === base ||
                            (dots === 1 && length === base * 1.5) ||
                            (dots === 2 && length === base * 1.75) ||
                            (dots === 3 && length === base * 1.875));
    return { name: v.name, baseSteps: base, dots: dots, filled: v.filled,
             stem: v.stem, flags: v.flags, exact: exact, length: length };
  }

  /* The whole song as the staff draws it: one bar per order entry, every
   * channel's notes on the bar, each note spelled, positioned and valued.
   *
   *   { key, keySignature, bars: [{order, pattern, name, steps}],
   *     notes: [ { order, step, channel, note, instrument, length,
   *                letter, accidental(printed), octave, diatonic, clef,
   *                staffStep, mark, markShift, shifted, loco, value } ] }
   */
  function layout(song) {
    seq.check(song);
    var sig = keySignature(song.key);
    var bars = [];
    var notes = [];
    for (var o = 0; o < song.order.length; o++) {
      var pi = song.order[o];
      var pat = song.patterns[pi];
      bars.push({ order: o, pattern: pi, name: pat.name, steps: song.steps });
      var here = [];
      for (var ch = 0; ch < seq.CHANNELS; ch++)
        for (var step = 0; step < song.steps; step++) {
          var cell = pat.channels[ch][step];
          if (cell)
            here.push({ order: o, step: step, channel: ch, note: cell.note,
                        instrument: cell.instrument, length: cell.length });
        }
      here.sort(function (a, b) {
        return a.step - b.step || a.channel - b.channel;
      });
      /* An octave mark belongs to a voice, not to the bar's note list: two
       * channels sounding at one step can be in different octaves.  Each
       * channel's run is followed on its own, and it restarts at every bar. */
      var shift = [];
      for (var c = 0; c < seq.CHANNELS; c++) shift.push(0);
      for (var i = 0; i < here.length; i++) {
        var note = here[i];
        var sp = spell(note.note, song.key);
        var clef = clefFor(note.note);
        var m = octaveMark(sp.diatonic, clef);
        note.letter = sp.letter;
        note.accidental = sp.printed;
        note.octave = sp.octave;
        note.diatonic = sp.diatonic;
        note.clef = clef;
        note.staffStep = staffStep(sp.diatonic, clef);
        note.mark = m.mark;
        note.markShift = m.shift;
        note.shifted = sp.diatonic - m.shift * 7;
        note.loco = m.shift === 0 && shift[note.channel] !== 0;
        note.value = noteValue(note.length);
        shift[note.channel] = m.shift;
        notes.push(note);
      }
    }
    return { key: song.key, keySignature: sig, bars: bars, notes: notes };
  }

  return {
    LETTERS: LETTERS,
    SHARP_ORDER: SHARP_ORDER,
    FLAT_ORDER: FLAT_ORDER,
    CLEF_BOTTOM: CLEF_BOTTOM,
    TREBLE_8VA: TREBLE_8VA,
    TREBLE_15MA: TREBLE_15MA,
    BASS_8VB: BASS_8VB,
    BASS_15MB: BASS_15MB,

    refuse: refuse,
    diatonic: diatonic,
    keySignature: keySignature,
    spell: spell,
    clefFor: clefFor,
    staffStep: staffStep,
    octaveMark: octaveMark,
    noteValue: noteValue,
    layout: layout
  };
});
