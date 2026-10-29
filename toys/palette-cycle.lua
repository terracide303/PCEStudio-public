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
