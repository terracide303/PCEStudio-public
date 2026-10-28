# Rule 2 breaker (#14) — a different seat breaks the viewer's sprite path

Reviewer: @review (DeepSeek Flash seat). The builder of #14 was a different
seat. Read cold: the repository only, no briefing. Date 2026-10-28.
**Nothing was fixed; this is the list.** Rule 2 in
[`../../workshop/RULES.md`](../../workshop/RULES.md): a test is proven by
breaks someone else chose.

The card is #14, "the viewer loads the sprites (SATB DMA)" (commits `75f5062`
and `3d91f44`). The test that closes it is `tests/check-viewer.js` run
against the `tests/dumps/vsprite1-11/` captures. The files read for breaks
were `tools/viewer.asm`, `renderer/pce-rom.js`, `tools/genviewer.py` and
`tests/check-viewer.js`.
## What I ran

- **Baseline:** an isolated copy of `tools/viewer.asm`, `tools/genviewer.py`,
  `tests/dumps/` and `tests/check-viewer.js` under
  `$TMPDIR/review14/`. Built `vsprite1` with the unmodified tools, captured
  it in Mednafen (the command-line route of `tools/capture.sh`: `-qtrecord`
  PNG frames, `-autosave 1`, SIGINT sent to the launched PID — **no keyboard
  or mouse events**), extracted with `tools/mcs-extract.py` and
  `tools/movframes.py`, and ran the **unmodified** `tests/check-viewer.js`.
  Result: `PASS ... 17 capture(s)`; the fresh `vram.bin`, `cram.bin`,
  `sat.bin` and `mednafen.png` are **byte-identical (SHA-256) to the committed
  `tests/dumps/vsprite1/`**. The capture pipeline reproduces the shipped
  evidence exactly.
- **Sandbox:** one break at a time. Restore the pristine `viewer.asm`, apply
  exactly one edit (each old string occurred once; asserted), assemble with
  `pceas -raw`, capture the mutated ROM, drop its `vram.bin`/`cram.bin`/
  `sat.bin`/`regs.json`/`mednafen.png` over the matching `vspriteN` in the
  sandbox dump tree, and run the unmodified `check-viewer.js`. The other 16
  captures stay as committed.
