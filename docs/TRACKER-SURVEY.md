# Tracker survey — what a PC Engine tracker should borrow, and the first slice

**Card #226 (TRACKER 1).** Survey only; no code. Read on 2026-11-02 against
PCEStudio `a7bcfb2`. The project is GPL-3.0-or-later (`LICENSE`).

The studio already has the two halves of a tracker: a six-channel step grid whose
song compiles to the DMF-shaped object `renderer/pce-song.js` plays, and
`renderer/pce-hutrack.js`, which turns that object into the HuTrack data an
exported ROM runs. What it lacks is the tracker as an instrument: rows with
effect columns, an instrument and wave editor inside the song, import and export.
This survey reads the public docs of the trackers that solved those problems and
recommends the smallest next slice.

**Short answer.** Do not port Furnace. Keep the existing song model and make it a
tracker in this order: (1) one song document that plays in the browser and builds
the same ROM, proved by register-trace equality; (2) DMF import into that
document; (3) effect columns, sound by sound. The first slice needs no new sound
feature at all — only the join between the grid and the existing ROM converter,
plus its proof.

---

## 0. Sources, what was read, and what could not be read

| Source | Version read | What was read | Access |
|---|---|---|---|
| **Furnace** | `master` at `592e7fd3` (2026-10-30) | `README.md`, `LICENSE`, `doc/1-intro/concepts.md`, `doc/2-interface/keyboard.md`, `doc/2-interface/formats.md`, `doc/2-interface/order-list.md`, `doc/2-interface/speed.md`, `doc/2-interface/subsongs.md`, `doc/3-pattern/README.md`, `doc/3-pattern/effects.md`, `doc/3-pattern/keyboard.png` (viewed), `doc/4-instrument/README.md`, `doc/4-instrument/pce.md`, `doc/5-wave/README.md`, `doc/7-systems/pce.md`, `doc/8-advanced/grooves.md` | Fetched from `raw.githubusercontent.com` and the GitHub API on 2026-11-02. The manual is larger than these chapters; the rest was not read. |
| **DefleMask** | Tracker Manual v2.0.0 (60 pp) | The whole manual: interface, pattern matrix, instrument editors, menu, default controls, standard effects, PCE section (pp. 37–38), and the archived home/buy pages | The live `deflemask.com` and `www.deflemask.com` returned **503 Service Unavailable** on 2026-11-02. Read the Wayback snapshot `20261101120556` of the site and of `manual.pdf`. |
| **HuTrack** | Vendored commit `ac598f84` (2026-10-10) | `vendor/hutrack/README.md`, `vendor/hutrack/docs/compatibility.md`, `vendor/hutrack/VENDORED.md`, `vendor/hutrack/LICENSE`; `docs/HUTRACK.md`; `HuTrack_parser.asm` where the docs cite noise behaviour | Local, pinned in the tree. |
| **BeepBox** | `master` at `355e5100` (2026-08-07) | `README.md`, `LICENSE.md`, `editor/KeyboardLayout.ts`, `editor/SongDocument.ts`, `editor/Preferences.ts`, `synth/SynthConfig.ts`, `synth/synth.ts` (`Song` class) | Fetched from GitHub on 2026-11-02. BeepBox has **no separate user manual**; the description below is from its README and source, not a manual. |
| **Studio today** | `a7bcfb2` | `renderer/pce-seq.js`, `renderer/pce-song.js`, `renderer/pce-hutrack.js`, `renderer/pce-dmf.js`, `docs/SEQ.md`, `docs/HUTRACK.md`, `docs/STUDIO.md` §3.10 | Local. |

**Named as unread, not inferred:**

- **DefleMask's live website** was unreadable (503). The archived manual is the
  source for every DefleMask claim here.
- **DefleMask's default note-key letter map** is not printed in the manual. The
  manual documents configurable key bindings, an on-screen piano, note-off and
  transpose keys, but not which letters play which notes.
- **Furnace's exact default note letters** are not printed either. The
  `keyboard.png` figure shows *note positions* (a piano layout in four physical
  rows), not key caps; the text says every binding is configurable. The figure
  and the shortcut table were read; the source's default binding table was not.
- **HuTrack's HuC/HuCC integration guide** (`docs/huc`) is not vendored and was
  not read. The engine facts below are from the vendored compatibility document
  and the engine source citations already recorded in `docs/HUTRACK.md`.
- **No official `.dmf` specification** was read. The format description is what
  `renderer/pce-dmf.js` implements from the vendored HuTrack reader; it is not
  presented as DefleMask's own specification.

