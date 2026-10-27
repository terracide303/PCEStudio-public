# The browser's .pce (card #9)

`renderer/pce-rom.js` builds a HuCard ROM in the browser from one picture:
the constant viewer code bank plus the data banks at the fixed places of
[`ROM_LAYOUT.md`](ROM_LAYOUT.md). For the sample scenes its output is
**byte-for-byte equal** to the ROM PCEAS assembles from
`tools/gen/viewerN.asm`, and that ROM shows the picture in Mednafen.

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

## What this does NOT prove

- **Not the download wiring.** The test and the headless run exercise
  `renderer/pce-rom.js`; the button's `Blob`/`URL.createObjectURL` path is
  read but not executed by an automated check.
- **Not that the picture is right.** Byte equality says the two builders
  agree on a picture; `check-viewer.js` says the picture matches the #5
  renderer on Mednafen. Neither says the data is a picture someone wanted.
- **Not the console.** Byte equality and Mednafen are not a HuCard on real
  hardware; the Tang Nano check belongs to #8's photo, and the TurboGrafx
  bit-reversed image is #25.
- **Not every picture.** The three sample scenes cover 32/64/128-wide BATs,
  one- and two-bank BATs, and 1–2 tile regions. A 64-row BAT, 8 regions, a
  full 6 tile banks, or a picture that trips a validation error is not
  exercised here.
