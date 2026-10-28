# Rule 2 breaker (#16) — a different seat breaks the viewer's raster path

Reviewer: @review (breaker seat; the builder of #16 was a different seat).
Read cold from the repository. Date 2026-10-28.
**Nothing was fixed; this is the list.** Rule 2 in
[`../../workshop/RULES.md`](../../workshop/RULES.md): a test is proven by
breaks someone else chose.

The card is #16, "the viewer runs the raster table from the RCR line
interrupt" (commits up to `19a0852`; the functional files are
`tools/viewer.asm`, `tools/genviewer.py`, `renderer/pce-rom.js`,
`tests/check-viewer.js`, `tests/check-raster.js`). At the time of this
review the tree is at `0781e39`; the only change to these five files after
`19a0852` is `6926d24`'s comment-only edit to `viewer.asm` (VDW/HDR and VCE
D2 wording), so the code reviewed is #16's. Line numbers below are the
current file's.

## What I ran

- **Baseline:** an isolated copy of the repository under
  `$TMPDIR/pce-review16.5isIhp/repo/` (`rsync`, no `.git`). The real tree was
  never edited: this seat's only change is this document. `node
  tests/check-viewer.js` in the copy printed
  `PASS: viewer/browser/vsprite/bsprite/vraster/effect ROMs match the
  renderer pixel for pixel on 32 capture(s)`, and a fresh baseline capture of
  `vraster4` re-passed, before any break.
- **No synthetic input.** Every capture was `tools/capture.sh` in the copy:
  Mednafen on the command line, the crop passed with `-pce.slstart/slend`,
  exit by SIGINT, the state read with `mcs-extract.py`, the last movie frame
  with `movframes.py`. No keyboard or mouse event was sent anywhere. Scratch
  files, the Mednafen config and the save-state directory were under
  `$TMPDIR`; no `/tmp` path was used. The copy's `capture.sh` was changed in
  two review-only ways, neither touching the ROM or the evaluator:
  - `SCRATCH`, the Mednafen log and `HOME` point into the scratch tree, and
    the SIGINT is sent to the PID this run started (`pkill -x mednafen` would
    kill another seat's emulator);
  - on a `raster-patch.py` failure the capture continues instead of returning
    4, so the tests can judge the dump. Four breaks (B1, B2, B3, B8) fail that
    patch in the shipped pipeline; the messages are in the table. This is a
    meta-finding: with the unmodified `capture.sh` those breaks stop before
    `check-viewer.js` runs, so the "test" there is the capture pipeline, not
    the test.
- **One break at a time.** Each break was applied to a fresh copy of
  `tools/viewer.asm` from the clean baseline (replacement asserted to occur;
  every resulting ROM hash differs from the pristine ROM). The target scene
  was rebuilt and re-captured, the target dump restored to the pristine dump
  after the run, then `node tests/check-viewer.js` and `node
  tests/check-raster.js` ran. The other 31 dumps were clean captures (the
  pristine dumps, or the clean baseline `vraster4` re-capture), never a
  mutant.
- **`tests/check-raster.js` is not a script.** It exports `checkRaster` and
  has no `main`; `node tests/check-raster.js` exits 0 with no output.
  `tests/check-viewer.js` calls it for every raster dump. The raster verdicts
  below are that call's output; a green `check-raster.js` on its own proves
  nothing.
- **MISSED vs NO-OP:** as in REVIEW-15. **DETECTED** = `check-viewer.js`
  exits non-zero (or the target dump cannot be produced). **MISSED** = it
  exits 0 and the break is a real deviation the shipped captures do not
  exercise (no dump's tested pixels or state move). **NO-OP** = it exits 0
  and the break is harmless on this code path (it cannot change any captured
  frame).

## Coverage measured before choosing breaks

All eleven raster dumps (`vraster1-10`, `effect1`) are on the standard crop:
`slstart = 4`, `scanline = 254`, `RCRCount = 237`, so
`firstScanline = 14 + 4 = 18` and `vdwLine0 = 237 − (254 − 18) = 1`. Captured
rows are VDW lines 1..232; **VDW line 0 is not in any capture**, and VDW
line 240 is after the save line.

| dump | table (entries, first..last line) | fields written | what it witnesses |
|---|---|---|---|
| vraster1 | 73, 160..232 | BYR only | BYR field + sparse chain |
| vraster2 | 232, 1..232 | BXR only | BXR every line |
| vraster3 | 2, 80..160 | BYR only | two-step chain and wrap (n=2) |
| vraster4 | 232, 1..232 | CRAM1 only, `frameCounter` | per-line colour + frame counter |
| vraster5 | 3, 100/160/240 | CR only | CR field; last entry after the save line |
| vraster6 | 2, 80..160 | BYR only | two-step chain |
| vraster7 | 232, 1..232 | two CRAM words | second CRAM word and CTA reset |
| vraster8 | 183, 50..232 | BXR only | late-start BXR |
| vraster9 | 232, 1..232 | BXR only | BXR every line |
| vraster10 | 232, 1..232 | CRAM1 only | per-line colour |
| effect1 | 224, 0..223 | BXR + CRAM1 | line 0, BXR+CRAM combined, `make bank0` path |

Paths no captured table exercises: **frame counter + two CRAM words in one
step** (vraster4 is the only counter table and writes one word; vraster7 is
the only two-word table and has no counter); a **nonzero base BXR with
BXR-less entries** (every base BXR is 0, and the absent-field arrays are
zero); and **byte order inside a register write pair** (both bytes land
before the line consumes the register).

## The table — 17 breaks

### RCR re-arm, status, and the vector

| # | break, applied one at a time | site | capture | verdict | measured output |
|---|---|---|---|---|---|
| B1 | RCR re-armed **one line late** (`chain + 1` before the low/high writes) | `viewer.asm:636-641` (`irq1arm`) | vraster2 | **DETECTED** | `check-viewer` exit 1; `saved BXR=99 != table's 65`, `saved RCR=0 != chain's next arm 65`, 102231 px. The shipped `capture.sh` also rejects it: `chain step at save is 190, expected 0`. |
| B2 | RCR re-armed **one line early** (`chain − 1`) | `viewer.asm:636-641` | vraster2 | **DETECTED** | exit 1; `saved BXR=108 != 65`, `saved RCR=511 != 65`, 102633 px; patch: `chain step 191, expected 0`. |
| B3 | IRQ acknowledge **skipped** (`lda $0000` → `nop`) | `viewer.asm:642` | vraster1 | **DETECTED** | exit 1; `saved RCR=243 != chain's next arm 224`, 46932 px; patch: `chain step 19, expected 0`. The level-sensed IRQ1 never clears RR, so the chain runs away. |
| B8 | table pointer **not wrapped** (`bne irq1arm` → `bra irq1arm`) | `viewer.asm:626` | vraster3 | **DETECTED** | exit 1; `saved RCR=0 != chain's next arm 144`, 52854 px; patch: `chain step 2, expected 0` (n=2, step overruns into the padding). |
| B9 | **vblank re-arm missing**: on the wrap, branch to the status read/RTI without arming RCR | `viewer.asm:622-644` (`irq1step`) | vraster1 | **DETECTED** | exit 1; `saved RCR=296 != chain's next arm 224`, 350 px (the RCR witness is the reliable part). |
| B10 | IRQ1 vector patched to the **old (RTI) handler** (`timer`) instead of `irq1_plain` | `viewer.asm:344-346` (`tblplain`) | vraster1 | **DETECTED** | exit 1; `saved BYR=0 != table's 511 (last byr entry 232)`, 67163 px; the chain never runs. |
| B14 | **boot arm one line late** (`r_chain[0] + 1` only in the boot arm) | `viewer.asm:356-359` | vraster2 | **MISSED** | exit 0; `vraster2: OK (frame diff 0, table matches the save state and the raster2 state)`; png and cram identical to pristine. The first frame's step 0 lands one line late; every later frame re-arms from the chain and is correct. See *The misses*. |
| B16 | **wrap re-arms step 0 one line late** (correct boot arm, `+1` on the wrap arm only) | `viewer.asm:622-644` | effect1 | **DETECTED** | exit 1; `saved RCR=65 != chain's next arm 64`; frame diff 0 (the lost write is VDW line 0, above the crop). Only the saved-RCR witness catches it. |

