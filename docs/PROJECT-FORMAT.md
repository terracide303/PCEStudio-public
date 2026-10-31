# PROJECT-FORMAT — the `.pcestudio` project file (#162)

**One file that holds a whole game, so it can be resumed in another session.**

Dennis, 2026-10-29:

> it would be nice to be able to save project files. That is more as just the
> game, but it's for Claude to resume the game and have everything it made and
> has done so you can work on it in multiple sessions
>
> maybe use our own file extension

The old **Save file** writes a `.pce.json` toy envelope: the code and the asset
files, nothing else. A `.pcestudio` adds the three things a later session
cannot reconstruct from the code — **Claude's resume note** (`NOTES.md`), the
**original art** the sources were imported from, and **named versions** of the
project's code and assets. The `.pce.json` still opens (it is a project
without notes) and Save file still writes it.

## Container

`<name>.pcestudio` is a **ZIP** — stored entries when the studio writes it,
stored or deflate when read, so an archive re-packed by macOS Archive Utility
or `zip -9` opens too. The writer is `renderer/pce-zip.js` (no dependency; the
repo has no `package.json`) and the layout is below. Because it is an ordinary
ZIP, `unzip -t` accepts it and renaming it to `.zip` shows the files in Finder.

Wall clock: timestamps are ZIP's 1980 epoch and entries are written in a fixed
order, so **save → open → save is byte-identical**.

## Layout — the same as an unpacked project folder

```
<name>.pcestudio
├── project.json          format "pcestudio/1", title, author,
│                         created/modified, the file list and kinds
├── main.lua              the toy
├── <other>.lua           (any other Lua the project carries)
├── tiles.json            ┐
├── palettes.json         │ the asset files, the same documents the panels
├── sprites.json          │ edit (cards #77/#117/#156)
├── waves.json            │
├── sources.json          │ named sources; `original` names its original
├── samples.json          │ (only when the project has them)
├── instruments.json      │
├── song.json / songs.json┘ (the song the AUDIO/SEQUENCER panels write)
├── NOTES.md              the resume note — a template is made for a new
│                         project; editable as a tab beside main.lua
├── art/                  the ORIGINAL PNG/WAV/MID files as they went into
│   └── <name>            Add Source, so they can be re-imported with other
│                         settings.  Never written by a version.
└── versions/             named snapshots of the code+asset files only
    └── <n>-<label>/
        └── <file>
```

There are **no directory records** in the archive: every entry is a file, so
an unpacked copy is literal (the readers skip `dir/` entries anyway).

## `project.json`

```json
{
  "format": "pcestudio/1",
  "title": "Demo game",
  "author": "Dennis",
  "created": "2026-10-31T10:00:00.000Z",
  "modified": "2026-10-31T10:30:00.000Z",
  "files": [
    { "name": "main.lua", "kind": "lua", "bytes": 34 },
    { "name": "NOTES.md", "kind": "notes", "bytes": 629 }
  ],
  "art": [
    { "name": "hero.png", "path": "art/hero.png", "bytes": 1048576,
      "source": "hero" }
  ],
  "versions": [
    { "dir": "versions/1-first-look", "label": "first look",
      "created": "2026-10-31T10:15:00.000Z",
      "files": [ { "name": "main.lua", "kind": "lua", "bytes": 24 } ] }
  ]
}
```

`files`, `art` and `versions` are the dialog's checklist with sizes; the
archive's actual entries are the truth when opening (a file listed but missing
cannot be loaded, and a file present but unlisted is still read). A project
whose `format` is not `pcestudio/1`, or that has no `project.json` or no
`main.lua`, is refused with a code (below) — the studio never half-opens one.

### Kinds

| kind | names |
|---|---|
| `lua` | `*.lua` |
| `notes` | `NOTES.md` (and any other `*.md`) |
| `tiles` `palettes` `sprites` `waves` | the panel documents |
| `sources` | `sources.json` |
| `samples` `instruments` | `samples.json`, `instruments.json` |
| `song` | `song.json` or `songs.json` |
| `json` | any other root JSON |

## NOTES.md — the resume note

A new project's `NOTES.md` is created from `notesTemplate()` with five
sections, deliberately in the order a resuming session needs them:

1. **Goal** — what the game is meant to be
2. **What works** — the parts that run, and how that was seen
3. **What does not work** — known breakage and its evidence
4. **Decisions** — decision, who made it, why, date
5. **Next steps** — the next thing to do

The file is a normal text file in the project and is editable as a tab.

## `art/` — the originals

When **Add Source** imports a PNG, WAV or MID it keeps the bytes it read as
`art/<basename>` (a duplicate name gets `-2`, `-3`). The `sources.json` entry
it writes gains an `original` field naming that file:

```json
{ "name": "hero", "kind": "bg", "original": "art/hero.png",
  "tiles": { "first": 0, "count": 12 }, "map": true,
  "palettes": { "side": "bg", "first": 0, "count": 3 } }
```

`sources()` (renderer/pce-assets.js) ignores the field; it exists so the source
can be re-imported with a different dither, palette count or sample rate
without the file. Originals are not snapshotted into versions.

## `versions/` — named snapshots

