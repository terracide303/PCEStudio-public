# The IL — PCEStudio's intermediate language (#31)

**One page per question, measured where it can be.** This document defines the
IL a toy is lowered to, the types it carries, what each Lua construct becomes,
and what is refused. The pipeline is the one ppu.toys' author described
(`docs/PPU-TOYS.md`):

```
toy.lua --(Fengari's parser, the browser's own Lua)--> Lua 5.3 bytecode
        --(renderer/pce-il.js, the lowerer)---------->  PCEStudio IL
        --(#32: analysis)--------------------------->  HuC6280 code
        --(renderer/pce-cgen.js, part A, §9)------->  C -> llvm-mos -> .pce
```

The IL is where the validator (#32) will count cycles per frame, sprites per
line and memory, and where `raster()` is checked against the line budget. The
first half delivered the IL, the lowering, and a reference interpreter that
runs it over the same host and the same models as the browser runtime (`#30`).
Part A of the console half (§9) delivers the first backend: the palette toy
through the same IL → C → llvm-mos → a HuCard ROM → Mednafen.

- `docs/IL.md` — this file: the instructions, the types, the lowering table,
  the refusals, and part A's backend.
- `renderer/pce-il.js` — `compile(source)` → the IL program; `create(source)`
  → a runtime with `load()`, `frame(f)`, `setPad()`, the same shape as
  `renderer/pce-toys.js`.
- `renderer/pce-toyhost.js` — the toy's hardware host, extracted so both front
  ends use one copy (the surface, the ranges, the raster table, the pads, the
  frame flow).
- `renderer/pce-cgen.js` — part A's `emitC(program)` → C (refusals by code).
- `tools/build-toyc.sh` — Lua toy → IL → C → `mos-pce-clang -Os` → `.pce`.
- `tools/capture-toy.sh` — build, run in Mednafen, harvest the state and every
  frame.
- `tests/check-il.js` — the IL half's evidence (§8).
- `tests/check-il-console.js` — part A's evidence (§9).

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
| `vget` / `vset` | `dst`, `addr` / `addr`, `word` | `int` | read/write a VRAM word |
| `padref` | `dst`, `n` | `int` → `pad` | `pad[n]` |
| `padget` | `dst`, `pad`, `field` | `pad` → `bool` | `pad[n].right` etc. |
| `builtin` | `name`, `dst?`, `args[]` | numeric helpers | `rgb clamp min max floor abs lerp ramp ramp_int sin cos sqrt` |

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
Part A is deliberately one toy and one backend; the comparison of routes
(llvm-mos vs HuC vs a direct HuC6280 generator), `raster()` on the console and
the analysis of #32 are later parts.

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

- **One toy, one backend.** Nothing here says the IL → C route handles the
  other #30 toys (`raster()`, sprites, pads), the five example toys, or any
  toy beyond the palette one. Parts B (HuC) and C (`raster()` on the console)
  come next; part D is the measured comparison sent to ppu.toys' author.
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

## 10. Not proven, and the next half

- **Only part A of the machine code exists.** The palette toy runs on the
  console through IL → C → llvm-mos (§9); the other toys, `raster()`, sprites
  and pads do not. The HuC route, a direct HuC6280 generator, and their
  measured comparison are still the card's next part. No backend choice is
  baked into the IL: the types, the explicit surface instructions and the
  line info are the parts every backend reads.
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
  #32.
