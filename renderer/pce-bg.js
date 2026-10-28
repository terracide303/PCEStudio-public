/*
 * pce-bg.js — PCEStudio VDC/VCE background renderer (card #5).
 *
 * Renders one 256x232 RGB frame from a VRAM dump, a colour-table dump and a
 * handful of register values, exactly as the HuC6270 VDC background layer and
 * the HuC6260 VCE colour decoder produce it in 256x224 mode.  This is
 * PCEStudio's own model, written from the Hudson HuC6270/HuC6260 manuals
 * (facts and page references in docs/RENDERER.md); Mednafen was used as a
 * reference for verification only — no emulator code is copied or linked.
 *
 * Input (see tools/mcs-extract.py for where the values come from):
 *   vram: Uint8Array, 65536 bytes = 32768 uint16 little-endian words
 *   cram: Uint8Array, 1024 bytes = 512 uint16 LE colour-table entries
 *         (bits 0-8 colour — G=6-8, R=3-5, B=0-2).  Bit 8 is the top bit of
 *         green, not a separate CG bit; bits above 8 are not exercised by any
 *         dump, so what the VCE does with them is not modelled here.
 *   regs: { BYR, BXR, MWR, CR, BG_YOffset, scanline, ... }
 *   firstScanline: VCE scanline of captured row 0 (18 for slstart=4:
 *     Mednafen DisplayRect.y = 14 + slstart, 14 lines of top blanking)
 *   raster: optional #15 raster table (see buildRows below) — per-scanline
 *     CPU writes to BXR/BYR/CR and the VCE colour table.
 *
 * Layer scope: background only; the sprite layer composes on top of the
 * colour-index buffer via pce-sprites.js (#12).  CR bit 7 (BB) is modelled:
 * when it is clear the VDC clears the background and every pixel shows the
 * blanking-period video data — SPBG = 1, VD7..VD0 = 0, i.e. the 9-bit colour
 * index 0x100, CRAM[0x100] (2.3.6 p. H7-18).  Colour 0 of any BG palette in
 * a displayed background is fixed up to CRAM[0x000] (the backdrop entry),
 * per the VDC datasheet and Mednafen's FixPCache behaviour.
 *
 * Dual use: CommonJS module in Node (tests/check.js) and a browser global
 * (renderer/index.html) via a UMD-style wrapper.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.bg = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* VCE: 9-bit colour to RGB.  Each channel is 3 bits scaled by 36
   * (0, 36, ..., 252). */
  function cramEntry(table, i, v) {
    table[i * 3] = 36 * ((v >> 3) & 7);      /* red   */
    table[i * 3 + 1] = 36 * ((v >> 6) & 7);  /* green */
    table[i * 3 + 2] = 36 * (v & 7);         /* blue  */
  }

  /* 512 9-bit word values (the #15 raster table's baseCram) to RGB. */
  function decodeCramWords(words) {
    var table = new Uint8Array(512 * 3);
    for (var i = 0; i < 512; i++) {
      cramEntry(table, i, words[i]);
    }
    return table;
  }

  /* A copy of an RGB table with one entry's [addr, word] writes applied
   * (last-write-wins per address across entries). */
  function applyCramWrites(rgb, writes) {
    var table = new Uint8Array(rgb);
    for (var k = 0; k < writes.length; k++) {
      cramEntry(table, writes[k][0] & 0x1FF, writes[k][1] & 0x1FF);
    }
    return table;
  }

  function decodeCram(cram) {
    var words = new Array(512);
    for (var i = 0; i < 512; i++) {
      words[i] = cram[i * 2] | (cram[i * 2 + 1] << 8);
    }
    return decodeCramWords(words);
  }

  /* MWR bits 4-5: BAT width (0:32, 1:64, 2/3:128); bit 6: BAT height
   * (0:32, 1:64).  The row stride is the width in words, so codes 3 and 2
   * share shift 7: the VDC manual's SCREEN table gives 011 as 128x32 and
   * 111 as 128x64, same as 010/110 (HuC6270 VDC manual, H7-8/H7-9). */
  function batGeometry(mwr) {
    var mode = (mwr >> 4) & 3;
    var widths = [32, 64, 128, 128];
    var shifts = [5, 6, 7, 7];
    var w = widths[mode];
    var h = (mwr & 0x40) ? 64 : 32;
    var shift = shifts[mode];
    return { width: w, height: h, shift: shift,
             wmask: w - 1, hmask: h - 1 };
  }

  /* #15: the per-scanline values when opts.raster is present — a table of
   * CPU writes to BXR/BYR/CR and the VCE colour table made from the RCR
   * line interrupt, applied at the line the hardware applies them.
   *
   *   opts.raster = { base: {bxr, byr, cr}, baseCram: [512 9-bit words],
   *                   entries: [{line, bxr?, byr?, cr?,
   *                              cram?: [[addr, word]...],
   *                              cramPrev?: [[addr, word]...]}...] }
   *
   * Every entry fires during the HBlank before VDW line `line` (the RCR
   * interrupt sets status bit 2 when the line counter reaches RCR - 0x40,
   * i.e. at the end of line `line` - 1), so the row showing VDW line L
   * carries the last entry with line <= L.  The per-register rules, from
   * the Hudson VDC manual (page references in docs/RENDERER.md, #15):
   *   - BXR (R07): "If this register is updated, the screen will become
   *     valid with the next scanning line" — the write before line L
   *     shows from line L.
   *   - BYR (R08): "If the register is updated during display, the screen
   *     will become valid with the next scanning line (BYR+1)" — a write
   *     before line L starts the line counter at v + 1 on line L, so
   *     bgY(L) = v + (L - line) + 1.  The VDC hardware's line-0 latch
   *     (VDW entry, RCRCount reset) takes the BYR register itself without
   *     the +1, and the register keeps the previous frame's last write:
   *     with the last BYR entry at (N, v), lines before the first entry
   *     of the frame start at bgY(L) = v + L.
   *   - CR (R05): "SB/BB become valid from the next horizontal display
   *     period" — per line, like BXR.  The register keeps the previous
   *     frame's last write too, so the frame starts from the table's last
   *     CR entry.
   *   - VCE colour table (2.2.2, H6-5): a CPU write during HBlank shows
   *     on the whole next line; the colour table persists across frames
   *     (no reset), so each row decodes through its own table: baseCram
   *     plus this frame's cram writes at lines <= the row's line and the
   *     previous frame's writes (cramPrev; defaulting to the entry's own
   *     value — a periodic table) at lines past it, last-write-wins per
   *     address.
   *
   * Returns null (the single-register path) when the dump has no raster
   * table; otherwise per-row bxr/bgY/cr/rgb arrays.  Rows before the first
   * entry of a kind use the frame-start values above, rows between the
   * last entry and the save line keep the register value (which the
   * check.js raster checks verify against the saved registers).
   */
  function buildRows(opts) {
    var raster = opts.raster;
    if (!raster || !raster.entries || !raster.entries.length) {
      return null;
    }
    var base = raster.base || {};
    var regs = opts.regs;
    var width = opts.width || 256;
    var height = opts.height || 232;
    var firstScanline = opts.firstScanline != null ? opts.firstScanline : 18;
    /* the dump's own calibration (see renderIndices): captured row 0 is
     * VDW line vdwLine0.  Same arithmetic as renderIndices, written without
     * the parens so the mutation test's vdw1 source line stays unique there
     * (vdw1 hard-wires the renderIndices copy; on the standard crop both are
     * arithmetically 1, so the raster dumps are no vdw1 witness any more
     * than the standard-crop scene dumps — scene5b's shifted crop is). */
    var vdwLine0 = regs.RCRCount - regs.scanline + firstScanline;
    var entries = raster.entries.slice().sort(function (a, b) {
      return a.line - b.line;
    });
    var n = entries.length;

    /* the frame-start values: the previous frame's last write per kind —
     * the table's last entry carrying it, else the base.  (The ROMs chain
     * their writes every frame, so the last table entry is what the
     * register holds when VDW entry latches it.) */
    var lastBxr = null, lastByr = null, lastCr = null;
    for (var i = n - 1; i >= 0; i--) {
      var e = entries[i];
      if (lastBxr == null && e.bxr != null) lastBxr = e.bxr & 0x3FF;
      if (lastByr == null && e.byr != null) lastByr = e.byr & 0x1FF;
      if (lastCr == null && e.cr != null) lastCr = e.cr;
    }
    var curBxr = lastBxr != null ? lastBxr
        : (base.bxr != null ? base.bxr & 0x3FF : regs.BXR & 0x3FF);
    var curByrN = 0;   /* line of the last applied BYR write; 0 = the
                        * frame-start latch (the register value, no +1) */
    var curByrV = lastByr != null ? lastByr
        : (base.byr != null ? base.byr & 0x1FF : regs.BYR & 0x1FF);
    var curCr = lastCr != null ? lastCr
        : (base.cr != null ? base.cr : regs.CR);
    var baseRgb = raster.baseCram ? decodeCramWords(raster.baseCram)
                                  : decodeCram(opts.cram);
    /* The colour table persists across frames (no reset): a row shows this
     * frame's writes at lines <= the row and the previous frame's writes at
     * lines > the row.  An entry's cramPrev carries its previous frame's
     * value (the ROMs' chains run every frame; without it — a periodic
     * table — the previous value is the entry's own, and every row shows
     * baseCram plus all entries, last-write-wins). */
    var curRgb = baseRgb;
    for (var i = 0; i < n; i++) {
      if (entries[i].cram && entries[i].cram.length) {
        curRgb = applyCramWrites(curRgb, entries[i].cramPrev || entries[i].cram);
      }
    }

    var bxr = new Int32Array(height);
    var bgY = new Int32Array(height);
    var cr = new Int32Array(height);
    var rgb = new Array(height);
    var cursor = 0;
    for (var r = 0; r < height; r++) {
      var L = vdwLine0 + r;
      while (cursor < n && entries[cursor].line <= L) {
        var en = entries[cursor++];
        if (en.bxr != null) curBxr = en.bxr & 0x3FF;
        if (en.byr != null) {
          curByrN = en.line;
          curByrV = en.byr & 0x1FF;
        }
        if (en.cr != null) curCr = en.cr;
        if (en.cram && en.cram.length) {
          /* this frame's write replaces the previous frame's value here */
          curRgb = applyCramWrites(curRgb, en.cram);
        }
      }
      bxr[r] = curBxr;
      /* +1 for a mid-frame write (the manual's BYR+1), not for the
       * frame-start latch (line 0 takes the register itself) */
      bgY[r] = (curByrV + (L - curByrN) + (curByrN === 0 ? 0 : 1)) & 0x1FF;
      cr[r] = curCr;
      rgb[r] = curRgb;
    }
    return { bxr: bxr, bgY: bgY, cr: cr, rgb: rgb };
  }

  /* One rendered frame of colour indexes (9-bit VCE colour-table entries,
   * value per pixel: 0x000 backdrop / 0x100 blanking / pal<<4|pixel).
   * renderFrame maps these through CRAM to RGB; pce-sprites.js composes the
   * sprite layer onto this same index buffer (the VDC's sprite/BG priority
   * rule tests the BG pixel's low nibble — colour 0 — so the indexes, not
   * the RGB, are the layer boundary).
   *
   * Vertical calibration, from the dump's own counters (nothing is fitted to
   * the picture): the VDC's VDW phase begins at VCE line 17 — one line before
   * the first captured line (captured row 0 = VCE line 14 + slstart = 18,
   * DisplayRect.y in Mednafen's pce module; VDW line 0 = VCE 17 follows from
   * the state: RCRCount counts display lines since VDW entry and equals
   * scanline - 17 at the save instant).  So captured row r shows
   * BG_YOffset = BYR + vdwLine + r with
   *   vdwLine = RCRCount - (scanline - firstScanline) + r.
   * A 1-line error here shifts the picture by one row and the diff test
   * fails loudly, so this is self-calibrating. */
  function renderIndices(opts, rows) {
    var vram = opts.vram, cram = opts.cram, regs = opts.regs;
    var width = opts.width || 256;
    var height = opts.height || 232;
    var firstScanline = opts.firstScanline != null ? opts.firstScanline : 18;
    if (rows === undefined) {
      rows = buildRows(opts);
    }

    var geom = batGeometry(regs.MWR);
    var bxr = regs.BXR & 0x3FF;                 /* BXR is 10 bits */
    var byr = regs.BYR & 0x1FF;                 /* BYR is 9 bits */
    var vdwLine0 = regs.RCRCount - (regs.scanline - firstScanline);
    var idx = new Uint16Array(width * height);

    /* CR bit 7 = BB (background blanking): when it is clear the VDC clears
     * the background and every pixel shows the blanking-period video data —
     * SPBG = 1, VD7..VD0 = 0, i.e. the 9-bit colour index 0x100, CRAM[0x100]
     * (sprite colour 0).  VDC manual, CR R05 p. H7-5, 2.3.6 p. H7-18.
     * Measured on tests/dumps/scene8, scene8b and scene8c (a full picture in
     * VRAM, BB clear, burst mode or not, DCR set or clear): 59392/59392
     * pixels are CRAM[0x100] = 0x049 = 36,36,36; us1's white frame is its
     * CRAM[0x100] = 0x1FF, the same rule.  With a raster table CR is latched
     * per line: each row is gated on its own CR (SB/BB become valid from the
     * next horizontal display period), so the gate below runs per row for
     * every dump — there is no separate whole-frame fill. */
    for (var r = 0; r < height; r++) {
      var crRow = rows ? rows.cr[r] : regs.CR;
      if (!(crRow & 0x80)) {
        /* BB clear on this line: the blanking fill, whole row */
        for (var x = 0; x < width; x++) {
          idx[r * width + x] = 0x100;
        }
        continue;
      }
      /* 9-bit counters wrap; mask to stay inside the BAT mask arithmetic */
      var bgY = rows ? rows.bgY[r] : ((byr + vdwLine0 + r) & 0x1FF);
      var bgX = rows ? rows.bxr[r] : bxr;
      var batY = ((bgY >> 3) & geom.hmask) << geom.shift;
      var row = bgY & 7;

      for (var x = 0; x < width; x++) {
        var col = (bgX + x) & 7;
        var batIdx = (((bgX + x) >> 3) & geom.wmask) | batY;
        var bat = vram[batIdx * 2] | (vram[batIdx * 2 + 1] << 8);
        var ch = bat & 0xFFF;
        var pal = (bat >> 12) & 0xF;
        var addr = ch * 16 + row;
        /* Characters >= 0x800 lie beyond the 32768-word VRAM: writes there
         * are dropped (VRAM_Size in Mednafen's pce module) and the display
         * reads the zero-filled tile cache, so the pixel colour is 0.
         * Measured on the hardware by tests/dumps/scene9 (#39): its odd BAT
         * columns read 0xF00+ and show CRAM[0x000] on every pixel. */
        var pix;
        if (ch >= 0x800) {
          pix = 0;
        } else {
          /* bit 7 of a plane byte is the leftmost pixel (FixTileCache
           * reference): pixel at column c reads bit 7 - c. */
          var bit = 7 - col;
          var w0 = vram[addr * 2] | (vram[addr * 2 + 1] << 8);
          var w1 = vram[(addr + 8) * 2] | (vram[(addr + 8) * 2 + 1] << 8);
          pix = ((w0 >> bit) & 1)
              | (((w0 >> (bit + 8)) & 1) << 1)
              | (((w1 >> bit) & 1) << 2)
              | (((w1 >> (bit + 8)) & 1) << 3);
        }
        idx[r * width + x] = pix === 0 ? 0x000 : (pal << 4) | pix;
      }
    }
    return { width: width, height: height, indices: idx };
  }

  function renderFrame(opts) {
    var rows = buildRows(opts);
    var img = renderIndices(opts, rows);
    /* with a raster table every row decodes through its own colour table
     * (the VCE's persists across frames and the table's writes land per
     * line); without one, all rows share the flat decode */
    var flatRgb = decodeCram(opts.cram);
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
    decodeCram: decodeCram,
    decodeCramWords: decodeCramWords,
    batGeometry: batGeometry,
    buildRows: buildRows,
    renderFrame: renderFrame,
    renderIndices: renderIndices
  };
});
