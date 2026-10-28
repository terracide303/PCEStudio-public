# The renderer and export checks (#5, #6, #8, #9, #10, #38, #39)

```sh
node tests/check.js             # diff the renderer against Mednafen, all scenes
node tests/check-review-fixes.js # #38: each review fix, and it fails before
node tests/renderer-mutation.js # #6/#39: prove that diff test fails on a broken renderer
node tests/check-viewer.js      # viewer/browser ROM captures vs the renderer
node tests/check-export.js      # the browser's .pce vs the PCEAS build, byte for byte
node tests/check-us-card.js     # the US HuCard image is the .pce bit-reversed
node tests/check-editor.js      # the editor's refusals, picture, export and capture
```

## `check.js` — the diff (#5, #39)

For each `dumps/sceneN/`, renders `mednafen.png`'s frame from `vram.bin`,
`cram.bin` and `regs.json` with `renderer/pce-bg.js` and compares every RGB
byte. Prints `diff 0` or the differing-byte count plus sample pixels. Exit 0
only if every picture matches. `regs.json` carries the capture crop
(`slstart`/`slend`); the renderer reads it as `firstScanline = 14 + slstart`.

A dump whose CR has bit 7 clear (background off) is **rendered as the
backdrop** — CRAM[0x100] on every pixel, the VDC's blanking-period video
data — and `scene8`, `scene8b` and `scene8c` are the diff-0 proofs (#39).
`dumps/us1` stays skipped by name, for its own reason: Mednafen shows the US
HuCard image blank (every VDC register 0), which is the emulator not running
the image (#25), not a rendered frame. The skip list is explicit and named
dumps only; an unnamed background-off dump whose capture is not the backdrop
fails the run as a diff. The shipped count is **19 pictures** (scenes 1-9,
5b, 8b, 8c, painted, viewer 1-3, browser 1-3), us1 skipped. This is #5's
closing measurement, extended by #39's captures.

## `check-review-fixes.js` — the #38 fixes, and that they were needed

The five small fixes from `docs/REVIEW.md` (finding 2: SCREEN code 3 BAT
stride; finding 3: the CG-bit claim; finding 4: us1 counted as a picture;
finding 7: a straddling tile region; finding 9: manual page numbers) each get
a check. For each one the same predicate also runs against the pre-fix
version — a source-string substitution that reproduces the defect, the
review's own quoted output, or the review's quoted claim — and must reject
it. Run the whole test against the commit before the fix and it reports 13
failures; against the fix, 0. It is written by @design and flagged for
@review to read cold.

## `renderer-mutation.js` — the diff test can fail (#6, #39)

`check.js` reporting `diff 0` is only worth what it costs to break it. This
script runs the real `check.js` against a copy of `renderer/pce-bg.js` with
one deliberate defect, and requires `check.js` to exit 1 and report
**exactly** the number of differing bytes the mutant actually produces, scene
by scene (and `diff 0` for the scenes it does not change). The unmodified
renderer and the unmodified `check.js` are never touched; mutants are built
in a throwaway directory from source-string substitutions. Ground truth is
measured in this process by rendering the original and mutant side by side,
so `check.js` is checked against that, not against its own opinion.

#6 began with the two defects the card names. #39 extends the list to the
ten breaks `docs/REVIEW.md` finding 1 showed the test could not see, each
required to be DETECTED: the BAT width mask forced to 31, the widths table
`[32,64,64,64]`, BAT height always 32, the SCREEN-code-3 row stride (the
#38 break), the `ch >= 0x800` rule removed, BXR masked to 8 and to 9 bits,
BYR masked to 8 bits, `vdwLine0` hard-wired to 1, CR ignored, and the green
channel `&3`. Scenes 4-9 (8b, 8c) exist to make these visible — each is
**not** periodic in the dimension the break cuts — and scene5b (crop
shifted two lines, so its `vdwLine0` is 3) catches the vdw1 break, which is
arithmetically invisible on the standard crop. One break is DETECTED on a
synthetic dump instead: `ch800` — no real dump can carry VRAM data at
words ≥ 0x800 because Mednafen's state holds 32768 words, so the script
builds a 65536-word VRAM whose BAT reads tiles ≥ 0x800 (the reference PNG
is the shipped renderer's own frame; scene9 is the capture that proves the
*rule*, the script only proves the checker catches its removal).

It also tests itself, so a green run is not the only thing it can say:

- a copy of `check.js` with the pixel comparison gutted (`if (false)`) must be
  reported `MISSED`, not `DETECTED`;
- a semantically identical "mutation" must be reported `NO-OP`, not `DETECTED`.

Distinct outcomes: `DETECTED`, `MISSED` (check exits 0 on a renderer that does
differ), `CRASH` (non-zero exit without an accurate per-scene diff report),
`NO-OP` (the mutation changed nothing, so the test would prove nothing), `NOT
APPLIED` (the edited source line is gone — fails loudly rather than silently
testing nothing), `UNEXPECTED` (exit 0 but not a clean pass), and
`INPUT-ERROR` (a dump could not be read or rendered).

Exit 0 only when the baseline is diff 0 on all scenes, all ten breaks are
DETECTED, and both self-tests hold.

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

## `check-editor.js` — the editor's picture reaches the console (#10)

The editor (`renderer/pce-editor.js`) keeps a picture in the VDC's own shape:
16 palettes of 16 CRAM colours, 8×8 tiles of 4-bit colour numbers, the 32×32
BAT. This check (written by @design, flagged for @review) requires:

- **the refusals**: a 17th colour in a tile (pixel number 16 and above), a 17th
  palette, a 17th colour in a palette, a colour the tile's own palette does not
  hold, a character past the 32768-word VRAM and the range guards all throw
  with their documented `code`; a legal paint afterwards must still succeed;
- **the picture**: `demoPicture()` paints a 256×224 picture from scratch
  through the editor's calls (nothing from `dumps/`), `validate()` reports no
  problems, and every pixel of the 256×224 frame recomputed from the editor
  model equals `pce-bg.js` drawing `toPicture()`'s VRAM and CRAM;
- **the export**: `pce-rom.js`'s ROM carries the editor's config, palettes,
  BAT and tiles at the places `ROM_LAYOUT.md` documents, at the size the bank
  formula gives; `--write` writes `tools/gen/painted.pce` for
  `capture.sh painted`;
- **the console**: `dumps/painted/` (the Mednafen capture of that ROM) has the
  editor's VRAM, palettes and registers, and its recorded frame equals
  `pce-bg.js` drawing the editor's picture with the capture's calibration —
  diff 0. `check.js` also lists `painted` with the scenes;
- **the browser-global branch** refuses the same calls and builds the same
  bytes.

Details and the headless page output: [`../docs/EDITOR.md`](../docs/EDITOR.md).

## What this does NOT prove

**It does not prove the renderer is correct.** Eleven mutations on twelve
dumps do not enumerate the ways a VDC/VCE renderer can be wrong. Anything
the scenes do not exercise can still be broken while `check.js` stays
green: sprites, RCR split-screen, the other dot clocks/widths (336/512),
and any BAT/scroll combination unlike these fixed dumps. One break's
*check* is synthetic-only (`ch800`, above) — the rule itself is proven by
scene9, but a future renderer bug in it would be caught only by the
synthetic dump. A renderer bug that happens to reproduce the same pixels
on these scenes escapes.

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

**`check-editor.js` does not prove the page's editing.** It calls the same
functions the page's handlers call, but not the handlers; no synthetic mouse
input is used anywhere. It does not prove the download wiring, and it uses one
32×32 BAT with no scroll and one region. It says the demo picture reaches
Mednafen unchanged, not that the editor is pleasant or the picture wanted.
