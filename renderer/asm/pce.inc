;;
;; pce.inc — the PC Engine's hardware, as PCEAS equates.  (card #231)
;;
;; Written for PCEStudio from docs/MANUALS.md, the studio's reading of the
;; Hudson manuals — VDC (H7-x), VCE (H6-x), HuC6280 hardware (H8-x) and the
;; PSG (PB-x) — plus the measured notes in MANUALS §15 where a manual says
;; nothing (marked "measured" below).  Every name carries its page; nothing
;; here is copied from HuC or any other SDK, and the names are our own.
;;
;; Use:
;;
;;         .include "pce.inc"
;;
;; The studio and the MCP server answer this include name themselves — it is
;; built in — so an assembly project needs no copy of this file.  (PCEAS
;; 3.23 accepts both `NAME = $12` and `.equ NAME, $12`; this file uses the
;; plain form, as our examples do.)
;;
;; The addresses below are LOGICAL and need MPR0 = $FF (I/O) before use:
;; the device map is VDC $0000-$0003, VCE $0400-$0407, PSG $0800-$080F,
;; timer $0C00/$0C01, joypad $1000, IRQ $1402/$1403 (H8-24).
;;
;; The VDC is programmed through st0/st1/st2 (PCEAS's own mnemonics for the
;; register-address / data-low / data-high write sequence): a register name
;; below goes in st0, e.g. `st0 #VDC_CR / st1 #CR_BB / st2 #$00`.
;;

;; ---- 1. memory, the MPRs, zero page, stack ------------------------------

;; The CPU sees 64 KB through eight 8 KB windows; the TAMi/TMAi value names
;; the physical 8 KB block (S8-10, H8-9).  Blocks $00-$F6 are HuCard ROM —
;; a HuCard decodes $00-$7F, 1 MB (H8-10/11, MANUALS §15.1 GAP 4) — and
;; $F7-$FF are the fixed pages below.
MPR_SAVE_RAM    = $F7          ; save RAM (H8-9; the tutorial names it, MANUALS §5.3)
MPR_RAM         = $F8          ; 8 KB work RAM at $1F0000-$1F1FFF (H8-9)
MPR_IO          = $FF          ; the I/O block, $1FE000-$1FFFFF (H8-9, H8-24)

ZEROPAGE        = $2000        ; zero page (H8-3)
STACK           = $2100        ; the 256-byte stack (H8-3, H8-11)

;; ---- 2. the interrupt vectors ------------------------------------------

;; The five vectors sit in the last ten bytes of a bank (H8-12/13).  The
;; HuCard builder (renderer/pce-card.js) checks the reset vector at the end
;; of the first bank; after reset MPR7 = 0, so the machine boots from
;; physical bank 0 (H8-18, measured).
VEC_IRQ2        = $FFF6        ; also BRK (H8-17)
VEC_IRQ1        = $FFF8
VEC_TIMER       = $FFFA
VEC_NMI         = $FFFC
VEC_RESET       = $FFFE

;; ---- 3. VDC (HuC6270) — logical $0000-$0003 ----------------------------

VDC_REG         = $0000        ; read: status; write: register address (H7-3, H7-25)
VDC_REG_H       = $0001        ; register address, high byte
VDC_DATA        = $0002        ; read/write data, low byte (H7-25)
VDC_DATA_H      = $0003        ; data, high byte

;; Register numbers (write to VDC_REG).  R04 is forbidden (H7-3).
VDC_MAWR        = $00          ; VRAM write address (H7-5)
VDC_MAAR        = $01          ; VRAM read address (H7-5)
VDC_VWR         = $02          ; VRAM data, write port (H7-5)
VDC_VRR         = $02          ; VRAM data, read port — same number (H7-5)
VDC_CR          = $05          ; control (H7-6)
VDC_RCR         = $06          ; raster line compare (H7-6)
VDC_BXR         = $07          ; background X scroll (H7-7)
VDC_BYR         = $08          ; background Y scroll (H7-7)
VDC_MWR         = $09          ; memory width (H7-8/9)
VDC_HSR         = $0A          ; horizontal sync (H7-7)
VDC_HDR         = $0B          ; horizontal display (H7-7)
VDC_VPR         = $0C          ; vertical sync (H7-7)
VDC_VDR         = $0D          ; vertical display (H7-7)
VDC_VCR         = $0E          ; vertical display end (H7-7)
VDC_DCR         = $0F          ; DMA control (H7-11)
VDC_SOUR        = $10          ; DMA source (H7-12)
VDC_DESR        = $11          ; DMA destination (H7-12)
VDC_LENR        = $12          ; DMA length; LENR = words - 1; the write of the
                               ; HIGH byte starts the transfer (H7-12, §15.1 GAP 2)
VDC_DVSSR       = $13          ; DMA VRAM-SATB source (H7-12)

