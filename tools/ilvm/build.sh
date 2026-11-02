#!/bin/bash
# build.sh — build the IL bytecode interpreter ONCE (card #100).
#
#   tools/ilvm/build.sh
#
# Produces renderer/ilvm.bin: the fixed 32 KiB HuCard image that every toy
# ROM's banks 0-3 are made of.  The browser glues it to a toy's bytecode with
# renderer/pce-rom.js's buildToyRom() and never runs a compiler, so this
# image is a committed artefact exactly like renderer/viewer-bank0.bin.
#
# Why the first 16 KiB: the interpreter plus the proven #31 runtime is ~6 KB
# of code, and llvm-mos's PCE platform places a fixed ROM of up to 48 KiB
# contiguous at $C000-$FFFF (MPR6 = 1 at reset for a 16 KiB fixed image;
# crt0's __start_bank_6 is 1, see link.ld).  Physical bank 0 ($E000-$FFFF)
# holds the vectors and startup; physical bank 1 ($C000-$DFFF) holds the
# interpreter.
#
# #213 appends the HuTrack engine built by build-engine.sh: physical bank 2
# (page 5, $A000-$BFFF) is the engine code and physical bank 3 (page 4,
# $8000-$9FFF) its pitch tables.  Two whole banks because the pitch code
# maps the tables to page 4 while executing from page 5 (docs/ROM-SOUND.md
# §1-2).  The toy's bytecode moves to physical bank 4, which ilvm.c maps
# into MPR2 ($4000-$5FFF) with TAM #$04.
#
# #214 spends the RAM before the engine calls into it, and asserts the
# result.  The interpreter is compiled with -mlto-zp=96 so its zero page
# ends at $2080; the engine's 94 B of zero page start there.  Its .bss is
# placed at the interpreter's measured __heap_start, and the stack headroom
# ($4000 - the last engine byte) must keep the 787 B margin docs/ROM-SOUND.md
# §5 names.  The build reads both facts from the built ELF, prints the
# partition, writes it to tools/gen/ilvm.json's ram_budget, and exits
# non-zero if either budget is broken.  The stack high-water mark itself is
# measured by tools/ilvm/stack-canary.sh, not here.
#
# #215 makes the C and the engine need each other's outputs: ilvm_sound.c
# calls the engine's fixed addresses (the generated hutrack-symbols.h) and
# the engine's .bss base is the C image's measured __heap_start.  The build
# resolves the cycle in two passes (see the comment at compile time below)
# and asserts the second compile lands on the same RAM partition.
#
# Needs the prebuilt llvm-mos SDK (external, never vendored — the PCEAS rule
# in docs/DECISIONS.md): /Volumes/External II/pce-tools/llvm-mos/llvm-mos,
# override with LLVM_MOS.
#
# Writes renderer/ilvm.bin and tools/gen/ilvm.json (sha, size, section and
# symbol bytes).  tests/check-ilvm.js rebuilds it and compares the SHA when
# the toolchains are present; without llvm-mos or PCEAS 4.x it prints SKIP,
# the same rule as the other PCEAS/llvm rebuild checks.
#
# #200's trace build (docs/ROM-SOUND.md §8):
#   TRACE=1 BIN=/scratch/ilvm-trace.bin tools/ilvm/build.sh
# assembles the test-only PSG write log and refuses to write the shipped
# image.  tools/gen/hutrack-image.json's psg_trace block carries the log's
# BaseRAM addresses; tests/check-rom-sound.js builds and runs it.
set -euo pipefail
cd "$(dirname "$0")/../.."

LLVM_MOS="${LLVM_MOS:-/Volumes/External II/pce-tools/llvm-mos/llvm-mos}"
[ -x "$LLVM_MOS/bin/mos-pce-clang" ] || { [ -x /Volumes/External/pce-tools/llvm-mos/bin/mos-pce-clang ] && LLVM_MOS=/Volumes/External/pce-tools/llvm-mos; }
CC="$LLVM_MOS/bin/mos-pce-clang"
OUT=tools/gen/ilvm.pce

