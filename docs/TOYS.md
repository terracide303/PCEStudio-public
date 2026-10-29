# Toys in the browser — the Lua runtime (#30, first half)

A toy is one Lua file with `init()`, `frame(t, f)` and optionally `raster(line)`.
It runs live in `renderer/toys.html`; every frame it produces is drawn by
`renderer/pce-sprites.js` over `renderer/pce-bg.js` — the models proven against
Mednafen — so there is no second renderer. The compiler, the validator and the
console are separate cards (#31, #32); this card is the browser half.

`renderer/pce-toys.js` is the runtime. `tests/check-toys.js` is its evidence.

---

## 1. The Lua VM: Fengari (Lua 5.3 in JavaScript)

The card asked Fengari (Lua 5.3, JS, MIT) vs wasmoon (Lua 5.4, WASM, MIT) on
four questions. The answer is **Fengari**.

### Size — read from the published packages

Downloaded with `npm pack fengari-web@0.1.4 wasmoon@1.16.0` on 2026-10-28 and
measured with `gzip -c`:

| | raw | gzipped |
|---|---:|---:|
| Fengari (`fengari-web/dist/fengari-web.js`) | 219,632 B | 70,074 B |
| wasmoon (`dist/index.js` + `dist/glue.wasm`) | 423,233 B | 150,024 B |

Fengari is about half the bytes on the wire, and it is a single file: no
`.wasm` fetch, no MIME/server configuration, no instantiation step. For a page
that must start a toy on load, that matters. (wasmoon's own README quotes the
same ratio: 214 kB / 69 kB vs 393 kB / 130 kB.)

### Speed — measured here, for this runtime's workload

Benchmark: Node 26.11.1, macOS, this machine, 2026-10-28. Each VM ran the same
three Lua programs, once each, after starting the VM:

1. **pure Lua** — `local s=0; for i=1,300000 do s=s+(i%7) end`
2. **host calls** — `for i=1,120000 do host(i) end`, where `host` is a JS
   function called from Lua (this is the path every `reg()`/`pal()` write takes)
3. **table writes** — `local t={} for i=1,20000 do t[i]=i%512 end`

| milliseconds | Fengari | wasmoon | winner |
|---|---:|---:|---|
| pure Lua, 300k iterations | 29.0 | 6.9 | wasmoon, 4.2x |
| 120k host calls | 38.8 | 170.5 | **Fengari, 4.4x** |
| 20k table writes | 8.2 | 0.6 | wasmoon, 13x |

Why these three: a toy's per-frame cost is the model's drawing plus its own Lua
loops plus the host calls that carry register and palette writes. With
`raster(line)`, a frame makes 224 callbacks, each making 0–4 host calls — so the
host-call column is the one this design lives in. At Fengari's 0.32 µs a host
call, a full 224-line pass that writes one register per line costs about
0.07 ms/frame; at wasmoon's 1.4 µs it is about 0.31 ms. Both fit a 60 Hz frame
for the toys this card asks for, and the model's own drawing dominates; the
rank orders are what they are. The honest cost of choosing Fengari is that a
toy doing heavy pure-Lua work (per-pixel loops) runs ~4x slower than it would
under wasmoon — acceptable for toys, and it is the case this runtime does not
optimise for.

The vendor's own heapsort benchmark (wasmoon README: 15.3 ms vs 389.9 ms) is
pure Lua and is consistent with row 1; we did not repeat it.

### Sandboxing

Both are **capability sandboxes**: the host chooses which libraries open, and
Lua cannot name the filesystem, network or DOM unless a host function hands it
over. `renderer/pce-toys.js` opens only `base`, `table`, `string`, `math` and
`utf8`, then removes `dofile`, `loadfile`, `require`, `package`, `io`, `os`,
`debug`, `collectgarbage` and `coroutine` by name. `print` is replaced by a
captured log (bounded at 200 lines), so a toy cannot flood the console or the
page.

The difference is the isolation boundary: wasmoon's Lua runs inside a WASM
linear memory, a real boundary between the interpreter and the page; Fengari is
an interpreter written in JavaScript running in the page's own realm. Neither
is a security boundary against a malicious *host extension* — every function we
expose is a door — and this card's threat model is a toy with a bug, not an
attacker. What matters more here is **cost**, which neither VM enforces by
default (ppu.toys has no instruction budget either; docs/PPU-TOYS.md says so):
Fengari exposes `lua_sethook`, and the runtime sets a count hook every 10,000
instructions with a wall-clock deadline per frame (100 ms default). A runaway
`while true do end` becomes `toy-timeout` instead of a frozen tab
(`tests/check-toys.js` proves it). wasmoon is moving this direction too — its
engine has a `functionTimeout` option and `lua_sethook` in its low-level
`LuaWasm` binding — so this is not a categorical win, but Fengari's hook is
directly usable as a JS function that throws into `pcall`, which is exactly the
shape the rest of this runtime uses.

### Hooks and errors

This runtime is built from three host↔Lua moves, all of which are the C API
Fengari implements:

- install a JS function as a global (`lua_pushjsfunction` + `lua_setglobal`) —
  `reg`, `pal`, `sprite`, `sat`, `raster`, `print`;
- call a toy global with arguments (`lua_getglobal` + `lua_pcall`) once per
  frame and 0–224 times for `raster`;
- read the toy's own `file:line` at the refusal (`luaL_where`) and pass a typed
  JS error through `lua_atnativeerror`, so a refusal becomes
  `{code, message}` in JavaScript and `TOYCODE:code: message` through Lua.

No promises, no async, no wasm boundary per call. The toy's errors carry
`toy.lua:<line>` (the chunk is loaded as `@toy.lua`), and `tests/check-toys.js`
asserts it.

### Licence

Both are MIT. `vendor/fengari/` carries the fengari-web 0.1.4 build
(fengari 0.1.5 + fengari-interop) and its MIT licence; see
`vendor/fengari/VENDORED.md`.

---

## 2. What a toy is

```lua
function init()            -- once, after the file's top-level statements
end

function frame(t, f)       -- every frame: t seconds (f/60), f the frame number
end

function raster(line)      -- optional: every VDW display line 0..223, after
end                        -- frame(), for per-line changes (the RCR interrupt)
```

All three are optional. State is ordinary Lua globals and persists across
frames. `t` is deterministic (`f/60`), not wall-clock: a frame is reproducible.

### The surface

| call | what it does | range / refusal |
|---|---|---|
| `reg("BXR", v)` | horizontal scroll (VDC R07) | 0..1023, `reg-range` |
| `reg("BYR", v)` | vertical scroll (VDC R08) | 0..511, `reg-range` |
| `reg("CR", v)` | control (VDC R05: BB, SB, interrupt enables) | 0..255, `reg-range` |
| any other `reg(name, v)` | not a toy register | `reg-forbidden` |
| `pal(addr, word)` | a VCE colour entry | addr 0..511, word 0..511, `pal-range` |
| `vram[addr]` / `vram[addr] = word` | a VDC VRAM word | addr 0..32767, word 0..65535, `vram-range` |
| `sat(i, k, v)` | a raw SAT word | i 0..63, k 0..3, v 0..65535, `sat-range` |
| `sprite(i, spec)` | compose SAT entry i (below) | `sprite-range` |
| `raster(line, spec)` | one raster-table entry (table form) | line 0..223, `raster-line` |
| `pad[n].up/down/left/right/i/ii/select/run` | 2-button pad n (1..5), refreshed before `frame` | read-only booleans |
| `rgb(r, g, b)` | a VCE word from 3-bit channels | channels are masked to 0..7 |
| `note(name or MIDI)` | the PSG's 12-bit F for a note | `toy-error` on a bad name |
| `music(index)` | play song `index` from the start (#71) | an index into the songs the runtime was given; none or past them is `music-range` |
| `sfx(channel, freq, volume, frames)` | take `channel`, play a 32-step square at F = `freq`, AL = `volume`, for `frames` frames, then give it back | channel 0..5, freq 0..4095, volume 0..31, frames 1..600 (`sfx-range`) |
| `release(channel)` | give a channel back now; the music waits for a fresh note | channel 0..5 (`sfx-range`); a channel no SFX owns is left alone |
| `password.pack(v)` / `password.unpack(code)` | a save as a short code | `password-value` / `password-code` |
| `print(...)` | the page's log (not the console) | captured, 200 lines |

Defaults: a blank VDC — 256x224, `MWR = 0` (32x32 BAT), `BXR = BYR = 0`,
`CR = 0x80` (BB: background on), all VRAM, CRAM and SAT words zero. `sprite`
fields: `x` and `y` 0..1023 (SAT X 32 / Y 64 is the display's top-left),
`pattern` 0..1023, `palette` 0..15, `cgy` 0..3, and booleans `spbg`, `cgx`,
`hflip`, `vflip` — composed into the four SAT words exactly as
`renderer/pce-sprites.js` reads them (SAT Y 64 = display row 0).

**A sprite pattern is not a background tile.** The BAT addresses a tile as 16
words (`vram[char*16 + row]`, two bitplanes per word); the SAT addresses a
sprite pattern as a 64-word cell — **pattern `p` starts at word `p*64`, plane
`n` is `p*64 + n*16 + row` for rows 0..15, and bit 15 of a plane word is the
strip's left pixel** (HuC6270 manual 2.4; `renderer/pce-sprites.js`
`stripWords`/`stripPixel`). Writing `vram[p*16 + row]` for a sprite leaves the
pattern the SAT reads empty, so the sprite is invisible even though the toy
wrote "a pattern". The studio's `sprite-pad.lua` example writes through a
`putsprite(pattern, fn)` helper with that layout, the way its background
examples use `puttile`; copy it beside the toy (#90).

Lua helpers (adapted from ppu.toys — see §4): `clamp`, `lerp`, `ease`, `ramp`,
`ramp_int`, `lerp_color`, `ramp_color`, `rgb`, and the flat `min`, `max`,
`floor`, `sin`, `cos`, `abs`, `sqrt`, `pi`.

### The raster table, two forms

The PCE has no HDMA: the per-line trigger is the RCR line interrupt. A toy may
express per-line changes two ways:

1. **a callback** — define `raster(line)`. The runtime calls it for every VDW
   display line 0..223 of the frame, after `frame()`, and journals the
   registers and palette writes it makes during that call as that line's
   entry. This is the form that will become an RCR ISR on the console (#31).
2. **a table** — call `raster(line, spec)` from `frame()` (or from `init()`
   for a static table). `spec = {bxr=, byr=, cr=, cram={{addr, word}, ...}}`.
   This is #17's table in the toy's hands.

Both produce the one table shape `renderer/pce-bg.js`'s `buildRows` already
consumes: `{base:{bxr,byr,cr}, baseCram:[512 words], entries:[{line, rcr,
bxr?, byr?, cr?, cram?, cramPrev?}]}`. A line gets **one** entry — the RCR
interrupt fires once per line — so a second `raster(line, ...)` for the same
line is `raster-line-full`, and so is more than 64 colour writes during one
line's callback. The runtime also carries `cramPrev` from the previous frame's
journal, because the VCE persists across frames and a frame-varying table
needs it (the model's `buildRows` rule).

A toy chooses one form: defining `raster` replaces the host function, which is
how the runtime tells them apart (`callbackRaster` in the tests).

### Saves: passwords, not bram

Dennis, 2026-10-28: **saves are passwords**; a bare HuCard has no backup RAM
(docs/DECISIONS.md). `password.pack(v)` turns a typed, capped value into a
short code (`P1` + base32 + a check byte) and `password.unpack(code)` returns
it. Types: nil, booleans, integers, strings, and nested tables (number or
string keys), serialized
deterministically (array part in order, other keys sorted by their encoding).
Each cap is a maximum the round trip holds to, and one past it is refused by
`password-value` naming the edge — never truncated:

| field | maximum | past it |
|---|---|---|
| an integer | −1,073,741,824 .. 1,073,741,823 (−2^30 .. 2^30−1) | `password-value` |
| a non-integer number (`1.5`, `2^31` as a float) | none — not an integer | `password-value` |
| a string | 64 bytes | `password-value` |
| a table | 32 entries in all, nested at most 6 tables deep | `password-value` |
| the code's value bytes | 96, before the check byte | `password-value` |

**Why the integer cap is 2^30 and not the VM's full 32-bit range.** This
Fengari build's integers are 32-bit — `docs/IL.md` §1 reads it from `lvm.js`,
which computes `ADD` as `(a + b) | 0` — and the zig-zag encoding spends one
bit on the sign. A magnitude of 2^30 doubles to 2^31 and wraps, so a cap of
2^31−1 (what the card's first version documented) is not saveable at either
end. Card #73: `password.pack(1073741824)` used to loop `p_int` until
`toy-timeout`; it is now `password-value` naming the range. The decoder
refuses a code whose number is past 2^31−1 for the same reason, so an
editable code cannot decode to a value `pack` would have refused.

Anything else is `password-value`; a mistyped or foreign code is
`password-code`. The contract — named error, sized cap — is ppu.toys' `sram`
contract applied to a code instead of a save medium.

There is no `bram`: the card's old title mentioned it, the description and
Dennis's decision supersede it.

### Sound in toys (#71)

A toy makes sound with the same model the rest of PCEStudio uses,
`renderer/pce-psg.js` (#34), and the same player the tracker route does,
`renderer/pce-song.js` (#35). It does not get a synth of its own.

**Songs.** `toys.create(source, {songs: [song, ...]})` gives the toy a list of
songs in the shape `renderer/pce-dmf.js` returns (a module the page read with
`pce-dmf.read`/`parse`). `music(index)` starts one — HuTrack's `playSong`,
which resets the engine (the two power-on rounds, 446 writes) and then runs
one VBlank per toy frame. Calling it again restarts. A song index the runtime
was not given is `music-range`, and a runtime given no songs at all refuses
the same way rather than playing silence.

**SFX and the channel hand-off.** `sfx(channel, freq, volume, frames)` hands
one PSG channel to an SFX and `release(channel)` hands it back, as
`HuTrackEngine.setChanForSFX` / `chanReleaseSFX` do
(`vendor/hutrack/.../compatibility.md`, "SFX channel ownership"):

- **reserve** writes the channel's select, control 0, noise off, the LFO off
  on channels 0/1 (the hardware couples them) and balance both sides full;
- the **SFX** loads a 32-step square in `.copy.wave`'s shape (the DDA/wave
  toggles reset the PSG's wave pointer, the 32 R6 writes fill it), then sets
  F and AL, and is **given back automatically** after `frames` frames;
- during the SFX **the music keeps advancing its logical state** (rows, order,
  envelopes) but writes nothing to that channel — HuTrack's four write paths
  (frequency, waveform, control, DDA) all test the reservation;
- **release** silences the channel and does not resume the middle of a held
  note: the music **waits for the next note row** on that channel, and that
  fresh note reloads the instrument's waveform (all 32 steps) even when it has
  not changed, exactly as the engine does. A repeated release is harmless and
  never silences a channel the music owns.

The whole hand-off lives in `pce-song.js` (`createPlayer`'s `reserve`/
`release` and its `sfx`/`waitNote` gating), so the engine has one
implementation for the batch `trace()` and the live toy alike.

**Order within a frame.** The PSG writes of a frame are recorded in the order
a console would make them: the song's VBlank tick (and an expired SFX's
release) first, at `beginFrame`, then whatever the toy's `frame()` asks for —
the display period after the interrupt. Within a frame each write is 12 CPU
cycles after the one before (`pce-song.js`'s order-preserving default), and a
song started in `init()` shares frame 0's column order with that frame's
first tick, so no two writes claim the same instant.

**Limits.** 6 channels; F is the PSG's 12-bit divider (`note()` returns it; the
same value from a MIDI number in both runtimes); volume is AL, 0..31; an SFX
lasts 1..600 frames. The SFX waveform is fixed (a square) — a toy with more
than one effect shape is a later card. The recording keeps
`SOUND_EVENTS_MAX` = 65,536 writes per runtime and then stops recording
(`sound.overflow`), because the browser's real-time playback (#78) will feed
the PSG incrementally instead of keeping the whole session.

**Not in this half.** Effect columns, arpeggios and DDA/PCM samples in the
player are the second half of #71; `pce-song.js` still refuses such a song by
code (`song-fx`, `song-arp`, `song-pcm`).

---

## 3. One model, one host

`runtime.frame(f)` returns `{frame, width, height, pixels, raster, state}` and
`runtime.options()` returns the exact object handed to the model. The toy's
own contract — the surface, its ranges, the SAT composition, the raster table
and its `cramPrev` rule, the pads, the frame flow — lives in
`renderer/pce-toyhost.js`, which this runtime and the IL interpreter
(`renderer/pce-il.js`, #31) both use, so there is one copy of it. Nothing in
`renderer/pce-toys.js` draws: it drives that host, which writes the model's
own input arrays (`state.vram` 65,536 B, `state.cram` 1,024 B,
`state.sat` 512 B, `state.regs`) and then calls

```js
renderer/pce-sprites.js  renderFrame({vram, cram, sat, regs, width, height, raster?})
```

which composes the background through `renderer/pce-bg.js`. `tests/check-toys.js`
also asserts that a runtime frame is byte-identical to calling
`sprites.renderFrame(runtime.options())` directly.

`renderer/pce-psg.js` is wired since #71, and not as a second sound model:
the host records every PSG write the toy's music and SFX make as
`{f, t, reg, value}` — the event shape `pce-psg.js` already takes — and
`runtime.renderSound(count)` is that model's PCM for them. The two modules
are resolved when a host is created, not when `pce-toyhost.js` loads, so a
page may load them in any order; a page that never loads them still runs
its toys and refuses sound with `no-psg`.

---

## 4. What was taken from ppu.toys

MIT, Copyright (c) 2026 Liora Labs, at commit `0b07767`; the licence and the
per-file judgement are in `vendor/ppu-toys/VENDORED.md`.

- **Taken and adapted** — `ramps.lua`'s interpolation helpers (same names and
  semantics; `lerp_color` moved from 15-bit BGR555 to the VCE's 9-bit word) and
  `kit.lua`'s note-name parser (`note()` returns the PCE PSG's 12-bit F, not an
  SNES sample pitch).
- **Pattern only** — `controls_env.lua`'s tracked write journal (real table,
  key, old value; replayed backwards to un-bake an override). #30's per-line
  journal that builds the raster table is the same idea in JavaScript. Its code
  is proxy machinery for the SNES engine's globals and does not fit.
- **Not taken** — `instrument`, `sfx`, `voice`, `song`, `bank`, `score`: they
  encode the SNES S-DSP voice model, and PCEStudio's PSG is `pce-psg.js`.

---

## 5. Evidence

`node tests/check-toys.js` exits 0 with **790 checks**:

- three toys run **40 frames** each, and for every frame:
  - the runtime's `vram`, `cram`, `sat` and `regs` equal arrays built by hand
    in the test from the toy's written specification (byte for byte);
  - the runtime's raster table equals a hand-built table (deep equal,
    including `base`, `baseCram`, `cram`, `cramPrev`);
  - the runtime's pixels equal `sprites.renderFrame()` on the hand-built state
    (diff 0).
  The toys are the three the card names: a palette-cycling one (no raster),
  a scrolling one using the `raster(line)` callback, and a sprite toy reading
  `pad[1]` (right/down/left/up over the 40 frames).
- refusals by code: `reg-forbidden` (MWR), `reg-range` (BXR 1024, BYR 512),
  `pal-range`, `vram-range`, `sprite-range`, `raster-line` (line 224),
  `raster-line-full` (two entries on line 10; 65 colour writes on one line),
  `password-value`, `password-code` (foreign and mistyped), `toy-timeout`
  (`while true do end`), `toy-error` (a Lua error with `toy.lua:<line>`).
- the sandbox: `os`, `io`, `require`, `dofile`, `loadfile`, `package`, `debug`
  and `coroutine` are nil inside a toy; `print` goes to the captured log.
- the password round trip, determinism, and that numbers differ in the code.
- **sound (#71)**: a fourth toy (`TOY_SOUND`, 21 frames) starts a song in
  `init()` and fires an SFX on channel 0 when I is pressed. The test builds
  every expected PSG write from the engine's own rules, not from the player:
  both Reset rounds (446 writes), `SetFrequency`, `.copy.wave`'s upload, the
  amplitude write, reserve's five, the square's 32 R6 steps and F/AL, and
  release's four. The runtime's recording equals it write for write (frame,
  order, register, value), including the frames where the music is silent
  under the SFX (11..14 write nothing), the release frame (15 writes only the
  release), and the resumed note (16 reloads all 32 wave steps). The PCM is
  `psg.render()`'s output for those same writes and is not silence. The IL
  runtime runs the same toy to the same writes and the same PCM (Lua == IL).
  Refusals: `music-range` (a song index past the list, or no songs at all),
  `sfx-range` (channel 6, F 4096, volume 32, 0 frames, `release(6)`), from
  both runtimes.
- the page's wiring: `renderer/toys.html`'s declared scripts and inline script
  are executed in a stub DOM (the `check-editor.js` pattern, no jsdom), the Run
  button is clicked and four `requestAnimationFrame` ticks are pumped; the page
  loads the VM as a browser global, creates a runtime, paints frames and shows
  no error. This is not a real browser.

The live page is `renderer/toys.html` (serve the repo root and open it;
`?demo=1` starts the default toy).

**Rule 2:** the test was written by the seat that wrote the runtime, so a cold
break by another seat is owed before this closes the card.

## 6. Not proven, and what comes next

- The page was executed in a stub DOM, not a real browser: layout, CSS, a real
  canvas and a real animation clock are stubbed. A browser run is the next
  thing to do by hand.
- The VM benchmark is one run on one machine; the ratio on a slow phone will
  differ. The decision is not close on size or on host-call speed.
- `raster(line)` on the console is an RCR ISR with a cycle deadline; the
  browser calls it for 224 lines regardless. Pricing that is #32; compiling it
  is #31.
- Sound in toys is #71; the PSG model is not reachable from a toy yet.
- The refusal codes and ranges here are what the toy reference (#61) must
  generate from, so a test can show the docs and the model agree.
- The console path has started: `renderer/pce-il.js` lowers this same subset to
  PCEStudio's IL (`docs/IL.md`, #31) and a reference interpreter runs it over
  the same host and models. `tests/check-il.js` shows the three toys here give
  byte-equal state, the same raster table and diff-0 pixels through both the
  Lua runtime and the IL. The IL refuses part of this surface for now (strings,
  passwords, `note`), and no machine code exists yet.
