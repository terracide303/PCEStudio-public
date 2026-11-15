# Racing our compiler against real game routines

2026-11-14. The idea (the maintainer's): take small, hot routines out of real HuCards, write the same
behaviour in our Lua, compile it with the native route, and compare cycles per call. This measures the
compiler against what a game programmer actually wrote, instead of against our own benchmarks.

**What was done, honestly:** six routines from three of the maintainer's games (A = Klax, B = Super Star
Soldier, C = Blazing Lazers), found by tracing the games in Geargrafx. Each was ported to Lua, **replayed
against inputs and outputs read from the real game's instruction trace** (every captured call reproduced),
compiled natively, and measured. Bomberman '93, Galaga '90 and Bonk's Adventure were scanned too, but their
hot routines were either too long, not self-contained, or in a bank the emulator would not disassemble at
the moment of capture, so they are not in the table. Nothing from the games is stored here: only counts,
ratios and short descriptions (the vectors stay in scratch under `$TMPDIR/rb`, outside the repository).

## Result

Cycles are CPU cycles per call. **Original** = JSR + body + RTS, from the trace's time stamps (3 master
clocks to a CPU cycle; the unit was checked: one traced video frame is 119,656 CPU cycles, the known
figure). **Ours** = the compiled routine's own cycles per call from a one-frame trace of the native ROM, plus
14 for the JSR and RTS.

| routine | what it does | original (cycles / instructions) | ours (cycles / instructions) | ratio | main cause |
|---|---|---|---|---|---|
| game A routine 1 | sprite-list word: Y + 64, hidden when Y = 248 | 48 / 11 | 342 / 90 | 7.2x | one table read (68 instructions), one `sat()` write |
| game A routine 2 | sprite-list word: X + 32, plus 256 if a flag bit is set | 57 / 12 | 784 / 208 | 13.8x | **two** table reads, a bit test, `sat()` |
| game A routine 3 | sprite-list word: pattern * 2 + 384 | 60 / 14 | 323 / 82 | 5.4x | one table read, `sat()` |
| game B routine 1 | 8 x 8 -> 16-bit multiply (shift and add) | 249 / 66 | 1,015 / 252 | 4.1x | 32-bit shift-and-add loop for 8-bit operands |
| game B routine 2 | meta-sprite expander (4 sprites, 4 list words each) | 784 / 175 | 7,983 / 2,217 | 10.2x | 32 byte-table reads and 16-bit combines, 16 `sat()` writes |
| game C routine 1 | one sprite's four list words from three object arrays | 108 / 27 | 1,167 / 314 | 10.8x | three table reads, 16-bit masks and shifts, four `sat()` writes |

Our code runs at about the same cycles per instruction as the originals (3.6 to 4.0 against about 3.6), so
**the gap is the instruction count, not slow instructions**: 3 to 14 times as many instructions for the
same work. Nothing here is a library call: the traces show no JSR to a shift or multiply routine; the
compiled code is straight 32-bit inline code.

## Where the cycles go

Isolated by small fixtures (`tests/native-routines/anatomy-*`), measured the same way (function only):

| ingredient | ours | the original does it as |
|---|---|---|
| read one cell of an object table (`oy[i]`) | about 260 cycles, 68 instructions | `LDA abs,X`: 5 cycles, 1 instruction |
| bit test of a table field (`ofl[i] & 64 ~= 0`) | 224 cycles (the table read plus 3 cycles) | the read, `AND`, `BEQ`: about 12 |
| one `sat(i, k, v)` write with variable arguments | about 66 cycles | two stores to the VDC data port: about 10 |
| 16-bit add of two byte pairs | 41 cycles | `ADC` pair: about 14 |
| the call itself (direct call, after the direct-call work) | about 14 (JSR + RTS) plus argument setup | the same |

Why a table read is 68 instructions: the slot number is loaded as a 32-bit value from the globals block,
range-checked as 32 bits (negative, then past the last slot), the index is range-checked against the slot's
capacity as 32 bits, a 32-bit base-plus-index address is built, and the four bytes of a 32-bit cell are
loaded. Every one of those checks is a four-byte compare chain on a CPU with one 8-bit accumulator.

## What would close the gap, ranked by cycles saved per routine in this table

