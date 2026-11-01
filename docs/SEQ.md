# The sequencer — a step grid for the PSG (#94, part 1) and its staff (#95, part 2)

**Decision.** ppu.toys' SEQUENCER panel is the shape (`docs/STUDIO.md` §3.10): a song of patterns, a
step grid, Tempo / Steps / Swing / Key, an instrument palette, note values and a voices bar per step. #94
was the grid, #95 is the staff on the same song (§11), and the DMF export is #96. The panel is
`renderer/studio-panel-sequencer.js`; the models are `renderer/pce-seq.js` (the song) and
`renderer/pce-staff.js` (the notation). The panel draws and binds, and every question about the music goes
to a model.

## 1. The song

```
song   = { version, name, tempo, swing, key, steps,
           patterns: [ { name, channels[6][steps] } ],
           order:    [ pattern index, ... ],
           instruments: [ instrument, ... ] }
cell   = { note, instrument, length }            (or null)
note   = engine note 0..83: C1 is 0, C4 is 36 (MIDI note = engine note + 24)
length = steps, 1..song.steps
```

* **steps** is 1..64 and every pattern has the same number; the grid shows one pattern at a time.
* **order** is the playing order, `A,A,B` in the panel's one-line field. `renderer/pce-dmf.js` stores one
  copy of a pattern per order position, so `compile()` expands the order the same way (`orderMatrix` is
  the label, 0..n-1, and `patterns[ch][o]` is the copy the player indexes).
* **a cell sounds until its length ends or the next note on that channel starts**, whichever is first. A
  note whose length reaches the pattern's end is cut by the next pattern; no cut row is written.
