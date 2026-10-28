# The renderer (#5 background, #12 sprites)

`renderer/pce-bg.js` renders one 256×232 RGB frame from a VDC VRAM dump and a
VCE colour-table dump, drawing exactly what the VDC background layer and the
VCE colour decoder draw; `renderer/pce-sprites.js` composes the VDC's sprite
layer (SATB) on top of the same colour-index buffer.  The close conditions
are `node tests/check.js` reporting **diff 0** between the renderer's output
and Mednafen's raw recorded frame (same source surface as its F9 screenshot,
captured via `-qtrecord` because this Mac must not receive synthesized key
events) for every dump in `tests/dumps/` — the three #5 dumps and, since
#12, the eight sprite scenes (marked by `sat.bin`).

Everything below is labelled by where it was read from.  PCEStudio's rule
(DECISIONS.md): the model is written from the Hudson manuals; Mednafen and
HuDK are references/checks only — **no emulator code is copied, linked or
built into PCEStudio**.

## The model (facts + sources)

**Video mode.** 256×224 (240 VDW lines), 5.37 MHz dot clock (VCE CR=0x04:
263 lines, 256 px).  The visible picture is 256×232 after Mednafen's default
crop `slstart=4`, `slend=235` (14 lines of top blanking, 1 bottom);
captured row 0 = VCE scanline `14 + slstart = 18`.  *Source: Mednafen 1.32.1
`src/pce/pce.cpp` (DisplayRect) and `src/pce/vce.cpp` (StartFrame); the crop
is Mednafen's, our dumps and screenshots are both made with it.*

**VDC BAT.** BAT word: bits 0–11 tile (character code), bits 12–15 CG COLOR
(palette); BAT lives at VRAM address 0.  MWR bits 4–5 set BAT width (0:32, 1:64, 2/3:128
chars), bit 6 sets height (0:32, 1:64).  The SCREEN table gives `011` as
128×32 and `111` as 128×64, the same sizes as `010`/`110` — the row stride is
the width in words for every code, so codes 2 and 3 share a stride of 128.
*Source: Hudson HuC6270 VDC manual, PCEHeroTN `docs/datasheets/text/HuC6270
VDC Manual - registers, VRAM write sequence, slots.txt`: MWR R09 p. H7-8,
SCREEN table p. H7-9; BAT 2.3.2 p. H7-14 (word layout on the same page);
HuDK `include/vdc.inc` confirms the bit positions.*

