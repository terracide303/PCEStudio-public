#!/usr/bin/env node
/*
 * tools/oak-woods-art.js — the Oak Woods pack, through the #123 importer,
 * into the toy (card #128).
 *
 * WHY THIS IS NOT IN THE REPO.  Dennis, 2026-10-29: the demo art may be shown
 * on the website but never committed (docs/DECISIONS.md).  So the toy's Lua is
 * in toys/oak-woods/main.lua and the pack's converted art is written beside
 * the repo, to demo-art/oak-woods/ — main.lua with the generated block in it,
 * the importer's own report, and the PNG evidence.  A fresh clone runs the
 * toy's placeholder picture; with this folder present the toy plays with the
 * pack's forest.
 *
 * THE PACK.  oak_woods_v1.0.zip by Brullov (brullov.art; the readme.TXT in the
 * zip is a purchase thank-you with no licence text).  It is extracted to a new
 * empty folder under $TMPDIR and nothing in it is ever run.  The licence
 * quotes and the fit to the PCE are in the README written beside the art.
 *
 * THE PIPELINE.  renderer/pce-source.js is the #123 importer — the same code
 * the studio's Add Source button runs.  Nothing here re-implements it: this
 * tool composes the pack's layers into the one background the PCE shows, cuts
 * the character sheet into the sprite sizes the VDC draws, calls importImage
 * for each, and writes the art the way the studio keeps it (card #156):
 * tiles.json, palettes.json and sprites.json beside the playable main.lua,
 * plus sources.json naming the three sources with their ranges.  The #117
 * importer puts that picture into VRAM, CRAM and the SAT before the toy
 * runs, so main.lua's generated block holds only the numbers the game needs
 * — the importer's own placement, read back through
 * renderer/pce-editor.js's patternLayout, never recomputed here.
 *
 *   node tools/oak-woods-art.js            import, write demo-art/oak-woods/
 *   node tools/oak-woods-art.js --check    exit 1 if that folder is stale
 *   node tools/oak-woods-art.js --pack F   a different copy of the zip
 *
 * The pack path defaults to Dennis's download and can be overridden with
 * OAK_WOODS_PACK.  If the pack AND the written folder are both absent, --check
 * says SKIP and exits 0, so a fresh clone stays green.  --check compares
 * every file the tool writes, not just main.lua.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const child = require("child_process");
const src = require("../renderer/pce-source.js");

const ROOT = path.resolve(__dirname, "..");
const TOY = path.join(ROOT, "toys", "oak-woods", "main.lua");
const DEMO_ART = process.env.DEMO_ART ||
  "/Volumes/External/agent-workshop-demo/demo-art";
const OUT = path.join(DEMO_ART, "oak-woods");
const DEFAULT_PACK = "/Volumes/External/Download/oak_woods_v1.0.zip";
const OPEN = "-- >>> PCEStudio demo art";
const CLOSE = "-- <<< PCEStudio demo art";

/* ---- the pack, extracted to a new empty folder under $TMPDIR ----------- */

function extract(pack) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oak-woods-"));
  child.execFileSync("unzip", ["-q", pack, "-d", dir], { stdio: "pipe" });
  return dir;
}

function loadPng(file) {
  return src.decodePng(fs.readFileSync(file), zlib.inflateSync);
}

function px(img, x, y) {
  const o = (y * img.width + x) * 4;
  return [img.rgba[o], img.rgba[o + 1], img.rgba[o + 2], img.rgba[o + 3]];
}

/* ---- a canvas the composed pictures are drawn into --------------------- */

function canvas(w, h) {
  return { width: w, height: h, rgba: new Uint8Array(w * h * 4) };
}

function set(img, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const o = (y * img.width + x) * 4;
  img.rgba[o] = r; img.rgba[o + 1] = g; img.rgba[o + 2] = b;
  img.rgba[o + 3] = a === undefined ? 255 : a;
}

/* Copy a rectangle, skipping the source's transparent pixels (alpha < 128),
 * so a layer sits over the fill behind it. */
function blitFrom(dst, source, sx, sy, w, h, dx, dy, fill) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = sx + x, t = sy + y;
    const p = px(source, s, t);
    if (p[3] >= 128) set(dst, dx + x, dy + y, p[0], p[1], p[2], 255);
    else if (fill) { const f = fill(dx + x, dy + y); set(dst, dx + x, dy + y, f[0], f[1], f[2], 255); }
  }
}

