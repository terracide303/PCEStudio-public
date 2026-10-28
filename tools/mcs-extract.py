#!/usr/bin/env python3
"""mcs-extract.py — extract VRAM, CRAM and registers from a Mednafen save state.

Card #5 evidence pipeline: Mednafen (pce module) autosaves a .mcs state on
clean exit; this script pulls out everything the renderer needs:

  <dumpdir>/vram.bin   VDC VRAM, 32768 x uint16 little-endian (65536 bytes)
  <dumpdir>/cram.bin   VCE colour table, 512 x uint16 LE (1024 bytes)
  <dumpdir>/regs.json  named registers/counters, incl. the scanline
                       calibration values the renderer uses

Container format (read from mednafen-1.32.1 source, state.cpp):
  gzip stream:
    header 32 B: "MDFNSVST" | u64 LE time | u32 LE stateversion |
                 u32 LE total_len (&0x7fffffff) | u32 LE neowidth |
                 u32 LE neoheight
    preview: neowidth * neoheight * 3 bytes RGB888 (sinc-filtered in this
             build — NOT pixel-exact, only used as a sanity picture)
    sections until total_len: [32 B NUL-padded name][u32 LE size][records]
    record: [1 B namelen][name][u32 LE size][raw data, host-endian = LE]

Section/record names come from pce.cpp/vdc.cpp/vce.cpp StateAction().
"""

import gzip
import json
import struct
import sys

WANTED = {
    # name -> ("section", struct type) — sizes verified against a real state
    "VRAM": ("VDC", None),            # 32768 x uint16 = 65536 bytes
    "SAT": ("VDC", None),             # 256 x uint16
    "BYR": ("VDC", "u16"),
    "BXR": ("VDC", "u16"),
    "MWR": ("VDC", "u16"),
    "CR": ("VDC", "u16"),
    "RCR": ("VDC", "u16"),
    "HSR": ("VDC", "u16"),
    "HDR": ("VDC", "u16"),
    "VSR": ("VDC", "u16"),
    "VDR": ("VDC", "u16"),
    "VCR": ("VDC", "u16"),
    "DCR": ("VDC", "u16"),
    "SATB": ("VDC", "u16"),
    "status": ("VDC", "u8"),
    "RCRCount": ("VDC", "u32"),
    "BG_YOffset": ("VDC", "u32"),
    "BG_YMoo": ("VDC", "u32"),
    "BG_XOffset": ("VDC", "u32"),
    "VDS_cache": ("VDC", "u32"),
    "VSW_cache": ("VDC", "u32"),
    "VDW_cache": ("VDC", "u32"),
    "VCR_cache": ("VDC", "u32"),
    "HSW_cache": ("VDC", "u32"),
    "HDS_cache": ("VDC", "u32"),
    "HDW_cache": ("VDC", "u32"),
    "HDE_cache": ("VDC", "u32"),
    "VCECR": ("VCE", "u8"),
    "color_table": ("VCE", None),     # 512 x uint16
    "ctaddress": ("VCE", "u16"),
    "scanline": ("VCE", "u32"),
    "pixel_offset": ("VCE", "u32"),
}


def parse(path):
    raw = gzip.open(path, "rb").read()
    assert raw[:8] == b"MDFNSVST", "not a Mednafen save state"
    stateversion = struct.unpack_from("<I", raw, 16)[0]
    total_len = struct.unpack_from("<I", raw, 20)[0] & 0x7FFFFFFF
    neowidth = struct.unpack_from("<I", raw, 24)[0]
    neoheight = struct.unpack_from("<I", raw, 28)[0]
    pos = 32 + neowidth * neoheight * 3
    end = total_len  # total_len covers the whole uncompressed stream
    sections = {}
    while pos < end:
        name = raw[pos:pos + 32].split(b"\0", 1)[0].decode("ascii", "replace")
        size = struct.unpack_from("<I", raw, pos + 32)[0]
        body = raw[pos + 36:pos + 36 + size]
        records = {}
        rpos = 0
        while rpos < len(body):
            nlen = body[rpos]
            rname = body[rpos + 1:rpos + 1 + nlen].decode("ascii", "replace")
            rsize = struct.unpack_from("<I", body, rpos + 1 + nlen)[0]
            data = body[rpos + 5 + nlen:rpos + 5 + nlen + rsize]
            records[rname] = data
            rpos += 5 + nlen + rsize
        sections[name] = records
        pos += 36 + size
    return stateversion, neowidth, neoheight, sections


