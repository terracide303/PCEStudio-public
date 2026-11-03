/*
 * pce-card.js — turn an assembly project's banks into a HuCard .pce (card #231)
 *
 *   const card = require("../renderer/pce-card.js");
 *   const rom = card.build({
 *     bytes: assembled.bytes,          // PCEAS -raw output, 8 KiB banks
 *     banks: assembled.banks,          // pce-asm.js bankSizes(assembled.listing)
 *     pad384: false                    // optional 384 KiB padding rule
 *   });
 *   rom.bytes                          // Uint8Array, the .pce
 *
 * A PCEAS -raw image is already a headerless HuCard image: physical bank 0
 * is the 8 KiB that the CPU sees at $E000-$FFFF with MPR7 = 0 after reset,
 * and the reset/IRQ vectors are its last ten bytes ($FFF6-$FFFF).  This
 * module therefore does not reorder or relocate anything.  What it adds is
 * the part PCEAS leaves to the program:
 *
 *   - the whole-image checks a HuCard needs: a whole number of 8 KiB banks,
 *     at most 128 banks (1 MB — the card's decode, sgxtech/pcetech/HES,
 *     docs/MANUALS.md §15.1 GAP 4), and a reset vector in the boot bank;
 *   - a bank-overflow check.  PCEAS 3.23 silently wraps a bank that grows
 *     past $FFFF into the next physical bank (measured for #231: 8,300 bytes
 *     at .org $E000 became 8,193 bytes in bank 0 and 107 in bank 1), so the
 *     builder turns the listing's per-bank sizes into a named error with the
 *     numbers instead of shipping a ROM with silent corruption;
 *   - the optional 384 KiB padding rule named by the card: `pad384: true`
 *     fills an image smaller than 393,216 B (48 banks) up to it with $FF,
 *     the erased-ROM byte this repo uses for every gap
 *     (docs/ROM_LAYOUT.md).  A larger image is left alone.  The repo records
 *     no source for why that size is wanted, so it is an option, not the
 *     default.
 *
 * Errors are thrown with a machine-readable `code`, the same convention as
 * renderer/pce-rom.js and renderer/pce-project.js:
 *
 *   card-size           the image is not a whole number of 8 KiB banks
 *   card-too-big        more than 128 banks / 1 MB
 *   card-bank-overflow  one bank's data runs into the next bank
 *   card-vectors        the boot bank has no reset vector (both bytes $FF)
 *
 * Dual use: CommonJS in Node (tests/check-card.js, tools/build-card.js) and
 * a browser global (root.PCEStudio.card) beside pce-rom.js.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.card = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var BANK = 8192;                 /* one MPR window / one physical bank */
  var MAX_BANKS = 128;             /* the HuCard decode: $00-$7F = 1 MB */
  var MAX_BYTES = MAX_BANKS * BANK;
  var PAD384_BANKS = 48;           /* 384 KiB */
  var PAD384_BYTES = PAD384_BANKS * BANK;
  var VECTOR_OFFSET = 0x1FF6;      /* IRQ2; reset is the last two bytes */
  var RESET_OFFSET = 0x1FFE;
  var ERASED = 0xFF;

  function refuse(code, message, extra) {
    var e = new Error("pce-card: " + code + ": " + message);
    e.code = code;
    if (extra) {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) e[k] = extra[k];
      }
    }
    throw e;
  }

  function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    if (Array.isArray(value)) return new Uint8Array(value);
    refuse("card-size", "build() wants the assembled bytes as a Uint8Array");
  }

  function number(n) {
    return typeof n === "number" && isFinite(n) ? n : NaN;
  }

  /* The per-bank report and the overflow rule.  `banks` is
   * renderer/pce-asm.js bankSizes()'s return value: one record per bank with
   * the emitted byte count and the address span.  PCEAS reports a wrapped
   * bank with either more bytes than a bank holds or a `from + bytes` past
   * $10000, depending on where the wrap happened; both are caught. */
  function checkBanks(banks, rawLength) {
    var report = [];
    var i, n;
    for (i = 0; i < (banks || []).length; i++) {
      var b = banks[i] || {};
      var used = number(b.bytes);
      var from = number(b.from);
      var to = number(b.to);
      if (!isFinite(used) || !isFinite(from)) continue;

      if (used > BANK) {
        /* A full bank plus whatever PCEAS let continue into the next one.
         * The spill is only counted when the next record is the very next
         * bank and starts at the bottom of its window, which is what a wrap
         * does (measured: bank 0 at $E000 + 8,300 bytes spills to bank 1 at
         * $0001). */
        var spill = 0, spilledTo = null;
        var next = banks[i + 1];
        if (next && number(next.bank) === number(b.bank) + 1 &&
            number(next.from) < 0x1000 && number(next.bytes) > 0) {
          spill = number(next.bytes);
          spilledTo = next.bank;
        }
        var total = used + spill;
        refuse("card-bank-overflow",
          "bank " + b.bank + " holds " + total + " B in an " + BANK +
          " B bank (" + (total - BANK) + " B over)" +
          (spilledTo != null
            ? "; " + spill + " B ran into bank " + spilledTo
            : ""),
          { bank: b.bank, used: total, capacity: BANK, over: total - BANK,
            spill: spill, spillBank: spilledTo });
      }

      /* A source that starts near the top of a bank and runs past $FFFF
       * wraps to the bottom of the same bank; PCEAS fills the wrapped bytes
       * with $FF (measured for #231: 14 bytes at .org $FFF6 become 5 words
       * at $FFF6-$FFFF and two $FFFF words at $0000).  `from` has become the
       * wrapped low address, so the first emitted address (`first`) is what
       * says the data ran off the top.  A bank with no `first` (an older
       * caller) falls back to `from`. */
      var start = number(b.first);
      if (!isFinite(start)) start = from;
      if (isFinite(start) && start + used > 0x10000) {
        var room = 0x10000 - start;
        refuse("card-bank-overflow",
          "bank " + b.bank + " holds " + used + " B from $" +
          start.toString(16).toUpperCase() + " and runs " +
          (start + used - 0x10000) + " B past $FFFF (" + room +
          " B fit after that address)",
          { bank: b.bank, used: used, capacity: room,
            over: start + used - 0x10000, from: start });
      }

      report.push({
        bank: b.bank, bytes: used, from: from, to: to,
        free: Math.max(0, BANK - used)
      });
    }
    return report;
  }

  /*
   * build(input, options)
   *   input   a Uint8Array, or { bytes, banks, vectorBank, vectors, pad384 }
   *   options { pad384, vectors, vectorBank }
   *
   * Returns { bytes, size, bankCount, imageBanks, padding, banks, vector }.
   * `bankCount` is what the assembler produced; `imageBanks` is what the
   * file holds after padding.  No bytes are changed except the $FF padding.
   */
  function build(input, options) {
    options = options || {};
    var data = input && !(input instanceof Uint8Array) &&
               !(input instanceof ArrayBuffer) && !ArrayBuffer.isView(input) &&
               !Array.isArray(input) ? input : {};
    if (!data || Object.keys(data).length === 0) data = { bytes: input };
    var raw = toBytes(data.bytes);
    var banks = data.banks || options.banks || [];
    var pad384 = data.pad384 != null ? !!data.pad384 : !!options.pad384;
    var wantVectors = data.vectors != null ? !!data.vectors
                                           : options.vectors !== false;
    var vectorBank = data.vectorBank != null ? data.vectorBank
                     : (options.vectorBank != null ? options.vectorBank : 0);

    if (!raw || raw.length === 0) {
      refuse("card-size", "the assembled image is empty; there is no ROM to " +
                          "build (the assembler reported an error)");
    }
    if (raw.length % BANK !== 0) {
      refuse("card-size", "the assembled image is " + raw.length + " B, not " +
                          "a whole number of 8 KiB banks (a HuCard is a " +
                          "whole number of banks)");
    }
    var bankCount = raw.length / BANK;
    if (bankCount > MAX_BANKS) {
      refuse("card-too-big",
        "the image is " + raw.length + " B in " + bankCount + " banks; a " +
        "HuCard decodes at most " + MAX_BANKS + " banks (" + MAX_BYTES +
        " B), so " + (raw.length - MAX_BYTES) + " B / " +
        (bankCount - MAX_BANKS) + " bank(s) too many",
        { used: raw.length, capacity: MAX_BYTES, over: raw.length - MAX_BYTES,
          banks: bankCount, maxBanks: MAX_BANKS });
    }

    var report = checkBanks(banks, raw.length);

    /* The boot bank is the one mapped at $E000-$FFFF after reset (MPR7 =
     * 0).  PCEAS calls it physical bank 0, and a -raw image starts with it;
     * "the end of the last bank" in the layout means the end of that 8 KiB,
     * where $FFF6-$FFFF holds the vectors.  If both reset bytes are $FF the
     * program never starts (the CPU would read $FFFF), so refuse clearly. */
    var vbank = number(vectorBank);
    if (!isFinite(vbank) || vbank < 0 || vbank >= bankCount) {
      refuse("card-vectors", "vectorBank " + vectorBank + " is outside the " +
                             "image's " + bankCount + " bank(s)");
    }
    var resetAt = vbank * BANK + RESET_OFFSET;
    var vector = {
      bank: vbank, address: 0xFFFE,
      reset: raw[resetAt] | (raw[resetAt + 1] << 8),
      table: []
    };
    for (var k = 0; k < 5; k++) {
      var off = vbank * BANK + VECTOR_OFFSET + k * 2;
      vector.table.push(raw[off] | (raw[off + 1] << 8));
    }
    if (wantVectors && raw[resetAt] === ERASED && raw[resetAt + 1] === ERASED) {
      refuse("card-vectors",
        "bank " + vbank + " has no reset vector: $FFFE/$FFFF are $FFFF " +
        "(the vector table must sit at " + "$" +
        (VECTOR_OFFSET + vbank * BANK).toString(16).toUpperCase() +
        "-$FFFF of the bank mapped at $E000)");
    }

    var out = raw;
    var padding = 0;
    if (pad384 && raw.length < PAD384_BYTES) {
      out = new Uint8Array(PAD384_BYTES);
      out.fill(ERASED);
      out.set(raw, 0);
      padding = PAD384_BYTES - raw.length;
    }

    return {
      bytes: out,
      size: out.length,
      bankCount: bankCount,
      imageBanks: out.length / BANK,
      padding: padding,
      pad384: !!pad384,
      banks: report,
      vector: vector
    };
  }

  return {
    build: build,
    BANK: BANK,
    MAX_BANKS: MAX_BANKS,
    MAX_BYTES: MAX_BYTES,
    PAD384_BANKS: PAD384_BANKS,
    PAD384_BYTES: PAD384_BYTES
  };
});
