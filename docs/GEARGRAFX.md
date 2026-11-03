# Geargrafx — what it can do for us (card #253)

Read 2026-11-03 from <https://github.com/drhelius/Geargrafx> at commit
`f3c8fb0bd01ec755d7a79cb07d528586d2308fff` (2026-11-02), the `README.md` and
`MCP_README.md` in that checkout. The download table names **1.8.6**. It is
GPL-3.0:

> "Geargrafx is licensed under the GNU General Public License v3.0 License, see [LICENSE](LICENSE) for more information." — README.md

Nothing below was run: no Geargrafx install, no ROM loaded, no MCP call. This
is a documentation survey, not a measurement. **We do not bundle Geargrafx or
vendor its source.** Card #254 is where a local, skippable test would find out
whether the documents are right.

**Reading key.** A line beginning `> "` is quoted from `README.md` or
`MCP_README.md`; the source file follows the quote. Anything else is marked:

- `[unverified]` — the two documents do not answer it.
- `[unverified — source only]` — I read it in the Geargrafx source, but it is
  not a README/doc claim. The file and line are named so card #254 can check
  it against a real build.

## 1. Its MCP server

### What it is

> "MCP server for AI-assisted debugging with Claude Code, Codex and similar,
> exposing tools for execution control, memory inspection, hardware status,
> rewind and more." — README.md

> "A [Model Context Protocol](https://modelcontextprotocol.io/introduction)
> server for the Geargrafx emulator, enabling AI-assisted debugging and
> development of TurboGrafx-16 / PC Engine / SuperGrafx games." — MCP_README.md

The server runs in the emulator process, not as a separate program:

> "The MCP server runs **alongside** the GUI in a background thread" —
> MCP_README.md

> "Commands from the AI are queued and executed on the GUI thread" —
> MCP_README.md

### Transport: stdio (preferred) or HTTP

> "STDIO and HTTP transports are supported, with STDIO preferred." — README.md

> "The default mode uses standard input/output for communication. The emulator
> is launched by the AI client and communicates through stdin/stdout pipes." —
> MCP_README.md

> "The HTTP transport mode runs the emulator with an embedded web server on
> `127.0.0.1:7777/mcp` by default. The emulator stays running independently
> while the AI client connects via HTTP." — MCP_README.md

HTTP is loopback-only unless a token is set:

> "Loopback mode can run without authentication; wildcard and other
> non-loopback bind addresses require `GEARGRAFX_MCP_HTTP_TOKEN`, and the
> server refuses to start without it." — MCP_README.md

The two transport flags cannot be combined:

> "Error: Cannot use both --mcp-stdio and --mcp-http at the same time" —
> `platforms/shared/desktop/main.cpp:202` [unverified — source only]

### How Claude Code adds it next to our server

Our server is added from the repository root (`docs/MCP.md` § "Run it"):

```sh
claude mcp add pcestudio -- node "$PWD/tools/mcp/server.js"
```

Geargrafx's own documented stdio command is:

```sh
claude mcp add --transport stdio --scope user geargrafx -- /path/to/geargrafx --mcp-stdio
```

> "Everything after `--` is passed to Geargrafx untouched. `--scope user` makes
> the server available in all your projects. Use `--scope local` (the default)
> to add it only to the current project, or `--scope project` to share it
> through a `.mcp.json` file in the project root" — MCP_README.md

They are two independent MCP servers with two names. A project `.mcp.json`
holding both, assembled from the two quoted examples (not itself a quoted
file):

```json
{
  "mcpServers": {
    "pcestudio": {
      "command": "node",
      "args": ["tools/mcp/server.js"]
    },
    "geargrafx": {
      "command": "/path/to/geargrafx",
      "args": ["--mcp-stdio"]
    }
  }
}
```

With stdio, Geargrafx starts with the Claude Code session:

> "Geargrafx launches when the session starts. Run `/mcp` inside Claude Code to
> check the server status or reconnect it." — MCP_README.md

For a long-lived instance that an agent connects to separately, the documented
HTTP route is:

```sh
./geargrafx --mcp-http --headless --portable --mcp-http-port 7778
claude mcp add --transport http --scope user geargrafx http://127.0.0.1:7778/mcp
```

