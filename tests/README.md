# The renderer checks (#5, #6)

```sh
node tests/check.js             # diff the renderer against Mednafen, all scenes
node tests/renderer-mutation.js # prove that diff test fails on a broken renderer
```

## `check.js` — the diff (#5)

For each `dumps/sceneN/`, renders `mednafen.png`'s frame from `vram.bin`,
`cram.bin` and `regs.json` with `renderer/pce-bg.js` and compares every RGB
byte. Prints `diff 0` or the differing-byte count plus sample pixels. Exit 0
only if all three scenes match. This is #5's closing measurement.

## `renderer-mutation.js` — the diff test can fail (#6)

`check.js` reporting `diff 0` is only worth what it costs to break it. This
script runs the real `check.js` against two copies of `renderer/pce-bg.js`, each
with one deliberate defect the card names — the BAT palette nibble ignored
(every tile drawn with palette 0) and tile rows shifted by one — and requires
`check.js` to exit 1 and report **exactly** the number of differing bytes the
mutant actually produces, scene by scene. The unmodified renderer and the
unmodified `check.js` are never touched; mutants are built in a throwaway
directory from source-string substitutions.

It also tests itself, so a green run is not the only thing it can say:

- a copy of `check.js` with the pixel comparison gutted (`if (false)`) must be
  reported `MISSED`, not `DETECTED`;
- a semantically identical "mutation" must be reported `NO-OP`, not `DETECTED`.

Distinct outcomes: `DETECTED`, `MISSED` (check exits 0 on a renderer that does
differ), `CRASH` (non-zero exit without an accurate per-scene diff report),
`NO-OP` (the mutation changed nothing, so the test would prove nothing), `NOT
APPLIED` (the edited source line is gone — fails loudly rather than silently
testing nothing), `UNEXPECTED` (exit 0 but not a clean three-scene pass), and
`INPUT-ERROR` (a dump could not be read or rendered).

Exit 0 only when the baseline is diff 0 on all three scenes and both real
mutations are `DETECTED`.

## What this does NOT prove

**It does not prove the renderer is correct.** Two mutations on three dumps do
not enumerate the ways a VDC/VCE renderer can be wrong. Anything the scenes do
not exercise can still be broken while `check.js` stays green: the 64-row BAT
(MWR bit 6), the other dot clocks/widths (336/512), sprites, RCR split-screen,
and any BAT/scroll combination unlike these three fixed dumps. A renderer bug
that happens to reproduce the same pixels on these scenes escapes.

**It does not prove the reference is right.** `check.js` compares against
`mednafen.png`. A mutation is only "caught" relative to that reference; if the
capture pipeline (`capture.sh`, `movframes.py`, `mcs-extract.py`) produced a
wrong frame, this test would inherit the wrongness, not detect it. The baseline
passing shows renderer and reference agree, not that either is the hardware.

**It does not test corrupt input data.** The mutations edit renderer code, not
`vram.bin`/`cram.bin`; whether `check.js` catches a bad dump, a truncated file
or a wrong register decode is not measured here.

**It says nothing about the browser path.** Only the CommonJS branch of
`pce-bg.js` is exercised; `renderer/index.html`'s global wrapper is not.

**The mutation edits are exact source strings.** If `pce-bg.js` is reformatted
or refactored, `renderer-mutation.js` fails with `NOT APPLIED` rather than
quietly passing; that is deliberate, but it means the test needs updating when
the renderer's text changes even if its behaviour does not.
