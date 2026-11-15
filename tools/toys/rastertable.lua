-- rastertable.lua: the table form raster(line, spec) on route 1 (#293).
-- Eight lines of a checkered background take their own scroll each frame:
-- bxr alone, byr alone, and both, so the entry's field mask is exercised.
-- The interpreter lowers each call to tgets of the spec's fields and reg
-- writes (docs/IL.md §14.1); its runtime commits the entries to the line
-- table the RCR chain replays.  tests/check-ilvm-raster-table.js compares the
-- host harness's entries with the browser model's; tests/check-export-games.js
-- runs this toy in Mednafen and compares a captured frame with the browser's.

init = function ()
  pal(0, rgb(0, 0, 0))
  pal(1, rgb(7, 7, 7))
  -- char 0x40 (VRAM word 0x400): a tile whose top four rows light the left
  -- four pixels and whose bottom four rows light the right four
  local y = 0
  while y < 8 do
    if y < 4 then
      vram[0x400 + y] = 0x00F0
    else
      vram[0x400 + y] = 0x000F
    end
    vram[0x408 + y] = 0
    y = y + 1
  end
  local i = 0
  while i < 896 do
    vram[i] = 0x0040
    i = i + 1
  end
end

frame = function (t, f)
  raster(0, { bxr = 0 })
  raster(24, { bxr = (f * 3) % 64 })
  raster(48, { byr = (f * 2) % 32 })
  raster(72, { bxr = 8 + f % 5, byr = 3 })
  raster(96, { bxr = (f * 5) % 64, byr = (f * 7) % 32 })
  raster(120, { byr = 5 + (f % 3) })
  raster(144, { bxr = 4 * (f % 8) })
  raster(168, { bxr = 0, byr = 0 })
end
