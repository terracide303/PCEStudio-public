# The studio — ppu.toys' layout, mapped to the PC Engine (#75, both halves)

**Decision.** Dennis, 2026-10-28 (`docs/DECISIONS.md`): "look as much as possible to ppu toys". The studio
page follows ppu.toys' Studio in layout, panels, workflow, keyboard shortcuts and how examples and docs sit
beside the code, so someone who knows ppu.toys feels at home. The same day he added: "we can take whatever
from their website if needed, they are fine with that" — so where adapting their CSS or page structure is
quicker than rebuilding it, this page does, with the credit below.

**Split, and where it ended.** The first half was layout + run + panels ([`renderer/studio.html`](
../renderer/studio.html)). This second half adds #61's generated reference as the studio's Docs panel, adapts
ppu.toys' stylesheet and docs layout, and wires the export button to its honest `needs #31` message. A toy
`.pce` still waits for the compiler; the static-picture export was already proven in the editor.

---

## 0. What is taken from ppu.toys, and under what licence

ppu.toys is **MIT, Copyright (c) 2026 Liora Labs**. Its served files are not in the public repository, but
Dennis's 2026-10-28 update allows taking them with credit. The credit comment is at the top of
[`renderer/studio.html`](../renderer/studio.html); this table is the full list.

| ppu.toys source (URL) | what was adapted | where it lives |
|---|---|---|
| `https://ppu.toys/assets/App-6Y57MjOu.css` | the design tokens (`--bg`, `--panel`, `--panel2`, `--editor`, `--line`, `--txt`, `--orange`, the IBM Plex / Pixelify Sans font stacks, radii, 50 px toolbar), and the rules for the toolbar, file tabs, dock tabs, buttons, chips, layout menu, settings panel, scrollbars, and the docs page (hero, kicker, search box, chapter map, sticky TOC, chapter cards, tables, code blocks) | the `<style>` in `renderer/studio.html`, plus `DOCS_IFRAME_CSS` injected into the docs panel's iframe |
| `https://ppu.toys/docs` | the docs page's region order — kicker → big display title → intro → search → two-column chapter map (numbered) → sticky chapter nav → chapter cards — and the search-filter behaviour | the docs panel's injected markup and script in `renderer/studio.html` |
| `https://ppu.toys/studio` | the region layout, panel strip, toolbar order, transport/scrubber and shortcuts that this page mirrors (the study in §2–§5); no markup is copied from this page, the CSS above is the shared source | `renderer/studio.html`; this document |
| `https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=Pixelify+Sans:wght@600&display=swap` | the font families and loading URL ppu.toys uses (Google Fonts, not a ppu.toys file) | `<link>` in `studio.html` and in the docs iframe; system-font fallbacks keep the page usable offline |

**No ppu.toys JavaScript is used.** The Studio's served bundle
(`https://ppu.toys/assets/App-DUnSytDh.js`) was read to learn the shortcut table and the panel/menu wording
(§5); the studio's own script is ours. Their brand chip-mark SVG and their icons are not taken, so the page
does not wear their identity. The MIT notice stays with the adapted CSS:

> ppu.toys — MIT License, Copyright (c) 2026 Liora Labs. The design tokens, component styles and docs layout
> in `renderer/studio.html` are adapted from ppu.toys' served stylesheet, with the selectors renamed to this
> page's. The written permission is Dennis's to keep (`docs/DECISIONS.md`, 2026-10-28).

The files were fetched read-only on 2026-10-28; nothing from the site is vendored in the repo.

---

## 1. How the site was studied

Headless Google Chrome, 2026-10-28, no synthetic input (command line only):

```sh
CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
"$CHROME" --headless=new --disable-gpu --screenshot=… --window-size=1600,1000 \
          --virtual-time-budget=15000 <url>
```

Pages opened: `/` (the landing page), `/studio`, `/browse`, `/docs`, `/t/21r85bod` (Star Patrol 7) and
`/t/21r85bod/play`. The served Studio's shortcuts were read from its own script bundle because the Studio UI
itself is not in the public repository; the docs page was read for the controller-key mapping and the Docs
panel's structure. Every screenshot lives under `$TMPDIR/pcestudio-design-75/`, never in the repo.

Side-by-side evidence (each 3200×1034: theirs left, ours right):

