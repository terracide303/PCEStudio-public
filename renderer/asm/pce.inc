;;
;; pce.inc — PCEStudio's hardware names for HuC6280 assembly (card #231)
;;
;; This file is ours.  The values come from the register tables in
;; docs/MANUALS.md, which cite the Hudson manuals by page (H7-x HuC6270 VDC,
;; H6-x HuC6260 VCE, H8-x HuC6280 hardware, S8-x software, P8-x PSG) and
;; Charles MacDonald's measured notes for the few fields the manuals leave
;; open.  No text or spelling is copied from HuC, HuCC or HuDK; where a
;; manual has no page for a bit, the comment says so.
;;
;; Use it from a PCEAS source:
;;
;;       .include "pce.inc"
;;
;; Every name is a `NAME = value` constant, so `.ifndef` sees it as defined
;; and including the file twice is harmless.  PCEAS writes a bare `$nn`
;; operand as a zero-page address, not an immediate; use `#` for values.
;;
.ifndef PCE_INC
PCE_INC = 1

;; ---------------------------------------------------------------------------
;; CPU: MPR banks and the card's memory map
;; ---------------------------------------------------------------------------
;; Eight MPRs each map one 8 KiB physical bank into one 8 KiB logical window.
;; TAMi/TMAi take a one-hot mask (H8-8, S8-10): MPR0 = $01, ..., MPR7 = $80.
MPR0_MASK = $01
MPR1_MASK = $02
MPR2_MASK = $04
MPR3_MASK = $08
MPR4_MASK = $10
MPR5_MASK = $20
MPR6_MASK = $40
MPR7_MASK = $80

BANK_SIZE       = $2000      ; 8 KiB in one MPR window
BANK_MASK       = $1FFF      ; the address bits inside one bank
CARD_BANK_FIRST = $00
CARD_BANK_LAST  = $7F        ; a HuCard decodes 128 banks = 1 MB
CARD_BANKS      = 128
CARD_BYTES      = $100000

BANK_WORK_RAM   = $F8        ; the 8 KiB work RAM (H8-9)
BANK_IO         = $FF        ; the device page

;; The MPR a program normally uses, from the reset state (H8-7/H8-18):
;; MPR7 = 0 after reset, so $E000-$FFFF is physical bank 0 and the reset
;; vector is at physical $1FFE/$1FFF.  The other windows are chosen by the
;; program; the viewer uses MPR0 = I/O and MPR1 = work RAM.
RESET_MPR7_BANK = $00

;; ---------------------------------------------------------------------------
;; Device windows, logical addresses with MPR0 = $FF (H8-24)
;; ---------------------------------------------------------------------------
VDC_REG       = $0000   ; write: register select (AR)
VDC_STATUS    = $0000   ; read:  status (SR)
VDC_DATA_LO   = $0002   ; VDC data, low byte
VDC_DATA_HI   = $0003   ; VDC data, high byte
VCE_CR        = $0400   ; VCE control
VCE_CTA_LO    = $0402   ; colour-table address, low
VCE_CTA_HI    = $0403   ; colour-table address, high
VCE_CTW_LO    = $0404   ; colour-table write, low
VCE_CTW_HI    = $0405   ; colour-table write, high (auto-increments CTA)
VCE_CTR_LO    = $0404   ; colour-table read, low
VCE_CTR_HI    = $0405   ; colour-table read, high (auto-increments CTA)
PSG_BASE      = $0800   ; PSG register 0; add the register number
TIMER_COUNT   = $0C00   ; write: reload; read: downcounter
TIMER_CONTROL = $0C01   ; bit 0 = start
JOY_PORT      = $1000   ; port K/O: read pads, write SEL/CLR
IRQ_DISABLE   = $1402   ; interrupt disable (0 = enabled)
IRQ_REQUEST   = $1403   ; read request; a write acknowledges the timer

;; ---------------------------------------------------------------------------
;; HuC6270 VDC — register numbers written to VDC_REG (AR)
;; ---------------------------------------------------------------------------
VDC_MAWR  = $00     ; VRAM write address
VDC_MAAR  = $01     ; VRAM read address
VDC_VWR   = $02     ; VRAM write data (low, then high starts the write)
VDC_VRR   = $02     ; VRAM read data
VDC_CR    = $05     ; control
VDC_RCR   = $06     ; raster compare
VDC_BXR   = $07     ; background X scroll (10 bits)
VDC_BYR   = $08     ; background Y scroll (9 bits)
VDC_MWR   = $09     ; memory width / screen geometry
VDC_HSR   = $0A     ; horizontal sync
VDC_HDR   = $0B     ; horizontal display
VDC_VPR   = $0C     ; vertical sync
VDC_VDR   = $0D     ; vertical display
VDC_VCR   = $0E     ; vertical front porch
VDC_DCR   = $0F     ; block-transfer control
VDC_SOUR  = $10     ; block-transfer source
VDC_DESR  = $11     ; block-transfer destination
VDC_LENR  = $12     ; block-transfer length (words - 1)
VDC_DVSSR = $13     ; VRAM-to-SATB source address

