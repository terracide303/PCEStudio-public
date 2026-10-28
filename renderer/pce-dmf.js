/*
 * pce-dmf.js — a DefleMask module (.dmf) reader for PCEStudio (#35).
 *
 * This is our own reader: the byte layout is taken from the format the
 * vendored HuTrack converter consumes (vendor/hutrack/utils/support/
 * dmfReader.py and its test fixtures), but no converter code is run and no
 * converter code is copied.  It reads the legacy DMF revisions (11..27)
 * that Furnace exports for the PC Engine, keeps the fields the PCE can
 * express, and refuses what it cannot read with a machine-readable code.
 *
 * The module is one half of #35's browser route: pce-song.js turns a module
 * read here into the PSG register writes HuTrack's engine would make, and
 * renderer/pce-psg.js turns those into PCM.  The DMF's own compression and
 * the engine's player are deliberately not reproduced: a DMF stores one row
 * per pattern position, which is the same sequence HuTrack's compressed
 * pattern stream expands to, so the player reads the rows directly and
 * docs/HUTRACK.md records that equivalence and its evidence.
 *
 * A DMF file on disk is the module body wrapped in zlib (DefleMask and
 * Furnace both store it that way).  read() inflates when Node's zlib is
 * available; in a browser use inflate() (async, DecompressionStream) and
 * then parse().  parse() also accepts an uncompressed module.
 *
 * Dual use: CommonJS module in Node (tests/check-dmf.js) and a browser
 * global (renderer/index.html) via a UMD-style wrapper, like pce-psg.js.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.dmf = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MAGIC = ".DelekDefleMask.";
  var PCE_PLATFORM = 0x05;
  var CHANNELS = 6;

  function refuse(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  /* ---- byte reader ------------------------------------------------------ */

  function Reader(bytes) {
    this.b = bytes;
    this.i = 0;
  }

  Reader.prototype.left = function () { return this.b.length - this.i; };

  Reader.prototype.u8 = function () {
    if (this.i >= this.b.length)
      throw refuse("dmf-truncated", "module ends at byte " + this.i);
    return this.b[this.i++];
  };

  Reader.prototype.u16 = function () {
    var lo = this.u8();
    return lo | (this.u8() << 8);
  };

  Reader.prototype.u32 = function () {
    var v = this.u8();
    v |= this.u8() << 8;
    v |= this.u8() << 16;
    v |= this.u8() << 24;
    return v >>> 0;
  };

  Reader.prototype.string = function () {
    var n = this.u8();
    if (n > this.left())
      throw refuse("dmf-truncated",
                   "string of " + n + " bytes at byte " + this.i);
    var out = "";
    for (var k = 0; k < n; k++) out += String.fromCharCode(this.b[this.i++]);
    return out;
  };

  /* A macro value is one byte before revision 14 and a dword after it
   * (dmfReader.py getMacroValue). */
  Reader.prototype.macro = function (version) {
    return version < 14 ? this.u8() : this.u32();
  };

  /* ---- note decoding ---------------------------------------------------- */

  /* DMF note byte -> {semitone, octave} for a row, or null for an empty row.
   * DefleMask's encoding (dmfReader.py getPatternData):
   *   0        empty when the octave is 0, otherwise C of that octave
   *   1..11    C#..B (the semitone index; 0 is C)
   *   12, 13   C of the next octave
   *   100      note cut
   * The octave byte is signed and one below the sounding octave (measured:
   * docs/HUTRACK.md). */
  function decodeNote(noteByte, octave) {
    if (noteByte === 100) return { cut: true };
    if (noteByte === 0) {
      if (octave === 0) return null;
      return { semitone: 0, octave: octave };
    }
    if (noteByte >= 1 && noteByte <= 11)
      return { semitone: noteByte, octave: octave };
    if (noteByte === 12 || noteByte === 13)
      return { semitone: 0, octave: octave + 1 };
    return null; /* 14..99: not a note in any DMF we accept */
  }

  /* ---- sections --------------------------------------------------------- */

  function readInstrument(r, version) {
    var name = r.string();
    var mode = r.u8();
    if (mode !== 0)
      throw refuse("dmf-instrument",
                   "instrument \"" + name + "\" uses FM mode " + mode +
                   "; only standard mode is supported");

    function env() {
      var size = r.u8();
      var data = [];
      for (var k = 0; k < size; k++) data.push(r.macro(version));
      var loop = size ? r.u8() : 0xff;
      /* The converter clamps an out-of-range loop to the last step rather
       * than rejecting the module (dmfReader.py), so we do the same. */
      if (size && loop >= size && loop !== 0xff) loop = size - 1;
      return { size: size, data: data, loop: loop };
    }

    var volume = env();
    var arpeggio = env();
    if (version > 15) arpeggio.mode = r.u8();
    else arpeggio.mode = 0;
    var noise = env();
    var wavetable = env();

    return {
      name: name,
      mode: mode,
      volumeEnv: volume,
      arpeggioEnv: arpeggio,
      noiseEnv: noise,
      wavetableEnv: wavetable
    };
  }

  function readWavetables(r, version) {
    var count = version > 11 ? r.u8() : 0;
    if (count > 128)
      throw refuse("dmf-wave", "waveform table count " + count + " > 128");
    var waves = [];
    for (var k = 0; k < count; k++) {
      var size = r.u32();
      if (size === 0 && count === 1) break; /* Furnace's empty placeholder */
      if (size !== 32)
        throw refuse("dmf-wave",
                     "waveform " + k + " has " + size +
                     " values; the PCE wave is 32");
      var wave = [];
      for (var s = 0; s < 32; s++) {
        var v = r.macro(version) & 31;
        wave.push(v);
      }
      waves.push(wave);
    }
    if (!waves.length) waves.push(new Array(32).fill(15)); /* DMF null wave */
    return waves;
  }

  function readPatterns(r, version, orderCount, rowsPerPattern) {
    var channels = [];
    for (var ch = 0; ch < CHANNELS; ch++) {
      var fxCount = r.u8();
      if (fxCount < 1 || fxCount > 4)
        throw refuse("dmf-pattern",
                     "channel " + ch + " has " + fxCount + " effect columns");
      var patterns = [];
      for (var p = 0; p < orderCount; p++) {
        var rows = [];
        for (var row = 0; row < rowsPerPattern; row++) {
          var noteByte = r.u8();
          if (noteByte >= 14 && noteByte <= 99)
            throw refuse("dmf-note",
                         "channel " + ch + " pattern " + p + " row " + row +
                         " has note code " + noteByte);
          r.u8();                       /* DMF row padding */
          var octave = r.u8();
          if (octave >= 128) octave -= 256;
          r.u8();                       /* DMF row padding */
          var volume = r.u16();
          var effects = [];
          /* Every slot, empty ones included: the HuTrack converter's
           * compression keys its mask on a slot being present (bit 4) and on
           * an empty slot's arg word (bit 5), so a consumer rebuilding its
           * stream needs the slots in order, not just the non-empty ones
           * (renderer/pce-hutrack.js). */
          var fxSlots = [];
          for (var f = 0; f < fxCount; f++) {
            var code = r.u16();
            var arg = r.u16();
            fxSlots.push({ code: code, arg: arg });
            if (code !== 0xffff) effects.push({ code: code, arg: arg });
          }
          var instrument = r.u16();
          rows.push({
            note: decodeNote(noteByte, octave),
            octave: octave,
            volume: volume === 0xffff ? null : volume,
            effects: effects,
            fxSlots: fxSlots,
            instrument: instrument === 0xffff ? null : instrument
          });
        }
        patterns.push(rows);
      }
      channels.push(patterns);
    }
    return channels;
  }

  function readSamples(r, version) {
    var count = r.u8();
    if (count > 128)
      throw refuse("dmf-sample", "sample count " + count + " > 128");
    var samples = [];
    for (var k = 0; k < count; k++) {
      var size = r.u32();
      var name = version > 22 ? r.string() : "";
      var rate = r.u8();
      var pitch = r.u8();
      var amp = r.u8();
      var depth = version > 21 ? r.u8() : 16;
      var cutStart = null, cutEnd = null;
      if (version >= 27) { cutStart = r.u32(); cutEnd = r.u32(); }
      if (size > r.left() / 2)
        throw refuse("dmf-truncated",
                     "sample \"" + name + "\" needs " + (2 * size) +
                     " bytes, " + r.left() + " left");
      var data = [];
      for (var s = 0; s < size; s++) data.push(r.u16());
      samples.push({ name: name, rate: rate, pitch: pitch, amp: amp,
                     depth: depth, cutStart: cutStart, cutEnd: cutEnd,
                     data: data });
    }
    return samples;
  }

  /* ---- the module ------------------------------------------------------- */

  function parse(bytes) {
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(bytes))
      bytes = new Uint8Array(bytes);
    if (!(bytes instanceof Uint8Array))
      throw refuse("dmf-type", "parse() wants a Uint8Array or Buffer");

    var r = new Reader(bytes);
    var magic = "";
    for (var k = 0; k < MAGIC.length; k++) magic += String.fromCharCode(r.u8());
    if (magic !== MAGIC)
      throw refuse("dmf-magic", "not a DefleMask module: \"" + magic + "\"");

    var version = r.u8();
    if (version < 11 || version > 27)
      throw refuse("dmf-version",
                   "DMF revision " + version + " (supported: 11..27)");
    var platform = r.u8();
    if (platform !== PCE_PLATFORM)
      throw refuse("dmf-platform",
                   "DMF platform " + platform + " is not PC Engine (5)");

    var songName = r.string();
    var author = r.string();
    if (version > 12) { r.u8(); r.u8(); }   /* highlight A/B, editor-only */

    var timeBase = r.u8() + 1;
    var tick1 = r.u8() * timeBase;
    var tick2 = r.u8() * timeBase;
    var frameMode = r.u8();                 /* 1 = VBlank (NTSC), 0 = PAL */
    var customHz = r.u8();
    r.u8(); r.u8(); r.u8();                 /* custom-Hz operands, unused */

    var rowsPerPattern = version >= 24 ? r.u32() : r.u8();
    if (rowsPerPattern < 1 || rowsPerPattern > 256)
      throw refuse("dmf-pattern",
                   "pattern length " + rowsPerPattern + " (expected 1..256)");
    var orderCount = r.u8();
    if (orderCount < 1 || orderCount > 127)
      throw refuse("dmf-order", "order count " + orderCount);
    /* Legacy arpeggio speed: only in pre-20 modules, and the converter writes
     * it (clamped to 1..) into the song header's attribute bytes. */
    var arpSpeed = version < 20 ? r.u8() : 1;

    var orderMatrix = [];
    for (var ch = 0; ch < CHANNELS; ch++) {
      var orders = [];
      for (var o = 0; o < orderCount; o++) {
        var pattern = r.u8();
        if (pattern > 127)
          throw refuse("dmf-order",
                       "channel " + ch + " order " + o +
                       " uses pattern " + pattern);
        orders.push(pattern);
        if (version > 24) r.string();       /* editor pattern name */
      }
      orderMatrix.push(orders);
    }

    var instrumentCount = r.u8();
    if (instrumentCount > 128)
      throw refuse("dmf-instrument",
                   "instrument count " + instrumentCount + " > 128");
    var instruments = [];
    for (var i = 0; i < instrumentCount; i++)
      instruments.push(readInstrument(r, version));
    if (!instruments.length) {
      /* A note without an instrument uses Furnace's empty instrument. */
      var empty = { size: 0, data: [], loop: 0xff };
      instruments.push({ name: "", mode: 0, volumeEnv: empty,
                         arpeggioEnv: Object.assign({ mode: 0 }, empty),
                         noiseEnv: empty, wavetableEnv: empty });
    }

    var wavetables = readWavetables(r, version);
    var patterns = readPatterns(r, version, orderCount, rowsPerPattern);
    var samples = readSamples(r, version);

    if (r.left() && bytes.subarray(r.i).some(function (v) { return v !== 0; }))
      throw refuse("dmf-trailing",
                   "trailing data at byte " + r.i + " of " + bytes.length);

    return {
      version: version,
      platform: platform,
      songName: songName,
      author: author,
      timeBase: timeBase,
      tick1: tick1,
      tick2: tick2,
      frameMode: frameMode,
      customHz: customHz,
      rowsPerPattern: rowsPerPattern,
      orderCount: orderCount,
      legacyArpSpeed: Math.max(1, arpSpeed),
      orderMatrix: orderMatrix,
      instruments: instruments,
      wavetables: wavetables,
      patterns: patterns,
      samples: samples,
      bytes: bytes.length
    };
  }

  function read(bytes) {
    if (typeof Buffer === "undefined" || typeof require !== "function")
      throw refuse("dmf-inflate",
                   "read() needs Node's zlib; use inflate() then parse()");
    var zlib = require("zlib");
    var raw;
    try {
      raw = zlib.inflateSync(bytes);
    } catch (e) {
      /* An uncompressed module is accepted too (a bare .dmf body). */
      raw = bytes;
    }
    return parse(new Uint8Array(raw));
  }

  /* Browser path: DMF files are zlib streams (RFC 1950), which
   * DecompressionStream exposes as "deflate". */
  function inflate(bytes) {
    if (typeof DecompressionStream === "undefined")
      return Promise.reject(refuse("dmf-inflate", "no DecompressionStream"));
    var stream = new DecompressionStream("deflate");
    var writer = stream.writable.getWriter();
    writer.write(bytes);
    writer.close();
    return new Response(stream.readable).arrayBuffer()
      .then(function (buf) { return new Uint8Array(buf); });
  }

  return {
    parse: parse,
    read: read,
    inflate: inflate,
    decodeNote: decodeNote,
    CHANNELS: CHANNELS
  };
});
