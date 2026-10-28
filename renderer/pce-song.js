/*
 * pce-song.js — HuTrack's PSG register sequence, ported to JS for #35.
 *
 * This is the browser side of #35's tracker route.  It takes a DefleMask
 * module read by pce-dmf.js and produces the writes HuTrack's engine
 * (vendor/hutrack, MIT, pinned) makes to the HuC6280 PSG, so
 * renderer/pce-psg.js can turn them into PCM.  It is a port of the parts
 * of the engine a plain DMF song uses:
 *
 *   - HuTrackEngine.Reset's PSG power-on writes (called at Init and again
 *     by playSong);
 *   - the VBlank tick: dec one tick per call, run the parser at zero;
 *   - the parser: one row per channel per parser tick, the order list
 *     wrapping at the end (playSong passes force_no_repeat = 0);
 *   - note start: anchor = engine-note + 60, HuTrack's own table period
 *     with its octave shifts and 12-bit clamp (HuTrack_pitch_fast.asm);
 *   - the volume envelope (floor(driverVolume * value / 31)), the waveform
 *     envelope, and the engine's exact control-wavearound around a wave
 *     upload (HuTrack_parser.asm .copy.wave).
 *
 * What it deliberately does not do: effect columns, arpeggio envelopes,
 * DDA/PCM samples, SFX, LFO and the music fade.  It refuses a song that
 * needs any of them with a code rather than playing something else.
 *
 * Timing is the one thing this port approximates.  The engine writes
 * inside the VBlank IRQ, so every write's cycle offset within the frame
 * depends on the IRQ entry latency, the timer IRQ and the engine's own
 * instruction counts.  This port keeps the write ORDER and places the
 * writes of a frame at cyclesPerWrite apart from the frame start (default
 * 12, an order-preserving approximation); it does not claim the engine's
 * cycle-exact schedule.  docs/HUTRACK.md records what that means for the
 * comparison with the Mednafen recording.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.song = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* HuTrack.Pitch.BaseLo / BaseHi (HuTrack_pitch_tables.inc): the period of
   * each of the twelve notes at the table's reference octave.  Semitone and
   * Octave are y % 12 and floor(y / 12), so they are not stored here. */
  var BASE_LO = [0x5e, 0x9e, 0xe8, 0x3d, 0x9c, 0x04,
                 0x73, 0xec, 0x6b, 0xf2, 0x80, 0x14];
  var BASE_HI = [0x0d, 0x0c, 0x0b, 0x0b, 0x0a, 0x0a,
                 0x09, 0x08, 0x08, 0x07, 0x07, 0x07];

  var CHANNELS = 6;

  function refuse(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  /* ---- the engine's pitch path ----------------------------------------- */

  /* HuTrack.Pitch.interpolate at a whole note: the anchor is the engine note
   * plus 60; Semitone/Octave index the base tables; octave 5 is the
   * reference, and each octave halves (or doubles) the 16-bit period.  A
   * 16-bit overflow becomes $FFFF, which the caller's clamp turns into
   * $0FFF; a zero period becomes 1 (HuTrack_pitch_fast.asm). */
  function periodFor(anchor) {
    if (anchor < 0 || anchor > 255)
      throw refuse("song-note", "note anchor " + anchor + " outside 0..255");
    var semitone = anchor % 12;
    var octave = Math.floor(anchor / 12) - 5;
    var period = BASE_LO[semitone] | (BASE_HI[semitone] << 8);
    while (octave > 0) {
      period >>= 1;
      octave--;
    }
    while (octave < 0) {
      period <<= 1;
      if (period > 0xffff) { period = 0xffff; break; }
      octave++;
    }
    if (period >= 0x1000) period = 0x0fff;   /* the caller's .clamp */
    if (period === 0) period = 1;
    return period;
  }

  /* ---- validation ------------------------------------------------------- */

  function checkSong(song) {
    if (song.timeBase !== 1)
      throw refuse("song-time-base",
                   "DMF time base " + song.timeBase + " is not 1");
    if (song.frameMode !== 1)
      throw refuse("song-frame-mode",
                   "DMF frame mode " + song.frameMode +
                   " is not NTSC/VBlank (1)");
    if (song.customHz)
      throw refuse("song-custom-hz",
                   "custom-Hz modules need a matching tick rate");
    if (song.samples && song.samples.length)
      throw refuse("song-pcm",
                   song.samples.length + " PCM sample(s): DDA is not in " +
                   "this player yet");
    if (!song.orderMatrix || song.orderMatrix.length !== CHANNELS)
      throw refuse("song-channel", "expected " + CHANNELS + " channels");
    for (var ch = 0; ch < CHANNELS; ch++) {
      if (song.orderMatrix[ch].length !== song.orderCount)
        throw refuse("song-order",
                     "channel " + ch + " has " +
                     song.orderMatrix[ch].length + " orders, expected " +
                     song.orderCount);
      for (var o = 0; o < song.orderCount; o++) {
        var p = song.orderMatrix[ch][o];
        if (p >= song.patterns[ch].length)
          throw refuse("song-order",
                       "channel " + ch + " order " + o +
                       " uses missing pattern " + p);
      }
    }
    for (var i = 0; i < song.instruments.length; i++) {
      var ins = song.instruments[i];
      if (ins.arpeggioEnv && ins.arpeggioEnv.size)
        throw refuse("song-arp",
                     "instrument " + i + " uses an arpeggio envelope");
      if (ins.wavetableEnv.size) {
        for (var w = 0; w < ins.wavetableEnv.size; w++)
          if (ins.wavetableEnv.data[w] >= song.wavetables.length)
            throw refuse("song-wave",
                         "instrument " + i + " references waveform " +
                         ins.wavetableEnv.data[w]);
      }
      for (var v = 0; v < ins.volumeEnv.size; v++)
        if (ins.volumeEnv.data[v] > 31)
          throw refuse("song-volume",
                       "instrument " + i + " volume " +
                       ins.volumeEnv.data[v] + " > 31");
    }
    for (ch = 0; ch < CHANNELS; ch++)
      for (var pi = 0; pi < song.patterns[ch].length; pi++)
        for (var r = 0; r < song.patterns[ch][pi].length; r++) {
          var row = song.patterns[ch][pi][r];
          if (row.effects.length)
            throw refuse("song-fx",
                         "channel " + ch + " pattern " + pi + " row " + r +
                         " uses effect " + row.effects[0].code +
                         ": effect columns are not in this player yet");
          if (row.instrument !== null &&
              row.instrument >= song.instruments.length)
            throw refuse("song-instrument",
                         "channel " + ch + " row " + r +
                         " uses missing instrument " + row.instrument);
          if (row.volume !== null && (row.volume < 0 || row.volume > 31))
            throw refuse("song-volume",
                         "channel " + ch + " row " + r +
                         " volume " + row.volume + " outside 0..31");
          if (row.note && !row.note.cut) {
            var engineNote = row.note.octave * 12 + row.note.semitone;
            if (engineNote < 0 || engineNote >= 84)
              throw refuse("song-note",
                           "channel " + ch + " row " + r + " note index " +
                           engineNote + " outside 0..83");
          }
        }
    return true;
  }

  /* ---- the engine ------------------------------------------------------- */

  /* The pce_fast frame budget for a ROM that leaves the VDC alone: the
   * first frame is 261 lines, every later frame 262, with the 455-cycle
   * line split into 18+2+435-cycle slices (tests/genpsg.py, docs/PSG.md).
   * The overshoot alternates, so the steady frame durations are
   * [119212, 119208]. */
  var FRAME_CYCLES = { t0: 118756, pattern: [119212, 119208] };

  function newChannel() {
    return {
      enabled: false,
      note: 0,
      anchor: 60,
      period: 1,
      instr: 0xff,
      directVolume: 31,
      driverVolume: 31,
      outputVolume: 31,
      volIdx: 0,
      waveIdx: 0,
      lastWave: 0xff,
      uploadedWave: 0xff,
      processState: 0,
      volEnv: null,
      waveEnv: null
    };
  }

  function loadInstrument(ch, song, index) {
    var ins = song.instruments[index];
    ch.instr = index;
    ch.volEnv = ins.volumeEnv;
    ch.waveEnv = ins.wavetableEnv;
    ch.volIdx = 0;
    ch.waveIdx = 0;
  }

  /* floor(driverVolume * envelope / 31): HuTrack.Math.volume's table. */
  function scaleVolume(driverVolume, value) {
    if (value > 31) value = 31;
    return Math.floor(driverVolume * value / 31);
  }

  function trace(song, opts) {
    checkSong(song);
    opts = opts || {};
    var frames = opts.frames || FRAME_CYCLES;
    var count = opts.count || 300;
    var step = opts.cyclesPerWrite === undefined ? 12
                                                 : opts.cyclesPerWrite;

    var events = [];
    var notes = [];
    var col = 0;   /* write index within the current frame */

    function write(reg, value) {
      events.push({ f: frame, t: col * step, reg: reg, value: value & 0xff });
      col++;
    }

    /* HuTrackEngine.Reset: $801 = $FF, then each channel's power-on state
     * ($805 = $FF, control $40 then $00, noise off, 32 zero wave steps).
     * Init and playSong each call it, before any EngineCall. */
    var frame = 0;
    col = 0;
    write(1, 0xff);
    for (var ch = 0; ch < CHANNELS; ch++) {
      write(0, ch);
      write(5, 0xff);
      write(4, 0x40);
      write(4, 0x00);
      write(7, 0x00);
      for (var s = 0; s < 32; s++) write(6, 0x00);
    }
    write(1, 0xff);
    for (ch = 0; ch < CHANNELS; ch++) {
      write(0, ch);
      write(5, 0xff);
      write(4, 0x40);
      write(4, 0x00);
      write(7, 0x00);
      for (s = 0; s < 32; s++) write(6, 0x00);
    }

    var channels = [];
    for (ch = 0; ch < CHANNELS; ch++) channels.push(newChannel());
    var orderIndex = new Array(CHANNELS).fill(0);
    var rowIndex = new Array(CHANNELS).fill(0);

    var tick = song.tick2;                 /* playSong: tick = tickReload */
    var tickA = song.tick1;
    var tickB = song.tick2;
    var tickIdx = 0;

    for (frame = 1; frame < count; frame++) {
      col = 0;

      tick--;
      if (tick === 0) {
        tickIdx ^= 1;
        tick = tickIdx ? tickA : tickB;
        for (ch = 0; ch < CHANNELS; ch++) {
          var order = song.orderMatrix[ch][orderIndex[ch]];
          var row = song.patterns[ch][order][rowIndex[ch]];
          rowIndex[ch]++;
          if (rowIndex[ch] >= song.rowsPerPattern) {
            rowIndex[ch] = 0;
            orderIndex[ch]++;
            if (orderIndex[ch] >= song.orderCount) orderIndex[ch] = 0;
          }
          applyRow(channels[ch], ch, row, song);
        }
      }

      for (ch = 0; ch < CHANNELS; ch++)
        envelopes(channels[ch], ch, song);
    }

    function applyRow(c, ch, row, song) {
      if (row.note && row.note.cut) {
        c.enabled = false;
        write(0, ch);
        write(4, 0x00);
        return;
      }
      if (row.instrument !== null && row.instrument !== c.instr)
        loadInstrument(c, song, row.instrument);
      if (row.volume !== null) {
        c.directVolume = row.volume;
        c.driverVolume = row.volume;
        c.outputVolume = row.volume;
      }
      if (!row.note) return;

      var engineNote = row.note.octave * 12 + row.note.semitone;
      if (c.instr === 0xff) loadInstrument(c, song, 0);
      c.enabled = true;
      c.note = engineNote;
      c.anchor = engineNote + 60;
      c.period = periodFor(c.anchor);
      c.volIdx = 0;
      c.waveIdx = 0;
      notes.push({ frame: frame, channel: ch, note: engineNote,
                   semitone: row.note.semitone, octave: row.note.octave,
                   period: c.period });
    }

    function envelopes(c, ch, song) {
      if (!c.enabled) return;

      /* HuTrackEngine.Channel.SetFrequency: always writes the applied
       * period, whether or not the note changed this frame. */
      write(0, ch);
      write(2, c.period & 0xff);
      write(3, (c.period >> 8) & 0x0f);

      /* HuTrackEngine.Channel.waveformEnv: a new waveform is uploaded only
       * when the selected waveform index changes (a note resets the
       * envelope index, not the upload); the upload sequence is
       * .copy.wave's, including the DDA/off toggles that reset the PSG's
       * wave pointer. */
      var wave;
      if (!c.waveEnv || c.waveEnv.size === 0) {
        wave = 0;
      } else {
        if (c.waveIdx >= c.waveEnv.size) {
          if (c.waveEnv.loop === 0xff) wave = c.lastWave;
          else { c.waveIdx = c.waveEnv.loop; wave = c.waveEnv.data[c.waveIdx++]; }
        } else {
          wave = c.waveEnv.data[c.waveIdx++];
        }
        c.lastWave = wave;
      }
      if (wave !== c.uploadedWave) {
        c.uploadedWave = wave;
        var vol = c.processState & 0x1f;
        var first = (c.processState & 0xe0) | vol;
        var withDda = vol | 0x40;
        write(0, ch);
        write(4, first);
        write(4, withDda);
        write(4, vol);
        for (var i = 0; i < 32; i++)
          write(6, song.wavetables[wave][i] & 0x1f);
        write(4, withDda);
      }

      /* HuTrackEngine.Channel.volumeEnv: the envelope is read as it plays;
       * when it has ended with a $FF loop it holds its last output. */
      if (!c.volEnv || c.volEnv.size === 0) {
        c.outputVolume = c.driverVolume;
      } else if (c.volIdx >= c.volEnv.size) {
        if (c.volEnv.loop !== 0xff) {
          c.volIdx = c.volEnv.loop;
          c.outputVolume =
            scaleVolume(c.driverVolume, c.volEnv.data[c.volIdx++]);
        }
      } else {
        c.outputVolume =
          scaleVolume(c.driverVolume, c.volEnv.data[c.volIdx++]);
      }
      c.processState = c.outputVolume | 0x80;
      write(0, ch);
      write(4, c.processState);
    }

    return {
      events: events,
      frames: frames,
      notes: notes,
      count: count
    };
  }

  /* Render through the PSG model.  psg is renderer/pce-psg.js (injected so
   * this module has no loader of its own). */
  function render(song, psg, opts) {
    var t = trace(song, opts);
    var pcm = psg.render(t.events, t.frames, t.count);
    return { pcm: pcm.pcm, sampleRate: pcm.sampleRate, trace: t };
  }

  return {
    trace: trace,
    render: render,
    periodFor: periodFor,
    checkSong: checkSong,
    FRAME_CYCLES: FRAME_CYCLES
  };
});
