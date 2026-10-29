# The browser's .pce (card #9)

`renderer/pce-rom.js` builds a HuCard ROM in the browser from one picture:
the constant viewer code bank plus the data banks at the fixed places of
[`ROM_LAYOUT.md`](ROM_LAYOUT.md). For the sample scenes its output is
**byte-for-byte equal** to the ROM PCEAS assembles from
`tools/gen/viewerN.asm`, and that ROM shows the picture in Mednafen.  #16
extends the agreement to the raster viewers: a picture with a `raster`
table builds the same fixed-layout table image the PCEAS path
(`tools/genviewer.py`, `vraster1-10`) encodes, byte for byte.

The editor (#10) exports through this same builder: its picture is a
`{vram, cram, regs, regions}` object (plus `raster` for the #17 effects),
so nothing here changes for it — see
[`EDITOR.md`](EDITOR.md).

## Inputs

| input | size | where it comes from |
|-------|------|---------------------|
| `bank0` | 8192 B | `renderer/viewer-bank0.bin` — `viewer.asm`'s assembled bank, copied verbatim |
| `vram` | 65536 B | a VDC VRAM dump (32768 words, little-endian) |
| `cram` | 1024 B | a VCE colour-table dump (512 entries, little-endian) — or `raster.baseCram` when a table is present (#16) |
| `regs` | — | `BXR`, `BYR`, `MWR`, `CR`, the values the config block carries — with RC (0x04) ORed into CR when a table is present (#16) |
| `regions` | — | `tests/dumps/sceneN/regions.json`: `[char0, tileCount]` pairs in descriptor order |
| `raster` | — | optional (#16): the renderer-shaped table `{base, baseCram, entries}` plus `frameCounter`; encoded as the fixed 3856-byte image at bank 1 offset `0x640` ([`ROM_LAYOUT.md`](ROM_LAYOUT.md)) and flagged with config byte 9 = 1 |

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
| 1 | 64-byte config at offset 0, the 512 colour-table entries at offset `0x40`, the SAT at offset `0x440`, the 3856-byte raster table image at offset `0x640` when config byte 9 = 1 (#16), and — when config version = 2 (#70) — the 8-byte wide-window block (VCE CR + HSR/HDR) at offset `0x1F00` |
| 2–3 | the BAT (`width × height` words) from VRAM word 0 |
| 4+ | the copy regions, concatenated in descriptor order |

Everything not written is `0xff`, including a whole bank 3 when the BAT fits
in bank 2 and the padding of the last bank. The image is
`4 + max(1, ceil(tiles / 8192))` banks, the same bank count PCEAS emits for
the generated `.asm`. `pce-rom.js` throws rather than writing a ROM the layout
cannot hold (more than 13 regions, more than 2 BAT banks, wrong-sized dumps, a
tile region that runs past the 32768-word VRAM).

The data banks are no longer capped at 80 KiB (#46), and the ceiling is the
HuCard's 1 MB, not the HuC6280's address space (#57). Banks 4–127 hold the
copy regions, streamed through the viewer's one 8 KiB MPR2 window; 128 banks
of 8 KiB = 1 MB is what a HuCard decodes — physical banks `$00`–`$7F`
(sgxtech.txt "HuC6280 memory map"; pcetech.txt §3 "Memory map"; hes spec
[MEMORY MAP] ROM `0x000000`–`0x0FFFFF`; [`MANUALS.md`](MANUALS.md) §15.1
GAP 4). The HuC6280's 2 MB / 256-block physical space (H8-7, H8-10/11) is the
CPU's address space: `$80`–`$F7` are not card memory. A request whose bank
count passes 128 is refused with `e.code === "rom-too-big"` and a message
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

The #16 pairs (each loaded with its scene's table from
`tools/gen/rasterN.raster.json`, exactly like `genviewer.py` builds the
PCEAS side — base registers from the table's base block with RC ORed into
CR, the table image part of the byte agreement), measured 2026-10-28:

| dump | bytes | sha256 (first 16) | equal to PCEAS |
|------|-------|-------------------|----------------|
| raster1 | 40960 | `c3b0740e5a3cc019` | yes |
| raster2 | 40960 | `b66767cbcb6aa47c` | yes |
| raster3 | 40960 | `48321311342ecd0b` | yes |
| raster4 | 40960 | `5d7b1849d0836472` | yes |
| raster5 | 40960 | `f52a22820c9a2ee7` | yes |
| raster6 | 40960 | `cb82530f5bf359e5` | yes |
| raster7 | 40960 | `b0e49c0187dd29b3` | yes |
| raster8 | 40960 | `16da7ed3d0fbd7b0` | yes |
| raster9 | 40960 | `9faa0df934ded043` | yes |
| raster10 | 40960 | `2e61d70cd60ed9f4` | yes |

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
four banks. The copy regions are now taken through banks 4–127, the viewer
re-mapping its one 8 KiB MPR2 window as the pointer crosses `$6000`
(`tools/viewer.asm` `copy_words`); the ceiling is the HuCard's 128 banks of
8 KiB = 1 MB (#57). That is the card's decode, physical banks `$00`–`$7F`
(sgxtech.txt "HuC6280 memory map"; pcetech.txt §3 "Memory map"; hes spec
[MEMORY MAP] ROM `0x000000`–`0x0FFFFF`; [`MANUALS.md`](MANUALS.md) §15.1
GAP 4), **not** the HuC6280's 2 MB / 256-block physical address space
(hardware manual H8-7, H8-10/11; `MANUALS.md` §5.1). #46 took the CPU's
256-block figure as the card's limit; the measured notes put the card's
decode at 128. The layout and the MPR use are in
[`ROM_LAYOUT.md`](ROM_LAYOUT.md#a-rom-past-80-kib-card-46).

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
# scene10: exactly 1 MB (128 banks) is accepted by the size guard …
#          a 129-bank ROM is refused with code rom-too-big …
```

The test asks `buildRom` for 15 x 2048 chars + 1 x 1025 chars = 1,015,840
tile bytes = 125 tile banks, i.e. 129 banks = 1 MB + 1 bank, over the
128-bank ceiling, and requires `e.code === "rom-too-big"` with the limit in
the message. The exactly-1 MB request (124 tile banks, 128 banks in all) is
accepted by the size guard and refused next by the descriptor cap — that is
the evidence the guard sits at 128 and not 256. A 33-region request under
the size limit is likewise still refused by the descriptor-count check, so
the size guard does not swallow the layout check. **A legal picture cannot
reach 1 MB**: every region is a slice of one 64 KiB VRAM and 13 descriptors
are the config block's room, so the largest describable picture is
13 x 65,536 B = 851,968 tile bytes = 104 tile banks, 108 banks = 864 KiB.
The check builds that and requires 108 banks, so the reachable ceiling is
measured rather than assumed.

`tools/genviewer.py` carries the same 128-bank number, but for a different
reason: PCEAS 3.23's `.bank` index stops at `0x7F`, which now coincides with
the card's decode rather than being the tighter of the two. Its bank guard is
a backstop no input reaches — the 13-region assert fires first, and 13 legal
regions cap at 108 banks (probed 2026-10-28). A legal build of exactly 1 MB
would need a config layout with 16 descriptors, which the fixed 64-byte
config does not have. **So "a picture of exactly 1 MB builds" is not
achievable on this card**: the size guard is the hardware ceiling and the
descriptor cap is the real ceiling; the exactly-1 MB request is accepted by
the size guard and refused next by the descriptor cap. **#58 closed the gap
as a decision, not a build:** the config keeps its 13 descriptors, so 864
KiB stays the shipped descriptor ceiling, and a picture whose regions do not
overlap tops out at 12 banks (98,304 B) because all regions live in one
64 KiB VRAM — the reasoning and the measurement are in
[`ROM_LAYOUT.md`](ROM_LAYOUT.md) §The size ceiling.

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
  picture and every multi-region boundary case. A picture above 12 banks
  (98,304 B) is not missing coverage — VRAM cannot hold it; the 108-bank
  (864 KiB) fixture is the config's descriptor ceiling counted on one VRAM,
  and 1 MB is the card's decode (see [`ROM_LAYOUT.md`](ROM_LAYOUT.md)
  §The size ceiling).