/* ---- the 5x7 font the status bar and the digits use --------------------
 * Our own glyphs (not the pack's): the PCE has no text, so the HUD is tiles
 * this tool draws.  Each glyph is 5 pixels wide and 7 tall in an 8x8 cell. */
const FONT = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  "I": ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  "C": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
};

const BAR = [42, 30, 22];       /* the status bar's brown */
const CREAM = [232, 220, 190];  /* its text */

function glyph(img, ch, cellX, cellY) {
  const rows = FONT[ch];
  for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++)
    if (rows[y][x] === "1") set(img, cellX + 1 + x, cellY + 1 + y,
                                CREAM[0], CREAM[1], CREAM[2], 255);
}

/* ---- the one background (256x232: 224 shown + the glyph row) ----------- *
 * Card #150 (Dennis, playing #128: "the trees are cut now").  The pack's three
 * layers overlap full-screen; the PCE has ONE background, and #128 cut the
 * screen into three horizontal bands, so every tree that crossed a band edge
 * was sliced.  Now:
 *
 *   (a) layer 1 (the far trees) and layer 2 (the mid trees) are composited
 *       into ONE picture, and the pack's forest floor (layer 3's rows from
 *       GROUND_ROW down) sits on it.  It is one 256-px loop: each layer is read
 *       through the 256-px window whose two edges match best (seamCost), so
 *       the BAT's wrap shows no step.
 *   (b) the top SKY STRIP is cut at the one row where the composite is a flat
 *       colour for the whole width (no tree crosses it): findCut().  It scrolls
 *       slower, through the raster table.
 *   (c) layer 3's front trunks and canopy are left out (sprite trunks were
 *       tried and removed at Dennis's request).
 *
 * The 224 rows: 0..23 the status bar, 24..43 flat sky (the strip's extra
 * lines, the colour of the composite's own top row), then the layers' 180
 * rows at 44..223 — layer row 160 (the forest floor's line) lands on 204, the
 * GROUND the game stands on.  Rows 224..231 are off-screen and hold the ten
 * digit glyphs the HUD swaps into the bar. */
const LAYER_Y = 44;        /* screen row of the layers' row 0 */
const GROUND_ROW = 150;    /* layer 3's rows from here down are the forest floor */
const TRUNK_BOX = [{ x: 112 }, { x: 252 }];   /* layer 3's two trunks, 64 px wide */
const TRUNK_W = 64;

