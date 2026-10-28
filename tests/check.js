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
 * scanline calibration values and the capture crop slstart/slend) and
 * mednafen.png (the recorded raw frame,
 * 256x232 RGB, unfiltered — the last qtrecord frame, same source surface as
 * Mednafen's F9 shot), renders the frame with
 * renderer/pce-bg.js and requires pixel-for-pixel equality with the PNG
 * (diff 0).  A dump with sat.bin (the #12 sprite scenes) is rendered by
 * renderer/pce-sprites.js instead — the same background with the sprite
 * layer composed on top — and, as a regression net, every dump WITHOUT
 * sat.bin must also render identically through the sprites module (a sprite
 * scene's renderer must not change a sprite-free picture).  Exit code 0
 * only if every picture matches.
 *
 * A dump whose CR has bit 7 clear is the background-off case, which the
 * renderer now models (CR R05 bit 7 = BB, VDC manual p. H7-5): the frame is
 * the backdrop everywhere, and tests/dumps/scene8 is the diff-0 proof of
 * that.  tests/dumps/us1 stays on the skip list for its own reason — it is
 * Mednafen showing the US HuCard image blank (every VDC register 0), which
 * is the emulator not running the image (#25), not a picture that exercises
 * the renderer.  The skip list is explicit below and a dump with the
 * background off that is not on it is rendered like any other, so a bad
 * capture cannot hide behind a blanket "not a picture" rule.
 *
 * A dump with raster.json (the #15 raster scenes) is verified against it
 * first (checkRaster below: the table must describe what the ROM actually
 * wrote — the save state's registers, colour table and RCR chain are the
 * witnesses), and the renderer gets the table as opts.raster.
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

/* Dumps that are skipped by name, with the measured reason.  A background-off
 * dump not named here is rendered as the backdrop like any other frame. */
const NOT_PICTURES = {
  us1: "Mednafen shows the US HuCard image blank: every VDC register 0 " +
       "(CR=0x00, no background), so it is the emulator not running the " +
       "image (#25), not a picture that exercises the renderer",
};

/* ---- the #15 raster-table checks -------------------------------------- */
/* The table must describe what the ROM actually wrote.  Witnesses, all from
 * the save state: the registers (BXR/BYR/CR hold the last write of their
 * kind, RCR holds the chain's re-arm of the last fired step), the colour
 * table (baseCram plus every entry's writes in line order), and the table's
 * own self-consistency (lines strictly increasing, rcr = 0x40 + line).
 * Lines are VDW lines; 240 is allowed for the HBlank restore after the
 * last display line (239).  Returns a list of problem strings (empty = the
 * table checks out). */
function checkRaster(name, raster, regs, cram, vdwLine0) {
  const problems = [];
  const base = raster.base || {};
  const entries = raster.entries || [];
  if (!entries.length) {
    return ["no entries"];
  }
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].line <= entries[i - 1].line) {
      problems.push(`entries[${i}].line ${entries[i].line} not after ` +
                    `entries[${i - 1}].line ${entries[i - 1].line}`);
    }
  }
  for (const e of entries) {
    if (e.line < 0 || e.line > 240) {
      problems.push(`entry line ${e.line} outside 0..240`);
    }
    if (e.rcr !== 0x40 + e.line) {
      problems.push(`entry line ${e.line}: rcr ${e.rcr} != ` +
                    `${0x40 + e.line}`);
    }
    for (const [a, v] of (e.cram || [])) {
      if (a < 0 || a >= 512 || v < 0 || v >= 512) {
        problems.push(`entry line ${e.line}: cram [${a}, ${v}] out of range`);
      }
    }
    if (e.cramPrev) {
      if (!e.cram || e.cramPrev.length !== e.cram.length) {
        problems.push(`entry line ${e.line}: cramPrev shape != cram`);
      } else {
        for (let k = 0; k < e.cram.length; k++) {
          if (e.cramPrev[k][0] !== e.cram[k][0]) {
            problems.push(`entry line ${e.line}: cramPrev[${k}] address ` +
                           `${e.cramPrev[k][0]} != cram address ` +
                           `${e.cram[k][0]}`);
          }
        }
      }
    }
  }
  /* the saved registers: the last entry of each kind with line <= the save
   * line (regs.RCRCount), else the base — the write landed in the register
   * and the chain is in steady state */
  const rcrCount = regs.RCRCount;
  const kinds = [["bxr", "BXR", 0x3FF], ["byr", "BYR", 0x1FF], ["cr", "CR", 0xFF]];
  for (const [field, reg, mask] of kinds) {
    let last = null;
    for (const e of entries) {
      if (e[field] != null && e.line <= rcrCount) last = e;
    }
    const want = last != null ? last[field] : base[field];
    if (want != null && (regs[reg] & mask) !== (want & mask)) {
      problems.push(`saved ${reg}=${regs[reg]} != table's ${want} ` +
                    `(last ${field} entry ${last ? last.line : "none"})`);
    }
  }
  /* the saved RCR holds the chain's re-arm: 0x40 + the line of the entry
   * after the last fired one (wrapping) */
  let lastIdx = -1;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].line <= rcrCount) lastIdx = i;
  }
  const nextLine = entries[(lastIdx + 1) % entries.length].line;
  if (regs.RCR !== 0x40 + nextLine) {
    problems.push(`saved RCR=${regs.RCR} != chain's next arm ` +
                  `${0x40 + nextLine}`);
  }
  /* the saved colour table: baseCram plus every entry's writes in line
   * order (every cram entry must have fired before the save) */
  const words = new Array(512);
  for (let i = 0; i < 512; i++) {
    words[i] = raster.baseCram
      ? raster.baseCram[i]
      : (cram[i * 2] | (cram[i * 2 + 1] << 8));
  }
  for (const e of entries) {
    if (e.cram && e.line > rcrCount) {
      problems.push(`cram entry line ${e.line} > save line ${rcrCount}: ` +
                    `cannot be in the saved colour table`);
    }
    for (const [a, v] of (e.cram || [])) words[a] = v;
  }
  for (let i = 0; i < 512; i++) {
    const got = cram[i * 2] | (cram[i * 2 + 1] << 8);
    if (words[i] !== got) {
      problems.push(`cram entry ${i}: table ${words[i].toString(16)} != ` +
                    `state ${got.toString(16)}`);
      break;
    }
  }
  /* rows before the first cram entry of the frame show the previous
   * frame's colour table — only provable if the first entry fires at or
   * before the first captured row (vdwLine0); keep the invariant loud */
  const firstCram = entries.find((e) => e.cram);
  if (firstCram && firstCram.line > vdwLine0) {
    problems.push(`first cram entry line ${firstCram.line} > first ` +
                  `captured VDW line ${vdwLine0}`);
  }
  if (raster.base && raster.base.dcr != null && raster.base.dcr !== regs.DCR) {
    problems.push(`base.dcr ${raster.base.dcr} != saved DCR ${regs.DCR}`);
  }
  if (problems.length) {
    console.log(`${name}: raster.json does not match the save state:`);
    problems.forEach((p) => console.log(`  ${p}`));
  } else {
    console.log(`${name}: raster.json matches the save state`);
  }
  return problems;
}

