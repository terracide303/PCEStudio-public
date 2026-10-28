# Rule 2 breaker (#46, #57) — ROMs past 80 KiB through the MPR banks, broken 20 ways

Reviewer: @review (DeepSeek Flash seat). The builder of #46 (`e7c547c`) and
#57 (`90d64d5`) was a different seat. Read cold: the repository only, no
briefing. Date 2026-10-28. **Nothing was fixed; this is the list.** Rule 2 in
[`../../workshop/RULES.md`](../../workshop/RULES.md): a test is proven by
breaks someone else chose.

The cards are #46 ("a ROM bigger than 80 KB: the export grows through MPR
banks to the HuCard limit") and #57 ("the HuCard limit is 128 banks = 1 MB,
not 256"). The files under break are `renderer/pce-rom.js`,
`tools/genviewer.py` and `tools/viewer.asm`; the instruments are
`tests/check-export.js` (the browser builder byte-for-byte against the PCEAS
build) and `tests/check-viewer.js` (a Mednafen capture of the built viewer
against the renderer).

## What I ran

- **Baseline:** a pristine copy of the tree at `90d64d5` (the two reviewed
  commits' tree; the five reviewed files are `cmp`-identical at the current
  HEAD `e925899`) in `$TMPDIR/pce46-base` (rsync, `.git` excluded).
  `node tests/check-export.js` → exit 0, `PASS: the browser's .pce is
  byte-for-byte equal to PCEAS's on 16 scene(s)`, scene10 90,112 bytes,
  sha256 `541fa274c93543dc…`. `node tests/check-viewer.js` on the same copy
  with a freshly captured `viewer10` → exit 0, `PASS … on 22 capture(s)`.
- **Sandbox:** every break got its own copy under
  `$TMPDIR/pce46-mut/<name>/`. A Python harness asserts the target string
  occurs exactly once in the copy, substitutes it, and runs the **unmodified**
  tests. The real repository was never edited; at commit time
  `git status --short` showed only another seat's `?? tools/.DS_Store`.
- **One break at a time.** For `renderer/pce-rom.js` the unmodified
  `node tests/check-export.js` is enough. For `tools/genviewer.py`, the
  canonical command reads a **committed** `tools/gen/*.pce`, so each break
  was run twice: (a) `node tests/check-export.js` against the committed
  reference, then (b) `make -B gen/viewer10.pce` (which runs the mutated
  generator + PCEAS) and `node tests/check-export.js` again. For
  `tools/viewer.asm`, the mutated `tools/gen/viewer10.pce` was rebuilt and
  captured with a PID-targeted copy of `tools/capture.sh` (no global
  `pkill`, so no other seat's Mednafen was touched; no keyboard or mouse
  events), then `node tests/check-viewer.js` was run unmodified.
- **Result classes:** `DETECTED` = the unmodified test exits non-zero and
  names the broken property; `MISSED` = the test exits 0 and prints `PASS`
  (a direct probe then shows the mutant still changes behaviour where no
  fixture reaches — the pass is not an inert edit); `NO-OP` = the test passes
  and the changed code is unreachable for every legal input.
- **Capture safety:** `tools/capture.sh` normally runs `pkill -x mednafen`.
  In the copies only, it was changed to `kill -INT "$MDFN_PID"` so this
  breaker cannot signal another seat's emulator.

## The table

Counts: **20 breaks — 17 DETECTED, 2 MISSED, 1 NO-OP.** (Ten are caught by
`node tests/check-export.js` as committed, four by `node
tests/check-viewer.js`; G12–G14 are caught by `check-export` once the PCEAS
reference is rebuilt, which is how the committed fixtures are produced.)

