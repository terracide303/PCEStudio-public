#!/usr/bin/env node
/*
 * tools/demo-game-assets.js — the art bridge for toys/demo-game (card #88).
 *
 * THE SHORTFALL THIS EXISTS TO WORK AROUND: the SCREEN (#84), SPRITES (#86)
 * and PALETTES (#85) panels edit the toy's tiles.json / sprites.json /
 * palettes.json, and the studio saves and reopens them — but nothing loads
 * them into a running toy.  There is no asset importer (#117); docs/STUDIO.md
 * says so under "What it edits is the toy's assets, not the running frame".
 * A person building a game in the studio can draw the picture in the panels
 * and then cannot use it.
 *
 * So this tool is the bridge a person would need: it builds the picture by
 * calling renderer/pce-editor.js's own public API — the calls a panel click
 * makes, not a second model — writes it to the three asset files the panels
 * read, and rewrites the generated block inside main.lua between its two
 * markers with the same picture as VRAM/palette writes the toy itself makes.
 * Re-run it after editing the panels and the toy draws what the panels show.
 *
 *   node tools/demo-game-assets.js          rebuild the assets and the block
 *   node tools/demo-game-assets.js --check   exit 1 if main.lua's block or the
 *                                            asset files are not what the tool
 *                                            writes (what tests/check-demo-game.js
 *                                            runs, so the picture cannot drift)
 *
 * It writes, under toys/demo-game/:
 *   tiles.json, palettes.json, sprites.json   the panels' picture
 *   main.lua                                  its generated art block
 *   demo-game.pce.json                        the studio envelope (Open… →
 *                                             From file… opens the code and
 *                                             the three assets beside it)
 *
 * The art itself is authored here (there is no binary art file to lose):
 * every tile, pattern and palette entry below is the picture.  Hand-drawing
 * it in the panels and copying it back means retyping this file; that is the
 * other half of the missing importer, and it is on the card as a shortfall.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const ed = require("../renderer/pce-editor.js");
const screen = require("../renderer/pce-screen.js");
const sat = require("../renderer/pce-sat.js");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "toys", "demo-game");
const OPEN = "-- >>> PCEStudio demo art";
const CLOSE = "-- <<< PCEStudio demo art";
const CLOSE_RE = /-- <<< PCEStudio demo art[^\n]*\n?/;

function rgb(r, g, b) { return ed.colourWord(r, g, b); }

/* ---- the picture ------------------------------------------------------- *
 * Authored the way the panels author it: a tile is an 8x8 grid of 4-bit
 * colour numbers, a pattern is a 16x16 grid of them, a palette row maps a
 * colour number to one of the VCE's 512 nine-bit colours.  The map is the
 * 32x32 BAT a SCREEN user would paint. */

const C_BAR = rgb(0, 0, 1);        /* the status bar's backdrop: near-black */
const C_FIELD = rgb(0, 0, 3);      /* the playfield's: the same blue, lit */

/* The background palette (0): the starfield's five shades. */
const BG = {
  backdrop: C_BAR,
  1: rgb(0, 0, 3),                 /* dust */
  2: rgb(3, 3, 5),                 /* a dim star */
  3: rgb(5, 5, 7),                 /* a mid star */
  4: rgb(7, 7, 7),                 /* a bright star */
  5: rgb(1, 1, 5),                 /* a star's halo */
};

/* The sprite palettes: 0 the ship, 1 the HUD, 2 the drones, 3 the shots.
 * Pixel 0 of a pattern is transparent. */
const SPRITE_PALETTES = [
  { 1: rgb(4, 7, 7), 2: rgb(2, 5, 6), 3: rgb(7, 7, 7), 4: rgb(1, 2, 4) },
  { 1: rgb(7, 7, 5), 2: rgb(7, 4, 2), 3: rgb(3, 3, 3) },
  { 1: rgb(7, 2, 2), 2: rgb(5, 1, 4), 3: rgb(7, 5, 3), 4: rgb(4, 0, 1) },
  { 1: rgb(7, 7, 3), 2: rgb(7, 7, 7), 3: rgb(5, 4, 0) },
];

/* 8x8 tiles, as rows of colour numbers (0 = transparent).  A tile is drawn
 * at 1x and must read at 1x: one pixel is the smallest a star can be. */
