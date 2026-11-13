# Geargrafx's MCP server: a scriptable debugger

Written 2026-11-13. Geargrafx (drhelius/Geargrafx, the maintainer's primary
emulator; the author has offered to help if we need it) has a built-in MCP
server and a headless mode. It is the debugger Mednafen is not: Mednafen gave
us only an autosaved state after a clean exit, so a crashed ROM was a black box.
With Geargrafx we can stop a running ROM, read the CPU and the eight bank
registers, look at the call stack and the disassembly, set breakpoints and read
or write memory, all from a script.

## Run it

The app is a zip (`Geargrafx.app.zip`, v1.8.5) in `pce-tools/geargrafx/`;
unzipped beside it under `app/`. From the repo:

```sh
python3 -I tools/ggmcp.py ROM.pce                 # lists the 90 tools
python3 -I tools/ggmcp.py ROM.pce status 3        # run 3 s, pause, CPU + call stack
```

or as a library (`from ggmcp import GG`, then `g.tool("name", {args})`).
`GEARGRAFX=.../Contents/MacOS/geargrafx` overrides the binary. Underneath it is
`geargrafx --headless --mcp-stdio ROM.pce` speaking JSON-RPC lines: `initialize`,
the `notifications/initialized` notice, then `tools/call`.

## What the tools cover (names as the server lists them)

- Execution: `debug_pause`, `debug_continue`, `debug_step_into/over/out`,
  `debug_step_frame`, `debug_run_to_cursor`, `debug_reset`, `debug_get_status`.
- Breakpoints: `set_breakpoint`, `set_breakpoint_range`, `remove_breakpoint`,
  `list_breakpoints`; watches and bookmarks for memory and code.
- Memory: `list_memory_areas`, `read_memory`, `write_memory`, `memory_search`,
  `memory_find`.
- CPU and disassembly: `get_huc6280_status` (A, X, Y, S, P, PC, the eight MPR
  registers, the timer, IRQ lines), `write_huc6280_register`, `get_disassembly`
  (needs `start_address`), `get_call_stack`, `get_trace_log`, `set_trace_log`,
  `set_profiler`, `get_profiler_data`.
- Hardware: `get_huc6270_status/registers`, `get_huc6260_status`,
  `get_psg_status`, CD-ROM, ADPCM, Arcade Card, sprites (`list_sprites`,
  `get_sprite_image`).
- Symbols: `load_symbols`, `add_symbol`, `lookup_symbol_*`.
- Input and output: `controller_button`, `controller_macro`, `get_screenshot`,
  `start/stop_video_recording`, save states (`save_state`, `load_state`, files).

## Gotchas

- Use the stdio transport. `--mcp-http` starts, answers `initialize`, but
  `tools/list` returned HTTP 400 with no session; stdio just works.
- A headless run starts running; pause before reading registers.
- Symbol files: Geargrafx takes a symbol file as a second argument; the llvm-mos
  link map would need converting (not done).
- Do not leave a headless process running: `tools/ggmcp.py` kills it on exit.

## What it already told us

The native ROM with the sound engine, which a Mednafen run showed only as
"no PSG writes", was in an endless recursion: the call stack was 45 frames deep,
two functions calling each other, and the hardware stack pointer had run down
to $A5. That took one call to see; the same question under Mednafen took an hour
(the banked, split TOWER stall in docs/NATIVE.md).

## Using it as the studio's emulator, the next step

The studio's own MCP (tools toy_run, frame_png, registers_get, ...) runs the toy
in the browser. The same tool names could drive a real console core: a
Geargrafx-backed `toy_run` for an exported ROM, `frame_png` from
`get_screenshot`, `registers_get` from `get_huc6270_status`. Not started; it
would mean a second backend behind the existing tool names (docs/MCP.md).
