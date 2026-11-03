# toys/ — the example toys (card #29)

Five short Lua files, each one classic PC Engine effect and the trick that
makes it.  They are ordinary toys for the runtime in `renderer/pce-toys.js`
(see [`../docs/TOYS.md`](../docs/TOYS.md)) and are written inside the IL's
subset (integers only, no string values, no table reads) so the same file runs
through `renderer/pce-il.js` too — the console path (#31).

| file | the trick | per-line register writes | frame writes |
|---|---|---|---|
| `parallax.lua` | four background bands scrolling at four speeds | BXR on 4 lines | BYR = 0 |
| `sky-gradient.lua` | one flat tile turned into a sky by rewriting a palette entry per line | palette 1, sun colour 2 | — |
| `road.lua` | a pseudo-3D road: BYR picks a perspective row, BXR bends it, the palette shades it and moves the stripes | BXR + BYR + palette on every line | — |
| `status-bar.lua` | an RCR split: lines 0–23 hold still, everything below scrolls | BXR + BYR on lines 0 and 24 | blink palette 1 colour 3 |
| `palette-cycle.lua` | water and fire by rotating two palette runs | — | palette 0 colours 1–6, palette 1 colours 1–6 |
| `tricks/raster-bar.lua` | a raster bar and a per-line palette change on one flat tile (#243) | palette 1 on every line | — |
| `tricks/fade.lua` | a 7-step fade to black and a 14-half-step crossfade, with the words measured (#243) | — | two palette writes a frame |
| `tricks/sprite-limit.lua` | 16 16-px sprites on one line and 8 32-px CGX sprites on another: the 16-strip budget (#243) | — | 24 SAT entries |
| `platformer/main.lua` | a one-screen platformer: run, jump, land on the ledges above the pit (#147) | — | 1 SAT entry |
| `tower/main.lua` | an original climber: ladders, rolling boulders, hearts, a hammer, a gem per round (#147) | — | 18 SAT entries |
| `dusk-run/main.lua` | an endless sunset runner over five line-scroll bands, with rocks, birds and hearts (#151) | BXR on 5 lines | backdrop palette on ~152 sky lines, up to 10 SAT entries |
| `padtest/main.lua` | two pads' eight buttons live: a held button lights its cell, and `vram[0x3F01]`/`[0x3F02]` carry each pad's ever-held mask | — | the lit cell's 9 BAT words, only while it changes |

`platformer/` and `tower/` are #147's two playable demos, written with Claude
for the maintainer on 2026-10-29 and copied unchanged.  `dusk-run/` is #151's
endless runner, written the same way on the same day and also copied
unchanged.  Their picture is drawn in the toy itself with
`puttile`/`putsprite`, so there is no pack art and nothing to download
beside them.  The studio runs all three; the console export carries
PLATFORMER (its `pad[1]` reads included, #186) and DUSK RUN (#222) while
TOWER stops at the data bank — each README says which.

Every file opens with a comment naming the trick and each block says why it
is there.  A tile is written by `puttile`, which packs colour numbers into the
VDC's two bitplanes — that helper is repeated in each file so a toy can be
read (and copied) on its own.

## `tricks/` — the Hardware tricks toys (card #243)

`raster-bar.lua`, `fade.lua` and `sprite-limit.lua` are the teaching toys the
Hardware tricks page (`renderer/tricks.html`) opens in the studio with
`?demo=trick-…`; the page also reuses `palette-cycle.lua` and `parallax.lua`
from the table above.  `tools/trick-toys.js` carries them to the studio
(`renderer/trick-toys.js`, generated), and `tests/check-tricks.js` runs every
one through both runtimes and the validator and pins the numbers the page
prints.  They are not Browse entries.

Run them all (120 frames each through the Lua runtime and the IL, budgets,
effect checks, and the frame-60 PNGs):

```sh
node tests/check-examples.js
```

The pictures land in `tests/dumps/examples/`, one PNG per toy.

## The folder toys

Two examples are folders rather than one file, because their picture is
bigger than a toy: `demo-game/` (STARFALL, #88) keeps its three asset files
beside `main.lua`, and `city/` (#125) is a demo made from Anokolisa's *Action
Pack - CITY* whose converted art is **not** in this repository — the maintainer's
2026-10-29 decision keeps it beside the repo in `demo-art/city/` and
`tools/deploy.sh` uploads it with the toy.  See
[`city/README.md`](city/README.md) for the licence, the credit, the converter
and the evidence; `node tests/check-city.js` skips with a clear line when the
art is not on the machine.

`padtest/` is the pad witness: the same file runs in the browser (the
Gamepad API and the keyboard merge into pad 1, a second controller is pad 2),
in the IL, and in the exported ROM, where the console runtime's `joy_scan()`
fills the pads.  [`docs/PADS.md`](../docs/PADS.md) tells that story and
`tests/check-pad-buttons.js` pins it, alongside the ROM sha and picture pin
in `tests/check-export-games.js`.
