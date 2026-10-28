# Rule 2 breaker (#26) — the model's panels, broken 25 ways

Reviewer: @review (DeepSeek Flash seat). The builder of #26 (`174079b`) was a
different seat. Read cold: the repository only, no briefing. Date 2026-10-28.
**Nothing was fixed; this is the list.** Rule 2 in
[`../../workshop/RULES.md`](../../workshop/RULES.md): a test is proven by
breaks someone else chose.

The card is #26, "the model's panels": the VDC registers per line, the VCE
palettes, the VRAM map, the SAT table and follow-a-pixel. The test that closes
it is `tests/check-panels.js`; the code under break is
`renderer/pce-panels.js`, plus the two functions it borrows,
`renderer/pce-bg.js`'s `backgroundPixel`/`buildRows` and
`renderer/pce-sprites.js`'s `collectStrips`/`spriteCells`.

## What I ran

- **Baseline:** `node tests/check-panels.js` in a pristine copy of `174079b`
  → exit 0: `PASS: the panels are drawn from the renderer's model — 30910
  checks, 1320 follow-a-pixel traces across 8 dumps, 8 SAT entries in use`.
  `node tests/check.js` → exit 0, 51 scenes diff 0.
- **Sandbox:** the commit's tracked tree extracted with
  `git archive 174079b` into `$TMPDIR/pcestudio-review26/base/` (6 MB, the
  eight dumps included). Each break got its own copy under `.../runs/`. The
  real repository was never edited: `git status --short` in it still shows
  only the other seats' `M tools/*` and `?? tests/dumps/raster6-10/`. The
  reviewed card is the committed tree, not the dirty working tree.
- **One break at a time:** copy `base/`, apply exactly one source-string
  substitution (the script asserts the old string occurs exactly once before
  writing), then run the **unmodified** `tests/check-panels.js`. When the
  substituted file is `pce-bg.js` or `pce-sprites.js` (shared renderer code)
  the unmodified `tests/check.js` was also run.
- **Result classes:** `DETECTED` = `check-panels.js` exits non-zero and names
  the broken property (check.js additionally run, and reported, for shared
  code); `MISSED` = `check-panels.js` exits 0 and still prints `PASS`;
  `NO-OP` = the check passes *and* a full differential probe finds no
  observable change. There were no NO-OPs.
- **Miss confirmation:** every miss was also probed directly. A script loads
  the pristine and mutant modules side by side and digests the whole panel
  output on the eight dumps and the editor's two pictures: `registerLines`,
  `vramMap`, `satTable`, `vcePalettes` (per line), `vdcRegisters`, every
  field of every `followPixel` record (every pixel of a sprite-bearing dump,
  a grid on the others), and the `renderIndices` buffers the panels claim to
  share. Each MISSED row below quotes a concrete value from that probe, so a
  PASS cannot be confused with an inert edit.

## The table

