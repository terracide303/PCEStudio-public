#!/bin/bash
# tools/ilvm/stack-canary.sh — measure the interpreter's stack high-water mark
# (card #214; design and budget: docs/ROM-SOUND.md §5).
#
#   tools/ilvm/stack-canary.sh [toy.lua]
#
# The HuTrack engine's .bss is placed at the interpreter image's __heap_start
# and the soft stack grows down from $4000, so the gap between the engine's
# last byte and $4000 is the stack's whole allowance.  This script measures
# how much of it a toy really uses:
#
#   1. rebuild the interpreter from the same sources with -DTOY_STACK_PROBE
#      (tools/ilvm/ilvm.c keeps the lowest exec() frame in its .bss word
#      probe_low; the script reads the word's address from the image's
#      symbols), place the engine banks against that image's __heap_start
#      exactly as tools/ilvm/build.sh does, and make a 32 KiB probe image;
#   2. encode the toy and build a ROM from the probe image (no compiler);
#   3. run it in Mednafen, take the autosaved state, and read the two words
#      out of BaseRAM with tools/mcs-extract.py --ram;
#   4. print the high-water mark and fail if it reaches the engine block.
#
# The default toy, tools/toys/loud.lua, carries the deepest call tree the
# shipping toys and games express: frame() -> level1 -> level2 -> level3 ->
# leaf (five interpreter frames), the same shape as PLATFORMER's
# frame -> draw_step -> build_tiles -> puttile -> callback.  One level more
# (`level4`) reaches the engine block by 39 B on the #214 partition, which
# is the measured edge docs/ROM-SOUND.md §5 records.  The probe reads the
# llvm-mos soft-stack pointer at exec() entry (after its prologue), so the
# figure is the real bottom of the frame.
#
# Nothing in the repository is written: the probe image, the staged engine
# tree and the save state all live under $TMPDIR.  Mednafen is required for
# the measurement (SKIP, exit 0, without it); VIDEO_DRIVER defaults to sdl
# because the OpenGL driver can stall at video init when the display is
# asleep, and both drivers read the same emulated surface.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$(pwd)"

LLVM_MOS="${LLVM_MOS:-/Volumes/External II/pce-tools/llvm-mos/llvm-mos}"
[ -x "$LLVM_MOS/bin/mos-pce-clang" ] || { [ -x /Volumes/External/pce-tools/llvm-mos/bin/mos-pce-clang ] && LLVM_MOS=/Volumes/External/pce-tools/llvm-mos; }
CC="$LLVM_MOS/bin/mos-pce-clang"
PCEAS4="${PCEAS4:-pceas4}"
TOY="${1:-tools/toys/loud.lua}"
VIDEO_DRIVER="${VIDEO_DRIVER:-sdl}"
SLEEP="${SLEEP:-9}"

if [ ! -x "$CC" ]; then
  echo "stack canary SKIP: llvm-mos not found at $LLVM_MOS" >&2
  exit 0
fi
if ! command -v "${PCEAS4}" >/dev/null 2>&1 && [ ! -x "${PCEAS4}" ]; then
  echo "stack canary SKIP: PCEAS 4.x not found (set PCEAS4)" >&2
  exit 0
fi
if ! command -v mednafen >/dev/null 2>&1; then
  echo "stack canary SKIP: mednafen not found" >&2
  exit 0
fi
: "${TMPDIR:?TMPDIR is not set; the canary keeps every file under it}"
SCRATCH=$(mktemp -d "$TMPDIR/ilvm-canary.XXXXXX")
trap 'if [ -z "${KEEP:-}" ]; then rm -rf "$SCRATCH"; else echo "kept $SCRATCH"; fi' EXIT

# Another seat may be running Mednafen; two runs of the same account's
# emulator contend and the capture windows go wrong (see docs/ROM_SPEED.md).
if pgrep -x mednafen >/dev/null 2>&1; then
  echo "stack canary: another mednafen is running; the run may be slow" >&2
fi

echo "== probe image ($SCRATCH)"
# #215: the probe compiles ilvm_sound.c too, so it needs the generated
# engine header first — the same two passes as tools/ilvm/build.sh: build
# the engine against the placeholder base, compile, measure, rebuild the
# engine against the measured heap, and take the pass-1 compile's ELF (its
# .bss cannot move with a #define change, which build.sh asserts; here the
# probe only reads __heap_start back out of that ELF).
OUT="$SCRATCH/engine" STAGE="$SCRATCH/engine/hutrack-stage" \
  ENGINE_ZP_BASE=0x2080 ENGINE_BSS_BASE=0x2200 \
  tools/ilvm/build-engine.sh > "$SCRATCH/build-engine-p1.log"

# #222: the same size flags build.sh uses, so the probe image fits the two
# 16 KiB banks with the probe block added.
"$CC" -Os -Wl,--icf=all -mllvm -inline-threshold=50 -DTOY_STACK_PROBE \
  -mlto-zp=96 -Itools/toyc -Itools/gen \
  -Wl,--defsym,__rom_bank0=0xc000 \
  -Wl,--defsym,__rom_bank0_size=0x4000 \
  -o "$SCRATCH/probe.pce" tools/ilvm/ilvm_runtime.c tools/ilvm/ilvm.c \
  tools/ilvm/ilvm_sound.c
