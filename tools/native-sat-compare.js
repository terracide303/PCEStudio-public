#!/usr/bin/env node
/*
 * tools/native-sat-compare.js — does a native ROM's sprite list equal the browser's?
 *
 *   node tools/native-sat-compare.js ROM.pce toys/NAME/main.lua [VIDEO_FRAMES]
 *
 * Runs the ROM in Geargrafx (tools/ggmcp.py satdump), reads the runtime's toy-frame
 * counter and the sprite list the console holds in VRAM at $7F00, and compares it with
 * the browser runtime's sprite list (state.sat) for the toy frames around that counter.
 * Prints the best match and, if it is not exact, the differing words.  Together with
 * tools/host-c-compare.js (is the compiled logic right?) it says whether a wrong picture
 * is the compiler or the runtime.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const rom = process.argv[2], toy = process.argv[3], frames = process.argv[4] || "400";
if (!rom || !toy) { console.error("usage: node tools/native-sat-compare.js ROM.pce toys/NAME/main.lua [VIDEO_FRAMES]"); process.exit(2); }
const r = spawnSync("python3", ["-I", path.join(ROOT, "tools", "ggmcp.py"), rom, "satdump", frames],
  { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26, timeout: 300000 });
if (r.status !== 0) { console.error(r.stderr || r.stdout); process.exit(1); }
const nat = JSON.parse(r.stdout);
const toys = require("../renderer/pce-toys.js"), toyhost = require("../renderer/pce-toyhost.js");
const dir = path.dirname(path.resolve(toy));
const files = toyhost.importer.FILES.filter((n) => fs.existsSync(path.join(dir, n)))
  .map((n) => ({ name: n, source: fs.readFileSync(path.join(dir, n), "utf8") }));
const songFiles = ["song.json", "songs.json"].filter((n) => fs.existsSync(path.join(dir, n)))
  .map((n) => ({ name: n, source: fs.readFileSync(path.join(dir, n), "utf8") }));
const options = { budgetMs: 4000 }; if (files.length) options.files = files;
if (songFiles.length) options.songs = require("../renderer/pce-seq.js").songsFromFiles(songFiles);
const rt = toys.create(fs.readFileSync(toy, "utf8"), options); rt.load();
let best = null;
for (let f = 0; f <= nat.count + 2; f++) {
  const g = rt.frame(f);
  if (f < nat.count - 4) continue;
  const d = [];
  for (let k = 0; k < 256; k++) {
    const b = g.state.sat[k * 2] | (g.state.sat[k * 2 + 1] << 8);
    if (b !== nat.sat[k]) d.push("w" + k + ":" + nat.sat[k].toString(16) + "/" + b.toString(16));
  }
  if (!best || d.length < best.d.length) best = { f: f, d: d };
}
console.log(path.basename(dir) + ": native toy frames " + nat.count + " (runtime flags " + nat.flags + "), closest browser frame " + best.f + ": " + best.d.length + " differing sprite-list words" + (best.d.length ? " e.g. " + best.d.slice(0, 8).join(" ") : ""));
process.exit(best.d.length ? 1 : 0);
