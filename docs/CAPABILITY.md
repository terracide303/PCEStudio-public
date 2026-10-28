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
| Viewer ROM in a second emulator (ares) | PROVEN | `node tests/check-ares.js`: viewer1/2/3 + painted, 0/59392 pixels differ from the renderer and Mednafen at the 3-bit colour (ares scales 8-bit levels slightly differently; manual page H6-6 missing). Not yet broken by another seat; sprite scenes not covered | #41 — `docs/ARES.md` |
| Viewer ROM in a third emulator (web) | NOT PROVEN | by eye only: Dennis ran `viewer1/2/3.pce` on emulationonline.com, 2026-10-28. Tile layout matches Mednafen on all three; viewer1 and viewer3 colours look the same, but viewer2 shows mint green and purple where Mednafen shows cyan (0,216,216) and blue (0,0,216). Settled by #41: ares shows viewer2's cyan/blue like Mednafen, so the web emulator mixes up colour channels | #8, #41 |
| Viewer ROM on real hardware | NOT PROVEN | not run on a real console: Dennis closed #8 on two emulators (2026-10-28). First real-console check comes with #16 (scanline timing). The list now also carries the two things Mednafen cannot settle: B4 (REVIEW-16's byte order inside a register write pair — the emulator latches the bytes independently) and the frame-counter/two-CRAM-word step, whose second write the pristine handler lands one pixel late (measured; `docs/REVIEW-16.md` #68 appendix) | #8, #16, #68 |
| Browser `.pce` export | PROVEN | `node tests/check-export.js`: 3 scenes byte-equal to PCEAS | #9 — `renderer/pce-rom.js` |
| ROMs past 80 KB (MPR banks) | PROVEN | `node tests/check-export.js`: 16 scenes byte-equal to PCEAS incl. a >80 KB picture; the cap is the HuCard's 1 MB (128 banks), not the CPU's 2 MB; exactly 1 MB passes the guard, 1 MB + 1 bank is refused `rom-too-big` (#57) | #46, #57 |
| TurboGrafx (bit-reversed) export | NOT PROVEN | `node tests/check-us-card.js` passes; no TurboGrafx-16 here to run it on | #25 |
| Editor (tiles, palettes, map) | PROVEN | `node tests/check-editor.js`: 12/12 background refusals (21/21 with #13's sprite refusals), painted picture diff 0 in Mednafen | #10 — `renderer/editor.html` |
| Phase 1 read cold | PROVEN | `docs/REVIEW.md`, 12 findings, all fixed by #38/#39 | #11 |

## Phase 2 — The PC Engine's own tricks

| Part | Status | How we know | Where |
|---|---|---|---|
| Sprites in the renderer | PROVEN | `node tests/check.js`: 11 sprite scenes diff 0; breaker's 24 mutants all detected | #12, #40 — `renderer/pce-sprites.js` |
| Viewer loads sprites (SATB DMA) | PROVEN | `node tests/check-viewer.js`: 17 captures (viewer1-3, browser1-3, vsprite1-11) diff 0 against the renderer, VRAM/CRAM/SATB equal the scene dumps; vsprite3's missing red half (found by Dennis) fixed. Breaker: 16 of 19 caught; the gaps closed by #42 (A2 and the bank remap now caught) | #14, #42 |
| Sprite editor + SATB in export | PROVEN | `node tests/check-editor.js`: 21/21 refusals, a sprite picture painted through the editor exported and captured in Mednafen (`tests/dumps/spainted`) diff 0 | #13 |
| Effect editor (gradient, wobble, parallax) | PROVEN | `node tests/check-editor.js`: the three effects give the hand-computed raster table and the renderer previews it; refusals with codes. Export waits for #16. Breaker running | #17 |
| Display window and border (renderer) | PROVEN | `node tests/check.js`: scenes 11-14 (224 lines, shifted, narrow with border, short VDW) diff 0 incl. every border pixel; viewer/editor half → #67 | #48 |
| VRAM-to-VRAM DMA | PROVEN | `node tests/check-dma.js`: 3 Mednafen captures (forward, decrementing, overlapping) match the model's VRAM word for word, frames diff 0 | #49 |
| VDC status flags (overflow, collision, VBlank) | PROVEN | `node tests/check-status.js`: 82 checks on 70 dumps, computed independently from the SAT and patterns; Mednafen is the only witness | #50 |
| VRAM-to-VRAM DMA (SOUR/DESR/LENR, DCR) | PROVEN (Mednafen only) | `node tests/check-dma.js`: 3 Mednafen captures — forward, decrementing, overlapping — the model's VRAM equals the capture **word for word** (32768/32768), post-transfer SOUR/DESR/LENR and the DVC-gated DV bit equal the save state, and the frame rendered from the base picture + descriptor is diff 0; `check.js` is 75 pictures incl. dma1-3. The overlapping capture also rules out a memmove copy (448 words). Not proven: the overrun rule (sources disagree; unreachable in these ROMs), the upper 32K words, real hardware; picture-configured DMA in the viewer/editor is the split card | #49 — `renderer/pce-vram.js` |
| Debug panels and follow a pixel | PROVEN | `node tests/check-panels.js`: 36592 checks and 1320 follow-a-pixel traces on eight dumps against an independent bytes-only computation. Breaker (REVIEW-26): 20 of 25 caught; the five misses — VCE RGB, SAT X/Y, 32-wide cells, row-0 `vdc` block, second-plane `tileWord` — are now caught by #56 (each re-run DETECTED). Not proven: the eight dumps carry no flipped sprite and no SPBG=0 sprite over an opaque background | #26, #56 |
| Scanline effects in the renderer | PROVEN | `node tests/check.js`: raster1-5 (status bar, BXR wobble, BYR split, colour gradient, CR on/off) diff 0 against Mednafen, 47 pictures in all (46 when #15 closed; #13 added spainted). Not proven: VCE writes mid-line, real-hardware IRQ latency. DeepSeek did this Opus card. Breaker: 16 of 20 caught; #43 closed the 3 misses with raster6-10, structured pictures where each effect is visible | #15 — `docs/RENDERER.md` |
| Scanline effects in the viewer (RCR) | PROVEN | Mednafen: `node tests/check.js` and `check-viewer.js` incl. vraster1-11 diff 0 against the renderer. Breaker (REVIEW-16): 17 breaks, 14 caught, 2 misses, 1 no-op; #68 closes the two misses — B14 by a VDC trace from reset (first RCR match 0x42 vs 0x41, with a committed control the check must reject) and B15 by raster11/vraster11 (frame counter + two CRAM words — `cram entry 496: table 11 != state 0`), and gives B9/B16/B17 loud witnesses (49,938 / 101,874 / 381 bytes vs 350 / 0 / 5). B4 stays NO-OP on the emulator: both bytes land before the line boundary and Mednafen latches them independently — on the real-console list with #16. Not yet: the ares re-capture (needs an unlocked screen), one real-console run (Dennis), and the measured one-pixel-late second write of a counter table, which a visible fixture cannot pass | #16, #68 — `docs/REVIEW-16.md` |
| Wide modes in the renderer (256/341/512-dot frames) | PROVEN (Mednafen only) | `node tests/check.js`: `wide336` (341x232) and `wide512` (512x232) diff 0, plus all 77 earlier pictures; the frame's width comes from the saved VCE CR (DCC bits 1-0) and the window's line/alignment from the same clock; Mednafen is the only witness (no second emulator, no console). Builder's mutants (width 256, one line length, one alignment, sprite clip at 256, DCC as bit 0) each fail the run; a cold break by another seat is owed. | #27 — `renderer/pce-bg.js`, `pce-sprites.js`, `tools/genroms.py` |
| Wide modes in the viewer and the editor | UNTESTED | | #70 |

## Phases 3–6

| Part | Status | How we know | Where |
|---|---|---|---|
| Toys live in the browser (Lua via Fengari) | PROVEN | `node tests/check-toys.js`: 718 checks — 3 toys × 40 frames byte-equal to hand-built state and diff 0 through the model; refusals by code; ppu.toys' ramps.lua/kit.lua adapted with credit. Breaker: 9 of 14 → #74; password cap bug → #73 | #30 |
| The IL (Lua subset → our typed IL, reference interpreter) | PROVEN (against the Lua runtime) | `node tests/check-il.js`: 973 checks — the three #30 toys through Lua → IL → interpreter give byte-equal vram/cram/sat/regs, identical raster tables and diff-0 pixels to the Fengari run for 40 frames each; the hooks and instruction set asserted; 11 host refusals and 20 IL refusals by code. Not yet broken by another seat | #31 — `renderer/pce-il.js`, `docs/IL.md` |
| The compiler to the console, part A: IL → C → llvm-mos → Mednafen | PROVEN (one toy, Mednafen only) | `node tests/check-il-console.js`: 47 checks — #30's palette toy through the IL → C (`renderer/pce-cgen.js`) → llvm-mos → an 8 KiB ROM; the ROM rebuilds byte-identically (sha256 c6296524…); of 149 recorded frames the last 8 are diff 0 in order against the browser's frames 5..12 with exactly one alignment; vram/cram/sat byte-equal at the aligned frame and BXR/BYR/MWR equal (CR differs only in the VBlank-status bit 3); measured with the TMA timer at 7.243 ticks × 1024 = **7,417 cycles/frame** (~6.2% of a 60 Hz frame), used .text 2,725 B + .rodata 10 B of the bank. Eight cgen-* refusals by code. NOT proven: any other toy, `raster()`, sprites, pads; the HuC/direct routes and their comparison; recursion, repeated closure sites, real hardware; rule 2 cold break owed | #31 part A — `renderer/pce-cgen.js`, `tools/toyc/`, `docs/IL.md` §9 |
| The compiler to the console, parts B–D (HuC, `raster()`, the route comparison) | UNTESTED | | #31, next parts |
| The checker (frame time, budgets) | UNTESTED | | #32, #33 |
| Sound chip (PSG) in the browser | PROVEN (against Mednafen) | `node tests/check-psg.js`: 11 Mednafen recordings (tone, chord, balance, volume, noise, all three LFO modes via wave3, DDA, 12-bit frequency, R7 on ch3, DDA exit) matched sample for sample. `node tests/psg-mutation.js`: all 15 of REVIEW-34's breaks DETECTED (M10 by check-wave.js/wave3), control NO-OP. Noise generator: Mednafen and MAME's c6280 use the same LFSR taps (two emulators); real console unmeasured | #34, #63 — `docs/PSG.md` |
| Wave editor (32-step waves, 6 channels) | PROVEN | `node tests/check-wave.js`: 3 patches exported byte-equal to PCEAS and recorded in Mednafen, sample for sample | #62 |
| Music (Furnace → HuTrack) | PROVEN | console: `check-hutrack.js` (HuTrack plays our DMF in Mednafen); browser: `check-dmf.js` (same notes, not sample-exact); export: `check-export-song.js` (song + HuTrack byte-identical to PCEAS, 2 songs). Breaker: 10 of 13, the 3 misses closed by #72. Effects/DDA/SFX → #71 | #35 |
| AI link (MCP server, describe-it) | UNTESTED | | #36, #24 |
| Photo import, data export, public release | UNTESTED | | #18–#20, #37 |
