# Rule 2 breaker (#78, #70, #71 first half, #31 part B) — the studio's output column, wide modes, toy sound and the HuC route, broken 21 ways

Reviewer: @review (DeepSeek Flash seat). Date 2026-10-29. The builders of the
four targets were other seats. This is a cold break: the repository only, no
briefing. **Nothing was fixed; this is the list.** Rule 2 in
[`../../workshop/RULES.md`](../../workshop/RULES.md): a test is proven by
breaks someone else chose.

The targets:

- **#78** (`fa59226`): `renderer/studio.html`'s output column — the BG/SPR
  Layer checkboxes through CR bit 7/6, View only, the CRT overlay, the honest
  SND state, markers, the scrubber's length, the dot-clock label and the eight
  pad keys. Instrument: `node tests/check-studio.js`.
- **#70** (`2faafd3`): wide modes in the viewer and the editor —
  `tools/viewer.asm`'s wide-window boot, `renderer/pce-rom.js`'s version-2
  config block, `renderer/pce-editor.js`'s `setVideoMode`/`previewSize` and
  `renderer/pce-panels.js`'s frame width. Instruments: `node
  tests/check-viewer.js` and `node tests/check-editor.js`.
- **#71 first half** (`fc87f42`): the song player and the SFX hand-off —
  `renderer/pce-song.js`'s `createPlayer`/`reserve`/`release` and
  `renderer/pce-toyhost.js`'s sound surface. Instrument: `node
  tests/check-toys.js`.
- **#31 part B** (`c7f6269`): the HuC dialect of `renderer/pce-cgen.js`, the
  HuC runtime/`tools/toyc/huc_raster.asm` vector hook. Instrument: `node
  tests/check-il-huc.js`.

## What I ran

- **Pinned tree.** A fresh `git clone` of `origin` under
  `$TMPDIR/pce-breaker-78/clean`, at `a46a184` (the pushed tree when the
  review ran; the four target commits are ancestors). The shared working tree
  later had other seats' uncommitted edits; they are not part of this review.
- **Baseline, unmodified, at `a46a184`.** `node tests/check-studio.js` exit
  0, `PASS 510 checks`; `node tests/check-toys.js` exit 0, `PASS 825 checks`;
  `node tests/check-viewer.js` exit 0, 37 captures + 2 trace fixtures;
  `node tests/check-editor.js` exit 0; `node tests/check-il-huc.js` exit 0,
  `PASS 75 checks`.
- **One break at a time, on a copy.** `$TMPDIR/pce-breaker-78/runner.js`
  makes a fresh local `git clone` of the pinned tree per break, asserts the
  target string occurs **exactly once**, substitutes it, then runs the
  **unmodified** check with the clone as cwd. Mutants and logs are under
  `$TMPDIR/pce-breaker-78/mut/` and `.../logs/`; `results.json` is the run.
  **The real repository was never edited.** No scratch file was written to
  `/tmp`. No keyboard or mouse event was sent; no emulator run was needed.
- **Result classes.** `DETECTED` = the unmodified check exits non-zero.
  `MISSED` = the check exits 0 and prints `PASS`, and a direct probe on the
  mutant shows it changes behaviour on a legal input no fixture reaches.
  `NO-OP` = the change cannot change behaviour for any legal input.
- **Probes.** Each MISSED and NO-OP below names its probe under
  `$TMPDIR/pce-breaker-78/`; the probe scripts are derived from the checks'
  own page builder or call the renderer module directly.

Counts: **21 breaks — 11 DETECTED, 8 MISSED, 2 NO-OP.**

## The table

| # | card | file | break, applied one at a time | result | measured output |
|---|---|---|---|---|---|
| S01 | #78 | `renderer/studio.html` | the layer CR bits are swapped: `LAYER_BIT = { bg: 0x40, sprites: 0x80 }` | **DETECTED** | exit 1: `FAIL BG off is the renderer with CR bit 7 clear diff 114688 (first byte 0)`; `FAIL BG off changes every pixel ... 0 of 57344` |
| S02 | #78 | `renderer/studio.html` | `maskedRaster` no longer gates a raster entry's `cr` (only the base and `opts.regs.CR` are gated) | **MISSED** | exit 0, `PASS 510 checks`. Probe `probe-studio.js entries`: a toy whose `raster(100)` sets `CR=$80` leaks **57,344 non-black bytes** of 172,032 in View only with BG off; pristine 0 |
| S03 | #78 | `renderer/studio.html` | shortening the length no longer moves the playhead: remove `seek(n - 1)` from `setLength` | **DETECTED** | exit 1: `FAIL shortening the length moves the playhead inside it (100)` |
| S04 | #78 | `renderer/studio.html` | `resolutionFor` hard-codes `width = 256` instead of `pce-bg.js`'s `frameWidth` | **DETECTED** | exit 1: `FAIL resolution at VCE CR DCC 00/01/10/11 (got ["256×224","256×224","256×224","256×224"], want ["256×224","341×224","512×224","512×224"])` |
| S05 | #78 | `renderer/studio.html` | `maskedRaster` no longer gates the table's base `cr` (a raster table with no CR entry uses the base latch) | **MISSED** | exit 0, `PASS 510 checks`. Probe `probe-studio.js base`: **57,344 non-black bytes** leak in View only with BG off; pristine 0 |
| S06 | #78 | `renderer/studio.html` | a marker seeks one frame early: `seek(m - 1)` in the marker button | **DETECTED** | exit 1: `FAIL clicking a marker seeks to its frame and pauses (frame 6)` |
| E01 | #70 | `tools/viewer.asm` | the wide boot reads the HSR byte into HDR: `lda $5F04` → `lda $5F02` | **MISSED** | exit 0, `PASS ... 37 capture(s)`. Probe: rebuilt `gen/vwide512.pce` sha `02302f6e…` (pristine) vs `1735ec84…`; exactly one byte differs (offset 177, `$04`→`$02`); pristine has `AD 04 5F` (lda $5F04) at `$00B0`, the mutant has `AD 02 5F` there, so HDR becomes `$0402` instead of `$043F` |
| E02 | #70 | `renderer/pce-editor.js` | the 512-dot mode exports DCC 00: `VCECR: 0x06` → `0x04` | **DETECTED** | exit 1: `FAIL: 2 problem(s)`; `512-dot preview vs model: 175756 differing bytes of 344064; first at pixel 0` |
| E03 | #70 | `renderer/pce-rom.js` | the wide block's HSR low byte is written from the high byte: `wideBlock[WIDE_HSR_LO] = (wideHsr >> 8) & 0xFF` | **DETECTED** | exit 1: `FAIL: 4 problem(s)`; `wide block HSR differs` (twice: preview/export and the ROM's structural check) |
| E04 | #70 | `renderer/pce-editor.js` | the preview is fixed at 256 px: `previewSize` returns `width: 256` | **DETECTED** | exit 1: `FAIL: 11 problem(s)`; `previewSize 256x224, expected 341x224`; `the preview drew 256 px, expected 512`; the page's `#video` handler leaves `{"video":512,"frame":256}` |
| E05 | #70 | `renderer/pce-editor.js` | `setVideoMode` loses its guard and accepts any width | **MISSED** | exit 0, `PASS`. Probe `probe-editor.js`: pristine refuses `video-mode` for 400; mutant `ACCEPTED; pic.video=400; videoMode=undefined` |
| T01 | #71 | `renderer/pce-song.js` | `release()` no longer sets `uploadedWave = 0xff` | **NO-OP** | exit 0, `PASS 825 checks`; probe `probe-noop.js`: the reserve→release→fresh-note run has the same 604 events, sha `2c1067a9b242f151`, because `applyRow` sets `uploadedWave = 0xff` on the first fresh note itself |
| T02 | #71 | `renderer/pce-song.js` | `release()` no longer sets `waitNote = true` | **NO-OP** | exit 0, `PASS 825 checks`; `reserve()` already set it, and only `reserve()` sets `sfx`; probe: `waiting after reserve [0], after release [0]` in both trees, same 604-event sha |
| T03 | #71 | `renderer/pce-toyhost.js` | `host.release` forgets the player: only `releaseWrites` runs, so the player never hands the channel back | **DETECTED** | exit 1: `FAIL sound: writes per frame (got [...0,0,0,0,0...], want [...0,4,42,5...])`; `release ... (got 0, want 4)`; `music resumes ... (got 0, want 42)` |
| T04 | #71 | `renderer/pce-toyhost.js` | the SFX runs one frame long: `frames <= 0` → `frames < 0` (release at frame 16, not 15) | **DETECTED** | exit 1: `FAIL sound: writes per frame (got [...0,46,5...], want [...4,42,5...])`; `the toy's PCM ... differs at byte 22030: -171 != -167` |
| T05 | #71 | `renderer/pce-song.js` | the volume envelope ignores the channel's volume: `Math.floor(driverVolume * value / 31)` → `Math.floor(31 * value / 31)` | **MISSED** | exit 0, `PASS 825 checks`; `check-dmf.js` also passes. Probe `probe-song.js`: with row volume 20 and an envelope step 16, the last R4 byte is `0x8a` (AL 10) pristine and `0x90` (AL 16) mutant |
| H01 | #31B | `renderer/pce-cgen.js` | HuC's constant range loses its top value: `v > 65535` → `v > 65534` | **MISSED** | exit 0, `PASS 75 checks`. Probe `probe-cgen.js const65535`: pristine emits `r[2] = (-1)` for 65535 (the 16-bit wrap); mutant refuses `cgen-width` |
| H02 | #31B | `renderer/pce-cgen.js` | HuC accepts a constant wider than 16 bits and emits it: drop the range refusal and `w = k.v & 0xFFFF` | **DETECTED** | exit 1: `FAIL HuC refusal a constant wider than HuC's 16-bit int was accepted (wanted cgen-width)` |
| H03 | #31B | `tools/toyc/huc_raster.asm` | the raster handler is installed on the wrong vector: `sta $2202` → `sta $2204` | **DETECTED** (sha only) | exit 1: `the rebuilt palette HuC ROM ... got "028e7013…", want "34768af2…"`; `the rebuilt parallax HuC ROM ... got "4cddab1f…", want "babf4b57…"` |
| H04 | #31B | `renderer/pce-cgen.js` | the HuC right-shift helper allows a 32-bit count: `(huc ? 16 : 32)` → `(huc ? 32 : 32)` in `il_lua_shr` | **MISSED** | exit 0, `PASS 75 checks`. Probe `probe-cgen.js shr`: a toy with `f >> 1` emits `n >= 16` pristine and `n >= 32` mutant |
| H05 | #31B | `renderer/pce-cgen.js` | the argument-slot rule skips 3-parameter functions: `a.maxParams > 2` → `> 3` | **MISSED** | exit 0, `PASS 75 checks`. Probe `probe-cgen.js three`: signature `(..., int a0, int a1, int a2, int a3)` pristine, `(..., int a0, int a1)` mutant; the pristine HuC build of that toy exits 0, the mutant's exits 1 with `probe3.huc.all.c(60): undeclared variable` |