| # | file | break, applied one at a time | result | measured output |
|---|---|---|---|---|
| P01 | pce-panels.js | `followPixel` drops the BG-colour-0 rule (`sprite.spbg \|\|` only) | **DETECTED** | `raster5 px(188,179) layer: got "blanking", expected "sprite"`; 3 chosen pixels on the SPBG=0 sprite |
| P01b | pce-panels.js | `followPixel` lets any sprite win (`if (sprite)`) | **DETECTED** | `editor sprite demo px(168,160) layer: got "sprite", expected "background"`; 3 pixels; probe: only `editor.sprite` changes |
| P02 | pce-panels.js | sprite index loses the +16 palettes (`(palette<<4)\|pix`, no `0x100`) | **DETECTED** | `sprite1 px(32,1) colour index: got 20, expected 276`; word 140 vs 396; RGB 36,72,144 vs Mednafen 36,216,144 |
| P03 | pce-panels.js | `SAT_WORDS` 256 → 255 | **DETECTED** | `SAT is 255 words, expected 256` on all eight dumps; 8 map digests differ |
| P04 | pce-panels.js | BYR row shows the +1-effective Y instead of the register | **DETECTED** | `scene1 px(0,0) BYR: got 1, expected 0` (vdwLine0 is 1 on this crop) |
| P04b | pce-panels.js | `BG_YOffset` reports the raw BYR (drops the +1 and the line offset) | **DETECTED** | `scene1 px(0,0) BG_YOffset: got 0, expected 1`; colour index 7 vs 3 |
| P05 | pce-panels.js | `registerLines` uses the saved frame CR, not the row's CR | **DETECTED** | `raster5 ... line 1 CR 68, raster says 196`; 1 problem in 30910 checks |
| P06 | pce-panels.js | VCE panel swaps red and green | **MISSED** | `PASS … 30910 checks`; probe: scene1 palette 0 entry 2 `word 14` base `r36 g0 b216` → mutant `r0 g36 b216`; all 8 VCE tables + the editor's differ |
| P07 | pce-panels.js | SAT table reads X and Y swapped | **MISSED** | `PASS … 30910 checks`; probe: sprite1 entry 0 `{y:66,x:40}` → `{y:40,x:66}`; sprite1/raster5/editor SAT digests differ |
| P08 | pce-sprites.js | `spriteCells` 32-wide halves +1 (`pair+1`,`pair+2`) | **MISSED** | `PASS … 30910 checks`; check.js `PASS … 51 scene(s)`; probe: sprite1 entry 3 cells `[144,145]` → `[145,146]`; map and SAT digests differ |
| P09 | pce-sprites.js | `collectStrips` picks the odd cell as a CGX left half | **DETECTED** | `sprite1 px(127,1) colour index: got 332, expected 331`; check.js `sprite1: 3758 differing pixels`, `spainted: 6288` |
| P10 | pce-panels.js | blanking index `0x100` → `0x000` | **DETECTED** | `raster5 px(0,199) colour index: got 0, expected 256`; word 511 vs 73; RGB 252,252,252 vs Mednafen 36,36,36 |
| P11 | pce-panels.js | sprite gate uses the saved frame CR, not the row's CR | **DETECTED** | `raster5 px(8,102) layer: got "sprite", expected "background"` |
| P12 | pce-panels.js | SAT table reads SPBG from the CGX bit | **DETECTED** | `sprite1 ... entry 0 palette/flags do not match its words`; 6 sprite1 entries + raster5 entry 0 |
| P13 | pce-panels.js | `vdcRegisters` drops the last register (19 rows) | **DETECTED** | `19 registers, expected 20` on raster1/raster4/raster5 |
| P14 | pce-panels.js | follow decodes through row 0's colour table, not the row's | **DETECTED** | `raster4 px(100,17) colour word: got 114, expected 115`; RGB 216,36,72 vs Mednafen 216,36,108 |
| P15 | pce-panels.js | RCR chain base `0x40` → `0x3f` | **DETECTED** | `raster1 ... line 1 chain arm 223, expected 224` |
| P16 | pce-panels.js | follow's embedded `vdc` list is always row 0's | **MISSED** | `PASS … 30910 checks`; probe: raster1 row 159 true RCR 225, base follow 225, mutant 224; raster1/raster4/raster5 follow digests differ |
| P17 | pce-bg.js | `backgroundPixel` reports `tileWord = addr + 8` (the second plane) | **MISSED** | `PASS … 30910 checks`; check.js `PASS … 51 scene(s)`; probe: scene1 px(0,0) `tileWord` 1025 → 1033 (base `char 64`); all 8 follow digests differ |
| B01 | pce-bg.js | BAT entry chosen one pixel column late | **DETECTED** | `scene1 px(7,0) BAT word: got 7939, expected 64`, colour index 0 vs 15; check.js `browser1: 10672 differing pixels` |
| B02 | pce-bg.js | BAT character masked to 11 bits (`0x7ff`) | **DETECTED** | `scene1 px(31,0) character: got 1801, expected 3849`; check.js `scene9: 67046 differing pixels` |
| B03 | pce-bg.js | BAT palette taken from bits 11-14 instead of 12-15 | **DETECTED** | `scene1 px(31,0) palette: got 7, expected 3`; check.js `browser1: 34618 differing pixels` |
| B04 | pce-bg.js | tile row counter `& 15` instead of `& 7` | **DETECTED** | `scene1 px(0,7) colour number: got 10, expected 8`; check.js `browser1: 26192 differing pixels` |
| S01 | pce-sprites.js | `paintLine` ignores HFLIP | **DETECTED** | `editor sprite demo px(63,100) colour index: got 391, expected 394`; check.js `sprite2: 2448`, `spainted: 2176` differing pixels |
| S02 | pce-sprites.js | `collectStrips` ignores VFLIP | **DETECTED** | `editor sprite demo px(127,100) colour index: got 422, expected 427`; check.js `sprite2: 2492`, `spainted: 1680` differing pixels |

**Result: 20 DETECTED, 5 MISSED, 0 NO-OP.**

Every DETECTED break fails `check-panels.js` itself. `check.js` additionally
fails for the five shared-renderer breaks that change the picture (P09,
B01-B04) and for the two flip breaks (S01/S02). It passes for P08 and P17,
as expected: those two shared-file functions are consumed only by the panels,
not by `renderIndices`, so the diff test has nothing to see.

## The five misses, and the check each needs

### P06 — the VCE panel's red and green channels are swapped

