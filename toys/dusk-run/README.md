# DUSK RUN — an endless runner (#151)

A small endless runner at sunset: the world slides left over five
line-scroll bands and the hero runs on the ground until a rock, a bird or a
missed heart ends the run.  Jump the rocks, stay low under the birds, and
grab the falling hearts for a life (up to five).  The top bar shows the
score, the lives and the high score.

**Keys:** N (the I button) jumps — hold it longer to jump higher — and after
a game over N runs again.

Written with Claude for Dennis, 2026-10-29.  The picture is drawn in the toy
itself with `puttile` (the landscape, the ground and the score bar's font)
and `putsprite` (the hero, rocks, birds and hearts), so there is no pack art
and nothing to download beside it.

## The trick, in the toy's own words

`raster(line)` writes BXR at four band edges, so each band scrolls at its own
speed — clouds 1/8, mountains 1/4, hills 1/2, ground 1/1 — and line 0 holds
the score bar still.  The same callback rewrites the backdrop colour on every
sky line, which is what makes the sunset a gradient rather than one flat
colour.

The tiles are drawn at load time, a few per frame: `BUILD_STEPS` = 137 frames
(about two seconds in the studio), and `frame()` returns early until that
drawing is done.  The hero appears on frame 137.

## Copied unchanged

`main.lua` is `/Volumes/External/pcestudio-toys/dusk-run.lua`, byte for byte
(sha256 `bb7dff94ca25ef918786a3c6e7a550ad5a31f1511c7a664b88fa84aa2d995bfd`).
**No changes were made**: it loads and runs in the studio unchanged,
`renderer/pce-validate.js` accepts it, and `tests/check-dusk-run.js` plays
600 frames of it through both runtimes with no difference, jumping one rock.

## What the validator says

`renderer/pce-validate.js` accepts the toy (`ok`), and lists one warning:

- `validate-slow-frame` — one toy frame costs 390,897 cycles (3.28 of a
  60 Hz frame, 18.3 Hz).  The cost is the sunset: the backdrop colour is a
  palette write on ~152 sky lines, and the console's raster cost is counted
  per line.  VRAM is 17,024 words (inside 32,768), the busiest line asks for
  3 sprite strips (inside 16), and no line overflows.

That is a console-cycle estimate, not the browser's speed; the browser
runtime runs the toy at the page's frame rate.

## Browser only

DUSK RUN keeps its rocks, birds, hearts and game state in Lua tables.  The
console **Export** path cannot carry a table yet: `renderer/pce-ilbc.js`
refuses the `table` instruction, so Export lists that as a finding instead
of building a ROM.  It also reads `pad[1]` and calls `sfx()`, which the
encoder has no bytecode form for either.  The toy runs fine in the browser
studio (and in the IL runtime the validator uses); it is the bytecode
encoder that is missing the op.  See `docs/IL.md`.
