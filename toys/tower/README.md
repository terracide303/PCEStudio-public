# TOWER — an original climber (#147)

Climb a crumbling tower, one floor at a time, and reach the gem.  Four
ladders join five floors, each floor has a gap at one end, and boulders spawn
at the top and roll along the floors, dropping where the stone ends.  A heart
gives a life (up to five), the hammer smashes boulders for eight seconds, and
every gem you reach makes the next round faster.

**Keys:** J / L run, I / K climb a ladder up and down, N jumps.

Written with Claude for Dennis, 2026-10-29.  The picture is drawn in the toy
itself with `puttile` and `putsprite` — the hero in three poses, the boulder,
the hammer, the hearts and the gem — so there is no pack art.

## Copied unchanged

`main.lua` is `/Volumes/External/pcestudio-toys/tower.lua`, byte for byte.
**No changes were made**: it loads and runs in the studio unchanged,
`renderer/pce-validate.js` accepts it (frame 0.12x of a 60 Hz frame, VRAM
17,024 words, no sprite line overflows), and `tests/check-tower.js` plays
600 frames of it through both runtimes with no difference, climbing the
first ladder.

## Browser only

TOWER keeps its boulders, hearts and game state in Lua tables, and the
console **Export** path cannot carry a table yet: `renderer/pce-ilbc.js`
refuses the `table` instruction, so Export lists that as a finding instead of
building a ROM.  The toy runs fine in the browser studio (and in the IL
runtime the validator uses); it is the bytecode encoder that is missing the
op.  See `docs/IL.md`.
