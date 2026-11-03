/*
 * pce-card.js — the HuCard builder (card #231).
 *
 * Takes the assembled banks of an assembly project — renderer/pce-asm.js's
 * -raw output, 8192 bytes per bank in .bank order — and writes a .pce file:
 * a 512-byte header (byte 0 = bank count, the rest zero — the PCEAS 3.23
 * header, pceas3-src/src/mkit/as/pce.c, read as the working example)
 * followed by the banks in physical order.  Bank N of the image is HuCard
 * bank N: the HuCard interface decodes bank numbers $00-$7F, 1 MB
 * (docs/MANUALS.md §15.1 GAP 4), so the builder refuses more than 128 banks.
 *
 * Boot reading (docs/MANUALS.md §5.3 + measured): after reset MPR7 = 0 and
 * the CPU jumps through $FFFE/$FFFF of logical bank 0 — physical bank 0.
 * A card whose vectors live at the end of a LATER bank does not boot
 * (measured in Mednafen: white screen).  The builder therefore checks the
 * reset vector at the end of the FIRST bank; the card's "vectors at the end
 * of the last bank" wording holds for the single-bank layout the examples
 * use (first bank = last bank).
 *
 * Named errors, each with .code and a message carrying the sizes:
 *
 *   card-size        the assembled bytes are not whole 8 KB banks
 *   card-too-big     more than 128 banks (the 1 MB HuCard decode)
 *   bank-overflow    a run in the listing crosses the top of its own 8 KB
 *                    block
 *   missing-vectors  the reset vector at $FFFE/$FFFF of bank 0 is $0000
 *
 * bank-overflow cannot come from the image — PCEAS either spills the
 * excess into the next bank (with a warning) or drops it (silently) — so
 * it is derived from the listing: the layout entries are pce-asm.js's
 * bankRegions(), one entry per CONTIGUOUS address run, and a run that ends
 * past the top of its own 8 KB block is an overflow.  (PCEAS places a
 * bank's bytes inside the 8 KB block that holds the first .org — measured:
 * code at $E000 may run to $FFFF, code at $0000 stops at $1FFF.)  A merged
 * per-bank span cannot do this job: "code at $E000, data at $1000" is
 * legal but would read as one huge span.  One caveat: the listing shows
 * only the first bytes of a long .db run, so a run that starts well inside
 * its window is shown stopping inside it while PCEAS dropped the tail —
 * that drop stays invisible (measured: 100 B of .db at $1FC0 drops at
 * $1FFF, the listing stops at $1FEF and nothing flags).
 *
 * pad: an option, not a rule we could source — no manual, HuC file or
 * PCEAS source we read documents a 384 KB fill, and Mednafen boots a
 * 1-bank card without one (measured).  When pad is true the card is
 * $FF-filled to 48 banks (393,216 bytes) so it covers a full 384 KB EPROM.
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.card = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var BANK = 8192;              /* bytes per HuCard bank (docs/MANUALS.md §3) */
  var HEADER = 512;             /* the .pce header PCEAS writes */
  var MAX_BANKS = 128;          /* the HuCard's 1 MB decode (§15.1 GAP 4) */
  var MIN_PAD_BANKS = 48;       /* 384 KB = the classic fill size */

  function cardError(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  function sizeLabel(n) {
    var B = (n % BANK === 0 ? n + " B (" + (n / BANK) + " bank" +
             (n === BANK ? "" : "s") + ")" : n + " B");
    return B;
  }

  /*
   * build(bytes, {layout, pad}) -> Uint8Array
   *
   *   bytes    the assembled image, whole 8 KB banks in .bank order
   *            (pce-asm.js's -raw output; a plain Array is accepted too)
   *   layout   optional: the listing's contiguous address runs, as
   *            pce-asm.js's bankRegions() returns them —
   *            [{bank, bytes, from, to}].  Used only for the
   *            bank-overflow check; the bank order is the image's own.
   *   pad      optional: $FF-fill to 48 banks (default false)
   *
   * Throws {code, message} on the errors above.
   */
  function build(bytes, opts) {
    opts = opts || {};
    var b = (bytes instanceof Uint8Array) ? bytes : new Uint8Array(bytes);

    if (b.length % BANK !== 0) {
      throw cardError("card-size",
        "the assembled image is " + sizeLabel(b.length) +
        ", not a whole number of " + BANK + " B banks");
    }
    var banks = b.length / BANK;
    if (banks < 1) {
      throw cardError("card-size",
        "the assembled image is empty — nothing to put on the card");
    }
    if (banks > MAX_BANKS) {
      throw cardError("card-too-big",
        "the assembled image is " + sizeLabel(b.length) + "; a HuCard " +
        "decodes " + MAX_BANKS + " banks (1 MB) — cut it to " +
        MAX_BANKS * BANK + " B");
    }
    if (opts.layout) {
      for (var i = 0; i < opts.layout.length; i++) {
        var span = opts.layout[i];
        if (!span) continue;
        /* The top of the 8 KB block that holds the run's first byte; a run
         * that ends past it does not fit its bank. */
        var top = (span.from | (BANK - 1)) + 1;
        if (span.to > top) {
          throw cardError("bank-overflow",
            "bank " + span.bank + " holds " + span.bytes + " B in a run " +
            "from $" + span.from.toString(16) + " to $" +
            (span.to - 1).toString(16) + " — past $" + top.toString(16) +
            ", the top of the " + BANK + " B block the bank gives it.  " +
            "PCEAS dropped or spilled the excess; the run must end by $" +
            top.toString(16));
        }
      }
    }
    if (b[BANK - 2] === 0 && b[BANK - 1] === 0) {
      throw cardError("missing-vectors",
        "the reset vector at $FFFE-$FFFF of bank 0 is $0000 — the card " +
        "would not boot (after reset MPR7 = 0, so the CPU reads the " +
        "vector from bank 0).  Put \".org $FFF6\" and your vector table " +
        "at the end of the first bank");
    }

    var total = (opts.pad === true) ? Math.max(MIN_PAD_BANKS, banks) : banks;
    var out = new Uint8Array(HEADER + total * BANK);
    out.fill(0xFF);                        /* the pad: unprogrammed EPROM */
    out.set(b, HEADER);
    out.fill(0, 0, HEADER);                /* the header: all zero ... */
    out[0] = total;                        /* ... but the bank count */
    return out;
  }

  return {
    BANK: BANK,
    HEADER: HEADER,
    MAX_BANKS: MAX_BANKS,
    MIN_PAD_BANKS: MIN_PAD_BANKS,
    build: build
  };
}));
