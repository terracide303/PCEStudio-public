#!/bin/bash
# build-toyc-banked.sh — a Lua toy through IL -> C -> banked C -> llvm-mos -> a .pce,
# its functions in switched 8 KiB ROM banks (compiler step 1, docs/NATIVE.md).
#
#   tools/build-toyc-banked.sh toys/tower/main.lua [name]
#
# Same inputs and tools as tools/build-toyc.sh; the output is tools/gen/NAME.pce.
# Sounds are not linked (no native sound engine yet): a toy that calls sfx()
# needs SILENT_SFX=1, which links a do-nothing toy_sfx for measuring only.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${1:?usage: tools/build-toyc-banked.sh TOY.lua [NAME]}"
NAME="${2:-$(basename "$(dirname "$SRC")")-banked}"
LLVM_MOS="${LLVM_MOS:-/Volumes/External II/pce-tools/llvm-mos/llvm-mos}"
CC="$LLVM_MOS/bin/mos-pce-clang"
[ -x "$CC" ] || { echo "llvm-mos not found at $LLVM_MOS (set LLVM_MOS)" >&2; exit 2; }
G="tools/gen/$NAME"
mkdir -p tools/gen
node tools/toyc/emit.js "$SRC" "$G.c"
EXTRA=""
grep -q "void toy_raster(int32_t line)" "$G.c" && EXTRA="-DTOY_RASTER_BUILD"
grep -qE "toy_pad\(|toy_timer_set\(|toy_sat\(|toy_sprite\(" "$G.c" && EXTRA="$EXTRA -DTOY_INPUT_BUILD"
if [ "${SILENT_SFX:-0}" = "1" ]; then
  printf '#include <stdint.h>\nstatic inline void toy_sfx(int32_t a,int32_t b,int32_t c,int32_t d){(void)a;(void)b;(void)c;(void)d;}\n' > "$G.silent.h"
  EXTRA="$EXTRA -include $G.silent.h"
fi
"$CC" -Os $EXTRA -fno-lto -c -Itools/toyc -o "$G.o" "$G.c"
set +e
OUT=$(python3 -I tools/bank-toyc.py "$G.c" "$G.o" "$G.banked.c" "$LLVM_MOS")
RC=$?
set -e
if [ $RC -eq 4 ]; then
  # a function larger than one bank: emit it again with those functions split
  # into chunks (pce-cgen.js), then pack once more
  IDS="${OUT#SPLIT }"
  echo "splitting functions $IDS"
  PCE_SPLIT_ONLY="$IDS" PCE_SPLIT_OVER=1 node tools/toyc/emit.js "$SRC" "$G.c"
  "$CC" -Os $EXTRA -fno-lto -c -Itools/toyc -o "$G.o" "$G.c"
  OUT=$(python3 -I tools/bank-toyc.py "$G.c" "$G.o" "$G.banked.c" "$LLVM_MOS")
elif [ $RC -ne 0 ]; then
  echo "$OUT" >&2; exit $RC
fi
BANKS=$(echo "$OUT" | sed -n 's/^BANKS //p')
DEFS=""
for b in $(seq 1 "$BANKS"); do DEFS="$DEFS -Wl,--defsym=__rom_bank${b}_size=0x2000"; done
"$CC" -Os $EXTRA $DEFS -Itools/toyc -o "$G.pce" tools/toyc/toy_runtime.c "$G.banked.c"
echo "$G.pce  $(wc -c < "$G.pce") bytes, $BANKS switched banks"
