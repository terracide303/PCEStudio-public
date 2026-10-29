-- main.lua — DUSK RUN: an endless runner over five layers of line-scroll parallax.
-- Keys: N jump (hold it longer to jump higher). Jump the rocks, stay under the
-- birds, grab hearts for a life. After a game over, press N to run again.
--
-- THE TRICK: raster(line) writes BXR at four band edges, so each band of the
-- picture scrolls at its own speed — clouds 1/8, mountains 1/4, hills 1/2,
-- ground 1/1 — and line 0 holds the score bar still. The same callback writes
-- the backdrop colour on every sky line, so the sunset is a palette gradient.

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

-- The bands, in display lines.
local SKY_TOP = 16          -- lines 0..15: the score bar, never scrolls
local MOUNT_TOP = 80
local HILL_TOP = 128
local GROUND_TOP = 168
local NOBJ = 4

local HERO, WALK, ROCK, BIRD1, BIRD2, HEART, MINI = 0x100, 0x108, 0x102, 0x103, 0x104, 0x106, 0x109

local function dist(a, b)
  if a > b then return a - b end
  return b - a
end

-- A triangle wave, 0..amp, repeating every `period` pixels.
local function tri(x, period, amp)
  local h = period // 2
  local d = x % period - h
  if d < 0 then d = -d end
  return amp * d // h
end

-- ---- the landscape, as pixel rules -----------------------------------------
-- Every period divides 256, the map's width, so each band wraps seamlessly.
local function mount_y(x) return 84 + tri(x, 128, 22) + tri(x + 37, 64, 10) end
local function hill_y(x) return 138 + tri(x, 128, 12) + tri(x + 10, 32, 4) end

local function puff(x, y, cx, cy, r)
  local dx = (x - cx + 128) % 256 - 128
  local dy = y - cy
  return dx * dx + dy * dy * 2 < r * r
end

local function cloud(x, y, cx, cy)
  if y > cy + 6 then return 0 end
  if puff(x, y, cx - 10, cy + 2, 9) or puff(x, y, cx, cy - 2, 12) or puff(x, y, cx + 11, cy + 2, 8) then
    if y > cy + 3 then return 2 end
    return 1
  end
  return 0
end

-- The colour number of map pixel (x, y) in the three generated bands.
local function land(x, y)
  if y < MOUNT_TOP then
    local c = cloud(x, y, 40, 40)
    if c == 0 then c = cloud(x, y, 140, 54) end
    if c == 0 then c = cloud(x, y, 212, 36) end
    return c
  end
  if y < HILL_TOP then
    local my = mount_y(x)
    if y < my then return 0 end
    if y < my + 4 and my < 100 then return 2 end        -- snow on the peaks
    if x % 128 >= 64 then return 3 end                   -- the slope facing away
    return 1
  end
  local hy = hill_y(x)
  if y < hy then return 0 end
  if (x + 2 * y) % 16 < 3 then return 2 end
  return 1
end

local function band_pal(row)
  if row < 10 then return 0 end
  if row < 16 then return 2 end
  return 3
end

-- ---- the score bar's font: 3x5 digits packed into 15 bits -------------------
local function glyph(d)
  if d == 0 then return 31599 end
  if d == 1 then return 11415 end
  if d == 2 then return 29671 end
  if d == 3 then return 29647 end
  if d == 4 then return 23497 end
  if d == 5 then return 31183 end
  if d == 6 then return 31215 end
  if d == 7 then return 29330 end
  if d == 8 then return 31727 end
  if d == 9 then return 31695 end
  if d == 10 then return 23533 end     -- H
  return 29847                          -- I
end

local function glyph_px(bits, col, row)
  if col < 1 or col > 6 or row < 1 then return 1 end
  local fr = ((row - 1) * 5) // 7
  local fc = (col - 1) // 2
  if (bits >> (14 - (fr * 3 + fc))) & 1 == 1 then return 2 end
  return 1
end

local function put_number(col, n)
  for i = 4, 0, -1 do
    vram[32 + col + i] = (0x50 + n % 10) | (1 << 12)
    n = n // 10
  end
end

-- ---- pictures --------------------------------------------------------------
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

