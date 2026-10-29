#!/bin/bash
# capture-ilvm.sh — run a toy as IL bytecode on the committed interpreter in
# Mednafen and harvest the #100 evidence.
#
#   tools/capture-ilvm.sh [name] [toy.lua]
#
# Defaults: name=toypalette-ilvm, toy=tools/toys/palette.lua.
#
# The build is tools/ilvm/emit.js: renderer/pce-il.js -> renderer/pce-ilbc.js
# -> renderer/pce-rom.js's buildToyRom().  NO compiler is called.  The run,
# crop, frame extraction and timer read are tools/capture-toy.sh's route (the
# same Mednafen command line, the same mcs-extract --ram), so the figures are
# comparable with #31's llvm-mos and HuC numbers.
#
# Produces tests/dumps/<name>/: vram.bin, cram.bin, sat.bin, regs.json,
# ram.bin, mednafen.png, frames/frameNNNN.png, mednafen.log and meta.json
# (the ROM sha/size, the bytecode size and the measured TMA timer figures).
set -euo pipefail
cd "$(dirname "$0")/.."

NAME="${1:-toypalette-ilvm}"
TOY="${2:-tools/toys/palette.lua}"
DUMPDIR="tests/dumps/$NAME"
SCRATCH="${TMPDIR:-/tmp}"
# Seats share this account: keep this run's save states and config out of
# ~/.mednafen/mcs, which another seat may clear (and whose Mednafen this
# script must never signal — it signals only the process it starts).
MEDNAFEN_HOME="$SCRATCH/mdfn-home-$NAME"
export MEDNAFEN_HOME
MCSDIR="$MEDNAFEN_HOME/mcs"
LOGDIR="${TMPDIR:-/tmp}"
SLSTART=3
SLEND=234
MOV="$SCRATCH/$NAME.mov"
ROM="tools/gen/$NAME.pce"

node tools/ilvm/emit.js "$TOY" "$ROM" "$NAME"

mkdir -p "$DUMPDIR" "$MCSDIR"
rm -rf "$DUMPDIR/frames"

rm -f "$MOV"
START=$(date +%s)
echo "== launch mednafen ($NAME)"
mednafen -force_module pce -pce.slstart "$SLSTART" -pce.slend "$SLEND" \
  -pce.xscale 1 -pce.yscale 1 \
  -qtrecord "$MOV" -qtrecord.vcodec png \
  -qtrecord.w_double_threshold 0 -qtrecord.h_double_threshold 0 \
  -autosave 1 "$ROM" > "$LOGDIR/mdfn-$NAME.log" 2>&1 &
MDPID=$!

echo "== let the OSD messages fade and the toy run"
sleep "${SLEEP:-9}"

echo "== clean exit (SIGINT -> CloseGame -> autosave)"
# Only this run's Mednafen: another seat runs one from the same account.
kill -INT "$MDPID" 2>/dev/null || true
for i in $(seq 1 30); do
  kill -0 "$MDPID" 2>/dev/null || break
  sleep 1
done
kill -9 "$MDPID" 2>/dev/null || true

# ilvm: under load Mednafen can be SIGKILLed before it flushes the state; a
# save older than this run is not evidence.  Wait for one, then refuse.
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
python3 -I tools/movframes.py "$MOV" "$DUMPDIR/mednafen.png" 256 232 4
python3 -I tools/movframes.py "$MOV" --all "$DUMPDIR/frames" 256 224 4
# ilvm: a slow interpreted toy can record thousands of frames, most of them
# the static compute period.  TRIM_FRAMES keeps the tail (the display frames
# near the save) so the committed dump stays small; the check scans the tail.
if [ -n "${TRIM_FRAMES:-}" ]; then
  n=$(ls "$DUMPDIR/frames"/frame*.png | wc -l | tr -d ' ')
  if [ "$n" -gt "$TRIM_FRAMES" ]; then
    # A bash array, not `ls | head`: under `set -o pipefail` the SIGPIPE from
    # head aborted the script before meta.json was rewritten, leaving a
    # recaptured dump beside the old measurement (found re-running #100's
    # evidence with TRIM_FRAMES set).
    frames=( "$DUMPDIR"/frames/frame*.png )
    for ((i = 0; i < ${#frames[@]} - TRIM_FRAMES; i++)); do
      rm -f "${frames[i]}"
    done
  fi
fi
cp "$LOGDIR/mdfn-$NAME.log" "$DUMPDIR/mednafen.log"

python3 -I - "$DUMPDIR" "tools/gen/$NAME.json" "$SLSTART" "$SLEND" <<'PY'
import json
import os
import struct
import sys

dumpdir, build_json, slstart, slend = sys.argv[1:5]
meta = json.load(open(build_json))

ram = open(os.path.join(dumpdir, "ram.bin"), "rb").read()
sum_ticks = struct.unpack_from("<I", ram, 0x100)[0]
count = struct.unpack_from("<H", ram, 0x104)[0]
raster_sum = struct.unpack_from("<I", ram, 0x108)[0]
raster_count = struct.unpack_from("<H", ram, 0x10C)[0]
collect_sum = struct.unpack_from("<I", ram, 0x110)[0]
collect_count = struct.unpack_from("<H", ram, 0x114)[0]
meas = {
    "count": count,
    "sum_ticks": sum_ticks,
    "min_ticks": ram[0x107],
    "max_ticks": ram[0x106],
    "mean_ticks": (sum_ticks / count) if count else None,
    "cycles_per_frame": (sum_ticks / count * 1024) if count else None,
    "raster_calls": raster_count,
    "raster_sum_ticks": raster_sum,
    "cycles_per_raster_call": (raster_sum / raster_count * 1024)
                              if raster_count else None,
    "raster_max_ticks": ram[0x10E],
    "collections": collect_count,
    "collect_sum_ticks_7bit": collect_sum,
    "cycles_per_collection": (raster_sum / collect_count * 1024)
                             if collect_count else None,
    "flags": ram[0x10F],
}
frames = sorted(os.listdir(os.path.join(dumpdir, "frames")))
meta["capture"] = {
    "slstart": int(slstart),
    "slend": int(slend),
    "frames": len(frames),
    "last_frame": frames[-1] if frames else None,
    "measure": meas,
}
with open(os.path.join(dumpdir, "meta.json"), "w") as fh:
    json.dump(meta, fh, indent=1, sort_keys=True)
print("frames: %d; timer: %d frames, mean %.3f ticks = %.1f cycles/frame"
      % (len(frames), count, meas["mean_ticks"] or 0,
         meas["cycles_per_frame"] or 0))
print("raster: %d calls, %.1f cycles/call, %d collections"
      % (raster_count, meas["cycles_per_raster_call"] or 0, collect_count))
PY

if [ -z "${KEEP_MOV:-}" ]; then rm -f "$MOV"; fi
echo "== done: $DUMPDIR"
