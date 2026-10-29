# #106 — REVIEW-84's six misses, and the checks that now catch them

Card #106. Work by @test. The breaker (`docs/REVIEW-84.md`, @review) broke
the SCREEN cell-map editor (#84) and the sprite example's visibility guards
(#90) twelve ways: six DETECTED, six MISSED. This card adds a check for each
miss, re-runs the six exact breaks against the new checks, and writes down
what the new checks still cannot see.

Baseline at the commit this adds to (`fa81607`), in the working tree:

- `node tests/check-studio.js` — `PASS 691 checks` (now 720).
- `node tests/check-examples.js` — `PASS 4313 checks` (now 4331).
- `node tests/check-toys.js` — `PASS 831 checks` (unchanged, run green).
- `node tests/check-studio.js --browser` — `PASS 763 checks … headless
  Chrome: PASS 40 + driver 38/38` (the driver is untouched).

## What was added

### M02 — the bucket leaks past a different tile (`check-studio.js`)

The old fill fixture filled a map that was one connected region of `$40`, so
an unconditional flood and a tile-respecting flood both produced 1024 cells
of `$41`. The fixture now makes a second tile (`$42`), pencils a 2×2 island of
it into the `$40` field, fills from (25,25), and requires the island's four
cells to stay `$42` and the rest of the connected region to be `$41` (1020 of
1024). The failure message prints both counts.

### M05 — a zoom chip writes the zoomed image into the BAT (`check-studio.js`)

The zoom checks asserted canvas dimensions (256/512/1024) and that the panel
still painted; none looked at the BAT. Around each of the four chips the
check now snapshots the map's 1024 cells and `tiles.json`'s own source and
requires both byte-identical after the click. The failure prints how many
cells changed.

### M07 — the visible-screen outline is drawn one cell low (`check-studio.js`)

The stub canvas was a Proxy whose every method returned `() => {}`, so
`rect()` (the outline) and `strokeRect()` (the selection) were unobservable,
and the headless driver never reads the outline. `stubContext()` now records
each method's name and arguments in `__calls`, and each element keeps one
context (as a real canvas does), so the evidence can read geometry back. The
outline's first row is computed independently from BYR — `cell =
floor((rect.y - 0.5) / scale / 8)` must equal `floor(BYR / 8)` — at BYR 1
and BYR 9 (neither a multiple of 8, so a constant shift cannot hide in the
rounding), with the height checked against the picture's window and the
full-width x pinned.

### M09 — the visibility counter counts the backdrop (`check-examples.js`)

`countVisible` is put through a frame that is nothing but the backdrop: it
must return 0. The backdrop colour is deliberately not black (CRAM[0] =
`$00F5`), so a zero cannot come from a black frame by accident, and the same
counter must count exactly 1 for one known non-backdrop pixel and honour the
box's edges — so a counter that always returns 0 also fails.

### M10 — the movement assertion accepts a still sprite (`check-studio.js`)

The hand-rolled `byOne` loop became one function, `movesByPad(frames, dir,
fromX)`, used by both the moving run and a control: ten frames with **no pad
held** must make it return false (checked for both directions). The control
also asserts the block stood still at (SPR_X, SPR_Y) for those ten frames.

### M12 — the per-box threshold is 0 (`check-examples.js`)

The comparison moved into `boxFilled(n, box)`, which `effectVisible` uses for
every box. A box the picture does not fill must fail; one pixel short of the
threshold must fail; exactly at it must pass. Every example's thresholds are
asserted above zero and pinned to their exact current values
(`8000/8000/8000/8000,20000,15000,4000,15000/15000`).

## The six re-runs

Run in a scratch copy (`git archive HEAD` under `$TMPDIR/rev106/` plus this
commit's two test files); each break is the review's single edit, asserted to
occur exactly once; the working tree was not mutated. DETECTED = the
unmodified check exits non-zero.

| # | break (the review's edit, re-applied) | check | result | measured output |
|---|---|---|---|---|
| M02 | `floodCells` pushes every unseen neighbour | `check-studio.js` | **DETECTED** | exit 1: `the bucket stops at a different tile (the island's 0 cells stay $42)`; `1024 of 1024 cells are $41` |
| M05 | the 2× chip resamples the map into itself and commits | `check-studio.js` | **DETECTED** | exit 1: `zooming to 2x leaves the BAT's cells unchanged (28 of 1024 cells changed)`; `tiles.json byte for byte unchanged` fails |
| M07 | `y0 = (BYR + 8) mod 256` | `check-studio.js` | **DETECTED** | exit 1: `outline starts on the cell BYR 1 names (cell 0, drawn at 1)`; BYR 9: `cell 1, drawn at 2`; `the outline is 240 lines tall at BYR 9` fails |
| M09 | `countVisible` stops skipping the backdrop | `check-examples.js` | **DETECTED** | exit 1: `a backdrop-only frame counts 0 … (got 256, want 0)`; `one non-backdrop pixel counts 1 (got 256)`; both box edges fail |
| M10 | `movesByPad` requires only that `box` exists | `check-studio.js` | **DETECTED** | exit 1: `the movement assertion FAILS on a still sprite (the control)`; and read as left |
| M12 | `return n >= box[4]` → `return n >= 0` | `check-examples.js` | **DETECTED** | exit 1: `a box the picture does not fill FAILS its threshold (0 of 4000)`; `one pixel short … FAILS` |

The same six edits applied to **the pre-#106 test files** (the same
bytes at `87c1a8d` and `fa81607`) each
still exit 0 — `PASS 691 checks` / `PASS 4313 checks` — so it is the new
checks that catch them, not a change elsewhere in the tree.

## What these checks do not prove

- **M05 proves the data, not the draw.** It shows the BAT and `tiles.json`
  are unchanged after a chip; a chip that did nothing at all would pass
  (dimensions are asserted, but not that the canvas was repainted). Only the
  32×32 BAT is covered; the other MWR sizes are part B and unbuilt.
- **M07 reads recorded calls, not rendered pixels.** It proves the geometry
  handed to `rect()`, not what a real canvas rasterizes (stroke width,
  colour, clipping). Only the first outline rectangle is read; the
  wrap-around second rectangle is not. **BXR is unreachable here**: the
  window is exactly the map's 256 dots wide, so a horizontal cell bug cannot
  be seen until a wider map (MWR ≠ `$00`) exists — the check pins the
  full-width x, but that is all BXR can be said to do.
- **M02 is one island of four cells, orthogonally surrounded.** It proves the
  flood checks the neighbour's character; it does not enumerate other shapes,
  a fill started on the island itself, or the map's edges.
- **M09/M12 test the helpers, not the examples' pictures.** The control
  frames are built in the check. They prove the counter and the comparison
  reject the bad case; they do not prove any example's count still matches
  what its picture looks like. A picture that shrank but stayed above the
  pinned threshold would pass, and the thresholds are pinned to today's
  numbers.
- **M10's still control is the same toy with no key held.** It proves the
  assertion rejects a stationary block on this sprite example; it does not
  cover up/down, a second sprite, or a run that moves by a different row.
  It also depends on the left run returning the block exactly to
  (SPR_X, SPR_Y), which is asserted separately.
- **The breaks are the review's; the new checks are only this seat's.** Rule
  2 is satisfied for the six *breaks* — @review chose them — but the six new
  *checks* have not themselves been cold-broken by a third seat beyond these
  exact edits. A different weakening of `movesByPad` or `boxFilled` that
  still satisfies the controls is not ruled out.
- **The recording stub is now on every canvas.** No check asserted on
  `__calls` before this; the risk is that geometry elsewhere is quietly
  recorded and never read. It does not change what any canvas draws (every
  method is still a no-op), and all 720 stub checks pass.
- **REVIEW-84's residual 1 is untouched.** The real-browser driver still
  reads the map canvas, not the output frame, and the new M05/M07 evidence is
  the stub DOM. The driver itself still passes 38/38.
