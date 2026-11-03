#!/bin/bash
# capture-pad-buttons.sh — the ROM pad test's evidence: the exported padtest
# ROM reads every button of both pads from a scripted movie, and its final
# picture (VRAM + CRAM + SAT) is byte-equal to the browser run of the same
# source fed the same buttons.
#
#   tools/capture-pad-buttons.sh
#
# Needs the instrumented Mednafen (tools/build-mednafen-instrument.sh), which
# adds the -loadmovie flag; set MD to its path.  No keyboard or mouse events
# are sent: the browser route is driven by setPad(), the console by
# Mednafen's own input movie, started from the command line.
#
# Writes tests/dumps/pads/buttons-evidence.json plus the exported ROM
# (padtest-rom.bin) and the console's final VRAM (padtest-console-vram.bin).
# tests/check-pad-buttons.js asserts the JSON when it exists and SKIPs with
# this command otherwise.  The movie run needs enough wall time for the
# whole script at the instrumented Mednafen's pace: WALL="${WALL:-90}".
set -euo pipefail
cd "$(dirname "$0")/.."

SCRATCH="${TMPDIR:-/tmp}/pce-pad-buttons"
MD="${MD:-${TMPDIR:-/tmp}/pce-mednafen/src/mednafen}"
DUMP="tests/dumps/pads"
WALL="${WALL:-90}"
mkdir -p "$SCRATCH" "$DUMP"

# the sdl driver, not OpenGL (the known stall on this machine)
export VIDEO_DRIVER="${VIDEO_DRIVER:-sdl}"

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

echo "== export the padtest ROM through the studio's route (validate, IL, ROM)"
node - "$SCRATCH/padtest.pce" <<'JS'
"use strict";
const fs = require("fs");
const validate = require("./renderer/pce-validate.js");
const il = require("./renderer/pce-il.js");
const ilbc = require("./renderer/pce-ilbc.js");
const romLib = require("./renderer/pce-rom.js");

const source = fs.readFileSync("toys/padtest/main.lua", "utf8");
const report = validate.validate(source, { chunkName: "main.lua" });
if (!report.ok) {
  const first = (report.problems || [])[0] || {};
  console.error("validator refused the toy: " + (first.message || "no reason"));
  process.exit(1);
}
const program = il.compile(source, { chunkName: "main.lua" });
const encoded = ilbc.encode(program);
const bank0 = fs.readFileSync("renderer/ilvm.bin");
const rom = romLib.buildToyRom({ bank0: bank0, bytecode: encoded.bytes });
fs.writeFileSync(process.argv[2], Buffer.from(rom));
console.log("wrote " + process.argv[2] + " (" + rom.length + " bytes, " +
            encoded.bytes.length + " bytecode bytes)");
JS

echo "== a base state with no pad pressed"
MCA=$(run_mednafen "$SCRATCH/padtest.pce" 20)
[ -n "$MCA" ] || { echo "no state from the base run" >&2; exit 1; }
dump_state "$MCA" "$SCRATCH/base"
F0=$(vram_word "$SCRATCH/base" 0x3F00)
echo "   base state at toy frame $F0"
python3 -I - "$MCA" "$SCRATCH/state.raw" <<'PY'
import gzip
import sys
open(sys.argv[2], "wb").write(gzip.open(sys.argv[1], "rb").read())
PY

# The script is positioned relative to F0 (the movie can only drive frames
# after the restored state), so a faster or slower machine still sees every
# button: the first hold lands 60 frames in, and 600 frames cover the whole
# 540-frame script with slack.
START=$((F0 + 60))
FRAMES=$((540 + 60))

echo "== play the scripted button movie (first hold at toy frame $START)"
node tools/mkmovie.js --buttons "$SCRATCH/state.raw" "$SCRATCH/pad.mcm" \
     "$F0" "$FRAMES" "$START"
MCA=$(run_mednafen "$SCRATCH/padtest.pce" "$WALL" "$SCRATCH/pad.mcm")
[ -n "$MCA" ] || { echo "no state from the movie run" >&2; exit 1; }
dump_state "$MCA" "$SCRATCH/after"
cp "$SCRATCH/after/vram.bin" "$DUMP/padtest-console-vram.bin"
cp "$SCRATCH/padtest.pce" "$DUMP/padtest-rom.bin"

echo "== compare with the browser"
node - "$SCRATCH" "$DUMP" "$F0" "$START" <<'JS'
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const il = require("./renderer/pce-il.js");
const { buttonsAt, BUTTONS, BUTTON_STEPS } = require("./tools/mkmovie.js");

const scratch = process.argv[2];
const dump = process.argv[3];
const F0 = parseInt(process.argv[4], 10);
const START = parseInt(process.argv[5], 10);
const w = (b, a) => b[a * 2] | (b[a * 2 + 1] << 8);

const cVram = fs.readFileSync(path.join(scratch, "after", "vram.bin"));
const cCram = fs.readFileSync(path.join(scratch, "after", "cram.bin"));
const cSat = fs.readFileSync(path.join(scratch, "after", "sat.bin"));
const cF = w(cVram, 0x3F00);
const cEver1 = w(cVram, 0x3F01);
const cEver2 = w(cVram, 0x3F02);

const src = fs.readFileSync("toys/padtest/main.lua", "utf8");
const rt = il.create(src, { budgetMs: 30000 });
rt.load();
let fr = null;
for (let f = 0; f <= cF; f++) {
  const p = buttonsAt(f, START);
  rt.setPad(1, p[1]);
  rt.setPad(2, p[2]);
  fr = rt.frame(f);
}
rt.dispose();

const same = (a, b) => a.equals(b);
const vramEqual = same(Buffer.from(cVram), Buffer.from(fr.state.vram));
const cramEqual = same(Buffer.from(cCram), Buffer.from(fr.state.cram));
const satEqual = same(Buffer.from(cSat), Buffer.from(fr.state.sat));
const bEver1 = w(fr.state.vram, 0x3F01);
const bEver2 = w(fr.state.vram, 0x3F02);
const rom = fs.readFileSync(path.join(dump, "padtest-rom.bin"));
const sha = crypto.createHash("sha256").update(rom).digest("hex");

const ev = {
  toy: "toys/padtest/main.lua",
  romSha: sha,
  baseFrame: F0,
  firstHold: START,
  steps: BUTTON_STEPS,
  finalFrame: cF,
  console: { ever1: cEver1.toString(16), ever2: cEver2.toString(16) },
  browser: { ever1: bEver1.toString(16), ever2: bEver2.toString(16) },
  everyButtonReached: cEver1 === 0xFF && cEver2 === 0xFF &&
                      bEver1 === 0xFF && bEver2 === 0xFF,
  picture: { vramEqual: vramEqual, cramEqual: cramEqual,
             satEqual: satEqual },
  equal: vramEqual && cramEqual && satEqual
};
fs.writeFileSync(path.join(dump, "buttons-evidence.json"),
                 JSON.stringify(ev, null, 1) + "\n");
console.log(JSON.stringify(ev, null, 1));
if (!ev.everyButtonReached) {
  console.error("the movie run was cut short or a bit never reached the " +
                "ROM: ever1/ever2 must be ff/ff — raise WALL");
  process.exit(1);
}
if (!ev.equal) process.exit(1);
JS

echo "== done: $DUMP"
