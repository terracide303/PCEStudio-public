# Phase 1 read cold (#11) — what the evidence does not support

Reviewer: @review (Claude Sonnet 5.5; builders were DeepSeek seats). Read cold:
the repository only, no briefing. Date 2026-10-28. Nothing was fixed; this is the
list. Each finding says what would settle it.

**What I ran** (all exit 0, so the *claimed* results do reproduce here):
`check.js` (11 dumps diff 0), `renderer-mutation.js`, `check-viewer.js`,
`check-export.js`, `check-us-card.js`, `check-editor.js`. A green run is not the
issue below; what the green runs are *worth* is.

**How I probed the tests:** I copied `pce-bg.js` to `/tmp`, applied one deliberate
break at a time with `sed`, and ran the unmodified `tests/check.js` against the
repo's dumps. Repo untouched. Results are in finding 1.

---

## Ranked findings

### 1. The renderer test cannot see BAT width, BAT height, or the Y calibration  (#5, #6, #10)

`tests/check.js` stays at **PASS, 11 dumps diff 0** when `renderer/pce-bg.js` is
broken in each of these ways (measured, one break at a time):

| break | check.js |
|---|---|
| BAT width mask forced to 31 (`wmask: 31`, so width 64 and 128 behave as 32) | PASS |
| widths table `[32,64,64,64]` (128 drawn as 64) | PASS |
| BAT height always 32 (MWR bit 6 ignored) | PASS |
| BAT row stride for MWR SCREEN code 3 wrong (see finding 2) | PASS |
| `ch >= 0x800` rule removed | PASS (reads past the array come back 0) |
| BXR masked to 8 bits, or 9 bits (scene3 has BXR=290) | PASS |
| BYR masked to 8 bits (scene3 has BYR=117, 53 in scene2) | PASS |
| `vdwLine0 = 1` hard-wired instead of `RCRCount − (scanline − 18)` | PASS |
| CR forced to 0 (background off) | PASS |
| green channel `(v>>6)&7` → `&3` (the one break that *is* caught) | FAIL |

Why: scene2/scene3 BATs are periodic with period 32 columns
(`tools/genroms.py:101`, `tile = 0x100 | (((x*7)&0x1F)+y&0x1F)`), so the picture is
identical whether the BAT is 32, 64 or 128 wide; and the Y calibration is
**the same in all 11 dumps** (`scanline` 254, `RCRCount` 237 in every `regs.json`,
so `vdwLine0` is always 1).

What this contradicts:
- `docs/EXPORT.md:176` "cover 32/64/128-wide BATs, one- and two-bank BATs" and
  `docs/PLAN.md` #5 "draws exactly what the VDC and VCE draw". Width 64/128 are
  **not exercised**. A two-bank BAT (> 8192 bytes) needs 128×64; **no scene has
  one** — all three ROMs are 40960 bytes with bank 3 `0xff`. The two-bank path
  in `pce-rom.js:173-202` and `viewer.asm:164-178` has never run.
- `docs/RENDERER.md:128` / `pce-bg.js:62,71` "self-calibrating", "nothing is
  fitted": with a constant 1 in every dump the calibration is a fitted constant
  that cannot be told from a derived one.
- `renderer-mutation.js` / `tests/README.md` list BAT width/MWR bit 6 as
  not-proven (honest), but #5's board line and `RESUME_HERE.md` say the renderer
  draws what the VDC draws, "diff 0".

Settles it: a scene whose BAT is not 32-periodic at widths 64 and 128, one with
MWR bit 6 set (also a 128×64 two-bank export), and a capture saved at a different
scanline. Then rerun the mutants above and require each to be DETECTED. This is
the "no scene uses a 64-row BAT" note from #5's acceptance, plus more.

### 2. `pce-bg.js` has a wrong BAT row stride for MWR SCREEN code 3  (#5)

`renderer/pce-bg.js:55` `shift = 5 + ((mwr >> 4) & 3)`. Measured:
`batGeometry(0x30)` → width 128, **shift 8**; `batGeometry(0x70)` → shift 8.
The VDC manual's SCREEN table (`HuC6270 VDC Manual…txt`, MWR R09 section, page
H7-8/H7-9) lists code `011` as 128×32 and `111` as 128×64, same as `010`/`110`,
so the stride must be 128 words (shift 7). The doc says "2/3: 128"
(`RENDERER.md:26`) and `pce-rom.js:65` / `viewer.asm` use the right table, so
the renderer disagrees with the exporter for MWR `0x30`/`0x70`. Not hit by any
scene (which is why finding 1 matters). Settles it: a test with MWR=0x30.

