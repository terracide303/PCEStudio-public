/*
 * pce-rom.js — PCEStudio .pce builder (card #9).
 *
 * Glues the constant viewer code bank and one picture into a HuCard ROM at
 * the fixed places of docs/ROM_LAYOUT.md, producing exactly the same bytes
 * PCEAS produces from tools/gen/viewerN.asm (tools/genviewer.py lays out the
 * same picture for the Python path).  This is the browser's exporter: the
 * page in renderer/index.html calls buildRom() and downloads the result.
 *
 * Input:
 *   bank0:   Uint8Array, 8192 bytes — viewer.asm's assembled bank 0.  It is
 *            identical in every viewer ROM; renderer/viewer-bank0.bin is
 *            extracted from the PCEAS build by `make -C tools bank0`.
 *   vram:    Uint8Array, 131072 bytes = 65536 uint16 little-endian words
 *   cram:    Uint8Array, 1024 bytes = 512 uint16 LE colour-table entries
 *   regs:    { BXR, BYR, MWR, CR, VCECR?, HSR?, HDR? } — exactly the values
 *            the config block carries (docs/ROM_LAYOUT.md, bank 1).  #70: a
 *            picture whose VCECR selects a /3 or /2 dot clock (DCC bits 1-0
 *            != 00) writes config version 2 and the wide-window block at
 *            bank 1 offset 0x1F00 (VCECR + HSR + HDR); a caller without a
 *            VCECR is the pre-#70 /4 picture and writes version 1.
 *   regions: [[char0, tileCount], ...] — the picture's VRAM copy regions in
 *            descriptor order (tests/dumps/sceneN/regions.json for the
 *            sample scenes; for the #12 sprite scenes the list also carries
 *            the SG pattern block at VRAM word 0x2000).  Regions whose VRAM
 *            destination word is 32768
 *            or higher are dropped: the VDC drops those writes and the
 *            renderer model reads them as colour 0.  A region that starts
 *            below 32768 but ends past it throws (it cannot be described
 *            truthfully; docs/EXPORT.md).
 *   raster:  optional, #16 — the renderer-shaped raster table
 *            (pce-editor.js toRaster: { base: {bxr,byr,cr}, baseCram:
 *            [512 words], entries: [{line, rcr, bxr?, byr?, cr?, cram?}] }).
 *            When present, the builder lays the fixed-layout table image
 *            into bank 1 at offset 0x640 (docs/ROM_LAYOUT.md), sets config
 *            byte 9, ORs the RC bit (0x04) into the config CR, and loads
 *            the boot colour table from baseCram (the values CRAM holds
 *            before the first entry of a frame — the renderer applies the
 *            entries to it the same way).  The image is always 3856 bytes:
 *            the 4-byte header (size lo/hi, flags bit 0 = frameCounter, the
 *            step count) plus 16 parallel 240-byte arrays at the fixed
 *            offsets — byte-identical to tools/genviewer.py's encoder.
 *
 * Output: Uint8Array, an 8 KiB-banked headerless HuCard image.  Banks are
 * filled with 0xff; bank 1 holds the 64-byte config at offset 0, the 512
 * colour-table entries (BG + sprite palettes) at offset 0x40, the SAT at
 * offset 0x440 (64 entries x 4 words from VRAM word 0x7F00 — the SATB DMA
 * source, card #14) and, for a #16 raster picture, the table image at
 * offset 0x640; banks 2-3 hold the BAT; banks 4+ hold the copy regions
 * concatenated.  The bank count is 4 + ceil(tiles / 8 KiB),
 * which is also what PCEAS -raw emits for the generated viewer .asm.
 *
 * #46 lifted the old 80 KiB cap.  Banks 4..127 are the picture's copy
 * regions, mapped one at a time into the CPU's 8 KiB window at $4000-$5fff
 * by the viewer's MPR2 re-map loop, so the image can grow to the HuCard
 * limit — 128 banks of 8 KiB = 1 MB (#57).  The card decodes physical banks
 * $00-$7F only: $80-$87 is optionally the CD unit's 64 KiB RAM, $F7
 * optionally 2 KiB of backup RAM, $F8-$FB work RAM and $FF I/O (sgxtech.txt
 * "HuC6280 memory map"; pcetech.txt §3 "Memory map" has $00-$7F : HuCard
 * ROM, $80-$F7 : Unused; hes spec [MEMORY MAP] puts ROM at
 * 0x000000-0x0FFFFF; docs/MANUALS.md §15.1 GAP 4).  The HuC6280's 2 MB /
 * 256-block physical space (H8-7, H8-10/11; docs/MANUALS.md §5.1) is the
 * CPU's address space, not the card's decode.  A request whose bank count
 * would pass 128 is refused with the code `rom-too-big`.  The config block
 * holds 13 region descriptors (the room before the palette at 0x40;
 * docs/ROM_LAYOUT.md).
 *
 * Dual use: CommonJS module in Node (tests/check-export.js) and a browser
 * global (renderer/index.html) via a UMD-style wrapper, same as pce-bg.js.
 *
 * #25: reverseBits() turns that image into the US HuCard (TurboGrafx-16)
 * image — the same bytes with every byte's bits reversed.  The page's
 * checkbox calls it; the .pce path above is untouched.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.rom = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var BANK = 8 * 1024;
  var CONFIG_SIZE = 64;          /* docs/ROM_LAYOUT.md, bank 1 */
  var PALETTE_OFFSET = 0x40;     /* 512 words: VCE entries 0-511 */
  var SAT_OFFSET = 0x440;        /* 256 words: the SAT (card #14) */
  var SAT_ADDR = 0x7F00;         /* the SAT's VRAM word address (DVSSR) */
  var CFG_VERSION = 0;
  var CFG_BXR = 2;
  var CFG_BYR = 4;
  var CFG_MWR = 6;
  var CFG_CR = 7;
  var CFG_RGNS = 8;
  var CFG_RASTER = 9;            /* 1 = the #16 raster table is present */
  var CFG_REG0 = 0x0A;
  var REG_SIZE = 4;
  /* #70/#67: the window block.  A picture whose VCE CR selects a /3 or /2
   * dot clock (DCC bits 1-0 != 00) is a 336- or 512-dot picture; the viewer
   * cannot use the 256-dot HSR/HDR constants, so config version 2 says the
   * block at bank 1 offset 0x1F00 is present with VCE CR + HSR/HDR.  #67
   * extends it: a picture whose display window differs from the viewer's
   * constants writes config version 3, and the block also carries VPR, VDR
   * and VCR — the five window registers viewer.asm writes before the
   * display.  It sits after the raster table (which ends at 0x1550) and is
   * 0xff in every version 1 picture, so every ROM built before #70 is
   * byte-identical.  Byte-identical to tools/genviewer.py's encoder
   * (docs/ROM_LAYOUT.md). */
  var WINDOW_OFFSET = 0x1F00;
  var WIDE_SIZE = 8;             /* version 2: VCE CR + HSR + HDR */
  var WINDOW_SIZE = 16;          /* version 3: + VPR + VDR + VCR */
  var WINDOW_VCE_CR = 0, WINDOW_HSR_LO = 2, WINDOW_HSR_HI = 3,
      WINDOW_HDR_LO = 4, WINDOW_HDR_HI = 5,
      WINDOW_VPR_LO = 6, WINDOW_VPR_HI = 7,
      WINDOW_VDR_LO = 8, WINDOW_VDR_HI = 9,
      WINDOW_VCR_LO = 10, WINDOW_VCR_HI = 11;
  /* The viewer's own constants (tools/viewer.asm): a 256x240 window on the
   * /4 clock.  A picture whose five registers all equal these writes config
   * version 1 and no block. */
  var DEFAULT_WINDOW = { HSR: 0x0202, HDR: 0x041F, VPR: 0x0F02,
                         VDR: 0x00EF, VCR: 0x000C };
  var WINDOW_LIMITS = { HSR: 0x7F1F, HDR: 0x7F7F, VPR: 0x1F1F,
                        VDR: 0x01FF, VCR: 0x00FF };
  /* 13 descriptors fit between CFG_REG0 and the palette at 0x40:
   * (0x40 - 0x0A) / 4 = 13.  The count byte could hold 255; going past 13
   * would need a new config layout (docs/ROM_LAYOUT.md). */
  var MAX_REGIONS = 13;
  var MAX_BAT_BANKS = 2;         /* banks 2-3 (the VDC's largest BAT is 16 KiB) */
  /* The HuCard limit: the card decodes physical banks $00-$7F only —
   * 128 banks of 8 KiB = 1 MB (sgxtech.txt "HuC6280 memory map"; pcetech.txt
   * §3 "Memory map"; hes spec [MEMORY MAP] ROM 0x000000-0x0FFFFF;
   * docs/MANUALS.md §15.1 GAP 4).  The HuC6280's 2 MB / 256-block physical
   * space (H8-7, H8-10/11) is the CPU's address space, not the card's
   * decode — $80-$F7 are not card memory.  The layout spends banks 0-3 on
   * code/config/BAT, so banks 4..127 (124 tile banks) are the data.  A
   * request past 128 banks is refused with `rom-too-big`. */
  var MAX_ROM_BANKS = 128;
  var MAX_TILE_BANKS = MAX_ROM_BANKS - 4;

  /* #100: the IL bytecode interpreter image (renderer/ilvm.bin).  llvm-mos
   * links it as a 16 KiB fixed ROM: physical bank 0 ($E000-$FFFF: vectors,
   * startup, the #31 runtime) and physical bank 1 ($C000-$DFFF: the
   * interpreter, docs/IL.md §14).  The toy's bytecode is physical bank 2,
   * which ilvm.c maps into MPR2 ($4000-$5FFF) with TAM #$04. */
  var ILVM_BYTES = 2 * BANK;     /* 16384 */
  var TOY_DATA_BANK = 2;

  /* MWR bits 4-5: BAT width (0:32, 1:64, 2/3:128); bit 6: BAT height
   * (0:32, 1:64).  Same order as viewer.asm's bat_words table. */
  function batWords(mwr) {
    var width = [32, 64, 128, 128][(mwr >> 4) & 3];
    var height = (mwr & 0x40) ? 64 : 32;
    return width * height;
  }

  function need(ok, message) {
    if (!ok) throw new Error("pce-rom: " + message);
  }

  /* A refusal a caller can tell apart without parsing the message (the same
   * machine-readable `code` convention as renderer/pce-editor.js). */
  function refuse(code, message) {
    var e = new Error("pce-rom: " + code + ": " + message);
    e.code = code;
    throw e;
  }

  function byte(name, v, max) {
    need(typeof v === "number" && v === (v | 0) && v >= 0 && v <= max,
         name + " must be an integer in 0.." + max + ", got " + v);
  }

  function u16(out, off, v) {
    out[off] = v & 0xFF;
    out[off + 1] = (v >> 8) & 0xFF;
  }

  /* US HuCard (TurboGrafx-16) images hold every byte with its bits reversed:
   * bit 0 becomes bit 7, bit 1 becomes bit 6, and so on.  That is the card's
   * rule (US HuCards swap the data lines); no source in this repo confirms
   * the hardware claim — docs/EXPORT.md says what is and is not verified.  A
   * US image is the PC Engine image with all eight bits of every byte
   * reversed — a transform that is its own inverse
   * (reverseBits(reverseBits(x)) === x).  The page's checkbox and
   * tests/check-us-card.js both call this; nothing else in the ROM changes. */
  var BIT_REVERSED = (function () {
    var table = new Uint8Array(256);
    for (var b = 0; b < 256; b++) {
      var r = 0;
      for (var i = 0; i < 8; i++) r |= ((b >> i) & 1) << (7 - i);
      table[b] = r;
    }
    return table;
  })();

  function reverseBits(bytes) {
    need(bytes && typeof bytes.length === "number",
         "reverseBits: expected a byte array");
    var out = new Uint8Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) out[i] = BIT_REVERSED[bytes[i]];
    return out;
  }

  function concat(parts) {
    var length = 0, i;
    for (i = 0; i < parts.length; i++) length += parts[i].length;
    var out = new Uint8Array(length);
    var at = 0;
    for (i = 0; i < parts.length; i++) {
      out.set(parts[i], at);
      at += parts[i].length;
    }
    return out;
  }

  /* ---- #16: the raster table image (docs/ROM_LAYOUT.md).
   *
   * The image is laid into bank 1 at RASTER_OFFSET and the viewer copies
   * 16 pages from there to RAM $2800 — the arrays land at the fixed
   * addresses tools/viewer.asm indexes (r_op $2804, r_chain_lo $2900,
   * ...), so the image offset of every array is its RAM address minus
   * $2800.  r_op sits right after the 4-byte header; r_chain_lo starts on
   * a page boundary ($2900), so 12 bytes of padding separate the two —
   * the image is 4 + 12 + 16 * 240 = 3856 bytes, not 3844.  Each array
   * holds 240 bytes; the padding past the step count is zero.
   * tools/genviewer.py's encoder produces the same bytes (the two
   * builders' agreement on the sample pictures is measured in EXPORT.md).
   *
   * The arrays are packed 240 bytes apart, NOT page-aligned: only the
   * chain arrays and r_op are read once a step outside the line budget;
   * the write-value arrays cross a page for the higher steps and those
   * reads cost 5 cycles — the handler's worst step (two CRAM writes at
   * step 231, all eight reads crossing) still lands inside the ~111-cycle
   * window (tools/viewer.asm, the irq1_plain cycle notes). */
  var RASTER_OFFSET = 0x640;     /* bank 1 byte offset ($4640) */
  var RASTER_STEPS = 240;        /* one entry per VDW line, at most */
  var RASTER_IMAGE = 4 + 12 + 16 * RASTER_STEPS;   /* 3856, always */
  var RASTER_ARRAYS = ["op", "chain_lo", "chain_hi",
                       "bxr_lo", "bxr_hi", "byr_lo", "byr_hi", "cr",
                       "a1_lo", "a1_hi", "v1_lo", "v1_hi",
                       "a2_lo", "a2_hi", "v2_lo", "v2_hi"];

  function encodeRaster(raster) {
    var entries = raster.entries;
    var n = entries.length;
    if (n < 1 || n > RASTER_STEPS) {
      refuse("raster-steps",
             "a raster table holds 1.." + RASTER_STEPS + " entries, got " + n);
    }
    var arr = {};
    for (var a = 0; a < RASTER_ARRAYS.length; a++)
      arr[RASTER_ARRAYS[a]] = new Uint8Array(RASTER_STEPS);
    var lastLine = -1;
    for (var i = 0; i < n; i++) {
      var e = entries[i] || {};
      var line = e.line;
      var rcr = e.rcr;
      if (typeof line !== "number" || line !== (line | 0) ||
          line < 0 || line > 240 || line <= lastLine) {
        refuse("raster-lines",
               "entry " + i + ": line must be an integer 0..240 strictly " +
               "increasing per step, got " + JSON.stringify(e));
      }
      if (rcr !== 0x40 + line) {
        refuse("raster-rcr",
               "entry " + i + ": rcr must be 0x40 + line (" +
               (0x40 + line) + "), got " + JSON.stringify(rcr));
      }
      lastLine = line;
      var op = 0;
      if (e.bxr !== undefined) {
        op |= 0x01;
        if (typeof e.bxr !== "number" || e.bxr !== (e.bxr | 0) ||
            e.bxr < 0 || e.bxr > 0x3FF) {
          refuse("raster-entry",
                 "entry " + i + ": bxr must be 0..0x3ff, got " + e.bxr);
        }
        arr.bxr_lo[i] = e.bxr & 0xFF;
        arr.bxr_hi[i] = (e.bxr >> 8) & 0xFF;
      }
      if (e.byr !== undefined) {
        op |= 0x02;
        if (typeof e.byr !== "number" || e.byr !== (e.byr | 0) ||
            e.byr < 0 || e.byr > 0x1FF) {
          refuse("raster-entry",
                 "entry " + i + ": byr must be 0..0x1ff, got " + e.byr);
        }
        arr.byr_lo[i] = e.byr & 0xFF;
        arr.byr_hi[i] = (e.byr >> 8) & 0xFF;
      }
      if (e.cr !== undefined) {
        op |= 0x04;
        if (typeof e.cr !== "number" || e.cr !== (e.cr | 0) ||
            e.cr < 0 || e.cr > 0xFF) {
          refuse("raster-entry",
                 "entry " + i + ": cr must be 0..0xff, got " + e.cr);
        }
        arr.cr[i] = e.cr;
      }
      var cram = e.cram || [];
      if (cram.length > 2) {
        refuse("raster-cram-count",
               "entry " + i + ": at most 2 CRAM words per step, got " +
               cram.length);
      }
      for (var w = 0; w < cram.length; w++) {
        var addr = cram[w][0], value = cram[w][1];
        if (typeof addr !== "number" || addr !== (addr | 0) ||
            addr < 0 || addr > 0x1FF ||
            typeof value !== "number" || value !== (value | 0) ||
            value < 0 || value > 0x1FF) {
          refuse("raster-entry",
                 "entry " + i + ": CRAM word " + w + " address and value " +
                 "must be 0..0x1ff, got " + JSON.stringify(cram[w]));
        }
        op |= 0x08 << w;
        arr["a" + (w + 1) + "_lo"][i] = addr & 0xFF;
        arr["a" + (w + 1) + "_hi"][i] = (addr >> 8) & 0xFF;
        arr["v" + (w + 1) + "_lo"][i] = value & 0xFF;
        arr["v" + (w + 1) + "_hi"][i] = (value >> 8) & 0xFF;
      }
      /* r_chain[i] arms the NEXT step: the RCR value that fires entry i
       * (the #15 convention — the boot arms chain[0], the tail re-arms
       * after every step).  Entries may reach line 240, so the value is
       * a full 16-bit word (the VDC's match window is wider than the
       * visible field; the scene r5 ends at line 240). */
      arr.chain_lo[i] = (0x40 + line) & 0xFF;
      arr.chain_hi[i] = ((0x40 + line) >> 8) & 0xFF;
      arr.op[i] = op;
    }
    var image = new Uint8Array(RASTER_IMAGE);
    u16(image, 0, RASTER_IMAGE);
    image[2] = raster.frameCounter ? 1 : 0;
    image[3] = n;
    var off = 4;
    image.set(arr.op, off);
    off += RASTER_STEPS + 12;      /* r_chain_lo is page-aligned ($2900) */
    for (var a = 1; a < RASTER_ARRAYS.length; a++) {
      image.set(arr[RASTER_ARRAYS[a]], off);
      off += RASTER_STEPS;
    }
    need(off === RASTER_IMAGE, "raster image size");
    return image;
  }

  /* Build the ROM.  Throws (rather than emitting a silently different ROM)
   * on anything the fixed layout cannot hold. */
  function buildRom(picture) {
    var bank0 = picture.bank0;
    var vram = picture.vram;
    var cram = picture.cram;
    var regs = picture.regs || {};
    var regionList = picture.regions || [];

    need(bank0 && bank0.length === BANK,
         "bank0 must be the assembled 8 KiB viewer code bank");
    need(vram && vram.length === 65536,
         "vram must be 65536 bytes (32768 words)");
    need(cram && cram.length === 1024,
         "cram must be 1024 bytes (512 colour-table entries)");

    var bxr = regs.BXR, byr = regs.BYR, mwr = regs.MWR, cr = regs.CR;
    byte("BXR", bxr, 0xFFFF);    /* packed as a 16-bit word; the VDC uses 10 */
    byte("BYR", byr, 0xFFFF);    /* packed as a 16-bit word; the VDC uses 9 */
    byte("MWR", mwr, 0xFF);
    byte("CR", cr, 0xFF);

    /* #70: a picture is wide when its VCE CR asks for a /3 or /2 dot clock.
     * A caller that carries no VCE register is the pre-#70 /4 picture. */
    var vcecr = regs.VCECR != null ? regs.VCECR : 0x04;
    byte("VCECR", vcecr, 0xFF);
    var wide = (vcecr & 0x03) !== 0;
    /* #67: the five display-window registers, from the picture.  A dump
     * names the VDC's R0C (VPR) "VSR" in its save-state field, so both
     * spellings are accepted; a caller without them is the viewer's
     * 256x240 constants. */
    var vprReg = regs.VPR != null ? regs.VPR : regs.VSR;
    var win = {
      HSR: regs.HSR != null ? regs.HSR : DEFAULT_WINDOW.HSR,
      HDR: regs.HDR != null ? regs.HDR : DEFAULT_WINDOW.HDR,
      VPR: vprReg != null ? vprReg : DEFAULT_WINDOW.VPR,
      VDR: regs.VDR != null ? regs.VDR : DEFAULT_WINDOW.VDR,
      VCR: regs.VCR != null ? regs.VCR : DEFAULT_WINDOW.VCR
    };
    for (var wk in WINDOW_LIMITS) {
      byte(wk, win[wk], 0xFFFF);
      if (win[wk] > WINDOW_LIMITS[wk]) {
        refuse("window-range", wk + "=$" + win[wk].toString(16) +
               " is past the register's $" +
               WINDOW_LIMITS[wk].toString(16) + " field width (VDC manual " +
               "H7-9..H7-11)");
      }
    }
    /* Version 3 = the window block carries the five registers.  A wide
     * picture whose vertical window is the standard one keeps version 2 and
     * its 8-byte block (its HSR/HDR are the wide mode's, #70), so #70's
     * wide ROMs do not change. */
    var windowChanged = false, verticalChanged = false;
    for (var wname in DEFAULT_WINDOW) {
      if (win[wname] !== DEFAULT_WINDOW[wname]) {
        windowChanged = true;
        if (wname !== "HSR" && wname !== "HDR") verticalChanged = true;
      }
    }
    var version = (verticalChanged || (!wide && windowChanged)) ? 3
                : wide ? 2 : 1;
    /* #70: the wide-window block and the #16 raster table are mutually
     * exclusive (docs/ROM_LAYOUT.md): genviewer.py refuses the combination,
     * and so does this builder, so the two stay comparable on every picture
     * either can describe.  A version 3 window block does not overlap the
     * table, so a non-wide window picture may run one. */
    if (wide && picture.raster)
      refuse("wide-raster", "a wide picture (VCE CR DCC != 00) cannot also " +
             "carry a raster table; the wide-window block and the table are " +
             "mutually exclusive (docs/ROM_LAYOUT.md)");

    /* ---- #16: the raster table (optional).  The table owns the boot
     * colour table (baseCram — what CRAM holds before the first entry of a
     * frame, the same state the renderer applies entries to) and adds the
     * RC interrupt enable to the config CR. */
    var raster = picture.raster || null;
    var rasterImage = null;
    if (raster) {
      var baseCram = raster.baseCram;
      need(baseCram && baseCram.length === 512,
           "raster.baseCram must be 512 colour-table words");
      for (var w = 0; w < 512; w++) byte("baseCram[" + w + "]", baseCram[w],
                                         0x1FF);
      need(raster.entries && raster.entries.length,
           "raster.entries must be a non-empty list");
      rasterImage = encodeRaster(raster);
      cr |= 0x04;                /* RC: the VDC interrupt enable (CR R05) */
    }

    var words = batWords(mwr);

    /* ---- filter and describe the tile regions exactly as genviewer.py does */
    var regions = [];
    for (var r = 0; r < regionList.length; r++) {
      var char0 = regionList[r][0], count = regionList[r][1];
      need(typeof char0 === "number" && char0 === (char0 | 0) && char0 >= 0,
           "region " + r + ": char0 must be a non-negative integer");
      need(typeof count === "number" && count === (count | 0) && count >= 0,
           "region " + r + ": count must be a non-negative integer");
      var dest = char0 * 16;     /* VRAM word address */
      need(count * 16 <= 0xFFFF,
           "region " + r + ": word count does not fit the descriptor (" +
           count * 16 + ")");
      if (dest >= 32768) continue;   /* writes past VRAM are dropped */
      /* A region that starts inside VRAM but ends past it would be sliced
       * short while its descriptor still promises the full length: the
       * viewer would read the next region's bytes as this one's tail.
       * docs/EXPORT.md says this throws, so it does. */
      need(dest + count * 16 <= 32768,
           "region " + r + ": words " + dest + ".." + (dest + count * 16) +
           " run past the 32768-word VRAM");
      regions.push([dest, count * 16]);
    }
    /* ---- the data blocks */
    var palette;
    if (raster) {
      /* the boot colour table is the table's baseCram, not picture.cram —
       * the renderer applies the entries to baseCram the same way */
      palette = new Uint8Array(1024);
      for (var c = 0; c < 512; c++) u16(palette, c * 2, baseCram[c]);
    } else {
      palette = cram.slice(0, 1024);
    }
    var bat = vram.slice(0, words * 2);
    var sat = vram.slice(SAT_ADDR * 2, SAT_ADDR * 2 + 512);
    var tileBytes = 0;
    for (var b = 0; b < regions.length; b++) tileBytes += regions[b][1] * 2;

    var batBanks = Math.ceil(bat.length / BANK);
    var tileBanks = Math.max(1, Math.ceil(tileBytes / BANK));
    need(batBanks <= MAX_BAT_BANKS,
         "BAT needs " + batBanks + " banks, the layout gives " + MAX_BAT_BANKS);
    /* The hardware ceiling, checked before the bytes are copied and before
     * the descriptor-count cap: a request too big for a HuCard is refused
     * with its own code whatever its region count (a picture within the
     * descriptor limit cannot reach this — its regions are slices of one
     * 64 KiB VRAM — but any request is refused rather than truncated). */
    var romBanks = 4 + tileBanks;
    if (romBanks > MAX_ROM_BANKS) {
      refuse("rom-too-big",
             "the ROM would be " + romBanks + " banks of 8 KiB (" +
             romBanks * BANK + " bytes); a HuCard decodes at most " +
             MAX_ROM_BANKS + " banks = 1 MB (physical banks $00-$7F; " +
             "sgxtech.txt \"HuC6280 memory map\", pcetech.txt §3 " +
             "\"Memory map\", hes spec [MEMORY MAP]; docs/MANUALS.md " +
             "§15.1 GAP 4)");
    }
    need(regions.length <= MAX_REGIONS,
         regions.length + " regions, the config block holds " + MAX_REGIONS);

    var parts = [];
    for (var i = 0; i < regions.length; i++)
      parts.push(vram.slice(regions[i][0] * 2,
                            regions[i][0] * 2 + regions[i][1] * 2));
    var tiles = concat(parts);

    /* ---- banks: 0 code, 1 config+palettes, 2-3 BAT, 4+ tiles; gaps 0xff */
    var rom = new Uint8Array(romBanks * BANK);
    rom.fill(0xFF);
    rom.set(bank0, 0);

    var bank1 = BANK;
    var cfg = new Uint8Array(CONFIG_SIZE);
    cfg[CFG_VERSION] = version;
    u16(cfg, CFG_BXR, bxr);
    u16(cfg, CFG_BYR, byr);
    cfg[CFG_MWR] = mwr;
    cfg[CFG_CR] = cr;
    cfg[CFG_RGNS] = regions.length;
    cfg[CFG_RASTER] = raster ? 1 : 0;
    for (var d = 0; d < regions.length; d++) {
      var off = CFG_REG0 + d * REG_SIZE;
      u16(cfg, off, regions[d][0]);
      u16(cfg, off + 2, regions[d][1]);
    }
    rom.set(cfg, bank1);
    rom.set(palette, bank1 + PALETTE_OFFSET);
    rom.set(sat, bank1 + SAT_OFFSET);
    if (rasterImage) rom.set(rasterImage, bank1 + RASTER_OFFSET);
    if (version >= 2) {
      /* #70/#67: the window block, byte for byte what tools/genviewer.py
       * writes: version 2 is VCE CR, reserved 0, HSR lo/hi, HDR lo/hi and
       * two reserved bytes; version 3 continues with VPR, VDR and VCR
       * (docs/ROM_LAYOUT.md). */
      var block = new Uint8Array(version === 3 ? WINDOW_SIZE : WIDE_SIZE);
      block[WINDOW_VCE_CR] = vcecr & 0xFF;
      var pairs = version === 3
        ? [["HSR", WINDOW_HSR_LO, WINDOW_HSR_HI],
           ["HDR", WINDOW_HDR_LO, WINDOW_HDR_HI],
           ["VPR", WINDOW_VPR_LO, WINDOW_VPR_HI],
           ["VDR", WINDOW_VDR_LO, WINDOW_VDR_HI],
           ["VCR", WINDOW_VCR_LO, WINDOW_VCR_HI]]
        : [["HSR", WINDOW_HSR_LO, WINDOW_HSR_HI],
           ["HDR", WINDOW_HDR_LO, WINDOW_HDR_HI]];
      for (var pi = 0; pi < pairs.length; pi++) {
        var pv = win[pairs[pi][0]];
        block[pairs[pi][1]] = pv & 0xFF;
        block[pairs[pi][2]] = (pv >> 8) & 0xFF;
      }
      rom.set(block, bank1 + WINDOW_OFFSET);
    }

    rom.set(bat, 2 * BANK);
    rom.set(tiles, 4 * BANK);

    return rom;
  }

  /* ---- #35: a music ROM --------------------------------------------------
   *
   * tools/hutrack.asm is a fixed skeleton: banks $00-$0F hold the startup,
   * MAIN, the HuTrack engine ($08) and its pitch tables ($09) — the same
   * bytes for every song — and bank $10 holds the song the converter
   * produced.  The export therefore takes the assembled song bank and the
   * committed engine image (renderer/hutrack-engine.bin, extracted from the
   * PCEAS build by tools/extract_engine.py) and lays them where PCEAS does.
   * All 17 banks are emitted, unused ones 0xff, exactly like `pceas -raw`.
   *
   * The song is assembled from the converter's include files by
   * renderer/pce-hutrack.js's assemble(); this function only places bytes.
   * The result is byte-identical to PCEAS's build of tools/hutrack.asm with
   * the same song (tests/check-export-song.js), which is how the placement
   * is proven rather than asserted. */
  var ENGINE_BANKS = 16;         /* $00-$0F: code, engine, tables */
  var SONG_BANK = 16;            /* $10 */
  var ROM_BANKS = ENGINE_BANKS + 1;

  function buildSongRom(music) {
    var engine = music && music.engine;
    var song = music && music.song;
    need(engine && engine.length === ENGINE_BANKS * BANK,
         "engine must be the " + ENGINE_BANKS + "-bank HuTrack image (" +
         ENGINE_BANKS * BANK + " bytes), got " +
         (engine ? engine.length : engine));
    need(song && song.length <= BANK,
         "the assembled song must fit its 8 KiB bank, got " +
         (song ? song.length : song) + " bytes");
    var rom = new Uint8Array(ROM_BANKS * BANK);
    rom.fill(0xFF);
    rom.set(engine, 0);
    rom.set(song, SONG_BANK * BANK);
    return rom;
  }

  /* ---- #100: a toy as IL bytecode + the interpreter ---------------------
   *
   * The browser's export for route 1: no compiler, no PCEAS, no llvm-mos.
   * `toy.bank0` is renderer/ilvm.bin (the committed 16 KiB image, loaded by
   * the page the same way viewer-bank0.bin is); `toy.bytecode` is the
   * container renderer/pce-ilbc.js encodes from the IL.  The result is the
   * interpreter image followed by one data bank (physical bank 2) holding
   * the bytecode and, after it, any assets the caller ships for a future
   * loader.
   *
   * The output is a pure function of its inputs, so the Node test and the
   * studio page produce the same bytes. */
  function buildToyRom(toy) {
    var bank0 = toy && toy.bank0;
    var bytecode = toy && toy.bytecode;
    var assets = (toy && toy.assets) || null;
    need(bank0 && bank0.length === ILVM_BYTES,
         "bank0 must be renderer/ilvm.bin (" + ILVM_BYTES +
         " bytes = two physical banks), got " +
         (bank0 ? bank0.length : "nothing"));
    need(bytecode && bytecode.length >= 24,
         "bytecode must be a pce-ilbc container");
    need(bytecode[0] === 0x49 && bytecode[1] === 0x4C &&
         bytecode[2] === 0x42 && bytecode[3] === 0x43,
         "bytecode must start with the ILBC magic (renderer/pce-ilbc.js)");
    /* #172's container version 2 carries the table section; the committed
     * interpreter image reads it since #175.  Version 1 stays byte-identical
     * (a table-free toy is unaffected). */
    need(bytecode[4] === 1 || bytecode[4] === 2,
         "bytecode version must be 1 or 2");
    var dataLen = bytecode.length + (assets ? assets.length : 0);
    if (dataLen > BANK) {
      refuse("toy-data-bank-full", "the bytecode (" + bytecode.length +
             " B) and assets (" + (assets ? assets.length : 0) + " B) need " +
             dataLen + " bytes; the interpreter reads one 8 KiB data bank");
    }

    var rom = new Uint8Array(ILVM_BYTES + BANK);
    rom.fill(0xFF);
    rom.set(bank0, 0);
    rom.set(bytecode, ILVM_BYTES);
    if (assets) rom.set(assets, ILVM_BYTES + bytecode.length);
    return rom;
  }

  return {
    BANK: BANK,
    ILVM_BYTES: ILVM_BYTES,
    TOY_DATA_BANK: TOY_DATA_BANK,
    buildToyRom: buildToyRom,
    MAX_REGIONS: MAX_REGIONS,
    MAX_ROM_BANKS: MAX_ROM_BANKS,
    MAX_TILE_BANKS: MAX_TILE_BANKS,
    RASTER_OFFSET: RASTER_OFFSET,
    RASTER_STEPS: RASTER_STEPS,
    RASTER_IMAGE: RASTER_IMAGE,
    ENGINE_BANKS: ENGINE_BANKS,
    SONG_BANK: SONG_BANK,
    ROM_BANKS: ROM_BANKS,
    batWords: batWords,
    buildRom: buildRom,
    buildSongRom: buildSongRom,
    encodeRaster: encodeRaster,
    reverseBits: reverseBits
  };
});
