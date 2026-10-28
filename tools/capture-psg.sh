#!/bin/bash
# capture-psg.sh — run one #34 PSG test ROM in Mednafen and record its audio
#
#   tools/capture-psg.sh [1..10]     # psg1..psg10 (tools/gen/psgN.pce)
#   tools/capture-psg.sh 6b          # psg6b
#
# The #34 PSG test ROMs are pure audio: they write PSG registers for a few
# frames and then idle-loop forever, and they never touch the VDC/VCE/timer/
# IRQ hardware (so the recorded WAV is a pure PSG witness — see genpsg.py).
# The route:
#   - genpsg.py generates the ROM's asm, its register-write trace
#     (tools/gen/psgN.trace.json: every write at its frame + in-frame CPU
#     cycle, plus the per-frame durations) and PCEAS builds the ROM;
#   - Mednafen's pce_fast core runs it (that is the core whose PSG pipeline
#     the model replicates exactly: psg.cpp + Blip_Buffer into 44100 Hz
#     sample frames — the pce module's PCE_PSG feeds an OwlResampler
#     instead, see docs/PSG.md); the CPU clock is pinned at 1x with
#     -pce_fast.ocmultiplier 1.  A dummy sound driver paces wall-clock
#     time; with -soundrecord active, soundmultiplier and SoundVolume are
#     forced to 1 and the global resampler is bypassed, so the WAV is the
#     core's 44100 Hz output verbatim (mednafen-1.32.1 src/mednafen.cpp
#     ProcessAudio);
#   - a clean exit is requested with SIGINT (the only key-free way to reach
#     CloseGame(); this Mac's user must never receive synthesized
#     keyboard/mouse events), which Mednafen handles between frames, so the
#     WAV holds whole frames only — the exact frame count is derivable from
#     the WAV length alone (tests/check-psg.js does that).
#
# Produces tests/dumps/psgN/:
#   mednafen.wav   the recorded audio (PCM16 LE stereo, 44100 Hz)
#   trace.json     the ROM's register-write trace (copied from tools/gen/)
#   mednafen.log   the run's stdout
#
# SLEEP=<seconds> overrides the settle delay (default 8).

set -euo pipefail
cd "$(dirname "$0")/.."

N="${1:?usage: capture-psg.sh 1..10|6b}"
NAME="psg${N}"
DUMPDIR="tests/dumps/${NAME}"
TOOLS="$(pwd)/tools"
SCRATCH="${SCRATCH:-${TMPDIR:-/tmp}/pce-psg-capture}"
LOG="${TMPDIR:-/tmp}/mdfn-$NAME.log"

mkdir -p "$DUMPDIR" "$SCRATCH"

echo "== build $NAME"
python3 -I "$TOOLS/genpsg.py"
pceas -raw -o "tools/gen/$NAME.pce" "tools/gen/$NAME.asm"

pkill -x mednafen 2>/dev/null || true
sleep 1

WAV="$SCRATCH/$NAME.wav"
rm -f "$WAV"

echo "== launch mednafen ($NAME)"
mednafen -force_module pce_fast -pce_fast.ocmultiplier 1 \
  -autosave 0 -sound 1 -sound.driver dummy -sound.rate 44100 \
  -soundrecord "$WAV" \
  "tools/gen/$NAME.pce" > "$LOG" 2>&1 &

echo "== let the audio settle"
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
echo "wav: $WAV ($(stat -f%z "$WAV") bytes)"

echo "== harvest"
mv "$WAV" "$DUMPDIR/mednafen.wav"
cp "tools/gen/$NAME.trace.json" "$DUMPDIR/trace.json"
cp "$LOG" "$DUMPDIR/mednafen.log"
echo "== done: $DUMPDIR"
ls -la "$DUMPDIR"
