#!/usr/bin/env python3
"""movframes.py — extract the LAST video frame of a Mednafen `-qtrecord` .mov.

Only the PNG video codec is supported (that is the lossless one we record
with).  Mednafen's QuickTime writer stores each frame as one complete PNG
image (8-bit RGB, non-interlaced), so the .mov is scanned for the PNG
signature and hits are validated as complete PNGs.  Only the last frame is
extracted: it is the steady-state picture (the "Using module" OSD fades
early), and it is the card-#5 reference — the same raw unfiltered surface
Mednafen's F9 snapshot reads (*source: src/mednafen.cpp:2047 ->
QTRecord::WriteFrame(espec->surface, ...), src/qtrecord.cpp*).

The PCE core's lcm_width is 1024 (dot-clock width) while the visible
picture is 256 pixels; QTRecord's DecodeLine replicates each source pixel
horizontally by dest_width/src_width, so each frame stores the picture
scaled 4x across the full 1024 columns (source: DecodeLine's
xscale_factor loop in src/qtrecord.cpp).  Pass CROPW CROPH [XSTEP] to crop
the frame back to the visible picture; with XSTEP=4 every 4th column is the
exact source pixel.  Rows are not scaled (QTVideoHeight == DisplayRect.h).

Usage: movframes.py IN.mov OUT.png [CROPW CROPH [XSTEP]]

Source of the container facts: mednafen-1.32.1 src/qtrecord.cpp (PNGWrite
per frame: IHDR w=QTVideoWidth h=QTVideoHeight, bit depth 8, colour type 2).
"""

import os
import struct
import sys
import zlib

PNG_SIG = b"\x89PNG\r\n\x1a\n"


def chunk_crc(ctype, data):
    return zlib.crc32(ctype + data) & 0xFFFFFFFF


def write_png(path, w, h, rows):
    """rows: list of byte strings, one per row, RGB."""
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    raw = b"".join(b"\x00" + r for r in rows)
    idat = zlib.compress(raw, 6)
    out = bytearray(PNG_SIG)
    for ctype, data in ((b"IHDR", ihdr), (b"IDAT", idat), (b"IEND", b"")):
        out += struct.pack(">I", len(data)) + ctype + data
        out += struct.pack(">I", chunk_crc(ctype, data))
    with open(path, "wb") as f:
        f.write(out)


def unfilter_rows(raw, w, h):
    """Undo PNG filters 0-4 on an 8-bit RGB stream; returns list of rows."""
    stride = w * 3
    rows = []
    prev = bytearray(stride)
    p = 0
    for _ in range(h):
        f = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        for i in range(stride):
            a = line[i - 3] if i >= 3 else 0
            b = prev[i]
            c = prev[i - 3] if i >= 3 else 0
            if f == 1:
                line[i] = (line[i] + a) & 0xFF
            elif f == 2:
                line[i] = (line[i] + b) & 0xFF
            elif f == 3:
                line[i] = (line[i] + (a + b) // 2) & 0xFF
            elif f == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pred = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                line[i] = (line[i] + pred) & 0xFF
        rows.append(bytes(line))
        prev = line
    return rows


def valid_png_at(data, off):
    """Return (width, height, end_offset) if a complete, parseable PNG starts
    at off, else None."""
    pos = off + len(PNG_SIG)
    try:
        ln = struct.unpack_from(">I", data, pos)[0]
    except struct.error:
        return None
    if data[pos + 4:pos + 8] != b"IHDR" or ln != 13:
        return None
    ihdr = data[pos + 8:pos + 8 + 13]
    w, h, depth, ctype = struct.unpack(">IIBB", ihdr[:10])
    if depth != 8 or ctype != 2:
        return None
    pos += 12 + ln
    # walk chunks to IEND
    while True:
        try:
            ln = struct.unpack_from(">I", data, pos)[0]
            ctype = data[pos + 4:pos + 8]
        except struct.error:
            return None
        if ln > 1 << 28:
            return None
        pos += 12 + ln
        if ctype == b"IEND":
            return w, h, pos
        if pos > len(data):
            return None


def parse_png(data):
    """Decode an 8-bit RGB non-interlaced PNG; returns (w, h, rows)."""
    pos = len(PNG_SIG)
    w = h = None
    idat = b""
    while True:
        ln = struct.unpack_from(">I", data, pos)[0]
        ctype = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + ln]
        pos += 12 + ln
        if ctype == b"IHDR":
            w, h, depth, ct = struct.unpack(">IIBB", body[:10])
            if depth != 8 or ct != 2:
                raise ValueError(f"unsupported PNG depth={depth} type={ct}")
        elif ctype == b"IDAT":
            idat += body
        elif ctype == b"IEND":
            break
    raw = zlib.decompress(idat)
    return w, h, unfilter_rows(raw, w, h)


def main():
    if len(sys.argv) < 3:
        print(f"usage: {sys.argv[0]} IN.mov OUT.png [CROPW CROPH [XSTEP]]\n"
              f"       {sys.argv[0]} IN.mov --all OUTDIR [CROPW CROPH [XSTEP]]",
              file=sys.stderr)
        return 2
    src = sys.argv[1]
    all_mode = sys.argv[2] == "--all"
    out = sys.argv[3] if all_mode else sys.argv[2]
    crop_args = sys.argv[4:] if all_mode else sys.argv[3:]
    crop = (int(crop_args[0]), int(crop_args[1])) if len(crop_args) >= 2 else None
    xstep = int(crop_args[2]) if len(crop_args) >= 3 else 1

    data = open(src, "rb").read()
    print(f"{src}: {len(data)} bytes")

    def crop_rows(rows, w, h):
        if not crop:
            return w, h, rows
        cw, ch = crop
        if cw * xstep > w or ch > h:
            print(f"crop {cw}x{ch} xstep {xstep} larger than frame {w}x{h}",
                  file=sys.stderr)
            raise SystemExit(1)
        return cw, ch, [b"".join(r[x * 3:x * 3 + 3]
                                 for x in range(0, cw * xstep, xstep))
                        for r in rows[:ch]]

    if all_mode:
        # Every complete PNG the container carries, in order: #31 part A
        # compares a run of consecutive Mednafen frames with the browser's.
        os.makedirs(out, exist_ok=True)
        hit = 0
        n = 0
        while True:
            hit = data.find(PNG_SIG, hit)
            if hit < 0:
                break
            v = valid_png_at(data, hit)
            if not v:
                hit += 1
                continue
            w, h, end = v
            rw, rh, rows = parse_png(data[hit:end])
            rw, rh, rows = crop_rows(rows, rw, rh)
            path = os.path.join(out, "frame%04d.png" % n)
            write_png(path, rw, rh, rows)
            n += 1
            hit = end
        print(f"wrote {n} frames to {out} ({rw}x{rh})")
        return 0 if n else 1

    # Walk signature hits backwards until one validates; the mov's trailing
    # atoms come after the last frame, so the last complete PNG is the frame.
    png = None
    w = h = None
    end = len(data)
    while end > 0:
        hit = data.rfind(PNG_SIG, 0, end)
        if hit < 0:
            break
        v = valid_png_at(data, hit)
        if v:
            w, h, e = v
            png = data[hit:e]
            break
        end = hit
    if png is None:
        print("no valid PNG frame found", file=sys.stderr)
        return 1
    print(f"last frame: {w}x{h}")

    rw, rh, rows = parse_png(png)
    rw, rh, rows = crop_rows(rows, rw, rh)
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    write_png(out, rw, rh, rows)
    print(f"wrote {out}: {rw}x{rh}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
