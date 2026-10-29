#!/bin/bash
# build-huc.sh — a Lua toy through IL -> C -> HuC -> PCEAS -> a .pce
# (#31 part B, the HuC route).
#
#   tools/build-huc.sh tools/toys/palette.lua [name]
#   tools/build-huc.sh --toolchain      fetch and build HuC, then print its path
#
# HuC is NOT vendored: its licence is mixed and unsettled
# (docs/DECISIONS.md, docs/PUBLIC-CHECK.md F1), so this script downloads
# HuC mainline itself and builds it outside the repo (the same rule as
# PCEAS and llvm-mos, docs/DECISIONS.md):
#
#   /Volumes/External/pce-tools/huc-src     pce-devel/huc at the pinned
#                                           commit, built (bin/huc, bin/pceas)
#
# override with HUC_DIR=/path/to/huc-src.  The pinned commit is HUC_COMMIT
# below — the revision the repo's vendored record pins (54f5c736, 2026-10-28).
# The compiler is `bin/huc` and the assembler `bin/pceas`, built by the
# upstream Makefiles from src/huc and src/mkit/as; nothing is patched.
#
# Output, beside the llvm-mos route's files:
#   tools/gen/<name>.huc.c       the generated C (huc dialect)
#   tools/gen/<name>.huc.all.c   + tools/toyc/huc_runtime.c, one translation unit
#   tools/gen/<name>.huc.s       HuC's assembly
#   tools/gen/<name>-huc.pce     the HuCard image
#   tools/gen/<name>-huc.json    size, sha256, bank usage, function bytes,
#                                build seconds (docs/IL.md §11-§12)
set -euo pipefail
cd "$(dirname "$0")/.."

HUC_REPO="https://github.com/pce-devel/huc.git"
HUC_COMMIT="54f5c73606c1e7142e8095c727cab2767e2b3cb3"
HUC_DEFAULT="/Volumes/External/pce-tools/huc-src"

