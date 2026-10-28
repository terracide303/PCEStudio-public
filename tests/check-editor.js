#!/usr/bin/env node
/*
 * tests/check-editor.js — card #10's closing measurement.
 *
 * NOTE: written by @design because the card's close condition needs a diff
 * script; per the workshop role split this is flagged for @review to read
 * cold (same arrangement as tests/check.js, check-viewer.js, check-export.js).
 *
 * What it measures:
 *  1. The refusals.  Every call that would store something the VDC cannot
 *     show throws with its documented code: a 17th colour in a tile (pixel
 *     number 16), a 17th palette, a 17th colour in a palette, a colour the
 *     tile's own palette does not hold, a character past the 32768-word
 *     VRAM, and the range guards.
 *  2. A 256x224 picture painted from scratch.  renderer/pce-editor.js's
 *     demoPicture() paints it through the editor's own calls (nothing is
 *     loaded from tests/dumps/); the result is checked by the editor's own
 *     validate(), and its pixels are recomputed from the editor model and
 *     compared with renderer/pce-bg.js drawing the picture through
 *     toPicture() — the model that #5 matched to Mednafen pixel for pixel.
 *  3. The export.  renderer/pce-rom.js (#9) turns the picture into a .pce;
 *     the bytes in bank 1 (config + palettes), banks 2-3 (the BAT) and
 *     bank 4+ (the tiles) must be the editor's data at the documented
 *     places.  With --write the ROM is written to tools/gen/painted.pce for
 *     tools/capture.sh painted.
 *  4. The console check, when tests/dumps/painted/ exists (the capture of
 *     that ROM from Mednafen): the captured VRAM/CRAM/regs must be exactly
 *     what the editor wrote, and Mednafen's recorded frame must equal
 *     pce-bg.js drawing the EDITOR's picture with the capture's own
 *     calibration — so "what I painted" is what the console showed, not
 *     just what the dump round-trips to.
 *  5. The browser-global branch (a vm context with `self`, no `module`) does
 *     the same refusals and produces the same bytes, so the page's code
 *     path is exercised rather than assumed.
 *
 *   node tests/check-editor.js            # check
 *   node tests/check-editor.js --write    # also write tools/gen/painted.pce
 *
 * Exit 0 only if everything above holds; 2 if the Mednafen capture is
 * missing (run tools/capture.sh painted).
 *
 * What this does NOT prove: that the page's mouse handlers paint what a
 * person expects (they call the same functions the check does, but the
 * page's event wiring is read, not executed), that the download wiring runs,
 * or that the picture is one someone wanted.
 */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const zlib = require("zlib");
const ed = require("../renderer/pce-editor.js");
const bg = require("../renderer/pce-bg.js");
const rom = require("../renderer/pce-rom.js");

const HERE = __dirname;
const GEN = path.join(HERE, "..", "tools", "gen");
const BANK0 = path.join(HERE, "..", "renderer", "viewer-bank0.bin");
const CAPTURE = path.join(HERE, "dumps", "painted");
const EDITOR_SRC = fs.readFileSync(
  path.join(HERE, "..", "renderer", "pce-editor.js"), "utf8");

/* ---- minimal PNG reader (same as tests/check.js) ----------------------- */
function decodePng(buf) {
  if (buf.slice(0, 8).toString("latin1") !== "\x89PNG\r\n\x1a\n")
    throw new Error("not a PNG");
  let pos = 8, width = 0, height = 0, bitDepth = 0, colourType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.slice(pos + 4, pos + 8).toString("latin1");
    const data = buf.slice(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colourType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
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
      if (chans === 1) out[o] = out[o + 1] = out[o + 2] = line[x];
      else {
        out[o] = line[x * chans];
        out[o + 1] = line[x * chans + 1];
        out[o + 2] = line[x * chans + 2];
      }
    }
    line.copy(prev);
  }
  return { width, height, pixels: out };
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/* ---- the picture the editor model says it painted ---------------------- */
/* Recomputed from the editor's own data (map -> tile -> colour number ->
 * palette entry -> 9-bit colour -> RGB), independently of toPicture()'s VRAM
 * encoding, so 2 below compares two paths rather than one path with itself. */
