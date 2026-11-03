-- padtest/main.lua — a pad witness a person can see and a ROM can prove.
--
-- Two pads, eight buttons each, drawn as labeled cells.  A held button
-- lights its cell: yellow for pad 1, green for pad 2.  Press the d-pad,
-- I, II, Select and Run on a controller (the studio's CONTROLS drawer
-- shows the mapping), on the keyboard (IJKL / N M / O P), or on an
-- exported ROM in an emulator or on a console — the picture is the whole
-- point.
--
-- The layout, in BAT cells (8x8 px; the BAT is 32 wide, 28 tall):
--   band 1 (pad 1)  label rows 3 and 9,  box rows 4-6 and 10-12
--   band 2 (pad 2)  label rows 16 and 22, box rows 17-19 and 23-25
--   the top row of each band is the d-pad (UP DN LF RT), the bottom row
--   the buttons (I II SEL RUN); a cell's x is 4 + (cell % 4) * 7.  The
--   band's digit (1 / 2) sits left of its first box row.
--
-- VRAM carries what a scripted run reads back:
--   vram[0x3F00]  the toy's frame number
--   vram[0x3F01]  pad 1's buttons ever held: bits 0..7 = up down left
--                 right i ii select run
--   vram[0x3F02]  pad 2's buttons ever held, the same bits
--
-- The same file runs in the browser host (the Gamepad API and the keyboard
-- merge into pad 1, a second controller is pad 2), in the IL, and in the
-- exported ROM, where the console runtime's joy_scan() fills pad[1]/pad[2]
-- from the hardware ports (docs/PADS.md).  No tables, no strings: the IL
-- subset, so the studio's Export builds it.