### 3. The CG-bit claim is wrong, and the data contradicts it  (#5)

`docs/RENDERER.md:55-56` and `:70-71`, `tools/genroms.py:45-49`: "The CG bit
(bit 8 …) is a no-op for RGB output", set "on three displayed entries (scene 1
only) … to prove it". But the same document defines G as bits 6–8, so bit 8 is
the **top bit of green**, and `pce-bg.js:43` uses it. The VCE manual says the
table is "512 addresses × 9 bits … each 3 bits shared for G, R and B"
(`HuC6260 VCE Manual…txt`, section 2.2.2) — there is no separate CG bit. Also
`pce-bg.js:14` says "bit 8+ ignored" while the same line says G=6–8. Also
measured: `cram.bin` for scene1, 2 and 3 has the same md5, and
**many** entries (not three, not scene 1 only) have bit 8 set
(`i*7 & 0x1FF` yields bit 8 for about half). Bits 9+ of the 16-bit word are never
non-zero in any dump, so "ignored" is untested. Masking bit 8 out of green is the
one mutant check.js catches — the opposite of "no-op". Settles it: delete the
claim; if "bits above 8 are ignored" is wanted, add a dump with them set.

### 4. `us1` is in the "11 dumps diff 0" count but is not a picture  (#25, #5)

`tests/dumps/us1/regs.json`: `CR`=0, every VDC register 0, VRAM all
zero (measured: 0 non-zero bytes of 65536), cram has 2 distinct values. `check.js` lists `us1: OK (256x232, diff 0)`
because a zero VRAM through `CRAM[0]` = `0x1FF` draws a white frame, and the
renderer **ignores CR** (finding 1: CR forced to 0 still passes). `RESUME_HERE.md`
and `tests/README.md` count it ("11 dumps"). It is Mednafen *failing* to run the
image, scored as a pass. Settles it: exclude `us1` from `check.js` or assert
`CR&0x80`, and say 10 dumps, not 11.

Related: `viewer1-3`/`browser1-3` are the *same* picture as `scene1-3` by
construction, so "11 dumps" is 4 distinct pictures (scene1, scene2, scene3,
painted). Every number says "11".

### 5. Nothing has run on hardware, and the phase title promises it  (#8, #25; phase "A picture on a real PC Engine")

#8 and #25 are `[?]`/`[~]` for photos that do not exist; `docs/` has none
(only `hello-mednafen.png`). Everything "proven" is Mednafen, so the oracle for
the renderer *and* the viewer is one emulator. That is disclosed in
`EXPORT.md:173` and `DECISIONS.md` ("manuals and a real console decide"), but
the claims travel without it: PLAN #9 "closed", `RESUME_HERE.md` "#9 is done",
"#10 is done". What stands: **the chain works in Mednafen 1.32.1.**
Settles it: the Tang Nano photo; a second emulator (ares/Geargrafx per
`DECISIONS.md`) is cheap and nobody has run one on any dump.

### 6. The US-HuCard premise is unsourced and written down three ways  (#25)

`DECISIONS.md:13` states "the TurboGrafx's reversed data lines" as fact;
`pce-rom.js:84-91` says "the card's rule … no source in this repo confirms";
`PLAN.md` #25 says "UNVERIFIED PREMISE (reasoning, not read)"; `SPEC.md:54`
lists a "bit-reversed image for a TurboGrafx" as a deliverable. A reader of
`DECISIONS.md` alone gets the strongest wording. `check-us-card.js` proves the
code does what the code says (a table vs an independent bit loop), which cannot
test the premise. The repo cites Mednafen `huc.cpp` behaviour ("has no US mode")
from a source tree that is not here. Settles it: a TG-16 photo, or a cited
public source for the pinout, and one wording everywhere.

### 7. `pce-rom.js` can emit a silently wrong ROM; docs say it refuses  (#9)

