# toys/city — CITY (card #125)

A demo made from **Action Pack - CITY** by **Anokolisa**
(https://www.patreon.com/Anokolisa). A soldier runs a flooded city street at
night; up jumps, N fires, left/right walk him across the screen. The street
scrolls under him, the water cycles its colours, and the pack's own scene is
the one background — split into two BXR bands by the raster callback, because
the PC Engine has one background layer and no HDMA.

## The licence, and where the art lives

The pack's `Autor_note.txt`, quoted in full:

> all the assets here are totally free for commercial use and the like.
>
> credits are optional but appreciated.
>
> the patreon: https://www.patreon.com/Anokolisa

A public demo is fine. **Redistribution of the pack in this GPL repository is
not granted**, so neither the raw pack nor anything converted from it is
committed — Dennis, 2026-10-29: *"About the artwork don't put it on the repo
but it's fine as demo on the website in PCE Studio"* (`docs/DECISIONS.md`).

So this folder holds **the toy, not its picture**:

| in the repo | beside the repo (`demo-art/city/`) |
|---|---|
| `main.lua` — the game, with an empty `art_boot()` | `main.lua` — the same game **plus the generated art block** (the playable file) |
| `README.md` — this file | `tiles.json` — 249 tiles and the BAT |
| `tools/city-assets.js` — the converter | `palettes.json` — the VCE words |
| | `sprites.json` — 19 sprite patterns |
| | `evidence/strip.png` — the test's frame strip |

`demo-art/` sits **beside** the repository
(`/Volumes/External/agent-workshop-demo/demo-art/`). The join happens at
**deploy**, the same way as OAK WOODS (#128):

```sh
node tools/gallery.js --with-demo-art   # gallery-toys.js with the playable source
sh tools/deploy.sh                      # uploads it, and demo-art/city/
```

so the site's toy page and Browse run the picture with no fetch and no second
runtime, while the committed `renderer/gallery-toys.js` stays the art-free
copy every test checks. A clone without `demo-art/` still builds, still lists
the toy, and `tests/check-city.js` **skips** with a line saying so — so the
suite stays green.

## Build the art

The pack must be extracted into an empty folder of its own first (nothing in
it is executed; the converter reads two PNGs):

```sh
mkdir -p "$TMPDIR/city-pack"
unzip -q "Action Pack - CITY.zip" -d "$TMPDIR/city-pack"
node tools/city-assets.js --pack "$TMPDIR/city-pack/Action Pack - CITY"
```

That writes `demo-art/city/`. `--report` says what it would write and writes
nothing; `--check` exits 1 if the folder is not the converter's output.

## What the converter does

1. `Social/Test_city_1.png` is a 4x render of a **496x272** picture. The
   converter down-samples it to native pixels and refuses a picture whose 4x4
   blocks are not one colour — a filtered rescale would make the "native"
   pixels a guess.
2. A **256x224** window of it (the display's own size) becomes the background
   through the #123 importer (`renderer/pce-source.js`) — the same code the
   studio's Add Source dialog runs. Tiles are deduped, every 8x8 tile gets one
   of at most 16 palettes, and the whole picture uses **21 colours, at most 8
   in a tile** — inside the VDC's 16-colour palette.
3. Nine frames of the character sheet (`Legacy Action Pack - CHARACTER/
   Sheets/Full-Sheet.png`) become **32x64 sprite patterns**, the VDC's largest
   sprite: eight run frames and one aim frame, two patterns each (the frames
   are up to 40 px wide, so each is a left and a right half). The leap reuses
   run frame 7, so it costs no VRAM of its own.
4. The picture becomes `demo-art/city/main.lua`'s generated tail: every
   non-zero VRAM word, the BAT run-length encoded, and the VCE's own words.
5. The three **water colours** are found, and the converter refuses if one of
   them is also used above the water line — cycling such a colour would flash
   the city.

Budget: 249 tiles (5,008 VRAM words) + 19 patterns (9,280 words) =
**14,288 of 32,768 words** (the test counts the same picture from the pattern
codes, which start on a cell boundary, and gets 14,400 — either way, under
half the VDC's VRAM).

## What the toy does

| | |
|---|---|
| `raster(line)` | two BXR writes a frame, each band on its OWN 0..255 counter: line 0 the far city (sky, skyline, buildings, the ledge and the wall with its pipe) at 1 px a frame, line 208 the water strip at 2 px plus the pad |
| `pal()` every 8 frames | the water's three CRAM entries are dealt the pack's three water words; nothing else in the picture uses them |
| SAT slots 0 and 1 | the character: two 32x64 sprites with `cgx` (two strips each) and `cgy = 2` (all 64 lines) |
| slots 2..5 | the tracer, a 16x16 pattern, six pixels a frame |
| slots 6..63 | parked once in `init()`, not every frame — that loop alone cost the frame budget 2 frames over |
| `art_boot()` | the repo's is empty; the deployed file's writes the picture |

## The evidence

```sh
node tests/check-city.js
```

45 checks when the art is present, and a clean `SKIP` when it is not:

- **main.lua's numbers are the art's** — every pattern code, the tracer and the
  three water CRAM entries are rebuilt from the converted files through
  `sat.pictureFromFiles` + `ed.patternLayout`, and the toy's constants must
  equal them;
- **the validator's budgets** — `renderer/pce-validate.js` accepts the toy,
  `frame()` alone is 4,661 cycles of a 119,318-cycle 60 Hz frame, no line asks
  for more than the VDC's 16 strips (the busiest asks for 4), and the art fits
  VRAM;
- **it is visible** — every frame has at least 20,000 of its 57,344 pixels
  differing from the picture's first;
- **it plays** — the pad walks the character, the jump leaves the water line
  and lands back on it, a tracer flies six pixels a frame, and the water's
  entries change on every 8th frame and only then;
- **the raster split** — two entries (lines 0 and 208), the near band 1–3 px a
  frame and the far band at most 1, the near one always the faster, and over
  **300 frames** each band goes round its 0..255 and comes back with no jump
  in between (#148: a divided counter climbs to 85 and snaps back, which this
  check catches — its own control, `g_cam // 3`, gives 2 bad steps and 0
  wraps);
- **Lua == IL**, frame by frame for 120 frames: vram, cram, sat, registers,
  the raster table and the pixels;
- **the strip** — `demo-art/city/evidence/strip.png`, eight frames, read back
  pixel for pixel;
- **the deploy route** — `tools/gallery.js` lists CITY as a demo (`demoArt:
  city`), and the committed `renderer/gallery-toys.js` carries the art-free
  toy with no VRAM write in it;

and the test runs the **playable** `demo-art/city/main.lua`, the file the
deploy puts on the site — not a stand-in.

**Not proven, and worth saying:**

- The **collection cost**. 224 `raster()` callbacks cost what the model prices
  a full call per line: `frame()` + the callbacks are **2.32x** a 60 Hz frame
  in `pce-validate.js`. Every callback toy is in that band (parallax 2.64x,
  status-bar 2.31x, road 3.58x), and the browser runs it at 60 Hz because the
  callback is a JS function call, not a CPU budget. On the **console**,
  #31C measured a compiled raster callback at ~1,500 cycles, which is a
  12–15 Hz toy frame — so this demo's console route is the interpreter, not
  this frame budget. Card #125 asks for the validator to accept it, and it
  does; the console frame time is a separate, unmeasured question.
- **The scene's own seam.** The BAT is 32 cells wide, so each band wraps every
  256 px — the hardware's wrap, not a torn map. The band split is the water's
  own surface line, so the shift at the boundary reads as water moving faster
  than the street it fills.
- **No Mednafen capture or export.** The card asks for the Export button and a
  capture in Mednafen; neither was done in this session — and export is blocked
  for every full-screen picture by card #148's other half (the IL bytecode's
  127-constant pool, `renderer/pce-ilbc.js`), which refuses CITY, OAK
  WOODS and MINE alike. What is proven is the browser
  runtimes and the validator, in `tests/check-city.js`.
- **Rule 2**: this test was written by the card's own seat (@design). A cold
  break by another seat is owed before the card closes.
