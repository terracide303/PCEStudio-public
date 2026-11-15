#!/bin/bash
# build-toyc-banked.sh — a Lua toy through IL -> C -> banked C -> llvm-mos -> a .pce,
# its functions in switched 8 KiB ROM banks (compiler step 1, docs/NATIVE.md).
#
#   tools/build-toyc-banked.sh toys/tower/main.lua [name]
#
# Same inputs and tools as tools/build-toyc.sh; the output is tools/gen/NAME.pce.
#
# A toy that calls music(), sfx(), release() or note() gets the sound engine
# (docs/NATIVE-SOUND.md, option C): the interpreter ROM's HuTrack engine and
# its sound glue in physical banks 2 and 3, the song bank in 4, the toy's code
# banks around them (1, 5, 6, ...), the compiler's zero page held to 96 bytes
# so the engine's own zero page starts at $2080, and the engine's RAM placed
# after the program's (two passes, as tools/ilvm/build.sh does).  Needs PCEAS
# 4.x for the engine (PCEAS4=, default pceas4, then the huc-toyc copy).
#   PSG_TRACE=1   the engine's test-only PSG write log (tests/check-native-sound.js)
#   SILENT_SFX=1  link a do-nothing toy_sfx instead of the engine (measuring only)
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
EXTRA="-DTOY_HOLD_BUILD"   # hold frame()'s scroll/control/colour writes for the next VBlank (tools/toyc/toy_runtime.c)
[ "${NO_HOLD:-0}" = "1" ] && EXTRA=""   # NO_HOLD=1: the old behaviour, for tests/check-native-vblank.js's control
grep -q "void toy_raster(int32_t line)" "$G.c" && EXTRA="$EXTRA -DTOY_RASTER_BUILD"
grep -q "toy_raster_entry(" "$G.c" && EXTRA="$EXTRA -DTOY_RASTER_BUILD -DTOY_RASTER_TABLE"
grep -qE "toy_pad\(|toy_timer_set\(|toy_sat\(|toy_sprite\(" "$G.c" && EXTRA="$EXTRA -DTOY_INPUT_BUILD"
SOUND=0
SRCS="tools/toyc/toy_runtime.c $G.banked.c"
if grep -q '#include "toy_sound.h"' "$G.c"; then
  if [ "${SILENT_SFX:-0}" = "1" ]; then
    # a measuring stand-in: the sound calls do nothing
    cat > "$G.silent.h" <<'H'
#include <stdint.h>
static inline void toy_sound_boot(void){}
static inline void toy_sound_tick(void){}
static inline int32_t toy_note(int32_t m){(void)m;return 0;}
static inline void toy_sfx(int32_t a,int32_t b,int32_t c,int32_t d){(void)a;(void)b;(void)c;(void)d;}
static inline void toy_release(int32_t a){(void)a;}
static inline void toy_music(int32_t a){(void)a;}
H
    sed -i.bak 's|#include "toy_sound.h"|#include "'"$(basename "$G").silent.h"'"|' "$G.c" && rm -f "$G.c.bak"
    EXTRA="$EXTRA -Itools/gen"
  else
    SOUND=1
    for c in "${PCEAS4:-}" "$HOME/.local/bin/pceas4" "/Volumes/External II/pce-tools/huc-toyc/bin/pceas"; do
      [ -n "$c" ] && [ -x "$c" ] && { export PCEAS4="$c"; break; }
    done
    [ -n "${PCEAS4:-}" ] || { echo "PCEAS 4.x not found (set PCEAS4)" >&2; exit 2; }
    export TMPDIR="${TMPDIR:-/tmp}"
    export BANK_IDS="1,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30"
    ENG="$G.eng"; mkdir -p "$ENG"
    # pass 1: the engine at a placeholder RAM base, for the header the C needs
    # ENGINE_BASES="0x2400 0x2800 ..." (the native build kit, docs/NATIVE-KIT.md): the engine's RAM
    # base is the smallest listed base at or above the program's __heap_start, so a prebuilt image
    # exists for it.  Unset: the engine goes exactly at __heap_start, as before.
    FIRST_BASE="0x2200"; [ -n "${ENGINE_BASES:-}" ] && FIRST_BASE="${ENGINE_BASES%% *}"
    ENGINE_ZP_BASE=0x2080 ENGINE_BSS_BASE=$FIRST_BASE OUT="$ENG" tools/ilvm/build-engine.sh >/dev/null
    EXTRA="$EXTRA -I$ENG -Itools/toyc -mlto-zp=96"
    SRCS="$SRCS tools/toyc/toy_sound.c"
  fi
