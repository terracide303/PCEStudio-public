#!/usr/bin/env python3
"""genhutrack.py — build our own test songs as legacy DMFs, convert them with
HuTrack's converter, and report what came out.

This is #35's step (1): prove that HuTrack's engine, fed by HuTrack's own
converter, builds a ROM that plays a DMF in Mednafen.  The songs are ours
(a C-major arpeggio over a C/G bass, no borrowed music), written here as DMF
revision 24 — the legacy format Furnace exports and HuTrack's converter
imports.

`--song 2` writes a second song that reaches the parts of the converter and
the pattern compression song 1 never does (two instruments, two waveforms,
envelope loops, a relative arpeggio, two effect columns, a bare-note row, a
volume-only row, a note cut, a repeated order, a 30-row empty run).  Its
purpose is #35's export step: PCEAS assembles it and the JS converter must
produce the same bytes without ever seeing them.

The byte layout below follows the working example in the vendored copy:
tests/test_tools.py's `module_bytes()` and tests/run_runtime.py's `prepare()`
write DMF 24 modules field by field, and utils/support/dmfReader.py reads
them.  Every field this writer emits is consumed by that reader; there is no
guesswork about the format (see docs/HUTRACK.md).

Output (committed with the recording, under tests/dumps/hutrack1/):
  demo.dmf            the song, DMF 24 payload wrapped in zlib (DefleMask and
                      Furnace store DMF zlib-compressed)
  song/demo*.inc      HuTrack song assets, written by the vendored converter;
                      committed so the ROM can be rebuilt with PCEAS alone

The converter needs numpy + resampy (numba/llvmlite) — see
vendor/hutrack/requirements.txt.  Run this with a Python that has them:

    make -C tools hutrack PYTHON=/path/to/venv/bin/python
"""

import argparse
import hashlib
import json
import struct
import subprocess
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tests" / "dumps" / "hutrack1"
CONVERTER = ROOT / "vendor" / "hutrack" / "utils" / "HuTrackConverter.py"
SONG_NAME = "PCEStudio HuTrack test"
AUTHOR = "PCEStudio"

# --- the song -------------------------------------------------------------
#
# Note codes are DefleMask's: 0 is C of the row's octave (only when the octave
# is non-zero), 1..11 are C#..B, 12 is C of the next octave (dmfReader.py's
# getPatternData maps these onto HuTrack's linear C0..B6 index).  A row is six
# little-endian words: note, octave, volume, effect code, effect argument,
# instrument; 0xFFFF means "field absent".

SEMITONE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def note(name):
    """'C4' -> (note, octave) in the encoding the DMF reader expects.

    DMF's octave byte is one below the octave the note sounds in: octave 3
    with note 0 selects C4 (261.6 Hz), measured from the Mednafen recording
    in tests/dumps/hutrack1.  See docs/HUTRACK.md.
    """
    letter, octave = name[:-1], int(name[-1])
    return SEMITONE[letter], octave - 1


def macro(values):
    """A DMF envelope macro: size, dwords, then the loop position."""
    data = bytes([len(values)])
    data += b"".join(struct.pack("<i", v) for v in values)
    if values:
        data += bytes([0xFF])  # 0xFF = no loop, like the vendored fixture
    return data


def empty_row():
    return struct.pack("<6H", 0, 0, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF)


def note_row(name, instrument=0):
    n, octave = note(name)
    return struct.pack("<6H", n, octave, 0xFFFF, 0xFFFF, 0xFFFF, instrument)


# Eight bars: an eight-note arpeggio, then the same phrase an octave down.
MELODY = ["C4", "E4", "G4", "C5", "B4", "G4", "E4", "C4"]
BASS = ["C3", "G3", "C3", "G3"]

