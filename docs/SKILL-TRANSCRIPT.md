# The cold seat: a fresh session, SKILL.md only (#103)

The card's evidence for the agent skill is a session that has **never seen
this repository**, is given **only `plugin/skills/creating-pce-toys/SKILL.md`**,
and is asked for one toy. This file records that session, its reply, and the
measurement of the `main.lua` it produced.

- Date: 2026-10-29
- Seat: a fresh Claude session (a general-purpose subagent, no shared context
  with the seat that wrote the skill).
- Skill version measured: `SKILL.md` at 13,401 bytes (`plugin/skills/creating-pce-toys/SKILL.md`).
- Isolation: `SKILL.md` was copied to its own empty directory under `$TMPDIR`
  (`skill-seat3-…/`). The seat was told to `cd` there and to read only
  `SKILL.md` — not the PCEStudio checkout, not the workshop, not
  `recipes/`, and no network. It was told not to run anything, so it could
  not compile, run, or validate what it wrote: the skill alone had to be
  enough.
- The person's message (single turn, so the seat could not wait for an answer):
  *"hi! i want a little toy where a ball bounces around the screen, and i can
  move a paddle along the bottom with the pad to bat it back up. can you make
  it?"*

Three rounds were run against the same message. **Round 3 is the version
recorded in the block below**; rounds 1 and 2 are at the end, with what each
exposed — they are the reason the skill says what it now says.

## The seat's reply, verbatim (round 3)

The reply's words are as the seat wrote them; only line wrapping is reflowed
into the quote. The Lua block below is byte-for-byte the `answer.lua` the seat
saved (`diff` clean), and it is the block `tests/check-skill.js` measures.

> Hi! Here's a complete `main.lua` for a paddle-and-ball toy. Pad 1's
> left/right moves a 32-pixel paddle along the bottom; the ball bounces off the
> top and sides, and if you miss it re-serves from the middle. A hit near the
> paddle edge sends the ball off at a wider angle, so where you meet it matters.
>
> How it's put together:
> - The playfield is the backdrop. Character `0x40` is written as an empty tile
>   and every BAT cell points at it, so the whole screen is `CRAM[0]` (a dark
>   blue). I used colour 0 rather than betting on the 4bpp background tile
>   packing.
> - The ball is one 16x16 sprite with a small filled circle drawn into its
>   64-word cell. The paddle is two 16x16 sprites side by side, making it 32 px
>   wide.
> - `CR` is `0xC0` and both sprites use `spbg = 1`, so sprites are actually
>   enabled and sit in front of the background. Sprite colours are at `0x111`
>   (ball) and `0x121` (paddle), off the `0x100` sprite-palette base.
> - Ball position and velocity are plain integer globals. Motion is 2-3 px a
>   frame; walls flip and clamp.
>
> I wrote this against the toy subset in the skill, but I couldn't run the
> console from this seat, so please do a `toy_run` and look at a `frame_png`
> before trusting the picture. The things worth eyeballing are the ball/paddle
> contact (those numbers are hand-tuned) and that both sprites are visible; if
> they are not, `CR` and `spbg` are the first suspects. It is silent for now —
> say the word and I'll add a blip on the paddle hit.

