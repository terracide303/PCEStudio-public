# #82 — REVIEW-31A's four misses, and the checks that now catch them

Card #82. Work by @test. The breaker (`docs/REVIEW-31A.md`, commit `2909002`)
injected 20 breaks against #31 part A (the IL → C console emitter),
#73 (the password caps) and #29 (the example toys): 16 DETECTED, 4 MISSED.
This card adds a check for each miss, re-runs the four exact breaks against
the new checks, and writes down what the new checks still cannot see.

Baseline at the commit this adds to, in the working tree (the three suites
this card touches):

- `node tests/check-il-console.js` — `PASS 123 checks` (was 116).
- `node tests/check-toys.js` — `PASS 764 checks` (was 757).
- `node tests/check-examples.js` — `PASS 4299 checks` (was 4288).

## What was added

### C03 — a console toy that floor-divides negatives (`check-il-console.js`)

The palette toy uses `%`, not `//`, so `uses.idiv` was false, the emitted
palette C was byte-identical with and without the sign correction, and the
suite never reached `il_lua_idiv`. `checkIdivEmitter()` compiles a second
toy — `local x = -7  local q = x // 2  pal(1, q + 8)` — and:

1. asserts the emitted C calls `il_lua_idiv` and carries
   `if (r != 0 && ((r < 0) != (y < 0))) q--;` (the review's exact deleted
   line);
2. runs `-7 // 2, 7 // 2, -7 // -2, 7 // -2` through the Lua runtime as the
   oracle for Lua's semantics (`-4 3 3 -4`);
3. extracts the helper from the emitted C, compiles it with the **host** C
   compiler (`cc -std=c99`) in a `$TMPDIR` scratch directory, and executes
   nine cases including negative dividends and negative divisors; every
   mismatch prints the operands and the two quotients.

The execution step is what separates "a comment says floor" from "the C
rounds the way Lua does": in the mutant the text assertion and the run both
fail, and the run prints `il_lua_idiv(-7, 2) = -3, want -4`. Without a host
C compiler the execution is a named `SKIP`; the text assertion still fires.

### P14 — a forged P1 code whose values decode (`check-toys.js`)

The existing "mistyped password" fixture changes the first payload
character, which is the type tag, so the tag guard refuses it before the
check byte is ever compared. `checkPasswordGuards()` builds a forged code
from the value bytes of `pack({score = 10})` and changes **only** the check
byte:

- the value bytes are first proven genuine (the built code equals what
  `password.pack({score = 10})` prints);
- the forged code must be refused as `password-code` with a message
  matching `/check byte/`. Deleting the `sum ~= bytes[#bytes]` guard makes
  the decoder accept it, and the check says so.

### P16 — the 200-character code cap (`check-toys.js`)

No fixture was longer than the cap, and `pack` refuses at 96 value bytes, so
the only way to test it is a forged code. A table of three strings
(37/37/39 bytes) is 122 value bytes = a 199-character code; one `"A"` pads
it to exactly 200. The check pins both sides of the boundary:

- exactly 200 characters is **accepted** and decodes to `table 3` (the cap
  is `#code > 200`);
- 201 characters is refused as `password-code` with a message matching
  `/longer than any password/`;
- the review's own probe — a 32 × 64-byte table (a 3.4 KB code) that
  decodes cleanly — is refused by the cap, not by the decoder.

Without the cap the 201-character code is refused for a different reason
(`the code has bytes past its value`) and the 3.4 KB code is accepted, so
the check fails twice.

### E19 — the IL side is the IL, not the Lua runtime (`check-examples.js`)

`check-examples.js` compares two runtimes; if `il.create` delegated to
`pce-toys.create`, the comparison would be a run against itself. A
comparison cannot see that, so `checkILIdentity()` asserts identity
separately:

- `il.compile` returns a `lang: "pce-il"` program with functions and a
  frame hook, and every toy's IL runtime carries its own `program`
  (the Lua runtime has no `.program`);
- a **deliberate IL-only difference**: the IL refuses `pairs` with
  `il-for-in` while the Lua runtime accepts the same toy — a real
  disagreement, not a shared refusal;
