# Build

How to assemble a PC Engine ROM on this Mac, and how to check it in Mednafen.

## PCEAS

PCEAS (the MagicKit/HuC PC Engine assembler) is the PCE-native assembler the
working examples use. It is a **build tool, not part of PCEStudio**: per
[`DECISIONS.md`](DECISIONS.md) its licence is freeware with unclear provenance,
so its source and binary are not vendored in this repository.

**Installed here:** `pceas` 3.23 (`52a556a`, 2018-05-28) at
`/Volumes/External II/pce-tools/bin/pceas`, linked from `~/.local/bin/pceas`
(on `PATH`). Tools live on External II: the internal disk has no room.

### Installing it (reproducible)

The upstream repository has no releases, so build it from source outside the
project tree:

```sh
T="/Volumes/External II/pce-tools"; mkdir -p "$T/bin" && cd "$T"
git clone https://github.com/uli/huc.git huc-src
cd huc-src
git checkout 52a556a0556abb67a12889ca7047366a8cb2f59e
mkdir -p bin
make -C src/mkit/as \
  CFLAGS='-g -O2 -Dosx -DGIT_VERSION=\"52a556a\" -DGIT_DATE=\"2018-05-28\"'
install -m 755 bin/pceas "$T/bin/pceas"
ln -sf "$T/bin/pceas" "$HOME/.local/bin/pceas"
```

Two workarounds, both measured on this Mac (Darwin 25.3.0, Apple clang):

- Upstream's `src/Make_src.inc` adds `-Werror`; modern clang treats
  `if ((x == -1))` as an error (`-Wparentheses-equality`). Passing `CFLAGS=`
  on the command line overrides that list and drops `-Werror`.
- `defs.h` builds `PCE_ASM_VERSION` from `GIT_VERSION`/`GIT_DATE`, which
  upstream normally supplies through `git describe`. A shallow clone has no
  tags, and overriding `CFLAGS` removes those defines, so they are passed
  explicitly above.

Verify:

```sh
pceas            # prints: PC Engine Assembler (v 3.23-52a556a, 2018-05-28)
```

### The browser's bank 0 asset (#9)

The browser export copies the viewer's code bank rather than assembling 6280
code itself. After `make -C tools`, extract it from the PCEAS build:

```sh
make -C tools bank0   # writes renderer/viewer-bank0.bin (8 KiB, committed)
```

`tools/extract_bank0.py` reads bank 0 from all three viewer ROMs and refuses
unless they are identical. The export test fails if the asset is stale.

PCEAS also looks for include files in `PCE_INCLUDE`. `tools/hello.asm` needs
none, and neither does the #8 viewer: it is a **self-contained adaptation** of
HuDK (MIT, licence notice in the file) rather than an include of it, because
PCEAS 3.23 cannot assemble HuDK sources — they use `.define` and expect an
`-I` include path, neither of which this PCEAS has. See
[`ROM_LAYOUT.md`](ROM_LAYOUT.md) for what the viewer reads from where.

## Building the hello ROM

```sh
make -C tools          # runs: pceas -raw -o hello.pce hello.asm
```

`-raw` keeps PCEAS from prepending its own ROM header. The result is an 8 KiB
HuCard image, `tools/hello.pce`: reset and interrupt vectors at `$fff6-$ffff`,
code at `$e000`, VDC set to 256x224, palette 0 colour 0 set to red, the BAT
pointing at a cleared tile, then the background is enabled.

## Checking it in Mednafen

```sh
mednafen tools/hello.pce
```

## The browser export and its checks (#9)

```sh
node tests/check-export.js          # browser .pce == PCEAS .pce, all scenes
tools/capture.sh 1 browser          # run the browser-built ROM in Mednafen
node tests/check-viewer.js          # frame/state diff for viewer and browser ROMs
```

How the browser lays out the ROM, where its bank 0 comes from, and what the
evidence does and does not prove: [`EXPORT.md`](EXPORT.md).

The window title is `hello` and the screen is solid red. Press `F9` for an
unscaled 256x224 snapshot (saved in `~/.mednafen/snaps/`; outputs 256x232).
The snapshot used as evidence for #7 is [`hello-mednafen.png`](hello-mednafen.png):
every pixel is RGB `(252, 0, 0)`.
