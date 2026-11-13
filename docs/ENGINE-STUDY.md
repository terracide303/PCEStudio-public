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

## A scene load (R-Type, measured)

`tools/study-scene.py` traced R-Type for 1,300 frames from the title through its
start and into a stage, logging only the VDC's register writes, its DMA and the bank
mapping (Geargrafx trace filters), and summarized each video frame.

- **An ordinary frame writes about 160 VRAM words.** A scene load writes 30,000 or
  more: a first burst of 4,480 words in 2 frames (the title screen) and a second of
  32,144 words over 21 frames, which is the whole of VRAM, at 700 to 1,400 words a
  frame and 2,670 words in each of the last frames.
- **The screen is blanked while it loads.** The VDC control register is written with
  background and sprites off on every one of those frames and turned on again at the
  end. The game does not try to keep the picture running through a load.
- **It streams, it does not copy a block.** The write address is set once (for example
  to $0C00) and then long sequential runs of words follow, carrying on from frame to
  frame, with a new address only when the destination region changes. 1,400 words is
  about 40,000 cycles at 30 a word, a third of a frame; the other two thirds are the
  work of reading the data out of its banks. The last step writes the background map
  in small pieces: 8 words at each 64-word step.
- **Bank switching around the load is light:** a handful of mapping changes per frame,
  the data banks mapped into pages 4 to 6 around the copy and restored after.
- **Soldier Blade did not reach a stage** in 1,300 frames of the same script (small
  loads only, 1,261 words in two frames), so there is one game here, one scene change.

What this means for us: a scene-load call in the toy language would blank the display
(or fade out), stream the scene's banked data to VRAM at a fixed budget per frame (about
1,400 words, a third of a frame) while the rest of the frame does other work, and bring the
display back. That is what shipped games do and it needs no compression to be useful.
The cost is the blank, and a loading time of about a third of a second for all of VRAM.

## What it does not tell us yet

Whether a game keeps a central table of asset slots (the Konami prior), animates by
scheduled decompression or bakes its fades is not visible from VDC traffic alone; that
needs the reads from the banks (the instruction trace around a load, or a read watch on
the data banks). Not done. More games and a stage change inside a game (Soldier Blade,
Air Zonk) are the next samples.
