#!/usr/bin/env node
/*
 * tests/check-ares.js — card #41's measurement: does ares (v148, the second
 * emulator) show the same picture as the renderer for the viewer ROMs and
 * the exported painted ROM?  #16 extends it to the raster viewers
 * (vrasterN) and the editor's effect picture (effect1): the frames ares
 * shows for the ROMs whose picture is the irq1 chain's per-scanline writes
 * must equal the renderer on the dump's own patched raster.json — ares's
 * RCR timing against Mednafen's, second emulator against the model.
 *
 * Evidence it reads:
 *   docs/ares-{viewerN,vrasterN,painted,effect1}.png
 *       256x224 frames captured from ares by tools/capture-ares.sh
 *   tests/dumps/<name>/ares-block.png
 *       the full 294x263 picture ares presents (the capture script also
 *       writes it so the 232-line window can be checked against the renderer
 *       and Mednafen, not only the 224-line crop in docs/)
 *   tests/dumps/<sceneN|painted|vrasterN|effect1>/{vram,cram,regs,sat}.bin
 *       the renderer's input (sceneN for viewerN, as tests/check-viewer.js;
 *       the dump itself for vrasterN/effect1 — the raster ROMs render from
 *       their own state, whose raster.json holds the chain's table)
 *   tests/dumps/<viewerN|painted>/mednafen.png
 *       Mednafen's 256x232 frame for the same ROM
 *
 * What it requires, per ROM:
 *   1. the stored ares block still has the geometry the crop assumes: 294
 *      dots wide, horizontal blanking of 24 dots left / 14 right, and a
 *      non-flat active area (a shifted or blank capture must fail here);
 *   2. the 256x224 docs frame equals the block's active crop (the two
 *      artifacts come from one capture);
 *   3. the 256x224 frame equals the renderer on the same 224 lines
 *      (VCE 18..241) — pixel for pixel after ares's 8-bit level scale is
 *      mapped back to the 3-bit colour index;
 *   4. the 256x232 window (VCE 18..249, the renderer's own frame height)
 *      equals the renderer, and equals Mednafen's frame for the same ROM;
 *   5. it reports the ares-vs-Mednafen 8-bit difference, which is a DAC
 *      level scale, not a picture difference (see docs/ARES.md).
 *
 * vraster4 is not compared: its table's colour values depend on a runtime
 * frame counter (ZP <$31>), so two runs — even on the same emulator —
 * differ by the counter's phase.  Every other raster scene is frame-stable
 * (the chain writes the same values every frame), so ares and Mednafen can
 * be held to the same picture.
 *
 * COLOUR NORMALISATION.  ares's linear-RGB path decodes each 3-bit channel
 * with image::normalize(n, 3, 16) and presents 8-bit values round(255*n/7):
 * 0,36,73,109,146,182,219,255 (ares/pce/vdp/color.cpp).  Mednafen and this
 * project's renderer use 36*n: 0,36,72,108,144,180,216,252.  Both are the
 * same 3-bit colour.  To compare the PICTURE, every channel is mapped back
 * with round(v*7/255); the raw 8-bit values are reported separately.  This
 * normalisation is why a byte-for-byte PNG diff of ares vs Mednafen is the
 * wrong test: it would fail on a difference that carries no picture
 * information.
 *
 *   node tests/check-ares.js
 *   ARES_ROMS=viewer2 ARES_DIR=/tmp/mut-docs ARES_DUMPS=/tmp/mut-dumps \
 *     node tests/check-ares.js      # prove the check fails on a changed pixel
 *
 * ARES_ROMS (comma list), ARES_DIR (docs/ replacement) and ARES_DUMPS
 * (tests/dumps/ replacement) exist so the check can be run against a
 * deliberately broken copy; the normal run uses none of them.
 *
 * Exit 0 only if every check passes; 1 if any picture/geometry check fails;
 * 2 if a ROM has SOME of its ares evidence but not all of it (a stale or
 * half-written capture).  A ROM with NO ares capture at all — the usual case
 * for a fresh clone on a machine without a screen — is reported as
 * `SKIP: <rom> — ...` with the command that captures it, counted in the
 * summary, and does not make the exit code 0 mean "every ROM was compared".
 * tools/../tests/all.sh reports that line as a SKIP, not a PASS.
 *
 * What this does NOT prove:
 *   - that ares's 8-bit DAC levels are the right ones (the Hudson HuC6260
 *     manual section 2.4 "RGB Outputs", p. H6-6, is missing from the scanned
 *     manual available here, so the manual settles the 3-bit colour word,
 *     p. H6-4/H6-5, but not the 0..255 raster values);
 *   - that ares is correct where the renderer is wrong: both could share an
 *     error, and ares is a cross-check, not the oracle (docs/DECISIONS.md);
 *   - anything about real hardware (the real PC Engine check is still #8);
 *   - the sprite scenes or any ROM not named above;
 *   - vraster4 (its table depends on a runtime frame counter, so the two
 *     emulators' runs legitimately differ — see above);
 *   - that screencapture caught ares's raw framebuffer: this is a compositor
 *     capture of the window at 1:1 presentation settings, which the geometry
 *     checks pin down but do not replace ares writing the frame itself.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const bg = require("../renderer/pce-bg.js");
const sprites = require("../renderer/pce-sprites.js");

const HERE = __dirname;
const ROOT = path.join(HERE, "..");
const ARES_DIR = process.env.ARES_DIR || path.join(ROOT, "docs");
const DUMPS = process.env.ARES_DUMPS || path.join(ROOT, "tests", "dumps");

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

/* ares 8-bit level -> 3-bit channel; Mednafen 36*n also lands on n. */
function threeBit(v) { return Math.round(v * 7 / 255); }

