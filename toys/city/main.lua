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
-- 2026-10-29; docs/DECISIONS.md).  The art is the studio's own files (card
-- #156): demo-art/city/ holds tiles.json, palettes.json, sprites.json and
-- sources.json, which the #117 importer loads before init(); the playable
-- file is demo-art/city/main.lua — this file plus a generated tail that
-- replaces the constants below with the importer's placement numbers
-- (tools/city-assets.js writes it, the way tools/cave-assets.js writes
-- CAVE's).  tools/gallery.js --with-demo-art reads that file with the JSON
-- files and tools/deploy.sh uploads them as the gallery's CITY sources, so
-- the site plays the picture with no fetch and no second runtime.  A clone
-- runs THIS file: art_boot() draws nothing, the toy still plays, and
-- tests/check-city.js skips with a line.
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
-- grate) counts at the camera's rate, one pixel a frame; the near band is
-- the WATER STRIP alone (from the water line down) and counts two.  Keeping
-- the wall in the far band is the other half of #148: a pipe sliding with
-- the water reads as a mistake.
--
-- THE CAMERA HAS A DEAD ZONE (#158, Dennis playing it: "animation stands
-- still in CITY while background scrolls.  It should start scrolling when
-- you walk and move the character.  And the character should not move
-- further as the middle").  Nothing moves by itself: the bands count only
-- while the soldier walks, and the pad at rest shows the idle stand against
-- a still street.  Walking moves the soldier himself, one pixel a frame,
-- until his body's centre reaches the screen's middle — px = MID, the pair's
-- left edge, puts the centre px + 32 on x 128 — and from there the camera
-- scrolls instead: the bands count at their rates above and he stays at the
-- middle.  Walking left scrolls the camera back until cam 0, the level's
-- start, then walks him back to px = LEFT, where he stops — no walking off
-- the left edge, and a pad held against the edge moves nothing.
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
-- at 100 ms each — so the run is those eight at the gif's own pace, one pose
-- every six 60 Hz frames (100 ms), six pixels of ground a pose, so the feet
-- do not slide — and nothing else.  The run plays only while ground is
-- covered (#158); the pad at rest shows frame 1 (the wide planted stand),
-- the idle; the leap reuses run frame 7's stride; and the crouched aim
-- (frame 35) shows only WHILE the fire key is held, so the gun comes down
-- the moment it is released.
--
-- CONTROLS on pad[1] (studio and site: IJKL, N, M): left/right walk the
-- character across the screen to the middle and then scroll the street, up
-- jumps, N (I) shoots, M (II) shoots too.

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
LEFT = 8                                         -- px's floor: the level's start — the
                                                 --   soldier never walks off the left edge
MID = 96                                         -- the dead zone's end: the pair's left edge;
                                                 --   the body's centre px + 32 is the screen's
                                                 --   middle, x 128 — from here the camera
                                                 --   scrolls and the soldier stays (card #158)

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
-- water at GROUND_Y.  SAT x is the display x plus 32 (the VDC's X origin,
-- docs.html's SAT word table — toys/cave/main.lua's sat(slot, 1, x + 32) is
-- the same compensation), so the pair's left edge on screen is px.
local function put_player(px, feet, left, right)
  -- A 32x64 sprite: CGY = 2 makes the VDC fetch all 64 lines (with CGY 0 it
  -- draws 16), and CGX makes each 32-wide sprite two 16-pixel strips — cells
  -- p and p|1 — so one pattern's 8 cells 80..87 are all read.  Without CGX
  -- the right half of every frame stays dark.
  -- spbg: the sprite in front of the background.  The SAT's SPBG bit defaults
  -- to 0, which lets an opaque background pixel cover the sprite — and this
  -- background is opaque everywhere the character runs.
  sprite(0, {x = px + 32, y = feet, pattern = left, palette = 0,
             spbg = true, cgx = true, cgy = 2})
  sprite(1, {x = px + 64, y = feet, pattern = right, palette = 0,
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

  cam = 0               -- the camera's scroll, 0..255: the level's start to
                        --   the BAT's wrap; 0 is the level's start clamp
  cam_far = 0           -- the far band's own counter, the camera's rate
  cam_near = 0          -- the near band's own counter, twice the camera's rate
  px = LEFT             -- the pair's left edge; the body's centre is px + 32
  py = GROUND_Y         -- the feet's display row
  vy = 0                -- jump speed, pixels a frame (positive is down)
  airborne = 0
  run_t = 0             -- run timer; the pose is run_t // 6, only while walking
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
  -- the walk (card #158): nothing scrolls by itself.  The soldier walks one
  -- pixel a frame until the middle; from there the camera scrolls instead
  -- and he stays there.  Walking left scrolls the camera back to the
  -- level's start (cam 0), then walks him back to the left edge.
  local move = 0
  if pad[1].left then move = -1 end
  if pad[1].right then move = 1 end
  local walking = 0    -- 1 when this frame covered ground (him or the camera)
  if move == 1 then
    if px < MID then
      px = px + 1
      walking = 1
    else
      cam = (cam + 1) % 256
      cam_far = (cam_far + 1) % 256
      cam_near = (cam_near + 2) % 256
      walking = 1
    end
  elseif move == -1 then
    if cam > 0 then
      cam = cam - 1
      if cam_far == 0 then cam_far = 255 else cam_far = cam_far - 1 end
      if cam_near < 2 then cam_near = cam_near + 254 else cam_near = cam_near - 2 end
      walking = 1
    elseif px > LEFT then
      px = px - 1
      walking = 1
    end
  end
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
  -- in order), a new pose every six frames of walking — the gif's own
  -- 100 ms pace — and only while ground is covered (#158: the run frames
  -- play only while he moves, the idle stand when he does not)
  if airborne == 0 and walking == 1 then
    run_t = (run_t + 1) % 48
  end

  -- draw: the character (two sprites), then the bullets, then the parked SAT.
  -- #148: the aim pose shows only WHILE the fire key is held — the old
  -- cooldown timer kept the gun up after the key was released, which is the
  -- wrong animation Dennis saw.  Not walking (the pad at rest, or a pad held
  -- against the level's edge, where no ground is covered) shows the idle
  -- stand (frame 1); walking shows the run cycle; the leap has run frame 7's
  -- stride.
  if airborne == 1 then
    put_player(px, py, JUMP_L, JUMP_R)
  elseif pad[1].i or pad[1].ii then
    put_player(px, py, SHOOT_L, SHOOT_R)
  elseif walking == 0 then
    put_player(px, py, IDLE_L, IDLE_R)
  else
    local k = run_t // 6
    put_player(px, py, RUN_L[k + 1], RUN_R[k + 1])
  end
  for i = 1, 4 do
    if shots[i] == 1 then
      sprite(1 + i, {x = sx[i] + 32, y = sy[i] + 64, pattern = BULLET, palette = 0,
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
  g_near = cam_near
  g_far = cam_far
end

-- Called once per display line, after frame(): one BXR write per band.  Line 0
-- must restate the top band, or the frame-start latch takes the last band's
-- value (toys/parallax.lua).
function raster(line)
  if line == 0 then reg("BXR", g_far) end
  if line == NEAR then reg("BXR", g_near) end
end
