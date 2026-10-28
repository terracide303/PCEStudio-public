# RESUME HERE — 2026-10-28

**One page. The live state. Every claim carries how it was measured.**
If a detail is not here, it is history, not current truth.

## Read these first — they do not decay

1. **This project is new.** Nothing is built and nothing is proven.
2. **The rules are in `../workshop/RULES.md`** and there is currently one. They
   grow by retrospective, not by having good ideas.

## Where we stand

**#1 is done.** `docs/SURVEY.md` surveys the PCE graphics tools, HuC/PCEAS, the
web pixel editors, ppu.toys and the open-source PCE emulators, with licences and
what each does not do. Its verdicts, recorded in `docs/DECISIONS.md`:

- **Renderer:** write our own VDC/VCE model in plain JS. I found no PCE-aware
  browser renderer; emulators are references/checks only.
- **Editor:** write our own. I found no PCE-aware editor; general web editors
  cannot express 16 palettes of 16 with a per-tile choice and the BAT.
- **Viewer ROM:** **adapt HuDK** (`BlockoS/HuDK`, MIT) — its `include/` and
  `example/asm/3_map_8x8` already do 256×224 VDC/VCE init, palette/tile load and
  BAT copy; write the thin PCEStudio loader/data layout. Assemble with PCEAS.
- **Image import:** adapt SuperFamiconv (MIT) for palette/tile/map conversion.
- **Assembler:** PCEAS is freeware with unclear provenance; use it as an
  external build tool, do not vendor it. `ca65` (zlib, `--cpu huc6280`) is the
  clean fallback.
- **Emulator checks:** Mednafen 1.32.1 (GPL-2.0, installed) is primary; ares
  (ISC plus third-party terms) is the independent second opinion; Geargrafx
  (GPL-3.0) is the debugger/VRAM/MCP check; Mesen2 is a fallback only. No
  emulator code is built in.

**#7 is done.** PCEAS 3.23 (`52a556a`, from `uli/huc`) is built from source and
installed at `~/.local/bin/pceas`; it is an external build tool and is not
vendored (`docs/DECISIONS.md`). `make -C tools` builds `tools/hello.pce`
(8 KiB, sha256 `9be7ead2…`), and Mednafen 1.32.1 shows it as a solid red screen:
`docs/hello-mednafen.png` is 256x232 with every pixel RGB `(252, 0, 0)`. The
install and build steps are in `docs/BUILD.md`.

**#5 is done** (renderer, diff 0) and **#6 is done** (its mutation test): the
browser background renderer `renderer/pce-bg.js` renders the three
deterministic scenes of `tools/genroms.py` pixel-for-pixel against Mednafen's
recorded frames — `node tests/check.js` exits 0; #6 proved the test fails on a
deliberately broken renderer. The renderer model and how the dumps were
measured are in `docs/RENDERER.md`; dumps (committed evidence) live in
`tests/dumps/sceneN/` (vram.bin, cram.bin, regs.json, mednafen.png).

**#8 is parked, not finished.** `tools/viewer.asm` is a self-contained
adaptation of HuDK (MIT notice in the file; PCEAS 3.23 cannot assemble HuDK
sources directly) that loads the config, 16 palettes, BAT and tiles from the
fixed places of [`docs/ROM_LAYOUT.md`](docs/ROM_LAYOUT.md) and shows them.
`tools/genviewer.py` lays #5's sample data into those places and
`make -C tools gen/viewerN.pce` assembles the ROM. **Proven in Mednafen:**
`node tests/check-viewer.js` exits 0 — for all three scenes the viewer's
recorded frame matches the renderer (diff 0) and the captured VRAM/CRAM/VDC
registers match the scene dumps (capture route: `tools/capture.sh N viewer`,
command line only, no keystrokes). **Only open item: the Tang Nano photo**
(Dennis's part — flash `tools/gen/viewer1.pce` with
`openFPGALoader -b tangnano20k --external-flash -o 0x400000` and photograph
it). Parked 2026-10-28 so #9 could start; reopen when the photo exists.

**#9 is done.** `renderer/pce-rom.js` builds the .pce in the browser from the
same picture data the PCEAS path uses (VRAM/CRAM/regs plus
`tests/dumps/sceneN/regions.json`, now the one region description both
builders read). It copies the constant viewer bank
`renderer/viewer-bank0.bin` (`make -C tools bank0`, extracted from the PCEAS
builds and refused if they differ) and lays out the data banks at
[`docs/ROM_LAYOUT.md`](docs/ROM_LAYOUT.md)'s fixed places.
`node tests/check-export.js` exits 0: for all 14 sample scenes the browser's
ROM is **byte-for-byte equal** to the PCEAS ROM (scene1/2/3 sha256
`fad21114…`/`295260bb…`/`95ba93df…`; full table in
[`docs/EXPORT.md`](docs/EXPORT.md)), including through the module's
browser-global branch; a one-byte change to the reference makes it fail. The
real page in headless Chrome reports the same equality for scene1.
`tools/capture.sh N browser` builds the ROM with `pce-rom.js`, runs it in
Mednafen and harvests `tests/dumps/browserN/`; `node tests/check-viewer.js`
reports `browser1/2/3: OK (frame diff 0, vram/cram/regs match sceneN)`.
Details and limits: [`docs/EXPORT.md`](docs/EXPORT.md).

