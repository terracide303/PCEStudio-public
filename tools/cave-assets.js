#!/usr/bin/env node
/*
 * tools/cave-assets.js — the art bridge for toys/cave (card #127).
 *
 * THE ART RULE (docs/DECISIONS.md, 2026-10-29, Dennis): the demo art packs are
 * shown on the website and are never committed.  So this tool writes NOTHING
 * inside the repository: the converted picture — the tiles, the palettes, the
 * sprite patterns and the Lua block the toy draws them with — goes to
 * ../demo-art/cave/, beside the repo.  The toy's own Lua is committed and
 * carries a plain-wood stub, so a fresh clone still runs and its test skips.
 *
 * WHAT IT CONVERTS, AND WITH WHAT: renderer/pce-source.js, the studio's Add
 * Source importer (#123).  The scene is composed from the pack's own tiles
 * into ONE 256x224 picture and handed to importImage() as a BG; the sprites
 * are composed into one 16x16 sheet and handed to importImage() as sprites.
 * The palettes, the tile dedup and the 15-colours-per-tile rule are the
 * importer's, not a second model's — what the panels would show for the same
 * PNG is what the toy draws.
 *
 * THE PACK'S LICENCE (quoted in toys/cave/README.md): "You may not publicly
 * distribute the contents of this zip file in whole or in part, unless as
 * part of a game or application product", and "If you use this material in a
 * game or other product, please give attribution to Will Tice in the credits."
 * The demo is part of PCEStudio, the product; the credit is in the toy's
 * README, in its Browse card and in the converted block's header.
 *
 *   node tools/cave-assets.js --pack retro_pixel_cave.zip [--out DIR]
 *   node tools/cave-assets.js --check
 *
 * --pack  the zip (default $PCE_CAVE_PACK, else the download it came from).
 *         It is unzipped into a NEW EMPTY directory under $TMPDIR and removed
 *         afterwards; nothing from it is executed.
 * --out   where the converted art goes (default $PCE_CAVE_ART, else
 *         /Volumes/External/agent-workshop-demo/demo-art/cave).
 * --check exit 1 if the art on disk is not what this tool writes; exit 0 with
 *         a SKIP line when it is not there at all (a fresh clone).
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const cp = require("child_process");

const src = require("../renderer/pce-source.js");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_PACK = process.env.PCE_CAVE_PACK ||
  "/Volumes/External/Download/retro_pixel_cave.zip";
const DEFAULT_OUT = process.env.PCE_CAVE_ART ||
  "/Volumes/External/agent-workshop-demo/demo-art/cave";

const TILE = src.TILE;            /* 8 */
const BAT_W = src.BAT_W;          /* 32 */
const FIRST_CHAR = src.FIRST_CHAR;/* $40 */
const SAT = 0x7F00;
const ROWS = 28;                  /* 224 lines: the display the toy is drawn at */

/* ---- the pack ---------------------------------------------------------- */

/* Unzip into a new empty directory under $TMPDIR.  Nothing in it is run. */
function extractPack(zip) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cave127-"));
  cp.execFileSync("unzip", ["-q", zip, "-d", dir], { stdio: "inherit" });
  const root = path.join(dir, "retro_pixel_cave");
  if (!fs.existsSync(root))
    throw new Error("the pack has no retro_pixel_cave/ at its root");
  return { dir: dir, root: root };
}

function readPng(file) {
  return src.decodePng(fs.readFileSync(file), zlib.inflateSync);
}

/* The pack's own tile images, by name without .png. */
function tilesOf(root, style) {
  const dir = path.join(root, style, "PNG");
  const out = {};
  for (const name of fs.readdirSync(dir))
    if (name.endsWith(".png") && !name.startsWith("._"))
      out[name.replace(/\.png$/, "")] = readPng(path.join(dir, name));
  return out;
}

/* ---- drawing: RGBA canvases ------------------------------------------- */

function canvas(w, h) {
  return { width: w, height: h, rgba: new Uint8Array(w * h * 4) };
}

