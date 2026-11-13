#!/usr/bin/env python3
"""tools/compare-view.py — a console capture, the browser's frame and their difference, side by side.

    python3 -I tools/compare-view.py CAPTURE.png BROWSER.rgb OUT.png [SCALE]

CAPTURE.png is a Mednafen movie frame (tools/native-compare.js leaves them in OUTDIR/frames); BROWSER.rgb is
tools/browser-frame.js's output.  The right panel marks every differing pixel magenta over a dimmed picture.
When a picture differs but the data checks say it is exact, look at this before theorising: on 2026-11-13 it
showed at once that NOVA TIDE's "65 differing rows" were every sprite missing (the sprite layer was off).
Needs macOS's sips for the PNG (it writes a PPM first)."""
import os, struct, subprocess, sys, zlib

def png(path):
    d = open(path, "rb").read(); pos = 8; idat = b""
    while pos < len(d):
        n = struct.unpack(">I", d[pos:pos + 4])[0]; t = d[pos + 4:pos + 8]; c = d[pos + 8:pos + 8 + n]; pos += 12 + n
        if t == b"IHDR": w, h, _, ct = struct.unpack(">IIBB", c[:10])
        if t == b"IDAT": idat += c
    raw = zlib.decompress(idat); bpp = {2: 3, 6: 4}[ct]; stride = w * bpp
    rows = []; prev = bytearray(stride); i = 0
    for _ in range(h):
        f = raw[i]; line = bytearray(raw[i + 1:i + 1 + stride]); i += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0; b = prev[x]; c = prev[x - bpp] if x >= bpp else 0
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + ((a + b) >> 1)) & 255
            elif f == 4:
                p = a + b - c; pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else (b if pb <= pc else c))) & 255
        rows.append(bytes(line)); prev = line
    return w, h, bpp, rows

cap, rgb, out = sys.argv[1:4]; S = int(sys.argv[4]) if len(sys.argv) > 4 else 2
w, h, bpp, rows = png(cap); br = open(rgb, "rb").read()
gap = b"\x00" * (8 * 3)
ppm = bytearray(); ndiff = 0
for y in range(h):
    l = bytearray(); r = bytearray(); d = bytearray()
    for x in range(w):
        a = rows[y][x * bpp:x * bpp + 3]; b = br[(y * w + x) * 3:(y * w + x) * 3 + 3]
        l += a * S; r += b * S
        if a != b: ndiff += 1; d += b"\xff\x00\xff" * S
        else: d += bytes(v // 3 for v in a) * S
    line = bytes(l) + gap + bytes(r) + gap + bytes(d)
    for _ in range(S): ppm += line
width = (w * S * 3 + 8) * 1 + 0
hdr = b"P6 %d %d 255\n" % (len(line) // 3, h * S)
ppmpath = out + ".ppm"; open(ppmpath, "wb").write(hdr + ppm)
subprocess.run(["sips", "-s", "format", "png", ppmpath, "--out", out], capture_output=True); os.remove(ppmpath)
print("%d differing pixels of %d; left: console, middle: browser, right: difference" % (ndiff, w * h))