fi
compile_obj() { "$CC" ${OPT:--Os} $EXTRA -fno-lto -c -Itools/toyc -o "$G.o" "$G.c"; }
compile_obj
set +e
OUT=$(python3 -I tools/bank-toyc.py "$G.c" "$G.o" "$G.banked.c" "$LLVM_MOS")
RC=$?
set -e
if [ $RC -eq 4 ]; then
  # a function larger than one bank: emit it again with those functions split
  # into chunks (pce-cgen.js), then pack once more
  IDS="${OUT#SPLIT }"
  echo "splitting functions $IDS"
  # a dense chunk can still be larger than a bank: try smaller chunks (instructions per chunk)
  for CH in ${PCE_SPLIT_CHUNK:-100} 60 40 25; do
    PCE_SPLIT_ONLY="$IDS" PCE_SPLIT_OVER=1 PCE_SPLIT_CHUNK="$CH" node tools/toyc/emit.js "$SRC" "$G.c"
    [ "${SILENT_SFX:-0}" = "1" ] && sed -i.bak 's|#include "toy_sound.h"|#include "'"$(basename "$G").silent.h"'"|' "$G.c" && rm -f "$G.c.bak"
    compile_obj
    set +e
    OUT=$(python3 -I tools/bank-toyc.py "$G.c" "$G.o" "$G.banked.c" "$LLVM_MOS" 2>"$G.pack.err")
    RC2=$?
    set -e
    [ $RC2 -eq 0 ] && break
    grep -q "chunk is larger" "$G.pack.err" || { cat "$G.pack.err" >&2; echo "$OUT" >&2; exit $RC2; }
    echo "a chunk of $CH instructions is larger than a bank; trying smaller chunks" >&2
  done
  [ $RC2 -ne 0 ] && { cat "$G.pack.err" >&2; echo "$OUT" >&2; exit $RC2; }
elif [ $RC -ne 0 ]; then
  echo "$OUT" >&2; exit $RC
fi
BANKS=$(echo "$OUT" | sed -n 's/^BANKS //p')
# the toy's art (tiles.json, palettes.json, sprites.json beside the Lua): data banks after the code banks
if grep -q '#include "toy_assets.h"' "$G.c"; then
  LAST=0; for b in $BANKS; do [ "$b" -gt "$LAST" ] && LAST=$b; done
  [ "$LAST" -lt 4 ] && LAST=4
  ART=$(node tools/native-assets.js "$(dirname "$SRC")" $((LAST + 1)) "$G.art.c")
  case "$ART" in
    BANKS*) BANKS="$BANKS ${ART#BANKS }"; SRCS="$SRCS $G.art.c tools/toyc/toy_assets.c"; EXTRA="$EXTRA -DTOY_INPUT_BUILD -Itools/toyc" ;;
    *) echo "the toy has art files but the importer read none" >&2; exit 1 ;;
  esac
fi
DEFS=""
for b in $BANKS; do DEFS="$DEFS -Wl,--defsym=__rom_bank${b}_size=0x2000"; done
link() { "$CC" ${OPT:--Os} $EXTRA $DEFS ${LINK_EXTRA:-} -Itools/toyc -o "$G.pce" $SRCS; }
# the packer sizes functions from a non-LTO object, which can understate the linked size:
# if a bank overflows, start again with more slack in each bank (1, 2, 3 and 4 KiB)
if ! LINKLOG=$(link 2>&1); then
  if echo "$LINKLOG" | grep -q "will not fit in region 'rom_bank[1-9]" && [ "${BANK_SLACK:-1024}" -lt 4096 ]; then
    NEXT=$(( ${BANK_SLACK:-1024} + 1024 )); echo "a bank overflowed; repacking with $NEXT bytes of slack" >&2
    [ -n "${NO_RETRY:-}" ] && { echo "$LINKLOG" >&2; exit 1; }
    BANK_SLACK=$NEXT exec "$0" "$@"
  fi
  if echo "$LINKLOG" | grep -q "region 'rom_bank0'" && [ "${BANK_PIN_HOT:-1}" != "0" ]; then
    echo "the fixed page is full: not pinning the raster hook there" >&2
    BANK_PIN_HOT=0 exec "$0" "$@"
  fi
  echo "$LINKLOG" >&2; exit 1