| # | file | break, applied one at a time | result | measured output |
|---|---|---|---|---|
| M01 | pce-rom.js | limit off by one, permissive: `romBanks > MAX_ROM_BANKS` → `> MAX_ROM_BANKS + 1` | **DETECTED** | exit 1: `scene10: a 129-bank request was refused with code undefined, not rom-too-big: pce-rom: 16 regions, the config block holds 13` |
| M02 | pce-rom.js | limit off by one, restrictive: `MAX_ROM_BANKS` 128 → 127 | **DETECTED** | exit 1: `scene10: a 128-bank (1 MB) request was refused as rom-too-big: … at most 127 banks = 1 MB` |
| M03 | pce-rom.js | 129-bank refusal removed: `if (romBanks > MAX_ROM_BANKS)` → `if (false)` | **DETECTED** | exit 1: same line as M01 (the 16-region request falls through to the 13-descriptor cap, which is not `rom-too-big`) |
| M04 | pce-rom.js | descriptor order swapped: write count then destination instead of destination then count | **DETECTED** | exit 1, 16/16 scenes; `scene1: 2 differing bytes of 40960; first at 0x200b (browser 0x02, PCEAS 0x04)` |
| M05 | pce-rom.js | descriptor VRAM address off by one word: `regions[d][0]` → `+ 1` | **DETECTED** | exit 1, 16/16 scenes; `scene1: 1 differing byte of 40960; first at 0x200a (browser 0x01, PCEAS 0x00)` |
| M06 | pce-rom.js | last partial bank not padded: allocate `4 * BANK + tiles.length` instead of `romBanks * BANK` | **DETECTED** | exit 1, 16/16 scenes; `scene10: SIZE 86016 bytes vs PCEAS 90112 bytes` |
| M07 | pce-rom.js | BAT bank and tile bank swapped: `bat`→4, `tiles`→2 | **DETECTED** | exit 1, 16/16 scenes; `scene10: 37959 differing bytes of 90112; first at 0x4000` |
| M08 | pce-rom.js | region straddling a bank boundary truncated: drop each region's partial-bank tail | **DETECTED** | exit 1, 16/16 scenes; `scene10: 1920 differing bytes of 90112; first at 0x14020 (browser 0xff, PCEAS 0x00)` |
| M09 | pce-rom.js | descriptor cap off by one: `MAX_REGIONS` 13 → 12 | **DETECTED** | exit 1: `scene10: the largest legal picture (13 x 2048 chars) was refused: pce-rom: 13 regions, the config block holds 12` |
| M10 | pce-rom.js | the #57 bug restored: `MAX_ROM_BANKS` 128 → 256 | **DETECTED** | exit 1: same line as M01 (`129-bank request was refused with code undefined, not rom-too-big`) |
| G11 | genviewer.py | the pre-#46 descriptor cap left in the Python builder: `MAX_REGIONS` 13 → 8 | **MISSED** | (a) exit 0, `PASS … 16 scene(s)`; (b) `make -B gen/viewer10.pce` exit 0, exit 0 again, `PASS … 16 scene(s)`. Probe on a 9-region scene1: pristine `wrote … 9 copy regions, tiles 4608 B`; mutant `AssertionError: [(0, 256) × 9]` (exit 1) |
| G12 | genviewer.py | last partial bank not emitted: `tiles_banks = max(1, len(tiles) // BANK)` instead of `ceil` | **DETECTED** (after rebuild) | (a) exit 0, `PASS … 16 scene(s)` — it reads the committed reference; (b) after `make -B gen/viewer10.pce`: exit 1, `scene10: SIZE 90112 bytes vs PCEAS 81920 bytes` |
| G13 | genviewer.py | descriptor table order swapped in the config the assembler includes | **DETECTED** (after rebuild) | (a) exit 0, `PASS … 16 scene(s)`; (b) exit 1, `scene10: 4 differing bytes of 90112; first at 0x200b (browser 0x10, PCEAS 0x40)` |
| G14 | genviewer.py | region straddling a bank boundary truncated in `tiles` | **DETECTED** (after rebuild) | (a) exit 0, `PASS … 16 scene(s)`; (b) exit 1, `scene10: SIZE 90112 bytes vs PCEAS 81920 bytes` |
| G15 | genviewer.py | the Python builder's bank ceiling not corrected: `PCEAS_MAX_BANKS` 128 → 256 | **NO-OP** | (a) exit 0, **and** (b) rebuild exit 0, exit 0, `PASS … 16 scene(s)`. The guard is unreachable: 13 descriptors × 2048 chars is at most 851,968 tile bytes = 104 tile banks, 108 ROM banks < 128 |
| G16 | genviewer.py | descriptor cap removed instead of raised: `MAX_REGIONS` 13 → 255 | **MISSED** | (a) exit 0, `PASS … 16 scene(s)`; (b) rebuild and re-run both exit 0, `PASS … 16 scene(s)`. Probe on a 14-region scene1: pristine refuses (`AssertionError`, 14 > 13); mutant builds, `config.bin` grows to 66 B and descriptor 14 overwrites the palette at `0x40` (bytes `0x3e..0x43` = `00000001`) |
| V16 | viewer.asm | MPR register written for the wrong window: tile-bank map `tam2` → `tam3` | **DETECTED** | `check-viewer` exit 1: `viewer10: 33789 differing pixels of 178176 bytes`; `vram differs from scene10 at byte 8192` |
| V17 | viewer.asm | header/reset bank moved: reset-vector block `.org $fff6` → `$f000` (nothing at `$FFFE`) | **DETECTED** | `check-viewer` exit 1: `viewer10: 154272 differing pixels`; `vram differs … at byte 1`; `MWR=0 but scene10 has 80`, `CR=0 but scene10 has 192`, … all VDC regs 0 |
| V18 | viewer.asm | bank number written as the window address: first tile bank `#$04` → `#$40` (the `$4000` window high byte) | **DETECTED** | `check-viewer` exit 1: `viewer10: 157755 differing pixels`; `vram differs from scene10 at byte 8193` |
| V19 | viewer.asm | BAT bank and tile bank swapped: BAT `#$02` → `#$04`, tiles `#$04` → `#$02` | **DETECTED** | `check-viewer` exit 1: `viewer10: 158928 differing pixels`; `vram differs from scene10 at byte 0` |

