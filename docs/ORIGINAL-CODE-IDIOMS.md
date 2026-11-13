# How real HuCards write their code, and what it means for our compiler

Written 2026-11-13, a measured study for the speed work on the Lua -> C -> llvm-mos route
(`docs/NATIVE.md`). It follows `docs/ENGINE-STUDY.md` (how a frame is spent); this one looks at the code
itself. Method: ten of the maintainer's own HuCards run in Geargrafx through its MCP server
(`tools/study-idioms.py`, `docs/GEARGRAFX-MCP.md`); after the title, with a fixed pattern of RUN, I, II and
direction presses, one whole video frame of the CPU instruction trace (22,000 to 36,000 instructions, 119,650
CPU cycles) is reduced to counts at four places per game (39 samples). **Only counts and percentages are
stored here: no game code, no listings, no ROM bytes.** Games: R-Type, Blazing Lazers, Super Star Soldier,
Ninja Spirit (shooters / action), Bonk's Adventure, Bomberman '93, Galaga '90 (platform, arcade ports),
Neutopia (RPG), Klax (puzzle), Space Harrier (a scaler: the samples caught its title screen, so it counts
little). The samples are title, demo and play screens without telling which; one frame each. They are
samples, not averages, and "per frame" below means "in the sampled frames".

Our side was measured the same way (the same tool on our compiled ROMs) plus small benchmark toys
(a global add in a 100-iteration loop and one extra operation per iteration, cycles above that baseline).
These numbers were taken **before** the direct-call work (`IL_DIRECT`) landed; the call figures are the
"before".

## 1. The table

| | Blazing Lazers | Bomberman '93 | Bonk's Adv. | Galaga '90 | Klax | Neutopia | Ninja Spirit | R-Type | Super Star Sold. |
|---|---|---|---|---|---|---|---|---|---|
| instructions in the sampled frame | 35,300 | 29,800 | 29,800 | 23,000 | 28,100 | 27,200 | 21,900 | 29,700 | 23,600 |
| zero-page share of RAM operands | 91% | 95% | 98% | 91% | 94% | **10%** | 67% | 91% | 78% |
| indexed share of RAM operands | 7% | 5% | 2% | 9% | 6% | 9% | 24% | 7% | 40% |
| calls per frame (JSR + BSR) | 93 | 70 | 177 | 15 | 239 | 256 | 220 | 218 | 289 |
| indirect JMP per frame | 1 | 5 | 0.5 | 2 | 3 | 0 | 61 | 46 | 0 |
| RTS that does not return to its call | 1 | 0 | 8 | 0 | 0 | 0 | 0 | 2 | 0 |
| bank-mapping instructions (TAM) | 25 | 28 | 309 | 8 | 10 | 54 | 47 | 16 | 125 |
| cycles in TAM/TMA | 0.1% | 0.1% | 1.2% | 0.0% | 0.0% | 0.2% | 0.2% | 0.1% | 0.8% |
| block-transfer instructions | 0 | 0 | 0.5 | 1 | 5 | 1 | 12 | 0 | 5 |
| ADC/SBC that are 16-bit chains | 12% | 0% | 4% | 0% | 0% | 21% | 18% | 13% | 13% |
| cycles in shift-and-add loops | 0 | 0 | 0 | 0 | 0 | 0 | 0.7% | 0 | **8%** |
| deepest call nesting seen (bytes of stack) | 11 | 17 | 78 | 8 | 18 | 19 | 13 | 10 | 10 |

