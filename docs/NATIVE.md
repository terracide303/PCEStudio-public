# The native route: Lua → IL → C → llvm-mos

Status of the compiler path, measured, not planned. Written 2026-11-13.

The studio's Export button builds an *interpreter* ROM: the toy becomes
bytecode and a small program on the console reads it step by step
(docs/ROM_SPEED.md). The native route turns the same IL into C
(`renderer/pce-cgen.js`) and llvm-mos compiles that to HuC6280 code, so the
toy runs as machine code. The studio does not use it yet; `tools/build-toyc.sh`
does.

## Proven on hardware

2026-11-13, the maintainer's report: the native PCEHero intro (Lua through the IL, C and llvm-mos, banked,
with the art loaded at boot and the song played by the HuTrack engine) runs correctly on a real PC Engine
and on the maintainer's FPGA core, after the VBlank fix below. Before the fix it jumped about once a second
on hardware and in a web emulator (PicoEngine). This is the first game this route has run on hardware.
Only the picture and the music were judged, by eye and ear; no cycle measurement was taken on hardware.

## What compiles today

| Game | IL → C | llvm-mos builds it | Notes |
|---|---|---|---|
| PLATFORMER | yes | **yes**, `ROM_KB=16` | its code is 8.5 KiB; the default ROM is 8 KiB |
| TOWER | yes | **yes**, `ROM_KB=40`, with a silent `toy_sfx` | the native runtime has no sound engine yet, so this build is silent |
| STARFALL | yes | **yes**, banked, with its art and the real sound engine (`tools/build-toyc-banked.sh toys/demo-game/main.lua name`) | the console's sprite list equals the browser's, word for word (`tools/native-sat-compare.js`), the art loads exactly (`tests/check-native-art.js`: 0 of 32,768 VRAM words and 0 of 512 colours differ from the importer's picture) and the compiled logic matches (`tools/host-c-compare.js`). After the sprite-layer fix (the raster loop had switched sprites off) the picture is one row from diff 0: row 24, 15 bytes (closest browser frame 118). The earlier "127 rows, a renderer-versus-emulator difference" theory was wrong. Row 24 is the first raster split line, so a one-line phase difference at the split is the next thing to look at |
| DUSK RUN | yes (since `unm`, `bnot`, `not`) | **yes**, banked (the function over a bank is split), runs: no stall, runtime flags 0 | **slow, with two measured causes.** (1) The game builds its 512 background tiles from pixel rules, four a frame for its first 128 frames (the toy says so itself); each pixel is several 32-bit multiplies, which the console does in software (`__mulsi3`: 64% of 240 sampled instructions, found by sampling the PC against the symbol table), so a game frame in that phase takes about 200 video frames, and the game feels stuck for minutes at the start. (2) The sky gradient's three 32-bit divisions cost about 7,500 cycles per `raster(line)` call. `tests/native-dusk-fast` computes the same gradient (identical colours for every line, checked) without division: a call costs 3.45 timer ticks instead of 7.62 and the collection 47 instead of 84 ticks, host comparison 60 of 60 frames equal. The timer's 7-bit counter wraps after about one video frame, so the runtime's own per-frame measure is wrong for the long tile-building frames; the toy-frame counter at $2104 is also overwritten if the hardware stack runs deep. Making `*` cheap is done (`il_lua_mul`, cost follows the smaller operand's bit length, `tests/check-cgen-mul.js` checks 29,952 products against the wrapping 32-bit multiply): the tile phase now takes about 7,000 video frames instead of about 9,000 (two minutes of console time), and after it the fast copy runs at about 6.7 video frames per game frame (9 Hz; 78 game frames per 700 video frames, measured to 21,000 frames). Baking the tiles as art files would remove the phase (not done). Earlier notes that said `raster` alone costs 14 video frames per game frame and that this is the whole story were incomplete. Closures were also 3.1 KiB of RAM and ran into the soft stack; they now take what each function needs (`0bdfaed`) |
| NOVA TIDE | yes | **yes**, banked, with its art and sound (`OPT=-Oz tools/build-toyc-banked.sh toys/nova-tide/main.lua nova-tide`; `-Os` leaves the fixed page about 440 B too big) | `raster(line, spec)` lowers to `toy_raster_entry` (`TOY_RASTER_TABLE` runtime: frame() fills the line table, no per-line callback, no colour arrays). The compiled logic equals the browser's (`tools/host-c-compare.js`, 60 of 60 frames) and the sprite list equals it word for word (`tools/native-sat-compare.js`, toy frame 71). **The picture is diff 0 against the browser's frame 85** (`tools/native-compare.js`, 150 browser frames). Before the sprite fix below it showed 65 differing rows: every sprite was missing, because the raster main loop wrote CR = $008C, which has no sprite bit; the sprite list in VRAM was exact all along (`tests/check-native-raster-sprites.js`). About 6 video frames per toy frame |

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

