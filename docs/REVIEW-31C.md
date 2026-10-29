# Rule 2 breaker (#31 part C, #32, #77) — the console raster chain, the validator and the studio's files, broken 26 ways

Reviewer: @review (DeepSeek Flash seat). Date 2026-10-29. The builders of the
three targets were different seats. This is a cold break: the repository
only, no briefing. **Nothing was fixed; this is the list.** Rule 2 in
[`../../workshop/RULES.md`](../../workshop/RULES.md): a test is proven by
breaks someone else chose.

The targets:

- **#31 part C** (`df88b22`, `10b9fd8`): `renderer/pce-cgen.js` (the `reg`
  lowering and the `toy_raster` hook), `tools/toyc/toy_runtime.c` (the
  collection table and the hand-written RCR replay handler), the replay
  handler's counted cost. The instrument is `node tests/check-il-console.js`.
- **#32** (`d00f1c0`): `renderer/pce-validate.js` (the IL validator),
  `tools/toyc/emit.js` (the export gate). The instrument is
  `node tests/check-validate.js`.
- **#77** (`0b40c67`..`278133f`): `renderer/studio.html` (CodeMirror, the
  toy's five-file set, save/open, autosave, the shortcut table) and the
  vendored CodeMirror. The instrument is `node tests/check-studio.js`.
  (The brief wrote `0b07767`; that object does not exist in this clone. The
  studio editor/files commit is `0b40c67`, and `278133f` is its autosave
  evidence.)

## What I ran

- **Pinned tree.** The shared working tree was at `e6f54e7` when the review
  started; other seats advanced it to `fa59226` while the review ran, and
  their uncommitted edits are in the same working tree. **This review is
  pinned to `e6f54e7`**, the pushed state that contains the three commits
  under review. Every break was applied to a fresh local `git clone` of
  `origin` under `$TMPDIR/pce-breaker-aavbcx/` (base clone `clean/`,
  pristine copy `template/` at `e6f54e7`). **The real repository was never
  edited.**
- **Baseline, unmodified, at `e6f54e7`.** `node tests/check-il-console.js`
  exit 0, `PASS 116 checks`; `node tests/check-validate.js` exit 0,
  `PASS 143 checks`; `node tests/check-studio.js` exit 0, `PASS 438 checks`.
- **Sandbox.** `$TMPDIR/pce-breaker-aavbcx/runner.py` clones the pristine
  copy for each break, asserts the target string occurs **exactly once**,
  substitutes it, then runs the **unmodified** check with the clone as cwd.
  Every mutant and every log is under `$TMPDIR/pce-breaker-aavbcx/`
  (`mut/`, `logs/`, `results.json`); no scratch file was written to `/tmp`.
- **llvm-mos, no Mednafen, no keyboard or mouse.** The console rebuild uses
  the check's own default llvm-mos path,
  `/Volumes/External II/pce-tools/llvm-mos/llvm-mos`. No emulator run, no
  synthetic input.
- **Result classes.** `DETECTED` = the unmodified check exits non-zero and
  names the broken property. `MISSED` = the check exits 0 and prints
  `PASS`, and a direct probe on the mutant shows it changes behaviour on a
  legal input no fixture reaches. `NO-OP` = the change cannot change
  behaviour for any legal input, and `PASS` is correct.
- **One break at a time.**

## The table

Counts: **26 breaks — 13 DETECTED, 11 MISSED, 2 NO-OP.** One detection
(C07) is the emitter's own regex; six (C01–C06) are the pinned ROM sha
**only** (see residual weakness 1); the remaining six are the check's
direct behavioural assertions.

