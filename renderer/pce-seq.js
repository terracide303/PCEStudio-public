/*
 * pce-seq.js — the studio's step sequencer model (card #94, part 1).
 *
 * ppu.toys' SEQUENCER is the working example of the shape: a song of
 * patterns, each a grid of steps, with Tempo, Steps, Swing and Key, a palette
 * of instruments, note lengths, and a "voices" bar per step.  This is that
 * shape for the HuC6280 PSG, in the PSG's own terms, so there is no second
 * song format between the grid and the console:
 *
 *   - a SONG is a list of PATTERNS; a pattern is `steps` columns of six
 *     channels.  A cell is one note: {note, instrument, length}.
 *   - `note` is the note number pce-song.js's engine counts: 0 is C1 and 36
 *     is C4 (MIDI note = engine note + 24), the range pce-song's checkSong
 *     accepts (0..83, C1..B7).
 *   - `length` is in steps.  A note sounds until its length ends or the next
 *     note on that channel starts, whichever is first — exactly the DMF row a
 *     tracker would hold, then a note-cut row.
 *   - an INSTRUMENT is a PSG voice: a 32-step 5-bit wave (#62's editor,
 *     renderer/pce-wave.js's PRESETS) plus a DRIVER volume envelope (the
 *     sequence of R4 levels pce-song.js writes per VBlank), or a NOISE drum
 *     (channels 5-6 only, R7; the envelope is still the driver's R4).
 *   - TEMPO is 16th steps: ticks = round(900 / BPM) VBlanks per step, the
 *     DefleMask/HuTrack rule (60 fps, four steps a beat).  SWING lengthens the
 *     on-beat step and shortens the off-beat one by the same amount, which is
 *     DMF's two speeds: pce-song.js alternates tick1 and tick2 every row.
 *   - KEY is the spelling of the note names and the major-scale highlight on
 *     the grid.  It is a view of the same notes, not a transposition, so it
 *     changes no PSG write (the staff view that needs it is #95).
 *
 * compile(song) is the DMF-shaped song object pce-song.js's checkSong() and
 * createPlayer() take: the same object renderer/pce-dmf.js hands them for a
 * .dmf file, with every pattern expanded into its order slot the way a DMF
 * stores one copy per order position.  The wave channels then play through
 * pce-song.js unchanged.
 *
 * Noise drums are the one thing pce-song.js deliberately does not do (its
 * header: "effect columns ... are not in this player yet", and HuTrack's noise
 * is effect 0F on channels 5-6).  So the drum's VOLUME still comes from
 * pce-song.js — the compiled instrument carries the drum's envelope and the
 * engine writes R4 for it every frame — and this file adds only the two writes
 * the engine's .platFX.Noise makes: R0 = channel, R7 = $80 | NF when the drum
 * starts, and R0 = channel, R7 = $00 when it stops (vendor/hutrack,
 * HuTrack_parser.asm .platFX.Noise / _htk.WSG.noise).  docs/SEQ.md says which
 * half is which and what part 3 (#96) owes: the DMF export must encode that
 * same state change as effect 0F.
 *
 * Refusals carry a machine-readable `code`, the convention pce-editor.js,
 * pce-wave.js and pce-mix.js share:
 *   seq-tempo       BPM outside 30..300
 *   seq-swing       swing outside 0..60 (percent of a step)
 *   seq-key         key outside 0..11
 *   seq-steps       steps outside 1..64
 *   seq-pattern     a pattern index that is not in the song
 *   seq-order       an order that names a missing pattern, or 0..64 entries
 *   seq-channel     a channel outside 0..5 (the PSG has six voices)
 *   seq-note        a note outside 0..83 (pce-song's engine note)
 *   seq-length      a note length outside 1..steps
 *   seq-instrument  an instrument index that is not in the song
 *   seq-wave        a wave step outside 0..31, or a wave that is not 32 steps
 *   seq-env         an envelope size 1..32, a level 0..31 or a bad loop
 *   seq-noise       a noise frequency outside 0..31
 *   seq-voice       a noise drum on a channel without the noise generator
 *                   (only channels 5 and 6, 0-based 4 and 5) — the 6-voice
 *                   limit this card shows
 *   seq-json        song.json does not parse, or is not one of ours
 *
 * Dual use: CommonJS module in Node (tests/check-sequencer.js) and a browser
 * global (renderer/studio.html) via a UMD-style wrapper, like pce-song.js.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./pce-song.js"),
                             require("./pce-psg.js"),
                             require("./pce-wave.js"));
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.seq = factory(root.PCEStudio.song, root.PCEStudio.psg,
                                 root.PCEStudio.wave);
  }
})(typeof self !== "undefined" ? self : this, function (player, psg, wave) {
  "use strict";

  var CHANNELS = 6;                     /* the HuC6280 PSG's voices */
  var VOICE_LIMIT = 6;                  /* the same limit, as the panel shows it */
  var NOISE_CHANNELS = [4, 5];          /* only these have the generator */
  var STEPS_MIN = 1;
  var STEPS_MAX = 64;
  var TEMPO_MIN = 30;
  var TEMPO_MAX = 300;
  var SWING_MAX = 60;                   /* percent of a step */
  var PATTERNS_MAX = 8;                 /* A..H */
  var ORDER_MAX = 64;
  var INSTRUMENTS_MAX = 16;
  var NOTE_MIN = 0;                     /* C1 */
  var NOTE_MAX = 83;                    /* B7 */
  var ENV_MAX = 32;
  var WAVE_STEPS = 32;
  var WAVE_MAX = 31;
  var NF_MAX = 0x1F;
  var VERSION = 1;
  var PATTERN_NAMES = ["A", "B", "C", "D", "E", "F", "G", "H"];

  /* The names are the same 12 pitch classes pce-mix.js uses, in the two
   * spellings a key signature chooses between (a panel convention: the PSG
   * has no spelling, and #95's staff is where it becomes a decision). */
  var SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#",
                     "G", "G#", "A", "A#", "B"];
  var FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb",
                    "G", "Ab", "A", "Bb", "B"];
  var KEY_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#",
                   "G", "Ab", "A", "Bb", "B"];
  /* The keys whose notes are spelled with sharps; the rest with flats. */
  var SHARP_KEYS = [0, 2, 4, 6, 7, 9, 11];
  var MAJOR = [0, 2, 4, 5, 7, 9, 11];

  function refuse(code, message) {
    var e = new Error(message);
    e.code = code;
    throw e;
  }

  function isInt(v) { return typeof v === "number" && isFinite(v) && v % 1 === 0; }

  function checkInt(v, lo, hi, code, what) {
    if (!isInt(v) || v < lo || v > hi)
      refuse(code, what + " must be an integer " + lo + ".." + hi +
             " (got " + v + ")");
  }

  /* ---- notes ------------------------------------------------------------ */

  /* The engine's note number (pce-song.js: engineNote = octave*12 +
   * semitone, and periodFor puts engine note 0..11 at C1). */
  function noteName(n, key) {
    var names = SHARP_KEYS.indexOf(key || 0) >= 0 ? SHARP_NAMES : FLAT_NAMES;
    return names[n % 12] + (Math.floor(n / 12) + 1);
  }

  /* "C#4", "Db4" or a number -> the engine note.  A name alone is octave 4,
   * the grid's default (C4 = 36). */
  function noteIndex(name) {
    if (typeof name === "number") return name;
    var m = /^([A-Ga-g])([#b]?)(-?\d+)?$/.exec(String(name).trim());
    if (!m) return null;
    var base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()];
    if (m[2] === "#") base++;
    else if (m[2] === "b") base--;
    var octave = m[3] === undefined ? 4 : Number(m[3]);
    return (octave - 1) * 12 + ((base + 12) % 12);
  }

  function inScale(n, key) {
    return MAJOR.indexOf(((n % 12) - (key || 0) + 12) % 12) >= 0;
  }

  function isBlack(n) { return SHARP_NAMES[n % 12].indexOf("#") >= 0; }

  /* ---- defaults --------------------------------------------------------- */

  function emptyEnv(size, data, loop) {
    return { size: size, data: data.slice(), loop: loop === undefined ? 0xff
                                                                     : loop };
  }

  function waveInstrument(name, preset, env) {
    return { name: name, kind: "wave", wave: wave.PRESETS[preset].slice(),
             env: env };
  }

  function noiseInstrument(name, nf, env) {
    return { name: name, kind: "noise", nf: nf, env: env };
  }

  /* ppu.toys' palette (keys, guitar, bass, strings, bell, harp, drums,
   * cymbals) in the PSG's terms: four wave voices and two noise drums.  The
   * envelopes are short driver sequences — one entry per VBlank — because the
   * PSG has no hardware envelope (docs/PSG.md). */
  function defaultInstruments() {
    return [
      waveInstrument("lead", "pulse", emptyEnv(1, [31])),
      waveInstrument("bass", "square", emptyEnv(3, [31, 28, 24], 2)),
      waveInstrument("bell", "sine", emptyEnv(6, [31, 27, 21, 13, 6, 0])),
      waveInstrument("strings", "saw", emptyEnv(3, [20, 26, 31], 2)),
      noiseInstrument("kick", 28, emptyEnv(5, [31, 26, 15, 5, 0])),
      noiseInstrument("snare", 14, emptyEnv(4, [31, 23, 11, 0]))
    ];
  }

  function newPattern(index) {
    var channels = [];
    for (var c = 0; c < CHANNELS; c++) channels.push(new Array(16).fill(null));
    return { name: PATTERN_NAMES[index || 0], channels: channels };
  }

  function newSong(steps) {
    var song = {
      version: VERSION,
      name: "Untitled",
      tempo: 150,
      swing: 0,
      key: 0,
      steps: steps || 16,
      patterns: [newPattern(0)],
      order: [0],
      instruments: defaultInstruments()
    };
    if (song.steps !== 16) setSteps(song, song.steps);
    return song;
  }

  /* A small two-bar riff so an empty studio's SEQUENCER is a working song
   * rather than an empty grid (the AUDIO panel's demoSound() precedent). */
  function demoSong() {
    var song = newSong(16);
    var p = song.patterns[0];
    function put(ch, step, note, instrument, length) {
      p.channels[ch][step] = { note: note, instrument: instrument,
                               length: length === undefined ? 1 : length };
    }
    var lead = ["C4", null, "E4", null, "G4", null, "C5", null,
                "G4", null, "E4", null, "C4", null, "G3", null];
    for (var s = 0; s < lead.length; s++)
      if (lead[s] !== null) put(0, s, noteIndex(lead[s]), 0, 2);
    put(1, 0, noteIndex("C3"), 1, 6);
    put(1, 8, noteIndex("G2"), 1, 6);
    put(2, 0, noteIndex("C5"), 2, 2);
    put(2, 8, noteIndex("G5"), 2, 2);
    put(3, 0, noteIndex("E4"), 3, 4);
    put(3, 8, noteIndex("D4"), 3, 4);
    [0, 4, 8, 12].forEach(function (step) {
      put(4, step, noteIndex("C4"), 4, 1);
    });
    [4, 12].forEach(function (step) {
      put(5, step, noteIndex("C4"), 5, 1);
    });
    return song;
  }

  /* ---- validation ------------------------------------------------------- */

  function checkEnv(env, where) {
    if (!env || !isInt(env.size) || env.size < 1 || env.size > ENV_MAX)
      refuse("seq-env", where + " envelope size must be 1.." + ENV_MAX);
    if (!Array.isArray(env.data) || env.data.length !== env.size)
      refuse("seq-env", where + " envelope needs exactly " + env.size +
             " levels");
    for (var i = 0; i < env.size; i++)
      checkInt(env.data[i], 0, 31, "seq-env",
               where + " envelope level " + i);
    if (env.loop !== 0xff)
      checkInt(env.loop, 0, env.size - 1, "seq-env",
               where + " envelope loop");
  }

  function checkInstrument(ins, i) {
    var where = "instrument " + i;
    if (!ins || typeof ins.name !== "string")
      refuse("seq-instrument", where + " needs a name");
    if (ins.kind !== "wave" && ins.kind !== "noise")
      refuse("seq-instrument", where + " is neither a wave nor a noise drum");
    checkEnv(ins.env, where);
    if (ins.kind === "wave") {
      if (!Array.isArray(ins.wave) || ins.wave.length !== WAVE_STEPS)
        refuse("seq-wave", where + " needs a wave of " + WAVE_STEPS +
               " steps");
      for (var s = 0; s < WAVE_STEPS; s++)
        checkInt(ins.wave[s], 0, WAVE_MAX, "seq-wave",
                 where + " wave step " + s);
    } else {
      checkInt(ins.nf, 0, NF_MAX, "seq-noise", where + " noise frequency");
    }
  }

  function checkCell(cell, ch, step, song) {
    var where = "channel " + (ch + 1) + " step " + step;
    checkInt(cell.note, NOTE_MIN, NOTE_MAX, "seq-note", where + " note");
    checkInt(cell.instrument, 0, song.instruments.length - 1,
             "seq-instrument", where + " instrument");
    checkInt(cell.length, 1, song.steps, "seq-length", where + " length");
    var ins = song.instruments[cell.instrument];
    if (ins.kind === "noise" && NOISE_CHANNELS.indexOf(ch) < 0)
      refuse("seq-voice", where + ": a noise drum needs channel 5 or 6 " +
             "(only those two have the noise generator)");
  }

  function check(song) {
    if (!song || typeof song !== "object")
      refuse("seq-json", "a song is an object");
    checkInt(song.tempo, TEMPO_MIN, TEMPO_MAX, "seq-tempo", "tempo (BPM)");
    checkInt(song.swing, 0, SWING_MAX, "seq-swing", "swing (percent)");
    checkInt(song.key, 0, 11, "seq-key", "key");
    checkInt(song.steps, STEPS_MIN, STEPS_MAX, "seq-steps", "steps");
    if (!Array.isArray(song.patterns) || !song.patterns.length ||
        song.patterns.length > PATTERNS_MAX)
      refuse("seq-pattern", "a song needs 1.." + PATTERNS_MAX + " patterns");
    if (!Array.isArray(song.instruments) || !song.instruments.length ||
        song.instruments.length > INSTRUMENTS_MAX)
      refuse("seq-instrument", "a song needs 1.." + INSTRUMENTS_MAX +
             " instruments");
    for (var i = 0; i < song.instruments.length; i++)
      checkInstrument(song.instruments[i], i);
    if (!Array.isArray(song.order) || !song.order.length ||
        song.order.length > ORDER_MAX)
      refuse("seq-order", "the order needs 1.." + ORDER_MAX + " entries");
    for (var o = 0; o < song.order.length; o++) {
      checkInt(song.order[o], 0, song.patterns.length - 1, "seq-order",
               "order entry " + o);
    }
    for (var p = 0; p < song.patterns.length; p++) {
      var pat = song.patterns[p];
      if (!pat || !Array.isArray(pat.channels) ||
          pat.channels.length !== CHANNELS)
        refuse("seq-pattern", "pattern " + p + " needs " + CHANNELS +
               " channels");
      for (var ch = 0; ch < CHANNELS; ch++) {
        if (!Array.isArray(pat.channels[ch]) ||
            pat.channels[ch].length !== song.steps)
          refuse("seq-steps", "pattern " + p + " channel " + (ch + 1) +
                 " has " + (pat.channels[ch] ? pat.channels[ch].length : 0) +
                 " steps, expected " + song.steps);
        for (var s = 0; s < song.steps; s++) {
          var cell = pat.channels[ch][s];
          if (cell) checkCell(cell, ch, s, song);
        }
      }
    }
    return true;
  }

  /* ---- editing ---------------------------------------------------------- */

  function setTempo(song, bpm) {
    checkInt(bpm, TEMPO_MIN, TEMPO_MAX, "seq-tempo", "tempo (BPM)");
    song.tempo = bpm;
    return song;
  }

  function setSwing(song, percent) {
    checkInt(percent, 0, SWING_MAX, "seq-swing", "swing (percent)");
    song.swing = percent;
    return song;
  }

  function setKey(song, key) {
    checkInt(key, 0, 11, "seq-key", "key");
    song.key = key;
    return song;
  }

  function setSteps(song, steps) {
    checkInt(steps, STEPS_MIN, STEPS_MAX, "seq-steps", "steps");
    song.steps = steps;
    for (var p = 0; p < song.patterns.length; p++) {
      for (var ch = 0; ch < CHANNELS; ch++) {
        var cells = song.patterns[p].channels[ch];
        while (cells.length < steps) cells.push(null);
        cells.length = steps;
        for (var s = 0; s < steps; s++) {
          var cell = cells[s];
          if (cell && cell.length > steps - s) cell.length = steps - s;
        }
      }
    }
    return song;
  }

  function setCell(song, pattern, ch, step, cell) {
    checkInt(pattern, 0, song.patterns.length - 1, "seq-pattern",
             "pattern index");
    checkInt(ch, 0, CHANNELS - 1, "seq-channel", "channel");
    checkInt(step, 0, song.steps - 1, "seq-steps", "step");
    checkCell(cell, ch, step, song);
    song.patterns[pattern].channels[ch][step] = {
      note: cell.note, instrument: cell.instrument, length: cell.length
    };
    return song;
  }

  function eraseCell(song, pattern, ch, step) {
    checkInt(pattern, 0, song.patterns.length - 1, "seq-pattern",
             "pattern index");
    checkInt(ch, 0, CHANNELS - 1, "seq-channel", "channel");
    checkInt(step, 0, song.steps - 1, "seq-steps", "step");
    song.patterns[pattern].channels[ch][step] = null;
    return song;
  }

  function addPattern(song) {
    if (song.patterns.length >= PATTERNS_MAX)
      refuse("seq-pattern", "a song holds " + PATTERNS_MAX + " patterns");
    var channels = [];
    for (var c = 0; c < CHANNELS; c++)
      channels.push(new Array(song.steps).fill(null));
    song.patterns.push({ name: PATTERN_NAMES[song.patterns.length],
                         channels: channels });
    return song.patterns.length - 1;
  }

  function setOrder(song, order) {
    if (!Array.isArray(order) || !order.length || order.length > ORDER_MAX)
      refuse("seq-order", "the order needs 1.." + ORDER_MAX + " entries");
    for (var i = 0; i < order.length; i++)
      checkInt(order[i], 0, song.patterns.length - 1, "seq-order",
               "order entry " + i);
    song.order = order.slice();
    return song;
  }

  /* "A,A,B" -> [0,0,1] for the panel's one-line order field. */
  function parseOrder(song, text) {
    var parts = String(text || "").split(/[\s,]+/).filter(Boolean);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var at = PATTERN_NAMES.indexOf(parts[i].toUpperCase());
      if (at < 0 || at >= song.patterns.length)
        refuse("seq-order", "\"" + parts[i] + "\" is not a pattern of this song");
      out.push(at);
    }
    return setOrder(song, out).order;
  }

  function orderText(song) {
    return song.order.map(function (i) {
      return song.patterns[i].name;
    }).join(",");
  }

  /* ---- timing ----------------------------------------------------------- */

  /* Sixteenth steps at 60 VBlanks a second: a beat is four steps, so a step
   * is 900 / BPM VBlanks (DefleMask/HuTrack's speed table). */
  function baseTicks(song) {
    return Math.max(1, Math.min(255, Math.round(900 / song.tempo)));
  }

  function timing(song) {
    check(song);
    var base = baseTicks(song);
    var d = Math.round(base * song.swing / 100);
    var tick1 = Math.max(1, Math.min(255, base + d));   /* on-beat step */
    var tick2 = Math.max(1, Math.min(255, base - d));   /* off-beat step */
    var rows = song.order.length * song.steps;

    /* pce-song.js's parser: the first row fires after tick2 (tickReload),
     * then the speed alternates tick1, tick2, tick1 ...  So the gap into row
     * i is tick1 for odd i and tick2 for even i, and row i is at:
     *   tick2 + tick1*ceil(i/2) + tick2*floor(i/2). */
    function rowFrame(i) {
      return tick2 + tick1 * Math.ceil(i / 2) + tick2 * Math.floor(i / 2);
    }

    return {
      base: base,
      tick1: tick1,
      tick2: tick2,
      rows: rows,
      rowFrame: rowFrame,
      framesPerPattern: rowFrame(song.steps),
      framesPerOrder: rowFrame(rows),
      bars: song.order.length,
      seconds: rowFrame(rows) / 60
    };
  }

  /* ---- compiling to the player's song object ---------------------------- */

  /* One copy per order position, as a DMF stores it (the reader builds
   * patterns[ch][order] sequentially and orderMatrix[ch][o] is the editor's
   * label; pce-song.js indexes patterns[ch] by that label). */
  function patternRows(song, patternIndex, ch) {
    var cells = song.patterns[patternIndex].channels[ch];
    var rows = [];
    var s, i;
    for (s = 0; s < song.steps; s++) {
      rows.push({ note: null, octave: 0, volume: null, effects: [],
                  instrument: null });
    }
    var onsets = [];
    for (s = 0; s < song.steps; s++) {
      var cell = cells[s];
      if (!cell) continue;
      onsets.push(s);
      rows[s].note = { semitone: cell.note % 12,
                       octave: Math.floor(cell.note / 12) };
      rows[s].instrument = cell.instrument;
    }
    /* A note ends at its length, at the next note on the channel, or at the
     * pattern's end — whichever comes first.  A note-cut row is only written
     * inside the pattern and only where no new note already replaces it. */
    for (i = 0; i < onsets.length; i++) {
      s = onsets[i];
      var cell = cells[s];
      var end = s + cell.length;
      if (i + 1 < onsets.length && onsets[i + 1] < end) end = onsets[i + 1];
      if (end >= song.steps) continue;
      if (rows[end].note) continue;         /* the next note starts there */
      rows[end].note = { cut: true };
    }
    return rows;
  }

  function compile(song) {
    check(song);
    var t = timing(song);
    var waves = [];
    var waveIndex = {};                     /* wave text -> its index */
    var instruments = [];
    var i, ch, o;

    for (i = 0; i < song.instruments.length; i++) {
      var ins = song.instruments[i];
      var wt = { size: 0, data: [], loop: 0xff };
      if (ins.kind === "wave") {
        var key = ins.wave.join(",");
        if (waveIndex[key] === undefined) {
          waveIndex[key] = waves.length;
          waves.push(ins.wave.slice());
        }
        wt = { size: 1, data: [waveIndex[key]], loop: 0xff };
      }
      instruments.push({
        name: ins.name,
        mode: 0,
        kind: ins.kind,
        nf: ins.kind === "noise" ? ins.nf : null,
        volumeEnv: { size: ins.env.size, data: ins.env.data.slice(),
                     loop: ins.env.loop },
        arpeggioEnv: { size: 0, data: [], loop: 0xff, mode: 0 },
        noiseEnv: { size: 0, data: [], loop: 0xff },
        wavetableEnv: wt
      });
    }

    var patterns = [];
    for (ch = 0; ch < CHANNELS; ch++) {
      patterns.push([]);
      for (o = 0; o < song.order.length; o++)
        patterns[ch].push(patternRows(song, song.order[o], ch));
    }
    var orderMatrix = [];
    for (ch = 0; ch < CHANNELS; ch++) {
      orderMatrix.push([]);
      for (o = 0; o < song.order.length; o++) orderMatrix[ch].push(o);
    }

    if (!waves.length) waves.push(new Array(WAVE_STEPS).fill(15));

    return {
      source: "sequencer",
      version: 27,             /* the DMF revision whose row shape this is */
      platform: 5,
      songName: song.name,
      timeBase: 1,
      tick1: t.tick1,
      tick2: t.tick2,
      frameMode: 1,            /* NTSC VBlank */
      customHz: 0,
      rowsPerPattern: song.steps,
      orderCount: song.order.length,
      orderMatrix: orderMatrix,
      instruments: instruments,
      wavetables: waves,
      patterns: patterns,
      samples: []
    };
  }

  /* ---- noise drums ------------------------------------------------------ */

  /* The two writes HuTrack's .platFX.Noise makes, at the rows where a noise
   * instrument starts or stops on a channel with the generator.  The volume
   * is pce-song.js's (the compiled instrument's envelope). */
  function noiseWrites(songObj) {
    var t = timing(songObj);
    var out = [];
    for (var n = 0; n < NOISE_CHANNELS.length; n++) {
      var ch = NOISE_CHANNELS[n];
      var on = false;
      for (var o = 0; o < songObj.order.length; o++) {
        var rows = patternRows(songObj, songObj.order[o], ch);
        for (var s = 0; s < rows.length; s++) {
          var row = rows[s];
          if (!row.note) continue;
          var noise = !row.note.cut && row.instrument !== null &&
                      songObj.instruments[row.instrument].kind === "noise";
          var frame = t.rowFrame(o * songObj.steps + s);
          if (noise && !on) {
            out.push({ f: frame, t: 0, reg: 0, value: ch,
                       kind: "noise-on" });
            out.push({ f: frame, t: 1, reg: 7,
                       value: 0x80 | songObj.instruments[row.instrument].nf,
                       kind: "noise-on" });
            on = true;
          } else if (!noise && on) {
            out.push({ f: frame, t: 0, reg: 0, value: ch,
                       kind: "noise-off" });
            out.push({ f: frame, t: 1, reg: 7, value: 0x00,
                       kind: "noise-off" });
            on = false;
          }
        }
      }
    }
    return out;
  }

  /* ---- the write stream and the sound ----------------------------------- */

  /* The compiled song through pce-song.js, plus the noise drums' R7 writes in
   * the same frames.  `frames` and `count` are what pce-psg.js needs. */
  function events(songObj, opts) {
    var compiled = compile(songObj);
    var t = timing(songObj);
    var tail = 0;
    for (var i = 0; i < songObj.instruments.length; i++)
      tail = Math.max(tail, songObj.instruments[i].env.size);
    var count = t.framesPerOrder + tail + 8;
    if (opts && opts.count) count = opts.count;

    var played = player.trace(compiled, { count: count });
    var noise = noiseWrites(songObj);

    /* Per frame: the engine's writes, then the noise writes.  pce-psg.js
     * reads every frame's list in array order, so appending is a write
     * order. */
    var byFrame = [];
    var e, f;
    for (e = 0; e < played.events.length; e++) {
      var ev = played.events[e];
      (byFrame[ev.f] = byFrame[ev.f] || []).push(ev);
    }
    for (e = 0; e < noise.length; e++) {
      var nv = noise[e];
      if (nv.f >= count) continue;
      (byFrame[nv.f] = byFrame[nv.f] || []).push(nv);
    }
    var merged = [];
    for (f = 0; f < count; f++)
      if (byFrame[f]) merged = merged.concat(byFrame[f]);

    return {
      events: merged,
      frames: played.frames,
      count: count,
      song: compiled,
      timing: t,
      notes: played.notes
    };
  }

  function render(songObj, psgModel) {
    var got = events(songObj);
    var model = psgModel || psg;
    var pcm = model.render(got.events, got.frames, got.count);
    return {
      pcm: pcm.pcm,
      sampleRate: pcm.sampleRate,
      events: got.events,
      count: got.count,
      frames: got.frames,
      song: got.song,
      timing: got.timing,
      notes: got.notes
    };
  }

  /* ---- what the panel shows --------------------------------------------- */

  /* The channels sounding at a step: a note that started at or before the
   * step and still has steps to run (its length, or until the next note on
   * that channel). */
  function voicesAt(song, patternIndex, step) {
    var cells = song.patterns[patternIndex].channels;
    var n = 0;
    for (var ch = 0; ch < CHANNELS; ch++) {
      for (var s = step; s >= 0; s--) {
        var cell = cells[ch][s];
        if (!cell) continue;
        if (s + cell.length > step) n++;
        break;
      }
    }
    return n;
  }

  function voiceBars(song, patternIndex) {
    var out = [];
    for (var s = 0; s < song.steps; s++)
      out.push(voicesAt(song, patternIndex, s));
    return out;
  }

  function noteCount(song, patternIndex) {
    var n = 0;
    var cells = song.patterns[patternIndex].channels;
    for (var ch = 0; ch < CHANNELS; ch++)
      for (var s = 0; s < song.steps; s++) if (cells[ch][s]) n++;
    return n;
  }

  /* ---- save and load ---------------------------------------------------- */

  function toJSON(songObj) {
    check(songObj);
    return JSON.stringify({
      version: VERSION,
      name: songObj.name,
      tempo: songObj.tempo,
      swing: songObj.swing,
      key: songObj.key,
      steps: songObj.steps,
      patterns: songObj.patterns.map(function (p) {
        return { name: p.name, channels: p.channels.map(function (ch) {
          return ch.map(function (c) {
            return c ? { note: c.note, instrument: c.instrument,
                         length: c.length } : null;
          });
        }) };
      }),
      order: songObj.order.slice(),
      instruments: songObj.instruments.map(function (ins) {
        var o = { name: ins.name, kind: ins.kind,
                  env: { size: ins.env.size, data: ins.env.data.slice(),
                         loop: ins.env.loop } };
        if (ins.kind === "wave") o.wave = ins.wave.slice();
        else o.nf = ins.nf;
        return o;
      })
    }, null, 2) + "\n";
  }

  /* ---- the songs a toy's files carry, for music(index) ------------------ */

  /* The MCP server asks a toy's files the same question the studio asks a
   * gallery toy's: what can music(0), music(1) ... play?  A toy carries its
   * song as song.json (the SEQUENCER's own document, above), and the ASSETS
   * panel's songs.json is a list whose entries are either the counts-only
   * summaries a .dmf import writes — nothing to play — or, when they carry a
   * body, a playable module.  Every playable entry is COMPILED here, by the
   * same compile() the player's song object comes from, so there is one song
   * model and no second loader: pce-song.js's createPlayer() takes exactly
   * the array this returns.
   *
   * A module body is what the tracker route writes (orderMatrix, patterns of
   * rows, orderCount) and what toys/oak-woods/song.json is; the SEQUENCER's
   * own document has version VERSION, order, steps and instruments on each
   * pattern.  Anything else is refused by the model's own code (seq-json,
   * seq-*, or pce-song.js's song-* codes). */
  function playableSong(doc, text, file) {
    if (!doc || typeof doc !== "object" || Array.isArray(doc))
      refuse("seq-json", file + " is not one song object");
    if (Array.isArray(doc.orderMatrix) && Array.isArray(doc.patterns)) {
      player.checkSong(doc);              /* already the player's module */
      return doc;
    }
    return compile(fromJSON(text));       /* the SEQUENCER's own document */
  }

  function looksPlayable(entry) {
    return !!entry && typeof entry === "object" &&
      ((Array.isArray(entry.orderMatrix) && Array.isArray(entry.patterns)) ||
       (entry.version === VERSION && Array.isArray(entry.patterns) &&
        Array.isArray(entry.order)));
  }

  /* The song slots a file set hands the runtime, in file order: song.json,
   * then the playable entries of songs.json.  Returns the compiled songs
   * (options.songs), each still carrying its songName. */
  function songsFromFiles(files) {
    var out = [];
    for (var i = 0; i < (files || []).length; i++) {
      var f = files[i];
      if (!f || typeof f.source !== "string") continue;
      if (f.name === "song.json") {
        var doc;
        try { doc = JSON.parse(f.source); }
        catch (e) { refuse("seq-json", "song.json does not parse: " +
                                      e.message); }
        out.push(playableSong(doc, f.source, f.name));
      } else if (f.name === "songs.json") {
        var list;
        try { list = JSON.parse(f.source); }
        catch (e) { refuse("asset-json", "songs.json is not JSON: " +
                                        e.message); }
        if (!list || typeof list !== "object" || !Array.isArray(list.songs))
          refuse("asset-shape", "songs.json needs a \"songs\" array");
        for (var k = 0; k < list.songs.length; k++) {
          var entry = list.songs[k];
          if (!looksPlayable(entry)) continue;   /* a summary: no music */
          out.push(playableSong(entry, JSON.stringify(entry),
                                "songs.json[" + k + "]"));
        }
      }
    }
    return out;
  }

  function fromJSON(text) {
    var doc;
    try { doc = JSON.parse(String(text)); }
    catch (e) { refuse("seq-json", "song.json does not parse: " + e.message); }
    if (!doc || typeof doc !== "object")
      refuse("seq-json", "song.json is not an object");
    if (doc.version !== VERSION)
      refuse("seq-json", "song version " + doc.version + " is not " + VERSION);
    var out = {
      version: VERSION,
      name: String(doc.name || "Untitled"),
      tempo: doc.tempo,
      swing: doc.swing,
      key: doc.key,
      steps: doc.steps,
      patterns: (doc.patterns || []).map(function (p) {
        return { name: String(p.name || "A"),
                 channels: (p.channels || []).map(function (ch) {
                   return (ch || []).map(function (c) {
                     return c ? { note: c.note, instrument: c.instrument,
                                  length: c.length } : null;
                   });
                 }) };
      }),
      order: Array.isArray(doc.order) ? doc.order.slice() : [],
      instruments: (doc.instruments || []).map(function (ins) {
        var o = { name: String(ins.name || ""), kind: ins.kind,
                  env: { size: ins.env && ins.env.size,
                         data: ins.env && ins.env.data
                           ? ins.env.data.slice() : [],
                         loop: ins.env ? ins.env.loop : 0xff } };
        if (ins.kind === "wave") o.wave = (ins.wave || []).slice();
        else o.nf = ins.nf;
        return o;
      })
    };
    check(out);
    return out;
  }

  return {
    CHANNELS: CHANNELS,
    VOICE_LIMIT: VOICE_LIMIT,
    NOISE_CHANNELS: NOISE_CHANNELS,
    STEPS_MIN: STEPS_MIN,
    STEPS_MAX: STEPS_MAX,
    TEMPO_MIN: TEMPO_MIN,
    TEMPO_MAX: TEMPO_MAX,
    SWING_MAX: SWING_MAX,
    PATTERNS_MAX: PATTERNS_MAX,
    ORDER_MAX: ORDER_MAX,
    NOTE_MIN: NOTE_MIN,
    NOTE_MAX: NOTE_MAX,
    WAVE_STEPS: WAVE_STEPS,
    WAVE_MAX: WAVE_MAX,
    NF_MAX: NF_MAX,
    VERSION: VERSION,
    PATTERN_NAMES: PATTERN_NAMES,
    KEY_NAMES: KEY_NAMES,
    MAJOR: MAJOR,

    refuse: refuse,
    newSong: newSong,
    demoSong: demoSong,
    defaultInstruments: defaultInstruments,
    check: check,
    setTempo: setTempo,
    setSwing: setSwing,
    setKey: setKey,
    setSteps: setSteps,
    setCell: setCell,
    eraseCell: eraseCell,
    addPattern: addPattern,
    setOrder: setOrder,
    parseOrder: parseOrder,
    orderText: orderText,
    timing: timing,
    compile: compile,
    noiseWrites: noiseWrites,
    events: events,
    render: render,
    voicesAt: voicesAt,
    voiceBars: voiceBars,
    noteCount: noteCount,
    noteName: noteName,
    noteIndex: noteIndex,
    inScale: inScale,
    isBlack: isBlack,
    toJSON: toJSON,
    fromJSON: fromJSON,
    songsFromFiles: songsFromFiles
  };
});
