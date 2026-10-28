# Rule 2 breaker (#31 part A, #73, #29) — the console backend, the password caps and the example toys, broken 20 ways

Reviewer: @review (DeepSeek Flash seat). Date 2026-10-28. The builders of
the three targets were different seats. This is a cold break: the repository
only, no briefing. **Nothing was fixed; this is the list.** Rule 2 in
[`../../workshop/RULES.md`](../../workshop/RULES.md): a test is proven by
breaks someone else chose.

The targets:

- **#31 part A** (`c2e9abe`): `renderer/pce-cgen.js`, `tools/toyc/`,
  `tools/build-toyc.sh`, `tools/capture-toy.sh`, `tests/check-il-console.js`.
  The instrument is `node tests/check-il-console.js`.
- **#73** (password caps): `renderer/pce-toys.js` (the `PASSWORD` object and
  the `p_*` prelude). The instrument is `node tests/check-toys.js`.
- **#29** (example toys): `toys/*.lua`, `tests/check-examples.js`. The
  instrument is `node tests/check-examples.js`.

## What I ran

- **Pinned tree.** Another seat was editing `renderer/pce-cgen.js` (and
  later `tools/toyc/toy_runtime.h`) for #31 part C in the shared working
  tree while this review ran; `HEAD` also advanced from `50a179d` to
  `13dad81` under other seats during the session. The review is therefore
  pinned to a `git archive` copy made at `50a179d`
  (`$TMPDIR/review31a/base-head`), not the working tree. The #31-A files
  in the archive are byte-identical to `c2e9abe`, and
  `git diff c2e9abe..13dad81 -- <the files above>` is empty, so the later
  commits do not touch the reviewed code. The real repository was never
  edited.
- **Baseline, unmodified.** `node tests/check-il-console.js` exit 0,
  `PASS 47 checks`; `node tests/check-toys.js` exit 0, `PASS 757 checks`;
  `node tests/check-examples.js` exit 0, `PASS 4288 checks`. (One baseline
  `check-examples` run failed 1 of 4288 while another check ran in parallel;
  five serial runs then passed. The only wall-clock assertion is
  `worstMs < 100`; see residual weakness 5.)
- **Sandbox.** Each break was applied to a fresh copy of the archive. A
  Python harness asserts the target string occurs exactly once in the copy,
  substitutes it, and runs the **unmodified** check with the copy as cwd.
  The mutants and logs are under `$TMPDIR/review31a/` (`driver.py`,
  `m07.py`, `probes/`); no scratch file was written to `/tmp`.
- **No Mednafen, no keyboard or mouse.** The console runs in the check are
  the committed `tests/dumps/toypalette/` frames; the only console build was
  `tools/build-toyc.sh` with llvm-mos at
  `/Volumes/External II/pce-tools/llvm-mos/llvm-mos`.
- **Result classes.** `DETECTED` = the unmodified check exits non-zero and
  names the broken property. `MISSED` = the check exits 0 and prints
  `PASS`, and a direct probe on the mutant then shows it changes behaviour
  on a legal input no fixture reaches. `NO-OP` = the changed code cannot
  change behaviour for any legal input. There are no NO-OPs: all four
  misses are live on a legal input class the suite does not have.
- **One break at a time.**

## The table

