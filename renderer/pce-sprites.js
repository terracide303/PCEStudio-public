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
   * vdwLine is the VDW line number (0 = display row 0, VCE line 17).
   *
   * collectLine is the one SAT search: collectStrips (what is drawn) and
   * lineStatus (card #50's OR/CC conditions) both read its result, so the
   * status cannot disagree with the picture.  It also counts every strip the
   * on-line sprites ask for (a CGX sprite asks for two — manual 2.4.3, and
   * the 16-strip limit this model measured in #12/#40), including the ones
   * past 16 that are dropped — the overflow condition. */
  function collectLine(sat, vdwLine) {
    var strips = [];
    var requested = 0, onLine = 0;
    for (var i = 0; i < 64; i++) {
      var y = (sat[i * 8] | (sat[i * 8 + 1] << 8)) & 0x3FF;
      var x = (sat[i * 8 + 2] | (sat[i * 8 + 3] << 8)) & 0x3FF;
      var w2 = sat[i * 8 + 4] | (sat[i * 8 + 5] << 8);
      var w3 = sat[i * 8 + 6] | (sat[i * 8 + 7] << 8);
      var height = CGY_HEIGHT[(w3 >> 12) & 3];
      var row0 = y - 64;
      if (vdwLine < row0 || vdwLine >= row0 + height) {
        continue;
      }
      var cgx = (w3 >> 8) & 1;
      onLine++;
      requested += cgx ? 2 : 1;
      if (strips.length >= 16) {
        continue;                      /* past the line budget: dropped */
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
      if (cgx) {                       /* CGX: two strips, halves p&~1, p&~1+1 */
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
    return { strips: strips, requested: requested, sprites: onLine };
  }

  function collectStrips(sat, vdwLine) {
    return collectLine(sat, vdwLine).strips;
  }

  /* The four plane words a strip reads — one decode shared by paintLine and
   * lineStatus. */
  function stripWords(vram, s) {
    var base = s.cell * 64 + s.row;
    return [vram[base * 2] | (vram[base * 2 + 1] << 8),
            vram[(base + 16) * 2] | (vram[(base + 16) * 2 + 1] << 8),
            vram[(base + 32) * 2] | (vram[(base + 32) * 2 + 1] << 8),
            vram[(base + 48) * 2] | (vram[(base + 48) * 2 + 1] << 8)];
  }

  /* Strip pixel c (0 = left) of the four plane words.  Bit 15 of a plane is
   * the leftmost strip pixel; HFLIP mirrors the strip's pixels. */
  function stripPixel(words, hflip, c) {
    var bit = hflip ? c : 15 - c;
    return ((words[0] >> bit) & 1)
         | (((words[1] >> bit) & 1) << 1)
         | (((words[2] >> bit) & 1) << 2)
         | (((words[3] >> bit) & 1) << 3);
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
      var words = stripWords(vram, s);
      for (var c = 0; c < 16; c++) {
        var tx = s.x + c;
        if (tx < 0 || tx >= 256) {
          continue;
        }
        var pix = stripPixel(words, s.hflip, c);
        if (pix) {
          layer[tx] = { index: 0x100 | (s.pal << 4) | pix, spbg: s.spbg,
                        number: s.number, cell: s.cell, row: s.row,
                        strip: c, hflip: s.hflip };
        }
      }
    }
    return layer;
  }

  /* ---- the status register (card #50) ---------------------------------- */

  /* The VDW display height: VDR R0D is 9 bits and holds lines-1 (manual
   * H7-10), so the 256x240 mode's $00EF is 240 display lines.  A dump carries
   * it as VDR or Mednafen's VDW_cache; a picture with neither is that mode. */
  function displayLines(regs) {
    var vdr = regs.VDR != null ? regs.VDR
            : regs.VDW_cache != null ? regs.VDW_cache
            : regs.VDW != null ? regs.VDW : 0xEF;
    return (vdr & 0x1FF) + 1;
  }

  /* The two status events the VDC's line timing decides (HuC6270 SR p. H7-4):
   *
   *   rr[line]     the scanning-line counter matched RCR.  The counter is set
   *                to 64 at the line before display starts and incremented
   *                each scan (RCR R06 p. H7-6..H7-7), so a match is
   *                RCR = 0x40 + line and fires at the end of line-1 — the
   *                HBlank before `line` (the #15/#16 rule).  With a raster
   *                table the handler re-arms RCR to 0x40 + the next entry's
   *                line (docs/RENDERER.md), so the matches are exactly the
   *                table's entry lines; without one the saved RCR register is
   *                the constant the match uses.  The array runs 0..vdw: an
   *                entry may fire on the VBlank line (raster5's 240, the last
   *                display line's HBlank).
   *   vblankLine   VD is set when vertical blanking starts: the first VDW
   *                line after the display lines (H7-4).
   *
   * The register bit is the event AND the CR enable (RC bit 2 / VC bit 3,
   * CR R05 p. H7-5..H7-6); status() applies the enables. */
  function statusTiming(regs, raster) {
    var vdw = displayLines(regs);
    var rr = new Uint8Array(vdw + 1);
    var entries = raster && raster.entries
      ? raster.entries.slice().sort(function (a, b) {
          return a.line - b.line;
        }) : [];
    if (entries.length) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].line >= 0 && entries[i].line <= vdw) {
          rr[entries[i].line] = 1;
        }
      }
    } else if (regs.RCR != null) {
      var line = (regs.RCR & 0x3FF) - 0x40;
      if (line >= 0 && line <= vdw) rr[line] = 1;
    }
    return { vdw: vdw, vblankLine: vdw, rr: rr };
  }

  /* The sprite conditions one display line sets, computed from the very SAT
   * search and plane words the renderer draws (HuC6270 manual SR p. H7-4):
   *
   *   overflow — the OR condition: "An attempt was made to display more than
   *     17 [sic] sprites on a scanning line."  A line holds 16 strips, and a
   *     CGX sprite spends two (manual 2.4.3 p. H7-19; the 16-strip count is
   *     the hardware budget this model measured in #12/#40), so the attempt
   *     is a 17th strip: the strips the on-line sprites ask for > 16.
   *   collision — the CC condition: "sprite #0 has collided with any of
   *     sprites #1-#63."  Both must have an opaque (non-zero) pixel at the
   *     same display column on this line; pixel 0 is transparent.  Only the
   *     strips inside the line's budget are drawn, so only they can collide
   *     (the VDC, like Mednafen's DrawSprites, stops collecting at 16 and
   *     draws nothing past it).
   *
   * These are the conditions the hardware detects; the status register bit
   * is set only when the matching CR interrupt enable is on (CC bit 0, OC
   * bit 1 — CR R05 p. H7-5..H7-6).  status() below applies that gate and
   * reports both. */
  function lineStatus(vram, sat, vdwLine) {
    var c = collectLine(sat, vdwLine);
    var own = new Uint8Array(256), other = new Uint8Array(256);
    for (var i = 0; i < c.strips.length; i++) {
      var s = c.strips[i];
      var words = stripWords(vram, s);
      var mask = s.number === 0 ? own : other;
      for (var x = 0; x < 16; x++) {
        var dx = s.x + x;
        if (dx < 0 || dx >= 256) continue;
        if (stripPixel(words, s.hflip, x)) mask[dx] = 1;
      }
    }
    var collision = false;
    for (var px = 0; px < 256 && !collision; px++) {
      collision = !!(own[px] && other[px]);
    }
    return {
      line: vdwLine,
      sprites: c.sprites,
      strips: c.strips.length,
      requested: c.requested,
      dropped: c.requested - c.strips.length,
      overflow: c.requested > 16,
      collision: collision
    };
  }

  /* One frame's status, per rendered scanline and for the frame (card #50).
   * The conditions are lineStatus's sprite findings plus pce-bg.js's
   * statusTiming events (RR from the RCR line match, VD from the start of
   * vertical blanking); the register bits are those conditions AND the CR
   * enable each needs (CC 0, OC 1, RC 2, VC 3 — CR R05 p. H7-5..H7-6).  The
   * accumulated `sr` is what the status register would hold after the frame
   * if the CPU never read it; a read clears bits 0-5 (SR p. H7-4), which the
   * model does not simulate — the #15/#16 ROMs' handler reads it every
   * interrupt and the Mednafen comparison in tests/check-status.js accounts
   * for that.
   *
   * The per-line table covers the rendered rows (the dumps capture VDW lines
   * 1..232 of 0..239); VD happens on the first line past the display window
   * and is reported at frame level as `vblankLine`.  The frame's RR covers
   * the whole VDW display, including a match on the VBlank line that the
   * window does not render (raster5's line 240). */
  function status(opts) {
    var regs = opts.regs || {};
    var width = opts.width || 256;
    var height = opts.height || 232;
    var firstScanline = opts.firstScanline != null ? opts.firstScanline : 18;
    var rows = bg.buildRows(opts);
    var timing = statusTiming(regs, opts.raster);
    var vdwLine0 = (regs.RCRCount != null && regs.scanline != null)
      ? regs.RCRCount - (regs.scanline - firstScanline) : 0;
    var lines = [];
    var frame = {
      vdw: timing.vdw, vblankLine: timing.vblankLine,
      OR: false, CC: false, RR: false, VD: true,
      orBit: false, ccBit: false, rrBit: false, vdBit: false, sr: 0
    };
    for (var r = 0; r < height; r++) {
      var L = vdwLine0 + r;
      var cr = rows ? rows.cr[r] : ((regs.CR || 0) & 0xFF);
      /* the VDC searches sprites when the layer is on (SB, CR bit 6) or an
       * overflow/collision interrupt is enabled (OC/CC, bits 1/0): Mednafen
       * runs DrawSprites on `(CR & 0x40) && (drawing || (CR & 0x03))`, and
       * with the layer off and no enable nothing is drawn and no condition
       * can arise. */
      var detect = !!(cr & 0x40) || !!(cr & 0x03);
      var cond = opts.sat && detect ? lineStatus(opts.vram, opts.sat, L) : null;
      var rr = L >= 0 && L < timing.rr.length ? !!timing.rr[L] : false;
      var vd = L === timing.vblankLine;
      var st = {
        row: r, line: L, CR: cr,
        OR: cond ? cond.overflow : false,
        CC: cond ? cond.collision : false,
        RR: rr, VD: vd,
        orBit: !!(cond && cond.overflow && (cr & 0x02)),
        ccBit: !!(cond && cond.collision && (cr & 0x01)),
        rrBit: !!(rr && (cr & 0x04)),
        vdBit: !!(vd && (cr & 0x08)),
        sprites: cond ? cond.sprites : 0,
        strips: cond ? cond.strips : 0,
        requested: cond ? cond.requested : 0,
        dropped: cond ? cond.dropped : 0
      };
      frame.OR = frame.OR || st.OR;
      frame.CC = frame.CC || st.CC;
      frame.orBit = frame.orBit || st.orBit;
      frame.ccBit = frame.ccBit || st.ccBit;
      frame.rrBit = frame.rrBit || st.rrBit;
      lines.push(st);
    }
    /* the VBlank event's CR: the last value the table holds (no entry fires
     * between the window and vblanking in these pictures) */
    var vblankCr = rows ? rows.cr[height - 1] : ((regs.CR || 0) & 0xFF);
    frame.vdBit = !!(vblankCr & 0x08);
    /* RR over the whole display + the VBlank line, with the CR the window
     * ends on for the rows it does not render */
    for (var k = 0; k < timing.rr.length; k++) {
      if (!timing.rr[k]) continue;
      frame.RR = true;
      var row = k - vdwLine0;
      var crAt = vblankCr;
      if (row >= 0 && row < height) {
        crAt = rows ? rows.cr[row] : ((regs.CR || 0) & 0xFF);
      }
      if (crAt & 0x04) frame.rrBit = true;
    }
    frame.sr = (frame.ccBit ? 0x01 : 0)
             | (frame.orBit ? 0x02 : 0)
             | (frame.rrBit ? 0x04 : 0)
             | (frame.vdBit ? 0x20 : 0);
    return { lines: lines, frame: frame, timing: timing,
             width: width, height: height };
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
    /* #48: the VDC searches and draws sprites only inside its display
     * window (Mednafen draws sprites under the same `display_counter` gate
     * as the background; the outside is the $100 border). The SAT's X=32 is
     * the window's first display column, so screen x shows display column
     * x - win.x0. No capture exercises a sprite on a narrowed window yet —
     * this is the model's placement, written down in docs/RENDERER.md as
     * not proven. */
    var win = bg.displayWindow(opts);
    var wx0 = Math.min(width, Math.max(0, win.x0));
    var wx1 = Math.min(width, Math.max(0, win.x1));
    var wy0 = Math.min(height, Math.max(0, win.y0));
    var wy1 = Math.min(height, Math.max(0, win.y1));
    var out = new Uint16Array(img.indices);
    for (var r = 0; r < height; r++) {
      if (r < wy0 || r >= wy1) {
        continue;    /* outside the vertical window: border, no sprites */
      }
      if (rows && !(rows.cr[r] & 0x40)) {
        continue;    /* SB clear on this line: no sprites (CR is per-line) */
      }
      var strips = collectStrips(sat, vdwLine0 + r);
      if (!strips.length) {
        continue;
      }
      var layer = paintLine(vram, strips);
      var o = r * width;
      for (var x = wx0; x < wx1; x++) {
        var s = layer[x - win.x0];
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
    lineStatus: lineStatus,
    status: status,
    paintLine: paintLine,
    spriteSize: spriteSize,
    spriteCells: spriteCells,
    renderIndices: renderIndices,
    renderFrame: renderFrame
  };
});
