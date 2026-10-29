# The renderer and export checks (#5, #6, #8, #9, #10, #12, #14, #15, #38, #39, #40, #42, #48, #30)

## One command for a fresh clone (#83)

```sh
tests/all.sh
```

It runs `make -C tools` (every ROM the suites read — scenes, sprites, viewers,
raster tables, wave-editor ROMs), then every `tests/check*.js` and
`tests/*-mutation.js`, and prints PASS / SKIP / FAIL per suite.  Exit 0 only
if no suite failed.  A suite that exits 0 but printed a `SKIP` line (check-ares
without the ares captures, check-hutrack without PCEAS 4.x, check-il-console
without llvm-mos, check-il-huc without the HuC compiler) is reported as
**SKIP, not PASS**: the skipped checks are
printed and the suite is named in the summary.  Logs go under `$TMPDIR` and are
kept with `KEEP=1`.

The individual suites, and what each one needs:

```sh
node tests/check-il.js          # #31: the three #30 toys through Lua -> IL -> the
                                # reference interpreter, vs the Fengari run
node tests/check-il-console.js  # #31 parts A and C: the palette toy and
                                # parallax.lua through IL -> C -> llvm-mos ->
                                # Mednafen, frames and state vs the browser
node tests/check-il-huc.js      # #31 part B: the same toys through IL -> C ->
                                # HuC -> PCEAS -> Mednafen, vs the browser
node tests/check-validate.js    # #32: the validator on the IL — the five #29
                                # toys' budgets, the parallax cycle prediction,
                                # over-budget toys refused, and the export gate
node tests/check.js             # diff the renderer against Mednafen, all scenes
node tests/check-review-fixes.js # #38: each review fix, and it fails before
node tests/renderer-mutation.js # #6/#39: prove that diff test fails on a broken renderer
node tests/check-viewer.js      # viewer/browser/vsprite ROM captures vs the renderer
node tests/check-dma.js         # #49: the VRAM-to-VRAM DMA model vs 3 Mednafen captures,
                                # word for word + the post-transfer registers
node tests/check-export.js      # the browser's .pce vs the PCEAS build, byte for byte
node tests/check-python-builder.js # #60: genviewer.py and pce-rom.js agree at 9/13/14 regions
node tests/check-us-card.js     # the US HuCard image is the .pce bit-reversed
node tests/check-status.js      # #50: the VDC's OR/CC/RR/VD lines vs an independent
                                # SAT/pattern computation and the saved status register
node tests/check-editor.js      # the editor's refusals, picture, export and capture,
                                # plus the effect edges and the page's Remove buttons (#52)
node tests/check-psg.js         # the PSG model vs 11 Mednafen recordings, sample for sample (#34, #63)
node tests/check-wave.js        # the wave editor's export vs PCEAS and Mednafen (#35, #62)
node tests/check-hutrack.js     # #35: the vendored HuTrack ROM's recording carries the DMF's melody
node tests/check-dmf.js         # #35: our DMF reader + the JS HuTrack player vs the same recording
node tests/check-export-song.js # #35: the converter, the assembler and the song ROM vs PCEAS
node tests/psg-mutation.js      # #63: REVIEW-34's 15 breaks must all be DETECTED
node tests/music-mutation.js    # #72: REVIEW-35's three MISSED breaks must now be DETECTED
node tests/check-toys.js        # #30: three Lua toys run live in Node for 40 frames,
                                # every frame diff 0 against hand-built states through
                                # the same model, plus the refusals by code
node tests/check-examples.js    # #29: the five example toys in toys/ for 120 frames
                                # through the Lua runtime AND the IL, budgets, effect
                                # checks, and frame-60 PNGs in dumps/examples/
node tests/check-breaker-78.js  # #91: REVIEW-78's E01/E05 — setVideoMode refuses
                                # an illegal dot clock, and the wide viewer's boot
                                # writes HDR from $5F04 (assembled, then read back
                                # from a Mednafen save state)
node tests/check-browser.js     # #114: one setting decides the browser (a
                                # chrome-headless-shell default + an env override),
                                # nothing launches /Applications/Google Chrome.app,
                                # profiles come from $TMPDIR; --browser also runs
                                # check-studio --browser and requires no new
                                # com.google.Chrome.code_sign_clone folder
node tests/check-pad-keys.js    # #124: page-level KeyboardEvents on the focused
                                # output move STARFALL on the toy page and in the
                                # studio (Lua and IL); unfocused keys move nothing;
                                # the ring and the hint are present.  SKIPs when
                                # tests/browser.js finds no headless shell
```

