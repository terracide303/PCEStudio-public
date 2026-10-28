# Rule 2 breaker (#34) — the PSG in the browser, broken 15 ways

Reviewer: @review (DeepSeek Flash seat). The builder of #34 (`dec27d4`,
`830a1dd`, `d9ffc22`) was a different seat. Read cold: the repository only, no
briefing. Date 2026-10-28. **Nothing was fixed; this is the list.** Rule 2 in
[`../../workshop/RULES.md`](../../workshop/RULES.md): a test is proven by
breaks someone else chose.

The card is #34, "the PSG in the browser: 6 channels of 32-step 5-bit waves,
noise, LFO, DDA samples; matches Mednafen by ear". The code under break is
`renderer/pce-psg.js`; the evidence files are `tools/genpsg.py` (the eight
ROMs and their traces), `tests/check-psg.js` (the sample-for-sample diff
script, written by @design and flagged in its header for @review to read
cold), and `docs/PSG.md` (the claim sheet).

## What I ran

- **Baseline:** a pristine **copy** of the reviewed tree at HEAD `5a8266c`
  (two commits past the board close `830a1dd`, one past the CAPABILITY commit
  `d9ffc22`; the four reviewed files are byte-identical to HEAD — `git
  status`/`git diff` clean, unmodified in the working tree — sha256
  `pce-psg.js` `aca81f35…`, `check-psg.js` `42af79f5…`, `genpsg.py`
  `e4f3ba57…`, `PSG.md` `fdf52f78…`) in `$TMPDIR/psg-breaker` (rsync,
  `.git` excluded).
  `node tests/check-psg.js` → exit 0: `PASS: the PSG model matches Mednafen
  sample for sample on 8 recording(s)`, in 0.5 s. The same run was repeated
  after the sweep: exit 0, and the model file's sha256 was again
  `aca81f35…`.
- **Sandbox:** one copy. Each break is exactly one source-string
  substitution in `renderer/pce-psg.js`, applied to the copy; the harness
  asserts the old string occurs exactly once before writing, runs the
  **unmodified** `node tests/check-psg.js` with the copy as cwd, and restores
  the pristine file immediately afterwards (`max |delta|`-style probes run
  in memory, see below). The real repository was never edited. No new
  recordings, no capture, no keyboard or mouse events.
- **One break at a time.** No WAV was regenerated; `tools/genpsg.py` still
  runs inside the copy on every check (the provenance step), and the eight
  committed dumps are the witnesses.
- **Result classes:** `DETECTED` = `check-psg.js` exits non-zero and names a
  first differing sample; `MISSED` = the check exits 0 and prints `PASS`, but
  a direct probe shows the mutant still changes audio on a legal register
  state that no recording reaches (the pass is not an inert edit); `NO-OP` =
  the check passes and the edit is inert for every input.
- **Miss confirmation:** a separate script loads the pristine and mutant
  modules side by side (separate module files in `$TMPDIR`, no repo edits),
  renders the same synthetic register trace through both (80 frames,
  `frames {t0 118756, pattern [119212, 119208]}`), and quotes the first
  differing PCM sample and the maximum absolute delta. These synthetic
  traces are probes, not new fixtures.

## The table

Counts: **15 breaks chosen, plus one control — 11 DETECTED, 4 MISSED,
1 NO-OP (the control).** Of the 15 real breaks, 11 are caught (73%); the four
misses are all register states or transitions the eight recordings never
reach.

