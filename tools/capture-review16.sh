#!/bin/bash
# capture-review16.sh — the two captures docs/REVIEW-16.md asks for, as #68's
# test fixtures.  No synthetic input: Mednafen runs from the command line and
# a save state is reached with SIGINT, exactly tools/capture.sh's route.  This
# script is separate from capture.sh on purpose — #68 adds a scene whose table
# field combination no shipped table has, and building it must not edit the
# generator card #15 owns; tools/genreview16.py adds scene r11 beside it.
#
#   tools/capture-review16.sh raster11   the scene: a visible per-line
#                                        backdrop ramp plus a second per-line
#                                        word into an undisplayed CRAM cell,
#                                        frame counter ON (counter + two CRAM
#                                        words in one step — REVIEW-16 B15's
#                                        unexercised combination), captured in
#                                        Mednafen -> tests/dumps/raster11/
#   tools/capture-review16.sh vraster11  the #16 viewer ROM of that table ->
#                                        tests/dumps/vraster11/
#   tools/capture-review16.sh raster12   #69's scene: r11's picture and frame
#                                        counter, second CRAM word on the cell
#                                        the line's first pixels use (the
#                                        visible-second-word fixture) ->
#                                        tests/dumps/raster12/
#   tools/capture-review16.sh vraster12  the #16 viewer ROM of that table ->
#                                        tests/dumps/vraster12/
#   tools/capture-review16.sh trace      two VDC write traces from reset of
#                                        vraster2: the pristine ROM, and the
#                                        B14 mutant (the boot arm one line
#                                        late) as a control that the first-
#                                        frame check can fail ->
#                                        tests/dumps/vtrace2/,
#                                        tests/dumps/vtrace2-b14/
#   tools/capture-review16.sh all        all three, in that order
#
# The trace needs an instrumented Mednafen (1.32.1 with the VDC write /
# RCRIRQ trace added — it is the instrument REVIEW-16 used).  Set
# MEDNAFEN_TRACE to that binary; the default is this machine's build.  The
# build writes the trace to <repo>/vdc-trace.log, so the script creates that
# path as a symlink into its scratch dir for the run and removes it after; it
# refuses to run if something is already there.  Without the instrument the
# trace mode exits 2 (NOT RUN, nothing measured) — it does not skip silently.
#
# Scratch (Mednafen's save-state dir, its config HOME, the movies, the raw
# traces) lives under $TMPDIR, never /tmp; the repo is not written except
# for tests/dumps/<fixture>/ and tools/gen/ (gitignored build output).  Only
# the Mednafen process this script started is signalled — never
# `pkill mednafen`, which would kill another seat's emulator.
#
# A capture is only accepted when the save landed after the table's last
# entry fired (RCRCount >= 233, the state the shipped dumps have at 237);
# Mednafen occasionally answers the SIGINT early (measured: one 1-frame
# movie, RCRCount 195), so the run is retried up to 3 times and the script
# fails loudly rather than commit an unusable fixture.

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
TOOLS="$ROOT/tools"
REAL_HOME="${HOME:-}"
PCEAS="${PCEAS:-pceas}"
MEDNAFEN="${MEDNAFEN:-mednafen}"
MEDNAFEN_TRACE="${MEDNAFEN_TRACE:-/Volumes/External II/pce-tools/mednafen/src/mednafen}"

if [ -z "${TMPDIR:-}" ]; then
  echo "capture-review16: TMPDIR is not set; refusing to guess a scratch dir" >&2
  exit 2
fi
SCRATCH="$(mktemp -d "$TMPDIR/pce-review16.XXXXXX")"
export HOME="$SCRATCH/home"
mkdir -p "$HOME/.mednafen/mcs" "$SCRATCH/work"
# Mednafen needs a working video/audio config; start from the user's if it
# exists, else Mednafen's defaults (both routes are what capture.sh does in
# effect, with the config under the scratch HOME).
if [ -n "$REAL_HOME" ] && [ -f "$REAL_HOME/.mednafen/mednafen.cfg" ]; then
  cp "$REAL_HOME/.mednafen/mednafen.cfg" "$HOME/.mednafen/mednafen.cfg"
fi

TRACE_LINK="$ROOT/vdc-trace.log"
cleanup() {
  rm -f "$TRACE_LINK"
  if [ -z "${KEEP_SCRATCH:-}" ]; then rm -rf "$SCRATCH"; fi
}
trap cleanup EXIT

say() { echo "== $*"; }
die() { echo "capture-review16: $*" >&2; exit 1; }
notrun() { echo "capture-review16: NOT RUN: $*" >&2; exit 2; }