> "For independent agent tasks, run one Geargrafx instance per agent on a
> unique HTTP port. Use `--headless` and give each instance its own portable
> application directory so its configuration and runtime files are isolated"
> — MCP_README.md

### Every tool it offers

> "This is the full tool catalog. All tools are exposed directly by default.
> With `--mcp-router`, discover advanced tools through `search_tools` or
> `get_category_tools`, inspect their schemas with `get_tool_info`, then invoke
> them with `execute_tool`." — MCP_README.md

The names below are copied from that catalog, one category per line.

**Execution control (9):** `debug_pause`, `debug_continue`,
`debug_step_into`, `debug_step_over`, `debug_step_out`, `debug_step_frame`,
`debug_run_to_cursor`, `debug_reset`, `debug_get_status`.

**CPU and registers (2):** `write_huc6280_register`, `get_huc6280_status`.

**Memory operations (15):** `list_memory_areas`, `read_memory`,
`write_memory`, `get_memory_selection`, `select_memory_range`,
`set_memory_selection_value`, `add_memory_bookmark`,
`remove_memory_bookmark`, `list_memory_bookmarks`, `add_memory_watch`,
`remove_memory_watch`, `list_memory_watches`, `memory_search_capture`,
`memory_search`, `memory_find`.

**Disassembly and debugging (12):** `get_disassembly`, `add_symbol`,
`remove_symbol`, `list_symbols`, `lookup_symbol_by_name`,
`lookup_symbol_at_address`, `add_disassembler_bookmark`,
`remove_disassembler_bookmark`, `list_disassembler_bookmarks`,
`get_call_stack`, `get_trace_log`, `set_trace_log`.

**Profiler (2):** `set_profiler`, `get_profiler_data`.

**Breakpoints (4):** `set_breakpoint`, `set_breakpoint_range`,
`remove_breakpoint`, `list_breakpoints`.

**Hardware status (13):** `get_huc6270_status`, `get_huc6270_registers`,
`write_huc6270_register`, `get_huc6260_status`, `get_huc6202_status`,
`get_psg_status`, `get_cdrom_status`, `list_cdrom_tracks`,
`get_cdrom_audio_status`, `get_adpcm_status`, `get_arcade_card_status`,
`get_turbolink_status`, `reset_turbolink_metrics`.

**Sprites (2):** `list_sprites`, `get_sprite_image`.

**Screen capture (3):** `get_screenshot`, `start_video_recording`,
`stop_video_recording`.

**Media and state (19):** `get_media_info`, `list_recent_media`,
`load_media`, `load_bios`, `list_mmi_media`, `eject_mmi_media`,
`insert_mmi_media`, `select_mmi_media`, `load_symbols`,
`list_save_state_slots`, `select_save_state_slot`, `save_state`,
`load_state`, `save_state_file`, `load_state_file`, `set_fast_forward_speed`,
`toggle_fast_forward`, `get_rewind_status`, `rewind_seek`.

**Cheats (3):** `list_cheats`, `add_cheat`, `remove_cheat`.

**Controller input (6):** `controller_button`, `controller_macro`,
`get_input_state`, `controller_set_type`, `controller_get_type`,
`controller_set_turbo_tap`.

**Router-only tools, with `--mcp-router` (5):** `list_tool_categories`,
`get_category_tools`, `search_tools`, `get_tool_info`, `execute_tool`.

The ones this project's cards are most likely to use:

> "`debug_step_frame` - Step one or more frames. Optional `frames` is 1-1000
> (default 1). Optional `mode` is `async` (default, returns after scheduling)
> or `sync` (returns after all requested frames complete at VBlank). Use
> `mode: "sync"` when issuing dependent tool calls." — MCP_README.md

> "`set_breakpoint` - Set execution, read, or write breakpoint (supports 5
> memory areas: rom_ram, vram, palette, huc6270_reg, huc6260_reg)" —
> MCP_README.md

> "`read_memory` - Read from specific memory area" — MCP_README.md

> "`write_memory` - Write to specific memory area" — MCP_README.md

> "`get_huc6270_registers` - Get all 20 VDC registers (0x00-0x13), Address
> Register (AR), and Status Register (SR)" — MCP_README.md

