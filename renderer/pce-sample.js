/*
 * pce-sample.js — DDA sample playback: the importer, the bank and the one model every runtime follows.
 *
 * sample(name, channel) plays a short sample on ONE PSG channel by writing the channel's DDA register
 * (R6 with the channel in DDA mode, R4 = $C0 | volume) from the CPU.  The writes come from the timer
 * interrupt: the HuC6280's timer ticks every 1,024 CPU cycles (6,991 Hz) and a reload of d-1 makes one
 * interrupt per d ticks, so a sample's rate is 6,991 / d Hz, d = 1..4 (6,991, 3,496, 2,330, 1,748).
 *
 * Where it runs (docs/TOYS.md "Samples", docs/NATIVE-SOUND.md):
 *   1. the browser host (pce-toyhost.js) emits this model's writes, each at its in-frame cycle;
 *   2. the native route (tools/build-toyc-banked.sh) writes them from a timer interrupt;
 *   3. the interpreter ROM does NOT carry it (it has no sample bank and no sample interrupt; adding
 *      them rebuilds the interpreter image and re-pins every exported ROM), so a toy that calls
 *      sample() is refused there with ilbc-sample.
 * tests/check-sample.js proves the sequence of DDA values equal in 1 and 2.
 *
 * The source is `samples.json` beside the toy's Lua:
 *   { "samples": [ { "name": "thump", "div": 2, "bits": 5, "data": "<base64, one byte per step, 0..31>" } ] }
 * written by tools/wav2sample.js (a WAV in, 8 or 16 bit PCM, any rate) or by the studio.  Every sample
 * is stored one byte per step; `bits` 4 keeps only 16 levels (the low bit follows the high one).
 * The ROM carries one 8 KiB sample bank: at most 8 samples and SAMPLE_DATA_MAX bytes of steps.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.sample = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var TIMER_CYCLES = 1024;            /* CPU cycles per timer tick (21.48 MHz / 3 / 1024) */
  var CPU_HZ = 7159091;
  var DIV_MAX = 4;                    /* the slowest: 1,748 Hz */
  var FRAME_CYCLES = 119210;          /* a display frame, the song player's mean (pce-song.js) */
  var BANK = 8192;
  var MAX_SAMPLES = 8;
  var HEADER = 8 + MAX_SAMPLES * 8;   /* count byte + 8 entries of 8 bytes, padded to 72 */
  var SAMPLE_DATA_MAX = BANK - HEADER;
  var SAMPLE_VOLUME = 31;             /* R4's AL while a sample plays: the data carries the level */
  var NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,15}$/;

  function refuse(code, message) {
    var e = new Error(code + ": " + message);
    e.code = code;
    throw e;
  }

  function rateOf(div) { return CPU_HZ / TIMER_CYCLES / div; }
  function periodCycles(div) { return div * TIMER_CYCLES; }

  /* ---- bytes <-> base64 (no Buffer in a browser) --------------------------------------------- */
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function toB64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] +
           (i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=") +
           (i + 2 < bytes.length ? B64[n & 63] : "=");
    }
    return s;
  }
  function fromB64(text) {
    var out = [], bits = 0, acc = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (c === "=") break;
      var v = B64.indexOf(c);
      if (v < 0) refuse("sample-file", "the data is not base64");
      acc = (acc << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); }
    }
    return Uint8Array.from(out);
  }

  /* ---- the WAV importer ----------------------------------------------------------------------- */

  /* parseWav(bytes): RIFF/WAVE PCM, 8 or 16 bit, any channel count and rate.  Returns the mono mix
   * as floats in -1..1 and the file's rate. */
  function parseWav(bytes) {
    function u16(o) { return bytes[o] | (bytes[o + 1] << 8); }
    function u32(o) { return (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16)) + bytes[o + 3] * 16777216; }
    function tag(o) { return String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]); }
    if (bytes.length < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") refuse("sample-wav", "not a RIFF/WAVE file");
    var fmt = null, dataAt = -1, dataLen = 0, o = 12;
    while (o + 8 <= bytes.length) {
      var id = tag(o), len = u32(o + 4);
      if (id === "fmt ") fmt = { format: u16(o + 8), ch: u16(o + 10), rate: u32(o + 12), bits: u16(o + 22) };
      if (id === "data") { dataAt = o + 8; dataLen = Math.min(len, bytes.length - dataAt); break; }
      o += 8 + len + (len & 1);
    }
    if (!fmt || dataAt < 0) refuse("sample-wav", "the file has no fmt or data chunk");
    if (fmt.format !== 1 || (fmt.bits !== 8 && fmt.bits !== 16) || fmt.ch < 1) {
      refuse("sample-wav", "only uncompressed 8 or 16 bit PCM is read (format " + fmt.format + ", " + fmt.bits + " bit)");
    }
    var bps = fmt.bits / 8, frames = Math.floor(dataLen / (bps * fmt.ch)), pcm = new Array(frames);
    for (var i = 0; i < frames; i++) {
      var sum = 0;
      for (var c = 0; c < fmt.ch; c++) {
        var p = dataAt + (i * fmt.ch + c) * bps;
        sum += fmt.bits === 8 ? (bytes[p] - 128) / 128 : ((u16(p) << 16) >> 16) / 32768;
      }
      pcm[i] = sum / fmt.ch;
    }
    return { rate: fmt.rate, pcm: pcm };
  }

  /* convert(wav, {div, bits, normalize}): resample to rateOf(div) by averaging the source samples
   * under each step (a box filter, so the downsample does not alias worse than it must), remove the
   * DC offset, scale the peak to full range (normalize, default on) and quantise to 5 bits
   * (bits 4: 16 levels).  Silence is level 16 (centre), so a sample starts and ends without a click. */
  function convert(wav, opts) {
    opts = opts || {};
    var div = opts.div || 2, bits = opts.bits || 5;
    if (div < 1 || div > DIV_MAX || div !== Math.floor(div)) refuse("sample-div", "the divisor is 1.." + DIV_MAX);
    if (bits !== 4 && bits !== 5) refuse("sample-bits", "bits is 4 or 5");
    var step = wav.rate / rateOf(div), n = Math.floor(wav.pcm.length / step);
    if (n < 1) refuse("sample-wav", "the file is shorter than one step at this rate");
    var f = new Array(n), mean = 0, peak = 0, i, j;
    for (i = 0; i < n; i++) {
      var a = Math.floor(i * step), b = Math.max(a + 1, Math.floor((i + 1) * step)), s = 0;
      for (j = a; j < b && j < wav.pcm.length; j++) s += wav.pcm[j];
      f[i] = s / (b - a);
      mean += f[i];
    }
    mean /= n;
    for (i = 0; i < n; i++) { f[i] -= mean; if (Math.abs(f[i]) > peak) peak = Math.abs(f[i]); }
    var gain = (opts.normalize === false || peak === 0) ? 1 : 1 / peak;
    var out = new Uint8Array(n);
    for (i = 0; i < n; i++) {
      var v = Math.round(16 + Math.max(-1, Math.min(1, f[i] * gain)) * 15.5 - 0.5);
      v = Math.max(0, Math.min(31, v));
      if (bits === 4) { v = v & 0x1E; v |= v >> 4; }
      out[i] = v;
    }
    return { div: div, bits: bits, data: out };
  }

  /* ---- the source file and the bank ------------------------------------------------------------- */

  /* parse(text): samples.json -> [{name, div, bits, data}].  Each refusal carries its code. */
  function parse(text) {
    var doc;
    try { doc = JSON.parse(text); } catch (e) { refuse("sample-file", "samples.json is not JSON"); }
    var list = doc && doc.samples;
    if (!Array.isArray(list) || !list.length) refuse("sample-file", "samples.json needs a non-empty \"samples\" list");
    var seen = {};
    return list.map(function (s, i) {
      if (!s || typeof s.name !== "string" || !NAME_RE.test(s.name)) {
        refuse("sample-file", "sample " + i + " needs a name: a letter or _ then up to 15 letters, digits or _");
      }
      if (seen[s.name]) refuse("sample-file", "two samples are called " + s.name);
      seen[s.name] = true;
      var div = s.div === undefined ? 2 : s.div, bits = s.bits === undefined ? 5 : s.bits;
      if (div !== Math.floor(div) || div < 1 || div > DIV_MAX) refuse("sample-div", s.name + ": div is 1.." + DIV_MAX);
      if (bits !== 4 && bits !== 5) refuse("sample-bits", s.name + ": bits is 4 or 5");
      var data = fromB64(String(s.data || ""));
      if (!data.length) refuse("sample-file", s.name + " has no data");
      for (var k = 0; k < data.length; k++) {
        if (data[k] > 31) refuse("sample-file", s.name + ": step " + k + " is " + data[k] + ", the DDA register takes 0..31");
      }
      return { name: s.name, div: div, bits: bits, data: data };
    });
  }

  function stringify(samples) {
    return JSON.stringify({ samples: samples.map(function (s) {
      return { name: s.name, div: s.div, bits: s.bits, data: toB64(s.data) };
    }) }, null, 1) + "\n";
  }

  /* check(samples): the ROM's budget.  Returns {ok, bytes, max, code, message}; the validator turns a
   * miss into validate-sample-bank. */
  function check(samples) {
    var bytes = 0;
    samples.forEach(function (s) { bytes += s.data.length; });
    var res = { ok: true, bytes: bytes, max: SAMPLE_DATA_MAX, count: samples.length, maxCount: MAX_SAMPLES };
    if (samples.length > MAX_SAMPLES) {
      res.ok = false; res.code = "sample-count";
      res.message = "a ROM carries at most " + MAX_SAMPLES + " samples, this toy has " + samples.length;
    } else if (bytes > SAMPLE_DATA_MAX) {
      res.ok = false; res.code = "sample-bank-full";
      res.message = "the samples are " + bytes + " bytes of steps against the sample bank's " + SAMPLE_DATA_MAX;
    }
    return res;
  }

  /* build(samples): the 8 KiB bank mapped at $6000 (page 3) while the interrupt reads it.
   *   $00      count
   *   $08+8*i  offset lo, offset hi (from the bank's start), length lo, length hi, div, 0, 0, 0
   *   $48...   the steps, one byte each, samples one after another */
  function build(samples) {
    var c = check(samples);
    if (!c.ok) refuse(c.code, c.message);
    var bank = new Uint8Array(BANK);
    bank[0] = samples.length;
    var at = HEADER;
    samples.forEach(function (s, i) {
      var e = 8 + 8 * i;
      bank[e] = at & 255; bank[e + 1] = at >> 8;
      bank[e + 2] = s.data.length & 255; bank[e + 3] = s.data.length >> 8;
      bank[e + 4] = s.div;
      bank.set(s.data, at);
      at += s.data.length;
    });
    return bank;
  }

  /* ---- the model --------------------------------------------------------------------------------- */

  /* A sample's length in toy frames, as the host holds the channel: the last step's interrupt falls in
   * this frame (0-based), and the frame after releases the channel. */
  function framesFor(s) {
    return Math.floor((s.data.length * periodCycles(s.div) - 1) / FRAME_CYCLES) + 1;
  }

  /* the frames the channel is held: the writes run to the end of framesFor(s), then one more frame so
   * the last steps and the interrupt's own phase against the call are inside the hold */
  function holdFrames(s) { return framesFor(s) + 1; }

  /* writesInFrame(s, k): the DDA writes in frame k after the call, k = 0 the frame sample() ran in.
   * Step n (0-based) is written by the (n+1)th timer interrupt, so at cycle (n+1) * period from the
   * start of frame 0.  Returns [{n, t, value}] with t the in-frame cycle. */
  function writesInFrame(s, k) {
    var period = periodCycles(s.div), out = [];
    var first = Math.max(0, Math.ceil((k * FRAME_CYCLES) / period) - 1);
    for (var n = first; n < s.data.length; n++) {
      var abs = (n + 1) * period;
      if (abs < k * FRAME_CYCLES) continue;
      if (abs >= (k + 1) * FRAME_CYCLES) break;
      out.push({ n: n, t: abs - k * FRAME_CYCLES, value: s.data[n] });
    }
    return out;
  }

  /* cycles the interrupt costs per frame on the native route are measured, not modelled: docs/NATIVE-SOUND.md */

  return {
    TIMER_CYCLES: TIMER_CYCLES, DIV_MAX: DIV_MAX, FRAME_CYCLES: FRAME_CYCLES, BANK: BANK,
    MAX_SAMPLES: MAX_SAMPLES, HEADER: HEADER, SAMPLE_DATA_MAX: SAMPLE_DATA_MAX, SAMPLE_VOLUME: SAMPLE_VOLUME,
    rateOf: rateOf, periodCycles: periodCycles, toB64: toB64, fromB64: fromB64,
    parseWav: parseWav, convert: convert, parse: parse, stringify: stringify, check: check, build: build,
    framesFor: framesFor, holdFrames: holdFrames, writesInFrame: writesInFrame,
    names: function (samples) { return samples.map(function (s) { return s.name; }); }
  };
});
