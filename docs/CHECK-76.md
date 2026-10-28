# #76 — REVIEW-48-50's four misses, the captures that reach them, and the re-runs

Card #76. Work by @test. The breaker (`docs/REVIEW-48-50.md`, commit
`50a179d`) broke the window, DMA, status and wide-mode model 16 ways; the
checks caught 12. The four it MISSED were not wrong code that a weak check
let through — each was code whose only distinguishing input **no capture
carried**:

| # | card | file | break | why it was invisible |
|---|---|---|---|---|
| D06 | #49 | `pce-vram.js` | `SI/D` and `DI/D` exchanged in `decodeDcr` | `dma2`, the only decrementing capture, sets **both** bits, so an exchange gives the same two `-1` steps |
| S09 | #50 | `pce-sprites.js` | OR at `requested >= 16` instead of `> 16` | no line asked for exactly 16 strips (every fixture asked for 17+) |
| S10 | #50 | `pce-sprites.js` | CC marks every covered column opaque, not only non-zero pixels | every collision scene collides on opaque pixels |
| M16 | #27 | `pce-bg.js` | `cr & 3` instead of `(cr & 2) ? 2 : (cr & 1)` | no dump used DCC=11 (VCE CR `$07`) |

This card adds the captures the review's *which check would catch it* section
named, all from Mednafen 1.32.1 through `tools/capture.sh`, and re-runs the
four breaks against the unmodified checks.

## What was added

### Captures (`tools/genroms.py`, `tools/Makefile`, `tools/capture.sh` routes)

| dump | ROM | how it was made | what it is |
|---|---|---|---|
| `dma4` | `DMA_SCENES["4"]` | `tools/capture.sh 4 dma` | DCR `$14`: **SI/D alone** — source `$9ff..$900` read backwards, destination `$800..$8ff` written forwards |
| `dma5` | `DMA_SCENES["5"]` | `tools/capture.sh 5 dma` | DCR `$18`: **DI/D alone** — source `$800..$8ff` read forwards, destination `$9ff..$900` written backwards |
| `sprite14` | `SPRITE_SCENES` `"sprite14"` | `tools/capture.sh 14 sprite` | 16 16×16 sprites tile the line exactly (display columns 0..255) — **exactly 16 strips requested** |
| `sprite15` | `SPRITE_SCENES` `"sprite15"` | `tools/capture.sh 15 sprite` | sprite14 plus a 17th SAT entry on the same line — **17 requested, 16 kept** |
| `sprite16` | `SPRITE_SCENES` `"sprite16"` | `tools/capture.sh 16 sprite` | sprite #1 covers sprite #0's 16 columns and paints **nothing** (pattern cell `$100`, which no ROM writes) — a transparent overlap |
| `sprite17` | `SPRITE_SCENES` `"sprite17"` | `tools/capture.sh 17 sprite` | the same geometry with an **opaque** sprite #1 (the next SG cell) — the positive control |
| `wide512b` | `SPRITE_SCENES` `"wide512b"` | `tools/capture.sh 512b wide` | wide512's picture and registers at **VCE CR `$07`** (DCC=11) |

