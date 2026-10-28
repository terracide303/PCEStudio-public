-- parallax.lua — line-scroll parallax (card #29).
--
-- THE TRICK: the PC Engine has no HDMA, so a horizontal offset that differs
-- per line of the picture is made by letting the RCR line interrupt write
-- BXR (the horizontal scroll register, VDC R07) once per band.  Every line
-- from a write until the next one keeps that value, so four writes per frame
-- give four bands scrolling at four speeds — the classic parallax layer.
--
-- This toy is four bands of diagonal stripe texture, 56 lines each, with one
-- bright marker bar per band.  Because each band gets its own BXR, the bars
-- stand at different x positions: the whole picture proves the split at a
-- glance, and the near band moves fastest, as a foreground should.

local BAND_ROWS = 7        -- BAT rows per band
local BAND_H = BAND_ROWS * 8   -- display lines per band (56)
local MARKER_CELL = 5      -- the map column of each band's marker bar

-- Write one 8x8 character.  `fn(col, row)` returns the colour number 0..15;
-- colour 0 is transparent (shows the backdrop).  The VDC stores a character
-- as two bitplanes of 16 words: word 0..7 hold pixel bits 0 and 1, word
-- 8..15 hold bits 2 and 3, each with the leftmost pixel in bit 7.
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

-- Fill BAT rows row0..row1 with `char` from palette `pal` (4 bits).
local function batfill(row0, row1, char, pal)
  for row = row0, row1 do
    for col = 0, 31 do
      vram[row * 32 + col] = char | (pal << 12)
    end
  end
end

function init()
  -- Backdrop: nearly black, so a transparent pixel reads as night sky.
  pal(0, rgb(0, 0, 1))

  for band = 0, 3 do
    local stripe = 0x40 + band * 2      -- diagonal texture
    local marker = 0x41 + band * 2      -- the same, with a bright bar
    puttile(stripe, function(col, row)
      return 1 + ((col + row) % 4) // 2   -- two shades, 2-px diagonal bands
    end)
    puttile(marker, function(col, row)
      if col == 3 or col == 4 then return 3 end
      return 1 + ((col + row) % 4) // 2
    end)

    -- One palette per band: 1 = the band's colour, 2 = its dark shade,
    -- 3 = the marker.  Far bands are cool and dark, near ones warm.
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
  -- The raster callback needs the frame number; globals persist across frames.
  g_f = f
  reg("BYR", 0)        -- no vertical scroll: screen row = map row
end

-- Called once per display line 0..223, after frame(), the way the RCR
-- interrupt runs on the console.  A write made here applies from this line
-- down until the next write — so one write per band boundary is enough.
function raster(line)
  -- Line 0 must restate the top value: the table's frame-start latch takes
  -- the last band's BXR, so the first band has to write its own.
  if line == 0 then reg("BXR", g_f // 8) end
  if line == BAND_H then reg("BXR", g_f // 2) end
  if line == BAND_H * 2 then reg("BXR", g_f) end
  if line == BAND_H * 3 then reg("BXR", (g_f * 2) % 1024) end
end