;; Status (read from VDC_REG).  D5-D0 clear on a read, and a flag is set
;; only if its interrupt-enable bit is set (H7-4, §15.1 GAP 6).
SR_CC           = $01          ; sprite collision (H7-4)
SR_OR           = $02          ; sprite overflow (H7-4)
SR_RR           = $04          ; raster hit (H7-4)
SR_DS           = $08          ; DMA done (H7-4)
SR_DV           = $10          ; vertical blank (H7-4)
SR_VD           = $20          ; vertical display (H7-4)
SR_BSY          = $40          ; the CPU's VRAM access is in flight (H7-4)

;; CR fields.  Or together and write with st1/st2.
CR_IE_CC        = $01          ; IRQ on sprite collision (H7-6)
CR_IE_OC        = $02          ; IRQ on sprite overflow (H7-6)
CR_IE_RC        = $04          ; IRQ on raster hit (H7-6)
CR_IE_VC        = $08          ; IRQ on vertical blank (H7-6)
CR_EX_IN        = $00          ; EX: both pins inputs (H7-6)
CR_EX_VSYNC_IN  = $10          ; EX: VSYNC input (H7-6)
CR_EX_OUT       = $30          ; EX: both pins outputs (H7-6)
CR_SB           = $40          ; sprites on; next horizontal display (H7-6)
CR_BB           = $80          ; background on; next horizontal display (H7-6)
CR_TE_DISPLAY   = $00          ; DISP pins: display position (H7-6)
CR_TE_BURST     = $100         ; DISP pins: burst position (H7-6)
CR_TE_HSYNC     = $200         ; DISP pins: internal HSYNC (H7-6)
CR_DR           = $400         ; DRAM refresh (SRAM VRAM ignores it) (H7-6)
CR_IW_1         = $000         ; MAWR/MAAR auto-increment, words (H7-6)
CR_IW_32        = $800
CR_IW_64        = $1000
CR_IW_128       = $1800

;; MWR fields.  VM/SM: code 0 = 1 dot, codes 1 and 2 are both 2-dot, code
;; 3 = 4-dot (H7-8; §15.1 GAP 9 measured).  SCREEN: code 0 = 32x32,
;; 1 = 64x32, 2 and 3 = 128x32, 4 = 32x64, 5 = 64x64, 6 and 7 = 128x64
;; (H7-8/9).  CM picks the 4-colour bitplane pair in 4-dot mode (H7-9).
MWR_VM_1DOT     = $00
MWR_VM_2DOT     = $01
MWR_VM_4DOT     = $03
MWR_SM_1DOT     = $00
MWR_SM_2DOT     = $04
MWR_SM_4DOT     = $0C
MWR_SCREEN_32x32 = $00
MWR_SCREEN_64x32 = $10
MWR_SCREEN_128x32 = $20
MWR_SCREEN_32x64 = $40
MWR_SCREEN_64x64 = $50
MWR_SCREEN_128x64 = $60
MWR_CM          = $80

;; DCR (H7-11): bits 0/1 are done-IRQ enables, bits 2/3 the decrement
;; selects, bit 4 the SATB auto-repeat.
DCR_DSC         = $01          ; SATB-done IRQ (H7-11)
DCR_DVC         = $02          ; VRAM-done IRQ (H7-11)
DCR_SDEC        = $04          ; source decrements (H7-11)
DCR_DDEC        = $08          ; destination decrements (H7-11)
DCR_DSR         = $10          ; VRAM->SATB auto-repeat, after the display (H7-11)

;; ---- 4. VCE (HuC6260) — logical $0400-$0407 ----------------------------

VCE_CR          = $0400        ; control (H6-3)
VCE_CTA_L       = $0402        ; colour table address (H6-3)
VCE_CTA_H       = $0403
VCE_CTW_L       = $0404        ; colour data (H6-3)
VCE_CTW_H       = $0405        ; the write of the HIGH byte commits the colour
                               ; and steps the address (H6-3/4)
;; A colour word is G8-6, R5-3, B2-0 (H6-3) — nine bits per channel.
;; The CR bits the manual documents are DCC (bits 1-0), the dot clock
;; division (H6-3); D2 edge blur, D7 black-and-white and D6-D3 no effect
;; are measured (MANUALS §15.1 GAP 7).  The examples set D2 and divide-by-4.
VCE_CR_DCC_DIV4  = $00          ; 5.37 MHz dot clock, 256 px wide (H6-3)
VCE_CR_DCC_DIV3  = $01          ; 7.16 MHz dot clock (H6-3)
VCE_CR_BLUR      = $04          ; edge blur (measured, §15.1 GAP 7)
VCE_CR_BW        = $80          ; black and white (measured, §15.1 GAP 7)

