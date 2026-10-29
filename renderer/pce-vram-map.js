/*
 * pce-vram-map.js — the VRAM panel as a drawn map (card #85, part B).
 *
 * The working example is ppu.toys' VRAM panel, read from its served bundle
 * ($TMPDIR/pcestudio-design-75/app.js, the `vram-panel` component): VRAM is
 * drawn as an image of characters — 8x8 tiles, paged with a `‹ page ›`
 * picker, a format selector, a preview palette and a "Jump to …" row — with a
 * hover readout of the address and character under the pointer, not a table
 * of ranges.  The PCE counterpart is simpler in one way and harder in another:
 * a character is always 16 VRAM words of 4bpp (VRAM has 2048 of them, eight
 * pages of 256), but the 32x32 BAT at word $0000 and the 64-word SAT at $7F00
 * hold words, not pixels, so those regions are tinted rather than pretended
 * to be tiles.
 *
 * This file is the panel's model and nothing drawn: the character decode (the
 * same bit layout renderer/pce-bg.js backgroundPixel reads), the page
 * arithmetic, and what a word is — a BAT cell, a tile row, a sprite-pattern
 * row, a SAT word, or free.  renderer/pce-panels.js owns the region map
 * (vramMap); this module only says where a word sits inside it.
 * renderer/studio-panel-vram.js is the panel that draws it.
 *
 * VRAM is the running toy's own: the panel reads the frame the renderer was
 * given (the same VRAM pce-bg.js draws), so it shows what the toy wrote, not
 * a second copy of it.  The BAT and SAT are read as words; the characters are
 * decoded through the one 4bpp decode, in the one place.
 *
 * Dual use: CommonJS module in Node (tests/check-studio.js) and a browser
 * global (renderer/studio.html), like pce-screen.js and pce-bg.js.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.vramMap = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var WORDS = 32768;          /* the VDC's 32 KiB of VRAM, as words */
  var CHAR_WORDS = 16;        /* one character: 8 rows x 2 words (planes 0/1) */
  var CHARS = WORDS / CHAR_WORDS;          /* 2048 */
  var PAGE_CHARS = 256;       /* a page is 16 x 16 characters */
  var PAGES = CHARS / PAGE_CHARS;          /* 8 */
  var PAGE_COLS = 16;
  var PAGE_ROWS = 16;
  var CELL = 8;

  var SAT_WORDS = 64;         /* 64 sprites x 4 words */

  var LABELS = {
    "BAT": "BAT",
    "tiles": "tiles",
    "sprite patterns": "sprite patterns",
    "SAT": "SAT",
    "free": "free"
  };

  /* The order the legend and the jump buttons use: the BAT first, then the
   * data, then the SAT, then air. */
  var KIND_ORDER = ["BAT", "tiles", "sprite patterns", "SAT", "free"];

  function fail(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  function isInt(v) { return typeof v === "number" && v === Math.floor(v); }

  function checkWord(word) {
    if (!isInt(word) || word < 0 || word >= WORDS)
      throw fail("vram-range", "VRAM is 32768 words ($0000-$7FFF); word " +
                 word + " is not inside it");
    return word;
  }

  function checkChar(ch) {
    if (!isInt(ch) || ch < 0 || ch >= CHARS)
      throw fail("char-range", "VRAM holds " + CHARS + " characters of " +
                 CHAR_WORDS + " words; character " + ch + " is not one of them");
    return ch;
  }

  function u16(vram, word) {
    if (word < 0 || word >= WORDS) return 0;
    return vram[word * 2] | (vram[word * 2 + 1] << 8);
  }

  /* ---- the character decode -------------------------------------------- *
   * One 4bpp pixel, bit for bit the decode renderer/pce-bg.js
   * backgroundPixel uses: a character's row r is word ch*16+r (plane 0) and
   * word ch*16+r+8 (plane 1); bit 7 of each byte is the leftmost pixel;
   * pixel bit 0 is plane 0's low byte, bit 1 its high byte, bit 2 plane 1's
   * low byte, bit 3 its high byte. */
  function charPixel(vram, ch, x, y) {
    checkChar(ch);
    if (!isInt(x) || !isInt(y) || x < 0 || x >= CELL || y < 0 || y >= CELL)
      throw fail("pixel-range", "a character is 8x8; (" + x + "," + y + ") " +
                 "is not inside it");
    var word = ch * CHAR_WORDS + y;
    var w0 = u16(vram, word), w1 = u16(vram, word + 8);
    var bit = 7 - x;
    return ((w0 >> bit) & 1)
         | (((w0 >> (bit + 8)) & 1) << 1)
         | (((w1 >> bit) & 1) << 2)
         | (((w1 >> (bit + 8)) & 1) << 3);
  }

  /* A whole character, 64 4-bit colour numbers, row-major. */
  function charPixels(vram, ch) {
    checkChar(ch);
    var out = new Uint8Array(CELL * CELL);
    for (var y = 0; y < CELL; y++)
      for (var x = 0; x < CELL; x++)
        out[y * CELL + x] = charPixel(vram, ch, x, y);
    return out;
  }

  /* ---- pages ------------------------------------------------------------ */

  function pageOfChar(ch) { return Math.floor(checkChar(ch) / PAGE_CHARS); }

  function pageRange(page) {
    if (!isInt(page) || page < 0 || page >= PAGES)
      throw fail("page-range", "the map has " + PAGES + " pages of " +
                 PAGE_CHARS + " characters; page " + page + " is not one");
    var first = page * PAGE_CHARS;
    return {
      page: page, firstChar: first, lastChar: first + PAGE_CHARS - 1,
      startWord: first * CHAR_WORDS,
      endWord: (first + PAGE_CHARS) * CHAR_WORDS - 1,
      cols: PAGE_COLS, rows: PAGE_ROWS
    };
  }

  function charOfWord(word) { return Math.floor(checkWord(word) / CHAR_WORDS); }

  /* "char $4A0" — the sheet's own name for a character. */
  function charName(ch) {
    return "$" + checkChar(ch).toString(16).toUpperCase().padStart(3, "0");
  }

  function wordName(word) {
    return "$" + checkWord(word).toString(16).toUpperCase().padStart(4, "0");
  }

  /* ---- what a word is --------------------------------------------------- */

  /* pce-panels.js vramMap's segments carry one kind per segment; the copy
   * regions can say "sprite patterns (part named by the SAT)", which is the
   * same paint as "sprite patterns" for the legend and the jump row. */
  function baseKind(kind) {
    if (!kind) return "free";
    return kind.indexOf("sprite patterns") === 0 ? "sprite patterns" : kind;
  }

  function regionOf(map, word) {
    checkWord(word);
    var segs = (map && map.segments) || [];
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (word >= s.start && word < s.start + s.words) return s;
    }
    return null;
  }

  function kindOf(map, word) {
    var seg = regionOf(map, word);
    return seg ? baseKind(seg.kind) : "free";
  }

  /* Contiguous runs of one kind: the legend's rows and the jump buttons.
   * Each is {kind, start, end, words, firstPage, lastPage}. */
  function regions(map) {
    var segs = (map && map.segments) || [];
    var out = [];
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i], kind = baseKind(s.kind);
      var last = out[out.length - 1];
      if (last && last.kind === kind && last.end + 1 === s.start) {
        last.end = s.start + s.words - 1;
        last.words += s.words;
      } else {
        out.push({ kind: kind, start: s.start, end: s.start + s.words - 1,
                   words: s.words });
      }
    }
    for (var j = 0; j < out.length; j++) {
      out[j].firstPage = pageOfChar(charOfWord(out[j].start));
      out[j].lastPage = pageOfChar(charOfWord(out[j].end));
      out[j].label = LABELS[out[j].kind] || out[j].kind;
    }
    return out;
  }

  /* One jump per kind, to where that kind first starts — ppu.toys' "Jump to
   * BG characters" row, with the PCE's regions. */
  function jumps(map) {
    var runs = regions(map), seen = {}, out = [];
    for (var k = 0; k < KIND_ORDER.length; k++) {
      for (var i = 0; i < runs.length; i++) {
        if (runs[i].kind !== KIND_ORDER[k] || seen[KIND_ORDER[k]]) continue;
        seen[KIND_ORDER[k]] = true;
        out.push({ kind: runs[i].kind, label: runs[i].label,
                   start: runs[i].start, end: runs[i].end,
                   words: runs[i].words, page: runs[i].firstPage });
      }
    }
    return out;
  }

  /* The words of one 64-word sprite in the SAT: [Y, X, pattern, attributes]. */
  function spriteWords(vram, satAddr, sprite) {
    if (!isInt(sprite) || sprite < 0 || sprite >= 64)
      throw fail("sprite-range", "the SAT holds 64 sprites; " + sprite +
                 " is not one of them");
    var at = satAddr + sprite * 4;
    return [u16(vram, at), u16(vram, at + 1),
            u16(vram, at + 2), u16(vram, at + 3)];
  }

  /* What one word is, for the hover line and the click readout.  `geom` is
   * the BAT geometry from st.geom (the BAT is not always 32 wide); `satAddr`
   * is st.satAddr.  Returns {word, kind, char, text, detail}. */
  function describe(vram, map, geom, satAddr, word) {
    checkWord(word);
    var seg = regionOf(map, word);
    var kind = seg ? baseKind(seg.kind) : "free";
    var out = { word: word, kind: kind, char: charOfWord(word),
                text: "", detail: "" };
    var w = u16(vram, word);

    if (seg && seg.kind === "BAT") {
      var cols = (geom && geom.width) || 32;
      var col = word % cols, row = Math.floor(word / cols);
      out.char = w & 0xFFF;
      out.palette = (w >> 12) & 0xF;
      out.text = "BAT cell " + word + " · col " + col + ", row " + row +
                 " · char $" + hex3(out.char) + " · palette " + out.palette;
      out.detail = "BAT cell " + word + " = " + wordName(word) +
                   " ($" + hex4(w) + "): character $" + hex3(out.char) +
                   " with palette field " + out.palette;
    } else if (kind === "tiles" || kind === "sprite patterns") {
      var off = word - out.char * CHAR_WORDS;
      out.row = off & 7;
      out.plane = off >= 8 ? 1 : 0;
      var what = kind === "tiles" ? "tile" : "sprite pattern";
      out.text = "char " + charName(out.char) + " · row " + out.row +
                 " · plane " + out.plane;
      out.detail = charName(out.char) + " is one " + what + " (16 words): " +
                   "row " + out.row + ", plane " + out.plane +
                   " — " + wordName(word) + " = $" + hex4(w) +
                   "; the other plane is " + wordName(out.char * CHAR_WORDS +
                     out.row + (out.plane ? 0 : 8));
    } else if (kind === "SAT") {
      var at = seg.start;
      var n = Math.floor((word - at) / 4), which = (word - at) % 4;
      var sw = spriteWords(vram, at, n);
      var only = (sw[0] | sw[1] | sw[2] | sw[3]) === 0;
      out.sprite = n;
      out.which = which;
      out.text = "SAT sprite " + n + " · word " + which;
      out.detail = "SAT sprite " + n + (only ? " (empty)" : "") +
                   " · Y " + (sw[0] & 0x3FF) + " · X " + (sw[1] & 0x3FF) +
                   " · pattern $" + hex3((sw[2] >> 1) & 0x3FF) +
                   " · palette " + (sw[3] & 0xF) +
                   ((sw[3] >> 7) & 1 ? " · in front (SPBG)" : " · behind (SPBG 0)");
    } else {
      out.text = "free · " + wordName(word);
      out.detail = wordName(word) + " is not part of the BAT, a tile, a " +
                   "sprite pattern or the SAT; it holds $" + hex4(w);
    }
    return out;
  }

  function hex3(v) { return v.toString(16).toUpperCase().padStart(3, "0"); }
  function hex4(v) { return v.toString(16).toUpperCase().padStart(4, "0"); }

  return {
    WORDS: WORDS, CHAR_WORDS: CHAR_WORDS, CHARS: CHARS,
    PAGE_CHARS: PAGE_CHARS, PAGES: PAGES, PAGE_COLS: PAGE_COLS,
    PAGE_ROWS: PAGE_ROWS, CELL: CELL, SAT_WORDS: SAT_WORDS,
    LABELS: LABELS, KIND_ORDER: KIND_ORDER,
    charPixel: charPixel, charPixels: charPixels,
    pageOfChar: pageOfChar, pageRange: pageRange,
    charOfWord: charOfWord, charName: charName, wordName: wordName,
    baseKind: baseKind, regionOf: regionOf, kindOf: kindOf,
    regions: regions, jumps: jumps, spriteWords: spriteWords,
    describe: describe
  };
});
