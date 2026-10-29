#!/usr/bin/env node
/*
 * tools/city-assets.js — card #125, the CITY demo's art.
 *
 * The pack is Anokolisa's "Action Pack - CITY".  Its Autor_note.txt says:
 *
 *     all the assets here are totally free for commercial use and the like.
 *     credits are optional but appreciated.
 *
 * so a public demo is fine — but the GPL repository is not granted the raw
 * pack or anything converted from it (Dennis, 2026-10-29: "About the artwork
 * don't put it on the repo but it's fine as demo on the website in PCE
 * Studio"; docs/DECISIONS.md).  So this tool writes the converted PCE picture
 * to `/Volumes/External/agent-workshop-demo/demo-art/city/` — beside the
 * repo, never in it — and the toy (toys/city/main.lua) is committed without
 * a pixel of it.  tools/deploy.sh uploads that folder with the toy.
 *
 * WHAT IT DOES
 *   1. Social/Test_city_1.png is a 4x render of a 496x272 native scene.  The
 *      scene is downsampled to native pixels (every 4x4 block must be one
 *      colour, or the picture was rescaled with a filter and we stop).
 *   2. A 256x224 window of it — the display's own size — becomes the
 *      background, through the #123 importer (renderer/pce-source.js), the
 *      same code the studio's Add Source dialog runs.  So the BAT is 32x32
 *      cells (MWR 0, the toy host's only BAT), tiles are deduped, and every
 *      8x8 tile gets one of at most 16 palettes.
 *   3. Ten frames of the character (Legacy .../Sheets/Full-Sheet.png) are cut
 *      into 32x64 sprite patterns — the VDC's largest sprite — two side by
 *      side so the 40-pixel-wide run frames keep both arms, through the same
 *      importer as a sprite sheet.
 *   4. The two water colours are found, and the palette entries that show
 *      them are reported: they are the ones the toy cycles to animate the
 *      water (this tool refuses if a water colour is also used by a cell
 *      above the water line — then cycling it would flash the city).
 *
 *   node tools/city-assets.js --report          say what it would write, write nothing
 *   node tools/city-assets.js                   write demo-art/city/
 *   node tools/city-assets.js --check           exit 1 if demo-art/city is not this output
 *
 * WHAT IT WRITES, and how the site plays it.  The deploy is the only place the
 * repo and the art are joined (the #127/#128 shape): the playable toy is
 * `demo-art/city/main.lua` — this repository's toys/city/main.lua with a
 * generated tail that redefines the toy's pattern constants and fills
 * art_boot() with the picture's own VRAM/CRAM writes.  tools/gallery.js
 * --with-demo-art reads that file and tools/deploy.sh uploads it as the
 * gallery's CITY source, so the toy page and Browse run it with no fetch and
 * no second runtime.  The three JSON files are the same picture in the
 * studio's panel shape, for `--check` and for opening in the studio.
 *
 * The pack must be EXTRACTED first, into an empty folder of its own, and the
 * folder passed with --pack (or $PCE_CITY_PACK):
 *
 *   mkdir -p "$TMPDIR/city-pack" && unzip -q "Action Pack - CITY.zip" -d "$TMPDIR/city-pack"
 *   node tools/city-assets.js --pack "$TMPDIR/city-pack/Action Pack - CITY"
 *
 * Nothing in the pack is executed: the two PNGs are decoded and read.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const src = require("../renderer/pce-source.js");
const sat = require("../renderer/pce-sat.js");
const ed = require("../renderer/pce-editor.js");

const ROOT = path.resolve(__dirname, "..");
const DEMO_ART = process.env.PCE_DEMO_ART ||
  "/Volumes/External/agent-workshop-demo/demo-art";
const OUT_DIR = path.join(DEMO_ART, "city");
const DEFAULT_PACK = process.env.PCE_CITY_PACK || "";

/* The pack's own files (relative to the pack's root). */
const SCENE_PNG = "Social/Test_city_1.png";
const SHEET_PNG = "Legacy Action Pack - CHARACTER/Sheets/Full-Sheet.png";

/* The 4x render's native scale, and the window that becomes the screen. */
const SCENE_SCALE = 4;
const CROP = { x: 0, y: 48, w: 256, h: 224 };