function colDist(a, b) {
  if (!a[3] && !b[3]) return 0;
  if (!a[3] || !b[3]) return 765;
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

/* a 320-wide layer, wrapping, as a function */
function wrapPx(img, x, y) {
  const p = px(img, ((x % img.width) + img.width) % img.width, y);
  return [p[0], p[1], p[2], p[3] >= 128 ? 255 : 0];
}

/* The cost of the loop's seam if the 256-px window starts at x0: how far the
 * column that would sit left of column 0 (x0-1) is from the one that does
 * (x0+255), summed over the rows.  Pixel art has a typical adjacent-column cost;
 * a seam at or under it is not a seam. */
function seamCost(img, x0, y0, y1) {
  let c = 0;
  for (let y = y0; y < y1; y++) c += colDist(wrapPx(img, x0 + 255, y), wrapPx(img, x0 - 1, y));
  return c;
}

function bestWindow(img, y0, y1) {
  let best = 0, bestCost = Infinity;
  for (let x0 = 0; x0 < img.width; x0++) {
    const c = seamCost(img, x0, y0, y1);
    if (c < bestCost) { bestCost = c; best = x0; }
  }
  let typical = 0;
  for (let x = 0; x < img.width - 1; x++)
    for (let y = y0; y < y1; y++) typical += colDist(wrapPx(img, x, y), wrapPx(img, x + 1, y));
  return { x0: best, cost: bestCost, typical: typical / (img.width - 1) };
}

/* Layer 3's forest floor as its own 320-wide picture: the rows from GROUND_ROW
 * down, with the two trunks' columns replaced by columns of the same rows taken
 * from the trunk-free left of the layer, so no root flare is left behind in the
 * background (layer 3's roots are not drawn). */
function composeGround(layer3) {
  const g = canvas(layer3.width, layer3.height);
  const DONOR0 = 4, DONOR_N = 90;
  for (let y = GROUND_ROW; y < layer3.height; y++) for (let x = 0; x < layer3.width; x++) {
    let sx = x;
    for (const box of TRUNK_BOX)
      if (x >= box.x - 8 && x < box.x + TRUNK_W + 8)
        sx = DONOR0 + ((x - box.x + 8) % DONOR_N);
    const p = wrapPx(layer3, sx, y);
    if (p[3]) set(g, x, y, p[0], p[1], p[2], 255);
  }
  return g;
}

function windows(layers) {
  const ground = composeGround(layers[2]);
  return {
    far: bestWindow(layers[0], 0, 180),
    mid: bestWindow(layers[1], 0, 180),
    ground: bestWindow(ground, GROUND_ROW, 180),
    groundImg: ground,
  };
}

/* the composite of layers 1, 2 and the floor, rows 0..179, 256 wide */
function composeScene(layers) {
  const w = windows(layers);
  const img = canvas(256, 180);
  for (let y = 0; y < 180; y++) for (let x = 0; x < 256; x++) {
    let p = wrapPx(layers[0], w.far.x0 + x, y);
    const m = wrapPx(layers[1], w.mid.x0 + x, y);
    if (m[3]) p = m;
    if (y >= GROUND_ROW) {
      const q = wrapPx(w.groundImg, w.ground.x0 + x, y);
      if (q[3]) p = q;
    }
    set(img, x, y, p[0], p[1], p[2], 255);
  }
  return { img, windows: w };
}

function rowUniform(img, y) {
  const a = px(img, 0, y);
  for (let x = 1; x < img.width; x++) {
    const b = px(img, x, y);
    if (b[0] !== a[0] || b[1] !== a[1] || b[2] !== a[2]) return false;
  }
  return true;
}

/* The sky strip's cut: the largest scene row c (above the first crown) where
 * rows c-1 and c are each ONE colour across the whole width, so nothing
 * crosses the line between the slow strip and the faster picture below. */
function findCut(scene) {
  for (let c = 40; c >= 1; c--)
    if (rowUniform(scene, c - 1) && rowUniform(scene, c)) return c;
  throw new Error("the composite has no clean horizontal break above row 40");
}

const GROUND = 204;   /* LAYER_Y + 160: the forest floor's line */

function composeBackground(layers) {
  const sc = composeScene(layers);
  const cut = findCut(sc.img);
  const img = canvas(256, 232);
  for (let y = 0; y < 24; y++) for (let x = 0; x < 256; x++)
    set(img, x, y, BAR[0], BAR[1], BAR[2], 255);
  for (let y = 0; y < LAYER_Y; y++) for (let x = 0; x < 256; x++) {
    const p = px(sc.img, x, 0);
    if (y >= 24) set(img, x, y, p[0], p[1], p[2], 255);
  }
  for (let y = 0; y < 180; y++) for (let x = 0; x < 256; x++) {
    const p = px(sc.img, x, y);
    set(img, x, LAYER_Y + y, p[0], p[1], p[2], 255);
  }
  for (let y = 224; y < 232; y++) for (let x = 0; x < 256; x++)
    set(img, x, y, BAR[0], BAR[1], BAR[2], 255);
  for (let d = 0; d < 10; d++) glyph(img, String(d), (1 + d) * 8, 224);
  const label = (text, col) => {
    for (let i = 0; i < text.length; i++) glyph(img, text[i], (col + i) * 8, 8);
  };
  label("TIME", 1);
  label("SCORE", 17);
  for (const c of [6, 7, 8, 23, 24, 25]) glyph(img, "0", c * 8, 8);
  img.cut = LAYER_Y + cut;       /* the strip's last line + 1 */
  img.windows = sc.windows;
  return img;
}

/* The control: card #128's banded build, kept so a test can show it fails
 * "no tree crosses a band edge" where the new one passes.  Three horizontal
 * bands from the three layers, each through its own window, over a fill. */
const BAND = {
  far:  { layer: 0, x0: 29, srcY: 8,  dstY: 24,  h: 48 },
  mid:  { layer: 1, x0: 9,  srcY: 30, dstY: 72,  h: 56 },
  near: { layer: 2, x0: 10, srcY: 84, dstY: 128, h: 96 },
};
const NEAR_FILL = [38, 30, 54];

function composeBandedBackground(layers) {
  const img = canvas(256, 224);
  const sky = (x) => px(layers[0], BAND.far.x0 + x, BAND.far.srcY + BAND.far.h - 1);
  for (let y = 0; y < 24; y++) for (let x = 0; x < 256; x++)
    set(img, x, y, BAR[0], BAR[1], BAR[2], 255);
  for (const key of ["far", "mid", "near"]) {
    const b = BAND[key];
    for (let y = 0; y < b.h; y++) for (let x = 0; x < 256; x++) {
      const p = px(layers[b.layer], b.x0 + x, b.srcY + y);
      if (p[3] >= 128) set(img, x, b.dstY + y, p[0], p[1], p[2], 255);
      else if (key === "near") set(img, x, b.dstY + y,
                                   NEAR_FILL[0], NEAR_FILL[1], NEAR_FILL[2], 255);
      else { const f = sky(x); set(img, x, b.dstY + y, f[0], f[1], f[2], 255); }
    }
  }
  img.edges = [BAND.mid.dstY, BAND.near.dstY];   /* the band edges inside the picture */
  return img;
}

/* A band edge is clean when the rows on both sides are one colour across the
 * width, i.e. no tree is cut by it. */
function edgeClean(img, y) { return rowUniform(img, y - 1) && rowUniform(img, y); }

/* ---- the character: eight 32x64 frames --------------------------------- *
 * Each 56x56 sheet cell is cropped to the same 32x40 window (x 12..43,
 * y 16..55) and placed 24 rows down a 32x64 cell, so every frame's feet are
 * on the cell's bottom row and the run cycle does not bob.  Frames, in the
 * order the toy's PLY table names them: run 1..6 (sheet row 3), jump (row 4
 * col 3), fall (row 4 col 1). */
const CHAR_FRAMES = [
  [2, 0], [2, 1], [2, 2], [2, 3], [2, 4], [2, 5],
  [3, 2], [3, 0],
];

function composeCharacter(sheet) {
  const n = CHAR_FRAMES.length;
  const img = canvas(32 * n, 64);
  for (let i = 0; i < n; i++) {
    const [row, col] = CHAR_FRAMES[i];
    for (let y = 0; y < 40; y++) for (let x = 0; x < 32; x++) {
      const p = px(sheet, col * 56 + 12 + x, row * 56 + 16 + y);
      if (p[3] >= 128) set(img, i * 32 + x, 24 + y, p[0], p[1], p[2], 255);
    }
  }
  return img;
}

/* ---- the props: two rocks and the sign, each in a 32x32 cell ----------- *
 * Rocks sit on the cell's bottom row; the sign's post does too, so the toy
 * can place both with their bottoms on the ground line. */
const PROPS = [
  { file: "decorations/rock_1.png", dx: 6, dy: 20 },
  { file: "decorations/rock_2.png", dx: 2, dy: 19 },
  { file: "decorations/sign.png",   dx: 5, dy: 1  },
];

function composeProps(packDir) {
  const img = canvas(32 * PROPS.length, 32);
  for (let i = 0; i < PROPS.length; i++) {
    const s = loadPng(path.join(packDir, "oak_woods_v1.0", PROPS[i].file));
    for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
      const p = px(s, x, y);
      if (p[3] >= 128) set(img, i * 32 + PROPS[i].dx + x, PROPS[i].dy + y,
                           p[0], p[1], p[2], 255);
    }
  }
  return img;
}

