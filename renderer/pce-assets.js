/*
 * pce-assets.js — the ASSETS tab's model (card #99).
 *
 * ppu.toys' ASSETS tab (Dennis, 2026-10-29) is three things in one pane: the
 * toy's memory as three bars (VRAM, CGRAM, ARAM), the songs it holds, and a
 * list of built-in samples that are "not in sound RAM" until you Place one.
 * The PC Engine's answer keeps the shape and changes the contents:
 *
 *   bars   VRAM 0x8000 words, filled from the regions renderer/pce-panels.js
 *          vramMap() finds (the BAT, the tiles, the sprite patterns, the SAT,
 *          free); CRAM 512 colours, split 256 background / 256 sprites as the
 *          VCE splits them; ROM up to 1 MB (the HuCard, #57) instead of
 *          ARAM, holding the code (renderer/pce-validate.js's estimate),
 *          the asset files, the songs and the instruments.
 *   songs  the toy's songs.json, each listed as "N notes · M patterns" like
 *          theirs.  A .dmf read by renderer/pce-dmf.js summarises through
 *          fromDmf(), so the counts are the module's, not a guess.
 *   sounds fifteen built-in PC Engine instruments with ppu.toys' names.  The
 *          eight melodic ones are a 32-step 5-bit wave (the PSG's R6) plus a
 *          volume envelope; the seven drums are noise presets on channels 5
 *          and 6 (the only two with the generator, R7).  Every wave below is
 *          generated here from a harmonic series — no sample, no wavetable
 *          and no code is copied from anywhere.
 *   sources (card #156) — the same list ppu.toys shows: the art as NAMED
 *          sources, not pixels buried in code.  sources.json names each
 *          source with the ranges it owns in the panels' three asset files
 *          (tiles.json, palettes.json, sprites.json — the same documents
 *          pce-screen.js and pce-sat.js parse); sources() reads it with the
 *          panels' own models, so the placement it reports is the placement
 *          the #117 importer puts into VRAM and CRAM, and each entry's
 *          preview is drawn from the files' own pixels and palettes.
 *
 * Playing one for the evidence goes through renderer/pce-psg.js, the
 * sample-exact Mednafen model (#34): traceFor() writes the same registers a
 * toy would (channel select, frequency, R4/R5/R6/R7, and one R4 per frame for
 * the envelope) and play() renders PCM through it.  Nothing in this file
 * re-implements the PSG's tone, so an instrument cannot "sound right" here
 * and wrong on the console.
 *
 * Refusals carry a machine-readable `code`, the convention pce-wave.js and
 * pce-editor.js use:
 *   asset-json      a text that is not a JSON object
 *   asset-shape     the wrong document (no instruments/songs array)
 *   asset-wave      a wave that is not 32 steps of 0..31
 *   asset-envelope  an envelope whose size/loop/data disagree or is out of 0..31
 *   asset-noise     a drum on a channel without the noise generator, or NF off 0..31
 *   asset-duplicate an instrument the toy already has
 *   asset-name      a name that is not a flat identifier
 *
 * #156's sources add:
 *   source-json     a sources.json that is not a JSON object
 *   source-shape    the wrong document (no "sources" array, a bad entry)
 *   source-kind     a kind the studio does not know
 *   no-import       sources name picture files, but the panels' models are
 *                   not loaded, so the placement cannot be computed
 *
 * Dual use: CommonJS in Node (tests/check-assets.js) and a browser global
 * (renderer/studio.html) via the same UMD wrapper as pce-wave.js.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./pce-psg.js"),
                             function () { return require("./pce-editor.js"); },
                             function () { return require("./pce-sat.js"); });
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.assets = factory(root.PCEStudio.psg,
      function () { return root.PCEStudio.editor; },
      function () { return root.PCEStudio.sat; });
  }
})(typeof self !== "undefined" ? self : this, function (psg, editorDep, satDep) {
  "use strict";

  var CLOCK = 7159090;              /* PSG clock, pce-psg.js */
  var TONE_DIV = 64;                /* 32 wave steps x 2: f = CLOCK/(64*F) */
  var FREQ_MAX = 4095;              /* R2/R3 are 12 bits */
  var WAVE_STEPS = 32;              /* R6 is written 32 times per wave */
  var WAVE_MAX = 0x1F;              /* a wave sample is 5 bits */
  var AL_MAX = 31;                  /* R4 bits 0-4, the channel level */
  var NOISE_MAX = 0x1F;             /* R7 bits 0-4, NF */
  var CHANNELS = 6;                 /* the HuC6280 PSG's voices */
  var NOISE_CHANNELS = [4, 5];      /* 0-based: channels 5 and 6 (R7, PSG PB-6) */

  var VRAM_WORDS = 32768;           /* 0x8000 words */
  var CRAM_ENTRIES = 512;           /* the VCE's 9-bit palette */
  var BG_ENTRIES = 256;             /* CRAM $000-$0FF: the background */
  var ROM_LIMIT = 1048576;          /* the HuCard's 1 MB (#57) */
  var FRAME_CLOCKS = 119318;        /* 7.15909 MHz / 60, pce-validate.js */

  function refuse(code, message) {
    var e = new Error(message);
    e.code = code;
    throw e;
  }

  function isInt(v) { return typeof v === "number" && isFinite(v) && v % 1 === 0; }

  /* ---- pitch -------------------------------------------------------------
   * The PSG's frequency register F divides the clock by 64 (32 wave steps x
   * 2 halves: psg.cpp RecalcFreqCache does `frequency << 1`, PSG PB-3).
   * A4 = 440 Hz is F = 254 (440.4 Hz) — pce-wave.js's own example. */
  function freqFor(hz) {
    if (!isFinite(hz) || hz <= 0) return FREQ_MAX;
    var f = Math.round(CLOCK / (TONE_DIV * hz));
    return Math.max(1, Math.min(FREQ_MAX, f));
  }

  function toneHz(freq) {
    var f = Math.max(1, Math.min(FREQ_MAX, Math.round(freq || 0)));
    return CLOCK / (TONE_DIV * f);
  }

  /* Equal temperament, A4 = 440 Hz, midi 69.  Written out rather than read
   * from a table so a note name is one arithmetic step. */
  var SEMITONE = { c: 0, "c#": 1, db: 1, d: 2, "d#": 3, eb: 3, e: 4, f: 5,
                   "f#": 6, gb: 6, g: 7, "g#": 8, ab: 8, a: 9, "a#": 10,
                   bb: 10, b: 11 };

  function midiOf(name) {
    var m = /^([a-g](?:#|b)?)(-?\d+)$/i.exec(String(name || "").trim());
    if (!m) refuse("note-name", "a note is a name like C4 or A#3 (got " +
                   JSON.stringify(name) + ")");
    var s = SEMITONE[m[1].toLowerCase()];
    if (s === undefined) refuse("note-name", "unknown note " + name);
    return 12 * (parseInt(m[2], 10) + 1) + s;
  }

  function noteHz(name) {
    return 440 * Math.pow(2, (midiOf(name) - 69) / 12);
  }

  /* ---- the built-in instruments ------------------------------------------
   * A wave is generated from harmonics: value(t) = 16 + 15 * sum(a*sin(2*pi*n*t))
   * over one cycle, quantised to the PSG's 5 bits.  The harmonic lists are the
   * timbre — a bell has odd partials, a flute is nearly a sine — which is why
   * these are written as data and not as 15 hand-typed arrays. */
  function harmonics(list) {
    var out = [], total = 0, i, n;
    for (i = 0; i < list.length; i++) total += Math.abs(list[i][1]);
    for (i = 0; i < WAVE_STEPS; i++) {
      var v = 0;
      for (n = 0; n < list.length; n++) {
        v += list[n][1] * Math.sin(2 * Math.PI * list[n][0] * (i / WAVE_STEPS));
      }
      var q = Math.round(16 + 15 * v / total);
      out.push(Math.max(0, Math.min(WAVE_MAX, q)));
    }
    return out;
  }

  /* An envelope is HuTrack's shape (size, loop, data) stepped once per PSG
   * frame: loop === size means "stop at the last value".  The data are the
   * channel level R4 bits 0-4, so 31 is full and 0 is silent. */
  function envelope(data, loop) {
    return { size: data.length,
             loop: loop === undefined ? data.length : loop,
             data: data.slice() };
  }

  var INSTRUMENTS = [
    /* --- the eight melodic: a wave plus a volume envelope --- */
    { id: "piano", name: "piano", kind: "wave", channel: 0,
      wave: harmonics([[1, 1], [2, 0.55], [3, 0.35], [4, 0.22], [5, 0.15],
                       [6, 0.1], [7, 0.07], [8, 0.05]]),
      envelope: envelope([31, 29, 25, 21, 18, 15, 13, 11,
                          10, 9, 8, 7, 6, 6, 5, 5]),
      about: "bright strike, harmonics falling away" },
    { id: "bass", name: "bass", kind: "wave", channel: 0,
      wave: harmonics([[1, 1], [2, 0.35], [3, 0.12], [4, 0.05]]),
      envelope: envelope([31, 31, 30, 28, 26, 24, 23, 22,
                          21, 20, 20, 19, 19, 18, 18, 17], 15),
      about: "fundamental with a little second harmonic" },
    { id: "lead", name: "lead", kind: "wave", channel: 0,
      wave: harmonics([[1, 1], [3, 0.33], [5, 0.2], [7, 0.14], [9, 0.11]]),
      envelope: envelope([31, 31, 30, 30, 29, 29, 28, 28, 28, 27, 27, 27], 11),
      about: "hollow odd harmonics, the classic PSG lead" },
    { id: "strings", name: "strings", kind: "wave", channel: 0,
      wave: harmonics([[1, 1], [2, 0.5], [3, 0.33], [4, 0.25], [5, 0.2],
                       [6, 0.16], [7, 0.14], [8, 0.12]]),
      envelope: envelope([8, 14, 20, 25, 28, 30, 31, 31,
                          30, 29, 29, 28, 28, 28], 13),
      about: "sawtooth, bowed in over four frames" },
    { id: "organ", name: "organ", kind: "wave", channel: 0,
      wave: harmonics([[1, 0.6], [2, 0.4], [3, 0.3], [4, 0.25], [6, 0.15],
                       [8, 0.1]]),
      envelope: envelope([0, 10, 20, 28, 31, 31, 31], 6),
      about: "drawbar partials, no decay" },
    { id: "bell", name: "bell", kind: "wave", channel: 0,
      wave: harmonics([[1, 0.5], [3, 0.6], [5, 0.45], [7, 0.3], [9, 0.2],
                       [11, 0.12]]),
      envelope: envelope([31, 27, 24, 21, 19, 17, 15, 13, 12, 11, 10, 9,
                          8, 7, 6, 5, 4, 4, 3, 3, 2, 2, 1, 1], 23),
      about: "odd partials and a long ring" },
    { id: "flute", name: "flute", kind: "wave", channel: 0,
      wave: harmonics([[1, 1], [2, 0.08], [3, 0.03]]),
      envelope: envelope([10, 20, 28, 31, 31, 31, 30, 30, 30, 31, 31], 9),
      about: "almost a sine, eased in" },
    { id: "pluck", name: "pluck", kind: "wave", channel: 0,
      wave: harmonics([[1, 1], [2, 0.7], [3, 0.5], [4, 0.35], [5, 0.25],
                       [6, 0.18]]),
      envelope: envelope([31, 26, 20, 15, 11, 8, 6, 4, 3, 2, 2, 1, 1, 0], 13),
      about: "a short, stringy decay" },

    /* --- the seven drums: noise on channel 5 (R7, PSG PB-6) --- */
    { id: "kick", name: "kick", kind: "noise", channel: 4, nf: 3,
      envelope: envelope([31, 31, 30, 29, 28, 26, 24, 22, 20, 18, 16, 14,
                          12, 10, 8, 6, 5, 4, 3, 2, 1, 1, 0]),
      about: "the slowest noise clock: a low thump" },
    { id: "snare", name: "snare", kind: "noise", channel: 4, nf: 12,
      envelope: envelope([31, 30, 28, 25, 22, 19, 16, 13, 10, 8, 6, 5, 4, 3,
                          2, 1, 0]),
      about: "mid noise with a short tail" },
    { id: "hat", name: "hat", kind: "noise", channel: 4, nf: 26,
      envelope: envelope([31, 24, 18, 13, 9, 6, 4, 2, 1, 0]),
      about: "high noise, gone in a tick" },
    { id: "ohat", name: "ohat", kind: "noise", channel: 4, nf: 26,
      envelope: envelope([31, 29, 27, 24, 22, 20, 18, 16, 14, 12, 10, 9, 8, 7,
                          6, 5, 4, 3, 2, 1, 0]),
      about: "the same clock as the hat, held open" },
    { id: "tom", name: "tom", kind: "noise", channel: 4, nf: 6,
      envelope: envelope([31, 30, 28, 25, 22, 19, 16, 13, 10, 8, 6, 4, 3, 2,
                          1, 0]),
      about: "low noise, shorter than the kick" },
    { id: "clap", name: "clap", kind: "noise", channel: 4, nf: 16,
      envelope: envelope([31, 30, 20, 31, 28, 14, 24, 10, 16, 6, 10, 3, 6, 2,
                          3, 1, 1, 0]),
      about: "three bursts, the way a clap is built" },
    { id: "crash", name: "crash", kind: "noise", channel: 4, nf: 29,
      envelope: envelope([31, 30, 29, 28, 27, 26, 24, 22, 20, 18, 16, 14, 12,
                          10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1, 0]),
      about: "the fastest noise clock, ringing out" }
  ];

  function byId(id) {
    for (var i = 0; i < INSTRUMENTS.length; i++)
      if (INSTRUMENTS[i].id === id) return INSTRUMENTS[i];
    return null;
  }

  /* What the list shows under a name: the PSG shape that makes the sound. */
  function descriptor(inst) {
    if (inst.kind === "noise")
      return "NOISE · channel " + (inst.channel + 1) + " · NF " + inst.nf;
    return "WAVE · 32 steps · envelope " + inst.envelope.size;
  }

  /* ---- playing one through the PSG model --------------------------------
   * The trace is the register writes a toy (or HuTrack) would make, in the
   * PSG's own order: select, then the channel's registers, and the wave as 32
   * R6 writes.  The envelope is one R4 write per frame, exactly what a
   * driver's volume envelope does. */
  function traceFor(inst, opts) {
    opts = opts || {};
    var note = opts.note === undefined ? "A4" : opts.note;
    var hz = typeof note === "number" ? note : noteHz(note);
    var freq = opts.freq !== undefined ? opts.freq : freqFor(hz);
    var frames = Math.max(2, Math.round(opts.frames || 30));
    var ch = inst.kind === "noise" ? inst.channel : (opts.channel || 0);
    var env = inst.envelope.data;
    var events = [];
    var t = 0;

    function wr(reg, value, f) {
      events.push({ f: f || 0, t: t, reg: reg, value: value });
      t += 6;                        /* ~6 cycles apart, the toy host's pace */
    }

    /* the power-on side: main volume full, the channel's balance centred
     * (4 bits a side, F both), then the channel selected */
    wr(1, 0xFF);
    wr(0, ch);
    wr(5, 0xFF);
    wr(2, freq & 0xFF);
    wr(3, (freq >> 8) & 0x0F);
    if (inst.kind === "noise") {
      wr(7, 0x80 | (inst.nf & NOISE_MAX));
    } else {
      for (var s = 0; s < WAVE_STEPS; s++) wr(6, inst.wave[s] & WAVE_MAX);
    }
    wr(4, 0x80 | env[0]);

    /* one R4 write per frame, the envelope stepping on */
    for (var k = 1; k < frames; k++) {
      var i = inst.allowLoop === false ? Math.min(k, env.length - 1)
                                     : envIndex(inst, k);
      events.push({ f: k, t: 0, reg: 0, value: ch });
      events.push({ f: k, t: 4, reg: 4, value: 0x80 | (env[i] & WAVE_MAX) });
    }
    return {
      events: events,
      frames: { t0: FRAME_CLOCKS, extra: [], pattern: [FRAME_CLOCKS] },
      count: frames,
      channel: ch,
      freq: freq,
      hz: toneHz(freq)
    };
  }

  /* The envelope's step at frame k: walk it once, then hold the loop point
   * (loop === size is a one-shot that holds its last value). */
  function envIndex(inst, k) {
    var env = inst.envelope, data = env.data;
    if (!data.length) return 0;
    if (k < data.length) return k;
    if (env.loop === undefined || env.loop == null || env.loop >= data.length)
      return data.length - 1;
    return env.loop + ((k - data.length) % (data.length - env.loop));
  }

  function levelAt(inst, k) {
    return inst.envelope.data[envIndex(inst, k)];
  }

  function play(inst, opts) {
    opts = opts || {};
    var t = traceFor(inst, opts);
    var pcm = psg.render(t.events, t.frames, t.count);
    return { pcm: pcm.pcm, sampleRate: pcm.sampleRate, frames: t.count,
             trace: t };
  }

  /* ---- reading the PCM --------------------------------------------------
   * What the evidence asks: is it audible (RMS/peak), and is the tone the
   * frequency the register asked for?  The fundamental is found by
   * autocorrelation over the sustained part — periodic for every wave shape,
   * unlike a zero-crossing count, which a harmonic-rich wave over-counts. */
  function rms(pcm, fromSample, toSample) {
    var n = pcm.length / 2;
    var a = Math.max(0, Math.floor(fromSample || 0));
    var b = Math.min(n, toSample === undefined ? n : Math.floor(toSample));
    var sum = 0, count = 0, peak = 0;
    for (var i = a; i < b; i++) {
      var v = pcm[i * 2];
      sum += v * v;
      if (Math.abs(v) > peak) peak = Math.abs(v);
      count++;
    }
    return { rms: count ? Math.sqrt(sum / count) : 0, peak: peak, samples: count };
  }

  function fundamental(pcm, sampleRate, fromSample, toSample) {
    var n = pcm.length / 2;
    var a = Math.max(0, Math.floor(fromSample || 0));
    var b = Math.min(n, toSample === undefined ? n : Math.floor(toSample));
    var len = b - a;
    if (len < 64) return null;
    /* The PSG's output carries a DC offset (a flat wave is silent at half
     * level, not at zero), and a DC term makes the correlation grow with the
     * lag — a sine would be reported as the lowest frequency in range.  So
     * the mean comes out first, and the fundamental is the SHORTEST lag
     * within 10 % of the best, not the tallest one: every multiple of the
     * period correlates as well as the period itself. */
    var mean = 0;
    var i;
    for (i = a; i < b; i++) mean += pcm[i * 2];
    mean /= len;
    var x = new Float64Array(len);
    var energy = 0;
    for (i = 0; i < len; i++) {
      x[i] = pcm[(a + i) * 2] - mean;
      energy += x[i] * x[i];
    }
    if (!energy) return { hz: 0, strength: 0 };
    var lo = Math.max(2, Math.floor(sampleRate / 4000));
    var hi = Math.min(len - 2, Math.ceil(sampleRate / 40));
    function at(l) {
      var acc = 0;
      for (var j = 0; j + l < len; j++) acc += x[j] * x[j + l];
      return acc / (len - l);
    }
    var corr = new Float64Array(hi + 2);
    var best = -Infinity, bestLag = 0, lag;
    for (lag = lo; lag <= hi; lag++) {
      corr[lag] = at(lag);
      if (corr[lag] > best) { best = corr[lag]; bestLag = lag; }
    }
    if (!bestLag || best <= 0) return { hz: 0, strength: 0 };
    var pick = bestLag;
    for (lag = lo + 1; lag < bestLag; lag++) {
      if (corr[lag] >= 0.9 * best &&
          corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1]) {
        pick = lag;
        break;
      }
    }
    /* parabolic interpolation around the chosen lag, for sub-sample accuracy */
    var y0 = corr[pick - 1], y1 = corr[pick], y2 = corr[pick + 1];
    var denom = y0 - 2 * y1 + y2;
    var delta = denom ? 0.5 * (y0 - y2) / denom : 0;
    if (!isFinite(delta) || Math.abs(delta) > 1) delta = 0;
    return { hz: sampleRate / (pick + delta),
             strength: best / (energy / len) };
  }

  /* ---- the bars ---------------------------------------------------------
   * Three gauges, each with its parts, so the panel can draw the fill the way
   * ppu.toys does.  `input`:
   *   state   the studio's frame model (render.state()), or null
   *   map     pce-panels.vramMap(state), or null — the #26 regions
   *   report  renderer/pce-validate.js's report, or null
   *   files   the toy's files ({name, source}[])
   *   sources sources(files), or null — #156: when a toy carries named
   *           sources, the VRAM and CRAM parts are the sources' own ranges
   *           (each with its first word/entry, so the panel can colour the
   *           fill per source) plus the rest as "other"
   */
  function bars(input) {
    input = input || {};
    var st = input.state || null;
    var map = input.map || null;
    var report = input.report || null;
    var files = input.files || [];
    var sources = input.sources || null;
    var out = [];

    /* VRAM: every word a region claims, free space excluded. */
    var vramParts = [], vramUsed = 0;
    if (map) {
      var kinds = {};
      var order = [];
      for (var i = 0; i < map.segments.length; i++) {
        var seg = map.segments[i];
        if (seg.kind === "free") continue;
        if (kinds[seg.kind] === undefined) { kinds[seg.kind] = 0; order.push(seg.kind); }
        kinds[seg.kind] += seg.words;
        vramUsed += seg.words;
      }
      if (sources && sources.length) {
        /* the sources' own ranges, and whatever they do not claim */
        var claimed = 0;
        for (i = 0; i < sources.length; i++) {
          var src = sources[i];
          var words = 0;
          for (var g = 0; g < src.vram.segments.length; g++)
            words += src.vram.segments[g].count;
          if (!words) continue;
          vramParts.push({ label: src.name, used: words,
                           first: src.vram.segments[0].first,
                           segments: src.vram.segments, source: true });
          claimed += words;
        }
        var rest = vramUsed - claimed;
        if (rest > 0)
          vramParts.push({ label: "other", used: rest, first: 0,
                           segments: [], source: false });
      } else {
        for (i = 0; i < order.length; i++)
          vramParts.push({ label: order[i], used: kinds[order[i]] });
      }
    }
    out.push({
      id: "vram", label: "VRAM", unit: "words",
      used: vramUsed, cap: VRAM_WORDS,
      hex: "0x8000", parts: vramParts,
      measured: !!map,
      note: map ? "the regions the frame uses (#26)"
                : "run the toy to measure its VRAM"
    });

    /* CRAM: the entries that hold a colour.  The VCE powers up to 0, and 0 is
     * a real colour (black), so the count is of entries the toy or the assets
     * leave non-zero — the same "is it in use" question ppu.toys' bar asks. */
    var bg = 0, spr = 0;
    if (st && st.cram) {
      for (i = 0; i < CRAM_ENTRIES; i++) {
        var w = (st.cram[i * 2] | (st.cram[i * 2 + 1] << 8)) & 0x1FF;
        if (!w) continue;
        if (i < BG_ENTRIES) bg++; else spr++;
      }
    }
    var cramParts;
    if (sources && sources.length) {
      cramParts = [];
      var cramClaimed = 0;
      for (i = 0; i < sources.length; i++) {
        var cs = sources[i];
        var entries = 0;
        for (g = 0; g < cs.cram.segments.length; g++)
          entries += cs.cram.segments[g].count;
        if (!entries) continue;
        cramParts.push({ label: cs.name, used: entries,
                         first: cs.cram.segments[0].first,
                         segments: cs.cram.segments, source: true });
        cramClaimed += entries;
      }
      var cramRest = bg + spr - cramClaimed;
      if (cramRest > 0)
        cramParts.push({ label: "other", used: cramRest, first: 0,
                         segments: [], source: false });
    } else {
      cramParts = [{ label: "BG", used: bg }, { label: "sprites", used: spr }];
    }
    out.push({
      id: "cram", label: "CRAM", unit: "colours",
      used: bg + spr, cap: CRAM_ENTRIES,
      hex: "512", measured: !!(st && st.cram),
      parts: cramParts,
      note: "512 entries: 256 background, 256 sprites"
    });

    /* ROM: the HuCard's 1 MB — the code the validator estimates, plus the
     * files the toy carries. */
    var code = report && report.budgets && report.budgets.rom
      ? report.budgets.rom.bytes : 0;
    var assetBytes = 0, songBytes = 0, instBytes = 0;
    for (i = 0; i < files.length; i++) {
      var n = files[i].name || "";
      var b = String(files[i].source || "").length;
      if (n === "songs.json") songBytes += b;
      else if (n === "instruments.json") instBytes += b;
      else if (n !== "main.lua") assetBytes += b;
    }
    var romUsed = code + assetBytes + songBytes + instBytes;
    out.push({
      id: "rom", label: "ROM", unit: "bytes",
      used: romUsed, cap: ROM_LIMIT,
      hex: "1 MB", measured: !!code,
      parts: [{ label: "code", used: code }, { label: "assets", used: assetBytes },
              { label: "songs", used: songBytes }, { label: "instruments", used: instBytes }],
      note: report && report.budgets
        ? "the validator's estimate + the toy's files"
        : "check the toy to measure its ROM"
    });
    return out;
  }

  /* ---- the toy's named sources (card #156) -------------------------------
   * sources.json names the toy's art the way ppu.toys does: each entry is a
   * name, a kind, and the ranges it owns inside the panels' three asset
   * documents — tiles.json's chars, palettes.json's rows, sprites.json's
   * patterns and SAT slots.  The studio lists them instead of pixels buried
   * in main.lua, and each one's "…" opens the tile/pattern grid with its
   * palette, drawn from the files' own pixels — so the preview IS the art,
   * not a re-render of it.
   *
   * Placement is the importer's (#117, pce-editor.js toPicture): a tile at
   * word char*16, the BAT at words 0..1023, a sprite pattern at
   * patternLayout's cell (a cell is 64 words; codes[] per pattern), the SAT
   * at SAT_ADDR + slot*4, and a palette row in 16 CRAM entries — background
   * rows from entry 0, sprite rows from entry 256.  sources() asks the
   * panels' own picture model (pce-sat.js pictureFromFiles, the same call
   * the importer makes) for the pattern cells, so the ranges it reports are
   * the words the toy's VRAM holds after the import.
   *
   * A range the files no longer hold is dropped with a NOTE, not refused:
   * the studio stays honest about what remains, but a toy whose art has
   * moved still opens.
   */
  var SOURCE_KINDS = { bg: 1, sprites: 1, tilesheet: 1, palette: 1 };
  var SOURCE_COLS = 16;            /* tiles per preview row, like a sheet */
  var SPATTERN_COLS = 8;           /* sprite patterns per preview row */
  var PALETTE_ROWS = 16;           /* background and sprites each hold 16 */

  function fmt(n) {
    var s = String(n), out = "";
    for (var i = 0; i < s.length; i++) {
      if (i && (s.length - i) % 3 === 0) out += ",";
      out += s[i];
    }
    return out;
  }

  function hex(n) { return "0x" + n.toString(16); }

  /* The VCE's 9-bit colour as RGB 0..252, the arithmetic pce-source.js uses
   * for its importer previews (one model, so the ASSETS preview and the
   * importer's agree pixel for pixel). */
  function rgbOf(word) {
    var c = word & 0x1FF;
    return [((c >> 3) & 7) * 36, ((c >> 6) & 7) * 36, (c & 7) * 36];
  }

  function parseDoc(text, name) {
    var doc;
    try { doc = JSON.parse(text); }
    catch (e) { refuse("source-json", name + " is not JSON: " + e.message); }
    if (!doc || typeof doc !== "object")
      refuse("source-shape", name + " needs an object");
    return doc;
  }

  /* A range check: {first, count} that lies inside max, {none} when the entry
   * claims no slots (count 0 — e.g. a source whose sprites the toy places by
   * code), or a drop note. */
  function rangeOk(r, name, max) {
    if (!r || !isInt(r.first) || !isInt(r.count) || r.first < 0 || r.count < 0)
      return { drop: true, note: name + ": a range needs a first and a count" };
    if (r.count === 0) return { none: true };
    if (r.first + r.count > max)
      return { drop: true, note: name + ": " + r.first + "+" + r.count +
               " runs past " + max + " — dropped" };
    return { first: r.first, count: r.count };
  }

  function sources(files) {
    var text = fileText(files, "sources.json");
    if (!text) return { sources: [], notes: [] };
    var doc = parseDoc(text, "sources.json");
    if (!Array.isArray(doc.sources))
      refuse("source-shape", "sources.json needs a \"sources\" array");
    var list = doc.sources;
    var notes = [], out = [];

    /* the documents, loaded only when an entry names them */
    var tilesDoc = null, palsDoc = null, spritesDoc = null;
    var edMod = null, codes = null;

    function docFor(name, name2) {
      var d = parseDoc(fileText(files, name), name2 || name);
      return d;
    }

    for (var s = 0; s < list.length; s++) {
      var raw = list[s];
      if (!raw || typeof raw !== "object")
        refuse("source-shape", "sources.json entry " + s + " is not an object");
      if (typeof raw.name !== "string" || !/^[A-Za-z0-9 _.-]+$/.test(raw.name))
        refuse("source-shape", "a source needs a name (entry " + s + ")");
      if (!SOURCE_KINDS[raw.kind])
        refuse("source-kind", raw.name + ": kind \"" + raw.kind +
               "\" is not one of bg, sprites, tilesheet, palette");
      if (!raw.tiles && !raw.map && !raw.patterns && !raw.sprites && !raw.palettes)
        refuse("source-shape", raw.name + ": an entry needs a range " +
               "(tiles, map, patterns, sprites, palettes)");

      var vram = { segments: [] }, cram = { segments: [] };
      var preview = null;

      /* tiles (and the BAT a background owns) */
      if (raw.tiles) {
        if (!tilesDoc) tilesDoc = docFor("tiles.json");
        var tiles = Array.isArray(tilesDoc.tiles) ? tilesDoc.tiles : [];
        var tr = rangeOk(raw.tiles, raw.name, tiles.length);
        if (tr.none) { /* claims no tiles */ }
        else if (tr.drop) notes.push(tr.note);
        else {
          var firstChar = tiles[tr.first].char;
          var lastTile = tiles[tr.first + tr.count - 1];
          if (!isInt(firstChar) || !lastTile || !isInt(lastTile.char))
            notes.push(raw.name + ": its tiles carry no character codes — dropped");
          else
            vram.segments.push({ what: "tiles", first: firstChar * 16,
                                 count: (lastTile.char + 1 - firstChar) * 16 });
        }
      }
      if (raw.map)
        vram.segments.push({ what: "map", first: 0, count: 1024 });

      /* sprite patterns and SAT slots: the panels' picture model decides the
       * cells, exactly as the importer places them */
      if (raw.patterns || raw.sprites) {
        if (!spritesDoc) spritesDoc = docFor("sprites.json");
        if (!edMod) {
          var e = typeof editorDep === "function" ? editorDep() : editorDep;
          var satM = typeof satDep === "function" ? satDep() : satDep;
          if (!e || !satM || !e.patternLayout || !satM.pictureFromFiles)
            refuse("no-import", raw.name + ": its placement needs the panels' " +
                   "picture model (pce-editor.js + pce-sat.js)");
          edMod = e;
          codes = edMod.patternLayout(satM.pictureFromFiles(files)).codes;
        }
        var patterns = Array.isArray(spritesDoc.patterns)
          ? spritesDoc.patterns : [];
        if (raw.patterns) {
          var pr = rangeOk(raw.patterns, raw.name, patterns.length);
          if (pr.none) { /* claims no patterns */ }
          else if (pr.drop) notes.push(pr.note);
          else {
            var last = pr.first + pr.count - 1;
            var w = patterns[last].width, h = patterns[last].height;
            var cells = (w / 16) * (h / 16);
            vram.segments.push({ what: "patterns",
                                 first: codes[pr.first] * 64,
                                 count: (codes[last] + cells - codes[pr.first]) * 64 });
          }
        }
        if (raw.sprites) {
          var sr = rangeOk(raw.sprites, raw.name, edMod.MAX_SPRITES);
          if (sr.none) { /* claims no SAT slots */ }
          else if (sr.drop) notes.push(sr.note);
          else
            vram.segments.push({ what: "sat",
                                 first: edMod.SAT_ADDR + sr.first * 4,
                                 count: sr.count * 4 });
        }
      }

      /* the palette rows, in CRAM entries: background rows from 0, sprite
       * rows from 256 (the VCE's split) */
      if (raw.palettes) {
        var side = raw.palettes.side === "spr" ? "spr"
          : raw.palettes.side === "bg" ? "bg" : null;
        if (!side)
          refuse("source-shape", raw.name + ": palettes.side is \"bg\" or \"spr\"");
        var palR = rangeOk(raw.palettes, raw.name, PALETTE_ROWS);
        if (palR.none) { /* claims no rows */ }
        else if (palR.drop) notes.push(palR.note);
        else
          cram.segments.push({ what: "palettes", side: side,
                               first: (side === "bg" ? 0 : 256) + palR.first * 16,
                               count: palR.count * 16 });
      }

      if (!vram.segments.length && !cram.segments.length) {
        notes.push(raw.name + ": none of its ranges fit the files — dropped");
        continue;
      }

      /* the preview: the source's own cells and the palette rows they use,
       * read from the files, laid out as a sheet */
      if (raw.kind === "sprites" && raw.patterns && spritesDoc) {
        var pr2 = rangeOk(raw.patterns, raw.name, patterns.length);
        if (pr2.drop) notes.push(pr2.note);
        else if (!pr2.none) {
          var sprites = Array.isArray(spritesDoc.sprites) ? spritesDoc.sprites : [];
          var fallback = raw.palettes && isInt(raw.palettes.first)
            ? raw.palettes.first : 0;
          preview = { cellW: 16, cellH: 16, cols: SPATTERN_COLS,
                      cells: [], palettes: [] };
          for (var p = pr2.first; p < pr2.first + pr2.count; p++) {
            var pat = patterns[p];
            var palRow = fallback;
            for (var q = 0; q < sprites.length; q++)
              if (sprites[q] && sprites[q].pattern === p && isInt(sprites[q].palette)) {
                palRow = sprites[q].palette; break;
              }
            preview.cells.push({
              cell: codes[p], palette: palRow,
              w: pat.width, h: pat.height,
              x: (p - pr2.first) % SPATTERN_COLS * 32,
              y: Math.floor((p - pr2.first) / SPATTERN_COLS) * 64,
              pixels: pat.pixels
            });
          }
        }
      } else if (raw.tiles && tilesDoc) {
        var tr2 = rangeOk(raw.tiles, raw.name, tiles.length);
        if (tr2.drop) notes.push(tr2.note);
        else if (!tr2.none) {
          preview = { cellW: 8, cellH: 8, cols: SOURCE_COLS,
                      cells: [], palettes: [] };
          for (var t = tr2.first; t < tr2.first + tr2.count; t++) {
            var tile = tiles[t];
            if (!tile || !Array.isArray(tile.pixels)) {
              notes.push(raw.name + ": tile " + t + " is missing — preview cut short");
              break;
            }
            preview.cells.push({
              char: tile.char, palette: tile.palette, w: 8, h: 8,
              x: (t - tr2.first) % SOURCE_COLS * 8,
              y: Math.floor((t - tr2.first) / SOURCE_COLS) * 8,
              pixels: tile.pixels
            });
          }
        }
      }
      if (preview && preview.cells.length) {
        /* the rows the cells use, in entry order, plus the rows the entry
         * claims, as the palette strip under the grid */
        var side2 = raw.kind === "sprites" ? "spr" : "bg";
        if (!palsDoc) palsDoc = docFor("palettes.json");
        var rowsDoc = side2 === "bg" ? palsDoc.background : palsDoc.sprites;
        rowsDoc = Array.isArray(rowsDoc) ? rowsDoc : [];
        var used = {};
        for (var c = 0; c < preview.cells.length; c++)
          used[preview.cells[c].palette] = 1;
        if (raw.palettes && isInt(raw.palettes.first) && isInt(raw.palettes.count))
          for (var r = raw.palettes.first;
               r < raw.palettes.first + raw.palettes.count; r++)
            used[r] = 1;
        var rowKeys = Object.keys(used);
        for (var k = 0; k < rowKeys.length; k++) {
          var row = +rowKeys[k];
          var words = rowsDoc[row];
          if (!Array.isArray(words) || words.length !== 16) {
            notes.push(raw.name + ": palette row " + row +
                       " is not in palettes.json — strip skips it");
            continue;
          }
          preview.palettes.push({ side: side2, row: row, words: words });
        }
      }

      var words = 0, colours = 0, bits = [];
      for (var g = 0; g < vram.segments.length; g++) {
        words += vram.segments[g].count;
        var seg = vram.segments[g];
        bits.push("VRAM " + hex(seg.first) + "-" + hex(seg.first + seg.count - 1) +
                  " " + seg.what);
      }
      for (g = 0; g < cram.segments.length; g++) {
        colours += cram.segments[g].count;
        seg = cram.segments[g];
        bits.push("CRAM " + seg.first + "-" + (seg.first + seg.count - 1));
      }
      var size = [];
      if (words) size.push(fmt(words) + " words");
      if (colours) size.push(fmt(colours) + " colours");
      out.push({
        name: raw.name, kind: raw.kind,
        size: size.length ? size.join(" · ") : "no ranges",
        placement: bits.join(" · "),
        vram: vram, cram: cram, preview: preview
      });
    }
    /* a range can be dropped by both the segment pass and the preview pass */
    var seen = {}, uniq = [];
    for (var n = 0; n < notes.length; n++) {
      if (seen[notes[n]]) continue;
      seen[notes[n]] = 1;
      uniq.push(notes[n]);
    }
    return { sources: out, notes: uniq };
  }

  /* Add Source (#123) records what it wrote: the entry replaces one of the
   * same name, or joins the list.  The ranges are the caller's — the
   * importer's files are replaced wholesale, so a re-import starts at 0. */
  function mergeSource(text, entry) {
    var doc = text ? parseDoc(text, "sources.json") : { version: 1, sources: [] };
    if (!Array.isArray(doc.sources))
      refuse("source-shape", "sources.json needs a \"sources\" array");
    if (!entry || typeof entry.name !== "string" ||
        !/^[A-Za-z0-9 _.-]+$/.test(entry.name))
      refuse("source-shape", "a source needs a name");
    var found = -1;
    for (var i = 0; i < doc.sources.length; i++)
      if (doc.sources[i] && doc.sources[i].name === entry.name) found = i;
    if (found < 0) doc.sources.push(entry);
    else doc.sources[found] = entry;
    return { doc: doc, text: JSON.stringify(doc, null, 2) + "\n" };
  }

  /* ---- the toy's instrument list (instruments.json) ---------------------
   * The file is created on the first "Add to toy", the way ppu.toys' Place
   * puts a built-in into the toy: the patch is copied into the toy's own
   * file, so it is no longer "built-in" and travels with the toy. */
  function emptyInstruments() {
    return { version: 1, instruments: [] };
  }

  function parseInstruments(text) {
    var doc;
    try { doc = JSON.parse(text); }
    catch (e) { refuse("asset-json", "instruments.json is not JSON: " + e.message); }
    if (!doc || typeof doc !== "object" || !Array.isArray(doc.instruments))
      refuse("asset-shape", "instruments.json needs an \"instruments\" array");
    return doc;
  }

  function checkInstrument(inst) {
    if (!inst || typeof inst.name !== "string" || !/^[A-Za-z0-9_-]+$/.test(inst.name))
      refuse("asset-name", "an instrument needs a flat name (got " +
             JSON.stringify(inst && inst.name) + ")");
    if (inst.kind === "wave") {
      if (!Array.isArray(inst.wave) || inst.wave.length !== WAVE_STEPS)
        refuse("asset-wave", inst.name + ": a wave is " + WAVE_STEPS + " steps (got " +
               (inst.wave ? inst.wave.length : "none") + ")");
      for (var i = 0; i < inst.wave.length; i++)
        if (!isInt(inst.wave[i]) || inst.wave[i] < 0 || inst.wave[i] > WAVE_MAX)
          refuse("asset-wave", inst.name + ": wave step " + i + " is " +
                 inst.wave[i] + ", and R6 is 5 bits (0..31)");
    } else if (inst.kind === "noise") {
      if (NOISE_CHANNELS.indexOf(inst.channel) < 0)
        refuse("asset-noise", inst.name + ": noise is on channels 5-6 only (R7)");
      if (!isInt(inst.nf) || inst.nf < 0 || inst.nf > NOISE_MAX)
        refuse("asset-noise", inst.name + ": NF is 0..31 (got " + inst.nf + ")");
    } else {
      refuse("asset-shape", inst.name + ": kind is \"wave\" or \"noise\"");
    }
    var env = inst.envelope;
    if (!env || !Array.isArray(env.data) || !env.data.length ||
        env.size !== env.data.length)
      refuse("asset-envelope", inst.name + ": an envelope is {size, loop, data} with size == data.length");
    for (i = 0; i < env.data.length; i++)
      if (!isInt(env.data[i]) || env.data[i] < 0 || env.data[i] > AL_MAX)
        refuse("asset-envelope", inst.name + ": envelope step " + i + " is " +
               env.data[i] + ", and the channel level is 0..31");
    if (env.loop !== undefined && env.loop !== null &&
        (!isInt(env.loop) || env.loop < 0 || env.loop > env.size))
      refuse("asset-envelope", inst.name + ": loop is 0..size");
    return inst;
  }

  /* The patch as it is stored in the toy: no `about`, no `id` beyond the name. */
  function stored(inst) {
    var o = { name: inst.name, kind: inst.kind, channel: inst.channel,
              envelope: { size: inst.envelope.size, loop: inst.envelope.loop,
                          data: inst.envelope.data.slice() },
              source: "built-in" };
    if (inst.kind === "wave") o.wave = inst.wave.slice();
    else o.nf = inst.nf;
    return o;
  }

  function newText(doc) { return JSON.stringify(doc, null, 2) + "\n"; }

  /* Add a built-in to the toy's instruments.json.  Returns the new text and
   * the stored patch; a name the toy already has is refused rather than
   * silently doubled. */
  function addInstrument(text, inst) {
    if (!inst) refuse("asset-name", "no instrument to add");
    checkInstrument(inst);
    var doc = text ? parseInstruments(text) : emptyInstruments();
    for (var i = 0; i < doc.instruments.length; i++)
      if (doc.instruments[i] && doc.instruments[i].name === inst.name)
        refuse("asset-duplicate", "the toy already has " + inst.name);
    var patch = stored(inst);
    doc.instruments.push(patch);
    return { doc: doc, text: newText(doc), instrument: patch };
  }

  function removeInstrument(text, name) {
    var doc = parseInstruments(text);
    var kept = [];
    for (var i = 0; i < doc.instruments.length; i++)
      if (doc.instruments[i] && doc.instruments[i].name !== name)
        kept.push(doc.instruments[i]);
    doc.instruments = kept;
    return { doc: doc, text: newText(doc) };
  }

  /* The toy's file of that name, or null. */
  function fileText(files, name) {
    for (var i = 0; i < (files || []).length; i++)
      if (files[i] && files[i].name === name) return files[i].source;
    return null;
  }

  /* ---- songs -------------------------------------------------------------
   * songs.json is a list; each entry is either a summary a .dmf produced
   * (fromDmf) or a blank one "+ Add" made.  The list shows what ppu.toys
   * shows — the name and "N notes · M patterns" — and nothing pretends to
   * play a song the studio cannot yet export (#35's route). */
  function emptySongs() { return { version: 1, songs: [] }; }

  function parseSongs(text) {
    var doc;
    try { doc = JSON.parse(text); }
    catch (e) { refuse("asset-json", "songs.json is not JSON: " + e.message); }
    if (!doc || typeof doc !== "object" || !Array.isArray(doc.songs))
      refuse("asset-shape", "songs.json needs a \"songs\" array");
    return doc;
  }

  /* A song entry from a module read by renderer/pce-dmf.js: the notes are the
   * note cells in the patterns the order list uses, and the pattern count is
   * the distinct patterns in that list — "12 notes · 1 patterns" is what that
   * arithmetic gives for such a song. */
  function fromDmf(mod) {
    if (!mod || !Array.isArray(mod.patterns) || !Array.isArray(mod.orderMatrix))
      refuse("asset-shape", "fromDmf needs a module pce-dmf.js read");
    var used = {}, patternSet = {};
    var notes = 0, rows = 0, ch, o, p, r;
    for (ch = 0; ch < mod.orderMatrix.length; ch++) {
      var order = mod.orderMatrix[ch] || [];
      for (o = 0; o < order.length; o++) {
        p = order[o];
        if (p === undefined || p === null) continue;
        if (p < 0 || p >= mod.patterns.length)
          refuse("asset-shape", "the order list names pattern " + p +
                 ", and the module has " + mod.patterns.length);
        patternSet[p] = true;
        used[p] = true;
      }
    }
    for (var key in used) {
      var pat = mod.patterns[key];
      if (!pat) continue;
      for (ch = 0; ch < CHANNELS; ch++) {
        var chan = pat[ch] || pat[String(ch)];
        if (!Array.isArray(chan)) continue;
        for (r = 0; r < chan.length; r++) {
          rows++;
          if (chan[r] && chan[r].note) notes++;
        }
      }
    }
    return {
      name: typeof mod.songName === "string" && mod.songName
        ? mod.songName : "song",
      dmf: true,
      notes: notes,
      patterns: Object.keys(patternSet).length,
      rows: mod.rowsPerPattern,
      speed: mod.tick1,
      orders: mod.orderCount,
      channels: CHANNELS
    };
  }

  function songLabel(song) {
    if (!song) return "";
    var n = song.notes || 0, p = song.patterns || 0;
    return n + " notes · " + p + " patterns";
  }

  function checkSong(song) {
    if (!song || typeof song.name !== "string" || !/^[A-Za-z0-9 _.-]+$/.test(song.name))
      refuse("asset-name", "a song needs a name (got " +
             JSON.stringify(song && song.name) + ")");
    if (song.notes !== undefined && (!isInt(song.notes) || song.notes < 0))
      refuse("asset-shape", song.name + ": notes is a count");
    if (song.patterns !== undefined && (!isInt(song.patterns) || song.patterns < 0))
      refuse("asset-shape", song.name + ": patterns is a count");
    return song;
  }

  function addSong(text, song) {
    checkSong(song);
    var doc = text ? parseSongs(text) : emptySongs();
    for (var i = 0; i < doc.songs.length; i++)
      if (doc.songs[i] && doc.songs[i].name === song.name)
        refuse("asset-duplicate", "the toy already has the song " + song.name);
    var entry = { name: song.name, notes: song.notes || 0,
                  patterns: song.patterns || 0 };
    if (song.rows !== undefined) entry.rows = song.rows;
    if (song.speed !== undefined) entry.speed = song.speed;
    if (song.orders !== undefined) entry.orders = song.orders;
    if (song.dmf) entry.dmf = true;
    doc.songs.push(entry);
    return { doc: doc, text: newText(doc), song: entry };
  }

  /* A blank song "+ Add" makes: a name and no music yet, which the list says
   * rather than showing a misleading 0 notes as if it were authored. */
  function blankSong(name) {
    return { name: name || "song", notes: 0, patterns: 0, blank: true };
  }

  return {
    INSTRUMENTS: INSTRUMENTS,
    NOISE_CHANNELS: NOISE_CHANNELS,
    LIMITS: {
      VRAM_WORDS: VRAM_WORDS, CRAM_ENTRIES: CRAM_ENTRIES,
      BG_ENTRIES: BG_ENTRIES, ROM_LIMIT: ROM_LIMIT,
      WAVE_STEPS: WAVE_STEPS, WAVE_MAX: WAVE_MAX, AL_MAX: AL_MAX,
      CHANNELS: CHANNELS, FREQ_MAX: FREQ_MAX, CLOCK: CLOCK,
      FRAME_CLOCKS: FRAME_CLOCKS
    },
    REFUSALS: {
      "asset-json": "a text that is not a JSON object",
      "asset-shape": "the wrong document shape",
      "asset-wave": "a wave that is not 32 steps of 0..31",
      "asset-envelope": "an envelope the channel level cannot take",
      "asset-noise": "noise off channels 5-6, or NF outside 0..31",
      "asset-duplicate": "an entry the toy already has",
      "asset-name": "a name that is not a flat identifier",
      "note-name": "a note that is not C4 / A#3 / ...",
      "source-json": "a sources.json that is not JSON",
      "source-shape": "a sources.json of the wrong shape",
      "source-kind": "a kind the studio does not know",
      "no-import": "placement needing pce-editor.js + pce-sat.js, not loaded"
    },

    byId: byId,
    descriptor: descriptor,
    harmonics: harmonics,
    freqFor: freqFor,
    toneHz: toneHz,
    midiOf: midiOf,
    noteHz: noteHz,
    traceFor: traceFor,
    envIndex: envIndex,
    levelAt: levelAt,
    play: play,
    rms: rms,
    fundamental: fundamental,

    bars: bars,
    sources: sources,
    mergeSource: mergeSource,
    rgbOf: rgbOf,
    SOURCE_KINDS: SOURCE_KINDS,
    emptyInstruments: emptyInstruments,
    parseInstruments: parseInstruments,
    checkInstrument: checkInstrument,
    stored: stored,
    addInstrument: addInstrument,
    removeInstrument: removeInstrument,
    fileText: fileText,

    emptySongs: emptySongs,
    parseSongs: parseSongs,
    fromDmf: fromDmf,
    songLabel: songLabel,
    checkSong: checkSong,
    addSong: addSong,
    blankSong: blankSong
  };
});