/* The frames, found by their empty column gaps (frame 1 is the leftmost).
 *
 * #148 (Dennis, playing it: "the animation of the character is not running
 * correctly"): the run cycle is the author's own.  Full.gif plays sheet
 * frames 3,4,5,6,7,8,9,10 in that order, and run.aseprite holds the same
 * eight at 100 ms each, so the run is those eight at a steady rate and
 * nothing else — the old build's frames 1..8 put the idle stand and the
 * wind-up (frames 1 and 2) in the middle of the stride.  Frame 1 (the wide
 * planted stand) is the idle; 35 is the crouched aim the rifle fires from,
 * shown only while the fire key is held.  The leap needs no frame of its
 * own: run frame 7's stride reads as one, and the toy draws it from the run
 * cycle's own patterns (1024 words saved). */
const RUN_FRAMES = [3, 4, 5, 6, 7, 8, 9, 10];
const IDLE_FRAME = 1;
const JUMP_FRAME = 7;        /* not a pattern of its own — see above */
const SHOOT_FRAME = 35;

/* The bottom band of the scene is water; these are its two colours in the
 * pack (8-bit RGB, read from the scene's own pixels).  A colour may be
 * listed here only if the picture uses it nowhere above WATER_ROW. */
const WATER_RGB = [[30, 74, 157], [105, 158, 252], [190, 214, 253]];
const WATER_ROW = 200;      /* display row: the water surface and below */

/* The character's feet sit on the water surface, which spans the whole
 * window (the ledge at row 176 only spans a third of it). */
const GROUND_Y = 208;

/* ---- small image helpers ------------------------------------------------ */

function refuse(code, message) {
  const e = new Error(message);
  e.cite = code;
  throw e;
}

function readPng(file) {
  if (!fs.existsSync(file))
    refuse("pack-missing", "no " + file + " — extract the pack and pass its " +
           "folder with --pack (see this file's header)");
  return src.decodePng(new Uint8Array(fs.readFileSync(file)), zlib.inflateSync);
}

function pixel(img, x, y) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return null;
  const o = (y * img.width + x) * 4;
  return [img.rgba[o], img.rgba[o + 1], img.rgba[o + 2], img.rgba[o + 3]];
}

/* Downsample by an integer factor, refusing a picture that was rescaled with
 * a filter: every source block must be one colour, or the "native" pixels
 * are a guess. */
function downsample(img, factor) {
  if (img.width % factor || img.height % factor)
    refuse("scale", "the scene is " + img.width + "x" + img.height + ", not a " +
           "multiple of " + factor);
  const w = img.width / factor, h = img.height / factor;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = pixel(img, x * factor, y * factor);
    for (let dy = 0; dy < factor; dy++) for (let dx = 0; dx < factor; dx++) {
      const b = pixel(img, x * factor + dx, y * factor + dy);
      if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2] || a[3] !== b[3])
        refuse("scale", "the scene is not a clean " + factor + "x render: the " +
               "block at " + (x * factor) + "," + (y * factor) + " is not one " +
               "colour, so its native pixels would be a guess");
    }
    const o = (y * w + x) * 4;
    rgba[o] = a[0]; rgba[o + 1] = a[1]; rgba[o + 2] = a[2]; rgba[o + 3] = a[3];
  }
  return { width: w, height: h, rgba };
}

function crop(img, box) {
  const rgba = new Uint8Array(box.w * box.h * 4);
  for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) {
    const p = pixel(img, box.x + x, box.y + y) || [0, 0, 0, 0];
    const o = (y * box.w + x) * 4;
    rgba[o] = p[0]; rgba[o + 1] = p[1]; rgba[o + 2] = p[2]; rgba[o + 3] = p[3];
  }
  return { width: box.w, height: box.h, rgba };
}

/* ---- the character sheet ------------------------------------------------ */

/* Every frame's box, from the sheet's empty columns: a pack sheet separates
 * frames with transparent columns.  Returns boxes in left-to-right order, so
 * frame 1 is boxes[0]. */
