# pce-psg — the PSG in the browser (card #34, extended by #63)

**2026-10-28.** `renderer/pce-psg.js` is the HuC6280 PSG model: a literal
transcription of the PSG pipeline Mednafen 1.32.1's `pce_fast` core
produces — `PCEFast_PSG` (`src/pce_fast/psg.cpp`) writing into
`Blip_Buffer` (`src/sound/Blip_Buffer.{h,cpp}`) at 44100 Hz.
`tools/genpsg.py` builds eleven tiny test ROMs, `tools/capture-psg.sh`
records each one's audio in Mednafen to a WAV, and `tests/check-psg.js`
replays each ROM's register-write trace through the model and requires
sample-for-sample equality with the recording. All eleven pass with diff 0.
Register semantics cite the HuC6280 PSG manual (the scan `docs/MANUALS.md`
indexes; PB-N page markers below); where pce_fast itself is a documented
guess, the model replicates the emulator and this page says so.
`tests/psg-mutation.js` re-runs the 15 breaks of `docs/REVIEW-34.md` and
requires every one DETECTED (#63).

## What is modelled

The reference is `pce_fast`'s PSG pipeline, not the HuC6280's analogue
output: the model computes what the emulator's Blip_Buffer puts in the
sound buffer — band-limiting, bass behaviour and all. The `pce` (accuracy)
module is **not** the reference; its PSG feeds an OwlResampler down a
different path, so captures run `-force_module pce_fast`
(`tools/capture-psg.sh`). The model is a UMD file so browser and node load
the same code: `psg.render(events, frames, count)` returns
`{pcm, sampleRate, frames}` (interleaved Int16, L first) plus `CLOCK`,
`SAMPLE_RATE` and `FACTOR`. Everywhere below, "the model does X" means
"psg.cpp does X" — matched sample-for-sample by the check.

## Registers

The nine registers, the manual's pages, and pce_fast's exact write
behaviour (`PCEFast_PSG::Write`, psg.cpp:214-346 — `Write()` calls
`Update()` first, except R0):

| reg | manual | meaning | pce_fast's write |
| --- | --- | --- | --- |
| R0 ch SELECT | PB-2 | channel select | `select = V & 7`; **no Update()** — a select change alone never produces audio |
| R1 main amplitude | PB-3 | L/R master level | `globalbalance = V`; `vol_pending` |
| R2/R3 frequency | PB-3 | 12-bit F | frequency low/high byte; `RecalcFreqCache` |
| R4 ch ON, DDA, AL | PB-3 | enable, DDA mode, channel level | sets `control`; a DDA→waveform exit restarts the wave from sample 0; an off→on transition advances one sample (unless entering DDA); `RecalcFreqCache` + `RecalcUOFunc`; `vol_pending` |
| R5 balance | PB-4 | per-channel L/R level | `balance = V`; `vol_pending` |
| R6 wave data | PB-4 | 5-bit × 32-word waveform | `V &= 0x1F`; if not DDA: `samp_accum −= old, waveform[idx] = V, samp_accum += V` (the high-frequency average cache); if `(control & 0xC0) == 0`: `idx = (idx+1) & 0x1F` (write-data mode advances the address); if `control & 0x80`: `dda = V` — "writing to this channel will update the waveform value cache/latch regardless of DDA mode being enabled" (psg.cpp:303-305); psg7's DDA staircase relies on it |
| R7 noise enable/freq | PB-6 | ch4/5 noise select + NF | channels 4/5 only: `noisectrl = V`; `RecalcNoiseFreqCache` + `RecalcUOFunc` |
| R8 LFO frequency | PB-6 | 8-bit | `lfofreq = V & 0xFF`; `RecalcFreqCache(1)` |
| R9 LFO trigger/control | PB-6 | LF TRG, LF CTL | if `V & 0x80`: channel 2 (the LFO carrier) restarts from waveform sample 0 with a fresh counter; `lfoctrl = V`; RecalcFreqCache/RecalcUOFunc for ch 1 and 2 |

The scale table `GetVL` uses is the manual's own table (PB-12), verbatim
(psg.cpp:193-196). Frequencies: tone f = fMASTER/(2×32×F), noise
f = fMASTER/(2×32×2×NF) with NF the 5-bit complement (PB-9;
docs/MANUALS.md's table row P8-9). `RecalcFreqCache` computes
`freq_cache = F<<1` (psg.cpp:112-130) and `RecalcNoiseFreqCache`
`(0x1F−NF)<<7` (psg.cpp:133-148), so F=254 → 440.4 Hz — psg1 measures
440.0 (zcPitch's ±1 Hz resolution).

## The audio path

Blip_Buffer, exactly as pce_fast drives it (pce.cpp:520-523, 533, 540):

- `sbuf[y].clock_rate(PCE_MASTER_CLOCK/3)` → factor =
  floor(44100/7159090 × 2^32 + 0.5) = **26456615** (`FACTOR`,
  Blip_Buffer.cpp:133-139).
- `sbuf[y].bass_freq(10)` → bass_shift 10 (Blip_Buffer.cpp:141-152): the
  reader's per-sample decay `accum -= accum >> 10` (Blip_Buffer.h:307-308)
  — the step tail visible in the measurements below, τ ≈ 2^10/44100 ≈
  23 ms.
- Each frame: `psg->EndFrame(HuCPU.timestamp)` then, per side,
  `offset_ += t×FACTOR` (Blip_Buffer.cpp:155-159). `offset_` is 64-bit —
  **no per-frame rounding, the fraction carries over** — so the samples
  available after N frames is floor(Σ T_k × FACTOR / 2^32) and the WAV's
  length alone determines the frame count (check-psg.js `solveFrames`).
- `Synth.treble_eq(-2.0)` (psg.cpp:150): the 12-tap impulse kernel the
  model's `BlipSide.offsetResampled` adds into the ring buffer at
  `t×FACTOR + offset` (Blip_Synth::offset_inline, Blip_Buffer.h).
- Reading (Blip_Buffer.cpp:395-435, reader macros Blip_Buffer.h:289-318):
  per sample frame `out = accum >> 14` (clamped to int16), **then**
  `accum += buf[i] − (accum >> 10)` — a delta at slot k first reaches
  output at frame k+1, spread over the kernel's 12 taps; the sides are
  read L first (pce.cpp:540).

## The volume machine

Volume changes are not synchronous. `GetVL` (psg.cpp:190-213) folds the
three attenuations into one: `gbal = 0x1F − scale_tab[(globalbalance >>
(lr ? 0 : 4)) & 0xF]`, `bal = 0x1F − scale_tab[(balance >> (lr ? 0 : 4))
& 0xF]`, `al = 0x1F − (control & 0x1F)`, summed and clamped to 0x1F — it
returns the **vol_reduction**, not 0x1F minus it. The volume tables
(psg.cpp:148-183): `dbtable[vl][sv] = flub×(sv×2−0x1F)×128`,
`volonly[vl] = flub×65536`, flub = 2^(−vl/4) (~1.5 dB per step); the
**vl=0x1F row is forced to 0** — pseudo-off. That is why a ROM that never
writes R1/R5 is silent no matter what R4 says: power-on global and
channel balance are 0, so the reduction is 31+31+0 → clamped to 0x1F →
forced 0. psg7 writes R1=0xFF/R5=0xFF for exactly this reason.

The R1/R4/R5 writes only set `vol_pending` (psg.cpp:237/279/286). The
staggered machine inside `Update()` (psg.cpp:448-528) consumes it:

- a pending write starts a machine run at the **next Update() call** —
  in the trace replays that is the write's own frame's `EndFrame` (the
  model calls `update` at each write and at each frame end, the exact
  call sequence pce_fast makes) — and only when the machine is idle
  (counter and slot both 0); a write that lands mid-cycle waits for the
  32-slot cycle to wrap, which starts the next cycle immediately
  (psg.cpp:451-455, 519-522);
- 32 slots, `which` = channel×4 + side-pair + phase; slot 0 reads the
  **right** side's GetVL into a latch over **255 cycles**, slot 1 applies
  it to `vl[1]` over **1 cycle**, slots 2/3 do the left side. The machine
  clock resumes from `lastts` (the previous write), so a write's new
  levels land at consuming-Update +256 (R) and +512 (L) cycles — in these
  ROMs, write+256/+512. Measured: psg4's R1=0x88 at t=72287 applies at
  72543/72799; the R1=0x00 write at frame 1 t=24391 applies at
  24647/24903;
- `GetVL` reads the registers **at the read slot's time**, so a burst of
  writes applies as one snapshot when the machine reaches it.

## The channel engine

`RunChannel` (psg.cpp:347-427), replicated verbatim:

- control bit 0x80 gates the counter; bit 0x40 (DDA) freezes the waveform
  counter entirely; **lfoctrl bit 0x80 also freezes channel 2's counter**
  — pce_fast's own comment "not sure about this" (psg.cpp:377-379) — the
  model reproduces the freeze, and psg6/6b's tail shows its consequence:
  the LFO carrier stops stepping, its DC output decays through the bass,
  and the wobble dies.
- freq_cache ≤ 0xA runs the high-frequency average path
  (UpdateOutput_Accum, psg.cpp:78-91) instead of per-step output;
  otherwise each counter expiry steps the waveform and emits a delta.
- Noise (channels 4/5): 18-bit LFSR, taps 0,1,11,12,17 (CLOCK_LFSR,
  psg.cpp:360-362). **GAP 14: the taps are pce_fast's choice — no
  document in the archive settles the HuC6280's noise polynomial
  (docs/MANUALS.md §15.7) — the model replicates the emulator, not
  proven hardware.**
- LFO: every step of channel 1 re-runs channel 2 and recomputes channel
  1's freq_cache (psg.cpp:415-423); the LFO branch of RecalcFreqCache
  (psg.cpp:115-121) computes `tmp_freq = (frequency + ((ch2.dda − 0x10) <<
  (((lfoctrl&3)−1)<<1))) & 0xFFF` and `freq_cache = (tmp_freq ? tmp_freq
  : 4096) << 1`; channel 2's cache scales by `lfofreq ? lfofreq : 256`
  (psg.cpp:127-128). psg6/6b measure the sweep: LFCTL=1 → 414.5-479.1 Hz,
  LFCTL=2 → 366.1-581.4 Hz.
- DDA: R4's 0x40/0x80 sequence per the manual (PB-3); in DDA mode R6
  writes only the latch (`dda = V`, psg.cpp:303-306) — psg7 steps R6
  0,2,…,30 and the recording shows 16 held levels.

## Power-on state

`Power()` (psg.cpp:539-586) zeroes everything except: `vl = [0x1F, 0x1F]`,
`counter = freq_cache = 8192` (frequency 0 → 4096<<1), noise count 1,
LFSR 1, `noise_freq_cache = 0x20<<7 = 4096`. pce_fast's own header
comment: "Not sure about power-on values, these are mostly just intuitive
guesses" — replicated as-is; the test ROMs write every register they use,
so only the documented defaults are load-bearing.

## The test ROMs, the trace, the check

- `tools/genpsg.py` — the ROMs are straight-line LDA/STA pairs (7 cycles,
  the write lands at the instruction's end) separated by exact idle
  loops, so every write's CPU cycle is known by construction. The
  generator also simulates pce_fast's CPU schedule — three timeslices per
  line (18/2/435, vdc.cpp), 261 lines in frame 0 then 262, the overshoot
  carry, the 4-cycle idle pattern — and writes the trace: every register
  write at its (frame, cycle) plus the per-frame durations
  (`frames.t0/extra/pattern`) the model needs to replay pce_fast's exact
  Update/EndFrame call sequence. The ROMs never touch the VDC/VCE/timer/
  IRQ hardware — the WAV is a pure PSG witness.
- `tools/capture-psg.sh` — builds the ROM with PCEAS, runs Mednafen with
  `-force_module pce_fast -pce_fast.ocmultiplier 1`, a dummy sound
  driver, and `-soundrecord` (which forces soundmultiplier/SoundVolume
  to 1 and bypasses the global resampler — mednafen.cpp ProcessAudio —
  so the WAV is the core's 44100 Hz buffer verbatim); exits via SIGINT
  (the key-free CloseGame this shared Mac requires), so the WAV holds
  whole frames only. Harvests `tests/dumps/psgN/{mednafen.wav,
  trace.json, mednafen.log}`.
- `tests/check-psg.js` — provenance first (the dump's trace.json must be
  byte-identical to the generator's, the log must say
  `Using module: pce_fast`, no CPU overclock), then solves the recorded
  frame count from the WAV length alone, replays the trace, and requires
  sample-for-sample equality (first mismatch reported with its
  neighbourhood). The printed diagnostics are measurements of the
  recording, not pass criteria. Since #63, psg8/psg9/psg10 are also
  required to *reach* the register state they exist for and to have the
  sound they claim (48.6 Hz / a 440 Hz ch3 tone / a DDA hold then a
  waveform) — equality alone cannot tell a fixture that covers a break from
  one that never reaches it. Per the workshop role split the script is
  flagged for @review to read cold (file header).
- `tests/psg-mutation.js` (#63) — applies each of `docs/REVIEW-34.md`'s 15
  source breaks to `renderer/pce-psg.js` in throwaway trees, measures the
  PCM difference itself, and requires the shipped checker to fail with a
  first-differing-sample report on a recording the break changed. It also
  tests itself (a gutted checker must report MISSED; an identical
  substitution must be NO-OP; a psg8 that loses R3 bit 11, and a psg8 paired
  with psg1's 440 Hz WAV, must both be refused by name).

## What the eleven recordings prove

| dump | measurement |
| --- | --- |
| psg1 | pitch 440.0 Hz (F=254 → 440.4), RMS L 5902 |
| psg2 | six simultaneous tones; FFT fundamentals 440.1/522.2/658.1/781.9/880.2/1045.7 — the manual's scale-table row (PB-12) played on six wave shapes at once |
| psg3 | balance: both L 5913.5 R 5914.6; L-only L 5899.4 R 23.2; R-only L 0.0 R 5901.7 — the 23.2 (−48 dB) is the bass tail of R's last full edge decaying through the vl=0x1F forced-0 row, not leakage |
| psg4 | levels: on 0.00 dB, R1=0x88 −22.63 dB (vl 15 → 2^−15/4), R1=0x00 −46.31 dB (same bass tail; the settled level is exactly 0), R1=0xFF 0.02 dB, AL=0x10 −22.69 dB, AL=0x00 −Infinity |
| psg5 | noise on both channels, RMS 8289.3/8289.3 |
| psg6 / psg6b | LFO sweeps 414.5-479.1 Hz / 366.1-581.4 Hz, then the dying tail of the frozen carrier |
| psg7 | 16 DDA holds, 16 distinct levels −5805..5127 |
| psg8 | 12-bit frequency: F=0x8FE (R2=0xFE, R3=0x08) → pitch 49.0 Hz (48.60 nominal, zc resolution), RMS L 5899 — the mutant that drops bit 11 hears 440.4 Hz |
| psg9 | R7 written with ch3 selected, then ch3 enabled: pitch 440.0 Hz, RMS L 5902 — Mednafen ignores R7 on ch0-3; the mutant renders a held level |
| psg10 | DDA hold peak 6069 at samples 2..76, then after R4=0x9F the pitch is 441.0 Hz over samples 176..2176 — the wave restarted at sample 0 (the mutant re-latches at index 10) |

All eleven: model PCM == Mednafen WAV, diff 0 (685862/693204/286384/
138048/691736/691736/693204/688798/615366/619772/618302 samples).

## REVIEW-34's four misses, and what #63 added

`docs/REVIEW-34.md` broke the model 15 ways and the eight recordings then in
place caught 11. The four misses were one class — register states no ROM
reached:

- **M02, R3's high nibble.** Every recorded R3 write was `0x00`, so the
  `(V & 0x07) << 8` mask dropped a bit that was never set. **psg8** now writes
  R3=0x08 (F=0x8FE → 48.6 Hz); the mutant hears 440.4 Hz. #62's wave1 does
  **not** cover this: its only non-zero R3 is `0x04` (channel 4's bass at
  F=1151 = 0x47F), and the M02 mask keeps nibble bits 0-2, so `0x04` passes
  through unchanged (measured: check-wave.js stays green on M02).
- **M08, R7 on channel 3.** The only R7 writes selected ch4/ch5. **psg9**
  selects ch3 (0-based), writes R7=0x8F, then enables the tone channel;
  Mednafen ignores R7 there, the `select >= 3` mutant does not.
- **M10, LFCTL=3.** No psg6c was added: **#62's wave3 already writes
  R9=0x83 then 0x03** and `tests/check-wave.js` compares that recording
  sample for sample. Measured: check-psg.js is green on the M10 mutant and
  check-wave.js fails on wave3 (first differing sample 130).
- **M14, the DDA→waveform index reset.** psg7 enters DDA and never leaves.
  **psg10** loads a wave, writes 10 more values (index 10), enters DDA and
  holds 0x1F, then returns to waveform mode with R4=0x9F; the model restarts
  at sample 0 and this matches Mednafen diff 0.

`tests/psg-mutation.js` re-runs all 15 breaks against these fixtures:
**15/15 DETECTED** (M10 by check-wave.js/wave3, the other 14 by
check-psg.js), the review's unused-variable control is NO-OP with both
checkers green, and the suite's own self-tests (blind checker, identical
substitution, two doctored psg8 fixtures) all say no.

**Not proven by any of this:** the witness is still Mednafen, not hardware
(GAP 14's noise polynomial in particular); the mutation edits break the
model's source, not `genpsg.py`'s cycle simulation, the trace provenance
check or `solveFrames`' WAV arithmetic; and 15 handed-over breaks are not a
complete break of the PSG — register states outside them (R8 mid-recording,
select > 5, waveform rewrites while enabled, frame-boundary writes) are not
measured here.

## Gaps

- **GAP 14** — the noise polynomial: pce_fast's LFSR taps are unproven
  against the HuC6280 (docs/MANUALS.md §15.7); a real-console measurement
  is still needed.
- pce_fast's documented guesses, replicated: the power-on values
  (psg.cpp:540) and the lfoctrl-0x80 channel-2 freeze (psg.cpp:378-379).
- The `pce` (accuracy) module's PSG is not modelled.