### Field decoding and writes

| # | break, applied one at a time | site | capture | verdict | measured output |
|---|---|---|---|---|---|
| B4 | **BXR bytes written high before low** | `viewer.asm:493-497` (plain), `556-560` (frm) | vraster2 | **NO-OP** | exit 0; `OK (frame diff 0, table matches ...)`; png, cram, regs and ram identical to pristine. Both bytes land before the line boundary; Mednafen latches them independently. See *The no-op*. |
| B5 | BXR value written to the **BYR register** (`st0 #$07` → `#$08`) | `viewer.asm:493/556` | vraster2 | **DETECTED** | exit 1; `saved BXR=0 != 65`, `saved BYR=65 != 0`, 105081 px. |
| B6 | **CR field ignored** (the register select and the decode remain; the two data writes become `nop`s) | `viewer.asm:512-516` (plain), `575-579` (frm) | vraster5 | **DETECTED** | exit 1; `saved CR=196 != table's 68 (last cr entry 160)`, 51538 px. |
| B12 | op restore after the first CRAM write removed (`tya` → `nop`): A holds the CRAM high byte, so bit 4 decodes from the wrong register | `viewer.asm:530` (plain) | vraster7 | **DETECTED** | exit 1; `cram entry 7: table 0 != state 1ff`, 77440 px; the second word of every step is skipped. This is the #16 "op in A" class, reintroduced at the CRAM restore. |
| B13 | op restore after the BXR write removed (`tya` → `nop`) | `viewer.asm:498` (plain), `561` (frm) | effect1 | **DETECTED** | exit 1; 74748 px (row 0 onward). `checkRaster` still says the table matches the save state; the **frame** is the witness here. This is the exact #16 bug (op in A clobbered by a field value), on the combined BXR+CRAM table. |
| B17 | **step 0's writes skipped every frame** (`ldx <step; bne …; jmp irq1step`) | `viewer.asm:488` (plain), `551` (frm) | effect1 | **DETECTED** | exit 1; **5 px** (rows 0 and 111). The first entry's BXR reaches captured row 0 through the write latency; a table whose first entry equals the base would hide it. See *Weak witnesses*. |
| B15 | frame counter **missing from the second CRAM word** (remove `clc/adc <frame>` for `v2`) | `viewer.asm:608-615` (frm) | vraster4 | **MISSED** | exit 0; `vraster4: OK (frame diff 0, table matches ...)`. No shipped table has `frameCounter` and two CRAM words, so the removed instructions are unreachable in every capture. See *The misses*. |

