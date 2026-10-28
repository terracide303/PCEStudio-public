#!/usr/bin/env python3
"""extract_engine.py — write HuTrack's fixed ROM banks for the browser export.

    python3 -I extract_engine.py OUT ROM [ROM ...]

tools/hutrack.asm is a fixed skeleton: banks $00-$0F hold the startup, MAIN,
the HuTrack engine and its pitch tables, and they are the same bytes for
every song; only bank $10 (the song) changes.  #35's browser export therefore
needs banks $00-$0F as an asset — renderer/hutrack-engine.bin — and
renderer/pce-rom.js's buildSongRom() appends the assembled song bank to it.

Reads the first 16 banks of every ROM given and refuses unless they are all
identical, the same guard extract_bank0.py puts on the viewer's code bank: a
hutrack.asm change that only reached one build would otherwise become a
silent asset.  `make -C tools engine` runs this against every built music ROM.
"""

import hashlib
import sys

BANKS = 16
BANK = 8 * 1024


def main():
    if len(sys.argv) < 3:
        print(f"usage: {sys.argv[0]} OUT ROM [ROM ...]", file=sys.stderr)
        return 2
    out_path, roms = sys.argv[1], sys.argv[2:]

    engine = None
    first_rom = None
    for rom in roms:
        with open(rom, "rb") as f:
            data = f.read(BANKS * BANK)
        if len(data) != BANKS * BANK:
            print(f"{rom}: shorter than {BANKS} banks", file=sys.stderr)
            return 1
        if engine is None:
            engine, first_rom = data, rom
        elif data != engine:
            print(f"{rom}: banks $00-$0F differ from {first_rom}'s — the "
                  f"engine image is supposed to be constant", file=sys.stderr)
            return 1

    with open(out_path, "wb") as f:
        f.write(engine)
    print(f"wrote {out_path} ({len(engine)} bytes = {BANKS} banks, sha256 "
          f"{hashlib.sha256(engine).hexdigest()[:16]}…, "
          f"same in {len(roms)} ROM(s))")
    return 0


if __name__ == "__main__":
    sys.exit(main())
