;;
;; PCEStudio — examples/asm-first/main.asm  (card #231)
;; The first program: sets a palette, writes two tiles, and loops.
;;
;; The picture: the VDC's background shows the two tiles in a checkerboard
;; over the whole screen — a gold-and-magenta heart alternating with a teal
;; hollow diamond, 8 pixels each, on a navy backdrop.  The exact palette
;; words, tile rows and the checkerboard rule are stated in NOTES.md, and
;; tests/check-asm-card.js builds the expected picture from the same
;; numbers and holds Mednafen's capture to it (diff 0).
;;
;; The register values are the hardware's own: the VDC's 256x224 window
;; and the VCE's clock-division and colour words come from docs/MANUALS.md
;; (H7-6/7, H6-3), as tools/hello.asm first wired them; the names come
;; from this project's own include file, renderer/asm/pce.inc, which the
;; studio provides to the assembler — no copy of it is needed here.
;;
;; Build (the studio's own pipeline, what the Export button runs):
;;   renderer/pce-asm.js  assemble, with pce.inc built in
;;   renderer/pce-card.js turn the bank into a .pce (header + the bank)
;;

        .include "pce.inc"

        .code
        .bank 0
        .org $fff6
        .dw irq2                   ; $fff6  (also BRK)
        .dw irq1                   ; $fff8
        .dw timer                  ; $fffa
        .dw nmi                    ; $fffc
        .dw reset                  ; $fffe

        .code
        .bank 0
        .org $e000

reset:
        sei                        ; no interrupts while the screen comes up
        csh                        ; fast CPU clock
        cld
        ldx #$ff
        txs
        lda #MPR_IO
        tam0                       ; I/O at $0000-$1fff
        lda #MPR_RAM
        tam1                       ; work RAM at $2000-$3fff

        ;; VCE: 5.37 MHz dot clock (256 dots), edge blur on
        lda #VCE_CR_DCC_DIV4 | VCE_CR_BLUR
        sta VCE_CR

        ;; Palette 0: navy backdrop, gold, magenta, teal — the colours of
        ;; the picture.  The low byte is B plus R's low bits, the high byte
        ;; carries G's low bit; writing the high byte commits the colour.
        stz VCE_CTA_L
        stz VCE_CTA_H
        ldx #$00
palette_loop:
        lda palette_words, x
        sta VCE_CTW_L
        lda palette_words + 1, x
        sta VCE_CTW_H
        inx
        inx
        cpx #8
        bne palette_loop

        ;; Colour $100 — colour 0 of sprite palette 0 — is the overscan /
        ;; border colour; keep it the navy.
        stz VCE_CTA_L
        lda #$01
        sta VCE_CTA_H
        lda #$47
        sta VCE_CTW_L
        stz VCE_CTW_H

        ;; VDC: 256x224, 64x64 BAT, sprites off, the proven window values
        ;; (docs/MANUALS.md §15.1 GAP 1 lists this exact row).
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
        st1 #MWR_SCREEN_64x64      ; 1-dot VM and SM, background on CG0
        st2 #$00
        st0 #VDC_HSR
        st1 #$02
        st2 #$02
        st0 #VDC_HDR
        st1 #$1f
        st2 #$04
        st0 #VDC_VPR
        st1 #$02
        st2 #$0f
        st0 #VDC_VDR
        st1 #$ef
        st2 #$00
        st0 #VDC_VCR
        st1 #$0c
        st2 #$00
        st0 #VDC_DCR
        st1 #DCR_DSR               ; reload the SAT from $7f00 each frame
        st2 #$00
        st0 #VDC_DVSSR
        st1 #$00
        st2 #$7f

        ;; Tiles 256 and 257: 32 words at $1000-$101f — ABOVE the BAT, which
        ;; occupies words $0000-$0fff in the 64x64 screen mode (the layout
        ;; tools/hello.asm uses).  A character is 16 words: rows 0-7 hold the
        ;; pixels' low and high bits (CH0 in the low byte, CH1 in the high,
        ;; bit 7/15 the leftmost pixel) and rows 8-15 hold CH2/CH3 — unused
        ;; in 2-bit colour but still READ (measured: a first build left the
        ;; diamond's rows there and the heart gained its bits as colours 4
        ;; and 5), so they are zeroed.
        st0 #VDC_MAWR
        st1 #$00
        st2 #$10
        st0 #VDC_VWR
        st1 #$00
        ldx #32
tile_clear:
        st2 #$00
        dex
        bne tile_clear
        st0 #VDC_MAWR
        st1 #$00
        st2 #$10
        st0 #VDC_VWR
        ldx #$00
tile_write:
        lda tile_words, x
        sta VDC_DATA
        lda tile_words + 1, x
        sta VDC_DATA_H
        inx
        inx
        cpx #64
        bne tile_write

        ;; Every BAT entry -> tile 256 or tile 257: tile number =
        ;; $100 | ((x + y) & 1), a checkerboard of hearts and diamonds.
        ;; The fill walks the BAT in rows of 64 entries through the VDC's
        ;; auto-increment, so the word is $0100 or $0101.
        st0 #VDC_MAWR
        st1 #$00
        st2 #$00
        st0 #VDC_VWR
        stz ZEROPAGE                ; the parity byte: (x + y) & 1
        ldy #64
bat_row:
        ldx #64
bat_entry:
        lda ZEROPAGE
        sta VDC_DATA
        lda #$01
        sta VDC_DATA_H
        lda ZEROPAGE
        eor #$01
        sta ZEROPAGE
        dex
        bne bat_entry
        ;; a row flips the parity 64 times (even) for x, once for y
        lda ZEROPAGE
        eor #$01
        sta ZEROPAGE
        dey
        bne bat_row

        ;; Turn the background on.
        st0 #VDC_CR
        st1 #CR_BB
        st2 #$00

main_loop:
        bra main_loop

palette_words:
        .dw $047                    ; navy  — the backdrop, colour 0
        .dw $1b8                    ; gold  — the heart's outline
        .dw $03d                    ; magenta — the heart's centre
        .dw $145                    ; teal  — the diamond

tile_words:
        ;; tile 256: the heart (rows 6-7 empty), then its CH2/CH3 rows — 0
        .dw $006c                   ; 0 1 1 0 1 1 0 0
        .dw $7e81                   ; 1 2 2 2 2 2 2 1
        .dw $7e81                   ; 1 2 2 2 2 2 2 1
        .dw $3c42                   ; 0 1 2 2 2 2 1 0
        .dw $1824                   ; 0 0 1 2 2 1 0 0
        .dw $0018                   ; 0 0 0 1 1 0 0 0
        .dw $0000
        .dw $0000
        .dw $0000
        .dw $0000
        .dw $0000
        .dw $0000
        .dw $0000
        .dw $0000
        .dw $0000
        .dw $0000
        ;; tile 257: the hollow diamond, then its CH2/CH3 rows — 0
        .dw $1818                   ; 0 0 0 3 3 0 0 0
        .dw $2424                   ; 0 0 3 0 0 3 0 0
        .dw $4242                   ; 0 3 0 0 0 0 3 0
        .dw $8181                   ; 3 0 0 0 0 0 0 3
        .dw $8181
        .dw $4242
        .dw $2424
        .dw $1818
        .dw $0000
        .dw $0000
        .dw $0000
        .dw $0000
        .dw $0000
        .dw $0000
        .dw $0000
        .dw $0000

irq2:
irq1:
timer:
nmi:
        rti
