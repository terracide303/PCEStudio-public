---
name: creating-pce-toys
description: Make PC Engine toys for PCEStudio — Lua programs that draw to an emulated 256x224 HuC6270 VDC and play on a 6-voice PSG. Use when asked to make a PC Engine toy, game, demo, sprite, parallax, gradient or tune, or to fix a toy the console check refuses. Drives PCEStudio's MCP server (tools/mcp/server.js): write, run, look at a frame, check against the hardware, export a .pce.
---

# Making a PC Engine toy

A **toy** is one Lua file — `main.lua` — that runs on an emulated PC Engine:
a HuC6270 VDC for the picture, a VCE for the colours, a HuC6280 PSG for the
sound. PCEStudio's MCP server writes it, runs it deterministically, shows you
a frame, checks it against the hardware's own limits, and exports a HuCard
`.pce` you can put in an emulator.

This skill is the whole job. Follow the loop; do not invent API — read the
`docs` tool, which is generated from the runtime's own tables.

## Install (once)

The server needs Node and nothing else: it is a plain JSON-RPC stdio process,
no `npm install`, no compiler.

```sh
# add the MCP server (run from the PCEStudio checkout)
claude mcp add pcestudio -- node "$PWD/tools/mcp/server.js"

# add this skill, so a new session loads it
mkdir -p ~/.claude/skills
ln -s "$PWD/plugin/skills/creating-pce-toys" ~/.claude/skills/creating-pce-toys
```

Skills load when a session starts, so start a new session after installing. As
a Claude Code plugin instead: `claude --plugin-dir <repo>/plugin` (the manifest
is `plugin/.claude-plugin/plugin.json`, the ppu.toys shape).

Or in `.mcp.json` at the repository root:

```json
{ "mcpServers": { "pcestudio": { "command": "node",
  "args": ["tools/mcp/server.js"] } } }
```

## The loop

1. **`docs`** with no topic, then the chapter you need. Never guess a field
   name or a range; the chapters are generated from the code.
2. **`toy_write`** with `{files:[{name:"main.lua", source:...}]}`. It compiles
   immediately and returns a refusal with `file:line` if the Lua is outside
   the subset (see below). A refused write leaves the previous toy loaded.
3. **`source_add`** to give the toy art: a base64 PNG or a pixel grid with its
   palette (kind `bg`, `sprites`, `tilesheet` or `palette`), run through the
   Add Source importer and **merged into the toy's asset files** — `toy_run`
   imports them into VRAM/CRAM/SAT before `init()`, so the toy boots inside
   its art. The reply's budget report tells you the tiles, palettes and VRAM
   words used; stay inside the VRAM row above. The import already places
   sprites in the SAT (slots 0..) with their code and palette, so the toy
   moves them with `sat(i, 0, y)` / `sat(i, 1, x)` — recipe 6 shows it.
   Kind `song` is the other source: a base64 `.mid` becomes `song.json`.
4. **`song_write`** to give the toy music: a step list with the SEQUENCER's
   built-in instruments, written as `song.json`. **`music(0)`** in the toy
   then plays it — no per-frame stepping, the runtime loops the song. A
   `.mid` through `source_add` kind `song` becomes the same file. You cannot
   hear it; `toy_run`'s `sound` report says what happened — the write count,
   and for each of the six channels the notes it started and the instrument
   each sounds with. Recipe 7 shows it.
5. **`toy_run`** for frames (1..600, deterministic: frame `f`, `t = f/60`).
   Pass a `pad` script to hold buttons: `[{from,to,pad,buttons:["left"]}]`,
   buttons `up down left right i ii select run`, pads 1..5.
6. **`frame_png`** and **LOOK AT IT.** A clean run is not a good picture. Plan
   on three passes: draw it, look, name what is wrong, change one thing.
   `frame_png` is 256x224 RGB; seek any frame 0..599 deterministically.
7. **`validate`** before every export. It reports; an `error` code refuses.
8. **Fix one finding, re-run.** Each finding carries `file:line` when the
   validator can place it, and `line:null` when it cannot — do not invent one.