function frameBoxes(img) {
  const op = (x, y) => pixel(img, x, y)[3] > 0;
  const runs = [];
  let start = -1;
  for (let x = 0; x < img.width; x++) {
    let any = false;
    for (let y = 0; y < img.height; y++) if (op(x, y)) { any = true; break; }
    if (any) { if (start < 0) start = x; }
    else if (start >= 0) { runs.push([start, x - 1]); start = -1; }
  }
  if (start >= 0) runs.push([start, img.width - 1]);
  return runs.map(([x0, x1]) => {
    let top = img.height, bottom = -1;
    for (let y = 0; y < img.height; y++) {
      let any = false;
      for (let x = x0; x <= x1; x++) if (op(x, y)) { any = true; break; }
      if (any) { if (y < top) top = y; if (y > bottom) bottom = y; }
    }
    return { x: x0, y: top, w: x1 - x0 + 1, h: bottom - top + 1 };
  });
}

/* The frames as one sprite sheet: each 64x64 cell holds one frame, centred
 * and standing on the cell's bottom row.  importSprites slices it at
 * 32x64 and gets two patterns a frame — left half, right half. */
function spriteSheet(sheet, boxes, picks) {
  const cell = 64, rows = 1, cols = picks.length;
  const rgba = new Uint8Array(cols * cell * cell * 4);
  const placed = [];
  picks.forEach((frameNo, i) => {
    const b = boxes[frameNo - 1];
    if (!b) refuse("frame-missing", "the sheet has no frame " + frameNo +
                   " (it has " + boxes.length + ")");
    if (b.w > cell || b.h > cell)
      refuse("frame-size", "frame " + frameNo + " is " + b.w + "x" + b.h +
             ", larger than the " + cell + "x" + cell + " cell");
    const ox = i * cell + Math.floor((cell - b.w) / 2);
    /* Feet on the cell's bottom row: every frame shares one ground line, so
     * the toy draws all of them at one y. */
    const oy = cell - b.h;
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
      const p = pixel(sheet, b.x + x, b.y + y);
      if (!p || p[3] < 128) continue;
      const d = ((oy + y) * (cols * cell) + ox + x) * 4;
      rgba[d] = p[0]; rgba[d + 1] = p[1]; rgba[d + 2] = p[2]; rgba[d + 3] = 255;
    }
    placed.push({ frame: frameNo, box: b, cellX: i, ox, oy });
  });
  return { image: { width: cols * cell, height: cell, rgba }, placed, cell, rows, cols };
}

/* ---- the picture -------------------------------------------------------- */

