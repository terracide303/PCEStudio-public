# HuTrack: a DMF song on the console (#35, step 1)

HuTrack is the console sound driver (vendored under
[`vendor/hutrack/`](../vendor/hutrack/VENDORED.md), MIT, pinned commit). This
page records what is proven with it so far: **HuTrack's engine, fed by
HuTrack's own converter, builds a ROM that plays our own DMF in Mednafen, and
the recording contains the notes the song was written with.**

It covers #35's first three steps: step 1 (the console side, below), step 2
(the browser side: our own DMF reader plus a JS port of the engine's PSG
writes, `renderer/pce-dmf.js` + `renderer/pce-song.js`) and step 3 (the
export: a DMF song converted and assembled in the browser into the `.pce`,
byte-identical to PCEAS's build — see "The export"). Effects, DDA samples and
sound in toys are still open (last section).

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
node tests/check-export-song.js            # the browser export path: the JS
                                           # converter vs the Python converter's
                                           # includes, and the JS ROM vs PCEAS
# add HUTRACK_PYTHON=/path/to/venv/bin/python to the last line to re-run the
# vendored converter and re-prove the fixtures instead of trusting them

make -C tools engine                       # refresh renderer/hutrack-engine.bin
                                           # (after a tools/hutrack.asm change)

# only when changing a song (needs the Python audio stack):
python3 tools/genhutrack.py                # song 1 (tests/dumps/hutrack1)
python3 tools/genhutrack.py --song 2       # song 2 (tests/dumps/hutrack2)
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

- **The envelopes in motion (#72).**  demo.dmf's one instrument has a
  one-step, held volume envelope and a one-wave, held waveform envelope, so
  the loop branches are never entered; REVIEW-35's M05 (never loop) and M06
  (never consult the waveform envelope) therefore passed the check above.
  A second legal song — the same channel-0 notes with a four-step volume
  envelope that loops to step 1 (`[31,20,10,0]`) and a three-waveform
  envelope that walks 0,1,2 and loops to 0 — is traced frame by frame: each
  frame's 32 wave steps must be the selected waveform's, and its last R4
  write must be the envelope's level (`$9F` 31 at frame 6, then `$94` 20,
  `$8A` 10, `$80` 0, and `$94` again at frame 10 after the loop).  The
  expected sequence is transcribed from `HuTrack_parser.asm`
  (`Channel.waveformEnv`, `Channel.volumeEnv`, `Process.envelopes`), not
  from the port, and fixture self-checks refuse a fixture whose loop writes
  the value a hold would have kept.  `node tests/music-mutation.js` re-runs
  M05, M06 and M11 and requires each check to fail.

Measured limitation, not hidden: **this is not sample-for-sample equality.**
The engine writes inside the VBlank IRQ, so each write's cycle offset comes
from the IRQ entry latency, the 7 kHz timer IRQ and the engine's instruction
stream. The port keeps the write order and a fixed intra-frame spacing
(`cyclesPerWrite`, default 12 cycles — an order-preserving approximation),
not those offsets, so the two voices' relative phase is not the console's.
The consequential measurement is the waveform correlation: 0.864 over the
first 1.4 s at its best lag. The pitch and level measurements above are
unaffected because they do not depend on that phase.

## The export (step 3)

The browser cannot run HuTrack's Python converter or PCEAS, so the export
route replaces both:

```
DMF bytes ─ renderer/pce-dmf.js ──► one module object
                                      │
             renderer/pce-hutrack.js  │  convert()  → the 10 include files
                                      │  assemble() → the 8 KiB song bank
                                      ▼
renderer/hutrack-engine.bin ──► renderer/pce-rom.js buildSongRom() → .pce
      (banks $00-$0F, committed)
```

- **`renderer/pce-hutrack.js`** — `convert(module, options)` writes the same
  ten `.inc` files HuTrack's `HuTrackExportPCE` writes, from the module
  `pce-dmf.js` parsed.  It reproduces the pattern compression (the note+octave
  byte, the field mask, `0xe1+n` empty-row runs, per-channel pattern
  deduplication), the instrument/arpeggio/waveform include blocks and the
  header.  `assemble(files, entry)` then assembles that small language —
  labels at column 0, `.include`, `.page 2`, `.db`, `.dw`, `bank(label)` —
  into the bank's bytes.  `.page 2` is ignored inside one bank and the
  assembler refuses a song that outgrows it, which is the only case where
  PCEAS would move a label.
- **`renderer/hutrack-engine.bin`** — banks $00-$0F of `tools/hutrack.asm`'s
  build: startup, MAIN, the HuTrack engine and its pitch tables.  They are
  the same for every song, so they are extracted from the PCEAS ROM and
  committed, exactly like `renderer/viewer-bank0.bin`.  `tools/extract_engine.py`
  refuses if the two songs' engine banks disagree; `make -C tools engine`
  regenerates it after any `tools/hutrack.asm` change.
- **`renderer/pce-rom.js` `buildSongRom({ engine, song })`** — a separate
  function beside the picture exporter: 17 banks, `0xff` fill, engine at
  bank $00, the assembled song at bank $10, exactly where
  `tools/hutrack.asm`'s `.bank $10, "Song"` / `.org $4000` puts it.

### The second song

`tools/genhutrack.py --song 2` writes `tests/dumps/hutrack2/demo2.dmf`, a
32-row, three-order, two-effect-column song built to reach what song 1 never
does: two instruments, two waveforms, envelope loops, a relative arpeggio
(the signed-dword, `-12`, `&255` path), FX1 and FX2 together, a bare-note row
(mask 1), a volume-only row (mask 8), a note cut (`0xe0`), a repeated order
(the deduplication matrix is `[0, 1, 0]`; the converter's `Pattern.compare`
path) and a 30-row empty run plus a two-row remainder (both `0xe1+n`
boundaries).  Its includes were produced by the vendored Python converter
(9,590 B, 10 files) and committed; the JS converter never saw them when it
was written.

### What `node tests/check-export-song.js` proves

- **Same include bytes.** For both songs, all ten files from `convert()` are
  byte-identical to the committed fixtures, whose sha256s `song.json`
  records.  With `HUTRACK_PYTHON` pointing at a Python that has numpy and
  resampy, the vendored converter is re-run into a temporary directory first,
  so "the fixture is Python's output" is re-proven rather than trusted
  (otherwise that check reports `skip`, not pass).
- **Same ROM.** `build-hutrack.sh` rebuilds both songs with PCEAS 4.x into a
  temporary tree; `buildSongRom()`'s output must equal the whole 139,264-byte
  ROM, not just the song bank.  Song 1: 269 B of song bank, sha256
  `c683188f47c4e912…` — the ROM `run.json` records, so the export's
  "plays the same as hutrack1" is a bytes claim and `mednafen.wav` already
  covers it.  Song 2: 381 B, sha256 `78b5281e14e46241…`.  The committed
  engine image must equal both builds' banks $00-$0F
  (`370dfd6a296ea767…`), so a stale asset fails the test instead of shipping.
  Without PCEAS 4 the comparison reports `skip`, not pass.
- **Refusals by code.** `song-pcm` (samples need numpy/resampy's resampler),
  `song-volume`, `song-note`, `song-effect` (code > 1 byte; a waveform index
  the song lacks), `song-arp`, `song-instrument`, `song-name`; and for the
  assembler `song-bank`, `song-label`, `song-value`, `song-syntax`.
- **The engine image is copied whole (#72).**  The comparison above is
  against the one committed engine, whose banks `$02-$07` and `$0A-$0F` are
  `0xff` filler, so a `buildSongRom()` that copied only fifteen banks stayed
  byte-identical (REVIEW-35's M11).  The check now also drives
  `buildSongRom()` with a synthetic 16-bank engine whose every bank,
  including `$0F`, carries data, and requires the ROM's first sixteen banks
  to equal it byte for byte — and its fixture self-checks refuse an engine
  whose tail bank is filler.  No PCEAS and no Python needed.
- **The assembler's own semantics**: labels resolve to bank-relative CPU
  addresses (`$4000 + offset`) and a forward `.dw` reference resolves.

### Test sensitivity, measured (not rule-2 proof)

The test was written by the same seat as the converter, so it proves nothing
about itself until `@review` breaks it cold.  As a first measurement, eight
single-line breaks were put into `pce-hutrack.js` one at a time: instrument
and volume mask bits swapped; the empty-run base `0xe1`→`0xe0`; the
`.pcmData` include dropped from `song.inc`; `.dw` emitted big-endian; the
bare-note `+128` condition narrowed to `mask < 1`; deduplication disabled; a
fake mask byte; the arpeggio's `-12` relative offset removed.  **All eight
fail the test.**  Two of them — the `+128` condition and the `-12` offset —
are caught only by song 2, which is why it exists.

## Proven, and not proven

Proven here: our DMF imports through the converter; the generated assets
assemble with the vendored engine; the ROM runs in Mednafen's pce_fast core;
the recording's pitches, note order, bass and tempo are the song's; the ROM
rebuilds byte-identically; the vendored files are the pinned upstream bytes.
Step 2 also proves our own reader reads the same notes and waves, and the JS
port of the engine produces the same PSG sequence and the recording's
pitches and levels (measurements above).  Step 3 proves the browser can
produce the console's ROM: our converter's includes match HuTrack's Python
converter's byte for byte on two songs, and our assembly of them plus the
committed engine banks is the same 139,264 bytes PCEAS emits.

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
- **The browser path is not exercised by a page.** `pce-dmf.js`'s inflation
  uses Node's zlib in the tests; the browser's `DecompressionStream` branch is
  written but untested.  `pce-hutrack.js`'s `convert()`/`assemble()` are
  UMD modules like every other renderer file, but no page calls them yet:
  there is no "export this DMF" button, and no browser preview of a song.
- **The converter is proven on two songs, byte for byte**, not on arbitrary
  DMFs.  It reproduces the converter's rules as read; a module using a path
  neither song reaches (revision > 24 pattern names, 4 effect columns, `0xe5`
  pre-20 pitch slides, samples) is refused or unproven.  PCM samples are
  refused by name (`song-pcm`) because their conversion is a numpy/resampy
  resample that was not ported.
- **The converter passes effect columns through; the browser player still
  refuses them** (`song-fx`).  So song 2 exports and would play its effects
  on the console, while `pce-song.js` refuses to preview it.  That gap is
  deliberate and named, not silent.
- **Instrument names are written into a comment**, so `convert()` replaces
  non-ASCII ones with spaces; the Python converter writes them as the file
  encoding allows.  A byte-identical claim for a non-ASCII instrument name is
  therefore not made.
- **The engine image is a committed copy of PCEAS's banks $00-$0F.**  It goes
  stale if `tools/hutrack.asm` or the vendored engine changes without
  `make -C tools engine`; `check-export-song.js` catches that when PCEAS 4.x
  is present, and cannot when it is not (the check reports `skip`).  Its
  bank `$0F` is `0xff` filler, so "the tail is copied" (#72) is proven
  against a synthetic engine image, not against a ROM any song builds.
- **The #72 envelope fixture is a song object, not a DMF file.**  It is built
  from this reader's output for demo.dmf, so it proves the player's envelope
  semantics; no DMF containing a looping envelope is ever played here
  (hutrack2 has one, but the player refuses that song for its arpeggio and
  effect columns).  Its expected writes are transcribed from the engine's
  source: no Mednafen recording reaches a looping volume envelope or a
  moving multi-waveform envelope at these values.
- **The wave upload's last control write differs between the port and the
  engine's source.**  The first-note assertion encodes the port's `$40|vol`
  (DDA on, channel off); `HuTrack_parser.asm` `.copy.wave` line 1606
  (`sty $804` after the DMA) writes `$80|delta`, i.e. channel on at the
  previous level.  The two differ only for the cycles before `volumeEnv`
  writes the frame's level, and no measured sample was found to change, but
  it is not adjudicated here: #72's new assertions deliberately do not
  assert that byte, so they stay valid if the sequence is corrected.
- **Effect columns, arpeggio envelopes, DDA samples, SFX, LFO and the music
  fade** are refused by the player, not implemented. The engine supports
  them; the converter emits effect-column data (song 2 exercises it), but
  song 2 is never recorded, so what those effects do to the audio is
  unmeasured.
- **The checkers were written by @design** — `check-hutrack.js` and
  `check-dmf.js` — the seat that wrote the fixture, the song, the reader and
  the player (workshop RULES.md rule 2). @review owes both a cold break.
- The converter's `--no_gui` path sets its internal `songName` to the literal
  `"converter"` while importing (`utils/HuTrackConverter.py`); it affects only
  the CLI's default output name, not the song title/author embedded from the
  DMF, so PCEStudio passes `--songname` and the DMF carries its own metadata.
