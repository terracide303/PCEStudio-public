/*
 * pce-psg.js — PCEStudio HuC6280 PSG audio model (card #34).
 *
 * Produces the exact 16-bit stereo PCM that Mednafen 1.32.1's pce_fast
 * core records for a given ROM, from nothing but the ROM's PSG register
 * write trace and its per-frame CPU cycle durations.  The PSG plays into
 * PCEStudio's browser renderer the same way the VDC/VCE models do, so this
 * is an event-driven model, not a CPU emulator: genpsg.py (tools/) authors
 * the ROM and simulates its instruction stream (the HuC6280 cycle counts
 * and Mednafen's per-scanline timeslice schedule, huc6280.cpp/vdc.cpp) into
 * the trace this module consumes.
 *
 * Register semantics (R0-R9) are documented from the Hudson HuC6280 PSG
 * manual with page references in docs/PSG.md.  Everything the manual does
 * not pin down numerically — the noise LFSR taps, the volume-update
 * scheduling, and the band-limited output stage — is replicated from
 * Mednafen 1.32.1 (GPL-2.0+): src/pce_fast/psg.cpp (PSG core) and
 * src/sound/Blip_Buffer.cpp/.h (Blip_Buffer 0.4.1, LGPL, used by the pce
 * core's PSG), with line-level notes in the code below.  The goal is a
 * sample-exact match with Mednafen's own recorded WAV (tests/check-psg.js),
 * so every int32 wraparound, table entry and scheduling quirk of the
 * reference code is reproduced verbatim, including its known inaccuracies.
 * Where Mednafen itself is unproven against hardware (the noise polynomial:
 * GAP-14 in docs/PLAN.md — the manual gives the noise clock but no shift
 * register), the model follows Mednafen and docs/PSG.md says NOT PROVEN.
 *
 * Input (see tools/genpsg.py for where the values come from):
 *   events: [{f, t, reg, value}] — PSG writes at instruction-end CPU
 *           cycles, f = frame index, t = cycle within that frame (each
 *           frame's CPU timestamp restarts at 0); reg 0-9 = $0800-$0809
 *   frames: {t0, extra, pattern} — frame durations in CPU cycles: frame
 *           0's, then the non-steady frames 1..k (register writes and
 *           delay loops still running, k = the last register write's
 *           frame), then the steady-state pattern that repeats afterwards
 *           (per-frame overshoot of Mednafen's 455-cycle scanline budget)
 *
 * Output: Int16Array of interleaved L/R samples at 44100 Hz, exactly the
 * length Mednafen's WAV has for the same number of frames.
 *
 * Dual use: CommonJS module in Node (tests/check-psg.js) and a browser
 * global (renderer/index.html) via a UMD-style wrapper, like pce-bg.js.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.psg = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---- constants of the reference pipeline ------------------------------ */
  var CLOCK = 7159090;                 /* PCE_MASTER_CLOCK / 3, pce_fast */
  var SAMPLE_RATE = 44100;
  /* Blip_Buffer::clock_rate_factor: floor(sample_rate / clock * 2^32 + .5)
   * (Blip_Buffer.cpp).  Exact in a double: ~2.6456615e7 < 2^53. */
  var FACTOR = Math.floor(SAMPLE_RATE / CLOCK * 4294967296 + 0.5);
  var ACCURACY = 32;
  var TWO32 = 4294967296;
  var BLIP_RES = 256;                  /* 1 << BLIP_PHASE_BITS (8) */
  var QUALITY = 12;                    /* Blip_Synth<blip_good_quality, 8192> */
  var IMPULSE_SIZE = BLIP_RES / 2 * QUALITY + 1;    /* 1537 */

  function toInt16(v) {
    /* C (short) cast: truncate int32 to [-32768, 32767] */
    v = v % 65536;
    if (v > 32767) v -= 65536;
    if (v < -32768) v += 65536;
    return v;
  }

  /* ---- the band-limited impulse table (Blip_Synth_::treble_eq + ::volume_unit)
   * Blip_Buffer.cpp.  The PSG calls Synth.treble_eq(-2.0) then SetVolume(1.0)
   * -> volume_unit(1/6/8192) (psg.cpp constructor), i.e. the table below. */

  function genSinc(out, count, oversample, treble, cutoff) {
    /* Blip_Buffer.cpp gen_sinc(), double math, float32 stores */
    if (cutoff >= 0.999) cutoff = 0.999;
    if (treble < -300.0) treble = -300.0;
    if (treble > 5.0) treble = 5.0;
    var maxh = 4096.0;
    var rolloff = Math.pow(10.0, 1.0 / (maxh * 20.0) * treble / (1.0 - cutoff));
    var powAN = Math.pow(rolloff, maxh - maxh * cutoff);
    var toAngle = Math.PI / 2 / maxh / oversample;
    for (var i = 0; i < count; i++) {
      var angle = ((i - count) * 2 + 1) * toAngle;
      var c = rolloff * Math.cos((maxh - 1.0) * angle) - Math.cos(maxh * angle);
      var cosNCAngle = Math.cos(maxh * cutoff * angle);
      var cosNC1Angle = Math.cos((maxh * cutoff - 1.0) * angle);
      var cosAngle = Math.cos(angle);
      c = c * powAN - rolloff * cosNC1Angle + cosNCAngle;
      var d = 1.0 + rolloff * (rolloff - cosAngle - cosAngle);
      var b = 2.0 - cosAngle - cosAngle;
      var a = 1.0 - cosAngle - cosNCAngle + cosNC1Angle;
      out[i] = Math.fround((a * d + c * b) / (b * d));
    }
  }

  function buildImpulses() {
    /* blip_eq_t(-2.0): treble -2 dB, rolloff_freq 0, sample_rate 44100,
     * cutoff_freq 0 (Blip_Buffer.h); count = half_size = 1408. */
    var HALF_SIZE = BLIP_RES / 2 * (QUALITY - 1);
    var FIMP_SIZE = BLIP_RES / 2 * (16 - 1) + BLIP_RES * 2;  /* 2432 */
    var fimp = new Array(FIMP_SIZE);

    /* eq.generate(&fimpulse[256], 1408) */
    var oversample = BLIP_RES * 2.25 / HALF_SIZE + 0.85;
    var halfRate = SAMPLE_RATE * 0.5;
    genSinc(fimp, HALF_SIZE, BLIP_RES * oversample, -2.0, 0.0);
    /* Hamming half-window, float32 multiply (generate() tail) */
    var toFraction = Math.PI / (HALF_SIZE - 1);
    for (var i = HALF_SIZE; i--;) {
      var w = Math.fround(0.54 - Math.fround(0.46 *
              Math.fround(Math.cos(i * toFraction))));
      fimp[BLIP_RES + i] = Math.fround(fimp[i] * w);
    }
    /* mirror slightly past center */
    for (i = BLIP_RES; i--;)
      fimp[BLIP_RES + HALF_SIZE + i] = fimp[BLIP_RES + HALF_SIZE - 1 - i];
    for (i = 0; i < BLIP_RES; i++) fimp[i] = 0.0;

    /* rescale factor */
    var total = 0.0;
    for (i = 0; i < HALF_SIZE; i++) total += fimp[BLIP_RES + i];
    var rescale = 32768.0 / 2 / total;      /* base_unit = 32768 */
    var kernelUnit = 32768;

    /* integrate, first difference, rescale, convert to short */
    var impulses = new Array(IMPULSE_SIZE);
    var sum = 0.0, next = 0.0;
    for (i = 0; i < IMPULSE_SIZE; i++) {
      impulses[i] = toInt16(Math.floor((next - sum) * rescale + 0.5));
      sum += fimp[i];
      next += fimp[i + BLIP_RES];
    }

    adjustImpulse(impulses, kernelUnit);

    /* volume_unit(1.0/6/8192): 1/6 channel share, 8192 amplitude range */
    var factor = (1.0 / 6 / 8192) * 1073741824 / kernelUnit;   /* 2^30 */
    var shift = 0;
    while (factor < 2.0) { shift++; factor *= 2.0; }
    if (shift) {
      kernelUnit >>= shift;                 /* 8192 */
      var offset = 0x8000 + (1 << (shift - 1));
      var offset2 = 0x8000 >> shift;
      for (i = IMPULSE_SIZE; i--;)
        impulses[i] = toInt16(((impulses[i] + offset) >> shift) - offset2);
      adjustImpulse(impulses, kernelUnit);
    }
    var deltaFactor = Math.floor(factor + 0.5);   /* 3 */

    return { impulses: impulses, deltaFactor: deltaFactor };
  }

  function adjustImpulse(impulses, kernelUnit) {
    /* Blip_Synth_::adjust_impulse: sum pairs for each phase and add the
     * error correction to the end of the first half. */
    var size = IMPULSE_SIZE;
    for (var p = BLIP_RES; p-- >= BLIP_RES / 2;) {
      var p2 = BLIP_RES - 2 - p;
      var error = kernelUnit;
      for (var i = 1; i < size; i += BLIP_RES) {
        error -= impulses[i + p];
        error -= impulses[i + p2];
      }
      if (p === p2) error /= 2;     /* never: p2 = 254 - p, p >= 128 */
      impulses[size - BLIP_RES + p] =
        toInt16(impulses[size - BLIP_RES + p] + toInt16(error));
    }
  }

  /* ---- Blip_Buffer 0.4.1 reader (read_samples, Blip_Buffer.cpp/.h) ------ */
  /* One per stereo side: a linear buffer of int32 deltas, an offset in
   * resampled time, and the bass high-pass accumulator.  The reference
   * compacts the buffer on every read; reading once at the end is the
   * identical stream (compaction is FIFO-preserving), so no compaction. */

  function BlipSide(impulses, deltaFactor, samples) {
    this.impulses = impulses;
    this.deltaFactor = deltaFactor;
    this.offset = 0;
    this.accum = 0;                       /* reader_accum_ */
    this.buf = new Int32Array(samples + 18);
  }

  BlipSide.prototype.offsetResampled = function (t, delta) {
    /* Blip_Synth<12,8192>::offset_resampled, x86 tap layout (the RISC
     * path of the reference writes the same 12 products to the same
     * cells).  t is in PSG clocks; the reference's offset_inline passes
     * t * factor_ + offset_ (Blip_Buffer.h), i.e. absolute resampled
     * time, so endFrame's accumulated offset enters here.  int32
     * wraparound throughout. */
    if (delta === 0) return;              /* += 0 is an exact no-op */
    var time = t * FACTOR + this.offset;  /* exact in a double */
    var imp = this.impulses;
    delta = Math.imul(delta, this.deltaFactor);
    var buf = this.buf;
    var pos = Math.floor(time / TWO32);
    var phase = Math.floor(time / 16777216) & (BLIP_RES - 1);  /* >> 24 */
    /* forward half: impulses + blip_res - phase */
    var o = BLIP_RES - phase;
    buf[pos + 2] = (buf[pos + 2] + Math.imul(imp[o], delta)) | 0;
    buf[pos + 3] = (buf[pos + 3] + Math.imul(imp[o + 256], delta)) | 0;
    buf[pos + 4] = (buf[pos + 4] + Math.imul(imp[o + 512], delta)) | 0;
    buf[pos + 5] = (buf[pos + 5] + Math.imul(imp[o + 768], delta)) | 0;
    buf[pos + 6] = (buf[pos + 6] + Math.imul(imp[o + 1024], delta)) | 0;
    buf[pos + 7] = (buf[pos + 7] + Math.imul(imp[o + 1280], delta)) | 0;
    /* reverse half: impulses + phase */
    buf[pos + 8] = (buf[pos + 8] + Math.imul(imp[phase + 1280], delta)) | 0;
    buf[pos + 9] = (buf[pos + 9] + Math.imul(imp[phase + 1024], delta)) | 0;
    buf[pos + 10] = (buf[pos + 10] + Math.imul(imp[phase + 768], delta)) | 0;
    buf[pos + 11] = (buf[pos + 11] + Math.imul(imp[phase + 512], delta)) | 0;
    buf[pos + 12] = (buf[pos + 12] + Math.imul(imp[phase + 256], delta)) | 0;
    buf[pos + 13] = (buf[pos + 13] + Math.imul(imp[phase], delta)) | 0;
  };

  BlipSide.prototype.endFrame = function (t) {
    this.offset += t * FACTOR;            /* exact in a double */
  };

  BlipSide.prototype.readAll = function () {
    /* read_samples with the 10 Hz bass filter (bass_freq(10) ->
     * bass_shift 10) and the short clamp; returns an Int16Array */
    var count = Math.floor(this.offset / TWO32);
    var out = new Int16Array(count);
    var buf = this.buf;
    var accum = this.accum;
    for (var i = 0; i < count; i++) {
      var s = accum >> 14;
      if ((s << 16 >> 16) !== s) s = 0x7FFF - (s >> 24);
      out[i] = s;
      accum = (accum + buf[i] - (accum >> 10)) | 0;
    }
    this.accum = accum;
    return out;
  };

  /* ---- the PSG core (PCEFast_PSG, psg.cpp) ------------------------------ */

  var SCALE_TAB = [0x00, 0x03, 0x05, 0x07, 0x09, 0x0B, 0x0D, 0x0F,
                   0x10, 0x13, 0x15, 0x17, 0x19, 0x1B, 0x1D, 0x1F];

  function buildDbTable() {
    /* The constructor's volume table: flub = 2^(-vl/4), ~1.5 dB per step,
     * vl 0x1F forced to 0 (psg.cpp:162-179). */
    var dbtable = new Array(32);
    var volonly = new Array(32);
    for (var vl = 0; vl < 32; vl++) {
      var flub = 1;
      if (vl) flub /= Math.pow(2, 0.25 * vl);
      if (vl === 0x1F) flub = 0;
      var row = new Array(32);
      for (var samp = 0; samp < 32; samp++) {
        row[samp] = Math.trunc(flub * (samp * 2 - 0x1F) * 128);
      }
      volonly[vl] = Math.trunc(flub * 65536);
      dbtable[vl] = row;
    }
    return { dbtable: dbtable, volonly: volonly };
  }

  function Channel() {
    /* psg_channel (psg.h), power-on values from Power() (psg.cpp:539) */
    this.waveform = new Array(32);
    for (var i = 0; i < 32; i++) this.waveform[i] = 0;
    this.waveformIndex = 0;
    this.dda = 0;
    this.control = 0;
    this.noisectrl = 0;
    this.vl = [0x1F, 0x1F];
    this.counter = 8192;                  /* freq_cache of frequency 0 */
    this.freqCache = 8192;
    this.noiseFreqCache = 3968;           /* 0x1F - 0x00, RecalcNoiseFreqCache */
    this.noisecount = 1;
    this.lfsr = 1;
    this.sampAccum = 0;
    this.blipPrev = [0, 0];
    this.lastts = 0;
    this.frequency = 0;
    this.balance = 0;
    this.outMode = 0;                     /* 0 Off, 1 Noise, 2 Accum, 3 Norm */
  }

  function PSG() {
    this.imp = buildImpulses();
    this.db = buildDbTable();
    this.ch = [];
    for (var i = 0; i < 6; i++) this.ch.push(new Channel());
    this.select = 0;
    this.globalbalance = 0;
    this.lfofreq = 0;
    this.lfoctrl = 0;
    this.volUpdateCounter = 0;
    this.volUpdateWhich = 0;
    this.volUpdateVllatch = 0;
    this.volPending = false;
    this.lastts = 0;
  }

  /* ---- volume ----------------------------------------------------------------- */

  PSG.prototype.getVL = function (chnum, lr) {
    /* GetVL (psg.cpp:190): mixed 1.5 dB / 3 dB attenuation steps,
     * clamped to 0x1F */
    var ch = this.ch[chnum];
    var gbal = 0x1F - SCALE_TAB[(this.globalbalance >> (lr ? 0 : 4)) & 0xF];
    var bal = 0x1F - SCALE_TAB[(ch.balance >> (lr ? 0 : 4)) & 0xF];
    var al = 0x1F - (ch.control & 0x1F);
    var volReduction = gbal + bal + al;
    if (volReduction > 0x1F) volReduction = 0x1F;
    return volReduction;
  };

  /* ---- the four output stages ------------------------------------------- */

  PSG.prototype.outputNorm = function (timestamp, ch) {
    var sv = ch.dda;
    var s0 = this.db.dbtable[ch.vl[0]][sv];
    var s1 = this.db.dbtable[ch.vl[1]][sv];
    this.side[0].offsetResampled(timestamp, s0 - ch.blipPrev[0]);
    this.side[1].offsetResampled(timestamp, s1 - ch.blipPrev[1]);
    ch.blipPrev[0] = s0;
    ch.blipPrev[1] = s1;
  };

  PSG.prototype.outputNoise = function (timestamp, ch) {
    var sv = ((ch.lfsr & 1) << 5) - (ch.lfsr & 1);  /* 0 or 31 */
    var s0 = this.db.dbtable[ch.vl[0]][sv];
    var s1 = this.db.dbtable[ch.vl[1]][sv];
    this.side[0].offsetResampled(timestamp, s0 - ch.blipPrev[0]);
    this.side[1].offsetResampled(timestamp, s1 - ch.blipPrev[1]);
    ch.blipPrev[0] = s0;
    ch.blipPrev[1] = s1;
  };

  PSG.prototype.outputOff = function (timestamp, ch) {
    this.side[0].offsetResampled(timestamp, 0 - ch.blipPrev[0]);
    this.side[1].offsetResampled(timestamp, 0 - ch.blipPrev[1]);
    ch.blipPrev[0] = 0;
    ch.blipPrev[1] = 0;
  };

  PSG.prototype.outputAccum = function (timestamp, ch) {
    /* the high-frequency waveform average path: frequency <= 5 */
    var s0 = Math.imul(this.db.volonly[ch.vl[0]], (ch.sampAccum - 496)) >> 13;
    var s1 = Math.imul(this.db.volonly[ch.vl[1]], (ch.sampAccum - 496)) >> 13;
    this.side[0].offsetResampled(timestamp, s0 - ch.blipPrev[0]);
    this.side[1].offsetResampled(timestamp, s1 - ch.blipPrev[1]);
    ch.blipPrev[0] = s0;
    ch.blipPrev[1] = s1;
  };

  PSG.prototype.output = function (mode, timestamp, ch) {
    /* the four UpdateOutput function pointers of the reference */
    if (mode === 1) this.outputNoise(timestamp, ch);
    else if (mode === 2) this.outputAccum(timestamp, ch);
    else if (mode === 3) this.outputNorm(timestamp, ch);
    else this.outputOff(timestamp, ch);
  };

  /* ---- frequency caches -------------------------------------------------- */

  PSG.prototype.recalcFreqCache = function (chnum) {
    var ch = this.ch[chnum];
    if (chnum === 0 && (this.lfoctrl & 0x03)) {
      var shift = ((this.lfoctrl & 0x3) - 1) << 1;
      var la = this.ch[1].dda;
      var tmpFreq = ((ch.frequency + ((la - 0x10) << shift)) & 0xFFF) | 0;
      ch.freqCache = (tmpFreq ? tmpFreq : 4096) << 1;
    } else {
      ch.freqCache = (ch.frequency ? ch.frequency : 4096) << 1;
      if (chnum === 1 && (this.lfoctrl & 0x03))
        ch.freqCache *= this.lfofreq ? this.lfofreq : 256;
    }
  };

  PSG.prototype.recalcNoiseFreqCache = function (chnum) {
    var ch = this.ch[chnum];
    var freq = 0x1F - (ch.noisectrl & 0x1F);
    if (!freq) freq = 0x20;
    else freq <<= 6;
    freq <<= 1;
    ch.noiseFreqCache = freq;
  };

  PSG.prototype.recalcUOFunc = function (chnum) {
    var ch = this.ch[chnum];
    if (!(ch.control & 0xC0)) ch.outMode = 0;
    else if (ch.noisectrl & ch.control & 0x80) ch.outMode = 1;
    else if ((ch.control & 0xC0) === 0x80 && ch.freqCache <= 0xA &&
             (chnum !== 1 || !(this.lfoctrl & 0x80))) ch.outMode = 2;
    else ch.outMode = 3;
  };

  /* ---- register writes --------------------------------------------------- */

  PSG.prototype.write = function (timestamp, A, V) {
    A &= 0x0F;
    if (A === 0x00) {
      this.select = V & 0x07;
      return;                       /* no Update() on the select write */
    }
    this.update(timestamp);
    var ch = this.ch[this.select];
    switch (A) {
      case 0x01:                    /* global sound balance */
        this.globalbalance = V;
        this.volPending = true;
        break;
      case 0x02:                    /* channel frequency (LSB) */
        if (this.select > 5) return;
        ch.frequency = (ch.frequency & 0x0F00) | V;
        this.recalcFreqCache(this.select);
        this.recalcUOFunc(this.select);
        break;
      case 0x03:                    /* channel frequency (MSB) */
        if (this.select > 5) return;
        ch.frequency = (ch.frequency & 0x00FF) | ((V & 0x0F) << 8);
        this.recalcFreqCache(this.select);
        this.recalcUOFunc(this.select);
        break;
      case 0x04:                    /* channel enable, DDA, volume */
        if (this.select > 5) return;
        if ((ch.control & 0x40) && !(V & 0x40)) {
          /* DDA -> waveform mode: restart the wave from sample 0 */
          ch.waveformIndex = 0;
          ch.dda = ch.waveform[ch.waveformIndex];
          ch.counter = ch.freqCache;
        }
        if (!(ch.control & 0x80) && (V & 0x80)) {
          /* off -> on: advance one sample (unless entering DDA mode) */
          if (!(V & 0x40)) {
            ch.waveformIndex = (ch.waveformIndex + 1) & 0x1F;
            ch.dda = ch.waveform[ch.waveformIndex];
          }
        }
        ch.control = V;
        this.recalcFreqCache(this.select);
        this.recalcUOFunc(this.select);
        this.volPending = true;
        break;
      case 0x05:                    /* channel balance */
        if (this.select > 5) return;
        ch.balance = V;
        this.volPending = true;
        break;
      case 0x06:                    /* channel waveform data */
        if (this.select > 5) return;
        V &= 0x1F;
        if (!(ch.control & 0x40)) {
          ch.sampAccum -= ch.waveform[ch.waveformIndex];
          ch.waveform[ch.waveformIndex] = V;
          ch.sampAccum += ch.waveform[ch.waveformIndex];
        }
        if ((ch.control & 0xC0) === 0x00)
          ch.waveformIndex = (ch.waveformIndex + 1) & 0x1F;
        if (ch.control & 0x80) {
          /* updates the waveform value cache/latch regardless of DDA mode
           * being enabled (psg.cpp:305) */
          ch.dda = V;
        }
        break;
      case 0x07:                    /* noise enable and frequency */
        if (this.select > 5) return;
        if (this.select >= 4) {
          ch.noisectrl = V;
          this.recalcNoiseFreqCache(this.select);
          this.recalcUOFunc(this.select);
        }
        break;
      case 0x08:                    /* LFO frequency */
        this.lfofreq = V & 0xFF;
        this.recalcFreqCache(1);
        break;
      case 0x09:                    /* LFO trigger and control */
        if (V & 0x80) {
          this.ch[1].waveformIndex = 0;
          this.ch[1].dda = this.ch[1].waveform[this.ch[1].waveformIndex];
          this.ch[1].counter = this.ch[1].freqCache;
        }
        this.lfoctrl = V;
        this.recalcFreqCache(0);
        this.recalcUOFunc(0);
        this.recalcFreqCache(1);
        this.recalcUOFunc(1);
        break;
    }
  };

  /* ---- channel clocking -------------------------------------------------- */

  PSG.prototype.runChannel = function (lfoOn, chc, timestamp) {
    var ch = this.ch[chc];
    var runningTimestamp = ch.lastts;
    var runTime = timestamp - ch.lastts;
    ch.lastts = timestamp;
    if (!runTime) return;

    this.output(ch.outMode, runningTimestamp, ch);

    if (chc >= 4) {
      var freq = ch.noiseFreqCache;
      ch.noisecount -= runTime;
      if (ch.outMode === 1) {
        while (ch.noisecount <= 0) {
          this.clockLfsr(ch);
          this.outputNoise(timestamp + ch.noisecount, ch);
          ch.noisecount += freq;
        }
      } else {
        while (ch.noisecount <= 0) {
          this.clockLfsr(ch);
          ch.noisecount += freq;
        }
      }
    }

    /* D7 of control is 0: don't clock the counter at all.
     * LFO trigger set on ch1: don't clock the counter at all.
     * In DDA mode, don't clock the counter. (psg.cpp:387-392) */
    if (!(ch.control & 0x80) || (chc === 1 && (this.lfoctrl & 0x80)) ||
        (ch.control & 0x40))
      return;

    ch.counter -= runTime;

    if (!lfoOn && ch.freqCache <= 0xA) {
      /* high-frequency fast path: skip per-step updates */
      if (ch.counter <= 0) {
        var incCount = Math.floor((0 - ch.counter) / ch.freqCache) + 1;
        ch.counter += incCount * ch.freqCache;
        ch.waveformIndex = (ch.waveformIndex + incCount) & 0x1F;
        ch.dda = ch.waveform[ch.waveformIndex];
      }
    }

    while (ch.counter <= 0) {
      ch.waveformIndex = (ch.waveformIndex + 1) & 0x1F;
      ch.dda = ch.waveform[ch.waveformIndex];
      this.output(ch.outMode, timestamp + ch.counter, ch);
      if (lfoOn) {
        this.runChannel(false, 1, timestamp + ch.counter);
        this.recalcFreqCache(0);
        this.recalcUOFunc(0);
        /* not particularly accurate, but faster (psg.cpp:423) */
        ch.counter += (ch.freqCache <= 0xA) ? 0xA : ch.freqCache;
      } else {
        ch.counter += ch.freqCache;
      }
    }
  };

  PSG.prototype.clockLfsr = function (ch) {
    /* The noise LFSR: 18-bit, taps 0,1,11,12,17.  Taken from Mednafen
     * psg.cpp:366 with no provenance comment there, so the polynomial is
     * NOT PROVEN against hardware (GAP-14, docs/PLAN.md); the model
     * matches Mednafen, which is this card's requirement. */
    var lfsr = ch.lfsr;
    var newbit = ((lfsr >> 0) ^ (lfsr >> 1) ^ (lfsr >> 11) ^
                  (lfsr >> 12) ^ (lfsr >> 17)) & 1;
    ch.lfsr = (lfsr >> 1) | (newbit << 17);
  };

  /* ---- the update scheduler --------------------------------------------- */

  PSG.prototype.update = function (timestamp) {
    var runTime = timestamp - this.lastts;

    if (this.volPending && !this.volUpdateCounter && !this.volUpdateWhich) {
      this.volUpdateCounter = 1;
      this.volPending = false;
    }

    var lfoOn = !!(this.lfoctrl & 0x03);
    if (lfoOn) {
      if (!(this.ch[1].control & 0x80) || (this.lfoctrl & 0x80)) {
        lfoOn = false;
        this.recalcFreqCache(0);
        this.recalcUOFunc(0);
      }
    }

    var clocks = runTime;
    var runningTimestamp = this.lastts;

    while (clocks > 0) {
      var chunkClocks = clocks;
      if (this.volUpdateCounter > 0 && chunkClocks > this.volUpdateCounter)
        chunkClocks = this.volUpdateCounter;

      runningTimestamp += chunkClocks;
      clocks -= chunkClocks;

      if (lfoOn) {
        this.runChannel(true, 0, runningTimestamp);
        for (var chc = 1; chc < 6; chc++)
          this.runChannel(false, chc, runningTimestamp);
      } else {
        for (chc = 0; chc < 6; chc++)
          this.runChannel(false, chc, runningTimestamp);
      }

      if (this.volUpdateCounter > 0) {
        this.volUpdateCounter -= chunkClocks;
        if (!this.volUpdateCounter) {
          /* the staggered volume machine: read GetVL for one channel/lr,
           * apply it one unit later; reads 255 units apart, pairs
           * staggered by 1, full cycle 4096 (psg.cpp:487-524) */
          var phase = this.volUpdateWhich & 1;
          var lr = ((this.volUpdateWhich >> 1) & 1) ^ 1;
          var chnum = this.volUpdateWhich >> 2;
          if (!phase) {
            if (chnum < 6) this.volUpdateVllatch = this.getVL(chnum, lr);
          } else {
            if (chnum < 6) this.ch[chnum].vl[lr] = this.volUpdateVllatch;
          }
          this.volUpdateWhich = (this.volUpdateWhich + 1) & 0x1F;
          if (this.volUpdateWhich)
            this.volUpdateCounter = phase ? 1 : 255;
          else if (this.volPending) {
            this.volUpdateCounter = phase ? 1 : 255;
            this.volPending = false;
          }
        }
      }

      this.lastts = runningTimestamp;
    }
  };

  PSG.prototype.endFrame = function (timestamp) {
    this.update(timestamp);
    this.lastts = 0;
    for (var chc = 0; chc < 6; chc++) this.ch[chc].lastts = 0;
  };

  /* ---- the trace-driven renderer ---------------------------------------- */

  /* frame k's duration: t0, then the non-steady frames (register writes
   * and delay loops still running), then the periodic idle tail */
  function frameT(frames, k) {
    var extra = frames.extra || [];
    if (k === 0) return frames.t0;
    if (k <= extra.length) return extra[k - 1];
    return frames.pattern[(k - 1 - extra.length) % frames.pattern.length];
  }

  function render(events, frames, count) {
    /* events: [{f, t, reg, value}] with f the frame index and t the
     * in-frame instruction-end cycle; frames: {t0, extra, pattern};
     * count: the number of frames.  Returns {pcm, sampleRate, frames}. */
    var psg = new PSG();
    var totalTime = 0;
    for (var k = 0; k < count; k++) totalTime += frameT(frames, k);
    var samples = Math.floor(totalTime * FACTOR / TWO32);
    psg.side = [new BlipSide(psg.imp.impulses, psg.imp.deltaFactor, samples),
                new BlipSide(psg.imp.impulses, psg.imp.deltaFactor, samples)];

    var byFrame = [];
    for (var e = 0; e < events.length; e++) {
      var ev = events[e];
      (byFrame[ev.f] = byFrame[ev.f] || []).push(ev);
    }

    for (k = 0; k < count; k++) {
      var Tk = frameT(frames, k);
      var list = byFrame[k];
      if (list) {
        for (var i = 0; i < list.length; i++)
          psg.write(list[i].t, list[i].reg, list[i].value);
      }
      psg.endFrame(Tk);
      psg.side[0].endFrame(Tk);
      psg.side[1].endFrame(Tk);
    }

    var left = psg.side[0].readAll();
    var right = psg.side[1].readAll();
    var pcm = new Int16Array(left.length * 2);
    for (var i = 0; i < left.length; i++) {
      pcm[i * 2] = left[i];
      pcm[i * 2 + 1] = right[i];
    }
    return { pcm: pcm, sampleRate: SAMPLE_RATE, frames: count };
  }

  return {
    render: render,
    CLOCK: CLOCK,
    SAMPLE_RATE: SAMPLE_RATE,
    FACTOR: FACTOR
  };
});
