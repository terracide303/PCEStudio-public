#!/usr/bin/env node
/*
 * tools/bake-art.js — bake the picture a toy DRAWS into an art file the ROM loads at boot.
 *
 *   node tools/bake-art.js toys/NAME/main.lua FRAMES OUTDIR [--cram] [--regs] [--keep-sat]
 *
 * Some toys draw their art in code: DUSK RUN builds its 512 background tiles from pixel rules during its
 * first 137 frames.  In the studio that is instant; on the console (native route) it is two minutes of
 * software 32-bit multiplies before the game can start (docs/NATIVE.md).  This runs the toy in the
 * studio's own runtime (renderer/pce-toys.js) for FRAMES frames and writes OUTDIR/vram.json, a RAW image
 * (renderer/pce-toyhost.js, the `vram.json` file: format pce-vram/1) of the VRAM words the toy left that
 * differ from what its own asset files (tiles/palettes/sprites.json, if any) already give.  The native
 * ROM and the Export route load it like any imported picture; a toy that no longer draws that art itself
 * (see tests/native-dusk-baked) starts at once.
 *
 * What is baked, and what is not:
 *   VRAM    every word that differs from the asset files' own picture, EXCEPT the sprite attribute
 *           table ($7F00..$7FFF) unless --keep-sat: the toy rewrites its sprite list every frame.
 *   CRAM    only with --cram (a toy normally writes its palette in its own code, and per-line colour
 *           writes would bake a snapshot of one line).
 *   regs    only with --regs (BXR/BYR/MWR/CR as they stand after FRAMES frames).
 * The output is deterministic (no times, no paths).  Runs merge across gaps of fewer than 8 zero words.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const toys = require(ROOT + "/renderer/pce-toys.js");
const toyhost = require(ROOT + "/renderer/pce-toyhost.js");
const seq = require(ROOT + "/renderer/pce-seq.js");

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const [toyPath, framesStr, outDir] = args;
if (!toyPath || !framesStr || !outDir) {
  console.error("usage: node tools/bake-art.js toys/NAME/main.lua FRAMES OUTDIR [--cram] [--regs] [--keep-sat]");
  process.exit(2);
}
const FRAMES = +framesStr;
if (!(FRAMES >= 1)) { console.error("FRAMES must be at least 1"); process.exit(2); }

const dir = path.dirname(path.resolve(toyPath));
const RAW = "vram.json", SAT_WORD = 0x7F00, GAP = 8;
const files = toyhost.importer.FILES.filter((n) => n !== RAW && fs.existsSync(path.join(dir, n)))
  .map((n) => ({ name: n, source: fs.readFileSync(path.join(dir, n), "utf8") }));
const songFiles = ["song.json", "songs.json"].filter((n) => fs.existsSync(path.join(dir, n)))
  .map((n) => ({ name: n, source: fs.readFileSync(path.join(dir, n), "utf8") }));
const options = { budgetMs: 5000 };
if (files.length) options.files = files;
if (songFiles.length) options.songs = seq.songsFromFiles(songFiles);

/* what the toy's own asset files give before it runs: the base the bake is relative to */
const base = files.length ? toyhost.importer.read(files) : null;
const baseV = base ? base.vram : new Uint8Array(65536);
const baseC = base ? base.cram : new Uint8Array(1024);

const toy = toys.create(fs.readFileSync(path.resolve(toyPath), "utf8"), options);
toy.load();
for (let f = 0; f < FRAMES; f++) toy.frame(f);
const st = toy.state;
const vram = Uint8Array.from(st.vram), cram = Uint8Array.from(st.cram);
const regs = Object.assign({}, st.regs);
toy.dispose();

if (!flags.has("--keep-sat")) vram.fill(0, SAT_WORD * 2, SAT_WORD * 2 + 512);

function wordAt(a, i) { return a[i * 2] | (a[i * 2 + 1] << 8); }
function runsOf(now, was, count, skipFrom, skipTo) {
  const runs = [];
  for (let i = 0; i < count;) {
    const inSkip = i >= skipFrom && i < skipTo;
    if (inSkip || wordAt(now, i) === wordAt(was, i)) { i++; continue; }
    let end = i + 1, same = 0;
    for (let j = i + 1; j < count; j++) {
      if (j >= skipFrom && j < skipTo) break;
      if (wordAt(now, j) !== wordAt(was, j)) { end = j + 1; same = 0; } else if (++same >= GAP) break;
    }
    runs.push({ addr: i, words: Buffer.from(now.subarray(i * 2, end * 2)).toString("base64") });
    i = end;
  }
  return runs;
}

const keepSat = flags.has("--keep-sat");
const out = { format: "pce-vram/1", runs: runsOf(vram, baseV, 32768, keepSat ? 1 << 30 : SAT_WORD, keepSat ? 1 << 30 : SAT_WORD + 256) };
if (flags.has("--cram")) out.cram = runsOf(cram, baseC, 512, 1 << 30, 1 << 30);
if (flags.has("--regs")) out.regs = { BXR: regs.BXR, BYR: regs.BYR, MWR: regs.MWR, CR: regs.CR };

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, RAW), JSON.stringify(out) + "\n");
const words = out.runs.reduce((n, r) => n + Buffer.from(r.words, "base64").length / 2, 0);
console.error("baked " + path.basename(dir) + " after " + FRAMES + " frames: " + out.runs.length + " VRAM runs, " + words +
              " words (" + words * 2 + " bytes)" + (out.cram ? ", " + out.cram.length + " colour runs" : "") + " -> " + path.join(outDir, RAW));