function crop(img, x, y, w, h) {
  const out = Buffer.alloc(w * h * 3);
  for (let row = 0; row < h; row++) {
    const src = ((y + row) * img.width + x) * 3;
    img.pixels.copy(out, row * w * 3, src, src + w * 3);
  }
  return { width: w, height: h, pixels: out };
}

function pixelDiff(a, b) {
  if (a.width !== b.width || a.height !== b.height)
    return { size: `${a.width}x${a.height} vs ${b.width}x${b.height}`,
             pixels: Infinity, samples: [] };
  let pixels = 0;
  const samples = [];
  for (let p = 0; p < a.width * a.height; p++) {
    const o = p * 3;
    if (threeBit(a.pixels[o]) !== threeBit(b.pixels[o]) ||
        threeBit(a.pixels[o + 1]) !== threeBit(b.pixels[o + 1]) ||
        threeBit(a.pixels[o + 2]) !== threeBit(b.pixels[o + 2])) {
      pixels++;
      if (samples.length < 6) {
        const x = p % a.width, y = (p / a.width) | 0;
        samples.push(`px(${x},${y}) ares=(${a.pixels[o]},${a.pixels[o + 1]},` +
          `${a.pixels[o + 2]}) ref=(${b.pixels[o]},${b.pixels[o + 1]},` +
          `${b.pixels[o + 2]})`);
      }
    }
  }
  return { size: null, pixels, samples };
}

/* The geometry the capture settings produce (tools/ares-frame.py). */
const BLOCK_W = 294, BLOCK_H = 263;
const ACTIVE_X = 24, ACTIVE_W = 256, ACTIVE_Y = 21, WINDOW_H = 232;

function checkBlockGeometry(block) {
  const problems = [];
  if (block.width !== BLOCK_W || block.height !== BLOCK_H)
    return [`ares block is ${block.width}x${block.height}, expected ` +
            `${BLOCK_W}x${BLOCK_H}`];
  const same = (x, y, n) => {
    const o = (y * block.width + x) * 3;
    for (let i = 1; i < n; i++) {
      const p = o + i * 3;
      for (let c = 0; c < 3; c++)
        if (block.pixels[p + c] !== block.pixels[o + c]) return false;
    }
    return true;
  };
  for (let y = 0; y < BLOCK_H; y += 8) {
    if (!same(0, y, ACTIVE_X)) problems.push(`line ${y}: left blanking not uniform`);
    if (!same(ACTIVE_X + ACTIVE_W, y, BLOCK_W - ACTIVE_X - ACTIVE_W))
      problems.push(`line ${y}: right blanking not uniform`);
  }
  const colours = new Set();
  for (let y = ACTIVE_Y; y < ACTIVE_Y + 32; y += 4)
    for (let x = ACTIVE_X; x < ACTIVE_X + ACTIVE_W; x += 4) {
      const o = (y * block.width + x) * 3;
      colours.add(`${block.pixels[o]},${block.pixels[o + 1]},${block.pixels[o + 2]}`);
    }
  if (colours.size < 2) problems.push("active area is a single flat colour");
  // Vertical geometry: the VDC display window starts at block line 20 on
  // these ROMs (ares line 21 is the renderer's first row, VCE 18), so lines
  // 0..19 and the last line 262 are blanking and must be uniform across the
  // whole 294-dot line.  A capture shifted up/down breaks this.
  for (let y = 0; y < ACTIVE_Y - 1; y++)
    if (!same(0, y, BLOCK_W)) problems.push(`line ${y}: blanking line not uniform`);
  if (!same(0, BLOCK_H - 1, BLOCK_W))
    problems.push(`line ${BLOCK_H - 1}: trailing blanking line not uniform`);
  return problems;
}