* **key** (0..11) is the spelling of the note names on the grid and the major-scale highlight — a view
  of the same notes, not a transposition, so it changes no PSG write. On the staff (#95) it is also the key
  signature that decides each note's letter and accidental (§11).

## 2. Compiling to the song pce-song.js plays

`compile(song)` returns the object `renderer/pce-dmf.js` hands `renderer/pce-song.js` for a `.dmf` file:
`timeBase`, `tick1`, `tick2`, `frameMode`, `rowsPerPattern`, `orderCount`, `orderMatrix`,
`instruments` (`volumeEnv`, `wavetableEnv`, `arpeggioEnv`, `noiseEnv`), `wavetables` (one 32-step wave
per distinct wave instrument) and `patterns[6][orderCount]`. `checkSong()` accepts it and the player runs
it without a change — `tests/check-sequencer.js` compares it field by field with a song object written by
hand in that shape.

**Tempo.** Sixteenth steps, 60 VBlanks a second, four steps a beat: `ticks = round(900 / BPM)`
(DefleMask/HuTrack's speed table). 150 BPM is six ticks; the panel shows the value.

**Swing.** The on-beat step is lengthened and the off-beat shortened by the same amount:
`d = round(ticks * swing / 100)`, `tick1 = ticks + d`, `tick2 = ticks - d`. `pce-song.js`'s parser
alternates `tick1` and `tick2` every row (HuTrack's two speeds), so the swing is the chip's own row
schedule and not a second timing model. Row *i* (counting the order's steps from 0) is applied on frame
`tick2 + tick1 * ceil(i/2) + tick2 * floor(i/2)`; `tests/check-sequencer.js` compares that schedule with
the frames `pce-song.js` actually applies its notes on, straight and swung, for one and two bars.

## 3. Instruments

An instrument is a PSG voice:

* **wave**: `wave` is 32 steps of 5 bits (#62's shapes, `renderer/pce-wave.js`'s `PRESETS`) and `env` is
  the **driver's** volume envelope — the sequence of R4 levels (0..31) `pce-song.js` writes one per
  VBlank, with a loop index or `0xff` to hold. The PSG has no hardware envelope (`docs/PSG.md`).
* **noise**: a drum on channels 5 or 6 only (0-based 4, 5 — the only two with the generator), `nf` is
  R7's 5-bit noise frequency, `env` is the same driver envelope. The note's pitch is ignored by the
  chip's noise generator.

The compiled `wavetableEnv` selects the wave by index; a drum has an empty `wavetableEnv`, so pce-song.js
uploads no wave for it.

## 4. Noise drums: which half is whose

`pce-song.js` deliberately has no effect columns, and HuTrack's noise is effect `11` on channels 5-6
(`vendor/hutrack`, `HuTrack_parser.asm .platFX.Noise`; `vendor/hutrack/docs/compatibility.md`: "`10`, `11` |
Wave selection and noise mode"). Part 1 therefore splits the drum:

* **volume** is `pce-song.js`'s: the drum instrument carries its envelope and the engine writes
  `R4 = $80 | level` every VBlank exactly as for a wave note. `tests/check-sequencer.js` reads that R4
  sequence back for the drum's first five frames and it is the envelope.
* **the on/off** is `pce-seq.js`'s, and only the two writes the engine makes:
  `R0 = channel; R7 = $80 | nf` where the drum's note starts, and `R0 = channel; R7 = $00` where it is
  cut (`.platFX.Noise` `.turnon.noise` / `.turnoff.noise`; `_htk.WSG.noise`). They are merged into the
  same frame as the player's writes, after them. `R7 = 0` is also written when a **wave** note follows a
  drum on that channel, so the state never leaks.

The ROM conversion (`renderer/pce-hutrack.js`'s `fromSequencer()`, #199) encodes the same state change
as effect `11` with argument 1 (on) / 0 (off). The engine takes the **NF from the note's semitone**
(`NoiseTable`'s twelve legacy values), not from the effect's argument, so the converter retimes a drum
row to the legacy pitch nearest the instrument's NF; `tests/check-hutrack-seq.js` measures that mapping
(deltas 0-2) and compares the rest of the register stream with the studio's. #96 owes the DMF side: a
DMF export must encode the same state change as effect `11`, or a DMF of a drum song opens in Furnace
without its drums.

## 5. What plays

`render(song)` = `events(song)` → `renderer/pce-psg.js`'s `render()`, and `events(song)` is
`renderer/pce-song.js`'s `trace()` of the compiled song with the noise writes merged in. The panel's
`▶ Play song` renders one pass (`framesPerOrder` plus the longest envelope's tail) and plays it through
the page's AudioContext; the PCM is the same model `tests/check-psg.js` compares with Mednafen. The
evidence compares `seq.render()`'s PCM with `pce-psg.js`'s render of `pce-song.js`'s trace of the
**hand-written** song, sample for sample.

## 6. The six voices

The chip has six channels, so the grid has six rows. The voices bar under the grid counts, per step,
how many channels are sounding (a note that started at or before the step and has steps left to run).
The model refuses a seventh channel (`seq-channel`) and a noise drum outside channels 5-6 (`seq-voice`)
rather than dropping it.

## 7. Refusals

| code | when |
|---|---|
| `seq-tempo` | BPM outside 30..300 |
| `seq-swing` | swing outside 0..60 (percent of a step) |
| `seq-key` | key outside 0..11 |
| `seq-steps` | steps outside 1..64, or a pattern whose channel has the wrong length |
| `seq-pattern` | a pattern index the song does not have, or more than 8 patterns |
| `seq-order` | an order naming a missing pattern, or 0..64 entries |
| `seq-channel` | a channel outside 0..5 |
| `seq-note` | a note outside 0..83 |
| `seq-length` | a note length outside 1..steps |
| `seq-instrument` | an instrument index the song does not have |
| `seq-wave` | a wave that is not 32 steps, or a step outside 0..31 |
| `seq-env` | an envelope size 1..32, a level outside 0..31, or a loop past its last step |
| `seq-noise` | a noise frequency outside 0..31 |
| `seq-voice` | a noise drum on a channel without the noise generator (channels 1-4) |
| `seq-json` | `song.json` does not parse, is not an object, or is another version |

## 8. The file

The song saves with the toy as **`song.json`** — the panel creates it on its first edit, so an untouched
toy stays #77's five-file toy. It round-trips byte for byte (`tests/check-sequencer.js`), and opening a
different toy or example gives the panel a fresh song (the page announces `song.json` to the asset
watchers on both paths).

## 9. Evidence

* `tests/check-sequencer.js` — the model: every refusal code; `compile()` against a hand-written DMF
  song field by field; the row schedule against the frames `pce-song.js` applies notes on (straight and
  swung, one and two bars); the PCM sample for sample against `pce-psg.js`'s render of `pce-song.js`'s
  trace of the hand-written song; the drum's R7 writes at the player's own note frame, its R4 envelope,
  and the PCM difference they make; note lengths as cut rows; the voices bar; the key's spelling;
  `song.json`'s round trip.
* `tests/check-studio.js`'s `checkSequencerPanel` — the panel on the page: it registers, draws six rows
  of cells and the voices bar, a pattern written through its API compiles to the expected rows, the
  rendered stream is the model's, six voices is the maximum and a noise drum on channel 1 is refused, and
  an edit saves `song.json` without touching the toy's other files.
* `tests/check-hutrack-seq.js` (#199) — the ROM conversion: `pce-hutrack.fromSequencer()` and
  `pce-seq.instrumentFromAsset()`; each of the 15 built-ins' wave and envelope decoded out of the
  assembled song bank and compared with `pce-assets.traceFor`'s writes (the drums' R7 NF within 2 of the
  studio's); a two-pattern song's rows, noise `11` on/off rows and frame-by-frame register stream
  against `pce-seq.events()`.

Six source substitutions of the model were run by hand in a `$TMPDIR` copy on 2026-10-29 and each made
`check-sequencer.js` fail: swing inverted (tick1/tick2 swapped), no note-cut rows, the octave one too high,
R7 written without bit 7, the tempo rule `600/BPM`, and no clip-by-the-next-note. They are not committed
as a `*-mutation.js` suite, so a fresh clone cannot re-run them.

Not proven: the panel's DOM and CSS are judged by the screenshot, not a pixel comparison; the
AudioContext path is not exercised headlessly (the render it feeds is); no Mednafen recording of a
sequencer song exists — the PSG model's proof is `check-psg.js`/`check-dmf.js`, and the drums' R7 writes
are HuTrack's source, not a recording; and rule 2 is owed (the tests were written with the panel).

## 10. Not in part 1

The DMF export and DDA drum samples (#96), undo/redo, note values shorter than a step (the grid's
resolution is 1/16), triplets, and the instrument editor beyond the six built-ins — the AUDIO panel (#97)
edits a toy's `waves.json`, which is a different document from the song's instruments. The staff view,
which was part 1's other gap, is §11.

## 11. The staff view (#95, part 2)

The same song, read as music. `renderer/pce-staff.js` is the model — it takes a song and returns notes,
never a second song — and the SEQUENCER panel draws it. `?view=staff` opens it without synthetic input.

**A grand staff, one bar per order entry.** Bass below middle C (engine note 36), treble from it up, so
middle C is the first ledger line under the treble staff and over the bass. Bars follow the song's `order`,
not only the pattern the grid shows. Notes keep the grid's channel colours, and a second voice on the same
pitch at the same step is nudged sideways rather than hidden.

**Spelling.** A note that is a degree of the key's major scale takes that degree's letter and the key
signature covers its accidental; a chromatic note takes the key's own direction — a sharp key spells it
with a sharp, a flat key with a flat, the same split `pce-seq.js`'s `noteName()` uses on the grid. A natural
sign is written when the note is the natural of a letter the signature alters (key G, the note F natural).
Octaves are solved so the letter and the pitch agree at the edges: B♯5 is C6's line and G♭4 is F♯4's.

**Key signature.** From the twelve major keys' own degrees, in the conventional order — sharps
F C G D A E B, flats B E A D G C F — on the lines musicians look at (treble F5 C5 G5 D5 A4 E5 B4, bass
F3 C3 G3 D3 A2 E3 B2).

**Note values.** A step is a 1/16 (§2), so a cell's length is its value: 1 = 1/16, 2 = 1/8, 3 = dotted 1/8,
4 = 1/4, 6 = dotted 1/4, 8 = 1/2, 12 = dotted 1/2, 16 = whole. A length that is no drawn value draws the
value below it and the model says `exact: false`; a length past a whole draws a whole and says the same.

**Octave marks.** Above the treble, `8va` from C6 and `15ma` from C7; below the bass, `8vb` from G1 and
down and `15mb` from C1 (diatonic positions 42 / 49 and 11 / 7). A note far enough outside its staff is
drawn shifted and labelled; a run of shifted notes repeats no mark, and `loco` is written at the first note
of a voice that returns to the written octave. The state is per channel — two voices at one step can be in
different octaves — and it restarts at every bar.

**Not proven.** Accidentals are not carried within a bar: every note is signed against the key signature,
so a sign repeats where strict engraving would not. The clefs are the musical-symbol glyphs when the font
has them and a drawn clef when it does not; the headless checks only exercise the drawn path. The staff's
pixels are judged by a screenshot, not a pixel comparison. Rule 2 is owed.

**Evidence.** `tests/check-staff.js` — twelve key signatures, the spelling rules, the clefs, every note
value, the four octave marks and `loco`, and `layout()` on the demo song with the song unchanged;
`tests/check-studio.js`'s `checkSequencerPanel` — the panel's toggle, one head per note, `15ma` and `loco`
painted, the drawn clefs, and the grid restored.

