#!/bin/bash
# tests/all.sh — the one command a fresh clone runs (#83).
#
#   tests/all.sh
#
# It builds every ROM the suites read (`make -C tools`), then runs every
# `tests/check*.js` and `tests/*-mutation.js`, and reports one verdict per
# suite.  Exit 0 only if no suite failed; a suite that exits non-zero is a
# FAIL and its tail is printed.  Requires the repo's external tools on PATH:
# pceas (docs/BUILD.md); check-hutrack's ROM rebuild also wants pceas4, and
# check-il-console wants llvm-mos and Mednafen — without them those suites
# print their own SKIP lines and still check what they can.
#
# THREE outcomes, because "not checked" and "checked and passed" must not
# look the same:
#
#   PASS  exit 0 and no SKIP line: every check in the suite ran and passed.
#   SKIP  exit 0 but the suite printed a line beginning with SKIP (checked
#         leniently: leading spaces allowed, then "SKIP:" or "SKIP ").  The
#         skipped checks are named and printed here; the suite is NOT
#         counted as a pass.  On a machine without a screen this is
#         check-ares (the ares captures in docs/ are a person's screenshot
#         run, tools/capture-ares.sh).
#   FAIL  non-zero exit: the last lines of its log are printed.
#
# The logs live in a scratch directory under $TMPDIR; it is removed at exit
# unless KEEP=1 (then their path is printed).
#
# Make overridable: MAKE=/path/to/make tests/all.sh

set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

MAKE="${MAKE:-make}"
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/pce-all-XXXXXX")" || exit 2
cleanup() {
  if [ "${KEEP:-0}" = "1" ]; then
    echo "logs kept in $SCRATCH"
  else
    rm -rf "$SCRATCH"
  fi
}
trap cleanup EXIT

echo "== make -C tools (builds the ROMs the suites read)"
if ! "$MAKE" -C tools >"$SCRATCH/make.log" 2>&1; then
  echo "FAIL make -C tools"
  tail -n 30 "$SCRATCH/make.log" | sed 's/^/    /'
  exit 2
fi
echo "ok   make -C tools"

suites=(tests/check*.js tests/*-mutation.js)
if [ ${#suites[@]} -eq 0 ]; then
  echo "FAIL no suites matched tests/check*.js or tests/*-mutation.js"
  exit 2
fi

pass=()
skips=()
failed=()
for t in "${suites[@]}"; do
  name="$(basename "$t" .js)"
  log="$SCRATCH/$name.log"
  node "$t" >"$log" 2>&1
  status=$?
  if [ $status -ne 0 ]; then
    failed+=("$name")
    echo "FAIL $name (exit $status)"
    tail -n 20 "$log" | sed 's/^/    /'
  elif grep -qE '^[[:space:]]*SKIP([: ]|$)' "$log"; then
    skips+=("$name")
    echo "SKIP $name (exit 0; some checks were not run):"
    grep -E '^[[:space:]]*SKIP([: ]|$)' "$log" | sed 's/^/    /'
  else
    pass+=("$name")
    echo "PASS $name"
  fi
done

echo "================================================================"
echo "${#pass[@]} suite(s) PASS, ${#skips[@]} SKIP, ${#failed[@]} FAIL"
if [ ${#skips[@]} -gt 0 ]; then
  echo "  SKIP (not verified): ${skips[*]}"
fi
if [ ${#failed[@]} -gt 0 ]; then
  echo "  FAIL: ${failed[*]}"
  exit 1
fi
exit 0