-- 3x5 glyphs packed into 15 bits, bit 14 = row 0 col 0 (the same packing
-- dusk-run's score font uses; its I = 29847 and S = 31183 agree as a check).
local GLY_U = 23407
local GLY_P = 31716
local GLY_D = 27502
local GLY_N = 24557
local GLY_L = 18727
local GLY_F = 31204
local GLY_R = 27565
local GLY_T = 29842
local GLY_I = 29847
local GLY_S = 31183
local GLY_E = 31143
local GLY_1 = 11415
local GLY_2 = 29671

-- the tiles: 0x40 the empty backdrop tile (its words stay zero), 0x41 the
-- solid box, 0x50 + cell*3 .. the labels' letter tiles

-- one glyph into tile `char`, colour 1 on colour 0, rows 2..6
local function put_letter(char, bits)
  for row = 0, 4 do
    local w = 0
    for col = 0, 2 do
      if (bits >> (14 - (row * 3 + col))) & 1 == 1 then
        w = w | (1 << (7 - col))
      end
    end
    vram[char * 16 + row + 2] = w
    vram[char * 16 + 8 + row + 2] = 0
  end
end

local function put_solid(char)
  -- colour 1, like the glyphs: only plane 0's low-byte bit per pixel
  for row = 0, 7 do
    vram[char * 16 + row] = 0x00FF
    vram[char * 16 + 8 + row] = 0
  end
end

local function bat(x, y, char, pal)
  vram[y * 32 + x] = char | (pal << 12)
end

-- one cell's label, drawn once into its own three letter tiles (g3 = 0 for
-- a two-letter label) and placed on both bands' label rows
local function cell_label(cell, g1, g2, g3)
  local a = 0x50 + cell * 3
  put_letter(a, g1)
  put_letter(a + 1, g2)
  put_letter(a + 2, g3)
  for band = 1, 2 do
    local y0 = 3
    if band == 2 then y0 = 16 end
    local x = 4 + (cell % 4) * 7
    local y = y0 + (cell // 4) * 6
    bat(x, y, a, 3)
    bat(x + 1, y, a + 1, 3)
    bat(x + 2, y, a + 2, 3)
  end
end

-- the eight cells of one band: each cell's 3x3 box chars, palette 1 when
-- the button is up, the band's lit colour when its mask bit is set
local function paint_band(band, mask)
  local y0 = 3
  local litpal = 2
  if band == 2 then y0 = 16 end
  if band == 2 then litpal = 4 end
  for cell = 0, 7 do
    local pal = 1
    if (mask >> cell) & 1 == 1 then pal = litpal end
    local x = 4 + (cell % 4) * 7
    local y = y0 + (cell // 4) * 6 + 1
    for row = 0, 2 do
      for col = 0, 2 do
        bat(x + col, y + row, 0x41, pal)
      end
    end
  end
end

function init()
  -- pal() takes the flat CRAM word address: a BAT palette nibble p shows
  -- CRAM words p*16 + colour.  The boxes are all colour 1 (plane 0 set,
  -- plane 1 clear), the labels' glyph pixels colour 1 too; the labels'
  -- gaps and the empty backdrop tile are colour 0.
  pal(0, rgb(0, 0, 1))          -- the backdrop
  pal(17, rgb(2, 2, 2))         -- palette 1, colour 1: an unlit box
  pal(33, rgb(7, 7, 2))         -- palette 2, colour 1: pad 1 held (yellow)
  pal(48, rgb(0, 0, 1))         -- palette 3, colour 0: the labels' gaps
  pal(49, rgb(6, 6, 7))         -- palette 3, colour 1: the labels' glyphs
  pal(65, rgb(2, 7, 2))         -- palette 4, colour 1: pad 2 held (green)
  reg("CR", 128)                -- the background layer on

  -- the backdrop first, then the labels and both bands at rest, then the
  -- band digits (the fill would wipe anything drawn before it)
  for y = 0, 27 do
    for x = 0, 31 do bat(x, y, 0x40, 0) end
  end
  put_solid(0x41)
  cell_label(0, GLY_U, GLY_P, 0)    -- UP
  cell_label(1, GLY_D, GLY_N, 0)    -- DN
  cell_label(2, GLY_L, GLY_F, 0)    -- LF
  cell_label(3, GLY_R, GLY_T, 0)    -- RT
  cell_label(4, GLY_I, 0, 0)        -- I
  cell_label(5, GLY_I, GLY_I, 0)    -- II
  cell_label(6, GLY_S, GLY_E, GLY_L) -- SEL
  cell_label(7, GLY_R, GLY_U, GLY_N) -- RUN
  paint_band(1, 0)
  paint_band(2, 0)
  bat(2, 4, 0x5B, 3)
  bat(2, 17, 0x5C, 3)

  prev1 = 0
  prev2 = 0
  ever1 = 0
  ever2 = 0
end

-- pad 1's held buttons as the mask word (bit 0 up, 1 down, 2 left, 3 right,
-- 4 i, 5 ii, 6 select, 7 run) — written twice, once per pad, because the
-- IL reads pad[n] with a constant
local function mask1()
  local m = 0
  if pad[1].up then m = m + 1 end
  if pad[1].down then m = m + 2 end
  if pad[1].left then m = m + 4 end
  if pad[1].right then m = m + 8 end
  if pad[1].i then m = m + 16 end
  if pad[1].ii then m = m + 32 end
  if pad[1].select then m = m + 64 end
  if pad[1].run then m = m + 128 end
  return m
end

local function mask2()
  local m = 0
  if pad[2].up then m = m + 1 end
  if pad[2].down then m = m + 2 end
  if pad[2].left then m = m + 4 end
  if pad[2].right then m = m + 8 end
  if pad[2].i then m = m + 16 end
  if pad[2].ii then m = m + 32 end
  if pad[2].select then m = m + 64 end
  if pad[2].run then m = m + 128 end
  return m
end

function frame(t, f)
  local m1 = mask1()
  local m2 = mask2()
  -- repaint only what changed, so a held button costs nine BAT words
  if m1 ~= prev1 then paint_band(1, m1) end
  if m2 ~= prev2 then paint_band(2, m2) end
  prev1 = m1
  prev2 = m2
  ever1 = ever1 | m1
  ever2 = ever2 | m2
  vram[0x3F00] = f
  vram[0x3F01] = ever1
  vram[0x3F02] = ever2
end
