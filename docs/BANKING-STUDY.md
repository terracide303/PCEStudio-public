# How real HuCards bank their code — a measured survey

Written 2026-11-13. Read-only study of the maintainer's own HuCard dumps (100
unique US ROMs). Nothing from the games is in this repo: only the counts and
our reading of them. The method is a static scan of each ROM for the
HuC6280's bank-mapping instruction (TAM, opcode $53, with a one-page mask),
plus a look at the first instructions after reset. It is a heuristic: a
byte pair that looks like TAM can be data, so a count is a hint, not a proof.

## What it shows

- **Size.** Of 100 unique ROMs: 128 KB ×2, 256 KB ×35, 384 KB ×20, 512 KB ×40,
  768 KB ×2, 1 MB ×1. About two thirds are over 256 KB, so most real games are
  banked, and by dozens of banks, not by two or three.
- **Which pages games switch.** Games with five or more TAMs on the page:
  MPR2 89, MPR3 92, MPR4 89, MPR5 91, MPR6 70, MPR7 57 (MPR0 and MPR1 are I/O
  and RAM, set once at boot). Pages 2 to 5 are swapped everywhere; page 6
  often; page 7, the top page, least. So the common layout is *one small fixed
  page at the top, everything below it switched*, not a big fixed image.
- **Boot.** The three games read in detail start with the same page setup
  (I/O into MPR0, RAM into MPR1, then a fixed mapping for the rest). One of
  them then maps banks 0 and 1 into pages 7 and 6, a fixed 16 KiB image,
  exactly the SDK's own layout; the others leave page 6 to be switched.
- **A mapper.** The one known larger mapper (the 2.5 MB Street Fighter II
  cartridge's, written at $1FF0–$1FF3) is not in this set; the scan's few
  matches for a store to $1FF0 are noise. Cartridges up to 1 MB need none.

## What it means for the native route

A native game of any real size has to switch code banks; the fixed-image
trick (`ROM_KB`, docs/NATIVE.md) stops at 48 KiB. The shape to copy is the
common one: a small fixed top page (runtime, interrupt handlers, the call
glue), code in switched banks below it, pages free for data and for the sound
engine (docs/NATIVE-SOUND.md, option C). The next step is a TOWER prototype
split over banks, proved by an identical picture and a measured cost per
cross-bank call.

## Not yet done

The scan counts instructions; it does not trace a running game. How often
each game switches per frame, and how it calls across banks (a shared
trampoline or inline map-and-restore), needs a trace in an emulator. That is
the next measurement if the prototype's numbers are not enough to decide.
