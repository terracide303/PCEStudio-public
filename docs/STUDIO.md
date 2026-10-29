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
| right | Export to ROM (orange), Raw output, Panels ▾, gear, Docs, Save file, Open…, Sign in to publish | Run, Paste & Run, Check, Export… (orange), Panels ▾, gear, Docs, Save file, Open…, not signed in |

Measured: both bars are 0…49 with a 1 px border at y=49. The orange primary action is the export in both;
ours opens the honest `needs #31` dialog (§9). `Docs` opens the in-studio Docs panel (§4); `not signed in` is
where ppu.toys puts its account menu.

### 2.2 Left column: code above, panels below — x = 0…980 (61.25 %)

The column splits at x=980 in both captures. The left workspace is two rows:

| row | measured (ours / theirs) | contents |
|---|---|---|
| code tabs | 50…78 / 50…79 | `CODE` and `ASSETS`; active tab is the editor colour, like their dock tab |
| file bar | 80…114 / 80…114 | one Lua file tab `main.lua` (orange underline when active), the generated `pceglobals.lua` tab (read-only, #87), plus the asset's tab while one is being edited; `+`; right: `plain keys · Lua 5.3` or `vim on · Lua 5.3` (theirs: `vim off · Lua 5.4`) |
| editor | 116…470 / 116…471 | **CodeMirror 5.65.16** with line numbers, Lua highlighting and the cursor line's highlight — the same editor and the same three visible features as theirs; the plain textarea remains only as the fallback for a DOM that cannot host CodeMirror |
| dock tabs | 472…500 / 473…501 | the model panels (§3), mono 11 px with 0.1 em tracking |
| dock head | 502…528 / 502…528 | panel title, one-line gloss, `Guide`, current line (`line 0 · full frame`) |
| dock body | 530…1000 / 530…1000 | the active panel; ppu.toys has a tool row above the body, ours puts the controls in each panel |

The row boundary lands on the same scanline (472/473) in both captures: ours is `44.3fr / 55.7fr` of the
workspace, and the code rows use ppu.toys' 30 px tab strip + 36 px file strip.

**The generated `pceglobals.lua` tab (#87).** ppu.toys' file bar carries its panels' generated document,
`ppuglobals.lua`; ours is `pceglobals.lua`, generated by `renderer/pce-globals.js` from the tables the
runtime and the REGISTERS panel already read — `pce-toyhost.js`'s three toy registers (BXR, BYR, CR with
their ranges and manual pages), `pce-panels.js`'s `VDC_REGISTERS` (R00–R13), `pce-psg.js`'s ten registers,
the pad's eight buttons from `pce-toyhost.js`, and the helper names parsed out of `pce-toys.js`'s PRELUDE.
A range or a name changed in one of those changes the document; the generated text is never hand-kept.
It lists **names**: the values a panel writes are `ppuglobals.lua`'s other half, and they go into
`main.lua`'s poke block (#79). It is read-only, it is **not** one of the toy's files (not in the envelope,
not in `studio.files()`), it is never run, and Save cannot write it into a file of the toy. The difference
from theirs is deliberate: their generated document is loaded and applied every frame; ours is a reference,
and the poke block is the thing that applies values.

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
| Backgrounds | **SCREEN** | **a visual editor (#84)**: the BAT drawn as a 32×32 cell map with ppu.toys' tool row (select, pencil, rect, fill, erase, move), the `#` grid, zoom Fit/1×/2×/4×, a visible-screen outline and the footer; beside it the Characters column (tile, char base, the selected tile's 16-colour strip, the tile sheet, an 8×8 tile editor) and the Map column (map base, map size/MWR, tile size, BXR/BYR with −/+). It edits `tiles.json` and `palettes.json`. Below it the live summary and the follow-a-pixel readout still come from the frame | `renderer/pce-screen.js`, `pce-panels.js` `lineValues`, `followPixel` |
| VRAM | **VRAM** | **a drawn map (#85)**: all 32768 words as eight pages of 256 characters (16 words, 8×8, 4bpp), each character drawn in a chosen preview palette, the BAT/tiles/sprite patterns/SAT/free tinted and labelled on the sheet, a legend, a jump per region, and a hover/click readout of the word under the pointer (BAT cell, tile row, SAT sprite Y/X/pattern/palette, free) | `pce-vram-map.js`, `pce-panels.js` `vramMap` |
| CGRAM | **PALETTES** | **a visual editor (#85)**: the VCE's 32 palettes of 16 as swatch buttons (entry 0 dashed — the shared backdrop), and a **512-colour picker** that offers exactly the 9-bit colours the VCE can show (8 G × 8 R × 8 B); click a swatch, then a colour, and that one entry is written to `palettes.json`; the readout gives the CRAM address, the 9-bit word and its channels | `pce-palettes.js`, `pce-editor.js` |
| Sprites | **SPRITES** | **a visual editor (#86)**: the 64 SAT slots drawn as a grid, the screen with the selected sprite outlined and numbered, a picker (slot with ‹ ›, X/Y with −/+, pattern, palette, SPBG priority, H/V, size read from the pattern), *release position*, *off-screen* and *clear slot*, the sprite palette strip, and a pattern sheet whose selected pattern is drawn with the same six tools as SCREEN at pixel granularity. The per-line header is #50's model (`n/16 strips · n/256 px`, the overflow shown). It edits `sprites.json` and the sprite palettes in `palettes.json` | `renderer/pce-sat.js`, `renderer/pce-editor.js` `renderPreview` |
| Audio | **AUDIO** | the honest state: `pce-psg.js` exists and is checked; toys have no sound surface yet (#71) | — |
| Sequencer | *(none yet)* | the tracker lives in `renderer/pce-hutrack.js`; a toy-facing sequencer is a later card | — |
| Compose | *(none)* | **no PCE counterpart**: the HuC6270 has one background layer plus sprites and the HuC6260 has no sub-screen, colour math or blending | — |
| Windows | *(none)* | **no PCE counterpart**: the VDC has no window/mask registers. Per-line `CR` (display on/blank) and `BXR/BYR` are the closest thing, and they sit in SCANLINES | — |
| Scanlines | **SCANLINES** | one row per VDW line: BXR, BYR, CR, whether the raster table writes this line, and the RCR the chain arms | `pce-panels.js` `registerLines` |
| Registers | **REGISTERS** | **a visual editor (#79)**: every register the console has — the VDC's R00–R13, the VCE's CR/CTA/CTW, the ten PSG registers, the timer and the IRQ pair — as one searchable table: address, register, editable HEX and DECIMAL, clickable bits, decoded fields with their Lua names, a curve button and a POKED column. A value is a keyframed **poke**; `Write to toy` puts the curves into the toy's own `main.lua` | `renderer/pce-pokes.js`, `renderer/studio-panel-registers.js`, `pce-panels.js` `vdcRegisters`, `pce-psg.js` `REGISTERS` |
| SNES | **CONSOLE** | **ppu.toys' SNES tab (#98)**: whether the toy runs on a real PC Engine — the green/red banner, the FINDINGS list with a clickable `main.lua:line`, the frame time in cycles and % of 119,904, the worst raster line, sprites per line, VRAM, the emitted C and the estimated ROM against 1 MB, and the honest note that the frame time is a static estimate checked against Mednafen and ares, not hardware | `renderer/studio-panel-console.js`, running `pce-il.js`, `pce-validate.js`, `pce-cgen.js` |

Every panel except AUDIO is computed from **the exact objects the renderer is given** — `runtime.options()`
plus `runtime.lastRaster` — through `renderer/pce-panels.js` (card #26). CONSOLE is the one exception's
mirror image: it reads the toy's *source* and runs the compiler pipeline over it (§3.6), because "can this
run on a console" is a question about the code, not about the frame the browser just drew. There is no
second copy of the picture: the same panel code the editor uses reads the toy's frame. The panel strip
is hidden/shown from the `Panels ▾` menu, which groups `WORKSPACE` (Editor, Assets, Output, Markers, Agent)
and `THE CHIP` (the eight panels), with `Reset to default`, like ppu.toys' menu.

A panel's **`Guide`** button opens the Docs panel at that panel's chapter: SCREEN → registers, VRAM → the
toy, PALETTES → palettes, SPRITES → sprites, AUDIO → sound, SCANLINES → raster, REGISTERS → registers,
CONSOLE → budgets.

### 3.1 SCREEN as a visual editor (#84, part A)

ppu.toys' BACKGROUNDS panel is the working example: the layer is not a table of numbers but a map you
draw on. `renderer/pce-screen.js` is the PCE counterpart's model, and
`renderer/studio-panel-screen.js` (the panel's module since #102) wires it to the panel, over the studio
API of §3.2. It reuses `renderer/pce-editor.js`'s picture rather than a second editor: every edit is that
module's own call (`paintMapCell`, `paintTileIndex`, `newTile`, `setPaletteColour`, `setScroll`), so the
refusals are the editor's (`17th-colour`, `not-in-palette`, `tile-space`, `map-range`, …), and the canvas is
`pce-bg.js` drawing `toPicture()` — the same renderer as the output column. There is no second picture.

| ppu.toys (BACKGROUNDS, measured 2026-10-29) | `studio.html`'s SCREEN panel |
|---|---|
| BG1–BG4, Mode, 4bpp, Visible | **one background** (the VDC has one; a BG2 is #21's SuperGrafx), no mode/bpp (always 4bpp); a **map-size picker** lists the VDC's six MWR sizes and shows the current `32 × 32 (MWR $00)` |
| tool icons: select (key S), pencil, rect, bucket fill (F), erase, move | `Select S · Pencil P · Rect R · Fill F · Erase E · Move M`; the same six behaviours |
| `#` grid | the `grid` checkbox (and `#` while the map has focus) |
| Fit / 1× / 2× / 4× | the same four; 1× is a 256-px map canvas, Fit uses the dock's width and height |
| the map as a cell grid, the visible screen outlined | the 32×32 BAT drawn from its tiles, a cell grid, and a faint white outline at `BYR` over the picture's window height |
| Characters: char base, tile range, palette strip, tile sheet | tile `$nn`, its VRAM address (`tile × 16` words), the tile count, the tile's 16 colours (click one to paint with it), the tile sheet (click a tile), and an 8×8 tile editor |
| Map: map base, map size, tile size, HOFS/VOFS with −/+ and a curve button, Mosaic | map base `$0000` (read-only), **map size (MWR) picker**, tile size `8 × 8` (read-only), **screen width (VCE dot clock) picker**, BXR/BYR with −/+ **and a curve button** (`∿`, naming #79 — the keyframes are that card's); no Mosaic (no PCE counterpart) |
| footer `32 x 32 cells - faint white = visible screen` | `32 × 32 cells · faint white = visible screen`, plus the selection's size and origin |
| — | the live frame summary and the follow-a-pixel readout (#26) stay below the editor |

**What it edits is the toy's assets, not the running frame.** The tiles and the BAT live in `tiles.json`
(the map's 1024 character words and its BXR/BYR), the colours in `palettes.json`; every edit writes them and
autosaves the toy, so Save/Open carry the picture (#77's envelope). The canvas therefore shows the picture
these assets make. A toy still writes its own VRAM/CRAM with `vram[]`/`pal()` until #24's importer reads
the files into a running toy, and the panel says so under the Map column.

**Refusals.** The module adds only the file-shape ones — `asset-json` (not JSON), `asset-shape` (a tile or
palette of the wrong length), `map-size` (a map that is not the 32×32 BAT, including any other MWR code),
`no-tile` (a map naming a character the file does not hold) — and otherwise lets `pce-editor.js` refuse,
so a value the VDC cannot show cannot be stored by either front end (see [`EDITOR.md`](EDITOR.md)'s table).

**Part A's limits, stated rather than pretended.** The map is the 32×32 BAT (MWR `$00`), the size the toy
host's 256×224 frame uses and the size `pce-editor.js`'s picture model holds; the VDC's other MWR sizes
(64×32 … 128×64) are part B. The map-size picker lists all six — so the hardware's sizes are visible — and
picking one refuses with `map-size` and snaps back to `$00`. The BXR/BYR curve buttons are live since #79:
clicking one selects the REGISTERS panel and opens that offset's keyframe curve there (§3.5), where the
keys, the undo and `Write to toy` live — the panel that shows the offsets is the one that keyframes them.
The **screen-width picker** is
real: 256, 336 or 512 dots sets the picture's VCE dot clock through `pce-editor.js`'s `setVideoMode`, and
`tiles.json` carries it as `video` (the panel's own frame becomes 256, 341 or 512 dots wide). A mosaic has
no PCE counterpart; the palette *entries* are edited in the PALETTES panel (#85), not here.

### 3.2 The panel modules and the studio API (#102)

Every panel is its own file — `renderer/studio-panel-<name>.js` for `screen`, `vram`, `palettes`,
`sprites`, `audio`, `scanlines`, `registers`, `console`, `markers` and `agent`. Each pushes one module with
a `register(studio)`; `studio.html` loads the ten files and calls every `register(studio)` before it builds
the dock, **after** which the page names no panel:

```
studio-panel-vram.js
  PCEStudio.studioPanelModules.push({
    id: "vram",
    register: function (studio) {
      studio.panels.register({
        id: "vram", label: "VRAM", group: "chip", chapter: "the-toy",
        gloss: "All 32768 words: …",
        draw: function (st) { … }        // st = the frame's model, or null
      });
    }
  });
```

A registration carries the tab and menu label (`label`), `group` (`"chip"` = the dock tab and the Panels
menu's **THE CHIP**; `"workspace"` = a **WORKSPACE** entry, with `open(studio)` showing its drawer), the
Guide's `chapter` (§3), the dock's `gloss`, and `draw(st)`. `audio` has no `draw` (nothing to show yet);
`markers` also exposes `markers()`/`addMarker()`, which the studio API delegates to. The registry lives at
`studio.panels`: the array of chip panels in dock order (so `studio.panels[0]` and `.length` are the dock)
with `register`, `list`, `get`, `active`, `visible`, `select`, `toggle`, `refresh`, `dirty` and `modules` on
it. A duplicate id throws.

**The API a panel is written against** (the object passed to `register(studio)`; `studio.html` is its only
implementation):

| member | what it is |
|---|---|
| `panels` | the registry above — a panel adds itself and may select/dirty the dock |
| `toy.current()` / `.mode()` / `.source()` | the toy on the page: its example id/name, `"lua"` or `"il"`, the Lua that runs |
| `toy.files()` / `.file(name)` / `.activeFile()` / `.mainSource()` | the toy's asset files (**the live array**, as the ASSET tab sees it) and the editor's current file |
| `toy.writeAssets(pic)` | writes a `pce-screen.js` picture into `tiles.json`/`palettes.json`, follows in the open editor, autosaves; returns the changed names, throws the model's refusal |
| `toy.writeSpritesAssets(pic)` / `toy.writePalettesAssets(pic)` | the same write for a panel that owns a narrower file set: `sprites.json` + the sprite palettes (#86), or `palettes.json` alone (#85) — through that model's `syncFiles` |
| `toy.writeSpritesAssets(pic)` | the same write for `pce-sat.js`'s picture (#86): `sprites.json` and the sprite palettes — deliberately **not** `tiles.json` |
| `toy.persist()` / `.saved(text)` / `.refreshAssets()` | the page's own autosave, status line and ASSETS list |
| `toy.onAssetEdit(fn)` | subscribe to "an asset file changed" (a hand edit, a new example, an opened toy) — SCREEN invalidates its picture |
| `render.state()` / `.currentFrame()` / `.panelLine(st)` / `.hex(v, w)` / `.runtime()` | the frame the panels read, the followed line, and the formatter |
| `render.seek(n)` / `.play()` / `.pause()` / `.isPlaying()` / `.length()` / `.setLength(n)` | the transport and scrubber |
| `render.runFrames(n, example, mode)` / `.resolution()` / `.resolutionFor(vcecr)` / `.output()` | the headless run, the dot-clock label, the frame actually drawn |
| `poke(reg, value, at)` / `pokes()` | a keyframed register override: `reg` holds `value` from frame `at` on, in the **view** (the toy's state is untouched). Setting the same register and frame again replaces the value — that is what editing a keyframe is (#79) |
| `keyframes(reg)` / `pokedRegs()` / `removePoke(reg, at)` / `clearPokes()` | one register's curve in frame order, the registers with a key, and taking keys away — each undoable |
| `writePokes()` | put the curves into the toy's own `main.lua` as one generated block and re-run it; returns `{changed, written, refused, runs}`. A register a toy may not set comes back with the toy host's own code (`reg-forbidden`) and is **not** written; the written ones are baked (the view's copies go, so nothing is applied twice) |
| `undo()` / `redo()` / `canUndo()` / `canRedo()` | move the last poke/keyframe action between the two stacks; `Ctrl/Cmd+Z`/`Shift+Z` outside a text field do the same (§5.2) |
| `theme.token(name)` / `.tokens()` | the page's CSS custom properties (`--bg`, `--accent`, …), read from `:root` |
| `$`, `document`, `toast(msg)`, `hex`, `follow()`, `layout.drawer(which)` | the small DOM/layout surface: an element by id, a note, the followed pixel, and a workspace drawer |

**The split is enforced, not just tidy.** `tests/check-studio.js` asserts each of the ten files is loaded,
that the ten register in order, that the dock and the Panels menu are built from the registry, and that
`studio.html`'s inline script no longer contains the panels' drawing code (`function drawVram`,
`function drawScreen`, `function drawMarkers`, `let screenPic`, …). The page keeps the layout, the editor,
the output, the transport and the API; a panel keeps its own state and drawing.

---

### 3.3 SPRITES as a visual editor (#86, part C)

ppu.toys' SPRITES panel is the working example: the objects are slots you select, the screen shows the
selected one, and the sheet beside them is drawn on. The PCE counterpart is the VDC's SAT — 64 entries
(HuC6270 manual 2.4), each with a position, a pattern code, one of 16 sprite palettes and the SPBG/flip
bits, and with its own size from CGX/CGY. `renderer/pce-sat.js` is the model and
`renderer/studio-panel-sprites.js` is the panel (its CSS is `renderer/studio-panel-sprites.css`, so the
page's style block holds nothing of it). Every edit is `renderer/pce-editor.js`'s own call — `addSprite`,
`setSprite` (new in #86), `parkSprite` (new), `removeSprite`, `newSpritePattern`, `paintSpriteIndex` — so
the refusals are the editor's. The screen, the pattern sheet and the pattern canvas are all
`pce-editor.js`'s `renderPreview`; there is no second picture.

| ppu.toys (SPRITES, from the card's reading of it) | `studio.html`'s SPRITES panel |
|---|---|
| header `OAM n/128 · max N spr / N til` | `SAT n/64`, and #50's per-line model: `line L · n/16 sprites · n/256 px`, with `n line(s) over` when a line's strips are dropped |
| `Line L · n/32 in range · n/34 slivers` | the same figures for the busiest line of the asset picture, and — when a toy is running — the frame's own SAT at the followed line (`frame: line L · n/64 sprites in range · n/16 strips · OVERFLOW`) |
| the screen with the selected object labelled | the picture, the selected sprite outlined and numbered; a press selects the sprite under the point and a drag moves it |
| a grid of all object slots | the 64 slots as an 8×8 grid: placed slots filled, parked ones amber, a dropped strip red, the selected one ringed; click an empty slot to place the next sprite |
| Size pair + Char base | **size is per sprite**, from its pattern's CGX/CGY (the six sizes the VDC draws), shown read-only; *pattern* is the sprite's pattern code (word 2 >> 1) and *cell* is `pattern × 64` words — the address pce-sprites.js reads |
| object picker with prev/next and `Release position` | `‹ ›` step through the slots (and can place the next); **release position** puts the selected sprite back where it was when the panel read `sprites.json` (this panel edits the asset, not a live override, so that is what "the panel's position stops applying" means here) |
| a preview | the screen, the pattern canvas and the sprite palette strip |
| X, Y, Tile, Pal, Pri with −/+ | X and Y with −/+ (clamped to the picture's edges), *pattern* and *pal* as selects, *priority* as in front of / behind the BG (SPBG) |
| checkboxes on, large, H, V | **no `on`**: the SAT has no enable bit, so *off-screen* moves the sprite to display row 240 (past the 224- and 240-line display windows; SAT Y 304) and *clear slot* removes the entry — an all-zero entry is what the hardware shows as nothing. **No `large`**: the size is the pattern's. H and V are HFLIP and VFLIP |
| a Characters sheet with a tile range | the pattern sheet (every pattern at its own size, ringed when selected), `+ pattern` making one of the six sizes, and a pattern canvas drawn with SCREEN's six tools at pixel granularity (select, pencil, rect, fill, erase, move), the `#` grid and the zoom |
| — | the sprite palettes as a 16-colour strip (entry 0 is transparent and dashed); the palette *entries* are edited in PALETTES (#85) |

**What it edits is the toy's assets.** The patterns and the SAT live in `sprites.json`, the sprite
palettes in `palettes.json`; every edit writes them and autosaves the toy, and the panel does **not**
rewrite `tiles.json` — that file is SCREEN's, and a sprite edit that rewrote it would be a background
edit. A toy still writes its own VRAM/SAT until the importer (#24/#71), and the panel says so.

**Refusals.** The panel lets `pce-editor.js` refuse (65th-sprite, sprite-range, sprite-pattern-range,
17th-sprite-palette, sprite-flag-range, sprite-pattern-vram, 17th-colour) and adds only the file and
SAT-order ones: `asset-json`, `asset-shape`, `sprite-size`, `65th-sprite` for a file past 64 entries,
`sprite-gap` (the SAT is filled in order: placing slot 5 with 0-4 empty would need the hardware to skip
them), `no-sprite`, `no-pattern`, `no-position`.

### 3.4 PALETTES and VRAM as visual editors (#85, part B)

Both panels' working examples are ppu.toys' own panels, read — not guessed — from its served bundle
(`$TMPDIR/pcestudio-design-75/app.js`, the `cgram-panel` and `vram-panel` components): CGRAM is a grid of
address rows and sixteen swatch **buttons**, and a click opens an editor for that one entry with its
address (`cgram[0xNN]`) and its value on screen; VRAM is a **drawn image of characters**, paged with a
`‹ page ›` picker, a preview palette and a "Jump to …" row, and the pointer reports the address and
character under it. Ours are those shapes for the HuC6260/HuC6270: 512 nine-bit entries instead of 256
fifteen-bit ones, and 2048 four-bit characters instead of SNES VRAM's mixed formats.

| ppu.toys (read from the bundle, 2026-10-29) | `studio.html`'s panel |
|---|---|
| CGRAM: 16 rows × 16 swatches, address `$00`…`$F0` | **PALETTES**: 32 rows × 16 swatches (0-15 background, S0-S15 sprite), address in the tooltip and the readout, entry 0 dashed (the one shared backdrop) |
| a swatch click opens a popover with a native colour input, `cgram[0xNN]`, the value and a copy button | a swatch click selects that entry; the picker beside the table is **all 512 colours the VCE can show** (one 8×8 plane per blue level, red across, green down) — not an RGB wheel that names colours the chip would round; the readout is `CRAM $nnn · word $nnn · G/R/B · rgb(…)` |
| the popover's "Edit scope: Full frame" (HDMA-aware) | the PC Engine's equivalent is a palette write per line (`raster()` writes `pal()`), which is SCANLINES' (#92); this panel edits the toy's asset |
| the swatch tooltip names the entry | the swatch's tooltip and `aria-label` carry the palette, the CRAM address, the 9-bit word and its channels; a `poked` ring marks an overridden entry (the SNES one has this; ours has no poke yet) |
| VRAM: a page of 256 characters drawn as an image, `‹ page ›`, format picker, preview palette, "Jump to BG characters", hover `$addr · char XX` | **VRAM**: eight pages of 256 characters (16×16 cells of 8×8), `‹ page ›` + page select, a preview palette of the 16 background palettes, a jump per region (BAT, tiles, sprite patterns, SAT, free), hover `BAT cell n …` / `char $nnn · row r · plane p` / `SAT sprite n · word w`, and a click readout with the word's full detail |
| clicking a character opens its pixel editor | not here: the tile and pattern editors are SCREEN's (#84) and SPRITES' (#86); this panel inspects |
| — | the PCE's BAT (words 0-1023) and SAT (`$7F00`, 64 words) are **not** characters; their cells are tinted and labelled, so the sheet is never read as tile data that is not there |

**What they edit, and what they read.** PALETTES edits the toy's assets: `palettes.json` only, through
`pce-palettes.js`'s `syncFiles` → `pce-screen.js`'s `palettesText` (the one writer of that file), so it
does not rewrite `tiles.json` — that is SCREEN's, the same rule `pce-sat.js` follows for `sprites.json`.
Every edit is `pce-editor.js`'s own call — `setPaletteColour`, `setSpritePaletteColour`, and
`setBackdrop` for entry 0, because the backdrop is one colour shared by all 16 background palettes — so
its refusals stand (`backdrop-entry`, `17th-colour`, …), and `pce-palettes.js` adds only the table's own
(`palette-range` 0-31, `entry-range` 0-15, `colour-range` 0-511, `channel-range` 0-7). VRAM reads the
**running frame's** VRAM (the same words `pce-bg.js` draws) and the regions `pce-panels.js` `vramMap`
derives from it; it edits nothing.

**The panel that is not the active tab.** Three panels now hold a picture over `palettes.json` — SCREEN,
SPRITES and PALETTES — so PALETTES' write-back announces the changed file through the studio API's
`onAssetEdit` (the page's `writePalettesAssets` calls `notifyAssetEdit`), which is what makes SCREEN and
SPRITES drop their cached picture and re-read the file on their next draw instead of writing a stale
table back. The PALETTES panel's own selection (which entry the picker edits) is separate from its
picture and survives the rebuild.

**Evidence.** `tests/check-studio.js` adds `checkPalettesPanel` and `checkVramPanel`: the table is 32
rows of 16 buttons, the picker holds all 512 distinct 9-bit words, a swatch click then a picker click
writes exactly one entry into the `palettes.json` text (background `[0][5] = $1FF`, then `$038`, whose
`rgb(252,0,0)` the swatch shows), entry 0 writes the shared `backdrop` into every background row, a
sprite palette writes `sprites[2][3]`, SCREEN's picture follows the same file, and the refusals come
back by code (`palette-range`, `entry-range`, `colour-range`, `picker-range`, `channel-range`). VRAM's
decode is proved against a hand-built VRAM (a diagonal tile, all sixteen colour numbers, a BAT word
`$5123`, a SAT sprite's Y/X/pattern/palette), then the live panel: page 0 is characters 0-255, the sheet
is 128×128, the drawn pixel is palette 0 entry 15's colour from the toy's own CRAM, the preview palette
changes it, page 7 holds the SAT and its jump goes there, a click on the canvas selects `$401`, and the
BAT is tinted and labelled. `--browser` adds real DOM clicks and a real `getImageData` of the sheet.
The pages are `$TMPDIR/pce85/shots/ours-palettes-85.png` and `ours-vram-85.png` (1600×1000, headless
Chrome, no synthetic input); the PALETTES one shows the example's `palettes.json`, which is all black —
the artwork the toy writes with `pal()` is not in the file until #24/#71, and the panel says so rather
than showing the frame's colours as if they were the asset.

### 3.5 Paste & Run (#107)

The loop this exists for: a chat AI answers with one fenced Lua block, the person copies the answer and
presses **Paste & Run** in the top bar (next to `Run`). There is no import step in between.

| door | what it does |
|---|---|
| the button | `navigator.clipboard.readText()`, the answer stripped to its code, `main.lua` replaced, the toy runs |
| the fallback box | shown when the page has no clipboard, the read is refused, or the clipboard is empty: the note says why, the box takes the paste, its own **Paste & Run** runs it |
| a dropped file | a `.lua` becomes the new `main.lua` (the toy's assets are kept); a `.pce.json` toy loads its whole file set, the same as `Open… → From file…`; either way it runs at once |

**One rule, one place.** `stripCodeFence()` takes the first fenced block anywhere in the text — prose above
and below is dropped — accepts ```lua / ```luau or a bare fence, normalises CRLF, and **keeps a leading blank
line**: line numbers must stay the toy's, because the error line quotes them. A fence that names another
language is `paste-language`, an opening fence with no close is `paste-fence`, and nothing to run is
`paste-empty`.

**The previous source is one undo away.** In a real browser the replacement is a single CodeMirror
`replaceRange` with its own change origin, so `Ctrl/Cmd+Z` restores the old `main.lua` in one step.

**When it fails, the line says where.** `showError()` reports `code: main.lua line N: …` on the output
column's error line, cleared by the next run that starts, and CONSOLE repeats it on a `last error:` line. The
runtime loads the chunk as `toy.lua`, and the studio renames the location to the file tab the person is
looking at. Compile errors, `init()` errors and an error in frame 0 all land there: `Run` and `Paste & Run`
share `runToy()`, which wraps the first frame too.

API: `studio.paste()` (the button), `studio.pasteText(text)` (the same work with the text in hand),
`studio.stripFence(text)`, `studio.pasteBox()` / `setPasteBoxText()` / `openPasteBox(note)`,
`studio.lastError()` and `studio.lastDrop()` (`{status, name, error}` — a drop is async, so the evidence polls
it). CONSOLE reads `studio.render.lastError()`.

Evidence: `tests/check-studio.js` checks the fence rule and every refusal by code, a good paste running and
visible (57,344 non-backdrop pixels at frame 60), and a broken one naming `main.lua line 2` in the error line
and in CONSOLE; `--browser` stands in for `navigator.clipboard`, clicks the real button, counts the pixels,
undoes with CodeMirror's own `undo()`, drops a real `File` through a `DragEvent`, and takes the fallback box
when the stub refuses. The tests were written by this card's builder, so RULES rule 2 (a different seat
breaks it) is owed by @review.

### 3.5 REGISTERS as a visual editor, and the pokes (#79)

ppu.toys' REGISTERS panel is the working example (shown to us on 2026-10-29; recorded on #79 in
`docs/PLAN.md`): one searchable table of every register, with editable HEX and DECIMAL, clickable bits, the
decoded fields, a curve button per field and a POKED column — and a panel edit there is not a one-shot
write but a **keyframed override** that plays with the toy and survives the playback. This is the PCE
counterpart, built the way #84's rule asks: `renderer/studio-panel-registers.js` is the panel,
`renderer/pce-pokes.js` is the model, and `studio.html` gained one script tag and the pokes' API.

| ppu.toys (REGISTERS, from the card's reading of it) | `studio.html`'s REGISTERS panel |
|---|---|
| one row per register: ADDRESS, REGISTER, HEX, DECIMAL, BITS high→low, decoded fields, a curve button, POKED | the same seven columns. The rows are the console's address space: the VDC's R00–R13 (18 live registers; R03/R04 are addresses with no register), the VCE's `$0400` CR / `$0402` CTA / `$0404` CTW, the ten PSG registers `$0800`–`$0809`, the timer `$0C00`/`$0C01` and the IRQ pair `$1402`/`$1403` — 35 rows |
| fields with their Lua names | the bit layouts are `docs/MANUALS.md` §3.2–§3.5 and §15's HuC6280 rows (each field's tooltip carries its manual page); **only the fields a toy may set have a Lua name** — CR's SB/BB, and BXR and BYR — because `docs/TOYS.md`'s `reg()` takes exactly those three registers. DCR's five fields are `pce-vram.js`'s `decodeDcr` bit for bit |
| a search box, an "All registers" filter, a "Poked only" toggle, an "N / total" count | the same four; the filter groups are VDC/VCE/PSG/TIMER/IRQ |
| Enter or Tab pokes, Escape cancels, arrows move rows | the same in HEX and DECIMAL; Tab also moves to the next visible row's box (Shift+Tab back); a bit button toggles its bit and pokes |
| `POKED` | `● N key(s)`: the number of the register's keyframes, and a dot when one is in force at the current frame |
| a curve button per field | `∿` opens that register's curve box: its keyframes (frame · value, a `×` each), `+ key at this frame`, `Clear curve`, and a graph of the keys over the toy's length |

**A poke is the view's; the toy is untouched.** `renderer/pce-pokes.js` holds the list, each register's
curve, the undo/redo stacks and the Lua; `studio.html` folds what is in force into the renderer's options
(`applyPokes`) and presents the frame through the same `pce-sprites.js` renderer, so a poked frame is the
renderer's own — byte for byte — and undo is a pure move between two lists. The toy's state keeps what the
toy wrote; a poke never touches it.

**Written back into the toy.** `Write to toy` (the panel's toolbar, `studio.writePokes()`) appends one
generated block to `main.lua` — `renderer/pce-pokes.js`'s `lua()` — from its opening marker to
`-- <<< PCEStudio pokes — edits inside this block are overwritten`:

```lua
-- >>> PCEStudio pokes (written by the REGISTERS panel, card #79)
local __pceKeys = { { f = 0, reg = "BXR", v = 11 }, { f = 20, reg = "BXR", v = 21 } }
local __pceBase = frame
local function __pceFrame(t, f)
  if __pceBase then __pceBase(t, f) end
  for __i = 1, #__pceKeys do
    local __k = __pceKeys[__i]
    if __k.f <= f then reg(__k.reg, __k.v) end
  end
end
frame = __pceFrame
local __pceInit = init
init = function()                 -- re-captures a frame the toy defines in init()
  if __pceInit then __pceInit() end
  if frame ~= __pceFrame then __pceBase = frame end
  frame = __pceFrame
end
-- <<< PCEStudio pokes — edits inside this block are overwritten
```

The block closes over the toy's own `frame()` and writes every key in force **every frame** — not only
when a value changes, because the toy may write the register itself each frame — which is ppu.toys' rule
(its generated document is spliced after the program's own hooks, and replayed each frame) in the one-file
shape this studio has. The `init` wrapper is there because a toy may define `frame()` inside `init()`; a
block that captured `nil` at load would leave the toy's frame never called. The toy is re-run from the new
source before the call returns, and the written keys are then **baked**: the view's copies go (or they would
be applied on top of the toy's own) and the poke undo stack ends — after a write, the source edit is
CodeMirror's undo.

**What is not written, and why.** A toy may set exactly BXR, BYR and CR (`docs/TOYS.md`). A poke on any
other register — MWR, HSR, a PSG register, the timer — is a view override (the renderer honours MWR, HSR,
HDR, VPR, VDR, VCR and VCECR from its options, so some of them are visible) but `writePokes()` returns it in
`refused` with the toy host's own `reg-forbidden` and **does not** put it in the Lua. Widening the toy's
register set is a decision for the toy API, not for this panel.

**The curve buttons elsewhere.** SCREEN's BXR/BYR `∿` buttons now open these curves (they select the
REGISTERS panel and its curve box for that register), so the panel that shows the scroll offsets is the
one that keyframes them.

**Refusals.** `poke-reg` (a register name the model does not take), `no-pokes` (Write to toy with nothing
poked), `reg-forbidden` (a register a toy may not set), and the toy's own `reg-range` if a written block is
edited by hand past a register's width (the panel masks every value to the register before writing, and the
model masks again to the toy host's width).

### 3.6 CONSOLE: ppu.toys' SNES tab (#98)

ppu.toys' SNES tab is the working example: *"How this project runs on a real console: frame time,
compiler findings, N code"*, a red banner *"Can't run on the SNES as written yet: 1 problem to fix"*, a
FINDINGS list whose file:line is clickable, and a grey note saying the frame time is a static estimate
checked against an emulator, not hardware. CONSOLE is that tab for this console.

The panel is a module (`renderer/studio-panel-console.js`) and its report is data. On each draw it takes
`studio.toy.source()` (the Lua the Run button would compile) and runs the three stages the export path
already owns, in order:

1. **`pce-il.js`** lowers the Lua subset to the IL — a syntax error or one of its refusals (`il-op`,
   `il-method`, `il-string`, …) stops here and is the first finding;
2. **`pce-validate.js`** runs the IL for eight frames: cycles per frame and per `raster(line)` call, the
   sprites-per-line model, VRAM and the 1 MB ROM estimate. Its errors are findings; its warnings
   (`validate-slow-frame`, `validate-raster-blank`) are listed but do not make the banner red, because a
   toy can still run;
3. **`pce-cgen.js`** emits C and refuses what part A/C cannot compile (`cgen-op`, `cgen-fixed`, …). Its
   refusal is a finding too: a toy that the validator accepts can still have no path to machine code.

The banner is **"Can run on the PC Engine"** (green) when there is no error, or **"Can't run on the PC
Engine as written yet: N problems to fix"** (red). Each finding that knows its line draws a
`main.lua:<line>` button; pressing it calls `studio.editorLine(line)`, which moves CodeMirror's cursor and
scrolls, or selects the line in the textarea fallback. A finding with no line of its own but about the
frame (`validate-frame-budget`, `validate-slow-frame`) points at the toy's `function frame(`
definition; a "VDW line" in a message is a display line and is never treated as a Lua line.

The stats are the validator's own numbers: frame time in cycles and as a percentage of the 119,904-cycle
60 Hz frame (the Tech Notes figure; the validator's budget uses its calibrated 119,318 — a finding quotes
the validator's number, so the two are never silently swapped), the worst `raster()` line, strips on the
worst line, the highest VRAM word, the emitted C's size and the ROM estimate against 1,048,576 bytes.

**Live as the toy changes.** Typing in `main.lua` re-runs the pipeline once typing pauses (§3.5's
`onEditorChange` schedules it); Run, a seek and a frame all redraw the panel, and the panel keeps its last
report so only a changed source recompiles. A toy that failed to compile has no frame state and still
draws: that is exactly when the findings matter.

API: `studio.console()` is the panel's report (`{banner, errors, warnings, findings, stats, …}`),
`studio.consoleRefresh()` re-runs it, `studio.consoleGoto(line)` is what a link calls, and
`studio.editorLine(line)` is the page's one way to put the cursor on a Lua line. The rig block
(`#console-table`) keeps the old panel's facts — frame clocks, "per-line = RCR, not HDMA", the SAT count,
the runtime, the frames run and the last error in the error line's words (#107).

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
| Ctrl/Cmd + Z / Shift+Z | undo / redo the last panel **poke** (a keyframed register override, §3.2) outside a text field; inside the editor it stays CodeMirror's text undo |
| Ctrl/Cmd + S | save the toy as one `.pce.json` envelope; the browser also keeps it in `localStorage` |
| Tab | insert two spaces in the editor (CodeMirror's `Tab`, and the textarea fallback's) |
| Escape | close the panels/settings/open popovers, the export dialog and the Docs panel |
| IJKL, N/M, O, P (output focused) | 2-button pad 1: D-pad, I, II, Select, Run (the PCE pad; multitap pads 2–5 are in the runtime but not on the keyboard) |
| Enter / Tab / Shift+Tab (REGISTERS table) | poke the typed HEX or DECIMAL value at the current frame and stay / move to the next / previous visible row |
| Escape (REGISTERS table) | cancel the edit (the box snaps back to the value in force) |
| ↑ / ↓ (REGISTERS table) | move between rows |
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
| `Panels ▾` | show/hide workspace regions and chip panels; `Reset to default`. Both groups are built from the panel modules' registrations (#102) |
| `Docs` | open the #61 reference as the Docs panel (§4), at the active panel's chapter via `Guide` |
| Docs search | filter the reference's chapters and chapter nav by text |

Every ppu.toys shortcut that has a PCE meaning is implemented. The poke undo/redo is real since #79: the
REGISTERS panel's HEX, DECIMAL and bit edits are keyframed pokes, `Ctrl/Cmd+Z`/`Shift+Z` move them between
the two stacks outside a text field (§3.2, §3.5), and SCREEN's BXR/BYR curve buttons open their curves.
Deliberately not: the SNES `hdma()` shortcut vocabulary (the PCE's per-line mechanism is `raster(line)`
and the RCR interrupt).

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
| `tiles.json` | `{version, tiles: [{char, palette, pixels}], map: {mwr, bxr, byr, cells}}` | 8×8 tiles, 4-bit colour numbers, keyed by VCHAR — and since #84 the BAT that names them (`cells`, the 32×32 map's 1024 character words) with its scroll |
| `palettes.json` | `{version, backdrop, background[][] , sprites[][]}` | the VCE's 32 palettes of 16 words |
| `sprites.json` | `{version, patterns: [{width, height, pixels[]}], sprites: [{x, y, pattern, palette, priority, hflip, vflip}]}` | the sprite patterns (4-bit colour numbers, pixel 0 transparent) and the SAT; a parked sprite is `{parked: 1, y: 0}` (#86) |
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
budget. Those are `#32` and the toy reference `#61`; the **CONSOLE** tab runs them (§3.6), and the engine
that must eventually enforce them already owns the frame (`pce-toyhost.js`). The studio's evidence is
separate from the button: `tests/check-studio.js` compares the page's 40 frames with `tests/check-toys.js`
hand-built expected state, not with the page's own opinion.

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
PASS  822 checks, 40 frames diff 0 vs check-toys' expected state, Lua == IL for 3 examples,
      editor/files/shortcuts, output column, every button's handler executed (120 buttons) (… ms)
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
6. Clicks **every button** the page builds (120 at this revision: top bar, Docs/close/Guide, code tabs, file
   tabs, asset `Edit` buttons, dock tabs, the SCREEN tools/zooms and its two curve buttons, the SPRITES tools/zooms/picker/slots, transport,
   layers/CRT/SND, settings, open, export, and every dynamically built panel-menu and example entry),
   asserts each has a click handler and none throws;
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
    * **SPR** on the page's own `sprite-pad.lua` (no fixture since #90): `SPR off` changes exactly **256
      pixels**, all inside the 16×16 block at display (112,96) and none outside; CR goes `$C0 → $80`.
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
11. **The SCREEN panel's cell-map editor (#84).** The tool row is exactly `select/pencil/rect/fill/erase/
    move` and the zoom row `fit/1x/2x/4x`; the page builds a button for each, the grid starts on, and the
    footer reads `32 × 32 cells`. Then each tool is driven through the page's own calls and the toy's asset
    files are read back: `+ tile` makes `$41`; the tile pencil paints pixel (2,3) of it as colour 5 and
    `tiles.json` holds it; a pencil click paints cell (3,4) with `$41`, the map word in `tiles.json` names
    it, and **exactly one frame pixel** changes (`rgb 252,252,252` at (26,35) — palette 0 entry 5 is `$1FF`);
    a pencil drag paints 0…5 with no gaps; a rect fills its 4×3 block and no other cell; fill turns all 1024
    cells; erase paints the blank tile; move carries a tile and blanks its source; select commits
    (1,1)–(4,3) and the footer counts `4 × 3 = 12 cells`. The zoom chips draw 256/512/1024-px map canvases,
    the grid checkbox toggles, a palette swatch picks the colour, the tile sheet selects the clicked tile,
    the tile editor paints the pixel under the pointer, and BXR/BYR + shift the frame exactly one pixel
    (pixel (0,40) after = pixel (1,40) before). The assets round-trip through the toy: Save, reopen, same
    BAT and scroll. `tiles.json`'s text is `pce-screen.js`'s own `tilesText()` of the picture, not a second
    copy. Refusals by code: `colour-index` (colour 16), `tool-range`, `map-size` (MWR `$10` names part B),
    `no-tile` (a map word with no tile; a missing tile to select).
    * The stub DOM has no canvas pixels, so the same panel is proved in the browser (11.2) and in the
      screenshot (11.3); the stub proves the model, the files and the frame.
12. **The panel modules and the studio API (#102).** The ten files are loaded and register in order
    (`screen, vram, palettes, sprites, audio, scanlines, registers, console, markers, agent`); the chip
    panels are the registry's, in dock order; every chip panel but AUDIO has a `draw` from its module; a
    duplicate id is refused; the dock tabs and the Panels menu are built from the registrations; CONSOLE's
    `Guide` opens `budgets` from its own `chapter`; and `studio.html`'s inline script no longer contains
    `function drawVram`, `function drawScreen`, `function drawMarkers`, `let screenPic`, `let palCells` or
    the old metadata literal. The API is exercised directly: `toy.files()` is the live array, `render`
    exposes frame/length/state/line/hex/runFrames, `theme.tokens()` is the page's 26 custom properties,
    `panels` selects/hides/refreshes, and a `poke("CR", $00)` changes the drawn frame, `undo()` restores
    it byte for byte, `redo()` re-applies it, `clearPokes()` restores it, and `Ctrl+Z` outside a text field
    is the poke undo while inside one it is left to the editor.
13. **#84's visual gaps.** Both curve buttons exist, have handlers, name #79 in their `title` and in a
    toast. The map-size picker lists the VDC's six MWR sizes (`$00/$10/$20/$40/$50/$60` as
    `32×32/64×32/128×32/32×64/64×64/128×64`), starts on `$00`, refuses `$10` with `map-size` and snaps
    back. The screen-width picker lists 256/336/512, and 336 draws the VCE's **341**-dot frame and 512 a
    512-dot one, `tiles.json` carries `video`, save/reopen keeps it, `$30` is refused as `map-size` and
    320 as `video-mode`.
14. **The SPRITES panel's visual editor (#86).** The panel's api is the registry's (`sprites`), the pattern
    tools are `pce-screen.js`'s own six (one array, not a copy), and every button the module builds is on the
    page. Then, through the panel's own calls and with `sprites.json` read back each time: slot 0 places
    sprite 0 and its 16×16 pattern and the header reads `SAT 1/64`; the pencil paints pattern pixel (2,3)
    colour 5, `sprites.json` holds it and **exactly one frame pixel** is the sprite (`252,252,252` at
    (114,99), sprite palette 0 entry 5 = `$1FF`); a rect fills a 4×3 block; the bucket floods the connected
    0s and stops at a different colour; erase paints colour 0; move carries a pixel and blanks its source;
    a press on the screen selects the sprite under the point and a drag moves it (the frame's lit pixel
    moves with it and the old place is empty); *release position* puts it back where the file had it;
    X/Y −/+ move it one column/row; HFLIP mirrors the pattern's corner pixel to the sprite's other edge and
    clearing it restores the picture; *off-screen* parks it at display row 240 and the frame draws none of
    it (0 lit pixels), `sprites.json` records `parked: 1`, and Y − brings it back to row 223; *clear slot*
    removes it from the SAT and the file; a gap (`slot 9` with one sprite) is refused `sprite-gap` and slot
    64 `sprite-range`. Size is per sprite: a `32×16` pattern makes a `32×16` sprite and its line asks for
    two strips. SPBG: priority 1 draws it over an opaque BG pixel, priority 0 hides it behind the BG's
    colour 5. Seventeen sprites on one line ask for 17 strips, the VDC keeps 16, the header says lines are
    over and the slot grid marks the dropped one. Refusals by code from the editor and the file:
    `sprite-range` (x 256), `17th-sprite-palette`, `sprite-field`, `colour-index`, `asset-json`,
    `sprite-size`, `17th-colour`, `65th-sprite`. `sprites.json` round-trips byte for byte, and a sprite
    edit **leaves `tiles.json` alone** (it is SCREEN's file). A real `MouseEvent`-shaped pointer over the
    pattern canvas paints pixel (0,0); with the `sprite-pad` example running, the panel's second line is the
    *frame's* SAT at the followed line, not the asset picture's.
    * The stub DOM has no canvas pixels, so the drawn screen/sheet/pattern are proved only to be sized and
      drawn; the frames above are `pce-editor.js`'s `renderPreview`, the same renderer as the output.
15. **The CONSOLE panel (#98).** `tests/check-studio.js`'s `checkConsolePanel` loads three sources into
    the page's own editor and reads `studio.console()` — the panel's report, not a second analysis:
    palette (the page's clean example) is **green**: `Can run on the PC Engine`, no findings, a frame time
    under `pce-validate.js`'s 60 Hz budget, and a positive emitted-C and ROM size; the six stats rows are
    drawn. A toy with `reg("NOPE", 0)` on line 4 is **red**: `validate-range` at line 4, the C emitter's
    `cgen-op` also listed, the banner's own count rendered, and the `main.lua:4` button — a real `click()`
    — moves the editor's selection to line 4's first character. A frame of 20,000 iterations is **red**:
    the measured collection is over 8 × the validator's frame clocks and the `validate-frame-budget`
    finding points at `function frame(`'s line 2. The honest note ("static estimate, checked against
    Mednafen and ares, not hardware") and the panel's subtitle are asserted from the page's own source.
    * Not proven: the numbers are `pce-validate.js`'s static model, not a Mednafen/ares capture of these
      three sources; the stub DOM draws the rows but no screenshot compares the panel's pixels; a live
      keystroke's debounce is not exercised (the stub's `setTimeout` never fires — the evidence calls
      `consoleRefresh()`/a panel select instead), and the browser driver has no CONSOLE case.

### 11.2 The real browser

`node tests/check-studio.js --browser` loads the real page in headless Google Chrome three times:

```
browser: PASS 40 frames · palette · frame 39 · 256x224 · pixels 172032 · digest f45fd1c2
browser docs: docs-panel open, #61 reference + ppu.toys layout
browser driver: 38 checks, 0 failed
PASS  734 checks, … every button's handler executed (105 buttons), headless Chrome says PASS 40 (… ms)
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

The driver's last block is **#84 in a real browser**: after a fresh example, `+ tile` and the tile pencil
paint a white pixel, then a real `MouseEvent` (`mousedown`/`mousemove`/`mouseup`) is dispatched on the
`#scr-map` canvas at the coordinates of cells (3,4) and a 3×3 drag. The page's own listeners must map those
events to the cells (the stub can only call the model), the cell's map word must change, and
`getImageData` on the canvas must show `rgb 252,252,252` at the painted pixel — so the canvas really draws
the picture, not just the model. The `2×` chip must redraw the map canvas at 512 px, and the grid checkbox's
`change` event must turn the grid off.

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

**#84's SCREEN pair.** `$TMPDIR/pcestudio-design-84/side-by-side-screen-84.png` (3200×1000: theirs left,
ours right) is `https://ppu.toys/studio` at 1600×1000 beside our studio at the same size with the SCREEN
panel drawn on. Theirs is the default toy: `BACKGROUNDS` with BG1–BG4, Mode `1`, `4bpp`, Visible, the six
tool icons and `Select · key S`, `#`, `Fit 1× 2× 4×`, an empty checkered map, `Char base 0x0000` with the
`0-255` range, `tile 0`, `- pal 0` and the tile sheet, and the footer `32 x 32 cells - faint white =
visible screen`. Ours: one background layer (no BG2–4), no mode/bpp but the map size `32 × 32 (MWR $00)`,
the same six tools as `Select S · Pencil P · Rect R · Fill F · Erase E · Move M`, the `grid` checkbox and
`FIT 1× 2× 4×` in the same corner, the BAT drawn as a 32×32 cell grid with the faint visible-screen
outline, the Characters column (tile `$42`, char base `$420`, the 16-colour strip, the 4-tile sheet, the
8×8 tile editor), the Map column (map base `$0000`, map size, tile size, BXR/BYR `− +`) and the footer
`32 × 32 cells · faint white = visible screen · selected · 6 × 4 = 24 cells · (6,6)`. The picture in ours
is a small scene drawn entirely through the panel's own tools by a scratch driver (`$TMPDIR/pce84/`), never
in the repo; theirs is empty because ppu.toys' default toy has no art. Captured by headless Chrome's
command line only, no synthetic input. `ours-screen.png` is our 1600×1000 capture on its own; `theirs-
backgrounds.png` is theirs.

**#79's REGISTERS panel.** `$TMPDIR/pcestudio-design-79/registers-79.png` is our studio at 1600×1000 with
the REGISTERS panel drawn on, opened from the URL
(`?demo=palette&panel=registers&frame=30&paused=1&poke=BXR:11@0,BXR:21@20,CR:128@0&curve=BXR` — the
`poke`/`curve` parameters are the same no-synthetic-input trick as `?tab=assets` and `?bands=demo`). What
it shows: the toolbar `Search address or name` · `All registers` · `Poked only` · `Write to toy` · `35 / 35`;
the curve box `CURVE · BXR (BXR $0007) · 2 keys` with its graph, `frame 0 · $000B (11) ×`, `frame 20 ·
$0015 (21) ×`, `+ key at this frame`, `Clear curve`, `Close`; and the table's header `address · register ·
hex · decimal · bits (high → low) · fields · curve · poked`, with `$0005 CR 80 128 … ● 1 key` and `$0007
BXR 15 21 … ● 2 keys` — BXR's shown value is the key in force at frame 30 ($0015), not the toy's (the
palette example never writes BXR), and the canvas behind carries the $15 scroll. Theirs is described from
the @workshop reading on #79 (2026-10-29), not a fresh capture: a live `ppu.toys/studio` tab was not
available in this session, so this is **a description of ours, and theirs from the card** — no side-by-side
and no pixel comparison with their page is claimed.

**#102's module split, before and after.** `$TMPDIR/pce102/before/` and `$TMPDIR/pce102/after/` hold
1600×1000 captures of every panel (`?panel=screen|vram|palettes|sprites|audio|scanlines|registers|console`),
the editor, the ASSETS tab (`?tab=assets`) and the two drawers (`?bottom=markers|agent`), taken with
headless Chrome's command line, one profile per capture. Captured before the split and after it from the
same page URLs, **every tab is pixel-equal**: the only differing pixels are 7 in the CodeMirror caret's
blink area at (10,540)–(12,560), and two runs of the same page produce exactly the same 7 — the split moves
no pixel. The SCREEN tab is also captured with the #84 gap controls removed (`$TMPDIR/pce102/refactor/`):
that page matches `before/` the same way, so the difference between `refactor/` and `after/` — the SCREEN
dock's Map column — is the two curve buttons and the two pickers, and nothing else. The diff images
(`cmp-screen-dock.png`) and the pixel counts are what was measured, not a claim.

**#85's PANELS and VRAM captures.** `$TMPDIR/pce85/shots/ours-palettes-85.png` and `ours-vram-85.png`
(1600×1000 each) are headless Chrome's command line on
`renderer/studio.html?demo=palette&frame=30&panel=palettes|vram`, no synthetic input. PALETTES shows the
32×16 swatch table with the background/sprite split, entry 0 dashed, the selected entry ringed, the readout
`background palette 0 · entry 1 / CRAM $001 · word $000 · G0 R0 B0 · rgb(0,0,0)`, the 512-colour picker as
eight labelled B-planes, and the note that the example's `palettes.json` is still all black. VRAM shows the
page bar (`$0000–$0FFF`), the preview palette, the five jump buttons, the 384-px sheet with the BAT tinted
and labelled and the tile region's own pixels, the legend (`BAT $0000-$03FF · 1024 words`, `tiles …`,
`SAT …`, `free …`) and the click readout line. Theirs' equivalent panels are inactive tabs in the captured
ppu.toys DOM, so no side-by-side pair is claimed for this card — the comparison is the component read from
the served bundle (§3.4), which is a source, not a pixel match.

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
* **`Check` is not the validator.** `Check` is determinism + Lua/IL agreement; cycles, sprites per line
  and source budgets are `#32`/`#61`, run by the **CONSOLE** tab (§3.6) rather than by the Check button.
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
* **SCREEN, SPRITES and REGISTERS are editors so far.** ppu.toys' panels are all editors with pokes and
  keyframes. #84 made SCREEN an editor of the toy's *assets* (§3.1), #86 did the same for SPRITES (§3.3),
  and #79 made REGISTERS an editor of **keyframed register pokes** (§3.5) — which are the view's, not the
  toy's, until `Write to toy` puts them into `main.lua`. Still read-only: VRAM, PALETTES (#85),
  SCANLINES, CONSOLE. #102 puts each panel in its own file and the API in §3.2, so those cards can run in
  parallel.
* **#79's pokes reach the toy only through three registers.** BXR, BYR and CR are the registers a toy may
  set (`docs/TOYS.md`), so a poke of MWR, HSR, a PSG register or the timer is a view override that
  `Write to toy` reports as `reg-forbidden` and does not write (§3.5). Widening the toy's register set is a
  toy-API decision, not a panel one. The view itself honours the VDC registers the renderer reads (MWR, HSR,
  HDR, VPR, VDR, VCR, VCECR) but nothing in the renderer reads a PSG, timer or IRQ override, so those pokes
  are stored and written back (or refused) but change no pixel.
* **The SPRITES panel (#86) is not proved by a cold break.** Its checks in `tests/check-studio.js` were
  written by the builder, so rule 2 is owed: another seat, another model, breaks the model, the panel and
  the file round-trip and the checks must catch every break. Also not proven: the stub DOM draws no canvas
  pixels, so the screen, slot grid, sheet and pattern canvas are only sized and driven, never pixel-compared
  against a golden image; there is no browser-driver case yet for a real mouse drag on `#spr-screen` (the
  §11.2 driver covers the SCREEN map only); the "off-screen" position (display row 240) is the model's
  reading of the 224/240-line window with no capture behind it; `sprites.json` is an asset file no importer
  reads yet, so a toy cannot show these sprites in a running frame until #24/#71; and the per-line header is
  `pce-editor.js`'s budget over that picture, not a Mednafen measurement.
* **The SCREEN panel's map is the 32×32 BAT.** MWR `$00` is what the toy host's 256×224 frame and
  `pce-editor.js`'s picture model hold; the map-size picker lists the VDC's 64×32 … 128×64 sizes, but
  choosing one refuses with `map-size` and snaps back — part B, not silently stored. The BXR/BYR curve
  buttons exist and name #79; the keyframes themselves (and so a curve to draw) are that card's. A mosaic
  has no PCE counterpart. The screen-width picker is real but edits the *asset picture*: `tiles.json`
  carries `video` (256/336/512) and the panel's frame becomes 341 or 512 dots wide; the running toy is
  still fixed at 256×224 by `pce-toyhost.js`.
* **Rule 2 for #102.** The module-split and gap checks in `tests/check-studio.js` were written by the seat
  that did the split (the card names the file), so a cold break is owed: move a panel back into
  `studio.html`, register a duplicate id, drop a `draw`, stop building the menu from the registry, break a
  picker's refusal, or make the video mode not carry into `tiles.json`, and the check must catch each.
  Another seat's break, not the builder's.
* **The SCREEN panel edits assets, and no toy reads them yet.** Drawing into the map changes
  `tiles.json`/`palettes.json` and the panel's own rendered picture; it cannot change a running toy's
  frame until #24's importer reads the files into VRAM/CRAM. The panel says so, and its canvas never
  claims otherwise.
* **Rule 2 for #84.** `tests/check-studio.js`'s #84 block was written by the seat that built the panel
  (the card names the file), so a cold break is owed: break a tool, the zoom, the grid, the asset
  write (`syncFiles`), the rendered frame, a refusal code, or the panel's controls, and the check must
  catch each. Another seat's break, not the builder's.
* **The output column's controls are proved in the stub, not by a real click.** #78's layer/marker/length
  checks drive `PCEStudio.studio` and the page's own handlers; the real DOM's checkbox events and the
  popover's appearance are judged by the screenshot (§11.3), not by a browser-driver check. The pixels are
  real: `studio.output()` is the frame `present()` drew, and its reference is `pce-sprites.renderFrame`.
* **The 341/512 resolutions are a mapping, not a running picture.** No toy can select another VCE dot clock:
  `pce-toyhost.js` fixes the frame at 256×224. `resolutionFor()` proves the label reads the renderer's own
  256/341/512 table, and `present()`/`paint()` resize the canvas when a frame of another width arrives, but
  no such frame has been rendered.
* **Every example is proved visible (#90).** A screenshot of `?demo=sprite` was entirely black while
  `check-toys` passed: the example wrote its pattern at `0x100*16` words (the BAT's tile layout) while
  `pce-sprites.js` reads SAT pattern `p` at cell `p*64` words with plane `n` at `p*64 + n*16`, so the sprite
  was transparent, and the hand-built expected state copied the same wrong address. The example now writes
  through `putsprite`, whose layout is the hardware's (HuC6270 manual 2.4), and `check-studio` measures the
  frame the canvas drew: `palette` 57,344 non-backdrop pixels, `raster` 7,168 (its colour-15 diagonals; its
  colour 1 is CRAM[1], which no example writes), `sprite` 256 inside the 16×16 box at (112,96) — and ten
  frames of the pad-right key move that box one column a frame, ten of pad-left bring it back. `check-toys`
  and `check-examples` carry the same assertion for their examples. The three assertions fail on the old
  example (measured: 0 non-backdrop pixels; the mutant is in #90's evidence).
* **Rule 2.** `tests/check-studio.js` was written by the seat that built the page and extended for #77 and
  #78 by the same seat. A cold break by another seat is owed before this closes the card: break the layout, the
  example list, the frame flow, a panel, a button, the docs wiring (remove a chapter, break the raw
  equality, make the docs button a no-op), the export message, for #77 the editor/files path — replace
  CodeMirror with the textarea, stop loading the Lua mode/Vim keymap, drop an asset file from the envelope,
  make Save write only `main.lua`, stop autosaving, break a shortcut — and for #78 the output column: stop
  masking the hidden layer, write CR in view-only, break the resolution table, make a marker not seek, let
  the length run past its max, or drop a pad key, and the check must catch each.