/* Copy an image's opaque pixels into a canvas at (dx, dy).  Pixels below the
 * alpha threshold are left alone, so a tile with holes shows what is under it. */
function blit(dst, img, dx, dy, sx, sy, sw, sh, threshold) {
  const t = threshold === undefined ? 128 : threshold;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const gx = dx + x, gy = dy + y;
      if (gx < 0 || gy < 0 || gx >= dst.width || gy >= dst.height) continue;
      const si = ((sy + y) * img.width + (sx + x)) * 4;
      if (img.rgba[si + 3] < t) continue;
      const di = (gy * dst.width + gx) * 4;
      dst.rgba[di] = img.rgba[si];
      dst.rgba[di + 1] = img.rgba[si + 1];
      dst.rgba[di + 2] = img.rgba[si + 2];
      dst.rgba[di + 3] = 255;
    }
  }
}

function packer(cols, rows) {
  return {
    put(cv, img, cx, cy) {
      if (!img) return;
      blit(cv, img, (cx % cols) * TILE, (cy % rows) * TILE, 0, 0,
           Math.min(TILE, img.width), Math.min(TILE, img.height));
    }
  };
}

/* ---- the scene ---------------------------------------------------------
 * 28 BAT rows of 32 cells.  The pack is a cave: rock edges lit warm, an
 * almost-black interior, and three background plates (bg3 is the farthest,
 * the readme's own rule).  The scene stacks them the way a cave reads —
 * ceiling rock, the far plates, a mid ridge, the floor — and each band gets
 * its own BXR in the toy, so the depth is the parallax.
 *
 * The bands are also what keeps the map seamless at the scroll wrap: every
 * cell pattern repeats with a period that divides 32 (the BAT width), so
 * BXR wrapping at 256 px never shows a seam.
 */
const BANDS = [
  /* first row, rows, kind, tile */
  { row: 0,  rows: 1,  kind: "rock", tile: "terrain_fill_top_center" },
  { row: 1,  rows: 1,  kind: "edge", tile: "terrain_bottom" },
  { row: 2,  rows: 4,  kind: "plate", plate: "bg3" },
  { row: 6,  rows: 4,  kind: "plate", plate: "bg2" },
  { row: 10, rows: 3,  kind: "plate", plate: "bg1" },
  { row: 13, rows: 1,  kind: "edge", tile: "terrain_top" },
  { row: 14, rows: 3,  kind: "fill" },
  { row: 17, rows: 1,  kind: "ledge" },
  { row: 18, rows: 4,  kind: "fill" },
  { row: 22, rows: 1,  kind: "ledge" },
  { row: 23, rows: 4,  kind: "fill" },
  { row: 27, rows: 1,  kind: "edge", tile: "terrain_bottom" }
];

/* A glowing cluster the pack paints warm — a few stand inside the rock, so
 * the cave is lit from its own veins and the palette cycle has something to
 * breathe life into. */
const VEIN = "terrain_bottom_center";
const VEIN_AT = [[4, 18], [19, 19], [27, 18], [9, 21], [22, 21],
                 [3, 24], [14, 24], [25, 23], [30, 25], [17, 26], [8, 26]];

/* The three fill cells of a rock interior, in a 3-cell repeat (3 does not
 * divide 32, so a 2-row stagger keeps the wrap invisible — see below). */
const FILL = ["terrain_fill_center_left", "terrain_fill_center_center",
              "terrain_fill_center_right"];

