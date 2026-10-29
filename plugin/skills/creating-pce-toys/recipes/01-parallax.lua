-- 01-parallax.lua — line-scroll parallax.
--
-- THE TRICK: the PC Engine has no HDMA. The per-line hook is the VDC's
-- line interrupt (RCR): a raster entry written for line L applies from L
-- down until the next entry. A BXR entry at each band boundary gives four
-- bands scrolling at four speeds.
--
-- The cheap form is a TABLE, not a callback. A raster(line) callback costs
-- cycles on all 224 lines; four entries only touch four. This recipe is
-- clean at 60 Hz because of that; the callback form of the same picture is
-- 2.6x over budget (validate-slow-frame).
--
-- Four bands of diagonal stripe texture, 56 lines each, one bright marker
-- bar per band. Each band has its own BXR, so the bars stand at different x
-- positions: the picture proves the split at a glance.

local BAND_ROWS = 7             -- BAT rows per band
local BAND_H = BAND_ROWS * 8    -- display lines per band (56)
local MARKER_CELL = 5           -- the map column of each band's marker bar

-- One 8x8 character. fn(col, row) returns colour 0..15; colour 0 is
-- transparent. A character is two bitplanes of 16 words: words 0..7 hold
-- pixel bits 0 and 1, words 8..15 hold bits 2 and 3, leftmost pixel in bit 7.
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

-- Fill BAT rows row0..row1 with character char from background palette pal.
local function batfill(row0, row1, char, pal)
  for row = row0, row1 do
    for col = 0, 31 do
      vram[row * 32 + col] = char | (pal << 12)
    end
  end
end

function init()
  pal(0, rgb(0, 0, 1))          -- backdrop: nearly black night sky

  for band = 0, 3 do
    local stripe = 0x40 + band * 2       -- diagonal texture
    local marker = 0x41 + band * 2       -- the same, with a bright bar
    puttile(stripe, function(col, row)
      return 1 + ((col + row) % 4) // 2
    end)
    puttile(marker, function(col, row)
      if col == 3 or col == 4 then return 3 end
      return 1 + ((col + row) % 4) // 2
    end)

    -- One palette per band: 1 = the band's colour, 2 = its dark shade,
    -- 3 = the marker. Far bands are cool and dark, near ones warm.
    pal(band * 16 + 1, rgb(1 + band * 2, 3 + band, 7 - band * 2))
    pal(band * 16 + 2, rgb(0 + band * 2, 2 + band, 5 - band * 2))
    pal(band * 16 + 3, rgb(7, 7, 6 - band))

    batfill(band * BAND_ROWS, band * BAND_ROWS + BAND_ROWS - 1, stripe, band)
    for row = band * BAND_ROWS, band * BAND_ROWS + BAND_ROWS - 1 do
      vram[row * 32 + MARKER_CELL] = marker | (band << 12)
    end
  end
end

function frame(t, f)
  reg("BYR", 0)                 -- no vertical scroll: screen row = map row

  -- One entry per band boundary. Line 0 must restate the top value: the
  -- frame-start latch takes the last band's BXR. The near band (line 168
  -- down) moves twice as fast as the one above it.
  raster(0, { bxr = f // 8 })
  raster(BAND_H, { bxr = f // 2 })
  raster(BAND_H * 2, { bxr = f })
  raster(BAND_H * 3, { bxr = (f * 2) % 1024 })
end