`vcePalettes` builds each entry with `r: rgb[i*3], g: rgb[i*3+1]`; the break
swaps those two source indexes. Every word is unchanged, so the test passes.
Probe: scene1, palette 0 entry 2, `word 14`; pristine `r 36, g 0, b 216`,
mutant `r 0, g 36, b 216`. Ten of ten checked colour tables differ.

Why it passes: `checkVce` compares only `g.word` with the independent per-line
word. The test's only RGB oracle is the Mednafen comparison inside
`checkFollow`, which reads `followPixel`'s colour — a different code path from
`vcePalettes`. Nothing compares the panel's `r/g/b`.
**Check that would catch it:** in `checkVce`, derive the three channels from
the word under the VCE rule already used by the independent `cramEntry`
(`R = 36*((w>>3)&7)`, `G = 36*((w>>6)&7)`, `B = 36*(w&7)`) and assert
`g.r`, `g.g`, `g.b` for every palette and entry on every checked row; also
assert `g.index === p*16+e`, `g.palette === p` and `g.entry === e`, which are
likewise unchecked.

### P07 — the SAT table reads X and Y swapped

`satTable` fills `y: w0 & 0x3FF, x: w1 & 0x3FF`; the break swaps the two
sources. Probe: sprite1 SAT entry 0 (words `[66, 40, 256, 128]`), pristine
`{y: 66, x: 40, row0: 2, leftX: 8}`, mutant `{y: 40, x: 66, row0: 2,
leftX: 8}`. The four raw words, sizes, flags and pattern are all unchanged, so
`checkSat` passes.

Why it passes: `checkSat` compares the raw words, `empty`, height/width, the
cell **count**, palette/SPBG/HFLIP/VFLIP and `pattern`; it never reads `y`,
`x`, `row0` or `leftX`, which are the display coordinates the panel exists to
show. `row0` and `leftX` are unchecked for the same reason (an off-by-one in
either would also pass).
**Check that would catch it:** in `checkSat`, assert
`got.y === (want[0] & 0x3FF)`, `got.x === (want[1] & 0x3FF)`,
`got.row0 === got.y - 64` and `got.leftX === got.x - 32` for all 64 entries,
using the `sat.bin` words the test already loads.

### P08 — the 32-wide sprite cells are named one cell too high

`spriteCells`, for CGX, pushes `pair` and `pair|1` after masking the block
base to even; the break pushes `pair+1` and `pair+2`. Probe: sprite1 SAT entry
3 (CGX) cells `[144,145]` → `[145,146]`, and `satTable`'s cells follow. Both
tests pass.

Why it passes: `spriteCells` is used only by `pce-panels.js`
(`patternCells`, `satTable`), never by `renderIndices`, so `check.js` cannot
see it. `checkSat` compares `got.cells.length` with the independently
computed count (2) but not the values. Worse, `checkVramMap`'s SAT-cell
assertion is self-referential: it feeds `panels.patternCells` (which calls the
mutated `spriteCells`) into the same map that `groupCells`/`derivedPatterns`
built from that function, so the map agrees with its own mistake.
**Check that would catch it:** (a) in `checkSat`, derive the cell list
independently from the raw words — `base = p & CGY_MASK[cgy]`, blocks
`[0,2,4,6].slice(0, [1,2,4,4][cgy])`, and for CGX push
`pair = (base+b) & ~1` then `pair|1`, else `base+b` — and compare
`got.cells` element by element, not just its length. (b) in `checkVramMap`,
replace the `panels.patternCells` input with that independently derived cell
set: every cell's 64 words must sit wholly inside a segment whose kind names
sprite patterns, and (where `regions.json` does not already cover them) the
union of the map's sprite-pattern words must equal the independent cells'
words. That removes the tautology.

### P16 — follow-a-pixel's register block is always row 0's

