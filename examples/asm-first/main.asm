;;
;; main.asm — the first program (card #231)
;;
;; ORIGINAL: written for PCEStudio, not copied from HuC or any example.
;;
;; It sets two background colours in the VCE, writes a blank tile and an
;; 8x8 solid tile into VRAM, marks one cell of a 32x32 tile map with the
;; solid tile, turns the background on, and loops forever.
;;
;; The visible result, stated as a picture (a 256x232 capture at the /4 dot
;; clock, captured row 0 = VDW line 0):
;;
;;     the whole screen      colour $000  = $007   RGB (0, 0, 252)
;;     x 32..39, y 32..39    colour 1     = $1F8   RGB (252, 252, 0)
;;
;; Build:   node tools/build-card.js examples/asm-first out.pce
;; Run:     mednafen -force_module pce out.pce
;;
        .include "pce.inc"

COLOUR_BACKDROP = $007       ; GGRRRBBB: green 0, red 0, blue 7
COLOUR_BLOCK    = $1F8       ; green 7, red 7, blue 0

TILE_BLANK      = $40        ; character code; 16 VRAM words each
TILE_BLOCK      = $41
TILE_BLANK_WORD = TILE_BLANK * CHAR_WORDS     ; $0400
TILE_BLOCK_WORD = TILE_BLOCK * CHAR_WORDS     ; $0410
MAP_CELL        = 4 * 32 + 4 ; BAT cell at column 4, row 4

        .code
        .bank 0
        .org $e000

reset:
        sei
        csh
        cld
        ldx #$ff
        txs
        lda #$ff
        tam0                       ; device page at $0000-$1fff
        lda #BANK_WORK_RAM
        tam1                       ; work RAM at $2000-$3fff

        ; ---- VCE: colour 0 and colour 1, then the /4 dot clock.
        ; CTA auto-increments after every high-byte write (H6-3/4).
        stz VCE_CTA_LO
        stz VCE_CTA_HI
        lda #(COLOUR_BACKDROP & $ff)
        sta VCE_CTW_LO
        lda #(COLOUR_BACKDROP >> 8)
        sta VCE_CTW_HI
        lda #(COLOUR_BLOCK & $ff)
        sta VCE_CTW_LO
        lda #(COLOUR_BLOCK >> 8)
        sta VCE_CTW_HI
        lda #(VCE_CR_CLOCK_4 | VCE_CR_D2)
        sta VCE_CR

        ; ---- VDC: all layers off while the data goes in (H7-6), the
        ; canonical 256x240 window and a 32x32 tile map.
        st0 #VDC_CR
        st1 #$00
        st2 #$00
        st0 #VDC_RCR
        st1 #$00
        st2 #$00
        st0 #VDC_BXR
        st1 #$00
        st2 #$00
        st0 #VDC_BYR
        st1 #$00
        st2 #$00
        st0 #VDC_MWR
        st1 #VDC_MWR_SCREEN_32x32
        st2 #$00
        st0 #VDC_HSR
        st1 #(VDC_HSR_256x240 & $ff)
        st2 #(VDC_HSR_256x240 >> 8)
        st0 #VDC_HDR
        st1 #(VDC_HDR_256x240 & $ff)
        st2 #(VDC_HDR_256x240 >> 8)
        st0 #VDC_VPR
        st1 #(VDC_VPR_256x240 & $ff)
        st2 #(VDC_VPR_256x240 >> 8)
        st0 #VDC_VDR
        st1 #(VDC_VDR_256x240 & $ff)
        st2 #(VDC_VDR_256x240 >> 8)
        st0 #VDC_VCR
        st1 #(VDC_VCR_256x240 & $ff)
        st2 #(VDC_VCR_256x240 >> 8)

        ; ---- tile pattern $40: 16 zero words, every pixel colour 0
        st0 #VDC_MAWR
        st1 #(TILE_BLANK_WORD & $ff)
        st2 #(TILE_BLANK_WORD >> 8)
        st0 #VDC_VWR
        ldx #CHAR_WORDS
blank_tile:
        stz VDC_DATA_LO
        stz VDC_DATA_HI
        dex
        bne blank_tile

        ; ---- tile pattern $41: CH0 all ones (colour 1 everywhere),
        ; CH1..CH3 zero.  A row's two low planes share one VRAM word:
        ; the low byte is CH0 and the high byte CH1, and CH2/CH3 are the
        ; same row of the word 8 words later (pce-bg.js backgroundPixel,
        ; VDC manual's plane layout H7-15).
        st0 #VDC_MAWR
        st1 #(TILE_BLOCK_WORD & $ff)
        st2 #(TILE_BLOCK_WORD >> 8)
        st0 #VDC_VWR
        ldx #8                     ; CH0 = $ff, CH1 = 0 for all eight rows
block_ch0:
        lda #$ff
        sta VDC_DATA_LO
        stz VDC_DATA_HI
        dex
        bne block_ch0
        ldx #8                     ; CH2 = CH3 = 0
block_ch23:
        stz VDC_DATA_LO
        stz VDC_DATA_HI
        dex
        bne block_ch23

        ; ---- the tile map: 32x32 = 1024 words, all cells pattern $40
        st0 #VDC_MAWR
        st1 #$00
        st2 #$00
        st0 #VDC_VWR
        ldx #4                     ; four pages of 256 words
        cly
blank_map:
        lda #TILE_BLANK
        sta VDC_DATA_LO
        stz VDC_DATA_HI
        iny
        bne blank_map
        dex
        bne blank_map

        ; ---- one cell gets pattern $41
        st0 #VDC_MAWR
        st1 #(MAP_CELL & $ff)
        st2 #(MAP_CELL >> 8)
        st0 #VDC_VWR
        lda #TILE_BLOCK
        sta VDC_DATA_LO
        stz VDC_DATA_HI

        ; ---- show it: background on, sprites off (CR bit 7, H7-6)
        st0 #VDC_CR
        st1 #VDC_CR_BB
        st2 #$00

forever:
        bra forever

;; The five vectors at the end of the bank mapped at $E000-$FFFF (H8-12/13).
;; This program enables no interrupts, so every handler just returns.
irq2:
irq1:
timer:
nmi:
        rti

        .org $fff6
        .dw irq2, irq1, timer, nmi, reset
