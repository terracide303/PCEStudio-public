-- main.lua — TOWER: climb the crumbling tower, jump the boulders, reach the gem.
-- Keys: J / L run, I / K climb a ladder, N jump.
-- A heart gives a life (up to 5); the hammer smashes boulders for 8 seconds.
-- Each gem you reach makes the next round faster.

-- The art is built once, at boot.  Each pixel rule is a leaf function, so
-- the whole art call tree stays inside the interpreter's five nested calls.
local function dist(a, b)
  if a > b then return a - b end
  return b - a
end

-- kind 1 stone, 2 ladder, 3 ladder over stone, 4 level pip,
-- 5 hero, 6 walk, 7 climb, 8 boulder, 9 hammer up, 10 hammer side,
-- 11 heart, 12 mini heart, 13 gem.
local function tile_px(k, col, row)
  local lad = (col == 1 or col == 6) or
              ((row == 2 or row == 6) and col > 1 and col < 6)
  if k == 2 then
    if lad then return 4 end
    return 0
  end
  if k == 4 then
    local a = 2 * col - 7
    local b = 2 * row - 7
    if a < 0 then a = 0 - a end
    if b < 0 then b = 0 - b end
    if a + b < 7 then return 6 end
    return 0
  end
  local c = 1
  if row == 7 or (row < 4 and col == 0) or (row >= 4 and col == 4) then
    c = 2
  elseif row == 0 and col % 3 == 1 then
    c = 3
  end
  if k == 3 and lad then return 4 end
  return c
end

local function hero_px(k, col, row)
  if row >= 13 then
    if k == 6 then
      if (col >= 1 and col <= 4) or (col >= 10 and col <= 14) then return 3 end
    else
      if (col >= 3 and col <= 6) or (col >= 9 and col <= 12) then return 3 end
    end
    return 0
  end
  if k == 7 then
    if row <= 2 then
      if col == 1 or col == 2 then return 3 end
    elseif row >= 6 and row <= 7 then
      if col == 13 or col == 14 then return 3 end
    end
  else
    if col == 11 and row >= 5 and row <= 6 then return 3 end
    if col >= 9 and col <= 11 and row >= 4 and row <= 7 then return 2 end
  end
  if (col - 7) * (col - 7) + (row - 7) * (row - 7) < 50 then return 1 end
  return 0
end

local function obj_px(k, col, row)
  if k == 8 then                                  -- boulder
    local dx, dy = 2 * col - 15, 2 * row - 17
    if dx * dx + dy * dy >= 190 then return 0 end
    if (col * 3 + row * 5) % 11 == 0 then return 2 end
    if col > 8 and row > 10 and (col + row) % 3 == 0 then return 2 end
    return 1
  end
  if k == 9 then
    if row >= 1 and row <= 5 and col >= 3 and col <= 12 then return 2 end
    if row > 5 and (col == 7 or col == 8) then return 1 end
    return 0
  end
  if col >= 10 and col <= 14 and row >= 3 and row <= 12 then return 2 end
  if col < 10 and (row == 7 or row == 8) then return 1 end
  return 0
end

local function pick_px(k, col, row)
  local cc, rr = col, row
  if k == 12 then
    if col >= 8 or row >= 8 then return 0 end
    cc, rr = col * 2, row * 2
  end
  if k ~= 13 then                                 -- heart / mini heart
    local x, y = 2 * cc - 15, 2 * rr
    local lx, rx, ly = x + 6, x - 6, y - 9
    if lx * lx + ly * ly < 40 or rx * rx + ly * ly < 40 then
      if x < -4 and x > -10 and y > 5 and y < 10 then return 2 end
      return 1
    end
    local a = x
    if a < 0 then a = 0 - a end
    if y >= 9 and a * 19 <= (28 - y) * 12 then return 1 end
    return 0
  end
  local a = 2 * col - 15                        -- gem
  local b = 2 * row - 15
  if a < 0 then a = 0 - a end
  if b < 0 then b = 0 - b end
  if a + b >= 14 then return 0 end
  if col == 7 and row == 7 then return 3 end
  if col + row < 15 then return 2 end
  return 1
