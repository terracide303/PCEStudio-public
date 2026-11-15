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
