# REVIEW-PANELS — a cold break of the studio panels (#85, #86, #92, #79, #93, #97, #98, #99, #107)

**Seat:** @review, acting as BREAKER. **Rule:** [`../workshop/RULES.md`](../../workshop/RULES.md) rule 2 —
a test is proven by breaks someone else chose. **Date:** 2026-10-29.
**Base commit:** `21e6d5ef6d664e05e3ec9698486bf8eb4dd5055a` (origin `main` when the run started).

Each break below was applied to a **fresh clone** of that commit under `$TMPDIR` and the
**matching check was left unmodified**. Nothing in the real working tree was edited except this
document. No keyboard or mouse events were sent.

- `node tests/check-studio.js --browser` — 1,291 checks, headless Chrome driver included. Used for
  #85 PALETTES/VRAM, #86 SPRITES, #92 SCANLINES, #93 LAYERS, #97 AUDIO, #98 CONSOLE and #107
  Paste & Run, because those panels are driven through the page.
- `node tests/check-pokes.js` — 145 checks. Used for #79 REGISTERS (it boots the page in the stub
  DOM; it has no `--browser` flag).
- `node tests/check-assets.js` — 246 checks. Used for #99 ASSETS (it boots the real panel module
  against a stub DOM; it has no `--browser` flag).

Baseline on the clean clone: **PASS 1,291 / PASS 145 / PASS 246**. A break is **DETECTED** when
the unmodified check exits non-zero, **MISSED** when it exits 0, and **NO-OP** when the break is
behaviourally equivalent (none were).

## Verdicts

| ID | Panel | Break applied | Check | Verdict | Measured output |
|---|---|---|---|---|---|
| 85-P1 | #85 PALETTES | `colourWord` builds `GGGRRRBBB` with G and R exchanged | studio | **DETECTED** | `FAIL #85: the picker button writes the entry (got 448, want 56)`; swatch `rgb(0,252,0)` vs `rgb(252,0,0)` |
| 85-P2 | #85 PALETTES | a swatch's CRAM address uses `palette * 8 + entry` instead of 16 entries per palette | studio | **MISSED** | `PASS 1291 checks`; probe: `title(1,5,$1C0)` = `CRAM $00D`, should be `$015` (`palette*16+entry`) |
| 85-V1 | #85 VRAM | the character decode reads plane 1 from `word + 1` instead of `word + 8` | studio | **DETECTED** | `FAIL #85: the diagonal decodes to eight 5s (got 0, want 8)`; all-16 round trip wrong |
| 85-V2 | #85 VRAM | a click on the sheet always reports the character's first word (row-in-cell ignored) | studio | **DETECTED** | `FAIL #85: a click on the canvas selects the word under the pointer (got 1024, want 1025)`; the browser driver fails the same way |
| 86-S1 | #86 SPRITES | a sprite drag moves it by 2 px per px of pointer travel | studio | **DETECTED** | `FAIL sprite 0 is at (122,106) (got "132,116", want "122,106")` |
| 86-S2 | #86 SPRITES | `spriteAt` picks the highest SAT index on an overlap instead of the lowest | studio | **MISSED** | `PASS 1291 checks`; probe: two overlapping sprites at (10,10) → `spriteAt = 1`, should be `0` |
| 92-R1 | #92 SCANLINES | a band's one-entry raster line is `from + 1` (line range off by one) | studio | **DETECTED** | `FAIL #92: band 2's entry fires at line 32 (got "1,33", want "0,32")`; RCR `$61` vs `$60` |
| 92-R2 | #92 SCANLINES | the wobble's period is used as a half-period (`/ (period / 2)`) | studio | **MISSED** | `PASS 1291 checks`; probe: wobble BXR lines 0-5 = `0:0 1:2 2:3 3:4 4:4 5:4`, correct `0:0 1:1 2:2 3:2 4:3 5:3` |
| 79-G1 | #79 REGISTERS | PSG rows at `$0800 + 2*n` (word address used as a byte address) | pokes | **DETECTED** | `FAIL #79 table: PSG $801 is 'main amplitude'`; the catalogue's addresses disagree for all ten PSG rows |
| 79-G2 | #79 REGISTERS | the DECIMAL box is parsed with radix 16, so a typed `10` pokes 16 | pokes | **MISSED** | `PASS 145 checks`; probe: `commit()` reads `parseNumber(input.value, 16)`, so `10` → `16` instead of `10` |
| 93-L1 | #93 LAYERS | the fade's channel mix divides by `steps + 1`, so the last step never reaches the target (step 0 is wrong too) | studio | **DETECTED** | `FAIL #93: the last step is the target word (got 0, want 32)`; step 8 `$0F6` vs `$0FF` |
| 93-L2 | #93 LAYERS | a fade of background palettes 1-15 also writes the palette's entry 0 (CRAM `$010+0`), which the BG never reads | studio | **MISSED** | `PASS 1291 checks`; probe: `addressesOf("background",1)` = `[16..31]`, correct `[17..31]` |
| 93-L3 | #93 LAYERS | `gatedRaster` forgets to apply the layer mask to a raster entry's CR | studio | **MISSED** | `PASS 1291 checks`; probe: with BB cleared the entry still reads `$C0`, should be `$40` |
| 97-A1 | #97 AUDIO | the meter reads a balance word's nibbles swapped (low nibble as left) | studio | **DETECTED** | `FAIL #97: the left meter is full (got 31, want 0)`; right `0` vs `31` |
| 97-A2 | #97 AUDIO | the row's L slider writes the right balance nibble and the R slider the left | studio | **MISSED** | `PASS 1291 checks`; probe: left slider 0 on balance `$FF` → `$F0`, should be `$0F` |
| 98-C1 | #98 CONSOLE | the banner says green whenever compilation produced a report, even with error findings | studio | **DETECTED** | `FAIL #98: a refused toy's banner is red (got "ok", want "bad")`; the two-error toy is announced runnable |
| 98-C2 | #98 CONSOLE | the finding count adds warnings to errors and calls the total errors | studio | **MISSED** | `PASS 1291 checks`; probe: 0 errors + 2 warnings draws `"2 errors"`, intended `"0 errors · 2 warnings"` |
| 99-A1 | #99 ASSETS | the VRAM bar counts the SAT segment twice | assets | **DETECTED** | `FAIL #99: painted: the VRAM bar is every claimed word (got 3664, want 3408)`; the parts sum disagrees with the total |
| 99-A2 | #99 ASSETS | the CRAM bar counts every entry, including the words holding no colour | assets | **DETECTED** | `FAIL #99: painted: the CRAM bar is the entries holding a colour (got 512, want 106)`; split `256/256` vs `106/0` |
| 107-P1 | #107 PASTE & RUN | the fence regex has no language group, so a valid ` ```lua ` fence's body is read as the language and refused | studio | **DETECTED** | `FAIL Error: the code fence says ```function frame(t, f)` — a valid fence is refused before it can replace `main.lua` |
| 107-P2 | #107 PASTE & RUN | the fence language is compared case-sensitively, so ` ```LUA ` / ` ```Luau ` is refused | studio | **MISSED** | `PASS 1291 checks`; probe: ` ```lua ` strips, ` ```LUA ` → `paste-language` (old source kept) |

