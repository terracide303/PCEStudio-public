-- main.lua — NOVA TIDE: a side-scrolling shoot-'em-up. Original game, original art.
-- Keys: I/J/K/L fly, N fires (hold it), P (Run) starts again after a game over.
-- Grab the P capsules to power up: one bolt, then two, then a three-way spread.
-- Waves of drones and gunships, then the armoured fish at the end of every stage.
--
-- THE ART IS NOT IN THIS FILE.  It comes from the toy's asset files:
--   tiles.json / palettes.json  the looping night-sea picture (source "sea"),
--   sprites.json                the sprite sheet (source "ships"): 16 patterns of 16x16.
-- This file only knows each pattern's number.  The importer packs the patterns
-- right after the picture's tiles, so pattern n sits at VRAM cell PAT + n.
--
-- THE TRICK: the PC Engine has one background layer, so the depth comes from
-- scrolling bands of lines at different speeds (raster): the HUD bar stands
-- still, then sky, hills, city and sea each move faster than the one above.
-- Browser toy: it uses tables, which the console export cannot carry yet.

local PAT = 51          -- the first sprite pattern's VRAM cell (after 140 background tiles)
local GB = 0x120        -- the first HUD glyph character (top halves; bottom halves at GB + 32)

-- pattern numbers in the sheet
local P_SHIP, P_BOLT, P_DRONE, P_GUN, P_ORB, P_CAP = 0, 2, 3, 5, 6, 7
local P_BOOM, P_BOSS = 8, 11

local PB_N, EB_N, EN_N, EX_N = 8, 10, 8, 6

-- ---- small helpers ---------------------------------------------------------

local function iabs(v)
  if v < 0 then return -v end
  return v
end

local function tri(n)               -- a triangle wave, -16..16, period 64
  local m = n % 64
  if m < 32 then return m - 16 end
  return 48 - m
end

local function rnd(n)
  seed = (seed * 13 + 7) % 509
  return seed % n
end

local function hit(ax, ay, aw, ah, bx, by, bw, bh)
  local c = ax < bx + bw and ax + aw > bx and ay < by + bh and ay + ah > by
  return c
end

-- one 8x8 background character: fn(col, row) -> colour 0..15 (0 = the backdrop)
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

-- ---- the HUD's letters: 3x5 glyphs, drawn twice as big across two characters ----

local function glyph_bits(g)
  local b = 0
  if g == 0 then b = 0x7B6F elseif g == 1 then b = 0x2C97 elseif g == 2 then b = 0x73E7
  elseif g == 3 then b = 0x73CF elseif g == 4 then b = 0x5BC9 elseif g == 5 then b = 0x79CF
  elseif g == 6 then b = 0x79EF elseif g == 7 then b = 0x7249 elseif g == 8 then b = 0x7BEF
  elseif g == 9 then b = 0x7BCF elseif g == 10 then b = 0x79CF      -- S
  elseif g == 11 then b = 0x7927                                     -- C
  elseif g == 12 then b = 0x7B6F                                     -- O
  elseif g == 13 then b = 0x6BAD                                     -- R
  elseif g == 14 then b = 0x79E7                                     -- E
  elseif g == 15 then b = 0x796F                                     -- G
  elseif g == 16 then b = 0x2BED                                     -- A
  elseif g == 17 then b = 0x5FED                                     -- M
  elseif g == 18 then b = 0x5B6A                                     -- V
  elseif g == 19 then b = 0x7492 end                                 -- T
  return b
end

local function glyph_px(col, y)          -- y 0..15 inside the two-character cell
  if col < 1 or col > 6 or y < 3 or y > 12 then return 0 end
  local gx, gy = (col - 1) // 2, (y - 3) // 2
  if ((gcur >> (14 - (gy * 3 + gx))) & 1) == 1 then return 15 end
  return 0
end
local function glyph_top(col, row)
  local c = glyph_px(col, row)
  return c
end
local function glyph_bot(col, row)
  local c = glyph_px(col, row + 8)
  return c
end
local function bar_full(col, row)
  if row >= 2 and row <= 5 and col <= 6 then return 12 end
  return 0
end
local function bar_empty(col, row)
  if row >= 2 and row <= 5 and col <= 6 then return 14 end
  return 0
