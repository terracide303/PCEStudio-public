# The sequencer — a step grid for the PSG (#94, part 1)

**Decision.** ppu.toys' SEQUENCER panel is the shape (`docs/STUDIO.md` §3.10): a song of patterns, a
step grid, Tempo / Steps / Swing / Key, an instrument palette, note values and a voices bar per step. This
card is the grid; the staff view is #95 and the DMF export is #96. The panel is
`renderer/studio-panel-sequencer.js`; the model is `renderer/pce-seq.js`. The panel draws and binds, and
every question about the music goes to the model.

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
  of the same notes, not a transposition, so it changes no PSG write. #95's staff is where it becomes a
  decision (sharps, flats, octave marks).

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

`pce-song.js` deliberately has no effect columns, and HuTrack's noise is effect `0F` on channels 5-6
(`vendor/hutrack`, `HuTrack_parser.asm .platFX.Noise`). Part 1 therefore splits the drum:

* **volume** is `pce-song.js`'s: the drum instrument carries its envelope and the engine writes
  `R4 = $80 | level` every VBlank exactly as for a wave note. `tests/check-sequencer.js` reads that R4
  sequence back for the drum's first five frames and it is the envelope.
* **the on/off** is `pce-seq.js`'s, and only the two writes the engine makes:
  `R0 = channel; R7 = $80 | nf` where the drum's note starts, and `R0 = channel; R7 = $00` where it is
  cut (`.platFX.Noise` `.turnon.noise` / `.turnoff.noise`; `_htk.WSG.noise`). They are merged into the
  same frame as the player's writes, after them. `R7 = 0` is also written when a **wave** note follows a
  drum on that channel, so the state never leaks.

#96 owes the other half: a DMF export must encode the same state change as effect `0F`, or a DMF of a
drum song opens in Furnace without its drums.

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

Six source substitutions of the model were run by hand in a `$TMPDIR` copy on 2026-10-29 and each made
`check-sequencer.js` fail: swing inverted (tick1/tick2 swapped), no note-cut rows, the octave one too high,
R7 written without bit 7, the tempo rule `600/BPM`, and no clip-by-the-next-note. They are not committed
as a `*-mutation.js` suite, so a fresh clone cannot re-run them.

Not proven: the panel's DOM and CSS are judged by the screenshot, not a pixel comparison; the
AudioContext path is not exercised headlessly (the render it feeds is); no Mednafen recording of a
sequencer song exists — the PSG model's proof is `check-psg.js`/`check-dmf.js`, and the drums' R7 writes
are HuTrack's source, not a recording; and rule 2 is owed (the tests were written with the panel).

## 10. Not in part 1

The staff view (#95), the DMF export and DDA drum samples (#96), undo/redo, note values shorter than a
step (the grid's resolution is 1/16), triplets, and the instrument editor beyond the six built-ins — the
AUDIO panel (#97) edits a toy's `waves.json`, which is a different document from the song's instruments.