9. **`export_pce`** builds the `.pce` through the browser route (IL → bytecode
   → ROM over the committed interpreter). The validator runs first.

Write in visible increments — backdrop, then a layer, then motion, then sound —
not one giant file. The person is watching; a picture appears at step two.

## The limits, before you write

Every one of these is enforced in code; the numbers are the code's.

| limit | value | what happens past it |
| --- | --- | --- |
| picture | 256x224 | BAT is 32x28 cells of 8x8 px |
| sprites a line | **16 strips of 16 px (256 px)**; a 32-px sprite is 2 strips | the VDC **drops** them; `validate-sprite-line` (error) |
| SAT entries | 64 | `sprite-range` |
| colours | **512** entries in CRAM; 9-bit words, 3 bits per channel | `pal-range` |
| palettes | 16 background x 16 colours, 16 sprite x 16 colours | a BAT cell names 1..15 (colour 0 = backdrop); a SAT entry names 0..15 |
| VRAM | 32,768 words (64 KiB) | `vram-range`; `validate-vram` |
| display lines | 224, and **one raster entry per line** | `raster-line` |
| raster budget | **123 cycles** of horizontal blank per line; the export's replay carries **at most 2 colour words a line** | `validate-raster-blank` (warn), `validate-raster-line` (error) |
| frame budget | **119,318 cycles** at 60 Hz; a frame over it is `validate-slow-frame` (warn), over 8x is an error | rewrite it cheaper |
| PSG voices | 6 voices (channels 0..5); an SFX lasts 1..600 frames | `sfx-range` |
| ROM | **1 MB** = 128 x 8 KiB banks | `validate-rom` |

Two costs worth internalising, because they decide the shape of a toy:

- **A `raster(line)` callback costs cycles on all 224 lines.** The table form —
  `raster(line, {bxr=…})` called from `frame()` — costs only the lines you
  name. The same parallax picture is 0.01 of a frame as four entries and 2.6
  frames as a callback. Use a callback only when the value genuinely changes
  every line; step colour writes every 2-4 lines otherwise.
- **Sprites are the only way to move a thing independently of the map.**
  Background parallax is fewer registers; a player is a SAT entry.

## The toy API

Three entry points, all optional: `init()` once, `frame(t, f)` every frame,
`raster(line)` per display line (after `frame()`). Globals persist across
frames. `t` is `f/60`, not the clock — a run is reproducible.

```
reg(name, value)        BXR 0..1023, BYR 0..511, CR 0..255. Any other name
                        is reg-forbidden: the VDC's memory and interrupt
                        registers belong to the ROM.
pal(addr, word)         one CRAM entry; addr 0..511, word 0..511.
rgb(r, g, b)            3-bit channels -> a colour word; each is masked to 0..7.
vram[addr] = word       VRAM, 0..32767. Characters and the BAT are written here.
sprite(i, spec)         SAT entry i 0..63 from {x, y, pattern, palette,
                        cgx, cgy, spbg, hflip, vflip}. X 32 = display column 0,
                        Y 64 = display row 0. pattern is a 64-word cell.
sat(i, k, v)            one raw SAT word, if you need it.
raster(line, spec)      an entry from frame()/init(): {bxr, byr, cr,
                        cram = {{addr, word}, ...}}
pad[n].left             booleans: up down left right i ii select run, n 1..5.
                        Read-only; true while held. Remember last frame for
                        an edge.
timer(period, fn)       the 7-bit interval timer, ~6,991 Hz; fn per
                        interrupt, at the frame boundary. period 0..127.
music(index)            plays song index from the toy's song files — the
                        song.json song_write or source_add wrote, or the
                        songs.json list. The runtime loops it; index is
                        0..songs-1. No song file = music-range.
sfx(channel, freq, vol, frames)  take a PSG channel: 0..5, freq 0..4095
                        (use note(midi)), volume 0..31, frames 1..600.
release(channel)        give the channel back now.
print(x)                the log; 200 lines. NUMBERS and booleans only — no
                        strings (il-string).
```

