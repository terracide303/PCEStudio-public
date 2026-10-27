/*
 * pce-editor.js — PCEStudio's first editor: tiles, palettes, the background
 * map (card #10).
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
 * Facts (BAT word layout, 4-bit pixels, palette fixup, VRAM size, CRAM
 * layout) are from the Hudson HuC6270/HuC6260 manuals, as recorded in
 * docs/RENDERER.md; the ROM limits are docs/ROM_LAYOUT.md's.  This module
 * does not render: renderer/pce-bg.js is the model, and the editor preview
 * and the tests draw through it so there is one picture definition.
 *
 * Dual use: CommonJS module in Node (tests/check-editor.js) and a browser
 * global (renderer/editor.html) via a UMD-style wrapper, like pce-bg.js.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.editor = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
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
  var MWR_32x32 = 0x00;

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
      scroll: { BXR: 0, BYR: 0 }
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
    pic.nextChar++;
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

  /* ---- what the hardware would hold ----------------------------------- */

  /* The picture as the viewer ROM lays it out: 32768 words of VRAM (BAT at
   * word 0, tiles from character $40), 512 CRAM entries (the 16 background
   * palettes at 0-255, the unused sprite palettes 256-511 left black), the
   * four config registers and one tile region.  This is the object
   * renderer/pce-rom.js turns into a .pce. */
  function toPicture(pic) {
    var vram = new Uint8Array(65536);
    var i, m;

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

    var cram = new Uint8Array(1024);
    for (var p = 0; p < PALETTES; p++) {
      for (var e = 0; e < ENTRIES; e++) {
        var colour = e === 0 ? pic.backdrop : pic.palettes[p][e];
        var off = (p * ENTRIES + e) * 2;
        cram[off] = colour & 0xFF;
        cram[off + 1] = (colour >> 8) & 0xFF;
      }
    }

    return {
      vram: vram,
      cram: cram,
      regs: { BXR: pic.scroll.BXR, BYR: pic.scroll.BYR,
              MWR: MWR_32x32, CR: CR_BG_ON },
      regions: [[FIRST_CHAR, tileCount(pic)]],
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
      MWR: MWR_32x32, CR: CR_BG_ON,
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
    return problems;
  }

  function stats(pic) {
    var used = {}, distinct = {}, tiles = 0;
    for (var c = FIRST_CHAR; c < pic.nextChar; c++) {
      var t = pic.tiles[c];
      if (!t) continue;
      tiles++;
      used[t.palette] = true;
      for (var i = 0; i < PIXELS; i++) distinct[t.pixels[i]] = true;
    }
    return {
      tiles: tiles,
      palettesUsed: Object.keys(used).length,
      colourNumbers: Object.keys(distinct).length,
      charsFirst: FIRST_CHAR,
      charsLast: pic.nextChar - 1
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

    toPicture: toPicture,
    viewRegs: viewRegs,
    validate: validate,
    stats: stats,
    demoPicture: demoPicture
  };
});