Facts come from the Hudson manuals in PCEHeroTN's `docs/datasheets/` (read
there, never copied here).

DeepSeek cards (#ds-flash) need `DEEPSEEK_API_KEY` set before `agents.py` can
start them.

**#25 is [~], software done, hardware test open.** The page has a TurboGrafx
checkbox (`?us=1` for a headless run); `renderer/pce-rom.js`'s `reverseBits()`
gives the US image, which is the .pce with every byte's bits reversed.
`node tests/check-us-card.js` exits 0: scenes 1/2/3 are 40960 bytes, every byte
the bit-reverse of the .pce (3,935/5,970/10,853 bytes differ; sha256
`cc1c1b6f…`/`3e386bf9…`/`aa115f22…`), the comparison rejects the un-reversed
and one-byte-error images, and the real page reports the same bytes headlessly.
**Measured limit: Mednafen 1.32.1 shows the US image as a single-colour white
frame** (`tests/dumps/us1/`, 59,392/59,392 pixels `(252,252,252)` vs 120
colours for scene1) — and that matches its source: `src/pce/huc.cpp`'s
`HuC_Load` copies the file unchanged and Mednafen has no US/region mode, so no
emulator run can confirm the image. The card stays `[~]` for Dennis: run
`tools/gen/us1.pce` (sha256 `cc1c1b6f…`, built by `node tests/check-us-card.js
--write 1`) on a TurboGrafx-16 or its flash cart and photograph it into
`docs/`. Details: [`docs/EXPORT.md`](docs/EXPORT.md).

**#10 is done.** `renderer/editor.html` + `renderer/pce-editor.js`: paint 8×8
tiles, choose palette colours from the VCE's 512, paint the 32×32 BAT, with
the preview drawn by `pce-bg.js` and the export built by `pce-rom.js` (#9).
The picture is kept in the VDC's own shape (16 palettes of 16, 4-bit pixels,
the shared backdrop, ROM limits), and the editor refuses what the VDC cannot
show: a 17th colour in a tile, a 17th palette, a 17th colour in a palette, a
colour outside the tile's palette, a character past the 32768-word VRAM.
`node tests/check-editor.js` exits 0: 12/12 refusals with their codes; the
demo picture (256×224, 896 cells, 133 tiles after dedupe, 6 palettes) is
recomputed from the editor model and equals `pce-bg.js` drawing it; the ROM
(40960 bytes, sha256 `486477d6…`) carries exactly the editor's config,
palettes, BAT and tiles; `tests/dumps/painted/` is that ROM's Mednafen capture
— its VRAM/CRAM/regs are the editor's and its frame equals the editor's
picture, diff 0 — and `node tests/check.js` reports 10 pictures diff 0.
(`us1` is no longer counted: its CR is 0, so Mednafen was not running the US
image — #38, docs/REVIEW.md finding 4.) The
real page headlessly reports the same bytes and `rules: 3/3 refused`. Details
and limits: [`docs/EDITOR.md`](docs/EDITOR.md). The test was written by
@design and is flagged for @review to read cold.

**#14 is done.** The viewer loads the sprites. `tools/viewer.asm` copies the
SAT (256 words) from bank 1 `$0440` to VRAM `$7f00`, sets DVSSR = `$7f00` and
DCR bit 4 (DSR), so the VDC's SATB DMA re-loads the SAT into the SATB every
VBlank (VDC manual DCR R0F p. H7-11, SATB 2.4.2 p. H7-20, DVSSR R13
p. H7-12), and loads all 512 colour-table entries (sprite palettes come
too). `tools/genviewer.py` emits `vspriteN` ROMs of #12's sprite scenes;
`renderer/pce-rom.js` lays the SAT into bank 1, so the #9 browser export
carries it as well ([`docs/ROM_LAYOUT.md`](docs/ROM_LAYOUT.md)). Proven:
`node tests/check-viewer.js` exits 0 on **17 captures** (viewer1-3,
browser1-3, vsprite1-11) — every viewer frame diff 0 against the renderer
(#12's close condition now holds for the viewer too) and the captured
VRAM/CRAM/DCR/SATB registers and the SATB mirror equal the scene dumps, so
the DMA really carried the SAT. `node tests/check-export.js` exits 0 on all
14 scenes; `check.js` still reports 41 pictures diff 0. Two #14 finds, both
invisible to the frame checks and caught by VRAM byte equality: a
`copy_words` page-position bug in `viewer.asm` (a copy not ending on a
256-byte page was re-read from the page start) and a `genroms.py` table
overrun (the stripes scenes' 16-word regions copied 240 garbage words into
VRAM); both fixed, sprite3/sprite10 rebuilt and re-captured, details in
[`tests/README.md`](tests/README.md). Tests written by @design — flagged for
@review to read cold.

## Next action

`../workshop/board.py next PCEStudio --who design`. #11 (@review) reads Phase
1 cold, #5–#10, and #14's viewer evidence. #8 stays parked until Dennis
photographs `tools/gen/viewer1.pce` on the Tang Nano; #25 waits on Dennis's
TurboGrafx photo of `tools/gen/us1.pce`. #13 ("A sprite editor and the SATB
in the export") is still backlog.

