# The renderer and export checks (#5, #6, #8, #9, #10, #12, #14, #15, #38, #39, #40, #42)

```sh
node tests/check.js             # diff the renderer against Mednafen, all scenes
node tests/check-review-fixes.js # #38: each review fix, and it fails before
node tests/renderer-mutation.js # #6/#39: prove that diff test fails on a broken renderer
node tests/check-viewer.js      # viewer/browser/vsprite ROM captures vs the renderer
node tests/check-export.js      # the browser's .pce vs the PCEAS build, byte for byte
node tests/check-us-card.js     # the US HuCard image is the .pce bit-reversed
node tests/check-editor.js      # the editor's refusals, picture, export and capture,
                                # plus the effect edges and the page's Remove buttons (#52)
```

## `check.js` — the diff (#5, #39, #12, #40, #15)

For each `dumps/sceneN/` or `dumps/spriteN/`, renders `mednafen.png`'s frame
from `vram.bin`, `cram.bin` and `regs.json` — a dump with `sat.bin` (the
sprite scenes, #12/#40) through `renderer/pce-sprites.js`, everything else
through `renderer/pce-bg.js` — and compares every RGB byte. Prints `diff 0`
or the differing-byte count plus sample pixels. Exit 0 only if every picture
matches. `regs.json` carries the capture crop (`slstart`/`slend`); the
renderer reads it as `firstScanline = 14 + slstart`.

A dump whose CR has bit 7 clear (background off) is **rendered as the
backdrop** — CRAM[0x100] on every pixel, the VDC's blanking-period video
data — and `scene8`, `scene8b` and `scene8c` are the diff-0 proofs (#39).
`dumps/us1` stays skipped by name, for its own reason: Mednafen shows the US
HuCard image blank (every VDC register 0), which is the emulator not running
the image (#25), not a rendered frame. The skip list is explicit and named
dumps only; an unnamed background-off dump whose capture is not the backdrop
fails the run as a diff. The shipped count is **57 pictures** (scenes 1-9,
5b, 8b, 8c, painted, spainted, viewer 1-3 and 7, browser 1-3, sprite 1-12,
vsprite 1-12, bsprite 12, raster 1-10, browser 10), us1 skipped.
`dumps/vspriteN/` are
#14's captures: the *viewer*
ROMs of the sprite scenes (`tools/capture.sh N vsprite`), whose SATB DMA
loads the same SAT the sprite scene ROMs write directly.
`sprite12`/`vsprite12`/`bsprite12`/`viewer7` are #42's (REVIEW-14, below);
`raster6-10` are #43's (REVIEW-15, below), `browser10` is #46's.
A dump with `raster.json` (the raster scenes, #15) is verified against it
**before** rendering — the table must describe what the ROM actually wrote:
entries' lines strictly increasing (VDW lines; 240 allowed for r5's HBlank
restore), each `rcr = 0x40 + line`, the saved BXR/BYR/CR equal the last
entry of their kind with `line <= RCRCount`, the saved RCR equals the
chain's next arm, and the saved colour table equals `baseCram` plus every
entry's `cram` writes in line order.  For raster4, `cram`/`cramPrev` carry
this frame's and the previous frame's values (patched in from the save's
HuC6280 RAM by `tools/raster-patch.py`); `cramPrev` drives the renderer's
rows before the entry — the saved table can only hold this frame's writes.  The renderer then renders
the dump with the table as `opts.raster` (`pce-sprites.js` gates the sprite
layer with each row's CR).  The scenes and their witnesses are in
`docs/RENDERER.md`'s #15 sections.
Sprite 9-11 are #40's scenes, which close the three gaps REVIEW-12 found in
the sprite scenes (see below). Sprite 12 is #42's: 64 sprites in an 8×8
grid, one per SAT entry, so entries 20-63 are live and entry 63
(bottom-right) is visible — REVIEW-14's A2 break (a viewer copying only the
first 20 SAT entries) is reachable, below.

## The sprite scenes (#12, #40)

`dumps/sprite1-8` are #12's, `sprite9-11` are #40's. The ROMs are generated
by `tools/genroms.py` (`SPRITE_SCENES`): scene 1's picture, or the stripes
background (transparent left of display column 128, solid colour 7 right),
under SAT-driven sprites whose SG pattern cells all differ per row (the
`sg_word()` rotate formula). The capture pipeline writes `sat.bin` (the
SATB, 256 uint16 from the save state) and `check.js` renders such a dump
through `pce-sprites.js`; every dump WITHOUT `sat.bin` must additionally
render identically through the sprites module (a sprite scene's renderer
must not change a sprite-free picture).

The scene-by-scene coverage, and REVIEW-12's 24 breaks (M1-M24) with which
scenes catch each: `docs/REVIEW-12.md` — its three misses are closed by
`docs/REVIEW-12.md`'s #40 appendix: **sprite9** (a 16×64 sprite, CGY=2 —
the one CGY code sprite1-8 never carried; M2 DETECTED), **sprite10** (an
SPBG=0 sprite over an opaque background tile — colour 7, low nibble nonzero;
M9 DETECTED), **sprite11** (a line of 15 strips with a CGX sprite as the
16th SAT entry, its right half the dropped 17th strip; M24 DETECTED). All
24 breaks now DETECTED.

Two generator bugs that #40 found and fixed while building sprite10 (the
check captures them, they were never renderer bugs): the stripes tiles were
written at VRAM 0x0040/0x0041 — into the BAT — so the "solid right half"
was colour 0 in every capture and the SAT area held the only sprite data
(sprite3 was re-captured with the fix); and the tile data 0x7777 decoded
MSB-first is 0x0/0xF stripes, not solid colour 7 — the tile is now
0xFFFF/0x00FF per row, which decodes to solid 7. genroms.py's tile_word
docstring said LSB-first; the captures (all 30 scenes diff 0) show the VDC
decode is MSB-first, and the comment now says so.

## The raster scenes (#15)

`dumps/raster1-5` are #15's: ROMs (`RASTER_SCENES` in genroms.py) that
chain per-scanline BXR/BYR/CR/VCE colour-table writes from the RCR line
interrupt — a statusbar-style BYR band, a per-line BXR wobble, a two-step
BYR split, a per-line colour-table gradient shifted by a frame counter,
and a CR sequence that turns the sprite layer then the background off.
`tools/capture.sh N raster` builds the ROM, captures it, writes `ram.bin`
(the save's HuC6280 RAM — the chain's step/frame counters live in ZP,
BaseRAM[0x30]/[0x31]) and copies the ROM's `raster.json`, which
`tools/raster-patch.py` folds with the runtime state (the chain's step at
the save, r4's frame counter) before `check.js` verifies the table against
the save state and renders with it.  The per-scene witnesses and the
manual citations (RCR R06, BXR/BYR R07/R08, CR R05, VCE 2.2.2) are in
`docs/RENDERER.md`; the NOT-proven parts (sub-line VCE write dots, the
emulator-specific IRQ path, real-hardware IRQ latency) are written down
there too.

## The raster scenes (#15)

`dumps/raster6-10` are #43's: REVIEW-15's own "capture that would catch it"
suggestions, on pictures a person can read — the bands picture (BAT tile
(x, y) = 0x040 + (x + 2y) & 31, each tile one solid hue of palette 0's
seven bright colours) and #40's stripes picture (colour 0 left of display
column 128, colour 7 right).  r6 is r3's BYR split on the bands (the seam
is visible: captured row 79 changes 168 of 256 px); r7 ramps CRAM[0x000]
up and CRAM[0x007] down every line — two full-screen staircases (232
distinct values per column); r8 starts r2's wobble at line 50, so rows
0..48 display the previous frame's last BXR write (45) — the M6 witness;
r9 is r2's wobble captured SLSTART=6 SLEND=237 so vdwLine0 = 3 — the M16
witness; r10 puts two solid sprites over the bands and ramps
CRAM[0x101] every line, so the sprite bodies carry the gradient — the M19
witness.  `tests/raster-mutation.js` re-runs REVIEW-15's M6/M16/M17/M19
as source mutations of the current renderer (semantically equivalent
edits of the breaker's — the reviewed tree was ddbe106, the renderer has
moved since — each asserted exactly-once) and requires check.js to report
the measured diffs: M6 DETECTED on raster8 (12544 px = 49 rows × 256,
exactly the latch band), M16 DETECTED on raster9 (50032 px), M19 DETECTED
on raster10 (1280 px, exactly the two sprite bodies), M17 still NO-OP
(the 9-bit wrap is redundant: bgY is consumed only mod the BAT height and
mod 8, and 512 ≡ 0 mod both).  The witnesses and the blind spots are in
`docs/REVIEW-15.md`'s #43 appendix and `docs/RENDERER.md`.

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
BYR masked to 8 bits, `vdwLine0` hard-wired to 1, the CR BB gate removed,
and the green channel `&3`. Scenes 4-9 (8b, 8c) exist to make these
visible — each is **not** periodic in the dimension the break cuts — and
scene5b (crop shifted two lines, so its `vdwLine0` is 3) catches the vdw1
break, which is arithmetically invisible on the standard crop. One break is
DETECTED on a synthetic dump instead: `ch800` — no real dump can carry VRAM
data at words ≥ 0x800 because Mednafen's state holds 32768 words, so the
script builds a 65536-word VRAM whose BAT reads tiles ≥ 0x800 (the
reference PNG is the shipped renderer's own frame; scene9 is the capture
that proves the *rule*, the script only proves the checker catches its
removal).

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

