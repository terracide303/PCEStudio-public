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
