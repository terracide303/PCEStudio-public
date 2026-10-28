#!/usr/bin/env python3
"""genpsg.py — generate the #34 PSG test ROMs and their register-write traces.

Each ROM is a HuCard image that initialises nothing but the CPU flags (the
PSG starts at Mednafen's power-on values), writes a short, fully
deterministic sequence of PSG registers ($0800-$0809), and loops.  The ROM
never touches the VDC/VCE/timer/IRQ hardware, so once the writes are done
the only thing that happens is the PSG clocking its channels — the recorded
WAV is a pure PSG witness.  The write sequences are straight-line
LDA #imm / STA abs pairs (7 cycles each, the write lands at the
instruction's end) separated by exact idle loops (LDX/DEX/BNE, 6 cycles per
iteration), so every register write's CPU cycle is known by construction.

The generator also simulates the instruction stream the ROM runs under
Mednafen 1.32.1's pce_fast core — the HuC6280 CycTable and the per-scanline
CPU timeslice schedule of huc6280.cpp/vdc.cpp — and writes the result as
the trace: the register writes at their (frame, cycle) positions plus the
per-frame durations.  The schedule, for a ROM that leaves the VDC/VCE alone
(HSR/HDR/VSR/VDR/VCR = 0x00FF after reset, so HDS=0, HDW=127, HDE=0 and
VBlankFL = 261; VCE CR = 0, no interlace):

  * three timeslices per line — Run(line_leadin1=18), Run(2), Run(435) —
    455 cycles of budget per line (BigDrawThingy, vdc.cpp);
  * 261 lines in the first frame, 262 afterwards (the frame loop exits
    when frame_counter hits VBlankFL = 261, and frame_counter carries over);
  * a slice whose budget the previous slice's overshoot already consumed
    is skipped (HuC6280_Run returns when timestamp >= next_user_event), so
    only the frame's final slice overshoot survives; it is (p0 - budget)
    mod 4 for the 4-cycle `bra *` idle loop, p0 = the loop's first
    instruction cycle;
  * previous_next_user_event is only rebased at frame end (HuC6280_ResetTS
    subtracts the timestamp), so frame k's final budget is
    455*lines - o_{k-1} and the overshoot o_k cycles with period 4.

renderer/pce-psg.js replays the trace through the PSG model;
tests/check-psg.js compares its PCM against Mednafen's recorded WAV sample
for sample, and derives the recorded frame count from the WAV length.

The tests:
  psg1  ch1 tone: F=254 (A4 440 Hz), square wave, full volume
  psg2  six tones at once, the manual's scale table (PB-12): A4/C5/E5/G5/
        A5/C6 (F = 254/214/170/143/127/107), six different waves
  psg3  balance: ch1 tone both sides, then left-only, then right-only (R5)
  psg4  volume: global balance 0xFF/0x88/0x00 (R1) and AL 0x1F/0x10/0x00
        (R4) — 0 dB, -22.6 dB and silence segments
  psg5  noise: ch5 NF=0x0F and ch6 NF=0x03, both enabled (R7)
  psg6  LFO: ch1's frequency wobbled by ch2's saw wave, LFCTL=1 (16-step
        deviation), LFO frequency 255 -> fLFO = 1.727 Hz, the tone sweeps
        ~414..470 Hz
  psg6b LFO: the same with LFCTL=2 (4x deviation), the tone sweeps
        ~352..589 Hz
  psg7  DDA: ch1 in DDA mode stepped 0,2,...,30 (16 held levels)

Generated assembly lands in tools/gen/psgN.asm (build with PCEAS, see
docs/BUILD.md); the trace in tools/gen/psgN.trace.json.  This script is
tooling for #34's evidence, not part of the renderer.
"""

import json
import math
import os

CLOCK = 7159090          # PCE_MASTER_CLOCK / 3 (pce_fast)
SAMPLE_RATE = 44100

SLICES = (18, 2, 435)    # line_leadin1=18, the 2-cycle slice, the remainder
LINES_FIRST = 261        # VBlankFL = 261, frame_counter starts at 0
LINES = 262

PREFIX = [               # sei/csh/cld: no interrupts, fast clock, binary mode
    (2, None),
    (3, None),
    (2, None),
]

D = 240000               # ~33.5 ms between segments (a multiple of 6)
D3 = 72000               # ~10 ms between psg3/psg4 phases: the volume
                         # machine's apply latency (~1.2 ms) and the bass
                         # decay (~0.3 ms tau) must settle before the phase's
                         # tail is measured; 100 ms phases would overflow the
                         # 8 KB ROM bank in psg4 (six delays) and 10 ms is
                         # enough
D2 = 12000               # ~10 ms per DDA staircase level


def psg(reg, value):
    """LDA #value; STA $0800+reg — 7 cycles, the write at the end."""
    return (7, (reg, value))


def wave(values):
    return [psg(6, v) for v in values]


