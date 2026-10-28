# Rule 2 breaker (#15) — a different seat breaks the raster path

Reviewer: @review (DeepSeek Flash seat). The builder of #15 was a different
seat. Read cold: the repository only, no briefing. Date 2026-10-28.
**Nothing was fixed; this is the list.** Rule 2 in
[`../../workshop/RULES.md`](../../workshop/RULES.md): a test is proven by
breaks someone else chose.

The card is #15, "the renderer takes a raster table" (commits `1611c2d`,
`f4c8de4`). The test that closes it is `node tests/check.js` against the five
`tests/dumps/raster1-5/` captures (every dump with `raster.json`). The files
read for breaks were `renderer/pce-bg.js`, `renderer/pce-sprites.js`,
`docs/RENDERER.md` (raster section), `tests/check.js` and the raster dumps
(`raster.json`, `regs.json`, `sat.bin`, `mednafen.png`).

## What I ran

- **Baseline:** an isolated copy of the repository under
  `$TMPDIR/pce-review15/base/` (`rsync`, no `.git`). `node tests/check.js`
  there prints `PASS: renderer matches Mednafen pixel for pixel on 46
  scene(s)` (us1 skipped), identical to the real tree. The reviewed renderer
  files were never edited: `git diff --exit-code` over
  `renderer/pce-bg.js`, `renderer/pce-sprites.js` and `tests/check.js` is
  empty. The other entries in `git status` are other seats' work in this
  tree (`docs/PLAN.md`, `renderer/pce-editor.js`, `tools/.DS_Store`), not
  mine; only this document is committed.
- **Sandbox:** one break at a time. Each break is a scripted string
  replacement in the copy whose old string is asserted to occur **exactly
  once** (`mutate.py`), then `node tests/check.js` runs in that copy. No
  keyboard or mouse events were sent anywhere; nothing was captured or run
  in Mednafen for this review.