const TILES = {
  blank: [ /* the empty space tile: the backdrop shows through */
    "00000000", "00000000", "00000000", "00000000",
    "00000000", "00000000", "00000000", "00000000",
  ],
  star_dim: [
    "00000000", "00000000", "00000000", "00030000",
    "00000000", "00000000", "00000000", "00000000",
  ],
  star_mid: [
    "00000000", "00000000", "00003000", "00033000",
    "00000000", "00000000", "00000000", "00000000",
  ],
  star_bright: [
    "00000000", "00004000", "00044400", "00444440",
    "00044400", "00004000", "00000000", "00000000",
  ],
  dust: [
    "10000000", "00000010", "00100000", "00000000",
    "00000100", "00000000", "01000000", "00010000",
  ],
};

/* 16x16 sprite patterns.  '.' is transparent; 1..4 are the palette's
 * colour numbers.  The ship is 14 wide and 12 tall, centred so its cell
 * and its art agree; the drone is a wide bug; the shot is a 2x6 bolt; the
 * heart is the life icon. */
const PATTERNS = {
  ship: [
    "................",
    ".......11.......",
    "......1221......",
    "......1221......",
    ".....123321.....",
    ".....123321.....",
    "....12333321....",
    "....12333321....",
    "...1233333321...",
    "...1233333321...",
    "..123334433321..",
    "..123344443321..",
    "..113344443311..",
    "...1.144441.1...",
    "......1..1......",
    "................",
  ],
  drone: [
    "................",
    "................",
    "....1111111.....",
    "...122222221....",
    "..12233332221...",
    ".1223333332221..",
    ".1233311333321..",
    ".1233111133321..",
    ".1233111133321..",
    ".1233311333321..",
    ".1223333332221..",
    "..12233332221...",
    "...122222221....",
    "....1111111.....",
    "................",
    "................",
  ],
  bolt: [
    "................",
    "................",
    "................",
    "................",
    ".......11.......",
    ".......21.......",
    ".......21.......",
    ".......21.......",
    ".......21.......",
    ".......21.......",
    ".......11.......",
    "................",
    "................",
    "................",
    "................",
    "................",
  ],
  heart: [
    "................",
    "................",
    "................",
    "................",
    "................",
    "....11..11......",
    "...12211321.....",
    "...12222221.....",
    "...12222221.....",
    "....122221......",
    ".....1221.......",
    "......11........",
    "................",
    "................",
    "................",
    "................",
  ],
};

/* The score digits, 3x5 each, drawn 2x into a 16x16 pattern at (5,3): a
 * 6x10 glyph, the size a 16x16 cell wants for a HUD numeral. */
const DIGITS = [
  ["111", "101", "101", "101", "111"],
  ["010", "110", "010", "010", "111"],
  ["111", "001", "111", "100", "111"],
  ["111", "001", "111", "001", "111"],
  ["101", "101", "111", "001", "001"],
  ["111", "100", "111", "001", "111"],
  ["111", "100", "111", "101", "111"],
  ["111", "001", "001", "001", "001"],
  ["111", "101", "111", "101", "111"],
  ["111", "101", "111", "001", "111"],
];

/* Where the stars are.  The SCREEN panel's map is a painted thing, not a
 * formula: these are the cells a person would click.  Everything else is
 * the blank tile, which is what makes the block in main.lua compress. */
const STARS = [
  [3, 0, "star_mid"], [17, 0, "star_dim"], [26, 1, "star_bright"],
  [9, 2, "star_dim"], [30, 3, "star_mid"], [1, 4, "star_bright"],
  [14, 5, "star_dim"], [23, 6, "star_mid"], [6, 7, "star_dim"],
  [28, 8, "star_bright"], [11, 9, "star_mid"], [19, 10, "star_dim"],
  [2, 11, "star_mid"], [31, 12, "star_dim"], [8, 13, "star_bright"],
  [16, 14, "star_dim"], [25, 15, "star_mid"], [4, 16, "star_dim"],
  [12, 17, "star_bright"], [29, 18, "star_mid"], [7, 19, "star_dim"],
  [21, 20, "star_mid"], [0, 21, "star_dim"], [15, 22, "star_bright"],
  [27, 23, "star_dim"], [10, 24, "star_mid"], [22, 25, "star_dim"],
  [5, 26, "star_bright"], [18, 27, "star_mid"], [30, 28, "star_dim"],
  [13, 29, "star_mid"], [24, 30, "star_dim"], [2, 31, "star_bright"],
];

