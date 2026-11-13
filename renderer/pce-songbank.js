/*
 * pce-songbank.js — a toy's songs as one 8 KiB ROM bank for the HuTrack engine.
 *
 * Used by the studio's Export (the interpreter ROM, pce-rom.js's `songs` option) and by
 * tools/native-songs.js (the native ROMs).  build(songs, bankNumber) takes the compiled songs
 * pce-seq.js songsFromFiles returns (a song the sequencer made, or a DMF-style module such as the
 * Oak Woods song.json), converts each with pce-hutrack.js, assembles them one after another at
 * 16-byte-aligned offsets of a bank mapped at $4000, with their pointers already pointing at
 * `bankNumber`, and returns the bank's 8,192 bytes and the engine glue's trailer entries
 * (lo, hi, bank per song, docs/ROM-SOUND.md §6).  The trailer itself is written by the caller into
 * the bank the glue reads at $5FE0 (opts.trailer: 8,192-byte bank gets it too, the native layout
 * where the songs share bank 4).  At most 8 songs and 8,160 bytes (the trailer's 32 bytes).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./pce-hutrack.js"));
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.songbank = factory(root.PCEStudio.hutrack);
  }
})(typeof self !== "undefined" ? self : this, function (hutrack) {
  "use strict";

  var BANK = 8192, TRAILER = 0x1FE0, ORG = 0x4000, MAX_SONGS = 8;

  function refuse(code, message) {
    var e = new Error("pce-songbank: " + code + ": " + message);
    e.code = code;
    throw e;
  }

  /* A song the converter can take: a sequencer module goes through fromSequencer; a DMF-style module
   * (rows already carrying fxSlots, as the Oak Woods song.json does) is used as it is, with the
   * reader's legacyArpSpeed defaulted and every row's effect slots padded to the widest row (empty
   * lists become the DMF reader's filler, code and arg 0xFFFF). */
  function adapt(song) {
    try { return hutrack.fromSequencer(song); }
    catch (e) {
      if (!/already carries fxSlots/.test(String(e && e.message))) throw e;
    }
    var out = JSON.parse(JSON.stringify(song));
    if (out.legacyArpSpeed === undefined || out.legacyArpSpeed === null) out.legacyArpSpeed = 1;
    var width = 1;
    out.patterns.forEach(function (ch) { ch.forEach(function (pat) { pat.forEach(function (row) {
      if (row.fxSlots && row.fxSlots.length > width) width = row.fxSlots.length;
    }); }); });
    out.patterns.forEach(function (ch) { ch.forEach(function (pat) { pat.forEach(function (row) {
      row.fxSlots = row.fxSlots || [];
      while (row.fxSlots.length < width) row.fxSlots.push({ code: 0xFFFF, arg: 0xFFFF });
    }); }); });
    return out;
  }

  function build(songs, bankNumber, opts) {
    opts = opts || {};
    if (songs.length > MAX_SONGS) {
      refuse("toy-song-count", "a ROM carries at most " + MAX_SONGS + " songs, this toy has " + songs.length);
    }
    var bank = new Uint8Array(BANK);
    var entries = [];
    var pos = 0;
    songs.forEach(function (song, i) {
      pos = (pos + 15) & ~15;
      var name = "song" + i;
      var converted = hutrack.convert(adapt(song), { songName: name, subFolder: name });
      var bytes = hutrack.assemble(converted.files, converted.entry, { bank: bankNumber, org: ORG + pos });
      if (pos + bytes.length > TRAILER) {
        refuse("toy-song-bank-full", "song " + i + " (" + (song.songName || name) + ") needs " + bytes.length +
               " bytes at offset " + pos + "; the song bank holds " + TRAILER + " before its trailer");
      }
      bank.set(bytes, pos);
      entries.push([(ORG + pos) & 0xFF, ((ORG + pos) >> 8) & 0xFF, bankNumber & 0xFF]);
      pos += bytes.length;
    });
    if (opts.trailer) {
      bank[TRAILER] = songs.length;
      entries.forEach(function (e, i) { bank.set(e, TRAILER + 1 + 3 * i); });
    }
    return { bytes: bank, entries: entries, used: pos };
  }

  return { build: build, adapt: adapt, BANK: BANK, TRAILER: TRAILER, MAX_SONGS: MAX_SONGS };
});
