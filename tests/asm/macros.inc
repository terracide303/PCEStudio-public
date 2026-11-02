;; macros.inc — one macro for tests/asm/features.asm (card #224's check).
;; PCEAS 3.23 has no parameter list on .macro; arguments arrive as \1..\9.
	.macro ldm
	lda #\1
	.endm
