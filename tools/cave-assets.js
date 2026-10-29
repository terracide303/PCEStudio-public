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

/* The author's own scene data: the .pyxel project the pack ships (itself a
 * zip — docData.json plus the 4x4 tiles).  Unzipped inside the pack's own
 * scratch dir and read, never run. */
function readDoc(root) {
  const dir = path.join(root, "pyxel");
  if (!fs.existsSync(path.join(dir, "docData.json"))) {
    fs.mkdirSync(dir, { recursive: true });
    cp.execFileSync("unzip", ["-q", path.join(root, "retro_pixel_cave.pyxel"),
                              "-d", dir], { stdio: "inherit" });
  }
  const doc = JSON.parse(fs.readFileSync(path.join(dir, "docData.json"), "utf8"));
  const tiles = {};
  for (let i = 0; i < doc.tileset.numTiles; i++)
    tiles[i] = readPng(path.join(dir, "tile" + i + ".png"));
  return { doc: doc, tiles: tiles };
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

/* ---- the pack's own scene ----------------------------------------------
 * The pack ships the author's example scene inside the .pyxel project: a
 * 160x92 canvas whose terrain and midground layers place 4x4 tiles over
 * three full-screen backdrop plates (bg3 is the farthest — the readme's own
 * rule).  RULES.md's rule 1 says the pack's own example is the working
 * example, so the picture IS that scene: composed the way the author's
 * editor composes it, measured against the pack's own preview (the
 * wallpaper is the same stack plus its creatures), and then cut into the
 * toy's parallax bands.
 */

/* The author's scene, 160x92: the plates first (farthest at the bottom),
 * then the terrain layer, then the midground layer — each cell a 4x4 tile
 * from the .pyxel. */
function composeDocScene(tiles, docData) {
  const c = docData.doc.canvas;
  const cv = canvas(c.width, c.height);
  for (const p of ["bg3", "bg2", "bg1"])
    blit(cv, tiles[p], 0, 0, 0, 0, cv.width, cv.height);
  for (const li of ["0", "1"]) {
    const refs = c.layers[li].tileRefs;
    for (const key of Object.keys(refs)) {
      const cell = parseInt(key, 10);
      const cx = cell % (c.width / 4), cy = Math.floor(cell / (c.width / 4));
      blit(cv, docData.tiles[refs[key].index], cx * 4, cy * 4, 0, 0, 4, 4);
    }
  }
  return cv;
}

/* The pack's own preview, 160x92 (the wallpaper is 12x that: 1920x1104).
 * The doc scene must BE this picture minus the creatures the toy draws
 * itself — the fraction is measured, printed, and (in the evidence test)
 * asserted. */
function readPreview(root) {
  const wall = readPng(path.join(root, "retro_pixel_cave_wallpaper_A.png"));
  const scale = wall.width / 160;
  const cv = canvas(160, 92);
  for (let y = 0; y < 92; y++)
    for (let x = 0; x < 160; x++) {
      const s = (y * scale * wall.width + x * scale) * 4;
      const d = (y * 160 + x) * 4;
      cv.rgba[d] = wall.rgba[s];
      cv.rgba[d + 1] = wall.rgba[s + 1];
      cv.rgba[d + 2] = wall.rgba[s + 2];
      cv.rgba[d + 3] = 255;
    }
  return cv;
}

function previewMatch(scene, preview) {
  let same = 0, n = 0;
  for (let y = 0; y < preview.height; y++)
    for (let x = 0; x < preview.width; x++) {
      const d = (y * preview.width + x) * 4;
      n++;
      if (scene.rgba[d] === preview.rgba[d] &&
          scene.rgba[d + 1] === preview.rgba[d + 1] &&
          scene.rgba[d + 2] === preview.rgba[d + 2]) same++;
    }
  return same / n;
}

/* ---- the bands ----------------------------------------------------------
 * The doc scene is cut into five parallax bands along the lines the scene
 * itself draws — the ceiling with its stalactites, the crystal band, the
 * near wall, the mid floor and the near floor — and each band gets its own
 * BXR in the toy, so the depth is the parallax.  The band lines sit where
 * the scene is flat, and nothing of the author's crosses one except flat
 * rock: a feature that did would shear when the bands scroll at five
 * speeds.  The one exception is cut rather than sheared — the pink crystal
 * tops that poke into the ceiling band are painted over, so each crystal
 * lives wholly in its band.
 *
 * Every band is a 32-cell strip that wraps at 256 px without a seam, and no
 * band is a short block repeated: the whole width is one scene, which is
 * what the picture must look like.  The strip carries the author's scene in
 * its first 20 cells — at BXR 0 the frame's left 160 px ARE the preview —
 * and the last 12 cells stretch the scene's own left side columns (px 0-15,
 * six wide each), so the wrap meets px 15 on px 0: the scene's own adjacent
 * columns, exactly as seamless as the scene's interior.  The two floor
 * bands, which have no scene behind them, are drawn from the author's own
 * rock tiles with flat fill at both seam ends.
 */
const BANDS = [
  /* first row, rows, the scene's own row it starts at */
  { row: 0,  rows: 4, y0: 0 },   /* the ceiling */
  { row: 4,  rows: 3, y0: 32 },  /* the crystal band */
  { row: 7,  rows: 5, y0: 56 },  /* the near wall */
  { row: 12, rows: 8, floor: true },
  { row: 20, rows: 8, floor: true }
];

/* The pack's rock floor, below the scene's own 92 px: the author's own 4x4
 * tiles — flat fill, the dark crack marks, and the warm speckles the cave
 * is lit by — laid in a designed pattern, the warm speckles scattered so
 * the veins the glow cycle breathes on are irregular, not one repeated
 * cell. */
const FLOOR_FILL = 6;                  /* the doc's flat fill tile */
const FLOOR_CRACK = [22, 23];          /* fill with a dark crack mark */
const FLOOR_WARM = [0, 1, 4, 5, 8, 9, 11, 12, 19, 20, 32, 33, 50, 51, 52, 53,
                    54, 56, 57, 58, 59, 60, 61, 63, 64, 65, 66, 67, 68];

/* The tile for one 4x4 cell of the floor: c is the cell column 0..63, r the
 * row 0..31 (the floor bands' first row is y=96, r=0).  The two seam cells
 * at each end are flat; the diagonals carry the cracks; the scatter carries
 * the veins. */
function floorTile(c, r) {
  if (c < 4 || c > 59) return FLOOR_FILL;
  const ch = (c + r * 2) % 25;
  if (ch === 6 || ch === 7) return FLOOR_CRACK[(c + r) % 2];
  if ((c * 31 + r * 17) % 19 === 5 || (c * 13 + r * 29) % 13 === 2)
    return FLOOR_WARM[(c * 5 + r * 3) % FLOOR_WARM.length];
  return FLOOR_FILL;
}

/* One column of the scene, stretched six wide: the strip's last 12 cells are
 * the scene's own left side (px 0-15), so the wrap brings px 15 onto px 0 —
 * the scene's adjacent columns — and the band tiles without a seam. */
function stretchSide(dst, img, dx, dy, sx, sy, h) {
  for (let y = 0; y < h; y++) {
    const si = ((sy + y) * img.width + sx) * 4;
    if (img.rgba[si + 3] < 128) continue;
    const di = ((dy + y) * dst.width + dx) * 4;
    for (let k = 0; k < 6; k++) {
      dst.rgba[di + k * 4] = img.rgba[si];
      dst.rgba[di + k * 4 + 1] = img.rgba[si + 1];
      dst.rgba[di + k * 4 + 2] = img.rgba[si + 2];
      dst.rgba[di + k * 4 + 3] = 255;
    }
  }
}

/* One band strip: 32 cells (256 px) of the scene slice, closed at the wrap
 * by the stretch above. */
function bandStrip(scene, band) {
  const h = band.rows * TILE;
  const cv = canvas(BAT_W * TILE, h);
  const avail = Math.min(h, 92 - band.y0);
  blit(cv, scene, 0, 0, 0, band.y0, 160, avail);
  for (let x = 0; x < 16; x++)
    stretchSide(cv, scene, 160 + x * 6, 0, x, band.y0, avail);
  if (h > avail) {
    /* the near wall's strip outruns the scene: the scene's own floor
     * carries on downward (its last 4 rows repeat) */
    blit(cv, scene, 0, avail, 0, 88, 160, h - avail);
    for (let x = 0; x < 16; x++)
      stretchSide(cv, scene, 160 + x * 6, avail, x, 88, h - avail);
  }
  return cv;
}

/* The crystal tops the author drew into the ceiling's rows (y28-31) belong
 * to the crystal band's bodies (y32+): cut at the band line, not sheared.
 * Every bright crystal pixel in those rows is repainted in its cell's own
 * most common non-crystal colour. */
const CRYSTAL_COLOURS = ["252,198,254", "242,150,246", "190,118,211",
                         "133,78,176"];
function cutCrystalTops(strip) {
  for (let y = 28; y < 32; y++)
    for (let x = 0; x < strip.width; x++) {
      const d = (y * strip.width + x) * 4;
      const key = strip.rgba[d] + "," + strip.rgba[d + 1] + "," + strip.rgba[d + 2];
      if (CRYSTAL_COLOURS.indexOf(key) < 0) continue;
      const counts = new Map();
      const cx0 = Math.floor(x / TILE) * TILE, cy0 = Math.floor(y / TILE) * TILE;
      for (let yy = cy0; yy < cy0 + TILE; yy++)
        for (let xx = cx0; xx < cx0 + TILE; xx++) {
          const dd = (yy * strip.width + xx) * 4;
          const kk = strip.rgba[dd] + "," + strip.rgba[dd + 1] + "," + strip.rgba[dd + 2];
          if (CRYSTAL_COLOURS.indexOf(kk) >= 0) continue;
          counts.set(kk, (counts.get(kk) || 0) + 1);
        }
      let best = null, bn = 0;
      for (const [kk, v] of counts) if (v > bn) { best = kk; bn = v; }
      const rgb = best ? best.split(",").map(Number) : [79, 43, 141];
      strip.rgba[d] = rgb[0];
      strip.rgba[d + 1] = rgb[1];
      strip.rgba[d + 2] = rgb[2];
    }
}

function composeScene(tiles, docData) {
  const scene = composeDocScene(tiles, docData);
  const cv = canvas(BAT_W * TILE, ROWS * TILE);
  for (const band of BANDS) {
    if (band.floor) {
      for (let r = 0; r < band.rows; r++) {
        const by = band.row + r;
        if (by === 27) {
          /* the pack's floor edge closes the picture at the bottom, and its
           * two end cells are flat fill, so the scroll wrap meets fill on
           * fill (the pack's decorated corner pieces would not) */
          for (let cx = 0; cx < BAT_W; cx++)
            blit(cv, tiles["terrain_bottom_center"], cx * TILE, by * TILE,
                 0, 0, TILE, TILE);
          for (const cx of [0, 1, BAT_W - 2, BAT_W - 1])
            for (let qy = 0; qy < 2; qy++)
              for (let qx = 0; qx < 2; qx++)
                blit(cv, docData.tiles[FLOOR_FILL], cx * 8 + qx * 4,
                     by * 8 + qy * 4, 0, 0, 4, 4);
          continue;
        }
        for (let cx = 0; cx < BAT_W; cx++)
          for (let qy = 0; qy < 2; qy++)
            for (let qx = 0; qx < 2; qx++) {
              const c4 = cx * 2 + qx;
              const r4 = (by - 12) * 2 + qy;
              blit(cv, docData.tiles[floorTile(c4, r4)], c4 * 4, by * 8 + qy * 4,
                   0, 0, 4, 4);
            }
      }
      continue;
    }
    const strip = bandStrip(scene, band);
    if (band.y0 === 0) cutCrystalTops(strip);
    blit(cv, strip, 0, band.row * TILE, 0, 0, strip.width, strip.height);
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
    const docData = readDoc(ex.root);
    const preview = readPreview(ex.root);
    const docScene = composeDocScene(tiles, docData);
    const match = previewMatch(docScene, preview);
    const scene = composeScene(tiles, docData);
    const picture = src.importImage(scene, { kind: "bg", name: "cave",
                                             maxPalettes: 16, dither: "none" });
    const sprites = composeSprites();
    const sheet = src.importImage(sprites, { kind: "sprites", name: "cave",
                                             size: [16, 16], maxPalettes: 16 });
    return writeArt(picture, sheet, outDir, docScene, preview, match);
  } finally {
    cp.execFileSync("rm", ["-rf", ex.dir]);
  }
}

function writeArt(picture, sheet, outDir, docScene, preview, match) {
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
         "palette" + (picture.stats.palettes === 1 ? "" : "s") + ", " +
         sheet.patterns.length + " sprite patterns at cell " +
         patternCell + ".");
  L.push("-- The pack's own scene, measured against its own preview " +
         "(wallpaper_A): " + (100 * match).toFixed(1) +
         "% of pixels match — the rest is the preview's creatures, which " +
         "this toy draws itself.");
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

  if (!outDir) return { files: files, console: consoleBuild(lua), match: match };
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of Object.keys(files))
    fs.writeFileSync(path.join(outDir, name), files[name]);
  const console = consoleBuild(lua);
  fs.writeFileSync(path.join(outDir, "cave-console.lua"), console);
  writePng(path.join(outDir, "scene.png"), sceneImage(picture));
  writePng(path.join(outDir, "sprites.png"), spriteImage(sheet));
  /* the evidence the card asks for: the pack's preview at the frame's own
   * 1:1 scale — tests/check-cave.js draws it beside the toy's frame and
   * measures the match */
  fs.mkdirSync(path.join(outDir, "evidence"), { recursive: true });
  writePng(path.join(outDir, "evidence", "preview.png"), rgbImage(preview));
  writePng(path.join(outDir, "evidence", "scene-composed.png"),
           rgbImage(docScene));
  return { files: files, console: console, picture: picture, sheet: sheet,
           out: outDir, match: match };
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

/* A raw RGBA canvas as RGB pixels for writePng. */
function rgbImage(cv) {
  const pixels = new Uint8Array(cv.width * cv.height * 3);
  for (let i = 0, j = 0; i < cv.rgba.length; i += 4, j += 3) {
    pixels[j] = cv.rgba[i];
    pixels[j + 1] = cv.rgba[i + 1];
    pixels[j + 2] = cv.rgba[i + 2];
  }
  return { width: cv.width, height: cv.height, pixels: pixels };
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
  console.log("  the pack's own scene vs its own preview: " +
              (100 * built.match).toFixed(1) + "% of pixels match (the rest " +
              "is the preview's creatures, which the toy draws itself)");
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
