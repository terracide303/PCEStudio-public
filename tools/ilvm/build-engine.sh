#!/bin/bash
# build-engine.sh — build the HuTrack engine as a standalone PCEAS image
# (card #212, the first slice of #198; design: docs/ROM-SOUND.md §1, §9).
#
#   tools/ilvm/build-engine.sh
#
# One command produces, under tools/gen/:
#
#   hutrack-code.bin      8,192 B   physical bank 2, page 5: engine code
#   hutrack-tables.bin    8,192 B   physical bank 3, page 4: pitch tables
#   hutrack-symbols.h               the fixed addresses for ilvm.c (#213+)
#   hutrack-image.json              sizes, symbols and the patch sites
#
# and leaves the staged, patched source tree at tools/gen/hutrack-stage/.
#
# vendor/hutrack is NEVER edited.  The build copies vendor/hutrack/lib into
# the staging tree and patches the COPY: HuTrack's parser maps a 32 KiB song
# window at $4000-$BFFF (MAP_BANK.4).  PCEStudio's song converter emits one
# 8 KiB bank, so the staged copy narrows the window to one bank at exactly
# three call sites — parser line 31, playSong line 377 (HuTrack_lib.asm),
# Process.envelopes line 1774 — leaving PUSHBANK.4/PULLBANK.4 alone (they
# only save and restore, which is harmless).  See docs/ROM-SOUND.md §3.
#
# Needs PCEAS 4.x; the repo's external PCEAS is 3.23 and cannot assemble
# HuTrack (docs/BUILD.md, docs/HUTRACK.md).  `PCEAS4` overrides the default
# `pceas4`.  `OUT` moves the output tree (the test builds into $TMPDIR).
#
# #214: the engine's RAM placement is not provisional any more.
#   ENGINE_ZP_BASE   the engine's zero page (default $2080; build.sh asserts
#                    the interpreter's page ends there or below)
#   ENGINE_BSS_BASE  the engine's .bss, at the interpreter image's
#                    __heap_start (default $2200, which is BaseRAM's start and
#                    only right when the image has no .bss)
#
# #200: PSG_TRACE=1 assembles the test-only PSG write trace — the glue's
# writes plus the two SFX reservation routines', patched into the staged
# vendor copy by pinned line — and reports its BaseRAM addresses under
# psg_trace in tools/gen/hutrack-image.json.  The shipped builds leave it
# unset and are byte-identical to before.
# Both are substituted into the staging copy of hutrack_engine.asm and
# reported as measured extents in hutrack-image.json.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$(pwd)"