/* The galaxy lane: four rows of dust, the one place the starfield is dense.
 * It is what makes the scroll visible even on a still frame strip. */
const DUST_ROWS = [10, 11, 12, 13];

/* The sprite slots, in SAT order (the same order the game's comment lists
 * them).  Positions are the picture's 0..223 display coordinates; the tool
 * adds the SAT's +64 when it writes the toy. */
const SPRITES = [
  /* slot 0 is the player: the VDC's CC flag is sprite #0 against every other
   * sprite, and the game reads it with sr() (card #119) */
  { slot: "player", x: 120, y: 160, pattern: "ship", palette: 0 },
  { slot: "digit_h", x: 196, y: 4, pattern: "digit0", palette: 1 },
  { slot: "digit_t", x: 210, y: 4, pattern: "digit0", palette: 1 },
  { slot: "digit_o", x: 224, y: 4, pattern: "digit0", palette: 1 },
  { slot: "life1", x: 8, y: 4, pattern: "heart", palette: 1 },
  { slot: "life2", x: 24, y: 4, pattern: "heart", palette: 1 },
  { slot: "life3", x: 40, y: 4, pattern: "heart", palette: 1 },
  { slot: "enemy0", x: 32, y: 40, pattern: "drone", palette: 2 },
  { slot: "enemy1", x: 96, y: 48, pattern: "drone", palette: 2 },
  { slot: "enemy2", x: 160, y: 40, pattern: "drone", palette: 2 },
  { slot: "enemy3", x: 208, y: 56, pattern: "drone", palette: 2 },
  { slot: "enemy4", x: 64, y: 72, pattern: "drone", palette: 2 },
  { slot: "enemy5", x: 144, y: 88, pattern: "drone", palette: 2 },
  { slot: "bullet0", x: 0, y: 240, pattern: "bolt", palette: 3 },
  { slot: "bullet1", x: 0, y: 240, pattern: "bolt", palette: 3 },
  { slot: "bullet2", x: 0, y: 240, pattern: "bolt", palette: 3 },
  { slot: "bullet3", x: 0, y: 240, pattern: "bolt", palette: 3 },
];

/* ---- building the picture --------------------------------------------- */

function paintRows(pic, char, rows, colourOf) {
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (ch === "." || ch === "0") continue;
      const v = colourOf ? colourOf(ch) : parseInt(ch, 10);
      ed.paintTileIndex(pic, char, x, y, v);
    }
  }
}

