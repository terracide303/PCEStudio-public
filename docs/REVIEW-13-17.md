# Rule 2 breaker (#13/#17) — a different seat breaks the sprite and effect editors

Reviewer: @review (DeepSeek Flash seat). The builders of #13 (`2f69e79`) and
#17 (`5b1f711`) were different seats. Read cold: the repository only, no
briefing. Date 2026-10-28. **Nothing was fixed; this is the list.** Rule 2 in
[`../../workshop/RULES.md`](../../workshop/RULES.md): a test is proven by
breaks someone else chose.

The cards are #13 (sprite patterns, sprite palettes, the SAT) and #17 (the
scanline effect editor writing #15's raster table). The test that closes both
is `tests/check-editor.js`. The files read for breaks were
`renderer/pce-editor.js` and `renderer/editor.html`.

## What I ran

- **Baseline:** `node tests/check-editor.js` in the repo at `ebf4944` → exit 0,
  `PASS`, 21/21 refusals, 14/14 effect refusals, both Mednafen captures
  `diff 0`.
- **Sandbox:** the whole repo (13 MB, including `tests/dumps/`) copied to
  `$TMPDIR/review-13-17/base/` and a second copy at `.../work/`. The repo's own
  files were never edited: `git status --short` stayed at another seat's
  `M docs/PLAN.md` and the pre-existing `?? tools/.DS_Store`. No keyboard or
  mouse events were sent; nothing outside `$TMPDIR` was executed.
- **One break at a time:** restore `work/` from `base/`, apply exactly one
  edit (the script asserts the old string occurs exactly once before writing),
  then run the **unmodified** `tests/check-editor.js` in `work/`. Fourteen
  breaks: the seven sprite-side and six effect-side kinds the card names, plus
  one page-wiring break in `renderer/editor.html`.
- **Result classes:** `DETECTED` = the check exits non-zero and names the
  broken property; `MISSED` = the check exits 0 and still prints `PASS`;
  `NO-OP` = the edit changed no observable behaviour. There were no NO-OPs.
- **Miss confirmation:** each MISSED build was probed directly against the
  module (a small script requiring the pristine and the mutated
  `pce-editor.js`, or, for the page break, the source text) so a pass cannot
  be confused with an inert edit. The measured difference is quoted below.

## The table

| # | break, applied one at a time | side | check-editor.js | measured output |
|---|---|---|---|---|
| S1 | 65th-sprite guard `>= MAX_SPRITES` → `>` (65th accepted) | sprite | **DETECTED** | `a 65th sprite: accepted — it must be refused`; `FAIL: 2 problem(s)` |
| S2 | SAT words 0/1 swapped (Y↔X) | sprite | **DETECTED** | `208 line(s) where the editor budget and pce-sprites.js collectStrips disagree`; `sprite model vs renderer: 45251 differing bytes`; captured VRAM and SAT differ; `FAIL: 8 problem(s)` |
| S3 | 32×64 size code `cgx/cgy 1/2` → `2/1` | sprite | **DETECTED** | `64 line(s) … collectStrips disagree`; `3630 differing bytes`; captured VRAM/SAT differ; `FAIL: 6 problem(s)` |
| S4 | sprite palette 16 accepted (guard removed, range widened to 0..16) | sprite | **DETECTED** | `a 17th sprite palette in a SAT entry: accepted — it must be refused`; `FAIL: 3 problem(s)` |
| S5 | `LINE_STRIPS` 16 → 17 | sprite | **DETECTED** | `budget limit is 17 strips / 272 px, expected 16 / 256`; `line 200: 17 strips kept, 4 dropped; expected 16 and 5`; `FAIL: 6 problem(s)` |
| S6 | HFLIP/VFLIP bits dropped from the SAT attribute word | sprite | **DETECTED** | `sprite model vs renderer: 3246 differing bytes`; captured VRAM and SAT differ; `FAIL: 5 problem(s)` |
| S7 | SPBG (priority) bit dropped from the SAT attribute word | sprite | **DETECTED** | `12004 differing bytes`; `an SPBG=1 sprite over the opaque half was hidden (190,155)`; `FAIL: 7 problem(s)` |
| E1 | gradient denominator `line1-line0` → `+1` (last lines never reach `to`) | effect | **DETECTED** | `gradient line 5: word $124, expected $16d` (lines 5–7 wrong); `FAIL: 4 problem(s)` |
| E2 | wobble phase `speed*frame` → `speed*frame*2` | effect | **DETECTED** | `wobble speed 1, frame 1, line 0: bxr 10, expected 12` (all 8 lines); `FAIL: 9 problem(s)` |
| E3 | band end `line <= line1` → `<` (last line of every band lost) | effect | **DETECTED** | `bands: 222 entries, expected 224`; `line 111: bxr null, expected 10`; `line 223: bxr null, expected 1019`; `FAIL: 6 problem(s)` |
| E4 | band-overlap guard `line0 <= prev.line1` → `<` (bands that touch are accepted) | effect | **MISSED** | `PASS`; probe: `bands 0..111 @2 and 111..223 @1: ACCEPTED`, and `raster entries at line 111: [{"line":111,"rcr":175,"bxr":2}]` — one entry for a line two bands claim |
| E5 | `checkRegister` bound `value > max` → `>=` (legal maxima refused) | effect | **MISSED** | `PASS`; probe: pristine accepts BXR 1023 / BYR 511, mutant `refused register-range … got 1023` and `… got 511` |
| E6 | `toRaster` returns `entries.slice().reverse()` | effect | **MISSED** | `PASS`; probe: pristine `entry lines: 0,1,2,3,4,5,6,7`, mutant `entry lines: 7,6,5,4,3,2,1,0`, `strictly increasing: false` |
| H1 | `#cleargrad` handler calls `clearWobble` instead of `clearGradient` | page | **MISSED** | `PASS`; source at `renderer/editor.html:742`: `ed.clearWobble(pic)`; the file now has two `clearWobble` handlers and no `clearGradient` call at all |

