# PLATFORMER — a one-screen platformer (#147)

A small playable platformer: one screen, one hero, a pit, three brick
ledges and a grassy floor.  Run, jump, land on a ledge, fall in the pit and
respawn.  There are no enemies yet — this is version 1.

**Keys:** J / L run left and right, N jumps (hold it longer to jump higher).

Written with Claude for Dennis, 2026-10-29.  The picture is drawn in the toy
itself with `puttile` (background characters) and `putsprite` (the 16x16
hero), so there is no pack art and nothing to download beside it.

## Copied unchanged

`main.lua` is `/Volumes/External/pcestudio-toys/platformer.lua`, byte for
byte.  **No changes were made**: it loads and runs in the studio unchanged,
`renderer/pce-validate.js` accepts it (frame 0.02x of a 60 Hz frame, VRAM
16,448 words, no sprite line overflows), and
`tests/check-platformer.js` plays 600 frames of it through both runtimes
with no difference.

## Browser only, for now

It plays in the studio (the Lua runtime) and passes the validator, but the
console **Export** path refuses it: `renderer/pce-ilbc.js` has no bytecode
form for `sat` (the sprite table writes; #185 carried the pad reads), so
Export lists that as a refusal instead of building a ROM.  That is an
encoder gap, not a fault in the toy; the test prints it as a NOTE.
