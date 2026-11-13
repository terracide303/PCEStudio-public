# The console's real speed, measured (card #169)

> Asked on 2026-10-31: "we can use an emulator as well to do the same" (as
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

## The real games, measured (cards #180, #207)

**Re-measured 2026-11-01 by #207**, on the tree after the sprite (#188–#192)
and sound-front-end (#197) cards; **re-pinned 2026-11-02 by #221** after
#220/#221 landed the sound interpreter, **again by #200** after the
trace image's two glue fixes (#238's F byte, #239's `.bss`), **again by
#113** after the R1 write moved the image, and **again by #282** after
#280/#281 moved it (the banked container and COPYV).  The image is the
32 KiB one with the HuTrack banks and the toy data bank is physical 4,
so every ROM is **40,960 B**; the shas in the table are the ones
`tests/check-export-games.js` pins on the new image (2026-11-13, image
sha256 `b39d4266070eb4e4…`, #280/#281).  The overrun/worst figures are
re-measured on that image by #282's run: every toy's picture is unchanged
(the old/new diffs are in BANKED-DATA §5.9), but an interpreted update's
cost moved by a few per cent.  #221's old/new Mednafen diffs are
in [`ROM-SOUND.md`](ROM-SOUND.md) §10, #282's in
[`BANKED-DATA.md`](BANKED-DATA.md) §5.9.
What moved on 2026-11-02: **#215**'s interpreter reads the version 3
container, and **#222** raised DUSK RUN's capacities, so it loads, runs and
draws. What moved on 2026-11-03: **TOWER and STARFALL were reworked in
place** for the gallery export (7,862 B and 6,285 B of bytecode, no capacity
over), so both build; TOWER's Mednafen picture is the browser's. What moved
on 2026-11-04: **#227** made the raster display continuous and put each
line's write inside the blank, so DUSK RUN's picture is the browser's too
(see its row), and **#284** re-routed
`tests/check-export-games.js` to the studio's Export button — the CONSOLE
tab's checks, then the encoder and the build with the toy's asset tail —
so this table's *exports?* column is now the Export dialog's verdict, not
the MCP's. What moved on 2026-11-13: the cgen step (b8cefc2) lowered
`unm`/`bnot`/`not`, so the dialog's `unm` refusals are gone — NOVA TIDE's
refusal moved to its `raster(0, …)` call and DUSK RUN builds. Then **#288
put the art into banks** (the encoder step and the copyv prologue,
[`BANKED-DATA.md`](BANKED-DATA.md) §5.10): STARFALL's `toy-data-bank-full`
refusal is gone — its 6,285 B bytecode and 68,702 B of art no longer share
the one data bank — and its ROM carries the art on the bank after the
container. The dialog refuses only **NOVA TIDE** `cgen-op` (its
`raster(0, …)` call), and builds **STARFALL**, **TOWER**, **PLATFORMER**
and **DUSK RUN**. **#148** (the
127-constant pool) remains open; **#216** (a sound toy on a console) and
**#200** (the Mednafen trace) are closed on [`ROM-SOUND.md`](ROM-SOUND.md)
§11 and §8. The `TRACE=1` build is test-only — it refuses to write
`renderer/ilvm.bin` — so every figure here is the shipped non-trace image;
the trace changes no toy's picture.

The #169 table above measures four example toys. This one asks the question a
person asks about the *games*: **does the Export button build STARFALL,
TOWER, NOVA TIDE, DUSK RUN and PLATFORMER, and if it did, what would the
console do with the ROM?** It is measured by `tests/check-export-games.js`,
which since #284 builds the five games the way the studio's Export button
builds them — the gallery's file set, the CONSOLE tab's three stages, then
the encoder and the build with the toy's asset tail:

```
renderer/pce-il.js -> renderer/pce-validate.js (8 frames)
  -> renderer/pce-cgen.js             [the CONSOLE tab; any error finding
                                       refuses, exactly as the dialog blocks]
  -> renderer/pce-ilbc.js -> renderer/pce-rom.js buildToyRom
     with the toy's asset tail
```

over the committed `renderer/ilvm.bin`; no compiler is called. The file
set is the gallery's (`renderer/gallery-toys.js`, the data the page
loads), and the asset tail is the page's `exportAssetTail()` envelope:
tiles, palettes, sprites and any other non-default project file, UTF-8
JSON after the bytecode. A refusal here is the dialog's, with its exact
text, so a refusal in the studio is a refusal in the test. A game the
dialog refuses whose interpreter ROM is still worth measuring (STARFALL)
is built by the MCP's `export_pce` route instead — no C emitter,
no assets — and pinned `bytecodeOnly`: that row's ROM sha and picture are
that route's, and the suite says so, never "exports". The controls
(`tools/toys/*.lua`) also run `export_pce`'s route. The static
estimate is `renderer/pce-validate.js`'s `budgets.route1` for the same source.
"overruns", "worst update" and the verdict are `tools/measure-rom.js
--frames 300` (the #169 instrument; a game whose one-time build outlasts
300 frames is measured at the frame count its row records) and the picture
is a `-qtrecord` capture under the dummy SDL driver, cropped to 256x224 and
compared with `renderer/pce-toys.js`'s frame of the same toy — the
`tools/capture-ilvm.sh`/`tests/check-ilvm.js` route, no input sent.

| toy | exports? | picture matches? | overruns | worst update | verdict | validator's static estimate |
|-----|----------|------------------|----------|--------------|---------|-----------------------------|
| **STARFALL** `toys/demo-game` | **yes — #288 put the art into banks.** 49,152 B (image 32 KiB + container + one 8 KiB art bank), sha256 `2d9290d7f620cfea6c1f72ea542198225faecc59197317d34587adea1aa9fb13`, built by the studio's Export. The toy's three art files go through the importer's picture path into one **5,520 B blob** (CRAM, BAT, SAT, then the tile/pattern span — 5 tiles, 14 patterns, 17 sprites) on the bank after the container, and the encoder prepends a **33 B prologue** of copyv/reg ops that loads BAT, SAT and the span before the toy's first instruction (the CRAM bytes are carried, not loaded — the toy writes the same CRAM itself, the measured claim in [`BANKED-DATA.md`](BANKED-DATA.md) §5.10). The container grew 6,285 → 6,318 B, constants 111 → 113 of 127. The bytecode is the toy reworked in place for the gallery export (#273, 2026-11-03): 6,285 B in the 8,160 B data bank (77.0%), 17 functions, 21 registers, 35 boot upvalue cells, 24 globals, 4 arguments, no row over — the bytecode always fit; the refusal was the 68,702 B of art files needing the same bank, which #288's art banks removed (the maintainer's 2026-11-04 click). The game is the same: the art block computes its VRAM addresses (225 literals became loops), the palettes are `rgb()` calls, the sprites are four `sat()` words instead of a spec table, the split is the `raster(line)` callback (the table form is refused), and the ship's collision is the drone array's box instead of `sr()`/`abs()`, which neither route carries. A scripted 600-frame old-vs-new run and the 600-frame still run are pixel-identical, the still run losing its one life at the same frame 365. **`bytecodeOnly` (the MCP's route, art left out — the old table's "yes"):** 40,960 B, sha256 `5984b3246858d286…`, built and sha-pinned by the suite (the art ROM's measure and capture carry the interpreter's picture evidence; the two ROMs differ only by the prologue, measured pairwise in [`BANKED-DATA.md`](BANKED-DATA.md) §5.10). **The console picture is close but not the browser's:** #227's replay is fixed (the last complete picture is on every display frame, so the capture's tail is a real frame, not the collection's static screen), the prologue's load is display-neutral (the host proof is word-for-word diff 0 at two frames, [`BANKED-DATA.md`](BANKED-DATA.md) §5.10), and the capture shows the game drawing — but no captured frame is the browser's; the closest is browser frame 23, **419 bytes off** (the pre-#280 image measured 48 bytes, two columns, at a different sampled game frame; the bytecode-route image 24 bytes, one column, 2026-11-13). What those bytes are is named and measured in [`BANKED-DATA.md`](BANKED-DATA.md) §5.10; the pin stays `unmatched`, so it cannot claim a picture it does not have. | **no — 419 bytes at the closest browser frame (23)** | **24** | **6,896** lines | **too slow** (24 updates in 600 frames) | **279,353 cycles · 2.34 frames · 25.6 Hz** — the studio's `validate-slow-frame` warning (reported, not refused); the route-1 raster projection stands at 7,246,417 cycles · 60.73 frames · 0.99 Hz |
| **TOWER** `toys/tower` | **yes** — 40,960 B, sha256 `1b1d151ae2fbdd35…`; built by the studio's Export since #284 (it has no art files, so the asset tail is empty and the C emitter accepts the toy — the ROM is the bytecode route's bytes). Reworked in place for the gallery export (2026-11-03): 7,862 B of bytecode in the 8,160 B data bank, 27 functions, 32 registers, 47 boot upvalue cells, 6 arguments, and no row over its interpreter capacity. The art is still drawn by the toy; the rework merges the thirteen art callbacks into four generators, writes the background map as floor/ladder runs (blank cells stay at the runtime's zero, the same blank tile) and computes only the two sprite planes this art uses. The first 12 frames are one picture (the gem starts bobbing at 12), so the capture's tail is diff 0 against the browser's early frame. | **diff 0** — the captured tail is the browser's early picture | **70** | **2,772** lines | **too slow** (70 updates in 1,800 frames: the ~20 s one-time build, then ~5 updates a second) | 485,384 cycles · 4.07 frames · **14.7 Hz** (the model, not the console; the interpreted build and frames are much slower) |
| **NOVA TIDE** `toys/nova-tide` | **no — the studio's Export refuses `cgen-op`: "function fn@513, IL line 530, instruction \`raster\`: not lowered by this backend (…)"** (`main.lua:530`; #284's exact text, asserted whole in the test — the refusal was `unm` at `main.lua:29` until the 2026-11-13 cgen step lowered `unm`/`bnot`/`not`, which moved NOVA TIDE on to its `raster(0, { bxr = 0 })` call; the C backend carries the hook form `raster(line)` but not the two-argument spec call). The MCP's route has no C emitter and stops at the same instruction: `ilbc-op: instruction raster (function 34, pc 53) has no bytecode form` (`main.lua:530`; refused by `renderer/pce-ilbc.js:335` because `raster` has no entry in its OPS table — #186 carried `sat`, #197 carried `note` and `sfx`, its old refusals; `raster(line, spec)` is the next uncarried kind, #136). Since #288 its 192,089 B art tail
would ride on 24 art banks instead of the data bank, so carrying
`raster` is now the only refusal left between NOVA TIDE and an export.
| — | — | — | — | 621,873 cycles · 5.21 frames · **11.5 Hz** |
| **DUSK RUN** `toys/dusk-run` | **yes** — 40,960 B, sha256 `2a569de95c3a1bfb…`; built by the studio's Export since the 2026-11-13 cgen step lowered `unm`/`bnot`/`not` (before it, the dialog refused `cgen-op` at `main.lua:62`'s `unm`). DUSK RUN has no art files, so the asset tail is empty and the ROM is the bytecode route's bytes — the sha this pin held as `bytecodeOnly` (the old table's "yes"). #222 raised `MAX_REGS` 41 / `MAX_FUNCS` 41 / `MAX_UPS` 20 (upvalue pool) / `MAX_CLOS` 48 (boot/transient split), so the container loads and executes; a Mednafen save state at 20 s is VRAM/CRAM/SAT **diff 0 against browser frame 3**, and the host harness matches for 900 frames. The runtime's base-VRAM buffer (32 words a frame) was dropping DUSK's 64/68/208-word build frames; it now writes an over-buffer word through instead ([`ROM-SOUND.md`](ROM-SOUND.md) §10). **#227 fixed the raster display:** the line chain is re-armed at every VBlank while a toy frame runs, so the last complete picture is on screen on every display frame (before, one frame in ~37 — DUSK's build step — replayed it and a capture's tail was the static screen), and the line entry is preloaded into zero page one scanline early, which puts the per-line colour write inside the blank (before, its last store completed ~28 CPU cycles late and the first 16 pixels of row 16 kept the old colour). `tests/check-export-games.js` now pins the ROM sha and **the browser-frame hashes**: at the 12 s capture the picture is diff 0 against browser frames 1–6 (one static early picture, hash `3584516448`). #184's validator note still applies: the 8-frame probe measured the BUILD (frame 7 = build step 7, 675,190 cycles), and the 300-frame performance is 390,744 cycles (18.3 Hz), so the validator accepts the toy. | **diff 0** — the captured tail is the browser's early picture (frames 1–6, one hash) | **1** | **65,535** lines | **too slow** (1 update in 600 frames, the ~7 s boot) | 10,135,899 cycles · 84.95 frames · **0.71 Hz** (steady-state projection; the build frame projected 229.2 frames · 0.26 Hz) |
| **PLATFORMER** `toys/platformer` | **yes** — 40,960 B, sha256 `ccc5f20a1405816a…`; built by the studio's Export since #284 (it has no art files, so the asset tail is empty and the C emitter accepts the toy — the ROM is the bytecode route's bytes). Reworked in place for 60 Hz (2026-11-04): 2,522 B of bytecode in the 8,160 B data bank (30.9%), 46 constants (36.2%), 11 functions, 30 registers (73.2%), 5 upvalues, 10 boot upvalue cells, 14 globals, 2 arguments — no row near or over, and the busiest is registers at 73.2%. The game is unchanged — same art, same level rule, same 1/16-pixel physics — but frame() runs 74 IL instructions instead of 110: division by a power of two is a shift (the interpreter's `idiv` is a soft routine costing about seven instructions' worth of time), the jump button is read once instead of three times, `cell()`'s "is there anything here" is inlined as the hero's feet span meeting a row's solid cells (the map drawing still calls `cell()`), each clamp moved inside the move that can leave the screen, and the SAT pattern word is written once in `init()` because it never changes. | **diff 0** — a captured frame is the browser's static no-input scene, hash pinned | **0** | **194** lines | **60 Hz** (573 updates in 900 frames) | 73,445 cycles · 0.62 frames · **97.5 Hz** |
| *control* `tools/toys/palette.lua` | **yes** — 40,960 B, sha256 `f605155a3c66bbb1…` | **diff 0** (a captured frame is a browser frame; its 8-frame cycle is pinned) | 55 | **1,343** lines | **too slow** | 238,985 · 2.00 · 29.96 (#169's row) |
| *control #183* `tools/toys/arity.lua` | **yes** — 40,960 B, sha256 `9c94805b4b017dc7…`, a 5-8 parameter toy | **diff 0** (16-frame cycle pinned) | 81 | **1,022** lines | **too slow** | — |
| *control #187* `tools/toys/not.lua` | **yes** — 40,960 B, sha256 `385636cbd6c796f1…`, a toy whose picture is painted by the logical `not` | **diff 0** (4-picture cycle pinned) | 0 | **153** lines | **60 Hz** | — |
| *control #191* `tools/toys/sprite.lua` | **yes** — 40,960 B, sha256 `8904eabd3c067460…`, three constant sprite specs (the full spec; a partial one with `hflip`/`cgx`; `spbg`/`cgy`/`vflip`), so `sprite()` is carried end to end (#188 encoder, #189 interpreter, #190 cgen) | **diff 0** (its constant picture is pinned as one hash; `tests/check-ilvm.js` also compares the saved SAT word for word) | 0 | **110** lines | **60 Hz** | — |

### What this says, plainly

- **PLATFORMER exports — the first game that does (#186) — and now holds
  60 Hz.** Carrying `sat` was its last route-1 gap: the interpreter writes
  the SATB words a compiled toy writes, the ROM builds, and Mednafen's
  picture is the browser's (the static no-input scene — the hero standing on
  the grass — is pinned).  It measured **30 Hz** until the 2026-11-04
  rework (`main.lua` trims frame() from 110 IL instructions to 74; none of
  the game, art or numbers moved): 537 updates in 900 frames, **0
  overruns, worst 212 lines, mean 209.5**.  The interpreter's per-operation
  cost is what made the old version miss: each instruction costs it ~2.8
  scanlines, and one `//` on a constant costs ~19 lines more than a `>>`.
  The rework's frame loses only the interpreter's work — a 600-frame
  scripted and a 9,958-frame scripted old-vs-new run are pixel- and
  state-identical, through both the Lua and the IL runtime.  Two of #186's
  console details are in the row's fine print: the one-time build (`init()`
  draws the whole map and the sprite patterns through the interpreter)
  still takes ~7 s, so the measure needs 900 frames and the capture 12 s to
  clear the boot — the default 300-frame measure reads 0 updates mid-boot;
  and the interpreter's display-on keeps the toy's CR, so the sprites' SB
  bit survives `toy_display_on` (`docs/IL.md` §14, the compiled runtime's
  `toy_cr` shadow).
