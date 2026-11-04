# Sound in the exported ROM (#194, step 1)

The exported toy ROM is the IL interpreter image
[`renderer/ilvm.bin`](../renderer/ilvm.bin) (32,768 B since #213, built once
by [`tools/ilvm/build.sh`](../tools/ilvm/build.sh) with llvm-mos) plus the
toy's bytecode in the next physical bank. Since #197 the two cartridge front
ends carry the whole sound surface — the encoder has `music`/`sfx`/`release`
ops and the `note` builtin (`renderer/pce-ilbc.js`, container version 3), and
the C emitter lowers them. Since #215 the committed interpreter reads
container version 3 and calls the engine, so a sound toy exports; **§11
(2026-11-02) is the console check, and §8's trace (#200) is the
write-for-write proof: the console's PSG writes for `tools/toys/note.lua`
and `tools/toys/sfx.lua` equal the studio's over 24 toy frames.** The
trace pinned the two glue defects — #238 (F clamped on the low byte) and
#239 (the zero-song loop overran `snd_owned`, so the first SFX's reserve
was skipped) — and both fixes are in the committed image. #113 (R1, the PSG's
main amplitude) is fixed in the same image: `sfx()` now writes R1 = `$FF`
unconditionally before its reserve, on the studio host and in the console
glue, so a toy with no `music()` is heard. §11 measured both toys' WAVs on
the image before #227's raster change (`renderer/ilvm.bin`
`46ccefb656d18ca9…`); #227 changed only `tools/ilvm/ilvm_runtime.c`, and the
committed image's HuTrack banks (`d68a1b5f567d824b…`, bytes 16,384–32,767)
compare byte for byte with that one: note.lua plays 261/330/392/523 Hz and
sfx.lua 559/131 Hz, non-silent. TOWER
still stops earlier, at the 8 KiB data bank (8,524 B of bytecode), and
DUSK RUN exports but does not play on the committed image (its container
needs more registers/functions/upvalues than the interpreter has — §10).
NOVA TIDE stops on its first `raster`
([`ROM_SPEED.md`](ROM_SPEED.md) §#193).

This page is the design half: **how the vendored HuTrack engine
([`vendor/hutrack/`](../vendor/hutrack/VENDORED.md), MIT) links beside the C
interpreter, and what it costs.** Every size below was measured on
2026-11-01 with the toolchain on this machine, and §5's RAM partition was
measured and asserted by #214 on 2026-11-02; projections that are not yet
built are marked as projections. The implementation is split into
#197–#200 (the end of this page); #196 is this note.

The two facts that decide the design:

1. **HuTrack's code and tables cost 16,384 B of ROM — two whole 8 KiB
   banks — even though only 10,744 B are used.** They cannot share a bank
   with each other (the pitch tables must be mapped at page 4 and the code
   runs at page 5), so the image grows from 16 KiB to 32 KiB and every toy
   ROM from 24,576 B to 40,960 B.
2. **The engine's RAM did not fit beside the interpreter.** 94 B of zero
   page and 1,111 B of BaseRAM, against a zero page the compiler fills and
   1,122 B of stack headroom in the projection (1,036 B after #214, 977 B
   after #215, 1,131 B after #222). #214 builds the partition below and has
   `build.sh` assert it; a Mednafen canary measures the stack's high-water
   mark.

## 1. The two toolchains, and why the image is concatenation

`renderer/ilvm.bin` is not linked with anything. llvm-mos builds a fixed
16 KiB image for `$C000-$FFFF`:

| physical bank | CPU window | content |
|---|---|---|
| 0 | `$E000-$FFFF` | crt0, vectors, the runtime |
| 1 | `$C000-$DFFF` | the interpreter (`exec` 9,724 B) |

The browser appends the toy's ILBC container as physical bank 2
(`renderer/pce-rom.js` `buildToyRom`), and `tools/ilvm/ilvm.c` maps it at
MPR2 (`$4000-$5FFF`, `TAM #$04`) at boot. **Since #213** the committed image
is 32 KiB: banks 2 and 3 hold the engine code and pitch tables (built by
`tools/ilvm/build-engine.sh` and concatenated by `build.sh`), and the toy's
container is physical bank 4 — `buildToyRom` follows, and `ilvm.c`'s
`DATA_BANK` is 4.

HuTrack is pceas code. In its own music ROM
([`tools/hutrack.asm`](../tools/hutrack.asm)) the engine is one bank of code
at `$C000` (page 6) and one bank of pitch tables at `$8000` (page 4). The
two build systems share no linker, so the only honest "link" is a **staged
build and a byte concatenation**: assemble the engine with pceas into banks
whose *bank numbers* are the physical numbers they will have in the final
ROM, extract those two banks, and append them after the llvm-mos image. The
C side calls fixed addresses extracted from pceas's symbol file. No C source
ever includes engine code and no pceas source includes C code.

## 2. What the engine costs, measured

Built with PCEAS 4.10.574 (`$HOME/.local/bin/pceas4`) from an engine-only
assembly of `HuTrack_lib.asm` + `HuTrack_parser.asm` +
`HuTrack_engine.asm`: first with the vendored macros, then with the §3
window patch. The vendored tree itself is never edited.

| piece | measured | where |
|---|---|---|
| engine lib + parser (vendored macros) | **7,651 B** | `MusicCodeStart` `$C000` → `MusicCodeEnd` `$DDE3` |
| engine front (`EngineCall` and the 7 kHz DDA IRQ; `FadeTick`, `EndSong` and `Process.envelopes` are already in the lib+parser bank above) | **238 B** | `HuTrackEngine.7khz.IRQ` `$E086` → `MusicInit` `$E174` |
| integration tick wrapper (`HuTrackTick`) | **14 B** | measured in the same assembly |
| **code, combined, vendored macros** | **7,903 B** | `$A000-$BEDF` at page 5 |
| **code, combined, with the three-site window patch (§3)** | **7,876 B** | `$A000-$BEC4`; 316 B free in the bank |
| pitch tables | **2,868 B** | `HuTrack.Tables` `$8000` → `HuTrack.Tables.end` `$8B34` |
| **tables bank free** | **5,324 B** | `$8B34-$9FFF` |

`HuTrackTick` is four instructions plus a two-byte return vector write
(measured 14 B):

```
HuTrackTick:
    lda #low(.done)      ; EngineCall ends with `jmp [HuTrack.returnVec]`,
    sta HuTrack.returnVec; so a caller from C gives it an rts to land on.
    lda #high(.done)
    sta HuTrack.returnVec+1
    jmp HuTrackEngine.EngineCall
.done:
    rts
```

The 2,868 B are: `SquarePos` 512 B and `SquareNeg` 512 B at `$8000` and
`$8200`, `Volume` 1,024 B at `$8400`, the 12-byte `BaseLo`/`BaseHi`/`Step`
at `$8800`, the 64-byte sine tables, 16-byte scale, 128-byte tremolo, and
the 256-byte `Semitone` and `Octave` at `$8934` and `$8A34` (the include's
own `…Length` constants). They must sit in a bank whose number the pitch
code can map to MPR4; the code cannot live there.

**Added size, arithmetic from the two measurements:** 7,876 B of code and
2,868 B of tables still need two 8 KiB physical banks (16,384 B), because
the tables must be reachable at page 4 while the code executes from page 5.
They would fit one bank only if 2,552 B of the two disappeared, and neither
is a layout change — they are the engine. So:

- `renderer/ilvm.bin`: **16,384 B → 32,768 B** (landed by #213: the image
  is now llvm-mos banks 0-1, engine code bank 2, pitch tables bank 3).
- A toy ROM: **24,576 B → 40,960 B** (five 8 KiB banks, a legal HuCard
  size). The toy's data bank moves from physical bank 2 to **physical bank
  4**; `renderer/pce-rom.js`'s `ILVM_BYTES`/`TOY_DATA_BANK` and `ilvm.c`'s
  `DATA_BANK` follow (#213).

The spike that proved the layout: a minimal `.asm` with no base_func
framework, `.bank $02 / .org $A000` for the code (the front and the wrapper
included after the parser) and `.bank $03 / .org $8000` for the tables,
assembled by `pceas4 -raw` produced a 32,768-byte raw image whose banks 2
and 3 are the engine and whose symbols are `HuTrackTrampStart $A000`,
`HuTrackTrampEnd $BEC4`, `HuTrack.Tables $8000`, `HuTrack.Tables.end $8B34`
(this assembly used the patched §3 macro; the vendored one ends at `$BEDF`,
27 B later). Banks 0 and 1 of that raw image are `$FF`; the build extracts
banks 2–3 only.

## 3. Where the code can run: HuTrack's 32 KiB song window

HuTrack's parser maps **four consecutive banks** at MPR2–MPR5 to read a
song's tables:

```
_htk.PUSHBANK.4 _htk.PAGE_4000
_htk.MAP_BANK.4 HuTrack.song.windowBank, _htk.PAGE_4000
```

(`HuTrack_parser.asm` line 31, and the same pair in `Process.envelopes` at
line 1774; `HuTrack_lib.asm` line 377 does it once more in `playSong` to
read the song header.) `MAP_BANK.4` maps `song.windowBank` and
the three banks after it into `$4000-$BFFF`. That is why HuTrack's own ROM
puts its code at `$C000` (page 6) and tables at page 4: **the parser
temporarily owns pages 2–5.**

The interpreter owns pages 6 and 7 (its whole 16 KiB image), so the engine
cannot live where HuTrack expects it unless the window is narrowed.
PCEStudio's converter and assembler already produce **one** 8 KiB song bank
and refuse a song that outgrows it (`renderer/pce-hutrack.js`
`assemble()`'s `song-bank`), so the window's other three banks are never
used. The integration therefore stages the vendored tree and applies a
**three-line patch** to the three `MAP_BANK.4` call sites (parser line 31,
`playSong` line 377, `Process.envelopes` line 1774), changing each to the
single-bank `MAP_BANK`; `PUSHBANK.4`/`PULLBANK.4` stay (they only push
and restore the four page registers, and restoring the same values is
harmless). `vendor/` itself is untouched — the patch lives in the build
step (with `tools/ilvm/engine.patch` and a hash check, #198), so
`tests/check-hutrack.js`'s `MANIFEST.sha256` still passes.

With the narrowed window the engine runs at page 5 and the pitch routines
still map the tables bank to page 4 around their table reads, exactly as
they do today.

## 4. Mapping, and who calls the tick

**Boot mapping** (`tools/ilvm/ilvm.c`, one `tam` per page):

| MPR | page | physical bank | use |
|---|---|---|---|
| 2 | `$4000-$5FFF` | 4 | the toy's ILBC container (moved from 2) |
| 4 | `$8000-$9FFF` | 3 | HuTrack pitch tables (the pitch code remaps/restores it) |
| 5 | `$A000-$BFFF` | 2 | HuTrack code, `EngineCall`, `HuTrackTick` |

#213 maps only row 2 (the data bank moved 2 → 4); rows 4-5 are mapped by the
first sound call in #215, because no existing toy reaches the engine.

**The tick's caller is the interpreter's per-toy-frame path, not the VBlank
IRQ.** The browser's toy host is the model that must be matched: `music()`
resets the engine and then runs **one engine tick per toy frame**, before
the toy's `frame()` writes (`docs/TOYS.md` §2, "Order within a frame"). The
console does the same — the runtime's update path (the code that calls
`toy_frame()` and brackets it for #169) calls `HuTrackTick` once, *before*
the toy's `frame()` and outside the measurement bracket, and only after a
song has been started (a flag `music()` sets), so a silent toy pays nothing.
Call it from the
VBlank IRQ instead and the traces diverge the moment a toy update is slower
than one video frame, which most of these games are. The named consequence:
a 30 Hz toy's music runs at half tempo on the console; a wall-clock tick is
a separate decision and a separate card, because it changes what "the same
frames" means for #200's trace test.

The engine's `EngineCall` is pure assembly and ends with
`jmp [HuTrack.returnVec]`; nothing in it needs the C soft stack, so calling
it from the interpreter's C code through the 14-byte wrapper is safe.

**No timer IRQ.** The engine's only interrupt is the 7 kHz DDA timer; toys
use no PCM samples (the converter refuses `song-pcm`), so `TIRQ` stays off.
`EngineCall` still calls `DDA.reSync` every tick, which stops and restarts
TMA but does not change its divider. The #169 update brackets start after
the VBlank wait, and the tick runs before them, so the measurement's phase
reconstruction is unaffected — but that is a **claim to re-measure** in
#198 with `tools/measure-rom.js`, not a fact yet.

## 5. The zero page and BaseRAM budget, measured and asserted (#214)

Every figure in this section is read from a built ELF (or from the engine's
staging assembly), not from a declaration. `tools/ilvm/build.sh` prints the
partition on every build, writes it into `tools/gen/ilvm.json`'s
`ram_budget`, and **fails the build** if the interpreter's page reaches the
engine's, if either extent leaves its window, or if the stack headroom is
under `STACK_MARGIN = 787 B` — the floor this page named before the
partition existed and still names.

Both facts come from the interpreter's own ELF, so nothing here is a
constant that can drift away from the code:

| fact | where it is read |
|---|---|
| interpreter zero-page end | the `.zp.bss` + `.zp` sections' `vma + size` |
| interpreter heap start (`__heap_start`) | `llvm-nm` on the built ELF |

### Zero page (`$2000-$20FF`)

The HuC6280's zero page is one 256-byte page at `$2000`; zero-page
addressing cannot reach BaseRAM, where HuTrack's variables otherwise live.
The llvm-mos 24 compiler's LTO backend places interpreter variables in the
page automatically and **fills whatever budget it is given**: moving the
palette arrays to `.bss` by hand does not leave the page empty, because the
backend then moves other small globals in (`slot_cap`, `xargs`, the ilvm
statics). The lever is the driver's own `-mlto-zp` flag (the SDK's
`mos-pce.cfg` sets `-mlto-zp=224`, the whole page). `build.sh` passes
`-mlto-zp=96`, so the interpreter gets `$2020-$207F` and **the page ends at
`$2080` with 96 B used** (measured: `.zp.bss` `$2020-$2077` + `.zp`
`$2078-$207F`).

| owner | bytes | addresses | how measured |
|---|---|---|---|
| llvm-mos imaginary registers `__rc0-31` | 32 | `$2000-$201F` | `pce-imag-regs.ld` (fixed by the ABI) |
| the interpreter (`-mlto-zp=96`) | **96** | `$2020-$207F` | `llvm-objdump -h` on the built ELF |
| **HuTrack: `_hk` scratch + engine state** | **94** | `$2080-$20DD` | `.sym`: `EngineZp.start` → `EngineZp.end` |
| free | 34 | `$20DE-$20FF` | |
| **total** | **224 used of 256** | | fits |

The engine's `.zp` is placed by the staging assembly, whose base
`build-engine.sh` substitutes from the design ($2080); the build asserts
`interpreter end <= $2080` and `engine end <= $2100`. The old note said 93 B
for the engine; the extent label measures **94** (`HuTrack.F.ptr` is two
bytes, `$20DC-$20DD`, which an address-of-last-label count drops).

### BaseRAM (`$2200-$3FFF`, 7,680 B; the soft stack grows down from `$4000`)

| line | bytes | addresses | how measured |
|---|---|---|---|
| interpreter before #214 (`__heap_start`) | 6,558 | `$2200-$3B9D` | `llvm-nm` |
| `-mlto-zp=96`: 128 B of globals leave the page | +128 | | the build's own sections |
| `MAX_CLOS` 32 → 16 (`clos` 800 → 400) | −400 | | measured below |
| `TABLE_POOL_CELLS` 256 → 192 (`cells` 1,024 → 768) | −256 | | NOVA needs 183, STARFALL 172, TOWER 33 (`TABLES-PLAN.md` §2.1) |
| raster line tables 256 B/page-aligned → 224 B/32-byte-aligned (3,584 → 3,136) | −448 | | 14 arrays for 224 lines; the padding was dead |
| **interpreter after #214** | **5,582** | `$2200-$37CD`, heap start **`$37CE`** | `llvm-nm` |
| **#215's `ilvm_sound.c` and the glue's frame cell** | **+10** | heap start **`$37D8`** | `llvm-nm` on the #215/#220 build |
| **interpreter after #215/#220** | **5,592** | `$2200-$37D7`, heap start **`$37D8`** | `llvm-nm` |
| #222 `MAX_FUNCS` 32 → 41 (`fninfo` is 9 B a slot: llvm-mos pads nothing) | +81 | | 41 × 9 − 32 × 9 (`llvm-nm` on both objects) |
| #222 closure table 16 × 25 → 48 × 2 (`fid`, `upbase`; the old slot was 1 + 6 × int32) | −304 | | 400 → 96 B; the upvalues move to the pool below |
| #222 upvalue pool (`ups`, 72 permanent + 24 transient cells) | +384 | | the boot closures' 70 cells + the callbacks' ring |
| #222 constant offsets (`koff` 128 × 2) replace `kvals` (128 × 4); `konst()` reads the container | −256 | | 512 → 256 B; the data bank is mapped for the run |
| #222 `MAX_SLOTS` 32 → 16 (`slot_base`/`cap`/`nfields`) | −64 | | 128 → 64 B; the largest table is tables.lua's 7 sites |
| #222 the ring's state (`boot_end`, `perm_next`, `trans_next`, `in_boot`) | +4 | | |
| **interpreter after #222** | **5,438** | `$2200-$373D`, heap start **`$373E`** | `llvm-nm` on `build.sh`'s image (`90d4a655…`) |
| **HuTrack `.bss`** | **1,111** | `$373E-$3B94` | `.sym`: `HuTrack.returnVec` → `EngineBss.end` |
| **both** | **6,549 of 7,680** | | |
| **stack headroom** | **1,131** | `$3B95-$4000` | `0x4000 − engine end` |

The engine's `.bss` is placed at the llvm image's `__heap_start` (the
staging assembly gets it from `build-engine.sh`, which `build.sh` hands
`ENGINE_BSS_BASE`); the build asserts the engine starts at or above the
interpreter's heap and ends below `$4000`. The engine extent is **1,111 B**
after #215/#220 (`.sym`: `EngineBss.end − HuTrack.returnVec`); #214's
1,062 B was the pre-#215 extent, and the 1,063 B in the original design
was an address-of-last-label count. The glue's 49 B of state is the **first**
block of that `.bss` (`$373E-$376E`, #239's fix), so the soft stack reaches
the engine's own variables before the glue's: `snd_args_frames`, the `sfx()`
frames cell, is at `$376D`, and `HuTrack.returnVec` starts the HuTrack
variables at `$376F`. `tests/check-hutrack-image.js`'s scratch run of
`build-engine.sh` alone (its own placeholder BaseRAM base, no C image)
places the glue at `$2655`; that is a different build, not the shipped
address, and `tools/gen/hutrack-symbols.h` after `build.sh` carries the real
addresses.

**Why `MAX_CLOS` 16 and not 8.** The first projection spent 600 B on eight
slots. The host harness (`-DILVM_HOST`, 60 frames) says that is not safe:
eight slots diverge from 32 on PLATFORMER's VRAM and parallax's registers,
twelve still diverge on parallax's VRAM, and fourteen and sixteen match 32
on palette, PLATFORMER, parallax and DUSK RUN. Sixteen is two slots above
the measured edge and keeps every toy that runs today. The games' 30–44
closure sites need more than even 32 and were never runnable on this route
(their function/global/slot counts exceed the interpreter's arrays too); a
closure-count refusal is still owed (it is not in this card).

**Why 32-byte alignment.** The 14 line arrays existed at 256 B each for 224
lines; the page alignment cost 32 B of dead padding each. At 224 B and
32-byte alignment they are contiguous (14 × 224 = 3,136). `lda table,x` can
now cross a page (+1 cycle on that load); every stored raster capture still
compares diff 0 against the browser (check-ilvm's four ILVM captures).

### The stack canary (#214)

`tools/ilvm/ilvm.c` has a compile-time probe (`-DTOY_STACK_PROBE`, absent
from the shipped image): at every `exec()` entry it reads the llvm-mos
soft-stack pointer (`$2000/$2001`, after the prologue) and keeps the lowest
value in the `.bss` word `probe_low`. `tools/ilvm/stack-canary.sh` rebuilds
the same sources with the probe, places the engine banks against that
image, builds a ROM from the toy (default `tools/toys/loud.lua`) and runs it
in Mednafen; `tools/mcs-extract.py --ram` brings the word back, at the
address `llvm-nm` gives for `probe_low`. Measured 2026-11-02 on this machine
(`VIDEO_DRIVER=sdl`), #222 image (`90d4a655…`, headroom 1,131 B):

| toy | lowest frame | stack used |
|---|---|---|
| `tools/toys/loud.lua` (frame → level1 → level2 → level3 → leaf, five frames; PLATFORMER's shape) | `$3BC5` | **1,083 B** |
| `toys/dusk-run/main.lua` (the game the capacity work is for) | `$3BC5` | **1,083 B** |

Both toys are five `exec()` frames deep. The lowest address is
deterministic across runs. `MAX_REGS` 41 makes each frame's register array
164 B (was 128 B at 32), so the high-water rose from 912 B to **1,083 B**
and the #222 budget above raised the allowance to 1,131 B: **48 B left**.
The probe no longer counts calls: the inline block had to fit the 16 KiB
banks and the counter alone no longer did; `probe_low` staying zero is the
"probe never ran" evidence. The probe moved out of `$2130` for the same
reason (the byte-packed store there cost 12 B); the #169 measurement block
still ends at `$2127`.

The budget is therefore accepted for the call trees the shipping toys and
games express, not for arbitrary depth: **five nested interpreter frames
fit with 48 B to spare; six reach the engine block**, and the interpreter
has no depth guard or encoder refusal yet, so a deeper toy would overwrite
the engine's last variables rather than fault. That guard (+ the engine-vars
trims named below) is the follow-up if a game ever needs it. The probe image
differs from the shipped one by the probe block; the script prints its own
`__heap_start` (`$3740`, two bytes above the shipped `$373E` because of the
probe word), so the measurement is on the shipped partition to within that
word.

If more room is needed, the savings this card did not take are still named
here: the engine's 64 song slots (192 B → 24 B for 8, plus the `cpx #64`
bound in `QueueSong`) and its 48-byte name fields (96 → 32, plus the
parser's copy limit), 232 B together; `TABLE_POOL_CELLS` 184 (still covers
NOVA's 183) for 32 B more. None is in the partition.

## 6. Song and instrument data

**Layout.** HuTrack's converter writes ten `.inc` files: a header with
banked pointers, instrument and waveform tables, the pattern matrices and
data, and empty PCM tables. They are assembled into **one 8 KiB bank** at
`.org $4000` by `renderer/pce-hutrack.js`'s `assemble(files, entry,
{bank, org})`; every pointer is a `(address, bank)` pair. For a toy:

- the song is assembled at `$4000 + X` with bank number **4**, where `X` is
  its 16-byte-aligned offset in the toy's data bank after the bytecode and
  assets;
- the wrapper's small song table holds `(bank 4, $4000 + X)` per `music()`
  index;
- the data bank's existing `toy-data-bank-full` refusal covers the total,
  and a toy with music but no room gets an honest refusal, not truncation.

**The SEQUENCER already produces the right object, with two measured
gaps.** `renderer/pce-seq.js`'s `compile(song)` returns the same DMF-shaped
module `renderer/pce-dmf.js` returns, and `renderer/pce-hutrack.js`'s
`convert()` takes that shape. Measured on 2026-11-01:

- its pattern rows carry `effects: []`, not `fxSlots`; `convert()` reads
  `row.fxSlots.length` and throws (`TypeError`) — the adapter is one field
  per row (`fxSlots: [{code: 0xffff, arg: 0xffff}]` for a sequencer row,
  which has no effect columns);
- its header has no `legacyArpSpeed`, so the header assembles
  `.db 0,undefined,0` — the adapter supplies it (the DMF reader's field);
- **noise drums**: `compile()` writes no effect at all; HuTrack's noise is
  **effect `11`** on channels 5–6 (`.platFX.Noise`,
  `vendor/hutrack/docs/compatibility.md`: "`10`, `11` | Wave selection and
  noise mode"). Without it a drum plays only its volume envelope on a silent
  wave channel. The effect's **argument is the on/off flag**: the engine's
  NF is `NoiseTable[the row's semitone]` — twelve legacy values, not the
  studio's 0..31 NF — so the adapter retimes the drum row to the nearest
  legacy pitch. #199 added both halves; the earlier plan's "effect `0F`"
  was wrong (`0F` is `SetSpeed2` in the engine's own FX table).

**The gap is closed (#199).** `renderer/pce-hutrack.js`'s
`fromSequencer(module)` fills `fxSlots` on every row, writes
`legacyArpSpeed: 1`, and adds the noise effect (arg 1 at a drum's note,
arg 0 at its cut, a wave note, or a note with no instrument, tracked across
the order as `pce-seq.js`'s `noiseWrites()` does). `pce-seq.js`'s
`instrumentFromAsset()` is one conversion of `pce-assets.js`'s palette for
both the SEQUENCER panel and this path.
`tests/check-hutrack-seq.js` decodes the assembled bank back with the
engine's rules and compares it with the studio's writes: each of the 15
built-ins' envelope and 32-step wave is byte-identical and every PSG write
of its `pce-assets.traceFor` stream matches except a drum's R7 NF, which
lands on the nearest of the twelve legacy values (deltas 0–2); a
two-pattern song's rows, drum on/off rows and frame-by-frame register
stream match the studio's, with only the retimed drums' R2/R3 and the
quantised R7 differing.

**Measured song sizes.** With the adapter in place, the JS assembler
produces:

| data | includes | assembled bank |
|---|---|---|
| `pce-seq.demoSong()` (6 instruments, 4 waveforms, one 16×16 pattern) | 13,449 B of text | **521 B** (491 B before the drums' `11` effects) |
| the 15 built-ins (`pce-assets.js`: 8 wave + 7 noise) + 8 waveforms + one empty 16-row pattern | 23,416 B of text | **935 B** |

Both fit the 8 KiB data bank beside a typical bytecode (PLATFORMER's is
2,410 B). The 15 built-ins are the studio's palette (#99/#140), not a
second instrument set: each is a 32-step wave plus a driver volume envelope
(the drums' NF becomes the nearest `NoiseTable` pitch, as above).

**The comparison.** The vendored Python converter needs numpy/resampy and a
DMF, so the numeric comparison for #199 is against the studio's own model:
the same song through `pce-seq.compile` → `pce-song.js`/`pce-psg.js`
produces the register writes the browser plays, and the converted HuTrack
bank played by the console engine must produce the same writes for the same
frames (the trace test below). Where the vendored Python converter can be
run (`HUTRACK_PYTHON`), its includes are the second opinion, exactly as
`tests/check-export-song.js` already does for DMF songs.

## 7. `note()`, `sfx()`, `music()` on the console

- **`note(midi)` is not an engine call.** Both runtimes return the PSG's
  12-bit divider F for a MIDI note; the browser computes it with doubles
  (`7159090 / (64 * 440 * 2^((midi-69)/12))`, rounded and clamped 0..4095,
  `renderer/pce-il.js`'s numeric branch). The console must not compute that
  with `pow`, so it carries a **128-entry table generated from that same JS
  function** (256 B of ROM, in the tables bank's free 5,324 B) and an
  out-of-range MIDI number clamps to the table's end. A table built by the
  browser's own function cannot drift from it; the console's builtin id 1
  reads it, and a toy's `pce_reg(0/1, ...)` writes stay identical on both
  sides.
- **`sfx(ch, freq, vol, frames)`** uses the engine's own reservation, the
  same pair the browser player's `reserve`/`release` are transcribed from:
  `setChanForSFX` (channel in `_hk.EAX0.l`) makes the five reserve writes,
  then the host's fixed square is uploaded (32 R6 steps) and F/AL are
  written, and `chanReleaseSFX` (`_hk.EAX0.u`) gives the channel back after
  `frames` toy frames — a C counter in the update path, so the count is in
  toy frames on both sides.
- **`music(index)`** queues the song pointer and calls `playSong` with the
  slot; `music` again restarts. **Stop has no IL form** — #197's decision:
  the browser host's toy surface has no music-stop either, and a stop form
  would be a new toy-surface feature, not a bytecode carry of what exists.
  A card that adds `musicStop()` (or similar) to the host surface adds the
  IL form and the engine's `HuTrackEngine.stop` with it.
- **The version 3 container (#197, read since #215).** Any container with a
  sound op or a `note` builtin is version 3 — the version 2 header layout
  (28 bytes, an empty one-byte table section when there are no tables),
  since the #194 engine shares the v2 shape. #215's interpreter accepts
  versions 1, 2 and 3 (`toy_boot()`'s `ver` check); `buildToyRom` still
  refuses a *version number* outside 1-3, the same gate that refused
  version 2 before #175's interpreter learned to read it. The data-bank
  check now comes first for a sound toy that will not fit: TOWER's 8,524 B
  of bytecode refuses `toy-data-bank-full` (the message says the
  interpreter reads one 8 KiB data bank) before any ROM exists; DUSK RUN's
  7,470 B fits the bank and builds (§10's verdict is about the interpreter's
  RAM limits, not the bank). `release(ch)` on a channel no sfx owns is a
  no-op, exactly as on the host.

The engine's code is called by fixed address, never through a C prototype:
the pceas `.sym` file gives `HuTrackTick`, `HuTrackEngine.Init`,
`QueueSong`, `playSong`, `stop`, `setChanForSFX` and `chanReleaseSFX`, and
the build generates a small header with those constants for `ilvm.c`. All
of them are assembly calls; the C compiler never assumes a calling
convention across the boundary.

## 8. The trace test (#200)

The project's proven instrument for "what did the console actually do" is
the autosaved BaseRAM of a Mednafen run (`tools/mcs-extract.py --ram`;
#169). #200 turns it into a trace. `TRACE=1 tools/ilvm/build.sh` builds a
**test-only** image that appends every PSG write to three parallel BaseRAM
arrays as `(frame, register, value)`; the build **refuses to write
`renderer/ilvm.bin`** with `TRACE=1`, so the shipped image never carries
the log. `tests/check-rom-sound.js` (§3 of that file) builds the image,
exports `tools/toys/note.lua` and `tools/toys/sfx.lua` against it, runs
each in Mednafen, extracts BaseRAM and compares the log with
`renderer/pce-il.js`'s `rt.sound.events` for the same frames: same order,
same registers, same values.

- **The log.** `psg_trace_ok`/`count`/`frame`/`seen`/`reg`/`val` at
  `$373E-$3744`, then the 100-entry arrays `f`/`r`/`v` at
  `$3745`/`$37A9`/`$380D` (`tools/gen/hutrack-image.json`'s `psg_trace`
  block). Three parallel arrays, not one 300-byte record array, so every
  access is one Y-indexed load/store inside a page. The window is toy
  frames 0..23 and at most 100 writes.
- **The hooks.** The glue's own writes are instrumented in
  `tools/ilvm/hutrack_engine.asm` behind `.ifdef PSG_TRACE`. The two SFX
  reservation routines (`setChanForSFX`'s reserve and `chanReleaseSFX`'s
  release) are instrumented by `tools/ilvm/build-engine.sh`, which inserts
  a macro call after each PSG write in the **staged** vendor copy by pinned
  line number and expected text — `vendor/hutrack/` stays pristine, and a
  vendor move fails the build instead of silently tracing less.
- **The witnesses.** `PsgTraceReset` (run from `SndGlueReset`) fills all
  three arrays with `$EE` and sets a `$A5` "reset ran" byte; the test
  requires both, so a log the soft stack overwrote cannot pass. The trace
  image's engine `.bss` is **1,418 B** (the shipped image's 1,111 B plus
  307 B of log) and `build.sh` still asserts the 787 B stack margin
  (**824 B** measured); the shipped image's partition is unchanged
  (`$373E-$3B94`, 1,111 B, headroom 1,131 B per §5).
- **What it measured (2026-11-02).** note: **92 writes over 24 frames**,
  equal frame for frame to the studio's; sfx: **48 writes**, equal. The
  trace pins both glue defects: note(60)'s F arrived as 268 instead of 428
  (#238), and the first SFX's reserve was missing because the zero-song
  loop had overrun `snd_owned` (#239). Both fixes are in the committed
  image (`renderer/ilvm.bin` sha256 `dad10ffd05661956…`, #200's image;
  #113 moved it to `46ccefb6…` with the R1 write, §11), and the moved
  ROM shas are re-pinned in `tests/check-ilvm.js`,
  `tests/check-export-games.js` and `tests/dumps/*-ilvm/meta.json`.
  **After #113** the same trace records **94 writes** for note and **49**
  for sfx — the one extra R1 = `$FF` per `sfx()` call, still equal to the
  studio's stream frame for frame — on image `46ccefb656d18ca9…`.
- **Honest limits.** Mednafen, one machine, no real console. The window is
  24 toy frames and 100 writes, so a longer run is sampled, not traced end
  to end. Both toys make no `music()` call, so the engine's own per-frame
  tick is not in the trace (the host-harness half of the same test pins
  the tick's order separately). Before #113 the toys were master-muted
  because neither side wrote R1; since #113 both sides write it, the trace
  records it, and §11's WAVs are audible. Rule 2's cold break on this test
  is owed — the design seat wrote it.

A toy with music is a stronger test but a different one: it exposes the
tick's caller, which is why the tick is designed to match the host model
first (§4).

## 9. Reproducing the measurements

```sh
# interpreter image, the engine banks, and the asserted partition (#214):
# build.sh prints the zero-page and BaseRAM lines and fails the build if
# either budget is broken.
LLVM_MOS=/Volumes/External/pce-tools/llvm-mos PCEAS4=pceas4 tools/ilvm/build.sh
"$LLVM_MOS/bin/llvm-nm" -S tools/gen/ilvm.pce.elf   # __heap_start, .zp.bss
python3 -m json.tool tools/gen/ilvm.json | grep -A24 ram_budget
python3 -m json.tool tools/gen/hutrack-image.json | grep -A18 '"ram"'

# the stack canary: a probe build of the same sources, the loud toy, and a
# Mednafen save state (VIDEO_DRIVER=sdl; ~15 s).  It prints the high-water
# mark and exits non-zero if the stack reaches the engine block.
LLVM_MOS=/Volumes/External/pce-tools/llvm-mos PCEAS4=pceas4 \
  tools/ilvm/stack-canary.sh                 # tools/toys/loud.lua
LLVM_MOS=/Volumes/External/pce-tools/llvm-mos PCEAS4=pceas4 \
  tools/ilvm/stack-canary.sh path/to/other.lua

# engine sizes and the engine-only RAM (needs pceas4, docs/BUILD.md).
# The staging assembly is this, with the §3 patch applied to a COPY of lib/:
#   .zp                        .bank $02, "Engine"
#   .org $2080                 .org $A000
#   .bss                       .include "HuTrack/hutrack.inc"
#   .org <engine bss start>    .include "HuTrack/HuTrack_lib.asm"
#   .include "HuTrack/HuTrack_vars.inc"
#                              .include "HuTrack/engine/HuTrack_parser.asm"
#                              .include "HuTrack/engine/HuTrack_engine.asm"
#                              HuTrackTick: ... jmp HuTrackEngine.EngineCall
#                              .bank $03, "Tables"
#                              .org $8000
#                              .include "HuTrack/engine/HuTrack_pitch_tables.inc"
PCE_INCLUDE=<staged lib> pceas4 -raw -o engine.bin engine.asm

# song sizes: pce-seq.demoSong() and the 15 pce-assets instruments through
# pce-hutrack.fromSequencer() (fxSlots on every row, legacyArpSpeed: 1 and
# the drums' effect 11 — the adapter #199 landed), convert() and assemble():
#   521 B for the demo song, 935 B for the 15 built-ins + 8 waves.
# tests/check-hutrack-seq.js pins both numbers and re-runs the comparison.
```

The exact numbers in this page are from those commands on 2026-11-01, and
§5's partition and canary from the same commands on 2026-11-02; a toolchain
change that moves them is a change to this page.

## 10. What #221 re-pinned, and the evidence

#220 landed the sound ops in the interpreter (`renderer/ilvm.bin` sha256
`1814d7c36079ca63…`, 32,768 B). Every toy ROM embeds that image, so every
pinned ROM sha moved. The pins were changed **after** the pictures were
compared, not instead of comparing them: each toy was built twice — once
with the old image (`git show 1b76c08:renderer/ilvm.bin`, sha256
`b803f2e5476bb7a5…`) and once with the new one — and both ROMs were run in
Mednafen with the same route as `tools/capture-ilvm.sh` (`-qtrecord`,
`-pce.slstart 3 -pce.slend 234`, 256x224, SIGINT, no input). The comparison
is byte-for-byte on the decoded RGB frame.

| toy | old ROM sha256 | new ROM sha256 | frame 0 | a later frame |
|---|---|---|---|---|
| `tools/toys/palette.lua` | `f073c605…` | `a47a9ff6…` | identical | old 239 = new 116, identical (the 8-picture cycle) |
| `toys/parallax.lua` | `af11f340…` | `34ee53d6…` | identical | old 395 = new 474, identical |
| `toys/status-bar.lua` | `40cac99e…` | `26fe5da6…` | identical | old 392 = new 514, identical |
| `tools/toys/sprite.lua` | `ff0f3c57…` | `ffc25655…` | identical | old 474 = new 15, identical (static picture) |
| `tools/toys/arity.lua` | `06ecb262…` | `31075210…` | identical | old 389 = new 120, identical |
| `tools/toys/not.lua` | `0d262ed6…` | `2dc998ad…` | identical | old 399 = new 89, identical |
| `toys/platformer/main.lua` | `8639685c…` | `ff6097dd…` | identical | old 576 = new 496, identical |

For palette, sprite, arity, not and PLATFORMER the **set of distinct
pictures is equal** (9, 2, 17, 5 and 3 pictures; every old frame has an
exact twin in the new capture). Parallax and status-bar are continuous
animations — their BXR is a function of the toy frame `f`
(`toys/parallax.lua` :91-94, `toys/status-bar.lua` :90-91), and the two
ROMs advance `f` at slightly different wall rates, so the two captures
sample different phases: parallax has 13 old-only pictures (first seen at
old frames 283, 322, 361, 400, 439-441, 478-480, 517-519) and 4 new-only
(394, 433, 472, 511); status-bar has 28 and 7. The boot picture and the
chosen later pair are byte-identical in both. **Not proven:** that each
unmatched picture is an adjacent scroll phase of one the other run
sampled — a one-pixel scroll shift changes many pixels, so the diff
percentage cannot show it, and this card did not replay the two runs
frame-for-frame. The measured claim is the table's: frame 0 and a later
frame are identical, and five of the seven toys have equal picture sets.
The larger proof that these toys still behave as the browser does is
`check-ilvm`'s dump comparison, which is unchanged (§10's last paragraph).

The pinned hashes in `tests/dumps/*-ilvm/meta.json`, `tests/check-ilvm.js`
and `tests/check-export-games.js` are the **new** shas above (ILVM sha256
`1814d7c36079ca63…` in all four meta files). The dump *frames* and RAM
images themselves are not recaptured: they are the old image's run, and
the diffs above are what makes them evidence for the new one. `check-ilvm`
re-emits every toy from the new image and asserts the new ROM sha; the
captures it compares against the browser are unchanged because every
picture is.

**DUSK RUN loads, runs and draws; its displayed picture is not the
browser's yet.** #222 raised the interpreter's capacities — `MAX_REGS` 41
(the frame hook's register count), `MAX_FUNCS` 41 (the container's function
count), `MAX_UPS` 20 with the upvalue **pool** (function 39's 19 upvalues
do not fit 16 closures × a per-closure array), and `MAX_CLOS` 48 with the
boot/transient split (27 boot closures stay valid; later callbacks share a
ring above them). The ROM is 40,960 B (sha256 `6524513a…`). Its VM state is
now byte-equal to the browser's: a Mednafen save state at 20 s has
VRAM/CRAM/SAT **diff 0 against browser frame 3**, and the `-DILVM_HOST`
harness matches the browser for 900 frames.

The runtime's base-VRAM buffer was the second half: it held 32 words a
frame and **dropped** the rest (MEAS flags bit 0), and DUSK's build steps
write 64 (sprites), 68 (landscape) and 208 (the font step) VRAM words.
`tools/ilvm/ilvm_runtime.c` now writes an over-buffer word through instead
of dropping it, which keeps the final VRAM exact; that display frame may
tear, and the next replay frame is the toy's picture.

**The picture is the browser's now (#227).** The raster backend used to arm
the RCR chain once per toy frame, so only **one display frame** per toy frame
replayed the table; DUSK's build step takes ~37 display frames (the 0.26 Hz
build projection in ROM_SPEED.md), so a short capture's tail was the last
line's registers. The chain is now re-armed on every display frame while a
toy frame runs, and each line's entry is preloaded into zero page one
scanline early, so its colour write lands inside the blank (it used to
complete ~28 CPU cycles late, leaving row 16's first 16 pixels the old
colour). Measured: DUSK RUN's 12 s capture is diff 0 against browser frame 1
(frames 1–6 are one static early picture), and its save state's CRAM and SAT
are diff 0 against browser frames 0–11. `tests/check-export-games.js` pins
DUSK's ROM sha and those browser-frame hashes. TOWER stops earlier, at
`toy-data-bank-full` (8,524 B of bytecode against the 8 KiB bank), which is a
refusal with a message and no ROM (it was reworked in place later, see
ROM_SPEED.md).

**#200 re-pinned again**, for the second image change (2026-11-02):
`renderer/ilvm.bin` is sha256 `dad10ffd05661956…`, 32,768 B, and the ROM
shas in the table above, `tests/check-ilvm.js`, `tests/check-export-games.js`
and `tests/dumps/*-ilvm/meta.json` moved with it. The image change is
sound-only — #238's F byte and #239's glue `.bss` placement and zero-song
guard — and no toy's picture moved. That is measured, not assumed:
`check-export-games` re-ran the Mednafen capture route on the new image
and palette, arity, not, sprite and PLATFORMER are still
**diff 0** against the browser, and `check-ilvm`'s dump comparison is green
with the old capture frames (they are the browser's, and the browser did
not change). The dump frames and RAM images are deliberately **not**
recaptured: the #221 procedure above is what makes them evidence for the
new image, and re-running the same argument for a sound-only change would
only re-capture the same pictures.

**#113 re-pinned for the third image change (2026-11-02):**
`renderer/ilvm.bin` is sha256 `46ccefb656d18ca9…`, 32,768 B, and the same
ROM shas moved again. The change is two instructions and one C write —
`SndGlueSfx` writes `$801 = $FF` before its reserve (and the trace logs it),
`ilvm_sound.c`'s host half writes the same byte, and
`renderer/pce-toyhost.js`'s `sfx()` writes `soundWrite(1, 0xff)` — so no
toy's picture can move. `check-export-games` re-ran the Mednafen capture
route on this image (the same five controls and games, diff 0 against the
browser), and `check-ilvm` is green with the re-pinned dumps; §11 records
the audible WAVs this image produces.

## 11. What Mednafen says (#216): the toys run, and the glue has defects

Measured 2026-11-02 on this machine, Mednafen 1.32.1 with the sound route
[`tools/capture-hutrack.sh`](../tools/capture-hutrack.sh) established:
`pce_fast`, `-pce_fast.ocmultiplier 1`, `-sound.driver dummy`,
`-sound.rate 44100`, `-soundrecord`, `-video.driver sdl`, SIGINT for a clean
exit between frames. Two toys, both exported with
[`tools/ilvm/emit.js`](../tools/ilvm/emit.js) and no compiler:

| toy | what it plays |
|---|---|
| [`tools/toys/note.lua`](../tools/toys/note.lua) | C4/E4/G4/C5 (`note(60/64/67/72)`), 12 toy frames each (200.6 ms), repeating every 48 frames. F 428/339/285/214 = **261.4/329.7/392.1/523.0 Hz** |
| [`tools/toys/sfx.lua`](../tools/toys/sfx.lua) | every 60 frames: channel 1 a raw **F 200 (559.3 Hz)** for 10 frames; channel 2 `note(48)` (**F 855, 130.8 Hz**) for a 600-frame budget, cut by `release(2)` at frame 50 |

**On the image committed before #200 (sha256 `90d4a655…`) both toys are
silent.** ROMs: note 40,960 B `7a8f2896…`, sfx 40,960 B
`d727e2a0…`. Both WAVs have peak 0. A Mednafen save state (the
`tools/mcs-extract.py` route) shows the glue **did** run — channel 0
selected, R5 = `$FF`, R4 = `$8F`, the 32-step square uploaded — and gives
the difference to the studio in one line each:

- **R1 (the PSG's main amplitude, `$0801`) is 0**, so the chip is
  master-muted. Neither `note()` nor `sfx()` writes it; HuTrack's Init does
  (`vendor/hutrack/lib/HuTrack/HuTrack_lib.asm:37`, `Global.SetVolume =
  $FF`), and a toy with no `music()` never runs Init. This is card **#113**
  in the studio's own model too: `rt.renderSound()` for the same toy
  renders peak 0 on this tree.
- **The console's F is masked on the wrong byte.** `SndGlueSfx`
  ([`tools/ilvm/hutrack_engine.asm:233`](../tools/ilvm/hutrack_engine.asm))
  does `lda <_hk.EAX0.m / and #$0F / sta <_hk.EAX0.m` — the low byte — where
  the 12-bit clamp belongs on the high byte (`_hk.EAX0.h`). The value is
  `F' = (F & $0F) | (F & $0F00)`: on `90d4a655…` note(60)'s **428 became
  268** (417 Hz, the save state's `CH0.frequency`), note(48)'s 855 became
  775 (144 Hz), and the sfx toy's raw 200 became 8 (13,982 Hz).

**With those two writes changed in a scratch image** (`renderer/ilvm.bin`
`92d6dc42…`, built by `tools/ilvm/build.sh`; not committed — it moves every
pinned ROM sha and is card #238 plus #113) the same two toys play, and the
recording matches the studio's `pce-psg` render of the same frames. The
studio column needed the same R1 write for the same reason: on this tree
`rt.renderSound()` is silent too (measured, peak 0 — #113), so it is the
studio with `soundWrite(1, 0xff)` added at the reserve:

| toy | studio `rt.renderSound()` for the same frames | Mednafen, `90d4a655…` | Mednafen, scratch image `92d6dc42…` |
|---|---|---|---|
| note | 261 / 330 / 392 / 523 Hz, RMS 369–370 | silent (peak 0); PSG state F 268 for note 60, R1 0 | 330 / 392 / 523 / 261 Hz (the capture began on the second note and repeats through C4/E4/G4/C5), RMS 368–370 |
| sfx | 559 Hz for 167 ms, then 131 Hz for 334 ms; RMS 367 / 371 | silent (peak 0) | 559 Hz for 170 ms (RMS 360), 131 Hz for 341 ms (RMS 367), repeating every 1,003 ms |

Every pitch is the F the studio writes, within 1 Hz (the analyser's 1 Hz
DFT grid), and the levels agree within 2%. ROMs from the scratch image:
note 40,960 B `34be5540…`, sfx 40,960 B `55038a0a…`.

**A third defect, measured and not yet fixed: the glue's state is not clean
at the first sound op.** A toy that calls `sfx()` **once** at frame 0 (or
every frame with a constant F) stays silent even on the scratch image: the
save state shows `snd_owned` and `snd_tick` in the glue's `.bss` holding
stack-like garbage (`snd_owned[0] = $CF`, `snd_tick = 4`), so the reserve is
skipped (no R5, no R1) and a non-zero `snd_tick` makes the per-frame tick
run the engine with uninitialised state, which mutes the chip. The note and
sfx toys recover only because they reserve again every 12 / 60 frames.
Moving the glue `.bss` 64 B higher did not stop it, so the write is not
simply the soft stack reaching the partition. Root cause is open (card
**#239**); until it is fixed, an R1 write must be unconditional at the start
of `sfx()`, not gated on a channel being newly owned.

**What #200's image changed (2026-11-02).** The committed image is now
`dad10ffd05661956…` and carries both repairs the trace forced: the F clamp
moved to `_hk.EAX0.h`, and the glue's state moved to the **bottom** of the
engine's `.bss` — below the soft stack's measured reach, which the trace
build's `$EE` tail witnesses — while `SndGlueMap`'s zero-song loop now
tests the stored count (`cmp #1 / bcc .done`) instead of a `beq` that read
the stale flags of a `sta`, so the `n = 0` trailer no longer writes song
pointers over `snd_owned`. §8's trace is the proof of effect: the
console's PSG writes equal the studio's for both toys, frame for frame. The
audio table above was **not** re-recorded while #113 (R1) was open: the chip
stayed master-muted, so a new WAV would only have repeated peak 0. #239
remains open on the board for the audio/save-state evidence its card names;
its code half is in this image. **#113 has since landed** (the next
subsection): the committed image's WAVs are audible.

**#238's F on the committed image (2026-11-02).** `tools/ilvm/build.sh`
run from this tree (to a scratch `BIN`) reproduced the then-committed
`dad10ffd05661956…` byte for byte (32,768 B), so the image carried the
`_hk.EAX0.h` clamp (#113's image `46ccefb6…` carries it too — §11). The
card's own instrument, a Mednafen save state
(pce_fast, `-autosave 1`, SDL video, one emulator at a time), now reads the
corrected 12-bit F out of the PSG's `SCHn.frequency` records:

| toy (frame 0…) | F written | state's channel frequency | pre-fix value (`90d4a655…`) |
|---|---|---|---|
| `tools/toys/sfx-once.lua`, `sfx(0, note(60), 15, 600)` | 428 | CH0 `$1AC` = 428 → **261.4 Hz** | 268 → 417 Hz |
| `tools/toys/note.lua`, `note(64)` | 339 | CH0 `$153` = 339 → **330.0 Hz** | 259 → 431.9 Hz |
| `tools/toys/sfx.lua`, raw `sfx(1, 200, …)` | 200 | CH1 `$0C8` = 200 → **559.3 Hz** | 8 → 13,982 Hz |
| `tools/toys/sfx.lua`, `note(48)` | 855 | CH2 `$357` = 855 → **130.8 Hz** | 775 → 144 Hz |

The state shows one note of `note.lua`'s cycle. The table quotes the run
made with no other emulator on the machine; an earlier run of the same toy,
taken while another seat's Mednafen was running, caught `note(67)` at
`$11D` = 285 (392.5 Hz) with the same R1 (the toy's writes do not depend on
wall time; only which note the save lands in does). The pre-fix column
is the documented mask `(F & $0F) | (F & $0F00)`; note(60)'s, note(48)'s
and raw 200's values are the ones §11 measured on `90d4a655…`, and
note(64)'s 259 is that mask applied to 339.

`PSG.globalbalance` (R1) read `$00` in all three runs before #113, so the
chip was master-muted and a WAV could not yet measure these pitches. The
state's `SCH0`–`SCH5` sections are the six PSG channels (their `frequency`
record is the 12-bit divider) and `PSG.globalbalance` is R1;
`tools/mcs-extract.py` walks the same gzip container but keeps only the
VDC/VCE records, so these were read with a scratch parser over its
sections. The register content is
what this card is about, and it now equals the F the studio writes, which
§8's trace confirms write for write (after #113: note 94 writes, sfx 49,
over 24 frames; `tests/check-rom-sound.js` PASS). With that image,
`check-ilvm` (348 checks) and `check-export-games` (67 checks, and every
captured frame still diff 0 against the browser) are green. #238's F half
is proven on this evidence and its audible clause is measurable since
#113; closing the card is the card's own seat's step.

**#113 on the committed image (2026-11-02).** The committed image is
`renderer/ilvm.bin` sha256 `46ccefb656d18ca9…`, 32,768 B;
`tools/ilvm/build.sh` reproduces it byte for byte from this tree. The
change is the same R1 write in three places: `SndGlueSfx` writes
`$801 = $FF` before its reserve (and `PSGT_A 1` logs it in the trace
build), `ilvm_sound.c`'s host half writes the same byte, and
`renderer/pce-toyhost.js`'s `sfx()` writes `soundWrite(1, 0xff)` first on
the studio side. The two toys
run exactly where they did: `tests/check-rom-sound.js` is green, its trace
now equal to the studio for **94** (note) and **49** (sfx) writes, R1
included. The recordings, made on this image with the §11 route:

| toy | ROM (40,960 B) | Mednafen WAV |
|---|---|---|
| `tools/toys/note.lua` | `ddb2b84849bdeb70…` | **261 / 330 / 392 / 523 Hz, RMS 368–370** (peak 440) |
| `tools/toys/sfx.lua` | `586b35a5b2ab1583…` | **559 Hz (RMS 368), then 131 Hz (RMS 371)**, repeating every 1,003 ms |

The studio's `rt.renderSound()` for the same frames is non-silent too and
gives the same pitches — note.lua renders 261/330/392/523 Hz at RMS
368–370 with `soundWrite(1, 0xff)` in place. That is the audible half of
#216's finding closed; #239's one-shot `sfx-once.lua` state evidence and
#238's close remain with their cards, and the ordering reason the R1 write
is unconditional (not gated on a new ownership) is still #239's.

**Reproducing all of it** (nothing is written to the repository):

```sh
# the two ROMs and their recordings, from the committed image (#113)
tools/capture-rom-sound.sh tools/toys/note.lua note
tools/capture-rom-sound.sh tools/toys/sfx.lua sfx
node tools/rom-sound-pitch.js "$TMPDIR/pce-rom-sound/note/note.wav" \
     --period-ms 200.6 --slots 4          # 261/330/392/523 Hz, RMS 368-370
node tools/rom-sound-pitch.js "$TMPDIR/pce-rom-sound/sfx/sfx.wav" \
     --period-ms 1003 --window-ms 60:140  # 559 Hz blip, 131 Hz note

# the studio's own output for the same frames (non-silent since #113)
node tools/rom-sound-pitch.js --studio tools/toys/note.lua --frames 48 \
     --period-ms 200.6 --slots 4

# the pre-#113 scratch image, kept as the historical measurement: apply the
# two changes below to a COPY of the tree, then
LLVM_MOS=/Volumes/External/pce-tools/llvm-mos PCEAS4=pceas4 \
  tools/ilvm/build.sh                      # 32,768 B, sha256 92d6dc42…
tools/capture-rom-sound.sh tools/toys/note.lua note-fixed \
  "$TMPDIR/fiximg/renderer/ilvm.bin"
node tools/rom-sound-pitch.js "$TMPDIR/pce-rom-sound/note-fixed/note-fixed.wav" \
     --period-ms 200.6 --slots 4          # 330/392/523/261 Hz, RMS 368-370
tools/capture-rom-sound.sh tools/toys/sfx.lua sfx-fixed \
  "$TMPDIR/fiximg/renderer/ilvm.bin"
node tools/rom-sound-pitch.js "$TMPDIR/pce-rom-sound/sfx-fixed/sfx-fixed.wav" \
     --period-ms 1003 --slots 4           # 559 Hz blip, 131 Hz note
```

The analyser measures a slot's fundamental as the peak of a Hann-windowed
DFT (50–1500 Hz) over the middle of the slot, and the first sound's onset as
the first 5 ms block over 10% of the loudest block; it is an instrument, not
a test. **#113 landed these two changes** — the F clamp is #238's and was
already in the image — with the R1 write **unconditional** at `sfx()`
entry, not gated on a new ownership (the #239 defense):

```diff
--- a/tools/ilvm/hutrack_engine.asm
 .chin:
-    lda <_hk.EAX0.m
+    lda <_hk.EAX0.h
     and #$0F
-    sta <_hk.EAX0.m
+    sta <_hk.EAX0.h
...
 .framesok:
     jsr SndGlueMap
+    lda #$FF
+    sta $801            ; R1: the main amplitude HuTrack's Init sets
+    PSGT_A 1
     lda #1
     sta snd_active
...
     jsr HuTrackEngine.setChanForSFX
```

```diff
--- a/renderer/pce-toyhost.js          (the studio's side, #113)
@@ sfx(): after the range checks, before the reserve
+        soundWrite(1, 0xff);
         if (!sound.sfx[ch].owned) {
           sound.sfx[ch].owned = true;
           if (sound.player) sound.player.reserve(ch);
           else lib.reserveWrites(ch, soundWrite);
```

## What is not proven

- **A note toy and an sfx toy run *and sound* in Mednafen, and §8's trace
  (#200) shows their register writes are the studio's.** Since #113 the
  committed image writes R1 and §11 records the WAVs: note at
  261/330/392/523 Hz, sfx at 559/131 Hz, levels within 2% of the studio's
  render. What is still unproven is anything about a *real console*
  (Mednafen only) and the in-frame timing (the trace pins the order of
  writes, not their cycle offsets).
- **The RAM partition is built and asserted (#214), and #215's sound code
  is inside it.** `build.sh` fails if the interpreter's zero page reaches
  the engine's, if either extent leaves its window, or if the stack headroom
  is under 787 B; the measured headroom after #222 is 1,131 B (§5). The
  canary's high-water mark is 1,083 B for the deepest toy-shaped call tree,
  48 B above the engine block — and one frame deeper reaches it, with no
  depth guard or encoder refusal yet (named above as the follow-up).
- **The canary is one toy and one machine.** It measures the interpreter's
  soft stack, not the engine's (the engine runs on the 6502 stack and its
  own `.bss`); Mednafen only, no real console.
- **The tick's placement is a design decision.** It matches the browser's
  toy-frame model and therefore the trace; it slows music in a toy slower
  than 60 Hz. Wall-clock tempo is not attempted.
- **The timer interaction is a claim, not a measurement.** `DDA.reSync`
  restarts TMA every tick; #198 re-runs `tools/measure-rom.js` on a sound
  toy and compares the verdicts with the same toy's image without music.
- **The engine's per-frame cost is unmeasured.** It runs outside #169's
  bracket by design; the frame-rate effect on a 30 Hz toy (TOWER, DUSK RUN)
  is measured in #198/#200.
- **The SEQUENCER adapter and the noise effect are landed (#199)** and their
  data half is measured by `tests/check-hutrack-seq.js`; the console half is
  still unwitnessed — #216 showed the engine executes (its glue and
  `setChanForSFX` reach the PSG, §11), and #200 fixed two of the three glue
  defects the trace found; #113 has since added the R1 write, so a song's
  remaining blocker is `buildToyRom` pinning the trailer at n = 0.
- **Rule 2 is owed** for any check #198–#200 and #220/#221 write: the author
  is not the seat that can prove it. #214's build assertions are the design
  seat's own; a cold seat should move `ENGINE_ZP_BASE` down and raise
  `STACK_MARGIN` and watch `build.sh` fail; the re-pin's old/new frame diffs
  should be re-run with an image whose sound ops are broken, and DUSK RUN's
  black verdict should be attacked by an interpreter that *does* load its
  container. For #200's trace specifically: break a traced write (drop one
  of the `PSGT_*` calls), or stop `PsgTraceReset` filling the tail, and the
  test must go red — that is the break this card closes on.

## The slices

| card | state | what | closes on |
|---|---|---|---|
| **#196** (this page) | done | the measured link design and budgets | the numbers reproduce; no suite red |
| **#197** | done | the encoder and the C emitter carry `note`, `sfx`, `release`, `music`; the version 3 container and its gate | `check-ilvm`, `check-romcheck`, `check-agent-core` green; a note/sfx toy encodes and the host harness runs it |
| **#212** | done | the HuTrack engine as a standalone two-bank pceas image | code `$A000-$BEC4`, tables `$8000-$8B34`, `check-hutrack-image` green |
| **#213** | done | the engine banks linked into a 32 KiB `renderer/ilvm.bin`, data bank 4 | every existing toy ROM runs and captures identically |
| **#214** | done | the zero-page and stack budgets asserted; the stack canary measured | `build.sh` fails on a broken budget (shown by a mutation); the measured depth is above (§5) |
| **#215** | done | the interpreter ops for note/sfx/release/music call the engine; the per-toy-frame tick; version 3 accepted | `tests/check-rom-sound.js` PASS; version 1 and 2 containers still run; `check-ilvm` green |
| **#220** | done | the sound ops fit the 32 KiB image (the note table and the cold glue moved to the engine's tables bank) | `build.sh` exits 0, `ilvm.bin` stays 32 KiB, `check-hutrack-image` green |
| **#221** | done | land #220's image and re-pin what it changed | every re-pinned ROM sha has an old/new Mednafen diff (§10); `check-ilvm` and `check-export-games` green; DUSK RUN's black verdict and TOWER's refusal documented |
| **#222** | open (umbrella) | the interpreter's capacities: DUSK RUN's container needs 41 registers, 41 functions and 19 upvalues (MAX_REGS 32, MAX_FUNCS 32, MAX_UPS 6) | **done**: MAX_REGS 41 / MAX_FUNCS 41 / MAX_UPS 20 with the pool; the container loads, runs and its state is diff 0 against browser frame 3; build.sh asserts (headroom 1,131 B) and the canary measures 1,083 B. **Left**: the displayed picture was #227, now fixed (diff 0, below) |
| **#227** | done (2026-11-04) | the raster backend showed one replay frame per toy frame and one scanline's first 16 pixels lagged the write | the chain is re-armed at every VBlank while a toy frame runs (the last complete picture is on every display frame) and each line's entry is written from a zero-page preload inside the blank. DUSK RUN's 12 s capture is diff 0 against browser frame 1, its hashes are pinned in `check-export-games`, its 20 s save state's CRAM and SAT are diff 0 against browser frames 0–11, and the other raster captures (parallax, status-bar) still pass `check-ilvm`. `renderer/ilvm.bin` d68a1b5f567d824b, 32,768 B, HuTrack banks unchanged |
| **#216** | done (§11) | a note toy and an sfx toy run in Mednafen, recorded and measured | both ROMs run; the register/audio differences were listed: F masked (#238), R1 missing (#113), dirty glue `.bss` (#239); #113 and #238's F are now in the image and the WAVs are audible (§11); the command is §11 |
| **#198** | done | the umbrella: everything #212–#216 links | a note toy and an sfx toy run and play in Mednafen since #113; `check-ilvm`, `check-export-games` green |
| **#199** | open | the SEQUENCER song and the 15 built-ins as HuTrack data; the noise effect `11` | a numeric comparison with the studio's writes (`check-hutrack-seq.js` PASS); a toy's `music(index)` plays in Mednafen (#216) |
| **#200** | done (2026-11-02) | `tests/check-rom-sound.js` §3, the `TRACE=1` build and these docs | PASS: the Mednafen trace equals the studio's for note (92 writes) and sfx (48) over 24 frames; `check-ilvm` (348) and `check-export-games` (67) green with the re-pinned shas. **Rule 2's cold break is still owed** — this table records the evidence, not the proof |

The umbrella (#194) closes when #196–#200 are done. TOWER stays blocked on
the 8 KiB data bank (#138), NOVA TIDE on `raster(line, spec)` (#136), and
DUSK RUN exports but needs the interpreter's capacity (#222);
`docs/ROM_SPEED.md` has their measured lines.
