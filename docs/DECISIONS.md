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
