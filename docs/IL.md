# The IL — PCEStudio's intermediate language (#31)

**One page per question, measured where it can be.** This document defines the
IL a toy is lowered to, the types it carries, what each Lua construct becomes,
and what is refused. The pipeline is the one ppu.toys' author described
(`docs/PPU-TOYS.md`):

```
toy.lua --(Fengari's parser, the browser's own Lua)--> Lua 5.3 bytecode
        --(renderer/pce-il.js, the lowerer)---------->  PCEStudio IL
        --(#32: analysis)--------------------------->  HuC6280 code
        --(renderer/pce-cgen.js, parts A-C, §9-§11)
                                        C -> llvm-mos -> .pce
                                        C -> HuC -> PCEAS -> .pce
```

The IL is where the validator (#32) counts cycles per frame, sprites per
line and memory, and where `raster()` is checked against the line budget
(`docs/VALIDATE.md`). The first half delivered the IL, the lowering, and a
reference interpreter that runs it over the same host and the same models as
the browser runtime (`#30`). Part A of the console half (§9) delivered the
first backend: the palette toy through the same IL → C → llvm-mos → a HuCard
ROM → Mednafen. Part C (§10) adds `raster(line)` on the console: a
compile-ahead table replayed by a hand-written RCR handler, with the compiled
callback's measured cost saying why it is not the handler. Part B (§11) runs
the **same IL through the same C emitter in a HuC dialect** into vendor/huc's
own compiler and PCEAS, both toys again matching the browser in Mednafen;
part D (§12) puts the two routes' measured numbers side by side.

- `docs/IL.md` — this file: the instructions, the types, the lowering table,
  the refusals, and parts A and C of the backend.
- `renderer/pce-il.js` — `compile(source)` → the IL program; `create(source)`
  → a runtime with `load()`, `frame(f)`, `setPad()`, the same shape as
  `renderer/pce-toys.js`. `runProgram(program, host, {onOp})` accepts an
  observer called once per executed instruction (`(function id, instruction,
  frame)`), which is #32's counting point and cannot change the IL's meaning.
- `renderer/pce-validate.js` — #32's validator: cycles per frame and per
  `raster()` call, sprites per line (#50), VRAM/ROM fit, the blank, ranges;
  `docs/VALIDATE.md`.
- `renderer/pce-toyhost.js` — the toy's hardware host, extracted so both front
  ends use one copy (the surface, the ranges, the raster table, the pads, the
  frame flow).
- `renderer/pce-cgen.js` — `emitC(program, {target})` → C (refusals by code;
  `reg`, int globals and the raster hook added by part C; target `"llvm"`
  default, `"huc"` the part B dialect).
- `tools/toyc/toy_runtime.c` — the llvm-mos console runtime: VDC/VCE setup,
  the frame flow, the raster table and its hand-written RCR handler.
- `tools/build-toyc.sh` — Lua toy → IL → C → `mos-pce-clang -Os` → `.pce`.
- `tools/toyc/huc_runtime.c`, `huc_raster.asm`, `tools/build-huc.sh` — the
  same contract through HuC and PCEAS (part B, §11).
- `tools/capture-toy.sh`, `tools/capture-huc.sh` — build, run in Mednafen,
  harvest the state, every frame and the timer measurements.
- `tests/check-il.js` — the IL half's evidence (§8).
- `tests/check-il-console.js` — parts A and C's evidence (§9.3, §10.3).
- `tests/check-il-huc.js` — part B's evidence (§11.4).

---

## 1. Where the front end comes from (rule 1)

**This file does not parse Lua.** Lua 5.3's own parser and compiler, the copy
the browser runs (`vendor/fengari`, MIT, pinned with a sha256 in
`vendor/fengari/VENDORED.md`), compiles the toy; `pce-il.js` reads the
resulting `Proto` tree — the instruction list with `opcode/A/B/C/Bx/sBx`
already decoded, the constant table, the nested prototypes, the upvalue
descriptors, and the per-instruction line info. So the IL cannot disagree with
the browser about syntax, precedence, constant folding, or what line an
instruction came from.

The opcode numbers and semantics were read from Fengari's source
(`vendor/fengari` is the published build; the readable source of the same
version, fengari 0.1.5, was unpacked to a scratch directory for this card and
is not vendored). Two facts from that source are used throughout:

- **Integer arithmetic in the Lua this project runs is 32-bit.** `lvm.js`
  computes `ADD` as `(a + b) | 0`, `MUL` through `luaV_imul`, and the bit
  operators with JavaScript's 32-bit `& | ^ << >>>`; `setivalue` stores the
  value it is given. The IL's `int` is therefore a 32-bit two's-complement
  integer, and its wrapping matches the browser exactly.
- **`/` is floating point, `//` and `%` are integer when both operands are.**
  The IL types `/` as `fixed` (Q16.16) and `//`/`%` as `int` for integer
  operands; that is a deliberate narrowing of Lua's double, stated in §2.

The lowerer refuses anything whose Lua bytecode it does not lower. It never
guesses an opcode's meaning from its number: the number is looked up in a table
transcribed from `lopcodes.js`, and an unknown number is `il-op`.

---

## 2. Types

A value in the IL is one of:

| type | values | Lua source |
|---|---|---|
| `int` | 32-bit two's complement, wrapping (matches the runtime) | an integer constant, arithmetic on ints, `//`, `%`, bit ops, comparisons' operands |
| `fixed` | Q16.16 signed, quantised after every operation | `/`, a float constant, `frame`'s `t`, `sin`/`cos`/`sqrt`/`lerp`/`ramp` |
| `bool` | `true` / `false` | comparisons, `not`, pad fields |
| `table` | a heap aggregate the toy builds | `{...}`, `{x = 1, ...}` |
| `fn` | a function value with a signature | `function ... end` |
| `vram` | the VDC's word-addressed VRAM (a host object) | the global `vram` |
| `pad` | one pad's fields (a read-only host object) | `pad[1]` |
| `padset` | the five pads (a host object) | the global `pad` |
| `env` | the global table (`_ENV`), never a value | only through `getglobal`/`setglobal` |

Rules that matter:

- **A string is not a value.** A string constant exists only as a *name*: the
  key of a global read/write, the field name of a pad or a table set, or
  `reg()`'s register name. Every other use is `il-string`. This is what lets a
  console backend keep names in ROM and never carry a string at run time.
- **No `nil` value.** `LOADNIL` lowers to a `const nil` that defines a register
  but types nothing. Using an uninitialised register in a typed position is
  `il-type`; a global that is never defined is `il-undefined` at run time.
- **One numeric type per value.** A variable is `int` or `fixed`, not both. An
  int literal may be written where `fixed` is required (it converts); an int
  *variable* used where a fixed value is required converts (widening); a fixed
  value used where an int is required is `il-mixed` (`reg("BXR", x)` with a
  fractional `x` would be refused by the Lua runtime too — it wants an
  integer).
- **`fixed` is Q16.16, not a double.** Constants are quantised at compile
  time; the interpreter quantises after every fixed operation. A backend can
  therefore implement it with 32-bit integer arithmetic. `t` is `f/60` in
  Q16.16, so a toy that uses `t` is doing fixed-point maths, not Lua's double
  maths; that is a documented difference from the browser's Lua run, and the
  three toys the card names do not use `t`.

---

## 3. The hooks are explicit

The toy API's entry points are found before typing and typed by the IL, not by
the toy:

| hook | signature in the IL | how it is found |
|---|---|---|
| `init()` | no parameters | `CLOSURE` assigned to the global `init` at the chunk's top level |
| `frame(t, f)` | `t: fixed`, `f: int` | the same for `frame` |
| `raster(line)` | `line: int` | the same for `raster` |

The lowering records the assignment's register in the top-level instruction
list (`CLOSURE` → `SETTABUP _ENV "frame"`), so the function that becomes a hook
is known before its body is typed; the hook's parameters are then the API's,
not unknown variables. A toy may replace `raster` with its own function — that
is how the callback form is chosen, and both runtimes detect it the same way
(after the chunk and `init()` run, the global is a function, not the host
builtin). Reassigning any *other* surface name (`reg`, `pal`, `vram`, ...) is
`il-surface-shadow`: the calls were already specialised against the real one.

The IL program records the hooks as function ids:

```js
{ version: 1, lang: "pce-il", source: "@toy.lua",
  hooks: { init: 2, frame: 4, raster: null },
  functions: [ { id, name, params:[...], returns, upvalues:[...],
                 registers, hooks:[...], code:[...] } ],
  globals: [ { name, type } ] }
```

Every instruction carries `.line` (the Lua source line) so a backend, a
validator and an error can point at the toy's own text. Instructions are
objects; operands are `{ r: n }` (a register slot) or `{ k: { t, v } }` (a
constant of type `int`, `fixed`, `bool` or `str`). A register operand also
carries `tt`, the static type at that use, for #32 and for the interpreter's
`print` formatting.

---

## 4. The instructions

`BASE` is the function's register file (the Lua frame's slots plus scratch
slots for comparison results). `A`, `B`, `C` are register slots; `k` is a
constant operand; `target` is an instruction index in the same function.

| instruction | operands | types | meaning |
|---|---|---|---|
| `const` | `dst`, `k` | `int`/`fixed`/`bool` | load a constant |
| `move` | `dst`, `src` | same type | copy a value |
| `inttofixed` | `dst`, `src` | `int` → `fixed` | widen an int to Q16.16 |
| `getglobal` | `dst`, `name` | | read a global by name |
| `setglobal` | `name`, `src` | | write a global by name |
| `getbuiltin` | `dst`, `name` | | load a toy builtin as a value (only when it is not the callee of a specialised call; the common case is dropped) |
| `table` | `dst` | `table` | a new empty table |
| `tset` | `base`, `key`, `value` | `table`; key `int`/`str` | set a field or element |
| `setlist` | `base`, `index`, `values[]` | `table` | fill the array part (Lua's `SETLIST` group of 50) |
| `arith` | `op`, `dst`, `a`, `b`, `type` | `int` or `fixed` | `add sub mul mod div idiv band bor bxor shl shr`; `type` says which arithmetic |
| `unm` / `bnot` / `not` | `dst`, `a` | same / `int` / any → `bool` | unary minus, bitwise not, logical not (truthiness) |
| `cmp` | `op`, `dst`, `a`, `b`, `type` | `int`/`fixed`/`bool` → `bool` | `eq lt le` |
| `br` | `cond`, `when`, `target` | any scalar | jump to `target` if truthiness(cond) == `when`; otherwise continue (Lua truthiness: only `nil`/`false` are falsey, so a number or table condition is always truthy) |
| `jmp` | `target` | | unconditional jump |
| `call` | `dst?`, `callee`, `args[]` | `fn` | call an IL function; at most one result |
| `ret` | `src?` | | return (no value or one) |
| `closure` | `dst`, `fid` | `fn` | make a closure; its upvalue descriptors are on the function |
| `getupval` / `setupval` | `dst` / `idx`, `src` | | a captured variable |
| `forprep` | `base` | `int` | Lua's integer `FORPREP` for `base..base+2` (start, limit, step) |
| `fornext` | `base`, `target` | `int` | Lua's integer `FORLOOP`: step, compare, control `base+3`, jump to `target` when the loop continues |
| `reg` | `name`, `value` | `int` | write VDC R05/R07/R08 (`BXR`/`BYR`/`CR`); refused by name or width otherwise |
| `pal` | `addr`, `word` | `int` | write a VCE colour entry |
| `sat` | `i`, `k`, `v` | `int` | write a raw SAT word |
| `sprite` | `i`, `spec` | `int`, `table` | compose SAT entry `i` from a spec table |
| `raster` | `lineArg`, `spec` | `int`, `table` | register one line's raster-table entry (the table form) |
| `print` | `args[]` | `int`/`fixed`/`bool` | the page's log |
| `music` | `song` | `int` | start song `song` (#71); the host refuses an index it was given no song for |
| `sfx` | `ch`, `freq`, `volume`, `frames` | `int` | take a PSG channel for a sound effect and give it back after `frames` |
| `release` | `ch` | `int` | give an SFX channel back to the music |
| `vget` / `vset` | `dst`, `addr` / `addr`, `word` | `int` | read/write a VRAM word |
| `padref` | `dst`, `n` | `int` → `pad` | `pad[n]` |
| `padget` | `dst`, `pad`, `field` | `pad` → `bool` | `pad[n].right` etc. |
| `timer` | `period`, `fn?` | `int`, `fn` | start the TMA timer with reload `period` (0..127) and call `fn` once per interrupt (#45); `fn` is a function value the host or the console's generated frame flow calls |
| `builtin` | `name`, `dst?`, `args[]` | numeric helpers | `rgb clamp min max floor abs lerp ramp ramp_int sin cos sqrt note` (`note(MIDI)` returns the PSG's F; a note *name* is a string, which the IL does not carry) |

**Why the toy surface has its own instructions.** A validator (#32) has to
count VDC/VCE writes per line and per frame and check the raster budget. If
`reg`, `pal`, `sat`, `sprite`, `raster`, `vram` and `pad` were ordinary host
calls, that count would have to be reconstructed from a call graph; as
instructions, each write is one op with known operand types, and a backend
emits it directly (a VDC port write is `STA $1C02`/`STA $1C03`, a CRAM write
is `STA $1C04`/`STA $1C05`). The same reasoning is why the surface helpers
stay `builtin` and the language has no general call to an arbitrary number:
a backend can inline `rgb` and price `ramp` without seeing a function value.

---

## 5. How each Lua construct lowers

The left column is the Lua 5.3 opcode the reference compiler emits (numbers
from `lopcodes.js`); the right is the IL. `pc` is the bytecode index, and a
jump's target is `pc + 1 + sBx` (Lua's `dojump` after the fetch increment);
a comparison's following `JMP` is at `pc + 1` and its target is
`pc + 2 + sBx`.

| Lua construct | bytecode | lowering |
|---|---|---|
| `x = 1`, `x = 0x40` | `LOADK` | `const dst int` (integer constant; > 2^31 is a float in this Lua) |
| `x = 1.5` | `LOADK` | `const dst fixed` (quantised to Q16.16) |
| `x = true` | `LOADBOOL` | `const dst bool`; `C` skips the next instruction |
| `local x` | `LOADNIL` | `const nil` on each slot (defines, types nothing) |
| `x = y` | `MOVE` | `move` (or `inttofixed` when widening) |
| `x = g` / `g = x` | `GETTABUP`/`SETTABUP` on `_ENV` | `getglobal name` / `setglobal name`; the name is a constant key |
| `vram[i] = w` / `vram[i]` | `GETTABUP vram`, `SETTABLE`/`GETTABLE` | `vset` / `vget` |
| `pad[n].right` | `GETTABUP pad`, `GETTABLE n`, `GETTABLE "right"` | `padref n` then `padget field` |
| `t = {x = 1, y = 2}` | `NEWTABLE`, `SETTABLE` with constant keys | `table`, then `tset` with str keys |
| `t = {1, 2, 3}` | `NEWTABLE`, `SETLIST` | `table`, then `setlist` (Lua's 50-field groups) |
| `a + b`, `a - b`, `a * b` | `ADD SUB MUL` | `arith` with the operands' numeric type |
| `a / b` | `DIV` | `arith div`, type `fixed` (Lua's `/` is floating point) |
| `a // b`, `a % b` | `IDIV MOD` | `arith idiv`/`mod`, type `int` for int operands |
| `a & b`, `a \| b`, `a ~ b`, `a << b`, `a >> b` | `BAND BOR BXOR SHL SHR` | `arith` (int only) |
| `-a`, `~a`, `not a` | `UNM BNOT NOT` | `unm`, `bnot`, `not` (`not` requires a bool) |
| `a < b`, `a <= b`, `a == b`, `a ~= b` | `LT LE EQ`, then `JMP` | `cmp` into a scratch slot then `br`; the `JMP` is the branch (see below) |
| `if cond then body end` | `TEST`, `JMP` | `br cond` taking the `JMP` when Lua takes it; Lua's truthiness (only nil/false are falsey), so a numeric condition is always true |
| `if a then … else … end` | `TEST`/`EQ`/`LT`/`LE` + `JMP` pairs | the same pairs; every `JMP` becomes a `jmp` or the `target` of a `br` |
| `a and b`, `a or b` | `TESTSET` + `JMP`, or `TEST` + `JMP` | a `br` to the skip point, the move, then `jmp` (Lua's exact pair) |
| `while cond do body end` | `TEST`/`EQ`… + `JMP` + `JMP` back | `br`/`jmp` with explicit back edges |
| `for i = a, b, step do` | `FORPREP`, `FORLOOP` | `forprep base`, `jmp` to the `fornext`, body, `fornext base target` (Lua's integer loop: `FORPREP` subtracts the step, `FORNEXT` adds and compares) |
| `for k, v in pairs(t)` | `TFORCALL`, `TFORLOOP` | **refused** `il-for-in` |
| `f(x)`, `f(x, y)` | `CALL` | `call` with the argument registers; at most one result |
| `f(g())` | inner `CALL` with `C=0`, outer with `B=0` | the inner `call` (one value), the outer `call` with the resulting register as its argument |
| `return x` / `return` | `RETURN` | `ret src` / `ret` (one value at most) |
| `return f(x)` | `TAILCALL` | **refused** `il-op` (a tail call is a different control transfer; #32 can add it) |
| `function f(a, b) … end` | `CLOSURE` | `closure dst, fid`; the function record carries its captures |
| a closure reading an outer local | `GETUPVAL`/`SETUPVAL` | `getupval`/`setupval` (captured by cell) |
| `a:b()` | `SELF` | **refused** `il-method` |
| `#t` | `LEN` | **refused** `il-op` |
| `"a" .. "b"` | `CONCAT` | **refused** `il-op` |
| `2 ^ 3` with a variable base | `POW` | **refused** `il-op` (Lua's `^` is floating point) |
| `f(...)` | `VARARG` | **refused** `il-vararg`; a non-root function declared `...` is refused at build |
| `local a, b = f()` | `CALL` with `C=3` | **refused** `il-multret` (at most one result) |
| `print(x)` | `GETTABUP print`, `CALL` | `print` with the value operands |
| `pal(a, w)`, `reg(n, v)`, `sat(i, k, v)`, `sprite(i, spec)`, `raster(line, spec)` | `GETTABUP`, `CALL` | the matching instruction; `reg`'s name must be a constant string (`il-reg-name`) |
| `rgb(...)`, `clamp(...)`, … | `GETTABUP`, `CALL` | `builtin name` with the numeric arguments |
| `pi` | `GETTABUP` | `getglobal pi` (a fixed constant) |

### The conditional pair, in full

Lua's comparisons and tests do not branch themselves: they are followed by a
`JMP`, and the pair means "skip the `JMP` or take it". The lowering removes the
pair and keeps the meaning:

- `EQ/LT/LE A B C`: take the `JMP` when `(B op C) === A` (A is Lua's boolean
  0/1). `cmp` computes the comparison, then `br` with `when = A` and the
  `JMP`'s target.
- `TEST A C`: the `JMP` is taken when `(C ? !truthy(R(A)) : truthy(R(A)))` —
  for `C=0`, a false value takes the jump; for `C=1`, a true value does. That
  is `br` with `when = !!C`.
- `TESTSET A B C`: when the test does not take the skip, `R(A) := R(B)` and
  the `JMP` is taken; otherwise the next instruction runs. That is
  `br cond → pc+2 (the skip)`, `move A, B`, `jmp target`.

An `and`/`or` therefore becomes a branch over a move, exactly as Lua compiled
it; there is no expression-level short-circuit in the IL, because a backend
needs the control flow.

Numeric `for` is lowered with Lua's own integer-loop arithmetic rather than
rewritten to a `while`: `forprep` subtracts the step (once), `fornext` adds it,
compares with the sign of the step, writes the control variable and branches.
The IL types all four registers `int`; a loop whose start, limit or step is
fixed is `il-mixed` (Lua would run a float loop; a console one has to be
integer, and the toy API's ranges are integers).

---

## 6. The typer

The typer is a **forward pass in the linear instruction order**, with
interprocedural information carried by type variables:

- each function has type variables for its parameters, return value and
  upvalues; each global has one in the program's global map;
- a call unifies the argument types with the callee's parameter variables, and
  the destination with its return; a closure unifies the child's upvalue
  variables with the parent slots they capture;
- the passes repeat to a fixpoint (at most 24), then a final strict pass
  records each operand's type on the instruction (`tt`) and each result's type
  (`dstType`, `type`, `cmpType`) and reports the first refusal.

An unbound value defaults to `int` where an operation is numeric (a parameter
of a function that is never called); it is refused where a specific kind is
needed — as a callee (`il-type`), a table/VRAM/pad base (`il-type`), or a
condition (`il-cond`). This is not SSA: there are no phi nodes, and a register
deliberately reused with two *different* value types on the two arms of a
branch is not something the IL represents. Lua's compiler keeps a local's
register and type for its lifetime, and gives a temporary one job at a time
(the one re-use this subset has is a call overwriting its own function slot,
which `call` models explicitly: the callee operand is a `fn` and the
destination is the return value). Path-sensitive ranges are #32's job; the IL
gives it the per-instruction types and the line numbers to work from.

What the typer proves before any code runs:

- every hook is a function with the API's parameter types;
- every `call` has the callee's arity and argument types (or is a helper with
  its signature);
- every `for` register is `int`;
- a branch condition has a value Lua can test (a string or `_ENV` condition is `il-cond`);
- every VDC/VCE/VRAM/SAT operand is an `int` and a pad field is one of the
  eight names;
- no string survives as a value.

---

## 7. Refusals

A refusal is a `ToyError` with `e.code` and `e.message` carrying the source
line (`line N: ...`). The host's codes (`reg-forbidden`, `reg-range`,
`pal-range`, `vram-range`, `sat-range`, `sprite-range`, `raster-line`,
`raster-line-full`) are the same objects the Lua runtime raises, because both
use `renderer/pce-toyhost.js`. The IL's own:

| code | when |
|---|---|
| `il-syntax` | Lua itself could not compile the toy (the message carries `toy.lua:N`) |
| `il-op` | an opcode with no IL instruction: `LEN` (`#t`), `CONCAT`, `POW` (`^`), `TAILCALL`, `LOADKX`, a stray `EXTRAARG` |
| `il-method` | `a:b()` (`SELF`) |
| `il-for-in` | a generic `for` (`pairs`/`ipairs`/a custom iterator) |
| `il-vararg` | `...`, or a non-root function declared `...` |
| `il-multret` | a call with more than one result, a `return` of more than one value, or an open argument list with no result to consume |
| `il-string` | a string used as a value (including `print("...")` and comparing strings) |
| `il-mixed` | an int and a fixed value in one place, or a fixed value where an int is required |
| `il-int-range` | *guard*: an integer constant outside 32 bits. Fengari stores a decimal past 2^31 as a float, so this is not reachable from a Lua literal; it is kept for a bytecode producer that emits one |
| `il-fixed-range` | a fixed constant outside Q16.16 (`1e9`) |
| `il-type` | a type conflict, a value with no type where one is needed, calling a non-function |
| `il-cond` | a condition with no run-time value (a string, or `_ENV`); Lua's truthiness itself is `br`'s semantics |
| `il-table-read` | reading a field of a table the toy built (the IL's tables are write-only aggregates for now; a pad or VRAM read has its own instruction) |
| `il-pad-write` | writing a pad |
| `il-key` | a table key that is not an integer register or a constant, or a pad field that is not one of the eight names |
| `il-reg-name` | `reg()`'s first argument is not a constant string |
| `il-surface-shadow` | the toy reassigns a surface builtin (`reg`, `pal`, `sat`, `sprite`, `print`, `vram`, `pad`); `raster` is the documented exception (the callback) |
| `il-unsupported` | a known helper this half does not provide: `note`, `ease`, `lerp_color`, `ramp_color`, `password`, `tostring`, `tonumber`, `type`, `pairs`, `ipairs`, `next`, `select`, `error`, `assert`, `string`, `table`, `math`, `utf8` — each with its reason |
| `il-undefined` | reading a global that is never assigned (the IL binds globals statically; Lua would give `nil`) |
| `il-env` | `_ENV` used as a value (a global's name is its binding) |
| `il-arity` | a call with the wrong number of arguments, to a function or a helper |
| `il-jump` | a jump into the middle of a comparison pair, or a branch that lost its target (internal corruptions fail loudly) |
| `toy-timeout` | one hook ran past the instruction budget (`maxInstructions`, default 5,000,000) |
| `toy-error` | a run-time misuse: calling `nil`, indexing a nil pad, a division by zero |

---

## 8. The interpreter, and what proves it

`renderer/pce-il.js`'s interpreter executes the IL against
`renderer/pce-toyhost.js`. It is a **reference** implementation: it runs in
JavaScript, with the same value tags the IL names (`int` as a JS number kept in
32-bit form, `fixed` as a real number quantised after each operation, booleans,
tables as arrays with named fields, closures with upvalue cells). It is not
what the console will run; it is what says the IL's meaning is pinned down.

The frame flow is the host's, and the host is the one the Lua runtime uses:

```
load:      run the top-level chunk; call init() if it is a function;
           detect the raster callback (a function, not the host builtin)
frame(f):  host.beginFrame(f)
           call frame(t = f/60 as fixed, f) if defined
           host.markBase()                  (the frame's writes are the base)
           for each line 0..223: beginLine(), call raster(line), endLine()
           host.endFrame()  -> the raster table (or null)
           host.render(f)   -> renderer/pce-sprites.js over pce-bg.js
```

`tests/check-il.js` is the card's evidence. `node tests/check-il.js` exits 0
with **973 checks**:

- the three toys of #30 — palette cycling, the `raster(line)` callback, the
  sprite reading `pad[1]` — run for **40 frames each** through
  Lua → IL → interpreter and, for every frame, the IL's `vram`, `cram`, `sat`
  and four register values are **byte-equal** to the Fengari runtime's, its
  raster table is **identical** (deep, including `base`, `baseCram` and
  `cramPrev`), its pixels are **diff 0** through the same model, and the frame
  size is equal;
- what the IL *is*: the hooks are found and typed (`frame(t, f)` = `fixed`,
  `int`; `raster(line)` = `int`), the expected instructions are present
  (`forprep`/`fornext`, `closure`, `call`, `cmp`/`br`, `vset`, `pal`, `reg`,
  `padget`, `sprite`), every instruction has a source line, every arithmetic
  and comparison is typed, and no string constant survives;
- a fourth **breadth** toy (not one of the card's three) runs eight frames
  through both and matches byte for byte: a `while` loop, Lua's truthiness and
  the `and`/`or` idiom, a negative-step `for`, `%` and `//` on negatives, and a
  closure with a mutable captured variable. These are the constructs the
  lowering is easiest to get wrong (the first two runs of this card found an
  inverted `TEST` and a dropped `LOADBOOL` skip, both now fixed);
- the helpers agree with the prelude's on a toy that prints
  `clamp/min/max/abs/floor/rgb/lerp` for ten frames (the logs are equal);
- the host's refusals come back through the IL path by code (11 of them), and
  the IL's refusal set is asserted by code and line (20 of them), plus a Lua
  syntax error.

**Rule 2:** this test was written by the seat that wrote the IL, so a cold
break by another seat — another session, another model — is owed before the
card closes. It should try to break the *lowering* (the conditional pairs, the
loop arithmetic, the call slots) and the *typer*, not only the toys.

---

## 9. Part A of the console half: IL → C → llvm-mos → Mednafen

The card's second half begins here, with the smallest end-to-end proof the
route can have: **#30's palette-cycling toy** (the `TOY_PALETTE` of
`tests/check-il.js`, committed as `tools/toys/palette.lua`) is lowered from
the IL to C, compiled by **llvm-mos's PCE target**, run in Mednafen, and its
frames and state are compared with the browser's own run of the same toy.
Part A is deliberately one toy and one backend; `raster()` on the console is
part C (§10), and the comparison of routes (llvm-mos vs HuC vs a direct
HuC6280 generator) is part D, still owed.

### The pieces

| file | what it is |
|---|---|
| `renderer/pce-cgen.js` | the IL → C emitter. `emitC(program)` is pure data-in/C-out; it knows no HuC6280 opcode. Part A supports the palette toy's IL and **refuses** everything else by code (§9.4). |
| `tools/toyc/toy_runtime.h/.c` | the console side: the VDC/VCE setup (viewer.asm's register values), VRAM/CRAM writes, the frame flow, and the timer measurement. |
| `tools/toyc/emit.js` | `toy.lua` → `pce-il.js` → `pce-cgen.js` → C; an IL or C-gen refusal fails the build with its code. |
| `tools/build-toyc.sh` | C → `mos-pce-clang -Os` → the 8 KiB HuCard ROM + a JSON report (sha256, section and function sizes). |
| `tools/capture-toy.sh` | build, run in Mednafen exactly by `tools/capture.sh`'s command-line route, harvest `vram/cram/sat/ram/regs`, **every video frame**, and the measured frame cost into `tests/dumps/toypalette/`. |
| `tests/check-il-console.js` | part A's evidence (§9.3). |

### 9.1 What the C looks like

Each IL function becomes a C function over an `int32_t` register file; the
program's functions are numbered and dispatched by closure value:

```c
struct il_closure { int16_t fid; int32_t up[IL_NUPS]; };
static int32_t il_fn_4(struct il_closure *cl, int32_t a0, int32_t a1);
static int32_t il_call(int32_t cv, int32_t a0, int32_t a1);   /* switch (fid) */
```

- `const`/`move`/`cmp`/`br`/`jmp`/`forprep`/`fornext` lower to assignments,
  comparisons and labels/gotos; the branch takes Lua's truthiness, the loops
  are Lua's integer-loop arithmetic (§5).
- `arith` keeps the IL's 32-bit wrapping in `uint32_t` arithmetic; `%` and
  `//` call small helpers that implement Lua's floor semantics, and shifts
  implement the IL's `n < 0 || n >= 32 → 0`.
- `call` is `il_call(callee, args…)`; a closure is a static slot per
  *closure instruction site*, with its captured values copied in when the
  instruction runs. Upvalue **writes** are refused (no `setupval` in part A),
  so copying is exact for these toys.
- The toy surface is direct: `pal`/`vset` become `toy_pal()`/`toy_vram_set()`,
  `rgb` becomes an inline function with the IL's `& 7` per channel, and
  `getglobal`/`setglobal` of `init`/`frame` are slots in `il_globals`.
- `fixed` is refused (a read of `frame`'s `t` is one of the refusals), which
  is why the runtime passes `t = 0`: the palette toy provably never reads it.

The runtime sets the VDC to viewer.asm's values — HSR `$0202`, HDR `$041F`,
VPR `$0F02`, VDW `$00EF`, VCR `$000C`, MWR 0 — and the VCE to the ÷4 dot
clock, zeroes VRAM (32768 words) and CRAM (512 entries) like
`pce-toyhost.js`, then runs the chunk, `init()`, and one `frame(f)` per
VBlank. The palette writes therefore land in VBlank, which is what the
browser's frame does before it renders that frame.

### 9.2 Cycles per frame, measured rather than estimated

The runtime brackets `toy_frame(f)` with reads of the HuC6280's **TMA timer**
(Mednafen's `huc6280.cpp` decrements it once per 1024 CPU clocks; the counter
is enabled at boot) and accumulates the tick deltas in BaseRAM `$2100`. The
save state carries the sum, count, min and max, so the capture reports the
toy's own cost as Mednafen ran it:

| quantity | measured |
|---|---|
| frames measured in the committed run | 469 |
| timer ticks, sum / mean | 3397 / **7.243** (each tick = 1024 clocks) |
| **cycles per frame** | **≈ 7,417** (min 7 ticks = 7,168, max 8 = 8,192) |
| share of a 60 Hz frame | ≈ **6.2 %** of 119,318 clocks (7.15909 MHz / 60) |

The measurement includes `toy_frame()`'s `il_call`, the 15 `rgb` + `toy_pal`
writes and the loop; it excludes the VBlank wait. The timer read costs a few
clocks inside the bracket. The quantisation is one tick; the mean is over 469
frames whose VBlank phase shifts by ~0.5 tick per frame, so the reported mean
is within a few tens of cycles, not ±1024.

### 9.3 Code size, and the evidence the ROM runs the same toy

The ROM is one 8 KiB fixed bank; llvm-mos's report for the committed build:

| item | bytes |
|---|---|
| ROM image | 8,192 |
| used `.text` / `.rodata` | 2,725 / 10 |
| `.data` (globals) / `.bss` (closures) | 8 / 43 |
| the toy's IL functions, total | 2,014 |
| — `il_fn_1` (puttile) / `il_fn_2` (init) / `il_fn_4` (frame) | 1,019 / 258 / 373 |
| — `il_fn_0` (chunk) / `il_fn_3` (the tile closure) / `il_call` | 97 / 37 / 230 |

`node tests/check-il-console.js` exits 0 with **47 checks**:

- the emitter is deterministic, emits `toy_boot`/`toy_frame`, lowers `pal`
  and `vset` to the runtime calls, and carries no floating-point type; the
  toy file is `tests/check-il.js`'s `TOY_PALETTE` byte for byte;
- **eight construct refusals come back by code** — `cgen-op`, `cgen-fixed`
  (twice), `cgen-hook`, `cgen-arity`, `cgen-closure-loop`, `cgen-global`,
  `cgen-key`, `cgen-target` — with the IL's source line in the message;
- the ROM rebuilds **byte-identically** to the committed dump
  (`tools/gen/toypalette.pce`, sha256 `c6296524…`, 8,192 B; the same SHA is in
  `tests/dumps/toypalette/meta.json`); without llvm-mos that one section
  prints SKIP (the `check-hutrack`/PCEAS rule);
- of the 149 recorded frames, the **last 8 are diff 0, in order, against the
  browser's frames 5..12** (`renderer/pce-toys.js`, the Fengari runtime), and
  exactly one alignment in 0..7 makes all eight match — the palette repeats
  every eight frames, so the phase is pinned by the pixels;
- the save's **vram, cram and sat are byte-equal** to the browser runtime's
  state at the aligned frame (65536 / 1024 / 512 bytes), and BXR/BYR/MWR are
  equal. CR is `$88` against the browser's `$80`: **bit 3 is the VBlank
  status enable**, which the console needs because Mednafen's
  `DoVBIRQTest` only sets the VBlank status bit when `CR & 0x08`. It does
  not affect the picture; the check asserts it is the only difference.

The frame flow is the browser's: the chunk, then `init()`, then one
`frame(f)` per VBlank. The console's picture is the same 256×224 window:
SLSTART=3 puts captured row 0 at VCE line 17, which is VDW line 0 for
VPR `$0F02`, so the crop and the browser's `scanline = 18` model agree
without a shift.

### 9.4 What part A refuses, and what it does not prove

`renderer/pce-cgen.js` refuses by code rather than guessing: `cgen-op` (any
instruction outside the palette toy's set — `reg`, `sat`, `sprite`, `raster`,
`print`, `vget`, tables, …), `cgen-fixed`, `cgen-cond`, `cgen-global`,
`cgen-arity` (more than two parameters/arguments), `cgen-hook` (no `frame`),
`cgen-closure-loop` (a closure created in a loop: part A has one static slot
per site), `cgen-key`, and `cgen-target`.

Not proven, written down:

- **Part A is one toy.** Nothing in §9 says the IL → C route handles the
  other #30 toys, the five example toys, or any toy beyond the palette one.
  Part C (§10) adds `raster()` through parallax.lua, but not sprites or
  pads; parts B (HuC) and D (the measured comparison sent to ppu.toys'
  author) remain.
- **No comparison of routes yet.** llvm-mos is the first route, not the
  chosen one; the note in `docs/PLAN.md` still requires measuring it against
  vendor/huc and a direct generator on the same toy.
- **Recursion is not guarded.** The dispatcher is a C call; a recursive toy
  would recurse on the console. The palette toy has no recursion, and a
  general backend must bound it.
- **One static closure slot per site.** Correct when the site runs once (the
  palette toy's chunk and `init`); a site executed repeatedly would reuse the
  slot.
- **t is always 0.** Any toy that reads `frame`'s fixed `t` is refused, so
  the console's `t` is never the browser's Q16.16 value.
- **No browser page** for the IL/console run; `renderer/toys.html` still runs
  the Fengari path.
- **Mednafen is the only witness.** No real console, no ares run of this ROM.
- **Rule 2 is owed.** The test and the emitter were written by the same seat
  that wrote the IL; a cold break by another session and model must try the
  emitter's arithmetic, its loop lowering and its refusals before the card's
  console half closes.

### 9.5 Two llvm-mos facts this part paid for

Both were found by measurement, and both are why the emitter's declarations
carry unusual attributes:

1. **A pointer to a `.zp.bss` object is materialised as its zero-page offset.**
   llvm-mos's PCE target places small static arrays in `.zp.bss`
   (`.zp` at $2020+); the console maps zero-page addressing to RAM
   `$2000+offset`, so *direct* accesses work, but taking the object's address
   produced `$0029`, not `$2029`. `il_call`'s `lda ($02),y` then read the
   closure's `fid` from the I/O page and every hook call returned 0 (measured:
   the ROM reached `toy_display_on` with CR `$88` and never wrote VRAM/CRAM).
   The fix is a section attribute: the closure array is in `.bss` and the
   globals in `.data`, at `$2208`/`$2200`, where pointers are real addresses.
2. **LTO scalarised the `int32_t` globals array into two byte globals in
   `.zp.bss`** and the generated store for `il_globals[1]` wrote the wrong
   byte (measured: `stx $204a` with X = 1 where the frame closure index is 2).
   The array is declared `volatile` and sectioned into `.data`; the rebuilt
   image stores 2 correctly.

Two console facts, not compiler bugs: a VRAM word must be written with **R02
(VWR) selected** after setting MAWR (viewer.asm's `st0 #$02`); without it the
data-port write lands back in MAWR. And the **VBlank status bit needs CR bit 3**
(§9.3), which is why the state comparison masks that one bit.

---

## 10. Part C of the console half: raster() on the console

The workshop's instruction for this part was explicit: compile the IL's
`raster(line)` hook into an IRQ1 handler driven by the VDC's RCR line
interrupt, reuse #16's proven blank budget (~100 CPU cycles, `viewer.asm`),
count the cycles, and **if the compiled handler cannot meet the blank, say so
with the measured cycles and propose the fix**. That is what happened.

The toy is **#29's `toys/parallax.lua`**: four 56-line bands, one `reg("BXR",
…)` on lines 0, 56, 112 and 168, and a frame number in the int global `g_f`.
It is also run frame for frame through the browser runtime
(`renderer/pce-toys.js`). `tools/build-toyc.sh` detects the emitted
`toy_raster` and compiles the runtime with `-DTOY_RASTER_BUILD`; a toy
without a callback does not carry the table or the IRQ handler (part A's
palette ROM stays byte-identical).

### 10.1 The compiled callback cannot be the interrupt handler, measured

The TMA timer brackets every `toy_raster(line)` call while the table is
built. Over the committed run (`tests/dumps/toyparallax`), **39,268 calls**
measured a mean of **1,510 cycles per call** (1.47 timer ticks, one tick per
1024 CPU clocks; the call includes the timer read, ~10 cycles). The call is
`il_call` → `il_fn_7`, the toy's callback: four `line == N` tests, a 32-bit
`//`, and `toy_reg`. The RCR write budget is **~123 CPU cycles** — 92 VDC
clocks between the match and the next line's display, as `viewer.asm` counts
it, i.e. slightly more than a hundred CPU cycles. A handler that simply
called the compiled callback would be **more than ten times over that
budget** before its first store, so `raster()` is not compiled into the
interrupt. (The number is a lower bound on such a handler: it excludes the
interrupt's own entry, status acknowledge and RCR re-arm.)

### 10.2 The fix: a table built ahead, a hand-written replay handler

This is #16's answer, applied to a compiled toy instead of a generated
table:

- **Collection.** The main loop calls `toy_raster(0..223)` with the host in a
  collecting mode. `toy_reg`/`toy_pal` write a per-line record in RAM
  instead of the VDC: op byte (BXR, BYR, CR, first colour, second colour)
  plus 14 page-aligned 256-byte arrays. The screen is not touched, so the
  video frame being computed stays static.
- **Replay.** A hand-written IRQ1 handler (`toy_runtime.c`, inline 6502) is
  the RCR chain. It saves A/X/Y (the C main loop is live between lines) and
  writes the line's entry: **BXR first** (measured: with the colour checks
  first, the boundary writes landed late by ~100 pixels and the band
  boundaries were one line off), then BYR, CR, then up to two colour words.
  RCR is re-armed last, with the **carry into bit 8** — the RCR is nine bits,
  and zeroing the high byte ended the chain at line 191 (measured; 0x40 +
  192 = 0x100).
- **Line 0** is applied by the main loop, in the VBlank before arming, and
  the chain starts at line 1. The VDC latches BYR for the first display line
  at the VDW entry, before the RCR match; a write in the interrupt is one
  line late for line 0. This was measured on `toys/status-bar.lua`, whose
  bar only appeared once entry 0 moved out of the chain.
- **The schedule** is two-phase per toy frame, paced by the VBlank interrupt
  counter: compute (frame(f) then all 224 calls), apply the base and line 0,
  arm at the next VBlank, then one video frame of replay. The collection
  measures **338,757 cycles = 2.84 video frames**, so one toy frame takes
  five video frames: **≈12–15 Hz**. The picture sequence is the browser's;
  only the rate differs.

The replay handler's own cost, counted from the linked image with the
HuC6280 opcode timings (`viewer.asm`'s rule: every memory instruction one
cycle over its 6502 count; `st0` 6), is **64 cycles from handler entry to
the BXR store's last byte** (saves 9, status and dispatch 20, the BXR path
35) — ~71 from the RCR match including the interrupt sequence, inside the
~123-cycle blank. A second register in the same entry adds 35 cycles (99
total), and the two colour words go after the registers and are the case
that does not fit; parallax uses one register and no colour in the chain.

### 10.3 What the evidence shows

`node tests/check-il-console.js` exits 0 with **116 checks** (parts A and C):

- the palette toy's ROM still rebuilds byte-identically (`c6296524…`,
  8,192 B) — the raster machinery is compiled out of it;
- the parallax ROM rebuilds byte-identically (sha in
  `tests/dumps/toyparallax/meta.json`), 8,192 B, used `.text` 7,325 B +
  `early_start` 825 B + vector 10 B; the table, the handler and the toy's
  IL functions all fit the 8 KiB fixed bank;
- **40 consecutive display frames are diff 0** against the browser's frames
  f135..f174, one every five captured frames (the other four are the compute
  period's static frame, which the comparison ignores — it is not a wrong
  picture, it is the rate);
- the save's `vram`, `cram` and `sat` are byte-equal to the browser's at the
  last matched frame, BYR/MWR are equal, CR is the browser's with bits 3 and
  2 (VBlank status and scanline interrupt) set, and BXR is the displayed
  frame's last-line value (or the next frame's line-0 write, if the save
  caught the compute);
- the emitter lowers `reg` to `toy_reg()` with a register id, an int global
  to a C slot the frame and the callback share, and the raster hook to
  `toy_raster(line)`; the refusals still come back by code (`cgen-op` for
  sprites/pads, `cgen-arity` at five parameters, `cgen-closure-loop` when a
  function value can escape, `cgen-global` for a pad global);
- the measurements are read from the save's RAM and reported: frame()
  **1,204 cycles**, one raster call **1,510 cycles**, one collection
  **338,757 cycles**, and the flags byte is 0 (no list overflow, no `vset`
  from a callback).

### 10.4 What part C refuses, and what it does not prove

Refused by code rather than guessed: `reg` names outside BXR/BYR/CR
(`cgen-op`); sprite/pad/table/print/vget still (`cgen-op`/`cgen-global`);
more than four parameters (`cgen-arity`); a raster hook that is not one int
parameter (`cgen-hook`); a closure inside a loop when a function value can
be stored — returned, written to a function-typed global outside the chunk,
or into an upvalue/table (`cgen-closure-loop`). `fixed` is still refused.

Runtime limits, not compile-time refusals: at most **2 colour writes per
raster line** and **32 colour/VRAM writes per `frame()`** (the flags byte
records an overflow); a `vset` from a raster callback is dropped and flagged
(bit 2) because VRAM is fetched as the line draws; a base write made by
`frame()` reaches the VDC at the next VBlank (it is captured, not applied
while the display runs).

**Not proven:**

- **Two of the three named toys.** `toys/status-bar.lua` gets its bar right
  but its scrolled playfield is four lines out of phase against the browser;
  #30's `TOY_RASTER` (per-line BXR plus a palette write every 8 lines) does
  not match across the whole picture. Both are measured failures, left
  recorded here rather than hidden; parallax is the committed evidence.
- **The rate.** ~12–15 Hz, not 60. The toy's own raster work is 2.84 video
  frames; a 60 Hz toy must keep its callback under ~500 cycles a call, and
  the IL → C route is far from that for this toy. Pricing it is #32's job.
- **Mednafen is the only witness**, and the line-0 BYR latch and the RCR
  match timing are Mednafen's behaviour; no console run yet.
- **The direct-ISR measurement is of the callback**, not of a built
  interrupt handler; the compiler-in-ISR route was rejected on the measured
  call cost plus the interrupt's own overhead.
- **Rule 2 is owed**: the test and the runtime were written by the same seat
  that wrote the emitter; a cold break of the RCR chain, the table and the
  schedule (and a cold look at the pictures) is required before the card's
  console half closes.

### 10.5 Three facts this part paid for

1. **The hook's first argument is `line`.** `toy_frame` passes `(t, f)` as
   `(a0, a1)`, and the first version of `toy_raster` copied that shape and
   passed `(0, line)`. Every call then saw `line == 0`, wrote BXR=0 on all
   224 lines, and the table looked plausible while the picture was wrong.
2. **The RCR is nine bits.** `0x40 + line` overflows at line 192; the
   handler's `stz` of the high byte made the chain die at line 191 — the
   first band worked and the rest of the screen kept the last value.
3. **A 16-bit VBlank counter tears against the interrupt's increment.** A
   skipped wait started the next collection during the display it had just
   armed; one video frame in ten mixed two collections (band 0 from the next
   frame, the other bands from the last). An 8-bit counter cannot tear, and
   the collection now waits out the display frame.

---

## 11. Part B of the console half: the same IL through HuC

Part A answered "can the IL become machine code at all" with llvm-mos. Part B
answers the card's other question: the **same IL through HuC** — vendor/huc's
own C compiler and PCEAS (`vendor/huc/VENDORED.md`), built as an external
tool under `/Volumes/External II/pce-tools/huc-toyc` — on the same two toys,
compared with the browser the same way. The front end and every IL→C rule are
shared; only the C dialect and the runtime are different.

### The pieces

| file | what it is |
|---|---|
| `renderer/pce-cgen.js` | the emitter gains `emitC(program, {target: "huc"})`. The default (`"llvm"`) output is byte-identical to parts A/C, so their committed ROMs still rebuild. |
| `tools/build-huc.sh` | toy → IL → HuC C → one translation unit → `huc -S` → PCEAS with the handler → `<name>-huc.pce` + a JSON report (sha, banks, section bytes, function bytes, build seconds). |
| `tools/toyc/huc_runtime.c/.h` | the console side in HuC C: VDC/VCE setup, zeroed VRAM/CRAM/SAT, the toy surface (`toy_pal`, `toy_reg`, `toy_vram_set`, `toy_rgb`), the frame flow and the TMA timer sums. |
| `tools/toyc/huc_raster.asm` | part C's replay handler, verbatim in behaviour, as a PCEAS file in bank 0 (see §11.2). |
| `tools/capture-huc.sh` | the capture route of `tools/capture-toy.sh`: Mednafen's command line, every video frame, the autosave, `mcs-extract --ram`. |
| `tests/check-il-huc.js` | part B's evidence (§11.4). |

### 11.1 What HuC's C cannot express, found by compiling

Each of these was a compile error or a wrong picture before the emitter
changed; the dialect is the minimum that compiles and keeps the IL's meaning.

1. **There is no 32-bit type at all.** HuC's `int` is 16 bits (`src/huc/defs.h`,
   `INTSIZE 2`); `int32_t`, `uint32_t` and `int16_t` do not exist. The emitter
   emits `int`, and an int constant is truncated to its low 16 bits (signed
   decimal) at emission — exact for both toys, whose values are far below
   65536. The shift helpers test the dialect's width (`n >= 16 → 0`).
2. **A local array cannot be initialised** (`int r[4] = { 0 };` is "cannot
   parse initializer"). The IL's reference interpreter starts every register
   at 0, so the emitter runs a linear read-before-write pass per function and
   emits `r[i] = 0;` for exactly those registers. The two toys need it (the
   palette toy's first frame does), so the pass is exercised, not assumed.
3. **No block scope, and declarations must precede statements.** Two `for`
   loops in one function cannot both declare `st` ("already defined"), and a
   declaration after a statement is not a declaration. Loop temporaries are
   named after their instruction (`st_43`) and hoisted to the top of the
   function.
4. **No `__attribute__`, no sections, no `noinline`.** Part A's two llvm-mos
   workarounds (the pointer-to-`.zp.bss` and the LTO-scalarised globals,
   §9.5) simply do not exist here: the arrays are ordinary BaseRAM objects
   and HuC does not optimise them away.
5. **One C file per compile.** HuC has no separate compilation for user code;
   `tools/build-huc.sh` concatenates the generated C and the runtime into one
   translation unit. HuC's `huc.h` also has **no include guard**, so it is
   included exactly once from that unit.
6. **A quoted `#include` is resolved against the current directory, not the C
   file's directory**, so the compile runs in `tools/gen` where the header is
   copied.

### 11.2 The runtime, and part C's handler reused

`huc_raster.asm` is part C's handler (§10.2) as a standalone file: same op
byte (bit 0 BXR, 1 BYR, 2 CR, 3/4 colour words), same order (BXR first, colour
words after the registers, RCR re-armed last), same nine-bit RCR carry. What
had to change is where it lives and how it is entered:

- It is placed with `.bank 0` **after HuC's startup and base library**, so
  PCEAS appends it to bank 0's free tail ($FC1C in the committed palette
  build ends the startup); bank 0 is always mapped, so the handler runs
  whatever bank the C main loop is in. There is no fixed `.org` to collide
  with a library change — the assembler decides, and an overflow is a loud
  build error.
- HuC's own IRQ1 entry is `irq1: bbs1 <irq_m,user_irq1`, i.e. it jumps
  through `irq1_jmp` ($2202) **before saving registers**. So the handler saves
  A/X/Y itself, reads $0000 to acknowledge, and owns every VDC interrupt.
  Installation is three instructions (`_huc_irq_install`): write the handler's
  address to $2202 and set bit 1 of `irq_m` ($20F5).
- The tables are ordinary C arrays (`volatile char toy_r_op[256]`, …). They
  are not page-aligned, so an `lda abs,X` may cross a page and cost one extra
  cycle; part C's page alignment was a cycle-budget choice, not a correctness
  one.

**The palette toy had to borrow part C's deferred base.** HuC's `frame()` for
the palette toy measures **102,123 cycles**, 86 % of a 60 Hz video frame.
Writing 15 palette entries that slowly during the display paints a visible
split down the picture (measured: a band of the previous frame's colours at
the top; the direct part A flow is 7,417 cycles and lands in the blank). The
runtime therefore runs `frame()` while the display shows the last frame
(`MODE_BASE`, capturing the ~15 colour words), waits for VBlank, and applies
them there — part C's mechanism, extended to the non-raster toy. The captured
pictures then match the browser exactly (§11.4).

### 11.3 Measurements

Both toys, both routes, same capture route and timer:

| | palette (HuC) | parallax (HuC) |
|---|---|---|
| ROM image | **57,856 B** (7 HuCARD banks) | **66,048 B** (8 banks) |
| CODE bytes (all banks) | 22,925 | 28,552 |
| the toy's IL functions | **3,822 B** (fn0..fn4: 154/2,159/666/269/574) | **7,277 B** (fn0..fn7: 303/2,208/712/2,404/180/366/117/987) |
| `frame()` | **102,123 cycles** | **2,926 cycles** |
| one `raster()` call | — | **3,728 cycles** |
| one 224-call collection | — | **835,048 cycles = 7.00 video frames** |
| toy frame rate | one per video frame | one per ~12.5 video frames (~**4.8 Hz**) |
| build (emit + huc + pceas, wall) | ≈ 0.22 s | ≈ 0.24 s |

The HuC card is 7–8 banks because HuC's startup and base libraries alone fill
banks 0 and 1; user code spills into 8 KiB banks. The IL functions are 2.1×
(palette) and 1.6× (parallax) llvm-mos's, and `frame()` 13.8× and 2.4× slower
— Small-C's stack-based code, no register allocation, one helper call per
operation. The raster callback is 2.5× slower than llvm-mos's, which pushes
the collection from 2.84 to 7.0 video frames.

### 11.4 Evidence

`node tests/check-il-huc.js` exits 0 with **74 checks**:

- the HuC dialect: deterministic; no `int32_t`/`uint32_t`/`<stdint.h>`/
  `__attribute__`; `int f` entry points; loop temporaries hoisted; zero stores
  exactly where a register can be read first; the default dialect still
  emits llvm-mos's `int32_t` C; the refusals still come back by code
  (`cgen-op`, `cgen-fixed`, `cgen-hook`, `cgen-arity`).
- the ROMs rebuild **byte-identically** to the committed dumps
  (`tools/gen/palette-huc.pce`, `parallax-huc.pce`; shas in the dumps'
  `meta.json`) — without HuC the rebuild prints SKIP, the PCEAS/llvm rule.
- **the palette toy is the browser's**: 32 captured frames match, with a run
  of 8 consecutive browser frames each a full pixel **diff 0** across the
  colour cycle; vram/cram/sat are byte-equal to the browser's at the matched
  frame.
- **`raster()` is the browser's**: 20 captured frames match and form a run of
  **20 consecutive browser frames**, each diff 0; vram/cram/sat byte-equal;
  BYR/MWR equal; CR is the browser's with only VC/RC set (as part C); the
  console-side flags byte is 0 (no list overflow, no `vset` from a callback).
- the timer measurements are read from the save's RAM and reported (the
  numbers of §11.3).

### 11.5 Four facts this part paid for

1. **VCE colour data is at $0404/$0405, not $0403.** The first run showed a
   solid backdrop while VRAM was already byte-equal to the browser's: the
   runtime wrote the colour **address** high byte where the colour **data**
   belonged. CRAM, not VRAM, was the tell.
2. **The palette split.** §11.2's deferred base exists because the direct
   flow at 102,123 cycles visibly paints the previous palette down the top of
   the frame; the browser model has no mid-frame palette timing, so the
   pictures could never match without holding the writes to VBlank.
3. **`peek` passes its argument in AX.** Declaring it with HuC's `#pragma
   fastcall peek(word __bx)` makes the compiler call the undefined `_peek.1`;
   an ordinary declaration compiles to `__ldwi addr / call _peek`, which is
   what `huc_misc.asm`'s `_peek` expects.
4. **`.bank 0` appends.** PCEAS keeps a location counter per bank, so a second
   input file that switches to bank 0 lands after the startup/library instead
   of overwriting it (measured: `_huc_irq1` at $FC24 in the palette build).

### 11.6 What part B refuses, and what it does not prove

The **same** IL constructs are refused as in parts A/C, by the same codes —
the dialect does not widen the subset. It narrows it in one way:

- **16-bit values only.** A constant outside −32768..65535 is refused
  `cgen-width` rather than truncated. A value in 32768..65535 keeps its
  16-bit bit pattern (both toys build words up to 0xFFFF) but a *comparison*,
  `//` or `%` on it runs signed in HuC where the IL's 32-bit int is positive
  — the toys never compare those words, and the emitter does not yet refuse
  such a comparison. Computed values can also overflow 16 bits silently;
  neither toy does.

Not proven:

- **Two toys.** Sprites, pads, tables, strings, `note`, fixed point and the
  five #29 examples are still refused or untested on this route.
- **The rate is 4.8 Hz on the raster toy**, so part B is a feasibility and
  cost result, not a 60 Hz route.
- **Mednafen is the only witness**, as for parts A/C; no console, no ares.
- **The interrupt path is part C's behaviour, not a second measurement**: the
  handler's own cost is counted from the source (64 cycles to the BXR store,
  §10.2) and is the same code.
- **Rule 2 is owed.** The test and the runtime were written by the same seat;
  a cold break of the dialect, the bank-0 placement, the IRQ hook and the
  deferred base is required before the card's console half closes.

---

## 12. Part D: the routes side by side

The card asked for one table on the same two toys, measured, not estimated.
Every number below is from the committed captures (`tests/dumps/toypalette`,
`toyparallax`, `palette-huc`, `parallax-huc`) and the two build reports.

| | llvm-mos (parts A/C) | HuC (part B) |
|---|---|---|
| palette ROM | **8,192 B**, one fixed bank | **57,856 B**, 7 banks |
| palette code size | `.text` 2,725 + `.rodata` 10 | CODE 22,925 (incl. HuC startup/library) |
| palette toy IL functions | **1,784 B** (+ `il_call` 230) | **3,822 B** |
| palette `frame()` | **7,417 cycles** (6 % of a frame) | **102,123 cycles** (86 %) |
| palette flow | direct in VBlank | deferred base (§11.2) |
| parallax ROM | **8,192 B**, one fixed bank | **66,048 B**, 8 banks |
| parallax code size | `.text` 7,325 + `early_start` 825 + vector 10 | CODE 28,552 |
| parallax toy IL functions | **4,541 B** | **7,277 B** |
| parallax `frame()` | **1,204 cycles** | **2,926 cycles** |
| one `raster()` call | **1,510 cycles** | **3,728 cycles** |
| one 224-call collection | **338,757 cycles** (2.84 frames) | **835,048 cycles** (7.00 frames) |
| toy frame rate (raster) | one per ~5 video frames (~12 Hz) | one per ~12.5 (~4.8 Hz) |
| build wall time (both toys) | 0.41–0.44 s | 0.22–0.24 s |
| what it cannot compile | fixed point, sprites, pads, tables, strings, >4 parameters, a closure that escapes; 32-bit ints are exact | all of the above, **and any value wider than 16 bits**; the same refusal codes |
| picture vs browser | diff 0, 8 (palette) and 40 (raster) frames | diff 0, 8 and 20 frames |

**What the table says.** llvm-mos is a modern optimising compiler and HuC is
Small-C: the IL functions are 1.6–2.1× larger under HuC, `frame()` is 2.4×
slower on the raster toy and **13.8×** slower on the palette loop (whose
per-iteration work is a few arithmetic operations — exactly where Small-C's
one-helper-call-per-operation shows), a `raster()` call is 2.5× slower, and
the RCR chain therefore takes 7 video frames instead of 2.84. The ROM cannot
stay in one bank with HuC: its startup and base libraries fill two banks
before the toy's code starts, so the card is 7–8 banks. HuC builds faster
(0.22 s vs 0.41 s) and its C is the more familiar language, but it wins on no
measured axis that matters to a toy. **The llvm-mos route stays the one the
console export uses**; the HuC route is proven as a second witness that the
IL is backend-independent — the same IL, the same refusals, the same
pictures — and as the measured answer to "what would HuC cost?".

### The paragraph for ppu.toys' author

> The toy's Lua lowers to one small typed IL (init/frame/raster explicit,
> ints, bools, fixed point) and every analysis and both back ends work on
> that IL, as you suggested. For the PC Engine we compiled the same IL two
> ways. Through llvm-mos's PCE target, the palette toy's `frame()` is 7,417
> cycles (6 % of a frame) and the parallax toy's `raster()` callback 1,510
> cycles, with 8 KiB ROMs. Through HuC — the maintained pce-devel C compiler,
> Small-C under the hood — the same toys are correct pixel for pixel in
> Mednafen, but the IL functions are ~2× larger, `frame()` is 2.4–13.8×
> slower, a `raster()` call 2.5×, and HuC's runtime libraries push the card
> from 1 bank to 7–8. The interesting part for you is that nothing in the IL
> had to change: the only backend-specific work was the C dialect
> (16-bit int, no initialiser lists) and the RCR handler, which is the same
> hand-written table replay in both. If your IL has a typed, explicit-hook
> shape, a second backend is a dialect plus a runtime, not a rewrite.

---

## 13. Not proven, and the next half

- **All four parts of the console half exist; not every toy.** The palette
  toy runs through IL → C → llvm-mos (§9) and through the same IL → C → HuC
  (§11), and `toys/parallax.lua`'s `raster()` runs on both routes through
  the table and RCR chain (§10, §11.2); §12 measures them side by side.
  Sprites and pads are still refused, `status-bar.lua` and #30's
  `TOY_RASTER` do not match (§10.4), and a direct HuC6280 generator was not
  built — the card's part D asked for llvm-mos vs HuC, which is what §12
  has. No backend choice is baked into the IL: the types, the explicit
  surface instructions and the line info are the parts every backend reads.
- **No browser page for the IL yet.** The interpreter runs in Node and in a
  browser via the same UMD pattern; `renderer/toys.html` still runs the
  Fengari path. Wiring a "compile to IL" run into the page is worth doing when
  a backend gives it something to show.
- **The subset is narrower than Lua, on purpose**, and §7 names every hole.
  The ones a toy author is most likely to meet: strings as values, `#t`,
  `pairs`, `a:b()`, `^`, and reading a table back after building it.
- **Fixed point is Q16.16, quantised per operation**, not Lua's double. The
  three toys do not exercise it; a toy that uses `t` or fractions will differ
  from the browser's Lua in the low bits. That is a design decision for the
  console, not an accident.
- **Linear typing.** The typer is a forward pass, not an SSA reconstruction
  (§6). Path-sensitive values are #32's job; the IL exposes per-instruction
  types so it can do that.
- **The wall.** The interpreter is a JS reference, not a performance model:
  `toy-timeout` counts IL instructions, not console cycles. Pricing the IL is
  #32 — `renderer/pce-validate.js` and `docs/VALIDATE.md`.

---

## 14. Route 1: the IL as bytecode, interpreted on the console (#100)

Parts A–D answer "what does compiling the IL cost". Route 1 asks a different
question: can the **browser export a working ROM with no compiler at all** —
the toy's IL encoded as bytecode, plus an interpreter we build once and commit?
This half delivers the encoding, the interpreter, the browser glue, and the
two named toys measured in Mednafen. The studio's Export button is the second
half.

```
toy.lua --(pce-il.js)--> IL --(pce-ilbc.js)--> bytecode --(pce-rom.js)--> .pce
                                                            + renderer/ilvm.bin
```

### 14.1 The container

`renderer/pce-ilbc.js` encodes a `pce-il` version 1 program into one container
that fits in a single 8 KiB data bank. All offsets are byte offsets from the
start of the container. Little-endian.

| offset | size | field |
|---|---|---|
| 0 | 4 | `"ILBC"` |
| 4 | 1 | version (1) |
| 5 | 1 | flags — bit 0: the toy has a `raster()` callback |
| 6 | 1 | `init` slot (0xFF = none) |
| 7 | 1 | `frame` slot |
| 8 | 1 | `raster` slot |
| 9 | 1 | function count |
| 10 | 1 | global count |
| 11 | 1 | constant count |
| 12 | 2 | function table offset |
| 14 | 2 | upvalue descriptor table offset |
| 16 | 2 | constant table offset |
| 18 | 2 | global name table offset |
| 20 | 2 | first instruction |
| 22 | 2 | one past the last instruction |

A **function entry** (10 bytes, one per function id in order) is
`codeOff u16, codeEnd u16, upOff u16, nregs u8, nparams u8, nups u8, reserved
u8`. Each **upvalue descriptor** is `kind u8, index u8`: 0 captures the
parent register, 1 the parent's upvalue, 2 is `_ENV` (a name, never a value).
A **constant** is `type u8` (0 int, 1 bool, 2 string, 3 nil) then four
little-endian bytes for an int, one for a bool, `length u8 + bytes` for a
string, nothing for nil. A **global** is `length u8 + bytes`; instructions use
the global's index, so no name is compared at run time.

An **operand byte** is `0x00..0x7F` a register, `0x80..0xFE` constant
`byte & 0x7F` (at most 127 constants), `0xFF` none. Jump targets are absolute
container offsets, patched after the layout is known.

| op | instruction | bytes after the opcode |
|---|---|---|
| 01 | `const` | `dst:r k:u8` |
| 02 | `move` | `dst:r src:op` |
| 03 | `getglobal` | `dst:r g:u8` |
| 04 | `setglobal` | `g:u8 src:op` |
| 05 | `getupval` | `dst:r idx:u8` |
| 06 | `setupval` | `idx:u8 src:op` |
| 07 | `closure` | `dst:r fid:u8` |
| 08 | `call` | `dst:op callee:op n:u8 args[n]:op` |
| 09 | `ret` | `src:op` |
| 0A | `jmp` | `target:u16` |
| 0B | `br` | `cond:op when:u8 target:u16` |
| 0C | `forprep` | `base:u8` |
| 0D | `fornext` | `base:u8 target:u16` |
| 0E | `arith` | `op:u8 dst:r a:op b:op` |
| 0F | `unm` | `dst:r a:op` |
| 10 | `bnot` | `dst:r a:op` |
| 12 | `cmp` | `op:u8 dst:r a:op b:op` |
| 13 | `builtin` | `id:u8 dst:r n:u8 args[n]:op` |
| 14 | `pal` | `addr:op word:op` |
| 15 | `reg` | `regid:u8 value:op` |
| 16 | `vset` | `addr:op word:op` |
| 17 | `vget` | reserved; the encoder refuses it in this half |

`arith` ops are 0 add, 1 sub, 2 mul, 3 mod, 4 idiv, 5 band, 6 bor, 7 bxor,
8 shl, 9 shr; `cmp` ops are 0 eq, 1 lt, 2 le; `reg` ids are 0 BXR, 1 BYR,
2 CR; builtin 0 is `rgb` (the only one the interpreter implements).

The hooks are **global slots**, not function ids: the chunk stores a closure
in `init`, `frame` or `raster`, and the runtime calls whatever is there —
exactly what the C backend's `toy_boot`/`toy_frame` do (§9.1).

The encoder **refuses by code rather than guessing**, with the same spirit as
`pce-cgen.js`: `ilbc-op` (tables, sprites, pads, `print`, `music`, `vget`,
`not`, …), `ilbc-fixed` (fixed-point arithmetic or constants),
`ilbc-builtin` (a builtin other than `rgb`), `ilbc-arity` (more than four
parameters or arguments), `ilbc-range` (more than 127 constants, 128
registers or 32 globals), `ilbc-jump`, `ilbc-key`, `ilbc-program`.

### 14.2 The interpreter image (`renderer/ilvm.bin`)

`tools/ilvm/ilvm.c` is the bytecode loop; `tools/ilvm/ilvm_runtime.c` is
`tools/toyc/toy_runtime.c` — the VDC/VCE setup, the zeroed VRAM/CRAM/SAT, the
RCR table replay, the TMA timer — with the frame flow adjusted for an
interpreted toy (§14.3). Both are built **once** by `tools/ilvm/build.sh`:

```
mos-pce-clang -Os -Wl,--defsym,__rom_bank0=0xc000 \
                    -Wl,--defsym,__rom_bank0_size=0x4000 ...
```

llvm-mos's PCE platform places a fixed ROM of up to 48 KiB at `$C000-$FFFF`
(MPR2–MPR7; `__start_bank_6` is 1 for a 16 KiB fixed image, so crt0 sets
MPR6). The image is **two physical banks**:

- bank 0 (`$E000-$FFFF`): vectors, crt0, the runtime;
- bank 1 (`$C000-$DFFF`): the interpreter (`exec` 6,010 B of the 16 KiB).

The toy's container is **physical bank 2**, and `ilvm.c` maps it into the
MPR2 window (`$4000-$5FFF`) with `TAM #$04` at boot. The image is committed
as `renderer/ilvm.bin` (16,384 B, sha256 in `tools/gen/ilvm.json`), like
`renderer/viewer-bank0.bin`; the browser never invokes a compiler.

Register-file semantics mirror `pce-cgen.js`: 32-bit wrapping `add/sub/mul`,
Lua's floor `%` and `//`, shifts out of range 0, Lua truthiness for `br`,
`forprep` subtracts the step and `fornext` adds it and compares with the
step's sign. A call is C recursion over a bytecode function (the toys' trees
are shallow); closures are 32 slots of `{fid, up[6]}`, allocated round-robin,
with upvalues copied at creation (the toys have no `setupval`, as part A
assumed).

Measured sizes: the image is 16,384 B (the linker fills the fixed region),
`.bss` 5,607 B; `exec` 6,012 B, `main` 2,321 B, `toy_frame` 198 B.

### 14.3 The console frame flow

A compiled `frame()` is 7,417 cycles and lands in the VBlank. An interpreted
one is **238,988 cycles** (measured, below): it runs for two video frames. The
runtime therefore defers a no-raster toy's writes exactly as part B's HuC
runtime does for the palette toy (§11.2): `frame(f)` runs in `MODE_BASE`
during the display, and its palette/VRAM/register writes are applied in the
next VBlank. The picture sequence is the browser's, one frame later.

The loop is paced by the VBlank IRQ's counter, not by polling the status
register: the measurement reconstructs a multi-frame `frame()` from that
counter, and one reader of the status keeps both uses exact. The first version
took the counter before `frame()`, so a frame spanning several VBlanks left it
stale and the base was applied **mid-display** — measured as a palette change
at captured row 177. Re-reading the counter before each wait fixed it; the
captured run afterwards has no torn frames.

The toy's own `raster()` path is unchanged from #31 part C: the interpreter's
224 calls fill the line table, the hand-written RCR handler replays it, and
one toy frame is a collection plus a displayed frame. The interpreter makes
each call slower, so the rate drops (measured below), but the picture is the
browser's.

### 14.4 The browser glue

`renderer/pce-rom.js`'s new `buildToyRom({bank0, bytecode, assets})` is a pure
function: it validates the 16 KiB image, the `ILBC` magic and the data-bank
size, and returns `bank0 + one 8 KiB bank` (bytecode at offset 16,384,
optional assets after it, `0xFF` padding). The page loads `ilvm.bin` the way
it loads `viewer-bank0.bin`. Node and a browser context (`self`, no `module`)
build the same bytes — tested byte for byte.

### 14.5 Evidence

`tools/ilvm/emit.js` is the browser's code path in Node: `pce-il.js` →
`pce-ilbc.js` → `pce-rom.js`, **no compiler**. `tools/capture-ilvm.sh` builds
that way and runs the result in Mednafen with `tools/capture-toy.sh`'s command
line, crop and timer read.

| | palette (`tools/toys/palette.lua`) | parallax (`toys/parallax.lua`) |
|---|---|---|
| ROM | 24,576 B (3 physical banks) | 24,576 B |
| bytecode | 578 B | 1,100 B |
| code bytes in the container | 405 | 850 |
| `frame()` | **238,988 cycles** (2.0 video frames) | **5,657 cycles** (0.05 frames) |
| one `raster()` call | — | **36,072 cycles** |
| one 224-call collection | — | **8,157,505 cycles** (68.4 frames) |
| toy frame rate | one per ~3 video frames (~20 Hz) | one per ~69 video frames (~0.87 Hz) |
| picture vs browser | diff 0 | diff 0 |

Set beside §12's compiled numbers, the interpreter costs **32x** the compiled
palette `frame()` (238,988 vs 7,417 cycles), **4.7x** the compiled parallax
`frame()` (5,657 vs 1,204), **24x** a compiled `raster()` call (36,072 vs
1,510) and **24x** the collection (8,157,505 vs 338,757), which puts the
raster toy at 0.87 Hz against the compiled route's ~12 Hz.  The bytecode is
578 B (palette) and 1,100 B (parallax) against 1,784 B and 4,541 B of
compiled IL functions.  Route 1 trades that speed for a ROM the browser can
build with no compiler; route 2 (#101) is the direct generator that keeps
the speed.

The timer measurement is VBlank-aware. The TMA counter is seven bits, so a
delta past 128 ticks (131,072 CPU clocks) wraps: the first run read the real
~240,000-cycle frame as 30 ticks. The VBlank IRQ now records the timer value
at each VBlank, so the measurement knows the phase within the 116.5-tick
(119,318 CPU clock) frame: elapsed = frames x 116.5 + (phase at end - phase
at start). A bracket that spans no VBlank is exact as measured, and that
covers every `raster()` call. The figure includes the VBlank IRQ's few cycles
per frame and is quantised to one tick. The per-frame maximum is clamped at
255 ticks in the byte-wide save-state cell; the mean is not clamped.

`node tests/check-ilvm.js` exits 0 with **49 checks**: the encoder is
deterministic and refuses by code (table, fixed constant, five parameters,
`clamp`); Node and a browser context build the same 24,576 B ROM; the
committed `renderer/ilvm.bin` rebuilds byte-identically when llvm-mos is
present (SKIP otherwise); both dumps' ROM shas match a fresh
`tools/ilvm/emit.js` build; the palette capture's frames are diff 0 against
the browser's run with eight consecutive browser frames present in order,
and the save's VRAM/CRAM are the browser's; the parallax capture holds 30
exact display frames (a run of eight in order) among the static compute
frames, and its save is the browser's.  The check script was written by the
seat that wrote the encoder and interpreter, so rule 2 is owed.

### 14.6 What this half refuses, and what it does not prove

The interpreter implements the instruction set above and nothing else; the
encoder refuses the rest, so no ROM silently runs a different toy. In
particular vget, `not`, tables, sprites, pads, `print`, music/SFX, fixed point
and the other builtins are not in route 1 yet.

Not proven:

- **Two toys.** The palette toy (no callback) and `parallax.lua` (one register
  write on four lines) are the evidence. #30's third toy (sprites + pad),
  `status-bar.lua` (its compiled route was already four lines out of phase,
  §10.4) and the #29 examples are untested.
- **No real console and one emulator.** Mednafen only; no ares run of a
  bytecode ROM yet.
- **Rule 2 is owed.** The encoder, interpreter, runtime and the check script
  were written by the same seat; a cold break by another seat and model must
  try the operand encoding, the loop arithmetic, the closure copies, the timer
  reconstruction and the browser glue before this half closes.
- **The studio's Export button is not wired.** The second half adds it; this
  half's evidence is the Node path and the browser-context byte equality.