Counts: **20 breaks — 16 DETECTED, 4 MISSED, 0 NO-OP.** (#31-A: 10/11
caught; #73: 3/5 caught; #29: 3/4 caught.)

| # | card | file | break, applied one at a time | result | measured output |
|---|---|---|---|---|---|
| C01 | #31A | `renderer/pce-cgen.js` | subtraction operands swapped: `lhs - rhs` → `rhs - lhs` in the `arith sub` lowering | **DETECTED** | exit 1: rebuilt ROM sha `b15c618b…` != committed `c6296524…`; `FAIL 1 of 47` |
| C02 | #31A | `renderer/pce-cgen.js` | jump target one instruction late: every `goto Ltarget` → `goto L(target+1)` (labels emitted for every pc, plus a label at `code.length`, so it still builds and links) | **DETECTED** | exit 1: it compiles, then the ROM sha is `af3af80c…` != `c6296524…`; `FAIL 1 of 47` |
| C03 | #31A | `renderer/pce-cgen.js` | Lua `//` rounds toward zero: delete `if (r != 0 && ((r < 0) != (y < 0))) q--;` from `il_lua_idiv` | **MISSED** | exit 0, `PASS 47 checks`. Palette C is byte-identical (7,869 B both); an idiv toy's C is 2,524 → 2,482 B and loses `if (r != 0 && …) q--;` |
| C04 | #31A | `tools/toyc/toy_runtime.c` | frame counter starts at 1: `for (f = 0;; f++)` → `for (f = 1;; f++)` | **DETECTED** | exit 1: ROM sha `71559bd4…` != `c6296524…`; `FAIL 1 of 47` |
| C05 | #31A | `tools/toyc/toy_runtime.c` | palette writes one frame late: `toy_pal` buffers, `pal_flush()` runs after the next VBlank wait | **DETECTED** | exit 1: ROM sha `5a78c89e…` != `c6296524…`; `FAIL 1 of 47` |
| C06 | #31A | `tools/build-toyc.sh` | ROM header/bank byte wrong: after linking, patch byte `$1FFF` (`$FFFF`, the high byte of the reset vector) to `$C2` | **DETECTED** | exit 1: ROM sha `bef59f4e…` != `c6296524…`; `FAIL 1 of 47`. The image is headerless (see residual weakness 3) |
| C07 | #31A | `tools/toys/palette.lua` + `tests/check-il.js` | capture has two valid alignments: shorten the palette cycle `%8` → `%4`, rebuild, update `meta.json`'s sha, regenerate the last 8 movie frames from the mutated browser toy | **DETECTED** | exit 1: `FAIL exactly one frame alignment matches the browser's run (got 2, want 1)`; `FAIL 1 of 24` |
| C08 | #31A | `renderer/pce-cgen.js` | emitter not deterministic: `emitCount++` included in the C front matter | **DETECTED** | exit 1: `FAIL the C emitter is deterministic` (`emit 1.` vs `emit 2.`); `FAIL 1 of 47` |
| C09 | #31A | `renderer/pce-cgen.js` | refusal code wrong: no-frame-hook raises `cgen-op` instead of `cgen-hook` | **DETECTED** | exit 1: `FAIL cgen refusal no frame hook code cgen-op (wanted cgen-hook)`; `FAIL 1 of 47` |
| C10 | #31A | `tools/toyc/toy_runtime.h` | `rgb()` swaps red and green: `g*64 + r*8` → `r*64 + g*8` | **DETECTED** | exit 1: ROM sha `6b19e00a…` != `c6296524…`; `FAIL 1 of 47` |
| C11 | #31A | `tools/toyc/toy_runtime.c` | palette address off by one: `toy_pal` writes `addr + 1` | **DETECTED** | exit 1: ROM sha `6f43e7f7…` != `c6296524…`; `FAIL 1 of 47` |
| P12 | #73 | `renderer/pce-toys.js` | zig-zag wraps at 2^30: remove `v < P_MIN_INT or v > P_MAX_INT` from the number check (the original live bug) | **DETECTED** | exit 1, 3 refusals: `refusal an integer past 2^30-1 code toy-timeout (wanted password-value …)`, likewise below -2^30 and the 32-bit maximum; `FAIL 3 of 757` |
| P13 | #73 | `renderer/pce-toys.js` | six-digit guard removed: delete the `shift >= 268435456` "too long" guard in `p_rdint` | **DETECTED** | exit 1: `FAIL refusal a code whose number has too many digits was accepted (wanted password-code)`; `FAIL 1 of 757` |
| P14 | #73 | `renderer/pce-toys.js` | forged P1 code accepted: delete the `sum ~= bytes[#bytes]` check-byte guard in `password.unpack` | **MISSED** | exit 0, `PASS 757 checks`. Probe: a genuine `{score=10}` code with its check byte 86 → 87 is refused in the pristine tree (`password-code: the check byte does not match`) and **accepted** in the mutant (`ACCEPTED table 10`) |
| P15 | #73 | `renderer/pce-toys.js` | max string cap off by one: `maxString: 64` → `65` | **DETECTED** | exit 1: `FAIL refusal a string past 64 bytes was accepted (wanted password-value)`; `FAIL 1 of 757` |
| P16 | #73 | `renderer/pce-toys.js` | max code length cap removed: delete the `#code > 200` refusal | **MISSED** | exit 0, `PASS 757 checks`. Probe: a valid 3,439-character code (a 32×64-byte table, 2,148 bytes) is refused in the pristine tree (`the code is longer than any password`) and **accepted** in the mutant (`ACCEPTED table 32 64`) |
| E17 | #29 | `toys/parallax.lua` | raster entry one line low: band 1's `line == BAND_H` → `BAND_H + 1` | **DETECTED** | exit 1: `FAIL parallax: band 1 has a BXR entry at line 56 and no BYR`; marker at x=13, want 43; `FAILED 2 of 4288` |
| E18 | #29 | `toys/status-bar.lua` | sprite budget exceeded: `reg("CR", 0xC0)` + 17 sprites on display line 100 | **DETECTED** | exit 1: `FAIL status-bar: no sprite overflow (OR) on any line`; `FAILED 1 of 4288` |
| E19 | #29 | `renderer/pce-il.js` | Lua and IL compared on the same run: `il.create` delegates to `require("./pce-toys.js").create` | **MISSED** | exit 0, `PASS 4288 checks`. Probe: the "IL" accepts `for k in pairs({})` (pristine: `il-for-in`) and `rt.program` is `undefined` |
| E20 | #29 | `toys/sky-gradient.lua` | sun colour one step wrong: `5 +` → `4 +` in the green channel | **DETECTED** | exit 1: `FAIL sky: the sun's colour is rgb(7,7,1) at frame 60 (got [252,216,36], want [252,252,36])`; `FAILED 1 of 4288` |

## The four MISSED breaks, and the check that would catch each

- **C03 — Lua `//` rounds toward zero.** The palette toy uses `%` and `<<`,
  not `//`, so `uses.idiv` is false and the emitted palette C is
  byte-identical (7,869 B in both trees). The check never compiles a toy
  that reaches `il_lua_idiv`, although `validate()` admits `idiv` as a
  supported operation. A toy with
  `function frame(t, f) local x = -7 pal(1, x // 2) end` emits 2,524 B in
  the pristine tree and 2,482 B in the mutant, with the floor correction
  line gone.
  *Which check would catch it:* `tests/check-il-console.js` with a second
  emitter case, not the palette toy — compile the idiv toy above and
  assert the emitted helper contains the sign correction (or execute
  `il_lua_idiv(-7, 2)` and require `-4`). A golden-C hash for the idiv toy
  is the cheapest form; the console frame comparison cannot be used because
  the toy does not need a capture.

- **P14 — the check byte is not verified.** The existing "a mistyped
  password" test changes the first payload character. That character's top
  five bits are the table tag, so the mutant changes tag 5 into tag 8 and
  the decoder refuses with `unknown type tag 8` — a different guard. The
  test never isolates the check byte. A forged code whose value bytes still
  decode gives `ACCEPTED table 10` once the guard is gone.
  *Which check would catch it:* `tests/check-toys.js` with a forged code
  built from valid value bytes and a deliberately wrong check byte (extend
  `p1code` with a `check` override, or flip the last value byte before the
  check byte is recomputed), requiring `password-code` matching
  `/check byte/`. The test must corrupt a byte that is not the tag.

- **P16 — the max code length cap is not verified.** No fixture builds a
  code longer than 200 characters; `pack` itself refuses at 96 value
  bytes, so the only way to exceed the cap is a forged code whose decoder
  accepts more bytes than `pack` would emit. The probe's 32×64-byte table
  is valid to `p_dec` (`n + m = 32`, each string 64 bytes) and 3,439
  characters long; pristine refuses it by the cap, the mutant decodes it.
  *Which check would catch it:* `tests/check-toys.js`'s
  `checkRefusals` with that long-but-valid code and a requirement of
  `password-code` matching `/longer than any password/`. A second
  assertion at exactly 200 characters (accepted) and 201 (refused) pins
  the boundary rather than only the far side.

- **E19 — the IL side is the Lua runtime.** `check-examples.js` only asks
  that the two runtimes agree; if `il.create` is `toys.create`, they agree
  on all 4,288 checks and the suite cannot tell. The probe shows the
  tell: the pristine IL refuses `for k in pairs({})` with `il-for-in`; the
  mutant accepts it, and `rt.program` is `undefined` instead of a
  `pce-il` program.
  *Which check would catch it:* an identity assertion in
  `tests/check-examples.js` (or `tests/check-il.js`) that the IL runtime
  really is the IL — require `ilRT.program && ilRT.program.lang ===
  "pce-il"`, or make `il.create` compile a construct the IL refuses
  (`pairs`) and require the refusal before the five toys run. The
  compare-only loop is a valid equivalence test, not a proof that both
  sides ran.

## Residual weaknesses worth writing down

1. **Seven of the sixteen detections are the pinned ROM sha only.** C01,
   C02, C04, C05, C06, C10 and C11 have no direct behavioural assertion;
   they fail because the rebuilt ROM's bytes differ from the committed
   `meta.rom_sha256`. I measured the skip path: with
   `LLVM_MOS=/nonexistent` the check prints
   `SKIP ROM rebuild: llvm-mos not found` and **all seven pass 43 checks**
   (verified for every one). On a machine without llvm-mos the emitter and
   runtime breaks above are invisible. The check is honest about the skip,
   but the card's evidence then proves only the committed dump, not the
   emitter or the runtime. A direct golden-C/semantic assertion for each
   supported lowering, or a required (not skipped) rebuild in CI, would
   make the proof unconditional.

2. **The frame comparison never re-captures.** `check-il-console.js` reads
   `tests/dumps/toypalette/frames/`; it does not run `capture-toy.sh`. A
   runtime change is caught only because the source is pinned to the
   committed ROM bytes. If someone rebuilds and updates
   `meta.rom_sha256` without re-capturing, the old frames still pass. The
   capture script itself has no check: a crop, SLSTART/SLEND, or
   frame-extraction bug is not exercised by any of the three instruments.
   C07 shows the alignment guard works when the frames are regenerated,
   but it does not test `tools/capture-toy.sh`. Also note the script's
   `LOGDIR="${TMPDIR:-/tmp}"` fallback writes to `/tmp` when `TMPDIR` is
   unset, against the scratch rule this workshop runs under.

3. **"ROM header bank" has no literal site.** `docs/ROM_LAYOUT.md` says the
   image is headerless (`pceas -raw`); there is no HuCard header in the
   8 KiB image. C06 breaks the last byte at `$1FFF` (`$FFFF`, the high
   byte of the reset vector) instead. The check notices it only by the sha;
   nothing parses the `$FFF6..$FFFF` vector table or the linker's bank
   constants, so a wrong reset vector would be "caught" as a generic byte
   difference, not as a bank/vector property.

4. **The sprite budget is only observable when sprites are enabled.** The
   first form of E18 put 17 sprites on line 100 without setting CR bit 6
   (SB). It passed, correctly: `pce-sprites.js`'s `detect` is
   `(CR & 0x40) || (CR & 0x03)`, so the VDC does not search sprites when
   SB is off and nothing is drawn. Only after `reg("CR", 0xC0)` did the
   same 17 sprites become a real overflow and the check fail. The check is
   not vacuous, but a toy author can ask for more sprites than the line
   budget while leaving sprites off and see neither a picture nor a
   budget failure; nothing asserts that a toy asking for >16 sprites has
   the layer on.

5. **`check-examples.js` has a wall-clock assertion.** `worstMs < 100`
   measures one Lua frame under whatever load the machine has. One
   baseline run failed 1 of 4,288 while another check ran in parallel;
   five serial runs passed. The failure was not captured before the run
   ended, but this is the only time-dependent check in the file. A busy
   machine can fail a correct toy. A larger margin, CPU time, or a warning
   instead of a failure would remove the flake.

6. **The password forged-code tests exercise the numeric guards only.**
   P1ZZZZ exercises the trailing-bits and check-byte guards together; the
   two `p1code` fixtures exercise the `> 2^31-1` and "too long" guards.
   The check byte and the code-length cap have no isolating fixtures
   (P14/P16). The round-trip tests are otherwise good: every cap edge
   (2^30−1, −2^30, 64-byte string, 32 items, 6-deep table) is packed and
   unpacked, and the deterministic-code test closes table-order leakage.

## What is left

- Four new cards, one kind up from each instrument's builder: C03 (an
  idiv emitter fixture), P14 (a check-byte fixture), P16 (a >200-character
  code fixture), E19 (an IL-identity witness).
- C06 needs a decision: the image has no header, so the card's "header
  bank" evidence is not literally testable. Either reword the card to the
  vector/bank map and add a parser assertion, or record that the pinned
  sha is the only bank/vector evidence.
- The seven sha-only detections should get direct assertions or a
  non-skippable rebuild before this is treated as machine-independent
  evidence. The capture script remains outside all three checks.