| # | card | file | break, applied one at a time | result | measured output |
|---|---|---|---|---|---|
| C01 | #31C | `tools/toyc/toy_runtime.c` | the replay table is built for the wrong frame: `toy_frame(f)` → `toy_frame(f + 1)` in the raster branch | **DETECTED** (sha only) | exit 1: rebuilt parallax ROM sha `52c3deb2…` != committed `cdf6dfae…`; `FAIL 1 of 116`. The dump/pixel checks still pass (they compare the committed dump) |
| C02 | #31C | `tools/toyc/toy_runtime.c` | line 0 applied after the VBlank: move `apply_entry0()` below the VBlank wait instead of before it | **DETECTED** (sha only) | exit 1: ROM sha `7c739317…` != `cdf6dfae…`; `FAIL 1 of 116` |
| C03 | #31C | `tools/toyc/toy_runtime.c` | RCR re-armed without the nine-bit carry: delete `adc #$00` before `sta $0003` | **DETECTED** (sha only) | exit 1: ROM sha `5f51e38c…` != `cdf6dfae…`; `FAIL 1 of 116` |
| C04 | #31C | `tools/toyc/toy_runtime.c` | BXR stored after BYR: swap the two ISR register blocks (BYR first) | **DETECTED** (sha only) | exit 1: ROM sha `deaf0237…` != `cdf6dfae…`; `FAIL 1 of 116` |
| C05 | #31C | `tools/toyc/toy_runtime.c` | the chain starts at entry 0: `toy_isr_line = 1` → `0` (every entry one line late, entry 223 never served) | **DETECTED** (sha only) | exit 1: ROM sha `9e1b449a…` != `cdf6dfae…`; `FAIL 1 of 116` |
| C06 | #31C | `renderer/pce-cgen.js` | the IL `reg` lowering swaps BXR and BYR ids | **DETECTED** (sha only) | exit 1: ROM sha `63eeb20d…` != `cdf6dfae…`; `FAIL 1 of 116` (the emitter's `/toy_reg\(TOY_REG_BXR,/` still matches, because parallax also writes BYR in `frame()`) |
| C07 | #31C | `renderer/pce-cgen.js` | `toy_raster` passes `0` instead of the line to the callback | **DETECTED** | exit 1: `FAIL toy_raster passes the line as the hook's first parameter`; then the ROM sha `d823f410…`; `FAIL 2 of 116` |
| C08 | #31C | `renderer/pce-cgen.js` | the emitter's raster-hook arity guard is removed (a program whose raster hook has two int parameters is accepted) | **MISSED** (IL-level) | exit 0, `PASS 116 checks`. Probe: a compiled 1-arg raster toy with `params = ["int","int"]` → pristine `cgen-hook: raster() must be a function of one int parameter`; mutant **`cgen ACCEPTED; toy_raster=true`**. The Lua front end still refuses the same shape with `il-type`, so only a hand-built IL program reaches this guard |
| C09 | #31C | `tools/toyc/toy_runtime.c` | a comment-only change to the RCR-chain banner | **NO-OP** | exit 0, `PASS 116 checks`; the comment is stripped, the two ROM shas are unchanged |
| V01 | #32 | `renderer/pce-validate.js` | the cycle table is off one op class: `OP_CYCLES.reg` 24 → 28 (the `pal` row) | **MISSED** | exit 0, `PASS 143 checks`; parallax frame 1203 → **1207** (0.25% off the 1204 TMA, inside the 15% tolerance) |
| V02 | #32 | `renderer/pce-validate.js` | a raster entry's replay cost is compared to 455 cycles, not the blank: `RCR_BLANK` 123 → 455 | **DETECTED** | exit 1: `FAIL road.lua reports the blank overrun once (got 0, want 1)`; `FAIL road.lua's over-blank lines (got 0, want 224)`; `FAILED 3 of 143` |
| V03 | #32 | `renderer/pce-sprites.js` | a CGX sprite is counted as one strip: `requested += cgx ? 2 : 1` → `requested += 1` (a 17-strip line counts as 16 sprites) | **MISSED** | exit 0, `PASS 143 checks`; the 16/17 fixture uses one-strip sprites and is still refused (`worst request 17 strips`). Probe: 9 CGX sprites on line 80 (`sat(i,3,0x100)`) → baseline `requested=18`, `validate-sprite-line`; mutant **`requested=9`, `ok=true`** |
| V04 | #32 | `renderer/pce-validate.js` | the ROM budget is checked at 2 MB: `ROM_LIMIT` 1048576 → 2097152 | **DETECTED** | exit 1: `FAIL rom-1mb is refused`; `FAIL rom-1mb refusal code (got null, want "validate-rom")`; `FAILED 5 of 143` |
| V05 | #32 | `tools/toyc/emit.js` | the export gate is bypassed: `if (!report.ok)` → `if (false && !report.ok)` | **DETECTED** | exit 1: `FAIL emit.js refuses long-frame`; `FAIL the 17-sprite refusal is the validator's, not cgen's`; `FAILED 11 of 143` |
| V06 | #32 | `renderer/pce-validate.js` | the static raster-line range is off by one: `inRange(v, 0, VDW_LINES - 1)` → `VDW_LINES` | **MISSED** (latent) | exit 0, `PASS 143 checks`. Probe: `raster(224, {bxr=0})` reports the host's `raster-line` in **both** trees — the IL materializes the literal into a register, so the static branch never fires |
| V07 | #32 | `renderer/pce-validate.js` | the hard frame ceiling is 7 display frames: `HARD_FRAMES` 8 → 7 | **MISSED** | exit 0, `PASS 143 checks`; the message becomes `over the 7-display-frame ceiling (835226 cycles)` and the fixture is 1,041,159, over both 7 and 8 |
| V08 | #32 | `renderer/pce-validate.js` | the ROM estimate's runtime baseline moves by one byte: `ROM_RUNTIME_BYTES` 6200 → 6201 | **NO-OP** | exit 0, `PASS 143 checks`; no assertion pins the estimate, so a 1-byte drift is invisible (see V09 for why that matters) |
| V09 | #32 | `renderer/pce-validate.js` | the ROM estimate's baseline is wrong by ~5.8 KB: `ROM_RUNTIME_BYTES` 6200 → 12000 | **MISSED** | exit 0, `PASS 143 checks`; palette's estimate 9,277 → **15,077 B**, parallax 10,460 → **16,260 B**; only the 1 MB ceiling is asserted |
| V10 | #32 | `renderer/pce-validate.js` | a raster line with 3 colour words is accepted: `colours > 2` → `colours > 3` | **MISSED** | exit 0, `PASS 143 checks`. Probe: 3 `pal()` writes on line 8 → **mutant `ok=true`, `blank.colours=3`**; baseline `validate-raster-line: VDW line 8 asks for 3 colour words` |
| V11 | #32 | `renderer/pce-validate.js` | a VRAM write from `raster()` is not recorded: delete `vsetFromRaster.push(ins.line)` | **MISSED** | exit 0, `PASS 143 checks`. Probe: `vram[0]=1` in `raster()` → **mutant `ok=true`**; baseline `validate-raster-line: a raster() callback writes VRAM (line 4)` |
| S01 | #77 | `renderer/studio.html` | the save envelope drops an asset: filter `waves.json` out of `files` | **DETECTED** | exit 1: `FAIL the envelope carries every file in order, main.lua first`; `FAIL reopening restores the asset files too`; `FAIL 2 of 438` |
| S02 | #77 | `renderer/studio.html` | the save envelope keeps `palettes.json`'s name but drops its source (source → `""`) | **MISSED** | exit 0, `PASS 438 checks`; the envelope still has five files, `main.lua` and `tiles.json` are the only sources asserted, and save/reopen stays byte-identical because both sides lost the same text |
| S03 | #77 | `renderer/studio.html` | an edit typed in the editor is not written to the file (`onEditorChange`), and `toyEnvelope` no longer syncs it: autosave stores the previous source | **DETECTED** | exit 1: `FAIL the source box handler takes the edit`; `FAIL Check keeps the edited source (no silent revert to the example)`; `FAIL 2 of 438` |
| S04 | #77 | `renderer/studio.html` | Ctrl/Cmd+S is bound to autosave only: `saveToyFile()` → `persistToy()` (no file, no name, no toast) | **MISSED** | exit 0, `PASS 438 checks`; the shortcut test only reads `localStorage`, which `persistToy()` also writes with the marker |
| S05 | #77 | `renderer/studio.html` | the step shortcuts are swapped: Ctrl+. steps back and Ctrl+, steps forward | **DETECTED** | exit 1: `FAIL Ctrl+. steps one frame forward`; `FAIL 1 of 438` |
| S06 | #77 | `renderer/studio.html` | `editorText()` ignores the mounted CodeMirror: always `return $("source").value` | **MISSED** (stub) | exit 0, `PASS 438 checks`; the stub DOM never mounts CodeMirror, so the stale-textarea read is invisible. The optional run **does** catch it: `node tests/check-studio.js --browser` exits 1, `FAIL browser driver: an edit is both the editor text and the running Lua` (+8 more), `FAIL 9 of 475` |

