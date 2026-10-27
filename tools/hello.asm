;;
;; PCEStudio — hello.asm
;; The smallest thing that proves the toolchain: a HuCard ROM that fills the
;; screen with one colour.
;;
;; Build: see docs/BUILD.md — `pceas -raw -o hello.pce hello.asm`
;;
;; This is deliberately self-contained (no HuDK include files) so that #7
;; tests PCEAS and the ROM layout, not a vendored SDK. The VDC values for
;; 256x224 and the VCE port writes follow HuDK's MIT-licensed startup
;; (include/vdc.s `vdc_init_table`, include/vce.s `vce_init`), read as the
;; working example; the loop and layout here are ours.
;;

        .code
        .bank 0
        .org $fff6
        .dw irq2                   ; $fff6
        .dw irq1                   ; $fff8
        .dw timer                  ; $fffa
        .dw nmi                    ; $fffc
        .dw reset                  ; $fffe

        .code
        .bank 0
        .org $e000

reset:
        sei                        ; no interrupts
        csh                        ; fast CPU clock
        cld
        ldx #$ff
        txs
        lda #$ff
        tam0                       ; I/O at $0000-$1fff
        lda #$f8
        tam1                       ; work RAM at $2000-$3fff

        ;; VCE: colour mode, edge blur on, 5 MHz dot clock (256 px wide)
        lda #$04
        sta $0400

        ;; Palette 0, colour 0 = red. Index 256 is the VCE backdrop/border.
        stz $0402                  ; index low
        stz $0403                  ; index high
        lda #$38                   ; $038 = red (R=7, G=0, B=0)
        sta $0404                  ; colour low (commits on high write)
        stz $0405                  ; colour high
        stz $0402                  ; index = $0100
        lda #$01
        sta $0403
        lda #$38
        sta $0404
        stz $0405

        ;; VDC: 256x224, 64x64 BAT (values from HuDK's vdc_init_table)
        st0 #$05                   ; CR
        st1 #$00
        st2 #$00
        st0 #$06                   ; RCR
        st1 #$00
        st2 #$00
        st0 #$07                   ; BXR
        st1 #$00
        st2 #$00
        st0 #$08                   ; BYR
        st1 #$00
        st2 #$00
        st0 #$09                   ; MWR: 64x64
        st1 #$50
        st2 #$00
        st0 #$0a                   ; HSR: HDS=2, HSW=2
        st1 #$02
        st2 #$02
        st0 #$0b                   ; HDR: HDW=31, HDE=4
        st1 #$1f
        st2 #$04
        st0 #$0c                   ; VPR
        st1 #$02
        st2 #$0f
        st0 #$0d                   ; VDW
        st1 #$ef
        st2 #$00
        st0 #$0e                   ; VCR
        st1 #$0c
        st2 #$00
        st0 #$0f                   ; DCR
        st1 #$10
        st2 #$00
        st0 #$13                   ; SATB
        st1 #$00
        st2 #$7f

        ;; Every BAT entry -> tile 256, palette 0 (4096 entries)
        st0 #$00                   ; MAWR = 0
        st1 #$00
        st2 #$00
        st0 #$02                   ; DATA
        ldy #16
bat_page:
        clx
bat_entry:
        st1 #$00
        st2 #$01                   ; tile 256 = $100
        inx
        bne bat_entry              ; 256 entries per page
        dey
        bne bat_page               ; 16 pages

        ;; Clear tile 256 (32 bytes = 16 words) so it is colour 0
        st0 #$00                   ; MAWR = $1000
        st1 #$00
        st2 #$10
        st0 #$02                   ; DATA
        st1 #$00
        ldx #16
tile_zero:
        st2 #$00
        dex
        bne tile_zero

        ;; Turn the background on; CR bit 7
        st0 #$05
        st1 #$80
        st2 #$00

loop:
        bra loop

irq2:
irq1:
timer:
nmi:
        rti