## Division by a power of two is a shift (2026-11-13)

`x // 2^k` lowers to an arithmetic shift and `x % 2^k` to a mask (`pce-cgen.js`; `tests/check-cgen-pow2.js`
compares the C with the browser for negative and positive dividends). A software 32-bit division costs about
2,000 cycles on this CPU, so this matters for games that divide in `frame()` or in a raster callback; division
by any other constant still calls the helpers. A reciprocal-multiply lowering for other constants is not done.

## A picture that jumped once a second (found on real hardware, fixed 2026-11-13)

The maintainer ran the native PCEHero intro on a real PC Engine and in a web emulator and saw the
picture jump up and down about once a second. The cause was in our runtime: a game with no `raster()`
callback runs `frame()` right after the VBlank starts, and a slow frame (the music tick takes up to a
third of a frame on a busy row) pushed the game's `reg("BYR", ...)` write past the 22-line blanking
period into the visible picture. Measured with Geargrafx's VDC trace: the write landed 5 to 40 lines
after the VBlank started, and in 8 of 400 frames (every 96 and 36 frames in turn, following the music
rows) it was late. Emulators that draw a whole frame at a time (Mednafen's capture, the browser) show
nothing, which is why no earlier check saw it.

The fix: `frame()`'s writes to the scroll, control and colour registers are held and applied at the
start of the next VBlank (`TOY_HOLD_BUILD` in `tools/toyc/toy_runtime.c`, on in every
`tools/build-toyc-banked.sh` build; the committed 8 KiB runtime ROMs are unchanged). After it, every
write lands exactly 2 lines after the VBlank starts, 400 of 400 frames. It costs a frame of latency
and never tears. Sprites are not held: their list is read by the VDC at the VBlank. A game with a
`raster()` callback already did this (its writes are captured and applied in the VBlank).
`tests/check-native-vblank.js` pins it, with a control (the old behaviour, `NO_HOLD=1`) that must fail.
What it does not cover: VRAM tile writes made by a game's own `frame()` still go straight to the VDC
and could tear the same way if a frame overruns; none of the gallery games does that.

## Two bugs the console runtime and linker had (fixed 2026-11-13)

- **A division next to a remainder corrupted the control register.** llvm-mos fuses `x / y` and
  `x % y` into one library call that returns the remainder through a pointer to a zero-page
  variable; that pointer is `$00xx` where the CPU's zero page is `$20xx`, so the store landed in the VDC
  and clobbered CR. `pce-cgen.js` now computes `x - q*y` and calls the division alone (found by the
  card #289 seat). The same family of bug: a `memset` through a pointer to a zero-page array
  (found with Geargrafx's call stack, see the banked-split section above).
- **`frame()`'s VRAM writes were dropped in raster builds.** They went into a 32-word capture list and
  the rest were lost, which is why STARFALL had no enemies and DUSK RUN stalled. The display is idle
  while `frame()` runs, so the writes now go straight to the VDC (also the #289 seat).
- **The art blob was missing from the ROM** until `retain` was added (nothing referred to it by name,
  so the linker dropped it), and the run table was a zero-page copy that was all zeros at run time.
  `tests/check-native-art.js` found both.

## Is the compiler right? The host comparison

`tools/host-c-compare.js toys/NAME/main.lua` compiles the generated C on this machine against a stub
runtime (`tests/hostc/stub_runtime.c`: VRAM and the sprite list as arrays, an idle pad) and compares the
sprite list after every toy frame with the browser runtime's. It needs no emulator and no llvm-mos, so it
separates the compiler's logic from the console runtime's behaviour. For PLATFORMER, TOWER, DUSK RUN and
STARFALL, 120 of 120 frames are equal (`tests/check-cgen-host.js`). So when a native ROM's picture is wrong
the cause is the runtime, the banking or the build, not `pce-cgen.js`: that is how STARFALL's missing
sprites were traced to the runtime's 32-word VRAM capture list within an hour.

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

1. ~~Lower `raster(line, spec)` (NOVA TIDE).~~ Done; see the table.
2. Put the sound engine behind `toy_music`, `toy_sfx`, `toy_release` in the
   native runtime.
3. DUSK RUN: the runtime's per-frame list of 32 palette writes is too short for its frame(); fix the runtime, then measure it.
4. Load art (tiles, sprites, palettes) in the native ROM, for STARFALL and NOVA TIDE.
5. Decide whether the studio's Export button gets a native route (a browser-side
   HuC6280 backend) or stays on the interpreter.