**Tile decode.** Tile = character code × 16 VRAM words: words 0–7 are
CH0 (bits 0–7) + CH1 (bits 8–15) for rows 0–7, words 8–15 are CH2/CH3.
The pixel at column c (0 = leftmost) of a row is bit 7−c of each plane byte —
i.e. **MSB = leftmost pixel** — and the pixel value is bit·CH0 + bit·CH1·2 +
bit·CH2·4 + bit·CH3·8.  Colour 0 of any BG palette is forced to CRAM entry
0x000 (the backdrop).  Character codes ≥ 0x800 address beyond the
32768-word VRAM; writes there are dropped and the display reads a zero tile
(colour 0) — measured on the hardware by scene9 (see the test ROMs below).
*Source: VDC manual, CG 2.3.3 p. H7-15 (where a
character's 16 words live); the palette fixup and the ≥ 0x800 rule are
Mednafen behaviour, not statements found in the manual text searched here —
Mednafen `src/hw_video/huc6270/vdc.cpp` (FixTileCache: `tc[7-x] = bit x`,
read at `bg_tile_cache[bat & 0xFFF][BG_YOffset & 7][BG_XOffset & 0x7]`;
FixPCache: palette colour 0 → CRAM[0x000]; VRAM_Size = 32768 in
`src/pce/pce.cpp`) as reference.*

**Scroll.** BG_YOffset latches per line at the HDS_PART2 hblank phase: the
pending increment is applied and BG_YOffset = BG_YMoo, where BG_YMoo = BYR
for the first line of VDW (RCRCount = 0) and increments once per line
thereafter; BG_XOffset latches to BXR at HDS_PART3 of the same line.  Both
are 9-bit (BYR) / 10-bit (BXR) counters that wrap.  In Mednafen's timing the
VDC's VDW phase begins at VCE line 17, one line before the first captured
row (DisplayRect.y = 14 + slstart = 18), so captured row 0 is VDW line 1.
*Source: VDC manual, BXR R07 and BYR R08 p. H7-7, 2.3.1–2.3.2 scroll control
p. H7-13; Mednafen vdc.cpp (IncRCR, HPHASE_HDS_PART2/PART3) as reference.*

**VCE colour.** CRAM: 512 addresses × 9 bits (2.2.1, p. H6-4); each 3 bits
are shared for G, R and B (2.2.2, p. H6-5).  This model reads them as
G=bits 6–8, R=bits 3–5, B=bits 0–2 with RGB = 36 × channel (0…252).  There
is no separate CG bit: bit 8 of the 16-bit storage is the **top bit of
green**, and the renderer decodes it as such.  Bits 9+ are zero in every dump
here, so this model claims nothing about what the VCE does with them.  BG
pixel → CRAM index `(palette<<4)|colour`.  *Source: Hudson HuC6260 VCE
manual, PCEHeroTN `docs/datasheets/text/HuC6260 VCE Manual - 0400 physical
1FE400, dot clock select.txt`, 2.2.1 p. H6-4 and 2.2.2 p. H6-5; the
channel order comes from Mednafen `src/pce/vce.cpp`
(`b=36*(x&7); r=36*((x&0x38)>>3); g=36*((x&0x1C0)>>6)`) as reference — the
manual's figure 2-2-1 is not transcribed in the text file, so the positions
cannot be read from it.*

**Background off (CR).** CR bit 7 = BB (background blanking): when it is
clear the VDC clears the background and every pixel shows the
blanking-period video data — SPBG = 1, VD7–VD0 = 0, i.e. the 9-bit colour
index 0x100, CRAM[0x100] (sprite colour 0).  The renderer fills the frame
with CRAM[0x100] and returns; scenes 8, 8b and 8c are the diff-0 proofs
(a full picture in VRAM, BB clear; burst mode on or off, DCR set or clear:
all 59392 pixels are CRAM[0x100] = 0x049 = 36,36,36 — so the burst and DCR
hypotheses were tested and rejected).  *Source: VDC manual, CR R05 p. H7-5;
2.3.6 blanking video data p. H7-18.*

**Sprites (SATB).** 64 SAT entries × 4 words, moved from VRAM into the
SATB by the SATB DMA (DCR bit 4, source DVSSR — our scenes keep the SAT at
VRAM 0x7F00).  Word 0 = Y (bits 0–9; value 64 = display row 0), word 1 = X
(bits 0–9; value 32 = display column 0), word 2 = pattern code << 1 (bit 0
= 4-colour mode, not exercised), word 3 = palette bits 0–3, SPBG bit 7,
CGX bit 8, HFLIP bit 11, CGY bits 12–13, VFLIP bit 15.  *Source: VDC
manual 2.4 p. H7-19..H7-24 (SAT word layout, sprite attributes).*

**Sprite patterns.** The pattern code p (word 2 >> 1) addresses a **64-word
VRAM cell at word p·64**: four 16-word planes SG0..SG3 at +0/+16/+32/+48 +
row, word bit 15 = the strip's leftmost pixel.  The manual states SG0 must
align at `XX000000` — six zero bits, a 64-word boundary (2.4 p. H7-21), and
the three references agree on the scale: Mednafen reads `no·64`
(`vdc.cpp` FetchSpriteData); MagicKit's `spr_pattern` stores `addr>>5` into
word 2 whose bit 0 is the CG bit, so the cell is `addr>>6`
(`huc-src/include/pce/sprites.inc`); the MiSTer core computes
`PC(10:4)&TILE_N` with 64-word tiles (`source/mister/huc6270.vhd`).  (The
first version of `pack_patterns` used 32-word units — the 16×16-px cell
written at p·32 is read at p·64, so both Mednafen cores drew nothing.
That is what the four sources above settle.)

**Sprite sizes.** CGY 00/01/10/11 = 16/32/64/64 rows, CGX = 32 columns
(two 16-px strips side by side).  The VDC masks the pattern code's low
bits per size and adds the block/half select: 16×16 = cell p; 16×32 =
cells p&~2, p&~2+2 (the manual's 2CGY: the two blocks are pattern codes
with PC2 = pattern bit 1); 16×64 = p&~6 + {0,2,4,6} (4CGY: PC3,PC2);
32-px wide = halves p&~1, p&~1+1 (CGX: PC1), HFLIP swapping the halves.
The row counter starts at 0 inside every cell, so a tall sprite reads
blocks 128 words apart with the skipped cell free.  VFLIP reverses the
rows within each cell and the block order.  *Source: VDC manual CGX/CGY
sections p. H7-22..H7-23 (the CGX example SAT, the 2CGY/4CGY PC3/PC2
specification); Mednafen FetchSpriteData and the MiSTer SPR_TILE_N agree
cell for cell.*

**Sprite line budget and priority.** At most 16 strips (16-px sprite
columns) per display line, taken in SATB order — sprites 17+ on the line
are dropped entirely.  Where strips overlap, the lowest SAT index wins the
pixel.  A visible sprite pixel (pixel 0 is transparent) replaces the
background when SPBG = 1, or when the background pixel's colour number
(the low nibble of its colour index) is 0 — so an SPBG=0 sprite still
shows over the backdrop (0x000) and over the BB-off fill (0x100).  Sprite
pixel p of palette n is colour index `0x100 | n<<4 | p`.  CR bit 6 = SB:
0 clears the sprites.  *Source: VDC manual 2.4.3 p. H7-23 (the 16-sprite
line limit), SPBG p. H7-20, CR R05 p. H7-5; the per-strip count, the
priority order and the exact BG test are Mednafen DrawSprites behaviour
(its target line buffer composes against `!(target[x] & 0x0F)`, i.e. BG
colour 0) — the sprite scenes below are the diff-0 proof that this is what
the VDC displays.*

## The test ROMs (`tools/genroms.py`)

Scenes 1–3 are #5's original torture pictures, and scenes 4–9 (with 8b, 8c
and 5b) are #39's: each new scene is **not** periodic in the dimension a
renderer break would cut, so the break shows as a diff (docs/REVIEW.md
finding 1).  All are HuCard ROMs (assembled with PCEAS, 8 KiB, one ROM
bank) that draw a static, deterministic picture and loop.  They share the
canonical HuDK `vdc_init_table` 256×224 register values (HSR/HDR/VPR/VDW/
VCR/DCR/SATB — *source: HuDK `include/vdc.s`, the working example
`tools/hello.asm` uses the same values*), differ in MWR/BXR/BYR/CR, and fill:

