#!/bin/bash
# capture.sh — run one PCEStudio ROM in Mednafen and harvest the evidence
# card #5 (and #8) needs: the save state (VRAM + colour table dump) and an
# exact frame of what Mednafen displayed.
#
#   tools/capture.sh 1|2|3          # the #5 scene ROMs (gen/sceneN.pce)
#   tools/capture.sh 1|2|3 viewer   # the #8 viewer ROMs (gen/viewerN.pce)
#   tools/capture.sh 1|2|3 browser  # the #9 browser-built ROMs
#                                   # (gen/browserN.pce, from renderer/pce-rom.js)
#
# The modes differ only in the ROM that is built and run and in the dump
# directory (tests/dumps/sceneN / viewerN / browserN); the route below is the
# same for all three.
#
# Route (command line only — this Mac's user must never receive synthesized
# keyboard/mouse events, so there is no F9 hotkey here):
#   - Mednafen records the video with `-qtrecord <file>.mov -qtrecord.vcodec png`:
#     every frame is stored as one complete PNG image, taken from the same raw
#     unfiltered surface the F9 snapshot reads (mednafen-1.32.1
#     src/mednafen.cpp:2047 -> QTRecord::WriteFrame, src/qtrecord.cpp).
#   - The PCE core's lcm_width is 1024 and QTRecord scales each source pixel
#     x4 across the frame, so frames are de-scaled to 256x232 (every 4th
#     column, source: DecodeLine in qtrecord.cpp).
#   - A clean exit is requested with SIGINT (the only key-free way to reach
#     CloseGame()); `-autosave 1` then writes the state, which is extracted
#     with mcs-extract.py.
#
# Produces tests/dumps/<name>/:
#   vram.bin       VDC VRAM from the autosave state (mcs-extract.py)
#   cram.bin       VCE colour table from the same state
#   regs.json      registers + scanline calibration values
#   mednafen.png   last recorded frame (256x232 RGB, raw, unfiltered)
#   mednafen.log   the run's stdout

set -euo pipefail
cd "$(dirname "$0")/.."

SCENE="${1:?usage: capture.sh 1|2|3 [scene|viewer|browser]}"
MODE="${2:-scene}"
case "$MODE" in
  scene)  NAME="scene${SCENE}" ;;
  viewer) NAME="viewer${SCENE}" ;;
  browser) NAME="browser${SCENE}" ;;
  *) echo "mode must be scene, viewer or browser" >&2; exit 2 ;;
esac
DUMPDIR="tests/dumps/${NAME}"
TOOLS="$(pwd)/tools"
SCRATCH="/Volumes/External II/scratch"
MCSDIR="$HOME/.mednafen/mcs"

mkdir -p "$DUMPDIR" "$SCRATCH"

echo "== build $NAME"
if [ "$MODE" = browser ]; then
  # the browser path's own builder, not PCEAS (cards #9)
  node tests/check-export.js --write "$SCENE"
else
  make -C tools "gen/$NAME.pce"
fi

pkill -x mednafen 2>/dev/null || true
sleep 1

# One mednafen run + harvest.  Returns 3 if the state was saved during
# pre-VDW blanking (scanline calibration unusable — rerun), 0 on success,
# anything else = hard failure (set -e exits).
run_once() {
  MOV="$SCRATCH/$NAME.mov"
  rm -f "$MOV"

  echo "== launch mednafen ($NAME)"
  mednafen -force_module pce -pce.slstart 4 -pce.slend 235 \
    -pce.xscale 1 -pce.yscale 1 \
    -qtrecord "$MOV" -qtrecord.vcodec png \
    -qtrecord.w_double_threshold 0 -qtrecord.h_double_threshold 0 \
    -autosave 1 "tools/gen/$NAME.pce" > "/tmp/mdfn-$NAME.log" 2>&1 &

  echo "== let the OSD messages fade and the picture settle"
  sleep 9

  echo "== clean exit (SIGINT -> CloseGame -> autosave)"
  pkill -INT -x mednafen
  for i in $(seq 1 15); do
    pgrep -x mednafen >/dev/null || break
    sleep 1
  done
  pkill -9 -x mednafen 2>/dev/null || true

  new_mcs=$(ls -t "$MCSDIR"/"$NAME".*.mca 2>/dev/null | head -1 || true)
  if [ -z "$new_mcs" ]; then
    echo "no autosave state for $NAME in $MCSDIR"; exit 1
  fi
  echo "state: $new_mcs"

  if [ ! -s "$MOV" ]; then
    echo "no movie recorded"; exit 1
  fi
  echo "movie: $MOV ($(stat -f%z "$MOV") bytes)"

  echo "== extract"
  if ! python3 -I "$TOOLS/mcs-extract.py" "$new_mcs" "$DUMPDIR"; then
    return 3
  fi
  python3 -I "$TOOLS/movframes.py" "$MOV" "$DUMPDIR/mednafen.png" 256 232 4
  cp "/tmp/mdfn-$NAME.log" "$DUMPDIR/mednafen.log"
  if [ -z "${KEEP_MOV:-}" ]; then rm -f "$MOV"; fi
  echo "== done: $DUMPDIR"
  ls -la "$DUMPDIR"
}

for attempt in 1 2 3; do
  rc=0
  run_once || rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "== captured $NAME on attempt $attempt"
    exit 0
  fi
  if [ "$rc" -ne 3 ]; then
    echo "capture failed ($rc)"
    exit "$rc"
  fi
  echo "== attempt $attempt: state saved during pre-VDW blanking — rerunning"
done
echo "gave up after 3 attempts"
exit 1
