;; include-error.asm — the error is in the included file (card #251).
	.code
	.bank 0
	.org $E000
	.include "lib/bad.inc"
