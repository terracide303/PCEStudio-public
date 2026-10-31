# PCEStudio

**A PC Engine (TurboGrafx-16) studio that runs in your browser.** Write small programs in Lua, watch them run on a
model of the console's real graphics and sound chips, look inside the machine while it runs, and export a `.pce`
ROM. Make a game by hand, or let an AI such as Claude make it with you.

> **Beta 1.** It works and you can play and build with it, but parts are unfinished. The honest list is below, in
> [What does not work yet](#what-does-not-work-yet).

**Try it:** <https://pcestudio.terracides.com> · **Testers' guide:** <https://pcestudio.terracides.com/renderer/testers.html>
· **Claude Code manual:** <https://pcestudio.terracides.com/renderer/claude-code.html>
· **Report a bug or an idea:** [Issues](https://github.com/terracide303/PCEStudio-public/issues/new/choose)

---

## What it is

The PC Engine draws its picture with a few small chips, and PCEStudio models them by the book:

| Chip | What PCEStudio does with it |
| --- | --- |
| **HuC6270 VDC** | One scrolling background made of 8×8 tiles (16 colours each), 64 sprites (16×16 up to 32×64, at most 16 on a line), the line interrupt, the status flags. |
| **HuC6260 VCE** | The 512-colour palette (3 bits each of red, green and blue): 16 background and 16 sprite palettes of 16 colours. |
| **HuC6280 PSG** | Six sound channels with wave and noise, plus the 15 built-in instruments and a step sequencer. |

A program for it is a **toy**: a `main.lua` with `init()` and `frame(t, f)`, plus the picture, palettes, sprites, songs
and waves it uses. The studio runs the toy 60 times a second and shows you the screen, and the chips' memory: VRAM,
palettes, sprite table, registers, scanlines, sound.

## What you can do

- **Play** the example games in **Browse** and open any of them in the studio to see how it's made.
- **Write toys in Lua**, with live output, a frame scrubber, markers, stepping and rewinding.
- **Look inside**: SCREEN, VRAM, PALETTES, SPRITES, AUDIO, SEQUENCER, LAYERS, SCANLINES, REGISTERS and CONSOLE panels.
- **Add art and sound**: drop a PNG, a WAV or a MIDI file on **Add Source** and it becomes tiles, sprites, a
  tilesheet, a palette, a sample or a song, fitted to what the console can do. Assets are listed by name with previews.
- **Check** a toy against the console's limits (sprites per line, VRAM, frame time) with the validator.
- **Export a `.pce`** from the page, with nothing to install, for an emulator or a flash cart (simple toys for now).
- **Make toys with an AI**: a guide file for chat assistants, and an MCP server for Claude Code that can write, run,
  look at, check and export a toy by itself.

## Make a game with an AI

**With a chat assistant** (claude.ai, ChatGPT, …): in the studio press **Download for Claude** (or take
[`renderer/pcestudio-for-claude.md`](renderer/pcestudio-for-claude.md)), attach it to a new chat and say what you want.
Copy the Lua it writes into the studio with **Paste & Run** and tell it what you see. The guide teaches the assistant the
console's rules, the toy API and how to fix its own mistakes.

**With Claude Code**, which can run the loop itself:

```sh
git clone https://github.com/terracide303/PCEStudio-public.git
cd PCEStudio-public
claude mcp add pcestudio -- node "$PWD/tools/mcp/server.js"
mkdir -p ~/.claude/skills
ln -s "$PWD/plugin/skills/creating-pce-toys" ~/.claude/skills/creating-pce-toys
```

Then ask it for a game. It writes the toy, turns your PNGs (or pixel grids it draws) into sprites and tiles, runs it
with a scripted pad, looks at frames, runs the validator and can save the result for the studio. The full manual, with
Windows instructions, examples and troubleshooting, is
[`renderer/claude-code.html`](renderer/claude-code.html) and [`docs/MCP.md`](docs/MCP.md).

## Run it on your own computer

The studio is plain static files: no build step, no package manager.

```sh
git clone https://github.com/terracide303/PCEStudio-public.git
cd PCEStudio-public
python3 -m http.server 8770        # or any static file server
# then open http://127.0.0.1:8770/renderer/browse.html
```

Node.js (a current LTS) is only needed for the command-line tools, the MCP server and the tests.

## The toys

A toy is a folder under [`toys/`](toys/) (or one `.lua` file). The ones in Browse:

| Toy | What it is |
| --- | --- |
| **Sky gradient** | A sunset drawn with a palette change on every scanline. |
| **STARFALL** | A small shooter, the first complete game made in the studio. |
| **PLATFORMER**, **TOWER** | A run-and-jump game and a ladder-climbing game with rolling boulders, written with Claude. |
| **DUSK RUN** | An endless runner over five scrolling bands. |
| **NOVA TIDE** | A side-scrolling shoot-'em-up whose art is imported as named assets, written with Claude. |
| **OAK WOODS**, **CITY** | Demos made from third-party art packs. The packs' art is not in this repository (see [Licence and credits](#licence-and-credits)); the toys' code is. |

Each toy's own `README.md` says how it was made and which keys it uses. A toy's API is documented in
[`docs/TOYS.md`](docs/TOYS.md) and, generated from the code itself, in the studio's **Docs** page.

## Export to a ROM

The studio compiles a toy to a small bytecode and glues it to a fixed interpreter ROM, all in the browser
([`docs/EXPORT.md`](docs/EXPORT.md), [`docs/IL.md`](docs/IL.md)). That route handles simple toys today. Games that use Lua
tables, `sprite()`, the pad or `sfx()` run in the studio but are refused by the export, with a message naming the line.
Carrying those is the next big piece of work. The ROMs are checked in an emulator; nothing has run on a real console yet.

## Project files

**Project…** saves and opens a whole project as one `.pcestudio` file: the code and asset files, a
`NOTES.md` written for whoever continues the game, the original PNG/WAV/MID files that Add Source imported,
and named snapshots of the code and assets. It is a ZIP underneath, so it can also be opened with any unzip
tool. The old **Save file** still writes the plainer `.pce.json` toy envelope, and that still opens. Format,
layout and the Save/Open window: [`docs/PROJECT-FORMAT.md`](docs/PROJECT-FORMAT.md).

## Repository map

| Path | What's in it |
| --- | --- |
| [`renderer/`](renderer/) | The studio and the pages (`studio.html`, `browse.html`, `toy.html`, `docs.html`, the guides), and the engine modules: `pce-bg`, `pce-sprites`, `pce-psg`, `pce-toyhost`, `pce-il`, `pce-validate`, `pce-rom`, `pce-source` and the rest. |
| [`toys/`](toys/) | The example toys. |
| [`tools/`](tools/) | Command-line tools: the MCP server (`tools/mcp/`), the docs and gallery generators, the site upload script, art converters, build scripts. |
| [`plugin/`](plugin/) | The Claude Code skill that teaches the toy API, with worked recipes. |
| [`tests/`](tests/) | The test suites, one `check-*.js` per area, run by `tests/all.sh`. |
| [`docs/`](docs/) | The studio ([`STUDIO.md`](docs/STUDIO.md)), the toy API ([`TOYS.md`](docs/TOYS.md)), the compiler ([`IL.md`](docs/IL.md)), the sound chip ([`PSG.md`](docs/PSG.md)), the ROM layout ([`ROM_LAYOUT.md`](docs/ROM_LAYOUT.md)), hardware notes ([`MANUALS.md`](docs/MANUALS.md)), build notes ([`BUILD.md`](docs/BUILD.md)), the MCP server ([`MCP.md`](docs/MCP.md)). |
| [`vendor/`](vendor/) | Third-party code that ships with the studio: Fengari (Lua in JavaScript), CodeMirror, HuTrack and parts of ppu.toys, each with its own licence. |

## Tests

```sh
sh tests/all.sh
```

builds the ROMs the suites read and runs every `tests/check-*.js` and `tests/*-mutation.js`, one verdict each. It needs
Node.js and the PC Engine assembler `pceas` on your `PATH` (how to get it: [`docs/BUILD.md`](docs/BUILD.md)). A few suites
need extra tools (an emulator, a headless Chrome, llvm-mos) and print `SKIP` with the reason when those are missing.

Most suites compare the engine's output with the same toy run two ways (Lua and the compiled bytecode) frame by frame,
and the mutation suites break the engine on purpose to show the tests notice.

## What does not work yet

- **Export** of games that use tables, `sprite()`, the pad or `sfx()` (see above).
- **Real hardware**: nothing has been tried on a console or a flash cart.
- **Phones and tablets**, **CD-ROM, Arcade Card and SuperGrafx** are not designed for.
- The MCP server and the studio have been tested on **macOS** only. Linux and Windows should work (plain Node.js and
  static files); reports are welcome.

## Reporting bugs and ideas

Use [Issues](https://github.com/terracide303/PCEStudio-public/issues/new/choose). There are forms for a bug report, an
idea and sharing a toy; the [testers' guide](https://pcestudio.terracides.com/renderer/testers.html) explains what makes
a good bug report (steps, what you expected, the frame number, the console text, your browser, the toy file).

This repository is published from a private working copy, so a pull request can't be merged as it stands. Please open
an issue first; accepted changes come back with the next publish.

## Licence and credits

PCEStudio's own code is free software under the **GNU General Public License, version 3 or (at your option) any later
version** ([`LICENSE`](LICENSE)).

- [`renderer/pce-psg.js`](renderer/pce-psg.js) is derived from the PSG core of **Mednafen** (GPL-2.0-or-later) and from
  **Blip_Buffer** 0.4.1 (LGPL-2.1-or-later, Shay Green), which is why the project is GPL.
- Code under [`vendor/`](vendor/) keeps its own licence (see each folder's notice): Fengari, CodeMirror, HuTrack and the
  parts taken from **ppu.toys** (Liora Labs) are MIT.
- The idea, and the shape of the studio, come from **[ppu.toys](https://ppu.toys)**, a studio for the SNES, with its
  author's blessing.
- The browser export's interpreter-in-the-ROM idea is turboxray's.
- HuC, the PC Engine C compiler, is **not** in this repository. `tools/build-huc.sh` downloads it when you want the
  optional comparison against it.
- **Demo art.** OAK WOODS uses the *Oak Woods* pack and its character by **Brullov** ([brullov.art](https://brullov.art));
  CITY uses *Action Pack – CITY* by **Anokolisa** ([patreon.com/Anokolisa](https://www.patreon.com/Anokolisa)). Their art
  is shown on the website; it is **not part of this repository** and **not covered by the GPL**. All other art in the toys was drawn for them.
- *PC Engine* and *TurboGrafx-16* are trademarks of their owners. PCEStudio is a fan project and is not affiliated with
  NEC, Hudson Soft or Konami.
