# What real HuCards use: hardware budgets measured per frame

Written 2026-11-15, for the guidelines the MCP Claude works from. Method: the
maintainer's own HuCards run in Geargrafx through its MCP server
(`tools/study-budgets.py`, `docs/GEARGRAFX-MCP.md`); at eight points per game,
driven by the fixed RUN/button press pattern of `tools/study-idioms.py`, the
console's state is sampled — the sprite attribute table (SAT), the VCE
palettes, the PSG, the VDC registers, the BAT map — and one frame of VDC
register/DMA/interrupt trace is recorded at four of the points, one frame of
CPU instruction trace at two. After the last point the game plays on and the
SAT is read for 30 consecutive frames at two stretches, for the per-line
sprite limit and the flicker question. 80 point samples and 600 stretch frames
in all.

**Nothing from the games is stored in this repository**: no code, no listings,
no ROM bytes, no tiles, no music data, no screenshots. The tables below hold
counts, ranges and observations in my own words only. The per-game JSON counts
and the traces stay on External II under
`/Volumes/External II/agent-workshop-demo/support/scratch/claude-tmp/budgets/`.

Games: R-Type, Soldier Blade, Air Zonk, Blazing Lazers, Super Star Soldier,
Bonk's Adventure, Ninja Spirit, Bomberman '93, Galaga '90, Neutopia — the five
shooters of `docs/ENGINE-STUDY.md` plus five other genres. Points are labelled
by press count only ("after the Nth RUN press"), the same convention as the
earlier studies; these are samples, not averages, and "typical" below is the
median over all samples. Busy play is under-represented except in the two
30-frame stretches.

## 1. Sprites

The SAT has 64 entries. A sprite's top row is its SAT Y minus 64, its left
column X minus 32; sizes come from the attribute word's CGX/CGY bits (16/32
wide, 16/32/64 tall), decoded the way `renderer/pce-sprites.js` models the
VDC. A display line draws at most 16 sprite strips (a 32-wide sprite requests
two); later SAT entries on that line are dropped by the hardware. "Active"
means the sprite's rows intersect the display window.

| over all 100 samples | min | typical | max |
|---|---|---|---|
| active SAT entries | 0 | 23 | 64 |
| strips requested on the busiest line | 0 | 9 | 28 |
| frames of 30 hitting the 16-strip line limit | 0 | 0 | 30 |
| distinct SAT entries serving the busiest line over 30 frames | 0 | 9 | 50 |
| SAT entries changed between consecutive frames | 0 | 8 | 49 |
| parked entries (idle slots) | 0 | 41 | 64 |

