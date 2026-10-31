# The console's real speed, measured (card #169)

> Dennis, 2026-10-31: "we can use an emulator as well to do the same" (as
> ppu.toys, whose cost number comes from its compiled code, not from the Lua
> running in the page).

Before this card the interpreter route's speed was a **static estimate**:
`renderer/pce-validate.js` scaled its cycle model by two factors calibrated
from two captures (docs/IL.md §14, #100/#115). Nothing measured a toy's ROM
and answered the question a person actually asks — *does this toy run at 60,
at 30, or not at all?* This card puts a counter in the interpreter ROM and
reads it back from a real emulator run.

The interpreter is the one every exported toy runs (`renderer/ilvm.bin`, built
from `tools/ilvm/`). The counter code lives in `tools/ilvm/ilvm_runtime.c`;
the compiled route (`tools/toyc/`) is untouched.

## What the ROM counts

One **update** is:

- `frame()` for a toy with no `raster()` callback, or
- `frame()` plus its 224-call raster collection for a toy with one.

The ROM counts, and keeps at fixed BaseRAM addresses (docs/ROM_LAYOUT.md):

| cell | address | meaning |
|------|---------|---------|
| updates | `$2120` (u16) | updates measured |
| **overruns** | `$2122` (u16) | updates that crossed a VBlank — more than one video frame |
| **worstUpdateLines** | `$2124` (u16) | the longest update, in scanlines |
| totalLines | `$2126` (u32) | the sum of all updates, in scanlines (for the mean) |

The counter draws nothing: it writes only those RAM cells, and the pictures
of the three captured toys are unchanged (tests/check-ilvm.js re-captured,
diff 0 against the browser, plus the light/heavy fixtures in
tests/check-measure-rom.js).

### How a length is measured

The TMA timer is seven bits, so its raw delta wraps every 128 counts
(131,072 CPU clocks = 1.10 video frames). The ROM also has the VBlank IRQ's
frame counter, so a bracket is reconstructed as

```
elapsed = frames * 116.52 ticks + phase,   phase in [0, 116.52)
```

(119,318 CPU clocks per frame / 1024 clocks per tick = 116.52; the timer
counts **down**, probed on Mednafen: 127, 80, 32, 112, 64 over a fixed spin).
The candidates `raw + 128k` are 128 ticks apart and the window is 116.52
wide, so exactly one fits. Both frame flows wait on the VBlank counter before
they start an update, which is what makes `phase` a remainder instead of an
unknown; the window is centred to absorb the few ticks between the VBlank
and the start. A per-raster-call bracket starts at an arbitrary phase, but a
call is well under one frame, so its raw delta is exact.

A timer tick is 1024 clocks; one of the console's 262 scanlines is
119,318 / 262 = 455.4 clocks. The scanline figure is `ticks * 9 / 4`
(0.07 % high), saturated at 65,535 lines.

**Overrun** is `frames != 0`: the VBlank after the update started arrived
before the update finished. That is the card's definition, not a derived
estimate: the IRQ itself is the witness.

### Two bugs this card found in the old measurement

The pre-#169 timer measurement (docs/IL.md §14.5) could not have been exact,
and the captures' numbers were wrong for two reasons:

1. **The IRQ read the wrong address.** It recorded the timer at `$1C00`,
   which is `$FF` on Mednafen, so `toy_vb_timer` was always 127 and the
   "phase at the VBlank" term was noise that averaged to zero. It now uses
   the window above instead of a VBlank timestamp; the timer is `$0C00`
   (`tools/toyc/toy_runtime.c` says so too).
2. **`tools/capture-ilvm.sh` divided the wrong sum.** `cycles_per_collection`
   used `raster_sum` (the per-call sum) instead of `collect_sum`, reporting
   8,157,505 cycles for parallax's collection where the bracket's own sum
   says 4,431,000. It also counted a raster call that straddled a VBlank as a
   whole extra frame (raw delta plus `frames * 116.5`), inflating the
   per-call mean from 19,774 to 36,072 cycles.

The corrected capture path is in the same commit: `tools/capture-ilvm.sh`
now records `collect_sum` and the new update cells in `meta.json`.

## Reading the counters back

`tools/measure-rom.js <rom.pce> [--frames N]` runs the ROM in Mednafen and
prints one JSON object:

```
{"frames":220,"overruns":220,"worstUpdateLines":653,"verdict":"too slow"}
```

`frames` is the number of **updates** measured (it is not the requested video
frame count; `--frames` asks the run to last that many video frames).
`tools/check-measure-rom.js` uses the same tool on freshly emitted ROMs.

### The readback route: save state, not a debug read

Mednafen 1.32.1 has no scriptable debug read. Its debugger is an interactive
on-screen UI, and the only machine-readable state it writes is the autosave
`.mca` on a clean exit. So the tool drives exactly the route this repo
already proves in `tools/capture-ilvm.sh`:

```
mednafen -autosave 1 ROM  ->  SIGINT  ->  <name>.<hash>.mca
  ->  tools/mcs-extract.py --ram  ->  ram.bin  ->  the cells above
```

A second, unproven channel (a debugger protocol) would buy nothing: the
counters are ordinary RAM, and the save state carries all 8 KiB of BaseRAM.
The run is windowless (`SDL_VIDEODRIVER=dummy`); no key or mouse event is
ever sent, and `MEDNAFEN_HOME` is a fresh `$TMPDIR` directory so another
run's config or save cannot be read.

### The verdict

The frame flows are paced by VBlanks, and the main loop waits for the next
VBlank after an update, so an update that fits one frame gives a 60 Hz toy
frame rate:

| verdict | condition | meaning |
|---------|-----------|---------|
| `60 Hz` | no overruns | every update finished before the next VBlank (≤ 262 lines) |
| `30 Hz` | overruns, worst ≤ 524 lines | an update needs more than one but at most two video frames |
| `too slow` | worst > 524 lines | an update needs more than two video frames (below 30 Hz) |

The thresholds are the same shape as ppu.toys' compiled-cost readout: a
30 Hz answer means "more than one video frame", and "too slow" is the tier
below it. `worstUpdateLines` decides the band; `overruns` says how often it
happens. (A toy whose worst is exactly two frames is reported as 30 Hz even
though its loop's extra VBlank wait makes the displayed cadence about three
frames — the counter measures the update, as the card asks, not the wait.)

## Estimate vs measured

`renderer/pce-validate.js` reports `budgets.route1` per toy: the validator's
compiled-cycle model times a factor measured on the *pre-#169* captures
(32.10 for no-raster, 25.94 for raster). The measured figures below are
`tools/measure-rom.js --frames 600` on ROMs emitted by `tools/ilvm/emit.js`
in this commit (Mednafen 1.32.1, 2026-10-31).

| toy | shape | update, measured (mean / worst lines) | frames per update | measured Hz | validator estimate (cycles, frames, Hz) | estimate ÷ measured |
|-----|-------|--------------------------------------|-------------------|-------------|------------------------------------------|---------------------|
| `tools/toys/palette.lua` | no raster | 629.5 / **653** | 2.49 | 24.1 | 238,985 · 2.00 · 29.96 | 0.80× |
| `toys/parallax.lua` | raster | 9,846.3 / **9,848** | 37.59 | 1.60 | 8,161,632 · 68.40 · 0.88 | 1.82× |
| `toys/status-bar.lua` | raster | 4,444.4 / **4,446** | 16.97 | 3.54 | 7,140,452 · 59.84 · 1.00 | 3.53× |
| `toys/sky-gradient.lua` | raster | 14,636.2 / **14,886** | 56.82 | 1.06 | 8,690,652 · 72.84 · 0.82 | 1.28× |

All four verdicts are **`too slow`** (every update crossed a VBlank, and every
worst update is past two video frames). The measured collections agree with
the recaptured dumps: parallax's 224-call collection is 4.48 M cycles by the
counter and 4,475,066 by `tools/capture-ilvm.sh`; status-bar's is 2.02 M and
1,994,069. The old IL.md figures were 8.16 M and 3.78 M for the same
collections (the wrong-`sum` bug above).

### What the gap says, plainly

- **The no-raster estimate is 20 % low.** The palette toy's average update
  is 2.36 frames (worst 2.49), not the 2.00 the old capture measured; its
  factor should be 37.8 (281,382 / 7,445), not 32.10. The old factor was
  calibrated against the phase-noise mean, which under-counted a multi-frame
  `frame()` by about 0.36 frames.
- **The raster estimate is 1.3–3.5× high.** The parallax factor should be
  14.2 (4,475,066 / 314,443), not 25.94, because both of its inputs were
  inflated: the collection was divided from the wrong sum, and raster calls
  that straddled a VBlank were charged a whole frame. Status-bar, the
  held-out toy, is overestimated by 3.5×; sky-gradient by 1.3×.
- **The direction of the answer is still right.** Every toy here is far from
  60 Hz on the interpreter route in both the estimate and the measurement;
  no toy is one VBlank away from a wrong verdict. The magnitude is not:
  parallax is 1.6 Hz, not 0.88 Hz; status-bar is 3.5 Hz, not 1.0 Hz.
- **Recalibrating `pce-validate.js` is a later card.** These two factors are
  what the studio's export dialog and the SCANLINES panel show, and a
  studio readout is explicitly out of #169. The correct constants, from
  this measurement, are `NO_RASTER = 37.8` and `RASTER = 14.2`; the held-out
  status-bar error at 14.2 is 1.96×, so `tests/check-validate.js`'s "inside
  2×" bound survives the recalibration by a hair — but its recorded
  `STATUS_MEASURED` (3,780,450) is a pre-#169 number and should move to
  1,994,069 with the factor.

## What is not proven

- **Mednafen only.** No real hardware (Tang Nano / flash cart: a later card),
  no ares run of a bytecode ROM.
- **One save state per run.** The counters accumulate from boot to the
  SIGINT; `--frames` controls how long that is, and boot time (about a
  second) is included in nothing but the run's length. The worst update is
  the max over the run, so a very rare slow update needs a long run to show
  up.
- **The VBlank counter is eight bits.** An update longer than 255 video
  frames (about 4.3 s) wraps its frame count and would be reported short;
  `worstUpdateLines` saturates at 65,535 lines (about 250 frames), so an
  update in that region is "too slow" either way. No measured toy comes
  close (the longest is sky-gradient at 57 frames).
- **Quantisation.** One timer tick is 1024 clocks = 2.25 scanlines; a figure
  is good to about one tick (the two calibration runs for palette differed
  by 5 lines, 0.2 %). Overruns are exact.
- **A per-raster-call bracket longer than 128 ticks would alias.** Measured
  calls are 8.7 k–19.8 k cycles (8.5–19.3 ticks), nowhere near that.
- **The soft stack must not reach `$2120`.** The cells sit just above the
  pre-existing `$2100` measurement block, below the linker's RAM at `$2200`
  and below the soft stack's deepest use. A canary at `$2116`–`$211F`
  survived all four toys (palette, parallax, status-bar, sky-gradient); the
  safety argument is in docs/ROM_LAYOUT.md. **Re-run by #175 on the image
  that carries the table pool** (256 int32 cells, 1,024 B in `.bss`;
  `tools/gen/ilvm.json`'s `section_sizes`/`table_pool`, `.bss` 6,529 B): a
  scratch build of the same sources wrote `A5 A4 A7 A6 A1 A0 A3 A2 AD AC` at
  `$2116` in `main()` before `toy_boot()`, and the save-state BaseRAM after a
  Mednafen run of each toy held those ten bytes unchanged (palette 121
  updates, parallax 8, status-bar 18, sky-gradient 7). Control: the same
  build with one deliberate write to `$2116+3` after `toy_boot()` read back
  `A5 A4 A7 00 A1 A0 A3 A2 AD AC`, so the instrument does see a breach.
- **Rule 2 is owed.** Per the workshop rule, this suite's breaks were written
  by the same seat that wrote it (`tests/check-measure-rom.js`: a heavy toy,
  a light toy, a middle-band toy, and two pictures). A cold break by another
  seat and model is owed before the card closes; the places to attack are
  the timer-direction probe, the `$0C00`/`$1C00` distinction, the
  `after_vblank` window, and the verdict thresholds.