(Medians over each game's sample points; the call nesting is the maximum.)

**Instruction idioms, in how many of the 39 sample points they appear:** STZ 39, PHX/PHY/PLX/PLY 39, CLA/CLX/CLY
35-39, BRA 38, TAM 39, TMA 36, TST 31 (bit test of a zero-page or absolute byte), ST0 27 / ST1 20 / ST2 22 (VDC
stores), `(zp)` indirect (no index) 24, TIA 18, TII 16, BSR 16, SXY 13, TSB 8, TRB 5, SAX 5, SAY 3, TAI 1. Never
seen: TDD, CSL/CSH, SET, `JMP (abs,x)`.

## 2. What it says

1. **Zero page is the variable store.** 85% of RAM operands (median over the 39 samples) are zero-page; the rest
   is mostly `abs,x` (5%) and `(zp),y` (1.5%). Neutopia, a RPG, is the exception: 70% absolute RAM. Indexed
   zero-page (`zp,x`) is almost unused (0.3%): arrays live in absolute RAM.
2. **Calls are `JSR abs`, plainly.** 15 to 356 calls a frame; a call and its return cost 14 CPU cycles (JSR 7,
   RTS 7) which is 0.5 to 2.8% of a frame (measured on five games); the typical inclusive cost of a routine is
   54 to 340 CPU cycles (median 54 R-Type, 57 Klax, 103 Blazing Lazers, 339 Neutopia). PHX/PHY around a call:
   0.1 to 0.6 per call. Nesting is shallow: at most 4 to 9 calls deep except Bonk's Adventure (78 bytes).
3. **Dispatch.** Indirect `JMP (abs)` is used 0 to 65 times a frame (Ninja Spirit 61, R-Type 46); the
   `push address; RTS` trick appears in Bonk's Adventure and R-Type (2 to 33 times a frame); `JMP (abs,x)` is
   never used. Jump tables are for state machines and object kinds, not for every call.
4. **Bank switching is a cheap line item.** TAM runs 8 to 476 times a frame (Bonk's Adventure 236 to 476, almost
   all mapping pages 2 to 4 together) and costs 0.0 to 1.5% of the frame. A third to a half of the calls go to
   another 8 KiB page (R-Type 69 of 187, Bonk 63 of 133, Klax 22 of 228, Blazing Lazers 9 of 89); 53 to 100% of the
   TAMs sit within 8 instructions of a JSR, JMP or RTS (the map is done at the call).
5. **The frame is mostly spin.** The hottest code region of a sampled frame is the wait for the VBlank (a loop
   of 8 to 30 bytes in most games, 54 to 95% of the cycles) (the same finding as `docs/ENGINE-STUDY.md`). Interrupts are
   0 to 24% of the frame.
6. **Arithmetic is 8-bit unless it has to be wider.** Only 0 to 21% of ADC/SBC belong to a 16-bit chain (two
   adds on adjacent addresses without a CLC between). Positions that need more are 16-bit pairs; I cannot
   tell 8.8 from 16.0 from a trace alone.
7. **No general multiply.** Shift-and-add loops of 8 or 16 iterations (a software multiply or divide) were
   found in 2 of 10 games: Super Star Soldier (about 8% of its frame, 4 of 4 samples) and Ninja Spirit (0.7%);
   none in the other eight. The games avoid multiplication (tables, shifts, constants) or do it rarely.
8. **Loops.** Counting the X change per iteration at each loop head over all samples: 56% step by 1 (plain
   arrays, one array per field), 10% by 2 to 4 (array of small structures, e.g. a SAT shadow copied four bytes at
   a time), 2% by more, 32% do not step X (pointer loops with `(zp),y`, counters). Typical object-style loops (5
   to 100 iterations, 60 to 430 CPU cycles per iteration, 100 to 870 for the heaviest bodies) take 1 to 14% of a
   frame each. The arrays of one loop are usually far apart (gaps of 48 to 64 bytes: one array per field), though
   in some games adjacent addresses (gap 1 to 2) show structures.
9. **VDC.** 130 to 350 VRAM data words are written per frame (R-Type 288, Galaga 256, Klax 257, Neutopia 348, Blazing
   Lazers 178), by ST1/ST2 or plain stores, with a few TIA block moves for bulk (Klax up to 13 per frame). The
   sprite attribute table is written to VRAM by DMA (`DVSSR` written in the frame) in 5 of 10 games
   (R-Type, Neutopia, Ninja Spirit, Super Star Soldier, Bomberman '93); Klax builds a RAM copy and writes it out
   word by word. VRAM writes cost 1.4 to 4.3% of a frame in cycles.

## 3. Our compiler, measured the same way (before direct calls)

CPU cycles; the baseline loop iteration (`v = v + i`, global `v`) is 115 to 132 cycles on its own.

| operation in our compiled code | extra cycles | what a real game does |
|---|---|---|
| a Lua call through `il_call` (small callee) | **+523** | JSR + RTS: 14 |
| the same, mean over TOWER's 46 calls in a frame | **1,015** (271 instructions, 39% of the frame) | |
| `x * y` | **+1,029** | tables / shifts; none in 8 of 10 games |
| `x // 10` | **+1,561** | the same |
| `x % 10` | **+1,197** | the same |
| `x << 3` | +78 | 3 shift instructions: 6 |
| `x // 8` (power of two) | +138 | 3 shift instructions: 6 |
| `x & 7` | +32 | 1 AND: 2 |
| a comparison and branch | +98 | 2 to 4 |
| a table store `T[(i & 7) + 1] = v` | +39 | an indexed store: 5 |
| `vram[i] = v` (one VRAM word) | **+102** | ST1 + ST2: about 10 |
| `sat(i, 1, v)` | +117 | one store into a RAM copy: 5, then DMA |
| operand mix | 94% zero page | 85% zero page |

(The "real game" cycle counts in the right column are from the instruction timings of the HuC6280, not from a trace of the same operation.)

So the zero-page habit is already ours (llvm-mos puts its registers there); the cost is the width (every Lua
integer is 32 bits) and the call path.

## 4. What this means for our compiler (ranked, after direct calls)

Estimates are from the measurements above and are not yet tested on a build.

1. **8- and 16-bit code where the range is known.** Every IL operation is a 32-bit operation: the baseline
   iteration is 115 to 132 cycles where a byte or word loop is 20 to 30. Real code is 8-bit with 16-bit pairs
   only where needed (88% of ADC/SBC are not 16-bit chains). The validator already knows value ranges
   (`pce-validate.js`); use `uint8_t` / `int16_t` for registers and globals whose range fits, keep int32 only
   where it does not. Expected saving: 3 to 5 times on arithmetic, comparisons and loop counters; on TOWER,
   about a third to a half of what remains after the call fix (an estimate: the 61% not in `il_call`).
2. **Cheap multiply, divide and modulo.** 1,000 to 1,560 cycles each is the biggest single operation cost (DUSK
   RUN's two-minute start-up is this). Real games rarely multiply; when they must, they use a table or shifts. Do:
   multiplication by a constant as shifts and adds (`x * 3`, `* 10`, `* 640`); division and modulo by a constant
   as a multiply by the reciprocal with a shift, or for small ranges a lookup table; a 16 by 8 bit multiply
   routine (unrolled, about 100 to 150 cycles) when the range analysis allows it; the generic 32-bit routine
   only as the last resort. Expected: 1,000 to 1,500 down to 30 to 150 cycles for the constant cases (80 to 95%).
3. **VRAM and SAT writes the way the games do them.** `toy_vram_set` is 102 cycles per word against about 10 for
   an inline ST1/ST2 pair, and `sat()` 117 against a store into a RAM copy of the attribute table, which the
   hardware copies itself (`DVSSR`/`DCR` DMA, used by 5 of 10 games). Inline the two stores, write a run of
   constant words with TIA, keep a SAT shadow in RAM and start the DMA in the VBlank. For the 130 to 350 words a
   real frame writes that saves about 13,000 to 32,000 cycles a frame (11 to 27% of a frame).
4. **Constant shifts and masks on wide integers.** 78 to 138 cycles for `<< 3` or `// 8`, 32 for `& 7`. A
   shift by 8, 16 or 24 is a byte move; `& 255` is the low byte; the rest are inline shift sequences. Together
   with item 1 most of this disappears; as a separate step it saves 50 to 100 cycles per operation.
5. **Pack caller and callee into the same bank.** A third to a half of real calls cross a bank and still cost
   under 1.5% of a frame in TAM, so bank switching is not the problem; but a direct call to a callee that is in
   the caller's bank needs no mapping at all (about 10 cycles saved per call). Put functions that call each
   other in the same bank when packing (`tools/bank-toyc.py` is first-fit by size today).
6. **Calls with narrow arguments.** After direct calls, the arguments are the remaining cost: five 32-bit values
   marshalled per call (the 271 instructions in `il_call` were mostly 32-bit loads and stores). Real routines
   take A, X, Y and a zero-page byte or two. Pass the arguments in registers (the llvm-mos calling convention
   does that for 8- and 16-bit values) once item 1 narrows them: 20 to 60 cycles per call.
7. **Block moves for fills and copies.** TIA/TII appear in 18 and 16 of 39 samples; they move a byte in 6 cycles. Our boot clears 32,768 VRAM words
   with a per-word store loop (about 16 frames); a TIA from a zero byte takes about 3. A `for` loop that only
   fills or copies a table should become a block move. Saves about 12 frames of boot time and the same shape
   in games' scene loads.
8. **Not worth doing yet:** jump tables for dispatch (real games use indirect `JMP` 0 to 65 times a frame, and
   our statically known calls are now direct), a spin-wait (real games idle 54 to 95%; ours does not, which is
   fine), zero-page locals (already 94%), a structure-of-arrays rewrite of tables (a table store is already 39
   cycles; the real games' arrays are separate byte arrays indexed by X, which item 1 gives us for free).

## 5. What is not verified

- Ten games, 39 one-frame samples; title screens are over-represented, so busy-loop numbers (object updates,
  VRAM words) are lower bounds for play. Space Harrier's samples caught its title.
- The idle share uses "a loop with no stores and over 150 iterations"; Galaga '90 and Ninja Spirit spin in
  loops that do store, and read as 0% idle; their hottest region is still shown.
- "Object update" cost is inferred from loops with 5 to 100 iterations, not from names; I cannot tell an enemy
  loop from a copy loop. The ranking of item 1 assumes the validator's ranges are tight; not yet measured.
- Our measurements are from one benchmark pattern per operation; the figures are cycles above a baseline loop
  and include the baseline's own variation (about 10 cycles).
- 8.8 versus 16.0 fixed point, and structure-of-arrays versus array-of-structures per game, cannot be read
  from addresses alone; the stride histogram is an indication.
- None of the recommendations has been built and timed.

Tool: `python3 -I tools/study-idioms.py ROM.pce NAME OUT.json [POINTS]` writes the counts;
`python3 -I tools/study-idioms.py --summarize DIR` prints a line per game. The per-game JSON (counts only) stays
under `$TMPDIR`, not in the repository.
