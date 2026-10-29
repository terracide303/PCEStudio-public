# PCEStudio for Claude

A guide a chat AI reads before it helps someone make a PC Engine toy for PCEStudio (https://pcestudio.terracides.com). Paste the whole file into the chat. Sections 1-9 are hand-written; section 10 is generated from the runtime's own tables, and the examples are the toys/ files themselves.

## If you are Claude Code: drive PCEStudio yourself

Everything below assumes a chat AI with no tools: the person pastes your code, runs it and tells you what they see. If you are Claude Code and can run commands, skip that loop and do it yourself. Write the toy, run it, look at a frame, check it, export it — without asking anyone to paste anything.

Install it once, one of two ways. The repository is public, so with git, clone it:

```sh
git clone https://github.com/terracide303/PCEStudio-public
```

and <folder> is the PCEStudio-public folder the clone makes. Without git, download pcestudio-mcp.zip from https://pcestudio.terracides.com/pcestudio-mcp.zip, unzip it, and <folder> is the pcestudio-mcp folder the unzip makes. Either way, run these in a terminal:

```sh
claude mcp add pcestudio -- node <folder>/tools/mcp/server.js
mkdir -p ~/.claude/skills
ln -s <folder>/plugin/skills/creating-pce-toys ~/.claude/skills/creating-pce-toys
```

The server needs Node and nothing else: no npm install, no compiler. The link is the skill that ships beside it (SKILL.md and six worked recipes). Skills load when a session starts, so start a new Claude Code session after this.

### The tools

| tool | what it does |
| --- | --- |
| toy_write | replace the session's toy: a file set whose main.lua runs |
| toy_run | run it frame by frame, with an optional pad script; returns registers, the raster shape and VRAM/CRAM/SAT hashes |
| source_add | turn a PNG or a pixel grid with a palette into the toy's tiles, sprites, a tilesheet or a palette, before toy_run; returns the VRAM/CRAM budget |
| frame_png | the picture at a frame, as a PNG you can look at |
| validate | check it against the hardware's limits, with file:line findings |
| toy_save | save the whole toy — code, art, songs — as one .pce.json the person opens in the studio |
| export_pce | build the HuCard .pce from the same IL the studio runs |
| docs | the reference chapters, generated from the runtime's tables |
| registers_get | read a VDC, VCE or PSG register with its range |
| register_set | set a view override frame_png applies (and clears) |

Work the loop the skill teaches: docs(topic) for the API (do not guess names), toy_write, toy_run, frame_png to look, validate, export_pce. Add art with source_add before toy_run: a base64 PNG or a pixel grid with its palette becomes the toy's tiles, sprites, a tilesheet or a palette, merged into its asset files, and the reply is the VRAM/CRAM budget — toy_run imports those files into VRAM, CRAM and the SAT before init(), exactly as the studio does. A toy that runs without errors does not mean it looks right: look at the frame.

**Finish with toy_save.** It writes one .pce.json holding every file — main.lua, the art source_add made, the named sources and the songs — in the studio's own Save format, inside the folder the server runs in (a path outside it is refused). Then tell the person: open PCEStudio, press Open… → From file…, pick that file — or drop it on the page — and the game plays with its art. Without this step you can only hand over the code, and everything source_add imported stays behind.

No tools at all? Ignore this section. Sections 1 to 11 are the paste-and-run route and work the same.

## 1. Your job

You are helping someone make a PC Engine toy for PCEStudio.

PCEStudio is a browser studio at https://pcestudio.terracides.com. A toy is one Lua file, main.lua. The person pastes or types it into the editor, presses Paste & Run (or Run), and the file runs frame by frame against an emulated PC Engine: a HuC6270 VDC, a HuC6260 VCE and a HuC6280 PSG. The picture is 256 x 224 pixels. Nothing is installed and nothing is compiled for them.

Your job is not to write the biggest toy. It is to get one small toy running on their screen, then grow it one step at a time, with the person telling you what they see after each step. You cannot see their screen and you cannot run their browser: only they can report what happened.

Rules that keep the conversation working:

- Always give the WHOLE main.lua, never a fragment or a diff: the studio runs one file, and a person pasting a piece of a file breaks it.

- Use only the calls in this guide. If a call is not here, it does not exist; do not invent ppu.toys or SNES API.

- Keep the code inside the cartridge-ready Lua subset in section 8 (integers, no string values, and tables only if the person does not need a cartridge). The studio's Check button compiles the same file through its IL and refuses what that subset refuses.

- Never say the toy works. Ask the person what they see, or for the error line, and then say what you think is happening.

## 2. How to run the conversation

Move through these steps in order. Do not skip to code before step 2: a toy that answers a different question is worse than a small one that works.

1. Ask what they want. Two questions are enough: what should be on the screen, and what should they press or watch change? If they are vague ("something cool"), offer three small choices and let them pick — for example a starfield, a scrolling road, a bouncing sprite.

2. Propose the smallest first version in one sentence. A toy that fills the screen with one colour and moves one sprite is a good first version; the rest is the next version.

3. Write the complete main.lua. Start from a complete file (section 5), not from scratch: the helpers and the BAT fill are already right there. Keep the first version under about 80 lines.

4. Tell them exactly how to run it: open https://pcestudio.terracides.com, copy the code into the editor (or press Paste & Run with it on the clipboard), and press Run. Tell them to click the picture once before using the pad keys, because the canvas has to have focus.

5. Ask them to report what they see. Ask for one of three things, and be specific about which:

   - what the picture shows (colours, shapes, where the sprite is);

   - the red error line under the picture / the CONSOLE tab's findings: it begins with a refusal code and names file:line, for example `toy-error: main.lua:42: ...`;

   - a screenshot.

6. Fix the named line, not the whole file. If the message names line 42, change line 42 or what feeds it; re-send the whole file and go back to step 4.

7. Grow it one feature at a time: a second sprite, a sound, a per-line effect. After each feature the person runs it and reports again. Stop when they are happy.

End every answer that contains code with this exact line, on its own:

**Copy this code, then press Paste & Run in the studio**

If they paste an error back, read the refusal code first: section 9 says what each one means. A message with no code is usually a Lua error inside their edit; the file:line is still there.

## 3. The PC Engine's limits, and why

The toy runs on hardware with hard ceilings. Every one below is a physical limit of the VDC/VCE/PSG, or a limit the studio enforces because the console would. Design inside them instead of discovering them as errors.

| limit | number | why |
| --- | --- | --- |
| the picture | 256 x 224 pixels, 224 display lines | the VDC window the studio runs: 32 x 28 BAT cells of 8 x 8 pixels |
| VRAM | 32,768 words (64 KiB) | the HuC6270's video RAM. The BAT is words 0..1023; tiles start at word 0x400 (character 0x40), so a background character below 0x40 would overwrite the map. |
| colours | 512 colour entries, 9 bits each | the VCE stores three bits per channel: 8 green x 8 red x 8 blue = 512 colours. That ceiling is the hardware's, not a setting. |
| palettes | 16 background palettes of 16, 16 sprite palettes of 16 | a BAT cell's 4 palette bits name one of the 16 background palettes; a sprite's attribute word names one of the 16 sprite palettes (CRAM 0x100..0x1FF). A pixel's colour number is only 4 bits, so one palette can never hold more than 16 of the 512 colours. |
| sprites on one line | 16 strips of 16 pixels (256 pixels) | the VDC's line buffer collects 16 16-pixel strips. A 16-px-wide sprite asks for one, a 32-px-wide sprite two. Sprites past the 16th strip on a line are dropped, not refused — the picture just loses them. |
| sprites in the table | 64 entries of 4 words | the SAT is a hardware table at VRAM $7F00; the VDC parses at most 64 entries a frame. |
| raster changes | one entry per line, at most 64 colour writes on that line | the per-line trigger is the VDC's RCR interrupt (there is no HDMA). It fires once per display line, and on the console its handler has about 123 CPU cycles of horizontal blank to work in. |
| frame time | about 119,318 CPU cycles at 60 Hz | 7.16 MHz / 60. The console ticket prices frame() plus every raster() call against this; a browser frame has 100 ms. |
| the browser's guard | 100 ms per hook, 5,000,000 IL instructions | the runtime refuses a hook past its budget (toy-timeout); a loop that never ends in frame() would otherwise freeze the tab. |
| the cartridge | 1 MB (1,048,576 bytes) | a HuCard's address space; the validator refuses an estimated ROM past it (validate-rom). |
| tiles in a ROM | 1536 tiles | the ROM layout reserves banks for 8 x 8 tiles. |
| sound | 6 PSG channels, 32-step waves of 5-bit samples | the HuC6280's programmable sound generator; channels 4 and 5 can be noise instead of a tone. |

## 4. The toy API

These are the names and ranges the runtime enforces. A value past a range is refused with the code in the last column, never silently clamped. The chapters in section 10 give each one in more detail.

| call | what it does | range / refusal |
| --- | --- | --- |
| init() | runs once, after the file's top-level code | optional |
| frame(t, f) | runs every video frame; t = f/60 seconds, f = the frame number | optional |
| raster(line) | runs for every display line 0..223 after frame(), for per-line changes | optional; defining it selects the callback form |
| reg("BXR", v) | background horizontal scroll, in pixels (VDC R07) | 0..1023 (10 bits); reg-range |
| reg("BYR", v) | background vertical scroll, in lines (VDC R08) | 0..511 (9 bits); reg-range |
| reg("CR", v) | control: BB background on (bit 7), SB sprites on (bit 6), and the VDC interrupt enables (RC bit 2 is the line interrupt) | 0..255 (8 bits); reg-range |
| reg(name, v) | a register a toy may not write | reg-forbidden |
| pal(addr, word) | writes one VCE colour entry | addr 0..511, word 0..511; pal-range |
| rgb(r, g, b) | builds a colour word from three channels | each channel 0..7 (masked) |
| vram[addr] = word | writes one VDC VRAM word | addr 0..32767, word 0..65535; vram-range |
| sat(i, k, v) | writes one raw sprite-attribute word | i 0..63, k 0..3, v 0..65535; sat-range |
| sprite(i, spec) | composes SAT entry i from a table {x, y, pattern, palette, spbg, cgx, hflip, cgy, vflip} | x 0..1023, y 0..1023, pattern 0..1023, palette 0..15, cgy 0..3, the rest true/false; sprite-range |
| raster(line, spec) | registers one line's entry: {bxr, byr, cr, cram = {{addr, word}, ...}} | line 0..223; one entry per line and at most 64 colour writes on it; raster-line, raster-line-full |
| pad[n].<button> | controller n, read-only, refreshed before frame() | n 1..5; up, down, left, right, i, ii, select, run |
| note(name or MIDI) | the PSG's 12-bit F divider for a note name (Lua only) or a MIDI number (both runtimes); feed it to sfx() | a MIDI number 0..127; the result is clamped to 0..4095, and the IL carries no strings so a cartridge uses the number |
| music(index) | plays song index from the start — the whole engine restarts, as HuTrack's playSong does | an index into the songs the runtime was given (0..songs-1) |
| sfx(channel, freq, volume, frames) | takes the channel (HuTrack's reserve), loads a 32-step square, sets F = freq and AL = volume, and gives it back after frames | channel 0..5, freq 0..4095, volume 0..31, frames 1..600 |
| release(channel) | gives a channel back now (HuTrack's release): control and noise off, and the music waits for a fresh note on it | channel 0..5; a channel no SFX owns is left alone |
| password.pack(v) / password.unpack(code) | a save as a short code starting P1 | an integer -1073741824..1073741823, a string of at most 64 bytes, a table of at most 32 entries nested 6 deep; password-value, password-code |
| print(...) | one line in the studio's log | at most 200 lines |
| helpers | min, max, floor, sin, cos, abs, sqrt, pi, clamp, lerp, lerp_color, ease, ramp, ramp_int, ramp_color | already defined; do not implement them again |

Defaults: the screen starts with a blank VDC — 256 x 224, MWR 0 (a 32 x 32 BAT), BXR = BYR = 0, CR = 0x80 (background on, sprites OFF), and every VRAM, CRAM and SAT word zero. That last default is why a sprite does not appear until reg("CR", 0xC0).

Keyboard: the studio's keys are I/J/K/L for the D-pad directions up/left/down/right, N and M for the two fire buttons, O for Select and P for Run, after a click on the picture. A pad FIELD names a pad BUTTON, and a button's name is not always its key: pad[1].i is the I button, pressed with keyboard key N, while pad[1].up is the Up direction, pressed with keyboard key I. So never tell the person to "press I": say "the I button (key N)" or "Up (key I)". Pad[2]..pad[5] exist for a multitap and are not driven by the studio's keyboard.

## 5. A complete first program

This file is complete and runs as it is. Copy it whole, then change one thing at a time. puttile writes a background character and putsprite writes a 16 x 16 sprite pattern; both encode the hardware's bitplane layout, which is the part first toys get wrong. It is also inside the cartridge subset: the sprite is placed with four sat() words because sprite(i, spec) takes a table, and the console back end cannot lower tables (section 8).

```lua
-- main.lua — one 16x16 sprite you can move, on a solid field.
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

```

What to point at when it does not show: reg("CR", 0xC0) turns sprites on; pal(0x101, ...) is sprite palette 0 colour 1, the colour the sprite's pixels name; the BAT cell 0x40 | palette << 12 is what makes the background tile appear.

## 6. Five worked examples

Five complete toys, each one classic effect and the trick that makes it. They are the files in toys/ and they run in the studio. Read the one closest to what the person asked for, then cut it down to the smallest version and grow it; do not paste all five.

### Line-scroll parallax — four bands, four BXR values (toys/parallax.lua)

```lua
-- parallax.lua — line-scroll parallax.
--
-- THE TRICK: the PC Engine has no HDMA, so a horizontal offset that differs
-- per line of the picture is made by letting the RCR line interrupt write
-- BXR (the horizontal scroll register, VDC R07) once per band.  Every line
-- from a write until the next one keeps that value, so four writes per frame
-- give four bands scrolling at four speeds — the classic parallax layer.
--
-- This toy is four bands of diagonal stripe texture, 56 lines each, with one
-- bright marker bar per band.  Because each band gets its own BXR, the bars
-- stand at different x positions: the whole picture proves the split at a
-- glance, and the near band moves fastest, as a foreground should.

local BAND_ROWS = 7        -- BAT rows per band
local BAND_H = BAND_ROWS * 8   -- display lines per band (56)
local MARKER_CELL = 5      -- the map column of each band's marker bar

-- Write one 8x8 character.  `fn(col, row)` returns the colour number 0..15;
-- colour 0 is transparent (shows the backdrop).  The VDC stores a character
-- as two bitplanes of 16 words: word 0..7 hold pixel bits 0 and 1, word
-- 8..15 hold bits 2 and 3, each with the leftmost pixel in bit 7.
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

-- Fill BAT rows row0..row1 with `char` from palette `pal` (4 bits).
local function batfill(row0, row1, char, pal)
  for row = row0, row1 do
    for col = 0, 31 do
      vram[row * 32 + col] = char | (pal << 12)
    end
  end
end

function init()
  -- Backdrop: nearly black, so a transparent pixel reads as night sky.
  pal(0, rgb(0, 0, 1))

  for band = 0, 3 do
    local stripe = 0x40 + band * 2      -- diagonal texture
    local marker = 0x41 + band * 2      -- the same, with a bright bar
    puttile(stripe, function(col, row)
      return 1 + ((col + row) % 4) // 2   -- two shades, 2-px diagonal bands
    end)
    puttile(marker, function(col, row)
      if col == 3 or col == 4 then return 3 end
      return 1 + ((col + row) % 4) // 2
    end)

    -- One palette per band: 1 = the band's colour, 2 = its dark shade,
    -- 3 = the marker.  Far bands are cool and dark, near ones warm.
    pal(band * 16 + 1, rgb(1 + band * 2, 3 + band, 7 - band * 2))
    pal(band * 16 + 2, rgb(0 + band * 2, 2 + band, 5 - band * 2))
    pal(band * 16 + 3, rgb(7, 7, 6 - band))

    batfill(band * BAND_ROWS, band * BAND_ROWS + BAND_ROWS - 1, stripe, band)
    for row = band * BAND_ROWS, band * BAND_ROWS + BAND_ROWS - 1 do
      vram[row * 32 + MARKER_CELL] = marker | (band << 12)
    end
  end
end

function frame(t, f)
  -- The raster callback needs the frame number; globals persist across frames.
  g_f = f
  reg("BYR", 0)        -- no vertical scroll: screen row = map row
end

-- Called once per display line 0..223, after frame(), the way the RCR
-- interrupt runs on the console.  A write made here applies from this line
-- down until the next write — so one write per band boundary is enough.
function raster(line)
  -- Line 0 must restate the top value: the table's frame-start latch takes
  -- the last band's BXR, so the first band has to write its own.
  --
  -- BXR is 10 bits (0..1023): a value that grows with the frame number must
  -- be wrapped, or the host refuses it (reg-range) after a couple of minutes
  -- — the near band reaches 1024 at frame 1024.  `% 1024` keeps every band
  -- scrolling forever; the picture repeats, the crash does not happen.
  if line == 0 then reg("BXR", (g_f // 8) % 1024) end
  if line == BAND_H then reg("BXR", (g_f // 2) % 1024) end
  if line == BAND_H * 2 then reg("BXR", g_f % 1024) end
  if line == BAND_H * 3 then reg("BXR", (g_f * 2) % 1024) end
end

```

### A sky gradient — the palette moves, not the tiles (toys/sky-gradient.lua)

```lua
-- sky-gradient.lua — a vertical sky gradient with no gradient tiles.
--
-- THE TRICK: the VCE colour table can be rewritten during the frame, and a
-- write made in the horizontal blanking before line L shows on line L.  So
-- ONE solid tile filling the screen becomes a gradient: the RCR callback
-- writes a different colour into palette entry 1 for every line.  The only
-- tile on screen is flat colour 1; the sky is the palette moving under it.
--
-- A second colour entry draws the sun: the sun's tiles use colour 2 inside
-- the disc and colour 1 outside, so writing 2 only across the sun's 16 lines
-- keeps the disc crisp while the sky changes around it.

local SUN_TOP = 64        -- first display line of the sun's 2x2 tiles
local SUN_BOTTOM = 79     -- last display line of them

-- Write one 8x8 character.  `fn(col, row)` returns colour number 0..15;
-- colour 0 is transparent.  Planes: word 0..7 = bits 0/1, word 8..15 = 2/3,
-- leftmost pixel in bit 7.
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

-- The sky's colour at display line y: deep blue at the zenith, warm at the
-- horizon.  Integer arithmetic only, so the IL's fixed-point rules never
-- matter and both runtimes agree exactly.
local function sky(y)
  local w = rgb(y // 32, y // 56, 5 - y // 48)
  return w
end

function init()
  pal(0, rgb(0, 0, 1))     -- backdrop (never seen: the tile covers the screen)

  -- The flat sky tile: every pixel colour 1.
  puttile(0x40, function(col, row) return 1 end)

  -- The sun as four 8x8 quadrants of one 16x16 disc, colour 2 inside and
  -- colour 1 outside so it melts into the sky.
  for ty = 0, 1 do
    for tx = 0, 1 do
      puttile(0x41 + ty * 2 + tx, function(col, row)
        local dx = 2 * (tx * 8 + col) - 15
        local dy = 2 * (ty * 8 + row) - 15
        if dx * dx + dy * dy < 196 then return 2 end
        return 1
      end)
    end
  end

  -- The BAT: sky everywhere, the sun's four tiles over cells (13..14, 8..9).
  for row = 0, 27 do
    for col = 0, 31 do
      vram[row * 32 + col] = 0x40
    end
  end
  for ty = 0, 1 do
    for tx = 0, 1 do
      vram[(8 + ty) * 32 + 13 + tx] = 0x41 + ty * 2 + tx
    end
  end
end

function frame(t, f)
  g_f = f
end

-- One palette write per line is the whole picture.  Colour 1 is the sky;
-- colour 2 exists only where the sun's tiles put it, so it is written only
-- across the sun's 16 lines.
function raster(line)
  pal(1, sky(line))
  if line >= SUN_TOP and line <= SUN_BOTTOM then
    -- a slow shimmer: the sun's green channel steps 5,6,7,5,6,7 ... every
    -- 30 frames, which is just another palette write
    pal(2, rgb(7, 5 + (g_f // 30) % 3, 1))
  end
end

```

### A pseudo-3D road — BYR picks a row, BXR bends it (toys/road.lua)

```lua
-- road.lua — a pseudo-3D road from three per-line registers.
--
-- THE TRICK: there is no 3D hardware, only a scrolling tilemap and the RCR
-- interrupt.  Each of the three things it writes per line does one job:
--
--   BYR (vertical scroll) picks which ROW of the map this line shows.  The
--       map contains the road already drawn in perspective — narrow near its
--       top, wide near its bottom — so a quadratic row mapping turns "which
--       map row" into "how far away" and the road widens toward the viewer.
--   BXR (horizontal scroll) shifts the line sideways.  Growing with the
--       square of the distance below the horizon, it bends the road: zero at
--       the horizon, largest in the foreground, the way a real road curves.
--   palette writes recolour the asphalt on each line.  A dark shade near the
--       viewer, a pale haze at the horizon (distance), and periodically a
--       bright stripe.  The stripes move down the screen with the frame
--       counter, so the road appears to rush at you without any tile moving.

local HORIZON = 88        -- first display line of the road (sky above)
local SKY_ROWS = 11       -- map rows 0..10 hold the sky

-- Write one 8x8 character.  `fn(col, row)` returns colour number 0..15;
-- colour 0 is transparent.  Planes: word 0..7 = bits 0/1, word 8..15 = 2/3,
-- leftmost pixel in bit 7.
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

local function sky(y)
  local w = rgb(y // 32, y // 56, 5 - y // 48)
  return w
end

function init()
  pal(0, rgb(0, 0, 1))
  pal(1, rgb(1, 3, 7))          -- the sky's starting colour (raster rewrites it)
  pal(2, rgb(2, 2, 2))          -- asphalt (raster rewrites it per line)
  pal(3, rgb(1, 4, 1))          -- grass
  pal(4, rgb(2, 6, 2))          -- grass speckle
  pal(5, rgb(7, 7, 7))          -- road edge line
  pal(6, rgb(6, 6, 7))          -- cloud

  puttile(0x40, function(col, row) return 1 end)              -- sky
  puttile(0x41, function(col, row)                            -- cloud
    if row >= 2 and row <= 4 and col >= 1 and col <= 6 then return 6 end
    if row == 3 then return 6 end
    return 1
  end)
  puttile(0x50, function(col, row)                            -- grass, dots left
    if row == 1 and col == 2 then return 4 end
    return 3
  end)
  puttile(0x53, function(col, row)                            -- grass, dots right
    if row == 1 and col == 5 then return 4 end
    return 3
  end)
  puttile(0x51, function(col, row)                            -- left edge
    if col == 1 then return 5 end
    return 2
  end)
  puttile(0x52, function(col, row) return 2 end)              -- asphalt
  puttile(0x59, function(col, row)                            -- right edge
    if col == 6 then return 5 end
    return 2
  end)

  -- Map rows 0..10: sky, with two clouds.
  for row = 0, SKY_ROWS - 1 do
    for col = 0, 31 do
      vram[row * 32 + col] = 0x40
    end
  end
  for row = 2, 4 do
    vram[row * 32 + 5] = 0x41
    vram[row * 32 + 21] = 0x41
  end

  -- Map rows 11..31: the road in perspective.  Row r is 2*half+1 tiles wide
  -- and centred on the map, so the same texture read at a lower row is a
  -- wider piece of road — the perspective the BYR line picks from.
  for row = 11, 31 do
    -- alternating grass characters, so a line that samples a different map row
    -- shows its dots in a different place: a field, not stripes
    local grass = 0x50
    if row % 2 == 0 then grass = 0x53 end
    for col = 0, 31 do
      vram[row * 32 + col] = grass
    end
    local half = 1 + ((row - 11) * 7) // 20          -- 1..8
    for col = 16 - half, 15 + half do
      if col == 16 - half then
        vram[row * 32 + col] = 0x51
      elseif col == 15 + half then
        vram[row * 32 + col] = 0x59
      else
        vram[row * 32 + col] = 0x52
      end
    end
  end
end

function frame(t, f)
  g_f = f
  reg("BXR", 0)
  reg("BYR", 0)
end

function raster(line)
  if line < HORIZON then
    -- SKY: line n shows map row n, so the clouds sit still while BXR drifts.
    reg("BYR", line)
    reg("BXR", (g_f // 2) % 256)
    pal(1, sky(line))
  else
    -- ROAD: distance below the horizon drives all three writes.
    local dz = line - HORIZON                        -- 0 at the horizon
    reg("BYR", (11 + (dz * dz * 20) // (135 * 135)) * 8)

    local bend = (dz * dz) // 300                    -- 0..60 pixels
    if (g_f // 90) % 2 == 0 then
      reg("BXR", bend)
    else
      reg("BXR", 256 - bend)                         -- 256 - n is n px right
    end

    local haze = 4 - dz // 45                        -- pale far, dark near
    if ((dz * dz) // 40 + g_f * 4) % 48 < 12 then
      pal(2, rgb(7, 7, 5))                           -- the moving stripe
    else
      pal(2, rgb(haze, haze, haze))
    end
  end
end

```

### A fixed status bar — an RCR split at line 24 (toys/status-bar.lua)

```lua
-- status-bar.lua — a fixed status bar over a scrolling playfield.
--
-- THE TRICK: the RCR line interrupt fires on any line you choose.  Write the
-- scroll registers on line 0 (BXR = BYR = 0) and again on line 24 (the
-- playfield's scroll), and the top 24 lines stop moving: they always show map
-- rows 0..2, while everything below shows the map scrolling under them.  That
-- is a split screen with no second background layer — one BAT, one write on
-- one line.
--
-- The bar's few pixels change with the frames (a blink), so it is not simply
-- a frozen picture: only the part that is meant to hold still holds still.

local BAR_LINES = 24      -- display lines 0..23 are the status bar
local BAR_ROWS = 3        -- the bar is map rows 0..2 (24 pixels)

-- Write one 8x8 character.  `fn(col, row)` returns colour number 0..15;
-- colour 0 is transparent.  Planes: word 0..7 = bits 0/1, word 8..15 = 2/3,
-- leftmost pixel in bit 7.
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

function init()
  pal(0, rgb(0, 0, 1))
  -- palette 0: the playfield
  pal(1, rgb(0, 1, 2))
  pal(2, rgb(0, 2, 3))
  pal(3, rgb(6, 6, 7))          -- stars
  -- palette 1: the status bar (separate, so its blink cannot touch the field)
  pal(16 + 1, rgb(1, 1, 3))     -- bar background
  pal(16 + 2, rgb(4, 4, 7))     -- bar border
  pal(16 + 3, rgb(7, 6, 2))     -- the pips

  puttile(0x40, function(col, row) return 1 end)               -- bar background
  puttile(0x41, function(col, row) return 3 end)               -- a pip
  puttile(0x42, function(col, row)                             -- half segment
    if col < 4 then return 2 end
    return 1
  end)
  puttile(0x43, function(col, row) return 2 end)               -- the divider
  puttile(0x50, function(col, row)                             -- checker field
    return 1 + ((col // 4 + row // 4) % 2)
  end)
  puttile(0x51, function(col, row)                             -- a star
    if col == 3 and row == 3 then return 3 end
    return 1 + ((col // 4 + row // 4) % 2)
  end)

  -- The bar: a row of pips, a row of segments, a divider.
  for row = 0, BAR_ROWS - 1 do
    for col = 0, 31 do
      vram[row * 32 + col] = 0x40 | (1 << 12)
    end
  end
  for col = 2, 25 do
    if (col // 3) % 2 == 0 then
      vram[col] = 0x41 | (1 << 12)
    else
      vram[32 + col] = 0x42 | (1 << 12)
    end
  end
  for col = 0, 31 do
    vram[2 * 32 + col] = 0x43 | (1 << 12)
  end

  -- The playfield: a checker of stars, rows 3..31.
  for row = BAR_ROWS, 31 do
    for col = 0, 31 do
      if (row * 7 + col * 3) % 17 == 0 then
        vram[row * 32 + col] = 0x51
      else
        vram[row * 32 + col] = 0x50
      end
    end
  end
end

function frame(t, f)
  g_x = (f * 2) % 256                 -- the field scrolls right
  g_y = BAR_LINES + (f // 2) % 32     -- and down, but never above row 3
  -- blink the pips twice a second: one palette write, no tile changes
  if (f // 30) % 2 == 0 then
    pal(16 + 3, rgb(7, 6, 2))
  else
    pal(16 + 3, rgb(3, 2, 0))
  end
end

function raster(line)
  -- Line 0 restates the bar's own scroll (the table's frame-start latch takes
  -- the last value, which is the playfield's).
  if line == 0 then
    reg("BXR", 0)
    reg("BYR", 0)
  end
  -- Line 24: from here down, the map scrolls.  Everything above keeps 0.
  if line == BAR_LINES then
    reg("BXR", g_x)
    reg("BYR", g_y)
  end
end

```

### Palette cycling — water and fire by rotating colours (toys/palette-cycle.lua)

```lua
-- palette-cycle.lua — water and fire by rotating palette entries.
--
-- THE TRICK: a tilemap pixel names a palette entry, and the palette is 512
-- words in a table the CPU can rewrite at any time.  Rotating the colours
-- among a run of entries therefore animates the picture without touching a
-- tile or the map: the same six shades of blue are re-dealt to water colours
-- 1..6 every frame, and the same for the fire's four hot colours.  The tiles
-- are drawn once, in init(); everything afterwards is palette writes.
--
-- Two separate palette ranges do the two effects: the water is background
-- palette 0 (colours 1..6), the fire is palette 1 (colours 1..4), so one
-- rotation cannot spill into the other.

local WATER_ROWS = 14     -- map rows 0..13 (112 display lines) are water

-- Write one 8x8 character.  `fn(col, row)` returns colour number 0..15;
-- colour 0 is transparent (the backdrop).  Planes: word 0..7 = bits 0/1,
-- word 8..15 = 2/3, leftmost pixel in bit 7.
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

-- The six water shades, position 0..5: deep blue to pale cyan.
local function water_word(p)
  local w = rgb(0, 1 + p // 3, 2 + p)
  return w
end

-- The fire's shades, position 0..5: hot yellow-orange down to dark red.
local function fire_word(p)
  local w = rgb(7, 6 - p, p // 4)
  return w
end

function init()
  pal(0, rgb(0, 0, 0))                  -- backdrop: the fire's black sky

  -- The water tile: six shades in diagonal bands.
  puttile(0x40, function(col, row)
    return 1 + (row * 2 + col) % 6
  end)

  -- The fire tile: a ragged flame top per column, hot colours below it.
  puttile(0x41, function(col, row)
    local top = 1 + (col * 3) % 5
    if row >= top then return 1 + (row - top + col) % 4 end
    return 0
  end)

  for row = 0, 27 do
    for col = 0, 31 do
      if row < WATER_ROWS then
        vram[row * 32 + col] = 0x40              -- palette 0
      else
        vram[row * 32 + col] = 0x41 | (1 << 12)  -- palette 1
      end
    end
  end
end

function frame(t, f)
  -- Colour k shows the shade that was at k-1 last frame: the ramp slides.
  for k = 1, 6 do
    pal(k, water_word((k - 1 + f) % 6))
  end
  for k = 1, 6 do
    pal(16 + k, fire_word((k - 1 + f) % 6))
  end
end

```

## 7. Common mistakes

### 1. A sprite pattern is not a background tile

The BAT addresses a tile with 16 VRAM words (vram[char * 16 + row]). The SAT addresses a sprite pattern with 64 words: pattern p starts at word p * 64, plane n at p * 64 + n * 16 + row, and bit 15 of a plane word is the strip's left pixel. Writing vram[p * 16 + row] for a sprite leaves the pattern the SAT reads empty, so the sprite is invisible even though the code "wrote a pattern". Use the putsprite helper in section 5. The hardware does not check where a pattern lives, so the usable numbers are set by the two tables it must not overwrite: in the default layout the BAT owns VRAM words 0..1023 (patterns 0..15) and the SAT owns $7F00..$7FFF (patterns 508..511). A sprite pattern is therefore 16..507 — and your background tiles share that space, because character 0x40 starts at word 0x400 (pattern 16), so keep tiles and patterns apart: the starter uses tile 0x40 and sprite pattern 0x100.

### 2. Colour 0 is the backdrop, and sprite colour 0 is transparent

A background pixel whose colour number is 0 shows CRAM[0] — the backdrop — whatever palette its cell named. A sprite pixel whose colour number is 0 shows nothing at all. So pal(0, ...) changes the whole background behind every transparent pixel, and drawing a shape in colour 0 draws nothing. Use colour 1..15 for pixels you want to see and give colour 0 a deliberate value.

### 3. Sprites are off until the control register says otherwise

The blank VDC starts with CR = 0x80: the background is on and the sprite layer is not. reg("CR", 0xC0) turns both on. This is the single most common "my sprite is invisible" cause after the pattern layout.

### 4. Raster work is per line, and small

raster(line) is called once for each of the 224 lines, every frame. It is a line interrupt on the console, with about 123 cycles of blank to run in, not a place for loops, VRAM writes or allocations. One entry per line (a second is raster-line-full), at most 64 colour writes on it, and the table's frame-start latch takes the last line's registers — so line 0 usually has to restate its own value. Prefer a few register or palette writes to a picture's worth of work.

### 5. Write VRAM and the SAT in init() or frame(), not in raster()

The per-line handler journals registers and palette writes. A VRAM or SAT write there is both slow and outside what the console's line handler can do. Draw tiles once in init(), move sprites in frame(), and use raster() only for the per-line registers and colours.

### 6. A pad is a held state, not an event

pad[1].i is true for every frame the I button is held — the I BUTTON, keyboard key N; pad[1].up is the Up direction, key I. Name which you mean. If an action should fire once, remember the previous frame: `if pad[1].i and not was_i then ... end; was_i = pad[1].i`.

### 7. Integers, not fractions

Stay in whole numbers: `x // 16`, not `x / 16` or 1.5. The studio's IL is a fixed-point machine and refuses or diverges on mixes (il-mixed), and integer maths makes a frame reproducible. t is f/60 seconds, but prefer f when you need a frame count.

### 8. No strings, and keep tables simple

The cartridge subset has no string values (il-string). A table the toy builds can now be read back in the browser (t[i] and t.x run in both runtimes), but the console export has no tables yet, so a toy that must become a cartridge should fill tables with constant keys and read them back through constants (the toys do), or use separate globals. for i = a, b, step do is fine; pairs/ipairs are not.

### 9. print() is not the browser console

print(...) adds a line to the studio's log, not to devtools. It is useful, but a print in frame() runs 60 times a second and fills the log; print once, or when something changes.

## 8. Keep it cartridge-ready

The studio's Check compiles the file through PCEStudio's IL, the same intermediate language that becomes a .pce cartridge. A toy written inside it runs identically in the browser and on the console; a toy outside it still runs in the browser but cannot be exported. Keep to these rules from the first version:

- Integers only. No 1.5, no x / y (use x // y). sin/cos/sqrt exist for the browser but return fractions; the console uses fixed point. The safest toys use f and integer arithmetic.

- Numbers stay inside 32 bits (about -2,000,000,000..2,000,000,000).

- No string used as a value. A string is allowed as reg's name and in print, not in a variable.

- Tables: the IL reads them back (t[i], t.x), but pce-cgen, the console back end, does not lower tables at all (cgen-op), so a toy with a table read runs in the browser and will not export. sprite(i, spec) is a table too: place sprites with sat() words (section 5) when the toy must export. The worked examples fill a table with constants and do not read it back; keep to that if the person wants a cartridge.

- No method calls (:), no varargs (...), no pairs/ipairs, and no multiple return values. Use for i = a, b, step do and plain functions.

- A named function must be defined before it is called, in the same file.

The refused constructs come back by code (il-syntax, il-op, il-string, il-mixed, il-method, il-for-in, il-undefined, il-arity); a browser-only toy fails Check with one of those.

## 9. When it goes wrong

Every refusal is a named failure, not a silent drop: the studio shows `code: file:line: message` (or the error line under the picture). Read the code first, then the line, then fix the value or the construct. The codes a first toy meets, and the ones its cartridge export can raise:

| code | meaning |
| --- | --- |
| reg-forbidden | a register a toy may not touch |
| reg-range | a register value outside the VDC register's width |
| pal-range | a colour-table address or word outside 0..511 |
| vram-range | a VRAM word address outside 0..32767 or a word past $FFFF |
| sat-range | a SAT entry outside 0..63 or a SAT word past $FFFF |
| sprite-range | a sprite field outside the SAT's range |
| raster-line | a raster line outside VDW 0..223 |
| raster-line-full | a second raster entry on one line, or too many colour writes on it |
| pad-range | a pad number outside 1..5 |
| il-pad-write | writing a pad table |
| music-range | a song index outside the songs the runtime was given |
| sfx-range | an SFX channel, frequency, volume or length outside its range |
| no-psg | the PSG model or the song player is not loaded, so no toy can make sound |
| password-value | a save value that cannot be packed |
| password-code | a password that is not one |
| tile-space | no room for another tile: the ROM layout gives 1536, or the patterns would reach the SAT |
| validate-rom | an estimated ROM past the HuCard's 1 MB |
| cgen-op | an IL instruction this backend has no C lowering for (tables, sprite(), fixed point, some builtins) |
| toy-timeout | a toy hook past the frame's Lua budget |
| toy-error | a Lua error inside the toy, naming file:line |
| il-syntax | Lua's own compile error, with file:line |
| il-op | a Lua construct the IL has no instruction for |
| il-string | a string used as a value |
| il-mixed | int and fixed in one place |
| il-method | a `:` method call |
| il-for-in | a generic for (pairs/ipairs) |
| il-undefined | a global that is never defined |
| il-arity | a call with the wrong argument count |

If the person reports "nothing happens" with no error: the toy is running and drawing nothing visible. Check, in order, CR (sprites off?), the sprite pattern layout (section 7.1), the BAT fill (a blank BAT is a blank screen even with CR on), and colour 0.

## 10. The reference, generated from the code

The chapters below are generated from the runtime's own tables by node tools/docs.js, and this whole file is generated from the same tables plus sections 1-9: a range or a refusal code cannot drift from the code without failing tests/check-guide.js.

### 10.1 The toy

A toy is one Lua file. It draws to a 256x224 picture on the PC Engine's VDC and VCE through a small set of calls; everything it does is checked against the hardware's own limits before it is stored.

Three entry points, all optional:

| function | when it runs |
| --- | --- |
| init() | once, after the file's top-level statements |
| frame(t, f) | every video frame; t = f/60 seconds, f = frame number |
| raster(line) | every VDW display line 0..223 of the frame, after frame(), for per-line changes |

State is ordinary Lua globals and persists across frames. A frame is deterministic: t is f/60, not the clock.

```lua
function frame(t, f)
  -- f is an integer frame count; BXR is 10 bits, so wrap it
  reg("BXR", (f * 2) % 1024)
end

function raster(line)
  pal(0, line % 512)
end
```

### 10.2 Registers

A toy may set three VDC registers with reg(name, value). The value must be a whole number in the register's range; anything else is reg-range. Any other name is reg-forbidden — the toy host writes only these, and the rest of the VDC belongs to the ROM.

| register | range | width | what it does | manual |
| --- | --- | --- | --- | --- |
| BXR | 0..1023 | 10-bit | background horizontal scroll, in pixels (VDC R07) | VDC H7-7 |
| BYR | 0..511 | 9-bit | background vertical scroll, in lines (VDC R08) | VDC H7-7 |
| CR | 0..255 | 8-bit | control: BB background on (bit 7), SB sprites on (bit 6), and the VDC interrupt enables (RC bit 2 is the line interrupt) | VDC H7-5 |

```lua
function frame(t, f)
  -- whole numbers only: f, never t or sin(), and a wrap for BXR
  reg("BXR", (f * 2) % 1024)
  reg("BYR", (f // 2) % 512)
  reg("CR", 0xC0)
end
```

The VDC's other registers — the memory and increment controls, the interrupt mask, the line-match register — are not a toy's to write: the ROM configures them and a toy that changes them would break the frame flow both runtimes share.

### 10.3 Palettes and colour

The VCE holds 512 colour entries (CRAM). pal(addr, word) writes one: the address is 0..511 and the word is a 9-bit colour, 0..511. Either one out of range is pal-range.

A colour word is three 3-bit channels: green in bits 6-8, red in bits 3-5, blue in bits 0-2. rgb(r, g, b) builds one, masking each channel to 0..7.

| entries | what it is |
| --- | --- |
| 0..255 | 16 background palettes of 16 colours; a BAT cell names one of the 16 in its palette bits |
| 256..511 | 16 sprite palettes of 16 colours; a SAT entry names one of the 16 in its attribute word |

Colour 0 of every background palette is the shared backdrop (CRAM $000): a pixel whose colour number is 0 shows CRAM[0] whatever palette its cell named. Sprite pixel 0 is transparent instead, so a sprite palette's entry 0 never shows on a sprite.

```lua
function init()
  for i = 0, 15 do pal(i, rgb(0, i * 2, 7 - i)) end
end
```

### 10.4 Sprites and the SAT

The sprite attribute table holds 64 entries of 4 words each, at VRAM $7F00. sprite(i, spec) fills entry i from a table; sat(i, k, v) writes one raw word. An entry index outside 0..63 is sat-range (sprite-range for the composed form), and so is a field outside its width.

The hardware does not police where a pattern lives, so the usable numbers are set by the two tables a pattern must not overwrite. In the default layout the BAT owns VRAM words 0..1023 (patterns 0..15) and the SAT owns $7F00..$7FFF (patterns 508..511). A sprite pattern is therefore 16..507, and the background tiles share that region — character 0x40 starts at word 0x400, which is pattern 16 — so keep the two apart (the starter uses tile 0x40 and pattern 0x100).

| word | field |
| --- | --- |
| 0 | Y; $40 is display row 0 |
| 1 | X; $20 is display column 0 |
| 2 | pattern code, written << 1 |
| 3 | palette \| SPBG<<7 \| CGX<<8 \| HFLIP<<11 \| CGY<<12 \| VFLIP<<15 |

| sprite field | range |
| --- | --- |
| x | 0..1023 |
| y | 0..1023 |
| pattern | 0..1023 |
| palette | 0..15 |
| cgy | 0..3 |
| spbg, cgx, hflip, vflip | true or false |

CGX doubles the width and CGY picks the height; the six sizes the VDC draws are below. cells is the 64-word VRAM span the pattern occupies.

| size | cells | flags | alignment |
| --- | --- | --- | --- |
| 16x16 | 1 cell | CGX 0, CGY 0 | 1-cell |
| 32x16 | 2 cells | CGX 1, CGY 0 | 2-cell |
| 16x32 | 4 cells | CGX 0, CGY 1 | 4-cell |
| 32x32 | 4 cells | CGX 1, CGY 1 | 4-cell |
| 16x64 | 8 cells | CGX 0, CGY 2 | 8-cell |
| 32x64 | 8 cells | CGX 1, CGY 2 | 8-cell |

Per display line the VDC collects at most 16 strips of 16 pixels (256 pixels) in SAT order; a 32-pixel sprite asks for two strips. Sprites past the limit are dropped, not refused — that is the line budget, and the editor reports it per line.

```lua
function init()
  reg("CR", 0xC0)   -- sprites start OFF; without this they never show
  sprite(0, { x = 32, y = 64, pattern = 16, palette = 1 })
  sprite(1, { x = 80, y = 64, pattern = 16, palette = 2, hflip = true })
end
```

### 10.5 Raster: changes per line

The PC Engine has no HDMA. The per-line trigger is the VDC's line interrupt (RCR): the ROM arms RCR for line 0x40 + the display line, and the handler runs once for each of the 224 display lines. A toy expresses per-line changes two ways.

1. A callback: define raster(line). Both runtimes call it for every line 0..223 after frame() and record the register and palette writes it makes as that line's entry.

2. A table entry: call raster(line, spec) from frame() (or init() for a static table). spec may set bxr, byr, cr and cram = {{addr, word}, ...}.

| what can change per line | range | refusal |
| --- | --- | --- |
| bxr | 0..1023 | reg-range |
| byr | 0..511 | reg-range |
| cr | 0..255 | reg-range |
| a colour entry (addr, word) | 0..511 / 0..511 | pal-range |

A line gets one entry, because the interrupt fires once per line: a second registration for the same line is raster-line-full, and so is more than 64 colour writes in one line's callback. A line outside 0..223 is raster-line.

The VCE keeps CRAM across frames, so a row above this frame's first write still shows the previous frame's value; the runtime carries that in cramPrev. Inside a table entry, registers the entry does not name keep the frame-wide value.

```lua
function frame(t, f)
  for line = 0, 223 do
    raster(line, { bxr = line * 2,
                   cram = { { 0, line % 512 } } })
  end
end
```

### 10.6 Pads

pad[n] is controller n, 1..5. A pad is 2-button: the D-pad, I, II, Select and Run — 8 read-only booleans, refreshed before frame(). Five pads is the multitap; pad 1 is the console's own port.

| field | the pad button | keyboard key |
| --- | --- | --- |
| pad[n].up | Up | I |
| pad[n].down | Down | K |
| pad[n].left | Left | J |
| pad[n].right | Right | L |
| pad[n].i | I | N |
| pad[n].ii | II | M |
| pad[n].select | Select | O |
| pad[n].run | Run | P |

The field names the pad BUTTON, and the button's name is not always its key's: pad[n].i is the I button, which the keyboard presses with key N, while pad[n].up is the Up direction, which the keyboard presses with key I. Say which one you mean — "the I button (key N)" or "Up (key I)" — never just "press I".

A pad is true while its button is held, not only on the frame it goes down; remember the previous frame when an action should happen once. Writing a pad field is refused (il-pad-write in the IL; the Lua table is read-only).

```lua
local was_ii = false

function frame(t, f)
  if pad[1].ii and not was_ii then print("jump") end
  was_ii = pad[1].ii
end
```

### 10.7 Passwords

A bare HuCard has no save memory, so a toy saves with a password. password.pack(value) turns a value into a short code starting P1 (base32 alphabet, then a check byte) and password.unpack(code) returns it; a mistyped or foreign code is password-code.

A value is nil, a boolean, an integer, a string, or a table with number or string keys. Every cap is a maximum the round trip holds to; one past it is refused naming the edge, never truncated.

| value | maximum | past it |
| --- | --- | --- |
| an integer | -1073741824..1073741823 | password-value |
| a non-integer number | none — not an integer | password-value |
| a string | 64 bytes | password-value |
| a table | 32 entries, nested 6 tables deep | password-value |
| the value's bytes | 96, before the check byte | password-value |
| the whole code | 200 characters | password-code |

The integer cap is 2^30, not the VM's full 32-bit range: an integer is 32 bits and the zig-zag encoding spends one bit on the sign, so a magnitude of 2^30 doubles to 2^31 and would wrap.

```lua
function init()
  -- once, not every frame: print() adds a log line and the log
  -- keeps only 200 lines
  local code = password.pack({ high = 1200, level = 3 })
  print(code)
end
```

### 10.8 Sound: the PSG

The HuC6280 PSG has 6 channels, each a 32-step waveform of 5-bit samples (0..31), plus noise on channels 4 and 5 and an LFO. The model is renderer/pce-psg.js, a literal transcription of Mednafen's pipeline at 44100 Hz.

music(index) plays a song from the list the runtime was given — a module read by the tracker route (renderer/pce-dmf.js, renderer/pce-song.js), whose writes are the ones HuTrack's engine makes, one VBlank per frame. A toy pasted into the studio gets no such list: the studio builds its runtime without songs, so music(0) there is music-range, and music() is not how a first toy gets sound. Use sfx() and note() instead; music() is for a runtime a page hands a song list.

sfx(channel, freq, volume, frames) takes a channel from the music the way HuTrack reserves one, loads a 32-step square, sets F and AL, and gives the channel back after frames frames. release(channel) gives a channel back now. If the page did not load the PSG model or the song player, a sound call is no-psg.

A release does not resume the middle of a held note: the music waits for the next note row on that channel, and that fresh note reloads the instrument's waveform (all 32 steps) even when it has not changed — HuTrack's channel hand-off. The writes go to renderer/pce-psg.js in the frame's order, so a toy's sound is the model's own PCM.

| call | what it does | limits and refusal |
| --- | --- | --- |
| note(name or MIDI) | the PSG's 12-bit F divider for a note name (Lua only) or a MIDI number (both runtimes); feed it to sfx() | a MIDI number 0..127; the result is clamped to 0..4095, and the IL carries no strings so a cartridge uses the number |
| music(index) | plays song index from the start — the whole engine restarts, as HuTrack's playSong does | an index into the songs the runtime was given (0..songs-1) |
| sfx(channel, freq, volume, frames) | takes the channel (HuTrack's reserve), loads a 32-step square, sets F = freq and AL = volume, and gives it back after frames | channel 0..5, freq 0..4095, volume 0..31, frames 1..600 |
| release(channel) | gives a channel back now (HuTrack's release): control and noise off, and the music waits for a fresh note on it | channel 0..5; a channel no SFX owns is left alone |

| register | name | what a write does | manual |
| --- | --- | --- | --- |
| R0 | channel select | selects the channel R1-R7 act on (0-5); a select alone makes no sound | PSG PB-2 |
| R1 | main amplitude | L/R master volume, one nibble per side | PSG PB-3 |
| R2 | frequency LSB | low 8 bits of the 12-bit frequency divider F | PSG PB-3 |
| R3 | frequency MSB | high 4 bits of F | PSG PB-3 |
| R4 | channel control | channel on/off, DDA mode, and the channel level | PSG PB-3 |
| R5 | channel balance | per-channel L/R volume, one nibble per side | PSG PB-4 |
| R6 | waveform data | one 5-bit sample of the 32-step wave; in DDA mode, the held level | PSG PB-4 |
| R7 | noise control | noise enable and frequency for channels 4 and 5 only | PSG PB-6 |
| R8 | LFO frequency | 8-bit LFO rate | PSG PB-6 |
| R9 | LFO control | LFO trigger (bit 7) and depth/control | PSG PB-6 |

F is the PSG's 12-bit divider, so a note's F is 7,159,090 / (64 f). note(name or MIDI) returns it — a name in Lua, a MIDI number in both runtimes (the IL carries no strings).

```lua
function frame(t, f)
  -- pad[1].ii is the II BUTTON, pressed with keyboard key M
  if pad[1].ii then sfx(3, note(76), 24, 10) end
end
```

### 10.9 Budgets and limits

The limits a toy lives inside, each enforced where the table says.

| budget | limit | source |
| --- | --- | --- |
| one hook's Lua time | 100 ms | toy-timeout |
| the page's log | 200 lines | print() |
| VRAM | 32768 words | vram-range |
| CRAM | 512 entries | pal-range |
| SAT | 64 entries | sat-range |
| display lines | 224 | raster-line |
| raster colour writes on one line | 64 | raster-line-full |
| sprites' strips on one line | 16 strips (256 pixels) | line budget |
| PSG voices | 6 channels | sfx-range |
| an SFX's length | 600 frames | sfx-range |
| a toy's recorded PSG writes | 65536 | the recording, not the sound |
| tiles in the ROM layout | 1536 | tile-space |
| one hook's IL instructions | 5000000 | toy-timeout |
| a password's value bytes | 96 | password-value |
| a password's table entries | 32 | password-value |
| a password's nesting | 6 tables | password-value |
| a password string | 64 bytes | password-value |

## 11. Before you answer

Check the code against this list before sending it: the whole file; only calls from section 4; integers; reg("CR", 0xC0) before the first sprite; the BAT filled; sprite patterns through putsprite; the raster callback a few writes per line; no string values; no table reads if the toy must export.

Then end with the line the person needs in order to run it:

**Copy this code, then press Paste & Run in the studio**

Ask what they see. You are done when the picture on their screen is the one they asked for, not when the code looks right.

---

Generated by node tools/docs.js --claude: the API chapters from renderer/pce-docs.js, which reads every range and refusal out of the module that enforces it; the examples from toys/. Do not edit this file by hand — tests/check-guide.js regenerates it and fails on a hand-written number.

Sources: renderer/pce-toyhost.js, renderer/pce-editor.js, renderer/pce-toys.js, renderer/pce-il.js, renderer/pce-psg.js, renderer/pce-validate.js, renderer/pce-cgen.js, renderer/pce-song.js, renderer/pce-guide.js, toys/*.lua, tools/mcp/server.js (the tool names).