| file under `$TMPDIR/pcestudio-design-75/` | theirs | ours |
|---|---|---|
| `side-by-side-studio.png` | `https://ppu.toys/studio`, 1600×1000 | `renderer/studio.html?demo=palette&frame=30`, 1600×1000 |
| `side-by-side-docs.png` | `https://ppu.toys/docs`, 1600×1000 | `renderer/studio.html?demo=palette&frame=30&docs=1`, 1600×1000 |
| `side-by-side-toy.png` | `https://ppu.toys/t/21r85bod`, 1600×1000 | `renderer/studio.html?demo=raster&frame=30&panel=scanlines`, 1600×1000 |
| `theirs-root.png`, `theirs-studio.png`, `theirs-browse.png`, `theirs-docs.png`, `theirs-toy.png`, `theirs-toy-play.png` | the reference captures | — |
| `ours-studio.png`, `ours-studio-raster.png`, `ours-studio-palettes.png` | — | the studio at the same size |
| `ours-studio-docs.png` | — | the Docs panel at `?docs=1` (hero, search, chapter map) |
| `ours-studio-docs-registers.png` | — | the Docs panel at `?docs=registers` (chapter + sticky TOC) |

The measured geometry below is from those PNGs at 1600×1000, so the regions are comparable pixel for
pixel, not eyeballed at another scale.

---

## 2. The layout, region by region

### 2.1 Top bar — 0…49 px, full width

| column | ppu.toys | `studio.html` |
|---|---|---|
| left | purple chip mark, `ppu.toys` | our tile mark, `PCE·studio` in Pixelify Sans (links to `renderer/index.html`) |
| title | `untitled toy` + `saved in this browser` | `palette-cycle.lua` + `saved in this browser` / `edited — Run to apply` |
| right | Export to ROM (orange), Raw output, Panels ▾, gear, Docs, Save file, Open…, Sign in to publish | Run, Check, Export… (orange), Panels ▾, gear, Docs, Save file, Open…, not signed in |

Measured: both bars are 0…49 with a 1 px border at y=49. The orange primary action is the export in both;
ours opens the honest `needs #31` dialog (§9). `Docs` opens the in-studio Docs panel (§4); `not signed in` is
where ppu.toys puts its account menu.

### 2.2 Left column: code above, panels below — x = 0…980 (61.25 %)

The column splits at x=980 in both captures. The left workspace is two rows:

| row | measured (ours / theirs) | contents |
|---|---|---|
| code tabs | 50…78 / 50…79 | `CODE` and `ASSETS`; active tab is the editor colour, like their dock tab |
| file bar | 80…114 / 80…114 | one file tab `main.lua` (orange underline when active), `+`; right: `plain keys · Lua 5.3` (theirs: `vim off · Lua 5.4`) |
| editor | 116…470 / 116…471 | line-number gutter + source; ours is a plain `<textarea>` with a synchronised gutter, theirs a CodeMirror editor with an active-line highlight |
| dock tabs | 472…500 / 473…501 | the model panels (§3), mono 11 px with 0.1 em tracking |
| dock head | 502…528 / 502…528 | panel title, one-line gloss, `Guide`, current line (`line 0 · full frame`) |
| dock body | 530…1000 / 530…1000 | the active panel; ppu.toys has a tool row above the body, ours puts the controls in each panel |

The row boundary lands on the same scanline (472/473) in both captures: ours is `44.3fr / 55.7fr` of the
workspace, and the code rows use ppu.toys' 30 px tab strip + 36 px file strip.

### 2.3 Right column: output — x = 980…1600 (38.75 %)

| row | measured (ours / theirs) | contents |
|---|---|---|
| OUTPUT header | 50…78 / 50…79 | the word `OUTPUT`; theirs also has a close X |
| live-output row | 80…118 / 80…120 | `LIVE OUTPUT`, `Layers`, and right-aligned `CRT`, `SND`, `256×224` |
| canvas | 120…609 / 122…596 | the 256×224 frame scaled by `object-fit: contain` in a black inset; ours adds 10 px padding |
| transport | 611…648 / 598…616 | play/pause (orange 26 px, like their `.play-btn`), stop, −1, +1, `t=0.50s · frame 30 · 0fps`, then `Lua` / `IL` (theirs: `Lua` / `Cart`) |
| scrubber | 649…677 / 624…712 | frame slider; `Length 300 frames` (theirs: 30 s) |
| bottom tabs | 679…704 / 715…743 | `MARKERS` / `AGENT` |
| bottom body | 706…1000 / 744…1000 | marker list / the agent's "not connected" panel |

