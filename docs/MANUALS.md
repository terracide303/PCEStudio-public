# MANUALS — every manual read, every capability mapped to a card or a gap

Card #44. The hardware facts below come from the Hudson manuals in
`/Volumes/External/MiniST_Project/PCEHeroTN/docs/datasheets/`, read **in full**
(not grepped), plus two non-Hudson documents that are marked as such. Nothing
here is copied beyond a few quoted words with a page; the manuals stay where
they are.

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

The PDFs in `datasheets/` are the same scans. They were opened only where the
`.txt` is unreadable; the places and what they settled are in §13.

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
| 7 | **262 or 263 lines.** CR bit 2 of the VCE is not modelled; the raster table and any frame clock assume one frame length. | RCR line numbers and a 60 Hz budget both move by a line when a game picks the other; #27 changes the width and would inherit this. | "262 or 263 lines: the VCE's frame length in the model; a 263-line capture and what it does to RCR." |
| 8 | **Reading it back.** MAAR/VRR (VRAM) and CTR (colour table) are unmodelled; nothing can import or verify a write. | The studio's VRAM map and "what is free" (#26) and any import from a running ROM need the read path, and the VDC manual gives it a page. | "Reading it back: MAAR/VRR and CTR in the model; import a dump read from a running ROM." |
| 9 | **The access-width modes.** MWR's VM (1/2/4 clocks), SM and CM (4 colours out of 256; 2-dot 4-colour sprites) are unmodelled and unmentioned by any card. | Not on SPEC's list — but it is the one VDC mode that changes the colour count, and a "real hardware rules" studio should either offer it or say why not. | "4-colour and 4-clock modes: VM/SM/CM; one ROM in 4-dot mode; a capture; or a written decision not to offer them." |
| 10 | **The 6-button pad.** SPEC says "2- or 6-button pads"; no manual in this set documents the 6-button protocol, and the tutorial's pad read is 2-button only. | A claim in the goal document with no source behind it — exactly what #44 exists to find. | "The 6-button pad: find a source for the protocol and implement it, or strike the claim from SPEC." |
| 11 | **The VDC's pin modes.** EX (external sync) and TE (DISP output select) are documented and unused; no card says whether the console ever wants them. | Low: the console runs the defaults. But it is a whole register field with no home, and a SuperGrafx or arcade-board path would need it. | "The VDC's pins: EX and TE documented in the model and marked never-used on a console — or a worked reason one is needed." |
| 12 | **SuperGrafx has no manual here.** Idea #21 (two background layers) rests on no source in this set. | Phase 2's "PC Engine's own tricks" would be a different console; #21 is an idea and should stay one until sourced. | "Source the SuperGrafx before #21: its second VDC/VCE and the extra RAM, with pages." |
| 13 | **The VCE's missing page.** 2.3–2.5 (sync generator, **RGB outputs**, colour-difference outputs) are listed on H6-6 and are absent from both the text and the PDF; the 8-bit output scale is therefore not settled by any manual. | #41 closed with the 3-bit colour proven and the 8-bit scale explicitly not; every exported picture's brightness rests on it. | "Settle the output scale: the missing VCE page, or a measured step from the real console." |
| 14 | **The PSG's noise generator is under-specified.** The manual gives the noise clock frequency (P8-9) but no shift-register polynomial or tap points. | #34 must match Mednafen by ear, which cannot distinguish "same noise" from "noise that sounds the same"; a studio that exports music needs the real generator. | "The noise generator: pin down the LFSR against Mednafen and the real console before #34 closes." |

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
| ROM capacity: 256 banks of 8 KB = 2 MB physical; our console's 64 KB VRAM and banked ROM are not the same limit | H8-10/11 | **GAP 4** |

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
| The VCE owns the raster: 2,730 clocks a line at 42.95 MHz (63.6 µs), **262 or 263 lines a frame (CR bit 2)**, no interlace | #27; frame length → **GAP 7** | CR bit 2 is **not in the VCE manual's text** — it is RTL-derived |
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

1. **"256x224" is wrong in three places; the ROM is 256×240.** `HDR` is
   `$041F` (HDW=31 → 32 characters = 256 px) and `VDW` is `$00EF` (240 lines):
   `tools/genroms.py:58-63` writes those values, `renderer/viewer.asm:141-150`
   writes them too (its own comment there says "VDR: 240 display lines"), and
   yet `renderer/pce-bg.js:5-6`, `tools/genroms.py:58` and
   `renderer/viewer.asm:7` ("sets the VDC to 256x224") all say 224. The model
   renders 232 of the 240 lines. Manual: H7-10 (VDW = N−1), H7-9 (HDW = N−1).
