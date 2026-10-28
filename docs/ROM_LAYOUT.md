# ROM layout of the viewer (cards #8, #9 and #14)

Where the viewer ROM puts its data, and where `viewer.asm` reads it from.
This is the contract #9 (the browser .pce builder) glues into: bank 0 never
changes, and every data block sits at a fixed place.

All values are little-endian. All offsets are ROM byte offsets. A HuCard ROM
is a multiple of 8 KiB; gaps between banks and the padding of the last bank
are filled with `0xff`. The image is headerless (`pceas -raw`) and has
`4 + max(1, ceil(tiles / 8 KiB))` banks.

The bank count is not capped at 10 any more (card #46). The copy regions may
span banks 4–255: the viewer streams them through one 8 KiB window and maps
the next bank into it, so the image grows to the HuC6280's physical limit —
256 blocks of 8 KiB = 2 MB (HuC6280 hardware manual H8-7 and H8-10/11,
recorded in [`MANUALS.md`](MANUALS.md) §5.1). A request past that is refused
with the code `rom-too-big` (see [`EXPORT.md`](EXPORT.md)). `tools/genviewer.py`
stops at 128 banks (1 MB) because PCEAS 3.23's `.bank` index stops at `0x7F`;
the browser builder goes to 2 MB.

Two builders implement this contract and must agree byte for byte:
`tools/genviewer.py` (writes the `.asm` banks PCEAS assembles) and
`renderer/pce-rom.js` (the browser export, #9). Their agreement on the sample
scenes is measured in [`EXPORT.md`](EXPORT.md); #14 extends it to the sprite
scenes.

## Bank map

| bank | content |
|------|---------|
| 0    | viewer code and vectors (constant — the browser copies it verbatim) |
| 1    | config block (64 B at `$4000`) + the 512 colour-table entries (`$4040`) + the SAT (`$4440`) |
| 2–3  | the BAT: `width × height` words, starting at bank 2 offset 0 |
| 4–255 | the copy regions: the tile regions (and for the sprite scenes the SG pattern block) concatenated in descriptor order |

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
| `0x07` | 1    | CR (the final VDC control register value, bit 7 = background on) |
| `0x08` | 1    | region count (0–13) |
| `0x09` | 1    | reserved (0) |
| `0x0A` | 4×13 | region descriptors, one per tile region (13 is the room before the palette at `0x40`: `(0x40 - 0x0A) / 4`) |

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

## Banks 2–3 — the BAT

`width × height` words, copied to VRAM word address 0. `width`/`height` come
from MWR (`(MWR >> 4) & 3` selects 32/64/128/128, bit 6 selects 32/64 rows),
so the BAT is at most 128×64 = 16 KiB = banks 2 and 3.

## Banks 4–255 — the copy regions

The regions, concatenated in descriptor order, starting at bank 4 offset 0.
The viewer streams this from the MPR2 window (`$4000`–`$5fff`, bank register
`MPR2` set by `TAM2`) and re-maps to the next bank every 8 KiB, so region
boundaries need not line up with banks. The MPR scheme is the HuC6280's: eight
8-bit mapping registers, each selecting one of 256 8 KiB physical blocks
(hardware manual H8-7, H8-10/11). Banks 4–255 are available to the regions —
up to 252 banks = 2,016 KiB of tiles, inside the 2 MB physical ceiling
(banks 0–3 hold the code, config and BAT).

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
- `copy_words` reads through the 8 KiB MPR2 window (`$4000`–`$5fff`) and
  re-maps to the next bank when the pointer crosses the window.
- Finally CR from the config turns the layers on: bit 7 = background,
  bit 6 = sprites.

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
so the physical address space is 2 MB. The viewer uses **MPR2** (`$4000`–
`$5fff`) as its one data window: `TAM2` selects the bank and `copy_words`
bumps the bank number and resets the pointer whenever it crosses `$6000`
(`tools/viewer.asm`). That code was already bank-agnostic — the old 80 KiB
limit lived only in the two builders:

- `renderer/pce-rom.js` (`MAX_TILE_BANKS = 6`, `MAX_REGIONS = 8`) and
- `tools/genviewer.py` (`assert len(tiles) <= 6 * BANK`, `MAX_REGIONS = 8`).

Both now lift those caps: `pce-rom.js` takes banks 4–255 and 13 regions;
`genviewer.py` takes 13 regions and as many banks as PCEAS can assemble
(128). Past the 2 MB ceiling the browser builder refuses with the code
`rom-too-big` rather than emitting a ROM the hardware cannot map.
`tools/genviewer.py` stops earlier, at 128 banks (1 MB), because PCEAS
3.23's `.bank` index itself stops at `0x7F`
(`huc-src/src/mkit/as/main.c`, `bank_limit`), so there is no assembler
reference above 1 MB — only the browser builder goes to 2 MB.

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
