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
 *   regs:    { BXR, BYR, MWR, CR } — exactly the values the config block
 *            carries (docs/ROM_LAYOUT.md, bank 1)
 *   regions: [[char0, tileCount], ...] — the picture's VRAM copy regions in
 *            descriptor order (tests/dumps/sceneN/regions.json for the
 *            sample scenes; for the #12 sprite scenes the list also carries
 *            the SG pattern block at VRAM word 0x2000).  Regions whose VRAM
 *            destination word is 32768
 *            or higher are dropped: the VDC drops those writes and the
 *            renderer model reads them as colour 0.  A region that starts
 *            below 32768 but ends past it throws (it cannot be described
 *            truthfully; docs/EXPORT.md).
 *
 * Output: Uint8Array, an 8 KiB-banked headerless HuCard image.  Banks are
 * filled with 0xff; bank 1 holds the 64-byte config at offset 0, the 512
 * colour-table entries (BG + sprite palettes) at offset 0x40 and the SAT at
 * offset 0x440 (64 entries x 4 words from VRAM word 0x7F00 — the SATB DMA
 * source, card #14); banks 2-3 hold the BAT; banks 4+ hold the copy regions
 * concatenated.  The bank count is 4 + ceil(tiles / 8 KiB),
 * which is also what PCEAS -raw emits for the generated viewer .asm.
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
  var CFG_REG0 = 0x0A;
  var REG_SIZE = 4;
  var MAX_REGIONS = 8;
  var MAX_BAT_BANKS = 2;         /* banks 2-3 */
  var MAX_TILE_BANKS = 6;        /* banks 4-9 */

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

    var words = batWords(mwr);

    /* ---- filter and describe the tile regions exactly as genviewer.py does */
    var regions = [], dests = [];
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
    need(regions.length <= MAX_REGIONS,
         regions.length + " regions, the config block holds " + MAX_REGIONS);

    /* ---- the data blocks */
    var palette = cram.slice(0, 1024);
    var bat = vram.slice(0, words * 2);
    var sat = vram.slice(SAT_ADDR * 2, SAT_ADDR * 2 + 512);
    var parts = [];
    for (var i = 0; i < regions.length; i++)
      parts.push(vram.slice(regions[i][0] * 2,
                            regions[i][0] * 2 + regions[i][1] * 2));
    var tiles = concat(parts);

    var batBanks = Math.ceil(bat.length / BANK);
    var tileBanks = Math.max(1, Math.ceil(tiles.length / BANK));
    need(batBanks <= MAX_BAT_BANKS,
         "BAT needs " + batBanks + " banks, the layout gives " + MAX_BAT_BANKS);
    need(tileBanks <= MAX_TILE_BANKS,
         "tiles need " + tileBanks + " banks, the layout gives " + MAX_TILE_BANKS);

    /* ---- banks: 0 code, 1 config+palettes, 2-3 BAT, 4+ tiles; gaps 0xff */
    var rom = new Uint8Array((4 + tileBanks) * BANK);
    rom.fill(0xFF);
    rom.set(bank0, 0);

    var bank1 = BANK;
    var cfg = new Uint8Array(CONFIG_SIZE);
    cfg[CFG_VERSION] = 1;
    u16(cfg, CFG_BXR, bxr);
    u16(cfg, CFG_BYR, byr);
    cfg[CFG_MWR] = mwr;
    cfg[CFG_CR] = cr;
    cfg[CFG_RGNS] = regions.length;
    for (var d = 0; d < regions.length; d++) {
      var off = CFG_REG0 + d * REG_SIZE;
      u16(cfg, off, regions[d][0]);
      u16(cfg, off + 2, regions[d][1]);
    }
    rom.set(cfg, bank1);
    rom.set(palette, bank1 + PALETTE_OFFSET);
    rom.set(sat, bank1 + SAT_OFFSET);

    rom.set(bat, 2 * BANK);
    rom.set(tiles, 4 * BANK);

    return rom;
  }

  return {
    BANK: BANK,
    batWords: batWords,
    buildRom: buildRom,
    reverseBits: reverseBits
  };
});