Sprite size kinds, in how many of the 80 point samples each appears: 16x16 in
68, 32x16 in 57, 32x32 in 48, 16x32 in 39, 32x64 in 22, 16x64 in 9. Sixteen
pixels wide is the workhorse; 32-wide is common; 64-tall sprites appear in
shooter set pieces (R-Type, Air Zonk, Super Star Soldier, Bomberman '93).

What the numbers say:

- Galaga '90 runs all 64 entries at once (its alien formation), R-Type's busy
  stretches reach 64; most play sits at 5–45 active entries, and Bomberman
  '93's arenas at 53–57.
- Most games never approach the line limit: Soldier Blade tops out at 14
  strips, Blazing Lazers 11, Ninja Spirit 8, Bonk 7, Neutopia 12. Super Star
  Soldier sits at 15–16 on its busiest line, one frame in thirty over.
- Games that exceed it do one of two things, both measured. **Static
  overflow:** Air Zonk and Bomberman '93 request 17 strips on one line in
  every one of 30 consecutive frames — the same last strip is dropped every
  frame (the SAT does not move: 0.3–0.6 entries change between frames) and the
  game ships that. **Round-robin multiplexing (flicker):** R-Type and Galaga
  '90 exceed the budget in 5–30 of 30 frames, rotate 32–50 distinct SAT
  entries through the one busiest line while only 16 draw, and rewrite 30–49
  entries between consecutive frames — the classic PC Engine flicker, used
  deliberately. R-Type also requests 28 strips on one line in an early sample
  (16 draw).
- Parked sprites are the standard trick: games keep idle entries above the top
  of the screen (SAT Y up to about 48) or below it (Y ≥ $1C0).

## 2. Background

| over all samples | min | typical | max |
|---|---|---|---|
| BAT geometry (MWR bits) | 32x32 | 64x64 | 64x64 |
| distinct patterns referenced by the BAT | 1 | 261 | 657 |
| VRAM words non-zero in the scene | 4,913 | 18,239 | 22,790 |
| VRAM words written per frame | 0 | 234 | 5,774 |
| VRAM write address changes (MAWR) per frame | 0 | 2 | 28 |
| raster-compare (RCR) writes per frame | 0 | 0 | 12 |
| distinct scroll value pairs replayed per frame | 0 | 1 | 12 |
| distinct BXR / BYR values per frame | 0 / 0 | 1 / 1 | 2 / 12 |
| SATB DMA events per frame | 0 | 1 | 2 |
| display on/off (CR) writes per frame | 0 | 0 | 4 |

All four BAT shapes appear: 32x32 (Bomberman '93's arenas), 32x64 (Super Star
Soldier, Galaga '90), 64x32 (R-Type, Soldier Blade, Blazing Lazers) and 64x64
(Air Zonk, Bonk's Adventure, Ninja Spirit, Neutopia). No game used 128-wide
BATs; R-Type alone puts its BAT at $1000 (MWR bit 0), everyone else at $0000.

What the numbers say:

- A scene is one BAT (2,048–4,096 words) plus 5,000–23,000 VRAM words of
  everything else — sprite patterns and tiles. An ordinary frame writes 0–256
  words, in a few short runs (2 MAWR changes typical). A scene load writes
  thousands in one frame: Ninja Spirit 5,774 in a single frame, and R-Type's
  title-to-stage load writes 30,000+ over 21 frames with the screen blanked
  (`docs/ENGINE-STUDY.md`).
- Parallax is raster splits, and few of them: 0–3 RCR writes per frame is
  normal; Air Zonk's title is the top of the range with 12 — twelve bands, one
  BXR all frame and a different BYR per band.
- One SATB DMA per frame is the VDC's own automatic SAT fetch, not game code;
  games update the SAT in VRAM (Ninja Spirit writes its SAT entries
  word-by-word at $7F00) and the hardware picks them up.

## 3. Palettes

32 palettes of 16 colours: 0–15 for the background, 16–31 for sprites.

| over all samples | min | typical | max |
|---|---|---|---|
| BG palettes (of 16) with any entry | 0 | 11 | 16 |
| sprite palettes (of 16) with any entry | 0 | 9 | 16 |
| BG colour entries in use | 0 | 108 | 255 |
| sprite colour entries in use | 0 | 90 | 236 |
| distinct colours in the whole table | 0 | 72 | 151 |
| VCE writes per frame (colour changes) | 0 | 0 | 8 |
| lines of the frame with VCE writes | 0 | 0 | 2 |

What the numbers say:

- The sprite half is the scarce one: shooters run 9–16 sprite palettes (every
  enemy colour scheme needs one) against 2–6 BG palettes; Blazing Lazers
  draws its whole game with 2 BG palettes. Title screens light up all or
  nearly all 32 (Bonk, Galaga, Super Star Soldier).
- Mid-frame colour rewrites are rare and cheap: 0–8 VCE writes per frame on
  at most two lines in the sampled games.

## 4. Sound

The PSG has 6 channels, 32 waveforms, a noise mode and DDA.

| over all samples | min | typical | max |
|---|---|---|---|
| channels enabled | 0 | 5 | 6 |
| PSG register writes per frame | 0 | 37 | 258 |
| lines of the frame with PSG writes | 0 | 3 | 133 |
| most PSG writes in one line | 0 | 15 | 24 |
| waveform numbers in use at a point | 0 | 5 | 6 |

All 32 waveforms appear somewhere in the ten games; noise appears in 15 of the
80 samples and DDA in 30 (Bonk, Air Zonk, Soldier Blade, Super Star Soldier).

What the numbers say — two driver shapes, both measured:

- **The register driver** (R-Type 32 writes/frame, Blazing Lazers 30–34,
  Super Star Soldier 37, Bomberman '93 35–37, Bonk 6–195, Galaga 6, Neutopia
  64): all writes land in 2–3 lines of the frame, one burst per frame. That is
  the cheap shape.
- **The sample player** (Soldier Blade and Air Zonk, 254–258 writes/frame
  spread over 119–133 lines, 5–24 writes per line): a timer interrupt fires
  about 119 times a frame and each firing rewrites channels. This is the
  expensive shape — about a third of the frame, measured in
  `docs/ENGINE-STUDY.md` — and it is what the 2,000+ bank mappings per frame
  belong to.

## 5. CPU and banking

One whole frame of instruction trace at two points per game; the same method
and idle detector as `docs/ENGINE-STUDY.md`. One of the twenty captures caught
a partial frame (Galaga '90, 5,735 instructions, 91,413 cycles — the trace
window's edge, not the game) and is left out of this table.

| over 19 full frames | min | typical | max |
|---|---|---|---|
| instructions in the sampled frame | 22,396 | 29,661 | 35,647 |
| CPU cycles in the frame | 119,201 | 119,659 | 119,664 |
| time idle in the wait loop | 32% | 73% | 95% |
| interrupts handled (RTI) | 1 | 2 | 151 |
| subroutine calls (JSR) | 15 | 235 | 309 |
| bank-mapping instructions (TAM/TMA) | 12 | 39 | 2,230 |
| ST1/ST2 VDC data stores | 0 | 0 | 288 |

The spread is two populations, as the earlier study found: plain games map
12–66 banks a frame (Bonk's music driver up to 713) and idle 33–95% of the
frame; the two sample-player games (Soldier Blade, Air Zonk) map 2,077–2,230
times and idle 33–61%. A frame is 119,660 CPU cycles; a game's actual work is
15–67% of it, interrupts included.

## 6. ROM size

| game | bytes | 8 KiB banks |
|---|---|---|
| Galaga '90 | 262,144 | 32 |
| Blazing Lazers | 393,216 | 48 |
| Bonk's Adventure | 393,216 | 48 |
| Neutopia | 393,728 | 48 |
| R-Type | 524,288 | 64 |
| Soldier Blade | 524,288 | 64 |
| Air Zonk | 524,288 | 64 |
| Super Star Soldier | 524,288 | 64 |
| Ninja Spirit | 524,288 | 64 |
| Bomberman '93 | 524,288 | 64 |

## What these numbers mean for a game written in Lua for our compiler

1. **The SAT budget is 64 entries, and that is enough.** Shipped games run
   everything from a 1-sprite title to Galaga's full 64. A Lua game gets the
   same 64 entries; the guidelines should state that cap and the parking
   convention (idle entries above the top of the screen or below it), which
   costs nothing per frame.
2. **The 16-strip line budget is the one that bites, and there are three
   shipped ways to live with it.** Most games just stay under it (the
   measured top for half the corpus is 8–14 strips). A game that sits over it
   can accept the hardware's drop in SAT order (Air Zonk and Bomberman '93
   lose one strip a frame forever and ship that) or multiplex with flicker
   (R-Type, Galaga: 32–50 entries rotated through one line, 30–49 entries
   rewritten a frame). **The guideline for a Lua game: stay under 16 strips
   per line and no work is needed; the validator should count strips per
   line, not sprites per frame.** Flicker is a deliberate extra only
   formation- and bullet-pattern games need.
3. **Sprite sizes: 16x16 and 16x32 first, 32x16 and 32x32 second, 32x64
   rarely.** The API should make the 16-wide forms the cheap case.
4. **A scene is one BAT of 32x32 to 64x64 cells plus 5,000–23,000 VRAM words
   of everything else**, and an ordinary frame writes 0–256 of those words in
   a few short runs. Our per-word VRAM write cost (about 10 cycles inline)
   makes even 256 words a frame a minor line item; a scene load is a separate
   blanked-screen budget (`docs/ENGINE-STUDY.md`).
5. **Parallax is raster splits, 0–3 per frame, 12 at the extreme** (one
   RCR/BYR write per band, BXR shared). The handler we already have covers the
   whole measured range.
6. **The 16 sprite palettes are the scarce half** — shooters use 9–16 of them
   against 2–6 BG palettes. Mid-frame colour rewrites are 0–8 writes per
   frame: cheap enough to treat as a free effect.
7. **Music should be the register-driver shape: about 35 PSG writes per
   frame, all in one burst.** That is what R-Type, Blazing Lazers, Super Star
   Soldier, Bomberman and Bonk ship. The sample-player shape (Soldier Blade,
   Air Zonk: ~256 writes spread over ~120 lines plus a 6.7 kHz timer
   interrupt and 2,000+ bank mappings) is a third of the frame — a separate
   budget, not a free extra.
8. **The frame budget a Lua game should aim at is the one shipping games
   actually use: under 70% of 119,660 cycles**, with a VBlank wait as the
   floor. The games idle 33–95% of the frame; bank switching is 0–1.5% of a
   frame even at 2,000+ mappings. Our compiled TOWER already sits inside this
   range without sound (`docs/ORIGINAL-CODE-IDIOMS.md`).
9. **ROM size is no constraint for us** — real games are 32–64 banks and
   mostly assets; ours are far smaller.

## What is NOT verified

- Single-frame samples at eight fixed drive points per game, labelled by
  press count only — the same convention as the earlier studies. I cannot say
  which points are titles, demos, stages or bosses from the measurements
  alone; the busy stretches late in each run are the nearest thing to "a boss
  if reachable", and whether one was reached is not known.
- The per-line sprite counts come from the SAT at one instant per frame; a
  game could rewrite the SAT later in the same frame (mid-frame sprite
  multiplexing is not captured — the traces show the games' SAT DMA once per
  frame, which argues it is rare).
- Flicker is inferred from SAT rotation across frames, not from screen
  captures: "R-Type and Galaga multiplex" rests on 32–50 entries serving one
  line over 30 frames while the line stays over budget and 30–49 entries are
  rewritten between consecutive frames.
- The scroll-per-line replay assigns each BXR/BYR write to the line its
  timestamp falls on and assumes the value holds until the next write; a
  split re-armed inside the same line would be miscounted. RCR write counts
  are exact; band counts approximate.
- PSG write counts measure the driver's register traffic, not the music; the
  frequencies and waveform numbers are sampled at points in time, not tracked
  through a tune. "Music as bytes in ROM" is not readable from here, as the
  card's hard rule says.
- CPU and banking rows reuse `docs/ENGINE-STUDY.md`'s method at two of the
  eight points per game; the idle-share detector is the earlier study's (a
  loop with no stores, over 150 iterations).
- BAT pattern counts are distinct codes referenced by the map, not distinct
  tiles loaded over a scene's life; the loads themselves are
  `docs/ENGINE-STUDY.md`'s subject.
- Geargrafx is an emulator: the register-level behaviour matches the VDC
  model `renderer/pce-sprites.js` was written against, but the 16-strip drop
  and the SAT decoding were not checked on a real HuCard (they cannot be,
  here).

Tool: `python3 -I tools/study-budgets.py run ROM.pce NAME OUT.json` drives a
game and writes the counts; `python3 -I tools/study-budgets.py analyse
OUT.json` prints them per point; `--all DIR` prints the pooled min/typical/
max. OUT.json and the traces belong on External II scratch, never in the
repository.
