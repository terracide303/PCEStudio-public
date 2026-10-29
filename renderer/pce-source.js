/*
 * pce-source.js — the Add Source importer (card #123).
 *
 * ppu.toys' ASSETS tab takes a dropped file and makes it a thing the SNES can
 * draw or play.  The PC Engine's answer keeps the dialog's shape and changes
 * every option to what the hardware can actually do:
 *
 *   kind      BG (tilemap: a 32x32 BAT + 8x8 tiles), Sprites (patterns,
 *             16x16..32x64), Tilesheet (tiles and palettes, no map), Palette
 *             only, Sample (DDA audio), Song (.mid).  Mode 7 is left out --
 *             the PC Engine has no rotation/scaling -- rather than shown and
 *             refused; the 4-colour VDC mode is idea #47.
 *   bit depth one fixed line, "4bpp · 16 colours (the PC Engine always uses
 *             16 per tile)".  There is no dropdown: the VDC's 16-colour mode
 *             is what every tile is.
 *   palettes  at most 16 for the background and 16 for sprites, each colour
 *             snapped to the VCE's 512 (3 bits per G/R/B).  A tile picks ONE
 *             palette -- that is the hardware's rule, not a compression
 *             choice -- and entry 0 of every background palette is the
 *             backdrop (CRAM $000), so a tile has 15 free colours.
 *   dither    none (flat nearest colour), ordered (8x8 Bayer), diffusion
 *             (Floyd-Steinberg).  The error is measured in the VCE's 3-bit
 *             space and never crosses a tile edge: the neighbouring tile may
 *             carry a different palette, so an error pushed into it could not
 *             be shown.
 *   alpha     a pixel below the threshold becomes colour 0 -- the backdrop in
 *             a background tile, transparent in a sprite pattern.
 *
 * The picture this produces is the picture the SCREEN / SPRITES / PALETTES
 * panels edit: importImage() returns the three files' documents (the same
 * shapes pce-screen.js's pictureFromFiles and pce-sat.js read), so Add Source
 * writes files and the panels open them.  There is no second art model.
 *
 * Audio: a WAV becomes a DDA sample -- 5 bits per sample, the rate you choose,
 * one R6 write per sample with R4 bit 6 set -- and the preview is rendered
 * through renderer/pce-psg.js, the Mednafen-matched model (#34), so a sample
 * cannot "sound right" here and wrong in a toy.  A .mid becomes a sequencer
 * song (#94): parse the Standard MIDI File, map its channels onto the PSG's
 * six voices, and hand the notes to renderer/pce-seq.js, which owns the song
 * document and its instruments.
 *
 * Dual use: CommonJS in Node (tests/check-source-import.js) and a browser
 * global (renderer/studio.html) via the same UMD wrapper as pce-assets.js.
 * The PNG's zlib stream is inflated by the caller: Node passes
 * zlib.inflateSync, the browser its DecompressionStream (async), so this file
 * stays synchronous and dependency-free apart from the two models.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./pce-psg.js"), require("./pce-seq.js"));
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.source = factory(root.PCEStudio.psg, root.PCEStudio.seq);
  }
})(typeof self !== "undefined" ? self : this, function (psg, seq) {
  "use strict";

  /* ---- the hardware's numbers ------------------------------------------- */
  var TILE = 8;                  /* a VDC character is 8x8 (VDC manual) */
  var ENTRIES = 16;              /* 4bpp: colour numbers 0..15 */
  var BG_PALETTES = 16;          /* BAT bits 12-15 */
  var SPRITE_PALETTES = 16;      /* CRAM $100-$1FF */
  var TILE_COLOURS = 15;         /* entry 0 is the backdrop / transparency */
  var BAT_W = 32;                /* MWR $00: 32x32 cells */
  var BAT_H = 32;
  var BAT_CELLS = BAT_W * BAT_H;
  var FIRST_CHAR = 0x40;         /* after the BAT, as pce-editor.js has it */
  var MAX_TILES = 1536;          /* pce-editor.js: 48 KiB of tile banks */
  var VRAM_WORDS = 32768;
  var VCE_COLOURS = 512;
  /* The six sizes the VDC draws, and the VRAM cells each reserves: one cell
   * is 64 words, and pce-editor.js packs patterns after the tiles at the
   * alignment their CGX/CGY mask demands.  Kept here so the importer can say
   * "this will not fit" before the panels refuse it. */
  var SPRITE_SIZES = [[16, 16], [32, 16], [16, 32], [32, 32], [16, 64], [32, 64]];
  var SPRITE_CELLS = { "16x16": [1, 1], "32x16": [2, 2], "16x32": [4, 4],
                       "32x32": [4, 4], "16x64": [8, 8], "32x64": [8, 8] };
  var SAT_CELL = 0x7F00 / 64;    /* the SAT's four cells at VRAM $7F00 */
  var FRAME_CLOCKS = 119318;     /* 7.15909 MHz / 60; pce-validate.js */
  var SAMPLE_MAX = 0x1F;         /* a DDA sample is 5 bits (R6 bits 0-4) */
  var DDA_RATES = [3000, 4000, 6000, 8000, 12000];
  var DITHERS = ["none", "ordered", "diffusion"];
  var KINDS = ["bg", "sprites", "tilesheet", "palette", "sample", "song"];

  function refuse(code, message) {
    var e = new Error(message);
    e.code = code;
    throw e;
  }
  function isInt(v) { return typeof v === "number" && isFinite(v) && v % 1 === 0; }

  /* ---- the VCE's 512 colours --------------------------------------------
   * A word is GGR RRBBB: bits 6-8 green, 3-5 red, 0-2 blue (pce-bg.js
   * cramEntry decodes exactly this, and pce-editor.js colourWord builds it).
   * Each channel is 3 bits and the VCE shows level n as n*36, so the snap is
   * round(v * 7 / 255) -- the nearest level, not a truncation that would
   * darken every picture by half a step. */
  function snap(v) { return Math.max(0, Math.min(7, Math.round(v * 7 / 255))); }
  function vce(r, g, b) { return (snap(g) << 6) | (snap(r) << 3) | snap(b); }
  function channels(word) {
    return { r: (word >> 3) & 7, g: (word >> 6) & 7, b: word & 7 };
  }
  function rgbOf(word) {
    var c = channels(word);
    return [c.r * 36, c.g * 36, c.b * 36];
  }
  function dist(a, b) {
    var ca = channels(a), cb = channels(b);
    var dr = ca.r - cb.r, dg = ca.g - cb.g, db = ca.b - cb.b;
    return dr * dr + dg * dg + db * db;
  }
  function nearest(word, list) {
    var best = 0, bestD = Infinity;
    for (var i = 0; i < list.length; i++) {
      var d = dist(word, list[i]);
      if (d < bestD) { bestD = d; best = i; if (!d) break; }
    }
    return { index: best, distance: bestD };
  }

  /* ---- PNG ---------------------------------------------------------------
   * Only the parts a dropped picture needs: 8-bit grey/RGB/RGBA/palette, the
   * five filter types, tRNS.  16-bit and interlaced files are refused by code
   * rather than decoded wrongly -- an importer that quietly halves a 16-bit
   * channel would change the picture and say nothing. */
  function be32(b, o) { return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]; }
  function be16(b, o) { return (b[o] << 8) + b[o + 1]; }
  function latin(b, o, n) {
    var s = "";
    for (var i = 0; i < n; i++) s += String.fromCharCode(b[o + i]);
    return s;
  }

  /* The chunks a decoder needs, without inflating anything. */
  function pngInfo(bytes) {
    var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (latin(b, 0, 8) !== "\x89PNG\r\n\x1a\n") refuse("png-signature", "not a PNG");
    var pos = 8, info = null, idat = [], palette = null, trns = null;
    while (pos + 8 <= b.length) {
      var len = be32(b, pos);
      var type = latin(b, pos + 4, 4);
      var data = b.subarray(pos + 8, pos + 8 + len);
      pos += 12 + len;
      if (type === "IHDR") {
        info = { width: be32(data, 0), height: be32(data, 4),
                 bitDepth: data[8], colourType: data[9],
                 interlace: data[12] };
      } else if (type === "PLTE") palette = data;
      else if (type === "tRNS") trns = data;
      else if (type === "IDAT") idat.push(data);
      else if (type === "IEND") break;
    }
    if (!info) refuse("png-header", "the PNG has no IHDR");
    if (info.interlace) refuse("png-interlace", "an interlaced PNG is not supported");
    if (info.bitDepth !== 8)
      refuse("png-depth", "a " + info.bitDepth + "-bit PNG is not supported " +
             "(8-bit grey, RGB, RGBA or palette)");
    if ([0, 2, 3, 6].indexOf(info.colourType) < 0)
      refuse("png-type", "PNG colour type " + info.colourType + " is not supported");
    var all = new Uint8Array(idat.reduce(function (n, c) { return n + c.length; }, 0));
    var at = 0;
    for (var i = 0; i < idat.length; i++) { all.set(idat[i], at); at += idat[i].length; }
    return { width: info.width, height: info.height, colourType: info.colourType,
             palette: palette, trns: trns, idat: all };
  }

  /* The filtered scanlines to RGBA. */
  function pngPixels(info, raw) {
    var w = info.width, h = info.height, type = info.colourType;
    var chans = { 0: 1, 2: 3, 3: 1, 6: 4 }[type];
    var stride = w * chans;
    if (raw.length < h * (stride + 1))
      refuse("png-data", "the PNG's image data is short");
    var out = new Uint8Array(w * h * 4);
    var prev = new Uint8Array(stride);
    var line = new Uint8Array(stride);
    var p = 0;
    for (var y = 0; y < h; y++) {
      var f = raw[p++];
      line.set(raw.subarray(p, p + stride));
      p += stride;
      for (var i = 0; i < stride; i++) {
        var a = i >= chans ? line[i - chans] : 0;
        var bb = prev[i];
        var c = i >= chans ? prev[i - chans] : 0;
        if (f === 1) line[i] = (line[i] + a) & 0xFF;
        else if (f === 2) line[i] = (line[i] + bb) & 0xFF;
        else if (f === 3) line[i] = (line[i] + ((a + bb) >> 1)) & 0xFF;
        else if (f === 4) {
          var pa = Math.abs(a + bb - c - a), pb = Math.abs(a + bb - c - bb),
              pc = Math.abs(a + bb - c - c);
          line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? bb : c)) & 0xFF;
        }
      }
      for (var x = 0; x < w; x++) {
        var o = (y * w + x) * 4;
        if (type === 0) {
          out[o] = out[o + 1] = out[o + 2] = line[x];
          out[o + 3] = info.trns && line[x] === info.trns[1] ? 0 : 255;
        } else if (type === 2) {
          out[o] = line[x * 3]; out[o + 1] = line[x * 3 + 1];
          out[o + 2] = line[x * 3 + 2]; out[o + 3] = 255;
        } else if (type === 6) {
          out[o] = line[x * 4]; out[o + 1] = line[x * 4 + 1];
          out[o + 2] = line[x * 4 + 2]; out[o + 3] = line[x * 4 + 3];
        } else {
          var idx = line[x];
          var pal = info.palette;
          if (!pal || idx * 3 + 2 >= pal.length)
            refuse("png-palette", "the PNG's palette has no entry " + idx);
          out[o] = pal[idx * 3]; out[o + 1] = pal[idx * 3 + 1];
          out[o + 2] = pal[idx * 3 + 2];
          out[o + 3] = info.trns && idx < info.trns.length ? info.trns[idx] : 255;
        }
      }
      var t = prev; prev = line; line = t;
    }
    return { width: w, height: h, rgba: out };
  }

  /* The convenience path: whoever calls this supplies the inflate. */
  function decodePng(bytes, inflate) {
    var info = pngInfo(bytes);
    if (typeof inflate !== "function")
      refuse("png-inflate", "decodePng needs an inflate function " +
             "(zlib.inflateSync in Node, DecompressionStream in a page)");
    return pngPixels(info, inflate(info.idat));
  }

  function pixelAt(img, x, y) {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return null;
    var o = (y * img.width + x) * 4;
    return [img.rgba[o], img.rgba[o + 1], img.rgba[o + 2], img.rgba[o + 3]];
  }

  /* ---- the 8x8 Bayer matrix --------------------------------------------
   * The standard recursive construction, 0..63, so "ordered" is the same
   * ordered dither every other tool means by it. */
  var BAYER8 = (function () {
    var m = [[0]], n, s, r, c;
    for (s = 1; s < 8; s *= 2) {
      var next = [];
      for (r = 0; r < s * 2; r++) next.push(new Array(s * 2));
      for (r = 0; r < s; r++) for (c = 0; c < s; c++) {
        var v = m[r][c] * 4;
        next[r][c] = v;
        next[r][c + s] = v + 2;
        next[r + s][c] = v + 3;
        next[r + s][c + s] = v + 1;
      }
      m = next;
    }
    return m;
  })();

  /* ---- palettes ---------------------------------------------------------
   * A tile may only show colours from ONE palette, so the importer cannot
   * pick 16 colours for the whole picture the way a PNG quantiser would: it
   * groups tiles whose colours fit together.  The grouping is greedy in tile
   * order, three steps each:
   *   1. a palette that already holds every colour the tile needs;
   *   2. else a palette the tile's colours can join without passing 15;
   *   3. else a new palette, while fewer than 16 exist.
   * Past 16 the tile takes the palette with the least error and the result
   * carries a warning -- the picture is still drawable, it is just not exact.
   */
  function uniqueWords(set) {
    var seen = {}, out = [];
    for (var i = 0; i < set.length; i++)
      if (!seen[set[i]]) { seen[set[i]] = true; out.push(set[i]); }
    return out;
  }

  function topWords(counts, limit) {
    var list = [];
    for (var k in counts) list.push({ word: Number(k), n: counts[k] });
    list.sort(function (a, b) { return b.n - a.n || a.word - b.word; });
    var out = [];
    for (var i = 0; i < list.length && i < limit; i++) out.push(list[i].word);
    return out;
  }

  function palettePlan(sets, maxPalettes, capacity) {
    var palettes = [];          /* arrays of words, entry 0 not included */
    var assign = new Array(sets.length);
    var overflow = 0;
    for (var i = 0; i < sets.length; i++) {
      /* a tile that needs more than the hardware can hold keeps its most
       * frequent colours; the rest are dithered onto them */
      var need = sets[i].length > capacity
        ? topWords(sets[i].counts, capacity) : sets[i].words;
      var pick = -1, p, j;
      for (p = 0; p < palettes.length; p++) {
        var holds = true;
        for (j = 0; j < need.length; j++)
          if (palettes[p].indexOf(need[j]) < 0) { holds = false; break; }
        if (holds) { pick = p; break; }
      }
      if (pick < 0) {
        var bestP = -1, bestGrow = Infinity;
        for (p = 0; p < palettes.length; p++) {
          var grow = 0, fits = true;
          for (j = 0; j < need.length; j++)
            if (palettes[p].indexOf(need[j]) < 0) grow++;
          if (palettes[p].length + grow > capacity) fits = false;
          if (fits && grow < bestGrow) { bestGrow = grow; bestP = p; }
        }
        if (bestP >= 0) {
          for (j = 0; j < need.length; j++)
            if (palettes[bestP].indexOf(need[j]) < 0) palettes[bestP].push(need[j]);
          pick = bestP;
        }
      }
      if (pick < 0 && palettes.length < maxPalettes) {
        palettes.push(need.slice());
        pick = palettes.length - 1;
      }
      if (pick < 0) {
        /* no room: the palette whose 15 colours are nearest to this tile's */
        var bestD = Infinity;
        for (p = 0; p < palettes.length; p++) {
          var sum = 0;
          for (j = 0; j < need.length; j++) sum += nearest(need[j], palettes[p]).distance;
          if (sum < bestD) { bestD = sum; pick = p; }
        }
        overflow++;
      }
      assign[i] = pick;
    }
    /* A tile freed a palette's colours for a later tile but the palette kept
     * words nobody uses any more.  Rebuild each palette from the tiles that
     * actually chose it, so the 15 entries are the ones drawn. */
    var counts = [];
    for (var q = 0; q < palettes.length; q++) counts.push({});
    for (i = 0; i < sets.length; i++) {
      var words = sets[i].counts;
      for (var w in words) {
        var at = counts[assign[i]];
        at[w] = (at[w] || 0) + words[w];
      }
    }
    for (q = 0; q < palettes.length; q++) {
      var rebuilt = topWords(counts[q], capacity);
      palettes[q] = rebuilt.length ? rebuilt : palettes[q];
    }
    return { palettes: palettes, assign: assign, overflow: overflow };
  }

  /* One tile's colour numbers: each pixel's snapped colour onto its palette,
   * with the chosen dither.  Index 0 is the backdrop (BG) or transparency
   * (sprites) and is never used for an opaque pixel. */
  function tileIndices(pixels, palette, opts, ox, oy) {
    var out = new Array(TILE * TILE);
    var mask = pixels.alpha;
    var dither = opts.dither;
    var err = null;
    if (dither === "diffusion") {
      err = [];
      for (var i = 0; i < TILE * TILE; i++) err.push([0, 0, 0]);
    }
    for (var y = 0; y < TILE; y++) {
      for (var x = 0; x < TILE; x++) {
        var p = pixels.at(x, y);
        var o = y * TILE + x;
        if (!p || p[3] < mask) { out[o] = 0; continue; }
        var c = p === null ? null : channels(vce(p[0], p[1], p[2]));
        var fr = c.r, fg = c.g, fb = c.b;
        if (dither === "ordered") {
          var t = (BAYER8[(oy + y) & 7][(ox + x) & 7] + 0.5) / 64 - 0.5;
          fr += t; fg += t; fb += t;
        } else if (dither === "diffusion") {
          fr += err[o][0]; fg += err[o][1]; fb += err[o][2];
        }
        var pick = nearestFloat(fr, fg, fb, palette);
        out[o] = pick.index + 1;
        if (dither === "diffusion") {
          var got = channels(palette[pick.index]);
          var dr = fr - got.r, dg = fg - got.g, db = fb - got.b;
          spread(err, x, y, dr, dg, db);
        }
      }
    }
    return out;
  }

  function nearestFloat(r, g, b, palette) {
    var best = 0, bestD = Infinity;
    for (var i = 0; i < palette.length; i++) {
      var c = channels(palette[i]);
      var dr = r - c.r, dg = g - c.g, db = b - c.b;
      var d = dr * dr + dg * dg + db * db;
      if (d < bestD) { bestD = d; best = i; }
    }
    return { index: best, distance: bestD };
  }

  /* Floyd-Steinberg, clipped to the tile: a colour pushed into the next tile
   * could only be shown if that tile's palette held it, and the panels' rule
   * is one palette per tile. */
  function spread(err, x, y, dr, dg, db) {
    function put(px, py, w) {
      if (px < 0 || py < 0 || px >= TILE || py >= TILE) return;
      var e = err[py * TILE + px];
      e[0] += dr * w; e[1] += dg * w; e[2] += db * w;
    }
    put(x + 1, y, 7 / 16);
    put(x - 1, y + 1, 3 / 16);
    put(x, y + 1, 5 / 16);
    put(x + 1, y + 1, 1 / 16);
  }

  /* A view of one 8x8 cell of the source, padded with transparent pixels
   * where the cell runs past the picture (alpha alone is not enough: a
   * padding pixel must not sample a neighbour). */
  function cellView(img, cx, cy, threshold) {
    return {
      alpha: threshold,
      at: function (x, y) {
        var p = pixelAt(img, cx * TILE + x, cy * TILE + y);
        return p || [0, 0, 0, 0];
      }
    };
  }

  /* The colours a cell uses, for the palette planner: word -> count. */
  function cellCounts(img, cx, cy, threshold) {
    var counts = {}, words = [];
    for (var y = 0; y < TILE; y++) for (var x = 0; x < TILE; x++) {
      var p = pixelAt(img, cx * TILE + x, cy * TILE + y);
      if (!p || p[3] < threshold) continue;
      var w = vce(p[0], p[1], p[2]);
      if (counts[w] === undefined) { counts[w] = 0; words.push(w); }
      counts[w]++;
    }
    return { words: words, counts: counts };
  }

  /* The picture's most common opaque colour: the backdrop, so transparency
   * and the dominant colour share CRAM $000 and cost nothing. */
  function commonColour(img, threshold) {
    var counts = {}, best = 0, bestN = -1;
    for (var y = 0; y < img.height; y++) for (var x = 0; x < img.width; x++) {
      var p = pixelAt(img, x, y);
      if (!p || p[3] < threshold) continue;
      var w = vce(p[0], p[1], p[2]);
      counts[w] = (counts[w] || 0) + 1;
      if (counts[w] > bestN) { bestN = counts[w]; best = w; }
    }
    return bestN < 0 ? 0 : best;
  }

  /* ---- images ------------------------------------------------------------ */

  function importImage(img, opts) {
    opts = opts || {};
    var kind = opts.kind || "bg";
    if (KINDS.indexOf(kind) < 0) refuse("source-kind", "unknown kind " + kind);
    if (kind === "sample" || kind === "song")
      refuse("source-kind", kind + " is not an image");
    var threshold = opts.alphaThreshold === undefined ? 128 : opts.alphaThreshold;
    if (!isInt(threshold) || threshold < 0 || threshold > 255)
      refuse("source-alpha", "the alpha threshold is 0..255");
    var dither = opts.dither || "none";
    if (DITHERS.indexOf(dither) < 0)
      refuse("source-dither", "dither is " + DITHERS.join(" / "));
    var warnings = [];

    if (kind === "palette") return importPaletteOnly(img, opts, threshold);
    if (kind === "sprites") return importSprites(img, opts, threshold, dither, warnings);

    /* BG and Tilesheet: 8x8 cells over a 32x32 BAT. */
    var cols = Math.ceil(img.width / TILE), rows = Math.ceil(img.height / TILE);
    if (cols > BAT_W || rows > BAT_H) {
      var cw = Math.min(cols, BAT_W), ch = Math.min(rows, BAT_H);
      warnings.push("the picture is " + cols + "x" + rows + " cells; the BAT " +
                    "holds " + BAT_W + "x" + BAT_H + ", so only its top-left " +
                    cw + "x" + ch + " cells are imported");
      cols = cw; rows = ch;
    }
    if (rows * TILE > 240)
      warnings.push("the picture is " + (rows * TILE) + " lines tall and the " +
                    "display shows 240; the bottom lines are off-screen " +
                    "until the map scrolls");

    var backdrop = commonColour(img, threshold);
    var maxPal = opts.maxPalettes === undefined ? BG_PALETTES : opts.maxPalettes;
    maxPal = Math.max(1, Math.min(BG_PALETTES, maxPal));

    var sets = [], cells = [];
    for (var cy = 0; cy < rows; cy++) for (var cx = 0; cx < cols; cx++) {
      var counts = cellCounts(img, cx, cy, threshold);
      var words = counts.words.filter(function (w) { return w !== backdrop; });
      sets.push({ words: words, counts: counts.counts });
      cells.push({ cx: cx, cy: cy });
    }
    var plan = palettePlan(sets, maxPal, TILE_COLOURS);
    if (plan.overflow)
      warnings.push(plan.overflow + " tile(s) could not share one of the " +
                    maxPal + " palettes: they use the nearest palette and " +
                    "their colours are approximated");

    /* palette documents: entry 0 is the shared backdrop */
    var palettes = [];
    for (var p = 0; p < plan.palettes.length; p++) {
      var row = new Array(ENTRIES);
      row[0] = backdrop;
      for (var e = 1; e < ENTRIES; e++)
        row[e] = plan.palettes[p][e - 1] === undefined ? backdrop
                                                     : plan.palettes[p][e - 1];
      palettes.push(row);
    }

    /* tiles: the first is the blank one the empty BAT cells show */
    var tiles = [{ char: FIRST_CHAR, palette: 0,
                   pixels: new Array(TILE * TILE).fill(0) }];
    var seen = {};
    seen[new Array(TILE * TILE).fill(0).join(",")] = FIRST_CHAR;
    var map = new Array(BAT_CELLS).fill(FIRST_CHAR);
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      var pal = plan.palettes[plan.assign[i]] || [];
      var idx = tileIndices(cellView(img, cell.cx, cell.cy, threshold), pal,
                            { dither: dither }, cell.cx * TILE, cell.cy * TILE);
      var key = idx.join(",");
      var char;
      if (seen[key] !== undefined) char = seen[key];
      else {
        if (tiles.length >= MAX_TILES)
          refuse("source-tiles", "the picture needs more than " + MAX_TILES +
                 " distinct tiles, the ROM layout's budget");
        char = FIRST_CHAR + tiles.length;
        tiles.push({ char: char, palette: plan.assign[i], pixels: idx });
        seen[key] = char;
      }
      map[cell.cy * BAT_W + cell.cx] = char;
    }

    /* VRAM: the tiles start at character $40 and every character is 16
     * words; the SAT sits at $7F00, so a picture that walked past it could
     * not be shown. */
    var tileEnd = (FIRST_CHAR + tiles.length) * 16;
    if (tileEnd > 0x7F00)
      warnings.push("the tiles reach VRAM word $" + tileEnd.toString(16) +
                    ", past the SAT at $7F00 — the picture does not fit");

    var tileColours = tiles.map(function (t) {
      var u = uniqueWords(t.pixels);
      return u.length;
    });
    var colours = {};
    for (p = 0; p < palettes.length; p++)
      for (e = 1; e < ENTRIES; e++) colours[palettes[p][e]] = true;

    var result = {
      kind: kind, name: opts.name || "source",
      width: img.width, height: img.height,
      cols: cols, rows: rows,
      backdrop: backdrop,
      palettes: palettes,
      tiles: tiles,
      map: kind === "bg" ? map : null,
      patterns: null,
      warnings: warnings,
      stats: {
        tiles: tiles.length, maxTiles: MAX_TILES,
        palettes: palettes.length, maxPalettes: maxPal,
        colours: Object.keys(colours).length,
        maxTileColours: Math.max.apply(null, tileColours),
        dither: dither
      }
    };
    result.preview = previewOfImage(result);
    result.files = filesOfImage(result);
    return result;
  }

  /* A one-tile-per-source-pixel palette: median cut over the picture's
   * colours, 16 entries, no map and no tiles. */
  function importPaletteOnly(img, opts, threshold) {
    var counts = {}, list = [];
    for (var y = 0; y < img.height; y++) for (var x = 0; x < img.width; x++) {
      var p = pixelAt(img, x, y);
      if (!p || p[3] < threshold) continue;
      var w = vce(p[0], p[1], p[2]);
      if (counts[w] === undefined) { counts[w] = 0; list.push(w); }
      counts[w]++;
    }
    if (!list.length) refuse("source-empty", "the picture has no opaque pixels");
    list.sort(function (a, b) { return counts[b] - counts[a]; });
    var row = new Array(ENTRIES);
    row[0] = list[0];
    for (var e = 1; e < ENTRIES; e++) row[e] = list[e] === undefined ? list[0] : list[e];
    var palettes = [row];
    var result = {
      kind: "palette", name: opts.name || "palette",
      width: img.width, height: img.height,
      backdrop: row[0], palettes: palettes, tiles: null, map: null,
      patterns: null, warnings: [],
      stats: { tiles: 0, palettes: 1, maxPalettes: BG_PALETTES,
               colours: uniqueWords(row).length, maxTileColours: 0,
               dither: "none" }
    };
    result.preview = previewOfPalette(result);
    result.files = filesOfImage(result);
    return result;
  }

  function importSprites(img, opts, threshold, dither, warnings) {
    var size = opts.size || [16, 16];
    var ok = false;
    for (var s = 0; s < SPRITE_SIZES.length; s++)
      if (SPRITE_SIZES[s][0] === size[0] && SPRITE_SIZES[s][1] === size[1]) ok = true;
    if (!ok) refuse("source-size", "a sprite pattern is 16x16, 32x16, 16x32, " +
                    "32x32, 16x64 or 32x64 (got " + size[0] + "x" + size[1] + ")");
    var pw = size[0], ph = size[1];
    var cols = Math.max(1, Math.floor(img.width / pw));
    var rows = Math.max(1, Math.floor(img.height / ph));
    if (cols * rows > 64)
      warnings.push(cols * rows + " patterns; the SAT holds 64 sprites, so " +
                    "only the first 64 are placed");
    var maxPal = opts.maxPalettes === undefined ? SPRITE_PALETTES : opts.maxPalettes;
    maxPal = Math.max(1, Math.min(SPRITE_PALETTES, maxPal));

    /* colour sets per pattern, from 8x8 sub-cells the same way */
    var sets = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var counts = {}, words = [];
      for (var y = 0; y < ph; y++) for (var x = 0; x < pw; x++) {
        var p = pixelAt(img, c * pw + x, r * ph + y);
        if (!p || p[3] < threshold) continue;
        var w = vce(p[0], p[1], p[2]);
        if (counts[w] === undefined) { counts[w] = 0; words.push(w); }
        counts[w]++;
      }
      sets.push({ words: words, counts: counts });
    }
    var plan = palettePlan(sets, maxPal, TILE_COLOURS);
    if (plan.overflow)
      warnings.push(plan.overflow + " pattern(s) use the nearest palette; " +
                    "their colours are approximated");

    var palettes = [];
    for (var q = 0; q < plan.palettes.length; q++) {
      var row = new Array(ENTRIES);
      row[0] = 0;
      for (var e = 1; e < ENTRIES; e++)
        row[e] = plan.palettes[q][e - 1] === undefined ? 0 : plan.palettes[q][e - 1];
      palettes.push(row);
    }

    var patterns = [], sprites = [];
    var index = 0;
    for (r = 0; r < rows; r++) for (c = 0; c < cols; c++, index++) {
      var pal = plan.palettes[plan.assign[index]] || [];
      var pixels = new Array(pw * ph);
      for (y = 0; y < ph; y++) for (x = 0; x < pw; x++) {
        var px = pixelAt(img, c * pw + x, r * ph + y);
        var o = y * pw + x;
        if (!px || px[3] < threshold) { pixels[o] = 0; continue; }
        var ch = channels(vce(px[0], px[1], px[2]));
        var fr = ch.r, fg = ch.g, fb = ch.b;
        if (dither === "ordered") {
          var t = (BAYER8[(r * ph + y) & 7][(c * pw + x) & 7] + 0.5) / 64 - 0.5;
          fr += t; fg += t; fb += t;
        }
        pixels[o] = nearestFloat(fr, fg, fb, pal).index + 1;
      }
      patterns.push({ width: pw, height: ph, pixels: pixels });
      if (sprites.length < 64)
        sprites.push({ x: 8 + c * (pw + 8), y: 8 + r * (ph + 8),
                       pattern: index, palette: plan.assign[index],
                       priority: 1, hflip: 0, vflip: 0 });
    }

    /* VRAM: the patterns are packed after the tiles at their alignment and
     * the SAT's four cells are the last thing in the 32768-word VRAM. */
    var cursor = Math.ceil(FIRST_CHAR / 4);
    for (var v = 0; v < patterns.length; v++) {
      var cell = SPRITE_CELLS[pw + "x" + ph] || [1, 1];
      cursor = Math.ceil(cursor / cell[1]) * cell[1] + cell[0];
    }
    if (cursor > SAT_CELL)
      warnings.push("the patterns end at VRAM cell " + cursor + ", past the " +
                    "SAT's cells at " + SAT_CELL + " — the picture does not fit");

    var result = {
      kind: "sprites", name: opts.name || "sprites",
      width: img.width, height: img.height,
      size: size, cols: cols, rows: rows,
      backdrop: 0, palettes: palettes, tiles: null, map: null,
      patterns: patterns, sprites: sprites,
      warnings: warnings,
      stats: {
        tiles: patterns.length, maxTiles: 64,
        palettes: palettes.length, maxPalettes: maxPal,
        colours: uniqueWords([].concat.apply([], palettes)).length,
        maxTileColours: Math.max.apply(null, patterns.map(function (pt) {
          return uniqueWords(pt.pixels).length;
        })),
        dither: dither
      }
    };
    result.preview = previewOfSprites(result);
    result.files = filesOfImage(result);
    return result;
  }

  /* ---- the preview --------------------------------------------------------
   * The picture the VDC would show, drawn from the importer's own pixels and
   * palettes -- and in the BG case it is the same arithmetic pce-bg.js does
   * with an empty scroll over a full 256x240 window, which is what the test
   * compares it with. */
  function previewOfImage(result) {
    var w = 256, h = 240;
    var px = new Uint8Array(w * h * 3);
    var tiles = {}, i;
    for (i = 0; i < result.tiles.length; i++) tiles[result.tiles[i].char] = result.tiles[i];
    var blank = tiles[FIRST_CHAR] || { palette: 0, pixels: [] };
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var cell = (y >> 3) * BAT_W + (x >> 3);
      var char = result.map ? result.map[cell] : FIRST_CHAR;
      var tile = tiles[char] || blank;
      var idx = tile.pixels ? tile.pixels[(y & 7) * TILE + (x & 7)] : 0;
      /* VCE word 0 is black -- a real colour -- so the entry is read by
       * index, never with `|| backdrop`: that would turn every black pixel
       * into the backdrop. */
      var row = result.palettes[tile.palette];
      var word = idx === 0 || !row || row[idx] === undefined
               ? result.backdrop : row[idx];
      var rgb = rgbOf(word), o = (y * w + x) * 3;
      px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2];
    }
    return { width: w, height: h, pixels: px };
  }

  function previewOfPalette(result) {
    var w = 256, h = ENTRIES;
    var px = new Uint8Array(w * h * 3);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var rgb = rgbOf(result.palettes[0][y]), o = (y * w + x) * 3;
      px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2];
    }
    return { width: w, height: h, pixels: px };
  }

  /* The patterns on a grid, each on its own palette over the backdrop. */
  function previewOfSprites(result) {
    var w = 256, h = 240;
    var px = new Uint8Array(w * h * 3);
    var back = rgbOf(result.backdrop || 0);
    for (var i = 0; i < w * h; i++) {
      px[i * 3] = back[0]; px[i * 3 + 1] = back[1]; px[i * 3 + 2] = back[2];
    }
    for (var s = 0; s < result.sprites.length; s++) {
      var sp = result.sprites[s], pat = result.patterns[sp.pattern];
      var pal = result.palettes[sp.palette] || result.palettes[0];
      for (var y = 0; y < pat.height; y++) for (var x = 0; x < pat.width; x++) {
        var idx = pat.pixels[y * pat.width + x];
        if (!idx) continue;
        var gy = sp.y + y, gx = sp.x + x;
        if (gx < 0 || gy < 0 || gx >= w || gy >= h) continue;
        var rgb = rgbOf(pal[idx]), o = (gy * w + gx) * 3;
        px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2];
      }
    }
    return { width: w, height: h, pixels: px };
  }

  /* ---- the panels' files --------------------------------------------------
   * The three documents written with the same shapes pce-screen.js's
   * tilesText/palettesText and pce-sat.js's spritesText write, so what Add
   * Source makes is what the panels open. */
  function padRow(row) {
    var out = new Array(ENTRIES);
    for (var e = 0; e < ENTRIES; e++) out[e] = row[e] === undefined ? 0 : row[e];
    return out;
  }

  function paletteDoc(result) {
    var background = [], sprites = [];
    for (var p = 0; p < BG_PALETTES; p++)
      background.push(padRow(result.kind === "sprites" ? [] : (result.palettes[p] || [])));
    for (var s = 0; s < SPRITE_PALETTES; s++)
      sprites.push(padRow(result.kind === "sprites" ? (result.palettes[s] || []) : []));
    return { version: 1, backdrop: result.backdrop || 0,
             background: background, sprites: sprites };
  }

  function filesOfImage(result) {
    var files = {};
    var pal = paletteDoc(result);
    files["palettes.json"] = JSON.stringify(pal, null, 2) + "\n";
    if (result.kind === "palette") return files;
    if (result.kind === "sprites") {
      files["sprites.json"] = JSON.stringify({
        version: 1,
        patterns: result.patterns,
        sprites: result.sprites
      }, null, 2) + "\n";
      return files;
    }
    var doc = { version: 1, video: 256, tiles: result.tiles };
    if (result.map) doc.map = { mwr: 0, bxr: 0, byr: 0, cells: result.map };
    files["tiles.json"] = JSON.stringify(doc, null, 2) + "\n";
    return files;
  }

  /* ---- WAV -> a DDA sample ------------------------------------------------
   * The PSG's DDA mode plays whatever is in R6, held until the next write
   * (pce-psg.js models it from pce_fast).  So a sample is a rate (how often
   * the CPU writes) and a list of 5-bit values.  RIFF's chunks are walked
   * rather than assumed contiguous: a file from an editor may carry any
   * number of extra chunks before `data`. */
  function parseWav(bytes) {
    var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (latin(b, 0, 4) !== "RIFF" || latin(b, 8, 4) !== "WAVE")
      refuse("wav-signature", "not a RIFF/WAVE file");
    var pos = 12, fmt = null, data = null;
    while (pos + 8 <= b.length) {
      var id = latin(b, pos, 4);
      var size = b[pos + 4] + (b[pos + 5] << 8) + (b[pos + 6] << 16) + (b[pos + 7] << 24);
      var body = pos + 8;
      if (id === "fmt ") {
        fmt = { format: b[body] + (b[body + 1] << 8),
                channels: b[body + 2] + (b[body + 3] << 8),
                sampleRate: b[body + 4] + (b[body + 5] << 8) + (b[body + 6] << 16) + (b[body + 7] << 24),
                blockAlign: b[body + 12] + (b[body + 13] << 8),
                bits: b[body + 14] + (b[body + 15] << 8) };
      } else if (id === "data") data = b.subarray(body, Math.min(b.length, body + size));
      pos = body + size + (size & 1);
    }
    if (!fmt || !data) refuse("wav-shape", "the WAV has no fmt or data chunk");
    if (fmt.format !== 1)
      refuse("wav-format", "only uncompressed PCM WAV is supported (format " +
             fmt.format + ")");
    if (fmt.bits !== 8 && fmt.bits !== 16)
      refuse("wav-bits", fmt.bits + "-bit samples are not supported (8 or 16)");
    var chans = fmt.channels, bytesPer = fmt.bits / 8;
    var frames = Math.floor(data.length / (bytesPer * chans));
    var mono = new Float32Array(frames);
    for (var i = 0; i < frames; i++) {
      var sum = 0;
      for (var c = 0; c < chans; c++) {
        var o = (i * chans + c) * bytesPer;
        if (bytesPer === 1) sum += (data[o] - 128) / 128;
        else sum += ((data[o] | (data[o + 1] << 8)) << 16 >> 16) / 32768;
      }
      mono[i] = sum / chans;
    }
    return { channels: chans, bits: fmt.bits, sampleRate: fmt.sampleRate,
             frames: frames, mono: mono };
  }

  /* Linear resample: the source is a continuous signal and the DDA's rate is
   * ours to choose, so the nearest input sample would alias a tone badly. */
  function resample(mono, from, to) {
    var n = Math.max(1, Math.round(mono.length * to / from));
    var out = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var t = i * from / to;
      var j = Math.floor(t), f = t - j;
      var a = mono[Math.min(mono.length - 1, j)];
      var b = mono[Math.min(mono.length - 1, j + 1)];
      out[i] = a + (b - a) * f;
    }
    return out;
  }

  function importWav(bytes, opts) {
    opts = opts || {};
    var wav = parseWav(bytes);
    var rate = opts.rate || 6000;
    if (!isInt(rate) || rate < 1000 || rate > 24000)
      refuse("source-rate", "the DDA rate is 1000..24000 Hz (got " + rate + ")");
    var maxSeconds = opts.maxSeconds === undefined ? 8 : opts.maxSeconds;
    var warnings = [];
    var seconds = wav.frames / wav.sampleRate;
    var source = wav.mono;
    var useFrames = wav.frames;
    if (seconds > maxSeconds) {
      useFrames = Math.floor(maxSeconds * wav.sampleRate);
      source = wav.mono.subarray(0, useFrames);
      warnings.push("the WAV is " + seconds.toFixed(2) + " s; only the first " +
                    maxSeconds + " s are imported (the HuCard holds 1 MB and a " +
                    "sample is one byte per 1/" + rate + " s)");
      seconds = maxSeconds;
    }
    var mono = resample(source, wav.sampleRate, rate);
    var samples = new Array(mono.length);
    for (var i = 0; i < mono.length; i++)
      samples[i] = Math.max(0, Math.min(SAMPLE_MAX,
        Math.round((mono[i] + 1) / 2 * SAMPLE_MAX)));
    var result = {
      kind: "sample", name: opts.name || "sample",
      rate: rate, sourceRate: wav.sampleRate, channels: wav.channels,
      bits: wav.bits, seconds: samples.length / rate,
      samples: samples, bytes: samples.length,
      warnings: warnings,
      stats: { samples: samples.length, bytes: samples.length,
               seconds: samples.length / rate, rate: rate, bits: 5 }
    };
    result.trace = ddaTrace(samples, rate);
    result.files = {};   /* a DDA sample travels as song/sample data (#96) */
    return result;
  }

  /* The register stream a toy would write: power-on, DDA on for channel 0,
   * then one R6 per sample.  The frame each write lands in and the cycle
   * inside it are computed from the rate, so the sample plays at the rate
   * that was chosen rather than the nearest frame's. */
  function ddaTrace(samples, rate) {
    var events = [
      { f: 0, t: 0, reg: 1, value: 0xFF },            /* master volume full */
      { f: 0, t: 6, reg: 0, value: 0 },               /* channel 0 selected */
      { f: 0, t: 12, reg: 5, value: 0xFF },           /* balance centred */
      { f: 0, t: 18, reg: 4, value: 0xDF }            /* on | DDA | level 31 */
    ];
    var count = Math.max(1, Math.ceil(samples.length * 60 / rate));
    for (var i = 0; i < samples.length; i++) {
      var pos = i * 60 / rate;                        /* frames since the start */
      var f = Math.min(count - 1, Math.floor(pos + 24 / FRAME_CLOCKS));
      var t = Math.round((pos - Math.floor(pos)) * FRAME_CLOCKS) + 24;
      if (t >= FRAME_CLOCKS) t = FRAME_CLOCKS - 1;
      events.push({ f: f, t: t, reg: 6, value: samples[i] & SAMPLE_MAX });
    }
    return { events: events,
             frames: { t0: FRAME_CLOCKS, extra: [], pattern: [FRAME_CLOCKS] },
             count: count, channel: 0, rate: rate };
  }

  function renderSample(result) {
    if (!psg || typeof psg.render !== "function")
      refuse("source-psg", "the PSG model is not loaded");
    var t = result.trace || ddaTrace(result.samples, result.rate);
    var pcm = psg.render(t.events, t.frames, t.count);
    return { pcm: pcm.pcm, sampleRate: pcm.sampleRate, frames: t.count,
             seconds: t.count / 60 };
  }

  /* Pearson correlation of a rendered sample against the source it came
   * from, both resampled alike.  This is the evidence's question -- does
   * what the PSG plays still follow the WAV -- and it is scale-free, so the
   * PSG's DC offset and filter gain do not decide it.
   *
   * `maxLag` slides one over the other and keeps the best fit.  The PSG's
   * output runs through pce_fast's bass and treble filters, which delay the
   * signal by a couple of samples; comparing at lag 0 measures that delay,
   * not whether the sample survived, so the evidence aligns them and says
   * so. A negative best r would mean the playback is inverted, which is a
   * real defect and must not be hidden by taking an absolute value. */
  function correlate(input, rendered, maxLag) {
    var span = maxLag || 0;
    var best = -1, bestLag = 0;
    for (var lag = -span; lag <= span; lag++) {
      var r = correlateAt(input, rendered, lag);
      if (r > best) { best = r; bestLag = lag; }
    }
    return best;
  }

  function correlateAt(input, rendered, lag) {
    var a = Math.max(0, lag), b = Math.min(input.length, rendered.length + lag);
    var want = b - a;
    if (want < 2) return -1;
    var meanA = 0, meanB = 0, i;
    for (i = 0; i < want; i++) {
      meanA += input[a + i];
      meanB += rendered[a - lag + i];
    }
    meanA /= want; meanB /= want;
    var num = 0, da = 0, db = 0;
    for (i = 0; i < want; i++) {
      var x = input[a + i] - meanA, y = rendered[a - lag + i] - meanB;
      num += x * y; da += x * x; db += y * y;
    }
    if (!da || !db) return -1;     /* a flat signal has no correlation: -1 */
    return num / Math.sqrt(da * db);
  }

  /* Where the best fit sat, for a report that says how far the PSG's filter
   * moved the signal. */
  function correlationLag(input, rendered, maxLag) {
    var span = maxLag || 0, best = -1, bestLag = 0;
    for (var lag = -span; lag <= span; lag++) {
      var r = correlateAt(input, rendered, lag);
      if (r > best) { best = r; bestLag = lag; }
    }
    return { r: best, lag: bestLag };
  }

  /* ---- MIDI -> a song -----------------------------------------------------
   * A Standard MIDI File is a header and a list of tracks of delta-timed
   * events.  Only what a song needs is read: note on/off, set tempo, the
   * time signature's denominator if present (to know what a "step" is), and
   * the track names.  Everything else -- controllers, pitch bends, sysex --
   * is skipped, and the result says how many events it ignored rather than
   * pretending they were applied. */
  function readVar(buf, at) {
    var value = 0, used = 0, b;
    do {
      b = buf[at[0]++];
      value = (value << 7) | (b & 0x7F);
      used++;
    } while ((b & 0x80) && used < 4);
    return value;
  }

  function parseMidi(bytes) {
    var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (latin(b, 0, 4) !== "MThd") refuse("mid-signature", "not a Standard MIDI File");
    var headerLen = be32(b, 4);
    var format = be16(b, 8), tracks = be16(b, 10), division = be16(b, 12);
    if (division & 0x8000) refuse("mid-smtpe", "SMPTE time division is not supported");
    var pos = 8 + headerLen;
    var out = { format: format, division: division, notes: [],
                tempos: [], names: [], ignored: 0, timeSignature: null };
    for (var t = 0; t < tracks && pos + 8 <= b.length; t++) {
      if (latin(b, pos, 4) !== "MTrk") break;
      var len = be32(b, pos + 4);
      var end = Math.min(b.length, pos + 8 + len);
      var at = [pos + 8], tick = 0, running = 0;
      while (at[0] < end) {
        tick += readVar(b, at);
        var status = b[at[0]];
        if (status & 0x80) at[0]++;
        else status = running;              /* running status */
        if (!(status & 0x80)) { at[0] = end; break; }
        running = status;
        var type = status >> 4, chan = status & 0x0F;
        if (status === 0xFF) {
          var meta = b[at[0]++];
          var mlen = readVar(b, at);
          var body = b.subarray(at[0], at[0] + mlen);
          if (meta === 0x51 && mlen === 3)
            out.tempos.push({ tick: tick,
                              usPerQuarter: (body[0] << 16) | (body[1] << 8) | body[2] });
          else if (meta === 0x03) out.names.push(latin(body, 0, Math.min(body.length, 64)));
          else if (meta === 0x58 && mlen >= 2)
            out.timeSignature = { numerator: body[0], denominator: 1 << body[1] };
          at[0] += mlen;
        } else if (status === 0xF0 || status === 0xF7) {
          var slen = readVar(b, at);
          at[0] += slen;
          out.ignored++;
        } else if (type === 0x9) {
          var note = b[at[0]++], vel = b[at[0]++];
          if (vel > 0) out.notes.push({ channel: chan, note: note, velocity: vel,
                                        start: tick, end: -1, track: t });
          else closeNote(out, tick, chan, note);
        } else if (type === 0x8) {
          note = b[at[0]++]; at[0]++;
          closeNote(out, tick, chan, note);
        } else if (type === 0xC || type === 0xD) {
          at[0]++;                          /* one data byte */
          out.ignored++;
        } else if (type >= 0x8 && type <= 0xE) {
          at[0] += 2;
          out.ignored++;
        } else {
          at[0] = end;
          break;
        }
      }
      pos = end;
    }
    /* a note left hanging at the end of its track lasts to the last tick */
    var lastTick = 0;
    for (var n = 0; n < out.notes.length; n++)
      lastTick = Math.max(lastTick, out.notes[n].start);
    for (n = 0; n < out.notes.length; n++)
      if (out.notes[n].end < 0) out.notes[n].end = lastTick + division / 4;
    return out;
  }

  function closeNote(mid, tick, chan, note) {
    for (var i = mid.notes.length - 1; i >= 0; i--) {
      var nt = mid.notes[i];
      if (nt.channel === chan && nt.note === note && nt.end < 0) {
        nt.end = tick;
        return;
      }
    }
  }

  function importMidi(bytes, opts) {
    opts = opts || {};
    if (!seq) refuse("source-seq", "the sequencer model is not loaded");
    var mid = parseMidi(bytes);
    var warnings = [];
    var division = mid.division;
    var beatMs = mid.tempos.length ? mid.tempos[0].usPerQuarter / 1000 : 500;
    var bpm = Math.round(60000 / beatMs);
    bpm = Math.max(seq.TEMPO_MIN, Math.min(seq.TEMPO_MAX, bpm));
    var song = seq.newSong(16);
    song.name = opts.name || pickName(mid) || "midi";
    song.tempo = bpm;

    /* A step is a sixteenth note -- the sequencer's grid is 16 steps to the
     * bar and 16th notes are what a tracker row is.  With the file's own time
     * signature the step is 1/(denominator) of a note where a bar is
     * numerator of them. */
    var ticksPerStep = division / 4;
    var totalSteps = 0;
    for (var i = 0; i < mid.notes.length; i++)
      totalSteps = Math.max(totalSteps, Math.ceil(mid.notes[i].end / ticksPerStep));
    var needed = Math.max(1, Math.ceil(totalSteps / song.steps));
    if (needed > seq.PATTERNS_MAX) {
      warnings.push("the .mid runs " + (totalSteps / song.steps).toFixed(1) +
                    " bars; the SEQUENCER holds " + seq.PATTERNS_MAX +
                    " patterns, so only the first " +
                    (seq.PATTERNS_MAX * song.steps) + " steps are imported");
      needed = seq.PATTERNS_MAX;
    }
    for (i = 1; i < needed; i++) seq.addPattern(song);
    song.order = [];
    for (i = 0; i < needed; i++) song.order.push(i);

    /* MIDI channel -> the PSG's six voices, in order of first appearance */
    var order = [], byChannel = {};
    for (i = 0; i < mid.notes.length; i++) {
      var c = mid.notes[i].channel;
      if (byChannel[c] === undefined) {
        byChannel[c] = order.length;
        order.push(c);
      }
    }
    if (order.length > seq.CHANNELS) {
      warnings.push(order.length + " MIDI channels; the PSG has " +
                    seq.CHANNELS + " voices, so later channels share the last one");
    }
    var placed = 0, dropped = 0;
    for (i = 0; i < mid.notes.length; i++) {
      var nt = mid.notes[i];
      var voice = Math.min(seq.CHANNELS - 1, byChannel[nt.channel]);
      var step = Math.round(nt.start / ticksPerStep);
      var endStep = Math.max(step + 1, Math.round(nt.end / ticksPerStep));
      var note = nt.note - 24;              /* pce-seq.js: note 0 = C1 = MIDI 24 */
      if (note < seq.NOTE_MIN || note > seq.NOTE_MAX) { dropped++; continue; }
      var pattern = Math.floor(step / song.steps);
      if (pattern >= needed) { dropped++; continue; }
      var at = step % song.steps;
      /* the default instruments are the sequencer's own: 0 lead, 1 bass,
       * 2 bell, 3 strings, 4 kick, 5 snare.  The lowest MIDI channel takes
       * the bass and the highest the drums, because that is how a small
       * .mid is arranged in practice; every other channel is the lead. */
      var inst = voice === 0 && order.length > 2 ? 1
               : voice >= seq.CHANNELS - 2 && order.length > 4 ? 4 : 0;
      seq.setCell(song, pattern, voice, at,
        { note: note, instrument: inst,
          length: Math.max(1, Math.min(song.steps - at,
                                       endStep - step)) });
      placed++;
    }
    if (dropped)
      warnings.push(dropped + " note(s) outside the PSG's C1..B7 range or past " +
                    "the last pattern were dropped");
    seq.check(song);
    var result = {
      kind: "song", name: song.name, song: song,
      text: JSON.stringify(song, null, 2) + "\n",
      notes: placed, warnings: warnings,
      stats: { notes: placed, patterns: song.patterns.length,
               tempo: song.tempo, steps: song.steps,
               channels: order.length, ignored: mid.ignored }
    };
    result.files = { "song.json": result.text };
    return result;
  }

  function pickName(mid) {
    for (var i = 0; i < mid.names.length; i++) {
      var n = String(mid.names[i] || "").trim();
      if (n && /^[A-Za-z0-9 _.-]+$/.test(n)) return n;
    }
    return "";
  }

  /* ---- the studio's own file ---------------------------------------------
   * Save produces one pce.studio/1 envelope carrying every file (docs/STUDIO.md
   * §"Save").  Opening one through Add Source is the same act as Open/From
   * file, so the importer returns its file list rather than a picture. */
  function importStudio(text) {
    var doc;
    try { doc = JSON.parse(String(text)); }
    catch (e) { refuse("studio-json", "the file is not JSON: " + e.message); }
    if (!doc || doc.version !== "pce.studio/1")
      refuse("studio-version", "not a pce.studio/1 file (version " +
             JSON.stringify(doc && doc.version) + ")");
    if (!Array.isArray(doc.files) || !doc.files.length)
      refuse("studio-shape", "the file carries no files");
    for (var i = 0; i < doc.files.length; i++) {
      if (!doc.files[i] || typeof doc.files[i].name !== "string" ||
          typeof doc.files[i].source !== "string")
        refuse("studio-shape", "file " + i + " needs a name and a source");
    }
    return { kind: "studio", name: doc.title || "toy", title: doc.title || "",
             description: doc.description || "",
             files: doc.files, warnings: [],
             stats: { files: doc.files.length } };
  }

  /* Which kind a dropped file is: the importer's own front door, so the
   * dialog's kind dropdown defaults to what the file can be. */
  function kindOf(name, bytes) {
    var lower = String(name || "").toLowerCase();
    if (/\.pce\.studio$|\.pce\.json$/.test(lower)) return "studio";
    if (/\.mid(i)?$/.test(lower)) return "song";
    if (/\.wav$/.test(lower)) return "sample";
    if (bytes && bytes.length >= 8) {
      var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      if (latin(b, 0, 4) === "RIFF" && latin(b, 8, 4) === "WAVE") return "sample";
      if (latin(b, 0, 4) === "MThd") return "song";
      if (latin(b, 0, 8) === "\x89PNG\r\n\x1a\n") return "bg";
    }
    if (/\.png$/.test(lower)) return "bg";
    return null;
  }

  return {
    TILE: TILE, ENTRIES: ENTRIES, BG_PALETTES: BG_PALETTES,
    SPRITE_PALETTES: SPRITE_PALETTES, TILE_COLOURS: TILE_COLOURS,
    BAT_W: BAT_W, BAT_H: BAT_H, BAT_CELLS: BAT_CELLS,
    FIRST_CHAR: FIRST_CHAR, MAX_TILES: MAX_TILES, VRAM_WORDS: VRAM_WORDS,
    VCE_COLOURS: VCE_COLOURS, SPRITE_SIZES: SPRITE_SIZES,
    DITHERS: DITHERS, KINDS: KINDS, DDA_RATES: DDA_RATES,
    DDA_MAX: SAMPLE_MAX, FRAME_CLOCKS: FRAME_CLOCKS,
    BAYER8: BAYER8,

    REFUSALS: {
      "png-signature": "not a PNG",
      "png-header": "no IHDR",
      "png-interlace": "an interlaced PNG",
      "png-depth": "a PNG that is not 8 bits a channel",
      "png-type": "a PNG colour type other than grey/RGB/RGBA/palette",
      "png-data": "image data shorter than the header says",
      "png-palette": "a palette index with no PLTE entry",
      "png-inflate": "a PNG with no inflate function to decode it",
      "wav-signature": "not RIFF/WAVE",
      "wav-shape": "no fmt or data chunk",
      "wav-format": "compressed WAV",
      "wav-bits": "WAV samples that are not 8 or 16 bits",
      "mid-signature": "not a Standard MIDI File",
      "mid-smtpe": "SMPTE time division",
      "source-kind": "a kind the PCE has no answer for",
      "source-dither": "a dither that is not none/ordered/diffusion",
      "source-alpha": "an alpha threshold outside 0..255",
      "source-size": "a sprite size the VDC cannot draw",
      "source-rate": "a DDA rate outside 1000..24000 Hz",
      "source-tiles": "more distinct tiles than the ROM layout holds",
      "source-empty": "a picture with no opaque pixels",
      "studio-json": "a file that is not JSON",
      "studio-version": "a file that is not pce.studio/1",
      "studio-shape": "a pce.studio file with no files"
    },

    snap: snap, vce: vce, channels: channels, rgbOf: rgbOf, dist: dist,
    nearest: nearest,
    pngInfo: pngInfo, pngPixels: pngPixels, decodePng: decodePng,
    parseWav: parseWav, resample: resample,
    parseMidi: parseMidi,

    importImage: importImage,
    importWav: importWav,
    importMidi: importMidi,
    importStudio: importStudio,
    kindOf: kindOf,

    palettePlan: palettePlan,
    tileIndices: tileIndices,
    filesOfImage: filesOfImage,
    previewOfImage: previewOfImage,
    ddaTrace: ddaTrace,
    renderSample: renderSample,
    correlate: correlate,
    correlateAt: correlateAt,
    correlationLag: correlationLag
  };
});
