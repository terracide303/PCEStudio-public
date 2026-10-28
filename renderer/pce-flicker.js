/*
 * pce-flicker.js — PCEStudio's model of flicker multiplexing (card #28).
 *
 * The VDC's sprite search stops after 16 strips (16-px sprite columns) on a
 * display line, in SATB order (VDC manual 2.4.3, p. H7-19..H7-24; the model
 * is renderer/pce-sprites.js collectLine).  A picture with more sprites than
 * that can show them all across time by rotating the SAT order: frame p's
 * SAT entry k is the base entry (k + step*p) mod 64, so the 16 entries the
 * search keeps are a different window of the populated entries every frame
 * (the classic PC Engine technique).  The viewer does exactly this in
 * tools/viewer.asm (FLICKER builds: flicker_setup builds `phases` rotated
 * copies in VRAM at $7f00 - p*$100 and flicker_irq selects one per VBlank
 * through DVSSR); this module is the renderer's frame-N draw, and
 * tests/check.js holds a Mednafen capture of N consecutive frames to it.
 *
 * The rotation is expressed on the 256-word SAT array: rotating the entry
 * ORDER by s entries is rotating the word array left by 4*s words, which is
 * why the viewer builds each copy as two contiguous ROM segments (W..255,
 * 0..W-1) instead of doing per-entry index arithmetic.  The two forms are
 * equivalent; the unit test (tests/check.js) compares the module's output
 * with the SATB the VDC actually loaded.
 *
 * A rule is the fixture description tools/genroms.py writes
 * (gen/<scene>.flicker.json, copied into the capture as flicker.json):
 *   { step, phases, sprites, keep, sat_x0, sat_dx, sat_y, width, height }
 * step*phases entries exist per rotation cycle; the union of `phases`
 * frames is the fixture's claim (checked: every sprite shows at least once,
 * and no sprite shows in every frame).
 *
 * Dual use: CommonJS module in Node (tests/check.js) and a browser global.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./pce-sprites.js"));
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.flicker = factory(root.PCEStudio.sprites);
  }
})(typeof self !== "undefined" ? self : this, function (sprites) {
  "use strict";

  var WORDS = 256;          /* 64 SAT entries x 4 words */
  var ENTRIES = 64;
  var BYTES = WORDS * 2;

  /* The SAT a viewer running phase `phase` would load: entry k = base entry
   * (k + step*phase) mod 64.  Accepts Buffer or Uint8Array, returns the same
   * length (512 bytes). */
  function rotateSat(sat, step, phase) {
    if (sat.length !== BYTES)
      throw new Error("flicker: SAT must be " + BYTES + " bytes, got " +
                      sat.length);
    var out = new Uint8Array(BYTES);
    var w = ((step * phase * 4) % WORDS + WORDS) % WORDS;
    for (var i = 0; i < WORDS; i++) {
      var j = (i + w) % WORDS;
      out[i * 2] = sat[j * 2];
      out[i * 2 + 1] = sat[j * 2 + 1];
    }
    return out;
  }

  /* The base entry each SAT slot holds in `phase` (the inverse mapping,
   * for naming sprites: slot k carries base entry (k + step*phase) mod 64). */
  function sourceEntry(rule, phase, k) {
    return (k + rule.step * phase) % ENTRIES;
  }

  /* Render frame `phase` of the rotation: the same picture the viewer shows
   * (pce-sprites.js draws the rotated SAT exactly as the VDC does). */
  function renderFrame(opts, rule, phase) {
    var o = {};
    for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k))
      o[k] = opts[k];
    o.sat = rotateSat(opts.sat, rule.step, phase);
    return sprites.renderFrame(o);
  }

  /* Per-phase kept sprite list for a line: the entries the 16-strip search
   * collects, named by the BASE entry (sprite) each strip came from. */
  function keptSprites(rule, sat, vdwLine, phase) {
    var strips = sprites.collectStrips(rotateSat(sat, rule.step, phase),
                                       vdwLine);
    var out = [];
    for (var i = 0; i < strips.length; i++)
      out.push(sourceEntry(rule, phase, strips[i].number));
    return out;
  }

  return {
    WORDS: WORDS,
    ENTRIES: ENTRIES,
    BYTES: BYTES,
    rotateSat: rotateSat,
    sourceEntry: sourceEntry,
    renderFrame: renderFrame,
    keptSprites: keptSprites
  };
});
