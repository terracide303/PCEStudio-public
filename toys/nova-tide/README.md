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

**No changes were made to `main.lua`**: the game as it came back from the
studio passed every test.  `tests/check-nova-tide.js` plays it through both
runtimes — 720 frames of the scripted tour (which flies the ship, takes
three hits, sees GAME OVER and restarts on P), 240 frames of parked firing
(two drones shot down, the score rising 0 → 100 → 200), and 750 frames of
the boss path from `stage_t` 2660 (the fish enters, the bar drains hit by
hit, it dies, stage 2 and the score +5000) — with the Lua runtime and the
IL runtime agreeing on every frame's VRAM, CRAM, SAT, registers, raster
table and pixels.

## The trick, in the toy's own words

The PC Engine has one background layer, so the depth comes from scrolling
bands of lines at different speeds (`raster`): the HUD bar stands still,
then sky, hills, city and sea each move faster than the one above.

## Browser only

NOVA TIDE keeps its bolts, enemies, explosions and state in Lua tables.
The console **Export** path cannot carry a table yet: `renderer/pce-ilbc.js`
refuses the `table` instruction, so Export lists that as a finding instead
of building a ROM.  The toy runs fine in the browser studio (and in the IL
runtime the validator uses); it is the bytecode encoder that is missing the
op.  See `docs/IL.md`.