The big picture is the same in both: the picture owns the top half of the right column, a transport and a
scrubber sit under it, and a secondary drawer (markers/agent) fills the bottom. Our canvas is ~13 px deeper
and our scrubber row is much shorter than their timeline block, so our drawer starts higher (706 vs 744).

**Where ours deliberately differs.** No account/publishing controls (there is no backend); `Run` and
`Check` are visible because our editor applies an edit with `Run` and `Check` runs the determinism / Lua-IL
comparison; the dock has eight PCE panels rather than eleven SNES panels (§3); `Lua / IL` replaces
`Lua / Cart` because the compiler's IR exists (#31) and machine code does not; `Length` is frames because our
toy clock is `t = f/60` and a seek replays deterministically.

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

A panel's **`Guide`** button opens the Docs panel at that panel's chapter: SCREEN → registers, VRAM → the
toy, PALETTES → palettes, SPRITES → sprites, AUDIO → sound, SCANLINES → raster, REGISTERS → registers,
CONSOLE → budgets.

---

## 4. The Docs panel (the generated #61 reference)

The top-bar **`Docs`** button (and `?docs=<chapter>`) opens a full-width panel under the top bar:

* **The content is #61's reference, not prose written here.** `renderer/pce-docs.js` builds the reference
  from the runtime's own tables; `renderer/docs.html` is its generated page. The studio calls
  `PCEStudio.docs.html(PCEStudio.docs.reference())` at load and puts that exact output in the panel's
  iframe, so the studio's docs and the standalone page cannot disagree. `tests/check-studio.js` asserts the
  panel's source is byte-equal to `renderer/docs.html` and that all ten chapters are present.
* **The presentation follows ppu.toys' `/docs`**: a `THE FIELD GUIDE` kicker over a large Pixelify Sans
  title, a `SEARCH THE GUIDE` box, a numbered two-column chapter map, then a sticky chapter nav and the
  chapter cards with tables and code blocks (the adapted rules are listed in §0). Search filters chapters
  and the nav live.
* **The chapter nav** (The toy, Registers, Palettes and colour, Sprites and the SAT, Raster, Pads,
  Passwords, Sound, Budgets, Refusals) is generated from `docs.html`'s own sections. `Open standalone`
  opens `renderer/docs.html` in a new tab for a full-width read; `×` closes the panel.
* A screenshot of the landing is `ours-studio-docs.png`; one scrolled to a chapter is
  `ours-studio-docs-registers.png`; the comparison with ppu.toys' `/docs` is `side-by-side-docs.png`.

---

## 5. Controls and shortcuts

### 5.1 What ppu.toys does (observed in the served bundle and its docs page)

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

### 5.2 What `studio.html` does

