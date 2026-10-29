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

`tools/extract_bank0.py` reads bank 0 from every viewer ROM (viewer1-3 and
#14's vsprite1-11) and refuses unless they are identical. The export test
fails if the asset is stale.

PCEAS also looks for include files in `PCE_INCLUDE`. `tools/hello.asm` needs
none, and neither does the #8 viewer: it is a **self-contained adaptation** of
HuDK (MIT, licence notice in the file) rather than an include of it, because
PCEAS 3.23 cannot assemble HuDK sources — they use `.define` and expect an
`-I` include path, neither of which this PCEAS has. See
[`ROM_LAYOUT.md`](ROM_LAYOUT.md) for what the viewer reads from where.

### PCEAS 4.x for HuTrack (#35)

HuTrack's engine does not assemble with 3.23 (dotted labels starting with a
digit, and macro `.if` expressions over `<label`; see
[`HUTRACK.md`](HUTRACK.md)). `vendor/huc` is HuC mainline and its
`src/mkit/as` builds a 4.x PCEAS. Build it outside the repo, as with the 3.23
tool:

```sh
T="/Volumes/External II/pce-tools"
cp -R "/Volumes/External II/agent-workshop-demo/PCEStudio/vendor/huc" "$T/huc4-src"
mkdir -p "$T/huc4-src/bin"      # the assembler Makefile copies its targets here
make -C "$T/huc4-src/src/mkit/as" -j4
ln -sf "$T/huc4-src/bin/pceas" "$HOME/.local/bin/pceas4"
pceas4     # prints: PC Engine Assembler (, ) — this tree has no git date
```

`tools/build-hutrack.sh` and `tools/capture-hutrack.sh` take `PCEAS4`
(default `pceas4`), so the space-free symlink is only a convenience.

### HuC's C compiler for #31 part B

The HuC route needs the C compiler, not just the assembler. Build the same
vendored tree's compiler (external, never run from inside the repo):

```sh
T="/Volumes/External II/pce-tools"
cp -R "/Volumes/External II/agent-workshop-demo/PCEStudio/vendor/huc" "$T/huc-toyc"
mkdir -p "$T/huc-toyc/bin"             # the compiler Makefile copies its target here
make -C "$T/huc-toyc/src/huc" -j4      # produces bin/huc
```

The PCEAS the HuC build uses is the same tree's `src/mkit/as` (the 4.x one
above), not a new download; `huc-toyc/bin` here was populated with it.

`tools/build-huc.sh` takes `HUC_DIR` (default
`/Volumes/External II/pce-tools/huc-toyc`) and expects `bin/huc` and
`bin/pceas` there. `tests/check-il-huc.js` prints SKIP for its ROM-rebuild
checks when the compiler is absent, and still checks the committed dumps.

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

## The browser export and its checks (#9, #14)

```sh
node tests/check-export.js          # browser .pce == PCEAS .pce, all scenes
tools/capture.sh 1 browser          # run the browser-built ROM in Mednafen
tools/capture.sh 1..11 vsprite      # run the #14 sprite viewer ROMs (SATB DMA)
node tests/check-viewer.js          # frame/state diff for viewer/browser/vsprite ROMs
```

How the browser lays out the ROM, where its bank 0 comes from, and what the
evidence does and does not prove: [`EXPORT.md`](EXPORT.md).

The window title is `hello` and the screen is solid red. Press `F9` for an
unscaled 256x224 snapshot (saved in `~/.mednafen/snaps/`; outputs 256x232).
The snapshot used as evidence for #7 is [`hello-mednafen.png`](hello-mednafen.png):
every pixel is RGB `(252, 0, 0)`.
