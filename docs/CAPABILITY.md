# Where PCEStudio stands — what works, what is being built, what is left

**One row per thing a user can do or rely on.** The workshop page's Progress tab is drawn from these tables.
Update the row in the same commit as the work. Reorganised 2026-10-29 (Dennis: "make it clearer where we stand
and what needs to be done").

**Status words:**

- **PROVEN** — works, and a named test shows it (in Mednafen, and on a fresh clone).
- **PARTIAL** — part of it works (the row says which part); the rest is the card named.
- **RUNNING** — a seat is building it now.
- **TODO** — on the board, not started.
- **WAITING** — blocked on someone or something outside (named in the row).
- **NOT PROVEN** — built, but the check that would prove it cannot be run here (named in the row).
- **LATER** — an idea card, not part of the beta.

The two milestones Dennis asked for:

- **Alpha** = pictures, sprites, scanline effects, export to `.pce`, on the console.
- **Demo-ready / beta** = a small game can be made in the browser studio alone (#88), and exported to `.pce`
  in the browser with nothing to install (#100).

---

## 1. The PC Engine model — what the browser draws and plays

| Part | Status | How we know | Where |
|---|---|---|---|
| Background (VDC + VCE): tiles, map, scroll, 512 colours | PROVEN | `tests/check.js`: every picture diff 0 against Mednafen; `renderer-mutation.js` catches the review's 10 breaks | #5, #38, #39 |
| Sprites: 64, sizes 16x16-32x64, 16 palettes, priority, 16 per line | PROVEN | `check.js` sprite scenes; breaker 24/24 after #40; `check-viewer.js` | #12, #40, #42 |
| Scanline effects (raster table: scroll, layers, colours per line) | PROVEN | `check.js` raster1-13 diff 0, effects visible; breaker gaps closed | #15, #43, #68 |
| Display window and border (224/240 lines, narrow windows) | PROVEN | `check.js` scenes 11-14, every border pixel | #48, #67 |
| Wide screens 256 / 341 / 512 px | PROVEN | `check.js` wide336, wide512, wide512b | #27, #70, #76 |
| VRAM-to-VRAM copy (DMA) | PROVEN | `check-dma.js` 5 captures word for word | #49, #76 |
| Status flags: sprite overflow, collision, VBlank | PROVEN | `check-status.js` | #50, #76 |
| Flicker: more than 16 sprites on a line | PARTIAL | viewer + renderer proven (`check.js` flicker, 4 frames); the editor/toy option is still to do | #28 |
| Sound chip (PSG): 6 voices, noise, LFO, samples (DDA) | PROVEN | `check-psg.js` 11 recordings sample for sample; `psg-mutation.js` 15/15. Derived from Mednafen, so the project is GPL-3.0 | #34, #63 |
| Second emulator agrees (ares) | PARTIAL | pictures 1-3 + painted proven (`check-ares.js`); the newer ROMs need a re-capture with the screen unlocked | #41 |
| Real PC Engine | WAITING | Dennis: one run of `tools/gen/vraster5.pce` on the PC Engine or MiSTer | #16 |
| TurboGrafx (US) image | NOT PROVEN | bit-reversed export passes `check-us-card.js`; no TurboGrafx here | #25 |

## 2. Making things in the browser — the studio

| Part | Status | How we know | Where |
|---|---|---|---|
| Studio page laid out like ppu.toys, online at pcestudio.terracides.com | PROVEN | `check-studio.js --browser`; screenshots compared by @workshop | #75 |
| Code editor (CodeMirror), files, save/open, autosave, Vim, shortcuts | PROVEN | `check-studio.js` 475 checks | #77 |
| Output column: layers, CRT, sound, markers, timeline, pad keys (IJKL) | PROVEN | `check-studio.js`; breaker gaps closed by #91 | #78 |
| Panels in separate files (so several can be built at once) | RUNNING | | #102 |
| SCREEN panel: map editor with tools, zoom, tiles, palette | PARTIAL | tools, zoom, map and tile sheet work; curves on BXR/BYR and dropdowns for map size and width come with #102 | #84, #102 |
| PALETTES and VRAM panels (512-colour picker, VRAM sheet) | TODO | | #85 |
| SPRITES panel (64 sprites, sizes, patterns) | TODO | | #86 |
| SCANLINES panel (bands on the line interrupt) | TODO | | #92 |
| REGISTERS panel (every register, bit by bit, editable) | TODO | | #79 |
| LAYERS panel (stacking, priority, palette fades) | TODO | | #93 |
| AUDIO panel (the 6 voices live) | TODO | | #97 |
| CONSOLE panel ("can this run on a real PC Engine?") | TODO | | #98 |
| ASSETS: memory bars, sheets, songs, 15 built-in instruments | TODO | | #99 |
| Details: DISPLAY tab, light theme, Raw output, Guide links, Panels menu | TODO | | #87 |
| Browse: a gallery of the example toys | TODO | | #80 |
| Debug panels and follow a pixel (the earlier text panels) | PROVEN | `check-panels.js` 36592 checks; breaker gaps closed | #26, #56 |
| Docs (the reference, generated from the code) | PROVEN | `check-docs.js` | #61 |
| Older separate editors: pictures, sprites, effects (`editor.html`) | PROVEN | `check-editor.js`: painted pictures diff 0 in Mednafen | #10, #13, #17 |

## 3. Toys — small programs in Lua

| Part | Status | How we know | Where |
|---|---|---|---|
| Toys run live in the browser (`init`, `frame`, `raster`, pads, passwords) | PROVEN | `check-toys.js`; every example shows a visible picture (#90) | #30, #73, #74, #90 |
| Five example toys (parallax, sky, road, status bar, palette cycling) | PROVEN | `check-examples.js` 120 frames each | #29 |
| Sound in toys (a song and sound effects) | PARTIAL | song + SFX through HuTrack's channel hand-off; effects, arpeggio and samples still to do | #71 |
| Pads 1-5 and the timer, browser and console | RUNNING | | #45 |
| The IL (our intermediate language) | PROVEN | `check-il.js` 973 checks, Lua == IL | #31 |
| The checker: frame time, sprites per line, memory | PROVEN | `check-validate.js`; breaker gaps closed by #89 | #32 |
| A small game made only in the studio (demo-ready test) | TODO | starts when the panels and sound are in | #88 |

## 4. Getting it onto a console — export to `.pce`

| Part | Status | How we know | Where |
|---|---|---|---|
| Pictures (with sprites, effects, wide modes, windows) to `.pce` | PROVEN | `check-export.js` byte-equal to the assembler; `check-viewer.js` diff 0 in Mednafen | #9, #14, #16, #46, #57, #67, #70 |
| Toys to `.pce` via llvm-mos (the yardstick, needs a native install) | PROVEN | `check-il-console.js`: 2 toys diff 0 in Mednafen, 7,417 cycles/frame | #31 A/C |
| Toys to `.pce` via HuC (comparison) | PROVEN | `check-il-huc.js`; 14x slower than llvm-mos | #31 B/D |
| Toys to `.pce` in the browser, route 1 (interpreter in the ROM) | RUNNING | the beta's export, nothing to install | #100 |
| Toys to `.pce` in the browser, route 2 (our own compiler) | TODO | for speed, after route 1 | #101 |
| Music in the `.pce` (Furnace DMF to HuTrack) | PROVEN | `check-export-song.js`, `check-hutrack.js` | #35 |
| Sound patches to `.pce` (wave editor) | PROVEN | `check-wave.js` | #62 |
| Assembler from the vendored HuC | TODO | | #54 |

## 5. Music

| Part | Status | How we know | Where |
|---|---|---|---|
| Furnace songs (DMF) play in the browser and on the console | PROVEN | `check-dmf.js`, `check-hutrack.js`, `music-mutation.js` | #35, #72 |
| Wave editor (32-step waves, 6 channels) | PROVEN | `check-wave.js` | #62 |
| SEQUENCER in the studio: step grid | TODO | | #94 |
| SEQUENCER: staff view | TODO | | #95 |
| SEQUENCER: songs saved as DMF for HuTrack and Furnace | TODO | | #96 |
| HuVGM as a second music route | WAITING | turboxray's release, or access to his private repo | #65 |

## 6. Quality — how we keep it honest

| Part | Status | How we know | Where |
|---|---|---|---|
| Every test suite passes on a fresh clone | PROVEN | `sh tests/all.sh` on a fresh clone: 28 PASS, ares SKIP | #83 |
| Every new test broken by a different seat (rule 2) | PROVEN | `docs/REVIEW-*.md`; each miss became a card and is closed | rule 2 |
| Every manual read and mapped to a card | PROVEN | `docs/MANUALS.md` | #44, #55 |
| Phase 3 read cold by a reviewer | TODO | | #33 |

## 7. Later — not in the beta

| Part | Status | How we know | Where |
|---|---|---|---|
| AI link: an MCP server and the studio's AGENT panel | LATER | | #36 |
| Describe it, get it (a sentence becomes a picture) | LATER | | #24 |
| Publish a toy, play other people's, sign in | LATER | needs a server | #37 |
| A photo becomes a PCE picture | LATER | | #18 |
| Raw tiles / HuC include export | LATER | | #19 |
| Public release of the repo | LATER | HuC's licence must be settled first | #20 |
| SuperGrafx, CD-ROM, animation, SF2 mapper, 4-colour modes, level scripts | LATER | | #21, #22, #23, #59, #47, #66 |
