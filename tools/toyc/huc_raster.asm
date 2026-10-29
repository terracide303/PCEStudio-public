;
; huc_raster.asm — the RCR chain for the HuC backend (#31 part B).
;
; This is docs/IL.md §10's handler (the llvm-mos runtime's inline 6502)
; moved into a file PCEAS assembles, because HuC cannot host inline asm in a
; C function and the handler must not be a C call: a compiled raster()
; callback measures 1,510 cycles (part C), ten times the ~123-cycle blank.
; The handler is a handful of loads, stores and the RCR re-arm per line, in
; bank 0 — always mapped, so it runs whatever bank the main loop is in.
;
; Install: huc_irq_install writes its address to HuC's user IRQ1 vector
; (irq1_jmp, $2202) and sets irq_m bit 1 ($20F5), which is the one place
; HuC's own irq1 entry jumps through before it saves registers (startup.asm
; `irq1: bbs1 <irq_m,user_irq1`).  The handler therefore saves A/X/Y itself
; and acknowledges the VDC status register by reading it.
;
; The table op byte (huc_runtime.c): bit0 BXR, bit1 BYR, bit2 CR, bit3 first
; colour word, bit4 second.  BXR goes first (the write the line's first
; pixels can catch), RCR is re-armed last, and the RCR's ninth bit is
; carried with adc (0x40 + 192 = 0x100).

	.code
	.bank 0

_huc_irq1:
	pha
	phx
	phy
	lda $0000                ; VDC status: also acknowledges
	and #$20                 ; VD, the VBlank flag
	beq .hscan
	inc _toy_vblank_count
	jmp .hdone
.hscan:
	ldx _toy_isr_line
	cpx #224
	bcc .hscan_go
	jmp .hdone
.hscan_go:
	lda _toy_r_op,x
	and #$01
	beq .hno_bxr
	lda #7
	sta $0000
	lda _toy_r_bxr_lo,x
	sta $0002
	lda _toy_r_bxr_hi,x
	sta $0003
.hno_bxr:
	lda _toy_r_op,x
	and #$02
	beq .hno_byr
	lda #8
	sta $0000
	lda _toy_r_byr_lo,x
	sta $0002
	lda _toy_r_byr_hi,x
	sta $0003
.hno_byr:
	lda _toy_r_op,x
	and #$04
	beq .hno_cr
	lda #5
	sta $0000
	lda _toy_r_cr,x
	ora #$0C
	sta $0002
	stz $0003
.hno_cr:
	lda _toy_r_op,x
	and #$08
	beq .hno_c1
	lda _toy_r_a1_lo,x
	sta $0402
	lda _toy_r_a1_hi,x
	sta $0403
	lda _toy_r_v1_lo,x
	sta $0404
	lda _toy_r_v1_hi,x
	sta $0405
.hno_c1:
	lda _toy_r_op,x
	and #$10
	beq .hno_c2
	lda _toy_r_a2_lo,x
	sta $0402
	lda _toy_r_a2_hi,x
	sta $0403
	lda _toy_r_v2_lo,x
	sta $0404
	lda _toy_r_v2_hi,x
	sta $0405
.hno_c2:
	inx
	stx _toy_isr_line
	cpx #224
	bcs .hdone
	lda #6                   ; RCR
	sta $0000
	txa
	clc
	adc #$40                 ; 0x40 + 192 carries into bit 8
	sta $0002
	lda #$00
	adc #$00
	sta $0003
.hdone:
	ply
	plx
	pla
	rti

_huc_irq_install:
	lda #<_huc_irq1
	sta $2202
	lda #>_huc_irq1
	sta $2203
	lda $20F5
	ora #$02
	sta $20F5
	rts