/* ---- the art as the studio's files (#156) --------------------------------
 * One background import and two sprite imports become the ONE picture the
 * #117 importer loads: tiles.json from the background, palettes.json with
 * the background's rows and the two imports' sprite rows, sprites.json with
 * the player's then the props' patterns.  The toy drives the SAT itself, so
 * sprites.json carries no sprites: an empty SAT at boot is the toy's own
 * parked state.  sources.json names the three sources with the ranges below,
 * the same shape the studio's ASSETS pane reads (renderer/pce-assets.js).
 *
 * The placement is the importer's, never this tool's: the merged files go
 * through renderer/pce-sat.js's pictureFromFiles and
 * renderer/pce-editor.js's patternLayout — the exact code the host runs —
 * and the resulting cells are baked into main.lua's block as PLY, ROCK and
 * SIGNP. */

function docText(doc) { return JSON.stringify(doc, null, 2) + "\n"; }

function mergedDocs(bgRes, charRes, propsRes) {
  const bgPal = JSON.parse(bgRes.files["palettes.json"]);
  const spriteRows = charRes.palettes.concat(propsRes.palettes);
  while (spriteRows.length < 16) spriteRows.push(new Array(16).fill(0));
  const nChar = charRes.palettes.length, nProps = propsRes.palettes.length;
  const palDoc = { version: 1, backdrop: bgRes.backdrop,
                   background: bgPal.background, sprites: spriteRows };
  const sprDoc = { version: 1,
                   patterns: charRes.patterns.concat(propsRes.patterns),
                   sprites: [] };
  const sources = [
    { name: "forest", kind: "bg",
      tiles: { first: 0, count: bgRes.stats.tiles }, map: true,
      palettes: { side: "bg", first: 0, count: bgRes.stats.palettes } },
    { name: "player", kind: "sprites",
      patterns: { first: 0, count: charRes.patterns.length },
      sprites: { first: 0, count: 1 },
      palettes: { side: "spr", first: 0, count: nChar } },
    { name: "props", kind: "sprites",
      patterns: { first: charRes.patterns.length, count: propsRes.patterns.length },
      sprites: { first: 1, count: 5 },
      palettes: { side: "spr", first: nChar, count: nProps } },
  ];
  return {
    tilesText: bgRes.files["tiles.json"],
    palettesText: docText(palDoc),
    spritesText: docText(sprDoc),
    sourcesText: docText({ version: 1, sources: sources }),
    nBg: bgRes.stats.palettes, nChar: nChar, nProps: nProps,
    tilesCount: bgRes.stats.tiles,
    patternCount: charRes.patterns.length + propsRes.patterns.length,
  };
}