function buildPicture() {
  const pic = ed.newPicture();
  ed.setBackdrop(pic, BG.backdrop);
  for (const key of Object.keys(BG)) {
    if (key === "backdrop") continue;
    ed.setPaletteColour(pic, 0, Number(key), BG[key]);
  }
  for (let p = 0; p < SPRITE_PALETTES.length; p++) {
    for (const key of Object.keys(SPRITE_PALETTES[p])) {
      ed.setSpritePaletteColour(pic, p, Number(key), SPRITE_PALETTES[p][key]);
    }
  }

  /* Tiles: char $40 is the blank tile newPicture already made. */
  const chars = { blank: ed.FIRST_CHAR };
  let blank = true;
  for (const name of Object.keys(TILES)) {
    const char = blank ? ed.FIRST_CHAR : ed.newTile(pic, 0);
    blank = false;
    chars[name] = char;
    paintRows(pic, char, TILES[name]);
  }

  /* The BAT: dust lanes, then the stars on top. */
  for (const row of DUST_ROWS)
    for (let col = 0; col < 32; col++)
      ed.paintMapCell(pic, col, row, chars.dust);
  for (const [col, row, tile] of STARS)
    ed.paintMapCell(pic, col, row, chars[tile]);

  /* Sprite patterns: the ten digits, then the ship, drone, bolt and heart.
   * The order is the SAT's pattern numbering, and the ten digit codes become
   * the DIGIT table in the generated block so the game can look one up
   * (see main.lua; card #118 made the table readable). */
  const patterns = {};
  for (let d = 0; d < 10; d++) {
    const p = ed.newSpritePattern(pic, 16, 16);
    patterns["digit" + d] = p;
    for (let gy = 0; gy < 5; gy++)
      for (let gx = 0; gx < 3; gx++)
        if (DIGITS[d][gy][gx] === "1")
          for (let sy = 0; sy < 2; sy++)
            for (let sx = 0; sx < 2; sx++)
              ed.paintSpriteIndex(pic, p, 5 + gx * 2 + sx, 3 + gy * 2 + sy, 1);
  }
  for (const name of ["ship", "drone", "bolt", "heart"]) {
    const p = ed.newSpritePattern(pic, 16, 16);
    patterns[name] = p;
    const rows = PATTERNS[name];
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const ch = rows[y][x];
        if (ch === ".") continue;
        ed.paintSpriteIndex(pic, p, x, y, parseInt(ch, 10));
      }
  }

  /* The SAT, in the game's slot order.  Priority 0 (SPBG clear) so the
   * sprites draw in front of the background — the toy host's default. */
  for (const s of SPRITES) {
    /* a slot past the picture's 224 lines is the panel's "parked" slot: the
     * editor has no y for it, so it is added at the top and parked, the same
     * two clicks the SPRITES panel's Park button makes */
    const parked = s.y >= ed.PARK_ROW;
    ed.addSprite(pic, {
      x: s.x, y: parked ? 0 : s.y, pattern: patterns[s.pattern],
      palette: s.palette, priority: 0,
    });
    if (parked) ed.parkSprite(pic, pic.sprites.length - 1);
  }
  return pic;
}

/* ---- the picture as files --------------------------------------------- */

function assetFiles(pic) {
  const files = [
    { name: "tiles.json", source: "" },
    { name: "palettes.json", source: "" },
    { name: "sprites.json", source: "" },
  ];
  screen.syncFiles(pic, files);          /* tiles.json + palettes.json */
  sat.syncFiles(pic, files);             /* sprites.json + palettes.json */
  return files;
}

/* ---- the picture as Lua ------------------------------------------------ */

function hex16(word) { return "0x" + (word & 0xFFFF).toString(16).toUpperCase().padStart(4, "0"); }

function tileWords(pic, char) {
  const t = pic.tiles[char];
  const out = [];
  for (let y = 0; y < 8; y++) {
    let lo = 0, hi = 0, lo2 = 0, hi2 = 0;
    for (let x = 0; x < 8; x++) {
      const v = t.pixels[y * 8 + x];
      const bit = 7 - x;
      if (v & 1) lo |= 1 << bit;
      if (v & 2) hi |= 1 << bit;
      if (v & 4) lo2 |= 1 << bit;
      if (v & 8) hi2 |= 1 << bit;
    }
    out.push(lo | (hi << 8));          /* word y: planes 0 and 1 */
    out.push(lo2 | (hi2 << 8));        /* word y+8: planes 2 and 3 */
  }
  /* tileWords is row-major here; the VDC wants plane pairs, so fold:
   * [row0][row1]..[row7] then [row0 hi][row1 hi].. */
  const words = [];
  for (let y = 0; y < 8; y++) words.push(out[y * 2]);
  for (let y = 0; y < 8; y++) words.push(out[y * 2 + 1]);
  return words;
}

/* The sprite patterns' words, exactly renderer/pce-editor.js's
 * writeSpritePattern: cell base, block, half, plane k at +16k, row, bit 15
 * the strip's leftmost pixel.  All the game's patterns are 16x16. */
function patternWords(pic, index, base) {
  const pat = pic.spritePatterns[index];
  const words = [];
  for (let k = 0; k < 4; k++) {
    for (let row = 0; row < pat.height; row++) {
      let word = 0;
      for (let xin = 0; xin < pat.width; xin++)
        if (pat.pixels[row * pat.width + xin] & (1 << k))
          word |= 1 << (15 - xin);
      words.push({ addr: base * 64 + k * 16 + row, word: word });
    }
  }
  return words;
}