;; SR bits read at VDC_STATUS (H7-4).  A read clears CC/OR/RR/DS/DV;
;; BSY is not cleared.
VDC_SR_CC  = $01    ; sprite #0 collision
VDC_SR_OR  = $02    ; more than 16 sprite strips on a line
VDC_SR_RR  = $04    ; raster compare match
VDC_SR_DS  = $08    ; SATB transfer done
VDC_SR_DV  = $10    ; VRAM-to-VRAM transfer done
VDC_SR_VD  = $20    ; vertical blanking
VDC_SR_BSY = $40    ; a VRAM access is in flight

;; CR fields (H7-6)
VDC_CR_IE_CC  = $0001   ; enable the collision interrupt
VDC_CR_IE_OC  = $0002   ; enable the sprite-overflow interrupt
VDC_CR_IE_RC  = $0004   ; enable the raster-compare interrupt
VDC_CR_IE_VC  = $0008   ; enable the VBlank interrupt
VDC_CR_EX_BOTH_IN  = $0000
VDC_CR_EX_VSYNC_IN = $0010
VDC_CR_EX_BOTH_OUT = $0030
VDC_CR_SB  = $0040   ; sprites on
VDC_CR_BB  = $0080   ; background on
VDC_CR_TE_DISPLAY = $0000
VDC_CR_TE_BURST   = $0100
VDC_CR_TE_HSYNC   = $0200
VDC_CR_DR  = $0400   ; DRAM refresh addresses (unused on a HuCard)
VDC_CR_IW_1   = $0000   ; MAWR/MAAR step +1 word
VDC_CR_IW_32  = $0800   ; +32 words
VDC_CR_IW_64  = $1000   ; +64 words
VDC_CR_IW_128 = $1800   ; +128 words

;; MWR fields (H7-8/9).  The VM codes are 1, 2 and 4 dot clocks; the
;; measured notes say codes 1 and 2 both behave as 2-dot (MANUALS §15.1).
VDC_MWR_VM_1  = $00
VDC_MWR_VM_2  = $01
VDC_MWR_VM_4  = $03
VDC_MWR_SM_1  = $00
VDC_MWR_SM_2  = $04
VDC_MWR_SM_4  = $0C
VDC_MWR_SCREEN_32x32  = $00
VDC_MWR_SCREEN_64x32  = $10
VDC_MWR_SCREEN_128x32 = $20
VDC_MWR_SCREEN_32x64  = $40
VDC_MWR_SCREEN_64x64  = $50
VDC_MWR_SCREEN_128x64 = $60
VDC_MWR_CM = $80     ; 4-clock mode: colour group bit 7

;; DCR fields (H7-11)
VDC_DCR_DSC   = $01  ; SATB-transfer-done interrupt
VDC_DCR_DVC   = $02  ; VRAM-transfer-done interrupt
VDC_DCR_SRC_DEC = $04  ; source counts down instead of up
VDC_DCR_DST_DEC = $08  ; destination counts down instead of up
VDC_DCR_DSR   = $10  ; repeat the VRAM-to-SATB transfer every VBlank

;; Window register fields (H7-9/10/11).  The stored values are N-1 except
;; VDS (back porch - 2) and VCR (N, not N-1).
VDC_HSR_HSW_MASK = $001F
VDC_HSR_HDS_SHIFT = 8
VDC_HDR_HDW_MASK = $007F
VDC_HDR_HDE_SHIFT = 8
VDC_VPR_VSW_MASK = $001F
VDC_VPR_VDS_SHIFT = 8
VDC_VDR_VDW_MASK = $01FF
VDC_VCR_MASK     = $00FF

;; The canonical 256x240 window this repo's viewer writes (H7-9/10).
VDC_HSR_256x240 = $0202   ; HDS = 2, HSW = 2
VDC_HDR_256x240 = $041F   ; HDE = 4, HDW = 31
VDC_VPR_256x240 = $0F02   ; VDS = 15, VSW = 2
VDC_VDR_256x240 = $00EF   ; VDW = 239 (240 lines)
VDC_VCR_256x240 = $000C