/* the importer's own placement of the merged picture: the cells each pattern
 * lands at, read through the same code the host runs at boot (#117) */
function placement(docs) {
  const satM = require("../renderer/pce-sat.js");
  const edM = require("../renderer/pce-editor.js");
  const files = [
    { name: "tiles.json", source: docs.tilesText },
    { name: "palettes.json", source: docs.palettesText },
    { name: "sprites.json", source: docs.spritesText },
  ];
  const pic = satM.pictureFromFiles(files);
  const layout = edM.patternLayout(pic);
  edM.toPicture(pic);   /* refuse here, as the host would, if it cannot fit */
  return layout;
}

/* ---- the block the playable main.lua carries ---------------------------- */

function luaBlock(built) {
  const d = built.docs, codes = built.codes;
  const L = [];
  const push = (s) => L.push(s);
  push(OPEN + " — generated by tools/oak-woods-art.js; do not edit");
  push("-- Oak Woods v1.0 by Brullov (brullov.art), imported by the #123");
  push("-- importer (renderer/pce-source.js) into tiles.json, palettes.json,");
  push("-- sprites.json and sources.json beside this file — NOT in the");
  push("-- repository (docs/DECISIONS.md, 2026-10-29).  The #117 importer");
  push("-- puts the picture into VRAM, CRAM and the SAT before init() runs,");
  push("-- so art_boot() has nothing to do; the numbers below are the");
  push("-- importer's own placement, read back through pce-editor.js's");
  push("-- patternLayout.");
  push("-- " + d.tilesCount + " background tiles, " + d.nBg + " background" +
       " palettes, " + d.patternCount + " sprite patterns in " +
       (d.nChar + d.nProps) + " sprite palettes.");
  const nPat = built.charRes.patterns.length;   /* player patterns */
  const nChar = d.nChar;                        /* sprite palette rows */
  push("");
  push("PLY = {" + codes.slice(0, nPat).join(", ") + "}");
  push("PLY_PAL = {" + built.charRes.sprites.map((s) => s.palette).join(", ") + "}");
  push("ROCK = {" + codes.slice(nPat, nPat + 2).join(", ") + "}");
  push("ROCK_PAL = {" + built.propsRes.sprites.slice(0, 2)
    .map((s) => s.palette + nChar).join(", ") + "}");
  push("SIGNP = " + codes[nPat + 2]);
  push("SIGN_PAL = " + (built.propsRes.sprites[2].palette + nChar));

  /* the digit tiles: cells 1..10 of the glyph row (row 28) */
  /* the importer's tiles[] is indexed by char - $40, not by char */
  const tileAt = (ch) => built.bgRes.tiles[ch - 0x40];
  const digitChars = [], digitPal = [];
  for (let d = 0; d < 10; d++) {
    const cell = 28 * 32 + 1 + d;
    const ch = built.bgRes.map[cell];
    digitChars.push(ch);
    digitPal.push(tileAt(ch).palette);
  }
  push("DIGIT_CHARS = {" + digitChars.join(", ") + "}");
  push("DIGIT_PAL = {" + digitPal.join(", ") + "}");
  push("HUD_TIME = {" + [6, 7, 8].map((c) => 32 + c).join(", ") + "}");
  push("HUD_SCORE = {" + [23, 24, 25].map((c) => 32 + c).join(", ") + "}");
  push("GROUND = " + GROUND);
  push("START_X = 96");
  push("SKY_LINE = 24");
  push("MAIN_LINE = " + built.bgImg.cut);
  push("LEVEL_LEN = 1440");
  push("GOAL_X = 1400");
  push("ROCK_X = {240, 520, 900, 1240}");

  push("");
  push("function art_boot()");
  push("  -- the picture is #117's import: tiles, palettes and sprite patterns");
  push("  -- are already in VRAM, CRAM and the SAT when this runs");
  push("end");
  push(CLOSE + " — do not edit above this line");
  return L.join("\n") + "\n";
}