- **The studio's Export button's verdicts are the table's now (#284), and
  one of them is a refusal.** The dialog refuses **NOVA TIDE** `cgen-op`
  (its `raster(0, …)` call, `main.lua:530` — until the 2026-11-13 cgen
  step its refusal was `unm` at `main.lua:29`) and builds **STARFALL**,
  **TOWER**, **PLATFORMER** and **DUSK RUN**.  STARFALL's refusal was
  `toy-data-bank-full` — its 6,285 B bytecode plus its 68,702 B of art
  (tiles, palettes, sprites) need 74,987 bytes, and the interpreter reads
  one 8 KiB data bank — until **#288** moved the art into whole banks
  after the container (the 5,520 B blob and the copyv prologue,
  [`BANKED-DATA.md`](BANKED-DATA.md) §5.10); the bytecode itself always
  fit (the #273 rework).  TOWER, PLATFORMER and DUSK RUN — the games
  with no art files — keep the bytecode route's bytes.  Before #284 the
  table's "yes"
  for STARFALL and DUSK RUN was the bytecode route's answer; DUSK RUN's is
  the studio's answer again since 2026-11-13, and STARFALL's is now the
  studio's answer too (art included); its bytecode-route ROM is still
  built and sha-pinned (labeled `bytecodeOnly`, art left out), so
  the interpreter evidence is kept on both routes.
  TOWER's one-time build draws the tower in about 20 s of wall
  and a frame then takes about 11 video frames (~5 updates a second) —
  the interpreter's speed, not a game rule.  STARFALL's console
  picture: before #227 its armed replay was 16 bytes off on row 24 (the
  split line's palette write) and 372-632 bytes off on the moving picture
  rows; after it the closest browser frame was 24 bytes off on the #280/#281
  image (48 before it, at a different sampled game frame; one one-pixel
  column in the bar's first tile row, cause not proven), and the art ROM's
  capture lands at a different game frame (browser frame 23) at **419
  bytes** — named and measured in [`BANKED-DATA.md`](BANKED-DATA.md) §5.10 —
  so it is still pinned `unmatched`.
  DUSK RUN's container fits the interpreter's arrays (#222:
  41 registers, 41 functions, a 19-upvalue closure, 27 boot closures), its
  VM state is byte-equal to the browser's, the runtime's dropped
  build-frame writes are fixed, and #227 made its displayed picture the
  browser's (diff 0, frames 1–6's one early picture). `tests/check-export-games.js` pins the
  browser-frame hashes where it has them and the not-black/not-a-browser-frame
  pair only where it does not, so a verdict cannot silently change. #186 moved TOWER,
  NOVA TIDE and DUSK RUN past `sat`, #187 moved DUSK RUN past logical
  `not`, #188–#190 carried `sprite` itself for every spec whose slot and
  fields are constants, #197 moved TOWER and DUSK RUN past `sfx` and NOVA
  TIDE past `note` and `sfx`, the 2026-11-13 cgen step (b8cefc2) moved
  DUSK RUN past `unm`/`bnot`/`not` (NOVA TIDE's refusal is its
  `raster(0, …)` call now), and #215's interpreter reads the version 3
  container, so the table's outcomes are each the toy's next real gap, not
  one shared one.
- **DUSK RUN's validator refusal was the probe, not the toy (#184).** The
  export validates with an 8-frame run and judges its last frame; DUSK RUN
  builds its landscape over 137 frames, so frame 7 is build step 7 and costs
  675,190 cycles of `frame()` plus the 379,102-cycle raster collection.  The
  same model over the studio's default 300-frame performance (Length, #144)
  samples the game: 390,744 cycles = 3.27 display frames (18.3 Hz), the
  18.3 Hz `tests/check-dusk-run.js` already recorded at 600 frames.  The
  validator now runs a refused probe on to 300 frames before refusing; the
  8-frame ceiling still refuses a toy that is over it in its steady state
  (`tests/check-validate.js` V07).  DUSK RUN reaches the bytecode encoder
  and, with #187 carrying logical `not` and #197 `sfx`, encodes fully;
  #215's interpreter reads its version 3 container and #222's capacities
  carry its 41 registers, 41 functions and 19-upvalue closure, so
  `buildToyRom` builds the ROM and the console now shows the game (the
  row's diff 0).  The studio's Export builds it too now: the 2026-11-13
  cgen step lowered `unm`/`bnot`/`not`, so its old `cgen-op` refusal at
  `main.lua:62` is gone.  Its **route-1**
  projection is still 0.71 Hz steady-state (84.95 frames per update) — the
  compiled-route estimate is what the validator prices; the export builds
  the interpreter.
- **The static estimate is still an estimate.** It is the same
  `pce-validate.js` factor pair #169 measured to be 20 % low (no raster) and
  1.3–3.5× high (raster). It orders the games but cannot give a verdict;
  only a built ROM can, and PLATFORMER's was the first: 30 Hz where the
  model's route-1 pricing said 81.2 Hz, the interpreter's per-operation
  cost the model does not price.  After the 2026-11-04 rework the ROM
  reads 60 Hz and the model says 97.5 Hz — still the same direction, the
  model pricing an instruction cheaper than the interpreter spends.
- **The studio refuses earlier than the MCP on NOVA TIDE, and since #284
  the table reports the studio.**  Its Export runs
  `renderer/pce-cgen.js` first: NOVA TIDE stops on `cgen-op`
  `raster` (`main.lua:530`; until the 2026-11-13 cgen step lowered
  `unm`/`bnot`/`not`, it stopped one instruction earlier on `unm` at
  `main.lua:29`) before the encoder; the MCP's
  `export_pce` (no C emitter) gets NOVA TIDE as far as `ilbc-op` (`raster`
  at `main.lua:530`) and builds STARFALL's bytecode ROM (no art — the MCP
  has no asset tail) and DUSK RUN.  STARFALL's rework
  removed `abs` and `sr()` (neither route carries them), replaced the
  `sprite()` specs the C walker could not pin with `sat()` words, and moved
  the status-bar split to the `raster(line)` callback both routes carry;
  TOWER's rework removed its logical `not` — so TOWER, PLATFORMER, DUSK RUN
  and (up to the assets) STARFALL pass the C emitter.  The suite builds the games
  the studio's way, so the dialog's verdict is the table's; the MCP
  route's own verdicts (NOVA TIDE's `ilbc-op`, STARFALL's bytecode ROM)
  are still pinned alongside, labeled `bytecodeOnly`.
- **Carrying the first refusals would not finish the job.** #178's
  projections put STARFALL at 9,186 B, TOWER at 8,379 B and NOVA TIDE at
  9,287 B — all over the interpreter's 8,192-byte data bank (#138), before
  the still-refused kinds (`sfx` #135, the `raster` table #136, the builtins
  other than `rgb` #137) are counted. STARFALL's figure is #178's 8,969 plus
  #188's `sprite` at its real 7 B (31 × 7 = 217 B); the instruction is
  carried, the 10 specs the walker cannot pin are not. DUSK RUN (7,385 B)
  fits, PLATFORMER (2,351 B) fits and now builds. The 2026-11-03 reworks
  brought the other two under the bank: TOWER to 7,862 B and STARFALL to
  6,285 B (a computed art block, `sat()` words and the callback split) —
  and #284's measurement shows the bank's other occupant: the toys' art.
  STARFALL's bytecode fits the 8,160 B bank; its 68,702 B asset tail does
  not (74,987 B together), and NOVA TIDE's tail is 192,089 B.  The
  banked-data work (#279–#281) landed that question as **#288**: the art
  no longer shares the bytecode's bank at all — the studio's Export
  carries each toy's art on whole banks after the container (STARFALL's
  5,520 B blob; [`BANKED-DATA.md`](BANKED-DATA.md) §5.10), so carrying
  the remaining refused kinds for NOVA TIDE would now export its art too
  (its 192,089 B tail fits 24 banks).

### The cards this measurement added

Per the card, nothing here is fixed in this one. The refusals that remain
are on the board: **#148** (the 127-constant pool, already open),
**#183** (closed 2026-10-31: the 4-parameter ceiling is gone; TOWER and NOVA
now stop on `sat`), **#184** (closed 2026-11-01: DUSK RUN's refusal was the
8-frame probe sampling its build; the probe extends to the 300-frame
performance, so the toy reaches the encoder), **#185**
(closed 2026-11-01: padref/padget carried), **#186** (closed 2026-11-01:
`sat` carried, PLATFORMER builds and measures 30 Hz — the first game
export), **#187** (closed 2026-11-01: logical `not` carried; DUSK RUN
moves to its first `sfx`, TOWER's pin survives — its sfx is scanned first)
and **#197** (closed 2026-11-01: `note` and the `sfx` instruction carried;
so TOWER and DUSK RUN's bytecode routes encoded fully, and at that point
stopped at the version 3 sound-container gate; NOVA TIDE moved to its first
`raster`). **#215**, **#220** and **#221** (2026-11-02: the sound
interpreter landed and the version 3 container is read; TOWER moved on to
the data bank and DUSK RUN built — the black-screen verdict above — and
**#222** is the interpreter-capacity card the verdict added).
The rest are the existing #133–#138 umbrellas.

