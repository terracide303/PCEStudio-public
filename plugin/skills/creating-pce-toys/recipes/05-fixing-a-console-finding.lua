-- 05-fixing-a-console-finding.lua — the FIXED version of a toy the console
-- check refuses. Read 05-fixing-a-console-finding-before.lua first: it asks
-- the VDC for 17 sprites on one line, one more than the hardware collects.
--
-- THE LIMIT: per display line the VDC parses at most 16 strips of 16
-- pixels (256 px), in SAT order (lowest SAT index first). A 16-px sprite is
-- one strip. Sprites past the limit are DROPPED on the console, not drawn
-- badly — so a picture a browser shows can be one the console cannot make.
-- The validator refuses it with validate-sprite-line, which is why that is
-- an error and not a warning.
--
-- THE FIX: 16 sprites, not 17. The seventeenth moves to the next row, where
-- its strip is on a different line and costs nothing.

-- One 8x8 character. fn(col, row) returns colour 0..15.
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

-- One 16x16 sprite cell. Pattern code 0x100 is VRAM word 0x100*64 = 16384.
local function putsprite(cell, fn)
  for row = 0, 15 do
    local p0, p1, p2, p3 = 0, 0, 0, 0
    for col = 0, 15 do
      local c = fn(col, row)
      if c % 2 >= 1 then p0 = p0 | (1 << (15 - col)) end
      if c >= 2 and (c % 4) >= 2 then p1 = p1 | (1 << (15 - col)) end
      if c >= 4 and (c % 8) >= 4 then p2 = p2 | (1 << (15 - col)) end
      if c >= 8 then p3 = p3 | (1 << (15 - col)) end
    end
    vram[cell * 64 + row] = p0
    vram[cell * 64 + 16 + row] = p1
    vram[cell * 64 + 32 + row] = p2
    vram[cell * 64 + 48 + row] = p3
  end
end

function init()
  reg("CR", 0xC0)                 -- 0x80 background on | 0x40 sprites on
  pal(0, rgb(0, 0, 1))            -- backdrop
  pal(1, rgb(1, 2, 4))            -- the row's tiles
  pal(0x101, rgb(6, 6, 2))        -- sprite pixel (sprite palette 1, colour 1)
  pal(0x102, rgb(7, 2, 2))        -- sprite pixel (sprite palette 1, colour 2)

  puttile(0x40, function(col, row) return 1 end)
  for row = 0, 27 do
    for col = 0, 31 do
      vram[row * 32 + col] = 0x40
    end
  end

  -- A 16x16 brick: a frame with a red core, so each strip is easy to count.
  putsprite(0x100, function(col, row)
    if col == 0 or row == 0 or col == 15 or row == 15 then return 1 end
    if col >= 5 and col <= 10 and row >= 5 and row <= 10 then return 2 end
    return 1
  end)

  -- THE FIX: sixteen sprites side by side on row 100, and the seventeenth
  -- on row 132 where its strip shares no line with the others.
  for i = 0, 15 do
    sprite(i, { x = 32 + i * 16, y = 164, pattern = 0x100, palette = 0, spbg = 1 })
  end
  sprite(16, { x = 32, y = 196, pattern = 0x100, palette = 0, spbg = 1 })
end

function frame(t, f)
end
