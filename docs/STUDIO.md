# The studio — ppu.toys' layout and editor, mapped to the PC Engine (#75, #77)

**Decision.** Dennis, 2026-10-28 (`docs/DECISIONS.md`): "look as much as possible to ppu toys". The studio
page follows ppu.toys' Studio in layout, panels, workflow, keyboard shortcuts and how examples and docs sit
beside the code, so someone who knows ppu.toys feels at home. The same day he added: "we can take whatever
from their website if needed, they are fine with that" — so where adapting their CSS or page structure is
quicker than rebuilding it, this page does, with the credit below.

**Split, and where it ended.** #75 was layout + run + panels, then #61's generated reference as the studio's
Docs panel and the honest `needs #31` export message. **#77 is the editor and the files**: CodeMirror with
Lua highlighting and line numbers replaces the textarea, a toy is a file set beside `main.lua`, Save/Open
use one versioned JSON envelope in ppu.toys' shape, autosave keeps the whole toy in the browser, Vim keys are
opt-in in Settings, and every ppu.toys shortcut with a PCE meaning works. **#78 is the output column** (§2.3):
the Layers controls (BG and sprites gated through CR, plus a view-only mode), the CRT look, SND's honest
state, markers, the scrubber's frame length, the resolution label following the dot clock, and the pad keys
on the focused output. A toy `.pce` still waits for the compiler; the static-picture export was already
proven in the editor.

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

