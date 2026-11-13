#!/usr/bin/env node
/*
 * tools/browser-frame.js — the studio's own picture of a toy at frame N, as raw RGB (256x224x3).
 *
 *   node tools/browser-frame.js toys/NAME/main.lua N OUT.rgb
 *
 * The toy folder's art and song files are loaded as the studio hands them to the runtime.  Used by
 * tools/compare-view.py to put a console capture, the browser's frame and their difference side by side.
 */
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const toys = require(ROOT + "/renderer/pce-toys.js");
const [toyPath, nStr, out] = process.argv.slice(2);
if (!toyPath || !out) { console.error("usage: node tools/browser-frame.js toys/NAME/main.lua N OUT.rgb"); process.exit(2); }
const dir = path.dirname(path.resolve(toyPath));
const files = ["tiles.json", "palettes.json", "sprites.json"].filter((n) => fs.existsSync(path.join(dir, n)))
  .map((n) => ({ name: n, source: fs.readFileSync(path.join(dir, n), "utf8") }));
const songFiles = ["song.json", "songs.json"].filter((n) => fs.existsSync(path.join(dir, n)))
  .map((n) => ({ name: n, source: fs.readFileSync(path.join(dir, n), "utf8") }));
const options = { budgetMs: 2000 };
if (files.length) options.files = files;
if (songFiles.length) options.songs = require(ROOT + "/renderer/pce-seq.js").songsFromFiles(songFiles);
const b = toys.create(fs.readFileSync(path.resolve(toyPath), "utf8"), options);
b.load();
let g;
for (let f = 0; f <= +nStr; f++) g = b.frame(f);
fs.writeFileSync(out, Buffer.from(g.pixels));
b.dispose();