;; RCR counts from 64 at the top of the sweep, so RCR = scan line + $40;
;; values below $40 never fire (Tech Notes pp. 8-9).
VDC_RCR_BASE = $40

;; ---------------------------------------------------------------------------
;; VRAM words
;; ---------------------------------------------------------------------------
;; BAT word: 12-bit character code + 4-bit palette (H7-14).
BAT_CHAR_MASK = $0FFF
BAT_CG_SHIFT  = 12
BAT_CG_MASK   = $F000
;; A BAT word is `char | (cg << BAT_CG_SHIFT)`; write the shifts out, because
;; PCEAS' `=` is a constant, not a function.

;; One background character is 16 VRAM words: four 8x8 planes, CH0..CH3.
CHAR_WORDS = 16
CHAR_MASK  = $0FFF

;; A sprite pattern code addresses a 64-word cell: four 16-word SG blocks
;; (H7-24).  In the SAT the pattern code sits in bits 1-10 of word 2; bit 0
;; is the 4-colour mode select.
SPRITE_CELL_WORDS = 64
SAT_PATTERN_SHIFT = 1
SAT_PATTERN_MASK  = $07FE
SAT_4COLOUR      = $0001

;; SAT word 3 fields (H7-21; bit positions are the figure and this repo's
;; measured sprite scenes, MANUALS §13).
SAT_W3_PAL_MASK = $000F
SAT_W3_SPBG     = $0080   ; 1 = in front of the background
SAT_W3_CGX      = $0100   ; two sprites side by side
SAT_W3_HFLIP    = $0800
SAT_W3_CGY_SHIFT = 12
SAT_W3_CGY_MASK  = $3000
SAT_W3_VFLIP    = $8000

;; SAT word 0/1 are Y and X, 10 bits each; the display's top-left corner is
;; SAT coordinate (32,64) (H7-21).
SAT_Y_MASK = $03FF
SAT_X_MASK = $03FF
SAT_X_ORIGIN = 32
SAT_Y_ORIGIN = 64
SAT_ENTRIES = 64
SAT_WORDS   = SAT_ENTRIES * 4
SAT_VRAM_WORD = $7F00     ; the viewer puts the SAT here for the DSR DMA

;; ---------------------------------------------------------------------------
;; HuC6260 VCE — 512 x 9-bit colours (H6-1/3/4/5)
;; ---------------------------------------------------------------------------
VCE_COLOURS = 512
;; A colour word is G bits 8-6, R bits 5-3, B bits 2-0.
VCE_G_SHIFT = 6
VCE_R_SHIFT = 3
VCE_B_SHIFT = 0
VCE_CHANNEL_MASK = $07
VCE_COLOUR_MASK  = $01FF
;; $100 is colour 0 of the first sprite palette: the border/overscan colour
;; (Tech Notes pp. 1-2).  $000 is the background's colour 0.
VCE_BORDER_INDEX  = $100
VCE_BACKDROP_INDEX = $000

;; VCE CR ($0400) fields.  DCC bits 1-0 pick the dot clock.  The manual
;; gives two values (H6-3); the /2 clock and D2 are from measured notes
;; (pcetech §6) and D2's meaning is NOT PROVEN (MANUALS §15.3).
VCE_CR_CLOCK_4 = $00    ; /4, 5.37 MHz, 256-dot display
VCE_CR_CLOCK_3 = $01    ; /3, 7.16 MHz, 336-dot display
VCE_CR_CLOCK_2 = $02    ; /2, 10.74 MHz, 512-dot display
VCE_CR_CLOCK_2B = $03   ; the same /2 clock (measured notes)
VCE_CR_DCC_MASK = $03
VCE_CR_D2 = $04         ; edge blur / line select: NOT PROVEN
VCE_CR_MONO = $80       ; black and white

