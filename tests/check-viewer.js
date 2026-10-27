#!/usr/bin/env node
/*
 * tests/check-viewer.js — diff a viewer ROM's Mednafen frames against the
 * #5 renderer (card #8's closing measurement; also used for #9's
 * browser-built ROMs, tests/dumps/browserN/).
 *
 * NOTE: written by @design because the card's close condition needs a diff
 * script; per the workshop role split this is flagged for @review to read
 * cold (same arrangement as tests/check.js for #5).
 *
 * For every tests/dumps/{viewer,browser}<N>/ directory with a mednafen.png:
 *   - renders the frame for #5's scene N with renderer/pce-bg.js from
 *     tests/dumps/sceneN/{vram.bin,cram.bin,regs.json} — the renderer is the
 *     pixel reference (#5 proved it matches Mednafen's own scene ROMs) — and
 *     requires the viewer's recorded frame to equal it byte for byte
 *     (diff 0);
 *   - requires the viewer's captured state to contain what the viewer was
 *     told to load: vram.bin equal to the scene's (the tiles and the BAT
 *     landed), the first 512 bytes of cram.bin equal to the scene's (the 16
 *     palettes landed), and the static VDC registers (MWR/BXR/BYR/CR/VSR/VDR/
 *     HSR/HDR) equal to the scene's (256x224 mode, scroll from the config).
 *
 * Exit code 0 only if every viewer capture matches on all three checks.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const bg = require("../renderer/pce-bg.js");

/* ---- minimal PNG reader: 8-bit, non-interlaced, colour types 0/2/6 ---- */
function decodePng(buf) {
  if (buf.slice(0, 8).toString("latin1") !== "\x89PNG\r\n\x1a\n")
    throw new Error("not a PNG");
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colourType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.slice(pos + 4, pos + 8).toString("latin1");
    const data = buf.slice(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colourType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  if (bitDepth !== 8 || [0, 2, 6].indexOf(colourType) < 0)
    throw new Error(`unsupported PNG ${bitDepth}bpp type ${colourType}`);
  const chans = { 0: 1, 2: 3, 6: 4 }[colourType];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * chans;
  const out = Buffer.alloc(width * height * 3);
  const prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[p++];
    const line = raw.slice(p, p + stride);
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= chans ? line[i - chans] : 0;
      const b = prev[i];
      const c = i >= chans ? prev[i - chans] : 0;
      if (f === 1) line[i] = (line[i] + a) & 0xFF;
      else if (f === 2) line[i] = (line[i] + b) & 0xFF;
      else if (f === 3) line[i] = (line[i] + ((a + b) >> 1)) & 0xFF;
      else if (f === 4) {
        const pa = Math.abs(a + b - c - a), pb = Math.abs(a + b - c - b),
              pc = Math.abs(a + b - c - c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xFF;
      }
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 3;
      if (chans === 1) {
        out[o] = out[o + 1] = out[o + 2] = line[x];
      } else {
        out[o] = line[x * chans];
        out[o + 1] = line[x * chans + 1];
        out[o + 2] = line[x * chans + 2];
      }
    }
    line.copy(prev);
  }
  return { width, height, pixels: out };
}

function diffPixels(got, ref, name) {
  if (got.width !== ref.width || got.height !== ref.height)
    return `${name}: SIZE MISMATCH renderer ${got.width}x${got.height} ` +
           `vs viewer ${ref.width}x${ref.height}`;
  let diffs = 0;
  const samples = [];
  for (let i = 0; i < got.pixels.length; i++) {
    if (got.pixels[i] !== ref.pixels[i]) {
      diffs++;
      if (samples.length < 8) {
        const o = i - (i % 3);
        const p = o / 3;
        samples.push(`px(${p % ref.width},${(p / ref.width) | 0}) ` +
          `renderer=${got.pixels[o]},${got.pixels[o + 1]},${got.pixels[o + 2]} ` +
          `viewer=${ref.pixels[o]},${ref.pixels[o + 1]},${ref.pixels[o + 2]}`);
      }
    }
  }
  if (diffs === 0) return null;
  return `${name}: ${diffs} differing pixels of ` +
         `${ref.width * ref.height * 3} bytes\n` + samples.map((s) => `  ${s}`).join("\n");
}

