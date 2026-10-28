# What works, how we know, and when it was last true

**One row per part. Update it in the same commit that changes the part.** The workshop page's
Progress tab is drawn from these tables.

**Status words:**

- **PROVEN** — measured, with the measurement named.
- **NOT PROVEN** — built, but the check that would prove it cannot be run here (named in the row).
- **WAITING** — built and proven in software; the hardware check waits for Dennis.
- **UNTESTED** — not built yet, or never exercised.

---

## Phase 1 — A picture on a real PC Engine

| Part | Status | How we know | Where |
|---|---|---|---|
| Background renderer (VDC + VCE) | PROVEN | `node tests/check.js`: 30 pictures diff 0 against Mednafen 1.32.1 captures | #5, #38, #39 — `renderer/pce-bg.js` |
| Renderer test catches breaks | PROVEN | `node tests/renderer-mutation.js`: all 10 review breaks detected | #6, #39 |
| PCEAS assembler | PROVEN | `make -C tools` builds `hello.pce` (sha256 9be7ead2…), red screen in Mednafen | #7 — `docs/BUILD.md` |
| Viewer ROM in Mednafen | PROVEN | `node tests/check-viewer.js`: viewer1/2/3 frame diff 0 against the renderer | #8 — `tools/gen/viewer*.pce` |
| Viewer ROM in a second emulator (ares) | UNTESTED | card #41 queued | #41 |
| Viewer ROM in a third emulator (web) | PROVEN | by eye only: Dennis ran `viewer1.pce` on emulationonline.com, 2026-10-28; same tile columns and colours as `tests/dumps/viewer1/mednafen.png` (no pixel diff) | #8 |
| Viewer ROM on real hardware | WAITING | Dennis: real PC Engine + flash cart, MiSTer or Tang Nano; photo into `docs/` | #8 |
| Browser `.pce` export | PROVEN | `node tests/check-export.js`: 3 scenes byte-equal to PCEAS | #9 — `renderer/pce-rom.js` |
| TurboGrafx (bit-reversed) export | NOT PROVEN | `node tests/check-us-card.js` passes; no TurboGrafx-16 here to run it on | #25 |
| Editor (tiles, palettes, map) | PROVEN | `node tests/check-editor.js`: 12/12 refusals, painted picture diff 0 in Mednafen | #10 — `renderer/editor.html` |
| Phase 1 read cold | PROVEN | `docs/REVIEW.md`, 12 findings, all fixed by #38/#39 | #11 |

## Phase 2 — The PC Engine's own tricks

| Part | Status | How we know | Where |
|---|---|---|---|
| Sprites in the renderer | PROVEN | `node tests/check.js`: 11 sprite scenes diff 0; breaker's 24 mutants all detected | #12, #40 — `renderer/pce-sprites.js` |
| Viewer loads sprites (SATB DMA) | UNTESTED | in progress | #14 |
| Sprite editor + SATB in export | UNTESTED | | #13 |
| Scanline scroll and palette changes | UNTESTED | | #15, #16 |
| Wide modes (256/336/512) | UNTESTED | | #27 |

## Phases 3–6

| Part | Status | How we know | Where |
|---|---|---|---|
| Toys as code (Lua, compiler, validator) | UNTESTED | | #30–#33 |
| Sound (PSG) | UNTESTED | | #34, #35 |
| AI link (MCP server, describe-it) | UNTESTED | | #36, #24 |
| Photo import, data export, public release | UNTESTED | | #18–#20, #37 |
