#!/bin/bash
# capture-pads.sh — card #45's evidence: a console toy reading a scripted pad
# and a timer toy's interrupt count, both in Mednafen, both against the
# browser run of the same Lua source.
#
#   tools/capture-pads.sh [NAME]
#
# Needs the instrumented Mednafen (tools/build-mednafen-instrument.sh), which
# adds the -loadmovie flag; set MD to its path.  No keyboard or mouse events
# are sent: the browser is driven by setPad(), the console by Mednafen's own
# input movie, started from the command line.
#
# Writes tests/dumps/pads/: padmove.bin (final state), timertoy.bin, and
# evidence.json with both comparisons.
set -euo pipefail
cd "$(dirname "$0")/.."

SCRATCH="${TMPDIR:-/tmp}/pce-pads"
MD="${MD:-${TMPDIR:-/tmp}/pce-mednafen/src/mednafen}"
DUMP="tests/dumps/pads"
mkdir -p "$SCRATCH" "$DUMP"

if [ ! -x "$MD" ]; then
  echo "no instrumented Mednafen at $MD" >&2
  echo "run tools/build-mednafen-instrument.sh first" >&2
  exit 2
fi

# One Mednafen run, signalled by PID only: another seat may be running
# Mednafen in the same account, and a pkill would kill theirs.
run_mednafen() {                       # run_mednafen ROM SECONDS [movie]
  local rom="$1" secs="$2" movie="${3:-}"
  local args=(-force_module pce -autosave 1)
  if [ -n "$movie" ]; then args+=(-loadmovie "$movie"); fi
  rm -rf "$HOME/.mednafen/mcs"
  mkdir -p "$HOME/.mednafen/mcs"
  "$MD" "${args[@]}" "$rom" > "$SCRATCH/mednafen.log" 2>&1 &
  local pid=$!
  sleep "$secs"
  kill -INT "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
  kill -9 "$pid" 2>/dev/null || true
  ls -t "$HOME/.mednafen/mcs"/*.mca 2>/dev/null | head -1
}

dump_state() {                         # dump_state MCA DIR
  rm -rf "$2"
  mkdir -p "$2"
  python3 -I tools/mcs-extract.py "$1" "$2" 3 --ram > /dev/null
}

vram_word() {                          # vram_word DIR WORD
  python3 -I - "$1" "$2" <<'PY'
import struct
import sys
d, w = sys.argv[1], int(sys.argv[2], 0)
v = open(d + "/vram.bin", "rb").read()
print(struct.unpack_from("<H", v, w * 2)[0])
PY
}

echo "== build the two toys"
tools/build-toyc.sh tools/toys/padmove.lua padmove
tools/build-toyc.sh tools/toys/timer.lua timertoy

echo "== pad: a base state with no pad pressed"
MCA=$(run_mednafen tools/gen/padmove.pce 20)
[ -n "$MCA" ] || { echo "no state from the pad run" >&2; exit 1; }
dump_state "$MCA" "$SCRATCH/base"
F0=$(vram_word "$SCRATCH/base" 0x3F00)
echo "   base state at toy frame $F0"
python3 -I - "$MCA" "$SCRATCH/state.raw" <<'PY'
import gzip
import sys
open(sys.argv[2], "wb").write(gzip.open(sys.argv[1], "rb").read())
PY

echo "== pad: play the scripted movie"
node tools/mkmovie.js "$SCRATCH/state.raw" "$SCRATCH/pad.mcm" "$F0" 250
MCA=$(run_mednafen tools/gen/padmove.pce 20 "$SCRATCH/pad.mcm")
[ -n "$MCA" ] || { echo "no state from the movie run" >&2; exit 1; }
dump_state "$MCA" "$SCRATCH/after"
cp "$SCRATCH/after/vram.bin" "$DUMP/padmove.bin"

echo "== timer: count interrupts per frame"
MCA=$(run_mednafen tools/gen/timertoy.pce 20)
[ -n "$MCA" ] || { echo "no state from the timer run" >&2; exit 1; }
dump_state "$MCA" "$SCRATCH/timer"
cp "$SCRATCH/timer/vram.bin" "$DUMP/timertoy.bin"

echo "== compare with the browser"
node - "$SCRATCH" "$DUMP" <<'JS'
"use strict";
const fs = require("fs");
const path = require("path");
const toys = require("./renderer/pce-toys.js");
const { padAt } = require("./tools/mkmovie.js");

const scratch = process.argv[2];
const dump = process.argv[3];
const w = (b, a) => b[a * 2] | (b[a * 2 + 1] << 8);

const cVram = fs.readFileSync(path.join(scratch, "after", "vram.bin"));
const cF = w(cVram, 0x3F00);
const cY = w(cVram, 0x7F00), cX = w(cVram, 0x7F00 + 1);

const src = fs.readFileSync("tools/toys/padmove.lua", "utf8");
const rt = toys.create(src, { budgetMs: 3000 });
rt.load();
let fr = null;
for (let f = 0; f <= cF; f++) { rt.setPad(1, padAt(f)); fr = rt.frame(f); }
rt.dispose();
const bY = w(fr.state.sat, 0), bX = w(fr.state.sat, 1);

const tVram = fs.readFileSync(path.join(scratch, "timer", "vram.bin"));
const cIrq = w(tVram, 0x3F00), cFrames = w(tVram, 0x3F01);
const rt2 = toys.create(fs.readFileSync("tools/toys/timer.lua", "utf8"),
                        { budgetMs: 6000 });
rt2.load();
let fr2 = null;
for (let f = 0; f <= cFrames; f++) fr2 = rt2.frame(f);
const bIrq = w(fr2.state.vram, 0x3F00);
rt2.dispose();

const ev = {
  pad: {
    frame: cF,
    console: { satY: cY, satX: cX, x: cX - 32, y: cY - 64 },
    browser: { satY: bY, satX: bX, x: bX - 32, y: bY - 64 },
    equal: cY === bY && cX === bX
  },
  timer: {
    frames: cFrames,
    console_irqs: cIrq,
    console_per_frame: cIrq / cFrames,
    browser_irqs: bIrq,
    browser_per_frame: bIrq / cFrames,
    arithmetic_per_frame_5991Hz_60: 6991.3 / 18 / 60
  }
};
fs.writeFileSync(path.join(dump, "evidence.json"),
                 JSON.stringify(ev, null, 1) + "\n");
console.log(JSON.stringify(ev, null, 1));
if (!ev.pad.equal) process.exit(1);
JS

echo "== done: $DUMP"
