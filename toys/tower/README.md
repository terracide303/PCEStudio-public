# TOWER — an original climber

Climb a crumbling tower, one floor at a time, and reach the gem.  Four
ladders join five floors, each floor has a gap at one end, and boulders spawn
at the top and roll along the floors, dropping where the stone ends.  A heart
gives a life (up to five), the hammer smashes boulders for eight seconds, and
every gem you reach makes the next round faster.

**Keys:** J / L run, I / K climb a ladder up and down, N jumps.

Written with Claude for the maintainer, 2026-10-29.  The picture is drawn in the toy
itself — the hero in three poses, the boulder, the hammer, the hearts and the
gem — so there is no pack art.

## The console export

This toy was reworked in place on 2026-11-03 so the studio's Export builds a
cartridge.  The bytecode uses **7,862 B of the 8,160 B data bank** (96.3%),
and no interpreter capacity is over its limit: 27 functions (65.9%), 32
registers in the busiest function (78.0%), 7 upvalues (35%), 47 boot upvalue
cells (65.3%), 30 globals (93.8%), 6 arguments on the widest call (75%).  The
exported ROM is 40,960 B.

The change is in how the same pictures are produced, not in the game.  The
art is built by four small pixel rules behind two loops instead of thirteen
closures; the background map is written as floor and ladder runs, leaving
blank cells at the runtime's zero (the same blank tile); and only the two
sprite planes this art uses are computed.  A sprite's flip is one packed
number, so a sprite call takes six arguments instead of seven.  The rules,
the tile and sprite art, the sprite order and the numbers are unchanged.

Evidence that it still plays the same: `tests/check-tower.js` plays 600
frames through the browser and IL runtimes with the scripted ladder climb and
requires them to agree on every frame, and a separate frame-by-frame
comparison over 6,700 scripted frames (idle, running, jumping, climbing up
and down, and a long deterministic random pad) is pixel- and state-identical
to the original toy.  `tests/check-export-games.js` pins the ROM's sha256 and
checks that a Mednafen capture is diff 0 against a browser frame.

The original `main.lua` and README are kept outside the repository at
`/Volumes/External/pcestudio-toys/originals/tower/`; git history also carries
them.

**Known limit:** the interpreter is slow for a game this size.  On the
console the one-time build draws the tower in about 20 seconds, and a frame
then takes about 11 video frames (roughly 5 updates a second).  The game
logic, art and controls are the browser's; the playback rate is not.  A speed
pass is separate work (PLATFORMER holds 30 Hz; DUSK RUN is slower still).