function composeScene(tiles) {
  const cv = canvas(BAT_W * TILE, ROWS * TILE);
  const pack = packer(BAT_W, ROWS);
  const veins = {};
  for (const [cx, cy] of VEIN_AT) veins[cx + "," + cy] = true;
  for (const band of BANDS) {
    for (let r = 0; r < band.rows; r++) {
      const cy = band.row + r;
      for (let cx = 0; cx < BAT_W; cx++) {
        if (band.kind === "rock") {
          pack.put(cv, tiles[band.tile], cx, cy);
        } else if (band.kind === "edge") {
          /* a rock edge: the pack's left/right corner pieces close the ends
           * of the 256-px map, which meet when the scroll wraps */
          const name = cx === 0 ? band.tile + "_left"
                     : cx === BAT_W - 1 ? band.tile + "_right"
                     : band.tile + "_center";
          pack.put(cv, tiles[name], cx, cy);
        } else if (band.kind === "ledge") {
          /* a rock platform standing out of the floor: the pack's own
           * left/centre/right pieces, the corners at its two ends */
          const name = (cx === 0 || cx === 12) ? "terrain_platform_left"
                     : (cx === 7 || cx === 19) ? "terrain_platform_right"
                     : (cx > 0 && cx < 8) || (cx > 12 && cx < 20)
                       ? "terrain_platform_center"
                       : FILL[[4, 4, 4, 3, 4, 4, 4, 5][cx % 8] - 3];
          pack.put(cv, tiles[name], cx, cy);
        } else if (band.kind === "fill") {
          if (veins[cx + "," + cy]) { pack.put(cv, tiles[VEIN], cx, cy); continue; }
          /* a 16-cell period: 5 of the fill cells in a fixed order, which is
           * how the pack's own 3x3 fill grid tiles without a seam */
          const pick = [4, 4, 4, 4, 3, 4, 4, 4, 5, 4, 4, 4, 3, 4, 4, 4][cx % 16];
          pack.put(cv, tiles[FILL[pick - 3]], cx, cy);
        } else {
          /* a plate: 8x8 cells of the plate image, 16 cells wide (128 px of
           * the 160 it has) so the period divides the BAT */
          const plate = tiles[band.plate];
          blit(cv, plate, cx * TILE, cy * TILE, (cx % 16) * TILE, r * TILE,
               TILE, TILE, 0);
        }
      }
    }
  }
  return cv;
}

/* ---- the sprites -------------------------------------------------------
 * The pack has no characters, so the demo's creatures are drawn here in the
 * pack's own colours (art_lua's palette samples them from the tiles): a bat
 * with two wing positions and an ember.  16x16 is the VDC's smallest sprite.
 */
const SPRITE_COLOURS = {
  /* the pack's near-black and its pinks: the creature is the brightest thing
   * on a dark cave wall, so its membrane takes the pack's mid magenta and its
   * body the pale one — a silhouette in near-black would vanish on bg2 */
  k: [22, 19, 24], p: [190, 118, 211], m: [230, 54, 122],
  w: [252, 198, 254], o: [188, 126, 66], y: [222, 188, 106]
};

const BAT_UP = [
  "................",
  "....k......k....",
  "...kpk....kpk...",
  "...kppk..kppk...",
  "....kppkkppk....",
  ".....kppppk.....",
  "....kkpwwpkk....",
  "...kppkpkkppk...",
  "...kkp.kk.pkk...",
  "....k..pp..k....",
  ".......kk.......",
  "................",
  "................",
  "................",
  "................",
  "................"
];
const BAT_DOWN = [
  "................",
  "................",
  "......kppk......",
  ".....kppppk.....",
  "....kkpwwpkk....",
  "...kppkpkkppk...",
  "..kpp.k..k.ppk..",
  "..kp..k..k..pk..",
  "..k...k..k...k..",
  "......k..k......",
  ".....k....k.....",
  "................",
  "................",
  "................",
  "................",
  "................"
];
const EMBER = [
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "......yy........",
  ".....yooy.......",
  ".....yooy.......",
  "......yy........",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................"
];

const SPRITE_ART = [BAT_UP, BAT_DOWN, EMBER];