/* ---- the import -------------------------------------------------------- */
function build(opts) {
  opts = opts || {};
  const pack = opts.pack || process.env.OAK_WOODS_PACK || DEFAULT_PACK;
  if (!fs.existsSync(pack)) {
    return { skip: "the Oak Woods pack is not at " + pack +
      " (set OAK_WOODS_PACK or --pack); no art can be imported" };
  }
  const dir = extract(pack);
  const base = path.join(dir, "oak_woods_v1.0");
  const layers = [1, 2, 3].map((n) =>
    loadPng(path.join(base, "background", "background_layer_" + n + ".png")));

  const bgImg = composeBackground(layers);
  const bgRes = src.importImage(bgImg, { kind: "bg", name: "oak-woods-bg",
                                         alphaThreshold: 128, dither: "none" });
  const charImg = composeCharacter(loadPng(path.join(base, "character", "char_blue.png")));
  const charRes = src.importImage(charImg, { kind: "sprites", size: [32, 64],
                                             name: "oak-woods-player",
                                             alphaThreshold: 128, dither: "none",
                                             maxPalettes: 8 });
  const propsImg = composeProps(dir);
  const propsRes = src.importImage(propsImg, { kind: "sprites", size: [32, 32],
                                               name: "oak-woods-props",
                                               alphaThreshold: 128, dither: "none",
                                               maxPalettes: 6 });

  const docs = mergedDocs(bgRes, charRes, propsRes);
  const layout = placement(docs);
  const codes = layout.codes;
  const vram = {
    bat: 1024, tiles: docs.tilesCount * 16,
    sprites: layout.cellCount * 64,
    spriteBase: layout.firstCell * 64,
    end: layout.endCell * 64,
    total: Math.max(1024 + docs.tilesCount * 16, layout.endCell * 64),
  };

  const built = { dir, layers, bgImg, bgRes, charImg, charRes, propsImg, propsRes,
                  docs, codes, layout,
                  bandedImg: composeBandedBackground(layers),
                  vram };
  built.block = luaBlock(built);
  return built;
}

/* ---- writing ----------------------------------------------------------- */

function splice(source, block) {
  const open = source.indexOf(OPEN);
  const close = source.search(/-- <<< PCEStudio demo art[^\n]*\n?/);
  if (open < 0 || close < 0 || close < open)
    throw new Error("main.lua has no '" + OPEN + "' … '" + CLOSE + "' block");
  const before = source.slice(0, open).replace(/\n+$/, "");
  const after = source.slice(close).replace(/-- <<< PCEStudio demo art[^\n]*\n?/, "")
                      .replace(/^\n+/, "");
  return before + "\n\n" + block + "\n" + after;
}

function pngOf(img) {
  /* a minimal PNG writer: 8-bit RGBA, one zlib stream */
  const raw = Buffer.alloc((img.width * 4 + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    raw[y * (img.width * 4 + 1)] = 0;
    Buffer.from(img.rgba.buffer, y * img.width * 4, img.width * 4)
      .copy(raw, y * (img.width * 4 + 1) + 1);
  }
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc = (buf) => {
    let c = 0xFFFFFFFF;
    for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const cb = Buffer.alloc(4); cb.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cb]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0); ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))]);
}

