# The native route: Lua → IL → C → llvm-mos

Status of the compiler path, measured, not planned. Written 2026-11-13.

The studio's Export button builds an *interpreter* ROM: the toy becomes
bytecode and a small program on the console reads it step by step
(docs/ROM_SPEED.md). The native route turns the same IL into C
(`renderer/pce-cgen.js`) and llvm-mos compiles that to HuC6280 code, so the
toy runs as machine code. The studio does not use it yet; `tools/build-toyc.sh`
does.

## What compiles today

| Game | IL → C | llvm-mos builds it | Why not |
|---|---|---|---|
| PLATFORMER | yes | **yes**, with `ROM_KB=16` | its code is 8.5 KiB; the default ROM is 8 KiB |
| TOWER | yes | no | the sound calls (`toy_sfx`, …) have no runtime behind them |
| STARFALL | yes | no | the same sound calls |
| DUSK RUN | yes (since `unm`, `bnot`, `not`) | no | the same sound calls |
| NOVA TIDE | **no** | — | `raster(line, spec)`, the table form, is not lowered |

"IL → C" means `emitC` returns C text; only a llvm-mos build counts as compiling.

## Bigger ROMs without bank switching

The SDK's linker script (`mos-platform/pce/lib/link.ld`) lets the fixed ROM be
up to 48 KiB: the extra 8 KiB pages are mapped into MPR6, MPR5, … just below
$E000, so the code is one contiguous image. `ROM_KB=16 tools/build-toyc.sh
toy.lua name` passes `__rom_bank0_size` and `__rom_bank0` to the linker. Left
unset, the build is the 8 KiB one: the palette toy's ROM still has the committed
sha256. Code past 48 KiB would need real bank switching; not built.

## Native against interpreter (PLATFORMER)

Measured in Mednafen 1.32.1 (windowless) on the static, no-input scene:

| | cycles per frame() | video frame used |
|---|---|---|
| interpreter ROM (docs/ROM_SPEED.md) | 73,445 | 0.62 |
| native, `ROM_KB=16` | 2,685 | about 0.02 |

About 27 times fewer cycles. The native ROM's picture is the browser's frame 0,
every pixel identical (`tools/native-compare.js`). Cycles come from the
runtime's TMA-timer counters (`tools/native-measure.sh`). This is one scene with
no buttons pressed; a game in motion costs more, and TOWER and DUSK RUN, the
games that are too slow today, are not measured because they do not build yet.

## Next

1. Lower `raster(line, spec)` (NOVA TIDE).
2. Put the sound engine behind `toy_music`, `toy_sfx`, `toy_release` in the
   native runtime.
3. Measure TOWER and DUSK RUN, the games the interpreter cannot run at speed.
4. Decide whether the studio's Export button gets a native route (a browser-side
   HuC6280 backend) or stays on the interpreter.
