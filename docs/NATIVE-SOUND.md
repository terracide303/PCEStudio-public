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

Proof: `tests/check-native-sound.js` compiles tools/toys/sfx.lua and note.lua with
the engine's PSG write log, runs them in Mednafen and compares the log with the
studio's own sound events for frames 0..23: write for write, 16 checks. Not done:
songs (`music()` with a song bank; the songs and trailer come from
`renderer/pce-hutrack.js`), the cost per frame of the tick, raster toys (the
raster tables leave too little RAM beside the engine's 1.1 KB), and the studio's
Export button, which still builds the interpreter ROM.
