/*
 * pce-toyhost.js — the toy hardware host: the one implementation of the toy
 * surface and the frame flow, shared by the two front ends:
 *
 *   renderer/pce-toys.js  the Lua runtime (Fengari, card #30)
 *   renderer/pce-il.js    the IL interpreter (card #31)
 *
 * Why it is a file of its own: a toy's contract — which registers it may
 * write, the value ranges, the SAT composition, the one-entry-per-line raster
 * table and its cramPrev rule, the pads, the refusal codes — must exist once.
 * Two fronts onto one host; the models underneath (renderer/pce-bg.js and
 * renderer/pce-sprites.js) are the ones proven against Mednafen.
 *
 * The host owns only the toy's own state (VRAM, CRAM, SAT, the four register
 * values, the pads and the raster table). It draws nothing: render() hands
 * renderer/pce-sprites.js the exact input it already takes.
 *
 * Refusal codes: reg-forbidden, reg-range, pal-range, vram-range, sat-range,
 * sprite-range, raster-line, raster-line-full, pad-range, toy-error. The
 * front ends add their own (the Lua VM adds password-*, toy-timeout; the IL
 * lowerer adds il-*). docs/TOYS.md §2 is the surface; docs/IL.md §5 is the
 * same contract seen from the IL.
 *
 * The ranges and their manual pages are the ones docs/TOYS.md records:
 * BXR 10 bits (VDC H7-7), BYR 9 bits (H7-7), CR 8 bits (H7-5), 512 CRAM
 * entries, 32768 VRAM words, 64 SAT entries, 224 VDW display lines.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./pce-sprites.js"));
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.toyhost = factory(root.PCEStudio.sprites);
  }
})(typeof self !== "undefined" ? self : this, function (sprites) {
  "use strict";

  var WIDTH = 256;               /* the toy frame: 32 BAT columns, 28 rows */
  var HEIGHT = 224;
  var VDW_LINES = HEIGHT;        /* VDW display lines 0..223 */
  var FIRST_SCANLINE = 18;       /* the editor's preview calibration */
  var CR_BG_ON = 0x80;           /* CR bit 7, BB: background on */
  var BXR_MAX = 0x3FF;           /* VDC R07, 10 bits (manual H7-7) */
  var BYR_MAX = 0x1FF;           /* VDC R08, 9 bits (manual H7-7) */
  var CR_MAX = 0xFF;             /* VDC R05, 8 bits (manual H7-5) */
  var ALLOWED_REGS = { BXR: BXR_MAX, BYR: BYR_MAX, CR: CR_MAX };
  var VRAM_WORDS = 32768;
  var CRAM_ENTRIES = 512;
  var SAT_ENTRIES = 64;
  var RASTER_WRITES_MAX = 64;    /* colour writes one line may carry */
  var LOG_MAX = 200;
  var PAD_FIELDS = ["up", "down", "left", "right", "i", "ii", "select", "run"];

  /* A refusal, with the code the tests assert. */
  function ToyError(code, message) {
    this.name = "ToyError";
    this.code = code;
    this.message = message;
  }
  ToyError.prototype = Object.create(Error.prototype);
  ToyError.prototype.constructor = ToyError;

  function refuse(code, message) { throw new ToyError(code, message); }

  /* An integer already out of a Lua/IL value: the range check and the
   * message both live here, so both front ends refuse with the same words. */
  function intIn(v, name, lo, hi, code) {
    if (typeof v !== "number" || !isFinite(v) || v !== Math.floor(v)) {
      refuse(code, name + " must be an integer " + lo + ".." + hi);
    }
    if (v < lo || v > hi) {
      refuse(code, name + " must be " + lo + ".." + hi + ", got " + v);
    }
    return v;
  }

  function booleanOf(v) { return !!v; }

  function createHost(options) {
    options = options || {};
    var state = {
      vram: new Uint8Array(65536),
      cram: new Uint8Array(1024),
      sat: new Uint8Array(512),
      regs: { BXR: 0, BYR: 0, MWR: 0, CR: CR_BG_ON }
    };
    var padState = {};
    var log = [];
    var tableEntries = {};     /* line -> entry, table form, this frame */
    var staticEntries = {};    /* line -> entry, registered outside a frame */
    var inFrame = false;
    var prevLineCram = {};     /* line -> [[addr,word]], previous frame */
    var rasterContext = null;  /* {regs:{}, cram:[]} while a callback line runs */
    var frameCount = 0;
    var baseRegs = null;
    var baseCramWords = null;

    /* ---- VRAM (word addressed over the byte array the model reads) ---- */

    function vramWord(addr) {
      return state.vram[addr * 2] | (state.vram[addr * 2 + 1] << 8);
    }
    function setVramWord(addr, word) {
      state.vram[addr * 2] = word & 0xFF;
      state.vram[addr * 2 + 1] = (word >> 8) & 0xFF;
    }

    /* ---- the SAT ------------------------------------------------------ */

    function satWord(i, k) {
      var o = (i * 4 + k) * 2;
      return state.sat[o] | (state.sat[o + 1] << 8);
    }
    function setSatWord(i, k, v) {
      var o = (i * 4 + k) * 2;
      state.sat[o] = v & 0xFF;
      state.sat[o + 1] = (v >> 8) & 0xFF;
    }

    /* ---- frame bookkeeping -------------------------------------------- */

    function cramWords() {
      var words = new Array(CRAM_ENTRIES);
      for (var i = 0; i < CRAM_ENTRIES; i++) {
        words[i] = state.cram[i * 2] | (state.cram[i * 2 + 1] << 8);
      }
      return words;
    }

    function copyEntry(e) {
      var c = { line: e.line, rcr: e.rcr };
      if (e.bxr != null) c.bxr = e.bxr;
      if (e.byr != null) c.byr = e.byr;
      if (e.cr != null) c.cr = e.cr;
      if (e.cram) {
        c.cram = [];
        for (var i = 0; i < e.cram.length; i++) {
          c.cram.push([e.cram[i][0], e.cram[i][1]]);
        }
      }
      return c;
    }

    function seedEntries() {
      var out = {};
      for (var k in staticEntries) {
        if (Object.prototype.hasOwnProperty.call(staticEntries, k)) {
          out[k] = copyEntry(staticEntries[k]);
        }
      }
      return out;
    }

    function buildRasterTable(regs, cramArr) {
      var entries = [];
      for (var k in tableEntries) {
        if (Object.prototype.hasOwnProperty.call(tableEntries, k)) {
          entries.push(tableEntries[k]);
        }
      }
      if (!entries.length) { prevLineCram = {}; return null; }
      entries.sort(function (a, b) { return a.line - b.line; });
      /* The VCE persists across frames, so a row above this frame's first
       * write still shows the previous frame's value for that line. The
       * model asks for that as cramPrev (buildRows, pce-bg.js); journal it
       * from the previous frame. Without it a frame-varying table would
       * show this frame's later values on the early rows. */
      var nextPrev = {};
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].cram && entries[i].cram.length) {
          entries[i].cramPrev = prevLineCram[entries[i].line] || [];
          nextPrev[entries[i].line] = entries[i].cram;
        }
      }
      prevLineCram = nextPrev;
      return {
        base: regs,
        baseCram: cramArr,
        entries: entries
      };
    }

    var host = {
      /* the live hardware state the model reads; tests copy it */
      state: state,
      padState: padState,
      log: log,
      WIDTH: WIDTH,
      HEIGHT: HEIGHT,
      VDW_LINES: VDW_LINES,
      PAD_FIELDS: PAD_FIELDS,
      ToyError: ToyError,

      /* ---- register writes -------------------------------------------- */

      reg: function (name, v) {
        if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(ALLOWED_REGS, name)) {
          refuse("reg-forbidden", "a toy may not set " + name +
                 "; it may set BXR, BYR and CR (the toy reference, #61)");
        }
        var max = ALLOWED_REGS[name];
        v = intIn(v, name, 0, max, "reg-range");
        state.regs[name] = v;
        if (rasterContext) rasterContext.regs[name] = v;
        return v;
      },

      /* ---- the VCE colour table --------------------------------------- */

      pal: function (addr, word) {
        addr = intIn(addr, "a colour-table address", 0, CRAM_ENTRIES - 1,
                     "pal-range");
        word = intIn(word, "a colour word", 0, 0x1FF, "pal-range");
        state.cram[addr * 2] = word & 0xFF;
        state.cram[addr * 2 + 1] = (word >> 8) & 0xFF;
        if (rasterContext) {
          if (rasterContext.cram.length >= RASTER_WRITES_MAX) {
            refuse("raster-line-full", "more than " + RASTER_WRITES_MAX +
                   " colour writes on one line; the line interrupt runs once " +
                   "and the next line starts from the register");
          }
          rasterContext.cram.push([addr, word]);
        }
        return word;
      },

      /* ---- VRAM -------------------------------------------------------- */

      vramGet: function (addr) {
        addr = intIn(addr, "a VRAM word address", 0, VRAM_WORDS - 1,
                     "vram-range");
        return vramWord(addr);
      },
      vramSet: function (addr, word) {
        addr = intIn(addr, "a VRAM word address", 0, VRAM_WORDS - 1,
                     "vram-range");
        word = intIn(word, "a VRAM word", 0, 0xFFFF, "vram-range");
        setVramWord(addr, word);
        return word;
      },

      /* ---- the SAT ----------------------------------------------------- */

      satGet: function (i, k) {
        i = intIn(i, "a SAT entry", 0, SAT_ENTRIES - 1, "sat-range");
        k = intIn(k, "a SAT word (0..3)", 0, 3, "sat-range");
        return satWord(i, k);
      },
      sat: function (i, k, v) {
        i = intIn(i, "a SAT entry", 0, SAT_ENTRIES - 1, "sat-range");
        k = intIn(k, "a SAT word (0..3)", 0, 3, "sat-range");
        v = intIn(v, "a SAT word", 0, 0xFFFF, "sat-range");
        setSatWord(i, k, v);
        return v;
      },

      /* sprite(i, spec) composes the four SAT words exactly as
       * renderer/pce-sprites.js reads them (its module comment, HuC6270
       * manual 2.4): word0 = Y, word1 = X, word2 = pattern << 1,
       * word3 = palette | SPBG<<7 | CGX<<8 | HFLIP<<11 | CGY<<12 | VFLIP<<15.
       * SAT Y 64 is display row 0; SAT X 32 is display column 0.
       * `spec` is a plain object; absent fields take the API's defaults. */
      sprite: function (i, spec) {
        i = intIn(i, "a SAT entry", 0, SAT_ENTRIES - 1, "sprite-range");
        if (!spec || typeof spec !== "object") {
          refuse("sprite-range", "sprite(i, spec): spec must be a table");
        }
        var x = intIn(spec.x != null ? spec.x : 0, "x", 0, 1023, "sprite-range");
        var y = intIn(spec.y != null ? spec.y : 0, "y", 0, 1023, "sprite-range");
        var pattern = intIn(spec.pattern != null ? spec.pattern : 0,
                            "pattern", 0, 0x3FF, "sprite-range");
        var palette = intIn(spec.palette != null ? spec.palette : 0,
                            "palette", 0, 15, "sprite-range");
        var cgy = intIn(spec.cgy != null ? spec.cgy : 0,
                        "cgy", 0, 3, "sprite-range");
        var spbg = booleanOf(spec.spbg);
        var cgx = booleanOf(spec.cgx);
        var hflip = booleanOf(spec.hflip);
        var vflip = booleanOf(spec.vflip);
        setSatWord(i, 0, y);
        setSatWord(i, 1, x);
        setSatWord(i, 2, (pattern << 1) & 0xFFFF);
        setSatWord(i, 3, (palette | (spbg ? 0x80 : 0) | (cgx ? 0x100 : 0) |
                          (hflip ? 0x800 : 0) | (cgy << 12) |
                          (vflip ? 0x8000 : 0)) & 0xFFFF);
        return i;
      },

      /* ---- the raster table, the table form ---------------------------- */

      /* raster(line, spec) registers one line's entry (VDW line 0..223) from
       * inside frame(). A line gets ONE entry: the RCR interrupt fires once
       * per line, and the model's table has one write per line (buildRows,
       * last write wins), so a second registration is refused rather than
       * silently dropped. spec = {bxr=, byr=, cr=, cram=[[addr,word],...]}. */
      raster: function (line, spec) {
        line = intIn(line, "a raster line", 0, VDW_LINES - 1, "raster-line");
        if (!spec || typeof spec !== "object") {
          refuse("raster-line", "raster(line, spec): spec must be a table");
        }
        var store = inFrame ? tableEntries : staticEntries;
        if (store[line]) {
          refuse("raster-line-full", "VDW line " + line +
                 " already has a raster entry; the line interrupt fires once " +
                 "per line");
        }
        var entry = { line: line, rcr: 0x40 + line };
        var has = false;
        if (spec.bxr != null) {
          entry.bxr = intIn(spec.bxr, "bxr", 0, BXR_MAX, "reg-range");
          has = true;
        }
        if (spec.byr != null) {
          entry.byr = intIn(spec.byr, "byr", 0, BYR_MAX, "reg-range");
          has = true;
        }
        if (spec.cr != null) {
          entry.cr = intIn(spec.cr, "cr", 0, CR_MAX, "reg-range");
          has = true;
        }
        if (spec.cram != null) {
          if (!Array.isArray(spec.cram)) {
            refuse("pal-range", "cram must be a list of {addr, word}");
          }
          var n = spec.cram.length;
          if (n > RASTER_WRITES_MAX) {
            refuse("raster-line-full", n + " colour writes on one line; a " +
                   "line carries at most " + RASTER_WRITES_MAX);
          }
          var writes = [];
          for (var w = 0; w < n; w++) {
            var pair = spec.cram[w];
            if (!pair || typeof pair !== "object" || pair.length !== 2) {
              refuse("pal-range", "cram[" + (w + 1) + "] must be {addr, word}");
            }
            var addr = intIn(pair[0], "cram address", 0, CRAM_ENTRIES - 1,
                             "pal-range");
            var word = intIn(pair[1], "cram word", 0, 0x1FF, "pal-range");
            writes.push([addr, word]);
          }
          if (writes.length) { entry.cram = writes; has = true; }
        }
        if (!has) {
          refuse("raster-line", "VDW line " + line + "'s entry sets nothing " +
                 "(bxr/byr/cr/cram are all absent)");
        }
        tableEntries[line] = entry;
        store[line] = entry;
        return line;
      },

      /* ---- pads -------------------------------------------------------- */

      padValue: function (n, field) {
        if (!(n >= 1 && n <= 5) || n !== (n | 0)) return undefined;
        var p = padState[n] || {};
        return !!p[field];
      },

      refreshPads: function () { /* the pads are read live by padValue */ },

      setPad: function (n, buttons) {
        if (!(n >= 1 && n <= 5) || n !== (n | 0)) {
          refuse("pad-range", "pad number must be 1..5, got " + n);
        }
        padState[n] = buttons || {};
      },

      /* ---- the log ------------------------------------------------------ */

      logLine: function (parts) {
        if (log.length < LOG_MAX) log.push(parts.join("\t"));
      },

      /* ---- the frame ---------------------------------------------------- */

      beginFrame: function (f) {
        frameCount = f;
        tableEntries = seedEntries();
        baseRegs = null;
        baseCramWords = null;
        inFrame = true;
      },

      /* called after frame() returns: the frame's own writes are the base
       * every line starts from; the line callbacks must not move it */
      markBase: function () {
        baseRegs = { bxr: state.regs.BXR, byr: state.regs.BYR,
                     cr: state.regs.CR };
        baseCramWords = cramWords();
      },

      beginLine: function () {
        rasterContext = { regs: {}, cram: [] };
      },

      endLine: function (line) {
        var ctx = rasterContext;
        rasterContext = null;
        var any = false;
        for (var r in ctx.regs) {
          if (Object.prototype.hasOwnProperty.call(ctx.regs, r)) any = true;
        }
        if (!any && !ctx.cram.length) return;
        var entry = { line: line, rcr: 0x40 + line };
        if (ctx.regs.BXR != null) entry.bxr = ctx.regs.BXR;
        if (ctx.regs.BYR != null) entry.byr = ctx.regs.BYR;
        if (ctx.regs.CR != null) entry.cr = ctx.regs.CR;
        if (ctx.cram.length) entry.cram = ctx.cram;
        tableEntries[line] = entry;
      },

      inLine: function () { return rasterContext !== null; },

      endFrame: function () {
        inFrame = false;
        return buildRasterTable(baseRegs, baseCramWords);
      },

      /* the model's exact input, shared (no copy) — docs cannot drift */
      options: function () {
        return {
          vram: state.vram,
          cram: state.cram,
          sat: state.sat,
          regs: { BXR: state.regs.BXR, BYR: state.regs.BYR,
                  MWR: state.regs.MWR, CR: state.regs.CR,
                  RCRCount: 0, scanline: FIRST_SCANLINE },
          width: WIDTH,
          height: HEIGHT
        };
      },

      snapshot: function () {
        return {
          vram: state.vram.slice(),
          cram: state.cram.slice(),
          sat: state.sat.slice(),
          regs: { BXR: state.regs.BXR, BYR: state.regs.BYR,
                  MWR: state.regs.MWR, CR: state.regs.CR }
        };
      },

      /* The one draw: the same models the viewer and the captures prove. */
      render: function (f, raster) {
        var opts = host.options();
        if (raster) opts.raster = raster;
        var img = sprites.renderFrame(opts);
        return {
          frame: f,
          width: img.width,
          height: img.height,
          pixels: img.pixels,
          raster: raster || null,
          state: host.snapshot()
        };
      },

      frameCount: function () { return frameCount; }
    };

    return host;
  }

  return {
    createHost: createHost,
    ToyError: ToyError,
    WIDTH: WIDTH,
    HEIGHT: HEIGHT,
    VDW_LINES: VDW_LINES,
    PAD_FIELDS: PAD_FIELDS,
    REFUSALS: {
      "reg-forbidden": "a register a toy may not touch",
      "reg-range": "a register value outside the VDC register's width",
      "pal-range": "a colour-table address or word outside 0..511",
      "vram-range": "a VRAM word address outside 0..32767 or a word past $FFFF",
      "sat-range": "a SAT entry outside 0..63 or a SAT word past $FFFF",
      "sprite-range": "a sprite field outside the SAT's range",
      "raster-line": "a raster line outside VDW 0..223",
      "raster-line-full": "a second raster entry on one line, or too many colour writes on it",
      "pad-range": "a pad number outside 1..5"
    }
  };
});