`followPixel` embeds `vdcRegisters(st, y)`; the break passes `0` instead of
`y`. Probe: raster1 row 159 (line 160), the true per-row RCR is **225**;
pristine `followPixel(...).vdc` RCR is 225, mutant 224 (row 0's). The
`registers` object beside it still carries the right per-row BXR/BYR/CR, so
all the fields `checkFollow` does read stay correct.

Why it passes: `checkFollow` checks `got.line` and the four fields of
`got.registers` (BXR, BYR, CR, BG_YOffset) but never reads `got.vdc` — the
20-register list embedded in every trace. `checkRegisterLines` tests
`vdcRegisters` only at row 0, where the mutant is correct.
**Check that would catch it:** in `checkFollow`, deep-compare `got.vdc`
against an expected 20-row record for that row: length 20; `CR`, `BXR`, `BYR`
from the independent row; `RCR` from the chain arm (`row.rcr`); the
state/viewer fallbacks from the documented sources; and each `.source`. On
the raster dumps, pick a row whose values differ from row 0 (the independent
model already has them) so the assertion has teeth. The same block also
protects the RCR chain in the follow record, which today is only checked by
`checkRegisterLines` at row 0.

### P17 — follow-a-pixel's background `tileWord` names the second plane

`backgroundPixel` documents `tileWord` as "the first plane; the second is
`addr + 8`"; the break reports `addr + 8`. Probe: scene1 px(0,0), `char 64`;
pristine `tileWord 1025`, mutant `1033`. Both tests pass.

Why it passes: `checkFollow` checks `gb.batWord`, `gb.batIndex`, `gb.char`,
`gb.palette`, `gb.colourNumber`, `gb.tileRow`, `gb.tileColumn` — but not
`gb.tileWord` (nor `gb.beyondVram`). The renderer uses only `backgroundPixel`'s
`.index`, so `check.js` is blind as well.
**Check that would catch it:** in `checkFollow`, assert
`gb.tileWord === want.background.char * 16 + want.background.tileRow` (the
first plane word) and
`gb.beyondVram === (want.background.char >= 0x800)`. The independent model
already computes `char`, `tileRow` and `beyondVram`.

**General shape of all five:** `checkFollow` reads a hand-picked subset of a
record with about 35 fields (and `checkSat`/`checkVce` do the same for their
records). A deep comparison against the independent model's full record, plus
the five targeted assertions above, would close this whole class rather than
these five instances.

## What the test genuinely proves — and where the eight dumps lean on the editor

The pixel path is strong: every break in `backgroundPixel`'s BAT/tile decode,
the per-line BXR/BYR/CR/BG_YOffset values, the BB/SB gates, the blanking
index, the sprite priority rule in the colour-0 direction, the 16-strip CGX
collection, and the per-line colour table were caught with a pixel and a
value named. `scene4` (64-wide BAT), `scene9` (characters ≥ `$800`),
`raster4` (per-line colour) and `raster5` (per-line CR + blanking) each did
the job the card claimed.

Two coverage facts are worth writing down even though they are not MISSED
rows, because they show the eight dumps are weaker than the headline:

- **No dump among the eight carries a flipped sprite.** Measured over their
  SATs: `sprite1` and `raster5` (the only sprite dumps in the list) have zero
  HFLIP and zero VFLIP entries. `sprite2`, `sprite7` and `spainted` do, but
  they are not in `check-panels`'s dump list. S01/S02 are DETECTED only
  because `check-panels` additionally drives the editor's
  `spriteDemoPicture`, which carries flips; check.js supplies the Mednafen
  witness for the shared renderer. Remove that editor case and the panel test
  loses its only panel-side flip witness.
- **The "background wins over an SPBG=0 sprite" direction is not in the
  eight dumps.** P01 (drop the colour-0 rule) is caught on `raster5`, whose
  one SPBG=0 sprite sits over blanking (`0x100`, low nibble 0). P01b (let any
  sprite win) changes **only** `editor.sprite` — no dump pixel exercises an
  SPBG=0 sprite over an opaque background. `sprite10` (SPBG=0 over an opaque
  colour-7 tile) is the captured scene for that direction; `sprite3`/`sprite8`
  also carry SPBG=0 sprites. Adding one of them to the dump list would make
  the dump half of the test prove priority in both directions.

## What this means for #26

Under rule 2, **#26 is not proven**: a different seat chose 25 breaks and
five still pass the closing test. The `PROVEN` line committed in `4204fb0`
(one minute after the panel commit, before any breaker ran) is premature;
`docs/CAPABILITY.md` should read "breaker: 20/25, 5 misses → new card" (or go
back to UNTESTED) until the five checks above land. Per rule 2 the misses
route one kind up from the test's builder: one card for the five checks and
the two dump-coverage additions (`sprite10`/`sprite3` for the SPBG=0-over-
opaque direction, `sprite2`/`spainted` for flips). This review commits only
this file, so the card and `CAPABILITY.md` are left for the seat that owns
them.

**What is left:** the five checks; the two dump additions; then re-run these
25 breaks and require 25 DETECTED. Check.js is already green on all 51
scenes, so none of the five is a renderer regression — they are panel-only
or panel-consumed fields, and they can be fixed or checked without touching
the picture.

## Reproducing

```sh
git archive 174079b | tar -x -C "$TMPDIR/pcestudio-review26/base"
# per break: copy base/ -> runs/<id>/, substitute exactly one string, then
cd runs/<id> && node tests/check-panels.js          # card's test
# when pce-bg.js or pce-sprites.js changed:
node tests/check.js                                 # shared renderer
# miss confirmation: digest every panel output on the eight dumps and the
# editor models with the pristine and the mutant tree side by side; the five
# concrete values quoted above come from that probe.
```

The baseline and every mutant run used the committed `174079b` tree; nothing
in the working repository was edited, and no keyboard or mouse input was
sent.