- **MISSED vs NO-OP:** `check.js` only says pass/fail. To tell a break the
  captures cannot express from one that is harmless, every mutated copy also
  rendered **every** dump (including the skipped us1) and hashed the RGB
  bytes (`hashall.js`). **DETECTED** = `check.js` exits non-zero. **MISSED**
  = it exits 0 and the break is a real deviation that the shipped captures do
  not exercise (no dump's pixels move). **NO-OP** = it exits 0 and the break
  is harmless on this code path (it cannot change any frame).
- The pixel counts below are exact per-pixel comparisons against the
  pristine copy (`cmp.js`), not `check.js`'s counter — see the note at the
  end, `check.js` labels a **byte** counter "pixels".

## Coverage measured before choosing breaks

- **Calibration.** All five raster dumps have `RCRCount = 237`,
  `scanline = 254`, `slstart = 4`, so `vdwLine0 = 237 − (254 − 18) = 1` in
  every one. The raster path's own line calibration is therefore not
  exercised by any raster capture (M16 below).
- **Sprite data.** `raster1-4/sat.bin` are all-zero (64 entries); the raster
  scenes carry `sat.bin` because the extractor always writes one, so
  `check.js` renders all five through `pce-sprites.js`. `raster5` has two
  sprites: entry 0 Y=104 (display rows 40–103), X=40, 16×64, SPBG=1; entry 1
  Y=244 (rows 180–195), X=220, 16×16, SPBG=0. The CR step at line 100
  (SB off) therefore cuts sprite 0 only in its **last four rows**
  (99–102); the CR step at line 160 (BB off) puts sprite 1 in the blanking
  fill, exercising SPBG=0 over `CRAM[0x100]`.
- **raster4's writes.** Entry at line L writes CRAM address L−1 with
  `grad[L−1] + frame`; the previous frame's value is one less. Rows 1..232
  each fire exactly one such write, i.e. one palette entry changes by one
  9-bit step per line.

## The table — 20 breaks

### Registers and table order

| # | break, applied one at a time | site | verdict | measured output (differing pixels / captured rows) |
|---|---|---|---|---|
| M1 | every entry fires one line **early** — the cursor's `<= L` becomes `<= L + 1` (the BXR "same line as the write" case, and BYR/CR/CRAM with it) | `pce-bg.js:200` | **DETECTED** | exit 1; raster1 9344 px/73 rows; raster2 41301/217; raster3 240/2; raster4 102/58; raster5 271/2 |
| M1b | BXR only, shifted one captured row early (`bxr[r] = bxr[r+1]`) | `pce-bg.js:220` | **DETECTED** | exit 1; raster2 41301 px/217 rows; the other four unchanged |
| M2 | every entry fires one line **late** (`<= L − 1`) | `pce-bg.js:200` | **DETECTED** | exit 1; raster1 7759/73; raster2 41197/218; raster3 253/2; raster4 222/54; raster5 271/2 |
| M3 | BYR mid-frame write loses the manual's +1 (`bgY = v + (L − line)`) | `pce-bg.js:216` | **DETECTED** | exit 1; raster1 9344 px/73 rows; raster3 16769/153; raster2/4/5 unchanged |
| M4 | BYR frame-start latch also takes the +1 (mid-frame rule applied at the latch) | `pce-bg.js:216` | **DETECTED** | exit 1; all five; raster1 17412/159 (rows 0–158), raster2 25433/232, raster3 8664/79, raster4 25313/232, raster5 17052/159 |
| M5 | BYR frame-start latch taken from `raster.base` instead of the previous frame's last write | `pce-bg.js:174-175` | **DETECTED** | exit 1; raster1 17412 px/159 rows; raster3 9469/79; raster2/4/5 unchanged |
| M6 | **BXR** frame-start latch taken from `raster.base` instead of the previous frame's last write | `pce-bg.js:170-171` | **MISSED** | exit 0, `PASS … 46 scene(s)`; every dump pixel-identical |
| M7 | CR frame-start latch from the saved register (`regs.CR = 0x44`) instead of the previous frame's last write (`0xC4`) | `pce-bg.js:176-177` | **DETECTED** | exit 1; raster5 24444 px/99 rows (0–98 lose BB) |
| M8 | CR per-row gate ignored for the background — whole-frame `regs.CR` used | `pce-bg.js:267` | **DETECTED** | exit 1; raster5 39804 px/159 rows (0–158 lose the per-line gate) |
| M13 | raster table ignored entirely (`buildRows` returns null) | `pce-bg.js:139` | **DETECTED** | exit 1; raster1 8277/73; raster2 38253/225; raster3 19341/153; raster4 11216/230; raster5 39804/159 |
| M14 | entries applied in the wrong order (sort descending) | `pce-bg.js:155` | **DETECTED** | exit 1; all five differ (raster1 8261/73; raster2 37921/224; raster3 28337/232; raster4 46101/231; raster5 19588/133) |
| M15 | BB-off fill `0x100` → `0x000` | `pce-bg.js:271` | **DETECTED** | exit 1; raster5 18448 px/73 rows, and scene8/8b/8c/sprite8/vsprite8 (the fill rule is shared) |
| M16 | `vdwLine0` hard-wired to 1 in the raster path | `pce-bg.js:153` | **MISSED** | exit 0, pixel-identical; every raster dump has `vdwLine0 = 1` |
| M17 | 9-bit wrap mask on `bgY` removed | `pce-bg.js:216` | **NO-OP** | exit 0, every dump pixel-identical; the following BAT mask aliases +512 to the same tile row |

### Colour table and sprites

| # | break, applied one at a time | site | verdict | measured output |
|---|---|---|---|---|
| M10 | colour-table write applied one line **late** (deferred one row) | `pce-bg.js:208-211` | **DETECTED** | exit 1; raster4 222 px/54 rows (row 0: 134 px; most rows 1–2 px) |
| M11 | colour-table write applied one line **early** (look-ahead applied to row L) | `pce-bg.js:199` | **DETECTED** | exit 1; raster4 102 px/58 rows (1–2 px per row) |
| M12 | colour-table does not persist across frames (drop `cramPrev`; start from `baseCram`) | `pce-bg.js:186-191` | **DETECTED** | exit 1; raster4 11216 px/230 rows |
| M9 | CR per-row **SB** gate ignored for sprites (whole-frame CR used) | `pce-sprites.js:174-176` | **DETECTED** | exit 1; raster5 **60 px on 4 rows** (99–102, 15 px each) |
| M18 | `pce-sprites.renderFrame` decodes every row through the flat saved CRAM | `pce-sprites.js:199` | **DETECTED** | exit 1; raster4 11216 px/230 rows (raster4 is rendered through the sprites module because it carries an all-zero `sat.bin`) |
| M19 | **sprite pixels only** decode through the flat saved CRAM; BG keeps the per-row table | `pce-sprites.js:202-204` | **MISSED** | exit 0, pixel-identical; no capture combines visible sprites with per-line colour writes |

**Counts: 20 breaks — 16 DETECTED, 3 MISSED, 1 NO-OP.**
Every break that moves any shipped frame is caught; there are no
"passes but the output moved" cases.

## Does the picture show it?

Measured as difference between the raster render and the same dump rendered
without its table (for raster4, against the frame-final table), plus the
row-to-row change profile of the picture itself.

| scene | effect vs table-less | rows | what the eye sees |
|---|---|---|---|
| raster1 | 8277 px (13.9%) | 73 (159–231) | **Visible.** The bottom band collapses to solid vertical colour bars — 73 identical rows — while the top is noise. Row-to-row change drops to 0 at row 160. |
| raster2 | 38253 px (64.4%) | 225 | **Visible.** Strong horizontal banding/chevrons from the per-line BXR wobble. |
| raster3 | 19341 px (32.6%) | 153 (79–231) | **Not visibly.** The two BYR writes change which random tile row is sampled; the texture is statistically identical on both sides of lines 80/160. Row-to-row change at the boundaries (126, 126) is inside the noise (mean 110), so no band edge is discernible. Detection is exact-pixel only. |
| raster4 | 11216 px (18.9%) | 230 | **The per-line colour gradient is not visible.** See below. |
| raster5 | 39804 px (67.0%) | 159 | **Visible** for BB: the lower third becomes the dark-grey `CRAM[0x100]` fill, with a magenta/green SPBG=0 sprite over it. **Not visible** for SB: the line-100 cut removes only 4 rows of one 16-px sprite (60 px, M9). |

**raster4, plainly: the gradient is not visible in the picture.** The frame
is scene 1's pseudo-random tile noise from top to bottom; there is no
spatial ramp to see. Each line's write changes exactly one palette entry by
one 9-bit step: of the 11216 pixels that differ from a frame-final table,
9935 differ by exactly one blue step (`0,0,−36`) and the rest are that same
step crossing a 9-bit boundary (`−36,0,+252` / `+252,−36,+252`). Mean blue
by 16-row block moves only 74.3 → 77.5 (about 1.2% of range); red and green
block means are flat, and the row-to-row change profile is uniform (no edge
at any line). A person looking at `raster4/mednafen.png` sees noise, not a
gradient. It is still a numeric witness — ignoring the table or dropping
cross-frame persistence moves 11216 px (M12/M13) — but it is a poor visual
demonstration, and the per-line **timing** is barely witnessed: a one-line
early/late write moves only 102/222 px (M11/M10), 1–2 px on most rows.

## The misses

- **M6 — BXR frame-start (previous-frame) latch is untested.** `raster2`'s
  first BXR entry is line 1 and row 0 is VDW line 1, so no captured row ever
  displays the carried BXR value; using `raster.base` instead is invisible.
  **Capture that would catch it:** a raster scene whose first BXR entry fires
  after the first captured row — e.g. start `raster2`'s chain at line 50 (or
  drop its lines 1–49). Rows 1–49 would then show BXR 0 instead of the
  previous frame's last value (65), shifting whole bands.
