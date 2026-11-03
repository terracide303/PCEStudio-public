# Banked toy data — a container bigger than one 8 KiB bank

**Design note for card #278. Nothing in this note is built.** The maintainer
decides the shape before any code is written.

Every number below is either **measured** on this tree (the command or the
file is named), a **projection** (arithmetic from measurements, labelled), or
**reasoning** from the 6502/NMOS cycle counts (labelled). The places where
this note qualifies the card's own wording are called out where they occur
(§2.1 on 384 KiB, §2.2 on where the size budget lives, §6 on which toys the
bank actually unlocks).

## The answer first

1. **ROM space is not the wall.** The exported toy ROM is 40,960 B = 5 of the
   128 banks a HuCard decodes (1 MB). A toy that needs two data banks costs
   8,192 B more; even eight banks is 98,304 B, a tenth of the card. The wall is
   the **interpreter's code space**: the fixed 16 KiB image has **35 B** of
   slack (`docs/ASM.md` §2.1), and a change that touches the opcode loop must
   fit there or move cold code to bank 3 (3,580 B free).

2. **The cheap shape is per-function code banks**, with the header, tables and
   constants in one bank permanently mapped at MPR3. The opcode loop and its
   byte reader are unchanged; the only new work is one bank compare per call.
   Measured workload: TOWER makes ~46 calls an update, DUSK RUN ~165 — a
   compare and (worst case) a `TAM` each, **under 1.5 %** of the published
   update cost. The alternative the card names first — one flat container
   whose bank is checked per read — costs **7–9 %** on TOWER and **67–84 %**
   on DUSK RUN at 8 cycles a byte, because a data-heavy game reads 4,280 and
   32,687 container bytes an update (§3.1).

3. **Banking alone does not export TOWER.** TOWER is over **four** budget rows,
   not one: data bank 8,524/8,160 B, functions 44/41, registers 43/41, boot
   upvalue cells 90/72 (`docs/MCP.md` budget, re-measured for #261). Banking
   clears the first row only; a banked TOWER would build and then stop at the
   interpreter's load-time capacity — a black screen, the way DUSK RUN did
   before #222 — not a refusal. The RAM rows need #272's trim or a re-partition
   of BaseRAM, which has 48 B of soft-stack margin (`docs/ASM.md` §2.4).

4. **Of the three gallery toys the card names, none is unlocked by a bigger
   bank** (§6): CAVE already fits one bank (1,977 B) and exports today; CITY
   and OAK WOODS stop earlier, at encoder refusals (`ilbc-op`,
   `ilbc-table-escape`), with containers projected at ~2.2 and ~2.6 KB.

5. **Recommendation:** build it in four cards (§5.4): container v4 + builder;
   the interpreter's one map per call; COPYV asset banks (which is #217,
   restated with a bank byte); then re-pin every ROM after a Mednafen old/new
   diff. Old containers (versions 1–3) read unchanged; every exported ROM's
   sha still moves, because every ROM embeds `renderer/ilvm.bin`.

---

## 1. What the interpreter does today

### 1.1 The ROM

`buildToyRom` (`renderer/pce-rom.js:610–649`) concatenates two things:

| bytes | physical banks | content | source |
|---|---|---|---|
| 32,768 | 0–3 | `renderer/ilvm.bin`: llvm-mos banks 0–1 (crt0, runtime, interpreter), HuTrack engine banks 2–3 | `pce-rom.js:149` `ILVM_BYTES = 4 * BANK` |
| 8,192 | 4 | the toy's ILBC container, then assets; **the last 32 B are the song trailer** | `pce-rom.js:150,154,637–648` |

So every exported toy is **40,960 B** (five 8 KiB banks), which is what
`tests/check-export-games.js` pins (`ROM_BYTES = 40960`).

### 1.2 One window, mapped once

