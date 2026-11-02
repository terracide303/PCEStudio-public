#!/bin/bash
# capture-rom-sound.sh — export a toy and record its sound in Mednafen
# (card #216; design and measurements: docs/ROM-SOUND.md §11).
#
#   tools/capture-rom-sound.sh TOY.lua NAME [IMAGE]
#
# TOY.lua is exported with tools/ilvm/emit.js against IMAGE (default
# renderer/ilvm.bin, the committed interpreter), then run in Mednafen with
# the route tools/capture-hutrack.sh established for sound: the pce_fast
# core, the CPU pinned at 1x, -sound.driver dummy with -soundrecord so the
# WAV is the core's 44,100 Hz output verbatim, and SIGINT for a clean exit
# between frames — never a synthesized key event.  VIDEO_DRIVER defaults to
# sdl because the OpenGL driver can stall at video init when the display is
# asleep; both drivers read the same emulated surface.
#
# Produces ${OUTDIR:-$TMPDIR/pce-rom-sound}/<name>/{<name>.pce,<name>.wav,
# <name>.json,mednafen.log}.  Nothing in the repository is written.
#
# SLEEP=<seconds> overrides the settle delay (default 7).
set -euo pipefail
cd "$(dirname "$0")/.."

TOY="${1:?usage: capture-rom-sound.sh TOY.lua NAME [IMAGE]}"
NAME="${2:-$(basename "$TOY" .lua)}"
IMAGE="${3:-renderer/ilvm.bin}"
VIDEO_DRIVER="${VIDEO_DRIVER:-sdl}"
: "${TMPDIR:?TMPDIR is not set}"
OUTDIR="${OUTDIR:-$TMPDIR/pce-rom-sound}/$NAME"

if ! command -v mednafen >/dev/null 2>&1; then
  echo "capture-rom-sound: mednafen not found" >&2
  exit 2
fi
# Another seat may run Mednafen from this account; two runs contend and the
# capture windows go wrong (docs/ROM_SPEED.md, and #216's own runs).
if pgrep -x mednafen >/dev/null 2>&1; then
  echo "capture-rom-sound: another mednafen is running; waiting for it" >&2
  for i in $(seq 1 60); do pgrep -x mednafen >/dev/null || break; sleep 2; done
fi

mkdir -p "$OUTDIR"
ROM="$OUTDIR/$NAME.pce"
WAV="$OUTDIR/$NAME.wav"
rm -f "$WAV"

echo "== export ($IMAGE)"
node -e '
const fs = require("fs"), path = require("path");
const il = require("./renderer/pce-il.js");
const ilbc = require("./renderer/pce-ilbc.js");
const rom = require("./renderer/pce-rom.js");
const [toy, image, out] = process.argv.slice(1);
const encoded = ilbc.encode(il.compile(fs.readFileSync(toy, "utf8"),
                                       { chunkName: path.basename(toy) }));
fs.writeFileSync(out, Buffer.from(rom.buildToyRom({
  bank0: fs.readFileSync(image), bytecode: encoded.bytes })));
console.log("  bytecode " + encoded.bytes.length + " B");
' "$TOY" "$IMAGE" "$ROM"

export MEDNAFEN_HOME="$OUTDIR/mednafen-home"
mkdir -p "$MEDNAFEN_HOME/mcs"

echo "== mednafen ($VIDEO_DRIVER)"
mednafen -force_module pce_fast -pce_fast.ocmultiplier 1 \
  -video.driver "$VIDEO_DRIVER" -autosave 0 \
  -sound 1 -sound.driver dummy -sound.rate 44100 \
  -soundrecord "$WAV" "$ROM" > "$OUTDIR/mednafen.log" 2>&1 &
MDPID=$!
sleep "${SLEEP:-7}"
kill -INT "$MDPID" 2>/dev/null || true
for i in $(seq 1 20); do
  kill -0 "$MDPID" 2>/dev/null || break
  sleep 1
done
kill -9 "$MDPID" 2>/dev/null || true

if [ ! -s "$WAV" ]; then
  echo "no sound recorded; see $OUTDIR/mednafen.log" >&2
  exit 1
fi

python3 -I - "$ROM" "$IMAGE" "$WAV" "$OUTDIR/$NAME.json" <<'PY'
import hashlib, json, struct, sys
from pathlib import Path

rom, image, wav, out = sys.argv[1:5]

def digest(path):
    data = Path(path).read_bytes()
    return {"file": path, "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest()}

data = Path(wav).read_bytes()
pos, fmt, frames = 12, None, None
while pos + 8 <= len(data):
    cid = data[pos:pos + 4]
    size = struct.unpack("<I", data[pos + 4:pos + 8])[0]
    if cid == b"fmt ":
        fmt = struct.unpack("<HHIIHH", data[pos + 8:pos + 8 + 16])
    elif cid == b"data":
        frames = size
    pos += 8 + size + (size & 1)
channels, rate, bits = fmt[1], fmt[2], fmt[5]
run = {
    "rom": digest(rom),
    "image": digest(image),
    "wav": {**digest(wav), "sample_rate": rate, "channels": channels,
            "bits": bits, "frames": frames // (channels * (bits // 8)),
            "seconds": round(frames // (channels * (bits // 8)) / rate, 6)},
    "capture": {"emulator": "mednafen 1.32.1", "module": "pce_fast",
                "ocmultiplier": 1, "sound_rate": 44100,
                "record": "-soundrecord (core output verbatim)",
                "exit": "SIGINT, whole frames only"},
}
Path(out).write_text(json.dumps(run, indent=2) + "\n")
print("== %s: %d B, sha256 %s" % (rom, len(Path(rom).read_bytes()),
                                  hashlib.sha256(Path(rom).read_bytes()).hexdigest()[:16]))
print("== %s: %.3f s of audio" % (wav, run["wav"]["seconds"]))
PY

echo "== measure"
node tools/rom-sound-pitch.js "$WAV"