`sprite14`–`sprite17` enable the status interrupt the scene is about: CR
`$C2` (OC, bit 1) for the two overflow scenes, CR `$C1` (CC, bit 0) for the
two collision scenes. Nothing in these ROMs reads SR, so the save state
keeps whatever the frame latched, and `tests/check-status.js` compares it
with the model's frame SR — **Mednafen is the witness**, not just the
oracle the model and the check share. Before #76 no captured scene had CR
bits 0–3 set (the #50 card recorded that as a model-only calculation).

### Check changes

- `tests/check-dma.js` — no logic change: it discovers `dmaN/`, so dma4 and
  dma5 are checked word for word, on the counters, on the DV gate and on the
  frame. Header updated.
- `tests/check-status.js` — names the four fixtures and asserts their saved
  register values (`$00`, `$02`, `$00`, `$01`), and **re-measures each
  fixture's premise from `sat.bin`/`vram.bin`**: that a line asks for
  exactly 16 (sprite14) or exactly 17 (sprite15) strips and keeps 16, and
  that sprite16's entry 1 covers entry 0 with zero opaque pixels while
  sprite17's does collide. A dump that stops being the input the break
  needs now fails as its own problem instead of passing silently.
- `tests/check-review-fixes.js` — the expected-scene set gains the seven
  dumps (check.js is now 92 scenes + 1 flicker capture).  This edit was
  **committed by another seat** in `5af0b58` (it committed the whole file
  while it was working on #81), so it is not in this card's commit; it is
  verified here because the set is what holds check.js's count to its names.
- `tests/vdc-mutation.js` — new: applies each of the four REVIEW-48-50
  breaks to a throwaway copy of `renderer/`, runs the **unmodified** check
  and requires it to name the fixture with the defect's own problem. See
  "The re-runs" below.

## The measured evidence

Baseline, measured in a `git archive HEAD` tree with this card's files
copied in (no other seat's uncommitted captures — the shared working tree
also carries an in-flight `tests/dumps/toyparallax` that fails `check.js` by
design of its own card, and is not part of this evidence):

```
node tests/check.js       PASS: renderer matches Mednafen pixel for pixel on
                          92 scene(s) and 1 flicker capture(s)
                          (dma4, dma5, sprite14-17, wide512b each "OK ..., diff 0")
node tests/check-dma.js   PASS: 5 VRAM-to-VRAM DMA capture(s) match the model
                          word for word and render diff 0
node tests/check-status.js  status: 95 dumps — 67 save states compared
                          register-for-register, 28 read-cleared
                          FAIL: 1 problem(s) in 119 checks — the one problem
                          is tests/dumps/toypalette ("saved VDC status $0,
                          the model's frame SR is $20"), which is card #81's
                          capture and outside this card; it failed the same
                          way before these changes
node tests/check-review-fixes.js  PASS: all five #38 fixes hold ...
node tests/renderer-mutation.js   PASS (all ten #39 breaks DETECTED)
node tests/raster-mutation.js     PASS (M6/M16/M19 DETECTED, M17 NO-OP)
node tests/check-panels.js        PASS (36592 checks)
```

The captures themselves are the sharpest statement, because they are the
same picture on both sides of the break and differ only in the register that
carries the answer:

- `sprite14` and `sprite15` record **byte-identical frames**
  (sha1 `c52616a9…`), because the 17th strip is dropped either way. Their
  saved status registers are `$00` and `$02` — Mednafen sets OR at the 17th
  strip and not at the 16th.
- `sprite16` and `sprite17` record the same geometry but different status
  registers: `$00` with the transparent sprite #1, `$01` with the opaque one.
  The transparent one paints nothing (checked from the pattern bytes), so
  the only reason the two differ is the transparency rule.
- `wide512` and `wide512b` record **byte-identical frames**
  (sha1 `402005b0…`) and byte-identical VRAM, with only `VCECR` `$06` vs
  `$07` apart — Mednafen's VCE keeps DCC=11 as its own index
  (`dot_clock = V & 3`) whose ratio and 512-dot width equal DCC=10's
  (`pce/vce.cpp`, `vce_ratios[4] = {4,3,2,2}`, `w_cows[..][3] = 512`), which
  is the rule `pce-bg.js` folds into `(cr & 2) ? 2 : (cr & 1)`.
- `dma4` ends `SOUR $8ff DESR $900` (dec/inc) and `dma5` ends
  `SOUR $900 DESR $8ff` (inc/dec); both match the model word for word and
  render diff 0.

## The re-runs

`node tests/vdc-mutation.js` — one source edit per break, in a scratch tree
with a symlink to `tests/dumps`; the real renderer and the real checks are
never modified:

```
DETECTED D06: DMA decrement flags swapped (SI/D read from bit 3, DI/D bit 2)
DETECTED S09: OR set at 16 strips instead of 17 (`requested > 16` -> `>= 16`)
DETECTED S10: CC counts every covered column, not only non-zero pixels
DETECTED M16: DCC code 11 given its own clock index (`cr & 3`)
NO-OP     self-test: identical edit: nothing observable changed
PASS: 4/4 of REVIEW-48-50's missed breaks are DETECTED — and each is MISSED
again when its new capture is removed, so the captures are the witness
```

What "DETECTED" means here is specific, and everything else fails the run
however red it looks: `check-dma.js` must print a word/counter mismatch for
**both** dma4 and dma5; `check-status.js` must print `FAIL sprite14` with
`OR: model true, oracle false` (S09) or `FAIL sprite16` with
`CC: model true, oracle false` (S10); `check.js` must stop printing
`wide512b: OK`.

The **MISSED** half is not decoration: each break is run a second time
against a dumps tree with its new capture removed, and the check must go
green on it. That is the state every one of these four breaks was in before
this card, measured rather than asserted.

## What this does NOT prove

- **Mednafen is the only witness.** No console and no ares run of these
  ROMs. `sprite14`/`sprite15`/`sprite16`/`sprite17` prove what Mednafen's
  VDC latches, not what the HuC6270 does; the manual's OR wording ("more
  than 17 [sic] sprites") is what the review quoted and what Mednafen
  implements as a 17th-strip attempt.
- **The saved register is read at one instant.** The status is compared at
  the save scanline (254). The ROMs never read SR, so a condition cannot be
  cleared here — but a hardware quirk that clears OR/CC at the frame
  boundary would make every one of these witnesses vanish, and this check
  could not tell that apart from "the condition never happened".
- **`sprite16`'s transparent sprite reads an unwritten VRAM cell**
  (`$100`, words `$4000..$403F`). Mednafen zeroes VRAM at power-on; the
  check re-measures that the cell really paints nothing from `vram.bin`, so
  a future ROM that writes there fails the premise — but the fixture is
  "an all-zero pattern", not "a transparent sprite the generator drew".
- **The print cap.** `check-status.js` prints at most 10 problems per dump;
  the raw-byte oracle rows fill that list on a broken model, so the
  saved-status line can be cut from the output. The check still fails on it;
  the mutation harness therefore keys on the oracle line, and the saved
  values themselves are asserted by name in the baseline.
- **The wide status line is still not exercised.** `check-status.js` passes
  `width: 256` for every dump, so `wide512b`'s OR line (18 strips at 512
  dots) is seen by `check.js` through the picture only. REVIEW-48-50's
  residual weakness 7 is unchanged by this card.
- **The half-known DCC=3 equivalence is Mednafen's.** Two sources say codes
  10 and 11 are the same clock (Mednafen's tables; the model's comment), but
  no hardware measurement in this tree sets DCC=11. The capture proves the
  model reproduces Mednafen; it does not prove the clock.
- **The DMA captures are inside 32K words.** All five transfers stay below
  `$7FFF`; the upper word half and the overrun rule remain unexercised
  (#49's own blind spots, unchanged).
- **One break each.** These are the four REVIEW-48-50 named; this is not a
  fresh break of the four checks, and a break a future reviewer picks may
  still land in a gap no scene reaches.
