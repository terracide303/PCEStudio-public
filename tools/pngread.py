#!/usr/bin/env python3
"""pngread.py — minimal PNG reader (8-bit RGB/RGBA/gray, non-interlaced).

Usage: pngread.py FILE [crop x y w h]   -> prints "WxH" then raw RGB bytes to
stdout.  Used by the capture pipeline to extract pixel regions from
screencapture output and to inspect Mednafen F9 PNGs.  Python 3 stdlib only.
"""
import struct
import sys
import zlib


def read_png(path):
    d = open(path, "rb").read()
    assert d[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    pos = 8
    width = height = None
    bitdepth = coltype = None
    idat = b""
    while pos < len(d):
        ln = struct.unpack(">I", d[pos:pos + 4])[0]
        typ = d[pos + 4:pos + 8]
        data = d[pos + 8:pos + 8 + ln]
        pos += 12 + ln
        if typ == b"IHDR":
            width, height, bitdepth, coltype = struct.unpack(">IIBB", data[:10])
        elif typ == b"IDAT":
            idat += data
        elif typ == b"IEND":
            break
    assert bitdepth == 8, "only 8-bit"
    assert coltype in (0, 2, 6), f"unsupported colour type {coltype}"
    chans = {0: 1, 2: 3, 6: 4}[coltype]
    raw = zlib.decompress(idat)
    stride = width * chans
    out = bytearray(width * height * 3)
    prev = bytearray(stride)

    def paeth(a, b, c):
        p = a + b - c
        pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
        if pa <= pb and pa <= pc:
            return a
        if pb <= pc:
            return b
        return c

    pos = 0
    for y in range(height):
        f = raw[pos]
        pos += 1
        line = bytearray(raw[pos:pos + stride])
        pos += stride
        if f == 1:
            for i in range(chans, stride):
                line[i] = (line[i] + line[i - chans]) & 0xFF
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif f == 3:
            for i in range(stride):
                a = line[i - chans] if i >= chans else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif f == 4:
            for i in range(stride):
                a = line[i - chans] if i >= chans else 0
                b = prev[i]
                c = prev[i - chans] if i >= chans else 0
                line[i] = (line[i] + paeth(a, b, c)) & 0xFF
        # expand to RGB (gray -> R=G=B; RGBA -> drop alpha)
        for x in range(width):
            o = (y * width + x) * 3
            if chans == 1:
                out[o:o + 3] = bytes([line[x]]) * 3
            else:
                out[o] = line[x * chans]
                out[o + 1] = line[x * chans + 1]
                out[o + 2] = line[x * chans + 2]
        prev = line
    return width, height, bytes(out)


def main():
    args = sys.argv[1:]
    if len(args) == 5:
        path, x, y, w, h = args[0], *map(int, args[1:6])
        width, height, px = read_png(path)
        crop = bytearray(w * h * 3)
        for yy in range(h):
            src = ((y + yy) * width + x) * 3
            crop[yy * w * 3:(yy + 1) * w * 3] = px[src:src + w * 3]
        sys.stdout.buffer.write(struct.pack("<II", w, h))
        sys.stdout.buffer.write(bytes(crop))
    else:
        path = args[0]
        width, height, px = read_png(path)
        sys.stdout.buffer.write(struct.pack("<II", width, height))
        sys.stdout.buffer.write(px)


if __name__ == "__main__":
    main()