**Geometry you will need.** An 8x8 background character is 16 VRAM words: words
0..7 hold pixel bits 0/1 and words 8..15 hold bits 2/3, leftmost pixel in bit 7.
A 16x16 sprite is 64 words: four planes at +0/+16/+32/+48, leftmost pixel in bit
15. A BAT cell is `char | palette << 12`. Sprite pixel 0 is transparent;
background colour 0 is the shared backdrop (CRAM[0]).

**The map and the characters.** The BAT is VRAM words 0..895 (32x28 cells, row
major: `vram[row*32+col]`). Character `c` lives at words `c*16`; start them at
0x40 so they cannot overlap the map. Sprite pattern code `p` reads the 64-word
cell at `p*64`, so `pattern = 0x100` is words 16384..16447.

**Three ways a sprite is invisible, all silent.** Nothing refuses these — you
only see an empty picture:

1. **CR bit 6 (SB) is off.** The power-on value is 0x80 = background on only.
   Write `reg("CR", 0xC0)` (0x80 background | 0x40 sprites).
2. **The sprite is behind the background.** A sprite pixel shows only when its
   `spbg` bit is set *or* the background pixel under it has colour number 0.
   Set `spbg = 1` on a sprite that must be in front of a filled background.
3. **The colours are at the wrong CRAM address.** Sprite palettes start at
   0x100: colour `k` of palette `n` is CRAM `0x100 + n*16 + k`. With
   `palette = 0`, `pal(0x101)` is sprite colour 1.

## The subset the IL refuses

`toy_write` compiles through the same IL the validator and the exporter use.
These come back by code with `file:line` — they are not style opinions:

- Tables — the IL reads a table *the toy built* back (`t[i]`, `t.x`), but the
  console back end does not lower tables, so a toy with a table read runs in
  the browser and fails export (`cgen-op`). For a cartridge, write if-chains
  or a `vram[]` array instead. (Passing a table literal straight to
  `sprite()` is fine.)
- `il-op` — a tail call (`return f(x)`) is not lowered. Assign to a local and
  return that.
- Strings are not values in the IL. A string exists only as the name in
  `reg("BXR", …)`; it cannot be stored, compared, passed, or printed.
  `print()` takes numbers and booleans (`print(1)`), so use a number as a log
  marker, not a word. `note(number)`, never `note("C4")`.
- Integers, `+ - * // %` and `& | << >>`; no `/`, no floats, no `sin/cos`.
- **A literal `true` in a table field is dropped.** `{ spbg = true }` arrives
  without `spbg`; `{ spbg = 1 }` and `{ spbg = (1 == 1) }` both work. Write the
  sprite flags — `spbg`, `cgx`, `hflip`, `vflip` — as `1`, not `true`. (A
  boolean in a local or a condition is fine: `local on = true` works.)

## Recipes

Each is a complete `main.lua` in `recipes/`, run through the MCP server by
`tests/check-skill.js`: every one is **visible** (a frame that is not just the
backdrop) and **validator-clean** (zero findings). Copy one and change it.

### 1. Parallax — `recipes/01-parallax.lua`

The PC Engine has no HDMA. Four raster entries scroll four bands at four
speeds; each entry holds until the next one.

```lua
function frame(t, f)
  reg("BYR", 0)
  raster(0, { bxr = f // 8 })          -- line 0 restates the top: the
  raster(56, { bxr = f // 2 })         -- frame-start latch takes the last
  raster(112, { bxr = f })             -- band's value
  raster(168, { bxr = (f * 2) % 1024 })
end
```

Teaches: the table form, why line 0 must restate, and that the near band moves
fastest.

### 2. A sprite on the pad — `recipes/02-sprite-on-the-pad.lua`

One 16x16 sprite in SAT entry 0, moved by `pad[1]` and clamped to the picture.

```lua
function frame(t, f)
  if pad[1].left then sx = sx - 2 end
  if pad[1].right then sx = sx + 2 end
  if sx < 32 then sx = 32 end       -- SAT X 32 is display column 0
  if sx > 272 then sx = 272 end     -- 32 + 256 - 16
  sprite(0, { x = sx, y = sy, pattern = 0x100, palette = 1 })
end
```