> "`get_psg_status` - Get PSG status for all 6 channels" — MCP_README.md

> "`get_screenshot` - Capture current screen frame as base64 PNG" —
> MCP_README.md

> "`save_state_file` - Save emulator state to an explicit file path" —
> MCP_README.md

> "`load_state_file` - Load emulator state from an explicit file path" —
> MCP_README.md

### MCP resources, not just tools

The server also publishes hardware documents:

> "In addition to tools, the MCP server provides documentation resources that AI
> assistants can access to better understand the PC Engine / TurboGrafx-16
> hardware and programming." — MCP_README.md

The seven resource URIs quoted there are `geargrafx://hardware/huc6280_cpu`,
`.../huc6280_instructions`, `.../huc6280_psg`, `.../huc6270_vdc`,
`.../huc6260_vce`, `.../huc6202_vpc` and `.../memory_map`.

### Context cost

> "By default, Geargrafx exposes every MCP tool directly. This avoids nested
> tool discovery in clients that already defer MCP schemas, including Claude
> Code." — MCP_README.md

> "Add `--mcp-router` to expose a compact set of high-frequency tools directly
> and route advanced debugger tools through lightweight discovery tools. This
> reduces MCP context while preserving access to the full debugger surface." —
> MCP_README.md

## 2. Command line, headless and scripted use

> "ROM loading from the command line by adding the ROM path as an argument." —
> README.md

The complete documented command line is:

```
geargrafx [options] [game_file] [symbol_file]

Arguments:
  [game_file]                 Accepts ROMs (.pce, .sgx, .hes), CUE (.cue), CHD (.chd), MMI (.mmi) or ZIP (.zip)
  [symbol_file]               Optional symbol file for debugging

Options:
    -f, --fullscreen          Start in fullscreen mode
    -w, --windowed            Start in windowed mode with menu visible
      --load-state SLOT       Load save state slot 1-5, or a state file, once the media is loaded
      --mcp-stdio             Auto-start MCP server with stdio transport
      --mcp-http              Auto-start MCP server with HTTP transport
      --mcp-router            Enable compact MCP tool routing
      --mcp-http-address A    HTTP bind address (default: 127.0.0.1)
      --mcp-http-port N       HTTP port for MCP server (default: 7777)
      --turbolink-join N      Join local TurboLink shared session 1-255
      --headless              Run without GUI (requires MCP or TurboLink)
      --portable              Store configuration and user data beside the application
    -v, --version             Display version information
    -h, --help                Display this help message
```

— README.md

Headless is documented as a real mode, not a hidden switch:

> "Add `--headless` to run without a GUI window. This is useful for servers,
> CLI agents, or any machine without a display. All MCP tools work identically
> in headless mode. Requires `--mcp-stdio` or `--mcp-http`." — MCP_README.md

> "Headless mode is debug mode without rendering, so the debug output settings
> apply: screenshots use the output overscan and scanline count from the
> **Debug** menu instead of the ones in the **Video** menu." — MCP_README.md

A state can be loaded at launch:

> "A save state can be loaded at launch too, with `--load-state 1` for slot 1 or
> `--load-state FILE` for a state file" — MCP_README.md

### Can it run a ROM and dump state without a window?

**Yes, through the MCP loop; no one-shot CLI dump is documented.** The
documented ingredients are all there:

- Launch headless with `--mcp-stdio` or `--mcp-http` (quoted above), and give
  the ROM as the `[game_file]` argument or load it with `load_media`:
  > "`load_media` - Load ROM or disc media (.pce, .sgx, .hes, .cue, .chd,
  > .mmi, .zip). Automatically loads .sym symbol file if present" —
  > MCP_README.md
- Advance a fixed number of frames:
  > "`debug_step_frame` ... Optional `frames` is 1-1000 (default 1) ...
  > Use `mode: "sync"` when issuing dependent tool calls." — MCP_README.md
- Dump state with `save_state_file` and/or `read_memory` (quoted in §1), or
  read chip registers with `get_huc6270_registers` and `get_psg_status`.

What is **not** documented is a flag that runs the ROM for N frames, writes a
state, and exits without an MCP client. `--load-state` loads a state; the CLI
block above has no `--save-state`, no `--frames` and no `--dump`. Whether
such a mode exists undocumented is `[unverified]`. For card #254, the scripted
route is therefore an MCP client that drives `load_media` →
`debug_step_frame` → `save_state_file`/`read_memory`, not a shell one-liner.