`check-breaker-78.js` also needs `pceas` (through `make -C tools`) and
`mednafen` for its capture; without `mednafen` it prints `SKIP`, runs the
assembled-ROM half and is reported SKIP, not PASS, by `tests/all.sh`.

The audio suites' models and limits are documented in `docs/PSG.md`,
`docs/WAVE.md` and (HuTrack, #35 step 1) `docs/HUTRACK.md`;
`psg-mutation.js`'s result classes and blind spots are in its header and in
`docs/PSG.md` § "REVIEW-34's four misses, and what #63 added";
`music-mutation.js`'s are in its header and `docs/HUTRACK.md`.
`check-hutrack.js` needs `pceas4` on `PATH` (or `PCEAS4=`) for the ROM
rebuild; without it that one check prints SKIP and the recording checks still
run.

## `check-il-console.js` — #31 part A: the toy on the console

`renderer/pce-cgen.js` emits C from the IL (never from the Lua, never from
machine code); `tools/toyc/` is the console runtime; `tools/build-toyc.sh`
compiles it with llvm-mos's PCE target (an external tool at
`/Volumes/External II/pce-tools/llvm-mos`, overridable with `LLVM_MOS=`) into
an 8 KiB HuCard ROM. `tools/capture-toy.sh` is the capture route: build, run
in Mednafen with `-qtrecord`, SIGINT for the autosave, `mcs-extract.py --ram`
for the state (`--ram` is part A's addition: the TMA timer measurement lives
at BaseRAM `$2100`), and `movframes.py --all` for every recorded frame
(SLSTART=3 puts captured row 0 at VCE line 17 = VDW line 0, so the crop is the
toy's own 256×224 picture).

`node tests/check-il-console.js` exits 0 with 125 checks. It asserts the
emitter's refusal codes, rebuilds both ROMs and requires their committed
`meta.json` sha256s (SKIP when llvm-mos is absent), compares the palette
dump's last 8 frames with the browser runtime's frames 5..12 (exactly one
alignment in 0..7; every frame diff 0), requires vram/cram/sat byte-equal and
BXR/BYR/MWR equal at the aligned frame (CR differs only in bit 3, the
VBlank-status enable), and reads the measured frame cost from `ram.bin`:
7.243 timer ticks × 1024 = **7,417 cycles/frame** over 469 frames (`min` 7,
`max` 8). Code size: 8,192 B ROM, used `.text` 2,725 B + `.rodata` 10 B, the
toy's IL functions 2,014 B. Details, limits and the two llvm-mos findings are
in `docs/IL.md` §9.

Part C (`tests/dumps/toyparallax/`) runs `toys/parallax.lua`'s
`raster(line)` through a per-line table replayed by a hand-written RCR
handler: **40 consecutive display frames are diff 0** against the browser's
f135..f174, one every five captured frames (the collection measures 2.84
video frames, so the toy runs at ~12–15 Hz; the frames in between are the
compute period's static picture and are not compared). The measured cost of
one raster call, **1,510 cycles**, is why the compiled callback is not the
interrupt handler. The capture also records the per-call and per-collection
timer sums (`raster_calls`, `cycles_per_raster_call`,
`cycles_per_collection`, `flags`) in `meta.json`. `status-bar.lua` and #30's
`TOY_RASTER` are measured failures, documented in `docs/IL.md` §10.4.

## `check-il-huc.js` — #31 part B: the same IL through HuC

The same emitter with `{target: "huc"}` writes C that HuC's compiler
accepts (16-bit `int`, no `<stdint.h>`, no attributes, no local initialiser
lists, declarations first); `tools/toyc/huc_runtime.c` is the console side
and `tools/toyc/huc_raster.asm` is part C's RCR handler as a bank-0 PCEAS
file, hooked through HuC's user IRQ1 vector. `tools/build-huc.sh` compiles
with `bin/huc` and `bin/pceas` from `HUC_DIR` (default
`/Volumes/External/pce-tools/huc-src`, fetched and built by the script
itself); `tools/capture-huc.sh` is the
same Mednafen route and writes `tests/dumps/<name>-huc/`.

`node tests/check-il-huc.js` exits 0 with 74 checks: the dialect and its
refusals, both ROMs rebuilding to their committed sha256s (SKIP without HuC),
the palette dump's captured frames matching the browser with a run of 8
consecutive diff-0 frames and byte-equal vram/cram/sat, and the parallax
dump's raster frames with a run of **20 consecutive diff-0 browser frames**.
It reports the measured costs — palette `frame()` **102,123 cycles** (86 % of
a video frame, which is why the runtime holds its palette writes for VBlank),
raster call **3,728 cycles**, collection **835,048 cycles = 7.0 video
frames** — and the ROM sizes/bank counts. The two routes side by side are
`docs/IL.md` §12.

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
fails the run as a diff. The shipped count is **96 pictures** (scenes 1-9,
5b, 8b, 8c, the #48 window scenes 11-14, painted, spainted, viewer 1-3 and
7, browser 1-3, sprite 1-12,
vsprite 1-12, bsprite 12, raster 1-11, browser 10, #49's dma1-3, #76's
dma4-5 and sprite14-17, and #70's `vwide336`/`vwide512`/`wedit336`/
`wedit512`; the `check-review-fixes.js` expected set is the name-by-name
list), us1
skipped.  `raster11`/`vraster11` are #68's (the frame counter + two CRAM
words table REVIEW-16 could not reach).  `wide336` and `wide512` are #27's:
the /3 and /2 VCE dot clocks (`tools/capture.sh 336 wide` /
`capture.sh 512 wide`), captured at Mednafen's real output width for the
picture's clock — 341x232 (the 336-dot display, 2 border dots left and 3
right) and 512x232 — because the capture de-scales by 1024/width, the
factor QTRecord used to fill its 1024-wide surface.  `check.js` takes the
frame's width from the saved VCE CR (`regs.VCECR`), not from a constant.
`vwide336`/`vwide512` (#70) are the *viewer* ROMs of those pictures
(`tools/capture.sh 336|512 vwide`): the same frames, produced by
`viewer.asm` writing the picture's own VCE CR + HSR/HDR from config
version 2's wide-window block, byte-for-byte equal to the browser export.
`wedit336`/`wedit512` (#70) are the editor's own wide pictures
(`tools/capture.sh 336|512 wedit`, built by `check-editor.js --write
wide336|wide512`), captured at 341x232/512x232.
A dump
whose window is smaller than the captured frame must also show CRAM[0x100]
on every border pixel and the picture inside (check.js's `checkWindow`,
computed from the raw registers; scenes 11-14 print their window rectangle
and border count).
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

## The DMA check (#49)

`tests/check-dma.js` reads each `dumps/dmaN/` (built by `tools/genroms.py`'s
`DMA_SCENES`, captured with `tools/capture.sh N dma`) and its `dma.json` —
the SOUR/DESR/LENR/DCR the ROM was generated from.  It runs
`renderer/pce-vram.js`'s `runDma` on the base scene's pre-transfer VRAM and:

- requires the capture's VRAM equal to the model's **word for word** (all
  32768 words, first differing word reported);
- requires the captured SOUR/DESR/LENR to equal the model's post-transfer
  counters (they keep their new values, LENR = `$FFFF` — MacDonald §15.1
  GAP 2) and the captured DCR to equal the descriptor's;
- requires SR bit 4 (DV) to equal the model's DVC-gated flag: set on dma1
  (DCR `$12`), clear on dma2/dma3 (DCR without bit 1), so the gate has a
  positive and a negative capture;
- for dma3, whose destination overlaps its source, computes the
  snapshot/memmove copy and requires the capture to differ from it (448
  words) — the hardware moves one word at a time;
- renders the frame from scene 4's pre-transfer VRAM plus the descriptor
  through `pce-bg.js` (its `opts.dma` path) and requires the recorded frame
  byte for byte.

`check.js` also renders every dmaN dump from its own captured VRAM (75
pictures).  The model, its sources and its limits are in
[`../docs/RENDERER.md`](../docs/RENDERER.md), "VRAM-to-VRAM DMA".

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

`dumps/raster11` is #68's (REVIEW-16 B15): the stripes picture with a
per-line ramp of CRAM[0x000] (the visible left half) **and** a second
per-line word into CRAM[0x1F0] (sprite palette 15 colour 0 — never
displayed, so the frame is not exposed to the line timing) **and** the frame
counter on.  Its table is generated by `tools/genreview16.py`, which adds
the scene to `genroms.py`'s machinery from the outside (one source of truth
for the values) and builds the viewer ROM through `genviewer.py`; both are
recorded by `tools/capture-review16.sh raster11|vraster11`.  The saved
colour table is the B15 witness: with the counter removed from the second
word, `check-raster.js` reports `cram entry 496: table 11 != state 0`.

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

#68 adds two things to this check. `vraster11` is the viewer ROM of
`raster11`, whose table is the one shipped combination REVIEW-16 could not
reach: a per-line backdrop ramp **and** a second CRAM word **and** the frame
counter (B15). Its second word writes CRAM[0x1F0], which the background-only
picture never displays — the saved colour table is the witness and the frame
is not exposed to the line timing (measured: with a visible second word the
pristine handler lands it one pixel late; `docs/REVIEW-16.md`'s #68
appendix). `tests/dumps/vtrace2/` and `vtrace2-b14/` are the first-frame
trace fixtures: a VDC write trace from reset of the pristine `vraster2` and
of the B14 mutant (the boot arm one line late), so B14 — invisible in every
image capture — has a witness. The check requires the first four RCR matches
to be the table's steps 0..3 in order (RC set), every steady-state arm to be
a table arm, and the `match` fixture's ROM sha256 to equal the tree's build;
the B14 fixture's `meta.expect` is `mismatch` and the suite **fails if that
control ever passes**. Record with `tools/capture-review16.sh trace` (needs
the instrumented Mednafen in `MEDNAFEN_TRACE`; it exits 2, NOT RUN, without
it).

#74 adds `vraster13`, the mixed-op fixture REVIEW-30's V1 no-op asked for:
232 steps that alternate colour-only CRAM writes (`op` bit 3) and BYR-only
writes (`op` bit 1), built by `tools/genreview16.py r13` so viewer.asm's
per-step dispatch vector (`$2240`) has a witness. Every shipped table is
homogeneous, so deleting the vector update changes nothing on any of them;
on `vraster13` the first odd step is dispatched to the colour stub and the
saved `BYR`/colour table and the frame disagree with the table (measured:
`saved BYR=0 != table's 81`, `cram entry 0: table 1ff != state 0`, 100256
differing pixels, while the other 34 captures and both trace fixtures stay
green). The fixture is
required by name and its table must still mix the two shapes: deleting it or
homogenizing it fails the suite rather than quietly removing the evidence.
Build the scene and viewer with `python3 -I tools/genreview16.py r13 --all`,
then `tools/capture.sh 13 raster` and `tools/capture.sh 13 vraster` (the
scene dump must exist before the viewer build). Not proven: any other pair
of shapes (e.g. the second-word-only stub `prestep_c2`), the mixed
register-plus-two-colour step #69 says cannot fit the blank, and hardware —
the witness is Mednafen.

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

## `check-python-builder.js` — both builders agree past the committed fixtures (#60)

`check-export.js` compares `renderer/pce-rom.js` against a *committed*
`tools/gen/*.pce`, and the largest committed picture has 2 copy regions, so
`tools/genviewer.py`'s 13-descriptor cap is exercised by no fixture.
REVIEW-46's breaker showed what that costs: `MAX_REGIONS` 13→8 (G11) and
13→255 (G16) both ran every suite green. This check builds the same synthetic
pictures — made from `dumps/scene1`'s VRAM/CRAM/registers — through both real
paths (a scratch `genviewer.py` + PCEAS 3.23, and `pce-rom.js`) and requires
the same outcome:

- **9 regions × 16 chars** and **13 regions × 16 chars** — both build, the
  ROMs byte-equal. 9 is G11's witness (a cap of 8 refuses it); 13 pins the
  cap's upper edge.
- **14 regions × 16 chars** — both refuse at the descriptor count: genviewer.py
  with its `AssertionError`, pce-rom.js with `"14 regions, the config block
  holds 13"`. 14 is G16's witness (a removed cap builds).
- **13 regions × 2048 chars** — the largest picture the config can describe;
  both build byte-equal at 108 banks (864 KiB). This is also the G15 evidence:
  the Python builder's `PCEAS_MAX_BANKS` guard cannot fire for any legal input
  (108 < 128), so 128→256 stays **NO-OP**, by measurement, not by a missed
  test. It becomes reachable only with 16+ descriptors (132 banks) — the
  layout choice on #58. See REVIEW-46.md residual weakness 3.

Exit 0 only when all four pictures have the same outcome through both
builders. Exit 1 is a disagreement — a refusal mismatch (G11/G16), differing
bytes, a failure this check cannot classify as the descriptor cap, or the
comparator's own self-test failing. Exit 2 is NOT RUN (no `python3`/`pceas`,
missing dump or bank-0 asset): nothing was measured, and that must not read as
a pass. What it does NOT prove: agreement on these four pictures is not
agreement on every BAT size, region shape or the sprite scenes' SG regions;
it rebuilds genviewer.py in a scratch tree rather than `make -C tools`, so
stale committed fixtures are check-export's business; and byte equality says
the builders agree, not that the ROM shows the picture on a console
(check-viewer.js) or a HuCard.

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