| # | break, applied one at a time to `pce-psg.js` | result | measured output |
|---|---|---|---|
| M01 | frequency divider off by one: `freq_cache = (F ? F : 4096) << 1` → `((F ? F : 4096) + 1) << 1` | **DETECTED** | exit 1; first differing sample — psg1 198, psg2 134, psg3 198, psg4 198, psg6 4610, psg6b 4630; `FAIL: 6 recording(s) differ` |
| M02 | 12-bit frequency high nibble masked wrong: `(V & 0x0F) << 8` → `(V & 0x07) << 8` (bit 11 dropped) | **MISSED** | exit 0, `PASS … on 8 recording(s)`; synthetic R3=0x08 trace: first diff sample 816, max delta 15755 |
| M03 | channel volume table off by a step: `2^(0.25 * vl)` → `2^(0.25 * (vl + 1))` for vl>0 (one 1.5 dB step) | **DETECTED** | exit 1; psg4 first diff 899; `FAIL: 1 recording(s) differ` |
| M04 | balance nibbles swapped L/R: `balance >> (lr ? 0 : 4)` → `>> (lr ? 4 : 0)` in `GetVL` | **DETECTED** | exit 1; psg3 first diff 899; `FAIL: 1 recording(s) differ` |
| M05 | master volume ignored: `gbal = 0x1F - SCALE_TAB[…globalbalance…]` → `gbal = 0` | **DETECTED** | exit 1; psg4 first diff 899; `FAIL: 1 recording(s) differ` |
| M06 | noise frequency inverted the wrong way: `freq = 0x1F - (noisectrl & 0x1F)` → `freq = noisectrl & 0x1F` | **DETECTED** | exit 1; psg5 first diff 130; `FAIL: 1 recording(s) differ` |
| M07 | LFSR tap moved: `(lfsr >> 11)` → `(lfsr >> 10)` in the tap word | **DETECTED** | exit 1; psg5 first diff 634; `FAIL: 1 recording(s) differ` |
| M08 | noise on channel 3 allowed: `if (select >= 4)` → `if (select >= 3)` for R7 | **MISSED** | exit 0, `PASS … on 8 recording(s)`; synthetic ch3 R7=0x8F trace: first diff sample 29, max delta 12489 |
| M09 | LFO depth shift wrong: `shift = ((lfoctrl & 3) - 1) << 1` → `((lfoctrl & 3) - 1)` | **DETECTED** | exit 1; psg6b first diff 174; `FAIL: 1 recording(s) differ` (psg6 uses mode 1, where both shifts are 0) |
| M10 | LFO mode 3 treated as off: `lfoOn = !!(lfoctrl & 3)` → also `&& ((lfoctrl & 3) !== 3)` | **MISSED** | exit 0, `PASS … on 8 recording(s)`; synthetic R9=0x03 trace: first diff sample 6122, max delta 15580 |
| M11 | DDA ignoring the latch: R6 updates `dda` only when `(control & 0x80) && !(control & 0x40)` | **DETECTED** | exit 1; psg7 first diff 155; `FAIL: 1 recording(s) differ` |
| M12 | wave index not stepped on channel enable: drop the off→on `waveformIndex = (waveformIndex + 1) & 0x1F` | **DETECTED** | exit 1; psg1 198, psg2 37, psg3 198, psg4 198, psg6 192, psg6b 174; `FAIL: 6 recording(s) differ` |
| M13 | Blip_Synth treble filter skipped: `genSinc(…, -2.0, 0.0)` → `genSinc(…, 0.0, 0.0)` | **DETECTED** | exit 1; all 8; first diffs (psg1, psg2, psg3, psg4, psg5, psg6, psg6b, psg7) = 61, 30, 61, 61, 35, 61, 61, 14; `FAIL: 8 recording(s) differ` |
| M13b | Blip_Buffer bass high-pass skipped: `accum + buf[i] - (accum >> 10)` → `accum + buf[i]` in `readAll` | **DETECTED** | exit 1; all 8; first diffs (psg1, psg2, psg3, psg4, psg5, psg6, psg6b, psg7) = 71, 42, 71, 71, 47, 71, 71, 18; `FAIL: 8 recording(s) differ` |
| M14 | wave index not reset on DDA→waveform enable: drop `waveformIndex = 0` (and re-latch at the current index) | **MISSED** | exit 0, `PASS … on 8 recording(s)`; synthetic 0x40→0xDF→0x9F trace after 8 wave writes: first diff sample 12, max delta 5665 |
| C15 | **control, not a break:** add an unused `var UNUSED_CONTROL = 1` next to `TWO32` | **NO-OP** | exit 0, `PASS … on 8 recording(s)`; no behaviour change, so a PASS is not by itself suspicious |

The table covers all thirteen named directions. M12 and M14 split one of
them ("wave index not reset on channel enable") into its two readings, and
M13/M13b split "bass/treble filter skipped", giving 15 break mutants. C15 is
the harness control that shows an inert edit also prints `PASS`, which is
why every MISSED row carries a probe.

## The four MISSED breaks, and the recording or check that would catch them

Each PASS below is a real behavioural difference, not an inert edit: the
side-by-side probe changes PCM at a legal register state the recordings do
not contain.

- **M02 — the 12-bit frequency high nibble.** `docs/PSG.md` says frequencies
  are 12-bit, but every R3 write in all eight `tests/dumps/psg*/trace.json`
  is `0x00`: psg1 and the psg6/6b LFO carrier use F=254, psg2
  254/214/170/143/127/107 — all below 0x100. The `& 0x07` mask therefore
  drops a bit that is always zero. The probe wrote R3=0x08 (F=0x800) and the
  mutant changed audio at sample 816 by up to 15755.
  *Which recording/check would catch it:* a ninth recording, `psg8`
  "12-bit frequency", writing R2=0xFE/R3=0x08 (F=0x8FE ≈ 48.6 Hz; the
  mutant hears F=0x0FE ≈ 440.4 Hz). The existing sample-for-sample equality
  catches it, and the `zcPitch` diagnostic would print the two pitches. A
  cheaper model-level assertion — after `write(R3=0x08)` the channel
  frequency is `0x800 | low` — would catch it without a WAV, but the
  recording is the end-to-end witness.

- **M08 — noise on channel 3.** The only R7 writes are psg5's, with R0=4
  and R0=5 (`R7=0x8F`, `0x83`). No ROM ever selects ch0–3 and then writes
  R7, so the `select >= 4` guard's negative direction is untested. The probe
  selects ch3, writes R7=0x8F and R4=0x9F, and the mutant produces noise
  where the pristine model plays the channel's tone (first diff 29, max
  delta 12489).
  *Which recording/check would catch it:* a recording that selects ch3,
  writes R7=0x8F and R4=0x9F, then plays a tone. Mednafen ignores R7 for
  ch0–3, so the equality catches the mutant's noise; a direct model check
  asserting ch3's `noisectrl`/`outMode` stay untouched would also catch it.

