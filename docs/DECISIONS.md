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


## 2026-10-28 — the viewer's raster handler is dispatched per STEP, and its write bytes are prepared in the tail (#69)

The #16 chain (above) dispatched plain vs frame-counter handlers once per
table from a RAM patch.  #69 measured that a two-colour-word step could not
land both writes in the blank either way: counted with the HuC6280's own
opcode timings (Software Manual S8-17ff: memory instructions cost one cycle
more than the 6502 numbers the #16 comments used), `irq1_frm`'s second store
completed at ~139 CPU cycles and landed 24 pixels into the line — and
`irq1_plain`'s at ~119, 14 pixels in, which no shipped fixture showed because
`r7`'s second word paints the right half.  The alternatives:

- **Share one counter add** (the card's first suggestion).  Rejected on
  arithmetic: the add is 10 cycles a word and the step is ~30 cycles over;
  removing it entirely still leaves the step late.
- **Fewer writes** (skip the CTA high-byte store when it is 0).  Rejected:
  it needs a new table flag and a second handler pair, and even then the
  eight port stores plus eight loads are ~72 cycles — the budget, not a
  margin.
- **Chosen: prepare the next step's bytes after the interrupt's stores**
  (`prestep`, in the idle ~250 cycles a line leaves) and dispatch per step
  through the RAM vector `$2240`: a colour-only step runs a straight-line
  stub whose second store completes at ~72 cycles (~78 with the vector's
  jump), in the blank.  The op-bit
  walker stays for steps that mix a VDC register with colour writes; such a
  step needs ~120 cycles at any stride and cannot fit — a new card if the
  editor ever offers one.

Evidence: tests/dumps/raster12 + vraster12 (the second colour word paints the
cell the line's first pixels use) diff 0 in check.js/check-viewer.js with the
new handler, 6,287 differing bytes with the pre-#69 one; all eleven vraster
frames re-captured on the new bank 0 (nine byte-identical, the two counter
tables differing only by the frame-counter phase).

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

## 2026-10-28 — the VCE's three dot clocks are modelled; `$0400` bit 2 is NOT PROVEN (card #27)

The renderer now follows the VCE's dot clock for the frame's width. **Why the card split here:** the renderer half
is a model question settled by the manuals and two captures; making the viewer, the browser export and the editor
write and preview wide pictures is a second, larger change on the same registers, so it is **card #70**.

- **Three clocks, not four.** HuC6260 manual 2.1.1 H6-3 gives CR "00" = /4 (5.37 MHz) and "01" = /3 (7.16 MHz).
  The 10.74 MHz clock is **not in the scanned page**; MacDonald's measured notes (pcetech §6: D1 = 1 = 10 MHz)
  give it, and both Mednafen cores implement exactly that (`pce/vce.cpp` ratios `{4,3,2,2}`; `pce_fast/vdc.cpp`
  bit 1 forces 2) — codes 10 and 11 are the same clock.
- **The frames are 256 / 341 / 512 dots**, with a line of 341 / 455 / 682 dots (Mednafen `ClockPixelWidths`; a
  line is 2730 master clocks at 42.95 MHz). Mednafen records the VCE's active window with horizontal overscan
  off (`pce.h_overscan` default 0, which `capture.sh` keeps), so a 336-dot display sits in a 341-dot frame with 2
  dots of border left and 3 right. MacDonald's §9 table gives the matching registers: HDS 2/4/11, HDW $1F/$29/$3F.
- **The sprite-per-line limit does not move with the clock**: 16 buffer entries, 32-px sprites take two (manual
  2.4.3; pcetech's SAT-parsing paragraph). Wide mode buys dots, not sprites.
- **`$0400` bit 2 — settled as NOT PROVEN.** Mednafen's VCE code implements it as the 262/263-line select
  (263 lines with it set). MacDonald, measuring a console, saw **edge blur** and states the frame is **263 lines
  fixed**; VIDEO_MODES.md (PCEHeroTN's RTL, not a measurement) says 262/263. **No source measured bit 2 on real
  hardware**, so the model does not use it — a static picture's frame length does not enter the renderer — and
  every ROM keeps the bit set, as every earlier capture did, because #5's row calibration was taken on 263-line
  frames. Where the question belongs if it ever matters: a real-console or logic-analyser measurement.

## 2026-10-28 — The studio looks as much as possible like ppu.toys (Dennis)

Dennis: "look as much as possible to ppu toys". The studio page (#75) follows ppu.toys' Studio closely in
layout, panels, workflow, keyboard shortcuts and how examples and docs sit beside the code, so someone who knows
ppu.toys feels at home. What stays ours: the code, the CSS and every asset (the hosted Studio is not in the MIT
repo, so its files are not ours to copy), the name and the PC Engine content. Its author has blessed the idea;
Dennis may tell him the studio deliberately mirrors his layout.

**Update, same day (Dennis):** "we can take whatever from their website if needed, they are fine with that." So
the Studio's own files (layout, CSS, icons, UI code) may be taken and adapted where that is quicker than
rebuilding them, with credit to ppu.toys / Liora Labs kept next to what is taken (a comment in the file and a line
in the README). Their written OK is Dennis's to keep; the files taken are listed in docs/STUDIO.md.

## 2026-10-28 — The studio copies ppu.toys' functions (Dennis)

Dennis, after seeing the first studio: "looks good, try to copy all the functions from ppu where possible and add
our own or change for our own where needed". Target: **feature parity with ppu.toys' Studio**, function by
function from docs/STUDIO.md: what has a PC Engine counterpart is built (taken from their site where quicker,
with credit), what the PC Engine lacks (Compose, Windows) is replaced by the PCE's own thing or marked "no
counterpart" with the reason, and PCE-only functions are added (RCR scanlines, the VCE's 512 colours, the
wide modes, the CONSOLE budget).

## 2026-10-29 — PCEStudio is GPL-3.0-or-later (Dennis)

`renderer/pce-psg.js` turned out to be a line-level transcription of Mednafen's PSG core (GPL-2.0-or-later) and
Blip_Buffer (LGPL-2.1-or-later) — against the 2026-10-27 "no emulator code copied" rule, and already public on
pcestudio.terracides.com without a notice. Options put to Dennis: GPL, rewrite from MAME's BSD c6280, or take the
site down. Dennis: "make it GPL 3". Both sources say "or any later version", so GPL-3.0-or-later is allowed.
`LICENSE` is the GPL-3.0 text, README says what is under it and what keeps its own licence, `pce-psg.js` carries
the notice and the credit. The rule stands for new code: an emulator is looked at, not copied, unless Dennis
decides otherwise for that file.

## 2026-10-29 — Export to ROM works in the browser, nothing to install (Dennis)

Dennis: "it's not needed to install compilers and stuff. It needs to work from the browser." The proven
IL -> C -> llvm-mos route (#31) needs a 700 MB native toolchain, so it stays the reference and the measuring stick,
not the export. The browser export takes two routes, both pure JavaScript:
1. **First: an IL interpreter in the ROM** (turboxray's approach, idea #66): a fixed HuC6280 interpreter built once
   by us (committed as a binary, as `viewer-bank0.bin` is) plus the toy's IL as compact bytecode and its assets,
   glued together in the browser the way `pce-rom.js` already builds picture ROMs. raster() keeps #31C's
   table-and-replay handler. Fast to build; slower on the console — measured against llvm-mos.
2. **Then: a direct IL -> HuC6280 code generator in JavaScript** for speed, compared against llvm-mos's numbers.
The validator (#32) predicts each route's frame time so the studio can say which one a toy needs.

## 2026-10-29 — Demo artwork: on the website, never in the repo (Dennis)

Dennis, on the demo art packs (#125 CITY, #126 TRAPMOOR, #127 CAVE, #128 OAK WOODS, #130 MINE): "About the
artwork don't put it on the repo but it's fine as demo on the website in PCE Studio."
So neither the raw packs nor anything converted from them (tiles, palettes, frame strips, dumps, ROMs) is
committed. The art lives beside the repo in `/Volumes/External/agent-workshop-demo/demo-art/<toy>/`; the toy's
Lua may be committed; `tools/deploy.sh` uploads the art with the toy so the demo plays on the site; tests that
need the art skip with a message when it is missing, so a fresh clone stays green. This unblocks #126 (no licence
text in the pack) and #130 (its licence forbids redistribution) — @workshop pointed out to Dennis on 2026-10-29 that
showing the art on a public site is still a form of redistribution of the pack.

## 2026-10-29 — The repo opens tomorrow (Dennis)

Dennis, asked why the MCP server ships as a zip: "no we'll open the repo tomorrow". So on 2026-10-30
terracide303/PCEStudio becomes public; the guide can then say "clone the repo" for Claude Code users (the #142 zip
stays built, unused until Dennis says). Opening it is Dennis's action, not a seat's. Card #146 lists what must be
settled first — among them this log's own 2026-10-28 condition on vendor/huc.

## 2026-10-29 — The public repo leaves vendor/huc out (Dennis)

After `docs/PUBLIC-CHECK.md` F1 (HuC has no statable licence and carries commercial material: a System Card IPL
fragment, Legend of Xanadu 2 art, Bonk sprites, Sherlock Holmes CD data), @workshop proposed: the public repo is
a filtered copy whose history has no `vendor/huc`, and `tools/build-huc.sh` downloads HuC itself when someone wants
the HuC comparison. Dennis: "yes make it so". The private repo keeps `vendor/huc` untouched (nothing is deleted);
it just stops being read. Author emails (F2) are not rewritten — not decided. Publishing stays Dennis's action. Card #152.

## 2026-10-29 — Public now, as PCEStudio-public, without the hotmail address (Dennis)

Dennis: "remove my hotmail adres. put the repo online als public it does not matter". Done by @workshop the same
evening: **github.com/terracide303/PCEStudio-public** is a filtered copy of this repo's main — no `vendor/huc` in any
commit (the 2026-10-29 HuC decision), the leaked OAK WOODS art blob `17cb916` (c9449fb's `--with-demo-art`
gallery) stripped, and `99736355+terracide303@users.noreply.github.com` replaced by the GitHub no-reply address in authors, committers,
messages and file contents. This private repo stays the working repo, untouched in history; from now on its git
config commits as the no-reply address. `/Volumes/External/agent-tmp/publish-public.sh` refreshes the public copy
(same filter every run, so it is a fast-forward; it refuses to push if any check fails). Issues are filed there
(forms: bug report, idea, share a toy), described in `renderer/testers.html`.