## The MISSED, and the check that would catch each

**S02 — a hidden layer leaks through a raster entry's CR.** The #78 layer
tests use the `palette` and `sprite` examples, which have no raster table, so
`maskedRaster`'s per-entry rewrite is never exercised. A check should run a
toy whose `raster(line)` writes `reg("CR", …)` (legal: the runtime's table
carries `cr`), turn View only on, hide BG, and require every pixel to be
CRAM[$100]; the probe's mutant shows 57,344 non-black bytes where the
pristine shows 0.

**S05 — a hidden layer leaks through the table's base CR.** A raster table
with no CR entry takes its frame-start CR from `base.cr`; the test never uses
one. The same probe with a raster callback that writes only BXR (and an
`init()` that sets CR) shows 57,344 non-black bytes in the mutant, 0 pristine.
Both S02 and S05 should be one added case in `checkOutputColumn`.

**E01 — the 512-dot viewer boot writes the wrong HDR.** `check-viewer.js`
compares the committed `tests/dumps/vwide512` capture with the renderer and
never builds `tools/viewer.asm`; the dump came from the pristine ROM, so the
mutant's `vwide512.pce` is never assembled or run. The check that would catch
it: `make -C tools gen/vwide512.pce`, then either assert the boot's HDR write
against the wide-window block's HDR bytes (the probe's one-byte diff:
`AD 04 5F` → `AD 02 5F` at `$00B0`, HDR `$043F` → `$0402`) or re-capture the
rebuilt ROM and hold its saved HDR/VCECR to `tests/dumps/wide512/regs.json`.

