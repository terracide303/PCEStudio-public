# ppu.toys's Lua helpers — what PCEStudio took (#30)

**Source:** [github.com/LioraLabs/ppu.toys](https://github.com/LioraLabs/ppu.toys)
at commit `0b077674b7ca656b49420edb14df70bc89d19541` (main, 2026-10-18) — the
same commit studied for `docs/PPU-TOYS.md` (#53). MIT, Copyright (c) 2026 Liora
Labs; `LICENSE` beside this file is copied verbatim.

**What was read:** `crates/ppu-core/src/kit.lua`, `ramps.lua`,
`controls_env.lua` in full, and the `LuaEngine` module comment that says when
each runs.

**What PCEStudio took.** The helpers live in `renderer/pce-toys.js` as the Lua
prelude every toy sees, adapted to the PC Engine, with the MIT notice and this
credit in the file:

| ppu.toys | PCEStudio | why |
|---|---|---|
| `ramps.lua`: `clamp`, `lerp`, `ease`, `ramp`, `ramp_int`, `lerp_color`, `ramp_color` | kept, same names and semantics | portable Lua, used for per-line effects |
| `lerp_color` on 15-bit BGR555 (5-bit channels) | adapted to the VCE's 9-bit word (3-bit G/R/B: `(g<<6)|(r<<3)|b`) | the PCE's colour word is not the SNES's |
| `kit.lua`: note-name parser (`C#4`, `Db4`, MIDI numbers) | kept and adapted | portable parsing; `psg.note()` returns the PCE PSG's 12-bit F instead of an SNES sample pitch (F = 7,159,090 / (64 f), `docs/PSG.md`) |
| `kit.lua`: `instrument`, `sfx`, `voice`, `song`, `bank`, `score` | **not taken** | they encode the SNES S-DSP voice model; PCEStudio's PSG is `renderer/pce-psg.js`, and sound in toys is #71 |
| `controls_env.lua`: the tracked write log (real table, key, old value) replayed backwards to un-bake an override | **pattern only, no code** | its code is proxy machinery for the SNES engine's globals; #30's runtime keeps the same idea in JavaScript (each frame's register/palette writes are journaled per line to build the raster table). #24/#36 are where the reversible-override form is wanted. |

Nothing else was copied. `renderer/pce-toys.js` names the source and the
licence in its header, and the prelude strings are the adapted code.