**Snapshot…** copies the project's code and asset files (never `NOTES.md` or
`art/`) into `versions/<n>-<label>/`, with `n` 1-based and the label reduced to
a flat slug. The oldest is kept: the page caps the list at
`MAX_VERSIONS = 8` and refuses a new snapshot past that until one is deleted.
**Restore** puts a version's files back into the *current* project; if the
studio has unsaved work it asks first, and the displaced toy also goes to
Open… → Recover. A project written by another tool with more versions is read
whole — the cap is the page's rule, not the format's.

## Save and Open in the studio

The **Project…** button opens one dialog with two tabs (Dennis: *"and have a
window for saving loading etc where to select what you want etc"*).

**SAVE** — name, a checklist of what goes in (code, assets/sources, songs,
`NOTES.md`, original art, versions, each with its size, all on by default), and
the format: project `.pcestudio`, plain toy `.pce.json`, or ROM `.pce` through
Export…. Untick a group and it is left out of the archive; a save that would
leave out `main.lua` is refused (`project-code`). Notes are templated into the
archive without changing the live file set; after a successful download
`NOTES.md` becomes an editable tab.

**OPEN** — pick or drop a `.pcestudio`, `.pce.json`, `.lua`, or an original
PNG/WAV/MID; the window shows what is inside (files, the notes' first lines,
versions, originals) before anything is loaded. Tick the groups and choose
**replace the current toy** or **add to it** — so a song or only the art can be
taken from another project. Replace asks before unsaved work is discarded. A
dropped `.pcestudio` takes the same path; a dropped PNG/WAV/MID is kept as an
original with nothing else changed. Recent projects are listed from browser
storage (per viewer); one too large for storage is listed as *not kept*.

## From Claude Code — the folder route (#163)

The MCP server writes and reads the same format. `project_save {path, notes}`
writes one `.pcestudio`, and **when `path` is a folder** (a trailing `/` on
the name, or a folder that already exists) it writes the layout **unpacked**
into it — the same files this document lists, one level of `art/` and
`versions/` included. That is the route Claude Code is meant to use: the
folder is a normal git repository, so committing after each session puts the
game's history in git, one readable diff at a time.

`project_open {path}` reads either form back into the session, and answers
with `NOTES.md`'s text **first**. A folder is read through its manifest:
`project.json` names the root files, the `art/` originals and the
`versions/<n>-<label>/` files, and those are what loads — a repository's
`.git/`, its `README.md`, a committed screenshot or anything else the
manifest does not list is not a project file. The MCP session has no
originals in `art/` and no named versions (source_add keeps the imported
files, not the picture it read); the studio's Save project fills them.

## API

`renderer/pce-project.js` (UMD: Node `require`, browser `PCEStudio.project`):

| function | meaning |
|---|---|
| `notesTemplate({title, date})` | the `NOTES.md` text |
| `build(project, include)` | the ZIP bytes |
| `entries(project, include)` | the unpacked folder's files as `{name, bytes}` |
| `parseBytes(bytes)` / `parseEntries(list)` | `{format, title, author, created, modified, files, notes, art, versions}` |
| `describe(project)` | the OPEN pane's summary |
| `sizes(project)` | bytes per checklist group |
| `projectDoc(project, include)` | `project.json`'s object |
| `fileKind(name)`, `groupOf(file)`, `zipName(title)` | name rules |
| `MAX_VERSIONS`, `FORMAT`, `NOTES_NAME`, `ART_DIR` | constants |

`renderer/pce-zip.js` exposes `write(entries)`, `read(bytes)` (store + deflate),
`crc32`, `inflateRaw`, `utf8Encode`, `utf8Decode`.

The page's API is `studio.project`: `save`, `open`/`openBytes`, `openFile`,
`openText`, `snapshot`, `versions`, `restore`, `keepOriginal`, `art`,
`openDialog`, `saveFromDialog`, `openFromDialog`, `setInclude`, `setLoad`,
`setMode`, `recent`, `openRecent`.

### Refusal codes

| code | when |
|---|---|
| `project-format` | no `project.json`, or its `format` is not `pcestudio/1` |
| `project-json` | `project.json` is not one JSON object |
| `project-main` | the archive has no `main.lua` |
| `project-name` | a file name with a path or unsafe characters |
| `project-code` | a save that would leave out `main.lua` |
| `zip-eocd` / `zip-64` | not a ZIP / a ZIP64 archive (not needed here) |
| `zip-entry` | an entry that runs past the archive |
| `zip-method` | a compression method other than store or deflate |
| `zip-inflate` / `zip-crc` | a DEFLATE stream that does not decode / a CRC mismatch |

## Evidence

- `node tests/check-project.js` — save → open → save byte-identical, every
  file byte-identical, `NOTES.md` and a real 1 MB PNG original intact,
  `unzip -t` accepts the archive, a deflated copy (system `zip -9`, what
  Archive Utility writes) opens, the checklist leaves `art/` out when unticked,
  and every refusal code.
- `node tests/check-studio.js` (its #162 section) — the page's Save project /
  Open project and the Project dialog driven headlessly: save with art
  unticked leaves `art/` out; open with only songs ticked adds the song and
  leaves `main.lua` unchanged; a `.pce.json` still opens; a snapshot restores.
