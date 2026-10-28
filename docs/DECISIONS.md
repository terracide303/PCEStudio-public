# Decisions

**Dated, with the reason. A decision without its reason gets re-litigated.**
Record reversals too — they are the most useful kind of entry.

## 2026-10-27 — project started
Kind: software. Nothing else decided yet.

## 2026-10-27 — what PCEStudio is (Dennis)

"Like ppu.toys, an AI dev studio that can port to a real PC Engine / TurboGrafx." So: pictures (and later effects)
made in the browser strictly by the HuC6270/HuC6260 rules; an AI that helps make them (#24); and an export that
runs on real hardware, Japanese and American (#25 for the TurboGrafx's reversed data lines).

## 2026-10-27 — our own hardware model; open-source emulators are references (Dennis)

The VDC, VCE and PSG model in the browser is **our own**, built from the Hudson manuals and what PCEHeroTN taught
us about the real chips: it can say exactly why something will or will not work on a real console, which is the
point of the studio. The open-source emulators (Mednafen, Geargrafx and others) are **references and checks**:
compare pixel for pixel and by ear, look up behaviour. Their code is not built into PCEStudio, so its licence stays
ours. Where the model and an emulator disagree, the manuals and a real console decide.

## 2026-10-27 — DeepSeek first; Claude sparingly until Saturday 2026-10-31 (Dennis)

Work autonomously. **Claude's credits are low until Saturday 2026-10-31**: build cards go to DeepSeek (`ds-pro` for
the hardware model and the 6280 viewer, `ds-flash` for the rest); Claude seats only for what DeepSeek cannot do,
for review (a different AI than the builder), and for an escalation after DeepSeek failed a card twice. Workshop
keeps its own sessions short. **DeepSeek is prepaid**: check `../workshop/agents.py balance` before a run; when it
is empty, stop and tell Dennis, who tops it up.

## 2026-10-27 — Claude is the project manager (Dennis)

@workshop runs on Claude and manages PCEStudio as autonomously as possible: it routes cards, starts and follows the
DeepSeek seats, checks their evidence, closes or escalates cards, and goes straight on to the next card without
waiting for Dennis. Its own Claude use is the main Claude spend until Saturday, so it waits on agents with
`agents.py wait` (no polling), reads logs only when a card fails, and keeps messages to Dennis to a line.

## 2026-10-27 — the emulator reference/check set is named (survey #1)

This refines the 2026-10-27 "our own hardware model; open-source emulators are references" decision; it does not
change it. The set:
- **Mednafen 1.32.1** (GPL-2.0, installed on this Mac) — the primary pixel/audio check. Its PCE VDC is clock-level
  (`mednafen/hw_video/huc6270/vdc.cpp`, `VDC::Run` with SAT DMA and sprite fetch). Native 256×224 output with no
  scaler/filter is the capture format for pixel diffs.
- **ares** (ISC for ares proper; `LICENSE` also bundles third-party terms) — the independent second opinion when
  Mednafen and our model disagree. Its PCE `vdp` path is cycle-level (`hclock()`/`vclock()`); no PCE-specific video
  golden tests were found, so it is a cross-check, not the oracle.
- **Geargrafx** (GPL-3.0) — the interactive debugger: CPU/VRAM/VDC/VCE/PSG viewers, PCEAS symbol files, MCP-driven
  runs. Its test suite is the SingleStepTests 65x02 CPU set with 48 excluded opcodes; no video goldens. Use it to see
  why a ROM differs, not to decide the pixel truth.
- **Mesen2** (GPL-3.0) — fallback third opinion only; I found no independent PCE video accuracy evidence for
  its PCE core.

None of their code is copied, linked, or built into PCEStudio. This matters for licence as well as policy: linking
GPL-2.0/3.0 code would make PCEStudio GPL, and ISC code still violates the "our own model" decision. Where the model
and an emulator disagree, the Hudson manuals and a real console decide. Details: `docs/SURVEY.md`.

## 2026-10-27 — PCEAS is used as an external build tool, not vendored (survey #1)

PCEAS (MagicKit/HuC) is the PCE-native assembler and the one the working examples use (HuDK, HuC's own examples).
Its licence is not clean: `uli/huc`'s `LICENSE` says MagicKit is freeware, Ulrich Hecht's changes are BSD-3, TGEmu
and parts of the test suite are GPL, and the C compiler and assembler derive from early-1980s code with unclear
terms (`NOASSERTION` is correct). Decision: **use PCEAS as an external build tool** — install it from upstream, do
not vendor its source or binaries in PCEStudio, and keep the HuC C runtime out of the viewer ROM. The ROM is our
code plus MIT HuDK code. If that caveat becomes unacceptable, `cc65`/`ca65` (zlib) assembles HuC6280
(`--cpu huc6280`) and is the clean fallback, at the cost of writing our own PCE bank/linker setup and dropping
PCEAS's PCX directives.


## 2026-10-28 — Hardware checks wait for Dennis; Opus cards get one DeepSeek trial (Dennis)

- **Hardware.** Dennis has a real PC Engine with an AliExpress flash cart that runs both Japanese and US images, a
  MiSTer, and the Tang Nano — no TurboGrafx-16. #25 is closed as *not proven on hardware*. #8's photo is parked for
  him to do later ("keep this test for me for later"); any of the three machines may supply it, the real PC Engine
  first. Until then a second emulator (ares) stands in as the extra check.
- **Cards routed to #opus.** Claude stays scarce. Each Opus card is first tried on DeepSeek (ds-pro) with a small
  budget. If DeepSeek fails it twice, the card is **parked**, not escalated to Claude — "there is no super hurry in
  this project"; other cards go first.

## 2026-10-28 — ares v148 is the second emulator, and it agrees with Mednafen and the renderer (card #41)

Refines the 2026-10-27 "our own hardware model; open-source emulators are references" decision; it does not change
it. **ares is a cross-check, not the oracle**: the Hudson manuals and real hardware still decide.

- **Method.** ares v148 loaded `viewer1/2/3.pce` and `painted.pce` and each frame was captured without synthetic
  input (`screencapture -l` of the ares window; the window id comes from a read-only CGWindowList query). Settings,
  geometry and method: [`ARES.md`](ARES.md). Reproduce with `tools/capture-ares.sh all`; verify with
  `node tests/check-ares.js`.
- **Result.** All four frames are 0/59392 pixels different from the renderer (and from Mednafen) at the 3-bit colour
  index, on the 232-line Mednafen window; the 256x224 card crop is 0/57344. So ares shows the same picture as
  Mednafen and the model.
- **The one raw difference is the 8-bit DAC scale.** ares: `round(255·n/7)` = 0, 36, 73, 109, 146, 182, 219, 255;
  Mednafen and `pce-bg.js`: `36·n` = 0, 36, 72, 108, 144, 180, 216, 252. It is the same 3-bit colour. The HuC6260
  manual fixes the colour word — 2.1.2 (3) CTW **p. H6-3** (G 8-6, R 5-3, B 2-0), Fig. 2-2-1 **p. H6-4**, 2.2.2
  **p. H6-5** — but the RGB-output section 2.4 **p. H6-6** is missing from the scanned manual (7 pages, ending at
  H6-5), so the manual does **not** settle the 8-bit scale. Real hardware (#8) or a scan of H6-6 does.
- **viewer2 colours.** ares gives cyan `(0,219,219)` and blue `(0,0,219)` for the same 1664 + 1664 pixels where
  Mednafen gives `(0,216,216)` / `(0,0,216)` — the same 3-bit `(0,6,6)` / `(0,0,6)`. The manual's G/R/B bit order
  (p. H6-3) says Mednafen and ares are right, so the web emulator's mint green/purple is a channel-order error.
- **Not proven.** ares's DAC scale; that ares and the renderer are both right rather than wrong together; real
  hardware; the sprite scenes; and a cold break of the ares check by a second seat (our own one-pixel break is
  recorded in `ARES.md`).

## 2026-10-28 — ppu.toys: its code may be used, with credit (Dennis)

SPEC.md and SURVEY.md said "nothing of ppu.toys is used — no code, text or design" and gave it as Dennis's rule.
**He never said it** (Dennis, 2026-10-28: "I have never said we can not use code from ppu toys"); it was written in
by Claude on 2026-10-27 and both files are corrected. ppu.toys is MIT (Liora Labs): its ideas **and its code** may be
used where they fit, with the licence notice kept and credit given. Card #53 studies how it builds its toy runtime,
validator, CLI and agent link, and says what is worth reusing for Phases 3 and 5, including whether its Rust code
is worth taking over as-is (PCEStudio itself is JavaScript in the browser, Python tools and PCEAS assembly).

## 2026-10-28 — Saves are passwords; pads are 2-button (Dennis)

docs/MANUALS.md found two promises in SPEC.md the hardware set does not keep (GAP 5, GAP 10):
- **Saves:** a bare HuCard has no save memory; the 2 KB backup RAM is the CD unit's (or a Tennokoe's). Dennis: "we
  can do saves as passwords". Toys get a password helper (state packed into a short code shown on screen and typed
  back) instead of `bram`.
- **6-button pad:** no manual here documents it, and Dennis notes it was used for Street Fighter II on the PC Engine
  and little else. Left out: pads are 2-button (I, II, Select, Run), up to five with the multitap.

## 2026-10-28 — Two emulators are enough for a static picture (Dennis)

#8 closes on Mednafen and ares agreeing pixel for pixel; no real-console photo ("it's ok in 2 emulators, I'm sure
it will run on the PCE"). A real console is asked for once, when the scanline effects (#16) run, since per-line
timing is where emulators and hardware most often differ.

## 2026-10-28 — HuC is vendored, licence later (Dennis)

Dennis: "just copy it inside, we'll fix licences later". The maintained HuC (pce-devel/huc, commit in
`vendor/huc/VENDORED.md`) is now in `vendor/huc/`, unchanged, minus `pic/` (commercial game screenshots). This
replaces the 2026-10-27 rule that PCEAS stays an external tool. PCEStudio is **private**; before it is ever made
public the HuC copy needs a settled licence or must be removed with its history. #54 builds PCEAS from this copy;
#31 weighs compiling toys through HuC's C compiler.

## 2026-10-28 — the #16 viewer's raster chain: parallel arrays, not a record walker

The #16 table (per-scanline VDC/VCE writes run from the viewer's RCR interrupt) is stored as **16 parallel
per-step arrays** in a fixed 3856-byte image at bank 1 offset `$640`, copied to RAM `$2800` (the layout:
[`ROM_LAYOUT.md`](ROM_LAYOUT.md); the #15 scene ROMs' proven r_step/r_chain pattern is its ancestor).  The
alternatives were tried and rejected on the HBlank budget, which the Mednafen 1.32.1 phase machine fixes
(`vdc.cpp` `IncRCR`/`Run`; [`MANUALS.md`](MANUALS.md) §16):

- **A record walker** (one header per step: op byte, chain word, then the values the op names — the scene ROMs'
  shape).  Rejected: chasing the variable-length payload costs an indirect walk per value, and the worst step (all
  op bits, two colour-table writes) measures over the ~111-cycle BXR-latch budget — the interrupt fires only ~4
  VDC masters before HBlank's end, so the budget is the distance to the *latches*, not to the line's end.
- **A dispatch table of eight op-shaped handlers.**  Rejected for size: eight handlers × the boot-time table copy
  bloats bank 0 past its fixed contract, and the per-handler duplication is what the op-byte mask avoids.
- **Page-aligned value arrays** (so a step's lo/hi pair never crosses a page).  Rejected: 224 bytes of padding per
  array would not fit bank 1 beside the SAT.  The arrays are **packed** (240 bytes apart, `r_chain_lo` alone
  page-aligned via a 12-byte pad): crossing a page costs one extra cycle on the affected reads, and the measured
  worst step (~108 cycles) stays inside the budget.

Two handler variants (plain / frame-counter) are dispatched through a RAM patch (`$2020`, the irq1 vector's cell)
instead of one handler testing the flag per interrupt: the flag test costs cycles on **every** step, the patch
costs once at boot.  No `pha/phx/phy` in the handler: the main loop is `bra loop` and touches nothing the handler
uses, so there is nothing to save — and the saves are 9 of the cycles the budget was short by.  Entry lines run
0–240 (`rcr = 0x40 + line`; line 0 fires as VDW starts, line 240 in the HBlank after the last display line); the
step cell `< $30` and frame counter `< $31` keep the #15 scene ROMs' contract that `tools/raster-patch.py` reads
back.


## 2026-10-28 — Music is made in a tracker: Furnace (Dennis)

Dennis: "a tracker, use the best one". The pick is **Furnace** (github.com/tildearrow/furnace): free and open,
actively developed (last push 2026-10-27), supports the PC Engine's PSG including noise and DDA samples, and its
`.fur` format is documented. DefleMask, the other PCE tracker, is closed and paid. Furnace stays the user's own
program; PCEStudio reads the songs it saves (our own reader), plays them through `renderer/pce-psg.js` in the
browser, and puts them in the exported ROM with a HuC6280 sound driver. Which driver (an existing one or our own)
is #35's first question.

## 2026-10-28 — ppu.toys' author is on board

Dennis asked a.gilbert (ppu.toys) on Discord, 2026-10-28, whether he could use the idea to make something similar
for the PC Engine. Answer: "Yes, absolutely. Let me know if there's anything I can do to help!" So besides the MIT
code (entry above), the idea itself is used with the author's blessing; credit ppu.toys and its author in the
README when PCEStudio is shown. Open questions worth asking him are kept in docs/PPU-TOYS.md, "Questions for the
author".

## 2026-10-28 — HuTrack plays the music on the console (Dennis)

The ROM's music player is **HuTrack** (github.com/Turboxray/HuTrack, MIT, active 2026-10): a compact HuC6280 driver
plus a Python converter for DefleMask DMF songs, with Furnace 0.6.8.3's DMF playback as its reference, SFX channel
hand-off, PCM samples and fades. Songs are made in Furnace and saved as DMF. The browser side is ours: a JS reader of
the same DMF that plays through `renderer/pce-psg.js` and must sound the same as HuTrack on the console (Mednafen
recording, compared numerically). HuTrack's example songs are arrangements of commercial games' music and are **not**
brought into this repo.

## 2026-10-28 — HuVGM will be supported when it is released (Dennis, to turboxray)

turboxray (author of HuTrack) asked on Discord that PCEStudio allow **HuVGM** for music and sound; Dennis said yes.
HuVGM is not public yet: turboxray plans a first release with docs and specs, plus a custom Furnace build with a
nicer VGM export (not required). Until then HuTrack stays the console player; when HuVGM is out, it becomes a
second route for songs (Furnace → VGM → HuVGM), card #65.

turboxray also described how he built shmup levels: a small **byte-interpreted script** language (VRAM events,
enemy placement and patterns, palette fades, scroll speeds) running on top of the engine, as some old RPGs did.
That is a third route for #31 next to compiling the IL: interpret IL bytecode in the ROM. It trades speed for size
and simplicity, and suits level and event scripts more than per-line raster code.

## 2026-10-28 — DeepSeek Flash first, Pro only after Flash fails (Dennis)

The day's $16 went two-thirds on four DeepSeek Pro cards with long bug hunts (#16 $4.17, #34 $2.32, #14 $1.88,
#15 $1.72) while ~20 Flash cards cost $0.03–0.15 each. From now on: a card starts on **ds-flash**; it moves to
**ds-pro** only after Flash fails it once, with a **$1.50** budget; a card that looks like #16 (a new mechanism
plus captures plus a debug hunt) is split in two before it starts. Claude stays for review and for what DeepSeek
fails twice. agents.py now stops a seat on its calibrated cost, not the undercounting live figure.
