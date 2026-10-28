#!/bin/bash
# capture-ares.sh — card #41: a second emulator (ares) as a cross-check.
#
# Loads a ROM in ares (PC Engine), waits for it to settle, captures the ares
# window with `screencapture -l`, crops the 256-wide active area, and writes
# the frame to docs/.  No synthetic input of any kind: no osascript, no
# System Events, no CGEvent.  The only window-server call is a read-only
# CGWindowList query (tools/ares-window.swift) to find the window id, and the
# capture is `screencapture -l <id>`.
#
#   tools/capture-ares.sh all                 # viewer1-3 + painted, then check
#   tools/capture-ares.sh viewer2             # one ROM
#   CAPTURE_ONLY=1 tools/capture-ares.sh all  # capture, do not run the check
#   SETTLE=10 tools/capture-ares.sh viewer1   # longer settle
#
# Writes:
#   docs/ares-<name>.png            256x224 active area (the card's frame)
#   tests/dumps/<scene|painted>/ares-block.png
#                                   the full 294x263 picture ares presents
#                                   (the 232-row comparison window lives in it)
#
# ares settings are the window/pixel settings the crop expects; they are
# passed with --setting so the human's settings.bml is never edited.  The
# settings FILE is a scratch copy, also so ares cannot write back to the
# human's file.
#
# The script tracks the ares process it launched: it refuses to use (or
# kill) a window whose owner PID existed before the launch, so a human's
# ares session is never touched.

set -euo pipefail
cd "$(dirname "$0")/.."

ARES="/Volumes/External II/Applications/ares.app/Contents/MacOS/ares"
SCRATCH="${SCRATCH:-/Volumes/External II/scratch}"
SETTLE="${SETTLE:-6}"
TOOLS="$(pwd)/tools"
DOCS="$(pwd)/docs"

[ -x "$ARES" ] || { echo "ares not found at $ARES" >&2; exit 1; }
command -v swiftc >/dev/null || {
  echo "swiftc (Xcode command line tools) is needed for ares-window.swift" >&2
  exit 1
}
command -v screencapture >/dev/null || {
  echo "screencapture is needed (macOS)" >&2; exit 1
}
mkdir -p "$SCRATCH" "$DOCS"

# ROM -> the dump directory whose vram/cram/regs the renderer uses is the
# checker's business (tests/check-ares.js); this script only captures.

build_rom() {
  case "$1" in
    viewer1|viewer2|viewer3) make -C tools "gen/$1.pce" >/dev/null ;;
    painted)                 node tests/check-editor.js --write >/dev/null ;;
  esac
}

ARES_PID=""
OWNER_PID=""

