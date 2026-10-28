# #74 — REVIEW-30's three misses and V1, re-run against the checks that close them

Card #74. Work by @test. The breaker (`docs/REVIEW-30.md`, commit `8ff85b6`)
injected 14 breaks against the #30 toy runtime and the #69 viewer handler:
9 DETECTED, 3 MISSED, 2 NO-OP. This card adds the checks the breaker's
*which check would catch each* section named, re-runs the three misses and
the dispatch no-op against them, and writes down what the new checks still
cannot see.

Baseline at the commit this adds to, in the working tree:

- `node tests/check-toys.js` — `PASS  757 checks, 3 toys x 40 frames diff 0,
  every refusal by code`.
- `node tests/check-viewer.js` — `PASS: … on 35 capture(s), and 2 first-frame
  trace fixture(s) check out`.
- `node tests/check.js` — `PASS: renderer matches Mednafen pixel for pixel on
  82 scene(s)` (r13 is the 82nd; see below).

## What was added

### A6 — pads 1–5 are distinct (`check-toys.js`, `checkPadDistinct`)

REVIEW-30 measured that only pad 1 was ever driven or read, so `pad[n]`
reading `pad[1]` passed. Pads 1–5 now get a button no other pad has
(`right`, `down`, `left`, `up`, `i`), a toy prints all eight fields of every
pad, and a second frame changes every pad's buttons. Ten exact log lines are
asserted, so a mirror or any cross-wiring changes a line.

### A7 — the password round trip at every cap (`check-toys.js`)

The caps are the checks card #73 added: a 64-byte string (`P_MAX_STRING`), a
32-entry table, a table 6 deep, the `P_MAX_BYTES` edge, and the integer
edges `0`, `±(2^30-1)`, `-2^30`. A cap that cannot unpack now fails inside
`rt.load()`; that throw is caught and reported as this check's FAIL with
the refusal code, not as an uncaught exception that could equally be a
broken checker. This is the one place #74 leans on another card's check —
the break re-run below confirms it catches A7.

### A12 — a frame count the loop cannot fake (`check-toys.js`)

Every one of the three toy loops, and a fourth toy whose `frame()` increments
and prints its own counter, asserts the frames actually run:

- `rt.frameCount + 1 == FRAMES` after each loop (the host records the frame
  index it was given; `recordFrames`);
- the counting toy's own `frame()` counter — printed every call, so a
  duplicated call shows too — equals `FRAMES`.

The summary banner prints `framesRun`, the smallest measured count, instead
of the `FRAMES` constant. It can no longer say 40 after running 39.

### V1 — a MIXED-op raster fixture (`tools/genreview16.py r13`, dumps)

`r13` is 232 steps, one per VDW line, alternating the two handler shapes:

| step | shape | value |
|---|---|---|
| even (`line = s+1`, s even) | colour-only, `op` bit 3 | CRAM[0x001] = `raster_ramp(s)` — a band hue the picture shows |
| odd | BYR-only, `op` bit 1 | `(s*7) & 0x1FF` — a per-line row shift on the diagonal bands picture |

The scene ROM (`raster13`, real Mednafen capture, the renderer's diff-0
oracle) runs the same table with a bespoke alternating handler in
`tools/genreview16.py` (an exactly-once patch of genroms.py's `byr_table`
handler). The viewer ROM (`vraster13`) is `genviewer.py`'s ordinary build of
that table. Both live in `genreview16.py` because r11/r12 already do and
`tools/genroms.py` is another card's file.

The fixture was verified before it was used as evidence:

- `node tests/check.js`: `raster13: OK (256x232, diff 0)`, 82 scenes.
- `node tests/check-viewer.js`: `vraster13: OK (frame diff 0, table matches
  the save state and the raster13 state)`, 35 captures.
- saved state: `BXR=0 BYR=81 CR=0x84 RCR=0x41 RCRCount=237`; the table has
  232 entries, every one exactly `byr`-only or `cram`-only (checked), so
  every step changes the selected handler.

`check-viewer.js` now requires `vraster13` by name and requires its table to
still mix the two shapes. Deleting the fixture or homogenizing it fails the
suite instead of quietly shrinking the evidence. Both were exercised:

- homogenized (232 colour-only steps): `vraster13: the fixture does not MIX
  the step shapes (colour-only 232, BYR-only 0) — the #74 dispatch witness
  is gone`, exit 1;
- renamed away: `vraster13: MISSING — the #74 mixed-op dispatch fixture is
  required …`, exit 1.

## The re-runs — all four DETECTED

Each break was applied alone to a fresh isolated copy of the tree under
`$TMPDIR/pce74/`; the checks were unmodified. Every output below is copied
from the run's log.

