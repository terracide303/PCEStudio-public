-- main.lua — DUSK RUN, BAKED: the gallery game (toys/dusk-run) with its art generation removed.
-- The gallery game draws 512 background tiles and 7 sprite patterns from pixel rules during its first
-- 137 frames, which costs two minutes on the console.  Here the same picture comes from vram.json,
-- baked by `node tools/bake-art.js toys/dusk-run/main.lua 137 tests/native-dusk-baked`, and frame(t, f)
-- continues the gallery game's own frame numbering (f + 137), so every later frame is the same picture.
-- Everything else is the gallery game's code, unchanged.  See docs/NATIVE.md, "Baking a toy's generated art".

-- main.lua — DUSK RUN: an endless runner over five layers of line-scroll parallax.
-- Keys: N jump (hold it longer to jump higher). Jump the rocks, stay under the
-- birds, grab hearts for a life. After a game over, press N to run again.
--
-- THE TRICK: raster(line) writes BXR at four band edges, so each band of the
-- picture scrolls at its own speed — clouds 1/8, mountains 1/4, hills 1/2,
-- ground 1/1 — and line 0 holds the score bar still. The same callback writes
-- the backdrop colour on every sky line, so the sunset is a palette gradient.

-- A background character: 16 VRAM words, leftmost pixel in bit 7.

-- A 16x16 sprite pattern: 64 VRAM words, four planes, leftmost pixel in bit 15.

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

-- ---- the landscape, as pixel rules -----------------------------------------
-- Every period divides 256, the map's width, so each band wraps seamlessly.



-- The colour number of map pixel (x, y) in the three generated bands.


-- ---- the score bar's font: 3x5 digits packed into 15 bits -------------------


local function put_number(col, n)
  for i = 4, 0, -1 do
    vram[32 + col + i] = (0x50 + n % 10) | (1 << 12)
    n = n // 10
  end
end

-- ---- pictures --------------------------------------------------------------



-- Clouds (rows 3..7), mountains (10..15) and hills (16..20): one character per
-- cell, drawn from the pixel rules above. That is 512 characters, far too many
-- for one frame of the browser's Lua budget, so frame() draws four a frame.

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

  -- (the map and the tiles come with the baked art, vram.json)
end

-- Everything else is drawn a small piece per frame: steps 0..8 the sprites,
-- the font and the ground, steps 9..136 the landscape (BUILD_STEPS in all).
local BUILD_STEPS = 137


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
  ground_x, hill_x, mount_x, cloud_x = 0, 0, 0, 0
  was_i = false
  new_game()
end

function frame(t, f0)
  local f = f0 + BUILD_STEPS       -- the gallery game's frame number: its first 137 frames only draw

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
