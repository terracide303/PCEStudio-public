/*
 * pce-palettes.js — the PALETTES panel as a visual editor (card #85, part B).
 *
 * The working example is ppu.toys' CGRAM panel, read from its served bundle
 * ($TMPDIR/pcestudio-design-75/app.js, the `cgram-panel` component): a grid
 * of address rows and 16 swatches per row, each swatch a button that opens an
 * editor for that one entry, with the entry's own address (`cgram[0xNN]`) and
 * value shown while it is edited.  The SNES has 256 palette entries of 15-bit
 * BGR; the HuC6260 VCE has 512 entries of 9 bits — G in bits 6-8, R in 3-5,
 * B in 0-2 (docs/RENDERER.md; pce-editor.js's colourWord/colourChannels).  So
 * ours is the same shape one size up: 32 palettes of 16, and a picker that
 * offers exactly the 512 colours the chip can show, not an RGB wheel that can
 * name colours the VCE would have to round.
 *
 * This file is the panel's model and nothing drawn: the selection, the VCE
 * colour arithmetic, and the edits, which go through renderer/pce-editor.js's
 * own calls (setPaletteColour, setSpritePaletteColour, setBackdrop) so the
 * refusals and the one shared backdrop stay that module's.  What is edited is
 * the toy's palettes.json (the #77 envelope, the same file SCREEN edits);
 * renderer/studio-panel-palettes.js is the panel that draws it.
 *
 * The palette layout is the hardware's: palettes 0-15 are the BAT's 4-bit
 * palette field, palettes 16-31 are the 16 sprite palettes (CRAM $100-$1FF).
 * Entry 0 of every background palette is the shared backdrop (CRAM $000) —
 * one colour for all 16 — so selecting any of those entries edits the
 * backdrop, and the panel says so.
 *
 * Dual use: CommonJS module in Node (tests/check-studio.js) and a browser
 * global (renderer/studio.html), like pce-screen.js and pce-editor.js.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./pce-editor.js"),
                             require("./pce-screen.js"));
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.palettes = factory(root.PCEStudio.editor,
                                      root.PCEStudio.screen);
  }
})(typeof self !== "undefined" ? self : this, function (ed, sc) {
  "use strict";

  var PALETTES = 32;          /* 16 background (0-15) + 16 sprite (16-31) */
  var ENTRIES = 16;           /* a palette has 16 colours */
  var COLOURS = 512;          /* the VCE's 9-bit table: 8 G x 8 R x 8 B */
  var LEVELS = 8;             /* three bits per channel */
  var BACKGROUND = 16;        /* palettes 0-15 */
  var FIRST_SPRITE = 16;      /* palettes 16-31 */

  function fail(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  function isInt(v) { return typeof v === "number" && v === Math.floor(v); }

  function checkPalette(palette) {
    if (!isInt(palette) || palette < 0 || palette >= PALETTES)
      throw fail("palette-range", "the VCE has " + PALETTES + " palettes: " +
                 "0-15 are the BAT's background palettes and 16-31 the " +
                 "sprite palettes; " + palette + " is not one of them");
    return palette;
  }

  function checkEntry(entry) {
    if (!isInt(entry) || entry < 0 || entry >= ENTRIES)
      throw fail("entry-range", "a palette has " + ENTRIES + " colours " +
                 "(CRAM entries 0-15); " + entry + " is not one of them");
    return entry;
  }

  function checkColour(colour) {
    if (!isInt(colour) || colour < 0 || colour >= COLOURS)
      throw fail("colour-range", "a VCE colour is a 9-bit code 0..511, got " +
                 colour);
    return colour;
  }

  /* ---- the VCE's colour arithmetic ------------------------------------- *
   * The same three helpers pce-editor.js uses, so the panel and the editor
   * cannot disagree about a word.  The 3-bit channels scale by 36 to 0..252,
   * the renderer's own VCE decode. */
  function channels(colour) { checkColour(colour); return ed.colourChannels(colour); }

  function word(r, g, b) {
    if (!isInt(r) || !isInt(g) || !isInt(b) ||
        r < 0 || r >= LEVELS || g < 0 || g >= LEVELS || b < 0 || b >= LEVELS)
      throw fail("channel-range", "a VCE channel is 3 bits (0..7); got " +
                 r + "," + g + "," + b);
    return ed.colourWord(r, g, b);
  }

  function rgb(colour) {
    var c = channels(colour);
    return { r: c.r * 36, g: c.g * 36, b: c.b * 36 };
  }

  function css(colour) {
    var c = rgb(colour);
    return "rgb(" + c.r + "," + c.g + "," + c.b + ")";
  }

  /* The 512 colours the VCE can show, in the order the picker draws them:
   * one plane per blue level (B = 0..7); inside a plane red runs across and
   * green down.  `index` is the colour's position in that order, and
   * `word` the 9-bit code it edits. */
  function picker() {
    var out = [];
    for (var b = 0; b < LEVELS; b++) {
      for (var g = 0; g < LEVELS; g++) {
        for (var r = 0; r < LEVELS; r++) {
          var w = word(r, g, b);
          out.push({ index: b * 64 + g * 8 + r, word: w,
                     r: r, g: g, b: b, plane: b, css: css(w),
                     title: "G" + g + " R" + r + " B" + b +
                            " · word $" + hex3(w) + " · rgb" + css(w).slice(3) });
        }
      }
    }
    return out;
  }

  /* ---- the selection ---------------------------------------------------- */

  /* Which of the 512 entries the panel is editing.  The table is always all
   * 32 palettes; the selection only says where the picker's click lands. */
  function session() {
    return { palette: 0, entry: 1 };
  }

  function kindOf(palette) {
    checkPalette(palette);
    return palette < FIRST_SPRITE ? "background" : "sprite";
  }

  function selectEntry(sess, palette, entry) {
    checkPalette(palette);
    checkEntry(entry);
    sess.palette = palette;
    sess.entry = entry;
    return { palette: palette, entry: entry, kind: kindOf(palette),
             backdrop: palette < FIRST_SPRITE && entry === 0 };
  }

  /* ---- reading and writing the picture --------------------------------- */

  /* The 9-bit word one entry shows.  Entry 0 of a background palette is the
   * shared backdrop (CRAM $000), so all 16 rows answer with pic.backdrop. */
  function entryWord(pic, palette, entry) {
    checkPalette(palette);
    checkEntry(entry);
    if (palette < FIRST_SPRITE)
      return entry === 0 ? pic.backdrop : pic.palettes[palette][entry];
    return pic.spritePalettes[palette - FIRST_SPRITE][entry];
  }

  /* One entry set to one 9-bit word.  The store is pce-editor.js's:
   * setBackdrop for a background palette's entry 0 (there is one backdrop,
   * not 16 copies), setPaletteColour for the rest of a background palette,
   * setSpritePaletteColour for a sprite palette. */
  function setEntry(pic, palette, entry, colour) {
    checkPalette(palette);
    checkEntry(entry);
    checkColour(colour);
    if (palette < FIRST_SPRITE) {
      if (entry === 0) ed.setBackdrop(pic, colour);
      else ed.setPaletteColour(pic, palette, entry, colour);
    } else {
      ed.setSpritePaletteColour(pic, palette - FIRST_SPRITE, entry, colour);
    }
    return entryWord(pic, palette, entry);
  }

  /* All 32 palettes of 16 words, as the panel's grid reads them. */
  function table(pic) {
    var out = [];
    for (var p = 0; p < PALETTES; p++) {
      var row = [];
      for (var e = 0; e < ENTRIES; e++) row.push(entryWord(pic, p, e));
      out.push(row);
    }
    return out;
  }

  /* The swatch's tooltip: where the entry lives and what it holds, in the
   * shape ppu.toys' CGRAM tooltip uses ("cgram[0xNN]"). */
  function title(palette, entry, colour) {
    checkPalette(palette);
    checkEntry(entry);
    checkColour(colour);
    var c = channels(colour);
    var where = palette < FIRST_SPRITE
      ? "background palette " + palette +
        (entry === 0 ? " entry 0 — the shared backdrop" : " entry " + entry)
      : "sprite palette " + (palette - FIRST_SPRITE) + " entry " + entry;
    return where + " · CRAM $" + hex3(palette * ENTRIES + entry) +
      " · word $" + hex3(colour) + " · G" + c.g + " R" + c.r + " B" + c.b;
  }

  function hex3(v) { return v.toString(16).toUpperCase().padStart(3, "0"); }

  /* ---- the file --------------------------------------------------------- *
   * palettes.json and nothing else: the shape is pce-screen.js's
   * palettesText (the one writer of that file, which SCREEN and the SPRITES
   * panel use too), and this writer must not touch tiles.json — that file
   * belongs to the SCREEN panel (the same rule pce-sat.js follows). */
  function palettesText(pic) {
    if (!sc || typeof sc.palettesText !== "function")
      throw fail("no-writer", "renderer/pce-screen.js is not loaded, so " +
                 "there is no palettes.json writer");
    return sc.palettesText(pic);
  }

  function syncFiles(pic, files) {
    var changed = [];
    var text = palettesText(pic);
    for (var i = 0; i < (files || []).length; i++) {
      var f = files[i];
      if (f.name !== "palettes.json") continue;
      if (f.source !== text) { f.source = text; changed.push(f.name); }
    }
    return changed;
  }

  /* True when the file's table is still all black: the honest note the panel
   * shows, because the import is one way (palettes.json -> CRAM, #117) and a
   * toy writing its own pal() never writes the file back. */
  function isBlank(pic) {
    if (pic.backdrop !== 0) return false;
    for (var p = 0; p < PALETTES; p++)
      for (var e = 0; e < ENTRIES; e++)
        if (entryWord(pic, p, e) !== 0) return false;
    return true;
  }

  return {
    PALETTES: PALETTES, ENTRIES: ENTRIES, COLOURS: COLOURS,
    LEVELS: LEVELS, FIRST_SPRITE: FIRST_SPRITE, BACKGROUND: BACKGROUND,
    channels: channels, word: word, rgb: rgb, css: css, picker: picker,
    session: session, kindOf: kindOf, selectEntry: selectEntry,
    entryWord: entryWord, setEntry: setEntry, table: table,
    title: title, isBlank: isBlank,
    palettesText: palettesText, syncFiles: syncFiles,
    checkPalette: checkPalette, checkEntry: checkEntry, checkColour: checkColour
  };
});