| # | break | verdict | measured output |
|---|---|---|---|
| A6 | `refreshPads` makes every `pad[n]` read `pad[1]` | **DETECTED** | exit 1, `FAIL 8 of 757 checks failed`; e.g. frame 0 pad 5 got pad 1's `right=true` where its own `i=true` was wanted |
| A7 | `p_dec` rejects `len >= P_MAX_STRING`, so a 64-byte string does not unpack | **DETECTED** | exit 1, `FAIL 1 of 747 checks failed`; `the cap toy loaded and ran (got password-code: pce-toys-kit.lua:114: a bad string length in the code)` |
| A12 | every frame loop runs `FRAMES - 1` frames (all five loops, including the counting toy) | **DETECTED** | exit 1, `FAIL 6 of 740 checks failed`; `the toy's last count is the frame count (got "39", want "40")`, and each toy's host count reports 39 |
| V1 | `prestep_vec` no longer stores `$2240/$2241`; boot stores step 0's handler (`irq1_c1`) once | **DETECTED** | exit 1; `saved BYR=0 != table's 81 (last byr entry 232)`, `cram entry 0: table 1ff != state 0`, `vraster13: 100256 differing pixels of 178176 bytes` (e.g. `px(0,0) renderer=252,252,252 viewer=0,0,0`); the other 35 captures stay green — the reviewer's no-op on homogeneous tables is preserved |

V1's mutant ROM really differs from the pristine one: sha256
`8b5e29b4…` vs `4b17f6d9…`. The mutant capture is the ROM's own Mednafen
state (`vraster13.d81414b9…mca`, saved by SIGINT to the child PID), not the
pristine dump — the first attempt reused the 20:51 state and was discarded;
its log would have shown `BYR=81`, the pristine value. The capture used a
PID-scoped copy of `tools/capture.sh`'s own route because several seats were
capturing at once and the committed script's `pkill -x mednafen` killed a
run of ours (and ours would kill theirs); see the last blind spot.

## What these checks do NOT prove

- **A7 is the builder's check.** Card #73 wrote the cap round trips; #74
  re-ran A7 against them but did not break the other new edges (#73's
  past-cap refusals, the two forged codes, `-2^30` decoding). Rule 2 still
  wants a cold break of #73 itself.
- **Pads are checked on the Lua front end only.** `check-toys.js` drives
  `renderer/pce-toys.js`; the IL front end (`renderer/pce-il.js`) shares
  `pce-toyhost.js`'s `padValue`, but nothing here drives pads 2–5 through
  the IL. A regression that only affects the IL's pad plumbing would be
  invisible.
- **The frame count proves calls, not content.** It asserts the loops ran 40
  frames and each frame was compared (the per-frame checks do that), but it
  does not assert that the 40th frame differs from an earlier one — a toy
  frozen after frame 0 would pass the count. The per-frame hand-built
  comparison already catches a frozen state for the three shipped toys; a
  new toy with a constant frame would not be a witness for anything.
- **V1's fixture witnesses one switch, not the dispatch machinery.** It
  exercises `prestep_c1` (op `0x08`) ↔ `prestep_gen` (op `0x02`). It does
  not use `prestep_c2` (op `0x10`, second word only), the `0x18`
  two-word stub, or a switch between two stubs of the same shape; a stale
  vector is caught here because the wrong stub writes a different *kind* of
  field. The mixed register-plus-two-colour-word step is still unwitnessed
  because #69 says it cannot fit the blank at any stride — that remains
  written on #69 as not proven, not closed over here.
- **The scene ROM is an oracle, not the code under test.** `raster13`'s
  bespoke handler is #74's own patch, so the scene capture proves the table
  and the viewer share a picture, not that viewer.asm's dispatch is right.
  The dispatch verdict rests on `vraster13`'s saved state and frame against
  `raster.json`, which is independent of the scene handler.
- **Mednafen, not hardware.** The witness is the emulator's frame and save
  state; a real console's interrupt timing is not measured. Nothing here
  says the per-step dispatch design is the right design — that is review's
  and the human's question.
- **The committed capture route is unsafe on a shared machine.**
  `tools/capture.sh` does `pkill -x mednafen` at start and end; during this
  card two concurrent-seat captures collided with ours (one lost its state,
  one silently reused an older state file — caught because the check then
  failed the table and pixels). The evidence above was taken with a local,
  PID-scoped copy of the same route (no global pkill, sends SIGINT only to
  its own child, refuses to start if any Mednafen is running) under
  `$TMPDIR`; the committed script still has the hazard REVIEW-30 wrote down,
  now measured rather than hypothetical.
