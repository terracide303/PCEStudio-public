# Minimal build for the #7 hello ROM.
# PCEAS is an external tool; see ../docs/BUILD.md.

PCEAS ?= pceas

all: hello.pce

hello.pce: hello.asm
	$(PCEAS) -raw -o $@ $<

clean:
	rm -f hello.pce hello.sym hello.lst

.PHONY: all clean