require() {
  command -v "$1" >/dev/null 2>&1 || notrun "$1 is not on PATH"
}

# One Mednafen run of tools/gen/<name>.pce, SIGINT after SLEEP seconds, then
# the state/movie harvest.  Returns 3 when the save is unusable (retry).
run_capture() {
  local name="$1" sleep_s="$2" dumpdir="$3"
  local mov="$SCRATCH/work/$name.mov"
  local pce="$ROOT/tools/gen/$name.pce"
  rm -f "$mov"
  "$MEDNAFEN" -force_module pce -pce.slstart 4 -pce.slend 235 \
    -pce.xscale 1 -pce.yscale 1 \
    -qtrecord "$mov" -qtrecord.vcodec png \
    -qtrecord.w_double_threshold 0 -qtrecord.h_double_threshold 0 \
    -autosave 1 "$pce" > "$SCRATCH/work/mdfn-$name.log" 2>&1 &
  local pid=$!
  sleep "$sleep_s"
  kill -INT "$pid" 2>/dev/null || true
  for _ in $(seq 1 15); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  kill -9 "$pid" 2>/dev/null || true
  local mcs
  mcs="$(ls -t "$HOME/.mednafen/mcs/$name".*.mca 2>/dev/null | head -1 || true)"
  [ -n "$mcs" ] || { say "no autosave state for $name"; return 3; }
  [ -s "$mov" ] || { say "no movie recorded for $name"; return 3; }
  mkdir -p "$dumpdir"
  local rc=0
  python3 -I "$TOOLS/mcs-extract.py" "$mcs" "$dumpdir" 4 --raster || rc=$?
  [ "$rc" -eq 0 ] || return 3
  local save_line
  save_line="$(python3 -I - "$dumpdir/regs.json" <<'PY'
import json, sys
print(json.load(open(sys.argv[1]))["RCRCount"])
PY
)"
  if [ "$save_line" -lt 233 ]; then
    say "save landed at RCRCount $save_line (before the last entry fired) — retry"
    return 3
  fi
  python3 -I - "$dumpdir/regs.json" <<'PY'
import json, sys
p = sys.argv[1]
r = json.load(open(p))
r["slstart"] = 4
r["slend"] = 235
json.dump(r, open(p, "w"), indent=1, sort_keys=True)
PY
  python3 -I "$TOOLS/movframes.py" "$mov" "$dumpdir/mednafen.png" 256 232 4
  cp "$SCRATCH/work/mdfn-$name.log" "$dumpdir/mednafen.log"
  return 0
}

capture_with_retries() {
  local name="$1" mode="$2" patch="$3"
  for attempt in 1 2 3; do
    say "$name: capture attempt $attempt"
    local rc=0
    run_capture "$name" "${SLEEP:-9}" "$ROOT/tests/dumps/$name" || rc=$?
    if [ "$rc" -eq 0 ]; then
      cp "$ROOT/tools/gen/$name.raster.json" \
         "$ROOT/tests/dumps/$name/raster.json"
      python3 -I "$TOOLS/raster-patch.py" "$ROOT/tests/dumps/$name" "$patch"
      say "$name: captured in tests/dumps/$name"
      return 0
    fi
    say "$name: attempt $attempt unusable (rc=$rc)"
  done
  die "$name: no usable capture after 3 attempts (Mednafen, not the test)"
}

build_raster11() {
  require python3
  require "$PCEAS"
  say "generate + assemble scene r11"
  python3 -I "$TOOLS/genreview16.py" --build
  # regions.json is picture data (docs/ROM_LAYOUT.md): raster7's picture is
  # one tile region at char 0x040, two 16-word chunks — the r11 table reuses
  # that picture.
  mkdir -p "$ROOT/tests/dumps/raster11"
  cat > "$ROOT/tests/dumps/raster11/regions.json" <<'JSON'
{
  "comment": "Tile regions of the raster11 dump for docs/ROM_LAYOUT.md: [char0, 16-word chunk count] in descriptor order — the scene's two solid tiles (values are genroms.py RASTER_SCENES['r7']['tiles'], reused by tools/genreview16.py's r11). Read by tools/genviewer.py (card #16) and renderer/pce-rom.js; the SAT at VRAM 0x7f00 is NOT a region — it has its own fixed place in bank 1.",
  "tile_regions": [[64, 2]]
}
JSON
}

mode_raster11() {
  require "$MEDNAFEN"
  build_raster11
  capture_with_retries raster11 raster 11
}

