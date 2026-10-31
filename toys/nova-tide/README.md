# NOVA TIDE — a side-scrolling shoot-'em-up (#164)

A small shoot-'em-up over a night sea: the world slides left in four
line-scroll bands (sky, hills, city, sea — each faster than the one above)
while waves of drones and gunships fly in, and an armoured fish closes every
stage.  Shoot the drones, dodge the aimed orbs, grab the falling P capsules
to power up from one bolt to two to a three-way spread, and beat the boss to
go on to the next stage.  Three lives; the top bar shows the score, the
stage and the boss's life.

**Keys:** I / J / K / L fly, N (the I button) fires — hold it — and P (Run)
starts again after a game over.

Written with Claude for Dennis, 2026-10-29, in the ppu.studio.  The art was
drawn by `tools/nova-tide-art.py` — plain shapes only, nothing taken from
any other game — into the toy's three asset files:

- `tiles.json` + `palettes.json` — the looping night-sea picture (source
  **sea**): 140 tiles, one background palette row and the BAT,
- `sprites.json` — the sprite sheet (source **ships**): 16 patterns of
  16x16 in two rows — the ship, the bolt, drones, the gunship, orbs, the
  capsule, explosions and the boss — and one sprite palette row.

The importer packs the sheet right after the picture's 140 tiles, so
`main.lua` only knows `PAT = 51` — the first pattern's VRAM cell.  The
toy's game code (the ship, the waves, the boss, the HUD glyphs) lives in
`main.lua` itself; the picture files only carry the art.  `sources.json`
names the two sources for the studio's ASSETS panel (card #156).

## Changes

**No changes were made to `main.lua`** — the game as it came back from the
studio was right; the test's first draft was not, and
`tests/check-nova-tide.js` now asserts what the game does:

- the ship starts **off** the SAT — the entry shield's first blink — and
  its first drawn frame is already moving (the tour's legs end on frames
  59 / 109 / 169 / 219, because the pad applies on the frame it is held);
- the parked-firing run parks at SAT y **196** (screen y 132, under wave
  2's band), and a bolt fired at frame 14 is already six pixels right of
  the nose (the bolt pass runs in the same frame as the fire);
- a sprite-0 collision is any of the game's own sprites over the ship —
  a drone, an aimed orb, an explosion after a hit — never a stray sprite;
- the boss path's autopilot takes one aimed orb (lives 3 → 2 at frame
  172), and the waves-after-boss score reads **7700** by frame 724.

The test plays the game through both runtimes — 720 frames of the
scripted tour (which flies the ship, takes three hits, sees GAME OVER and
restarts on P), 240 frames of parked firing (two drones shot down, the
score rising 0 → 100 → 200), and 750 frames of the boss path from
`stage_t` 2660 (the fish enters, the bar drains hit by hit, it dies,
stage 2 and the score +5000) — with the Lua runtime and the IL runtime
agreeing on every frame's VRAM, CRAM, SAT, registers, raster table and
pixels.  It also proves frame 599 is a picture (not the backdrop) and
that the sprites draw it: the same frame with an empty SAT fails its own
threshold.

## The trick, in the toy's own words

The PC Engine has one background layer, so the depth comes from scrolling
bands of lines at different speeds (`raster`): the HUD bar stands still,
then sky, hills, city and sea each move faster than the one above.

## Browser only

NOVA TIDE keeps its bolts, enemies, explosions and state in Lua tables.
The console **Export** path cannot carry this toy yet: `renderer/pce-ilbc.js`
refuses both the `table` instruction and calls with more than four
parameters (the interpreter's limit — the toy's `hit()` takes eight), so
Export lists those as findings instead of building a ROM.  The toy runs
fine in the browser studio (and in the IL runtime the validator uses).
See `docs/IL.md`.
