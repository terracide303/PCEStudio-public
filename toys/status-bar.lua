-- status-bar.lua — a fixed status bar over a scrolling playfield (card #29).
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