## `check-viewer.js` — the ROM shows the picture (#8, #9, #14, #42)

For each `dumps/viewerN/`, `dumps/browserN/`, `dumps/vspriteN/` and
`dumps/bspriteN/` capture it
renders the matching scene — `sceneN` for the first two, `spriteN` for
`vspriteN`/`bspriteN` — with the renderer (the sprites module when the scene
has a
`sat.bin`, else the background module) and requires the captured Mednafen
frame to match it byte for byte, and the captured VRAM/CRAM/static VDC
registers to match the scene dump — for the sprite scenes also the SATB
mirror `sat.bin` and the `DCR`/`SATB` registers, the #14 evidence that the
DCR bit-4 DMA carried the SAT. `viewerN` ROMs come from PCEAS
(`capture.sh N viewer`); `browserN` ROMs come from `renderer/pce-rom.js`
(`capture.sh N browser`), so #9's export is checked by running its own
bytes; `vspriteN` ROMs are #14's *viewer* ROMs of the sprite scenes
(`capture.sh N vsprite`), whose SATB DMA loads the same SAT the sprite
scene ROMs write directly. #42 adds `bsprite12` (`capture.sh 12 bsprite`,
the browser export of a sprite scene — REVIEW-14's J1-J3 gap: the browser
ROM carries the SAT but had never been run on a sprite scene) and
`viewer7` (`capture.sh 7 viewer`, whose 16384-byte BAT copy crosses the
8 KiB MPR window). Details: [`../docs/EXPORT.md`](../docs/EXPORT.md).

