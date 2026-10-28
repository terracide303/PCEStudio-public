# Rule 2 breaker (#30 and #69) — a different seat breaks the toy runtime and the two-word CRAM step

Reviewer: @review (breaker seat; #30's runtime/check and #69's handler were
built by other seats). Read cold from the repository. Date 2026-10-28.
**Nothing was fixed; this is the list.** Rule 2 in
[`../../workshop/RULES.md`](../../workshop/RULES.md): a test is proven by
breaks someone else chose.

Card **#30** is commit `39d0215` — the toy runtime (`renderer/pce-toys.js`),
the page (`renderer/toys.html`), the vendored Fengari, and its evidence
(`tests/check-toys.js`). Card **#69** is commit `6561aef` — the per-step
handler dispatch and the colour-only stubs in `tools/viewer.asm`, witnessed
by `tests/check-viewer.js` and the `raster12`/`vraster12` capture.

At the time the working copy was taken the tree was at `4ca6bef`; the four
files this review mutates were then byte-identical to the reviewed commits,
checked with `git show <rev>:<path> | cmp - <file>`
(`renderer/pce-toys.js`, `tests/check-toys.js`, `tests/check-viewer.js` at
`39d0215`; `tools/viewer.asm` at `6561aef`). Other seats have edited the
tree since; the real tree was never edited by this seat — this document is
its only change.

## What I ran

- **One isolated copy** of the repository under
  `$TMPDIR/pce-break30/` (`rsync -a --exclude .git`). Every break was applied
  there, one at a time, to a freshly restored copy of the target file; the
  real files were not touched.
- **#30 baseline:** `node tests/check-toys.js` in the copy before any break:
  `PASS  718 checks, 3 toys x 40 frames diff 0, every refusal by code`.
  Each #30 break was then applied alone to `renderer/pce-toys.js` and the
  **unmodified** `tests/check-toys.js` run (`node tests/check-toys.js`,
  exit code recorded).
- **#69 baseline:** `node tests/check-viewer.js` on the committed dumps:
  `PASS: … match the renderer pixel for pixel on 34 capture(s), and 2
  first-frame trace fixture(s) check out`. A fresh baseline rebuild and
  re-capture of `vraster12` also passed (`vraster12: OK (frame diff 0, table
  matches the save state and the raster12 state)`), so the instrument is the
  copy's own build, not a stale dump.
- **#69 build route:** the `vraster12` viewer is built by
  `python3 -I tools/genreview16.py r12 --viewer`, not by the Makefile
  (`VRASTERS` stops at 10 and `genviewer.py`'s CLI rejects `vraster12`;
  `genreview16.py` calls `genviewer.build("vraster12")` directly, as its
  usage says). Each break was applied alone to `tools/viewer.asm`, the ROM
  rebuilt that way, `bash tools/capture.sh 12 vraster` re-captured
  **only in the copy**, then the **unmodified** `node tests/check-viewer.js`
  ran. Every rebuilt ROM's hash differs from the pristine one.
- **No synthetic input.** `tools/capture.sh` uses the command line, the
  `-pce.slstart/slend` crop, SIGINT for a clean exit and `mcs-extract.py` /
  `movframes.py`; no keyboard or mouse event was sent. The unmodified script
  was used as the card directs: its movie scratch is its own hard-coded
  `SCRATCH=/Volumes/External II/scratch`, its Mednafen saves go to
  `$HOME/.mednafen/mcs`, and it logs under `$TMPDIR` (`LOGDIR`); my own
  scratch (the copy, mutant harness, probes, logs and captured dumps) is
  under `$TMPDIR/pce-break30*`. No `/tmp` path was used. **Shared-machine
  caveat:** the script's `pkill -x mednafen` kills any Mednafen by name; no
  Mednafen was running when I checked, but another seat starting one during
  a capture would lose it.
- **Verdicts:** **DETECTED** = the check exits non-zero. **MISSED** = the
  check exits 0 but a probe shows the mutant's behaviour differs from the
  pristine code. **NO-OP** = the check exits 0 and the mutant cannot change
  any captured frame (verified where possible by a probe or a byte compare).