### Colour table and frame counter

| # | break, applied one at a time | site | capture | verdict | measured output |
|---|---|---|---|---|---|
| B7 | **colour-table address not reset per entry** (the `$0402/$0403` writes of the first word removed) | `viewer.asm:522-525` (plain), `585-588` (frm) | vraster7 | **DETECTED** | exit 1; `cram entry 0: table 1ff != state 0`, 77440 px; the CTA auto-increments from the previous write. |
| B11 | **frame counter folded off by one** (`clc` → `sec` before `adc <frame>` in both CRAM blocks) | `viewer.asm:590-591`, `609-610` (frm) | vraster4 | **DETECTED** | exit 1; `cram entry 0: table 4b != state 4c`, 60772 px. `raster-patch.py` folds the saved counter − 1; the extra carry moves every value by one 9-bit step. |

## The misses

- **B14 — the boot arm's first frame is outside every capture.** The boot
  arm is only used once: the first RCR match after CR's RC bit is enabled.
  With `+1` the first step fires one line late, writes for the next line, and
  the chain straightens out at the next frame's wrap. The shipped capture
  waits `SLEEP=9` s and extracts the **last** movie frame; at that point the
  chain is in steady state. Measured: `check-viewer` exit 0,
  `vraster2: OK (frame diff 0, …)`, `mednafen.png` and `cram.bin` identical
  to pristine; the only changed `regs.json` field is the untested
  `pixel_offset` (2016 → 2017), and the mutant's whole 524-frame movie has a
  single frame hash — the steady picture. **Capture that would catch it:** a
  VDC write trace from reset (the `IOW-VDC` / `RCRIRQ` trace used for the
  `vdc-trace.log` in this workspace), which shows the first match
  `RCR=0x42` where the pristine ROM shows `0x41` for vraster2 (first entry
  line 1); or a save state taken at the first RCR match after CR's RC bit is
  set. An image capture of the first displayed frame would also do if the
  recording starts at reset, but in this run the recording's first frame was
  already steady, so the trace is the reliable instrument.