function build(pack) {
  const scene4 = readPng(path.join(pack, SCENE_PNG));
  const scene = downsample(scene4, SCENE_SCALE);
  const window = crop(scene, CROP);

  const bg = src.importImage(window, { kind: "bg", dither: "none",
                                       name: "city-background" });

  const sheet = readPng(path.join(pack, SHEET_PNG));
  const boxes = frameBoxes(sheet);
  /* two patterns a frame, in this order: the run's eight, the idle stand,
   * then the aim — the tracer is added after them */
  const picks = RUN_FRAMES.concat([IDLE_FRAME, SHOOT_FRAME]);
  const cut = spriteSheet(sheet, boxes, picks);
  const spr = src.importImage(cut.image, { kind: "sprites", size: [32, 64],
                                           dither: "none", name: "city-run" });
  if (spr.patterns.length !== picks.length * 2)
    refuse("patterns", picks.length + " frames of 64 px should be " +
           (picks.length * 2) + " 32x64 patterns, got " + spr.patterns.length);

  /* The tracer: our own eight pixels, not the pack's, in one of the pack's
   * own sprite-palette colours (the brightest warm entry), so it reads as a
   * shot and needs no new palette. */
  const bulletImage = makeBullet();
  const bullet = src.importImage(bulletImage, { kind: "sprites", size: [16, 16],
                                                dither: "none", name: "city-shot" });

  /* One palettes.json: the background rows from the BG import, the sprite
   * rows from the sprite import (each import pads the other half empty). */
  const paletteRows = (rows) => {
    const out = [];
    for (let i = 0; i < 16; i++) out.push(rows[i] ? rows[i].slice() : new Array(16).fill(0));
    return out;
  };
  const palettes = {
    version: 1,
    backdrop: bg.backdrop,
    background: paletteRows(bg.palettes),
    sprites: paletteRows(spr.palettes)
  };

  const patterns = spr.patterns.concat(bullet.patterns);
  const files = {
    "tiles.json": bg.files["tiles.json"],
    "palettes.json": JSON.stringify(palettes, null, 2) + "\n",
    "sprites.json": JSON.stringify({ version: 1, patterns: patterns,
                                     sprites: [] }, null, 2) + "\n"
  };

  /* The panel files, read back through the model the toy host uses, so the
   * pattern codes below are the ones the toy will really draw. */
  const list = Object.keys(files).map((name) => ({ name: name, source: files[name] }));
  const pic = sat.pictureFromFiles(list);
  const layout = ed.patternLayout(pic);
  const codes = layout.codes;

  /* Water: the palette entries that show a water colour, and the row range
   * every cell that uses one of them occupies.  A colour used above
   * WATER_ROW is refused — cycling it would flash the city with the water. */
  const water = [];
  for (const rgb of WATER_RGB) {
    const word = vceWord(rgb);
    const where = [];
    const rows = [];
    for (let p = 0; p < 16; p++)
      for (let e = 1; e < 16; e++)
        if (palettes.background[p][e] === word)
          where.push({ palette: p, entry: e, addr: p * 16 + e });
    const map = JSON.parse(files["tiles.json"]).map;
    const tileByChar = {};
    for (const t of bg.tiles) tileByChar[t.char] = t;
    for (let cell = 0; cell < 32 * 32; cell++) {
      const tile = tileByChar[map.cells[cell]] || tileByChar[src.FIRST_CHAR];
      if (!tile || !tile.pixels) continue;
      const row = palettes.background[tile.palette];
      for (const v of tile.pixels) {
        if (v && row && row[v] === word) { rows.push(Math.floor(cell / 32) * 8); break; }
      }
    }
    const top = rows.length ? Math.min.apply(null, rows) : -1;
    if (where.length && top !== -1 && top < WATER_ROW)
      refuse("water-colour", "RGB " + rgb.join(",") + " is also used at row " +
             top + ", above the water line " + WATER_ROW + "; cycling it " +
             "would flash the city. Pick another water colour.");
    water.push({ rgb, word, top, entries: where });
  }

  /* The budget the validator and the SPRITES panel care about. */
  const tiles = bg.tiles.length;
  const tileWords = (src.FIRST_CHAR + tiles) * 16;
  const patternWords = codes.reduce((n, c, i) => {
    const p = patterns[i];
    const size = ed.SPRITE_SIZES.find((s) => s.width === p.width && s.height === p.height);
    return n + size.cells * 64;
  }, 0);

  const result = {
    pack, scene, window, bg, spr, bullet, palettes, patterns, files,
    pic, layout, codes, water, cut, picks,
    stats: {
      scene: scene.width + "x" + scene.height,
      window: CROP.w + "x" + CROP.h,
      frames: picks,
      patterns: patterns.length,
      tiles: tiles,
      palettes: bg.palettes.length,
      spritePalettes: spr.palettes.length,
      colours: bg.stats.colours,
      maxTileColours: bg.stats.maxTileColours,
      tileWords, patternWords, vramWords: tileWords + patternWords
    }
  };
  result.playable = playableToy(result);
  return result;
}

/* A 16x16 tracer, colour 1 of its own (the spr import maps it to the nearest
 * sprite-palette entry, which this file makes sure is a warm one). */
function makeBullet() {
  const w = 16, h = 16;
  const rgba = new Uint8Array(w * h * 4);
  const put = (x, y, rgb) => {
    const o = (y * w + x) * 4;
    rgba[o] = rgb[0]; rgba[o + 1] = rgb[1]; rgba[o + 2] = rgb[2]; rgba[o + 3] = 255;
  };
  const hot = [255, 244, 160], warm = [250, 180, 40];
  for (let i = 0; i < 6; i++) put(4 + i, 8, warm);
  put(10, 8, hot); put(11, 8, hot);
  put(4, 7, warm); put(4, 9, warm);
  return { width: w, height: h, rgba };
}

/* The VCE word for an 8-bit RGB, the importer's own arithmetic (3 bits a
 * channel, G in the high bits): renderer/pce-source.js's vce(). */
function vceWord(rgb) {
  const q = (v) => Math.round(v / 255 * 7);
  return (q(rgb[1]) << 6) | (q(rgb[0]) << 3) | q(rgb[2]);
}

/* ---- the playable file: the repo's toy plus the picture ------------------ */

const REPO_TOY = path.join(__dirname, "..", "toys", "city", "main.lua");
const TAIL_MARK = "PCEStudio demo art for toys/city";

