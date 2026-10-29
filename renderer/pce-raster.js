/*
 * pce-raster.js — the SCANLINES panel's model (card #92, part D).
 *
 * ppu.toys' SCANLINES panel is the working example: "Change registers
 * partway down the frame: HDMA-style effects", an "Inspect line" number and
 * slider, an "Apply edits to" band picker, a mini frame showing the bands and
 * "Full frame · lines 0-223", and one row per band with a number, a name,
 * Enabled, its from-to lines, move up/down, duplicate, Edit, "N controls" and
 * a menu, plus "Add band".  This file is that panel's model: a list of bands,
 * the table they make, what a line costs, and the toy code they become.
 * Nothing is drawn here — renderer/studio-panel-scanlines.js paints.
 *
 * The PCE counterpart of HDMA is the line interrupt (RCR).  A band is not a
 * DMA channel with a byte stream: it is the register values a scanline's
 * interrupt writes, held until the next band's first line writes again (the
 * VDC's RCR fires once per line and the register keeps its value —
 * pce-bg.js buildRows applies #15's table exactly this way).  A band may set
 * BXR (10 bits), BYR (9 bits), CR (bit 7 BB, the background; bit 6 SB, the
 * sprites) and CRAM colour words, and may carry one ready-made effect from
 * #17: a gradient (one colour write per line), a wobble (one BXR write per
 * line) or a parallax band (one BXR write at the band's first line).
 *
 * What a line may cost is not this file's opinion: renderer/pce-validate.js
 * (#32, part C's replay handler) prices a raster entry at RCR_HEAD 29 cycles
 * from handler entry, +35 a VDC register write, +36 a VCE colour word, and
 * carries at most 2 colour words on a line.  budget() calls that module's own
 * replayCost, so the panel's live share of the 123-cycle horizontal blank and
 * the validator's `validate-raster-blank` / `validate-raster-line` cannot
 * disagree.  A band past it is refused here by code.
 *
 * What the panel edits is the toy: toLua() emits a fenced `raster(line)`
 * callback into main.lua, the code the toy really runs, and fromLua() reads
 * the fence back.  fromRaster() imports a table a toy already builds (for
 * instance the raster example's own hand-written callback) so the panel can
 * adopt it rather than overwrite it.
 *
 * Dual use: CommonJS module in Node (tests/check-studio.js) and a browser
 * global (renderer/studio.html), like pce-bg.js and pce-editor.js.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./pce-sprites.js"),
                             require("./pce-validate.js"));
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.raster = factory(root.PCEStudio.sprites,
                                    root.PCEStudio.validate);
  }
})(typeof self !== "undefined" ? self : this, function (sprites, validate) {
  "use strict";

  var RCR_BASE = 0x40;
  var BXR_MAX = 0x3FF;      /* BXR is a 10-bit register (HuC6270 R07) */
  var BYR_MAX = 0x1FF;      /* BYR is 9 bits (R08) */
  var CR_MAX = 0xFF;
  var CRAM_ENTRIES = 512;
  var CRAM_WORD_MAX = 0x1FF;
  var LINES_CHOICES = [224, 240];   /* #67's two windows */
  var DEFAULT_LINES = 224;
  var BANDS_MAX = 64;               /* a band a line, at most, the panel shows */
  var CR_BG = 0x80;                 /* CR bit 7: BB, the background */
  var CR_SPRITES = 0x40;            /* CR bit 6: SB, the sprites */

  var FENCE_OPEN = "-- >>> SCANLINES (#92) — generated, edit the bands in the panel";
  var FENCE_CLOSE = "-- <<< SCANLINES (#92)";

  function fail(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  function isInt(v) { return typeof v === "number" && v === (v | 0); }

  function checkInt(name, v, lo, hi, code) {
    if (!isInt(v) || v < lo || v > hi)
      throw fail(code, name + " must be an integer " + lo + ".." + hi +
                 ", got " + v);
    return v;
  }

  /* ---- the #32 price of one line's replay ------------------------------ */
  /* The validator's own arithmetic, when it is loaded; the same numbers as
   * a fallback so a panel without the validator still refuses honestly. */
  var PRICE = (validate && validate.RCR) || {
    BLANK: 123, HEAD: 29, REG: 35, COLOUR: 36, MAX_COLOURS: 2
  };

  function priceOf(registers, colours) {
    var fn = validate && validate.replayCost;
    var cycles = fn ? fn(registers, colours)
                    : PRICE.HEAD + PRICE.REG * registers +
                      PRICE.COLOUR * colours;
    return {
      registers: registers,
      colours: colours,
      cycles: cycles,
      budget: PRICE.BLANK,
      share: cycles / PRICE.BLANK,
      over: cycles > PRICE.BLANK,
      coloursOver: colours > PRICE.MAX_COLOURS
    };
  }

  /* ---- a band ---------------------------------------------------------- */

  var nextId = 1;

  /* spec: { name, enabled, from, to, bxr, byr, cr, cram, fx }
   * from/to are inclusive VDW display lines.  Every field but from/to is
   * optional and absent means "hold what the previous band left". */
  function newBand(spec, lines) {
    spec = spec || {};
    lines = lines === undefined ? DEFAULT_LINES : lines;
    var from = spec.from === undefined ? 0 : spec.from;
    var to = spec.to === undefined ? (lines - 1) : spec.to;
    var band = {
      id: "band" + (nextId++),
      name: spec.name || "",
      enabled: spec.enabled === undefined ? true : !!spec.enabled,
      from: from,
      to: to
    };
    if (spec.bxr != null) band.bxr = spec.bxr;
    if (spec.byr != null) band.byr = spec.byr;
    if (spec.cr != null) band.cr = spec.cr;
    if (spec.cram) band.cram = spec.cram.map(function (w) { return [w[0], w[1]]; });
    if (spec.fx) band.fx = cloneFx(spec.fx);
    return checkBand(band, lines);
  }

  function cloneFx(fx) {
    var out = { kind: fx.kind };
    for (var k in fx) {
      if (Object.prototype.hasOwnProperty.call(fx, k) && k !== "kind")
        out[k] = typeof fx[k] === "object" && fx[k] !== null
          ? cloneFx(fx[k]) : fx[k];
    }
    return out;
  }

  /* Every refusal the hardware and #32 make, on one band. */
  function checkBand(band, lines) {
    lines = lines === undefined ? DEFAULT_LINES : lines;
    if (!band || typeof band !== "object")
      throw fail("raster-band-range", "a band must be an object");
    if (LINES_CHOICES.indexOf(lines) < 0)
      throw fail("raster-lines", "the display is 224 or 240 lines (#67); " +
                 lines + " is not one of them");
    checkInt("from", band.from, 0, lines - 1, "raster-band-range");
    checkInt("to", band.to, 0, lines - 1, "raster-band-range");
    if (band.from > band.to)
      throw fail("raster-band-range", "band " + (band.name || band.from) +
                 " starts at line " + band.from + " and ends at " + band.to +
                 "; a range cannot run backwards");
    if (band.bxr != null) checkInt("BXR", band.bxr, 0, BXR_MAX, "raster-band-range");
    if (band.byr != null) checkInt("BYR", band.byr, 0, BYR_MAX, "raster-band-range");
    if (band.cr != null) checkInt("CR", band.cr, 0, CR_MAX, "raster-band-range");
    if (band.cram != null) {
      if (!Array.isArray(band.cram))
        throw fail("raster-band-cram", "a band's cram is a list of [addr, word]");
      if (band.cram.length > CRAM_ENTRIES)
        throw fail("raster-band-cram", "a band carries " + band.cram.length +
                   " colour writes; a line has " + CRAM_ENTRIES + " entries");
      for (var i = 0; i < band.cram.length; i++) {
        var w = band.cram[i];
        if (!Array.isArray(w) || w.length !== 2)
          throw fail("raster-band-cram", "cram[" + i + "] must be [addr, word]");
        checkInt("cram address", w[0], 0, CRAM_ENTRIES - 1, "raster-band-cram");
        checkInt("cram word", w[1], 0, CRAM_WORD_MAX, "raster-band-cram");
      }
    }
    if (band.fx) checkFx(band, lines);
    if (!controlsOf(band).total)
      throw fail("raster-band-empty", "band " + (band.name || band.from) +
                 " sets nothing: it needs BXR, BYR, CR, a colour write or an " +
                 "effect, or it is not a band");
    return band;
  }

  function checkFx(band, lines) {
    var fx = band.fx;
    var known = ["gradient", "wobble", "parallax"];
    if (known.indexOf(fx.kind) < 0)
      throw fail("raster-band-effect", "unknown effect " + fx.kind + "; " +
                 "the ready-made bands are " + known.join(", "));
    if (fx.kind === "gradient") {
      checkInt("gradient palette", fx.palette === undefined ? 0 : fx.palette,
               0, 15, "raster-band-effect");
      checkInt("gradient entry", fx.entry === undefined ? 1 : fx.entry,
               1, 15, "raster-band-effect");
      if (band.cram && band.cram.length + 1 > PRICE.MAX_COLOURS)
        throw fail("raster-band-colours", "the gradient writes a colour on " +
                   "every line and the band adds " + band.cram.length +
                   "; a line carries at most " + PRICE.MAX_COLOURS +
                   " colour words (part C's replay handler)");
      colourWordOf(fx.from, "gradient from");
      colourWordOf(fx.to, "gradient to");
      if (band.bxr != null) { /* both fine — a band may scroll and ramp */ }
    } else if (fx.kind === "wobble") {
      checkInt("wobble amplitude", fx.amplitude === undefined ? 4 : fx.amplitude,
               0, BXR_MAX, "raster-band-effect");
      checkInt("wobble period", fx.period === undefined ? 32 : fx.period,
               1, 4096, "raster-band-effect");
      checkInt("wobble speed", fx.speed === undefined ? 0 : fx.speed,
               -4096, 4096, "raster-band-effect");
      if (band.bxr != null)
        throw fail("raster-band-effect", "a wobble writes BXR on every line " +
                   "of its band; the band cannot also hold one BXR value");
    } else if (fx.kind === "parallax") {
      checkInt("parallax speed", fx.speed === undefined ? 0 : fx.speed,
               -4096, 4096, "raster-band-effect");
      if (band.bxr != null)
        throw fail("raster-band-effect", "a parallax band scrolls BXR by " +
                   "itself; the band cannot also hold one BXR value");
    }
  }

  function colourWordOf(c, what) {
    if (!isInt(c) || c < 0 || c > CRAM_WORD_MAX)
      throw fail("raster-band-effect", what + " must be a 9-bit VCE colour " +
                 "(0.." + CRAM_WORD_MAX + "), got " + c);
    return c;
  }

  /* What a band sets, and how many "controls" the row's count names. */
  function controlsOf(band) {
    var regs = (band.bxr != null ? 1 : 0) + (band.byr != null ? 1 : 0) +
               (band.cr != null ? 1 : 0);
    var colours = band.cram ? band.cram.length : 0;
    var fx = band.fx ? band.fx.kind : null;
    return { registers: regs, colours: colours, effect: fx,
             total: regs + colours + (fx ? 1 : 0) };
  }

  /* The per-line price.  A band whose effect writes every line is priced on
   * a line inside it; a band that writes once is priced on its first line. */
  function budget(band) {
    var c = controlsOf(band);
    var regs = (band.bxr != null ? 1 : 0) + (band.byr != null ? 1 : 0) +
               (band.cr != null ? 1 : 0);
    var colours = band.cram ? band.cram.length : 0;
    if (band.fx && band.fx.kind === "wobble") regs += 1;
    if (band.fx && band.fx.kind === "gradient") colours += 1;
    var p = priceOf(regs, colours);
    p.perLine = !!(band.fx && band.fx.kind !== "parallax");
    p.controls = c.total;
    return p;
  }

  /* The whole list: sorted, not overlapping, every band inside its budget.
   * Returns the problems as data so the panel can mark every row, and throws
   * nothing — the caller decides whether a list is usable (toRaster refuses
   * on the first one). */
  function checkList(bands, lines) {
    lines = lines === undefined ? DEFAULT_LINES : lines;
    var problems = [];
    if (!Array.isArray(bands))
      throw fail("raster-bands", "the bands must be an array");
    if (bands.length > BANDS_MAX)
      problems.push({ code: "raster-bands", band: null,
        message: bands.length + " bands; the panel shows at most " + BANDS_MAX +
                 " (a line carries one entry, so " + lines + " is the ceiling)" });
    var sorted = bands.slice().filter(function (b) { return b.enabled; })
      .sort(function (a, b) { return a.from - b.from; });
    for (var i = 0; i < bands.length; i++) {
      try { checkBand(bands[i], lines); }
      catch (e) { problems.push({ code: e.code, band: bands[i], message: e.message }); }
      /* a disabled band writes nothing, so it costs nothing and may sit
       * where a live band sits: its values are kept for re-enabling */
      if (bands[i].enabled === false) continue;
      var b = budget(bands[i]);
      if (b.over)
        problems.push({ code: "raster-band-budget", band: bands[i],
          message: "band " + (bands[i].name || bands[i].from) + " costs " +
                   b.cycles + " cycles a line from handler entry, past part " +
                   "C's " + b.budget + "-cycle horizontal blank" });
      if (b.coloursOver)
        problems.push({ code: "raster-band-colours", band: bands[i],
          message: "band " + (bands[i].name || bands[i].from) + " asks for " +
                   b.colours + " colour words on one line; part C's replay " +
                   "handler carries at most " + PRICE.MAX_COLOURS });
    }
    for (var k = 1; k < sorted.length; k++) {
      if (sorted[k].from <= sorted[k - 1].to) {
        problems.push({ code: "raster-line-full", band: sorted[k],
          message: "bands covering lines " + sorted[k - 1].from + ".." +
                   sorted[k - 1].to + " and " + sorted[k].from + ".." +
                   sorted[k].to + " overlap: a VDW line carries one raster " +
                   "entry, and the RCR chain fires one interrupt per line" });
      }
    }
    return problems;
  }

  function assertList(bands, lines) {
    var problems = checkList(bands, lines);
    if (problems.length) throw fail(problems[0].code, problems[0].message);
    return bands;
  }

  /* ---- the #15 raster table -------------------------------------------- */

  function mix(from, to, t) {
    var fr = (from >> 3) & 7, fg = (from >> 6) & 7, fb = from & 7;
    var tr = (to >> 3) & 7, tg = (to >> 6) & 7, tb = to & 7;
    var r = Math.round(fr + (tr - fr) * t);
    var g = Math.round(fg + (tg - fg) * t);
    var b = Math.round(fb + (tb - fb) * t);
    return (g << 6) | (r << 3) | b;
  }

  function wobbleOffset(fx, line) {
    var amp = fx.amplitude === undefined ? 4 : fx.amplitude;
    var period = fx.period === undefined ? 32 : fx.period;
    var speed = fx.speed === undefined ? 0 : fx.speed;
    var phase = (line - fx.line0 + speed * fx.frame) / period;
    return Math.round(amp * Math.sin(2 * Math.PI * phase));
  }

  /* The table pce-bg.js draws, in #15's shape:
   *   { base: {bxr, byr, cr}, entries: [{line, rcr, bxr?, byr?, cr?,
   *     cram?: [[addr, word], ...]}] }
   * One entry where a band's values change; for a gradient or a wobble, one
   * entry per line of the band.  `frame` slides the effects (#17's rule). */
  function toRaster(bands, opts) {
    opts = opts || {};
    var lines = opts.lines === undefined ? DEFAULT_LINES : opts.lines;
    var frame = opts.frame === undefined ? 0 : opts.frame;
    assertList(bands, lines);
    var base = opts.base ? { bxr: opts.base.bxr || 0, byr: opts.base.byr || 0,
                             cr: opts.base.cr == null ? CR_BG | CR_SPRITES : opts.base.cr }
                        : { bxr: 0, byr: 0, cr: CR_BG | CR_SPRITES };
    var entries = [];
    var sorted = bands.filter(function (b) { return b.enabled; })
      .slice().sort(function (a, b) { return a.from - b.from; });
    for (var i = 0; i < sorted.length; i++) {
      var band = sorted[i];
      var fx = band.fx;
      if (fx && (fx.kind === "gradient" || fx.kind === "wobble")) {
        for (var L = band.from; L <= band.to; L++) {
          var e = { line: L, rcr: RCR_BASE + L };
          var wrote = false;
          if (L === band.from) {
            if (band.byr != null) { e.byr = band.byr & BYR_MAX; wrote = true; }
            if (band.cr != null) { e.cr = band.cr; wrote = true; }
            if (band.cram) {
              e.cram = band.cram.map(function (w) { return [w[0], w[1]]; });
              wrote = true;
            }
          }
          if (band.bxr != null && fx.kind !== "wobble") {
            if (L === band.from) { e.bxr = band.bxr & BXR_MAX; wrote = true; }
          }
          if (fx.kind === "wobble") {
            e.bxr = (base.bxr + wobbleOffset({
              amplitude: fx.amplitude, period: fx.period, speed: fx.speed,
              line0: band.from, frame: frame
            }, L)) & BXR_MAX;
            wrote = true;
          } else if (fx.kind === "gradient") {
            var addr = (fx.palette === undefined ? 0 : fx.palette) * 16 +
                       (fx.entry === undefined ? 1 : fx.entry);
            var t = band.to === band.from ? 0
                  : (L - band.from) / (band.to - band.from);
            var pair = [addr, mix(fx.from, fx.to, t)];
            e.cram = (L === band.from && band.cram)
              ? band.cram.concat([pair]) : [pair];
            wrote = true;
          }
          if (wrote) entries.push(e);
        }
        continue;
      }
      var one = { line: band.from, rcr: RCR_BASE + band.from };
      var any = false;
      if (fx && fx.kind === "parallax") {
        one.bxr = (base.bxr + (fx.speed || 0) * frame) & BXR_MAX;
        any = true;
      }
      if (band.bxr != null) { one.bxr = band.bxr & BXR_MAX; any = true; }
      if (band.byr != null) { one.byr = band.byr & BYR_MAX; any = true; }
      if (band.cr != null) { one.cr = band.cr; any = true; }
      if (band.cram) {
        one.cram = band.cram.map(function (w) { return [w[0], w[1]]; });
        any = true;
      }
      if (any) entries.push(one);
    }
    return { base: base, entries: entries };
  }

  /* The frame the panel draws: pce-sprites.js's renderer over the toy's own
   * state with this table — the same compositor as the output column. */
  function render(bands, st, opts) {
    opts = opts || {};
    var table = toRaster(bands, {
      lines: opts.lines, frame: opts.frame, base: opts.base || {
        bxr: st.regs.BXR, byr: st.regs.BYR, cr: st.regs.CR
      }
    });
    return sprites.renderFrame({
      vram: st.vram, cram: st.cram, sat: st.sat, regs: st.regs,
      width: st.width, height: st.height,
      firstScanline: st.firstScanline, raster: table
    });
  }

  /* ---- adopting a toy's own table -------------------------------------- */

  function keyOf(e) {
    return [e.bxr == null ? "" : e.bxr, e.byr == null ? "" : e.byr,
            e.cr == null ? "" : e.cr,
            e.cram ? e.cram.map(function (w) { return w[0] + ":" + w[1]; }).join(",") : ""
           ].join("|");
  }

  /* A #15 table back to bands: consecutive lines that hold the same values
   * become one band.  A per-line ramp (a gradient, a wobble) therefore
   * arrives as one band a line, which is what the toy actually asked the
   * hardware for; the panel names them "Band n" and the user can merge. */
  function fromRaster(table, opts) {
    opts = opts || {};
    var lines = opts.lines === undefined ? DEFAULT_LINES : opts.lines;
    if (!table || !table.entries || !table.entries.length) return [];
    var sorted = table.entries.slice().sort(function (a, b) {
      return a.line - b.line;
    });
    var bands = [], cur = null;
    for (var i = 0; i < sorted.length; i++) {
      var e = sorted[i];
      var key = keyOf(e);
      if (cur && cur.key === key && e.line === cur.to + 1) {
        cur.to = e.line;
        continue;
      }
      cur = { key: key, from: e.line, to: e.line, entry: e };
      bands.push(cur);
    }
    /* the last band runs to the end of the display, as the hardware holds
     * its values there */
    if (bands.length) bands[bands.length - 1].to = Math.max(
      bands[bands.length - 1].to, lines - 1);
    if (bands.length > BANDS_MAX)
      throw fail("raster-import", "the toy's table changes on " +
                 bands.length + " separate runs; the panel holds at most " +
                 BANDS_MAX + " bands (a gradient or wobble imports one band a " +
                 "line).  Give the toy fewer runs, or edit it in code");
    var out = [];
    for (var k = 0; k < bands.length; k++) {
      var e2 = bands[k].entry;
      out.push(newBand({
        name: "Band " + (k + 1),
        from: bands[k].from, to: bands[k].to,
        bxr: e2.bxr, byr: e2.byr, cr: e2.cr, cram: e2.cram
      }, lines));
    }
    return out;
  }

  /* ---- the toy's code --------------------------------------------------- */

  function luaValue(v) { return String(v); }

  /* The fenced block the panel writes into main.lua.  The table is canonical
   * (it carries the bands' names and Enabled flags, which a line of Lua
   * cannot); the callback under it is the projection the toy runs.  commit()
   * regenerates the callback from the table every time, so the two cannot
   * drift. */
  function toLua(bands, opts) {
    opts = opts || {};
    var lines = opts.lines === undefined ? DEFAULT_LINES : opts.lines;
    assertList(bands, lines);
    var table = toRaster(bands, { lines: lines, base: { bxr: 0, byr: 0, cr: 0 } });
    var out = [FENCE_OPEN];
    out.push("-- band table: " + JSON.stringify({
      version: 1, lines: lines,
      bands: bands.map(function (b) {
        var o = { name: b.name, enabled: b.enabled, from: b.from, to: b.to };
        if (b.bxr != null) o.bxr = b.bxr;
        if (b.byr != null) o.byr = b.byr;
        if (b.cr != null) o.cr = b.cr;
        if (b.cram) o.cram = b.cram;
        if (b.fx) o.fx = b.fx;
        return o;
      })
    }));
    out.push("function raster(line)");
    var byLine = {};
    for (var i = 0; i < table.entries.length; i++)
      byLine[table.entries[i].line] = table.entries[i];
    var keys = Object.keys(byLine).map(Number).sort(function (a, b) { return a - b; });
    if (!keys.length) out.push("  -- no band is enabled");
    for (var k = 0; k < keys.length; k++) {
      var e = byLine[keys[k]];
      var calls = [];
      if (e.bxr != null) calls.push("reg(\"BXR\", " + luaValue(e.bxr) + ")");
      if (e.byr != null) calls.push("reg(\"BYR\", " + luaValue(e.byr) + ")");
      if (e.cr != null) calls.push("reg(\"CR\", " + luaValue(e.cr) + ")");
      if (e.cram) {
        for (var w = 0; w < e.cram.length; w++)
          calls.push("pal(" + luaValue(e.cram[w][0]) + ", " +
                     luaValue(e.cram[w][1]) + ")");
      }
      out.push("  if line == " + keys[k] + " then " + calls.join("; ") + " end");
    }
    out.push("end");
    out.push(FENCE_CLOSE);
    return out.join("\n") + "\n";
  }

  /* The bands back out of a source, or null when it holds no fence.  Says
   * whether the fence's code still matches its table: the panel shows a
   * hand-edited fence rather than silently regenerating it. */
  function fromLua(source, opts) {
    opts = opts || {};
    var lines = opts.lines === undefined ? DEFAULT_LINES : opts.lines;
    if (typeof source !== "string") return null;
    var open = source.indexOf(FENCE_OPEN);
    var close = source.indexOf(FENCE_CLOSE);
    if (open < 0 || close < 0 || close < open) return null;
    var block = source.slice(open, close);
    var m = block.match(/-- band table: (\{[\s\S]*\})/);
    if (!m) return null;
    var doc;
    try { doc = JSON.parse(m[1]); }
    catch (e) {
      throw fail("raster-code", "the SCANLINES block in main.lua does not " +
                 "parse (" + e.message + "); revert it or re-apply the panel");
    }
    var declared = doc.lines === undefined ? lines : doc.lines;
    if (LINES_CHOICES.indexOf(declared) < 0)
      throw fail("raster-lines", "the SCANLINES block declares " + declared +
                 " lines; the display is 224 or 240 (#67)");
    var bands = (doc.bands || []).map(function (b) {
      return newBand(b, declared);
    });
    return { lines: declared, bands: bands };
  }

  /* Put the fence into a source: replace one already there, else append it.
   * A hand-written `raster(line)` outside the fence is refused rather than
   * overwritten — the panel does not replace code it did not write. */
  function withFence(source, bands, opts) {
    opts = opts || {};
    var lines = opts.lines === undefined ? DEFAULT_LINES : opts.lines;
    var block = toLua(bands, { lines: lines });
    var text = typeof source === "string" ? source : "";
    var open = text.indexOf(FENCE_OPEN);
    var close = text.indexOf(FENCE_CLOSE);
    if (open >= 0 && close > open) {
      return text.slice(0, open) + block + text.slice(close + FENCE_CLOSE.length + 1);
    }
    if (/^\s*function\s+raster\s*\(/m.test(text))
      throw fail("raster-hand", "main.lua already defines its own " +
                 "raster(line) outside the panel's block; the panel will not " +
                 "replace code it did not write.  Delete that function (or " +
                 "import it first) and apply again");
    if (text.length && text.charAt(text.length - 1) !== "\n") text += "\n";
    return text + "\n" + block;
  }

  /* ---- ready-made bands (#17's effects) -------------------------------- */

  var READY = [
    { id: "status", name: "Status bar", title: "Split the screen",
      make: function (from, to) {
        return { name: "Status bar", from: from, to: to, byr: 0, cr: CR_BG };
      } },
    { id: "sprites-off", name: "Sprites off", title: "BG only",
      make: function (from, to) {
        return { name: "Sprites off", from: from, to: to, cr: CR_BG };
      } },
    { id: "blank", name: "Blank", title: "CR $00: the blanking fill",
      make: function (from, to) {
        return { name: "Blank", from: from, to: to, cr: 0x00 };
      } },
    { id: "parallax", name: "Parallax", title: "BXR scrolls, pixels a frame",
      make: function (from, to) {
        return { name: "Parallax", from: from, to: to,
                 fx: { kind: "parallax", speed: 1 } };
      } },
    { id: "wobble", name: "Wobble", title: "BXR from a sine, per line",
      make: function (from, to) {
        return { name: "Wobble", from: from, to: to,
                 fx: { kind: "wobble", amplitude: 4, period: 32, speed: 0 } };
      } },
    { id: "gradient", name: "Gradient", title: "One colour per line",
      make: function (from, to) {
        return { name: "Gradient", from: from, to: to,
                 fx: { kind: "gradient", palette: 0, entry: 1,
                       from: 0x000, to: 0x1FF } };
      } }
  ];

  function readyBand(id, from, to, lines) {
    for (var i = 0; i < READY.length; i++) {
      if (READY[i].id === id) {
        var spec = READY[i].make(from, to);
        spec.from = from; spec.to = to;
        return newBand(spec, lines);
      }
    }
    throw fail("raster-band-effect", "no ready-made band called " + id +
               "; the panel offers " + READY.map(function (r) {
                 return r.id;
               }).join(", "));
  }

  /* ---- the band list's editing operations ------------------------------ */

  function indexOf(bands, band) {
    for (var i = 0; i < bands.length; i++) if (bands[i] === band) return i;
    for (i = 0; i < bands.length; i++) if (bands[i].id === band) return i;
    return -1;
  }

  /* Split the band that covers `line` into two at `line`, so a new band can
   * be added there (ppu.toys' "Add band").  The original keeps the values it
   * wrote; the new one starts from `line` holding the same values, and the
   * user edits it. */
  function splitAt(bands, line, lines) {
    lines = lines === undefined ? DEFAULT_LINES : lines;
    for (var i = 0; i < bands.length; i++) {
      var b = bands[i];
      if (line > b.from && line <= b.to) {
        var right = newBand({
          name: (b.name ? b.name + " (2)" : ""),
          enabled: b.enabled, from: line, to: b.to,
          bxr: b.bxr, byr: b.byr, cr: b.cr,
          cram: b.cram ? b.cram.map(function (w) { return [w[0], w[1]]; }) : null
        }, lines);
        b.to = line - 1;
        bands.splice(i + 1, 0, right);
        return right;
      }
    }
    throw fail("raster-band-range", "no band covers line " + line + ", so " +
               "there is nothing to split; a band starts at line " +
               (bands.length ? bands.map(function (x) { return x.from; }).join(", ") : "—"));
  }

  function sortedBands(bands) {
    return bands.slice().sort(function (a, b) { return a.from - b.from; });
  }

  /* Move up/down swap a band's line range with its neighbour's: the two
   * bands trade places in the list and keep their own heights, so the values
   * that land on each stretch of lines change and nothing overlaps. */
  function moveUp(bands, band, lines) {
    var i = indexOf(bands, band);
    if (i < 0) throw fail("raster-band-order", "no such band");
    var sorted = sortedBands(bands);
    var at = sorted.indexOf(bands[i]);
    if (at <= 0)
      throw fail("raster-band-order", "band " + (band.name || band.from) +
                 " is already the first; there is nothing above it to swap " +
                 "with");
    var above = sorted[at - 1];
    var height = bands[i].to - bands[i].from + 1;
    var aboveHeight = above.to - above.from + 1;
    var top = above.from;
    bands[i].from = top;
    bands[i].to = Math.min(top + height - 1, lines - 1);
    above.from = bands[i].to + 1;
    above.to = Math.min(above.from + aboveHeight - 1, lines - 1);
    return bands;
  }

  function moveDown(bands, band, lines) {
    var i = indexOf(bands, band);
    if (i < 0) throw fail("raster-band-order", "no such band");
    var sorted = sortedBands(bands);
    var at = sorted.indexOf(bands[i]);
    if (at >= sorted.length - 1)
      throw fail("raster-band-order", "band " + (band.name || band.from) +
                 " is already the last; there is nothing below it to swap " +
                 "with");
    var below = sorted[at + 1];
    var height = bands[i].to - bands[i].from + 1;
    var belowHeight = below.to - below.from + 1;
    var top = bands[i].from;
    below.from = top;
    below.to = Math.min(top + belowHeight - 1, lines - 1);
    bands[i].from = below.to + 1;
    bands[i].to = Math.min(bands[i].from + height - 1, lines - 1);
    if (bands[i].from >= lines)
      throw fail("raster-band-range", "band " + (band.name || top) +
                 " cannot move below the last band: it would start past line " +
                 (lines - 1));
    return bands;
  }

  /* The first stretch of `need` free lines at or after `after`, wrapping to
   * line 0.  null when the display has no such run. */
  function freeRun(bands, need, after, lines, skip) {
    var occ = bands.filter(function (b) {
      return b !== skip && b.enabled !== false;
    }).sort(function (a, b) { return a.from - b.from; });
    var runs = [];
    var cursor = 0;
    for (var i = 0; i < occ.length; i++) {
      if (occ[i].from > cursor) runs.push([cursor, occ[i].from - 1]);
      cursor = Math.max(cursor, occ[i].to + 1);
    }
    if (cursor < lines) runs.push([cursor, lines - 1]);
    runs.sort(function (a, b) { return a[0] - b[0]; });
    for (var k = 0; k < runs.length; k++) {
      if (runs[k][0] >= after && runs[k][1] - runs[k][0] + 1 >= need)
        return runs[k][0];
    }
    for (k = 0; k < runs.length; k++) {
      if (runs[k][1] - runs[k][0] + 1 >= need) return runs[k][0];
    }
    return null;
  }

  /* A copy of the band, in the next free stretch of the same height. */
  function duplicate(bands, band, lines) {
    lines = lines === undefined ? DEFAULT_LINES : lines;
    var i = indexOf(bands, band);
    if (i < 0) throw fail("raster-band-order", "no such band");
    var height = bands[i].to - bands[i].from + 1;
    var at = freeRun(bands, height, bands[i].to + 1, lines, null);
    if (at == null)
      throw fail("raster-line-full", "no free run of " + height + " line" +
                 (height === 1 ? "" : "s") + " for a copy of band " +
                 (bands[i].name || bands[i].from) + ": a VDW line carries " +
                 "one raster entry, so the display holds only its " + lines +
                 " lines between the bands");
    var copy = newBand({
      name: (bands[i].name || "Band") + " copy",
      enabled: bands[i].enabled,
      from: at, to: at + height - 1,
      bxr: bands[i].bxr, byr: bands[i].byr, cr: bands[i].cr,
      cram: bands[i].cram ? bands[i].cram.map(function (w) {
        return [w[0], w[1]];
      }) : null
    }, lines);
    bands.splice(i + 1, 0, copy);
    return copy;
  }

  function remove(bands, band) {
    var i = indexOf(bands, band);
    if (i < 0) throw fail("raster-band-order", "no such band");
    if (bands.length === 1)
      throw fail("raster-band-order", "the last band cannot be removed; " +
                 "disable it instead (Enabled)");
    return bands.splice(i, 1)[0];
  }

  return {
    RCR_BASE: RCR_BASE,
    BXR_MAX: BXR_MAX, BYR_MAX: BYR_MAX, CR_MAX: CR_MAX,
    CR_BG: CR_BG, CR_SPRITES: CR_SPRITES,
    CRAM_ENTRIES: CRAM_ENTRIES, CRAM_WORD_MAX: CRAM_WORD_MAX,
    LINES_CHOICES: LINES_CHOICES, DEFAULT_LINES: DEFAULT_LINES,
    BANDS_MAX: BANDS_MAX,
    PRICE: PRICE,
    FENCE_OPEN: FENCE_OPEN, FENCE_CLOSE: FENCE_CLOSE,
    READY: READY,
    priceOf: priceOf,
    newBand: newBand,
    checkBand: checkBand,
    controlsOf: controlsOf,
    budget: budget,
    checkList: checkList,
    assertList: assertList,
    toRaster: toRaster,
    render: render,
    fromRaster: fromRaster,
    toLua: toLua,
    fromLua: fromLua,
    withFence: withFence,
    readyBand: readyBand,
    splitAt: splitAt,
    moveUp: moveUp, moveDown: moveDown,
    duplicate: duplicate, remove: remove
  };
});
