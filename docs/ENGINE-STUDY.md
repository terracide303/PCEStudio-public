# What real HuCards do in a frame — a measured study

Written 2026-11-13, for the engine design (docs/NATIVE-SOUND.md, the assembly
engine card). Method: the maintainer's own HuCards run in Geargrafx through its
MCP server (`tools/study-hucard.py`, docs/GEARGRAFX-MCP.md); at four points per
game, after the title and a few RUN presses, one whole video frame of the CPU
instruction trace is read and summarized. Nothing from the games is stored here,
only counts. Three games so far: R-Type, Soldier Blade, Air Zonk. The points are
title, demo and play screens without telling which; one frame each, so these are
samples, not averages.

## The table

| | R-Type | Soldier Blade | Air Zonk |
|---|---|---|---|
| CPU cycles in a frame (trace units ÷ 3) | 119,660 | 119,650 | 119,650 |
| time idle in the wait loop | 57–77% | 54–63% | 33–51% |
| interrupts per frame | 4 (1 on the title) | about 117 | about 140 |
| share of the frame spent inside interrupts | 8% | 33% | 32% |
| subroutine calls per frame | 180–360 | 290–340 | 260–280 |
| bank-mapping instructions per frame | 31–35 | about 2,050–2,090 | about 1,800–2,170 |
| VRAM words written per frame | 210–250 | 150–180 | 256 |
| raster splits (range compare writes) | 3 | 1 | 12 in two of four points |
| block-transfer instructions | none | none | none |
| share of cycles run from the fixed top page | 80% | 80% | 75% |

## What it says

1. **A frame is 119,660 CPU cycles**, confirming the figure our measurements use
   (455 cycles a line at 7.16 MHz). The 113.75 in the PCE_knowledge notes is the
   1.79 MHz count; Geargrafx's trace counts in master-clock units, three to a
   CPU cycle.
2. **The main loop is a spin on a frame counter** that the VBlank interrupt bumps
   (R-Type: compare a zero-page byte, branch back). The games are idle a third to
   three quarters of the time, so a real game's work, interrupts included, is 25 to
   65% of a frame. Our
   native TOWER at 70% mean and 91% worst is in that range, without sound.
3. **Bank switching is cheap and used heavily.** R-Type switches about 30 times a
   frame, in its calls; its one big interrupt (the VBlank, about 8,300 cycles) does
   its VRAM work and is the only heavy one. Soldier Blade and Air Zonk switch about
   2,100 times a frame, nearly all in one timer interrupt that fires about 111 times a
   frame (about 6.7 kHz): a sample player. Each time it saves the five switched pages
   on the stack, maps five consecutive data banks, calls a routine in the window and
   restores them, for about 360 cycles (Air Zonk: about 345). Inside interrupts these
   games spend a third of every frame. That is the shape of HuTrack's own song window.
   So bank switching per call (ours: under 2% on TOWER) is far inside what shipped
   games do, and a sample player is a budget of its own: about 30% of a frame.
4. **The top page carries the game.** Three quarters or more of all cycles run from
   the fixed page; the switched pages are mostly data and occasional routines. This
   is the layout option C copies.
5. **VRAM is written with plain stores**, 150 to 250 words a frame (the trace counts
   byte stores to the data port; a word is two), about 5 to 8 thousand cycles at the
   ~30 a word measured elsewhere, no block-transfer
   instruction in the sampled frames. The sprite list is moved by the VDC's own DMA,
   its source address set two or three times a frame.
6. **Raster use varies**: one split (Soldier Blade), three (R-Type), twelve (Air Zonk,
   parallax bands). The scroll registers and the compare value are written inside the
   interrupt, which is what our handler does.
7. **Interrupt handlers save and restore the whole window** they change (the sample
   player pushes five page registers). Our handlers use only the fixed page, so they
   never need to.

## What it does not tell us yet

The priors from the one Konami title in the notes (a central table of asset slots,
per-scene lazy loading, animation by scheduled decompression, pre-baked fades) need
load-time traces: step through a level change and watch what is read and where it
goes. The next measurement is a trace across a scene change in one of these games,
with a memory watch on the VDC data port. Not done.
