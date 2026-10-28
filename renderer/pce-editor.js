/*
 * pce-editor.js — PCEStudio's editor: tiles, palettes, the background map
 * (card #10), and sprite patterns, sprite palettes and the SAT (card #13).
 *
 * The picture is kept in exactly the shape the VDC holds it, so there is no
 * "editor format" to convert:
 *   - 16 background palettes of 16 colours (the VCE's 512-entry table, 9 bits
 *     each: G = 6-8, R = 3-5, B = 0-2).  Colour 0 of every palette is the
 *     shared backdrop (CRAM $000) — the hardware shows CRAM[0x000] for every
 *     pixel whose colour number is 0, whatever palette the BAT cell names.
 *   - tiles are 8x8 pixels, each a 4-bit colour number 0-15; a character is
 *     16 VRAM words.
 *   - the map is the BAT: 32x32 words (2 colours of 256x224 are the visible
 *     28 rows), each word = character code (bits 0-11) + palette (12-15).
 *   - scroll: BXR/BYR, as the config block carries them.
 *   - 16 sprite palettes of 16 colours: CRAM entries $100-$1FF.  Sprite
 *     pixel 0 is transparent, so a sprite palette's entry 0 never shows on a
 *     sprite (CRAM[$100] is the BG-off blanking fill).
 *   - a sprite PATTERN is the shape and pixels of a sprite: 16 or 32 pixels
 *     wide, 16/32/64 tall (the six CGX/CGY sizes), 4-bit colour numbers.
 *     It is stored in 64-word VRAM cells exactly like the VDC reads it
 *     (pce-sprites.js): CGX/CGY mask the pattern code's low bits and add the
 *     block/half select, so 16x32 reserves 4 cells and reads cells +0/+2,
 *     16x64 reserves 8 and reads +0/+2/+4/+6, 32-wide reads each block's
 *     left/right cell pair.  Patterns are packed after the tiles, so they can
 *     never overlap the picture's characters, and a pattern whose cells would
 *     reach the SAT at VRAM $7F00 is refused.
 *   - the SAT: up to 64 entries of 4 words (Y, X, pattern << 1,
 *     palette/SPBG/CGX/HFLIP/CGY/VFLIP), written to VRAM $7F00 where the
 *     viewer's DVSSR/SATB DMA reads it (card #14).
 *   - the line budget: the VDC collects at most 16 strips (16-px sprite
 *     columns) per display line, in SAT order; sprites past that are dropped.
 *     spriteLineBudget() reports it the way pce-sprites.js draws it.
 *
 * The editor REFUSES anything the VDC cannot show, and the refusals carry a
 * machine-readable `code` so a caller (the page, a test, the future MCP
 * server) can tell them apart:
 *   17th-colour    a tile has 16 colour numbers, 0-15; 16 and up cannot be
 *                  stored in a 4-bit pixel.  A palette has 16 colours (the
 *                  backdrop + 15 entries); a colour outside the tile's
 *                  palette would need a 17th colour in that tile.
 *   17th-palette   the BAT's palette field is 4 bits: 16 background
 *                  palettes; 16 and up cannot be named.
 *   colour-range   a VCE colour is a 9-bit code, 0-511.
 *   not-in-palette painting a colour the tile's own palette does not hold.
 *   vram-range     a character code >= 0x800 is past the 32768-word VRAM:
 *                  the write is dropped and the VDC shows colour 0, so the
 *                  editor will not write one.
 *   tile-space     the ROM layout (docs/ROM_LAYOUT.md) gives 6 tile banks =
 *                  1536 tiles.
 *   no-tile        a character code with no tile behind it.
 *   map-range / pixel-range / colour-range   out-of-range coordinates.
 *
 * Sprites (card #13) add their own refusals, each with a code:
 *   65th-sprite        the SAT has 64 entries.
 *   sprite-pattern-vram a pattern's 64-word cells would reach the SAT at
 *                      VRAM $7F00 (or run past the 32768-word VRAM).
 *   17th-colour        entry 16 of a sprite palette; a palette has 16.
 *   17th-sprite-palette  sprite palette 16; the VDC has 16.
 *   sprite-size        a size the VDC cannot draw: only 16/32 wide and
 *                      16/32/64 tall (CGX/CGY).
 *   sprite-pattern-range / sprite-pixel-range / sprite-range /
 *   sprite-palette-range / sprite-flag-range   out-of-range values.
 *
 * Scanline effects (card #17) write the #15 raster table — the per-VDW-line
 * CPU writes the viewer will run from the RCR line interrupt (#16):
 *   setGradient       one palette entry interpolated between two colours,
 *                     one write per line (colour gradient / sky)
 *   setWobble         BXR per line from a sine (amplitude, period, speed)
 *   setParallaxBands  BXR per band of lines, each band its own speed
 *   setScroll         the BXR/BYR the effects are relative to
 * toRaster(pic, frame) returns the table in exactly pce-bg.js's #15 shape
 *   { base: {bxr, byr, cr}, baseCram: [512 9-bit words],
 *     entries: [{line, rcr, bxr?, cram?: [[addr, word]]}, ...] }
 * and renderPreview(pic, frame) is pce-bg.js/pce-sprites.js drawing that
 * table — the page draws nothing separately.  The refusals for effects:
 *   register-range   a VDC register value outside its width (BXR 10 bits,
 *                    BYR 9; a wobble amplitude past a 10-bit swing).
 *   line-range       a line outside the 224-line display (0..223), or a
 *                    range that runs backwards.
 *   raster-line-full two parallax bands cover the same line: a line carries
 *                    one raster entry, so one BXR value; the ROM's RCR chain
 *                    fires one interrupt per line (docs/RENDERER.md #15).
 *   wobble-range / parallax-range / frame-range   bad effect parameters.
 * The table's computed BXR is masked to 10 bits like the register itself
 * (the reference raster2's wobble is masked the same way, tools/genroms.py).
 * The picture's export does NOT carry the table yet: the viewer runs the
 * raster table in #16, and #17 does not fake that (docs/EDITOR.md).
 *
 * Facts (BAT word layout, 4-bit pixels, palette fixup, VRAM size, CRAM
 * layout) are from the Hudson HuC6270/HuC6260 manuals, as recorded in
 * docs/RENDERER.md; the ROM limits are docs/ROM_LAYOUT.md's.  This module
 * has no renderer of its own: renderPreview is pce-bg.js/pce-sprites.js,
 * and the tests draw through the same model so there is one definition.
 *
 * Dual use: CommonJS module in Node (tests/check-editor.js) and a browser
 * global (renderer/editor.html) via a UMD-style wrapper, like pce-bg.js.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./pce-bg.js"), require("./pce-sprites.js"));
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.editor = factory(root.PCEStudio.bg, root.PCEStudio.sprites);
  }
})(typeof self !== "undefined" ? self : this, function (rendererBg, rendererSprites) {
  "use strict";

  var VCE_COLOURS = 512;        /* 9-bit codes; entry n = (G<<6)|(R<<3)|B */
  var PALETTES = 16;            /* BAT bits 12-15 */
  var ENTRIES = 16;             /* 4-bit pixel values */
  var TILE = 8;
  var PIXELS = TILE * TILE;
  var BAT_W = 32;               /* MWR bits 4-5 = 0 */
  var BAT_H = 32;               /* MWR bit 6 = 0 */
  var VIEW_W = 256;
  var VIEW_H = 224;             /* 28 tile rows are visible */
  var FIRST_CHAR = 0x40;        /* VRAM word 0x400: after the 32x32 BAT */
  var LAST_CHAR = 0x7FF;        /* past this is beyond the 32768-word VRAM */
  var MAX_TILES = 1536;         /* ROM_LAYOUT.md banks 4-9 = 48 KiB */
  var CR_BG_ON = 0x80;          /* CR bit 7: background on */
  var CR_SPRITES_ON = 0x40;     /* CR bit 6: SB, sprite layer on */
  var CR_RC = 0x04;             /* CR bit 2: RC, the VDC interrupt enable —
                                 * the ROM's config ORs it in whenever a
                                 * raster table is present (pce-rom.js), so
                                 * the table's base records the register's
                                 * final value, like the #15/#16 tables */
  var MWR_32x32 = 0x00;

  /* ---- sprites (card #13) ---------------------------------------------- */

  var SPRITE_PALETTES = 16;     /* CRAM entries $100-$1FF */
  var SPRITE_ENTRIES = 16;
  var MAX_SPRITES = 64;         /* the SAT holds 64 entries */
  var SAT_ADDR = 0x7F00;        /* DVSSR: the SAT source in VRAM words */
  var SAT_CELL = SAT_ADDR / 64; /* cell $1FC: the first cell the SAT occupies */
  var LINE_STRIPS = 16;         /* the VDC collects 16 strips a line */
  var STRIP_PX = 16;            /* one strip is 16 pixels wide */
  var VIEW_H_LINES = VIEW_H;

  /* ---- scanline effects (card #17) ------------------------------------- */

  var RASTER_LINES = VIEW_H;    /* VDW lines 0..223 = the 224-line display */
  var RASTER_LINE_MAX = RASTER_LINES - 1;
  var BXR_MAX = 0x3FF;          /* BXR R07 is 10 bits (VDC manual H7-7) */
  var BYR_MAX = 0x1FF;          /* BYR R08 is 9 bits (VDC manual H7-7) */
  var RCR_BASE = 0x40;          /* RCR R06 = 0x40 + VDW line (#15) */

  /* The six sizes the VDC draws.  cells = the reserved 64-word span; align =
   * the pattern code's required alignment from the CGX/CGY masks; the odd
   * cells of a 16x32/16x64 span are reserved but never read (the VDC reads
   * +0/+2/... only), exactly as tools/genroms.py's pack_patterns packs. */
  var SPRITE_SIZES = [
    { width: 16, height: 16, cells: 1, align: 1, cgx: 0, cgy: 0 },
    { width: 32, height: 16, cells: 2, align: 2, cgx: 1, cgy: 0 },
    { width: 16, height: 32, cells: 4, align: 4, cgx: 0, cgy: 1 },
    { width: 32, height: 32, cells: 4, align: 4, cgx: 1, cgy: 1 },
    { width: 16, height: 64, cells: 8, align: 8, cgx: 0, cgy: 2 },
    { width: 32, height: 64, cells: 8, align: 8, cgx: 1, cgy: 2 }
  ];

  /* ---- errors ---------------------------------------------------------- */

  function refuse(code, message) {
    var e = new Error("pce-editor: " + message);
    e.code = code;
    throw e;
  }

  function isInt(v) {
    return typeof v === "number" && v === (v | 0);
  }

  function checkInt(name, v, lo, hi, code) {
    if (!isInt(v) || v < lo || v > hi)
      refuse(code || "range", name + " must be an integer " + lo + ".." + hi +
             ", got " + v);
  }

  /* ---- colours --------------------------------------------------------- */

  /* A VCE colour code from three 3-bit channels (0-7 each). */
  function colourWord(r, g, b) {
    return ((g & 7) << 6) | ((r & 7) << 3) | (b & 7);
  }

  function colourChannels(word) {
    return { r: (word >> 3) & 7, g: (word >> 6) & 7, b: word & 7 };
  }

  function checkColour(colour) {
    if (!isInt(colour) || colour < 0 || colour >= VCE_COLOURS)
      refuse("colour-range", "a VCE colour is a 9-bit code 0..511, got " +
             colour);
  }

  /* ---- the picture ----------------------------------------------------- */

  function newPicture() {
    var palettes = [];
    for (var p = 0; p < PALETTES; p++) {
      var entries = new Array(ENTRIES);
      for (var e = 0; e < ENTRIES; e++) entries[e] = 0;
      palettes.push(entries);
    }
    var spritePalettes = [];
    for (var sp = 0; sp < SPRITE_PALETTES; sp++) {
      var sentries = new Array(SPRITE_ENTRIES);
      for (var se = 0; se < SPRITE_ENTRIES; se++) sentries[se] = 0;
      spritePalettes.push(sentries);
    }
    var tiles = new Array(LAST_CHAR + 1);
    tiles[FIRST_CHAR] = { palette: 0, pixels: new Uint8Array(PIXELS) };
    var map = new Uint16Array(BAT_W * BAT_H);
    map.fill(FIRST_CHAR);
    return {
      backdrop: 0,
      palettes: palettes,
      tiles: tiles,
      map: map,
      nextChar: FIRST_CHAR + 1,
      scroll: { BXR: 0, BYR: 0 },
      raster: { gradient: null, wobble: null, bands: [] },
      spritePalettes: spritePalettes,
      spritePatterns: [],
      sprites: []
    };
  }

  /* The backdrop is CRAM entry $000: one colour shared by every palette's
   * colour 0, and what every colour-0 pixel shows. */
  function setBackdrop(pic, colour) {
    checkColour(colour);
    pic.backdrop = colour;
    for (var p = 0; p < PALETTES; p++) pic.palettes[p][0] = colour;
  }

  function setPaletteColour(pic, palette, entry, colour) {
    if (isInt(palette) && palette === PALETTES)
      refuse("17th-palette", "the VDC has " + PALETTES + " background " +
             "palettes (BAT bits 12-15); palette " + palette + " is the " +
             "17th, and the editor will not store it");
    if (!isInt(palette) || palette < 0 || palette >= PALETTES)
      refuse("palette-range", "palette must be an integer 0..15, got " +
             palette);
    if (isInt(entry) && entry === ENTRIES)
      refuse("17th-colour", "a palette has " + ENTRIES + " colours; entry " +
             entry + " is the 17th, and the editor will not store it");
    if (!isInt(entry) || entry < 0 || entry >= ENTRIES)
      refuse("entry-range", "entry must be an integer 0..15, got " + entry);
    checkColour(colour);
    if (entry === 0)
      refuse("backdrop-entry", "colour 0 of every palette is the shared " +
             "backdrop (CRAM $000); use setBackdrop");
    pic.palettes[palette][entry] = colour;
  }

  /* The 16 CRAM words a palette shows: entry 0 is the backdrop, the rest are
   * the palette's own entries. */
  function paletteColours(pic, palette) {
    checkInt("palette", palette, 0, PALETTES - 1, "palette-range");
    var out = new Array(ENTRIES);
    for (var e = 0; e < ENTRIES; e++)
      out[e] = e === 0 ? pic.backdrop : pic.palettes[palette][e];
    return out;
  }

  function tileCount(pic) {
    return pic.nextChar - FIRST_CHAR;
  }

  function hasTile(pic, char) {
    return isInt(char) && char >= FIRST_CHAR && char <= LAST_CHAR &&
           !!pic.tiles[char];
  }

  function getTile(pic, char, what) {
    if (!isInt(char) || char < 0 || char > 0xFFFF)
      refuse("no-tile", (what || "character") + " must be a character code, " +
             "got " + char);
    if (char > LAST_CHAR)
      refuse("vram-range", "character " + hex(char) + " is past the " +
             "32768-word VRAM (the VDC drops the write and shows colour 0)");
    if (!hasTile(pic, char))
      refuse("no-tile", "character " + hex(char) + " has no tile; make one " +
             "with newTile()");
    return pic.tiles[char];
  }

  function hex(v) {
    return "$" + v.toString(16).toUpperCase();
  }

  /* A new tile, authored for one of the 16 palettes.  Characters are handed
   * out in order from $40 (the first character after the 32x32 BAT). */
  function newTile(pic, palette) {
    if (isInt(palette) && palette === PALETTES)
      refuse("17th-palette", "the VDC has " + PALETTES + " background " +
             "palettes; palette " + palette + " is the 17th, and the " +
             "editor will not store it");
    checkInt("palette", palette, 0, PALETTES - 1, "palette-range");
    if (tileCount(pic) >= MAX_TILES)
      refuse("tile-space", "the ROM layout gives " + MAX_TILES + " tiles " +
             "(6 banks of 8 KiB, docs/ROM_LAYOUT.md); no room for another");
    var char = FIRST_CHAR + tileCount(pic);
    if (char > LAST_CHAR)
      refuse("vram-range", "tiles would run past " + hex(LAST_CHAR) + ", the " +
             "last character inside the 32768-word VRAM");
    /* A tile pushes the sprite patterns further into VRAM (they are packed
     * after the tiles).  The VDC cannot show a pattern that reaches the SAT,
     * so a tile that would push one there is refused instead. */
    var wasNext = pic.nextChar;
    pic.nextChar++;
    if (pic.spritePatterns.length && patternLayout(pic).endCell > SAT_CELL) {
      pic.nextChar = wasNext;
      refuse("tile-space", "this tile would push the sprite patterns into " +
             "the SAT at VRAM " + hex(SAT_ADDR) + "; the VDC cannot show " +
             "both — remove a sprite pattern or use fewer tiles");
    }
    pic.tiles[char] = { palette: palette, pixels: new Uint8Array(PIXELS) };
    return char;
  }

  function setTilePalette(pic, char, palette) {
    if (isInt(palette) && palette === PALETTES)
      refuse("17th-palette", "the VDC has " + PALETTES + " background " +
             "palettes; palette " + palette + " is the 17th");
    checkInt("palette", palette, 0, PALETTES - 1, "palette-range");
    getTile(pic, char).palette = palette;
  }

  /* Paint one pixel with a 4-bit colour number.  16 and above are the 17th
   * colour and cannot be stored in a pixel. */
  function paintTileIndex(pic, char, x, y, index) {
    var tile = getTile(pic, char);
    checkInt("x", x, 0, TILE - 1, "pixel-range");
    checkInt("y", y, 0, TILE - 1, "pixel-range");
    if (isInt(index) && index >= ENTRIES)
      refuse("17th-colour", "a tile pixel is 4 bits: colour numbers 0-15; " +
             index + " is past the 16 colours a tile can show, and the VDC " +
             "has no 17th colour in a tile");
    if (!isInt(index) || index < 0)
      refuse("colour-index", "a pixel colour number must be 0-15, got " +
             index);
    tile.pixels[y * TILE + x] = index;
  }

  /* Paint with a VCE colour: the tile's palette must hold it.  A tile shows
   * the shared backdrop (colour 0) plus its palette's 15 entries; a colour
   * outside that set would need a 17th colour in the tile, so it is refused
   * rather than silently mapped to something else. */
  function paintTileColour(pic, char, x, y, colour) {
    var tile = getTile(pic, char);
    checkColour(colour);
    var index = -1;
    if (colour === pic.backdrop) {
      index = 0;
    } else {
      for (var e = 1; e < ENTRIES; e++) {
        if (pic.palettes[tile.palette][e] === colour) { index = e; break; }
      }
    }
    if (index < 0)
      refuse("not-in-palette", "colour " + hex(colour) + " is not in palette " +
             tile.palette + ", which this tile shows: a tile shows the " +
             "backdrop plus 15 palette entries (16 colours), so " +
             hex(colour) + " would be a 17th colour in the tile");
    paintTileIndex(pic, char, x, y, index);
  }

  function tilePixels(pic, char) {
    return getTile(pic, char).pixels;
  }

  function tilePalette(pic, char) {
    return getTile(pic, char).palette;
  }

  /* Every colour a tile shows, in colour-number order (0 = the backdrop). */
  function coloursInTile(pic, char) {
    var tile = getTile(pic, char);
    var seen = {}, out = [];
    for (var i = 0; i < PIXELS; i++) {
      var v = tile.pixels[i];
      if (seen[v]) continue;
      seen[v] = true;
      out.push(v === 0 ? pic.backdrop : pic.palettes[tile.palette][v]);
    }
    return out;
  }

  /* ---- the map (the BAT) ----------------------------------------------- */

  function paintMapCell(pic, mx, my, char) {
    checkInt("map column", mx, 0, BAT_W - 1, "map-range");
    checkInt("map row", my, 0, BAT_H - 1, "map-range");
    getTile(pic, char);
    pic.map[my * BAT_W + mx] = char;
  }

  function mapCell(pic, mx, my) {
    checkInt("map column", mx, 0, BAT_W - 1, "map-range");
    checkInt("map row", my, 0, BAT_H - 1, "map-range");
    return pic.map[my * BAT_W + mx];
  }

  /* Merge tiles that are identical in pixels and palette, so the map reuses
   * them (that is what the BAT is for).  The blank tile at $40 always stays
   * first.  Returns the number of tiles merged away. */
  function dedupeTiles(pic) {
    var remap = {}, kept = [], byKey = {};
    var count = tileCount(pic);
    for (var i = 0; i < count; i++) {
      var char = FIRST_CHAR + i;
      var tile = pic.tiles[char];
      var key = tile.palette + ":" + Array.prototype.join.call(tile.pixels, ",");
      var target = byKey[key];
      if (target === undefined) {
        target = FIRST_CHAR + kept.length;
        byKey[key] = target;
        kept.push(tile);
      }
      remap[char] = target;
    }
    var tiles = new Array(LAST_CHAR + 1);
    for (var k = 0; k < kept.length; k++) tiles[FIRST_CHAR + k] = kept[k];
    var map = new Uint16Array(pic.map.length);
    for (var m = 0; m < pic.map.length; m++) map[m] = remap[pic.map[m]];
    pic.tiles = tiles;
    pic.map = map;
    pic.nextChar = FIRST_CHAR + kept.length;
    return count - kept.length;
  }

  /* ---- sprites: patterns, palettes and the SAT (card #13) -------------- */

  function spriteSize(width, height) {
    for (var i = 0; i < SPRITE_SIZES.length; i++) {
      var s = SPRITE_SIZES[i];
      if (s.width === width && s.height === height) return s;
    }
    return null;
  }

  function getSpritePattern(pic, index) {
    if (!isInt(index) || index < 0 || index >= pic.spritePatterns.length)
      refuse("sprite-pattern-range", "sprite pattern " + index + " does not " +
             "exist (there " + (pic.spritePatterns.length === 1 ? "is" : "are") +
             " " + pic.spritePatterns.length + ")");
    return pic.spritePatterns[index];
  }

  /* Where every pattern's cells land in VRAM, recomputed from the picture's
   * current tile count.  Patterns are packed in creation order after the
   * tiles, each at the alignment its CGX/CGY mask requires, and a reserved
   * span exactly as tools/genroms.py's pack_patterns reserves it.  Returns
   * the first cell of each pattern and the one-past-last cell. */
  function patternLayout(pic) {
    var cursor = Math.ceil(pic.nextChar / 4);   /* word = char*16, cell = 64 */
    var codes = [], first = null;
    for (var i = 0; i < pic.spritePatterns.length; i++) {
      var pat = pic.spritePatterns[i];
      var size = spriteSize(pat.width, pat.height);
      if (!size)
        refuse("sprite-size", "sprite pattern " + i + " is " + pat.width + "x" +
               pat.height + "; the VDC draws 16 or 32 wide and 16, 32 or 64 tall");
      var base = Math.ceil(cursor / size.align) * size.align;
      if (first === null) first = base;
      codes.push(base);
      cursor = base + size.cells;
    }
    return { codes: codes, firstCell: first, endCell: cursor,
             cellCount: first === null ? 0 : cursor - first };
  }

  /* A pattern is created for one of the six sizes the VDC draws.  Its cells
   * are packed after the tiles; if they would reach the SAT at VRAM $7F00
   * (the last four 64-word cells of VRAM) the VDC cannot show the pattern,
   * so it is refused and the picture is left unchanged. */
  function newSpritePattern(pic, width, height) {
    var size = spriteSize(width, height);
    if (!size)
      refuse("sprite-size", "the VDC draws 16x16, 32x16, 16x32, 32x32, " +
             "16x64 or 32x64; " + width + "x" + height + " is not one of them");
    var pat = { width: width, height: height,
                pixels: new Uint8Array(width * height) };
    pic.spritePatterns.push(pat);
    var layout = patternLayout(pic);
    if (layout.endCell > SAT_CELL) {
      pic.spritePatterns.pop();
      refuse("sprite-pattern-vram", "a " + width + "x" + height + " pattern " +
             "needs cells " + layout.codes[layout.codes.length - 1] + ".." +
             (layout.endCell - 1) + ", but the SAT occupies cells " + SAT_CELL +
             ".." + (SAT_CELL + 3) + " at VRAM " + hex(SAT_ADDR) + " (the " +
             "32768-word VRAM ends there); the VDC cannot show it");
    }
    return pic.spritePatterns.length - 1;
  }

  function spritePatternCount(pic) { return pic.spritePatterns.length; }

  function spritePatternSize(pic, index) {
    var pat = getSpritePattern(pic, index);
    return { width: pat.width, height: pat.height };
  }

  function spritePatternPixels(pic, index) {
    return getSpritePattern(pic, index).pixels;
  }

  /* Paint one sprite-pattern pixel with a 4-bit colour number.  The colour
   * NUMBER is not a palette entry: the sprite's palette (chosen per SAT
   * entry) maps it when the VDC draws.  Number 0 is transparent. */
  function paintSpriteIndex(pic, pattern, x, y, index) {
    var pat = getSpritePattern(pic, pattern);
    checkInt("x", x, 0, pat.width - 1, "sprite-pixel-range");
    checkInt("y", y, 0, pat.height - 1, "sprite-pixel-range");
    if (isInt(index) && index >= SPRITE_ENTRIES)
      refuse("17th-colour", "a sprite pixel is 4 bits: colour numbers 0-15; " +
             index + " is past the 16 colours a sprite pattern can show");
    if (!isInt(index) || index < 0)
      refuse("colour-index", "a sprite pixel colour number must be 0-15, got " +
             index);
    pat.pixels[y * pat.width + x] = index;
  }

  function setSpritePaletteColour(pic, palette, entry, colour) {
    if (isInt(palette) && palette === SPRITE_PALETTES)
      refuse("17th-sprite-palette", "the VDC has " + SPRITE_PALETTES +
             " sprite palettes (CRAM $100-$1FF); palette " + palette +
             " is the 17th, and the editor will not store it");
    if (!isInt(palette) || palette < 0 || palette >= SPRITE_PALETTES)
      refuse("sprite-palette-range", "sprite palette must be an integer " +
             "0..15, got " + palette);
    if (isInt(entry) && entry === SPRITE_ENTRIES)
      refuse("17th-colour", "a sprite palette has " + SPRITE_ENTRIES +
             " colours; entry " + entry + " is the 17th, and the editor will " +
             "not store it");
    if (!isInt(entry) || entry < 0 || entry >= SPRITE_ENTRIES)
      refuse("sprite-entry-range", "sprite palette entry must be an integer " +
             "0..15, got " + entry);
    checkColour(colour);
    pic.spritePalettes[palette][entry] = colour;
  }

  function spritePaletteColours(pic, palette) {
    checkInt("sprite palette", palette, 0, SPRITE_PALETTES - 1,
             "sprite-palette-range");
    return pic.spritePalettes[palette].slice();
  }

  /* Place one sprite in the SAT: display X/Y (0-255, 0-223), a pattern, one
   * of the 16 sprite palettes, SPBG priority (1 = in front of the background)
   * and the two flips.  The pattern decides the size. */
  function addSprite(pic, spec) {
    spec = spec || {};
    if (pic.sprites.length >= MAX_SPRITES)
      refuse("65th-sprite", "the SAT holds " + MAX_SPRITES + " entries; this " +
             "is sprite " + (MAX_SPRITES + 1) + ", and the VDC cannot show it");
    var pattern = spec.pattern;
    if (!isInt(pattern) || pattern < 0 || pattern >= pic.spritePatterns.length)
      refuse("sprite-pattern-range", "sprite pattern " + pattern + " does not " +
             "exist");
    checkInt("x", spec.x, 0, VIEW_W - 1, "sprite-range");
    checkInt("y", spec.y, 0, VIEW_H - 1, "sprite-range");
    if (isInt(spec.palette) && spec.palette === SPRITE_PALETTES)
      refuse("17th-sprite-palette", "the VDC has " + SPRITE_PALETTES +
             " sprite palettes; palette " + spec.palette + " is the 17th");
    var palette = spec.palette === undefined ? 0 : spec.palette;
    checkInt("sprite palette", palette, 0, SPRITE_PALETTES - 1,
             "sprite-palette-range");
    var priority = spec.priority === undefined ? 1 : spec.priority;
    checkInt("priority", priority, 0, 1, "sprite-flag-range");
    var hflip = spec.hflip === undefined ? 0 : spec.hflip;
    var vflip = spec.vflip === undefined ? 0 : spec.vflip;
    checkInt("hflip", hflip, 0, 1, "sprite-flag-range");
    checkInt("vflip", vflip, 0, 1, "sprite-flag-range");
    pic.sprites.push({ x: spec.x, y: spec.y, pattern: pattern,
                       palette: palette, priority: priority,
                       hflip: hflip, vflip: vflip });
    return pic.sprites.length - 1;
  }

  function removeSprite(pic, index) {
    if (!isInt(index) || index < 0 || index >= pic.sprites.length)
      refuse("sprite-range", "sprite " + index + " does not exist");
    pic.sprites.splice(index, 1);
  }

  function clearSprites(pic) { pic.sprites.length = 0; }

  /* The strips one display line's sprites ask for: in SAT order, at most 16
   * strips are kept; a 32-px sprite is two strips, so its right half can be
   * the first one dropped (the way pce-sprites.js draws it).
   *
   * The line's status conditions (card #50; HuC6270 SR p. H7-4) are the same
   * SAT search: OR = a 17th strip was attempted (the line asked for more than
   * 16), CC = sprite #0 and another sprite from the kept strips have an
   * opaque pixel at the same display column.  The pattern pixels are read the
   * way writeSpritePattern lays them down and pce-sprites.js draws them: for
   * a CGX sprite HFLIP swaps the 16-px halves and mirrors each half's pixels.
   * The bits the status register would hold are these conditions AND the CR
   * enables, which a picture does not carry (the editor sets CR = $C0, no
   * interrupt enables) — the budget shows the conditions, and pce-panels.js
   * shows the gated bits for a state that has CR. */
  function spriteLineBudget(pic, line) {
    checkInt("line", line, 0, VIEW_H_LINES - 1, "line-range");
    var used = 0, dropped = 0, entries = [];
    var own = new Uint8Array(VIEW_W), other = new Uint8Array(VIEW_W);
    for (var i = 0; i < pic.sprites.length; i++) {
      var s = pic.sprites[i];
      var pat = getSpritePattern(pic, s.pattern);
      if (line < s.y || line >= s.y + pat.height) continue;
      var strips = pat.width / STRIP_PX;
      var kept = Math.min(strips, LINE_STRIPS - used);
      used += kept;
      dropped += strips - kept;
      entries.push({ sprite: i, strips: strips, kept: kept,
                     dropped: strips - kept });
      var row = line - s.y;
      var mask = i === 0 ? own : other;
      for (var st = 0; st < kept; st++) {
        /* source 16-px half: HFLIP swaps a CGX sprite's halves */
        var half = pat.width === 32 && s.hflip ? 1 - st : st;
        for (var c = 0; c < 16; c++) {
          var px = s.x + st * STRIP_PX + c;
          if (px < 0 || px >= VIEW_W) continue;
          /* within a half HFLIP mirrors the pixel */
          var sx = half * 16 + (s.hflip ? 15 - c : c);
          if (pat.pixels[row * pat.width + sx]) mask[px] = 1;
        }
      }
    }
    var collision = false;
    for (var x = 0; x < VIEW_W && !collision; x++) {
      collision = !!(own[x] && other[x]);
    }
    return { line: line, strips: used, pixels: used * STRIP_PX,
             limitStrips: LINE_STRIPS, limitPixels: LINE_STRIPS * STRIP_PX,
             requested: used + dropped, dropped: dropped,
             overflow: dropped > 0, collision: collision, entries: entries };
  }

  /* The RCR-match lines an effect table would set (card #50): each entry's
   * handler fires on its own line (rcr = 0x40 + line, #15/#16), so RR's lines
   * are the table's entry lines.  A picture with no effects has none. */
  function rasterMatchLines(pic) {
    var raster = null;
    try { raster = toRaster(pic, 0); } catch (e) { return []; }
    if (!raster) return [];
    return raster.entries.map(function (e) { return e.line; });
  }

  /* Every display line's budget, plus the worst line and how many lines drop
   * strips.  This is what the page shows live.  The status block counts the
   * lines carrying each condition and carries the frame's VD/RR event: VD at
   * the first line after the 240-line display, RR on the effect table's
   * lines (both card #50; the sprites' conditions are per line, the events
   * are the frame's). */
  function spriteBudget(pic) {
    var lines = [], worst = null, droppedLines = 0;
    var orLines = [], ccLines = [];
    for (var y = 0; y < VIEW_H_LINES; y++) {
      var b = spriteLineBudget(pic, y);
      lines.push(b);
      if (b.dropped) droppedLines++;
      if (b.overflow) orLines.push(y);
      if (b.collision) ccLines.push(y);
      if (!worst || b.strips > worst.strips ||
          (b.strips === worst.strips && b.dropped > worst.dropped)) worst = b;
    }
    var rr = rasterMatchLines(pic);
    return { lines: lines, worst: worst, droppedLines: droppedLines,
             limitStrips: LINE_STRIPS, limitPixels: LINE_STRIPS * STRIP_PX,
             spriteCount: pic.sprites.length, maxSprites: MAX_SPRITES,
             orLines: orLines, ccLines: ccLines,
             status: {
               /* the conditions above; the only bit a picture can latch is RR
                * (its exported CR has RC when an effect table exists; OC/CC/VC
                * are never set, pce-rom.js), so SR is $04 with effects, else 0 */
               OR: orLines.length > 0, CC: ccLines.length > 0,
               RR: rr, VD: true,
               vblankLine: 240,        /* VDW $00EF + 1, H7-10 */
               rrBit: rr.length > 0, sr: rr.length > 0 ? 0x04 : 0
             } };
  }

  /* The 256 SAT words the editor would write to VRAM $7F00.  Entry i is
   * words 4i..4i+3: Y, X, pattern << 1, attributes (palette, SPBG, CGX,
   * HFLIP, CGY, VFLIP) — docs/RENDERER.md's word layout. */
  function satWords(pic) {
    var layout = patternLayout(pic);
    var words = new Array(256).fill(0);
    for (var i = 0; i < pic.sprites.length; i++) {
      var s = pic.sprites[i];
      var pat = pic.spritePatterns[s.pattern];
      var size = spriteSize(pat.width, pat.height);
      words[i * 4] = (s.y + 64) & 0x3FF;          /* SAT Y: 64 = row 0 */
      words[i * 4 + 1] = (s.x + 32) & 0x3FF;      /* SAT X: 32 = column 0 */
      words[i * 4 + 2] = (layout.codes[s.pattern] << 1) & 0x7FF;
      words[i * 4 + 3] = (s.palette & 0xF) | ((s.priority & 1) << 7) |
                         (size.cgx << 8) | ((s.hflip & 1) << 11) |
                         (size.cgy << 12) | ((s.vflip & 1) << 15);
    }
    return words;
  }

  /* Write one pattern's pixels into its 64-word cells: block b, half c (a
   * 32-px sprite has two 16-px halves), plane k at +16k, row; word bit 15 is
   * the strip's leftmost pixel. */
  function writeSpritePattern(vram, pat, base) {
    var width = pat.width, height = pat.height;
    var halves = width === 32 ? 2 : 1;
    for (var b = 0; b < height / 16; b++) {
      for (var half = 0; half < halves; half++) {
        var cell = base + b * 2 + half;
        for (var row = 0; row < 16; row++) {
          for (var k = 0; k < 4; k++) {
            var word = 0;
            for (var xin = 0; xin < 16; xin++) {
              var v = pat.pixels[(b * 16 + row) * width + half * 16 + xin];
              if (v & (1 << k)) word |= 1 << (15 - xin);
            }
            var w = cell * 64 + k * 16 + row;
            vram[w * 2] = word & 0xFF;
            vram[w * 2 + 1] = (word >> 8) & 0xFF;
          }
        }
      }
    }
  }

  /* ---- scanline effects: #15's raster table (card #17) ------------------ */

  function rasterState(pic) {
    if (!pic.raster) pic.raster = { gradient: null, wobble: null, bands: [] };
    return pic.raster;
  }

  function checkRegister(name, value, max, bits) {
    if (!isInt(value) || value < 0 || value > max)
      refuse("register-range", name + " is a " + bits + "-bit VDC register " +
             "(0.." + max + "), got " + value);
  }

  function checkRasterLine(name, line) {
    if (!isInt(line) || line < 0 || line > RASTER_LINE_MAX)
      refuse("line-range", name + " line " + line + " is outside the display " +
             "(VDW lines 0.." + RASTER_LINE_MAX + "); the VDC shows no such " +
             "line");
  }

  function checkRasterRange(name, line0, line1) {
    checkRasterLine(name + " start", line0);
    checkRasterLine(name + " end", line1);
    if (line0 > line1)
      refuse("line-range", name + " starts at line " + line0 + " and ends at " +
             line1 + "; a range cannot run backwards");
  }

  /* The BXR/BYR the effects are relative to, as pce-bg.js's #15 table takes
   * them: base.bxr is the register value a line with no entry would hold. */
  function setScroll(pic, spec) {
    spec = spec || {};
    var bxr = spec.BXR === undefined ? pic.scroll.BXR : spec.BXR;
    var byr = spec.BYR === undefined ? pic.scroll.BYR : spec.BYR;
    checkRegister("BXR", bxr, BXR_MAX, 10);
    checkRegister("BYR", byr, BYR_MAX, 9);
    pic.scroll.BXR = bxr;
    pic.scroll.BYR = byr;
  }

  /* A colour gradient: CRAM entry palette*16 + entry, written once per line
   * between two VCE colours.  Line L gets the per-channel interpolation
   * mix(from, to, (L-line0)/(line1-line0)) — at line0 the first colour, at
   * line1 the second (a one-line gradient is the first colour).  Entry 0 is
   * the shared backdrop (CRAM $000) and is not a palette entry to gradient:
   * the renderer shows CRAM[0] for every colour-0 pixel whatever palette, so
   * a per-palette colour-0 write would never show (setBackdrop is one
   * colour). */
  function setGradient(pic, spec) {
    spec = spec || {};
    var palette = spec.palette === undefined ? 0 : spec.palette;
    var entry = spec.entry === undefined ? 1 : spec.entry;
    if (isInt(palette) && palette === PALETTES)
      refuse("17th-palette", "the VDC has " + PALETTES + " background " +
             "palettes (BAT bits 12-15); palette " + palette + " is the 17th");
    checkInt("palette", palette, 0, PALETTES - 1, "palette-range");
    if (isInt(entry) && entry === ENTRIES)
      refuse("17th-colour", "a palette has " + ENTRIES + " colours; entry " +
             entry + " is the 17th, and the editor will not store it");
    if (!isInt(entry) || entry < 0 || entry >= ENTRIES)
      refuse("entry-range", "entry must be an integer 0..15, got " + entry);
    if (entry === 0)
      refuse("backdrop-entry", "colour 0 of every palette is the shared " +
             "backdrop (CRAM $000); a gradient writes palette entries 1..15 " +
             "(use setBackdrop for the one shared colour)");
    checkColour(spec.from);
    checkColour(spec.to);
    var line0 = spec.line0 === undefined ? 0 : spec.line0;
    var line1 = spec.line1 === undefined ? RASTER_LINE_MAX : spec.line1;
    checkRasterRange("gradient", line0, line1);
    var g = { palette: palette, entry: entry, from: spec.from, to: spec.to,
              line0: line0, line1: line1 };
    rasterState(pic).gradient = g;
    return g;
  }

  /* A wobble: BXR on every line of the range from a sine, relative to the
   * scroll.  For line L at frame f (speed is lines per frame — the sine
   * slides by `speed` lines each frame):
   *   bxr = (BXR + round(amplitude * sin(2*pi*(L-line0+speed*f)/period)))
   *         & 0x3FF
   * The mask is the register's own 10-bit width, the same mask the reference
   * raster2 applies (tools/genroms.py raster_wobble).  period is in lines;
   * amplitude is in pixels (a 10-bit register swing). */
  function setWobble(pic, spec) {
    spec = spec || {};
    var amplitude = spec.amplitude === undefined ? 0 : spec.amplitude;
    if (!isInt(amplitude) || amplitude < 0 || amplitude > BXR_MAX)
      refuse("register-range", "wobble amplitude " + amplitude + " is not a " +
             "BXR swing: BXR is a 10-bit register (0.." + BXR_MAX + ")");
    var period = spec.period === undefined ? 64 : spec.period;
    if (!isInt(period) || period < 1)
      refuse("wobble-range", "wobble period must be an integer number of " +
             "lines >= 1, got " + period);
    var speed = spec.speed === undefined ? 0 : spec.speed;
    if (!isInt(speed))
      refuse("wobble-range", "wobble speed must be an integer number of " +
             "lines per frame, got " + speed);
    var line0 = spec.line0 === undefined ? 0 : spec.line0;
    var line1 = spec.line1 === undefined ? RASTER_LINE_MAX : spec.line1;
    checkRasterRange("wobble", line0, line1);
    var w = { amplitude: amplitude, period: period, speed: speed,
              line0: line0, line1: line1 };
    rasterState(pic).wobble = w;
    return w;
  }

  function wobbleOffset(w, line, frame) {
    var phase = (line - w.line0 + w.speed * frame) / w.period;
    return Math.round(w.amplitude * Math.sin(2 * Math.PI * phase));
  }

  /* Parallax bands: each band covers lines line0..line1 and scrolls at its
   * own speed (pixels per frame): bxr = (BXR + speed*frame) & 0x3FF on every
   * line of the band.  Bands may not overlap — a VDW line carries one raster
   * entry, so one band's BXR (the ROM's RCR chain fires one interrupt per
   * line, #15); overlapping bands are refused rather than silently picking
   * one. */
  function setParallaxBands(pic, bands) {
    if (!Array.isArray(bands))
      refuse("parallax-range", "parallax bands must be an array of " +
             "{line0, line1, speed}, got " + typeof bands);
    var out = [];
    for (var i = 0; i < bands.length; i++) {
      var b = bands[i] || {};
      var speed = b.speed === undefined ? 0 : b.speed;
      if (!isInt(speed))
        refuse("parallax-range", "band " + i + " speed must be an integer " +
               "number of pixels per frame, got " + speed);
      checkRasterRange("band " + i, b.line0, b.line1);
      out.push({ line0: b.line0, line1: b.line1, speed: speed });
    }
    var sorted = out.slice().sort(function (a, b) { return a.line0 - b.line0; });
    for (i = 1; i < sorted.length; i++) {
      if (sorted[i].line0 <= sorted[i - 1].line1)
        refuse("raster-line-full", "bands covering lines " +
               sorted[i - 1].line0 + ".." + sorted[i - 1].line1 + " and " +
               sorted[i].line0 + ".." + sorted[i].line1 + " overlap: a VDW " +
               "line carries one raster entry (one BXR value), and the ROM's " +
               "RCR chain fires one interrupt per line");
    }
    rasterState(pic).bands = out;
    return out;
  }

  function clearGradient(pic) { rasterState(pic).gradient = null; }
  function clearWobble(pic) { rasterState(pic).wobble = null; }
  function clearBands(pic) { rasterState(pic).bands = []; }

  function clearEffects(pic) {
    rasterState(pic).gradient = null;
    rasterState(pic).wobble = null;
    rasterState(pic).bands = [];
  }

  /* The 512 9-bit CRAM words the picture's palettes hold, in the raster
   * table's baseCram order: background palettes at 0..255 (entry 0 = the
   * shared backdrop) and sprite palettes at $100..$1FF. */
  function cramWords(pic) {
    var words = new Array(VCE_COLOURS);
    var p, e;
    for (p = 0; p < PALETTES; p++) {
      for (e = 0; e < ENTRIES; e++)
        words[p * ENTRIES + e] = e === 0 ? pic.backdrop : pic.palettes[p][e];
    }
    for (p = 0; p < SPRITE_PALETTES; p++) {
      for (e = 0; e < SPRITE_ENTRIES; e++)
        words[0x100 + p * SPRITE_ENTRIES + e] = pic.spritePalettes[p][e];
    }
    for (var i = 0; i < words.length; i++) {
      if (!isInt(words[i]) || words[i] < 0 || words[i] >= VCE_COLOURS)
        refuse("colour-range", "CRAM entry " + i + " = " + words[i] +
               "; a VCE colour is 9 bits (0..511)");
    }
    return words;
  }

  function bandAt(bands, line) {
    for (var i = 0; i < bands.length; i++)
      if (line >= bands[i].line0 && line <= bands[i].line1) return bands[i];
    return null;
  }

  /* The #15 raster table these effects write, or null when there are none.
   * One entry per VDW line carrying anything: the line's BXR (wobble and
   * the band it is in, added — a wobbling band) and the gradient's colour
   * write.  No effect writes a line it does not cover, so a line outside
   * every range keeps the register value the previous entry left, exactly
   * as pce-bg.js's buildRows applies #15's per-line rules.
   *
   * `frame` is the editor's time in frames: the wobble's sine slides by
   * `speed` lines a frame and a band's scroll advances by `speed` pixels a
   * frame.  frame 0 is the static picture. */
  function toRaster(pic, frame) {
    frame = frame === undefined ? 0 : frame;
    if (!isInt(frame) || frame < 0)
      refuse("frame-range", "raster frame must be a non-negative integer, " +
             "got " + frame);
    var fx = pic.raster || {};
    var gradient = fx.gradient || null;
    var wobble = fx.wobble || null;
    var bands = fx.bands || [];
    if (!gradient && !wobble && !bands.length) return null;

    checkRegister("BXR", pic.scroll.BXR, BXR_MAX, 10);
    checkRegister("BYR", pic.scroll.BYR, BYR_MAX, 9);
    var base = { bxr: pic.scroll.BXR, byr: pic.scroll.BYR,
                 cr: CR_BG_ON | (pic.sprites.length ? CR_SPRITES_ON : 0) |
                     CR_RC };
    var entries = [];
    for (var L = 0; L <= RASTER_LINE_MAX; L++) {
      var entry = { line: L, rcr: RCR_BASE + L };
      var hasBxr = false, offset = 0;
      if (wobble && L >= wobble.line0 && L <= wobble.line1) {
        offset += wobbleOffset(wobble, L, frame);
        hasBxr = true;
      }
      var band = bandAt(bands, L);
      if (band) {
        offset += band.speed * frame;
        hasBxr = true;
      }
      if (hasBxr) entry.bxr = (base.bxr + offset) & BXR_MAX;
      if (gradient && L >= gradient.line0 && L <= gradient.line1) {
        var t = gradient.line0 === gradient.line1 ? 0
              : (L - gradient.line0) / (gradient.line1 - gradient.line0);
        entry.cram = [[gradient.palette * ENTRIES + gradient.entry,
                       mix(gradient.from, gradient.to, t)]];
      }
      if (entry.bxr !== undefined || entry.cram) entries.push(entry);
    }
    return { base: base, baseCram: cramWords(pic), entries: entries };
  }

  /* The page's preview: pce-bg.js/pce-sprites.js drawing toPicture()'s data
   * with toRaster()'s table — nothing is drawn separately.  With sprites in
   * the picture the sprite layer is composed by pce-sprites.js, which reads
   * the same table (its per-line CR and colour table). */
  function renderPreview(pic, frame) {
    if (!rendererBg || !rendererSprites)
      refuse("no-renderer", "the preview needs renderer/pce-bg.js and " +
             "renderer/pce-sprites.js loaded before pce-editor.js");
    var data = toPicture(pic);
    var opts = {
      vram: data.vram, cram: data.cram, regs: viewRegs(pic),
      sat: data.vram.slice(SAT_ADDR * 2, SAT_ADDR * 2 + 512),
      width: VIEW_W, height: VIEW_H
    };
    var raster = toRaster(pic, frame);
    if (raster) opts.raster = raster;
    return rendererSprites.renderFrame(opts);
  }

  /* ---- what the hardware would hold ----------------------------------- */

  /* The picture as the viewer ROM lays it out: 32768 words of VRAM (BAT at
   * word 0, tiles from character $40), 512 CRAM entries (the 16 background
   * palettes at 0-255, the unused sprite palettes 256-511 left black), the
   * four config registers and one tile region.  This is the object
   * renderer/pce-rom.js turns into a .pce. */
  function toPicture(pic) {
    var vram = new Uint8Array(65536);
    var i, m;

    /* The sprite patterns are packed after the tiles; refuse a picture whose
     * patterns would reach the SAT (the same rule newSpritePattern applies at
     * creation — a later tile could have pushed them). */
    var layout = patternLayout(pic);
    if (layout.endCell > SAT_CELL)
      refuse("sprite-pattern-vram", "the sprite patterns end at cell " +
             layout.endCell + ", past the SAT at cell " + SAT_CELL +
             " (VRAM " + hex(SAT_ADDR) + "); the VDC cannot show them");

    for (i = 0; i < BAT_W * BAT_H; i++) {
      var char = pic.map[i];
      var tile = pic.tiles[char];
      if (!tile)
        refuse("no-tile", "map cell " + i + " names character " + hex(char) +
               ", which has no tile");
      var word = (char & 0xFFF) | ((tile.palette & 0xF) << 12);
      vram[i * 2] = word & 0xFF;
      vram[i * 2 + 1] = (word >> 8) & 0xFF;
    }

    for (m = FIRST_CHAR; m < pic.nextChar; m++) {
      var t = pic.tiles[m];
      if (!t) continue;
      for (var y = 0; y < TILE; y++) {
        var lo = 0, hi = 0, lo2 = 0, hi2 = 0;
        for (var x = 0; x < TILE; x++) {
          var v = t.pixels[y * TILE + x];
          var bit = 7 - x;            /* bit 7 of a plane byte is the leftmost */
          if (v & 1) lo |= 1 << bit;
          if (v & 2) hi |= 1 << bit;
          if (v & 4) lo2 |= 1 << bit;
          if (v & 8) hi2 |= 1 << bit;
        }
        var w0 = lo | (hi << 8), w1 = lo2 | (hi2 << 8);
        var a = (m * 16 + y) * 2, b = (m * 16 + 8 + y) * 2;
        vram[a] = w0 & 0xFF;
        vram[a + 1] = (w0 >> 8) & 0xFF;
        vram[b] = w1 & 0xFF;
        vram[b + 1] = (w1 >> 8) & 0xFF;
      }
    }

    /* sprite patterns: cells after the tiles, at the codes the SAT names */
    for (i = 0; i < pic.spritePatterns.length; i++)
      writeSpritePattern(vram, pic.spritePatterns[i], layout.codes[i]);

    /* the SAT at VRAM $7F00 (the DVSSR source the viewer's SATB DMA reads) */
    var sat = satWords(pic);
    for (i = 0; i < sat.length; i++) {
      var satOff = SAT_ADDR * 2 + i * 2;
      vram[satOff] = sat[i] & 0xFF;
      vram[satOff + 1] = (sat[i] >> 8) & 0xFF;
    }

    var cram = new Uint8Array(1024);
    for (var p = 0; p < PALETTES; p++) {
      for (var e = 0; e < ENTRIES; e++) {
        var colour = e === 0 ? pic.backdrop : pic.palettes[p][e];
        var off = (p * ENTRIES + e) * 2;
        cram[off] = colour & 0xFF;
        cram[off + 1] = (colour >> 8) & 0xFF;
      }
    }
    for (var sp = 0; sp < SPRITE_PALETTES; sp++) {
      for (var se = 0; se < SPRITE_ENTRIES; se++) {
        var sc = pic.spritePalettes[sp][se];
        var soff = (0x100 + sp * SPRITE_ENTRIES + se) * 2;
        cram[soff] = sc & 0xFF;
        cram[soff + 1] = (sc >> 8) & 0xFF;
      }
    }

    /* Two copy regions: the tiles from $40, then the sprite patterns.  The
     * pattern region starts at its first packed cell (the alignment gap after
     * the tiles is left uncopied, i.e. zero). */
    var regions = [[FIRST_CHAR, tileCount(pic)]];
    if (pic.spritePatterns.length)
      regions.push([layout.firstCell * 4, layout.cellCount * 4]);

    return {
      vram: vram,
      cram: cram,
      regs: { BXR: pic.scroll.BXR, BYR: pic.scroll.BYR,
              MWR: MWR_32x32,
              CR: CR_BG_ON | (pic.sprites.length ? CR_SPRITES_ON : 0) },
      regions: regions,
      width: VIEW_W,
      height: VIEW_H
    };
  }

  /* Registers for the on-screen preview: BAT row 0 at the top of the 224
   * visible lines.  renderer/pce-bg.js renders row 0 with BG_YOffset = BYR +
   * RCRCount - (scanline - firstScanline); with RCRCount 0 and scanline 18
   * (firstScanline's default) that is VDW line 0.  A Mednafen capture crops
   * the top line (its DisplayRect starts one line later), so the capture and
   * the preview line up one row apart — docs/EDITOR.md says why. */
  function viewRegs(pic) {
    return {
      BXR: pic.scroll.BXR, BYR: pic.scroll.BYR,
      MWR: MWR_32x32,
      CR: CR_BG_ON | (pic.sprites.length ? CR_SPRITES_ON : 0),
      RCRCount: 0, scanline: 18
    };
  }

  /* Every invariant the editor promises to hold.  Returns a list of problems;
   * an empty list is the normal state. */
  function validate(pic) {
    var problems = [];
    if (tileCount(pic) > MAX_TILES)
      problems.push(tileCount(pic) + " tiles, the ROM layout gives " + MAX_TILES);
    for (var m = FIRST_CHAR; m < pic.nextChar; m++) {
      var t = pic.tiles[m];
      if (!t) { problems.push("character " + hex(m) + " has no tile"); continue; }
      if (!isInt(t.palette) || t.palette < 0 || t.palette >= PALETTES)
        problems.push("tile " + hex(m) + " names palette " + t.palette);
      for (var i = 0; i < PIXELS; i++) {
        if (!isInt(t.pixels[i]) || t.pixels[i] < 0 || t.pixels[i] >= ENTRIES)
          problems.push("tile " + hex(m) + " pixel " + i + " = " +
                        t.pixels[i]);
      }
      if (coloursInTile(pic, m).length > ENTRIES)
        problems.push("tile " + hex(m) + " shows more than 16 colours");
    }
    for (var c = 0; c < pic.map.length; c++) {
      var ch = pic.map[c];
      if (!hasTile(pic, ch))
        problems.push("map cell " + c + " names character " + hex(ch) +
                      " with no tile");
    }
    for (var p = 0; p < PALETTES; p++)
      for (var e = 0; e < ENTRIES; e++)
        if (!isInt(pic.palettes[p][e]) || pic.palettes[p][e] < 0 ||
            pic.palettes[p][e] >= VCE_COLOURS)
          problems.push("palette " + p + " entry " + e + " = " +
                        pic.palettes[p][e]);
    if (!isInt(pic.backdrop) || pic.backdrop < 0 || pic.backdrop >= VCE_COLOURS)
      problems.push("backdrop = " + pic.backdrop);

    /* sprites (card #13) */
    if (pic.spritePatterns.length > 16)
      problems.push(pic.spritePatterns.length + " sprite patterns; the ROM " +
                    "layout gives 6 banks for tiles and patterns");
    for (var sp = 0; sp < pic.spritePatterns.length; sp++) {
      var pat = pic.spritePatterns[sp];
      if (!spriteSize(pat.width, pat.height))
        problems.push("sprite pattern " + sp + " is " + pat.width + "x" +
                      pat.height + " (no CGX/CGY size)");
      else if (pat.pixels.length !== pat.width * pat.height)
        problems.push("sprite pattern " + sp + " has " + pat.pixels.length +
                      " pixels, expected " + pat.width * pat.height);
      else
        for (var pi = 0; pi < pat.pixels.length; pi++)
          if (!isInt(pat.pixels[pi]) || pat.pixels[pi] < 0 ||
              pat.pixels[pi] >= SPRITE_ENTRIES)
            problems.push("sprite pattern " + sp + " pixel " + pi + " = " +
                          pat.pixels[pi]);
    }
    if (pic.spritePatterns.length) {
      var layout = patternLayout(pic);
      if (layout.endCell > SAT_CELL)
        problems.push("sprite patterns end at cell " + layout.endCell +
                      ", past the SAT at cell " + SAT_CELL);
    }
    if (pic.sprites.length > MAX_SPRITES)
      problems.push(pic.sprites.length + " sprites; the SAT holds " +
                    MAX_SPRITES);
    for (var si = 0; si < pic.sprites.length; si++) {
      var spr = pic.sprites[si];
      if (!isInt(spr.pattern) || spr.pattern < 0 ||
          spr.pattern >= pic.spritePatterns.length)
        problems.push("sprite " + si + " names pattern " + spr.pattern);
      if (!isInt(spr.x) || spr.x < 0 || spr.x >= VIEW_W)
        problems.push("sprite " + si + " x = " + spr.x);
      if (!isInt(spr.y) || spr.y < 0 || spr.y >= VIEW_H)
        problems.push("sprite " + si + " y = " + spr.y);
      if (!isInt(spr.palette) || spr.palette < 0 ||
          spr.palette >= SPRITE_PALETTES)
        problems.push("sprite " + si + " palette = " + spr.palette);
      for (var f = 0; f < 3; f++) {
        var name = ["priority", "hflip", "vflip"][f];
        var val = spr[name];
        if (val !== 0 && val !== 1)
          problems.push("sprite " + si + " " + name + " = " + val);
      }
    }
    for (var spp = 0; spp < SPRITE_PALETTES; spp++)
      for (var spe = 0; spe < SPRITE_ENTRIES; spe++) {
        var spc = pic.spritePalettes[spp][spe];
        if (!isInt(spc) || spc < 0 || spc >= VCE_COLOURS)
          problems.push("sprite palette " + spp + " entry " + spe + " = " + spc);
      }

    /* scanline effects (card #17): the table must build */
    if (pic.raster && (pic.raster.gradient || pic.raster.wobble ||
                       (pic.raster.bands && pic.raster.bands.length))) {
      try { toRaster(pic, 0); }
      catch (e) { problems.push("raster effects: " + e.message); }
    }
    return problems;
  }

  function stats(pic) {
    var used = {}, distinct = {}, tiles = 0, patternCells = 0;
    for (var c = FIRST_CHAR; c < pic.nextChar; c++) {
      var t = pic.tiles[c];
      if (!t) continue;
      tiles++;
      used[t.palette] = true;
      for (var i = 0; i < PIXELS; i++) distinct[t.pixels[i]] = true;
    }
    for (var sp = 0; sp < pic.spritePatterns.length; sp++) {
      var pat = pic.spritePatterns[sp];
      var size = spriteSize(pat.width, pat.height);
      patternCells += size ? size.cells : 0;
    }
    var tileBytes = tiles * 32;
    var patternBytes = patternCells * 128;   /* 64 words = 128 bytes a cell */
    return {
      tiles: tiles,
      palettesUsed: Object.keys(used).length,
      colourNumbers: Object.keys(distinct).length,
      charsFirst: FIRST_CHAR,
      charsLast: pic.nextChar - 1,
      spritePatterns: pic.spritePatterns.length,
      spritePatternCells: patternCells,
      sprites: pic.sprites.length,
      regionBytes: tileBytes + patternBytes
    };
  }

  /* ---- the demo picture ------------------------------------------------ */

  /* "Sunset over the bay" (256x224), painted from scratch through this
   * module's own calls — palette colours first, then every tile pixel and
   * every map cell.  Nothing is loaded from the #5 dumps.  Six of the 16
   * palettes are used, one per horizontal band; the band boundaries fall on
   * tile rows so every tile's colours are in its palette. */

  function c(r, g, b) { return colourWord(r, g, b); }

  var SEA_Y = 144;
  var SUN_X = 168, SUN_Y = 92, SUN_R = 26;

  var SUN_COLOURS = [c(7, 7, 6), c(7, 6, 3), c(7, 5, 1), c(7, 3, 0)];
  var MOUNT_COLOURS = [c(2, 0, 3), c(1, 0, 2), c(4, 1, 4)];
  var GLINT_COLOURS = [c(7, 6, 3), c(7, 5, 1), c(5, 3, 1)];

  var SKY_STOPS = [
    { y: 0,   colour: c(0, 0, 2) },
    { y: 48,  colour: c(1, 1, 4) },
    { y: 96,  colour: c(3, 1, 5) },
    { y: 120, colour: c(6, 2, 3) },
    { y: 143, colour: c(7, 4, 1) }
  ];
  var SEA_TOP = c(3, 2, 6);
  var SEA_DEEP = c(0, 0, 2);

  /* Four bands of the tile rows and the palette each one paints with, plus
   * the pixel rows they cover. */
  var BANDS = [
    { row0: 0,  row1: 6,  palette: 0, y0: 0,   y1: 47,  sky: true,  n: 9 },
    { row0: 6,  row1: 13, palette: 1, y0: 48,  y1: 103, sky: true,  n: 9,
      sun: true },
    { row0: 13, row1: 18, palette: 2, y0: 104, y1: 143, sky: true,  n: 8,
      sun: true, mountains: true },
    { row0: 18, row1: 22, palette: 3, y0: 144, y1: 175, sky: false, n: 8,
      glints: true },
    { row0: 22, row1: 26, palette: 4, y0: 176, y1: 207, sky: false, n: 8,
      glints: true },
    { row0: 26, row1: 28, palette: 5, y0: 208, y1: 223, sky: false, n: 8,
      glints: true }
  ];

  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  function round3(v) {
    return Math.max(0, Math.min(7, Math.round(v)));
  }

  function mix(a, b, t) {
    var ca = colourChannels(a), cb = colourChannels(b);
    return colourWord(round3(ca.r + (cb.r - ca.r) * t),
                      round3(ca.g + (cb.g - ca.g) * t),
                      round3(ca.b + (cb.b - ca.b) * t));
  }

  function skyAt(y) {
    if (y <= SKY_STOPS[0].y) return SKY_STOPS[0].colour;
    for (var i = 1; i < SKY_STOPS.length; i++) {
      if (y <= SKY_STOPS[i].y) {
        var a = SKY_STOPS[i - 1], b = SKY_STOPS[i];
        return mix(a.colour, b.colour, (y - a.y) / (b.y - a.y));
      }
    }
    return SKY_STOPS[SKY_STOPS.length - 1].colour;
  }

  function seaAt(y) {
    var t = (y - SEA_Y) / (VIEW_H - SEA_Y);
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return mix(SEA_TOP, SEA_DEEP, t);
  }

  function bandOfRow(row) {
    for (var i = 0; i < BANDS.length; i++)
      if (row >= BANDS[i].row0 && row < BANDS[i].row1) return BANDS[i];
    return BANDS[BANDS.length - 1];
  }

  /* Ordered dither between two neighbouring ramp entries. */
  function rampIndex(x, y, y0, y1, n) {
    var t = (y - y0) / (y1 - y0);
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    var pos = t * (n - 1);
    var i = Math.floor(pos);
    if (i >= n - 1) return 1 + (n - 1);
    var frac = pos - i;
    var threshold = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
    return 1 + i + (frac > threshold ? 1 : 0);
  }

  /* The far hills: a triangular island either side of the sun. */
  function islandTop(x) {
    var top = SEA_Y;
    if (x >= 8 && x <= 96)
      top = Math.min(top, SEA_Y - Math.max(0, 26 - Math.abs(x - 52)));
    if (x >= 196 && x <= 248)
      top = Math.min(top, SEA_Y - Math.max(0, 16 - Math.abs(x - 222)));
    return top;
  }

  function setBandPalette(pic, band) {
    var i;
    var palette = band.palette;
    for (i = 0; i < band.n; i++) {
      var y = band.y0 + i * (band.y1 - band.y0) / (band.n - 1);
      var colour = band.sky ? skyAt(y) : seaAt(y);
      setPaletteColour(pic, palette, 1 + i, colour);
    }
    var next = 1 + band.n;
    if (band.sun) {
      for (i = 0; i < SUN_COLOURS.length; i++)
        setPaletteColour(pic, palette, next++, SUN_COLOURS[i]);
    }
    if (band.mountains) {
      for (i = 0; i < MOUNT_COLOURS.length; i++)
        setPaletteColour(pic, palette, next++, MOUNT_COLOURS[i]);
    }
    if (band.glints) {
      for (i = 0; i < GLINT_COLOURS.length; i++)
        setPaletteColour(pic, palette, next++, GLINT_COLOURS[i]);
    }
    /* entries the band does not use repeat its darkest colour: never shown */
    while (next < ENTRIES)
      setPaletteColour(pic, palette, next++, band.sky ? skyAt(band.y0)
                                                      : seaAt(band.y0));
  }

  /* Paint one 8x8 tile of the demo: the sun, the hills, the sea, or the
   * band's dithered gradient. */
  function paintDemoTile(pic, char, band, tx, ty) {
    for (var py = 0; py < TILE; py++) {
      for (var px = 0; px < TILE; px++) {
        var x = tx * TILE + px, y = ty * TILE + py;
        var dx = x - SUN_X, dy = y - SUN_Y;
        var d = Math.sqrt(dx * dx + dy * dy);

        if (y >= SEA_Y) {
          /* the sun's glitter on the water */
          var width = Math.max(2, 14 - (y - SEA_Y) * 0.07);
          if (Math.abs(dx) < width && ((x * 7 + y * 5) % 9) < 3) {
            paintTileColour(pic, char, px, py,
                            GLINT_COLOURS[(y >> 2) % GLINT_COLOURS.length]);
            continue;
          }
          paintTileIndex(pic, char, px, py,
                         rampIndex(x, y, band.y0, band.y1, band.n));
          continue;
        }

        if (band.sun && d <= SUN_R) {
          var k = d < 8 ? 0 : d < 15 ? 1 : d < 21 ? 2 : 3;
          paintTileColour(pic, char, px, py, SUN_COLOURS[k]);
          continue;
        }

        if (band.mountains) {
          var top = islandTop(x);
          if (y >= top) {
            var peak = x < 100 ? 52 : 222;
            var colour = y < top + 2 ? MOUNT_COLOURS[2]
                       : x < peak ? MOUNT_COLOURS[1] : MOUNT_COLOURS[0];
            paintTileColour(pic, char, px, py, colour);
            continue;
          }
        }

        paintTileIndex(pic, char, px, py,
                       rampIndex(x, y, band.y0, band.y1, band.n));
      }
    }
  }

  function demoPicture() {
    var pic = newPicture();
    setBackdrop(pic, c(0, 0, 1));        /* deep navy */

    var band = null;
    for (var ty = 0; ty < BAT_H; ty++) {
      var b = bandOfRow(ty);
      if (b !== band) { band = b; setBandPalette(pic, band); }
      if (ty >= VIEW_H / TILE) {
        /* rows 28-31 are outside the 224-line view: left as the blank tile */
        break;
      }
      for (var tx = 0; tx < BAT_W; tx++) {
        var char = newTile(pic, band.palette);
        paintDemoTile(pic, char, band, tx, ty);
        paintMapCell(pic, tx, ty, char);
      }
    }

    dedupeTiles(pic);
    return pic;
  }

  /* ---- the sprite demo (card #13) -------------------------------------- */

  /* "Sprites over the bay": a background painted from scratch — a transparent
   * left half and an opaque ramp on the right, for the SPBG priority rule —
   * then six patterns (one per VDC size), all 16 sprite palettes, and 36
   * sprites into the SAT: every size, both flips, both priorities, an overlap
   * and a crowded line where 21 strips are requested and the VDC keeps 16.
   * Every pixel of every tile and pattern is painted through this module's
   * own calls; nothing comes from tests/dumps/. */

  var SPRITE_RAMP = [c(0, 1, 3), c(0, 2, 4), c(1, 3, 5), c(2, 4, 5),
                     c(3, 5, 6), c(4, 5, 6), c(5, 6, 7), c(7, 7, 7)];

  function spritePaletteWord(pal, entry) {
    return colourWord(1 + ((entry * 3 + pal) % 7),
                      1 + ((entry + pal * 2) % 7),
                      1 + ((entry * 2 + pal * 3) % 7));
  }

  function paintSpriteDemoPattern(pic, pattern, id) {
    var size = spritePatternSize(pic, pattern);
    for (var y = 0; y < size.height; y++) {
      for (var x = 0; x < size.width; x++) {
        var idx = (x === 0 || y === 0 || x === size.width - 1 ||
                   y === size.height - 1) ? 0
                : 1 + ((x * 3 + y * 5 + id * 7) % 15);
        paintSpriteIndex(pic, pattern, x, y, idx);
      }
    }
  }

  function spriteDemoPicture() {
    var pic = newPicture();
    setBackdrop(pic, c(0, 0, 1));                       /* deep navy */

    /* the right half's opaque ramp: one tile per tile row, all pixels the
     * row's colour NUMBER, so the background's low nibble is never 0 */
    for (var e = 0; e < SPRITE_RAMP.length; e++)
      setPaletteColour(pic, 1, 1 + e, SPRITE_RAMP[e]);

    var rowTiles = [];
    for (var ty = 0; ty < VIEW_H / TILE; ty++) {
      var char = newTile(pic, 1);
      var index = 1 + (ty % SPRITE_RAMP.length);
      for (var py = 0; py < TILE; py++)
        for (var px = 0; px < TILE; px++)
          paintTileIndex(pic, char, px, py, index);
      rowTiles.push(char);
      for (var mx = 0; mx < BAT_W; mx++)
        paintMapCell(pic, mx, ty, mx < BAT_W / 2 ? FIRST_CHAR : char);
    }
    dedupeTiles(pic);

    /* all 16 sprite palettes, entry 0 left transparent/black */
    for (var pal = 0; pal < SPRITE_PALETTES; pal++)
      for (var se = 1; se < SPRITE_ENTRIES; se++)
        setSpritePaletteColour(pic, pal, se, spritePaletteWord(pal, se));

    /* one pattern per size, in SPRITE_SIZES order */
    var patterns = [];
    for (var sz = 0; sz < SPRITE_SIZES.length; sz++) {
      var p = newSpritePattern(pic, SPRITE_SIZES[sz].width,
                               SPRITE_SIZES[sz].height);
      paintSpriteDemoPattern(pic, p, sz);
      patterns.push(p);
    }

    /* the size row: all six sizes, distinct palettes */
    addSprite(pic, { x: 8, y: 8, pattern: patterns[0], palette: 0 });
    addSprite(pic, { x: 32, y: 8, pattern: patterns[1], palette: 1 });
    addSprite(pic, { x: 72, y: 8, pattern: patterns[2], palette: 2 });
    addSprite(pic, { x: 96, y: 8, pattern: patterns[3], palette: 3 });
    addSprite(pic, { x: 136, y: 8, pattern: patterns[4], palette: 4 });
    addSprite(pic, { x: 160, y: 8, pattern: patterns[5], palette: 5 });

    /* flips: X, Y, both, a 32-px X-flip (halves swap) and a 16x32 Y-flip */
    addSprite(pic, { x: 8, y: 88, pattern: patterns[0], palette: 6, hflip: 1 });
    addSprite(pic, { x: 32, y: 88, pattern: patterns[0], palette: 7, vflip: 1 });
    addSprite(pic, { x: 56, y: 88, pattern: patterns[0], palette: 8,
                     hflip: 1, vflip: 1 });
    addSprite(pic, { x: 80, y: 88, pattern: patterns[1], palette: 9, hflip: 1 });
    addSprite(pic, { x: 120, y: 88, pattern: patterns[2], palette: 10,
                     vflip: 1 });

    /* priority: SPBG=0 over the transparent left half shows; SPBG=0 over the
     * opaque right half is hidden; SPBG=1 over it shows; two sprites overlap
     * and the lower SAT index wins where both are opaque */
    addSprite(pic, { x: 8, y: 152, pattern: patterns[0], palette: 11,
                     priority: 0 });
    addSprite(pic, { x: 160, y: 152, pattern: patterns[0], palette: 12,
                     priority: 0 });
    addSprite(pic, { x: 184, y: 152, pattern: patterns[0], palette: 13 });
    addSprite(pic, { x: 216, y: 152, pattern: patterns[0], palette: 14 });
    addSprite(pic, { x: 224, y: 152, pattern: patterns[0], palette: 15,
                     priority: 0 });

    /* the crowded line: 15 strips, then a 32-px sprite whose left strip is
     * the 16th and whose right strip is dropped, then four more sprites that
     * are dropped entirely — 21 strips requested, 16 kept */
    for (var i = 0; i < 15; i++)
      addSprite(pic, { x: 8 + 13 * i, y: 200, pattern: patterns[0],
                       palette: i % SPRITE_PALETTES });
    addSprite(pic, { x: 203, y: 200, pattern: patterns[1], palette: 3 });
    for (var j = 0; j < 4; j++)
      addSprite(pic, { x: 210 + 13 * j, y: 200, pattern: patterns[0],
                       palette: j });

    return pic;
  }

  return {
    VCE_COLOURS: VCE_COLOURS,
    PALETTES: PALETTES,
    ENTRIES: ENTRIES,
    TILE: TILE,
    BAT_W: BAT_W,
    BAT_H: BAT_H,
    VIEW_W: VIEW_W,
    VIEW_H: VIEW_H,
    FIRST_CHAR: FIRST_CHAR,
    LAST_CHAR: LAST_CHAR,
    MAX_TILES: MAX_TILES,
    SPRITE_PALETTES: SPRITE_PALETTES,
    SPRITE_ENTRIES: SPRITE_ENTRIES,
    MAX_SPRITES: MAX_SPRITES,
    SAT_ADDR: SAT_ADDR,
    SAT_CELL: SAT_CELL,
    LINE_STRIPS: LINE_STRIPS,
    STRIP_PX: STRIP_PX,
    SPRITE_SIZES: SPRITE_SIZES,
    RASTER_LINES: RASTER_LINES,
    RASTER_LINE_MAX: RASTER_LINE_MAX,
    BXR_MAX: BXR_MAX,
    BYR_MAX: BYR_MAX,

    colourWord: colourWord,
    colourChannels: colourChannels,

    newPicture: newPicture,
    setBackdrop: setBackdrop,
    setPaletteColour: setPaletteColour,
    paletteColours: paletteColours,
    newTile: newTile,
    setTilePalette: setTilePalette,
    paintTileIndex: paintTileIndex,
    paintTileColour: paintTileColour,
    tilePixels: tilePixels,
    tilePalette: tilePalette,
    coloursInTile: coloursInTile,

    paintMapCell: paintMapCell,
    mapCell: mapCell,
    dedupeTiles: dedupeTiles,

    newSpritePattern: newSpritePattern,
    spritePatternCount: spritePatternCount,
    spritePatternSize: spritePatternSize,
    spritePatternPixels: spritePatternPixels,
    paintSpriteIndex: paintSpriteIndex,
    setSpritePaletteColour: setSpritePaletteColour,
    spritePaletteColours: spritePaletteColours,
    addSprite: addSprite,
    removeSprite: removeSprite,
    clearSprites: clearSprites,
    spriteLineBudget: spriteLineBudget,
    spriteBudget: spriteBudget,
    patternLayout: patternLayout,
    satWords: satWords,

    setScroll: setScroll,
    setGradient: setGradient,
    clearGradient: clearGradient,
    setWobble: setWobble,
    clearWobble: clearWobble,
    setParallaxBands: setParallaxBands,
    clearBands: clearBands,
    clearEffects: clearEffects,
    toRaster: toRaster,
    renderPreview: renderPreview,

    toPicture: toPicture,
    viewRegs: viewRegs,
    validate: validate,
    stats: stats,
    demoPicture: demoPicture,
    spriteDemoPicture: spriteDemoPicture
  };
});
