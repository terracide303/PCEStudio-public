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

/* ---- the #48 display window and border -------------------------------- */
/* A dump whose VDC window is smaller than the captured frame must show the
 * border colour CRAM[0x100] (the blanking-period video data SPBG=1,
 * VD7..VD0=0 — VDC manual 2.3.6 p. H7-18) on every pixel outside the window,
 * and something else inside it.  This is the card's "including the border
 * pixels" evidence, computed from the raw register bytes here rather than
 * from pce-bg.js's window function, so the renderer cannot pass by agreeing
 * with itself.
 *
 *   HDS = back porch-1, HDW = characters-1 (HSR/HDR, H7-9): the window is
 *   (HDS+1)*8 .. (HDS+1)*8 + (HDW+1)*8 dots from the sync edge, clipped to
 *   the 341-dot 5.37 MHz line.  The 24-dot output alignment is Mednafen's
 *   (pce_fast correct_aspect=1, xs[1][0] = 24) — the manual settles the
 *   fields and the 8-dot character cycle, not the absolute position.
 *   VDW = display lines-1 (VDR, H7-10); the capture places VDW line 0 at
 *   the row the save's RCRCount puts it (captured row r shows VDW line
 *   RCRCount - (scanline - firstScanline) + r), so VDS/VSW enter through
 *   RCRCount.  VCR (front porch) never moves the window inside a capture.
 */
/* #27: the dot clock's line and alignment, written here from the VCE CR
 * byte (DCC bits 1-0) rather than read from pce-bg.js's table, so the
 * renderer cannot pass by agreeing with itself.  Line dots: a 2730-master-
 * clock line (Mednafen ClockPixelWidths {341,455,682}); alignment: Mednafen
 * xs[1] = {24,38,96} (correct_aspect, the way capture.sh records). */
const LINE_DOTS_BY_CLOCK = [341, 455, 682];
const H_ALIGN_BY_CLOCK = [24, 38, 96];
function expectedWindow(regs, firstScanline) {
  /* a dump without a window register carries the canonical HuDK 256x240
   * values (the renderer's own fallback; the synthetic mutation dumps are
   * the only such states) */
  const hsr = regs.HSR != null ? regs.HSR : 0x0202;
  const hdr = regs.HDR != null ? regs.HDR : 0x041F;
  const vdr = regs.VDR != null ? regs.VDR : 0x00EF;
  const hds = (hsr >> 8) & 0x7F;
  const hdw = hdr & 0x7F;
  const vcecr = regs.VCECR != null ? regs.VCECR : 0;
  const clock = (vcecr & 2) ? 2 : (vcecr & 1);
  const lineDots = LINE_DOTS_BY_CLOCK[clock];
  const hAlign = H_ALIGN_BY_CLOCK[clock];
  let start = (hds + 1) * 8;
  let end = start + (hdw + 1) * 8;
  if (start > lineDots) start = lineDots;
  if (end > lineDots) end = lineDots;
  if (start === end) start = end - 8;
  const vdwLine0 = (regs.RCRCount != null ? regs.RCRCount : 0) -
                   ((regs.scanline != null ? regs.scanline : firstScanline) -
                    firstScanline);
  return { x0: start - hAlign, x1: end - hAlign,
           y0: -vdwLine0, y1: (vdr & 0x1FF) - vdwLine0 + 1,
           vds: ((regs.VSR != null ? regs.VSR : 0x0F02) >> 8) & 0xFF,
           vdw: vdr & 0x1FF };
}

function checkWindow(name, regs, cram, ref, firstScanline, modelWindow) {
  const problems = [];
  const want = expectedWindow(regs, firstScanline);
  const got = modelWindow;
  if (got.x0 !== want.x0 || got.x1 !== want.x1 ||
      got.y0 !== want.y0 || got.y1 !== want.y1) {
    problems.push(`${name}: renderer window x[${got.x0},${got.x1}) ` +
      `y[${got.y0},${got.y1}) != the registers' x[${want.x0},${want.x1}) ` +
      `y[${want.y0},${want.y1})`);
  }
  const W = ref.width, H = ref.height;
  const x0 = Math.min(W, Math.max(0, want.x0));
  const x1 = Math.min(W, Math.max(0, want.x1));
  const y0 = Math.min(H, Math.max(0, want.y0));
  const y1 = Math.min(H, Math.max(0, want.y1));
  if (x0 === 0 && y0 === 0 && x1 === W && y1 === H) {
    return problems;   /* the window covers the frame: no border to witness */
  }
  const rgb = bg.decodeCram(cram);
  const br = [rgb[0x100 * 3], rgb[0x100 * 3 + 1], rgb[0x100 * 3 + 2]];
  let border = 0, bad = 0, inside = 0, insideBorder = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      const isBorder = ref.pixels[o] === br[0] &&
                       ref.pixels[o + 1] === br[1] &&
                       ref.pixels[o + 2] === br[2];
      if (x >= x0 && x < x1 && y >= y0 && y < y1) {
        inside++;
        if (isBorder) insideBorder++;
      } else {
        border++;
        if (!isBorder) bad++;
      }
    }
  }
  if (bad > 0) {
    problems.push(`${name}: ${bad} of ${border} pixels outside the window ` +
      `are not CRAM[0x100] (${br.join(",")})`);
  }
  if (border === 0) {
    problems.push(`${name}: the window leaves no border pixels to check`);
  }
  if (inside === 0 || insideBorder === inside) {
    problems.push(`${name}: the window has no non-border picture pixels ` +
      `(inside ${inside}, border-coloured ${insideBorder})`);
  }
  if (problems.length === 0) {
    console.log(`${name}: window ${x1 - x0}x${y1 - y0} ` +
      `(x ${x0}..${x1 - 1}, y ${y0}..${y1 - 1}), ${border} border pixel(s) ` +
      `= CRAM[0x100]`);
  }
  return problems;
}

/* Dumps that are skipped by name, with the measured reason.  A background-off
 * dump not named here is rendered as the backdrop like any other frame. */
const NOT_PICTURES = {
  us1: "Mednafen shows the US HuCard image blank: every VDC register 0 " +
       "(CR=0x00, no background), so it is the emulator not running the " +
       "image (#25), not a picture that exercises the renderer",
};

/* ---- the #15 raster-table checks -------------------------------------- */
/* #16: the check itself moved to tests/check-raster.js so the scene dumps
 * here and the viewer dumps in tests/check-viewer.js hold the same table
 * to the same save state with the same witnesses. */
const { checkRaster } = require("./check-raster");

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
  /* the width is not passed: it must follow the picture's dot clock
   * (pce-bg.js frameWidth), which is what the captured PNG's width is */
  const opts = { vram, cram, regs, height: 232, firstScanline, raster };
  /* #48: the register-derived window rectangle, held to the captured
   * border pixels. A frame the window covers completely has no border. */
  const winProblems = checkWindow(name, regs, cram, ref, firstScanline,
                                  bg.displayWindow(opts));
  if (winProblems.length) {
    winProblems.forEach((p) => console.log(p));
    return { kind: "error" };
  }
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
