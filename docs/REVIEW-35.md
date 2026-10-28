# Rule 2 breaker (#35, #62) — the music path, broken 13 ways

Reviewer: @review (DeepSeek Flash seat). The checks under break say in their own
headers that they were written by @design, the seat that wrote the code; this
review is the different seat rule 2 asks for. Read cold: the repository only, no
briefing. Date 2026-10-28. **Nothing was fixed; this is the list.** Rule 2 in
[`../../workshop/RULES.md`](../../workshop/RULES.md): a test is proven by
breaks someone else chose.

Scope: the music path of **#35** (DMF → HuTrack player → export) and **#62**
(the wave editor and its exported patch):
`renderer/pce-dmf.js`, `renderer/pce-song.js`, `renderer/pce-hutrack.js`,
`renderer/pce-wave.js`, `renderer/pce-rom.js`'s `buildSongRom`, against
`tests/check-dmf.js`, `tests/check-export-song.js`, `tests/check-hutrack.js`
and `tests/check-wave.js`.

## What I ran

- **Baseline:** a pristine **copy** of the working tree at HEAD `1a776a0`
  (`git status` clean for all nine reviewed files — the tree carries only
  untracked files from other seats) in `$TMPDIR/review35/base` (rsync, `.git`
  excluded). The reviewed files were byte-identical to the repository when the
  sweep ended (verified again at the end; the other seat moved HEAD from
  `b2db87b` to `1a776a0` during the session, in unrelated files). sha256:
  `pce-dmf.js` `adc71162…`, `pce-song.js` `c3071950…`, `pce-hutrack.js`
  `327e0827…`, `pce-wave.js` `20e19080…`, `pce-rom.js` `0860bed6…`;
  `check-dmf.js` `c617db0a…`, `check-export-song.js` `dcad570b…`,
  `check-hutrack.js` `d45f79fc…`, `check-wave.js` `c8405fd3…`.
  All four checks exit 0:
  - `check-dmf.js` — `all checks passed` (9 melody/bass note rows, 7 HuTrack
    periods, 446 Reset writes, model-vs-recording pitch within 0.44 Hz).
  - `check-export-song.js` — `all checks passed`; PCEAS 4.x at
    `~/.local/bin/pceas4`, both 17-bank ROMs byte-identical
    (`hutrack1` `c683188f47c4e912…`, `hutrack2` `78b5281e14e46241…`).
    `HUTRACK_PYTHON` was unset, so the Python converter re-run was **skipped**
    (the committed includes were trusted as recorded); the PCEAS byte witness
    ran.
  - `check-hutrack.js` — `PASS … as recorded by Mednafen`; 68 vendor files
    match the manifest, ROM rebuilt byte-identically (139264 B), 7.003 s WAV
    classified `C4 E4 G4 C5 B4 G4 E4 C4` / `C3 G3 C3 G3`.
  - `check-wave.js` — `PASS … on 3 patch(es)`; each 8192-byte ROM equal to
    PCEAS's, each trace equal to `genwave.py`'s, each model PCM diff 0 against
    Mednafen (`wave1` 440594 samples, `wave2` 440594, `wave3` 442062).
- **Sandbox:** one copy, `$TMPDIR/review35/mut`. Each break is exactly one
  source-string substitution applied to the copy; the harness asserts the old
  string occurs exactly once before writing (twice for M08, whose two sites are
  identical), runs the **unmodified** matching check with the copy as cwd,
  records the output, and restores the pristine file immediately. The real
  repository was never edited. No keyboard or mouse events; no captures.
- **One break at a time.** `check-wave.js` regenerates its `tools/gen`
  reference from `tools/wavesounds.js` + `genwave.py` inside the copy on every
  run, so the PCEAS comparison is live, not stale.
- **Restoration:** after the sweep all five modules hash-identical to the
  pristine copy, and all four checks are green again in the mutant tree.
- **Result classes:** `DETECTED` = the matching check exits non-zero and names
  the break; `MISSED` = the check exits 0, but a side-by-side probe shows the
  mutant still changes behaviour on a legal input the check's fixtures do not
  reach; `NO-OP` = the check exits 0 and the edit is inert for every input.
  Every MISSED row below carries its probe.

## The table

Counts: **12 named directions, 13 break mutants** (engine-bank truncation split
into its two readings, M11/M11b), **plus one control — 10 DETECTED, 3 MISSED,
1 NO-OP (the control).** Of the 13 real breaks, 10 are caught (77%). Nine of the
twelve named directions are caught outright.