**Result: 10 DETECTED, 4 MISSED, 0 NO-OP.**

The ten detected breaks were caught by the property they actually damage:
SAT/VRAM bytes and the independent sprite model for the sprite side; the
hand-computed per-line tables for the effect side. Several also failed the
committed Mednafen captures, because the capture is the correct build and the
mutant's VRAM/SAT no longer matches it.

## The four misses, and the check each needs

### E4 — touching bands are accepted (one line, two BXR writes)

`setParallaxBands` sorts the bands and refuses only when
`sorted[i].line0 <= sorted[i-1].line1`. Changing `<=` to `<` lets bands that
share exactly one boundary line through: `{0..111, speed 2}` and
`{111..223, speed 1}` is accepted, and `toRaster` then emits a single entry
for line 111 with band 0's BXR (2), silently losing band 1's first line.
The test's one overlap case (`0..111` and `100..200`) still overlaps
internally under the mutant (`100 < 111`), so it is refused and the check
passes. **Check that would catch it:** a refusal case with bands that share
exactly one line — `[{line0:0,line1:111,speed:2},{line0:111,line1:223,speed:1}]`
must raise `raster-line-full` — and, after a legal setup, an assertion that no
two accepted bands' inclusive ranges intersect (the boundary line counts).

### E5 — the legal maximum register values are refused

`checkRegister` is the gate for BXR/BYR in `setScroll` and `toRaster`.
Changing `value > max` to `value >= max` turns BXR 1023 and BYR 511 — both
legal (10-bit and 9-bit registers) — into `register-range` refusals. The test
only asserts that max+1 is refused (BXR 1024, BYR 512), which the mutant still
does, so it passes. **Check that would catch it:** positive boundary cases
next to the existing negative ones — `setScroll({BXR:1023})` and
`setScroll({BYR:511})` must be accepted, and `toRaster` must build with
`base.bxr === 1023`, `base.byr === 511` — plus a max+1 case for each, which
the test already has.

### E6 — `toRaster` entries come back in descending line order

Reversing the returned `entries` array leaves the table semantically usable
by today's preview only because `pce-bg.js` sorts entries defensively
(`buildRows`, `renderer/pce-bg.js:154`), and `entryAt()` in the test searches
by line rather than position. But #15's table contract is
**entries' lines strictly increasing** (`docs/RENDERER.md`, the save-state
invariant), and #16's viewer will consume this table; a consumer that arms
RCR in array order would arm line 7 first. The check never inspects order.
**Check that would catch it:** after each effect table is built, assert
`table.entries[i].line > table.entries[i-1].line` for every `i`, and that the
first/last entries are the documented range endpoints — an order assertion,
not another by-line lookup.

### H1 — the page's "Remove" button clears the wrong effect

`renderer/editor.html`'s `#cleargrad` click handler calls `ed.clearWobble(pic)`.
Pressing "Remove" under the gradient therefore wipes the wobble and leaves the
gradient in the table (and the page now has two `clearWobble` handlers and no
`clearGradient` call). `tests/check-editor.js` never reads `editor.html` at
all — it loads only `pce-editor.js` (as CommonJS and as a browser global) —
so every handler in the page is unproven by this test, as the check's own
header says ("the page's event wiring is read, not executed").
**Check that would catch it:** execute the page, not just the module — load
`renderer/editor.html` in a headless browser or DOM harness, set both a
gradient and a wobble through the page's controls, click `#cleargrad`, and
assert the gradient is gone and the wobble is still present (and the mirror
case for `#clearwob`). A cheaper static test could assert that each Remove
button's handler calls its own `clear*` function, but only the executed
version proves the wiring.

## What this does and does not prove

The check proves well the things the two cards name: every documented refusal
code, the SAT and VRAM bytes against an independent model and Mednafen, the
six sprite sizes/flips/priority/16-strip budget, and the three effects against
hand-computed per-line tables. The four misses are all at the edges of those
properties: one boundary-sharing band case (E4), the legal ends of a register
range (E5), the *order* of a returned table that a defensive renderer hides
(E6), and the page's own control wiring, which the check does not load at all
(H1). Per rule 2, each is a new card routed one kind up from the test's
builder; none should be closed over by the existing result.