`docs/EXPORT.md:56` "throws rather than writing a ROM the layout cannot hold".
Measured: regions `[[0x7FF,2],[0x40,1]]` (dest 0x7FF0, 32 words, runs past
32768 words) builds without error. `vram.slice` truncates the first region to 16
words, the descriptor says 32, so the second region's bytes are read as the first
region's tail. Also accepted without complaint: `MWR=0xFF` (SM/VM/CM bits),
regions overlapping each other or the BAT (`ROM_LAYOUT.md:109` says the viewer
does not check, and neither does the builder), BAT/CR not matching. Only the
`dest >= 32768` start is handled and tested. Settles it: a straddling-region case
that throws, in `check-export.js`.

### 8. The editor preview is not the console's picture  (#10)

`docs/EDITOR.md:167-170`, `check-editor.js:340-352`, `pce-editor.js:386-400`:
the preview renders from VDW line 0; Mednafen's crop starts one line in, so the
capture shows picture rows 1–232 and **row 0 of the painted picture never
appears** in the capture. The test asserts "preview == capture shifted one row",
which makes the shift a pass condition. Which line a real console shows first is
not measured here; the doc says "Mednafen's crop, not a hardware fact" and that
is right — but then "what you paint is what the console shows" (`EDITOR.md`
close condition) is not established for the top row, and `check-editor.js`
passing means the painted ROM matches *its own VRAM*, not the preview. Settles
it: a hardware photo, or at least stating which row the studio guarantees.

### 9. The citations cannot be opened from the repo  (asked for by #5's acceptance)

- Hudson manuals are cited by title only, and the title is elided:
  `RENDERER.md:28` "`HuC6270 VDC Manual …`", no page or section number.
  The manuals exist at `/Volumes/External/MiniST_Project/PCEHeroTN/docs/datasheets/text/`
  (outside this repo; I could read them on this Mac). Page labels *are* in the
  text (`H7-8` is the MWR page, `H6-4` the colour table) and none are cited.
  I confirmed against it: bit 6 = 64 rows (SCREEN table), 9-bit GRB colour.
  Not confirmed: the `ch >= 0x800` behaviour (`RENDERER.md:36-38`, attributed to
  "VDC manual" but the only named source is Mednafen); I found nothing in the
  manual text I searched that says writes are dropped and a zero tile is read.
  That is *emulator* behaviour attributed to the manual.
- Mednafen is cited by function and line (`src/mednafen.cpp:2047`,
  `vdc.cpp FixTileCache`, `HDS_PART2`) — the source is not in the repo.
  `RENDERER.md` "Source: …" lines are unverifiable by a reader without 1.32.1's
  source tree.
- HuDK (MIT) adapted in `tools/viewer.asm` is cited by file, not vendored; the
  `include/vdc.s bat_width_array` claim is checkable only by cloning it.
Settles it: page numbers in each "Source:", the manuals' path as a stated
dependency, and a pinned HuDK/Mednafen commit.

### 10. Numbers that disagree, and a stale line  (#5, #9)

- `renderer/pce-bg.js:12` "vram: 131072 bytes = 65536 words" and
  `pce-rom.js:14` the same; the dumps are **65536 bytes** (32768 words), and
  `pce-rom.js:133` requires 65536. `pce-bg.js` happens to tolerate either.
- `pce-rom.js:27` "4 + ceil(tiles / 8 KiB)" vs the code
  (`Math.max(1, …)` at `:174`) and `ROM_LAYOUT.md:10`'s `4 + max(1, …)`.
- `RESUME_HERE.md:8` "This project is new. Nothing is built and nothing is
  proven." sits at the top, "Read these first — they do not decay", above
  claims of #5–#10 done. Stale.
- `docs/EXPORT.md:66` "Measured … PCEAS 3.23": rebuildable only with PCEAS; see
  finding 11.

### 11. `tools/gen/` is gitignored, and the strongest test depends on it  (#9)

`check-export.js`'s "byte-for-byte equal to PCEAS" compares against
`tools/gen/viewerN.pce`, built locally with an uncommitted PCEAS
(`~/.local/bin/pceas`, 52a556a). The repo carries the builder it checks
(`pce-rom.js`) but not the reference, so a fresh clone gets "missing … run make"
rather than the proof. The "PCEAS-equal" claim is also two builders written by one
author agreeing on one layout; it shows they agree, not that the layout is
right. What shows it is right is the Mednafen run — good evidence for one
emulator. `renderer/viewer-bank0.bin` is committed and is the only PCEAS output in
the browser path; a stale one is caught only if `tools/gen` was rebuilt.
`make -C tools -n` says up to date here. Settles it: commit
the three reference `.pce` hashes (they are already in `EXPORT.md`: make the test
check those too) so the test runs without PCEAS.