### The cards #207 added (the refusals this re-measurement leaves)

Every refusal below is measured on this tree; the first three had no card of
their own, the rest already did:

- **#209** — the C route has no logical `not` (`cgen-op` at
  `renderer/pce-cgen.js:697`; DUSK RUN `main.lua:401` — TOWER's rework
  removed its `not`, so the card now names one toy),
  though route 1 has carried opcode 0x11 since #187.
- **#210** — the C route has no unary minus (`cgen-op` at
  `renderer/pce-cgen.js:697`; NOVA TIDE `main.lua:29`, DUSK RUN
  `main.lua:62`), though route 1 carries `unm`.
- **#211** — STARFALL's ten `sprite()` specs the constant walker cannot pin
  (`cgen-op` at `renderer/pce-cgen.js:590-635`: pattern from a call or a
  global, a runtime `x`, specs rebuilt in a loop). #188–#192 carried the
  instruction for constant specs only; this card asks the lowering question
  first, so it is backlog, not `QUEUE: auto`.
- Already open: **#148** (the 127-constant pool, `renderer/pce-ilbc.js:462`),
  **#136** (`raster(line, spec)`, `renderer/pce-ilbc.js:335`), **#137** (the
  builtins other than `rgb`/`note`, `main.lua:466` and `:570`), and (from
  this re-measurement) **#222** (DUSK RUN's interpreter capacity). The
  sound umbrella **#198** is closed: the engine is linked, both toys run in
  Mednafen (#216) and their writes match the studio's (#200,
  [`ROM-SOUND.md`](ROM-SOUND.md) §8); #113 now writes the PSG's R1 `$FF` and
  §11's committed-image WAVs are audible.

