#!/bin/bash
# build-hutrack.sh — assemble #35's HuTrack ROM
#
#   tools/build-hutrack.sh          # PCEAS4 defaults to pceas4
#   PCEAS4=/path/to/pceas tools/build-hutrack.sh
#
# The song and the output paths can be overridden, which is how #35's export
# test builds the second song with PCEAS (the ground truth the JS export is
# compared against):
#
#   SONG=tests/dumps/hutrack2/song BUILD=tools/gen/hutrack/build2 \
#     ROM=tools/gen/hutrack/hutrack-demo2.pce tools/build-hutrack.sh
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
BUILD="${BUILD:-tools/gen/hutrack/build}"
ROM="${ROM:-tools/gen/hutrack/hutrack-demo.pce}"
SONG="${SONG:-tests/dumps/hutrack1/song}"

if ! command -v "$PCEAS4" >/dev/null 2>&1 && [ ! -x "$PCEAS4" ]; then
  echo "PCEAS 4.x not found: set PCEAS4 or install pceas4 (docs/BUILD.md)" >&2
  exit 1
fi

# Exactly one converter output set, or the ROM would silently carry one
# song's data with another's includes.
SONGS=( "$SONG"/*.song.inc )
if [ "${#SONGS[@]}" -ne 1 ] || [ ! -f "${SONGS[0]}" ]; then
  echo "$SONG: expected exactly one *.song.inc from the converter" >&2
  exit 1
fi
SONG_INC="$(basename "${SONGS[0]}")"

rm -rf "$BUILD"
mkdir -p "$BUILD/main"
# Absolute links: the staging tree may live outside the repo (the export test
# builds into a temporary directory).
ln -s "$(pwd)/vendor/hutrack/base_func" "$BUILD/base_func"
ln -s "$(pwd)/vendor/hutrack/lib" "$BUILD/lib"
cp tools/hutrack.asm "$BUILD/main/hutrack.asm"
cp -R "$SONG" "$BUILD/main/song"
printf '  .include "song/%s"\n' "$SONG_INC" > "$BUILD/main/song/song.inc"

# Assemble beside the sources, then move: PCEAS is given a relative -o and the
# two songs' builds must not collide on one fixed name.
(cd "$BUILD/main" && PCE_INCLUDE=../lib "$PCEAS4" -raw -o hutrack.bin hutrack.asm)
mkdir -p "$(dirname "$ROM")"
mv "$BUILD/main/hutrack.bin" "$ROM"

echo "built $ROM ($(stat -f%z "$ROM") bytes, sha256 $(shasum -a 256 "$ROM" | cut -d' ' -f1))"
