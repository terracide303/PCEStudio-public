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
| Background (VDC + VCE): tiles, map, scroll, 512 colours | PROVEN | `tests/check.js`: every picture diff 0 against Mednafen; failed on purpose on a broken renderer (#6); `renderer-mutation.js` catches the review's 10 breaks | #5, #6, #38, #39 |
| Sprites: 64, sizes 16x16-32x64, 16 palettes, priority, 16 per line | PROVEN | `check.js` sprite scenes; breaker 24/24 after #40; `check-viewer.js` | #12, #40, #42 |
| Scanline effects (raster table: scroll, layers, colours per line) | PROVEN | `check.js` raster1-13 diff 0, effects visible; breaker gaps closed; the two-CRAM-word step's last store finishes in the blank (~78 cycles) — `check.js` and `check-viewer.js` diff 0 on raster12, the old handler leaves 6,285 bytes different (#69) | #15, #43, #68, #69 |
| Display window and border (224/240 lines, narrow windows) | PROVEN | `check.js` scenes 11-14, every border pixel | #48, #67 |
| Wide screens 256 / 341 / 512 px | PROVEN | `check.js` wide336, wide512, wide512b | #27, #70, #76 |
| VRAM-to-VRAM copy (DMA) | PROVEN | `check-dma.js` 5 captures word for word | #49, #76 |
| Status flags: sprite overflow, collision, VBlank | PROVEN | `check-status.js`: 79 saved states register-for-register and 30 read-cleared (the four toy captures' runtimes poll and clear SR), with the sprite overflow/collision/VBlank conditions on the captured scenes | #50, #76, #108 |
| Flicker: more than 16 sprites on a line | PARTIAL | viewer + renderer proven (`check.js` flicker, 4 frames); the editor/toy option is still to do | #28 |
| Sound chip (PSG): 6 voices, noise, LFO, samples (DDA) | PROVEN | `check-psg.js` 11 recordings sample for sample; `psg-mutation.js` 15/15. Derived from Mednafen, so the project is GPL-3.0 | #34, #63 |
| Second emulator agrees (ares) | PARTIAL | pictures 1-3 + painted proven (`check-ares.js`); the newer ROMs need a re-capture with the screen unlocked | #41 |
| Real PC Engine | WAITING | Dennis: one run of `tools/gen/vraster5.pce` on the PC Engine or MiSTer | #16 |
| TurboGrafx (US) image | NOT PROVEN | bit-reversed export passes `check-us-card.js`; no TurboGrafx here | #25 |

## 2. Making things in the browser — the studio

| Part | Status | How we know | Where |
|---|---|---|---|
| Studio page laid out like ppu.toys, online at pcestudio.terracides.com | PROVEN | `check-studio.js --browser`; screenshots compared by @workshop | #75 |
| Code editor (CodeMirror), files, save/open, autosave, Vim, shortcuts | PROVEN | `check-studio.js` 1,162 checks | #77 |
| Output column: layers, CRT, sound, markers, timeline, pad keys (IJKL) | PROVEN | `check-studio.js`; breaker gaps closed by #91 | #78 |
| Panels in separate files (so several can be built at once) | PROVEN | `check-studio.js` 1,162 checks; ten `renderer/studio-panel-<name>.js` modules through one registry (docs/STUDIO.md §3.2) | #102 |
| SCREEN panel: map editor with tools, zoom, tiles, palette | PROVEN | tools, zoom, map, tile sheet, curves, map-size and width dropdowns; breaker gaps closed by #106 | #84, #102 |
| PALETTES and VRAM panels (512-colour picker, VRAM sheet) | PROVEN | `check-studio.js`: the 512-colour picker edits a 9-bit entry, the VRAM panel is a drawn map; palettes.json only | #85 |
| SPRITES panel (64 sprites, sizes, patterns) | PROVEN | `check-studio.js` (102 checks for this panel): SAT slots, six pattern tools, per-sprite size, park/clear/release; board lists #86 as needs-checking (a different seat's break is owed) | #86 |
| SCANLINES panel (bands on the line interrupt) | PROVEN | `check-studio.js` `checkScanlinesPanel` (467 lines): Add band splits 0-31/32-223; Apply to toy writes the fenced raster block and the runtime's own table matches line for line; the drawn frame equals the preview pixel for pixel; three register writes and three colour words are refused by code; a band's cost (64/123, 52%) matches `check-validate.js`'s blank budget. Board lists #92 as needs-checking (rule 2 owed), and the side-by-side screenshot with ppu.toys is not proven | #92 |
| REGISTERS panel (every register, bit by bit, editable) | PROVEN | `check-pokes.js` 145 checks: every register row and bit, keyframed overrides, undo/redo, written back into the toy | #79 |
| LAYERS panel (stacking, priority, palette fades) | RUNNING | a seat is building it now | #93 |
| AUDIO panel (the 6 voices live) | PROVEN | `check-studio.js` `checkAudioPanel` (+134 checks): each control driven twice — AL 31→10 is R4 $9F→$8A and the meter's -31.61 dB matches the rendered PCM; R5 $F0 is heard left and not right; A4 = F 254, C4 = F 428; noise is refused on voice 1; DDA sets R4 bit 6; a broken waves.json is refused, not overwritten; a running toy's writes arrive through `audioLive()`. Board lists #97 as done; rule 2 is owed, DDA holds one level (#71), and the AudioContext path is not exercised headlessly | #97 |
| CONSOLE panel ("can this run on a real PC Engine?") | PROVEN | `check-studio.js` `checkConsolePanel`: the palette example is green with a measured ROM size; `reg("NOPE",0)` on line 4 is red with range and C-emitter findings, and the `main.lua:4` link moves the editor cursor there; a 20,000-iteration frame is red on the frame budget. Board lists #98 as done; rule 2 is owed, and the numbers are the validator's static model, not a Mednafen/ares capture | #98 |
| ASSETS: memory bars, sheets, songs, 15 built-in instruments | PROVEN | `check-assets.js` 246 checks: fifteen built-ins play through `pce-psg.js` at their register's pitch, the three bars (VRAM/CGRAM/ARAM) are the toy's measured use, and Add to toy writes `instruments.json`; board lists #99 as done, rule 2 is owed | #99 |
| Details: pceglobals.lua tab, Go to marker, AGENT text and Sign-in, output scaled like ppu.toys' | NOT PROVEN | board lists #87 as done and 31 one-off headless-Chrome checks pass on the served page (globals content, read-only tab, Save guard; the marker select; the agent text and placeholder; the frame box 466.3x408), but no check in `tests/check-studio.js` covers them and rule 2 is owed — a fresh clone cannot rerun those one-off checks | #87 |
| Browse: a gallery of the example toys | TODO | | #80 |
| Debug panels and follow a pixel (the earlier text panels) | PROVEN | `check-panels.js` 49,158 checks; breaker gaps closed | #26, #56 |
| Docs (the reference, generated from the code) | PROVEN | `check-docs.js` | #61 |
| Older separate editors: pictures, sprites, effects (`editor.html`) | PROVEN | `check-editor.js`: painted pictures diff 0 in Mednafen; breaker gaps closed by #52 | #10, #13, #17, #52 |

## 3. Toys — small programs in Lua

| Part | Status | How we know | Where |
|---|---|---|---|
| Toys run live in the browser (`init`, `frame`, `raster`, pads, passwords) | PROVEN | `check-toys.js`; every example shows a visible picture (#90); breaker gaps closed by #82 | #30, #73, #74, #82, #90 |
| Five example toys (parallax, sky, road, status bar, palette cycling) | PROVEN | `check-examples.js` 120 frames each | #29 |
| Sound in toys (a song and sound effects) | PARTIAL | song + SFX through HuTrack's channel hand-off; effects, arpeggio and samples still to do; #111 is open: the toy host's `sfx()` writes R4 = $40 (DDA with the channel-enable bit 7 clear), so `pce-psg.js` renders a constant level, RMS 905 against 5899 for $9F | #71, #111 |
| Pads 1-5 and the timer, browser and console | PROVEN | `check-toys.js` 831 checks; console frame and browser frame 1293 both put the sprite at (154,138); the timer ticks 6.47 a frame, arithmetic 6.473 (tests/dumps/pads) | #45 |
| The IL (our intermediate language) | PROVEN | `check-il.js` 973 checks, Lua == IL | #31 |
| The checker: frame time, sprites per line, memory | PROVEN | `check-validate.js`; breaker gaps closed by #89 | #32 |
| A small game made only in the studio (demo-ready test) | TODO | starts when the panels and sound are in | #88 |
| AI link part 1: an MCP server (an agent writes, runs, checks and exports toys) | PROVEN | `check-mcp.js` 101 checks: a real MCP client over stdio, frame_png, a register poke, validate with file:line, export_pce byte for byte; the board card is still open for rule 2 | #36 |
| AI link part 2: the agent skill with recipes | RUNNING | a seat is building it now | #103 |
| Guide file for chat AIs (paste into Claude) + Download button | PROVEN | `renderer/pcestudio-for-claude.md`, generated from the code; online (#105); `check-guide.js` 151 checks | #105 |
| Paste & Run in the studio | PROVEN | `check-studio.js` 1,162 checks (paste box, dropped files, one undo step); the board lists #107 as needs-checking (a different seat's break is owed) | #107 |

## 4. Getting it onto a console — export to `.pce`

| Part | Status | How we know | Where |
|---|---|---|---|
| The assembler (PCEAS) builds a ROM on this machine | PROVEN | `make -C tools`; hello.pce is a solid red screen in Mednafen (`docs/hello-mednafen.png`); steps in docs/BUILD.md | #7 |
| A viewer ROM draws the picture on the console (Mednafen and ares) | PROVEN | `check-viewer.js` frame diff 0; `check-ares.js` 0 of 59,392 px differ at the 3-bit colour | #8 |
| Pictures (with sprites, effects, wide modes, windows) to `.pce` | PROVEN | `check-export.js` byte-equal to the assembler; `check-viewer.js` diff 0 in Mednafen | #9, #14, #16, #46, #57, #67, #70 |
| The largest legal picture is 108 banks (864 KiB), not the card's 1 MB | PROVEN | `check-export.js` and `check-python-builder.js` build it byte-equal at 108 banks; the 12-bank no-overlap measurement is not asserted by a suite | #58 |
| The Python builder (`tools/genviewer.py`) agrees with the browser builder | PROVEN | `check-python-builder.js`: 9/13/14 regions and the 108-bank fixture byte-equal; G11 and G16 DETECTED when re-broken | #60 |
| Toys to `.pce` via llvm-mos (the yardstick, needs a native install) | PROVEN | `check-il-console.js` 126 checks: 2 toys diff 0 in Mednafen, 7,417 cycles/frame | #31 A/C |
| Toys to `.pce` via HuC (comparison) | PROVEN | `check-il-huc.js`; 14x slower than llvm-mos | #31 B/D |
| Toys to `.pce` in the browser, route 1 (interpreter in the ROM) | PARTIAL | first half proven: the IL as bytecode, interpreted on the console in Mednafen (`check-ilvm.js` 49 checks); the studio's Export button and raster are the second half, and its seat is idle with the card still open | #100 |
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
| Every test suite passes on a fresh clone | PROVEN | `sh tests/all.sh` on a fresh clone (`49e9dfa`, 2026-10-29): 35 PASS, 1 SKIP (check-ares, no screen), 0 FAIL; `check-studio.js` 1,162 checks and #99's `check-assets.js` 246 checks among them | #83, #108, #109 |
| Every new test broken by a different seat (rule 2) | PROVEN | `docs/REVIEW-*.md`; each miss became a card and is closed | rule 2 |
| Every manual read and mapped to a card | PROVEN | `docs/MANUALS.md` | #44, #55 |
| Phase 1 read cold by a reviewer | PROVEN | `docs/REVIEW.md`: 12 ranked findings, each fixed in #38/#39 with a test | #11 |
| Hardware comments in the code match the manuals (256x240, VCE $04, DCR bit 4) | NOT PROVEN | corrected in #38; #51 is marked needs-checking on the board | #51 |
| The survey, the outcome statement and the rulebook are written down | PROVEN | `docs/SURVEY.md`, `docs/SPEC.md`, `docs/PPU-TOYS.md`; `docs/RETROSPECTIVE.md` six Log rows and RULES.md rule 2 | #1, #2, #4, #53 |
| The skill the survey would add is installed and confirmed loaded | TODO | #1 found no existing skill to install; revisit when a PCE lesson has been paid for | #3 |
| check.js stops judging an animated toy capture as a still picture | PROVEN | the by-name skip carries its reason (palette-huc, parallax-huc, toypalette-ilvm, toyparallax-ilvm) and the unlisted-dump guard still fails a toy copy as a pixel diff; those frames are judged by `check-il-huc.js`/`check-ilvm.js` | #81, #108 |
| The suites are green again after a big card lands | PROVEN | #64's claim holds on today's fresh clone: `check-review-fixes` and `renderer-mutation` green, 34 PASS / 0 FAIL | #64, #108 |
| Phase 3 read cold by a reviewer | TODO | | #33 |
| A recurring progress check keeps this page and the fresh-clone run current | RUNNING | this page and the run above are its output; #109 as a board card is still unrefined | #109 |

## 7. Later — not in the beta

| Part | Status | How we know | Where |
|---|---|---|---|
| AI link part 3: the live link — an agent drives the open studio | LATER | after the beta | #104 |
| Port our ways of working into the public agent-workshop | LATER | after beta 1; the list is `my-workshop/PORT_TO_AGENT_WORKSHOP.md` | #110 |
| Describe it, get it (a sentence becomes a picture) | LATER | | #24 |
| Publish a toy, play other people's, sign in | LATER | needs a server | #37 |
| A photo becomes a PCE picture | LATER | | #18 |
| Raw tiles / HuC include export | LATER | | #19 |
| Public release of the repo | LATER | HuC's licence must be settled first | #20 |
| SuperGrafx, CD-ROM, animation, SF2 mapper, 4-colour modes, level scripts | LATER | | #21, #22, #23, #59, #47, #66 |