## ROM CHECK: the five games' exact blockers (card #193)

`renderer/pce-romcheck.js` runs the two cartridge front ends over a toy's
`main.lua` without building anything: the C backend's check
(`renderer/pce-cgen.js`, what the studio's Export adds on top of the bytecode)
and the bytecode encoder's check (`renderer/pce-ilbc.js`, the interpreter
image every exported `.pce` carries). It returns every refusal at once, with
its Lua line. The same code is the studio's ROM CHECK drawer and the MCP tool
`rom_check`; the tables below are that tool's output on the five games at
this commit. **Re-run by #207 on 2026-11-01** (the MCP server over stdio, and
`renderer/pce-romcheck.js` directly): every row below is unchanged — same
codes, same lines. The 2026-11-03 gallery rework moved TOWER and STARFALL
to `ok:true`; their old refusal rows are git history. **Re-run by #282 on
2026-11-13** after the cgen step (b8cefc2) lowered `unm`/`bnot`/`not`:
NOVA TIDE's `unm` row is gone (its first C-route refusal is now
`raster(line, spec)` at 530-534, the same construct the bytecode route
refuses) and DUSK RUN's two C-route rows are gone — `ok:true` on both
routes. `ok:true` is the two
front-end lists only — `rom_check` does not count the toy's art, so it
cannot see STARFALL's data-bank refusal (the studio's Export does; it is
the `toy-data-bank-full` row in the games table above, #284). `line` is the Lua line
in `main.lua`; a repeated construct lists every line it occurs on.