/* Build the renderer frame for a ROM's dump directory.  A raster dump
 * (#16) renders from its own state with its patched table — the same
 * opts.raster + firstScanline substitution tests/check-viewer.js makes. */
function renderFrame(dir, height) {
  const vram = fs.readFileSync(path.join(dir, "vram.bin"));
  const cram = fs.readFileSync(path.join(dir, "cram.bin"));
  const regs = JSON.parse(fs.readFileSync(path.join(dir, "regs.json"), "utf8"));
  const opts = { vram, cram, regs, width: 256, height };
  const rasterPath = path.join(dir, "raster.json");
  if (fs.existsSync(rasterPath)) {
    opts.raster = JSON.parse(fs.readFileSync(rasterPath, "utf8"));
    opts.firstScanline = 14 + (regs.slstart != null ? regs.slstart : 4);
  }
  const sat = path.join(dir, "sat.bin");
  if (fs.existsSync(sat)) opts.sat = fs.readFileSync(sat);
  return fs.existsSync(sat) ? sprites.renderFrame(opts) : bg.renderFrame(opts);
}

function levels(img) {
  const set = new Set();
  for (let i = 0; i < img.pixels.length; i++) set.add(img.pixels[i]);
  return [...set].sort((a, b) => a - b);
}

/* #16: the raster viewers.  vraster4 is out (runtime frame counter — the
 * two emulators' runs legitimately differ by the counter's phase); the
 * rest of the #15 scenes and the editor's effect picture are frame-stable
 * and render from the dump's own state (self: true — no separate scene
 * dir).  raster: true requires the dump's patched raster.json, which
 * tools/capture.sh writes when it runs the same ROM in Mednafen. */
const ROMS = [
  { name: "viewer1", scene: "scene1" },
  { name: "viewer2", scene: "scene2" },
  { name: "viewer3", scene: "scene3" },
  { name: "painted", scene: "painted" },
].concat([1, 2, 3, 5, 6, 7, 8, 9, 10].map((n) =>
  ({ name: `vraster${n}`, self: true, raster: true })))
  .concat([{ name: "effect1", self: true, raster: true }])
  .filter((r) => !process.env.ARES_ROMS ||
             process.env.ARES_ROMS.split(",").indexOf(r.name) >= 0);

let missing = [];
let skipped = [];
let failures = 0;