cleanup() {
  # Only PIDs this script launched are ever signalled.
  if [ -n "$OWNER_PID" ]; then kill -TERM "$OWNER_PID" 2>/dev/null || true; fi
  if [ -n "$ARES_PID" ] && [ "$ARES_PID" != "$OWNER_PID" ]; then
    kill -TERM "$ARES_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Compile the read-only window query once.
WINBIN="$SCRATCH/ares-window"
swiftc -O "$TOOLS/ares-window.swift" -o "$WINBIN"

# A fresh scratch settings file, based on the human's current settings.
SETTINGS="$SCRATCH/ares-settings.bml"
SETTINGS_SRC="$HOME/Library/Application Support/ares/settings.bml"
[ -f "$SETTINGS_SRC" ] || {
  echo "no ares settings at $SETTINGS_SRC (run ares once first)" >&2
  exit 1
}
cp "$SETTINGS_SRC" "$SETTINGS"

capture_one() {
  local name="$1" rom capdir log full before win i
  rom="tools/gen/$name.pce"
  capdir="tests/dumps/$name"
  mkdir -p "$capdir"
  [ -f "$rom" ] || { echo "missing ROM $rom (build failed?)" >&2; return 1; }
  log="/tmp/ares-$name.log"
  full="$SCRATCH/ares-$name-window.png"

  before=" $(pgrep -x ares 2>/dev/null | tr '\n' ' ' || true) "

  "$ARES" --system "PC Engine" --no-file-prompt \
    --settings-file "$SETTINGS" \
    --setting Input/Defocus=Allow \
    --setting General/ShowStatusBar=false \
    --setting Video/Overscan=true \
    --setting Video/ColorEmulation=false \
    --setting Video/InterframeBlending=false \
    --setting Video/AdaptiveSizing=false \
    --setting Video/AspectCorrectionMode=None \
    --setting Video/Output=IntegerFixed \
    --setting Video/PixelAccuracy=true \
    --setting Video/DisableVideoInterfaceProcessing=true \
    --setting Video/FixedScale=1 \
    --setting Video/WindowWidth=640 --setting Video/WindowHeight=263 \
    "$rom" > "$log" 2>&1 &
  ARES_PID=$!
  disown "$ARES_PID" 2>/dev/null || true   # do not report the kill as a job
  OWNER_PID=""

  win=""
  for i in $(seq 1 60); do
    if ! kill -0 "$ARES_PID" 2>/dev/null; then
      echo "ares exited before showing a window ($name); log:" >&2
      cat "$log" >&2
      return 1
    fi
    while IFS="|" read -r pid id wname wx wy ww wh; do
      [ -z "${pid:-}" ] && continue
      # ares also owns zero-size and unnamed helper windows; the game window
      # has a title and is at least wide enough for the 294-dot picture.
      [ -n "$wname" ] || continue
      [ "${ww:-0}" -ge 294 ] 2>/dev/null || continue
      if [ "$wname" = "$name" ] || [ "$pid" = "$ARES_PID" ]; then
        case "$before" in
          *" $pid "*)
            echo "REFUSING: the $name window belongs to ares pid $pid, which " \
                 "existed before this run; not capturing or killing it" >&2
            return 1 ;;
        esac
        win=$(printf '%s|%s|%s|%s|%s|%s|%s' \
              "$pid" "$id" "$wname" "$wx" "$wy" "$ww" "$wh")
        break
      fi
    done < <("$WINBIN")
    [ -n "$win" ] && break
    sleep 0.5
  done
  if [ -z "$win" ]; then
    echo "no ares window titled '$name' after 30s; log:" >&2
    cat "$log" >&2
    return 1
  fi

  IFS="|" read -r OWNER_PID WIN_ID WIN_NAME WIN_X WIN_Y WIN_W WIN_H <<< "$win"
  echo "== $name: ares pid $OWNER_PID window $WIN_ID ${WIN_W}x${WIN_H}"

  sleep "$SETTLE"

  rm -f "$full"
  screencapture -x -o -l "$WIN_ID" "$full" || {
    echo "screencapture -l $WIN_ID failed (Screen Recording permission?)" >&2
    return 1
  }
  [ -s "$full" ] || { echo "screencapture produced no file" >&2; return 1; }

  # Done with this instance: stop exactly the process we launched.
  kill -TERM "$OWNER_PID" 2>/dev/null || true
  [ "$ARES_PID" != "$OWNER_PID" ] && kill -TERM "$ARES_PID" 2>/dev/null || true
  for i in $(seq 1 20); do
    kill -0 "$OWNER_PID" 2>/dev/null || break
    sleep 0.2
  done
  kill -9 "$OWNER_PID" 2>/dev/null || true
  [ "$ARES_PID" != "$OWNER_PID" ] && kill -9 "$ARES_PID" 2>/dev/null || true
  OWNER_PID=""; ARES_PID=""

  python3 -I "$TOOLS/ares-frame.py" "$full" \
    --active-out "$DOCS/ares-$name.png" \
    --block-out "$capdir/ares-block.png" \
    --height 224 --window-width "$WIN_W" --window-height "$WIN_H"
}

run_one() {
  local name="$1"
  echo "== build $name"
  build_rom "$name"
  capture_one "$name"
}

case "${1:-}" in
  all) NAMES="viewer1 viewer2 viewer3 painted" ;;
  viewer1|viewer2|viewer3|painted) NAMES="$1" ;;
  *) echo "usage: $0 all | viewer1 | viewer2 | viewer3 | painted" >&2; exit 2 ;;
esac

for name in $NAMES; do
  run_one "$name"
done

echo "== ares frames in docs/ and tests/dumps/*/ares-block.png"
if [ -z "${CAPTURE_ONLY:-}" ]; then
  node tests/check-ares.js
fi