**Counts: 21 breaks — 12 DETECTED, 9 MISSED, 0 NO-OP.** Every panel got at least two:

| Panel | Breaks | Detected | Missed |
|---|---|---|---|
| #85 PALETTES/VRAM | 4 | 3 | 1 |
| #86 SPRITES | 2 | 1 | 1 |
| #92 SCANLINES | 2 | 1 | 1 |
| #79 REGISTERS | 2 | 1 | 1 |
| #93 LAYERS | 3 | 1 | 2 |
| #97 AUDIO | 2 | 1 | 1 |
| #98 CONSOLE | 2 | 1 | 1 |
| #99 ASSETS | 2 | 2 | 0 |
| #107 PASTE & RUN | 2 | 1 | 1 |

## The nine misses, and the check each one needs

Each probe below was run against the mutated clone's own modules; the quoted numbers are its
output. The current check passes, so each is a real hole, not an equivalent mutant.

1. **85-P2 — palette tooltip address for palette > 0.** `pce-palettes.title(1,5,$1C0)` says
   `CRAM $00D`; `palette * ENTRIES + entry` says `$015`. The suite reads a tooltip only for
   palette 0 (`pal-0-5`), where `*8` and `*16` coincide.
   **Check that would catch it:** assert `title(1,5,…)` contains `CRAM $015` and
   `title(18,3,…)` contains `CRAM $123` (sprite palette 2, entry 3).
2. **86-S2 — overlap priority.** Two sprites at the same display point and both opaque give
   `spriteAt = 1`; the VDC draws the lower SAT index (`pce-sprites.paintLine` paints
   last-to-first), so it must be `0`. The screen-press test has exactly one sprite.
   **Check that would catch it:** place two overlapping sprites and assert
   `sat.spriteAt(pic,x,y) === 0` and `api.screenPress(x,y) === 0`.
