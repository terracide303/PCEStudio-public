/*
 * pce-validate.js — the toy validator (card #32).
 *
 * Runs a toy's IL (renderer/pce-il.js) through the reference interpreter with
 * one observer per executed instruction (options.onOp) and prices what it
 * does, the way ppu.toys' author analyses his IL rather than the Lua or the
 * machine code:
 *
 *   frame time      cycles of frame() and of every raster(line) call, priced
 *                   per IL op (OP_CYCLES).  A 60 Hz frame is 119,318 CPU
 *                   clocks; a toy over that is reported with its rate, and
 *                   one over HARD_FRAMES frames is refused.  #184: the frame
 *                   is sampled from the studio's default 300-frame
 *                   performance (Length, renderer/studio.html), not the last
 *                   of the caller's probe, when the probe's frame is over the
 *                   ceiling — a long startup/build is not the toy's animation.
 *   sprites/line    renderer/pce-sprites.js status() — #50's model: 16-px
 *                   strips, 16 per line (256 px), the rest dropped, OR.
 *   VRAM            the highest VRAM word written, and every sprite's
 *                   pattern cell, against 32,768 words.
 *   ROM             an estimate of the compiled image from the IL's op
 *                   counts (OP_BYTES + a runtime baseline), against the
 *                   HuCard's 1 MB (docs/ROM_LAYOUT.md, #57).
 *   the blank       each raster table entry's replay cost against part C's
 *                   ~123-cycle horizontal-blank budget (docs/IL.md §10.2):
 *                   handler entry to the first register write 64 cycles,
 *                   +35 a second register, ~36 a colour word.
 *   value ranges    constant operands (reg/pal/vset/sat/raster) against the
 *                   host's own tables, plus the host's run-time refusals by
 *                   code (reg-range, pal-range, ...).
 *
 * A report is data: { ok, code, problems[], budgets }.  problems carry
 * severity "error" or "warn"; ok is false only for an error, and the export
 * (tools/toyc/emit.js) refuses a toy whose report has one.
 *
 * Where the cycle numbers come from — this is the part to read before
 * believing a budget:
 *
 *   - The per-op table below is the HuC6280 Software Manual's timings
 *     (S8-16..S8-108: immediate 2, zp 4, (zp),Y 7, abs 5, branches 2/4;
 *     docs/MANUALS.md §6 has the transcription) applied to the C
 *     statement renderer/pce-cgen.js emits for each op, whose 32-bit values
 *     live in zero-page cells.  The table gives the *relative* weights.
 *   - Its absolute scale and the fixed cost of one compiled hook call
 *     (HOOK_CYCLES = 1,156) are calibrated once against the two TMA-timer
 *     measurements of #31: part A's palette toy frame (7,417 cycles,
 *     docs/IL.md §9.2) and part C's parallax frame() (1,204 cycles, §10.3).
 *   - The parallax *raster* call was NOT used in the calibration.  It is the
 *     model's held-out prediction: 1,399 cycles against part C's measured
 *     1,510 (−7.4%).  TOLERANCE is 15%, and tests/check-validate.js asserts
 *     the prediction inside it.
 *
 * Rule 2: this file and its test were written by @design; a cold break by
 * another seat is owed before the card closes.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./pce-il.js"),
                             require("./pce-sprites.js"),
                             require("./pce-toyhost.js"));
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.validate = factory(root.PCEStudio.il,
                                      root.PCEStudio.sprites,
                                      root.PCEStudio.toyhost);
  }
})(typeof self !== "undefined" ? self : this, function (il, sprites, toyhost) {
  "use strict";

  var WIDTH = toyhost.WIDTH;                 /* 256 */
  var HEIGHT = toyhost.HEIGHT;               /* 224 */
  var VDW_LINES = toyhost.VDW_LINES;
  var FRAME_CLOCKS = 119318;                 /* 7.15909 MHz / 60, docs/MANUALS.md */
  var HARD_FRAMES = 8;                       /* a toy frame must finish in 8 */
  /* #184: the probe's frame count is not the ceiling.  If the requested run's
   * last frame is over HARD_FRAMES, the validator runs on to the studio's
   * default performance length (Length 300 frames, renderer/studio.html and
   * #144) before refusing: the sampled frame of a toy that draws its assets
   * over a long startup is a BUILD frame, not the toy's animation.  DUSK RUN
   * builds for 137 frames and its 8th is the seventh.  A toy whose frame is
   * over the ceiling in its steady state is still refused, with the same
   * finding and numbers (tests/check-validate.js V07). */
  var PERFORMANCE_FRAMES = 300;              /* the studio's default Length */
  var ROM_LIMIT = 1048576;                   /* the HuCard's 1 MB, #57 */
  var ROM_RUNTIME_BYTES = 6200;              /* part A/C's image without the toy */
  var TOLERANCE = 0.15;                      /* the stated model tolerance */
  var RCR_BLANK = 123;                       /* part C §10.2, from the match */
  var RCR_HEAD = 29;                         /* saves 9 + status/dispatch 20 */
  var RCR_REG = 35;                          /* one VDC register write */
  var RCR_COLOUR = 36;                       /* one VCE colour word */
  var RCR_MAX_COLOURS = 2;                   /* part C's handler carries two */

  /* The number every raster budget is made of, exported so a panel that
   * shows a band's share of the blank and this file that refuses a line
   * cannot disagree (#92). */
  function replayCost(registers, colours) {
    return RCR_HEAD + RCR_REG * registers + RCR_COLOUR * colours;
  }

  var RCR = { BLANK: RCR_BLANK, HEAD: RCR_HEAD, REG: RCR_REG,
              COLOUR: RCR_COLOUR, MAX_COLOURS: RCR_MAX_COLOURS };

  /* ---- cycles per executed IL op -------------------------------------- */
  /* The shape is the timings table; the scale is the calibration described
   * in the header.  Values are whole cycles. */
  var OP_CYCLES = {
    "const": 6, "move": 13, "inttofixed": 8, "getglobal": 14,
    "setglobal": 14, "getbuiltin": 8, "table": 16, "tset": 16,
    "setlist": 24, "arith": 24, "mul": 48, "mod": 64, "div": 48,
    "unm": 12, "bnot": 8, "not": 4, "cmp": 19, "br": 3, "jmp": 1,
    "call": 48, "ret": 3, "closure": 18, "getupval": 18, "setupval": 8,
    "forprep": 24, "fornext": 48, "reg": 24, "pal": 28, "sat": 24,
    "sprite": 28, "raster": 24, "print": 24, "vget": 28, "vset": 28,
    "padref": 8, "padget": 8, "builtin": 36,
    /* #71: sound, priced where the other host calls are — the box's own
     * budget is #88's question, not this estimate's */
    "music": 64, "sfx": 64, "release": 24
  };
  /* arith's op chooses the row (`mul`, `mod`, `div` are the expensive ones) */
  /* ---- bytes per static IL op, for the ROM estimate -------------------- */
  /* A single scale fitted to the 13 IL functions whose linked sizes are
   * committed in tools/gen/toypalette.json and toyparallax.json: the whole
   * toy estimate is within ~12% (palette) and ~3% (parallax); one function
   * can be off by 2x, so this is an estimate and the built ROM's measured
   * size stays the authority. */
  var OP_BYTES = {
    "const": 6, "move": 11, "inttofixed": 15, "getglobal": 9,
    "setglobal": 11, "getbuiltin": 6, "table": 15, "tset": 18,
    "setlist": 30, "arith": 27, "mul": 45, "mod": 68, "div": 68,
    "unm": 15, "bnot": 12, "not": 8, "cmp": 18, "br": 5, "jmp": 3,
    "call": 15, "ret": 3, "closure": 23, "getupval": 9, "setupval": 6,
    "forprep": 20, "fornext": 36, "reg": 12, "pal": 14, "sat": 15,
    "sprite": 18, "raster": 18, "print": 15, "vget": 14, "vset": 14,
    "padref": 8, "padget": 8, "builtin": 17, "function": 10,
    "music": 12, "sfx": 20, "release": 9
  };
  var MODIFIER_OPS = { "mul": true, "mod": true, "div": true };

  var HOOK_CYCLES = 1156;                    /* one compiled hook call */

  /* ---- route 1: the IL interpreter on the console (#115) ----------------
   * The studio's Export button builds route 1 (renderer/pce-ilbc.js +
   * renderer/ilvm.bin), not the compiled route this table prices.  Two
   * calibrated toys give the interpreter's cost against this file's own
   * estimates, both measured by tools/capture-ilvm.sh and recorded in
   * docs/IL.md §14.5:
   *
   *   tools/toys/palette.lua  238,988 cycles / 7,445   = 32.10x (no raster)
   *   toys/parallax.lua     8,157,505 cycles / 314,443 = 25.94x (raster)
   *
   * #169 (docs/ROM_SPEED.md) re-measured both captures and found the two
   * numbers above biased: the palette frame() is 281,382 cycles (2.36 video
   * frames), so the no-raster factor should be 37.8 (this file
   * underestimates by ~20 %); the parallax collection is 4,475,066 cycles and
   * its raster call 19,782, so the raster factor should be 14.2 (this file
   * overestimates by 1.8x, and by 3.5x on the held-out status-bar).  The
   * constants are unchanged here on purpose: recalibrating them changes the
   * studio's projection, which #169 does not do.
   *
   * The factor is measured/estimate, not measured/measured, so applying it
   * to this model's collection for another toy projects the same way.  The
   * two shapes differ because a raster collection is 224 interpreter calls
   * (fixed call cost) rather than a long run of opcodes.  The status-bar
   * capture (#115) is held out: STATUS_MEASURED is its pre-#169 figure,
   * 3,763,919, against which the 275,268 estimate projected at 25.94
   * (7,140,000) is 1.9x; #169's re-capture measured 1,994,069, so against
   * the real number the same projection is 3.5x.  Directionally both say
   * "not 60 Hz", and the overestimate is conservative for that question.
   * This is a static estimate, labelled as one wherever it is shown. */
  var ROUTE1 = {
    NO_RASTER: 32.10,
    RASTER: 25.94,
    PALETTE_ESTIMATE: 7445,
    PALETTE_MEASURED: 238988,
    PARALLAX_ESTIMATE: 314443,
    PARALLAX_MEASURED: 8157505,
    STATUS_ESTIMATE: 275268,
    STATUS_MEASURED: 3763919,
    NOTE: "route 1 (the IL interpreter in renderer/ilvm.bin) measured on " +
          "Mednafen by tools/capture-ilvm.sh; docs/IL.md §14.5"
  };

  function cyclesOf(ins) {
    var t = ins.t;
    if (t === "arith" && MODIFIER_OPS[ins.op]) return OP_CYCLES[ins.op];
    if (t === "arith") return OP_CYCLES.arith;
    return OP_CYCLES[t] != null ? OP_CYCLES[t] : 24;
  }
  function bytesOf(ins) {
    var t = ins.t;
    if (t === "arith" && MODIFIER_OPS[ins.op]) return OP_BYTES[ins.op];
    if (t === "arith") return OP_BYTES.arith;
    return OP_BYTES[t] != null ? OP_BYTES[t] : 12;
  }

  /* ---- refusal/report objects ----------------------------------------- */

  function finding(severity, code, message, line) {
    return { severity: severity, code: code, message: message,
             line: line == null ? null : line };
  }

  function constantOf(operand) {
    if (operand && operand.k && operand.k.t === "int") return operand.k.v;
    return null;
  }

  function inRange(v, lo, hi) { return v >= lo && v <= hi; }

  /* ---- static analysis: value ranges and the ROM estimate -------------- */
  function staticProblems(program) {
    var problems = [];
    var bytes = ROM_RUNTIME_BYTES;
    var regs = toyhost.ALLOWED_REGS;
    var i, j;
    for (i = 0; i < program.functions.length; i++) {
      var fn = program.functions[i];
      bytes += OP_BYTES.function;
      for (j = 0; j < fn.code.length; j++) {
        var ins = fn.code[j];
        bytes += bytesOf(ins);
        var where = "line " + ins.line + ": ";
        var v;
        switch (ins.t) {
        case "reg":
          if (!Object.prototype.hasOwnProperty.call(regs, ins.name)) {
            problems.push(finding("error", "validate-range", where +
              "reg(\"" + ins.name + "\") is not a toy register (BXR, BYR, CR)"));
            break;
          }
          v = constantOf(ins.value);
          if (v != null && !inRange(v, 0, regs[ins.name])) {
            problems.push(finding("error", "validate-range", where +
              "reg(\"" + ins.name + "\", " + v + ") is outside 0.." +
              regs[ins.name]));
          }
          break;
        case "pal":
          v = constantOf(ins.addr);
          if (v != null && !inRange(v, 0, toyhost.CRAM_ENTRIES - 1)) {
            problems.push(finding("error", "validate-range", where +
              "pal address " + v + " is outside 0.." +
              (toyhost.CRAM_ENTRIES - 1)));
          }
          v = constantOf(ins.word);
          if (v != null && !inRange(v, 0, toyhost.CRAM_WORD_MAX)) {
            problems.push(finding("error", "validate-range", where +
              "colour word " + v + " is outside 0.." + toyhost.CRAM_WORD_MAX));
          }
          break;
        case "vset":
        case "vget":
          v = constantOf(ins.addr);
          if (v != null && !inRange(v, 0, toyhost.VRAM_WORDS - 1)) {
            problems.push(finding("error", "validate-range", where +
              "VRAM address " + v + " is outside 0.." +
              (toyhost.VRAM_WORDS - 1)));
          }
          if (ins.t === "vset") {
            v = constantOf(ins.word);
            if (v != null && !inRange(v, 0, 0xFFFF)) {
              problems.push(finding("error", "validate-range", where +
                "VRAM word " + v + " is outside 0..65535"));
            }
          }
          break;
        case "sat":
          v = constantOf(ins.i);
          if (v != null && !inRange(v, 0, toyhost.SAT_ENTRIES - 1)) {
            problems.push(finding("error", "validate-range", where +
              "SAT entry " + v + " is outside 0.." +
              (toyhost.SAT_ENTRIES - 1)));
          }
          v = constantOf(ins.k);
          if (v != null && !inRange(v, 0, toyhost.SAT_WORDS - 1)) {
            problems.push(finding("error", "validate-range", where +
              "SAT word " + v + " is outside 0.." + (toyhost.SAT_WORDS - 1)));
          }
          break;
        case "sprite":
          v = constantOf(ins.i);
          if (v != null && !inRange(v, 0, toyhost.SAT_ENTRIES - 1)) {
            problems.push(finding("error", "validate-range", where +
              "sprite entry " + v + " is outside 0.." +
              (toyhost.SAT_ENTRIES - 1)));
          }
          break;
        case "raster":
          v = constantOf(ins.lineArg);
          if (v != null && !inRange(v, 0, VDW_LINES - 1)) {
            problems.push(finding("error", "validate-range", where +
              "raster line " + v + " is outside 0.." + (VDW_LINES - 1)));
          }
          break;
        default:
          break;
        }
      }
    }
    return { problems: problems, romBytes: bytes };
  }

  /* ---- the sprite budget (#50's model) --------------------------------- */
  function spriteBudget(host) {
    /* The search only runs when the sprite layer is enabled (CR bit 6) or an
     * overflow/collision interrupt is on (bits 0/1).  A toy that forgot SB
     * would hide a 17-sprite line from the validator, so the check forces SB
     * on: the SAT is what the line would draw with sprites enabled. */
    var opts = host.options();
    opts.regs.CR = (opts.regs.CR | 0x40) & 0xFF;
    opts.regs.RCRCount = 0;
    opts.regs.scanline = 18;
    opts.height = HEIGHT;
    opts.width = WIDTH;
    var st = sprites.status(opts);
    var worst = { line: 0, strips: 0, requested: 0, dropped: 0, sprites: 0 };
    var over = [];
    for (var r = 0; r < st.lines.length; r++) {
      var ln = st.lines[r];
      if (ln.requested > worst.requested) {
        worst = { line: ln.line, strips: ln.strips, requested: ln.requested,
                  dropped: ln.dropped, sprites: ln.sprites };
      }
      if (ln.OR) over.push(ln.line);
    }
    return { worst: worst, overflowLines: over, OR: st.frame.OR };
  }

  /* ---- the VRAM budget -------------------------------------------------- */
  function vramBudget(host, maxWord) {
    var sat = host.state.sat;
    var problems = [];
    var maxSpriteWord = -1;
    for (var i = 0; i < toyhost.SAT_ENTRIES; i++) {
      var w2 = sat[i * 8 + 4] | (sat[i * 8 + 5] << 8);
      var w3 = sat[i * 8 + 6] | (sat[i * 8 + 7] << 8);
      var pattern = (w2 >> 1) & 0x3FF;
      var cgy = (w3 >> 12) & 3;
      var cgx = (w3 >> 8) & 1;
      var base = cgy === 3 ? (pattern & ~6) : cgy === 1 ? (pattern & ~2)
               : pattern;
      var last = base + (cgy === 3 ? 6 : cgy === 1 ? 2 : cgx ? 1 : 0);
      var word = last * 64 + 63;
      if (word > maxSpriteWord) maxSpriteWord = word;
      if (word > toyhost.VRAM_WORDS - 1) {
        problems.push(finding("error", "validate-vram",
          "SAT entry " + i + " reads pattern cell " + last +
          " (VRAM words " + (last * 64) + ".." + word +
          "), past the VDC's " + toyhost.VRAM_WORDS + " words"));
      }
    }
    return { maxWord: maxWord, maxSpriteWord: maxSpriteWord,
             problems: problems };
  }

  /* ---- the raster table's replay cost (part C's handler) --------------- */
  function blankBudget(raster) {
    var lines = [];
    var over = [];
    var coloursOver = [];
    if (raster && raster.entries) {
      for (var i = 0; i < raster.entries.length; i++) {
        var e = raster.entries[i];
        var regs = (e.bxr != null ? 1 : 0) + (e.byr != null ? 1 : 0) +
                   (e.cr != null ? 1 : 0);
        var colours = e.cram ? e.cram.length : 0;
        var cost = replayCost(regs, colours);
        lines.push({ line: e.line, registers: regs, colours: colours,
                     cycles: cost });
        if (cost > RCR_BLANK) over.push({ line: e.line, cycles: cost });
        if (colours > RCR_MAX_COLOURS)
          coloursOver.push({ line: e.line, colours: colours });
      }
    }
    var worst = null;
    for (var k = 0; k < lines.length; k++) {
      if (!worst || lines[k].cycles > worst.cycles) worst = lines[k];
    }
    return { lines: lines, worst: worst, over: over,
             coloursOver: coloursOver };
  }

  /* ---- the run ---------------------------------------------------------- */

  /* Run the toy for `frames` frames through the IL interpreter, counting the
   * cycles of frame() and of every raster(line) call.  Returns the report's
   * dynamic part; compile/run refusals come back as a problem with the
   * raising code. */
  function runBudgets(program, options) {
    var frames = options.frames || 8;
    var problems = [];
    /* the host needs the songs the toy was written for: music(0) without
     * them is a real run-time refusal (music-range), not a budget */
    var host = toyhost.createHost({ songs: options.songs || [] });
    var frameFid = program.hooks.frame;
    var rasterFid = program.hooks.raster;
    var maxVram = -1;
    var maxCram = -1;
    var vramWrites = 0;
    var vsetFromRaster = [];
    var active = null;
    var frameCycles = 0;
    var rasterCalls = [];
    var frameSums = [];
    var rasterSums = [];
    var origVramSet = host.vramSet;

    host.vramSet = function (addr, word) {
      var r = origVramSet.call(host, addr, word);
      maxVram = Math.max(maxVram, addr);
      vramWrites++;
      return r;
    };
    var origPal = host.pal;
    host.pal = function (addr, word) {
      var r = origPal.call(host, addr, word);
      maxCram = Math.max(maxCram, addr);
      return r;
    };

    var runtime = il.runProgram(program, host, {
      maxInstructions: options.maxInstructions || 20000000,
      onOp: function (fid, ins) {
        if (fid === frameFid && active !== "frame") {
          active = "frame";
          frameCycles += HOOK_CYCLES;      /* one compiled hook call */
        } else if (fid === rasterFid && active !== "raster") {
          active = "raster";
          rasterCalls.push(HOOK_CYCLES);   /* one compiled hook call */
        }
        var c = cyclesOf(ins);
        if (active === "frame") {
          frameCycles += c;
        } else if (active === "raster") {
          rasterCalls[rasterCalls.length - 1] += c;
          if (ins.t === "vset") {
            vsetFromRaster.push(ins.line);
          }
        }
        if (ins.t === "ret" && (fid === frameFid || fid === rasterFid)) {
          active = null;
        }
      }
    });

    try {
      runtime.load();
      for (var f = 0; f < frames; f++) {
        frameCycles = 0;
        rasterCalls = [];
        runtime.frame(f);
        frameSums.push(frameCycles);
        rasterSums.push(rasterCalls.slice());
      }
    } catch (e) {
      problems.push(finding("error", e.code || "toy-error",
        String(e && e.message || e)));
      var lastRun = frameSums.length - 1;
      return { problems: problems, host: host, runtime: runtime,
               maxVram: maxVram, maxCram: maxCram,
               frameSums: frameSums, rasterSums: rasterSums,
               sampledFrame: lastRun,
               sampledFrameCycles: lastRun >= 0 ? frameSums[lastRun] : 0,
               sampledRaster: lastRun >= 0 ? rasterSums[lastRun] : [] };
    }

    /* #184: the frame the budget is judged on.  It starts as the probe's
     * last frame; when that frame is over the ceiling the run continues to
     * PERFORMANCE_FRAMES, because an over-budget sample may be a startup
     * frame (DUSK RUN's build) rather than the toy's animation.  The
     * extension is best effort: a frame that throws (toy-timeout, a toy
     * error) ends it, and the last frame that did run is the sample. */
    var sampledFrame = frames - 1;
    var sampledFrameCycles = frameSums[sampledFrame] || 0;
    var sampledRaster = rasterSums[sampledFrame] || [];
    function collectionAt(k) {
      var list = rasterSums[k] || [];
      var sum = frameSums[k] || 0;
      for (var q = 0; q < list.length; q++) sum += list[q];
      return sum;
    }
    if (frames < PERFORMANCE_FRAMES &&
        collectionAt(sampledFrame) > HARD_FRAMES * FRAME_CLOCKS) {
      for (var more = frames; more < PERFORMANCE_FRAMES; more++) {
        frameCycles = 0;
        rasterCalls = [];
        try {
          runtime.frame(more);
        } catch (e) {
          break;
        }
        sampledFrame = more;
        sampledFrameCycles = frameCycles;
        sampledRaster = rasterCalls.slice();
      }
    }

    return { problems: problems, host: host, runtime: runtime,
             maxVram: maxVram, maxCram: maxCram,
             frameSums: frameSums, rasterSums: rasterSums,
             sampledFrame: sampledFrame,
             sampledFrameCycles: sampledFrameCycles,
             sampledRaster: sampledRaster,
             vsetFromRaster: vsetFromRaster };
  }

  /* ---- validate --------------------------------------------------------- */

  /* source (Lua text) -> report.  options: frames, chunkName, tolerance,
   * songs (the list music(index) may play, as the runtime's create() takes). */
  function validate(source, options) {
    options = options || {};
    var program;
    try {
      program = il.compile(source, { chunkName: options.chunkName || "@toy.lua" });
    } catch (e) {
      return emptyReport([finding("error", e.code || "il-syntax",
        String(e && e.message || e))]);
    }
    return validateProgram(program, options);
  }

  /* A compiled IL program -> report (the export's entry, so a caller that
   * already compiled does not compile twice). */
  function validateProgram(program, options) {
    options = options || {};
    var problems = [];
    var stat = staticProblems(program);
    problems = problems.concat(stat.problems);

    var run = runBudgets(program, options);
    problems = problems.concat(run.problems);
    if (run.problems.length && run.problems[0].severity === "error" &&
        run.frameSums.length === 0) {
      /* the toy never ran a frame: report the refusal and what is known */
      return finishReport(program, problems, null);
    }

    /* frame time: frame() plus the 224 raster() calls of the sampled frame.
     * #184: the sample is the run's last frame, extended to the studio's
     * default performance when the probe's frame is over the ceiling. */
    var lastRaster = run.sampledRaster || [];
    var rasterTotal = 0;
    for (var i = 0; i < lastRaster.length; i++) rasterTotal += lastRaster[i];
    var lastFrame = run.sampledFrameCycles || 0;
    var collection = lastFrame + rasterTotal;
    var rasterMean = lastRaster.length ? rasterTotal / lastRaster.length : 0;
    var rasterWorst = 0;
    for (i = 0; i < lastRaster.length; i++) {
      if (lastRaster[i] > rasterWorst) rasterWorst = lastRaster[i];
    }
    if (collection > HARD_FRAMES * FRAME_CLOCKS) {
      problems.push(finding("error", "validate-frame-budget",
        "frame() and its " + lastRaster.length + " raster() calls cost " +
        collection + " cycles, over the " + HARD_FRAMES +
        "-display-frame ceiling (" + (HARD_FRAMES * FRAME_CLOCKS) +
        " cycles); this toy cannot animate on the console"));
    } else if (collection > FRAME_CLOCKS) {
      problems.push(finding("warn", "validate-slow-frame",
        "one toy frame costs " + collection + " cycles (" +
        (collection / FRAME_CLOCKS).toFixed(2) + " of a 60 Hz frame, " +
        (60 * FRAME_CLOCKS / collection).toFixed(1) + " Hz)"));
    }

    /* sprites per line and the 256-px rule */
    var spr = spriteBudget(run.host);
    if (spr.overflowLines.length) {
      problems.push(finding("error", "validate-sprite-line",
        spr.overflowLines.length + " line(s) ask for more than 16 16-px " +
        "strips (256 px); the first is VDW line " + spr.overflowLines[0] +
        ", worst request " + spr.worst.requested + " strips (" +
        (spr.worst.requested * 16) + " px), " + spr.worst.dropped +
        " dropped"));
    }

    /* VRAM */
    var vram = vramBudget(run.host, run.maxVram);
    problems = problems.concat(vram.problems);
    if (run.maxVram > toyhost.VRAM_WORDS - 1) {
      problems.push(finding("error", "validate-vram",
        "a VRAM write reached word " + run.maxVram + ", past the VDC's " +
        toyhost.VRAM_WORDS + " words"));
    }

    /* ROM */
    if (stat.romBytes > ROM_LIMIT) {
      problems.push(finding("error", "validate-rom",
        "the estimated ROM is " + stat.romBytes + " bytes (" +
        Math.ceil(stat.romBytes / 8192) + " x 8 KiB banks), past the " +
        "HuCard's " + ROM_LIMIT + " bytes"));
    }

    /* the blank */
    var blank = blankBudget(run.runtime.lastRaster);
    if (blank.over.length) {
      var worstOver = blank.over[0];
      for (i = 1; i < blank.over.length; i++) {
        if (blank.over[i].cycles > worstOver.cycles) worstOver = blank.over[i];
      }
      problems.push(finding("warn", "validate-raster-blank",
        blank.over.length + " raster line(s) cost more than part C's " +
        RCR_BLANK + "-cycle horizontal blank; the worst is VDW line " +
        worstOver.line + " at " + worstOver.cycles + " cycles from " +
        "handler entry (part C's handler fits two register writes, not a " +
        "register and a colour word; docs/IL.md §10.2)"));
    }
    for (i = 0; i < blank.coloursOver.length; i++) {
      problems.push(finding("error", "validate-raster-line",
        "VDW line " + blank.coloursOver[i].line + " asks for " +
        blank.coloursOver[i].colours + " colour words; part C's replay " +
        "handler carries at most 2"));
    }
    if (run.vsetFromRaster && run.vsetFromRaster.length) {
      problems.push(finding("error", "validate-raster-line",
        "a raster() callback writes VRAM (line " +
        run.vsetFromRaster[0] + "); VRAM is fetched as the line draws and " +
        "part C's replay cannot apply it"));
    }

    /* #115: the same toy through route 1, the interpreter the Export button
     * builds.  Per toy, because the collection is this toy's; the factor is
     * the measured one for the toy's hook shape. */
    var route1Factor = lastRaster.length ? ROUTE1.RASTER : ROUTE1.NO_RASTER;
    var route1Collection = Math.round(collection * route1Factor);
    var route1 = {
      shape: lastRaster.length ? "raster" : "no raster",
      factor: route1Factor,
      collectionCycles: route1Collection,
      ratio60: route1Collection / FRAME_CLOCKS,
      hz: route1Collection > 0 ? 60 * FRAME_CLOCKS / route1Collection : 60,
      meets60: route1Collection <= FRAME_CLOCKS,
      note: ROUTE1.NOTE
    };

    var budgets = {
      frames: run.frameSums.map(function (c, k) {
        return { frame: k, frameCycles: c,
                 rasterCycles: run.rasterSums[k] || [] };
      }),
      /* #184: `frames` is the probe that ran (the caller's count); the budget
       * is judged on `sampledFrame`, which is past the probe when the probe's
       * last frame was over the ceiling. */
      probeFrames: run.frameSums.length,
      sampledFrame: run.sampledFrame,
      route1: route1,
      frameCycles: lastFrame,
      rasterMean: rasterMean,
      rasterWorst: rasterWorst,
      collectionCycles: collection,
      ratio60: collection / FRAME_CLOCKS,
      hz: collection > 0 ? 60 * FRAME_CLOCKS / collection : 60,
      vram: { maxWord: run.maxVram, words: run.maxVram + 1,
              maxSpriteWord: vram.maxSpriteWord, writes: run.maxVram >= 0 },
      cram: { maxEntry: run.maxCram },
      rom: { bytes: stat.romBytes, banks: Math.ceil(stat.romBytes / 8192),
             limit: ROM_LIMIT },
      sprites: spr.worst,
      spriteOverflowLines: spr.overflowLines,
      blank: blank.worst,
      blankOverLines: blank.over,
      tolerance: TOLERANCE
    };
    return finishReport(program, problems, budgets);
  }

  function finishReport(program, problems, budgets) {
    var first = null;
    for (var i = 0; i < problems.length; i++) {
      if (problems[i].severity === "error") { first = problems[i].code; break; }
    }
    return {
      ok: first === null,
      code: first,
      problems: problems,
      budgets: budgets,
      hooks: program.hooks,
      functions: program.functions.length
    };
  }

  function emptyReport(problems) {
    return finishReport({ hooks: {}, functions: [] }, problems, null);
  }

  /* the numbers the test and the docs quote */
  var MODEL = {
    FRAME_CLOCKS: FRAME_CLOCKS,
    HARD_FRAMES: HARD_FRAMES,
    ROM_LIMIT: ROM_LIMIT,
    RCR_BLANK: RCR_BLANK,
    HOOK_CYCLES: HOOK_CYCLES,
    TOLERANCE: TOLERANCE,
    OP_CYCLES: OP_CYCLES,
    OP_BYTES: OP_BYTES,
    ROUTE1: ROUTE1,
    cyclesOf: cyclesOf,
    bytesOf: bytesOf
  };

  return {
    validate: validate,
    validateProgram: validateProgram,
    finding: finding,
    /* #92: the blank's arithmetic, so the SCANLINES panel shows the same
     * share of the budget this file refuses */
    replayCost: replayCost,
    RCR: RCR,
    blankBudget: blankBudget,
    MODEL: MODEL,
    REFUSALS: {
      "validate-frame-budget": "a toy frame over the 8-display-frame ceiling",
      "validate-slow-frame": "below 60 Hz (reported, not refused)",
      "validate-sprite-line": "more than 16 16-px strips on a line",
      "validate-vram": "a VRAM address or sprite pattern cell past 32,768 words",
      "validate-rom": "an estimated ROM past the HuCard's 1 MB",
      "validate-raster-blank": "a replay step past the horizontal blank (reported)",
      "validate-raster-line": "a raster entry the replay handler cannot carry",
      "validate-range": "a constant operand outside the host's range"
    }
  };
});
