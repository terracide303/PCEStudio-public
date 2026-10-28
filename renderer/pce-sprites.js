/*
 * pce-sprites.js — PCEStudio VDC sprite renderer (card #12).
 *
 * Composes the HuC6270 VDC's sprite layer (SATB) over the background renderer
 * (pce-bg.js), exactly as the VDC draws it in 256x224 mode: 64 SAT entries,
 * sizes 16x16 to 32x64 via CGX/CGY, X/Y flips, 16 sprite palettes (VCE
 * colour-table entries 0x100+), SPBG priority against the background, and at
 * most 16 strips (16-px sprite columns) per display line in SATB order — the
 * rest of the line's sprites are dropped.  This is PCEStudio's own model,
 * written from the Hudson HuC6270 manual (2.4, p. H7-19..H7-24) with Mednafen
 * and the MiSTer core as references for verification only; the facts and page
 * references are in docs/RENDERER.md.
 *
 * The model, per SAT entry (word 0 = Y, 1 = X, 2 = pattern << 1 — bit 0 is
 * the 4-colour mode, not exercised here —, 3 = palette 0-3 / SPBG 7 / CGX 8 /
 * HFLIP 11 / CGY 12-13 / VFLIP 15):
 *   - SAT Y 64 = display row 0 (a sprite covers display rows Y-64 .. Y-64+h-1,
 *     h = 16/32/64/64 for CGY 0/1/2/3); SAT X 32 = display column 0.
 *   - The pattern code p (word 2 >> 1) addresses 64-word VRAM cells: cell p
 *     holds four 16-word planes (SG0..SG3) at +0/+16/+32/+48 words + row.
 *     The VDC masks p's low bits per size and adds the block/half select:
 *     16x16 = cell p; 16x32 = cells p&~2, p&~2+2 (2CGY blocks are pattern
 *     codes with PC2 = pattern bit 1); 16x64 = p&~6 + {0,2,4,6} (4CGY:
 *     PC3,PC2); 32-px wide (CGX) = halves p&~1, p&~1+1 (PC1), HFLIP
 *     swapping them.  VFLIP reverses the rows within each cell and the
 *     block order.  A sprite taller than 16 px reads its blocks' rows with
 *     the row counter starting at 0 in every cell.
 *   - Each 16-px strip counts against the line's 16-strip budget, in SATB
 *     order (lowest SAT index first).  Lower SAT index = higher priority:
 *     where strips overlap, the lower index wins the pixel.
 *   - Sprite pixel 0 is transparent.  A visible sprite pixel replaces the
 *     background when its SPBG bit is 1, or when the background pixel's
 *     colour number (its low nibble) is 0 — so an SPBG=0 sprite still shows
 *     over the backdrop (0x000) and over the BB-off blanking fill (0x100).
 *   - Word bit 15 of a plane is the leftmost pixel of the strip; HFLIP
 *     mirrors the pixels within each 16-px strip.
 *
 * Input: the pce-bg.js options plus
 *   sat: Uint8Array, 512 bytes = 256 uint16 LE SATB words (64 entries x 4)
 *        from tools/mcs-extract.py.
 *   raster: optional #15 raster table (per-line CR gates the sprite layer
 *        and per-line CRAM writes change the sprite colours — pce-bg.js).
 *
 * Dual use: CommonJS module in Node (tests/check.js) and a browser global
 * (renderer/index.html) via a UMD-style wrapper.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./pce-bg.js"));
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.sprites = factory(root.PCEStudio.bg);
  }
})(typeof self !== "undefined" ? self : this, function (bg) {
  "use strict";

  /* CGY -> { height, cells the sprite reads (relative to the masked base) }.
   * The VDC masks the pattern code's low bits and adds the block select:
   *   no = (p & mask) | ((yoff & 0x30) >> 3)  (Mednafen FetchSpriteData,
   *   MiSTer SPR_TILE_N — both agree with the manual's CGY section, where
   *   2CGY/4CGY blocks are pattern codes differing in PC2/PC3: cells 2
   *   apart). */
  var CGY_HEIGHT = [16, 32, 64, 64];
  var CGY_MASK = [0x3FF, 0x3FF & ~2, 0x3FF & ~6, 0x3FF & ~6];

  /* The VDC size of SAT entry i: CGX bit 8 doubles the width, CGY bits 12-13
   * pick 16/32/64/64 tall (manual 2.4, p. H7-19..H7-24). */
  function spriteSize(sat, i) {
    var w3 = sat[i * 8 + 6] | (sat[i * 8 + 7] << 8);
    var cgy = (w3 >> 12) & 3;
    var cgx = (w3 >> 8) & 1;
    return { width: cgx ? 32 : 16, height: CGY_HEIGHT[cgy],
             cgy: cgy, cgx: cgx };
  }

  /* Every 64-word VRAM cell SAT entry i reads over the sprite's whole height:
   * CGY blocks are cells 2 apart (PC2/PC3), CGX reads the half pair
   * (PC1).  collectStrips computes the same cells per row; the #26 VRAM map
   * needs them all at once. */
  function spriteCells(sat, i) {
    var w2 = sat[i * 8 + 4] | (sat[i * 8 + 5] << 8);
    var w3 = sat[i * 8 + 6] | (sat[i * 8 + 7] << 8);
    var cgy = (w3 >> 12) & 3;
    var cgx = (w3 >> 8) & 1;
    var p = (w2 >> 1) & 0x3FF;
    var base = p & CGY_MASK[cgy];
    var blocks = [0, 2, 4, 6].slice(0, [1, 2, 4, 4][cgy]);
    var cells = [];
    for (var b = 0; b < blocks.length; b++) {
      if (cgx) {
        var pair = (base + blocks[b]) & ~1;
        cells.push(pair);
        cells.push(pair | 1);
      } else {
        cells.push(base + blocks[b]);
      }
    }
    return cells;
  }

  /* One strip of the line's sprite list: everything DrawSprites needs to
   * paint 16 pixels.  Collected in SATB order; painted last-to-first so the
   * lowest SAT index wins overlaps.  `number` is the SAT entry the strip came
   * from (the #26 follow-a-pixel panel names the sprite). */
  function strip(cell, x, row, pal, spbg, hflip, number) {
    return { cell: cell, x: x, row: row, pal: pal, spbg: spbg, hflip: hflip,
             number: number };
  }

  /* The strips on one display line, in SATB order, at most 16 (the VDC
   * stops collecting when the line is full; sprites 17+ in SATB order are
   * dropped — manual 2.4.3 "sprites exceeding the limit are not displayed").
   * vdwLine is the VDW line number (0 = display row 0, VCE line 17). */
  function collectStrips(sat, vdwLine) {
    var strips = [];
    for (var i = 0; i < 64 && strips.length < 16; i++) {
      var y = (sat[i * 8] | (sat[i * 8 + 1] << 8)) & 0x3FF;
      var x = (sat[i * 8 + 2] | (sat[i * 8 + 3] << 8)) & 0x3FF;
      var w2 = sat[i * 8 + 4] | (sat[i * 8 + 5] << 8);
      var w3 = sat[i * 8 + 6] | (sat[i * 8 + 7] << 8);
      var height = CGY_HEIGHT[(w3 >> 12) & 3];
      var row0 = y - 64;
      if (vdwLine < row0 || vdwLine >= row0 + height) {
        continue;
      }
      var yoff = vdwLine - row0;
      if (w3 & 0x8000) {
        yoff = height - 1 - yoff;      /* VFLIP before the block select */
      }
      var p = (w2 >> 1) & 0x3FF;
      var cell = (p & CGY_MASK[(w3 >> 12) & 3]) | ((yoff & 0x30) >> 3);
      var row = yoff & 15;             /* the row counter restarts per cell */
      var hflip = (w3 >> 11) & 1;
      var spbg = (w3 >> 7) & 1;
      var pal = w3 & 0xF;
      var leftX = x - 32;
      if ((w3 >> 8) & 1) {             /* CGX: two strips, halves p&~1, p&~1+1 */
        cell &= ~1;
        /* HFLIP swaps the halves (left strip shows the right half's cell)
         * and mirrors each strip's pixels (below). */
        strips.push(strip(hflip ? cell | 1 : cell, leftX, row, pal, spbg,
                          hflip, i));
        if (strips.length < 16) {
          strips.push(strip(hflip ? cell : cell | 1, leftX + 16, row, pal,
                            spbg, hflip, i));
        }
      } else {
        strips.push(strip(cell, leftX, row, pal, spbg, hflip, i));
      }
    }
    return strips;
  }

  /* The sprite layer of one line: layer[x] = { index, spbg, number, cell,
   * row, strip } of the winning (lowest SAT index) visible sprite pixel, or
   * null.  The extra fields are the #26 panel's provenance.  Strips paint in
   * reverse SATB order so lower indices overwrite — the same result as the
   * VDC's first-16 collection plus last-drawn-wins order. */
  function paintLine(vram, strips) {
    var layer = new Array(256).fill(null);
    for (var i = strips.length - 1; i >= 0; i--) {
      var s = strips[i];
      var base = s.cell * 64 + s.row;
      var w0 = vram[base * 2] | (vram[base * 2 + 1] << 8);
      var w1 = vram[(base + 16) * 2] | (vram[(base + 16) * 2 + 1] << 8);
      var w2 = vram[(base + 32) * 2] | (vram[(base + 32) * 2 + 1] << 8);
      var w3 = vram[(base + 48) * 2] | (vram[(base + 48) * 2 + 1] << 8);
      for (var c = 0; c < 16; c++) {
        var tx = s.x + c;
        if (tx < 0 || tx >= 256) {
          continue;
        }
        /* bit 15 of a plane word is the leftmost strip pixel; HFLIP
         * mirrors the strip's pixels. */
        var bit = s.hflip ? c : 15 - c;
        var pix = ((w0 >> bit) & 1)
                | (((w1 >> bit) & 1) << 1)
                | (((w2 >> bit) & 1) << 2)
                | (((w3 >> bit) & 1) << 3);
        if (pix) {
          layer[tx] = { index: 0x100 | (s.pal << 4) | pix, spbg: s.spbg,
                        number: s.number, cell: s.cell, row: s.row,
                        strip: c, hflip: s.hflip };
        }
      }
    }
    return layer;
  }

  /* One rendered frame: the background's colour indexes with the sprite
   * layer composed on top (then mapped through CRAM to RGB).  With a #15
   * raster table, CR is latched per line: a line whose CR has bit 6 (SB)
   * clear draws no sprites, and every line decodes through its own colour
   * table. */
  function renderIndices(opts) {
    var rows = bg.buildRows(opts);
    var img = bg.renderIndices(opts, rows);
    if (!opts.sat) {
      return img;
    }
    if (!rows && !(opts.regs.CR & 0x40)) {
      return img;   /* SB clear: no sprites (CR R05, manual p. H7-5) */
    }
    var sat = opts.sat;
    var vram = opts.vram;
    var width = img.width, height = img.height;
    var firstScanline = opts.firstScanline != null ? opts.firstScanline : 18;
    /* The sprite layer of captured row r is the one the VDC collects for
     * VDW line vdwLine0 + r — the same calibration pce-bg.js derives from
     * the state's own counters (RCRCount = scanline - 17 at the save). */
    var vdwLine0 = opts.regs.RCRCount - (opts.regs.scanline - firstScanline);
    var out = new Uint16Array(img.indices);
    for (var r = 0; r < height; r++) {
      if (rows && !(rows.cr[r] & 0x40)) {
        continue;    /* SB clear on this line: no sprites (CR is per-line) */
      }
      var strips = collectStrips(sat, vdwLine0 + r);
      if (!strips.length) {
        continue;
      }
      var layer = paintLine(vram, strips);
      var o = r * width;
      for (var x = 0; x < width; x++) {
        var s = layer[x];
        if (s && (s.spbg || !(img.indices[o + x] & 0xF))) {
          out[o + x] = s.index;
        }
      }
    }
    return { width: width, height: height, indices: out };
  }

  function renderFrame(opts) {
    var rows = bg.buildRows(opts);
    var img = renderIndices(opts);
    var flatRgb = bg.decodeCram(opts.cram);
    var px = new Uint8Array(img.width * img.height * 3);
    for (var r = 0; r < img.height; r++) {
      var rgb = rows ? rows.rgb[r] : flatRgb;
      var o0 = r * img.width * 3;
      for (var x = 0; x < img.width; x++) {
        var ci = img.indices[r * img.width + x];
        px[o0 + x * 3] = rgb[ci * 3];
        px[o0 + x * 3 + 1] = rgb[ci * 3 + 1];
        px[o0 + x * 3 + 2] = rgb[ci * 3 + 2];
      }
    }
    return { width: img.width, height: img.height, pixels: px };
  }

  return {
    collectStrips: collectStrips,
    paintLine: paintLine,
    spriteSize: spriteSize,
    spriteCells: spriteCells,
    renderIndices: renderIndices,
    renderFrame: renderFrame
  };
});
