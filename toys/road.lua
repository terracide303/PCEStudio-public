-- road.lua — a pseudo-3D road from three per-line registers (card #29).
--
-- THE TRICK: there is no 3D hardware, only a scrolling tilemap and the RCR
-- interrupt.  Each of the three things it writes per line does one job:
--
--   BYR (vertical scroll) picks which ROW of the map this line shows.  The
--       map contains the road already drawn in perspective — narrow near its
--       top, wide near its bottom — so a quadratic row mapping turns "which
--       map row" into "how far away" and the road widens toward the viewer.
--   BXR (horizontal scroll) shifts the line sideways.  Growing with the
--       square of the distance below the horizon, it bends the road: zero at
--       the horizon, largest in the foreground, the way a real road curves.
--   palette writes recolour the asphalt on each line.  A dark shade near the
--       viewer, a pale haze at the horizon (distance), and periodically a
--       bright stripe.  The stripes move down the screen with the frame
--       counter, so the road appears to rush at you without any tile moving.

local HORIZON = 88        -- first display line of the road (sky above)
local SKY_ROWS = 11       -- map rows 0..10 hold the sky

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

local function sky(y)
  local w = rgb(y // 32, y // 56, 5 - y // 48)
  return w
end

function init()
  pal(0, rgb(0, 0, 1))
  pal(1, rgb(1, 3, 7))          -- the sky's starting colour (raster rewrites it)
  pal(2, rgb(2, 2, 2))          -- asphalt (raster rewrites it per line)
  pal(3, rgb(1, 4, 1))          -- grass
  pal(4, rgb(2, 6, 2))          -- grass speckle
  pal(5, rgb(7, 7, 7))          -- road edge line
  pal(6, rgb(6, 6, 7))          -- cloud

  puttile(0x40, function(col, row) return 1 end)              -- sky
  puttile(0x41, function(col, row)                            -- cloud
    if row >= 2 and row <= 4 and col >= 1 and col <= 6 then return 6 end
    if row == 3 then return 6 end
    return 1
  end)
  puttile(0x50, function(col, row)                            -- grass, dots left
    if row == 1 and col == 2 then return 4 end
    return 3
  end)
  puttile(0x53, function(col, row)                            -- grass, dots right
    if row == 1 and col == 5 then return 4 end
    return 3
  end)
  puttile(0x51, function(col, row)                            -- left edge
    if col == 1 then return 5 end
    return 2
  end)
  puttile(0x52, function(col, row) return 2 end)              -- asphalt
  puttile(0x59, function(col, row)                            -- right edge
    if col == 6 then return 5 end
    return 2
  end)

  -- Map rows 0..10: sky, with two clouds.
  for row = 0, SKY_ROWS - 1 do
    for col = 0, 31 do
      vram[row * 32 + col] = 0x40
    end
  end
  for row = 2, 4 do
    vram[row * 32 + 5] = 0x41
    vram[row * 32 + 21] = 0x41
  end

  -- Map rows 11..31: the road in perspective.  Row r is 2*half+1 tiles wide
  -- and centred on the map, so the same texture read at a lower row is a
  -- wider piece of road — the perspective the BYR line picks from.
  for row = 11, 31 do
    -- alternating grass characters, so a line that samples a different map row
    -- shows its dots in a different place: a field, not stripes
    local grass = 0x50
    if row % 2 == 0 then grass = 0x53 end
    for col = 0, 31 do
      vram[row * 32 + col] = grass
    end
    local half = 1 + ((row - 11) * 7) // 20          -- 1..8
    for col = 16 - half, 15 + half do
      if col == 16 - half then
        vram[row * 32 + col] = 0x51
      elseif col == 15 + half then
        vram[row * 32 + col] = 0x59
      else
        vram[row * 32 + col] = 0x52
      end
    end
  end
end

function frame(t, f)
  g_f = f
  reg("BXR", 0)
  reg("BYR", 0)
end

function raster(line)
  if line < HORIZON then
    -- SKY: line n shows map row n, so the clouds sit still while BXR drifts.
    reg("BYR", line)
    reg("BXR", (g_f // 2) % 256)
    pal(1, sky(line))
  else
    -- ROAD: distance below the horizon drives all three writes.
    local dz = line - HORIZON                        -- 0 at the horizon
    reg("BYR", (11 + (dz * dz * 20) // (135 * 135)) * 8)

    local bend = (dz * dz) // 300                    -- 0..60 pixels
    if (g_f // 90) % 2 == 0 then
      reg("BXR", bend)
    else
      reg("BXR", 256 - bend)                         -- 256 - n is n px right
    end

    local haze = 4 - dz // 45                        -- pale far, dark near
    if ((dz * dz) // 40 + g_f * 4) % 48 < 12 then
      pal(2, rgb(7, 7, 5))                           -- the moving stripe
    else
      pal(2, rgb(haze, haze, haze))
    end
  end
end