## Coverage measured before choosing breaks

- `check-toys.js` exercises pads **1 only** (`checkSpriteToy` sets
  `rt.setPad(1, …)`; `checkPage` reads pad 1); pads 2–5 are constructed but
  never driven or read.
- `checkPasswords` packs one value (`score = 1234`, `level="C3"`,
  `flags={true,false}`, `name="PCE"`) and one plain number pair; it does not
  test any value at a format cap (`P_MAX_STRING` 64, `P_MAX_ITEMS` 32,
  `P_MAX_DEPTH` 6, `P_MAX_BYTES` 96, or the 32-bit integer bound).
- `checkRasterToy` drives the callback form; `checkRasterForms` drives the
  table form with **one** entry. No check registers table-form entries out of
  line order at the `raster()` call site.
- All 12 shipped `vraster` tables are **homogeneous**: every step in a table
  has the same `r_op` byte, so the #69 per-step dispatch always selects the
  same handler the boot call selected (`raster12`/`vraster12`: 232 steps,
  `r_op = 0x18` throughout; scanned from `tools/gen/vraster12/raster.bin`).
- The `raster12` scene has `frameCounter: true`, so two clean captures differ
  in `mednafen.png`, `cram.bin` and the patched `raster.json` (measured:
  table entry 0 = `0x15` in one clean run, `0x10` in another). Cross-capture
  byte equality is therefore **not** a valid no-op test on this fixture; the
  table scan and the self-consistent `check-viewer` pass are used instead.

## The table — #30, 12 breaks

All against `renderer/pce-toys.js` (commit `39d0215`), check-toys unmodified.