## The eleven MISSED breaks, and the check that would catch each

The eleven are C08, V01, V03, V06, V07, V09, V10, V11, S02, S04 and S06.
C01–C06 are **not** among them — they are DETECTED — but their bullet sits
beside C08 because the detection is conditional on llvm-mos (see residual
weakness 1).

### #31 part C

- **C08 — the emitter's raster-arity guard is unpinned (IL-level).**
  `analyse()` still refuses a *missing* hook, but the one-int-parameter
  contract is no longer checked. This is the emitter's defense in depth at
  the IL boundary: `il.compile` already refuses `function raster(a, b)` with
  `il-type: raster must take 1 parameters`, so no Lua toy reaches the guard.
  But `cgen.emitC(program)` is the exported API and takes any structurally
  valid `pce-il` v1 program; a program with a two-int-parameter raster hook
  is emitted as `toy_raster` with the second C parameter 0. The probe
  measured exactly that (pristine `cgen-hook`, mutant `cgen ACCEPTED;
  toy_raster=true`).
  *Which check would catch it:* the existing `refusal()` helper in
  `tests/check-il-console.js` already takes a mutator. Compile a
  one-parameter raster toy, set
  `p.functions[p.hooks.raster].params = ["int", "int"]`, and expect
  `cgen-hook` — the same pattern the string-constant and jump-target
  refusals use.