/* The generated tail.  It comes AFTER the repo file in the same Lua chunk, so
 * its assignments and its art_boot() replace the stub's before init() runs —
 * the same shape tools/cave-assets.js writes for #127.  Only NON-ZERO words
 * are written: the VDC's VRAM powers on clear, and a line per zero would
 * triple the file for nothing. */
function playableToy(r) {
  const template = fs.readFileSync(REPO_TOY, "utf8");
  const c = constants(r);
  const pic = r.pic;
  const data = ed.toPicture(pic);
  const vram = data.vram, cram = data.cram;   /* both Uint8Array, LE words */
  const word = (buf, i) => buf[i * 2] | (buf[i * 2 + 1] << 8);
  const hex = (v) => "0x" + v.toString(16).toUpperCase().padStart(3, "0");

  const lines = [];
  lines.push("");
  lines.push("-- >>> " + TAIL_MARK + " — generated by tools/city-assets.js; do not edit.");
  lines.push("-- The picture is \"Action Pack - CITY\" by Anokolisa " +
             "(https://www.patreon.com/Anokolisa),");
  lines.push('-- used under its Autor_note.txt: "all the assets here are totally');
  lines.push('-- free for commercial use and the like. credits are optional but');
  lines.push('-- appreciated."');
  lines.push("-- This file is NOT in the repo (Dennis, 2026-10-29; docs/DECISIONS.md):");
  lines.push("-- tools/deploy.sh uploads it with the toy, and tools/gallery.js --with-demo-art");
  lines.push("-- reads it.  A clone runs toys/city/main.lua, whose art_boot() draws nothing.");
  lines.push("-- " + r.stats.tiles + " tiles from 0x40, " + r.stats.palettes +
             " background palettes, " + r.stats.patterns + " sprite patterns, " +
             r.stats.vramWords + " VRAM words.");
  lines.push("");
  lines.push("RUN_L = {" + c.run.map((p) => p[0]).join(", ") + "}");
  lines.push("RUN_R = {" + c.run.map((p) => p[1]).join(", ") + "}");
  lines.push("IDLE_L = " + c.idle[0]);
  lines.push("IDLE_R = " + c.idle[1]);
  lines.push("JUMP_L = " + c.jump[0]);
  lines.push("JUMP_R = " + c.jump[1]);
  lines.push("SHOOT_L = " + c.shoot[0]);
  lines.push("SHOOT_R = " + c.shoot[1]);
  lines.push("BULLET = " + c.bullet);
  lines.push("WATER_A = " + c.water[0][0]);
  lines.push("WATER_B = " + c.water[1][0]);
  lines.push("WATER_C = " + c.water[2][0]);
  lines.push("WATER_1 = " + c.waterWords[0]);
  lines.push("WATER_2 = " + c.waterWords[1]);
  lines.push("WATER_3 = " + c.waterWords[2]);
  lines.push("WATER_WORD = {WATER_1, WATER_2, WATER_3}");
  lines.push("");
  lines.push("function art_boot()");
  /* the VCE: the backdrop, then every palette word the picture uses */
  const cramPairs = [];
  for (let i = 0; i < 512; i++) {
    const w = word(cram, i);
    if (w || i === 0) cramPairs.push("  pal(" + hex(i) + ", " + hex(w) + ")");
  }
  lines.push("  -- the VCE: " + cramPairs.length + " words, background and sprite palettes");
  lines.push.apply(lines, cramPairs);
  /* the BAT: run-length on equal cells, the way demo-game-assets writes it */
  const bat = [];
  for (let i = 0; i < 32 * 32; i++) bat.push(word(vram, i));
  let runStart = 0;
  for (let i = 1; i <= bat.length; i++) {
    if (i === bat.length || bat[i] !== bat[runStart]) {
      const v = hex(bat[runStart]);
      if (v !== "0x000") {
        if (i - runStart === 1) lines.push("  vram[" + runStart + "] = " + v);
        else lines.push("  for i = " + runStart + ", " + (i - 1) +
                        " do vram[i] = " + v + " end");
      }
      runStart = i;
    }
  }
  /* the tiles and the patterns: one line per non-zero word */
  let tileLines = 0, patternLines = 0;
  const firstPatternWord = (c.run[0][0]) * 64;
  for (let i = 32 * 32; i < 32768; i++) {
    const w = word(vram, i);
    if (!w) continue;
    lines.push("  vram[" + i + "] = " + hex(w));
    if (i < firstPatternWord) tileLines++; else patternLines++;
  }
  lines.push("end");
  lines.push("-- <<< " + TAIL_MARK + " — end of the generated block");
  lines.push("");
  return { text: template.replace(/\s*$/, "\n") + lines.join("\n"),
           tileLines: tileLines, patternLines: patternLines,
           cramLines: cramPairs.length };
}

