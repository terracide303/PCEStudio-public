-- raster-scroll.lua — parallax by raster splits: four bands, four speeds.
-- Pad 1: left / right nudge the scroll; with no pad it drifts.
--
-- A complete example for the ROM route.  The one background layer is cut
-- into four bands; frame() registers one raster(line, spec) entry per band boundary, so the
-- far band crawls and the near band races.  BXR is 10 bits, so every value
-- is wrapped with a power-of-two remainder.
-- tests/check-rom-rules.js re-measures the numbers in this header.
--
-- BUDGETS (measured by validate and rom_check)
--   sprites used: 0 of 64
--   strips on the busiest line: 0 of 16
--   background palettes used: 4 of 16
--   sprite palettes used: 0 of 16
--   raster entries: 4 of 224
--   interpreter functions: 5 of 41
--   bytecode bytes: 861 of 8160
--   registers: 16 of 41
--   globals: 9 of 32
--   table slots: 4 of 16

local function puttile(char, fn)
  for row = 0, 7 do
    local w0 = 0
    for col = 0, 7 do
      local c = fn(col, row)
      if c % 2 >= 1 then w0 = w0 | (1 << (7 - col)) end
      if c >= 2 then w0 = w0 | (1 << (15 - col)) end
    end
    vram[char * 16 + row] = w0
  end
end

function init()
  reg("CR", 0x80)
  pal(0, rgb(0, 0, 1))
  for band = 0, 3 do
    pal(band * 16 + 1, rgb(1 + band * 2, 3 + band, 7 - band * 2))
    pal(band * 16 + 2, rgb(7, 7, 6 - band))
    puttile(0x40 + band, function(col, row)
      if col == 3 or col == 4 then return 2 end
      return 1 + ((col + row) % 4) // 2
    end)
    for row = band * 7, band * 7 + 6 do
      for col = 0, 31 do
        vram[row * 32 + col] = (0x40 + band) | (band << 12)
      end
    end
  end
  g_f = 0
end

function frame(t, f)
  local d = 1
  if pad[1].left then d = -3 end
  if pad[1].right then d = 4 end
  g_f = g_f + d
  reg("BYR", 0)
  -- one table-form entry per band: from its line down, until the next entry
  raster(0, { bxr = (g_f >> 3) & 1023 })
  raster(56, { bxr = (g_f >> 1) & 1023 })
  raster(112, { bxr = g_f & 1023 })
  raster(168, { bxr = (g_f << 1) & 1023 })
end
