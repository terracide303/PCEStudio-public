-- sprite-limit.lua — the 16-strip budget, and two rows that live inside it.
--
-- THE TRICK: the VDC collects sprites per display line into a 16-entry
-- buffer.  HuC6270 manual p. H7-19: at most 16 sprites on one line, and a
-- 17th is not drawn (the higher-priority 16 are); the status register's OR
-- bit is set by the attempt (H7-4).  The budget is counted in 16-pixel
-- strips, not sprite entries — a 32-pixel-wide CGX sprite spends two — which
-- #12/#40 measured and docs/MANUALS.md §3.6 records.  There are 64 SAT
-- entries in all (H7-20).
--
-- This toy stays at exactly 16 strips on each of two lines:
--   row 1 (display line 48):  16 sprites 16 px wide, one strip each;
--   row 2 (display line 144):  8 sprites 32 px wide (CGX), two strips each.
-- The background checker carries the third element and costs no sprite
-- budget at all.  That is how to live with the limit: count strips, not
-- objects; make wide things out of the background when they are static; and
-- split a moving wide thing across rows if one line cannot hold it.
--
-- The studio's validator reports this toy's worst line at 16 requested
-- strips, 0 dropped (tests/check-tricks.js).  A control with one more sprite
-- on a line is refused with validate-sprite-line.

local ROW1_Y = 112      -- SAT y; display row 48 (SAT y 64 is display row 0)
local ROW2_Y = 208      -- display row 144
local TOP_PATTERN = 0x100
local CGX_PATTERN = 0x180

-- Write one 16x16 sprite pattern.  A sprite pattern is NOT a BAT character
-- (HuC6270 manual p. H7-21/24): SAT pattern code p is read at word p*64,
-- plane n at p*64 + n*16 + row, and bit 15 is the strip's left pixel.
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

-- Write one 8x8 background character (the BAT's layout, H7-15).
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
  pal(0, rgb(0, 0, 0))                   -- backdrop
  pal(1, rgb(7, 2, 1))                   -- sprite colours (sprite palette 0)
  pal(2, rgb(1, 7, 2))
  pal(3, rgb(2, 2, 7))
  pal(0x101, rgb(7, 6, 1))               -- the sprite palettes' own entries
  pal(0x102, rgb(1, 7, 6))
  pal(0x103, rgb(6, 1, 7))
  pal(4, rgb(1, 1, 2))                   -- background checker, dark
  pal(5, rgb(1, 2, 1))

  -- Row 1's sixteen 16-px sprites.  Each is solid colour 1..3, so a sprite
  -- that is dropped or moved is visible at once.
  for i = 0, 15 do
    putsprite(TOP_PATTERN + i, function(col, row)
      return 1 + i % 3
    end)
  end
  -- Row 2's eight 32-px CGX sprites.  CGX reads the pattern pair p and p+1,
  -- so each left half is p and the right half p+1 (H7-22; pce-sprites.js).
  for i = 0, 7 do
    putsprite(CGX_PATTERN + 2 * i, function(col, row) return 1 end)
    putsprite(CGX_PATTERN + 2 * i + 1, function(col, row) return 2 end)
  end

  puttile(0x40, function(col, row)
    return 4 + (col + row) % 2
  end)
  for row = 0, 27 do
    for col = 0, 31 do vram[row * 32 + col] = 0x40 end
  end

  reg("CR", 0xC0)                        -- background + sprites on
end

function frame(t, f)
  -- Row 1 slides one pixel a frame and wraps every 16: 16 strips, always.
  local off1 = f % 16
  for i = 0, 15 do
    sprite(i, { x = 32 + i * 16 + off1, y = ROW1_Y,
                pattern = TOP_PATTERN + i, palette = 0 })
  end
  -- Row 2 slides two pixels a frame and wraps every 32: 8 x 2 = 16 strips.
  local off2 = (f * 2) % 32
  for i = 0, 7 do
    sprite(16 + i, { x = 32 + i * 32 + off2, y = ROW2_Y,
                     pattern = CGX_PATTERN + 2 * i, palette = 0, cgx = true })
  end
end