| toy | route | code | lines | blocker |
|-----|-------|------|-------|---------|
| **STARFALL** | — | — | — | **none: `rom_check` answers `ok:true`** (reworked in place, #273: the `sprite()` specs became `sat()` words, `abs`/`sr()` became array arithmetic, the `raster(line, spec)` table became the `raster(line)` hook, and the art block's 225 literal addresses became loops) |
| **TOWER** | — | — | — | **none: `rom_check` answers `ok:true`** |
| **NOVA TIDE** | C compiler | `cgen-op` | 530, 531, 532, 533, 534 | `raster(line, spec)` |
| | bytecode | `ilbc-op` | 530, 531, 532, 533, 534 | `raster(line, spec)` |
| **DUSK RUN** | — | — | — | **none: `rom_check` answers `ok:true`** (the 2026-11-13 cgen step lowered `unm`/`bnot`/`not`, closing the C route's two old rows at 62 and 401) |
| **PLATFORMER** | — | — | — | **none: `rom_check` answers `ok:true`** |

### What the table says, plainly

- **PLATFORMER, TOWER and STARFALL are carried by both routes.** That agrees
  with #180's measurement: PLATFORMER's export builds and runs at 30 Hz,
  TOWER's reworked bytecode builds and matches the browser's picture, and
  STARFALL's rework (#273) removed every construct no route carried — the
  ten unpinnable `sprite()` specs, `abs`, `sr()` and the `raster(line, spec)`
  table — so its two front-end lists are empty and its bytecode builds and
  draws, though its console picture is the raster latency above, not the
  browser's yet.  What `rom_check` cannot see: the studio's Export also
  carries the toy's art, and STARFALL's 68,702 B asset tail over the
  6,285 B bytecode is the `toy-data-bank-full` refusal in the games table
  above (#284) — `rom_check` answers the construct question, not the
  asset question. NOVA TIDE stops on constructs no
  route carries yet: `raster(line, spec)` (both routes — the C route
  carries the hook form `raster(line)`, not the spec call), and the
  builtins other than `rgb`/`note` (the C route). DUSK RUN's lists are
  empty now (`ok:true` on both routes since the 2026-11-13 cgen step
  lowered `unm`/`bnot`/`not`), its container fits the bank, and its ROM
  builds and shows the browser's picture (the games table's diff 0).
- **The two routes differ, and that is the point of checking both.** NOVA
  TIDE's `raster(line, spec)` calls are refused by both routes, while the
  bytecode opcode table carries `not`, `unm`, `sfx`,
  `music` and `release` (not `raster`). NOVA TIDE's MCP `export_pce` is
  therefore stopped by its `raster`, exactly as the C route is; DUSK
  RUN's bytecode list was already empty and its C-route list emptied when
  `unm`/`bnot`/`not` were lowered (2026-11-13), and its ROM builds
  (a toy is
  exportable by the studio only when both lists are empty, and by MCP
  `export_pce` when the bytecode list is and the built container is one the
  committed interpreter runs.
- **These are front-end findings, not a verdict on speed.** The ROM's frame
  rate is the #169/#180 measurement (`tools/measure-rom.js`); this table says
  only whether the ROM can be built, and the exact constructs that stop it.
- The carried and refused feature lists the check reports come from the
  compilers' own `FEATURES`/`REFUSALS` tables, so a card that carries one of
  these constructs moves it from refused to carried in the check, the drawer,
  the MCP tool and the generated docs together.

## What is not proven

- **Mednafen only.** No real hardware (Tang Nano / flash cart: a later card),
  no ares run of a bytecode ROM.
- **One save state per run.** The counters accumulate from boot to the
  SIGINT; `--frames` controls how long that is, and boot time (about a
  second, or the ~7 s a game that draws its whole map through the
  interpreter needs — PLATFORMER's measure and capture lengths clear it)
  is included in nothing but the run's length. The worst update is
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
  that carries the table pool** (then 256 int32 cells, 1,024 B in `.bss`;
  `tools/gen/ilvm.json`'s `section_sizes`/`table_pool`, `.bss` 6,529 B): a
  scratch build of the same sources wrote `A5 A4 A7 A6 A1 A0 A3 A2 AD AC` at
  `$2116` in `main()` before `toy_boot()`, and the save-state BaseRAM after a
  Mednafen run of each toy held those ten bytes unchanged (palette 121
  updates, parallax 8, status-bar 18, sky-gradient 7). Control: the same
  build with one deliberate write to `$2116+3` after `toy_boot()` read back
  `A5 A4 A7 00 A1 A0 A3 A2 AD AC`, so the instrument does see a breach.
  **#214 moved the deepest cell**: the pool is 192 cells (768 B), the HuTrack
  engine's `.bss` now sits at `$37CE-$3BF4` (docs/ROM-SOUND.md §5), and the
  new canary (`tools/ilvm/stack-canary.sh`, cells `$2130/$2132`) measured the
  soft stack at `$3C7F` for the deepest toy. `$2120-$2127` is still above
  that, so the #169 cells are safe; the probe was re-run, not assumed.
- **Rule 2 is owed.** Per the workshop rule, this suite's breaks were written
  by the same seat that wrote it (`tests/check-measure-rom.js`: a heavy toy,
  a light toy, a middle-band toy, and two pictures). A cold break by another
  seat and model is owed before the card closes; the places to attack are
  the timer-direction probe, the `$0C00`/`$1C00` distinction, the
  `after_vblank` window, and the verdict thresholds.
- **#180 has no game ROM to prove anything with.** Every game row in the
  table above is a refusal, so the picture comparison is exercised only on
  the control (`tools/toys/palette.lua`) and the overrun/worst-update cells
  are empty by construction. The refusals are pinned in
  `tests/check-export-games.js` (code, message, and the line re-derived from
  the IL), and the control's ROM sha and eight-frame picture cycle are
  pinned, but a game's first *measurement* still needs its blockers to
  land. The capture runs one emulator (Mednafen) with no input and no real
  hardware; a pad-driven playthrough of a game ROM is not in this table.