Teaches: the 64-word sprite cell (the `putsprite` helper is in the file), the
X/Y offset convention, and clamping instead of letting the sprite leave.

### 3. A sky gradient — `recipes/03-sky-gradient.lua`

One flat colour-1 tile fills the screen; the gradient is palette entry 1
rewritten every 4 lines. The sun is a second colour the gradient never touches.

```lua
function frame(t, f)
  for line = 0, 223, 4 do
    local w = sky(line)
    raster(line, { cram = { { 1, w } } })
  end
end
```

Teaches: the raster budget, and that a palette write is a picture change.

### 4. A song in a toy — `recipes/04-song-in-a-toy.lua`

A tune stepped by the frame counter, two PSG channels (melody and a fifth
below), and a bar whose height follows how much of the note is held — so the
sound is visible even in a screenshot.

```lua
function frame(t, f)
  if f % STEP == 0 then
    local n = note_at(f // STEP)
    sfx(0, note(n), 28, STEP)
    sfx(1, note(n - 12), 18, STEP)
  end
  -- … paint a bar from f % STEP
end
```

Teaches: `sfx`, `note(midi)`, that the PSG has no hardware envelope (the length
is `frames`), and that a tune stepped by hand is the alternative to a song.

### 5. Fixing a console finding — `recipes/05-fixing-a-console-finding-before.lua` → `recipes/05-fixing-a-console-finding.lua`

Run the `-before` file: it puts 17 sprites on one line and the check refuses it.

```
validate-sprite-line: 16 line(s) ask for more than 16 16-px strips (256 px);
the first is VDW line 100, worst request 17 strips (272 px), 1 dropped
```

The fixed file moves the seventeenth sprite to the next row. Same code, one
number. **A dropped sprite is not drawn badly — it is not drawn**, which is why
this is an error and, on a real console, an invisible bug.

Teaches: read the code and the line, change one thing, check again.

### 6. A sprite from a PNG — `recipes/06-add-a-sprite-from-a-png.lua`

`source_add` turns a picture into the toy's asset files. The picture is a
base64 PNG, or a **pixel grid with its palette** — indices into the palette,
`-1` transparent — which is the hand-drawn form. The recipe's own picture
lives on its `-- GRID` line; `tests/check-skill.js` parses that line and
adds it, exactly as you would:

```json
{ "kind": "sprites", "name": "square",
  "grid": { "width": 16, "height": 16, "pixels": [0, 0, 0, /* … 256 indices */ ] },
  "palette": [[252, 0, 0], [252, 252, 252]] }
```

`toy_run` then imports `palettes.json` and `sprites.json` into CRAM and VRAM
**before `init()`**, and the import places each sprite in a SAT slot with its
pattern code and palette already set. The toy moves the slot on screen — no
code to memorise:

```lua
function init()
  reg("CR", 0xC0)              -- SB (sprites) + BB (background) on
  pal(0, rgb(0, 0, 7))         -- the sky: CRAM entry 0, blue
  sat(0, 0, 100)               -- SAT Y 100 -> display row 36
  sat(0, 1, 100)               -- SAT X 100 -> display column 68
end
```

A second `source_add` appends its patterns and takes the free palette rows,
so the sprites already placed keep their colours; the budget report tells you
how much of the 32,768-word VRAM the toy's picture now occupies. A refused
add leaves the toy alone.

Teaches: art as files the panels edit, the import before `init()`, and
placing imported sprites by moving the SAT slot the import made.

### 7. A song in a game — `recipes/07-a-song-in-a-game.lua`

A song is a file, not code: `song_write` composes `song.json` from a step
list with the SEQUENCER's built-in instruments (lead, bass, bell, strings,
kick, snare), and `music(0)` in `init()` plays it. The recipe's own song
travels on its `-- SONG` line, and `tests/check-skill.js` sends that line as
the `song_write` call an agent makes:

```json
{ "name": "game tune", "tempo": 140, "steps": 16,
  "notes": [ { "channel": 0, "step": 0, "note": "C4",
               "length": 2, "instrument": "lead" },
             { "channel": 1, "step": 0, "note": "C3",
               "length": 8, "instrument": "bass" } ] }
```

