# The browser's .pce (card #9)

`renderer/pce-rom.js` builds a HuCard ROM in the browser from one picture:
the constant viewer code bank plus the data banks at the fixed places of
[`ROM_LAYOUT.md`](ROM_LAYOUT.md). For the sample scenes its output is
**byte-for-byte equal** to the ROM PCEAS assembles from
`tools/gen/viewerN.asm`, and that ROM shows the picture in Mednafen.

The editor (#10) exports through this same builder: its picture is a
`{vram, cram, regs, regions}` object, so nothing here changes for it — see
[`EDITOR.md`](EDITOR.md).

## Inputs

| input | size | where it comes from |
|-------|------|---------------------|
| `bank0` | 8192 B | `renderer/viewer-bank0.bin` — `viewer.asm`'s assembled bank, copied verbatim |
| `vram` | 65536 B | a VDC VRAM dump (32768 words, little-endian) |
| `cram` | 1024 B | a VCE colour-table dump (512 entries, little-endian) |
| `regs` | — | `BXR`, `BYR`, `MWR`, `CR`, the values the config block carries |
| `regions` | — | `tests/dumps/sceneN/regions.json`: `[char0, tileCount]` pairs in descriptor order |

The regions are **picture data**, not build tooling: `tools/genviewer.py`
reads the same `regions.json` for the PCEAS path, so there is one description
of where a picture's tiles live. Regions whose VRAM destination word is
`>= 32768` are dropped by both builders (the VDC drops those writes, and the
renderer model draws colour 0 there).

`bank0` is extracted from the PCEAS build, not assembled in the browser:

```sh
make -C tools          # assembles tools/gen/viewerN.pce
make -C tools bank0    # writes renderer/viewer-bank0.bin
```

`tools/extract_bank0.py` refuses unless the first 8 KiB of all three viewer
ROMs are identical, so a change to `viewer.asm` cannot leave the asset stale
or pick one build's copy by accident. If the asset were stale, the export
test below fails on bank 0's bytes.

## The bytes it writes

An 8 KiB-banked, headerless image (`pceas -raw` output; no 512-byte header):

| bank | content |
|------|---------|
| 0 | `bank0`, verbatim |
| 1 | 64-byte config at offset 0, 16 palettes at offset `0x40` |
| 2–3 | the BAT (`width × height` words) from VRAM word 0 |
| 4+ | the tile regions, concatenated in descriptor order |

Everything not written is `0xff`, including a whole bank 3 when the BAT fits
in bank 2 and the padding of the last bank. The image is
`4 + max(1, ceil(tiles / 8192))` banks, the same bank count PCEAS emits for
the generated `.asm`. `pce-rom.js` throws rather than writing a ROM the layout
cannot hold (more than 8 regions, more than 2 BAT banks, more than 6 tile
banks, wrong-sized dumps).

## Evidence

```sh
make -C tools
node tests/check-export.js      # byte equality, all three scenes
```

Measured 2026-10-28 (PCEAS 3.23, the three sample scenes):

| scene | bytes | sha256 (first 16) | equal to PCEAS |
|-------|-------|-------------------|----------------|
| 1 | 40960 | `92057e3479ca46d9` | yes |
| 2 | 40960 | `57c62f2d9975c21a` | yes |
| 3 | 40960 | `49dffff8dd49af81` | yes |

`tests/check-export.js` also loads `renderer/pce-rom.js` through its
browser-global branch (a `vm` context with `self` and no `module`) and
requires the same bytes, so the page's code path is exercised, not assumed.
Its comparison was checked against a one-byte change: flipping byte `0x2000`
of the PCEAS reference made it print `1 differing bytes … first at 0x2000`
and exit 1.

The actual page was run headlessly (command line only, no UI events) and
reported equality itself:

```sh
python3 -m http.server 8123 --bind 127.0.0.1   # from the repo root
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --user-data-dir=/tmp/chrome-pce --virtual-time-budget=10000 --dump-dom \
  "http://127.0.0.1:8123/renderer/index.html?scene=scene1"
# → built 40960 bytes, sha256 92057e3479ca46d9… — byte-for-byte equal to the PCEAS build
```

The same output was measured for `scene2` and `scene3`.

For "it shows the picture in Mednafen", the browser's own bytes were run,
not PCEAS's:

```sh
tools/capture.sh 1 browser     # builds tools/gen/browser1.pce with pce-rom.js,
                               # runs it in Mednafen, harvests tests/dumps/browser1/
tools/capture.sh 2 browser
tools/capture.sh 3 browser
node tests/check-viewer.js
# browser1/2/3: OK (frame diff 0, vram/cram/regs match scene1/2/3)
```

`tests/dumps/browserN/` holds those captures (`mednafen.png`, `vram.bin`,
`cram.bin`, `regs.json`, `mednafen.log`), recorded 2026-10-28.

## The US HuCard (TurboGrafx-16) image — card #25

The page has a **TurboGrafx HuCard** checkbox. Ticked, the button offers the
same picture as a **US image**: the .pce with every byte's bits reversed
(bit 0 ↔ bit 7, bit 1 ↔ bit 6, …). The card's reason is that US HuCards read
their ROM with the data lines D7..D0; that is the card's statement, not
something this repo verified (see the limit below). The transform is
`PCEStudio.rom.reverseBits(bytes)` in `renderer/pce-rom.js`; nothing else about
the image changes (same length, same banks). The download is named
`pictureN-us.pce`; `?us=1` on the page URL opens with the box already ticked
(so the headless check can run the US path without synthesizing a click), and
`tools/capture.sh N us` builds `tools/gen/usN.pce` with the module and runs it.

### Evidence

```sh
node tests/check-us-card.js     # every byte, all three scenes
node tests/check-export.js      # the .pce path is unchanged (#9)
```

Measured 2026-10-28 (`node tests/check-us-card.js`, exit 0):

| scene | bytes | US sha256 (first 16) | bytes differing from the .pce |
|-------|-------|----------------------|-------------------------------|
| 1 | 40960 | `b9a7524eb16830b8` | 3511 |
| 2 | 40960 | `097fbd25e4847539` | 5546 |
| 3 | 40960 | `8a3d67dbaf6c0e2c` | 10429 |

The test checks every byte against an independent bit loop, checks that
reversing back returns the .pce exactly, and requires the image to differ from
the .pce (most of the ROM is `0x00`/`0xff` padding, which is its own reverse).
It loads the module through its browser-global branch too, and it runs the
comparison on the un-reversed .pce and on a one-byte error to show the
comparison can fail. The real page reports the same bytes itself:

```sh
# served as in the #9 section above
… --dump-dom "http://127.0.0.1:8123/renderer/index.html?scene=scene1&us=1"
# → US HuCard: 40960 bytes, every byte the bit-reverse of the .pce
#   (3511 bytes differ), sha256 b9a7524eb16830b8…
```

### What an emulator says — and what it cannot

**Mednafen 1.32.1 shows the US image as a blank screen.** Measured 2026-10-28:
`tools/capture.sh 1 us` recorded 256×232 with a single colour
`(252, 252, 252)` in all 59,392 pixels, against 120 distinct colours for the
same picture's .pce. That is expected from Mednafen's source, not a defect in
our image: `src/pce/huc.cpp` `HuC_Load` reads the file into ROM unchanged (it
only skips a 512-byte copier header and picks the SF2 mapper for large ROMs),
and neither `pce.cpp` nor `Documentation/pce.html` has a US/region mode, so
Mednafen has nothing that would decode a bit-reversed image. **An emulator run
therefore cannot say whether the US image is right** — the only check left for
it is a TurboGrafx-16 (or a flash cart), which is Dennis's, and the card stays
`[~]` until that photo is in `docs/`.

## What this does NOT prove

- **Not the download wiring.** The test and the headless run exercise
  `renderer/pce-rom.js`; the button's `Blob`/`URL.createObjectURL` path is
  read but not executed by an automated check.
- **Not that the picture is right.** Byte equality says the two builders
  agree on a picture; `check-viewer.js` says the picture matches the #5
  renderer on Mednafen. Neither says the data is a picture someone wanted.
- **Not the console.** Byte equality and Mednafen are not a HuCard on real
  hardware; the Tang Nano check belongs to #8's photo, and the TurboGrafx
  US image runs on nothing here — Mednafen shows it blank (above).
- **Not every picture.** The three sample scenes cover 32/64/128-wide BATs,
  one- and two-bank BATs, and 1–2 tile regions. A 64-row BAT, 8 regions, a
  full 6 tile banks, or a picture that trips a validation error is not
  exercised here.
