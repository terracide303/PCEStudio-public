#!/usr/bin/env node
/*
 * tests/check-export-songs.js — the studio's Export carries a toy's songs, and the ROM plays them.
 *
 * Until now buildToyRom pinned "no songs" in the trailer and an exported game was silent.  It now takes
 * `songs` (a function of the song bank's number, renderer/pce-songbank.js) and places the converted
 * songs in one whole bank after the data and art banks, with the trailer the engine glue reads.
 *
 *   1. Layout: the demo song (tests/native-music) builds into a ROM whose last bank is the song bank, whose
 *      trailer lists one song at $4000 in that bank, and whose song data starts with the converter's
 *      header (non-zero); a toy without songs keeps its bytes exactly (no song bank, trailer n = 0).
 *   2. Refusals by code: nine songs (toy-song-count).
 *   3. The page: renderer/studio.html loads pce-hutrack.js and pce-songbank.js and hands the songs to
 *      buildToyRom; the song files are no longer carried as a JSON tail.
 *   4. It plays: the ROM runs in Geargrafx (tools/ggmcp.py); after 240 video frames at least two tonal
 *      channels have sounded, every tonal frequency heard is one the studio's own player model
 *      (pce-il.js, rt.sound.events) writes for the song, and at least two different notes were heard.
 *      SKIP without Geargrafx.
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const il = require("../renderer/pce-il.js");
const ilbc = require("../renderer/pce-ilbc.js");
const romLib = require("../renderer/pce-rom.js");
const seq = require("../renderer/pce-seq.js");
const songbank = require("../renderer/pce-songbank.js");
let checks = 0;
const failures = [];
function check(ok, name) { checks++; if (!ok) { failures.push(name); console.log("FAIL  " + name); } }

const dir = path.join(ROOT, "tests", "native-music");
const source = fs.readFileSync(path.join(dir, "main.lua"), "utf8");
const songs = seq.songsFromFiles([{ name: "song.json", source: fs.readFileSync(path.join(dir, "song.json"), "utf8") }]);
const program = il.compile(source, { chunkName: "@main.lua" });
const encoded = ilbc.encode(program);
const bank0 = fs.readFileSync(path.join(ROOT, "renderer", "ilvm.bin"));
const BANK = 8192, TRAILER = 4 * BANK + 0x1FE0;

/* 1. layout */
const withSongs = romLib.buildToyRom({ bank0: bank0, bytecode: encoded.bytes, songs: (n) => songbank.build(songs, n) });
const without = romLib.buildToyRom({ bank0: bank0, bytecode: encoded.bytes });
check(withSongs.length === without.length + BANK, "the songs add exactly one bank (" + without.length + " -> " + withSongs.length + " B)");
const songBank = withSongs.length / BANK - 1;
check(withSongs[TRAILER] === 1, "the trailer in the data bank says one song");
check(withSongs[TRAILER + 1] === 0x00 && withSongs[TRAILER + 2] === 0x40 && withSongs[TRAILER + 3] === songBank,
      "its entry is $4000 in bank " + songBank + " (the last bank)");
let nonzero = 0;
for (let i = 0; i < 64; i++) if (withSongs[songBank * BANK + i]) nonzero++;
check(nonzero > 8, "the song bank starts with the converter's data (" + nonzero + " of the first 64 bytes non-zero)");
check(Buffer.compare(Buffer.from(without.slice(0, 4 * BANK + TRAILER - 4 * BANK)), Buffer.from(withSongs.slice(0, 4 * BANK + TRAILER - 4 * BANK))) === 0,
      "everything below the trailer is identical to the toy without songs");
check(without[TRAILER] === 0 && without.length === 5 * BANK, "a toy without songs keeps its bytes: 5 banks, trailer n = 0");

/* 2. refusals */
let code = null;
try { songbank.build(new Array(9).fill(songs[0]), 7); } catch (e) { code = e.code; }
check(code === "toy-song-count", "nine songs are refused by code (" + code + ")");

/* 3. the page */
const page = fs.readFileSync(path.join(ROOT, "renderer", "studio.html"), "utf8");
check(/pce-hutrack\.js/.test(page) && /pce-songbank\.js/.test(page), "studio.html loads pce-hutrack.js and pce-songbank.js");
check(/songs: A\.songs \?/.test(page) && /PCEStudio\.songbank\.build\(A\.songs, bankNumber\)/.test(page), "the Export build hands the songs to buildToyRom");
check(/f\.name === "song\.json" \|\| f\.name === "songs\.json"/.test(page), "song files are not carried as a JSON tail");

/* 4. it plays */
const gg = process.env.GEARGRAFX || "/Volumes/External II/pce-tools/geargrafx/app/Geargrafx.app/Contents/MacOS/geargrafx";
if (!fs.existsSync(gg)) {
  console.log("SKIP: Geargrafx not found; the ROM was not played");
} else {
  const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "export-songs-"));
  const rom = path.join(scratch, "export-songs.pce");
  fs.writeFileSync(rom, Buffer.from(withSongs));
  const py = `
import sys, json
sys.path.insert(0, "tools")
from ggmcp import GG
g = GG(sys.argv[1])
freqs = set(); sounded = set()
for i in range(24):
    g.tool("debug_step_frame", {"frames": 10, "mode": "sync"})
    for c in json.loads(g.tool("get_psg_status"))["channels"][:4]:
        if c["enabled"] and c["frequency"]:
            freqs.add(c["frequency"]); sounded.add(c["index"])
g.close()
print(json.dumps({"freqs": sorted(freqs), "channels": sorted(sounded)}))
`;
  const r = spawnSync("python3", ["-I", "-c", py, rom], { cwd: ROOT, encoding: "utf8", timeout: 300000 });
  check(r.status === 0, "Geargrafx ran the exported ROM");
  if (r.status === 0) {
    const heard = JSON.parse(r.stdout);
    const rt = il.create(source, { chunkName: "main.lua", songs: songs });
    rt.load();
    for (let f = 0; f < 240; f++) rt.frame(f);
    const model = new Set();
    let sel = 0; const fl = [0, 0, 0, 0, 0, 0], fh = [0, 0, 0, 0, 0, 0];
    rt.sound.events.forEach((e) => {
      if (e.reg === 0) sel = e.value & 7;
      else if (sel < 4 && e.reg === 2) { fl[sel] = e.value; if (fl[sel] | fh[sel]) model.add(fl[sel] | (fh[sel] << 8)); }
      else if (sel < 4 && e.reg === 3) { fh[sel] = e.value & 15; if (fl[sel] | fh[sel]) model.add(fl[sel] | (fh[sel] << 8)); }
    });
    check(heard.channels.length >= 2, "at least two tonal channels sounded (" + heard.channels.join(",") + ")");
    check(heard.freqs.length >= 2, "at least two different notes were heard (" + heard.freqs.join(",") + ")");
    check(heard.freqs.every((f) => model.has(f)), "every frequency heard is one the studio's player writes for the song (" +
          heard.freqs.filter((f) => !model.has(f)).join(",") + " are not)");
  }
}
if (failures.length) { console.log("FAIL  " + failures.length + " of " + checks + " checks failed"); process.exit(1); }
console.log("PASS  " + checks + " checks, Export carries the toy's songs and the ROM plays them");