### 12. Smaller things

- Calibration cross-check `BG_YMoo − BYR = RCRCount − 1` is printed by
  `mcs-extract.py`, not asserted by any test.
- `movframes.py` de-scales by taking every 4th column; the doc says the source
  replicates 4×. I did not see a check that the other 3 columns agree (see "could
  not check").
- `renderer-mutation.js` was modified by @design under #10 (PLAN note, restrict
  to sceneN dumps). It passes. It still has 2 mutants; finding 1 shows how
  many are missing. Tests README says so ("two mutations … do not enumerate").
- Test files that close their own cards (`check.js`, `check-viewer.js`,
  `check-export.js`, `check-us-card.js`, `check-editor.js`) were written by the
  same seat that wrote the code under test. Each one says it is "flagged for
  @review"; this is that read. `check-editor.js:131-147`'s `modelFrame` decodes
  CRAM with the same `36*((c>>3)&7)` formulas as `pce-bg.js`, so "two paths"
  share the colour decode.
- The `tools/capture.sh` route ends with SIGINT and an autosave; frame and state
  come from different instants (last movie frame vs state at shutdown). Fine for
  a static picture, wrong for any raster effect (Phase 2) — worth a line in
  `RENDERER.md` before #15.
- `index.html:111` fetches `../tools/gen/viewerN.pce`; the page degrades with a
  message (documented there).

---

## What I could not check, and why

- **Hardware**: no PC Engine, TurboGrafx or Tang Nano here; no photos exist.
- **Mednafen source**: not in the repo or on this machine that I found; every
  "Source: Mednafen … line" is unverified by me.
- **HuDK**: not present; the MIT-adaptation claim and the `vdc.s` tables I
  could not diff.
- **The pages' UI**: `renderer/index.html`/`editor.html` mouse and download
  handlers. The repo says it never ran them (no synthetic input, correct); I did
  not run headless Chrome either (it would open a server and a browser; I kept to
  command-line Node). The headless `--dump-dom` outputs quoted in `EXPORT.md` and
  `EDITOR.md` are unreproduced by me.
- **Re-capturing in Mednafen**: I did not rerun `capture.sh` (it kills any running
  Mednafen and uses the Mac's display session); I read the committed dumps only.
  So I did not test whether the dumps reproduce.
- **`viewer.asm`/6280 code**: read the MWR→word-count table location only; I did
  not step through the assembly.
- **The "120 distinct colours" and "59,392 pixels (252,252,252)"** for `us1`:
  consistent with `us1/regs.json` and `cram.bin` (2 distinct values), but I did
  not independently count PNG pixels.
- **`pce-editor.js` (692 lines)**: I read its constants, `viewRegs`, the refusal
  table in `EDITOR.md` and ran `check-editor.js`; I did not audit every refusal
  path or the demo painter.
- **`genroms.py`/`genviewer.py`/`mcs-extract.py`**: skimmed for the claims above,
  not line-audited.

## Verdict per card

| card | what stands | what does not |
|---|---|---|
| #5 | renderer matches Mednafen on 32-wide, 32-row, unscrolled/scrolled pictures | BAT width 64/128, MWR bit 6, SCREEN code 3, calibration generality, "CG bit", ≥0x800 as manual fact |
| #6 | the two named breaks are caught, and the checker can be blinded | 2 mutants prove little; 8+ others pass (finding 1) |
| #7 | hello.pce red screen in Mednafen | (not probed beyond reading) |
| #8 | Mednafen viewer frame == renderer on 3 scenes | hardware; 2-bank BAT; 128×64 |
| #9 | browser == PCEAS for 3 scenes; Mednafen runs the browser's ROM | straddling regions, overlap, MWR validation, 2-bank BAT; reference not in repo |
| #10 | editor refuses what its table lists; painted ROM runs in Mednafen with the editor's VRAM | the top row; the page's mouse/download paths; "what you see is what the console shows" |
