/*
 * pce-docs.js — the toy author's reference (card #61), generated from the
 * code's own tables so it cannot drift.
 *
 * This module does not describe the hardware twice.  Every number it prints
 * is read at build time from the module that enforces it:
 *
 *   renderer/pce-toyhost.js   the registers a toy may set and their widths,
 *                             CRAM/VRAM/SAT sizes, the SAT field ranges, the
 *                             raster line and write limits, the pads, the
 *                             status register's bits, the refusal codes of the
 *                             shared host
 *   renderer/pce-editor.js    the picture's palettes, tile and sprite sizes,
 *                             the line budget, the editor's refusal codes
 *   renderer/pce-toys.js      the password caps (#73), the Lua frame budget,
 *                             the Lua runtime's refusal codes
 *   renderer/pce-il.js        the IL's refusal codes and instruction budget
 *   renderer/pce-psg.js       the nine PSG registers and their manual pages
 *   renderer/pce-validate.js  the cartridge validator's refusal codes
 *   renderer/pce-cgen.js      the console C backend's refusal codes
 *
 * tools/docs.js renders `markdown(reference())` to stdout and
 * `html(reference())` to renderer/docs.html; tests/check-docs.js proves the
 * artifact is the generator's output and that changing a code table changes
 * the docs.  The page layout follows ppu.toys' docs (MIT, Liora Labs): a
 * chapter per topic, prose first, then the table, then a small example.
 *
 * Dual use: CommonJS in Node (tools/docs.js, tests/check-docs.js) and a
 * browser global if a page ever renders it live.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./pce-toyhost.js"),
                             require("./pce-editor.js"),
                             require("./pce-toys.js"),
                             require("./pce-il.js"),
                             require("./pce-psg.js"),
                             require("./pce-validate.js"),
                             require("./pce-cgen.js"));
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.docs = factory(root.PCEStudio.toyhost,
                                  root.PCEStudio.editor,
                                  root.PCEStudio.toys,
                                  root.PCEStudio.il,
                                  root.PCEStudio.psg,
                                  root.PCEStudio.validate,
                                  root.PCEStudio.cgen);
  }
})(typeof self !== "undefined" ? self : this,
   function (host, editor, toys, il, psg, validate, cgen) {
  "use strict";

  function range(lo, hi) { return lo + ".." + hi; }

  /* ---- the refusal tables ---------------------------------------------- */

  /* Merge the maps into the order the page shows: the shared host's codes
   * first, then the Lua runtime's own, then the IL's, then the picture
   * editor's.  A code that appears twice keeps its first description. */
  var REFUSAL_GROUPS = [
    { id: "host", title: "The toy host (both runtimes)",
      source: "renderer/pce-toyhost.js", codes: host.REFUSALS },
    { id: "lua", title: "The Lua runtime",
      source: "renderer/pce-toys.js", codes: toys.REFUSALS },
    { id: "il", title: "The IL lowerer",
      source: "renderer/pce-il.js", codes: il.REFUSALS },
    { id: "validate", title: "The cartridge validator",
      source: "renderer/pce-validate.js", codes: validate.REFUSALS },
    { id: "cgen", title: "The console C backend",
      source: "renderer/pce-cgen.js", codes: cgen.REFUSALS },
    { id: "editor", title: "The picture editor",
      source: "renderer/pce-editor.js", codes: editor.REFUSALS }
  ];

  /* The union, code -> {description, source}; what tests/check-docs.js holds
   * the sources to. */
  function refusalIndex() {
    var out = {};
    for (var g = 0; g < REFUSAL_GROUPS.length; g++) {
      var grp = REFUSAL_GROUPS[g];
      for (var code in grp.codes) {
        if (!Object.prototype.hasOwnProperty.call(grp.codes, code)) continue;
        if (!Object.prototype.hasOwnProperty.call(out, code))
          out[code] = { description: grp.codes[code], source: grp.source,
                        group: grp.id };
      }
    }
    return out;
  }

  /* ---- the reference --------------------------------------------------- */

  function reference() {
    var R = host.REGISTERS;
    var refs = refusalIndex();
    var sections = [];

    /* 1. the toy ---------------------------------------------------------- */
    sections.push({
      id: "the-toy", title: "The toy",
      blocks: [
        { type: "p", text: "A toy is one Lua file. It draws to a " +
            host.WIDTH + "x" + host.HEIGHT + " picture on the PC Engine's " +
            "VDC and VCE through a small set of calls; everything it does is " +
            "checked against the hardware's own limits before it is stored." },
        { type: "p", text: "Three entry points, all optional:" },
        { type: "table",
          headers: ["function", "when it runs"],
          rows: [
            ["init()", "once, after the file's top-level statements"],
            ["frame(t, f)", "every video frame; t = f/60 seconds, f = frame number"],
            ["raster(line)", "every VDW display line " + range(0, host.VDW_LINES - 1) +
             " of the frame, after frame(), for per-line changes"]
          ] },
        { type: "p", text: "State is ordinary Lua globals and persists across " +
            "frames. A frame is deterministic: t is f/60, not the clock." },
        { type: "code", lang: "lua", text:
          "function frame(t, f)\n" +
          "  -- f is an integer frame count; BXR is 10 bits, so wrap it\n" +
          "  reg(\"BXR\", (f * 2) % " + (host.ALLOWED_REGS.BXR + 1) + ")\n" +
          "end\n" +
          "\n" +
          "function raster(line)\n" +
          "  pal(0, line % " + editor.VCE_COLOURS + ")\n" +
          "end" }
      ]
    });

    /* 2. registers -------------------------------------------------------- */
    var regRows = R.map(function (r) {
      return [r.name, range(0, r.max), r.bits + "-bit", r.what, r.manual];
    });
    sections.push({
      id: "registers", title: "Registers",
      blocks: [
        { type: "p", text: "A toy may set three VDC registers with " +
            "reg(name, value). The value must be a whole number in the " +
            "register's range; anything else is reg-range. Any other name is " +
            "reg-forbidden — the toy host writes only these, and the rest of " +
            "the VDC belongs to the ROM." },
        { type: "table", tight: true,
          headers: ["register", "range", "width", "what it does", "manual"],
          rows: regRows },
        { type: "code", lang: "lua", text:
          "function frame(t, f)\n" +
          "  -- whole numbers only: f, never t or sin(), and a wrap for BXR\n" +
          "  reg(\"BXR\", (f * 2) % " + (host.ALLOWED_REGS.BXR + 1) + ")\n" +
          "  reg(\"BYR\", (f // 2) % " + (host.ALLOWED_REGS.BYR + 1) + ")\n" +
          "  reg(\"CR\", 0xC0)\n" +
          "end" },
        { type: "p", text: "The VDC's other registers — the memory and " +
            "increment controls, the interrupt mask, the line-match register " +
            "— are not a toy's to write: the ROM configures them and a toy " +
            "that changes them would break the frame flow both runtimes share." }
      ]
    });

    /* 3. palettes --------------------------------------------------------- */
    var bgPal = editor.PALETTES, bgEntries = editor.ENTRIES;
    var spritePal = editor.SPRITE_PALETTES, spriteEntries = editor.SPRITE_ENTRIES;
    sections.push({
      id: "palettes", title: "Palettes and colour",
      blocks: [
        { type: "p", text: "The VCE holds " + host.CRAM_ENTRIES + " colour " +
            "entries (CRAM). pal(addr, word) writes one: the address is " +
            range(0, host.CRAM_ENTRIES - 1) + " and the word is a 9-bit colour, " +
            range(0, host.CRAM_WORD_MAX) + ". Either one out of range is " +
            "pal-range." },
        { type: "p", text: "A colour word is three 3-bit channels: green in " +
            "bits 6-8, red in bits 3-5, blue in bits 0-2. rgb(r, g, b) builds " +
            "one, masking each channel to " + range(0, 7) + "." },
        { type: "table",
          headers: ["entries", "what it is"],
          rows: [
            [range(0, bgPal * bgEntries - 1),
             bgPal + " background palettes of " + bgEntries + " colours; a BAT " +
             "cell names one of the " + bgPal + " in its palette bits"],
            [range(0x100, 0x100 + spritePal * spriteEntries - 1),
             spritePal + " sprite palettes of " + spriteEntries + " colours; a SAT " +
             "entry names one of the " + spritePal + " in its attribute word"]
          ] },
        { type: "p", text: "Colour 0 of every background palette is the shared " +
            "backdrop (CRAM $000): a pixel whose colour number is 0 shows " +
            "CRAM[0] whatever palette its cell named. Sprite pixel 0 is " +
            "transparent instead, so a sprite palette's entry 0 never shows " +
            "on a sprite." },
        { type: "code", lang: "lua", text:
          "function init()\n" +
          "  for i = 0, 15 do pal(i, rgb(0, i * 2, 7 - i)) end\n" +
          "end" }
      ]
    });

    /* 4. sprites ---------------------------------------------------------- */
    var fieldRange = host.SAT_FIELD_RANGES;
    /* In the default MWR 0 layout the BAT owns the first host.BAT_WORDS
     * words and the SAT the top 256, so a pattern p (64 words each) is free
     * only from firstPattern to lastPattern.  Printed, not typed: the guide
     * reads these numbers back from here. */
    var firstPattern = host.BAT_WORDS / 64;
    var lastPattern = editor.SAT_ADDR / 64 - 1;
    var sizeRows = editor.SPRITE_SIZES.map(function (s) {
      return [s.width + "x" + s.height, s.cells + " cell" +
              (s.cells === 1 ? "" : "s"), "CGX " + s.cgx + ", CGY " + s.cgy,
              s.align + "-cell"];
    });
    sections.push({
      id: "sprites", title: "Sprites and the SAT",
      blocks: [
        { type: "p", text: "The sprite attribute table holds " +
            host.SAT_ENTRIES + " entries of " + host.SAT_WORDS + " words each, " +
            "at VRAM $7F00. sprite(i, spec) fills entry i from a table; " +
            "sat(i, k, v) writes one raw word. An entry index outside " +
            range(0, host.SAT_ENTRIES - 1) + " is sat-range (sprite-range for " +
            "the composed form), and so is a field outside its width." },
        { type: "p", text: "The hardware does not police where a pattern " +
            "lives, so the usable numbers are set by the two tables a pattern " +
            "must not overwrite. In the default layout the BAT owns VRAM words " +
            "0.." + (host.BAT_WORDS - 1) + " (patterns 0.." +
            (firstPattern - 1) + ") and the SAT owns $7F00..$7FFF (patterns " +
            (lastPattern + 1) + ".." + (lastPattern + 4) + "). A sprite pattern is " +
            "therefore " + firstPattern + ".." + lastPattern + ", and the " +
            "background tiles share that region — character 0x40 starts at " +
            "word 0x400, which is pattern " + firstPattern + " — so keep the " +
            "two apart (the starter uses tile 0x40 and pattern 0x100)." },
        { type: "table",
          headers: ["word", "field"],
          rows: [
            ["0", "Y; " + "$40 is display row 0"],
            ["1", "X; " + "$20 is display column 0"],
            ["2", "pattern code, written << 1"],
            ["3", "palette | SPBG<<7 | CGX<<8 | HFLIP<<11 | CGY<<12 | VFLIP<<15"]
          ] },
        { type: "table",
          headers: ["sprite field", "range"],
          rows: [
            ["x", range(fieldRange.x[0], fieldRange.x[1])],
            ["y", range(fieldRange.y[0], fieldRange.y[1])],
            ["pattern", range(fieldRange.pattern[0], fieldRange.pattern[1])],
            ["palette", range(fieldRange.palette[0], fieldRange.palette[1])],
            ["cgy", range(fieldRange.cgy[0], fieldRange.cgy[1])],
            ["spbg, cgx, hflip, vflip", "true or false"]
          ] },
        { type: "p", text: "CGX doubles the width and CGY picks the height; " +
            "the six sizes the VDC draws are below. cells is the 64-word VRAM " +
            "span the pattern occupies." },
        { type: "table", headers: ["size", "cells", "flags", "alignment"],
          rows: sizeRows },
        { type: "p", text: "Per display line the VDC collects at most " +
            editor.LINE_STRIPS + " strips of " + editor.STRIP_PX +
            " pixels (" + editor.LINE_STRIPS * editor.STRIP_PX + " pixels) in " +
            "SAT order; a 32-pixel sprite asks for two strips. Sprites past " +
            "the limit are dropped, not refused — that is the line budget, " +
            "and the editor reports it per line." },
        { type: "code", lang: "lua", text:
          "function init()\n" +
          "  reg(\"CR\", 0xC0)   -- sprites start OFF; without this they never show\n" +
          "  sprite(0, { x = 32, y = 64, pattern = " + firstPattern +
          ", palette = 1 })\n" +
          "  sprite(1, { x = 80, y = 64, pattern = " + firstPattern +
          ", palette = 2, hflip = true })\n" +
          "end" }
      ]
    });

    /* 4b. the VDC's status register (#119) -------------------------------- */
    var srBits = host.SR_BITS;
    var statusRows = host.STATUS_API.map(function (a) {
      return [a.call, a.what, a.limits];
    });
    sections.push({
      id: "status", title: "The VDC's status flags",
      blocks: [
        { type: "p", text: "The VDC records what its display found in a " +
            "status register (SR, HuC6270 manual p. H7-4): a collision of " +
            "sprite #0 with another sprite, more sprites on a line than it " +
            "could draw, a line-counter match and vertical blanking. A toy " +
            "reads the frame's flags with sr(), computed by the same model " +
            "renderer/pce-sprites.js status() gives the SPRITES panel and the " +
            "validator — there is no arithmetic in the toy." },
        { type: "table",
          headers: ["call", "what it does", "range / refusal"],
          rows: statusRows },
        { type: "table", tight: true,
          headers: ["bit", "flag", "set when", "manual"],
          rows: srBits.map(function (b) {
            return ["$" + ("0" + (1 << b.bit).toString(16)).slice(-2).toUpperCase(),
                    b.name, b.what, b.manual];
          }) },
        { type: "p", text: "sr() answers for the frame last drawn, not the one " +
            "being built: frame() reads what the previous frame's display " +
            "found, the way the CPU reads SR in VBlank, and init() reads 0. " +
            "A bit is a condition AND its interrupt enable in CR " + range(0, 255) +
            " (CC bit 0, OC bit 1, RC bit 2, VC bit 3 — CR R05 p. H7-5..H7-6), " +
            "so a toy that wants the collision flag sets CR bit 0: " +
            "reg(\"CR\", 0xC3) is background, sprites, CC and OC. The host does " +
            "not clear the bits on a read; the condition is the frame's own." },
        { type: "code", lang: "lua", text:
          "function init()\n" +
          "  reg(\"CR\", 0xC3)   -- BB, SB, and the CC/OC interrupt enables\n" +
          "  sprite(0, { x = 120, y = 128, pattern = 0, palette = 1 })\n" +
          "  sprite(1, { x = 160, y = 128, pattern = 0, palette = 2 })\n" +
          "end\n" +
          "\n" +
          "function frame(t, f)\n" +
          "  -- sprite #0 (the player) touched another sprite last frame\n" +
          "  if sr() & 0x01 ~= 0 then print(1) end\n" +
          "end" }
      ]
    });

    /* 5. raster ----------------------------------------------------------- */
    sections.push({
      id: "raster", title: "Raster: changes per line",
      blocks: [
        { type: "p", text: "The PC Engine has no HDMA. The per-line trigger is " +
            "the VDC's line interrupt (RCR): the ROM arms RCR for line " +
            "0x40 + the display line, and the handler runs once for each of " +
            "the " + host.VDW_LINES + " display lines. A toy expresses per-line " +
            "changes two ways." },
        { type: "p", text: "1. A callback: define raster(line). Both runtimes " +
            "call it for every line " + range(0, host.VDW_LINES - 1) +
            " after frame() and record the register and palette writes it makes " +
            "as that line's entry." },
        { type: "p", text: "2. A table entry: call raster(line, spec) from " +
            "frame() (or init() for a static table). spec may set bxr, byr, " +
            "cr and cram = {{addr, word}, ...}." },
        { type: "table",
          headers: ["what can change per line", "range", "refusal"],
          rows: [
            ["bxr", range(0, host.ALLOWED_REGS.BXR), "reg-range"],
            ["byr", range(0, host.ALLOWED_REGS.BYR), "reg-range"],
            ["cr", range(0, host.ALLOWED_REGS.CR), "reg-range"],
            ["a colour entry (addr, word)",
             range(0, host.CRAM_ENTRIES - 1) + " / " + range(0, host.CRAM_WORD_MAX),
             "pal-range"]
          ] },
        { type: "p", text: "A line gets one entry, because the interrupt fires " +
            "once per line: a second registration for the same line is " +
            "raster-line-full, and so is more than " + host.RASTER_WRITES_MAX +
            " colour writes in one line's callback. A line outside " +
            range(0, host.VDW_LINES - 1) + " is raster-line." },
        { type: "p", text: "The VCE keeps CRAM across frames, so a row above " +
            "this frame's first write still shows the previous frame's value; " +
            "the runtime carries that in cramPrev. Inside a table entry, " +
            "registers the entry does not name keep the frame-wide value." },
        { type: "code", lang: "lua", text:
          "function frame(t, f)\n" +
          "  for line = 0, " + (host.VDW_LINES - 1) + " do\n" +
          "    raster(line, { bxr = line * 2,\n" +
          "                   cram = { { 0, line % " + editor.VCE_COLOURS + " } } })\n" +
          "  end\n" +
          "end" }
      ]
    });

    /* 6. pads ------------------------------------------------------------- */
    sections.push({
      id: "pads", title: "Pads",
      blocks: [
        { type: "p", text: "pad[n] is controller n, " + range(1, host.PAD_COUNT) +
            ". A pad is 2-button: the D-pad, I, II, Select and Run — " +
            host.PAD_FIELDS.length + " read-only booleans, refreshed before " +
            "frame(). Five pads is the multitap; pad 1 is the console's own " +
            "port." },
        { type: "table",
          headers: ["field", "the pad button", "keyboard key"],
          rows: host.PAD_FIELDS.map(function (f) {
            return ["pad[n]." + f,
                    f === "i" ? "I" : f === "ii" ? "II" :
                    f.charAt(0).toUpperCase() + f.slice(1),
                    host.PAD_KEYS[f]];
          }) },
        { type: "p", text: "The field names the pad BUTTON, and the button's " +
            "name is not always its key's: pad[n].i is the I button, which the " +
            "keyboard presses with key N, while pad[n].up is the Up direction, " +
            "which the keyboard presses with key I. Say which one you mean — " +
            "\"the I button (key N)\" or \"Up (key I)\" — never just \"press I\"." },
        { type: "p", text: "A pad is true while its button is held, not only on " +
            "the frame it goes down; remember the previous frame when an action " +
            "should happen once. Writing a pad field is refused (il-pad-write " +
            "in the IL; the Lua table is read-only)." },
        { type: "code", lang: "lua", text:
          "local was_ii = false\n" +
          "\n" +
          "function frame(t, f)\n" +
          "  if pad[1].ii and not was_ii then print(\"jump\") end\n" +
          "  was_ii = pad[1].ii\n" +
          "end" }
      ]
    });

    /* 6b. the timer (#45) -------------------------------------------------- */
    sections.push({
      id: "timer", title: "The timer",
      blocks: [
        { type: "p", text: "The HuC6280's 7-bit interval timer is the console's " +
            "only sub-frame clock (H8-20..H8-22). timer(period, fn) writes the " +
            "reload register ($1FEC00) and starts it ($1FEC01 bit 0); the " +
            "downcounter borrows every period+1 ticks of 6,991.3 Hz, sets TIQ " +
            "and reloads, and fn is called once per interrupt. A period of " +
            range(0, host.TIMER_RELOAD_MAX) + " is " + (host.TIMER_RELOAD_MAX + 1) +
            " ticks at most — 143 us to 18.3 ms (H8-21)." },
        { type: "p", text: "The browser host has no sub-frame clock. It " +
            "accumulates whole timer ticks across frames at " +
            host.TIMER_HZ.toFixed(1) + " Hz and calls fn at the frame boundary, " +
            "the number of interrupts that happened since the previous " +
            "frame() — about " + host.TIMER_TICKS_PER_FRAME.toFixed(1) +
            " ticks per frame at " + host.FRAME_HZ + " Hz. The console runs " +
            "the same count from the real TMA timer, raised as its own " +
            "interrupt (vector $FFFA), so timerirqs() reports the hardware's " +
            "figure there." },
        { type: "table",
          headers: ["call", "what it does", "range / refusal"],
          rows: host.TIMER_API.map(function (a) {
            return [a.call, a.what, a.limits];
          }) },
        { type: "code", lang: "lua", text:
          "local ticks = 0\n" +
          "\n" +
          "-- the interrupt: 17 ticks per period = 6,991.3 / 18 = 388 Hz\n" +
          "timer(17, function () ticks = ticks + 1 end)\n" +
          "\n" +
          "function frame(t, f)\n" +
          "  -- timerirqs() is what happened during the frame just ended\n" +
          "  pal(0, rgb(ticks & 7, 0, 0))\n" +
          "end" }
      ]
    });

    /* 7. passwords -------------------------------------------------------- */
    var P = toys.PASSWORD;
    sections.push({
      id: "passwords", title: "Passwords",
      blocks: [
        { type: "p", text: "A bare HuCard has no save memory, so a toy saves " +
            "with a password. password.pack(value) turns a value into a short " +
            "code starting " + P.prefix + " (base32 alphabet, then a check " +
            "byte) and password.unpack(code) returns it; a mistyped or " +
            "foreign code is password-code." },
        { type: "p", text: "A value is nil, a boolean, an integer, a string, or " +
            "a table with number or string keys. Every cap is a maximum the " +
            "round trip holds to; one past it is refused naming the edge, " +
            "never truncated." },
        { type: "table",
          headers: ["value", "maximum", "past it"],
          rows: [
            ["an integer", range(P.minInt, P.maxInt), "password-value"],
            ["a non-integer number", "none — not an integer", "password-value"],
            ["a string", P.maxString + " bytes", "password-value"],
            ["a table", P.maxItems + " entries, nested " + P.maxDepth +
             " tables deep", "password-value"],
            ["the value's bytes", P.maxBytes + ", before the check byte",
             "password-value"],
            ["the whole code", P.maxCodeLength + " characters", "password-code"]
          ] },
        { type: "p", text: "The integer cap is 2^30, not the VM's full 32-bit " +
            "range: an integer is 32 bits and the zig-zag encoding spends one " +
            "bit on the sign, so a magnitude of 2^30 doubles to 2^31 and would " +
            "wrap." },
        { type: "code", lang: "lua", text:
          "function init()\n" +
          "  -- once, not every frame: print() adds a log line and the log\n" +
          "  -- keeps only " + host.LOG_MAX + " lines\n" +
          "  local code = password.pack({ high = 1200, level = 3 })\n" +
          "  print(code)\n" +
          "end" }
      ]
    });

    /* 8. sound ------------------------------------------------------------ */
    var psgRegs = psg.REGISTERS.map(function (r) {
      return ["R" + r.n, r.name, r.what, r.manual];
    });
    var soundRows = host.SOUND_API.map(function (a) {
      return [a.call, a.what, a.limits];
    });
    sections.push({
      id: "sound", title: "Sound: the PSG",
      blocks: [
        { type: "p", text: "The HuC6280 PSG has " + psg.CHANNELS +
            " channels, each a " + psg.WAVE_STEPS + "-step waveform of " +
            "5-bit samples (0.." + psg.WAVE_MAX + "), plus noise on channels 4 " +
            "and 5 and an LFO. The model is renderer/pce-psg.js, a literal " +
            "transcription of Mednafen's pipeline at " + psg.SAMPLE_RATE +
            " Hz." },
        { type: "p", text: "music(index) plays a song from the list the " +
            "runtime was given — a module read by the tracker route " +
            "(renderer/pce-dmf.js, renderer/pce-song.js), whose writes are the " +
            "ones HuTrack's engine makes, one VBlank per frame. A toy pasted " +
            "into the studio gets no such list: the studio builds its runtime " +
            "without songs, so music(0) there is music-range, and music() is " +
            "not how a first toy gets sound. Use sfx() and note() instead; " +
            "music() is for a runtime a page hands a song list." },
        { type: "p", text: "sfx(channel, freq, volume, frames) takes a " +
            "channel from the music the way HuTrack reserves one, loads a " +
            "32-step square, sets F and AL, and gives the channel back after " +
            "frames frames. release(channel) gives a channel back now. If the " +
            "page did not load the PSG model or the song player, a sound call " +
            "is no-psg." },
        { type: "p", text: "A release does not resume the middle of a held " +
            "note: the music waits for the next note row on that channel, and " +
            "that fresh note reloads the instrument's waveform (all " +
            psg.WAVE_STEPS + " steps) even when it has not changed — HuTrack's " +
            "channel hand-off. The writes go to renderer/pce-psg.js in the " +
            "frame's order, so a toy's sound is the model's own PCM." },
        { type: "table",
          headers: ["call", "what it does", "limits and refusal"],
          rows: soundRows },
        { type: "table", tight: true,
          headers: ["register", "name", "what a write does", "manual"],
          rows: psgRegs },
        { type: "p", text: "F is the PSG's 12-bit divider, so a note's F is " +
            "7,159,090 / (64 f). note(name or MIDI) returns it — a name in " +
            "Lua, a MIDI number in both runtimes (the IL carries no " +
            "strings)." },
        { type: "code", lang: "lua", text:
          "function frame(t, f)\n" +
          "  -- pad[1].ii is the II BUTTON, pressed with keyboard key M\n" +
          "  if pad[1].ii then sfx(3, note(76), 24, 10) end\n" +
          "end" }
      ]
    });

    /* 9. budgets ---------------------------------------------------------- */
    sections.push({
      id: "budgets", title: "Budgets and limits",
      blocks: [
        { type: "p", text: "The limits a toy lives inside, each enforced where " +
            "the table says." },
        { type: "table",
          headers: ["budget", "limit", "source"],
          rows: [
            ["one hook's Lua time", toys.BUDGET_MS + " ms", "toy-timeout"],
            ["the page's log", host.LOG_MAX + " lines", "print()"],
            ["VRAM", host.VRAM_WORDS + " words", "vram-range"],
            ["CRAM", host.CRAM_ENTRIES + " entries", "pal-range"],
            ["SAT", host.SAT_ENTRIES + " entries", "sat-range"],
            ["display lines", host.VDW_LINES, "raster-line"],
            ["raster colour writes on one line", host.RASTER_WRITES_MAX,
             "raster-line-full"],
            ["sprites' strips on one line", editor.LINE_STRIPS + " strips (" +
             editor.LINE_STRIPS * editor.STRIP_PX + " pixels)", "line budget"],
            ["PSG voices", host.SOUND_CHANNELS + " channels", "sfx-range"],
            ["an SFX's length", host.SFX_FRAMES_MAX + " frames", "sfx-range"],
            ["a toy's recorded PSG writes", host.SOUND_EVENTS_MAX,
             "the recording, not the sound"],
            ["tiles in the ROM layout", editor.MAX_TILES, "tile-space"],
            ["one hook's IL instructions", il.MAX_INSTRUCTIONS, "toy-timeout"],
            ["a password's value bytes", P.maxBytes, "password-value"],
            ["a password's table entries", P.maxItems, "password-value"],
            ["a password's nesting", P.maxDepth + " tables", "password-value"],
            ["a password string", P.maxString + " bytes", "password-value"]
          ] }
      ]
    });

    /* 10. refusals -------------------------------------------------------- */
    var refusalBlocks = [
      { type: "p", text: "A refusal is a named failure, not a silent drop: the " +
          "call throws (or the page shows) an error whose code is one of these, " +
          "and both runtimes use the same code for the same fault." }
    ];
    for (var g = 0; g < REFUSAL_GROUPS.length; g++) {
      var grp = REFUSAL_GROUPS[g];
      var rows = [];
      for (var code in grp.codes) {
        if (!Object.prototype.hasOwnProperty.call(grp.codes, code)) continue;
        rows.push([code, grp.codes[code]]);
      }
      rows.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
      refusalBlocks.push({ type: "h3", text: grp.title,
                           source: grp.source });
      refusalBlocks.push({ type: "table", headers: ["code", "meaning"],
                           rows: rows });
    }
    sections.push({ id: "refusals", title: "Refusal codes",
                    blocks: refusalBlocks });

    return {
      title: "The toy author's reference",
      intro: "PCEStudio runs Lua toys on emulated PC Engine hardware. This " +
             "page is generated from the runtime's own tables, so every " +
             "range, cap and refusal code below is the one the code enforces.",
      sources: [
        "renderer/pce-toyhost.js", "renderer/pce-editor.js",
        "renderer/pce-toys.js", "renderer/pce-il.js", "renderer/pce-psg.js",
        "renderer/pce-validate.js", "renderer/pce-cgen.js",
        "renderer/pce-song.js"
      ],
      footer: "Generated by node tools/docs.js from the modules listed above. " +
              "Do not edit renderer/docs.html by hand: tests/check-docs.js " +
              "regenerates it and fails on a hand-written number.",
      sections: sections
    };
  }

  /* ---- Markdown -------------------------------------------------------- */

  function mdCell(s) {
    return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
  }

  function mdTable(headers, rows) {
    var out = [];
    out.push("| " + headers.map(mdCell).join(" | ") + " |");
    out.push("|" + headers.map(function () { return " --- "; }).join("|") + "|");
    for (var i = 0; i < rows.length; i++)
      out.push("| " + rows[i].map(mdCell).join(" | ") + " |");
    return out.join("\n");
  }

  function markdown(ref) {
    var out = ["# " + ref.title, "", ref.intro, ""];
    for (var s = 0; s < ref.sections.length; s++) {
      var sec = ref.sections[s];
      out.push("## " + sec.title, "");
      for (var b = 0; b < sec.blocks.length; b++) {
        var blk = sec.blocks[b];
        if (blk.type === "p") out.push(blk.text, "");
        else if (blk.type === "h3") out.push("### " + blk.text, "");
        else if (blk.type === "table") out.push(mdTable(blk.headers, blk.rows), "");
        else if (blk.type === "code")
          out.push("```" + blk.lang, blk.text, "```", "");
      }
    }
    out.push("---", "", ref.footer, "");
    out.push("Sources: " + ref.sources.join(", ") + ".", "");
    return out.join("\n");
  }

  /* ---- HTML ------------------------------------------------------------ */

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function htmlTable(headers, rows, tight) {
    var h = "<table" + (tight ? ' class="tight"' : "") + "><thead><tr>" +
            headers.map(function (c) { return "<th>" + esc(c) + "</th>"; })
                   .join("") + "</tr></thead><tbody>";
    for (var i = 0; i < rows.length; i++) {
      h += "<tr>" + rows[i].map(function (c) {
        return "<td>" + esc(c) + "</td>";
      }).join("") + "</tr>";
    }
    return h + "</tbody></table>";
  }

  /* The page: ppu.toys' docs layout, our dark studio skin.  A sticky
   * chapter list on the left, the chapters on the right, tables and code in
   * the same card style as renderer/toys.html and renderer/editor.html. */
  function html(ref) {
    var nav = ref.sections.map(function (s) {
      return '<a href="#' + s.id + '">' + esc(s.title) + "</a>";
    }).join("\n      ");

    var body = "";
    for (var s = 0; s < ref.sections.length; s++) {
      var sec = ref.sections[s];
      body += '<section id="' + sec.id + '">\n<h2>' + esc(sec.title) + "</h2>\n";
      for (var b = 0; b < sec.blocks.length; b++) {
        var blk = sec.blocks[b];
        if (blk.type === "p") body += "<p>" + esc(blk.text) + "</p>\n";
        else if (blk.type === "h3")
          body += "<h3>" + esc(blk.text) +
                  (blk.source ? ' <span class="src">' + esc(blk.source) +
                                "</span>" : "") + "</h3>\n";
        else if (blk.type === "table")
          body += htmlTable(blk.headers, blk.rows, blk.tight) + "\n";
        else if (blk.type === "code")
          body += '<pre><code class="' + esc(blk.lang) + '">' +
                  esc(blk.text) + "</code></pre>\n";
      }
      body += "</section>\n";
    }

    return '<!doctype html>\n' +
'<!-- PCEStudio — the toy author\'s reference (card #61). GENERATED FILE:\n' +
'     node tools/docs.js --html writes it from the runtime\'s own tables;\n' +
'     tests/check-docs.js fails if it differs from the generator\'s output.\n' +
'     Do not edit by hand. -->\n' +
'<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
'<title>PCEStudio — ' + esc(ref.title) + '</title>\n<style>\n' +
'  :root { --bg:#111; --card:#181818; --line:#2a2a2a; --ink:#ddd; --dim:#999;\n' +
'          --accent:#8fc; --code:#0c0c0c; }\n' +
'  * { box-sizing: border-box; }\n' +
'  body { margin:0; background:var(--bg); color:var(--ink);\n' +
'         font:14px/1.55 system-ui, -apple-system, Segoe UI, sans-serif; }\n' +
'  header { padding:1.4rem 1.6rem .8rem; border-bottom:1px solid var(--line); }\n' +
'  header h1 { margin:0 0 .3rem; font-size:1.35rem; letter-spacing:.01em; }\n' +
'  header p { margin:0; max-width:52rem; color:var(--dim); }\n' +
'  .layout { display:grid; grid-template-columns:15rem minmax(0,52rem);\n' +
'            gap:2rem; padding:1.4rem 1.6rem 4rem; align-items:start; }\n' +
'  nav { position:sticky; top:1.2rem; display:flex; flex-direction:column;\n' +
'        gap:.15rem; font-size:.92rem; }\n' +
'  nav a { color:var(--dim); text-decoration:none; padding:.22rem .5rem;\n' +
'          border-left:2px solid transparent; border-radius:0 4px 4px 0; }\n' +
'  nav a:hover { color:var(--ink); background:var(--card);\n' +
'                border-left-color:var(--accent); }\n' +
'  main { min-width:0; }\n' +
'  section { background:var(--card); border:1px solid var(--line);\n' +
'            border-radius:8px; padding:1rem 1.2rem 1.2rem; margin:0 0 1.2rem; }\n' +
'  h2 { margin:.1rem 0 .7rem; font-size:1.1rem; color:#fff; }\n' +
'  h3 { margin:1.1rem 0 .4rem; font-size:.98rem; }\n' +
'  .src { color:var(--dim); font:11px ui-monospace, monospace; font-weight:400; }\n' +
'  p { margin:.55rem 0; }\n' +
'  table { border-collapse:collapse; width:100%; margin:.7rem 0;\n' +
'          font-size:.92rem; }\n' +
'  th, td { text-align:left; vertical-align:top; padding:.36rem .55rem;\n' +
'           border-bottom:1px solid var(--line); }\n' +
'  th { color:var(--accent); font-weight:600; font-size:.82rem;\n' +
'       text-transform:uppercase; letter-spacing:.04em; }\n' +
'  tr:last-child td { border-bottom:0; }\n' +
'  table.tight th:last-child, table.tight td:last-child { white-space:nowrap; }\n' +
'  code { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }\n' +
'  pre { background:var(--code); border:1px solid var(--line);\n' +
'        border-radius:6px; padding:.7rem .85rem; overflow:auto;\n' +
'        font:12.5px/1.5 ui-monospace, monospace; margin:.7rem 0 .2rem; }\n' +
'  footer { color:var(--dim); font-size:.85rem; padding:0 1.6rem 2.5rem;\n' +
'           max-width:52rem; }\n' +
'  @media (max-width:760px) { .layout { grid-template-columns:1fr; }\n' +
'    nav { position:static; flex-direction:row; flex-wrap:wrap; } }\n' +
'</style>\n</head>\n<body>\n' +
'<header>\n<h1>' + esc(ref.title) + '</h1>\n<p>' + esc(ref.intro) + '</p>\n</header>\n' +
'<div class="layout">\n<nav>\n      ' + nav + '\n</nav>\n<main>\n' +
body +
'</main>\n</div>\n<footer>' + esc(ref.footer) +
'<br>Sources: ' + esc(ref.sources.join(", ")) + '.</footer>\n' +
'</body>\n</html>\n';
  }

  return {
    reference: reference,
    markdown: markdown,
    html: html,
    refusalIndex: refusalIndex,
    REFUSAL_GROUPS: REFUSAL_GROUPS
  };
});