- **`renderer/pce-rom.js` breaks:** no capture is involved in the guarded
  property. They were run through the unmodified `tests/check-export.js`,
  which builds the browser ROM from the mutated module and compares it byte
  for byte with the PCEAS build (its `PAIRS` list carries the `spriteN` ->
  `vspriteN.pce` pairs #14 added).
- **Repo untouched:** `git status --short` stayed at the pre-existing
  `?? tools/.DS_Store`; `git diff --exit-code` over the four reviewed files
  passed after the runs. The sandbox is `$TMPDIR/review14/`.

Verdicts below: **DETECTED** = the check exits non-zero; **MISSED** = exits 0
and the mutated capture is byte-identical to the correct one on the data a
scene carries; **NO-OP** = exits 0 because the break never changes any
measured output (the code path is not taken or the hardware discards it —
a coverage statement, not a defect). For pce-rom rows the matching check is
`check-export.js`; `check-viewer.js` never rebuilds a ROM, so a builder break
is invisible to it until someone recaptures.

## Coverage measured before choosing breaks

Two facts decide which breaks can be seen, so they were measured from the
shipped dumps rather than assumed.

**SAT entries used.** Each `spriteN/sat.bin` is 64 entries x 4 words. The
highest entry with any nonzero field:

| scene | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| highest nonzero entry | 5 | 5 | 4 | **19** | 15 | 5 | 3 | 2 | 0 | 2 | 15 |

Every scene's entries **20–63 are all zero**. Entries 16 and above are used
only by `sprite4` (entries 16–19); `sprite5` and `sprite11` stop at entry 15.

**Copy sizes.** Every copy starts at `$4000` of its bank. The largest vsprite
copy is 5120 bytes (tiles, sprites 1 and 7), ending at `$53FF`; the largest
viewer copy is `scene3`'s 128-wide BAT, 8192 bytes, ending exactly at
`$5FFF`. The MPR2 window is `$4000-$5FFF`, so **no capture in the repository
ever needs the bank-remapping branch of `copy_words`.**

## The table (viewer.asm — captured, `check-viewer.js`)

| # | break, applied one at a time | site | scene | verdict | measured output |
|---|---|---|---|---|---|
| A | SAT copy length 256 → 64 words (16 of 64 entries) | `viewer.asm:249-251` | vsprite4 | **DETECTED** | exit 1; `657 differing pixels of 178176`; `vram differs ... at byte 65152` (= word `$7F40`, SAT entry 16); `sat.bin differs ... at byte 128` |
| A2 | SAT copy length 256 → 80 words (20 of 64 entries) | `viewer.asm:249-251` | vsprite1, vsprite4 | **MISSED** | exit 0, `PASS ... 17 capture(s)` on both; all four capture files SHA-256-equal to the committed `vsprite1` and `vsprite4` |
| B | SAT copy length 256 → 512 words (past VRAM) | `viewer.asm:249-251` | vsprite1 | **NO-OP** | exit 0, 17/17 `OK`; capture SHA-256-equal to pristine; the VDC drops the writes past `$7FFF` and the DMA reads only 256 words |
| C | DVSSR `$7F00` → `$7E00` | `viewer.asm:160-162` | vsprite1 | **DETECTED** | exit 1; `13295 differing pixels`; `SATB=32256 but sprite1 has 32512`; `sat.bin differs ... at byte 0` |
| D | DCR bit 4 (DSR) off: `$10` → `$00` | `viewer.asm:151-153` | vsprite1 | **DETECTED** | exit 1; `13295 differing pixels`; `DCR=0 but sprite1 has 16`; `sat.bin differs ... at byte 0` |
| E | palette loop 4 → 2 pages (512 → 256 CRAM entries) | `viewer.asm:97` | vsprite1 | **DETECTED** | exit 1; `12704 differing pixels`; `cram differs ... at byte 512` (entry 256, the first sprite palette) |
| F | palette loop 4 → 5 pages (640 writes; CTA wraps) | `viewer.asm:97` | vsprite1 | **DETECTED** | exit 1; `124338 differing pixels`; `cram differs ... at byte 0` |
| G | VCE palette byte order swapped (`$0405` written before `$0404`) | `viewer.asm:101-106` | vsprite1 | **DETECTED** | exit 1; `166909 differing pixels`; `cram differs ... at byte 0` |
| H | `copy_words` keeps the byte position in Y and clears it per call — the page-walk bug the routine's comment says was the #14 stripes-scene bug | `viewer.asm:279-324` | vsprite3 | **DETECTED** | exit 1; `91347 differing pixels`; `vram differs ... at byte 2080` (= word 1040, the second region's destination: 16-word first region is not page-aligned) |
| I | window-remap threshold `cmp #$60` → `cmp #$70` (both sites) | `viewer.asm:286,301` | vsprite1 | **NO-OP** | exit 0, 17/17 `OK`; capture SHA-256-equal to pristine; no copy reaches `$6000` (largest ends `$53FF` vsprite / `$5FFF` viewer), so the mutated compare never runs |
| K | SAT source bank-1 offset `$4440` → `$4420` | `viewer.asm:245-247` | vsprite1 | **DETECTED** | exit 1; **frame diff 0**; `vram differs ... at byte 65024` (`$7F00`); `sat.bin differs ... at byte 0` |
| L | word byte order in `copy_words` (ports `$0002`/`$0003` swapped) | `viewer.asm:294,310` | vsprite1 | **DETECTED** | exit 1; `79347 differing pixels`; `vram differs ... at byte 0`; `sat.bin differs ... at byte 0` |
| M | CR bit 6 (sprite layer) cleared before display | `viewer.asm:261-263` | vsprite1 | **DETECTED** | exit 1; `13295 differing pixels`; `CR=128 but sprite1 has 192` |
| R | MPR2 not mapped back to bank 1 before the SAT copy (`tam2` removed) | `viewer.asm:242-244` | vsprite1 | **DETECTED** | exit 1; `13295 differing pixels`; `vram differs ... at byte 65024`; `sat.bin differs ... at byte 0` |
| S | SAT copy destination MAWR `$7F00` → `$7F80` (DVSSR unchanged) | `viewer.asm:252-254` | vsprite1 | **DETECTED** | exit 1; **frame diff 0**; `vram differs ... at byte 65024`; `sat.bin differs ... at byte 0` |

## The table (genviewer.py — captured, `check-viewer.js`)

| # | break | site | scene | verdict | measured output |
|---|---|---|---|---|---|
| T | SAT block assembled at `.org $4640` instead of `$4440` (the viewer still reads `$4440`) | `genviewer.py:181` | vsprite1 | **DETECTED** | exit 1; `13295 differing pixels`; `vram differs ... at byte 65024`; `sat.bin differs ... at byte 0` |

## The table (pce-rom.js — `check-export.js`, 14 dump/PCEAS pairs)

| # | break | site | verdict | measured output | `check-viewer.js` sees it? |
|---|---|---|---|---|---|
| J1 | SAT block written to bank 2 instead of bank 1 | `pce-rom.js:216` | **DETECTED** | exit 1; `FAIL: 14 scene(s) differ`; 512 bytes from `0x2440` (`browser 0xff, PCEAS 0x42` / `0x00`) | no — it never rebuilds a ROM; its browser captures are `browser1-3` only |
| J2 | SAT slice 512 → 256 bytes | `pce-rom.js:182` | **DETECTED** | exit 1; 14/14 differ; 256 bytes from `0x2540` (`browser 0xff, PCEAS 0x00`) | no — same |
| J3 | SAT source address `$7F00` → `$7E00` | `pce-rom.js:57` | **DETECTED** | exit 1; `scene1-3: OK` (their SAT is all zero), 11/11 sprite scenes differ, 5–100 bytes from `0x2440` | no — same |