function luaBlock(pic) {
  const layout = ed.patternLayout(pic);
  const lines = [];
  const push = (s) => lines.push(s);

  push(OPEN + " — generated by tools/demo-game-assets.js; do not edit");
  push("-- The SCREEN, SPRITES and PALETTES panels' picture, written into the");
  push("-- toy's own VRAM and CRAM.  There is no asset importer yet (#117);");
  push("-- block is the bridge.  Edit the panels, then run the tool.");
  let tileTotal = 0;
  for (let c = ed.FIRST_CHAR; c < pic.nextChar; c++) if (pic.tiles[c]) tileTotal++;
  push("-- " + tileTotal + " tiles from $" + ed.FIRST_CHAR.toString(16) +
       ", " + pic.spritePatterns.length + " sprite patterns, " +
       pic.sprites.length + " SAT slots.");

  /* Named constants the game reads. */
  const pat = {};
  for (let i = 0; i < pic.spritePatterns.length; i++) pat[i] = layout.codes[i];
  push("");
  push("C_BAR = " + BG.backdrop + "        -- the status bar's backdrop (VCE word)");
  push("C_FIELD = " + C_FIELD + "      -- the playfield's");
  const digitCodes = [];
  for (let d = 0; d < 10; d++) digitCodes.push(layout.codes[d]);
  push("DIGIT = {" + digitCodes.join(", ") + "}   -- the ten digit pattern codes (SPRITES panel)");
  push("SHIP = " + pat[10] + "   ENEMY = " + pat[11] +
       "   BULLET = " + pat[12] + "   HEART = " + pat[13]);
  const player = SPRITES.find((s) => s.slot === "player");
  push("START_PX = " + player.x + "   START_PY = " + player.y);
  let e = 0;
  for (const s of SPRITES)
    if (s.slot.startsWith("enemy"))
      push("E" + (e++) + "X0 = " + s.x + "   E" + (e - 1) + "Y0 = " + s.y);

  /* The VRAM and CRAM writes. */
  push("");
  push("function art_boot()");
  push("  -- the VCE: the backdrop and the background palette 0");
  push("  pal(0, " + BG.backdrop + ")");
  for (let p = 1; p < 16; p++)
    push("  pal(" + (p * 16) + ", " + BG.backdrop + ")   -- palette " + p +
         "'s colour 0 is the backdrop");
  for (const key of Object.keys(BG)) {
    if (key === "backdrop") continue;
    push("  pal(" + Number(key) + ", " + BG[key] + ")");
  }
  push("  -- the VCE: the sprite palettes at CRAM $100");
  for (let p = 0; p < SPRITE_PALETTES.length; p++)
    for (const key of Object.keys(SPRITE_PALETTES[p]))
      push("  pal(" + (256 + p * 16 + Number(key)) + ", " +
           SPRITE_PALETTES[p][key] + ")");

  push("  -- the tiles: character $nn at word char*16, planes 0/1 then 2/3");
  for (let char = ed.FIRST_CHAR; char < pic.nextChar; char++) {
    if (!pic.tiles[char]) continue;
    const words = tileWords(pic, char);
    push("  -- tile $" + char.toString(16));
    for (let y = 0; y < 16; y++)
      if (words[y]) push("  vram[" + (char * 16 + y) + "] = " + hex16(words[y]));
  }

  push("  -- the BAT at word 0: runs of one cell, so the map stays short");
  for (let row = 0; row < 32; row++) {
    const cells = [];
    for (let col = 0; col < 32; col++) {
      const char = pic.map[row * 32 + col];
      const pal = pic.tiles[char].palette;
      cells.push((char & 0xFFF) | ((pal & 0xF) << 12));
    }
    let col = 0;
    while (col < 32) {
      let end = col;
      while (end + 1 < 32 && cells[end + 1] === cells[col]) end++;
      if (end > col)
        push("  for c = " + col + ", " + end + " do vram[" + (row * 32) +
             " + c] = " + hex16(cells[col]) + " end");
      else
        push("  vram[" + (row * 32 + col) + "] = " + hex16(cells[col]));
      col = end + 1;
    }
  }

  push("  -- the sprite patterns at their packed cells");
  for (let i = 0; i < pic.spritePatterns.length; i++) {
    push("  -- pattern " + i + " (cell " + layout.codes[i] + ")");
    for (const w of patternWords(pic, i, layout.codes[i]))
      if (w.word) push("  vram[" + w.addr + "] = " + hex16(w.word));
  }

  push("end");

  push("");
  push("-- The SAT the SPRITES panel shows: every slot's start position.");
  push("function art_sat()");
  for (let i = 0; i < pic.sprites.length; i++) {
    const s = pic.sprites[i];
    push("  sprite(" + i + ", {x = " + s.x + ", y = " + (s.y + 64) +
         ", pattern = " + layout.codes[s.pattern] + ", palette = " +
         s.palette + "})");
  }
  push("end");
  push(CLOSE + " — do not edit above this line");
  return lines.join("\n") + "\n";
}