local function blob(col, row, stride)
  if row >= 13 then
    if stride then
      if (col >= 1 and col <= 4) or (col >= 10 and col <= 14) then return 3 end
    elseif (col >= 3 and col <= 6) or (col >= 9 and col <= 12) then
      return 3
    end
    return 0
  end
  if col == 11 and row >= 5 and row <= 6 then return 3 end
  if col >= 9 and col <= 11 and row >= 4 and row <= 7 then return 2 end
  local dx, dy = col - 7, row - 7
  if dx * dx + dy * dy < 50 then return 1 end
  return 0
end

local function bird_px(col, row, up)
  if col <= 2 and row >= 7 and row <= 8 then return 2 end      -- beak, facing left
  if col == 4 and row == 6 then return 3 end                    -- eye
  local dx, dy = col - 7, row - 8
  if dx * dx + dy * dy * 3 < 30 then return 1 end               -- body
  if up and col >= 6 and col <= 11 and row >= 1 and row < 8 and col - 4 >= row - 1 then return 1 end
  if not up and col >= 6 and col <= 11 and row > 8 and row <= 14 and col - 4 >= 14 - row then return 1 end
  return 0
end

-- Clouds (rows 3..7), mountains (10..15) and hills (16..20): one character per
-- cell, drawn from the pixel rules above. That is 512 characters, far too many
-- for one frame of the browser's Lua budget, so frame() draws four a frame.
local function build_tiles(n)
  local row = 3 + n // 8
  if row >= 8 then row = row + 2 end
  local ch = 0x60 + (row - 3) * 32
  if row >= 10 then ch = ch - 64 end
  for col = (n % 8) * 4, (n % 8) * 4 + 3 do
    puttile(ch + col, function(c, r)
      local v = land(col * 8 + c, row * 8 + r)
      return v
    end)
    vram[row * 32 + col] = (ch + col) | (band_pal(row) << 12)
  end
end

local function draw_base()
  -- background palettes: 0 clouds, 1 score bar, 2 mountains, 3 hills, 4 ground
  pal(1, rgb(7, 7, 7))
  pal(2, rgb(6, 5, 6))
  pal(16 + 1, rgb(0, 0, 1))
  pal(16 + 2, rgb(7, 6, 3))
  pal(32 + 1, rgb(2, 1, 4))
  pal(32 + 2, rgb(7, 6, 7))
  pal(32 + 3, rgb(1, 1, 3))
  pal(48 + 1, rgb(1, 3, 2))
  pal(48 + 2, rgb(0, 2, 1))
  pal(64 + 1, rgb(2, 6, 1))
  pal(64 + 2, rgb(1, 4, 1))
  pal(64 + 3, rgb(4, 2, 1))
  pal(64 + 4, rgb(3, 1, 0))
  pal(64 + 5, rgb(5, 4, 4))
  -- sprite palettes: 0 hero, 1 rock, 2 bird, 3 heart
  pal(0x101, rgb(7, 4, 1))
  pal(0x102, rgb(7, 7, 7))
  pal(0x103, rgb(1, 0, 1))
  pal(0x111, rgb(4, 3, 3))
  pal(0x112, rgb(2, 1, 1))
  pal(0x121, rgb(2, 0, 2))
  pal(0x122, rgb(7, 6, 1))
  pal(0x123, rgb(7, 7, 7))
  pal(0x131, rgb(7, 1, 2))
  pal(0x132, rgb(7, 5, 6))

  -- the map
  for row = 0, 31 do
    for col = 0, 31 do vram[row * 32 + col] = 0x40 end
  end
  for col = 0, 31 do
    vram[col] = 0x4F | (1 << 12)
    vram[32 + col] = 0x4F | (1 << 12)
    vram[21 * 32 + col] = 0x41 | (4 << 12)
    for row = 22, 27 do
      local ch = 0x42
      if (col * 7 + row * 3) % 5 == 0 then ch = 0x43 end
      vram[row * 32 + col] = ch | (4 << 12)
    end
  end
  vram[32 + 23] = 0x5A | (1 << 12)     -- H
  vram[32 + 24] = 0x5B | (1 << 12)     -- I