## `check-status.js` — the VDC's status lines and the sprite budget (#50)

`renderer/pce-sprites.js` gains `lineStatus()`/`status()`: per VDW line, OR
(a 17th strip was attempted — a CGX sprite spends two of the 16 strip slots),
CC (sprite #0 and another sprite have an opaque pixel at the same display
column, among the strips the line's budget keeps), RR (the RCR chain matched
on that line) and VD (the first line after the display); the status-register
bit is each condition AND its CR enable (CC 0, OC 1, RC 2, VC 3). This check
(written by @design, flagged for @review) recomputes the OR/CC lines from
`sat.bin` and the patterns in `vram.bin` at the raw-byte level, and RR/VD
from `raster.json`/the saved registers, then compares every line and the
frame's accumulated SR with the model, on all 70 dumps:

- **the save state's status register**: the 49 dumps whose ROM never reads
  SR (no raster table) must have `regs.json`'s `status` equal the model's
  frame SR — 0 for every one, so the CR-enable gate is what is checked (the
  conditions ARE true on sprite4/sprite11 and the register still reads 0);
- **the raster dumps**: their irq1 handler reads `$0000` and clears bits
  0-5, so the saved 0 is not comparable; the check requires the model to
  report an RR match with RC enabled, and records that those 21 dumps are
  read-cleared rather than register-compared;
