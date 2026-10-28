/*
 * pce-wave.js — PCEStudio's wave and sound editor model (card #35, first
 * increment: the 32-step wave editor and a ROM that plays what it exports).
 *
 * A "sound" here is a PATCH, not a song: six channels sounding together, each
 * with its own 32-step 5-bit waveform, frequency, channel level and balance,
 * plus the global main volume and the PSG's one LFO.  The tracker (Furnace ->
 * DMF -> HuTrack) is the other half of #35 and is not in this file.
 *
 * The model is kept in exactly the PSG's own shape, so there is no "editor
 * format" to convert:
 *   - a wave is 32 steps of 5 bits (0..31), the 32 words PSG register R6
 *     reads for a channel (HuC6280 PSG manual PB-4; docs/PSG.md).
 *   - frequency F is 12 bits; the tone is fMASTER/(2*32*F) (PB-3), so
 *     7159090/(64*F) Hz.  F = 254 -> 440.4 Hz.
 *   - AL (R4 bits 0-4) is the channel level 0..31: 31 is full volume, 0 is
 *     silent (the reduction GetVL sums is 0x1F - AL).
 *   - balance (R5) is two 4-bit levels, high nibble left, low nibble right;
 *     0xF is full and 0 silent.  mainVolume (R1) is the same shape for all
 *     channels.
 *   - channels 4 and 5 (0-based) may use the noise generator instead of their
 *     wave: R7 bit 7 enables it, bits 0-4 are NF (PB-6).  The other four
 *     channels cannot, and this model refuses the write instead of dropping
 *     it (the PSG ignores R7 on channels 0-3).
 *   - the LFO: ch2 is the carrier (its wave is the LFO shape, stepped at its
 *     own frequency) and ch1's frequency is added to a 12-bit sum of the
 *     carrier value shifted by LFCTL (docs/PSG.md, psg.cpp RecalcFreqCache).
 *     With the LFO on, ch2 is forced silent (R4 = 0x80), exactly as #34's
 *     psg6 does.
 *
 * The editor REFUSES anything the PSG cannot take, and the refusals carry a
 * machine-readable `code` (the same convention as pce-editor.js):
 *   wave-step       a step index outside 0..31 (32 steps per wave)
 *   wave-range      a wave value outside 0..31 (R6 is 5 bits)
 *   freq-range      a frequency outside 0..4095 (12 bits)
 *   al-range        a channel level outside 0..31
 *   balance-range   a balance or main volume outside 0..255
 *   noise-channel   noise on channels 0-3 (only 4 and 5 have the generator)
 *   noise-range     NF outside 0..31
 *   lfo-range       LFO frequency outside 0..255 or control outside 0..3
 *   channel-range   a channel outside 0..5
 *   rom-full        the instruction stream would not fit the 8 KiB bank
 *   schedule        the idle tail of the CPU schedule is not periodic (a
 *                   sound so large the writes outlast the steady state)
 *
 * Two things are built from one instruction stream, so they cannot disagree:
 *   buildRom(sound)  the 8 KiB HuCard image the page downloads: vectors at
 *                    $FFF6, reset at $E000, the register writes as
 *                    LDA #imm / STA $080x pairs, then `bra *`.  Byte-identical
 *                    to PCEAS's build of tools/genwave.py's asm
 *                    (tests/check-wave.js compares them).
 *   trace(sound)     the same writes under Mednafen pce_fast's HuC6280
 *                    timeslice schedule (genpsg.py's simulate(), ported):
 *                    every write at its (frame, in-frame cycle) plus the
 *                    per-frame durations, which is what renderer/pce-psg.js
 *                    needs to produce the PCM Mednafen records.
 *
 * render(sound, seconds) is the sound the page auditions: trace + pce-psg.js,
 * the same model tests/check-wave.js compares sample-for-sample against
 * Mednafen's recording of the exported ROM.  What you hear is what the ROM
 * plays.
 *
 * Register semantics and their manual pages are docs/PSG.md's; the ROM shape
 * (the instruction schedule) is #34's tools/genpsg.py; the 8 KiB bank and the
 * 0xFF fill are PCEAS -raw's, as in the #34 ROMs.
 *
 * Dual use: CommonJS module in Node (tests/check-wave.js) and a browser global
 * (renderer/wave.html) via a UMD-style wrapper, like pce-bg.js.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./pce-psg.js"));
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.wave = factory(root.PCEStudio.psg);
  }
})(typeof self !== "undefined" ? self : this, function (psg) {
  "use strict";

  var CHANNELS = 6;             /* the PSG has six channels */
  var STEPS = 32;               /* 32 wave steps, 5 bits each */
  var WAVE_MAX = 31;
  var FREQ_MAX = 0xFFF;         /* 12-bit frequency */
  var AL_MAX = 0x1F;            /* R4 bits 0-4 */
  var BAL_MAX = 0xFF;           /* two 4-bit levels */
  var LFREQ_MAX = 0xFF;
  var LFO_CTL_MAX = 3;          /* LFCTL 1..3; 0 is off */
  var NOISE_MAX = 0x1F;         /* NF, 5 bits */
  var CLOCK = 7159090;          /* PCE_MASTER_CLOCK / 3, the PSG's clock */
  var ROM_BYTES = 8192;         /* one HuCard bank */
  var ORG = 0xE000;             /* bank 0's CPU address */
  var TWO32 = 4294967296;
  var SAMPLE_RATE = 44100;

  /* the pce_fast timeslice schedule (genpsg.py PREFIX/SLICES/LINES): a ROM
   * that leaves the VDC alone runs 261 lines in frame 0 and 262 after, three
   * CPU timeslices per line (18/2/435 cycles) */
  var SLICES = [18, 2, 435];
  var LINES_FIRST = 261;
  var LINES = 262;
  var PREFIX = [[2, 0x78], [3, 0xD4], [2, 0xD8]];  /* sei, csh, cld */

  var PRESETS = {
    square:   [31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31,
               0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    pulse:    [31, 31, 31, 31, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
               0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    saw:      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
               16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31],
    invsaw:   [31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16,
               15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
    triangle: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
               16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
    sine:     [16, 19, 22, 25, 27, 29, 30, 31, 31, 31, 30, 29, 27, 25, 22, 19,
               16, 13, 10, 7, 5, 3, 2, 1, 1, 1, 2, 3, 5, 7, 10, 13],
    silence:  [16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16,
               16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16]
  };

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

  function copyWave(w) { return w.slice(); }

  /* ---- the document ------------------------------------------------------ */

  function newChannel(index) {
    return {
      wave: copyWave(PRESETS.square),
      freq: 254,
      al: AL_MAX,
      balance: BAL_MAX,
      on: index === 0,
      noise: index >= 4 ? { on: false, nf: 0x0F } : null
    };
  }

  function newSound() {
    var s = { channels: [], mainVolume: BAL_MAX, lfo: { freq: 0xFF, ctl: 0 } };
    for (var c = 0; c < CHANNELS; c++) s.channels.push(newChannel(c));
    return s;
  }

  /* the demo patch: six channels, six wave shapes, #34's psg2 chord (the
   * manual's scale-table frequencies, PB-12) with the balance and levels
   * varied so a recording shows all of them, and noise on channel 6.  Channel
   * 4 is a bass at F=1151 (97.2 Hz) instead: it is the one voice whose
   * frequency needs R3's high nibble, so a wrong MSB write cannot hide
   * (REVIEW-34 lists that as a gap in #34's own recordings). */
  function demoSound() {
    var s = newSound();
    var plan = [
      { wave: PRESETS.square, freq: 254, al: 31, balance: 0xFF, noise: null },
      { wave: PRESETS.saw, freq: 214, al: 24, balance: 0xFF, noise: null },
      { wave: PRESETS.triangle, freq: 170, al: 31, balance: 0xF0, noise: null },
      { wave: PRESETS.pulse, freq: 1151, al: 24, balance: 0x0F, noise: null },
      { wave: PRESETS.invsaw, freq: 127, al: 31, balance: 0xFF,
        noise: { on: false, nf: 0x0F } },
      { wave: PRESETS.sine, freq: 107, al: 20, balance: 0xFF,
        noise: { on: true, nf: 0x0A } }
    ];
    for (var c = 0; c < CHANNELS; c++) {
      var p = plan[c];
      s.channels[c].wave = copyWave(p.wave);
      s.channels[c].freq = p.freq;
      s.channels[c].al = p.al;
      s.channels[c].balance = p.balance;
      s.channels[c].on = true;
      if (p.noise) s.channels[c].noise = { on: p.noise.on, nf: p.noise.nf };
    }
    s.mainVolume = 0xFF;
    return s;
  }

  /* the LFO demo: ch1 a square tone, ch2 a saw carrier (silent), LFCTL 1 —
   * the sweep #34's psg6 measures (~416..470 Hz): F = 254 +- 15 */
  function lfoSound() {
    var s = newSound();
    s.channels[0].wave = copyWave(PRESETS.square);
    s.channels[0].freq = 254;
    s.channels[0].al = 31;
    s.channels[0].balance = 0xFF;
    s.channels[0].on = true;
    s.channels[1].wave = copyWave(PRESETS.saw);
    s.channels[1].freq = 254;
    s.channels[1].on = true;
    for (var c = 2; c < CHANNELS; c++) s.channels[c].on = false;
    s.lfo = { freq: 0xFF, ctl: 1 };
    return s;
  }

  /* the widest LFO: the same tone with LFCTL 3 (x16 deviation), the shift-4
   * end of RecalcFreqCache, kept as the model's worst case rather than a
   * musical patch.  The 12-bit sum is 254 + (la - 16) x 16 and is masked to
   * 4095, so as the carrier walks la = 0..31 the frequency runs 4094, 4095,
   * 0 (-> 4096), 1, 17, 33, ... 494 — i.e. 27 Hz, the tiny-F high-frequency
   * average path, then down from 6.6 kHz to 226 Hz.  A wrong shift, mask or
   * fast-path threshold changes the recording; REVIEW-34 lists 'LFO mode 3'
   * as a miss in #34's own captures. */
  function lfo3Sound() {
    var s = lfoSound();
    s.lfo = { freq: 0xFF, ctl: 3 };
    return s;
  }
  function lfo3Sound() {
    var s = lfoSound();
    s.lfo = { freq: 0xFF, ctl: 3 };
    return s;
  }

  /* ---- the editor's writes, with the same refusals ----------------------- */

  function channel(s, c) {
    checkInt(c, 0, CHANNELS - 1, "channel-range", "channel");
    return s.channels[c];
  }

  function paintStep(s, c, step, value) {
    var ch = channel(s, c);
    checkInt(step, 0, STEPS - 1, "wave-step", "wave step");
    checkInt(value, 0, WAVE_MAX, "wave-range", "wave value");
    ch.wave[step] = value;
    return ch;
  }

  function setWave(s, c, values) {
    var ch = channel(s, c);
    if (!values || values.length !== STEPS)
      refuse("wave-range", "a wave is " + STEPS + " steps");
    for (var i = 0; i < STEPS; i++) {
      if (!isInt(values[i]) || values[i] < 0 || values[i] > WAVE_MAX)
        refuse("wave-range", "step " + i + " must be 0.." + WAVE_MAX);
    }
    ch.wave = copyWave(values);
    return ch;
  }

  function setPreset(s, c, name) {
    if (!PRESETS[name])
      refuse("wave-range", "no preset '" + name + "'");
    return setWave(s, c, PRESETS[name]);
  }

  function setFreq(s, c, f) {
    var ch = channel(s, c);
    checkInt(f, 0, FREQ_MAX, "freq-range", "frequency");
    ch.freq = f;
    return ch;
  }

  function setLevel(s, c, al) {
    var ch = channel(s, c);
    checkInt(al, 0, AL_MAX, "al-range", "channel level (AL)");
    ch.al = al;
    return ch;
  }

  function setBalance(s, c, b) {
    var ch = channel(s, c);
    checkInt(b, 0, BAL_MAX, "balance-range", "balance");
    ch.balance = b;
    return ch;
  }

  function setMainVolume(s, v) {
    checkInt(v, 0, BAL_MAX, "balance-range", "main volume (R1)");
    s.mainVolume = v;
    return s;
  }

  function setNoise(s, c, spec) {
    var ch = channel(s, c);
    if (c < 4)
      refuse("noise-channel", "only channels 5 and 6 (0-based 4, 5) have the " +
             "noise generator");
    if (!spec) { ch.noise = { on: false, nf: 0x0F }; return ch; }
    if (spec.nf !== undefined)
      checkInt(spec.nf, 0, NOISE_MAX, "noise-range", "noise frequency (NF)");
    ch.noise = { on: !!spec.on, nf: spec.nf === undefined ? 0x0F : spec.nf };
    return ch;
  }

  function setChannelOn(s, c, on) {
    channel(s, c).on = !!on;
    return s.channels[c];
  }

  function setLfo(s, spec) {
    if (!spec || !spec.ctl) { s.lfo = { freq: s.lfo.freq, ctl: 0 }; return s; }
    checkInt(spec.freq, 0, LFREQ_MAX, "lfo-range", "LFO frequency");
    checkInt(spec.ctl, 1, LFO_CTL_MAX, "lfo-range", "LFCTL");
    s.lfo = { freq: spec.freq, ctl: spec.ctl };
    return s;
  }

  /* the tone a channel actually plays, for the page's readout */
  function toneHz(freq) {
    return freq ? CLOCK / (2 * STEPS * freq) : 0;
  }

  /* ---- register writes --------------------------------------------------- */

  /* One register write = LDA #value / STA $0800+reg: 7 cycles on the HuC6280
   * (the pair #34's genpsg.py measures), the write landing at the pair's end
   * (instruction completion timestamps, pce_fast huc6280.cpp). */
  function write(reg, value) {
    return { cyc: 7, bytes: [0xA9, value & 0xFF, 0x8D, (reg & 0xFF),
                             0x08], write: [reg, value & 0xFF] };
  }

  /* The instruction stream the exported ROM runs.  Channel order and the two
   * passes (setup at R4 = 0, then enable) are #34's psg2: write frequency and
   * wave while the channel is off, so no half-written wave is audible, then
   * the global volume, then turn the channels on.  The LFO goes last: R9
   * bit 7 restarts the carrier. */
  function instructions(sound) {
    var ins = [];
    for (var p = 0; p < PREFIX.length; p++)
      ins.push({ cyc: PREFIX[p][0], bytes: [PREFIX[p][1]], write: null });

    var c, ch;
    for (c = 0; c < CHANNELS; c++) {
      ch = sound.channels[c];
      checkInt(ch.freq, 0, FREQ_MAX, "freq-range", "frequency");
      checkInt(ch.al, 0, AL_MAX, "al-range", "channel level (AL)");
      checkInt(ch.balance, 0, BAL_MAX, "balance-range", "balance");
      ins.push(write(0, c));                    /* select */
      ins.push(write(4, 0x00));                 /* off, waveform mode */
      ins.push(write(2, ch.freq & 0xFF));       /* frequency LSB */
      ins.push(write(3, (ch.freq >> 8) & 0x0F));/* frequency MSB */
      if (c >= 4 && ch.noise && ch.noise.on) {
        checkInt(ch.noise.nf, 0, NOISE_MAX, "noise-range", "NF");
        ins.push(write(7, 0x80 | (ch.noise.nf & NOISE_MAX)));
      }
      if (c >= 4 && ch.noise && !ch.noise.on)
        ins.push(write(7, ch.noise.nf & NOISE_MAX));   /* waveform mode */
      for (var i = 0; i < STEPS; i++) {
        var v = ch.wave[i];
        if (!isInt(v) || v < 0 || v > WAVE_MAX)
          refuse("wave-range", "channel " + c + " step " + i +
                 " must be 0.." + WAVE_MAX);
        ins.push(write(6, v));
      }
      ins.push(write(5, ch.balance));
    }
    checkInt(sound.mainVolume, 0, BAL_MAX, "balance-range", "main volume (R1)");
    ins.push(write(1, sound.mainVolume));

    var lfoOn = sound.lfo && sound.lfo.ctl;
    for (c = 0; c < CHANNELS; c++) {
      ch = sound.channels[c];
      /* with the LFO running, ch2 is its silent carrier (psg6) */
      var control = (lfoOn && c === 1) ? 0x80
        : (ch.on ? (0x80 | (ch.al & AL_MAX)) : 0x00);
      ins.push(write(0, c));
      ins.push(write(4, control));
    }
    if (lfoOn) {
      checkInt(sound.lfo.freq, 0, LFREQ_MAX, "lfo-range", "LFO frequency");
      checkInt(sound.lfo.ctl, 1, LFO_CTL_MAX, "lfo-range", "LFCTL");
      ins.push(write(8, sound.lfo.freq));
      /* R9's bit 7 both restarts the carrier and — in the reference model,
       * pce_fast's documented guess (docs/PSG.md) — freezes it while set, so
       * the trigger is a strobe: set it, then clear it to let the carrier
       * run.  Written as one value the LFO would hold a constant
       * frequency; #34's psg6 writes 0x81 then 0x01 for the same reason. */
      ins.push(write(9, 0x80 | sound.lfo.ctl));
      ins.push(write(9, sound.lfo.ctl));
    }
    /* the idle loop: `bra *`, 4 cycles, repeated forever (genpsg.py) */
    ins.push({ cyc: 4, bytes: [0x80, 0xFE], write: null });
    return ins;
  }

  /* ---- the ROM ----------------------------------------------------------- */

  function buildRom(sound) {
    var ins = instructions(sound);
    var image = new Uint8Array(ROM_BYTES);
    for (var i = 0; i < image.length; i++) image[i] = 0xFF;   /* PCEAS fill */
    var pc = 0;                                    /* file offset = $C000+pc */
    for (i = 0; i < ins.length; i++) {
      for (var b = 0; b < ins[i].bytes.length; b++)
        image[pc++] = ins[i].bytes[b];
    }
    var handler = ORG + pc;                        /* irq2/irq1/timer/nmi */
    if (pc >= ROM_BYTES - 1 - 10)
      refuse("rom-full", "the instruction stream overflows the 8 KiB bank");
    image[pc++] = 0x40;                            /* rti */
    var vec = 0x1FF6;                              /* $FFF6 - $E000 */
    var words = [handler, handler, handler, handler, ORG];
    for (i = 0; i < words.length; i++) {
      image[vec + 2 * i] = words[i] & 0xFF;
      image[vec + 2 * i + 1] = (words[i] >> 8) & 0xFF;
    }
    return image;
  }

  /* ---- the trace: genpsg.py's simulate(), ported ------------------------- */

  /* Mednafen pce_fast's HuC6280 schedule for a ROM that leaves the VDC alone
   * (genpsg.py's simulate; the comment there derives it from vdc.cpp and
   * huc6280.cpp): three timeslices per line (18/2/435 cycles), 261 lines in
   * frame 0 then 262, a slice the previous overshoot already consumed is
   * skipped, and the frame's final overshoot carries into the next frame
   * until HuC6280_ResetTS at frame end. */
  function simulate(ins, minSteady) {
    if (minSteady === undefined) minSteady = 3;
    var stream = ins.slice();
    var events = [];
    var T = [];
    var t = 0;
    var prev = 0;
    var k = 0;
    var pos = 0;
    for (;;) {
      if (T.length >= 10 &&
          (events.length ? events[events.length - 1].f : -1) + minSteady <
            T.length) break;
      var lines = k === 0 ? LINES_FIRST : LINES;
      for (var line = 0; line < lines; line++) {
        for (var s = 0; s < SLICES.length; s++) {
          var b = prev + SLICES[s];
          prev = b;
          if (t >= b) continue;
          while (t < b) {
            var op = stream[pos];
            pos++;
            if (pos === stream.length) pos = stream.length - 1;
            t += op.cyc;
            if (op.write)
              events.push({ f: k, t: t, reg: op.write[0],
                            value: op.write[1] });
          }
        }
      }
      T.push(t);
      prev -= t;
      t = 0;
      k++;
    }
    return { events: events, T: T };
  }

  function traceOf(sound, name, what) {
    var sim = simulate(instructions(sound));
    var events = sim.events;
    var T = sim.T;
    var kLast = events.length ? events[events.length - 1].f : 0;
    var extra = T.slice(1, kLast + 1);
    var steady = T.slice(kLast + 1);
    var pattern = null;
    for (var p = 1; p <= 4; p++) {
      var ok = true;
      for (var i = 0; i < steady.length; i++) {
        if (steady[i] !== steady[i % p]) { ok = false; break; }
      }
      if (ok) { pattern = steady.slice(0, p); break; }
    }
    if (!pattern) refuse("schedule", "the idle tail is not periodic");
    return {
      name: name || "wave",
      what: what || "",
      clock: CLOCK,
      sample_rate: SAMPLE_RATE,
      events: events,
      frames: { t0: T[0], extra: extra, pattern: pattern }
    };
  }

  function frameT(trace, k) {
    if (k === 0) return trace.frames.t0;
    var extra = trace.frames.extra;
    if (k <= extra.length) return extra[k - 1];
    return trace.frames.pattern[(k - 1 - extra.length) %
                                trace.frames.pattern.length];
  }

  function totalSamples(trace, n) {
    var clocks = 0;
    for (var k = 0; k < n; k++) clocks += frameT(trace, k);
    return Math.floor(clocks * psg.FACTOR / TWO32);
  }

  /* the fewest frames that hold `seconds` of audio */
  function framesFor(trace, seconds) {
    var want = Math.ceil(seconds * SAMPLE_RATE);
    var lo = 1;
    var hi = Math.max(2, want);
    while (totalSamples(trace, hi) < want) hi *= 2;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (totalSamples(trace, mid) >= want) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  /* ---- the sound -------------------------------------------------------- */

  /* render(sound, seconds): the PCM the exported ROM makes, through the
   * sample-exact model (renderer/pce-psg.js).  Returns the trace too, so a
   * caller can inspect the schedule. */
  function render(sound, seconds) {
    var trace = traceOf(sound, "editor", "the editor's patch");
    var n = framesFor(trace, seconds === undefined ? 2 : seconds);
    var got = psg.render(trace.events, trace.frames, n);
    got.trace = trace;
    return got;
  }

  function stats(sound) {
    var ins = instructions(sound);
    var cyc = 0;
    var writes = 0;
    for (var i = 0; i < ins.length; i++) {
      cyc += ins[i].cyc;
      if (ins[i].write) writes++;
    }
    var rom = buildRom(sound);
    return {
      writes: writes,
      cycles: cyc,
      bytes: rom.length,
      on: sound.channels.filter(function (c) { return c.on; }).length,
      noise: sound.channels.filter(function (c) {
        return c.noise && c.noise.on;
      }).length,
      lfo: !!(sound.lfo && sound.lfo.ctl)
    };
  }

  return {
    CHANNELS: CHANNELS,
    STEPS: STEPS,
    WAVE_MAX: WAVE_MAX,
    FREQ_MAX: FREQ_MAX,
    AL_MAX: AL_MAX,
    BAL_MAX: BAL_MAX,
    NOISE_MAX: NOISE_MAX,
    LFO_CTL_MAX: LFO_CTL_MAX,
    ROM_BYTES: ROM_BYTES,
    ORG: ORG,
    CLOCK: CLOCK,
    PRESETS: PRESETS,

    newSound: newSound,
    demoSound: demoSound,
    lfoSound: lfoSound,
    lfo3Sound: lfo3Sound,
    setWave: setWave,
    setPreset: setPreset,
    paintStep: paintStep,
    setFreq: setFreq,
    setLevel: setLevel,
    setBalance: setBalance,
    setMainVolume: setMainVolume,
    setNoise: setNoise,
    setChannelOn: setChannelOn,
    setLfo: setLfo,
    toneHz: toneHz,
    instructions: instructions,
    buildRom: buildRom,
    trace: traceOf,
    frameT: frameT,
    totalSamples: totalSamples,
    framesFor: framesFor,
    render: render,
    stats: stats
  };
});
