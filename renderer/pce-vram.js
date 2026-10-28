/*
 * pce-vram.js — PCEStudio's VRAM model (card #49): the VDC's 32K-word store
 * and its VRAM-to-VRAM block transfer (SOUR/DESR/LENR, DCR).
 *
 * VRAM is the same byte array the rest of the renderer reads: 65536 bytes =
 * 32768 little-endian words.  The VDC's registers address 16-bit words; the
 * console only has 32K of them, so a write past word $7FFF is dropped
 * (MacDonald pcetech §5 "Memory map"/§5.4: "the upper word half mirrors,
 * writes there are ignored and reads may be corrupted" — the corruption is
 * not modelled, reads here mirror to the low half).  No capture in the repo
 * crosses $7FFF; the three #49 ROMs are checked to stay inside it.
 *
 * The transfer (HuC6270 VDC manual, PCEHeroTN docs/datasheets/text):
 *   - SOUR R10 p. H7-11, DESR R11 p. H7-11: 16-bit source and destination;
 *     they must not be updated during a transfer.
 *   - LENR R12 p. H7-12: length = M-1 words, up to 64K; the transfer starts
 *     on the high-byte write (the manual calls it LENA on p. H7-2 and LENR
 *     on p. H7-12 — MANUALS.md §8 records the inconsistency; LENR is used
 *     here).
 *   - DCR R0F p. H7-11: bit 0 DSC = VRAM-to-SATB-done IRQ enable, bit 1 DVC
 *     = VRAM-to-VRAM-done IRQ enable, bit 2 SI/D = source address decrements
 *     when set, bit 3 DI/D = destination address decrements when set,
 *     bit 4 DSR = VRAM-to-SATB auto-repeat.  This module decodes all five;
 *     DSR/DSC drive the other channel (#14) and are reported, not executed.
 *   - VRAM-to-VRAM transfers happen only outside the active display (VBlank
 *     or burst mode); both DMA channels may run together (p. H7-12, H7-4).
 *
 * What the manual leaves out, and MacDonald's measured notes settle
 * (docs/MANUALS.md §15.1 GAP 2, pcetech §5.4): SOUR/DESR/LENR act as
 * counters and keep their post-transfer values instead of the values
 * written, LENR ends $FFFF (not zero) when a transfer completes, and CR's
 * IW field does not change the step — it is always 1.  The transfer reads
 * one word and writes it before reading the next, so a copy that overlaps
 * its own source replicates the first bytes rather than behaving like
 * memmove; tests/dumps/dma3 is the capture that holds the model to that.
 *
 * Timing: the model applies the transfer in the free time after the LENR
 * high-byte write — VBlank, or burst mode.  A started transfer that does not
 * fit before the active display is the one point where the sources disagree:
 * H7-12 says it is cancelled with no done status, pcetech §5.4 says it is
 * halted and resumes.  This module applies a started transfer to completion
 * (the measured note's rule), and every #49 capture keeps the display in
 * burst mode until its transfer has finished, so no capture depends on that
 * choice (docs/RENDERER.md, "VRAM-to-VRAM DMA").
 *
 * Dual use: CommonJS module in Node and a browser global (PCEStudio.vram),
 * like renderer/pce-bg.js.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.vram = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VRAM_WORDS = 0x8000;   /* 32768 words = 64 KiB (Mednafen VRAM_Size) */

  function readWord(vram, addr) {
    /* the high word half mirrors; reads there "may be corrupted" (pcetech
     * §5.4) — corruption is not modelled, no capture crosses it */
    var w = addr & (VRAM_WORDS - 1);
    return vram[w * 2] | (vram[w * 2 + 1] << 8);
  }

  /* Returns false when the VDC would drop the write (a destination past the
   * 32K words). */
  function writeWord(vram, addr, word) {
    if (addr >= VRAM_WORDS) return false;
    vram[addr * 2] = word & 0xFF;
    vram[addr * 2 + 1] = (word >> 8) & 0xFF;
    return true;
  }

  /* DCR's five defined bits (H7-11); the rest read as 0. */
  function decodeDcr(dcr) {
    dcr = dcr & 0x1F;
    return {
      dsc: !!(dcr & 0x01),   /* bit 0: VRAM-to-SATB done IRQ enable */
      dvc: !!(dcr & 0x02),   /* bit 1: VRAM-to-VRAM done IRQ enable */
      siDec: !!(dcr & 0x04), /* bit 2: SI/D, source decrements */
      diDec: !!(dcr & 0x08), /* bit 3: DI/D, destination decrements */
      dsr: !!(dcr & 0x10)    /* bit 4: VRAM-to-SATB auto-repeat */
    };
  }

  /* Run one VRAM-to-VRAM transfer and return a NEW byte array: the input is
   * left untouched, so a check can hold the pre-transfer state too.
   *
   *   dma = { sour, desr, lenr, dcr }  — the values the ROM wrote, as words
   *
   * The result carries the post-transfer register values (the counters),
   * the word count, and the DCR decode.  `dvBit` is the status bit the VDC
   * raises on completion: DV (SR bit 4), set only when its enable bit DVC is
   * set — pcetech §5 "a status bit is set only when its enable bit is set";
   * #50's status model owns the other bits. */
  function runDma(vram, dma) {
    var dcr = decodeDcr(dma.dcr != null ? dma.dcr : 0);
    var src = dma.sour & 0xFFFF;
    var dst = dma.desr & 0xFFFF;
    var len = dma.lenr & 0xFFFF;
    var words = len + 1;              /* LENR = M-1; 0 -> 1, $FFFF -> 65536 */
    var srcStep = dcr.siDec ? -1 : 1;
    var dstStep = dcr.diDec ? -1 : 1;
    var out = new Uint8Array(vram.length);
    out.set(vram);

    for (var i = 0; i < words; i++) {
      /* read-the-word-then-write-it, in address order: an overlapping copy
       * sees the words it has already written (hardware, not memmove) */
      var word = readWord(out, src);
      writeWord(out, dst, word);
      src = (src + srcStep) & 0xFFFF;
      dst = (dst + dstStep) & 0xFFFF;
      len = (len - 1) & 0xFFFF;
    }
    return {
      vram: out,
      sour: src, desr: dst, lenr: len,   /* len ends $FFFF (pcetech §5.4) */
      words: words,
      done: true,
      dvBit: dcr.dvc,
      dcr: dcr
    };
  }

  /* The registers of a transfer, taken from the same named-value object the
   * dumps and the panels use (a Mednafen save state's regs.json, or a viewer
   * picture's config). */
  function registersOf(regs) {
    return { sour: regs.SOUR, desr: regs.DESR, lenr: regs.LENR, dcr: regs.DCR };
  }

  return {
    VRAM_WORDS: VRAM_WORDS,
    readWord: readWord,
    writeWord: writeWord,
    decodeDcr: decodeDcr,
    runDma: runDma,
    registersOf: registersOf
  };
});
