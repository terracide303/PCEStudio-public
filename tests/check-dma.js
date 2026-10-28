#!/usr/bin/env node
/*
 * tests/check-dma.js — the VRAM-to-VRAM DMA (#49).
 *
 * NOTE: written by @design because the card's close condition needs a check;
 * per the workshop role split this is flagged for @review to read cold (the
 * same arrangement as tests/check.js for #5 and check-viewer.js for #8).
 *
 * Every tests/dumps/dmaN/ is one ROM from tools/genroms.py's DMA_SCENES:
 * scene 1's picture data plus one VDC block transfer, captured in Mednafen
 * (tools/capture.sh N dma).  dma.json holds the descriptor the ROM was
 * generated from (SOUR/DESR/LENR/DCR), and tests/dumps/scene1/vram.bin is
 * the pre-transfer VRAM — the DMA ROM loads the same data scene 1's ROM
 * does, and any difference anywhere is a word the model got wrong.
 *
 * The check:
 *   1. runs renderer/pce-vram.js's runDma on scene 1's VRAM with the
 *      descriptor and requires the captured VRAM equal to it WORD FOR WORD
 *      (32768 words, report the first differing word);
 *   2. requires the captured SOUR/DESR/LENR to equal the model's
 *      post-transfer counters (the registers keep their new values; LENR
 *      ends $FFFF — MacDonald pcetech §5.4, MANUALS.md §15.1 GAP 2), and the
 *      captured DCR to equal the descriptor's;
 *   3. requires SR bit 4 (DV, VRAM-to-VRAM done) to equal the model's
 *      `dvBit`, which is set only when DCR bit 1 (DVC) enables it — pcetech
 *      §5 "a status bit is set only when its enable bit is set".  dma1 sets
 *      DVC (captured status $10); dma2/dma3 do not (captured status 0), so
 *      the gate has a positive and a negative capture;
 *   4. for a transfer whose source and destination ranges overlap, computes
 *      the memmove-style result (read the whole source, then write it) and
 *      requires the capture to DIFFER from it — the hardware moves one word
 *      at a time, so a model that snapshots the source would pass (1) on a
 *      non-overlapping ROM and fail here;
 *   5. renders the frame from the model's post-transfer VRAM (pce-bg.js) and
 *      requires Mednafen's recorded frame byte for byte (diff 0).  check.js
 *      also renders every dmaN dump from its own captured VRAM, so the card's
 *      "frame diff 0 in check.js" is that suite's dmaN lines.
 *
 * Exit code 0 only if every DMA capture matches on every check.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const bg = require("../renderer/pce-bg.js");
const vramModel = require("../renderer/pce-vram.js");

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

function wordAt(bytes, word) {
  return bytes[word * 2] | (bytes[word * 2 + 1] << 8);
}

/* A memmove-style copy of the same transfer: read every source word first,
 * then write the destination.  Only used to show that an overlapping
 * capture discriminates it from the hardware's word-at-a-time order. */
function snapshotCopy(vram, dma) {
  const dcr = vramModel.decodeDcr(dma.dcr);
  let src = dma.sour & 0xFFFF, dst = dma.desr & 0xFFFF;
  const words = (dma.lenr & 0xFFFF) + 1;
  const srcStep = dcr.siDec ? -1 : 1, dstStep = dcr.diDec ? -1 : 1;
  const got = new Array(words);
  for (let i = 0; i < words; i++) {
    got[i] = wordAt(vram, src);
    src = (src + srcStep) & 0xFFFF;
  }
  const out = Buffer.from(vram);
  dst = dma.desr & 0xFFFF;
  for (let i = 0; i < words; i++) {
    if (dst < vramModel.VRAM_WORDS) {
      out[dst * 2] = got[i] & 0xFF;
      out[dst * 2 + 1] = (got[i] >> 8) & 0xFF;
    }
    dst = (dst + dstStep) & 0xFFFF;
  }
  return out;
}

/* The words a transfer reads and writes, as min..max ranges (a decrementing
 * transfer walks them backwards). */
