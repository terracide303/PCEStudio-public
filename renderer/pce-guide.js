/*
 * pce-guide.js — "PCEStudio for Claude": the guide a tester pastes into a
 * chat AI, which then leads them to a Lua toy that runs in the browser
 * studio (card #105).
 *
 * Build-time only (Node), like tools/docs.js.  It does not describe the
 * runtime a second time: the API chapters are renderer/pce-docs.js's
 * reference (#61), which reads every range and refusal out of the module
 * that enforces it, and the example listings are the toys/ files themselves.
 * The hand-written part is the conversation: the role, how to run the
 * dialogue, the hardware's limits and their reasons, and the mistakes a
 * first toy makes.
 *
 *   node tools/docs.js --claude          write renderer/pcestudio-for-claude.md
 *   node tools/docs.js --check           exit 1 unless both generated pages
 *                                        (docs.html and the guide) are current
 *
 * tests/check-guide.js proves the guide is the generator's bytes, that its
 * API names and ranges track the code's tables, that every example runs,
 * and that a fresh seat given only this file can make a working toy.
 *
 * The timer (#45) is deliberately absent: that work is landing in the same
 * checkout as this card, and the guide must generate identically from HEAD
 * and from the working tree.  Every table read here is one HEAD already
 * carries.  A timer chapter can be added with the timer's own commit.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const docs = require("./pce-docs.js");
const host = require("./pce-toyhost.js");
const editor = require("./pce-editor.js");
const toys = require("./pce-toys.js");
const il = require("./pce-il.js");
const psg = require("./pce-psg.js");
const validate = require("./pce-validate.js");

const ROOT = path.resolve(__dirname, "..");
const TOY_FILES = ["parallax.lua", "sky-gradient.lua", "road.lua",
                   "status-bar.lua", "palette-cycle.lua"];

/* The last line of every answer that contains code (card #105's routing
 * note: the button name exactly). */
const COPY_LINE = "Copy this code, then press Paste & Run in the studio";
const STUDIO_URL = "https://pcestudio.terracides.com";

const REFUSALS_A_BEGINNER_HITS = [
  "reg-forbidden", "reg-range", "pal-range", "vram-range", "sat-range",
  "sprite-range", "raster-line", "raster-line-full", "pad-range",
  "il-pad-write",
  "music-range", "sfx-range", "no-psg", "password-value", "password-code",
  "tile-space", "validate-rom", "cgen-op",
  "toy-timeout", "toy-error",
  "il-syntax", "il-op", "il-string", "il-mixed",
  "il-method", "il-for-in", "il-undefined", "il-arity"
];