- **M16 — raster-path calibration is untested.** Every raster dump is on the
  standard crop (`vdwLine0 = 1`), so hard-wiring 1 is pixel-identical.
  (`scene5b` proves the *non-raster* formula with `SLSTART=6`; the raster
  dumps have no equivalent.) **Capture that would catch it:** a raster
  capture with `SLSTART=6`/`SLEND=237`, where `vdwLine0 = 3`; every entry
  would land two rows off.
- **M19 — sprite colours under raster CRAM writes are untested.** No capture
  has both visible sprites and per-line colour writes: `raster4` has the
  writes but an all-zero SAT, `raster5` has sprites but no `cram` entries in
  its table. Decoding sprite pixels through the flat saved table is
  pixel-identical on every dump. **Capture that would catch it:** give
  `raster5` a colour-table step (e.g. at line 50, over sprite 0's rows), or
  put one sprite in `raster4`'s SAT.

## Weak witnesses (detected, but nearly invisible)

- **M9, the SB-off sprite gate:** 60 px on 4 rows. `raster5`'s sprite 0 spans
  rows 40–103 and the gate fires at line 100, so only its last four rows are
  cut. The test catches it, but no human sees it, and the RENDERER.md claim
  "the sprites vanish from the bottom rows" overstates the picture: it is one
  sliver of one sprite. **Settles it:** move sprite 0 down (or add a sprite
  that crosses line 100) so the cut removes a visible region.
- **M10/M11, per-line colour-table timing:** 102–222 px total, 1–2 px on
  most rows. **Settles it:** write a colour that covers a large area each
  line — the backdrop entry `0x000`, or a palette entry used by a solid tile
  region — so an early/late write changes hundreds of pixels per row.
- **raster3 and raster4 as pictures:** both are noise whose statistics do not
  move when scroll or one palette entry changes. They prove exact pixels,
  not a visible effect; neither should be cited as visual evidence of a
  gradient or a band.

## The no-op

- **M17 (removing the 9-bit wrap mask)** is harmless, not a coverage gap.
  `bgY` is used only as `((bgY >> 3) & hmask) << shift` and `bgY & 7`; 512 is
  64 tile rows = 0 modulo both BAT heights (32 and 64) and modulo the 8-row
  tile, so an unmasked offset ≥ 512 addresses the same tile/row as the
  masked one. The VDC's 9-bit counter makes the mask correct, but the
  subsequent masks already force the same result.

## Note on the check's counter

`tests/check.js:287` increments `diffs` once per **byte** and prints
`${diffs} differing pixels` (line 316); the samples it prints are pixels. A
frame with N differing pixels therefore reports about 3N. The pass/fail is
unaffected, but the number in the log is not pixels; the counts in this
review are the exact pixel counts.

## What stands

- The raster model is strongly guarded on the data the captures carry:
  BXR per-line timing (early/late, BXR-only), BYR's mid-frame +1 and its
  frame-start latch, CR's per-row BB and SB gates, CRAM early/late writes,
  cross-frame colour persistence, the BB fill value, table ordering and the
  table being used at all are **all DETECTED**, and nothing that changes a
  frame passes.
- Per rule 2 the card may not be closed over the three misses: M6, M16 and
  M19 are real breaks the shipped captures cannot express and should either
  get the captures named above or be written on the card as **not proven**.
  M9 and the CRAM timing are DETECTED but rest on 60–222 pixels that no one
  can see; they are the next captures to strengthen.
- The one NO-OP (M17) is a redundant mask, not a defect.