end

local function putglyph(col, g)              -- g: 0..9 digits, 10.. letters, 20 blank
  vram[col] = GB + g
  vram[32 + col] = GB + 32 + g
end

local function putnumber(col, n, digits)
  for k = digits - 1, 0, -1 do
    putglyph(col + k, n % 10)
    n = n // 10
  end
end

-- ---- sprites -----------------------------------------------------------------

local function spr(slot, x, y, pat)          -- x, y: the sprite's top-left on the screen
  if y <= -16 or y >= 224 or x <= -16 or x >= 256 then
    sat(slot, 0, 0)                           -- a sprite at SAT Y 0 is off the top of the screen
    return
  end
  sat(slot, 0, y + 64)
  sat(slot, 1, x + 32)
  sat(slot, 2, (PAT + pat) << 1)
  sat(slot, 3, 0x80)
end

local function hide(slot) sat(slot, 0, 0) end

-- ---- the game's pieces --------------------------------------------------------

local function sound_shot() sfx(0, note(88), 8, 3) end
local function sound_boom() sfx(1, note(38), 14, 12) end
local function sound_cap() sfx(2, note(96), 12, 8) end

local function boom(x, y)                     -- an explosion centred on x, y
  for i = 1, EX_N do
    if exon[i] == 0 then
      exon[i] = 1; exx[i] = x - 8; exy[i] = y - 8; ext[i] = 0
      return
    end
  end
end

local function pshot(x, y, vy)
  for i = 1, PB_N do
    if pbon[i] == 0 then
      pbon[i] = 1; pbx[i] = x; pby[i] = y; pbvy[i] = vy
      return
    end
  end
end

local function fire()
  pshot(px + 14, py, 0)
  if plevel == 2 then
    pshot(px + 14, py - 5, 0)
    pshot(px + 14, py + 5, 0)
  elseif plevel >= 3 then
    pshot(px + 14, py - 2, -2)
    pshot(px + 14, py + 2, 2)
    pshot(px + 12, py, 0)
  end
  sound_shot()
end

local function ebullet(x, y, vx, vy)          -- x, y: the orb's centre; vx, vy: 1/8 pixel per frame
  for i = 1, EB_N do
    if ebon[i] == 0 then
      ebon[i] = 1; ebx[i] = x * 8; eby[i] = y * 8; ebvx[i] = vx; ebvy[i] = vy
      return
    end
  end
end

local function aim(sx, sy, spd)               -- sets avx, avy: a shot from sx, sy at the ship
  local dx, dy = px + 8 - sx, py + 8 - sy
  local ax, ay = iabs(dx), iabs(dy)
  local d = ax + ay // 2
  if ay > ax then d = ay + ax // 2 end
  if d < 1 then d = 1 end
  avx = dx * spd // d
  avy = dy * spd // d
end

local function spawn(kind, x, y, drop, ph)
  for i = 1, EN_N do
    if enon[i] == 0 then
      enon[i] = 1; entype[i] = kind; enx[i] = x; eny[i] = y; eny0[i] = y
      enph[i] = ph; endrop[i] = drop
      if kind == 1 then enhp[i] = 1 else enhp[i] = 3 + stage end
      return
    end
  end
end

local function hud_all()
  for col = 0, 31 do putglyph(col, 20) end
  putglyph(1, 10); putglyph(2, 11); putglyph(3, 12); putglyph(4, 13); putglyph(5, 14)
  putnumber(7, score, 6)
  putglyph(14, 10); putglyph(15, 19); putnumber(17, stage % 10, 1)
  hscore = score
end

local function new_game()
  score = 0; lives = 3; stage = 1; plevel = 1; pinv = 60
  px = 24; py = 104; pfire = 0
  state = 0; overt = 0
  stage_t = 0; boss = 0; bhp = 0; bhpmax = 1
  for i = 1, PB_N do pbon[i] = 0 end
  for i = 1, EB_N do ebon[i] = 0 end
  for i = 1, EN_N do enon[i] = 0 end
  for i = 1, EX_N do exon[i] = 0 end
  caon = 0
  hud_all()
end