`[unverified — source only]` The argument parser treats at most two
non-option arguments, `[game_file] [symbol_file]`
(`platforms/shared/desktop/main.cpp:172-196`), and headless still constructs
the GUI/debug thread (`platforms/shared/desktop/application_headless.cpp`).
That is consistent with the documentation but is not a substitute for a run.

## 3. Symbol files: `.sym`, `.lbl`, `.noi`

The auto-load rule is documented:

> "**Debug Symbols**: The emulator automatically tries to load a symbol file
> when loading a ROM (.sym, .lbl, .noi). For example, for
> `path_to_rom_file.rom` it tries to load `path_to_rom_file.sym`. You can also
> load symbol files using the GUI or the CLI. It supports PCEAS (old and new
> format), wla-dx and vasm file formats." — README.md

> "If a `.sym`, `.lbl`, or `.noi` file exists alongside the ROM, symbols are
> loaded automatically." — `skills/geargrafx-debugging/SKILL.md` (a Geargrafx
> document shipped in the repository)

`[unverified — source only]` The loader tries the three extensions in the
order `.sym`, then `.lbl`, then `.noi` (`platforms/shared/desktop/gui.cpp:950-952`).
The extension does **not** select a parser: one token sniffer reads all three,
so the same line can be in any of the files.

### The only documented line shape

> "`load_symbols` - Load debug symbols from file (.sym format with
> 'BANK:ADDRESS LABEL' entries)" — MCP_README.md

A line in that shape, **constructed from the quoted description** (the
README/MCP_README contain no sample file):

```
00:8000 MAIN_LOOP
```

Meaning: bank `$00`, address `$8000`, label `MAIN_LOOP`.

### What the parser accepts

`[unverified — source only]` The loader has four format branches, each with a
source comment quoted here verbatim
(`platforms/shared/desktop/gui_debug_disassembler.cpp`):

```
// PCEAS new format: <bank:address> <size> <filenumber:linenumber:columnnumber> <symbolname>
// WLA format: <bank:address> <symbolname>
// PCEAS old format: <bank> <address> <symbolname>
// VASM format: <address> <symbolname>
```

Constructed examples, one per branch (not quoted samples):

```
00:8000 000e 1:42:0 MAIN_LOOP      ; PCEAS new (source-only branch)
00:8000 MAIN_LOOP                  ; WLA (the documented BANK:ADDRESS LABEL shape)
00 8000 MAIN_LOOP                  ; PCEAS old (source-only branch)
8000 MAIN_LOOP                     ; VASM (source-only branch)
```

### `.sym`

The only extension with a documented line shape, quoted above:
`BANK:ADDRESS LABEL`. `00:8000 MAIN_LOOP` is that shape. Which assembler
writes which extension is **not stated** in README/MCP_README `[unverified]`.
Card #245 should emit the WLA-style `BANK:ADDRESS LABEL` line because that is
the one shape the MCP README documents.

### `.lbl`

README.md says `.lbl` is auto-loaded and that PCEAS old and new formats are
supported; it gives **no example line** `[unverified]`. The source branches
above show what the loader accepts. Which of those is the `.lbl` convention
is `[unverified]`. A `.lbl` written as PCEAS old format would be
`00 8000 MAIN_LOOP` (constructed from the source comment, not a doc quote).

### `.noi`

README.md lists `.noi` as auto-loaded; neither README.md nor MCP_README.md
says what writes it or gives a line `[unverified]`. `[unverified — source
only]` The same loader would accept it if its lines match the WLA, PCEAS or
VASM branch above; the parser also recognises `Symbols by name:` and
`Symbols by value:` section headers (`gui_debug_disassembler.cpp:328-338`).
A `.noi` example cannot be quoted from the docs without inventing it.

### Does it read line or source-file information?

**Not into the debugger.** No README/MCP_README claim mentions source-level
debug, source files or line numbers `[unverified that it exists at all]`.
`[unverified — source only]` The PCEAS new-format line contains a
`filenumber:linenumber:columnnumber` token, but the loader uses only
`tokens[3]` as the symbol name
(`gui_debug_disassembler.cpp:1745-1756`), and the stored symbol is only:

