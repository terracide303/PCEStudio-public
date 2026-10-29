/*
 * pce-mix.js — the AUDIO panel's mixer model (card #97).
 *
 * ppu.toys' AUDIO panel is the working example of the shape: one row per
 * voice with a level meter, a volume trim, a balance pair, a pitch stepper,
 * M and S, a VOICE detail with Trigger / Release / Reset, and a mix that
 * saves with the toy.  This is that shape for the HuC6280 PSG, in the PSG's
 * own terms (docs/PSG.md), so there is no "mixer format" to convert:
 *
 *   - six voices, not eight.  There is no sample playback engine with echo:
 *     the card's own honest line says so, and the panel prints it.
 *   - a voice is in one of three modes: `wave` (the 32-step 5-bit wave R6
 *     writes, #62's editor), `noise` (channels 5 and 6 only, R7; the other
 *     four have no generator and the model refuses rather than dropping the
 *     write), or `dda` (R4 bit 6: R6 holds one level instead of stepping a
 *     wave).
 *   - volume is AL 0..31 (R4 bits 0-4); balance is two 4-bit levels, R5 high
 *     nibble left and low nibble right; the master is R1 in the same shape.
 *   - pitch is the 12-bit frequency F (R2 low byte, R3 high nibble) and the
 *     tone it makes is fMASTER/(2*32*F) Hz (PB-3), so the panel can name the
 *     note as well as the word.
 *   - the PSG has no hardware ADSR.  The envelope is the DRIVER's: the
 *     software that writes R4 as the note plays.  `envelope()` is that
 *     sequence of R4 values, and Trigger / Release are the writes that start
 *     and end it.
 *   - the mixer is not a second register file.  `soundOf()` folds a mix into
 *     renderer/pce-wave.js's document and the register writes come out of
 *     that module's own `instructions()`, so the mixer and the wave editor
 *     cannot disagree about what a write is.  tests/check-studio.js asserts
 *     the two are the same stream.
 *
 * The mix is SAVED WITH THE TOY as `waves.json` (the file the page already
 * puts in every toy, #77) — that is this card's stand-in for ppu.toys'
 * "Sound RAM · N B free · mix saves with the toy": instead of a sample-RAM
 * budget the panel counts the DDA bytes the ROM would carry.
 *
 * Refusals carry a machine-readable `code`, the same convention as
 * pce-editor.js.  The wave/frequency/level/balance/noise/LFO ones are
 * pce-wave.js's own and come back unchanged (wave-step, wave-range,
 * freq-range, al-range, balance-range, noise-channel, noise-range,
 * lfo-range, channel-range, dda-range); this file adds
 *   mode-range      a mode that is not wave, noise or dda
 *   env-range       attack/decay/rate outside 0..15, or sustain outside 0..31
 *   waves-json      waves.json does not parse, or is not a mix
 *   mix-voices      a voices array that is not CHANNELS long
 *
 * Dual use: CommonJS module in Node (tests/check-studio.js) and a browser
 * global (renderer/studio.html) via a UMD-style wrapper, like pce-bg.js.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./pce-wave.js"), require("./pce-psg.js"));
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.mix = factory(root.PCEStudio.wave, root.PCEStudio.psg);
  }
})(typeof self !== "undefined" ? self : this, function (wave, psg) {
  "use strict";

  var CHANNELS = 6;
  var STEPS = 32;
  var WAVE_MAX = 31;
  var FREQ_MAX = 0xFFF;
  var AL_MAX = 0x1F;
  var BAL_MAX = 0xFF;
  var LFREQ_MAX = 0xFF;
  var LFO_CTL_MAX = 3;
  var NOISE_MAX = 0x1F;
  var ENV_MAX = 15;             /* attack, decay, rate: the driver's steps */
  var MODES = ["wave", "noise", "dda"];
  var NOISE_VOICES = [4, 5];    /* the two with the generator, 0-based */
  var CLOCK = 7159090;          /* PCE_MASTER_CLOCK / 3 */
  var VERSION = 1;

  /* A4 is F = 254 in the PSG's own word (7159090/(64*254) = 440.4 Hz). */
  var A4_FREQ = 254;
  var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#",
                    "G", "G#", "A", "A#", "B"];

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

  /* ---- the document ------------------------------------------------------ */

  function newVoice(index) {
    return {
      on: index === 0,
      mode: "wave",
      wave: wave.PRESETS.square.slice(),
      freq: A4_FREQ,
      al: AL_MAX,
      balance: BAL_MAX,
      mute: false,
      solo: false,
      noise: { nf: 0x0F },
      dda: [16, 24, 31, 24],
      env: { attack: 0, decay: 0, sustain: 31, rate: 1 }
    };
  }

  function newMix() {
    var m = { version: VERSION,
              master: { balance: BAL_MAX },
              lfo: { freq: 0xFF, ctl: 0 },
              voices: [] };
    for (var c = 0; c < CHANNELS; c++) m.voices.push(newVoice(c));
    return m;
  }

  /* The demo mix: #62's demo patch (six shapes, #34's psg2 chord, noise on
   * voice 6) as the mixer's, so the panel has something to play on open. */
  function demoMix() {
    var m = newMix();
    var sound = wave.demoSound();
    for (var c = 0; c < CHANNELS; c++) {
      var s = sound.channels[c], v = m.voices[c];
      v.on = true;
      v.wave = s.wave.slice();
      v.freq = s.freq;
      v.al = s.al;
      v.balance = s.balance;
      if (c >= 4 && s.noise && s.noise.on) { v.mode = "noise"; v.noise.nf = s.noise.nf; }
    }
    m.master.balance = sound.mainVolume;
    return m;
  }

  function voice(m, c) {
    checkInt(c, 0, CHANNELS - 1, "channel-range", "voice");
    return m.voices[c];
  }

  function setMode(m, c, mode) {
    var v = voice(m, c);
    if (MODES.indexOf(mode) < 0)
      refuse("mode-range", "a mode is one of " + MODES.join(", ") +
             " (got " + mode + ")");
    if (mode === "noise" && NOISE_VOICES.indexOf(c) < 0)
      refuse("noise-channel", "only channels 5 and 6 (0-based 4, 5) have the " +
             "noise generator");
    v.mode = mode;
    return v;
  }

  function setDdaLevel(m, c, level) {
    var v = voice(m, c);
    checkInt(level, 0, WAVE_MAX, "dda-range", "DDA level");
    v.dda = [level];
    return v;
  }

  function setMute(m, c, on) { voice(m, c).mute = !!on; return m.voices[c]; }
  function setSolo(m, c, on) { voice(m, c).solo = !!on; return m.voices[c]; }

  function setEnv(m, c, env) {
    var v = voice(m, c);
    if (!env) refuse("env-range", "an envelope is {attack, decay, sustain, rate}");
    checkInt(env.attack, 0, ENV_MAX, "env-range", "attack");
    checkInt(env.decay, 0, ENV_MAX, "env-range", "decay");
    checkInt(env.sustain, 0, AL_MAX, "env-range", "sustain");
    checkInt(env.rate, 0, ENV_MAX, "env-range", "rate");
    v.env = { attack: env.attack, decay: env.decay,
              sustain: env.sustain, rate: env.rate };
    return v;
  }

  function setMasterBalance(m, value) {
    checkInt(value, 0, BAL_MAX, "balance-range", "main volume (R1)");
    m.master.balance = value;
    return m;
  }

  /* the PSG's own writes, unchanged (their refusal codes are pce-wave's) */
  function setWave(m, c, values) {
    voice(m, c);
    wave.setWave(soundOf(m), c, values);           /* wave-range */
    return assignWave(m, c, values);
  }
  function assignWave(m, c, values) { voice(m, c).wave = values.slice(); return m.voices[c]; }
  function paintStep(m, c, step, value) {
    var v = voice(m, c);
    wave.paintStep(soundOf(m), c, step, value);   /* the range checks */
    v.wave[step] = value;
    return v;
  }
  function setPreset(m, c, name) {
    if (!wave.PRESETS[name]) refuse("wave-range", "no preset '" + name + "'");
    return assignWave(m, c, wave.PRESETS[name]);
  }
  function setFreq(m, c, f) {
    var v = voice(m, c);
    wave.setFreq(soundOf(m), c, f);
    v.freq = f;
    return v;
  }
  function setLevel(m, c, al) {
    var v = voice(m, c);
    wave.setLevel(soundOf(m), c, al);
    v.al = al;
    return v;
  }
  function setBalance(m, c, b) {
    var v = voice(m, c);
    wave.setBalance(soundOf(m), c, b);
    v.balance = b;
    return v;
  }
  function setNoise(m, c, spec) {
    var v = voice(m, c);
    wave.setNoise(soundOf(m), c, spec);            /* noise-channel on 0-3 */
    v.noise = { nf: spec && spec.nf !== undefined ? spec.nf : 0x0F };
    return v;
  }
  function setChannelOn(m, c, on) { voice(m, c).on = !!on; return m.voices[c]; }
  function setLfo(m, spec) {
    var probe = soundOf(m);
    wave.setLfo(probe, spec);                      /* lfo-range */
    m.lfo = { freq: probe.lfo.freq, ctl: probe.lfo.ctl };
    return m;
  }

  /* ---- what the mixer actually plays ------------------------------------- */

  /* ppu.toys' M and S: a muted voice is off, and while any voice is soloed
   * only the soloed ones are on. */
  function audible(m) {
    var anySolo = false, c;
    for (c = 0; c < CHANNELS; c++) if (m.voices[c].solo) anySolo = true;
    var out = [];
    for (c = 0; c < CHANNELS; c++) {
      var v = m.voices[c];
      out.push(!!v.on && !v.mute && (!anySolo || !!v.solo));
    }
    return out;
  }

  /* The mix as renderer/pce-wave.js's document.  Mute and solo fold into the
   * channel's on bit (R4 bit 7); DDA folds into its held level; noise into
   * R7.  Everything else is a field copied across. */
  function soundOf(m) {
    var s = wave.newSound();
    var aud = audible(m);
    if (m.lfo && m.lfo.ctl) s.lfo = { freq: m.lfo.freq, ctl: m.lfo.ctl };
    else s.lfo = { freq: (m.lfo && m.lfo.freq) || 0xFF, ctl: 0 };
    s.mainVolume = m.master.balance;
    for (var c = 0; c < CHANNELS; c++) {
      var v = m.voices[c], ch = s.channels[c];
      ch.wave = v.wave.slice();
      ch.freq = v.freq;
      ch.al = v.al;
      ch.balance = v.balance;
      ch.on = aud[c];
      ch.dda = v.mode === "dda" ? heldLevel(v) : null;
      if (c >= 4) ch.noise = { on: v.mode === "noise", nf: v.noise.nf };
    }
    return s;
  }

  function heldLevel(v) {
    return v.dda && v.dda.length ? v.dda[0] : (v.al & WAVE_MAX);
  }

  /* The register writes the mixer makes, in order: pce-wave.js's own
   * instruction stream, with everything that is not a write dropped.  One
   * generator, so the mixer and the wave editor cannot drift. */
  function writes(m) {
    var ins = wave.instructions(soundOf(m));
    var out = [];
    for (var i = 0; i < ins.length; i++)
      if (ins[i].write) out.push({ reg: ins[i].write[0], value: ins[i].write[1] });
    return out;
  }

  /* The writes for one register only — what the evidence reads when it says
   * "this control moved R5". */
  function writesOf(m, reg) {
    return writes(m).filter(function (w) { return w.reg === reg; });
  }

  /* The audible PCM, through the sample-exact model (renderer/pce-psg.js):
   * pce-wave's trace schedule, so what the panel plays is what a ROM writing
   * the same registers plays. */
  function render(m, seconds) {
    return wave.render(soundOf(m), seconds === undefined ? 1 : seconds);
  }

  /* ---- the meter --------------------------------------------------------- */

  /* The PSG's own attenuation, not an invented scale: GetVL (psg.cpp:190)
   * sums a 1.5 dB/3 dB table's reductions and clamps at 31, and the output
   * stage scales by 2^(-vl/4) (buildDbTable, ~1.5 dB per step, 31 is off).
   * pce-psg.js exports the table, so the meter and the PCM share it. */
  var SCALE = psg.LEVEL.scale;

  function vlOf(m, c, right) {
    var v = m.voices[c];
    var gbal = 0x1F - SCALE[(m.master.balance >> (right ? 0 : 4)) & 0xF];
    var bal = 0x1F - SCALE[(v.balance >> (right ? 0 : 4)) & 0xF];
    var al = 0x1F - (v.al & AL_MAX);
    var red = gbal + bal + al;
    return red > 0x1F ? 0x1F : red;
  }

  function dbFromVl(vl) { return psg.LEVEL.db(vl); }

  /* One entry per voice per side: the reduction, the dB it is, and whether
   * the voice is heard at all. */
  function meters(m) {
    var aud = audible(m);
    var out = [];
    for (var c = 0; c < CHANNELS; c++) {
      var l = aud[c] ? vlOf(m, c, false) : 0x1F;
      var r = aud[c] ? vlOf(m, c, true) : 0x1F;
      out.push({ audible: aud[c],
                 left: { vl: l, db: dbFromVl(l), gain: psg.LEVEL.gain(l) },
                 right: { vl: r, db: dbFromVl(r), gain: psg.LEVEL.gain(r) } });
    }
    return out;
  }

  /* ---- pitch and note names ---------------------------------------------- */

  function toneHz(freq) { return wave.toneHz(freq); }

  function freqForHz(hz) {
    if (!(hz > 0)) return FREQ_MAX;
    var f = Math.round(CLOCK / (2 * STEPS * hz));
    return Math.max(1, Math.min(FREQ_MAX, f));
  }

  function midiOf(freq) {
    var hz = toneHz(freq);
    if (!(hz > 0)) return null;
    return 69 + 12 * Math.log(hz / 440) / Math.LN2;
  }

  function noteName(freq) {
    var n = midiOf(freq);
    if (n === null) return "—";
    var r = Math.round(n);
    return NOTE_NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1);
  }

  /* how far the PSG's own word is from the equal-tempered note, in cents */
  function centsOff(freq) {
    var n = midiOf(freq);
    if (n === null) return 0;
    return Math.round((n - Math.round(n)) * 100);
  }

  function noteFreq(name) {
    var mm = /^([A-G])([#b]?)(-?\d+)$/.exec(String(name).trim());
    if (!mm)
      refuse("freq-range", "a note is written C4, F#2 or Bb5 (got " + name + ")");
    var semi = NOTE_NAMES.indexOf(mm[1]) +
               (mm[2] === "#" ? 1 : mm[2] === "b" ? -1 : 0);
    var r = (parseInt(mm[3], 10) + 1) * 12 + semi;
    return freqForHz(440 * Math.pow(2, (r - 69) / 12));
  }

  /* one semitone up or down, staying inside the 12-bit word */
  function stepNote(freq, semitones) {
    var n = midiOf(freq);
    if (n === null) return freq;
    return freqForHz(440 * Math.pow(2, (Math.round(n) + semitones - 69) / 12));
  }

  /* ---- the driver's software envelope ------------------------------------ */

  /* Attack and decay are steps of the driver's own (it writes R4 once per
   * step); rate is how many frames each step lasts; sustain is the AL held
   * between the decay and the release.  A step count of 0 means the ramp is
   * skipped.  The PSG has no hardware ADSR: this is the sequence of R4
   * values a driver writes, nothing more. */
  function envelope(env) {
    var out = [], i;
    if (env.attack === 0) out.push(AL_MAX);
    else
      for (i = 0; i <= env.attack; i++)
        out.push(Math.round(AL_MAX * i / env.attack));
    if (env.decay > 0) {
      var from = out.length ? out[out.length - 1] : AL_MAX;
      for (i = 1; i <= env.decay; i++)
        out.push(Math.round(from - (from - env.sustain) * i / env.decay));
    } else out.push(env.sustain);
    return out;
  }

  function releaseRamp(env, from) {
    var start = from === undefined ? env.sustain : from;
    var steps = env.rate === 0 ? 1 : env.rate;
    var out = [];
    for (var i = 1; i <= steps; i++)
      out.push(Math.round(start - start * i / steps));
    return out;
  }

  /* Trigger: the voice comes on at the first envelope value.  Release: the
   * driver ramps it down and switches the channel off.  Reset: back to the
   * voice the mixer started with. */
  function trigger(m, c) {
    var v = voice(m, c);
    var levels = envelope(v.env);
    v.on = true;
    v.al = levels[0];
    return [{ reg: 0, value: c }, { reg: 4, value: controlWord(v) }];
  }

  function release(m, c) {
    var v = voice(m, c);
    var ramp = releaseRamp(v.env, v.al);
    var out = [{ reg: 0, value: c }];
    for (var i = 0; i < ramp.length; i++)
      out.push({ reg: 4, value: ramp[i] ? (0x80 | ramp[i]) : 0x00 });
    v.al = 0;
    v.on = false;
    return out;
  }

  function reset(m, c) {
    var fresh = newVoice(c);
    voice(m, c);
    m.voices[c] = fresh;
    return fresh;
  }

  function controlWord(v) {
    var base = v.on ? 0x80 : 0x00;
    if (v.mode === "dda") return base | 0x40 | (v.al & AL_MAX);
    return base | (v.al & AL_MAX);
  }

  /* ---- the live toy's PSG ---------------------------------------------- */

  /* A running toy's sound is a stream of PSG writes (#71's host records them
   * as {f, t, reg, value}, renderer/pce-psg.js's own event shape).  This
   * replays that stream into the mixer's view of the six voices, so the
   * panel can show what the toy is doing to the chip — computed from the
   * same events the PCM is rendered from, not from a second guess. */
  function fromEvents(events) {
    var out = { writes: events.length, frame: -1,
                master: 0, lfo: { freq: 0, ctl: 0 }, voices: [] };
    var sel = 0, c;
    for (c = 0; c < CHANNELS; c++)
      out.voices.push({ on: false, al: 0, balance: 0, freq: 0,
                        mode: "wave", dda: false, noise: false, nf: 0 });
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (e.f > out.frame) out.frame = e.f;
      if (e.reg === 0) { sel = e.value & 7; continue; }
      if (e.reg === 1) { out.master = e.value & 0xFF; continue; }
      if (e.reg === 8) { out.lfo.freq = e.value & 0xFF; continue; }
      if (e.reg === 9) { out.lfo.ctl = e.value & 0x03; continue; }
      if (sel > 5) continue;
      var v = out.voices[sel];
      if (e.reg === 2) v.freq = (v.freq & 0x0F00) | (e.value & 0xFF);
      else if (e.reg === 3) v.freq = (v.freq & 0x00FF) | ((e.value & 0x0F) << 8);
      else if (e.reg === 4) {
        v.on = !!(e.value & 0x80);
        v.dda = !!(e.value & 0x40);
        v.al = e.value & AL_MAX;
        v.mode = v.dda ? "dda" : (v.noise ? "noise" : "wave");
      } else if (e.reg === 5) v.balance = e.value & 0xFF;
      else if (e.reg === 7 && sel >= 4) {
        v.noise = !!(e.value & 0x80);
        v.nf = e.value & NOISE_MAX;
        v.mode = v.dda ? "dda" : (v.noise ? "noise" : "wave");
      }
    }
    for (c = 0; c < CHANNELS; c++) {
      out.voices[c].note = noteName(out.voices[c].freq);
      out.voices[c].audible = out.voices[c].on && out.voices[c].al > 0;
    }
    return out;
  }

  /* ---- the ROM budget ---------------------------------------------------- */

  /* ppu.toys keeps its samples in ARAM and prints how much is free.  The PCE
   * has no sample RAM: a DDA sample lives in the ROM, one byte per step (R6
   * is a byte write), so that is what this counts. */
  function ddaBytes(m) {
    var n = 0;
    for (var c = 0; c < CHANNELS; c++)
      if (m.voices[c].mode === "dda") n += m.voices[c].dda.length;
    return n;
  }

  /* ---- waves.json -------------------------------------------------------- */

  function toJSON(m) {
    return JSON.stringify(m, null, 2) + "\n";
  }

  function fromJSON(text) {
    var doc;
    try { doc = JSON.parse(text); }
    catch (e) { refuse("waves-json", "waves.json does not parse: " + e.message); }
    if (!doc || typeof doc !== "object")
      refuse("waves-json", "waves.json is not an object");
    if (!Array.isArray(doc.voices))
      refuse("waves-json", "waves.json has no voices array");
    if (doc.voices.length !== CHANNELS)
      refuse("mix-voices", "a mix has " + CHANNELS + " voices (got " +
             doc.voices.length + ")");
    var m = newMix();
    for (var c = 0; c < CHANNELS; c++) {
      var src = doc.voices[c] || {}, v = m.voices[c];
      if (src.mode !== undefined) setMode(m, c, src.mode);
      if (src.wave !== undefined) assignWave(m, c, checkedWave(c, src.wave));
      if (src.freq !== undefined) setFreq(m, c, src.freq);
      if (src.al !== undefined) setLevel(m, c, src.al);
      if (src.balance !== undefined) setBalance(m, c, src.balance);
      if (src.on !== undefined) v.on = !!src.on;
      if (src.mute !== undefined) v.mute = !!src.mute;
      if (src.solo !== undefined) v.solo = !!src.solo;
      /* every voice carries an NF so the file has one voice shape; only 4
       * and 5 can put it to use, and setNoise refuses the others */
      if (src.noise && src.noise.nf !== undefined) {
        checkInt(src.noise.nf, 0, NOISE_MAX, "noise-range", "noise frequency (NF)");
        if (c >= 4) setNoise(m, c, { nf: src.noise.nf });
        else v.noise = { nf: src.noise.nf };
      }
      if (src.dda !== undefined) {
        if (!Array.isArray(src.dda)) refuse("waves-json", "voice " + c + "'s dda is not an array");
        for (var i = 0; i < src.dda.length; i++)
          checkInt(src.dda[i], 0, WAVE_MAX, "dda-range", "DDA sample byte");
        v.dda = src.dda.slice();
      }
      if (src.env) setEnv(m, c, src.env);
    }
    if (doc.master && doc.master.balance !== undefined)
      setMasterBalance(m, doc.master.balance);
    if (doc.lfo) {
      if (doc.lfo.ctl) setLfo(m, { freq: doc.lfo.freq, ctl: doc.lfo.ctl });
      else m.lfo = { freq: doc.lfo.freq === undefined ? 0xFF : doc.lfo.freq, ctl: 0 };
    }
    return m;
  }

  function checkedWave(c, values) {
    if (!Array.isArray(values) || values.length !== STEPS)
      refuse("wave-range", "voice " + c + " needs " + STEPS + " wave steps");
    for (var i = 0; i < STEPS; i++)
      checkInt(values[i], 0, WAVE_MAX, "wave-range", "voice " + c + " step " + i);
    return values.slice();
  }

  /* Write the mix back into the toy's files.  waves.json only — the other
   * panels' files are theirs — and returns which names changed, so the page
   * repaints only when something did (the same contract as pce-screen.js's
   * syncFiles). */
  function syncFiles(m, files) {
    var text = toJSON(m), changed = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (f.name !== "waves.json") continue;
      if (f.source !== text) { f.source = text; changed.push(f.name); }
    }
    return changed;
  }

  /* Read the mix out of a toy's files.  An empty waves.json (the page's
   * default — `{"version":1,"channels":[]}`) is a new mix, not an error. */
  function fromFiles(files) {
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (f.name !== "waves.json") continue;
      var doc;
      try { doc = JSON.parse(f.source); }
      catch (e) { refuse("waves-json", "waves.json does not parse: " + e.message); }
      if (doc && Array.isArray(doc.channels) && !doc.voices) return newMix();
      if (doc && Array.isArray(doc.voices) && !doc.voices.length) return newMix();
      return fromJSON(f.source);
    }
    return newMix();
  }

  return {
    CHANNELS: CHANNELS,
    STEPS: STEPS,
    WAVE_MAX: WAVE_MAX,
    FREQ_MAX: FREQ_MAX,
    AL_MAX: AL_MAX,
    BAL_MAX: BAL_MAX,
    LFREQ_MAX: LFREQ_MAX,
    LFO_CTL_MAX: LFO_CTL_MAX,
    NOISE_MAX: NOISE_MAX,
    ENV_MAX: ENV_MAX,
    MODES: MODES,
    NOISE_VOICES: NOISE_VOICES,
    VERSION: VERSION,
    A4_FREQ: A4_FREQ,

    newMix: newMix,
    demoMix: demoMix,
    voice: voice,
    setMode: setMode,
    setDdaLevel: setDdaLevel,
    setMute: setMute,
    setSolo: setSolo,
    setEnv: setEnv,
    setMasterBalance: setMasterBalance,
    setWave: setWave,
    paintStep: paintStep,
    setPreset: setPreset,
    setFreq: setFreq,
    setLevel: setLevel,
    setBalance: setBalance,
    setNoise: setNoise,
    setChannelOn: setChannelOn,
    setLfo: setLfo,

    audible: audible,
    soundOf: soundOf,
    writes: writes,
    writesOf: writesOf,
    render: render,
    meters: meters,
    vlOf: vlOf,
    dbFromVl: dbFromVl,

    toneHz: toneHz,
    freqForHz: freqForHz,
    noteName: noteName,
    noteFreq: noteFreq,
    centsOff: centsOff,
    stepNote: stepNote,

    envelope: envelope,
    releaseRamp: releaseRamp,
    trigger: trigger,
    release: release,
    reset: reset,
    controlWord: controlWord,

    ddaBytes: ddaBytes,
    fromEvents: fromEvents,
    toJSON: toJSON,
    fromJSON: fromJSON,
    fromFiles: fromFiles,
    syncFiles: syncFiles
  };
});