;; ---------------------------------------------------------------------------
;; HuC6280 PSG — ten registers reached through PSG_BASE (P8-2)
;; ---------------------------------------------------------------------------
PSG_R0_CHANNEL   = PSG_BASE + 0   ; $0800 channel select (0-5)
PSG_R1_MAIN_VOL  = PSG_BASE + 1   ; $0801 L/R master level, one nibble each
PSG_R2_FREQ_LO   = PSG_BASE + 2   ; $0802 frequency, low 8 bits
PSG_R3_FREQ_HI   = PSG_BASE + 3   ; $0803 frequency, high 4 bits (F != 0)
PSG_R4_CONTROL   = PSG_BASE + 4   ; $0804 on, DDA, 5-bit attenuation
PSG_R5_CHAN_VOL  = PSG_BASE + 5   ; $0805 L/R channel level, one nibble each
PSG_R6_WAVE      = PSG_BASE + 6   ; $0806 5-bit wave sample
PSG_R7_NOISE     = PSG_BASE + 7   ; $0807 noise on + 5-bit frequency (ch 5/6)
PSG_R8_LFO_FREQ  = PSG_BASE + 8   ; $0808 LFO frequency
PSG_R9_LFO_CTRL  = PSG_BASE + 9   ; $0809 LFO trigger + shift

PSG_CHANNELS = 6
PSG_WAVE_LENGTH = 32              ; 32 five-bit samples per cycle
PSG_WAVE_MASK   = $1F

PSG_CTRL_ON    = $80
PSG_CTRL_DDA   = $40
PSG_CTRL_AL_MASK = $1F             ; 1.5 dB per step, max at $1F
PSG_VOL_MASK   = $0F               ; one 4-bit level per side (3 dB/step)
PSG_VOL_LEFT_SHIFT = 4             ; high nibble = left
PSG_VOL_RIGHT_SHIFT = 0            ; low nibble = right
PSG_NOISE_ON   = $80
PSG_NOISE_FREQ_MASK = $1F
PSG_LFO_TRIGGER = $80
PSG_LFO_CTRL_MASK = $03
PSG_LFO_OFF     = 0
PSG_LFO_SHIFT_1 = 1
PSG_LFO_SHIFT_2 = 2
PSG_LFO_SHIFT_4 = 3

;; ---------------------------------------------------------------------------
;; Timer (H8-20/21, pcetech §2.2)
;; ---------------------------------------------------------------------------
TIMER_RELOAD_MASK = $7F      ; 7-bit reload; $00 counts as 1 tick
TIMER_START       = $01      ; TIMER_CONTROL bit 0
TIMER_TICKS_PER_SEC = 6991   ; OSC1 / 3 / 1024 at 21.48 MHz

;; ---------------------------------------------------------------------------
;; Interrupt controller (H8-15/16, H8-24)
;; ---------------------------------------------------------------------------
IRQ_DISABLE_NONE  = $00      ; 0 = enabled
IRQ_DISABLE_IRQ2  = $01
IRQ_DISABLE_IRQ1  = $02
IRQ_DISABLE_TIMER = $04
IRQ_REQUEST_IRQ2  = $01
IRQ_REQUEST_IRQ1  = $02
IRQ_REQUEST_TIMER = $04

;; Vectors, at the end of the bank mapped to $E000-$FFFF (H8-12/13).
VECTOR_IRQ2 = $FFF6
VECTOR_IRQ1 = $FFF8
VECTOR_TIMER = $FFFA
VECTOR_NMI  = $FFFC
VECTOR_RESET = $FFFE

;; ---------------------------------------------------------------------------
;; Joypad, port K at $1000 (H8-19; protocol from pcetech §4, PADS.md)
;; ---------------------------------------------------------------------------
;; A write drives SEL (bit 0) and CLR (bit 1); a read returns K.  The inputs
;; are inverted: 0 means pressed.  The five-pad read is
;;     write $01, write $03          ; reset the tap to pad 1
;;     for each pad:
;;       write $01, delay, read     ; SEL = 1: the D-pad
;;       write $00, delay, read     ; SEL = 0: the buttons
;; A short delay after every SEL change is required.
JOY_SEL = $01
JOY_CLR = $02
JOY_CLR_ENABLE = $00      ; CLR low enables the port
JOY_CD = $80              ; D7: CD sense (polarity differs between sources)
JOY_COUNTRY = $40         ; D6: 0 = Japan, 1 = US
JOY_ALWAYS_HIGH = $30     ; D5/D4 read 1
JOY_NONE = $0F            ; an unconnected pad reads $0F

;; SEL = 1 (D-pad), D3..D0
JOY_PAD_LEFT  = $08
JOY_PAD_RIGHT = $04
JOY_PAD_DOWN  = $02
JOY_PAD_UP    = $01
;; SEL = 0 (buttons), D3..D0
JOY_BTN_RUN    = $08
JOY_BTN_SELECT = $04
JOY_BTN_II     = $02
JOY_BTN_I      = $01

.endif
