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
 * values, the pads, the raster table and, since #71, the PSG's writes). It
 * draws nothing: render() hands renderer/pce-sprites.js the exact input it
 * already takes.
 *
 * Assets (#117): options.files, when a caller passes the toy's file set, is
 * the panels' picture (tiles.json, sprites.json, palettes.json) and the
 * importer below copies it into VRAM, CRAM, the SAT and BXR/BYR/CR when the
 * host is created — before the toy's top-level statements and init() — so a
 * toy boots inside the picture the panels show.  The toy's own later writes
 * win.  The importer is IN this file, not a module a page must remember to
 * load: the host exists wherever a toy runs, so the boot step cannot be
 * missing.  It reads the files with the panels' own models
 * (renderer/pce-sat.js's pictureFromFiles, renderer/pce-editor.js's
 * toPicture), resolved when a host is created; a page that never passes files
 * never loads them.  A page that passes files without them is refused by
 * code (no-import) rather than silently skipped.
 *
 * Sound (#71): the host runs one song on renderer/pce-song.js's player, one
 * VBlank per toy frame, and lets the toy take a channel for an SFX and give
 * it back (HuTrack's reserve/release channel hand-off). Every PSG write is
 * recorded as {f, t, reg, value}, the input renderer/pce-psg.js already
 * takes; renderSound() is that model's own output. pce-song.js and
 * pce-psg.js are resolved when a host is created, not when this file loads,
 * so a page may load them in any order (renderer/studio.html loads the PSG
 * after this file).
 *
 * Refusal codes: reg-forbidden, reg-range, pal-range, vram-range, sat-range,
 * sprite-range, raster-line, raster-line-full, pad-range, music-range,
 * sfx-range, no-psg, no-import, toy-error. The front ends add their own (the
 * Lua VM adds password-*, toy-timeout; the IL lowerer adds il-*). docs/TOYS.md
 * §2 is the surface; docs/IL.md §5 is the same contract seen from the IL.
 *
 * The ranges and their manual pages are the ones docs/TOYS.md records:
 * BXR 10 bits (VDC H7-7), BYR 9 bits (H7-7), CR 8 bits (H7-5), 512 CRAM
 * entries, 32768 VRAM words, 64 SAT entries, 224 VDW display lines.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./pce-sprites.js"),
                             function () { return require("./pce-song.js"); },
                             function () { return require("./pce-psg.js"); },
                             function () { return require("./pce-editor.js"); },
                             function () { return require("./pce-sat.js"); });
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.toyhost = factory(root.PCEStudio.sprites,
      function () { return root.PCEStudio.song; },
      function () { return root.PCEStudio.psg; },
      function () { return root.PCEStudio.editor; },
      function () { return root.PCEStudio.sat; });
  }
})(typeof self !== "undefined" ? self : this, function (sprites, songDep, psgDep,
                                                        editorDep, satDep) {
  "use strict";

  var WIDTH = 256;               /* the toy frame: 32 BAT columns, 28 rows */
  var HEIGHT = 224;
  var VDW_LINES = HEIGHT;        /* VDW display lines 0..223 */
  var FIRST_SCANLINE = 18;       /* the editor's preview calibration */

  /* The registers a toy may write, with their widths and manual pages — the
   * toy author's reference (#61) generates its register table from this one
   * list, so a range changed here changes the docs.  reg() and the docs read
   * the same objects. */
  var REGISTERS = [
    { name: "BXR", max: 0x3FF, bits: 10, manual: "VDC H7-7",
      what: "background horizontal scroll, in pixels (VDC R07)" },
    { name: "BYR", max: 0x1FF, bits: 9, manual: "VDC H7-7",
      what: "background vertical scroll, in lines (VDC R08)" },
    { name: "CR", max: 0xFF, bits: 8, manual: "VDC H7-5",
      what: "control: BB background on (bit 7), SB sprites on (bit 6), and the VDC interrupt enables (RC bit 2 is the line interrupt)" }
  ];
  var CR_BG_ON = 0x80;           /* CR bit 7, BB: background on */
  var BXR_MAX = REGISTERS[0].max;
  var BYR_MAX = REGISTERS[1].max;
  var CR_MAX = REGISTERS[2].max;
  var ALLOWED_REGS = {};
  for (var r = 0; r < REGISTERS.length; r++) ALLOWED_REGS[REGISTERS[r].name] = REGISTERS[r].max;

  var VRAM_WORDS = 32768;
  var CRAM_ENTRIES = 512;
  var CRAM_WORD_MAX = 0x1FF;     /* a VCE colour: 9 bits, 3 per channel */
  var SAT_ENTRIES = 64;
  var SAT_WORDS = 4;             /* Y, X, pattern<<1, attributes (manual 2.4) */
  var SAT_FIELD_RANGES = {
    x: [0, 1023],                /* SAT word 1; 32 is display column 0 */
    y: [0, 1023],                /* SAT word 0; 64 is display row 0 */
    pattern: [0, 0x3FF],         /* written << 1 into word 2 */
    palette: [0, 15],
    cgy: [0, 3]                  /* CGY bits 12-13 */
  };
  var RASTER_WRITES_MAX = 64;    /* colour writes one line may carry */
  var RCR_BASE = 0x40;           /* RCR R06 = 0x40 + VDW line (#15) */
  var LOG_MAX = 200;
  var PAD_COUNT = 5;             /* one 2-button pad, up to five with a multitap */
  var PAD_FIELDS = ["up", "down", "left", "right", "i", "ii", "select", "run"];

  /* ---- the timer ($0C00/$0C01, card #45) -------------------------------- */

  /* The HuC6280's 7-bit interval timer.  H8-20: the reload register is 7
   * bits; a write to $1FEC00 loads it, a write to $1FEC01 bit 0 starts it,
   * and a borrow sets TIQ and reloads the downcounter.  H8-21: the prescaler
   * divides OSC1 by 3 and then by 1024, so at 21.48 MHz the tick is
   * 6.992 kHz — "a value of $00 counts as 1, $7F counts as 128" (pcetech
   * §2.2), i.e. the period is (reload + 1) ticks.
   *
   * The browser host has no sub-frame clock: a frame is 1/60 s (docs/TOYS.md)
   * and the timer runs in whole ticks of 1/6,991.3 s accumulated across
   * frames, so the long-run tick rate is the hardware's.  The console
   * runtime (tools/toyc/toy_runtime.c) gets the same interrupt rate from the
   * real TMA timer, so a toy's interrupt-per-frame figure is the same on
   * both sides up to the console's 59.826 Hz video rate. */
  var TIMER_RELOAD_MAX = 0x7F;
  var TIMER_HZ = 6991.3;         /* 7,159,090.909 Hz CPU clock / 1024 (H8-21) */
  var FRAME_HZ = 60;             /* the host's frame, docs/TOYS.md */
  var TIMER_TICKS_PER_FRAME = TIMER_HZ / FRAME_HZ;

  var TIMER_API = [
    { call: "timer(period, fn)",
      what: "starts the TMA timer: the downcounter reloads from period, counts " +
            "down once per 1024 CPU clocks (6,991.3 Hz) and, on the borrow " +
            "that sets TIQ, calls fn once and reloads; a period of 0 counts " +
            "as 1 tick and 127 as 128 (H8-20..H8-22, pcetech §2.2)",
      limits: "period 0..127; fn is called once per interrupt, at the frame " +
              "boundary, (frames elapsed × 116.5) / (period+1) times" },
    { call: "timerstop()",
      what: "stops the timer (its Start/Stop flag, $0C01 bit 0, goes to 0)",
      limits: "none" },
    { call: "timerirqs()",
      what: "the number of timer interrupts since the previous frame() — the " +
            "figure a capture's per-frame measurement reads",
      limits: "none" }
  ];

  /* ---- sound (#71) ------------------------------------------------------ */

  /* The toy's sound contract, published by the author's reference (#61) from
   * this one table: the calls and the ranges the host enforces. */
  var SOUND_CHANNELS = 6;        /* the HuC6280 PSG's voices */
  var PITCH_MAX = 0x0FFF;        /* the PSG's 12-bit frequency divider F */
  var SOUND_VOLUME_MAX = 31;     /* R4's AL field, 5 bits */
  var SFX_FRAMES_MAX = 600;      /* 10 s at 60 Hz */
  var SOUND_CYCLE_STEP = 12;     /* in-frame cycles between two writes:
                                  * pce-song.js's order-preserving default */
  var SOUND_EVENTS_MAX = 65536;  /* the recording a browser toy keeps; past
                                  * it writes are played, not recorded */
  /* The SFX waveform: 32 steps of 5 bits, a square (16 full, 16 silent).
   * The PSG holds one waveform per channel, so an SFX uploads all 32. */
  var SFX_WAVE = [];
  for (var sw = 0; sw < 32; sw++) SFX_WAVE.push(sw < 16 ? 31 : 0);

  var SOUND_API = [
    { call: "music(index)",
      what: "plays song index from the start — the whole engine restarts, " +
            "as HuTrack's playSong does",
      limits: "an index into the songs the runtime was given (0..songs-1)" },
    { call: "sfx(channel, freq, volume, frames)",
      what: "takes the channel (HuTrack's reserve), loads a 32-step square, " +
            "sets F = freq and AL = volume, and gives it back after frames",
      limits: "channel 0..5, freq 0..4095, volume 0..31, frames 1..600" },
    { call: "release(channel)",
      what: "gives a channel back now (HuTrack's release): control and noise " +
            "off, and the music waits for a fresh note on it",
      limits: "channel 0..5; a channel no SFX owns is left alone" }
  ];

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

  /* ---- the asset importer (#117) ---------------------------------------
   *
   * The picture the SCREEN, SPRITES and PALETTES panels edit, into the toy's
   * hardware.  Until #117 a toy could not read its own tiles.json /
   * sprites.json / palettes.json: the studio saved them and a toy still
   * spelled its art out as vram[]/pal() writes (toys/demo-game bridged it
   * with a Node tool that generated a Lua block).  This is the bridge, and
   * it is the panels' own readers, not a second model: pce-sat.js's
   * pictureFromFiles() (pce-screen.js's, plus sprites.json) builds the
   * picture, and pce-editor.js's toPicture() lays it out in the VDC's words.
   *
   *   VRAM  all 32768 words: the BAT at word 0, the tiles from character $40,
   *         the sprite patterns at the cells patternLayout() packs, and the
   *         SAT at $7F00 — toPicture()'s exact layout.
   *   CRAM  all 512 entries: the 16 background palettes at $000-$0FF (entry 0
   *         of each is the shared backdrop) and the sprite palettes $100-$1FF.
   *   SAT   the 64 entries copied out of VRAM $7F00, where state.sat lives.
   *   regs  BXR/BYR from tiles.json's map scroll, MWR 0 (the 32x32 BAT) and
   *         CR: BB on, plus SB when the picture has sprites — the CR
   *         toPicture()/viewRegs give the panel's preview, so a toy boots
   *         showing what the panel shows instead of a blank sprite layer.
   *
   * EMPTY FILES ARE NOT A PICTURE.  A new toy's default files carry no tiles,
   * no sprites and no palette rows; importing them would paint a blank BAT of
   * character $40 into a toy that had written nothing, so hasArt() is false
   * and apply() returns null.  The first panel edit makes them a picture.
   *
   * NOT IMPORTED: tiles.json's `video` (a VCE dot clock outside the toy
   * surface — the host's frame is fixed at 256x224, so a 336/512-dot picture
   * is imported at its words and shown on the 256-dot window), and the
   * picture's 240-line preview against the host's 224-line frame.  Both are
   * stated in docs/STUDIO.md §7.
   */

  /* The three files the panels edit.  waves.json is the PSG's (#71), not the
   * picture, and is not touched here. */
  var ASSET_FILES = ["tiles.json", "palettes.json", "sprites.json"];
  var IMPORT_SAT_WORDS = 256;    /* 64 entries x 4 words */

  var editorLib = null, satLib = null;
  function editorModule() {
    if (editorLib === null) editorLib = editorDep() || false;
    return editorLib || null;
  }
  function satModule() {
    if (satLib === null) satLib = satDep() || false;
    return satLib || null;
  }

  /* The file set as name -> text.  main.lua and waves.json are ignored. */
  function assetTexts(files) {
    var out = {};
    for (var i = 0; i < (files || []).length; i++) {
      var f = files[i];
      if (!f || ASSET_FILES.indexOf(f.name) < 0) continue;
      out[f.name] = f.source == null ? "" : String(f.source);
    }
    return out;
  }

  function parseAsset(text, name) {
    try { return JSON.parse(text); }
    catch (e) { refuse("asset-json", name + " is not JSON: " + e.message); }
  }

  /* Is there a picture in these files?  A tile, a map, a pattern, a sprite,
   * or a palette entry that is not the power-on zero.  A file the panels
   * could not read is refused here, by the panels' own parse, rather than
   * silently skipped. */
  function hasArt(files) {
    var texts = assetTexts(files), t;
    if (texts["tiles.json"] != null) {
      t = parseAsset(texts["tiles.json"], "tiles.json");
      if (Array.isArray(t.tiles) && t.tiles.length) return true;
      if (t.map && Array.isArray(t.map.cells) && t.map.cells.length) return true;
    }
    if (texts["sprites.json"] != null) {
      t = parseAsset(texts["sprites.json"], "sprites.json");
      if (Array.isArray(t.patterns) && t.patterns.length) return true;
      if (Array.isArray(t.sprites) && t.sprites.length) return true;
    }
    if (texts["palettes.json"] != null) {
      t = parseAsset(texts["palettes.json"], "palettes.json");
      if (t.backdrop) return true;
      if (Array.isArray(t.background) && t.background.length) return true;
      if (Array.isArray(t.sprites) && t.sprites.length) return true;
    }
    return false;
  }

  /* The files as the hardware would hold the picture.  null when there is no
   * art to import; `no-import` when the panels' models are not loaded. */
  function readAssets(files) {
    if (!hasArt(files)) return null;
    var editor = editorModule(), sat = satModule();
    if (!editor || !sat) {
      refuse("no-import", "this toy brings asset files, but the picture " +
             "models (renderer/pce-editor.js, renderer/pce-sat.js) are not " +
             "loaded, so the picture cannot reach VRAM");
    }
    var pic = sat.pictureFromFiles(files);
    var data = editor.toPicture(pic);
    var tiles = 0;
    for (var c = editor.FIRST_CHAR; c < pic.nextChar; c++) if (pic.tiles[c]) tiles++;
    return {
      picture: pic,
      vram: data.vram,
      cram: data.cram,
      sat: data.vram.slice(editor.SAT_ADDR * 2,
                           editor.SAT_ADDR * 2 + IMPORT_SAT_WORDS * 2),
      regs: { BXR: data.regs.BXR, BYR: data.regs.BYR,
              MWR: data.regs.MWR, CR: data.regs.CR },
      tiles: tiles,
      patterns: pic.spritePatterns.length,
      sprites: pic.sprites.length
    };
  }

  /* Copy one readAssets() into a host's live state, before the toy runs.
   * Returns a summary (the host keeps it as host.assets). */
  function applyAssets(host, files) {
    var w = readAssets(files);
    if (!w) return null;
    host.state.vram.set(w.vram);
    host.state.cram.set(w.cram);
    host.state.sat.set(w.sat);
    host.state.regs.BXR = w.regs.BXR;
    host.state.regs.BYR = w.regs.BYR;
    host.state.regs.MWR = w.regs.MWR;
    host.state.regs.CR = w.regs.CR;
    return {
      files: ASSET_FILES.slice(),
      tiles: w.tiles,
      patterns: w.patterns,
      sprites: w.sprites,
      vram: w.vram.length / 2,     /* words: 32768 */
      cram: CRAM_ENTRIES,
      sat: IMPORT_SAT_WORDS,
      regs: { BXR: w.regs.BXR, BYR: w.regs.BYR, MWR: w.regs.MWR,
              CR: w.regs.CR }
    };
  }

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
    var timer = { period: 0, running: false, acc: 0, irqs: 0, frameIrqs: 0,
                  lastFrame: -1 };

    /* ---- sound state (#71) --------------------------------------------- */

    var sound = {
      songs: options.songs || [],
      events: [],               /* {f, t, reg, value}: pce-psg.js's input */
      player: null,             /* pce-song.js's createPlayer, once music(n) runs */
      frame: 0,
      col: 0,                   /* write index within the frame */
      overflow: false,          /* the recording hit SOUND_EVENTS_MAX */
      sfx: []                   /* per channel: what the toy is playing */
    };
    for (var si = 0; si < SOUND_CHANNELS; si++) {
      sound.sfx.push({ active: false, frames: 0, freq: 0, volume: 0,
                       owned: false });
    }
    var songLib = null;
    var psgLib = null;

    function songModule() {
      if (songLib === null) songLib = songDep() || false;
      return songLib || null;
    }
    function psgModule() {
      if (psgLib === null) psgLib = psgDep() || false;
      return psgLib || null;
    }

    /* One PSG write, in the frame's order: the model's own event shape. */
    function soundWrite(reg, value) {
      if (sound.events.length >= SOUND_EVENTS_MAX) {
        sound.overflow = true;
        return;
      }
      sound.events.push({ f: sound.frame, t: sound.col * SOUND_CYCLE_STEP,
                          reg: reg, value: value & 0xff });
      sound.col++;
    }

    function ownedBySfx(ch) { return sound.sfx[ch].owned; }

    /* The two modules sound needs, resolved when a host exists: a page may
     * load them after this file (renderer/studio.html does) and a page that
     * never loads them still runs its toys, with sound refused by code. */
    function needSong() {
      var lib = songModule();
      if (!lib) {
        refuse("no-psg", "the song player (renderer/pce-song.js) is not " +
               "loaded, so a toy cannot make sound");
      }
      return lib;
    }
    function needPsg() {
      var lib = psgModule();
      if (!lib) {
        refuse("no-psg", "the PSG model (renderer/pce-psg.js) is not " +
               "loaded, so a toy cannot make sound");
      }
      return lib;
    }
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
        word = intIn(word, "a colour word", 0, CRAM_WORD_MAX, "pal-range");
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
        k = intIn(k, "a SAT word (0.." + (SAT_WORDS - 1) + ")", 0, SAT_WORDS - 1,
                 "sat-range");
        return satWord(i, k);
      },
      sat: function (i, k, v) {
        i = intIn(i, "a SAT entry", 0, SAT_ENTRIES - 1, "sat-range");
        k = intIn(k, "a SAT word (0.." + (SAT_WORDS - 1) + ")", 0, SAT_WORDS - 1,
                 "sat-range");
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
        var x = intIn(spec.x != null ? spec.x : 0, "x",
                    SAT_FIELD_RANGES.x[0], SAT_FIELD_RANGES.x[1], "sprite-range");
        var y = intIn(spec.y != null ? spec.y : 0, "y",
                    SAT_FIELD_RANGES.y[0], SAT_FIELD_RANGES.y[1], "sprite-range");
        var pattern = intIn(spec.pattern != null ? spec.pattern : 0,
                            "pattern", SAT_FIELD_RANGES.pattern[0],
                            SAT_FIELD_RANGES.pattern[1], "sprite-range");
        var palette = intIn(spec.palette != null ? spec.palette : 0,
                            "palette", SAT_FIELD_RANGES.palette[0],
                            SAT_FIELD_RANGES.palette[1], "sprite-range");
        var cgy = intIn(spec.cgy != null ? spec.cgy : 0,
                        "cgy", SAT_FIELD_RANGES.cgy[0],
                        SAT_FIELD_RANGES.cgy[1], "sprite-range");
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
        var entry = { line: line, rcr: RCR_BASE + line };
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
            var word = intIn(pair[1], "cram word", 0, CRAM_WORD_MAX, "pal-range");
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
        if (!(n >= 1 && n <= PAD_COUNT) || n !== (n | 0)) return undefined;
        var p = padState[n] || {};
        return !!p[field];
      },

      refreshPads: function () { /* the pads are read live by padValue */ },

      setPad: function (n, buttons) {
        if (!(n >= 1 && n <= PAD_COUNT) || n !== (n | 0)) {
          refuse("pad-range", "pad number must be 1..5, got " + n);
        }
        padState[n] = buttons || {};
      },

      /* ---- the timer ($0C00/$0C01) -------------------------------------- */

      /* Write the reload register and set the Start/Stop flag.  A start
       * reloads the downcounter (H8-20), so the sub-tick remainder restarts. */
      timerSet: function (period) {
        period = intIn(period, "a timer period", 0, TIMER_RELOAD_MAX,
                       "timer-range");
        timer.period = period;
        timer.running = true;
        timer.acc = 0;
        return period;
      },

      timerStop: function () {
        timer.running = false;
        timer.acc = 0;
      },

      /* Advance the downcounter to frame f and return the interrupts that
       * happened since the previous call.  Called once per frame, before the
       * toy's frame(), by both front ends. */
      tickTimer: function (f) {
        timer.frameIrqs = 0;
        if (timer.lastFrame < 0) { timer.lastFrame = f; return 0; }
        var frames = f - timer.lastFrame;
        timer.lastFrame = f;
        if (!timer.running || frames <= 0) return 0;
        timer.acc += TIMER_TICKS_PER_FRAME * frames;
        var period = timer.period + 1;
        var n = Math.floor(timer.acc / period);
        timer.acc -= n * period;
        timer.irqs += n;
        timer.frameIrqs = n;
        return n;
      },

      timerIRQs: function () { return timer.frameIrqs; },
      timerState: function () {
        return { period: timer.period, running: timer.running,
                 irqs: timer.irqs, frameIrqs: timer.frameIrqs };
      },

      /* ---- sound (#71) -------------------------------------------------- */

      /* The sound state the tests read: the recorded PSG writes, the player,
       * the SFX timers. */
      sound: sound,

      /* music(index): play a song the runtime was given.  The engine's whole
       * Reset runs again (playSong), so calling it restarts the song. */
      music: function (index) {
        var lib = needSong();
        if (!sound.songs.length) {
          refuse("music-range", "music(" + index + "): this toy runtime was " +
                 "given no song (options.songs)");
        }
        index = intIn(index, "a song index", 0, sound.songs.length - 1,
                      "music-range");
        sound.player = lib.createPlayer(sound.songs[index], {
          emit: function (reg, value) { soundWrite(reg, value); }
        });
        /* a channel an SFX already owns stays the SFX's */
        for (var ch = 0; ch < SOUND_CHANNELS; ch++)
          if (ownedBySfx(ch)) sound.player.reserve(ch);
        return index;
      },

      /* sfx(channel, freq, volume, frames): take the channel, load a square
       * and play F/AL for frames frames, then give it back. */
      sfx: function (ch, freq, volume, frames) {
        var lib = needSong();
        ch = intIn(ch, "an SFX channel", 0, SOUND_CHANNELS - 1, "sfx-range");
        freq = intIn(freq, "an SFX frequency", 0, PITCH_MAX, "sfx-range");
        volume = intIn(volume, "an SFX volume", 0, SOUND_VOLUME_MAX,
                       "sfx-range");
        frames = intIn(frames, "an SFX length in frames", 1, SFX_FRAMES_MAX,
                       "sfx-range");
        if (!sound.sfx[ch].owned) {
          sound.sfx[ch].owned = true;
          if (sound.player) sound.player.reserve(ch);
          else lib.reserveWrites(ch, soundWrite);
        }
        var s = sound.sfx[ch];
        s.active = true;
        s.frames = frames;
        s.freq = freq;
        s.volume = volume;
        /* .copy.wave's shape: wave off ($40 -> $00) resets the PSG's 32-step
         * pointer, the 32 R6 writes fill it, then F and control start it in
         * WAVEFORM mode ($80 | AL, bit 7 the channel enable, bit 6 clear).
         * $40 | volume is DDA mode with the channel off: the chip holds one
         * level and the 32 steps are never clocked.  Reserve has already set
         * the balance to both sides full. */
        soundWrite(0, ch);
        soundWrite(4, 0x40);
        soundWrite(4, 0x00);
        for (var i = 0; i < 32; i++) soundWrite(6, SFX_WAVE[i]);
        soundWrite(0, ch);
        soundWrite(2, freq & 0xff);
        soundWrite(3, (freq >> 8) & 0x0f);
        soundWrite(4, 0x80 | volume);
        return ch;
      },

      /* release(channel): give it back now.  Repeated release is harmless
       * (the engine tests inProgress first), and a channel no SFX owns is
       * left alone rather than silenced. */
      release: function (ch) {
        ch = intIn(ch, "an SFX channel", 0, SOUND_CHANNELS - 1, "sfx-range");
        if (!sound.sfx[ch].owned) return ch;
        sound.sfx[ch].owned = false;
        sound.sfx[ch].active = false;
        sound.sfx[ch].frames = 0;
        if (sound.player) sound.player.release(ch);
        else needSong().releaseWrites(ch, soundWrite);
        return ch;
      },

      /* Once per frame, before the toy's frame(): an SFX that has run its
       * frames gives the channel back, then the song ticks one VBlank. */
      tickSound: function (f) {
        /* a song started in init() (frame 0) keeps its writes in frame 0's
         * order: the Reset then the first VBlank, not two columns
         * overlapping at t = 0 */
        if (f !== sound.frame) { sound.frame = f; sound.col = 0; }
        for (var ch = 0; ch < SOUND_CHANNELS; ch++) {
          if (!sound.sfx[ch].active) continue;
          sound.sfx[ch].frames--;
          if (sound.sfx[ch].frames <= 0) host.release(ch);
        }
        if (sound.player) sound.player.step();
      },

      /* The PSG model's output for the writes so far — the same model that
       * is proven against Mednafen (#34). */
      renderSound: function (count) {
        var p = needPsg();
        var s = needSong();
        if (count == null) count = frameCount + 1;
        return p.render(sound.events, s.FRAME_CYCLES, count);
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
        /* the song's VBlank and the SFX timers run before the toy's frame() */
        host.tickSound(f);
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
        var entry = { line: line, rcr: RCR_BASE + line };
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

    /* The toy's asset files (#117), if the caller brought them: the panels'
     * picture into VRAM/CRAM/SAT and the config registers, before the toy's
     * top-level code and init() run.  host.assets is the import's summary, or
     * null when the files hold no picture (a new toy's empty defaults). */
    if (options.files && options.files.length) {
      host.assets = applyAssets(host, options.files);
    }

    return host;
  }

  return {
    createHost: createHost,
    /* the asset importer (#117): read the panels' files as the hardware's
     * words; createHost applies the same thing to options.files */
    importer: {
      FILES: ASSET_FILES,
      fileTexts: assetTexts,
      hasArt: hasArt,
      read: readAssets,
      apply: applyAssets
    },
    ToyError: ToyError,
    WIDTH: WIDTH,
    HEIGHT: HEIGHT,
    VDW_LINES: VDW_LINES,
    /* the contract's own tables, for the toy author's reference (#61) */
    REGISTERS: REGISTERS,
    ALLOWED_REGS: ALLOWED_REGS,
    CRAM_ENTRIES: CRAM_ENTRIES,
    CRAM_WORD_MAX: CRAM_WORD_MAX,
    VRAM_WORDS: VRAM_WORDS,
    SAT_ENTRIES: SAT_ENTRIES,
    SAT_WORDS: SAT_WORDS,
    SAT_FIELD_RANGES: SAT_FIELD_RANGES,
    RASTER_WRITES_MAX: RASTER_WRITES_MAX,
    RCR_BASE: RCR_BASE,
    LOG_MAX: LOG_MAX,
    PAD_COUNT: PAD_COUNT,
    PAD_FIELDS: PAD_FIELDS,
    /* the timer contract (#45), for the author's reference (#61) */
    TIMER_RELOAD_MAX: TIMER_RELOAD_MAX,
    TIMER_HZ: TIMER_HZ,
    FRAME_HZ: FRAME_HZ,
    TIMER_TICKS_PER_FRAME: TIMER_TICKS_PER_FRAME,
    TIMER_API: TIMER_API,
    /* the sound contract (#71), for the author's reference (#61) */
    SOUND_CHANNELS: SOUND_CHANNELS,
    PITCH_MAX: PITCH_MAX,
    SOUND_VOLUME_MAX: SOUND_VOLUME_MAX,
    SFX_FRAMES_MAX: SFX_FRAMES_MAX,
    SOUND_CYCLE_STEP: SOUND_CYCLE_STEP,
    SOUND_EVENTS_MAX: SOUND_EVENTS_MAX,
    SFX_WAVE: SFX_WAVE,
    SOUND_API: SOUND_API,
    REFUSALS: {
      "reg-forbidden": "a register a toy may not touch",
      "reg-range": "a register value outside the VDC register's width",
      "pal-range": "a colour-table address or word outside 0..511",
      "vram-range": "a VRAM word address outside 0..32767 or a word past $FFFF",
      "sat-range": "a SAT entry outside 0..63 or a SAT word past $FFFF",
      "sprite-range": "a sprite field outside the SAT's range",
      "raster-line": "a raster line outside VDW 0..223",
      "raster-line-full": "a second raster entry on one line, or too many colour writes on it",
      "pad-range": "a pad number outside 1..5",
      "timer-range": "a timer reload value outside 0..127",
      "music-range": "a song index outside the songs the runtime was given",
      "sfx-range": "an SFX channel, frequency, volume or length outside its range",
      "no-psg": "the PSG model or the song player is not loaded, so no toy can make sound",
      "asset-json": "a tile, sprite or palette file the importer reads is not JSON",
      "no-import": "the toy brings asset files and the picture models (renderer/pce-editor.js, renderer/pce-sat.js) are not loaded"
    }
  };
});
