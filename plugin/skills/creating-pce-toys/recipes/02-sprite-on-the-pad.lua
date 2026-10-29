-- 02-sprite-on-the-pad.lua — one sprite you steer with the controller.
--
-- A sprite is a SAT entry: 64 entries, 4 words each, at VRAM $7F00. The
-- sprite() helper fills one from a table. Y 64 is display row 0 and X 32 is
-- display column 0, so on-screen position is (x - 32, y - 64).
--
-- The sprite's picture is a 64-word VRAM cell: four 16-word bitplanes at
-- +0, +16, +32 and +48, leftmost pixel in bit 15. Pattern code 0x100 is
-- cell 0x100, VRAM words 0x100*64 = 16384.
--
-- Two things make a sprite invisible if you forget them: CR bit 6 must be on
-- (reg("CR", 0xC0)), and a sprite is drawn BEHIND the background unless
-- spbg = 1 or that background pixel's colour number is 0. Sprite colours
-- live at CRAM 0x100 + palette*16 + colour.

local SHIP = 0x100                 -- pattern code, a 16x16 cell at 16384

-- One 16x16 sprite cell. fn(col, row) returns colour 0..15; pixel 0 is
-- transparent, so it never shows whatever the sprite palette holds there.
local function putsprite(cell, fn)
  for row = 0, 15 do
    local p0, p1, p2, p3 = 0, 0, 0, 0
    for col = 0, 15 do
      local c = fn(col, row)
      if c % 2 >= 1 then p0 = p0 | (1 << (15 - col)) end
      if c >= 2 and (c % 4) >= 2 then p1 = p1 | (1 << (15 - col)) end
      if c >= 4 and (c % 8) >= 4 then p2 = p2 | (1 << (15 - col)) end
      if c >= 8 then p3 = p3 | (1 << (15 - col)) end
    end
    vram[cell * 64 + row] = p0
    vram[cell * 64 + 16 + row] = p1
    vram[cell * 64 + 32 + row] = p2
    vram[cell * 64 + 48 + row] = p3
  end
end

-- One 8x8 background character: space with a few stars.
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

local sx = 144                    -- SAT X; 32 is the left edge of the screen
local sy = 128                    -- SAT Y; 64 is the top edge

function init()
  -- CR bit 7 = background on, bit 6 = sprites on. The power-on value is 0x80,
  -- so a sprite is INVISIBLE until bit 6 is set: 0xC0 turns both layers on.
  reg("CR", 0xC0)

  pal(0, rgb(0, 0, 0))            -- backdrop behind everything
  pal(1, rgb(0, 0, 2))            -- space
  pal(2, rgb(7, 7, 7))            -- a star
  pal(0x101, rgb(4, 7, 7))        -- ship hull   (sprite palette 0, colour 1)
  pal(0x102, rgb(7, 4, 1))        -- cockpit     (sprite palette 0, colour 2)
  pal(0x103, rgb(2, 2, 4))        -- wing shade  (sprite palette 0, colour 3)

  -- Background: one star tile in every cell of the 32x28 BAT.
  puttile(0x40, function(col, row)
    if (col * 7 + row * 3) % 23 == 0 then return 2 end
    return 1
  end)
  for row = 0, 27 do
    for col = 0, 31 do
      vram[row * 32 + col] = 0x40
    end
  end

  -- The ship: a triangle hull with a cockpit, in sprite palette 1.
  putsprite(SHIP, function(col, row)
    local d = col - 8
    if d < 0 then d = -d end
    if row >= 2 and d <= row - 1 then
      if row >= 5 and row <= 8 and d <= 1 then return 2 end
      if row >= 11 then return 3 end
      return 1
    end
    return 0
  end)
end

function frame(t, f)
  if pad[1].left then sx = sx - 2 end
  if pad[1].right then sx = sx + 2 end
  if pad[1].up then sy = sy - 2 end
  if pad[1].down then sy = sy + 2 end
  -- Keep the 16x16 sprite on the 256x224 picture: X 32..272, Y 64..272.
  if sx < 32 then sx = 32 end
  if sx > 272 then sx = 272 end
  if sy < 64 then sy = 64 end
  if sy > 272 then sy = 272 end

  sprite(0, { x = sx, y = sy, pattern = SHIP, palette = 0, spbg = 1 })
end