def delay(cycles):
    """Idle for exactly `cycles` cycles: X-loops of 256 iterations (1536
    cycles each) plus a tail loop; cycles must be a multiple of 6."""
    assert cycles % 6 == 0
    m = cycles // 1536
    r = (cycles % 1536) // 6
    # each 1536-cycle block becomes its own ldx #$00 loop in the asm, so any
    # number of blocks is fine
    return [(1536, None)] * m + ([(6 * r, None)] if r else [])


SQUARE = [0x1F] * 16 + [0x00] * 16
SAW = list(range(32))
TRIANGLE = list(range(0, 17)) + list(range(15, 0, -1))
PULSE = [0x1F] * 4 + [0x00] * 28
INVSAW = list(range(31, -1, -1))
SINE = [int(round(15.5 + 15.5 * math.sin(2 * math.pi * i / 32)))
        for i in range(32)]


def ch1_tone():
    """ch1: F=254 (A4), off, frequency, wave, balance, global, on at 0x9F"""
    return ([psg(0, 0), psg(4, 0x00), psg(2, 0xFE), psg(3, 0x00)]
            + wave(SQUARE) + [psg(5, 0xFF), psg(1, 0xFF), psg(4, 0x9F)])


def six_tones():
    """the psg2 sequence: six channels, the manual's scale table (PB-12)"""
    chans = [(254, SQUARE), (214, SAW), (170, TRIANGLE),
             (143, PULSE), (127, INVSAW), (107, SINE)]
    ops = []
    for c, (f, w) in enumerate(chans):
        ops += ([psg(0, c), psg(4, 0x00), psg(2, f & 0xFF), psg(3, 0)]
                + wave(w) + [psg(5, 0xFF)])
    ops += [psg(1, 0xFF)]
    for c in range(6):
        ops += [psg(0, c), psg(4, 0x9F)]
    return ops


TESTS = {
    "psg1": {
        "what": "ch1 tone: F=254 (A4 440 Hz), square wave, full volume",
        "ops": ch1_tone(),
    },
    "psg2": {
        "what": "six tones at once, the manual's scale table (PB-12): "
                "A4/C5/E5/G5/A5/C6 (F=254/214/170/143/127/107), six "
                "different waves",
        "ops": six_tones(),
    },
    "psg3": {
        "what": "balance: ch1 tone both sides, then left-only (R5=0xF0), "
                "then right-only (R5=0x0F) — each phase held ~10 ms so the "
                "volume machine's apply latency and the bass decay settle",
        "ops": (ch1_tone() + delay(D3) + [psg(5, 0xF0)] + delay(D3)
                + [psg(5, 0x0F)]),
    },
    "psg4": {
        "what": "volume: global balance 0xFF/0x88/0x00 (R1) and AL "
                "0x1F/0x10/0x00 (R4) — 0 dB, -22.6 dB and silence segments",
        "ops": (ch1_tone() + delay(D3)
                + [psg(1, 0x88)] + delay(D3)
                + [psg(1, 0x00)] + delay(D3)
                + [psg(1, 0xFF)] + delay(D3)
                + [psg(4, 0x90)] + delay(D3)
                + [psg(4, 0x80)]),
    },
    "psg5": {
        "what": "noise: ch5 NF=0x0F and ch6 NF=0x03, both enabled (R7)",
        "ops": ([psg(0, 4), psg(4, 0x00), psg(7, 0x8F), psg(5, 0xFF),
                 psg(4, 0x9F)]
                + [psg(0, 5), psg(4, 0x00), psg(7, 0x83), psg(5, 0xFF),
                   psg(4, 0x9F)]
                + [psg(1, 0xFF)]),
    },
    "psg6": {
        "what": "LFO: ch1's frequency wobbled by ch2's saw wave, LFCTL=1 "
                "(16-step deviation), LFO frequency 255 (R8) -> "
                "fLFO = 7159090/(64*254*255) = 1.727 Hz, the tone sweeps "
                "~414..470 Hz; ch2 plays silent (AL=0)",
        "ops": (ch1_tone()
                + [psg(0, 1), psg(4, 0x00), psg(2, 0xFE), psg(3, 0x00)]
                + wave(SAW) + [psg(5, 0xFF), psg(4, 0x80)]
                + [psg(1, 0xFF), psg(8, 0xFF), psg(9, 0x81)]
                + delay(D) + [psg(9, 0x01)]),
    },
    "psg6b": {
        "what": "LFO: the psg6 setup with LFCTL=2 (4x deviation), the tone "
                "sweeps ~352..589 Hz",
        "ops": (ch1_tone()
                + [psg(0, 1), psg(4, 0x00), psg(2, 0xFE), psg(3, 0x00)]
                + wave(SAW) + [psg(5, 0xFF), psg(4, 0x80)]
                + [psg(1, 0xFF), psg(8, 0xFF), psg(9, 0x82)]
                + delay(D) + [psg(9, 0x02)]),
    },
    "psg7": {
        "what": "DDA: ch1 in DDA mode (R4=0xDF) stepped 0,2,...,30 "
                "(16 held levels, R6), full balance (R5/R1)",
        "ops": ([psg(0, 0), psg(4, 0x40), psg(4, 0xDF), psg(5, 0xFF),
                 psg(1, 0xFF)]
                + sum(([psg(6, level)] + delay(D2)
                       for level in range(0, 32, 2)), [])),
    },
}


