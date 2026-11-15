# Music and sound in a natively compiled ROM — the options

Written 2026-11-13. The maintainer chose option C (banked code, the engine in
its own pages). **Step 1 is built and proved, see "Built so far" at the end.** Background: docs/NATIVE.md (what compiles) and
docs/ROM-SOUND.md (how the interpreter ROM carries the HuTrack engine).

## The problem

The games call `music()`, `sfx()`, `release()` and `note()`. In the interpreter
ROM they reach the HuTrack engine; in a native ROM they call functions nobody
has written, so TOWER, STARFALL and DUSK RUN do not link without a silent
placeholder.

The engine (docs/ROM-SOUND.md §2) is **7,876 B of code** that runs at page 5
($A000), **2,868 B of pitch tables** that must be mapped at page 4 ($8000)
while it runs, and the song in one 8 KiB bank mapped at page 2 ($4000). It is
called once per toy frame, before `frame()`.

The PC Engine has six 8 KiB code pages (MPR2–MPR7, $4000–$FFFF). A native game
that does not fit in two pages uses more of them as one fixed image
(`ROM_KB`, docs/NATIVE.md): PLATFORMER needs 2 pages, TOWER about 5, DUSK RUN 6.
So the engine's pages 2, 4 and 5 are pages the bigger games are already using.

## Options

**A. Small games only.** Native game code in pages 6–7 (16 KiB), the engine in
5/4/2 exactly as in the interpreter ROM. Nothing new to build: reuse the
interpreter's sound glue (`tools/ilvm/ilvm_sound.c`) and the engine banks of
`renderer/ilvm.bin`. But TOWER and DUSK RUN, the games native exists for, do
not fit in 16 KiB.

**B. Map the engine in only while it runs.** The game keeps pages 3–7. The
engine and song live in extra ROM banks beyond the fixed image. One small
routine in the top page (so it is never swapped out) saves MPR2/4/5, maps the
engine's three banks, calls the tick (or `sfx`/`release`), restores the three
registers and returns. Interrupts are off for that window. This is the
smallest change that lets any game have music, and reuses the engine and the
song converter untouched. Costs and risks:
- every sound call and each frame's tick pay the map-and-restore (a few dozen
  cycles) plus the engine's own work; the engine's cost per tick has not been
  measured on the native route;
- the raster interrupt chain must not fire while a page it executes from is
  swapped out, so the chain's code and the glue must both sit in page 7 (a
  linker-section placement), and the tick's interrupt-off window delays a raster
  line by up to the tick's length. For a raster toy (DUSK RUN, NOVA TIDE) that
  can shift a band by a few lines unless the tick runs in VBlank, before the
  display starts.

**C. Real code banking.** Split the game's code over switched banks (the SDK
has a banked layout with a fixed page 7 and one switched page 6). Frees pages 2–5
for the engine permanently. It is the "proper" console layout and the most
work: every call between banks needs a trampoline the compiler does not
generate today.

**D. Make the code smaller first.** The generated C uses 32-bit integers on an
8-bit CPU. A game that fits in 16 KiB would take option A. A 16-bit native
profile changes arithmetic semantics against the browser, so it is a design
decision of its own.

## Recommendation

**B**, with the tick placed in VBlank for raster toys. It keeps the engine, the
converter and the song format as they are, gives every game music, and its two
risks (interrupt placement, tick cost) are measurable in the emulator before
anything else depends on them. A is a fallback for small games and costs
nothing extra if B is built (a small game simply needs no map-swap).

## What B needs, in order

1. A section placement so the runtime's interrupt handlers and the sound glue
   sit in the top page (linker script fragment).
2. The song converter's bank and the engine banks appended after the fixed
   image, with their physical bank numbers passed to the glue.
3. `toy_music`, `toy_sfx`, `toy_release` and `toy_note` implemented as the
   map-swap glue over the interpreter's existing engine entry points.
