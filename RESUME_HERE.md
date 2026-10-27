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
`node tests/check-export.js` exits 0: for scenes 1/2/3 the browser's ROM is
**byte-for-byte equal** to the PCEAS ROM (40960 bytes, sha256
`92057e34…`/`57c62f2d…`/`49dffff8…`), including through the module's
browser-global branch; a one-byte change to the reference makes it fail. The
real page in headless Chrome reports the same equality for all three scenes.
`tools/capture.sh N browser` builds the ROM with `pce-rom.js`, runs it in
Mednafen and harvests `tests/dumps/browserN/`; `node tests/check-viewer.js`
reports `browser1/2/3: OK (frame diff 0, vram/cram/regs match sceneN)`.
Details and limits: [`docs/EXPORT.md`](docs/EXPORT.md).

Facts come from the Hudson manuals in PCEHeroTN's `docs/datasheets/` (read
there, never copied here).

DeepSeek cards (#ds-flash) need `DEEPSEEK_API_KEY` set before `agents.py` can
start them.

## Next action

`../workshop/board.py next PCEStudio --who design`. #8 stays parked until
Dennis photographs `tools/gen/viewer1.pce` on the Tang Nano; #9's browser
export is done and ready for @review (it wrote `tests/check-export.js`, so it
should be read cold, like the #5/#8 tests).