def main():
    if len(sys.argv) not in (3, 4):
        print(f"usage: {sys.argv[0]} STATE.mcs OUTDIR [SLSTART]", file=sys.stderr)
        return 2
    state, outdir = sys.argv[1], sys.argv[2]
    slstart = int(sys.argv[3]) if len(sys.argv) == 4 else None
    import os
    os.makedirs(outdir, exist_ok=True)

    ver, w, h, sections = parse(state)
    print(f"stateversion=0x{ver:x} preview={w}x{h}")
    print("sections:", ", ".join(sorted(sections)))

    regs = {"_stateversion": ver, "_preview": [w, h]}
    found = {}
    for rname, (sec, typ) in WANTED.items():
        data = sections.get(sec, {}).get(rname)
        if data is None:
            continue
        found[rname] = sec
        if typ is None:
            words = struct.unpack("<%dH" % (len(data) // 2), data)
            regs[rname + "_bytes"] = len(data)
            regs.setdefault(rname, words[0])
        elif typ == "u8":
            regs[rname] = struct.unpack("<B", data)[0]
        elif typ == "u16":
            regs[rname] = struct.unpack("<H", data)[0]
        elif typ == "u32":
            regs[rname] = struct.unpack("<I", data)[0]

    missing = [n for n in WANTED if n not in found]
    if missing:
        print("MISSING:", ", ".join(missing))

    vram = sections.get("VDC", {}).get("VRAM", b"")
    cram = sections.get("VCE", {}).get("color_table", b"")
    with open(os.path.join(outdir, "vram.bin"), "wb") as f:
        f.write(vram)
    with open(os.path.join(outdir, "cram.bin"), "wb") as f:
        f.write(cram)
    with open(os.path.join(outdir, "regs.json"), "w") as f:
        json.dump(regs, f, indent=1, sort_keys=True)
    print(f"wrote {outdir}/vram.bin ({len(vram)} B), cram.bin ({len(cram)} B), regs.json")
    # calibration diagnostics (see docs/RENDERER.md):
    if "RCRCount" in regs and "scanline" in regs:
        rcr = regs["RCRCount"]
        moo = regs.get("BG_YMoo", 0)
        byr = regs.get("BYR", 0)
        sl = regs["scanline"]
        # VDW line 0 = VCE line 17 (RCRCount = scanline - 17 at save); captured
        # row 0 (VCE line 14 + slstart) is VDW line RCRCount - (scanline -
        # (14 + slstart)).  Cross-check: BG_YMoo - BYR must equal
        # RCRCount - 1 (the save happens before the latch of its own line's
        # HDS_PART2 increment).
        first = 14 + (slstart if slstart is not None else 4)
        print(f"calibration: scanline={sl} RCRCount={rcr} BG_YMoo={moo} "
              f"BYR={byr} -> vdw_line(save)={rcr} "
              f"row0_vdw_line={rcr - (sl - first)} "
              f"(firstScanline={first}) "
              f"crosscheck BG_YMoo-BYR={moo - byr} (expect {rcr - 1})")
        # A state saved during the 14 pre-VDW blanking lines (scanline < 14)
        # straddles the BG_YOffset reset at VDW entry: the row arithmetic is
        # linear in scanline only if no reset lies between the save and
        # captured row 0.  Flag it so capture.sh can retry (~5% of saves).
        if sl < 14:
            print("CALIBRATION: BAD (state saved during pre-VDW blanking)",
                  file=sys.stderr)
            return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
