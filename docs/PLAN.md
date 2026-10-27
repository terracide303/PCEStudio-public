# Plan — PCEStudio

What it is: [docs/SPEC.md](SPEC.md) — an AI dev studio for the PC Engine / TurboGrafx.

**Phase → Feature → Story. A story closes on evidence, never on opinion.**

```
### A feature, in plain words {refined} !5
- [ ] The story ~M — what closes it @role #model
```

`@role` assigns it (see `../workshop/roles.json`), `#model` is the AI it runs
on (`../workshop/agents.py models`; without it, the role's default), `~M` its
size (XS S M L XL), `!5` on a feature ranks it against the others, and
everything after the dash is the evidence required to tick the box.
`../workshop/agents.py cost PCEStudio` prices what is left. **Unticked and unevidenced are the same thing.** Full reference:
`../workshop/docs/BOARD.md`.

**Every phase ends with a retrospective, and so does every two weeks of work.**
`board.py next` prints RETRO DUE when one is owed; the first comes due on its
own two weeks after this project starts. How: `../workshop/RETROSPECTIVE.md`.

---

## Phase 0 — Know what exists before writing anything

### The ground is surveyed {refined} !9
- [x] #1 What already exists for making PC Engine graphics is found and judged ~S — docs/SURVEY.md surveys 20+ candidates with licences and does/does-not; verdicts: renderer write-own, editor write-own, viewer ROM adapt HuDK (MIT), PCEAS external, Mednafen primary check / ares second / Geargrafx debug; docs/DECISIONS.md records the emulator set and PCEAS licence caveat @scout #ds-flash
  The hardware facts are already ours: the Hudson manuals for the HuC6270 VDC, HuC6260 VCE and HuC6280 are in `/Volumes/External/MiniST_Project/PCEHeroTN/docs/datasheets/` (read them there; never copy them into this repo). Mednafen is installed for checking pictures.
- [?] #3 Anything worth keeping from #1 is INSTALLED AND CONFIRMED LOADED — survey #1 found no existing skill to install; its proposed pce-hardware-limits skill would be written from theory, and skills/README says a skill is earned by a cost. Revisit when a PCEStudio card pays for a PCE lesson (@workshop, 2026-10-27) @workshop
  **A skill that did not load fails silently** — the session works normally and quietly lacks the thing it was added for. So this card does not close on "I installed it"; it closes on a new session listing it. See `../workshop/skills/README.md`.
- [x] #2 The one thing this project must do is written down, with how we will know it works — Dennis, 2026-10-27: "like ppu.toys, an AI dev studio that can port to a real PC Engine / TurboGrafx": make PC Engine pictures in the browser by the real hardware rules, with an AI that helps make them, exported so they run on a real PC Engine and TurboGrafx. It works when a picture made in the studio runs on a real console @you
  Not a feature list. The single outcome that makes it worth doing, and the observation that would prove it.

### The rulebook grows, or none of this was worth setting up
- [?] #4 The first retrospective has been run, and `../workshop/RULES.md` has more than one rule — the five questions in `../workshop/RETROSPECTIVE.md` answered, and whatever they produced landed in RULES.md, CATALOGUE.md, check.sh or skills/ @workshop
  **Left UNREFINED on purpose — you cannot reflect on a project that has not done anything yet.** Refine it when the first phase closes, or after any day that cost more than it should have. It is on the board from day one because a ritual nobody owns is the one that gets skipped in the week it would have mattered, and the rulebook growing is the only reason this method beats just working.

## Phase 1 — A picture on a real PC Engine (the whole chain, once)

### The PCE picture in the browser {refined} !9
- [x] #5 The background renderer draws exactly what the VDC and VCE draw ~M — node tests/check.js reports diff 0 for scene1/2/3 (commit edeea21) @design #ds-pro
  Read the HuC6270 and HuC6260 manuals (see #1's note) before writing a line; PCEHeroTN's sim/ and docs/ show how we learned the VDC. Plain JavaScript, no framework, no emulator code borrowed (keeps the licence ours).
- [x] #6 The renderer test fails on a broken renderer ~S — reviewed by @workshop (Claude, builder was ds-flash): node tests/renderer-mutation.js rerun, baseline diff 0 on 3 scenes, palette-index and tile-row breaks DETECTED with measured counts, blind checker MISSED, no-op NO-OP @workshop +review #ds-flash
  - 2026-10-27 @test: mutation test added: node tests/renderer-mutation.js — 3 dumps diff 0 baseline; palette-index and tile-row breaks both DETECTED with the measured byte count; blind-checker and no-op self-tests pass; what it cannot prove is in tests/README.md

### The viewer ROM {refined} !9
- [x] #7 The PCE assembler builds a ROM here ~S — PCEAS 3.23 (52a556a, uli/huc) built from source and installed at ~/.local/bin/pceas; make -C tools builds tools/hello.pce (8192 bytes, sha256 9be7ead2...); Mednafen 1.32.1 shows a solid red screen, docs/hello-mednafen.png is 256x232 with every pixel RGB (252,0,0); install/build steps in docs/BUILD.md @design #ds-flash
- [ ] #8 A 6280 viewer shows a picture from data at fixed places ~M — viewer.asm loads 16 palettes into the VCE, tiles and the BAT into VRAM, sets the VDC to 256x224 and shows them; with #5's sample data it looks the same in Mednafen as in the browser renderer, and on the Tang Nano with PCEHeroTN (photo in docs/) @design #ds-pro
  The bank layout of the data goes in docs/ROM_LAYOUT.md: #9 depends on it.

### A .pce file out of the browser {refined} !8
- [ ] #9 The browser glues the viewer and the picture into a .pce ~S — for the same data the browser's .pce is byte-for-byte equal to the one PCEAS builds, and it shows the picture in Mednafen @design #ds-flash
- [ ] #25 The export also writes a TurboGrafx HuCard image ~S — a checkbox reverses the bits of every byte (US HuCards swap the data lines); the image is byte-for-byte the bit-reverse of the .pce, and it runs on a TurboGrafx or its flash cart (photo in docs/) @design #ds-flash

### A first editor {refined} !7
- [ ] #10 Paint tiles, choose palettes from the 512 colours, paint the background map ~L — in the browser a 256x224 picture is drawn from scratch, exported with #9, and runs in Mednafen; the editor refuses anything the VDC cannot show (a 17th colour in a tile, a 17th palette) @design #ds-flash
- [ ] #11 Phase 1 read cold ~M — docs/REVIEW.md lists what the evidence does not support, for #5 to #10 @review #sonnet
  - 2026-10-27 @workshop: From #5's acceptance (@workshop): docs/RENDERER.md cites the Hudson manuals by name but without page numbers, and no scene uses a 64-row BAT (MWR bit 6); both for this review.

## Phase 2 — The PC Engine's own tricks (docs/SPEC.md, "PC Engine tricks")

### Sprites !8
- [?] #12 Sprites in the renderer: 16x16 to 32x64, 16 sprite palettes, priority, at most 16 sprites and 256 pixels a line ~M @design #opus
- [?] #13 A sprite editor and the SATB in the export ~M @design #ds-flash
- [?] #14 The viewer loads the sprites (SATB DMA) ~S @design #sonnet
- [?] #28 Flicker multiplexing: more than 16 sprites on a line by rotating the sprite order each frame, with an example toy ~M @design #opus

### Scanline effects (the line interrupt) !8
- [?] #15 The renderer: a scroll and a palette change per scanline ~M @design #opus
- [?] #16 The viewer: the raster table driven by the line interrupt (RCR) ~M @design #opus
- [?] #17 An effect editor: colour gradients, wobble, parallax bands ~M @design #ds-flash
- [?] #29 Example toys for the classics: line-scroll parallax, a sky gradient, a pseudo-3D road, a fixed status bar, palette cycling ~M @design #ds-flash

### The model's panels !6
- [?] #26 The VDC's registers per line, the VCE palettes, the VRAM map, the SATB, and "follow a pixel" ~M @design #ds-flash
- [?] #27 Wide modes: 256, 336 and 512 px (the three dot clocks), in the renderer and the viewer ~M @design #opus

## Phase 3 — Toys as code, compiled for the real thing

### Toys in the browser !7
- [?] #30 A Lua subset runs live: init(), frame(t, f), raster(line), pad[1..5], bram ~L @design #opus

### The compiler and the validator !7
- [?] #31 The toy compiles to HuC6280 code (through PCEAS) and runs the same in Mednafen as in the browser ~L @design #opus
- [?] #32 The validator: frame time at 60 Hz, sprites per line, VRAM and ROM fit, VCE writes in the blank, value ranges; export refuses a toy that fails ~L @design #opus
- [?] #33 Phase 3 read cold ~M @review #sonnet

## Phase 4 — Sound

### The PSG !5
- [?] #34 The PSG in the browser: 6 channels of 32-step 5-bit waves, noise, LFO, DDA samples; matches Mednafen by ear ~L @design #opus
- [?] #35 A wave and sound editor, and sound in toys and exported ROMs ~M @design #ds-flash

## Phase 5 — The AI link

### The studio for agents !6
- [?] #36 An MCP server: an agent reads and sets registers, renders a frame, runs the validator and exports a ROM ~L @design #opus
### The AI in the studio !6
- [?] #24 Describe it, get it: a sentence ("a sunset sky over a scrolling sea") becomes palettes, tiles and scanline effects the PC Engine can really show, in the editor, ready to change by hand ~L @design #opus
  Which AI the page talks to, and how (the user's own key, or Claude through the page), is a decision for Dennis before this is refined.

## Phase 6 — Polish and share
### Photo import !4
- [?] #18 A photo becomes a PCE picture: 16 palettes of 16 chosen, each tile on its best palette ~L @design #opus

### Data for homebrew !3
- [?] #19 Export tiles, palettes and the map as raw files and as a HuC include ~S @design #ds-flash-low

### Public release !5
- [?] #20 PCEStudio goes public: the repo, and the page to use it ~S @you

### Share !3
- [?] #37 Publish a toy and play other people's ~L @design

## Ideas

### Later
- [?] #21 SuperGrafx: two background layers ~L
- [?] #22 A CD-ROM image instead of a HuCard ~L
- [?] #23 Animation: several pictures in one ROM ~M

