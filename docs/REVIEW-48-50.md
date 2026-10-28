# Rule 2 breaker (#48, #49, #50, #27) — window, DMA, status lines and wide modes, broken 16 ways

Reviewer: @review (DeepSeek Flash seat). The builders of #48 (`b144d8e`),
#49 (`4ced2da`), #50 (`dc5b71e`) and #27 (`12a87b2`) were different seats.
Read cold: the repository only, no briefing. Date 2026-10-28. **Nothing was
fixed; this is the list.** Rule 2 in
[`../../workshop/RULES.md`](../../workshop/RULES.md): a test is proven by
breaks someone else chose.

The cards are #48 ("the display window and the border"), #49 ("VRAM-to-VRAM
DMA"), #50 ("the VDC's status lines") and #27 ("wide modes: 256, 336 and
512 px"). The files under break are `renderer/pce-bg.js`,
`renderer/pce-vram.js` and `renderer/pce-sprites.js`; the instruments are
`tests/check.js` (#48, #27), `tests/check-dma.js` (#49) and
`tests/check-status.js` (#50).

## What I ran

- **Pinned tree:** a pristine copy of HEAD `34f4c05`, made with
  `git archive` into `$TMPDIR/pce-review-base` (no working-tree files, so
  no other seat's in-progress edits are in it). The three renderer files
  are byte-identical to the tree the cards closed on: `git log
  12a87b2..34f4c05 -- renderer/pce-bg.js renderer/pce-sprites.js
  renderer/pce-vram.js` is empty (`pce-bg.js`/`pce-sprites.js` last changed
  at `12a87b2`, `pce-vram.js` added at `4ced2da`). Later commits did add
  dumps (`raster12`, `vraster12`, …), so the baseline is the current suite,
  not the counts in the card notes.
- **Baseline, unmodified:** `node tests/check.js` exit 0, `PASS: renderer
  matches Mednafen pixel for pixel on 83 scene(s)` (`us1` skipped as a
  non-picture); `node tests/check-dma.js` exit 0, `PASS: 3 VRAM-to-VRAM DMA
  capture(s)…`; `node tests/check-status.js` exit 0, `97 checks on 85
  dumps` (58 save states compared register-for-register, 27 read-cleared
  raster chains).
- **Sandbox:** each break was applied to a fresh copy of the archive in
  `$TMPDIR/pce-review-work` (rsync `--delete` from the pristine copy before
  every run). A Python harness asserts the target string occurs exactly
  once in the copy, substitutes it, and runs the **unmodified** check. The
  real repository was never edited; no Mednafen run, ROM rebuild, keyboard
  or mouse event was needed.
- **Result classes:** `DETECTED` = the unmodified check exits non-zero and
  names the broken property. `MISSED` = the check exits 0 and prints
  `PASS`, and a direct probe on the mutant then shows it changes behaviour
  on a legal input no fixture reaches. `NO-OP` = the check passes and the
  changed code cannot change behaviour for any legal input. There are no
  NO-OPs here: every one of the four misses is live on an input class the
  suite does not have.
- **One break at a time.** No capture was rebuilt; every mutant ran against
  the committed dumps.

## The table

Counts: **16 breaks — 12 DETECTED, 4 MISSED, 0 NO-OP.** (#48: 4/4 caught;
#49: 3/4 caught; #50: 2/4 caught; #27: 3/4 caught.)

| # | card | file | break, applied one at a time | result | measured output |
|---|---|---|---|---|---|
| W01 | #48 | pce-bg.js | HDS off by one: `(hds + 1) * 8` → `hds * 8` (window one character left) | **DETECTED** | `check.js` exit 1, 83/83 scenes: `browser1: renderer window x[-8,248) y[-1,239) != the registers' x[0,256) y[-1,239)`; `FAIL: 83 scene(s) differ` |
| W02 | #48 | pce-bg.js | border fills outside the window paint CRAM[$000] (backdrop) instead of CRAM[$100] | **DETECTED** | exit 1: scene11 6144, scene12 8448, scene13 22272, scene14 25344, wide336 3480 differing pixels; `FAIL: 5 scene(s) differ` |
| W03 | #48 | pce-bg.js | VDW+1 ignored: `y1 = vdw - vdwLine0 + 1` → `vdw - vdwLine0` | **DETECTED** | exit 1, 83/83 scenes: `y[-1,238) != the registers' … y[-1,239)`; `FAIL: 83 scene(s) differ` |
| W04 | #48 | pce-bg.js | VDS shift ignored: VDS hardwired to 15 and the RCRCount calibration dropped | **DETECTED** | exit 1, 2 scenes: scene11 `y[-1,223) != y[7,231)`, scene12 `y[-1,239) != y[11,251)`; `FAIL: 2 scene(s) differ` |
| D05 | #49 | pce-vram.js | length off by one: `words = len + 1` → `words = len` | **DETECTED** | exit 1, 3/3: dma1 1 word differs at `$09ff`; `SOUR ends $8ff, captured $900`, `DESR $9ff != $a00`, `LENR $0 != $ffff`, 91 frame bytes; dma2/dma3 same shape |
| D06 | #49 | pce-vram.js | decrement flags swapped: SI/D read from bit 3 and DI/D from bit 2 | **MISSED** | exit 0, `PASS: 3 VRAM-to-VRAM DMA capture(s)…`. Probe: captured DCR `$1c` (both bits set) → 0 words differ; DCR `$14` (SI/D only) → 382 words differ, `SOUR $8ff/$9ff` pristine vs `$aff/$7ff` mutant |
| D07 | #49 | pce-vram.js | overlap copied in the wrong direction: snapshot the source first (memmove) | **DETECTED** | exit 1: dma3 448 words differ, first `$0980` captured `$98a0` model `$9088`; 30777 frame bytes; `FAIL: 1 DMA capture(s) differ` |
| D08 | #49 | pce-bg.js | transfer applied a frame late: `opts.dma` not applied in `renderIndices` | **DETECTED** | exit 1, 3/3: dma1 13880, dma2 14544, dma3 34185 differing frame bytes |
| S09 | #50 | pce-sprites.js | OR set at 16 instead of 17: `requested > 16` → `>= 16` | **MISSED** | exit 0, `PASS … 97 checks on 85 dumps`. Probe: 16 opaque strips on a line → pristine `overflow=false`, mutant `true` |
| S10 | #50 | pce-sprites.js | CC ignores transparency: every covered column is marked opaque, not only non-zero pixels | **MISSED** | exit 0, same `PASS`. Probe: transparent sprite #0 pixel over an opaque #1 pixel with no opaque overlap → pristine `collision=false`, mutant `true`; opaque/opaque control `true` in both |
| S11 | #50 | pce-sprites.js | VD never set: per-line VD false, frame VD false, `vdBit` never latches | **DETECTED** | exit 1, 86 problems/97: every dump `frame VD: model false, oracle true`; `sprite4 with CR=$CF: CC+OR+VD … got 3, expected 35` |
| S12 | #50 | pce-sprites.js | RR ignored: raster entries and the saved RCR dropped, `rr` all zero | **DETECTED** | exit 1, 28 problems/97: `row 0 (VDW line 1) RR: model false, oracle true`; editor budget `budget SR $4, model SR $0` |
| M13 | #27 | pce-bg.js | 336-dot clock given a 340-dot frame: `frameWidth[1]` 341 → 340 | **DETECTED** | exit 1: `wide336: SIZE MISMATCH renderer 340x232 vs png 341x232` |
| M14 | #27 | pce-bg.js | 512-dot alignment wrong: `hAlign[2]` 96 → 72 | **DETECTED** | exit 1: `wide512: renderer window x[24,536) y[-1,239) != the registers' x[0,512) y[-1,239)` |
| M15 | #27 | pce-sprites.js | sprites clipped at 256 in wide modes: `paintLine` also drops `tx >= 256` | **DETECTED** | exit 1: wide336 648 differing pixels; wide512 5717 differing pixels |
| M16 | #27 | pce-bg.js | DCC codes 2 and 3 treated differently: `(cr & 2) ? 2 : (cr & 1)` → `cr & 3` | **MISSED** | exit 0, `PASS … 83 scene(s)`. No dump has DCC=11 (83× code 0; 1× code 1, wide336 `$05`; 1× code 2, wide512 `$06`). Probe VCECR `$07`: pristine `frameWidth=512`, mutant `undefined` |

## The four MISSED breaks, and the check that would catch each

- **D06 — SI/D and DI/D exchanged in `decodeDcr`.** The only decrementing
  capture, `dma2`, sets **both** bits (DCR `$1c` = SI/D and DI/D), so any
  exchange of the two decodes gives the same two `-1` steps and the same
  32,768 words. The pass is not an inert edit: on the captured descriptor
  with DCR `$14` (SI/D only) the mutant walks the source forward and the
  destination backward — 382 words differ and `SOUR`/`DESR` end at
  `$aff/$7ff` instead of `$8ff/$9ff`.
  *Which check would catch it:* `tests/check-dma.js` with a fourth capture
  whose DCR sets one step bit alone. A ROM in `tools/genroms.py`'s
  `DMA_SCENES` with DCR `$14` (source decrements, destination increments;
  `$18` is the mirror) captured as `tests/dumps/dma4` fails item 1
  (word-for-word) and item 2 (`SOUR`/`DESR` counters) immediately. A
  direct `runDma` assertion with `$14`/`$18` would be cheaper, but the
  capture is the witness the check's own contract asks for.

- **S09 — OR asserted at 16 strips.** Every line in the suite that asks
  for more than the 16-strip budget asks for 17, 18, 19 or 21
  (`sprite4` 19, `sprite11`/`vsprite*` 17, `spainted` 21, `wide512` 18);
  no line requests exactly 16, and the editor's synthetic line is 17. So
  `>= 16` and `> 16` classify every fixture identically. With 16 fully
  opaque 16-px sprites on one line the pristine model says `false` and the
  mutant says `true`.
  *Which check would catch it:* the editor-budget fixture in
  `tests/check-status.js`, extended with a 16-strip line and the assertion
  that `budget.lines[0].overflow` (and the model's `OR`) is `false`.
  `spriteLineBudget` derives OR independently (`dropped > 0`), so a
  model-vs-budget comparison on that picture is enough; the dump oracle
  (`compareDump`) would catch a capture with exactly 16 strips, but no
  such dump exists.

- **S10 — CC counts transparent pixels.** All four collision scenes
  (`sprite4`, `sprite11`, `vsprite4`, `vsprite11`) collide on opaque
  pixels, and the editor's only budget picture paints every pixel. With
  sprite #0 opaque in one column only and sprite #1 opaque in a different
  column, there is no opaque overlap; the pristine model reports no
  collision and the mutant reports one (the opaque/opaque control reports
  one in both). The check never sees the distinguishing input.
  *Which check would catch it:* `tests/check-status.js` with a fixture
  where sprite #0's transparent pixel is the only overlap. Its raw-byte
  oracle (`oracleSpriteLine`/`stripMask`) already tests opacity per pixel,
  so a Mednafen capture with that geometry would fail the per-line
  comparison; the cheaper path is to add the same picture to the editor
  budget, whose `spriteLineBudget` also tests opacity, and compare it with
  the model.

- **M16 — DCC 11 given its own clock index.** The card records that VCE
  CR codes 10 and 11 are the same /2 clock (Mednafen's `dot_clock = V & 1`),
  but no capture sets bit 0 with bit 1: the suite has 83 dumps at DCC 0,
  one at 1 (`wide336`, VCECR `$05`) and one at 2 (`wide512`, VCECR `$06`).
  `cr & 3` therefore returns the same index as the correct expression for
  every fixture. A probe at VCECR `$07` gives `frameWidth` 512 pristine
  and `undefined` mutant.
  *Which check would catch it:* `tests/check.js` with a capture of a
  picture whose VCE CR is `$07` — e.g. a `wide512b` ROM at DCC 11; the
  model must produce the same 512×232 frame as `wide512` and diff 0.
  A direct assertion `bg.frameWidth({ regs: { VCECR: 7 } }) === 512` in
  `check.js` is the cheapest guard; today the equivalence lives only in a
  comment in `pce-bg.js`.

## Residual weaknesses worth writing down

1. **The DCR step bits have one capture, and it sets both.** `dma2` is the
   only decrementing transfer (`DCR $1c`); `dma1`/`dma3` increment both
   addresses. No capture exercises one step bit alone, which is why D06 is
   invisible. The `snapshot` discriminator (item 4) is otherwise well
   pinned by `dma3`.
2. **The OR boundary is only observed from above.** No fixture sits at
   exactly 16 strips, so the check proves "17 overflows" but not "16 does
   not". This is the same shape as the #6 lesson: every fixture repeated
   the same value.
3. **Opacity is only observed opaque.** The four collision scenes and the
   editor fixture all collide on opaque pixels; the transparency rule in
   `lineStatus` has no witness. S10 is invisible for the same reason.
4. **DCC has one capture per supported code, none for the folded code.**
   Codes 0/1/2 each have exactly one fixture (0 on everything else, 1 on
   `wide336`, 2 on `wide512`); code 3 is untested. M16 is the gap. The
   same lack of a `$07` fixture means the "10 and 11 are the same clock"
   claim is model-only.
5. **`checkWindow` does not look at the model's border colour.** It
   derives the rectangle from the registers and holds the **reference
   PNG** to CRAM[$100]; the model's border is pinned only by the pixel
   diff on the five scenes that show one (W02). If those dumps were
   removed, a CRAM[$000] border would pass the window assertion and only
   the now-absent picture would catch it. The frame diff is doing the work
   today, not the window assertion.
6. **The two vertical-placement rules agree on every capture.** Dropping
   the RCRCount calibration and placing the display at the latched
   `VDS+VSW` is arithmetically identical here (scene11 −7, scene12 −11,
   scene14 +1 by both rules), and the unmodified `check.js` passes on that
   edit (measured, not counted above). So the capture calibration is not
   independently witnessed by any current dump; it would only matter if
   the counters and the latched VDS disagreed. That state has no fixture.
7. **No wide-mode status is exercised.** `check-status.js` passes
   `width: 256` for every dump, including `wide512`, whose 18-strip line
   sets OR at 512 dots; the wide OR line is seen by `check.js` only
   through the picture, not by the status oracle. The sprite-budget panel
   likewise works at the editor's 256-px view.

## What was not done

No source, test, ROM or capture was changed. The real tree was not edited;
every break ran in `$TMPDIR/pce-review-work`, refreshed from the
`git archive` copy in `$TMPDIR/pce-review-base` before each run. This
document is the only file committed by this seat. The four misses above are
new evidence gaps, routed by this review to the seats that own the checks
(`@test`) and, for the fixtures/ROMs, `@design`; none is a claim that the
model is wrong on the input, only that no committed fixture reaches it.
