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
| `cave/main.lua` | a demo over a bought tileset: five parallax bands, a breathing palette, bats and embers (#127) | BXR on 5 lines | palette entry, 5 SAT entries |
| `platformer/main.lua` | a one-screen platformer: run, jump, land on the ledges above the pit (#147) | — | 1 SAT entry |
| `tower/main.lua` | an original climber: ladders, rolling boulders, hearts, a hammer, a gem per round (#147) | — | 18 SAT entries |

`cave/` is a demo rather than a trick: its picture is converted from the
"Retro Pixel Cave" pack by `tools/cave-assets.js` and lives **beside** the
repo, never in it (`docs/DECISIONS.md`, 2026-10-29) — see
[`cave/README.md`](cave/README.md).  Without that art the toy draws a plain
rock wall and `tests/check-cave.js` prints a SKIP.

`platformer/` and `tower/` are #147's two playable demos, written with Claude
for Dennis on 2026-10-29 and copied unchanged.  Their picture is drawn in the
toy itself with `puttile`/`putsprite`, so there is no pack art and nothing to
download beside them.  Both are browser-only for now: the studio runs them,
but the console export cannot carry a `pad[1]` read (PLATFORMER) or a Lua
table (TOWER) yet — each README says which.

Every file opens with a comment naming the trick and each block says why it
is there.  A tile is written by `puttile`, which packs colour numbers into the
VDC's two bitplanes — that helper is repeated in each file so a toy can be
read (and copied) on its own.

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
Pack - CITY* whose converted art is **not** in this repository — Dennis's
2026-10-29 decision keeps it beside the repo in `demo-art/city/` and
`tools/deploy.sh` uploads it with the toy.  See
[`city/README.md`](city/README.md) for the licence, the credit, the converter
and the evidence; `node tests/check-city.js` skips with a clear line when the
art is not on the machine.
