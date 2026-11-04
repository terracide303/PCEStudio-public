-- main.lua — a small platformer: run, jump, land on platforms.
-- Version 1: one screen, one hero, no enemies yet.
-- Keys: J / L run, N jump (hold it longer to jump higher).
--
-- Written for the console's interpreter as well as the browser: frame() is
-- the whole game and every instruction in it costs a video frame's budget
-- on a HuCard (docs/ROM_SPEED.md).  So the bodies below keep the arithmetic
-- to shifts (the interpreter's division is a soft routine costing about
-- seven instructions' worth), read the pad once per field, and test the
-- landing span instead of calling cell() -- the map drawing still uses
-- cell(), the rule is the same one.

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
  vy = 0
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

  sat(0, 2, 0x100 << 1)        -- the pattern word never changes: set it once
  reg("CR", 0xC0)              -- background + sprites on
  face = 0x80                  -- the SAT attribute word: palette 0, in front
                               -- (0x880 is the same word HFLIPped)
  was_i = false
  on_ground = false
  respawn()
end

function frame(t, f)
  local i = pad[1].i

  -- Run, and clamp where it can leave the screen.  Right wins when both are
  -- held, as before: the first test is the one whose side stays.
  if pad[1].right then
    px = px + 24
    if px > 240 * 16 then px = 240 * 16 end
    face = 0x80
  elseif pad[1].left then
    px = px - 24
    if px < 0 then px = 0 end
    face = 0x880
  end
  local x = px >> 4                                -- px in whole pixels

  if i then
    if not was_i and on_ground then vy = -96 end
  elseif vy < -24 then
    vy = -24                     -- let go early: short hop
  end
  was_i = i

  local feet = (py >> 4) + 16
  vy = vy + 6
  if vy > 96 then vy = 96 end
  py = py + vy

  -- Land only while falling, and only if the feet were above the tile's top:
  -- platforms are one-way, you jump up through them.  cell()'s ground rows
  -- hold every column but the pit's, and its ledges are one unbroken run of
  -- six, so "does the hero's two-to-three-column feet span meet a solid
  -- cell here" is one comparison each side, done here instead of a call the
  -- interpreter would charge more for than the comparisons it saves.
  local y = py >> 4                                -- py in whole pixels
  local landed = false
  if vy >= 0 then
    local row = (y + 16) >> 3
    if feet <= row * 8 then
      local c = (x + 3) >> 3                       -- the span's left column
      if row >= 24 then
        if c <= 11 then
          landed = true
        else
          landed = (x + 12) >> 3 >= 16             -- the span's right column
        end
      elseif row == 19 then
        landed = c <= 8 and ((x + 12) >> 3) >= 3
      elseif row == 15 then
        landed = c <= 17 and ((x + 12) >> 3) >= 12
      elseif row == 11 then
        landed = c <= 26 and ((x + 12) >> 3) >= 21
      end
      if landed then
        py = (row * 8 - 16) * 16
        vy = 0
        y = row * 8 - 16
      end
    end
  end
  on_ground = landed

  if y > 224 then                                -- fell in the pit
    respawn()
    y = py >> 4
    x = px >> 4
  end

  sat(0, 0, y + 64)
  sat(0, 1, x + 32)
  sat(0, 3, face)
end
