# toys/demo-game — STARFALL

A small game made only with what the studio offers: the code editor, the
SCREEN / SPRITES / PALETTES panels, the toy runtime, its pads and its raster
table.  Six drones fall through a scrolling starfield; the D-pad flies the
ship, N fires, a hit scores, a drone that reaches the ship costs a life.  The
top 24 lines are a status bar — the RCR line interrupts hold them still and a
shade darker while the playfield below scrolls.

This folder is the answer to "can the studio make a game in the browser yet?"
It can.  It also records, below, every place where it fell short and what the
workaround cost, because those are the cards the next seats should pick up.

## Open it and play it

1.  `renderer/studio.html` → **Open… → From file…** → this folder's
    `demo-game.pce.json` (the studio's `pce.studio/1` envelope: `main.lua`
    and the three asset files in one save).
2.  **Run**.  Keys: **IJKL** is the D-pad, **N** fires, **M** is the second
    button (unused).
3.  The transport's **Lua / IL** switch runs the same file through the IL
    interpreter the console back end takes.  It renders the same 600 frames —
    see the evidence below.

## The files

| file | what it is |
|---|---|
| `main.lua` | the game.  A generated art block at the top, the hand-written game below it |
| `tiles.json` | the SCREEN panel's picture: 5 tiles, a 32×32 BAT |
| `sprites.json` | the SPRITES panel's picture: 14 patterns, 17 SAT slots |
| `palettes.json` | the PALETTES panel's picture: 16 background rows, 16 sprite rows |
| `demo-game.pce.json` | the studio envelope that opens all four |

## How the art gets in

The panels edit `tiles.json`, `sprites.json` and `palettes.json` — and a toy
cannot read them (no importer: card **#117**).  So the picture is bridged:
`tools/demo-game-assets.js` builds it through `renderer/pce-editor.js`'s own
public API — the calls a panel click makes, not a second model — writes the
three asset files, and rewrites the block in `main.lua` between the two
`PCEStudio demo art` markers with the same picture as `vram[]` / `pal()`
writes the toy makes for itself.

```sh
node tools/demo-game-assets.js           # after a panel edit, or any edit to main.lua
node tools/demo-game-assets.js --check   # 0 if the toy still boots the panels' picture
```

Run it after an edit to the game too, not only to a panel: the studio envelope
embeds `main.lua` whole, so Save and Open stay one source — and `--check` calls
the envelope stale until the tool refreshes it.

A real importer would let the person stop running a Node tool outside the
browser; that is #117.

## The console export

The toy was reworked in place on 2026-11-03 so the studio's Export builds a
cartridge; it used to stop on `ilbc-range: more than 127 constants`.  The
rework is in how the same picture is produced, not in the game:

- **The art block computes its addresses.**  225 literal `vram[…]` addresses
  became a running cell address, the background palette is one `for` loop,
  the background map is a fill plus 33 stars packed two to a word, and the
  sprite patterns are written plane by plane.  The words are the panels',
  unchanged; `tools/demo-game-assets.js --check` still compares the block.
- **The palettes are `rgb()` calls.**  The 18 nine-bit VCE words became
  three-bit channel numbers the two cartridge routes already carry.
- **The sprites are `sat()` words.**  The C route cannot pin a `sprite(i,
  spec)` whose fields change at run time (the drones, the bullets, the HUD),
  so each slot is the four SAT words `sprite()` itself writes — the same
  bytes, from the same numbers.
- **The split is the `raster(line)` callback.**  `raster(line, spec)` (the
  table form) is refused by both cartridge routes; the callback form is what
  both carry.  Line 0 holds BYR 0 and the bar's backdrop, line 24 releases
  the frame's scroll and the field's.
- **The ship's collision is arithmetic.**  `sr()` (the VDC's CC flag) and
  `abs()` are carried by neither route.  The ship now uses the same box the
  bullets use against the drone array.  A 600-frame still run loses its one
  life at the same frame (365) as the old toy.

The bytecode is **6,285 B of the 8,160 B data bank** (77.0%), with **111 of
127 constants** (87.4%) — the one row past 80% and the only "near" row.  (The
80% constant aspiration is not reachable without changing the picture: the
37 distinct sprite plane words and the 17 packed star words are the art.)
Every other interpreter capacity is comfortable: 17 functions, 21 registers,
10 upvalues, 35 boot upvalue cells, 24 globals, 16 boot closures, 8 table
slots, 63 table cells, 4 arguments; `rom_check` has no finding.  The export
is a 40,960 B ROM, sha256 `e60712232fe3c7a7…`.

