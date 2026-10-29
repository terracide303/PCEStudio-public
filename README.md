# PCEStudio

Make PC Engine pictures in the browser, by the real hardware rules, and run them on a real PC Engine

Worked with the [agent-workshop](../workshop/README.md) method by Dennis Shaw:
one ticket per session, evidence required to close, and the rules in
[`../workshop/RULES.md`](../workshop/RULES.md).

- **`RESUME_HERE.md`** — the live state. Read it first.
- **`docs/PLAN.md`** — the board.

## Licence

PCEStudio's own code is free software under the **GNU General Public License, version 3 or (at your option)
any later version** (`LICENSE`), Dennis, 2026-10-29.

- `renderer/pce-psg.js` is derived from **Mednafen**'s PSG core (`src/pce_fast/psg.cpp`, GPL-2.0-or-later) and
  **Blip_Buffer** 0.4.1 (LGPL-2.1-or-later, Shay Green), which is why the project is GPL; credit and line-level
  notes are in that file.
- Code under `vendor/` keeps its own licence (see each folder's notice): Fengari, CodeMirror, HuTrack and the
  parts taken from ppu.toys (Liora Labs) are MIT; HuC's licence is mixed and unsettled, so the repository carries
  no copy of HuC — `tools/build-huc.sh` downloads HuC mainline (the pinned commit) and builds it as an external
  tool for the IL→C comparison (`docs/BUILD.md`).
- The idea comes from ppu.toys, with its author's blessing (`docs/DECISIONS.md`).