```lua
-- main.lua -- a ball, a paddle, and the pad

function setrow(pat, y, x0, x1, col)
  local base = pat * 64
  local w0 = 0
  local w1 = 0
  local w2 = 0
  local w3 = 0
  for x = 0, 15 do
    if x >= x0 and x <= x1 then
      local m = 1 << (15 - x)
      if (col & 1) == 1 then
        w0 = w0 | m
      end
      if (col & 2) == 2 then
        w1 = w1 | m
      end
      if (col & 4) == 4 then
        w2 = w2 | m
      end
      if (col & 8) == 8 then
        w3 = w3 | m
      end
    end
  end
  vram[base + y] = w0
  vram[base + 16 + y] = w1
  vram[base + 32 + y] = w2
  vram[base + 48 + y] = w3
end

function make_ball()
  for y = 0, 15 do
    local dy = y - 8
    if dy < 0 then
      dy = 0 - dy
    end
    local hw = 0
    if dy == 0 then hw = 6 end
    if dy == 1 then hw = 6 end
    if dy == 2 then hw = 6 end
    if dy == 3 then hw = 5 end
    if dy == 4 then hw = 4 end
    if dy == 5 then hw = 3 end
    if dy == 6 then hw = 1 end
    if dy <= 6 then
      setrow(0x100, y, 8 - hw, 8 + hw, 1)
    else
      setrow(0x100, y, 0, -1, 1)
    end
  end
end

function make_paddle(pat)
  for y = 0, 15 do
    if y >= 4 and y <= 9 then
      setrow(pat, y, 0, 15, 1)
    else
      setrow(pat, y, 0, -1, 1)
    end
  end
end

function fill_field()
  -- character 0x40 is an empty tile: every pixel is colour 0, the backdrop.
  local base = 0x40 * 16
  for y = 0, 15 do
    vram[base + y] = 0
  end
  -- every BAT cell points at that tile, palette 0.
  for row = 0, 27 do
    for col = 0, 31 do
      vram[row * 32 + col] = 0x40
    end
  end
end

function init()
  reg("CR", 0xC0)          -- background on, sprites on
  reg("BXR", 0)
  reg("BYR", 0)
  pal(0, rgb(0, 1, 3))     -- backdrop: the whole playfield
  pal(0x111, rgb(7, 7, 7)) -- ball: sprite palette 1, colour 1
  pal(0x121, rgb(7, 5, 0)) -- paddle: sprite palette 2, colour 1

  fill_field()
  make_ball()
  make_paddle(0x101)
  make_paddle(0x102)

  ball_x = 120
  ball_y = 80
  ball_vx = 2
  ball_vy = 3
  paddle_x = 112
  paddle_y = 200
end

function frame(t, f)
  -- pad 1 moves the paddle; keep it on the screen
  if pad[1].left then
    paddle_x = paddle_x - 3
  end
  if pad[1].right then
    paddle_x = paddle_x + 3
  end
  if paddle_x < 0 then
    paddle_x = 0
  end
  if paddle_x > 224 then
    paddle_x = 224
  end

  -- the ball moves in whole pixels
  local old_y = ball_y
  ball_x = ball_x + ball_vx
  ball_y = ball_y + ball_vy

  -- the top and the two sides
  if ball_x < 0 then
    ball_x = 0
    ball_vx = 0 - ball_vx
  end
  if ball_x > 240 then
    ball_x = 240
    ball_vx = 0 - ball_vx
  end
  if ball_y < 0 then
    ball_y = 0
    ball_vy = 0 - ball_vy
  end

  -- the paddle: its bar starts at cell row 4
  local top = paddle_y + 4
  if ball_vy > 0 and old_y + 14 <= top and ball_y + 14 >= top then
    if ball_x + 14 >= paddle_x and ball_x + 2 <= paddle_x + 31 then
      ball_y = top - 14
      local hit = (ball_x + 8) - (paddle_x + 16)
      ball_vx = hit // 4
      if ball_vx == 0 then
        ball_vx = 1
      end
      if ball_vx > 5 then
        ball_vx = 5
      end
      if ball_vx < -5 then
        ball_vx = -5
      end
      ball_vy = 0 - 3
    end
  end

  -- missed: serve again from the middle
  if ball_y > 222 then
    ball_x = 120
    ball_y = 80
    ball_vx = 2
    ball_vy = 3
  end

  -- draw
  sprite(0, { x = 32 + ball_x, y = 64 + ball_y, pattern = 0x100, palette = 1, spbg = 1 })
  sprite(1, { x = 32 + paddle_x, y = 64 + paddle_y, pattern = 0x101, palette = 2, spbg = 1 })
  sprite(2, { x = 48 + paddle_x, y = 64 + paddle_y, pattern = 0x102, palette = 2, spbg = 1 })
end
```

