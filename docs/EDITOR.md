# The editor (#10) — tiles, palettes, the background map

`renderer/editor.html` + `renderer/pce-editor.js`: paint 8×8 tiles, choose
palette colours from the VCE's 512, paint the 32×32 background map, see the
result drawn by the VDC model, and export it as a `.pce` through #9's builder.

```sh
python3 -m http.server 8000            # from the repo root
# then open http://127.0.0.1:8000/renderer/editor.html
# ?demo=1 paints the demo picture on load; a fresh page starts blank
node tests/check-editor.js             # the card's checks against the capture
node tests/check.js                    # renderer vs Mednafen, includes dumps/painted
```

The close condition (#10): *in the browser a 256×224 picture is drawn from
scratch, exported with #9, and runs in Mednafen; the editor refuses anything
the VDC cannot show (a 17th colour in a tile, a 17th palette).* The evidence
is at the bottom.

## The model is the hardware's, not an editor format

`renderer/pce-editor.js` keeps a picture in the shape the VDC holds it, so
`toPicture()` is a straight encode. Facts and sources are the ones in
[`RENDERER.md`](RENDERER.md) (Hudson HuC6270/HuC6260 manuals; Mednafen only as
a reference for verification — no emulator code here).

| the editor holds | the hardware rule |
|---|---|
| 16 palettes × 16 entries | the BAT's palette field is bits 12–15 (4 bits) |
| an entry is a 9-bit colour 0–511 | VCE CRAM: G = bits 6–8, R = 3–5, B = 0–2; RGB = 36 × channel |
| a tile is 64 colour numbers 0–15 | a pixel is 4 bits: 16 colour numbers |
| colour 0 of every palette is the shared backdrop | pixel 0 shows CRAM `$000`, whatever palette the cell names |
| the map is 32×32 BAT words, char + palette | BAT at VRAM word 0; char bits 0–11, palette 12–15; MWR = 0 |
| characters start at `$40` | the 32×32 BAT occupies words 0–`$3FF`; a tile is 16 words |
| tiles are 8×8, two bitplanes per row byte | words 0–7 = CH0/CH1, words 8–15 = CH2/CH3; bit 7 is the leftmost pixel |
| at most 1536 tiles | [`ROM_LAYOUT.md`](ROM_LAYOUT.md): tile banks 4–9 = 48 KiB |

`toPicture()` returns the 65536-byte VRAM image, the 1024-byte CRAM image,
`{BXR, BYR, MWR, CR}` and one region `[[$40, tileCount]]` — exactly the object
`renderer/pce-rom.js` (#9) turns into a ROM and `renderer/pce-bg.js` (#5)
renders. The editor has no renderer of its own: the preview on the page is
`pce-bg.js`'s frame of `toPicture()`'s data, so a change that would not survive
the export cannot look right on screen.

## What it refuses, and why the VDC cannot show it

Every refusal throws an `Error` with a machine-readable `code`; the page shows
the message.

| code | refused | why |
|---|---|---|
| `17th-colour` | a pixel colour number ≥ 16 | a pixel is 4 bits: 16 colour numbers, no 17th |
| `17th-colour` | palette entry 16 | a palette has 16 colours (the backdrop + 15 entries) |
| `17th-palette` | palette index 16 (`setPaletteColour`, `newTile`, `setTilePalette`) | the BAT's palette field is 4 bits: 16 background palettes |
| `not-in-palette` | painting a VCE colour the tile's palette does not hold | a tile shows the backdrop plus its own palette's 15 entries; anything else would need a 17th colour in the tile |
| `vram-range` | a character `$800` or above | past the 32768-word VRAM: the write is dropped and the display reads colour 0 |
| `tile-space` | more than 1536 tiles | the ROM layout gives 6 tile banks |
| `no-tile` | a character with no tile behind it | the map may only name tiles that exist |
| `backdrop-entry` | setting entry 0 of one palette | colour 0 is one shared backdrop; use `setBackdrop` |
| `map-range`, `pixel-range`, `colour-range`, `palette-range`, `entry-range`, `colour-index` | out-of-range coordinates/codes | the value has no valid meaning |

The palette panel shows exactly 16 rows of 16 swatches, so the page cannot
produce a 17th; its **Check the rules** button makes the two refused calls on
the page's own picture and reports the codes (see the headless output below).

## The demo picture, painted from scratch

`editor.pic = editor.demoPicture()` — "Sunset over the bay": a dithered sky
gradient, a sun with four radial colours, two islands, the sea with the sun's
glitter. It is painted **through the editor's own calls**: `setBackdrop`,
`setPaletteColour` for every palette entry, `newTile` + `paintTileIndex` /
`paintTileColour` for every pixel of every 8×8 tile, `paintMapCell` for every
cell of the visible 28 rows, then `dedupeTiles` so the map reuses identical
tiles (that is what the BAT is for). Nothing is read from `tests/dumps/` — the
#5 scenes are not involved.

Six of the 16 palettes are used, one per horizontal band; the band edges fall
on tile rows, so a tile never straddles two bands. Measured: 896 visible cells
painted, 133 distinct tiles after dedupe (characters `$40`–`$C4`), 6 palettes,
15 colour numbers, 25 distinct RGB colours on screen, `validate()` 0 problems.

## The export

`renderer/pce-rom.js` builds the ROM from `toPicture()`; bank 0 is the constant
viewer (`renderer/viewer-bank0.bin`), so this is the #9 path unchanged.

| | |
|---|---|
| ROM | 40960 bytes (5 banks: 1 tile bank) |
| sha256 | `670001f5df1581e25e31bf9ac8d2c394566433f3205070571c15166118d48ee1` |
| bank 1 | config (`BXR=0, BYR=0, MWR=$00, CR=$80`, one region `$400`, 2128 words) + the 16 palettes at `$4040` |
| banks 2–3 | the 32×32 BAT (1024 words) |
| banks 4+ | the 133 tiles |

The **Download .pce** button offers it; the TurboGrafx checkbox (#25) offers
the bit-reversed image. `?demo=1` on the page reports the same bytes the Node
run builds.

## Evidence (measured 2026-10-28)

`node tests/check-editor.js` (exit 0; written by @design, flagged for @review
to read cold):

```
refusals: 12/12 refused with the documented code
picture: 256x224 painted from scratch, 896 visible cells, 133 tiles ($40-$c4),
         6 palettes, validate 0 problems, model == renderer
export: 40960 bytes, sha256 670001f5df1581e2… (#9's builder) — config,
        palettes, BAT and tiles are the editor's data
browser-global branch: same 12/12 refusals, same 40960 bytes
capture: tests/dumps/painted is the editor's VRAM/CRAM/regs and Mednafen's
         frame equals the editor's picture (diff 0)
PASS: the editor paints, refuses what the VDC cannot show, exports #9's ROM
      and Mednafen shows it
```

How that proof is built:

- **model == renderer** — every pixel of the 256×224 frame is recomputed from
  the editor's own data (map → tile → colour number → palette entry → 9-bit
  colour → RGB) and compared with `pce-bg.js` drawing `toPicture()`'s VRAM and
  CRAM. Two paths, one picture.
- **the refusal list** — each call is made and must throw with the documented
  code; a legal paint afterwards must still succeed (so the test cannot pass by
  refusing everything).
- **the export** — the ROM's bank-1 config and palettes, banks 2–3 (the BAT)
  and bank 4+ (the tiles) are compared byte for byte with the editor's own
  data, and the image size with the bank formula of `ROM_LAYOUT.md`.
- **the console** — `tools/capture.sh painted` runs `tools/gen/painted.pce` in
  Mednafen and harvests `tests/dumps/painted/` (the same command-line route as
  #5/#8/#9: `-qtrecord`, `-autosave`, SIGINT; no synthesized input). The
  check requires the captured VRAM to equal the editor's VRAM, the captured
  CRAM to equal its 16 palettes, `MWR/BXR/BYR/CR` to equal what it wrote, and
  Mednafen's recorded frame to equal `pce-bg.js` drawing **the editor's
  picture** with the capture's own calibration — diff 0. `node tests/check.js`
  also lists `painted: OK (256x232, diff 0)` with the other scenes.
- **the browser** — the real page, headless (command line only, no UI events):

```sh
python3 -m http.server 8123 --bind 127.0.0.1        # from the repo root
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --user-data-dir=/tmp/chrome-pce10 --virtual-time-budget=15000 --dump-dom \
  "http://127.0.0.1:8123/renderer/editor.html?demo=1&rules=1"
# exportstatus: picture 256x224, 133 tiles, 6 palettes, 0 problem(s) ·
#               ROM 40960 bytes, sha256 670001f5df1581e2…
# msg: rules: 3/3 refused — palette 16 (17th-palette);
#      palette entry 16 (17th-colour); pixel colour 16 (17th-colour)
```

`tests/dumps/painted/` holds the capture (`mednafen.png`, `vram.bin`,
`cram.bin`, `regs.json`, `mednafen.log`), recorded 2026-10-28; the Mednafen
frame is `f145f8979ec7fed0…`.

## What this does NOT prove

- **Not the page's mouse handlers.** The page calls the same functions the
  check calls, but its `mousedown`/`mousemove` wiring is read, not executed —
  no synthetic input is ever sent on this machine.
- **Not the download wiring.** `URL.createObjectURL` and the anchor click are
  read, not run by an automated check.
- **Not every picture.** One BAT size (32×32), one scroll (`BXR=BYR=0`), one
  region, 133 tiles, no sprite palettes, no 64-row BAT, no 336/512-px mode.
  The editor cannot edit the scroll yet.
- **Not that the picture is one someone wanted.** The demo is a procedural
  landscape painted through the editor's API; it shows the chain works, not
  that a person can draw well with the UI.
- **Mednafen's crop.** Its default display rectangle starts one VDW line in
  (`RCRCount − (scanline − 18) = 1` in the capture), so the capture shows
  picture rows 1–232; the editor previews from VDW line 0. The check compares
  the preview with the capture one row apart, and the 232-row render with the
  capture directly (diff 0). That is Mednafen's crop, not a hardware fact this
  repo measured.
- **Not the console.** Mednafen is not a HuCard on real hardware; the #8 Tang
  Nano photo is still the hardware check.
