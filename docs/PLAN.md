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
- [x] #4 The first retrospective has been run, and `../workshop/RULES.md` has more than one rule — run 2026-10-28 after Phase 1 (software): six Log rows in RETROSPECTIVE.md, RULES.md rule 2 (e100744), read cold by @review and corrected (74fe217) @workshop
  **Left UNREFINED on purpose — you cannot reflect on a project that has not done anything yet.** Refine it when the first phase closes, or after any day that cost more than it should have. It is on the board from day one because a ritual nobody owns is the one that gets skipped in the week it would have mattered, and the rulebook growing is the only reason this method beats just working.

## Phase 1 — A picture on a real PC Engine (the whole chain, once)

### The PCE picture in the browser {refined} !9
- [x] #5 The background renderer draws exactly what the VDC and VCE draw ~M — node tests/check.js reports diff 0 for scene1/2/3 (commit edeea21) @design #ds-pro
  Read the HuC6270 and HuC6260 manuals (see #1's note) before writing a line; PCEHeroTN's sim/ and docs/ show how we learned the VDC. Plain JavaScript, no framework, no emulator code borrowed (keeps the licence ours).
- [x] #6 The renderer test fails on a broken renderer ~S — reviewed by @workshop (Claude, builder was ds-flash): node tests/renderer-mutation.js rerun, baseline diff 0 on 3 scenes, palette-index and tile-row breaks DETECTED with measured counts, blind checker MISSED, no-op NO-OP @workshop +review #ds-flash
  - 2026-10-27 @test: mutation test added: node tests/renderer-mutation.js — 3 dumps diff 0 baseline; palette-index and tile-row breaks both DETECTED with the measured byte count; blind-checker and no-op self-tests pass; what it cannot prove is in tests/README.md
- [x] #38 The review's small fixes ~S — node tests/check-review-fixes.js exits 0 (14 checks); run against the pre-fix tree with the fixes stashed it reports 13 failures, so each fix has a test that failed before it. (1) pce-bg.js batGeometry shift table [5,6,7,7]: MWR 0x30/0x70 now stride 128 words (VDC manual SCREEN table p. H7-9, codes 011/111 = 128 wide); the test renders MWR=0x30, BXR=512 and shows column 64 reading BAT word 192 (blue 36) where the pre-fix stride read word 320 (blue 72). (2) 'CG bit is a no-op' claim removed from docs/RENDERER.md (and pce-bg.js + tools/genroms.py comments): bit 8 is green's top bit; measured 258 of 512 CRAM values have it set and the scenes display 53/16/50 such entries incl. backdrop 0x1FF. (3) check.js reports 'us1: not a picture, skipped (not counted)' (regs CR=0x00, BB off) and PASS counts 10 pictures, not 11; an unlisted background-off dump FAILS (guard exercised in a temp tree). (4) pce-rom.js throws 'words 32752..32784 run past the 32768-word VRAM' for a straddling tile region; a region ending exactly at 32768 builds, wholly-past regions are still dropped; tools/genviewer.py refuses the same input; pre-fix builder emitted the truncated 40960-byte ROM silently. (5) docs/RENDERER.md cites the Hudson manuals by file with pages: VDC MWR R09 H7-8, SCREEN H7-9, BAT 2.3.2 H7-14, CG 2.3.3 H7-15, BXR/BYR H7-7, scroll H7-13; VCE 2.2.1 H6-4, 2.2.2 H6-5. Suite still green: check.js 10/10 diff 0, check-export, check-us-card, check-viewer, check-editor, renderer-mutation. Test written by @design - flagged for @review cold. @design #ds-flash
- [x] #39 The renderer test catches every break the review found ~M — node tests/renderer-mutation.js exits 0: baseline diff 0 on all 12 scenes; all ten REVIEW.md break rows (eleven mutations — BXR has two variants) DETECTED with the measured byte counts: wmask31, widths64, height32, strideCode3 (the #38 break), ch800, bxr8, bxr9, byr8, vdw1, cr0, green3 — nine on the standard captures, vdw1 on scene5b, ch800 on a synthetic witness dump (a report that does not match the measured per-scene diff counts as CRASH, not DETECTED; blind-checker MISSED and no-op NO-OP self-tests hold). New Mednafen captures: scene4 (64-wide BAT, BXR=256), scene5 (128-wide SCREEN code 3, BXR=1000), scene6 (64-row, BYR=400), scene7 (128x64 two-bank), scene8/8b/8c (BG off: CR=0x00, DCR set/clear, burst on/off — all 59392 px CRAM[0x100], the CR models diff-0 proof), scene9 (odd BAT cols read ch>=0x800 and show CRAM[0x000]: the VDC drops those writes), scene5b (crop shifted 2 lines, SLSTART=6: vdwLine0=3, which catches vdw1; the save scanline itself is pinned at 254 for any SLEEP, measured 8.5-9.5 s). check.js now 19 pictures diff 0 (us1 skipped); check-review-fixes gains the CR-model guards and expects 19. NOT proven: the exporters two-bank ROM path (pce-rom.js/viewer.asm) is still only exercised by 32x32 viewer captures; ch800s detection is on a synthetic 65536-word VRAM because no real state can hold data past word 32767 (scene9 proves the rule itself, the synthetic dump proves the checker catches its removal). @test #ds-pro @test #ds-pro

### The viewer ROM {refined} !9
- [x] #7 The PCE assembler builds a ROM here ~S — PCEAS 3.23 (52a556a, uli/huc) built from source and installed at ~/.local/bin/pceas; make -C tools builds tools/hello.pce (8192 bytes, sha256 9be7ead2...); Mednafen 1.32.1 shows a solid red screen, docs/hello-mednafen.png is 256x232 with every pixel RGB (252,0,0); install/build steps in docs/BUILD.md @design #ds-flash
- [?] #8 A 6280 viewer shows a picture from data at fixed places ~M — Close condition (unchanged): viewer.asm loads 16 palettes into the VCE, tiles and the BAT into VRAM, sets the VDC to 256x224 and shows them; with #5's sample data it looks the same in Mednafen as in the browser renderer, and on the Tang Nano with PCEHeroTN (photo in docs/). PARKED 2026-10-28 so #9 could start (Dennis directed #9; one @design story in progress): Mednafen part proven and committed (756e3b3) - node tests/check-viewer.js exits 0, viewer1/2/3 frame diff 0 vs the #5 renderer, captured VRAM/CRAM/VDC registers match the scene dumps. Only the Tang Nano photo is left (Dennis's part): flash tools/gen/viewer1.pce with openFPGALoader -b tangnano20k --external-flash -o 0x400000 and photograph it into docs/. Reopen when the photo exists. @design #ds-pro
  - 2026-10-28 @design: Mednafen part proven: node tests/check-viewer.js exits 0 - viewer1/2/3 frames diff 0 vs the renderer (card #5's pixel reference) and the captured VRAM/CRAM/VDC registers match the scene dumps. Card stays [~] for the Tang Nano photo (Dennis's part): flash tools/gen/viewer1.pce with 'openFPGALoader -b tangnano20k --external-flash -o 0x400000' and photograph it. The data layout for #9 is in docs/ROM_LAYOUT.md.
  The bank layout of the data goes in docs/ROM_LAYOUT.md: #9 depends on it.

### A .pce file out of the browser {refined} !8
- [x] #9 The browser glues the viewer and the picture into a .pce ~S — reviewed by @workshop (Claude, builder ds-flash): node tests/check-export.js rerun, 3 scenes byte-equal to PCEAS; ROM built from vram/cram/regs/regions, only the constant viewer bank0 is the PCEAS binary @workshop +review #ds-flash
- [?] #25 The export also writes a TurboGrafx HuCard image ~S — PARKED 2026-10-28 so #38 could start (design session, one ticket). The bit-reversal code and its test are committed (aed018b): node tests/check-us-card.js, 3 scenes byte-for-byte the bit-reverse of the .pce against an independent bit loop, shown to fail on the un-reversed image and a one-byte error; the browser checkbox writes pictureN-us.pce. What is left is not code: no emulator can confirm a US HuCard (Mednafen 1.32.1 shows us1 blank, huc.cpp has no region mode), so the close evidence is Dennis's hardware check of tools/gen/us1.pce (sha256 b9a7524eb16830b8...) on a TurboGrafx-16 or its flash cart, with a photo in docs/. Reopen when the photo exists. @design #ds-flash
  - 2026-10-28 @design: SOFTWARE DONE (card stays [~] for the TurboGrafx photo). The page has a TurboGrafx HuCard (US) checkbox (?us=1 opens it ticked, no click needed); it offers the same picture as pictureN-us.pce. The whole transform is reverseBits() in renderer/pce-rom.js - every byte's bits reversed. The .pce path is unchanged: tests/check-export.js, check.js and check-viewer.js still pass.
  - 2026-10-28 @design: PROOF - node tests/check-us-card.js exits 0: scenes 1/2/3, 40960 bytes each, every byte the bit-reverse of the .pce (3,511 / 5,546 / 10,429 bytes differ; sha256 b9a7524e... / 097fbd25... / 8a3d67db...). It measures against an independent bit loop, checks reversing back returns the .pce, requires the image to differ (0x00/0xff are self-reverse), loads the browser-global branch, and shows the comparison fails on the un-reversed .pce and on a one-byte error. The real page reports the same bytes headlessly with ?scene=scene1&us=1. Written by @design - flagged for @review to read cold.
  - 2026-10-28 @design: FILE FOR DENNIS - tools/gen/us1.pce, 40960 bytes, sha256 b9a7524eb16830b8253403916dac5fccb7c7c826302f0de540fff674dbf30df6 (rebuild: node tests/check-us-card.js --write 1). Run on a TurboGrafx-16 or its flash cart and photograph into docs/.
  - 2026-10-28 @design: MEASURED LIMIT - the emulator part cannot pass. Mednafen 1.32.1 shows us1 blank: 256x232, one colour (252,252,252) in all 59,392 pixels vs 120 colours for scene1 (tests/dumps/us1/). Its source agrees: src/pce/huc.cpp HuC_Load copies the file into ROM unchanged and neither pce.cpp nor Documentation/pce.html has a US/region mode, so Mednafen 1.32.1 has nothing that detects a US-encoded image.
  - 2026-10-28 @design: UNVERIFIED PREMISE (reasoning, not read) - no source here supports 'US HuCards swap the data lines' (Hudson manuals are JP, Mednafen has no region path, the schematic PDF is image-only). I expect a TG16 and a PC Engine share the HuCard bus, so a normal .pce would run on both and this one on neither. If the normal .pce runs on Dennis's TG16, #25's premise is wrong and needs re-specifying - his photo settles it.

### A first editor {refined} !7
- [x] #10 Paint tiles, choose palettes from the 512 colours, paint the background map ~L — renderer/editor.html + renderer/pce-editor.js: paint tiles, choose palette colours from the 512, paint the 32x32 BAT; preview drawn by pce-bg.js, export by pce-rom.js (#9). node tests/check-editor.js exits 0: 12/12 refusals with their codes (a 17th colour in a tile=17th-colour, a 17th palette=17th-palette, a 17th colour in a palette, not-in-palette, past VRAM); a 256x224 picture painted from scratch through the editor's calls (896 visible cells, 133 tiles, 6 palettes) whose pixels recomputed from the editor model equal pce-bg.js drawing it; the exported ROM (40960 B, sha256 670001f5... ) carries exactly the editor's config/palettes/BAT/tiles; tests/dumps/painted (Mednafen capture of that ROM) has the editor's VRAM/CRAM/regs and its frame diff 0 against the editor's picture; check.js now 11 dumps diff 0; the real page headlessly reports the same bytes and 3/3 refusals (?demo=1&rules=1). Test written by @design - flagged for @review cold. @design #ds-flash
  - 2026-10-28 @design: editor = renderer/editor.html + renderer/pce-editor.js (the picture kept in the VDC's shape: 16 palettes of 16, 4-bit pixels, shared backdrop, 32x32 BAT; preview drawn by pce-bg.js, export by pce-rom.js). Refuses with codes: 17th-colour (pixel 16+/palette entry 16), 17th-palette (16), not-in-palette, vram-range, tile-space. Limits: no scroll editing, one BAT size, no sprite palettes; page mouse handlers read, not executed. The check test was written by @design - flagged for @review to read cold (same as #5/#8/#9).
  - 2026-10-28 @design: Found while running the suite: tests/renderer-mutation.js had been CRASHing since #8/#9/#25, before this card - it took every dumps/ dir with a mednafen.png but only parses sceneN: lines. Restricted to the sceneN dumps its header documents; node tests/renderer-mutation.js passes again (PASS, 3 dumps). That is a change to @test's file - for @review with #11.
- [x] #11 Phase 1 read cold ~M — docs/REVIEW.md lists 12 ranked findings for #5-#10 and what was not checked; top: check.js stays green with BAT width 64/128, MWR bit 6, BXR/BYR high bits and the Y calibration broken (measured, 9 of 10 mutants undetected); pce-bg.js SCREEN code 3 stride bug; CG-bit claim wrong; us1 counted as a diff-0 picture; pce-rom.js emits a truncated region without error; no hardware or second-emulator evidence @review #sonnet
  - 2026-10-27 @workshop: From #5's acceptance (@workshop): docs/RENDERER.md cites the Hudson manuals by name but without page numbers, and no scene uses a 64-row BAT (MWR bit 6); both for this review.

## Phase 2 — The PC Engine's own tricks (docs/SPEC.md, "PC Engine tricks")

### Sprites {refined} !8
- [~] #12 Sprites in the renderer: 16x16 to 32x64, 16 sprite palettes, priority, at most 16 sprites and 256 pixels a line ~M — renderer/pce-sprites.js draws the SATB as the VDC does: 64 entries, sizes 16x16 to 32x64, X/Y flips, 16 sprite palettes (VCE 0x100+), priority against the BG and between sprites, at most 16 sprites a line (the rest dropped, in SATB order); our own test ROMs cover each size, both flips, both priorities and a 17-sprite line, captured from Mednafen the command-line way, diff 0 on every capture; then a different seat () breaks it per RULES.md rule 2 and the test catches every break it finds @design #ds-pro
  - 2026-10-28 @design: renderer/pce-sprites.js done — SATB 64 entries, 16x16..32x64 (CGX/CGY), X/Y flips, 16 sprite palettes at 0x100+, BG/sprite priority (SPBG, BG colour-0 test), 16 strips a line in SATB order, strips paint in reverse SAT order. The model's central trap, settled from four agreeing sources (VDC manual SG layout, Mednafen vdc.cpp FetchSpriteData, MiSTer huc6270.vhd, MagicKit sprites.inc): a sprite's pattern addresses a 64-WORD VRAM cell at pattern*64 (word2 bit 0 is the CG bit, so addr>>6, not >>5); genroms.py had packed at 32-word cells and every sprite was invisible in BOTH cores until repacked. 8 test ROMs (tools/genroms.py scenes sprite1-8) cover each size, both flips, both priorities and a 17-sprite line; all captured the Mednafen command-line way (capture.sh + mcs-extract.py, now also writing sat.bin), all diff 0. check.js: 27 pictures pass, and every sprite-free dump must also render identically through pce-sprites.js (regression net). Mednafen SAT/SG mirror mismatches 0/256 and 0/6400-word all resolve. Suite green: check.js, check-review-fixes.js, renderer-mutation.js (all 10 breaks DETECTED), check-export, check-us-card, check-editor, check-viewer. Test written by @design — flagged for @review to read cold. The close condition's "a different seat () breaks it" names no seat — messaged @you to route it.
- [?] #13 A sprite editor and the SATB in the export ~M @design #ds-flash
- [ ] #14 The viewer loads the sprites (SATB DMA) ~S — viewer.asm loads a SATB and starts the VDC's SATB DMA each frame (DCR/SATB registers, Hudson VDC manual pages cited); the browser export carries it (docs/ROM_LAYOUT.md updated); for #12's sprite scenes the viewer's Mednafen frame equals the renderer's, diff 0 @workshop #ds-pro
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

