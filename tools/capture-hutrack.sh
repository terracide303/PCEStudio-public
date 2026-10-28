#!/bin/bash
# capture-hutrack.sh — build #35's HuTrack ROM and record it in Mednafen
#
#   tools/capture-hutrack.sh
#
# The ROM (tools/hutrack.asm) plays our own test DMF (tests/dumps/hutrack1/
# demo.dmf, converted by the vendored HuTrack converter into
# tests/dumps/hutrack1/song/).  HuTrack's engine needs PCEAS 4.x, not the
# repo's external 3.23 — set PCEAS4 (default: pceas4; docs/BUILD.md).
#
# The recording route is the one #34 established (see tools/capture-psg.sh):
# Mednafen's pce_fast core, CPU pinned at 1x, -sound.driver dummy with
# -soundrecord so the WAV is the core's 44100 Hz output verbatim, and a
# SIGINT for a clean exit between frames (never a synthesized key event).
# Mednafen starts the game some way into the wall-clock run, so the WAV is
# shorter than SLEEP; tests/check-hutrack.js times the notes from the WAV
# itself.
#
# Produces tests/dumps/hutrack1/:
#   mednafen.wav   the recording (PCM16 LE stereo, 44100 Hz)
#   mednafen.log   Mednafen's stdout
#   run.json       ROM/WAV hashes and sizes, and the capture settings
#
# SLEEP=<seconds> overrides the settle delay (default 8).

set -euo pipefail
cd "$(dirname "$0")/.."

DUMPDIR="tests/dumps/hutrack1"
ROM="tools/gen/hutrack/hutrack-demo.pce"
SCRATCH="${SCRATCH:-${TMPDIR:-/tmp}/pce-hutrack-capture}"
LOG="${TMPDIR:-/tmp}/mdfn-hutrack.log"
PCEAS4="${PCEAS4:-pceas4}"

mkdir -p "$DUMPDIR" "$SCRATCH"

echo "== build"
PCEAS4="$PCEAS4" tools/build-hutrack.sh

pkill -x mednafen 2>/dev/null || true
sleep 1

WAV="$SCRATCH/hutrack1.wav"
rm -f "$WAV"

echo "== launch mednafen"
mednafen -force_module pce_fast -pce_fast.ocmultiplier 1 \
  -autosave 0 -sound 1 -sound.driver dummy -sound.rate 44100 \
  -soundrecord "$WAV" \
  "$ROM" > "$LOG" 2>&1 &

echo "== let the song play"
sleep "${SLEEP:-8}"

echo "== clean exit (SIGINT -> CloseGame; the WAV keeps whole frames)"
pkill -INT -x mednafen
for i in $(seq 1 15); do
  pgrep -x mednafen >/dev/null || break
  sleep 1
done
pkill -9 -x mednafen 2>/dev/null || true

if [ ! -s "$WAV" ]; then
  echo "no sound recorded"; exit 1
fi

echo "== harvest"
mv "$WAV" "$DUMPDIR/mednafen.wav"
cp "$LOG" "$DUMPDIR/mednafen.log"

python3 -I - "$ROM" "$DUMPDIR/mednafen.wav" "$DUMPDIR/mednafen.log" \
  "$DUMPDIR/run.json" "${SLEEP:-8}" <<'PY'
import hashlib, json, struct, sys
from pathlib import Path

rom, wav, log, out, settle = sys.argv[1:6]

def digest(path):
    data = Path(path).read_bytes()
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}

def wav_info(path):
    data = Path(path).read_bytes()
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise SystemExit(f"{path}: not a RIFF/WAVE file")
    pos, fmt, frames = 12, None, None
    while pos + 8 <= len(data):
        cid, size = data[pos:pos + 4], struct.unpack("<I", data[pos + 4:pos + 8])[0]
        body = data[pos + 8:pos + 8 + size]
        if cid == b"fmt ":
            fmt = struct.unpack("<HHIIHH", body[:16])
        elif cid == b"data":
            frames = size
        pos += 8 + size + (size & 1)
    if fmt is None or frames is None:
        raise SystemExit(f"{path}: missing fmt/data chunk")
    channels, rate, bits = fmt[1], fmt[2], fmt[5]
    frame_bytes = channels * (bits // 8)
    info = digest(path)
    info.update(sample_rate=rate, channels=channels, bits=bits,
                data_bytes=frames, frame_bytes=frame_bytes,
                frames=frames // frame_bytes,
                seconds=round((frames // frame_bytes) / rate, 6))
    return info

run = {
    "rom": {"file": rom, **digest(rom)},
    "wav": {"file": wav, **wav_info(wav)},
    "log": {"file": log, **digest(log)},
    "capture": {
        "emulator": "mednafen 1.32.1",
        "module": "pce_fast",
        "ocmultiplier": 1,
        "sound_rate": 44100,
        "record": "-soundrecord (core output verbatim)",
        "exit": "SIGINT, whole frames only",
        "settle_seconds": int(settle),
    },
}
Path(out).write_text(json.dumps(run, indent=2) + "\n")
PY

echo "== done: $DUMPDIR"
ls -la "$DUMPDIR"