3. **92-R2 — wobble values.** A period-32 wobble should emit BXR `0,1,2,2,3,3…` on lines 0-5;
   the mutant emits `0,2,3,4,4,4`. The suite checks the wobble's *cost* (64 cycles) and that it
   raises no problem, never the BXR it produces.
   **Check that would catch it:** `toRaster` a wobble band and compare every line's BXR with the
   check's own `round(amplitude * sin(2π(line-line0+speed*frame)/period))`.
4. **79-G2 — decimal entry.** `commit()` reads `parseNumber(input.value, 16)`, so typing `10` in
   DECIMAL pokes 16. The suite's only decimal sample is `"9"`, identical in both bases.
   **Check that would catch it:** `api.setDec("VDC08","10")` and assert the poke value is 10
   (and `api.setDec("VDC07","10")` crosses a hex/decimal boundary differently).
5. **93-L2 — background palette 1 fade addresses.** `addressesOf("background",1)` includes 16
   (CRAM `$010`, colour 0 of palette 1), a word `pce-bg.js` never reads: the BG folds every
   colour 0 up to CRAM `$000`. The plan test uses background palette 0, where the duplicate is
   deduplicated away.
   **Check that would catch it:** plan a fade for `{kind:"background",palette:1}` and assert
   `plan.addresses` is exactly `17..31` (no 16), with the same test for a sprite palette's
   `$100..$10F`.
6. **93-L3 — raster lines and the layer mask.** `gatedRaster` with BB cleared leaves the entry's
   CR at `$C0` instead of `$40`, so switching the BG off does not blank it on a toy that writes
   its own per-line CR. No LAYERS fixture has a raster table.
   **Check that would catch it:** run a scene with `raster(line)` setting CR, turn the BG layer
   off, and require the composed preview to equal the renderer with BB cleared on *every* raster
   entry (or assert `gatedRaster(...).entries[0].cr & 0x80 === 0`).
7. **97-A2 — the balance sliders.** The model's `audioBalance` is tested, but the DOM handlers for
   `aud-balL-0` / `aud-balR-0` are never fired. The mutant's left slider writes the low nibble:
   left 0 on `$FF` gives `$F0`, should be `$0F`.
   **Check that would catch it:** fire the two inputs (as the volume check already does with
   `fire(vol,"input")`) and assert the high nibble follows L and the low nibble R, plus the R5
   write and the meter side.
8. **98-C2 — the finding count with a warning present.** 0 errors + 2 warnings draws
   `"2 errors"`; the intended text is `"0 errors · 2 warnings"`. No fixture produces a validator
   warning and the suite never reads `console-count`.
   **Check that would catch it:** a toy that triggers a `severity:"warn"` finding, then assert
   `console-count` reads `0 errors · 1 warning` and the banner stays green with that warning shown.
9. **107-P2 — fence language case.** ` ```LUA ` is a valid Markdown fence, but the mutant compares
   `m[1]` without lower-casing it and refuses it as `paste-language`, so `main.lua` is left as it
   was. The suite only uses ```lua, ```js and an untagged fence.
   **Check that would catch it:** `studio.stripFence("```LUA\n" + body + "```")` and the same with
   ` ```Luau ` must strip to `body`; also assert the old source is unchanged on a genuine
   `paste-language` refusal.

## Notes on the run

- **Post-commit gate:** `tests/all.sh` in a fresh clone gave **36 suites PASS, 1 SKIP
  (`check-ares`, no screen), 0 FAIL** on this review's own commit (`7653e62`), and
  **37 PASS, 1 SKIP, 0 FAIL** on the tip when measured (`2109232`, after #80/#94 landed).
- Origin advanced during the run (#80 and #94 landed). Every break was cloned from
  `21e6d5e`, the commit the review started on; the document itself is rebased onto the
  current tip and touches no code.
- The first parallel batch's `--browser` runs are cheap and independent (each check serves on
  port 0 and uses its own profile), but two concurrent headless runs produced unrelated
  `browser driver: a dropped .lua loads (drop status pending)` flakes. The 93-L3 break was
  re-run alone and passed cleanly (`PASS 1291 checks`), so it is recorded MISSED on the panel
  checks; the drop-driver flake is a separate, pre-existing timing observation, not a panel
  verdict.
- What this does not prove: CSS/layout and real-GPU pixels (the stub canvas records calls, the
  browser run checks the 40-frame digest and the driver flows, not the panels' painted result),
  and anything about panels' behaviour on a 240-line window or a raster toy except where named
  above.
- Rule 2 routing: the nine misses are new cards one kind up from each panel test's builder. The
  two DETECTED-but-shallow cases (#85-V2, #99-A1) already name what to assert, so they need no
  new card; they pass as evidence now and are kept as regression fixtures in this table.