function modelFrame(pic) {
  const W = ed.VIEW_W, H = ed.VIEW_H;
  const px = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const char = ed.mapCell(pic, x >> 3, y >> 3);
      const tile = pic.tiles[char];
      const v = tile.pixels[(y & 7) * 8 + (x & 7)];
      const colour = v === 0 ? pic.backdrop : pic.palettes[tile.palette][v];
      const o = (y * W + x) * 3;
      px[o] = 36 * ((colour >> 3) & 7);
      px[o + 1] = 36 * ((colour >> 6) & 7);
      px[o + 2] = 36 * (colour & 7);
    }
  }
  return { width: W, height: H, pixels: px };
}

function diffPixels(got, ref, label) {
  if (got.width !== ref.width || got.height !== ref.height)
    return `${label}: SIZE ${got.width}x${got.height} vs ${ref.width}x${ref.height}`;
  let diffs = 0, first = -1;
  for (let i = 0; i < got.pixels.length; i++) {
    if (got.pixels[i] !== ref.pixels[i]) {
      diffs++;
      if (first < 0) first = i;
    }
  }
  if (diffs === 0) return null;
  return `${label}: ${diffs} differing bytes of ${got.pixels.length}; first ` +
         `at pixel ${(first / 3) | 0}`;
}

/* ---- 1. the refusals --------------------------------------------------- */
function refusal(editor, fn, code, label) {
  try {
    fn(editor);
  } catch (e) {
    if (e.code !== code)
      return `${label}: refused with code "${e.code}", expected "${code}" ` +
             `(${e.message})`;
    return null;
  }
  return `${label}: accepted — it must be refused`;
}

function checkRefusals(editor) {
  const pic = editor.newPicture();
  editor.setPaletteColour(pic, 0, 1, editor.colourWord(7, 0, 0));
  const blank = editor.FIRST_CHAR;
  const tile = editor.newTile(pic, 0);
  const cases = [
    ["17th colour in a tile (pixel number 16)",
     (e) => e.paintTileIndex(pic, tile, 0, 0, 16), "17th-colour"],
    ["pixel number 255",
     (e) => e.paintTileIndex(pic, tile, 0, 0, 255), "17th-colour"],
    ["pixel number -1",
     (e) => e.paintTileIndex(pic, tile, 0, 0, -1), "colour-index"],
    ["17th palette (setPaletteColour)",
     (e) => e.setPaletteColour(pic, 16, 1, 0), "17th-palette"],
    ["17th palette (newTile)",
     (e) => e.newTile(pic, 16), "17th-palette"],
    ["17th palette (setTilePalette)",
     (e) => e.setTilePalette(pic, tile, 16), "17th-palette"],
    ["17th colour in a palette (entry 16)",
     (e) => e.setPaletteColour(pic, 0, 16, 0), "17th-colour"],
    ["VCE colour 512",
     (e) => e.setPaletteColour(pic, 0, 1, 512), "colour-range"],
    ["a colour the tile's palette does not hold",
     (e) => e.paintTileColour(pic, tile, 0, 0, e.colourWord(0, 7, 0)),
     "not-in-palette"],
    ["a map column past the 32x32 BAT",
     (e) => e.paintMapCell(pic, 32, 0, blank), "map-range"],
    ["a character past the 32768-word VRAM",
     (e) => e.paintMapCell(pic, 0, 0, 0x800), "vram-range"],
    ["a character with no tile",
     (e) => e.paintMapCell(pic, 0, 0, 0x7FF), "no-tile"]
  ];
  const problems = [];
  for (const [label, fn, code] of cases) {
    const p = refusal(editor, fn, code, label);
    if (p) problems.push(p);
  }
  /* a legal paint must still work */
  try {
    editor.paintTileIndex(pic, tile, 0, 0, 15);
    editor.paintTileColour(pic, tile, 1, 0, editor.colourWord(7, 0, 0));
    editor.paintMapCell(pic, 0, 0, tile);
  } catch (e) {
    problems.push(`a legal paint was refused: ${e.message}`);
  }
  return { problems, count: cases.length };
}

