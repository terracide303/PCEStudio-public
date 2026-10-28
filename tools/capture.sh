#!/bin/bash
# capture.sh — run one PCEStudio ROM in Mednafen and harvest the evidence
# card #5 (and #8) needs: the save state (VRAM + colour table dump) and an
# exact frame of what Mednafen displayed.
#
#   tools/capture.sh 1..9          # the #5/#39 scene ROMs (gen/sceneN.pce)
#   tools/capture.sh 1|2|3 viewer   # the #8 viewer ROMs (gen/viewerN.pce)
#   tools/capture.sh 1|2|3 browser  # the #9 browser-built ROMs
#                                   # (gen/browserN.pce, from renderer/pce-rom.js)
#   tools/capture.sh 1|2|3 us       # the #25 US HuCard images
#                                   # (gen/usN.pce, bit-reversed browser ROM)
#   tools/capture.sh painted        # the #10 editor's picture
#                                   # (gen/painted.pce, built by
#                                   # tests/check-editor.js --write)
#
# Scenes 4-9, 8b, 8c are #39's (docs/REVIEW.md finding 1: each is NOT
# periodic in the dimension a renderer break would cut — see genroms.py).
# SLEEP=<seconds> overrides the settle delay (default 9).  SLSTART/SLEND
# override the crop (default 4/235): #39 captures scene5b with SLSTART=6
# SLEND=237 — the same 232-row window shifted two lines down, so captured
# row 0 is VCE line 20 and vdwLine0 = RCRCount - (scanline - 20) = 3, which
# makes the vdw1 renderer break visible (the sleep time cannot change the
# save scanline: measured 254 for sleeps 8.5..9.5s).  The crop is recorded
# in regs.json and the renderer reads it as firstScanline = 14 + slstart.
#
# The modes differ only in the ROM that is built and run and in the dump
# directory (tests/dumps/sceneN / viewerN / browserN / usN / painted); the
# route below is the same for all of them.
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

SCENE="${1:?usage: capture.sh 1..9 [scene|viewer|browser|us] | capture.sh painted}"
if [ "$SCENE" = painted ]; then
  MODE=painted
else
  MODE="${2:-scene}"
fi
SLSTART="${SLSTART:-4}"
SLEND="${SLEND:-235}"
case "$MODE" in
  scene)  NAME="scene${SCENE}" ;;
  viewer) NAME="viewer${SCENE}" ;;
  browser) NAME="browser${SCENE}" ;;
  us) NAME="us${SCENE}" ;;
  painted) NAME="painted" ;;
  *) echo "mode must be scene, viewer, browser, us or painted" >&2; exit 2 ;;
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
elif [ "$MODE" = us ]; then
  # the browser's US image: its .pce with every byte's bits reversed (#25)
  node tests/check-us-card.js --write "$SCENE"
elif [ "$MODE" = painted ]; then
  # #10: the editor's picture, exported by #9's builder
  node tests/check-editor.js --write
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
  mednafen -force_module pce -pce.slstart "$SLSTART" -pce.slend "$SLEND" \
    -pce.xscale 1 -pce.yscale 1 \
    -qtrecord "$MOV" -qtrecord.vcodec png \
    -qtrecord.w_double_threshold 0 -qtrecord.h_double_threshold 0 \
    -autosave 1 "tools/gen/$NAME.pce" > "/tmp/mdfn-$NAME.log" 2>&1 &

  echo "== let the OSD messages fade and the picture settle"
  sleep "${SLEEP:-9}"

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
  if ! python3 -I "$TOOLS/mcs-extract.py" "$new_mcs" "$DUMPDIR" "$SLSTART"; then
    return 3
  fi
  # Record the crop this dump was captured with: the renderer's vertical
  # calibration is firstScanline = 14 + slstart (captured row 0's VCE line).
  python3 -I - "$DUMPDIR/regs.json" "$SLSTART" "$SLEND" <<'PYEOF'
import json, sys
regs = json.load(open(sys.argv[1]))
regs["slstart"] = int(sys.argv[2])
regs["slend"] = int(sys.argv[3])
json.dump(regs, open(sys.argv[1], "w"), indent=1, sort_keys=True)
PYEOF
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