function composeSprites() {
  const w = SPRITE_ART.length * 16, h = 16;
  const cv = canvas(w, h);
  for (let s = 0; s < SPRITE_ART.length; s++) {
    const art = SPRITE_ART[s];
    for (let y = 0; y < 16; y++) {
      const row = art[y] || "";
      for (let x = 0; x < 16; x++) {
        const c = row[x] || ".";
        if (c === ".") continue;
        const rgb = SPRITE_COLOURS[c];
        const o = (y * w + s * 16 + x) * 4;
        cv.rgba[o] = rgb[0]; cv.rgba[o + 1] = rgb[1];
        cv.rgba[o + 2] = rgb[2]; cv.rgba[o + 3] = 255;
      }
    }
  }
  return cv;
}

/* ---- the Lua block ----------------------------------------------------- */

function hex(n, width) {
  const s = (n >>> 0).toString(16).toUpperCase();
  return "0x" + "0".repeat(Math.max(0, width - s.length)) + s;
}

/* One 8x8 tile as the VDC's 16 words: rows 0-7 hold colour bits 0-1 (bit 7
 * the left pixel of plane 0, bit 15 of plane 1), rows 8-15 bits 2-3. */
function tileWords(pixels) {
  const out = new Array(TILE * 2).fill(0);
  for (let row = 0; row < TILE; row++) {
    let w0 = 0, w1 = 0;
    for (let col = 0; col < TILE; col++) {
      const c = pixels[row * TILE + col] | 0;
      if (c & 1) w0 |= 1 << (7 - col);
      if (c & 2) w0 |= 1 << (15 - col);
      if (c & 4) w1 |= 1 << (7 - col);
      if (c & 8) w1 |= 1 << (15 - col);
    }
    out[row] = w0;
    out[8 + row] = w1;
  }
  return out;
}

/* One 16x16 sprite pattern as four 16-word planes (bit 15 the left pixel). */
function patternWords(pat) {
  const out = new Array(64).fill(0);
  for (let row = 0; row < pat.height; row++) {
    for (let col = 0; col < pat.width; col++) {
      const c = pat.pixels[row * pat.width + col] | 0;
      for (let plane = 0; plane < 4; plane++)
        if (c & (1 << plane))
          out[plane * 16 + row] |= 1 << (15 - col);
    }
  }
  return out;
}

/* Rows of BAT words, with any run of four or more equal words written as a
 * loop: the toy has to carry every one of these inside the 8 KiB data bank
 * the IL bytecode lives in (#138), and a uniform rock row costs one loop. */
function batLines(map, palOf) {
  const lines = [];
  for (let row = 0; row < ROWS; row++) {
    const words = [];
    for (let cx = 0; cx < BAT_W; cx++) {
      const char = map[row * BAT_W + cx];
      words.push((char | (palOf(char) << 12)) >>> 0);
    }
    let x = 0;
    while (x < BAT_W) {
      let run = 1;
      while (x + run < BAT_W && words[x + run] === words[x]) run++;
      const addr = row * BAT_W + x;
      if (run >= 4) {
        lines.push("  for k = 0, " + (run - 1) + " do vram[" + hex(addr, 4) +
                   " + k] = " + hex(words[x], 4) + " end");
      } else {
        for (let i = 0; i < run; i++)
          lines.push("  vram[" + hex(addr + i, 4) + "] = " + hex(words[x + i], 4));
      }
      x += run;
    }
  }
  return lines;
}

function paletteLines(palettes) {
  const lines = [];
  for (let p = 0; p < palettes.length; p++) {
    const row = palettes[p];
    for (let e = 0; e < src.ENTRIES; e++)
      lines.push("  pal(" + hex(p * 16 + e, 3) + ", " + hex(row[e], 3) + ")");
  }
  return lines;
}

/* ---- which palette entry glows ----------------------------------------
 * The pack's warm colours are what a lamp would light: the demo cycles the
 * brightest of them, in every palette that holds it, between itself and a
 * hotter and a colder word.  It is found by measurement — the entry whose
 * VCE word is brightest and has more red than blue — so the block names where
 * to cycle rather than a hand-copied number. */