# Song 2 (#35's export step): deliberately exercises what song 1 never
# reaches in the converter — two instruments, two waveforms, envelope loops,
# a relative arpeggio (the signed-dword, -12, &255 path), two effect columns,
# a bare-note row, a volume-only row, a note cut, repeated and distinct
# patterns (the dedup matrix is [0, 1, 0]) and an empty run of 30 followed by
# a remainder.  Its job is to give the JS converter and assembler bytes
# PCEAS produced from the same DMF, so agreement cannot come from a copied
# fixture.
SONG2_NAME = "PCEStudio HuTrack test 2"
SONG2_MELODY = [["C4", "E4", "G4", "C5", "B4", "G4", "E4", "C4"],
                ["A3", "C4", "E4", "A4", "G4", "E4", "C4", "A3"],
                ["C4", "E4", "G4", "C5", "B4", "G4", "E4", "C4"]]
SONG2_BASS = ["C3", "G3", "C3"]


def dmf_row(note=0, octave=0, volume=0xFFFF, fx=(), instrument=0xFFFF,
            columns=1):
    """One DMF pattern row: note, octave, volume, `columns` (code, arg)
    pairs, instrument.  Each field is a little-endian word; the note and
    octave words carry their reader's padding byte (0) in the high half."""
    fx = list(fx) + [(0xFFFF, 0xFFFF)] * (columns - len(fx))
    words = [note, octave, volume]
    for code, arg in fx:
        words += [code, arg]
    words.append(instrument)
    return struct.pack("<%dH" % len(words), *words)


def dword_macro(values):
    """A DMF envelope macro: size, then a signed dword per step, then the
    loop position (0xFF = none)."""
    data = bytes([len(values)])
    data += b"".join(struct.pack("<i", v) for v in values)
    if values:
        data += bytes([0xFF])
    return data


