;; features.asm — macro, include, expression and listing coverage (card #224).
;; Assembled by tests/check-asm.js with the WebAssembly PCEAS and by the native
;; pceas; the two ROMs and listings must be identical.
	.list
	.code
	.bank 0
	.org $E000

	.include "macros.inc"

VALUE = $12
COUNT = 3

start:
	ldm VALUE
	sta $0000
	lda #LOW(VALUE + COUNT)
	sta $0001
	.if COUNT = 3
	lda #$34
	.else
	lda #$00
	.endif
	sta $0002
	jmp start

	.org $FFF6
	.dw start, start, start, start, start
