#!/bin/bash
# build-hutrack.sh — assemble #35's HuTrack ROM
#
#   tools/build-hutrack.sh          # PCEAS4 defaults to pceas4
#   PCEAS4=/path/to/pceas tools/build-hutrack.sh
#
# HuTrack's engine needs PCEAS 4.x; the repo's external PCEAS is 3.23 and
# cannot assemble it (docs/BUILD.md, docs/HUTRACK.md).  The song — the DMF and
# the vendored converter's include files — is committed under
# tests/dumps/hutrack1/, so this needs no Python audio stack.
#
# PCEAS resolves includes against the current directory, and the vendored
# framework's own includes assume the example's `main/` + `../base_func`
# layout.  Hence the staging tree under tools/gen/hutrack/build/ (ignored).

set -euo pipefail
cd "$(dirname "$0")/.."

PCEAS4="${PCEAS4:-pceas4}"
BUILD="tools/gen/hutrack/build"
ROM="tools/gen/hutrack/hutrack-demo.pce"
SONG="tests/dumps/hutrack1/song"

if ! command -v "$PCEAS4" >/dev/null 2>&1 && [ ! -x "$PCEAS4" ]; then
  echo "PCEAS 4.x not found: set PCEAS4 or install pceas4 (docs/BUILD.md)" >&2
  exit 1
fi

rm -rf "$BUILD"
mkdir -p "$BUILD/main"
ln -s ../../../../vendor/hutrack/base_func "$BUILD/base_func"
ln -s ../../../../vendor/hutrack/lib "$BUILD/lib"
cp tools/hutrack.asm "$BUILD/main/hutrack.asm"
cp -R "$SONG" "$BUILD/main/song"

(cd "$BUILD/main" && PCE_INCLUDE=../lib "$PCEAS4" -raw -o ../../hutrack-demo.pce hutrack.asm)

echo "built $ROM ($(stat -f%z "$ROM") bytes, sha256 $(shasum -a 256 "$ROM" | cut -d' ' -f1))"
