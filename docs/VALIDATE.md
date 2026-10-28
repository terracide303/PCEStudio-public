# The toy validator (#32)

`renderer/pce-validate.js` prices a toy **on its IL**, the way ppu.toys' author
analyses his IL (`docs/PPU-TOYS.md`): it runs the compiled IL through
`renderer/pce-il.js`'s reference interpreter with one observer per executed
instruction (`options.onOp`), and from the executed instruction counts and the
resulting hardware state it reports:

| question | how | refusal code |
|---|---|---|
| frame time at 60 Hz | cycles of `frame()` and of every `raster(line)` call, per IL op, plus one fixed cost per compiled hook call | `validate-frame-budget` (error) above 8 display frames; `validate-slow-frame` (warn) below 60 Hz |
| sprites per line, 256-px rule | `renderer/pce-sprites.js` `status()` — #50's model: 16-px strips, 16 a line, the rest dropped, OR | `validate-sprite-line` |
| VRAM fit | the highest word written by `vset`, and every sprite's pattern cell, against 32,768 words | `validate-vram` |
| ROM fit | bytes per static IL op + the runtime baseline, against the HuCard's 1 MB (#57) | `validate-rom` |
| VCE/VDC writes in the blank | each raster table entry's replay cost against part C's ~123-cycle blank (§10.2 of `docs/IL.md`) | `validate-raster-line` (error: more than 2 colour words, or a `vset` from a callback); `validate-raster-blank` (warn) |
| value ranges | constant `reg`/`pal`/`vset`/`sat`/`raster` operands, plus the host's own run-time refusals by code | `validate-range`, and the host's `reg-range`/`pal-range`/… |

`validate()` returns `{ ok, code, problems, budgets }`. `problems` carry a
severity; `ok` is false only for an error, and `code` is the first error's.
`budgets` carries every number below, per frame. `tools/toyc/emit.js` runs the
validator **before** `pce-cgen.js` and exits 1 on an error, so a toy that both
misses a budget and uses a construct part A cannot lower is refused for the
budget it missed (`validate-sprite-line`, not `cgen-op`).

The one change the validator needed from #31 is `options.onOp` in
`renderer/pce-il.js`: an observer called once per executed IL instruction with
`(function id, instruction, frame)`. It cannot change the IL's meaning, and
`tests/check-il.js` still gives 973 checks with it in place.

---

## 1. Cycles per IL op, and where each number comes from

The IL's types make this possible: `reg`/`pal`/`vset`/`sat`/`sprite`/`raster`
are instructions, not host calls, so a write is one op with known operands
(`docs/IL.md` §4). A toy frame's cost is

```
frame()  = HOOK_CYCLES + sum over executed ops of cost(op)
raster() = HOOK_CYCLES + sum over executed ops of cost(op)      (per call)
```

**The shape of the table** is the HuC6280 Software Manual's instruction timings
(S8-16..S8-108, transcribed in `docs/MANUALS.md`: one cycle per bus cycle;
immediate 2, zero-page 4, `(zp),Y` 7, absolute 5, branches 2/4) applied to the
C statement `renderer/pce-cgen.js` emits for each op. Its 32-bit values live in
zero-page cells, so a `const` is a load and four stores, an `arith` add is a
carry chain of loads/adds/stores, `mul` and `mod`/`idiv` are the expensive
rows, a `pal` is the `toy_pal` port sequence, and so on. These give the
*relative* weights.

**The scale and the fixed hook cost** are calibrated once, against the two
TMA-timer measurements #31 took:

| measurement | value | source |
|---|---|---|
| part A: the palette toy's `frame()` | 7,417 cycles (mean 7.243 x 1024) | `docs/IL.md` §9.2, `tests/dumps/toypalette` |
| part C: `toys/parallax.lua`'s `frame()` | 1,204 cycles | `docs/IL.md` §10.3, `tests/dumps/toyparallax` |

Two equations solve the table's scale and `HOOK_CYCLES` (= **1,156** cycles:
the compiled hook call — `il_call`'s argument save, the closure lookup and the
C function's prologue/epilogue — plus the timer read inside the bracket).

**The held-out check.** The parallax `raster()` call was *not* used in the
calibration. The model predicts **1,398 cycles a call**; part C measured
**1,510**. The error is **−7.4%**, and `tests/check-validate.js` asserts both
the frame (1,203 vs 1,204) and the raster mean inside a stated **15%**
tolerance. That tolerance is the model's honest accuracy: the table is built
from timings, not from a per-op disassembly of each toy (see §7).

Per-op costs (`validate.MODEL.OP_CYCLES`, at the calibrated scale):

| op | cycles | op | cycles |
|---|---|---|---|
| `const` | 6 | `cmp` | 19 |
| `move` | 13 | `br` / `jmp` | 3 / 1 |
| `getglobal` / `setglobal` | 14 | `call` | 48 |
| `getupval` / `closure` | 18 / 18 | `ret` | 3 |
| `arith` add/sub/and/or/xor/shift | 24 | `forprep` / `fornext` | 24 / 48 |
| `arith` mul | 48 | `reg` / `pal` / `vset` | 24 / 28 / 28 |
| `arith` mod / idiv / div | 64 | `sat` / `sprite` / `raster` | 24 / 28 / 24 |
| `builtin` (`rgb`) | 36 | `print` / `vget` | 24 / 28 |

`tests/check-validate.js`'s run prints the model's budgets for all five #29
toys; the three that matter:

| toy | frame() | raster mean | toy frame | rate |
|---|---|---|---|---|
| parallax | 1,203 | 1,398 | 314,443 | 22.8 Hz |
| road | 1,233 | 1,900 | 426,933 | 16.8 Hz |
| sky-gradient | 1,173 | 1,490 | 335,029 | 21.4 Hz |
| status-bar | 1,628 | 1,222 | 275,268 | 26.0 Hz |
| palette-cycle | 5,871 | — | 5,871 | inside one 60 Hz frame |

Part C measured the parallax collection at 338,757 cycles (2.84 video
frames); the model's 314,443 (2.64) is the same story: **the IL → C route runs
these raster toys at 17–26 Hz, not 60**. The 60 Hz budget (119,318 clocks) is
reported; a toy is refused only past **8 display frames**, where it cannot
animate at all.

## 2. Sprites per line and the 256-px rule (#50)

`renderer/pce-sprites.js` `status()` is the one model, the same one
`tests/check-status.js` proves against Mednafen. Its per-line `requested` is
the number of 16-px strips the on-line sprites ask for (a 32-px CGX sprite
spends two); the VDC draws the first 16 (256 px) and drops the rest, and a
17th request is the OR condition. The validator forces SB on for the search
(`CR | 0x40`) so a toy that forgot to enable sprites cannot hide a 17-sprite
line, and reports the worst line, its strips/px and how many were dropped.
More than 16 on any line is `validate-sprite-line`.

## 3. VRAM

Every `vset` goes through a wrapped host so the highest word address written
(including `init()`) is recorded; every SAT entry's pattern cell is resolved
with `pce-sprites.js`'s layout (64-word cells, 2- and 4-block tall sprites
included) and its last word must be below 32,768. **Tested:** the pattern
check is not exercised by the five toys (no sprites) and only by the
17-sprite fixture, whose refusal is the line rule; a 600-pattern sprite is
not a committed fixture — written down here as not proven.

## 4. ROM

The estimate is `6,200` bytes of runtime (parts A and C's images minus the
toy functions: `tools/gen/toypalette.json`, `toyparallax.json`) plus, per
function, 10 bytes and a per-op byte cost (`validate.MODEL.OP_BYTES`). The
per-op bytes are a single scale fitted to the **13 IL functions whose linked
sizes are committed** in those two JSON reports; the whole-toy estimate lands
within ~12% on the palette toy and ~3% on parallax. A single function can be
off by 2x (LTO inlines differently per build), so this is an estimate for the
1 MB HuCard ceiling (#57) and the built ROM's measured size stays the
authority. Above 1,048,576 bytes is `validate-rom`.

## 5. The blank, and part C's replay handler

A compiled `raster()` callback costs ~1,500 cycles a call and is not the
interrupt (part C §10.1); the runtime builds a table and a hand-written RCR
handler replays it. From part C's counted handler: saves+status/dispatch
**29** cycles, the first register write **64** from handler entry (+35 a
second, +35 a third), a colour word **~36** (the colour-only stub completes
two words by ~72, #69), and the blank is **~123** cycles. The validator
sums each line's entry and flags anything over 123.

`road.lua` writes three things on every line (BYR, BXR, a palette word) = 135
cycles; it is over the blank on all 224 lines and the validator **says so**.
It is a warning, not a refusal: part C's handler fits two registers, and how a
three-write step is replayed is not built. Naming that is the point — the
five #29 toys otherwise pass. `sky-gradient` (101) and `status-bar` (99) fit;
`parallax` (64) has room. More than **2 colour words** on a line, or a `vset`
from a callback, is an error (`validate-raster-line`): those are the runtime's
own measured limits (part C §10.4).

## 6. Value ranges

Constant operands are checked statically against the host's tables
(`renderer/pce-toyhost.js`: BXR 0..1023, BYR 0..511, CR 0..255, CRAM 0..511,
VRAM 0..32767, SAT 0..63/0..3, raster 0..223). Many constants arrive in a
register rather than as an operand; those are caught at run time by the same
host that the browser and the console share, and the validator returns its
code unchanged (`reg-range`, `pal-range`, `vram-range`, `sat-range`,
`sprite-range`, `raster-line`, `raster-line-full`, `pad-range`, `toy-error`).
The range fixture in the test (`reg("BXR", 2000)`) comes back as `reg-range`.

## 7. Not proven, and the next things to do

- **The table is calibrated on two toys.** Its shapes come from the manual
  timings and the C emitter; its scale from two TMA measurements. A third
  measured toy (e.g. status-bar) would test it further. The parallax raster
  prediction is the one held-out number (−7.4%).
- **Mednafen is the only witness** for the measurements it is calibrated on;
  no console.
- **The model prices executed IL, not the compiled code.** A different
  backend (HuC, a direct generator) will not have the same per-op costs;
  part D's route comparison will need its own table.
- **The blank model is part C's handler**, not silicon; the BYR-vs-BXR latch
  windows in `docs/MANUALS.md` §16 are finer than the one 123-cycle budget
  used here.
- **Warnings do not refuse.** The rate and the blank overrun are reported
  because the five #29 toys must pass; road.lua's picture would land late on
  the console route, and that is recorded rather than hidden.
- **The five toys' pictures were not re-run** by this card — #29's
  `check-examples.js` owns them and is green.
- **Rule 2 is owed.** This file and its test were written by @design; a cold
  break by another seat — of the op table, the sprite/ROM/blank models and
  the export gate — is required before the card closes.