/* ---- 2. a picture painted from scratch -------------------------------- */
function checkPicture(pic) {
  const problems = [];
  const st = ed.stats(pic);
  const invalid = ed.validate(pic);
  if (invalid.length) problems.push(...invalid.map((s) => `validate: ${s}`));
  if (st.tiles > ed.MAX_TILES)
    problems.push(`${st.tiles} tiles, the layout gives ${ed.MAX_TILES}`);
  if (st.palettesUsed > ed.PALETTES)
    problems.push(`${st.palettesUsed} palettes, the VDC has ${ed.PALETTES}`);
  for (let c = ed.FIRST_CHAR; c < pic.nextChar; c++) {
    const n = ed.coloursInTile(pic, c).length;
    if (n > ed.ENTRIES)
      problems.push(`tile $${c.toString(16)} shows ${n} colours`);
  }

  /* the visible 28x32 cells are painted; the invisible rows are the blank */
  let painted = 0;
  for (let my = 0; my < 28; my++)
    for (let mx = 0; mx < ed.BAT_W; mx++) {
      const c = ed.mapCell(pic, mx, my);
      if (c !== ed.FIRST_CHAR) painted++;
    }
  if (painted === 0)
    problems.push("the demo painted no map cells");

  /* two independent paths to the same 256x224 frame */
  const data = ed.toPicture(pic);
  if (data.vram.length !== 65536)
    problems.push(`vram ${data.vram.length} bytes, expected 65536`);
  if (data.cram.length !== 1024)
    problems.push(`cram ${data.cram.length} bytes, expected 1024`);
  const drawn = bg.renderFrame({
    vram: data.vram, cram: data.cram, regs: ed.viewRegs(pic),
    width: ed.VIEW_W, height: ed.VIEW_H
  });
  const expected = modelFrame(pic);
  const p = diffPixels(drawn, expected, "model vs renderer");
  if (p) problems.push(p);

  return { problems, st, painted, data, drawn };
}

/* ---- 3. the export ----------------------------------------------------- */
function checkExport(data, romBytes, bank0) {
  const problems = [];
  const BANK = 8192;
  const batBytes = rom.batWords(data.regs.MWR) * 2;

  /* bank 1: config block, the 512 colour-table entries at 0x40 and the
   * SAT at 0x440 (card #14) */
  const cfg = romBytes.subarray(BANK, BANK + 64);
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  if (cfg[0] !== 1) problems.push("config version is not 1");
  if (u16(cfg, 2) !== data.regs.BXR) problems.push("config BXR differs");
  if (u16(cfg, 4) !== data.regs.BYR) problems.push("config BYR differs");
  if (cfg[6] !== data.regs.MWR) problems.push("config MWR differs");
  if (cfg[7] !== data.regs.CR) problems.push("config CR differs");
  if (cfg[8] !== data.regions.length) problems.push("config region count differs");
  if (u16(cfg, 0x0A) !== data.regions[0][0] * 16)
    problems.push("region destination differs");
  if (u16(cfg, 0x0C) !== data.regions[0][1] * 16)
    problems.push("region word count differs");
  const paletteAt = BANK + 0x40;
  if (!Buffer.from(romBytes.subarray(paletteAt, paletteAt + 1024))
        .equals(Buffer.from(data.cram.subarray(0, 1024))))
    problems.push("the ROM's palettes are not the editor's CRAM");
  const satAt = BANK + 0x440;
  if (!Buffer.from(romBytes.subarray(satAt, satAt + 512))
        .equals(Buffer.from(data.vram.subarray(0xFE00, 0xFE00 + 512))))
    problems.push("the ROM's SAT is not the editor's VRAM words $7f00..");

  /* banks 2-3: the BAT */
  const batAt = 2 * BANK;
  if (!Buffer.from(romBytes.subarray(batAt, batAt + batBytes))
        .equals(Buffer.from(data.vram.subarray(0, batBytes))))
    problems.push("the ROM's BAT is not the editor's VRAM words 0..1023");

  /* bank 4+: the tiles */
  const tilesAt = 4 * BANK;
  const tileBytes = data.regions[0][1] * 32;
  const vramTilesAt = data.regions[0][0] * 16 * 2;
  if (!Buffer.from(romBytes.subarray(tilesAt, tilesAt + tileBytes))
        .equals(Buffer.from(data.vram.subarray(vramTilesAt,
                                                vramTilesAt + tileBytes))))
    problems.push("the ROM's tiles are not the editor's VRAM tile region");

  /* the whole image is 4 + ceil(tiles / 8 KiB) banks, as ROM_LAYOUT.md */
  const banks = 4 + Math.max(1, Math.ceil(tileBytes / BANK));
  if (romBytes.length !== banks * BANK)
    problems.push(`${romBytes.length} bytes, the layout says ${banks * BANK}`);
  if (bank0.length !== BANK) problems.push("bank0 is not 8 KiB");
  return problems;
}