# #69: the visible-second-word fixture.  Same picture, same frame counter, but
# the second CRAM word writes the backdrop cell the line's first pixels use
# (CRAM[0x000]), so the write's line timing is in the frame — the fixture #68
# could not ship (tools/genreview16.py r12_scene's docstring).
build_raster12() {
  require python3
  require "$PCEAS"
  say "generate + assemble scene r12"
  python3 -I "$TOOLS/genreview16.py" r12 --build
  mkdir -p "$ROOT/tests/dumps/raster12"
  cat > "$ROOT/tests/dumps/raster12/regions.json" <<'JSON'
{
  "comment": "Tile regions of the raster12 dump for docs/ROM_LAYOUT.md: [char0, 16-word chunk count] in descriptor order — raster11's stripes picture (the two solid tiles of genroms.py RASTER_SCENES['r7']), reused by tools/genreview16.py's r12, whose second CRAM word paints the cell the line's first pixels use. Read by tools/genviewer.py (card #16) and renderer/pce-rom.js; the SAT at VRAM 0x7f00 is NOT a region — it has its own fixed place in bank 1.",
  "tile_regions": [[64, 2]]
}
JSON
}

mode_raster12() {
  require "$MEDNAFEN"
  build_raster12
  capture_with_retries raster12 raster 12
}

mode_vraster12() {
  require "$MEDNAFEN"
  [ -f "$ROOT/tests/dumps/raster12/regions.json" ] ||
    die "tests/dumps/raster12 is missing — run '$0 raster12' first"
  say "build gen/vraster12.pce (tools/genviewer.py, table r12)"
  python3 -I "$TOOLS/genreview16.py" r12 --viewer
  capture_with_retries vraster12 vraster 12v
}

mode_vraster11() {
  require "$MEDNAFEN"
  [ -f "$ROOT/tests/dumps/raster11/regions.json" ] ||
    die "tests/dumps/raster11 is missing — run '$0 raster11' first"
  say "build gen/vraster11.pce (tools/genviewer.py, table r11)"
  python3 -I "$TOOLS/genreview16.py" --viewer
  capture_with_retries vraster11 vraster 11v
}

# Build tools/gen/vraster2.pce (the trace target) without make: the Makefile
# has no r11 rule, and this keeps the dependency explicit.
build_vraster2() {
  if [ ! -f "$ROOT/tools/gen/raster2.raster.json" ]; then
    say "run tools/genroms.py for the scene tables"
    python3 -I "$TOOLS/genroms.py"
  fi
  say "build gen/vraster2.pce"
  ( cd "$TOOLS" && python3 -I genviewer.py vraster2 )
  ( cd "$TOOLS" && "$PCEAS" -raw -o gen/vraster2.pce gen/vraster2.asm )
}

# Build the B14 control: the pristine gen/vraster2.asm and data, with a copy
# of viewer.asm whose boot arm is one line late (REVIEW-16's B14 — the +1 is
# only in the boot arm; the handler's re-arm is untouched).
build_b14() {
  local mut="$SCRATCH/b14"
  mkdir -p "$mut/tools/gen"
  # PCEAS names its output after the SOURCE file (the -o basename is not
  # used for the .pce), so the mutant asm gets its own name.
  cp "$ROOT/tools/gen/vraster2.asm" "$mut/tools/gen/vraster2-b14.asm"
  cp -R "$ROOT/tools/gen/vraster2" "$mut/tools/gen/"
  python3 -I - "$TOOLS/viewer.asm" "$mut/tools/viewer.asm" <<'PY'
import sys

src = open(sys.argv[1]).read()
old = """        lda r_chain_lo             ; first entry's line.  RCR = 0x40 fires
        sta $0002                  ; at the VDW entry, before the first
        lda r_chain_hi             ; display line (Mednafen vdc.cpp: the
        sta $0003                  ; match check runs after the VDW-entry"""
new = """        lda r_chain_lo             ; B14 CONTROL (REVIEW-16): the boot
        clc                        ; arm one line late — +1 only here, the
        adc #$01                   ; handler's re-arm below is untouched
        sta $0002
        lda r_chain_hi
        adc #$00
        sta $0003"""
n = src.count(old)
if n != 1:
    sys.exit(f"B14 control: boot-arm source block found {n} times, "
             f"expected exactly 1 — tools/viewer.asm moved")
open(sys.argv[2], "w").write(src.replace(old, new))
PY
  ( cd "$mut/tools" && "$PCEAS" -raw -o gen/vraster2-b14.pce \
      gen/vraster2-b14.asm ) > "$SCRATCH/work/b14-pceas.log" 2>&1
  [ -f "$mut/tools/gen/vraster2-b14.pce" ] ||
    die "B14 control: PCEAS produced no vraster2-b14.pce"
  echo "$mut/tools/gen/vraster2-b14.pce"
}