| key / control | action |
|---|---|
| Space (output focused) | play / pause |
| R (output focused) | restart from frame 0 and play |
| Ctrl/Cmd + Enter | compile the source and run (same as `Run`) |
| Ctrl/Cmd + . / , | step one frame forward / back (pauses, then seeks) |
| Ctrl/Cmd + S | download `main.lua` (the browser also keeps the source in `localStorage`) |
| Tab | insert two spaces in the editor |
| Escape | close the panels/settings/open popovers, the export dialog and the Docs panel |
| IJKL, N/M, O, P (output focused) | 2-button pad 1: D-pad, I, II, Select, Run (the PCE pad; multitap pads 2–5 are in the runtime but not on the keyboard) |
| transport | play/pause, stop, −1, +1, frame slider, `Length` in frames |
| `CRT` | scanline overlay on the canvas |
| `SND` | says where sound is (#71); no invented control |
| `Lua` / `IL` | switch the runtime: Fengari Lua 5.3, or the IL interpreter over the same toy host (#31) |
| `Markers` | add a marker at the current frame; click a marker to seek |
| `Panels ▾` | show/hide workspace regions and chip panels; `Reset to default` |
| `Docs` | open the #61 reference as the Docs panel (§4), at the active panel's chapter via `Guide` |
| Docs search | filter the reference's chapters and chapter nav by text |

Not implemented from the reference, deliberately: Vim keys (Settings says so rather than silently ignoring
them), the poke undo/redo (our panels are read-only), and the SNES `hdma()` shortcut vocabulary (the PCE's
per-line mechanism is `raster(line)` and the RCR interrupt).

---

## 6. How a toy is run

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
  a seek lands on exactly the state the live run had (the runtime is deterministic; `t` is not a wall
  clock). This is why the studio can offer a timeline without a snapshot format.
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

## 7. How a toy is edited

`main.lua` is one textarea with a line-number gutter, Tab inserts two spaces, and the source is saved in
`localStorage` on every edit (`saved in this browser`); `Save file` downloads it as `.lua`. `ASSETS` is
present as a region and honestly empty: the toy surface writes its own tiles with `vram[]`/`pal()` and the
PNG importer + `dma()` placement are later cards. `Open…` lists the three built-in examples and accepts a
`.lua` file. There is no multi-file toy, no CodeMirror, and no Vim; those are visible differences in the
file bar (`plain keys`) rather than hidden omissions.

---

## 8. How a toy is checked

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

## 9. How a toy is exported — it needs #31

ppu.toys has `Export to ROM` (and a `Cart` mode) because a SNES toy compiles to a cartridge. PCEStudio's toy
compiler is **#31**: the IL half exists and runs the same examples, but there is no machine-code backend or
toy ROM builder yet. The `Export…` button is wired to a dialog titled **`Export .pce — NEEDS #31`** that
says exactly that, and points at the separate path that *is* proven: the editor paints
VRAM/CRAM/registers and `Download .pce` builds a byte-exact ROM (`docs/EXPORT.md`, cards #9/#16). No button
claims a file it cannot make.

---

## 10. How examples and docs are reached

* **Examples.** ppu.toys has a `/browse` gallery and `Fork` on a toy's page. Ours ships the three toys the
  IL test and the Lua test both run — `palette-cycle.lua`, `raster-bands.lua`, `sprite-pad.lua` — in the
  `Open…` menu, and `?demo=<id>` opens one directly. `tests/check-studio.js` asserts the page's strings are
  the exact strings `tests/check-il.js` defines, so "the example in the studio" and "the toy in the
  evidence" cannot drift. A gallery, publishing and accounts need a backend and are not here.
* **Docs.** ppu.toys has a 15-chapter field guide at `/docs`, reached from the top bar and from each
  panel's `Guide`. Ours has the same two entries: the top-bar `Docs` button and each dock panel's `Guide`
  open the #61 reference in the Docs panel (§4); `Open standalone` opens `renderer/docs.html`. The
  reference is generated from the model, so it cannot drift from the code.

---

## 11. Evidence

### 11.1 The page, in a stub DOM

`node tests/check-studio.js` (written by `@design`; flagged for `@review` cold, rule 2):

```
PASS  374 checks, 40 frames diff 0 vs check-toys' expected state, Lua == IL for 3 examples,
      every button's handler executed (62 buttons) (… ms)
```

What it does, in order:

1. Executes `renderer/studio.html`'s declared scripts (Fengari, the model, the toy host, the Lua and IL
   runtimes, the #26 panels, the editor/PSG/docs modules) and its inline script in a stub DOM (no jsdom;
   the `check-editor.js`/`check-toys.js` pattern), then asserts `PCEStudio.studio`, three examples, eight
   panels, and that `pce-panels.js`/`pce-il.js`/`pce-toys.js`/`pce-docs.js` are the ones loaded.
2. Asserts the page's three example sources are byte-equal to the strings `tests/check-il.js` defines
   (read from its source, so requiring the check cannot run its suite) — the same three toys
   `tests/check-toys.js` runs.
3. **Checks the Docs panel**: the panel's source is byte-equal to `renderer/docs.html` (the #61 generator's
   output); the injected page contains all ten chapters, ppu.toys' search, chapter map and `THE FIELD GUIDE`
   kicker; the top-bar button opens it, `×` closes it, `Guide` lands on the right chapter, `?docs=sprites`
   opens it on load, and the `Export…` dialog names #31.
4. Runs **40 frames** through the page's `runFrames()` and compares every frame with the hand-built
   expected state copied from `tests/check-toys.js` — vram, cram, sat, BXR/BYR/MWR/CR and pixels — diff 0
   on all 40, frame numbers and 256×224 dimensions intact; a second 40-frame run is byte-identical.
5. Runs the same 40 frames through the page's Lua/IL switch for all three examples: state, raster table and
   pixels equal, so the IL path is exercised through the studio, not just imported.
6. Clicks **every button** the page builds (62 at this revision: top bar, Docs/close/Guide, code tabs, dock
   tabs, transport, layers/CRT/SND, markers, settings, open, export, and every dynamically built panel-menu
   and example entry), asserts each has a click handler and none throws; then exercises the source box,
   scrubber and length control, and shows `Check` uses the source box's edited text (not the example on
   disk) and keeps that edit. The stub checks are named, so a page that stopped building a dock or menu
   fails the count rather than passing vacuously.