end

-- Everything else is drawn a small piece per frame: steps 0..8 the sprites,
-- the font and the ground, steps 9..136 the landscape (BUILD_STEPS in all).
local BUILD_STEPS = 137

local function draw_step(s)
  if s == 0 then
    putsprite(HERO, function(col, row)
      local c = blob(col, row, false)
      return c
    end)
  elseif s == 1 then
    putsprite(WALK, function(col, row)
      local c = blob(col, row, true)
      return c
    end)
  elseif s == 2 then
    putsprite(ROCK, function(col, row)
      local dx, dy = 2 * col - 15, 2 * row - 21
      if row < 4 or dx * dx + dy * dy * 2 >= 260 then return 0 end
      if (col * 3 + row * 5) % 11 == 0 then return 2 end
      return 1
    end)
  elseif s == 3 then
    putsprite(BIRD1, function(col, row)
      local c = bird_px(col, row, true)
      return c
    end)
  elseif s == 4 then
    putsprite(BIRD2, function(col, row)
      local c = bird_px(col, row, false)
      return c
    end)
  elseif s == 5 then
    putsprite(HEART, function(col, row)
      local c = heart_px(col, row)
      return c
    end)
  elseif s == 6 then
    putsprite(MINI, function(col, row)
      if col < 8 and row < 8 then
        local c = heart_px(col * 2, row * 2)
        return c
      end
      return 0
    end)
  elseif s == 7 then
    -- the score bar: a blank cell, digits 0x50..0x59, then H and I
    puttile(0x4F, function(col, row) return 1 end)
    for d = 0, 11 do
      local bits = glyph(d)
      puttile(0x50 + d, function(col, row)
        local c = glyph_px(bits, col, row)
        return c
      end)
    end
  elseif s == 8 then
    -- the ground: grass top, then dirt with the odd stone
    puttile(0x41, function(col, row)
      if row < 2 then return 1 end
      if row == 2 and col % 3 ~= 0 then return 2 end
      if (col * 3 + row) % 7 == 0 then return 4 end
      return 3
    end)
    puttile(0x42, function(col, row)
      if (col * 3 + row) % 7 == 0 then return 4 end
      return 3
    end)
    puttile(0x43, function(col, row)
      local dx, dy = col - 3, row - 4
      if dx * dx + dy * dy < 7 then return 5 end
      return 3
    end)
  else
    build_tiles(s - 9)
  end
end

-- ---- sprites ---------------------------------------------------------------
-- SAT order: 0 hero, 1..4 rocks/birds/hearts, 5..9 lives.
local function spr(i, x, y, pattern, palette)
  sat(i, 0, y + 64)
  sat(i, 1, x + 32)
  sat(i, 2, pattern << 1)
  sat(i, 3, palette | 0x80)        -- SPBG: in front of the background
end
local function hide(i) sat(i, 0, 0) end

-- ---- game state ------------------------------------------------------------
-- kind: 0 none, 1 rock (jump it), 2 bird (stay under it), 3 heart (take it)
okind = { 0, 0, 0, 0 }
ox = { 0, 0, 0, 0 }
oy = { 0, 0, 0, 0 }

local HERO_X = 48

local function new_game()
  gx = 0
  speed = 2
  score = 0
  lives = 3
  py = (GROUND_TOP - 16) * 16
  vy = 0
  on_ground = true
  hurt_t = 0
  next_obj = 120
  for i = 1, NOBJ do okind[i] = 0 end
  over = false
end

