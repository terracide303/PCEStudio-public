-- platformer.lua — run and jump over a pit, up onto three ledges.
-- Pad 1: left / right run; button I jumps (let go early for a short hop).
--
-- A complete example for the ROM route.  Positions are in 1/16 pixel, so the
-- maths is shifts and compares; the level is a rule (cell), not a table; the
-- background is drawn once in init() and never touched again.
-- tests/check-rom-rules.js re-measures the numbers in this header.
--
-- BUDGETS (measured by validate and rom_check)
--   sprites used: 1 of 64
--   strips on the busiest line: 1 of 16
--   sprite palettes used: 1 of 16
--   raster entries: 0 of 224
--   background palettes used: 1 of 16
--   interpreter functions: 9 of 41
--   bytecode bytes: 1693 of 8160
--   registers: 23 of 41
--   globals: 13 of 32

local function puttile(char, fn)          -- one 8x8 background character
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

local function putsprite(pattern, fn)     -- one 16x16 sprite pattern
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

-- 0 sky, 1 grass, 2 ledge.  The same rule draws the map and lands the hero.
local function cell(col, row)
  local ground = col < 12 or col > 15
  if row >= 24 and ground then return 1 end
  if row == 19 and col >= 3 and col <= 8 then return 2 end
  if row == 15 and col >= 12 and col <= 17 then return 2 end
  if row == 11 and col >= 21 and col <= 26 then return 2 end
  return 0
end

function init()
  reg("CR", 0xC0)
  pal(0, rgb(2, 4, 7))
  pal(1, rgb(1, 6, 1))
  pal(2, rgb(3, 2, 1))
  pal(0x101, rgb(7, 4, 1))
  pal(0x102, rgb(1, 0, 1))
  puttile(0x41, function(col, row) return 1 + (row // 2) % 2 end)
  puttile(0x42, function(col, row) return 2 end)
  for row = 0, 27 do
    for col = 0, 31 do vram[row * 32 + col] = 0x40 + cell(col, row) end
  end
  putsprite(0x100, function(col, row)
    local dx, dy = col - 7, row - 7
    if dx * dx + dy * dy < 50 then
      if row < 5 and col > 7 and col < 12 then return 2 end
      return 1
    end
    return 0
  end)
  sat(0, 2, 0x100 << 1)
  sat(0, 3, 0x80)
  px = 24 * 16
  py = 176 * 16
  vy = 0
  was = false
  ground = true
end

function frame(t, f)
  if pad[1].right then px = px + 24 end
  if pad[1].left then px = px - 24 end
  if px < 0 then px = 0 end
  if px > 240 * 16 then px = 240 * 16 end

  local jump = pad[1].i
  if jump then
    if not was and ground then vy = -96 end
  elseif vy < -24 then
    vy = -24
  end
  was = jump

  vy = vy + 5
  if vy > 80 then vy = 80 end
  local ny = py + vy
  ground = false
  if vy >= 0 then
    -- falling: land on the first solid cell under the feet
    local feet = ((ny >> 4) + 16) >> 3        -- the BAT row of the feet
    local lo = ((px >> 4) + 4) >> 3
    local hi = ((px >> 4) + 11) >> 3
    local oldfeet = ((py >> 4) + 16) >> 3
    if feet > oldfeet or feet == oldfeet then
      if cell(lo, feet) > 0 or cell(hi, feet) > 0 then
        if (((py >> 4) + 16) & 7) == 0 or feet > oldfeet then
          ny = (feet * 8 - 16) * 16
          vy = 0
          ground = true
        end
      end
    end
  end
  py = ny
  if py > 230 * 16 then            -- fell in the pit: back to the start
    px = 24 * 16
    py = 176 * 16
    vy = 0
  end
  sat(0, 0, (py >> 4) + 64)
  sat(0, 1, (px >> 4) + 32)
end
