# Assembly next to a Lua toy (#225)

**Status: design note. No code.** This is card 2 of the assembly chain
(`#224` PCEAS in the browser, `#230` assembly projects, `#231` the HuCard
builder, `#232`–`#235` the HuC6280 core, `#236` CALLASM, `#237` docs). It
answers what `#236` has to build and what it costs, with the numbers this
machine produces today.

The maintainer's decision on the card is followed here: this note **chooses**
one calling convention and one ROM layout. Open questions are only the ones
that cannot be measured (section 9).

The HuCC practice the card asks us to match (`REFERENCES.md` §7) is our
starting point, and the convention below states the same three things in our
own terms: **call by name**, **a routine is a normal procedure that returns
with `rts` and never jumps out of itself**, and **a stated zero-page budget**.

---

## 1. What this note decides

| decision | choice |
|---|---|
| where a toy's assembly routines live | physical **bank 5**, mapped at **MPR3 ($6000–$7FFF)** only during a call. One 8 KiB bank per toy. |
| how Lua calls one | `asm("name", a, b, c, d)` in the source; the **build** resolves `name` to a bank/address from the assembler's `.sym`; the bytecode carries the address, never the name. |
| the bytecode op | a new **CALLASM op `0x23`**, container **version 4**, operands `dst, n, bank, addrLo, addrHi, args[n]` (`n` ≤ 4). |
| where the op's body runs | a small shim in **bank 3's measured 3,580 B of free space** (the `SndGlue` pattern, #220), called by fixed address. The fixed 16 KiB image pays only the switch case and a `jsr`. |
| arguments and return | four int32 arguments at **`$20E0–$20EF`**; an int32 return at **`$20F0–$20F3`**; a 4-byte RAM trampoline the shim writes at **`$20F4–$20F7`**. |
| what a routine may call | the hardware ports directly (VDC, VCE, PSG, timer, pad). The HuTrack entry points are measured and listed, but **v1 does not call the sound engine**. |
| a Lua-only toy | **nothing changes**: no bank 5, no version 4, byte-identical ROM. |
| the studio preview | it has **no CPU model**; options in section 7, and the chosen interim behaviour. |

---

## 2. The measured ground (2026-11-02, this machine)

### 2.1 ROM banks

`LLVM_MOS=/Volumes/External/pce-tools/llvm-mos PCEAS4=pceas4
tools/ilvm/build.sh` was run in this worktree on 2026-11-02. It printed:

```
built renderer/ilvm.bin: 32768 bytes, sha256 46ccefb656d18ca9
zero page   interpreter $2020-$2080 (96 B) | engine $2080-$20DE (94 B) | 34 B free
BaseRAM     interpreter heap starts $373E | engine $373E-$3B95 (1111 B) | stack headroom 1131 B (margin 787)
```

The sha matches the committed `renderer/ilvm.bin` and `tools/gen/ilvm.json`
(`46ccefb656d18ca9…`), so the table is the shipped image, not a rebuild
variant.

| physical bank | CPU window | content | used | free | where the number comes from |
|---|---|---|---|---|---|
| 0–1 | `$C000–$FFFF` | crt0, vectors, runtime, interpreter | **16,384 B** | see below | `tools/ilvm/build.sh:131` asserts the image is exactly 16,384 B; `tools/gen/ilvm.json` `section_sizes`: `.text` 16,208 + `.rodata` 96 + `.early_start` 70 + `.vector` 10 = 16,384 |
| 2 | `$A000–$BFFF` (MPR5) | HuTrack engine code | **7,876 B** (`$A000–$BEC4`) | **316 B** | `tools/ilvm/build-engine.sh:500` print (this run) |
| 3 | `$8000–$9FFF` (MPR4) | 2,868 B pitch tables + 1,024 B note table + 516 B sound glue | **4,612 B** (`$8000–$9204`) | **3,580 B** | `tools/ilvm/build-engine.sh:503–508` print (this run) |
| 4 | `$4000–$5FFF` (MPR2) | the toy's ILBC container, then assets; **last 32 B = the song trailer** | toy-specific | **8,160 − data** (see 2.2) | `renderer/pce-rom.js:149–154, 610–648`; `tools/ilvm/ilvm.c:56` |
| **5 (this note)** | **`$6000–$7FFF` (MPR3)** | **the toy's assembly routines** | routine bytes | **8,192 − routine bytes** | new in this note; MPR3 is untouched by the interpreter (`tools/ilvm/ilvm.c:187` maps only MPR2; `:199–200` map MPR4/5) |

The fixed 16 KiB image is full in the sense that matters to a new opcode.
`build.sh:116` says the fixed bank **holds 16,339 B before `.early_start`**
(link.ld pins that section at `$FFD3`), and `tools/gen/ilvm.json` says the
code and read-only data are 16,208 + 96 = **16,304 B**. So there are **35 B**
of slack, not zero — and section 6 shows what an opcode costs against it.

A toy without assembly keeps the current five-bank ROM: **40,960 B**
(`renderer/pce-rom.js:149` `ILVM_BYTES = 4 * BANK`, `:637` adds one data
bank). A toy with assembly is six banks: **49,152 B**. The card's HuCard
limit is 128 banks = 1 MB (`renderer/pce-rom.js:138`), so the extra bank is
not a size concern.

### 2.2 The data bank, measured per toy

`renderer/pce-rom.js:154` puts the song trailer at `$1FE0` of the data bank
(`buildToyRom` writes it at `:647`), so the honest usable size is
**8,160 B**, not 8,192. (The size check at `:630–636` compares against 8,192
and does not reserve the trailer — see section 9, finding F1.)

Container sizes were measured with the repo's own tool,
`node tools/ilvm/emit.js TOY.lua $TMPDIR/out.pce`, whose report carries
`bytecode.bytes`; the ROM it prints is 40,960 B for every one of these.

| toy | container B | free of the usable 8,160 B |
|---|---:|---:|
| `tools/toys/note.lua` | 261 | 7,899 |
| `tools/toys/sfx.lua` | 220 | 7,940 |
| `tools/toys/sprite.lua` | 430 | 7,730 |
| `tools/toys/palette.lua` | 578 | 7,582 |
| `tools/toys/tables.lua` | 594 | 7,566 |
| `tools/toys/not.lua` | 718 | 7,442 |
| `tools/toys/arity.lua` | 1,013 | 7,147 |
| `toys/parallax.lua` | 1,115 | 7,045 |
| `toys/status-bar.lua` | 1,369 | 6,791 |
| `toys/platformer/main.lua` | 2,410 | 5,750 |
| `toys/dusk-run/main.lua` | 7,470 | 690 |
| `toys/tower/main.lua` | 8,524 | refused (`toy-data-bank-full`) |

The spread is the reason assembly does **not** share bank 4: a routine
placed after the bytecode would work for `note.lua` and fail for DUSK RUN,
and TOWER does not fit its own bytecode today. A separate bank makes the
routine's capacity independent of the toy.

### 2.3 Zero page (`$2000–$20FF`)

| owner | bytes | addresses | source |
|---|---:|---|---|
| llvm-mos imaginary registers `__rc0–31` | 32 | `$2000–$201F` | `docs/ROM-SOUND.md:248`; `$2000/$2001` is the soft-stack pointer (`tools/ilvm/ilvm.c:222–225`) |
| the interpreter (`-mlto-zp=96`) | 96 | `$2020–$207F` | `build.sh` output above; `docs/ROM-SOUND.md:249`; `tools/gen/ilvm.json:31–38` |
| HuTrack engine state (`_hk`) | 94 | `$2080–$20DD` | `docs/ROM-SOUND.md:250`; `build-engine.sh` print |
| **free** | **34** | **`$20DE–$20FF`** | `build.sh` output "34 B free"; `tools/gen/ilvm.json:35` |

### 2.4 BaseRAM (`$2200–$3FFF`, 7,680 B) and the two stacks

| region | bytes | addresses | source |
|---|---:|---|---|
| interpreter `.bss` | 5,438 | `$2200–$373D`, heap starts `$373E` | `docs/ROM-SOUND.md:278`; `tools/gen/ilvm.json` `interpreter_heap_start` 14142 = `$373E` |
| HuTrack `.bss` | 1,111 | `$373E–$3B94` (end exclusive `$3B95`) | `docs/ROM-SOUND.md:279`; `build-engine.sh` print |
| **both** | **6,549 of 7,680** | | `docs/ROM-SOUND.md:280` |
| **soft-stack headroom** | **1,131** | `$3B95–$3FFF` | `docs/ROM-SOUND.md:281`; `build.sh` print |
| soft stack actually used (canary) | **1,083** | low-water `$3BC5` | `docs/ROM-SOUND.md:329–335` (`tools/toys/loud.lua` and DUSK RUN, five `exec()` frames, five frames deep) |
| **soft stack left** | **48** | | 1,131 − 1,083 |

The hardware stack is a different thing: it is always page `$2100–$21FF`
(256 B; `docs/MANUALS.md:214,320`), and the interpreter's own measurement
cells occupy `$2100–$2127` (`docs/ROM_LAYOUT.md:474–487`). A `jsr`, `pha` or
interrupt pushes there; the stack pointer starts at the top (`$21FF`) and
must not descend into `$2100–$2127`. The high-water mark of the hardware
stack under a CALLASM has **not** been measured (section 9, Q7).

**The card's numbers are pre-#222.** `#225`'s text says "BaseRAM partition
977 B, stack headroom 65 B". Those are the `#220` build's figures
(`docs/PLAN.md:433`: 977 B headroom, canary 912 B used, 65 B left). `#222`
raised the interpreter's capacities and the current image measures 1,131 B
of headroom with 1,083 B used (`docs/PLAN.md:351–355`). This note uses
**1,131 / 48**, the measured committed image. There is no separate "BaseRAM
partition" to hand to assembly: BaseRAM is fully spoken for except for the
48 B the soft stack has not yet reached, and that gap is not safe to use.

---

## 3. Where the routines live: bank 5, MPR3

**Decision: one physical bank 5 per toy, assembled at `$6000–$7FFF`,
mapped into MPR3 only for the duration of a call.**

Why this and not the alternatives:

- **Bank 4 (the data bank)** is the toy's bytecode and assets. It has
  7,899 B free for `note.lua` and 690 B for DUSK RUN (2.2); routines there
  would compete with the toy's own code and fail unpredictably. It is also
  the bank the interpreter reads its operands from, so mapping a routine
  over it would break the running bytecode.
- **Banks 2–3** belong to the committed 32 KiB interpreter image that every
  toy embeds. User code there would require a per-toy image and would change
  every ROM's sha. Their free bytes (316 B and 3,580 B) belong to the
  interpreter's own glue — the CALLASM shim goes in bank 3, but user
  routines do not.
- **MPR3 is unused.** The interpreter maps MPR2 (data), MPR4 (engine tables)
  and MPR5 (engine code) (`tools/ilvm/ilvm.c:187,199–200`); nothing else
  touches MPR3. The glue still saves and restores it with `tma #$08` /
  `tam #$08` rather than assuming its boot value.

The routine bank is assembled by `renderer/pce-asm.js` (PCEAS 3.23 in
WebAssembly, #224). The source declares its own window:

```
	.bank 5
	.org $6000
my_routine:
	...
	rts
```

Measured with the shipped assembler on 2026-11-02: a bank-5 fragment of 11 B
assembled to a 49,152 B raw image (six banks), and its `.sym` carried
`05 6000 asm_hello` and `05 600b asm_hello_end`. The builder extracts
physical bank 5 and refuses a symbol outside `bank 5, $6000–$7FFF`
(`asm-address`) or a name the `.sym` does not carry (`asm-undefined`). This
is the whole name→address mechanism: PCEAS already emits the bank and the
address, and `#224`'s wrapper already returns the `.sym` text unchanged
(`tests/check-asm.js` compares it byte-for-byte with the native assembler's).

---

## 4. How the bytecode calls one

### 4.1 Source

```
local word = asm("set_palette", 1, 0x1FF)
```

- The name is a **compile-time string**, not a Lua value. The IL has no
  string values (`renderer/pce-il.js:1–30`, `docs/IL.md` §14), so the Lua
  front end lowers this call form specially: it records the name and emits
  an `asm` instruction whose arguments are ordinary operand bytes.
- Up to **four int32 arguments** in v1 (the same limit the interpreter's
  `CALL_ARGS` already uses for builtins, `tools/ilvm/ilvm.c:111–112`). More
  than four is `asm-arity` at encode time.
- The encoder **materialises every argument into a register** before the
  CALLASM instruction (a `move` for a literal), so the CALLASM operands are
  always registers or `0xFF`. That is what lets the shim read arguments
  without the container's constant table or the interpreter's `koff`
  array — see 4.3.

### 4.2 Bytecode

Container **version 4** when the program has an `asm` instruction (the
version byte at offset 4; `docs/IL.md` §14.1 lists 1–3 today). The new
opcode sits in the unused `0x23` slot (the ops table in
`renderer/pce-ilbc.js:205–213` ends at `0x22`; `0x17` stays reserved for
`vget`, `docs/IL.md:1200`).

| op | instruction | bytes after the opcode |
|---|---|---|
| `23` | `callasm` | `dst:r n:u8 bank:u8 addrLo:u8 addrHi:u8 args[n]:op` |

`bank` is 5 in v1 (the byte is carried so a later version can name more
than one routine bank without changing the shape). `addr` is the label's
address in `$6000–$7FFF`. `n ≤ 4`. The address is resolved at build time,
so the console never compares a name and a container costs 5 + `n` bytes at
the call site: **by name in the source, by address in the bytecode.**

`renderer/pce-rom.js:buildToyRom` gains one optional input, the 8,192 B
physical bank 5, and accepts container version 4:

```
buildToyRom({ bank0, bytecode, asm, assets })
```

No `asm` → the same five-bank ROM, byte for byte (section 7.1).

### 4.3 The console path

The fixed bank has ~35 B of slack (§2.1), and the probes in §6 show that
operand decoding inside `exec()` does not fit. So the CALLASM case is kept
as small as a call, and the body lives in bank 3's measured 3,580 B free
space, reached by a fixed address exactly like the sound glue
(`tools/ilvm/ilvm_sound.c:200–213`; `SndGlue` is 516 B in bank 3 per
`build-engine.sh:508`). Its fixed address comes from the bank-3 staging
assembly's `.sym` into the generated header, resolved by the same two-pass
build #215 already uses for the engine's RAM base (`tools/ilvm/build.sh:55–90`).

**Fixed bank (`tools/ilvm/ilvm.c`, new case before the default at line 716).**
CALLASM sets two fixed cells and `jsr`s the shim: the container `pc` and a
pointer to the register array `r`. It then reloads `pc`. It does not decode
`dst`, `n`, the bank or the address.

| fixed zero-page cell | use |
|---|---|
| `$20DE–$20DF` | container `pc` in/out for the shim |
| `$20E0–$20EF` | the four int32 arguments (the shim fills them) |
| `$20F0–$20F3` | the int32 return (the shim zeroes it, the routine writes it) |
| `$20F4–$20F7` | the RAM trampoline, `jsr addr` + `rts`, written per call |
| `$20F8–$20F9` | pointer to `exec()`'s `r[]` (soft stack) — the glue's |
| `$20FA–$20FF` | 6 B left over, private to the routine |

**Bank-3 shim (`AsmGlue`, .inc in the bank-3 staging assembly).** It:

1. maps MPR2 = 4 (the data bank) — the sound engine may have borrowed MPR2
   for a song bank — then reads `pc`, the register pointer and the five
   operand bytes;
2. copies argument operands from `r[o]` into `$20E0+4i` (registers only,
   per 4.1);
3. zeroes `$20F0–$20F3`;
4. saves MPR3 with `tma #$08` / `pha`, maps the bytecode's bank with
   `lda bank; tam #$08`;
5. writes `$20F4 = $20, $20F5 = lo, $20F6 = hi, $20F7 = $60` and
   `jsr $20F4`;
6. restores MPR3 with `pla; tam #$08`;
7. copies `$20F0–$20F3` into `r[dst]`, stores the advanced `pc`, and `rts`.

The trampoline is why the routine is a **normal procedure ending in `rts`**:
`jsr $20F4` pushes the shim's return; the trampoline's `jsr routine` pushes
its own; the routine's `rts` returns to the trampoline's `rts`, which returns
to the shim, which restores the bank. Nothing is imposed on the routine's
own use of `jsr`/`rts` inside bank 5.

The shim is hand-written assembly in the bank-3 staging source because the
interpreter's C image is exactly 16 KiB and has no second link (the same
reason the sound glue is PCEAS assembly, `docs/ROM-SOUND.md` §7). Its size
is not yet measured; bank 3 has 3,580 B free and the glue precedent is
516 B.

---

## 5. The calling convention (decided)

### 5.1 Memory a routine may touch

| region | may a routine use it? |
|---|---|
| `$2000–$201F` imaginary registers, incl. `$2000/$2001` soft-stack pointer | **No.** ABI-owned; touching `$2000/$2001` breaks every C call after it. |
| `$2020–$207F` interpreter variables | **No.** 96 B of LTO-placed globals. |
| `$2080–$20DD` HuTrack engine state | **No** (see 5.4; engine calls are out in v1). |
| `$20DE–$20DF` pc cell, `$20F4–$20F7` trampoline, `$20F8–$20F9` register pointer | **No.** The glue owns them. |
| `$20F0–$20F3` return | **Write only.** Zeroed before the call; store the routine's int32 result here. |
| `$20E0–$20EF` arguments | **Read.** After reading, the four words are free scratch. |
| `$20FA–$20FF` | **Yes.** 6 B of private scratch. (`$20F8–$20F9` is the glue's register pointer.) |
| BaseRAM `$2200–$3FFF` (soft stack) | **No.** Do not touch the soft stack; the measured free margin is 48 B and it belongs to the interpreter's next frame. |
| hardware stack `$2100–$21FF` | **Yes**, for `jsr`/`pha`, but keep the stack pointer above `$2128`: `$2100–$2127` are the runtime's measurement cells. No recursion. |

So a routine's private RAM is **6 B of zero page plus the 16 B argument
block once read**, plus A/X/Y/P and the hardware stack. This is deliberately
small and stated; it is the "zero-page budget" HuCC users are warned about.

### 5.2 Entry, arguments, return

- **Entry:** `A`, `X`, `Y`, `P` are free; the routine is entered with `jsr`
  from bank 5 and must return with `rts`.
- **Arguments:** `asm("name", a, b, c, d)` → little-endian int32 words at
  `$20E0`, `$20E4`, `$20E8`, `$20EC`. Missing arguments are 0. Read them
  with absolute addressing (`lda $20E0` …).
- **Return:** store an int32 at `$20F0` (little-endian). The glue zeroes it
  before the call, so a routine with no return makes `asm(...)` return 0.
- **Clobbers:** A/X/Y/P and the scratch cells above. Nothing else survives
  as a promise; the interpreter keeps its state in its own frame.

### 5.3 Rules

1. **A normal procedure.** End with `rts`. Do not `jmp` out of the routine,
   into another bank, or into another routine's middle — HuCC's rule, and
   here it also means the glue's bank restore runs.
2. **No re-entry.** A routine must not call the CALLASM mechanism again
   (nested asm → asm). Internal `jsr`s inside bank 5 are fine.
3. **No callbacks into Lua.** The call is one-way; a routine returns a
   number, nothing else.
4. **No C runtime helpers.** `toy_*`, `ilvm_*` and the interpreter's
   functions are not an ABI; call the ports instead.
5. **Do not touch the MPRs.** No `tam`/`tma`: the glue owns MPR2 (data),
   MPR3 (your bank) and the engine's MPR4/5. A routine that remaps them
   breaks the interpreter after it returns.
6. **No engine calls in v1** (5.4). Direct PSG writes are allowed.
7. **No asm in `raster()` in v1.** It runs inside the RCR handler on a
   line budget; a frame-time call is the supported use. (Open question Q6.)

### 5.4 What it may call

**Hardware ports — allowed.** Addresses from `docs/MANUALS.md` §H8-24
(`:216`) and the runtime's own constants (`tools/toyc/huc_runtime.c:37–43`):

| device | ports | use |
|---|---|---|
| VDC | `$0000` register select; `$0002/$0003` data low/high | MAWR/MARR/VWR writes as `vdc_write` does (`tools/ilvm/ilvm_runtime.c:204–208`) |
| VCE | `$0400–$0407`; `$0400` control, `$0402/$0403` colour address, `$0404/$0405` colour data | palette writes |
| PSG | `$0800–$0809`: R0 `$0800` … R9 `$0809` | sound (see the caveat below) |
| timer | `$0C00` counter, `$0C01` reload | timing; `docs/MANUALS.md:216` (the `$1C00` in one quoted source is the bug #169 fixed) |
| joypad | `$1000` | pad reads |
| IRQ control | `$1402/$1403` | interrupt enable/acknowledge |

**The runtime's writes are deferred.** `pal()`, `reg()` and `vram[]` from Lua
are queued by `toy_pal`/`toy_reg`/`toy_vram_set` and applied in the VBlank
by `apply_base` (`tools/ilvm/ilvm_runtime.c:216–250, 264–294, 693–724,`
called at `:844,:924`). A routine's direct write happens immediately, so a
Lua write queued in the same frame to the same address is applied **after**
it and wins. The rule for v1: write a colour/VRAM word the Lua side does
not also write that frame. (PSG writes are not deferred; see below.)

**The sound engine — measured, but not callable in v1.** The shipped image's
entry points (generated by `build-engine.sh` on this run):

| routine | address | bank |
|---|---|---|
| `HuTrackTick` | `$BEB6` | 2 |
| `HuTrackEngine.EngineCall` | `$BE49` | 2 |
| `HuTrackEngine.Init` | `$A006` | 2 |
| `HuTrackEngine.QueueSong` | `$A103` | 2 |
| `HuTrackEngine.playSong` | `$A32E` | 2 |
| `HuTrackEngine.stop` | `$A179` | 2 |
| `HuTrackEngine.setChanForSFX` | `$A26D` | 2 |
| `HuTrackEngine.chanReleaseSFX` | `$A298` | 2 |
| `SndGlueReset / Map / Note / Sfx / Release / Music / Tick` | `$9046 / $9000 / $9067 / $9098 / $9130 / $914E / $91A6` | 3 |

They are reachable (the engine maps itself at MPR4/5, and MPR3 is free), but
the interpreter owns the engine's state and ticks it **once per toy frame,
before `frame()`** (`docs/ROM-SOUND.md` §4). A routine that calls `Tick` or
`EngineCall` advances the song a second time; one that writes PSG registers
directly can be overwritten by the next tick on a channel the song owns.
**Decision: v1 exposes the ports, not the engine.** A routine that wants a
sound effect calls the Lua `sfx()` around the asm call, or writes a PSG
channel the toy's music does not use, and says so on the toy.

---

## 6. What an opcode costs in the fixed bank (measured probes)

The fixed bank has **35 B** of slack (§2.1). Four scratch probes, each a
copy of `tools/ilvm/ilvm.c` in `$TMPDIR` compiled with the exact `build.sh`
flags (the repo was not changed), answer what CALLASM can afford:

| probe | result |
|---|---|
| baseline (unmodified copy) | 16,384 B; `.text` 16,208 + `.rodata` 96 = 16,304; 35 B slack |
| a bare distinct case `case 0x23: return 0;` | 16,384 B; `.text` 16,212 + `.rodata` 98 = 16,310; **29 B slack left** |
| `else if (aa == 2)` in the existing `builtin` case | **link fails**: `.early_start` cannot move back from `$FFE4` to `$FFD3`; the branch costs ≈ 52 B, about 17 B over the slack |
| a lean case that decodes operands and calls `operand()` in the fixed bank | **link fails**: `.text` overflowed by 40 B, `.rodata` by 138 B |
| a call-only case to a `noinline` stub (stands in for the bank-3 shim) | links at 16,384 B; the toolchain reshuffled ~600 B between `.text` and `.rodata`, so its section delta is not a usable cost — only the "call-only fits in this probe" fact is |

**What this decides:** the fixed bank can pay for a distinct opcode case and
a call to bank 3, and cannot pay for operand decoding or a `pargs` loop. The
CALLASM case must therefore pass `pc` and `r` and let the bank-3 shim do
everything else (4.3). The exact cost of the real case is still a `#236`
measurement; `build.sh:131` (the 16,384 B assert) is the gate, and if the
call-only probe's luck does not repeat, `#236` pays for it the way #220 did:
move a cold path to bank 3's 3,580 B.

Reproduce the baseline probe:

```sh
CC=/Volumes/External/pce-tools/llvm-mos/bin/mos-pce-clang
mkdir -p "$TMPDIR/asmprobe" && cp tools/ilvm/ilvm.c tools/ilvm/ilvm_sound.h "$TMPDIR/asmprobe/"
$CC -Os -Wl,--icf=all -mllvm -inline-threshold=50 -mlto-zp=96 \
    -Itools/toyc -Itools/gen \
    -Wl,--defsym,__rom_bank0=0xc000 -Wl,--defsym,__rom_bank0_size=0x4000 \
    -o "$TMPDIR/asmprobe/base.pce" tools/ilvm/ilvm_runtime.c \
    "$TMPDIR/asmprobe/ilvm.c" tools/ilvm/ilvm_sound.c
wc -c < "$TMPDIR/asmprobe/base.pce"        # 16384
```

---

## 7. What the studio does

### 7.1 A Lua-only toy: nothing changes

The studio's export is `PCEStudio.rom.buildToyRom({ bank0, bytecode })`
(`renderer/studio.html:4374`) over the ILBC container. A toy with no `asm`
call:

- has no CALLASM instruction, so the encoder emits no version 4 and the
  bytecode is byte-identical to today (`renderer/pce-ilbc.js:205–213` is
  untouched);
- passes no `asm` bank, so `buildToyRom` allocates exactly
  `ILVM_BYTES + BANK` = 40,960 B (`renderer/pce-rom.js:637`) and writes the
  same bytes;
- assembles nothing: `.s`/`.inc` files in the project are inert unless an
  `asm` call names a routine in them.

That is the design requirement, and it is checkable against the commitments
already in the tree: the ROM sha pins in `tests/check-export-games.js` and
`tests/check-ilvm.js` must stay unchanged for the existing toys. `#236` runs
those pins; this note changes no code.

### 7.2 A toy that calls assembly: no CPU model in the studio

The studio's preview is a **model of the chips, not a CPU**. `pce-il.js`
executes the IL over `renderer/pce-toyhost.js` (the file header names the two
front ends, `pce-toyhost.js:1–20`), and `pce-psg.js:17` says explicitly that
it "is an event-driven model, not a CPU emulator". There is no
`renderer/pce-cpu.js`; the HuC6280 core, bus and Run panel are cards
`#232`–`#235`, still open. So the preview cannot execute a routine today.

The options, named:

| option | what it does | cost / risk |
|---|---|---|
| **A. named refusal** | at the first CALLASM the IL host raises `asm-preview` naming the routine and line; the toy still exports and the panel shows the assembled size | cheap and honest; no false picture |
| **B. Lua twin** | the project carries a Lua implementation beside the assembly; preview runs the Lua, export runs the asm | fast to build; **two implementations can diverge silently**; needs a parity test that itself needs a CPU core |
| **C. the new CPU core (planned)** | `#232`–`#235` build `renderer/pce-cpu.js` + bus; preview runs the exported ROM and the chip panels read the real writes | the carded route; `#236`'s stated evidence ("preview equals Mednafen") requires it |
| **D. an emulator in WASM** | embed ares/Mednafen-class code for preview only | large download, GPL/porting questions, duplicates a core we are already carding |

**Decision:** C is where this goes; A is the interim so an assembly toy is
never silently wrong in preview. B is allowed only as an explicitly labelled
helper and never as the shipped semantics. `#236` should not claim
"preview equals Mednafen" until `#234`/`#235` land.

The host harness (`-DILVM_HOST`) has no CPU either: a container with CALLASM
must fault or be excluded from host-parity runs, and an assembly toy's
console evidence is a Mednafen capture (below), not `check-ilvm`'s browser
diff.

---

## 8. Recommendation and the smallest first build

**Recommendation.** Build exactly the convention in sections 3–5: bank 5 at
MPR3, CALLASM `0x23` in container version 4, name resolved at build time
from PCEAS's `.sym`, arguments at `$20E0–$20EF`, return at `$20F0–$20F3`,
a per-call RAM trampoline at `$20F4–$20F7`, the body in a bank-3 shim, and
normal `rts` routines that touch nothing outside the table in 5.1. It is
the smallest design that costs the fixed bank almost nothing, keeps the
name in the source where a developer can read it, and matches the HuCC
practice the maintainer's reference names.

**Smallest first build (for `#236`), in order:**

1. **Fit the op.** Add the call-only CALLASM case (no decoding), a stub
   bank-3 shim, and rebuild `renderer/ilvm.bin`. `tools/ilvm/build.sh` must
   exit 0 at exactly 16,384 B and keep the zero-page/BaseRAM/stack lines
   green. If it does not fit, stop and move a cold path to bank 3 before
   anything else is built.
2. **One routine, one toy.** `tools/toys/asm-palette.lua` +
   `tools/toys/asm-palette.s`: a routine that writes one VCE colour entry
   (the card's own example), called from `frame()`; the toy's Lua also sets
   that entry to a different colour in `init()` so the asm write is visibly
   the one on screen. The `.s` declares `.bank 5 / .org $6000`.
3. **Encode and export.** The Lua front end lowers `asm("name", ...)`, the
   encoder resolves the address and emits version 4, `buildToyRom` appends
   the bank. Export through the studio's own path (or `tools/ilvm/emit.js`
   for the console-only check).
4. **Prove it on the console.** Mednafen capture of the exported ROM equals
   a **stated expected picture** (the chosen colour on screen), not a
   browser frame — the browser has no model for it yet. `docs/ROM-SOUND.md`
   §9's capture route is the pattern.
5. **Prove the Lua-only path.** Re-run the existing ROM sha pins
   (`tests/check-ilvm.js`, `tests/check-export-games.js`): every Lua-only
   toy's ROM must be byte-identical, and `build.sh`'s budgets still pass.
6. **Preview** stays option A (`asm-preview`) until `#234`/`#235`; `#236`'s
   "preview equals Mednafen" moves to the CPU-core step if the core is not
   in the tree by then.

The evidence this note can already point at: the shipped image rebuilds to
`46ccefb6…` and prints the partition above; bank 5 assembles and its `.sym`
carries `05 6000 my_routine`; the data bank's free space per toy is the
table in 2.2; and the fixed bank's 35 B slack and the four opcode probes are
measured in §6.

---

## 9. Open questions for the maintainer

Only the ones this note cannot settle by measurement:

- **Q1. Preview before the core.** Is export-only with a named
  `asm-preview` refusal acceptable for the first CALLASM landing, or must
  `#236` wait for `#234`/`#235` and ship preview and console together? (The
  recommendation is export-only first.)
- **Q2. Arity.** Four int32 arguments for v1, or eight to match the Lua
  call limit (`docs/IL.md` §14, `MAX_ARGS` 8)? Four matches the existing
  builtin path and the zero-page block; eight needs a second block or a
  pointer.
- **Q3. Engine calls.** Keep v1 to the hardware ports (the recommendation),
  or allow routines to call the measured HuTrack entry points and define
  who owns the song state when they do?
- **Q4. Project shape.** One entry `.s` per toy (with `.include`s), or every
  `.s` file in a project assembled into the same bank-5 unit? This decides
  `#230`'s project model; the recommendation is one entry file, named
  `main.s` by convention.
- **Q5. One bank.** Is an 8 KiB limit per toy acceptable for v1? More than
  one routine bank needs either a second mapped bank or a bank-switch in the
  glue; the recommendation is one bank now, a named refusal on overflow.
- **Q6. Callbacks.** Is `asm` allowed in `raster(line)`, the console's
  line-budget callback? The recommendation is no for v1 (it runs inside the
  RCR handler), `frame()` and `init()` only.
- **Q7. Hardware-stack ceiling.** The soft-stack canary is measured; the
  hardware stack under a CALLASM is not. Should the convention's 128 B
  ceiling (keep SP above `$2128`) be enforced by a probe card, or left as a
  documented rule?

**Finding F1, from measuring (not this card's to fix):**
`renderer/pce-rom.js:630–636` refuses a data bank over 8,192 B, but
`buildToyRom` writes the song trailer at `$1FE0` (`:154,647`). A container
between 8,161 and 8,192 B would pass the check and have its last bytes
overwritten by the trailer. No shipped toy is that large (DUSK RUN, the
largest measured here, is 7,470 B; TOWER is refused at 8,524 B), so it is
latent. `#236` should either reserve the 32 B in the check or card it
separately.

---

## 10. Reproducing this note's numbers

```sh
# the interpreter image and the asserted partition (§2.1, §2.3, §2.4)
LLVM_MOS=/Volumes/External/pce-tools/llvm-mos PCEAS4=pceas4 tools/ilvm/build.sh
python3 -m json.tool tools/gen/ilvm.json | grep -A24 ram_budget
python3 -m json.tool tools/gen/ilvm.json | grep -A20 section_sizes

# the engine banks and their free space (§2.1)
LLVM_MOS=/Volumes/External/pce-tools/llvm-mos PCEAS4=pceas4 tools/ilvm/build-engine.sh

# a container's size in the data bank (§2.2)
node tools/ilvm/emit.js tools/toys/palette.lua "$TMPDIR/palette.pce"
python3 -m json.tool "$TMPDIR/palette.json" | grep -A4 bytecode

# a bank-5 routine and its symbol (§3) — a scratch source
printf '\t.bank 5\n\t.org $6000\nmy_routine:\n\trts\n' > "$TMPDIR/r.s"
node -e 'const a=require("./renderer/pce-asm.js");const r=a.assemble(require("fs").readFileSync(process.env.TMPDIR+"/r.s","utf8"),{filename:"r.s"});console.log(r.bytes.length);console.log(r.sym)'
# 49152 bytes, and the .sym line:  05 6000 my_routine

# the fixed-bank opcode probes (§6)
# see the four commands and their outputs described in the table; the
# baseline is the one printed there.
```