| # | break, applied one at a time | site | verdict | measured output |
|---|---|---|---|---|
| A1 | `frame(t, f)` called with **t and f swapped** (push `f, f/60`) | `renderFrame` (`pce-toys.js:956-959`) | **DETECTED** | exit 1; the first toy frame throws `[ToyError: a colour word must be an integer 0..511] { code: 'pal-range' }` — the toy's `f` is now `0/60`, a float, and `pal()` refuses it. |
| A2 | `raster(line)` called **one line late** (`line + 1`) | callback loop (`pce-toys.js:973-975`) | **DETECTED** | `FAIL  161 of 718 checks failed`; `FAIL raster f39 table matches the hand-built table`, `FAIL raster f39 pixels diff 5344 (first byte 5385)`, `FAIL refusal a colour write past the line's budget was accepted`. |
| A3 | raster entries **not sorted** (`entries.sort` removed) | `buildRasterTable` (`pce-toys.js:899`) | **NO-OP** | `PASS  718 checks`. Probe: table-form `raster(200)`, `raster(3)`, `raster(100)` yields `3,100,200` before and after — JS enumerates integer-index keys ascending, and the callback form pushes ascending. |
| A4 | register write **bypasses the range refusal** (`lua_tointeger`, no bounds) | `reg()` (`pce-toys.js:595`) | **DETECTED** | `FAIL  2 of 718`: `refusal BXR past 10 bits was accepted (wanted reg-range)` and the same for BYR. |
| A5 | **pad bits inverted** (`!v` in the pad closure) | `refreshPads` (`pce-toys.js:762-764`) | **DETECTED** | `FAIL  39 of 718`; e.g. `sprite f34 sat differs at byte 0: 59 != 69`. |
| A6 | **`pad[n]` reads `pad[1]`** for every n | `refreshPads` (`pce-toys.js:759`) | **MISSED** | `PASS  718 checks`. Probe: pristine `pad1/pad2 true/false`, mutant `pad1/pad2 true/true`. |
| A7 | password **pack/unpack does not round-trip a value at its maximum** (`p_dec` rejects `len >= P_MAX_STRING`) | `p_dec` (`pce-toys.js:327`) | **MISSED** | `PASS  718 checks`. Probe: a 64-byte (`P_MAX_STRING`) string — pristine `packed 111`, `back 64 equal=true`; mutant packs 111 chars then `THREW password-code … a bad string length in the code`. |
| A8 | **sandbox lets `os` through** (open it, stop nil'ing it) | `openSandbox` (`pce-toys.js:498-514`) | **DETECTED** | exit 1; the sandbox toy's assert throws `[ToyError: toy.lua:3: a host door is still open] { code: 'toy-error' }`. (`io` cannot be opened at all in this Fengari bundle — `luaopen_io` is undefined — so `os` is the reachable door; see below.) |
| A9 | **SAT writes ignored after init** (early return once `initialized`) | `sprite()` (`pce-toys.js:646-647`) | **DETECTED** | `FAIL  40 of 718`; e.g. `sprite f35 sat differs at byte 0: 0 != 68` (the SAT stays zero). |
| A10 | **palette writes applied a frame late** (buffer `pal`, flush at next frame) | `pal()` (`pce-toys.js:607-608`) | **DETECTED** | `FAIL  120 of 718`; e.g. `raster f35 cram differs at byte 4: 144 != 153`. |
| A11 | **the toy's hardware state reset each frame** (`vram/cram/sat` cleared, regs reset) | `renderFrame` (`pce-toys.js:950-951`) | **DETECTED** | `FAIL  319 of 718`; e.g. `sprite f39 vram differs at byte 8192: 0 != 255`, `raster` and `sprite` cram/regs fail. |
| A12 | **the 40-frame loop runs 39** (`f < FRAMES - 1` in all three toys) | `tests/check-toys.js` loops | **MISSED** | `PASS  701 checks, 3 toys x 40 frames diff 0` — 17 checks fewer, and the banner still claims **40** because it prints the constant `FRAMES`, not a run count. |

## The table — #69, 2 breaks

All against `tools/viewer.asm` (commit `6561aef`), rebuilt and re-captured
as above; check-viewer unmodified.

| # | break, applied one at a time | site | capture | verdict | measured output |
|---|---|---|---|---|---|
| V1 | **the dispatch vector is not updated for the next step**: prestep no longer stores `$2240/$2241`; boot stores step 0's handler once | `prestep_vec` (`viewer.asm:577-580`) and boot after `jsr prestep` (`viewer.asm:365`) | vraster12 | **NO-OP** | ROM differs from pristine (sha256 `2a1bb4b6…` vs `89b0329c…`, 241 bytes), but `check-viewer` exits 0: `vraster12: OK (frame diff 0, table matches the save state and the raster12 state)`, `PASS: … 34 capture(s), and 2 first-frame trace fixture(s)`. Every step's `r_op = 0x18`, so boot and every tail select `irq1_c12`; the store writes identical bytes. |
| V2 | **the colour-only stub writes the high byte first** (swap the `nv_hi`/`nv_lo` stores for both words in `irq1_c12`) | `irq1_c12` (`viewer.asm:608-625`) | vraster12 | **DETECTED** | exit 1: `vraster12: raster.json does not match the save state: cram entry 0: table 1a != state ff`, `vraster12: 148992 differing pixels of 178176 bytes` (e.g. `px(0,0) renderer=252,108,72 viewer=252,108,252`), `FAIL: 1 … capture(s) … differ`. |

## The misses — which check would catch each

- **A6 — `pad[2]` reading `pad[1]`.** No check drives or reads pads 2–5:
  `checkSpriteToy` only calls `rt.setPad(1, …)` and the toy only reads
  `pad[1]`, so a mirror is invisible. **Check that would catch it:** in
  `checkSpriteToy` (or a small `checkPadDistinct`), set pad 1 with
  `right=true`, set pad 2 with `down=true`, and assert the toy prints
  `pad[1].right/pad[2].right == true/false` and `pad[2].down/pad[1].down ==
  true/false`. One assertion that `pad[2]` is *not* `pad[1]` when they are
  given different buttons is enough.
- **A7 — the password does not round-trip a value at its maximum.**
  `checkPasswords` packs only a short value (`#code` ≈ 6 for 1234), and
  `P_MAX_STRING`/`P_MAX_ITEMS`/`P_MAX_DEPTH`/`P_MAX_BYTES` are never
  reached. **Check that would catch it:** extend `checkPasswords` with one
  round trip per cap — a 64-byte string (`string.rep("A", 64)`), a 32-item
  table, a table nested 6 deep, the largest value that fits `P_MAX_BYTES`,
  and the 32-bit integer bounds — each packed, unpacked and compared for
  equality (and its code length kept `P1`/base32). The 64-byte case is the
  measured miss; the integer case also exposes the live bug below.
- **A12 — the 40-frame loop runs 39.** This break is *in the checker*, so
  there is no "unmodified check" to run against it; the measurement is that
  the shortened checker passes, and nothing it prints notices. The banner
  is built from the constant (`"3 toys x " + FRAMES`), so it still says 40.
  **Check that would catch it:** count the frames actually run — e.g. a toy
  that increments a counter in `frame(t,f)` and prints it in the next
  helper, asserted `== FRAMES`, or assert the per-toy check count equals
  `FRAMES ×` the per-frame checks; and derive the banner from that counter
  instead of `FRAMES`.

## The no-ops

- **A3 — sorting the raster entries is redundant on every reachable
  table.** `tableEntries` is keyed by numeric line strings; JavaScript's
  `for…in` enumerates integer-index keys in ascending order, and the
  callback form pushes in `line = 0..223` order. Removing the sort leaves
  the table identical (probe: `3,100,200` both ways; the check's JSON table
  compare passes for all 40 frames). It is harmless today, not defence in
  depth: if a future path ever keys entries by a non-integer or inserts
  them another way, the sort is the guarantee and the check would need a
  deliberately shuffled registration order to see it.
- **V1 — a stale dispatch vector is invisible on every shipped table.**
  #69's per-step handler selection is exercised every step, but every
  shipped table is homogeneous, so the handler chosen at boot equals the
  one prestep would choose for every later step. The mutant's ROM really
  differs (241 bytes; the boot store replaces 232 identical tail stores)
  and the capture still passes. **Capture that would catch it:** a table
  that mixes op shapes — one `0x18` step and one `0x08`/`0x02` step — would
  be dispatched to the wrong stub on the second step (the stub would write
  CRAM instead of a VDC register). #69's own comment says such a mixed step
  "cannot fit the blank at any stride and none ships", so this is a latent
  path, not a current defect; the review's point is that the dispatch
  machinery has **no witness at all** today, which should be written on the
  card as not proven rather than closed over.

## Found in the original — the 32-bit integer cap overflows

Not injected; found while probing the password maximum. The vendored
Fengari build uses **32-bit signed integers**: measured inside the toy VM,
`math.type(2147483647)` is `integer`, but `2147483647 * 2` is `-2` and
`2147483647 + 1` is `-2147483648`. `p_enc` accepts any integer up to
`2147483647` and then zig-zags it with `n * 2`; for `|n| >= 2^30` that
overflows negative, and `p_int`'s `z = floor(z / 128)` stays at `-1`
forever, so the toy burns its whole budget and is stopped by the instruction
hook:

- pristine `password.pack(1073741823)` → `14 1073741823` (round-trips);
- pristine `password.pack(1073741824)` → `THREW toy-timeout` (hangs);
- pristine `password.pack(2147483647)` → `THREW toy-timeout`.

So the documented 32-bit cap is not saveable at either end (`-2147483648`
packs only because the negation promotes to a float). `checkPasswords` misses
it because it never packs a large number. **Check that would catch it:** the
cap round trips above (`±(2^30)` and the `-2147483648`/`2147483647`
bounds). This is a real card, not a rule-2 gap only: the refusal code meant
for "a save value that cannot be packed" never fires; the toy times out
instead. It should be routed one kind up from the test's builder, per rule 2.

## Counts

- #30: **8 DETECTED, 3 MISSED, 1 NO-OP** of 12 breaks.
- #69: **1 DETECTED, 1 NO-OP** of 2 breaks.
- Total 14 injected: **9 DETECTED, 3 MISSED, 2 NO-OP**; plus **1 found in
  the original** (the 32-bit password cap), not injected.
- The three MISSED are A6 (`pad[2]`), A7 (password maximum) and A12 (the
  test's own frame count); the two NO-OPs are A3 (sort) and V1 (dispatch
  vector).
