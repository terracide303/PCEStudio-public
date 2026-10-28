# The studio — ppu.toys' layout, mapped to the PC Engine (#75, first half)

**Decision.** Dennis, 2026-10-28 (`docs/DECISIONS.md`): "look as much as possible to ppu toys". The studio
page follows ppu.toys' Studio in layout, panels, workflow, keyboard shortcuts and how examples and docs sit
beside the code, so someone who knows ppu.toys feels at home. The code, CSS, name and content stay ours; the
hosted Studio is **not** in ppu.toys' MIT repository, so nothing below is copied from its files — this is a
study of the live site, and [`renderer/studio.html`](../renderer/studio.html) is our own page.

**Split.** This card is layout + run + panels. The toy reference (#61) and the export wiring are the second
card; the tool declares that in its Export dialog rather than pretending.

---

## 1. How the site was studied

Headless Google Chrome, 2026-10-28, no synthetic input (command line only):

```sh
CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
"$CHROME" --headless=new --disable-gpu --screenshot=… --window-size=1600,1000 \
          --virtual-time-budget=15000 <url>
```

Pages opened: `/` (the landing page), `/studio`, `/browse`, `/docs`, `/t/21r85bod` (Star Patrol 7) and
`/t/21r85bod/play`. The served Studio's shortcuts were read from the page's own script bundle
(`/assets/App-*.js`, fetched read-only) because the Studio UI itself is not in the public repository; the
docs page was read for the controller-key mapping. Every screenshot lives under
`$TMPDIR/pcestudio-design-75/`, never in the repo.

Side-by-side evidence (each 3200×1034: theirs left, ours right):

| file under `$TMPDIR/pcestudio-design-75/` | theirs | ours |
|---|---|---|
| `side-by-side-studio.png` | `https://ppu.toys/studio`, 1600×1000 | `renderer/studio.html?demo=palette&frame=30`, 1600×1000 |
| `side-by-side-toy.png` | `https://ppu.toys/t/21r85bod`, 1600×1000 | `renderer/studio.html?demo=raster&frame=30&panel=scanlines`, 1600×1000 |
| `theirs-root.png`, `theirs-studio.png`, `theirs-browse.png`, `theirs-docs.png`, `theirs-toy.png`, `theirs-toy-play.png` | the reference captures | — |
| `ours-studio.png`, `ours-studio-raster.png`, `ours-studio-palettes.png` | — | our page at the same size |

The measured geometry below is from those PNGs at 1600×1000, so the regions are comparable pixel for
pixel, not eyeballed at another scale.

---

## 2. The layout, region by region

### 2.1 Top bar — 0…50 px, full width

| column | ppu.toys | `studio.html` |
|---|---|---|
| left | purple tile mark, `ppu.toys` | our tile mark, `PCE·studio` (links to `renderer/index.html`) |
| title | `untitled toy` + `saved in this browser` | `palette-cycle.lua` + `saved in this browser` / `edited — Run to apply` |
| right | Export to ROM (orange), Raw output, Panels ▾, gear, Docs, Save file, Open…, Sign in to publish | Run, Check, Export… (orange), Panels ▾, gear, Docs, Save file, Open…, not signed in |

Measured: theirs ends at y=49 and ours at y=51 (1 px border each; ours is 2 px taller). The orange primary
action is the export in both; ours is disabled by content, not by a grey button — it opens the honest export
dialog (§8). `Docs` is a link to this document; `not signed in` is where ppu.toys puts its account menu.

### 2.2 Left column: code above, panels below — x = 0…980 (61.25 %)

The column splits at x=980 in both captures. The left workspace is two rows:

| row | measured (ours / theirs) | contents |
|---|---|---|
| code tabs | 52…74 / 50…79 | `CODE` and `ASSETS`; ours highlights with an orange underline |
| file bar | 76…104 / 80…114 | one file tab `main.lua`, `+`; right: `plain keys · Lua 5.3` (theirs: `vim off · Lua 5.4`) |
| editor | 106…471 / 116…471 | line-number gutter + source; ours is a plain `<textarea>` with a synchronised gutter, theirs a CodeMirror editor |
| dock tabs | 473…498 / 473…501 | the model panels (§3) |
| dock head | 500…526 / 502…528 | panel title, one-line gloss, `Guide`, current line (`line 0 · full frame`) |
| dock body | 528…1000 / 530…1000 | the active panel; ppu.toys has a tool row above the body, ours puts the controls in each panel |

The row boundary lands on the same scanline (473) in both captures after measuring: ours is
`44.3fr / 55.7fr` of the workspace. A returning reader sees the same proportions: roughly one editor screen
above, one panel screen below.

### 2.3 Right column: output — x = 980…1600 (38.75 %)

| row | measured (ours / theirs) | contents |
|---|---|---|
| OUTPUT header | 52…77 / 50…79 | the word `OUTPUT`; theirs also has a close X |
| live-output row | 79…107 / 80…120 | `LIVE OUTPUT`, `Layers`, and right-aligned `CRT`, `SND`, `256×224` |
| canvas | 109…600 / 122…596 | the 256×224 frame scaled by `object-fit: contain` in a black inset; ours adds 10 px padding |
| transport | 601…632 / 598…616 | play/pause, stop, −1, +1, `t=0.50s · frame 30 · 0fps`, then `Lua` / `IL` (theirs: `Lua` / `Cart`) |
| scrubber | 633…666 / 624…712 | frame slider; `Length 300 frames` (theirs: 30 s) |
| bottom tabs | 667…692 / 715…743 | `MARKERS` / `AGENT` |
| bottom body | 694…1000 / 744…1000 | marker list / the agent's "not connected" panel |

The big picture is the same in both: the picture owns the top half of the right column, a transport and a
scrubber sit under it, and a secondary drawer (markers/agent) fills the bottom.

**Where ours deliberately differs.** No account/publishing controls (there is no backend); `Run` and
`Check` are visible because our editor applies an edit with `Run` (the toy recompiles then) and `Check`
runs the determinism / Lua-IL comparison, which the reference's Studio toolbar has no button for; the dock
has eight PCE panels rather than eleven SNES panels (§3); `Lua / IL` replaces `Lua / Cart` because the
compiler's IR exists (#31) and machine code does not; and `Length` is frames because our toy clock is
`t = f/60` and a seek replays deterministically.

---

## 3. The panels, and their PCE counterparts

ppu.toys' Studio panel strip: Backgrounds, VRAM, CGRAM, Sprites, Audio, Sequencer, Compose, Windows,
Scanlines, Registers, SNES. Ours keeps the strip's place and shape and gives each a PC Engine answer:

| ppu.toys panel | `studio.html` tab | what it shows | source |
|---|---|---|---|
| Backgrounds | **SCREEN** | VDW line, BXR/BYR/CR/BG_YOffset, BAT size from MWR, frame; click the output to follow a pixel (layer, BAT word, char, palette, tile row/col, or sprite) | `pce-panels.js` `lineValues`, `followPixel` |
| VRAM | **VRAM** | all 32768 words as a map: BAT, tiles, sprite patterns, SAT at `$7F00`, free space; segment table | `pce-panels.js` `vramMap` |
| CGRAM | **PALETTES** | the VCE's 512 colours as 32 palettes of 16; entry 0 dashed (the shared backdrop); each swatch's tooltip is its CRAM address and 9-bit word | `pce-panels.js` `vcePalettes` |
| Sprites | **SPRITES** | the 64-entry SAT: Y, X, pattern, palette, size, SPBG/flips, the 64-word cells | `pce-panels.js` `satTable` |
| Audio | **AUDIO** | the honest state: `pce-psg.js` exists and is checked; toys have no sound surface yet (#71) | — |
| Sequencer | *(none yet)* | the tracker lives in `renderer/pce-hutrack.js`; a toy-facing sequencer is a later card | — |
| Compose | *(none)* | **no PCE counterpart**: the HuC6270 has one background layer plus sprites and the HuC6260 has no sub-screen, colour math or blending | — |
| Windows | *(none)* | **no PCE counterpart**: the VDC has no window/mask registers. Per-line `CR` (display on/blank) and `BXR/BYR` are the closest thing, and they sit in SCANLINES | — |
| Scanlines | **SCANLINES** | one row per VDW line: BXR, BYR, CR, whether the raster table writes this line, and the RCR the chain arms | `pce-panels.js` `registerLines` |
| Registers | **REGISTERS** | all 20 VDC registers (R00–R13) for the followed line, with each value's source, plus the SR conditions | `pce-panels.js` `vdcRegisters`, `status` |
| SNES | **CONSOLE** | the PC Engine frame budget (119,904 CPU cycles), "per-line = RCR, not HDMA", SAT count, the runtime in use, and where the compiler stands (#31) | page |

Every panel except AUDIO, CONSOLE and the absent ones is computed from **the exact objects the renderer is
given** — `runtime.options()` plus `runtime.lastRaster` — through `renderer/pce-panels.js` (card #26). There
is no second copy of the picture: the same panel code the editor uses reads the toy's frame. The panel strip
is hidden/shown from the `Panels ▾` menu, which groups `WORKSPACE` (Editor, Assets, Output, Markers, Agent)
and `THE CHIP` (the eight panels), with `Reset to default`, like ppu.toys' menu.

---

## 4. Controls and shortcuts

### 4.1 What ppu.toys does (observed in the served bundle and its docs page)

| key | action |
|---|---|
| Space | play / pause |
| R | restart |
| Ctrl/Cmd + Enter | play / pause |
| Ctrl/Cmd + . | step one frame forward |
| Ctrl/Cmd + , | step one frame back |
| Ctrl/Cmd + Z / Shift+Z | undo / redo a panel *poke* (a keyframed register override) |
| Ctrl/Cmd + S | save the toy as `.ppu.json` (it also autosaves to the browser) |
| Tab | indent in the editor |
| Escape | close a dialog/popover |
| IJKL, N/M, H/Y, U/O, P | controller while the output has focus: D-pad, B/A, Y/X, L/R, Start |
| — | Vim keybindings are opt-in in Settings; plain editing is the default |

### 4.2 What `studio.html` does

| key / control | action |
|---|---|
| Space (output focused) | play / pause |
| R (output focused) | restart from frame 0 and play |
| Ctrl/Cmd + Enter | compile the source and run (same as `Run`) |
| Ctrl/Cmd + . / , | step one frame forward / back (pauses, then seeks) |
| Ctrl/Cmd + S | download `main.lua` (the browser also keeps the source in `localStorage`) |
| Tab | insert two spaces in the editor |
| Escape | close the panels/settings/open popovers and the export dialog |
| IJKL, N/M, O, P (output focused) | 2-button pad 1: D-pad, I, II, Select, Run (the PCE pad; multitap pads 2–5 are in the runtime but not on the keyboard) |
| transport | play/pause, stop, −1, +1, frame slider, `Length` in frames |
| `CRT` | scanline overlay on the canvas |
| `SND` | says where sound is (#71); no invented control |
| `Lua` / `IL` | switch the runtime: Fengari Lua 5.3, or the IL interpreter over the same toy host (#31) |
| `Markers` | add a marker at the current frame; click a marker to seek |
| `Panels ▾` | show/hide workspace regions and chip panels; `Reset to default` |

Not implemented from the reference, deliberately: Vim keys (Settings says so rather than silently ignoring
them), the poke undo/redo (our panels are read-only in this half), and the SNES `hdma()` shortcut
vocabulary (the PCE's per-line mechanism is `raster(line)` and the RCR interrupt).

---

## 5. How a toy is run

`renderer/studio.html` uses the same runtime the toys page and the tests use (no second VM, no second
renderer):

```js
const rt = PCEStudio.toys.create(source, { budgetMs: 120 });  // or PCEStudio.il, the Lua/IL switch
rt.load();                                                    // top-level + init()
rt.setPad(1, buttons);
const frame = rt.frame(f);                                    // t = f/60, deterministic
frame.pixels                                                  // drawn by pce-sprites.js over pce-bg.js
```

* The live loop is `requestAnimationFrame` with a fixed 1/60 s step, so `frame` is a count and `t` is
  `f/60` — the reference's `frame(t, f)` contract. A slow tab drops steps, never stretches time.
* The scrubber and ±1 **replay from frame 0** on a fresh runtime, using the pad recorded for each frame, so
  a seek lands on exactly the state the live run had (the runtime itself is deterministic; `t` is not a
  wall clock). This is why the studio can offer a timeline without a snapshot format.
* `Lua` runs Fengari; `IL` compiles the same source to PCEStudio's IL and interprets it over the same
  `pce-toyhost.js`, the same registers and the same draw call — the switch exists because the compiler half
  (#31) is real, and it is checked: the test runs 40 frames both ways for all three examples.
* The panels follow each frame through `runtime.options()` and `runtime.lastRaster`, every sixth frame
  while playing and immediately when paused/seeked; a frame's state is never copied into a panel model.

**Where this differs from ppu.toys.** Its toy uses Lua 5.4 (wasmoon) on the SNES PPU; ours is Fengari
(Lua 5.3) over the HuC6270/HuC6260. Its per-line effect is `hdma(y0, y1, fn)` driven by hardware; ours is a
`raster(line)` callback that becomes an RCR interrupt on a console, one entry per line and a cycle budget.
Its `sram` save is cartridge SRAM; ours is a password (`password.pack`) because a bare HuCard has none.

---

## 6. How a toy is edited

`main.lua` is one textarea with a line-number gutter, Tab inserts two spaces, and the source is saved in
`localStorage` on every edit (`saved in this browser`); `Save file` downloads it as `.lua`. `ASSETS` is
present as a region and honestly empty: the toy surface writes its own tiles with `vram[]`/`pal()` and the
PNG importer + `dma()` placement are later cards. `Open…` lists the three built-in examples and accepts a
`.lua` file. There is no multi-file toy, no CodeMirror, and no Vim; those are visible differences in the
top bar (`plain keys`) rather than hidden omissions.

---

## 7. How a toy is checked

`Check` runs the source box's toy through the page's own `runFrames()` (so your edits are checked, not the
example on disk):

1. 40 frames on a fresh Lua runtime;
2. the same 40 frames again — every frame's vram/cram/sat/regs, raster table and pixels must be identical
   (determinism);
3. 40 frames through the IL runtime — same comparison (the PCE counterpart of "Lua vs Cart");
4. the message names the outcome (`Check: 40 frames · Lua deterministic · no refusal · IL == Lua`) and the
   page is left paused at frame 0.

This is **not** ppu.toys' validator: it does not price cycles, count sprites per line or refuse a source
budget. Those are `#32` and the toy reference `#61`; the engine that must eventually enforce them already
owns the frame (`pce-toyhost.js`). The studio's evidence is separate from the button: `tests/check-studio.js`
compares the page's 40 frames with `tests/check-toys.js`' hand-built expected state, not with the page's own
opinion.

---

## 8. How a toy is exported

ppu.toys has `Export to ROM` (and a `Cart` mode) because a SNES toy compiles to a cartridge. PCEStudio's
export is the **second half of this card**: the IL exists (#31) and runs the same examples, but there is no
machine-code backend or toy ROM builder yet. The `Export…` button therefore opens a dialog that says exactly
that and points at the proven static-picture path: the editor paints VRAM/CRAM/registers and
`Download .pce` builds a byte-exact ROM (`docs/EXPORT.md`, cards #9/#16). A toy export will be wired when the
backend exists; no button claims a file it cannot make.

---

## 9. How examples and docs are reached

* **Examples.** ppu.toys has a `/browse` gallery and `Fork` on a toy's page. Ours ships the three toys the
  IL test and the Lua test both run — `palette-cycle.lua`, `raster-bands.lua`, `sprite-pad.lua` — in the
  `Open…` menu, and `?demo=<id>` opens one directly. `tests/check-studio.js` asserts the page's strings are
  the exact strings `tests/check-il.js` defines, so "the example in the studio" and "the toy in the
  evidence" cannot drift. A gallery, publishing and accounts need a backend and are not in this half.
* **Docs.** ppu.toys has a 15-chapter field guide at `/docs`, reached from the top bar and from each
  panel's `Guide`. Ours has the same two entries: the top-bar `Docs` link and each dock panel's `Guide`,
  both pointing at this file. The generated, model-bound toy reference is `#61`; this card does not
  pre-empt it with prose that could drift from the code.

---

## 10. Evidence

### 10.1 The page, in a stub DOM

`node tests/check-studio.js` (written by `@design`; flagged for `@review` cold, rule 2):

```
PASS  351 checks, 40 frames diff 0 vs check-toys' expected state, Lua == IL for 3 examples,
      every button's handler executed (59 buttons) (1022 ms)
```

What it does, in order:

1. Executes `renderer/studio.html`'s declared scripts and inline script in a stub DOM (no jsdom; the
   `check-editor.js`/`check-toys.js` pattern), then asserts `PCEStudio.studio`, three examples, eight
   panels, and that `pce-panels.js`/`pce-il.js`/`pce-toys.js` are the ones loaded.
2. Asserts the page's three example sources are byte-equal to the strings `tests/check-il.js` defines
   (read from its source, so requiring the check cannot run its suite) — the same three toys
   `tests/check-toys.js` runs.
3. Runs **40 frames** through the page's `runFrames()` and compares every frame with the hand-built
   expected state copied from `tests/check-toys.js` — vram, cram, sat, BXR/BYR/MWR/CR and pixels — diff 0
   on all 40, frame numbers and 256×224 dimensions intact; a second 40-frame run is byte-identical.
4. Runs the same 40 frames through the page's Lua/IL switch for all three examples: state, raster table and
   pixels equal, so the IL path is exercised through the studio, not just imported.
5. Clicks **every button** the page builds (59 at this revision: top bar, code tabs, dock tabs, transport,
   layers/CRT/SND, markers, settings, open, export, and every dynamically built panel-menu and example
   entry), asserts each has a click handler and none throws; then exercises the source box, scrubber and
   length control, and shows `Check` uses the source box's edited text (not the example on disk) and keeps
   that edit. The stub checks are named, so a page that stopped building a dock or menu fails the count
   rather than passing vacuously.
6. The stub is not a browser: layout, CSS and a real canvas are stubbed, and the canvas context records
   nothing. It proves handlers and state, not appearance.

### 10.2 The real browser

`node tests/check-studio.js --browser` loads the real page in headless Google Chrome with
`?selftest=1&frames=40&example=palette` and reads the DOM the page writes:

```
browser: PASS 40 frames · palette · frame 39 · 256x224 · pixels 172032 · digest f45fd1c2
PASS  353 checks, … every button's handler executed (59 buttons), headless Chrome says PASS 40 (4583 ms)
```

This is the card's "headless run of studio.html loads an example toy, runs 40 frames". The digest is FNV-1a
over the last frame's pixels and state; the test computes the same digest from check-toys' hand-built
expected state for frame 39 and requires equality, so the browser run is a diff-0 claim on its final frame
too, not just a "the page booted" claim.

### 10.3 Screenshots

The pairs are under `$TMPDIR/pcestudio-design-75/` (§1). `side-by-side-studio.png` puts our Studio beside
theirs at the same 1600×1000: the column split lands at x=980, the dock tab strip on the same scanline
(473), the output header/transport/scrubber stack in the same order. `side-by-side-toy.png` puts a running
toy beside ours running the raster example: their Star Patrol 7 frame on the left, our 256×224 raster bands
with the SCANLINES panel on the right. `ours-studio-palettes.png` shows the PALETTES panel; the reference's
CGRAM panel is its counterpart. Nothing from their page's files is included in the repo.

---

## 11. Not proven, and what comes next

* **One viewport only.** 1600×1000 is measured; there is a `max-width: 900px` fallback but no screenshot or
  test at another size, and no touch layout.
* **A real canvas's pixels are not diffed.** The headless run proves the page boots and runs; the panels'
  text and the canvas are judged by the screenshots, not by a golden pixel comparison (the model's pixels
  are diffed in `check-toys.js`, not the page's CSS pipeline).
* **No validator.** `Check` is determinism + Lua/IL agreement; cycles, sprites per line and source budgets
  are `#32`/`#61`.
* **No export, compiler backend, audio, sequencer, asset import or agent link.** Those are the second half
  of #75, #31, #71, and #24. `SND`, `ASSETS`, `AUDIO` and the AGENT drawer say so in the page.
* **Panels are read-only.** ppu.toys' panels are editors with pokes and keyframes; this half reads the
  toy's own state. The panel code (#26) already exposes the values an editor would write through.
* **Rule 2.** `tests/check-studio.js` was written by the seat that built the page. A cold break by another
  seat is owed before this closes the card: break the layout, the example list, the frame flow, a panel and
  a button, and the check must catch each.

Second card: the toy reference (#61) as the in-page docs, and export wiring when the compiler can produce
a toy ROM.