At boot `ilvm.c` maps physical bank 4 into **MPR2**, the CPU's 8 KiB window at
`$4000–$5FFF` (`tools/ilvm/ilvm.c:56` `#define DATA_BANK 4`, `:67`
`#define PROG ((const uint8_t *)0x4000)`, `:186–189` `map_data_bank` writes
`TAM #$04`, `:742`). The mapping is never changed again: the comment at
`ilvm.c:148` says so ("The data bank is mapped for the whole run, and a read
from it costs what a RAM read costs").

Every byte of the container is read through three tiny noinline functions
(`ilvm.c:234–247`):

```c
static uint8_t  rb(uint16_t off)  { return PROG[off]; }
static uint16_t rw(uint16_t off)  { /* two rb() */ }
static int32_t  ri32(uint16_t off){ /* four rb() */ }
```

`exec()` (`ilvm.c:361–723`) is a C interpreter over that bank: it fetches the
opcode with `rb(pc++)`, the operands with `rb`/`operand`, and reads constants
through `konst()` (`:323–331`), which uses the offset table `koff[128]`
(`:150`, 256 B of RAM) and reads the value from the container **on every use**.
Upvalue descriptors are read from the container when a closure is created
(`:439–445`). Nothing is copied to RAM except the function table
(`fns[41]`, 9 B each), the constant *offsets*, the table-section shapes and the
globals.

The other windows: MPR4 = physical bank 3 (HuTrack pitch tables and the sound
glue) and MPR5 = physical bank 2 (engine code), mapped at boot
(`ilvm.c:198–201`). **MPR3 (`$6000–$7FFF`) is untouched by the interpreter**
and reserved for a toy's assembly routines (`docs/ASM.md` §3).

### 1.3 The container's addresses are 16-bit and absolute

`docs/IL.md` §14.1: the header is 28 bytes, and **every offset is a `u16`
byte offset from the start of the container** (version 1 is 24 bytes; v2 adds
the table section and the extra code bounds). A function entry is 10 bytes:

```
codeOff u16, codeEnd u16, upOff u16, nregs u8, nparams u8, nups u8, reserved u8
```

Jump targets (`jmp`, `br`, `fornext`) are absolute container offsets patched
after layout (`pce-ilbc.js:65`). The reserved byte at entry offset 9 is
written 0 and **read by nobody** (`ilvm.c:771–777` reads offsets 0–8 only) —
it is the one spare byte the format already has per function.

Because offsets are `u16`, the whole format is bounded at **65,536 B** even if
the card had room for more.

### 1.4 The limit and the refusal

`buildToyRom` refuses when bytecode + assets exceed `BANK`:

```
pce-rom: the bytecode (8524 B) and assets (0 B) need 8524 bytes; the
interpreter reads one 8 KiB data bank            (code point of pce-rom.js:632)
```

Two facts about that check:

- The honest usable size is **8,160 B**, not 8,192: the song trailer is
  written at `SONG_TABLE_OFF = 0x1FE0` (`pce-rom.js:154,647`). **The refusal at
  `pce-rom.js:630–636` compares against 8,192 and does not reserve the
  trailer** — a latent bug for containers of 8,161–8,192 B, recorded as
  finding F1 in `docs/ASM.md` §9. No committed toy is in that range (the
  largest that builds is DUSK RUN at 7,470 B), so no ROM is wrong today.
- Measured container sizes (`tools/ilvm/emit.js`; `docs/ASM.md` §2.2):
  note 261, sfx 220, sprite 430, palette 578, tables 594, not 718, arity 1,013,
  parallax 1,115, status-bar 1,369, **platformer 2,410**, **dusk-run 7,470**,
  **tower 8,524 (refused; 364 B over)**. This note adds CAVE 1,977 B
  (measured with the same tool on `demo-art/cave/main.lua`).

### 1.5 The one thing in this repo that already banks on demand

The viewer ROM does exactly the trick the card asks for, and it is proven:
`copy_words` (`tools/viewer.asm:501–556`) streams a picture's tile regions
through the same MPR2 window, checking `src+1 == $60` before every byte and
re-mapping to the next bank when the pointer crosses (`docs/ROM_LAYOUT.md`
§"Banks 4–127", `:365–366`). It is how the 88 KiB scene and the 108-bank
fixture build (`tests/check-viewer.js`, `tests/check-export.js`).

That loop is also the **cost anchor** for option A below: the boundary check
is `lda <src+1` / `cmp #$60` / `bne` = 3 + 2 + 3 = **8 cycles** on the fast
path, with a `tam` (~12 more) only at the crossing. A banked *streaming copy*
can afford that; an interpreter that pays it on every operand read cannot
afford it everywhere.

---

## 2. The free space, measured

### 2.1 ROM

| quantity | bytes | banks | source |
|---|---:|---:|---|
| the exported toy ROM today | 40,960 | 5 | `pce-rom.js:149,637` |
| a HuCard's decode (the card's ceiling) | 1,048,576 | 128 | `docs/ROM_LAYOUT.md` §"The size ceiling", card #57; `docs/MANUALS.md` §15.1 GAP 4 (sgxtech, pcetech, hes spec) |
| free in a toy ROM | **1,007,616** | **123** | arithmetic |
| "384 KiB" | 393,216 | 48 | **not a ceiling.** `renderer/pce-card.js`'s optional `pad384` fills an image to 393,216 B (`docs/ASM.md` §11.4: "The repo records no source for why that size is wanted"), and `pad384` is off by default |
| the SF2 mapper | ~2.5 MB | — | card #59, **backlog, not built** (banks `$40–$7F` switched by writes to `$1FF0–$1FF3`) |