7. The stub is not a browser: layout, CSS, a real canvas and iframe rendering are stubbed. It proves
   handlers, state and the docs pipeline, not appearance.

### 11.2 The real browser

`node tests/check-studio.js --browser` loads the real page in headless Google Chrome twice:

```
browser: PASS 40 frames · palette · frame 39 · 256x224 · pixels 172032 · digest f45fd1c2
browser docs: docs-panel open, #61 reference + ppu.toys layout
PASS  379 checks, … every button's handler executed (62 buttons), headless Chrome says PASS 40 (… ms)
```

The first run is `?selftest=1&frames=40&example=palette`: the page runs 40 frames, and FNV-1a digest of
frame 39's pixels and state must equal the digest computed here from check-toys' hand-built expected state —
a diff-0 claim on the browser's final frame, not just "the page booted". The second is
`?docs=sprites&paused=1`: the DOM must show the Docs panel open (no `hidden`), the docs iframe present, and
the generated reference with ppu.toys' search and chapter map.

### 11.3 Screenshots

The pairs are under `$TMPDIR/pcestudio-design-75/` (§1). `side-by-side-studio.png` puts our Studio beside
theirs at the same 1600×1000: the column split lands at x=980, the code rows on the same scanlines
(50/80/116), the dock tab strip on the same scanline (472/473), and the output header/transport/scrubber in
the same order. `side-by-side-docs.png` puts their `/docs` beside our Docs panel: the same `THE FIELD
GUIDE` kicker, display-font hero, search box, numbered two-column chapter map and chapter cards, with our
chapters being the PC Engine's. `side-by-side-toy.png` puts a running toy beside ours running the raster
example. `ours-studio-docs-registers.png` shows the chapter view with the sticky TOC. Nothing from their
page's files is included in the repo; the CSS is adapted into `studio.html` under the credit in §0.

---

## 12. Not proven, and what comes next

* **One viewport only.** 1600×1000 is measured; there is a `max-width: 900px` fallback but no screenshot or
  test at another size, and no touch layout.
* **A real canvas's pixels are not diffed against a golden page capture.** The headless run proves the page
  boots, runs and its frame digest matches; the panels' text, the canvas and the docs panel are judged by
  the screenshots, not by a golden pixel comparison.
* **The docs panel's search is not typed into by a test.** Its markup and the generated chapters are
  checked in the stub and the real DOM; the in-iframe filter is exercised by the screenshots/manual use
  only.
* **The adapted CSS is a visual adaptation, not a port.** The selectors, class names and structure are ours;
  the side-by-sides are the evidence, and no pixel-diff against ppu.toys' page is claimed.
* **No validator.** `Check` is determinism + Lua/IL agreement; cycles, sprites per line and source budgets
  are `#32`/`#61`.
* **No toy export, compiler backend, audio, sequencer, asset import or agent link.** Those are #31, #71
  and #24. `SND`, `ASSETS`, `AUDIO`, the AGENT drawer and the `NEEDS #31` export dialog say so in the page.
* **Panels are read-only.** ppu.toys' panels are editors with pokes and keyframes; ours reads the toy's own
  state. The panel code (#26) already exposes the values an editor would write through.
* **Rule 2.** `tests/check-studio.js` was written by the seat that built the page. A cold break by another
  seat is owed before this closes the card: break the layout, the example list, the frame flow, a panel, a
  button, the docs wiring (remove a chapter, break the raw equality, make the docs button a no-op) and the
  export message, and the check must catch each.
