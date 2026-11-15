# The native build kit

The studio's **Export** button builds a ROM that runs your game on an
interpreter. The *native build kit* builds it the other way: your game is
compiled to HuC6280 machine code (Lua to the studio's intermediate form, to C,
to a ROM with the llvm-mos compiler, [`NATIVE.md`](NATIVE.md)). The result runs
much faster. The compiler cannot run inside a browser tab, so the studio hands
you a small folder that does the build on your own computer. Nothing is sent
anywhere.

## Get it

In the studio: **Export**, then **Download native build kit**. The page builds
`<toy>-native-kit.zip` itself (the C emitter has already checked the game; a
game it refuses shows its findings instead of a zip). The kit for the five
gallery games is built the same way from their folders.

## Build, per system

You need **Node 18 or newer** (https://nodejs.org) and about 1 GB of free disk
for the compiler. Nothing else: no Python, no bash, no `npm install`.

Unzip the kit, open a terminal **in the unzipped folder** and run:

    node build.js

| System | What the first run downloads | Where it keeps it |
|---|---|---|
| macOS (Apple silicon or Intel) | `llvm-mos-macos.tar.xz`, about 190 MB | `~/.pcestudio/llvm-mos` |
| Linux x64 | `llvm-mos-linux.tar.xz`, about 115 MB | `~/.pcestudio/llvm-mos` |
| Windows 10/11 x64 | `llvm-mos-windows.7z`, about 210 MB | `%USERPROFILE%\.pcestudio\llvm-mos` |

The file comes from the official llvm-mos SDK release on GitHub named in
`toolchain.json`. The script compares its SHA-256 with the one pinned there
**before** it unpacks anything; a file that does not match is deleted and the
build stops. After the first run it works offline and a build takes a few
seconds. The ROM is `game.pce` next to the script; its size and SHA-256 are
printed.

- **Linux** needs `tar` with xz support (`xz-utils` on Debian and Ubuntu).
- **Windows** unpacks with `tar.exe`, which Windows 10 (version 1803) and 11
  carry in `C:\Windows\System32`. If it cannot read the `.7z`, unpack the
  archive with 7-Zip into the folder the error names and run the script again.
- **Linux arm64** has no official llvm-mos SDK. Build llvm-mos yourself and set
  `LLVM_MOS` to its folder.
- Paths with spaces, backslashes and CRLF line endings in `game/main.lua` are
  handled; the script starts programs without a shell.

The game is in `game/`: edit `game/main.lua` (and its art and song files) and run
`node build.js` again. `node build.js --help` lists the options; `--opt -Oz`
builds a smaller ROM, `--opt -Os` (the default) a faster one.

## When the download is blocked

The script says what failed and how to go on. In short:

1. **Just retry:** `node build.js`.
2. **Behind a proxy:** set `HTTPS_PROXY` (for example `http://proxy.example:8080`;
   `user:password@` works; `NO_PROXY` is honoured) and run it again.
3. **Download it by another route:** `node build.js --print-toolchain` prints the
   file and its SHA-256. Fetch the file in a browser or on another machine, then
   run `node build.js --archive PATH-TO-THE-FILE`. The checksum is still checked.
4. **You already have llvm-mos:** set `LLVM_MOS` (or `--toolchain DIR`) to the
   folder that holds `bin/mos-pce-clang`. Nothing is downloaded.

`PCESTUDIO_HOME` (or `--home DIR`) moves the folder where the toolchain is kept.
Antivirus software that quarantines the unpacked compiler is the one failure the
script cannot fix; allow `~/.pcestudio` (`%USERPROFILE%\.pcestudio`).

## Out-of-date kits

`build.js` and `toolchain.json` carry a kit version, and `game/kit.json` says
which kit the game was exported for. If they disagree, the script stops and says
to download a fresh kit from the studio rather than build with mismatched parts.

## What is in the zip

| Path | What |
|---|---|
| `build.js` | the one script |
| `toolchain.json` | the pinned llvm-mos release: URL and SHA-256 per system |
| `game/` | your game: `main.lua`, and its art and song files |
| `tools/toyc/` | the C runtime (`toy_*.c/.h`) and the Lua-to-C front end |
| `renderer/`, `vendor/fengari/` | the JavaScript the front end uses (the studio's own files) |
| `engines/` | prebuilt sound-engine images at six RAM bases |
| `LICENSES/`, `README.md` | licences and a short readme |

**Sound.** A game that plays sound gets the HuTrack engine. The engine's RAM
sits just above the compiled program's, and its code carries those addresses, so
the kit ships an image for each of six bases (`$2400`, `$2800`, `$2C00`,
`$3000`, `$3400`, `$3800`) and uses the lowest one at or above the program's own
RAM. A game whose RAM ends above `$3800`, or whose engine would leave the stack
less than `$3E00`, is refused with a message. The images are built with PCEAS
4.x (`node tools/native-kit/make-engines.js`, a maintainer step), so a user never
needs an assembler.

**Same bytes as the repository's script.** `tools/build-toyc-banked.sh` with
`ENGINE_BASES` set to those six bases builds the same ROM; `tests/check-native-kit.js`
builds PLATFORMER, TOWER, STARFALL and NOVA TIDE from an unzipped kit on a clean
folder (with a space in its name) and compares the ROM, byte for byte, with the
script's on a machine that has it, and with pinned SHA-256 values everywhere.
`.github/workflows/native-kit.yml` runs the same test on Linux, Windows and
macOS (started by hand: Actions, *native-kit*, *Run workflow*).

## Licences

- **PCEStudio** (the kit's scripts, runtime and front end): GPL-3.0,
  `LICENSES/PCEStudio-GPL-3.0.txt`. The runtime is the same one linked into every
  ROM the Export button makes; this adds no new licensing question.
- **llvm-mos**: Apache-2.0 with LLVM Exceptions. It is downloaded from its own
  release, not redistributed in the kit (`LICENSES/llvm-mos.txt`).
- **HuTrack** (the sound engine, in the prebuilt images): MIT, Turboxray,
  `LICENSES/HuTrack-MIT.txt`.
- **Fengari** (the Lua parser the front end uses): MIT, `LICENSES/Fengari-MIT.txt`.

## Maintainer notes

- `node tools/native-kit/make-base.js` regenerates `renderer/native-kit-base.json`
  (the kit's static files, which the page fetches). `tests/check-native-kit.js`
  fails when it is stale: run it after changing `tools/toyc/toy_*`, the script,
  the toolchain pins or the engine images.
- Moving to a newer llvm-mos release means new URLs and SHA-256 values in
  `tools/native-kit/toolchain.json` and new pins in `tests/native-kit-pins.json`
  (`node tests/check-native-kit.js --update-pins` on a Mac that has the repo
  script's tools).
- Not covered: a real Windows machine with antivirus or a company proxy. The
  workflow proves a clean Windows runner with a direct connection.