```c
struct DebugSymbol
{
    int bank;
    u16 address;
    char text[64];
};
```

— `platforms/shared/desktop/gui_debug_disassembler.h:33-38`

So a PCEAS `.sym` can carry file/line/column text, and Geargrafx will read
past it without keeping it. The MCP symbol tools are add/remove/list/lookup
only (quoted in §1); there is no "go to source line" tool.

## 4. WebAssembly / web build, and building from source

### Is there a web build?

There is **no standalone web/WASM build documented**. The README's Downloads
table lists Windows, macOS, Linux, MCPB, RetroArch and Dev Builds; the
supported-platform list names Emscripten only as a **libretro** target:

> "Supported platforms (libretro): Windows, Linux, macOS, Raspberry Pi,
> Android, iOS, tvOS, webOS, PlayStation Vita, PlayStation 3, Nintendo 3DS,
> Nintendo GameCube, Nintendo Wii, Nintendo WiiU, Nintendo Switch, Emscripten,
> Classic Mini systems (NES, SNES, C64, ...), OpenDingux, RetroFW and QNX." —
> README.md

`[unverified — source only]` The libretro Makefile has an Emscripten branch:

```make
else ifeq ($(platform), emscripten)
	TARGET := $(TARGET_NAME)_libretro_emscripten.bc
```

— `platforms/libretro/Makefile:222-224`

That produces a libretro **core** (`.bc`), not a Geargrafx web app. The
checkout has `platforms/bsd`, `ios`, `libretro`, `linux`, `macos`, `shared`,
`windows` and no `platforms/web` or `platforms/wasm` directory
`[unverified — source only]`. Whether the libretro core can be linked into a
browser page and driven from JavaScript is `[unverified]`.

### Build from source

Quoted from README.md's Build Instructions:

**macOS**

```sh
brew install sdl3
cd platforms/macos
make dist
```

**Linux (Ubuntu 26.04 example; the README has the 24.04 SDL3-from-source
variant)**

```sh
sudo apt install build-essential pkg-config libsdl3-dev libgl-dev
cd platforms/linux
make
```

**Windows**

> "Install Microsoft Visual Studio Community 2026 or later." ... "Open the
> Geargrafx Visual Studio solution `platforms/windows/Geargrafx.sln` and
> build." — README.md

**Libretro core**

```sh
sudo apt install build-essential
cd platforms/libretro
make
```

— README.md

A browser build would be `make platform=emscripten` in `platforms/libretro`
`[unverified — source only]`; the README does not give that command.

## 5. Save states, trace and profiler

### Save states and rewind

> "Save states with preview and rewind support." — README.md (Features)

The MCP tools distinguish five slots from explicit files (all quoted verbatim
in §1): `list_save_state_slots`, `select_save_state_slot`, `save_state`,
`load_state`, `save_state_file`, `load_state_file`. Rewind is two more:

> "`get_rewind_status` - Get rewind buffer status (enabled, snapshots,
> capacity, buffered seconds)" — MCP_README.md

> "`rewind_seek` - Seek to a specific rewind snapshot while paused" —
> MCP_README.md

`--load-state` loads a slot or file at launch (§2). There is no documented
CLI save flag; saving is an MCP tool or a GUI action.

### Trace logger

This is the correction to the card: the trace logger **exists**.

> "**Trace Logger**: CPU instruction trace with interleaved hardware events
> (VDC, VCE, PSG, timer, CD-ROM, SCSI, ADPCM, input)" — MCP_README.md

> "`get_trace_log` - Read trace logger entries (CPU + hardware events) using
> absolute sequence pagination. Use `set_trace_log` to start or stop the
> logger" — MCP_README.md

> "`set_trace_log` - Start or stop trace logging and configure exact event
> filters and memory or disk storage" — MCP_README.md