- **CRAM**: entry i = (i·7 mod 512) — a bijection mod 512 — OR'd with 0x100
  on three entries, then 0x000 and 0x100 replaced by the canaries below.  All
  three scenes share this table (same md5).  Bit 8 is green's top bit, and the
  scenes really display it: the backdrop 0x1FF has it set on every colour-0
  pixel, and 53 / 16 / 50 of the entries scenes 1 / 2 / 3 display (121 / 33 /
  113 distinct) have it set.  Only one of the three OR'd entries, 0x0F5, is
  displayed (in scene 2).  So the table *exercises* bit 8; it does not prove
  anything a no-op (`docs/REVIEW.md`, finding 3).  Entry 0x000 = 0x1FF (white
  backdrop canary) and 0x100 = 0x049 (blanking canary — appears only if a row
  leaves VDW).  `tools/genroms.py`'s `cr_words` carries the same note.
- **tiles**: scene 1 pseudo-random 8-bit rows (all 16 palettes, colour-0
  pixels present, 12-bit character codes 0x040+/0xF00+); scene 2 single-pixel
  checkerboards per plane (bit-order torture); scene 3 broad stripes.
- **BAT**: scene 1 = 32×32 (MWR=0x00, BXR=0, BYR=0); scene 2 = 64×32
  (MWR=0x10, BXR=100, BYR=53 — sub-tile scroll); scene 3 = 128×32
  (MWR=0x20, BXR=290, BYR=117 — BAT-wrap); scene 3's BAT is filled by a small
  formula loop in the ROM so the data fits one bank.  Scene 4 = 64×32 with
  BXR=256 and tile codes from the upper half of the 64-wide BAT (the part a
  32-wide BAT never reaches); scene 5 = 128×32 SCREEN code 3 (MWR=0x30,
  BXR=1000) — the code whose row stride #38's break got wrong; scene 6 =
  32×64 (MWR=0x50, BYR=400 — BAT wrap past row 31); scene 7 = 128×64 two
  banks (MWR=0x70, BXR=1000 — a 16384-byte BAT; note the exporter's
  two-bank *ROM* path in pce-rom.js/viewer.asm is a separate thing and is
  still only exercised by the 32×32 viewer captures); scene 9 =
  the ch ≥ 0x800 witness (even BAT columns read tiles 0x700+, odd columns
  read 0xF00+ and show CRAM[0x000]: measured, the VDC drops writes past
  word 32767 and the display reads colour 0); scenes 8/8b/8c = scene 1's
  picture with BB clear (CR=0x00), testing the CR model above.  Each BAT
  is filled by a small formula loop in the ROM so the data fits one bank,
  and `tools/genroms.py`'s `bat_formula()` mirrors the loops for
  verification (scene 4-9 BATs: 0 mismatches against the captures).

