-- 05-fixing-a-console-finding-before.lua — the BROKEN version. The console
-- check refuses it with validate-sprite-line: 17 sprites on one display
-- line, one more than the VDC's 16 strips.
--
-- This file exists so the recipe can show the whole loop: write it, run the
-- check, read the code and the line, change ONE thing, run the check again.
-- Every other recipe file is already fixed; this is the only one that should
-- fail.
--
-- Compare with 05-fixing-a-console-finding.lua: the only difference is
-- `17` vs `16` in the loop and the seventeenth sprite's row.

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
  reg("CR", 0xC0)
  pal(0, rgb(0, 0, 1))
  pal(1, rgb(1, 2, 4))
  pal(0x101, rgb(6, 6, 2))
  pal(0x102, rgb(7, 2, 2))

  puttile(0x40, function(col, row) return 1 end)
  for row = 0, 27 do
    for col = 0, 31 do
      vram[row * 32 + col] = 0x40
    end
  end

  putsprite(0x100, function(col, row)
    if col == 0 or row == 0 or col == 15 or row == 15 then return 1 end
    if col >= 5 and col <= 10 and row >= 5 and row <= 10 then return 2 end
    return 1
  end)

  -- All seventeen on row 100: 17 strips on each of their 16 lines.
  for i = 0, 16 do
    sprite(i, { x = 32 + i * 16, y = 164, pattern = 0x100, palette = 0, spbg = 1 })
  end
end

function frame(t, f)
end