The documented filter list (exact values) covers `cpu.instructions`,
`cpu.irqs`, `vdc.registers`, `vdc.irqs`, `vdc.dma`, `vdc.sprite_budget`,
`vdc.sprite_limit`, `vdc.missed_vblank`, `vce.registers`, `vce.timing`,
`input.reads`, `input.writes`, the five `input.turbolink*` streams,
`timer.irqs`, `timer.registers`, `cdrom.irqs`, `cdrom.control`,
`cdrom.audio`, five `psg.*` streams, five `adpcm.*` streams, six `scsi.*`
streams, and `system.mpr`, `system.mapper`, `system.interrupts`
(MCP_README.md "Trace filters").

> "Starting a stopped logger without `output` selects `memory`. Memory
> capacities are `100K`, `500K`, `1M`, `2M`, and `5M` entries; the persisted
> default is `100K`. Disk limits are `10MB`, `50MB`, `100MB`, `250MB`, `500MB`,
> `1GB`, and `unbounded`; the persisted default is `100MB`." — MCP_README.md

### Profiler

This also exists:

> "**Profiler**: Per-function call counts, calls per frame, and
> inclusive/exclusive cycle statistics" — MCP_README.md

> "`set_profiler` - Start, stop, or reset the function profiler with `action`
> (`start`, `stop`, `reset`). `start` opens the Profiler debugger window and
> `stop` closes it. Statistics are only collected while the window is visible
> (in headless mode, while started), starting on the next frame" —
> MCP_README.md

> "`get_profiler_data` - Read profiler results: `collecting`, `window_open`,
> `total_cycles`, `frame_cycles`, `frames`, `function_count`, and per-function
> `name`, `symbol`, `bank`, `address`, `type`, `calls`, `calls_per_frame`,
> `inclusive_cycles`, `inclusive_percent`, `exclusive_cycles`,
> `exclusive_percent`, `average_cycles`, `min_cycles`, and `max_cycles`." —
> MCP_README.md

The profiler is **symbol-aware**, not source-aware: it reports a `symbol`
name and bank/address, which is exactly what a `.sym` supplies.

### Screenshots and video

> "`get_screenshot` - Capture current screen frame as base64 PNG" —
> MCP_README.md

> "`start_video_recording` - Start recording video and audio to an AVI file
> (MJPEG, uncompressed or PNG compressed video, 16-bit PCM audio)." —
> MCP_README.md

## 6. What it does NOT have

**The card's premise is partly wrong, and REFERENCES.md §8 repeats it.**
Card #253 and `docs/REFERENCES.md` §8 say Geargrafx "does not list trace
logging, profiling or source-level debugging." As of the 2026-11-02 checkout,
the trace logger and the profiler **are documented** in `MCP_README.md`
(quoted in §5), with `set_trace_log`/`get_trace_log` and
`set_profiler`/`get_profiler_data`. Only the third item survives:

- **No source-level debugging.** No README/MCP_README claim mentions source
  files, line numbers, source breakpoints or stepping by source line
  `[unverified that a hidden GUI feature exists]`. Symbols are
  bank/address/name only (§3), and the PCEAS new-format file/line token is
  read and discarded `[unverified — source only]`.
- **No one-shot headless "run and dump" CLI.** The documented flags have
  `--load-state` but no save-state, frame-count or dump flag; state dumping is
  an MCP tool (§2) `[unverified that an undocumented mode exists]`.
- **No standalone web/WASM application.** Emscripten is a libretro core
  target only (§4) `[unverified whether that core can be embedded]`.
- **No bundled BIOS.** CD-ROM games need one:
  > "Geargrafx requires a BIOS to run CD-ROM games." — README.md
- **No PCEStudio toy/project format, assembler or asset pipeline.** It is an
  emulator and debugger, not a build front end `[unverified — absence from
  the document]`. That is the gap PCEStudio fills, not a defect in Geargrafx.

## Where we plug in

**This section is our reasoning and ranking, not a Geargrafx claim.** It says
what PCEStudio could do with the quoted facts, and which board cards would
change. Facts it leans on are quoted above.

### 1. Symbol files (#245) — highest value, zero integration code

Geargrafx already auto-loads `.sym`, `.lbl` or `.noi` beside the ROM (quoted
in §3). We do not need to patch it, link it or bundle it: #245 writes the file
and Geargrafx consumes it. The documented shape to emit is
`BANK:ADDRESS LABEL`, because that is the only shape MCP_README names. #245
already owns this output (its card says "in the format Geargrafx loads
automatically"); this research sharpens it to the WLA branch and to the
`.sym` extension first. **Cards that change:** #245 (emit `.sym`, optionally
`.lbl` only if a real build shows a different required format), verified by
#254. No new code in Geargrafx.