const VDC_REGS = ["MWR", "BXR", "BYR", "CR", "VSR", "VDR", "HSR", "HDR"];

function checkViewer(dir) {
  const name = path.basename(dir);
  const scene = name.replace(/^(?:viewer|browser)/, "scene");
  const scenedir = path.join(path.dirname(dir), scene);
  const problems = [];

  const svram = fs.readFileSync(path.join(scenedir, "vram.bin"));
  const scram = fs.readFileSync(path.join(scenedir, "cram.bin"));
  const sregs = JSON.parse(fs.readFileSync(path.join(scenedir, "regs.json"), "utf8"));
  const vvram = fs.readFileSync(path.join(dir, "vram.bin"));
  const vcram = fs.readFileSync(path.join(dir, "cram.bin"));
  const vregs = JSON.parse(fs.readFileSync(path.join(dir, "regs.json"), "utf8"));

  // 1. the frame: renderer on #5's dump vs the viewer's recorded frame
  const got = bg.renderFrame({ vram: svram, cram: scram, regs: sregs,
                               width: 256, height: 232 });
  const ref = decodePng(fs.readFileSync(path.join(dir, "mednafen.png")));
  const p = diffPixels(got, ref, name);
  if (p) problems.push(p);

  // 2. the state: the viewer really loaded the tiles + BAT and the palettes
  if (!vvram.equals(svram)) {
    let first = 0;
    while (first < vvram.length && vvram[first] === svram[first]) first++;
    problems.push(`${name}: vram differs from ${scene} at byte ${first} ` +
                  `(tiles/BAT did not land)`);
  }
  if (!vcram.subarray(0, 512).equals(scram.subarray(0, 512))) {
    let first = 0;
    while (first < 512 && vcram[first] === scram[first]) first++;
    problems.push(`${name}: cram differs from ${scene} at byte ${first} ` +
                  `(the 16 palettes did not land)`);
  }
  for (const r of VDC_REGS) {
    if (vregs[r] !== sregs[r])
      problems.push(`${name}: ${r}=${vregs[r]} but ${scene} has ${sregs[r]}`);
  }

  if (problems.length === 0) {
    console.log(`${name}: OK (frame diff 0, vram/cram/regs match ${scene})`);
    return 0;
  }
  problems.forEach((s) => console.log(s));
  return 1;
}

function main() {
  const dumps = path.join(__dirname, "dumps");
  if (!fs.existsSync(dumps)) {
    console.error(`no dumps in ${dumps} — run tools/capture.sh first`);
    return 2;
  }
  const dirs = fs.readdirSync(dumps).filter((d) =>
    /^(?:viewer|browser)[0-9]$/.test(d) &&
    fs.existsSync(path.join(dumps, d, "mednafen.png")) &&
    fs.existsSync(path.join(dumps, "scene" + d.replace(/^(?:viewer|browser)/, ""),
                            "regs.json")))
    .sort().map((d) => path.join(dumps, d));
  if (dirs.length === 0) {
    console.error("no viewer/browser dumps with a matching scene found — " +
                  "run tools/capture.sh N viewer (or browser) first");
    return 2;
  }
  let failed = 0;
  for (const dir of dirs) failed += checkViewer(dir);
  console.log(failed === 0
    ? `PASS: viewer/browser ROMs match the renderer pixel for pixel on ` +
      `${dirs.length} capture(s)`
    : `FAIL: ${failed} viewer/browser capture(s) differ`);
  return failed === 0 ? 0 : 1;
}

process.exitCode = main();