- **C01–C06 — not one of the eleven: detected only by the pinned ROM
  sha, and MISSED on a machine without llvm-mos.** The unmodified check
  rebuilds the ROM and compares its sha to `tests/dumps/toyparallax/meta.json`;
  it never re-captures. Every runtime and `reg`-lowering break changes the
  bytes, so the sha catches it — but the frame, state and pixel comparisons
  run against the **committed** dump and still pass. I measured the skip
  path: with `LLVM_MOS=/nonexistent` the check prints
  `SKIP ROM rebuild: llvm-mos not found` and `SKIP raster ROM rebuild` and
  **all six pass 109 checks** (verified individually for C01–C06). On a
  machine without llvm-mos the replay table, the line-0 write, the RCR
  carry, the BXR/BYR order, the chain start and the register mapping are
  all invisible.
  *Which check would catch them:* the same semantic re-run Rule 2 asks for —
  `tools/capture-toy.sh` (Mednafen) on the just-built ROM, diffed against
  the browser, as part of the check; and a missing toolchain must be a
  failure (not `SKIP`) for a card whose evidence *is* the console. A
  toolchain-free alternative is a host-side replay unit test: drive
  `toy_reg` in `MODE_RASTER`, then apply the collected table through the
  same `apply_entry0`/arming rules and compare it with the browser's raster
  table — that reaches C01/C02/C05 without a compiler, and a byte-order
  assertion on the ISR source reaches C03/C04.

### #32

- **V01 — the cycle table is off one op class.** `check-validate.js` pins
  the model only through two ±15% predictions (parallax frame and mean
  raster call). Pricing `reg` as `pal` moves the parallax frame from 1,203
  to 1,207 cycles — 0.25% off the 1,204 TMA — so the tolerance absorbs a
  one-row error. The other blank values (64, 101, 99) come from the RCR
  constants, not the op table.
  *Which check would catch it:* an exact assertion on the table
  (`eq("OP_CYCLES.reg is the manual's 24", MODEL.OP_CYCLES.reg, 24)`, and
  the same for a few rows), or a golden table transcription checked
  wholesale. A tighter tolerance on a toy whose cost is dominated by the
  changed op would work too; the current ±15% cannot see one row.

- **V03 — a CGX sprite is counted as one strip.** The physical budget is
  16-px strips; a CGX sprite spends two. The 16/17 fixture uses one-strip
  sprites, so 17 plain sprites are still refused and the check passes. The
  probe makes the gap concrete: nine CGX sprites on one line
  (`sat(i, 3, 0x100)` sets the CGX bit) are **18 strips** and the pristine
  validator refuses `validate-sprite-line` with `requested=18`; the mutant
  reports `requested=9` and `ok=true`.
  *Which check would catch it:* a CGX fixture in `check-validate.js` — nine
  or more 32-px-wide sprites on one line, expecting
  `validate-sprite-line`, or an assertion that `budgets.sprites.requested`
  equals the strip count (2 per CGX sprite) on a known CGX toy.

