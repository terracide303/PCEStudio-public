# ppu.toys — how it builds its toys, and what PCEStudio takes from it (#53)

**What was read.** [github.com/LioraLabs/ppu.toys](https://github.com/LioraLabs/ppu.toys) at
commit `0b077674b7ca656b49420edb14df70bc89d19541` (main, 2026-10-18) — a clone in `$TMPDIR`,
never inside this repo. MIT, Copyright (c) 2026 Liora Labs (`LICENSE`). The CLI/engine is
`ppu-cli` 0.1.0 over `ppu-core` 0.1.0; the Claude Code plugin is 0.3.0. Opened: the README,
`crates/ppu-core/src/lua.rs` (module comment, bindings, `set_sources`, `frame`, `read_state`),
`lua_raster.rs`, `kit.lua`, `ramps.lua`, `controls_env.lua`, `crates/ppu-cli/src/{main,lib,
author,docs}.rs`, `crates/ppu-cli/docs/{cli,scanlines,pad,sram,sources}.md` in full (the other
eight topic docs by title and the skill's summary), the plugin's `SKILL.md`, metadata, recipes
and scripts, the golden/tutorial/corpus/CLI test harnesses and the workspace's test names, and
`.github/workflows/ci.yml`. Not opened: the five example toys' Lua, the DSP/audio and
importer internals beyond the budget structs, and `vendor/piccolo` beyond its stdlib split.

**Licence and reuse.** The 2026-10-28 `DECISIONS.md` entry (corrected by Dennis) allows
ppu.toys' **code as well as its ideas**, with the MIT notice kept and credit given. The card
asks for a reuse judgement per part, so each section ends with one. Nothing below is copied:
the paths and symbols are citations, and the prose is ours.

**The one-line verdict.** ppu.toys is the working example of exactly the two things PCEStudio
has not built yet — a small Lua toy runtime over a hardware model, and a CLI that renders,
checks, packs and hands the result to an agent. Its **shapes** are worth taking almost
entirely. Its **code** is worth taking only where the code is language-neutral (the toy-side
Lua helpers and the file format); the Rust engine, validator loop and golden harness are
templates to re-implement in our JavaScript/Python/PCEAS stack, not files to import.

| part | what ppu.toys does | verdict for PCEStudio | cards |
|---|---|---|---|
| Lua runtime | `init()` / `frame(t,f)` / `hdma(first,last,fn)` / `raster(rows)` / `timer()` / `pad` / `sram` over a register-and-memory DSL | **adapt** the surface and the rules; the portable Lua helpers are the only code worth taking | #30, #31, #24 |
| validator | plays every frame at 60 fps, counts sprite overflow per line, prints source budgets, refuses overflow, proves seek/loop determinism | **adapt** the loop and the report shape; add the cycle/HBlank checks the SNES does not need | #32, #33 |
| CLI + file format | `new/pack/unpack/check/render/docs`; a versioned, self-contained JSON envelope | **adapt** the format and the verbs; re-implement in JS/Python | #31, #32 |
| agent link | a Claude Code plugin with one skill, recipes, five worked examples and CLI helper scripts; the Studio's MCP link is not in this repository | **adapt** the skill shape and the helper scripts; the MCP server is ours to build | #36, #24 |
| tests | committed golden PNG/PCM, `#[ignore]` regen tests, doc fences run as tests, a corpus digest, CLI round-trips | **take the shapes**; our oracle is stronger (Mednafen/ares), so keep it | #33, #31, #32 |

---

## 1. The Lua toy runtime

### What a toy gets

One shared global environment. A project lists its Lua files in order; they run top to bottom
into the same globals (`main.lua` is convention, not special — `set_sources` in `lua.rs`).
Before the user's files, a `kit` chunk installs sequencer sugar (`note`, `instrument`, `sfx`,
`bank`, `score`, and a `song` stub that errors); a user file defining the same name wins.

The globals a toy can touch (`lua.rs::install_bindings`, `crates/ppu-cli/docs/*.md`):

- **Entry points:** `init()` runs once; `frame(t, f)` runs once per frame with seconds and the
  60 Hz frame number. Top-level statements are setup, like `init()`.
- **Per-line effects, two ways:** `hdma(first, last, function(y) ... end)` (alias `scanline`)
  runs a Lua callback for an inclusive line range and may change display, background, Mode 7,
  screen, window, colour-math and CGRAM state for that line only; `raster(rows)` takes 224
  precomputed register snapshots (0..223) for a port that emits raw register writes — no Lua
  per line, pixels still through the same PPU (`lua_raster.rs`).
- **Time:** `timer(n, div, fn)` hooks registered in the init window, phased onto the audio
  timeline.
- **Input:** `pad` — one flat table of booleans (`up`…`select`), refreshed before every
  `frame()`. Edge detection is left to the toy.
- **Saves:** `sram` — a Lua table persisted per published toy, with a 32 KiB cap
  (the size of a real cartridge's SRAM) and a restricted value set (numbers/strings/booleans/nested
  tables; anything else is an error naming the path).
- **Memory and registers:** `vram[]` (word pokes), `cgram[]` (palette), `obj[0..127]` (OAM),
  `aram[]`, `voice[]`, `dsp`; friendly register fields (`mode`, `brightness`, `bg[1..4]`,
  `m7.*`, `screen.main/sub`, `win`, `color`) with raw aliases.
- **Asset placement:** `dma(name, opts)` inside the init window places an imported source and
  returns its addresses/cells.
- **Helpers:** `clamp`, `lerp`, `lerp_color`, `ramp`, `ramp_int`, `ramp_color`, `ease`
  (`ramps.lua`), plus math aliases (`sin`, `floor`, `min`, …) as flat globals.

### How a frame is made

`lua.rs`'s module comment states the pipeline, and the code pins the order: run `frame(t, f)`
once to populate frame-wide defaults + CGRAM/OAM and to register hooks; run the `timer`
hooks; run the program's `hdma` hooks; apply the generated `ppuglobals.lua` document as a
synthetic frame-wide hook spliced **after** the program's own hooks; then resolve the line
table by invoking each covering hook per scanline, **later call wins**. Hooks live for one
frame — register them inside `frame()`.

The generated-document path is the interesting one (`controls_env.lua`). `ppuglobals.lua` is
compiled against a **tracked environment**: every global read/write, including nested table
fields, passes through a proxy that logs `(real table, key, old value)` before the write.
At the end of the frame the log is replayed backwards, so a panel override, once released,
never bakes into the program's baseline or compounds an accumulator. The generated document
only ever does scalar reads/assignments and `hdma()` calls; the file says which forms it does
not support. This is what lets the Studio panels and the user's code write the same
registers without becoming a second source of truth.

### The sandbox, and what "inside the limits" actually means

- **No I/O VM.** `Lua::core()` loads only base, coroutine, math, string and table
  (`vendor/piccolo/src/lua.rs`); I/O is a separate `load_io()` that is never called. There is
  no `os`, `package` or native module, and the host functions are Rust bindings — the toy
  cannot reach the filesystem or the network.
- **The tables are the hardware.** `vram`, `cgram`, `obj`, `aram` are plain Lua tables the
  engine mirrors into PPU memory each frame; they are not pointers into the emulator.
- **Bound checks that exist:** `raster()` refuses anything but 224 rows, byte values outside
  0..255 and palette values outside 0..32767; `dma()` validates source names/kinds and
  placement addresses/alignment and only works inside the init window; SRAM serialization
  caps size at 32 KiB, depth at 32, and names the offending path on a bad value.
- **What does not exist:** there is **no instruction budget, no fuel limit, no wall-clock
  cap and no memory quota** — a runaway `while true do end` hangs the CLI. This is worth
  stating plainly: ppu.toys' sandbox is a *capability* sandbox (no I/O, a fixed API), not a
  *cost* sandbox.
- **Out-of-range values wrap.** Register fields are masked when the line row is built
  (`mode` to 3 bits, `brightness` to 4, `TM` to 5, …; comments in `read_state`), which is what
  the hardware does with the register. A toy writing nonsense does not get an error; the
  picture is what the chip would show.
- **Limits that are enforced live elsewhere:** the PNG importer reports every overflow
  (colours, palettes, tiles, crop) instead of silently truncating (`import/mod.rs`,
  `source.rs::SourceMeta`); `check` computes per-line sprite statistics and refuses overflow;
  and the **cartridge compiler** (the Studio's SNES panel, not this repo) enforces declared
  integer ranges written as `---@snes range` annotations in the toy.

The honest summary: the runtime **models**; the validator **refuses**; the compiler
**enforces declared ranges**. Three different jobs, three different layers. That split is the
most useful thing in this section.

### What cards #30, #31 and #24 should learn

- **#30 (`init()`, `frame(t, f)`, `raster(line)`, `pad[1..5]`, `password`).**
  - Copy the entry-point contract: `init()` once, `frame(t, f)` per frame, state persists
    across frames, a shared global scope, errors carry **file and line**.
  - Offer the per-line effect **twice**: a callback (`raster(line)`) for code, and a
    precomputed table for static effects. #17 already produces the table; the toy runtime
    should expose it rather than re-derive it. On the PCE these are *not* equivalent in cost
    (below).
  - Keep input a flat, refreshed table and leave edge detection to the toy; document the
    mapping. `pad[1..5]` is the PCE's own shape, not ppu.toys' single `pad`.
  - Keep ppu.toys' save **contract** — a typed, size-capped value with a named error — but
    not its medium: PCEStudio's saves are passwords (Dennis, 2026-10-28), so pack the state
    into a short code, show it, accept it back and refuse a wrong one (see below).
- **#31 (compile through PCEAS).** ppu.toys does not compile Lua in this repo; its skill
  defines the compilable subset up front: integer/fixed-point state, declared ranges, bounded
  loops, constant `dma()` placement, no strings or general tables at run time. **Define
  PCEStudio's compilable subset before the first toy**, because retrofitting is a rewrite.
  Annotate persistent state (`---@pce range …`), and make the browser runtime and the
  compiler share one validator so "same in the browser and Mednafen" is testable frame by
  frame.
- **#24 (describe it, get it).** The generated-document + tracked-environment pattern is the
  right output for an agent: the AI writes **editable register state**, the panels and the
  human can change it, and releasing an override restores the toy's own value. Do not let
  "describe it" bake a picture; let it produce the same raster table / palette / tile writes
  the editor produces.

### What does not carry over to the PC Engine

- **Per-line Lua costs nothing at run time on the SNES; on the PCE it is an interrupt.**
  ppu.toys runs a Lua callback per line and resolves a per-line table; the SNES has hardware
  HDMA to do the equivalent without CPU work. The PC Engine has no HDMA: the only per-line
  trigger is the **RCR line interrupt** (`docs/SPEC.md`, "HDMA (a table per line) → the line
  interrupt (RCR)"). Each change costs an ISR, and the ISR must read SR and restore AR; the
  counter starts at 64, so **RCR below 64 never fires** and RCR=0 disables it
  (`docs/MANUALS.md` §8, Hudson Tech Notes pp. 8–9). A 224-entry gradient is cheap on the
  SNES and expensive on the PCE — the runtime must expose the difference, and #32 must price
  it.
- **Frame cost is real and countable.** One 60 Hz frame is **≈119,904 machine cycles at
  7.16–7.19 MHz**, and the main loop must fit (`docs/MANUALS.md` §8 p. 1–2, §6). Instruction
  costs come from the Software Manual S8-17…; there is no equivalent measurement in ppu.toys,
  so a PCE validator that only counts sprites would miss the main risk.
- **A save has no medium on a bare HuCard.** ppu.toys' `sram` is a cartridge battery. The
  PCE's 2 KB backup RAM is the CD unit's IFU-30, reached through BIOS calls; a bare HuCard has
  none (`docs/MANUALS.md` GAP 5, §6 CD manual pp. 23–25). Dennis has settled the PCE side:
  **saves are passwords** (`docs/DECISIONS.md` 2026-10-28, `docs/SPEC.md`), so #30's `bram` is
  gone — take the typed/capped/named-error contract and apply it to the password payload, not
  to a save medium.
- **One pad is not five, and the pad is 2-button.** ppu.toys has `pad` (one controller, 12
  buttons). PCEStudio's pads are **I, II, Select, Run**, up to five through a multitap; the
  6-button pad is left out because no manual here documents it (`docs/SPEC.md`,
  `docs/DECISIONS.md` 2026-10-28, `docs/MANUALS.md` GAP 10). The ppu.toys button names
  (`a/b/x/y/l/r`) do not map onto the PCE's I/II/Select/Run.
- **The register vocabulary is the SNES's.** `bg[1..4]`, `m7.*`, 128 OAM entries, windows,
  colour math and mosaic have no PCE counterpart (`docs/SPEC.md` table: one BG layer, no
  Mode 7, no colour math/windows/mosaic). The PCE surface is one BAT + one SAT + `BXR/BYR/
  CR/RCR` + VCE CRAM, with 64 sprites and **16 per line counted as 16-pixel strips**
  (`docs/MANUALS.md` §3.6 H7-19, §14).
- **The tile budget is different, though the VRAM is the same size.** ppu.toys prices
  1,024 addressable tiles; the PCE has **2,048 character definitions** in the same 32,768
  words (`docs/MANUALS.md` H7-13), a 512-entry CRAM of 9-bit colours (H6-1), and a ROM that
  must fit through 8 KB MPR banks (H8-10/11, GAP 4 → #46).

### Reuse: code and cost

The whole engine also compiles to WebAssembly for the site (`README.md`). That is the
architecture PCEStudio deliberately did **not** take: our model is JavaScript in the browser
(`docs/DECISIONS.md` 2026-10-27), so running ppu.toys' Rust engine would mean a second model,
not a reused one.

| ppu.toys | licence | reuse for PCEStudio | cost |
|---|---|---|---|
| `kit.lua`, `ramps.lua` (toy-side helpers) | MIT | **adapt** — the interpolation/clamp/easing surface and the note maths are portable Lua and match what #17/#24 need; keep the notice | low |
| `controls_env.lua` (tracked write log) | MIT | **adapt** — it is plain Lua and the pattern, not the SNES names, is what #24/#36 want | low–medium |
| `lua.rs` / `lua_raster.rs` (Rust VM + SNES DSL bindings) | MIT | **do not take** — the bindings encode the SNES register model, and the VM is Rust (piccolo, MIT, also usable as WASM) | high: a WASM VM would put a second engine beside our JavaScript model, against `DECISIONS.md` "our own model", and the model would have to move too |
| piccolo (vendored 0.3.4) | MIT / CC0 | optional offline runner only | high |

**Where seen:** `crates/ppu-core/src/lua.rs` (module comment, `set_sources`, `frame`,
`install_bindings`, `read_state`, SRAM at `SRAM_MAX_BYTES`), `lua_raster.rs`, `kit.lua`,
`ramps.lua`, `controls_env.lua`; `crates/ppu-cli/docs/{scanlines,pad,sram,sources,registers}.md`;
commit `0b07767`.

---

## 2. The validator

`ppu check` (`crates/ppu-cli/src/author.rs::check`, `main.rs`) is the whole validator. It:

- **Plays the toy from frame 0 to the end, at 60 fps, including the endpoint.** `--duration`
  defaults to 30 s; times round to the nearest 60 Hz frame.
- **Counts sprite overflow on every continuous frame.** `render_frame_stats` returns
  `range_over` (more than 32 sprites in range) and `time_over` (more than 34 eight-pixel
  slivers), plus the busiest line's `max_sprites` / `max_tiles`. Any overflow **fails** the
  check unless `--allow-overflow` is given for an intentional effect; the message names the
  frame, the time and both counts.
- **Prints every source's budget** (`source {name}: {meta}`) — the importer's palette, tile
  and VRAM accounting and its overflows. Those are **informational**: they are printed for a
  human to review, not refused. `docs/cli.md` says so explicitly.
- **Proves seeking and looping are deterministic** when asked. `--seek` re-renders sampled
  frames (a) by backward seek on the continuous runner and (b) on a fresh engine, and compares
  pixels with continuous playback. `--loop` adds samples at zero, quarter, half, three-quarter
  and the last frame, then compares each one period later. Mismatches fail with the frame.
  These comparisons are optional for stateful games.
- **Checks the packed artifact too.** `check` accepts a project directory or a `.ppu.json`;
  the skill tells the agent to pack and re-check the packed file.
- **Reports errors as `file:line: message` plus `frame N at T s`.** `pack` alone does not
  execute Lua, so a check is the only way to know the toy runs.

What it **refuses**: sprite overflow (hard), Lua compile/runtime errors (hard), an invalid or
wrong-version packed file, duplicate/unsafe file names, a missing `main.lua` (hard). What it
**reports but does not refuse**: colour quantization, palette remapping, tile clipping,
cropping — the importer's honest overflow list. What it **does not check at all**: CPU time,
instruction count, how long an init or a hook takes, or whether a register value is in range.
The 60 fps is the **sampling grid**, not a cycle budget.

### What cards #32 and #33 should learn

- **#32 (the validator).**
  - Run the **whole** performance, not a sample, and **include the endpoint**; a seam at the
    loop point is exactly where a cut shows.
  - Separate **hard failures** from **informational reports**, and print the reports anyway.
    PCEStudio's equivalent: the importer's quantize/crop report and the VRAM map are
    information; the sprite budget, the frame-cycle budget and the HBlank rule are failures.
  - Add an explicit **opt-out** for intentional overflow (`--allow-overflow`), so an honest
    effect is not a special case in the code.
  - **Check the packed/exported artifact**, not just the source tree.
  - Make **determinism** a check (seek + loop), not a hope: a toy that accumulates floating
    state breaks a loop, and that is a real bug on the PCE too.
  - **Name the bound in the message.** ppu.toys prints `range=… tiles=…`; our refusals should
    print the register/line and the measured value, the way #52's editor refusals already do.
  - Add what ppu.toys does not have: **cycles**. 119,904/frame is the budget
    (`docs/MANUALS.md` §8); instruction costs are in S8-17…; the RCR ISR and the HBlank rule
    are part of it. A toy that passes sprite budgets and misses the frame is the failure mode
    this validator must catch.
- **#33 (Phase 3 read cold).** The cold review should ask the five questions this repo's
  validator makes answerable: (1) is every frame of the performance compared, including the
  endpoint; (2) does each refusal name its bound and its line; (3) is seek/loop determinism
  proven or explicitly waived for a stateful game; (4) is the packed artifact checked; (5) is
  the cycle/HBlank budget measured, not assumed. And apply our rule 2: a break someone else
  chose must be caught.

### What does not carry over to the PC Engine

- **The sprite limits are not the SNES's.** ppu.toys refuses more than 32 sprites or 34
  slivers on a line. The PCE allows **16 sprites, counted as 16-pixel strips**, and sets the
  VDC's OR status on an attempt at 17 (`docs/MANUALS.md` §3.6 H7-19/H7-4, §14). A 32-px CGX
  sprite spends two strips. The validator must count strips, not sprites — #12/#40 already
  measured this in the renderer.
- **VCE writes have a timing rule the SNES validator never needed.** Writes during active
  display leave dots; the raster table places them in the horizontal blank
  (`docs/SPEC.md`, "PC Engine tricks" 2). The manual does not settle mid-line write timing and
  #15 records it as not proven — so the validator must be explicit about which lines it
  allows a CRAM write on, and say what it does not know.
- **The PCE's per-line registers are one interrupt, not a table.** `BYR`/`BXR` written during
  display show from the next line (`BYR+1`) (`docs/MANUALS.md` H7-7, §8 Tech Notes 8–13) and
  an RCR below 64 never fires; a validator must refuse those, not silently model them.
- **The PCE has different value ranges**: BXR 1023 / BYR 511 (anything above is refused —
  #52), 512 CRAM entries, sprite Y/X 0–1023, 262 or 263 lines per frame (GAP 7), 2,048
  characters at 32K words (H7-13), and ROM fit through 8 KB MPR banks (GAP 4, #46).
- **Output levels are not settled.** The VCE's RGB-output page (H6-6) is missing from our
  scan (GAP 13), so a check that claims an 8-bit colour match would be claiming more than the
  manuals support; our comparisons stay at the 3-bit colour (`docs/ARES.md`, #41).
- **The SNES has hardware HDMA and a fast PPU bus; the PCE does not have the same budget.**
  Copying the SNES check would pass toys that overrun the PCE frame.

### Reuse: code and cost

`author.rs::check` is ~75 lines of Rust over the engine; `ObjOverflow` (range/time, busiest
line) is the shape worth copying. Re-implement in JavaScript against our model (the editor
and renderer are already JS) — **template, not import**. Cost: low. Do not take the Rust loop
itself; it calls a Rust line-table API we do not have.

**Where seen:** `crates/ppu-cli/src/author.rs` (`check`, `render`, `frame_number`,
`parse_times`), `crates/ppu-cli/src/main.rs`, `crates/ppu-core/src/lib.rs::ObjOverflow`,
`crates/ppu-core/src/compositor.rs::render_frame_stats`,
`crates/ppu-core/src/import/mod.rs::Overflow`; `crates/ppu-cli/docs/cli.md`; commit `0b07767`.

---

## 3. The CLI and the file format of a toy

### Commands

One binary, one verb per job (`main.rs`, `docs/cli.md`):

- `ppu new <dir>` — scaffolds a complete animated project (manifest, `main.lua`,
  `ppuglobals.lua`, an editable `assets/floor.png`). **Refuses an existing directory** so a
  project is never clobbered.
- `ppu render <dir|file> --at seconds,... -o <dir>` — plays **from zero** through the last
  sample (stateful animation is preserved) and writes native 256×224 RGBA PNGs named
  `frame-00000120.png` (frame 120 = 2 s). Existing matching PNGs are replaced.
- `ppu check <dir|file> [--duration s] [--seek s,...] [--loop s] [--allow-overflow]` — §2.
- `ppu pack <dir> [-o out.ppu.json]` — the editable manifest and its assets into one
  self-contained upload file. **Does not execute Lua.**
- `ppu unpack <file> <dir>` — back to a project directory; converted payloads land under
  `.ppu/sources/`. **The original PNG is not recoverable** from the converted data, and the
  docs say so.
- `ppu docs [topic|all]` — the authoring guides are `include_str!`-ed into the binary
  (`docs.rs`), so an installed binary never points at a stale checkout.
- `ppu --version` prints the engine/file version (`ppu.toys/1`).

### Two shapes of a toy

**Project directory (editable).** `ppu.json`:
`{title, description, files: [names in execution order], sources: [...], origin?}`. Each
source is `{name, kind, options, meta, payload? | file?, priority_file?}` — exactly one of a
PNG `file` or a binary `payload`; `kind` is `bg`, `sheet`, `obj`, `m7` (and `song` for audio).
Lua files are flat names run in order. PNG paths are relative, with `..` and absolute paths
refused (`safe_relative`).

**Packed file (upload).** A versioned envelope, `"version": "ppu.toys/1"`:
`{version, title, description, files: [{name, source}], sources: [{name, kind, builtinId,
options, meta, payload(base64)}], origin: {id, revision, authorId}?}`. It carries all Lua and
all converted graphics, so it opens with no external files. `unpack` validates **every** file
name and decodes **every** payload before writing anything (`valid_file_name`,
`BASE64.decode` in `lib.rs`).

### Guards worth copying

Path/name validation on both directions, a version check with a named error, duplicate-name
refusal, `main.lua` required, a `new` that refuses to overwrite, and a `pack` that does not
execute code. The format is deliberately **lossy on unpack**: converted data is not art, and
the tool says so instead of pretending.

### What cards #31 and #32 should learn

- **#31 (compile and run the same).** A versioned envelope with base64 payloads is exactly
  the artifact an agent and a human can pass around without a checkout. PCEStudio's analogue
  should carry the toy's Lua, the picture/model config and the source metadata (palette/tile/
  VRAM/ROM cost), and should be checkable in the same command the editor's export uses.
- **#32 (validator/export).** "`pack` does not run the code; `check` the packed artifact"
  is a cheap, strong rule. Our export already refuses past the 80 KB / bank limit (#46) and
  the editor refuses with codes; the CLI should reuse the same refusals, not a second copy.
- **A `new` that works out of the box** and a **`docs` that ships with the tool** are what
  let an agent start without cloning anything — the lesson #36 needs too.

### What does not carry over to the PC Engine

- **The source kinds are the SNES's.** `bg/sheet/obj/m7` assumes four BG layers, OAM cells and
  Mode 7. The PCE needs its own kinds: one BAT + character set, sprite patterns at 16×16…
  32×64 with CGX/CGY, 16 BG + 16 sprite palettes, no Mode 7 (`docs/SPEC.md`; `docs/MANUALS.md`
  §3.6).
- **The file format has no ROM.** ppu.toys' CLI produces a packed toy, not a cartridge; the
  ROM is built by the Studio, whose UI and compiler are not in this repository. PCEStudio must
  produce **two** images — `.pce` and the bit-reversed TurboGrafx image (`docs/DECISIONS.md`
  2026-10-27/28, #25) — and PCEAS is an external tool (`DECISIONS.md` 2026-10-27), not a crate
  dependency.
- **The 256×224 / 60 fps constants are the SNES's.** The PCE's window is a choice
  (256/336/512 px, 224/240 lines — #27/#48, GAP 1) and one 60 Hz frame is ~119,904 cycles,
  not an SNES frame.
- **The manifest's `meta` is an importer report, not a hardware contract.** Our equivalent
  must carry PCE budgets (2,048 characters, 32,768 VRAM words, 512 CRAM entries, ROM banks),
  or it repeats the SNES numbers under a PCE label.

### Reuse: code and cost

`lib.rs::pack` / `unpack` (~230 lines Rust incl. the manifest structs) is a **direct
template**: the field names, the one-of `file|payload` rule, the validate-before-write order
and the version gate are worth reproducing. Re-implement in JavaScript (browser export) and
Python (tools) so both share one schema definition — cost low. Do not import the Rust crate.
The exact JSON shape is a design take, not code.

**Where seen:** `crates/ppu-cli/src/main.rs`, `lib.rs` (`pack`, `unpack`, `valid_file_name`,
`safe_relative`, `FileBody`), `docs.rs`, `author.rs::new_project`;
`crates/ppu-cli/docs/cli.md`; `crates/ppu-cli/tests/author.rs` (the end-to-end chain);
commit `0b07767`.

---

## 4. The agent link

### What is actually in the repository

The repo is honest about the split: the **Studio's agent link is not in this repository**;
the open agent surface here is a **Claude Code plugin** and the **CLI**.

- `plugin/.claude-plugin/plugin.json` — marketplace metadata for `ppu-toys@lioralabs`.
- `plugin/skills/creating-demos/SKILL.md` — one skill. It tells the agent to run
  `ppu --version`, `ppu --help`, `ppu docs registers`, and to read only the topic docs it
  needs; to keep `ppu docs` as the source of truth because the docs ship inside the binary;
  to use the CLI (`new`, `render`, `check`, `pack`); to **look at the PNGs** and critique
  them (it says a successful check is not visual review, and to plan on at least three
  passes); and it gives the limits in the skill itself (128 OAM but 32 sprites/34 slivers a
  line, modes 0–4 and 7 only, no modes 5/6/interlace/overscan/read-only counters).
- `plugin/skills/creating-demos/recipes.md` — worked recipes for the effects that make a demo
  look impossible, with the Lua and hardware gotchas.
- `plugin/skills/creating-demos/examples/` — five complete toys (Mode 7, HDMA, colour math,
  windows, a sprite + music finale), each with a deterministic `build_art.py`, a
  `ppu.json`, Lua and a README.
- `plugin/skills/creating-demos/scripts/contact.py` and `film.py` — ~30 lines each, calling
  `ppu render` to make a labelled contact sheet (Pillow) or a nearest-neighbour MP4 (ffmpeg).
  The agent is told to render a contact sheet, name what is weak, fix it and render again.
- The Studio's agent link appears only as a cross-reference: `SKILL.md` notes that, with the
  Studio's agent link connected, two tools — `snes_check` and `export_rom` — do the same from
  the agent's side. No MCP server, tool schema or register API is in this repository.

### How an agent reads and sets state

In practice: by **editing the same files the human edits** — `main.lua`, the manifest,
`ppuglobals.lua` (the generated, tracked document), and PNG sources — then running
`render`/`check`. The read path for pixels is a rendered PNG the agent opens; the check's
stdout is the read path for budgets and errors. The agent never gets a private API. That is
the design: **the CLI is the agent protocol**.

### What cards #36 and #24 should learn

- **#36 (MCP server).**
  - Expose the **same engine and the same verbs** the editor uses. ppu.toys' skill works
    because `ppu render` is the engine, not a copy of it. An MCP server that re-implements
    state would give the agent and the human different truths.
  - Tool names should be verbs on that engine: `read_state`, `set_register`/`set_cells`,
    `render_frame`, `check`, `export_rom` — the direct PCE analogue of `snes_check` /
    `export_rom`, plus the read/set tools PCEStudio's card names.
  - Make agent writes **tracked and reversible** (the `controls_env` pattern): log the old
    value with the write, so releasing an override restores the toy and nothing compounds.
  - Ship the **limits in the tool's own docs** and make `check` return named failures, so the
    agent can fix a refusal without guessing.
  - Give the agent a **cheap iteration loop**: render at chosen times, render a contact sheet,
    run the validator; and make seek/loop deterministic so a frame is reproducible.
  - Make it say what it does **not** model (ppu.toys' skill lists modes 5/6, interlace,
    overscan and read-only counters). Our MCP server must say the PCE's open gaps the same
    way: the missing VCE page, 262/263 lines, the unproven mid-line VCE write, no 6-button
    pad source.
- **#24 (describe it, get it).**
  - The skill is the loop: **think in registers/tiles/palettes/lines**, read the closest
    worked example first, generate art deterministically (a seeded `build_art.py`, not
    one-off bytes), render, critique like an art director, repeat at least three times.
  - Hand back the **editable** artifact (Lua + the generated document + the raster table), not
    a flattened image. The human must be able to change one value by hand.
  - The effect recipe book should be PCEStudio's own: `docs/SPEC.md`'s ten "PC Engine tricks"
    (line-scroll parallax, per-line palette, sprites as a second layer, flicker multiplexing,
    road/floor, palette cycling, big BAT, wide modes, RCR splits, PSG). The SNES recipes
    (Mode 7, HDMA matrices, windows, colour math) have no PCE counterpart.

### What does not carry over to the PC Engine

- **Every tool name and register name in the skill is SNES.** `snes_check`, `export_rom`,
  `mode`, `m7`, `obj[0..127]`, HDMA, windows, colour math are not the PCE's
  (`docs/SPEC.md` table; `docs/MANUALS.md` §3.6/§4).
- **The Studio link is not in this repository**, so PCEStudio cannot reuse it; #36 is ours to
  build. The open part — the plugin/skill — is the model to copy.
- **The limits the skill teaches are different**: 32 sprites/34 slivers vs 16 strips, 128 OAM
  vs 64 SAT, 15-bit BGR555 vs 9-bit GBR, 1,024 addressable tiles vs 2,048 characters (both
  32K words of VRAM), 256×224 vs a 256/336/512 window, and a PCE save with no HuCard medium
  (GAP 5).
- **The "three passes" rule is universal**, but the failure modes it names (sparse Mode 7
  planes, banding in 15-bit colour, clipped windows) are not the PCE's. Our checklist is the
  one in `docs/SPEC.md`: backdrop/border, colour-0, sprite strips, HBlank writes, palette
  cycling.

### Reuse: code and cost

`contact.py` and `film.py` are small, CLI-agnostic Python: **adapt directly** by pointing
`PPU` at our CLI and using 256×224 frames; cost low (Pillow / ffmpeg). The skill **shape**
(one skill, topic docs, recipes, worked examples, render-and-look) is the take; the prose
must be rewritten for the PCE, and the examples rebuilt on the PCE's tricks. Do not copy the
SNES examples or prose. The MCP server: nothing to take — build it on our model.

**Where seen:** `plugin/.claude-plugin/plugin.json`,
`plugin/skills/creating-demos/{SKILL.md,recipes.md,scripts/contact.py,scripts/film.py}`,
`plugin/skills/creating-demos/examples/`; `README.md` install lines; commit `0b07767`.

---

## 5. Tests and golden files

ppu.toys' test tree is the part most worth copying in shape, because it answers "how do you
know a picture is right?" without a human looking at every frame.

- **Golden framebuffer tests.** A committed PNG (e.g. `tests/fixtures/golden_basic.png`) is
  decoded and compared **byte for byte** with the framebuffer the engine renders; a second
  `#[test] #[ignore]` regenerates the golden. The golden is **never hand-edited** — it is
  produced by the ignored test. There are **34 golden PNGs** and 3 PCM/BIN fixtures, covering
  backgrounds, sprites, Mode 7, mosaics, colour math, windows, direct colour, the tutorials
  and the audio.
- **Pipeline goldens, not just unit goldens.** `golden_demos.rs` runs the real
  Lua → importer → compositor pipeline on the tutorial sources and compares the frame; it
  also asserts individual pixels and VRAM words, so a failure names *what* moved, not only
  that bytes differ.
- **Doc fences are tests.** `tutorial_first_note.rs` splits `docs/audio.md` on ```` ```lua ````
  fences, runs **every** block through the same engine (with the samples/song it needs) for a
  few frames, and separately asserts the tutorial's main source appears verbatim in the
  chapter. A documented fact that stops matching the engine breaks CI instead of rotting.
- **End-to-end CLI tests.** `crates/ppu-cli/tests/author.rs` runs
  `new → check → render → pack → check (packed) → render (packed) → unpack → repack` and
  asserts PNG signatures/dimensions, that the starter animates, that the packed JSON has the
  expected source, that a repack equals the original, that `docs` returns text for each topic,
  and that re-rendering the unpacked project gives identical pixels. `pack.rs` pins the packed
  sample byte-for-byte and proves a controls document survives pack/unpack with identical
  pixels.
- **A corpus digest** (`compositor_corpus.rs`, `#[ignore]`, needs `$PPU_DEMOS`): plays every
  toy for 180 frames and folds the framebuffer **and inspector buffers** (main, sub, math
  mask, sprite-overflow stats) into one FNV-1a digest per toy, so a refactor must reproduce
  every digest. Skips named toys whose sample sources the CLI cannot pack.
- **CI** is `python3 scripts/check-version-sync.py`, `cargo fmt --check`,
  `cargo test --workspace --locked` — version consistency, formatting and the whole suite.

### What cards #31, #32 and #33 should learn

- **#33 (read cold).** Ask whether a golden is **generated by an ignored test** or hand-made
  (the former), whether the test compares **whole frames** and names the first differing
  pixel/word, whether the docs' code fences are executed, and whether the packed artifact is
  round-tripped. A golden that freezes our own bug is worse than no golden — which is why the
  next point matters.
- **#31/#32.** Add an **end-to-end chain** for the toy path (`new` equivalent → render →
  check → compile via PCEAS → run in Mednafen → compare), and a **doc-fence test** for every
  Lua block we publish. Our docs are currently register prose; once #30/#24 ship toys, the
  snippets must run.
- **A corpus digest is a cheap refactor net.** PCEStudio already has pixel-exact goldens for
  scenes; a digest over every scene + panel buffer would catch a model refactor without
  re-litigating every diff by hand.

### What does not carry over to the PC Engine

- **Their oracle is their own model; ours is an emulator.** ppu.toys' golden is what its PPU
  renders, so the test proves *stability*, not *correctness*. PCEStudio's goldens are
  Mednafen (and ares) captures (`docs/DECISIONS.md` 2026-10-27, `docs/ARES.md`); that is the
  stronger oracle and must stay. A self-golden would freeze our model's bugs — the very thing
  rule 2 and the #6/#11 history warn about.
- **The comparison depth is different.** Our 8-bit output scale is not settled (GAP 13,
  H6-6 missing), so checks compare at the 3-bit colour (`docs/ARES.md`, #41); ppu.toys
  compares its own 15-bit RGB directly.
- **The Rust/cargo/`#[ignore]` machinery is theirs**; our checks are Node scripts
  (`tests/check*.js`) over recorded dumps. Take the *test kinds*, not the harness.
- **There is no emulator in this repo's CI.** PCEStudio's Mednafen/ares checks run locally
  today; a CI story has to be written, not copied.

### Reuse: code and cost

No Rust test code is worth importing. The **shapes** are: golden-by-ignored-test, doc-fence
execution, the CLI round-trip chain, and the per-toy digest. Each is a small rewrite on top
of the existing `tests/check*.js` and dumps — cost low. The doc-fence harness is the single
highest-value addition for reference docs.

**Where seen:** `crates/ppu-core/tests/{golden.rs,golden_demos.rs,tutorial_first_note.rs,
compositor_corpus.rs}`, `crates/ppu-core/tests/fixtures/` (34 golden PNGs, 3 BIN),
`crates/ppu-cli/tests/{author.rs,pack.rs}`, `.github/workflows/ci.yml`; commit `0b07767`.

---

## 6. What I would take, in order

1. **The three-layer split** — runtime *models*, validator *refuses*, compiler *enforces
   declared ranges*. Put it in SPEC/PLAN before #30 starts.
2. **The toy surface** — `init` / `frame(t, f)` / a per-line callback **and** a precomputed
   raster table / flat refreshed input / a typed, capped **password code** for saves; shared
   globals, errors with file+line. Adapt the portable Lua helpers (`ramps.lua`,
   `controls_env.lua` shape) with the MIT notice.
3. **The validator loop** — whole performance, 60 fps grid, endpoint, per-line strip budget,
   named refusals, informational reports, `--allow-overflow`, seek/loop determinism, and the
   **cycle budget** ppu.toys never had.
4. **The packed envelope** — versioned, self-contained, validated names, lossy-unpack warning,
   `pack` does not execute, check the packed file.
5. **The agent shape** — one skill + recipes + worked examples + CLI helper scripts; the
   agent edits the same files the human does and renders to look; state writes tracked and
   reversible; the MCP server wraps our engine.
6. **The test shapes** — golden generated by an ignored test, doc fences executed, CLI
   round-trip, corpus digest — over our Mednafen/ares oracle.

**Not taken:** the Rust VM, the SNES register DSL and line-table decode, the SNES source
kinds, the SNES recipes and prose, and the self-golden oracle.

### Credit

Ideas and, where noted, portable code from **ppu.toys** — MIT, Copyright (c) 2026 Liora Labs —
studied at commit `0b07767`. Any adapted file keeps the MIT notice and names the source.
Nothing was copied into this repository by this card.

---

## Questions for the author

a.gilbert offered help (Discord, 2026-10-28). Only Dennis asks; these are the ones worth his time, most useful
first:

1. **The ROM compiler and export** are part of the hosted Studio, not the MIT repo. How does a toy's Lua become a
   cartridge: an interpreter in ROM, or compiled to 65816 code? What broke first on real hardware? (Our #31 weighs
   llvm-mos against HuC for the same step.)
2. **The validator's frame-time check:** is it counted from the Lua (an estimate) or from the compiled code's cycles?
3. **The agent link:** what the Studio's MCP server exposes, and what agents got wrong most often.
4. Would he mind PCEStudio reusing the toy file format (the JSON envelope) so tools could read both?

**Answer to 1 (a.gilbert, 2026-10-28):** "I have not open sourced the compiler yet. I have massive improvements
coming out for it. There's a few tricks I'm doing to make this a reality and it's actually going to be the subject
of my next video." So: no source to read now; #31 goes ahead with llvm-mos/HuC, and watches for his video and the
compiler's release, to compare tricks once they are public.

**More from a.gilbert (2026-10-28):** "The authored Lua on the site is lowered to an IL where I do all the analysis
and machine code generation. That architectural decision was the main breakthrough."
For PCEStudio this means the pipeline is **Lua subset → our own intermediate language (IL) → analysis → code**:
the IL is where the validator (#32) counts cycles per frame, sprites per line and memory, and where `raster()` is
checked against the line budget; code generation then goes from the IL — either to C (or LLVM IR) for llvm-mos,
or straight to HuC6280 code. The IL is the part to get right first; it is ours to design (his is not public).