function ranges(dma) {
  const dcr = vramModel.decodeDcr(dma.dcr);
  const words = (dma.lenr & 0xFFFF) + 1;
  const sr = [dma.sour, (dma.sour + (dcr.siDec ? -(words - 1) : words - 1)) & 0xFFFF];
  const dr = [dma.desr, (dma.desr + (dcr.diDec ? -(words - 1) : words - 1)) & 0xFFFF];
  const lo = (r) => Math.min(r[0], r[1]);
  const hi = (r) => Math.max(r[0], r[1]);
  return {
    srcLo: lo(sr), srcHi: hi(sr), dstLo: lo(dr), dstHi: hi(dr),
    overlaps: lo(sr) <= hi(dr) && lo(dr) <= hi(sr)
  };
}

function checkDma(dir, dumps) {
  const name = path.basename(dir);
  const problems = [];
  const dma = JSON.parse(fs.readFileSync(path.join(dir, "dma.json"), "utf8"));
  const regs = JSON.parse(fs.readFileSync(path.join(dir, "regs.json"), "utf8"));
  const capture = fs.readFileSync(path.join(dir, "vram.bin"));
  const baseDir = path.join(dumps, dma.base || "scene1");
  const base = fs.readFileSync(path.join(baseDir, "vram.bin"));

  /* 0. the descriptor is a transfer of this VRAM: every word it touches is
   * inside the console's 32K words.  Above $7FFF is the upper half the
   * manual only describes as a mirror / corrupted reads (MANUALS.md §15.3
   * item 6); no claim here would be checked by these captures. */
  const rr = ranges(dma);
  if (Math.max(rr.srcHi, rr.dstHi) >= vramModel.VRAM_WORDS) {
    problems.push(`${name}: the transfer reaches word ` +
                  `0x${Math.max(rr.srcHi, rr.dstHi).toString(16)}, past the ` +
                  `32K-word VRAM (the model has no claim there)`);
  }

  /* 1. the model's VRAM, word for word */
  const model = vramModel.runDma(base, dma);
  let diffWords = 0, firstDiff = -1;
  for (let w = 0; w < vramModel.VRAM_WORDS; w++) {
    const a = wordAt(capture, w), b = wordAt(model.vram, w);
    if (a !== b) {
      diffWords++;
      if (firstDiff < 0) firstDiff = w;
    }
  }
  if (diffWords) {
    const w = firstDiff;
    problems.push(`${name}: ${diffWords} word(s) differ from the model; ` +
                  `first at VRAM $${w.toString(16).padStart(4, "0")}: ` +
                  `captured $${wordAt(capture, w).toString(16).padStart(4, "0")}, ` +
                  `model $${wordAt(model.vram, w).toString(16).padStart(4, "0")}`);
  }

  /* the transfer must have done something — otherwise a model that copied
   * nothing would pass on unchanged words */
  let changed = 0;
  for (let w = 0; w < vramModel.VRAM_WORDS; w++) {
    if (wordAt(base, w) !== wordAt(capture, w)) changed++;
  }
  if (changed === 0) {
    problems.push(`${name}: the capture's VRAM equals the base scene's — ` +
                  "the copy did nothing");
  }

  /* 2. the post-transfer counters and the control register */
  if (model.sour !== regs.SOUR)
    problems.push(`${name}: SOUR ends $${model.sour.toString(16)}, ` +
                  `captured $${(regs.SOUR || 0).toString(16)}`);
  if (model.desr !== regs.DESR)
    problems.push(`${name}: DESR ends $${model.desr.toString(16)}, ` +
                  `captured $${(regs.DESR || 0).toString(16)}`);
  if (model.lenr !== regs.LENR)
    problems.push(`${name}: LENR ends $${model.lenr.toString(16)}, ` +
                  `captured $${(regs.LENR || 0).toString(16)}`);
  if (regs.DCR !== (dma.dcr & 0xFFFF))
    problems.push(`${name}: captured DCR $${(regs.DCR || 0).toString(16)}, ` +
                  `the descriptor wrote $${(dma.dcr & 0xFFFF).toString(16)}`);

  /* 3. the done flag: DV (SR bit 4) only when DVC (DCR bit 1) is set */
  const saved = regs.status != null ? regs.status : 0;
  const savedDv = !!(saved & 0x10);
  const dcrBits = vramModel.decodeDcr(regs.DCR);
  if (model.dvBit !== savedDv) {
    problems.push(`${name}: model DV ${model.dvBit ? "set" : "clear"}, ` +
                  `saved status $${saved.toString(16)} (bit 4 ` +
                  `${savedDv ? "set" : "clear"})`);
  }
  if (model.dvBit !== dcrBits.dvc) {
    problems.push(`${name}: model DV ${model.dvBit ? "set" : "clear"} but ` +
                  `DCR $${(regs.DCR || 0).toString(16)} ` +
                  `${dcrBits.dvc ? "enables" : "does not enable"} it`);
  }
  if (saved & 0x08) {
    problems.push(`${name}: saved status $${saved.toString(16)} has DS ` +
                  "(bit 3) set, but DCR bit 0 (DSC) is clear — the SATB " +
                  "channel did not complete");
  }

  /* 4. an overlapping capture must discriminate the hardware's word-at-a-
   * time order from a memmove */
  let snapshotDiff = 0;
  if (rr.overlaps) {
    const snapshot = snapshotCopy(base, dma);
    for (let w = 0; w < vramModel.VRAM_WORDS; w++) {
      if (wordAt(snapshot, w) !== wordAt(capture, w)) snapshotDiff++;
    }
    if (snapshotDiff === 0) {
      problems.push(`${name}: the transfer overlaps its source, but the ` +
                    "capture also matches a snapshot (memmove) copy — the " +
                    "capture does not test the copy order");
    }
  }

  /* 5. the frame from the model's VRAM equals Mednafen's recorded frame.
   * The renderer applies the transfer itself (pce-bg.js's opts.dma), so this
   * also exercises the renderer's use of the model rather than a VRAM array
   * prepared beside it. */
  const ref = decodePng(fs.readFileSync(path.join(dir, "mednafen.png")));
  const got = bg.renderFrame({
    vram: base,
    dma,
    cram: fs.readFileSync(path.join(dir, "cram.bin")),
    regs,
    width: 256,
    height: 232,
    firstScanline: 14 + (regs.slstart != null ? regs.slstart : 4)
  });
  let pxDiff = 0;
  if (got.width !== ref.width || got.height !== ref.height) {
    problems.push(`${name}: frame size ${got.width}x${got.height}, png ` +
                  `${ref.width}x${ref.height}`);
  } else {
    for (let i = 0; i < got.pixels.length; i++) {
      if (got.pixels[i] !== ref.pixels[i]) pxDiff++;
    }
    if (pxDiff) {
      problems.push(`${name}: ${pxDiff} differing frame byte(s) from the ` +
                    "model's VRAM");
    }
  }

  if (problems.length === 0) {
    const d = vramModel.decodeDcr(dma.dcr);
    console.log(`${name}: OK (VRAM word for word 32768/32768, ` +
                `${model.words} word(s) ${d.siDec ? "dec" : "inc"}/` +
                `${d.diDec ? "dec" : "inc"}, ${changed} word(s) changed, ` +
                `SOUR $${model.sour.toString(16)} DESR ` +
                `$${model.desr.toString(16)} LENR $${model.lenr.toString(16)}, ` +
                `DV ${model.dvBit ? "set" : "clear"}` +
                `${rr.overlaps ? `, snapshot copy differs on ` +
                  `${snapshotDiff} word(s)` : ""}, frame diff 0)`);
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
    /^dma[0-9]+$/.test(d) &&
    fs.existsSync(path.join(dumps, d, "dma.json")) &&
    fs.existsSync(path.join(dumps, d, "regs.json")) &&
    fs.existsSync(path.join(dumps, d, "mednafen.png"))).sort();
  if (dirs.length === 0) {
    console.error("no dmaN dumps found — run tools/capture.sh 1..3 dma first");
    return 2;
  }
  let failed = 0;
  for (const d of dirs) failed += checkDma(path.join(dumps, d), dumps);
  console.log(failed === 0
    ? `PASS: ${dirs.length} VRAM-to-VRAM DMA capture(s) match the model ` +
      "word for word and render diff 0"
    : `FAIL: ${failed} DMA capture(s) differ`);
  return failed === 0 ? 0 : 1;
}

process.exitCode = main();
