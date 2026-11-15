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
 *   renderer/pce-rom.js       the data bank and HuCard sizes
 *   renderer/pce-romcheck.js  the interpreter capacities (LIMITS) and the
 *                             near/over percentages the ROM rules print
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
                             require("./pce-cgen.js"),
                             require("./pce-ilbc.js"),
                             require("./pce-rom.js"),
                             require("./pce-romcheck.js"),
                             require("./pce-songbank.js"));
  } else {
    root.PCEStudio = root.PCEStudio || {};
    root.PCEStudio.docs = factory(root.PCEStudio.toyhost,
                                  root.PCEStudio.editor,
                                  root.PCEStudio.toys,
                                  root.PCEStudio.il,
                                  root.PCEStudio.psg,
                                  root.PCEStudio.validate,
                                  root.PCEStudio.cgen,
                                  root.PCEStudio.ilbc,
                                  root.PCEStudio.rom,
                                  root.PCEStudio.romcheck,
                                  root.PCEStudio.songbank);
  }
})(typeof self !== "undefined" ? self : this,
   function (host, editor, toys, il, psg, validate, cgen, ilbc, rom,
             romcheck, songbank) {
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

  /* ---- writing for the ROM (card #193) -------------------------------- *
   *
   * One section, generated from the two compilers' own FEATURES/REFUSALS
   * tables: the Studio's ROM CHECK drawer, the MCP rom_check tool, this
   * page and the chat-AI guide all print the same lists, so a feature a
   * compiler gains or refuses appears everywhere with no second edit.
   * tools/docs.js also writes this section's HTML into the Claude Code
   * manual (renderer/claude-code.html). */
  function romWritingBlocks() {
    var carriedRows = [];
    var groups = [
      { key: "cgen", name: "C compiler (Export…)", feat: cgen.FEATURES },
      { key: "ilbc", name: "bytecode (every .pce)", feat: ilbc.FEATURES }
    ];
    var i, j;
    for (i = 0; i < groups.length; i++) {
      var list = groups[i].feat.carried || [];
      for (j = 0; j < list.length; j++) {
        carriedRows.push([groups[i].name, list[j].label,
                          list[j].detail || ""]);
      }
    }
    var refusedRows = [];
    for (i = 0; i < groups.length; i++) {
      var map = groups[i].feat.refused || {};
      var codes = Object.keys(map).sort();
      for (j = 0; j < codes.length; j++) {
        refusedRows.push([groups[i].name, codes[j], map[codes[j]]]);
      }
    }
    return [
      { type: "p", text: "Two routes build a .pce, and this page lists " +
          "what each carries today. The C route is " + cgen.FEATURES.route +
          ". The interpreter route is " + ilbc.FEATURES.route + ". A toy " +
          "the Studio exports must pass both; a toy exported over MCP " +
          "needs the interpreter route. The lists below are the compilers' " +
          "own tables (renderer/pce-cgen.js and renderer/pce-ilbc.js), not " +
          "a summary: a feature added to either compiler appears here " +
          "without a second edit." },
      { type: "p", text: "The Studio's ROM CHECK drawer checks both routes " +
          "as you type, marks the lines in the gutter, and shows 'ROM: ok' " +
          "or 'ROM: N problems' beside Export. The same check is the MCP " +
          "tool rom_check, which returns every finding at once as " +
          "{code, line, message}." },
      { type: "h3", text: "Carried today", source: "renderer/pce-cgen.js, " +
          "renderer/pce-ilbc.js (FEATURES)" },
      { type: "table", headers: ["route", "feature", "notes"],
        rows: carriedRows },
      { type: "h3", text: "Refused today", source: "renderer/pce-cgen.js, " +
          "renderer/pce-ilbc.js (REFUSALS)" },
      { type: "table", headers: ["route", "code", "meaning"],
        rows: refusedRows },
      { type: "p", text: "A refusal is not a crash: the exported ROM " +
          "cannot carry the construct, so the finding names it and the " +
          "line. The browser may still run the toy — the CONSOLE tab " +
          "answers that question (renderer/pce-validate.js)." }
    ];
  }

  /* ---- the ROM rules (the rom-rules docs topic) ------------------------ *
   *
   * The compact rule set the maintainer asked the MCP-connected Claude to
   * follow, so Export works first time.  Every NUMBER below is read from
   * the module that enforces it (the host's, the editor's and the ROM
   * builder's constants plus renderer/pce-romcheck.js's LIMITS, which
   * tests/check-rom-budget.js holds to the C interpreter); the hand-written
   * part — the fixes, the idioms, the state table — is held to the code by
   * tests/check-rom-rules.js (every named code is a refusal the code
   * raises, and every number is a module constant).  The section is the
   * docs topic `rom-rules`, and tools/docs.js writes it into the Claude
   * Code manual after the two route tables above. */

  /* The budget rows: each names the module field its number comes from
   * (`from`), which tests/check-rom-rules.js re-reads.  The interpreter
   * capacities ride romcheck.LIMITS, the one table the ROM CHECK drawer
   * and check-rom-budget.js already hold to tools/ilvm/ilvm.c. */
  function ruleBudgets() {
    var rows = [
      { label: "sprites", value: host.SAT_ENTRIES, unit: " SAT entries",
        refusal: "sprite-range", what: "the sprite attribute table",
        from: "host.SAT_ENTRIES" },
      { label: "sprites on one display line", value: editor.LINE_STRIPS,
        unit: " strips of " + editor.STRIP_PX + " pixels",
        refusal: "validate-sprite-line",
        what: "the VDC drops the rest (the line budget)",
        from: "editor.LINE_STRIPS" },
      { label: "VRAM", value: host.VRAM_WORDS, unit: " words",
        refusal: "vram-range", what: "characters, the BAT, sprite patterns",
        from: "host.VRAM_WORDS" },
      { label: "CRAM", value: host.CRAM_ENTRIES, unit: " entries",
        refusal: "pal-range", what: "pal() and the palettes",
        from: "host.CRAM_ENTRIES" },
      { label: "display lines", value: host.VDW_LINES, unit: "",
        refusal: "raster-line", what: "one raster entry per line",
        from: "host.VDW_LINES" },
      { label: "raster colour writes on one line", value: host.RASTER_WRITES_MAX,
        unit: "", refusal: "raster-line-full",
        what: "the colour entries one line's callback may write",
        from: "host.RASTER_WRITES_MAX" },
      { label: "one hook's Lua time", value: toys.BUDGET_MS, unit: " ms",
        refusal: "toy-timeout", what: "the page's budget per hook",
        from: "toys.BUDGET_MS" },
      { label: "frame rate", value: host.FRAME_HZ, unit: " Hz",
        refusal: "validate-slow-frame",
        what: "an update past one display frame is an overrun; the " +
              "validator's model reports the estimate",
        from: "host.FRAME_HZ" },
      { label: "the data bank (the bytecode)", value: rom.SONG_TABLE_OFF,
        unit: " B usable of the " + rom.BANK + " B bank (the last " +
              (rom.BANK - rom.SONG_TABLE_OFF) + " B are the song trailer)",
        refusal: "toy-data-bank-full",
        what: "the bytecode the interpreter reads; a toy's art files " +
              "travel in their own banks",
        from: "rom.SONG_TABLE_OFF" },
      { label: "the ROM", value: rom.BANK, unit: " B per bank, " +
        rom.MAX_ROM_BANKS + " banks a HuCard",
        refusal: "toy-rom-full", what: "the bytecode plus its asset banks",
        from: "rom.BANK" }
    ];
    /* The music budgets: the PSG's voices, an effect's ranges, the song
     * bank.  The refusals are the ones the host and the song bank raise. */
    rows.push(
      { label: "PSG channels", value: host.SOUND_CHANNELS, unit: "",
        refusal: "sfx-range",
        what: "sfx() and release() take a channel 0 to " +
              (host.SOUND_CHANNELS - 1) + "; music() shares all of them",
        from: "host.SOUND_CHANNELS" },
      { label: "an effect's pitch", value: host.PITCH_MAX, unit: " (F)",
        refusal: "sfx-range", what: "sfx() takes a 12-bit divider 0 to " +
              host.PITCH_MAX + "; note(midi) makes one",
        from: "host.PITCH_MAX" },
      { label: "an effect's volume", value: host.SOUND_VOLUME_MAX, unit: "",
        refusal: "sfx-range", what: "sfx() takes a level 0 to " +
              host.SOUND_VOLUME_MAX, from: "host.SOUND_VOLUME_MAX" },
      { label: "an effect's length", value: host.SFX_FRAMES_MAX,
        unit: " frames", refusal: "sfx-range",
        what: "sfx() takes 1 to " + host.SFX_FRAMES_MAX +
              " frames, then gives the channel back",
        from: "host.SFX_FRAMES_MAX" },
      { label: "an effect's frames", value: host.SFX.FRAMES_MAX,
        unit: " frames", refusal: "sfx-range",
        what: "sfx_fx(), sfx_noise(), sfx_slide() and sfx_preset() take 1 " +
              "to " + host.SFX.FRAMES_MAX + " frames; attack and decay too " +
              "(noise needs channel " + host.SFX.NOISE_CHANNELS.join(" or ") +
              ")",
        from: "host.SFX.FRAMES_MAX" },
      { label: "songs in the ROM", value: songbank.MAX_SONGS, unit: "",
        refusal: "toy-song-count",
        what: "music(n) plays the n-th song of the song bank",
        from: "songbank.MAX_SONGS" },
      { label: "the song bank", value: songbank.TRAILER, unit: " B for all " +
        "the songs together",
        refusal: "toy-song-bank-full",
        what: "every song assembled, 16-byte aligned, before the trailer " +
              "that lists them",
        from: "songbank.TRAILER" }
    );
    /* The background budgets: one layer, its palettes, its scroll. */
    rows.push(
      { label: "background palettes", value: editor.PALETTES, unit: " of " +
        editor.ENTRIES + " colours", refusal: "17th-palette",
        what: "the background map's palette field is 4 bits",
        from: "editor.PALETTES" },
      { label: "sprite palettes", value: editor.SPRITE_PALETTES,
        unit: " of " + editor.SPRITE_ENTRIES + " colours",
        refusal: "pal-range", what: "colour table entries " + (editor.PALETTES * editor.ENTRIES) +
              " on",
        from: "editor.SPRITE_PALETTES" },
      { label: "the background map", value: host.BAT_WORDS, unit: " words (" + (host.WIDTH / 8) +
        " by " + (host.WIDTH / 8) + " cells)", refusal: "vram-range",
        what: "one layer; the map size is fixed in this toy contract",
        from: "host.BAT_WORDS" },
      { label: "horizontal scroll (BXR)", value: host.REGISTERS[0].max,
        unit: " pixels", refusal: "reg-range",
        what: "wrap a growing scroll with a power-of-two remainder",
        from: "host.REGISTERS.0.max" },
      { label: "vertical scroll (BYR)", value: host.REGISTERS[1].max,
        unit: " lines", refusal: "reg-range", what: "the same, for BYR",
        from: "host.REGISTERS.1.max" },
      { label: "tiles in a picture", value: editor.MAX_TILES, unit: "",
        refusal: "tile-space",
        what: "the picture editor's tile space",
        from: "editor.MAX_TILES" }
    );
    /* The interpreter's capacities, from the one table the drawer prints
     * (the data bank is the row above; the rest ride along). */
    for (var i = 0; i < romcheck.LIMITS.length; i++) {
      var L = romcheck.LIMITS[i];
      if (L.id === "data-bank") continue;
      rows.push({ label: L.label, value: L.limit, unit: L.unit || "",
                  refusal: L.refusal, what: L.what,
                  from: "romcheck.LIMITS:" + L.id });
    }
    return rows;
  }

  /* What the two export routes do with the gallery's five games today.
   * Every figure is held by tests/check-rom-rules.js: `near` and `over` are
   * the budget rows rom_check reports for the toy (id, used), re-read from
   * the live check; `pace` is the game frames the native ROM completes in
   * 300 video frames, re-read from docs/NATIVE.md's measured tables.
   * docs/ROM_SPEED.md and docs/NATIVE.md are the long form. */
  var STATE_WINDOW = 300;   /* the video frames a pace is counted over */
  var RULE_STATE = [
    { game: "PLATFORMER", toy: "toys/platformer/main.lua", builds: true,
      code: null, near: [], over: [],
      verdict: "builds, runs at " + host.FRAME_HZ + " Hz (the measured run " +
               "overran no frame; the picture is the browser's)",
      native: "builds and plays at the full " + host.FRAME_HZ + " Hz pace " +
              "in an emulator",
      pace: 283 },
    { game: "TOWER", toy: "toys/tower/main.lua", builds: true, code: null,
      near: [["data-bank", 7862], ["constants", 104], ["globals", 30]],
      over: [],
      verdict: "builds, but is too slow to play: its one-time init draw " +
               "and each frame take several video frames",
      native: "builds and holds the full pace in an emulator (its sound is " +
              "silent in that build)",
      pace: 236 },
    { game: "STARFALL", toy: "toys/demo-game/main.lua", builds: true,
      code: null, near: [["constants", 111]], over: [],
      verdict: "builds (its art travels in its own ROM banks), but is too " +
               "slow to play",
      native: "builds banked with its art and sound, and holds the full " +
              "pace; the picture is the browser's except a few pixels at " +
              "the start of the first split line",
      pace: 286 },
    { game: "DUSK RUN", toy: "toys/dusk-run/main.lua", builds: true,
      code: null,
      near: [["data-bank", 7470], ["constants", 114], ["functions", 41],
             ["registers", 41], ["upvalues", 19], ["upvalue-cells", 70],
             ["globals", 31]],
      over: [],
      verdict: "builds, at the edge of seven limits, and is too slow: its " +
               "boot alone takes several seconds",
      native: "builds and runs, but crawls while it draws its background " +
              "tiles at the start; baking those tiles into art files " +
              "removes the phase",
      pace: 9 },
    { game: "NOVA TIDE", toy: "toys/nova-tide/main.lua", builds: false,
      code: "rom-budget",
      near: [["functions", 35], ["upvalues", 17], ["table-cells", 183],
             ["arguments", 8]],
      over: [["data-bank", 16384], ["registers", 67],
             ["upvalue-cells", 91], ["globals", 62], ["table-slots", 27]],
      verdict: "exports, but the interpreter ROM stops at load: it is over " +
               "five limits",
      native: "builds banked with its art and sound; the picture equals " +
              "the browser's and its raster(line, spec) calls are carried",
      pace: 138 }
  ];

  /* "registers 67 of 41" for a budget row id and a used figure. */
  function stateFigure(id, used) {
    var limit = 0, label = id;
    for (var i = 0; i < romcheck.LIMITS.length; i++) {
      if (romcheck.LIMITS[i].id === id) {
        limit = romcheck.LIMITS[i].limit;
        label = romcheck.LIMITS[i].label;
      }
    }
    return label + " " + used + " of " + limit;
  }

  function stateText(s) {
    var text = s.verdict;
    function list(rows) {
      return rows.map(function (r) { return stateFigure(r[0], r[1]); })
                 .join(", ");
    }
    if (s.over.length) text += ": " + list(s.over);
    if (s.near.length) text += (s.over.length ? "; near " : " (near: ") +
                               list(s.near) + (s.over.length ? "" : ")");
    return text + (s.code ? " (" + s.code + ")" : "");
  }

  /* The idioms that compile fast (docs/ORIGINAL-CODE-IDIOMS.md and
   * docs/ROUTINE-BENCH.md are the measured long form).  A row's `code` is
   * the refusal a violation draws, and the test holds it to the tables. */
  var RULE_IDIOMS = [
    { rule: "divide and take the remainder by powers of two (// and %)",
      why: "a shift, not a soft routine — part of how PLATFORMER's frame " +
           "got small enough for " + host.FRAME_HZ + " Hz",
      code: null },
    { rule: "take the low byte with a band mask (the code block below)",
      why: "one cheap op instead of arithmetic",
      code: null },
    { rule: "keep the arithmetic small",
      why: "every Lua integer is wider than the CPU's accumulator; " +
           "counters and coordinates that stay small are cheaper",
      code: null },
    { rule: "call local functions directly",
      why: "a direct call costs a jump and a return; a call reached " +
           "through a table or a first-class value costs far more",
      code: null },
    { rule: "read each table cell once, into a local",
      why: "one cell read is dozens of instructions (the measured " +
           "routines in docs/ROUTINE-BENCH.md); read it once and reuse " +
           "the local",
      code: null },
    { rule: "write sprite specs as constants, or use sat()",
      why: "a sprite() spec the walker cannot pin to constants is " +
           "refused; a moving sprite writes its four sat() words instead",
      code: "ilbc-op" },
    { rule: "no division by a variable",
      why: "a divisor the compiler does not know is a soft routine per " +
           "operation; divide by constants, powers of two especially",
      code: null },
    { rule: "no strings",
      why: "a string is not a value on either route; name things with " +
           "numbers — note(midi), a number in print() — and reg(\"BXR\", " +
           "v) is the one string form carried",
      code: "ilbc-key" }
  ];

  /* The common refusals and the fix for each.  The meaning is the
   * refusing module's own description (the refusalIndex) where the module
   * has one; the fix is hand-written advice held to the code by
   * tests/check-rom-rules.js. */
  function ruleFixes() {
    var index = refusalIndex();
    var custom = {
      "rom-budget": "a capacity the interpreter holds is over — the budget " +
                    "table names which one",
      "toy-data-bank-full": "the bytecode does not fit the data bank"
    };
    var fixes = [
      { code: "toy-data-bank-full",
        fix: "trim the bytecode: share and reuse constants, move tables " +
             "to declared arrays, draw less in code. Art no longer shares " +
             "this bank" },
      { code: "rom-budget",
        fix: "cut what the budget row names: fewer functions, registers, " +
             "globals or closures" },
      { code: "ilbc-range",
        fix: "share and reuse constants, keep fewer distinct values, move " +
             "repeated data into declared tables" },
      { code: "ilbc-op",
        fix: "replace the uncarried form: drop print() or log a number, " +
             "never read vram back (keep the value you wrote), and a " +
             "raster(line, spec) with a cram field has no form — the " +
             "raster(line) callback does" },
      { code: "cgen-op",
        fix: "the C route's own gaps: fixed-point helpers, print, and a " +
             "sprite spec it cannot pin — the bytecode-route fixes above " +
             "cover most, and a constant spec fixes the sprite" },
      { code: "ilbc-fixed",
        fix: "use integer // and % instead of the fixed-point helpers" },
      { code: "ilbc-key",
        fix: "a string is not a value: store numbers, compare numbers, " +
             "print numbers — note(midi), never a note name" },
      { code: "ilbc-arity",
        fix: "keep calls to " + ilbc.MAX_ARGS + " arguments or fewer; " +
             "hoist the rest into globals or split the function" },
      { code: "ilbc-table-ram",
        fix: "fewer cells: smaller tables, fewer string fields, int array " +
             "keys where you can" },
      { code: "ilbc-table-escape",
        fix: "build the table once in init() or at the top level, not " +
             "inside frame() or a loop" },
      { code: "validate-sprite-line",
        fix: "spread the sprites across display lines; the VDC drops the " +
             "rest of the line" },
      { code: "validate-slow-frame",
        fix: "cheaper frame(): the idioms above — powers of two, masks, " +
             "small integers, fewer table reads" }
    ];
    for (var i = 0; i < fixes.length; i++) {
      var code = fixes[i].code;
      fixes[i].meaning = index[code]
        ? index[code].description
        : (cgen.REFUSALS[code] || ilbc.REFUSALS[code] || custom[code]);
    }
    return fixes;
  }

  /* The template: a toy built on this shape passes both routes today
   * (tests/check-rom-rules.js compiles and exports it). */
  var RULE_TEMPLATE =
"-- ROM-safe toy template: every form here is carried by both routes.\n" +
"x = 144                       -- SAT X (32 is display column 0)\n" +
"y = 128                       -- SAT Y (64 is display row 0)\n" +
"\n" +
"function init()\n" +
"  reg(\"CR\", 0xC0)             -- background + sprites on (sprites start OFF)\n" +
"  pal(0, rgb(0, 0, 3))        -- the backdrop: dark blue\n" +
"  pal(0x101, rgb(7, 7, 7))    -- sprite palette 0, colour 1: white\n" +
"  local i = 0\n" +
"  while i < 64 do             -- one filled 16x16 cell (four 16-word planes)\n" +
"    vram[0x100 * 64 + i] = 0xFFFF\n" +
"    i = i + 1\n" +
"  end\n" +
"  sat(0, 2, 0x100 << 1)       -- the pattern word never changes: write once\n" +
"  sat(0, 3, 1 << 7)           -- sprite palette 0, SPBG set (in front)\n" +
"end\n" +
"\n" +
"function frame(t, f)\n" +
"  if pad[1].left  then x = x - 2 end\n" +
"  if pad[1].right then x = x + 2 end\n" +
"  if pad[1].up    then y = y - 2 end\n" +
"  if pad[1].down  then y = y + 2 end\n" +
"  -- keep the 16x16 sprite on the 256x224 picture: X 32..272, Y 64..272\n" +
"  if x < 32  then x = 32  end\n" +
"  if x > 272 then x = 272 end\n" +
"  if y < 64  then y = 64  end\n" +
"  if y > 272 then y = 272 end\n" +
"  sat(0, 0, y)                -- word 0 is Y, word 1 is X\n" +
"  sat(0, 1, x)\n" +
"end";

  var RULE_IDIOM_CODE =
"-- fast forms (docs/ORIGINAL-CODE-IDIOMS.md, docs/ROUTINE-BENCH.md):\n" +
"function frame(t, f)\n" +
"  local x = f * 3\n" +
"  x = x // 8      -- power-of-two division: a shift, not a soft routine\n" +
"  x = x % 16      -- power-of-two remainder: the same\n" +
"  x = x & 255     -- the low byte: one cheap op\n" +
"  x = x << 3      -- a shift by a constant: a few cheap shifts\n" +
"  reg(\"BXR\", x % 1024)  -- the register's wrap, by a power of two\n" +
"end";

  function rulePreflight() {
    return "Before you call export_pce: rom_check reports ok with no " +
      "findings; every budget row is under " + romcheck.OVER_PERCENT +
      " percent, with nothing past " + romcheck.NEAR_PERCENT +
      " percent unless the person accepted it; validate reports no error " +
      "findings; the frames you looked at look right; and toy_save wrote " +
      "the toy so the person can open it in the studio.";
  }

  /* The blocks, shared by the reference's rom-rules chapter and (after
   * the route tables) by the guide and the Claude Code manual. */
  function romRulesBlocks() {
    var budgetRows = ruleBudgets().map(function (r) {
      return [r.label, r.value + r.unit,
              r.refusal + " — " + r.what];
    });
    var stateRows = RULE_STATE.map(function (s) {
      return [s.game, s.builds ? "builds" : "refused", stateText(s),
              s.native, s.pace + " of " + STATE_WINDOW];
    });
    var idiomRows = RULE_IDIOMS.map(function (d) {
      return [d.rule, d.why, d.code || ""];
    });
    var fixRows = ruleFixes().map(function (f) {
      return [f.code, f.meaning, f.fix];
    });
    return [
      { type: "p", text: "The compact rule set for a Lua game that " +
          "exports to a ROM first time: the budgets, what each export " +
          "route carries and refuses (the full lists are the Writing for " +
          "the ROM chapter), the idioms that compile fast, a template, " +
          "the common refusals with their fixes, and the preflight " +
          "checklist. Every number here is read from the module that " +
          "enforces it; tests/check-rom-rules.js holds the hand-written " +
          "part to the code." },
      { type: "h3", text: "The loop", source: "the MCP server's " +
          "instructions and this chapter" },
      { type: "p", text: "Before writing a game, read this chapter. Then " +
          "work in small steps: after every change run validate (the " +
          "picture's limits — sprites per line, VRAM, the frame budget) " +
          "and rom_check (what the exported ROM carries), and fix every " +
          "finding before the next change. Undo a change that turns a " +
          "budget row red. Stop adding content at " + romcheck.NEAR_PERCENT +
          " percent of every limit. Call export_pce at the end. Look at " +
          "frames while you work: a clean run is not a good picture." },
      { type: "h3", text: "Budgets", source: "renderer/pce-romcheck.js " +
          "LIMITS, renderer/pce-toyhost.js, renderer/pce-editor.js, " +
          "renderer/pce-rom.js" },
      { type: "table", headers: ["budget", "limit", "refusal — what it is"],
        rows: budgetRows },
      { type: "p", text: "A row past " + romcheck.NEAR_PERCENT +
          " percent is near, past " + romcheck.OVER_PERCENT +
          " percent is over and refuses the export with the named code. " +
          "A sprite spec the walker cannot pin to constants and a " +
          "raster(line, spec) with a cram field are findings, not capacities." },
      { type: "h3", text: "What runs today", source: "the gallery's " +
          "five games, held by tests/check-rom-rules.js against rom_check " +
          "and docs/NATIVE.md (the long forms are docs/ROM_SPEED.md and " +
          "docs/NATIVE.md)" },
      { type: "table", headers: ["game", "interpreter ROM",
          "what that means", "native route (machine code)",
          "game frames in " + STATE_WINDOW + " video frames"],
        rows: stateRows },
      { type: "p", text: "The interpreter ROM is what the Export button and " +
          "export_pce build today; the native route compiles the same " +
          "toy to machine code and is built by the tools, not yet by the " +
          "Export button. " + "Full pace, " + host.FRAME_HZ + " Hz, is " +
          STATE_WINDOW + " game frames in " + STATE_WINDOW +
          " video frames; the paces above were measured in an emulator, " +
          "and none of the five games has been run on a real console yet " +
          "(the one program the native route has been shown running on " +
          "hardware is the maintainer's PCEHero intro; docs/NATIVE.md)." },
      { type: "h3", text: "Idioms that compile fast", source: "docs/" +
          "ORIGINAL-CODE-IDIOMS.md, docs/ROUTINE-BENCH.md" },
      { type: "table", headers: ["idiom", "why", "refusal it avoids"],
        rows: idiomRows },
      { type: "code", lang: "lua", text: RULE_IDIOM_CODE },
      { type: "h3", text: "Common refusals and the fix",
        source: "renderer/pce-cgen.js, renderer/pce-ilbc.js, " +
                "renderer/pce-validate.js, renderer/pce-rom.js" },
      { type: "table", headers: ["code", "meaning", "fix"],
        rows: fixRows },
      { type: "h3", text: "A toy template", source: "tests/check-rom-" +
          "rules.js compiles and exports this template" },
      { type: "p", text: "A toy built on this shape passes both routes " +
          "today: rom_check clean, the " + rom.ILVM_BYTES +
          " B interpreter plus one data bank, and the bytecode well under " +
          "the bank." },
      { type: "code", lang: "lua", text: RULE_TEMPLATE },
      { type: "h3", text: "The preflight checklist" },
      { type: "p", text: rulePreflight() }
    ];
  }

  /* The one section the reference pushes as the rom-rules topic, and the
   * one tools/docs.js appends to the Writing-for-the-ROM chapter of the
   * guide and the Claude Code manual. */
  function romRulesSection() {
    return { id: "rom-rules", title: "ROM rules",
             blocks: romRulesBlocks() };
  }

  function romSection() {
    return {
      id: "writing-for-the-rom",
      title: "Writing for the ROM",
      blocks: romWritingBlocks().concat(romRulesBlocks(),
                                        hardwareDesignBlocks())
    };
  }

  /* ---- the hardware-design topic ---------------------------------------- *
   *
   * A short plain page on what a game on this hardware looks like: the
   * limits with their numbers, and what to do at each one.  Every number
   * is read from the module that enforces it; the ranges real HuCards use
   * are in my own words from docs/HUCARD-BUDGETS.md, each carrying the
   * sentence of that study it comes from (`doc`) so
   * tests/check-hardware-design.js can hold it to the study. */
  var HW_COMMERCIAL = {
    activeSprites: { text: "most of the time a shipped shooter shows five " +
        "to 45 sprites, with a few reaching the whole table",
        doc: "5–45 active entries" },
    busiestLine: { text: "half the games measured never put more than " +
        "eight to 14 strips on one line",
        doc: "8–14 strips" },
    spritePalettes: { text: "shooters use nine to 16 sprite palettes " +
        "against two to six background ones",
        doc: ["9–16 sprite palettes", "2–6 BG palettes"] },
    rasterSplits: { text: "zero to three raster writes a frame is normal " +
        "and twelve the most seen",
        doc: "0–3 per frame, 12 at the extreme" },
    sceneVram: { text: "a shipped scene holds roughly 5,000 to 23,000 " +
        "words of tiles and sprite patterns in VRAM",
        doc: "5,000–23,000 VRAM words" },
    frameWrites: { text: "an ordinary frame writes only zero to 256 of " +
        "them", doc: "0–256 words" },
    psgWrites: { text: "a typical music driver writes about 35 PSG " +
        "registers a frame, all in one burst",
        doc: "about 35 PSG writes per frame" },
    frameShare: { text: "shipped games spend 15 to 67 percent of a " +
        "frame on their own work, and the guideline is to stay under " +
        "70 percent",
        doc: ["15–67% of it", "under 70% of 119,660 cycles"] },
    maps: { text: "shipped games use background maps from 32 by 32 up to " +
        "64 by 64 cells; this toy contract has the 32 by 32 one",
        doc: "32x32 to 64x64 cells" }
  };

  /* The IL ops a author pays for most, priced by the validator's model. */
  var HW_COST_OPS = [
    ["arith", "an add, subtract, shift or mask"],
    ["cmp", "a compare"],
    ["call", "a call to a local function"],
    ["mul", "a multiply"],
    ["sat", "one sat() word"],
    ["pal", "one pal() colour"],
    ["reg", "one reg() write"],
    ["sfx", "an sfx() or music() call"],
    ["sfxfx", "an sfx_fx(), sfx_noise(), sfx_slide() or sfx_preset() call"]
  ];

  /* The three example toys, with the usage keys their header comments list
   * (tests/check-hardware-design.js re-measures them). */
  var HW_EXAMPLES = [
    { file: "toys/examples/shooter.lua", what: "a shooter: a ship, four " +
      "bullets and four falling rocks, with sound effects" },
    { file: "toys/examples/platformer.lua", what: "a platformer: a hero " +
      "that runs and jumps over a pit onto three ledges" },
    { file: "toys/examples/raster-scroll.lua", what: "a raster-scroll toy: " +
      "one background layer cut into four bands scrolling at four speeds" }
  ];

  function hardwareFigures() {
    var bpp = Math.round(Math.log(editor.ENTRIES) / Math.log(2));
    var tileWords = editor.TILE * editor.TILE * bpp / 16;
    var cellWords = editor.STRIP_PX * editor.STRIP_PX * bpp / 16;
    var scene = { tiles: 256, patterns: 24 };
    scene.words = host.BAT_WORDS + scene.tiles * tileWords +
                  scene.patterns * cellWords;
    scene.percent = Math.round(scene.words * 100 / host.VRAM_WORDS);
    var model = validate.MODEL;
    var cost = HW_COST_OPS.map(function (o) {
      var cycles = model.OP_CYCLES[o[0]];
      return { op: o[0], what: o[1], cycles: cycles,
               perFrame: Math.floor(model.FRAME_CLOCKS / cycles) };
    });
    return { bpp: bpp, tileWords: tileWords, cellWords: cellWords,
             scene: scene, cost: cost,
             interpRaster: Math.round(model.ROUTE1.RASTER),
             interpPlain: Math.round(model.ROUTE1.NO_RASTER),
             halfRate: host.FRAME_HZ / 2,
             songAverage: Math.floor(songbank.TRAILER / songbank.MAX_SONGS),
             noise: songbank.NOISE_CHANNELS };
  }

  function hardwareDesignBlocks() {
    var f = hardwareFigures();
    var M = validate.MODEL;
    var C = HW_COMMERCIAL;
    var sizeRows = editor.SPRITE_SIZES.map(function (z) {
      return [z.width + " x " + z.height,
              z.cells * f.cellWords + " words",
              String(z.width / editor.STRIP_PX)];
    });
    var costRows = f.cost.map(function (c) {
      return [c.what, c.cycles + " cycles", "about " + c.perFrame];
    });
    var exampleRows = HW_EXAMPLES.map(function (e) {
      return [e.file, e.what];
    });
    return [
      { type: "p", text: "A game on this hardware is small and strict, and " +
          "every limit below is checked: validate and rom_check report it " +
          "and name the refusal. Stay under the numbers and the game " +
          "plays; the numbers come from the code, and the figures about " +
          "shipped games are ranges from the maintainer's own cards, " +
          "measured in an emulator." },

      { type: "h3", text: "One background layer, and raster splits",
        source: "renderer/pce-toyhost.js, renderer/pce-editor.js" },
      { type: "p", text: "There is one background layer: a map of " +
          host.BAT_WORDS + " cells (" + (host.WIDTH / editor.TILE) +
          " by " + (host.WIDTH / editor.TILE) + " tiles of " + editor.TILE +
          " by " + editor.TILE + " pixels), and " + C.maps.text + ". " +
          "Parallax is made by raster splits: a raster entry changes " +
          "BXR, BYR or CR from one display line down, so a layer cut " +
          "into bands scrolls each band at its own speed. A frame has " +
          host.VDW_LINES + " display lines and one entry a line; " +
          C.rasterSplits.text + ". Register the entries from frame() " +
          "with raster(line, spec): it is cheap, and the ROM carries it. " +
          "Wrap every scroll with a power-of-two remainder (BXR is " +
          host.REGISTERS[0].bits + " bits)." },

      { type: "h3", text: "Sprites: " + host.SAT_ENTRIES + " in all, " +
          editor.LINE_STRIPS + " strips on a line",
        source: "renderer/pce-editor.js SPRITE_SIZES, renderer/pce-toyhost.js" },
      { type: "p", text: "The sprite table holds " + host.SAT_ENTRIES +
          " entries. A sprite is cut into strips " + editor.STRIP_PX +
          " pixels wide, and a display line draws at most " +
          editor.LINE_STRIPS + " strips: the rest of the line's sprites " +
          "are dropped. That line limit is the one that bites, not the " +
          "table: " + C.activeSprites.text + ", and " + C.busiestLine.text +
          "." },
      { type: "table", headers: ["sprite size", "VRAM for its pattern",
                                 "strips it costs on a line"],
        rows: sizeRows },
      { type: "p", text: "What to do. Stay under the line limit and no work " +
          "is needed: validate counts the strips per line and refuses " +
          "validate-sprite-line. Park idle sprites off the screen " +
          "(a SAT Y far below the picture) so they cost nothing. Keep " +
          "rows clear: do not line up more sprites than fit on one row " +
          "(spread enemies over different heights). A sprite " +
          editor.STRIP_PX + " pixels wide costs one strip, the cheapest. " +
          "If you must " +
          "show more than a line holds, multiplex: rotate which sprites " +
          "take the first places in the table each frame so the dropped " +
          "ones change, and the loss shows as flicker. Real games either " +
          "accept a steady drop or flicker on purpose; a toy should not " +
          "need either." },

      { type: "h3", text: "Palettes", source: "renderer/pce-editor.js" },
      { type: "p", text: "There are " + editor.PALETTES + " background " +
          "palettes and " + editor.SPRITE_PALETTES + " sprite palettes, " +
          "each of " + editor.ENTRIES + " colours; entry 0 of a " +
          "palette is transparent. A colour is 3 bits each of red, green " +
          "and blue (rgb(r, g, b), each 0 to " + (host.CRAM_WORD_MAX >> 6) +
          "). The sprite half " +
          "is the scarce one: " + C.spritePalettes.text + ". Give " +
          "each enemy kind a palette and reuse one pattern for " +
          "several colour schemes." },

      { type: "h3", text: "Tiles and VRAM", source: "renderer/pce-toyhost.js, " +
          "renderer/pce-editor.js" },
      { type: "p", text: "VRAM is " + host.VRAM_WORDS + " words shared by " +
          "the map, the tiles and the sprite patterns. A tile of " +
          editor.TILE + " by " + editor.TILE + " pixels costs " +
          f.tileWords + " words; a " + editor.STRIP_PX + " by " +
          editor.STRIP_PX + " sprite pattern costs " + f.cellWords +
          " words; the map costs " + host.BAT_WORDS + ". A small scene " +
          "of " + f.scene.tiles + " tiles and " + f.scene.patterns +
          " sprite patterns costs " + f.scene.words + " words, " +
          f.scene.percent + " percent of VRAM; " + C.sceneVram.text +
          ". Draw the scene once in init(); in a shipped game " +
          C.frameWrites.text + " VRAM words. Re-use tiles and recolour " +
          "them with palettes before drawing more." },

      { type: "h3", text: "Music and sound", source: "renderer/pce-psg.js, " +
          "renderer/pce-songbank.js, renderer/pce-toyhost.js" },
      { type: "p", text: "The sound chip has " + psg.CHANNELS + " channels, " +
          "each playing a " + psg.WAVE_STEPS + "-step waveform of " +
          "5-bit samples. Noise is possible on two channels only: " +
          f.noise.join(" and ") + " (counting from 0). The other " +
          "channels play waveforms. music(n) plays the n-th song of the " +
          "song bank and uses the channels the song uses; sfx(channel, " +
          "freq, volume, frames) takes one channel for a square-wave " +
          "effect for up to " + host.SFX_FRAMES_MAX + " frames and gives " +
          "it back to the song; release(channel) gives it back at once. " +
          "A ROM carries up to " + songbank.MAX_SONGS + " songs in one " +
          "song bank of " + songbank.TRAILER + " bytes, about " +
          f.songAverage + " bytes each if they share it evenly; a " +
          "longer song takes more of the others' room, and an overfull " +
          "bank is refused with toy-song-bank-full. In a ROM toy use a " +
          "MIDI number with note(), never a name. For the song itself " +
          "the real drivers are small: " + C.psgWrites.text + ". For a " +
          "drum or any hit, use sfx_preset(\"hit\", " + f.noise[0] +
          ") or sfx_noise() on a noise channel (the sound chapter " +
          "lists the presets). The sound-guide topic has the wave " +
          "instruments, what each call costs per frame, and which " +
          "effects a ROM carries." },

      { type: "h3", text: "Speed: the frame budget",
        source: "renderer/pce-validate.js MODEL" },
      { type: "p", text: "A video frame is " + M.FRAME_CLOCKS + " CPU " +
          "cycles at " + host.FRAME_HZ + " Hz. frame() plus every " +
          "raster call has to fit in that for " + host.FRAME_HZ + " frames " +
          "a second. A toy that needs more than one frame's cycles runs " +
          "below " + host.FRAME_HZ + " Hz (" + f.halfRate + " Hz at " +
          "two frames' worth), and validate reports the rate as " +
          "validate-slow-frame. Past " + M.HARD_FRAMES + " frames the " +
          "validator refuses it (validate-frame-budget). For scale, " +
          C.frameShare.text + ". Typical costs, by the validator's model " +
          "of compiled code:" },
      { type: "table", headers: ["operation", "cost", "how many fit in one " +
          "frame (alone)"], rows: costRows },
      { type: "p", text: "The interpreter ROM that Export builds is " +
          "slower than the model: a toy with no raster hook costs about " +
          f.interpPlain + " times the model, one with a raster hook about " +
          f.interpRaster + " times. The usage report's " +
          "frame_fraction is the model's; interpreter_frame_fraction is " +
          "the interpreter's estimate. Cut the work: powers of two for " +
          "divide and remainder, a table cell read once into a local, " +
          "constants for sprite specs, and raster(line, spec) rather " +
          "than a raster(line) callback." },

      { type: "h3", text: "Three complete examples", source: "toys/examples/" },
      { type: "p", text: "Each passes validate and export_pce, and its " +
          "header lists the budgets it uses so you can read the margin " +
          "before you grow it." },
      { type: "table", headers: ["file", "what it is"], rows: exampleRows },

      { type: "h3", text: "The self-check: the usage report" },
      { type: "p", text: "validate and rom_check both return a usage " +
          "object. Read it after every change: sprites (used of " +
          host.SAT_ENTRIES + "), sprite_strips_on_busiest_line (of " +
          editor.LINE_STRIPS + "), vram_words (non-zero words of " +
          host.VRAM_WORDS + ", with the highest address written), " +
          "bg_palettes and sprite_palettes (of " + editor.PALETTES +
          "), raster_entries (of " + host.VDW_LINES + "), " +
          "frame_fraction (of one frame), and, from rom_check, " +
          "bytecode_bytes (of " + rom.SONG_TABLE_OFF + "), registers, " +
          "functions, globals and table_slots against the interpreter's " +
          "limits. Stop adding at " + romcheck.NEAR_PERCENT + " percent " +
          "of any of them." }
    ];
  }

  function hardwareDesignSection() {
    return { id: "hardware-design", title: "Designing for the hardware",
             blocks: hardwareDesignBlocks() };
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
    var sfxNoise = host.SFX.NOISE_CHANNELS;
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
            "ones HuTrack's engine makes, one VBlank per frame. " +
            "renderer/pce-seq.js songsFromFiles is what turns a toy's files " +
            "into that list: song.json (the SEQUENCER's own document) and " +
            "any playable songs.json entry, compiled by the sequencer's " +
            "model. The MCP server hands a toy the songs its files carry, " +
            "and so does the studio when a toy is opened from its file, so " +
            "music(0) plays the song a game ships with; a toy with no song " +
            "file is refused music-range. sfx() and note() remain the way an " +
            "effect takes a channel from the song (recipe 4)." },
        { type: "p", text: "The player writes the song's wave instruments " +
            "through the PSG's 32-step waveforms. The SEQUENCER's two noise " +
            "drums (kick and snare) are its own R7 writes on channels 4 and 5; " +
            "the toy's music() engine does not make them yet (pce-song.js " +
            "does not do the noise effect), so a drum sounds as its volume " +
            "envelope on a wave channel — use sfx() for a percussion hit." },
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
        { type: "p", text: "Effects: sfx_preset(name, channel) is the call " +
            "to reach for, with no numbers to tune: " +
            host.SFX.presetNames().join(", ") + ". The name is a " +
            "constant string; an unknown one is sfx-preset (il-sfx-preset " +
            "in the validator and the export). The presets are rows of " +
            "renderer/pce-sfx.js, which the studio's AUDIO panel plays and " +
            "the browser, the exported ROM and the native ROM all read " +
            "(tests/check-sfx-fx.js proves the same PSG writes). Noise " +
            "presets (hit, explosion) need channel " +
            sfxNoise.join(" or ") + ". F is a divider: a rising pitch " +
            "slides F down. An effect lasts 1.." + host.SFX.FRAMES_MAX +
            " frames." },
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
          "end" },
        { type: "code", lang: "lua", text:
          "function frame(t, f)\n" +
          "  if pad[1].i then sfx_preset(\"jump\", 0) end\n" +
          "  if f % 120 == 0 then sfx_slide(1, 400, 150, 22, 20) end\n" +
          "end" }
      ]
    });

    /* 8b. the sound guide ------------------------------------------------ */
    var guideWaves = host.SFX.WAVE_NAMES.map(function (n, i) {
      return [String(i), n, i === 1 ? "the PSG's noise generator: channels " +
        sfxNoise.join(" and ") + " only; no wave is loaded" :
        "a " + psg.WAVE_STEPS + "-step, 5-bit wave loaded into the channel"];
    });
    var guidePresets = host.SFX.PRESETS.map(function (p) {
      return [p.name, host.SFX.WAVE_NAMES[p.wave], p.frames + " frames",
              p.wave === host.SFX.WAVE_NOISE ? "channel " + sfxNoise.join(" or ") : "any channel"];
    });
    sections.push({
      id: "sound-guide", title: "Sound guide: what the chip does and what a call costs",
      blocks: [
        { type: "p", text: "Read this before you write a toy that makes sound. " +
            "It says what the PC Engine's sound chip can do, which calls reach " +
            "it from a toy, what each costs per frame, and which of them an " +
            "exported ROM carries. Every call below exists and behaves the " +
            "same in the studio, in the exported interpreter ROM and in the " +
            "natively compiled ROM; a call a ROM cannot carry is refused by " +
            "validate with a code, never dropped. tests/check-sfx-fx.js " +
            "proves the PSG register writes equal on all three." },

        { type: "h3", text: "What the chip can do" },
        { type: "table", headers: ["part", "what it is", "from a toy"],
          rows: [
            [psg.CHANNELS + " channels", "each plays one " + psg.WAVE_STEPS +
             "-step waveform of 5-bit samples at its own frequency (F, a 12-bit " +
             "divider) and its own level (AL, 0.." + host.SOUND_VOLUME_MAX + ")",
             "sfx(), sfx_fx(), a song"],
            ["waveform RAM", "one " + psg.WAVE_STEPS + "-step wave per channel, " +
             "loaded by writing the steps in order; the wave IS the instrument",
             "sfx_fx's wave 0.." + host.SFX.WAVE_MAX + "; a song's own wavetables"],
            ["noise", "a pseudo-random generator on channels " +
             sfxNoise.join(" and ") + " only (counting from 0), with a 5-bit rate",
             "sfx_noise(), sfx_fx wave 1, the hit and explosion presets"],
            ["DDA", "a channel written one sample at a time (sampled sound); " +
             "it costs about a third of the frame in real games",
             "not carried: a song with samples is refused song-pcm"],
            ["LFO", "channel 1's frequency modulated by channel 0 (vibrato, " +
             "wobble)", "not carried: lfo() and sfx_lfo() are refused " +
             "(sfx-lfo in the studio, il-unsupported in validate and the export). " +
             "The SFX hand-off turns the LFO off whenever it reserves channel 0 or 1, " +
             "and the interpreter has no op for it; for a pitch sweep use sfx_slide " +
             "or sfx_fx"]
          ] },

        { type: "h3", text: "The calls, what each costs, and whether it exports" },
        { type: "p", text: "Costs are CPU cycles of the HuC6280 per video frame " +
            "(a frame is about 119,000), measured on the native route in an " +
            "emulator (docs/NATIVE-SOUND.md); the interpreter ROM runs the same " +
            "glue. Every call here exports, in the interpreter ROM that Export " +
            "builds and in the native ROM." },
        { type: "table", headers: ["call", "what it costs", "notes"],
          rows: [
            ["music(n)", "the song's tick costs about 15,500 cycles a frame on average " +
             "(13 percent of a frame) for the sequencer's demo song, up to about 38,000 on " +
             "the busiest row; the frame the song starts about 70,000",
             "up to " + songbank.MAX_SONGS + " songs, " + songbank.TRAILER +
             " bytes together; a song with effect columns is refused song-fx"],
            ["sfx(ch, freq, volume, frames)", "the frame it starts uploads the " +
             "32-step square: about 7,000 cycles, one frame", "a flat square"],
            ["sfx_fx(...) and its short forms", "about 400 cycles a frame while it plays; " +
             "6,800 to 8,200 on the frame a tone effect starts (the wave upload); " +
             "a noise effect starts cheaper, with three register writes",
             "six at once is about 3 percent of a frame; an effect lasts 1.." +
             host.SFX.FRAMES_MAX + " frames; a channel past 5, a noise effect off " +
             "channels " + sfxNoise.join(" or ") + ", or a wave past " +
             host.SFX.WAVE_MAX + " is sfx-range"],
            ["sfx_preset(name, ch)", "as sfx_fx", "a row of one table, no numbers to tune"],
            ["release(ch)", "a few register writes; not measured on its own",
             "the song waits for its next note on that channel"],
            ["note(midi)", "a table read", "returns F; a MIDI number in a ROM toy"]
          ] },
        { type: "p", text: "A register-driver music engine in a commercial game " +
            "writes about 35 PSG registers a frame; sample players take a third " +
            "of the frame. Budget for the song's tick first, then count effects at " +
            "about 400 cycles each; stagger starts so two tone effects do not begin " +
            "on the same frame." },

        { type: "h3", text: "Wave instruments" },
        { type: "p", text: "sfx_fx's wave argument is the instrument. The same " +
            "32-byte tables are in renderer/pce-sfx.js (the studio) and in the " +
            "interpreter's glue (the ROM); a test compares them byte for byte. " +
            "note() gives a pitch, not a wave, so a note on a wave is " +
            "sfx_fx(ch, wave, note(m), note(m), volume, 0, decay, frames). A " +
            "song's own instruments carry their wavetables in the song and play " +
            "as written." },
        { type: "table", headers: ["wave", "name", "what it is"], rows: guideWaves },

        { type: "h3", text: "The presets" },
        { type: "table", headers: ["preset", "wave", "length", "channels"],
          rows: guidePresets },

        { type: "h3", text: "Music effects: what is carried and what is not" },
        { type: "p", text: "The song format and HuTrack's engine know arpeggio, " +
            "slides, vibrato, volume slides, cuts and delays, but a toy's songs " +
            "must play the same in the studio and the ROM, and the studio's " +
            "player does not model the effect columns yet: a song that uses any " +
            "is refused with song-fx (an arpeggio envelope song-arp, samples " +
            "song-pcm) when it is loaded, so no sound is silently dropped. The " +
            "same sounds, made with the hand-off, are carried on all three routes:" },
        { type: "table", headers: ["music effect", "in a song", "on the hand-off"],
          rows: [
            ["pitch slide up or down", "refused song-fx", "sfx_slide(), or sfx_fx's from and to"],
            ["volume slide, fade in, fade out", "refused song-fx", "sfx_fx's attack and decay"],
            ["note cut", "the song's own cut row is carried", "release(ch), or the effect's frames"],
            ["note delay", "refused song-fx", "start the effect on the frame you want"],
            ["vibrato, tremolo", "refused song-fx", "not carried (the LFO is refused too); " +
             "call sfx_slide again each few frames if you must, at the start cost each time"],
            ["arpeggio", "refused song-fx / song-arp", "call sfx_fx with the next note each " +
             "frame or two, at the start cost each time"]
          ] },

        { type: "h3", text: "Three short example toys", source: "toys/examples/" },
        { type: "p", text: "Each passes validate and export_pce; tests/check-sound-guide.js " +
            "plays each with scripted button presses." },
        { type: "table", headers: ["file", "what it is"],
          rows: [
            ["toys/examples/sound-jump-shoot.lua", "a jump (the jump preset) and a shot whose voice " +
             "(saw, organ, bass) you pick with left and right"],
            ["toys/examples/song-effects/", "a song with a sweeping sine, a bass drop and a coin " +
             "on the channels the song shares, taken and given back by the hand-off"],
            ["toys/examples/noise-explosion.lua", "the noise generator: the explosion and hit " +
             "presets, and a held hiss"]
          ] }
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

    /* 10. writing for the ROM --------------------------------------------- */
    sections.push({
      id: "writing-for-the-rom",
      title: "Writing for the ROM",
      blocks: romWritingBlocks()
    });

    /* 11. the ROM rules (the rom-rules docs topic) ------------------------ */
    sections.push(romRulesSection());
    sections.push(hardwareDesignSection());

    /* 12. refusals -------------------------------------------------------- */
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
        "renderer/pce-ilbc.js", "renderer/pce-rom.js",
        "renderer/pce-romcheck.js", "renderer/pce-song.js"
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

  /* One section as HTML, the same markup html() puts in the page.  Exported
   * because tools/docs.js writes the ROM chapter into the Claude Code manual
   * (renderer/claude-code.html) from it: one renderer, no second copy. */
  function htmlSection(sec) {
    var body = '<section id="' + sec.id + '">\n<h2>' + esc(sec.title) +
               "</h2>\n";
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
    return body + "</section>\n";
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
      body += htmlSection(ref.sections[s]);
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
    htmlSection: htmlSection,
    romSection: romSection,
    romWritingBlocks: romWritingBlocks,
    romRulesSection: romRulesSection,
    hardwareDesignSection: hardwareDesignSection,
    /* The hardware-design topic's data, for tests/check-hardware-design.js */
    HARDWARE_DESIGN: {
      commercial: HW_COMMERCIAL,
      examples: HW_EXAMPLES,
      figures: hardwareFigures
    },
    /* The rom-rules data, for tests/check-rom-rules.js to hold to the
     * code: every named refusal is one the code raises, every number a
     * module constant. */
    ROM_RULES: {
      budgets: ruleBudgets,
      state: RULE_STATE,
      stateWindow: STATE_WINDOW,
      idioms: RULE_IDIOMS,
      fixes: ruleFixes,
      template: RULE_TEMPLATE,
      idiomCode: RULE_IDIOM_CODE,
      preflight: rulePreflight
    },
    refusalIndex: refusalIndex,
    REFUSAL_GROUPS: REFUSAL_GROUPS
  };
});
