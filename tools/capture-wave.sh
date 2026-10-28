#!/bin/bash
# capture-wave.sh — record the #35 wave-editor ROMs in Mednafen
#
#   tools/capture-wave.sh 1      # tests/dumps/wave1 (the six-voice chord)
#   tools/capture-wave.sh 2      # tests/dumps/wave2 (the LFO sweep)
#
# The route is #34's (tools/capture-psg.sh), because the model being compared
# is pce_fast's PSG pipeline:
#   - tools/wavesounds.js writes the sound (renderer/pce-wave.js's document);
#     tools/genwave.py writes waveN.asm + waveN.trace.json; PCEAS assembles
#     the ROM.  The ROMs never touch the VDC/VCE/timer/IRQ hardware, so the
#     recorded WAV is a pure PSG witness (tools/genwave.py).
#   - Mednafen's pce_fast core runs the ROM with the CPU clock pinned at 1x
#     (-pce_fast.ocmultiplier 1), a dummy sound driver pacing wall-clock
#     time, and -soundrecord, which forces soundmultiplier/SoundVolume to 1
#     and bypasses the global resampler, so the WAV is the core's 44100 Hz
#     output verbatim (mednafen.cpp ProcessAudio).
#   - a clean exit is requested with SIGINT (the only key-free way to reach
#     CloseGame(); this Mac's user must never receive synthesized
#     keyboard/mouse events), handled between frames, so the WAV holds whole
#     frames only and the exact frame count is derivable from its length
#     (tests/check-wave.js).
#
# Produces tests/dumps/waveN/:
#   mednafen.wav   the recording (PCM16 LE stereo, 44100 Hz)
#   sound.json     the sound the ROM was built from (provenance)
#   trace.json     the ROM's register-write trace (from tools/gen/)
#   mednafen.log   the run's stdout
#
# SLEEP=<seconds> overrides the settle delay (default 6).

set -euo pipefail
cd "$(dirname "$0")/.."

N="${1:?usage: capture-wave.sh 1|2}"
NAME="wave${N}"
DUMPDIR="tests/dumps/${NAME}"
TOOLS="$(pwd)/tools"
TMP="${TMPDIR:-/tmp}"

mkdir -p "$DUMPDIR"

echo "== build $NAME"
node "$TOOLS/wavesounds.js"
python3 -I "$TOOLS/genwave.py"
pceas -raw -o "tools/gen/$NAME.pce" "tools/gen/$NAME.asm"

pkill -x mednafen 2>/dev/null || true
sleep 1

WAV="$TMP/pce-$NAME.wav"
LOG="$TMP/pce-$NAME.log"
rm -f "$WAV"

echo "== launch mednafen ($NAME)"
mednafen -force_module pce_fast -pce_fast.ocmultiplier 1 \
  -autosave 0 -sound 1 -sound.driver dummy -sound.rate 44100 \
  -soundrecord "$WAV" \
  "tools/gen/$NAME.pce" > "$LOG" 2>&1 &

echo "== let the audio settle"
sleep "${SLEEP:-6}"

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
echo "wav: $WAV ($(stat -f%z "$WAV") bytes)"

echo "== harvest"
mv "$WAV" "$DUMPDIR/mednafen.wav"
cp "tools/gen/$NAME.sound.json" "$DUMPDIR/sound.json"
cp "tools/gen/$NAME.trace.json" "$DUMPDIR/trace.json"
cp "$LOG" "$DUMPDIR/mednafen.log"
echo "== done: $DUMPDIR"
ls -la "$DUMPDIR"
