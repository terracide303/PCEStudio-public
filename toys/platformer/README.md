# PLATFORMER — a one-screen platformer

A small playable platformer: one screen, one hero, a pit, three brick
ledges and a grassy floor.  Run, jump, land on a ledge, fall in the pit and
respawn.  There are no enemies yet — this is version 1.

**Keys:** J / L run left and right, N jumps (hold it longer to jump higher).

Written with Claude for the maintainer, 2026-10-29.  The picture is drawn in the toy
itself with `puttile` (background characters) and `putsprite` (the 16x16
hero), so there is no pack art and nothing to download beside it.

## The console export

This toy was reworked in place on 2026-11-04 so the studio's Export builds a
cartridge that holds **60 Hz**: the console's own counters (the update
counter and the Trombone timer in the interpreter ROM, read by
`tools/measure-rom.js`) read **537 updates in 900 display frames, 0
overruns, worst 212 scanlines of the 262 a frame has, mean 209.5** — before
the rework every update overran, worst 448.  The picture is the browser's:
a Mednafen capture is diff 0 against a browser frame.

The bytecode uses **2,522 B of the 8,160 B data bank** (30.9%), and no
interpreter capacity is near its limit: 46 constants (36.2%), 11 functions
(26.8%), 30 registers in the busiest function (73.2%), 5 upvalues (25%), 10
boot upvalue cells (13.9%), 14 globals (43.8%), 10 boot closures (20.8%), 2
arguments (25%).  The exported ROM is 40,960 B.

The change is in how the same work is done, not in the game.  `frame()`
runs 74 IL instructions instead of 110, because on the console every
instruction costs the interpreter about 2.8 scanlines:

- **Shifts for the divisions.**  `px // 16` and `py // 16` are `>> 4` and
  `// 8` is `>> 3`.  `px` and `py` are never negative, so the values are
  identical; the interpreter's `//` is a soft routine that costs about 19
  scanlines more than the shift.
- **One pad read per field.**  The jump button is read once and used three
  times; the run reads are unchanged.
- **The feet span, not a call.**  `cell()` is still the level's rule and
  still draws the map.  In `frame()` its "is there anything here" is
  written out as "the hero's two-to-three-column feet span meets this row's
  solid cells" — one comparison each side, because the ground rows hold
  every column but the pit's and each ledge is one unbroken run of six.
  The comparisons are the same ones `cell()` makes, so the landing rule is
  unchanged.
- **The clamps moved into the move.**  `px` can only leave the screen
  inside the left/right branch, so the clamp sits there and costs nothing
  on a frame with no direction held.
- **The SAT pattern word is set once.**  `sat(0, 2, …)` never changes, so
  `init()` writes it; `frame()` writes only the y, x and attribute words.

The rules, the levels, the art, the physics numbers (24/16 px a frame, the
−96/6 jump, the 96 fall cap) and the sprite order are unchanged.

Evidence that it still plays the same: `tests/check-platformer.js` plays
600 frames through the browser and IL runtimes with the scripted pad and
requires them to agree on every frame.  A frame-by-frame old-vs-new
comparison — the original at
`/Volumes/External/pcestudio-toys/originals/platformer/main.lua` against
this file — over 9,958 frames of scripted play that reaches rows 9 to 29
(all three ledges), runs to both screen edges, holds both directions at
once and falls in the pit, is pixel- and state-identical in the IL runtime,
and 1,320 of those frames are identical in the Lua runtime too.
`tests/check-export-games.js` pins the ROM's sha256 and checks that a
Mednafen capture is diff 0 against a browser frame.

The original `main.lua` and README are kept outside the repository at
`/Volumes/External/pcestudio-toys/originals/platformer/`; git history also
carries them.

**Known limit:** `init()` still draws the whole map and the sprite patterns
through the interpreter, so the console's first update lands after about 7
seconds of emulated time (the measure runs 900 frames and the capture 12
seconds to clear the boot).  That is the one-time build, not the frame rate.