- **M10 — LFO mode 3.** The recordings exercise only LFCTL=1 (psg6: R9=0x81
  then 0x01) and LFCTL=2 (psg6b: R9=0x82 then 0x02). No mode 3 (`lfoctrl &
  3 == 3`) is ever written, so treating mode 3 as "off" is invisible. The
  probe writes R9=0x83 then 0x03 with a tone on ch1 and a carrier on ch2;
  the mutant holds a constant pitch while the pristine model sweeps (first
  diff 6122, max delta 15580).
  *Which recording/check would catch it:* `psg6c`, the same LFO ROM with
  R9=0x83 then 0x03 (depth 4 shifts, the widest sweep). Equality catches it;
  a `psg6c` branch in `diagnose()` should print the sweep's min/max pitch,
  which the mutant would show as a constant. A unit check asserting the
  mode-3 branch is active (or a synthetic-trace pitch assertion) is cheaper.

- **M14 — the DDA→waveform wave-index reset.** psg7 is the only DDA ROM and
  its R4 writes are 0x40 and 0xDF — it enters DDA and never leaves it. Every
  other ROM has `control & 0x40 == 0` throughout, so the restart block
  (`waveformIndex = 0`) is never executed. The probe gets to index 8 with
  normal-mode R6 writes, enters DDA, writes R6, then returns to waveform
  mode with R4=0x9F; the pristine model restarts at wave sample 0, the
  mutant continues at sample 8 (first diff 12, max delta 5665).
  *Which recording/check would catch it:* a recording (`psg10`) that enters
  DDA, writes a few R6 values, leaves DDA back to waveform mode (0xDF →
  0x9F), and lets the channel play. Equality catches it. A model unit check
  after that register sequence — `waveformIndex === 0` and
  `dda === waveform[0]` — is the minimal guard.

M12 (the off→on index step) is DETECTED, so the other interpretation of
"wave index on enable" is covered; M14 is the untested one.

## What this means for #34

Under rule 2 **#34's "proven sample-exact" claim is proven on the eight
recordings, not over the PSG's register space**: 4 of 15 breaks still pass
the closing test. This is not the #6/#11 failure mode — the equality check
is exact and catches every break whose register state a fixture reaches
(11/15 here); the gap is fixture coverage, not assertion strength. The four
misses are one class: R3's high nibble, R7 on channels 0–3, LFCTL=3, and the
DDA→waveform exit are never written by any of the eight ROMs.

`docs/CAPABILITY.md`'s "PSG proven sample-exact" should read "proven on the
8 recordings; breaker 11/15, 4 misses → new card" (or go back to UNTESTED)
until the fixtures land. Per rule 2 the misses route one kind up from the
test's builder (@design, who wrote `tests/check-psg.js`): one new card for
`psg8` (12-bit frequency), `psg9` (R7 while ch3 selected), `psg6c`
(LFCTL=3) and `psg10` (DDA→waveform exit), plus the minimal model
assertions above; then re-run these 15 breaks and require 15 DETECTED. This
review commits only this file, so the card and `CAPABILITY.md` are left for
the seat that owns them.

## Residual weaknesses worth writing down

1. **The witness is Mednafen, not hardware.** The entire check compares the
   model to `pce_fast`'s recording. The LFSR taps (M07) are caught because
   they diverge from Mednafen, but if Mednafen's polynomial is itself wrong
   (GAP 14, `docs/PSG.md`), neither the model nor this test can catch it.
   Sample equality can never prove hardware correctness; that still needs a
   real-console noise measurement.
2. **`tools/genpsg.py` and the trace arithmetic are outside this sweep.** I
   broke the PSG model, not the generator's cycle simulation, the trace
   provenance check, or `solveFrames`' WAV-length arithmetic. Those are a
   separate breaker surface.
3. **The diagnostics are printed, not asserted.** psg4's dB segments, psg6/6b's
   pitch windows and psg7's 16 DDA levels are report lines; only the PCM
   equality is a pass criterion. They are useful to a human but a model that
   moved within the printed expectation range and still changed PCM would
   fail on equality anyway, so this is not a hole — just a note that a
   green run does not check the printed numbers.

## Reproducing

```sh
SRC="/Volumes/External II/agent-workshop-demo/PCEStudio"
rsync -a --exclude=.git "$SRC/" "$TMPDIR/psg-breaker/"
cp "$TMPDIR/psg-breaker/renderer/pce-psg.js" "$TMPDIR/psg-breaker/renderer/pce-psg.js.orig"
cd "$TMPDIR/psg-breaker" && node tests/check-psg.js          # baseline: exit 0, 8 recordings
# per break: restore pce-psg.js from .orig, substitute exactly one string
# (assert one occurrence), run `node tests/check-psg.js`, restore again.
```

The baseline and every mutant run used the copy; nothing in the working
repository was edited by this review, and no keyboard or mouse input was
sent.
