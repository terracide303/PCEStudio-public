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

`cave/` is a demo rather than a trick: its picture is converted from the
"Retro Pixel Cave" pack by `tools/cave-assets.js` and lives **beside** the
repo, never in it (`docs/DECISIONS.md`, 2026-10-29) — see
[`cave/README.md`](cave/README.md).  Without that art the toy draws a plain
rock wall and `tests/check-cave.js` prints a SKIP.

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
