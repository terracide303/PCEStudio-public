# PCEAS, compiled to WebAssembly

This directory is the browser-side build of **PCEAS**, the MagicKit-derived PC
Engine assembler from [uli/huc](https://github.com/uli/huc).  It is the
assembler `docs/BUILD.md` describes and the one `make -C tools` runs; the
WebAssembly build exists so the studio can assemble a project without an
external process (card #224).

| file | what it is |
| --- | --- |
| `pceas.wasm` | the assembler, compiled from the C sources below |
| `pceas.js` | Emscripten's module factory (`createPceas`) around it |
| `LICENSE` | a verbatim copy of the source tree's `LICENSE` |

`renderer/pce-asm.js` is the only caller: it loads these two files, writes the
source and its includes into the module's in-memory filesystem, and runs
`main()` once per `assemble()`.  The module is created fresh for each call, so
PCEAS's global assembler state cannot leak between assemblies.

**No HuC C compiler is included here.**  This is the assembler only.  HuC is
still external and still downloaded by `tools/build-huc.sh` when wanted
(`docs/BUILD.md`).

## Source

| | |
| --- | --- |
| repository | `https://github.com/uli/huc.git` |
| commit | `52a556a0556abb67a12889ca7047366a8cb2f59e` |
| commit date | 2018-05-28 |
| version | PCEAS 3.23 (`52a556a`) |
| local checkout used | `/Volumes/External/pce-tools/pceas3-src` |
| sources compiled | `src/mkit/as/{main,input,assemble,expr,code,command,macro,func,proc,symbol,pcx,output,crc,pce,map,mml,nes}.c` |

The checkout is the same one `docs/BUILD.md` installs the native `pceas`
from.  The build defines `GIT_VERSION="52a556a"` and
`GIT_DATE="2018-05-28"`, so the wasm's banner is the native binary's banner.

The changes from the original MagicKit code are Ulrich Hecht's (2014 onward),
covered by the Simplified BSD terms below.  The only change this repository
makes is the compilation itself: no source file was edited for the wasm
build.  Emscripten's generated JavaScript runtime (`pceas.js`) is MIT
licensed; it is build output, not PCEAS source.

## Licence

`LICENSE` beside these files is the source tree's `LICENSE`, copied
unmodified (sha256 `294d72d68a971112abd91d7d37a87b18329e9cf52b997f0c864f940e21d3221f`).
Its statements about the parts this binary is built from, verbatim:

> The HuC software development kit is based on material from several sources,
> with the most important ones predating a general awareness of software
> licensing issues: both the C compiler and assembler are derived from
> code from the early 1980s.
>
> The authors that built on these foundations and extended them greatly in the
> late 1990s and early 2000s have also generally neglected to specify the
> conditions under which their versions can be used and redistributed.  It is
> therefore next to impossible to make an exact statement on the legal status
> of much of this collection of software, with the following exceptions:
>
> 1. The MagicKit assembler's source code contains the statement: "This
>    program is freeware.  You are free to distribute, use and modifiy it as
>    you wish."
> 2. The test suite emulator TGEmu is licensed under the GNU Public License.
> 3. Most test cases have been adapted from the GNU Compiler Collection and
>    are licensed under the GNU Public License.
>
> The following license text ("Simplified BSD License") applies to any changes
> and additions made by Ulrich Hecht:
>
> Copyright (c) 2014, Ulrich Hecht
> All rights reserved.
>
> Redistribution and use in source and binary forms, with or without
> modification, are permitted provided that the following conditions are met:
>
> 1. Redistributions of source code must retain the above copyright notice,
>    this list of conditions and the following disclaimer.
>
> 2. Redistributions in binary form must reproduce the above copyright notice,
>    this list of conditions and the following disclaimer in the documentation
>    and/or other materials provided with the distribution.
>
> THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
> AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
> IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
> ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
> LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
> CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
> SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
> INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
> CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
> ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
> POSSIBILITY OF SUCH DAMAGE.

The decision to bundle this build was the maintainer's, recorded on card
#224 in `docs/PLAN.md` (2026-11-02): "it's fine just use it, we are allowed
to do so".  The assembled ROMs carry no PCEAS code; this directory is a
build tool, exactly like the native binary on the drive.

## Rebuilding

From the repository root, with Emscripten installed:

```sh
tools/build-pceas-wasm.sh
```

The script reads `/Volumes/External/pce-tools/pceas3-src` (override with
`PCEAS_SRC=`), refuses a checkout that is not the pinned commit, compiles
into `$TMPDIR`, and installs `pceas.js` + `pceas.wasm` here.  It was last run
with:

```
emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 6.0.12-git
```

and the output was byte-identical across two runs:

```
aa28e8b9ee7a29271399495dd3dfe25827c1a91b6f2fb9a471ad5de8f1cfe1b9  pceas.js
9c97ccea0dd8a4d21cf8eed6295d7ff87656edac4f2741dd19f1cf5c38909675  pceas.wasm
```

(Different Emscripten versions may emit different glue or wasm bytes; the
assembled ROMs are what `tests/check-asm.js` holds to the native binary.)
