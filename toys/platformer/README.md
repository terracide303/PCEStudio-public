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

## Browser and console

It plays in the studio (the Lua runtime), passes the validator, and the
console **Export** path builds it (#186 carried the `sat` instruction —
the sprite table writes; #185 carried the pad reads): the ROM runs in
Mednafen at 30 Hz, and its picture is the browser's.  A note on the
console boot: `init()` draws the whole map and the sprite patterns through
the interpreter, so the first update lands after ~7 s of emulated time —
`docs/ROM_SPEED.md` measures it with a 900-frame run.