/* ---- 4. the Mednafen capture ------------------------------------------ */
function checkCapture(pic, data) {
  const problems = [];
  const vram = fs.readFileSync(path.join(CAPTURE, "vram.bin"));
  const cram = fs.readFileSync(path.join(CAPTURE, "cram.bin"));
  const regs = JSON.parse(fs.readFileSync(path.join(CAPTURE, "regs.json"), "utf8"));

  if (!vram.equals(Buffer.from(data.vram)))
    problems.push("captured VRAM is not the editor's VRAM");
  if (!cram.equals(Buffer.from(data.cram)))
    problems.push("captured CRAM is not the editor's 512 colour-table entries");
  for (const r of ["MWR", "BXR", "BYR", "CR"])
    if (regs[r] !== data.regs[r])
      problems.push(`captured ${r}=${regs[r]}, the editor wrote ${data.regs[r]}`);

  /* the frame: pce-bg.js drawing the EDITOR's picture, with the capture's
   * own scanline calibration (the capture starts one VDW line in) */
  const drawn = bg.renderFrame({ vram: data.vram, cram: data.cram, regs,
                                 width: 256, height: 232 });
  const png = decodePng(fs.readFileSync(path.join(CAPTURE, "mednafen.png")));
  const p = diffPixels(drawn, png, "capture vs editor picture");
  if (p) problems.push(p);

  /* what the capture shows of the visible picture: rows 0..222 are the
   * editor's rows 1..223 (the capture crops the first VDW line) */
  const preview = bg.renderFrame({
    vram: data.vram, cram: data.cram, regs: ed.viewRegs(pic),
    width: 256, height: 224
  });
  let shiftedDiffs = 0;
  for (let y = 0; y < 223; y++)
    for (let x = 0; x < 256; x++)
      for (let k = 0; k < 3; k++)
        if (preview.pixels[((y + 1) * 256 + x) * 3 + k] !==
            png.pixels[(y * 256 + x) * 3 + k]) shiftedDiffs++;
  if (shiftedDiffs !== 0)
    problems.push(`preview vs capture rows 1..223: ${shiftedDiffs} differing ` +
                  `bytes (the capture should be the preview one row up)`);

  return problems;
}

/* ---- 5. the browser-global branch ------------------------------------- */
function loadBrowserGlobal() {
  const sandbox = { self: null };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(EDITOR_SRC, sandbox, { filename: "pce-editor.js" });
  if (!sandbox.PCEStudio || !sandbox.PCEStudio.editor)
    throw new Error("pce-editor.js did not install PCEStudio.editor");
  return sandbox.PCEStudio.editor;
}

