# The MCP server (#36, part 1)

`tools/mcp/server.js` is PCEStudio's Model Context Protocol server. It lets an
agent — Claude Code, or any MCP client — write a toy, run it, look at a frame,
read and poke registers, check it with the validator, export a `.pce`, and
read the toy author's reference. It is a **thin wrapper**: every pixel comes
from `renderer/pce-sprites.js`, every frame from `renderer/pce-il.js`, every
refusal from the module that owns it, every document from
`renderer/pce-docs.js`. There is no second model.

> Status: **part 1 of card #36** (the headless server). The studio's AGENT
> panel that connects to it is part 3 (#104); the agent skill with recipes is
> part 2 (#103). The server does not edit `renderer/studio.html`.

## Why a minimal JSON-RPC implementation, not the official SDK

The server speaks the MCP stdio transport directly: **one JSON-RPC 2.0
message per line on stdin/stdout**, as the MCP specification defines it
(protocol revisions 2024-11-05 through 2025-06-18).

The official `@modelcontextprotocol/sdk` was available, and was not used:

- the repository has **no `package.json` and no `node_modules`**, and
  `tests/all.sh` runs from a fresh checkout with nothing installed. The SDK
  would add an `npm install` (and a network fetch) to a project whose only
  other dependency is the vendored Fengari;
- the server uses four requests — `initialize`, `tools/list`, `tools/call`,
  `ping` — and three notifications. The transport is about 120 lines, and it
  is testable in the same style as every other suite under `tests/`;
- no dependency means no version skew between a client's protocol revision
  and a third-party library's.

The wire format is standard, so an official-SDK client is a normal client to
this server. `tests/check-mcp.js` is one: it starts the process, sends
`initialize`, `notifications/initialized`, `tools/list` and `tools/call` over
stdio, and reads the replies.

## Run it

```sh
node tools/mcp/server.js
```

It reads stdin and writes only JSON-RPC to stdout; diagnostics go to stderr.
Nothing is installed and no compiler or emulator is called.

Claude Code, from the repository root:

```sh
claude mcp add pcestudio -- node "$PWD/tools/mcp/server.js"
```

or in `.mcp.json`:

```json
{
  "mcpServers": {
    "pcestudio": {
      "command": "node",
      "args": ["tools/mcp/server.js"]
    }
  }
}
```

The server announces itself as `pcestudio` 0.1.0, advertises the `tools`
capability, and echoes the client's protocol revision when it is one of
2024-11-05, 2025-03-26 or 2025-06-18 (otherwise 2025-06-18).

## The session

One toy at a time, in one process:

- The server runs `renderer/pce-il.js` — the runtime the validator (#32) and
  the #100 exporter use. The Lua runtime agrees with it frame for frame
  (`tests/check-il.js`, `tests/check-examples.js`), which is why the PNG the
  MCP test gets equals check-examples' Lua frame 60.
- `toy_write` replaces the toy and clears any run. `main.lua` is required and
  is the file that runs; the other files are the studio's asset files
  (`tiles.json`, `palettes.json`, … — the shape in `docs/STUDIO.md` §2). No
  runtime imports the assets yet (#24), so the server stores them with the
  toy and says so in the reply. A refused write leaves the toy that was
  already loaded alone.
- `toy_run` starts a **fresh, deterministic** run: frame indices `0` to
  `frames-1`, `t = f/60`, not the clock. It returns the final state and its
  VRAM/CRAM/SAT digests.
- `frame_png` can seek forward: asking for a frame past the run runs the
  missing frames first. The frame's picture is `pce-sprites.renderFrame` of
  the state the IL runtime recorded for it — the same state `frame_png` can
  re-render after a poke.
- `register_set` records a **view override**, the studio's poked column
  (`docs/STUDIO.md`, the REGISTERS panel): it changes what `frame_png`
  renders, not the toy's source or its simulation. It returns the old value,
  and `value:null` clears it, so an agent's write is reversible and cannot
  compound (`docs/PPU-TOYS.md` §4, "state writes tracked and reversible").
- A `toy_run` resets the overrides, because it starts a new simulation.

## Tools

Every tool's input schema is published by `tools/list`. The replies are one
JSON text content block unless noted. A refusal is a successful tools/call
whose result has `isError: true` and whose JSON body carries `ok:false`,
`code` and `message`; the codes are the runtime's own (`reg-range`,
`reg-forbidden`, `pal-range`, `validate-sprite-line`, `il-syntax`, …).

### `toy_write(files)`

Writes a toy and compiles `main.lua` with `renderer/pce-il.js` immediately.

| argument | type | meaning |
| --- | --- | --- |
| `files` | array of `{name, source}` | the file set; `main.lua` required; flat safe names, no duplicates |

Example call:

```json
{"name":"toy_write","arguments":{"files":[
  {"name":"main.lua","source":"function frame(t, f)\n  reg(\"BXR\", f * 2)\nend\n"}
]}}
```

Example reply:

```json
{"ok":true,"files":["main.lua"],"main_lua_bytes":45,"assets":[],
 "language":"pce-il","hooks":{"init":null,"frame":1,"raster":null},
 "functions":2,
 "note":"only main.lua is compiled and run; the asset files are stored with the toy (no runtime imports them yet, #24)"}
```

A toy the IL refuses (for example `pairs`, or a syntax error) comes back with
`isError:true`, the IL's code and the file and line in the message:
`{"ok":false,"code":"il-syntax","message":"[string \"main.lua\"]:2: …"}`.

### `toy_run(frames, pad)`

Runs the loaded toy for `frames` video frames (`0..frames-1`, 1..600, default
60) with an optional pad script, and returns the final state.

| argument | type | meaning |
| --- | --- | --- |
| `frames` | integer 1..600, default 60 | number of frames to run |
| `pad` | array of intervals | `{from, to, pad, buttons}`; `from`/`to` are frame indices inclusive, `pad` is 1..5, `buttons` are `up down left right i ii select run` |

Example call — hold I on pad 1 during frames 10..12:

```json
{"name":"toy_run","arguments":{"frames":60,
  "pad":[{"from":10,"to":12,"pad":1,"buttons":["i"]}]}}
```

Example reply (abridged):

```json
{"ok":true,"frames":60,"frame":59,
 "state":{"width":256,"height":224,
  "regs":{"BXR":118,"BYR":0,"MWR":0,"CR":128},
  "raster":{"entries":4,"base":{"bxr":116,"byr":0,"cr":128}},
  "vram_words":32768,"cram_entries":512,"sat_entries":64,
  "vram_sha256":"…","cram_sha256":"…","sat_sha256":"…"},
 "log":[],"sound_writes":0,"overrides":{}}
```

`state.regs` is the toy's own VDC state at the final frame. Full VRAM, CRAM
and SAT are tens of kilobytes; the reply carries a SHA-256 of each so a
client can tell runs apart without moving the buffers. `log` is the toy's
`print()` output (the host's 200-line log).

Refusals: `no-toy`, `frame-range`, `pad-script`, `pad-button`, and any
runtime refusal (for example `toy-timeout`, `reg-range`) keeps its code.

### `frame_png(frame)`

Renders one frame of the current run as a 256×224 RGB PNG through
`renderer/pce-sprites.js`, the one model. Seeking forward is deterministic.

| argument | type | meaning |
| --- | --- | --- |
| `frame` | integer 0..599 | frame index; 0 is the first frame |

Example call:

```json
{"name":"frame_png","arguments":{"frame":60}}
```

The result has **two content blocks**: a JSON text block and the image.

```json
[{"type":"text","text":"{\"ok\":true,\"frame\":60,\"width\":256,\"height\":224,\"bytes\":1090,\"sha256\":\"…\",\"regs\":{\"BXR\":120,\"BYR\":0,\"MWR\":0,\"CR\":128},\"overrides\":{},\"raster_entries\":4}"},
 {"type":"image","mimeType":"image/png","data":"iVBORw0KGgo…"}]
```

### `registers_get(chip, addr)`

Returns the register catalogue with the **names and ranges from the modules'
own tables**, so the docs and the server cannot disagree with the code:

- **VDC** — all R00–R13 names from `renderer/pce-panels.js`, with the widths
  the toy host enforces (`renderer/pce-toyhost.js`): `BXR 0..1023`,
  `BYR 0..511`, `CR 0..255` are settable; every other VDC name is read-only
  and refused with `reg-forbidden`. `R03`/`R04` are addresses with no
  register and are not listed.
- **VCE** — `CR $0400`, `CTA $0402`, `CTW $0404` (`docs/MANUALS.md` §4).
  `CTW` is the colour data register and is settable through a CRAM address;
  `CR` and `CTA` are not modelled by a toy (the ROM sets the dot clock; the
  address side is supplied by `addr`).
- **PSG** — `R0..R9` from `renderer/pce-psg.js`'s own `REGISTERS` table, at
  `$0800+n`, with the widths its `write()` decodes: R0 0..7, R3 0..15,
  R6 0..31, the rest 0..255.

| argument | type | meaning |
| --- | --- | --- |
| `chip` | `all` \| `vdc` \| `vce` \| `psg`, default `all` | which catalogue |
| `addr` | integer 0..511, optional | read one CRAM colour word (VCE `CTW`) |

Example call:

```json
{"name":"registers_get","arguments":{"chip":"vdc"}}
```

Example reply (one row of the 18):

```json
{"ok":true,
 "vdc":[
  {"chip":"vdc","number":"R07","name":"BXR","title":"background X scroll",
   "range":[0,1023],"bits":10,"manual":"VDC H7-7","settable":true,
   "value":120}
 ],
 "note":"names and ranges come from the modules' own tables …"}
```

`value` is the current run's value (with an override applied where one is
set). Live reads of a register the toy model does not carry are `null`, not
a guess.

### `register_set(chip, name, value, addr)`

Sets one register as a reversible **view override** on the current run, or
records a PSG write in the toy's sound stream.

| chip | names | what it does |
| --- | --- | --- |
| `vdc` | `BXR`, `BYR`, `CR` | the toy host's own ranges; a poke changes what `frame_png` renders, not the run. `value:null` clears it |
| `vce` | `CTW` (+ required `addr`) | writes one 9-bit CRAM colour at `addr` 0..511, the toy's `pal(addr, word)`; `value:null` restores the frame's colour |
| `psg` | `R0..R9` | records a write in the toy's PSG event stream at the current frame (the shape `renderer/pce-psg.js` renders); `frame_png` is picture-only, so the picture does not change |

Example calls:

```json
{"name":"register_set","arguments":{"chip":"vdc","name":"BXR","value":37}}
{"name":"register_set","arguments":{"chip":"vdc","name":"BXR","value":null}}
{"name":"register_set","arguments":{"chip":"vce","name":"CTW","addr":16,"value":511}}
{"name":"register_set","arguments":{"chip":"psg","name":"R1","value":136}}
```

Example reply:

```json
{"ok":true,"chip":"vdc","name":"BXR","old":0,"value":37,"cleared":false,
 "override":true,
 "note":"a view override for frame_png; it does not change the run"}
```

Refusals, by the owning module's codes:

- `reg-forbidden` — a VDC name a toy may not write (`MAWR`, `RCR`, …), or a
  VCE name that is not `CTW`;
- `reg-range` — a value outside the register's width (for example `BXR` 2000:
  `"BXR must be an integer 0..1023, got 2000"`);
- `pal-range` — a CRAM address past 511 or a colour word past 511;
- `reg-chip`, `reg-name` — a malformed call;
- `no-run` — no frames have been run yet.

Why parallax's base `BXR` looks inert: its raster table carries a `BXR` on
every one of its 224 lines, so the per-line value wins and the base `BXR`
never shows. Use a toy with no `BXR` raster entries (for example
`toys/palette-cycle.lua`) to see a base-`BXR` poke; `tests/check-mcp.js`
does exactly that and compares the result with `renderer/pce-sprites.js`.

### `validate(frames)`

Runs #32's validator (`renderer/pce-validate.js`) on the loaded toy and
returns its findings with `file:line` where the validator can place a line.

| argument | type | meaning |
| --- | --- | --- |
| `frames` | integer 1..60, default 8 | frames the validator runs the toy for |

Example call:

```json
{"name":"validate","arguments":{"frames":8}}
```

Example reply (a passing toy, abridged):

```json
{"ok":true,"code":null,
 "problems":[{"severity":"warn","code":"validate-slow-frame",
   "message":"one toy frame costs 314443 cycles (2.64 of a 60 Hz frame, 22.8 Hz)",
   "file":"main.lua","line":null,"location":null}],
 "budgets":{"frameCycles":1203,"ratio60":2.635,"rom":{"bytes":10460,"banks":2,"limit":1048576}},
 "hooks":{"init":3,"frame":6,"raster":7},"functions":8}
```

A refusal sets `isError:true` and names the code: `validate-frame-budget`,
`validate-sprite-line`, `validate-rom`, `validate-range`, `reg-range`,
`validate-raster-line`, and the runtime's own refusals. Every finding carries
`file:"main.lua"` and `location:"main.lua:N"` when a line is known; findings
the validator reports without a source line carry `line:null` and
`location:null` rather than an invented one.

### `export_pce(name, out)`

Exports the loaded toy to a `.pce` through **#100's browser route** — no
compiler: `renderer/pce-il.js` → `renderer/pce-ilbc.js` → `renderer/pce-rom.js`
`buildToyRom()` over the committed `renderer/ilvm.bin`. The validator runs
first; a toy it fails is refused by code, exactly as `tools/toyc/emit.js`
refuses one.

The llvm-mos route (`tools/toyc`) exists where llvm-mos is installed, and is
**not called here**: the beta uses the route that needs nothing installed.
That is also what makes the bytes reproducible by a test.

| argument | type | meaning |
| --- | --- | --- |
| `name` | string, default `toy` | output base name |
| `out` | string, optional | the `.pce` path; default `$TMPDIR/pce-mcp/<name>.pce` |

Example call:

```json
{"name":"export_pce","arguments":{"name":"parallax"}}
```

Example reply:

```json
{"ok":true,"bytes":24576,
 "sha256":"1187f79d9d8d3d4f…",
 "path":"/tmp/pce-mcp/parallax.pce",
 "route":"#100's browser route, no compiler: renderer/pce-il.js -> renderer/pce-ilbc.js -> renderer/pce-rom.js buildToyRom over the committed renderer/ilvm.bin",
 "bytecode_bytes":1100,"ilvm_bytes":16384,"assets":[],
 "note":"the llvm-mos route (tools/toyc) exists where llvm-mos is installed but is not called here; this is the beta's route"}
```

The `.pce` is 16 KiB of interpreter image plus one 8 KiB data bank holding
the bytecode (and, later, assets). The file is written where the reply says.

### `docs(topic)`

Returns #61's toy author's reference, generated from the modules' own tables.

| argument | type | meaning |
| --- | --- | --- |
| `topic` | string, optional | a chapter id or title; omit for the chapter list |

Example call:

```json
{"name":"docs","arguments":{}}
```

Example reply:

```json
{"ok":true,"title":"The toy author's reference",
 "intro":"PCEStudio runs Lua toys on emulated PC Engine hardware. …",
 "topics":[{"id":"the-toy","title":"The toy"},
           {"id":"registers","title":"Registers"},
           {"id":"palettes","title":"Palettes and colour"},
           {"id":"sprites","title":"Sprites and the SAT"},
           {"id":"raster","title":"Raster: changes per line"},
           {"id":"pads","title":"Pads"},{"id":"timer","title":"The timer"},
           {"id":"passwords","title":"Passwords"},
           {"id":"sound","title":"Sound: the PSG"},
           {"id":"budgets","title":"Budgets and limits"},
           {"id":"refusals","title":"Refusal codes"}]}
```

With a topic:

```json
{"name":"docs","arguments":{"topic":"registers"}}
```

returns that chapter as markdown — `# The toy author's reference`, then
`## Registers` with the table generated from `renderer/pce-toyhost.js`
(`BXR 0..1023`, `BYR 0..511`, `CR 0..255`). An unknown or ambiguous topic is
refused with `docs-topic` and the chapter list; `topic:"all"` returns the
whole reference.

## What it does not model

The server says the PCE's open gaps the way ppu.toys' skill lists the SNES's
(`docs/PPU-TOYS.md` §4):

- **VCE `CR` and `CTA`** are catalogued but not settable: the toy model has
  a colour table, not the VCE's control and address registers. `CR` bits 2–7
  have no manual page (`docs/MANUALS.md` §4, GAP 7 is the 262/263-line bit).
- **PSG writes are recorded, not heard here.** There is no audio tool in part
  1; `toy_run` reports the write count, and the model that renders the PCM is
  `renderer/pce-psg.js`.
- **No browser, no studio, no live link.** The AGENT panel that drives an
  open studio is #104; this server is headless.
- **No llvm-mos export.** `export_pce` is #100's route; `tools/toyc` (A/C
  llvm-mos) is present where installed and not used.
- The PCE gaps in `docs/MANUALS.md` §15.3 stay gaps: no mid-line VCE write
  was proven, no 6-button pad source exists, 262/263 lines is not modelled,
  and a picture is Mednafen/ares-checked, not real-hardware-checked.

## Limits

- 1..600 frames per run; `frame_png` can seek to 0..599.
- PNGs are 256×224 RGB, the toy frame (`renderer/pce-toyhost.js`).
- A toy is one Lua file plus asset files; only `main.lua` runs (#24 imports
  the rest later).
- A `.pce` is 24 KiB: 16 KiB committed interpreter + one 8 KiB data bank. A
  bytecode-plus-assets payload past 8 KiB is refused by `toy-data-bank-full`.

## Evidence

`node tests/check-mcp.js` starts `tools/mcp/server.js`, speaks MCP over
stdio, and asserts 101 checks:

- `initialize`, `ping`, and `tools/list` with all eight tools and their
  schemas;
- #29's parallax toy written, 60 frames run, and the PNG at frame 60 equal
  to `tests/dumps/examples/parallax.png` (check-examples' frame 60) pixel
  for pixel;
- a `BXR` poke on #29's palette-cycle toy equal to the picture
  `renderer/pce-sprites.js` renders from that state at BXR 37, and not equal
  to the unpoked frame; `value:null` restores it; an out-of-range value is
  refused with `reg-range`;
- the VCE `CTW` write and its reversal; the PSG catalogue and a recorded
  write; a pad script counted by a toy;
- the validator's `validate-sprite-line` refusal for a 17-sprite toy, and
  `main.lua:2` on a static bad-VRAM finding;
- `export_pce` byte-equal to an independent
  `il.compile → ilbc.encode → buildToyRom` build, and identical on a second
  export;
- `docs` chapter list, a chapter's own numbers, and a refused unknown topic.

Written by @design because the card names the file. Per workshop rule 2, a
**cold break by another seat is owed** before this closes the card.
