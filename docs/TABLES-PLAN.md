# Tables on the console — the plan (#170, umbrella #132)

Dennis, 2026-10-31: *"be sure to use cheap agents where possible.... add cards
where needed"* and *"can you do this autonomous"* — the export of real games,
so their speed can be measured.

**Planning only.** Nothing in this document is built. It answers three
questions — what STARFALL, TOWER and NOVA TIDE actually need from tables; how
the console should carry them; and in what order the work should be done — and
it splits the work into eight ~S cards (#171–#178) that a cheap model can
finish one at a time. #132 stays open as the umbrella and closes when its
children do.

**Where the numbers came from.** Everything in §1 is *measured on this tree*
by compiling each toy with `renderer/pce-il.js` and walking the resulting IL,
and by running each toy's first frame through the IL host with `il.create(...,
{onOp})`. The projections in §3 are computed from `renderer/pce-ilbc.js`'s own
container layout with the new ops at their proposed sizes. The cycle figures in
§2.4 are *reasoned* from the measured per-instruction cost of the existing
interpreter (docs/ROM_SPEED.md), not captured — the capture card (#175) is what
turns them into measurements. Anything labelled **reasoning** is not something
I read or measured.

---

## 1. What the three games need (measured)

All three toys compile through `pce-il.js` and pass the validator today; the
console refuses them at the IL, not at the toy. All three use tables in exactly
two ways: **arrays of int/bool held in globals**, and **small record tables
built at the point of use and consumed by one instruction** (sprite/raster
specs). None uses `pairs`, `ipairs`, `next`, `#t`, a string as a value, a
fixed-point element, or a table as a map with a computed key.

| | STARFALL (`toys/demo-game`) | TOWER (`toys/tower`) | NOVA TIDE (`toys/nova-tide`) |
|---|---|---|---|
| IL instructions / functions | 1,919 / 18 | 1,856 / 44 | 2,046 / 35 |
| table / setlist / tget / tset | 44 / 11 / 18 / 124 | 6 / 6 / 22 / 18 | 27 / 1 / 82 / 74 |
| share of the IL | 197 (10.3 %) | 52 (2.8 %) | 184 (9.0 %) |
| **table-typed globals** | 7 | 6 | 22 |
| **globals' cells** (int, 1-based) | 40 | 33 | 178 |
| record-shaped sites (`table` + string `tset`) | 33 | 0 | 5 (per frame) |
| array-shaped sites (`setlist`/int keys) | 11 | 6 | 22 |
| deepest nesting | 2 (`cram = {{0, c}}`) | 0 | 0 |
| string fields (program-wide names) | 6 | 0 | 1 |
| executed first frame: IL / table ops | 450 / 128 (28.4 %) | 793 / 24 (3.0 %) | 1,012 / 68 (6.7 %) |

### STARFALL

*Seven table-typed globals, all int arrays, all written once and then read and
written every frame:*

| global | cells | built | read / written |
|---|---|---|---|
| `DIGIT` | 10 | chunk, `main.lua:47` (`setlist`) | read 1×/frame by `digit_pattern` |
| `bl`,`bx`,`by` | 4 each | `init()`, `main.lua:512–514` (`setlist`) | every frame: `move_bullets`, `collide`, `draw_bullets` |
| `ex`,`ey`,`es` | 6 each | `init()`, `main.lua:515–517` | every frame: `move_enemies`, `collide`, `draw_enemies` |

*33 record-shaped table sites, all with string keys and all consumed
immediately, plus 11 array-shaped sites:*

- `art_sat()` (`main.lua:406–422`, init only): 17 `sprite(i, {x,y,pattern,palette})`
  specs, four fields each.
- `draw_hud`/`draw_ship`/`draw_bullets`/`draw_enemies` (every frame): up to 20
  sprite specs, four fields each; five of them carry only `y`
  (`sprite(i, {y = 0})` hides a slot).
- `raster` specs at `main.lua:498` (init) and `main.lua:617` (every frame):
  `{byr = <int>, cram = {{0, <colour>}}}`. Lua lowers the nested list as
  **three** tables — the outer spec (`byr`, `cram`: 6 field cells), a one-cell
  list wrapper, and the two-cell pair — so this is nesting two deep, and each
  raster spec costs three slots.