/* ---- main -------------------------------------------------------------- */
function main() {
  const write = process.argv.indexOf("--write") >= 0;
  let failed = 0;
  const out = (s) => console.log(s);
  const fail = (s) => { out(s); failed++; };

  /* 1. refusals */
  const ref = checkRefusals(ed);
  if (ref.problems.length) ref.problems.forEach(fail);
  else out(`refusals: ${ref.count}/${ref.count} refused with the documented ` +
           `code (17th colour in a tile, 17th palette, 17th colour in a ` +
           `palette, not in the tile's palette, past VRAM)`);

  /* 2. the picture */
  const pic = ed.demoPicture();
  const picture = checkPicture(pic);
  if (picture.problems.length) picture.problems.forEach(fail);
  else out(`picture: ${ed.VIEW_W}x${ed.VIEW_H} painted from scratch, ` +
           `${picture.painted} visible cells, ${picture.st.tiles} tiles ` +
           `($${picture.st.charsFirst.toString(16)}-` +
           `$${picture.st.charsLast.toString(16)}), ` +
           `${picture.st.palettesUsed} palettes, validate 0 problems, ` +
           `model == renderer`);

  /* 3. the export */
  const data = picture.data;
  const bank0 = new Uint8Array(fs.readFileSync(BANK0));
  const romBytes = rom.buildRom({
    bank0, vram: data.vram, cram: data.cram,
    regs: data.regs, regions: data.regions
  });
  const exportProblems = checkExport(data, romBytes, bank0);
  if (exportProblems.length) exportProblems.forEach(fail);
  else out(`export: ${romBytes.length} bytes, sha256 ${sha256(romBytes).slice(0, 16)}… ` +
           `(#9's builder) — config, palettes, BAT and tiles are the ` +
           `editor's data`);
  if (write) {
    fs.mkdirSync(GEN, { recursive: true });
    const out2 = path.join(GEN, "painted.pce");
    fs.writeFileSync(out2, romBytes);
    out(`wrote ${path.relative(HERE, out2)} (${romBytes.length} bytes) — ` +
        `run: tools/capture.sh painted`);
  }

  /* 5. the browser-global branch */
  const globalEditor = loadBrowserGlobal();
  const gref = checkRefusals(globalEditor);
  const gpic = globalEditor.demoPicture();
  const gdata = globalEditor.toPicture(gpic);
  const grom = rom.buildRom({
    bank0, vram: gdata.vram, cram: gdata.cram,
    regs: gdata.regs, regions: gdata.regions
  });
  if (gref.problems.length || !Buffer.from(grom).equals(Buffer.from(romBytes)))
    fail(`browser-global branch: ${gref.problems.join("; ") || "same refusals, " +
         "different bytes"}`);
  else out(`browser-global branch: same ${gref.count}/${gref.count} refusals, ` +
           `same ${grom.length} bytes`);

  /* 4. the capture */
  const haveCapture = fs.existsSync(path.join(CAPTURE, "mednafen.png"));
  if (!haveCapture) {
    out(`capture: not present — run tools/capture.sh painted once the ROM ` +
        `is written`);
    /* --write is the build step that comes before the capture; the check
     * without --write requires the capture */
    if (!write) failed++;
  } else {
    const problems = checkCapture(pic, data);
    if (problems.length) problems.forEach(fail);
    else out(`capture: tests/dumps/painted is the editor's VRAM/CRAM/regs ` +
             `and Mednafen's frame equals the editor's picture (diff 0)`);
  }

  out(failed === 0
    ? (haveCapture
      ? "PASS: the editor paints, refuses what the VDC cannot show, exports " +
        "#9's ROM and Mednafen shows it"
      : "PASS: the editor paints, refuses what the VDC cannot show and " +
        "exports #9's ROM — the Mednafen capture is still to be made")
    : `FAIL: ${failed} problem(s)`);
  return failed === 0 ? 0 : 1;
}

process.exitCode = main();
