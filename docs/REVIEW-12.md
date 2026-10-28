# Phase 1 breaker (#12) — a different seat breaks the sprite renderer

Reviewer: @review (DeepSeek Flash seat). Builder of #12 was a different seat
(DeepSeek). Read cold: the repository only, no briefing. Date 2026-10-28.
**Nothing was fixed; this is the list.**

## What I ran

- **Baseline:** `node tests/check.js` at `e585093` → `PASS`, 27 scene(s)
  `diff 0`, `us1` skipped as not-a-picture.
- **Sandbox:** copied `renderer/pce-sprites.js`, `renderer/pce-bg.js` and
  `tests/check.js` to
  `/Volumes/External II/agent-tmp/review12-sandbox/`, symlinked `tests/dumps`
  read-only, and ran the sandbox `check.js` against a sandbox copy of
  `pce-sprites.js`. The repo's file was never edited (`git status` stayed
  clean; verified after every build).
- **One break at a time:** restore the pristine copy, apply exactly one edit,
  verify it parses with `node --check`, then run the **unmodified**
  `tests/check.js`. `DETECTED` = check.js exits non-zero; `MISSED` = exits 0
  and still reports diff 0.
- **Miss confirmation:** for each MISSED build I hashed the rendered pixels of
  all eight sprite scenes and diffed them against pristine. All three are
  byte-identical, so each miss is a coverage gap, not an edit that failed to
  change behaviour.

The eight sprite scenes are `sprite1`–`sprite8`; the other 19 pictures are the
sprite-free regression net. Every break below was caught only through a sprite
scene, as expected.

## The table

| # | break, applied one at a time | category | check.js | scenes that failed |
|---|---|---|---|---|
| M1 | `CGY_HEIGHT` `[16,32,64,64]` → `[16,16,64,64]` (16×32 drawn 16 tall) | size decode | **DETECTED** | sprite1, sprite2, sprite7 |
| M2 | `CGY_HEIGHT` `[16,32,64,64]` → `[16,32,32,64]` (CGY=2, 16×64 drawn 32 tall) | size decode | **MISSED** | — |
| M3 | VFLIP ignored entirely | flips | **DETECTED** | sprite2, sprite7 |
| M4 | VFLIP mirrors rows but block order is not reversed | flips | **DETECTED** | sprite2, sprite7 |
| M5 | HFLIP ignored when fetching pixels (`bit = 15-c` always) | flips | **DETECTED** | sprite2 |
| M6 | CGX HFLIP mirrors pixels but does not swap the two halves | flips | **DETECTED** | sprite2 |
| M7 | sprite palette base `0x100` → `0x000` | palette offset | **DETECTED** | sprite1–8 |
| M8 | palette field masked to 3 bits (`w3 & 0x7`) | palette offset | **DETECTED** | sprite4, sprite5 |
| M9 | SPBG ignored: every opaque sprite pixel replaces the background | priority | **MISSED** | — |
| M10 | SPBG=0 sprite never replaces the background/backdrop | priority | **DETECTED** | sprite3, sprite8 |
| M11 | 16-strip limit raised to 32 | per-line limit | **DETECTED** | sprite4 |
| M12 | 16-strip limit lowered to 15 | per-line limit | **DETECTED** | sprite4 |
| M13 | paint forward SATB: higher SAT index wins overlaps | SATB order | **DETECTED** | sprite3, sprite4 |
| M14 | block select `(yoff & 0x30) >> 3` → `>> 4` | pattern address | **DETECTED** | sprite1, sprite2, sprite7, sprite8 |
| M15 | cell stride `64` → `32` words | pattern address | **DETECTED** | sprite1–8 |
| M16 | SAT Y=64 is row 0 → SAT Y=63 | Y offset | **DETECTED** | sprite1–8 |
| M17 | SAT X=32 is col 0 → SAT X=16 | X offset | **DETECTED** | sprite1–8 |
| M18 | sprite pixel 0 drawn instead of transparent | transparency (extra) | **DETECTED** | sprite1–8 |
| M19 | SAT word 0/1 (Y/X) swapped | SATB word order (extra) | **DETECTED** | sprite1–8 |
| M20 | per-cell row counter not masked to 15 (`row = yoff`) | row counter (extra) | **DETECTED** | sprite1, sprite2, sprite7, sprite8 |
| M21 | sprite-enable check tests `CR & 0x20` instead of `CR & 0x40` | SB blank bit (extra) | **DETECTED** | sprite1–8 |
| M22 | SPBG read from bit 8 instead of bit 7 | SPBG field (extra) | **DETECTED** | sprite1, sprite2, sprite4–7 |
| M23 | HFLIP read from bit 12 instead of bit 11 | HFLIP field (extra) | **DETECTED** | sprite1, sprite2, sprite7, sprite8 |
| M24 | CGX right half pushed past the 16-strip limit (guard `if (true)`) | per-line limit | **MISSED** | — |

