# HuTrack, vendored

Copied from <https://github.com/Turboxray/HuTrack> at commit
`ac598f842b501f35abdbd1548e49967f585b825d` (2026-10-10, "Codex/hutrack audit
(#21)"), **MIT** (`LICENSE` kept, Copyright (c) 2023 Turboxray).

HuTrack is the console side of #35: a HuC6280 sound engine and a converter for
DefleMask DMF songs. Dennis's decision (docs/DECISIONS.md, 2026-10-28) is to
vendor it and write our own JS DMF reader/player beside it, comparing the two
numerically.

## Included

- `lib/HuTrack/` — the engine: `HuTrack_lib.asm`, `engine/` (parser, pitch,
  timing, effects, DDA, banks), equates, vars and the generated pitch tables.
- `example/pceas/base_func/` — the generic PCEAS macro/IRQ framework that the
  engine's own PCEAS example uses (startup, IRQ vector hooks, VDC/VCE/timer
  macros). It holds no music, graphics or game code.
- `utils/HuTrackConverter.py` and `utils/support/` — the DMF converter, its
  DMF reader and its exporter.
- `docs/compatibility.md` — HuTrack's legacy-DMF compatibility reference
  (Furnace 0.6.8.3's DMF playback).
- `README.md`, `requirements.txt`, `LICENSE`.

## Left out

- `example/` except `pceas/base_func`: its songs are arrangements of
  commercial game music (Air Zonk, Bonk's Adventure, The Legendary Axe, Aero
  Blasters, SMB3) and its PCM/WAV sample sets. PCEStudio keeps no commercial
  game data. `example/pceas/main` and `assets/` are also out (their song
  table references those songs).
- `test_songs/`, `utils/PCM_SFX/`, `utils/PSG_SFX/`, `docs/huc/` and the rest
  of `docs/`: not needed to read a DMF or build a waveform-song ROM.

## Changes

None. `MANIFEST.sha256` records every vendored source file's sha256; the
PCEAS build was diffed against the upstream clone file by file, and
`tests/check-hutrack.js` re-checks the manifest. Python's `__pycache__/`
(written when the converter's modules are first imported) is generated
output and is deliberately not listed or counted — the `.py` sources it is
built from are listed. To update: replace this folder from a newer commit,
change the hash above, regenerate the manifest.

## Building

The engine needs **PCEAS 4.x**; the repo's external PCEAS is 3.23
(docs/BUILD.md) and cannot assemble it. HuC mainline `54f5c736` (fetched by
`tools/build-huc.sh`; not vendored) builds a 4.x `pceas` from `src/mkit/as`;
the CI/test machine keeps it outside the repo and exposes it as `pceas4`
(see docs/HUTRACK.md).