Scenes sprite1–8 are #12's: scene 1's picture (or the sprite3 stripes)
under one or more sprites.  The SAT lives at VRAM 0x7F00 and the SATB DMA
(DCR bit 4) loads it every VBlank; the SG cells are written by a formula
loop in the ROM and `tools/genroms.py`'s `sg_word()` mirrors it —
cell p, plane pl, row r = ROTL16(P_pl, (r + p) & 0xF) with P = 0x5555,
0x3333, 0x0F0F, 0x00FF, and P_3's rotation period is exactly 16 so all 16
rows of every cell differ (a renderer that reads the wrong row, block or
cell shows different pixels).  All 8 captures verified against the
mirrors: SAT 0/256 mismatches and SG 0 mismatches of 6400 words (the
cells the VDC actually reads, per sprite).  The scenes each pin one part
of the model:

- **sprite1**: all six sizes on one row, distinct palettes (a misread
  CGX/CGY, or a wrong cell, changes pixels)
- **sprite2**: flips — normal / X / Y / XY, plus a 32-px X-flip (halves
  swapped) and a 16×32 Y-flip (blocks reversed)
- **sprite3**: priority — BG transparent left of column 16, solid right;
  SPBG=0 sprites show left and hide right, SPBG=1 shows everywhere, and a
  hidden witness (SPBG=0, fully over the solid half) proves it; s3/s4
  overlap and the lower SAT index wins
- **sprite4**: 19 sprites at 13-px spacing on one row — 16 strips fit a
  line, SAT entries 16–18 must be dropped (SATB order) — and one sprite
  alone on its own line (the limit is per line, not per frame)
- **sprite5**: 16 sprites, one per sprite palette, 4×4 grid
- **sprite6**: clip — sprites cut by the left/right/top/bottom edges and
  one entirely above the picture (must not draw)
- **sprite7**: CGY blocks — 16×64 straight, 16×64 Y-flipped, 16×32, 32×64
- **sprite8**: background off (CR=0x40: SB set, BB clear) — every BG pixel
  is the 0x100 fill, whose low nibble is 0, so SPBG=0 sprites show over it
  like over any BG colour 0

## The dumps (`tools/capture.sh`, `tools/mcs-extract.py`, `tools/movframes.py`)

Hard rule for this machine: **no synthesized keyboard/mouse events** — the
human uses this Mac, and injected keys land in their terminal.  So the F9
hotkey is out, and the capture is command-line only:

- Mednafen records the run with `-qtrecord <file>.mov -qtrecord.vcodec png`:
  every recorded frame is one complete PNG (8-bit RGB, non-interlaced),
  decoded from the same raw unfiltered surface the F9 snapshot reads
  (*source: `src/mednafen.cpp:2047` → `QTRecord::WriteFrame(espec->surface,
  DisplayRect, ...)`; `src/qtrecord.cpp` PNGWrite path; main.cpp: "Video
  recording done without filtering applied"*).  The PCE core's `lcm_width`
  is 1024 (dot-clock width) and QTRecord replicates each source pixel 4×
  horizontally (DecodeLine's xscale_factor, same file), so each frame is
  1024×232 with the picture scaled across the full width; `movframes.py`
  scans the .mov, validates the PNGs, de-scales the last frame (every 4th
  column) to 256×232 and writes it as `mednafen.png`.  The last frame is
  steady-state (the "Using module" OSD has faded).
- A clean exit is requested with **SIGINT**; Mednafen's signal handler sets
  the exit flag and `CloseGame()` then runs `MDFNI_SaveState` for
  `-autosave 1` (*source: `src/drivers/main.cpp` CloseStuff/CloseGame*).
  The state lands in `~/.mednafen/mcs/sceneN.<rom-md5>.mca`.

Both artifacts capture the same static picture; the state carries its own
scanline/register pair, so the renderer's calibration is self-consistent.

The `.mcs` container (*source: `src/state.cpp` MDFNSS_SaveSM / SubWrite*):
gzip stream; 32-byte header (`"MDFNSVST"`, u64 LE time, u32 LE version, u32 LE
total_len, u32 LE neowidth=256, u32 LE neoheight=232); the filtered preview
(3×256×232 bytes, sinc-filtered in this build — **not** pixel-exact, used
only for looks); then sections `[32-byte NUL-padded name][u32 LE size]` with
records `[1-byte namelen][name][u32 LE size][data]`.  Host byte order (LE on
this Mac, no swap — the state header's total_len bit 31 is the BE flag).

`mcs-extract.py` pulls from the `VDC` section (VRAM 65536×u16, SAT, BXR, BYR,
MWR, RCRCount, BG_YOffset, BG_YMoo, BG_XOffset, the timing caches) and the
`VCE` section (`color_table` 512×u16, VCECR, scanline, pixel_offset) into
`tests/dumps/sceneN/{vram.bin, cram.bin, regs.json}`; the sprite dumps also
get `sat.bin` (the VDC's SATB array, 256×u16 — the SATB DMA has copied the
VRAM SAT into it, and the capture's SAT matches `sat_words()` 0/256).
`check.js` renders a dump with `sat.bin` through `pce-sprites.js` and every
other dump through `pce-bg.js` — and requires both to agree on the
sprite-free dumps, so the sprite renderer cannot change a sprite-free
picture.

### Scanline calibration (why the renderer doesn't guess the VDW offset)

The state records the VDC's RCRCount (display lines since the VDW entry) and
the VCE's `scanline` counter for the same instant.  VDW line 0 = VCE line 17
(the VDC's VDW phase begins one line before the first captured row,
DisplayRect.y = 14 + slstart = 18; RCRCount = scanline − 17 at save), so
captured row r (scanline 18 + r) is VDW line `RCRCount − (scanline − 18) + r`
and shows BG_YOffset = BYR + that.  A one-line error shifts the whole
picture one row and fails the diff test, so the dump is self-calibrating;
`mcs-extract.py` prints the arithmetic and `regs.json` records the raw
values.  Cross-check: `BG_YMoo − BYR` must equal `RCRCount − 1` at save time
(the save lands before its own line's HDS_PART2 increment) — printed by the
extract.

Two things follow from the arithmetic, and #39 measured them rather than
assuming them:

- On the standard crop, `vdwLine0 = RCRCount − (scanline − 18)` is
  **identically 1** for every save made during VDW (RCRCount = scanline − 17
  there).  So the standard captures cannot tell a derived calibration from
  the constant 1 — exactly REVIEW.md finding 1's complaint.  The proof that
  the formula generalizes is **scene5b**: captured with the crop shifted
  two lines down (`SLSTART=6 SLEND=237`, recorded in regs.json as
  `slstart`/`slend`), so its captured row 0 is VCE line 20 and its
  `vdwLine0` is 3 — and it is still diff 0.  The renderer reads the crop
  as `firstScanline = 14 + slstart`; hard-wiring `vdwLine0` to 1 shifts
  scene5b two rows and `renderer-mutation.js` catches it there.
- The save scanline cannot be chosen by timing the SIGINT: **measured 254
  for SLEEP 8.5 s through 9.5 s** (the save instant is phase-locked in
  Mednafen's main loop, sub-line jitter only).  Shifting the crop, not the
  save time, is what produces a different `vdwLine0`.

## Running it

```sh
make -C tools                                  # build ROMs (needs pceas)
bash tools/capture.sh 1                        # capture scene 1 (Mednafen on PATH)
bash tools/capture.sh 1 sprite                 # capture sprite scene 1 (adds sat.bin)
node tests/check.js                            # diff renderer vs Mednafen, all scenes
python3 -m http.server 8000                    # then open renderer/index.html
```

No X11, no extra toolchain, no synthetic input events: stock Homebrew
Mednafen, its QuickTime recorder and its autosave, driven only by its
command line and a SIGINT.

## Known scope limits (deliberate)

Background and sprites (sprite scenes 1–8 cover sizes 16×16..32×64, both
flips, both SPBG priorities, the 16-strip line limit, clipping and
sprite-on-background-off).  Not modelled: the 4-colour sprite mode (word 2
bit 0), sprite 0 collision detection, and the SATB DMA's DCR repeat bit
(the scenes' static SAT never changes).  256×224 mode only (5.37 MHz
clock; the 7.16 MHz modes and 256×240 VDW come with the editor).  No RCR
split.  The window/state colour path is validated end-to-end by the diff
test, which is the cards' definition of correct.  One documented synthetic
input: `renderer-mutation.js` builds a 65536-word VRAM to make the
`ch ≥ 0x800` break detectable — no real dump can carry it, because
Mednafen's state holds 32768 words (scene9 is the rule's own proof: the
VDC itself reads colour 0 there).

## Test provenance note

`tests/check.js` was written by @design to close #5's acceptance condition.
Per the workshop role split it is flagged for @review to read cold, and #6
makes the renderer fail against it deliberately.