**Result: 21 DETECTED, 3 MISSED.** The test is much stronger than #11's
renderer test was: every break in the eight categories the card names is
caught, and several subtle ones (per-cell row restart, VFLIP block order, CGX
half swap) with it.

## The three misses

### Miss 1 — M2: no scene carries a CGY=2 (16×64) sprite

Measured across all 64 entries of all eight `sat.bin` files, by CGY value:

| CGY | height | entries |
|---|---|---|
| 0 | 16 | 56 |
| 1 | 32 | 4 |
| 2 | 64 | **0** |
| 3 | 64 | 6 |

So `CGY_HEIGHT[2]` is never read. The check is not blind to 64-tall sizes in
general: decoding CGY=3 as 32 tall (the same edit at index 3) **is** caught by
sprite1, sprite7 and sprite8. What is unproven is the CGY=2 encoding
specifically — any bug keyed to `CGY == 2` passes every scene.

**Settles it:** a SAT entry with CGY=2 (16×64), then M2 must be DETECTED.

### Miss 2 — M9: an SPBG=0 sprite is never drawn over visible background

The rule is "visible sprite pixel replaces the background when SPBG=1 **or**
when the background colour's low nibble is 0". Measured on the winning sprite
pixel of every line:

| pixels | count |
|---|---|
| SPBG=1 (always draws) | 19,872 |
| SPBG=0 over background low-nibble 0 (backdrop/blanking) | 1,920 |
| SPBG=0 over background low-nibble ≠ 0 | **0** |

Ignoring SPBG entirely (always replace) changes nothing, because the only
SPBG=0 sprites in the scenes sit over the backdrop. The *other* half of the
rule is covered: "SPBG=0 never draws" (M10) is caught by sprite3 and sprite8,
so the backdrop/blanking case is tested. The untested half is that a visible
background must **hide** an SPBG=0 sprite.

**Settles it:** an SPBG=0 sprite whose opaque pixels overlap a background
tile with a non-zero colour number, then M9 must be DETECTED.

### Miss 3 — M24: the 16-strip limit is never reached by a CGX (32-wide) sprite

The only line that exceeds 16 strips is in `sprite4` (19 strips), and that
scene has no CGX sprite. The maximum number of strips already collected when a
CGX entry is reached is **7** (`sprite1`), never 15. A CGX sprite costs two
strips against the limit; pushing its right half past the limit is therefore
unobservable.

**Settles it:** a line with 15 strips already collected and a CGX sprite as the
16th entry, then M24 must be DETECTED.

## Verdict for #12

What stands: the sprite compositor matches Mednafen pixel-for-pixel on all
eight scenes, and the test catches every deliberate break in size decode (CGY
1 and 3), HFLIP/VFLIP including block order and CGX half swap, palette base
and width, SPBG over backdrop, the 16-strip limit, SATB priority, pattern
block select and stride, Y/X offsets, transparency, SAT word order, per-cell
row restart, the SB bit and the SPBG/HFLIP bit positions.