- **the scenes the card names**: `sprite4` (19 sprites on row 66) and
  `sprite11` (15 strips + a 32-px CGX 16th) report OR **and** CC on VDW
  lines 2..17; `spainted` (the editor's crowded line) reports OR on
  200..215 and no CC. No captured scene has CR bits 0-3 set, so the check
  runs `sprite4`'s own SAT/patterns through the model with CR = `$CF` and
  requires SR = `$23` (CC+OR+VD) — a model calculation on the existing
  capture, not a new capture;
- **the editor's sprite budget**: a synthetic picture (sprite 0 overlapping
  sprite 1, 17 strips on line 0) reports CC and OR; every line's flags equal
  `sprites.status()` on the exported picture; with a gradient the budget's
  RR lines are the table's 224 entries, its VD line 240 and its SR `$04`
  equals the model's.

Self-mutations tried: ungating the bits, turning the 17th strip off, dropping
collisions and making RR a constant each make the check fail. A different
seat's break of this check is still owed (RULES.md rule 2), and the model's
sprite-0 CGX half rule (both halves treated as sprite #0; Mednafen only marks
the left cache unit) is not exercised by any dump — neither is a real-console
save state, since Mednafen is the only witness.

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

## `check-toys.js` — the Lua toys (#30)

`renderer/pce-toys.js` runs a Lua toy (Fengari) and writes the toy's register,
palette, SAT, VRAM and raster writes into the arrays `renderer/pce-sprites.js`
and `renderer/pce-bg.js` already read; it draws nothing itself. The check runs
three toys for 40 frames each — palette cycling, scrolling with the
`raster(line)` callback, and a sprite reading `pad[1]` — and, for every frame,
builds the same state by hand in JavaScript from each toy's written
specification, renders it through the same model, and requires:

