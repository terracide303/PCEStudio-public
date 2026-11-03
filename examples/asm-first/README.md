# asm-first — the first program (card #231)

An original PCEStudio assembly example. It sets two background colours, draws
one 8x8 tile, and loops. Nothing here is copied from HuC or another example.

## What it shows

| region | colour | RGB |
|---|---|---|
| everything | colour 0 = `$007` (GGRRRBBB) | `(0, 0, 252)` |
| x 32..39, y 32..39 | colour 1 = `$1F8` | `(252, 252, 0)` |

The screen is a 32x32 tile map; every cell is the blank pattern `$40` except
cell (4,4), which is the solid pattern `$41`. The 256x240 VDC window is the
canonical one from the hardware manual (HDW = 31, VDW = 239), so a capture at
`pce.slstart 3` starts at display line 0.

## Build

```sh
node tools/build-card.js examples/asm-first out.pce
```

`tools/build-card.js` supplies `renderer/asm/pce.inc` as `pce.inc`; this
folder does not carry a copy. With the native assembler you would copy that
file beside `main.asm` first.

## Run

```sh
mednafen -force_module pce out.pce
```

The console evidence is `tools/capture-card.sh` plus `tests/check-card.js`:
the capture in `tests/dumps/asm-first/` must be the stated picture pixel for
pixel, and its recorded sha256 must be this build's.

## Read it

`main.asm` is laid out as the five steps every HuCard program takes: reset at
`$E000`, map I/O and RAM, fill VRAM and the palette, turn the display on, and
put the five vectors at `$FFF6`–`$FFFF`. `docs/ASM.md` §11 explains each one.