end

-- A background character: 16 VRAM words, leftmost pixel in bit 7.
local function puttile(char, kind)
  for row = 0, 7 do
    local w0, w1 = 0, 0
    for col = 0, 7 do
      local c = tile_px(kind, col, row)
      w0 = w0 | ((c & 1) << (7 - col)) | (((c >> 1) & 1) << (15 - col))
      w1 = w1 | (((c >> 2) & 1) << (7 - col))
    end
    vram[char * 16 + row] = w0
    if kind ~= 1 then vram[char * 16 + 8 + row] = w1 end
  end
end

-- A 16x16 sprite pattern: the two planes this art uses.  Leftmost pixel in
-- bit 15 of each plane's row word.
local function putsprite(pattern, kind)
  for row = 0, 15 do
    local p0, p1 = 0, 0
    for col = 0, 15 do
      local c
      if kind <= 7 then
        c = hero_px(kind, col, row)
      elseif kind <= 10 then
        c = obj_px(kind, col, row)
      else
        c = pick_px(kind, col, row)
      end
      local b = 15 - col
      p0 = p0 | ((c & 1) << b)
      p1 = p1 | (((c >> 1) & 1) << b)
    end
    -- Every sprite colour here is 0..3, so planes 2 and 3 are zero; the
    -- runtime zeroed VRAM, so the words are left alone (same picture).
    vram[pattern * 64 + row] = p0
    vram[pattern * 64 + 16 + row] = p1
  end
end

-- ---- the tower -------------------------------------------------------------
-- Floors (map rows): 26 ground, 20, 14, 8, and the small top ledge at 4.
-- Each floor has a gap at one end, so a boulder rolls off and drops a floor.
local function solid(col, row)
  if row == 26 or row == 27 then return true end
  if row == 20 and col <= 27 then return true end
  if row == 14 and col >= 4 then return true end
  if row == 8 and col <= 27 then return true end
  if row == 4 and col >= 12 and col <= 19 then return true end
  return false
end

-- Four ladders: left edge in pixels, the upper floor's row, the lower floor's row.
local function ladder_x(k)
  if k == 1 then return 48 end
  if k == 3 then return 120 end
  return 176
end
local function ladder_top(k)
  if k == 3 then return 4 end
  return 20 - k * 6
end