- **B15 — frame counter + two CRAM words is an unexercised combination.**
  `irq1_frm` has a second CRAM block, but no table sets `frameCounter` and
  writes two colour words in a step: vraster4 is the only counter table and
  every entry writes one word; vraster7 is the only two-word table and has no
  counter. The omitted `adc <frame>` is therefore unreachable on every
  shipped table. Measured: exit 0, `vraster4: OK (frame diff 0, …)`. The
  run's png/cram differences are the r4 frame-counter phase (the run saved
  counter 14 where the pristine dump has 31), which `raster-patch.py` folds
  away — not the break. **Capture that would catch it:** one raster table
  with the counter flag **and** two CRAM writes per step — e.g. take r4's
  gradient table and add a second palette write on each line, or add a
  second `cram` pair to an editor effect that also has the gradient. Then
  the second word would not receive the per-frame add and `checkRaster`'s
  `cram entry N: table X != state Y` (and the frame diff) fire.

## The no-op

- **B4 — writing the BXR high byte before the low byte is harmless here.**
  The handler writes both bytes back-to-back with no line boundary between
  them; Mednafen latches the low and high data bytes independently and the
  register value is the same when the next line reads it. Measured: exit 0,
  `OK (frame diff 0, …)`, png/cram/regs/ram identical. This is not a
  coverage gap in the test: no capture can distinguish the order unless the
  write pair is split across a line, which this handler never does. The
  manual's low-then-high order is a hardware rule the emulator does not
  enforce between two immediate writes. **Caveat:** on real hardware the high
  write may be the commit, so the order could matter and Mednafen's oracle
  would be blind to it; this review can only say the emulator evidence is
  blind, not that the silicon is.

## Weak witnesses (detected, but nearly invisible)

- **B9 (vblank re-arm missing): 350 px.** The useful witness is
  `saved RCR=296 != 224`; the frame moves only a few rows. A test that only
  compared pixels could miss this on a flatter picture.
- **B17 (step 0 skipped): 5 px** on rows 0 and 111, from the first entry's
  BXR reaching row 0 through the write latency. A first entry whose values
  equal the base (BXR 0, CRAM 0) would make the break pixel-identical; the
  saved state would still match because every later entry overwrites the
  register/colour-table cells. A robust version would put a large BXR or a
  CR/CRAM change in entry 0.
- **B16 (wrap step 0 late): frame diff 0.** The lost write is VDW line 0,
  above the standard crop; only the saved-RCR witness (`65 != 64`) catches
  it. This is the line-0 blind spot: the crop starts at VDW line 1, and
  effect1 is the only table with a line-0 entry.
- **B13 (op clobbered after BXR): `checkRaster` passes.** The table matches
  the save state because every later entry overwrites the affected cells;
  only the frame diff (74748 px) catches it. This is why the viewer test
  needs the pixel comparison, not just the table check.

## Counts

**17 breaks — 14 DETECTED, 2 MISSED, 1 NO-OP.**

Every break that moves a shipped frame is caught. The two misses are a
first-frame-only timing deviation (B14) and an unexercised field combination
(B15); the one no-op is a byte order the hardware/emulator does not observe
between back-to-back writes (B4). The shipped `check-raster.js` is a module,
not a runnable test; `check-viewer.js` is what exercises it. Four breaks
(B1, B2, B3, B8) are also rejected earlier by `raster-patch.py` in the
unmodified capture pipeline, so a breaker has to let that patch fail and
continue before the test can judge them.

