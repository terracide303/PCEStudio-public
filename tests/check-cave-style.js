#!/usr/bin/env node
/*
 * tests/check-cave-style.js — #219's evidence: a cave-style toy (a 32x28
 * BAT, 16 tiles, a 16-colour palette, no pad, no sprites) exports through
 * the studio route (tools/ilvm/emit.js -> renderer/pce-il.js ->
 * renderer/pce-ilbc.js -> renderer/pce-rom.js buildToyRom) and its ROM, run
 * in Mednafen, shows the picture the renderer draws from the same VRAM/CRAM.
 *
 *   node tests/check-cave-style.js
 *
 * Evidence it reads:
 *   tests/cave-style/main.lua           the toy (written for this card)
 *   tests/dumps/cave-style-ilvm/        Mednafen's save-state dump and its
 *     mednafen.png (256x232)            frame, from tools/capture-ilvm.sh
 *     vram.bin cram.bin regs.json sat.bin
 *     meta.json                          the ROM sha the capture ran
 *
 * It requires:
 *   1. the exported ROM is the one the capture ran (sha256 in meta.json
 *      equals a fresh build of the toy through the studio route);
 *   2. the picture is not flat (the check cannot pass 0 against 0);
 *   3. the 256x232 Mednafen frame equals renderer/pce-sprites.js's frame
 *      over renderer/pce-bg.js (sat.bin is all off, so the sprite layer
 *      draws nothing), pixel for pixel at the 3-bit colour.
 *
 * The check is written by the author of the toy and the export change, so
 * the cold break by another seat (rule 2) is still owed.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const sprites = require("../renderer/pce-sprites.js");

const ROOT = path.join(__dirname, "..");
const DUMP = path.join(ROOT, "tests", "dumps", "cave-style-ilvm");
const TOY = path.join(ROOT, "tests", "cave-style", "main.lua");

let passed = 0, failed = 0;
function check(ok, name, detail) {
  if (ok) { passed++; console.log("PASS  " + name); return; }
  failed++;
  console.log("FAIL  " + name + (detail ? " — " + detail : ""));
}

/* minimal PNG reader: 8-bit, non-interlaced, colour types 0/2/6 */
function decodePng(buf) {
  let pos = 8, width = 0, height = 0, colourType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.slice(pos + 4, pos + 8).toString("latin1");
    const data = buf.slice(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      colourType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  const chans = { 0: 1, 2: 3, 6: 4 }[colourType];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * chans;
  const out = Buffer.alloc(width * height * 3);
  const prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[p++];
    const line = Buffer.from(raw.slice(p, p + stride));
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= chans ? line[i - chans] : 0;
      const b = prev[i];
      const c = i >= chans ? prev[i - chans] : 0;
      if (f === 1) line[i] = (line[i] + a) & 0xFF;
      else if (f === 2) line[i] = (line[i] + b) & 0xFF;
      else if (f === 3) line[i] = (line[i] + ((a + b) >> 1)) & 0xFF;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xFF;
      }
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 3;
      if (chans === 1) out[o] = out[o + 1] = out[o + 2] = line[x];
      else { out[o] = line[x * chans]; out[o + 1] = line[x * chans + 1]; out[o + 2] = line[x * chans + 2]; }
    }
    line.copy(prev);
  }
  return { width, height, pixels: out };
}

/* Mednafen and the renderer both use 36*n per channel: map to 3 bits. */
function threeBit(v) { return Math.round(v * 7 / 255); }

function pixelDiff(a, b) {
  if (a.width !== b.width || a.height !== b.height) return Infinity;
  let n = 0;
  for (let p = 0; p < a.width * a.height; p++) {
    const o = p * 3;
    for (let k = 0; k < 3; k++) if (threeBit(a.pixels[o + k]) !== threeBit(b.pixels[o + k])) { n++; break; }
  }
  return n;
}

function renderFrame(dir, height) {
  const opts = {
    vram: fs.readFileSync(path.join(dir, "vram.bin")),
    cram: fs.readFileSync(path.join(dir, "cram.bin")),
    regs: JSON.parse(fs.readFileSync(path.join(dir, "regs.json"), "utf8")),
    width: 256, height,
    sat: fs.readFileSync(path.join(dir, "sat.bin")),
  };
  /* the crop the capture recorded: captured row 0 is VCE line 14 + slstart */
  opts.firstScanline = 14 + opts.regs.slstart;
  return sprites.renderFrame(opts);
}

function main() {
  const meta = JSON.parse(fs.readFileSync(path.join(DUMP, "meta.json"), "utf8"));
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "cave-style-"));
  const rom = path.join(tmp, "cave.pce");
  const build = spawnSync("node", [path.join(ROOT, "tools", "ilvm", "emit.js"), TOY, rom, "cave-style"], { encoding: "utf8" });
  check(build.status === 0, "the toy exports through the studio route", (build.stderr || build.stdout).slice(-300));
  if (build.status === 0) {
    const sha = crypto.createHash("sha256").update(fs.readFileSync(rom)).digest("hex");
    check(sha === meta.rom_sha256, "the captured ROM is this export (sha256 matches)",
          "build " + sha + " capture " + meta.rom_sha256);
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  const mednafen = decodePng(fs.readFileSync(path.join(DUMP, "mednafen.png")));
  const want = renderFrame(DUMP, 232);
  const img = { width: want.width, height: want.height, pixels: want.pixels };
  let lit = 0;
  for (let i = 0; i < img.pixels.length; i++) if (threeBit(img.pixels[i]) !== 0) lit++;
  check(lit > 0 && lit < img.pixels.length, "the picture is not flat (the comparison is not 0 against 0)", "lit bytes " + lit);
  const diff = pixelDiff(mednafen, img);
  check(diff === 0, "Mednafen's frame diffs 0 against renderer/pce-sprites.js over renderer/pce-bg.js",
        diff === Infinity ? "size differs" : diff + " pixels differ");

  console.log(passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}

main();