function glowEntry(palettes) {
  let best = null;
  for (let p = 0; p < palettes.length; p++) {
    for (let e = 1; e < src.ENTRIES; e++) {
      const w = palettes[p][e];
      const c = src.channels(w);
      if (c.r + c.g + c.b < 8) continue;         /* a dark shade, not a glow */
      if (c.r <= c.b) continue;                  /* warm only: red over blue */
      const score = c.r + c.g;
      if (!best || score > best.score) best = { pal: p, entry: e, word: w,
                                                score: score };
    }
  }
  return best;
}

function build(packZip, outDir) {
  const ex = extractPack(packZip);
  try {
    const tiles = tilesOf(ex.root, "style_A");
    const scene = composeScene(tiles);
    const picture = src.importImage(scene, { kind: "bg", name: "cave",
                                             maxPalettes: 16, dither: "none" });
    const sprites = composeSprites();
    const sheet = src.importImage(sprites, { kind: "sprites", name: "cave",
                                             size: [16, 16], maxPalettes: 16 });
    return writeArt(picture, sheet, outDir, ex.root);
  } finally {
    cp.execFileSync("rm", ["-rf", ex.dir]);
  }
}

function writeArt(picture, sheet, outDir, packRoot) {
  const palOf = {};
  for (const t of picture.tiles) palOf[t.char] = t.palette;
  const glow = glowEntry(picture.palettes);
  /* The sprite patterns go in the first 4-char-aligned cell AFTER the last
   * tile.  (pce-source.js packs them from cell 16 for the SPRITES panel,
   * which is char $40 — the first tile the BG import also starts at, so a
   * toy that draws both would overwrite one with the other; the console has
   * one VRAM and the toy has to place them.) */
  const patternCell = Math.ceil((FIRST_CHAR + picture.tiles.length) / 4);
  const spritePals = [];
  for (let s = 0; s < sheet.palettes.length; s++) {
    for (let e = 0; e < src.ENTRIES; e++)
      spritePals.push("  pal(" + hex(0x100 + s * 16 + e, 3) + ", " +
                      hex(sheet.palettes[s][e], 3) + ")");
  }

  const L = [];
  L.push("-- >>> PCEStudio demo art for toys/cave — generated by " +
         "tools/cave-assets.js; do not edit.");
  L.push("-- The picture is the \"Retro Pixel Cave\" tileset by Will Tice " +
         "(unTied Games),");
  L.push("-- used as part of PCEStudio under that pack's licence (see " +
         "toys/cave/README.md).");
  L.push("-- " + picture.stats.tiles + " tiles from $" +
         hex(FIRST_CHAR, 2) + ", " + picture.stats.palettes + " background " +
         "palettes, " + sheet.patterns.length + " sprite patterns at cell " +
         patternCell + ".");
  L.push("-- This file is NOT in the repo: docs/DECISIONS.md, 2026-10-29.");
  L.push("");
  L.push("PATTERN_CELL = " + patternCell + "   -- the sprites' pattern codes " +
         "start here");
  L.push("GLOW_PAL = " + glow.pal);
  L.push("GLOW_ENTRY = " + glow.entry);
  L.push("GLOW_BASE = " + hex(glow.word, 3) + "   -- the pack's own warm colour");
  L.push("GLOW_HOT = " + hex(Math.min(0x1FF, glow.word + 0x49), 3) +
         "   -- the same hue, r and g a notch up");
  L.push("GLOW_COLD = " + hex(Math.max(0, glow.word - 0x49), 3) +
         "   -- and a notch down: the cave breathes");
  L.push("");
  L.push("function art_boot()");
  for (const line of paletteLines(picture.palettes)) L.push(line);
  for (const line of spritePals) L.push(line);
  L.push("  -- the backdrop: the picture's most common colour (its own entry 0)");
  L.push("  pal(0, " + hex(picture.backdrop, 3) + ")");
  L.push("end");
  L.push("");
  L.push("function art_board()");
  for (const t of picture.tiles) {
    const words = tileWords(t.pixels);
    L.push("  -- tile " + hex(t.char, 2) + " (palette " + t.palette + ")");
    for (let w = 0; w < words.length; w++)
      L.push("  vram[" + hex(t.char * 16 + w, 4) + "] = " + hex(words[w], 4));
  }
  L.push("end");
  L.push("");
  L.push("function art_map()");
  for (const line of batLines(picture.map, (c) => palOf[c] || 0)) L.push(line);
  L.push("end");
  L.push("");
  L.push("function art_patterns()");
  for (let p = 0; p < sheet.patterns.length; p++) {
    const words = patternWords(sheet.patterns[p]);
    L.push("  -- pattern " + p + " (sprite palette " +
           sheet.sprites[p].palette + ")");
    for (let w = 0; w < words.length; w++)
      L.push("  vram[" + hex((patternCell + p) * 64 + w, 4) + "] = " +
             hex(words[w], 4));
  }
  L.push("end");
  L.push("");
  L.push("-- <<< PCEStudio demo art");
  const lua = L.join("\n") + "\n";

  const files = {
    "art.lua": lua,
    "main.lua": playable(lua),
    "tiles.json": picture.files["tiles.json"],
    "palettes.json": picture.files["palettes.json"],
    "sprites.json": sheet.files["sprites.json"]
  };
  /* the sprite patterns' palettes are the sprites.json's; the background's
   * are palettes.json's — one file each, as the panels write them */

  if (!outDir) return { files: files, console: consoleBuild(lua) };
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of Object.keys(files))
    fs.writeFileSync(path.join(outDir, name), files[name]);
  const console = consoleBuild(lua);
  fs.writeFileSync(path.join(outDir, "cave-console.lua"), console);
  writePng(path.join(outDir, "scene.png"), sceneImage(picture));
  writePng(path.join(outDir, "sprites.png"), spriteImage(sheet));
  return { files: files, console: console, picture: picture, sheet: sheet,
           out: outDir };
}

