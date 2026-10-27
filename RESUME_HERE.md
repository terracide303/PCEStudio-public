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

**#8 is started, not finished.** `tools/viewer.asm` is a self-contained
adaptation of HuDK (MIT notice in the file; PCEAS 3.23 cannot assemble HuDK
sources directly) that loads the config, 16 palettes, BAT and tiles from the
fixed places of [`docs/ROM_LAYOUT.md`](docs/ROM_LAYOUT.md) and shows them.
`tools/genviewer.py` lays #5's sample data into those places and
`make -C tools gen/viewerN.pce` assembles the ROM. **Proven in Mednafen:**
`node tests/check-viewer.js` exits 0 — for all three scenes the viewer's
recorded frame matches the renderer (diff 0) and the captured VRAM/CRAM/VDC
registers match the scene dumps (capture route: `tools/capture.sh N viewer`,
command line only, no keystrokes). **Still open: the Tang Nano photo**
(Dennis's part — flash `tools/gen/viewer1.pce` with
`openFPGALoader -b tangnano20k --external-flash -o 0x400000` and photograph
it); the card stays `[~]` until then.

Facts come from the Hudson manuals in PCEHeroTN's `docs/datasheets/` (read
there, never copied here).

DeepSeek cards (#ds-flash) need `DEEPSEEK_API_KEY` set before `agents.py` can
start them.

## Next action

`../workshop/board.py next PCEStudio --who design`

