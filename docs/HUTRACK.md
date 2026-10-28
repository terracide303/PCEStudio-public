# HuTrack: a DMF song on the console (#35, step 1)

HuTrack is the console sound driver (vendored under
[`vendor/hutrack/`](../vendor/hutrack/VENDORED.md), MIT, pinned commit). This
page records what is proven with it so far: **HuTrack's engine, fed by
HuTrack's own converter, builds a ROM that plays our own DMF in Mednafen, and
the recording contains the notes the song was written with.**

It is #35's first two steps: step 1 (the console side, below) and step 2
(the browser side: our own DMF reader plus a JS port of the engine's PSG
writes, `renderer/pce-dmf.js` + `renderer/pce-song.js`). The export path,
effects, DDA samples and sound in toys are still open (last section).

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
node tests/check-dmf.js                    # our DMF reader + the JS player vs
                                           # the same recording (no PCEAS needed)

# only when changing the song (needs the Python audio stack):
python3 tools/genhutrack.py
```

## Why PCEAS 4 and not the installed 3.23

HuTrack's engine uses dotted labels that begin with a digit
(`HuTrackEngine.7khz.IRQ`) in `lda #<label`, and its `MOVE.b` macro's
`.if` expressions contain `<label`; PCEAS 3.23 reports "Syntax error in
expression" on both. `vendor/huc`'s `src/mkit/as` (HuC mainline
`54f5c736`) assembles them unchanged. `docs/BUILD.md` has the commands.

## The browser player (step 2)

`renderer/pce-dmf.js` is our own DMF reader (no converter code is run or
copied; the layout is taken from the format the vendored reader consumes).
`renderer/pce-song.js` is the port of the parts of HuTrack's engine a plain
DMF song uses: the two Reset rounds, the VBlank tick, one row per channel
per parser tick with the order list wrapping, `anchor = note + 60` into
HuTrack's own period tables and its octave shifts/12-bit clamp, the volume
envelope (`floor(driverVolume * value / 31)` — `HuTrack.Math.volume`), the
waveform envelope, and `.copy.wave`'s exact DDA/off control toggles around
the 32-step upload. It feeds `renderer/pce-psg.js`, #34's sample-exact PSG
model. Effect columns, arpeggio envelopes, DDA/PCM and SFX are refused with
a code (`song-fx`, `song-arp`, `song-pcm`, ...), not silently dropped.

What `node tests/check-dmf.js` proves:

- **The reader and the converter read the same song.** The DMF's notes are
  C4 E4 G4 C5 B4 G4 E4 C4 over C3 G3 C3 G3; the converter's committed
  compressed pattern includes are decoded here with the ENGINE's mask/skip
  rules and yield the same note rows (8 and 4 per pattern), and the wave
  and instrument includes carry the same 32-step ramp, volume 31 and wave
  0. The injected refusals (magic, version, platform, truncation, trailing
  data) each fail by code.
- **The player emits HuTrack's sequence.** 446 power-on writes ($801=$FF
  and six channels of $805=$FF, $804=$40/$00, $807=0, 32 zero wave steps,
  twice); the first note's 84 writes (frequency, the DDA/off toggles around
  the 32-step upload, then $9F) on the sixth EngineCall; ten writes on every
  later frame (select/R2/R3/select/R4 twice); notes every 48 VBlanks for the
  melody and 96 for the bass. The periods are HuTrack's table values (C4
  427, E4 339, G4 285, C5 213, B4 226, C3 855, G3 571) and each equals the
  equal-tempered pitch to within 0.5%.
- **The audio is the recording's, note by note.** Rendered through
  pce-psg.js and compared with `tests/dumps/hutrack1/mednafen.wav`: the model
  starts 74 samples before the recording's first sample; the melody's peak
  frequency matches the recording's within 0.44 Hz across all eight notes;
  the RMS ratio is within 2% on E4 (twice), C5 and B4 and within 5% on the
  other C4. The two G4 notes differ by 19% and 5% because the bass G3's
  second harmonic lands exactly on G4's fundamental — their sum is
  phase-sensitive (same for C4 against C3). Model peak 13,536 vs the
  recording's 13,299.

Measured limitation, not hidden: **this is not sample-for-sample equality.**
The engine writes inside the VBlank IRQ, so each write's cycle offset comes
from the IRQ entry latency, the 7 kHz timer IRQ and the engine's instruction
stream. The port keeps the write order and a fixed intra-frame spacing
(`cyclesPerWrite`, default 12 cycles — an order-preserving approximation),
not those offsets, so the two voices' relative phase is not the console's.
The consequential measurement is the waveform correlation: 0.864 over the
first 1.4 s at its best lag. The pitch and level measurements above are
unaffected because they do not depend on that phase.

## Proven, and not proven

Proven here: our DMF imports through the converter; the generated assets
assemble with the vendored engine; the ROM runs in Mednafen's pce_fast core;
the recording's pitches, note order, bass and tempo are the song's; the ROM
rebuilds byte-identically; the vendored files are the pinned upstream bytes.
Step 2 also proves our own reader reads the same notes and waves, and the JS
port of the engine produces the same PSG sequence and the recording's
pitches and levels (measurements above).

Not proven here:

- **The recording is Mednafen, not hardware.** No real PC Engine or MiSTer run
  of this ROM exists yet.
- **Our DMF has not been opened in Furnace** (Furnace is not installed here).
  It is written against the format the vendored reader consumes — legacy DMF
  24, the shape Furnace exports — and the converter accepts it, but a Furnace
  round-trip (open, save, reconvert) is still owed.
- **The JS player is not sample-exact.** The missing piece is the engine's
  per-write cycle offsets (IRQ entry, the 7 kHz timer IRQ, the instruction
  stream); without them the two voices' relative phase is not the console's
  (waveform correlation 0.864 over 1.4 s). Pitch and level are right;
  waveform equality is not claimed.
- **The browser path is not exercised.** `pce-dmf.js`'s inflation uses Node's
  zlib in the test; the browser's `DecompressionStream` branch is written but
  untested, and no page plays a song yet.
- **No export path yet.** `renderer/pce-rom.js` still exports pictures; it
  does not put a song + HuTrack in the .pce.
- **Effect columns, arpeggio envelopes, DDA samples, SFX, LFO and the music
  fade** are refused by the player, not implemented. The engine supports
  them; this fixture does not exercise them.
- **The checkers were written by @design** — `check-hutrack.js` and
  `check-dmf.js` — the seat that wrote the fixture, the song, the reader and
  the player (workshop RULES.md rule 2). @review owes both a cold break.
- The converter's `--no_gui` path sets its internal `songName` to the literal
  `"converter"` while importing (`utils/HuTrackConverter.py`); it affects only
  the CLI's default output name, not the song title/author embedded from the
  DMF, so PCEStudio passes `--songname` and the DMF carries its own metadata.
