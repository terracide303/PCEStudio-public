# The background renderer (#5)

`renderer/pce-bg.js` renders one 256×232 RGB frame from a VDC VRAM dump and a
VCE colour-table dump, drawing exactly what the VDC background layer and the
VCE colour decoder draw.  The close condition for #5 is `node tests/check.js`
reporting **diff 0** between the renderer's output and Mednafen's raw
recorded frame (same source surface as its F9 screenshot, captured via
`-qtrecord` because this Mac must not receive synthesized key events) for
the three dumps in `tests/dumps/`.

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
(colour 0).  *Source: VDC manual, CG 2.3.3 p. H7-15 (where a
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

## The test ROMs (`tools/genroms.py`)

Three HuCard ROMs (assembled with PCEAS, 8 KiB, one ROM bank) that draw a
static, deterministic picture and loop.  They share the canonical HuDK
`vdc_init_table` 256×224 register values (HSR/HDR/VPR/VDW/VCR/DCR/SATB —
*source: HuDK `include/vdc.s`, the working example `tools/hello.asm` uses the
same values*), differ in MWR/BXR/BYR, and fill:

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
  formula loop in the ROM so the data fits one bank.

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
`tests/dumps/sceneN/{vram.bin, cram.bin, regs.json}`.

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

## Running it

```sh
make -C tools                                  # build ROMs (needs pceas)
bash tools/capture.sh 1                        # capture scene 1 (Mednafen on PATH)
node tests/check.js                            # diff renderer vs Mednafen, all scenes
python3 -m http.server 8000                    # then open renderer/index.html
```

No X11, no extra toolchain, no synthetic input events: stock Homebrew
Mednafen, its QuickTime recorder and its autosave, driven only by its
command line and a SIGINT.

## Known scope limits (deliberate)

Background layer only (no sprites — CR=0x80 in the scenes; sprites are #6+).
256×224 mode only (5.37 MHz clock; the 7.16 MHz modes and 256×240 VDW come
with the editor).  No RCR split.  The window/state colour path is validated
end-to-end by the diff test, which is the card's definition of correct.

## Test provenance note

`tests/check.js` was written by @design to close #5's acceptance condition.
Per the workshop role split it is flagged for @review to read cold, and #6
makes the renderer fail against it deliberately.
