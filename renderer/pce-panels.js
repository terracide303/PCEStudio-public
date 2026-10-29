/*
 * pce-panels.js — PCEStudio's model panels (card #26).
 *
 * The editor shows the same state it draws.  There is no second copy of the
 * picture here: every function takes the renderer's own options — vram,
 * cram, sat, regs, raster, firstScanline, width, height — the objects
 * pce-bg.js/pce-sprites.js are given, and the per-line values come from
 * pce-bg.js's buildRows, the BAT/tile decode from pce-bg.js's
 * backgroundPixel and the sprite layer from pce-sprites.js's collectStrips /
 * paintLine.  The panels therefore cannot say something the picture does not.
 *
 *   registerLines(st)          one row per rendered scanline: the VDC's
 *                              BXR/BYR/CR values that line used, the effective
 *                              BG_YOffset, which raster entry is in force and
 *                              the RCR value the chain arms after it.
 *   vdcRegisters(st, row)      all 20 VDC registers (R00-R13, the HuC6270
 *                              address space: MAWR, MARR, VWR/VRR, R03, R04,
 *                              CR, RCR, BXR, BYR, MWR, HSR, HDR, VPR, VDR,
 *                              VCR, DCR, SOUR, DESR, LENR, DVSSR) for one
 *                              line, with where each value came from.
 *   vcePalettes(st, row)       the VCE's 512 colours as 32 palettes of 16,
 *                              decoded through the line's colour table.
 *   vramMap(st)                which words hold the BAT, the tile/pattern
 *                              copy regions, the SAT and what is free.
 *   satTable(st)               the SAT as 64 sprite rows (Y, X, pattern,
 *                              palette, CGX/CGY, flips, SPBG, cells).
 *   followPixel(st, x, y)      one screen pixel's provenance: the layer that
 *                              won (sprite / background / blanking), the BAT
 *                              entry and tile, the sprite number, pattern and
 *                              palette, the 9-bit colour index and its RGB,
 *                              and the register values on that line.
 *
 * Register values are reported with their source, because the model does not
 * hold all 20: a Mednafen save state (tests/dumps/<name>/regs.json) carries
 * most
 * of them; the editor's picture model carries only BXR/BYR/MWR/CR, so the
 * viewer ROM's fixed 256x224 values (tools/viewer.asm's HuDK vdc_init_table
 * sequence: HSR $0202, HDR $041F, VPR $0F02, VDR $00EF, VCR $000C, DCR
 * $0010, DVSSR $7F00) stand in and are labelled "viewer".  MAWR/MARR/VWR/
 * VRR/SOUR/DESR/LENR are not part of a picture and are reported null.
 *
 * Dual use: CommonJS module in Node (tests/check-panels.js) and a browser
 * global (renderer/editor.html) via a UMD-style wrapper, like pce-bg.js.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./pce-bg.js"), require("./pce-sprites.js"));
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.panels = factory(root.PCEStudio.bg, root.PCEStudio.sprites);
  }
})(typeof self !== "undefined" ? self : this, function (bg, sprites) {
  "use strict";

  var VRAM_WORDS = 32768;
  var SAT_ADDR = 0x7F00;
  var SAT_WORDS = 256;
  var RCR_BASE = 0x40;

  /* The HuC6270's address space R00-R13: every register the VDC has, in the
   * manual's order (HuC6270 VDC manual, register table around p. H7-4).  R03
   * and R04 are addresses with no register. */
  var VDC_REGISTERS = [
    { number: 0x00, name: "MAWR", title: "memory address write" },
    { number: 0x01, name: "MARR", title: "memory address read" },
    { number: 0x02, name: "VWR/VRR", title: "VRAM data write / read" },
    { number: 0x03, name: "-", title: "no register at this address" },
    { number: 0x04, name: "-", title: "no register at this address" },
    { number: 0x05, name: "CR", title: "control" },
    { number: 0x06, name: "RCR", title: "scanning line detection" },
    { number: 0x07, name: "BXR", title: "background X scroll" },
    { number: 0x08, name: "BYR", title: "background Y scroll" },
    { number: 0x09, name: "MWR", title: "memory access width" },
    { number: 0x0A, name: "HSR", title: "horizontal sync" },
    { number: 0x0B, name: "HDR", title: "horizontal display" },
    { number: 0x0C, name: "VPR", title: "vertical sync" },
    { number: 0x0D, name: "VDR", title: "vertical display" },
    { number: 0x0E, name: "VCR", title: "vertical display end" },
    { number: 0x0F, name: "DCR", title: "block transfer control" },
    { number: 0x10, name: "SOUR", title: "block transfer source address" },
    { number: 0x11, name: "DESR", title: "block transfer destination address" },
    { number: 0x12, name: "LENR", title: "block transfer length" },
    { number: 0x13, name: "DVSSR", title: "VRAM-SATB transfer source" }
  ];

  /* The constant 256x224 register values the viewer ROM writes before it
   * shows a picture (tools/viewer.asm, the HuDK vdc_init_table sequence).
   * Only used for a register the picture model does not carry.  #70: a wide
   * picture carries its own HSR/HDR/VCECR, so these fallbacks are the /4
   * clock's values only. */
  var VIEWER_FIXED_REGS = {
    HSR: 0x0202,
    HDR: 0x041F,
    VPR: 0x0F02,
    VDR: 0x00EF,
    VCR: 0x000C,
    DCR: 0x0010,
    SATB: 0x7F00         /* DVSSR: the SAT source word address */
  };

  /* Register -> the keys a state may carry it under. */
  var REG_KEYS = {
    MAWR: ["MAWR"],
    MARR: ["MARR"],
    "VWR/VRR": ["VWR", "VRR"],
    CR: ["CR"],
    RCR: ["RCR"],
    BXR: ["BXR"],
    BYR: ["BYR"],
    MWR: ["MWR"],
    HSR: ["HSR"],
    HDR: ["HDR"],
    VPR: ["VPR", "VSR"],
    VDR: ["VDR", "VDW", "VDW_cache"],
    VCR: ["VCR"],
    DCR: ["DCR"],
    SOUR: ["SOUR"],
    DESR: ["DESR"],
    LENR: ["LENR"],
    DVSSR: ["DVSSR", "SATB"]
  };

  function u16(bytes, word) {
    return bytes[word * 2] | (bytes[word * 2 + 1] << 8);
  }

  function byLine(a, b) { return a.line - b.line; }

  /* ---- the state ------------------------------------------------------- */

  /* Normalise the renderer options the panels read.  Nothing is copied: the
   * same vram/cram/sat/regs/raster objects are kept, and `rows` is the very
   * buildRows result pce-bg.js renders with. */
  function state(opts) {
    if (!opts || !opts.vram || !opts.cram)
      throw new Error("pce-panels: state needs vram and cram");
    var regs = opts.regs || {};
    /* #70: with no explicit width the frame follows the picture's dot clock
     * (256 / 341 / 512 dots from the VCE CR), not a fixed 256. */
    var width = opts.width || bg.frameWidth({ regs: regs });
    var height = opts.height || 232;
    var firstScanline = opts.firstScanline != null ? opts.firstScanline : 18;
    var satAddr = regs.DVSSR != null ? regs.DVSSR
                : regs.SATB != null ? regs.SATB
                : SAT_ADDR;
    var sat = opts.sat || opts.vram.slice(satAddr * 2, satAddr * 2 + 512);
    var vdwLine0 = (regs.RCRCount != null && regs.scanline != null)
      ? regs.RCRCount - (regs.scanline - firstScanline)
      : 0;
    var bopts = { vram: opts.vram, cram: opts.cram, regs: regs,
                  width: width, height: height,
                  firstScanline: firstScanline };
    if (opts.raster) bopts.raster = opts.raster;
    var entries = opts.raster && opts.raster.entries
      ? opts.raster.entries.slice().sort(byLine) : [];
    return {
      opts: opts,
      vram: opts.vram,
      cram: opts.cram,
      sat: sat,
      regs: regs,
      raster: opts.raster || null,
      entries: entries,
      firstScanline: firstScanline,
      width: width,
      height: height,
      vdwLine0: vdwLine0,
      geom: bg.batGeometry((regs.MWR || 0) & 0xFF),
      rows: bg.buildRows(bopts),
      satAddr: satAddr & 0x7FFF,
      regions: opts.regions || null,
      fixedRegs: opts.fixedRegs || VIEWER_FIXED_REGS
    };
  }

  /* The per-line register values the renderer used for one rendered row.
   * This mirrors renderIndices' own choice of row values (rows when a raster
   * table exists, the flat registers otherwise). */
  function lineValues(st, row) {
    var regs = st.regs, rows = st.rows;
    var line = st.vdwLine0 + row;
    var cr = rows ? rows.cr[row] : ((regs.CR || 0) & 0xFF);
    var bxr = rows ? rows.bxr[row] : ((regs.BXR || 0) & 0x3FF);
    var byr = rows ? rows.byr[row] : ((regs.BYR || 0) & 0x1FF);
    var bgY = rows ? rows.bgY[row]
                   : ((((regs.BYR || 0) & 0x1FF) + st.vdwLine0 + row) &
                      0x1FF);
    return { row: row, line: line, BXR: bxr, BYR: byr, CR: cr,
             BG_YOffset: bgY };
  }

  /* The RCR value the chain holds at `line`: 0x40 + the next entry after the
   * last one that has fired (the rule check.js uses on the saved RCR). */
  function armAt(st, line) {
    var entries = st.entries;
    if (!entries.length) return null;
    var last = -1;
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].line <= line) last = i; else break;
    }
    return RCR_BASE + entries[(last + 1) % entries.length].line;
  }

  /* ---- the VDC's status flags (card #50) ------------------------------- */

  /* The status model for this state: pce-sprites.js's status() over the same
   * vram/sat/regs/raster the picture is drawn from.  Kept on the state object
   * so the per-line table, the summary and follow-a-pixel read one
   * computation and none of them can disagree. */
  function statusOf(st) {
    if (!st.statusModel) {
      st.statusModel = sprites.status({
        vram: st.vram, cram: st.cram, sat: st.sat, regs: st.regs,
        raster: st.raster || undefined, width: st.width, height: st.height,
        firstScanline: st.firstScanline
      });
    }
    return st.statusModel;
  }

  function flagLines(st, key) {
    var model = statusOf(st), out = [];
    for (var i = 0; i < model.lines.length; i++) {
      if (model.lines[i][key]) out.push(model.lines[i].line);
    }
    return out;
  }

  /* The frame summary: the four conditions, the lines they occur on, and the
   * bits the status register would hold (condition AND its CR enable — CC
   * bit 0, OR bit 1, RR bit 2, VD bit 5; HuC6270 SR p. H7-4, CR p. H7-5). */
  function status(st) {
    var model = statusOf(st);
    var f = model.frame;
    var rrLines = [];
    for (var line = 0; line < model.timing.rr.length; line++) {
      if (model.timing.rr[line]) rrLines.push(line);
    }
    return {
      vdw: f.vdw,
      vblankLine: f.vblankLine,
      OR: f.OR, CC: f.CC, RR: f.RR, VD: f.VD,
      orBit: f.orBit, ccBit: f.ccBit, rrBit: f.rrBit, vdBit: f.vdBit,
      sr: f.sr,
      orLines: flagLines(st, "OR"),
      ccLines: flagLines(st, "CC"),
      rrLines: rrLines,
      vdLines: f.VD ? [f.vblankLine] : []
    };
  }

  function entrySummary(e) {
    if (!e) return null;
    return {
      line: e.line,
      rcr: e.rcr,
      bxr: e.bxr != null ? e.bxr : null,
      byr: e.byr != null ? e.byr : null,
      cr: e.cr != null ? e.cr : null,
      cram: e.cram ? e.cram.map(function (w) {
        return { address: w[0], word: w[1] };
      }) : null
    };
  }

  /* One row per rendered scanline: the values on that line, which raster
   * entry is in force, whether one fires exactly there, and the chain arm. */
  function registerLines(st) {
    var out = [];
    var status = statusOf(st).lines;
    var cursor = 0, applied = null;
    for (var row = 0; row < st.height; row++) {
      var v = lineValues(st, row);
      while (cursor < st.entries.length &&
             st.entries[cursor].line <= v.line) {
        applied = st.entries[cursor++];
      }
      var atLine = applied != null && applied.line === v.line;
      var sg = status[row] || {};
      out.push({
        row: row,
        line: v.line,
        BXR: v.BXR,
        BYR: v.BYR,
        CR: v.CR,
        BG_YOffset: v.BG_YOffset,
        OR: !!sg.OR,
        CC: !!sg.CC,
        RR: !!sg.RR,
        VD: !!sg.VD,
        orBit: !!sg.orBit,
        ccBit: !!sg.ccBit,
        rrBit: !!sg.rrBit,
        vdBit: !!sg.vdBit,
        entry: entrySummary(applied),
        entryAtLine: atLine,
        wrote: {
          bxr: atLine && applied.bxr != null,
          byr: atLine && applied.byr != null,
          cr: atLine && applied.cr != null,
          cram: atLine && applied.cram ? applied.cram.length : 0
        },
        rcr: armAt(st, v.line),
        entryRcr: atLine ? applied.rcr : null
      });
    }
    return out;
  }

  /* All 20 VDC registers for one rendered row, each with the source of its
   * value: "line" (BXR/BYR/CR/RCR on this scanline), "state" (the dump's
   * regs.json or the editor's view registers), "viewer" (the constant
   * viewer-ROM value), or null (not part of a picture). */
  function vdcRegisters(st, row) {
    var v = lineValues(st, row);
    var arm = armAt(st, v.line);
    var out = [];
    for (var i = 0; i < VDC_REGISTERS.length; i++) {
      var def = VDC_REGISTERS[i];
      var value = null, source = null;
      if (def.name === "CR") { value = v.CR; source = "line"; }
      else if (def.name === "RCR") { value = arm; source = "line"; }
      else if (def.name === "BXR") { value = v.BXR; source = "line"; }
      else if (def.name === "BYR") { value = v.BYR; source = "line"; }
      else if (def.name === "-") { value = null; source = null; }
      else {
        var keys = REG_KEYS[def.name] || [];
        for (var k = 0; k < keys.length && value == null; k++) {
          if (st.regs[keys[k]] != null) {
            value = st.regs[keys[k]];
            source = "state";
          }
        }
        if (value == null && st.fixedRegs && st.fixedRegs[def.name] != null) {
          value = st.fixedRegs[def.name];
          source = "viewer";
        }
      }
      out.push({
        number: def.number,
        name: def.name,
        title: def.title,
        value: value,
        source: source
      });
    }
    return out;
  }

  /* ---- the VCE's 512 colours ------------------------------------------ */

  /* The colour table one rendered row decodes through: the per-line table
   * when a raster table exists (buildRows.rgb, the same bytes renderFrame
   * maps through), else the flat 512 CRAM words. */
  function colourTableAt(st, row) {
    if (st.rows) {
      var r = row == null ? 0 : row;
      if (r >= 0 && r < st.height) {
        var rgb = st.rows.rgb[r];
        var words = new Array(512);
        for (var i = 0; i < 512; i++) {
          words[i] = (Math.round(rgb[i * 3 + 1] / 36) << 6) |
                     (Math.round(rgb[i * 3] / 36) << 3) |
                     Math.round(rgb[i * 3 + 2] / 36);
        }
        return { words: words, rgb: rgb, row: r };
      }
    }
    var flat = new Array(512);
    for (var j = 0; j < 512; j++) {
      flat[j] = st.cram[j * 2] | (st.cram[j * 2 + 1] << 8);
    }
    return { words: flat, rgb: bg.decodeCramWords(flat), row: null };
  }

  function vcePalettes(st, row) {
    var table = colourTableAt(st, row);
    var palettes = [];
    for (var p = 0; p < 32; p++) {
      var entries = [];
      for (var e = 0; e < 16; e++) {
        var i = p * 16 + e;
        var w = table.words[i] & 0x1FF;
        entries.push({
          index: i,
          palette: p,
          entry: e,
          word: w,
          r: table.rgb[i * 3],
          g: table.rgb[i * 3 + 1],
          b: table.rgb[i * 3 + 2]
        });
      }
      palettes.push(entries);
    }
    return {
      palettes: palettes,
      row: table.row,
      line: table.row == null ? null : st.vdwLine0 + table.row
    };
  }

  /* ---- the VRAM map ---------------------------------------------------- */

  function overlapWords(aStart, aWords, bStart, bWords) {
    var lo = Math.max(aStart, bStart);
    var hi = Math.min(aStart + aWords, bStart + bWords);
    return hi > lo ? hi - lo : 0;
  }

  /* Group a cell -> sprites map into contiguous word ranges. */
  function groupCells(cellMap) {
    var cells = Object.keys(cellMap).map(Number).sort(function (a, b) {
      return a - b;
    });
    var groups = [], cur = null;
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      if (cur && c === cur.last + 1) {
        cur.last = c;
        cur.cells.push(c);
      } else {
        cur = { first: c, last: c, cells: [c], sprites: {} };
        groups.push(cur);
      }
      for (var k = 0; k < cellMap[c].length; k++) cur.sprites[cellMap[c][k]] = 1;
    }
    return groups.map(function (g) {
      return {
        start: g.first * 64,
        words: g.cells.length * 64,
        cells: g.cells,
        sprites: Object.keys(g.sprites).map(Number).sort(function (a, b) {
          return a - b;
        })
      };
    });
  }

  /* Every VRAM cell the SAT's sprites read, cell -> the sprite numbers that
   * name it.  The cells come from pce-sprites.js's own size/pattern rules,
   * so the map shows exactly the words the sprite renderer fetches. */
  function patternCells(st) {
    var cellMap = {};
    if (!st.sat) return cellMap;
    for (var i = 0; i < 64; i++) {
      var words = [u16(st.sat, i * 4), u16(st.sat, i * 4 + 1),
                   u16(st.sat, i * 4 + 2), u16(st.sat, i * 4 + 3)];
      if (!(words[0] | words[1] | words[2] | words[3])) continue;
      var cells = sprites.spriteCells(st.sat, i);
      for (var c = 0; c < cells.length; c++) {
        if (!cellMap[cells[c]]) cellMap[cells[c]] = [];
        cellMap[cells[c]].push(i);
      }
    }
    return cellMap;
  }

  /* Tile word ranges named by the BAT when the dump carries no regions.json:
   * the unique character codes it references, consecutive codes merged. */
  function tilesFromBat(st) {
    var count = st.geom.width * st.geom.height;
    var seen = {}, chars = [];
    for (var i = 0; i < count; i++) {
      var ch = u16(st.vram, i) & 0xFFF;
      if (ch >= 0x800 || seen[ch]) continue;
      seen[ch] = true;
      chars.push(ch);
    }
    chars.sort(function (a, b) { return a - b; });
    var ranges = [], cur = null;
    for (var k = 0; k < chars.length; k++) {
      var c = chars[k];
      if (cur && c === cur.last + 1) {
        cur.last = c;
        cur.count++;
      } else {
        cur = { first: c, last: c, count: 1 };
        ranges.push(cur);
      }
    }
    return ranges.map(function (r) {
      return { start: r.first * 16, words: r.count * 16,
               chars: [r.first, r.last] };
    });
  }

  function vramMap(st) {
    var batWords = st.geom.width * st.geom.height;
    var derivedPatterns = groupCells(patternCells(st));
    var occ = [];

    /* priority: the BAT, then the copy regions, then patterns a region does
     * not already cover, then the SAT.  Lower priority overlaps are clipped
     * below, so `segments` is always a partition of the 32768 words. */
    occ.push({ start: 0, words: batWords, kind: "BAT", priority: 0 });

    var supplied = [];
    if (st.regions) {
      for (var r = 0; r < st.regions.length; r++) {
        var char0 = st.regions[r][0], count = st.regions[r][1];
        var start = char0 * 16, words = count * 16;
        var pat = 0;
        for (var d = 0; d < derivedPatterns.length; d++) {
          pat += overlapWords(start, words, derivedPatterns[d].start,
                              derivedPatterns[d].words);
        }
        var kind = pat === 0 ? "tiles"
                 : pat >= words ? "sprite patterns"
                 : "sprite patterns (part named by the SAT)";
        var reg = { start: start, words: words, kind: kind, priority: 1,
                    descriptor: [char0, count], coversPatternCells: pat > 0 };
        supplied.push(reg);
        occ.push(reg);
      }
    } else {
      var tiles = tilesFromBat(st);
      for (var t = 0; t < tiles.length; t++) {
        tiles[t].kind = "tiles";
        tiles[t].priority = 1;
        occ.push(tiles[t]);
      }
    }

    for (var p = 0; p < derivedPatterns.length; p++) {
      var g = derivedPatterns[p];
      var covered = 0;
      for (var s = 0; s < supplied.length; s++) {
        covered += overlapWords(g.start, g.words, supplied[s].start,
                                supplied[s].words);
      }
      if (covered < g.words) {
        occ.push({ start: g.start, words: g.words, kind: "sprite patterns",
                   priority: 2, cells: g.cells, sprites: g.sprites,
                   clippedBy: covered > 0 });
      }
    }

    occ.push({ start: st.satAddr, words: SAT_WORDS, kind: "SAT",
               priority: 3 });

    occ.sort(function (a, b) {
      return a.start - b.start || a.priority - b.priority;
    });
    var segments = [], cursor = 0;
    for (var o = 0; o < occ.length; o++) {
      var seg = occ[o];
      if (seg.start < cursor) {
        var over = cursor - seg.start;
        seg.clippedWords = over;
        seg.start = cursor;
        seg.words -= over;
      }
      if (seg.words <= 0) continue;
      if (seg.start > VRAM_WORDS) continue;
      if (seg.start + seg.words > VRAM_WORDS)
        seg.words = VRAM_WORDS - seg.start;
      segments.push(seg);
      cursor = seg.start + seg.words;
    }
    var free = [];
    cursor = 0;
    for (var m = 0; m < segments.length; m++) {
      if (segments[m].start > cursor) {
        free.push({ start: cursor, words: segments[m].start - cursor,
                    kind: "free" });
      }
      cursor = segments[m].start + segments[m].words;
    }
    if (cursor < VRAM_WORDS) {
      free.push({ start: cursor, words: VRAM_WORDS - cursor, kind: "free" });
    }

    var all = segments.concat(free).sort(function (a, b) {
      return a.start - b.start;
    });
    return {
      words: VRAM_WORDS,
      bat: { start: 0, words: batWords },
      sat: { start: st.satAddr, words: SAT_WORDS },
      copyRegions: supplied.map(function (s) {
        return { descriptor: s.descriptor, start: s.start, words: s.words,
                 kind: s.kind, coversPatternCells: s.coversPatternCells };
      }),
      patterns: derivedPatterns,
      free: free,
      segments: all
    };
  }

  /* ---- the SAT --------------------------------------------------------- */

  function satTable(st) {
    var out = [];
    for (var i = 0; i < 64; i++) {
      var w0 = u16(st.sat, i * 4), w1 = u16(st.sat, i * 4 + 1);
      var w2 = u16(st.sat, i * 4 + 2), w3 = u16(st.sat, i * 4 + 3);
      var empty = !(w0 | w1 | w2 | w3);
      var size = sprites.spriteSize(st.sat, i);
      out.push({
        number: i,
        empty: empty,
        y: w0 & 0x3FF,
        x: w1 & 0x3FF,
        row0: (w0 & 0x3FF) - 64,
        leftX: (w1 & 0x3FF) - 32,
        patternWord: w2,
        pattern: (w2 >> 1) & 0x3FF,
        fourColour: !!(w2 & 1),
        palette: w3 & 0xF,
        spbg: (w3 >> 7) & 1,
        cgx: size.cgx,
        hflip: (w3 >> 11) & 1,
        cgy: size.cgy,
        vflip: (w3 >> 15) & 1,
        width: size.width,
        height: size.height,
        cells: empty ? [] : sprites.spriteCells(st.sat, i),
        words: [w0, w1, w2, w3]
      });
    }
    return out;
  }

  /* ---- follow a pixel -------------------------------------------------- */

  function spriteDetail(st, s) {
    var w0 = u16(st.sat, s.number * 4), w1 = u16(st.sat, s.number * 4 + 1);
    var w2 = u16(st.sat, s.number * 4 + 2), w3 = u16(st.sat, s.number * 4 + 3);
    var size = sprites.spriteSize(st.sat, s.number);
    return {
      number: s.number,
      pattern: (w2 >> 1) & 0x3FF,
      patternWord: w2,
      palette: w3 & 0xF,
      colourNumber: s.index & 0xF,
      index: s.index,
      spbg: !!s.spbg,
      cell: s.cell,
      cellWord: s.cell * 64,
      cellRow: s.row,
      stripColumn: s.strip,
      hflip: !!s.hflip,
      cgx: size.cgx,
      cgy: size.cgy,
      width: size.width,
      height: size.height,
      y: w0 & 0x3FF,
      x: w1 & 0x3FF,
      words: [w0, w1, w2, w3]
    };
  }

  function followPixel(st, x, y) {
    if (!(x >= 0 && x < st.width) || !(y >= 0 && y < st.height))
      throw new Error("pce-panels: pixel (" + x + "," + y + ") is outside " +
                      "the " + st.width + "x" + st.height + " frame");
    var v = lineValues(st, y);

    /* the background layer: the blanking fill when CR bit 7 (BB) is clear,
     * otherwise pce-bg.js's own per-pixel decode */
    var blanking = !(v.CR & 0x80);
    /* #70: the display window.  A frame wider than the picture's window has
     * border columns on either side (CRAM[0x100]), and the background's own
     * column numbering starts at the window's left edge — the same rule
     * pce-bg.js draws.  256-dot pictures sit at x0 = 0, so their traces are
     * unchanged. */
    var win = bg.displayWindow(st.opts);
    var outside = y < win.y0 || y >= win.y1 || x < win.x0 || x >= win.x1;
    var bgDetail = null, bgIndex;
    if (blanking) {
      bgIndex = 0x100;
      bgDetail = { blanking: true, index: 0x100,
                   reason: "CR bit 7 (BB) clear: blanking-period data" };
    } else if (outside) {
      bgIndex = 0x100;
      bgDetail = { border: true, index: 0x100,
                   reason: "outside the display window: border " +
                           "CRAM[0x100]" };
    } else {
      bgDetail = bg.backgroundPixel(st.vram, st.geom, v.BXR, v.BG_YOffset,
                                    x - win.x0);
      bgIndex = bgDetail.index;
    }

    /* the sprite layer: pce-sprites.js collects and paints the same line */
    var sprite = null, spriteIndex = null;
    if (st.sat && (v.CR & 0x40) && !outside) {
      var strips = sprites.collectStrips(st.sat, v.line);
      if (strips.length && x < st.width) {
        /* #70: paint the whole frame's width — the panels used to stop at
         * 256, which dropped every sprite on a 341- or 512-dot line. */
        var layer = sprites.paintLine(st.vram, strips, st.width);
        if (layer[x]) {
          sprite = spriteDetail(st, layer[x]);
          spriteIndex = sprite.index;
        }
      }
    }

    var layerWon = blanking ? "blanking" : "background";
    var index = bgIndex;
    if (sprite && (sprite.spbg || (bgIndex & 0xF) === 0)) {
      layerWon = "sprite";
      index = spriteIndex;
    }

    var table = colourTableAt(st, y);
    var word = table.words[index] & 0x1FF;
    return {
      x: x,
      y: y,
      row: y,
      line: v.line,
      layer: layerWon,
      index: index,
      colour: {
        word: word,
        r: table.rgb[index * 3],
        g: table.rgb[index * 3 + 1],
        b: table.rgb[index * 3 + 2]
      },
      background: bgDetail,
      sprite: sprite,
      status: statusOf(st).lines[y],
      registers: {
        row: y,
        line: v.line,
        BXR: v.BXR,
        BYR: v.BYR,
        CR: v.CR,
        BG_YOffset: v.BG_YOffset,
        MWR: (st.regs.MWR || 0) & 0xFF,
        RCR: armAt(st, v.line)
      },
      vdc: vdcRegisters(st, y)
    };
  }

  return {
    VRAM_WORDS: VRAM_WORDS,
    SAT_ADDR: SAT_ADDR,
    VDC_REGISTERS: VDC_REGISTERS,
    VIEWER_FIXED_REGS: VIEWER_FIXED_REGS,
    state: state,
    status: status,
    lineValues: lineValues,
    registerLines: registerLines,
    vdcRegisters: vdcRegisters,
    colourTableAt: colourTableAt,
    vcePalettes: vcePalettes,
    vramMap: vramMap,
    patternCells: patternCells,
    satTable: satTable,
    followPixel: followPixel
  };
});
