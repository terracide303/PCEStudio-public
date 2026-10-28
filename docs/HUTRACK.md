# HuTrack: a DMF song on the console (#35, step 1)

HuTrack is the console sound driver (vendored under
[`vendor/hutrack/`](../vendor/hutrack/VENDORED.md), MIT, pinned commit). This
page records what is proven with it so far: **HuTrack's engine, fed by
HuTrack's own converter, builds a ROM that plays our own DMF in Mednafen, and
the recording contains the notes the song was written with.**

It is #35's first step. The browser DMF reader/player, the export path, DDA
samples and sound in toys are still open (last section).

## The chain

```
tools/genhutrack.py                 writes DMF 24 (our own 8-note phrase)
      │
      ├─ vendor/hutrack/utils/HuTrackConverter.py
      │        └─ tests/dumps/hutrack1/song/*.inc   (10 include files, 7,904 B)
      │
tools/hutrack.asm + vendor/hutrack/lib/HuTrack     PCEAS 4.x → 139,264 B ROM
      │
tools/capture-hutrack.sh  → Mednafen 1.32.1, pce_fast, 44.1 kHz
      │
tests/dumps/hutrack1/{mednafen.wav, mednafen.log, run.json, demo.dmf, song.json}
      │
tests/check-hutrack.js
```

Nothing in HuTrack's repository was edited: `MANIFEST.sha256` has the sha256
of all 68 vendored files, and the test re-checks it. The vendored copy was
diffed file by file against the pinned upstream clone.

## The song is ours

`tools/genhutrack.py` writes a DMF revision 24 module itself — an 8-note
C-major arpeggio (`C4 E4 G4 C5 B4 G4 E4 C4`) over a `C3/G3` bass, eight rows
per note, six VBlanks per row, four orders of one 64-row pattern (~25.6 s,
looping). No music is copied from HuTrack's examples. The DMF byte layout is
taken from the vendored converter's own reader and its test fixtures
(`utils/support/dmfReader.py`, `tests/test_tools.py`'s `module_bytes()`): every
field the writer emits is one the reader consumes.

**Measured formatting fact:** DMF's octave byte is one below the octave the
note sounds in. A first recording written with `octave = 4` for C4 came out
an octave high (523 Hz); with `octave = 3` the same note is 261.6 Hz. The
comment in `tools/genhutrack.py` says so, and the recording in
`tests/dumps/hutrack1` is the measurement.

## What the recording shows

`tests/dumps/hutrack1/mednafen.wav`: PCM16 LE stereo, 44,100 Hz, 308,843
sample frames = **7.003 s**, RMS **4,971.2** on both channels, peak 13,299.
The capture keeps whole frames and exits with SIGINT (no synthesized key or
mouse events — the rule from 2026-10-27).

A narrowband classifier over 100 ms blocks recovers from the audio alone:

- melody `C4 E4 G4 C5 B4 G4 E4 C4` — exactly `song.json`'s melody;
- bass `C3 G3 C3 G3` — exactly the DMF's alternating bass;
- note onsets at **0.10 0.90 1.70 2.50 3.30 4.10 4.90 5.70 s**, i.e. one
  every 0.8 s = 8 rows × 6 VBlanks at 60 Hz (the last order ends at ~6.5 s,
  when the phrase loops).

The ROM rebuilds **byte-identically** from the committed sources with a
PCEAS 4.x: 139,264 bytes, sha256
`c683188f47c4e9123b9496ecf246b546d163a1038aacea42ef9ac8f7b257febc`.

## Reproducing it

The converter needs Python with `numpy`, `resampy`, `numba` and `llvmlite`
(`vendor/hutrack/requirements.txt`). The song is committed, so the ROM build
itself needs only PCEAS 4.

```sh
# once: build PCEAS 4.x from vendor/huc (see BUILD.md) and expose it as pceas4
tools/build-hutrack.sh                     # assembles the committed song
PCEAS4=pceas4 tools/capture-hutrack.sh     # rebuild + Mednafen recording
node tests/check-hutrack.js                # vendor manifest, fixtures, ROM, WAV

# only when changing the song (needs the Python audio stack):
python3 tools/genhutrack.py
```

## Why PCEAS 4 and not the installed 3.23

HuTrack's engine uses dotted labels that begin with a digit
(`HuTrackEngine.7khz.IRQ`) in `lda #<label`, and its `MOVE.b` macro's
`.if` expressions contain `<label`; PCEAS 3.23 reports "Syntax error in
expression" on both. `vendor/huc`'s `src/mkit/as` (HuC mainline
`54f5c736`) assembles them unchanged. `docs/BUILD.md` has the commands.

## Proven, and not proven

Proven here: our DMF imports through the converter; the generated assets
assemble with the vendored engine; the ROM runs in Mednafen's pce_fast core;
the recording's pitches, note order, bass and tempo are the song's; the ROM
rebuilds byte-identically; the vendored files are the pinned upstream bytes.

Not proven here:

- **The recording is Mednafen, not hardware.** No real PC Engine or MiSTer run
  of this ROM exists yet.
- **Pitch is measured by narrowband power, not compared sample for sample.**
  The next step is a JS player driving `renderer/pce-psg.js`, which must match
  this same WAV numerically the way #34/#62 match theirs.
- **No browser DMF reader/player yet.** `renderer/` does not read a DMF.
- **No export path yet.** `renderer/pce-rom.js` still exports pictures; it
  does not put a song + HuTrack in the .pce.
- **DDA samples, SFX, note effects (slides/vibrato), and the tracker UI** are
  untested; the engine supports them, this fixture does not exercise them.
- **The checker was written by @design**, the seat that wrote the fixture and
  the song (workshop RULES.md rule 2). @review owes it a cold break before
  this evidence closes anything.
- The converter's `--no_gui` path sets its internal `songName` to the literal
  `"converter"` while importing (`utils/HuTrackConverter.py`); it affects only
  the CLI's default output name, not the song title/author embedded from the
  DMF, so PCEStudio passes `--songname` and the DMF carries its own metadata.
