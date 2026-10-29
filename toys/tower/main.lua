-- main.lua — TOWER: climb the crumbling tower, jump the boulders, reach the gem.
-- Keys: J / L run, I / K climb a ladder, N jump.
-- A heart gives a life (up to 5); the hammer smashes boulders for 8 seconds.
-- Each gem you reach makes the next round faster.

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

local NROCKS = 6
local HERO, WALK, CLIMB, ROCK = 0x100, 0x108, 0x101, 0x102
local HAMMER_UP, HAMMER_SIDE, HEART, GEM, MINI = 0x104, 0x105, 0x106, 0x107, 0x109

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
local function ladder_bottom(k) return 26 - k * 6 end

local function is_ladder(col, row)
  for k = 0, 3 do
    local c = ladder_x(k) // 8
    if (col == c or col == c + 1) and row >= ladder_top(k) and row < ladder_bottom(k) then
      return true
    end
  end
  return false
end

local function cell(col, row)
  local l = is_ladder(col, row)
  local s = solid(col, row)
  if l and s then return 3 end
  if l then return 2 end
  if s then return 1 end
  return 0
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
      local bot = ladder_bottom(k) * 8
      if going_up and feet > top and feet <= bot then return k end
      if not going_up and feet >= top and feet < bot then return k end
    end
  end
  return -1
end

local function dist(a, b)
  if a > b then return a - b end
  return b - a
end

-- ---- pictures --------------------------------------------------------------
local function stone(col, row)
  if row == 7 then return 2 end
  if row < 4 and col == 0 then return 2 end
  if row >= 4 and col == 4 then return 2 end
  if row == 0 and col % 3 == 1 then return 3 end   -- moss
  return 1
end

local function ladder_px(col, row)
  if col == 1 or col == 6 then return true end
  if (row == 2 or row == 6) and col > 1 and col < 6 then return true end
  return false
end

local function heart_px(col, row)
  local x, y = 2 * col - 15, 2 * row
  local lx, rx, ly = x + 6, x - 6, y - 9
  if lx * lx + ly * ly < 40 or rx * rx + ly * ly < 40 then
    if x < -4 and x > -10 and y > 5 and y < 10 then return 2 end
    return 1
  end
  if y >= 9 and dist(x, 0) * 19 <= (28 - y) * 12 then return 1 end
  return 0
