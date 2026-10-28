# ROM layout of the viewer (cards #8, #9 and #14)

Where the viewer ROM puts its data, and where `viewer.asm` reads it from.
This is the contract #9 (the browser .pce builder) glues into: bank 0 never
changes, and every data block sits at a fixed place.

All values are little-endian. All offsets are ROM byte offsets. A HuCard ROM
is a multiple of 8 KiB; gaps between banks and the padding of the last bank
are filled with `0xff`. The image is headerless (`pceas -raw`) and has
`4 + max(1, ceil(tiles / 8 KiB))` banks.

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
| 4–9  | the copy regions: the tile regions (and for the sprite scenes the SG pattern block) concatenated in descriptor order |

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
| `0x08` | 1    | region count (0–8) |
| `0x09` | 1    | reserved (0) |
| `0x0A` | 4×8  | region descriptors, one per tile region |

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

## Banks 4–9 — the copy regions

The regions, concatenated in descriptor order, starting at bank 4 offset 0.
The viewer streams this from the MPR2 window and re-maps to the next bank
every 8 KiB, so region boundaries need not line up with banks.
Up to 48 KiB (banks 4–9).

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

## Pictures the editor makes (#10)

`renderer/pce-editor.js` writes this layout directly: tiles are handed out
from character `$40` (the first character after the 32×32 BAT at words
0–`$3FF`), the map is the 32×32 BAT (MWR = 0), and there is **one** region —
`[[$40, tileCount]]` — so the descriptors hold the whole tile set. Its BAT is
always 1024 words (banks 2 only) and its tiles start at VRAM word `$400`; the
ROM is `4 + max(1, ceil(tiles·32 / 8 KiB))` banks, as the formula above.
There are at most 1536 tiles (banks 4–9).

## What the viewer does not do

- It does **not zero VRAM** before copying: regions outside the copied data
  are whatever VRAM held. That matches HuDK's loaders — the browser's job is
  to lay out the picture (or accept undefined junk) there.
- It does not check the version byte or the reserved bytes. The browser
  export (#9) writes version 1 and zero reserved bytes, but does not verify
  bytes in a ROM it did not build.
- Copy regions must not overlap each other or the BAT or the SAT in VRAM;
  the viewer copies them in order without checking.
