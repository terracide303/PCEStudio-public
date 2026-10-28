# ROM layout of the viewer (cards #8, #9, #14 and #16)

Where the viewer ROM puts its data, and where `viewer.asm` reads it from.
This is the contract #9 (the browser .pce builder) glues into: bank 0 never
changes, and every data block sits at a fixed place.

All values are little-endian. All offsets are ROM byte offsets. A HuCard ROM
is a multiple of 8 KiB; gaps between banks and the padding of the last bank
are filled with `0xff`. The image is headerless (`pceas -raw`) and has
`4 + max(1, ceil(tiles / 8 KiB))` banks.

The bank count is not capped at 10 any more (card #46). The copy regions may
span banks 4–127: the viewer streams them through one 8 KiB window and maps
the next bank into it, so the image grows to the HuCard limit — 128 banks of
8 KiB = 1 MB (card #57). A HuCard decodes physical banks `$00`–`$7F` only
(sgxtech.txt "HuC6280 memory map"; pcetech.txt §3 "Memory map"; hes spec
[MEMORY MAP] ROM `0x000000`–`0x0FFFFF`; [`MANUALS.md`](MANUALS.md) §15.1
GAP 4); `$80`–`$F7` are not card memory, and the HuC6280's 2 MB / 256-block
physical space (hardware manual H8-7 and H8-10/11, `MANUALS.md` §5.1) is the
CPU's address space, not the card's. A request past 128 banks is refused
with the code `rom-too-big` (see [`EXPORT.md`](EXPORT.md)). `tools/genviewer.py`
stops at the same 128 banks: PCEAS 3.23's `.bank` index stops at `0x7F`,
which now coincides with the card's decode rather than being the tighter of
the two.

Two builders implement this contract and must agree byte for byte:
`tools/genviewer.py` (writes the `.asm` banks PCEAS assembles) and
`renderer/pce-rom.js` (the browser export, #9). Their agreement on the sample
scenes is measured in [`EXPORT.md`](EXPORT.md); #14 extends it to the sprite
scenes.

## Bank map

| bank | content |
|------|---------|
| 0    | viewer code and vectors (constant — the browser copies it verbatim) |
| 1    | config block (64 B at `$4000`) + the 512 colour-table entries (`$4040`) + the SAT (`$4440`) + the raster table image (3856 B at `$4640`, #16 — only when config byte `0x09` = 1) |
| 2–3  | the BAT: `width × height` words, starting at bank 2 offset 0 |
| 4–127 | the copy regions: the tile regions (and for the sprite scenes the SG pattern block) concatenated in descriptor order |

`tools/genviewer.py` emits exactly the banks each picture needs (one
`.incbin` per 8 KiB slice), so nothing ever spills past a bank boundary.

Bank 0 — the viewer code — is `renderer/viewer-bank0.bin` for the browser
export. It is extracted from the PCEAS build by `make -C tools bank0`; every
viewer ROM has the same bank 0 (the code never changes, only the data banks),
and `tools/extract_bank0.py` refuses to write the asset if they differ.

## Bank 1 — config block, offset 0 (`$4000` in the MPR2 window)

| offset | size | field |
|--------|------|-------|
| `0x00` | 1    | version (currently 1) |
| `0x01` | 1    | reserved (0) |
| `0x02` | 2    | BXR (background X scroll, 10 bits) |
| `0x04` | 2    | BYR (background Y scroll, 9 bits) |
| `0x06` | 1    | MWR (bat width/height bits, as written to VDC register 9) |
| `0x07` | 1    | CR (the final VDC control register value, bit 7 = background on; bit 2 = RC is ORed in when a raster table is present, #16) |
| `0x08` | 1    | region count (0–13) |
| `0x09` | 1    | raster-table flag (#16): 1 = the table image at bank 1 offset `0x640` is present and the viewer runs it; 0 = no table |
| `0x0A` | 4×13 | region descriptors, one per tile region (13 is the room before the palette at `0x40`: `(0x40 - 0x0A) / 4`; they end at `0x3E`) |
| `0x3E` | 1    | flicker step (#28): 0 = no flicker; else the SAT-order rotation per frame, in entries.  Read only by `FLICKER` builds of the viewer (`tools/viewer.asm`) |
| `0x3F` | 1    | flicker phases (#28): the number of rotated SAT copies the viewer builds, 1–8 (copy _p_ at VRAM `$7f00 - p*$100`).  0 in every non-flicker picture |

A region descriptor is two 16-bit words: the **VRAM destination word
address** and the **word count** of the tile data.

## Bank 1 — palettes, offset `0x40` (`$4040`)

512 words = VCE colour table entries 0–511: the 16 background palettes and
the 16 sprite palettes of 16 colours. Entry _n_ is the word at
`0x40 + 2n` (#14: was entries 0–255 before the viewer loaded sprites).

## Bank 1 — the SAT, offset `0x440` (`$4440`)

256 words = the sprite attribute table (SAT): 64 entries × 4 words (Y, X,
pattern, attributes), copied to VRAM word address `$7f00` — the source
address of the VDC's SATB DMA (register DVSSR R13). The CPU cannot write the
SATB directly; the viewer loads the SAT into VRAM and the VDC's DCR bit 4
(DSR) transfers those 256 words into the SATB at the start of every VBlank
(VDC manual 2.4.2 SATB p. H7-20, DVSSR R13 p. H7-12, DCR R0F p. H7-11).
Pictures without sprites carry a zero SAT here, which is loaded harmlessly
(CR bit 6 keeps the sprite layer off).

The SAT is picture data from VRAM word `$7f00` of the picture's own dump,
exactly like the BAT and the tiles; both builders read it from `vram.bin`
at that fixed address.

**#28 flicker.**  A `FLICKER` build (`gen/flicker.asm`, built by
`tools/genviewer.py flicker`) does not copy this SAT once.  With config byte
`$3E` = step and `$3F` = phases it builds `phases` rotated copies in VRAM at
word `$7f00 - p*$100` (phase 0 stays at `$7f00`, so the SAT above is phase
0's copy), rotating the 256-word array left by `4*step*p` words, and a VBlank
irq1 handler writes DVSSR to select one per frame (the rule is in
[`RENDERER.md`](RENDERER.md) §#28).  The copies occupy words
`$7f00 - (phases-1)*$100 .. $7fff`; `genviewer.py` refuses a picture whose
copy regions land in that span.  The step and phase count come from
`tools/gen/sprite13.flicker.json` (written by `tools/genroms.py`), so the
ROM, the capture and `tests/check.js` read one rule.  The flicker code is
assembled only into `FLICKER` builds: every other viewer ROM keeps the same
bank 0 (the browser export and the #68 trace fixtures pin it).

## Bank 1 — the raster table, offset `0x640` (`$4640`) (#16)

The #15 scanline table — a chain of per-scanline VDC register and VCE colour
table writes — as a fixed 3856-byte image (`RASTER_IMAGE` in
`renderer/pce-rom.js`), present only when config byte `0x09` = 1.  The
viewer copies the whole image to RAM `$2800` and runs it from the RCR (raster
counter) interrupt: each step is armed as an RCR match, and the irq1 handler
executes the step's writes on the line it targets.  The layout is the one
proven by the #15 scene ROMs (`tools/genroms.py`, the r_step/r_chain pattern
of `tools/viewer.asm`'s ancestors), flattened into 16 parallel arrays so the
handler can index them with one X register — the record walker it replaces
could not fit its per-byte work in the HBlank budget (see
[`DECISIONS.md`](DECISIONS.md)).

| offset | size | field |
|--------|------|-------|
| `0x00` | 2    | image size, always 3856 (`0x0F10`) |
| `0x02` | 1    | flags: bit 0 = frame-counter mode — the handler adds ZP `<frame` to each colour-table value (masked to 9 bits) before writing, for tables whose values move every frame |
| `0x03` | 1    | step count _n_ (1–240) |
| `0x04` | 240  | `r_op`: one op byte per step — bit 0 = write BXR, 1 = BYR, 2 = CR, 3 = first colour-table write, 4 = second |
| `0xF4` | 12   | padding — so the next array is page-aligned in RAM (below) |
| `0x100` | 15×240 | the 15 write-value arrays, 240 bytes apart: `r_chain_lo`, `r_chain_hi`, `r_bxr_lo`, `r_bxr_hi`, `r_byr_lo`, `r_byr_hi`, `r_cr`, `r_a1_lo`, `r_a1_hi`, `r_v1_lo`, `r_v1_hi`, `r_a2_lo`, `r_a2_hi`, `r_v2_lo`, `r_v2_hi` |

Each step's `r_chain` pair is the RCR match value the step arms itself with:
`0x40 + line`.  The VDC's raster counter is set to 64 at the scan line
before display start (VDC manual R06 p. H7-6/7), so an RCR below 64 never
matches; `0x40 + line` makes line 0's entry fire as the display window
starts.  Lines are strictly increasing and at most 240 — line 240 fires
during the HBlank after the last display line (239), which is how #15's
scenes restore the registers after the picture.  `r_bxr`/`r_byr`/`r_cr` hold
the write value (10/9/8 bits), `r_aN` the colour-table entry number (9 bits,
0–511), `r_vN` its 9-bit colour word.  A step writes at most two colour-table
entries; each op bit 3/4 pairs with the matching `r_aN`/`r_vN` slot.  The
values come from the VDC's own write order — the AR (address register), then
low byte, then high byte (VDC manual p. H7-25).

In RAM the image lives at `$2800`: the header, `r_op` at `$2804`, then the 15
arrays packed 240 bytes apart starting with `r_chain_lo` at the page boundary
`$2900` (the 12-byte pad in ROM puts it there).  The arrays are packed, not
page-aligned: a page-aligned array costs 224 bytes of padding each and the
image would not fit bank 1, while a packed pair costs the handler one extra
cycle on the rare steps whose 8-byte value read crosses a page — the worst
step still lands inside the ~111 CPU-cycle BXR budget that the RCR match's
placement leaves before the BXR latch (Mednafen 1.32.1's phase machine is the
timing oracle: `src/hw_video/huc6270/vdc.cpp`, `IncRCR` and `Run`; see
[`MANUALS.md`](MANUALS.md) §16 and [`RENDERER.md`](RENDERER.md)).  The copy
is 16 fixed pages, ROM `$4640`–`$563F` to RAM `$2800`–`$37FF` (end `$3800`,
clear of the viewer's config copy at `$2200` and of the zero page cells the
chain uses: step `< $30`, frame counter `< $31`, matching the #15 scene ROMs'
contract in `tools/raster-patch.py`).

The viewer runs the table only when config byte `0x09` = 1.  Boot then copies
the image, fills the irq1 dispatch cell (RAM `$2020`, the vector at logical
`$FFF8` points there) with `jmp ($2240)` — an indirect jump through the
handler vector at RAM `$2240` — zeroes the step and counter cells, prepares
step 0's write bytes, arms step 0, writes the config CR **with RC (bit 2)
ORed in**, and enables interrupts (`cli`).

The irq1 handler is chosen **per step**, not per table (#69): the step tail
(`prestep`) looks at the next step's op byte and fills `$2240` with one of
the straight-line colour-only stubs (`c1`, `c2`, `c12` — a step whose only
writes are colour-table words, 72 CPU cycles in the stub for two words) or with the
op-bit walker (`gen`) for a step that also writes BXR/BYR/CR.  The same
`prestep` prepares, in zero page, the next step's eight write bytes —
`$32/$33` first CTA address, `$34/$35` its value, `$36..$39` the second
word's — doing the frame-counter add there, after the interrupt's stores,
instead of in it.  The handler (no register saves — the main loop `bra`s and
touches nothing) then only loads and stores them (VDC registers via the AR =
`$0000` port, VCE address `$0402/$0403` and data `$0404/$0405`); the shared
tail advances the step (wrapping at _n_, bumping the frame counter per flags
bit 0), calls `prestep` for the new step, arms its RCR, reads the VDC status
register (clearing the RR bit, VDC manual p. H7-4) and returns.  The timing
is the card's whole risk and its proof: the handler's worst case is measured,
not estimated — see `RENDERER.md`; the deadline and its cycle count are in
`tools/viewer.asm`'s irq1 comment.

The editor's builder (`renderer/pce-rom.js`, `encodeRaster`) validates every
field and refuses with the documented codes `raster-lines` (lines not
strictly increasing in 0–240), `raster-rcr` (an entry's `rcr` not
`0x40 + line`), `raster-steps` (_n_ outside 1–240), `raster-cram-count`
(more than two colour-table writes on one line) and `raster-entry` (a value
past its register's width or the colour table past 9 bits); a picture with a
table always exports with config byte `0x09` = 1 and RC in the config CR.
`tools/genviewer.py`'s encoder is the PCEAS twin of this layout, and the two
must agree byte for byte (measured in [`EXPORT.md`](EXPORT.md)).

## Banks 2–3 — the BAT

`width × height` words, copied to VRAM word address 0. `width`/`height` come
from MWR (`(MWR >> 4) & 3` selects 32/64/128/128, bit 6 selects 32/64 rows),
so the BAT is at most 128×64 = 16 KiB = banks 2 and 3.

## Banks 4–127 — the copy regions

The regions, concatenated in descriptor order, starting at bank 4 offset 0.
The viewer streams this from the MPR2 window (`$4000`–`$5fff`, bank register
`MPR2` set by `TAM2`) and re-maps to the next bank every 8 KiB, so region
boundaries need not line up with banks. The MPR scheme is the HuC6280's: eight
8-bit mapping registers, each selecting one of 256 8 KiB physical blocks
(hardware manual H8-7, H8-10/11); the card, however, decodes only blocks
`$00`–`$7F`. Banks 4–127 are available to the regions — up to 124 banks =
992 KiB of tiles, inside the card's 1 MB (banks 0–3 hold the code, config
and BAT). The 13-descriptor config caps a legal picture below that: the
largest describable is 108 banks = 864 KiB (see `EXPORT.md`).

A region is usually a tile region; for the #12 sprite scenes the list also
carries the sprite generator (SG) pattern block — cell `$80` upward at VRAM
word `$2000`, `nblocks × 64` words where `nblocks` is the scene's pattern
span (`pack_patterns` in `tools/genroms.py`). The SAT is **not** a region:
it has its own fixed place in bank 1 (above), because the viewer's DVSSR
register fixes its VRAM address at `$7f00` for every picture.

The region list is picture data, read by both builders from
`tests/dumps/sceneN/regions.json` (and `tests/dumps/spriteN/regions.json`)
(`tile_regions`: `[char0, tileCount]` pairs in descriptor order). `char0` is
the first 16-bit VRAM character number; the descriptor's destination is
`char0 * 16` words and its word count is `tileCount * 16`.

Regions whose destination is beyond the 64 KiB VRAM (dest ≥ 32768 words) are
**not included** — writes beyond 32768 words are dropped on the hardware
side, which is also what the renderer model does (`renderer/pce-bg.js`), so
the browser must not emit them either.

## How the viewer reads it

- Reset sets MPR2 to bank 1, copies the 64-byte config block to RAM `$2200`
  and loads the 512 colour-table entries from `$4040`.
- The VDC init writes DCR = `0x0010` (bit 4, DSR: the VRAM-SATB transfer
  auto-repeats every VBlank) and DVSSR = `$7f00` (the SAT's VRAM address;
  the high-byte write starts the first transfer at the next VBlank) —
  VDC manual DCR R0F p. H7-11, DVSSR R13 p. H7-12.
- From then on every config read (BXR/BYR/MWR/CR, region count,
  descriptors) comes from the RAM copy: MPR2 is re-mapped to the data banks
  (2 for the BAT, 4 for the regions), and the region loop must still see the
  descriptors.
- After the regions, MPR2 returns to bank 1 and the SAT (256 words from
  `$4440`) is copied to VRAM `$7f00`. Sprites are still off, so the first
  displayed frame's SATB already holds this SAT (2.4.2 SATB p. H7-20: the
  CPU cannot write the SATB directly).
- #28, when config byte `$3E` is nonzero (`FLICKER` builds only): instead of
  one copy, `flicker_setup` builds `$3F` rotated copies (above), installs a
  VBlank irq1 handler through RAM `$2020`, and the handler advances the
  phase and writes DVSSR once per frame; the config CR is written with VC
  (bit 3) ORed in.  Flicker and raster tables are mutually exclusive (RC
  and VC would share irq1); `genviewer.py` never sets both.
- `copy_words` reads through the 8 KiB MPR2 window (`$4000`–`$5fff`) and
  re-maps to the next bank when the pointer crosses the window.
- Finally CR from the config turns the layers on: bit 7 = background,
  bit 6 = sprites.
- #16, when config byte `0x09` = 1: the viewer copies the 16-page raster
  table image to RAM `$2800`, patches the irq1 dispatch cell (RAM `$2020`,
  the logical `$FFF8` vector points at it) to the plain or frame-counter
  handler per flags bit 0, zeroes the step and frame-counter zero page
  cells, arms step 0's RCR, and writes the config CR with RC (bit 2) ORed
  in — then `cli`.  The RCR interrupt takes over from there: one step per
  matched line, re-armed by the handler's tail.

## Pictures the editor makes (#10, #13)

`renderer/pce-editor.js` writes this layout directly: tiles are handed out
from character `$40` (the first character after the 32×32 BAT at words
0–`$3FF`), the map is the 32×32 BAT (MWR = 0), and the region list is
`[[$40, tileCount]]` — **one** region for a picture without sprites, as #10
made it. Its BAT is always 1024 words (banks 2 only) and its tiles start at
VRAM word `$400`; the ROM is `4 + max(1, ceil(region bytes / 8 KiB))` banks,
as the formula above. The **editor** stops at 1536 tiles (the `tile-space`
refusal in `renderer/pce-editor.js`); the exporter's layout no longer caps
tiles at that point (card #46), so a picture from another source can use more
banks.

A picture with sprite patterns (#13) adds a **second** region: the patterns
are packed into 64-word VRAM cells after the tiles (first cell
`ceil(nextChar / 4)`, each at the alignment its CGX/CGY size needs) and the
descriptor is `[[firstCell·4, cells·4]]` — `char0 = firstCell·4`, `tileCount
= cells·4`, so the region's word count is `cells·64`. The pattern region ends
below the SAT at VRAM `$7F00` (the editor refuses a pattern that would reach
it), and tiles plus patterns are the copy regions of banks 4 onward (the
exporter takes them as far as the HuCard limit, #46; the editor's own
`tile-space` check still measures against its 1536-tile budget). The SAT is
not a region: it keeps its fixed place in bank 1 (above), and the config's CR
bit 6 turns the sprite layer on. Both regions are copied in descriptor order
before the SAT.

## A ROM past 80 KiB (card #46)

The bank scheme is the hardware's, not a cap the project chose. The HuC6280
has eight mapping registers (MPR0–MPR7), each mapping one 8 KiB logical
window onto one of 256 8 KiB physical blocks numbered `$00`–`$FF`
(HuC6280 hardware manual H8-7, H8-10/11; [`MANUALS.md`](MANUALS.md) §5.1),
so the CPU's physical address space is 2 MB. **The HuCard does not decode
all of it** (#57): it occupies blocks `$00`–`$7F` = 128 blocks = 1 MB
(sgxtech.txt "HuC6280 memory map"; pcetech.txt §3 "Memory map"; hes spec
[MEMORY MAP] ROM `0x000000`–`0x0FFFFF`; `MANUALS.md` §15.1 GAP 4). The
viewer uses **MPR2** (`$4000`–`$5fff`) as its one data window: `TAM2`
selects the bank and `copy_words` bumps the bank number and resets the
pointer whenever it crosses `$6000` (`tools/viewer.asm`). That code was
already bank-agnostic — the old 80 KiB limit lived only in the two builders:

- `renderer/pce-rom.js` (`MAX_TILE_BANKS = 6`, `MAX_REGIONS = 8`) and
- `tools/genviewer.py` (`assert len(tiles) <= 6 * BANK`, `MAX_REGIONS = 8`).

Both now lift those caps: `pce-rom.js` takes banks 4–127 and 13 regions;
`genviewer.py` takes 13 regions and 128 banks. Past the card's 128-bank
ceiling the browser builder refuses with the code `rom-too-big` rather than
emitting a ROM the hardware cannot map. `tools/genviewer.py` stops at the
same 128 banks for its own reason — PCEAS 3.23's `.bank` index itself stops
at `0x7F` (`huc-src/src/mkit/as/main.c`, `bank_limit`) — so here the
assembler's limit and the card's decode happen to be the same number.

The 88 KiB picture the card is proven on is `tests/dumps/scene10`
(generated by `tests/make-big-scene.js`, made by both builders as
`viewer10`): a 64x64 BAT (8 KiB), a full 32 KiB tile set (1024 tiles), and
160 sprite-pattern cells (20 KiB) = 53,248 bytes of copy regions, 7 tile
banks, `4 + 7 = 11` banks = 90,112 bytes. A 128x64 BAT cannot exceed the old
cap — its 16 KiB BAT leaves only 48,640 bytes of regions in 64 KiB of VRAM,
which is exactly the old 6 tile banks (80 KiB); the 64x64 BAT leaves room for
the sprite patterns that push it over.

## What the viewer does not do

- It does **not zero VRAM** before copying: regions outside the copied data
  are whatever VRAM held. That matches HuDK's loaders — the browser's job is
  to lay out the picture (or accept undefined junk) there.
- It does not check the version byte or the reserved bytes. The browser
  export (#9) writes version 1 and zero reserved bytes, but does not verify
  bytes in a ROM it did not build.
- Copy regions must not overlap each other or the BAT or the SAT in VRAM;
  the viewer copies them in order without checking.
