#!/bin/bash
# build-mednafen-instrument.sh — build the Mednafen that can start an input
# movie from the command line (card #45).
#
#   tools/build-mednafen-instrument.sh [SRC] [DEST]
#
# SRC   a Mednafen 1.32.1 source tree (default
#       /Volumes/External II/pce-tools/mednafen)
# DEST  where to build the instrumented copy (default $TMPDIR/pce-mednafen)
#
# The source tree may carry another seat's local instrumentation (the VDC
# trace that costs a syscall per register write); this copies it to DEST,
# turns that trace into a no-op, applies tools/mednafen-loadmovie.py and builds
# incrementally.  Nothing is changed in SRC.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="${1:-/Volumes/External II/pce-tools/mednafen}"
DEST="${2:-${TMPDIR:-/tmp}/pce-mednafen}"

if [ ! -f "$SRC/src/drivers/main.cpp" ]; then
  echo "no Mednafen 1.32.1 source at $SRC" >&2
  exit 2
fi

rm -rf "$DEST"
cp -a "$SRC" "$DEST"
python3 -I tools/mednafen-loadmovie.py "$DEST"

# The VDC trace writes to stdout, stderr and a file on every register write,
# which makes a boot slower than real time.  This is our copy: silence it.
python3 -I - "$DEST" <<'PY'
import re
import sys
path = sys.argv[1] + "/src/hw_video/huc6270/vdc.cpp"
text = open(path).read()
m = re.search(r"static void vdctrace\(const char \*fmt, \.\.\.\)\n\{.*?\n\}\n", text, re.S)
if not m:
    print("vdctrace not found; the trace is already off")
else:
    text = text[:m.start()] + (
        "/* PCEStudio #45: the trace is off in this copy.  It is an\n"
        " * instrument for the VDC timing cards, and its per-write\n"
        " * open/write/close makes the boot slower than real time. */\n"
        "static void vdctrace(const char *fmt, ...)\n{\n (void)fmt;\n}\n"
    ) + text[m.end():]
    open(path, "w").write(text)
    print("trace silenced")
PY

make -C "$DEST/src" -j"$(sysctl -n hw.ncpu 2>/dev/null || echo 4)" \
     > "$DEST/build.log" 2>&1
if [ ! -x "$DEST/src/mednafen" ]; then
  echo "build failed; see $DEST/build.log" >&2
  exit 1
fi
echo "instrumented Mednafen: $DEST/src/mednafen"
"$DEST/src/mednafen" -help 2>&1 | grep -c loadmovie || true
