#!/usr/bin/env node
/*
 * tools/host-c-compare.js — does the C that pce-cgen.js emits compute what the
 * browser computes?  No emulator: the generated C runs on this machine against a
 * stub runtime (tests/hostc/stub_runtime.c) and its sprite list after every toy
 * frame is compared with the browser runtime's (renderer/pce-toys.js).
 *
 *   node tools/host-c-compare.js toys/NAME/main.lua [FRAMES]
 *
 * Prints how many frames agree and, at the first frame that does not, the
 * differing sprite-list words.  The pad is idle on both sides; sound is not
 * modelled.  Scratch files go under $TMPDIR (External II).  Needs a C compiler
 * (cc/clang).  The sprite list is the picture's logic: positions, patterns and
 * the order the toy places them.
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const toyPath = process.argv[2], frames = +process.argv[3] || 60;
if (!toyPath) { console.error("usage: node tools/host-c-compare.js toys/NAME/main.lua [FRAMES]"); process.exit(2); }
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "hostc-"));
const dir = path.dirname(path.resolve(toyPath));

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, Object.assign({ encoding: "utf8", maxBuffer: 1 << 28, cwd: ROOT }, opts || {}));
  if (r.status !== 0) { console.error(cmd + " failed:\n" + (r.stderr || r.stdout).slice(0, 1500)); process.exit(1); }
  return r.stdout;
}

/* 1. the generated C, with the console's section attributes removed (Mach-O wants
 *    segment,section there; the host has no banks) */
const cFile = path.join(tmp, "toy.c");
run("node", [path.join(ROOT, "tools", "toyc", "emit.js"), toyPath, cFile]);
fs.writeFileSync(cFile, fs.readFileSync(cFile, "utf8")
  .replace(/__attribute__\(\(section\("[^"]*"\)\)\)/g, "")
  .replace(/__attribute__\(\(noinline, section\("[^"]*"\)\)\)/g, "__attribute__((noinline))"));
const bin = path.join(tmp, "toy-host");
run("cc", ["-O1", "-w", "-I" + path.join(ROOT, "tools", "toyc"), "-o", bin,
  path.join(ROOT, "tests", "hostc", "stub_runtime.c"), cFile]);

/* 2. the browser side, with the toy folder's art and its starting picture */
const toyhost = require("../renderer/pce-toyhost.js");
const toys = require("../renderer/pce-toys.js");
const files = toyhost.importer.FILES.filter((n) => fs.existsSync(path.join(dir, n)))
  .map((n) => ({ name: n, source: fs.readFileSync(path.join(dir, n), "utf8") }));
const args = [String(frames)];
const picture = files.length ? toyhost.importer.read(files) : null;
if (picture) {
  const initFile = path.join(tmp, "init.vram");
  fs.writeFileSync(initFile, Buffer.from(picture.vram.buffer, picture.vram.byteOffset, picture.vram.length));
  args.push(initFile);
}
const options = { budgetMs: 4000 };
if (files.length) options.files = files;
const rt = toys.create(fs.readFileSync(toyPath, "utf8"), options);
rt.load();
const want = [];
for (let f = 0; f < frames; f++) {
  const g = rt.frame(f);
  const w = [];
  for (let k = 0; k < 256; k++) w.push(g.state.sat[k * 2] | (g.state.sat[k * 2 + 1] << 8));
  want.push(w);
}

/* 3. the host run and the comparison */
const got = run(bin, args).trim().split("\n").map((l) => l.split(" ").slice(2).map((h) => parseInt(h, 16)));
let same = 0, first = null;
for (let f = 0; f < frames; f++) {
  const d = [];
  for (let k = 0; k < 256; k++) if (got[f][k] !== want[f][k]) d.push("w" + k + ":" + got[f][k].toString(16) + "/" + want[f][k].toString(16));
  if (!d.length) same++; else if (!first) first = { f: f, n: d.length, d: d.slice(0, 12) };
}
console.log(path.basename(dir) + ": " + same + " of " + frames + " frames equal (C / browser sprite list)");
if (first) console.log("first difference at frame " + first.f + ": " + first.n + " words, e.g. " + first.d.join(" "));
process.exit(first ? 1 : 0);
