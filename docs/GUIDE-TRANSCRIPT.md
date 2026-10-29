# The cold seat: a fresh session, the guide only (#105)

The card's evidence for the guide is a seat that has **never seen this
repository**, is given **only `renderer/pcestudio-for-claude.md`**, and is asked
for one toy. This file records that session, its reply, and the measurement of
the `main.lua` it produced.

- Date: 2026-10-29
- Seat: a fresh Claude session (a general-purpose subagent, no shared context
  with the seat that wrote the guide).
- Guide version: `renderer/pcestudio-for-claude.md` at 51,687 bytes, ~9,990
  words; sections 1-9 hand-written, section 10 generated from
  `renderer/pce-docs.js` (#61), the examples are `toys/*.lua`.
- Isolation: the guide was copied to its own empty directory under `$TMPDIR`
  (`guide-seat.e8YEnG/`). The seat was told to `cd` there and to read only
  `pcestudio-for-claude.md` — not the PCEStudio checkout, not the workshop,
  and no network. It was told the file is the complete API. It was not given
  the toy harness, the tests, or any other toy.
- The person's message (single turn, so the seat could not wait for an answer):
  *"hi! i want a starfield with a ship i can move"*

## The seat's reply, verbatim

LINE: I am proposing the smallest first version: a starfield background that drifts, with one 16x16 ship sprite you steer with the D-pad.

REPLY:

This is the smallest first version: a drifting starfield with one ship sprite you steer with I/J/K/L.

```lua
-- main.lua — a drifting starfield with a ship you steer.
-- A complete file: replace the studio's whole main.lua with this.

-- A background character is 16 VRAM words: word 0..7 hold pixel bits 0/1,
-- word 8..15 hold bits 2/3; fn(col, row) returns a colour number 0..15.
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

-- A sprite pattern is 64 VRAM words: pattern p at p*64, plane n at
-- p*64 + n*16 + row, leftmost pixel in bit 15.
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
  pal(0, rgb(0, 0, 0))       -- backdrop
  pal(1, rgb(0, 0, 1))       -- empty space
  pal(2, rgb(7, 7, 7))       -- bright star
  pal(3, rgb(2, 2, 4))       -- faint star
  pal(0x101, rgb(4, 7, 7))   -- ship hull
  pal(0x102, rgb(7, 4, 1))   -- cockpit and exhaust

  puttile(0x40, function(col, row) return 1 end)
  puttile(0x41, function(col, row)
    if col == 3 and row == 2 then return 2 end
    return 1
  end)
  puttile(0x42, function(col, row)
    if col == 6 and row == 5 then return 3 end
    return 1
  end)

  -- all 32 map rows, so the vertical scroll never reaches a blank edge
  for row = 0, 31 do
    for col = 0, 31 do
      local k = (row * 7 + col * 13) % 19
      if k == 0 then
        vram[row * 32 + col] = 0x41
      elseif k == 5 then
        vram[row * 32 + col] = 0x42
      else
        vram[row * 32 + col] = 0x40
      end
    end
  end

  putsprite(0x100, function(col, row)
    local dx = col - 7
    if dx < 0 then dx = -dx end
    if row >= 3 and row <= 5 and dx <= 1 then return 2 end
    if row <= 11 and dx <= row // 2 + 1 then return 1 end
    if row >= 8 and row <= 11 and dx <= 7 then return 1 end
    if row >= 12 and row <= 15 and dx <= 1 then return 2 end
    return 0
  end)

  reg("CR", 0xC0)            -- background on + sprites on
  sx, sy = 144, 160
end

function frame(t, f)
  reg("BXR", (f // 2) % 256) -- the stars drift
  reg("BYR", (f // 4) % 256)

  if pad[1].left then sx = sx - 2 end
  if pad[1].right then sx = sx + 2 end
  if pad[1].up then sy = sy - 2 end
  if pad[1].down then sy = sy + 2 end
  if sx < 32 then sx = 32 end
  if sx > 32 + 240 then sx = 32 + 240 end
  if sy < 64 then sy = 64 end
  if sy > 64 + 208 then sy = 64 + 208 end

  sprite(0, { x = sx, y = sy, pattern = 0x100, palette = 0 })
end
```

To run it: open https://pcestudio.terracides.com, copy this code into the editor (or put it on the clipboard and press Paste & Run), then press Run. Click the picture once before using the pad keys, because the canvas has to have focus — the ship moves with I (up), J (left), K (down), L (right).

I cannot see your screen, so tell me what you see: the colours and where the ship is, or the red error line under the picture (it begins with a code and a file:line, such as `toy-error: main.lua:42: ...`), or a screenshot.

**Copy this code, then press Paste & Run in the studio**

CHECKS:

- Calls used: `init()`/`frame(t, f)` (guide §4 and §10.1), `pal(addr, word)` and `rgb(r, g, b)` (§4, §10.3), `vram[addr] = word` (§4), `reg("BXR"/"BYR"/"CR", v)` (§4, §10.2, all within 0..1023 / 0..511 / 0..255), `sprite(i, spec)` with pattern 0x100 (§4, §10.4; x/y clamped to 32..272 and 64..272), `pad[1].left/right/up/down` (§4, §10.6), plus the `puttile` and `putsprite` helpers copied verbatim from the complete file in §5 (not API — written into the file because §7.1 says a sprite pattern is 64 words, not 16).
- Unsure about: whether the one-pixel stars read clearly at 256x224 (I used one bright pixel per star tile and one faint pixel per dim tile, at roughly 1 tile in 19 and 1 in 19); whether the vertical drift shows a seam when BYR wraps at 256 lines (the map is 32 rows, so I filled all 32 rows and wrap with %256); whether the hull shape (triangle widening to row 11, wings rows 8..11, exhaust rows 12..15) looks like a ship at this size. The guide says the ship should be reported on, not assumed, so the reply asks for the picture.
- Subset: kept to it — integers only (`//` and `%`, no `/`, no fractions, no sin/cos), no string values (strings appear only as `reg` names, which §8 allows), no reads of a toy-built table (the BAT and VRAM are write-only; `pad[1]` is the runtime's own table, as every §5/§6 example reads it; the sprite spec is a table literal passed straight to `sprite()`, as in §10.4), no methods, no varargs, no pairs/ipairs, no multiple returns, and both helper functions are defined before they are called.

## The measurement

`tests/check-guide.js` pulls this file's first fenced Lua block and runs it the
way the card asks — through the toy harness, for its picture, and through the
validator:

```
$ node tests/check-guide.js
  the cold seat's main.lua runs in the Lua runtime
  the cold seat's main.lua is VISIBLE at frame 9 (57,344 non-backdrop pixels)
  the cold seat's main.lua moves a sprite right with pad 1 (entry 0: X 144 -> 160)
  the cold seat's main.lua is validator-clean
```

- **Runs:** `toys.create(source)` + `load()`, 10 frames, pad 1's right held
  from frame 2. No refusal.
- **Visible:** frame 9 is all 57,344 pixels (the starfield fills the screen,
  the ship is drawn on it), counted as pixels that are not CRAM[0]
  (tests/check-guide.js `visibleIn`, the same count check-toys and
  check-examples use).
- **Moves:** SAT entry 0's X word goes 144 -> 160 over the eight frames the
  pad is held; measured in the SAT, so a background scroll cannot stand in
  for a moving ship.
- **Validator-clean:** `renderer/pce-validate.js` report `ok`, zero problems
  (not only zero errors).
- The reply ends with the exact line the card requires:
  `Copy this code, then press Paste & Run in the studio`.

## What this does and does not prove

It shows the guide alone is enough for a fresh seat to produce a visible,
moving, validator-clean toy, and that the seat could follow the guide's
conversation rules (whole file, run instructions, the closing line, asking
for the picture). It does not show the toy is *pretty* — the seat itself
flagged the star size and hull shape as things to judge on a screen — and
rule 2 still applies: the guide and this harness test were written by
@design, so a cold break by a different seat is owed before #105 closes.
