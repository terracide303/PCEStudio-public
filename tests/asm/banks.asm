;; banks.asm — three 8 KiB banks and data directives (card #224).
	.code
	.bank 0
	.org $E000
start:
	jmp start

	.bank 1
	.org $E000
	.db $01, $02, $03, $04
	.dw $1234, $5678

	.bank 2
	.org $E000
	.db "PCEAS", 0