def simulate(ops, min_steady=3):
    """Run the instruction stream under the timeslice schedule above.
    Returns (events, T): events = [(frame, t, reg, value)] with t the
    in-frame instruction-end cycle, T = the duration of every frame
    simulated.  Runs until at least min_steady frames have passed since
    the last register write (the stream is then the pure idle loop, so T
    is periodic)."""
    stream = ops + [(4, None)]           # the idle `bra *` loop, 4 cycles
    events = []
    T = []
    t = 0
    prev = 0                             # previous_next_user_event
    k = 0
    pos = 0
    while True:
        if len(T) >= 10 and (events[-1][0] if events else -1) + min_steady \
                < len(T):
            break
        lines = LINES_FIRST if k == 0 else LINES
        for _line in range(lines):
            for c in SLICES:
                b = prev + c
                prev = b
                if t >= b:
                    continue              # slice already consumed by overshoot
                while t < b:
                    cyc, action = stream[pos]
                    pos += 1
                    if pos == len(stream):
                        pos = len(stream) - 1      # the loop repeats
                    t += cyc
                    if action is not None:
                        events.append((k, t, action[0], action[1]))
        T.append(t)
        prev -= t                         # HuC6280_ResetTS
        t = 0
        k += 1
    return events, T


def emit_asm(name, ops):
    lines = []
    lines.append(";;")
    lines.append(f";; {name}.asm — generated by genpsg.py, do not edit.")
    lines.append(f";; {TESTS[name]['what']}")
    lines.append(";; Build: pceas -raw -o psgN.pce psgN.asm (docs/BUILD.md)")
    lines.append(";;")
    lines.append("        .code")
    lines.append("        .bank 0")
    lines.append("        .org $fff6")
    lines.append("        .dw irq2")
    lines.append("        .dw irq1")
    lines.append("        .dw timer")
    lines.append("        .dw nmi")
    lines.append("        .dw reset")
    lines.append("")
    lines.append("        .code")
    lines.append("        .bank 0")
    lines.append("        .org $e000")
    lines.append("")
    lines.append("reset:")
    lines.append("        sei")
    lines.append("        csh")
    lines.append("        cld")
    delay_i = 0
    for cyc, action in ops + [(4, None)]:
        if action is not None:
            reg, value = action
            lines.append(f"        lda #${value:02x}")
            lines.append(f"        sta ${0x0800 + reg:04x}")
        elif cyc == 4:
            lines.append("loop:")
            lines.append("        bra loop")
        elif cyc == 1536:
            lab = f"delay{delay_i}"
            delay_i += 1
            lines.append(f"        ldx #$00")
            lines.append(f"{lab}:")
            lines.append("        dex")
            lines.append(f"        bne {lab}")
        elif cyc % 6 == 0:
            lab = f"delay{delay_i}"
            delay_i += 1
            lines.append(f"        ldx #${cyc // 6:02x}")
            lines.append(f"{lab}:")
            lines.append("        dex")
            lines.append(f"        bne {lab}")
        else:
            raise AssertionError(f"unexpected cycle block {cyc}")
    lines.append("")
    lines.append("irq2:")
    lines.append("irq1:")
    lines.append("timer:")
    lines.append("nmi:")
    lines.append("        rti")
    lines.append("")
    with open(os.path.join(GEN, f"{name}.asm"), "w") as f:
        f.write("\n".join(lines))


GEN = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gen")


def main():
    os.makedirs(GEN, exist_ok=True)
    for name in TESTS:
        events, T = simulate(PREFIX + TESTS[name]["ops"])
        t0 = T[0]
        # every frame's duration is part of the trace: frames 1..k_last
        # (the last register write's frame) still run register writes and
        # delay loops, so their durations differ from the steady tail
        # (frames after k_last, when the stream is the pure idle loop and
        # T is periodic, period <= 4)
        k_last = events[-1][0] if events else 0
        extra = T[1:k_last + 1]
        steady = T[k_last + 1:]
        pattern = None
        for p in range(1, 5):
            if all(steady[i] == steady[i % p] for i in range(len(steady))):
                pattern = steady[:p]
                break
        assert pattern is not None, name
        trace = {
            "name": name,
            "what": TESTS[name]["what"],
            "clock": CLOCK,
            "sample_rate": SAMPLE_RATE,
            "events": [{"f": f, "t": t, "reg": reg, "value": value}
                       for (f, t, reg, value) in events],
            "frames": {"t0": t0, "extra": extra, "pattern": pattern},
        }
        with open(os.path.join(GEN, f"{name}.trace.json"), "w") as f:
            json.dump(trace, f, indent=1)
            f.write("\n")
        emit_asm(name, TESTS[name]["ops"])
        print(f"{name}: {len(events)} writes, frame0 {t0}, "
              f"extra {extra}, "
              f"pattern {pattern} (t0 extras {t0 - LINES_FIRST * 455}, "
              f"pattern extras {[p - LINES * 455 for p in pattern]})")


if __name__ == "__main__":
    main()
