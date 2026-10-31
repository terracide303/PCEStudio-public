# The MCP server (#36, part 1)

`tools/mcp/server.js` is PCEStudio's Model Context Protocol server. It lets an
agent — Claude Code, or any MCP client — write a toy, give it art and a song,
run it, look at a frame, read and poke registers, check it with the validator,
save the whole toy as the file the studio opens, export a `.pce`, and read
the toy author's reference. It is a **thin wrapper**: every pixel comes from
`renderer/pce-sprites.js`, every frame from `renderer/pce-il.js`, every
refusal from the module that owns it, every document from
`renderer/pce-docs.js`. There is no second model.

Since #166, the tools themselves live in `renderer/pce-agent-tools.js` — the
one tool core, a UMD module like its neighbours. The server keeps only the
stdio JSON-RPC wire and the Node host adapter (`createSession(host)`: zlib
for the PNG steps, the file system for `toy_save`'s envelope under the
working-folder fence and for `export_pce`'s `.pce`, and
`renderer/ilvm.bin`); the studio's AGENT panel (#167) loads the same core
with a browser host, so the page and the server run the same tools.

> Status: **part 1 of card #36** (the headless server). The studio's AGENT
> panel that connects to it is part 3 (#104); the agent skill with recipes is
> part 2 (#103), and it is in `plugin/skills/creating-pce-toys/` — read
> `SKILL.md` first, then `recipes/`. The server does not edit
> `renderer/studio.html`.

## The agent skill (#103)

`plugin/` is a Claude Code plugin in the ppu.toys shape
(`docs/PPU-TOYS.md` §4): `.claude-plugin/plugin.json` and one skill,
`skills/creating-pce-toys/SKILL.md`. The skill teaches this server's tools, the
hardware's limits, the toy API, the IL subset and seven worked recipes. Install:

```sh
claude mcp add pcestudio -- node "$PWD/tools/mcp/server.js"
ln -s "$PWD/plugin/skills/creating-pce-toys" ~/.claude/skills/creating-pce-toys
```

`node tests/check-skill.js` runs every recipe through this server over stdio and
requires each to be visible and validator-clean. The evidence, and the three
cold-seat rounds that shaped the skill, are in `docs/SKILL-TRANSCRIPT.md`.


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
  (`tiles.json`, `palettes.json`, `sprites.json` — the shape in
  `docs/STUDIO.md` §2). A refused write leaves the toy that was already
  loaded alone.
- `source_add` turns a picture into those asset files (#153): a base64 PNG or
  a pixel grid with a palette becomes tiles, sprites, a tilesheet or a
  palette, merged into the toy's files, and the reply is the VRAM/CRAM
  budget (tiles, palettes, words used, warnings). Kind `song` takes a base64
  `.mid` and writes `song.json` (#161).
- `toy_save` (#160) hands the whole session to the person as one
  `pce.studio/1` envelope in the studio's own Save format, so the game opens
  in the studio with the art the imports made — the studio's `Open… → From
  file` path, and `renderer/pce-source.js importStudio` reads it. The songs
  ride in the same envelope: `song.json` is one of the files it writes, and
  the SEQUENCER opens it.
- `project_save` / `project_open` (#163) are the multi-session route: the
  studio's `.pcestudio` project (or the same layout unpacked into a folder, so
  git holds the history), with `NOTES.md` as the resume note. `project_open`
  returns the note's text first; `toy_write` edits the toy inside the project
  and a `project_save` writes it back. `toy_save` stays for the plain toy
  file.
- `toy_run` imports the asset files into VRAM, CRAM and the SAT **before
  `init()`**, exactly as the studio does (#117, #153) — the one importer, no
  second model — and its reply carries the import's summary as `assets`.
- A toy's song files are its `music(index)` slots (#161): `song.json` (the
  SEQUENCER's own document) and any playable `songs.json` entry are compiled
  by `renderer/pce-seq.js`'s `songsFromFiles` — the module `pce-song.js`'s
  `createPlayer()` takes — and handed to the runtime as `options.songs`, the
  same list the studio gives a gallery toy. `song_write` composes one from a
  step list, `source_add` kind `song` imports a `.mid` as the same file, and
  a toy with no song file still gets none (so `music(0)` is `music-range`).
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
 "songs":[],"language":"pce-il","hooks":{"init":null,"frame":1,"raster":null},
 "functions":2,
 "note":"main.lua is compiled now; the asset files ride along and toy_run imports them into VRAM/CRAM/SAT before init() (#117, #153), and the song files are the music(index) slots (#161) — so the files the panels edit are the art and the music the toy boots with"}
```

A toy the IL refuses (for example `pairs`, or a syntax error) comes back with
`isError:true`, the IL's code and the file and line in the message:
`{"ok":false,"code":"il-syntax","message":"[string \"main.lua\"]:2: …"}`.

A song file the model cannot compile refuses the write the same way, by the
sequencer's or the player's own code (`seq-json`, `seq-tempo`, `song-*`), and
the toy that was loaded keeps playing.
### `toy_save(path, title, description)`

Writes the session as the **studio's own file** (#160): one
`pce.studio/1` JSON envelope holding `main.lua`, every asset file the
imports made (`tiles.json`, `palettes.json`, `sprites.json`), the named
sources (`sources.json`, #156) and the songs (`song.json`, `songs.json`) —
whatever the session holds, each byte for byte. The text is built by
`renderer/pce-source.js`'s `envelopeText()`, the same function
`renderer/studio.html`'s Save uses (`saveToyFile` → `toyEnvelope`), so there
is **one format, not two**: what this writes is what Save writes.
`tests/check-mcp.js` opens the saved file through the studio's own
`importStudio()` and gets the frame the MCP run drew, diff 0.

The person then opens it in the studio with **Open… → From file…** (or drops
it on the page) and plays the toy with its art. Before this tool existed an
agent could only hand over `main.lua`, and every tile and sprite stayed in
the server's process.

| argument | type | meaning |
| --- | --- | --- |
| `path` | string | the file to write, **inside the working folder**; `.pce.json` is appended when the name has no `.pce.json` / `.pce.studio` extension |
| `title` | string, optional | the toy's title; default: the file's own base name |
| `description` | string, optional | one line, saved as the envelope's `description` |

The **working folder** is the folder the server was started in — for Claude
Code, the person's project folder — or `PCE_MCP_WORKDIR` when that names
one. A path that resolves outside it, by `..` or by an absolute path, is
refused with `save-path` and nothing is written: an agent must not be able to
overwrite files it was never pointed at.

Example call:

```json
{"name":"toy_save","arguments":{"path":"red-toy.pce.json"}}
```

Example reply:

```json
{"ok":true,"version":"pce.studio/1",
 "path":"/work/red-toy.pce.json","name":"red-toy.pce.json",
 "title":"red-toy","description":"","bytes":4210,
 "sha256":"…",
 "files":["main.lua","palettes.json","sprites.json","sources.json"],
 "note":"one pce.studio/1 envelope — the studio's own Save format, built by renderer/pce-source.js envelopeText() — holding every file and source; in the studio, Open… → From file (or drop it on the page) plays this toy with its art"}
```

The envelope's keys are the studio's, in the studio's order: `version`,
`title`, `description`, `files`, `sources`, two-space JSON and a last
newline. `sources` is the ppu.toys field for binary sources (card #24) and
is `[]`; the art travels as the text asset files, named by `sources.json`.

Refusals: `no-toy`, `save-path` (a missing path, or one outside the working
folder), `save-io` (the folder or file could not be written).

### `project_save(path, title?, notes?)`

Writes the session as a **project** (#163), the file a later session resumes
from: the studio's `.pcestudio` (#162, `docs/PROJECT-FORMAT.md`) — a ZIP of
`project.json`, `main.lua`, the asset files, `sources.json` and `NOTES.md` —
built by `renderer/pce-project.js`, the module the studio's Save project uses,
so there is one format, not two.

When `path` is a **folder** — a trailing `/` on the name, or a folder that
already exists — the same layout is written **unpacked** into it instead of as
one archive. That is the route for Claude Code: the folder is a normal git
repository, and committing after each session puts the game's history in git.

| argument | type | meaning |
| --- | --- | --- |
| `path` | string | the project to write, inside the working folder: a `.pcestudio` name (the extension is added when it has none) or a folder |
| `title` | string, optional | the project's title; default: the opened project's title, else the file or folder's name |
| `notes` | string, optional | the whole updated `NOTES.md` — goal, what works, what does not, decisions, next steps. With no `notes` and none in the toy, the project gets the studio's `notesTemplate()` |

The session has no `art/` originals (source_add keeps the imported files, not
the picture it read) and no named versions, so those two lists are empty; the
studio's own Save project fills them. The saved `NOTES.md` becomes part of the
session, so a following `toy_save` carries it too.

Example call:

```json
{"name":"project_save","arguments":{"path":"my-game/","notes":"# My game — resume note\n…"}}
```

Example reply:

```json
{"ok":true,"format":"pcestudio/1","path":"/work/my-game","folder":true,
 "title":"my-game","files":["main.lua","tiles.json","NOTES.md"],
 "notes":"NOTES.md","created":"2026-10-31T10:00:00.000Z",
 "modified":"2026-10-31T10:30:00.000Z","bytes":null,"entries":4,
 "note":"the unpacked project folder — project.json, main.lua, the asset files and NOTES.md; commit it and git holds the history; project_open {path} resumes it"}
```

Refusals: `no-toy`, `save-path` (a missing path, or one outside the working
folder), `save-io` (a folder or file could not be written), `project-host`
(the host has no project support), and `renderer/pce-project.js`'s own
`project-code` (a save that would leave out `main.lua`).

### `project_open(path)`

Resumes a project (#163): loads a `.pcestudio` file **or** an unpacked project
folder into the session — `main.lua`, every asset file, `sources.json`, the
songs and `NOTES.md` — through `renderer/pce-project.js`'s reader (the
studio's own open path). The reply has **two text blocks**, and the first is
`NOTES.md`'s text: a resuming session reads what the last one learned before
it reads anything else. The second is the JSON summary (`files`, `songs`,
`title`, `created`, `modified`, …).

The toy is compiled before the session is replaced, so a project whose code or
song file the runtime refuses leaves the loaded toy alone, as `toy_write`
does. `toy_run` then plays the resumed toy, `toy_write` edits it, and
`project_save` writes it back.

A folder is read as the format's layout, and `project.json` is its manifest:
the reader takes the files it lists, `art/` and `versions/<n>-<label>/`. A
git repository's `.git/`, a `README.md` and a committed screenshot at the
root are not project files and are not loaded (a binary file never reaches
the text decoder).

| argument | type | meaning |
| --- | --- | --- |
| `path` | string | the `.pcestudio` file or the project folder, inside the working folder |

Example call:

```json
{"name":"project_open","arguments":{"path":"my-game/"}}
```

Example reply (first block, then the JSON):

```text
# My game — resume note
…
```

```json
{"ok":true,"format":"pcestudio/1","path":"/work/my-game","folder":true,
 "title":"my-game","notes":true,"files":["NOTES.md","main.lua","tiles.json"],
 "songs":[],"language":"pce-il","created":"…","modified":"…"}
```

Refusals: `open-path` (a missing path, or one outside the working folder),
`project-host` (the host cannot open by path — a browser tab), and the
project format's own `project-format`, `project-json`, `project-main`,
`project-name`, plus the toy's compile and song refusals (`il-…`, `seq-json`).

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
 "sound":{"writes":1322,"songs":1,
  "music":{"index":0,"name":"Oak Woods","playing":true,"notes":12},
  "channels":[{"channel":0,"notes":5,"instrument":"square",
               "instruments":["square"],
               "last_note":{"frame":54,"note":55},"sfx":null}, …]},
 "log":[],"sound_writes":1322,"overrides":{}}
```

`state.regs` is the toy's own VDC state at the final frame. Full VRAM, CRAM
and SAT are tens of kilobytes; the reply carries a SHA-256 of each so a
client can tell runs apart without moving the buffers. `log` is the toy's
`print()` output (the host's 200-line log). When the toy has asset files the
reply also carries `assets` — the #117 import's summary: the file names and
the tiles, patterns and sprites the import placed.

`sound` is the ear an agent does not have (#161). `writes` is the PSG write
stream the run recorded; `songs` is the number of song slots the runtime was
given; `music` is null until `music(n)` runs, then the index, the song's
name, whether the player is running, and the notes it applied. `channels`
has one entry per PSG voice (0..5): how many notes pce-song.js started on it,
the instrument the last one sounds with (the compiled song's own instrument
library; `instruments` lists every one it used), the last note's frame and
engine note, and the SFX that owns the channel at the end of the run if any.
`sound_writes` is kept beside it for the count alone.

Refusals: `no-toy`, `frame-range`, `pad-script`, `pad-button`, and any
runtime refusal (for example `toy-timeout`, `reg-range`) keeps its code.

### `source_add(png | grid, kind, …)`

Imports a picture into the toy's asset files (#153), with the studio's own
importer (`renderer/pce-source.js`, the Add Source dialog's) — so what the
server accepts is what the studio accepts. The new art is **merged** into
the current files and the reply is the budget. Call it before `toy_run`;
`toy_run` imports the merged files into VRAM, CRAM and the SAT before
`init()`.

| argument | type | meaning |
| --- | --- | --- |
| `png` | string | base64 of an RGB or RGBA PNG; either this or `grid` |
| `grid` | object | `{width 1..256, height 1..240, pixels[]}` — palette indices, `-1` transparent; either this or `png` |
| `palette` | array of `[r,g,b]` | the grid's palette; required with `grid` |
| `kind` | `bg` \| `sprites` \| `tilesheet` \| `palette` \| `song` | what the source becomes; `song` takes `mid` |
| `mid` | string | for kind `song`: a Standard MIDI File, base64 |
| `name` | string | shown in the reply and the files |
| `dither` | `none` \| `ordered` \| `diffusion`, default `none` | how non-exact colours are reduced |
| `alphaThreshold` | 0..255, default 128 | pixels at or below this alpha are transparent |
| `size` | `[w, h]` | sprite size for kind `sprites`; default `[16, 16]` |
| `maxPalettes` | 1..16 | palette cap for the import |

Example call:

```json
{"name":"source_add","arguments":{"kind":"sprites","name":"red-square",
 "png":"iVBORw0KGgo…","size":[16,16]}}
```

Example reply (abridged):

```json
{"ok":true,"kind":"sprites","name":"red-square","size":{"width":16,"height":16},
 "stats":{"tiles":1,"max_tiles":1536,"palettes":1,"max_palettes":16,
  "colours":2,"max_tile_colours":16,"dither":"none"},
 "files":["main.lua","palettes.json","sprites.json"],
 "budget":{"tiles":1,"patterns":1,"sprites":1,"vram_words":1360,
  "vram_total":32768,"vram":{"bat":1024,"tiles":16,"patterns":64,
  "sat":256,"used":1360,"total":32768},"cram_entries":512,"sat_entries":64},
 "warnings":[],
 "note":"imported with the Add Source importer (renderer/pce-source.js, #123) and merged into the toy's asset files; the panels' own readers accepted the merged set; the previous run was cleared — call toy_run to see the picture"}
```

Merge rules, so a second add never silently destroys the first:

- `bg` and `tilesheet` replace `tiles.json` (one BAT map per toy) and take
  the new backdrop; `sprites` appends to `sprites.json` — patterns are
  reindexed past the old ones, SAT entries are appended after the old
  sprites, and their palette rows land on free rows; `palette` merges row by
  row, incoming non-zero entries winning.
- A refused import changes nothing: the merge is validated against the
  hardware (`toPicture`) on a copy and committed only if it fits.

Refusals: `source-kind`, `source-picture` (png and grid both or neither),
`source-grid`, `source-size`, `source-tiles`, `source-empty`,
`source-palettes` (no free sprite palette row), `source-sat` (past 64
sprites), the `png-*` family from the studio's importer, `asset-json` when
the toy's own asset files do not parse, and `source-song` / the `mid-*`
family from the song importer (below).

#### kind `song` — a `.mid` becomes the toy's song (#161)

`source_add` kind `song` takes `mid` — a Standard MIDI File, base64 — and
runs it through the studio's own `.mid` importer
(`renderer/pce-source.js importMidi`, #123): its MIDI channels become the
PSG's six voices and its notes become a SEQUENCER song, written as the toy's
`song.json`. It replaces the toy's one song, and `music(0)` plays it.

```json
{"name":"source_add","arguments":{"kind":"song","name":"title tune",
 "mid":"TVRoZAAAAAYAAAABAeBNVHJrAAAA…"}}
```

The reply is the importer's stats (`notes`, `patterns`, `tempo`, `steps`,
`channels`, `ignored`), the file set, the `songs` slots and the `song`
document that was written, plus `music_index` — the index `music()` takes.
Refusals: `source-song` (no `mid`, or it decodes to nothing) and the
importer's own `mid-signature`, `mid-smtpe`, `source-seq`, `seq-*`.

### `song_write(notes | song, …)`

Composes the toy's song (#161) with the SEQUENCER's built-in instruments and
writes it as `song.json` — the file `music(index)` plays and the studio's
SEQUENCER edits. Two forms, exactly one of them:

| argument | type | meaning |
| --- | --- | --- |
| `notes` | array of `{channel, step, note, length, instrument}` | the step list; `channel` 0..5 (default 0), `step` ≥ 0, `note` a name (`C4`) or the engine note 0..83, `length` in steps (default 1, to the end of the pattern), `instrument` a built-in name or index (default lead) |
| `song` | object | the SEQUENCER's own document (`pce-seq.js` VERSION): `{name, tempo, swing, key, steps, patterns, order, instruments}` |
| `name` | string | the song's name, on both forms |
| `tempo`, `steps`, `swing`, `key` | integer | the notes form's grid settings; pce-seq.js's own ranges |

The built-in instruments are `lead`, `bass`, `bell`, `strings` (wave voices)
and `kick`, `snare` (noise drums; `pce-song.js` does not play effect 0F yet,
so through `music()` they sound their envelope on a wave channel — use `sfx()`
for a percussion hit in a toy). `step` counts columns from 0 across patterns
of `steps` columns, so step 32 is pattern 2 column 0.

```json
{"name":"song_write","arguments":{"name":"game tune","tempo":140,"steps":16,
 "notes":[{"channel":0,"step":0,"note":"C4","length":2,"instrument":"lead"},
          {"channel":1,"step":0,"note":"C3","length":8,"instrument":"bass"}]}}
```

The reply: `file`, `name`, `tempo`, `steps`, `patterns`, `order`,
`notes_placed`, `instruments`, `frames` and `seconds` (the whole song's
length at the player's tick rate), the file set, the `songs` slots,
`music_index`, the `song` document written, and `warnings` (a song with no
notes says so). Refusals: `song-input` (both forms or neither),
`seq-note`, `seq-instrument`, `seq-channel`, `seq-length`, `seq-pattern`,
`seq-tempo`, `seq-steps`, `seq-swing`, `seq-key`, `seq-voice` (a noise drum
on a channel without the noise generator), `seq-json`. A refused song leaves
the toy and the loaded song alone.

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
 "sha256":"fb53b96fa2d77311…",
 "path":"/tmp/pce-mcp/parallax.pce",
 "route":"#100's browser route, no compiler: renderer/pce-il.js -> renderer/pce-ilbc.js -> renderer/pce-rom.js buildToyRom over the committed renderer/ilvm.bin",
 "bytecode_bytes":1115,"ilvm_bytes":16384,"assets":[],
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
- A toy is one Lua file plus asset files; `main.lua` runs and `toy_run`
  imports the rest into VRAM, CRAM and the SAT before `init()`.
- 1536 tiles max per picture (`source-tiles`); sprite imports hold 16 palette
  rows and 64 SAT entries total, past which `source_add` refuses
  (`source-palettes`, `source-sat`).
- A `.pce` is 24 KiB: 16 KiB committed interpreter + one 8 KiB data bank. A
  bytecode-plus-assets payload past 8 KiB is refused by `toy-data-bank-full`.

## Evidence

`node tests/check-mcp.js` starts `tools/mcp/server.js`, speaks MCP over
stdio, and asserts 313 checks:

- `initialize`, `ping`, and `tools/list` with all thirteen tools and their
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
- the art route (#153): a base64 PNG added with `source_add` as sprites, a
  toy that moves its SAT slot with `sat()` and enables SB, and `frame_png`
  shows the sprite's pixels at the slot's spot (a control run without the
  import is blank there); a second add appends, a refused add leaves the toy
  byte-identical, and a toy with `tiles.json` renders the same frame through
  the MCP server as through the studio host (`pictureFromFiles`), diff 0;
- the song route (#161): `toys/oak-woods/song.json` in `toy_write`'s files
  is the runtime's `options.songs`, so `music(0)` plays — PSG writes are
  recorded, every channel the compiled song uses starts notes and reports
  its instrument, and the run matches an independent `il.create(source,
  {songs})` run's write count; the same toy without the file is refused
  `music-range` (the control); a `.mid` through `source_add` kind `song`
  becomes `song.json` through the Add Source importer and `music(0)` plays
  it; `song_write` composes a tune with the built-in instruments; a refused
  `.mid` or song leaves the loaded song playing; and the written song's
  `pce.studio/1` envelope opens through `renderer/pce-source.js
  importStudio`, with the SEQUENCER's own read-back (`pce-seq.js fromJSON`)
  returning the same grid;
- the hand-off (#160): `toy_save` writes one `pce.studio/1` envelope with
  the studio's key order and text, holding `main.lua`, the added PNG's
  `sprites.json`/`palettes.json` and the named `sources.json` byte for byte;
  the studio's own `importStudio()` reads it and the frame it renders is the
  MCP run's frame, diff 0; a control saved without the art opens and draws
  the sky where the saved toy draws its sprite; `..` and absolute paths
  outside the working folder are refused with `save-path` and write nothing,
  and a server started in another folder saves into that folder;
- resuming a project (#163): session 1 saves a toy with `source_add`'s art
  and a `NOTES.md` as one `.pcestudio` and as an unpacked folder; the
  studio's own project reader (`pce-project.js parseBytes`) opens the
  archive and draws session 1's frame, diff 0; session 2, a **fresh server
  process**, `project_open`s the file and the folder, gets `NOTES.md`'s text
  as the reply's first block, and draws the same frame, diff 0; a project
  with no `NOTES.md` gets the studio's template; `open-path` fences the
  working folder and `project-format` refuses a ZIP that is not a project;
- `docs` chapter list, a chapter's own numbers, and a refused unknown topic.

Written by @design because the card names the file. Per workshop rule 2, a
**cold break by another seat is owed** before this closes the card.
