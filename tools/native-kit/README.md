# PCEStudio native build kit

This folder builds your game into a PC Engine ROM (`game.pce`) with the native
compiler (llvm-mos). The ROM runs faster than the one the studio's Export
button makes, because the game is compiled to HuC6280 machine code instead of
being interpreted.

## You need

- **Node 18 or newer** (https://nodejs.org). Nothing else: no Python, no bash,
  no `npm install`.
- A one-time download of the compiler: about 190 MB on macOS, 115 MB on Linux,
  210 MB on Windows. The script fetches it from the official llvm-mos release
  on GitHub, checks its SHA-256 against `toolchain.json`, and only then unpacks
  it into `~/.pcestudio/llvm-mos` (on Windows `%USERPROFILE%\.pcestudio`).
  After that it works offline.

## Build

Open a terminal in this folder and run:

    node build.js

It prints the ROM's size and SHA-256 and writes `game.pce` next to the script.
Open that in an emulator (Mednafen, Geargrafx, ares) or put it on a flash cart.

Your game is in `game/` (`main.lua`, and `tiles.json`, `palettes.json`,
`sprites.json`, `song.json`, `songs.json` when it has art and music). You can
edit `game/main.lua` and run `node build.js` again.

Options: `node build.js --help`.  `--opt -Oz` builds smaller, `--opt -Os`
(the default) builds faster code.

## If the download is blocked

- Behind a proxy: set `HTTPS_PROXY=http://host:port` and run again.
- Download it yourself: `node build.js --print-toolchain` shows the file and
  its SHA-256. Fetch it in a browser, then run
  `node build.js --archive PATH-TO-THE-FILE`.
- Already have llvm-mos: set `LLVM_MOS` to its folder (the one that holds
  `bin/mos-pce-clang`).

Windows: unpacking uses `tar.exe` (in `C:\Windows\System32` on Windows 10 and
11). If it cannot read the `.7z`, unpack it with 7-Zip into
`%USERPROFILE%\.pcestudio\llvm-mos\<folder named in the error>` and run again.

Supported machines: macOS (Apple silicon and Intel), Linux x64, Windows x64.
llvm-mos publishes no Linux arm64 SDK; build it yourself and set `LLVM_MOS`.

## Kit version

`build.js` and `toolchain.json` are kit version 1, and `game/kit.json` says
which kit the game was exported for. If they disagree the script stops and tells
you to download a fresh kit from the studio (Export, Download native build kit).

## Licences

See `LICENSES/`. This kit is part of PCEStudio (GPL-3.0). It runs the llvm-mos
compiler (Apache-2.0 with LLVM exceptions), which is downloaded, not included.
Sound-engine images are built from HuTrack (MIT, Turboxray). The JavaScript
compiler front end uses Fengari (MIT).
