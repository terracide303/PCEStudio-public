-- shooter.lua — a one-screen shooter: fly, fire, shoot the falling rocks.
-- Pad 1: left / right / up / down fly; button I fires.
--
-- A complete example for the ROM route: every form below is carried by the
-- exported console image (rom_check clean), and the budgets are small enough
-- to leave room to grow.  tests/check-rom-rules.js re-measures the numbers
-- in this header and fails if they drift.
--
-- BUDGETS (measured by validate and rom_check)
--   sprites used: 5 of 64
--   strips on the busiest line: 2 of 16
--   sprite palettes used: 1 of 16
--   raster entries: 0 of 224
--   background palettes used: 1 of 16
--   interpreter functions: 7 of 41
--   bytecode bytes: 1805 of 8160
--   registers: 28 of 41
--   globals: 17 of 32
--   table slots: 4 of 16
--
-- Nine SAT entries are set; with the four bullets parked the picture uses 5.
-- Layout: sprite 0 is the ship, 1..4 the bullets, 5..8 the rocks.  Idle
-- bullets are parked below the screen (SAT Y 0x1C0), so they cost nothing.

-- One 16x16 sprite pattern: four 16-word planes, leftmost pixel in bit 15.
local function putsprite(pattern, fn)
  for row = 0, 15 do
    local p0, p1 = 0, 0
    for col = 0, 15 do
      local c = fn(col, row)
      if c % 2 >= 1 then p0 = p0 | (1 << (15 - col)) end
      if c >= 2 then p1 = p1 | (1 << (15 - col)) end
    end
    vram[pattern * 64 + row] = p0
    vram[pattern * 64 + 16 + row] = p1
  end
end

bx = {0, 0, 0, 0}      -- bullet X, SAT units
by = {0x1C0, 0x1C0, 0x1C0, 0x1C0}
rx = {64, 112, 160, 208}
ry = {70, 110, 150, 90}
was = false
seed = 7

function init()
  reg("CR", 0xC0)
  pal(0, rgb(0, 0, 2))
  pal(0x101, rgb(7, 7, 7))        -- ship: white
  pal(0x102, rgb(7, 2, 1))        -- ship's wing and the bullets
  pal(0x103, rgb(4, 3, 1))        -- rocks
  putsprite(0x100, function(col, row)            -- the ship, nose up
    local d = col - 7
    if d < 0 then d = 0 - d end
    if row >= d * 2 and row < 14 and d < 7 then
      if d > 3 then return 2 end
      return 1
    end
    return 0
  end)
  putsprite(0x101, function(col, row)            -- a bullet
    if col >= 7 and col <= 8 and row < 8 then return 2 end
    return 0
  end)
  putsprite(0x102, function(col, row)            -- a rock
    local dx, dy = col - 7, row - 7
    if dx * dx + dy * dy < 48 then
      if (col + row) % 5 == 0 then return 2 end
      return 3
    end
    return 0
  end)
  for i = 0, 8 do
    local pat = 0x102
    if i == 0 then pat = 0x100 elseif i < 5 then pat = 0x101 end
    sat(i, 2, pat << 1)
    sat(i, 3, 0x80)               -- sprite palette 0, in front
  end
  sat(0, 0, 200 + 64)
  sat(0, 1, 120 + 32)
  sx = 120
  sy = 200
end

function frame(t, f)
  if pad[1].left then sx = sx - 3 end
  if pad[1].right then sx = sx + 3 end
  if pad[1].up then sy = sy - 3 end
  if pad[1].down then sy = sy + 3 end
  if sx < 0 then sx = 0 end
  if sx > 240 then sx = 240 end
  if sy < 120 then sy = 120 end
  if sy > 208 then sy = 208 end
  sat(0, 0, sy + 64)
  sat(0, 1, sx + 32)

  local fire = pad[1].i
  if fire and not was then
    for k = 1, 4 do
      if by[k] >= 0x1C0 then          -- a parked bullet: take it
        bx[k] = sx + 32
        by[k] = sy + 64
        sfx(0, 900, 24, 6)
        break
      end
    end
  end
  was = fire

  for k = 1, 4 do
    local y = by[k]
    if y < 0x1C0 then
      y = y - 6
      if y < 56 then y = 0x1C0 end    -- off the top: park it
      by[k] = y
    end
    sat(k, 0, y)
    sat(k, 1, bx[k])
    -- the rock this bullet's lane could hit
    local r = rx[k]
    local ryy = ry[k] + 64
    if y < 0x1C0 and bx[k] - 32 > r - 14 and bx[k] - 32 < r + 14 and
       y > ryy - 14 and y < ryy + 14 then
      by[k] = 0x1C0                   -- the bullet is spent
      ry[k] = 0                       -- the rock restarts at the top
      seed = (seed * 5 + 3) & 255
      rx[k] = seed
      sfx(1, 300, 28, 8)
    end
    -- the rock falls
    local nry = ry[k] + 1 + (k >> 1)
    if nry > 224 then nry = 0 end
    ry[k] = nry
    sat(4 + k, 0, nry + 64)
    sat(4 + k, 1, rx[k] + 32)
  end
end
