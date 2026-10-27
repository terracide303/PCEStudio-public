#!/usr/bin/env node
/*
 * tests/check.js — diff the PCEStudio renderer against Mednafen's screenshots.
 *
 * NOTE: written by @design as part of #5 because the card's close condition
 * needs a diff script; per the workshop role split this is flagged for @review
 * to read cold, and #6 will make the renderer fail against it on purpose.
 *
 * For every tests/dumps/<scene>/ directory it reads vram.bin (VDC VRAM from
 * the Mednafen save state), cram.bin (VCE colour table), regs.json (the
 * scanline calibration values) and mednafen.png (the recorded raw frame,
 * 256x232 RGB, unfiltered — the last qtrecord frame, same source surface as
 * Mednafen's F9 shot), renders the frame with
 * renderer/pce-bg.js and requires pixel-for-pixel equality with the PNG
 * (diff 0).  Exit code 0 only if every picture matches.
 *
 * A dump whose CR has bit 7 clear is not a picture: the VDC background is
 * off, so whatever the frame contains says nothing about the renderer.
 * tests/dumps/us1 is exactly that — Mednafen shows the US HuCard image
 * blank (every VDC register 0), which is the emulator not running the image
 * (#25), not a rendered picture.  Such a dump is reported by name and NOT
 * counted.  The set is explicit below: a dump with the background off that
 * is not on that list fails the run, so a bad capture cannot hide as a
 * "not a picture".
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

/* Dumps that are not pictures, with the measured reason.  A dump whose CR has
 * bit 7 (background enable) clear is skipped only if it is named here. */
const NOT_PICTURES = {
  us1: "Mednafen shows the US HuCard image blank: every VDC register 0 " +
       "(CR=0x00, no background), so it is the emulator not running the " +
       "image (#25), not a rendered picture",
};

function checkScene(dir) {
  const name = path.basename(dir);
  const vram = fs.readFileSync(path.join(dir, "vram.bin"));
  const cram = fs.readFileSync(path.join(dir, "cram.bin"));
  const regs = JSON.parse(fs.readFileSync(path.join(dir, "regs.json"), "utf8"));
  const ref = decodePng(fs.readFileSync(path.join(dir, "mednafen.png")));

  /* CR bit 7 = BB (background blanking): 0 clears the background, 1 displays
   * it (VDC manual, CR R05, p. H7-5). */
  if (!(regs.CR & 0x80)) {
    if (!Object.prototype.hasOwnProperty.call(NOT_PICTURES, name)) {
      console.log(`${name}: NOT A PICTURE (CR=0x${regs.CR.toString(16)}) and ` +
                  `not on the documented skip list — FAIL`);
      return { kind: "error" };
    }
    console.log(`${name}: not a picture, skipped (not counted): ` +
                NOT_PICTURES[name]);
    return { kind: "not-picture" };
  }

  const got = bg.renderFrame({ vram, cram, regs, width: 256, height: 232 });

  if (got.width !== ref.width || got.height !== ref.height) {
    console.log(`${name}: SIZE MISMATCH renderer ${got.width}x${got.height} ` +
                `vs png ${ref.width}x${ref.height}`);
    return { kind: "error" };
  }
  let diffs = 0;
  const samples = [];
  for (let i = 0; i < got.pixels.length; i++) {
    if (got.pixels[i] !== ref.pixels[i]) {
      diffs++;
      if (samples.length < 8) {
        const o = i - (i % 3);
        const p = o / 3;
        samples.push(`px(${p % ref.width},${(p / ref.width) | 0}) ` +
          `got=${got.pixels[o]},${got.pixels[o + 1]},${got.pixels[o + 2]} ` +
          `ref=${ref.pixels[o]},${ref.pixels[o + 1]},${ref.pixels[o + 2]}`);
      }
    }
  }
  if (diffs === 0) {
    console.log(`${name}: OK (${got.width}x${got.height}, diff 0)`);
    return { kind: "ok" };
  }
  console.log(`${name}: ${diffs} differing pixels of ` +
              `${ref.width * ref.height * 3} bytes`);
  samples.forEach((s) => console.log(`  ${s}`));
  return { kind: "error" };
}

function main() {
  const dumps = path.join(__dirname, "dumps");
  if (!fs.existsSync(dumps)) {
    console.error(`no dumps in ${dumps} — run tools/capture.sh first`);
    return 2;
  }
  const dirs = fs.readdirSync(dumps).filter((d) =>
    fs.existsSync(path.join(dumps, d, "mednafen.png")))
    .sort().map((d) => path.join(dumps, d));
  if (dirs.length === 0) {
    console.error("no scene dumps with mednafen.png found");
    return 2;
  }
  let failed = 0, pictures = 0;
  const skipped = [];
  for (const dir of dirs) {
    const result = checkScene(dir);
    if (result.kind === "ok") pictures++;
    else if (result.kind === "not-picture") skipped.push(path.basename(dir));
    else failed++;
  }
  if (failed === 0) {
    console.log(`PASS: renderer matches Mednafen pixel for pixel on ` +
                `${pictures} scene(s)`);
    if (skipped.length > 0)
      console.log(`skipped (not pictures, not counted): ${skipped.join(", ")}`);
  } else {
    console.log(`FAIL: ${failed} scene(s) differ`);
  }
  return failed === 0 ? 0 : 1;
}

process.exitCode = main();
