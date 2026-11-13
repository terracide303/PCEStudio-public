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
STARFALL (3 banks, still without art) build banked too. **DUSK RUN does not:**
one of its functions is 10.9 KB, larger than a bank, so the C emitter would have
to split big functions. This is a prototype tool over the generated C; folding
it into `pce-cgen.js` and the studio's route is not done. The 8 KiB fixed page
holds the runtime only for toys that do not use the raster build (that build's
interrupt handlers and tables are bigger; not yet tried banked).

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
3. Split functions larger than a bank (DUSK RUN's 10.9 KB one) in the emitter.
4. DUSK RUN: the runtime's per-frame list of 32 palette writes is too short for its frame(); fix the runtime, then measure it.
5. Load art (tiles, sprites, palettes) in the native ROM, for STARFALL and NOVA TIDE.
6. Decide whether the studio's Export button gets a native route (a browser-side
   HuC6280 backend) or stays on the interpreter.