`note` is a name (`C4`) or the engine note 0..83; `length` is in steps;
`instrument` is a built-in name or an index. `step` counts columns from 0
across patterns of `steps` columns, so step 32 is pattern 2 column 0. An
instrument left out is the lead (index 0), so name the bass and the bell.
With no song file, `music(0)` is refused `music-range` — the control this
recipe turns green:

```lua
function init()
  music(0)                     -- the toy's own song.json, loaded already
end
```

An effect is still `sfx(channel, freq, volume, frames)`: it takes a channel
from the song for a few frames and hands it back (the recipe's jump on
channel 4). You cannot hear any of it — `toy_run`'s `sound` report is how you
check: `writes` (zero is silence), `music` (index, name, notes started), and
`channels[0..5]` each with `notes`, `instrument` and any `sfx` that owns it.

Teaches: a song is `song.json` and `music(0)` plays it, `sfx` still takes a
channel from the song, and the sound report is the ear you do not have here.

## Before you export

- `validate` returns `ok` with **no findings**. A `validate-slow-frame` warning
  means the toy runs below 60 Hz: fix it or tell the person.
- `frame_png` at two or three frames — the first frame and one mid-animation.
  Is anything the wrong colour, clipped, or only visible by accident?
- Every sprite's line has 16 strips or fewer; the BAT has no cell pointing at a
  character you never wrote.
- Sound: `toy_run`'s `sound.writes` is zero when nothing reaches the PSG;
  `sound.music.playing` says the toy's song is running and each
  `sound.channels[n].notes` is a note that started on that voice. A song
  whose wave channels play but whose instrument reports `kick`/`snare` is a
  drum the toy engine does not play as noise yet (see below) — use `sfx()`
  for a percussion hit.

### What `export_pce` can and cannot build

`export_pce` turns the toy into bytecode for a HuC6280 interpreter and glues
that into a `.pce` — the route that needs no compiler. **The bytecode format is
background-only in this beta.** It encodes `reg`, `pal`, `vram[]` writes,
`rgb`, integer arithmetic and control flow. It refuses, by code:

| the toy uses | `export_pce` refuses with |
| --- | --- |
| a table (`sprite()`, `sat()`, `raster(line, {…})`) | `ilbc-op` — "instruction table … has no bytecode form" |
| `pad[1].…` | `ilbc-op` — `padref` |
| `print`, `music`, `sfx`, `timer` | `ilbc-op` — the instruction, by name |
| `note(n)` (a value builtin) | `ilbc-builtin` |
| a fixed-point value | `ilbc-fixed` |

So: **tell the person which half they have.** A picture-and-motion toy with
sprites and the pad runs in the studio and validates, and cannot be exported
yet; a background toy (tiles, palettes, `reg`, the `raster(line)` callback)
exports. The exported `.pce` is 16 KiB of interpreter plus one 8 KiB data bank;
a payload past 8 KiB is refused by `toy-data-bank-full`. Every recipe here uses
sprites or tables, so `export_pce` refuses all seven with `ilbc-op` — that is
tested, not a guess.

## What this does not model

Say so rather than pretending the toy is proven:

- The picture is checked against PCEStudio's own renderer model (HuC6270
  manual, Mednafen and ares as references), not against real hardware.
- PSG writes are **recorded, not heard** by the MCP server; the PCM model is
  `renderer/pce-psg.js`.
- `music()` plays the song's wave instruments through `renderer/pce-song.js`.
  Its two noise drums (`kick`, `snare`) are the SEQUENCER's own noise writes
  and play their envelope on a wave channel here, not a drum — pce-song.js
  does not do effect 0F yet. Use `sfx()` for a percussion hit in a toy.
- The VCE's `CR` and `CTA` are catalogued but not settable; 262/263-line mode is
  not modelled; no mid-line VCE write has been proven.
- `export_pce` uses the no-compiler browser route. The llvm-mos route
  (`tools/toyc`) is not called.