The #42 extension is `docs/REVIEW-14.md`'s settling evidence, measured on
these captures with the break re-applied to `tools/viewer.asm` and the
check run against the mutant capture:

- **A2** (the SAT copy shortened to 80 words, `viewer.asm:249-251`) —
  **DETECTED** on `vsprite12`: 27496 differing pixels, `vram differs at
  byte 65184` and `sat.bin differs at byte 160` (entry 20). Every earlier
  scene used only SAT entries 0-19, which is why REVIEW-14 missed it.
- **I** (both `cmp #$60` bank-remap checks at `viewer.asm:286,301` made
  `cmp #$70`) — **DETECTED** on `viewer7` (`vram differs at byte 8192`,
  frame diff 0: the wrong BAT half is off-screen, so only the VRAM byte
  equality catches it) and on `vsprite12` (4824 differing pixels and
  `vram differs at byte 23552`: without the remap, the copy past $6000
  reads MPR3 — bank 0, the code bank, which the viewer never maps — so
  the last 16 SG cells hold boot-code bytes and 0xFF fill; the sprites
  drawn from them change the frame).
- **B** (the SAT copy grown to 512 words) — **NO-OP**, re-verified on
  `vsprite12`: the capture is byte-identical to the pristine one (vram,
  sat, cram, frame all sha256-equal) and the check passes. That is the
  hardware, not a miss: the SATB DMA transfers exactly the fixed 256
  words from DVSSR (VDC manual 2.4.2 SATB p. H7-20, DVSSR R13 p. H7-12 —
  cited in `viewer.asm`), and the CPU's extra 256 writes land at MAWR
  $8000+, past the 32768-word VRAM, where they are dropped (measured
  Mednafen behaviour, recorded in `docs/RENDERER.md`; no manual text
  states the drop). A check cannot DETECT a break the hardware turns
  into a no-op.

