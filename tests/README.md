# The renderer and export checks (#5, #6, #8, #9)

```sh
node tests/check.js             # diff the renderer against Mednafen, all scenes
node tests/renderer-mutation.js # prove that diff test fails on a broken renderer
node tests/check-viewer.js      # viewer/browser ROM captures vs the renderer
node tests/check-export.js      # the browser's .pce vs the PCEAS build, byte for byte
node tests/check-us-card.js     # the US HuCard image is the .pce bit-reversed
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

## `check-viewer.js` — the ROM shows the picture (#8, #9)

For each `dumps/viewerN/` and `dumps/browserN/` capture it renders the #5
scene with `renderer/pce-bg.js` and requires the captured Mednafen frame to
match it byte for byte, and the captured VRAM/CRAM/static VDC registers to
match the scene dump. `viewerN` ROMs come from PCEAS (`capture.sh N viewer`);
`browserN` ROMs come from `renderer/pce-rom.js` (`capture.sh N browser`), so
#9's export is checked by running its own bytes. Details:
[`../docs/EXPORT.md`](../docs/EXPORT.md).

## `check-export.js` — byte equality (#9)

Builds each sample scene's ROM with `renderer/pce-rom.js` — the module
`renderer/index.html` loads — and compares it byte for byte with the PCEAS
build `tools/gen/viewerN.pce`. Also loads the module through its
browser-global branch and requires the same bytes. Prints the first differing
offset if any; exit 0 only if all three scenes match. `--write N` writes
`tools/gen/browserN.pce`, which `capture.sh N browser` runs.

## `check-us-card.js` — the US image is the exact bit-reverse (#25)

Builds each scene's .pce with `renderer/pce-rom.js` and the US image with its
`reverseBits()`, then requires, byte by byte, that every byte of the image is
the bit-reverse of the .pce's byte at the same offset — measured with a bit
loop written in the test, not the module's table. It also requires the image to
reverse back to the .pce exactly and to differ from it on this data (0x00 and
0xff are self-reverse; most of the ROM is padding). It loads the module through
its browser-global branch too, and it proves the comparison can fail by running
it on the un-reversed .pce and on a one-byte error. `--write N` writes
`tools/gen/usN.pce`, which `capture.sh N us` runs. **It does not prove the US
image runs on a TurboGrafx**: Mednafen shows it blank (it has no US/region
mode), so that is a hardware question, not a test result here.

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

**`check-export.js` does not prove the picture or the console.** Byte equality
says the browser and PCEAS builders agree; `check-viewer.js` says the bytes
match the renderer in Mednafen. Neither is a HuCard on real hardware, and
neither checks the TurboGrafx bit-reversed image (#25). It also does not
execute the page's download wiring — only the module it calls. It covers the
three sample scenes, not every BAT size, region count or tile size the layout
allows.