| # | break, applied one at a time | check | result | measured output |
|---|---|---|---|---|
| M01 | DMF row order off by one: in `readPatterns`, `rows.push(rows.shift())` before `patterns.push(rows)` (each pattern's rows rotate left one) | `check-dmf` | **DETECTED** | exit 1, 11 FAIL; `FAIL melody E4 G4 C5 B4 G4 E4 C4 C4` (expected `C4 E4 G4 C5 B4 G4 E4 C4`); `FAIL first note on the sixth EngineCall (frame 48)` |
| M02 | note anchor is engine note +59, not +60: `c.anchor = engineNote + 60` → `+ 59` | `check-dmf` | **DETECTED** | exit 1, 12 FAIL; player melody periods `453 359` vs pristine `427 339`; `FAIL note 0: model and recording within 0.5 Hz (8.200)` |
| M03 | octave shift wrong: `Math.floor(anchor / 12) - 5` → `- 4` (reference octave one high) | `check-dmf` | **DETECTED** | exit 1, 24 FAIL; `FAIL C4: anchor 96 -> period 213` (expected 427) = 525.17 Hz vs 261.63; E4 → 169 = 661.90 Hz |
| M04 | period table index off by one: `anchor % 12` → `(anchor % 12 + 1) % 12` | `check-dmf` | **DETECTED** | exit 1, 27 FAIL; `FAIL C4: anchor 96 -> period 403` = 277.57 Hz; E4 → 320 = 349.56 Hz |
| M05 | volume envelope not looping: `if (c.volEnv.loop !== 0xff)` → `if (false)` (holds the last value forever) | `check-dmf` | **MISSED** | exit 0, `all checks passed`; probe with a legal looping envelope: same 860 events, first diff event 564 (frame 10) — pristine `R4=$94` (looped to 20), mutant `R4=$80` (held at 0) |
| M06 | waveform envelope skipped: force `wave = 0` (never consult `waveEnv`) | `check-dmf` | **MISSED** | exit 0, `all checks passed`; probe with a legal two-waveform song: pristine 3302 events vs mutant 860, first diff event 535 (frame 7) — pristine `R4=$5F` (continuing the second wave's upload), mutant `R0=$01` (moved on; wave 1 never uploaded) |
| M07 | order dedup wrong: `sameRows` returns false always, so identical patterns are never shared | `check-export-song` | **DETECTED** | exit 1, 6 FAIL; `demo.patternData.inc` line 33 has an extra `.dw .pattern.table.chan0.pattern1` where Python has none; `demo.patternMatrix.inc` line 22 `.db 1` vs `.db 0` |
| M08 | empty-row run length off by one: `EMPTY_RUN + emptyRun - 1` → `EMPTY_RUN + emptyRun` at both sites (skip one row too many) | `check-export-song` | **DETECTED** | exit 1, 4 FAIL; `demo.patternData.inc` line 96 `.db $e8` vs `$e7`; `demo2` `$e2` vs `$e1`; ROM first diff bank 16 offset 175 |
| M09 | include bytes in a different order: write the instrument before the note in the packed field order | `check-export-song` | **DETECTED** | exit 1, 4 FAIL; `demo.patternData.inc` line 95 `.db $5, $0, $24` vs `$5, $24, $0`; ROM first diff bank 16 offset 173 |
| M10 | song bank placed at `$0F` instead of `$10`: `rom.set(song, SONG_BANK * BANK)` → `(SONG_BANK - 1) * BANK` | `check-export-song` | **DETECTED** | exit 1, 2 FAIL; both songs `first difference at byte 122880 (bank 15, offset 0)` |
| M11 | engine banks truncated, tail reading: copy only 15 of the 16 engine banks | `check-export-song` | **MISSED** | exit 0, `all checks passed` (both ROMs still byte-identical to PCEAS); the committed engine's bank `$0F` is 0xff filler — non-0xff byte counts are bank 0:490, 1:100, 8:7614, 9:2863, all 12 other banks 0. Probe with a valid 16-bank engine that uses bank `$0F`: 8192 bytes differ, first at 122880 |
| M11b | engine banks truncated, used-bank reading: copy only the first 9 banks (drop bank `$09`'s pitch tables) | `check-export-song` | **DETECTED** | exit 1, 2 FAIL; both songs `first difference at byte 73728 (bank 9, offset 0)` |
| M12 | wave editor balance nibbles swapped L/R: `write(5, ch.balance)` → `write(5, ((b & 0x0f) << 4) \| ((b >> 4) & 0x0f))` | `check-wave` | **DETECTED** | exit 1; `wave1: buildRom() differs from the PCEAS image at byte 554` (`0xF0`/`0x0F` voices) |
| C13 | **control, not a break:** `var STEPS = 32` → `var STEPS = 64 - 32` | `check-wave` | **NO-OP** | exit 0, `PASS … on 3 patch(es)`; the edit is inert, so a PASS is not by itself suspicious |

The 12 named directions map to M01–M12; M11 is split into its two readings
(drop the empty tail bank / drop used banks), giving 13 break mutants. The
control shows the harness also prints PASS for an inert edit, which is why every
MISSED row carries a probe.

## The three MISSED breaks, and the fixture or check that would catch them

Each PASS below is a real behavioural difference, not an inert edit: a
side-by-side probe loads the pristine and mutant modules, traces a **legal**
song (`checkSong` accepts it), and changes the emitted register events.

- **M05 — the volume envelope's loop.** The only song `check-dmf.js` plays,
  `tests/dumps/hutrack1/demo.dmf`, has one instrument with
  `volumeEnv {size:1, data:[31], loop:$FF}` — the check asserts exactly that
  ("1 step of 31, held"). With a one-step envelope the loop branch is never
  entered, so "never loop" is invisible. `hutrack2` does carry a looping
  envelope (`size 4, data [31,28,20,12], loop 2`), but the player refuses that
  song before it gets there: instrument 0 has an arpeggio envelope
  (`song-arp`) and the patterns use two effect columns (`song-fx`). The probe
  gave `hutrack1` an instrument with `{size:4, data:[31,20,10,0], loop:1}`;
  at frame 10 the pristine player has looped to step 1 and writes `R4=$94`
  (level 20), the mutant has ended and holds `R4=$80` (level 0).
  *Which check would catch it:* `check-dmf.js` with a fixture (or a direct
  assertion on `trace().events`) whose volume envelope loops — a legal song,
  as the probe shows. The check already asserts the held-`$FF` case; the
  missing case is the non-`$FF` loop.

- **M06 — the waveform envelope.** The same fixture has one waveform and a
  one-step waveform envelope selecting wave 0 (`{size:1, data:[0],
  loop:$FF}`), so forcing `wave = 0` is byte-identical. The probe added a
  second waveform and set `wavetableEnv {size:2, data:[0,1], loop:0}`: the
  pristine player uploads wave 1 (the 32 `R6` writes and the `R4` toggles),
  3302 events; the mutant never consults the envelope and stays on wave 0,
  860 events, diverging at event 535.
  *Which check would catch it:* `check-dmf.js` with a two-waveform fixture and
  a waveform envelope that moves (the engine's upload sequence is already
  asserted for the first note, so the same assertion on a later frame would
  catch it). A cheaper model assertion — `uploadedWave` follows the envelope —
  would too.

- **M11 — the engine's last bank.** `check-export-song.js` compares the JS
  ROM with PCEAS's build of **one** committed engine image,
  `renderer/hutrack-engine.bin`. That image uses only banks `$00`, `$01`,
  `$08`, `$09`; banks `$02–$07` and `$0A–$0F` are all 0xff filler. Dropping
  bank `$0F` therefore produces byte-identical ROMs and the check stays green.
  The probe built a valid 16-bank engine with data in bank `$0F`:
  `buildSongRom` lost all 8192 bytes of it (first diff at 122880).
  *Which check would catch it:* `check-export-song.js` with a second engine
  image that uses its tail bank, or a direct assertion that
  `buildSongRom({engine, song})`'s first `16*8192` bytes equal `engine` for an
  arbitrary 16-bank input. M11b shows the check **does** catch a truncation
  that removes used bytes (dropping bank `$09` fails at byte 73728), so the
  assertion is sound; the gap is the fixture's empty tail.

## What this means for #35 and #62

- **#35's note/pitch path is strong.** M01–M04 (row order, +60 anchor, octave
  shift, table index) are all caught, by both the direct `periodFor` cases and
  the player's note periods/audio. The reader's two independent decoders (the
  DMF reader vs the converter's compressed stream) also catch M01.
- **#35's export path is strong where the bytes are used.** M07–M10 and M11b
  are caught by the include-text and whole-ROM byte comparisons. The only miss
  is a truncation of engine bytes that do not exist in the one committed
  engine.
- **#35's envelope semantics are the weak spot.** The player advertises "the
  volume envelope ... and the waveform envelope" (`pce-song.js` header), but
  the only song the player check plays has a one-step held envelope and a
  one-wave held envelope. Both loops (M05, M06) pass. This is a fixture gap,
  not an assertion gap: the same check catches the trivial forms.
- **#62 has no miss here.** The wave check is a live byte comparison with
  PCEAS plus a sample-exact diff with Mednafen, and it caught the balance
  nibble swap at ROM byte 554; the three patches also bracket the R3 high
  nibble and LFCTL 3 (the #34 misses), so its own coverage is better aimed than
  #35's player.
- Per rule 2 the three misses route one kind up from the checks' writer
  (@design, named in each check's header): **a `check-dmf` fixture with a
  looping volume envelope and a moving two-waveform envelope**, and **a second
  engine image (or a `buildSongRom` length assertion) for
  `check-export-song`**. Then re-run M05, M06 and M11 and require DETECTED.
  Until then, "the player implements the envelopes" is proven only for the
  held one-step case, and "the engine image is copied whole" is proven only
  for an engine whose last bank is empty.

This review commits only this file; the cards, the fixtures and the tests are
left for their owners.