So the card's "HuCards go to 384 KB and past with the SF2 mapper" understates
what the repo has already measured: 1 MB is the card's decode, proven and
cited, and even an eight-bank toy is 98,304 B. **ROM space cannot be the
reason this design is hard.**

### 2.2 Interpreter code and RAM (the real budget)

Measured on the committed `renderer/ilvm.bin` (sha `46ccefb6…`,
`docs/ASM.md` §2.1–2.4; the card points at `docs/ROM_SPEED.md`, which measures
*time* — the *space* budget lives in `docs/ASM.md` §2):

| region | capacity | used | free |
|---|---:|---:|---:|
| fixed 16 KiB image (banks 0–1), before `.early_start` | 16,339 | 16,304 (`.text` 16,208 + `.rodata` 96) | **35 B** |
| bank 2, HuTrack engine code | 8,192 | 7,876 | **316 B** |
| bank 3, pitch tables + sound glue | 8,192 | 4,612 | **3,580 B** |
| zero page `$2000–$20FF` | 256 | — | **34 B** (`$20DE–$20FF`) |
| BaseRAM soft-stack headroom | 1,131 | 1,083 (canary) | **48 B** |

Three consequences that shape every option:

- **The fixed image is the only place `exec()` can grow**, and it has 35 B.
  `docs/ASM.md` §6 probed the cost of new code there: a bare extra `case` cost
  6 B and fit; a branch of ~52 B failed the link by 17 B. A bank-mapping
  prologue is 20–60 B by the same measure — it may fit, it may not, and the
  first build card must **probe the link** before promising the shape.
- **Bank 3 is the escape hatch** and it is already the established one: boot
  maps it at MPR4 (`ilvm.c:198–201`) and its code is called by fixed address
  (the sound glue does exactly this — `tools/ilvm/ilvm_sound.h`'s header,
  `docs/ROM-SOUND.md` §5). A cold bank helper there costs 3,580 B of room and
  a per-call `jsr`, not hot-loop cycles.
- **BaseRAM cannot grow a byte per function.** 48 B of soft-stack margin is
  less than one byte × `MAX_FUNCS` (41). A design that stores a bank per
  function in RAM eats the margin and risks recursive games; §3.2 avoids it by
  reading the bank byte from the function table instead.

### 2.3 The workload the speed estimates are applied to

Counted by running the toy through `renderer/pce-il.js`'s own host with an
`onOp` counter (`il.runProgram`, the same hook `pce-validate.js:421` uses).
These are **measured on the IL host, not on the console**; they count
instructions and container bytes, which is what a bank check is paid on. An
"update" is `frame()` plus its raster collection, the definition
`docs/ROM_SPEED.md` uses.

| toy | IL ops / update | container bytes / update | calls / update |
|---|---:|---:|---:|
| TOWER | 1,088 | 4,280 | 46 |
| DUSK RUN | 7,773 | 32,687 | 165 |
| PLATFORMER | 110 | 433 | 1 |
| not.lua | 41 | 156 | — |

The published update costs these percentages are measured against:
TOWER **463,075 cycles** (the validator's static projection, 3.88 frames,
15.5 Hz — no ROM exists to measure), DUSK RUN **390,744 cycles** (18.3 Hz,
measured), PLATFORMER **311 lines ≈ 141,629 cycles** (30 Hz, measured)
(`docs/ROM_SPEED.md` §"The real games, measured").

---

## 3. The options

### 3.1 Several data banks the interpreter maps on demand (flat container)

**Shape.** The container stays one flat byte stream with the existing `u16`
offsets, now allowed to grow past 8 KiB. The bank is `off >> 13`; `rb()` maps
the bank containing the offset, then reads `PROG[off & 0x1FFF]`. This is the
viewer's `copy_words` rule applied to every read, and the encoder must forbid
an instruction straddling a bank boundary.