- `vram`, `cram`, `sat`, `regs` byte-for-byte equal;
- the raster table (base, baseCram, entries including `cramPrev`) deep equal;
- pixels diff 0.

It also covers the two raster forms (a table registered in `init()`, a callback
defined in `init()`), the refusals by code (`reg-forbidden`, `reg-range`,
`pal-range`, `vram-range`, `sprite-range`, `raster-line`, `raster-line-full`,
`password-value`, `password-code`, `toy-timeout`, `toy-error` with
`toy.lua:<line>`), the sandbox doors, and the password round trip.

#74 closes REVIEW-30's three misses. Every pad 1-5 is given a different
button and the toy prints all eight fields of each pad on two frames with
different button sets, so A6's `pad[n]` reading `pad[1]` (or any
cross-wiring) changes a printed line. The password caps are the #73 round
trips at every documented maximum — the 64-byte string is A7's measured miss.
Each of the three toy loops and a dedicated counting toy assert the frames
actually run (the host's frame index plus the toy's own `frame()` counter),
and the summary banner is printed from the smallest measured count, not from
`FRAMES`, so a loop shortened to 39 frames cannot leave a banner claiming 40.
Re-run against the breaks (one at a time, in an isolated copy): A6 DETECTED
(8 failures), A7 DETECTED (`a bad string length in the code` at 64 bytes),
A12 DETECTED (6 failures, all reporting 39 frames).