4. The per-frame tick before `frame()`.
5. The test that already exists for the interpreter (`tests/check-rom-sound.js`,
   PSG write streams equal the studio's) pointed at the native ROM.
6. Measure the tick's cycles and the raster shift on DUSK RUN.

## Built so far (option C, step 1)

`tools/build-toyc-banked.sh toy.lua name` now gives a toy that calls `sfx()`,
`note()`, `release()` or `music()` the sound engine: the interpreter ROM's
HuTrack engine and sound glue in physical banks 2 and 3, a song bank in 4 (empty
trailer, no songs yet), the toy's code in banks 1, 5, 6, ...; the compiler's zero
page held to 96 bytes (`-mlto-zp=96`) so the engine's own starts at $2080, and
the engine's RAM placed after the program's by a second pass. The emitter adds
`toy_sound_boot()` to the boot and `toy_sound_tick()` before each `frame()`;
`tools/toyc/toy_sound.c` is the wrapper over the glue's fixed addresses.

Songs: `tools/native-songs.js` reads the toy folder's `song.json`/`songs.json`
the way the studio does, converts each song with `pce-hutrack.js` and assembles
them into the song bank (physical bank 4) at 16-byte offsets with the trailer the
glue reads (up to 8 songs, 8,160 bytes). `tools/toyc/emit.js` hands the songs to
the validator so `music(0)` is accepted. The interpreter ROM's builder still
writes "no songs", so this is the first ROM route that carries one.

Proof, `tests/check-native-sound.js` (18 checks, the ROMs run in Geargrafx through
its MCP server, `tools/ggmcp.py`): sfx.lua and note.lua write exactly the studio's
PSG stream over frames 0..23, write for write, from the engine's own write log;
and a music fixture (`tests/native-music`, the sequencer's demo song, 521 bytes)
is compared after every toy frame: the four tonal channels' frequency and on/off
equal the studio's in all 59 frames compared, and the two noise channels' on/off
too (a drum's pitch lands on the nearest legacy value, ROM-SOUND.md §6). The
engine writes its own registers, which the write log does not carry, hence the
state comparison.

**What the tick costs** (the demo song, measured in Geargrafx from the runtime's own
cycle counters, 408 toy frames): 15,550 cycles per frame on average (13% of a
video frame's 119,000), 14,300 median, 37,900 at most (32%) on the busiest row,
and about 70,000 (59%) on the one frame where the song starts. A game with music
has about two thirds of a frame left in its worst case: native TOWER's worst
frame is 91% of a frame without sound, so TOWER with this song would overrun
some frames. A game that needs music and every cycle needs either a lighter song,
the tick spread over two frames, or the engine rewritten for speed.

Not done: raster toys (the raster tables leave too
little RAM beside the engine's 1.1 KB); the studio's Export button, which still
builds the interpreter ROM. The Oak Woods song converts too (its rows carry empty
effect-slot lists, which `tools/native-songs.js` pads to the converter's filler);
`tests/native-music-oak` plays it and equals the studio's model like the demo song.

## Export carries the songs now (2026-11-13)

The studio's Export (the interpreter ROM) used to pin "no songs" in the trailer, so an exported game was
silent. `renderer/pce-songbank.js` now turns the toy's compiled songs (song.json, songs.json) into one 8 KiB
song bank, and `buildToyRom` takes them as `songs` (a function of the bank's number): the bank goes whole
after the data and art banks and the trailer the engine glue reads lists it. The studio page loads
`pce-hutrack.js` and `pce-songbank.js`, refuses a song the converter cannot take (with its reason), and no
longer carries the song files as a JSON tail. `tests/check-export-songs.js` (14 checks): layout, a refusal by
code, the page's wiring, and the exported ROM played in Geargrafx: its notes are ones the studio's own player
model writes. One song bank holds up to 8 songs and 8,160 bytes. The live site does not have this until it is
deployed (needs the maintainer's go and the cPanel password). The MCP's `export_pce` is not changed.

## Effects on the native route (2026-11-15)

`sfx_noise`, `sfx_slide`, `sfx_fx` and `sfx_preset` (docs/TOYS.md "Sound
effects", docs/ROM-SOUND.md §12) lower to `toy_sfx_fx`, which is the three
`sfx` ops the interpreter runs, through the same glue entry (`SndGlueSfxOp`).
`tests/check-sfx-fx.js` builds `tools/toys/fx.lua` natively with the PSG write
log and compares the whole stream with the studio's, frame for frame.

**What an effect costs per frame**, measured with `tools/native-measure.sh` on
`tools/toys/fx-cost.lua` (N effects playing all the time, each a 250-frame
slide with an attack and a decay, the dearest kind; the figure is the whole
`toy_frame` including the sound tick, mean over about 630 frames, Mednafen's
TMA counter, 1,024 cycles a tick):

| effects playing | cycles per frame | over nothing playing | worst frame (a start) |
|---|---|---|---|
| 0 (glue linked, ticking) | 739 | - | 1 tick |
| 1 | 1,324 | +585 | 8 ticks (8,200) |
| 3 | 2,185 | +1,446 | 22 ticks (22,500) |
| 6 | 3,188 | +2,449 | 40 ticks (41,000) |

So about **400 cycles per active effect per frame** (0.34% of the 119,000 of a
video frame; the mean includes one start in 250 frames), and **6,800 to 8,200
cycles for the frame an effect starts** (a tone uploads its 32-step wave; a
noise effect writes three registers instead). Six effects at once is 2.7% of
a frame. Music on the other channels is not touched: an effect takes only its
own channel's registers, and the engine's tick and the effects' tick are one
pass of the glue's loop; `tests/check-native-sound.js`'s music fixtures still
pass with the new glue.

## Samples: DDA playback from the timer interrupt (2026-11-15)

`sample(name, channel)` (docs/TOYS.md "Samples"; model `renderer/pce-sample.js`) plays a short sample on one PSG channel by
writing its DDA register from the CPU. Real games spend about a third of a frame on this (docs/HUCARD-BUDGETS.md section 4:
about 256 writes spread over the frame plus a roughly 6.7 kHz timer interrupt); the toy version is the smallest honest one.

**The design.** One 8 KiB sample bank after the art banks (`tools/native-samples.js`: a count, an 8-byte entry per sample,
the steps one byte each). `toy_sample()` (`tools/toyc/toy_sound.c`, only in a `TOY_SAMPLE_BUILD`) releases the old sample's
channel, takes the new one with the sfx glue (`toy_sfx(ch, 0, 0, hold)`: the reserve, the square upload, the release after
the hold frames, so the music yields the channel exactly as for `sfx()`), writes R0 and R4 = `$DF`, loads a zero-page pointer
and arms the timer with reload `div - 1`. The timer interrupt (`irq_timer`, hand-written, A only) acknowledges TIQ, maps
the sample bank into page 3 (`tma #8` / `tam #8`, restored before `rti`), selects the channel, writes ONE step to R6, puts the
PSG's channel select back, advances the pointer and stops the timer after the last step. No step is written from the main
loop; no frame work waits for it.

**Two-writer problem, and what solves it.** The engine's tick selects channels with `stx $800` and then writes registers;
an interrupt between the two would send the rest of the group to the sample's channel. The PSG's select register cannot
be read back, so the engine records every select in a RAM byte `psg_sel`: `SAMPLE_SHADOW=1` in `tools/ilvm/build-engine.sh`
turns each `stx $800` (the glue's six, written with the `PSGSEL_X` macro, and every vendor one, patched in the staged copy)
into `stx psg_sel` THEN `stx $800` (that order: an interrupt between them sees the new channel). The handler restores the
select from it. Without the define the macro is the plain store and **the engine image is byte-identical** to before
(checked: `hutrack-code.bin` and `hutrack-tables.bin` equal the pre-change build), so `renderer/ilvm.bin`, the native kit's
engine images and every pinned ROM hash are untouched; only a toy that calls `sample()` builds the shadowed engine, so the
native kit (`tools/native-kit`) does not carry sample toys. `tests/check-sample.js` proves the restore: after every frame
(outside the handler itself) the chip's channel select, read through Geargrafx, equals the engine's shadow; with the
restore deleted from the handler that check fails.

**What it costs**, measured with Geargrafx's profiler on `tools/toys/sample/cost.lua` (the thump at 3,496 Hz started again
every 18 frames, so a sample plays all the time; the demo song on the other channels): the handler is **332 master clocks
= 111 CPU cycles per interrupt** (min and max 332 to 366 over 8,907 interrupts; counting the instructions gives 117:
8 for the interrupt entry, 109 in the handler) and it was 5.2% of all the CPU time over the window. That is, per 60 Hz frame
of 119,665 cycles:

| rate | interrupts per frame | cycles per frame | share of the frame |
|---|---|---|---|
| 1,748 Hz (`div` 4) | 29 | about 3,200 | 2.7% |
| 3,496 Hz (`div` 2) | 58 | about 6,500 | 5.4% |
| 6,991 Hz (`div` 1) | 117 | about 13,000 | 10.8% |

so a sample is dearer than an effect (about 400 cycles per effect per frame) but well under the real games' third of a
frame, because the toy writes one step per interrupt with no mixing, no volume scaling and no second channel. Starting a
sample costs the sfx glue's start (a 32-step upload, 6,800 to 8,200 cycles) plus a few hundred. `tools/native-measure.sh`
cannot measure it: it reads the timer's down-counter, which the sample interrupt reprograms; the profiler counts the handler
directly. Interrupts are never masked for long: the engine's tick (up to 38,000 cycles on a busy row) is interrupted by
the sample interrupt like any other code, which is the point of the shadow.

**Limits.** Only one sample at a time; `timer()` and `sample()` cannot share the timer (`validate-sample-timer`); the sample
bank is one bank (`validate-sample-bank`); the pitch/rate is the timer's four divisors; a toy whose raster interrupt chain is
late by 111 cycles (a sample's interrupt can delay a line interrupt by that much) should not play samples during a split.
The raster chain was not measured with a sample playing.

**The interpreter ROM does not carry it.** The cost above is not the reason: the interpreter would need a new bytecode op,
a sample bank in its container, the interrupt handler and the shadowed engine in its fixed image, so `renderer/ilvm.bin` and
every pinned exported-ROM hash change. That is not built; `sample()` is refused there with `ilbc-sample`, and the validator
warns (`validate-sample-native-only`) for any toy that the Export button would build.

**The proof**, `tests/check-sample.js` (75 checks): the importer reproduces the committed `samples.json` from the committed WAVs
and the generator reproduces the WAVs; the Lua and IL runtimes write the same stream; the native ROM (a trace build with a
test-only RAM log of the steps, `DDA_LOG=1`, run in Geargrafx) wrote the same DDA values as the browser, step for step for a whole
sample; the engine's own PSG writes (reserve, upload, release) equal the studio's write for write; with samples on channels 5 and
4 the song's four tonal channels equal the studio's after every frame.
