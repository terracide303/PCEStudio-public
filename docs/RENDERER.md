# The renderer (#5 background, #12 sprites, #40 sprite-test gaps, #15 raster, #16 the viewer's raster chain, #48 display window, #49 VRAM-to-VRAM DMA, #27 the three dot clocks, #28 flicker multiplexing)

`renderer/pce-bg.js` renders one 256×232 RGB frame from a VDC VRAM dump and a
VCE colour-table dump, drawing exactly what the VDC background layer and the
VCE colour decoder draw; `renderer/pce-sprites.js` composes the VDC's sprite
layer (SATB) on top of the same colour-index buffer.  Since #15 both take a
**raster table**: per scanline, any of BXR, BYR, CR (BG/sprites on/off) and
VCE colour-table writes, applied at the line the hardware applies them.
Since #48 the frame is the VDC's **display window** (HSR/HDR/VPR/VDR/VCR),
not a fixed 32×30-character screen, and everything outside it is the border
colour CRAM[0x100].  The
close conditions are `node tests/check.js` reporting **diff 0** between the
renderer's output and Mednafen's raw recorded frame (same source surface as
its F9 screenshot, captured via `-qtrecord` because this Mac must not receive
synthesized key events) for every dump in `tests/dumps/` — the three #5
dumps, the eleven #12/#40 sprite scenes (marked by `sat.bin`), the four #48
window scenes and, since #15, the ten raster scenes (marked by
`raster.json`).  #16 adds the same
tables **run by the viewer ROM's own interrupt chain** (`tests/check-viewer.js`
on `vraster1-10` and `effect1`, plus the #41 ares cross-check).
#49 adds `renderer/pce-vram.js`, the VRAM model and the VDC's VRAM-to-VRAM
DMA (`tests/check-dma.js`; its three ROM captures `dma1-3` are also in
`check.js`, which is now 79 pictures with #27's two wide-mode frames).

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

**Display window and border (#48).** The VDC draws only inside its display
window; everywhere else the VCE shows the border colour, CRAM[0x100] — the
same blanking-period video data (SPBG=1, VD7..VD0=0) as the BB-off fill
(2.3.6 p. H7-18).  Five registers set the window (p. H7-9..H7-11): HSR
(HDS = back porch−1, HSW = sync width−1), HDR (HDW = characters−1, HDE =
front porch−1), VPR (VDS = back porch−2, VSW), VDR (VDW = lines−1) and VCR
(front porch **N, not N−1**).  The model:

- **Horizontally** the display starts (HDS+1) character cycles after the
  hsync rising edge and is (HDW+1)·8 dots wide; a character cycle is 8
  dots.  HDE is the *front* porch — it moves the sync, not the display, so
  it does not move a pixel (read and set by the window ROMs, but no pixel
  depends on it).  A window narrower than the VCE's 256-dot /4-clock raster
  leaves border at the right edge, and a larger HDS shifts it in from the
  left as well, giving border on both sides.  The absolute alignment —
  Mednafen gives its 256-dot output a canonical HDS=2 back porch at x=0
  (`pce_fast` `correct_aspect=1`: `start − (128 + 8 + 24)`) — is the
  emulator's, not a manual fact; the manual settles the fields, the 8-dot
  character cycle and the width.  MacDonald's measured notes agree the
  border exists and what colour it is (§15.1 GAP 1; `pcetech` §7 "Display
  details": the frame is 263 lines fixed and a 5 MHz line is "roughly 342
  dots", so a 256-px window leaves a left/right border; overscan = colour 0
  of sprite palette 0, `$100`).
- **Vertically** the model uses the same calibration as the background row
  (the scanline section below): captured row r shows VDW line
  `vdwLine0 + r`, and the display is the VDW+1 lines from line 0, so VDS
  and VSW enter through the save's `RCRCount` rather than a second, guessed
  offset.  VCR changes only where the next V-sync falls, so it never moves
  the window inside one capture; a short-VDW scene moves the rest of the
  263-line frame into it (scene14's VCR=44).
- **The border decodes through the row's own colour table**, so a raster
  write of CRAM[0x100] shows on the border from that line, exactly as the
  background does.
- **Sprites** are searched and drawn inside the window only (Mednafen draws
  them under the same `display_counter` gate), with SAT X=32 the window's
  first display column.  No capture has a sprite on a narrowed window yet —
  that placement is the model's reading of the manual's "the screen's
  top-left corner is at SAT coordinate (32,64)" (H7-21), **not measured**;
  it is written down here as not proven.

*Source: VDC manual HSR/HDR p. H7-9, VPR/VDR/VCR p. H7-10/H7-11, Fig. 2-2-1
p. H7-13, blanking video data 2.3.6 p. H7-18; docs/MANUALS.md §15.1 GAP 1
(`pcetech` §7/§9: the measured 256×240 row is exactly the canonical
registers, the standard 224 row is VDS=`$17` VDW=`$DF`, the overscan is
`$100`); Mednafen `pce_fast` `vdc.cpp` `CalcStartEnd`/`DrawOverscan` as the
reference for the 256-dot output alignment and the border fill.  The
window-check arithmetic also lives a second time in `tests/check.js`
(`expectedWindow`), so the renderer cannot pass by agreeing with itself.*

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

**Raster split (RCR, #15).** The scanning line detection register (RCR R06)
sets which line invokes the interrupt: "The interrupt will occur when the
value of the internal scanning line counter matches the value set in the
scanning line detection register" — the match sets status bit 2 (RR, "the
scanning line counter has matched up to the setting of the scanning line
detection register"), and the interrupt is enabled by CR bit 2 (RC,
"Scanning Line Detect").  The counter "is set to '64' at the previous
scanning line of start timing of display period and is incremented for each
scan": the counter counts 64 at the line before the display period starts
and one more per scan, so a match against `RCR = 0x40 + L` fires at the end
of VDW line L−1 — the HBlank before line L, in time for the handler's writes
to show on line L, the renderer's application line.  (The register's bit
split — bits 0–7 CPU-written, bits 8–9 the register's own low two bits — is
not transcribed in the manual text file; it is Mednafen's register model,
reference only.)  *Source: VDC
manual, SR R00 p. H7-4 (RR, bit 2), CR R05 p. H7-5 (RC, bit 2), RCR R06
p. H7-6..H7-7.*

**The blank's budget for a colour-table write (#69).** The colour table is
looked up per emitted pixel — Mednafen composites each pixel with the
current palette cache and updates that cache at the VCE store (`vce.cpp`,
`FixPCache`/`SyncSub`) — so a colour write that lands after line L's first
pixel leaves the pixels before it on the previous value.  A cell displayed
at the start of a line therefore witnesses the write's timing; one used
further right does not.  The RCR match fires 4 VDC clocks before the
visible line ends and the next line's first pixel follows 92 VDC clocks
later (≈123 CPU cycles, `vdc.cpp` `HPHASE_HDW_FINAL`→`HPHASE_HDW`), minus
the interrupt sequence.  Counted with the HuC6280's own timings
(Software Manual S8-17ff: every memory instruction costs one cycle MORE
than its 6502 number — `LDA/STA abs,X` and `STA abs` 5, `LDA/STA zp` 4,
`ADC zp` 4, `LSR A` 2, branch 2/4), a colour store that completes within
~100 CPU cycles of handler entry is in the blank.  Measured on
`tests/dumps/raster12`/`vraster12` (the second word paints the cell the
line's first pixels use): the pre-#69 `irq1_frm` completed its second
store at ~139 cycles and landed 24 px into the line — and `irq1_plain` at
~119, 14 px, which `r7` could not show because its second word paints the
right half.  Since #69 the step tail prepares the next step's write bytes
after the interrupt's stores, so a colour-only step runs one of the
straight-line stubs and its second store completes at ~72 cycles in the
stub (~78 from the vector), in the blank.  A step that mixes a VDC register with two colour writes needs
~120 cycles at any stride and cannot fit; no shipped table has one.

**Per-line write rules (the raster table's semantics).** The manual gives
each mid-frame register write a validity line, and the renderer's `buildRows`
applies the table's entries at exactly those lines (entry `line` fires in
the HBlank before VDW line `line`, so the row showing VDW line L carries the
last entry with `line <= L`):

- **BXR (R07)**: "If this register is updated, the screen will become valid
  with the next scanning line" — a write before line L shows from line L.
- **BYR (R08)**: "If the register is updated during display, the screen will
  become valid with the next scanning line (BYR+1)" — a write before line L
  starts the line counter at v + 1 on line L, so `bgY(L) = v + (L − line) +
  1`.  The line-0 latch at VDW entry takes the **register itself** (no +1),
  and the register keeps the previous frame's last write: with the last BYR
  entry at (N, v), the frame's lines before the first entry start at
  `bgY(L) = v + L`.
- **CR (R05)**: "SB will become valid from the next horizontal display
  period", "the BB will become valid from the next horizontal display
  period" — per line, like BXR.  The register keeps the previous frame's
  last write too, so the frame starts from the table's last CR entry.
- **VCE colour table**: the CPU writes colour data in four steps (CTA
  address low, CTA address high, data low, data high; the CTA
  autoincrements after the high data write).  The manual gives **no
  statement about when a colour-table write takes effect relative to the
  scanline** — the rule the renderer applies, a write during HBlank shows on
  the whole next line (and the table persists across frames), is this
  project's model, checked against Mednafen only, and labelled as such
  below under the scope limits.

*Source: VDC manual, BXR R07 / BYR R08 p. H7-7, CR R05 p. H7-5..H7-6; VCE
manual 2.2.2 p. H6-5 (the four-step write and the CTA autoincrement; no
timing statement found — the absence is itself a noted limit).*

**Status register (#50).** `pce-sprites.js`'s `status()` reports, per
rendered VDW line and for the frame, the four picture conditions and the
bits they latch into SR (`pce-panels.js`'s `status`/`registerLines` show
them, and the editor's `spriteBudget` shows the conditions in its panel):

- **OR (bit 1)** — the sprite-overflow condition: the on-line sprites ask
  for more than 16 strips, so the 17th is attempted.  The manual's wording
  is "more than 17 sprites"; a line holds 16 strips and a CGX sprite spends
  two, the count #12/#40 measured, so the condition is a 17th *strip*.
- **CC (bit 0)** — sprite #0 has a non-zero (opaque) pixel at a display
  column where another sprite among the kept strips has one too.  Pixel 0
  is transparent; sprites past the 16-strip budget are not drawn and cannot
  collide.  A 32-px sprite #0 is one SAT entry and both its halves are
  treated as sprite #0, which is the manual's reading; Mednafen marks only
  the first cache unit, so a CGX sprite-0 hit on its right half is a
  documented divergence no dump exercises.
- **RR (bit 2)** — the scanning-line counter matched RCR at `0x40 + line`,
  i.e. at the end of line-1 (the #15/#16 rule).  With a raster table the
  chains re-arm RCR at each entry, so the matches are the table's entry
  lines; without one the saved RCR is used.  A match on the VBlank line
  (raster5's 240) counts for the frame.
- **VD (bit 5)** — vertical blanking started: VDW line
  `(VDR & 0x1FF) + 1` = 240 in this mode.  The per-line entry is set on
  that line when the rendered window reaches it (the dumps' 232 rows are
  VDW lines 1..232, so there it is reported at frame level with its line
  number).

Each bit is the condition AND the CR interrupt enable it belongs to (CC
bit 0, OC bit 1, RC bit 2, VC bit 3), following SR H7-4's "if an interrupt
enabled by the ... bits of CR ... occurs, the corresponding bit is set".
No captured scene sets bits 0–3, so every save state's status reads 0 —
the tests check that gate, and run sprite4's own data with CR = $CF to show
CC+OR+VD latching.  DS and DV (the block-transfer done bits) are not
modelled.  A CPU read clears bits 0–5 (H7-4); the model accumulates them and
the tests account for the raster ROMs' handler reading `$0000`.
*Source: VDC manual SR p. H7-4, CR R05 p. H7-5..H7-6, sprite limits 2.4.3
p. H7-19; Mednafen `src/pce_fast/vdc.cpp` DrawSprites (the 16-unit
collection, the `status |= VDCS_OR` inside the OC-enabled branch and
`VDCS_CR` inside the sprite-0 branch) and its SR read clearing `& ~0x3F`
are the reference, not copied.*

**The interrupt path the ROMs ride (emulator specifics).** Two places where
the test ROMs target Mednafen's wiring rather than a documented hardware
fact, both noted because the manual says something different or nothing:

- Mednafen's PCE core wires the VDC's interrupt to the HuC6280's **IRQ1
  (vector $FFF8)** (`src/pce/vce.cpp` IRQChangeCheck → `IQIRQ1`); the
  HuC6280 manual lists IRQ1/IRQ2 as plain external inputs and does not say
  which one the VDC drives, so the ROMs' handler lives on irq1 — the
  emulator's wiring, *Mednafen reference, not a manual fact*.
- Mednafen's VDC returns and clears its status register on a read of
  address **$0000** (the ROMs' `lda $0000`); the manual's hardware sequence
  is reading SR via R00 + the data port.  *Mednafen reference; manual SR R00
  p. H7-4.*



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

Scenes 11–14 are #48's **window scenes**.  Each is scene 1's picture (same
BAT and tiles, BXR=BYR=0, CR=$80) with only the window registers changed, so
the picture inside the window is one scenes 1/4-9 already prove and every
difference is a window edge or a border pixel:

| scene | registers | window in the capture | border (measured) |
|---|---|---|---|
| 11 "224" | VDS=23 (`$17`), VDW=223 (`$DF`) | 256×224 at rows 7..230 | 7 top rows + 1 bottom row = 2048 px |
| 12 "vds" | VDS=27 (`$1B`), VDW=239 | 256×221 at rows 11..231 | 11 top rows = 2816 px |
| 13 "narrow" | HDS=4, HDW=27 (`$1B`) | 224×232 at columns 16..239 | 16 columns each side = 7424 px |
| 14 "short" | VDW=199 (`$C7`), VCR=44 | 256×199 at rows 0..198 | 33 bottom rows = 8448 px |

Every border pixel in the Mednafen capture is CRAM[0x100] (RGB 36,36,36) and
the colour never occurs inside any of the four windows, so the border is a
real witness, not a whole-frame fill (`tests/check.js`'s `checkWindow`
asserts both, from the raw registers, and prints the rectangle and count).
The 224-line and VDS rows follow MacDonald's measured table (`$17`/`$DF` is
the standard 224 row, §15.1 GAP 1); the short scene keeps the 263-line frame
whole by moving the difference into VCR (the front porch, N not N−1).

Scenes sprite1–8 are #12's, sprite9–11 are #40's (they close the three
misses REVIEW-12 found — see its #40 appendix): scene 1's picture (or the
stripes background) under one or more sprites.  The SAT lives at VRAM
0x7F00 and the SATB DMA
(DCR bit 4) loads it every VBlank; the SG cells are written by a formula
loop in the ROM and `tools/genroms.py`'s `sg_word()` mirrors it —
cell p, plane pl, row r = ROTL16(P_pl, (r + p) & 0xF) with P = 0x5555,
0x3333, 0x0F0F, 0x00FF, and P_3's rotation period is exactly 16 so all 16
rows of every cell differ (a renderer that reads the wrong row, block or
cell shows different pixels).  All 11 captures verified against the
mirrors: SAT 0/2816 mismatches and SG 0 mismatches of the cells the VDC
actually reads, per sprite (8256 words).  The scenes each pin one part
of the model:

- **sprite1**: all six sizes on one row, distinct palettes (a misread
  CGX/CGY, or a wrong cell, changes pixels)
- **sprite2**: flips — normal / X / Y / XY, plus a 32-px X-flip (halves
  swapped) and a 16×32 Y-flip (blocks reversed)
- **sprite3**: priority — BG transparent left of display column 128, solid
  colour 7 right; SPBG=0 sprites over the transparent half show (s0, s2)
  and an SPBG=1 control shows too; s3/s4 overlap and the lower SAT index
  wins.  #40 fixed the generator's stripes (tiles had been written into
  the BAT, so the solid half was colour 0 in every earlier capture) and
  re-captured it; the solid half's own cases are sprite10's
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
- **sprite9** (#40): a 16×64 sprite with CGY=2 — the one CGY code no
  earlier scene carried; REVIEW-12's M2 (CGY=2 decoded 32 tall) is
  DETECTED here
- **sprite10** (#40): an SPBG=0 sprite over an opaque BG tile (the solid
  colour-7 half) must be hidden, an SPBG=1 sprite over the same half must
  show, an SPBG=0 sprite over the colour-0 half must show; REVIEW-12's M9
  (SPBG ignored) is DETECTED here
- **sprite11** (#40): a line of 15 strips with a CGX sprite as the 16th
  SAT entry — its left half is the 16th strip (drawn), its right half the
  17th (dropped); REVIEW-12's M24 (the CGX guard gone) is DETECTED here

Scenes raster1–5 are #15's and raster6–10 are #43's (REVIEW-15's misses and
weak witnesses on structured tiles — `RASTER_SCENES`): each ROM boots with a
scene picture (scene 1's palette/BAT for 1–5, #43's bands/stripes pictures
for 6–10) and then chains **per-scanline writes from
the RCR line interrupt** — the boot arms `RCR = 0x40 + line` of the first
entry, each handler step writes its entry's BXR/BYR/CR/VCE colour-table
value, bumps the step, and re-arms RCR for the next entry (the last wraps
to the first; `<$30>` = step, ZP in RAM).  The chain runs every frame, so
at any line the registers hold the previous frame's last write — the
frame-start latch each scene's leading rows witness:

- **raster1 "statusbar"** (byr_const): steps at VDW lines 160..232 write
  BYR = 0x1FF each — a frozen band at the bottom (every row in it reads
  the same bgY), and lines 1..159 show `bgY(L) = 0x1FF + L` — the
  cross-frame persistence witness (a renderer that resets BYR per frame
  shifts those rows).
- **raster2 "wobble"** (bxr_table): steps at lines 1..232 write
  BXR = wobble[step] — a per-line horizontal offset (the BXR-per-line rule;
  a renderer applying BXR late or early shifts whole bands of rows).
- **raster3 "byr"** (byr_table): steps at (80, BYR = 0x30) and (160,
  BYR = 8) — the manual's BYR+1 per-line rule against the frame-start
  latch: the top band (before line 80) witnesses the latch = the last
  table entry, the middle band counts up from 0x30 + 1, the bottom from
  8 + 1.
- **raster4 "palette"** (cram_seq): steps at lines 1..232 write colour
  table entry s = `grad[s] + frame` (`grad[s] = (s·13 + 0x40) & 0x1FF`,
  a 9-bit gradient; `frame` is a counter bumped at step 0, `<$31>`).  The
  values shift by 1 every frame, so at any row the entries past it still
  hold the **previous frame's** values: a renderer applying all entries to
  all rows (or one line late) diffs; the colour table persists across
  frames (no reset).  `raster-patch.py` folds the captured frame counter
  into the dump's `raster.json` as `cram` (this frame) / `cramPrev`
  (previous frame) per entry.
- **raster5 "cr"** (cr_table): scene 1's picture plus two sprites (SATB
  DMA); steps at (100, CR = 0x84: SB off — the sprites vanish from the
  bottom rows), (160, CR = 0x44: BB off — the background becomes the 0x100
  fill), and (240, CR = 0xC4 restore — fires in the HBlank after the last
  display line, so the save at line 237 catches the chain at step 2, its
  steady state: the restore is never in a captured picture).

Scenes raster6–10 are #43's (REVIEW-15's misses and weak witnesses, on
pictures a person can read).  r6/r8/r9/r10 share the **bands picture**:
BAT tile (x, y) = 0x040 + (x + 2y) & 31, palette 0, each tile solid
colour ((t − 0x040) % 7) + 1 of seven bright pairwise-distinct hues
(REVIEW-15: r2/r3's noise changed statistically when scrolled, never
visibly) — diagonal seven-colour stripes whose band edges move with any
BYR/BXR change.  r7 is the #40 stripes picture (colour 0 left of display
column 128, colour 7 right).  REVIEW-15's own "capture that would catch
it" suggestions are exactly these scenes; `tests/raster-mutation.js`
re-runs its M6/M16/M17/M19 as source mutations and requires check.js to
report the measured diffs (the changed sets: raster8 / raster9 / raster10
alone, M17 no-op):

- **raster6 "bands byr"** (byr_table): r3's two-step BYR split on the
  bands picture.  The band edges are visible: the middle band's stripes
  jog at the seam (captured row 79 changes 168 of 256 px — the strongest
  single row in the picture) and bands 1 and 3 scroll alike, so the split
  is the one seam plus the middle band's offset.
- **raster7 "stripes ramp"** (cram_dual): steps at lines 1..232 write
  CRAM[0x000] = ramp (0 → 511) and CRAM[0x007] = 511 − ramp — the
  review's "a colour that covers a large area each line", twice: two
  full-screen staircases in opposite directions (232 distinct values down
  every column; each consecutive row differs).  An early/late write now
  changes a whole solid region per row.
- **raster8 "wobble late"** (bxr_table): r2's wobble, but the chain
  starts at line 50 — the first 49 captured rows (VDW lines 18..66)
  display the previous frame's last write, wobble(182) = 45 (the saved
  BXR is 45), not raster.base 0: the M6 witness (REVIEW-15's BXR
  frame-start latch miss).  Every pixel of the latch band differs from
  the base-0 render; from row 49 the wobble weaves the stripes (most
  consecutive rows differ in ~7/8 of their pixels).
- **raster9 "wobble shifted"** (bxr_table): r2's wobble captured with
  SLSTART=6 SLEND=237, so vdwLine0 = 3 — the M16 witness (REVIEW-15's
  calibration miss).  Hard-wiring vdwLine0 to 1 applies every table
  entry two rows late; the weave starts at row 0, so the whole screen
  differs (50032 px measured).
- **raster10 "sprite ramp"** (cram_sprite): the bands picture plus two
  solid-pattern sprites (16×64 at display cols 40..55 rows 40..103,
  16×16 at cols 150..165 rows 40..55; SPBG=1, every visible pixel sprite
  colour 1 → CRAM[0x101]); steps at lines 1..232 write CRAM[0x101] =
  ramp — the M19 witness (REVIEW-15's sprite-colour miss).  The sprite
  bodies carry the per-line gradient (every row distinct, 71 values down
  the tall sprite) over a static seven-hue background; decoded flat, the
  1280 sprite-body pixels lose it.

`tools/genroms.py` emits each scene's table as `gen/rasterN.raster.json`
(the renderer's input) and `check.js` verifies the table **against the
save state** before rendering: entries' lines strictly increasing, each
`rcr = 0x40 + line`, the saved BXR/BYR/CR equal the last entry of their
kind with `line <= RCRCount`, the saved RCR equals the chain's next arm
`0x40 + entries[(last+1) % n].line`, and the saved colour table equals
`baseCram` plus every entry's writes in line order.

**#16 — the viewer runs the table.** The same tables, executed by the
viewer ROM itself: `tools/viewer.asm` gains the RCR chain — the table
image (fixed layout, bank 1 offset `$640`, see ROM_LAYOUT.md) copied to
RAM `$2800`, the irq1 vector dispatched through RAM `$2020` to the plain
or frame-counter handler, step 0 armed and RC set in the config CR at
boot, and one step executed per matched line from the HBlank (the
budgeting and the timing model are [`MANUALS.md`](MANUALS.md) §16).  The
ten viewer captures `tests/dumps/vrasterN` (one per raster scene, built by
`tools/genviewer.py` and the same bank-0 code) plus the editor's effect
picture `tests/dumps/effect1` (built by `renderer/pce-rom.js` from
`tests/check-editor.js --write effect` — the gradient + wobble + parallax
bands table at frame 5) are held to the **same witnesses**: the shared
`tests/check-raster.js` verifies the table against the viewer's own save
state (the viewer really executed the scene's table), and the frame is the
renderer on the dump's own state with its patched table — diff 0.  For
`vrasterN` the picture data (VRAM, SAT, static registers) still equals the
scene's; for `effect1` there is no scene — `check-editor.js` holds the
capture to the editor's model instead (VRAM = the editor's, colour table =
`baseCram` + the chain's writes in line order, saved BXR = the last bxr
entry's value, CR = `$84`, BYR = 0).  `tools/capture-ares.sh` /
`tests/check-ares.js` (#41) extend the second-emulator cross-check to
`vraster1-3,5-10` and `effect1` — ares's RCR timing against Mednafen's;
`vraster4` is out because its frame counter makes two runs differ by
phase.

### #28 — flicker multiplexing (rotating the SAT order)

The VDC's line search keeps at most 16 strips (16-px sprite columns) per
display line, in SATB order — the rest of the line's sprites are dropped
(manual 2.4.3 p. H7-19..H7-24; the model is `pce-sprites.js` `collectLine`).
A picture with more sprites than that shows all of them over time by
rotating the SAT order every frame, so the 16 the search keeps are a
different window of the populated entries each frame.  The rule is written
once and mirrored in three places:

- **`renderer/pce-flicker.js` (the renderer's frame N).**  Frame _p_'s SAT
  entry _k_ is the base entry `(k + step*p) mod 64` — equivalently, the
  256-word SAT array rotated left by `4*step*p` words.  `renderFrame` draws
  it through `pce-sprites.js` exactly as the VDC draws any SAT; `keptSprites`
  names the entries the 16-strip search collects on a line (the base sprite
  each surviving slot holds).
- **`tools/viewer.asm` (`FLICKER` builds).**  `flicker_setup` builds
  `phases` rotated copies in VRAM at word `$7f00 - p*$100` from the ROM SAT
  at bank 1 `$4440`, each as two contiguous segments (words `W..255` then
  `0..W-1`, `W = 4*step*p mod 256`) — the whole 256-word array, so the word
  rotation is entry rotation with no per-entry index arithmetic.  A VBlank
  irq1 handler (VC, CR bit 3) advances the phase and writes DVSSR; the
  SATB DMA loads the copy it names at the next VBlank.  Reading VDC status
  clears VD and drops the level-sensed IRQ1 line (SR R00 p. H7-4).
  *Why the write lands a frame ahead:* Mednafen services the SATB DMA when
  the display leaves VDW and raises the VBlank IRQ later, at the first
  blanking line's HDW phase (`vdc.cpp` `NeedSATDMATest` / `DoVBIRQTest`;
  manual DVSSR R13 p. H7-12: the transfer starts at the next VBlank,
  triggered by the high-byte write).  This is the emulator's timing for the
  write, not a console measurement — the fixture proves the frames are
  consecutive phases, not that the write beat a hardware race.
- **`tools/genroms.py` `SPRITE_SCENES["sprite13"]` (the fixture rule).**
  24 16x16 sprites on one band, 10 px apart, `step` 6 with 4 phases, written
  to `gen/sprite13.flicker.json` — the one file `tools/genviewer.py` (the
  ROM's config bytes `$3E`/`$3F`), `tools/capture.sh` (the dump's
  `flicker.json`) and `tests/check.js` all read, so the ROM, the capture
  and the check cannot drift from one another.  With step 6 the kept
  windows are 0–15, 6–21, 12–3, 18–9: the union is all 24 and every sprite
  is shown 2 or 3 of the 4 frames (64 slots over 24 sprites cannot divide
  evenly, so a uniform 3-of-4 is impossible).

**Evidence.**  `tools/genroms.py` builds `gen/sprite13.pce` (the static
24-sprite scene: `tests/dumps/sprite13`, check.js diff 0 — the 16-strip
limit at 24 sprites) and the flicker viewer ROM `gen/flicker.pce` is built
by `tools/genviewer.py flicker` from that picture's data.  `tools/capture.sh
flicker` captures it in Mednafen (command line only, no synthetic input) and
keeps the last four recorded frames as `tests/dumps/flicker/flicker-0..3.png`
(`movframes.py --all`, the consecutive frames) plus the state and the rule.
`node tests/check.js` then reports: the viewer's VRAM `$7f00` is the base
SAT; **exactly one starting phase makes all four frames diff 0** against
the renderer's phases `q0..q0+3` (measured `q0` = 2 → phases 2, 3, 0, 1);
the saved SATB is the last frame's phase (1), so the DMA carried the rotated
SAT; and the **union** — measured on the captured pixels at a pixel only
each sprite can paint (its columns outside sprite _i-1_'s 16-px body) —
shows all 24 sprites, each in 2 or 3 of the 4 frames and absent in the
others, matching the rule's arithmetic.  The frames are rendered from the
**base SAT rotated by the rule**, not from the dump's saved SATB, so a
viewer that did not rotate, rotated by the wrong step, or wrote the copies
to the wrong address cannot pass.

The flicker code is assembled only into flicker builds (`FLICKER = 1` in
`gen/flicker.asm`, `.ifdef` in `viewer.asm`): the shared bank 0 that the
browser export and the #68 `vtrace` fixtures pin stays byte-identical
(measured: `viewer1`, `vsprite1` and `vraster2` rebuild to their old
sha256), so this does not move any other card's evidence.

*Not proven:* real hardware; the DVSSR write's ordering is Mednafen's
wiring plus the manual's "next VBlank" wording.  A cold break of
`checkFlicker` by a different seat is owed (RULES.md rule 2) before the card
closes.

### #49 — VRAM-to-VRAM DMA (SOUR/DESR/LENR, DCR)

`renderer/pce-vram.js` is the renderer's VRAM model: the 32K-word store the
rest of the renderer reads, plus the VDC's block copy.  `pce-bg.js` takes a
pre-transfer VRAM plus `opts.dma = { sour, desr, lenr, dcr }` and draws the
post-transfer frame; `tests/check-dma.js` also applies the model itself and
compares its VRAM with the capture.

**Registers and what the model does** (*HuC6270 VDC manual*: DCR R0F and
SOUR/DESR p. H7-11, LENR R12 p. H7-12 — LENA on p. H7-2, the manual's own
inconsistency, MANUALS.md §8.  MacDonald's measured notes, MANUALS.md §15.1
GAP 2 / pcetech §5.4, settle the rest):

- **LENR = words − 1**, up to 64K (0 → 1, `$FFFF` → 65536); the transfer
  starts on the **high-byte write**.
- **DCR bit 2 SI/D**: set = the source address decrements; **bit 3 DI/D**:
  set = the destination decrements.  Either, both or neither may be set.
- The transfer reads a word and writes it **before reading the next**, in
  address order.  This is the whole difference on an overlapping copy: the
  hardware replicates the first words it wrote, where a memmove would not.
  `dma3`'s capture is the witness (its VRAM differs from a snapshot copy on
  448 words).
- SOUR/DESR/LENR are **counters that keep their post-transfer values**;
  LENR ends `$FFFF`, not 0.  CR's IW field does not change the step (always
  1); MAWR, MAAR, the read buffer and the write latch are untouched by the
  transfer.  Both DMA channels may run together (the SAT channel is #14).
- **DCR bit 1 DVC** enables the VRAM-to-VRAM **done interrupt**, and SR bit 4
  **DV** is set on completion only when it is enabled — pcetech §5: "a status
  bit is set only when its enable bit is set" (the same gate #50 uses for
  CC/OR/RR/VD).  **Bit 0 DSC** is the SATB-done enable and **bit 4 DSR** the
  SATB auto-repeat; both belong to the other channel and are decoded but not
  executed here.  The model's `dvBit` is `DVC` set on a completed transfer.

**Timing.** A VRAM-to-VRAM transfer runs only outside the active display —
VBlank or burst mode (p. H7-12, H7-4).  The model applies a started transfer
in the free time that follows its LENR write and is complete for the frame
it is given.  A transfer too large to finish before the display starts is
the one point the sources contradict: **H7-12 says it is cancelled with no
done status; pcetech §5.4 says it is halted and resumed.**  The model applies
a started transfer to completion (the measured note's rule, and what
Mednafen does), and **no capture here depends on that choice**: each ROM
starts its transfer with CR = 0 (burst mode, where VRAM is always free),
waits ~10k CPU cycles (well past the longest transfer's ~2.3 lines), and
only then turns the background on.  The overrun rule is therefore recorded,
not claimed as hardware-proven.

**The three ROMs** (`tools/genroms.py`'s `DMA_SCENES`, assembled from scene 4
— a 64×32 BAT whose 64 tiles 0x080..0x0BF = VRAM words `$800..$BFF` are all
inside the 32K words and all on screen; scene 1 could not serve because its
odd-column tiles at 0xF00 are *beyond* VRAM on purpose, scene9's witness):

- **dma1 "forward"** — tiles 0x080..0x08F copied onto 0x090..0x09F,
  SOUR `$800` → DESR `$900`, LENR `$00FF` (256 words), both incrementing,
  DVC set.  Ends SOUR `$900`, DESR `$A00`, LENR `$FFFF`, SR `$10` (DV).
- **dma2 "decrementing"** — tiles 0x090..0x09F read from `$9FF` down and
  written from `$8FF` down onto 0x080..0x08F (SI/D and DI/D both set), so
  each tile's 16 words land reversed.  Ends SOUR `$8FF`, DESR `$7FF`, LENR
  `$FFFF`; DVC clear, SR `$00`.
- **dma3 "overlapping"** — 512 words from `$900` written to `$940`, over the
  source's own tail; the first 64 words repeat.  Ends SOUR `$B00`, DESR
  `$B40`; DVC clear.

**Evidence.** `tools/capture.sh 1..3 dma` records `tests/dumps/dmaN/`
(VRAM, CRAM, registers, frame; `dma.json` is the descriptor the ROM was
generated from).  `node tests/check-dma.js` exits 0: for all three, our
model's VRAM equals Mednafen's capture **word for word** (32768/32768), the
captured SOUR/DESR/LENR equal the model's post-transfer counters, the
captured DCR equals the descriptor, DV equals the model's DVC-gated flag
(set only on dma1), and the frame rendered from **scene 4's pre-transfer
VRAM + the descriptor** equals the recorded frame (diff 0).  `check.js` also
renders every `dmaN` dump from its own captured VRAM, so its count is **75
pictures** (72 + dma1-3).  `check-status.js` gained the DV term for the
dumps whose DCR enables it (0 for all others).

**Not proven:** Mednafen is the only witness (no real-console run); the
overrun rule is recorded, not tested; DSC/DS (the SATB channel) is not
exercised by these ROMs; and no capture crosses the 32K-word boundary (the
model mirrors reads there and drops writes, per MANUALS.md §15.3 item 6,
but no claim is tested).  Picture-configured DMA in the viewer/editor is the
split card (#49's split rule), not part of this work.

### #27 — the three dot clocks (256, 336 and 512 dots)

The VCE's control register `$0400` DCC bits 1-0 pick the pixel clock, and
the frame's width follows only from them: the VDC's window registers are in
dots of whichever clock is selected, so a 336- or 512-dot display is the
same HSR/HDR mechanism at another clock.

| DCC | clock | dot clock | line | frame Mednafen records | display (HDS/HDW, pcetech §9) |
|---|---|---|---|---|---|
| 00 | /4 | 5.37 MHz | 341 dots | 256 | HDS=2, HDW=$1F → 256 |
| 01 | /3 | 7.16 MHz | 455 dots | 341 | HDS=4, HDW=$29 → 336 |
| 10 (or 11) | /2 | 10.74 MHz | 682 dots | 512 | HDS=11 ($0B), HDW=$3F → 512 |

- **The two clocks the manual prints.**  HuC6260 manual 2.1.1, H6-3: CR
  "00" divides by 4 (fck = 1.5 fsc = 5.37 MHz) and "01" by 3 (fck = 2 fsc =
  7.16 MHz).  The manual's page is a figure with only DCC described.
- **The third clock is not in that text.**  MacDonald's *measured* notes
  (pcetech §6) give it — D1 = 1 = 10 MHz — and both Mednafen PCE cores
  implement exactly that: `src/pce/vce.cpp` `SetVCECR` takes `dot_clock =
  V & 3` with ratios `{4,3,2,2}` (codes 10 and 11 are the same /2 clock),
  and `src/pce_fast/vdc.cpp` takes `dot_clock = V & 1`, with bit 1
  forcing 2.  So there are three clocks, not four.
- **Line and frame width.**  A line is the same 2730 master clocks at 42.95
  MHz, so it holds 341 / 455 / 682 dots (Mednafen `ClockPixelWidths`), and
  the VCE shows a fixed active window of 256 / 341 / 512 dots with
  horizontal overscan off (`pce` `vce.cpp` `w_cows[0]`; `pce_fast` `ws[1]`;
  `pce.h_overscan` defaults to 0 and `capture.sh` does not change it).  The
  336-dot display therefore sits in the 341-dot output with 2 dots of border
  on the left and 3 on the right, and the 512-dot display fills its output.
  The renderer's frame is that output: `DOT_CLOCK.frameWidth`.
- **Position.**  `screen x = (HDS+1)*8 - hAlign` with hAlign = 24 / 38 / 96
  (`pce_fast` `xs[1]` with correct_aspect=1; the `pce` core's `x_offsets`
  minus its fixed 8).  `displayWindow` reads both from the picture's dot
  clock; the clipping of `start`/`end` to the line uses that clock's
  `lineDots`, not always 341.
- **The sprite layer does not widen.**  The SAT search buffer is **16
  entries at every clock** (manual 2.4.3; pcetech: the VDC parses the SAT
  until 64 entries are seen, all 16 buffer entries are used or HBlank ends,
  and a 32-px sprite takes two entries).  `pce-sprites.js` keeps the
  16-strip limit and clips strips at the frame's width
  (`paintLine(vram, strips, width)`), not at 256; `wide512`'s second sprite
  line has 18 sprites and shows 16 — the same rule as `sprite4` at 256.
- **`$0400` bit 2 is NOT PROVEN.**  Mednafen's VCE code makes it the
  262/263-line select (`pce` `vce.cpp` `SetVCECR`: `lc263 = V & 0x04`,
  `vblank_counter` 358995 / 357630; `pce_fast` `vdc.cpp` `frame_counter %
  ((vce.CR & 0x04) ? 263 : 262)`, i.e. **263 lines with it set**).
  MacDonald measured it as **edge blur, with the frame 263 lines fixed**.
  VIDEO_MODES.md (PCEHeroTN's RTL) says 262/263 too.  No source measured bit
  2 against a console, so the hardware's meaning is unproven; the model does
  not use it (frame length plays no part in a static picture) and every ROM
  here keeps it set, as every earlier capture did.  The settlement and its
  routes: docs/DECISIONS.md, 2026-10-28, and MANUALS.md §15.3 GAP 7.
- **Not modelled:** a dot clock changed mid-frame (VIDEO_MODES.md says the
  VCE reloads it every line and real games do it; no capture exercises it),
  Mednafen's Asuka 120%/Addams Family `CalcStartEnd` semi-hacks (specific
  register combinations none of our scenes use), and horizontal overscan
  (`pce.h_overscan` 1, frames 280/373/560 wide).

**Evidence.** `tools/genroms.py` builds `gen/wide336.pce` and
`gen/wide512.pce` (`SPRITE_SCENES`): a 64-wide BAT filled by a formula loop,
plus sprites at the right edge of the window — one wholly inside, one
crossing the edge, one past it — and, in `wide512`, an 18-sprite line.
`tools/capture.sh 336|512 wide` records them and de-scales the frame to the
width the saved VCE CR asks for (341 with 3 columns per source pixel, 512
with 2; Mednafen's `lcm_width` is 1024 in every mode, so QTRecord's
`xscale_factor` is `1024/width`).  `tests/check.js` renders both at
341×232 and 512×232 and reports **diff 0**; the same run keeps diff 0 on
all 77 earlier pictures.  The *builder's* mutants — width hardwired to
256, one line length, one alignment, the sprite clip at 256, DCC read as
bit 0 only — each turn check.js red on these dumps; a cold break by a
different seat is still owed (RULES.md rule 2).

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

The raster dumps (`tools/capture.sh N raster`, `--raster`) additionally
write `ram.bin` (the HuC6280's 8 KiB RAM from the save's `MAIN.BaseRAM`
record — the ROMs' step/frame counters live in ZP at logical $2030/$2031,
which MPR1 maps onto BaseRAM[0x30]/[0x31]) and copy the ROM's
`raster.json`, which `raster-patch.py` folds with the runtime state: it
asserts the chain is at the step the save line implies (every entry with
`line <= RCRCount` has fired — r5's line-240 restore is after the save, so
its chain sits at step 2, not wrapped) and, for raster4, rewrites the
entries' `cram`/`cramPrev` with the captured frame counter's values.  The
raster cross-check `BG_YMoo − BYR = RCRCount − 1` is skipped for these
dumps (the ROM writes BYR mid-frame, so the identity no longer holds);
`check.js`'s table-vs-state checks replace it.

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
bash tools/capture.sh 1 raster                 # capture raster scene 1 (adds raster.json)
bash tools/capture.sh 1 vraster                # #16: capture the raster viewer
bash tools/capture.sh effect                   # #16: the editor's effect picture
bash tools/capture.sh 13 sprite                # #28: the flicker fixture's scene ROM
bash tools/capture.sh flicker                  # #28: the flicker viewer (4 frames)
node tests/check.js                            # diff renderer vs Mednafen, all scenes
python3 -m http.server 8000                    # then open renderer/index.html
```

No X11, no extra toolchain, no synthetic input events: stock Homebrew
Mednafen, its QuickTime recorder and its autosave, driven only by its
command line and a SIGINT.

## Known scope limits (deliberate)

Background and sprites (sprite scenes 1–8 cover sizes 16×16..32×64, both
flips, both SPBG priorities, the 16-strip line limit, clipping and
sprite-on-background-off), and per-scanline raster writes (raster scenes
1–5: BXR, BYR, CR's SB/BB and VCE colour-table writes, applied at the
line the manual makes them valid).  Not modelled: the 4-colour sprite mode
(word 2 bit 0) and the SATB DMA's own timing.  Since #28 the DCR repeat bit
(DSR) and a per-frame DVSSR change are exercised — the flicker viewer's SAT
changes every frame and the capture proves the VDC loaded the rotation the
rule names — but the model draws frame N from that SAT rather than
simulating the transfer.  Since #50 the status register's four picture conditions
(OR, CC, RR, VD) are modelled from the same SAT/register data; the DS/DV
block-transfer bits are not (no DMA completion is modelled), and a CPU read
of SR clearing bits 0-5 is only accounted for in the tests, not simulated.
**All three dot clocks since
#27** (5.37 / 7.16 / 10.74 MHz → 256 / 341 / 512-dot frames), on two
captures (`wide336`, `wide512`) plus every earlier 5.37 MHz picture.  The
display window since #48 is modelled from HSR/HDR/VPR/VDR/VCR and proven on
four 5.37 MHz captures (scenes 11-14) and the two wide ones; the horizontal
absolute alignment is Mednafen's output geometry per clock (`xs[1]`), and a
sprite on a narrowed window is model-only (both labelled in the window
section above).  **All four of `viewer.asm`, `genviewer.py`, `pce-rom.js` and
the editor write the picture's own VCE CR and wide window since #70** — a
version 2 config carries the wide-window block (`docs/ROM_LAYOUT.md`), the
viewer ROM of `wide336`/`wide512` diffed 0 at 341×232 and 512×232 in
Mednafen (`tests/check-viewer.js`), the editor's exported 336- and 512-dot
pictures were captured at their real widths (`tests/dumps/wedit336`,
`wedit512`, `tests/check-editor.js`), and the panels follow a pixel past the
old 256-px edge (`tests/check-panels.js`, `vwide512`).  The editor's BAT is
still 32 tiles wide in every mode, so a wide picture repeats horizontally;
that (and rule 2's cold break) is what the wide evidence does not cover.
Raster writes are modelled at **line boundaries only**, and
the pieces the evidence does not cover are written down, not hidden:

- A VCE colour-table write during a line's active display shows the new
  colour mid-line (a "dot" from the write's exact pixel) — the manual
  gives no timing statement (the VCE manual's 2.2.2 describes the
  register and the four-step write, not when it takes effect), and no
  scene here writes mid-line: every entry fires in the HBlank before its
  line, where a write shows on the whole next line (the rule the renderer
  applies; checked against Mednafen only, labelled above).
- The ROMs' interrupt path is Mednafen's, not a documented hardware fact:
  the VDC's IRQ is wired to the HuC6280's IRQ1 ($FFF8), and the status
  register is read+cleared at address $0000 (the manual's SR read is R00
  + the data port; the HuC6280 manual does not say which IRQ input the
  VDC drives).  Both are labelled in the model section.
- Real-hardware IRQ latency (how far into the HBlank the handler's writes
  land on silicon) is not measured — only Mednafen's timing is
  exercised here.
  The window/state colour path is validated end-to-end by the diff
test, which is the cards' definition of correct.  One documented synthetic
input: `renderer-mutation.js` builds a 65536-word VRAM to make the
`ch ≥ 0x800` break detectable — no real dump can carry it, because
Mednafen's state holds 32768 words (scene9 is the rule's own proof: the
VDC itself reads colour 0 there).

## Test provenance note

`tests/check.js` was written by @design to close #5's acceptance condition.
Per the workshop role split it is flagged for @review to read cold, and #6
makes the renderer fail against it deliberately.
