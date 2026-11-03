#!/bin/bash
# capture-card.sh — run the first assembly example on Mednafen and harvest
# card #231's console evidence.
#
#   tools/capture-card.sh
#
# The ROM is built by tools/build-card.js from examples/asm-first (the same
# renderer/pce-asm.js + renderer/pce-card.js the studio's Export uses), then
# run with the repo's usual command-line capture route:
#
#   - Mednafen records with -qtrecord ... -qtrecord.vcodec png and is stopped
#     with SIGINT; -autosave writes the .mca state, mcs-extract.py reads it.
#   - SLSTART=3, SLEND=234: captured row 0 is VCE line 17, which is VDW line 0
#     for the 256x240 window this example writes (VPR=$0F02, VDS+VSW=17), so
#     the example's picture is in the dump without a vertical shift.
#   - movframes.py writes the last recorded frame, 256x232, as mednafen.png.
#
# Produces tests/dumps/asm-first/: vram.bin, cram.bin, sat.bin, regs.json,
# ram.bin, mednafen.png, mednafen.log and meta.json (the ROM's sha256 and
# size, the build command, and the picture the program states it draws).
# tests/check-card.js compares the picture with that statement.
#
# No keyboard or mouse events are sent: the only input is the process's own
# SIGINT, and Mednafen's command line.
set -euo pipefail
cd "$(dirname "$0")/.."

NAME=asm-first
PROJECT=examples/asm-first
ROM="tools/gen/$NAME.pce"
DUMPDIR="tests/dumps/$NAME"
SCRATCH="${TMPDIR:-/tmp}"
VIDEO_DRIVER="${VIDEO_DRIVER:-sdl}"
MEDNAFEN_HOME="$SCRATCH/mdfn-home-$NAME"
export MEDNAFEN_HOME
MCSDIR="$MEDNAFEN_HOME/mcs"
LOGDIR="${TMPDIR:-/tmp}"
SLSTART=3
SLEND=234
MOV="$SCRATCH/$NAME.mov"

node tools/build-card.js "$PROJECT" "$ROM"

# This seat must not signal another seat's Mednafen; refuse to run beside one.
if pgrep -x mednafen >/dev/null 2>&1; then
  echo "a mednafen is already running; captures must not contend" >&2
  exit 1
fi

mkdir -p "$DUMPDIR" "$MCSDIR"
rm -f "$MOV"
START=$(date +%s)
echo "== launch mednafen ($NAME)"
mednafen -force_module pce -video.driver "$VIDEO_DRIVER" \
  -pce.slstart "$SLSTART" -pce.slend "$SLEND" \
  -pce.xscale 1 -pce.yscale 1 \
  -qtrecord "$MOV" -qtrecord.vcodec png \
  -qtrecord.w_double_threshold 0 -qtrecord.h_double_threshold 0 \
  -autosave 1 "$ROM" > "$LOGDIR/mdfn-$NAME.log" 2>&1 &
MDPID=$!

echo "== let the OSD messages fade and the program run"
sleep "${SLEEP:-8}"

echo "== clean exit (SIGINT -> CloseGame -> autosave)"
kill -INT "$MDPID" 2>/dev/null || true
for i in $(seq 1 30); do
  kill -0 "$MDPID" 2>/dev/null || break
  sleep 1
done
kill -9 "$MDPID" 2>/dev/null || true

new_mcs=""
for i in $(seq 1 10); do
  new_mcs=$(ls -t "$MCSDIR"/"$NAME".*.mca 2>/dev/null | head -1 || true)
  if [ -n "$new_mcs" ] && [ "$(stat -f%m "$new_mcs")" -ge "$START" ]; then
    break
  fi
  new_mcs=""
  sleep 1
done
if [ -z "$new_mcs" ]; then
  echo "no autosave state for this run ($NAME) in $MCSDIR" >&2
  exit 1
fi
if [ ! -s "$MOV" ]; then
  echo "no movie recorded" >&2
  exit 1
fi
echo "state: $new_mcs"
echo "movie: $MOV ($(stat -f%z "$MOV") bytes)"

python3 -I tools/mcs-extract.py "$new_mcs" "$DUMPDIR" "$SLSTART" --ram
# Record the crop this dump was captured with: the renderer's vertical
# calibration is firstScanline = 14 + slstart (captured row 0's VCE line).
python3 -I - "$DUMPDIR/regs.json" "$SLSTART" "$SLEND" <<'PYEOF'
import json, sys
regs = json.load(open(sys.argv[1]))
regs["slstart"] = int(sys.argv[2])
regs["slend"] = int(sys.argv[3])
json.dump(regs, open(sys.argv[1], "w"), indent=1, sort_keys=True)
PYEOF
python3 -I tools/movframes.py "$MOV" "$DUMPDIR/mednafen.png" 256 232 4
cp "$LOGDIR/mdfn-$NAME.log" "$DUMPDIR/mednafen.log"

node - "$ROM" "$DUMPDIR/meta.json" <<'NODE'
const fs = require("fs");
const crypto = require("crypto");
const [, , romPath, metaPath] = process.argv;
const bytes = fs.readFileSync(romPath);
const sha = crypto.createHash("sha256").update(bytes).digest("hex");
const meta = {
  name: "asm-first",
  card: 231,
  source: "examples/asm-first/main.asm",
  build: "node tools/build-card.js examples/asm-first tools/gen/asm-first.pce",
  rom: { size: bytes.length, sha256: sha, banks: bytes.length / 8192 },
  capture: { slstart: 3, slend: 234, width: 256, height: 232, rows: "VDW line 0 at row 0" },
  expected: {
    description: "256x232; every pixel colour $000 = $007 RGB(0,0,252), " +
                 "except x 32..39, y 32..39 = colour 1 = $1F8 RGB(252,252,0)",
    backdrop: "$007", block: "$1F8", x0: 32, y0: 32, x1: 40, y1: 40
  }
};
fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
console.log("rom sha256 " + sha + " (" + bytes.length + " B)");
NODE