def build_song2():
    rows = 32
    orders = 3
    speed = 4

    data = b".DelekDefleMask."
    data += bytes([24, 5])
    data += bytes([len(SONG2_NAME)]) + SONG2_NAME.encode()
    data += bytes([len(AUTHOR)]) + AUTHOR.encode()
    data += bytes([2, 8])           # highlight nibbles (editor-only)
    data += bytes([0])              # time base - 1
    data += bytes([speed, speed])
    data += bytes([1])              # NTSC/VBlank
    data += bytes([0])              # custom Hz off
    data += b"060"
    data += struct.pack("<I", rows)
    data += bytes([orders])
    data += bytes([0] * (6 * orders))   # every channel's slots -> 0

    # Two instruments.
    data += bytes([2])
    # 0: a looping volume envelope, a relative arpeggio, two waveforms.
    data += bytes([5]) + b"lead\x00" + bytes([0])          # name, standard
    data += bytes([4]) + b"".join(struct.pack("<i", v)
                                  for v in (31, 28, 20, 12)) + bytes([2])
    data += bytes([3]) + b"".join(struct.pack("<i", v)
                                  for v in (12, 12, 0)) + bytes([1])
    data += bytes([0])                                     # arp mode relative
    data += bytes([0])                                     # no noise env
    data += bytes([2]) + b"".join(struct.pack("<i", v)
                                  for v in (0, 1)) + bytes([0])
    # 1: constant volume, wave 1, no envelopes.
    data += bytes([4]) + b"bass" + bytes([0])
    data += bytes([1]) + struct.pack("<i", 31) + bytes([0xFF])
    data += bytes([0])                                     # no arpeggio
    data += bytes([0])                                     # arp mode
    data += bytes([0])                                     # no noise
    data += bytes([1]) + struct.pack("<i", 1) + bytes([0xFF])

    # Two waveforms: the ramp, and a triangle.
    data += bytes([2])
    data += struct.pack("<I", 32)
    data += struct.pack("<32I", *range(32))
    tri = [min(i, 31 - i) * 2 for i in range(32)]
    data += struct.pack("<I", 32)
    data += struct.pack("<32I", *tri)

    columns = 2
    for channel in range(6):
        data += bytes([columns])
        for order in range(orders):
            for row in range(rows):
                nb = 0
                octave = 0
                volume = 0xFFFF
                fx = ()
                instrument = 0xFFFF
                if channel == 0:
                    if row % 4 == 0:
                        name = SONG2_MELODY[order][(row // 4) % 8]
                        n, o = note(name)
                        nb, octave = n, o
                        instrument = (row // 4) % 2
                    if row == 2:
                        volume = 20               # a volume-only row
                    if order % 2 == 0 and row == 0:
                        fx = [(0x0F, speed)]      # speed effect, FX1
                    if order == 1 and row == 4:
                        fx = [(0x10, 1)]          # waveform effect, FX1
                    if order == 1 and row == 5:
                        fx = [(0x0F, speed), (0x10, 1)]   # both columns
                elif channel == 1:
                    if row % 8 == 0:
                        n, o = note(SONG2_BASS[(row // 8) % 3])
                        nb, octave = n, o
                        instrument = 1
                elif channel == 2:
                    if row == 0:
                        n, o = note("C5")
                        nb, octave, instrument = n, o, 0  # note+instr
                    elif row == 8:
                        n, o = note("E5")
                        nb, octave = n, o            # a bare note (mask 1)
                    elif row == 16:
                        nb = 100                     # a note cut
                data += dmf_row(nb, octave, volume, fx, instrument,
                                columns)

    data += bytes([0])              # no PCM samples
    return data


def build_song():
    rows = 64                       # DMF row count (1..256; a byte in the header)
    orders = 4                      # four orders of the one pattern -> 25.6 s
    speed = 6                       # rows advance every 6 VBlanks (60 Hz)

    data = b".DelekDefleMask."
    data += bytes([24, 5])          # revision 24, platform 5 = PC Engine
    data += bytes([len(SONG_NAME)]) + SONG_NAME.encode()
    data += bytes([len(AUTHOR)]) + AUTHOR.encode()
    data += bytes([4, 16])          # highlight nibbles (editor-only)
    data += bytes([0])              # time base - 1
    data += bytes([speed, speed])   # tick speeds for the two row speeds
    data += bytes([1])              # frame mode 1 = NTSC
    data += bytes([0])              # custom Hz off
    data += b"060"                  # custom-Hz operands (ignored)
    data += struct.pack("<I", rows)
    data += bytes([orders])
    # Pattern matrix: `orders` bytes per channel, each an index into that
    # channel's pattern slots.  All zero: every channel repeats slot 0.
    data += bytes([0] * (6 * orders))

    # One instrument: constant full volume, no arpeggio/noise/wave envelopes,
    # and instrument 0 selects waveform 0 through the wavetable macro [0].
    data += bytes([1])              # instrument count
    data += bytes([1, 0, 0])        # name length 1, NUL name, standard mode
    data += macro([31])             # volume envelope: constant 31
    data += macro([])               # arpeggio: none
    data += bytes([0])              # arpeggio mode (relative)
    data += macro([])               # noise: none
    data += macro([0])              # wavetable: wave 0

    # One waveform: a 32-step ramp, so the tone has a strong fundamental and
    # many harmonics to identify in the recording.
    data += bytes([1])              # waveform count
    data += struct.pack("<I", 32)
    data += struct.pack("<32I", *range(32))

    for channel in range(6):
        data += bytes([1])          # one effect column
        # DMF stores `orders` pattern slots per channel; the order list above
        # points them all at slot 0, so write the same pattern into every slot.
        for _ in range(orders):
            for row in range(rows):
                if channel == 0 and row % 8 == 0:
                    data += note_row(MELODY[(row // 8) % len(MELODY)])
                elif channel == 1 and row % 16 == 0:
                    data += note_row(BASS[(row // 16) % len(BASS)])
                else:
                    data += empty_row()

    # PCM section: none.
    data += bytes([0])
    return data


def main():
    global OUT
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--song", type=int, choices=(1, 2), default=1,
                    help="which test song to write (default 1)")
    ap.add_argument("--song-only", action="store_true",
                    help="write the DMF and its description, then stop "
                         "(no converter; stdlib only)")
    ap.add_argument("--out", default=None,
                    help="output directory (default: the committed fixtures "
                         "for --song)")
    args = ap.parse_args()
    OUT = Path(args.out) if args.out else (
        ROOT / "tests" / "dumps" / ("hutrack1" if args.song == 1
                                    else "hutrack2"))

    raw = build_song() if args.song == 1 else build_song2()
    OUT.mkdir(parents=True, exist_ok=True)
    dmf = OUT / ("demo.dmf" if args.song == 1 else "demo2.dmf")
    dmf.write_bytes(zlib.compress(raw))
    shown = dmf.relative_to(ROOT) if dmf.is_relative_to(ROOT) else dmf
    print(f"wrote {shown} ({len(raw)} bytes raw, "
          f"{dmf.stat().st_size} compressed, sha256 "
          f"{hashlib.sha256(raw).hexdigest()})")

    song = {
        "dmf": {
            "raw_bytes": len(raw),
            "raw_sha256": hashlib.sha256(raw).hexdigest(),
            "file_bytes": dmf.stat().st_size,
            "file_sha256": hashlib.sha256(dmf.read_bytes()).hexdigest(),
        },
        "octave_note": "DMF octave byte = sounding octave - 1 (measured)",
    }
    if args.song == 1:
        song.update({"rows": 64, "orders": 4, "speed": 6, "channels": 6,
                     "melody": MELODY, "bass": BASS})
        song_name = "demo"
    else:
        song.update({
            "rows": 32, "orders": 3, "speed": 4, "channels": 6,
            "columns": 2,
            "melody": SONG2_MELODY, "bass": SONG2_BASS,
            "instruments": [
                {"name": "lead", "volumeEnv": [31, 28, 20, 12],
                 "volumeEnvLoop": 2, "arpeggioEnv": [12, 12, 0],
                 "arpeggioMode": 0, "arpeggioLoop": 1,
                 "wavetableEnv": [0, 1], "wavetableLoop": 0},
                {"name": "bass", "volumeEnv": [31], "wavetableEnv": [1]}
            ],
            "features": [
                "two instruments and two waveforms",
                "envelope loops",
                "a relative arpeggio (signed dword, -12, &255)",
                "two effect columns: 0x0F speed, 0x10 waveform",
                "a bare-note row (mask 1, note +128)",
                "a volume-only row (mask 8)",
                "a note cut (compressed 224)",
                "repeated orders 0 and 2 (dedup matrix [0, 1, 0])",
                "a 30-row empty run plus a 2-row remainder"
            ]
        })
        song_name = "demo2"
    if args.song_only:
        _write_json(OUT / "song.json", song)
        return

    result = subprocess.run(
        [sys.executable, str(CONVERTER), "--no_gui",
         "--filein", str(dmf),
         "--destinationPath", str(OUT),
         "--songname", song_name,
         "--subfolder", "song",
         "--includePath", ""],  # include lines become "song/<name>.*.inc"
        capture_output=True, text=True)
    if result.returncode != 0 or "Successfully converted" not in result.stdout:
        sys.stderr.write(result.stdout)
        sys.stderr.write(result.stderr)
        sys.exit(f"HuTrack converter failed (exit {result.returncode})")

    incs = sorted((OUT / "song").glob("*.inc"))
    song["includes"] = {
        p.name: {"bytes": p.stat().st_size,
                 "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
        for p in incs
    }
    _write_json(OUT / "song.json", song)
    print(f"converted: {len(incs)} include files, "
          f"{sum(p.stat().st_size for p in incs)} bytes total")
    for path in incs:
        print(f"  {path.relative_to(ROOT)} {path.stat().st_size}")


def _write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n")


if __name__ == "__main__":
    main()