2. **The VCE control value is written as `$04` and called "edge blur on"**
   (`tools/viewer.asm:66-68`). The VCE manual's CR text (H6-3) documents only
   DCC bits 1–0: `$04` therefore selects the ÷4 (256 px) clock with bit 2 set,
   and **no manual page describes bit 2 as edge blur**. Per `VIDEO_MODES.md`
   it is the 262/263-line select. The comment (and HuDK's) is unsupported.
3. **`genroms.py` labels DCR bit 4 "sprite layer on"** (`tools/genroms.py:295`);
   bit 4 is DSR, the SATB auto-repeat. Sprites are CR bit 6 (H7-11, H7-6).
   `viewer.asm` has the same register right; only the comment is wrong.
4. **The display window is not modelled at all.** The renderer never reads
   HSR/HDR/VPR/VDR/VCR; it assumes a 32×30-character window, 232 visible rows,
   and no border. A different window, a 224-line picture, or anything in the
   border would render wrong and no test would catch it (`pce-bg.js:240-311`).
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
9. **The sprite budget is hard-coded to 16 strips**, which is what the tests
   measured, but the manual's limit is "16 sprites" *plus* a search limit that
   depends on HBlank and SM (H7-19): with the 4-clock SM or a narrow HBlank the
   real limit is lower. Not modelled → tied to **GAP 9/GAP 1**.
10. **Status is not modelled.** CC/OR/DS/DV/VD never appear (H7-4); the model
    cannot report an overflow or a collision → **GAP 6**.
11. **The output scale is Mednafen's, not the VCE's.** `cramEntry` uses
    36 × n (`pce-bg.js:46-50`); the VCE manual's RGB-output section (H6-6) is
    missing from the scan, so the manual cannot settle 36n vs 255/7 → **GAP 13**.
12. **The border colour is only half used.** The renderer paints CRAM $100 for
    a background-off line (correct, H7-18 + Tech Notes p.1), but never paints
    it as the border around the window → **GAP 1**.
13. **No CPU-side hardware at all in the exported ROM:** the viewer never
    touches the timer, the pad port, the PSG or the IRQ vectors (they are `rti`
    stubs). That is correct for a static picture, but it means #30/#31 have no
    proven path yet → **GAP 3**, #34/#35.
14. **The exporter's caps are its own.** `MAX_TILE_BANKS = 6`, `MAX_REGIONS = 8`,
    `MAX_BAT_BANKS = 2` (`pce-rom.js:66-68`) = 80 KB images; the 8 KB MPR bank
    scheme allows 2 MB (H8-10/11) → **GAP 4**.
15. **Correct but worth recording (checked, no change needed):** the sprite
    pattern is *code × 64 words* (`pce-sprites.js:121-129`) matching H7-21/24
    and contradicting the tutorial's ">>5"; the 512-entry palette write wraps
    the 9-bit CTA exactly as H6-3 says (`viewer.asm:87-110`); the VDC's colour-0
    rule for the background (`pix===0 → 0x000`) is H7-18; sprite colour 0 is
    treated as transparent, which is the Tech Notes' "clear" rule (p.1), not a
    statement in the VDC manual.

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
| $0400 | VCE manual H6-3 (clock division); tutorial ("Palette Reset"); viewer's "edge blur" | **control register**; the tutorial and the comment are wrong. Bit 2 is unexplained by the manual (VIDEO_MODES: 262/263 lines) |
| Lines per frame | VIDEO_MODES (CR bit 2, 262/263); VCE manual (nothing) | **VIDEO_MODES only** — an RTL fact, not a manual fact |
| CPU cycle counts | Software Manual S8-17…; Tech Notes (119,904/frame) | agree when "cycles" = 7.16 MHz clocks in high-speed mode; **the manual never describes CSH/CSL**, so a validator must assume high speed after CSH (H8-18) |

## 15. What was not done

- No manual text was copied into this repo beyond the few quoted phrases.
- The CD manuals are mapped to idea #22 only; no CD path is proposed for
  Phase 1–6, and the ADPCM/linear-PCM parts have no card at all (they are a
  sound-engine question for #34/#35 if a CD target is ever real).
- The SuperGrafx (idea #21) is not covered by any manual in this set. Nothing
  in this document should be used to refine #21.
- Register names and page numbers are as printed. Where the figure is the only
  source (SAT bit positions, VCE CR bits 2–7), that is said in place; those are
  the places a future card must not cite a page for.
