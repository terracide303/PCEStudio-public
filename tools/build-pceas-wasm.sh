#!/bin/bash
# build-pceas-wasm.sh — rebuild vendor/pceas/{pceas.js,pceas.wasm} (card #224)
#
#   tools/build-pceas-wasm.sh
#
# PCEAS is the MagicKit-derived PC Engine assembler (uli/huc, v3.23).  This
# script compiles its C sources with Emscripten into the WebAssembly build
# renderer/pce-asm.js runs.  It never vendors the HuC C compiler, and it
# writes nothing inside the source tree.
#
# The source tree is external by design (docs/BUILD.md): the build is
# reproducible from the pinned commit below, not from a copy in this repo.
# Override with PCEAS_SRC=/path/to/pceas3-src, EMCC=/path/to/emcc.
#
# The version/date strings are the ones the native build in docs/BUILD.md
# carries, so the wasm's banner matches `pceas` and its output is the same
# bytes.  A different checkout is refused: the committed artefact's
# VENDORED.md names this commit.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

SRC="${PCEAS_SRC:-/Volumes/External/pce-tools/pceas3-src}"
EMCC="${EMCC:-/opt/homebrew/bin/emcc}"
PINNED_COMMIT="52a556a0556abb67a12889ca7047366a8cb2f59e"
VERSION="52a556a"
DATE="2018-05-28"
OUT="$ROOT/vendor/pceas"

if [ ! -f "$SRC/src/mkit/as/main.c" ]; then
  echo "no PCEAS source at $SRC (set PCEAS_SRC; see docs/BUILD.md)" >&2
  exit 2
fi
if [ ! -x "$EMCC" ]; then
  echo "no Emscripten compiler at $EMCC (set EMCC)" >&2
  exit 2
fi
COMMIT="$(git -C "$SRC" rev-parse HEAD)"
if [ "$COMMIT" != "$PINNED_COMMIT" ]; then
  echo "$SRC is at $COMMIT, not the pinned $PINNED_COMMIT" >&2
  echo "VENDORED.md pins the output to that commit; check it out first" >&2
  exit 2
fi
if [ -n "$(git -C "$SRC" status --porcelain --untracked-files=no)" ]; then
  echo "$SRC has tracked modifications; the committed artefact is built" >&2
  echo "from the pinned commit unchanged (VENDORED.md)" >&2
  exit 2
fi

AS="$SRC/src/mkit/as"
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/pceasm-wasm-XXXXXX")"
trap 'rm -rf "$SCRATCH"' EXIT
cd "$SCRATCH"

# Same object list as src/mkit/as/Makefile's PCEAS target.  atari/png/
# salvador are PCEAS 4.x only and are not in this tree.
"$EMCC" -O2 -DNDEBUG \
  -DGIT_VERSION="\"$VERSION\"" -DGIT_DATE="\"$DATE\"" -I"$AS" \
  "$AS/main.c" "$AS/input.c" "$AS/assemble.c" "$AS/expr.c" "$AS/code.c" \
  "$AS/command.c" "$AS/macro.c" "$AS/func.c" "$AS/proc.c" "$AS/symbol.c" \
  "$AS/pcx.c" "$AS/output.c" "$AS/crc.c" "$AS/pce.c" "$AS/map.c" \
  "$AS/mml.c" "$AS/nes.c" \
  -sMODULARIZE=1 -sEXPORT_NAME=createPceas \
  -sENVIRONMENT=node,web -sFORCE_FILESYSTEM=1 -sALLOW_MEMORY_GROWTH=1 \
  -sSTACK_SIZE=1048576 -sINVOKE_RUN=0 -sWASM_ASYNC_COMPILATION=0 \
  -sEXPORTED_FUNCTIONS=_main -sEXPORTED_RUNTIME_METHODS=callMain,FS \
  -o pceas.js

mkdir -p "$OUT"
install -m 644 pceas.js pceas.wasm "$OUT/"
printf 'built %s from %s\n' "$(cd "$OUT" && pwd)" "$COMMIT"
shasum -a 256 "$OUT/pceas.js" "$OUT/pceas.wasm"
