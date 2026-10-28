# MANUALS — every manual read, every capability mapped to a card or a gap

Card #44. The hardware facts below come from the Hudson manuals in
`/Volumes/External/MiniST_Project/PCEHeroTN/docs/datasheets/`, read **in full**
(not grepped), plus six non-Hudson documents that are marked as such (the last
four were added by card #55 and read from a read-only archive outside this repo
— see §15). Nothing here is copied beyond a few quoted words with a page; the
manuals stay where they are.

| Source | Lines | Kind |
|---|---|---|
| `text/HuC62 System Outline - overview of the three chips.txt` | 203 | Hudson, scanned text |
| `text/HuC6270 VDC Manual - registers, VRAM write sequence, slots.txt` | 3,357 | Hudson, scanned text |
| `text/HuC6260 VCE Manual - 0400 physical 1FE400, dot clock select.txt` | 575 | Hudson, scanned text |
| `text/HuC6280 Hardware Manual - reset vector 1FFE, IRQ, timer, device map.txt` | 3,759 | Hudson, scanned text |
| `text/HuC6280 Software Manual - INSTRUCTION SET, TAM TMA, opcode timings.txt` | 9,989 | Hudson, scanned text |
| `text/HuC6280 PSG Manual - sound, FOR PHASE 1.6.txt` | 2,180 | Hudson, scanned text |
| `text/HuC62 Tech Notes - INIT ROUTINES, vsync, worked register sequences.txt` | 2,549 | Hudson application notes |
| `text/CD-ROM2 BIOS Manual - EX_ calls, EX_JOYSNS pad protocol - PHASE 3.txt` | 5,017 | Hudson, CD-ROM² BIOS v1.00 |
| `text/CD-ROM2 PSG Driver - PHASE 3.txt` | 3,047 | Hudson, CD PSG driver |
| `text/CD-ROM2 Software Manual - PHASE 3.txt` | 5,299 | Hudson, Hu7 CD dev tools |
| `datasheets/PC Engine memory map and MPR banking (chibiakumas, text extract).txt` | 1,381 | **not Hudson** — a web tutorial (ChibiAkumas) |
| `docs/VIDEO_MODES.md` | 74 | **not a manual** — PCEHeroTN's reading of its own VCE RTL |
| `pcetech.txt` (card #55) | 1,752 | **not Hudson** — Charles MacDonald, *TurboGrafx-16 Hardware Notes*, 2001–02, measured on a console |
| `sgxtech.txt` (card #55) | 494 | **not Hudson** — Charles MacDonald, *NEC SuperGrafx hardware notes*, 2003–04, measured on a console |
| `hes spec.txt` (card #55) | 67 | **not a manual** — Mamiya, *HES Music Format Spec* v1.00, 2000 |
| `Hu7CD_final.pdf` (card #55) | 10 pp | **not a manual** — a Hu7 CD System manual extract (Part 1 ch.1–2 and the Part 2 divider only) |

The PDFs in `datasheets/` are the same scans. They were opened only where the
`.txt` is unreadable; the places and what they settled are in §13.
`Hu7CD_final.pdf` is a separate, 10-page extract of the Hu7 CD System manual,
not one of the Hudson scans; it is covered in §15.6.

Page numbers are the manuals' own: **H7-x** HuC6270, **H6-x** HuC6260,
**H8-x** HuC6280 hardware, **S8-x** HuC6280 software, **P8-x** PSG, **H6-1…**
above are as printed. Tech Notes pages are the note's own 1–20.

---

## 1. GAP list, ranked by what SPEC.md asks for

SPEC.md's goal: pictures, effects, sound and small programs made in the browser
by the real hardware's rules, exported to run on a real PC Engine / TurboGrafx.
Each gap below has **no card in docs/PLAN.md** that covers it, and a one-line
proposed card. **14 gaps.** (`@workshop` routes them; none were added here.)

| # | Gap | Why it ranks here against SPEC | Proposed card (one line) |
|---|---|---|---|
| 1 | **The display window and the border.** No card models HSR/HDR (HDS/HDW/HDE) or VPR/VDR/VCR (VDS/VDW/VCR), and the border colour around the VDC window is never drawn. Every picture is one fixed 32×30-character window (256×240) cropped to 232 rows. | SPEC's first sentence is that a picture made here looks the same on a real console; a TV shows the window *and its border*, and 224 vs 240 lines is a choice every game makes. The width half is #27; the window/border half has nothing. | "The border and the window: model HSR/HDR/VPR/VDR/VCR and the VCE raster; the picture is the VDC window, everything else is the border colour (CRAM $100); a capture with the border in frame." |
| 2 | **VRAM→VRAM block copy.** SOUR/DESR/LENR and DCR (SI/D, DI/D) have no card; nothing builds or models a VDC-side copy. | The one hardware way to scroll a big map, double-buffer, or bleed data in during burst mode — the PCE's substitute for the SNES's DMA. Needed by #23, #29 and any animated toy. | "The VRAM copy engine: SOUR/DESR/LENR/DCR in the model and the viewer; one ROM that copies a tile block at VBlank; a capture proving the copy." |
| 3 | **Five pads and the timer.** No card reads $1000 from a HuCard or touches $1C00/$1C01; the pad protocol is in no Hudson manual (only the CD BIOS call and the web tutorial). | SPEC promises `pad[1..5]` and 2-/6-button pads as a first-class feature; a toy cannot respond to anything without this, and the timer is the only sub-frame clock. | "Five pads and the timer: the $1000 read sequence and the $1C00 timer in the viewer and the model; a toy using both; a capture from a save state with a known pad state." |
| 4 | **A ROM bigger than 80 KB.** `pce-rom.js` caps at 6 tile banks (48 KB of tiles), 8 copy regions and 2 BAT banks = 80 KB images; the hardware allows 2 MB through 256 MPR banks. | Photo import (#18) and animation (#23) are in the plan and will hit the cap; the cap is ours, not the console's. | "A ROM that grows: lift the exporter's 6-tile-bank / 8-region cap to the 2 MB MPR limit; a capture of an image larger than 80 KB." |
| 5 | **Where a save lives.** SPEC's "backup RAM (2 KB)" and #30's `bram` have no hardware on a bare HuCard — the 2 KB is the CD unit's (IFU-30) RAM, reached through BIOS calls. | A Lua API that cannot work on the target platform is a promise SPEC makes and the hardware does not keep. | "Where a save lives: no backup RAM on a bare HuCard — scope `bram` to Tennokoe 2 / CD, or drop it from the toy API." |
| 6 | **The VDC's status lines.** CC (sprite #0 collision), OR (over: 17 sprites, or a pattern that did not arrive), DS/DV (transfer done), VD (VBlank) are unmodelled and no card reports them. | SPEC promises a *live* sprite budget; OR is the hardware's own "this line overflowed" signal, free to show. | "The VDC's status lines: CC/OR/DS/DV/VD in the model and the panels; a ROM that overflows a line and one where sprite #0 collides." |
| 7 | **262 or 263 lines.** CR bit 2 of the VCE is not modelled; the raster table and any frame clock assume one frame length. **§15: the measured notes say 263 lines fixed and bit 2 is edge blur — the premise of this row is contradicted (§15.3).** | RCR line numbers and a 60 Hz budget both move by a line when a game picks the other; #27 changes the width and would inherit this. | "262 or 263 lines: the VCE's frame length in the model; a 263-line capture and what it does to RCR." |
| 8 | **Reading it back.** MAAR/VRR (VRAM) and CTR (colour table) are unmodelled; nothing can import or verify a write. | The studio's VRAM map and "what is free" (#26) and any import from a running ROM need the read path, and the VDC manual gives it a page. | "Reading it back: MAAR/VRR and CTR in the model; import a dump read from a running ROM." |
| 9 | **The access-width modes.** MWR's VM (1/2/4 clocks), SM and CM (4 colours out of 256; 2-dot 4-colour sprites) are unmodelled and unmentioned by any card. | Not on SPEC's list — but it is the one VDC mode that changes the colour count, and a "real hardware rules" studio should either offer it or say why not. | "4-colour and 4-clock modes: VM/SM/CM; one ROM in 4-dot mode; a capture; or a written decision not to offer them." |
| 10 | **The 6-button pad.** SPEC says "2- or 6-button pads"; no manual in this set documents the 6-button protocol, and the tutorial's pad read is 2-button only. | A claim in the goal document with no source behind it — exactly what #44 exists to find. | "The 6-button pad: find a source for the protocol and implement it, or strike the claim from SPEC." |
| 11 | **The VDC's pin modes.** EX (external sync) and TE (DISP output select) are documented and unused; no card says whether the console ever wants them. | Low: the console runs the defaults. But it is a whole register field with no home, and a SuperGrafx or arcade-board path would need it. | "The VDC's pins: EX and TE documented in the model and marked never-used on a console — or a worked reason one is needed." |
| 12 | **SuperGrafx has no manual here.** Idea #21 (two background layers) rests on no source in this set. **§15: `sgxtech.txt` now sources it (a measured note, not a Hudson manual).** | Phase 2's "PC Engine's own tricks" would be a different console; #21 is an idea and should stay one until sourced. | "Source the SuperGrafx before #21: its second VDC/VCE and the extra RAM, with pages." |
| 13 | **The VCE's missing page.** 2.3–2.5 (sync generator, **RGB outputs**, colour-difference outputs) are listed on H6-6 and are absent from both the text and the PDF; the 8-bit output scale is therefore not settled by any manual. | #41 closed with the 3-bit colour proven and the 8-bit scale explicitly not; every exported picture's brightness rests on it. | "Settle the output scale: the missing VCE page, or a measured step from the real console." |
| 14 | **The PSG's noise generator is under-specified.** The manual gives the noise clock frequency (P8-9) but no shift-register polynomial or tap points. | #34 must match Mednafen by ear, which cannot distinguish "same noise" from "noise that sounds the same"; a studio that exports music needs the real generator. | "The noise generator: pin down the LFSR against Mednafen and the real console before #34 closes." |

§15 records what Charles MacDonald's measured notes and the rest of the archive
settle for each of these rows; the cards named above still own the work.

---

## 2. HuC62 System Outline (the three chips)

Short: what the system is, no registers. The useful bits are the division of
labour and the confirmation that the VDC's interrupt reports sprite collision,
raster position and VBlank start.

| Fact | Page | Card |
|---|---|---|
| Three ICs: HuC6280 (CPU + PSG), HuC6270 (VDC, defines the video signal), HuC6260 (VCE, makes analogue RGB and composite) | 1–2 | #1 (survey), #2 |
| Screen = background + sprites; VDC defines patterns, colour codes and positions | 2 | #5, #12 |
| VDC interrupt reports sprite collision, the target raster position, the start of vertical blanking | 2 | #15, #16; collision → **GAP 6** |
| 512 colours available; sprite and background composition; vertical/horizontal smooth scroll; sprite flip; "connect sprites" | 1 | #5, #12, #27 |
| PSG is inside the HuC6280; stereo; waveform memory; noise and LFO | 3 | #34 |

## 3. HuC6270 VDC

The whole graphics model rests here. Register list on H7-2; every function
below is also a row in #26's "all 20 registers" panel.

### 3.1 Bus and register access

| Register / rule | Page | Card |
|---|---|---|
| AR (R00, write-only) selects R00–R13; **do not use AR=04** (operation not assured) | H7-3, H7-2 | #7, #8; #26 (shows the register set) |
| SR (read at A1=0): bit 0 CC, 1 OR, 2 RR, 3 DS, 4 DV, 5 VD, 6 BSY; **auto-cleared after a read except BSY** | H7-4 | #16 (status read clears IRQ1), **GAP 6** |
| BSY set while the CPU's VRAM access is in flight; no IRQ from it; do not write CR bits 11–12 (IW) while BSY | H7-4 | #32 (value ranges/timing) — not modelled |
| MAWR (R00) / MAAR (R01): 16-bit VRAM word addresses; MAAR starts a read on its **high-byte** write and auto-increments | H7-5 | MAWR #7/#8/#14; MAAR **GAP 8** |
| VWR/VRR (R02): write/read 16-bit words; the transfer starts on the **high-byte** access; the address increments after it | H7-5 | #7, #8, #14; read side **GAP 8** |
| While VRAM is being written/read, the VCE clock division must not be changed (must not be slowed) | H7-5 | #27 (writes $0400 once at init — correct as written) |
| Register write sequence: AR, then low byte, then high byte (A1=1); status read is the low byte only (high reads $00) | H7-25 | #7, #8, #16 |
| VRAM write sequence: MAWR, then VWR low/high per word; read: MAAR, then VRR low/high per word | H7-25 | #7/#8 (writes), **GAP 8** (reads) |

### 3.2 CR (R05) — mode and interrupts

| Field | Page | Card |
|---|---|---|
| IE bits 0–3 = enable CC / OC / RC / VC interrupts | H7-6 | RC: #15, #16; the rest **GAP 6** |
| EX bits 4–5: external sync (00 = both inputs, 01 = VSYNC input, 11 = both outputs, 10 invalid) | H7-6 | **GAP 11** |
| SB bit 6: sprites on/off; takes effect from the next horizontal display period | H7-6 | #12, #13, #15 |
| BB bit 7: background on/off; takes effect from the next horizontal display period | H7-6 | #5, #8, #15 |
| SB=BB=0 starts **burst mode** next frame: the VDC stops accessing VRAM, VRAM→VRAM transfer always possible, VD0–7 = "L", SPBG = "H" (colour address $100) | H7-6 | #5 (the $100 fill, measured as scene8), **GAP 2** (the transfer half) |
| TE bits 8–9: DISP output select (display / burst position / internal HSYNC) | H7-6 | **GAP 11** |
| DR bit 10: DRAM refresh addresses only when the background access width is 2 or 4 dots | H7-6 | not used (SRAM VRAM) — record only |
| IW bits 11–12: MAWR/MAAR auto-increment +1 / +32 / +64 / +128 after each high-byte access | H7-6 | #7/#8 use +1; **GAP 4**/bulk loads would use the larger steps |

### 3.3 Scroll, window and access width

| Register / rule | Page | Card |
|---|---|---|
| RCR (R06): interrupt when the internal line counter equals it; the counter is **set to 64 on the line before display starts** and increments each scan | H7-7 | #15, #16 |
| BXR (R07): horizontal scroll, 10 bits used; a write shows from the **next scanning line** | H7-7 | #5, #15, #17 |
| BYR (R08): vertical scroll, 9 bits used; a write **during display** shows from the next line (BYR+1) | H7-7 | #5, #15, #17 |
| MWR VM (R09 bits 1–0): VRAM access width 1/2/4 clocks; takes effect at the beginning of a VBlank | H7-8 | **GAP 9** |
| MWR SM (bits 3–2): sprite-generator access width 1/2/4 clocks; same VBlank rule | H7-8 | **GAP 9** |
| 4-clock mode displays **4 of 256 colours**; sprites may not display correctly with an odd horizontal blanking period | H7-8 | **GAP 9** |
| MWR SCREEN (bits 6–4): 32×32, 64×32, 128×32 (codes 2 and 3 alike), 32×64, 64×64, 128×64 (codes 6 and 7 alike); VBlank rule | H7-8/9 | #5, #38, #39 |
| MWR CM (bit 7): selects CG0/CH0-1 or CG1/CH2-3 for 4-clock mode; next-scanning-line rule | H7-9 | **GAP 9** |
| HSR (R0A): HSW bits 0–4 = width−1 (1–32); HDS bits 8–14 = back porch−1 | H7-9 | #5 (fixed $0202), #27 (width); window → **GAP 1** |
| HDR (R0B): HDW bits 0–6 = chars−1; HDE bits 8–14 = end position−1; HSW=HDS=HDE=0 is invalid | H7-10 | #27 (width), **GAP 1** |
| VPR (R0C): VSW bits 0–4 = width−1; **VDS bits 8–15 = back porch−2** | H7-10 | **GAP 1** |
| VDR (R0D): VDW 9 bits = lines−1; valid from the start of the vertical display period | H7-10 | #5 (fixed $00EF = 240), **GAP 1** |
| VCR (R0E): 8 bits = front porch **N, not N−1**; valid from the start of the vertical front porch | H7-11 | **GAP 1** |
| Display screen is defined by HSW/HDS/HDW/HDE horizontally and VDS/VDW/VCR vertically (Fig. 2-2-1) | H7-10, H7-13 | **GAP 1** |
| Scroll: vertical line by line through BYR, horizontal dot by dot through BXR | H7-13 | #15, #17, #29 |

### 3.4 Block transfer (DMA)

| Register / rule | Page | Card |
|---|---|---|
| DCR (R0F): DSC bit 0 (SATB-done IRQ), DVC bit 1 (VRAM-done IRQ), SI/D bit 2 (source inc/dec), DI/D bit 3 (dest inc/dec), DSR bit 4 (VRAM→SATB auto-repeat) | H7-11 | DSR: #14; interrupts: **GAP 6**; SI/D, DI/D: **GAP 2** |
| SOUR (R10) / DESR (R11): 16-bit source and destination; do not update during a transfer | H7-11/12 | **GAP 2** |
| LENA/LENR (R12): length = M−1, up to 64K words; the transfer starts on the **high-byte write** | H7-12 (called LENA on H7-2, LENR on H7-12 — the manual's own inconsistency; see §8) | **GAP 2** |
| VRAM→VRAM transfer only during VBlank or burst mode; a transfer that overruns VBlank is **not** resumed next VBlank; it is cancelled when the vertical display period starts and no done status is raised | H7-12, H7-4 | **GAP 2** |
| VRAM→SATB: **256 words**, at the beginning of the next VBlank, triggered by the **high-byte write of DVSSR (R13)** | H7-12 | #14, #42 |
| The CPU cannot write the SATB; only the VRAM→SATB transfer can | H7-20 | #14 |

### 3.5 Background

| Fact | Page | Card |
|---|---|---|
| 8×8 characters; up to 4,096 definitions (64K-word VRAM — our 32K words give **2,048**); 16 of 256 colours per character (4 of 256 in 4-dot mode) | H7-13 | #10, #13 (tile-space refusals); the 2,048 limit is enforced by the VRAM size |
| BAT starts at VRAM word 0; one word per cell: 12-bit character code + 4-bit "CG COLOR" (palette) | H7-14 | #5, #10 |
| BAT row stride = screen width in cells; 32/64/128 wide, 32/64 rows | H7-14, H7-9 | #5, #38 |
| CG: 16 words per character in four 8×8 planes CH0–CH3 (CG0 = CH0+CH1, CG1 = CH2+CH3); the character's block must start at an address ending in six zero bits (`…0000` binary, i.e. 16-word aligned) | H7-15 | #5, #10, #13 |
| Display fetches two CG words for 16 colours, one word for 4 colours | H7-16/17 | #5; 4-colour → **GAP 9** |
| Video out: SPBG (VD8) = 0 for background, VD7–4 = CG COLOR, VD3–0 = CH3..CH0 | H7-18 | #5 |
| **If VD3..VD0 = 0 then VD7..VD4 = 0**, whatever the CG COLOR — a background pixel of colour 0 always addresses palette 0, colour 0 (the backdrop) | H7-18 | #5 (the `pix === 0 → 0x000` rule), #38 finding 2 |
| Blanking-period video data is SPBG=1, VD7..VD0=0 → colour address $100 | H7-18 | #5 (BB off), **GAP 1** (the border uses the same address) |

### 3.6 Sprites

| Fact | Page | Card |
|---|---|---|
| 64 sprites in the SAT; sprite priority follows SAT address (index 0 highest) | H7-19, H7-20 | #12, #13 |
| Base size 16×16; sizes to 32×64 with CGX/CGY; up to 1,024 patterns with 64K-word VRAM | H7-19, H7-24 | #12 |
| 16 of 256 colours per sprite (4 of 256 in 2-dot 4-colour mode) | H7-19 | #12; 4-colour → **GAP 9** |
| At most **16** sprites on one line; 17 or more draws the higher-priority 16 and drops the rest; OR is set on an attempt at 17 | H7-19, H7-4 | #12, #13; OR → **GAP 6** |
| The number the VDC can search is also bounded by HBlank and SM: 2(e−2), max 16 (and 2d+1 / 2d cases) | H7-19 | #12 assumes this is not binding at 256 px; not modelled as a function of HDR/HSR → **GAP 9/GAP 1** |
| SAT: 4 words per sprite, 256 words; priority by address; the CPU cannot write it | H7-20 | #14 |
| Y and X are 0–1,023; the screen's top-left corner is at SAT coordinate (32,64) | H7-21 (figure), H7-19 | #13 (Y+64, X+32), #12 |
| Pattern code: its **high-order 10 bits equal the high-order 10 bits of the VRAM address** — so a pattern lives in a 64-word cell addressed by code×64 | H7-21, H7-24 | #12, #40 |
| SPRITE COLOR = 4-bit palette | H7-21 | #12 |
| SPBG: 0 = background in front, 1 = sprite in front | H7-21 | #12 |
| X flip and Y flip | H7-22 | #12 |
| CGX: two sprites appear side by side, the one whose pattern bit 1 (PC1) is 0 on the left; X flip swaps and mirrors them | H7-22 | #12 (sprite11, #40) |
| CGY bits 13/12: 00 normal, 01 2CGY (blocks differing in PC2), 10 not used, 11 4CGY (blocks differing in PC3/PC2) | H7-23 | #12 (sprite9, #40) |
| SG: each 16×16 dot area is 16 words; one sprite needs four consecutive areas (64 words); the start must be 64-word aligned | H7-24 | #12 |
| Sprite out: SPBG=1, VD7–4 = SPRITE COLOR, VD3–0 = SG3..SG0; if VD3..0 = 0 then VD7..4 = 0 | H7-24 | #12 |
| Colour 0 of a sprite palette is "clear" (transparent) — stated in the Tech Notes, not the VDC manual: "Color 0 of all the remaining 31 blocks are always clear" | Tech Notes p.1/2; H7-24 | #12 |

**Two manual silences the tests settled, worth keeping:** (a) the manual counts
*sprites* per line, but the hardware budget is **16-pixel strips** — a 32-px
CGX sprite spends two (measured in #12/#40, sprite11); (b) the manual does not
say a sprite with SPBG=0 still shows over a background colour-0 pixel, but the
VDC's own colour-0 rule (H7-18) makes it the only sensible reading and #12
measured it.

## 4. HuC6260 VCE

| Fact | Page | Card |
|---|---|---|
| 512 addresses × 9 bits of colour; two 256-address areas (background 0–255, sprites 256–511), each 16 blocks of 16 | H6-1, H6-4, H6-5 | #10, #12, #18 |
| Colour word: **G bits 8–6, R 5–3, B 2–0** ("xxxx xxxG GGRR RBBB" in the Tech Notes p.2) | H6-3, Fig. 2-2-1 H6-4; Tech Notes p.2 | #5, #41 |
| CR (at $0400): DCC bits 1–0 pick the clock division — `00` = ÷4, `01` = ÷3; `fCLOCK` = 6·fsc, `fCK` = 1.5·fsc or 2·fsc | H6-3 | #27 (three dot clocks); see §8 — the manual's CR figure is an image and **bits 2–7 are not described** |
| CTA ($0402/$0403): colour-table address (512 entries, so 9 bits); **auto-increments after every high-byte data write** | H6-3, H6-4 | #10, #17 (the wrap at 512 is already handled, viewer.asm) |
| CTW ($0404/$0405): writes one 9-bit entry (low byte = R/B bits, high byte bit 0 = G2) | H6-3 | #5, #10, #17 |
| CTR: reads an entry back | H6-3 | **GAP 8** |
| Writing: CTA low, CTA high, CTW low, CTW high (the high write increments); reading: two-step address then two-step data | H6-5 | #10, #17 |
| VD8 = SPBG, VD7–4 = block number, VD3–0 = colour number — the whole addressing rule | H6-5 | #5, #12 |
| RGB bandwidth 7 MHz | H6-1 | not modelled |
| 2.3 sync generator, **2.4 RGB outputs**, 2.5 colour-difference outputs | H6-6 (TOC only) | **absent from the scan** → **GAP 13** |

## 5. HuC6280 — hardware

### 5.1 CPU map, MPR, memory

| Fact | Page | Card |
|---|---|---|
| 8-bit registers A, X, Y, P, S, PCH/PCL, plus SH/DH/LH used only by block transfer | H8-2/3 | #31 (codegen) |
| P: N V T B D I Z C; T is set by SET and affects the next instruction | H8-4/5 | #31, #32 |
| Block transfer: 17 + 6x cycles; a length of 0 transfers **65,536 bytes**; three stack bytes used | H8-6, S8-88…S8-100 | #31, #32 |
| 8 MPRs, each mapping an 8 KB logical window to one 8 KB physical bank (banks are numbered by physical address >> 13); 2 MB physical / 64 KB logical | H8-7, H8-10/11 | #7, #8, #31; **GAP 4** |
| TMAi/TAMi: second byte is a one-hot mask (MPR0 = $01 … MPR7 = $80); Tables H8-8 vs S8-10 disagree — see §8 | H8-8, S8-10 | #7, #8, #31 |
| After reset MPR7 = 0, so the reset vector at logical $FFFE/$FFFF is physical $001FFE/$001FFF | H8-7, H8-18 | #7 (viewer bank 0) |
| ST0/ST1/ST2 drive CE7 and A1/A0 so immediate stores reach the VDC's AR / low / high ports | H8-8, S8-80…S8-82 | #7, #8 |
| Stack is always logical $2100–$21FF (256 bytes); zero page is $2000–$20FF | H8-3, H8-11 | #7, #8, #31 |
| Physical map: F8 = 8 KB work RAM ($1F0000–$1F1FFF, zero page $1F0000, stack $1F0100 when MPR1=F8); F7 = save RAM; 00–F6 = HuCard ROM | H8-9 (table; F7's label is not printed there — the tutorial names it) | #7, #8; F7 usage → **GAP 5** |
| Device map: VDC $1FE000 (logical $0000–$0003), VCE $1FE400 ($0400–$0407), PSG $1FE800 ($0800–$080F), timer $1FEC00 ($0C00/$0C01), I/O $1FF000 ($1000), IRQ regs $1FF400 ($1402/$1403) | H8-24 | #7, #8, #34 |
| Physical space: 256 blocks of 8 KB = 2 MB (the CPU's address space — the HuCard itself decodes only `$00`–`$7F` = 1 MB, §15.1 GAP 4 and #57) | H8-10/11 | **GAP 4** |

### 5.2 Interrupts

| Fact | Page | Card |
|---|---|---|
| Vectors: IRQ2/BRK $FFF6, IRQ1 $FFF8, timer $FFFA, NMI $FFFC, reset $FFFE | H8-12/13 | #15, #16, #31 |
| Priority: RESET > NMI > BRK > timer > IRQ1 > IRQ2 | H8-13 | #31 |
| NMI is edge-sensed; IRQ1 and IRQ2 are **level-sensed** | H8-12, H8-13 | #16 (a level IRQ1 must be cleared at the source — reading SR) |
| An interrupt pushes PCH, PCL, P, then sets I and clears D; RTI restores P | H8-13/14 | #16, #31 |
| IRQ disable register at $1402: bit 0 IRQ2D, bit 1 IRQ1D, bit 2 TIQD; **0 = enabled**; all cleared at reset | H8-16, H8-24 | #16 (the CPU-side half of "status read at $0000") |
| IRQ request register at $1403: read shows IRQ2/IRQ1/TIQ; **a write to it resets TIQ** | H8-15, H8-24 | timer → **GAP 3** |
| BRK is vector $FFF6 with B=1 and returns to BRK+2 | H8-17, S8-30 | #31 |
| Interrupts are sampled in the last bus cycle of an instruction | H8-12 | #16, #32 |

### 5.3 Reset state, timer, I/O

| Fact | Page | Card |
|---|---|---|
| Reset: I set, D clear, MPR7 = 0, timer stopped, IRQ disable register all 0, TIQ clear, **low speed mode**, port O high, T clear, ready clear | H8-18 | #7 (viewer does `csh`), #31, #32 |
| **Low speed after reset** — high speed needs CSH | H8-18 | #31, #32; CSL/CSH have **no description page** (see §8) |
| Port K (input) and port O (output) share $1F0000–$1F03FF: a read returns K, a write sets O | H8-19 | **GAP 3** (pads) |
| Timer: 7-bit downcounter + 7-bit reload at $1C00 (write reload / read downcounter), control at $1C01 bit 0 START | H8-20, H8-22 | **GAP 3** |
| Prescaler = OSC1 / 3 / 1024; at 21.48 MHz that is 6.992 kHz, so interrupts from 143 µs to 18.3 ms | H8-21 | #32 (a sub-frame clock); **GAP 3** |
| A borrow reloads the counter and sets TIQ; TIQ must be reset by writing $1403 | H8-21 | **GAP 3** |
| Reading the downcounter can return an invalid value — read twice and compare | H8-21 | **GAP 3** |
| PSG reaches the CPU through CE P and A0–A3, clocked from OSC1 | H8-23 | #34 |

## 6. HuC6280 — software (the instruction set and its timing)

The whole S8 document is the 89-instruction set with byte and cycle counts per
addressing mode (S8-17 to S8-108). Everything needed by #31 (codegen) and #32
(the frame-time validator) is there; the numbers below are the ones a validator
must reproduce.

| Rule | Page | Card |
|---|---|---|
| One cycle = one bus cycle; every instruction's cycle count is tabulated per addressing mode | S8-16 (definition), S8-17… | #32 |
| Immediate 2; zp 4; zp,X 4; (zp) 7; (zp,X) 7; (zp),Y 7; abs 5; abs,X/Y 5 (no page-cross penalty is listed) | S8-17 (ADC), and each instruction | #32 |
| Read-modify-write zp 6, abs 7; accumulator ops 2 | S8-19, S8-44, S8-56 | #32 |
| Branches 2, **+2 when taken**; BBRi/BBSi 6, +2 when taken | S8-20/21, S8-22… | #32 |
| JSR 7, RTS 7, RTI 7, PHA/PHP/PHX/PHY 3, PLA/PLP/PLX/PLY 4, JMP abs 4 / indirect 7 | S8-51…S8-71 | #31, #32 |
| TAMi 5, TMAi 4, TII/TDD/TIA/TAI/TIN 17 + 6x (7 bytes) | S8-90, S8-93…S8-100 | #31, #32 |
| SET before AND/OR/EOR/ADC makes it a page-0 memory op: **+3 cycles** | S8-17/18, S8-47, S8-58 | #31, #32 |
| Decimal mode adds 1 cycle to ADC/SBC | S8-17, S8-74 | #32 |
| TST (IMM zp / abs) 7/8 cycles; TRB/TSB 6/7; BIT imm 2, zp 4, abs 5 | S8-102, S8-104 | #31 |
| BRK 8 cycles; NOP 2; SWAP (SAX/SAY/SXY) 3 | S8-30, S8-57, S8-72/73/87 | #31 |
| **No page or cycle is given for CSL/CSH** — they appear only on the instruction map | H8-25 | #31, #32; see §8 |

Cross-check from the Tech Notes: at 7.16–7.19 MHz one 60 Hz frame is **about
119,904 machine cycles**, so a main loop must finish inside that (Tech Notes
p.1–2). That number and the S8 cycle counts must agree in #32; the Tech Notes'
own worked example (TAI of $2000 bytes = 49,169 cycles ≈ half a frame) is the
check that the two sources are counting the same cycles.

## 7. HuC6280 — PSG

| Fact | Page | Card |
|---|---|---|
| 6 channels, waveform memory of 32 words × 5 bits per cycle; channels 5–6 can be noise instead; stereo; DDA; one LFO | P8-1 | #34 |
| R0 channel select ($0800); R1 main L/R amplitude ($0801); R2/R3 frequency low/high ($0802/$0803); R4 channel on / DDA / amplitude ($0804); R5 L/R amplitude ($0805); R6 wave data ($0806); R7 noise enable + frequency (ch 5/6 only, $0807); R8 LFO frequency ($0808); R9 LFO control ($0809) | P8-2 | #34, #35 |
| R1 and R5: 4 bits per side, **3 dB per step**, max at `F` | P8-3, P8-4 | #34 |
| R2+R3 = 12-bit F; **F = 0 is forbidden** | P8-3, P8-9 | #34, #35 |
| Output frequency f = fMASTER / (2 × 32 × F), fMASTER = 7.16 MHz | P8-9 | #34 |
| R4: bit 7 ch ON, bit 6 DDA, bits 4–0 AL, **1.5 dB per step**, max at `1F` | P8-3, P8-4 | #34 |
| Mode table: chON/DDA = 0/0 write-data (address auto-increments per write), 0/1 reset address counter, 1/0 mixing, 1/1 DDA (each R6 write goes straight to the DAC and is held) | P8-4 | #34 |
| Writing a wave: set chON=0,DDA=0 and write 32 words; to set the start address, pulse chON=0,DDA=1 then 0 | P8-5 | #34, #35 |
| DDA: write $00 to R6 once (or AL=0) before switching on; R6 then carries samples | P8-5 | #34 |
| R7: bit 7 noise enable, bits 4–0 noise frequency; **ch 5 and 6 only** | P8-6 | #34 |
| R8 + channel 2's R2/R3 form one divide-by-N counter for the LFO | P8-6 | #34 |
| R9: bit 7 trigger (1 = reset the LFO and hold ch2's wave at address 0, 0 = run), bits 1–0 LFCTL (0 off, 1 0-shift, 2 2-bit shift, 3 4-bit shift of the ch2 wave added to ch1's frequency) | P8-6, P8-8 | #34 |
| The LFO is active only when **both ch1 and ch2** are enabled; ch2 then also sounds | P8-6 | #34 |
| LFO frequency f = fMASTER / (2 × 32 × F2 × FLF) | P8-9 | #34 |
| Noise clock f = fMASTER / (2 × 32 × 2 × NF), NF = complement of the 5-bit value; NF = 0 undefined | P8-9 | #34; polynomial → **GAP 14** |
| Amplitude: the three attenuations add; ≥ 45 dB down is silence; a 0 in R1/R4/R5 silences the channel | P8-10 | #34 |
| Equal-tempered F values per note (C1 … C8), with the PSG's own output | P8-12 | #35 |

## 8. HuC62 Tech Notes (Hudson's own worked examples)

| Fact | Page | Card |
|---|---|---|
| 60 VSYNCs a second; ≈119,904 machine cycles per frame at 7.19 MHz; the main loop must be shorter than 1/60 s | 1–2 | #32 |
| The border colour is **colour 0 of block 16** (the first sprite palette, CRAM address $100); colour 0 of all other 31 blocks is "clear" | 1–2 | #5 (the $100 fill), **GAP 1** (drawn as a border) |
| HDW=$1F is the normal 32-character width; HDW=$1E makes the right 8 pixels border — the border is visible whenever the window is narrower than the VCE raster | 2 | **GAP 1** |
| Colour word is `xxxx xxxG GGRR RBBB`; only bit 0 of the high byte is used | 2 | #5, #41 |
| VCE at physical $1FE400, logical $0400 when MPR0=$FF | 2 | #7, #10 |
| Raster interrupt: the line counter starts at **64** at the top of the sweep, so RCR = scan line + $40; **an RCR below 64 never fires**; RCR=0 disables it | 8–9 | #15, #16 |
| SR bit 2 = raster match, bit 5 = VBlank; the handler must read SR to clear it and must restore AR on exit (a `set_reg`'s two data writes can be split by the interrupt) | 9–11 | #16, #42 |
| CR cannot be read back — keep a RAM copy | 11–12 | #16 (implemented) |
| A status-line split: RCR at the split; BXR/BYR written **during display** must be one less than the target scan line (BYR+1 rule); sprites turned off with CR bit 6 for the status band | 8–13 | #15, #17, #29 |
| 128×32 (SCREEN=2, "4 by 1") uses $1000 words of CG; 128×64 (SCREEN=6, "4 by 2") uses $2000 | 8–13 | #5, #38 (scene5/scene7) |
| Packing colour data: the only non-zero high-byte bit is G2, so 8 colours can be stored as one G2 byte + eight low bytes | 20 | #19 (export formats), #35 |
| TAI cost 17 + 6x (worked example: 49,169 cycles for 8,192 bytes) | 4 | #31, #32 |

## 9. `PC Engine memory map and MPR banking` (ChibiAkumas) — **not Hudson**

Read for the parts the Hudson manuals' scans mangle (MPR layout, physical
blocks, one worked IO summary). It is a tutorial, not a manual: treat every
statement below as second-hand unless a Hudson page agrees.

| Fact | Card | Hudson agreement |
|---|---|---|
| MPR bit masks: MPR0=$01 … MPR7=$80; `$FF` = I/O, `$F8` = 8 KB RAM, `$00` = first ROM page | #7, #8 | **Yes** — H8-8/S8-10 (the mask table; see the erratum in §10) |
| Zero page at $2000, stack at $2100, unaffected by MPR | #7, #8 | **Yes** — H8-3, H8-11 |
| Blocks: F9–FB SuperGrafx RAM, F8 8 KB RAM, F7 save RAM, 00–F6 HuCard ROM | #7, #8; SuperGrafx → **GAP 12**; F7 → **GAP 5** | F8 and the ROM range: **yes** (H8-9 table); F7/F9–FB: **not in these manuals** |
| Vectors table ($FFF6 … $FFFF) | #15, #16, #31 | **Yes** — H8-13 |
| VDC/VCE/PSG/timer/IRQ at $0000/$0400/$0800/$1C00/$1402/$1403, MPR0=$FF | #7, #8, #34 | **Yes** — H8-24 |
| VDC status read at $0100 clears the VBlank interrupt, otherwise it refires | #16 | **Yes** — H7-4 (auto-clear after read) |
| VRAM was designed for 128 KB though the console has 64 KB; MAWR sets only the low 16 bits, so word addresses are 16-bit | #5, #26 | partly — H7-5 gives the 16-bit register; the 128 KB claim is not in the Hudson manuals |
| Pattern = 32 bytes = 16 words; tile 1 at $0010; BAT at $0000; suggested tiles from $1000; SAT at $7F00; tiles 2048–4095 unusable | #5, #12, #14 | **Yes** — H7-14, H7-15, H7-20; the 2,048 limit follows from 32K words |
| **SAT pattern field = VRAM address ">>5"** | #12 | **No — wrong.** H7-21/H7-24 say the pattern's high 10 bits equal the address's high 10 bits, i.e. **×64 (>>6)**; #12/#40 proved >>5 makes every sprite invisible |
| SAT word 3 layout: YF bit 15, YS 13–12, XF 11, XS 8, F(SPBG) 7, palette 3–0 | #12 | **Yes**, as far as the figure and tests show; the figure is the only source (see §10) |
| SAT Y=64 is the first visible row, X=32 the first visible column | #12, #13 | **Yes** — H7-21 (figure "(32,64)") |
| Pad read at $1000: write 1 then 3 to initialise, delay, alternate writes of 1 and 0, read 5 pads in order; bits 7 CD, 6 country, 3–0 directions/buttons | **GAP 3** | **Not in any Hudson manual here**; the CD BIOS `EX_JOYSNS` (p.28) is the only Hudson source and it is CD-side |
| Tutorial header figures "612 colours", "256x239 / 565x242" | — | **No** — 512 colours (H6-1) and 256-px modes (VIDEO_MODES.md); the header has typos |
| "$0400 Palette: Reset — write 0" | #27 | **Partly wrong** — $0400 is the VCE's **control** register (H6-3); writing 0 selects the ÷4 dot clock, it is not a reset |

## 10. `docs/VIDEO_MODES.md` — **not a manual**

PCEHeroTN's own reading of its VCE RTL; useful where the VCE manual's scan
stops, but it is a program's behaviour, not the chip's spec.

| Fact | Card | Status |
|---|---|---|
| The VCE owns the raster: 2,730 clocks a line at 42.95 MHz (63.6 µs), **262 or 263 lines a frame (CR bit 2)**, no interlace | #27; frame length → **GAP 7** | CR bit 2 is **not in the VCE manual's text** — it is RTL-derived, and **pcetech §7/§6 contradicts it** (263 lines fixed; bit 2 = edge blur): see §15 |
| The VDC only draws inside its window (HDS/HDW/HDE, VDS/VDW/VCR); outside it the VCE shows the border colour | **GAP 1** | consistent with H7-10/H7-13 and Tech Notes p.2 |
| Dot clocks 5.37 / 7.16 / 10.74 MHz = 270 / 360 / 540 dots of active window; game content typically ~256, ~320–352, 512 | #27 | MHz values are not printed in the VCE text (only the ÷4/÷3 table, H6-3) |
| 224 and 240 lines are both common | **GAP 1** | the studio currently picks 240 and crops 232 (see §12) |
| The VCE reloads the dot clock at the start of every line, so a mode can change mid-frame; two MiST/MiSTer cores detect this | #27 (and note for the raster table) | **not in the manual**; it is what the cores do |
| PCEHeroTN's 10.74 MHz mode loses the last 28 dots (its line buffer is 512) | — | a PCEHeroTN RTL limit, not ours |

## 11. CD-ROM² manuals

Read in full because SPEC's Phase 0 asks for all three and idea #22 ("a CD-ROM
image instead of a HuCard") rests on them. Nothing in them changes the HuCard
studio; the parts that matter to a future CD path are below.

### 11.1 BIOS manual (v1.00)

| Fact | Page | Card |
|---|---|---|
| IPL block fields: first/last record, load address, exec address, MPR for the program, open mode; graphic and ADPCM preload groups | 5–6 | #22 |
| Normal memory map: BIOS at $E000–$FFFF (MPR7=0), user area $4000–$DFFF, work RAM $2000–$3FFF, I/O $0000–$1FFF | 7 | #22 |
| During the PSG/graphic/Kanji driver calls MPR4–6 are borrowed and restored after | 8–10 | #22 |
| Zero page $2000–$20FF and RAM above $2200: which bytes the BIOS/drivers own | 11 | #22 |
| Calls $00–$1F: boot, reset, base address, read/seek/exec, play/pause/status/TOC, ADPCM transfer/play, backup RAM format/read/write/delete, version, set user vector | 12–26 | #22 |
| `EX_JOYSNS` ($21, p.28): the 5-pad sense, JOY/JOYTRG/JOYOLD; the only Hudson description of pad handling (CD side) | 28 | **GAP 3** (the HuCard side is still unsourced) |
| `EX_SCRMOD` ($25, p.29): clock 5 or 7 MHz; **horizontal 10–34 characters at 5 MHz, 16–44 at 7 MHz (odd values disallowed); vertical 10–30**; default 5 MHz 32×30 | 29 | #27 (real width/height limits), **GAP 1** |
| `EX_DOTMOD` ($24, p.29): VM/SM access width; `EX_IMODE` ($26): IW +1/+32/+64/+128; `EX_VMODE`/`EX_HMODE` ($27/$28): the increment that matches the screen mode | 29 | **GAP 9** (VM/SM); #7 (bulk +32/+64/+128) |
| `EX_VSYNC` ($29), `EX_RCRON`/`EX_RCROFF` ($2A/$2B), `EX_IRQON/OFF`, `EX_BGON/OFF`, `EX_SPRON/OFF`, `EX_DSPON/OFF` | 30–31 | #15, #16 |
| `EX_DMAMOD` ($34), `EX_SPRDMA` ($35), `EX_SATCLR` ($36), `EX_SPRPUT` ($37), `EX_SETDMA` ($3B): the BIOS's own DMA and SAT wrappers | 32–33 | #14, **GAP 2** |
| `EX_SETRCR` ($38), `EX_SETRED` ($39), `EX_SETWRIT` ($3A) | 33 | #15, **GAP 8** (`EX_SETRED` is the read path) |
| `EX_COLORCMD` ($3C): set/read background and sprite palettes from buffers | 34 | #10, #17, **GAP 8** (read) |
| Math calls: BIN↔BCD, random, 8/16-bit multiply and divide, square root, sine, cosine, arctangent | 34–36 | #31 (a toy runtime could use these) |
| PSG and graphic driver calls ($48, $49) | 37–40 | #34, #35 |
| Backup memory: **2 KB** (IFU-30), file format (FCB, directory, checksum), $8000–$DFFF windows | 23–25 | **GAP 5** |
| Error codes $00–$2C | 41 | #22 |
| BIOS entry addresses $E000–$E0E1 and work-area addresses | 42–46 | #22 |

### 11.2 CD PSG driver

| Fact | Page | Card |
|---|---|---|
| 12 virtual tracks (6 main + 6 sub) and 21 calls | 12–19 | #35 (a music path), #34 |
| Track data: interval/rest, octave, tie, tempo, volume, pan, length ratio, loops, jumps, transpose, sweep, detune, FM, pitch envelope, percussion, mode (normal/percussion/noise), data end | 20–30 | #35 |
| Mode 2 (noise) only on channels 5–6; percussion noise on 5–6 | 29 | #34/#35 |
| 45 internal wave forms + 83 user waves (32 bytes each); 16 internal envelopes + 112 user | 31–33 | #35 |
| Envelope level $400 = level 1, $7C00 = level 31; FM data −127…127 with $80 = end, max 256 bytes | 32–34 | #35 |
| ADPCM sampling rate = 32/(16 − DH) kHz (CD BIOS manual p.21) | 21 | #22 |

### 11.3 CD software manual (the Hu7 development system)

| Fact | Page | Card |
|---|---|---|
| MS-DOS tools: SCSIDEV.SYS, HDMUSIC, ADPCM, HDWRITE, CV, INFGET, CDEMUL, BACKUP/VERIFY/RESTORE, LIST, MSBACKUP, SFTFMT, EJECT, HDTOC, HD384FMT | 7–88 | #22 |
| CD Contents = 2,048-byte records; **record 0 = 00 min 02 s 00 frame; one record = 1/75 s**; audio 2,352 bytes/record for the real CD | 89 | #22 |
| `CD_DOC.DIR` format (attribute, start record, record count, group/name/ext, bytes, date, time) | 89–90 | #22 |
| IPL block layout and open-mode bits (VRAM load, display on/off, ADPCM load/play) | 91–92 | #22 |
| ADPCM: 4 bits/sample; 64 KB buffer; 16 kHz = 2.19 s, 8 kHz = 16.38 s, 4 kHz = 32.77 s, 2 kHz = 65.54 s | 42 | #22 |

## 12. What the existing code already gets wrong or leaves out

Checked against the manuals above, in the tree at the time of writing. The
first two are wrong *comments/values*, the rest are unmodelled features.
Line numbers move — another seat is editing `pce-bg.js` and `pce-sprites.js`
for #26 while this is read — so the references name symbols, not lines.

1. **"256x224" is wrong in three places; the ROM is 256×240.** The `HDR`
   constant is `$041F` (HDW=31 → 32 characters = 256 px) and `VDW` is `$00EF`
   (240 lines): `tools/genroms.py` writes those values, and `renderer/viewer.asm`
   writes them too (its own comment there says "VDR: 240 display lines"), and
   yet the header comments of `renderer/pce-bg.js`, `tools/genroms.py` and
   `renderer/viewer.asm` ("sets the VDC to 256x224") all say 224. The model
   renders 232 of the 240 lines. Manual: H7-10 (VDW = N−1), H7-9 (HDW = N−1).
2. **The VCE control value is written as `$04` and called "edge blur on"**
   (`lda #$04` / `sta $0400` in `tools/viewer.asm`). The VCE manual's CR text
   (H6-3) documents only DCC bits 1–0, but **pcetech §6 supplies the rest**:
   D2 is "blur edges", D1–D0 the dot clock, D7 black-and-white, D6–D3 no
   effect. `$04` is therefore the ÷4 (256 px) clock with blur on, and the
   comment is supported. `VIDEO_MODES.md`'s reading of bit 2 as a 262/263-line
   select is contradicted by pcetech §7 (263 lines fixed) — see §15.3.
   `tools/genroms.py` still calls `$04` "263-line mode"; *that* comment is the
   unsupported one.
3. **`genroms.py` labels DCR bit 4 "sprite layer on"** (the comment beside DCR
   in `emit_vdc_regs`); bit 4 is DSR, the SATB auto-repeat. Sprites are CR
   bit 6 (H7-11, H7-6). `viewer.asm` has the same register right; only the
   comment is wrong.
4. **The display window is not modelled at all.** The renderer never reads
   HSR/HDR/VPR/VDR/VCR; `renderIndices` assumes a 32×30-character window, 232
   visible rows, and no border. A different window, a 224-line picture, or
   anything in the border would render wrong and no test would catch it.
   → **GAP 1**.
5. **MWR is half-modelled.** SCREEN is right (`batGeometry`, H7-9); VM, SM and
   CM are ignored, including the 4-clock mode's "4 of 256 colours" (H7-8/9).
   → **GAP 9**.
6. **CR is half-modelled.** BB/SB are right (H7-6); IE, EX, TE, DR and IW are
   never set or modelled. In particular TE (DISP select) and EX have no home
   anywhere → **GAP 11**.
7. **No read path.** MAAR/VRR and CTR are unmodelled (`pce-rom.js`,
   `pce-bg.js`) → **GAP 8**. The viewer also never uses the larger IW steps
   (+32/+64/+128) for bulk loads; every copy is +1 (H7-6).
8. **VRAM→VRAM DMA is absent.** DCR's DSR is modelled only as "load the SAT
   every VBlank" (#14); SOUR/DESR/LENR and SI/D/DI/D have no code and no card
   → **GAP 2**. The render model also assumes a static SAT within a frame.
9. **The sprite budget is hard-coded to 16 strips** (`strips.length < 16` in
   `collectStrips`), which is what the tests measured, but the manual's limit
   is "16 sprites" *plus* a search limit that depends on HBlank and SM
   (H7-19): with the 4-clock SM or a narrow HBlank the real limit is lower.
   Not modelled → tied to **GAP 9/GAP 1**.
10. **Status is not modelled.** CC/OR/DS/DV/VD never appear (H7-4); the model
    cannot report an overflow or a collision → **GAP 6**.
11. **The output scale is Mednafen's, not the VCE's.** `cramEntry` uses
    36 × n; the VCE manual's RGB-output section (H6-6) is missing from the
    scan, so the manual cannot settle 36n vs 255/7. pcetech §6 gives the
    9-bit digital word but no analogue levels either → **GAP 13**, §15.1.
12. **The border colour is only half used.** The renderer paints CRAM $100 for
    a background-off line (correct, H7-18 + Tech Notes p.1), but never paints
    it as the border around the window → **GAP 1**.
13. **No CPU-side hardware at all in the exported ROM:** the viewer never
    touches the timer, the pad port, the PSG or the IRQ vectors (they are `rti`
    stubs). That is correct for a static picture, but it means #30/#31 have no
    proven path yet → **GAP 3**, #34/#35.
14. **The exporter's caps were its own.** The 80 KB cap
    (`MAX_TILE_BANKS = 6`, `MAX_REGIONS = 8`, `MAX_BAT_BANKS = 2` in
    `pce-rom.js`) is #46's work (closed e7c547c); it raised the cap to
    `MAX_ROM_BANKS = 256` = 2 MB, citing H8-10/11. **pcetech §3, sgxtech's
    map and the HES map put the measured HuCard decode at `$00`–`$7F` =
    1 MB** (§15.1 GAP 4); #57 applied that — `MAX_ROM_BANKS = 128` (1 MB),
    with `genviewer.py`'s PCEAS-bank cap now coinciding at 128.
15. **Correct but worth recording (checked, no change needed):** the sprite
    pattern is *code × 64 words* (`base = s.cell * 64 + s.row` in
    `pce-sprites.js`) matching H7-21/24 and contradicting the tutorial's
    ">>5"; the 512-entry palette write wraps the 9-bit CTA exactly as H6-3
    says (the palette loop in `viewer.asm`); the VDC's colour-0 rule for the
    background (`pix === 0 → 0x000`) is H7-18; sprite colour 0 is treated as
    transparent, which is the Tech Notes' "clear" rule (p.1), not a statement
    in the VDC manual.

## 13. Where the text is garbled, and what the PDF settled

These are the only places the PDFs were opened. Each was checked against the
same page in the `.txt`; the PDFs are the same scans and did **not** supply any
text the `.txt` lacked.

| Place | What is wrong in the `.txt` | What the PDF gave |
|---|---|---|
| VDC MWR VM/SM tables, H7-8 | columns collapse; the 1/2/4-clock assignment is unreadable | the same table legibly enough to confirm 1/2/4 clocks and "4 clocks mode displays four of the 256 colors" — enough to state **GAP 9** |
| VDC SAT configuration, H7-20/21 | the bit diagram is missing from the text | **the PDF's diagram is also an image**; only the field list and widths are printed (Y/X 0–1,023; pattern high 10 bits; 4-bit colour; SPBG; flips; CGX; CGY bits 13/12). Bit *positions* still come from the figure as implemented and measured — say so wherever they are cited |
| VDC R12 name | `.txt` says LENR | PDF's register list (H7-2) prints **LENA**, the body (H7-12) prints **LENR** — the manual disagrees with itself |
| VCE CR figure, H6-3 | bits are a figure; only DCC 1–0 described | same in the PDF: **bits 2–7 have no page**, so the 262/263-line claim has no manual source |
| VCE H6-6 | sections 2.3–2.5 listed in the TOC but absent | **absent from the PDF too** (the PDF's text ends at H6-5): the RGB-output levels cannot be read from this manual at all |
| HuC6280 Table 2-2-2, H8-8 | prints "MPR 1" twice, never MPR0 | same typo in the PDF. The **Software Manual §3.1, S8-10** gives the correct table (MPR0 = $01 … MPR7 = $80), and PCEAS/the code agree with it |
| CD BIOS, CD Software | many OCR lapses (e.g. "co::::suBQ", "~ri1 r;u()J") | not re-checked page by page; every CD fact used above is also legible in the `.txt`, and the CD path is #22 only |

Two manual contradictions to carry forward rather than resolve by preference:
**LENA vs LENR** (same register), and **"CET" in the timer figure (H8-22) vs
"CEPT" in the PSG interface text (H8-23)** — both are the chip-enable naming,
not a functional difference.

## 14. Sources that disagree (so the next seat does not re-litigate them)

| Question | Sources | Verdict |
|---|---|---|
| How a sprite pattern code maps to a VRAM address | VDC manual H7-21/H7-24 ("high-order 10 bits equal the high-order 10 bits", 64-word cells); tutorial ">>5"; PCEStudio's tests | **manual + #12/#40 measurement: ×64 (>>6)**. The tutorial is wrong; #12 already paid for this |
| What "16 sprites a line" counts | VDC manual H7-19 (sprites), plus the SM/HBlank search table; #12/#40 (strips) | **16-pixel strips** in practice; a 32-px CGX sprite spends two. The manual's wording is imprecise |
| Is a sprite colour-0 pixel transparent? | VDC manual H7-24 (says only that VD7–4 become 0); Tech Notes p.1 ("colour 0 … always clear"); #12 | **transparent**, per the Tech Notes and measurement; the VDC manual alone does not say it |
| Where the border colour comes from | Tech Notes p.1 (colour 0 of block 16 = CRAM $100); VDC manual H7-18 (blanking data is SPBG=1, VD=0) | **CRAM $100**, both agree |
| $0400 | VCE manual H6-3 (clock division); tutorial ("Palette Reset"); viewer's "edge blur"; pcetech §6 (measured: D2 = blur, D1–D0 = clock, D7 = mono) | **control register**; the tutorial is wrong and the viewer's comment is supported by the measured note. VIDEO_MODES' bit-2 line select is contradicted (§15.3) |
| Lines per frame | VIDEO_MODES (CR bit 2, 262/263); VCE manual (nothing); pcetech §7 (measured: 263, fixed) | **263 lines fixed** per the measured note; the 262/263 CR-bit-2 claim is contradicted. Still not a Hudson-manual fact (§15) |
| CSH/CSL cycle cost | Software Manual (no entry); pcetech §2 (measured: 3 cycles each) | **3 cycles**, measured at the same speed; the switching cost is unknown. A measured note, not the manual (§15.4) |
| CPU cycle counts | Software Manual S8-17…; Tech Notes (119,904/frame) | agree when "cycles" = 7.16 MHz clocks in high-speed mode; **the manual never describes CSH/CSL**, so a validator must assume high speed after CSH (H8-18) |

## 15. Charles MacDonald's notes and the pce-dev-kit archive (card #55)

Dennis pointed at `github.com/langel/pce-dev-kit` (2026-10-28). Four of its
documents were read **in full**, read-only, from
`/Volumes/External II/pce-tools/docs/pce-dev-kit` — **outside this repo**, and
not copied in. The archive's own `LICENSE` is the Unlicense, but the bundled
documents keep their authors' rights: `pcetech.txt` and `sgxtech.txt` say
"Unpublished work Copyright … Charles MacDonald" and forbid re-posting, and
`Hu7CD_final.pdf` is a scan "Shared by Enguerrand SOULIER". Only a few words
are quoted below, with the note's own section name; every citation is to the
note, never to a Hudson page. These are **measured behaviour, not chip
specifications**: `pcetech` was "tested and verified on a TurboGrafx-16
console", `sgxtech` on a SuperGrafx. Where they disagree with a Hudson manual
the disagreement is recorded, not resolved by preference.

| Source | Lines / pp | Kind |
|---|---|---|
| `pcetech.txt` | 1,752 | **not Hudson** — Charles MacDonald, *TurboGrafx-16 Hardware Notes*, 2001–02, measured |
| `sgxtech.txt` | 494 | **not Hudson** — Charles MacDonald, *NEC SuperGrafx hardware notes*, 2003–04, measured |
| `hes spec.txt` | 67 | **not a manual** — Mamiya, *HES Music Format Spec* v1.00, 2000 |
| `Hu7CD_final.pdf` | 10 | **not a manual** — a Hu7 CD System manual extract (Part 1 ch.1–2 and the Part 2 divider only; pp. 12–37 absent) |

Two cautions about `pcetech` itself: its table of contents swaps the two chip
names (§5 is headed "HuC6260 - Video Display Controller" but is the VDC; §6 is
headed "HuC6270 - Video Color Encoder" but is the VCE — the bodies are right),
and its register reference covers only `$00`–`$09`, so `$0A`–`$13` are cited
from the §7/§9 prose, not from a reference table. Page numbers do not exist in
these notes; the section names below are the citation.

### 15.1 What the notes settle, per GAP

| GAP | Note section | What it settles — and what it does not | Route |
|---|---|---|---|
| **1** window and border | pcetech §7 "Display details", §9 "Display parameter settings", §5.1 CR; sgxtech "Video Priority Controller" (SGX only) | Frame = **263 lines, fixed**, split 14 top blanking / 242 active display / 4 bottom / 3 sync. The VDC shows graphics only inside VDS+VSW … +VDW; the overscan colour is shown elsewhere. Overscan = colour 0 of sprite palette 0 (`$100`); the active-area backdrop = colour 0 of background palette 0 (`$000`). `$0A`/`$0B` may change on any line; `$0C`–`$0E` only outside the active display. The measured tables include the exact 256×240 row our viewer writes (HDS=2 HSW=2 HDE=4 HDW=`$1F`; VDS=`$0F` VSW=2 VDW=`$EF` VCR=`$0C`) and the standard 224 row (VDS=`$17` VDW=`$DF`). At the 5 MHz clock a line is "roughly 342 dots", so a 256-px window leaves a left/right border. Does **not** settle the BB=0/SB=1 fill (§15.3). | #48 |
| **2** VRAM→VRAM copy | pcetech §5.4 "DMA" | LENR = words M−1 (`0` = 1, `$FFFF` = 64K; the note's "1 byte" is a typo) and the MSB write starts it. SOUR/DESR/LENR are counters and keep their post-transfer values; LENR ends `$FFFF`. IW does not change the DMA step (always +1). MAWR/MARR/read buffer/write latch are untouched. Both DMAs may run together; SAT-DMA-done is four lines after the display ends. **Contradicts H7-12 on an overrun**: the note says DMA is "halted (not aborted), and resumes", the manual says cancelled with no done status. | #49 |
| **3** pads and timer | pcetech §4 "I/O port", §2.1 "Interrupts", §2.2 "Timer" | The 2-button protocol (SEL = directions, CLR low = enabled, inputs inverted, the exact D3–D0 table, a delay after SEL) and the Turbo Tap 5-pad serial counter with its reset quirk (`$01`/`$03`). `$1000`: D7 CD sense, D6 country, D5/D4 = 1. Timer: 7-bit, decremented at fMASTER/1024 = 6992 Hz independent of CSL/CSH; `$00` counts as 1 and `$7F` as 128; IRQ on the 0→`$7F` underflow, then immediate reload; a read returns the reloaded value; it keeps counting without an acknowledge; disabled returns the last counter; re-enabling reloads the latch; any write to `$1403` acknowledges. Does **not** settle the 6-button pad (GAP 10). | #45 |
| **4** ROM over 80 KB | pcetech §3 "Memory map"; sgxtech "HuC6280 memory map"; hes spec [MEMORY MAP] | The measured decode is HuCard ROM `$00`–`$7F` (128 × 8 KB = **1 MB**), `$80`–`$F7` unused (`$FF`), F8–FB work RAM (SGX 32 KB; on a PC-Engine F9–FB mirror F8); a ROM under 1 MB may be mirrored. The HES map agrees: ROM `0x000000–0x0FFFFF`, RAM `0x1F0000–0x1F7FFF`. **This contradicts the 2 MB limit** in §5.1 and `renderer/pce-rom.js` `MAX_ROM_BANKS = 256`, the limit #46 closed on (e7c547c). #57 set it to 128 (1 MB). | #46, #57 |
| **5** where a save lives | pcetech §8 "CD-ROM" → "Battery backed RAM (BRAM)" | 2 KB at physical `$1EE000`–`$1EE7FF` (the first 2 KB of page F7), locked at power-up (reads `$FF`, writes ignored), unlocked by bit 7 of `$1807`, locked by reading `$1803`; the System Card and Tennokoe Bank use it in low speed. A bare HuCard has no save RAM. | GAP 5 stays Dennis's SPEC decision |
| **6** status lines | pcetech §5 (status flags), §5.3 "Sprites", §5.4 "DMA" | The bit map and the conditions: D6 BSY, D5 VD, D4 DV, D3 DS, D2 RR, D1 OR, D0 collision (the note calls it CR; Hudson calls it CC). D5–D0 clear on a status read. **A flag is set only if its interrupt-enable bit is set** — the refinement H7-4's table can be read without. VD is on the first line after the active display, even in blanking, and is forced at line 261 if the window overruns; DS is four lines after the display ends; OR is set when the line's 17th sprite entry appears, even off-screen; collision only inside the active display, opaque sprite #0 over another opaque sprite. | #50 |
| **7** 262 or 263 lines | pcetech §7 "Display details", §6 "VCE", §5.1 `$06` RCR | **263 lines, fixed** — "cannot be changed by the vertical control registers". RCR's range is 263 lines, `$0040`–`$0146`, with the first active line counted as `$40`. VCE `$0400`: D2 = "blur edges", D1–D0 = dot clock, D7 = black-and-white, D6–D3 no effect. **There is no 262/263-line select.** This contradicts `docs/VIDEO_MODES.md` and the #27 note in `docs/PLAN.md`; it supports `tools/viewer.asm`'s "edge blur on" comment and makes `tools/genroms.py`'s "263-line mode" comment unsupported. One measured source against one RTL-derived doc. | #27's note |
| **8** reading it back | pcetech §5.1 "Register reference", §6 "VCE", §3 "Memory map" | Writing MARR's MSB loads a word into the read buffer; reading VRR LSB/MSB returns the buffer's bytes and advances MAAR, loading the next word. The buffer is indeterminate at power-up (usually `$FFFF`). Reading `$0002`/`$0003` with any register but VRR selected returns the buffer, and reading `$0003` does not advance MARR. VCE: `$0402`/`$0403` are write-only (read `$FF`); `$0404` returns the low byte, `$0405` the high with bits 7–1 = 1 on a TG-16 (random on an SGX), and reading `$0405` advances the address, wrapping at `$01FF`. The VDC addresses 128 KB but the console has 64 KB: the upper word half mirrors, writes there are ignored and reads may be corrupted. | #47 |
| **9** access width and 4-colour | pcetech §5.1 `$09` "Memory Width Register", §5.3 "Sprites" | VM bits 1–0 = 1/2/4-dot with a per-8-dot fetch schedule; codes 1 and 2 are identical (2-dot) and code 3 is the 4-dot mode. SCREEN bits 5–4 = 32/64/128/128; height bit 6. CG bit 7 selects bitplanes 0/1 or 2/3 and the other pair reads as zero, so a 4-dot background shows 4 of its 16 colours. The per-sprite CG bit is SAT word 2 bit 0 and is valid only when SM is 2- or 4-dot. | #47 |
| **10** 6-button pad | pcetech §4 "I/O port" | **Not settled.** Only the 2-button pad and the 5-player Turbo Tap appear; there is no 6-button protocol. | GAP 10 stays unsourced (Dennis's SPEC) |
| **11** EX/TE pins | pcetech §5.1 `$05` CR | Only repeats the field layout (D9/D8 DISP mode, D5/D4 external sync) and shows no console use. Nothing here makes a card urgent. | #47 |
| **12** SuperGrafx | sgxtech (all: "Overview", "HuC6280 memory map", "Video Priority Controller", "Miscellaneous") | The machine is a HuC6202 VPC + HuC6260A VCE + **two** HuC6270 VDCs + HuC6280A CPU, 32 KB work RAM, 64 KB VRAM each. SGX mode maps VDC1 at `$0000`–`$0003`, the VPC at `$0008`–`$000F`, VDC2 at `$0010`–`$0017`. The VPC has two 10-bit pixel windows (values below `$40` disable one), four 4-bit region controls in `$0008`/`$0009` (VDC1/2 enable + a 2-bit priority), a priority order with quirks for modes 01b/10b, `$000E` bit 0 to route ST0/ST1/ST2 to VDC2, and power-up `$11 $11 $00 …`. IRQ1 is shared, so both status registers must be read. Resolutions cannot be mixed. The compat switch exists because PC-Engine games use the VDC mirror addresses SGX reserves. This turns idea #21 from unsourced to sourced, with the caveat that the VPC cannot see sprite priority and mode 01b leaves sprite-shaped holes in VDC1's background. | #21 |
| **13** VCE output scale | pcetech §6 "VCE" | **Not settled.** The 512 × 9-bit table and the `GGRRRBBB` word are given, but there are no analogue output levels anywhere — the same silence as the missing H6-6 page. It does fill in the control bits the Hudson scan lacks (above), which is not the DAC scale. | #8/#41, needs a real-console measurement |
| **14** PSG noise | pcetech §10 "Programmable Sound Generator" | **Not settled**: three bullets, no shift-register polynomial or taps. It does contradict the Hudson manual on the frequency register (§15.3 item 8) and settles the DDA write rules: the wave index resets on a DDA 1→0 transition regardless of the other `$0804` bits, and wave writes are ignored unless chON and DDA are both clear. | #34 |

### 15.2 What they settle for the §12 code-vs-manual findings

| §12 finding | What the notes add |
|---|---|
| 1. "256x224" comments | pcetech §9's 256×240 row is exactly the register set `tools/viewer.asm` writes; 224 is the standard TV row, 240 the "overscan, max" one. The comments are still wrong — the ROM is 256×240. |
| 2. VCE `$04` "edge blur" | pcetech §6 supports the comment (D2 = blur, D1–D0 = clock); §7 contradicts VIDEO_MODES' 262/263 select (§15.3 item 3). |
| 3. DCR bit 4 "sprite layer on" | Not covered: the register reference stops at `$09` and §5.4 names no DCR bits. Unchanged. |
| 4. Window not modelled | §7/§9 give the model, the measured tables and the change rules → #48, now sourced. |
| 5. MWR half-modelled | §5.1 `$09` gives the fetch schedule, the screen sizes and the CG bit; §5.3 the per-sprite CG bit → #47/#9. |
| 6. CR half-modelled | §5.1 `$05` gives the full bit layout, BB/SB "clip" and "letterbox" uses, and the burst lock (§15.3 item 5); EX/TE still have no use case → #47. |
| 7. No read path | §5.1 and §6 give both read sequences, the buffer rules and the VCE read-back bits → #47. |
| 8. VRAM→VRAM absent | §5.4 settles the register semantics and contradicts H7-12 on an overrun → #49. |
| 9. 16-strip budget | §5.3 confirms the 16-entry buffer, a 32-px sprite as two entries, and "the left half … the right half is not displayed" when one slot is left — which `collectStrips` already implements — and overflow even for off-screen sprites. The HBlank/search limit is acknowledged but "the exact relation … is unclear". |
| 10. Status not modelled | §5 gives the conditions and the interrupt-enable gate → #50. |
| 11. Output scale | **Not settled**: no analogue levels in either note → GAP 13. |
| 12. Border half-used | §5.1/§6 split the overscan (`$100`) from the active-area backdrop (`$000`); the renderer's single `$100` fill for BB clear is §15.3 item 1. |
| 13. No CPU hardware in the ROM | §4 and §2.2 give the pad and timer semantics; the HES spec gives an independent I/O map (VSYNC `$FFF8`, timer `$FFFA`) → #45. |
| 14. Exporter caps | §3 says the measured card is 1 MB, not 2 MB → #46, #57, §15.3 item 2. |
| 15. Correct, worth recording | Confirms ×64 cells and the SAT bit positions (YF 15, CGY 13–12, XF 11, CGX 8, SPBG 7, palette 3–0), softening the "figure is the only source" caveat. Adds the size-masking rule (CGX masks pattern bit 0, CGY=1 bit 1, CGY=2/3 bits 2 and 1), which `pce-sprites.js` already applies. Says only **512** sprite patterns are usable on 32K words; our model reads past the array and draws those cells transparent, while hardware shows mirrored/garbage data. |

### 15.3 Where they contradict our renderer, viewer or exporter

1. **The background-off fill with sprites on.** `renderer/pce-bg.js`
   `renderIndices` fills every row with `$100` whenever CR bit 7 (BB) is clear,
   whatever bit 6 (SB) is. pcetech §6 says the active-area backdrop is colour 0
   of background palette 0 (`$000`) when "only the sprites" are enabled, and
   `$100` only when both layers are off; §5.1 says the same. Our Mednafen
   captures `tests/dumps/scene8c` (CR=`$40`, no sprites) and `sprite8`
   (CR=`$40`) both measured `$100` everywhere, so the renderer and the emulator
   agree **with each other** and disagree with the console note. If the note is
   right, every BB-off/SB-on picture is one palette entry wrong and every
   Mednafen-based check is blind to it. Only #8's real console can settle it.
   This is the most consequential contradiction found.
2. **The HuCard ROM limit.** `renderer/pce-rom.js` `MAX_ROM_BANKS = 256` let
   the exporter build 2 MB, citing `docs/MANUALS.md` and H8-10/11. pcetech §3,
   sgxtech's memory map and the HES map all put the card decode at `$00`–`$7F`
   = 1 MB. #46 had just closed (e7c547c) on "up to the HuCard limit"; that
   limit was disputed, and **#57 resolved it: `MAX_ROM_BANKS = 128` (1 MB)**,
   the card's decode, with the HuC6280's 2 MB / 256-block figure kept as the
   CPU's address space only. A legal picture still tops out at 108 banks
   (864 KiB) under the 13-descriptor config — a separate card.
3. **263 lines and VCE `$0400`.** `tools/genroms.py` calls `$04` "263-line
   mode"; `tools/ares-frame.py`'s `BLOCK_H` comment says "262 visible lines +
   the VCE extra line (CR bit 2)"; `docs/PLAN.md`'s note on #27 tells it to
   model the line select. pcetech §7 says the frame is 263 lines fixed and §6
   says bit 2 is edge blur. `tools/viewer.asm`'s "edge blur on" is the
   supported reading. Recommendation: #27 should not model a 262-line mode
   until a measurement shows one.
4. **Status flags and the interrupt-enable bits.** No code models them yet, but
   §3.6 of this document says "OR is set on an attempt at 17" without the
   condition. pcetech §5: a status bit is set only when its enable bit is set.
   #50 must model the gate, not just the condition.
5. **Burst-mode lock.** Our renderer latches CR per line, so clearing both BB
   and SB mid-frame blanks the rest of that frame. pcetech §5.1: if both are
   cleared by the time the next frame starts they are locked for that frame;
   clearing them *during* the display does not enter burst until the active
   display ends. No capture covers a both-off write inside a frame (#15's
   raster5 clears one bit at a time), so this is untested as well as
   unimplemented. → #50/#48.
6. **Patterns past the 32K-word VRAM.** `pce-bg.js` maps characters `>= $800`
   to colour 0, and `pce-sprites.js` reads cells `>= 512` past the array and
   draws them transparent. pcetech §5.2/§5.3 say writes to the mirrored upper
   half are ignored, reads may mirror or be corrupted, and the regions are
   "garbage", not colour 0. The `pce-bg.js` comment says "Measured on the
   hardware", but the evidence (#39 scene9) is a Mednafen capture; the note
   says a real console need not be blank. Pictures that stay inside 2,048
   background / 512 sprite patterns are unaffected.
7. **VRAM→VRAM overrun.** H7-12: cancelled, no done status. pcetech §5.4:
   halted and resumed. No model yet, so #49 must pick one and say why.
8. **PSG frequency register `F = 0`.** Hudson (P8-3/P8-9) says `F = 0` is
   forbidden. pcetech §10: `$000` is the lowest frequency, `$001` the highest,
   `$FFF` the next-to-lowest. #34 must measure or decide; the manual row is
   the weaker of the two.
9. **CD-sense polarity at `$1000` bit 7.** pcetech §4: 1 = not attached.
   sgxtech "I/O port": 1 = device present. Same author, two notes, opposite.
   CD-only, no studio impact, but do not cite either without a date.
10. **Palette writes during display.** pcetech §6 "Palette flicker": a CPU
    read/write of `$0404`/`$0405` during display makes the VCE repeat the last
    pixel, so a colour write smears horizontally and can bleed into the
    border. Our raster model changes a whole line's table cleanly; that is the
    right model for a static picture, but the preview is not pixel-exact for
    mid-line CRAM writes and no card says so.

### 15.4 Facts the notes add that no card covers

- **CSL/CSH are 3 cycles each**, measured at the same speed (switching cost
  unknown). §6/§8 record "no page or cycle is given" — this closes that
  silence for #31/#32, with the caveat stated.
- **Every VDC or VCE access costs one extra CPU cycle** (reads, writes and
  instruction execution), while CD registers do not. #32's frame-time
  validator must count it.
- **CPU behaviour for #31/#32**: block moves are uninterruptible, and a block
  read of `$0800`–`$1400` returns zero (so a TII cannot sample pads, timer or
  IRQ registers); `TAM #$00` writes no MPR and `TMA #$00` returns the last
  selected MPR; illegal opcodes are 2-cycle NOPs; a branch that crosses a page
  or bank costs nothing extra; `JMP (ind)` does not wrap at `$xxFF`;
  read-modify-write does a single read then a single write; decimal ADC/SBC do
  not change V; the B flag is set except in the P pushed by an interrupt.
- **VCE control bits** beyond the dot clock: `$0400` D7 = black-and-white,
  D2 = edge blur, D6–D3 no effect. No card owns these.
- **VRAM upper-half mirroring** (writes ignored, reads possibly corrupted) —
  the read/import path in GAP 8/#47 should not assume zeros.
- **The Turbo Tap reset quirk** (`$01` then `$03` returns directions while CLR
  is high) and the exact 2-button SEL/CLR protocol — #45's card now has a
  source.
- **The SuperGrafx VPC and SGX-mode register map** — #21's source.
- **The measured Vertical/Horizontal parameter tables** (192/224/240 lines;
  240–536 px) — #48's source.

### 15.5 The archive's "audio tools" — candidates for #34/#35

Listed through the GitHub API
(`api.github.com/repos/langel/pce-dev-kit/contents/audio%20tools`, 2026-10-28).
The folder holds six entries; names and sizes are the API's.

| Folder | Contents (API) | What it is | Candidate for #34/#35 |
|---|---|---|---|
| `wave editor/` | `heswav001.exe` (90,312), `heswav_eng.txt` (4,428), `wavlist/` | A Windows PSG waveform editor ("HuSIC wave editing support program", built in HSP 2.61) that edits the 32-step wave and saves `.wavlist` files | A human tool, binary, no source and no licence: not reusable; the `.wavlist` shape may inform #35's wave format |
| `wav2pce/` | `wav2pce.c` (7,912), `lowpass.c`, `linkwitz_riley_crossover.c`, `linux_build.sh`, `osx_build.sh`, `wav2pce`, `wav2pce.app`, sample `.wav`/`.bin` pairs | C converter: WAV → 5-bit DDA stream at 6992.1875 Hz (7.16 MHz / 1024), 8/16/32-bit input | **Best candidate**: source available; the DDA rate matches pcetech §2.2. No licence file in the folder — read the C and check terms before importing |
| `vgm_wavetable_ripper/` | `index.html` (6,184), `pako.min.js` (46,860) | Browser tool: drop a VGM/VGZ containing HuC6280 writes; it extracts sets of 32 wave-table writes | **Candidate for #35's import path**: pure JS, but VGM-shaped, not our dump model; pako is MIT/zlib |
| `ab_Squirrel3 Public/` | `MANUAL.txt` (43,994), `mml2pce.exe`, `sound.asm`, `psg_bios.asm`, `squirrel.s/.c/.pce`, `sngInit.c`, `startup.asm`, `SongLib/`, `mml/`, `data/`, `Sub/` | Squirrel v3, an MML/WSG music and sound-effect system, with Hudson's Hu7/Develo PSG BIOS library | Most relevant for PSG driver semantics and a music path, but **no licence text in the archive** — the Aetherbyte page is the place to check; do not import before that |
| `nezplug/` | `in_nez.dll` (159,744), `in_nez.ini` (299) | A Winamp input plugin that plays HES (and KSS/GBS/NSF); binary only | A reference player for #34's "matches by ear" and for HES; no source, not reusable |
| `AudioOverload64/` | `aowin64.exe`, `aocoreVC.dll`, `readme.txt` | A multi-system emulator/player; binary only | Listening reference only |

Verdict: **adapt** `wav2pce`'s DDA converter and `vgm_wavetable_ripper`'s wave
extraction; **read** Squirrel for driver semantics but not import it until its
licence is known; the other three are human tools or reference players. None of
this settles GAP 14's noise polynomial.

### 15.6 The other two documents

- **`hes spec.txt`** — HES music format v1.00 (Mamiya, 2000): header `HESM`,
  version, start song, request address, initial MPR0–7 (`$FF`, `$F8`, …,
  `$00`), then a `DATA` chunk with a physical load address. Logical `$FFF8` /
  `$FFFA` are the VSYNC and timer vectors; the I/O map gives VDC
  `1FE000`–`1FE003` ("VSYNC ONLY"), PSG `1FE800`–`1FE809`, timer
  `1FEC00`/`1FEC01`, IRQ `1FF402`/`1FF403`. It is a *player* format, not a
  hardware source; its ROM/RAM map independently shows a 1 MB ROM and 32 KB
  RAM (the SGX range). Candidate for #34/#35 only.
- **`Hu7CD_final.pdf`** — a 10-page extract of the Hu7 CD System manual: cover,
  contents, Part 1 ch.1–2 ("Outline", "Hardware Configuration") and the Part 2
  "PSG DRIVER" divider. It lists the development hardware (620 MB hard disk,
  an expansion I/O box with CDPCM and ADPCM boards, a SCSI host adapter, a CD
  system board equivalent to the IFU-30, a PC-9801VX) and the PSG driver's 21
  calls and the track/wave/envelope data fields in its contents. No
  register-level facts and nothing for the HuCard studio; it corroborates the
  CD PSG driver card list in §11.2 and belongs to #22/#35 only. Pages 12–37
  (the driver's own chapters) are absent from the extract.

### 15.7 Verdict

The notes are strongest where the Hudson scans are weakest: the display window
and border (GAP 1), the status flags (GAP 6), the SuperGrafx (GAP 12), the
access-width modes (GAP 9) and the read path (GAP 8). They close neither the
VCE's analogue output scale (GAP 13) nor the PSG noise polynomial (GAP 14) —
so both still need a real-console measurement, and no document in this archive
substitutes for it. Their one direct hit on a planned card is GAP 7: the
262/263-line select is not supported by measured behaviour, so #27's note
should be revisited before that work is built. Their one direct hit on the
code is the BB=0/SB=1 backdrop, where our renderer and Mednafen agree against
the console note.

## 16. The raster-interrupt chain's ground (card #16)

The #16 viewer runs a #15 raster table from the RCR interrupt — one step per
matched line, armed and executed inside the line's HBlank.  Everything this
card's timing rests on, beyond the §3 rows above:

**The worked handler (Tech Notes pp. 8–13).** Hudson's own irq1 example is
the pattern the chain follows: `AR equ $0000, SR equ $0000, 7UP_LOW equ
$0002, 7UP_HIGH equ $0003`; `pha/phx/phy`, `lda SR` (the status read clears
the RR bit and the level-sensed IRQ1 — §5.2), then `bbs2`/`bbs5` to tell the
raster interrupt from the VBlank.  The viewer's handler drops the register
saves — its main loop is `bra loop` and touches nothing the handler uses, so
P needs no preservation — and keeps the status read in the chain's tail,
after the next step's RCR is armed.  The RCR counter is always set to 64 at
the vertical sweep's start (§3), so RCR < 64 never fires: a table step for
display line L arms `0x40 + L`, and RCR = 0 disables.  The status-line split
on the same pages gives the mid-line register rules: BXR/BYR written during
display take effect on the NEXT scanning line (BYR one line later than BXR —
the BYR+1 rule, H7-7), CR bit 6 drops the sprite band.

**The HBlank budget (Mednafen 1.32.1's phase machine, the timing oracle).**
`src/hw_video/huc6270/vdc.cpp` (`/Volumes/External II/pce-tools/mednafen`),
`IncRCR()` and `Run()`: the raster counter is compared against RCR **after**
it is incremented at the end of each line (`RCRCount++`, match when
`RCRCount == RCR - 0x40` and CR's RC bit is set — so RCR `0x40`, line 0,
fires as the display window's first line starts), and the phase machine
places that match 4 VDC master clocks before the HBlank ends.  At 4 VDC
masters = 5.33 CPU cycles of HBlank left when the interrupt fires, the
interrupt sequence costs 7 cycles (push PCH/PCL/P, fetch vector), and the
line's display starts 122.7 CPU cycles after the match — the practical
budgets from handler entry: the BYR latch ~78–81 cycles in, the BXR latch,
the CR latch and the colour-table write window ~111–115 cycles in
(HDS=2, HSW=2, HDW=31, HDE=4 — the viewer's HSR/HSR init `$0202`/`$041F`).
A handler step must finish its writes inside these latches, not merely
inside the line.  The viewer's worst step (every op bit set, and its eight
value reads crossing packed-array page boundaries) is ~108 cycles — inside
the ~111 budget by construction, with the headroom documented in
[`DECISIONS.md`](DECISIONS.md) (§16's rejection of the record walker) and the
array packing that keeps the reads cheap in [`ROM_LAYOUT.md`](ROM_LAYOUT.md).
BXR/BYR/CR writes use the §3 register sequence (AR, low byte, high byte,
H7-25); colour-table writes go through `$0402/$0403` (address) and
`$0404/$0405` (data).

**The frame-counter mode.** Tables whose values move every frame (r4's
gradient) carry flags bit 0: the handler adds the zero-page frame counter to
each colour-table value (masked to 9 bits) before writing, and the chain's
tail bumps the counter each wrap.  The zero-page cells step `< $30` and
counter `< $31` (BaseRAM `[0x30]`/`[0x31]` in the save state) are the #15
scene ROMs' contract, which `tools/raster-patch.py` reads back to fold the
runtime counter into the dump's table — the same cells the viewer uses.

## 17. What was not done

- No manual text was copied into this repo beyond the few quoted phrases.
- The CD manuals are mapped to idea #22 only; no CD path is proposed for
  Phase 1–6, and the ADPCM/linear-PCM parts have no card at all (they are a
  sound-engine question for #34/#35 if a CD target is ever real).
- The SuperGrafx (idea #21) is not covered by any *Hudson* manual in this set.
  It is covered by Charles MacDonald's measured sgxtech notes, read in §15;
  #21 may use those, with the caveats stated there.
- Register names and page numbers are as printed. Where the figure is the only
  source (SAT bit positions, VCE CR bits 2–7), that is said in place; those are
  the places a future card must not cite a page for. §15 now supplies measured
  descriptions of both, so a card may cite the note instead — but not a page.
- The four documents in §15 were read from a read-only archive outside this
  repo and are not vendored: the archive's Unlicense does not cover them.
