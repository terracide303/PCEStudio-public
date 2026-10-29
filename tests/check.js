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
 * the renderer.  tests/dumps/toypalette (#81) and tests/dumps/toyparallax
 * (#83) are the two toy captures: #31's capture route records an animation
 * and saves its state when Mednafen is interrupted, so the state is a frame
 * of the animation rather than the recorded last frame; those frames are
 * check-il-console.js's evidence, aligned against the browser run.
 * tests/dumps/palette-huc and parallax-huc (#45's HuC builds) and
 * toypalette-ilvm and toyparallax-ilvm (#100's bytecode builds) are the same
 * two toys captured through the toy route again: that route writes the crop
 * to meta.json, not regs.json, so this check's default crop puts the saved
 * state one line off.  Measured (#108): each renders diff 0 at the capture's
 * own slstart 3 and only at that crop, so the skip is the capture route, not
 * a renderer difference; check-il-huc.js and check-ilvm.js judge their
 * frames against the browser run.  The skip list is explicit below and a
 * dump with the background off that is not on it is rendered like any
 * other, so a bad capture cannot hide behind a blanket "not a picture" rule.
 * The four toy dumps are skipped rather than given the crop they record in
 * meta.json: a still capture records its crop in regs.json (capture.sh), the
 * toy route does not, and teaching this check to prefer meta.json's crop
 * would make the unlisted-dump guard's toy copy render clean — the guard
 * exists to prove an unlisted toy capture is still compared and fails.
 *
 * A dump with raster.json (the #15 raster scenes) is verified against it
 * first (checkRaster below: the table must describe what the ROM actually
 * wrote — the save state's registers, colour table and RCR chain are the
 * witnesses), and the renderer gets the table as opts.raster.
 *
 * #28: a dump with flicker.json is the flicker viewer's capture.  Besides
 * the single-frame check above (the dump's own state must render its last
 * frame — the rotated SATB really reached the VDC), it carries the last N
 * recorded frames (flicker-0..N-1.png): checkFlicker below renders frame N
 * of the rotation from the base SAT and requires all N consecutive phases
 * diff 0, then measures the union of the captured frames: every sprite of
 * the fixture shows in at least one frame and is dropped in at least one.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const bg = require("../renderer/pce-bg.js");
const sprites = require("../renderer/pce-sprites.js");
const flicker = require("../renderer/pce-flicker.js");

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
  /* #81: #31 part A's dump is an animated toy.  Measured while adding this
   * entry: the state is one line off with check.js's default crop because
   * capture-toy.sh records slstart 3 in meta.json, not regs.json (29280
   * differing bytes at the default 4; diff 0 with slstart 3), so the skip is
   * for the capture route — a saved animation frame whose phase need not be
   * the last recorded frame — and not for a renderer difference. */
  toypalette: "an animated toy capture (#31 part A), judged frame by frame " +
       "against the browser run by tests/check-il-console.js: its saved state " +
       "is one frame of a 149-frame animation, not the still scene this " +
       "check diffs against the recorded last frame",
  /* #83: #31 part C's raster toy has the same capture route as toypalette —
   * the save state is one frame of a 537-frame animation, not the recorded
   * last frame.  Measured: 86,595 differing pixels of 178,176 bytes against
   * its mednafen.png; check-il-console.js judges every recorded frame. */
  toyparallax: "an animated toy capture (#31 part C), judged frame by frame " +
       "against the browser run by tests/check-il-console.js: its saved state " +
       "is one frame of a 537-frame animation, not the still scene this " +
       "check diffs against the recorded last frame",
  /* #108: #45's HuC build of the palette toy.  The toy capture route
   * (capture-huc.sh) writes slstart 3 to meta.json and nothing to
   * regs.json, so this check's default crop 4 renders the saved state one
   * line off: measured 29,088 differing pixels of 178,176 bytes, and diff 0
   * against the dump's mednafen.png at slstart 3.  The skip is for that
   * capture route, not for a renderer difference; check-il-huc.js diffs the
   * recorded frames against the browser run. */
  "palette-huc": "a toy capture through the HuC route (#45), judged frame " +
       "by frame against the browser run by tests/check-il-huc.js: the " +
       "route records its crop slstart 3 in meta.json, not regs.json, so " +
       "the saved state renders diff 0 only at that crop (29,088 differing " +
       "pixels of 178,176 bytes at this check's default 4) — a capture " +
       "crop, not a renderer difference",
  /* #108: the same for #45's HuC build of the raster toy (86,595 differing
   * pixels at the default crop; diff 0 at slstart 3). */
  "parallax-huc": "a toy capture through the HuC route (#45), judged frame " +
       "by frame against the browser run by tests/check-il-huc.js: the " +
       "route records its crop slstart 3 in meta.json, not regs.json, so " +
       "the saved state renders diff 0 only at that crop (86,595 differing " +
       "pixels of 178,176 bytes at this check's default 4) — a capture " +
       "crop, not a renderer difference",
  /* #108: #100's IL-bytecode build of the palette toy (29,248 differing
   * pixels at the default crop; diff 0 at slstart 3), judged frame by frame
   * by check-ilvm.js. */
  "toypalette-ilvm": "a toy capture through the bytecode route (#100), " +
       "judged frame by frame against the browser run by " +
       "tests/check-ilvm.js: the route records its crop slstart 3 in " +
       "meta.json, not regs.json, so the saved state renders diff 0 only at " +
       "that crop (29,248 differing pixels of 178,176 bytes at this " +
       "check's default 4) — a capture crop, not a renderer difference",
  /* #108: the same for #100's bytecode build of the raster toy (86,595
   * differing pixels at the default crop; diff 0 at slstart 3). */
  "toyparallax-ilvm": "a toy capture through the bytecode route (#100), " +
       "judged frame by frame against the browser run by " +
       "tests/check-ilvm.js: the route records its crop slstart 3 in " +
       "meta.json, not regs.json, so the saved state renders diff 0 only at " +
       "that crop (86,595 differing pixels of 178,176 bytes at this " +
       "check's default 4) — a capture crop, not a renderer difference",
  /* #115: the status-bar toy (two register writes at line 24) on the same
   * bytecode route, judged by check-ilvm.js: its bar is diff 0 and its
   * playfield is the known four-line phase, so this check's whole-save
   * pixel comparison is not the judge. */
  "toystatusbar-ilvm": "a toy capture through the bytecode route (#115), " +
       "judged by tests/check-ilvm.js: the fixed bar (rows 0-23) is diff 0 " +
       "against the browser and the playfield carries the #31C handler's " +
       "known four-line phase, so this check's whole-save comparison is not " +
       "its judge",
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

/* ---- #28: the flicker capture -----------------------------------------
 *
 * A dump with flicker.json is the viewer ROM of a flicker picture.  The ROM
 * was built from a base SAT plus a rotation rule (step, phases and the
 * band's geometry — tools/genroms.py wrote gen/<scene>.flicker.json and
 * genviewer.py put step/phases in the config); capture.sh keeps the last
 * `phases` recorded frames as flicker-0..N-1.png (consecutive).
 *
 * The frames are rendered from the BASE SAT rotated by the rule, not from
 * the dump's saved SATB, so a viewer that did not rotate, rotated by the
 * wrong step, or built its copies at the wrong VRAM address cannot pass.
 *
 *   - the viewer's VRAM $7f00 holds the scene's base SAT (phase 0's copy);
 *   - exactly one q0 makes all N frames byte-equal to renders of phases
 *     (q0+i) mod N — the card's "each frame diff 0 against the renderer's
 *     frame N", and the proof the frames are CONSECUTIVE phases (a static
 *     SAT has no q0: the N renders differ);
 *   - the saved SATB is the last frame's phase (the DMA carried the rotated
 *     SAT the rule names);
 *   - the union: at a pixel only sprite i can paint — its exclusive columns
 *     outside sprite i-1's 16-px body, where sprite i is opaque and the
 *     background is not — every captured frame shows sprite i exactly in
 *     the frames the rule keeps it, every sprite shows at least once (the
 *     union is all of them) and is dropped at least once (it really was
 *     multiplexed).
 *
 * The kept-set arithmetic (which 16 of N sprites survive the VDC's line
 * search in phase q) is pce-flicker.js's, the renderer's model; the
 * measurement is on the captured pixels.  Both the model and the captures
 * are held to the fixture rule genroms.py wrote, and the frame diffs make
 * the pictures the renderer's.
 */
const FLICKER_SAT = 0x7f00;

function pixelDiff(a, b) {
  let n = Math.abs(a.pixels.length - b.pixels.length);
  const len = Math.min(a.pixels.length, b.pixels.length);
  for (let i = 0; i < len; i++) if (a.pixels[i] !== b.pixels[i]) n++;
  return n;
}

function sameRgb(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function rgbAt(img, x, y) {
  const o = (y * img.width + x) * 3;
  return [img.pixels[o], img.pixels[o + 1], img.pixels[o + 2]];
}

function checkFlicker(dir) {
  const name = path.basename(dir);
  const rule = JSON.parse(fs.readFileSync(path.join(dir, "flicker.json"),
                                          "utf8"));
  const scene = path.join(__dirname, "dumps", rule.scene);
  const problems = [];
  const phases = rule.phases;

  const sceneVram = fs.readFileSync(path.join(scene, "vram.bin"));
  const cram = fs.readFileSync(path.join(scene, "cram.bin"));
  const regs = JSON.parse(fs.readFileSync(path.join(scene, "regs.json"),
                                          "utf8"));
  const base = Buffer.from(sceneVram.slice(FLICKER_SAT * 2,
                                          FLICKER_SAT * 2 + 512));
  const vvram = fs.readFileSync(path.join(dir, "vram.bin"));
  const firstScanline = 14 + (regs.slstart != null ? regs.slstart : 4);
  const opts = { vram: sceneVram, cram, regs, height: 232, firstScanline };
  const vdwLine0 = regs.RCRCount - (regs.scanline - firstScanline);

  /* 1. the viewer's phase-0 copy is the scene's base SAT, and the scene's
   * populated entries are exactly 0..sprites-1 (sprite i is SAT entry i —
   * the rule's geometry and the union check both name sprites that way). */
  if (!vvram.slice(FLICKER_SAT * 2, FLICKER_SAT * 2 + 512).equals(base))
    problems.push(`${name}: VRAM $7f00 is not the base SAT of ` +
                  `${rule.scene} (phase 0's copy is missing or rotated)`);
  let populated = 0;
  for (let i = 0; i < 64; i++) {
    const y = base[i * 8] | (base[i * 8 + 1] << 8);
    const x = base[i * 8 + 2] | (base[i * 8 + 3] << 8);
    if (y || x) {
      if (i >= rule.sprites)
        problems.push(`${name}: SAT entry ${i} is populated but the rule ` +
                      `says ${rule.sprites} sprites`);
      populated++;
    }
  }
  if (populated !== rule.sprites)
    problems.push(`${name}: ${populated} populated SAT entries, the rule ` +
                  `says ${rule.sprites}`);

  /* 2. the consecutive frames and the phase renders */
  const frames = [];
  for (let i = 0; i < phases; i++) {
    const p = path.join(dir, `flicker-${i}.png`);
    if (!fs.existsSync(p)) {
      console.log(`${name}: missing ${path.basename(p)} — re-run ` +
                  `tools/capture.sh flicker`);
      return 1;
    }
    frames.push(decodePng(fs.readFileSync(p)));
  }
  const phaseImg = [];
  for (let q = 0; q < phases; q++)
    phaseImg.push(flicker.renderFrame(Object.assign({ sat: base }, opts),
                                      rule, q));
  for (let a = 0; a < phases; a++)
    for (let b = a + 1; b < phases; b++)
      if (pixelDiff(phaseImg[a], phaseImg[b]) === 0)
        problems.push(`${name}: phases ${a} and ${b} render identically; the ` +
                      `fixture cannot tell them apart`);

  let q0 = null, q0Count = 0;
  const diffs = [];
  for (let q = 0; q < phases; q++) {
    let d = 0;
    for (let i = 0; i < frames.length; i++)
      d += pixelDiff(frames[i], phaseImg[(q + i) % phases]);
    diffs.push(d);
    if (d === 0) { q0 = q; q0Count++; }
  }
  if (q0Count !== 1) {
    problems.push(`${name}: ${q0Count} phase alignment(s) make all ` +
                  `${frames.length} frames diff 0 (want exactly 1; diff ` +
                  `counts by starting phase ${diffs.join("/")})`);
  }

  /* 3. the saved SATB is the last frame's phase */
  if (q0 != null) {
    const lastPhase = (q0 + frames.length - 1) % phases;
    const want = Buffer.from(flicker.rotateSat(base, rule.step, lastPhase));
    const have = fs.readFileSync(path.join(dir, "sat.bin"));
    if (!have.equals(want))
      problems.push(`${name}: sat.bin is not phase ${lastPhase} — the last ` +
                    `frame's rotated SATB did not reach the VDC`);
  }

  /* 4. the sprites, measured on the captures.
   *
   * A signature pixel per sprite: inside the columns only that sprite can
   * paint (sprite i-1's 16-px body ends 6 columns into sprite i at 10-px
   * spacing; the first and last sprites use the band edge) and where the
   * sprite alone paints over the background.  In a frame that does not show
   * sprite i the same pixel is background, so the colour tests the sprite's
   * presence directly — no other sprite can paint there. */
  const boxBg = sprites.renderFrame(Object.assign(
    { sat: new Uint8Array(flicker.BYTES) }, opts));
  const x0 = rule.sat_x0 - 32, dx = rule.sat_dx;
  const yTop = rule.sat_y - 64;
  const sigs = [];
  for (let i = 0; i < rule.sprites; i++) {
    const aloneSat = new Uint8Array(flicker.BYTES);
    aloneSat.set(base.slice(i * 8, i * 8 + 8), i * 8);     /* 4 words */
    const alone = sprites.renderFrame(Object.assign({ sat: aloneSat }, opts));
    const xLo = x0 + i * dx + (i === 0 ? 0 : 6);
    const xHi = x0 + i * dx + (i === rule.sprites - 1 ? rule.width - 1 : 9);
    let sig = null;
    for (let y = yTop; y < yTop + rule.height && !sig; y++) {
      const ry = y - vdwLine0;
      if (ry < 0 || ry >= alone.height) continue;
      for (let x = Math.max(0, xLo); x <= Math.min(alone.width - 1, xHi);
           x++) {
        if (!sameRgb(rgbAt(alone, x, ry), rgbAt(boxBg, x, ry))) {
          sig = { x: x, y: ry, alone: alone };
          break;
        }
      }
    }
    if (!sig) {
      problems.push(`${name}: sprite ${i} paints no pixel outside sprite ` +
                    `${i - 1}'s body — the fixture cannot name it in a ` +
                    `capture`);
    }
    sigs.push(sig);
  }

  /* 4a. the fixture's own static scene capture: the 16-strip search on the
   * base SAT keeps 16 of the 24, and the capture shows exactly those. */
  let sceneShown = null;
  const scenePng = path.join(scene, "mednafen.png");
  if (fs.existsSync(scenePng)) {
    const ref = decodePng(fs.readFileSync(scenePng));
    const kept0 = flicker.keptSprites(rule, base, yTop, 0);
    let shown = 0;
    for (let i = 0; i < rule.sprites; i++) {
      const sig = sigs[i];
      if (!sig) continue;
      const got = sameRgb(rgbAt(ref, sig.x, sig.y),
                          rgbAt(sig.alone, sig.x, sig.y));
      const want = kept0.indexOf(i) >= 0;
      if (got) shown++;
      if (got !== want)
        problems.push(`${name}: ${rule.scene} shows sprite ${i} = ${got}, ` +
                      `the phase-0 search keeps it = ${want}`);
    }
    sceneShown = shown;
    if (shown !== Math.min(rule.keep, rule.sprites))
      problems.push(`${name}: ${rule.scene} shows ${shown} sprites, the ` +
                    `16-strip search keeps ${Math.min(rule.keep,
                                                     rule.sprites)}`);
  }

  /* 4b. the union over the consecutive frames: every sprite shows in the
   * frames the rule keeps it, none in all of them. */
  const seenCounts = [];
  if (q0 != null) {
    let shownAll = 0, bad = 0;
    for (let i = 0; i < rule.sprites; i++) {
      const sig = sigs[i];
      if (!sig) { bad++; continue; }
      const kept = [];
      for (let q = 0; q < phases; q++)
        kept.push(flicker.keptSprites(rule, base, yTop, q).indexOf(i) >= 0);
      let seen = 0;
      for (let f = 0; f < frames.length; f++) {
        const q = (q0 + f) % phases;
        const got = sameRgb(rgbAt(frames[f], sig.x, sig.y),
                            rgbAt(sig.alone, sig.x, sig.y));
        if (got !== kept[q]) {
          problems.push(`${name}: sprite ${i} is ${kept[q] ? "" : "not "}` +
                        `kept in phase ${q} but frame ${f} ` +
                        `${got ? "shows" : "does not show"} it`);
          bad++;
        }
        if (got) seen++;
      }
      seenCounts.push(seen);
      if (seen > 0) shownAll++;
      if (seen === phases)
        problems.push(`${name}: sprite ${i} shows in all ${phases} frames ` +
                      `— it was never multiplexed`);
      if (rule.shown && seen !== rule.shown[i])
        problems.push(`${name}: sprite ${i} shows in ${seen} frames, the ` +
                      `rule says ${rule.shown[i]}`);
    }
    if (bad || shownAll !== rule.sprites)
      problems.push(`${name}: union ${shownAll}/${rule.sprites} sprites, ` +
                    `${bad} disagreement(s)`);
  }

  if (problems.length === 0) {
    const counts = seenCounts.join(",");
    console.log(`${name}: OK (${frames.length} consecutive frames = ` +
                `phases ${q0}..${(q0 + frames.length - 1) % phases}, diff 0; ` +
                `sat.bin = the last frame's phase; ${rule.scene} shows ` +
                `${sceneShown}/${rule.sprites} sprites (the ` +
                `${rule.keep}-strip limit); union ` +
                `${rule.sprites}/${rule.sprites} sprites, shown per sprite ` +
                `${counts})`);
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
    fs.existsSync(path.join(dumps, d, "mednafen.png")))
    .sort().map((d) => path.join(dumps, d));
  if (dirs.length === 0) {
    console.error("no scene dumps with mednafen.png found");
    return 2;
  }
  let failed = 0, pictures = 0, flickers = 0;
  const skipped = [];
  for (const dir of dirs) {
    const result = checkScene(dir);
    if (result.kind === "ok") pictures++;
    else if (result.kind === "not-picture") skipped.push(path.basename(dir));
    else failed++;
    /* #28: a flicker dump also carries the N consecutive rotation frames */
    if (fs.existsSync(path.join(dir, "flicker.json")))
      checkFlicker(dir) === 0 ? flickers++ : failed++;
  }
  if (failed === 0) {
    console.log(`PASS: renderer matches Mednafen pixel for pixel on ` +
                `${pictures} scene(s)` +
                (flickers ? ` and ${flickers} flicker capture(s)` : ""));
    if (skipped.length > 0)
      console.log(`skipped (not pictures, not counted): ${skipped.join(", ")}`);
  } else {
    console.log(`FAIL: ${failed} scene(s) differ`);
  }
  return failed === 0 ? 0 : 1;
}

process.exitCode = main();