### 2. A download pair: ROM + `.sym` (#245 with #231)

The same `.pce` that #231's HuCard builder writes should have its `.sym`
written next to it, and the download surface should hand over the pair, so a
person can drop both into Geargrafx and see labels immediately. The
documented auto-load rule is by filename stem
(`path_to_rom_file.rom` → `path_to_rom_file.sym`), so the pair must share a
stem (quoted in §3). **Cards that change:** #231 (builder output directory)
and #245 (the symbol writer); #254 proves the pair loads. The toy `.pce`
export dialog is #115 (already done), so if the pair is offered as one
download there it is a small follow-up on #245's surface, not a new card.

### 3. Our MCP plus theirs as one loop (#255)

The two servers are independent and can run side by side (§1). The loop our
cards describe is:

1. **Build in the studio:** `toy_write` / `toy_run` / `frame_png`, or the
   assembly path `asm_build` once #230 lands.
2. **Export the HuCard:** `export_pce` (and, after #245, the `.sym`).
3. **Run and break in Geargrafx:** `load_media`, `set_breakpoint`,
   `debug_continue`, `get_huc6280_status`, `get_disassembly`, `read_memory`,
   `get_huc6270_registers`, `get_psg_status`, `get_screenshot`.
4. **Fix and rebuild** in the studio, repeating from 1.

The split is clean: ours owns authoring, the toy model, the validator and the
export; theirs owns cycle-accurate execution, breakpoints, rewinding and the
hardware viewers. **Cards that change:** #255 (teach the loop in
`renderer/pcestudio-for-claude.md`, `renderer/pce-guide.js`, the plugin skill
and `docs/MCP.md`); #230 supplies `asm_build`; #254 proves the tools work;
#253 is this page.

### 4. Geargrafx as a second reference next to Mednafen (#254)

Today Mednafen is the external check. Geargrafx is a better fit for some of
our checks because its MCP returns VDC registers, VRAM, palette, PSG and CPU
state directly instead of us scraping a DLL or a save state (all quoted in
§1). It is also a **second opinion**: Mednafen and Geargrafx disagreeing is
information about our model, and both agreeing is stronger than one. **Local
only, nothing bundled, nothing vendored** — #254 already says exactly that:
its test skips with a reason when Geargrafx is absent, uses `PCE_GEARGFRAFX`
for the path, and records differences in this file. **Cards that change:**
#254 only; no change to the renderer or the existing Mednafen checks until
#254 names a real difference.

### 5. Could a web build replace CPU 1-4 (#232-#235)? — not on this evidence

**No standalone web build is documented** (§4). The only Emscripten artifact
is a libretro `.bc` core, and whether it can be linked into the studio page
and driven from JavaScript is `[unverified]`. Even if it can, it is an
emulator core: embedding it would give us "run a `.pce` and inspect it", which
overlaps #235 (the run panel and debugger) but not #232-#234, whose purpose is
the studio's **own** JavaScript HuC6280 and chip model — the thing the
renderer, validator and toy compiler are built on. Replacing them with a
WASM emulator would trade our model for a second implementation, the exact
thing the Mednafen comparison exists to check. **Recommendation:** keep
#232-#235 as the studio's own model. Do not spend a card on embedding until a
concrete WASM core and a browser test exist; if that changes, it is a new
card, not a rewrite of #232-#235. **Cards that change:** none today; #232-#235
keep their scope.

### What is still unverified

- Real example lines for `.lbl` and `.noi` from PCEAS/wla-dx/vasm builds.
  README/MCP_README give none; the source branches are not documentation.
- Which extension each assembler actually writes (the loader sniffs, it does
  not map extension to format).
- A headless run that steps N frames and dumps a state on a real build; the
  documents promise the ingredients, not the recipe.
- Whether the libretro Emscripten core can be embedded in a page and driven
  from JavaScript.
- Whether Geargrafx's GUI has source-level debugging that its two documents
  omit.

Card #254 is the place to turn each `[unverified — source only]` line above
into a measured answer.
