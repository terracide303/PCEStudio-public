# The editor (#10, #13, #17, #16) — tiles, palettes, the map, sprites and the raster effects

`renderer/editor.html` + `renderer/pce-editor.js`: paint 8×8 tiles, choose
palette colours from the VCE's 512, paint the 32×32 background map — and
(#13) paint sprite patterns at the VDC's real sizes, choose from the 16
sprite palettes, place up to 64 sprites into the SAT, and watch the per-line
sprite budget. #17 adds the scanline effect editor: a colour gradient, a
wobble and parallax bands, which compile to **#15's per-line raster table**.
The preview is drawn by the VDC models (`renderer/pce-bg.js` +
`renderer/pce-sprites.js`) rendering that table, nothing drawn separately.
"Download .pce" builds the ROM with #9's builder (`renderer/pce-rom.js`);
since #16 an effect picture's table rides along and the viewer runs it on
the console (the export section below).

```sh
python3 -m http.server 8000            # from the repo root
# then open http://127.0.0.1:8000/renderer/editor.html
# ?demo=1    paints the background demo (#10)
# ?sprites=1 paints the sprite scene (#13)
# ?effects=1 the demo with all three scanline effects (#17)
# ?rules=1   makes the refused calls and reports their codes
node tests/check-editor.js             # both cards' checks against the captures
node tests/check.js                    # renderer vs Mednafen, includes both dumps
```

The close conditions: **#10** — in the browser a 256×224 picture is drawn from
scratch, exported with #9, and runs in Mednafen; the editor refuses anything
the VDC cannot show (a 17th colour in a tile, a 17th palette). **#13** — the
editor paints sprite patterns at 16×16…32×64, chooses from the 16 sprite
palettes, places up to 64 sprites into the SAT with a live per-line budget,
refuses a 65th sprite / a pattern past VRAM / a 17th sprite-palette colour / an
illegal size, and the exported `.pce` carries the SAT into Mednafen with frame
diff 0. **#17** — the three effects are built through the editor's calls and
give the #15 raster table the checks compute by hand; the preview is
`pce-bg.js`/`pce-sprites.js` rendering that table; the refusals carry their
codes. **#16** closes the loop: the export carries the table and the viewer
runs it (the export section below). The evidence is at
the bottom.

## The model is the hardware's, not an editor format

`renderer/pce-editor.js` keeps a picture in the shape the VDC holds it, so
`toPicture()` is a straight encode. Facts and sources are the ones in
[`RENDERER.md`](RENDERER.md) (Hudson HuC6270/HuC6260 manuals; Mednafen only as
a reference for verification — no emulator code here).

| the editor holds | the hardware rule |
|---|---|
| 16 background palettes × 16 entries | the BAT's palette field is bits 12–15 (4 bits) |
| an entry is a 9-bit colour 0–511 | VCE CRAM: G = bits 6–8, R = 3–5, B = 0–2; RGB = 36 × channel |
| a tile is 64 colour numbers 0–15 | a pixel is 4 bits: 16 colour numbers |
| colour 0 of every palette is the shared backdrop | pixel 0 shows CRAM `$000`, whatever palette the cell names |
| the map is 32×32 BAT words, char + palette | BAT at VRAM word 0; char bits 0–11, palette 12–15; MWR = 0 |
| characters start at `$40` | the 32×32 BAT occupies words 0–`$3FF`; a tile is 16 words |
| tiles are 8×8, two bitplanes per row byte | words 0–7 = CH0/CH1, words 8–15 = CH2/CH3; bit 7 is the leftmost pixel |
| at most 1536 tiles | [`ROM_LAYOUT.md`](ROM_LAYOUT.md): tile banks 4–9 = 48 KiB |
| 16 sprite palettes × 16 entries | CRAM entries `$100`–`$1FF`; a sprite pixel is `$100 \| palette<<4 \| colour number` |
| a sprite pattern is 16 or 32 wide, 16/32/64 tall | CGX selects 32 px (two 16-px strips); CGY 00/01/10/11 = 16/32/64/64 rows |
| a pattern is 64-word VRAM cells | plane `k` at `cell·64 + 16k + row`; word bit 15 is the strip's leftmost pixel |
| a sprite is Y, X, pattern, palette, SPBG, CGX/CGY, HFLIP, VFLIP | SAT word 0 = Y (64 = row 0), 1 = X (32 = column 0), 2 = pattern<<1, 3 = attributes (`RENDERER.md`) |
| at most 64 sprites | the SAT has 64 entries |
| at most 16 strips a line, in SAT order | the VDC collects 16 strips of 16 px (256 px); later ones are dropped |
| the SAT lives at VRAM `$7F00` | the viewer's DVSSR/SATB DMA source (#14, `ROM_LAYOUT.md`) |

`toPicture()` returns the 65536-byte VRAM image, the 1024-byte CRAM image,
`{BXR, BYR, MWR, CR}` and the copy regions: `[[$40, tileCount]]`, plus
`[[firstPatternCell·4, cellCount·4]]` when the picture has sprite patterns.
CR is `$80` (background on) for a picture without sprites and `$C0` (background
+ sprites) for one with. The editor has no renderer of its own:
`renderPreview()` is `pce-sprites.js`'s frame of `toPicture()`'s data
(`pce-bg.js` with an empty SAT is the same picture), with `toRaster()`'s table
when the picture has scanline effects. So a change that would not survive the
export cannot look right on screen — except the #17 effects, which are
explicitly preview-only until the viewer runs the table (#16).

### Sprite patterns and their VRAM cells

A pattern's position is a **pattern code** the SAT names; the VDC reads it as
a 64-word cell. The sizes are the six CGX/CGY combinations, and each reserves
a span with the alignment its mask requires:

| size | CGX | CGY | cells reserved | cells read |
|---|---|---|---|---|
| 16×16 | 0 | 00 | 1 | base |
| 32×16 | 1 | 00 | 2 | base, base+1 |
| 16×32 | 0 | 01 | 4 | base, base+2 |
| 32×32 | 1 | 01 | 4 | base…base+3 |
| 16×64 | 0 | 10 | 8 | base, +2, +4, +6 |
| 32×64 | 1 | 10 | 8 | base…base+7 |

The odd cells of a 16×32/16×64 span are reserved but never read — the same
packing `tools/genroms.py`'s `pack_patterns` uses. The editor packs patterns
in creation order **after the tiles** (first cell
`ceil(nextChar / 4)`, each at its alignment), so patterns can never overlap
the picture's characters. A tile added later pushes the patterns up; `newTile`
refuses with `tile-space` if that would push them into the SAT. The editor is
free to place patterns anywhere below the SAT, which is why the demo's region
starts at cell 19 (`char $4C`) rather than the sample scenes' fixed `$80`.

## What it refuses, and why the VDC cannot show it

Every refusal throws an `Error` with a machine-readable `code`; the page shows
the message.

| code | refused | why |
|---|---|---|
| `17th-colour` | a tile pixel colour number ≥ 16; palette entry 16; **sprite palette entry 16**; a sprite pixel colour number ≥ 16 | a pixel is 4 bits and a palette has 16 colours — there is no 17th |
| `17th-palette` | background palette 16 (`setPaletteColour`, `newTile`, `setTilePalette`) | the BAT's palette field is 4 bits: 16 background palettes |
| `17th-sprite-palette` | sprite palette 16 (`setSpritePaletteColour`, `addSprite`) | CRAM holds 16 sprite palettes of 16 (`$100`–`$1FF`) |
| `not-in-palette` | painting a VCE colour the tile's palette does not hold | a tile shows the backdrop plus its own palette's 15 entries; anything else would need a 17th colour in the tile |
| `65th-sprite` | adding a 65th SAT entry | the SAT has 64 |
| `sprite-pattern-vram` | a pattern whose cells would reach the SAT at VRAM `$7F00` (cells `$1FC`–`$1FF`), or a picture whose packed patterns do | those words are the SAT, not pattern data; the VDC cannot show such a pattern |
| `sprite-size` | a width/height that is not 16×16, 32×16, 16×32, 32×32, 16×64 or 32×64 | those are the only CGX/CGY sizes |
| `vram-range` | a character `$800` or above | past the 32768-word VRAM: the write is dropped and the display reads colour 0 |
| `tile-space` | more than 1536 tiles, or a tile that would push the sprite patterns into the SAT | the ROM layout gives 6 tile banks; tiles and patterns share them |
| `no-tile` | a character with no tile behind it | the map may only name tiles that exist |
| `backdrop-entry` | setting entry 0 of one background palette | colour 0 is one shared backdrop; use `setBackdrop` |
| `sprite-range`, `sprite-pattern-range`, `sprite-pixel-range`, `sprite-palette-range`, `sprite-entry-range`, `sprite-flag-range`, `map-range`, `pixel-range`, `colour-range`, `palette-range`, `entry-range`, `colour-index` | out-of-range coordinates/codes/flags | the value has no valid meaning |

The page's panels cannot produce most of these (16 rows of 16 swatches, six
sizes in a list, 64 slots checked by the model). Its **Check the rules**
button makes them on purpose and reports every code (see the headless output
below).

## The per-line budget

`spriteBudget(pic)` returns, for all 224 display lines, how many 16-px strips
the VDC would collect (`spriteLineBudget`). It counts **strips**, not sprites:
a 32-px sprite is two strips, and its right half can be the first strip
dropped. Strips are taken in SAT order until 16 (256 px). Going past 16 is
allowed — the editor does not refuse it — and the dropped strips are reported
per sprite in the page's list and as the worst line / number of lines that
drop. `tests/check-editor.js` checks the budget line by line against
`pce-sprites.js`'s `collectStrips`, so the number the page shows is the number
the renderer draws.

Since #50 each line also carries the VDC status conditions the same SAT search
produces: **OR** (`overflow`) when the line asks for a 17th strip, and **CC**
(`collision`) when sprite #0 and another kept sprite have an opaque pixel at
the same display column. `spriteBudget` adds `orLines`/`ccLines`, and its
`status` block carries the VD/RR events — VD at the first line after the
240-line display and RR on an effect table's entry lines — plus the SR the
exported picture would latch (only RR can, because its CR has RC; the
editor's picture sets no OC/CC/VC enable). The page's budget line prints
them, and `tests/check-status.js` holds every line to `pce-sprites.js`'s
`status()` on the exported picture.

## The demo pictures, painted from scratch

Both are painted **through the editor's own calls**, and nothing is read from
`tests/dumps/`.

- **Background demo (`demoPicture`, #10)** — "Sunset over the bay": a dithered
  sky gradient, a sun with four radial colours, two islands, the sea with the
  sun's glitter; six of the 16 palettes, one per band, tiles `$40`–`$C4`.
  Measured: 896 visible cells painted, 133 distinct tiles after dedupe, 6
  palettes, 15 colour numbers, `validate()` 0 problems.
- **Sprite demo (`spriteDemoPicture`, #13)** — "Sprites over the bay": the
  left half of the background is colour 0 (transparent to `SPBG=0` sprites),
  the right half is an opaque ramp (colour numbers 1–8). Six patterns, one per
  VDC size, painted pixel by pixel; all 16 sprite palettes defined; 36 sprites
  in the SAT — every size, X/Y/both flips (including a 32-px X-flip whose
  halves swap), `SPBG=0` over the transparent half (shows) and over the opaque
  half (hidden), an overlap where the lower SAT index wins, and a crowded line
  at y=200 where 15 single-strip sprites plus a 32-px sprite plus four more
  ask for **21 strips**: the VDC keeps 16, drops the 32-px sprite's right half
  and the four later sprites. Measured: 9 tiles, 2 background palettes, 6
  sprite patterns (27 reserved cells, codes 19/20/24/28/32/40), 36/64 sprites,
  16/16 sprite palettes, worst line 200 = 16/16 strips (256/256 px) with 5
  dropped, 16 lines dropping strips, `validate()` 0 problems.

## The effect editor (#17) — the #15 raster table

The three scanline effects in `renderer/editor.html` are authored through
`renderer/pce-editor.js` and compile to the **#15 raster table** — the same
object `pce-bg.js`/`pce-sprites.js` take as `opts.raster` (the format and the
per-line rules are in [`RENDERER.md`](RENDERER.md)). Nothing is drawn
separately: the page's preview is `editor.renderPreview(pic, frame)`, which is
`pce-sprites.js` composing `pce-bg.js`'s frame over `toPicture()`'s data with
`toRaster()`'s table.

The picture keeps the effect parameters in `pic.raster`; `toRaster(pic, frame)`
compiles them to one entry per VDW line that any effect covers:

| call | effect | the table it writes |
|---|---|---|
| `setGradient({palette, entry, from, to, line0, line1})` | colour gradient | for each line L in the range: `cram = [[palette·16 + entry, mix(from, to, (L−line0)/(line1−line0))]]` — one palette entry changed per line between two VCE colours |
| `setWobble({amplitude, period, speed, line0, line1})` | wobble | for each line L in the range: `bxr = (BXR + round(amplitude·sin(2π·(L−line0+speed·frame)/period))) & $3FF` |
| `setParallaxBands([{line0, line1, speed}, …])` | parallax bands | every line of a band: `bxr = (BXR + speed·frame) & $3FF` — each band its own speed, in pixels per frame |

`setScroll({BXR, BYR})` is the register value the effects are relative to.
`toRaster` returns `{base: {bxr, byr, cr}, baseCram: [512 9-bit words],
entries: [{line, rcr, bxr?, cram?}]}`; `rcr = $40 + line` is the RCR value
#15's chain arms for that line. `baseCram` is the picture's own CRAM (the
palettes `toPicture()` writes), and `base` is the scroll plus CR (`$80`
background on, `$C0` with sprites). A wobble and the band it sits in are added
into one BXR value — a wobbling band.

Hand-computable small cases the check asserts entry by entry:

- a gradient `$000 → $1FF` over lines 0..7 is **73 per line** — each channel
  goes 0..7 over 7 steps, so line L is `(L<<6)|(L<<3)|L = 73L`:
  `$000, $049, $092, $0DB, $124, $16D, $1B6, $1FF`;
- a wobble of amplitude 2 px, period 4 lines, speed 0 at BXR 10 is
  `10, 12, 10, 8, 10, 12, 10, 8`; with speed 1 the sine slides one line a
  frame, so frame 1 is `12, 10, 8, 10, 12, 10, 8, 10`;
- parallax bands of 2 px/frame on lines 0..111 and −1 px/frame on 112..223 are
  BXR 10 and 1019 at frame 5 (the register is 10 bits: −5 = `$3FB`), and 0
  for every line at frame 0.

The computed BXR is masked to 10 bits exactly as the register is; the
reference raster2 wobble is masked the same way (`tools/genroms.py`'s
`raster_wobble`). The table's semantics are `pce-bg.js`'s #15 rules: an entry
at line L fires in the HBlank before VDW line L; a line with no entry keeps
the last written value; the VCE colour table persists across frames. So a
gradient over lines 0..95 leaves entry 1 at its last written colour below line
95, and a band's BXR holds past its last line until another entry writes BXR.

Refusals (each an `Error` with a machine-readable `code`):

| code | refused | why |
|---|---|---|
| `register-range` | BXR outside 0..1023, BYR outside 0..511, a wobble amplitude past a 10-bit swing | BXR is a 10-bit register, BYR 9 |
| `line-range` | an effect line outside VDW 0..223, or a backwards range | the display is 224 lines; no such line shows |
| `raster-line-full` | two parallax bands over the same line | one VDW line carries one raster entry (one BXR value); #15's RCR chain fires one interrupt per line |
| `colour-range` | a gradient colour outside 0..511 | a VCE colour is 9 bits |
| `wobble-range`, `parallax-range`, `frame-range` | a non-integer period/speed/frame, a period below 1, a negative frame | no such effect parameter/time |
| `17th-palette`, `backdrop-entry`, `entry-range`, `17th-colour` | a gradient on palette 16, on colour 0 (the shared backdrop) or on a bad entry | the palette rules above |

**The export now carries the table (#16).** `renderer/pce-rom.js` takes an
optional `raster` (the renderer-shaped object above plus a `frameCounter`
flag, which the editor never sets — `toRaster` bakes the frame in) and
exports it as the viewer's fixed-layout table image at bank 1 offset
`$640` ([`ROM_LAYOUT.md`](ROM_LAYOUT.md)): config byte 9 = 1 flags it, the
RC bit (0x04) is ORed into the config CR, the boot palettes are the table's
`baseCram`, and the viewer's irq1 chain executes the entries line by line —
so "Download .pce" of an effect picture shows the effect on the console,
not the static picture.  `tests/check-editor.js --write effect` builds the
demo (`tools/gen/effect1.pce` + its `raster.json`: the stripes picture with
the full-screen gradient, the wobble and both bands at frame 5), holds the
ROM's table image to the editor's table entry for entry, and — on the
`tools/capture.sh effect` capture in `tests/dumps/effect1/` — holds the
saved VRAM/CRAM/registers to the editor's model and Mednafen's frame to the
renderer on the dump's own patched table (diff 0).  The picture without
effects still exports exactly as before (same bytes as the #17 ROM:
`40960` bytes, sha256 `486477d6…`).

## The model's panels (#26)

`renderer/pce-panels.js` reads the objects the renderer is given — `vram`,
`cram`, `sat`, `regs` and the #15 raster table — and the page draws five
panels from it.  It is not a second copy of the picture: the per-line values
come from `pce-bg.js`'s `buildRows`, the background pixel from the same
`backgroundPixel` decode `renderIndices` uses, and the sprite layer from
`pce-sprites.js`'s `collectStrips`/`paintLine`.  A panel cannot say something
the preview does not draw.

| panel | what it shows | where the rules are from |
|---|---|---|
| **VDC registers** | all 20 addresses R00–R13 (MAWR, MARR, VWR/VRR, R03, R04, CR, RCR, BXR, BYR, MWR, HSR, HDR, VPR, VDR, VCR, DCR, SOUR, DESR, LENR, DVSSR) for the followed line, each with its source (`line`, `state`, `viewer`, or `—`), then a per-scanline table of BXR/BYR/CR/BG_YOffset/RCR with a `*` where the raster table writes | register table, HuC6270 VDC manual p. H7-4; BXR/BYR R07/R08 p. H7-7, CR R05 p. H7-5; RCR R06 p. H7-6 and the #15 BYR+1/chain rules |
| **VCE** | 512 colours as 32 palettes of 16, the followed line's colour table; palettes 0–15 are the BAT's palette field, 16–31 the sprite palettes at CRAM `$100–$1FF`; each swatch carries its CRAM address and 9-bit word | VCE 2.2.1 p. H6-4, 2.2.2 p. H6-5 (colour word G 8-6/R 5-3/B 2-0) |
| **VRAM map** | whole 32768 words and words 0–4095 expanded; BAT (MWR geometry), the copy regions (`toPicture()`'s descriptors or `regions.json`), the sprite-pattern cells the SAT names, the SAT at `$7F00`, and the free words; every word is in exactly one segment | MWR SCREEN table p. H7-8/H7-9; DVSSR R13 p. H7-12; the pattern-cell rules in `pce-sprites.js` |
| **SAT** | 64 rows: Y, X, pattern (word 2 >> 1), palette, CGX/CGY size, HFLIP/VFLIP/SPBG, the 64-word cells read, and whether the entry is empty | SAT/SATB 2.4 p. H7-19..H7-24 |
| **follow a pixel** | click the preview: the winning layer (sprite / background / blanking), the 9-bit colour index, CRAM word and RGB; the BAT word, character, palette, tile row/column and colour number; or the sprite number, pattern, palette, colour number, cell and strip — plus the register values on that line | the same model; the layer rule is the VDC's BG colour-0 / SPBG priority (#12) |

Two sources matter for honesty.  A Mednafen save state carries most register
values; the editor's picture model carries only BXR/BYR/MWR/CR, so the viewer
ROM's fixed 256×224 values (HSR `$0202`, HDR `$041F`, VPR `$0F02`, VDR
`$00EF`, VCR `$000C`, DCR `$0010`, DVSSR `$7F00` — `tools/viewer.asm`'s HuDK
`vdc_init_table` sequence) stand in and are labelled **viewer**.  MAWR/MARR/
VWR/VRR/SOUR/DESR/LENR are not part of a picture and show `—`.  The page's
`?panels=1` reads the panel at a fixed pixel (168, 92) for a headless dump of
the DOM; the click handler is the human path.

## The export

`renderer/pce-rom.js` builds each ROM from `toPicture()`; bank 0 is the
constant viewer (`renderer/viewer-bank0.bin`), so this is the #9 path
unchanged. The viewer's SATB DMA (#14) copies the SAT from VRAM `$7F00`, and
the config's CR bit 6 turns the sprite layer on.

| | background demo (#10) | sprite demo (#13) |
|---|---|---|
| ROM | 40960 bytes | 40960 bytes |
| sha256 | `486477d617db851a…` | `9dc564c5df0de228…` |
| bank 1 | config (`CR=$80`, one region `$40`) + 512 colour-table entries at `$4040` (sprite palettes black) + a zero SAT at `$440` | config (`CR=$C0`, two regions: `$40` and `$4C`) + the 512 entries (all 16 sprite palettes) + the 36-entry SAT at `$440` |
| banks 2–3 | the 32×32 BAT (1024 words) | the 32×32 BAT |
| banks 4+ | the 133 tiles | the 9 tiles then the 27 pattern cells (116 chars) |

The **Download .pce** button offers whichever picture is loaded; the
TurboGrafx checkbox (#25) offers the bit-reversed image. `?demo=1` and
`?sprites=1` on the page report the same bytes the Node run builds.

### The dot clock (#70)

The Dot clock control (`setVideoMode(pic, 256|336|512)`) chooses the VCE's
`/4`, `/3` or `/2` clock. It writes the picture's VCE CR and the HSR/HDR of
the matching display window (`$0202`/`$041F`, `$0402`/`$0429`,
`$0B02`/`$043F` — MacDonald's display table, `pcetech` §9), so the export
carries config version 2 and the wide-window block (`docs/ROM_LAYOUT.md`).
The preview is drawn at the captured frame's real width — 256, 341 (the
336-dot window with 2 border dots left and 3 right) or 512 — by the same
`pce-bg.js`/`pce-sprites.js` the renderer tests prove. The BAT is still
32×32, so the wide frames show the picture and its wrapped repetition; a
wider BAT is not part of #70. `tests/check-editor.js` renders both wide
modes against an independent model, exports them, and (when the captures are
present) holds `tests/dumps/wedit336` and `wedit512` to the editor's own
VRAM/CRAM/registers and a Mednafen frame diff 0 at 341×232 and 512×232.

## Evidence (measured 2026-10-28)

`node tests/check-editor.js` (exit 0; written by @design, flagged for @review
to read cold):

```
refusals: 21/21 refused with the documented code (tiles: 17th colour, 17th
          palette, not in the tile's palette, past VRAM; sprites: 65th sprite,
          pattern past VRAM, 17th colour in a sprite palette, illegal size)
picture: 256x224 painted from scratch, 896 visible cells, 133 tiles ($40-$c4),
         6 palettes, validate 0 problems, model == renderer
sprite scene: 36 sprites, 6 patterns (all six sizes), 16/16 sprite palettes,
         27 pattern cells; budget worst line 200: 16/16 strips (256/256 px),
         5 dropped on it, 16 line(s) drop strips; model == pce-sprites.js
export: 40960 bytes, sha256 486477d617db851a… (#9's builder) — config,
        palettes, BAT and tiles are the editor's data
sprite export: 40960 bytes, sha256 9dc564c5df0de228… — config, sprite
        palettes, SAT, BAT and both copy regions are the editor's data
effects: three #15 tables computed by hand — gradient $000->$1FF over 8
        lines = 73 a line, wobble 2 px / 4 lines = 10,12,10,8… (speed 1,
        frame 1 = 12,10,8,10…), bands 2 / -1 px a frame at frame 5 =
        10 / 1019; each preview == pce-bg.js on that table (and != the
        no-table frame); 14/14 effect refusals with their codes
browser-global branch: same 21/21 refusals, 14/14 effect refusals, same
        effect tables and previews, same 40960 and 40960 bytes
capture: tests/dumps/painted is the editor's VRAM/CRAM/regs and Mednafen's
         frame equals the editor's picture (diff 0)
sprite capture: tests/dumps/spainted is the editor's VRAM/CRAM/regs/SAT and
         Mednafen's frame equals the editor's sprite picture (diff 0)
PASS: the editor paints tiles and sprites, refuses what the VDC cannot show,
      exports #9's ROM and Mednafen shows both pictures
```

`node tests/check.js` reported **47 pictures diff 0** when #13 closed — the
two editor dumps plus the 45 scene dumps then present (`spainted` is rendered
through `pce-sprites.js`, like every dump with a `sat.bin`; later captures add
to the count). Both ROMs were built with
`renderer/viewer-bank0.bin` sha256 `fbb4eaa3db830654…`; if bank 0 changes, both
Mednafen captures must be re-made (`tools/capture.sh painted` and
`spainted`).

How that proof is built:

- **model == renderer (background)** — every pixel of the 256×224 frame is
  recomputed from the editor's own data (map → tile → colour number → palette
  entry → 9-bit colour → RGB) and compared with `pce-bg.js` drawing
  `toPicture()`'s VRAM and CRAM. Two paths, one picture.
- **model == renderer (sprites)** — the frame is recomputed from the editor's
  sprite list and patterns with the hardware rules spelled out again (16-strip
  budget in SAT order, per-strip drop for a 32-px sprite, HFLIP mirroring and
  half swap, VFLIP rows, pixel-0 transparency, `SPBG` against the background's
  colour number, lowest SAT index wins) and compared with `pce-sprites.js`
  drawing `toPicture()`'s VRAM/CRAM/SAT. Two paths, one picture. Readable
  witnesses pin it: at (220,205) the dropped right half shows the background,
  at (210,205) the kept 16th strip does not; an `SPBG=0` sprite is hidden at
  (170,155) over the opaque half, an `SPBG=1` sprite shows at (190,155), and
  an `SPBG=0` sprite shows at (10,155) over the transparent half.
- **the budget** — for every line, `spriteLineBudget().strips` must equal
  `pce-sprites.js`'s `collectStrips().length`; the crowded line's kept/dropped
  split must be 16/5, with its 32-px sprite at 1 kept / 1 dropped.
- **the SAT** — the 256 words at VRAM `$7F00` must be `satWords()` little-
  endian, and the Mednafen capture's `sat.bin` (the SATB mirror) must equal
  them byte for byte.
- **the refusal list** — each call is made and must throw with the documented
  code; a legal paint and a legal sprite add afterwards must still succeed (so
  the test cannot pass by refusing everything). The "past VRAM" case packs
  patterns until the refusal and checks the refused pattern was not stored.
- **the effect tables (#17)** — each effect is built through the editor's
  calls on a small picture and its table is compared with arithmetic done in
  the check, not with the editor's helpers: the gradient's 73-per-line ramp,
  the wobble's sine at frame 0 and frame 1, the bands' 10/1019 at frame 5,
  plus `rcr = $40 + line`, `base` and `baseCram`. A picture with no effects
  must return `null`.
- **the effect preview (#17)** — for each effect the check draws the table
  with `pce-bg.js` directly and requires `editor.renderPreview()` to be
  byte-equal (and, for the sprite scene, `pce-sprites.js` composing the same
  table), while the same picture without the table must differ — so the
  preview is the renderer on the table, not a drawing of its own. Readable
  witnesses: the gradient's first and last rows are its two colours, the
  wobble moves a bar at a line with BXR 8, and the two bands show different
  colours at the same column.
- **the effect refusals (#17)** — a line outside 0..223, a backwards range,
  two bands on one line, BXR 1024, BYR 512, a gradient colour 512, a 17th
  palette, the backdrop entry, a wobble amplitude past 10 bits and a zero
  period each throw their documented code, and a legal setup afterwards still
  builds a table.
- **the panels (#26)** — `node tests/check-panels.js` (written by @design,
  flagged for @review cold) runs `renderer/pce-panels.js` on eight existing
  dumps and compares every panel with an independent computation written in
  the check from the raw bytes (no panel or renderer function is called to
  produce the expected value): a 13×12 pixel grid plus pixels on every
  non-empty SAT sprite per dump (1320 traces, 92 landing on a sprite and 41
  on the blanking fill), each checking the layer, the 9-bit index and CRAM
  word, the BAT word/character/palette/tile row/column/colour number or the
  sprite number/pattern/palette/colour/cell/strip, and the line's
  BXR/BYR/CR/BG_YOffset — with the panel's RGB also required to equal
  `mednafen.png` at that pixel.  The VRAM map must equal `regions.json`'s
  descriptor list where that file exists and partition all 32768 words
  exactly once; the per-line register panel is checked against `raster.json`
  entry by entry (values between writes, the entry's own line, rcr and RCR
  chain arm); the VCE panel against each line's colour table; the SAT panel
  against `sat.bin`.  Dumps: `scene1` (background), `sprite1` (sprites),
  `raster1` (BYR), `raster4` (per-line colour), `raster5` (per-line CR and
  blanking), `painted` (#10's picture), `scene4` (64-wide BAT) and `scene9`
  (characters ≥ `$800`).  The editor's own demo and sprite pictures go
  through the same file, and the browser-global branch gives the same
  traces.  The check fails on each of five self-mutations tried (priority
  rule, plane bit order, per-line BXR, region length, colour high bit);
  those are the builder's own mutants, so a breaker still owes it a cold
  pass.
- **the export** — the ROM's bank-1 config (including every region
  descriptor), the 512 colour-table entries, the SAT, banks 2–3 (the BAT) and
  bank 4+ (the regions concatenated in descriptor order — tiles then patterns)
  are compared byte for byte with the editor's own data, and the image size
  with the bank formula of `ROM_LAYOUT.md`.
- **the console** — `tools/capture.sh painted` and `tools/capture.sh
  spainted` build the ROMs with `check-editor.js --write [sprite]` and run
  them in Mednafen on the same command-line route as #5/#8/#9/#10
  (`-qtrecord`, `-autosave`, SIGINT; **no synthesized input**). The check
  requires the captured VRAM to equal the editor's VRAM, the captured CRAM to
  equal its 512 entries, `MWR/BXR/BYR/CR` to equal what it wrote, the captured
  SATB to equal the editor's SAT (sprite scene), and Mednafen's recorded frame
  to equal the renderer drawing **the editor's picture** with the capture's own
  calibration — diff 0.
- **the browser** — the real page, headless (command line only, no UI events).
  `?sprites=1&rules=1` still reports #13's bytes; `?effects=1` paints the demo
  and builds all three effects through the same setters the buttons call:

```sh
python3 -m http.server 8123 --bind 127.0.0.1        # from the repo root
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --user-data-dir=/tmp/chrome-pce17 --virtual-time-budget=15000 --dump-dom \
  "http://127.0.0.1:8123/renderer/editor.html?effects=1&rules=1"
# exportstatus: picture 256x224, 133 tiles, 6 palettes, 0 sprite patterns,
#               0 sprites (worst line 0: 0/16 strips, 0 dropped),
#               0 problem(s), 224 raster entries at frame 0 ·
#               ROM 40960 bytes, sha256 486477d617db851a…
# rasterinfo: 224 entries · lines 0–223 · 224 BXR · 96 colour write(s) ·
#             frame 0
# msg: rules: 12/12 refused — palette 16 (17th-palette); palette entry 16
#      (17th-colour); pixel colour 16 (17th-colour); sprite size 16x48
#      (sprite-size); sprite palette entry 16 (17th-colour); sprite pixel 16
#      (17th-colour); 65th sprite (65th-sprite); sprite pattern past VRAM
#      (sprite-pattern-vram); effect line 224 (line-range); two bands on one
#      line (raster-line-full); BXR 1024 (register-range); gradient colour
#      512 (colour-range)
```

The ROM is still 40960 bytes with the same sha256: the page reports the
raster table beside it, and does not pretend the table is in the image.

`?demo=1` still reports the #10 bytes unchanged (`sha256 486477d6…`), so #13
and #17 did not move the background picture's ROM.

`?panels=1` reads the #26 panels at a fixed pixel and reports it (measured
2026-10-28, `?sprites=1&panels=1`):

```
followinfo: pixel (168,92) · VDW line 92 · winner: background
            colour index $14 · CRAM word $0115 · rgb(72,144,180)
            background: BAT word 373 = $1044 · char $0044 · palette 1 ·
            tile row 4 col 0 · colour 4
            line registers: BXR 0 · BYR 0 · CR $C0 · BG_YOffset 92 · MWR $0
```

`tests/dumps/painted/` and `tests/dumps/spainted/` hold the captures
(`mednafen.png`, `vram.bin`, `cram.bin`, `sat.bin`, `regs.json`,
`mednafen.log`), recorded 2026-10-28.

## What this does NOT prove

- **Not the page's mouse handlers.** The page calls the same functions the
  check calls, but its `mousedown`/`mousemove` wiring is read, not executed —
  no synthetic input is ever sent on this machine. The effect buttons are the
  same: `?effects=1` exercises the setters a button calls, not the click.
  The one exception (#52) is the three Remove buttons: `check-editor.js`
  executes `editor.html`'s own script in a stub DOM and dispatches
  `#cleargrad` / `#clearwob` / `#clearbands`, because a handler wired to the
  wrong `clear*` function passed every earlier check. That proves the wiring
  and the state it leaves, not a real browser's click, layout or CSS, and
  every other handler on the page is still unproven. The #26 follow-a-pixel
  click is the same: `?panels=1` calls the panel at a fixed pixel, it does
  not click the canvas.
- **Not the download wiring.** `URL.createObjectURL` and the anchor click are
  read, not run by an automated check.
- **Not the raster table in an exported ROM.** That is **#16**: the viewer
  does not yet run the table, so `toPicture()`/`pce-rom.js` write the static
  picture and the page's effects are preview-only. Nothing here fakes the
  export; the page's `exportstatus` reports the table beside the unchanged
  ROM.
- **Not effect playback.** The page's `frame` is a scrub position for the
  wobble's phase and the bands' scroll; there is no 60 Hz loop, so a moving
  effect has not been watched. The tables at several frames are checked by
  arithmetic, not by eye.
- **Not every picture.** One picture each; one BAT size (32×32), one scroll
  (`BXR=BYR=0`). `setScroll` can set BXR/BYR but the editor cannot change the
  BAT size yet. **The 336/512-px modes are #70**: the Dot clock control
  (`setVideoMode`) sets the picture's VCE CR and the HSR/HDR of a 336- or
  512-dot window, the preview draws the 341- or 512-px frame at its real
  width and the export carries the registers. The BAT stays 32 tiles wide, so
  a wide frame shows the picture plus its wrapped repetition — the editor
  cannot paint a wider BAT yet.
- **Not sprite animation or flicker multiplexing.** The sprites are static;
  more than 16 strips a line is shown dropped, not multiplexed (#28).
- **Not the exporter's 6-bank limit for extreme pictures.** Patterns and tiles
  share banks 4–9 (48 KiB). `newSpritePattern` refuses a pattern past VRAM, but
  a picture with both the maximum tiles and many patterns can pass the editor's
  VRAM rule and still exceed the ROM layout; `pce-rom.js` then throws its
  "tiles need N banks" error rather than emitting a truncated ROM. The demo
  picture is far below it (4000 region bytes).
- **Not a user's drawing.** Both demos are procedural, painted through the
  API; they show the chain works, not that the UI is pleasant to draw with.
- **Mednafen's crop.** Its default display rectangle starts one VDW line in
  (`RCRCount − (scanline − 18) = 1` in both captures), so the captures show
  picture rows 1–232; the editor previews from VDW line 0. The check compares
  the preview with each capture one row apart, and the 232-row render with the
  capture directly (diff 0). That is Mednafen's crop, not a hardware fact this
  repo measured.
- **Not the console.** Mednafen is not a HuCard on real hardware; the #8 Tang
  Nano photo is still the hardware check.