if [ ! -x "$CC" ]; then
  echo "llvm-mos not found at $LLVM_MOS (set LLVM_MOS to the SDK root)" >&2
  exit 2
fi
if ! command -v "${PCEAS4:-pceas4}" >/dev/null 2>&1 && \
   [ ! -x "${PCEAS4:-pceas4}" ]; then
  echo "PCEAS 4.x not found: set PCEAS4 or install pceas4 (docs/BUILD.md)" >&2
  exit 2
fi

mkdir -p tools/gen
# #214: -mlto-zp=96 is the zero-page budget the interpreter is allowed, and
# the first half of the HuTrack partition.  The SDK's driver config sets
# -mlto-zp=224 (the whole page at $2020-$20FF); the flag is the driver's own
# switch, so the LTO backend places at most 96 B of the interpreter's
# variables at $2020-$207F and the engine's 94 B take $2080-$20DD.  The
# assertions below read the built ELF, so a toolchain that ignores the flag
# fails the build instead of silently overlapping the engine.
#
# #215's chicken-and-egg, resolved in two passes: ilvm_sound.c calls the
# engine's fixed addresses from tools/gen/hutrack-symbols.h, and the engine's
# .bss base is the C image's __heap_start — which needs a built C image.
# Only the RAM addresses in the header move with the base (HUTRACK_HK_EAX0
# lives in the engine .bss); the code addresses are fixed, and a #define
# cannot change the C image's .bss size.  So:
#   1. build-engine.sh pass 1 against the placeholder base $2200 — the code
#      addresses are already final, the RAM addresses are not;
#   2. compile the interpreter against that header and measure zp_end and
#      __heap_start from the built ELF;
#   3. build-engine.sh pass 2 against the measured heap — the final header;
#   4. compile again with the final header.  The .bss size (and therefore
#      __heap_start) cannot have moved, and the build asserts it did not.
ENGINE_ZP_BASE=0x2080      # docs/ROM-SOUND.md §5's engine zero-page base
STACK_MARGIN=787           # docs/ROM-SOUND.md §5's stack headroom floor
# #200: TRACE=1 builds the test-only PSG write trace (docs/ROM-SOUND.md §8)
# with 307 B of BaseRAM for the log; it must never replace the shipped image,
# so BIN is required to point outside renderer/ilvm.bin.  The partition
# assertions still run: the trace build keeps the 787 B margin (855 B).
TRACE="${TRACE:-0}"
BIN="${BIN:-renderer/ilvm.bin}"
if [ "$TRACE" = "1" ] && [ "$BIN" = "renderer/ilvm.bin" ]; then
  echo "TRACE=1 refuses to overwrite renderer/ilvm.bin; set BIN to a" \
       "scratch path (docs/ROM-SOUND.md §8)" >&2
  exit 2
fi

# Pass 1: the engine with a placeholder .bss base, just to get the header's
# code addresses (build-engine.sh also verifies the note table and the
# patch sites, so both passes prove them).
ENGINE_ZP_BASE=$ENGINE_ZP_BASE ENGINE_BSS_BASE=0x2200 PSG_TRACE="$TRACE" \
  tools/ilvm/build-engine.sh >/dev/null

compile_c() {   # $1 = output path
  # #222: the fixed bank holds 16,339 B before .early_start (link.ld pins it
  # at 0xffd3); the capacity work added ~320 B.  ICF folds identical
  # functions and an inline threshold of 50 keeps LTO from expanding the
  # closure/constant helpers — together they recover the ~30 B needed.
  # build.sh asserts the image is 16,384 B, so a future growth fails here.
  "$CC" -Os -Wl,--icf=all -mllvm -inline-threshold=50 -mlto-zp=96 \
    -Itools/toyc -Itools/gen \
    -Wl,--defsym,__rom_bank0=0xc000 \
    -Wl,--defsym,__rom_bank0_size=0x4000 \
    -o "$1" tools/ilvm/ilvm_runtime.c tools/ilvm/ilvm.c tools/ilvm/ilvm_sound.c
}

