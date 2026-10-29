# Pads and the timer (#45)

The console's two remaining inputs — the pads behind the I/O port at `$1000`
and the TMA timer at `$0C00`/`$0C01` — in the browser host and on the
console, with the reading that settles each one.

## What the hardware does

### The pads (`$1000`, port K)

| fact | source |
|---|---|
| Port K is read at physical `$1FF000`–`$1FF3FF` (`$1000` with MPR7 = `$FF`); port O shares the address, so a *write* sets SEL/CLR | HuC6280 Hardware Manual H8-19 (`2.6.1 Port K`, `2.6.2 Port O`) |
| D3–D0 are the four joystick lines; writing bit 0 drives SEL and bit 1 drives CLR | pcetech §4 "I/O port" (HuDK `include/joypad.inc` documents the same pinout) |
| SEL = 0 returns the buttons (Run, Select, II, I on D3..D0), SEL = 1 the D-pad (Left, Right, Down, Up); the inputs are inverted, so 0 means pressed | pcetech §4; HuDK `joypad.inc` bit table |
| A short delay is needed after every SEL change — "a common sequence is PHA PLA NOP NOP" | pcetech §4 |
| The Turbo Tap: a 0→1 edge of SEL with CLR low advances the counter to the next controller; SEL high with CLR 0→1 resets it to controller 1; a sixth read returns `$00`; unconnected controllers return `$0F` | pcetech §4 "Turbo Tap details"; Mednafen `src/pce/input.cpp` `MultiTapWrite`/`MultiTapRead` |
| The reset quirk: after writing `$01` and then `$03`, D3–D0 return controller 1's D-pad although CLR is high | pcetech §4 |

The read sequence used here is **HuDK's** (`HuDK/include/joypad.inc`, MIT,
(c) 2016-2020 MooZ), which follows pcetech §4 exactly:

```
write $01, write $03            ; reset the tap to controller 1
for each of five controllers:
  write $01, delay, read D-pad  ; SEL high
  write $00, delay, read buttons; SEL low (the next $01 is the edge)
```

Two of these details are load-bearing and were found by measurement, not
reading:

- **The delay.** Two NOPs (4 cycles) read a stale value on every other frame.
  Five NOPs (~10 cycles, HuDK's ~11) make it exact. `tools/toyc/toy_runtime.c`
  `joy_delay()`.
- **The first `$01` after the reset does not increment.** After `$03` SEL is
  already high, so the first `$01` only drops CLR; the tap stays on controller
  1. Writing `$01` from a low SEL would read controller 2 first.

### The timer (`$0C00`/`$0C01`, vector `$FFFA`)

| fact | source |
|---|---|
| `$0C00` writes the 7-bit reload register, `$0C01` bit 0 is Start/Stop; a read returns the downcounter | H8-20 |
| The prescaler is OSC1 / 3 / 1024; at 21.48 MHz that is 6.992 kHz, so an interval of 143 us to 18.3 ms | H8-21 |
| A borrow sets TIQ and reloads the downcounter immediately; the request must be reset by a write to the interrupt request register `$1403` | H8-15, H8-21/22 |
| `$00` counts as 1 tick and `$7F` as 128 — a period of (reload + 1) ticks | pcetech §2.2 |

Timer frequency = 7,159,090.9 / 1024 = **6,991.3 Hz** (the same figure
llvm-mos's `PCE_TIMER_FREQ` gives).

## The browser host

`renderer/pce-toyhost.js` owns the tick rate. A frame is 1/60 s
(`docs/TOYS.md`), so whole ticks are accumulated at 6,991.3 Hz and the
interrupt count for each frame is `floor(acc / (period+1))`. The Lua surface
is `timer(period, fn)`, `timerstop()` and `timerirqs()`; `renderer/pce-toys.js`
and `renderer/pce-il.js` call `fn` once per interrupt at the frame boundary,
so the Lua and the IL runtimes report the same counts.

## The console runtime

`tools/toyc/toy_runtime.c`, under `TOY_INPUT_BUILD` (set by
`tools/build-toyc.sh` only when the generated C uses `toy_pad`/`toy_sat`/
`toy_timer_set`, so a toy without them stays byte-identical):

- `joy_scan()` — the sequence above, once per toy frame.
- `toy_pad(n, field)` — one bit of the scanned word.
- `toy_sat(i, k, v)` — SAT word k of entry i, written to VRAM `$7F00 + i*4 + k`,
  the buffer the VDC's DSR auto-repeat DMAs into SATB every VBlank.
- `toy_timer_set(period)` / `irq_timer()` — the reload register, the Start
  flag and the timer interrupt on vector `$FFFA`; the handler acknowledges TIQ
  at `$1403` and counts. `toy_timer_pending()` returns and clears the count,
  and the generated frame flow calls the toy's callback once per interrupt.
- `toy_display_on()` keeps the toy's CR when the toy set one, so a sprite
  toy's SB bit survives the turn-on.

## Evidence

Neither run sends keyboard or mouse events. The browser is driven by
`setPad()`; the console by **Mednafen's own input movie** — a save state plus
one record of the port data per frame — started from the command line.

`tools/capture-pads.sh` reproduces both runs; its output is
`tests/dumps/pads/evidence.json`, `padmove.bin` and `timertoy.bin`. What it
measured on 2026-10-29, with `tools/gen/padmove.pce` (sha256 `7d788a3a…`,
8 KiB) and `tools/gen/timertoy.pce` (sha256 `e9acce48…`):

**The pad.** The script holds Right for frames 700–729, Down 730–749, Left
750–769 and Up 770–779; the toy starts at (144, 128) and adds one pixel per
frame per direction. Mednafen's final state, read from the RAM dump:

| | SAT Y | SAT X | sprite at |
|---|---|---|---|
| console, frame 1293 | 202 | 186 | (154, 138) |
| browser, frame 1293 | 202 | 186 | (154, 138) |

Byte for byte equal, and equal to the script's arithmetic:
144 + 30 − 20 = 154, 128 + 20 − 10 = 138.

**The timer.** `timer(17, …)` starts the timer with reload 17, i.e. an
interrupt every 18 ticks of 6,991.3 Hz = 388.4 Hz.

| | frames | interrupts | per frame |
|---|---|---|---|
| console (Mednafen, 59.83 Hz video) | 607 | 3938 | 6.488 |
| browser (60 Hz host) | 607 | 3929 | 6.473 |
| arithmetic 6,991.3 / 18 / frame rate | | | 6.473 (at 60 Hz) |

The console's figure is 0.23 % over the 60 Hz arithmetic — the difference is
its 59.83 Hz video rate — and the browser's is 0.01 % under it. The two runs
disagree by 0.23 %, all of it the frame rate, not the timer.

### The instrument

Mednafen 1.32.1 can start a movie only from the SHIFT+F7 hotkey. The copy
`tools/build-mednafen-instrument.sh` builds adds one command-line flag,
`-loadmovie FILE`, which calls Mednafen's own `MDFNI_LoadMovie` right after the
game loads — the same call the hotkey makes. Nothing else in the emulator
changes; the input still goes through Mednafen's movie reader, its multitap
and its gamepad device.

Two things about the movie format, both measured:

- A movie is a Mednafen save state (the same bytes a `.mca` holds, gunzipped)
  followed by, per input record, a `$00` command byte and the 10 bytes of the
  five ports' data (2 bytes each; port 1 is multitap controller 1).
- Mednafen processes **two** input records per video frame (the frontend calls
  the movie reader at the mid-frame sync and again at the end), so a scripted
  pad value must be written twice to be in effect for one frame. This is also
  what a recorded movie contains.

### Not proven

- Mednafen is the witness, not a console. No Turbo Tap hardware was used.
- A 6-button pad is **not** implemented and is not in the protocol above:
  there is no source for it in the archive (`docs/MANUALS.md` GAP 10, a SPEC
  change for Dennis).
- The pad's `CD` and `country` bits (D7/D6) are read but not surfaced; the
  toy's `pad[n]` is the eight buttons only.
- The browser host runs the timer at 60 Hz and the console at the video rate,
  so a toy that counts interrupts for a fixed number of frames drifts by
  ~0.4 % between the two. The count is the hardware's on each side.
- The test for all of this is owned by `@test` (RULES.md rule 2): this seat
  wrote the code and the evidence, so a cold break is owed.