- Field names in first-appearance order: `x`, `y`, `pattern`, `palette`,
  `byr`, `cram` (6 ids).

Cells: 26 four-field specs, 5 two-field, 2 six-field raster outers = **126
field cells**; DIGIT 10, the three 4-cell and three 6-cell arrays, the two
one-cell wrappers and two two-cell pairs = **46 array cells**; 172 in total.

Per first frame: 128 table ops — 20 `table` (17 sprite specs + the raster
spec's three), 2 `setlist`, 45 `tget`, 61 `tset`. Most of the `tset` traffic
is the spec tables' fields; the rest is the game's array writes.

### TOWER

Six table-typed globals, arrays only, all built in the chunk (once, at boot)
and then mutated every frame:

| global | cells | element | built | read / written |
|---|---|---|---|---|
| `rx`,`ry`,`rvy`,`rdir` | 6 each | int | chunk, `main.lua:282–285` | every frame (`update_rocks`, `collide`, `draw`) |
| `ron` | 6 | bool (`{false,...}`) | `main.lua:286` | `spawn_rock`, `update_rocks`, `collide`, `draw` |
| `heart_on` | 3 | bool | `main.lua:287` | `new_level`, `collide`, `draw` |

No record or spec tables at all (TOWER draws through `sat()`, not `sprite()`),
no nesting, no strings, no pairs/`#t`. Per first frame: 24 table ops, all
`tget` (3.0 % of the frame).

### NOVA TIDE

22 table-typed globals, all int arrays, 178 cells:

- 21 empty constructors in `init()` (`main.lua:485–488`), each filled by a
  numeric `for` loop (`pbx[i] = 0`, …): four 8-cell arrays (`pbx,pby,pbvy,pbon`),
  five 10-cell (`ebx,eby,ebvx,ebvy,ebon`), eight 8-cell
  (`enx,eny,eny0,enph,enhp,entype,endrop,enon`), four 6-cell
  (`exx,exy,ext,exon`) = 170 cells;
- `BASS = {45,45,48,45,52,45,48,43}` in `init()` (`main.lua:507`), 8 cells,
  read once per 15 frames by the bass line.

The only record tables are the five `raster(line, {bxr = ...})` specs built
every frame (`main.lua:530–534`), one `bxr` field each, no nesting. No strings
beyond that one field name, no pairs/`#t`. Per first frame: 68 table ops
(6.7 %) — 5 `table`, 58 `tget`, 5 `tset`.

### What that means for the design

1. The hot path is `t[i]` on a global array with an int register key, in a
   `for` loop — the array shape is the one that must be fast.
2. Record tables never survive their instruction: they are built, read by one
   `sprite`/`raster`, and dropped. A static slot can be reused; no lifetime
   management is needed.
3. The only nesting is inside a spec that is consumed immediately.
4. A table's array part is sized by its constructor (`setlist`) for STARFALL
   and TOWER. NOVA's 21 arrays are `{}` then filled by `for i = 1, N` loops, so
   their size has to come from the loop bound or a declared cap.
5. Nothing needs a map, iteration, a length, or a garbage collector.

---

## 2. The design

### 2.1 Where a table lives on the console

**BaseRAM ($2000–$3FFF), one fixed pool in the interpreter image's static
data, indexed by a cell number. No heap.** Size: **256 cells × 4 B = 1,024 B**
first cut.

*Why not a heap.* STARFALL builds 20 tables in one frame (§1, measured). At
60 Hz that is 72,000 allocations an hour; a bump allocator without reuse dies
in under a second, and a real allocator plus a mark/sweep collector is a far
bigger card than this one. The measured lifetime pattern makes a heap
unnecessary: every transient table is dead before the instruction after the
one that consumes it. So each `table` instruction site gets **one static slot,
reused every time that site runs** — exactly the rule `renderer/pce-cgen.js`
already uses for closures (one static slot per closure site, `cgen-closure-loop`
when the value can escape). The safety rule is the same and is stated in §2.6:
a site whose table escapes *and* can run more than once is refused.

*Why 256 cells.* The pool must hold the largest toy, because `ilvm.bin` is one
fixed image shared by every ROM. At the proposed sizing rule (below) the three
games need **172 (STARFALL), 33 (TOWER) and 183 (NOVA, after #177)** cells; a
256-cell pool (1,024 B) covers all three with 73 cells of headroom. The pool is
static, so its cost is paid by table-free toys too; the interpreter's existing
static data is about 1.9 KiB (`tools/ilvm/ilvm.c`: `fns` 320 B, `clos` ~896 B,
`kvals` 512 B, `globals` 128 B) plus about 3.9 KiB of line arrays in
`tools/ilvm/ilvm_runtime.c` (14 × 256 B of raster arrays and the pending-write
lists) — **counted from the declarations, not from a linked image** — so 1 KiB
is a real addition to a tight BaseRAM and **must be measured, not assumed**, by
the card that builds the image (#175): `tools/gen/ilvm.json`'s section sizes
plus the `$2116–$211F` stack canary of docs/ROM_SPEED.md. If it does not fit,
`TABLE_POOL_CELLS` comes down (192 cells = 768 B still covers all three at
172/33/183) and the encoder's constant moves with it — the two are asserted
equal by name in #174.

*Address.* The pool is not at a hand-picked address: it is a `static` array in
the interpreter's `.bss`, placed by the llvm-mos linker below the stack base
`$4000`, in the same region as `fns`/`clos`/`kvals`/`globals`. It must not be
placed in `$2000–$21FF`: `$2100–$2127` are the #169 measurement cells and
`$2116–$211F` the stack canary (docs/ROM_LAYOUT.md, docs/ROM_SPEED.md). The
rebuild card re-runs the canary.

*Element width: 4 bytes, the IL's int32.* The interpreter's registers are
`int32_t`, and the C backend emits `int32_t`; a 2-byte cell would silently
truncate a value that is exact in the browser. A **bool** element is stored as
0/1 in the same cell (`ron`, `heart_on` — measured above). A **fixed** element
stays refused (§2.6).

### 2.2 What a table value is

A register that holds a table holds its **slot id** (0…nslots−1), an ordinary
int32. The container's table section gives every slot its place and shape:

```
cell layout of one slot:
  array part   cap        int32 cells, 1-based index i stored at cell base+i-1
  field part   nfields    int32 cells, field id f stored at cell base+cap+f
```

- `nslots` = the number of `table` instructions in the program (one slot per
  site, §2.1).
- **Field ids are program-wide**, assigned by first appearance of the string
  key: STARFALL `x`=0 `y`=1 `pattern`=2 `palette`=3 `byr`=4 `cram`=5; NOVA
  `bxr`=0; TOWER has none. A slot's `nfields` is the largest field id written
  through it + 1, so a slot that only writes `cram` reserves six field cells
  and leaves the first five zero. Program-wide ids are what makes `t.x` mean
  the same thing at a constructor and at a read site that receives the table
  from a global or a helper. They are also what lets a future `sprite`/`raster`
  op (#133/#136) name its spec fields *by id in its own operand bytes* rather
  than at run time — the interpreter never compares a string.
- **Capacity rule.** `cap` = the end index of the site's `setlist` if it has
  one; else the largest constant int key written through it; else, for a
  register key, the largest index the enclosing numeric `for` can reach when
  its start/limit/step are constants (#177), else `TABLE_ARRAY_CAP = 16`. That
  is what sizes NOVA's 21 loop-filled arrays at 8/10/8/6 (183 cells) instead of
  16 each (349 cells).
- A cell is zeroed by `table`. Reading a field or an array element never
  written returns 0 — the browser host's `undefined` is used as a number in
  every one of these toys (the API reads missing spec fields as 0), so 0 is the
  same answer. Reading past `cap` also returns 0.
- Writing past `cap` (or a slot id past `nslots`) is a **runtime refusal**:
  the interpreter sets its existing `fault` flag, stops running the toy, and
  leaves memory untouched. No write can land outside the pool. Where the index
  is a constant the encoder refuses the program instead (`ilbc-table-ram` /
  `ilbc-range`).

### 2.3 The bytecode: container v2 and four ops

The container is version 1 for every toy that has no `table` instruction —
**byte for byte**, so `tests/dumps/toypalette-ilvm`, `toyparallax-ilvm` and
`toystatusbar-ilvm` keep their committed sha256. A toy with tables gets
**version 2**, a 28-byte header, and a new table section. All offsets stay
explicit, so the two versions share one reader.

```
header (v2), bytes 0..27 — v1 keeps bytes 0..23 and its old meaning
  0  "ILBC"                     12 u16 funcTabOff
  4  u8 version (= 2)           14 u16 upTabOff
  5  u8 flags (bit 0 raster)    16 u16 constTabOff
  6  u8 initSlot (0xFF none)    18 u16 globalTabOff
  7  u8 frameSlot               20 u16 tabTabOff     <- new
  8  u8 rasterSlot              22 u16 codeOff       <- was 20 in v1
  9  u8 nfunc                   24 u16 codeEnd       <- was 22 in v1
 10  u8 nglobal                 26 u16 reserved (0)
 11  u8 nconst

table section (at tabTabOff)
  u8 nslots
  per slot, in site order: u16 base (cell index)  u8 cap  u8 nfields
```

New opcodes (the OPS table in `renderer/pce-ilbc.js`; operand encoding
unchanged: `0x00–0x7F` register, `0x80–0xFE` constant, `0xFF` none):

| op | mnemonic | bytes after the opcode | meaning |
|---|---|---|---|
| `0x18` | `table` | `dst:reg slot:u8` | zero the slot, write its id to `dst` |
| `0x19` | `setlist` | `base:reg first:u8 n:u8 v[n]:op` | array part, `first` is the IL's 1-based index |
| `0x1A` | `tget` | `dst:reg base:op key:u8 kind:u8` | `kind` 0: `key` is an int operand (array); 1: `key` is a field id |
| `0x1B` | `tset` | `base:op key:u8 kind:u8 value:op` | the same, writing |

Sizes: `table` 3 B, `setlist` 4+n B, `tget`/`tset` 5 B. A string key never
enters the value constant pool — it becomes a field id, so `MAX_CONST = 127`
(docs/IL.md §14.1) is unaffected and no string is a value at run time. `first`
is a u8; a setlist whose first index exceeds 255 is `ilbc-range` (one byte is
the operand's width, and a table that large is past the pool anyway).

Refusal codes the encoder gains (all by code, at build time):

| code | when |
|---|---|
| `ilbc-table-ram` | the program's slots need more than `TABLE_POOL_CELLS` cells, or a constant index/field id is past its slot's capacity/field count |
| `ilbc-table-escape` | an escaping table site can run more than once (§2.6) |
| `ilbc-table-key` | a table key that is neither a constant string nor an int operand, or a `tget`/`tset` base that is not a register |
| `ilbc-range` | `first` past 255, more than 255 sites, more than 255 field names, a cell index past 65,535 |

### 2.4 The interpreter's ops and their cycle cost

`tools/ilvm/ilvm.c` gains: accept version 1 and 2; read the table section at
`toy_boot` into `uint16_t slot_base[]`, `uint8_t slot_cap[]`,
`uint8_t slot_fields[]`, `uint8_t nslots`; and a **reasoned** cost per op,
against the measured baseline:

- **Baseline, measured.** The interpreter costs about **1,420–1,830 CPU
  cycles per executed IL instruction** on the three captured toys: palette
  286,700 cycles / 157 instructions, parallax 4,484,000 / 3,155, status-bar
  2,024,000 / 1,372 (docs/ROM_SPEED.md's measured scanline means × 455.4
  clocks per line, divided by the instruction count I measured with `onOp`).
- **Estimate, reasoning from the code, not measured:** each op is a jump-table
  dispatch plus `rb()` calls (each `noinline`, ~20–30 cycles), then the work.
  - `tget` array: op + `dst` + `base` + `key` = 4 reads, a bounds compare, a
    32-bit load from the pool (a `uint16` index into a static array), a store.
    **≈ 1.2–1.5× a plain op** (roughly 1,700–2,700 cycles).
  - `tset` array: the same a fifth read (`value`), a store, the same bounds
    check. **≈ 1.3–1.6×.**
  - `tget`/`tset` field: no multiply, one compare against `nfields`.
    **≈ 1.1–1.4×** (fields are only in spec tables).
  - `table`: dispatch + a slot id store + zeroing `cap+nfields` cells at about
    30–50 cycles a cell: a 4-field spec **≈ 250–450 cycles** (~1.2× a plain
    op); a 16-cell array site **≈ 700–1,100 cycles**. Measured frequency is
    low: STARFALL's 20 per frame are 18 field tables and 2 array tables.
  - `setlist`: ~1 op + ~40 cycles per value.
- **What that does to a real game** (reasoning): STARFALL's first frame
  executes 450 IL instructions ≈ 640k–820k cycles already (5.4–6.9 display
  frames, 9–11 Hz); its 128 table ops add roughly 40k–190k cycles (0.3–1.6
  frames). TOWER (793 instructions, 24 table ops) ≈ 1.1–1.4 M cycles (9–12
  frames). NOVA (1,012, 68) ≈ 1.4–1.9 M (12–16 frames). **The export goal here
  is measurement, not 60 Hz: these games will run at single-digit to low-teens
  Hz on route 1**, and the capture card is what turns these estimates into
  numbers table by table.
- The capture card must also re-run the `$2116–$211F` canary and the four
  #169 captures, because the table pool grows the interpreter's static RAM.

### 2.5 The cgen typing change (#143)

`renderer/pce-cgen.js`'s global allow-list (`fn|vram|int|bool|padset`) gains
`table` — that is #143, the C emitter's next refusal after the four kinds are
carried. The lowering is the same model as the interpreter, because the two
backends must agree:

- `static int32_t il_table_cells[IL_TABLE_CELLS];` plus
  `static const uint16_t il_slot_base[]`, `il_slot_cap[]`, `il_slot_fields[]`;
  `il_globals[i]` holds a slot id for a table-typed global.
- `table` → zero the slot and store the id; `setlist`/`tget`/`tset` → the
  same bounded accesses; a constant out of range is `cgen-table-ram`, an
  escaping re-executing site `cgen-table-escape`.
- A toy that goes through cgen still needs #133–#137 for its other
  instructions, so the C route is tested on a table-only toy until then.

### 2.6 What stays refused, and why

| still refused | code | why |
|---|---|---|
| `pairs`/`ipairs`/`next`, generic `for` over a table | `il-for-in` (IL, unchanged) | iteration order and a closure per iteration are a different feature; none of the three toys uses it |
| `#t` | `il-op` (IL, unchanged) | would need a stored length; none uses it |
| a string as a **value** (including in a table) | `il-string` (IL, unchanged) | the IL has no string value; string *keys* are field ids (§2.3) |
| a fixed-point table element | `ilbc-fixed` / `cgen-fixed` | fixed arithmetic is not on either console route yet; all three toys are int/bool |
| a table built in a function that can run more than once **and** stored in a global/upvalue, returned, passed to a `call`, or put in a table that escapes | `ilbc-table-escape` / `cgen-table-escape` | one slot per site would silently alias two Lua tables; refuse rather than differ from the browser |
| more cells/sites/fields than the pool, or a constant index past a slot's capacity | `ilbc-table-ram` / `ilbc-range` | the pool is fixed (§2.1); the encoder names the number |
| writing past a slot at run time (register key) | `fault` | the toy stops, the display keeps its last frame, no memory outside the pool is touched |

A table built in the top-level chunk or `init()` may escape: those run once,
so the slot holds that one table for the toy's life. A table passed to a
`sprite`/`raster` instruction (not a `call`) does not escape — the runtime
copies the fields it needs. The escape taint follows containment: a pair
stored in a `cram` field escapes only if the outer spec escapes, which is what
lets STARFALL's per-frame nested list and pair through.

---

## 3. What this does and does not unblock (measured projections)

Projected container size (the four table ops at their real sizes, table section
added; the column headers say how the still-uncarried kinds are counted):

| toy | floor: everything uncarried at 0 B | four table ops exact | + remaining kinds at 3 B | vs 8,192 B bank |
|---|---|---|---|---|
| STARFALL | 7,856 | **8,969** | 9,107 | over by 777–915 |
| TOWER | 8,075 | **8,379** | 8,475 | over by 187–283 |
| NOVA TIDE | 8,301 | **9,287** | 9,377 | over by 1,095–1,185 |

**No game exports on tables alone.** All three exceed the one 8 KiB data bank,
so #138 is on the critical path for every one of them (TOWER is the closest,
187 B over with the four ops carried and the other kinds at 0). The rest of
each toy's refusal inventory, measured on this tree after the four table kinds
would be carried:

| toy | route 1 still refuses | cgen still refuses |
|---|---|---|
| STARFALL | `sprite` 31 (#133), `padref`/`padget` 5+5 (#134), `sfx` 3 (#135), `raster` table form 2 (#136), `abs` 2 + `sr` 1 (#137) | the same, once #143's typing change lands |
| TOWER | `padref`/`padget` 10+10 (#134), `sfx` 6 (#135), `sat` 5, `not` 1, and `ilbc-arity` (`spr` has 7 parameters) | `sat` 5, `not` 1, and `cgen-arity` 12 |
| NOVA TIDE | `sat` 6, `padref`/`padget` 7+7 (#134), `sfx` 5 (#135), `raster` 5 (#136), `note` 5 (#137), and `ilbc-arity` (`fn@44` has 8 parameters) | `sat`, `note`, `unm`, `cgen-arity` 10 |

The arity refusals are not table work: the interpreter and the C backend both
take at most four parameters (`pce-ilbc.js` `MAX_ARGS`, `pce-cgen.js`), and
TOWER and NOVA TIDE pass seven and eight. They are named here so the export
path is honest; they need their own small card, or a lowering that passes a
spec in pieces.

So #132's children make the table work true and measurable — the
`tools/starfall-console.js` inventory drops by 197 / 52 / 184 instructions —
but the games also need #133–#138, `sat`/`not`/`unm` (small op cards) and the
arity question. This plan does not pretend otherwise.

---

## 4. The order of the work

Eight cards, each ~S and one concern. They are added to the board with
`QUEUE: auto`; #132 stays the umbrella. Dependencies are listed so the queue
can run the cheap ones in parallel where it can.

| card | what | files | needs | closes on |
|---|---|---|---|---|
| #171 | **ilbc: read each table's shape from its uses** — `tableLayout(program)`: per site, capacity, program-wide field ids, escapes, re-executes. No bytes change. | `renderer/pce-ilbc.js` | — | `checkTableLayout` in check-ilvm.js: STARFALL 44 sites/172 cells, TOWER 6/33, NOVA 27 sites; escape flags |
| #172 | **ilbc: encode the four table ops and the v2 container** — header/table section/opcodes/refusals of §2.3; version 1 stays byte-identical. | `renderer/pce-ilbc.js`, `docs/IL.md` §14.1 | #171 | `checkTableEncoding`: exact bytes, table section, refusals, the three dumps' sha256 unchanged |
| #173 | **ilvm: a host harness that runs the interpreter** — build `hostvm` with the system cc into `$TMPDIR`, diff VRAM/CRAM/SAT/regs against the browser IL run. | `tests/check-ilvm.js`, `tools/ilvm/hostvm.c` | — | `checkHostParity`: parallax 8 frames diff 0; a control mutation fails |
| #174 | **ilvm: run the table ops in the interpreter** — version 1+2, the slot table, the 256-cell pool, the four ops, bounds → `fault`. | `tools/ilvm/ilvm.c` | #172, #173 | `checkTablesRun`: int/bool arrays, a record, a nested pair, an over-range write faults and touches nothing; the pool constant matches the encoder's |
| #175 | **ilvm.bin: rebuild the interpreter with the table ops** — llvm-mos build, commit the image and its report, re-run the canary and the #169 captures, and a table toy's Mednafen capture. | `renderer/ilvm.bin`, `tools/gen/ilvm.json` | #174 | rebuild is bit-identical; canary survives; a table toy's capture diffs 0 against the browser |
| #176 | **cgen: carry table-typed globals and the four ops** — the #143 allow-list change and the same pool/lowering. | `renderer/pce-cgen.js` | #171, #172 | check-il-console: a table toy emits C with no cgen-op/cgen-global; encoder and cgen agree on cells |
| #177 | **ilbc: size table arrays from constant for-loop bounds** — NOVA's 8/10/8/6 instead of 16 each. | `renderer/pce-ilbc.js` | #171 | `checkTableCapacity`: NOVA 183 cells (was 349), unbounded key stays 16, STARFALL unchanged |
| #178 | **starfall-console: print each toy's table inventory** — the reproducible measurement of §1 and §3 for any toy; stop it crashing on TOWER's null budget. | `tools/starfall-console.js` | #171, #172, #177 | a new `tests/check-tables.js` pins the three inventories and projections; the tool exits 0 on all three |

**Order.** #171 and #173 first (no dependencies, and #173 gives every later
interpreter card a red/green loop without Mednafen); then #172; then #174 and
#177 in parallel (both only read the IL); then #178 and #176; #175 whenever a
machine with llvm-mos and Mednafen is available.

**Sequencing rule that must not be broken:** #172 makes the encoder emit
version 2, but the *committed* `renderer/ilvm.bin` cannot read it until #175
rebuilds it. Until #175 lands, an exported table toy shows a blank screen (the
old image rejects version 2 at boot and stops; it does not crash). #172, #174
and #175 land as one release; #132 does not close before #175.

**Invariants each card must keep green** (they are how a cheap agent knows it
did not break the neighbours):

- the three committed ILVM dumps (`tests/dumps/toy*-ilvm`) still emit
  byte-identical ROMs — tableless toys stay version 1;
- `tests/check-ilvm.js`'s "a table is ilbc-op" refusal test changes **in the
  same card** as the encoder that makes it false;
- `tests/check-starfall-console.js` pins the refusal inventory (246 of 1,919,
  the per-kind counts) and fifteen `file:line` citations, including
  `pce-ilbc.js:116/127/220/245/286` and `pce-cgen.js:400/458/467/485/490`.
  Every card that edits those files re-reads and updates the pins (the #167
  lesson: a merge moved one and the check was built to catch it);
- `docs/IL.md` §14.1's container table gains the four rows and the version 2
  header in #172;
- the `$2116–$211F` canary and the #169 measurement cells survive #175.

---

## 5. Risks and open questions

- **RAM is the real unknown.** The 1 KiB pool is a reasoned first cut; the
  interpreter's static footprint has never been measured next to the stack's
  deepest use. #174 pins the constant and #175 measures it. If 256 cells do
  not fit, 192 still covers the three games, and the refusal names the number.
- **Capacity inference is conservative.** A table grown by a computed index
  outside a constant `for` falls back to 16 cells and may hit the pool limit;
  #177's evidence names the fallback. A later card could do path-sensitive
  bounds (#32's territory).
- **Two implementations of one layout** (encoder and cgen). They can drift;
  #176's evidence asserts they agree on the same IL, and the rule is written
  once here.
- **The frame-rate answer will disappoint.** These games are 5–16 frames per
  update on route 1 (reasoning from the measured per-instruction cost); the
  export's value is that their speed can now be *measured*, and that data is
  what route 2 (#101) or a faster interpreter can be judged against.
- **No card here makes a game export.** #138 and the remaining op cards do
  that; this plan deliberately stops at tables.

---

## Appendix — reproducing §1 and §3

1. Compile a toy: `il.compile(fs.readFileSync(toy), {chunkName})`
   (`renderer/pce-il.js`). Count instructions by `ins.t`; table ops are
   `table`, `setlist`, `tget`, `tset`.
2. Per-frame executed ops:
   `il.create(source, {onOp: (fid, ins) => counts[ins.t]++})`, then `load()`,
   reset the counts, then `frame(0)`. That is where 450/128, 793/24 and
   1,012/68 come from.
3. Slot layout: for each `table` site, follow its register to the next
   redefinition (or, when it is `setglobal`'d, follow the table-typed global
   through every `getglobal`), collect `setlist` ends, constant int keys,
   string keys and register keys; field ids are assigned by first appearance.
   The pure loop-bound rule of #177 turns NOVA's 21 register-key sites from 16
   to 8/10/8/6.
4. Container size: `renderer/pce-ilbc.js`'s header + function entries +
   upvalues + constant table + global names + code, with the four new sizes
   from §2.3, the 28-byte v2 header and the table section `1 + 4·sites`.
   The model reproduces the two committed containers (palette 578,
   parallax 1,115) within a few bytes before it is used.
5. #178 makes all of this one command for any toy, so the next reader does
   not need this appendix.