# Fetch and build the toolchain if it is not already there.  Runs from the
# repo root (the cd above); the clone lives outside it, always.
ensure_toolchain() {
  HUC_DIR="${HUC_DIR:-$HUC_DEFAULT}"
  HUC_DIR="${HUC_DIR%/}"

  # Resolve the path and refuse anything inside the repository.
  local base abs
  base="${HUC_DIR%/*}"
  [ -d "$base" ] || base="."
  abs="$(cd "$base" && pwd)/${HUC_DIR##*/}"
  case "$abs" in
    "$(pwd)"/*) echo "refusing: HUC_DIR ($abs) is inside the repo; " \
                     "HuC is an external tool" >&2
                exit 2 ;;
  esac

  if [ -d "$HUC_DIR/.git" ]; then
    local url
    url="$(git -C "$HUC_DIR" remote get-url origin 2>/dev/null || true)"
    case "$url" in
      *pce-devel/huc*|*pce-devel/huc.git*) ;;
      *) echo "refusing: $HUC_DIR is a clone of ${url:-unknown}, not " \
              "$HUC_REPO (move it aside, or set HUC_DIR)" >&2
         exit 2 ;;
    esac
    if [ "$(git -C "$HUC_DIR" rev-parse HEAD 2>/dev/null || true)" != \
         "$HUC_COMMIT" ]; then
      git -C "$HUC_DIR" fetch -q origin "$HUC_COMMIT"
      git -C "$HUC_DIR" checkout -q -f "$HUC_COMMIT"
      # Rebuild from a clean tree: .o files from another commit would
      # otherwise be mistaken for up-to-date (and bin/ is rebuilt).
      git -C "$HUC_DIR" clean -q -fdx
    elif [ -x "$HUC_DIR/bin/huc" ] && [ -x "$HUC_DIR/bin/pceas" ]; then
      return 0
    fi
  else
    if [ -e "$HUC_DIR" ]; then
      echo "refusing: $HUC_DIR exists but is not a HuC clone " \
           "(move it aside, or set HUC_DIR)" >&2
      exit 2
    fi
    mkdir -p "$(dirname "$HUC_DIR")"
    echo "fetching HuC into $HUC_DIR ($HUC_REPO at $HUC_COMMIT)"
    git clone -q "$HUC_REPO" "$HUC_DIR"
    git -C "$HUC_DIR" fetch -q origin "$HUC_COMMIT"
    git -C "$HUC_DIR" checkout -q -f "$HUC_COMMIT"
  fi

  echo "building HuC (make -C src/mkit/as; make -C src/huc)"
  mkdir -p "$HUC_DIR/bin"
  if ! make -C "$HUC_DIR/src/mkit/as" -j4; then
    echo "building PCEAS failed (output above)" >&2
    exit 2
  fi
  if ! make -C "$HUC_DIR/src/huc" -j4; then
    echo "building HuC failed (output above)" >&2
    exit 2
  fi
  if [ ! -x "$HUC_DIR/bin/huc" ] || [ ! -x "$HUC_DIR/bin/pceas" ]; then
    echo "the build finished but $HUC_DIR/bin has no huc/pceas" >&2
    exit 2
  fi
  echo "HuC toolchain ready in $HUC_DIR"
}

if [ "${1:-}" = "--toolchain" ]; then
  ensure_toolchain
  echo "HuC toolchain: $HUC_DIR (bin/huc, bin/pceas)"
  exit 0
fi

SRC="${1:?usage: tools/build-huc.sh TOY.lua [NAME] (or --toolchain)}"
NAME="${2:-$(basename "$SRC" .lua)}"
ensure_toolchain
HUC="$HUC_DIR/bin/huc"
PCEAS="$HUC_DIR/bin/pceas"

GEN=tools/gen
mkdir -p "$GEN"
T0=$(python3 -I -c 'import time; print(time.time())')
node tools/toyc/emit.js "$SRC" "$GEN/$NAME.huc.c" huc

# HuC compiles ONE C file (a library is another C file); concatenating the
# runtime after the toy's functions keeps everything static in one unit.
cat "$GEN/$NAME.huc.c" tools/toyc/huc_runtime.c > "$GEN/$NAME.huc.all.c"
# Quoted includes are looked up beside the C file; the header lives in
# tools/toyc.
cp tools/toyc/huc_runtime.h "$GEN/huc_runtime.h"

# A toy with a raster() hook needs the runtime's RCR chain; a toy without
# one must not call toy_raster (it has no definition).
EXTRA=""
if grep -q "void toy_raster(int line)" "$GEN/$NAME.huc.c"; then
  EXTRA="-DTOY_RASTER_BUILD"
fi

# HuC finds a quoted #include beside the CWD, not beside the C file, so the
# compile runs in tools/gen (where huc_runtime.h was just copied).
(cd "$GEN" && PCE_INCLUDE="$HUC_DIR/include/huc" PCE_PCEAS="$PCEAS" \
  "$HUC" -S -fno-recursive $EXTRA "$NAME.huc.all.c") \
  > "$GEN/$NAME.huc.log" 2>&1 || {
    cat "$GEN/$NAME.huc.log" >&2
    echo "huc failed (see $GEN/$NAME.huc.log)" >&2
    exit 1
  }
if ! grep -q "No errors" "$GEN/$NAME.huc.log"; then
  cat "$GEN/$NAME.huc.log" >&2
  echo "huc reported errors (see $GEN/$NAME.huc.log)" >&2
  exit 1
fi

PCE_INCLUDE="$HUC_DIR/include/huc" "$PCEAS" -S \
  "$GEN/$NAME.huc.all.s" tools/toyc/huc_raster.asm \
  -o "$GEN/$NAME-huc.pce" > "$GEN/$NAME.huc.pceas.log" 2>&1 || {
    cat "$GEN/$NAME.huc.pceas.log" >&2
    echo "pceas failed (see $GEN/$NAME.huc.pceas.log)" >&2
    exit 1
  }
T1=$(python3 -I -c 'import time; print(time.time())')

ROM="$GEN/$NAME-huc.pce"
if [ ! -s "$ROM" ]; then
  echo "no ROM at $ROM" >&2
  exit 1
fi

BUILD_SECONDS=$(python3 -I -c "print('%.3f' % ($T1 - $T0))") \
python3 -I - "$NAME" "$SRC" "$ROM" "$GEN/$NAME.huc.all.lst" \
  "$GEN/$NAME.huc.pceas.log" "$HUC_DIR" <<'PY'
import hashlib
import json
import os
import re
import sys

name, src, rom, lstfile, seglog, hucdir = sys.argv[1:7]
seconds = os.environ.get("BUILD_SECONDS")

def sha(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()

segments = {}
bank = None
for line in open(seglog, encoding="utf-8", errors="replace"):
    m = re.match(r"BANK \$([0-9A-Fa-f]+)\s*(.*?)\s+(\d+)\s*/\s*(\d+)\s*$",
                 line)
    if m:
        bank = "%02X" % int(m.group(1), 16)
        segments[bank] = {"used": int(m.group(3)),
                          "free": int(m.group(4)),
                          "name": m.group(2).strip()}
        continue
    m = re.match(r"\s+(CODE|DATA|PROC)\s+\$([0-9A-Fa-f]+)-\$([0-9A-Fa-f]+)"
                 r"\s+\[\s*(\d+)\]", line)
    if m and bank is not None:
        segments[bank].setdefault("sections", []).append(
            {"kind": m.group(1), "start": int(m.group(2), 16),
             "end": int(m.group(3), 16), "bytes": int(m.group(4))})