local function sky(y)
  local t = y - SKY_TOP
  local w = rgb(t * 7 // 151, t * 3 // 151, 4 - t // 76)
  return w
end

local function spawn()
  for i = 1, NOBJ do
    if okind[i] == 0 then
      seed = (seed * 75 + 74) % 65537
      local roll = seed % 10
      if roll < 6 then
        okind[i] = 1
        oy[i] = GROUND_TOP - 16
      elseif roll < 8 then
        okind[i] = 2
        oy[i] = GROUND_TOP - 46
      else
        okind[i] = 3
        oy[i] = GROUND_TOP - 48
      end
      ox[i] = 256
      next_obj = 90 + seed % 120
      return
    end
  end
end

-- ---- the game --------------------------------------------------------------
function init()
  draw_base()
  reg("CR", 0xC0)
  seed = 7
  hi = 0
  build = 0
  ground_x, hill_x, mount_x, cloud_x = 0, 0, 0, 0
  was_i = false
  new_game()
end

function frame(t, f)
  if build < BUILD_STEPS then      -- still drawing (about two seconds)
    draw_step(build)
    build = build + 1
    return
  end

  local jump = pad[1].i and not was_i
  was_i = pad[1].i

  if over then
    if jump then new_game() end
  else
    -- the world moves left; it speeds up every 2000 pixels, up to 4 px a frame
    gx = gx + speed
    speed = 2 + gx // 2000
    if speed > 4 then speed = 4 end
    score = gx // 16

    -- the hero
    if jump and on_ground then
      vy = -80
      sfx(0, 300, 18, 6)
    end
    if not pad[1].i and vy < -24 then vy = -24 end
    vy = vy + 6
    if vy > 96 then vy = 96 end
    py = py + vy
    on_ground = false
    if py // 16 + 16 >= GROUND_TOP then
      py = (GROUND_TOP - 16) * 16
      vy = 0
      on_ground = true
    end
    if hurt_t > 0 then hurt_t = hurt_t - 1 end

    -- rocks, birds and hearts
    next_obj = next_obj - speed
    if next_obj <= 0 then spawn() end
    local hy = py // 16
    for i = 1, NOBJ do
      if okind[i] > 0 then
        ox[i] = ox[i] - speed
        if okind[i] == 2 then ox[i] = ox[i] - 1 end   -- birds fly a little faster
        if ox[i] < -16 then okind[i] = 0 end
      end
      if okind[i] > 0 and dist(ox[i], HERO_X) < 11 and dist(oy[i], hy) < 12 then
        if okind[i] == 3 then
          okind[i] = 0
          if lives < 5 then lives = lives + 1 end
          gx = gx + 1600                               -- a heart is worth 100
          sfx(1, 100, 24, 10)
        elseif hurt_t == 0 then
          lives = lives - 1
          hurt_t = 90
          sfx(3, 1200, 28, 30)
          if lives <= 0 then
            over = true
            if score > hi then hi = score end
          end
        end
      end
    end
  end

  -- the parallax offsets the raster callback writes
  ground_x = gx % 256
  hill_x = (gx // 2) % 256
  mount_x = (gx // 4) % 256
  cloud_x = (gx // 8 + f // 4) % 256

  -- sprites
  local hy = py // 16
  if over or (hurt_t > 0 and (f // 4) % 2 == 0) then
    hide(0)
  elseif on_ground and (gx // 12) % 2 == 1 then
    spr(0, HERO_X, hy, WALK, 0)
  else
    spr(0, HERO_X, hy, HERO, 0)
  end
  for i = 1, NOBJ do
    local k = okind[i]
    if k == 1 then
      spr(i, ox[i], oy[i], ROCK, 1)
    elseif k == 2 then
      if (f // 8) % 2 == 0 then spr(i, ox[i], oy[i], BIRD1, 2) else spr(i, ox[i], oy[i], BIRD2, 2) end
    elseif k == 3 then
      spr(i, ox[i], oy[i] - (f // 16) % 2, HEART, 3)
    else
      hide(i)
    end
  end
  for k = 0, 4 do
    if k < lives then spr(5 + k, 112 + k * 10, 4, MINI, 3) else hide(5 + k) end
  end

  put_number(1, score)
  put_number(26, hi)
end

function raster(line)
  if line == 0 then reg("BXR", 0) end                 -- the score bar holds still
  if line == SKY_TOP then reg("BXR", cloud_x) end
  if line == MOUNT_TOP then reg("BXR", mount_x) end
  if line == HILL_TOP then reg("BXR", hill_x) end
  if line == GROUND_TOP then reg("BXR", ground_x) end
  if line >= SKY_TOP and line < GROUND_TOP then
    if over then pal(0, rgb(3, 0, 1)) else pal(0, sky(line)) end
  end
end
