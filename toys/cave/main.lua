-- toys/cave/main.lua — CAVE, a demo built from the "Retro Pixel Cave" pack
-- (card #127).
--
-- WHAT THIS IS: one background — a cave corridor — scrolling under the pad,
-- in five bands that each get their own BXR from the RCR line interrupt, so
-- the ceiling (with its stalactites), the crystal band, the near wall, the
-- mid floor and the near floor move at five speeds.  The pack's warm colours
-- are cycled once a frame, so the rock's lit veins breathe.  Three creatures
-- — two bats and an ember — fly over it.
--
-- THE ART IS NOT IN THIS FILE, AND NOT IN THE REPO (docs/DECISIONS.md,
-- 2026-10-29, Dennis: "About the artwork don't put it on the repo but it's
-- fine as demo on the website").  The art is the studio's own files (card
-- #156): demo-art/cave/ holds tiles.json, palettes.json, sprites.json and
-- sources.json, which the #117 importer loads before init(); the playable
-- file is demo-art/cave/main.lua — this file plus a generated tail that
-- replaces the constants below with the importer's placement numbers
-- (tools/cave-assets.js writes it, the way tools/oak-woods-art.js writes
-- OAK WOODS's).  tools/gallery.js --with-demo-art reads that file with the
-- JSON files and tools/deploy.sh uploads them as the gallery's CAVE
-- sources, so the site plays the picture with no fetch and no second
-- runtime.  The console route (route 1) keeps the pokes: the tool also
-- writes cave-console.lua — this file with the pad and sat() lines cut,
-- plus art.lua appended, the same picture as VRAM/CRAM pokes.  A clone
-- runs THIS file: the stubs below paint a plain rock backdrop, so a fresh
-- clone is never a black screen and the test that needs the real art skips.
--
-- credits: "Retro Pixel Cave" tileset by Will Tice, unTied Games
--   (untiedgames.itch.io).  Its licence, license.txt in the pack:
--     "1. You may not publicly distribute the contents of this zip file in
--      whole or in part, unless as part of a game or application product.
--      2. If you use this material in a game or other product, please give
--      attribution to Will Tice in the credits."
--   This demo is part of PCEStudio, an application product, and the credit
--   stands here, on the toy's page, and in its Browse card.
--
-- CONTROLS: pad 1's left/right scroll the cave (it also drifts right on its
-- own, so the demo plays unattended).  IJKL / N M / O P on the toy page.
--
-- WHAT THE CONSOLE WOULD NEED: nothing in this file but the pad read.  The
-- Export path (route 1: IL bytecode + renderer/ilvm.bin) cannot read the pad
-- (card #134), so tools/cave-assets.js writes the console build of this toy
-- with that one block replaced — see its --console output.

-- ---- the art, when it is not beside this file --------------------------
-- Every one of these is replaced by demo-art/cave/art.lua, which is appended
-- after this file and so defines them last.  Kept tiny on purpose: a stub is
-- dead code in every real run.

GLOW_PAL = 0
GLOW_ENTRY = 15      -- the stub's own warm entry, which it does not paint
GLOW_BASE = 0x1BB    -- rgb(7, 6, 3)
GLOW_HOT = 0x1FC     -- rgb(7, 7, 4)
GLOW_COLD = 0x12A    -- rgb(5, 4, 2)
PATTERN_CELL = 17    -- the sprite pattern codes start here (art.lua sets it;
                     -- cell 17 is the first one past this file's stub tile)

function art_boot()
  -- a dark rock wall and its lit edge, in the pack's own blacks and purples
  pal(0, rgb(0, 0, 0))
  pal(1, rgb(1, 1, 2))
  pal(2, rgb(3, 2, 5))
  pal(3, rgb(6, 4, 7))
  pal(15, rgb(7, 6, 3))     -- the entry the glow cycle breathes on
end

function art_board()
  -- one tile at $40: a dark rock body with two lit rows on top (a VDC
  -- character is 16 words, planes 0-1 in rows 0-7, planes 2-3 in 8-15;
  -- colour 1 is plane 0 only, 2 is plane 1, 3 is both)
  local c = 0x40
  for row = 0, 7 do
    vram[c * 16 + row] = 0x00FF
    vram[c * 16 + 8 + row] = 0x0000
  end
  vram[c * 16] = 0xFFFF
  vram[c * 16 + 1] = 0xFF00
end

function art_map()
  for row = 0, 27 do
    for col = 0, 31 do vram[row * 32 + col] = 0x0040 end
  end
end

function art_patterns()
  -- one 16x16 pattern (code 16) that is a filled square, so the bats'
  -- stand-in is visible
  for w = 0, 15 do vram[PATTERN_CELL * 64 + w] = 0xFFFF end
end

-- ---- state --------------------------------------------------------------
-- Integers only, and every one of them bounded: the IL's typer wants ints
-- and the console build's arrays want honest ranges.

tick = 0          -- frames since power-on, 0..4095
sx = 0            -- the cave's horizontal scroll, 0..1023
b1p = 17          -- bat 1's pattern code (PATTERN_CELL + wing frame)
b2p = 16
px1 = 0           -- the three creatures' screen positions
py1 = 0
px2 = 0
py2 = 0
ex0 = 0
ey0 = 0
ex1 = 0
ey1 = 0
ex2 = 0
ey2 = 0

function init()
  art_boot()
  art_board()
  art_map()
  art_patterns()
  -- CR: back-ground on (bit 7) and sprites on (bit 6) — the host powers on
  -- with sprites off (card #120), so without this the bats never appear
  reg("CR", 192)
  reg("BYR", 0)
end

-- One SAT entry: Y, X, pattern code, palette and SPBG.  SPBG (word 3 bit 7)
-- is what puts the creature in FRONT of the cave: without it a sprite only
-- replaces background pixels whose colour number is 0, and this cave's rock
-- is opaque everywhere (renderer/pce-sprites.js, its module comment).
--
-- Two writers on purpose.  The vram[] words are the console's: a real VDC
-- DMAs the SAT from VRAM $7F00 every VBlank, and that is the form the Export
-- path can carry (route 1 has no sat(), card #133).  The browser's model
-- keeps the SAT beside VRAM, so the same four values go through sat() as
-- well — and the console build, which drops the sat() lines, is driven by
-- the vram[] words alone.
function satput(slot, x, y, pattern)
  local a = 0x7F00 + slot * 4
  vram[a] = y + 64
  vram[a + 1] = x + 32
  vram[a + 2] = pattern * 2
  vram[a + 3] = 128
  -- >>> browser: the model's SAT; the console build of this toy drops these
  sat(slot, 0, y + 64)
  sat(slot, 1, x + 32)
  sat(slot, 2, pattern * 2)
  sat(slot, 3, 128)
  -- <<< browser
end

function frame(t, f)
  tick = tick + 1
  if tick >= 4096 then tick = 0 end

  -- ---- the scroll: drift plus the pad ---------------------------------
  sx = sx + 1
  -- >>> pad: the console build of this toy drops these two lines (route 1
  -- cannot read the pad, card #134); on the console the cave drifts alone
  if pad[1].right then sx = sx + 3 end
  if pad[1].left then sx = sx - 4 end
  -- <<< pad
  if sx < 0 then sx = sx + 1024 end
  if sx >= 1024 then sx = sx - 1024 end

  -- ---- the glow: the rock's lit veins breathe --------------------------
  local g = (tick // 6) % 4
  local v = GLOW_BASE
  if g == 0 then v = GLOW_COLD end
  if g == 2 then v = GLOW_HOT end
  pal(GLOW_PAL * 16 + GLOW_ENTRY, v)

  -- ---- the creatures ---------------------------------------------------
  -- bats fly right and flap; the second runs the other way at its own speed
  px1 = (tick * 2) % 300 - 20
  py1 = 44 + (tick // 3) % 21
  px2 = 280 - (tick + 60) % 300
  py2 = 60 + (tick // 4) % 17
  b1p = PATTERN_CELL + (tick // 8) % 2
  b2p = PATTERN_CELL + (tick // 7 + 1) % 2
  satput(0, px1, py1, b1p)
  satput(1, px2, py2, b2p)

  -- embers rise off the rock and wrap to the floor
  ex0 = 40 + (tick // 5) % 24
  ey0 = 200 - (tick + 10) % 150
  ex1 = 120 + (tick // 4 + 8) % 24
  ey1 = 200 - (tick + 70) % 170
  ex2 = 200 + (tick // 6 + 4) % 24
  ey2 = 200 - (tick + 120) % 130
  satput(2, ex0, ey0, PATTERN_CELL + 2)
  satput(3, ex1, ey1, PATTERN_CELL + 2)
  satput(4, ex2, ey2, PATTERN_CELL + 2)
end

-- ---- the parallax ------------------------------------------------------
-- One BXR per band, written by the RCR line interrupt.  The map is drawn so
-- every band repeats with a period that divides the 32-cell BAT, so the
-- scroll wraps without a seam.  Line 0 must restate the top band: the VDC
-- latches the last band's BXR at the frame boundary (toys/parallax.lua says
-- why).

function raster(line)
  if line == 0 then reg("BXR", (sx // 8) % 1024) end      -- the ceiling: slowest
  if line == 32 then reg("BXR", (sx // 4) % 1024) end     -- the crystal band
  if line == 56 then reg("BXR", (sx // 2) % 1024) end     -- the near wall
  if line == 96 then reg("BXR", sx % 1024) end            -- the mid floor
  if line == 160 then reg("BXR", (sx * 2) % 1024) end     -- the near floor: fastest
end