- the IL interpreter counts its own instructions: a busy hook under
  `maxInstructions: 1000` stops with a `toy-timeout` naming 1000
  instructions. The delegated Lua runtime instead names milliseconds
  (`the toy's Lua ran longer than 100 ms`), which is how the mutant is
  caught.

## The four re-runs

Run in a scratch copy made with `git archive HEAD` plus this commit's three
test files; each break is the review's exact single edit, asserted to occur
exactly once; the live working tree was not mutated.

| # | break | unmodified check | result | measured output |
|---|---|---|---|---|
| C03 | delete `if (r != 0 && ((r < 0) != (y < 0))) q--;` from `il_lua_idiv` | `tests/check-il-console.js` | **DETECTED** | exit 1, `FAIL 3 of 123`: the helper's floor correction is missing; `il_lua_idiv(-7, 2) = -3, want -4`; the raster toy's rebuilt ROM sha also changed (parallax divides) |
| P14 | delete the `sum ~= bytes[#bytes]` check-byte guard | `tests/check-toys.js` | **DETECTED** | exit 1, `FAIL 1 of 764`: `refusal a forged check byte (the values still decode) was accepted (wanted password-code)` |
| P16 | delete the `#code > 200` refusal | `tests/check-toys.js` | **DETECTED** | exit 1, `FAIL 2 of 764`: the 201-character code is refused by `the code has bytes past its value` (not the cap); `a long code that decodes cleanly was accepted` |
| E19 | `il.create` delegates to `pce-toys.create` | `tests/check-examples.js` | **DETECTED** | exit 1, `FAILED 7 of 4299`: `the IL refuses generic iteration by its own code (got "accepted")`; the busy hook's error is `the toy's Lua ran longer than 100 ms`; all five toys' `the IL runtime carries a pce-il program, not the Lua one` |

The four baselines were green before each break (123 / 764 / 4299 checks
PASS).

## What these checks do not prove

- **C03 is not a console capture.** The emitted helper is compiled by the
  host C compiler (Apple clang on arm64), not by `mos-pce-clang` for the
  65816, and no Mednafen frame of the idiv toy is compared. Both compilers
  truncate signed division toward zero, which is the property under test,
  but the ROM's actual bytes and the 65816's division sequence are not
  observed. A wrong argument order at the *call* site or a future
  constant-folding pass on `-7 // 2` would not be seen: the check asserts
  the helper's body and one call's shape, not the toy's picture. With no
  host `cc` the execution is skipped and only the text assertion remains.
- **P14 exercises one value shape.** The forged code is a one-key table
  (`{score = 10}`); other tags, table key orders and longer payloads are not
  forged. The check proves the check byte is verified after the values
  decode, not that every path to the decoder verifies it.
- **P16 pins one boundary and one large shape.** 200/201 is pinned by a
  three-string table; the cap is a constant in the prelude, so a cap moved
  to 199 or 202 is caught only through the 201 refusal, and codes whose
  length arithmetic differs (odd structures, multi-byte length prefixes)
  are not enumerated.
- **E19's "count > 0" is a threshold, not an exposed counter.** The IL
  runtime does not publish its step count; the check observes that the
  interpreter's own budget stopped the hook after more than 1000
  instructions and that the error names instructions, not milliseconds. A
  delegating wrapper that fabricated a `program`, re-refused `pairs` and
  translated error messages could still pass. The identity rests on the
  program object and the two behavioural differences, not on a trace.
- **These are the review's four edits, nothing else.** The other 16 breaks
  in REVIEW-31A already DETECTED and were not re-run. Rule 2 is satisfied
  for the four *breaks* — @review, a different seat and model, chose them —
  but the four new *checks* have not been cold-broken by a third seat in
  ways beyond those edits.
- **The picture suites are untouched.** Nothing here says the console
  renders the idiv toy correctly; `toypalette`/`toyparallax` remain the only
  captured toys, and the review's residuals 1–6 (sha-only detections on
  machines without llvm-mos, the unrecorded capture script, no header
  parser, sprites-off overflow, the wall-clock budget, and the broader
  password guards) are unchanged.
