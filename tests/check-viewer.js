#!/usr/bin/env node
/*
 * tests/check-viewer.js — diff a viewer ROM's Mednafen frames against the
 * renderer (card #8's closing measurement; #14 extends it to the sprite
 * scenes; also used for #9's browser-built ROMs, tests/dumps/browserN/).
 *
 * NOTE: written by @design because the card's close condition needs a diff
 * script; per the workshop role split this is flagged for @review to read
 * cold (same arrangement as tests/check.js for #5).
 *
 * For every tests/dumps/{viewer,browser,vsprite}<N>/ directory with a
 * mednafen.png:
 *   - renders the frame for the matching scene (sceneN for viewer/browserN,
 *     spriteN for vspriteN) with the renderer — pce-sprites.js when the
 *     scene has a sat.bin, else pce-bg.js — from
 *     tests/dumps/{scene,sprite}N/{vram.bin,cram.bin,regs.json,sat.bin} and
 *     requires the viewer's recorded frame to equal it byte for byte
 *     (diff 0).  The renderer is the pixel reference (#5 and #12 proved it
 *     matches Mednafen's own scene ROMs);
 *   - requires the viewer's captured state to contain what the viewer was
 *     told to load: vram.bin equal to the scene's (the tiles, the BAT, the
 *     SG patterns and the SAT all landed), the full 1024-byte cram.bin equal
 *     to the scene's (all 512 colour-table entries landed), the SATB mirror
 *     sat.bin equal to the scene's (the DCR bit-4 DMA carried the SAT — the
 *     #14 evidence), and the static VDC registers (MWR/BXR/BYR/CR/VSR/VDR/
 *     HSR/HDR/DCR/SATB) equal to the scene's (256x224 mode, scroll from the
 *     config, SATB DMA source).
 *
 * Exit code 0 only if every viewer capture matches on all checks.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const bg = require("../renderer/pce-bg.js");
const sprites = require("../renderer/pce-sprites.js");

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

const VDC_REGS = ["MWR", "BXR", "BYR", "CR", "VSR", "VDR", "HSR", "HDR",
                  "DCR", "SATB"];

/* The matching scene dir for a viewer capture: viewerN/browserN -> sceneN,
 * vspriteN -> spriteN (#14). */
function sceneDir(dir) {
  const name = path.basename(dir);
  const scene = name.replace(/^vsprite/, "sprite")
                    .replace(/^(?:viewer|browser)/, "scene");
  return path.join(path.dirname(dir), scene);
}

function checkViewer(dir) {
  const name = path.basename(dir);
  const scenedir = sceneDir(dir);
  const problems = [];

  const svram = fs.readFileSync(path.join(scenedir, "vram.bin"));
  const scram = fs.readFileSync(path.join(scenedir, "cram.bin"));
  const sregs = JSON.parse(fs.readFileSync(path.join(scenedir, "regs.json"), "utf8"));
  const vvram = fs.readFileSync(path.join(dir, "vram.bin"));
  const vcram = fs.readFileSync(path.join(dir, "cram.bin"));
  const vregs = JSON.parse(fs.readFileSync(path.join(dir, "regs.json"), "utf8"));
  const ssatPath = path.join(scenedir, "sat.bin");
  const vsatPath = path.join(dir, "sat.bin");

  // 1. the frame: the renderer on the scene's dump vs the viewer's recorded
  // frame.  The sprite scenes render through the sprites module (the
  // sat.bin marks them), the same route tests/check.js uses; the sprites
  // module equals the background renderer on a sprite-free picture.
  const opts = { vram: svram, cram: scram, regs: sregs,
                 width: 256, height: 232 };
  if (fs.existsSync(ssatPath)) opts.sat = fs.readFileSync(ssatPath);
  const got = fs.existsSync(ssatPath)
    ? sprites.renderFrame(opts) : bg.renderFrame(opts);
  const ref = decodePng(fs.readFileSync(path.join(dir, "mednafen.png")));
  const p = diffPixels(got, ref, name);
  if (p) problems.push(p);

  // 2. the state: the viewer really loaded the tiles + BAT + SG patterns +
  // the SAT, the palettes, and the SATB DMA carried the SAT
  if (!vvram.equals(svram)) {
    let first = 0;
    while (first < vvram.length && vvram[first] === svram[first]) first++;
    problems.push(`${name}: vram differs from ${path.basename(scenedir)} ` +
                  `at byte ${first} (copied data did not land)`);
  }
  if (!vcram.equals(scram)) {
    let first = 0;
    while (first < vcram.length && vcram[first] === scram[first]) first++;
    problems.push(`${name}: cram differs from ${path.basename(scenedir)} ` +
                  `at byte ${first} (the 512 colour-table entries did not land)`);
  }
  for (const r of VDC_REGS) {
    if (vregs[r] !== sregs[r])
      problems.push(`${name}: ${r}=${vregs[r]} but ` +
                    `${path.basename(scenedir)} has ${sregs[r]}`);
  }
  if (fs.existsSync(ssatPath) && fs.existsSync(vsatPath)) {
    const ssat = fs.readFileSync(ssatPath);
    const vsat = fs.readFileSync(vsatPath);
    if (!vsat.equals(ssat)) {
      let first = 0;
      while (first < vsat.length && vsat[first] === ssat[first]) first++;
      problems.push(`${name}: sat.bin differs from ` +
                    `${path.basename(scenedir)} at byte ${first} ` +
                    `(the SATB DMA did not carry the SAT)`);
    }
  }

  if (problems.length === 0) {
    console.log(`${name}: OK (frame diff 0, vram/cram/sat/regs match ` +
                `${path.basename(scenedir)})`);
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
    /^(?:viewer|browser)[0-9]$|^vsprite[0-9]+$/.test(d) &&
    fs.existsSync(path.join(dumps, d, "mednafen.png")) &&
    fs.existsSync(path.join(sceneDir(path.join(dumps, d)), "regs.json")))
    .sort().map((d) => path.join(dumps, d));
  if (dirs.length === 0) {
    console.error("no viewer/browser/vsprite dumps with a matching scene " +
                  "found — run tools/capture.sh N viewer (or browser, or " +
                  "vsprite) first");
    return 2;
  }
  let failed = 0;
  for (const dir of dirs) failed += checkViewer(dir);
  console.log(failed === 0
    ? `PASS: viewer/browser/vsprite ROMs match the renderer pixel for ` +
      `pixel on ${dirs.length} capture(s)`
    : `FAIL: ${failed} viewer/browser/vsprite capture(s) differ`);
  return failed === 0 ? 0 : 1;
}

process.exitCode = main();
