/*
 * pce-sfx.js — the sound effects a toy can ask for beyond sfx()'s flat beep:
 * noise, a pitch slide, a volume envelope, and named presets.
 *
 * ONE module, used by all three places a toy runs (docs/TOYS.md "Effects"):
 *   1. the browser host (renderer/pce-toyhost.js) runs the model below;
 *   2. the interpreter ROM's sound glue (tools/ilvm/hutrack_engine.asm,
 *      SndGlueFx) is this model in 65C02, integer for integer;
 *   3. the native route calls the same glue.
 * tests/check-sfx-fx.js proves the PSG writes equal in all three.
 *
 * The call is sfx_fx(channel, wave, from, to, volume, attack, decay, frames):
 *
 *   wave    0 square, 1 noise (channels 4 and 5 only, the HuC6280's noise
 *           generators), 2 triangle, 3 sawtooth, 4 organ, 5 bass, 6 buzz (a
 *           pseudo-random tone), 7 sine: a 32-step wave the glue uploads like
 *           sfx()'s square.  Noise uploads nothing.
 *   from, to  the frequency at the first and at the last frame, a linear
 *           slide.  A tone's 12-bit F divider (0..4095; a LARGER F is a LOWER
 *           note); a noise's R7 rate, 0..31 (31 the highest hiss, the
 *           manual's NF field).  Equal values: no slide, no per-frame write.
 *   volume  the peak level AL, 0..31
 *   attack  frames the level climbs from 0 to the peak (0: starts at it), 0..255
 *   decay   frames the level falls from the peak to 0 at the end (0: holds)
 *           attack + decay may not pass frames; the cartridge clamps.
 *   frames  1..255, the effect's whole length; the channel is released then.
 *           (sfx() itself may run 600 frames; an effect keeps its counters in
 *           one byte so the console's per-frame cost stays small.)
 *
 * THE ARITHMETIC (integers only, what the 65C02 computes):
 *   - frequency is kept as value * 16 in 16 bits: step = floor(|to - from|
 *     * 16 / (frames - 1)), added (or subtracted) once per frame after the
 *     first; the frame's value is the sum >> 4.
 *   - the level is kept as level * 256: on frame n < attack it is
 *     floor(volume * 256 / attack) * (n + 1); on the last `decay` frames j =
 *     0.. it is volume * 256 - floor(volume * 256 / decay) * (j + 1);
 *     between them it is volume * 256.  The frame's AL is that >> 8.
 *   - writes per frame after the first: R0 (the channel), then R2 and R3 (a
 *     tone) or R7 (noise) while sliding, then R4 while the level moves.  A
 *     frame that changes nothing writes nothing.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.sfx = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var WAVE_SQUARE = 0, WAVE_NOISE = 1, WAVE_TRIANGLE = 2, WAVE_SAW = 3;
  var WAVE_ORGAN = 4, WAVE_BASS = 5, WAVE_BUZZ = 6, WAVE_SINE = 7;
  var WAVE_MAX = 7;
  var WAVE_NAMES = ["square", "noise", "triangle", "saw", "organ", "bass",
                    "buzz", "sine"];
  var NOISE_CHANNELS = [4, 5];      /* PSG channels 5 and 6, as indices */
  var NOISE_RATE_MAX = 31;          /* R7's NF field */
  var FRAMES_MAX = 255;             /* an effect's length: one byte of glue state */

  /* The 32-step waves (5-bit samples), the glue's SndGlueWave tables. */
  function buildWaves() {
    var sq = [], tri = [], saw = [], i;
    for (i = 0; i < 32; i++) {
      sq.push(i < 16 ? 31 : 0);
      tri.push(i < 16 ? i * 2 : (31 - i) * 2 + 1);   /* up 0..30, down 31..1 */
      saw.push(i);
    }
    /* The four added waves are literal tables (the glue's SndGlueWave holds
     * the same 32 bytes each; tests/check-sfx-fx.js reads the .asm and
     * compares): an organ (three harmonics), a bass (a soft-clipped sine, fat
     * and round), a buzz (a pseudo-random tone, the closest the 32-step wave
     * RAM gets to noise on a channel that has no noise generator) and a sine. */
    var organ = [16,20,24,27,28,27,26,24,22,21,20,20,20,19,18,17,
                 16,14,13,12,11,11,11,10,9,7,5,4,3,4,7,11];
    var bass = [16,21,25,27,29,30,31,31,31,31,31,30,29,27,25,21,
                16,10,6,4,2,1,0,0,0,0,0,1,2,4,6,10];
    var buzz = [5,23,23,5,1,11,3,9,29,31,15,13,25,19,27,17,
                21,7,7,21,17,27,19,25,13,15,31,29,9,3,11,1];
    var sine = [16,19,21,24,26,28,30,31,31,31,30,28,26,24,21,19,
                16,12,10,7,5,3,1,0,0,0,1,3,5,7,10,12];
    return [sq, null, tri, saw, organ, bass, buzz, sine];
  }
  var WAVES = buildWaves();

  /* The presets: ONE table, read by the browser host, by the compiler (which
   * expands sfx_preset(name, channel) to a constant sfx_fx) and by the
   * tests.  Noise presets need channel 4 or 5.  F is a divider: a smaller F
   * is a higher note, so a rising jump slides F DOWN. */
  var PRESETS = [
    { name: "jump", wave: WAVE_SQUARE, from: 330, to: 140, volume: 26,
      attack: 0, decay: 6, frames: 12 },
    { name: "shoot", wave: WAVE_SAW, from: 130, to: 420, volume: 28,
      attack: 0, decay: 10, frames: 14 },
    { name: "hit", wave: WAVE_NOISE, from: 26, to: 10, volume: 28,
      attack: 0, decay: 8, frames: 8 },
    { name: "coin", wave: WAVE_SQUARE, from: 214, to: 107, volume: 24,
      attack: 0, decay: 5, frames: 9 },
    { name: "explosion", wave: WAVE_NOISE, from: 28, to: 2, volume: 31,
      attack: 0, decay: 40, frames: 40 },
    { name: "powerup", wave: WAVE_TRIANGLE, from: 420, to: 105, volume: 26,
      attack: 4, decay: 8, frames: 24 },
    { name: "select", wave: WAVE_SQUARE, from: 214, to: 214, volume: 22,
      attack: 0, decay: 2, frames: 5 },
    { name: "hurt", wave: WAVE_SAW, from: 190, to: 520, volume: 28,
      attack: 0, decay: 10, frames: 16 },
    { name: "laser", wave: WAVE_SQUARE, from: 70, to: 800, volume: 24,
      attack: 0, decay: 12, frames: 22 }
  ];

  function presetNames() {
    return PRESETS.map(function (p) { return p.name; });
  }

  function findPreset(name) {
    for (var i = 0; i < PRESETS.length; i++) {
      if (PRESETS[i].name === name) return PRESETS[i];
    }
    return null;
  }

  /* One effect's integer state at its first frame. */
  function start(spec) {
    var F = spec.frames, A = spec.attack, D = spec.decay, V = spec.volume;
    var noise = spec.wave === WAVE_NOISE;
    var st = { noise: noise, frames: F, left: F, attack: A, decay: D,
               thrA: F - A, volume: V };
    var fmask = noise ? NOISE_RATE_MAX : 0x0FFF;
    st.slope = spec.from !== spec.to && F > 1;
    st.f16 = (spec.from & fmask) << 4;
    st.fstep = 0;
    if (st.slope) {
      var d = Math.abs(spec.to - spec.from) * 16;
      var q = Math.floor(d / (F - 1));
      st.fstep = spec.to > spec.from ? q : (-q) & 0xFFFF;
    }
    st.env = A > 0 || D > 0;
    st.su = A > 0 ? Math.floor(V * 256 / A) : 0;
    st.sd = D > 0 ? Math.floor(V * 256 / D) : 0;
    if (A > 0) st.v16 = st.su;
    else if (D >= F) st.v16 = V * 256 - st.sd;
    else st.v16 = V * 256;
    st.freq = (st.f16 >> 4) & fmask;
    st.level = st.v16 >> 8;
    return st;
  }

  /* One later frame: returns {freq, level, any, slide, env} — which writes
   * the frame makes — after moving the state.  `left` is the frames still to
   * come INCLUDING this one (>= 1; the frame it reaches 0 is the release). */
  function tick(st) {
    st.left--;
    var left = st.left;
    var out = { slide: false, env: false, freq: st.freq, level: st.level };
    if (st.slope) {
      st.f16 = (st.f16 + st.fstep) & 0xFFFF;
      st.freq = (st.f16 >> 4) & (st.noise ? NOISE_RATE_MAX : 0x0FFF);
      out.slide = true;
      out.freq = st.freq;
    }
    if (st.env) {
      if (left > st.thrA) {
        st.v16 += st.su;
        out.env = true;
      } else if (left <= st.decay) {
        st.v16 -= st.sd;
        out.env = true;
      }
      st.level = st.v16 >> 8;
      out.level = st.level;
    }
    out.any = out.slide || out.env;
    return out;
  }

  return {
    WAVE_SQUARE: WAVE_SQUARE, WAVE_NOISE: WAVE_NOISE,
    WAVE_TRIANGLE: WAVE_TRIANGLE, WAVE_SAW: WAVE_SAW,
    WAVE_ORGAN: WAVE_ORGAN, WAVE_BASS: WAVE_BASS, WAVE_BUZZ: WAVE_BUZZ,
    WAVE_SINE: WAVE_SINE, WAVE_MAX: WAVE_MAX,
    WAVE_NAMES: WAVE_NAMES, WAVES: WAVES,
    NOISE_CHANNELS: NOISE_CHANNELS, NOISE_RATE_MAX: NOISE_RATE_MAX,
    FRAMES_MAX: FRAMES_MAX,
    PRESETS: PRESETS, presetNames: presetNames, findPreset: findPreset,
    start: start, tick: tick
  };
});