What this does NOT settle (blind spots, all in the REVIEW-14 appendix):
the second remap site — `viewer.asm:301`, the check between a word's two
bytes — is still unreachable because every region copy starts
word-aligned at an even offset, so the straddling-word crossing has no
witness; and the bank-remap branch is only proven for the two new
crossing shapes (a 16384-byte BAT, a 9216-byte tile stream), not for
every size the layout allows.

Two bugs fell out of building the `vsprite` path (#14), both invisible to
the frame checks and caught only by the VRAM byte equality:

- **`viewer.asm`'s `copy_words` kept its ROM pointer's byte position in Y**
  (the HuDK page-walk pattern) and reset Y with `cly` on every call, so a
  copy whose word count is not a multiple of 128 (i.e. does not end on a
  256-byte page) lost its advance and the next copy re-read from the page
  start. The stripes scenes' 16-word tile regions (sprite3/sprite10) then
  loaded char 64's tile into char 65 and the SG block from the tiles' page
  start — the viewer showed white where the renderer has red. `copy_words`
  now walks a true 16-bit pointer across calls, and the check's `vsprite3`
  capture proves it (the old bank's capture failed byte 2080).
- **`genroms.py`'s copy loops always write whole 256-word pages** (`clx`/
  `inx`/`bne` reads 256 entries), so a region shorter than a page copied
  the next table's ROM bytes into VRAM. The stripes scenes' 16-word
  regions carried 240 garbage words each into VRAM `$420`–`$50f` —
  invisible, because the BAT never names those characters, so #12's diff-0
  never saw it. `pages_of` now zero-pads the last page of every table; the
  two scene ROMs were rebuilt and sprite3/sprite10 re-captured (their
  frames are unchanged).

## `check-export.js` — byte equality (#9)

Builds each sample scene's ROM with `renderer/pce-rom.js` — the module
`renderer/index.html` loads — and compares it byte for byte with the PCEAS
build `tools/gen/viewerN.pce` (for the sprite scenes `tools/gen/vspriteN.pce`,
#14's sample-set extension). Also loads the module through its
browser-global branch and requires the same bytes. Prints the first differing
offset if any; exit 0 only if all 15 pairs match (scene 1-3, sprite 1-12).
`--write N` writes
`tools/gen/browserN.pce`, which `capture.sh N browser` runs; `--write
sprite12` writes `tools/gen/bsprite12.pce` for `capture.sh 12 bsprite`
(#42: REVIEW-14's J1-J3 were caught only by this byte equality because the
browser ROM had never been run on a sprite scene — the bsprite12 capture
closes that gap in `check-viewer.js`).

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
  bytes;
- **the effect edges** (#52, from `REVIEW-13-17`): two parallax bands that
  share exactly one boundary line are refused with `raster-line-full`, the
  legal maxima BXR 1023 / BYR 511 are accepted (1024 / 512 refused), and every
  table's entry lines strictly increase — the order the ROM's RCR chain arms
  them in — including one table with all three effects at once;
- **the page's Remove buttons** (#52): `renderer/editor.html` is executed in
  a stub DOM (this project has no jsdom — the page's own inline script and
  its declared script order), all three effects are set, and `#cleargrad`,
  `#clearwob` and `#clearbands` are clicked: each must clear its own effect
  and leave the other two. The harness names its own failure modes (the page
  not running, a button with no single handler, the setup not taking, a
  handler that throws).

Details and the headless page output: [`../docs/EDITOR.md`](../docs/EDITOR.md).

## `check-panels.js` — the panels read the renderer's model (#26)

`renderer/pce-panels.js` draws the editor's five panels — the 20 VDC
registers per scanline, the VCE's 32 palettes of 16, the VRAM map, the SAT
and follow-a-pixel — from the same `vram`/`cram`/`sat`/`regs`/raster objects
the renderer is given. This check (written by @design, flagged for @review)
runs it on eight dumps and compares every panel with an independent
computation written here from the raw bytes; the expected value never comes
from the panel's or renderer's functions.

- **follow a pixel**: a 13×12 grid plus pixels on every non-empty SAT sprite
  (1320 traces in all) — the layer, 9-bit index and CRAM word, the BAT
  word/character/palette/tile row/column/colour number/**tileWord**
  (the first plane, `char*16+row`) and **beyondVram** or the sprite
  number/pattern/palette/colour/cell/strip, the line's BXR/BYR/CR/BG_YOffset,
  the embedded **20-register `vdc` block against that row** (with a changed
  row required on a raster table, so a block hard-wired to row 0 cannot
  pass), and the RGB against `mednafen.png` at the same pixel. 92 traces land
  on a sprite and 41 on the blanking fill.
- **the VRAM map**: `copyRegions` equals `regions.json`'s descriptor list
  where that file exists; the segments partition all 32768 words exactly
  once; the BAT follows MWR and the SAT the dump's SATB; the SAT's pattern
  cells (derived from its own words, not from the panel's `patternCells`)
  are in sprite-pattern segments and are exactly the map's derived cells.
- **the register panel**: `registerLines()` against `raster.json` entry by
  entry — the values between writes, the entry on its own line, `rcr`, the
  RCR chain arm, and the 20-register view's per-line CR/BXR/BYR.
- **the VCE panel**: 32×16, against each line's colour table on the raster
  dumps and the saved CRAM on the others; every entry's word, **RGB**
  (`R/G/B = 36*((w>>3)/(w>>6)/(w&7)&7)`) and index/palette/entry are decoded
  here from that word.
- **the SAT panel**: 64 rows equal to `sat.bin`'s words, with **Y/X/row0/
  leftX** from those words and the CGX/CGY cells compared **element by
  element** with the cells the pattern number names.
- the editor's own demo and sprite pictures through the same file, and the
  browser-global branch giving the same traces.

Dumps: `scene1` (background), `sprite1` (sprites), `raster1`/`raster4`/
`raster5` (BYR / per-line colour / per-line CR), `painted` (#10's picture),
`scene4` (64-wide BAT) and `scene9` (characters ≥ `$800`). The check fails
on five self-mutations tried (priority rule, plane bit order, per-line BXR,
region length, colour high bit) and on all five breaks `docs/REVIEW-26.md`
found it missing (#56: VCE red/green swap P06, SAT X/Y swap P07, 32-wide
cells P08, row-0 `vdc` block P16, second-plane `tileWord` P17). STILL NOT
PROVEN after #56: the eight dumps carry no HFLIP/VFLIP sprite (S01/S02 rest
on the editor's sprite picture) and no SPBG=0 sprite over an opaque
background (P01b changes only the editor model); REVIEW-26's two
dump-coverage additions (`sprite10`/`sprite3`, `sprite2`/`spainted`) are not
part of this check yet.

## What this does NOT prove

**It does not prove the renderer is correct.** Eleven mutations on twelve
dumps do not enumerate the ways a VDC/VCE renderer can be wrong. Anything
the scenes do not exercise can still be broken while `check.js` stays
green: RCR split-screen, the other dot clocks/widths (336/512),
and any BAT/scroll combination unlike these fixed dumps. The sprite scenes
exercise the SATB path, sizes, flips, priority, palettes, clipping and the
16-strip limit (REVIEW-12's 24 breaks, all DETECTED), but only through the
generator's formula patterns and these fixed SATs — sprite quirks the
scenes do not pin can still break silently. One break's
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

**`check-editor.js` does not prove the page's editing.** It executes the
three Remove buttons' click handlers in a stub DOM (#52), but not the other
handlers on the page, and not a real browser: layout, CSS and a real click are
stubbed, and no synthetic mouse input is used anywhere. It does not prove the
download wiring, and it uses one
32×32 BAT with no scroll and one region. It says the demo picture reaches
Mednafen unchanged, not that the editor is pleasant or the picture wanted.
