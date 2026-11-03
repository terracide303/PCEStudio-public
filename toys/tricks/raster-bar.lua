-- raster-bar.lua — a raster bar and a per-line palette change on one flat tile.
--
-- THE TRICK: the VDC's RCR interrupt fires once per display line.  The HuC6270
-- manual p. H7-7 sets RCR (R06) against an internal line counter that the
-- Tech Notes (pp. 8-9) say starts at 64 at the top of the sweep, so the
-- handler for display line L waits for RCR = L + $40.  A colour written in
-- the horizontal blank before L shows on L; pcetech §6 ("Palette flicker")
-- records that a colour write made while the line is displaying makes the
-- VCE repeat the last pixel and smear horizontally, so the whole change has
-- to fit in the blank (docs/IL.md §10.2 prices that blank at about 123 CPU
-- cycles on part C's measurement).
--
-- This toy writes exactly ONE palette word per display line: the sky's
-- colour, or the bar's.  The only tile on screen is flat colour 1, so nothing
-- in the picture is a tile — the palette moving under one tile IS the
-- picture.  The bar moves down two lines a frame and wraps.
--
-- Nothing here touches VRAM after init(), and there is no raster table to
-- register: defining raster(line) makes the host call it once per display
-- line, the way the RCR interrupt runs.

local BAR_TOP = 32          -- first line of the bar at frame 0
local BAR_H = 12            -- bar height in lines
local BAR_STEP = 2          -- lines the bar moves per frame
local BAR_SPAN = 160        -- it wraps after 160 lines

-- Write one 8x8 character.  `fn(col, row)` returns a colour number 0..15;
-- colour 0 is transparent (the backdrop).  Planes: word 0..7 = bits 0/1,
-- word 8..15 = bits 2/3, leftmost pixel in bit 7 (HuC6270 manual p. H7-15).
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

-- The sky at display line y: green and red rise towards the horizon, blue
-- falls.  Three-bit channels, so every term is kept inside 0..7.
local function sky(y)
  local w = rgb(2 + y // 96, 1 + y // 64, 6 - y // 64)
  return w
end

function init()
  pal(0, rgb(0, 0, 1))                 -- backdrop, never seen
  puttile(0x40, function(col, row) return 1 end)
  for row = 0, 27 do
    for col = 0, 31 do vram[row * 32 + col] = 0x40 end
  end
end

function frame(t, f)
  g_f = f
end

-- Called once per display line 0..223.  A write here applies from this line
-- down until the next write, so one write per line is all a gradient needs;
-- the bar is the same write selecting a second colour for its own lines.
function raster(line)
  local top = BAR_TOP + (g_f * BAR_STEP) % BAR_SPAN
  if line >= top and line < top + BAR_H then
    pal(1, rgb(7, 7, 3))               -- the bar: bright, nearly white
  else
    pal(1, sky(line))
  end
end