No code was copied from any source. Licence statements below say whether reuse
*would be permitted*; they are not a plan to copy.

---

## 1. Furnace

**Link:** <https://github.com/tildearrow/furnace> · PC Engine chapter:
<https://github.com/tildearrow/furnace/blob/master/doc/7-systems/pce.md>

### 1.1 PC Engine chip support

Furnace's PCE page: the HuC6280 has **six wavetable channels**, the last two
double as noise channels, and there is "some PCM and LFO". The chip manager also
models pseudo-PAL, an anti-click/phase-prediction option, and the HuC6280A
revision (fewer pops). The PCE instrument editor has three tabs — Sample,
Wavetable, Macros — and the wavetable table gives PCE a **32-step × 32-level**
wave with a phase reset on waveform change, which is the same shape as the
studio's 32-step 5-bit wave (`renderer/pce-wave.js`, `docs/SEQ.md` §3).

### 1.2 Pattern grid

A pattern is channel columns × numbered rows. Each channel has subcolumns in
this order: **note, instrument, volume, effect type, effect value**. Extra effect
columns can be added and removed, and each channel has its own pattern list in
the order list. The view supports selection, cut/copy/paste, transpose, edit
step, row highlights for beats and measures, pattern names, and channel status
icons (note on/off/release, pitch and volume alteration).

This is the shape a PCE tracker needs: one row is a time slice, and a cell says
"this note, with this instrument, at this volume, doing this effect". The studio
today has the note and instrument, and a *length* instead of a per-row volume or
effect.

### 1.3 Instrument, wave, and macro editors

The PCE instrument editor's **Macros** tab lists: Volume, Arpeggio, Noise (channels
5–6 only), Waveform, Panning (left), Panning (right), Pitch, and Phase Reset.
Each macro is a sequence, an ADSR, or an LFO, with a step length, a delay, a loop
point and a release point. This is how Furnace expresses the PSG's envelopes: the
chip has no hardware envelope, so the driver writes R4 (and pulses R6/wave
selection) every tick.

The **wavetable editor** draws 32 steps at 32 levels for PCE. It can also build a
wave from shapes (sine/triangle/saw/square with duty, exponent, XOR point,
amplitude and phase), from four-operator FM, or with WaveTools (scale X/Y, offset,
smooth, amplify, normalize, invert, reverse, half/double, signed/unsigned,
randomize). Most of that is Furnace's own synthesis surface, not the PSG's; the
part a PCE tracker needs is the direct 32-step drawing and the shape presets.

### 1.4 Effects

Furnace's global effect list is large and continuous (an effect runs until a
`00` value). The subset relevant to PCE:

| Effect | Meaning |
|---|---|
| `10xx` | change wave |
| `11xx` | toggle noise mode (last two channels only) |
| `12xx` | LFO: `00` off, `01` add directly to ch1, `02` shift left 4, `03` shift left 8; enabling it mutes ch2 |
| `13xx` | LFO speed |

The standard list also has `0xy` arpeggio, `1xx`/`2xx` pitch slides, `3xx`
portamento, `4xy` vibrato, `5xy`/`6xy` combinations, `7xy` tremolo, `8xx`
panning, `9xx` speed, `Axy` volume slide, `Bxx` jump, `Cxx` retrigger, `Dxx`
pattern break, `Exx` extended commands (arpeggio speed, note slides, vibrato
shape/range, fine tune, legato, sample bank, cut, delay, external, global fine
tune), and `Fxx` second speed. Time is measured in **ticks**; each row lasts a
number of ticks set by the speed/groove values.

The studio's `pce-song.js` deliberately refuses effect columns (`song-fx`), and
`pce-seq.js` currently synthesises only the two R7 writes a noise drum needs. The
gap is not the PSG — HuTrack already implements these effects — it is the browser
player and the editor.

### 1.5 Keyboard

Furnace's note keys are configurable in Settings → Keyboard. The manual documents
Space toggles edit, keypad `*`/`/` change octave, an edit step, a note-input latch,
and a note-position figure laid out as a piano in four physical rows (bottom row
C–B, the row above its accidentals, then the next octave and its accidentals).
The figure itself prints note names, not key caps. It also documents `OFF`,
`===` (note release) and `REL` (macro release) as distinct note events, which the
studio does not have.

### 1.6 What a PCE tracker needs from Furnace

- A row grid whose cells carry note + instrument + length, then volume, then
  effects — in that order of value.