const LICENCE = `The Oak Woods pack's readme.TXT, quoted in full (it is a purchase
thank-you: the pack carries **no licence text**, no archive comment, and no
rights metadata in any PNG's XMP):

> Thank you for purchasing this asset pack! Please note that all next updates
> of this pack are free for you.
>
> If you find this asset useful, please rate it on itch! Thanks!
>
> Contact:
>
> If you have any questions regarding this asset pack you can contact me here:
>
> E-Mail: brullov.ad@gmail.com
> Twitter: https://twitter.com/brullov_art
>
> If you want to support me, get access to my private Discord server where you
> can suggest asset improvements, check my Patreon.
>
> https://www.patreon.com/brullov
>
> Price will increase with asset's updates.
>
> Check the guide.png for useful info about how to use animations properly.

Dennis bought the pack (2026-10-29). docs/DECISIONS.md, 2026-10-29 ("About the
artwork don't put it on the repo but it's fine as demo on the website"): no pack
art and nothing converted from it is committed; it lives here, beside the repo,
and \`tools/deploy.sh\` uploads it with the toy.  Credit: **Oak Woods v1.0 by
Brullov (brullov.art)**.

The player character is the separate generic_char_v0.2 pack (same author,
brullov.ad@gmail.com), which does carry a licence:

> You can use it for free or commercial product.
> You can modify it.
> You MUSTN'T redistribute or resell it.
> You MUSTN'T use the assets in any printed media or physical product.
`;

const FIT = `# Oak Woods on the PC Engine — the fit.

Measured by \`node tools/oak-woods-art.js\` from the pack itself, through
renderer/pce-source.js:

| what | measured | the PCE |
|---|---|---|
| background colours per 8x8 tile | max 7 (all three layers) | 15 + transparent |
| background colours overall | 25 across the three layers; the composed bands fit in the importer's palettes | 16 palettes x 16 |
| character colours per frame | 14–18 (21 across the sheet) | 15 + transparent per 16-colour sprite palette; the importer fits each frame, approximating the few colours past 15 |
| character frame | 32x40 content in a 56x56 cell | one 32x64 sprite (CGX + CGY=3) |
| rocks | 20x11 and 27x12 | one 32x32 sprite each |
| sign | 22x31 | one 32x32 sprite |

The background is **one** plane (card #150, replacing #128's three bands, whose
edges sliced every tree that crossed them).  Layers 1 and 2 and the forest floor
are ONE composite that loops at the 32-cell BAT's 256 px (each layer read
through the window whose seam is cheapest) and scrolls at the ground's speed.
The strip above the first crown is cut where the composite is one flat colour
across the whole width, so no tree crosses the cut, and the RCR line interrupt
gives it a slower BXR.  Layer 3's front trunks and canopy are left out (card
#150: sprite trunks were tried and Dennis asked for them gone).

The character's 18-colour frames are **fitted**: the importer's palette planner
puts each frame in one 16-colour sprite palette and maps the colours that do not
fit to the nearest of the 15 — the only place the art is lossy, and it is the
#123 importer's own fitting, not a hand edit.
`;