# Function bytes from the assembler's listing: a function runs from its
# `.proc _il_fn_N` line to the next `.proc` (or the last instruction
# shown).  The listing's addresses are bank:addr, and the bank's address
# space is contiguous inside a function.
functions = {}
cur = None
seen = {}

def close(end_keys):
    global cur
    if cur is None:
        return
    start = seen[cur]["start"], seen[cur]["last"]
    if end_keys is not None and end_keys[0] == seen[cur]["bank"]:
        size = end_keys[1] - seen[cur]["start"]
    else:
        size = seen[cur]["last"] + 1 - seen[cur]["start"]
    functions[cur] = size
    cur = None

if os.path.exists(lstfile):
    for line in open(lstfile, encoding="utf-8", errors="replace"):
        m = re.match(r"\s*\d+\s+([0-9A-Fa-f]{2}):([0-9A-Fa-f]{4})\s+(.*)$",
                     line)
        if not m:
            continue
        bank, addr, rest = int(m.group(1), 16), int(m.group(2), 16), m.group(3)
        pm = re.search(r"\.proc\s+(_il_fn_\d+)", rest)
        if pm:
            close((bank, addr))
            cur = pm.group(1)
            seen[cur] = {"bank": bank, "start": addr, "last": addr}
            continue
        if re.search(r"\.proc\s+", rest):
            close((bank, addr))
            continue
        if cur is not None and bank == seen[cur]["bank"]:
            seen[cur]["last"] = max(seen[cur]["last"], addr)
    close(None)
functions = {k: functions[k] for k in sorted(functions,
             key=lambda s: int(s.rsplit("_", 1)[1]))}

code_bytes = sum(sec.get("bytes", 0)
                 for s in segments.values()
                 for sec in s.get("sections", []) if sec["kind"] == "CODE")
out = {
    "name": name,
    "route": "huc",
    "source": src,
    "source_sha256": sha(src),
    "rom": rom,
    "rom_bytes": os.path.getsize(rom),
    "rom_sha256": sha(rom),
    "banks": segments,
    "code_bytes": code_bytes,
    "functions": functions,
    "build_seconds": float(seconds) if seconds else None,
    "toolchain": hucdir,
    "flags": {"huc": "-S -fno-recursive", "pceas": "-S"},
}
with open("tools/gen/%s-huc.json" % name, "w") as fh:
    json.dump(out, fh, indent=1, sort_keys=True)
print("built %s: %d bytes (%d banks), %.2f s"
      % (rom, out["rom_bytes"], len(segments), out["build_seconds"] or 0))
for sym_name in sorted(functions):
    print("  %-10s %s B" % (sym_name, functions[sym_name]))
PY