compile_c "$OUT"
BYTES=$(wc -c < "$OUT" | tr -d ' ')
if [ "$BYTES" != "16384" ]; then
  echo "ilvm image is $BYTES bytes; expected 16384 (2 physical banks)" >&2
  exit 1
fi

# #214: the two RAM facts the partition needs, read from the interpreter's
# own ELF (not from a constant in this script): where its zero page ends, and
# where its .bss/heap start.  build-engine.sh places the engine against them.
measure_budget() {   # $1 = the ELF; prints "ZP_END HEAP_START"
python3 -I - "$LLVM_MOS" "$1" <<'PY'
import subprocess
import sys

llvm, elf = sys.argv[1:3]

# .zp.bss and .zp are where the LTO backend put the interpreter's
# zero-page variables; their end is the page's claim on $2020-$20FF.  The
# ELF's VMA is 0x00f820xx (the PCE's RAM mirror), so mask to 16 bits.
zp_end = 0
for line in subprocess.run([llvm + "/bin/llvm-objdump", "-h", elf],
                           capture_output=True, text=True).stdout.splitlines():
    parts = line.split()
    if len(parts) >= 4 and parts[1] in (".zp.bss", ".zp"):
        try:
            end = (int(parts[3], 16) & 0xFFFF) + int(parts[2], 16)
        except ValueError:
            continue
        zp_end = max(zp_end, end)

heap = None
for line in subprocess.run([llvm + "/bin/llvm-nm", elf],
                           capture_output=True, text=True).stdout.splitlines():
    parts = line.split()
    if len(parts) == 3 and parts[2] == "__heap_start":
        heap = int(parts[0], 16) & 0xFFFF

if not zp_end or heap is None:
    raise SystemExit("cannot read the interpreter's zero page or heap start "
                     "from %s" % elf)
print("0x%04X 0x%04X" % (zp_end, heap))
PY
}
BUDGET=$(measure_budget tools/gen/ilvm.pce.elf)
ZP_END=${BUDGET%% *}
HEAP_START=${BUDGET##* }
if [ $((ZP_END)) -gt $((ENGINE_ZP_BASE)) ]; then
  echo "interpreter zero page ends at $ZP_END, past the engine's $ENGINE_ZP_BASE" >&2
  exit 1
fi

# Pass 2: the engine against the measured heap — the final header — then the
# final C image against it.  The second compile must land on the same
# zp_end/__heap_start the engine was placed from, or the chicken-egg broke.
ENGINE_ZP_BASE=$ENGINE_ZP_BASE ENGINE_BSS_BASE=$HEAP_START \
  PSG_TRACE="$TRACE" tools/ilvm/build-engine.sh

cp "$OUT" "$OUT.pass1"
compile_c "$OUT"
BUDGET2=$(measure_budget tools/gen/ilvm.pce.elf)
ZP_END2=${BUDGET2%% *}
HEAP_START2=${BUDGET2##* }
if [ "$ZP_END2" != "$ZP_END" ] || [ "$HEAP_START2" != "$HEAP_START" ]; then
  echo "the final compile moved the RAM partition ($ZP_END/$HEAP_START ->" \
       "$ZP_END2/$HEAP_START2); the two-pass build broke" >&2
  exit 1
fi
rm -f "$OUT.pass1"

ENGINE_CODE=tools/gen/hutrack-code.bin
ENGINE_TABLES=tools/gen/hutrack-tables.bin
for bank in "$ENGINE_CODE" "$ENGINE_TABLES"; do
  BANK_BYTES=$(wc -c < "$bank" | tr -d ' ')
  if [ "$BANK_BYTES" != "8192" ]; then
    echo "$bank is $BANK_BYTES bytes; expected 8192 (one physical bank)" >&2
    exit 1
  fi
done

# The image is a byte concatenation only: llvm-mos owns banks 0-1, PCEAS owns
# banks 2-3, and neither toolchain links the other (docs/ROM-SOUND.md §1).
cat "$OUT" "$ENGINE_CODE" "$ENGINE_TABLES" > "$BIN"
BYTES=$(wc -c < "$BIN" | tr -d ' ')
if [ "$BYTES" != "32768" ]; then
  echo "ilvm image is $BYTES bytes; expected 32768 (4 physical banks)" >&2
  exit 1
fi

python3 -I - "$LLVM_MOS" "$OUT" tools/gen/ilvm.pce.elf "$BIN" \
  "$ZP_END" "$HEAP_START" "$ENGINE_ZP_BASE" "$STACK_MARGIN" <<'PY'
import hashlib
import json
import subprocess
import sys

llvm, rom, elf, binpath, zp_end, heap, engine_zp_base, stack_margin = \
    sys.argv[1:9]
zp_end = int(zp_end, 0)
heap = int(heap, 0)
engine_zp_base = int(engine_zp_base, 0)
stack_margin = int(stack_margin, 0)

def sha(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()

def run(args):
    return subprocess.run(args, capture_output=True, text=True).stdout

sizes = {}
for line in run([llvm + "/bin/llvm-size", elf]).splitlines():
    parts = line.split()
    if (len(parts) >= 4 and parts[0].isdigit() and parts[1].isdigit()
            and parts[2].isdigit()):
        sizes = {"text": int(parts[0]), "data": int(parts[1]),
                 "bss": int(parts[2])}
        break

# llvm-mos 24's `llvm-objdump -h` prints five columns (idx name size vma
# type); older builds print flags as well.  Read the size from column 2 and
# require only that column to be present, so a toolchain with or without the
# trailing columns records the same table (#175: before this fix the whole
# section_sizes map came out empty on llvm-mos 24).
section_sizes = {}
for line in run([llvm + "/bin/llvm-objdump", "-h", elf]).splitlines():
    parts = line.split()
    if len(parts) >= 3 and parts[0].isdigit() and parts[1].startswith("."):
        try:
            section_sizes[parts[1]] = int(parts[2], 16)
        except ValueError:
            pass

symbols = {}
for line in run([llvm + "/bin/llvm-nm", "--print-size", "--size-sort",
                 elf]).splitlines():
    parts = line.split()
    if len(parts) >= 4:
        try:
            symbols[parts[3]] = {"size": int(parts[1], 16),
                                 "address": int(parts[0], 16),
                                 "section": parts[2]}
        except ValueError:
            pass

functions = {name: symbols[name]["size"] for name in symbols if name in (
    "exec", "toy_boot", "toy_frame", "toy_raster", "main",
    "ilvm_has_raster", "operand", "lua_mod", "lua_idiv",
    "ilvm_sound_tick", "ilvm_note", "ilvm_sfx", "ilvm_music")}

# #175: the table pool is ilvm.c's static `cells` array, placed by the linker
# in .bss.  Record it by name so the section sizes can be read as
# "heap + pool": 192 int32 cells = 768 B (#214).
table_pool = {"symbol": "cells", "section": None, "address": None,
              "bytes": 0, "cells": None}
if "cells" in symbols:
    table_pool.update(section=symbols["cells"]["section"],
                      address=symbols["cells"]["address"],
                      bytes=symbols["cells"]["size"])
    table_pool["cells"] = table_pool["bytes"] // 4
    # nm prints a section letter; spell it so the report reads without nm.
    table_pool["section"] = {"b": ".bss", "d": ".data",
                             "t": ".text"}.get(table_pool["section"],
                                               table_pool["section"])

# #214: the RAM partition, asserted here rather than in a note.  The
# interpreter's measured zero-page end must not reach the engine's base; the
# engine's measured extents must stay inside the page and below the stack;
# and the stack headroom ($4000 - the last engine byte) must keep the margin
# docs/ROM-SOUND.md §5 names.  A toolchain change, a model change or a grown
# table fails the build instead of shipping an image that overlaps.
engine = json.load(open("tools/gen/hutrack-image.json"))
ram = engine["ram"]
eng_zp = ram["zero_page"]
eng_bss = ram["bss"]

errors = []
if zp_end > engine_zp_base:
    errors.append("interpreter zero page ends at $%04X, past the engine's "
                  "$%04X" % (zp_end, engine_zp_base))
if eng_zp["start"] != engine_zp_base:
    errors.append("engine zero page starts at $%04X, not $%04X" %
                  (eng_zp["start"], engine_zp_base))
if eng_zp["end"] > 0x2100:
    errors.append("engine zero page ends at $%04X, past the zero page" %
                  eng_zp["end"])
if eng_bss["start"] < heap:
    errors.append("engine .bss starts at $%04X, below the interpreter's heap "
                  "start $%04X" % (eng_bss["start"], heap))
if eng_bss["end"] > 0x4000:
    errors.append("engine .bss ends at $%04X, past the stack base" %
                  eng_bss["end"])
headroom = 0x4000 - eng_bss["end"]
if headroom < stack_margin:
    errors.append("stack headroom is %d B, under the %d B margin docs/"
                  "ROM-SOUND.md names" % (headroom, stack_margin))
if errors:
    for e in errors:
        print("budget: " + e, file=sys.stderr)
    raise SystemExit(1)

budget = {
    "zero_page": {
        "interpreter_start": 0x2020,
        "interpreter_end": zp_end,
        "interpreter_bytes": zp_end - 0x2020,
        "engine_start": eng_zp["start"],
        "engine_end": eng_zp["end"],
        "engine_bytes": eng_zp["bytes"],
        "free_bytes": 0x2100 - eng_zp["end"],
    },
    "base_ram": {
        "interpreter_heap_start": heap,
        "engine_start": eng_bss["start"],
        "engine_end": eng_bss["end"],
        "engine_bytes": eng_bss["bytes"],
        "stack_base": 0x4000,
        "stack_headroom": headroom,
        "stack_margin": stack_margin,
    },
}

out = {
    "image": binpath,
    "rom": rom,
    "bytes": len(open(binpath, "rb").read()),
    "sha256": sha(binpath),
    "llvm_bytes": len(open(rom, "rb").read()),
    "llvm_sha256": sha(rom),
    "bank0": "physical 0 ($E000-$FFFF: vectors, startup, runtime)",
    "bank1": "physical 1 ($C000-$DFFF: the interpreter)",
    "bank2": "physical 2 ($A000-$BFFF: HuTrack engine code, #213)",
    "bank3": "physical 3 ($8000-$9FFF: HuTrack pitch + note tables, #213/#215)",
    "data_bank": "physical 4, appended per toy by renderer/pce-rom.js",
    "sizes": sizes,
    "section_sizes": section_sizes,
    "table_pool": table_pool,
    "ram_budget": budget,
    "functions": functions,
    "cc": run([llvm + "/bin/mos-pce-clang", "--version"]).splitlines()[0],
    "flags": "-Os -mlto-zp=96 -Itools/toyc -Itools/gen "
             "-Wl,--defsym,__rom_bank0=0xc000 "
             "-Wl,--defsym,__rom_bank0_size=0x4000 "
             "+ HuTrack banks from tools/ilvm/build-engine.sh",
}
with open("tools/gen/ilvm.json", "w") as fh:
    json.dump(out, fh, indent=1, sort_keys=True)
print("built %s: %d bytes, sha256 %s" % (binpath, out["bytes"],
                                         out["sha256"][:16]))
zp = budget["zero_page"]
ba = budget["base_ram"]
print("zero page   interpreter $2020-$%04X (%d B) | engine $%04X-$%04X "
      "(%d B) | %d B free" %
      (zp["interpreter_end"], zp["interpreter_bytes"], zp["engine_start"],
       zp["engine_end"], zp["engine_bytes"], zp["free_bytes"]))
print("BaseRAM     interpreter heap starts $%04X | engine $%04X-$%04X (%d B)"
      " | stack headroom %d B (margin %d)" %
      (ba["interpreter_heap_start"], ba["engine_start"], ba["engine_end"],
       ba["engine_bytes"], ba["stack_headroom"], ba["stack_margin"]))
for symbol in sorted(functions):
    print("  %-18s %5d B" % (symbol, functions[symbol]))
PY