## #68 appendix — the test now catches the gaps, measured

Follow-up by @test (card #68), 2026-10-28. Nothing in the viewer was fixed;
this is the test's side: two new captures, one new check, and the weak breaks
re-run against captures chosen for a louder witness. Every verdict below was
measured here; the tree is the #68 commit (the review's own 17-break run is
untouched above).

### What was added

- **`raster11` / `vraster11` — frame counter + two CRAM words in one step.**
  No shipped table had that combination, which is why B15 was unreachable.
  `tools/genreview16.py` adds scene `r11` through `genroms.py`'s own
  machinery (one source of truth for the picture, `baseCram` and the
  per-line values) and builds `vraster11` through `genviewer.py`. The scene
  ROM and the viewer ROM run the same table, so the renderer's diff-0
  oracle and the handler under test are held to it independently.
- **`vtrace2` / `vtrace2-b14` — the first frame.** An image capture cannot
  see B14: the first recorded movie frame is already steady (the review
  measured one frame hash in the mutant's whole movie). The instrument is a
  VDC write trace from reset — the instrumented Mednafen 1.32.1 the review
  used (`RCRIRQ RCRCount=… RCR=… CR=…` lines). `check-viewer.js`'s
  `checkTraceFixture` requires the first four RCR matches to be the table's
  steps 0..3 in order, with RC set, and every steady-state arm to be a table
  arm. `vtrace2` is the pristine `vraster2`; `vtrace2-b14` is the same ROM
  with B14 re-applied and is committed as a **control the check must
  reject** — a check that has never failed has not been tested.
  `tools/capture-review16.sh trace` records both.
- **`tools/capture-review16.sh`** — the capture route, separate from
  `capture.sh` because #68 must not edit the generator card #15 owns. No
  synthetic input: Mednafen from the command line, SIGINT, the state read
  with `mcs-extract.py`. Scratch (its HOME, save-state dir, movies, raw
  traces) is under `$TMPDIR`; only the Mednafen process it started is
  signalled. A save is accepted only after the table's last entry fired
  (`RCRCount >= 233`); the one early-SIGINT response measured here (a
  1-frame movie, `RCRCount` 195) is retried.
- **`tools/raster-patch.py`** now folds every CRAM word of an entry (not just
  r4's one) and folds the 5-bit counter modulo 32, so `r11`'s two words and a
  save right after a 31→0 wrap are both handled.
- **`tests/check-review-fixes.js`** expects `raster11`/`vraster11` by name
  (77 pictures now).

### The re-runs

| # | capture | verdict | measured output |
|---|---|---|---|
| B4 | vraster2 | **NO-OP** (unchanged) | check-viewer exit 0; `vraster2: OK (frame diff 0, table matches…)`; `mednafen.png`, `cram.bin`, `vram.bin`, `ram.bin` sha256-identical to the pristine dump. Reason unchanged from *The no-op*: both bytes land before the line boundary and Mednafen latches them independently. **On the real-console list with #16** — see below. |
| B9 | vraster3 (new witness) | **DETECTED, strongly** | exit 1; `saved BYR=48 != table's 8 (last byr entry 160)`, `saved RCR=224 != chain's next arm 144`, **49,938 differing bytes** from row 79. The capture pipeline also rejects it (`chain step at save is 1, expected 0`). REVIEW-16's vraster1 witness was 350 px; on vraster2 the same break is state-only (`saved RCR=296 != 65`, frame diff 0 — the late step-0 write lands below the 232-row crop), so the strong witness is vraster3's short table. |
| B13 | effect1 | **DETECTED, frame-only** (unchanged) | exit 1; `raster.json matches the save state`; **74,748 differing bytes**. The state cannot catch it (the later entries overwrite the affected cells); the frame is the witness and it is loud (25k of 59k pixels). |
| B14 | vtrace2-b14 | **DETECTED** (was MISSED) | control: `first-frame RCR match 0 armed RCR=0x42, the table's step 0 (line 1) arms 0x41`. The same trace substituted into the `expect=match` fixture makes `check-viewer.js` exit 1 with that line. Pristine `vtrace2`: `OK (first RCR match arms the table's step 0; the first four matches are steps 0..3 in order)`. |
| B15 | vraster11 | **DETECTED** (was MISSED) | exit 1; **`cram entry 496: table 11 != state 0`** (entry 0x1F0, the second word's undisplayed cell). Frame diff 0 by design — see the timing note below. The state is the witness, and it is exact: 0x11 = base 0x02 + counter 15, against 0x00 with the add removed. |
| B16 | vraster2 (new witness) | **DETECTED, strongly** | exit 1; `saved BXR=128 != table's 65 (last bxr entry 232)`, `saved RCR=66 != chain's next arm 65`, **101,874 differing bytes** from row 0. The pipeline also rejects it (`chain step at save is 1, expected 0`). REVIEW-16 had only the saved-RCR witness on effect1 (frame diff 0, the loss above the crop). |
| B17 | vraster2 (new witness) | **DETECTED, strongly** | exit 1; `raster.json matches the save state`; **381 differing bytes** from row 0. REVIEW-16's effect1 witness was 5 px; vraster2's entry 0 is BXR 128 against a base 0, so the skipped write is a whole row. |

**Counts: review 17 — 14 DETECTED, 2 MISSED, 1 NO-OP. Now 17 — 16 DETECTED,
1 NO-OP.** B4 stays NO-OP with its reason; every break that moves a captured
frame — and now the two that did not — is caught.

### The timing measurement behind B15's off-screen second word

The first `r11` design wrote the second word to CRAM[0x007], a displayed
cell. The pristine viewer then differed from the renderer by **2 bytes at
px(1,4)**, deterministically on two consecutive captures: a pixel whose
colour index is 7 on VDW line 5 used the previous line's colour. The cause
is the handler's budget: `irq1_frm` adds `clc / adc <frame> / adc #$00 /
and #$01` to *each* word — ~18 CPU cycles over `irq1_plain`, whose two-word
step `viewer.asm` puts at ~109 of a ~123-cycle deadline. The second write
crosses the line start. So a visible two-word counter step is a real (small)
viewer timing defect; it is **not** fixed here (@test reports, it does not
fix), and it is why `r11`'s second word targets CRAM[0x1F0], which the
background-only picture never displays: the per-frame add is still exercised
and held to the saved table, while the frame is not exposed to the line
timing. A viewer card that shortens the frame-counter path (or a capture
that shows the late pixel on purpose) is still owed; until then, **a visible
second CRAM word in a counter table is measured late by one pixel at
column 1**.

### What this still does not prove

- **The trace instrument is not in the repo.** `vtrace2`/`vtrace2-b14` are
  committed fixtures recorded with the patched Mednafen build at
  `/Volumes/External II/pce-tools/mednafen` (1.32.1 plus a `vdctrace()` that
  writes `RCRIRQ RCRCount=… RCR=… CR=…` at the RCR match and a `VDCWRITE`
  line per VDC write). `capture-review16.sh trace` needs `MEDNAFEN_TRACE`
  and exits 2 (NOT RUN) without it; the fixtures can be checked by any tree,
  but re-recording them needs that build. The check holds the recorded
  fixture to the current `tools/gen/vraster2.pce`'s sha256 when that ROM is
  built, so a viewer change forces a re-capture instead of a stale pass.
- **B15 is a saved-state verdict only.** A viewer that wrote the second word
  with the right value but at the wrong time would pass this fixture; that
  is the timing defect above, deliberately outside this capture.
- **The frame witnesses are still Mednafen's.** Real hardware can differ in
  exactly the line-timing edge this work measured; B4 is on the real-console
  list with #16 for that reason, and so is the counter/two-word timing.
- **The other 10 breaks were not re-run.** They were DETECTED in the review
  and the checks that caught them are unchanged.
