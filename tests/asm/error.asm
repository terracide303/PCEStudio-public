;; error.asm — line 5 is deliberately invalid (tests/check-asm.js).
	.code
	.bank 0
	.org $E000
	lda #$GG
