-- 03-sky-gradient.lua — a vertical gradient, with no gradient tiles.
--
-- THE TRICK: the VCE colour table can be rewritten during the frame. One
-- flat tile filling the screen becomes a gradient if palette entry 1 holds a
-- different colour on each band of lines. The only thing on screen is flat
-- colour 1; the sky is the palette moving under it.
--
-- THE BUDGET: a raster entry per line is 224 entries and costs too much
-- (the same picture as a raster(line) callback runs at 21 Hz, over the 60 Hz
-- budget). One entry every 4 lines is 56 entries, still a smooth sky at
-- 224 lines, and clean at 60 Hz. That is the raster budget in practice:
-- pay for the lines where the colour changes, not for the lines in between.
--
-- The sun is four tiles that use colour 2 inside the disc and colour 1
-- outside, so colour 2 is set once and the gradient never touches it.

local STEP = 4                    -- display lines per palette step
local SUN_TOP = 64                -- first display line of the sun's tiles
local SUN_BOTTOM = 79             -- last display line of them

-- One 8x8 character. fn(col, row) returns colour 0..15; colour 0 is
-- transparent. Planes: words 0..7 = bits 0/1, words 8..15 = 2/3.
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
-- horizon. Integer arithmetic only, so every value is in rgb's 0..7 range.
local function sky(y)
  -- A tail call such as `return rgb(...)` is not lowered (il-op), so build
  -- the word in a local and return that.
  local w = rgb(y // 32, y // 56, 5 - y // 48)
  return w
end

function init()
  pal(0, rgb(0, 0, 1))            -- backdrop (never seen: the tile covers all)
  pal(2, rgb(7, 6, 1))            -- the sun's disc, set once

  -- The flat sky tile: every pixel colour 1.
  puttile(0x40, function(col, row) return 1 end)

  -- The sun as four 8x8 quadrants of one 16x16 disc: colour 2 inside,
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
  -- One palette entry every STEP lines. The last write on a line holds
  -- until the next entry, so 56 writes make 224 lines of gradient.
  for line = 0, 223, STEP do
    local w = sky(line)
    raster(line, { cram = { { 1, w } } })
  end
end