- **Capacity:** 8,160 B per bank. Bank 0 keeps the 32-byte trailer at
  `$1FE0`, and **every extra bank ends with the same strip** (so the sound
  glue's trailer read still works whichever bank is mapped — the same rule
  §3.2 uses). Two banks = 16,320 B; eight banks = 65,280 B; the format stops
  at eight because offsets are `u16` (§1.3). TOWER (8,524 B) needs two banks.
- **Interpreter size:** one compare/map in the shared noinline `rb`
  (`ilvm.c:234`) — every byte pays, but the code is written once. Estimated
  **25–40 B** of the fixed image plus **1 B** of zero page (`cur_bank`).
  **Reasoning**, from the viewer's 3-instruction check shape; the link probe
  decides.
- **Speed (the reason not to do this):** 8–10 cycles per byte, the viewer's
  check (`§1.5`), on every read:

  | toy | bytes/update | added cycles | against its published update |
  |---|---:|---:|---|
  | TOWER | 4,280 | 34k–43k | **+7.4–9.2 %** (of 463,075) |
  | DUSK RUN | 32,687 | 262k–327k | **+67–84 %** (of 390,744) |
  | PLATFORMER | 433 | 3.5k–4.3k | **+2.4–3.1 %** (of 141,629) |

  A cheaper variant moves the check to the **dispatch loop** (once per
  instruction, with the encoder forbidding a straddling instruction): 8–10
  cycles per op instead of per byte, i.e. TOWER +1.9–2.4 %, DUSK RUN
  +16–20 %, PLATFORMER +0.6–0.8 %. It still touches the hot loop and still
  needs the mask or bank-relative `pc` for the jump targets.
- **Risk:** the most invasive of the three to the hot path; every operand read
  changes semantics (the mask). Backward compatibility is achievable (all
  offsets in a v1–3 container are < 8,192, so bank 0 and the mask are
  no-ops), but the risk of a wrong read in a boundary case (an operand or a
  `u16` target crossing at exactly 8,192) is highest here. The format itself
  does not need a version bump for the *reading* rule, which means a bad build
  could silently misread instead of refusing.
- **Evidence it would need:** a toy whose container is 8,161–16,320 B builds
  and its Mednafen picture matches the browser; a container with an
  instruction at offset 8,191 is refused by the encoder; the old captures diff
  0.

### 3.2 Per-function banking (the recommended shape)

**Shape.** The data area becomes a **tables bank** plus **N code banks**:

- Bank 0 (physical 4): the header, function table, upvalue descriptors,
  constants, global names and table section — everything the current
  container holds before its first instruction. Same `u16` offsets, but
  **bank-relative** (all < 8,192). The song trailer stays at `$1FE0`.
- Banks 1..N (physical 5..): code only. A **function is packed wholly inside
  one bank**; `codeOff`/`codeEnd` and every jump target are offsets **within
  that bank**. The function entry's reserved byte (offset 9) is the code
  bank number. Every bank ends with the same 32-byte trailer strip, so the
  sound glue's existing read (`ilvm_sound.c:92–97` on the host; the
  assembly glue on the console) keeps working whichever bank is mapped.

**Why this is cheap.** `exec()` runs from the fixed 16 KiB image, not from
MPR2, so the interpreter can re-map MPR2 at any time. Per call it needs one
lookup:

```c
b = TABLES[(uint16_t)(fns[fid].upOff + 5)];   /* entry+9 == upOff+5 */
if (b != cur) { map_data_bank(code_base + b); cur = b; }
```

