# CAVE — a demo built from the Retro Pixel Cave tileset (card #127)

One background, five bands, five scroll speeds: the ceiling, three far plates,
a rock shelf and the floor each get their own `BXR` from the RCR line
interrupt, so the cave reads as depth rather than as one flat wall.  The
pack's own warm colour is cycled once a frame, so the rock's lit veins breathe.
Two bats and an ember fly over it.  Pad 1's left/right scroll it by hand; it
also drifts on its own, so it plays unattended.

The same file runs through the Lua runtime and the IL runtime, and
`node tests/check-cave.js` runs both for 120 frames and compares every byte.

## The art is not in this repository

**Dennis, 2026-10-29:** "About the artwork don't put it on the repo but it's
fine as demo on the website in PCE Studio." — `docs/DECISIONS.md`.

So nothing converted from the pack is committed: no tiles, no palettes, no
sprite patterns, no frame strips, no ROMs.  `tools/cave-assets.js` converts
the pack and writes it beside the repo:

```
../demo-art/cave/art.lua         the Lua block the toy draws with (the art)
../demo-art/cave/tiles.json      the SCREEN panel's picture
../demo-art/cave/palettes.json   the PALETTES panel's picture
../demo-art/cave/sprites.json    the SPRITES panel's patterns
../demo-art/cave/cave-console.lua  the console build (see "Running on a PCE")
```

`main.lua` alone still runs — it paints a plain rock stub — so a fresh clone
is green and never a black screen.  `tests/check-cave.js` prints one `SKIP`
line when `art.lua` is missing and exits 0.

To rebuild the art after changing the converter:

```sh
node tools/cave-assets.js --out ../demo-art/cave    # or --pack /path/to.zip
node tests/check-cave.js                            # 876 checks with the art
```

To play it with the art, the page has to be given it: `node tools/gallery.js
--art-dir ../demo-art` appends `art.lua` to the toy's source in the module the
pages read.  `tools/deploy.sh` does exactly that when it publishes, so the
website's copy is the one with the picture, and the repo's copy is the one
without.

## Credit, as the pack's licence asks

**"Retro Pixel Cave" tileset by Will Tice, unTied Games**
(<https://untiedgames.itch.io/> · @untiedgames · @freed_will).

`license.txt`, in the pack:

> **1.** You may not publicly distribute the contents of this zip file in
> whole or in part, unless as part of a game or application product.
>
> **2.** If you use this material in a game or other product, please give
> attribution to Will Tice in the credits.
>
> **3.** That's it! Use in any for profit / not for profit product according
> to the above, and give me a shoutout at @untiedgames or @freed_will if you
> can. Thanks!

This demo is part of PCEStudio, an application product, and the attribution
stands here, on the toy's page, and in its Browse card.  The pack itself was
not redistributed: neither the zip nor the raw PNGs are in the repo or on the
site — only this demo's converted picture, which the licence allows as part of
the product.

## Fit to the PC Engine (STEP 2)

Measured from the pack by `tools/cave-assets.js`, which prints the numbers:

| | the pack (style_A) | the PCE | verdict |
|---|---|---|---|
| a tile | 8x8 PNG, 1–10 colours | 8x8 char, 16 colours from ONE palette | fits — the importer groups tiles whose colours fit together |
| the whole style | 16 distinct colours | 16 background palettes x 16, but 16 colours *per tile* | fits in ONE palette, so the picture is exact, no dithering |
| the scene | composed from 38 tile PNGs | 32x32 BAT, 1536 chars | 125 distinct tiles after dedup |
| sprite sizes | none in the pack | 16x16 … 32x64 | the creatures are drawn 16x16 (the VDC's smallest) |
| the plates | 160x92 PNG per layer | one BG layer | each plate is cut to 8x8 cells over a 128-px period, so the scroll wraps without a seam |

The palette the importer chose is one palette of 15 colours plus the shared
backdrop — the picture is colour-exact; there is no dither in it.

## Running on a PCE (the Export clause)

Two facts, both measured on this machine (2026-10-29), and the card carries
them:

1. **Route 1 (the Export button) cannot carry this demo.**  Its bytecode has
   one constant pool of 127 entries (`renderer/pce-ilbc.js:113`,
   `:295`); a full-screen picture is ~1000 distinct VRAM addresses in the BAT
   and tile writes alone, so the encoder refuses with `ilbc-range` before it
   reaches the 8 KiB data bank that #138 is about.  It also has no `sat()`
   (#133) and no pad read (#134).
2. **Route 2 (IL -> C -> llvm-mos) is not installed here.**  `tools/
   build-toyc.sh` wants the llvm-mos SDK at `/Volumes/External II/pce-tools/`,
   which is not mounted; PCEAS is not on `PATH` either.

So `tools/cave-assets.js` also writes `cave-console.lua`: this same demo with
the two marked regions cut — the pad read and the model-only `sat()` calls —
and the art appended, which is exactly what route 1 would need if its
constant pool (or a data-bank load op) allowed it.  The day it does, the file
is already built.  Until then the demo's evidence is the browser and the
IL/Lua agreement, and the ROM is blocked on the platform, not on this toy.

## Files

| file | what it is |
|---|---|
| `main.lua` | the demo: the scroll, the bands, the glow, the creatures — no art |
| `README.md` | this file |

The art, the converted panels' files and the console build are in
`demo-art/cave/` beside the repo (see above).