PCEAS4="${PCEAS4:-pceas4}"
OUT="${OUT:-tools/gen}"
case "$OUT" in
  /*) ;;
  *) OUT="$ROOT/$OUT" ;;
esac
STAGE="${STAGE:-$OUT/hutrack-stage}"
ENGINE_ASM="$ROOT/tools/ilvm/hutrack_engine.asm"
VENDOR="$ROOT/vendor/hutrack/lib"
ENGINE_ZP_BASE="${ENGINE_ZP_BASE:-0x2080}"
ENGINE_BSS_BASE="${ENGINE_BSS_BASE:-0x2200}"
# #200: PSG_TRACE=1 assembles the test-only PSG write log (docs/ROM-SOUND.md
# §8).  It adds 307 B of BaseRAM (7 B of state + three 100-byte arrays) and
# ~10 B of code per traced write; the shipped
# builds leave it unset and the image is byte-identical to before.
PSG_TRACE="${PSG_TRACE:-0}"

if ! command -v "$PCEAS4" >/dev/null 2>&1 && [ ! -x "$PCEAS4" ]; then
  echo "PCEAS 4.x not found: set PCEAS4 or install pceas4 (docs/BUILD.md)" >&2
  exit 2
fi

#---------------------------------------------------------------- stage a copy
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -R "$VENDOR" "$STAGE/lib"
cp "$ENGINE_ASM" "$STAGE/engine.asm"
cp "$ROOT/tools/ilvm/note-table.inc" "$STAGE/note-table.inc"

# The note table is committed, but it is generated from the browser's own
# formula (renderer/pce-il.js noteFrequency); if the browser side ever
# changes, the ROM table must follow it like any other re-pin.  Regenerate
# and diff before assembling so a drift cannot reach the image.
: "${TMPDIR:?TMPDIR is not set; the note-table drift check keeps files under it}"
NT_SCRATCH=$(mktemp -d "$TMPDIR/ilvm-note-table.XXXXXX")
trap 'rm -rf "$NT_SCRATCH"' EXIT
node "$ROOT/tools/ilvm/gen-note-table.js" \
  "$NT_SCRATCH/note-table.inc" "$NT_SCRATCH/note-table.h" >/dev/null
if ! cmp -s "$NT_SCRATCH/note-table.inc" "$STAGE/note-table.inc" || \
   ! cmp -s "$NT_SCRATCH/note-table.h" "$ROOT/tools/ilvm/note-table.h"; then
  echo "note table drift: renderer/pce-il.js noteFrequency() no longer matches" \
       "tools/ilvm/note-table.inc / note-table.h; re-run" \
       "tools/ilvm/gen-note-table.js and commit the new tables" >&2
  exit 1
fi

python3 -I - "$ROOT" "$STAGE" "$ENGINE_ZP_BASE" "$ENGINE_BSS_BASE" \
  "$PSG_TRACE" <<'PY'
import os
import sys

root, stage, zp_base, bss_base, psg_trace = sys.argv[1:6]
trace_build = psg_trace == "1"

# #214: the RAM addresses are measured from the interpreter image by
# build.sh, not written into the asm.  Both must be plain 16-bit hex values;
# a typo would otherwise assemble a .org somewhere harmless and hide.
for name, value in (("ENGINE_ZP_BASE", zp_base),
                    ("ENGINE_BSS_BASE", bss_base)):
    if not (value.startswith("0x") or value.startswith("$")):
        raise SystemExit("%s=%r is not a hex address" % (name, value))
    try:
        n = int(value.replace("$", "0x"), 16)
    except ValueError:
        raise SystemExit("%s=%r is not a hex address" % (name, value))
    if not (0x2000 <= n <= 0x4000):
        raise SystemExit("%s=$%04X is not in the HuC6280 RAM page" %
                         (name, n))

asm = os.path.join(stage, "engine.asm")
with open(asm, encoding="utf-8") as fh:
    text = fh.read()
for token, value in (("@@ENGINE_ZP_BASE@@", zp_base),
                     ("@@ENGINE_BSS_BASE@@", bss_base),
                     ("@@PSG_TRACE_DEFINE@@",
                      "PSG_TRACE = 1" if trace_build
                     else "; PSG trace not enabled")):
    if token not in text:
        raise SystemExit("%s has no %s: the staging template changed" %
                         (os.path.relpath(asm, stage), token))
    text = text.replace(token, value)
with open(asm, "w", encoding="utf-8") as fh:
    fh.write(text)

# (file, vendor line number, expected line).  Patch by line rather than by
# text so the two identical parser sites are individually proven, and fail
# loudly if an upstream update moves one.
SITES = [
    ("HuTrack/HuTrack_lib.asm", 377,
     "_htk.MAP_BANK.4 A, _htk.PAGE_4000", "playSong"),
    ("HuTrack/engine/HuTrack_parser.asm", 31,
     "_htk.MAP_BANK.4 HuTrack.song.windowBank, _htk.PAGE_4000", "Parser"),
    ("HuTrack/engine/HuTrack_parser.asm", 1774,
     "_htk.MAP_BANK.4 HuTrack.song.windowBank, _htk.PAGE_4000",
     "Process.envelopes"),
]

for rel, line_no, expected, owner in SITES:
    p = os.path.join(stage, "lib", rel)
    # newline="" keeps the vendored CRLF line endings byte-identical: this
    # patch must change three lines, not re-flow the file.
    with open(p, newline="") as fh:
        lines = fh.readlines()
    if line_no > len(lines) or lines[line_no - 1].strip() != expected:
        found = lines[line_no - 1].strip() if line_no <= len(lines) else "<EOF>"
        raise SystemExit(
            "staged %s:%d is %r, expected %r — vendor/hutrack moved; "
            "update the patch in tools/ilvm/build-engine.sh" %
            (rel, line_no, found, expected))
    lines[line_no - 1] = lines[line_no - 1].replace(
        "_htk.MAP_BANK.4 ", "_htk.MAP_BANK ", 1)
    with open(p, "w", newline="") as fh:
        fh.writelines(lines)
    print("patched %s:%d (%s): MAP_BANK.4 -> MAP_BANK" % (rel, line_no, owner))

# #200's trace build: the two SFX reservation routines are the only engine
# code a note()/sfx() toy runs (setChanForSFX's reservation writes and
# chanReleaseSFX's release writes), so their PSG writes get a trace call in
# the staged copy.  Applied after the MAP_BANK patches and in descending
# line order, so each pinned line number is still the vendor one.
TRACE_SITES = [
    ("HuTrack/HuTrack_lib.asm", 259, "stz $809", "PSGT_Z 9"),
    ("HuTrack/HuTrack_lib.asm", 255, "stz $807", "PSGT_Z 7"),
    ("HuTrack/HuTrack_lib.asm", 254, "stz $804", "PSGT_Z 4"),
    ("HuTrack/HuTrack_lib.asm", 253, "stx $800", "PSGT_X 0"),
    ("HuTrack/HuTrack_lib.asm", 227, "sta $805", "PSGT_A 5"),
    ("HuTrack/HuTrack_lib.asm", 224, "stz $809", "PSGT_Z 9"),
    ("HuTrack/HuTrack_lib.asm", 220, "stz $807", "PSGT_Z 7"),
    ("HuTrack/HuTrack_lib.asm", 219, "stz $804", "PSGT_Z 4"),
    ("HuTrack/HuTrack_lib.asm", 218, "stx $800", "PSGT_X 0"),
]
if trace_build:
    for rel, line_no, expected, macro in TRACE_SITES:
        p = os.path.join(stage, "lib", rel)
        with open(p, newline="") as fh:
            lines = fh.readlines()
        if line_no > len(lines) or lines[line_no - 1].strip() != expected:
            found = (lines[line_no - 1].strip() if line_no <= len(lines)
                     else "<EOF>")
            raise SystemExit(
                "staged %s:%d is %r, expected %r — vendor/hutrack moved; "
                "update the trace patch in tools/ilvm/build-engine.sh" %
                (rel, line_no, found, expected))
        line = lines[line_no - 1]
        eol = "\r\n" if line.endswith("\r\n") else "\n"
        indent = line[:len(line) - len(line.lstrip())]
        lines.insert(line_no, indent + macro + eol)   # after the write
        with open(p, "w", newline="") as fh:
            fh.writelines(lines)
        print("traced %s:%d (%s): %s" % (rel, line_no, expected, macro))

# The narrowed window is the whole patch: no full-window mapping may survive
# in the code sources.  (hutrack.inc keeps the MAP_BANK.4 macro definition
# itself — an unused macro is harmless — so only .asm call sites count.)
for dirpath, _, names in os.walk(os.path.join(stage, "lib")):
    for name in names:
        if not name.endswith(".asm"):
            continue
        p = os.path.join(dirpath, name)
        text = open(p, encoding="utf-8", errors="replace").read()
        if "_htk.MAP_BANK.4" in text:
            raise SystemExit("staged %s still maps four banks" %
                             os.path.relpath(p, stage))
PY

#---------------------------------------------------------------- assemble
(cd "$STAGE" && PCE_INCLUDE="$STAGE/lib" "$PCEAS4" -raw -o engine.bin engine.asm)

#---------------------------------------------------------------- extract + header + report
python3 -I - "$ROOT" "$STAGE" "$OUT" "$PCEAS4" "$ENGINE_ZP_BASE" \
  "$ENGINE_BSS_BASE" "$PSG_TRACE" <<'PY'
import json
import os
import subprocess
import sys

root, stage, out, pceas, zp_base, bss_base, psg_trace = sys.argv[1:8]
trace_build = psg_trace == "1"

BANK_BYTES = 8192
CODE_BANK = 2
TABLES_BANK = 3

raw = open(os.path.join(stage, "engine.bin"), "rb").read()
if len(raw) != 4 * BANK_BYTES:
    raise SystemExit("engine.bin is %d B; expected %d (four physical banks)" %
                     (len(raw), 4 * BANK_BYTES))

# PCEAS's symbol file: a three-line header, then "bank addr label".  A
# zero-page/absolute label has no bank: PCEAS prints "-" or (as here) "f8".
symbols = {}
sym_path = os.path.join(stage, "engine.sym")
for line in open(sym_path, encoding="utf-8", errors="replace"):
    parts = line.split()
    if len(parts) < 3 or parts[0] == "Bank":
        continue
    bank, addr, name = parts[0], parts[1], parts[2]
    try:
        symbols[name] = {"bank": None if bank in ("-", "f8") else int(bank, 16),
                         "addr": int(addr, 16)}
    except ValueError:
        continue

required = {
    "HuTrackCode.start": None,
    "HuTrackCode.end": None,
    "HuTrack.Tables": None,
    "HuTrack.Tables.end": None,
    "HuTrack.NoteTable": None,
    "HuTrack.NoteTable.end": None,
    "SndGlueStart": None,
    "SndGlueEnd": None,
    "SndGlueBss.start": None,
    "SndGlueBss.end": None,
}

def need(name):
    if name not in symbols:
        raise SystemExit("PCEAS symbol file has no %s" % name)
    return symbols[name]["addr"]

for name in required:
    need(name)

code_start = need("HuTrackCode.start")
code_end = need("HuTrackCode.end")
tab_start = need("HuTrack.Tables")
tab_end = need("HuTrack.Tables.end")
note_start = need("HuTrack.NoteTable")
note_end = need("HuTrack.NoteTable.end")

if symbols["HuTrackCode.start"]["bank"] != CODE_BANK:
    raise SystemExit("HuTrackCode.start is in bank %r, expected %d" %
                     (symbols["HuTrackCode.start"]["bank"], CODE_BANK))
if symbols["HuTrack.Tables"]["bank"] != TABLES_BANK:
    raise SystemExit("HuTrack.Tables is in bank %r, expected %d" %
                     (symbols["HuTrack.Tables"]["bank"], TABLES_BANK))
if symbols["HuTrack.NoteTable"]["bank"] != TABLES_BANK:
    raise SystemExit("HuTrack.NoteTable is in bank %r, expected %d" %
                     (symbols["HuTrack.NoteTable"]["bank"], TABLES_BANK))
if code_start != 0xA000 or not (0xA000 < code_end <= 0xC000):
    raise SystemExit("code extent %04X-%04X is not inside page 5" %
                     (code_start, code_end))
if tab_start != 0x8000 or not (0x8000 < tab_end <= 0xA000):
    raise SystemExit("table extent %04X-%04X is not inside page 4" %
                     (tab_start, tab_end))
if note_start != 0x8C00 or note_end != 0x9000:
    raise SystemExit("note table extent %04X-%04X is not $8C00-$9000" %
                     (note_start, note_end))
glue_start = need("SndGlueStart")
glue_end = need("SndGlueEnd")
if symbols["SndGlueStart"]["bank"] != TABLES_BANK:
    raise SystemExit("SndGlueStart is in bank %r, expected %d" %
                     (symbols["SndGlueStart"]["bank"], TABLES_BANK))
if glue_start != 0x9000 or not (0x9000 < glue_end <= 0xA000):
    raise SystemExit("sound-op glue extent %04X-%04X is not inside "
                     "$9000-$9FFF" % (glue_start, glue_end))

code = raw[CODE_BANK * BANK_BYTES:(CODE_BANK + 1) * BANK_BYTES]
tables = raw[TABLES_BANK * BANK_BYTES:(TABLES_BANK + 1) * BANK_BYTES]
code_bytes = code_end - code_start
tables_bytes = tab_end - tab_start
note_bytes = note_end - note_start

# The whole bank is written, but only the extents are real; padding is $FF so
# a later reader can tell used bytes from unused ones.  The tables bank has
# three extents (pitch tables at $8000, the note table at $8C00, the sound-op
# glue at $9000) with $FF gaps and an $FF tail.
if any(b != 0xFF for b in code[code_bytes:]):
    raise SystemExit("code bank has non-$FF bytes after HuTrackCode.end")
if any(b != 0xFF for b in tables[tables_bytes:note_start - tab_start]):
    raise SystemExit("table bank has non-$FF bytes between the pitch tables "
                     "and the note table")
if any(b != 0xFF for b in tables[glue_end - tab_start:]):
    raise SystemExit("table bank has non-$FF bytes after SndGlueEnd")

# ---- the engine's RAM extents (#214) ---------------------------------------
# The placement came from build.sh as ENGINE_ZP_BASE/ENGINE_BSS_BASE; the
# labels in the staging asm report how much the engine really uses, so the
# manifest carries measured extents instead of the design's estimate.
required.update({"EngineZp.start": None, "EngineZp.end": None,
                 "EngineBss.start": None, "EngineBss.end": None})
for name in required:
    need(name)

zp_start = need("EngineZp.start")
zp_end = need("EngineZp.end")
bss_start = need("EngineBss.start")
bss_end = need("EngineBss.end")
if zp_start != int(zp_base, 0):
    raise SystemExit("EngineZp.start is $%04X, expected %s" %
                     (zp_start, zp_base))
if bss_start != int(bss_base, 0):
    raise SystemExit("EngineBss.start is $%04X, expected .bss base %s" %
                     (bss_start, bss_base))
if symbols.get("_hk.R1", {}).get("addr") != zp_start:
    raise SystemExit("_hk.R1 is not at the zero-page base $%04X" % zp_start)
if zp_end <= zp_start or zp_end > 0x2100:
    raise SystemExit("engine zero page $%04X-$%04X leaves the zero-page "
                     "window" % (zp_start, zp_end))
if bss_end <= bss_start or bss_end > 0x4000:
    raise SystemExit("engine .bss $%04X-$%04X is outside BaseRAM below the "
                     "stack" % (bss_start, bss_end))
glue_bss_start = need("SndGlueBss.start")
glue_bss_end = need("SndGlueBss.end")
if not (bss_start <= glue_bss_start < glue_bss_end <= bss_end):
    raise SystemExit("glue .bss $%04X-$%04X is not inside the engine's "
                     ".bss $%04X-$%04X" % (glue_bss_start, glue_bss_end,
                                           bss_start, bss_end))
zp_bytes = zp_end - zp_start
bss_bytes = bss_end - bss_start

# #200: the trace build's log addresses (docs/ROM-SOUND.md §8).  The test
# reads them from BaseRAM in a Mednafen save state; they only exist when
# PSG_TRACE=1 assembled the arrays.
psg_trace_report = None
if trace_build:
    names = ["psg_trace_ok", "psg_trace_count", "psg_trace_frame",
             "psg_trace_seen", "psg_trace_reg", "psg_trace_val",
             "psg_trace_f", "psg_trace_r", "psg_trace_v"]
    psg_trace_report = {name: need(name) for name in names}
    psg_trace_report.update({"frames": 24, "capacity": 100,
                             "format": "three parallel arrays: frame, "
                                       "register, value (one byte each)"})

def write(path, data):
    with open(path, "wb") as fh:
        fh.write(data)

write(os.path.join(out, "hutrack-code.bin"), code)
write(os.path.join(out, "hutrack-tables.bin"), tables)

# Addresses the C interpreter calls by fixed address (docs/ROM-SOUND.md §7).
INTERFACE = [
    ("HuTrackTick", "HUTRACK_TICK", "the per-toy-frame engine tick wrapper"),
    ("HuTrackEngine.EngineCall", "HUTRACK_ENGINE_CALL", "one engine tick"),
    ("HuTrackEngine.Init", "HUTRACK_INIT", "engine init"),
    ("HuTrackEngine.QueueSong", "HUTRACK_QUEUE_SONG", "queue a song pointer"),
    ("HuTrackEngine.playSong", "HUTRACK_PLAY_SONG", "start a queued song"),
    ("HuTrackEngine.stop", "HUTRACK_STOP", "stop the song"),
    ("HuTrackEngine.setChanForSFX", "HUTRACK_SET_CHAN_SFX", "reserve an SFX channel"),
    ("HuTrackEngine.chanReleaseSFX", "HUTRACK_CHAN_RELEASE_SFX", "release it"),
    ("HuTrack.returnVec", "HUTRACK_RETURN_VEC", "EngineCall's rts vector"),
    ("_hk.R1", "HUTRACK_HK_R1", "scratch register"),
    ("_hk.EAX0", "HUTRACK_HK_EAX0", "4-byte argument register"),
    ("HuTrack.NoteTable", "HUTRACK_NOTE_TABLE", "note(midi)'s 512-word table"),
    ("SndGlueReset", "HUTRACK_SND_RESET", "the sound ops' per-boot reset"),
    ("SndGlueMap", "HUTRACK_SND_MAP", "map engine banks, read song trailer"),
    ("SndGlueNote", "HUTRACK_SND_NOTE", "note(midi): table read"),
    ("SndGlueSfx", "HUTRACK_SND_SFX", "sfx(): reserve, upload, start"),
    ("SndGlueRelease", "HUTRACK_SND_RELEASE", "release(): give the channel back"),
    ("SndGlueMusic", "HUTRACK_SND_MUSIC", "music(): init, queue, play"),
    ("SndGlueTick", "HUTRACK_SND_TICK", "per-toy-frame timers and engine tick"),
    ("snd_args_frames", "HUTRACK_SND_FRAMES", "sfx()'s frames argument cell"),
]
interface = []
for symbol, define, what in INTERFACE:
    if symbol not in symbols:
        raise SystemExit("PCEAS symbol file has no %s" % symbol)
    interface.append({"symbol": symbol, "define": define,
                      "addr": symbols[symbol]["addr"],
                      "bank": symbols[symbol]["bank"],
                      "what": what})

header = [
    "/* Generated by tools/ilvm/build-engine.sh from vendor/hutrack.",
    " * Do not edit.  Card #212; design: docs/ROM-SOUND.md. */",
    "#ifndef HUTRACK_SYMBOLS_H",
    "#define HUTRACK_SYMBOLS_H",
    "",
    "/* The engine code is physical bank 2 at $A000-$BFFF (page 5); the pitch",
    " * tables are physical bank 3 at $8000-$9FFF (page 4).  Both banks are",
    " * appended after the 16 KiB interpreter image by #213. */",
    "#define HUTRACK_CODE_BANK     %du" % CODE_BANK,
    "#define HUTRACK_CODE_BASE     0x%04Xu" % code_start,
    "#define HUTRACK_CODE_BYTES    %du" % code_bytes,
    "#define HUTRACK_TABLES_BANK   %du" % TABLES_BANK,
    "#define HUTRACK_TABLES_BASE   0x%04Xu" % tab_start,
    "#define HUTRACK_TABLES_BYTES  %du" % tables_bytes,
    "",
    "/* Fixed entry points: the interpreter calls these by address through the",
    " * 14-byte HuTrackTick wrapper; there is no shared linker and no C",
    " * calling convention across the boundary. */",
]
for entry in interface:
    header.append("#define %-28s 0x%04Xu  /* %s */" %
                  (entry["define"], entry["addr"], entry["what"]))