`upOff` is already in RAM (it is the function entry's field at +4), so
**entry+9 = upOff+5** — no new per-function array, no change to `fns[]`'s
9-byte layout. `TABLES` is `(const uint8_t *)0x6000`, MPR3 permanently mapped
to the tables bank at boot. `code_base` is 4 for a v1–3 container (the tables
and code share physical bank 4, as today) and 5 for v4. The opcode loop,
`rb`, the jump targets and the operand reads are **byte-for-byte unchanged**.

- **Capacity:** 8,160 B of tables in bank 0 (the measured tables are
  1,318 B for TOWER, 1,348 for DUSK RUN, 625 for CAVE — 6–13× headroom), plus
  8,160 B of code per code bank, up to physical bank 127. The remaining ~6.8 KB
  of the tables bank is not used for code in v4: keeping code out of it means
  a code bank is always a clean whole-bank map. TOWER needs one tables bank
  and one code bank: a 49,152 B ROM (six banks). The only practical limit is
  ROM, 123 banks. The largest single function measured is 1,339 B (DUSK RUN);
  TOWER's is 990, PLATFORMER's 488, CAVE's 607, and CITY's projected 1,003 —
  so the "a function must fit one bank" rule has 6–8× of headroom on every
  known game.
- **Interpreter size:** the prologue above plus the boot mapping of MPR3 and
  `code_base`/`cur` — estimated **25–40 B** of the fixed image and **2 B** of
  zero page/BSS. **Not stored per function**, so the 48 B soft-stack margin is
  untouched. If the probe shows it does not fit 35 B, the map/check moves to
  a bank-3 helper (~20 B of fixed-bank call + the helper in the 3,580 B),
  following the sound glue's existing pattern.
- **Speed:** one compare per call, and a `TAM` only when the bank actually
  changes. Worst case (every call crosses):

  | toy | calls/update | added cycles | against its published update |
  |---|---:|---:|---|
  | TOWER | 46 | 0.9k–1.4k | **+0.2–0.3 %** |
  | DUSK RUN | 165 | 3.3k–5.0k | **+0.8–1.3 %** |
  | PLATFORMER | 1 | ~30 | negligible |

  Constants become *cheaper or equal*: `konst()` reads `TABLES[koff[i]]`
  instead of `PROG[...]`, the same instruction shape at a fixed address, and
  no remap. `closure`'s upvalue-descriptor reads likewise move to `TABLES`.
- **Risk:** the encoder's layout work is the larger half (packing functions,
  bank-relative patching, the tables bank's `u16` limit). The interpreter's
  hot path is not touched, which is the whole point. The format changes, so
  it must bump to **container v4**; v1–3 are read exactly as today (bank byte
  0, `code_base` 4, all offsets < 8,192, the trailer where it already is).
  The sound glue is not changed if every bank keeps the trailer strip
  (§3.3's alternative — moving the trailer to the tables bank only — would
  change the assembly glue and re-open the sound proofs).
- **Interaction with the assembly-routine design (#225/#236):** MPR3 stops
  being the free window and becomes the tables window. `docs/ASM.md` §3 places
  user routines at physical bank 5; that moves above the data banks, and the
  builder's symbol check names the new bank. The CALLASM op already carries a
  bank byte (`docs/ASM.md` §4.2), so the bytecode shape survives; only the
  builder's constant changes. #236 is not built, so this is a coordination
  item, not a regression.
- **Evidence it would need:** TOWER (or a 2-bank fixture) builds at
  49,152 B, boots and draws in Mednafen with frames matching the browser; a
  function larger than a bank is refused by name; a jump/entry at a bank edge
  is refused by the encoder; every v1–3 container's host-harness result is
  byte-identical; `tools/gen/ilvm.json` records the fixed-bank delta.

### 3.3 Asset banks streamed to VRAM

**Shape.** Assets (a BAT, a tile set, a palette, sprite patterns) are static
blobs in their own banks, copied to VRAM by a new **COPYV** op — which is
exactly card **#217**. The op carries a VRAM address, a data offset and a word
count, maps the blob's bank into MPR2 once, and streams sequentially, re-mapping
only at each 8 KiB boundary, the shape `copy_words` already uses and proves
(`tools/viewer.asm:511–556`).

- **Capacity:** one or more banks after the code, ROM-bounded; a single
  screen's picture is bounded by 64 KiB of VRAM anyway. This is the option
  that makes the constant-pool cards useful (§3.4).
- **Interpreter size:** the op itself (a dispatch case + a copy loop), **not
  measured** — #217 is the card that sizes it. A projection from §2.2's probe
  pattern is **40–80 B**, almost certainly past the 35 B slack, so it lands
  with the bank-3 helper. That is the same helper §3.2 may need, so the two
  cards should share it.
- **Speed:** a streamed word costs a tight loop (two byte reads, two stores,
  pointer bumps — ~20 instructions a word) instead of an interpreted `vset`
  (one opcode, two operands, `konst`/`operand` decoding, and the runtime's
  `toy_vram_set` call). It is a **win**, not a cost; #217's evidence is where
  it is measured, and this note does not claim a number.
- **Risk:** low to existing toys — a new opcode no v1–3 container emits. The
  real work is in the encoder (#218): deciding which `vram[]` runs become
  blobs, and how a blob's bank is assigned. The data offset must be a
  **(bank, offset) pair** from the op's first day, or a flat `u16` if §3.1 is
  chosen; picking the shape now avoids a second op change when banking lands.
- **Evidence it would need:** #217's own card (a 300-word copy whose VRAM
  matches on the host), plus a Mednafen capture once #218 emits a blob.

### 3.4 Where the constant-pool cards (#217–#219) fit

The three cards are **one arc**, and banking is the capacity half of it:

- **#217** (constant pool 1/3) adds **COPYV**: copy a run of words from the
  toy data bank to VRAM. This is the asset-streaming primitive of §3.3.
- **#218** (2/3) makes the encoder turn a run of constant `vram[]` writes (a
  BAT, a tile set, a palette) into one data-bank blob plus one COPYV, so the
  **127-constant pool** (`pce-ilbc.js:195,461–462`, `MAX_CONST = 127`) stops
  being a picture limit. Today STARFALL refuses here first
  (`ilbc-range`: the 128th constant is the int 544 at `main.lua:168`). #218's
  own card says an 8 KiB bank overflow is "a named refusal with the sizes" —
  **that refusal is what banked data turns into capacity.**
- **#219** (3/3) proves it end to end: a cave-style toy exports and its
  Mednafen capture diffs 0 against the browser.

So the pool cards and banking compose in one direction only: #217–#219 make a
toy *put its static data in banks*; banking makes *those banks bigger than
one*. Without banking, #218's blobs hit the same 8,160 B wall and STARFALL
still cannot ship its BAT; with banking, the wall is 8,160 B per asset bank.
What banking does **not** do is raise `MAX_CONST` itself — that is #218's
encoder work, unchanged.

---

## 4. Cost summary

| | capacity | interpreter size | speed cost (measured workload) | risk to existing ROMs |
|---|---|---|---|---|
| **3.1 flat banks, per read** | 16,320 B (2 banks) – 65,280 B (8) | 25–40 B + 1 B ZP (reasoning) | +7.4–9.2 % TOWER, **+67–84 % DUSK**, +2.4–3.1 % PLATFORMER | high: hot path + mask; no version bump to catch a bad read |
| **3.1′ flat banks, per instruction** | same | 20–30 B + 1–2 B ZP | +1.9–2.4 % TOWER, +16–20 % DUSK, +0.6–0.8 % PLATFORMER | high–medium: still touches the loop |
| **3.2 per-function banks** | 8,160 B tables + 8,160 B per code bank; ROM-bounded | 25–40 B + 2 B ZP/BSS (probe; else bank-3 helper) | +0.2–0.3 % TOWER, +0.8–1.3 % DUSK, negligible PLATFORMER | medium: format v4, hot path untouched, v1–3 read unchanged; all shas move |
| **3.3 asset banks (COPYV)** | ROM-bounded; VRAM-bounded per copy | 40–80 B (projection; #217 sizes it) | a win (a loop, not per-word dispatch); not measured | low: new op, no old toy emits it |
| **3.4 #217–#219** | enables blobs; 8,160 B per bank | #217's cost | #217's evidence | low; #218 changes encoder output, not v1–3 containers |

The size figures for 3.1/3.2 are **reasoning from the code shape**; the 35 B
slack (`docs/ASM.md` §2.1) is measured and is the number the first build card
must beat.

---

## 5. Recommendation

### 5.1 The shape: per-function code banks + a tables bank at MPR3

Take §3.2. It is the only option whose cost is a compare per *call* instead of
per read, and the measurements above say that is the difference between
+0.2–1.3 % and +7–84 % on the games that are already too slow. It also keeps
`rb()`, the opcode loop and the jump handling untouched — the smallest
possible change to the code that has the least slack.

Take §3.3's COPYV as the asset path, with #217 as the op and #218–#219 as the
encoder and proof half (§3.4). Do **not** take §3.1: it is simpler to
describe but pays the viewer's per-byte boundary check in the hottest loop in
the system, and the measurement says DUSK RUN would lose most of its frame.

### 5.2 The container (v4)

- Header version **4**; `u16` fields stay, now bank-relative; the bank count
  rides in the two reserved header bytes (offset 26–27). **The encoder writes
  v4 only when the program does not fit one bank**; a toy that fits keeps its
  v1–v3 container bytes unchanged (the #175 rule, applied again).
- Function entry: the reserved byte at offset 9 becomes the **code bank**;
  `codeOff`/`codeEnd` and jump targets are **offsets within that bank**.
- Bank 0 (physical 4) is the **tables bank**: header, function table, upvalue
  descriptors, constants, global names, table section, and the song trailer
  at `$1FE0`. Usable 8,160 B; a tables section over it is refused by name
  (`toy-tables-bank-full`).
- Banks 1..N (physical 5..) are **code banks**, functions packed whole; each
  ends with the 32-byte trailer strip so the sound glue is untouched. Usable
  8,160 B per bank. A function larger than the remaining room is
  `toy-function-too-big` (name it, with the function id and byte count).
- `buildToyRom` appends `(1 + N)` data banks; the ROM is
  `32,768 + (1 + N) × 8,192` B. It also **fixes the 8,160/8,192 refusal**
  (§1.4, finding F1) for every bank.

### 5.3 Backward compatibility

- **v1–3 containers are read unchanged.** Their offsets are all < 8,192, their
  function entries' reserved byte is 0, `code_base` is 4, the trailer is where
  it is today, and MPR3 maps the same physical bank 4 at boot. The new
  compare is true on the first call and never remaps. The strongest proof is
  the existing host-harness parity (`tests/check-ilvm.js`) plus a Mednafen
  old/new diff, the method #221 used.
- **Every ROM sha still moves**, because `renderer/ilvm.bin` changes. The six
  ROM shas pinned in `tests/check-export-games.js` `GAME_PINS` (PLATFORMER,
  DUSK RUN, sprite, palette, arity, not) and the picture-cycle fixtures must be
  re-pinned **after** the old/new Mednafen diff, not before. This is the largest
  bookkeeping cost of the change, not a technical risk.
- The host build (`tools/ilvm/hostvm.c`) stands in for the data bank; it gains
  the same two-bank model so the parity test covers v4.

### 5.4 The cards to build it (proposed; the maintainer decides whether to add them)

1. **BANKED DATA 2/4: container v4 and the builder** (~M). Encoder packs
   functions into banks and emits bank-relative offsets + the bank byte;
   `buildToyRom` lays out the tables bank + N code banks and fixes the 8,160 B
   refusal. *Closes on:* TOWER encodes as a 2-bank container at 49,152 B; a
   single-bank toy's container bytes are unchanged; a function too big for a
   bank and a jump at a bank edge are refused by name; a v1–3 container's bytes
   are unchanged.
2. **BANKED DATA 3/4: the interpreter maps a function's bank** (~M). Boot maps
   MPR3 to the tables bank; `exec` entry reads entry+9 and maps the code bank;
   `konst`/`closure` read through `TABLES`. *Closes on:* the link probe (the
   change fits the 35 B or moves to a bank-3 helper); the host harness's
   v1–3 results are byte-identical; a 2-bank toy boots and runs in Mednafen
   with its picture matching the browser; `tools/gen/ilvm.json` records the
   sizes.
3. **BANKED DATA 4/4: COPYV with a banked offset** (#217 restated) (~M). The
   op's data operand is a bank + offset from day one; the interpreter maps
   once per copy and streams. *Closes on:* #217's 300-word copy plus a
   Mednafen capture once #218 emits a blob.
4. **Re-pin after the interpreter moves** (~S). Old/new Mednafen diffs for
   every pinned ROM, then the six shas, the picture cycles and the docs
   (`ROM_SPEED.md`, `ROM_LAYOUT.md`, `IL.md`, `ASM.md`). The #221 precedent is
   the template.

#217–#219 stay as they are on the board and slot in at (3).

### 5.5 Sequencing, and the TOWER interaction

- **Banking does not make TOWER export** (§"The answer first" item 3): it is
  over the data bank **and** functions 44/41, registers 43/41 and boot upvalue
  cells 90/72. If card **#272** (rework TOWER in place) lands first, the
  8,524 B refusal disappears and the banking cards lose their obvious
  witness; they must use a **2-bank fixture** (or the original TOWER kept at
  `/Volumes/External/pcestudio-toys/originals/tower/`, which #272 already
  copies out). If banking lands first, TOWER still black-screens until its
  RAM rows are fixed. The maintainer should choose which wall to attack
  first; the two are independent.
- The game that banking most plausibly finishes is **STARFALL**, and only
  after #148/#218 clear its 127-constant refusal: its projected container is
  9,186 B (`docs/ROM_SPEED.md` §"The cards this measurement added"), which is
  two banks. NOVA TIDE (projected 9,287 B) is the same, after #136's `raster`.

---

## 6. Which gallery toys it unlocks (measured)

This is the part that should temper the priority. The three toys the card
names, measured on this tree (the same `tools/ilvm/emit.js` route the MCP's
`export_pce` uses):

| toy | what the encoder/builder says today | container | does a bigger bank unlock it? |
|---|---|---|---|
| **CAVE** (`demo-art/cave/main.lua`, #127) | **builds**: 40,960 B ROM, no refusal | **1,977 B** (measured) | **No — it already fits.** It is not bank-blocked. |
| **CITY** (`demo-art/city/main.lua`; repo copy refuses at the same line) | `ilbc-op`: line 133, field `x` is not a constant the encoder can carry | not encodable; **projected ~2.2–2.4 KB** (code 1,712 B + tables) | **No.** Its blocker is the constant-spec walker (#211's class), and its container is well under one bank. |
| **OAK WOODS** (`demo-art/oak-woods/main.lua`; repo copy line 174) | `ilbc-table-escape`: the table at function 6 pc 12 (line 151) can run more than once and escapes | not encodable; **projected ~2.5–2.8 KB** (code 2,096 B + tables) | **No.** A table-aliasing limit, not size. |
| **TOWER** | `toy-data-bank-full`, 8,524 B | 8,524 B (measured) | **Partly.** Fits two banks, but still over the three RAM rows (§5.5). |
| **STARFALL** | `ilbc-range` (128th constant) | projected 9,186 B | after #148/#218: yes, two banks. |
| **NOVA TIDE** | `ilbc-op` `raster(line, spec)` | projected 9,287 B | after #136: yes, two banks. |

The projections are arithmetic from the IL with the encoder's own per-op sizes
(the method reproduces the four encodable containers to within about 2 %:
TOWER 7,051 predicted vs 7,206 encoded code bytes; DUSK 6,003 vs 6,122;
PLATFORMER 1,939 vs 1,959; CAVE 1,338 vs 1,352) — **projection, not a
measurement**, because the encoder refuses them.
CAVE's playable file lives in `demo-art/cave/`, not in `toys/`; whether it is
listed in Browse is a gallery-packaging question, not a bank one.

**So: within the gallery as measured today, the bigger bank finishes no toy on
its own.** It is a prerequisite for TOWER's size row and for STARFALL/NOVA
after their own blockers, and it is the headroom that stops the next game from
hitting the wall. That is still worth building — the maintainer asked for
"every game exports", and this is one of the two walls along that road (the
other is the interpreter's RAM capacity, #222/#272) — but it should be chosen
with the right expectation.

---

## 7. What banked data does not fix

- **The interpreter's RAM capacities** (`MAX_FUNCS` 41, `MAX_REGS` 41,
  `MAX_UPS` 20, `UP_PERM` 72, `MAX_TABLES_CELLS` 192 — `ilvm.c:70–121`).
  A bigger container does not raise them; TOWER's three RAM rows and DUSK
  RUN's old black screen are these. 48 B of soft-stack margin is all the room
  left (`docs/ASM.md` §2.4).
- **The 127-constant pool** (`pce-ilbc.js:461–462`) — #148/#218.
- **The encoder's uncarried constructs** (`raster`, non-constant sprite specs,
  escaping tables) — #136, #211, and the cards CITY/OAK WOODS will need.
- **Speed.** Banking adds cost; it never removes any. The games are already
  slow: PLATFORMER measures 30 Hz where the static model prices it at 0.74
  frames an update (`docs/ROM_SPEED.md`), and DUSK RUN 18.3 Hz.
- **The raster display's 16-byte row-16 lag** (#227) and the other console
  gaps are untouched.

---

## 8. Not measured / open

- The 25–40 B and 40–80 B interpreter estimates are **reasoning from the code
  shape**, not a build. `docs/ASM.md` §6's probes are the method: a scratch
  copy, a build, `build.sh`'s 16,384 B assert. The first build card must run
  that probe before the shape is promised.
- The added-cycle figures use 8–10 cycles for the check (anchored on the
  viewer's `copy_words` fast path) and 12–20 for a `TAM`; the interpreter is
  compiled by llvm-mos, so the real code is the compiler's. The percentages
  are therefore ±a few points, but the order of magnitude — per-call is free,
  per-byte is not — is robust to the compiler.
- No ROM was built and no Mednafen run was made: this is design only.
- The exact bin-packing of functions across banks (which affects how often a
  call crosses) is not designed here; the worst case (every call crosses) is
  what §3.2 prices.
- The sound glue's trailer read was kept unchanged by giving every bank the
  32-byte strip. The alternative (trailer in the tables bank only) would
  change the assembly glue and re-open the sound proofs; it is not
  recommended.
- Rule 2 (a different seat breaks the test) applies to each build card; this
  note has no test to break.