for (const rom of ROMS) {
  const framePath = path.join(ARES_DIR, `ares-${rom.name}.png`);
  const blockPath = path.join(DUMPS, rom.name, "ares-block.png");
  const mdPath = path.join(DUMPS, rom.name, "mednafen.png");
  const sceneDir = rom.self ? path.join(DUMPS, rom.name)
                            : path.join(DUMPS, rom.scene);
  const rasterPath = path.join(sceneDir, "raster.json");

  /* The two artifacts the ares capture writes.  If NEITHER exists, ares was
   * never run on this ROM (no screen on this machine is the common case):
   * that is a SKIP with a reason, never a pass — the summary below counts the
   * ROMs actually compared.  If one exists without the other, the capture is
   * stale or half-written: that is a failure, not a skip. */
  const hasFrame = fs.existsSync(framePath);
  const hasBlock = fs.existsSync(blockPath);
  if (!hasFrame && !hasBlock) {
    skipped.push({ name: rom.name,
                   need: `run tools/capture-ares.sh ${rom.name}` });
    continue;
  }

  const miss = [];
  if (!hasFrame) miss.push(framePath);
  if (!hasBlock) miss.push(blockPath);
  if (!fs.existsSync(mdPath)) miss.push(mdPath);
  if (!fs.existsSync(sceneDir)) miss.push(sceneDir);
  if (rom.raster && !fs.existsSync(rasterPath))
    miss.push(`${rasterPath} (run tools/capture.sh ${rom.name} ` +
              `in Mednafen first — ares needs the patched table)`);
  if (miss.length) { missing.push(...miss); continue; }

  const frame = decodePng(fs.readFileSync(framePath));
  const block = decodePng(fs.readFileSync(blockPath));
  const problems = [];

  // Geometry first: every later crop assumes this shape.
  const geom = checkBlockGeometry(block);
  for (const p of geom) problems.push(p);

  if (frame.width !== 256 || frame.height !== 224)
    problems.push(`docs frame is ${frame.width}x${frame.height}, expected 256x224`);

  if (geom.length === 0 && frame.width === 256 && frame.height === 224) {
    const fromBlock = crop(block, ACTIVE_X, ACTIVE_Y, 256, 224);
    if (!fromBlock.pixels.equals(frame.pixels))
      problems.push("docs frame is not the block's 256x224 active crop " +
                    "(stale or mismatched capture files)");

    const ref224 = renderFrame(sceneDir, 224);
    const ref232 = renderFrame(sceneDir, WINDOW_H);
    const ares232 = crop(block, ACTIVE_X, ACTIVE_Y, 256, WINDOW_H);

    const d224 = pixelDiff(fromBlock, ref224);
    const d232 = pixelDiff(ares232, ref232);
    if (d224.size || d224.pixels) {
      problems.push(`ares 256x224 vs renderer: ${d224.size || d224.pixels + " pixels"}`);
      for (const s of d224.samples) problems.push(`  ${s}`);
    }
    if (d232.size || d232.pixels) {
      problems.push(`ares 256x232 vs renderer: ${d232.size || d232.pixels + " pixels"}`);
      for (const s of d232.samples) problems.push(`  ${s}`);
    }

    let mdLine = "Mednafen frame missing, not compared";
    let rawLine = "";
    if (fs.existsSync(mdPath)) {
      const md = decodePng(fs.readFileSync(mdPath));
      if (md.width !== 256 || md.height !== WINDOW_H) {
        problems.push(`Mednafen frame is ${md.width}x${md.height}, expected 256x232`);
      } else {
        const dmd = pixelDiff(ares232, md);
        if (dmd.pixels) {
          problems.push(`ares 256x232 vs Mednafen: ${dmd.pixels} pixels differ ` +
                        `at 3-bit colour`);
          for (const s of dmd.samples) problems.push(`  ${s}`);
        }
        // Raw 8-bit difference: how the two DAC scales differ on the same
        // picture.  ares=round(255*n/7), Mednafen=36*n.
        let bytes = 0, max = 0;
        for (let i = 0; i < md.pixels.length; i++) {
          const d = Math.abs(ares232.pixels[i] - md.pixels[i]);
          if (d) { bytes++; if (d > max) max = d; }
        }
        mdLine = `ares 256x232 vs Mednafen: ${dmd.pixels}/${256 * WINDOW_H} ` +
                 `pixels differ at 3-bit colour`;
        rawLine = `raw 8-bit: ${bytes} of ${md.pixels.length} channel bytes ` +
                  `differ, max |delta| ${max}; ares levels ` +
                  `[${levels(ares232).join(",")}], Mednafen levels ` +
                  `[${levels(md).join(",")}]`;
      }
    }

    if (problems.length) {
      failures++;
      console.log(`${rom.name}: FAIL`);
      for (const p of problems) console.log(`  ${p}`);
    } else {
      console.log(`${rom.name}: OK (ares frame matches the renderer)`);
      console.log(`  256x224 (VCE 18..241) vs renderer: 0/${256 * 224} pixels differ`);
      console.log(`  256x232 (VCE 18..249) vs renderer: 0/${256 * WINDOW_H} pixels differ`);
      console.log(`  ${mdLine}`);
      if (rawLine) console.log(`  ${rawLine}`);
    }
  } else {
    failures++;
    console.log(`${rom.name}: FAIL`);
    for (const p of problems) console.log(`  ${p}`);
  }
}

if (missing.length) {
  console.log("missing evidence:");
  for (const m of missing) console.log(`  ${m}`);
  console.log("run tools/capture-ares.sh all");
  process.exit(2);
}

if (skipped.length) {
  console.log(`check-ares: ${ROMS.length - skipped.length} ROM(s) checked ` +
              `against ares frames, ${skipped.length} SKIPPED (no ares ` +
              "capture on this machine) — a skip is not a pass:");
  for (const s of skipped) console.log(`  SKIP: ${s.name} — no ares frame ` +
                                       `or block; ${s.need} on a machine ` +
                                       "with a screen");
}

console.log("");
console.log("NOT proven: ares's 8-bit DAC levels (HuC6260 manual 2.4, p. H6-6, " +
            "is absent from the scanned manual); that ares and the renderer " +
            "are both right rather than wrong together; real hardware (#8); " +
            "sprite scenes; vraster4 (a runtime frame counter makes runs " +
            "differ by phase).");
process.exit(failures ? 1 : 0);