/* ---- what main.lua must hold -------------------------------------------- */

function constants(r) {
  const code = (frameNo) => {
    const i = r.picks.indexOf(frameNo) * 2;
    return [r.codes[i], r.codes[i + 1]];
  };
  const run = RUN_FRAMES.map(code);
  return {
    run,
    idle: code(IDLE_FRAME),
    jump: run[RUN_FRAMES.indexOf(JUMP_FRAME)],
    shoot: code(SHOOT_FRAME),
    bullet: r.codes[r.codes.length - 1],
    water: r.water.map((w) => w.entries.map((e) => e.addr)),
    waterWords: r.water.map((w) => w.word),
    groundY: GROUND_Y,
    tiles: r.stats.tiles,
    vramWords: r.stats.vramWords
  };
}

function report(r) {
  const c = constants(r);
  const s = r.stats;
  return [
    "CITY — converted picture (card #125)",
    "",
    "  scene         " + s.scene + " native (from a " + SCENE_SCALE + "x render)",
    "  window        " + s.window + " at " + CROP.x + "," + CROP.y,
    "  tiles         " + s.tiles + " (VRAM words " + s.tileWords + ")",
    "  palettes      " + s.palettes + " background rows, " + s.spritePalettes + " sprite rows",
    "  colours       " + s.colours + " background, at most " + s.maxTileColours + " in a tile",
    "  sprite frames " + s.frames.length + " -> " + s.patterns + " patterns (" +
      s.patternWords + " words)",
    "  VRAM total    " + s.vramWords + " of 32768 words",
    "",
    "  run patterns  " + JSON.stringify(c.run),
    "  idle          " + JSON.stringify(c.idle),
    "  jump          " + JSON.stringify(c.jump),
    "  shoot         " + JSON.stringify(c.shoot),
    "  bullet        " + c.bullet,
    "  water words   " + JSON.stringify(c.waterWords),
    "  water CRAM    " + JSON.stringify(c.water),
    "  ground row    " + c.groundY,
    "  playable      demo-art/city/main.lua, " +
      Math.round(r.playable.text.length / 1024) + " KB (" +
      (r.playable.cramLines + r.playable.tileLines + r.playable.patternLines) +
      " VRAM/CRAM writes)",
    ""
  ].join("\n");
}

/* ---- main --------------------------------------------------------------- */

function main(argv) {
  const args = argv.slice(2);
  let mode = "write", pack = DEFAULT_PACK;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--check") mode = "check";
    else if (args[i] === "--report") mode = "report";
    else if (args[i] === "--pack") pack = args[++i] || "";
    else if (args[i] === "--out") { /* PCE_DEMO_ART is the documented switch */ }
    else if (args[i] === "--help" || args[i] === "-h") {
      process.stdout.write("usage: node tools/city-assets.js [--pack DIR] " +
                           "[--report | --check]\n");
      return 0;
    } else {
      process.stderr.write("unknown argument: " + args[i] + "\n");
      return 2;
    }
  }
  if (!pack) {
    process.stderr.write("city-assets: no pack. Extract 'Action Pack - CITY.zip' " +
                         "into an empty folder and pass it:\n  node tools/city-assets.js " +
                         "--pack \"$TMPDIR/city-pack/Action Pack - CITY\"\n");
    return 2;
  }

  let r;
  try { r = build(pack); }
  catch (e) {
    process.stderr.write("city-assets: " + (e.cite ? e.cite + ": " : "") +
                         e.message + "\n");
    return 1;
  }

  if (mode === "report") { process.stdout.write(report(r)); return 0; }

  if (mode === "check") {
    let bad = 0;
    const want = Object.assign({ "main.lua": r.playable.text }, r.files);
    for (const name of Object.keys(want)) {
      const file = path.join(OUT_DIR, name);
      const have = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
      if (have !== want[name]) {
        process.stderr.write("demo-art/city/" + name + " is not this tool's " +
                             "output — run it without --check\n");
        bad++;
      }
    }
    if (bad) return 1;
    process.stdout.write("demo-art/city is the pack's converted picture (" +
                         r.stats.tiles + " tiles, " + r.stats.patterns +
                         " patterns, " + r.stats.vramWords + " VRAM words) " +
                         "and its playable main.lua\n");
    return 0;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const name of Object.keys(r.files))
    fs.writeFileSync(path.join(OUT_DIR, name), r.files[name]);
  fs.writeFileSync(path.join(OUT_DIR, "main.lua"), r.playable.text);
  fs.writeFileSync(path.join(OUT_DIR, "MANIFEST.md"), manifest(r));
  process.stdout.write(report(r));
  process.stdout.write("wrote " + OUT_DIR + "\n");
  return 0;
}

