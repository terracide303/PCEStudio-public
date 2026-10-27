#!/usr/bin/env python3
"""extract_bank0.py — write the viewer's constant code bank for the browser.

    python3 -I extract_bank0.py OUT ROM [ROM ...]

The viewer ROM's bank 0 is viewer.asm's assembled code and never changes;
banks 1+ carry the picture (docs/ROM_LAYOUT.md).  #9's browser export copies
bank 0 verbatim, so it needs these bytes as an asset:
renderer/viewer-bank0.bin.

Reads the first 8 KiB of every ROM given and refuses unless they are all
identical — a viewer.asm change that only reached one build would otherwise
become a silent asset.  `make -C tools bank0` runs this against the three
assembled viewer ROMs.
"""

import hashlib
import sys

BANK = 8 * 1024


def main():
    if len(sys.argv) < 3:
        print(f"usage: {sys.argv[0]} OUT ROM [ROM ...]", file=sys.stderr)
        return 2
    out_path, roms = sys.argv[1], sys.argv[2:]

    bank0 = None
    first_rom = None
    for rom in roms:
        with open(rom, "rb") as f:
            data = f.read(BANK)
        if len(data) != BANK:
            print(f"{rom}: shorter than {BANK} bytes", file=sys.stderr)
            return 1
        if bank0 is None:
            bank0, first_rom = data, rom
        elif data != bank0:
            print(f"{rom}: bank 0 differs from {first_rom}'s — "
                  f"the viewer code bank is supposed to be constant",
                  file=sys.stderr)
            return 1

    with open(out_path, "wb") as f:
        f.write(bank0)
    print(f"wrote {out_path} ({len(bank0)} bytes, sha256 "
          f"{hashlib.sha256(bank0).hexdigest()[:16]}…, "
          f"same in {len(roms)} ROM(s))")
    return 0


if __name__ == "__main__":
    sys.exit(main())