/* ---- writing ----------------------------------------------------------- */

function generated(pic) {
  return { block: luaBlock(pic), files: assetFiles(pic) };
}

/* Rebuild the source around the block so the result is a FIXED POINT: the
 * text above the open marker ends with exactly one blank line, the block
 * follows, and exactly one blank line separates it from the game below.
 *
 * The first version replaced a `\n?`-tolerant regex with "\n" + block + "\n",
 * which grew the blank run after the close marker by one line on every run —
 * so `--check` called a file the tool had itself just written "not the
 * tool's". That is why the tool now normalises both sides instead of
 * splicing in place. */
function splice(source, block) {
  const open = source.indexOf(OPEN);
  const close = source.search(CLOSE_RE);
  if (open < 0 || close < 0 || close < open)
    throw new Error("main.lua has no '" + OPEN + "' … '" + CLOSE + "' block");
  const before = source.slice(0, open).replace(/\n+$/, "");
  const after = source.slice(close).replace(CLOSE_RE, "").replace(/^\n+/, "");
  return before + "\n\n" + block + "\n" + after;
}

function envelope(files) {
  const doc = {
    version: "pce.studio/1",
    title: "Starfall",
    description: "The card-#88 demo game: a starfield shooter drawn in the " +
      "SCREEN, SPRITES and PALETTES panels, played with the pad, split by " +
      "the raster table and scored in sprites.",
    files: files.map((f) => ({ name: f.name, source: f.source })),
    sources: [],
  };
  return JSON.stringify(doc, null, 2) + "\n";
}

function main(argv) {
  const check = argv.includes("--check");
  const pic = buildPicture();
  const gen = generated(pic);
  const mainPath = path.join(OUT, "main.lua");
  const source = fs.readFileSync(mainPath, "utf8");
  const next = splice(source, gen.block);
  const doc = envelope(
    [{ name: "main.lua", source: next }].concat(gen.files));

  if (check) {
    const problems = [];
    if (next !== source) problems.push("main.lua's art block is not the tool's");
    for (const f of gen.files) {
      const p = path.join(OUT, f.name);
      const have = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
      if (have !== f.source) problems.push(f.name + " is not the tool's");
    }
    const env = path.join(OUT, "demo-game.pce.json");
    const haveEnv = fs.existsSync(env) ? fs.readFileSync(env, "utf8") : null;
    if (haveEnv !== doc) problems.push("demo-game.pce.json is not the tool's");
    if (problems.length) {
      process.stderr.write("demo-game assets are stale:\n  " +
        problems.join("\n  ") + "\nrun `node tools/demo-game-assets.js`\n");
      return 1;
    }
    process.stdout.write("demo-game assets are the tool's (1 main.lua block, " +
      gen.files.length + " asset files, 1 envelope)\n");
    return 0;
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(mainPath, next);
  for (const f of gen.files) fs.writeFileSync(path.join(OUT, f.name), f.source);
  fs.writeFileSync(path.join(OUT, "demo-game.pce.json"), doc);
  process.stdout.write("wrote toys/demo-game/: main.lua's art block, " +
    gen.files.map((f) => f.name).join(", ") + ", demo-game.pce.json\n");
  return 0;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { buildPicture, assetFiles, luaBlock, splice, envelope,
                   generated, TILES, PATTERNS, SPRITES, BG, C_FIELD, C_BAR };
