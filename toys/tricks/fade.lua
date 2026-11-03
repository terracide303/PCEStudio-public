-- fade.lua — a 7-step fade to black beside a 14-half-step crossfade.
--
-- THE TRICK: the HuC6260 VCE has no brightness register.  Its control
-- register (H6-3) documents only the dot-clock bits, and pcetech §6's
-- measured bits are blur (D2) and black-and-white (D7) — there is no dimmer.
-- A fade is therefore a palette rewrite: every frame the CPU steps each
-- chosen CRAM entry toward the target.  The colour word itself is three bits
-- per channel, GGRRRBBB (H6-3, Fig. 2-2-1 H6-4; Tech Notes p.2), so the step
-- the arithmetic can take is limited to eight levels.
--
-- The two halves use the studio's own fade arithmetic, renderer/pce-layers.js
-- `mixChannel`: floor((from*steps + (to-from)*k) / steps) on each channel.
-- The top half fades white to black in 7 steps (8 frames, k = 0..7).  The
-- bottom half crossfades red to blue in 14 half-steps (15 frames, k = 0..14).
-- Both hold their last frame for 8 frames, then repeat.
--
-- What the intermediate words are, and why they look odd, is on the page:
-- every channel moves in 1/7 steps, so a half step usually lands between two
-- 3-bit levels and the floor returns the previous level (a visible hold);
-- between two different colours the same floor invents a purple that is in
-- neither endpoint.  The numbers printed there are this toy's measured CRAM.

local FADE_STEPS = 7
local CROSS_STEPS = 14
local HOLD = 8

-- Write one 8x8 character.  `fn(col, row)` returns colour number 0..15;
-- colour 0 is transparent.  Planes: word 0..7 = bits 0/1, word 8..15 =
-- bits 2/3, leftmost pixel in bit 7 (HuC6270 manual p. H7-15).
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

-- One channel stepped from `from` to `to` at k of steps.  Integer floor, the
-- same expression renderer/pce-layers.js uses, so the toy and the LAYERS
-- panel's preview cannot round apart.
local function mix_channel(from, to, k, steps)
  return (from * steps + (to - from) * k) // steps
end

-- A whole 9-bit word, GGRRRBBB, with each channel stepped.
local function mix(from, to, k, steps)
  local fg, fr, fb = from // 64 % 8, from // 8 % 8, from % 8
  local tg, tr, tb = to // 64 % 8, to // 8 % 8, to % 8
  return mix_channel(fg, tg, k, steps) * 64 +
         mix_channel(fr, tr, k, steps) * 8 +
         mix_channel(fb, tb, k, steps)
end

function init()
  pal(0, rgb(0, 0, 0))                   -- backdrop
  puttile(0x40, function(col, row) return 1 end)
  puttile(0x41, function(col, row) return 1 end)
  -- Rows 0..13 are background palette 0, rows 14..27 palette 1.  Both tiles
  -- are solid colour 1; only the two palettes differ, which is the point.
  for row = 0, 27 do
    for col = 0, 31 do
      if row < 14 then
        vram[row * 32 + col] = 0x40
      else
        vram[row * 32 + col] = 0x41 | (1 << 12)
      end
    end
  end
end

function frame(t, f)
  -- Top: 7 whole steps from white (0x1FF) to black (0x000).
  local kt = f % (FADE_STEPS + 1 + HOLD)
  if kt > FADE_STEPS then kt = FADE_STEPS end
  pal(1, mix(0x1FF, 0x000, kt, FADE_STEPS))

  -- Bottom: 14 half-steps from red (0x038) to blue (0x007).  Palette 1,
  -- colour 1 is CRAM $011 (the CRAM address, not the colour word).
  local kc = f % (CROSS_STEPS + 1 + HOLD)
  if kc > CROSS_STEPS then kc = CROSS_STEPS end
  pal(17, mix(0x038, 0x007, kc, CROSS_STEPS))
end