- Per-channel patterns and an order list.
- A per-instrument envelope/macro model (the PSG has no hardware envelope).
- A direct 32-step wave editor.
- A tick/row speed model, not only a global BPM.
- Note off / note release / note cut as first-class events.
- Keyboard note entry, edit step, octave, undo/redo, play from cursor.

### 1.7 What we skip

Multi-chip songs, FM and sample-based chips, subsongs, grooves and virtual tempo,
the full global effect list, wave-synth FM and most WaveTools, the sample editor,
the mixer, register/oscilloscope views, MIDI import, the command line, and the
pattern manager. On PCE specifically: PCM/DDA and the LFO are later or out
(see the table); effect columns are not in the first slice.

### 1.8 Licence

**GPL-2.0-or-later** for most of Furnace; `README.md` says "most of Furnace is
under the GNU General Public License (GPL) version 2 or later", and `LICENSE` is
the GPL v2 text with the "or later" clause. The ASIO SDK is GPL-3.0, and
third-party components may carry other licences, so "most" is load-bearing —
check each file before reusing any. **Reuse in a GPL-3 project:** in principle
yes, because GPL-2.0-or-later may be taken under GPL-3.0; but it is not a blanket
"all files are GPLv2+". **We will not copy code**; the docs are the reference.

Links: <https://github.com/tildearrow/furnace> ·
<https://github.com/tildearrow/furnace/blob/master/LICENSE>

---

## 2. DefleMask

**Link:** <https://www.deflemask.com/> · Manual:
<https://www.deflemask.com/manual.pdf> (read via
<https://web.archive.org/web/20261101120556/https://www.deflemask.com/manual.pdf>
because the live site was 503).

### 2.1 What it is

DefleMask is a multi-system chiptune tracker. Its manual is v2.0.0. PC Engine is
system **#4**, soundchip **HuC6280**, maximum volume `1F`. It is sold as a
one-time purchase on Steam, the App Store and Play Store, with a free "Legacy"
version described as a demo. It is not an open-source project.

### 2.2 Pattern grid, pattern matrix, controls

The pattern view has, per channel: **note (white), Vol (green), Ins (blue),
effect type (red) and effect value (white)**. A channel can have **up to four
effect columns**. Rows per pattern, edit step, octave, Speed A/B, Base Time and
NTSC/PAL/custom are set from the main window. The pattern matrix arranges
patterns over time and can give **different orders to different channels**;
patterns can be given aliases. The instrument list holds STD instruments
(macro/envelope driven), FM instruments, wavetables, and samples; the wavetable
editor draws the wave directly and can load/save waves; the sample editor holds
12 samples per bank and 12 banks.

Controls: arrow keys move, Page Up/Down move by 16 rows, Ctrl+arrows move
channels/patterns, Ctrl+A selects all, Ctrl+C/X/V copy/cut/paste, Ctrl+D clones a
pattern on write, Delete removes, Tab is note-off, Ctrl+F1–F4 transpose, numpad
`/` and `*` change the octave. Every binding can be changed under
Options → Key Bindings. The manual's "Musical Notes" table lists the *functions*
(note-off, transpose, octave) but **not the letter map**; an on-screen piano is
available.

### 2.3 PC Engine effects

DefleMask uses ProTracker's standard effect enumeration, then adds the system's
own effects. The standard set includes `0xy` arpeggio, `1xx`/`2xx` portamento
up/down, `3xx` porta-to-note, `4xy` vibrato, `5xy`/`6xy` combined slides, `7xy`
tremolo, `8xx` panning, `9xx` speed 1, `Axy` volume slide, `Bxx` position jump,
`Cxx` retrigger, `Dxx` pattern break, `Exx` extended commands (arpeggio tick
speed, note slides up/down, vibrato mode, fine vibrato depth, fine tune, legato,
sample bank, note cut, note delay, sync signal, global fine tune) and `Fxx`
speed 2.

The PCE section adds:

| Effect | Meaning |
|---|---|
| `08xy` | stereo panning; on PCE x = left, y = right, values `0`–`F` |
| `10xx` | set wave (the wave selected in the wavetable instrument) |
| `11xx` | enable noise on channels 5/6; any non-zero value enables it |
| `12xx` | LFO mode: `00` off, `01` add directly to ch1, `02` shift left 4, `03` shift left 8; enabling mutes ch2 |
| `13xx` | LFO speed |
| `17xx` | `1` enables sample output, `0` returns the channel to the wavetable |

The manual also says a **wave macro** can turn noise on/off with `63` = ON and
`62` = OFF, an alternative to effect `11`.

