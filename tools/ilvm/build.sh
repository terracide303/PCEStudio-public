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
# Needs the prebuilt llvm-mos SDK (external, never vendored — the PCEAS rule
# in docs/DECISIONS.md): /Volumes/External II/pce-tools/llvm-mos/llvm-mos,
# override with LLVM_MOS.
#
# Writes renderer/ilvm.bin and tools/gen/ilvm.json (sha, size, section and
# symbol bytes).  tests/check-ilvm.js rebuilds it and compares the SHA when
# the toolchains are present; without llvm-mos or PCEAS 4.x it prints SKIP,
# the same rule as the other PCEAS/llvm rebuild checks.
set -euo pipefail
cd "$(dirname "$0")/../.."

LLVM_MOS="${LLVM_MOS:-/Volumes/External II/pce-tools/llvm-mos/llvm-mos}"
[ -x "$LLVM_MOS/bin/mos-pce-clang" ] || { [ -x /Volumes/External/pce-tools/llvm-mos/bin/mos-pce-clang ] && LLVM_MOS=/Volumes/External/pce-tools/llvm-mos; }
CC="$LLVM_MOS/bin/mos-pce-clang"
OUT=tools/gen/ilvm.pce
BIN=renderer/ilvm.bin

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
"$CC" -Os -Itools/toyc \
  -Wl,--defsym,__rom_bank0=0xc000 \
  -Wl,--defsym,__rom_bank0_size=0x4000 \
  -o "$OUT" tools/ilvm/ilvm_runtime.c tools/ilvm/ilvm.c

BYTES=$(wc -c < "$OUT" | tr -d ' ')
if [ "$BYTES" != "16384" ]; then
  echo "ilvm image is $BYTES bytes; expected 16384 (2 physical banks)" >&2
  exit 1
fi

# #213: assemble the engine into its own two banks (vendor/hutrack is staged
# into tools/gen/hutrack-stage; the build verifies the patch sites itself).
tools/ilvm/build-engine.sh

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

python3 -I - "$LLVM_MOS" "$OUT" tools/gen/ilvm.pce.elf "$BIN" <<'PY'
import hashlib
import json
import subprocess
import sys

llvm, rom, elf, binpath = sys.argv[1:5]

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
    "ilvm_has_raster", "operand", "lua_mod", "lua_idiv")}

# #175: the table pool is ilvm.c's static `cells` array, placed by the linker
# in .bss.  Record it by name so the section sizes can be read as
# "heap + pool": 256 int32 cells = 1024 B.
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
    "bank3": "physical 3 ($8000-$9FFF: HuTrack pitch tables, #213)",
    "data_bank": "physical 4, appended per toy by renderer/pce-rom.js",
    "sizes": sizes,
    "section_sizes": section_sizes,
    "table_pool": table_pool,
    "functions": functions,
    "cc": run([llvm + "/bin/mos-pce-clang", "--version"]).splitlines()[0],
    "flags": "-Os -Wl,--defsym,__rom_bank0=0xc000 "
             "-Wl,--defsym,__rom_bank0_size=0x4000 "
             "+ HuTrack banks from tools/ilvm/build-engine.sh",
}
with open("tools/gen/ilvm.json", "w") as fh:
    json.dump(out, fh, indent=1, sort_keys=True)
print("built %s: %d bytes, sha256 %s" % (binpath, out["bytes"],
                                         out["sha256"][:16]))
for symbol in sorted(functions):
    print("  %-18s %5d B" % (symbol, functions[symbol]))
PY