**The editor is the one third-party library this page vendors (#77).** CodeMirror 5.65.16 — MIT,
Copyright (C) 2017 Marijn Haverbeke and others — lives in [`vendor/codemirror/`](../vendor/codemirror/)
with its `LICENSE` and a `README.md` naming the four files (`lib/codemirror.js`, `lib/codemirror.css`,
`mode/lua/lua.js`, `keymap/vim.js`) and the npm package they came from. They are unmodified. The page
loads them only when the document can host CodeMirror (`document.createRange` exists): the Node check's
stub DOM keeps a textarea fallback, and the headless-browser run proves CodeMirror, its Lua mode, its line
numbers and its Vim keymap. CodeMirror is not ppu.toys code and is not covered by their notice.

**The toy file's shape** is adapted from ppu.toys' packed toy (`docs/PPU-TOYS.md` §3 — `{version, title,
description, files: [{name, source}], sources}`); the version is ours (`pce.studio/1`) and the payloads are
text files, not base64 image sources yet. Credit: ppu.toys, MIT, Copyright (c) 2026 Liora Labs.

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

`#78`'s output-column pair is later and lives under `$TMPDIR/pcestudio-design-78/`
(`side-by-side-studio-78.png`, `ours-studio-78.png`; §11.3).

The measured geometry below is from those PNGs at 1600×1000, so the regions are comparable pixel for
pixel, not eyeballed at another scale.

---

## 2. The layout, region by region

### 2.1 Top bar — 0…49 px, full width

| column | ppu.toys | `studio.html` |
|---|---|---|
| left | purple chip mark, `ppu.toys` | our tile mark, `PCE·studio` in Pixelify Sans (links to `renderer/index.html`) |
| title | `untitled toy` + `saved in this browser` | the active file (`main.lua`) + `saved in this browser` / `edited — Run to apply` / `restored from this browser` |
| right | Export to ROM (orange), Raw output, Panels ▾, gear, Docs, Save file, Open…, Sign in to publish | Run, Check, Export… (orange), Panels ▾, gear, Docs, Save file, Open…, not signed in |

Measured: both bars are 0…49 with a 1 px border at y=49. The orange primary action is the export in both;
ours opens the honest `needs #31` dialog (§9). `Docs` opens the in-studio Docs panel (§4); `not signed in` is
where ppu.toys puts its account menu.

### 2.2 Left column: code above, panels below — x = 0…980 (61.25 %)

The column splits at x=980 in both captures. The left workspace is two rows:

| row | measured (ours / theirs) | contents |
|---|---|---|
| code tabs | 50…78 / 50…79 | `CODE` and `ASSETS`; active tab is the editor colour, like their dock tab |
| file bar | 80…114 / 80…114 | one Lua file tab `main.lua` (orange underline when active), plus the asset's tab while one is being edited; `+`; right: `plain keys · Lua 5.3` or `vim on · Lua 5.3` (theirs: `vim off · Lua 5.4`) |
| editor | 116…470 / 116…471 | **CodeMirror 5.65.16** with line numbers, Lua highlighting and the cursor line's highlight — the same editor and the same three visible features as theirs; the plain textarea remains only as the fallback for a DOM that cannot host CodeMirror |
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

**What each output control does (#78).**

| control | behaviour | source |
|---|---|---|
| `Layers` | opens a popover with `BG · background`, `SPR · sprites`, the frame's BAT/CR readout, and `View only` | page |
| `BG` / `SPR` | clears CR bit 7 (BB) / bit 6 (SB) in the live VDC state and redraws — the same bits `pce-bg.js` and `pce-sprites.js` already gate layers on, so the picture is what the hardware would show. Showing a layer again restores the bit the toy set. | `pce-bg.js` CR bit 7, `pce-sprites.js` CR bit 6 |
| `View only` | masks the layer in the picture without writing CR: the toy's state and the panels keep their own values, and the mask stays on across seeks | page |
| `CRT` | toggles the canvas's scanline overlay (`.canvas-wrap.crt::after`, ppu.toys' look in CSS, not a shader) | page CSS |
| `SND` | the honest state: `pce-psg.js` exists and is checked, but toys have no sound surface (#71), so the chip never claims a sound is playing | card #71 |
| resolution | `renderer/pce-bg.js`'s own `DOT_CLOCK` / `frameWidth`: 256 / 341 / 512 dots for VCE CR DCC `00` / `01` / `10` (#27). The live toy host is fixed at 256×224, so it reads `256×224`; the mapping is the renderer's, and the label's tooltip names the dot clock | `pce-bg.js` |
| counter / length | the scrubber's max is `Length − 1`; a seek clamps to it, a shortened length moves the playhead inside it, and playback stops on the last frame | page |
| markers | `Add marker at frame N` records the current frame; each marker is a button that pauses and seeks to it | page |
| pad keys | with the canvas focused: IJKL = D-pad, N/M = I/II, O = Select, P = Run (pad 1). The page-wide Space/R shortcuts do not consume them | page, §5.2 |

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
| Space | play / pause (anywhere outside a text field — typing an R in the editor stays an R) |
| R | restart from frame 0 and play (same rule) |
| Ctrl/Cmd + Enter | compile the editor's text and run (same as `Run`) |
| Ctrl/Cmd + . / , | step one frame forward / back (pauses, then seeks) |
| Ctrl/Cmd + S | save the toy as one `.pce.json` envelope; the browser also keeps it in `localStorage` |
| Tab | insert two spaces in the editor (CodeMirror's `Tab`, and the textarea fallback's) |
| Escape | close the panels/settings/open popovers, the export dialog and the Docs panel |
| IJKL, N/M, O, P (output focused) | 2-button pad 1: D-pad, I, II, Select, Run (the PCE pad; multitap pads 2–5 are in the runtime but not on the keyboard) |
| Settings → Editor keys → Vim | CodeMirror's Vim keymap, off by default and remembered in the browser |
| Settings → Line numbers | CodeMirror's gutter, on by default |
| transport | play/pause, stop, −1, +1, frame slider, `Length` in frames (1…3600) |
| `Layers` → `BG` / `SPR` | hide the background (CR bit 7, BB) or the sprites (CR bit 6, SB) in the live VDC and redraw; the picture is the renderer's own CR gating |
| `Layers` → `View only` | the same toggles without a register write: mask the picture only, leave the toy's state and panels alone |
| `CRT` | scanline overlay on the canvas |
| `SND` | says where sound is (#71); no invented control |
| `Lua` / `IL` | switch the runtime: Fengari Lua 5.3, or the IL interpreter over the same toy host (#31) |
| resolution label | follows the dot clock through `pce-bg.js`: 256 / 341 / 512 dots (VCE CR DCC `00` / `01` / `10`) |
| `Markers` | add a marker at the current frame; click a marker to seek |
| `Panels ▾` | show/hide workspace regions and chip panels; `Reset to default` |
| `Docs` | open the #61 reference as the Docs panel (§4), at the active panel's chapter via `Guide` |
| Docs search | filter the reference's chapters and chapter nav by text |

Every ppu.toys shortcut that has a PCE meaning is implemented. Deliberately not: the poke undo/redo
(our panels are read-only, so there is no poke to undo; CodeMirror's own undo handles edits), and the SNES
`hdma()` shortcut vocabulary (the PCE's per-line mechanism is `raster(line)` and the RCR interrupt).

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

**The editor is CodeMirror** (#77), vendored at 5.65.16 with its MIT notice (`vendor/codemirror/`): Lua
highlighting, line numbers (the `Line numbers` setting), the cursor line's highlight, and Tab/Shift-Tab
indent by two spaces. The plain textarea in the markup is only the fallback for a document that cannot host
CodeMirror; every code path reads the editor through `editorText()`/`setEditorText()`.

**A toy is a file set, not one string.** `main.lua` is the Lua that runs. Beside it are the four asset files
ppu.toys keeps beside its Lua:

| file | shape | what it is |
|---|---|---|
| `tiles.json` | `{version, tiles: [{char, palette, pixels}]}` | 8×8 tiles, 4-bit colour numbers, keyed by VCHAR |
| `palettes.json` | `{version, backdrop, background[][] , sprites[][]}` | the VCE's 32 palettes of 16 words |
| `sprites.json` | `{version, sprites: [{x, y, pattern, palette, …}]}` | the SAT |
| `waves.json` | `{version, channels: [{wave[32], freq, al, balance}]}` | the PSG's channels |

The shapes follow `renderer/pce-editor.js`'s picture and `renderer/pce-wave.js`'s document. The importer
that feeds them to a running toy is #24/#71; this card makes them first-class, editable files that are saved
and autosaved with the toy. A toy still writes its own VRAM/CRAM with `vram[]`/`pal()` today, and the
`ASSETS` tab says so rather than implying an importer exists. Clicking `Edit` in `ASSETS` opens that file in
the editor; editing an asset never changes the Lua that Run compiles.

**Save and Open are one JSON envelope**, in ppu.toys' packed-toy shape (`docs/PPU-TOYS.md` §3, credited):

```json
{ "version": "pce.studio/1", "title": "palette-cycle", "description": "…",
  "files": [ { "name": "main.lua", "source": "…" },
             { "name": "tiles.json", "source": "…" } ],
  "sources": [] }
```

`Save file` / Ctrl+S downloads `<title>.pce.json`; `Open… → From file…` accepts that envelope, or a plain
`.lua` (which opens as a toy with the default asset files). Reopening a saved toy is byte-identical: the
envelope is written with a fixed key order and two-space indent, and `tests/check-studio.js` compares the
text before and after. The ppu.toys guards are kept: a version check with a named error, flat safe file
names (no `..`), duplicate-name refusal, `main.lua` required, and validation of the whole file before any
state is replaced. `sources` is reserved for binary payloads (#24) and refused non-empty rather than
silently dropped.

**Autosave is the whole toy.** Every editor change writes the envelope under
`localStorage["pcestudio.toy.v1"]` and the keys/line-numbers/CRT settings under
`localStorage["pcestudio.settings.v1"]`; the top bar says `saved in this browser`, and a reload restores the
files, the active file and the editor's text (`restored from this browser`). A legacy single-string
`pcestudio.toy` is migrated to a five-file toy. Storage failing is a convenience lost, never a broken toy.

**Vim keys are opt-in** in Settings (`Plain` is the default); choosing `Vim` sets CodeMirror's `keyMap` to
`vim` and persists the choice. The file bar's status reads `plain keys` or `vim on`.

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
PASS  485 checks, 40 frames diff 0 vs check-toys' expected state, Lua == IL for 3 examples,
      every button's handler executed (88 buttons) (… ms)
```

What it does, in order:

1. Executes `renderer/studio.html`'s declared scripts (Fengari, the model, the toy host, the Lua and IL
   runtimes, the #26 panels, the editor/PSG/docs modules) and its inline script in a stub DOM (no jsdom;
   the `check-editor.js`/`check-toys.js` pattern), then asserts `PCEStudio.studio`, three examples, eight
   panels, five toy files, and that `pce-panels.js`/`pce-il.js`/`pce-toys.js`/`pce-docs.js` are the ones
   loaded.
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
6. Clicks **every button** the page builds (88 at this revision: top bar, Docs/close/Guide, code tabs, file
   tabs, asset `Edit` buttons, dock tabs, transport, layers/CRT/SND, markers, settings, open, export, and
   every dynamically built panel-menu and example entry), asserts each has a click handler and none throws;
   then exercises the source box, scrubber and length control, and shows `Check` uses the source box's
   edited text (not the example on disk) and keeps that edit. The stub checks are named, so a page that
   stopped building a dock or menu fails the count rather than passing vacuously.
7. **The editor and the files (#77).** Asserts the vendored CodeMirror files and MIT notice exist and the
   page names them; a toy has `main.lua` plus `tiles/palettes/sprites/waves.json`; the editor's text is the
   Lua that runs (an edit that changes a colour changes frame 2's pixels; editing `tiles.json` leaves the
   running Lua untouched); Save produces one `pce.studio/1` envelope carrying every file, and reopening it
   is byte-identical (`saved.text === envelopeText()` before and after), including the asset text; a second
   page running on the same storage brings the edited editor text, running Lua and assets back (the reload
   model for autosave); and `toy-file-version`, `-duplicate`, `-name`, `-main` and `-json` are the refusals
   for a foreign version, a duplicate, `../evil.lua`, a missing `main.lua` and broken JSON. A plain `.lua`
   opens as a five-file toy.
8. **Every PCE shortcut of §5.** Space plays/pauses and is a character inside a text field (it must not
   start the toy while typing); R restarts at frame 0 and plays; Ctrl+Enter runs the editor's text; Ctrl+.
   and Ctrl+, step one frame; Ctrl+S saves the whole envelope; Escape closes the popovers; Tab inserts two
   spaces in the fallback; IJKL/NMOP move the pad; Settings → Vim turns the Vim keymap on and persists it,
   and Plain turns it off.
9. The stub is not a browser: layout, CSS, a real canvas, iframe rendering and CodeMirror are stubbed. It
   proves handlers, state and the docs pipeline, not appearance, and the textarea fallback is what it
   exercises — the real CodeMirror is §11.2's job.
10. **The output column (#78).** Every new control is driven through the page's own state, and the picture is
    compared with `renderer/pce-sprites.js` drawing the same frame with the layer's CR bit cleared — the same
    renderer the toy runs, not a second compositor:
    * **BG** on `palette-cycle`: `BG off` equals the renderer with CR bit 7 clear, byte diff 0; it changes
      **every one of the 57,344 pixels** (BB blanks the whole background to CRAM[$100]) and the live
      `state().regs.CR` is `$00`. `BG on` restores the frame and CR `$80`.
    * **SPR** through the page's editor (`Run`): a 16×16 solid sprite fixture (the page's own
      `sprite-pad.lua` puts its pattern at `0x100*16` words, which the renderer's cell addressing does not
      read — a separate fixture bug, not a layer one) shows exactly **256 changed pixels**, all inside the
      sprite's 16×16 box and none outside; CR goes `$C0 → $80`.
    * **View only**: the same blank frame with the live CR still `$80`, across a seek; leaving the mode
      applies the hidden layer to CR, and showing it restores the bit.
    * **resolution**: `resolutionFor(VCE CR 0/1/2/3)` reads `256×224 / 341×224 / 512×224 / 512×224` from
      `pce-bg.js`'s own `DOT_CLOCK`, and the live label is the running frame's size (`256×224` today; the
      toy host is fixed at 256×224).
    * **markers** add once at the current frame, sort, and a marker button pauses and seeks to its frame;
      **Length** sets the slider's max to `n−1`, clamps 1…3600, moves the playhead inside a shortened range,
      and a seek past the end lands on the last frame.
    * **CRT** toggles the canvas's `.crt` class and its `aria-pressed`, and the page's CSS really is the
      repeating scanline gradient; **SND** stays unpressed, names #71 in its tooltip and toast, and never
      claims a sound; all eight pad keys (IJKL/NM/OP) hold and release their `pad[1]` field while the canvas
      is focused, and the page-wide shortcuts leave them alone.

### 11.2 The real browser

`node tests/check-studio.js --browser` loads the real page in headless Google Chrome three times:

```
browser: PASS 40 frames · palette · frame 39 · 256x224 · pixels 172032 · digest f45fd1c2
browser docs: docs-panel open, #61 reference + ppu.toys layout
browser driver: 32 checks, 0 failed
PASS  522 checks, … every button's handler executed (88 buttons), headless Chrome says PASS 40 (… ms)
```

The first run is `?selftest=1&frames=40&example=palette`: the page runs 40 frames, and an FNV-1a digest of
frame 39's pixels and state must equal the digest computed here from check-toys' hand-built expected state —
a diff-0 claim on the browser's final frame, not just "the page booted". The second is
`?docs=sprites&paused=1`: the DOM must show the Docs panel open (no `hidden`), the docs iframe present, and
the generated reference with ppu.toys' search and chapter map.

The third is the **#77 driver**: a same-origin iframe served over HTTP from the check itself (no
dependency, no synthetic OS input) loads `renderer/studio.html?paused=1` and drives the page's own
`PCEStudio.studio` object. It asserts: CodeMirror is the editor, in Lua mode, with a gutter, line numbers, an
active-line highlight and highlighted Lua keywords; the editor's text is the running Lua, and CodeMirror's
DOM renders the edit; an asset edit leaves the running Lua alone; save/reopen is byte-identical; Settings →
Vim sets CodeMirror's `keyMap` to `vim` and is written to `localStorage`; Space, Ctrl+., R, Ctrl+S and Tab
(dispatched as real DOM events) do their §5 action; the pad keys work on the focused output; **the same
iframe is reloaded** (`location.reload()`) and a fresh tab is opened with the same profile — both restore
the edited main.lua and `tiles.json` from autosave (`restored from this browser`), with CodeMirror mounted
again.

### 11.3 Screenshots

The pairs are under `$TMPDIR/pcestudio-design-75/` (§1). `side-by-side-studio.png` puts our Studio beside
theirs at the same 1600×1000: the column split lands at x=980, the code rows on the same scanlines
(50/80/116), the dock tab strip on the same scanline (472/473), and the output header/transport/scrubber in
the same order. `side-by-side-docs.png` puts their `/docs` beside our Docs panel: the same `THE FIELD
GUIDE` kicker, display-font hero, search box, numbered two-column chapter map and chapter cards, with our
chapters being the PC Engine's. `side-by-side-toy.png` puts a running toy beside ours running the raster
example. `ours-studio-docs-registers.png` shows the chapter view with the sticky TOC. Nothing from their
page's files is included in the repo; the CSS is adapted into `studio.html` under the credit in §0.

**#77's editor pair.** `side-by-side-studio-77.png` (3200×1034: theirs left, ours right) is
`https://ppu.toys/studio` at 1600×1000 beside
`renderer/studio.html?demo=palette&frame=30&paused=1` at the same size, both captured by headless Chrome's
command line only. The rows land together: CODE/ASSETS at y=50, the file bar at y=80 with one `main.lua`
tab and the status at the right (`vim off · Lua 5.4` vs `plain keys · Lua 5.3`), and the editor at y=116
with the same three visible features — line numbers, Lua highlighting and the cursor line's highlight. The
remaining differences are the deliberate ones: our file bar gains the active asset's tab while an asset is
open, our status says `plain keys`/`vim on` because Vim is a setting, and our dock and output column are the
PCE's (§3). `ours-studio-77-code.png` is the editor on `main.lua`; `ours-studio-77-assets.png`
(`?tab=assets`) is the ASSETS list — `main.lua`, `tiles.json`, `palettes.json`, `sprites.json`,
`waves.json` with kind and size, each with `Edit` — the file-set counterpart of their asset sources.

**#78's output-column pair.** `side-by-side-studio-78.png` (3200×1000: theirs left, ours right) pairs
`https://ppu.toys/studio` at 1600×1000 with
`renderer/studio.html?demo=raster&frame=30&paused=1&layers=1&crt=1` at the same size, both captured by
headless Chrome's command line only (no synthetic input; the `layers`/`crt` query parameters open the same
controls the buttons do, the way `?tab=assets` did for #77). Theirs is the default black toy with its
`Layers ▾` closed; ours runs the raster example with the Layers popover open and CRT on, so the comparison
is of the output column's furniture, not a colour match. Both place `LIVE OUTPUT` / `Layers` at the left of
the row and `CRT`, `SND`, the resolution pill at the right; the canvas starts on the same scanline (~80) and
the transport/scrubber stack under it. Our popover shows `BG · background`, `SPR · sprites`, the frame's
BAT/CR readout (`CR $80` here), `View only`, and the one-line explanation of the CR bits; their controls are
the four `BG1`–`BG4` and `OBJ` checkboxes behind `Layers`, the same idea on the SNES's TM bits.
`ours-studio-78.png` is
our 1600×1000 capture on its own. The underlying pixels are the renderer's (the raster bands and the CRT
scanlines are visible); no pixel comparison with ppu.toys is claimed.

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
* **The asset files are carried and edited, not consumed.** `tiles/palettes/sprites/waves.json` are in the
  toy and the envelope, with the shapes `pce-editor.js`/`pce-wave.js` use, but no importer reads them into a
  running toy yet (#24/#71). The ASSETS tab says this.
* **CodeMirror's Vim mode is selected, not exercised.** The browser run proves `keyMap === "vim"` is set
  and persisted; it does not type `dd`/`ciw` and check the buffer. The plain editor and the Vim keymap are
  both CodeMirror's own, whose tests are upstream's.
* **The saved file's download is not re-read from disk by the test.** The envelope text is compared before
  and after a reopen in both the stub and the browser, and the browser's `Ctrl+S` writes it to
  `localStorage`; the `.pce.json` the browser downloads is not read back from the download directory.
* **The textarea fallback is what the stub exercises.** CodeMirror is skipped where the DOM cannot host it;
  the browser driver is the evidence for CodeMirror itself, so a change that breaks only CodeMirror still
  fails the suite, but a change to the fallback alone is caught only in the stub.
* **Panels are read-only.** ppu.toys' panels are editors with pokes and keyframes; ours reads the toy's own
  state. The panel code (#26) already exposes the values an editor would write through.
* **The output column's controls are proved in the stub, not by a real click.** #78's layer/marker/length
  checks drive `PCEStudio.studio` and the page's own handlers; the real DOM's checkbox events and the
  popover's appearance are judged by the screenshot (§11.3), not by a browser-driver check. The pixels are
  real: `studio.output()` is the frame `present()` drew, and its reference is `pce-sprites.renderFrame`.
* **The 341/512 resolutions are a mapping, not a running picture.** No toy can select another VCE dot clock:
  `pce-toyhost.js` fixes the frame at 256×224. `resolutionFor()` proves the label reads the renderer's own
  256/341/512 table, and `present()`/`paint()` resize the canvas when a frame of another width arrives, but
  no such frame has been rendered.
* **The page's `sprite-pad.lua` example draws no sprite.** It writes its pattern at `0x100*16` words, while
  `pce-sprites.js` addresses SAT pattern `p` at cell `p*64` words, so the example's sprite is transparent;
  `check-toys.js` passes because its hand-built expected state copies the same address. That is a pre-existing
  example/test gap, outside this card's studio files; #78's SPR evidence uses a fixture run through the
  page's editor instead. A card should fix the example and its expectation together.
* **Rule 2.** `tests/check-studio.js` was written by the seat that built the page and extended for #77 and
  #78 by the same seat. A cold break by another seat is owed before this closes the card: break the layout, the
  example list, the frame flow, a panel, a button, the docs wiring (remove a chapter, break the raw
  equality, make the docs button a no-op), the export message, for #77 the editor/files path — replace
  CodeMirror with the textarea, stop loading the Lua mode/Vim keymap, drop an asset file from the envelope,
  make Save write only `main.lua`, stop autosaving, break a shortcut — and for #78 the output column: stop
  masking the hidden layer, write CR in view-only, break the resolution table, make a marker not seek, let
  the length run past its max, or drop a pad key, and the check must catch each.
