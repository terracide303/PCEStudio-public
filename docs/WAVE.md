# pce-wave — the wave and sound editor (card #35, first increment)

**2026-10-28.** `renderer/pce-wave.js` is PCEStudio's sound document — six
PSG channels, each a 32-step 5-bit waveform with frequency, channel level,
balance, and (channels 5 and 6) the noise generator, plus the main volume and
the LFO. `renderer/wave.html` is the page that paints them and plays them.
The page's Play button is `renderer/pce-psg.js`, the model #34 proved
sample-for-sample against Mednafen, so what the editor hears is what the
exported ROM plays — and that equality is what `tests/check-wave.js`
measures: three Mednafen recordings of exported ROMs, all diff 0.

## What this increment is, and what it is not

This is the **wave editor and the exported sound** (Dennis's items (4) and the
export end of (3)). A sound is a **patch**, not a song: the six channels sound
together and hold. The tracker — Furnace `.fur`/DMF in, a JS reader playing
through `pce-psg.js`, HuTrack in the ROM — is the rest of #35
([`DECISIONS.md`](DECISIONS.md) 2026-10-28) and is not in this file. Neither
is DDA sample playback (R4 bit 6; #34's psg7 proves the model's side), and
neither is sound in toys, which waits on #30 (the Lua subset) existing.

## The document

| field | range | register | source |
| --- | --- | --- | --- |
| `wave[32]` | 0..31 | R6 | HuC6280 PSG manual PB-4, 5-bit steps |
| `freq` | 0..4095 | R2/R3 | PB-3; tone = 7159090/(64·F), so F=254 → 440.4 Hz |
| `al` | 0..31 | R4 bits 0-4 | PB-3; 31 full, 0 silent (`GetVL` sums 0x1F−AL) |
| `balance` | 0..255 | R5 | PB-4; high nibble left, low right, 15 full / 0 silent |
| `mainVolume` | 0..255 | R1 | PB-3, same shape as R5 |
| `noise.on`, `noise.nf` | ch5/ch6 only, NF 0..31 | R7 | PB-6; bit 7 enables the generator |
| `lfo.freq` | 0..255 | R8 | PB-6 |
| `lfo.ctl` | 1..3, 0 = off | R9 | PB-6; ch2 is the carrier, ch1 is modulated |

The page and the module refuse what the PSG cannot take, with the codes
`wave-step`, `wave-range`, `freq-range`, `al-range`, `balance-range`,
`noise-channel`, `noise-range`, `lfo-range`, `channel-range`.

## The export: an 8 KiB HuCard

`buildRom(sound)` emits the image; `tools/genwave.py` emits the same program
as PCEAS assembly from the same JSON (`tools/wavesounds.js` writes it), and
`tests/check-wave.js` requires the two images to be **byte-identical** — the
shape of #9's `check-export.js`. The program is #34's ROM shape: the vectors
at `$FFF6`, reset at `$E000`, `sei/csh/cld`, then every register write as an
`LDA #imm` / `STA $080x` pair, then `bra *`. Every channel is set up at
R4 = 0 (frequency and wave written while it is off), the main volume is
written, then a second pass turns the channels on (`R4 = $80 | AL`), then the
LFO. The unused bytes are `$FF`, which is PCEAS's bank fill.

Two writes are load-bearing and both were found by measurement, not reasoning:

- **R1 and R5 must be written.** Power-on global and channel balance are 0,
  so the summed volume reduction clamps to 0x1F — the forced-zero row — and
  the channel is silent however R4 is set (#34, docs/PSG.md).
- **The LFO trigger is a strobe.** Writing R9 with bit 7 set restarts the
  carrier, and in the reference model (pce_fast's own "not sure about this"
  guess, docs/PSG.md) it also **freezes** channel 2's counter while set — so a
  single R9 value with bit 7 set gives a constant 470 Hz, not a sweep. The
  export writes `0x80|ctl` and then `ctl`, as #34's psg6 does (`0x81` …
  `0x01`). Measured: the first version of `wave2` held 468.3–479.1 Hz
  (reasoning had it sweeping); after the strobe the recording sweeps
  419.9–473.7 Hz, the 416..470 Hz theory within the zero-crossing measure's
  windowing.

## The evidence

`tools/capture-wave.sh N` writes `tests/dumps/waveN/` (mednafen.wav,
sound.json, trace.json, mednafen.log) by the #34 route: pce_fast,
`-pce_fast.ocmultiplier 1`, `-soundrecord`, SIGINT exit, whole frames only.
`node tests/check-wave.js` exits 0, and each dump proves, in order:

1. the dump's `sound.json` is what `renderer/pce-wave.js` produces today
   (provenance: the editor's document is the one that was recorded);
2. `buildRom()` equals `tools/gen/waveN.pce` from PCEAS, byte for byte;
3. `pce-wave.js`'s `trace()` equals `tools/genwave.py`'s (the JS port of
   #34's simulator and the Python original agree on all 237/240/240 writes);
4. `renderer/pce-psg.js`'s PCM equals the WAV sample for sample, with the
   frame count solved from the WAV length alone.

| dump | what it is | recorded | result |
| --- | --- | --- | --- |
| wave1 | six voices, six wave shapes: the manual's scale-table chord (PB-12) at F=254/214/170/127/107 plus a bass at F=1151 (so R3's high nibble is in use — REVIEW-34 records that as a gap in #34's own recordings), AL 31/24/31/24/31/20, balance 0xFF/0xFF/0xF0/0x0F/0xFF/0xFF, noise on ch6 (NF 10) | 220,297 sample frames | **diff 0** (440,594 samples) |
| wave2 | the LFO: ch1 square at F=254, ch2 saw carrier, LFCTL 1, R8=255 → 1.727 Hz | 220,297 sample frames | **diff 0** (440,594 samples) |
| wave3 | the model's worst LFO case: the wave2 patch with LFCTL 3 (shift 4). The 12-bit sum wraps, so F runs 4094, 4095, 0 (→4096), 1, 17 … 494 — 27 Hz, the tiny-F fast path, then 6.6 kHz down to 226 Hz. REVIEW-34's "LFO mode 3" miss | 221,031 sample frames | **diff 0** (442,062 samples) |

ROM sha256: wave1 `f1d3bfb78e3c8f8e…`, wave2 `c870b8203fca0448…`, wave3
`ccc3a599387e28fe…` (8,192 bytes each; rebuild with `node
tools/wavesounds.js && python3 -I tools/genwave.py && pceas -raw -o
tools/gen/waveN.pce tools/gen/waveN.asm`).

The recordings measure what the patches are meant to be: wave1's loudest FFT
peaks are 440.1 / 880.2 / 658.1 / 1321.6 / 1761.7 / 2201.8 / 2641.9 / 522.2 Hz
— the chord and its harmonics, over the 97.2 Hz bass — with RMS L 7192.4 / R
7078.0 (the asymmetric balances); wave2's dominant FFT bin runs 419.9–468.3 Hz
over 104 windows (theory 416..470); wave3's runs 226.1–3730.6 Hz, which is
what the wrap through F=1 should look like, not a musical sweep.

**The page.** `renderer/wave.html` is a second, independent exporter path
(same module, run in the browser). A headless run of `?selfcheck=1` reports

```
wave1 bytes=8192 fnv=664372cc
wave2 bytes=8192 fnv=c103f241
wave3 bytes=8192 fnv=027f37b9
```

identical to node's `buildRom()` of the same patches — the FNV-1a of the
whole image. Reproduce with:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --user-data-dir="$TMPDIR/chrome-wave" --virtual-time-budget=10000 --dump-dom \
  "file://$PWD/renderer/wave.html?selfcheck=1"
```

## Limits, and what is left

- **The test was written by @design** (rule 2): it needs @review to break it
  cold — a builder that emits the right ROM from a wrong document, a wave
  write at the wrong register, a balance nibble swapped, a noise NF off by
  one. Only `buildRom()`'s agreement with PCEAS and the WAV diff constrain
  those, and both come from the same module. The LFO's LFCTL 2 is not itself
  recorded: ctl 1 and ctl 3 bracket its shift, and ctl 2 is interpolated.
- **DDA** (R4 bit 6) is not in the editor.
- **No sequence**: a patch holds. Songs, and the tracker, are the rest of #35.
- **Sound in toys** waits on #30/#31.
- The noise polynomial is still GAP 14 (docs/MANUALS.md §15.7): the model
  follows pce_fast, and so does this export.
