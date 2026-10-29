-- main.lua — CITY, a demo made from Anokolisa's "Action Pack - CITY" (card #125).
--
-- WHAT THIS IS: a soldier runs along a flooded city street at night, jumps and
-- shoots.  The picture is the pack's own composed scene; the character is ten
-- frames of the pack's character sheet.  The pack's Autor_note.txt grants
-- commercial use and asks for credit: "all the assets here are totally free
-- for commercial use and the like. credits are optional but appreciated."
-- The credit is in this folder's README and on the Browse page.
--
-- WHERE THE ART IS.  Not in this file and not in this repository (Dennis,
-- 2026-10-29; docs/DECISIONS.md).  The playable file is
-- demo-art/city/main.lua: this file plus a generated tail that redefines the
-- constants below and fills art_boot() with the pack's VRAM and CRAM writes
-- (tools/city-assets.js writes it, the way tools/cave-assets.js writes CAVE's).
-- tools/gallery.js --with-demo-art reads that file and tools/deploy.sh uploads
-- it as the gallery's CITY source, so the site plays the picture with no
-- fetch and no second runtime.  A clone runs THIS file: art_boot() draws
-- nothing, the toy still plays, and tests/check-city.js skips with a line.
--
-- ONE BACKGROUND, TWO BANDS.  The PC Engine has one background layer and no
-- HDMA.  A per-line horizontal offset is made by writing BXR (VDC R07) from
-- the RCR line interrupt — one write per band boundary, and every line after
-- it keeps the value (toys/parallax.lua is the reference).
--
-- TWO BANDS, EACH LOOPING ON ITS OWN COUNTER (#148, Dennis playing it: "the
-- second layer does not scroll to the end of the screen and restart, it now
-- stops somewhere in the middle").  A band's BXR must run 0..255 and wrap
-- there, because that is where the 32-cell BAT repeats; a band driven at a
-- third of another's speed must therefore COUNT at a third of the rate, not
-- divide a shared counter — `cam // 3` climbs 0..85 and snaps back to 0.
-- The far band (sky, skyline, buildings, and the wall with its pipe and
-- grate) counts one line a frame; the near band is the WATER STRIP alone
-- (from the water line down) and counts two, plus the pad.  Keeping the wall
-- in the far band is the other half of #148: a pipe sliding with the water
-- reads as a mistake.
--
-- THE WATER IS A PALETTE.  The pack's water is three colours in background
-- palette 1.  Rotating them among their own three CRAM entries every 8 frames
-- animates the water without touching a tile or the map
-- (toys/palette-cycle.lua).  tools/city-assets.js proves the three colours
-- appear nowhere above row 200, so the rotation cannot flash the city.
--
-- THE CHARACTER IS TWO SPRITES.  The VDC's largest sprite is 32x64; the run
-- frames are up to 40 px wide, so each frame is two 32x64 patterns side by
-- side and lands on SAT slots 0 and 1.  The tracer is a 16x16 pattern.
--
-- THE RUN CYCLE IS THE AUTHOR'S OWN (#148, Dennis playing it: "the animation
-- of the character is not running correctly").  The sheet's Full.gif plays
-- frames 3,4,5,6,7,8,9,10 in that order and run.aseprite holds the same eight
-- at 100 ms each — so the run is those eight, one every four frames, at a
-- steady rate, and nothing else.  Frame 1 (the wide planted stand) is the
-- idle, shown while the pad is at rest; the leap reuses run frame 7's stride;
-- and the crouched aim (frame 35) shows only WHILE the fire key is held, so
-- the gun comes down the moment it is released.
--
-- CONTROLS on pad[1] (studio and site: IJKL, N, M): left/right walk the
-- character across the screen, up jumps, N (I) shoots, M (II) shoots too.

-- The numbers the converter reports (tools/city-assets.js --report).  They are
-- VRAM addresses, not art: `node tools/city-assets.js --check` does not read
-- them, and tests/check-city.js asserts they are the codes the converted
-- picture really gives.
RUN_L = {80, 96, 112, 128, 144, 160, 176, 192}   -- the left half of run frames 3..10
RUN_R = {88, 104, 120, 136, 152, 168, 184, 200}  -- the right half
IDLE_L = 208                                     -- frame 1, the planted stand
IDLE_R = 216
JUMP_L = 176                                     -- run frame 7, airborne
JUMP_R = 184                                     -- (no pattern of its own)
SHOOT_L = 224                                    -- the crouched aim (frame 35)
SHOOT_R = 232
BULLET = 240
WATER_A = 17                                     -- the water's three CRAM entries
WATER_B = 18
WATER_C = 22
WATER_1 = 140                                    -- the three VCE words, dark to pale
WATER_2 = 287
WATER_3 = 431
GROUND_Y = 208                                   -- the water's surface row, display

-- The bands, in display lines.  A line keeps the last BXR written, so two
-- writes split the frame into two speeds.  The split is the water's own
-- surface line: everything above it (sky, skyline, buildings, the ledge and
-- the wall with its pipe) is the far city, and the strip below is water that
-- runs faster than the ground it sits in.
NEAR = 208       -- the near band starts on the water's surface line

-- The three water words by index, as an int array the IL reads like any other.
WATER_WORD = {WATER_1, WATER_2, WATER_3}

-- One 32x64 pattern pair: the frame's left and right halves.  SAT y is the
-- display y plus 64, and a pattern's last row is its 64th, so a pair drawn at
-- SAT y = feet rests its lowest row on feet-1: the character stands on the
-- water at GROUND_Y.
local function put_player(px, feet, left, right)
  -- A 32x64 sprite: CGY = 2 makes the VDC fetch all 64 lines (with CGY 0 it
  -- draws 16), and CGX makes each 32-wide sprite two 16-pixel strips — cells
  -- p and p|1 — so one pattern's 8 cells 80..87 are all read.  Without CGX
  -- the right half of every frame stays dark.
  -- spbg: the sprite in front of the background.  The SAT's SPBG bit defaults
  -- to 0, which lets an opaque background pixel cover the sprite — and this
  -- background is opaque everywhere the character runs.
  sprite(0, {x = px, y = feet, pattern = left, palette = 0,
             spbg = true, cgx = true, cgy = 2})
  sprite(1, {x = px + 32, y = feet, pattern = right, palette = 0,
             spbg = true, cgx = true, cgy = 2})
end

-- Replaced by demo-art/city/main.lua's generated tail when the art is there.
function art_boot()
end

function init()
  -- the pack's picture: palettes, tiles, the BAT and the sprite patterns
  art_boot()

  -- sprites ON (CR = BB | SB).  The host powers on with BB only, so a toy that
  -- forgets this draws a SAT nobody can see (docs/TOYS.md §2, card #120).
  reg("CR", 0xC0)

  cam = 0               -- the near band's scroll: 0..255, wraps at the BAT
  cam_far = 0           -- the far band's own counter, 0..255 as well
  px = 104              -- the pair's left edge; the body's centre is px + 32
  py = GROUND_Y         -- the feet's display row
  vy = 0                -- jump speed, pixels a frame (positive is down)
  airborne = 0
  run_t = 0             -- run timer; the frame is run_t // 4
  cooldown = 0          -- frames until the rifle can fire again
  shots = {0, 0, 0, 0}
  sx = {0, 0, 0, 0}
  sy = {0, 0, 0, 0}

  -- the SAT slots this toy never uses, parked once: SAT y 0 is above the
  -- window, so they never draw.  Parking them every frame would cost the
  -- frame budget (58 sprite() calls, measured at 2.39x 60 Hz by #125's
  -- validator) and change nothing.
  for i = 6, 63 do
    sprite(i, {x = 0, y = 0})
  end
end

-- One bullet from the rifle's muzzle; the first free slot of four.
function fire()
  for i = 1, 4 do
    if shots[i] == 0 then
      shots[i] = 1
      sx[i] = px + 44
      sy[i] = py - 36
      return
    end
  end
end

function frame(t, f)
  -- the street runs; the keys walk the character across the screen
  local move = 0
  if pad[1].left then move = -1 end
  if pad[1].right then move = 1 end
  px = px + move * 2
  if px < 8 then px = 8 end
  if px > 184 then px = 184 end
  cam = (cam + 2 + move) % 256        -- near: water, 2 px a frame + the pad
  cam_far = (cam_far + 1) % 256       -- far: the city, 1 px a frame
  reg("BYR", 0)         -- no vertical scroll: the map row is the screen row

  -- jump: up leaves the ground once; gravity brings it back down
  if airborne == 0 then
    if pad[1].up then
      vy = -8
      airborne = 1
    end
  end
  if airborne == 1 then
    py = py + vy
    vy = vy + 1
    if vy > 0 then
      if py >= GROUND_Y then
        py = GROUND_Y
        vy = 0
        airborne = 0
      end
    end
  end

  -- the rifle
  if cooldown > 0 then cooldown = cooldown - 1 end
  if pad[1].i or pad[1].ii then
    if cooldown == 0 then
      fire()
      cooldown = 10
      sfx(0, 900, 12, 4)
    end
  end

  -- bullets: right, faster than the street, gone past the screen's edge
  for i = 1, 4 do
    if shots[i] == 1 then
      sx[i] = sx[i] + 6
      if sx[i] > 250 then shots[i] = 0 end
    end
  end

  -- the run cycle: the author's own eight (Full.gif plays sheet frames 3..10
  -- in order), a new one every four frames, on the ground
  if airborne == 0 then
    run_t = (run_t + 1) % 32
  end

  -- draw: the character (two sprites), then the bullets, then the parked SAT.
  -- #148: the aim pose shows only WHILE the fire key is held — the old
  -- cooldown timer kept the gun up after the key was released, which is the
  -- wrong animation Dennis saw.  Standing still shows the idle stand (frame
  -- 1), walking shows the run cycle, the leap has run frame 7's stride.
  if airborne == 1 then
    put_player(px, py, JUMP_L, JUMP_R)
  elseif pad[1].i or pad[1].ii then
    put_player(px, py, SHOOT_L, SHOOT_R)
  elseif move == 0 then
    put_player(px, py, IDLE_L, IDLE_R)
  else
    local k = run_t // 4
    put_player(px, py, RUN_L[k + 1], RUN_R[k + 1])
  end
  for i = 1, 4 do
    if shots[i] == 1 then
      sprite(1 + i, {x = sx[i], y = sy[i] + 64, pattern = BULLET, palette = 0,
                     spbg = true})
    else
      sprite(1 + i, {x = 0, y = 0})
    end
  end
  -- the water: three shades dealt round their three entries every 8 frames
  local step = (f // 8) % 3
  pal(WATER_A, WATER_WORD[step + 1])
  pal(WATER_B, WATER_WORD[(step + 1) % 3 + 1])
  pal(WATER_C, WATER_WORD[(step + 2) % 3 + 1])

  -- raster() runs after this function and needs the frame's own offsets
  g_cam = cam
  g_far = cam_far
end

-- Called once per display line, after frame(): one BXR write per band.  Line 0
-- must restate the top band, or the frame-start latch takes the last band's
-- value (toys/parallax.lua).
function raster(line)
  if line == 0 then reg("BXR", g_far) end
  if line == NEAR then reg("BXR", g_cam) end
end