**It does not prove hardware or the browser.** The hand-built expectation and
the runtime share the model, so a model bug cancels out; the check proves the
runtime lands the toy's writes where the model reads them, not that the model
is the VDC/VCE. The page `renderer/toys.html` is not executed here (no
browser), and `raster(line)` is 224 Lua calls, not an RCR ISR — pricing and
compiling that are #32/#31.

## `check-examples.js` — the example toys (#29)

`toys/` holds five example toys — `parallax.lua`, `sky-gradient.lua`,
`road.lua`, `status-bar.lua`, `palette-cycle.lua` — each a classic PC Engine
effect with the trick explained in its comments (`docs/EXAMPLES.md`). The
check runs each one for 120 frames through `renderer/pce-toys.js` and through
`renderer/pce-il.js` and requires, for every frame: `vram`, `cram`, `sat` and
the four registers byte-equal, the raster table identical (deep, including
`base`/`baseCram`/`cramPrev`), pixels diff 0, and equal frame size.

It also measures the budgets: every Lua frame inside the runtime's own 100 ms
deadline (the worst wall time is printed), the IL inside its default
5,000,000-instruction budget, and the model's own per-line SAT search
(`pce-sprites.js`) reporting at most 16 strips per line with no OR/CC — the
#50 budget, which these sprite-free toys meet with 0 strips.

