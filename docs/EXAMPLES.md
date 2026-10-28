# The example toys — the classics, and the trick in each (#29)

Five toys live in `toys/`, each a short readable file that does one classic PC
Engine effect.  They are toys for #30's runtime (`docs/TOYS.md`) and are
written inside the IL's subset (`docs/IL.md` §2/§5), so the same file runs
through the Lua runtime and through the IL — the console path (#31) — and the
two must agree exactly.

The evidence is `node tests/check-examples.js`; §5 below is what it checks.

---

## 1. Line-scroll parallax — `toys/parallax.lua`

The PCE has no HDMA.  A horizontal offset that differs per line is made by the
**RCR line interrupt** writing **BXR** (VDC R07, 10 bits, manual p. H7-7) once
per band: a write before line L applies from line L down to the next write.

Four bands (56 lines each) of striped texture each get their own BXR, from
`f // 8` (far) to `f * 2` (near).  The frame-start latch takes the table's
last BXR, so line 0 must restate the first band's value — that is the one
non-obvious line in the file, and it is where a split with a scrolling top
band would break.

Each band also carries one bright marker bar.  In frame 60 the four bars stand
at four different x: the picture proves the split by itself.

## 2. A sky gradient — `toys/sky-gradient.lua`

One flat tile fills the screen.  The gradient is not in the tiles: the RCR
callback writes **a different VCE colour into palette entry 1 for every line**
(a VCE write in the HBlank before line L shows on line L, docs/RENDERER.md).
The sky is the colour table moving under a solid tile.

A second entry draws the sun: the sun's tiles use colour 2 inside the disc and
colour 1 outside, so writing colour 2 only across the sun's 16 lines keeps the
disc crisp.  One extra palette write per frame shimmers it.

The result is banded in 8–32-line steps: that is the VCE's three bits per
channel, not a bug, and it is what the hardware can show.

## 3. A pseudo-3D road — `toys/road.lua`

Three per-line register writes, one job each:

- **BYR** (VDC R08, 9 bits, p. H7-7) chooses which **row of the map** the
  line shows.  The map holds the road already drawn in perspective (2 tiles
  wide at its top row, 16 at the bottom); a quadratic line→row mapping makes
  the road widen toward the viewer.
- **BXR** shifts the line sideways.  Growing with the square of the distance
  below the horizon, it bends the road: zero at the horizon, largest in the
  foreground.
- **Palette writes** recolour the asphalt: a pale shade at the horizon (haze),
  a dark one near the viewer, and a bright stripe on lines where
  `(dz²/40 + 4f) % 48 < 12` — the stripes slide down the screen as `f` grows,
  so the road appears to rush at the viewer without a tile moving.

The sky above the horizon is §2's trick simplified to one write per line.

## 4. A fixed status bar — `toys/status-bar.lua`

The same RCR write, used as a **split**: line 0 writes BXR = BYR = 0, line 24
writes the playfield's scroll.  The top 24 lines always show map rows 0–2 and
hold still; everything below scrolls under them (BXR right, BYR down).  The
playfield's BYR is kept in 24..55 so the map rows it samples never wrap back
into the bar's rows.

The bar is separate palette (background palette 1), so its blink — one palette
write in `frame()` — cannot touch the playfield.

## 5. Palette cycling — `toys/palette-cycle.lua`

A tilemap pixel names a palette entry, and the 512-word VCE table can be
rewritten at any time.  Rotating the colours among a run of entries animates
the picture without touching a tile or the map.

Water: palette 0 colours 1–6 are six blue shades, re-dealt every frame; the
tile is six diagonal bands drawn once in `init()`.  Fire: palette 1 colours
1–4 are hot shades on a ragged flame-top tile over the backdrop.  Two palette
ranges, one rotation cannot spill into the other.

---

## What `tests/check-examples.js` proves

For each of the five files, 120 frames through **both** runtimes:

- `vram`, `cram`, `sat` and the four register values byte-equal, the raster
  table identical (deep, including `base`, `baseCram`, `cramPrev`), pixels
  diff 0 through the one model both draw with, and equal frame size;
- **#30's budget**: every Lua frame ran inside the runtime's own 100 ms
  deadline (it throws `toy-timeout` past it) and the worst measured wall time
  is printed; the IL ran inside its default 5,000,000-instruction budget per
  hook;
- **#50's budget**: the model's own per-line SAT search reports at most 16
  strips on every line and no overflow (OR) or sprite-0 collision (CC);
- **the effect, measured in the pixels**: the four parallax bars stand at
  `(43 − BXR) mod 256` for their own band and at four different x; the sky
  column changes colour at least six times and the sun's disc is the frame's
  own palette entry; the road's edge lines are more than 32 px further apart
  at line 200 than at line 100 and the left edge leans left; the status bar's
  rows 0–23 are the same in frames 0 and 60 while the playfield's are not; the
  water's and fire's six palette entries are all rotated between frames 0
  and 1;
- frame 60 of each is written to `tests/dumps/examples/<name>.png` and read
  back pixel for pixel.

**Rule 2:** the toys and the test were written by the same seat, so a cold
break is owed.  What a cold review should try: change a register write, a
palette entry or an `init()` loop and require the test to catch it — and judge
the five pictures, which no assertion can.

## Not proven

- **No console and no emulator run.**  These are browser toys; exporting them
  to a `.pce` is #31's next half and #32's cycle budget.  The pictures come
  from `renderer/pce-bg.js`/`pce-sprites.js`, the model proven against
  Mednafen's captures for the ROMs it has, not for these toys.
- **#50's budget is trivially met**: none of the toys draws a sprite, so every
  line is 0 strips.  The check is in place so a toy that grows sprites cannot
  close the card past budget, but no example exercises it.
- **The sky gradient and the road are banded/stepped** by the tilemap and the
  VCE's 3-bit channels; that is the hardware's resolution, not a rendering
  choice.
- **The `t` argument is unused** by all five: the IL's `t` is Q16.16, not
  Lua's double, and fixed-point maths would make the two runtimes differ in
  the low bits (docs/IL.md §2).  The examples stay in integers so the
  comparison is exact.
