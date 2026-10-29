-- main.lua — a small platformer: run, jump, land on platforms.
-- Version 1: one screen, one hero, no enemies yet.
-- Keys: J / L run, N jump (hold it longer to jump higher).

-- A background character: 16 VRAM words, leftmost pixel in bit 7.
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

-- A 16x16 sprite pattern: 64 VRAM words, four planes, leftmost pixel in bit 15.
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

-- The level as a rule, not a table: 0 sky, 1 grass top, 2 dirt, 3 brick.
-- The same rule draws the map and decides where the hero can stand.
local function cell(col, row)
  local ground = col < 12 or col > 15          -- a 4-tile pit in the middle
  if row == 24 and ground then return 1 end
  if row > 24 and ground then return 2 end
  if row == 19 and col >= 3 and col <= 8 then return 3 end
  if row == 15 and col >= 12 and col <= 17 then return 3 end
  if row == 11 and col >= 21 and col <= 26 then return 3 end
  return 0
end

local function respawn()
  px = 24 * 16                 -- position in 1/16 pixels
  py = (192 - 16) * 16         -- standing on the grass
  vx, vy = 0, 0
end

function init()
  pal(0, rgb(2, 4, 7))         -- backdrop: the sky
  pal(1, rgb(1, 6, 1))         -- grass
  pal(2, rgb(4, 2, 1))         -- dirt
  pal(3, rgb(3, 1, 0))         -- dirt speckle
  pal(4, rgb(6, 3, 1))         -- brick
  pal(5, rgb(3, 1, 1))         -- mortar
  pal(0x101, rgb(7, 4, 1))     -- hero: orange body
  pal(0x102, rgb(7, 7, 7))     -- eye white
  pal(0x103, rgb(1, 0, 1))     -- pupil and feet

  -- char 0x40 stays all colour 0: sky
  puttile(0x41, function(col, row)               -- grass on dirt
    if row < 2 or (row == 2 and col % 3 == 0) then return 1 end
    if (col + row * 3) % 7 == 0 then return 3 end
    return 2
  end)
  puttile(0x42, function(col, row)               -- dirt
    if (col + row * 3) % 7 == 0 then return 3 end
    return 2
  end)
  puttile(0x43, function(col, row)               -- brick
    if row == 3 or row == 7 then return 5 end
    if row < 3 and col == 0 then return 5 end
    if row > 3 and col == 4 then return 5 end
    return 4
  end)

  for row = 0, 27 do
    for col = 0, 31 do vram[row * 32 + col] = 0x40 + cell(col, row) end
  end

  putsprite(0x100, function(col, row)            -- the hero, facing right
    if row >= 13 then
      if (col >= 3 and col <= 6) or (col >= 9 and col <= 12) then return 3 end
      return 0
    end
    if col == 11 and row >= 5 and row <= 6 then return 3 end
    if col >= 9 and col <= 11 and row >= 4 and row <= 7 then return 2 end
    local dx, dy = col - 7, row - 7
    if dx * dx + dy * dy < 50 then return 1 end
    return 0
  end)

  reg("CR", 0xC0)              -- background + sprites on
  face = 0
  was_i = false
  on_ground = false
  respawn()
end

function frame(t, f)
  vx = 0
  if pad[1].left then vx = -24; face = 1 end
  if pad[1].right then vx = 24; face = 0 end
  px = px + vx
  if px < 0 then px = 0 end
  if px > 240 * 16 then px = 240 * 16 end

  if pad[1].i and not was_i and on_ground then vy = -96 end
  if not pad[1].i and vy < -24 then vy = -24 end   -- let go early: short hop
  was_i = pad[1].i

  local old_feet = py // 16 + 16
  vy = vy + 6
  if vy > 96 then vy = 96 end
  py = py + vy

  -- Land only while falling, and only if the feet were above the tile's top:
  -- platforms are one-way, you jump up through them.
  on_ground = false
  if vy >= 0 then
    local x = px // 16
    local row = (py // 16 + 16) // 8
    if old_feet <= row * 8 and (cell((x + 3) // 8, row) > 0 or cell((x + 12) // 8, row) > 0) then
      py = (row * 8 - 16) * 16
      vy = 0
      on_ground = true
    end
  end

  if py // 16 > 224 then respawn() end              -- fell in the pit

  local attr = 0x80                                  -- palette 0, in front of the background
  if face == 1 then attr = attr | 0x800 end          -- HFLIP when running left
  sat(0, 0, py // 16 + 64)
  sat(0, 1, px // 16 + 32)
  sat(0, 2, 0x100 << 1)
  sat(0, 3, attr)
end