BYTES=$(wc -c < "$SCRATCH/probe.pce" | tr -d ' ')
if [ "$BYTES" != "16384" ]; then
  echo "probe image is $BYTES bytes; expected 16384" >&2
  exit 1
fi
BUDGET=$(python3 -I - "$LLVM_MOS" "$SCRATCH/probe.pce.elf" <<'PY'
import subprocess
import sys
llvm, elf = sys.argv[1:3]
heap = low = None
for line in subprocess.run([llvm + "/bin/llvm-nm", elf],
                           capture_output=True, text=True).stdout.splitlines():
    parts = line.split()
    if len(parts) == 3 and parts[2] == "__heap_start":
        heap = int(parts[0], 16) & 0xFFFF
    elif len(parts) == 3 and parts[2] == "probe_low":
        low = int(parts[0], 16) & 0xFFFF
if heap is None or low is None:
    raise SystemExit("no __heap_start/probe_low in " + elf)
print("0x%04X 0x%04X" % (heap, low))
PY
)
HEAP=${BUDGET%% *}
LOW_ADDR=${BUDGET##* }

OUT="$SCRATCH/engine" STAGE="$SCRATCH/engine/hutrack-stage" \
  ENGINE_ZP_BASE=0x2080 ENGINE_BSS_BASE="$HEAP" \
  tools/ilvm/build-engine.sh > "$SCRATCH/build-engine.log"
cat "$SCRATCH/probe.pce" "$SCRATCH/engine/hutrack-code.bin" \
    "$SCRATCH/engine/hutrack-tables.bin" > "$SCRATCH/probe-ilvm.bin"
BYTES=$(wc -c < "$SCRATCH/probe-ilvm.bin" | tr -d ' ')
if [ "$BYTES" != "32768" ]; then
  echo "probe image is $BYTES bytes; expected 32768" >&2
  exit 1
fi

echo "== ROM: $TOY"
node -e '
const fs = require("fs"), path = require("path");
const il = require("./renderer/pce-il.js");
const ilbc = require("./renderer/pce-ilbc.js");
const rom = require("./renderer/pce-rom.js");
const [toy, bank0Path, outPath] = process.argv.slice(1);
const program = il.compile(fs.readFileSync(toy, "utf8"),
                           { chunkName: path.basename(toy) });
const encoded = ilbc.encode(program);
fs.writeFileSync(outPath, Buffer.from(rom.buildToyRom({
  bank0: fs.readFileSync(bank0Path), bytecode: encoded.bytes })));
console.log("  bytecode " + encoded.bytes.length + " B");
' "$TOY" "$SCRATCH/probe-ilvm.bin" "$SCRATCH/canary.pce"

echo "== mednafen ($VIDEO_DRIVER)"
export MEDNAFEN_HOME="$SCRATCH/mednafen"
MCSDIR="$MEDNAFEN_HOME/mcs"
mkdir -p "$MCSDIR"
START=$(date +%s)
mednafen -force_module pce -video.driver "$VIDEO_DRIVER" \
  -pce.slstart 3 -pce.slend 234 -pce.xscale 1 -pce.yscale 1 \
  -autosave 1 "$SCRATCH/canary.pce" > "$SCRATCH/mednafen.log" 2>&1 &
MDPID=$!
sleep "$SLEEP"
kill -INT "$MDPID" 2>/dev/null || true
for i in $(seq 1 30); do
  kill -0 "$MDPID" 2>/dev/null || break
  sleep 1
done
kill -9 "$MDPID" 2>/dev/null || true

new_mcs=""
for i in $(seq 1 10); do
  new_mcs=$(ls -t "$MCSDIR"/*.mca 2>/dev/null | head -1 || true)
  if [ -n "$new_mcs" ] && [ "$(stat -f%m "$new_mcs")" -ge "$START" ]; then
    break
  fi
  new_mcs=""
  sleep 1
done
if [ -z "$new_mcs" ]; then
  echo "no autosave state in $MCSDIR" >&2
  exit 1
fi

python3 -I tools/mcs-extract.py "$new_mcs" "$SCRATCH/dump" 3 --ram >/dev/null

python3 -I - <<PY
import json
import struct

S = "$SCRATCH"
ram = open(S + "/dump/ram.bin", "rb").read()
addr = int("$LOW_ADDR", 0)
low = struct.unpack_from("<H", ram, addr - 0x2000)[0]  # probe_low (.bss)
if low == 0:
    raise SystemExit("the probe never ran: probe_low is still zero")
depth = 0x4000 - low
engine = json.load(open(S + "/engine/hutrack-image.json"))["ram"]
bss_end = engine["bss"]["end"]
headroom = 0x4000 - bss_end
print("== stack canary")
print("  toy                %s" % "$TOY")
print("  lowest exec frame  \$%04X" % low)
print("  stack high-water   %d B" % depth)
print("  engine .bss        \$%04X-\$%04X (%d B)" %
      (engine["bss"]["start"], bss_end, engine["bss"]["bytes"]))
print("  stack headroom     %d B" % headroom)
if depth >= headroom:
    raise SystemExit("the stack high-water mark reaches the engine block: "
                     "%d B used of %d B" % (depth, headroom))
print("  PASS: %d B of headroom left" % (headroom - depth))
PY