end

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

  puttile(0x41, function(col, row)
    local c = stone(col, row)
    return c
  end)
  puttile(0x42, function(col, row)
    if ladder_px(col, row) then return 4 end
    return 0
  end)
  puttile(0x43, function(col, row)
    if ladder_px(col, row) then return 4 end
    local c = stone(col, row)
    return c
  end)
  puttile(0x44, function(col, row)
    if dist(2 * col, 7) + dist(2 * row, 7) < 7 then return 6 end
    return 0
  end)

  for row = 0, 27 do
    for col = 0, 31 do vram[row * 32 + col] = 0x40 + cell(col, row) end
  end

  putsprite(HERO, function(col, row)              -- facing right
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
  putsprite(WALK, function(col, row)              -- mid-stride
    if row >= 13 then
      if (col >= 1 and col <= 4) or (col >= 10 and col <= 14) then return 3 end
      return 0
    end
    if col == 11 and row >= 5 and row <= 6 then return 3 end
    if col >= 9 and col <= 11 and row >= 4 and row <= 7 then return 2 end
    local dx, dy = col - 7, row - 7
    if dx * dx + dy * dy < 50 then return 1 end
    return 0
  end)
  putsprite(CLIMB, function(col, row)             -- seen from behind, one hand up
    if row <= 2 and (col == 1 or col == 2) then return 3 end
    if row >= 6 and row <= 7 and (col == 13 or col == 14) then return 3 end
    if row >= 13 then
      if (col >= 3 and col <= 6) or (col >= 9 and col <= 12) then return 3 end
      return 0
    end
    local dx, dy = col - 7, row - 7
    if dx * dx + dy * dy < 50 then return 1 end
    return 0
  end)
  putsprite(ROCK, function(col, row)
    local dx, dy = 2 * col - 15, 2 * row - 17
    if dx * dx + dy * dy >= 190 then return 0 end
    if (col * 3 + row * 5) % 11 == 0 then return 2 end
    if col > 8 and row > 10 and (col + row) % 3 == 0 then return 2 end
    return 1
  end)
  putsprite(HAMMER_UP, function(col, row)
    if row >= 1 and row <= 5 and col >= 3 and col <= 12 then return 2 end
    if row > 5 and (col == 7 or col == 8) then return 1 end
    return 0
  end)
  putsprite(HAMMER_SIDE, function(col, row)
    if col >= 10 and col <= 14 and row >= 3 and row <= 12 then return 2 end
    if col < 10 and (row == 7 or row == 8) then return 1 end
    return 0
  end)
  putsprite(HEART, function(col, row)
    local c = heart_px(col, row)
    return c
  end)
  putsprite(MINI, function(col, row)
    if col < 8 and row < 8 then
      local c = heart_px(col * 2, row * 2)
      return c
    end
    return 0
  end)
  putsprite(GEM, function(col, row)
    local d = dist(2 * col, 15) + dist(2 * row, 15)
    if d >= 14 then return 0 end
    if col == 7 and row == 7 then return 3 end
    if col + row < 15 then return 2 end
    return 1
  end)
end

-- ---- sprites ---------------------------------------------------------------
-- SAT order: 0 hero, 1 hammer in hand, 2..7 boulders, 8 hammer pickup,
-- 9..11 hearts, 12 gem, 13..17 lives.
local function spr(i, x, y, pattern, palette, hflip, vflip)
  local attr = palette | 0x80                    -- SPBG: in front of the background
  if hflip then attr = attr | 0x800 end
  if vflip then attr = attr | 0x8000 end
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
local HAMMER_X, HAMMER_Y = 120, 144
local GEM_X, GEM_Y = 144, 16

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
  climbing = false
  climb_k = 0
  on_ground = true
  walk = 0
  hammer_t = 0
  for i = 1, NROCKS do ron[i] = false end
  spawn_t = 90
  mode = 0
end

local function new_level()
  for k = 1, 3 do heart_on[k] = true end
  hammer_here = true
  pal(0, rgb(0, 0, 2))
  for k = 0, 7 do
    if k < level then vram[31 - k] = 0x44 else vram[31 - k] = 0x40 end
  end
  respawn()
end

local function new_game()
  lives = 3
  level = 1
  new_level()
end

local function hurt()
  lives = lives - 1
  mode = 1
  wait_t = 60
  sfx(3, 1200, 28, 30)
end

-- ---- the hero --------------------------------------------------------------
local function update_hero()
  local jump = pad[1].i and not was_i
  was_i = pad[1].i
  local x = px // 16
  local feet = py // 16 + 16

  if climbing then
    if pad[1].up then py = py - 16; walk = walk + 1 end
    if pad[1].down then py = py + 16; walk = walk + 1 end
    feet = py // 16 + 16
    if feet <= ladder_top(climb_k) * 8 then
      py = (ladder_top(climb_k) * 8 - 16) * 16
      climbing = false
      on_ground = true
    elseif feet >= ladder_bottom(climb_k) * 8 then
      py = (ladder_bottom(climb_k) * 8 - 16) * 16
      climbing = false
      on_ground = true
    end
    return
  end

  if on_ground and (pad[1].up or pad[1].down) then
    local k = ladder_here(x, feet, pad[1].up)
    if k >= 0 then
      climbing = true
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
  if not pad[1].i and vy < -24 then vy = -24 end   -- let go early: short hop

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
local function spawn_rock()
  for i = 1, NROCKS do
    if not ron[i] then
      ron[i] = true
      rx[i] = 4
      ry[i] = (64 - 16) * 16
      rvy[i] = 0
      rdir[i] = 1
      return
    end
  end
end

local function update_rocks(f)
  local speed = 1
  if level >= 3 then speed = 2 end
  for i = 1, NROCKS do
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
    spawn_rock()
    seed = (seed * 75 + 74) % 65537
    local gap = 150 - level * 15
    if gap < 50 then gap = 50 end
    spawn_t = gap + seed % 60
  end
end

-- ---- touching things -------------------------------------------------------
local function collide()
  local hx, hy = px // 16, py // 16
  for i = 1, NROCKS do
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
  if hammer_here and dist(HAMMER_X, hx) < 12 and dist(HAMMER_Y, hy) < 12 then
    hammer_here = false
    hammer_t = 480
    sfx(1, 150, 24, 10)
  end
  if mode == 0 and dist(GEM_X, hx) < 12 and dist(GEM_Y, hy) < 12 then
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
  elseif climbing then
    spr(0, hx, hy, CLIMB, 0, (walk // 8) % 2 == 1, false)
  elseif on_ground and (walk // 6) % 2 == 1 then
    spr(0, hx, hy, WALK, 0, face == 1, false)
  else
    spr(0, hx, hy, HERO, 0, face == 1, false)
  end

  if hammer_t > 0 and mode ~= 3 and (hammer_t > 120 or (f // 4) % 2 == 0) then
    if (f // 8) % 2 == 0 then
      spr(1, hx, hy - 12, HAMMER_UP, 2, false, false)
    elseif face == 0 then
      spr(1, hx + 12, hy, HAMMER_SIDE, 2, false, false)
    else
      spr(1, hx - 12, hy, HAMMER_SIDE, 2, true, false)
    end
  else
    hide(1)
  end

  for i = 1, NROCKS do
    if ron[i] then
      local turn = (rx[i] // 4) % 4                 -- a quarter-turn every 4 px
      spr(1 + i, rx[i], ry[i] // 16, ROCK, 1, turn == 1 or turn == 2, turn >= 2)
    else
      hide(1 + i)
    end
  end

  if hammer_here then spr(8, HAMMER_X, HAMMER_Y, HAMMER_UP, 2, false, false) else hide(8) end
  for k = 1, 3 do
    if heart_on[k] then
      spr(8 + k, heart_x(k), heart_y(k) - (f // 16) % 2, HEART, 3, false, false)
    else
      hide(8 + k)
    end
  end
  spr(12, GEM_X, GEM_Y - (f // 12) % 3, GEM, 4, false, false)
  for k = 0, 4 do
    if k < lives then spr(13 + k, 4 + k * 10, 4, MINI, 3, false, false) else hide(13 + k) end
  end
end

-- ---- the game --------------------------------------------------------------
function init()
  draw_pictures()
  reg("CR", 0xC0)                -- background + sprites on
  seed = 1
  was_i = false
  new_game()
end

function frame(t, f)
  if mode == 0 then
    update_hero()
    update_rocks(f)
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
    if wait_t <= 0 then new_game() end
  end
  draw(f)
end
