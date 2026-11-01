# Sound in the exported ROM (#194, step 1)

The exported toy ROM is the IL interpreter image
[`renderer/ilvm.bin`](../renderer/ilvm.bin) (16,384 B, built once by
[`tools/ilvm/build.sh`](../tools/ilvm/build.sh) with llvm-mos) plus the toy's
bytecode in the next physical bank. Sound in a toy is refused today: the
encoder has no `music`/`sfx`/`release` op and no `note` builtin
(`renderer/pce-ilbc.js`), and TOWER, DUSK RUN and NOVA TIDE are stopped on
exactly those instructions ([`ROM_SPEED.md`](ROM_SPEED.md) §#193).

This page is the design half: **how the vendored HuTrack engine
([`vendor/hutrack/`](../vendor/hutrack/VENDORED.md), MIT) links beside the C
interpreter, and what it costs.** Every size below was measured on
2026-11-01 with the toolchain on this machine; the projections that are not
yet built are marked as projections. The implementation is split into
#197–#200 (the end of this page); #196 is this note.

The two facts that decide the design:

1. **HuTrack's code and tables cost 16,384 B of ROM — two whole 8 KiB
   banks — even though only 10,744 B are used.** They cannot share a bank
   with each other (the pitch tables must be mapped at page 4 and the code
   runs at page 5), so the image grows from 16 KiB to 32 KiB and every toy
   ROM from 24,576 B to 40,960 B.
2. **The engine's RAM does not fit beside today's interpreter.** 93 B of
   zero page and 1,063 B of BaseRAM, against a zero page that is already
   full and 1,122 B of stack headroom. The partition below is the proposal;
   #198 proves it with the build's own assertions and a Mednafen canary.

## 1. The two toolchains, and why the image is concatenation

`renderer/ilvm.bin` is not linked with anything. llvm-mos builds a fixed
16 KiB image for `$C000-$FFFF`:

| physical bank | CPU window | content |
|---|---|---|
| 0 | `$E000-$FFFF` | crt0, vectors, the runtime |
| 1 | `$C000-$DFFF` | the interpreter (`exec` 9,724 B) |

The browser appends the toy's ILBC container as physical bank 2
(`renderer/pce-rom.js` `buildToyRom`), and `tools/ilvm/ilvm.c` maps it at
MPR2 (`$4000-$5FFF`, `TAM #$04`) at boot.

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

- `renderer/ilvm.bin`: **16,384 B → 32,768 B**.
- A toy ROM: **24,576 B → 40,960 B** (five 8 KiB banks, a legal HuCard
  size). The toy's data bank moves from physical bank 2 to **physical bank
  4**; `renderer/pce-rom.js`'s `ILVM_BYTES`/`TOY_DATA_BANK` follow in #198.

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

## 5. The zero page and BaseRAM budget, measured

### Zero page (`$2000-$20FF`)

The HuC6280's zero page is one 256-byte page at `$2000`; zero-page
addressing cannot reach BaseRAM, where HuTrack's variables otherwise live.

| owner | bytes | addresses | how measured |
|---|---|---|---|
| llvm-mos imaginary registers `__rc0-31` | 32 | `$2000-$201F` | `pce-imag-regs.ld` (fixed by the ABI) |
| the interpreter: `.zp.bss` 216 + `.zp` 8 | **224** | `$2020-$20FF` | `llvm-nm` on the built ELF |
| **HuTrack: `_hk` scratch + engine state** | **93** | `$2000-$205C` in an engine-only assembly | `llvm-nm`/`.sym`, `_hk.R1` → `HuTrack.F.ptr` |
| total | **349** in a 256-byte page | | over by **93 B** |

The interpreter's 216 B are not all state: **128 B are the four pending
palette arrays** (`toy_pend_pal_a_lo/hi`, `toy_pend_pal_w_lo/hi`, 32 B
each), and 64 B the two pending VRAM address arrays; the remainder is 24
scalars. The palette arrays are written by `frame()` and applied in the
next VBlank (`apply_base()`), so they can live in BaseRAM at the cost of a
few cycles in a once-per-frame loop (#198 measures that cost with #169's
counter).

**Proposed partition (the arithmetic):** move the four palette arrays from
`.zp.bss` to `.bss` (128 B → BaseRAM), leaving the interpreter 96 B at
`$2020-$207F` and placing HuTrack's 93 B at `$2080-$20DC`, with 35 B spare.
The engine's `.zp` is placed by the staging assembly:

```
    .zp
    .org $2080
    .bss
    .org <__bss_end from the llvm image>
    .include "HuTrack/HuTrack_vars.inc"
```

measured to put `_hk.R1` at `$2080` and `HuTrack.returnVec` at the `.org`
address. `tools/ilvm/build.sh` asserts the interpreter's own zero-page end
is at most `$2080` (a build that grows it fails loudly instead of silently
overlapping the engine).

### BaseRAM (`$2200-$3FFF`, 7,680 B; the soft stack grows down from `$4000`)

| owner | bytes | addresses | how measured |
|---|---|---|---|
| interpreter `.bss` (table pool 1,024, closures 800, constants 512, raster line tables 3,584, …) | **6,558** | `$2200-$3B9D` | `llvm-nm`, `__heap_start` = `$3B9E` |
| **HuTrack `.bss`** | **1,063** | `$2200-$2626` in the engine-only assembly | `.sym`: `HuTrack.returnVec` → `HuTrackEngine.VarEnd` (857 B of it is zeroed by `Init`, `VarStart` `$22CE`) |
| both, today | **7,621 of 7,680** | | 59 B for the stack: does not fit |
| stack headroom today | **1,122** | `$3B9E-$4000` | `0x4000 - __heap_start` |

**Proposed partition (projection, not yet built):**

| change | BaseRAM | zero page | note |
|---|---|---|---|
| move the palette arrays to `.bss` | +128 | −128 | needed for the page |
| `MAX_CLOS` 32 → 8 (`clos` 800 → 200 B) | −600 | | the encoder gains a closure-count refusal (#172's pool precedent) |
| `TABLE_POOL_CELLS` 256 → 192 (`cells` 1,024 → 768 B) | −256 | | `ilbc-table-ram`'s documented limit moves with it |
| HuTrack `.bss` | +1,063 | | at `__bss_end` |
| HuTrack `.zp` | | +93 | at `$2080` |
| **total** | **6,893** | **189** | **stack headroom 787 B** (70 % of today's) |

The engine's `.bss` is placed at the llvm image's `__bss_end` (generated
into the staging assembly, so no custom linker script is needed); the build
asserts the last engine byte is below `$4000`. The measured stack use is
493 B, so 787 B is 1.6× the high-water mark of three toys. If #198's canary
says it is not enough, two more savings are available and named here rather
than discovered later: a generated engine vars file with 8 song slots
(`song_bank`/`song_ptr` 192 → 24 B) and 16-byte name fields (96 → 32 B),
saving 232 B, which raises the headroom to **1,019 B**; and the 14 raster
line tables are 256-byte-aligned (3,584 B) for 224 lines, so 32-byte
alignment would save 448 B at a small indexed-access cost. Neither is in
the recommendation yet.

**The stack is the risk, and it is measured.** A scratch build of the
interpreter wrote the lowest `exec()` frame address to RAM cells
(`&r[0]`, the 128-byte register array), and three exported toys ran in
Mednafen, each in a quiet window with no other emulator running:

| toy | updates in the run | lowest `exec()` frame | stack used |
|---|---|---|---|
| `tools/toys/palette.lua` | 75 | `$3E15` | **491 B** |
| `toys/platformer` | 306 | `$3E13` | **493 B** |
| `toys/parallax.lua` | 12 | `$3E15` | **491 B** |

The probe's own witness that it is reading a growing stack and not one
fixed address: in the PLATFORMER run the **first** `exec()` (the chunk call)
sat at `$3F7B`, 133 B below `$4000`, and 1,963 `exec()` calls reached
`$3E13` — three nested frames of the 128-byte register file plus locals.
That is a measured high-water mark for these toys, not a bound for the
games that do not export yet; #198 re-runs it on the final image and on
every game that starts exporting, and the budget is accepted only if the
mark stays above the engine block.

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
- **noise drums**: `compile()` writes no effect `0F`; HuTrack's noise is
  effect `0F` on channels 5–6. Without it a drum plays only its volume
  envelope on a silent wave channel. `docs/SEQ.md`'s part 3 (#96) names the
  same missing state change; #199 adds it or the converter refuses a noise
  instrument by code.

**Measured song sizes.** With those two adapter fields in place, the JS
assembler produced:

| data | includes | assembled bank |
|---|---|---|
| `pce-seq.demoSong()` (6 instruments, 4 waveforms, one 16×16 pattern) | 13,449 B of text | **491 B** |
| the 15 built-ins (`pce-assets.js`: 8 wave + 7 noise) + 8 waveforms + one empty 16-row pattern | 23,416 B of text | **935 B** |

Both fit the 8 KiB data bank beside a typical bytecode (PLATFORMER's is
2,410 B). The 15 built-ins are the studio's palette (#99/#140), not a
second instrument set: each is a 32-step wave plus a driver volume envelope
(the drums also carry `nf` for the `0F` effect).

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
  slot; `music` again restarts. **Stop has no IL form today** (the IL's
  three sound instructions are `music`, `sfx`, `release`); #197 decides
  between a sentinel index and a new instruction, with the engine's
  `HuTrackEngine.stop` as the console action.

The engine's code is called by fixed address, never through a C prototype:
the pceas `.sym` file gives `HuTrackTick`, `HuTrackEngine.Init`,
`QueueSong`, `playSong`, `stop`, `setChanForSFX` and `chanReleaseSFX`, and
the build generates a small header with those constants for `ilvm.c`. All
of them are assembly calls; the C compiler never assumes a calling
convention across the boundary.

## 8. The trace test (#200)

The project's proven instrument for "what did the console actually do" is
the autosaved BaseRAM of a Mednafen run (`tools/mcs-extract.py --ram`;
#169). The test builds a **trace-enabled interpreter** — a compile-time
flag, like `TOY_RASTER_BUILD`, never the shipped image — that appends every
PSG write to a reserved BaseRAM log as `(frame delta, reg, value)`. A toy
with `note()` and an `sfx()` and no music (so the engine's per-frame tick
is not in the trace) is exported, run in Mednafen, and the log is compared
with `renderer/pce-toyhost.js`'s recorded events for the same frames: same
order, same registers, same values. The log lives only in the test build,
so it does not enter the RAM budget above. The same run's audio can be
captured (`tools/capture-psg.sh`'s route) as the ear's second opinion.

A toy with music is a stronger test but a different one: it exposes the
tick's caller, which is why the tick is designed to match the host model
first (§4).

## 9. Reproducing the measurements

```sh
# interpreter image and its section/symbol sizes
LLVM_MOS=/Volumes/External/pce-tools/llvm-mos tools/ilvm/build.sh
"$LLVM_MOS/bin/llvm-nm" -S tools/gen/ilvm.pce.elf   # .zp.bss 216, .bss to __heap_start

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
# pce-hutrack.convert() (adding fxSlots to every row and legacyArpSpeed:1 to
# the header — the adapter #199 lands), then pce-hutrack.assemble():
#   491 B for the demo song, 935 B for the 15 built-ins + 8 waves.
```

The exact numbers in this page are from those commands on 2026-11-01; a
toolchain change that moves them is a change to this page.

## What is not proven

- **No llvm-mos + pceas image has been built or run yet.** The 32 KiB
  layout, the narrowed window, the boot mappings and the tick are a
  measured *plan* (#198 builds them). The spike proved only that pceas
  assembles the engine at pages 5/4 and in physical banks 2/3.
- **The zero-page/RAM partition is arithmetic.** The 96/93-byte split and
  the 787-byte stack headroom (1,019 with the optional engine-vars trim) are
  projections from measured sizes; #198 builds them with assertions, and the
  stack canary is measured on the final image. The 491–493 B high-water mark
  is three toys, none of them a game that does not export yet.
- **The tick's placement is a design decision.** It matches the browser's
  toy-frame model and therefore the trace; it slows music in a toy slower
  than 60 Hz. Wall-clock tempo is not attempted.
- **The timer interaction is a claim, not a measurement.** `DDA.reSync`
  restarts TMA every tick; #198 re-runs `tools/measure-rom.js` on a sound
  toy and compares the verdicts with the same toy's image without music.
- **The engine's per-frame cost is unmeasured.** It runs outside #169's
  bracket by design; the frame-rate effect on a 30 Hz toy (TOWER, DUSK RUN)
  is measured in #198/#200.
- **The SEQUENCER adapter and noise `0F`** are #199; this page measured the
  two shape gaps and the sizes, not a playing drum.
- **Rule 2 is owed** for any check #198–#200 write: the author is not the
  seat that can prove it.

## The slices

| card | what | closes on |
|---|---|---|
| **#196** (this page) | the measured link design and budgets | the numbers reproduce; no suite red |
| **#197** | the encoder and the C emitter carry `note`, `sfx`, `release`, `music` | `check-ilvm`, `check-romcheck`, `check-agent-core` green; a note/sfx toy encodes and the host harness runs it |
| **#198** | the engine linked: two banks, 32 KiB image, data bank 4, wrappers, tick, zp/RAM partition and assertions | a note toy and an sfx toy play in Mednafen; `check-ilvm`, `check-export-games` green |
| **#199** | the SEQUENCER song and the 15 built-ins as HuTrack data; the noise `0F` | a numeric comparison with the studio's writes; a song plays in Mednafen |
| **#200** | `tests/check-rom-sound.js`, the trace build, the docs | the Mednafen trace equals the studio's for note and sfx; the suites green; a cold break by another seat |

The umbrella (#194) closes when #196–#200 are done. TOWER, DUSK RUN and
NOVA TIDE stay blocked until #198–#200: `docs/ROM_SPEED.md` has their
refusal lines.