## The two MISSED breaks, and the check that would catch them

Both are in `tools/genviewer.py`, the builder `check-export` never runs: it
compares `renderer/pce-rom.js` against a **committed** `tools/gen/*.pce`.
The largest fixture has 2 copy regions (scene10), so the 13-descriptor cap
is exercised only in the browser builder (`check-export`'s synthetic
`maxLegal` 13-region request); the Python builder's cap is tested in
neither direction.

- **G11 — `MAX_REGIONS` regressed to the old 8.** A 9-region picture builds
  from `pce-rom.js` and is refused by `genviewer.py`, so the two builders
  disagree exactly on the #46 change. No sample scene has 9–13 regions.
  *Which check would catch it:* a fixture with 9–13 small copy regions
  built by both paths and compared in `check-export.js` (scene10 has only
  2 regions). The same fixture should also require 14 regions to be
  refused by both builders, which catches G16. A cheaper guard is a direct
  assertion that the two sources' `MAX_REGIONS` agree; the fixture is the
  one that proves the behaviour, not just the constant.
- **G16 — the cap removed (`MAX_REGIONS` 255) instead of raised to 13.**
  Fourteen descriptors do not fit: the 14th is written across offset
  `0x40`, the first palette word. The pristine builder refuses; the mutant
  silently emits a 66-byte config whose palette is corrupt. No fixture has
  more than 13 regions, and the Python path is not run by the canonical
  test, so the pass is not an inert edit — it is an untested input class.
  *Which check would catch it:* the same 9–13-region cross-builder fixture,
  plus a 14-region refusal case run through `genviewer.py`.

## Residual weaknesses worth writing down

1. **`check-export.js` trusts committed PCEAS output.** G12, G13 and G14
   all print `PASS … 16 scene(s)` unless `make -C tools` regenerates the
   reference from the mutated generator. The suite should either rebuild
   before comparing or say so next to the `node tests/check-export.js`
   invocation. This is why three layout breaks are listed as "DETECTED
   (after rebuild)": the check does catch them, but only after the build
   step the committed `.pce` hides.
2. **No ROM past 108 banks is ever built.** 128-bank and 129-bank requests
   both carry 16 regions, so the size guard is observed only through the
   *next* refusal (`code undefined`); a 16-region request can never build.
   The largest legal picture is 108 banks. The 109–127-bank range has no
   fixture at all. If the descriptor-cap refusal ever gains a machine
   `code` of its own (or `rom-too-big`), a removed size guard would pass
   M03/M10. The guard's threshold is otherwise well pinned at both edges
   (M01, M02, M09).
3. **`genviewer.py`'s 128-bank guard is dead code** (G15): with 13
   descriptors the generator cannot reach 128 banks, so
   `PCEAS_MAX_BANKS = 256` changes nothing. `docs/ROM_LAYOUT.md` says the
   Python builder "stops at the same 128 banks"; that is true only
   vacuously. The card's own notes already record the unreachability, but
   the doc still presents it as a live guard.
4. **The limit tests use overlapping regions all at VRAM word 0.** That is
   sufficient to exercise the byte count, but it means the 128-bank
   acceptance probe is not a picture and proves no data at banks 64–127.
   The commit's "not proven: the 1–2 MB range" stands, and this review adds
   that even 109–127 banks are unproven.

## What was not done

No source or test was fixed. The real tree was not edited; every break ran
in `$TMPDIR/pce46-mut/`. This document is the only file committed by this
seat. `tests/check-editor.js` was already modified by another seat when the
review began and was left alone.
