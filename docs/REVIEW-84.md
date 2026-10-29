# Rule 2 breaker (#84 and #90) — the SCREEN cell-map editor and the sprite example's visibility checks, broken 12 ways

Reviewer: @review (DeepSeek Flash seat). Date 2026-10-29. The builders of the
two targets were other seats. This is a cold break: the repository only, no
briefing. **Nothing was fixed; this is the list.** Rule 2 in
[`../../workshop/RULES.md`](../../workshop/RULES.md): a test is proven by
breaks someone else chose.

The targets:

- **#84** (`f9da65a`): `renderer/pce-screen.js` (the SCREEN panel's model —
  six tools, four zooms, the 32×32 BAT asset, BXR/BYR) and the panel in
  `renderer/studio.html` (the map canvas, the visible-screen outline, the
  zoom chips, the scroll buttons). Instrument: `node tests/check-studio.js
  --browser`.
- **#90** (`08f0a38`, `6f5406e`): the sprite example's pattern helper and the
  VISIBILITY assertions in `tests/check-toys.js`, `tests/check-examples.js`
  and `tests/check-studio.js`. Instruments: `node tests/check-toys.js`,
  `node tests/check-examples.js`, `node tests/check-studio.js --browser`.

## What I ran

- **Pinned tree.** A fresh `git clone` of `origin` under
  `$TMPDIR/rev84/base`, at `15e354c` (origin/main when the review ran; the
  three target commits are ancestors — checked with `git merge-base
  --is-ancestor`, all yes). The shared working tree has other seats'
  uncommitted edits (`renderer/pce-screen.js` among them); they are **not**
  part of this review.
- **Baseline, unmodified, at `15e354c`.** `node tests/check-studio.js
  --browser` → `PASS 631 checks` (588 in the stub), browser driver 38/38;
  `node tests/check-toys.js` → `PASS 831 checks`; `node
  tests/check-examples.js` → `PASS 4313 checks`.
- **One break at a time, on a copy.** `$TMPDIR/rev84/mutate.py` copies the
  pinned clone to `$TMPDIR/rev84/mut/<id>`, asserts the target string occurs
  **exactly once**, substitutes it, then runs the **unmodified** check with
  the copy as cwd (`$TMPDIR/rev84/run-all.sh`, logs in
  `$TMPDIR/rev84/logs/`). **The real repository was never edited.** No
  scratch file was written to `/tmp`; all work is under `$TMPDIR/rev84/`.
- **Result classes.** `DETECTED` = the check exits non-zero. `MISSED` = the
  check exits 0 and prints its PASS line, and a direct probe on the mutant
  shows it changes behaviour on a legal input no fixture reaches. `NO-OP` =
  the change cannot change behaviour for any legal input.
- **Probes.** `$TMPDIR/rev84/probes.js` extracts the function under test from
  the mutant tree's own source (brace-matched, no copy of the logic) and
  calls it. Each MISSED row below names its probe output.
- **No OS-level input.** The suites dispatch their own synthetic DOM events
  inside the check process / headless Chrome. This seat sent no keyboard or
  mouse event to the machine.

Counts: **12 breaks — 6 DETECTED, 6 MISSED, 0 NO-OP.**

## The table

