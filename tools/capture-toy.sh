#!/bin/bash
# capture-toy.sh — run a toy built by tools/build-toyc.sh in Mednafen and
# harvest the #31 part A evidence: the save state, every video frame of the
# run (the console's frame sequence), and the build's code-size report.
#
#   tools/capture-toy.sh [name] [toy.lua]
#
# Defaults: name=toypalette, toy=tools/toys/palette.lua (the same source
# tests/check-il.js runs — tests/check-il-console.js asserts the two agree).
#
# The route is tools/capture.sh's, only the crop and the frame extraction
# differ:
#   - Mednafen records with -qtrecord ... -qtrecord.vcodec png and is stopped
#     with SIGINT; -autosave writes the .mca state, mcs-extract.py reads it
#     (--ram: the TMA timer measurement lives at BaseRAM $2100).
#   - SLSTART=3, SLEND=234: captured row 0 is VCE line 17, which is VDW line 0
#     (VPR=$0F02, VDS+VSW=17), so the toy's 256x224 picture is the first 224
#     captured rows — no vertical shift to explain away.
#   - movframes.py --all writes every recorded frame (256x224) to
#     tests/dumps/<name>/frames/; the LAST one is also mednafen.png (256x232,
#     the repo's usual crop).
#
# Produces tests/dumps/<name>/: vram.bin, cram.bin, sat.bin, regs.json,
# ram.bin, mednafen.png, frames/frameNNNN.png, mednafen.log and meta.json
# (the build's rom sha/size/function sizes plus the measured timer figures).
set -euo pipefail
cd "$(dirname "$0")/.."

NAME="${1:-toypalette}"
TOY="${2:-tools/toys/palette.lua}"
DUMPDIR="tests/dumps/$NAME"
SCRATCH="/Volumes/External II/scratch"
MCSDIR="$HOME/.mednafen/mcs"
LOGDIR="${TMPDIR:-/tmp}"
SLSTART=3
SLEND=234
MOV="$SCRATCH/$NAME.mov"

tools/build-toyc.sh "$TOY" "$NAME"

mkdir -p "$DUMPDIR" "$SCRATCH"
rm -rf "$DUMPDIR/frames"

pkill -x mednafen 2>/dev/null || true
sleep 1

rm -f "$MOV"
echo "== launch mednafen ($NAME)"
mednafen -force_module pce -pce.slstart "$SLSTART" -pce.slend "$SLEND" \
  -pce.xscale 1 -pce.yscale 1 \
  -qtrecord "$MOV" -qtrecord.vcodec png \
  -qtrecord.w_double_threshold 0 -qtrecord.h_double_threshold 0 \
  -autosave 1 "tools/gen/$NAME.pce" > "$LOGDIR/mdfn-$NAME.log" 2>&1 &

echo "== let the OSD messages fade and the toy run"
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
  echo "no autosave state for $NAME in $MCSDIR" >&2
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
# #31 part C adds the raster() measurements: every call is bracketed by the
# same timer, and every 224-call collection is bracketed as a whole.
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
    # Mednafen's HuC6280 timer decrements once per 1024 CPU clocks
    # (src/pce/huc6280.cpp: timer_div = 1024).
    "cycles_per_frame": (sum_ticks / count * 1024) if count else None,
    "raster_calls": raster_count,
    "raster_sum_ticks": raster_sum,
    "cycles_per_raster_call": (raster_sum / raster_count * 1024)
                              if raster_count else None,
    "raster_max_ticks": ram[0x10E],
    "collections": collect_count,
    # The whole-collection bracket is a 7-bit delta and wraps on a
    # collection longer than 128 ticks; the per-call sum does not, so the
    # comparable figure is the per-call ticks accumulated over the frames.
    "collect_sum_ticks_7bit": collect_sum,
    "cycles_per_collection": (raster_sum / collect_count * 1024)
                             if collect_count else None,
    # bit 0/1: a base colour/VRAM list overflowed; bit 2: a vset in a
    # raster callback; bit 3: the main loop fell behind (part C only)
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