/* Every file the tool writes, for writeAll and --check alike. */
function outputs(built) {
  const out = {};
  out["main.lua"] = splice(fs.readFileSync(TOY, "utf8"), built.block);
  out["tiles.json"] = built.docs.tilesText;
  out["palettes.json"] = built.docs.palettesText;
  out["sprites.json"] = built.docs.spritesText;
  out["sources.json"] = built.docs.sourcesText;
  out["background.png"] = pngOf(built.bgImg);
  out["character.png"] = pngOf(built.charImg);
  out["props.png"] = pngOf(built.propsImg);
  const report = {
    pack: "oak_woods_v1.0.zip",
    credit: "Oak Woods v1.0 by Brullov (brullov.art)",
    character: "generic_char_v0.2 by Brullov (brullov.art)",
    background: built.bgRes.stats,
    player: built.charRes.stats,
    props: built.propsRes.stats,
    windows: { far: built.bgImg.windows.far, mid: built.bgImg.windows.mid,
               ground: built.bgImg.windows.ground },
    skyCut: built.bgImg.cut,
    placement: { codes: built.codes, firstCell: built.layout.firstCell,
                 endCell: built.layout.endCell },
    vram: built.vram,
    sources: JSON.parse(built.docs.sourcesText).sources,
    warnings: [].concat(built.bgRes.warnings, built.charRes.warnings,
                        built.propsRes.warnings),
    ground: GROUND,
  };
  out["art.json"] = JSON.stringify(report, null, 2) + "\n";
  out["README.md"] =
    "# OAK WOODS — the demo's art (card #128)\n\n" +
    "This folder is the pack's art, converted for the PC Engine by\n" +
    "`tools/oak-woods-art.js` through the #123 importer. It is **not in the\n" +
    "repository** (docs/DECISIONS.md, 2026-10-29).  The art is the studio's\n" +
    "own file shapes (card #156): `tiles.json`, `palettes.json` and\n" +
    "`sprites.json` are the picture the #117 importer loads before the toy\n" +
    "runs, `sources.json` names the three sources for the studio's ASSETS\n" +
    "pane, and `main.lua` is the playable file — toys/oak-woods/main.lua with\n" +
    "its placeholder picture replaced by a block of the importer's placement\n" +
    "numbers (no VRAM or CRAM writes; the import is the art).\n\n" +
    "## Licence\n\n" + LICENCE + "\n## Fit\n\n" + FIT + "\n" +
    "## Tools\n\n```sh\nnode tools/oak-woods-art.js           # rebuild this folder\n" +
    "node tools/oak-woods-art.js --check   # is it current?\n```\n";
  return out;
}

function writeAll(built) {
  fs.mkdirSync(OUT, { recursive: true });
  for (const name of Object.keys(outputs(built)))
    fs.writeFileSync(path.join(OUT, name), outputs(built)[name]);
  return outputs(built)["main.lua"];
}

/* ---- main -------------------------------------------------------------- */
function main(argv) {
  const at = argv.indexOf("--pack");
  const pack = at >= 0 ? argv[at + 1] : undefined;
  const check = argv.indexOf("--check") >= 0;
  const playablePath = path.join(OUT, "main.lua");

  if (check) {
    if (!fs.existsSync(playablePath)) {
      console.log("SKIP  no demo-art/oak-woods in this clone — " +
                  "the art is not committed (docs/DECISIONS.md); " +
                  "run node tools/oak-woods-art.js to build it");
      return 0;
    }
    const built = build({ pack });
    if (built.skip) { console.log("SKIP  " + built.skip); return 0; }
    let bad = 0;
    for (const name of Object.keys(outputs(built))) {
      const want = outputs(built)[name];
      const file = path.join(OUT, name);
      if (!fs.existsSync(file) || fs.readFileSync(file).toString() !== String(want)) {
        bad++;
        console.log("FAIL  demo-art/oak-woods/" + name + " is not what " +
                    "tools/oak-woods-art.js writes (re-run it)");
      }
    }
    if (bad) return 1;
    console.log("PASS  demo-art/oak-woods is the tool's output (" +
                Object.keys(outputs(built)).length + " files)");
    return 0;
  }

  const built = build({ pack });
  if (built.skip) { console.error(built.skip); return 1; }
  writeAll(built);
  const v = built.vram;
  console.log("wrote " + OUT);
  console.log("  background " + built.bgRes.stats.tiles + " tiles, " +
              built.bgRes.stats.palettes + " palettes, max " +
              built.bgRes.stats.maxTileColours + " colours/tile");
  console.log("  player " + built.charRes.patterns.length + " frames (32x64), " +
              built.charRes.stats.palettes + " palettes");
  console.log("  sky strip cut at line " + built.bgImg.cut);
  console.log("  props " + built.propsRes.patterns.length + " patterns (32x32), " +
              built.propsRes.stats.palettes + " palettes");
  console.log("  patterns at cells " + built.layout.firstCell + "-" +
              (built.layout.endCell - 1) + " (the #117 importer's placement)");
  console.log("  sources.json: forest (bg), player (sprites), props (sprites)");
  console.log("  VRAM words: BAT 1024 + tiles " + v.tiles + " + sprites " +
              v.sprites + " = " + v.total + " of 32768");
  for (const w of [].concat(built.bgRes.warnings, built.charRes.warnings,
                            built.propsRes.warnings)) console.log("  warning: " + w);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { build, splice, mergedDocs, placement, outputs,
                   composeBackground, composeBandedBackground, composeCharacter,
                   composeProps, edgeClean, rowUniform, seamCost, GROUND, BAND };