/* The playable toy: the repository's main.lua with the art appended, which is
 * how the page runs it and what tools/gallery.js's --with-demo-art reads
 * (demo-art/cave/main.lua).  It is built from the repo file rather than from
 * art.lua alone so the two can never drift. */
function playable(artLua) {
  const toy = fs.readFileSync(path.join(ROOT, "toys", "cave", "main.lua"), "utf8");
  return toy + "\n" + artLua;
}

/* ---- the console build --------------------------------------------------
 * Route 1 (IL bytecode + renderer/ilvm.bin) cannot read the pad (#134) and
 * has no sat() (#133), so the console build of the same toy is this file with
 * the two marked regions cut out: the cave drifts on its own, and the SAT
 * reaches the VDC the way hardware does it, because the runtime loads $7F00
 * into SATB every VBlank.  The cut is checked, not hoped for: an unbalanced
 * or missing marker throws. */
function consoleBuild(artLua) {
  const toy = fs.readFileSync(path.join(ROOT, "toys", "cave", "main.lua"), "utf8");
  const out = [];
  let depth = 0, opens = 0, closes = 0;
  for (const line of toy.split("\n")) {
    if (/^\s*-- >>> (pad|browser):/.test(line)) { depth++; opens++; continue; }
    if (/^\s*-- <<< (pad|browser)\s*$/.test(line)) {
      if (!depth) throw new Error("a closing marker with no opening one");
      depth--; closes++; continue;
    }
    if (!depth) out.push(line);
  }
  if (depth) throw new Error("a marked region is never closed");
  if (opens !== 2 || closes !== 2) throw new Error(
    "expected 2 pad/browser regions in toys/cave/main.lua, found " +
    opens + " open and " + closes + " close");
  return out.join("\n") + "\n" + artLua;
}

/* ---- previews (the tool's own eyes) ------------------------------------ */

function sceneImage(picture) {
  const w = BAT_W * TILE, h = ROWS * TILE;
  return { width: w, height: h, pixels: picture.preview.pixels.slice(0, w * h * 3) };
}