fi
if [ $SOUND -eq 1 ]; then
  measure() {   # prints "ZP_END HEAP_START" of the linked ELF
    python3 -I - "$LLVM_MOS" "$G.pce.elf" <<'PY'
import subprocess, sys
llvm, elf = sys.argv[1:3]
zp_end = 0
for l in subprocess.run([llvm + "/bin/llvm-objdump", "-h", elf], capture_output=True, text=True).stdout.splitlines():
    p = l.split()
    if len(p) >= 4 and p[1] in (".zp.bss", ".zp"):
        try: zp_end = max(zp_end, (int(p[3], 16) & 0xFFFF) + int(p[2], 16))
        except ValueError: pass
heap = None
for l in subprocess.run([llvm + "/bin/llvm-nm", elf], capture_output=True, text=True).stdout.splitlines():
    p = l.split()
    if len(p) == 3 and p[2] == "__heap_start": heap = int(p[0], 16) & 0xFFFF
if not zp_end or heap is None: sys.exit("cannot read zero page end or heap start from " + elf)
print("0x%04X 0x%04X" % (zp_end, heap))
PY
  }
  B=$(measure); ZPE=${B%% *}; HEAP=${B##* }
  [ $((ZPE)) -le $((0x2080)) ] || { echo "the toy's zero page ends at $ZPE, past the engine's \$2080" >&2; exit 1; }
  # pass 2: the engine against the measured heap, then the final link against its header
  if [ -n "${ENGINE_BASES:-}" ]; then
    PICK=""
    for cand in $ENGINE_BASES; do [ $((cand)) -ge $((HEAP)) ] && { PICK=$cand; break; }; done
    [ -n "$PICK" ] || { echo "no engine base in ENGINE_BASES fits the heap at $HEAP" >&2; exit 1; }
    HEAP=$PICK
  fi
  ENGINE_ZP_BASE=0x2080 ENGINE_BSS_BASE=$HEAP OUT="$ENG" PSG_TRACE="${PSG_TRACE:-0}" tools/ilvm/build-engine.sh >/dev/null
  link
  B2=$(measure)
  [ "$B2" = "$B" ] || { echo "the final link moved the RAM partition ($B -> $B2)" >&2; exit 1; }
  # the engine's RAM must leave room for the soft stack below $4000
  END=$(python3 -I -c "import json;d=json.load(open('$ENG/hutrack-image.json'));print(d['ram']['bss']['end'])")
  [ "$END" -le $((0x3E00)) ] || { echo "the engine's RAM ends at $END, over \$3E00 (no room for the stack)" >&2; exit 1; }
  # bank 2 = engine code, 3 = pitch tables and glue, 4 = the song bank: the songs
  # of the toy's folder (song.json, songs.json) and their trailer, or zeros
  node tools/native-songs.js "$(dirname "$SRC")" "$G.songs.bin" | tail -1
  python3 -I - "$G.pce" "$ENG/hutrack-code.bin" "$ENG/hutrack-tables.bin" "$G.songs.bin" <<'PY'
import sys
rom, code, tables, songs = sys.argv[1:5]
d = bytearray(open(rom, "rb").read())
need = 5 * 8192
if len(d) < need: d += b"\xff" * (need - len(d))
for bank, blob in ((2, code), (3, tables)):
    b = open(blob, "rb").read()
    assert len(b) == 8192, blob
    assert set(d[bank*8192:(bank+1)*8192]) <= {0xff, 0x00}, "bank %d is not empty in the linked ROM" % bank
    d[bank*8192:(bank+1)*8192] = b
assert set(d[4*8192:5*8192]) <= {0xff, 0x00}, "bank 4 is not empty in the linked ROM"
sb = open(songs, "rb").read()
assert len(sb) == 8192, songs
d[4*8192:5*8192] = sb
open(rom, "wb").write(d)
PY
fi
echo "$G.pce  $(wc -c < "$G.pce") bytes, switched banks: $BANKS$([ $SOUND -eq 1 ] && echo ', with the sound engine')"
