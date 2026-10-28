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
renderer model draws colour 0 there). A region that starts below 32768 but
ends past it is refused by both builders: its data cannot be laid out
truthfully, because a slice would truncate it while the descriptor still
promises the full length.

`bank0` is extracted from the PCEAS build, not assembled in the browser:

```sh
make -C tools          # assembles tools/gen/viewerN.pce
make -C tools bank0    # writes renderer/viewer-bank0.bin
```

`tools/extract_bank0.py` refuses unless the first 8 KiB of all 14 viewer
ROMs are identical, so a change to `viewer.asm` cannot leave the asset stale
or pick one build's copy by accident. If the asset were stale, the export
test below fails on bank 0's bytes.

## The bytes it writes

An 8 KiB-banked, headerless image (`pceas -raw` output; no 512-byte header):

| bank | content |
|------|---------|
| 0 | `bank0`, verbatim |
| 1 | 64-byte config at offset 0, the 512 colour-table entries at offset `0x40`, the SAT at offset `0x440` |
| 2–3 | the BAT (`width × height` words) from VRAM word 0 |
| 4+ | the copy regions, concatenated in descriptor order |

Everything not written is `0xff`, including a whole bank 3 when the BAT fits
in bank 2 and the padding of the last bank. The image is
`4 + max(1, ceil(tiles / 8192))` banks, the same bank count PCEAS emits for
the generated `.asm`. `pce-rom.js` throws rather than writing a ROM the layout
cannot hold (more than 13 regions, more than 2 BAT banks, wrong-sized dumps, a
tile region that runs past the 32768-word VRAM).

The data banks are no longer capped at 80 KiB (#46). Banks 4–255 hold the
copy regions, streamed through the viewer's one 8 KiB MPR2 window; 256 banks
of 8 KiB = 2 MB of physical address space is the HuC6280's limit (hardware
manual H8-7, H8-10/11; [`MANUALS.md`](MANUALS.md) §5.1). A request whose bank
count passes 256 is refused with `e.code === "rom-too-big"` and a message
naming the limit, checked before any bytes are copied. The 13-region cap is
the config block's room before the palette at `0x40`; the region list is
validated before it, so an over-limit request is refused for its size first.

## Evidence

```sh
make -C tools
node tests/check-export.js      # byte equality, all 16 scenes
```

Measured 2026-10-28 (PCEAS 3.23, the 16 sample scenes — #14 extended the
sample set from the three #9 scenes to the 11 sprite scenes; #46 added
scene10, the 88 KiB picture):

