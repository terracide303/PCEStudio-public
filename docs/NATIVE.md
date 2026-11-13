# The native route: Lua → IL → C → llvm-mos

Status of the compiler path, measured, not planned. Written 2026-11-13.

The studio's Export button builds an *interpreter* ROM: the toy becomes
bytecode and a small program on the console reads it step by step
(docs/ROM_SPEED.md). The native route turns the same IL into C
(`renderer/pce-cgen.js`) and llvm-mos compiles that to HuC6280 code, so the
toy runs as machine code. The studio does not use it yet; `tools/build-toyc.sh`
does.

## What compiles today

| Game | IL → C | llvm-mos builds it | Notes |
|---|---|---|---|
| PLATFORMER | yes | **yes**, `ROM_KB=16` | its code is 8.5 KiB; the default ROM is 8 KiB |
| TOWER | yes | **yes**, `ROM_KB=40`, with a silent `toy_sfx` | the native runtime has no sound engine yet, so this build is silent |
| STARFALL | yes | code links at `ROM_KB=24`, silent `toy_sfx` | no art: the native runtime has no way to load tiles or sprites, so it runs but draws nothing meaningful (not measured) |
| DUSK RUN | yes (since `unm`, `bnot`, `not`) | **yes**, `ROM_KB=48`, silent `toy_sfx` | builds since the table pool is sized to the toy's own cells (it was a fixed 768 B and overflowed RAM by 146 B); but it **stalls after the first frame** and the screen stays black: the runtime's raised flag says a frame() wrote more colours than its 32-entry list holds. Not measured |
| NOVA TIDE | **no** | — | `raster(line, spec)`, the table form, is not lowered; it also needs its art |

"IL → C" means `emitC` returns C text; only a llvm-mos build counts as
compiling. The silent `toy_sfx` is a one-line placeholder used for the
measurement (`-include`), not part of the repo's runtime.

## Bigger ROMs without bank switching

The SDK's linker script (`mos-platform/pce/lib/link.ld`) lets the fixed ROM be
up to 48 KiB: the extra 8 KiB pages are mapped into MPR6, MPR5, … just below
$E000, so the code is one contiguous image. `ROM_KB=16 tools/build-toyc.sh
toy.lua name` passes `__rom_bank0_size` and `__rom_bank0` to the linker. Left
unset, the build is the 8 KiB one: the palette toy's ROM still has the committed
sha256. Code past 48 KiB would need real bank switching; not built.

## Banked code (the shape real games use)

`tools/build-toyc-banked.sh toy.lua name` puts the toy's functions in switched
8 KiB ROM banks (`tools/bank-toyc.py` packs them first-fit; the SDK links them
at $C000, page 6). Every call goes through the one dispatcher, `il_call`, which
stays in the fixed top page with the runtime and maps the callee's bank around
the call. The fixed part of TOWER is 3.6 KB. See docs/BANKING-STUDY.md for why
this is the layout to copy.

| | cycles per frame | picture |
|---|---|---|
| TOWER, one fixed 40 KiB image | 82,969 | browser frame, diff 0 |
| TOWER, 6 switched banks | 84,429 (+1.8%) | browser frame, diff 0 |

So a bank switch on every call costs under 2% on TOWER. PLATFORMER (1 bank) and
STARFALL (3 banks, still without art) build banked too.

**A function larger than a bank is split.** DUSK RUN's frame() is 10.9 KB; the
emitter (`pce-cgen.js`, asked by the build script through `PCE_SPLIT_ONLY`)
cuts such a function into chunks of 100 IL instructions, each its own C
function in a bank, with a small dispatcher of the function's own name in the
fixed page that maps the chunk's bank around each chunk call. The function's
registers become a static array, so a split function must not run inside itself
(a guard sets a flag if it does; no gallery game's does). Two lessons, both
measured: passing the registers by pointer made the code 2 to 3 times bigger on
this CPU, and the compiler's zero-page array zeroed through a pointer that
points into the I/O page, which stalled TOWER after one frame; the array is
forced into `.bss` now (`tests/check-cgen-split.js`). With three TOWER
functions split on purpose, the picture is still the browser's and the cost
rose from 84,400 to 91,000 cycles per frame (+8%), so the build splits only
what a bank cannot hold. This is a prototype tool over the generated C and the
emitter option; the studio's own route does not use it. DUSK RUN builds
banked with its function split and draws, but hits the runtime stall described
above (10 frames, then nothing), and does not match yet. The 8 KiB fixed page
holds the runtime, the dispatcher and the constants: 3.9 KB for TOWER, more for
a raster toy.

## VDC access rules (checked 2026-11-13)

The VDC has global state: the selected register, the VRAM write address and its
auto-increment. An interrupt that writes the VDC in the middle of a main-loop write or
copy corrupts it (`docs/REFERENCES.md`, the PCE_knowledge notes). The native runtime
avoids this by construction, and the engine must keep it that way:

1. The main loop writes the VDC only while no scan interrupt is armed: at boot, and
   in the VBlank that applies the frame's base and line 0, before the display and the
   raster chain are armed. During the toy's own `frame()` and `raster()` calls the
   writes are captured into lists and applied later, not made.
2. The scan-line handler (`irq_vdc` in `tools/toyc/toy_runtime.c`) writes only
   registers 5 to 8 (control, raster compare, scroll) and the colour table. It never
   touches the VRAM address, the data port or the DMA registers.
3. The VBlank part of the same handler reads the status register (which acknowledges
   it) and increments a counter; it writes nothing.
4. Because of 1 to 3 the handler does not save or restore the selected register. If a
   later change lets main-loop VDC code run while the chain is armed, either the
   handler must restore the selected register from a shadow, or that code must mask
   interrupts or work in chunks of at most 64 words, re-setting the address each time.

Not yet checked: the interpreter ROM's COPYV (it runs in `frame()`, which is the
unarmed phase, so rule 1 covers it) against a trace.

## Native against interpreter

Measured in Mednafen 1.32.1 (windowless), no buttons pressed. A video frame is
about 119,000 cycles.

| Game | interpreter ROM (docs/ROM_SPEED.md) | native |
|---|---|---|
| PLATFORMER | 73,445 cycles per update, 60 Hz | **2,685** cycles (0.02 of a frame) |
| TOWER | **too slow**: about 5 updates a second | **82,969** mean, 108,544 worst (0.70 and 0.91 of a frame): holds 60 Hz |

Both native ROMs' pictures are the browser's, every pixel identical
(`tools/native-compare.js`; PLATFORMER frame 0, TOWER frame 413). Cycles come
from the runtime's TMA-timer counters (`tools/native-measure.sh`). These are
scenes with no input; a game in play costs more, and TOWER's worst frame is
already at 91%. TOWER's sound is silent in this build, and the sound engine's
own cost per frame is not in these numbers.

## Next

1. Lower `raster(line, spec)` (NOVA TIDE).
2. Put the sound engine behind `toy_music`, `toy_sfx`, `toy_release` in the
   native runtime.
3. DUSK RUN: the runtime's per-frame list of 32 palette writes is too short for its frame(); fix the runtime, then measure it.
4. Load art (tiles, sprites, palettes) in the native ROM, for STARFALL and NOVA TIDE.
5. Decide whether the studio's Export button gets a native route (a browser-side
   HuC6280 backend) or stays on the interpreter.