What does not: the three gaps above are narrow but real, and each is one scene
away from being closed. Per rule 2 they are new cards routed one kind up from
#12's test builder, not a reason to reopen the compositor.

## What I did not check

- **Hardware**: no PC Engine/TurboGrafx here; the oracle is Mednafen 1.32.1
  dumps only, same as every other renderer claim in the repo.
- **`pce-bg.js`**: out of scope; it was reviewed cold in `docs/REVIEW.md`.
- **Browser/editor paths** (`renderer/index.html`, `pce-editor.js`): not run.
- **Mutants outside `pce-sprites.js`**: none; every break is in the module the
  card adds.
- **Whether the dumps reproduce**: not re-captured.

## Reproducing

The sandbox and the 24-edit driver are at
`/Volumes/External II/agent-tmp/review12-scripts/` (`mutate.js`,
`evidence.js`, `compare.js`). Each table row is one exact string replacement
against `renderer/pce-sprites.js.pristine`, followed by
`node tests/check.js` in the sandbox. The repo was never written to.

## Appendix — exact edits for the three misses

Each is a single string replacement in `renderer/pce-sprites.js`:

- **M2:** `var CGY_HEIGHT = [16, 32, 64, 64];` →
  `var CGY_HEIGHT = [16, 32, 32, 64];`
- **M9:** `if (s && (s.spbg || !(img.indices[o + x] & 0xF))) {` → `if (s) {`
- **M24:** the CGX-branch guard `if (strips.length < 16) {` → `if (true) {`
  (there is one occurrence; the loop guard `for (... && strips.length < 16;
  i++)` is a different string).

---

## Closed by #40 (2026-10-28, @test) — the three misses are now caught

The exact edits above, re-run with this driver against the same check.js in
the same sandbox, now report **DETECTED**, and the diff regions are the
designed witnesses:

| break | scene that catches it | measured diff region (captured rows) |
|---|---|---|
| M2 | **sprite9** — one SAT entry, CGY=2, 16×64 at cols 80–95 | the sprite's rows 33–64 (its lower half) |
| M9 | **sprite10** — SPBG=0 sprite over the stripes' solid colour-7 half | exactly the sprite's 16×16 footprint, cols 128–143 |
| M24 | **sprite11** — 15 single-strip sprites on one line, then a CGX sprite as the 16th SAT entry | exactly the CGX right half, cols 226–241 |

All 24 rows of the table above now DETECTED; `node tests/check.js` is diff 0
on all 30 pictures (27 + the three new scenes).

Two generator bugs surfaced while building sprite10 and were fixed there
(sprite3 re-captured; these were never renderer bugs — the renderer and
Mednafen agreed on every capture, they just agreed on a picture that was not
what the generator's comments claimed):

- the stripes tiles were written at VRAM words 0x0040/0x0041 — inside the
  BAT — and the real cells 0x0400/0x0410 stayed zero, so the "solid colour-7
  right half" was colour 0 in every earlier capture (which is also why the
  miss-2 measurement above found zero SPBG=0-over-nonzero pixels: the solid
  half did not exist in the data);
- the tile bytes 0x77 decode MSB-first (bit 7−col) as 0x0/0xF stripes, not
  solid colour 7 — the tile is now 0xFFFF/0x00FF per row, which decodes to
  solid 7 (and genroms.py's old "LSB/bit x is the leftmost pixel" comment
  was corrected; all 30 diff-0 captures show the VDC decode is MSB-first).

What this still does not prove: the three scenes pin exactly the three
narrow conditions above, against Mednafen 1.32.1 captures — not hardware,
and not any other sprite condition the eleven scenes do not exercise. The
sprite10 witness covers one opaque background tile (colour 7); other
non-zero colour numbers are not separately tested (the rule tests the low
nibble, and 7 exercises the same test as any other non-zero value).
