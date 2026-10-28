# The editor (#10, #13) — tiles, palettes, the map, sprites and the SAT

`renderer/editor.html` + `renderer/pce-editor.js`: paint 8×8 tiles, choose
palette colours from the VCE's 512, paint the 32×32 background map — and
(#13) paint sprite patterns at the VDC's real sizes, choose from the 16
sprite palettes, place up to 64 sprites into the SAT, and watch the per-line
sprite budget. The preview is drawn by the VDC models
(`renderer/pce-bg.js` + `renderer/pce-sprites.js`), and "Download .pce" builds
the ROM with #9's builder (`renderer/pce-rom.js`).

```sh
python3 -m http.server 8000            # from the repo root
# then open http://127.0.0.1:8000/renderer/editor.html
# ?demo=1    paints the background demo (#10)
# ?sprites=1 paints the sprite scene (#13)
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
diff 0. The evidence is at the bottom.

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
+ sprites) for one with. The editor has no renderer of its own: the preview is
`pce-sprites.js`'s frame of `toPicture()`'s data (`pce-bg.js` with an empty SAT
is the same picture), so a change that would not survive the export cannot
look right on screen.

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
browser-global branch: same 21/21 refusals, same 40960 and 40960 bytes
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
- **the browser** — the real page, headless (command line only, no UI events):

```sh
python3 -m http.server 8123 --bind 127.0.0.1        # from the repo root
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --user-data-dir=/tmp/chrome-pce13 --virtual-time-budget=15000 --dump-dom \
  "http://127.0.0.1:8123/renderer/editor.html?sprites=1&rules=1"
# exportstatus: picture 256x224, 9 tiles, 2 palettes, 6 sprite patterns,
#               36 sprites (worst line 200: 16/16 strips, 5 dropped),
#               0 problem(s) · ROM 40960 bytes, sha256 9dc564c5df0de228…
# budget: sprites 36/64 · worst line 200: 16/16 strips (256/256 px),
#         5 strip(s) dropped there · 16 line(s) drop strips
# msg: rules: 8/8 refused — palette 16 (17th-palette); palette entry 16
#      (17th-colour); pixel colour 16 (17th-colour); sprite size 16x48
#      (sprite-size); sprite palette entry 16 (17th-colour); sprite pixel 16
#      (17th-colour); 65th sprite (65th-sprite); sprite pattern past VRAM
#      (sprite-pattern-vram)
```

`?demo=1` still reports the #10 bytes unchanged (`sha256 486477d6…`), so #13
did not move the background picture's ROM.

`tests/dumps/painted/` and `tests/dumps/spainted/` hold the captures
(`mednafen.png`, `vram.bin`, `cram.bin`, `sat.bin`, `regs.json`,
`mednafen.log`), recorded 2026-10-28.

## What this does NOT prove

- **Not the page's mouse handlers.** The page calls the same functions the
  check calls, but its `mousedown`/`mousemove` wiring is read, not executed —
  no synthetic input is ever sent on this machine.
- **Not the download wiring.** `URL.createObjectURL` and the anchor click are
  read, not run by an automated check.
- **Not every picture.** One picture each; one BAT size (32×32), one scroll
  (`BXR=BYR=0`), 32×32 mode only. The editor cannot edit the scroll, the BAT
  size, or the 336/512-px modes yet.
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