# Run the instrumented build for DELAY seconds, capturing the VDC trace into
# the scratch file the symlink points at.
run_trace() {
  local rom="$1" seconds="$2" trace="$3"
  : > "$trace"
  if [ -e "$TRACE_LINK" ] || [ -L "$TRACE_LINK" ]; then
    die "$TRACE_LINK already exists; refusing to touch it (move it first)"
  fi
  ln -s "$trace" "$TRACE_LINK"
  "$MEDNAFEN_TRACE" -force_module pce -pce.slstart 4 -pce.slend 235 \
    -pce.xscale 1 -pce.yscale 1 "$rom" \
    > "$SCRATCH/work/trace-run.log" 2>&1 &
  local pid=$!
  sleep "$seconds"
  kill -INT "$pid" 2>/dev/null || true
  for _ in $(seq 1 15); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$TRACE_LINK"
  [ -s "$trace" ] || die "the instrumented Mednafen wrote no trace to $trace"
}

write_trace_fixture() {
  local dir="$1" trace="$2" rom="$3" expect="$4" mutation="$5"
  mkdir -p "$dir"
  { grep -a '^RCRIRQ' "$trace" | head -8 > "$dir/rcrirq-first.txt"; } || true
  { grep -a '^RCRIRQ' "$trace" | tail -4 > "$dir/rcrirq-last.txt"; } || true
  [ "$(wc -l < "$dir/rcrirq-first.txt" | tr -d ' ')" -ge 4 ] ||
    die "$dir: fewer than 4 RCRIRQ lines — the chain did not run"
  cp "$ROOT/tools/gen/vraster2.raster.json" "$dir/raster.json"
  python3 -I - "$dir" "$trace" "$rom" "$expect" "$mutation" <<'PY'
import hashlib, json, sys

outdir, trace, rom, expect, mutation = sys.argv[1:6]
total = 0
with open(trace, "rb") as f:
    for line in f:
        if line.startswith(b"RCRIRQ"):
            total += 1
meta = {
    "note": "#68 / REVIEW-16 B14: a VDC write trace from reset, the only "
            "instrument that sees the first RCR match (the movie's first "
            "frame is already steady). expect='match' means the pristine "
            "table must be armed in its entry order; expect='mismatch' is "
            "the B14 control that the check must reject.",
    "rom": "tools/gen/vraster2.pce",
    "rom_sha256": hashlib.sha256(open(rom, "rb").read()).hexdigest(),
    "instrument": "Mednafen 1.32.1 + VDC write / RCRIRQ trace (MEDNAFEN_TRACE)",
    "mutation": mutation,
    "expect": expect,
    "rcrirq_total": total,
}
json.dump(meta, open(outdir + "/meta.json", "w"), indent=1, sort_keys=True)
print(f"{outdir}: {total} RCRIRQ line(s), expect={expect}")
PY
}

mode_trace() {
  require python3
  require "$PCEAS"
  [ -x "$MEDNAFEN_TRACE" ] ||
    notrun "MEDNAFEN_TRACE=$MEDNAFEN_TRACE is not executable — the trace " \
           "instrument is not installed; nothing was measured"
  build_vraster2
  local prist="$SCRATCH/work/vdc-trace-pristine.log"
  say "trace: pristine vraster2"
  run_trace "$ROOT/tools/gen/vraster2.pce" "${TRACE_SECONDS:-4}" "$prist"
  write_trace_fixture "$ROOT/tests/dumps/vtrace2" "$prist" \
    "$ROOT/tools/gen/vraster2.pce" match ""
  local mut_rom
  mut_rom="$(build_b14)"
  local mut="$SCRATCH/work/vdc-trace-b14.log"
  say "trace: B14 control (boot arm one line late)"
  run_trace "$mut_rom" "${TRACE_SECONDS:-4}" "$mut"
  write_trace_fixture "$ROOT/tests/dumps/vtrace2-b14" "$mut" "$mut_rom" \
    mismatch "boot arm r_chain[0] + 1 (REVIEW-16 B14)"
}

case "${1:-}" in
  raster11)  mode_raster11 ;;
  vraster11) mode_vraster11 ;;
  raster12)  mode_raster12 ;;
  vraster12) mode_vraster12 ;;
  trace)     mode_trace ;;
  all)       mode_raster11; mode_vraster11; mode_raster12; mode_vraster12; mode_trace ;;
  *) echo "usage: $0 raster11|vraster11|raster12|vraster12|trace|all" >&2; exit 2 ;;
esac