function checkScene(dir) {
  const name = path.basename(dir);
  const vram = fs.readFileSync(path.join(dir, "vram.bin"));
  const cram = fs.readFileSync(path.join(dir, "cram.bin"));
  const regs = JSON.parse(fs.readFileSync(path.join(dir, "regs.json"), "utf8"));
  const satPath = path.join(dir, "sat.bin");
  const hasSat = fs.existsSync(satPath);
  const ref = decodePng(fs.readFileSync(path.join(dir, "mednafen.png")));

  if (Object.prototype.hasOwnProperty.call(NOT_PICTURES, name)) {
    console.log(`${name}: not a picture, skipped (not counted): ` +
                NOT_PICTURES[name]);
    return { kind: "not-picture" };
  }

  /* The dump records the capture crop (capture.sh writes slstart/slend into
   * regs.json); captured row 0 = VCE line 14 + slstart (14 lines of top
   * blanking, DisplayRect.y in Mednafen's pce module).  Defaults to the
   * original crop 4/235. */
  const firstScanline = 14 + (regs.slstart != null ? regs.slstart : 4);
  const vdwLine0 = regs.RCRCount - (regs.scanline - firstScanline);
  /* #15: a dump with raster.json is verified against the save state first
   * and the renderer gets the table */
  const rasterPath = path.join(dir, "raster.json");
  let raster = null;
  if (fs.existsSync(rasterPath)) {
    raster = JSON.parse(fs.readFileSync(rasterPath, "utf8"));
    if (checkRaster(name, raster, regs, cram, vdwLine0).length) {
      return { kind: "error" };
    }
  }
  const opts = { vram, cram, regs, width: 256, height: 232, firstScanline,
                 raster };
  /* The #12 sprite scenes render through the sprites module (sat.bin marks
   * them); everything else through the background renderer — and must also
   * come out identical through the sprites module, since a sprite renderer
   * that changes a sprite-free picture is broken. */
  const got = hasSat
    ? sprites.renderFrame(Object.assign({ sat: fs.readFileSync(satPath) }, opts))
    : bg.renderFrame(opts);

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
  if (!hasSat) {
    /* regression net: the sprites renderer must agree with the background
     * renderer on every sprite-free dump (pce-sprites.js composes on top of
     * the same indices; a sprite scene's model must not leak into them) */
    const viaSprites = sprites.renderFrame(opts);
    let same = viaSprites.pixels.length === got.pixels.length;
    for (let i = 0; same && i < got.pixels.length; i++) {
      same = viaSprites.pixels[i] === got.pixels[i];
    }
    if (!same) {
      console.log(`${name}: sprites renderer disagrees with bg renderer ` +
                  `on a sprite-free dump`);
      return { kind: "error" };
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
