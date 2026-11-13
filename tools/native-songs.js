#!/usr/bin/env node
/*
 * tools/native-songs.js — the song bank of a natively compiled ROM.
 *
 *   node tools/native-songs.js TOYDIR OUT.bin
 *
 * Reads TOYDIR/song.json and songs.json the way the studio does
 * (pce-seq.js songsFromFiles), converts each song to HuTrack's include files
 * and assembles it (pce-hutrack.js) into one 8 KiB bank (physical bank 4, page
 * 2 = $4000): the songs at 16-byte-aligned offsets, each with its pointers
 * already resolved for its own offset, then the 32-byte trailer the engine's
 * glue reads at $5FE0 (docs/ROM-SOUND.md §6): the count, then (lo, hi, bank)
 * per song.  At most 8 songs; all of it must fit the first 8,160 bytes.  With
 * no song files it writes a bank of zeros (no songs).  Prints one line per song.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const seq = require("../renderer/pce-seq.js");
const hutrack = require("../renderer/pce-hutrack.js");

const BANK = 8192, TRAILER = 0x1FE0, SONG_BANK = 4, ORG = 0x4000, MAX_SONGS = 8;

const dir = process.argv[2], out = process.argv[3];
if (!dir || !out) { console.error("usage: node tools/native-songs.js TOYDIR OUT.bin"); process.exit(2); }

const files = [];
for (const name of ["song.json", "songs.json"]) {
  const p = path.join(dir, name);
  if (fs.existsSync(p)) files.push({ name: name, source: fs.readFileSync(p, "utf8") });
}
const songs = seq.songsFromFiles(files);
if (songs.length > MAX_SONGS) { console.error("a ROM carries at most " + MAX_SONGS + " songs, got " + songs.length); process.exit(1); }

const bank = new Uint8Array(BANK);
const entries = [];
let pos = 0;
songs.forEach(function (song, i) {
  pos = (pos + 15) & ~15;
  const name = ("song" + i);
  /* a DMF module (fxSlots on its rows, the oak-woods song.json) goes to
   * convert() as it is; a sequencer module needs the adapter first */
  let adapted;
  try { adapted = hutrack.fromSequencer(song); }
  catch (e) {
    if (!/already carries fxSlots/.test(String(e.message))) throw e;
    /* convert() needs the DMF reader's legacyArpSpeed; fromSequencer defaults it to 1 */
    adapted = JSON.parse(JSON.stringify(song));
    if (adapted.legacyArpSpeed === undefined || adapted.legacyArpSpeed === null) adapted.legacyArpSpeed = 1;
  }
  const converted = hutrack.convert(adapted, { songName: name, subFolder: name });
  const bytes = hutrack.assemble(converted.files, converted.entry, { bank: SONG_BANK, org: ORG + pos });
  if (pos + bytes.length > TRAILER) {
    console.error("song " + i + " (" + (song.songName || name) + ") needs " + bytes.length +
                  " bytes at offset " + pos + "; the bank holds " + TRAILER + " before its trailer");
    process.exit(1);
  }
  bank.set(bytes, pos);
  entries.push([(ORG + pos) & 0xFF, ((ORG + pos) >> 8) & 0xFF, SONG_BANK]);
  console.log("song " + i + " " + (song.songName || name) + ": " + bytes.length + " B at $" + (ORG + pos).toString(16));
  pos += bytes.length;
});
bank[TRAILER] = songs.length;
entries.forEach(function (e, i) { bank.set(e, TRAILER + 1 + 3 * i); });
fs.writeFileSync(out, Buffer.from(bank));
console.log(songs.length + " song(s), " + pos + " of " + TRAILER + " B used");