### 2.4 The `.dmf` format, as our reader sees it

`renderer/pce-dmf.js` is our own reader; it runs no converter code and copies
none. It reads the legacy revisions **11–27** and accepts only platform **5**
(PC Engine). It parses the song name and author, time base, the two row speeds
(`tick1`/`tick2`), the NTSC/PAL frame mode, rows per pattern (1–256), the order
count (1–127), a per-channel order matrix, up to 128 instruments (volume,
arpeggio, noise and wavetable envelopes; an empty instrument gets Furnace's
empty-instrument fallback), wavetables, patterns with up to four effect slots per
cell, and sample metadata. It refuses the wrong magic, a revision outside
11–27, a non-PCE platform, truncated data and non-zero trailing data by named
code.

The split between our modules matters for the tracker:

- `pce-dmf.js` **reads** the DMF into the same object `pce-seq.compile()` emits.
- `pce-song.js` **plays** the parts a plain wave song uses; it refuses effect
  columns (`song-fx`), arpeggio envelopes (`song-arp`) and PCM samples
  (`song-pcm`).
- `pce-hutrack.js` **converts** a DMF-shaped module to HuTrack's ten include
  files and assembles the song bank for the ROM. It supports arpeggio envelopes
  and effect slots the browser player does not.

That asymmetry is the tracker's central design constraint: the editor cannot
offer a feature that the browser player and the ROM converter do not both
understand, or the same song becomes two songs.

### 2.5 What a PCE tracker needs from DefleMask

- The row grid and the four-effect-column layout.
- A pattern matrix (per-channel orders), even if the first slice keeps one shared
  pattern per order slot.
- The `.dmf` import as the tracker's import, per the maintainer's 2026-11-02
  decision on #205.
- A wavetable editor of exactly 32 steps for the PSG.
- The PCE effect vocabulary `08`, `10`, `11`, `12`, `13`, `17` and the standard
  effect letters, as the shared language between the editor and HuTrack.
- Configurable keyboard bindings and an on-screen piano.

### 2.6 What we skip

Every other system, FM instruments, sample banks, pattern aliases, networking,
skins, touch mode, the VGM/ROM exporters (we have our own), the full standard
effect list, and per-note volume until the effect model exists.

### 2.7 Licence