| scene | bytes | sha256 (first 16) | equal to PCEAS |
|-------|-------|-------------------|----------------|
| 1 | 40960 | `fad2111402cb0bf8` | yes |
| 2 | 40960 | `295260bb15013016` | yes |
| 3 | 40960 | `95ba93df3664f6d5` | yes |
| sprite1 | 40960 | `43e0b6bb34f2e8ae` | yes |
| sprite2 | 40960 | `7eb32d2a62256419` | yes |
| sprite3 | 40960 | `4ee5ec50888f8a19` | yes |
| sprite4 | 40960 | `190a6a948d787d82` | yes |
| sprite5 | 40960 | `038cbd8ccf2175db` | yes |
| sprite6 | 40960 | `aba7d442e0ab3be8` | yes |
| sprite7 | 40960 | `5e9380bbb404f917` | yes |
| sprite8 | 40960 | `31bb8ee1385427da` | yes |
| sprite9 | 40960 | `106cb7a91e72e848` | yes |
| sprite10 | 40960 | `c800a04526775d29` | yes |
| sprite11 | 40960 | `5df566ef10a23625` | yes |
| sprite12 | 49152 | `3f69a09d68492a80` | yes |
| scene10 | 90112 | `541fa274c93543dc` | yes |

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
# → built 40960 bytes, sha256 fad2111402cb0bf8… — byte-for-byte equal to the PCEAS build
```

The same output was measured for `scene2`, `scene3` and the sprite scenes.

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
| 1 | 40960 | `cc1c1b6fee963699` | 3935 |
| 2 | 40960 | `3e386bf90082a5b4` | 5970 |
| 3 | 40960 | `aa115f22e5123d20` | 10853 |

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
#   (3935 bytes differ), sha256 cc1c1b6fee963699…
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

## A ROM bigger than 80 KB — card #46

The old 80 KiB cap was `MAX_TILE_BANKS = 6` (48 KiB of tiles) plus the fixed
four banks. The copy regions are now taken through banks 4–255, the viewer
re-mapping its one 8 KiB MPR2 window as the pointer crosses `$6000`
(`tools/viewer.asm` `copy_words`); the ceiling is the HuC6280's 256 blocks
of 8 KiB = 2 MB of physical address space (hardware manual H8-7 and
H8-10/11, [`MANUALS.md`](MANUALS.md) §5.1; the same section's H8-9 map labels
blocks `00`–`F6` as the card range, and the capacity statement is the
256-block figure #44's GAP 4 took as the limit). The layout and the MPR use
are in [`ROM_LAYOUT.md`](ROM_LAYOUT.md#a-rom-past-80-kib-card-46).

`tests/dumps/scene10` is the picture the card is proven on, generated by
`tests/make-big-scene.js`:

| block | size | where |
|-------|------|-------|
| BAT, 64x64 | 8,192 B | VRAM words 0–4095 |
| tile set, 1024 tiles at character `$100` | 32,768 B | VRAM words 4096–20479 |
| 160 sprite-pattern cells at character `$500` | 20,480 B | VRAM words 20480–30719 |
| SAT, 8 visible 32x32 sprites | 512 B | VRAM word `$7f00` |

53,248 bytes of copy regions = 7 tile banks, so the ROM is 11 banks =
**90,112 bytes (88 KiB)**, byte-for-byte equal to the PCEAS build
(`tools/gen/viewer10.pce`, `genviewer.py 10`) and built in the page's own
module. A 128x64 BAT cannot pass the old cap: it spends 16 KiB of the 64 KiB
VRAM, leaving 48,640 bytes of regions = exactly the old 6 tile banks; the
64x64 BAT leaves room for the sprite patterns that do.

Measured 2026-10-28:

```sh
make -C tools                  # builds gen/viewer10.pce (VIEWERS now has 10)
node tests/check-export.js     # scene10: 90112 B, byte-for-byte equal to PCEAS
tools/capture.sh 10 browser    # browser10.pce (built by pce-rom.js) in Mednafen
node tests/check-viewer.js     # browser10: frame diff 0; vram/cram/sat/regs
                               # equal to scene10
node tests/check.js            # browser10: 256x232, diff 0
```

The refusal has its own code:

```sh
node tests/check-export.js
# scene10: a 268-bank ROM is refused with code rom-too-big …
```

The test asks `buildRom` for 33 regions of 32,768 words (2,162,688 bytes of
regions = 268 banks, over the 256-bank ceiling) and requires
`e.code === "rom-too-big"` with the limit in the message; a 33-region request
under the size limit is still refused by the descriptor-count check, so the
size guard does not swallow the layout check. **A picture the config can
describe cannot reach 2 MB** — every region is a slice of one 64 KiB VRAM and
13 descriptors are the config block's room — so the guard is a ceiling, not a
path any legal single picture takes (the overlapping 33-region request is the
input that exercises it). `tools/genviewer.py` refuses above 128 banks
because PCEAS 3.23's `.bank` index stops at `0x7F`; Mednafen likewise maps
only 128 banks for a standard HuCard, so the 1–2 MB range has no assembler or
emulator reference here.

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
- **Not every picture.** The sample scenes now cover 32/64/128-wide BATs,
  one- and two-bank BATs, 1–3 tile regions, and (scene10) a 64-row BAT with
  more than six tile banks. Still not exercised: more than 3 regions in one
  picture, every multi-region boundary case, and a ROM in the 1–2 MB range
  (no PCEAS or Mednafen reference above 128 banks; see above).