1. **Table reads with a known slot and a proven index range become one load.** The slot is a compile-time
   constant (the table is a global assigned once), and a loop index such as `(k & 31) + 1` has a provable
   range. Elide the three checks and read the cell directly: about 260 down to under 20 cycles per read.
   Saves 240 of the 342 cycles in routine A1 and about 480 of the 784 in A2. Table cells of byte-sized
   data should be stored as bytes (the original's object tables are byte arrays), which also cuts the cell
   fetch from four loads to one.
2. **Inline sprite-list and VRAM writes.** `sat(i, k, v)` at about 66 cycles against about 10 for the two
   stores; keep the address register set across a run of consecutive words (the games set it once per
   sprite). Saves about 55 cycles per word: about 220 per four-word sprite, 880 across game B routine 2.
3. **8- and 16-bit arithmetic where the range is known** (the value-range analysis the validator already
   has the pieces of). A 16-bit combine of two bytes, a mask, a shift by 8 and an add are a handful of
   instructions in 8/16-bit form against 30 to 70 cycles each now. Also turns the 8 x 8 multiply from a
   32-bit loop (1,015 cycles) into a byte loop of about 250, which is what game B's routine is.
4. **Constant shifts and masks as byte moves** (`>> 3` of a masked byte, `& 15`, `<< 8`): 10 to 40 cycles
   each now, 2 to 6 as byte operations.
5. **Four-byte compare chains for the `== constant` and `< constant` tests on values that fit 16 bits**
   (the traces of the compiled routines are mostly `LDA`, `BEQ` and `AND` sequences: the multi-byte zero and
   range tests; no share is claimed here because the whole-frame trace also holds the idle wait).

Applying 1 to 3 to routine A2 would bring it from 784 to roughly 150 cycles (about 2.6 times the original);
to the meta-sprite expander from 7,983 to roughly 1,500.

## How to reproduce

- `python3 -I tools/bench-routine.py scan ROM NAME OUT.json` finds the hot, self-contained subroutines of a
  game (calls per frame, cycles per call, leaf or not, loops).
- `python3 -I tools/bench-routine.py trace ROM ENTRY_HEX N OUT.json` records N calls of one routine: the
  registers on entry, the loads and stores it made (reconstructed from the trace: a load's value is the next
  line's register, a store's value is the register on its line), and its exact cycles.
- `python3 -I tools/bench-routine.py dis ROM ENTRY_HEX LENGTH` prints the routine's disassembly to the
  terminal. Read it, write the Lua, then replay the vectors.
- `node tests/native-routines/validate.js [VECTOR_DIR]` replays the captured calls through the studio's
  runtime on each fixture's routine (the text between `ROUTINE-BEGIN` and `ROUTINE-END`) and counts how many
  reproduce the real output: **24 of 24 for each of routines A1, A2, A3, B1 and C1, 16 of 16 for B2.**
  The meta-sprite routine adds its Y and X offsets and flips attribute bits with values held in zero page; the
  trace does not show those as loads, so the validator takes the offsets from the first sprite of each call and
  checks that every other sprite of the call follows the same rule. The multiply is checked on its high byte
  (the trace holds that one) for the non-zero-multiplier path.
- `python3 -I tools/bench-routine.py fixture NAME` builds a fixture natively with a baseline of the same
  loop and reports the extra cycles per call by subtraction. **That number is less reliable than the
  one-frame trace used in the table** (an empty baseline function is inlined away, so the subtraction mixes
  in the call overhead; for the `sat()` fixture it gave 202 against 66 from the trace). The table uses the
  traced numbers.

## Not verified

- Three games, six routines. They are all sprite-list builders or arithmetic; no collision test, object
  update loop or map lookup was found in a self-contained, disassemblable form in the time spent.
- The originals' cycle counts come from the trace of the game running after scripted button presses, so they
  are for the code paths those frames took (e.g. game A routine 1 has a cheaper path for a hidden sprite: 36
  cycles against 48; the table uses the common path).
- Our harness calls each routine 8 to 64 times a frame with generated inputs; the object tables hold values
  from a formula, not from a game.
- The savings estimates in the ranking are arithmetic from the measured ingredient costs, not builds.
- Table cells in the fixtures are the compiler's 32-bit cells; the proposed byte cells are not built.

## After #292 (2026-11-15)

Step 1 and the table half of step 3 above are built: a table with a known slot is one direct cell access,
with byte or 16-bit cells when every stored value fits (docs/NATIVE.md, "Table access with a known slot").
The `anatomy-table` fixture reads 209 cycles a call against 346 (resolution alone; the key there is a
parameter, so a guard stays unless LLVM proves it away). The six routines were not re-measured. `sat()`
inlining and the 8/16-bit arithmetic of steps 2 to 4 are not done.