function manifest(r) {
  const c = constants(r);
  return "# CITY — demo art (card #125)\n\n" +
    "This folder is NOT part of the PCEStudio repository. Dennis, 2026-10-29:\n" +
    "\"About the artwork don't put it on the repo but it's fine as demo on the\n" +
    "website in PCE Studio\" (`docs/DECISIONS.md`). It is uploaded with the toy\n" +
    "by `tools/deploy.sh`, and any test that needs it skips when it is absent.\n\n" +
    "## Where it came from\n\n" +
    "* Pack: **Action Pack - CITY** by **Anokolisa** (https://www.patreon.com/Anokolisa).\n" +
    "* `Social/Test_city_1.png` — the pack's own composed scene, a " + SCENE_SCALE +
      "x render of a " + r.stats.scene + " picture. Its " + CROP.w + "x" + CROP.h +
      " window at " + CROP.x + "," + CROP.y + " is the background.\n" +
    "* `Legacy Action Pack - CHARACTER/Sheets/Full-Sheet.png` — frames " +
      r.picks.join(", ") + ", two 32x64 sprite patterns each (left and right half). " +
      "The run cycle is the author's own: Full.gif plays frames 3..10 in that " +
      "order and run.aseprite holds the same eight at 100 ms, so the toy runs " +
      "them at one every four frames; frame 1 is the idle stand and 35 the aim " +
      "(shown only while the fire key is held).\n\n" +
    "The pack's `Autor_note.txt`, quoted in full for the first three lines:\n\n" +
    "> all the assets here are totally free for commercial use and the like.\n" +
    ">\n" +
    "> credits are optional but appreciated.\n" +
    ">\n" +
    "> the patreon: https://www.patreon.com/Anokolisa\n\n" +
    "## What is here\n\n" +
    "| file | what it is |\n|---|---|\n" +
    "| `tiles.json` | the background: " + r.stats.tiles + " deduped 8x8 tiles and the 32x32 BAT |\n" +
    "| `palettes.json` | the VCE words: backdrop, 16 background rows, 16 sprite rows |\n" +
    "| `sprites.json` | " + r.stats.patterns + " sprite patterns (32x64 the character, 16x16 the tracer) |\n" +
    "| `main.lua` | the PLAYABLE toy: toys/city/main.lua plus the generated art block (tools/gallery.js --with-demo-art reads this one) |\n" +
    "| `MANIFEST.md` | this file |\n\n" +
    "## How it was made\n\n" +
    "`node tools/city-assets.js --pack \"<the extracted pack>\"` — the #123\n" +
    "importer (`renderer/pce-source.js`) does the conversion, the same code the\n" +
    "studio's Add Source dialog runs. Regenerate with it; `--check` says whether\n" +
    "these files are its output.\n\n" +
    "## The numbers the toy uses\n\n" +
    "```\nrun patterns  " + JSON.stringify(c.run) + "\nidle          " +
    JSON.stringify(c.idle) + "\njump          " + JSON.stringify(c.jump) +
    "\nshoot         " + JSON.stringify(c.shoot) +
    "\nbullet        " + c.bullet + "\nwater words   " + JSON.stringify(c.waterWords) +
    "\nwater CRAM    " + JSON.stringify(c.water) + "\nground row    " + c.groundY +
    "\ntiles         " + c.tiles + "\nVRAM words    " + c.vramWords + " of 32768\n```\n";
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { build, report, constants, OUT_DIR };