## The measurement

`tests/check-skill.js` pulls this file's first fenced Lua block and runs it the
way the card asks — **through `tools/mcp/server.js`**, over stdio:

```
$ node tests/check-skill.js
  the cold seat's main.lua compiles
  the cold seat's main.lua runs 60 frames
  the cold seat's main.lua is VISIBLE (317 non-backdrop pixels)
  the cold seat's main.lua is a picture, not a blank screen (3 distinct colours)
  the cold seat's main.lua passes the check
  the cold seat's main.lua is validator-clean
```

- **Runs:** `toy_write` accepts it, `toy_run` runs 60 frames with no refusal.
- **Visible:** frame 59 has 317 pixels that are not the backdrop, and 3
  distinct colours. Most of the screen *is* the backdrop — the seat used an
  all-colour-0 tile, which is the correct reading of "colour 0 is the shared
  backdrop". The ball draws 125 pixels and the paddle 192.
- **Validator-clean:** `validate` returns `ok:true` with **zero** findings.
- **Moves:** measured separately with pad 1's right held for 30 frames: SAT
  entry 1's X word goes 144 -> 237, and 1,152 picture bytes change. So the
  paddle really is on the pad, not just drawn.
- It used the three facts round 1 got wrong — `reg("CR", 0xC0)`, `spbg = 1`,
  and the `0x100` sprite-palette base — without being told anything else.

## Round 1 — the first fresh seat, and the blank screen

Same message, same isolation, against the **first** SKILL.md. The seat
produced a plausible 119-line toy. It compiled and validated clean. It
rendered **one flat colour**: 57,344 black pixels.

What it had done wrong, and what the skill had not said:

- `reg("CR", 1)` — it guessed CR's bits, turned the background *and* the
  sprites off, and rendered the blanking fill. The skill never said CR bit 7
  is background and bit 6 is sprites, nor that the default 0x80 leaves sprites
  invisible.
- It drew the ball at VRAM words 256..271 and asked for pattern `0x100`, which
  reads words 16384..16447 — an empty cell. The skill did not say
  `pattern * 64`.
- It guessed the sprite-palette base correctly (0x100) but listed the guess
  as a question.

That round also exposed a hole in the **test**: the visibility count compared
each pixel with CRAM[0], and the blanking fill is not CRAM[0], so a blank
screen scored 57,344 "visible" pixels. The test now also requires at least
three distinct colours, and this transcript's measurement uses both.

## Round 2 — the print that would not compile

Second fresh seat, against the corrected SKILL.md. It produced a good toy that
used CR 0xC0, `spbg = 1` and the 0x100 palette base — and one line the IL
refuses:

```
il-string  line 96: print() takes numbers and booleans; the IL has no string values
```

The skill had said strings are only for `reg()` names and `print`. Both halves
were wrong: a string cannot be printed either. (With the two `print("…")`
calls changed to numbers, that toy validates clean and shows its ball and
paddle — 572 non-backdrop pixels, 6 distinct colours.) SKILL.md now says
`print()` takes numbers and booleans, and that a string cannot be stored,
compared, passed or printed.

## What this does and does not prove

- It shows **SKILL.md alone is enough** for a fresh seat to produce a visible,
  moving, validator-clean PC Engine toy through the MCP server, and that the
  seat followed the skill's own guidance (whole file, the CR/spbg/palette
  facts, the subset, "look before you trust it").
- It does **not** show the toy is good: the seat itself flagged the collision
  numbers as hand-tuned and unseen on a frame. "Visible and validator-clean"
  is the bar the card sets, not a judgement of quality.
- The prompt and the seat are the same in all three rounds; what changed
  between them is **the skill**, and each round's failure named a fact the
  skill was missing. That is the useful part of this file: the skill's sprite
  section exists because round 1 rendered nothing.
- Rule 2 still applies: the skill and this harness test were written by
  `@design`, so a cold break by a different seat is owed before #103 closes.
