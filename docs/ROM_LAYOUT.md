# ROM layout of the viewer (cards #8 and #9)

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
scenes is measured in [`EXPORT.md`](EXPORT.md).

## Bank map

| bank | content |
|------|---------|
| 0    | viewer code and vectors (constant — the browser copies it verbatim) |
| 1    | config block (64 B at `$4000`) + the 16 palettes (`$4040`) |
| 2–3  | the BAT: `width × height` words, starting at bank 2 offset 0 |
| 4–9  | the tiles: the tile regions concatenated in descriptor order |

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

256 words = VCE colour table entries 0–255, i.e. the 16 background palettes
of 16 colours. Entry _n_ is the word at `0x40 + 2n`.

## Banks 2–3 — the BAT

`width × height` words, copied to VRAM word address 0. `width`/`height` come
from MWR (`(MWR >> 4) & 3` selects 32/64/128/128, bit 6 selects 32/64 rows),
so the BAT is at most 128×64 = 16 KiB = banks 2 and 3.

## Banks 4–9 — the tiles

The tile regions, concatenated in descriptor order, starting at bank 4
offset 0. The viewer streams this from the MPR2 window and re-maps to the
next bank every 8 KiB, so region boundaries need not line up with banks.
Up to 48 KiB (banks 4–9).

The region list is picture data, read by both builders from
`tests/dumps/sceneN/regions.json` (`tile_regions`: `[char0, tileCount]` pairs
in descriptor order). `char0` is the first 16-bit VRAM character number;
the descriptor's destination is `char0 * 16` words and its word count is
`tileCount * 16`.

Regions whose destination is beyond the 64 KiB VRAM (dest ≥ 32768 words) are
**not included** — writes beyond 32768 words are dropped on the hardware
side, which is also what the renderer model does (`renderer/pce-bg.js`), so
the browser must not emit them either.

## How the viewer reads it

- Reset sets MPR2 to bank 1, copies the 64-byte config block to RAM `$2200`
  and loads the palettes from `$4040`.
- From then on every config read (BXR/BYR/MWR/CR, region count,
  descriptors) comes from the RAM copy: MPR2 is re-mapped to the data banks
  (2 for the BAT, 4 for the tiles), and the region loop must still see the
  descriptors.
- `copy_words` reads through the 8 KiB MPR2 window (`$4000`–`$5fff`) and
  re-maps to the next bank when the pointer crosses the window.

## What the viewer does not do

- It does **not zero VRAM** before copying: regions outside the copied data
  are whatever VRAM held. That matches HuDK's loaders — the browser's job is
  to lay out the picture (or accept undefined junk) there.
- It does not check the version byte or the reserved bytes. The browser
  export (#9) writes version 1 and zero reserved bytes, but does not verify
  bytes in a ROM it did not build.
- Tile regions must not overlap each other or the BAT in VRAM; the viewer
  copies them in order without checking.
