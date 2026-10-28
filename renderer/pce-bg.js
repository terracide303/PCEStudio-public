/*
 * pce-bg.js — PCEStudio VDC/VCE background renderer (card #5).
 *
 * Renders one 256x232 RGB frame from a VRAM dump, a colour-table dump and a
 * handful of register values, exactly as the HuC6270 VDC background layer and
 * the HuC6260 VCE colour decoder produce it in the display the ROM sets up:
 * 256x240, not the 224 lines a standard TV shows (HDR = $041F, HDW = 31 ->
 * 32 characters = 256 px, H7-9; VDW = $00EF, 240 display lines, H7-10).
 * The 232 lines rendered here are the part of those 240 that the captured
 * screen covers.  Since #48 the frame is the VDC's **display window**, not a
 * fixed 32x30-character screen: HSR/HDR set where the display starts (HDS)
 * and how wide it is (HDW), VPR/VDR set the first display line (VDS+VSW) and
 * its height (VDW), and every pixel outside the window is the VCE's border
 * colour, CRAM[0x100] — the same blanking-period video data (SPBG=1,
 * VD7..VD0=0) the VDC puts out there (VDC manual 2.3.6 p. H7-18; the
 * window fields are on p. H7-9/H7-10, the picture in Fig. 2-2-1 p. H7-13).
 * This is
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

  /* The VDC's display window (card #48): the rectangle of the captured frame
   * the VDC actually draws; every pixel outside it is CRAM[0x100].
   *
   * Horizontal, from HSR (R0A) and HDR (R0B) (VDC manual p. H7-9/H7-10):
   *   - HDS is the back porch in character cycles (HDS = N-1 for a back porch
   *     of N), so the display starts (HDS+1) character cycles after the
   *     hsync rising edge; a character cycle is 8 dots.
   *   - HDW is the display width in character cycles (HDW = N-1), so the
   *     window is (HDW+1)*8 dots wide.
   *   - HDE is the *front* porch — the interval from the end of the display
   *     to the falling edge of hsync — so it moves the sync, not the display:
   *     it is read (and a window ROM sets it) but does not move a pixel.
   *   The absolute position inside Mednafen's 256-dot /4-clock output is the
   *   emulator's alignment (pce_fast correct_aspect=1: xs[1][0] = 24, so a
   *   canonical HDS=2 back porch puts the display at x=0); the manual settles
   *   the meaning, the 8-dot character cycle and the width, not that offset.
   *   Mednafen's own clipping of start/end to the 341-dot 5.37 MHz line is
   *   modelled, because a window pushed far right would otherwise run past
   *   the line.
   *
   * Vertical, from VPR (R0C)/VDR (R0D)/VCR (R0E) (p. H7-10/H7-11):
   *   - VDS is the back porch in lines (VDS = N-2), VSW the sync width, so
   *     the first display line is VDS+VSW; VDW is the display height in
   *     lines (VDW = N-1); VCR is the front porch (N, not N-1).
   *   - Which captured rows those are is calibrated from the save state's
   *     own counters, exactly as the background row is (#5): captured row r
   *     shows VDW line vdwLine0 + r, with
   *     vdwLine0 = RCRCount - (scanline - firstScanline). The window is the
   *     VDW+1 lines from the RCRCount entry (line 0), so VDS and VSW enter
   *     through RCRCount rather than through a second, guessed offset. VCR
   *     only changes where the next V-sync falls, so it never moves the
   *     window inside one capture. A dump without the two counters (nothing
   *     here) falls back to placing the display entry at
   *     VDS+VSW - firstScanline.
   *
   * Returns the rectangle in captured-frame dots/rows as {x0, y0, x1, y1}
   * with the far edges exclusive. x0/y0 may be negative and x1/y1 past the
   * frame when the window leaves the captured area; callers intersect with
   * the frame. */
  var LINE_DOTS = 341;      /* Mednafen pce_fast ClockPixelWidths[0] */
  var H_ALIGN_DOTS = 24;    /* pce_fast xs[1][0], correct_aspect = 1 */
  function displayWindow(opts) {
    var regs = opts.regs || {};
    var firstScanline = opts.firstScanline != null ? opts.firstScanline : 18;
    var hsr = regs.HSR != null ? regs.HSR : 0x0202;
    var hdr = regs.HDR != null ? regs.HDR : 0x041F;
    var vpr = regs.VSR != null ? regs.VSR
            : regs.VPR != null ? regs.VPR : 0x0F02;
    var vdr = regs.VDR != null ? regs.VDR : 0x00EF;
    var vcr = regs.VCR != null ? regs.VCR : 0x000C;
    /* The latched values are what the VDC used for this frame (HDS..HDE at
     * HDS start, VDS..VCR at the vertical period boundary); the live
     * register is only the fallback for a state that does not record them. */
    var hds = regs.HDS_cache != null ? regs.HDS_cache : (hsr >> 8) & 0x7F;
    var hdw = regs.HDW_cache != null ? regs.HDW_cache : hdr & 0x7F;
    var vds = regs.VDS_cache != null ? regs.VDS_cache : (vpr >> 8) & 0xFF;
    var vsw = regs.VSW_cache != null ? regs.VSW_cache : vpr & 0x1F;
    var vdw = regs.VDW_cache != null ? regs.VDW_cache : vdr & 0x1FF;
    var vcrReg = regs.VCR_cache != null ? regs.VCR_cache : vcr & 0xFF;

    var start = (hds + 1) * 8;
    var end = start + (hdw + 1) * 8;
    if (start > LINE_DOTS) start = LINE_DOTS;
    if (end > LINE_DOTS) end = LINE_DOTS;
    if (start === end) start = end - 8;   /* Mednafen's off-screen HDS guard */
    var x0 = start - H_ALIGN_DOTS;
    var x1 = end - H_ALIGN_DOTS;

    var vdwLine0;
    if (regs.RCRCount != null && regs.scanline != null) {
      vdwLine0 = regs.RCRCount - (regs.scanline - firstScanline);
    } else {
      vdwLine0 = firstScanline - (vds + vsw);
    }
    var y0 = -vdwLine0;
    var y1 = vdw - vdwLine0 + 1;

    return { x0: x0, y0: y0, x1: x1, y1: y1,
             /* the register values, for the tests/panels that show them */
             hds: hds, hdw: hdw, hde: regs.HDE_cache != null ? regs.HDE_cache
                        : (hdr >> 8) & 0x7F,
             vds: vds, vsw: vsw, vdw: vdw, vcr: vcrReg };
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
   * table; otherwise per-row bxr/byr/bgY/cr/rgb arrays (`byr` is the BYR
   * register itself, which the #26 register panel shows; `bgY` is the
   * effective row counter after the manual's +1 rule).  Rows before the
   * first entry of a kind use the frame-start values above, rows between the
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
    var byr = new Int32Array(height);   /* the BYR register itself (#26) */
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
      byr[r] = curByrV;
      /* +1 for a mid-frame write (the manual's BYR+1), not for the
       * frame-start latch (line 0 takes the register itself) */
      bgY[r] = (curByrV + (L - curByrN) + (curByrN === 0 ? 0 : 1)) & 0x1FF;
      cr[r] = curCr;
      rgb[r] = curRgb;
    }
    return { bxr: bxr, byr: byr, bgY: bgY, cr: cr, rgb: rgb };
  }

  /* One background pixel: the colour index renderIndices writes, plus the BAT
   * entry and tile the index came from (card #26's follow-a-pixel panel).
   * renderIndices and renderer/pce-panels.js both call this, so the panel
   * cannot drift from the picture: there is one background decode.  `out` is
   * optional and reused to keep the render loop allocation-free. */
  function backgroundPixel(vram, geom, bgX, bgY, x, out) {
    var p = out || {};
    var col = (bgX + x) & 7;
    var batIdx = (((bgX + x) >> 3) & geom.wmask) |
                 (((bgY >> 3) & geom.hmask) << geom.shift);
    var bat = vram[batIdx * 2] | (vram[batIdx * 2 + 1] << 8);
    var ch = bat & 0xFFF;
    var pal = (bat >> 12) & 0xF;
    var row = bgY & 7;
    var addr = ch * 16 + row;
    var pix;
    /* Characters >= 0x800 lie beyond the 32768-word VRAM: writes there are
     * dropped (VRAM_Size in Mednafen's pce module) and the display reads the
     * zero-filled tile cache, so the pixel colour is 0.  Measured on the
     * hardware by tests/dumps/scene9 (#39): its odd BAT columns read 0xF00+
     * and show CRAM[0x000] on every pixel. */
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
    p.index = pix === 0 ? 0x000 : (pal << 4) | pix;
    p.batIndex = batIdx;
    p.batWord = bat;
    p.char = ch;
    p.palette = pal;
    p.tileRow = row;
    p.tileColumn = col;
    p.colourNumber = pix;
    p.tileWord = addr;          /* the first plane; the second is addr + 8 */
    p.beyondVram = ch >= 0x800;
    return p;
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
    var win = displayWindow(opts);
    /* the visible part of the window inside this frame (the window may start
     * left of / above the captured area or run past its right/bottom edge) */
    var wx0 = Math.min(width, Math.max(0, win.x0));
    var wx1 = Math.min(width, Math.max(0, win.x1));
    var wy0 = Math.min(height, Math.max(0, win.y0));
    var wy1 = Math.min(height, Math.max(0, win.y1));
    if (wx1 < wx0) wx1 = wx0;   /* an empty window is all border */
    if (wy1 < wy0) wy1 = wy0;
    var idx = new Uint16Array(width * height);
    var px = {};   /* one reusable provenance record for the per-pixel decode */

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
      if (r < wy0 || r >= wy1) {
        /* outside the vertical display window: the whole line is the
         * border colour (CRAM[0x100] — the blanking-period video data) */
        for (var x = 0; x < width; x++) {
          idx[r * width + x] = 0x100;
        }
        continue;
      }
      /* 9-bit counters wrap; mask to stay inside the BAT mask arithmetic */
      var bgY = rows ? rows.bgY[r] : ((byr + vdwLine0 + r) & 0x1FF);
      var bgX = rows ? rows.bxr[r] : bxr;

      /* left of the window: border */
      for (var x = 0; x < wx0; x++) {
        idx[r * width + x] = 0x100;
      }
      /* inside it: the background. The window's left edge is the display's
       * first dot, so screen column x is background column x - win.x0. */
      for (var x = wx0; x < wx1; x++) {
        idx[r * width + x] =
            backgroundPixel(vram, geom, bgX, bgY, x - win.x0, px).index;
      }
      /* right of the window: border */
      for (var x = wx1; x < width; x++) {
        idx[r * width + x] = 0x100;
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
    displayWindow: displayWindow,
    buildRows: buildRows,
    backgroundPixel: backgroundPixel,
    renderFrame: renderFrame,
    renderIndices: renderIndices
  };
});