**E05 — `setVideoMode` accepts a dot clock the VCE does not have.** No test
calls it with an illegal width; `docs/EDITOR.md` promises the `video-mode`
refusal code. Add a refusal row (`ed.setVideoMode(pic, 400)` → `video-mode`)
next to the editor's other refusals. The probe shows the mutant accepts 400
and leaves `videoMode(pic)` undefined, which a later preview/export crashes
on.

**T05 — the music's volume envelope ignores the channel volume.** #71's sound
toy's instrument has no volume envelope, and `check-dmf.js`'s looping-envelope
fixture plays at driver volume 31, where the scaling is the identity. Add a
sound toy with a looping `volumeEnv` and a row `volume < 31`, then assert the
R4 AL byte is `floor(driver × env / 31)`: probe 0x8a (AL 10) pristine vs 0x90
(AL 16) mutant. (The `music fade` named in the brief is not implemented in this player;
`renderer/pce-song.js`'s header says so, and the volume path the player does
implement is the envelope scaling tested here.)

**H01 — the HuC constant boundary refuses a value that wraps legally.** The
check refuses 70000 (the prompt's "32-bit constant" case, H02, is caught) but
never emits 65535, which HuC's 16-bit int represents as -1. Add an emit check
for the boundary: `pal(1, 65535)` must produce `r[n] = (-1)`; the mutant
throws `cgen-width`.

**H04 — the right-shift helper allows a count the 16-bit int cannot hold.**
Neither shipped toy uses `>>` (all four are `<<`), so the `il_lua_shr` helper
is never emitted and the ROM sha cannot move. Add a toy with a runtime
right shift and assert the generated guard is `n >= 16` (or compile and run
a shift by 20, which must return 0). The mutant emits `n >= 32`.

**H05 — a 3-parameter function gets a 2-slot signature.** The two shipped
toys use 2-parameter and 4-parameter functions, so `maxParams > 2` never
takes the wrong branch. A check should emit a toy with exactly three
parameters and require the HuC build to succeed; the probe's pristine build
exits 0, the mutant's HuC compile exits 1 with `undeclared variable` at
`huc.all.c(60)` because `r[2] = a2` has no `a2` in the signature.

## The NO-OP, and why

**T01/T02 — both assignments in `release()` are dead.** `reserve()` already
sets `waitNote = true`, and only `reserve()` sets `sfx`; `release()` is only
reachable with `sfx` true. The first fresh note after a release sets
`uploadedWave = 0xff` in `applyRow`'s `!c.sfx && c.waitNote` branch, so
`release()`'s own `uploadedWave` reset is never the one observed. The probe's
reserve→release→fresh-note run gives the same `waiting()` (`[0]`) and the same
604-event sha in the pristine and both mutants. These are not behavioural
bugs, but the comments claim they are what forces the reload; they are not.
The FORCED reload is the `applyRow` assignment, and the check's "resume
reloads all 32 wave steps" depends on that one, not on `release()`.

## Residual weaknesses

1. **H03 is DETECTED by the ROM sha only.** `check-il-huc.js` rebuilds the
   two ROMs and pins their sha256; it does not run the rebuilt ROM. Any
   change to `huc_raster.asm` moves the sha, so the wrong-vector break is
   caught, but the check has no behavioural witness that the rebuilt ROM's
   handler is installed on `$2202` and chains the RCR. The captured frames
   come from the committed dumps, not from the rebuild.
2. **`check-viewer.js` never assembles `viewer.asm`.** E01 is the concrete
   consequence. The wide-window boot is held by the committed `vwide336` /
   `vwide512` dumps and by `check-export.js`'s PCEAS byte comparison, but a
   viewer.asm-only change is invisible until someone re-captures.
3. **The layer tests pick examples with no raster table.** S02/S05 show that
   the output column's "one place" claim holds for the single-register path
   and not for the table path. The fix belongs in `checkOutputColumn`, not in
   a new renderer test: the page's own `maskedRaster` is the object under
   test.
4. **The HuC dialect is pinned only through two toys.** H01/H04/H05 are emitter
   branches those toys never reach; the sha pin proves the two ROMs, not the
   dialect. A small table of emitter-level fixtures (the constant boundary, a
   right shift, 3 parameters) would close all three.
5. **#71 has no volume-envelope sound toy.** T05 passes `check-toys.js` and
   `check-dmf.js`. The existing sound toy's write-by-write table is strong
   evidence for the hand-off; it simply never asks the mixer to scale a
   driver volume.

## What the breaker did not touch

No source file was edited; the mutants exist only in the `$TMPDIR` clones.
No emulator was run and no synthetic key or mouse event was sent. The
`tools/gen/vwide512.pce` builds used the project's own PCEAS route; no
Mednafen capture was written.