;; ---- 5. PSG (HuC6280's sound half) — logical $0800-$080F -----------------

;; R0 selects the channel that R1-R7 act on (0-5; a select alone makes no
;; sound); R2/R3 are the 12-bit frequency divider, low byte first; R4 is
;; channel control, R5 the per-channel balance; R6 is one 5-bit sample of
;; the 32-step wave (or the held level in DDA mode); R7 is noise; R8/R9 the
;; LFO (PB-2..PB-6).
PSG_SELECT      = $0800        ; channel select (PB-2)
PSG_MAINVOL     = $0801        ; main amplitude, one nibble per side (PB-3)
PSG_FREQ_LO     = $0802        ; frequency LSB (PB-3)
PSG_FREQ_HI     = $0803        ; frequency MSB, high 4 bits (PB-3)
PSG_CTRL        = $0804        ; channel control (PB-3)
PSG_BALANCE     = $0805        ; per-channel L/R volume (PB-4)
PSG_WAVE        = $0806        ; waveform data (PB-4)
PSG_NOISE       = $0807        ; noise enable and frequency, channels 4-5 (PB-6)
PSG_LFO_FREQ    = $0808        ; LFO rate (PB-6)
PSG_LFO_CTRL    = $0809        ; LFO trigger and depth (PB-6)

PSG_CTRL_ON     = $80          ; channel on (PB-3)
PSG_CTRL_DDA    = $40          ; DDA mode: the wave data is the held level (PB-3/4)

PSG_NOISE_ON    = $80          ; noise on (channels 4 and 5 only) (PB-6)

PSG_LFO_TRIGGER = $80          ; write 1 to restart the LFO cycle (PB-6/8)
PSG_LFO_OFF     = $00          ; LFO depth: off / 0-shift / 2-bit / 4-bit (PB-6/8)
PSG_LFO_0SHIFT  = $01
PSG_LFO_2BIT    = $02
PSG_LFO_4BIT    = $03

;; ---- 6. timer — logical $0C00/$0C01 -------------------------------------

;; 7-bit: the counter counts down from the reload value at 6.992 kHz
;; (fMASTER/1024, independent of CSL/CSH); $00 counts as 1 and $7F as 128;
;; an IRQ is raised on the 0 -> $7F underflow and the counter reloads at
;; once (H8-20/21, §15.1 GAP 3 measured).  Read the counter twice and
;; compare — one read can be invalid (H8-21).
TIMER_COUNTER   = $0C00        ; write: reload; read: downcounter (H8-20/22)
TIMER_CTRL      = $0C01        ; bit 0 START (H8-20/22)
TIMER_START     = $01
TIMER_1_TICK    = $00          ; reload values: 1 tick (H8-21, §15.1 GAP 3)
TIMER_128_TICKS = $7F          ; 128 ticks (H8-21, §15.1 GAP 3)

;; ---- 7. interrupt enable and request — logical $1402/$1403 ---------------

;; $1402 disables interrupts: 0 = enabled; all cleared (enabled) at reset
;; (H8-16, H8-18/24).  $1403 reads the requests — IRQ2, IRQ1, TIQ — and ANY
;; write to it resets the timer request (H8-15, §15.1 GAP 3).
IRQ_DISABLE     = $1402        ; H8-16, H8-24
IRQD_IRQ2       = $01          ; 1 = IRQ2 disabled (H8-16)
IRQD_IRQ1       = $02          ; 1 = IRQ1 disabled (H8-16)
IRQD_TIMER      = $04          ; 1 = timer IRQ disabled (H8-16)
IRQ_STATUS      = $1403        ; H8-15, H8-24
IRQR_IRQ2       = $01          ; request bits (H8-15)
IRQR_IRQ1       = $02
IRQR_TIQ        = $04          ; the timer request; any write resets it

;; ---- 8. joypad — logical $1000 ------------------------------------------

;; Not in any Hudson manual — the protocol below is the measured note
;; (MANUALS §15.1 GAP 3, pcetech §4) as our own runtime drives it
;; (tools/toyc/toy_runtime.c).  In short:
;;
;;   1. write PAD_TAP_RESET ($01 then $03) to reset the Turbo Tap so pad 1
;;      is next; the pad needs ~10 cycles after each write (a PHA/PLA/NOP/NOP
;;      works) before a read is stable;
;;   2. write PAD_SEL_1 ($01), wait, READ the pad — the D-pad is on D3-D0;
;;   3. write PAD_SEL_0 ($00), wait, READ the pad — the buttons are on D3-D0;
;;   4. repeat 2-3 for each pad the multitap holds.
;;
;; The inputs are INVERTED on the wire: a read bit is 0 while its button is
;; held.  The read byte also carries D7 CD sense, D6 country, and D5/D4
;; always 1 (measured, §15.1 GAP 3).
JOYPAD          = $1000
PAD_SEL_1       = $01          ; write: SEL high, the D-pad comes out on D3-D0
PAD_SEL_0       = $00          ; write: SEL low, the buttons come out on D3-D0
PAD_TAP_RESET   = $03          ; write (after $01): CLR 0 -> 1, back to pad 1

;; Read bits, 0 = held.
PAD_II          = $01          ; D0, SEL low (buttons)
PAD_I           = $02          ; D1
PAD_SELECT      = $04          ; D2
PAD_RUN         = $08          ; D3
PAD_LEFT        = $01          ; D0, SEL high (D-pad)
PAD_DOWN        = $02          ; D1
PAD_RIGHT       = $04          ; D2
PAD_UP          = $08          ; D3
PAD_CD_SENSE    = $80          ; D7: a CD-ROM^2 unit is attached (measured)
PAD_COUNTRY     = $40          ; D6: country (measured)