function spriteImage(sheet) {
  return { width: sheet.preview.width, height: sheet.preview.height,
           pixels: sheet.preview.pixels };
}

function writePng(file, img) {
  fs.writeFileSync(file, encodePng(img.pixels, img.width, img.height));
}

function crc32(buf) {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  let x = 0xFFFFFFFF;
  for (const b of buf) x = t[(x ^ b) & 0xFF] ^ (x >>> 8);
  return (x ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(rgb, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w * 3; x++) raw[y * (w * 3 + 1) + 1 + x] = rgb[y * w * 3 + x];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/* ---- the command line -------------------------------------------------- */

function main(argv) {
  let pack = DEFAULT_PACK, out = DEFAULT_OUT, check = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--pack") pack = argv[++i];
    else if (argv[i] === "--out") out = argv[++i];
    else if (argv[i] === "--check") check = true;
    else if (argv[i] === "--print") out = null;
    else { console.error("unknown argument " + argv[i]); process.exit(2); }
  }

  if (check) {
    if (!fs.existsSync(path.join(out, "art.lua"))) {
      console.log("SKIP  cave art is not on this machine (" + out +
                  "): the demo's converted picture is not in the repo " +
                  "(docs/DECISIONS.md, 2026-10-29)");
      process.exit(0);
    }
    if (!fs.existsSync(pack)) {
      console.log("SKIP  nothing to check " + out + " against: no pack at " +
                  pack + " (set PCE_CAVE_PACK)");
      process.exit(0);
    }
    const built = build(pack, null);
    let bad = 0;
    for (const name of Object.keys(built.files)) {
      const want = built.files[name];
      const have = fs.readFileSync(path.join(out, name), "utf8");
      if (have !== want) { bad++; console.log("FAIL  " + name +
                            " is not what tools/cave-assets.js writes"); }
    }
    if (bad) process.exit(1);
    console.log("ok    cave art matches tools/cave-assets.js (" +
                Object.keys(built.files).length + " files)");
    return;
  }

  if (!fs.existsSync(pack)) {
    console.error("no pack at " + pack + " (pass --pack or set PCE_CAVE_PACK)");
    process.exit(2);
  }
  if (!out) {
    const built = build(pack, null);
    for (const name of Object.keys(built.files)) {
      console.log("---- " + name + " ----");
      console.log(built.files[name].slice(0, 400));
    }
    return;
  }
  const built = build(pack, out);
  console.log("wrote " + Object.keys(built.files).length + " files to " + out);
  console.log("  tiles " + built.picture.stats.tiles + ", backgrounds " +
              built.picture.stats.palettes + ", colours " +
              built.picture.stats.colours + ", max per tile " +
              built.picture.stats.maxTileColours);
  console.log("  sprite patterns " + built.sheet.patterns.length +
              ", sprite palettes " + built.sheet.stats.palettes);
  for (const w of built.picture.warnings) console.log("  warn: " + w);
  for (const w of built.sheet.warnings) console.log("  warn: " + w);
  console.log("  route 1 (the Export button): " + routeOne(built.console));
}

/* The Export path, measured rather than guessed.  A toy has to pass
 * renderer/pce-ilbc.js's encoder to be exported at all; this prints what the
 * encoder says about the console build, so the demo's ROM status is a
 * measurement and not a memory of a conversation. */
function routeOne(consoleSource) {
  const il = require("../renderer/pce-il.js");
  const ilbc = require("../renderer/pce-ilbc.js");
  try {
    const program = il.compile(consoleSource, { chunkName: "@cave-console.lua" });
    const encoded = ilbc.encode(program);
    return "encoded, " + encoded.bytes.length + " B of bytecode";
  } catch (e) {
    return "REFUSED " + (e && e.code) + " - " + (e && e.message);
  }
}

module.exports = { composeScene, composeSprites, build, SPRITE_ART };

if (require.main === module) main(process.argv.slice(2));