**Counts: 19 breaks — 16 DETECTED, 1 MISSED, 2 NO-OP** by the check that
guards the broken file. Against `tests/check-viewer.js` alone: 13 detected,
1 missed, 2 no-op, and 3 (`J1–J3`) outside its reach because it never
rebuilds a ROM. Of the 13 captured detections, 11 also fail the pixel diff,
while **K and S produce a pixel-identical frame (0 differing pixels) and are
caught only by the `vram` and `sat.bin` comparisons.**

## The miss

### A2 — SAT entries 20–63 are never exercised

Copying only the first 80 SAT words (20 entries) is invisible on **every**
shipped capture. Measured: the highest nonzero SAT entry across the 11 sprite
scenes is 19 (`sprite4`); entries 20–63 are zero everywhere, and the viewer's
VRAM and the DMA'd SATB therefore equal the scene's zeros. A fresh capture of
the 80-word ROM for `vsprite1` and for `vsprite4` (the worst case — the only
scene that uses entries 16–19) is byte-identical to the committed captures in
all four files, and the check reports `PASS ... 17 capture(s)`.

The 64-word break (A) **is** caught, and only by `sprite4`: its entries 16–19
are the first that disappear. The test is this close to the edge: the scene
that proves the copy length is a single picture with a sprite in entries
16–19. A copy of 20+1 entries would pass today.

**Settles it:** a captured picture with a visible sprite in SAT entry 20 or
above (e.g. extend `sprite4`'s SAT with entries 20–21, or recapture a scene
with 21+ entries). Then A2 must be DETECTED by `sat.bin` at byte 160 (entry
20) and probably by the frame.

## The no-ops, and what they say about coverage

- **B (over-length SAT copy)** is not a defect: 256 extra words at `$8000`+
  are discarded by the VDC, and the DMA reads exactly 256 words from DVSSR.
  It is recorded because it is the first break a reviewer reaches for when
  testing "256 words", and it proves the check is not accidentally sensitive
  to harmless writes.
- **I (bank-crossing remap)** is a real coverage gap even though the pixels
  are identical: the remapping branch of `copy_words` — the part adapted from
  HuDK's `remap_data`, and the kind of code that silently eats a whole tile
  region — **is dead code on every capture in the repository**. The largest
  copy ends at `$53FF` (vsprite tiles) and the largest viewer copy ends
  exactly at `$5FFF` (`scene3`'s 8 KiB BAT), so no read ever starts at
  `$6000`. Threshold (`$60`→`$70`), the second-byte crossing check, and the
  bank counter can all be broken with the test green.
  **Settles it:** a captured viewer ROM whose BAT or tile stream is larger
  than 8 KiB from `$4000` — e.g. a 128×64 BAT (16 KiB, MWR `$60`) or a
  picture with more than 8 KiB of tile regions — then I must be DETECTED
  (the upper half of the copied picture would come from the wrong bank).

## The pce-rom scope gap (J1–J3)

`check-export.js` catches all three, including on the sprite pairs — the
browser's ROM is byte-for-byte the PCEAS ROM, so the SAT block's place,
length and source are pinned *as bytes*. But the ROM is never **run**:
`check-viewer.js`'s browser captures are `browser1-3`, built from
`scene1-3`, and those scenes have no ROM SAT at all (their `sat.bin` is
absent and VRAM `$7F00-` is zero), so the browser sprite path — the one the
card's page actually exports — has no Mednafen frame in the evidence set.
J3 shows the gap directly: its mutation passes `scene1-3` and fails only the
11 sprite pairs.

**Settles it:** `tools/capture.sh` a browser ROM built from a sprite scene
(`check-export.js --write` currently accepts only 1-3; it needs a sprite
mode), and add `browser-spriteN` (or similar) to `check-viewer.js`'s dump
set. Then a broken browser SAT layout is seen end to end, not only as a byte
mismatch against PCEAS.

## What stands

- The #14 claim itself is proven by the baseline: a fresh capture of the
  viewer ROM is byte-identical to the committed `vsprite1` evidence, and
  `check-viewer.js` passes all 17 captures with `frame diff 0` and full
  `vram`/`cram`/`sat.bin`/register equality.
- The viewer's sprite path is well guarded on the data the scenes carry:
  the PCEAS-side SAT placement, DCR bit 4, DVSSR, SAT length (64 words), SAT
  source and destination, `copy_words` page position, word byte order, the
  512-entry CRAM load and its exactly-512-write boundary, and the CR
  sprite-enable bit are all detected. The `sat.bin` and `vram` assertions are
  **load-bearing**: K and S have identical frames and would be misses if the
  check compared pictures only.
- Two gaps remain: SAT entries 20–63 (MISSED, A2) and the multi-bank
  crossing (NO-OP coverage gap, I). One scope gap remains: the browser
  export is byte-checked but never run on a sprite scene (J1–J3).
- Every viewer-path break above (including the genviewer.py one) was
  reachable by a fresh command-line Mednafen capture; the pce-rom breaks
  needed no capture. None is marked UNREACHABLE.