Then it checks the effect in the pixels rather than in the toy's words (the
four parallax bars at their bands' BXR offsets, the sky's gradient and sun,
the road wider and bent below the horizon, the status bar's 24 rows identical
in frames 0 and 60 while the playfield moves, and the rotated palettes), and
writes frame 60 of each to `dumps/examples/<name>.png`, reading it back pixel
for pixel.

**It does not prove hardware or a browser.** The pictures are our model's; no
example has been exported to a `.pce` (that is #31's next half) or run in an
emulator. The toys and this check were written by the same seat (rule 2: a cold
break is owed).

## `check-validate.js` — the validator (#32)

`renderer/pce-validate.js` prices a toy on its IL: it runs the reference IL
interpreter with one observer per instruction and computes `frame()`'s cycles,
every `raster(line)` call's cycles, the sprite budget (#50's model), VRAM and
ROM fit, each raster entry's replay cost against part C's blank, and the value
ranges. `docs/VALIDATE.md` gives the per-op cycle table and says where each
number comes from (the HuC6280 timings' shapes; a scale calibrated on part A's
7,417-cycle palette frame and part C's 1,204-cycle parallax `frame()`).

`node tests/check-validate.js` exits 0 with 178 checks. The five #29 toys pass
and their budgets are printed; parallax's prediction is held out of the
calibration and must be within the stated 15% of part C's TMA measurements
(`frame()` 1,203 vs 1,204, mean `raster()` 1,398 vs 1,510, −7.4%). A frame()
loop too long is refused `validate-frame-budget`, 17 sprites on a line
`validate-sprite-line` (16 is the 256-px boundary and passes), a ROM estimated
past 1 MB `validate-rom`, and `reg("BXR", 2000)` the host's `reg-range`; all
four are also refused by `tools/toyc/emit.js`, which runs the validator before
the C emitter and exits 1 with the code. `road.lua` passes with `135 cycles`
of warning on every line: part C's replay handler fits two registers, not a
register and a colour word.

Not proven: the table is calibrated on two toys and Mednafen only; the ROM
estimate is ±2x per function; the rate and blank overruns are warnings, not
refusals (the five toys must pass). The #89 section below records the seven
gaps in this instrument that a cold break found and the fixtures that now
catch them; the test was written by the seat that wrote the validator, so
those fixtures are the only part of this file written by another seat.

## #89 — the eleven breaks the cold review found MISSED, and what now catches them

`docs/REVIEW-31C.md` broke the three instruments 26 ways: 13 DETECTED, 11
MISSED, 2 NO-OP. The eleven missed breaks were fixed by fixtures, written by
@test (a different seat from all three builders) — and each break was re-run
against the **unmodified** new check in a scratch copy of the tree
(`git archive HEAD` + these test files under `$TMPDIR`), one break at a time,
with the substitution asserted to occur exactly once. The real repository was
never edited. **11 DETECTED, 0 MISSED.**

| break | check | the fixture that catches it | what the re-run printed |
|---|---|---|---|
| C08 arity guard removed | `check-il-console.js` | a one-int raster toy's IL with `params = ["int","int"]`, refused `cgen-hook` (and the control proves the one-parameter shape emits `toy_raster(int32_t line)`) | `FAIL cgen refusal a raster hook with two parameters was accepted` |
| V01 `OP_CYCLES.reg` 24→28 | `check-validate.js` | the table compared row by row with a literal, plus a fixed IL program costing exactly the sum of its ops | `FAIL V01 the op-cycle table …` and `got 1279, want 1275` |
| V03 CGX counted as one strip | `check-validate.js` | 8 CGX (16 strips) pass; 8 CGX + 1 plain (17) and 9 CGX (18) are refused | `FAIL V03 eight CGX sprites ask for 16 strips (got 8)` |
| V06 raster range off by one | `check-validate.js` | a constant `lineArg` (the IL lowers literals to registers, so the fixture sets it as the export API can): 0 and 223 pass, 224 is the validator's `validate-range` | `FAIL V06 the validator's static range reports raster line 224, not only the host's run-time refusal (raster-line)` |
| V07 ceiling 8→7 | `check-validate.js` | a 16,900-op toy at ~880,000 cycles, between 7 and 8 frames, must be slow but not refused; the refusal message must name 8 frames / 954,544 cycles | `FAIL V07 a toy between 7 and 8 display frames is slow, not refused` |
| V09 ROM baseline off 5.8 KB | `check-validate.js` | each toy's estimate within 35% of the `rom_bytes` in its committed capture `meta.json` (the build it was captured from) | `FAIL V09 toypalette's ROM estimate 14,021 B … (off 71.2%)` |
| V10 three colour words | `check-validate.js` | `raster()` writing three `pal()` words on one line; two must pass at 101 cycles | `FAIL V10 three colour words on one line are refused` |
| V11 VRAM from `raster()` | `check-validate.js` | `vram[0] = 1` in `raster()`; the same write from `frame()` passes | `FAIL V11 a VRAM write from raster() is refused` |
| S02 envelope drops a source | `check-studio.js` | all five files' sources snapshotted before Save and compared in the envelope and after reopen | `FAIL the envelope carries every file's source exactly …; wrong: palettes.json` |
| S04 Ctrl+S only autosaves | `check-studio.js` | the anchor `downloadText()` creates is watched: exactly one `.pce.json` download, its decoded text carrying the edit | `FAIL Ctrl+S starts exactly one download (got 0, want 1)` |
| S06 `editorText()` ignores CodeMirror | `check-studio.js` | a fake `window.CodeMirror` whose buffer differs from a deliberately stale textarea; the editor's text must be what runs | `FAIL editorText() is CodeMirror's text, not the stale textarea's` |

Every new check can print three things: **PASS**, **FAIL** naming the property
(which is the only failure the re-runs rely on), or a crash / a FAIL from
another check. The first two were both exercised above; a `FAIL` on a
different line would be reported as `DETECTED-OTHER`, not counted.

Not proven by these fixtures:

- **V06 is only reachable through a hand-built IL program.** From Lua the
  literal is materialised into a register, so the static branch never fires
  and the host's own `raster-line` refusal is what a user sees. The fixture
  pins the branch the emitter's exported API can take, not a path a Lua toy
  reaches today.
- **V09's band is ±35%, not exact.** It holds the unmodified model (palette
  +0.4% of its built ROM, parallax +27.7%), so a baseline error under about
  0.5–1.8 KB would still pass. It catches V09's 5.8 KB and nothing finer.
- **V03's fixture sets the CGX bit with `sat(i, 3, 0x100)`, not
  `cgx = true`**: the IL lowers a `true` literal in a table to `nil` today, so
  a sprite spec's `cgx` field never reaches the host (a separate bug, not one
  of the eleven).
- **S06's stand-in is not CodeMirror.** It models the two behaviours the break
  depended on (the textarea is not kept in sync; edits arrive through
  "change"). The vendored editor's real keymap, modes and DOM are still only
  exercised by `--browser`.
- **C01–C06 still close on the pinned ROM sha only.** Those six were already
  DETECTED in the review, but without llvm-mos they SKIP; this card did not
  change that (`docs/REVIEW-31C.md` residual weakness 1).