header += ["", "#endif /* HUTRACK_SYMBOLS_H */", ""]
with open(os.path.join(out, "hutrack-symbols.h"), "w") as fh:
    fh.write("\n".join(header))

manifest = {
    "card": "#212",
    "design": "docs/ROM-SOUND.md",
    "source": "vendor/hutrack (staged copy at %s)" %
              os.path.relpath(stage, root),
    "pceas": subprocess.run([pceas], capture_output=True, text=True)
                      .stdout.strip().splitlines()[0],
    "patched_sites": [
        {"file": "HuTrack/HuTrack_lib.asm", "line": 377,
         "owner": "playSong", "from": "_htk.MAP_BANK.4 A, _htk.PAGE_4000",
         "to": "_htk.MAP_BANK A, _htk.PAGE_4000"},
        {"file": "HuTrack/engine/HuTrack_parser.asm", "line": 31,
         "owner": "Parser",
         "from": "_htk.MAP_BANK.4 HuTrack.song.windowBank, _htk.PAGE_4000",
         "to": "_htk.MAP_BANK HuTrack.song.windowBank, _htk.PAGE_4000"},
        {"file": "HuTrack/engine/HuTrack_parser.asm", "line": 1774,
         "owner": "Process.envelopes",
         "from": "_htk.MAP_BANK.4 HuTrack.song.windowBank, _htk.PAGE_4000",
         "to": "_htk.MAP_BANK HuTrack.song.windowBank, _htk.PAGE_4000"},
    ],
    "banks": {
        "code": {"bank": CODE_BANK, "page": 5, "start": code_start,
                 "end": code_end, "bytes": code_bytes,
                 "image": os.path.relpath(os.path.join(out, "hutrack-code.bin"),
                                          root),
                 "image_bytes": len(code)},
        "tables": {"bank": TABLES_BANK, "page": 4, "start": tab_start,
                   "end": tab_end, "bytes": tables_bytes,
                   "image": os.path.relpath(
                       os.path.join(out, "hutrack-tables.bin"), root),
                   "image_bytes": len(tables)},
        "note_table": {"bank": TABLES_BANK, "page": 4, "start": note_start,
                       "end": note_end, "bytes": note_bytes,
                       "source": "tools/ilvm/note-table.inc",
                       "generator": "tools/ilvm/gen-note-table.js (verified "
                                    "against the committed tables at build)"},
        "sound_glue": {"bank": TABLES_BANK, "page": 4, "start": glue_start,
                       "end": glue_end, "bytes": glue_end - glue_start,
                       "card": "#220",
                       "what": "the interpreter's sound ops (note/sfx/"
                               "release/music/tick), called by fixed address "
                               "from tools/ilvm/ilvm_sound.c"},
    },
    # #214: the engine's own RAM extents, measured from the staging assembly.
    "ram": {
        "zero_page": {"start": zp_start, "end": zp_end, "bytes": zp_bytes},
        "bss": {"start": bss_start, "end": bss_end, "bytes": bss_bytes},
        "sound_glue_bss": {"start": glue_bss_start, "end": glue_bss_end,
                           "bytes": glue_bss_end - glue_bss_start,
                           "card": "#220",
                           "what": "the sound ops' state, inside the "
                                   "engine's .bss"},
    },
    "symbols": {entry["symbol"]: {"addr": entry["addr"],
                                  "bank": entry["bank"]}
                for entry in interface},
    "psg_trace": psg_trace_report,
    "symbol_header": os.path.relpath(
        os.path.join(out, "hutrack-symbols.h"), root),
}
with open(os.path.join(out, "hutrack-image.json"), "w") as fh:
    json.dump(manifest, fh, indent=1, sort_keys=True)

