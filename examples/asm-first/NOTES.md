# asm-first — the first program (card #231)

The smallest assembly project that shows the studio's own include file and
HuCard builder: it sets a palette, writes two tiles, and loops.

## What it draws

The VDC's background shows a checkerboard over the whole 256×224 window —
tile 256 and tile 257 alternating in both directions at the 8-pixel tile
size, batched at BAT position (0,0), palette 0.  (The 64×64 BAT occupies
VRAM words `$0000`–`$0FFF`, so the characters live above it at word `$1000`
— the layout tools/hello.asm uses; a first build that put the characters
at 0 and 1, inside the BAT area, rendered garbage and was measured black
and navy instead of the tiles.)

Each character is 16 words: rows 0–7 hold the pixels' low and high bits
(CH0 in the low byte, CH1 in the high byte, bit 7/15 the leftmost pixel)
and rows 8–15 hold CH2/CH3 — unused in 2-bit colour but still read, so
the program zeroes them (a build that left them unwritten gained phantom
bits, measured black and white pixels).

- **Tile 256, a heart** (gold outline, magenta centre, pixel value 2 = the
  centre, 1 = the outline):
  ```
  .XX.XX..
  XWWWWWWX
  XWWWWWWX
  .XWWWWX.
  ..XWWX..
  ...XX...
  ........
  ........
  ```
- **Tile 257, a hollow diamond**, teal (pixel value 3):
  ```
  ...XX...
  ..X..X..
  .X....X.
  X......X
  X......X
  .X....X.
  ..X..X..
  ...XX...
  ```
- **Palette 0**: colour 0 = navy (R0 G1 B7 → 9-bit `$047`, RGB 0,36,252) —
  the backdrop, shown through every pixel value 0 — colour 1 = gold
  (`$1B8`, RGB 252,216,0), colour 2 = magenta (`$03D`, RGB 252,0,180),
  colour 3 = teal (`$145`, RGB 0,180,180).  Colour `$100` (the overscan
  colour) is the navy too.
- **Window**: the VDC's 256×224 register set (HDS=2, HSW=2, HDW=`$1F`,
  HDE=4, VDS=`$0F`, VSW=2, VDW=`$EF`, VCR=`$0C` — the exact row
  docs/MANUALS.md §15.1 GAP 1 lists) at the VCE's divide-by-4 dot clock.
  The capture's first row (VCE line 18) is VDW line `vdwLine0 =
  RCRCount − (scanline − 18)` — the same calibration renderer/pce-bg.js
  uses; in the committed dump that is 1 (RCRCount 237, scanline 254).
  Every captured pixel is background, so the expected picture is the
  checkerboard at that phase: pixel (x, y) is tile pixel (x mod 8,
  (y + vdwLine0) mod 8) of tile 256 + ((x÷8 + ((y + vdwLine0)÷8)) mod 2).

That picture is the STATED expected result, and it is proven:
tests/check-asm-card.js builds the expected pixels from the same numbers
above, and the Mednafen capture in tests/dumps/asm-first/mednafen.png
(made with tools/capture.sh asm-first) must equal them — diff 0.

## How it builds

In the studio: Open `asm-first.pcestudio`, then Export.  The studio
assembles the sources with the vendored PCEAS (`renderer/pce-asm.js`,
which answers `.include "pce.inc"` from its built-in copy of
`renderer/asm/pce.inc` — the project carries no copy of its own) and
writes the .pce with `renderer/pce-card.js`: a 512-byte header whose first
byte is the bank count, then the bank itself, padded with `$FF` to 48
banks (384 KB).  Outside the studio the same pipeline runs as
`node tests/check-asm-card.js --write`, which writes
`tools/gen/asm-first.pce`.

## Where the facts come from

The register values are the hardware's: VCE clock division and colour
words (H6-3), VDC registers and fields (H7-5…H7-12), the MPR pages
(H8-9/24), the vectors (H8-12/13) — all as read in docs/MANUALS.md.  The
names come from the studio's own include file; nothing here is copied
from HuC.