| # | card | file | break, applied one at a time | result | measured output |
|---|---|---|---|---|---|
| M01 | #84 | `renderer/pce-editor.js` | the BAT word's palette nibble comes from the character number instead of the tile's palette: `((tile.palette & 0xF) << 12)` → `(((char - FIRST_CHAR) & 0xF) << 12)` | **DETECTED** | exit 1: `FAIL exactly one frame pixel changed, one colour byte each (0 bytes)`; `FAIL the frame pixel is palette 0's colour 5 (got [0,0,0], want [252,252,252])`; `FAIL 2 of 631 checks failed`. Browser driver 38/38 (it reads the map canvas, not the frame) |
| M02 | #84 | `renderer/pce-screen.js` | the bucket no longer checks the neighbour's tile: drop `if (ed.mapCell(...) === source)` and push every unseen neighbour | **MISSED** | exit 0, `PASS 631 checks ... headless Chrome: PASS 40 + driver`. Probe `fill`: on a `$40` field with a 2×2 `$42` island, flood from (0,0) = **1020 cells, island crossed false** pristine / **1024 cells, island crossed true**, and cell (10,10) `$42` untouched → **`$41` OVERWRITTEN** |
| M03 | #84 | `renderer/pce-screen.js` | a rect loses its last row and column: `y <= r.y1` / `x <= r.x1` → `y < r.y1` / `x < r.x1` | **DETECTED** | exit 1: `FAIL the rect fills its 4×3 block (got 7)`; `FAIL the rect changed only its own cells (13 of 1024 are $41)`; `FAIL browser driver: a real drag fills a 3x3 rect (4 cells)`; `FAIL 4 of 631 checks failed` |
| M04 | #84 | `renderer/pce-screen.js` | erase writes character 0 instead of the palette's blank tile: `paintCell(sess, cell, blankChar(...))` → `paintCell(sess, cell, 0)` | **DETECTED** | exit 1: `FAIL erase paints the blank tile of the cell's palette`; `FAIL the pick line counts the selection` (the refusal text replaces the footer); `FAIL 2 of 631 checks failed` |
| M05 | #84 | `renderer/studio.html` | a zoom chip resamples the BAT into itself and commits (the map is treated as the zoomed image): on 2×, `map[y][x] = old[y/2][x/2]` then `screenCommit()` | **MISSED** | exit 0, `PASS 631 checks ... headless Chrome: PASS 40 + driver`. Probe `zoom` after clicking 2×: pristine `map[0]=$41, map[1]=$40, map[32]=$40`, calls `["draw"]`; mutant `map[1]=$41, map[32]=$41`, calls `["commit","draw"]` |
| M06 | #84 | `renderer/studio.html` | BXR + writes BYR (and BYR + writes BXR): swap `dx`/`dy` in `screenScroll` | **DETECTED** | exit 1: `FAIL BXR + moves the scroll to 1`; `FAIL 1 of 631 checks failed` |
| M07 | #84 | `renderer/studio.html` | the visible-screen outline starts one cell low: `y0 = (BYR + 8) mod 256` instead of `BYR mod 256` | **MISSED** | exit 0, `PASS 631 checks ... headless Chrome: PASS 40 + driver`. Probe `outline` for BYR 0: first outline row **0** pristine, **8** mutant (a cell is 8 px) |
| M08 | #84 | `renderer/pce-editor.js` | the tile-number-to-address factor is 8 instead of 16: `(m * 16 + y) * 2, (m * 16 + 8 + y) * 2` → `(m * 8 + y) * 2, (m * 8 + 8 + y) * 2` (tile planes land in the BAT) | **DETECTED** | exit 1: `FAIL exactly one frame pixel changed, one colour byte each (48 bytes)`; `FAIL the frame pixel is palette 0's colour 5 (got [0,0,0], want [252,252,252])`; `FAIL 2 of 631 checks failed`. Browser driver 38/38 (same map-canvas blind spot as M01) |
| M09 | #90 | `tests/check-examples.js` | the visibility counter counts the backdrop: drop the `if (pixel === CRAM[0]) continue;` from `countVisible` | **MISSED** | exit 0, `PASS 4313 checks: 5 example toys x 120 frames ...`. Probe `countVisible` on an 8×8 **backdrop-only** frame (CRAM[0]=0): **0 of 64** pristine, **64 of 64** mutant |
| M10 | #90 | `tests/check-studio.js` | the movement assertion accepts a still sprite: the `byOne` loop only requires `right[i].box` to exist, not `box[0] === SPR_X + i + 1` | **MISSED** | exit 0, `PASS 631 checks ... headless Chrome: PASS 40 + driver`. Probe `movement` (the mutant's own extracted `byOne` block) on a STILL sprite: **false** pristine, **true** mutant; the moving sprite is true in both |
| M11 | #90 | `tests/check-toys.js` | the pattern helper writes the BAT layout again: `vram[pattern*64 + n*16 + row]` → `vram[pattern*16 + n*8 + row]` (planes overlap at +8) | **DETECTED** | exit 1: `FAIL sprite f0 vram differs at byte 8192: 255 != 0`; `FAIL sprite f0 VISIBILITY: the 16x16 block shows in the pixels (0 of 256 non-backdrop)`; `FAIL 108 of 831 checks failed`, of which **28 are VISIBILITY** (and 40 vram + 40 pixel state diffs) |
| M12 | #90 | `tests/check-examples.js` | the per-box threshold is 0: `check(n >= box[4], ...)` → `check(n >= 0, ...)` | **MISSED** | exit 0, `PASS 4313 checks ...`. Probe `threshold` on an all-backdrop 8×8 frame with a box that needs 4000 pixels: **0** visibility assertions pass pristine, **1** passes mutant (the box assertion; the whole-frame check still fails in both) |