**The console picture is not the browser's yet.**  The ROM runs and draws, but
`tools/ilvm/ilvm_runtime.c` arms the RCR chain for **one display frame per toy
frame** (#227), and an interpreted STARFALL frame is about 25 display frames.
A 12-frame capture tail therefore lands in the compute window almost every
time, when the screen carries the last palette and no split.  A 48-frame tail
carries two armed display frames; the closer of them is one toy frame out of
step (its background scroll is the next frame's, its sprites the previous
one's — the SAT DMA is a VBlank behind the armed chain) and misses a browser
frame by ~450 bytes, all on background-star rows.
`tests/check-export-games.js` pins the ROM sha and asserts the screen is not
black and not yet a browser frame, the same shape as DUSK RUN's pin.  The fix
is the raster backend's (#227), not this toy's; the browser game is unchanged.

The original `main.lua` and README are kept outside the repository at
`/Volumes/External/pcestudio-toys/originals/starfall/`; git history also
carries them.

## Where the studio fell short

Every one of these was hit while building this game.  Each is a card.

| what the studio did not do | the workaround here | card |
|---|---|---|
| The panels' tiles/palettes/sprites never reach a running toy: there is no importer, so a drawn picture cannot be played | the Lua art block is generated by `tools/demo-game-assets.js`, a Node tool run outside the browser | #117 |
| The IL refused to read a table index (`il-table-read`), so a toy could not keep an array of entities | **fixed by #118**: four bullets and six drones are `bl/bx/by` and `ex/ey/es` int arrays, every operation one loop; the ten digit patterns are `18 + d`, not a VRAM read | #118 (closed) |
| A toy could not read the VDC's status flags (CC sprite-0 collision, OR overflow), so the hardware's own collision test was out of reach | **fixed by #119** for the browser, but `sr()` is carried by neither cartridge route, so the export rework replaced it with the drone array's box (#273) | #119 (closed); #273 |
| The toy host powers on with `CR = $80` (background only), so a toy's sprites are invisible until the toy writes `reg("CR", 0xC0)` | one `reg()` call in `init()`, with a comment, because the failure mode is a blank screen | #120 (closed by documenting it) |
| `sfx()` with no `music()` is master-muted: the PSG's R1 is never set | the game still fires its SFX; the browser's sound is silent, and `check-demo-game` prints a NOTE | #113 |
| `raster(line, spec)` (the table form) is refused by the bytecode route and the C route | the callback form `raster(line)` both routes carry (#273); on the console its picture is the #227 limitation above | #136, #227 |
| `abs()` and `sr()` have no bytecode or C form | folded distance and array arithmetic (#273) | #137 |

## The evidence

```sh
node tests/check-demo-game.js
node tests/check-export-games.js
```

`check-demo-game` plays the game headlessly for **600 frames** with a scripted
pad (right, left, up, down, a burst of fire every twelve frames), and asserts:

- **the art is the panels' picture** — `tools/demo-game-assets.js --check`
  exits 0, and the asset files are the ones it writes;
- **the validator's budgets** — frame() 9,730 cycles (0.08× a video frame),
  the raster callback's fixed cost priced separately at 224 lines; 2,011 VRAM
  words of 32,768, ROM estimate ~27,300 B of 1 MB, no sprite line over a
  budget (6 strips on the busiest);
- **Lua == IL**, every frame: vram, cram, sat, registers, the raster table and
  the rendered pixels are byte-equal in both runtimes (**0** differences);
- **it plays** — the pad flies the ship (±2 px a frame, clamped), N fires at
  most one shot in eight frames across four slots, a bullet climbs 4 px a
  frame, the score rises monotonically to 6 and never falls, a parked ship
  loses exactly one life (frame 365 of a still run) and not two;
- **the raster split** — every frame's table holds line 0 at BYR 0 with the
  bar's backdrop and line 24 at the frame's own scroll with the field's;
- **the pictures** — the seven key frames and the 2x4 grid they are tiled into
  (`strip.png`) under `tests/dumps/demo-game/` are read back pixel for pixel.

The rework's own evidence, beyond that suite:

- **Same game, frame for frame.**  A separate script runs the original
  (`/Volumes/External/pcestudio-toys/originals/starfall/main.lua`) and this
  file side by side in the browser runtime, over the 600-frame scripted run
  and the 600-frame still run: every frame's pixels and VRAM/SAT are
  identical, and the still run loses its one life at frame 365 in both.
- **Same ROM cost.**  `rom_check` answers `ok:true` with no finding; the
  budget numbers above are it.  `tests/check-rom-budget.js` pins every row
  and `tests/check-tables.js` the table inventory (8 sites, 63 cells).
- **It exports.**  `tests/check-export-games.js` builds the 40,960 B ROM
  (sha256 `e60712232fe3c7a7…`), measures it in Mednafen (29 updates in 600
  frames, too slow — the interpreter) and pins the picture as **not black
  and not yet the browser's**, with the reason.

## What is not proven

- **The console picture is not the browser's yet** — the raster backend's
  one-armed-display-frame latency (#227).  The ROM draws the game; a capture
  tail is usually the compute window's stale screen, and the rare armed frame
  is one toy frame out of step.  This is the same open card as DUSK RUN's.
- The game is **silent in the browser** until #113 lands (see above).  The
  test prints the PCM's RMS and names the card; it does not fail on it.
- No real browser ran it here: the runtimes are the same modules the page
  loads, but the page itself is `check-studio.js`'s business, not this file's.
- Rule 2: this test was written by the card's own author.  A cold break by
  another seat is owed before the card closes.