**Proprietary / commercial; no source licence.** DefleMask is sold as a one-time
purchase (<https://www.deflemask.com/buy_benefits/>); I found no published source
licence. **Reuse in a GPL-3 project: no.** Its code (and the manual text as text)
cannot be taken into PCEStudio. The `.dmf` *format* is reimplemented
independently in `renderer/pce-dmf.js`; the reader is ours and copies nothing.
The manual is cited only for behaviour.

Links: <https://www.deflemask.com/> ·
<https://www.deflemask.com/manual.pdf> ·
<https://www.deflemask.com/buy_benefits/>

---

## 3. HuTrack

**Link:** <https://github.com/Turboxray/HuTrack> · Local:
`vendor/hutrack/` · Licence: `vendor/hutrack/LICENSE`

### 3.1 What it is

HuTrack is an MIT-licensed HuC6280 sound engine plus a DefleMask-DMF converter,
vendored at commit `ac598f84` (2026-10-10). It is the console side of the
studio's sound: the exported ROM plays HuTrack, and the browser player
`renderer/pce-song.js` is a port of the parts of the engine a plain DMF song
uses. Its reference is **Furnace 0.6.8.3's legacy-DMF playback** with default
compatibility settings, not a moving Furnace target.

It is an engine, not an editor: it has no grid, no keyboard, no instrument UI. Its
value to the tracker is the *semantics* the console will actually run.

### 3.2 What the engine supports

- **Six PSG channels.** Noise only on channels 4/5 (0-based; the PSG's channels
  5/6).
- **Four effect columns.** The compatibility table covers: `00`/`E0` arpeggio and
  tick speed; `01`/`02`/`03` pitch slides and portamento; `04`/`E3`/`E4` vibrato,
  shape and fine depth; `05`/`06` volume slide with remembered vibrato or
  portamento; `07`/`0A` tremolo and fractional volume slide; `08` panning;
  `09`/`0F` alternating row speeds; `0B`/`0D` order jump and next-order break;
  `0C`/`EC`/`ED` retrigger, note cut and delay; `10`/`11` wave selection and
  noise mode; `12`/`13` LFO mode and speed; `17`/`EB` PCM mode and sample bank;
  `E1`/`E2` short slides; `E5` fine tuning; `E6`/`E8`/`E9`/`EA` legato forms;
  `EE` external value; `EF` global fine tuning. `E7` is a no-op; unknown codes
  are warned about by the converter, not silently invented.
- **Rows and speed.** Patterns are 1–256 rows, orders 1–127, and the converter
  folds the module's timebase into HuTrack's `tick1`/`tick2` speeds. The engine's
  natural tick is the VBlank; PAL/custom-Hz modules need the application to
  supply the right tick rate.
- **Instrument data.** Volume, arpeggio, waveform and noise envelopes; 32-step
  waveforms (an empty table becomes Furnace's constant-15 null wave); up to 128
  instruments, waves and samples in their pointer tables.
- **Noise.** Effect `11` is only the on/off switch. The noise frequency comes
  from the row's note through HuTrack's twelve-value `NoiseTable`, not from the
  effect's argument. `docs/SEQ.md` §4 and `docs/PLAN.md` #199 record the studio's
  mapping and its measured deltas.
- **PCM.** Effect `17`/`EB`, five-bit fixed-rate playback, sample banks; a
  resampler is needed to create the data.
- **LFO.** Effects `12`/`13`; hardware LFO couples channels 0/1, and HuTrack
  suspends it while either is reserved or waiting for a note.
- **SFX ownership.** `setChanForSFX` / `chanReleaseSFX`: a reserved channel keeps
  advancing the song's logical state; release silences it and waits for a fresh
  music note. The browser player's `reserve()`/`release()` mirror this.
- **Cost.** The compatibility document says the dense example transcriptions
  still have high peak CPU costs and points at the track guide; it gives no
  cycle budget here, so the survey does not invent one.

### 3.3 What a PCE tracker needs from HuTrack

- The row/tick model and the effect semantics above — the tracker should expose
  only what both `pce-song.js` and HuTrack can execute, or say why not.
- The noise-frequency-from-note rule. It is the one place where the studio's
  arbitrary `nf` 0–31 and HuTrack's twelve legacy values do not line up.
- The envelope-timing model: one step per tick, loop/release, and the volume
  scaling `floor(driverVolume * value / 31)`.
- The channel-reserve model for sound effects in toys.
- The ROM target: `pce-hutrack.convert()` → `assemble()` → `buildSongRom()`.

### 3.4 What we skip

HuTrack's Python converter (the studio has its own JS converter), the HuC/HuCC C
API and integration guide, the banked-asset revision machinery beyond what our
converter emits, PCM sample creation, SFX streams, pause/fade, and the target
platform's startup glue. The vendored engine is used as the ROM's engine; its
example songs were deliberately left out (commercial arrangements).

### 3.5 Licence

**MIT** (`vendor/hutrack/LICENSE`, Copyright (c) 2023 Turboxray). **Reuse in a
GPL-3 project: yes**, with the MIT copyright and permission notice kept; MIT is
compatible with GPL-3. HuTrack is already vendored and linked as a library, not
copied into our own source files. The pin is `ac598f84`; `MANIFEST.sha256` checks
it and `tests/check-hutrack.js` re-checks the manifest.

Links: <https://github.com/Turboxray/HuTrack> ·
<https://github.com/Turboxray/HuTrack/blob/main/LICENSE> ·
<https://github.com/Turboxray/HuTrack/blob/main/docs/compatibility.md>

---

## 4. BeepBox (one browser tracker)

**Link:** <https://github.com/johnnesky/beepbox> · Live:
<https://www.beepbox.co/> · Licence:
<https://github.com/johnnesky/beepbox/blob/master/LICENSE.md>

One browser tracker was read (BeepBox); a second was not needed for this survey.

### 4.1 What it is

BeepBox is a browser-first sketchpad: a song is bars × channels, each channel has
its own patterns (default 8 patterns per channel), and the default song has **3
pitch channels + 1 noise channel** (the code allows up to 10 + 5). It has a
piano-roll editor, an instrument list and editor (chip, FM, noise, spectrum,
drumset, harmonics, PWM, picked string, supersaw), envelope/automation editors,
and per-note or per-instrument effects: transition type, chord, pitch shift,
detune, vibrato, note filter, distortion, bitcrusher, panning, chorus, echo and
reverb. It keeps a 100-state undo history, supports selection and copy/paste,
plays live, and stores the whole song in the URL; it exports audio (the README
documents MP3 via lamejs).

The **keyboard layout** is explicit in `editor/KeyboardLayout.ts`: four physical
rows form a piano (Z row = C–B, A row = accidentals, Q row = the next octave,
digit row = that octave's accidentals), with several layouts — the code default
is **Wicki-Hayden**, and `pianoAtC`, `pianoAtA`, transposing variants and a
scale layout are offered. This is the most useful browser-tracker idea for us:
a note keyboard that works without a piano-roll and without a click.

### 4.2 What a PCE tracker needs from BeepBox

- Browser-first editing: no install, audio starts on a gesture, live playback.
- A keyboard note map with octave handling, including the default Wicki-Hayden
  option and a conventional piano-at-C map.
- Undo/redo with a bounded history, box selection, copy/paste.
- Per-channel pattern lists (closer to Furnace/DefleMask than the studio's one
  shared pattern per order slot).
- An instrument palette that is visible while editing, and a "the song is a URL"
  sharing habit the studio could match with `song.json`.

### 4.3 What we skip

BeepBox's synthesizer and its nine instrument types (the PCE is a fixed PSG, not
a software synth), its bar/piano-roll model, its twelve effect types
(reverb/chorus/echo/distortion/bitcrusher/filters and the rest), layered
instruments, its URL encoding, its 10 + 5 channels, and its audio export. Its
scale/key UI is already represented by the studio's `key` field and staff.

### 4.4 Licence

**MIT** (`LICENSE.md`, Copyright (c) 2012–2024 John Nesky and contributing
authors). **Reuse in a GPL-3 project: yes**, with the MIT notice kept. It is a
reference for interaction, not code to copy.

Links: <https://github.com/johnnesky/beepbox> ·
<https://github.com/johnnesky/beepbox/blob/master/editor/KeyboardLayout.ts> ·
<https://github.com/johnnesky/beepbox/blob/master/LICENSE.md>

---

## 5. Feature table

**Legend.** **first** = belongs in the recommended first slice; **later** = after
the first slice; **never** = not for the PCE tracker as scoped here. "Yes" means
the source has the feature; "—" means not applicable (an engine has no editor).
The studio column is the code in `renderer/pce-seq.js`, `pce-song.js`,
`pce-hutrack.js`, `pce-dmf.js` at `a7bcfb2`.

| Feature | Furnace | DefleMask | HuTrack | Studio today | Want |
|---|---|---|---|---|---|
| Row/step grid: note + instrument + length | Yes: note, instrument, volume, effect columns | Yes: note, vol, ins, up to 4 effect columns | — (consumes DMF rows) | Yes: six channels × steps; note, instrument, length; no volume/effect columns | **first** |
| Per-channel patterns / order matrix | Yes: each channel has its own pattern list | Yes: pattern matrix can differ per channel | Yes: per-channel order matrix | No: one shared pattern per order slot, expanded to per-channel copies by `compile()` | later |
| Six PSG channels | Yes | Yes (HuC6280) | Yes | Yes: six channels; `seq-channel` refuses a seventh | **first** |
| Note length / note off / cut / delay | Yes: note off, release, macro release, `EC`/`ED` | Yes: Tab note-off, `EC` cut, `ED` delay | Yes: `0C`/`EC`/`ED` | Length in steps becomes a cut row; no explicit off/release/delay event | **first** length; later off/delay |
| Volume column | Yes | Yes | Yes (volume rows preserved) | No: volume is the instrument envelope only | later |
| Effect columns | Yes: add/remove columns | Yes: up to 4 | Yes: 4 | No: `pce-song.js` refuses `song-fx`; only noise R7 is synthesised internally | later |
| PCE `10` wave select | Yes | Yes | Yes | No | later |
| PCE `11` noise toggle | Yes | Yes | Yes (`11`, on/off; NF from note) | Internal only: `pce-seq.noiseWrites()` emits R7 on/off for drums; ROM converter writes `11` | **first** as drum on/off; later as editable effect |
| PCE `12`/`13` LFO | Yes | Yes | Yes | No | later |
| PCE `17` PCM / DDA | Yes (sample instrument) | Yes (`17`) | Yes (`17`/`EB`) | ASSETS imports a WAV as a DDA sample, but `pce-song` refuses `song-pcm` and `pce-hutrack` refuses it too | later |
| Arpeggio, pitch slides, vibrato, portamento | Yes | Yes | Yes | No: `pce-song` refuses `song-arp`/`song-fx`; `pce-hutrack` can convert arpeggio envelopes | later |
| Instrument volume envelope (driver R4) | Yes: volume macro (sequence/ADSR/LFO) | Yes: STD macro/envelope | Yes: volume envelope with loop | Yes: 1–32 steps, loop or hold, 15 built-in instruments | **first** |
| Waveform envelope (change wave per tick) | Yes: waveform macro | Yes: wave macro | Yes: waveform envelope | Partial: one wave per instrument (a 1-step wavetable envelope) | later |
| 32-step wave editor | Yes: 32×32, shapes/FM/tools | Yes: draw/load/save | — (consumes 32-step waves) | Yes in `renderer/pce-wave.js` (#62), but the SEQUENCER palette is six fixed voices; no in-song wave editor | **first** use the 15 built-ins; later in-song editing |
| Noise drums on ch 5/6 | Yes: noise macro + `11` | Yes: `11`, wave macro `63`/`62` | Yes: `11`, twelve-value `NoiseTable` | Yes: static `nf` 0–31, R7 on/off; converter retimes to the nearest legacy NF (deltas 0–2 measured) | **first**, with an exact-NF decision |
| Stereo panning (`08`) | Yes | Yes (`08xy`) | Yes (`08`) | No per-note panning (the one-shot patch editor has balance) | later |
| Tempo / speed / swing / groove | Yes: speed 1/2, grooves, tick rate/BPM | Yes: Speed A/B, Base Time, NTSC/PAL/custom | Yes: `tick1`/`tick2`, timebase, VBlank tick | Yes: BPM → `round(900/BPM)` ticks per step; swing via `tick1`/`tick2`; no groove or per-row speed | **first** BPM + swing; later groove |
| Rows per pattern | Yes: configurable | Yes: Rows | Yes: 1–256 | Yes: steps 8/16/32/64 (model 1–64) | **first** 16/32/64; later arbitrary |
| DMF import | Yes | Yes (native format) | Converter input | Yes: `pce-dmf.js` reads revisions 11–27, platform 5; `pce-song` plays plain songs and refuses effects/arp/PCM | later (next slice) |
| DMF export | Yes | Yes | No (input only) | No (#96 open) | later |
| Browser playback through the PSG model | Yes: own emulation | Yes: own emulation | — | Yes: `pce-song.trace()` → `pce-psg.render()`, sample-exact against Mednafen for the tested streams | **first** |
| ROM / console export | Furnace: VGM, not a PCE ROM | Save ROM / VGM | The engine the ROM runs | Yes: `pce-hutrack.convert()`/`assemble()` → `buildSongRom()`; byte-identical to PCEAS in the committed tests | **first** |
| Undo/redo, selection, copy/paste | Yes | Yes | — | No: the panel has no keydown, undo or selection model | later (undo first) |
| Keyboard note entry / octave / edit step | Yes: configurable figure, edit step, octave | Yes: configurable bindings, on-screen piano, octave | — | No: mouse/API only; no keydown handler in the panel | **first** basic piano map + octave |
| Song file / multiple songs | Yes: `.fur`, subsongs | Yes: `.dmf` | One DMF per build | Yes: one `song.json` per toy; no song list | **first** `song.json`; later multi-song |

---

## 6. Recommended first slice

**Name:** "One song, two players, one proof."

**What it is.** The smallest tracker that plays the same song the ROM plays is
*not* a new editor. It is the existing SEQUENCER document made the single source
for both players, with a keyboard and an Export-song path:

1. **Song document.** Keep `renderer/pce-seq.js`'s `song.json`: six channels,
   patterns A–H, one shared pattern per order slot, `order`, `tempo`, `steps`,
   `swing`, `key`, and cells of `{note, instrument, length}`. Use the 15 built-in
   instruments (four wave voices + two noise drums in the default six; the asset
   palette supplies the rest) and their 32-step waves and volume envelopes.
2. **Editor.** Use the existing SEQUENCER grid and staff. Add the one thing that
   makes it a tracker rather than a mouse toy: a computer-keyboard note map with
   octave up/down and an edit step, writing the same `setCell` calls the panel
   already uses. Keep the mouse path.
3. **Browser player.** `compile()` → `pce-song.trace()` → `pce-psg.render()`, as
   today.
4. **ROM player.** The same compiled object → `pce-hutrack.fromSequencer()` →
   `convert()` → `assemble()` → `buildSongRom()`, as today.
5. **Proof.** One committed fixture song (8–16 bars, patterns and an order,
   wave instruments; add one noise drum only if the NF question below is settled
   first). A new test drives both paths and compares `(frame, register, value)`
   traces:
   - wave channels must match frame for frame;
   - a drum's `11` on/off frames must match, and its NF must match exactly or the
     difference must be named in the test (the current converter's 0–2 delta is
     not "the same song");
   - a Mednafen capture of the built ROM is the console proof once the song-ROM
     path is available; until then, the existing byte-identical-to-PCEAS check
     plus the trace comparison is the honest proof, and it says so.

**Why this is the smallest.** Every box above already exists and has tests:
`check-sequencer.js` for the model and browser render, `check-hutrack-seq.js` for
the converter's rows and register stream, `check-hutrack.js`/`check-export-song.js`
for the HuTrack engine and ROM. The only new work is the join, the keyboard, one
fixture and one equality test. No new sound feature is needed.

**Explicitly not in the first slice:** effect columns, per-row volume, DMF import
or export, arpeggio/pitch macros, waveform envelopes, PCM/DDA, LFO, per-note
panning, per-channel patterns, undo/redo, multiple songs, pattern aliases,
metronome/play-from-cursor, in-song wave editing, and any change to the HuTrack
engine. Those are the "later" rows above.

**Next slices, in order:**

1. **DMF import** into the same document (the #205 decision): notes,
   instruments, lengths and waves import; every unsupported effect is listed by
   row, not silently dropped. This is where `pce-dmf.js` stops being a player's
   private reader and becomes the tracker's import.
2. **Effect columns**, one shared semantic at a time: `11` noise first, then
   `10` wave select, then `12`/`13` LFO, then pitch effects (`0xy`, `1xx`–`4xy`).
   Each one must be playable in `pce-song` and in HuTrack before the editor
   exposes it.
3. **Volume column and arpeggio** (the DMF/HuTrack volume and arpeggio rows).
4. **PCM/DDA** only if a toy or a song needs it; it needs a resampler and a
   different export path.
5. **DMF export**, then per-channel patterns, undo/redo, and multiple songs.

---

## 7. Questions for the maintainer

1. **Panel shape.** Should the tracker be the SEQUENCER panel grown up, or a new
   TRACKER panel beside it? The survey recommends growing the SEQUENCER: it
   already owns `song.json`, the grid, the staff and the player, and a second
   panel would duplicate that model.
2. **Row meaning.** Is one row one 1/16 step (the current model), or does the
   tracker expose DMF rows with their own `tick1`/`tick2` speed? The current
   model cannot represent a DMF row that is not a sixteenth, so faithful DMF
   import will force this decision.
3. **Shared or per-channel patterns.** Furnace, DefleMask and HuTrack all allow a
   different pattern per channel; the studio shares one pattern per order slot.
   Adopting per-channel lists is a data-model migration. Do it in the first
   slice, or accept the shared pattern and expand on export?
4. **Which effect first.** The survey proposes `11` (noise) only, because drums
   already need it; then `10` wave select, `12`/`13` LFO, then pitch. Is there a
   song or a toy that makes a different order necessary?
5. **DMF import policy.** When a `.dmf` uses an effect the tracker cannot edit,
   should the import (a) refuse the file, (b) import the notes and list every
   unsupported effect by row, or (c) import and keep the effect as read-only?
   The recommendation is (b), with the original `.dmf` kept as the source.
6. **Noise exactness.** HuTrack takes NF from the row's note through twelve
   legacy values, while a studio drum has `nf` 0–31. Do we restrict drums to the
   twelve values, add an explicit note→NF table, or accept the measured 0–2
   delta and stop calling the result "the same song"? The first slice's proof
   needs an answer.
7. **PCM/DDA and LFO.** Are these ever tracker features, or does the tracker stop
   at the wave/noise PSG? The survey puts both after the first slice; LFO couples
   channels 1/2 and PCM needs a resampler, so neither is free.
8. **Keyboard default.** The manuals do not print their default letter maps.
   Should the studio adopt the BeepBox/Furnace-style two-row piano
   (`Z S X D C V G B H N J M` / `Q 2 W 3 E R 5 T 6 Y 7 U`) as the default, with
   the BeepBox layouts as options? This is a design choice, not a copied one.
9. **Licence posture.** Furnace is GPL-2.0-or-later and could in principle be
   reused under GPL-3; DefleMask cannot; HuTrack and BeepBox are MIT. Does the
   project want to stay clean-room for the tracker (docs only, our own code),
   with HuTrack as the only vendored sound code? The survey recommends yes.
10. **Who breaks the proof.** The trace-equality test will be written by the
    seat that builds the slice. Who is the different seat that breaks it cold
    (rule 2) before the card closes?
