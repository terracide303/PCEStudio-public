# STARFALL on the PC Engine (card #131)

**The question** (Dennis, 2026-10-29): STARFALL is a Lua game in the studio —
is it PC Engine code, and does it run in an emulator?

**The answer: not yet.** The studio's **Export** button refuses
`toys/demo-game` and builds nothing. The refusal the page shows is one line.
Behind it are **seven separate blockers**: six kinds of IL instruction that
neither console backend can carry ([#132](#132)–[#137](#137)), and one
capacity limit that would stop the export even with all six closed
([#138](#138)). STARFALL runs on our *model* (Lua and IL, 600 frames,
`tests/check-demo-game.js` PASS) but it is not yet PCE code.

The one number that matters most for the question as asked: **if every
missing instruction were carried, route 1 (the IL interpreter in
`renderer/ilvm.bin`, which is what the Export builds) projects STARFALL's
frame at 23.4 Hz, not 60 Hz.** So closing #132–#137 makes STARFALL *runnable*
on the console; it does not make it *60 fps*.

---

## 1. How this was measured

Two instruments, both run for this card. Neither changes the game.

**(a) The real page.** `renderer/studio.html` served from the repo root and
loaded in `chrome-headless-shell` (Chrome for Testing 156, on External II —
never `/Applications/Google Chrome.app`, #114), which loads the gallery entry
`starfall` exactly as Browse does and calls the Export button's whole action,
`studio.exportToy()`:

```
chrome-headless-shell --headless --no-sandbox --disable-gpu --in-process-gpu \
  --no-first-run --user-data-dir=$TMPDIR/sf-chrome-XXXX \
  --virtual-time-budget=120000 --dump-dom \
  "http://127.0.0.1:<port>/__driver.html"
```

No keyboard or mouse events: the driver calls the page's own functions.

**(b) `tools/starfall-console.js`** — the same three modules the page runs
(`pce-il.js` → `pce-validate.js` → `pce-cgen.js`, then `pce-ilbc.js` →
`pce-rom.js`), so every number below is reproducible with one command:

```sh
node tools/starfall-console.js                      # STARFALL
node tools/starfall-console.js toys/parallax.lua    # the control: it builds
```

The control matters. On a toy that is known to export (parallax) the tool
prints **0 refusals** and **`bytecode 1,100 B -> .pce 24,576 B`**; on
STARFALL it prints **246 refusals** and no `.pce`. The two outcomes are
distinguishable, so "blocked" here is not a check that cannot pass.

---

## 2. What the page itself says

`studio.exportToy()` on the gallery's `starfall` source (20,719 B, confirmed to
be `toys/demo-game/main.lua`'s exact text):

| field | value |
|-------|-------|
| `phase` | `"blocked"` |
| `bytes` | 0 (nothing was built, nothing downloaded) |
| `bytecodeBytes` | 0 |
| `name` | `STARFALL.pce` |
| dialog lead | *"This toy can't run on the PC Engine as written yet. The compiler's findings point at what to change:"* |

and exactly one finding:

| severity | code | file:line | message |
|----------|------|-----------|---------|
| error | `cgen-op` | `toys/demo-game/main.lua:47` | `function main, IL line 47, instruction `table`: not lowered by this backend (init/frame/raster and reg/pal/vset/sat/pad and the timer only; no sprites, tables or fixed point)` |

**The validator does not refuse STARFALL — the C emitter does.** That is
worth stating plainly, because it is a blind spot in the tool everyone reads
as the gate:

- `PCEStudio.validate.validateProgram` returns `ok: true` with **0 problems**
  for STARFALL. It prices the game and likes the price.
- The CONSOLE tab's third stage, `PCEStudio.cgen.emitC` (the C backend,
  llvm-mos), refuses. `renderer/studio-panel-console.js:140` pushes that as an
  `error`, so the banner goes red — but only because the C emitter is in the
  panel's pipeline, not because the validator found anything.
- `tests/check-demo-game.js` asserts exactly this validator's `ok`, so a green
  demo-game check says nothing about the console.

---

## 3. Why one finding and not eleven

Two first-hit aborts sit between the page and the truth:

1. `pce-cgen.js:489` refuses the **first** IL instruction it cannot lower and
   throws. STARFALL's first is the `table` for the `DIGIT` digit-code array at
   `main.lua:47`.
2. That error sets `errors > 0`, and `renderer/studio.html:3494` returns
   before the encoder is ever called — so the page never reports what
   `pce-ilbc.js` (route 1, the backend the Export actually uses) would say.
   Asked directly, `pce-ilbc.js` refuses with `ilbc-op: instruction table
   (function 0, pc 2) has no bytecode form`.

So the page's single line is the first of many. The rest are below.

---

## 4. Every kind of refusal

Counted over STARFALL's whole IL (18 functions, 1,919 instructions) rather
than stopping at the first hit. "Route 1" is `pce-ilbc.js` + `renderer/ilvm.bin`
(what the Export builds); "C backend" is `pce-cgen.js` (llvm-mos, route 2).

| IL kind | count | first `main.lua` | refusal codes | fixes |
|---------|------:|-----------------:|---------------|-------|
| `tset` | 124 | 406 | `ilbc-op`, `cgen-op` | #132 |
| `table` | 44 | 47 | `ilbc-op`, `cgen-op` | #132 |
| `setlist` | 11 | 47 | `ilbc-op`, `cgen-op` | #132 |
| `tget` | 18 | 444 | `ilbc-op`, `cgen-op` | #132 |
| `sprite` | 31 | 406 | `ilbc-op`, `cgen-op` | #133 |
| `padref` | 5 | 649 | `ilbc-op` only | #134 |
| `padget` | 5 | 649 | `ilbc-op` only | #134 |
| `sfx` | 3 | 475 | `ilbc-op`, `cgen-op` | #135 |
| `raster` (table form) | 2 | 498 | `ilbc-op`, `cgen-op` | #136 |
| `builtin abs` | 2 | 466 | `ilbc-builtin`, `cgen-op` | #137 |
| `builtin sr` | 1 | 570 | `ilbc-builtin`, `cgen-op` | #137 |

**246 of 1,919 instructions (12.8%)** are refused by at least one backend.
Nine of the eleven kinds are refused by both; pad reads are a
**route-1-only** gap (the C backend lowers `padref`/`padget` —
`pce-cgen.js:457 and 466` — so the two backends disagree about what a toy can
do).

Two notes that matter for whoever closes these:

- **`raster` is only refused in the table form.** `raster(line, spec)` is an
  IL instruction (`pce-il.js:1619`) with no ILBC opcode. The **callback** form,
  `function raster(line)`, is carried (`pce-ilbc.js:286` records the hook
  slot) — that is how `toys/parallax.lua` exports and runs. STARFALL chose the
  table form, and the table form is the *cheaper* one on the console: two RCR
  entries a frame (the validator prices them at 100 cycles against part C's
  123-cycle blank budget) instead of 224 callback calls.
- **`sr()` is `pce-cgen.js`'s "part A lowers rgb only"** and `pce-ilbc.js`'s
  `BUILTIN = { rgb: 0 }`. #119 put `sr()` in the IL; no console backend carries
  it yet.

The cards filed, one per kind:

- <a id="132"></a>**#132** — route 1 cannot carry tables (`table`, `setlist`,
  `tget`, `tset`), 197 instructions. #118's int arrays.
- <a id="133"></a>**#133** — `sprite()`, 31 instructions. Without it STARFALL
  draws nothing at all: the ship, six drones, four bullets and the HUD are
  all sprites.
- <a id="134"></a>**#134** — `pad[n]`, `padref`/`padget`, 5 each. Route 1 only.
- <a id="135"></a>**#135** — `sfx()`, 3 instructions. This is about the
  **export carrying the call**, not about #71/#113's audible sound.
- <a id="136"></a>**#136** — the `raster(line, spec)` table form, 2
  instructions.
- <a id="137"></a>**#137** — builtins beyond `rgb`: `abs()` and `sr()`.
- <a id="138"></a>**#138** — the 8 KiB data bank (§6). Not an instruction
  kind; it would block the export with all of the above closed.

---

## 5. The frame time, and 60 Hz

The validator prices STARFALL as follows (`tools/starfall-console.js`; these
are **static estimates from the IL's op mix**, not a capture — nothing here
ran on an emulator, because nothing here can be built):

| route | cycles | vs one 60 Hz display frame (119,318) | rate |
|-------|-------:|-----------------------------------:|-----:|
| compiled route's model (`cgen`/llvm-mos) | 9,530 | 0.08× | 751 Hz |
| **route 1, the IL interpreter (`ilvm.bin`) — what the Export builds** | **305,913** | **2.56×** | **23.4 Hz** |

`frame()`'s own cost varies 9,530–9,637 cycles over the validator's 8 frames.
Route 1's number is `9,530 × 32.10`: the factor between the interpreter and
this model measured on the palette toy (`docs/IL.md` §14.5,
238,988 / 7,445). STARFALL has no `raster` **callback**, so the no-raster
factor is the right one.

**So: 23.4 Hz projected, i.e. one game frame every 2.56 display frames.**
Even with #132–#137 built, STARFALL on route 1 does not reach 60 Hz.

Three things this number is not:

- **Not measured.** Nothing ran. It is this repo's cost model multiplied by a
  factor calibrated on another toy.
- **Not tightly bounded.** The one held-out case for the raster factor — the
  status-bar toy — came in 1.9× *under* its projection (`docs/IL.md` §14.5),
  so a projection of this kind can be wrong by a factor of two. If STARFALL
  behaves like status-bar the true figure is nearer **45 Hz**, still short of
  60; if it behaves like palette it is 23 Hz.
- **Not the whole frame.** It prices `frame()` only. STARFALL's two RCR table
  entries are replayed by the ROM's line handler, not the interpreter, and are
  outside this number.

The other budgets, for completeness: 6 sprites / 6 strips with 4 on the
busiest line (no overflow), 2,010 VRAM words, 100 blank cycles against a
123-cycle budget, ROM estimate ~30,480 B in 4 banks.

---

## 6. The capacity limit behind the instruction gaps (#138)

`renderer/pce-rom.js:618` refuses a bytecode (plus asset tail) larger than
`BANK` = **8,192 B** with code `toy-data-bank-full`: *"the interpreter reads one
8 KiB data bank"*. A size model built from `pce-ilbc.js`'s own container
layout — header 24 B, function entry 10 B, upvalue 2 B, the constant and
global name tables, and the per-op sizes at `pce-ilbc.js:195` — reproduces the
two committed containers to **within 4 bytes** (palette 1 B short, parallax
4 B short). Applied to STARFALL:

| assumed size per uncarried instruction | projected bytecode | vs the 8,192 B bank |
|----------------------------------------|-------------------:|--------------------:|
| 3 B (smaller than any real op but `ret`/`forprep`) | 8,585 B | **over by 393 B** |
| 4 B | 8,828 B | over by 636 B |
| 6 B | 9,314 B | over by 1,122 B |

and #132–#137 will add their own format bytes on top. STARFALL is a
1,919-instruction game; the only toys proven on route 1 are 213 (parallax) and
a handful (palette). **The 8 KiB bank is the wrong size class for a game**, and
closing the six instruction cards without deciding this leaves the Export
refusing STARFALL one refusal later, with `toy-data-bank-full` instead of
`ilbc-op`.

---

## 7. What this does NOT prove

- **Nothing about a console.** No `.pce` was built, so nothing ran in Mednafen,
  no 20-frame diff against the browser was taken, and no TMA-timer cycles were
  measured. Those steps were conditional on the export succeeding and it did
  not.
- **Not that 23.4 Hz is right.** See §5. It is a model times a factor from
  another toy, and the one held-out precedent was off by 1.9×.
- **Not that closing #132–#138 makes STARFALL run correctly.** This card
  proves the *export refuses*; it does not prove the game would be correct on
  the console once it builds. Sprites-per-line, the RCR split's timing and the
  VDC collision flag (`sr()`) all need their own capture on real frames.
- **Not that those seven are all of them.** Each is the first refusal its
  backend reaches in the order the IL is laid out. An instruction kind that
  appears only *behind* an earlier refusal and is absent from both dispatch
  tables is still counted here by table inspection — but a *semantic* problem
  (a toy that encodes fine and behaves differently on the console) would not
  show up at all, and this card could not see one.
- **Not the model's sound.** `sfx()` writes PSG events that render silent with
  no `music()` (#113); `tests/check-demo-game.js` prints that NOTE itself.
- **Not the page's download wiring.** The export was blocked before the
  download step, so the `Blob`/`createObjectURL` path was never exercised here.
- **Not route 2.** The `cgen` refusal is reported, but route 2 (#101, parked)
  and its emitter were not exercised end to end.

---

## 8. Reproducing it

```sh
node tools/starfall-console.js                    # STARFALL: the whole report
node tools/starfall-console.js toys/parallax.lua  # control: 0 refusals, builds
node tests/check-demo-game.js                     # the model route: PASS 38
```

The real page's part was measured with a scratch driver (an iframe around
`renderer/studio.html?paused=1`, a call to `studio.exportToy()`, the DOM read
back out) run under `chrome-headless-shell`; that driver lives under `$TMPDIR`
and is not committed, because #114's one-settings module for browser launches
does not exist yet and hard-coding a browser path is what #114 is about.
