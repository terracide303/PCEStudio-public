#!/bin/bash
# tools/native-measure.sh ROM.pce NAME — cycles per frame() of a natively compiled toy ROM.
#
# Runs the ROM in Mednafen (windowless) for SLEEP seconds (default 10), reads the
# runtime's TMA-timer counters (BaseRAM $2100, toy_runtime.c MEAS_*) out of the
# autosave and prints the mean.  One tick = 1024 CPU clocks.  The interpreter's
# figure for the same toy is in docs/ROM_SPEED.md.
ROM="$1"; NAME="$2"; ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d "${TMPDIR:-/tmp}/nm.XXXXXX")"
rm -f "$HOME/.mednafen/mcs/$NAME".*.mca
SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy mednafen -force_module pce -autosave 1 "$ROM" >"$OUT/log" 2>&1 &
PID=$!
sleep "${SLEEP:-10}"
kill -INT $PID
for i in $(seq 1 15); do kill -0 $PID 2>/dev/null || break; sleep 1; done
kill -9 $PID 2>/dev/null
MCA=$(ls -t "$HOME/.mednafen/mcs/"*.mca 2>/dev/null | head -1)
python3 -I "$ROOT/tools/mcs-extract.py" "$MCA" "$OUT" 3 --ram >/dev/null 2>&1
python3 -I - "$OUT/ram.bin" <<'PY'
import struct,sys
r=open(sys.argv[1],"rb").read()
s=struct.unpack_from("<I",r,0x100)[0]; c=struct.unpack_from("<H",r,0x104)[0]
print("frames measured",c,"mean ticks",(s/c if c else None),"cycles/frame",(s/c*1024 if c else None),"max ticks",r[0x106],"flags",r[0x10F])
PY