- **V06 — the static raster-line range is off by one (latent).** The
  `inRange(v, 0, VDW_LINES - 1)` branch only fires for a *constant*
  `lineArg`. A probe of `raster(224, {bxr=0})` shows the IL materializes
  the literal into a register, so `constantOf` is null and the branch never
  fires; the host's own `raster-line` refusal is what reports the error in
  both the pristine tree and the mutant. The off-by-one is therefore latent
  today, but nothing pins it.
  *Which check would catch it:* a fixture that produces a constant
  `lineArg` and requires the validator's `validate-range` (not only the
  host's `raster-line`), or delete the dead branch and assert the host's
  code at the 0 and 224 boundaries.

- **V07 — the hard frame ceiling is 7 instead of 8.** The `long-frame`
  fixture costs 1,041,159 cycles, over both 7×119,318 and 8×119,318, so the
  refusal code never changes. The message's "7-display-frame ceiling" is
  not asserted.
  *Which check would catch it:* a boundary fixture costing between 7 and 8
  display frames (e.g. ~900,000 cycles) that must be refused with
  `validate-frame-budget`; a companion below 7 must pass. That pins the
  ceiling rather than only the far side.

- **V09 — the ROM estimate's baseline is wrong by ~5.8 KB.** The five toys
  still estimate under 1 MB (palette 15,077 B, parallax 16,260 B), and the
  only ROM assertion is `< limit`. The 8 KiB fixed bank that the actual
  build must fit is not modelled by any assertion, even though the build
  reports are committed under `tools/gen/`.
  *Which check would catch it:* compare the estimate against the committed
  linked size for each toy (a tolerance, say ±15%, over
  `tools/gen/<toy>.json`), and assert the 8 KiB fixed-bank fit where part C
  actually needs it. V08 shows even a 1-byte baseline drift is unpinned;
  V09 shows the same gap is large enough to hide a 5.8 KB model error.

- **V10 — a raster line with 3 colour words is accepted.** The replay
  handler carries at most two; the validator's `colours > 2` is the only
  guard. No fixture has three colour writes on one line, and the five toys
  have at most two (`sky-gradient`).
  *Which check would catch it:* a fixture whose `raster()` writes three
  `pal()` entries on one line, expecting `validate-raster-line` matching
  `/at most 2/`. The probe demonstrates the mutant returns `ok=true` with
  `blank.colours=3`.

- **V11 — a VRAM write from `raster()` is not reported.** Part C drops a
  `vset` from a callback and flags the run; the validator is supposed to
  refuse it. No fixture writes VRAM from `raster()`.
  *Which check would catch it:* a fixture with `vram[0] = 1` inside
  `raster()`, expecting `validate-raster-line` matching `/writes VRAM/`.
  The probe: mutant `ok=true`, baseline refuses at line 4.

### #77

- **S02 — the save envelope keeps an asset's name but drops its source.**
  The check asserts `env.files.length === 5`, `env.files[0].source`, and
  `tiles.json`'s source; `palettes.json`/`sprites.json`/`waves.json`
  content is never compared. Blanking `palettes.json` keeps save/reopen
  byte-identical (both sides lose the same text), so the suite passes.
  *Which check would catch it:* compare **every** file's source in the
  saved envelope with the editor's file set before the save (all five), or
  round-trip the default `palettes.json` text and require it back
  unchanged. The current "the envelope's sources are the editor's exact
  texts" assertion inspects two files, not five.

- **S04 — Ctrl/Cmd+S is bound to autosave only.** `saveToyFile()` writes a
  `.pce.json` download, names it, sets the status and toasts;
  `persistToy()` only writes `localStorage`. The shortcut test asserts the
  stored envelope contains the marker, which both paths satisfy.
  *Which check would catch it:* assert the shortcut reaches the file path —
  e.g. stub/spy `downloadText` (or count the anchor `click()`), and require
  the returned/announced `.pce.json` name and the "Saved …" toast — not
  only the storage write.