print("engine code    bank %d: $%04X-$%04X  %4d B of %d  (%d free)" %
      (CODE_BANK, code_start, code_end, code_bytes, BANK_BYTES,
       BANK_BYTES - code_bytes))
print("engine tables  bank %d: $%04X-$%04X  %4d B of %d  (%d free)" %
      (TABLES_BANK, tab_start, glue_end, glue_end - tab_start, BANK_BYTES,
       BANK_BYTES - (glue_end - tab_start)))
print("  pitch tables  $%04X-$%04X  %4d B" % (tab_start, tab_end, tables_bytes))
print("  note table    $%04X-$%04X  %4d B" % (note_start, note_end, note_bytes))
print("  sound-op glue $%04X-$%04X  %4d B" % (glue_start, glue_end,
                                                glue_end - glue_start))
print("note table     bank %d: $%04X-$%04X  %4d B" %
      (TABLES_BANK, note_start, note_end, note_bytes))
print("engine RAM     zero page $%04X-$%04X  %3d B" %
      (zp_start, zp_end, zp_bytes))
print("engine RAM     .bss      $%04X-$%04X  %4d B" %
      (bss_start, bss_end, bss_bytes))
if psg_trace_report:
    print("trace log      BaseRAM   $%04X/$%04X/$%04X (f/r/v), %d frames, "
          "%d entries" % (psg_trace_report["psg_trace_f"],
                          psg_trace_report["psg_trace_r"],
                          psg_trace_report["psg_trace_v"],
                          psg_trace_report["frames"],
                          psg_trace_report["capacity"]))
print("symbols:")
for entry in interface:
    where = ("RAM $%04X" % entry["addr"]) if entry["bank"] is None else \
            ("bank %d, $%04X" % (entry["bank"], entry["addr"]))
    print("  %-32s %-16s %s" % (entry["symbol"], where, entry["what"]))
print("wrote %s" % os.path.relpath(os.path.join(out, "hutrack-code.bin"), root))
print("wrote %s" % os.path.relpath(os.path.join(out, "hutrack-tables.bin"), root))
print("wrote %s" % os.path.relpath(os.path.join(out, "hutrack-symbols.h"), root))
print("wrote %s" % os.path.relpath(os.path.join(out, "hutrack-image.json"), root))
PY

echo "vendor/hutrack untouched; staged copy left at $STAGE"