## The MISSED, and the check that would catch each

**M02 — a bucket leaks past a different tile.** The #84 fill fixture runs
after the rect test, and at that point the whole non-rect map is one
connected region of `$40`; the fill is expected to turn **all 1024** cells
into `$41`, so an unconditional flood and a tile-respecting flood produce the
same count. A check should paint a small island of a **third** tile (`$42`,
made with `newTile`) inside the `$40` field, fill the field, and require the
island's cells to stay `$42`. The probe shows pristine 1020 cells / island
untouched vs mutant 1024 cells / island overwritten to `$41`.

**M05 — zoom changes the BAT data.** The zoom checks assert
`screenCanvas().map` (256/512/1024) and that the panel still paints; none
snapshots the map. Add, for each of the four chips: `mapCells(studio)` and
`JSON.parse(tiles.json).map.cells` captured before the click, and assert
byte-identical after it. The probe shows the mutant rewrites `map[1]` and
`map[32]` and commits the file; the pristine handler only redraws.

**M07 — the visible-screen outline is a cell low.** The stub canvas is a
no-op `Proxy` (`stubContext()` returns `() => {}` for every method), so
`rect`/`strokeRect` are unobservable in Node; the headless driver never reads
the outline either. Two ways to catch it: (a) make the stub context record
`rect()`/`strokeRect()` arguments and assert the outline's `y` is
`BYR * scale + 0.5` with the correct height (the probe's 0 vs 8); or (b) in
the browser, set BYR to a known value, redraw, and read the canvas pixels on
the expected outline row.

**M09 — the visibility counter counts the backdrop.** `check-examples.js`
has only a count (`whole > half` and `n >= box[4]`); it has no bounding box,
so counting every pixel makes both assertions trivially true. Add a negative
control: `countVisible()` on a backdrop-only frame must return **0** (the
probe's pristine 0 vs mutant 64), or add the bounding-box assertion that
`check-studio.js` already uses (`visibleBox`'s `box` equality is what would
catch the same removal there). Note the two sibling suites are asymmetric
here: `check-toys.js`'s `visibleIn` and `check-studio.js`'s `visibleBox` both
assert the sprite's box, so the break would be caught there; `check-examples`
is the one with counts only.

**M10 — the movement assertion accepts a still sprite.** The `byOne` loop is
hand-rolled inside `checkExamplesVisible`; there is no negative control. Add
one: run a still sprite source through the same assertions and require the
movement check to **fail** (the probe's still-sprite box array returns false
pristine, true mutant), or write the per-frame assertion directly
(`eq(right[i].box[0], SPR_X + i + 1)`), which a still sprite cannot satisfy.
Also assert a pad-released run leaves the box at `SPR_X`.

**M12 — the per-box threshold is 0.** `effectVisible` takes `box[4]` as the
lower bound and never checks it is positive. An all-backdrop region passes
`0 >= 0` (the probe's 1 assertion vs 0 pristine). Add a meta-assertion that
every `spec.visible` threshold is `> 0`, and a negative control where a box
the picture does not fill must fail; the current whole-frame
`whole > width*height/2` assertion still rejects a fully black frame, so
this is a lost *placement* check, not a lost black-screen check.

## Residual weaknesses

1. **The real-browser #84 evidence reads the map canvas, not the output
   frame.** The driver's `getImageData` is on `#scr-map`, which
   `screenDrawMap` paints from `tile.palette` and `tile.pixels` directly;
   `studio.output()` (the VDC frame through `pce-editor.toPicture`) is never
   read in the browser. M01 and M08 both pass the driver 38/38 while the
   stub's frame assertion fails. The map canvas is a second picture, and the
   driver proves the pointer plumbing and that second picture, not the frame
   the toy will show.
2. **The stub canvas records nothing.** M07 is the concrete consequence:
   grid, selection rectangle and visible-screen outline are all drawn into a
   `Proxy` whose every method is `() => {}`. A recording context in
   `stubContext()` would let the stub assert the selection and outline
   geometry without a browser.
3. **The #84 fixtures use one palette and one connected region.** The pencil
   test paints tile `$41` on palette 0, so a wrong palette nibble is caught
   only through the one expected white pixel (M01); there is no tile on a
   non-zero palette in the fixture. The fill fixture has one region (M02).
4. **The zoom checks assert dimensions, not data.** M05 passes by changing
   the BAT while keeping every canvas size. A one-line `mapCells` snapshot
   around each chip is the missing proof.
5. **The BXR/BYR checks test one direction each.** `scr-bxr-up`/`scr-byr-up`
   are exercised once; the `-` buttons, the `& 0x3FF`/`& 0x1FF` wrap and the
   combined/overlap case are not. M06 is caught by the `+` checks, but a
   bug that moves both registers on a `-` press would not be.
6. **`check-examples` has no visibility self-test.** M09 and M12 both pass
   because the three suites' helpers have different teeth: only
   `check-examples` is count-only. A tiny negative-control table (a
   backdrop-only frame counts 0; a black box fails its threshold) would
   protect the helper itself in all three copies.
7. **M11 is caught twice.** The unmodified expected state in
   `checkSpriteToy` uses the correct `pattern*64`, so the state comparison
   fires (40 vram + 40 pixels) as well as the 28 VISIBILITY checks. The #90
   story — a hand-built expectation that mirrors the wrong address — is not
   re-created here because the check was left unmodified; the visibility
   assertions do fire on their own, which is the property #90 added. To prove
   the visibility check alone, a mutant would also mirror the wrong layout in
   the expectation; that second edit is a change to the checker, so this
   review records the unmodified result.

## What the breaker did not touch

No source file in the shared working tree was edited; the mutants exist only
in `$TMPDIR/rev84/mut/`. No emulator was run. No OS-level keyboard or mouse
event was sent: the suites' own synthetic DOM events ran inside the check
process and headless Chrome. Scratch files and Chrome profiles are under
`$TMPDIR`, never `/tmp`.

## Reproducing

```
BASE=$TMPDIR/rev84/base           # git clone of origin at 15e354c
python3 -I $TMPDIR/rev84/mutate.py $BASE <id> $TMPDIR/rev84/mut/<id>
cd $TMPDIR/rev84/mut/<id> && node tests/check-studio.js --browser   # M01-M08, M10
                                         node tests/check-toys.js       # M11
                                         node tests/check-examples.js   # M09, M12
node $TMPDIR/rev84/probes.js <tree> <fill|countVisible|threshold|movement|zoom|outline>
```
