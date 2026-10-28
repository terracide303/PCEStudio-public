#!/bin/bash
# capture.sh — run one PCEStudio ROM in Mednafen and harvest the evidence
# card #5 (and #8) needs: the save state (VRAM + colour table dump) and an
# exact frame of what Mednafen displayed.
#
#   tools/capture.sh 1..9,11..14   # the #5/#39 scene ROMs (gen/sceneN.pce);
#                                  # 11-14 are #48's display-window scenes
#   tools/capture.sh 1|2|3 viewer   # the #8 viewer ROMs (gen/viewerN.pce)
#   tools/capture.sh 1|2|3 browser  # the #9 browser-built ROMs
#                                   # (gen/browserN.pce, from renderer/pce-rom.js)
#   tools/capture.sh 1|2|3 us       # the #25 US HuCard images
#                                   # (gen/usN.pce, bit-reversed browser ROM)
#   tools/capture.sh painted        # the #10 editor's picture
#                                   # (gen/painted.pce, built by
#                                   # tests/check-editor.js --write)
#   tools/capture.sh spainted       # the #13 editor's sprite scene
#                                   # (gen/spainted.pce, built by
#                                   # tests/check-editor.js --write sprite)
#   tools/capture.sh 1..11 vsprite  # the #14 viewer ROMs of the sprite scenes
#                                   # (gen/vspriteN.pce, SATB DMA in the viewer)
#   tools/capture.sh 1..12 sprite    # the #12 sprite-scene ROMs
#                                   # (gen/spriteN.pce; the dump gains sat.bin)
#   tools/capture.sh 1..3 dma        # #49: the VRAM-to-VRAM DMA ROMs
#                                   # (gen/dmaN.pce; the dump gains dma.json,
#                                   # the descriptor the ROM was built from)
#   tools/capture.sh 12 bsprite     # #42: the browser export of a sprite
#                                   # scene (gen/bsprite12.pce, written by
#                                   # tests/check-export.js --write sprite12)
#   tools/capture.sh 7 viewer       # #42: scene7's viewer ROM (gen/viewer7.pce)
#                                   # — its 128x64 BAT copy crosses $6000
#   tools/capture.sh 1..5 raster    # the #15 raster-scene ROMs
#                                   # (gen/rasterN.pce, per-scanline BXR/BYR/
#                                   # CR/VCE-colour-table writes; the dump
#                                   # gains raster.json, the ROM's table)
#   tools/capture.sh 1..10 vraster  # #16: the viewer ROMs of the raster
#                                   # scenes (gen/vrasterN.pce — the same
#                                   # tables, run by viewer.asm's irq1 chain;
#                                   # the dump gains raster.json)
#   tools/capture.sh effect         # #16: the editor's effect picture
#                                   # (gen/effect1.pce, built by
#                                   # tests/check-editor.js --write effect;
#                                   # the dump gains raster.json)
#   tools/capture.sh 336|512 wide   # #27: the wide-mode ROMs
#                                   # (gen/wide336.pce, gen/wide512.pce — the
#                                   # /3 and /2 dot clocks).  The capture is
#                                   # de-scaled to Mednafen's real output width
#                                   # for the picture's dot clock: 341 dots at
#                                   # /3, 512 at /2 (256 at /4, the other
#                                   # modes), read from the state's VCECR, not
#                                   # from the scene name.
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
# directory (tests/dumps/sceneN / viewerN / browserN / usN / painted /
# vrasterN / effect1); the route below is the same for all of them.
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
#   sat.bin        the SATB (sprite modes; #12)
#   raster.json    the raster table (raster mode; #15)

set -euo pipefail
cd "$(dirname "$0")/.."

SCENE="${1:?usage: capture.sh 1..9 [scene|viewer|browser|us|sprite|vsprite|raster|vraster] | capture.sh painted|spainted|effect}"
if [ "$SCENE" = painted ]; then
  MODE=painted
elif [ "$SCENE" = spainted ]; then
  MODE=spainted
elif [ "$SCENE" = effect ]; then
  MODE=effect
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
  sprite) NAME="sprite${SCENE}" ;;
  vsprite) NAME="vsprite${SCENE}" ;;
  bsprite) NAME="bsprite${SCENE}" ;;
  raster) NAME="raster${SCENE}" ;;
  vraster) NAME="vraster${SCENE}" ;;
  dma)    NAME="dma${SCENE}" ;;
  wide)   NAME="wide${SCENE}" ;;
  painted) NAME="painted" ;;
  spainted) NAME="spainted" ;;
  effect) NAME="effect1" ;;
  *) echo "mode must be scene, viewer, browser, bsprite, us, sprite, vsprite, raster, vraster, dma, wide, painted, spainted or effect" >&2; exit 2 ;;