- **S06 — `editorText()` reads the stale textarea when CodeMirror is
  mounted.** The stub DOM has no CodeMirror (`editor === null`), so the
  fallback path is identical and `check-studio.js` passes. CodeMirror's
  `fromTextArea` does not keep the textarea value in sync on every change,
  so in a real browser the page would report and run stale text after an
  edit. The measured browser run: `node tests/check-studio.js --browser`
  exits 1 with nine driver failures, starting
  `an edit is both the editor text and the running Lua`, `FAIL 9 of 475`.
  *Which check would catch it:* make the headless-browser run
  (`--browser`) mandatory for this card — its driver already asserts
  `s.editorText() === edited` after `setEditorText` — or install a minimal
  fake `window.CodeMirror` in the stub whose `getValue()` differs from
  `$("source").value` and assert `editorText()` prefers the editor.

## Residual weaknesses worth writing down

1. **Six of the thirteen detections are the pinned ROM sha only.**
   C01–C06 fail because the rebuilt parallax ROM's bytes differ from
   `meta.rom_sha256`; no assertion runs the mutant. With
   `LLVM_MOS=/nonexistent` the check prints two `SKIP` lines and **all six
   pass 109 checks** (measured for every one). The check is honest about the
   skip, but the card's evidence is then unconditional only with llvm-mos
   installed. This is the same shape as #31A's residual weakness 1, and it
   has grown: the part-C handler is now the largest piece of hand-written
   console code with no behavioural instrument.

2. **The frame comparison never re-captures.** `check-il-console.js` reads
   `tests/dumps/toyparallax/frames/`; it does not run `capture-toy.sh`. If
   someone rebuilds and updates `meta.rom_sha256` without re-capturing, the
   old frames still pass. The capture script itself remains outside all
   three instruments (as it was for #31A).

3. **The validator's model is pinned only at two points and only to ±15%.**
   The op-cycle rows (V01), the ROM baseline (V08/V09), the hard ceiling
   (V07), the colour-word cap (V10) and the `vset`-from-raster rule (V11)
   are each unreached by a fixture. The ±15% tolerance is honest for a
   calibrated estimate, but it means a one-row table error is structurally
   invisible; the table's *relative weights* claim needs an exact table
   assertion, not the estimate's tolerance.

4. **The sprite budget has no CGX fixture.** V03's undercount is the exact
   shape of #50's model (the budget is strips, not sprites). The 16/17
   boundary fixture is good but is made of one-strip sprites, so the CGX
   half of the hardware budget is untested. The same gap applies to the
   sprite pattern-cell VRAM check (`vramBudget`), which no fixture reaches.

5. **The save envelope is compared on two of five files.** S02 is the
   content-drop version of the same gap that S01 catches at the file-count
   level. "The envelope's sources are the editor's exact texts" should mean
   all five.

6. **`check-studio.js`'s default run cannot see CodeMirror.** The stub DOM
   tests the textarea fallback; the CodeMirror paths (`editorText()`,
   `editor.on("change")`, the real keymap) are only exercised by the
   optional `--browser` driver. S06 is the one break that difference
   hides; a CodeMirror change-handler bug would be hidden the same way.

## What is left

- Eleven new cards, one kind up from each instrument's builder: C08
  (raster-arity refusal), V01 (an exact op-table assertion), V03 (a CGX
  sprite fixture), V06 (a constant-`lineArg` range fixture or delete the
  dead branch), V07 (the 7/8-frame boundary), V09 (the ROM estimate vs the
  committed linked sizes), V10 (three colour words on a line), V11 (a
  `vset` from `raster()`), S02 (all five file sources), S04 (Ctrl+S reaches
  the file path), S06 (CodeMirror's `editorText()` in the stub or a
  mandatory `--browser`).
- The six sha-only console detections (C01–C06) should get either a
  required (non-skipped) rebuild plus a Mednafen re-capture, or a
  toolchain-free replay unit test, before part C is treated as
  machine-independent evidence. The replay handler is the part most in need
  of an instrument that does not depend on llvm-mos.
- No NO-OP was a bug: C09 (a comment) and V08 (a 1-byte baseline) cannot
  change behaviour that any check or user sees. V08's real lesson is that
  the same unpinned baseline lets V09's 5.8 KB error through.
