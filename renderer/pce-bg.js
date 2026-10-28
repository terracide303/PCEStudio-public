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
  function decodeCram(cram) {
    var table = new Uint8Array(512 * 3);
    for (var i = 0; i < 512; i++) {
      var v = cram[i * 2] | (cram[i * 2 + 1] << 8);
      table[i * 3] = 36 * ((v >> 3) & 7);      /* red   */
      table[i * 3 + 1] = 36 * ((v >> 6) & 7);  /* green */
      table[i * 3 + 2] = 36 * (v & 7);         /* blue  */
    }
    return table;
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
  function renderIndices(opts) {
    var vram = opts.vram, cram = opts.cram, regs = opts.regs;
    var width = opts.width || 256;
    var height = opts.height || 232;
    var firstScanline = opts.firstScanline != null ? opts.firstScanline : 18;
    var rgb = decodeCram(cram);

    /* CR bit 7 = BB (background blanking): when it is clear the VDC clears
     * the background and every pixel shows the blanking-period video data —
     * SPBG = 1, VD7..VD0 = 0, i.e. the 9-bit colour index 0x100, CRAM[0x100]
     * (sprite colour 0).  VDC manual, CR R05 p. H7-5, 2.3.6 p. H7-18.
     * Measured on tests/dumps/scene8, scene8b and scene8c (a full picture in
     * VRAM, BB clear, burst mode or not, DCR set or clear): 59392/59392
     * pixels are CRAM[0x100] = 0x049 = 36,36,36; us1's white frame is its
     * CRAM[0x100] = 0x1FF, the same rule. */
    if (!(regs.CR & 0x80)) {
      var off = new Uint16Array(width * height);
      off.fill(0x100);
      return { width: width, height: height, indices: off };
    }

    var geom = batGeometry(regs.MWR);
    var bxr = regs.BXR & 0x3FF;                 /* BXR is 10 bits */
    var byr = regs.BYR & 0x1FF;                 /* BYR is 9 bits */
    var vdwLine0 = regs.RCRCount - (regs.scanline - firstScanline);
    var idx = new Uint16Array(width * height);

    for (var r = 0; r < height; r++) {
      /* 9-bit counters wrap; mask to stay inside the BAT mask arithmetic */
      var bgY = (byr + vdwLine0 + r) & 0x1FF;
      var bgX = bxr;
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
    var img = renderIndices(opts);
    var rgb = decodeCram(opts.cram);
    var px = new Uint8Array(img.width * img.height * 3);
    for (var i = 0, o = 0; i < img.indices.length; i++, o += 3) {
      var ci = img.indices[i];
      px[o] = rgb[ci * 3];
      px[o + 1] = rgb[ci * 3 + 1];
      px[o + 2] = rgb[ci * 3 + 2];
    }
    return { width: img.width, height: img.height, pixels: px };
  }

  return {
    decodeCram: decodeCram,
    batGeometry: batGeometry,
    renderFrame: renderFrame,
    renderIndices: renderIndices
  };
});
