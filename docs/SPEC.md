# PCEStudio — what it is

**An AI dev studio for the PC Engine / TurboGrafx-16.** You make pictures, effects, sound and small games in the
browser, strictly by the real hardware's rules, alone or with an AI agent, and export a HuCard image that runs on a
real PC Engine or TurboGrafx (Dennis, 2026-10-27).

The idea comes from **ppu.toys** (a studio of this kind for the SNES: a live model of its picture chip, small "toys"
written in Lua, a compiler that turns them into a real cartridge with a frame-budget validator, and an MCP link so
Claude Code can build with you). **Nothing of ppu.toys is used** — no code, no text, no design: only the idea. And
PCEStudio is not a SNES studio with the names changed: it is built around what the PC Engine is, and leaves out what
it does not have.

## The PC Engine, not the SNES

| the SNES has | the PC Engine has instead | what PCEStudio does with it |
|---|---|---|
| 4 background layers, modes 0–7 | **one** background layer (HuC6270 VDC): 8×8 tiles, 4 bits, 16 palettes, no flipping | one BG, and the PCE's ways round it (below) |
| Mode 7 (rotate, scale) | none | the PCE's road/floor trick: a scroll value per line (pseudo-3D) |
| colour math, windows, mosaic | none | not offered — and the editor explains why |
| HDMA (a table per line) | **the line interrupt (RCR)**: code runs at a chosen line and changes scroll, palette or settings | the raster table: per line a scroll, a palette write, BG/sprites on or off |
| 128 sprites, 32 per line | **64 sprites**, 16×16 to 32×64, **16 per line** (and 256 px), flips | sprites with live per-line budget, and flicker multiplexing to go past it |
| 256 colours of 32 768 | **512 colours of 512** (3 bits each of G, R, B), 16 BG + 16 sprite palettes of 16 (HuC6260 VCE) | a 9-bit colour picker; colour 0 rules shown |
| 256 or 512 px wide | **dot clocks of 5.37, 7.16 and 10.74 MHz**: 256, 336 or 512 px | a width switch, with what each costs |
| 64 KB VRAM, DMA | **64 KB VRAM**, VRAM→VRAM DMA, **sprite table (SATB) DMA every frame** | a VRAM map that fills up as you use it |
| S-DSP, BRR samples | **PSG: 6 channels of 32-step, 5-bit wavetables**, noise on 5–6, LFO, **DDA** (direct samples) | a PSG with wave drawing and DDA samples |
| SRAM | **backup RAM (2 KB, Tennokoe / CD)** | a save slot of the real size |
| 2 pads | **5 pads with a multitap**; 2- or 6-button pads | `pad[1..5]` |

## PC Engine tricks, built in (each with an example toy)

1. **Line-scroll parallax**: one BG, many speeds — a different horizontal scroll per band of lines (the shooter look).
2. **Palette per line**: colour gradients and skies by writing the VCE between lines (with its timing rule: writes
   during active display leave dots, so the raster table places them in the horizontal blank).
3. **Sprites as a second layer**: a parallax layer made of sprites, with the 64 / 16-per-line budget shown live.
4. **Flicker multiplexing**: more than 16 sprites on a line by rotating the sprite order every frame.
5. **Road and floor**: per-line scroll and palette for a pseudo-3D road.
6. **Palette cycling**: water, fire, waterfalls without new tiles.
7. **Big virtual screens**: BAT sizes from 32×32 to 128×64 tiles with wrapping scroll.
8. **Wide modes**: 336 and 512 px, and what they cost in sprites and time.
9. **Interrupt-driven splits**: a status bar that does not scroll (RCR at the split line).
10. **PSG tricks**: LFO on channel 1, noise drums, DDA samples for voices and drums.

## The parts

1. **The model** — **our own** VDC, VCE and PSG in the browser (not an emulator's code: see DECISIONS.md), exact enough that a picture matches Mednafen pixel for pixel
   and a sound matches by ear. With the PCE's own panels: VDC registers (all 20, per line), VCE palettes, VRAM map,
   SATB, PSG channels, "follow a pixel" (which tile, palette, sprite and register made it).
2. **The editors** — tiles, palettes, BAT, sprites, raster table, PSG waves; image import that fits a picture into
   16 palettes of 16 with dithering, and tells you what it had to give up.
3. **Toys as code** — small programs (a Lua subset): `init()`, `frame(t, f)`, `raster(line)` for the line interrupt,
   `pad[1..5]`, `bram` for saves. They run live in the browser.
4. **The compiler and the validator** — the same toy compiled to HuC6280 code (assembled with PCEAS), checked before
   it is allowed out: frame time at 60 Hz on the 7.16 MHz CPU, sprites per line, VRAM and ROM fit, VCE writes in
   the blank, value ranges. Export: `.pce` (PC Engine) and a bit-reversed image for a TurboGrafx.
5. **The AI link** — an MCP server so Claude Code (or another agent) can work in the studio with you: read and set
   registers, render a frame, run the validator, export a ROM.
6. **Share** — publish a toy, play other people's (later).

## How we know it works

A picture, an effect, a sound and a small game made in the studio run on a **real PC Engine and a real TurboGrafx**
(flash cart), and look and sound as they did in the browser. Mednafen and Dennis's Tang Nano (PCEHeroTN) are the
checks along the way. The hardware facts come from the Hudson manuals in PCEHeroTN's `docs/datasheets/` (read
there, never copied here).