-- Falling from old_feet to feet (pixels): the floor row landed on, or -1.
-- Floors are one-way: you only land if your feet were above the top.
local function landing(x, old_feet, feet)
  local row = feet // 8
  if old_feet <= row * 8 and (solid((x + 3) // 8, row) or solid((x + 12) // 8, row)) then
    return row
  end
  return -1
end

-- The ladder under the hero, or -1.  going_up: standing at its foot.
local function ladder_here(x, feet, going_up)
  for k = 0, 3 do
    local lx = ladder_x(k)
    if x >= lx - 6 and x <= lx + 6 then
      local top = ladder_top(k) * 8
      local bot = (26 - k * 6) * 8
      if going_up and feet > top and feet <= bot then return k end
      if going_up == false and feet >= top and feet < bot then return k end
    end
  end
  return -1
end

-- ---- pictures --------------------------------------------------------------
local function draw_pictures()
  pal(0, rgb(0, 0, 2))           -- backdrop: night
  pal(1, rgb(4, 4, 5))           -- stone
  pal(2, rgb(2, 2, 3))           -- mortar
  pal(3, rgb(1, 5, 2))           -- moss
  pal(4, rgb(6, 4, 1))           -- ladder wood
  pal(6, rgb(1, 6, 7))           -- level pip
  pal(0x101, rgb(7, 4, 1))       -- hero
  pal(0x102, rgb(7, 7, 7))
  pal(0x103, rgb(1, 0, 1))
  pal(0x111, rgb(4, 3, 3))       -- boulder
  pal(0x112, rgb(2, 1, 1))
  pal(0x121, rgb(5, 3, 1))       -- hammer handle
  pal(0x122, rgb(5, 5, 6))       -- hammer head
  pal(0x131, rgb(7, 1, 2))       -- heart
  pal(0x132, rgb(7, 5, 6))
  pal(0x141, rgb(1, 6, 7))       -- gem
  pal(0x142, rgb(5, 7, 7))
  pal(0x143, rgb(7, 7, 7))

  puttile(0x41, 1)               -- stone
  puttile(0x42, 2)               -- ladder
  puttile(0x43, 3)               -- ladder over stone
  puttile(0x44, 4)               -- level pip

  -- The BAT is static: the five floor runs, then the four ladders (their
  -- top cell sits on a floor, so it is the ladder-over-stone tile).  Empty
  -- cells are left at the runtime's zero: tile 0 and tile 0x40 are both
  -- blank, so the picture is identical and init writes no blank cells.
  for c = 0, 27 do
    vram[20 * 32 + c] = 0x41
    vram[8 * 32 + c] = 0x41
  end
  for c = 0, 31 do
    vram[26 * 32 + c] = 0x41
    vram[27 * 32 + c] = 0x41
  end
  for c = 4, 31 do vram[14 * 32 + c] = 0x41 end
  for c = 12, 19 do vram[4 * 32 + c] = 0x41 end
  for k = 0, 3 do
    local c = ladder_x(k) // 8
    for r = ladder_top(k), 25 - k * 6 do
      vram[r * 32 + c] = 0x42
      vram[r * 32 + c + 1] = 0x42
    end
  end
  vram[4 * 32 + 15] = 0x43
  vram[4 * 32 + 16] = 0x43
  vram[8 * 32 + 22] = 0x43
  vram[8 * 32 + 23] = 0x43
  vram[14 * 32 + 6] = 0x43
  vram[14 * 32 + 7] = 0x43
  vram[20 * 32 + 22] = 0x43
  vram[20 * 32 + 23] = 0x43

  putsprite(0x100, 5)            -- hero, facing right
  putsprite(0x108, 6)            -- mid-stride
  putsprite(0x101, 7)            -- seen from behind, one hand up
  putsprite(0x102, 8)            -- boulder
  putsprite(0x104, 9)            -- hammer up
  putsprite(0x105, 10)           -- hammer side
  putsprite(0x106, 11)           -- heart
  putsprite(0x109, 12)           -- mini heart
  putsprite(0x107, 13)           -- gem
end

-- ---- sprites ---------------------------------------------------------------
-- SAT order: 0 hero, 1 hammer in hand, 2..7 boulders, 8 hammer pickup,
-- 9..11 hearts, 12 gem, 13..17 lives.  flip: bit 0 is hflip, bit 1 is vflip.
local function spr(i, x, y, pattern, palette, flip)
  local attr = palette | 0x80                    -- SPBG: in front of the background
  if flip % 2 == 1 then attr = attr | 0x800 end
  if flip >= 2 then attr = attr | 0x8000 end
  sat(i, 0, y + 64)
  sat(i, 1, x + 32)
  sat(i, 2, pattern << 1)
  sat(i, 3, attr)
end
local function hide(i) sat(i, 0, 0) end

local function heart_x(k)
  if k == 1 then return 40 end
  if k == 2 then return 136 end
  return 72
end
local function heart_y(k)
  if k == 1 then return 144 end
  if k == 2 then return 96 end
  return 48
end

-- ---- game state ------------------------------------------------------------
rx = { 0, 0, 0, 0, 0, 0 }
ry = { 0, 0, 0, 0, 0, 0 }
rvy = { 0, 0, 0, 0, 0, 0 }
rdir = { 0, 0, 0, 0, 0, 0 }
ron = { false, false, false, false, false, false }
heart_on = { true, true, true }

local function respawn()
  px = 16 * 16
  py = (208 - 16) * 16
  vy = 0
  face = 0
  climb_k = -1                   -- -1: not on a ladder; 0..3: that ladder
  on_ground = true
  walk = 0
  if hammer_t > 0 then hammer_t = 0 end   -- the hammer in hand is lost
  for i = 1, 6 do ron[i] = false end
  spawn_t = 90
  mode = 0
end

local function new_level()
  for k = 1, 3 do heart_on[k] = true end
  hammer_t = -1                  -- on the map until picked up (480 = in hand)
  pal(0, rgb(0, 0, 2))
  for k = 0, 7 do
    if k < level then vram[31 - k] = 0x44 else vram[31 - k] = 0 end
  end
  respawn()
end

local function hurt()
  lives = lives - 1
  mode = 1
  wait_t = 60
  sfx(3, 1200, 28, 30)
end

-- ---- the hero --------------------------------------------------------------
local function update_hero()
  local jump = pad[1].i and was_i == false
  was_i = pad[1].i
  local x = px // 16
  local feet = py // 16 + 16

  if climb_k >= 0 then
    if pad[1].up then py = py - 16; walk = walk + 1 end
    if pad[1].down then py = py + 16; walk = walk + 1 end
    feet = py // 16 + 16
    if feet <= ladder_top(climb_k) * 8 then
      py = (ladder_top(climb_k) * 8 - 16) * 16
      climb_k = -1
      on_ground = true
    elseif feet >= (26 - climb_k * 6) * 8 then
      py = ((26 - climb_k * 6) * 8 - 16) * 16
      climb_k = -1
      on_ground = true
    end
    return
  end

  if on_ground and (pad[1].up or pad[1].down) then
    local k = ladder_here(x, feet, pad[1].up)
    if k >= 0 then
      climb_k = k
      px = ladder_x(k) * 16
      vy = 0
      return
    end
  end

  local vx = 0
  if pad[1].left then vx = -20; face = 1 end
  if pad[1].right then vx = 20; face = 0 end
  if vx ~= 0 then walk = walk + 1 end
  px = px + vx
  if px < 0 then px = 0 end
  if px > 240 * 16 then px = 240 * 16 end

  if jump and on_ground then
    vy = -80
    sfx(0, 300, 18, 6)
  end
  if pad[1].i == false and vy < -24 then vy = -24 end   -- let go early: short hop

  local old_feet = py // 16 + 16
  vy = vy + 6
  if vy > 96 then vy = 96 end
  py = py + vy
  on_ground = false
  if vy >= 0 then
    local row = landing(px // 16, old_feet, py // 16 + 16)
    if row >= 0 then
      py = (row * 8 - 16) * 16
      vy = 0
      on_ground = true
    end
  end
end

-- ---- boulders --------------------------------------------------------------
local function update_rocks()
  local speed = 1
  if level >= 3 then speed = 2 end
  for i = 1, 6 do
    if ron[i] then
      local old_feet = ry[i] // 16 + 16
      rvy[i] = rvy[i] + 6
      if rvy[i] > 96 then rvy[i] = 96 end
      ry[i] = ry[i] + rvy[i]
      local row = landing(rx[i], old_feet, ry[i] // 16 + 16)
      if row >= 0 then
        ry[i] = (row * 8 - 16) * 16
        rvy[i] = 0
        if row == 8 or row == 20 then rdir[i] = 1 else rdir[i] = -1 end
        rx[i] = rx[i] + rdir[i] * speed
      end
      if rx[i] < -16 or rx[i] > 256 then ron[i] = false end
    end
  end

  spawn_t = spawn_t - 1
  if spawn_t <= 0 then
    for i = 1, 6 do
      if ron[i] == false then
        ron[i] = true
        rx[i] = 4
        ry[i] = (64 - 16) * 16
        rvy[i] = 0
        rdir[i] = 1
        break
      end
    end
    seed = (seed * 75 + 74) % 65537
    local gap = 150 - level * 15
    if gap < 50 then gap = 50 end
    spawn_t = gap + seed % 60
  end
end

-- ---- touching things -------------------------------------------------------
local function collide()
  local hx, hy = px // 16, py // 16
  for i = 1, 6 do
    if ron[i] and mode == 0 then
      local dx, dy = dist(rx[i], hx), dist(ry[i] // 16, hy)
      if hammer_t > 0 and dx < 22 and dy < 14 then
        ron[i] = false
        sfx(2, 600, 24, 8)
      elseif dx < 11 and dy < 12 then
        hurt()
      end
    end
  end
  for k = 1, 3 do
    if heart_on[k] and dist(heart_x(k), hx) < 12 and dist(heart_y(k), hy) < 12 then
      heart_on[k] = false
      if lives < 5 then lives = lives + 1 end
      sfx(1, 100, 24, 10)
    end
  end
  if hammer_t < 0 and dist(120, hx) < 12 and dist(144, hy) < 12 then
    hammer_t = 480
    sfx(1, 150, 24, 10)
  end
  if mode == 0 and dist(144, hx) < 12 and dist(16, hy) < 12 then
    mode = 2
    wait_t = 90
    sfx(1, 80, 28, 40)
  end
end

-- ---- drawing ---------------------------------------------------------------
local function draw(f)
  local hx, hy = px // 16, py // 16

  if mode == 3 or (mode == 1 and (f // 4) % 2 == 0) then
    hide(0)
  elseif climb_k >= 0 then
    spr(0, hx, hy, 0x101, 0, (walk // 8) % 2)
  elseif on_ground and (walk // 6) % 2 == 1 then
    spr(0, hx, hy, 0x108, 0, face)
  else
    spr(0, hx, hy, 0x100, 0, face)
  end

  if hammer_t > 0 and mode ~= 3 and (hammer_t > 120 or (f // 4) % 2 == 0) then
    if (f // 8) % 2 == 0 then
      spr(1, hx, hy - 12, 0x104, 2, 0)
    elseif face == 0 then
      spr(1, hx + 12, hy, 0x105, 2, 0)
    else
      spr(1, hx - 12, hy, 0x105, 2, 1)
    end
  else
    hide(1)
  end

  for i = 1, 6 do
    if ron[i] then
      local turn = (rx[i] // 4) % 4                 -- a quarter-turn every 4 px
      local flip = turn
      if flip == 2 then flip = 3 elseif flip == 3 then flip = 2 end
      spr(1 + i, rx[i], ry[i] // 16, 0x102, 1, flip)
    else
      hide(1 + i)
    end
  end

  if hammer_t < 0 then spr(8, 120, 144, 0x104, 2, 0) else hide(8) end
  for k = 1, 3 do
    if heart_on[k] then
      spr(8 + k, heart_x(k), heart_y(k) - (f // 16) % 2, 0x106, 3, 0)
    else
      hide(8 + k)
    end
  end
  spr(12, 144, 16 - (f // 12) % 3, 0x107, 4, 0)
  for k = 0, 4 do
    if k < lives then spr(13 + k, 4 + k * 10, 4, 0x109, 3, 0) else hide(13 + k) end
  end
end

-- ---- the game --------------------------------------------------------------
function init()
  draw_pictures()
  reg("CR", 0xC0)                -- background + sprites on
  seed = 1
  was_i = false
  lives = 3
  level = 1
  new_level()
end

function frame(t, f)
  if mode == 0 then
    update_hero()
    update_rocks()
    if hammer_t > 0 then hammer_t = hammer_t - 1 end
    collide()
  elseif mode == 1 then          -- hit: blink, then try again
    wait_t = wait_t - 1
    if wait_t <= 0 then
      if lives <= 0 then
        mode = 3
        wait_t = 150
        pal(0, rgb(2, 0, 0))
      else
        respawn()
      end
    end
  elseif mode == 2 then          -- reached the gem: flash, then a faster tower
    wait_t = wait_t - 1
    if (f // 6) % 2 == 0 then pal(0, rgb(1, 3, 5)) else pal(0, rgb(0, 0, 2)) end
    if wait_t <= 0 then
      level = level + 1
      new_level()
    end
  else                           -- game over: a red sky, then start again
    wait_t = wait_t - 1
    if wait_t <= 0 then
      lives = 3
      level = 1
      new_level()
    end
  end
  draw(f)
end