function num(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function p(text) { return { type: "p", text: text }; }
function h3(text) { return { type: "h3", text: text }; }
function code(lang, text) { return { type: "code", lang: lang, text: text }; }
function table(headers, rows, tight) {
  return { type: "table", headers: headers, rows: rows, tight: tight };
}

/* ---- the starter program ------------------------------------------------ */

/* A complete file, not a fragment: one sprite the pad moves on a solid
 * field.  It is deliberately not a starfield — the cold-seat test asks for
 * one, and a guide that already contains the answer proves nothing. */
const STARTER = `-- main.lua — one 16x16 sprite you can move, on a solid field.
-- A complete file: replace the studio's whole main.lua with this.

-- A background character is 16 VRAM words: word 0..7 hold pixel bits 0/1
-- (bit 7 is column 0, bit 15 is column 0 of bit 1), word 8..15 hold bits 2/3.
-- fn(col, row) returns a colour number 0..15.
local function puttile(char, fn)
  for row = 0, 7 do
    local w0, w1 = 0, 0
    for col = 0, 7 do
      local c = fn(col, row)
      if c % 2 >= 1 then w0 = w0 | (1 << (7 - col)) end
      if c >= 2 and (c % 4) >= 2 then w0 = w0 | (1 << (15 - col)) end
      if c >= 4 and (c % 8) >= 4 then w1 = w1 | (1 << (7 - col)) end
      if c >= 8 then w1 = w1 | (1 << (15 - col)) end
    end
    vram[char * 16 + row] = w0
    vram[char * 16 + 8 + row] = w1
  end
end

-- A sprite pattern is 64 VRAM words, NOT a background character: pattern p
-- starts at word p*64, plane n at p*64 + n*16 + row, leftmost pixel in bit
-- 15.  This is the layout section 7.1 describes getting wrong.
local function putsprite(pattern, fn)
  for row = 0, 15 do
    local p0, p1, p2, p3 = 0, 0, 0, 0
    for col = 0, 15 do
      local c = fn(col, row)
      if c % 2 >= 1 then p0 = p0 | (1 << (15 - col)) end
      if c >= 2 and (c % 4) >= 2 then p1 = p1 | (1 << (15 - col)) end
      if c >= 4 and (c % 8) >= 4 then p2 = p2 | (1 << (15 - col)) end
      if c >= 8 then p3 = p3 | (1 << (15 - col)) end
    end
    vram[pattern * 64 + row] = p0
    vram[pattern * 64 + 16 + row] = p1
    vram[pattern * 64 + 32 + row] = p2
    vram[pattern * 64 + 48 + row] = p3
  end
end

function init()
  pal(0, rgb(0, 0, 0))        -- CRAM[0] is the backdrop, seen through colour 0
  pal(1, rgb(0, 1, 3))        -- background palette 0, colour 1: deep blue
  pal(0x101, rgb(7, 7, 2))    -- sprite palette 0, colour 1: yellow

  puttile(0x40, function(col, row) return 1 end)

  -- Fill the BAT: 32 columns x 28 visible rows, cell = char | palette << 12.
  for row = 0, 27 do
    for col = 0, 31 do vram[row * 32 + col] = 0x40 end
  end

  putsprite(0x100, function(col, row)
    local dx, dy = col - 7, row - 7
    if dx * dx + dy * dy < 40 then return 1 end
    return 0                    -- colour 0 in a sprite is transparent
  end)

  reg("CR", 0xC0)             -- 0x80 background on + 0x40 sprites on
  sx, sy = 144, 160           -- SAT X 32 / Y 64 is the display's top-left
end

function frame(t, f)
  if pad[1].left then sx = sx - 2 end
  if pad[1].right then sx = sx + 2 end
  if pad[1].up then sy = sy - 2 end
  if pad[1].down then sy = sy + 2 end
  if sx < 32 then sx = 32 end
  if sx > 32 + 240 then sx = 32 + 240 end
  if sy < 64 then sy = 64 end
  if sy > 64 + 208 then sy = 64 + 208 end
  -- SAT entry 0 is four words: Y, X, pattern<<1, palette | flags.  Written
  -- with sat() because sprite(0, { ... }) takes a table, which the console
  -- export cannot lower (section 8); sat() is the same four hardware words.
  sat(0, 0, sy)               -- Y
  sat(0, 1, sx)               -- X
  sat(0, 2, 0x100 << 1)       -- pattern 0x100, the SAT stores it shifted
  sat(0, 3, 0)                -- palette 0, no flips
end
`;

/* ---- generated rows ----------------------------------------------------- */

function limitsRows() {
  const M = validate.MODEL;
  const fr = host.SAT_FIELD_RANGES;
  return [
    ["the picture", host.WIDTH + " x " + host.HEIGHT + " pixels, " +
     host.VDW_LINES + " display lines",
     "the VDC window the studio runs: 32 x 28 BAT cells of 8 x 8 pixels"],
    ["VRAM", num(host.VRAM_WORDS) + " words (64 KiB)",
     "the HuC6270's video RAM. The BAT is words 0..1023; tiles start at " +
     "word 0x400 (character 0x40), so a background character below 0x40 " +
     "would overwrite the map."],
    ["colours", num(editor.VCE_COLOURS) + " colour entries, 9 bits each",
     "the VCE stores three bits per channel: 8 green x 8 red x 8 blue = 512 " +
     "colours. That ceiling is the hardware's, not a setting."],
    ["palettes", editor.PALETTES + " background palettes of " +
     editor.ENTRIES + ", " + editor.SPRITE_PALETTES + " sprite palettes of " +
     editor.SPRITE_ENTRIES,
     "a BAT cell's 4 palette bits name one of the 16 background palettes; a " +
     "sprite's attribute word names one of the 16 sprite palettes (CRAM " +
     "0x100..0x1FF). A pixel's colour number is only 4 bits, so one palette " +
     "can never hold more than 16 of the 512 colours."],
    ["sprites on one line", editor.LINE_STRIPS + " strips of " +
     editor.STRIP_PX + " pixels (" + editor.LINE_STRIPS * editor.STRIP_PX +
     " pixels)",
     "the VDC's line buffer collects 16 16-pixel strips. A 16-px-wide sprite " +
     "asks for one, a 32-px-wide sprite two. Sprites past the 16th strip on a " +
     "line are dropped, not refused — the picture just loses them."],
    ["sprites in the table", host.SAT_ENTRIES + " entries of " +
     host.SAT_WORDS + " words",
     "the SAT is a hardware table at VRAM $7F00; the VDC parses at most 64 " +
     "entries a frame."],
    ["raster changes", "one entry per line, at most " + host.RASTER_WRITES_MAX +
     " colour writes on that line",
     "the per-line trigger is the VDC's RCR interrupt (there is no HDMA). It " +
     "fires once per display line, and on the console its handler has about " +
     validate.MODEL.RCR_BLANK + " CPU cycles of horizontal blank to work in."],
    ["frame time", "about " + num(validate.MODEL.FRAME_CLOCKS) +
     " CPU cycles at 60 Hz",
     "7.16 MHz / 60. The console ticket prices frame() plus every raster() " +
     "call against this; a browser frame has " + toys.BUDGET_MS + " ms."],
    ["the browser's guard", toys.BUDGET_MS + " ms per hook, " +
     num(il.MAX_INSTRUCTIONS) + " IL instructions",
     "the runtime refuses a hook past its budget (toy-timeout); a loop that " +
     "never ends in frame() would otherwise freeze the tab."],
    ["the cartridge", "1 MB (" + num(validate.MODEL.ROM_LIMIT) + " bytes)",
     "a HuCard's address space; the validator refuses an estimated ROM past " +
     "it (validate-rom)."],
    ["tiles in a ROM", editor.MAX_TILES + " tiles",
     "the ROM layout reserves banks for 8 x 8 tiles."],
    ["sound", psg.CHANNELS + " PSG channels, " + psg.WAVE_STEPS +
     "-step waves of 5-bit samples",
     "the HuC6280's programmable sound generator; channels 4 and 5 can be " +
     "noise instead of a tone."]
  ];
}

function apiRows() {
  const P = toys.PASSWORD;
  const F = host.SAT_FIELD_RANGES;
  const rows = [];
  rows.push(["init()", "runs once, after the file's top-level code",
             "optional"]);
  rows.push(["frame(t, f)", "runs every video frame; t = f/60 seconds, f = " +
             "the frame number", "optional"]);
  rows.push(["raster(line)", "runs for every display line 0.." +
             (host.VDW_LINES - 1) + " after frame(), for per-line changes",
             "optional; defining it selects the callback form"]);
  for (const r of host.REGISTERS) {
    rows.push(["reg(\"" + r.name + "\", v)", r.what,
               "0.." + r.max + " (" + r.bits + " bits); reg-range"]);
  }
  rows.push(["reg(name, v)", "a register a toy may not write",
             "reg-forbidden"]);
  rows.push(["pal(addr, word)", "writes one VCE colour entry",
             "addr 0.." + (host.CRAM_ENTRIES - 1) + ", word 0.." +
             host.CRAM_WORD_MAX + "; pal-range"]);
  rows.push(["rgb(r, g, b)", "builds a colour word from three channels",
             "each channel 0..7 (masked)"]);
  rows.push(["vram[addr] = word", "writes one VDC VRAM word",
             "addr 0.." + (host.VRAM_WORDS - 1) + ", word 0..65535; " +
             "vram-range"]);
  rows.push(["sat(i, k, v)", "writes one raw sprite-attribute word",
             "i 0.." + (host.SAT_ENTRIES - 1) + ", k 0.." +
             (host.SAT_WORDS - 1) + ", v 0..65535; sat-range"]);
  rows.push(["sprite(i, spec)", "composes SAT entry i from a table {x, y, " +
             "pattern, palette, spbg, cgx, hflip, cgy, vflip}",
             "x 0.." + F.x[1] + ", y 0.." + F.y[1] + ", pattern 0.." +
             F.pattern[1] + ", palette 0.." + F.palette[1] + ", cgy 0.." +
             F.cgy[1] + ", the rest true/false; sprite-range"]);
  rows.push(["raster(line, spec)", "registers one line's entry: " +
             "{bxr, byr, cr, cram = {{addr, word}, ...}}",
             "line 0.." + (host.VDW_LINES - 1) + "; one entry per line and " +
             "at most " + host.RASTER_WRITES_MAX + " colour writes on it; " +
             "raster-line, raster-line-full"]);
  rows.push(["pad[n].<button>", "controller n, read-only, refreshed before " +
             "frame()",
             "n 1.." + host.PAD_COUNT + "; " + host.PAD_FIELDS.join(", ")]);
  for (const a of host.SOUND_API) rows.push([a.call, a.what, a.limits]);
  rows.push(["password.pack(v) / password.unpack(code)",
             "a save as a short code starting " + P.prefix,
             "an integer " + P.minInt + ".." + P.maxInt + ", a string of at " +
             "most " + P.maxString + " bytes, a table of at most " +
             P.maxItems + " entries nested " + P.maxDepth + " deep; " +
             "password-value, password-code"]);
  rows.push(["print(...)", "one line in the studio's log",
             "at most " + host.LOG_MAX + " lines"]);
  rows.push(["helpers", "min, max, floor, sin, cos, abs, sqrt, pi, clamp, " +
             "lerp, lerp_color, ease, ramp, ramp_int, ramp_color",
             "already defined; do not implement them again"]);
  return rows;
}

/* ---- the guide ---------------------------------------------------------- */

function guide() {
  const ref = docs.reference();
  const byId = {};
  for (const s of ref.sections) byId[s.id] = s;

  /* The sprite patterns the default layout leaves free: after the BAT and
   * before the SAT.  Read from the host's/editor's own layout constants. */
  const firstPattern = host.BAT_WORDS / 64;
  const lastPattern = editor.SAT_ADDR / 64 - 1;

  const sections = [];

  /* 0. the tool route, before anything else (#142) ----------------------- */
  sections.push({
    id: "mcp", title: "If you are Claude Code: drive PCEStudio yourself",
    blocks: [
      p("Everything below assumes a chat AI with no tools: the person pastes " +
        "your code, runs it and tells you what they see. If you are Claude " +
        "Code and can run commands, skip that loop and do it yourself. Write " +
        "the toy, run it, look at a frame, check it, export it — without " +
        "asking anyone to paste anything."),
      p("Install it once, one of two ways. The repository is public, so " +
        "with git, clone it:"),
      code("sh", "git clone https://github.com/terracide303/PCEStudio-public"),
      p("and <folder> is the PCEStudio-public folder the clone makes. Without git, " +
        "download pcestudio-mcp.zip from " + STUDIO_URL +
        "/pcestudio-mcp.zip, unzip it, and <folder> is the pcestudio-mcp " +
        "folder the unzip makes. Either way, run these in a terminal:"),
      code("sh",
        "claude mcp add pcestudio -- node <folder>/tools/mcp/server.js\n" +
        "mkdir -p ~/.claude/skills\n" +
        "ln -s <folder>/plugin/skills/creating-pce-toys " +
        "~/.claude/skills/creating-pce-toys"),
      p("The server needs Node and nothing else: no npm install, no " +
        "compiler. The link is the skill that ships beside it (SKILL.md and " +
        "seven worked recipes). Skills load when a session starts, so start a " +
        "new Claude Code session after this."),
      h3("The tools"),
      table(["tool", "what it does"], [
        ["toy_write", "replace the session's toy: a file set whose main.lua runs"],
        ["toy_run", "run it frame by frame, with an optional pad script; " +
                    "returns registers, the raster shape, VRAM/CRAM/SAT hashes " +
                    "and what each PSG channel played"],
        ["source_add", "turn a PNG or a pixel grid with a palette into the " +
                       "toy's tiles, sprites, a tilesheet or a palette, or a " +
                       ".mid into its song.json, before toy_run; returns the " +
                       "VRAM/CRAM budget"],
        ["song_write", "compose the toy's song.json from a step list with the " +
                       "SEQUENCER's built-in instruments; music(0) plays it"],
        ["frame_png", "the picture at a frame, as a PNG you can look at"],
        ["validate", "check it against the hardware's limits, with file:line " +
                     "findings"],
        ["export_pce", "build the HuCard .pce from the same IL the studio runs"],
        ["docs", "the reference chapters, generated from the runtime's tables"],
        ["registers_get", "read a VDC, VCE or PSG register with its range"],
        ["register_set", "set a view override frame_png applies (and clears)"]
      ]),
      p("Work the loop the skill teaches: docs(topic) for the API (do not " +
        "guess names), toy_write, toy_run, frame_png to look, validate, " +
        "export_pce. Add art with source_add before toy_run: a base64 PNG or " +
        "a pixel grid with its palette becomes the toy's tiles, sprites, a " +
        "tilesheet or a palette, merged into its asset files, and the reply " +
        "is the VRAM/CRAM budget — toy_run imports those files into VRAM, " +
        "CRAM and the SAT before init(), exactly as the studio does. Add " +
        "music with song_write (or source_add kind song for a .mid): it " +
        "writes song.json and music(0) plays it, while toy_run's sound report " +
        "says what started on each channel. A toy " +
        "that runs without errors does not mean it looks right: look at the " +
        "frame."),
      p("No tools at all? Ignore this section. Sections 1 to 11 are the " +
        "paste-and-run route and work the same.")
    ]
  });

  /* 1. the role ---------------------------------------------------------- */
  sections.push({
    id: "role", title: "1. Your job",
    blocks: [
      p("You are helping someone make a PC Engine toy for PCEStudio."),
      p("PCEStudio is a browser studio at " + STUDIO_URL + ". A toy is one " +
        "Lua file, main.lua. The person pastes or types it into the editor, " +
        "presses Paste & Run (or Run), and the file runs frame by frame " +
        "against an emulated PC Engine: a HuC6270 VDC, a HuC6260 VCE and a " +
        "HuC6280 PSG. The picture is " + host.WIDTH + " x " + host.HEIGHT +
        " pixels. Nothing is installed and nothing is compiled for them."),
      p("Your job is not to write the biggest toy. It is to get one small " +
        "toy running on their screen, then grow it one step at a time, with " +
        "the person telling you what they see after each step. You cannot " +
        "see their screen and you cannot run their browser: only they can " +
        "report what happened."),
      p("Rules that keep the conversation working:"),
      p("- Always give the WHOLE main.lua, never a fragment or a diff: the " +
        "studio runs one file, and a person pasting a piece of a file " +
        "breaks it."),
      p("- Use only the calls in this guide. If a call is not here, it does " +
        "not exist; do not invent ppu.toys or SNES API."),
      p("- Keep the code inside the cartridge-ready Lua subset in section 8 " +
        "(integers, no string values, and tables only if the person does " +
        "not need a cartridge). The studio's Check button compiles the same " +
        "file through its IL and refuses what that subset refuses."),
      p("- Never say the toy works. Ask the person what they see, or for the " +
        "error line, and then say what you think is happening.")
    ]
  });

  /* 2. the conversation -------------------------------------------------- */
  sections.push({
    id: "conversation", title: "2. How to run the conversation",
    blocks: [
      p("Move through these steps in order. Do not skip to code before step " +
        "2: a toy that answers a different question is worse than a small " +
        "one that works."),
      p("1. Ask what they want. Two questions are enough: what should be on " +
        "the screen, and what should they press or watch change? If they " +
        "are vague (\"something cool\"), offer three small choices and let " +
        "them pick — for example a starfield, a scrolling road, a bouncing " +
        "sprite."),
      p("2. Propose the smallest first version in one sentence. A toy that " +
        "fills the screen with one colour and moves one sprite is a good " +
        "first version; the rest is the next version."),
      p("3. Write the complete main.lua. Start from a complete file " +
        "(section 5), not from scratch: the helpers and the BAT fill are " +
        "already right there. Keep the first version under about 80 lines."),
      p("4. Tell them exactly how to run it: open " + STUDIO_URL + ", copy " +
        "the code into the editor (or press Paste & Run with it on the " +
        "clipboard), and press Run. Tell them to click the picture once " +
        "before using the pad keys, because the canvas has to have focus."),
      p("5. Ask them to report what they see. Ask for one of three things, " +
        "and be specific about which:"),
      p("   - what the picture shows (colours, shapes, where the sprite is);"),
      p("   - the red error line under the picture / the CONSOLE tab's " +
        "findings: it begins with a refusal code and names file:line, for " +
        "example `toy-error: main.lua:42: ...`;"),
      p("   - a screenshot."),
      p("6. Fix the named line, not the whole file. If the message names " +
        "line 42, change line 42 or what feeds it; re-send the whole file " +
        "and go back to step 4."),
      p("7. Grow it one feature at a time: a second sprite, a sound, a " +
        "per-line effect. After each feature the person runs it and reports " +
        "again. Stop when they are happy."),
      p("End every answer that contains code with this exact line, on its " +
        "own:"),
      p("**" + COPY_LINE + "**"),
      p("If they paste an error back, read the refusal code first: section 9 " +
        "says what each one means. A message with no code is usually a Lua " +
        "error inside their edit; the file:line is still there.")
    ]
  });

  /* 3. limits ------------------------------------------------------------ */
  sections.push({
    id: "limits", title: "3. The PC Engine's limits, and why",
    blocks: [
      p("The toy runs on hardware with hard ceilings. Every one below is a " +
        "physical limit of the VDC/VCE/PSG, or a limit the studio enforces " +
        "because the console would. Design inside them instead of " +
        "discovering them as errors."),
      table(["limit", "number", "why"], limitsRows())
    ]
  });

  /* 4. the API ----------------------------------------------------------- */
  sections.push({
    id: "api", title: "4. The toy API",
    blocks: [
      p("These are the names and ranges the runtime enforces. A value past a " +
        "range is refused with the code in the last column, never silently " +
        "clamped. The chapters in section 10 give each one in more detail."),
      table(["call", "what it does", "range / refusal"], apiRows()),
      p("Defaults: the screen starts with a blank VDC — " + host.WIDTH + " x " +
        host.HEIGHT + ", MWR 0 (a 32 x 32 BAT), BXR = BYR = 0, CR = 0x80 " +
        "(background on, sprites OFF), and every VRAM, CRAM and SAT word " +
        "zero. That last default is why a sprite does not appear until " +
        "reg(\"CR\", 0xC0)."),
      p("Keyboard: the studio's keys are I/J/K/L for the D-pad directions " +
        "up/left/down/right, N and M for the two fire buttons, O for Select " +
        "and P for Run, after a click on the picture. A pad FIELD names a pad " +
        "BUTTON, and a button's name is not always its key: pad[1].i is the I " +
        "button, pressed with keyboard key N, while pad[1].up is the Up " +
        "direction, pressed with keyboard key I. So never tell the person to " +
        "\"press I\": say \"the I button (key N)\" or \"Up (key I)\". Pad[" +
        2 + "]..pad[" + host.PAD_COUNT + "] exist for a multitap and are not " +
        "driven by the studio's keyboard.")
    ]
  });

  /* 5. the starter ------------------------------------------------------- */
  sections.push({
    id: "start", title: "5. A complete first program",
    blocks: [
      p("This file is complete and runs as it is. Copy it whole, then change " +
        "one thing at a time. puttile writes a background character and " +
        "putsprite writes a 16 x 16 sprite pattern; both encode the " +
        "hardware's bitplane layout, which is the part first toys get " +
        "wrong. It is also inside the cartridge subset: the sprite is placed " +
        "with four sat() words because sprite(i, spec) takes a table, and the " +
        "console back end cannot lower tables (section 8)."),
      code("lua", STARTER),
      p("What to point at when it does not show: reg(\"CR\", 0xC0) turns " +
        "sprites on; pal(0x101, ...) is sprite palette 0 colour 1, the " +
        "colour the sprite's pixels name; the BAT cell 0x40 | palette << 12 " +
        "is what makes the background tile appear.")
    ]
  });

  /* 6. examples ---------------------------------------------------------- */
  const exampleBlocks = [
    p("Five complete toys, each one classic effect and the trick that makes " +
      "it. They are the files in toys/ and they run in the studio. Read the " +
      "one closest to what the person asked for, then cut it down to the " +
      "smallest version and grow it; do not paste all five.")
  ];
  const toyTitles = {
    "parallax.lua": "Line-scroll parallax — four bands, four BXR values",
    "sky-gradient.lua": "A sky gradient — the palette moves, not the tiles",
    "road.lua": "A pseudo-3D road — BYR picks a row, BXR bends it",
    "status-bar.lua": "A fixed status bar — an RCR split at line 24",
    "palette-cycle.lua": "Palette cycling — water and fire by rotating colours"
  };
  for (const name of TOY_FILES) {
    const source = fs.readFileSync(path.join(ROOT, "toys", name), "utf8");
    exampleBlocks.push(h3(toyTitles[name] + " (toys/" + name + ")"));
    exampleBlocks.push(code("lua", source));
  }
  sections.push({ id: "examples", title: "6. Five worked examples",
                  blocks: exampleBlocks });

  /* 7. mistakes ---------------------------------------------------------- */
  sections.push({
    id: "mistakes", title: "7. Common mistakes",
    blocks: [
      h3("1. A sprite pattern is not a background tile"),
      p("The BAT addresses a tile with 16 VRAM words (vram[char * 16 + row]). " +
        "The SAT addresses a sprite pattern with 64 words: pattern p starts " +
        "at word p * 64, plane n at p * 64 + n * 16 + row, and bit 15 of a " +
        "plane word is the strip's left pixel. Writing vram[p * 16 + row] " +
        "for a sprite leaves the pattern the SAT reads empty, so the sprite " +
        "is invisible even though the code \"wrote a pattern\". Use the " +
        "putsprite helper in section 5. The hardware does not check where a " +
        "pattern lives, so the usable numbers are set by the two tables it " +
        "must not overwrite: in the default layout the BAT owns VRAM words " +
        "0.." + (host.BAT_WORDS - 1) + " (patterns 0.." + (firstPattern - 1) +
        ") and the SAT owns $7F00..$7FFF (patterns " + (lastPattern + 1) +
        ".." + (lastPattern + 4) + "). A sprite pattern is therefore " + firstPattern +
        ".." + lastPattern + " — and your background tiles share that space, " +
        "because character 0x40 starts at word 0x400 (pattern " + firstPattern +
        "), so keep tiles and patterns apart: the starter uses tile 0x40 and " +
        "sprite pattern 0x100."),
      h3("2. Colour 0 is the backdrop, and sprite colour 0 is transparent"),
      p("A background pixel whose colour number is 0 shows CRAM[0] — the " +
        "backdrop — whatever palette its cell named. A sprite pixel whose " +
        "colour number is 0 shows nothing at all. So pal(0, ...) changes the " +
        "whole background behind every transparent pixel, and drawing a " +
        "shape in colour 0 draws nothing. Use colour 1..15 for pixels you " +
        "want to see and give colour 0 a deliberate value."),
      h3("3. Sprites are off until the control register says otherwise"),
      p("The blank VDC starts with CR = 0x80: the background is on and the " +
        "sprite layer is not. reg(\"CR\", 0xC0) turns both on. This is the " +
        "single most common \"my sprite is invisible\" cause after the " +
        "pattern layout."),
      h3("4. Raster work is per line, and small"),
      p("raster(line) is called once for each of the " + host.VDW_LINES +
        " lines, every frame. It is a line interrupt on the console, with " +
        "about " + validate.MODEL.RCR_BLANK + " cycles of blank to run in, " +
        "not a place for loops, VRAM writes or allocations. One entry per " +
        "line (a second is raster-line-full), at most " +
        host.RASTER_WRITES_MAX + " colour writes on it, and the table's " +
        "frame-start latch takes the last line's registers — so line 0 " +
        "usually has to restate its own value. Prefer a few register or " +
        "palette writes to a picture's worth of work."),
      h3("5. Write VRAM and the SAT in init() or frame(), not in raster()"),
      p("The per-line handler journals registers and palette writes. A VRAM " +
        "or SAT write there is both slow and outside what the console's " +
        "line handler can do. Draw tiles once in init(), move sprites in " +
        "frame(), and use raster() only for the per-line registers and " +
        "colours."),
      h3("6. A pad is a held state, not an event"),
      p("pad[1].i is true for every frame the I button is held — the I " +
        "BUTTON, keyboard key N; pad[1].up is the Up direction, key I. Name " +
        "which you mean. If an action should fire once, remember the previous " +
        "frame: `if pad[1].i and not was_i then ... end; was_i = pad[1].i`."),
      h3("7. Integers, not fractions"),
      p("Stay in whole numbers: `x // 16`, not `x / 16` or 1.5. The studio's " +
        "IL is a fixed-point machine and refuses or diverges on mixes " +
        "(il-mixed), and integer maths makes a frame reproducible. t is " +
        "f/60 seconds, but prefer f when you need a frame count."),
      h3("8. No strings, and keep tables simple"),
      p("The cartridge subset has no string values (il-string). A table the " +
        "toy builds can now be read back in the browser (t[i] and t.x run in " +
        "both runtimes), but the console export has no tables yet, so a toy " +
        "that must become a cartridge should fill tables with constant keys " +
        "and read them back through constants (the toys do), or use separate " +
        "globals. for i = a, b, step do is fine; pairs/ipairs are not."),
      h3("9. print() is not the browser console"),
      p("print(...) adds a line to the studio's log, not to devtools. It is " +
        "useful, but a print in frame() runs 60 times a second and fills the " +
        "log; print once, or when something changes.")
    ]
  });

  /* 8. the subset -------------------------------------------------------- */
  sections.push({
    id: "cartridge", title: "8. Keep it cartridge-ready",
    blocks: [
      p("The studio's Check compiles the file through PCEStudio's IL, the " +
        "same intermediate language that becomes a .pce cartridge. A toy " +
        "written inside it runs identically in the browser and on the " +
        "console; a toy outside it still runs in the browser but cannot be " +
        "exported. Keep to these rules from the first version:"),
      p("- Integers only. No 1.5, no x / y (use x // y). sin/cos/sqrt exist " +
        "for the browser but return fractions; the console uses fixed point. " +
        "The safest toys use f and integer arithmetic."),
      p("- Numbers stay inside 32 bits (about -2,000,000,000..2,000,000,000)."),
      p("- No string used as a value. A string is allowed as reg's name and " +
        "in print, not in a variable."),
      p("- Tables: the IL reads them back (t[i], t.x), but pce-cgen, the " +
        "console back end, does not lower tables at all (cgen-op), so a toy " +
        "with a table read runs in the browser and will not export. sprite(i, " +
        "spec) is a table too: place sprites with sat() words (section 5) when " +
        "the toy must export. The worked examples fill a table with constants " +
        "and do not read it back; keep to that if the person wants a " +
        "cartridge."),
      p("- No method calls (:), no varargs (...), no pairs/ipairs, and no " +
        "multiple return values. Use for i = a, b, step do and plain " +
        "functions."),
      p("- A named function must be defined before it is called, in the " +
        "same file."),
      p("The refused constructs come back by code (il-syntax, il-op, " +
        "il-string, il-mixed, il-method, il-for-in, il-undefined, il-arity); " +
        "a browser-only toy fails Check with one of those.")
    ]
  });

  /* 9. errors ------------------------------------------------------------ */
  const index = docs.refusalIndex();
  const errorRows = [];
  for (const c of REFUSALS_A_BEGINNER_HITS) {
    if (index[c]) errorRows.push([c, index[c].description]);
  }
  sections.push({
    id: "errors", title: "9. When it goes wrong",
    blocks: [
      p("Every refusal is a named failure, not a silent drop: the studio " +
        "shows `code: file:line: message` (or the error line under the " +
        "picture). Read the code first, then the line, then fix the value or " +
        "the construct. The codes a first toy meets, and the ones its " +
        "cartridge export can raise:"),
      table(["code", "meaning"], errorRows),
      p("If the person reports \"nothing happens\" with no error: the toy is " +
        "running and drawing nothing visible. Check, in order, CR (sprites " +
        "off?), the sprite pattern layout (section 7.1), the BAT fill (a " +
        "blank BAT is a blank screen even with CR on), and colour 0.")
    ]
  });

  /* 10. the generated reference ------------------------------------------ */
  const refBlocks = [
    p("The chapters below are generated from the runtime's own tables by " +
      "node tools/docs.js, and this whole file is generated from the same " +
      "tables plus sections 1-9: a range or a refusal code cannot drift " +
      "from the code without failing tests/check-guide.js.")
  ];
  const refIds = ["the-toy", "registers", "palettes", "sprites", "raster",
                  "pads", "passwords", "sound", "budgets"];
  let n = 1;
  for (const id of refIds) {
    const sec = byId[id];
    if (!sec) continue;
    refBlocks.push(h3("10." + (n++) + " " + sec.title));
    for (const b of sec.blocks) refBlocks.push(b);
  }
  sections.push({ id: "reference",
                  title: "10. The reference, generated from the code",
                  blocks: refBlocks });

  /* 11. closing ---------------------------------------------------------- */
  sections.push({
    id: "closing", title: "11. Before you answer",
    blocks: [
      p("Check the code against this list before sending it: the whole file; " +
        "only calls from section 4; integers; reg(\"CR\", 0xC0) before the " +
        "first sprite; the BAT filled; sprite patterns through putsprite; " +
        "the raster callback a few writes per line; no string values; no " +
        "table reads if the toy must export."),
      p("Then end with the line the person needs in order to run it:"),
      p("**" + COPY_LINE + "**"),
      p("Ask what they see. You are done when the picture on their screen is " +
        "the one they asked for, not when the code looks right.")
    ]
  });

  return {
    title: "PCEStudio for Claude",
    intro: "A guide a chat AI reads before it helps someone make a PC Engine " +
           "toy for PCEStudio (" + STUDIO_URL + "). Paste the whole file " +
           "into the chat. Sections 1-9 are hand-written; section 10 is " +
           "generated from the runtime's own tables, and the examples are " +
           "the toys/ files themselves.",
    footer: "Generated by node tools/docs.js --claude: the API chapters from " +
            "renderer/pce-docs.js, which reads every range and refusal " +
            "out of the module that enforces it; the examples from toys/. " +
            "Do not edit this file by hand — tests/check-guide.js regenerates " +
            "it and fails on a hand-written number.",
    sources: ref.sources.concat(["renderer/pce-guide.js", "toys/*.lua",
                                 "tools/mcp/server.js (the tool names)"]),
    sections: sections
  };
}

function markdown() {
  return docs.markdown(guide());
}

function wordCount() {
  return markdown().split(/\s+/).filter(Boolean).length;
}

module.exports = {
  guide: guide,
  markdown: markdown,
  wordCount: wordCount,
  COPY_LINE: COPY_LINE,
  STUDIO_URL: STUDIO_URL,
  STARTER: STARTER,
  TOY_FILES: TOY_FILES,
  REFUSALS_A_BEGINNER_HITS: REFUSALS_A_BEGINNER_HITS
};
