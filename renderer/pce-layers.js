/*
 * pce-layers.js — the LAYERS panel's model (card #93, part E).
 *
 * ppu.toys' COMPOSE panel is the working example (Dennis, 2026-10-29): main
 * and sub screen previews, "out = (main + sub)", a layer table BG1-3/OBJ/
 * Backdrop x MAIN/SUB/MATH, BRIGHTNESS 0-15 with a curve, OPERATION
 * add/sub/half, ADDEND, FIXED COLOR and a Registers fold with TM/TS/CGADSUB/
 * CGWSEL/COLDATA.  None of that math exists on the PC Engine: the HuC6260
 * VCE has no sub screen, no colour math and no brightness register (the only
 * dimming it can do is rewriting palettes).  So this model is the PCE's
 * answer, not a port:
 *
 *   - the picture is four layers, and there is no fifth: the backdrop
 *     (CRAM $000, shown wherever a background pixel's colour number is 0),
 *     the background (VDC R05 bit 7, BB), and the sprites in two bands by
 *     their SPBG bit (SAT word 3 bit 7) — behind the background where SPBG=0,
 *     in front where SPBG=1.  Among sprites the lower SAT index wins, and a
 *     sprite pixel 0 is transparent (pce-sprites.js paintLine).
 *   - on/off is the VDC's own bits: BB and SB (R05 bits 7 and 6).  There is
 *     no per-layer mask, no window, no blending: a layer is drawn or it is
 *     not.
 *   - a fade is not a brightness register.  The usual PCE fade is a palette
 *     rewrite: per frame, every entry of the chosen palettes steps toward a
 *     target colour (Taiwanese/Hudson games, turboeverdrive-era tutorials and
 *     turboroxxor's notes all do it this way).  This model computes the
 *     stepped palettes with integer channel arithmetic, draws them, and
 *     writes them out as toy code (a block that rewrites CRAM every frame,
 *     exactly the way pce-pokes.js writes its keyframes into main.lua) or as
 *     a fade.json record beside the toy.
 *
 * Nothing here composes pixels a second time: every preview is
 * renderer/pce-sprites.js's renderFrame given the same options the studio
 * draws with and one CR value (or one CRAM table) changed, and the backdrop
 * preview is pce-bg.js's own CRAM decode.  The panel module
 * renderer/studio-panel-layers.js draws this model through the studio API of
 * docs/STUDIO.md §3.2.
 *
 * Facts and where they come from:
 *   - CR R05 bits: BB (7) background blanking, SB (6) sprite blanking —
 *     HuC6270 manual p. H7-5 (docs/MANUALS.md).
 *   - colour 0 of a background palette is the one shared backdrop
 *     (CRAM $000); a BB-clear line shows the blanking-period data
 *     (CRAM $100) — VDC manual p. H7-18, measured in #12's scene8 dumps
 *     (pce-bg.js).
 *   - SPBG is SAT word 3 bit 7 and only decides against an opaque
 *     background pixel — manual 2.4, pce-sprites.js.
 *   - the VCE colour word is GGGRRRBBB, 3 bits per channel (pce-editor.js,
 *     pce-palettes.js).
 *
 * Dual use: CommonJS module in Node (tests/check-studio.js) and a browser
 * global (renderer/studio.html), like pce-screen.js and pce-sat.js.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./pce-bg.js"),
                             require("./pce-sprites.js"),
                             require("./pce-panels.js"));
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.layers = factory(root.PCEStudio.bg,
                                    root.PCEStudio.sprites,
                                    root.PCEStudio.panels);
  }
})(typeof self !== "undefined" ? self : this, function (bg, sprites, panels) {
  "use strict";

  var CRAM_ENTRIES = 512;      /* the VCE's 9-bit colour table */
  var LEVELS = 8;              /* three bits per channel */
  var BB = 0x80;               /* CR bit 7: background blanking */
  var SB = 0x40;               /* CR bit 6: sprite blanking */
  var BACKDROP = 0x000;        /* CRAM entry a background colour 0 shows */
  var BLANK = 0x100;           /* CRAM entry a BB-clear line shows */
  var SPRITE_CRAM = 0x100;     /* first sprite palette entry */
  var BACKGROUND_PALETTES = 16;
  var SPRITE_PALETTES = 16;
  var ENTRIES = 16;
  var BLACK = 0x000;
  var WHITE = 0x1FF;
  var DEFAULT_STEPS = 16;
  var CURVES = ["linear", "in", "out"];
  var OPEN = "-- >>> PCEStudio fade";
  var CLOSE = "-- <<< PCEStudio fade";
  var BLOCK_RE = /\n?-- >>> PCEStudio fade[\s\S]*?-- <<< PCEStudio fade[^\n]*\n?/;

  function fail(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  function isInt(v) { return typeof v === "number" && v === Math.floor(v); }

  /* ---- the stacking order ---------------------------------------------- *
   * The one thing the panel has to say clearly, because the PCE's order is
   * not the SNES's: there is no colour math, so a sprite is either in front
   * of the background or behind its opaque pixels. */
  var STACK = [
    { key: "backdrop", title: "Backdrop",
      text: "CRAM $000 — the one shared backdrop. A background pixel whose " +
            "colour number is 0 shows it, and a BB-clear line shows the " +
            "blanking-period colour CRAM $100 instead." },
    { key: "sprites-back", title: "Sprites with SPBG=0",
      text: "Behind the background: a sprite pixel shows only where the " +
            "background's colour number is 0, i.e. over the backdrop." },
    { key: "bg", title: "Background",
      text: "The one background layer (BB, CR bit 7). Its opaque pixels " +
            "hide every SPBG=0 sprite under them." },
    { key: "sprites-front", title: "Sprites with SPBG=1",
      text: "In front of the background (SAT word 3 bit 7). Among sprites " +
            "the lower SAT index wins; a sprite pixel 0 is transparent." }
  ];

  function stack() { return STACK.slice(); }

  /* ---- CR and the frame's own bits ------------------------------------- */

  /* The CR a preview is drawn with: `cr` with `clear` bits cleared and
   * `set` bits set.  There is no other layer switch on the VDC. */
  function withBits(cr, set, clear) {
    var v = (cr == null ? 0 : cr) & 0xFF;
    v &= ~(clear || 0);
    v |= (set || 0);
    return v & 0xFF;
  }

  /* The raster table with every line's CR passed through `fn` — the same
   * per-line rule the studio's layer mask applies (studio.html maskedRaster),
   * because a raster entry's CR overrides the frame's register on its line
   * (pce-bg.js). */
  function gatedRaster(raster, fn) {
    if (!raster) return null;
    var out = {
      base: Object.assign({}, raster.base || {}),
      baseCram: raster.baseCram,
      entries: (raster.entries || []).map(function (en) {
        var c = Object.assign({}, en);
        if (c.cr != null) c.cr = fn(c.cr);
        return c;
      })
    };
    if (out.base.cr != null) out.base.cr = fn(out.base.cr);
    return out;
  }

  /* ---- CRAM: words and bytes ------------------------------------------- */
  /* The renderer reads CRAM as 512 little-endian 16-bit words (1024 bytes,
   * pce-bg.js decodeCram); the toy host keeps exactly those bytes.  The
   * model works in words because a colour is a 9-bit word. */
  function cramWords(bytes) {
    var words = new Array(CRAM_ENTRIES);
    for (var i = 0; i < CRAM_ENTRIES; i++)
      words[i] = ((bytes[i * 2] | (bytes[i * 2 + 1] << 8)) & 0x1FF);
    return words;
  }

  function cramBytes(words) {
    var out = new Uint8Array(CRAM_ENTRIES * 2);
    for (var i = 0; i < CRAM_ENTRIES; i++) {
      var w = (words[i] || 0) & 0x1FF;
      out[i * 2] = w & 0xFF;
      out[i * 2 + 1] = (w >> 8) & 0xFF;
    }
    return out;
  }

  function channels(word) {
    var w = (word || 0) & 0x1FF;
    return { g: (w >> 6) & 7, r: (w >> 3) & 7, b: w & 7 };
  }

  function wordOf(g, r, b) {
    return ((g & 7) << 6) | ((r & 7) << 3) | (b & 7);
  }

  function css(word) {
    var c = channels(word);
    return "rgb(" + (c.r * 36) + "," + (c.g * 36) + "," + (c.b * 36) + ")";
  }

  function hex3(v) { return (v & 0x1FF).toString(16).toUpperCase().padStart(3, "0"); }

  /* ---- the fade -------------------------------------------------------- */

  /* The CRAM addresses one palette actually shows.  Entry 0 of a background
   * palette is the shared backdrop, so background palette 0 owns CRAM $000
   * and palettes 1-15 own entries 1-15 only — a colour written to CRAM
   * $010+0 ($10, $20, …) is never read by the background (pce-bg.js
   * backgroundPixel fixes colour 0 up to CRAM $000).  A sprite palette owns
   * all 16 (its entry 0 is transparent on a sprite but is a real CRAM
   * entry). */
  function addressesOf(kind, palette) {
    var out = [], e;
    if (kind === "background") {
      if (palette < 0 || palette >= BACKGROUND_PALETTES)
        throw fail("palette-range", "the background has 16 palettes; got " +
                   palette);
      if (palette === 0) out.push(BACKDROP);
      for (e = 1; e < ENTRIES; e++) out.push(palette * ENTRIES + e);
      return out;
    }
    if (kind === "sprite") {
      if (palette < 0 || palette >= SPRITE_PALETTES)
        throw fail("palette-range", "sprites have 16 palettes; got " + palette);
      for (e = 0; e < ENTRIES; e++)
        out.push(SPRITE_CRAM + palette * ENTRIES + e);
      return out;
    }
    throw fail("palette-kind", "a palette is 'background' or 'sprite'; got " +
               kind);
  }

  /* The fade's curve, in the same integer arithmetic the generated toy code
   * uses.  k is 0..steps; the answer is 0..steps.  Nothing here is a float,
   * so the preview and the toy cannot round apart. */
  function curveAt(curve, k, steps) {
    if (k <= 0) return 0;
    if (k >= steps) return steps;
    if (curve === "in") return Math.floor((k * k) / steps);
    if (curve === "out") {
      var left = steps - k;
      return steps - Math.floor((left * left) / steps);
    }
    return k;   /* linear */
  }

  /* One channel stepped from `from` to `to` at k of steps. */
  function mixChannel(from, to, k, steps) {
    return Math.floor((from * steps + (to - from) * k) / steps);
  }

  function mixWord(from, to, k, steps) {
    var a = channels(from), b = channels(to);
    return wordOf(mixChannel(a.g, b.g, k, steps),
                  mixChannel(a.r, b.r, k, steps),
                  mixChannel(a.b, b.b, k, steps));
  }

  /* A fade spec is { palettes: [{kind, palette}] | "all", target, steps,
   * curve }.  It is checked here so a bad one is refused by code, not drawn
   * as a plausible-looking nothing. */
  function checkSpec(spec) {
    spec = spec || {};
    var steps = spec.steps == null ? DEFAULT_STEPS : spec.steps;
    if (!isInt(steps) || steps < 2 || steps > 64)
      throw fail("fade-steps", "a fade is 2..64 steps; got " + steps);
    var curve = spec.curve == null ? "linear" : String(spec.curve);
    if (CURVES.indexOf(curve) < 0)
      throw fail("fade-curve", "a curve is " + CURVES.join(", ") + "; got " +
                 curve);
    var target = spec.target == null ? BLACK : spec.target;
    if (!isInt(target) || target < 0 || target > WHITE)
      throw fail("fade-target", "a target is a 9-bit VCE word (0..$1FF); " +
                 "got " + target);
    var list = spec.palettes;
    if (list === "all" || list == null) {
      list = [];
      for (var p = 0; p < BACKGROUND_PALETTES; p++)
        list.push({ kind: "background", palette: p });
      for (var s = 0; s < SPRITE_PALETTES; s++)
        list.push({ kind: "sprite", palette: s });
    }
    if (!Array.isArray(list) || !list.length)
      throw fail("fade-palettes", "a fade needs at least one palette");
    var out = [], seen = {};
    for (var i = 0; i < list.length; i++) {
      var item = list[i] || {};
      var addrs = addressesOf(item.kind, item.palette);
      var key = item.kind + ":" + item.palette;
      if (seen[key]) continue;
      seen[key] = true;
      out.push({ kind: item.kind, palette: item.palette,
                 addresses: addrs });
    }
    return { palettes: out, target: target, steps: steps, curve: curve };
  }

  /* The plan: for each step k (0..steps), the word every chosen address
   * holds.  `words` is the frame's CRAM as words — the source the fade
   * starts from, captured when the plan is made (a toy that rewrites its
   * palette every frame is captured at the frame the plan was made on, and
   * the generated code's constants are those words). */
  function fadePlan(words, spec) {
    var s = checkSpec(spec);
    if (!words || words.length !== CRAM_ENTRIES)
      throw fail("fade-cram", "a fade plan needs the frame's 512 CRAM words");
    var addresses = [], seen = {};
    for (var i = 0; i < s.palettes.length; i++) {
      var p = s.palettes[i];
      for (var j = 0; j < p.addresses.length; j++) {
        var a = p.addresses[j];
        if (seen[a]) continue;
        seen[a] = true;
        addresses.push(a);
      }
    }
    addresses.sort(function (a, b) { return a - b; });
    var source = addresses.map(function (a) { return words[a] & 0x1FF; });
    var frames = [];
    for (var k = 0; k <= s.steps; k++) {
      var kk = curveAt(s.curve, k, s.steps);
      frames.push(source.map(function (from) {
        return mixWord(from, s.target, kk, s.steps);
      }));
    }
    return {
      addresses: addresses,
      source: source,
      target: s.target,
      steps: s.steps,
      curve: s.curve,
      palettes: s.palettes,
      frames: frames,
      /* step k's CRAM words: the frame's own words with the plan's entries
       * replaced */
      wordsAt: function (k) {
        var out = words.slice();
        var row = frames[Math.max(0, Math.min(s.steps, k))];
        for (var n = 0; n < addresses.length; n++) out[addresses[n]] = row[n];
        return out;
      }
    };
  }

  /* The Lua that puts the plan into the toy: a closure over the toy's own
   * frame(), like pce-pokes.js's block — the program runs first, then every
   * chosen entry is written, every frame.  Integer arithmetic only (no
   * tables read at run time), so the IL lowerer accepts it too. */
  function lua(plan) {
    if (!plan || !plan.addresses)
      throw fail("fade-plan", "there is no fade plan to write");
    var S = plan.steps;
    var lines = [];
    lines.push(OPEN + " (written by the LAYERS panel, card #93)");
    lines.push("-- The PC Engine has no brightness register: a fade is a");
    lines.push("-- palette rewrite.  Every chosen CRAM entry steps toward the");
    lines.push("-- target once a frame, " + S + " steps, " + plan.curve +
               " curve.  Edit the plan in");
    lines.push("-- the panel and write again: the studio replaces this whole");
    lines.push("-- block (markers and all).");
    lines.push("local __fadeSteps = " + S);
    lines.push("local function __fadeMix(from, target, k)");
    lines.push("  local S = __fadeSteps");
    lines.push("  local fg, fr, fb = (from // 64) % 8, (from // 8) % 8, from % 8");
    lines.push("  local tg, tr, tb = (target // 64) % 8, (target // 8) % 8, target % 8");
    lines.push("  return ((fg * S + (tg - fg) * k) // S) * 64 +");
    lines.push("         ((fr * S + (tr - fr) * k) // S) * 8 +");
    lines.push("         ((fb * S + (tb - fb) * k) // S)");
    lines.push("end");
    lines.push("local __fadeBase = frame");
    lines.push("local function __fadeFrame(t, f)");
    lines.push("  if __fadeBase then __fadeBase(t, f) end");
    lines.push("  local k = f");
    lines.push("  if k < 0 then k = 0 end");
    lines.push("  if k > __fadeSteps then k = __fadeSteps end");
    if (plan.curve === "in")
      lines.push("  k = (k * k) // __fadeSteps");
    else if (plan.curve === "out")
      lines.push("  k = __fadeSteps - ((__fadeSteps - k) * (__fadeSteps - k)) // __fadeSteps");
    for (var i = 0; i < plan.addresses.length; i++) {
      lines.push("  pal(" + plan.addresses[i] + ", __fadeMix(" +
                 plan.source[i] + ", " + plan.target + ", k))");
    }
    lines.push("end");
    lines.push("frame = __fadeFrame");
    lines.push("local __fadeInit = init");
    lines.push("init = function()");
    lines.push("  if __fadeInit then __fadeInit() end");
    lines.push("  if frame ~= __fadeFrame then __fadeBase = frame end");
    lines.push("  frame = __fadeFrame");
    lines.push("end");
    lines.push(CLOSE + " — edits inside this block are overwritten");
    return lines.join("\n") + "\n";
  }

  /* main.lua with an old fade block taken out and the new one appended. */
  function writeBack(source, plan) {
    var block = lua(plan);
    var text = String(source == null ? "" : source).replace(BLOCK_RE, "\n");
    text = text.replace(/\s+$/, "");
    return text + (text ? "\n\n" : "") + block;
  }

  /* ---- the previews ---------------------------------------------------- */

  /* The options one preview is drawn with: the frame's own objects, one CR
   * (and/or one CRAM table) changed, and the raster gated the same way. */
  function previewOpts(st, cr, cram, sat, gate) {
    var opts = {
      vram: st.vram,
      cram: cram || st.cram,
      sat: sat || st.sat,
      regs: Object.assign({}, st.regs, { CR: cr }),
      firstScanline: st.firstScanline,
      width: st.width,
      height: st.height
    };
    if (st.raster) opts.raster = gatedRaster(st.raster, gate);
    return opts;
  }

  function render(opts) {
    return sprites.renderFrame(opts);
  }

  /* The backdrop preview: a solid frame of CRAM $000, decoded by the
   * renderer's own colour table.  There is nothing to compose — the backdrop
   * is a colour, not a layer with pixels. */
  function backdropFrame(st) {
    var words = cramWords(st.cram);
    var rgb = bg.decodeCramWords(words);
    var w = st.width, h = st.height;
    var px = new Uint8Array(w * h * 3);
    var r = rgb[BACKDROP * 3], g = rgb[BACKDROP * 3 + 1], b = rgb[BACKDROP * 3 + 2];
    for (var i = 0; i < px.length; i += 3) { px[i] = r; px[i + 1] = g; px[i + 2] = b; }
    return { width: w, height: h, pixels: px, index: BACKDROP,
             word: words[BACKDROP] };
  }

  /* A line's CR with the panel's mask applied: BB/SB follow the table, every
   * other bit (the interrupt enables) is the frame's own. */
  function applyMask(cr, mask) {
    return withBits(cr, (mask.bg ? BB : 0) | (mask.sprites ? SB : 0),
                        (mask.bg ? 0 : BB) | (mask.sprites ? 0 : SB));
  }

  /* The four previews.  `mask` = {bg, sprites} says which layers the
   * composed frame shows (the panel's table); the BG and SPRITE previews
   * always show their own layer, so a switched-off layer can still be
   * looked at. */
  function previews(st, opts) {
    if (!st) throw fail("no-frame", "no frame yet: run a toy first");
    opts = opts || {};
    var mask = opts.mask || { bg: true, sprites: true };
    var sat = opts.sat || st.sat;
    var cr = st.regs.CR == null ? 0 : st.regs.CR;
    var composed = applyMask(cr, mask);
    var out = {
      backdrop: backdropFrame(st),
      bg: render(previewOpts(st, withBits(cr, BB, SB), opts.cram, sat,
                             function (v) { return withBits(v, BB, SB); })),
      sprites: render(previewOpts(st, withBits(cr, SB, BB), opts.cram, sat,
                                  function (v) { return withBits(v, SB, BB); })),
      composed: render(previewOpts(st, composed, opts.cram, sat,
                                   function (v) { return applyMask(v, mask); }))
    };
    out.composedCR = composed;
    return out;
  }

  /* Step k of a plan drawn over the running frame: the same renderer, the
   * plan's CRAM words, the panel's mask and view SAT. */
  function fadeFrameAt(st, plan, k, opts) {
    if (!st) throw fail("no-frame", "no frame yet: run a toy first");
    if (!plan) throw fail("fade-plan", "there is no fade plan yet");
    opts = opts || {};
    var mask = opts.mask || { bg: true, sprites: true };
    var cr = st.regs.CR == null ? 0 : st.regs.CR;
    var composed = applyMask(cr, mask);
    var at = Math.max(0, Math.min(plan.steps, k | 0));
    return render(previewOpts(st, composed, cramBytes(plan.wordsAt(at)),
                              opts.sat || st.sat,
                              function (v) { return applyMask(v, mask); }));
  }

  /* ---- the layer table ------------------------------------------------- */

  /* One row per layer and per sprite in the SAT, with where its on/off (or
   * priority) really lives.  `front` is the panel's view override for a
   * sprite's SPBG bit: the toy's SAT is never touched (the same rule the
   * pokes follow); `spriteRows` says which slots have one. */
  function rows(st, front) {
    if (!st) throw fail("no-frame", "no frame yet: run a toy first");
    front = front || {};
    var out = [
      { key: "backdrop", label: "Backdrop", shown: true, source: "always",
        where: "CRAM $000", note: "colour 0 of the background" },
      { key: "bg", label: "Background", shown: null, source: "CR bit 7 (BB)",
        where: "R05 $80", note: "one layer" },
      { key: "sprites", label: "Sprites", shown: null, source: "CR bit 6 (SB)",
        where: "R05 $40", note: "64 SAT entries" }
    ];
    var sat = panels ? panels.satTable(st) : [];
    for (var i = 0; i < sat.length; i++) {
      var s = sat[i];
      if (s.empty) continue;
      var viewFront = Object.prototype.hasOwnProperty.call(front, s.number)
        ? !!front[s.number] : !!s.spbg;
      out.push({
        key: "sprite:" + s.number, label: "Sprite " + s.number,
        shown: null, sprite: s.number, pattern: s.pattern,
        palette: s.palette, spbg: !!s.spbg, front: viewFront,
        source: "SAT word 3 bit 7 (SPBG)", where: "slot " + s.number,
        note: viewFront ? "in front of the BG" : "behind the BG's opaque pixels",
        viewOnly: viewFront !== !!s.spbg
      });
    }
    return out;
  }

  /* A SAT copy with the panel's view overrides applied: SPBG is SAT word 3
   * bit 7 (pce-sprites.js reads `(w3 >> 7) & 1`). */
  function satWith(st, front) {
    if (!front) return st.sat;
    var sat = new Uint8Array(st.sat);
    for (var key in front) {
      if (!Object.prototype.hasOwnProperty.call(front, key)) continue;
      var slot = parseInt(key, 10);
      if (!(slot >= 0 && slot < 64)) continue;
      var hi = slot * 8 + 6;   /* word 3, high byte */
      if (front[key]) sat[hi] = sat[hi] | 0x80;
      else sat[hi] = sat[hi] & 0x7F;
    }
    return sat;
  }

  /* The registers fold: CR and the SAT priority bits, in the words the panel
   * shows.  Nothing here is a second reading of the frame: the CR is the
   * frame's own R05, and every SPBG bit is the SAT word pce-sprites.js
   * reads. */
  function registers(st, front) {
    if (!st) throw fail("no-frame", "no frame yet: run a toy first");
    var cr = st.regs.CR == null ? 0 : st.regs.CR;
    var lines = [];
    lines.push("CR   $" + cr.toString(16).toUpperCase().padStart(2, "0") +
               "   BB " + ((cr & BB) ? 1 : 0) + " (background)   SB " +
               ((cr & SB) ? 1 : 0) + " (sprites)   R05");
    var sat = panels ? panels.satTable(st) : [];
    var count = 0;
    for (var i = 0; i < sat.length; i++) if (!sat[i].empty) count++;
    lines.push("SAT  " + count + " entr" + (count === 1 ? "y" : "ies") +
               " · word 3 bit 7 = SPBG (1 = in front of the BG)");
    for (i = 0; i < sat.length; i++) {
      var s = sat[i];
      if (s.empty) continue;
      var view = front && Object.prototype.hasOwnProperty.call(front, s.number)
        ? (front[s.number] ? 1 : 0) : s.spbg;
      lines.push("  slot " + String(s.number).padStart(2, " ") +
                 "  pattern $" + s.pattern.toString(16).toUpperCase() +
                 "  pal " + s.palette +
                 "  SPBG " + view + (view ? "  in front" : "  behind") +
                 (view !== s.spbg ? "  (view)" : ""));
    }
    lines.push("slots have no on/off of their own: move one past the display " +
               "window (SAT X/Y) or clear its entry.");
    return lines.join("\n");
  }

  /* ---- the fade as a toy's asset --------------------------------------- */

  /* fade.json: the stepped palettes recorded beside the toy.  Nothing reads
   * it into a running toy yet (the importer is #24/#71), so the panel says
   * that; the toy-code form above is the one that runs. */
  function assetText(plan) {
    var palettes = plan.palettes.map(function (p) {
      return { kind: p.kind, palette: p.palette, addresses: p.addresses };
    });
    var obj = {
      version: 1,
      kind: "pce.fade",
      card: "#93",
      steps: plan.steps,
      curve: plan.curve,
      target: plan.target,
      addresses: plan.addresses,
      palettes: palettes,
      frames: plan.frames
    };
    return JSON.stringify(obj, null, 2) + "\n";
  }

  return {
    CRAM_ENTRIES: CRAM_ENTRIES,
    LEVELS: LEVELS,
    BB: BB, SB: SB,
    BACKDROP: BACKDROP, BLANK: BLANK, SPRITE_CRAM: SPRITE_CRAM,
    BACKGROUND_PALETTES: BACKGROUND_PALETTES,
    SPRITE_PALETTES: SPRITE_PALETTES,
    ENTRIES: ENTRIES,
    BLACK: BLACK, WHITE: WHITE,
    DEFAULT_STEPS: DEFAULT_STEPS,
    CURVES: CURVES,
    OPEN: OPEN, CLOSE: CLOSE,
    stack: stack,
    withBits: withBits,
    applyMask: applyMask,
    gatedRaster: gatedRaster,
    cramWords: cramWords,
    cramBytes: cramBytes,
    channels: channels,
    wordOf: wordOf,
    css: css,
    hex3: hex3,
    addressesOf: addressesOf,
    curveAt: curveAt,
    mixChannel: mixChannel,
    mixWord: mixWord,
    checkSpec: checkSpec,
    fadePlan: fadePlan,
    lua: lua,
    writeBack: writeBack,
    previews: previews,
    backdropFrame: backdropFrame,
    fadeFrameAt: fadeFrameAt,
    rows: rows,
    satWith: satWith,
    registers: registers,
    assetText: assetText
  };
});
