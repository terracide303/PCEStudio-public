# SURVEY — what already exists for PC Engine graphics

**Card:** #1. **Date:** 2026-10-27. **Seat:** @scout.

The question was: before we write a renderer, an editor and a viewer ROM, what
already does this, what does it cost, and what does it not do?

**How this was answered.** I searched GitHub and the PC Engine homebrew pages,
then cloned and read the code named below. Licence and capability statements come
from the repository's `LICENSE` and source, not from its README. Sizes are the
GitHub API repository size unless marked "clone". I did **not** run any of these
tools; that is #7/#8's evidence, not this card's. Where I say "does NOT do X",
I mean I read the code and docs and found no X, not that I proved X impossible.

**Skills visible in this session:** `fpga-build-gate`, `gowin-gw2ar`,
`hard-net-draft-gate`, `pcb-route-gate`, `dataviz`, `update-config`,
`keybindings-help`, `code-review`, `simplify`, `fewer-permission-prompts`, `loop`,
`claude-api`, `workflow-authoring`, `run`, `init`, `security-review`.
`../workshop/skills/` contains only `example-gate` at this commit; no
PCE skill is installed yet (#3). A skill installed during this session would not
be visible until a new session starts, which is why #3 closes on a fresh session
naming it.

---

## The verdict, in advance

| part | verdict | base |
|---|---|---|
| **Renderer** (VDC + VCE in the browser) | **write our own** | I found no PCE-aware browser renderer; emulators are references/checks only (DECISIONS); HuDK's MIT `vdc.inc`/`vce.inc` is a second expression of the register facts |
| **Editor** | **write our own** | I found no PCE-aware editor; general web editors enforce a flat palette at best, not 16 palettes of 16 with a per-tile choice |
| **Viewer ROM** | **adapt HuDK (MIT)** | HuDK has a working 256×224 VDC/VCE/BAT example (`example/asm/3_map_8x8`); take its MIT libraries and write the thin PCEStudio loader/data layout |
| **Assembler** | **use PCEAS, keep it external** | PCEAS is the PCE-native assembler and HuDK's examples use it; its licence is freeware with unclear provenance, so do not vendor it. `ca65` (zlib) supports HuC6280 and is the clean fallback |
| **Image import** | **adapt SuperFamiconv (MIT)** | mature PCE palette/tile/map conversion; use as algorithm and test oracle, not as the browser implementation |
| **Emulator checks** | **Mednafen primary; ares second; Geargrafx debug** | see the emulator section and `docs/DECISIONS.md` |

---

## 1. PCE tile and palette tools

The short finding: **I found no open-source, browser-native, PCE-aware tile and
palette editor.** What exists is either a generic tile editor that knows 4bpp
planar data but not PCE palettes/BAT, or a converter that turns an image into
data. That gap is the reason the editor verdict is "write our own", not a
preference.

| candidate | licence | size | what it does | what it does NOT do | verdict |
|---|---|---|---|---|---|
| **HuDK** (`BlockoS/HuDK`), tools `encode_gfx`, `tiled2bat` | MIT | 2.0 MB | PCE ASM/C SDK; `encode_gfx` extracts 8×8 tiles, 16×16 sprites and 16-colour palettes from an indexed PNG by JSON coordinates; `tiled2bat` converts a Tiled map to BAT; `include/vdc.s`, `vce.s`, `map.s`, `sprite.s`, `psg.s` are MIT implementations of the hardware routines | not an editor; no painting UI; no palette picker; no 9-bit colour UI; no dithering/quality report; `encode_gfx` expects an indexed image and does not choose palettes for you; no browser code; no .pce export | **adapt** for viewer ROM and PCE-specific data tools; not the editor |
| **SuperFamiconv** (`Optiroc/SuperFamiconv`) | MIT | 1.7 MB | Rust CLI/library; `-M pce` does palette reduction, tile dedup, map/BAT output; `pce` = 8×8, 4bpp, 16 subpalettes × 16 colours, 2048 tiles, no flips; `pce_sprite` = 16×16/32, 16 subpalettes; map bytes carry tile index (12 bits) + palette (4 bits); quantize/dither optional | not an editor; no renderer; no VDC/VCE model; no viewer ROM; no .pce; no per-scanline effects; no 9-bit colour picker | **adapt** the algorithm or use as a test oracle; not a component to link |
| **RetroConvert** (`Kannagi/RetroConvert`) | MIT | 395 KB | C CLI; PNG/BMP/PCX to NES/SNES/MD/SMS/GG/PCE/NeoGeo/GB; PCE `-bg`/`-spr`; writes PCE tiles and palettes | no BAT/map output for PCE in the code read; no quantization/quality report; no editor/renderer/ROM | reject; SuperFamiconv is more capable and maintained |
| **bmp2pce** (`OrionSoftGames/bmp2pce`) | **no licence file** | 3 KB | 290-line C tool from 2007–2010; 16-colour BMP to PCE BG/BGRAW/SPR tiles, palette, BAT; dedups tiles in BG mode; sets VRAM/palette base | no licence; unmaintained; BMP only; 16 colours only; no editing; no quality report | **reject** (no licence) |
| **PCEAS `INCCHR` / `INCPAL` / `INCBAT` / `INCSPR`** | MagicKit freeware (see HuC licence below) | part of HuC | assembler directives that read a PCX and emit PCE 8×8 tiles, 16×16 sprites, a 16-colour palette and a BAT at assemble time | PCX only; no palette choice or dithering; no image preview; no 9-bit UI; no editor; not usable from the browser | **use only inside the phase-1 build**, not as the editor or import path |
| **Tile Molester** (`toruzz/TileMolester`) | GPL-2.0-or-later | 1.9 MB | Java desktop multi-format raw graphics editor; `.pce` filter (`CP02`, 4bpp planar); edit arbitrary binary data as tiles, palettes, undo/redo | no PCE palette-per-tile model; no BAT editor; no 16-palette/16-colour enforcement; no VCE 9-bit picker; desktop Java; GPL-2.0 would force PCEStudio GPL if code were reused | **reject** as an editor base; usable manually to inspect a dump |
| **YY-CHR.NET** | freeware, **closed source** | not measured | Windows/.NET graphics editor for many console formats; listed under Graphics on AJ/freem's PC Engine dev utilities page | no source, no licence to reuse, Windows/.NET only; no PCE-aware palette/BAT model; cannot run in the browser | **reject** (not inspectable, not reusable) |
| **TG16_Palette** (`Kitrinx/TG16_Palette`) | MIT | 106 KB | C generator of TG16/PC Engine **composite** palette files (512-entry LUT approximations) for emulators | not an editor; no tiles, no BAT, no ROM; palette generation only; no RGB UI | **reject** for authoring; potentially useful later for composite-vs-RGB checks |
| **retrogaze** (`lerugray/retrogaze`) | MIT | 759 KB | Python/FastAPI web app + CLI + MCP; enforces PCE limits on an image: 256×224, 8×8, 4bpp, 16 colours/tile, 16 BG + 16 sprite palettes, 512 colours, 64 sprites / 16 per line; palette allocation and per-tile remap; AI image generation through fal.ai with the user's key | not an editor (no painting); no VDC/VCE renderer; no BAT/VRAM map; no .pce; no viewer ROM; no scanline effects; the AI is an external paid service, not an agent in the studio; a new repository (created 2026-10-24), so maturity is unproven | **reject** as a component; **adapt** the palette-allocation ideas for photo import if they prove correct |

**What this means.** The closest thing to a PCE tile/palette editor is a generic
tile editor plus a converter. None can say "this tile uses a 17th colour" or
"this BAT entry names palette 16", which is the point of PCEStudio. The editor is
therefore ours to write.

---

## 2. HuC, PCEAS, and the MIT PCE SDK

### HuC / PCEAS

`uli/huc` (and `BlockoS/huc`, the fork HuDK's examples name) is an enhanced HuC:
C compiler, PCEAS assembler, linker, startup code, C and assembly libraries,
examples (`scroll`, `shmup`, `sgx`, `acd`, `designer`) and a test suite.

**What it does:** compiles C and assembles HuC6280 for a HuCard; PCEAS has
PCE-native bank handling and the `INCCHR`/`INCPAL`/`INCBAT`/`INCSPR` PCX
directives; the examples are working VDC/VCE/BAT/PSG code; HuC's
`include/pce/startup.asm` and `huc_gfx.asm` show the reset, interrupt and VRAM
paths.

**What it does NOT do:** it is not a renderer, editor, image converter with
palette choice, or browser tool; PCEAS's PCX import is PCX-only and has no
dithering or quality report; the C compiler has many documented limits (no
floating point, no struct-by-value, etc.); it does not produce a `.pce` from the
browser.

**Licence — the important part.** `LICENSE` says the kit "is based on material
from several sources, with the most important ones predating a general awareness
of software licensing issues"; the C compiler and assembler derive from early
1980s code with unclear status. It records three exceptions: MagicKit's
assembler source says "This program is freeware. You are free to distribute, use
and modify it as you wish"; TGEmu is GPL; parts of the test suite are GPL.
Ulrich Hecht's changes are BSD-3. So **PCEAS is freeware, not an OSI licence, and
the kit as a whole has no clean SPDX identifier** (`NOASSERTION` is correct).

**Verdict:** **use PCEAS as an external build tool** for phase 1. Do not vendor
its source or binaries in PCEStudio, and do not link the HuC runtime into the
viewer. The ROM is our code plus MIT HuDK code; the assembler stays a tool.

### HuDK — the find

`BlockoS/HuDK` is an MIT-licensed ASM and C SDK for the PC Engine. It has:

- MIT `include/` routines for VDC, VCE, BAT/map, sprites, PSG, interrupts,
  memory copy, joypad, clock and a default font;
- a reset/startup path that sets 256×224 (`VDC_DEFAULT_XRES`/`YRES`) and
  initialises VDC/VCE;
- examples from hello-world through 8×8 and 16×16 maps, sprites, scroll, clock
  and pong; `example/asm/3_map_8x8/map_8x8.s` loads a palette, tiles and BAT and
  displays a 256×224 map — a viewer minus the scroll loop;
- `encode_gfx` and `tiled2bat` for PCE data (see the table above).

**What it does NOT do:** no ready-made picture viewer; no browser editor or
renderer; no .pce export pipeline; no 9-bit palette UI; no ROM layout for
PCEStudio; the last commit is 2023-02-14; the examples name a HuC fork, not
upstream PCEAS. Most importantly, **the README advertises a cc65/ca65 toolchain,
but at commit `535f138` the tree has no `include/ca65/` directory and no
`cc65-toolchain.cmake`**, although `vce.s` contains an `.ifdef CA65` include of
the missing file and `example/asm/build.txt` names the missing toolchain. Treat
the ca65 path as unproven until someone makes it build.

**Verdict:** **adapt HuDK** for the viewer ROM. Take the MIT `include/` files and
the `3_map_8x8` example as the working base, replace the scrolling loop with a
static loader, and write our own fixed data layout (`docs/ROM_LAYOUT.md` in #8).
Keep the MIT notice and record the adaptation. This is rule 1 applied: a working
example exists and is permissively licensed.

### cc65/ca65 — the clean fallback

`cc65/ca65` is zlib-licensed and its assembler explicitly supports
`--cpu huc6280` (HuC6280 mode, a 65C02 superset); the documentation lists the
HuC6280 instruction set. It is not a drop-in replacement for PCEAS: it has no
PCE bank conventions, no `INCCHR`/`INCPAL`/`INCBAT` directives, and HuDK's
ca65 path is missing. **Verdict:** keep it as the clean fallback if the PCEAS
licence becomes unacceptable; it would need our own linker config and data
conversion, both of which we are writing anyway.

### PeterLemon/PCE — rejected

`PeterLemon/PCE` has useful minimal VDC/VCE demos (`HelloWorld`, `GreenSpace`)
and a register include, but **no licence file**, and uses a special bass
assembler fork, not PCEAS. It is readable as a second reference; it is not
reusable code.

---

## 3. Web pixel editors with palette limits

| candidate | licence | size | what it does | what it does NOT do | verdict |
|---|---|---|---|---|---|
| **Piskel** (`piskelapp/piskel`) | Apache-2.0 | 19.5 MB | plain JS/HTML/CSS web sprite editor; layers, frames, undo, palette panel; `MAX_PALETTE_COLORS = 256`; palette import (GPL, PAL, TXT, image) | the palette is a flat list of colours; frames are RGBA, not indexed; no per-tile palette assignment; no 16-colour-per-tile enforcement; no BAT/VRAM; no PCE preview | **reject** as the editor; the closest reusable JS UI, but adding PCE constraints means replacing its data model — a rewrite with extra steps |
| **Lospec Pixel Editor** (`lospec/pixel-editor`) | GPL-3.0 | 56.7 MB | browser canvas pixel editor with palette panel and Lospec palettes; layers, tools, animation | deprecated (README says no longer developed); palette is a list, not a PCE palette set; no indexed hardware model; no per-tile limit; no BAT/VRAM; GPL-3.0 would force PCEStudio GPL if code were reused | **reject** (licence and fit) |
| **Pixelorama** (`Orama-Interactive/Pixelorama`) | MIT | 82.7 MB | Godot/GDScript pixel-art tool; palette management, tilemap layers, web build | not plain JS; no PCE palette/tile/BAT rules; a tilemap layer is an art feature, not the VDC's BAT/palette model; no VDC/VCE renderer or ROM | **reject** as the editor stack; wrong runtime and data model |

**What "palette limits" means here.** All three can restrict you to a chosen
palette, and Piskel caps a palette at 256 colours. None models the PCE rule that
matters: **16 background palettes of 16 colours, plus 16 sprite palettes, with
each 8×8 tile choosing one background palette**, and a 9-bit VCE colour space.
That is why the editor is ours.

---

## 4. ppu.toys — the SNES idea

`LioraLabs/ppu.toys` is MIT (open repository; copyright Liora Labs). It is the
Rust engine behind ppu.toys:

- **What it does:** headless SNES PPU + S-DSP model, byte-accurate VRAM/CGRAM/OAM,
  modes 0–4 and 7, sprites, windows, mosaic, colour math, palette animation,
  HDMA, Lua bindings; `ppu` CLI `new`/`pack`/`unpack`/`check`/`render`/`docs`;
  60 fps checks, source budgets, sprite-overflow checks, PNG renders; 63 test
  files including golden tests; a Claude Code plugin/skill and a hosted Studio
  that edits, publishes, and exports `.sfc` ROMs.
- **What it does NOT do:** it is a **PPU playground, not a stock SNES CPU/DMA
  timing simulator** (its own docs say so); modes 5/6, interlace, overscan and
  read-only counters are not modelled; it has **no PC Engine anything**; the
  open repository does **not** contain the Studio UI or the ROM compiler/export
  — those are the hosted service, so their terms are outside the MIT repo.
- **Verdict:** **the idea is the reference, not the code.** Dennis already
  decided that nothing of ppu.toys is used — no code, text or design. This survey
  confirms the shape it proves (headless GPU model + small scripting language +
  frame-budget validator + agent link) and confirms that the PCEStudio version
  must be built from PCE facts, not by adapting SNES code.

---

## 5. Emulators — references and checks, never linked

The policy is already in `docs/DECISIONS.md`: our VDC/VCE/PSG model is ours; the
open-source emulators are references and checks; their code is not built in. This
survey names the set and records what each is good for.

| emulator | licence | what it does | accuracy evidence, and what it does NOT prove | use it as |
|---|---|---|---|---|
| **Mednafen 1.32.1** (installed at `/opt/homebrew/bin/mednafen`) | GPL-2.0 (official site and `vdc.cpp` header) | PCE / PC Engine, CD, SuperGrafx, PSG; clock-level VDC; screenshots, save states, debugger | `mednafen/hw_video/huc6270/vdc.cpp` has a clock-chunked `VDC::Run` with SAT DMA, sprite fetch and per-pixel output; it is the long-standing PCE core and the basis of the Beetle PCE forks. It is still an emulator, not the console: the manuals and a real console decide disagreements | **primary pixel/audio check**; the installed version is the reference for #5/#8/#9 screenshots. Configure native 256×224 output and no scaler/filter for pixel comparisons |
| **ares** (`ares-emulator/ares`) | ISC for ares proper; `LICENSE` also bundles third-party terms (e.g. MPL 2.0 text) — read it before any reuse | multi-system, accuracy-focused; PCE CPU, VDC/VCE/VPC, PSG; two video paths (`vdp` cycle-level and `vdp-performance`) | `ares/pce/vdp/vdc.cpp` uses `hclock()`/`vclock()` per cycle; the project's stated focus is accuracy and preservation. I found no PCE-specific golden/video test suite in the tree, so its "accuracy" is a project claim, not a PCE measurement | **independent second opinion** when our model and Mednafen disagree; never the only oracle |
| **Geargrafx** (`drhelius/Geargrafx`) | GPL-3.0 | full PCE/TG16/SuperGrafx/CD emulator; debugger with CPU/VRAM/VDC/VCE/PSG viewers; PCEAS/vasm/wla-dx symbol files; embedded MCP server | `src/huc6270.cpp` models horizontal/vertical states, line events, SAT DMA and sprite limits at clock granularity; `src/huc6260.cpp` the VCE. Its `tests/` runs the SingleStepTests 65x02 CPU JSON with 48 excluded opcodes; **no video golden tests** were found. The README's "very accurate" is the author's claim | **interactive debugger and register/VRAM inspection**, and a way to drive a ROM through MCP; not the pixel oracle |
| **Mesen2** (`SourMesen/Mesen2`) | GPL-3.0 | multi-system; PCE core (`Core/PCE/PceVdc.cpp`, `PceVce.cpp`, `PceCpu.cpp`), debugger, PCEAS symbol importer | cycle-ish VDC with sprite evaluation and BAT; I found no independent PCE video accuracy evidence for its PCE core | **fallback third opinion** only; do not make it the reference |
| **Beetle PCE / Beetle PCE Fast** (`libretro/beetle-pce-libretro`, `...-fast`) | GPL-2.0 | standalone forks of Mednafen's PCE and PCE Fast cores for libretro | the VDC code is Mednafen's; the fork adds libretro glue | **redundant** while Mednafen is installed; use only if a libretro harness is needed |
| **jspce** (`yhzmr442/jspce`) | MIT | PC Engine emulator in JavaScript, browser demo, assembly test ROMs | no accuracy tests or evidence found; a hobby emulator | **reject as a check**; it does show a browser PCE model is feasible, which is useful context for #5, not an oracle |

**Chosen set (recorded in `docs/DECISIONS.md`):** Mednafen is the primary
pixel/audio check; ares is the independent second opinion; Geargrafx is the
debugger/VRAM/register check and the MCP-capable ROM runner; Mesen2 is a
fallback only. No emulator source is copied, linked or built into PCEStudio.
GPL-2.0/3.0 code is reading material; ISC code is still not built in, by the
project decision.

**What we still need to measure, not assume:** that Mednafen's native output can
be captured without scaling/filters for a pixel-exact diff; that its PCE core and
ares agree on the three #5 fixtures; and that a real console/PCEHeroTN agrees
where they do not. Those are #5/#8 evidence, not #1.

---

## 6. What this means for the build

### Renderer — write our own
No existing PCE-aware browser renderer was found. `jspce` is an emulator, not a
renderer library; ppu.toys is SNES and is not a source; retrogaze does constraint
checks, not VDC/VCE drawing. Write the JS VDC/VCE model from the HuC6270/HuC6260
manuals, with HuDK's MIT `vdc.inc`/`vce.inc` as a second expression of the
register facts and Mednafen/ares as checks. This is also what DECISIONS already
requires.

### Editor — write our own
I found no PCE-aware editor. General web editors cannot express 16 palettes of
16 with a per-tile choice, the BAT, or the VCE's 9-bit colour space. Write the
editor in plain JS, with the constraint checker as the first feature (a 17th
colour or a 17th palette must be refused). Borrow ideas from Piskel's simple
canvas/undo model, not its RGBA data model.

### Viewer ROM — adapt HuDK, assemble with PCEAS
Use HuDK's MIT `include/` and `example/asm/3_map_8x8` as the working base: it
already does the 256×224 VDC/VCE init, palette load, tile load and BAT copy.
Replace the scroll loop with a static picture loader, add the PCEStudio data
layout, and assemble with PCEAS. Keep the MIT notice. If the PCEAS licence blocks
distribution later, ca65 (zlib, HuC6280) is the fallback, but HuDK's advertised
ca65 path is missing at commit `535f138` and would need work.

### Image import — adapt SuperFamiconv
Use its PCE mode (16 subpalettes × 16 colours, 4bpp, dedup, optional quantize) as
the algorithm and as an independent byte oracle in tests. HuDK's `encode_gfx`
and `tiled2bat` are the PCE-specific MIT references for palette/tile extraction
and BAT generation. The browser implementation is ours.

### What is worth keeping from this survey (#3)
The hardware-constraint table and the "does NOT do" reasons above are worth
packaging as a `pce-hardware-limits` skill for @design and the AI link: the PCE
limits, the 9-bit colour packing, the BAT entry layout, and the common traps
(sprite line limit, palette 0, VCE writes in blank). #3 owns installing it and
having a fresh session name it out loud; surveyed is not installed, installed is
not loaded.

---

## Sources inspected

Cloned and read (commit at time of reading):

- `BlockoS/HuDK` — `535f138`
- `uli/huc` — `52a556a`; `BlockoS/huc` — `fae5b0b` (same HuC licence)
- `pceas` source is `uli/huc` `src/mkit/as/` (main.c carries the freeware statement)
- `cc65/cc65` — `src/ca65/main.c`, `src/common/cpu.c`, `doc/ca65.sgml`
- `Optiroc/SuperFamiconv` — `5665222`
- `Kannagi/RetroConvert` — `f8492ad`
- `toruzz/TileMolester` — `50fb208`
- `piskelapp/piskel` — `1b58303`
- `lospec/pixel-editor` — `e22aba4`
- `LioraLabs/ppu.toys` — `0b07767`
- `lerugray/retrogaze` — `5276809`
- `drhelius/Geargrafx` — `37db456`
- `PeterLemon/PCE` — no licence file; read examples only

Read through the GitHub API (not cloned):

- `ares-emulator/ares` — `LICENSE`, `ares/pce/vdp/vdc.cpp`, `ares/pce/vdp/vce.cpp`
- `SourMesen/Mesen2` — `Core/PCE/PceVdc.cpp`, `PceVce.cpp`, `PceCpu.cpp`
- `libretro/beetle-pce-libretro` — PCE core tree
- `yhzmr442/jspce` — tree and README
- `Orama-Interactive/Pixelorama` — tree, `LICENSE`, README (not every source file)
- `Kitrinx/TG16_Palette`, `OrionSoftGames/bmp2pce`, `soiaf/NES2PCE` — source trees

Not inspected: YY-CHR.NET (closed source; no code to read), Aseprite, LibreSprite,
GrafX2 (licence/desktop rejection is enough; they are not web and not PCE-aware),
MAME, BizHawk (not needed once Mednafen/ares/Geargrafx were chosen).