local function hurt()
  if pinv > 0 or state ~= 0 then return end
  lives = lives - 1
  boom(px + 8, py + 8)
  sound_boom()
  if plevel > 1 then plevel = plevel - 1 end
  if lives <= 0 then
    state = 1; overt = 0
    for col = 14, 22 do putglyph(col, 20) end
    putglyph(14, 15); putglyph(15, 16); putglyph(16, 17); putglyph(17, 14)
    putglyph(19, 12); putglyph(20, 18); putglyph(21, 14); putglyph(22, 13)
  else
    pinv = 120
  end
end

-- ---- the stage script -----------------------------------------------------------

local function script()
  if boss == 0 and stage_t < 2700 then
    if stage_t % 100 == 20 then
      local wave = stage_t // 100
      local y0 = 50 + (wave % 5) * 26
      for k = 0, 4 do
        local drop = 0
        if k == 2 and wave % 3 == 2 then drop = 1 end
        spawn(1, 256 + k * 18, y0, drop, k * 8)
      end
    end
    if stage_t % 330 == 200 then
      spawn(2, 256, 60 + ((stage_t // 330) % 3) * 50, 0, 0)
    end
  end
  if stage_t == 2700 and boss == 0 then
    boss = 1; bx = 256; by = 80; bdir = 1; bhpmax = 30 + 10 * stage; bhp = bhpmax; bt = 0
  end
end

-- ---- one frame of play ------------------------------------------------------------

local function play()
  -- the ship
  if pad[1].left then px = px - 2 end
  if pad[1].right then px = px + 2 end
  if pad[1].up then py = py - 2 end
  if pad[1].down then py = py + 2 end
  if px < 4 then px = 4 end
  if px > 236 then px = 236 end
  if py < 18 then py = 18 end
  if py > 206 then py = 206 end
  if pfire > 0 then pfire = pfire - 1 end
  if pad[1].i and pfire == 0 then fire(); pfire = 7 end
  if pinv > 0 then pinv = pinv - 1 end

  stage_t = stage_t + 1
  script()

  -- the ship's bolts
  for i = 1, PB_N do
    if pbon[i] == 1 then
      pbx[i] = pbx[i] + 6
      pby[i] = pby[i] + pbvy[i]
      if pbx[i] > 256 or pby[i] < 4 or pby[i] > 216 then pbon[i] = 0 end
    end
  end

  -- the enemies
  for i = 1, EN_N do
    if enon[i] == 1 then
      enph[i] = enph[i] + 1
      if entype[i] == 1 then
        enx[i] = enx[i] - 2 - stage // 3
        eny[i] = eny0[i] + tri(enph[i]) * 2
        if stage >= 2 and enph[i] % 120 == 60 and enx[i] < 230 then
          aim(enx[i] + 8, eny[i] + 8, 12)
          ebullet(enx[i] + 8, eny[i] + 8, avx, avy)
        end
        if enx[i] < -16 then enon[i] = 0 end
      else
        if enx[i] > 190 then
          enx[i] = enx[i] - 2
        else
          eny[i] = eny[i] + tri(enph[i]) // 8
          if enph[i] % 70 == 35 then
            aim(enx[i] + 2, eny[i] + 8, 14 + stage)
            ebullet(enx[i] + 2, eny[i] + 8, avx, avy)
          end
          if enph[i] > 500 then enx[i] = enx[i] - 2 end
        end
        if enx[i] < -16 then enon[i] = 0 end
      end

      -- hit by a bolt?
      for j = 1, PB_N do
        if enon[i] == 1 and pbon[j] == 1 and hit(pbx[j] + 2, pby[j] + 6, 14, 4, enx[i] + 1, eny[i] + 2, 14, 12) then
          pbon[j] = 0
          enhp[i] = enhp[i] - 1
          if enhp[i] <= 0 then
            enon[i] = 0
            boom(enx[i] + 8, eny[i] + 8)
            sound_boom()
            if entype[i] == 1 then score = score + 100 else score = score + 300 end
            if endrop[i] == 1 then caon = 1; cax = enx[i]; cay = eny[i] end
          end
        end
      end
      -- ramming the ship?
      if enon[i] == 1 and pinv == 0 and hit(px + 3, py + 5, 11, 6, enx[i] + 2, eny[i] + 3, 12, 10) then
        hurt()
      end
    end
  end

  -- the capsule
  if caon == 1 then
    cax = cax - 1
    if cax < -16 then caon = 0 end
    if hit(px + 2, py + 3, 12, 10, cax + 2, cay + 4, 12, 8) then
      caon = 0
      sound_cap()
      if plevel < 3 then plevel = plevel + 1; score = score + 500 else score = score + 1000 end
    end
  end

  -- the boss: an armoured fish
  if boss == 1 then                         -- swimming in
    bx = bx - 2
    if bx <= 176 then boss = 2 end
  elseif boss == 2 then
    bt = bt + 1
    by = by + bdir
    if by > 150 then bdir = -1 end
    if by < 36 then bdir = 1 end
    if bt % 55 == 30 then
      aim(bx + 2, by + 16, 18)
      ebullet(bx + 2, by + 16, avx, avy)
      ebullet(bx + 2, by + 16, avx, avy - 7)
      ebullet(bx + 2, by + 16, avx, avy + 7)
    end
    if bt % 160 == 100 then
      for k = 0, 5 do
        local vy = (k - 3) * 6 + 3
        ebullet(bx + 14, by + 16, -14, vy)
      end
    end
    for j = 1, PB_N do
      if pbon[j] == 1 and hit(pbx[j] + 2, pby[j] + 6, 14, 4, bx + 2, by + 4, 28, 24) then
        pbon[j] = 0
        bhp = bhp - 1
        score = score + 50
        if bhp <= 0 then boss = 3; bt = 0; sound_boom() end
      end
    end
    if pinv == 0 and hit(px + 3, py + 5, 11, 6, bx + 3, by + 5, 26, 22) then hurt() end
  elseif boss == 3 then                     -- going down in flames
    bt = bt + 1
    if bt % 6 == 0 then
      boom(bx + 4 + rnd(24), by + 4 + rnd(24))
      sfx(1, note(30 + rnd(8)), 12, 8)
    end
    if bt >= 90 then
      boss = 0; stage = stage + 1; stage_t = 0; score = score + 5000
      for i = 1, EB_N do ebon[i] = 0 end
      boom(bx + 16, by + 16)
    end
  end

  -- the enemies' orbs
  for i = 1, EB_N do
    if ebon[i] == 1 then
      ebx[i] = ebx[i] + ebvx[i]
      eby[i] = eby[i] + ebvy[i]
      local x, y = ebx[i] // 8, eby[i] // 8
      if x < -8 or x > 264 or y < 8 or y > 232 then ebon[i] = 0 end
      if pinv == 0 and hit(x - 2, y - 2, 4, 4, px + 3, py + 5, 11, 6) then
        ebon[i] = 0
        hurt()
      end
    end
  end
end

-- ---- the picture -------------------------------------------------------------------------

local function draw()
  -- the ship (blinks while it cannot be hurt)
  if state == 0 and (pinv == 0 or (pinv // 3) % 2 == 0) then
    spr(0, px, py, P_SHIP + (gt // 4) % 2)
  else
    hide(0)
  end

  for i = 1, PB_N do
    if pbon[i] == 1 then spr(0 + i, pbx[i], pby[i], P_BOLT) else hide(0 + i) end
  end
  for i = 1, EB_N do
    if ebon[i] == 1 then spr(8 + i, ebx[i] // 8 - 8, eby[i] // 8 - 8, P_ORB) else hide(8 + i) end
  end
  for i = 1, EN_N do
    if enon[i] == 1 then
      if entype[i] == 1 then
        spr(18 + i, enx[i], eny[i], P_DRONE + (enph[i] // 6) % 2)
      else
        spr(18 + i, enx[i], eny[i], P_GUN)
      end
    else
      hide(18 + i)
    end
  end
  for i = 1, EX_N do
    if exon[i] == 1 then
      local step = ext[i] // 4
      if step > 2 then
        exon[i] = 0
        hide(26 + i)
      else
        spr(26 + i, exx[i], exy[i], P_BOOM + step)
        ext[i] = ext[i] + 1
      end
    else
      hide(26 + i)
    end
  end
  if caon == 1 then spr(33, cax, cay, P_CAP) else hide(33) end

  if boss > 0 and (boss ~= 3 or bt % 4 < 2) then
    spr(34, bx, by, P_BOSS)
    spr(35, bx + 16, by, P_BOSS + 1)
    spr(36, bx, by + 16, P_BOSS + 2)
    spr(37, bx + 16, by + 16, P_BOSS + 3)
  else
    hide(34); hide(35); hide(36); hide(37)
  end

  for i = 1, 3 do
    if state == 0 and lives >= i then spr(37 + i, 256 - 20 * i, 0, P_SHIP) else hide(37 + i) end
  end

  -- the HUD, only when it changes
  if score ~= hscore and state == 0 then
    putnumber(7, score, 6); hscore = score
  end
  if state == 0 then
    if boss == 2 then
      for k = 0, 5 do
        if bhp * 6 > k * bhpmax then vram[32 + 19 + k] = GB + 21 else vram[32 + 19 + k] = GB + 22 end
      end
    elseif boss ~= 3 then
      for k = 0, 5 do vram[32 + 19 + k] = GB + 32 + 20 end
    end
    if stage ~= hstage then putnumber(17, stage % 10, 1); hstage = stage end
  end
end

-- ---- the console's entry points ------------------------------------------------------------

function init()
  pal(15, rgb(7, 7, 7))        -- the HUD letters (background palette 0, colour 15)
  pal(12, rgb(7, 1, 1))        -- the boss bar, full
  pal(14, rgb(2, 0, 1))        -- the boss bar, empty
  seed = 11; gt = 0; sc = 0; hscore = -1; hstage = -1; boss = 0; bt = 0
  px = 24; py = 104
  pbx, pby, pbvy, pbon = {}, {}, {}, {}
  ebx, eby, ebvx, ebvy, ebon = {}, {}, {}, {}, {}
  enx, eny, eny0, enph, enhp, entype, endrop, enon = {}, {}, {}, {}, {}, {}, {}, {}
  exx, exy, ext, exon = {}, {}, {}, {}
  for i = 1, PB_N do pbx[i] = 0; pby[i] = 0; pbvy[i] = 0; pbon[i] = 0 end
  for i = 1, EB_N do ebx[i] = 0; eby[i] = 0; ebvx[i] = 0; ebvy[i] = 0; ebon[i] = 0 end
  for i = 1, EN_N do
    enx[i] = 0; eny[i] = 0; eny0[i] = 0; enph[i] = 0; enhp[i] = 0; entype[i] = 1; endrop[i] = 0; enon[i] = 0
  end
  for i = 1, EX_N do exx[i] = 0; exy[i] = 0; ext[i] = 0; exon[i] = 0 end
  caon = 0; cax = 0; cay = 0

  -- the HUD glyphs: letters and digits as characters, plus the boss's life bar
  for g = 0, 19 do
    gcur = glyph_bits(g)
    puttile(GB + g, glyph_top)
    puttile(GB + 32 + g, glyph_bot)
  end
  puttile(GB + 20, function(c, r) return 0 end)       -- blank, top
  puttile(GB + 32 + 20, function(c, r) return 0 end)  -- blank, bottom
  puttile(GB + 21, bar_full)
  puttile(GB + 22, bar_empty)
  BASS = {45, 45, 48, 45, 52, 45, 48, 43}

  reg("CR", 0xC0)
  new_game()
end

function frame(t, f)
  gt = gt + 1
  sc = sc + 1
  if state == 0 then
    play()
  else
    overt = overt + 1
    if overt > 90 and (pad[1].run or pad[1].i) then new_game() end
  end
  draw()

  -- the bass line
  if gt % 15 == 0 and state == 0 then
    sfx(3, note(BASS[(gt // 15) % 8 + 1]), 7, 12)
  end

  reg("BYR", 0)
  raster(0, { bxr = 0 })                   -- the HUD bar stands still
  raster(16, { bxr = (sc // 4) % 256 })    -- sky
  raster(64, { bxr = (sc // 2) % 256 })    -- hills
  raster(128, { bxr = sc % 256 })          -- city
  raster(176, { bxr = (sc * 2) % 256 })    -- sea
end