esac
DUMPDIR="tests/dumps/${NAME}"
TOOLS="$(pwd)/tools"
SCRATCH="/Volumes/External II/scratch"
MCSDIR="$HOME/.mednafen/mcs"
# Log scratch under $TMPDIR (never a hard-coded /tmp: the system disk on some
# machines is nearly full).
LOGDIR="${TMPDIR:-/tmp}"

mkdir -p "$DUMPDIR" "$SCRATCH"

echo "== build $NAME"
if [ "$MODE" = browser ]; then
  # the browser path's own builder, not PCEAS (cards #9)
  node tests/check-export.js --write "$SCENE"
elif [ "$MODE" = bsprite ]; then
  # #42: the browser export of a sprite scene, run in Mednafen — REVIEW-14's
  # J1-J3 gap (the browser ROM carries the SAT but was never run on one)
  node tests/check-export.js --write "sprite${SCENE}"
elif [ "$MODE" = us ]; then
  # the browser's US image: its .pce with every byte's bits reversed (#25)
  node tests/check-us-card.js --write "$SCENE"
elif [ "$MODE" = painted ]; then
  # #10: the editor's picture, exported by #9's builder
  node tests/check-editor.js --write
elif [ "$MODE" = spainted ]; then
  # #13: the editor's sprite scene, exported by #9's builder
  node tests/check-editor.js --write sprite
elif [ "$MODE" = effect ]; then
  # #16: the editor's effect picture (gradient + wobble + parallax bands at
  # frame 5), exported through the viewer with its raster table
  node tests/check-editor.js --write effect
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
    -autosave 1 "tools/gen/$NAME.pce" > "$LOGDIR/mdfn-$NAME.log" 2>&1 &

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
  RASTER_ARG=""
  if [ "$MODE" = raster ] || [ "$MODE" = vraster ] || [ "$MODE" = effect ]; then
    RASTER_ARG="--raster"
  fi
  if ! python3 -I "$TOOLS/mcs-extract.py" "$new_mcs" "$DUMPDIR" "$SLSTART" $RASTER_ARG; then
    # 3 = the state was saved during pre-VDW blanking (rerun); anything
    # else is a hard failure
    [ "$?" -eq 3 ] && return 3 || return 4
  fi
  if [ "$MODE" = raster ] || [ "$MODE" = vraster ] || [ "$MODE" = effect ]; then
    # the renderer's raster table: the ROM's per-scanline writes, written
    # by genroms.py alongside the asm (the #15 scenes), copied through
    # genviewer.py (the #16 viewers), or emitted by the editor's builder —
    # then folded with the ROM's runtime state (r4's frame counter, from
    # the save's HuC6280 RAM) and checked against the state by the tests
    cp "tools/gen/$NAME.raster.json" "$DUMPDIR/raster.json"
    PATCH_SCENE="$SCENE"
    if [ "$MODE" = vraster ]; then PATCH_SCENE="${SCENE}v"; fi
    if [ "$MODE" = effect ]; then PATCH_SCENE="effect1"; fi
    if ! python3 -I "$TOOLS/raster-patch.py" "$DUMPDIR" "$PATCH_SCENE"; then
      echo "raster-patch failed"; return 4
    fi
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
  # #27: the frame's width is the VCE dot clock's.  With pce.h_overscan 0
  # (mednafen's default; this script does not set it) the core outputs 256
  # dots at /4, 341 at /3 and 512 at /2, and QTRecord's DecodeLine scales
  # each source pixel by lcm_width/src_width = 1024/width, so the de-scale
  # step is that same integer.  Read from the saved VCE CR, so the crop
  # follows the picture rather than the scene's name.
  CROP=$(python3 -I - "$DUMPDIR/regs.json" <<'PYEOF'
import json, sys
cr = json.load(open(sys.argv[1])).get("VCECR", 0)
width = (256, 341, 512)[2 if cr & 2 else (cr & 1)]
print(width, 1024 // width)
PYEOF
)
  read -r CROPW CROPSTEP <<< "$CROP"
  python3 -I "$TOOLS/movframes.py" "$MOV" "$DUMPDIR/mednafen.png" \
    "$CROPW" 232 "$CROPSTEP"
  cp "$LOGDIR/mdfn-$NAME.log" "$DUMPDIR/mednafen.log"
  if [ "$MODE" = dma ]; then
    # #49: the transfer descriptor the ROM was generated from, kept beside the
    # capture so the check reads the same registers the ROM wrote.
    cp "tools/gen/$NAME.json" "$DUMPDIR/dma.json"
  fi
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
