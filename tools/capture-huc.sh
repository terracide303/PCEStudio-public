#!/bin/bash
# capture-huc.sh — run a HuC-built toy in Mednafen and harvest the #31 part B
# evidence: the save state, every video frame, and the build report.
#
#   tools/capture-huc.sh [name] [toy.lua]
#
# Defaults: name=toypalette, toy=tools/toys/palette.lua (the same source the
# llvm-mos part A capture uses).
#
# The route is tools/capture-toy.sh's, byte for byte where it matters:
# Mednafen records PNG frames with -qtrecord, is stopped with SIGINT to write
# the autosave, -pce.slstart 3 puts captured row 0 at VCE line 17 (VDW line
# 0 for VPR $0F02), and mcs-extract.py reads VRAM/CRAM/BaseRAM.  Only the
# build command and the file names differ (tools/build-huc.sh, <name>-huc).
set -euo pipefail
cd "$(dirname "$0")/.."

NAME="${1:-palette}"
TOY="${2:-tools/toys/palette.lua}"
DUMPDIR="tests/dumps/${NAME}-huc"
SCRATCH="${SCRATCH:-${TMPDIR:-/tmp}}"
MCSDIR="$HOME/.mednafen/mcs"
LOGDIR="${TMPDIR:-/tmp}"
SLSTART=3
SLEND=234
MOV="$SCRATCH/$NAME-huc.mov"

tools/build-huc.sh "$TOY" "$NAME"

mkdir -p "$DUMPDIR" "$SCRATCH"
rm -rf "$DUMPDIR/frames"

pkill -x mednafen 2>/dev/null || true
sleep 1

rm -f "$MOV"
echo "== launch mednafen ($NAME-huc)"
mednafen -force_module pce -pce.slstart "$SLSTART" -pce.slend "$SLEND" \
  -pce.xscale 1 -pce.yscale 1 \
  -qtrecord "$MOV" -qtrecord.vcodec png \
  -qtrecord.w_double_threshold 0 -qtrecord.h_double_threshold 0 \
  -autosave 1 "tools/gen/$NAME-huc.pce" > "$LOGDIR/mdfn-$NAME-huc.log" 2>&1 &

echo "== let the OSD messages fade and the toy run"
sleep "${SLEEP:-9}"

echo "== clean exit (SIGINT -> CloseGame -> autosave)"
pkill -INT -x mednafen
for i in $(seq 1 15); do
  pgrep -x mednafen >/dev/null || break
  sleep 1
done
pkill -9 -x mednafen 2>/dev/null || true

new_mcs=$(ls -t "$MCSDIR"/"$NAME"-huc.*.mca 2>/dev/null | head -1 || true)
if [ -z "$new_mcs" ]; then
  echo "no autosave state for $NAME-huc in $MCSDIR" >&2
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
cp "$LOGDIR/mdfn-$NAME-huc.log" "$DUMPDIR/mednafen.log"

python3 -I - "$DUMPDIR" "tools/gen/$NAME-huc.json" "$SLSTART" "$SLEND" <<'PY'
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
PY

if [ -z "${KEEP_MOV:-}" ]; then rm -f "$MOV"; fi
echo "== done: $DUMPDIR"
