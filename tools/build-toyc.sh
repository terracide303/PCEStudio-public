#!/bin/bash
# build-toyc.sh — a Lua toy through IL -> C -> llvm-mos -> a .pce (#31 part A).
#
#   tools/build-toyc.sh tools/toys/palette.lua [name]
#
# Needs the prebuilt llvm-mos SDK (external tool, never vendored; the same
# rule as PCEAS, docs/DECISIONS.md).  Default location:
#
#   /Volumes/External II/pce-tools/llvm-mos/llvm-mos
#
# override with LLVM_MOS=/path/to/llvm-mos.  Writes tools/gen/<name>.c (the
# generated C), tools/gen/<name>.pce (the raw HuCard ROM llvm-mos links; its
# .elf beside it) and tools/gen/<name>.json (size, sha256 and per-function
# bytes for docs/IL.md and the capture's meta.json).
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="${1:?usage: tools/build-toyc.sh TOY.lua [NAME]}"
NAME="${2:-$(basename "$SRC" .lua)}"
LLVM_MOS="${LLVM_MOS:-/Volumes/External II/pce-tools/llvm-mos/llvm-mos}"
CC="$LLVM_MOS/bin/mos-pce-clang"

if [ ! -x "$CC" ]; then
  echo "llvm-mos not found at $LLVM_MOS (set LLVM_MOS to the SDK root)" >&2
  exit 2
fi

mkdir -p tools/gen
node tools/toyc/emit.js "$SRC" "tools/gen/$NAME.c"

# A toy with a raster() hook needs the runtime's RCR chain (the IRQ handler
# and the line table); a toy without one must not carry it, both because it
# costs RAM/ROM and because part A's palette ROM is a committed, byte-fixed
# image.  The generated C names the hook, so that is the test.
EXTRA=""
if grep -q "void toy_raster(int32_t line)" "tools/gen/$NAME.c"; then
  EXTRA="-DTOY_RASTER_BUILD"
fi

# -Os: the ROM is 8 KiB (bank 0).  -I tools/toyc is where toy_runtime.h lives.
"$CC" -Os $EXTRA -Itools/toyc -o "tools/gen/$NAME.pce" \
  tools/toyc/toy_runtime.c "tools/gen/$NAME.c"

ROM="tools/gen/$NAME.pce"
ELF="$ROM.elf"
if [ ! -s "$ROM" ] || [ ! -s "$ELF" ]; then
  echo "llvm-mos did not produce $ROM and $ELF" >&2
  exit 1
fi

python3 -I - "$NAME" "$SRC" "$LLVM_MOS" "$ROM" "$ELF" <<'PY'
import hashlib
import json
import subprocess
import sys

name, src, llvm, rom, elf = sys.argv[1:6]

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

# llvm-objdump -h: "idx name size vma lma off align"
section_sizes = {}
for line in run([llvm + "/bin/llvm-objdump", "-h", elf]).splitlines():
    parts = line.split()
    if len(parts) >= 6 and parts[0].isdigit() and parts[1].startswith("."):
        try:
            section_sizes[parts[1]] = int(parts[2], 16)
        except ValueError:
            pass

functions = {}
for line in run([llvm + "/bin/llvm-nm", "-S", "--size-sort", elf]).splitlines():
    parts = line.split()
    if len(parts) >= 4 and parts[3].startswith(("il_fn_", "il_call",
                                                "toy_pal", "toy_vram_set",
                                                "toy_wait_vblank",
                                                "toy_display_on",
                                                "toy_measure")):
        functions[parts[3]] = int(parts[1], 16)

out = {
    "name": name,
    "source": src,
    "source_sha256": sha(src),
    "rom": rom,
    "rom_bytes": len(open(rom, "rb").read()),
    "rom_sha256": sha(rom),
    "sections": sizes,
    "section_sizes": section_sizes,
    "functions": functions,
    "cc": run([llvm + "/bin/mos-pce-clang", "--version"]).splitlines()[0],
    "flags": "-Os -Itools/toyc",
}
with open("tools/gen/%s.json" % name, "w") as fh:
    json.dump(out, fh, indent=1, sort_keys=True)
print("built %s: %d bytes, sha256 %s" % (rom, out["rom_bytes"],
                                         out["rom_sha256"][:16]))
for symbol in sorted(functions):
    print("  %-22s %4d B" % (symbol, functions[symbol]))
PY
