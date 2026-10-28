#!/usr/bin/env python3
"""ares-frame.py — turn one ares window capture into the picture ares shows.

Card #41.  This is the crop half of tools/capture-ares.sh: it takes the
`screencapture -l` PNG of ares's window and cuts out the game picture, after
checking that the geometry is the one the capture settings are supposed to
produce.  It does not talk to ares or post any input.

Why these numbers (measured on ares v148, 2026-10-28)
-----------------------------------------------------
ares's PC Engine core renders 1365 native pixels per scanline and, with
VCE CR bit 0-1 = 0 (the viewer's 0x04), emits each VDC dot 4 times
(`vce.clock() = 4`, ares/pce/vdp/vdp.cpp).  With `Video/Overscan=true` the
screen node is setSize(1128 + 24*2, 263) = 1176x263; the video interface
presents it at 1176/4 = 294 VDC dots wide, 263 lines high.  With
`Video/Output=IntegerFixed` and `Video/FixedScale=1` that 294x263 image is
drawn 1:1, centred in the window.

Measured on the four ROMs:

  * the VDC's 256-dot active window is columns 24..279 of the 294-dot grid
    (24 dots of left blanking, 14 of right blanking);
  * the active 256-wide picture is drawn on every presented line; the lines
    outside the VDC's display window show the backdrop colour;
  * ares line 21 is the first line of the renderer's Mednafen crop
    (VCE line 18, the default firstScanline=18 in renderer/pce-bg.js), so
    the 232-line comparison window is lines 21..252.

The --height argument then takes the top `height` lines of that window:
224 for the card's 256x224 active-area frame, 232 for the renderer's own
comparison frame (the project's Mednafen captures are 232 lines, slstart=4).

The validation is deliberate: if ares's presentation changes (window
scaling, overscan, aspect correction, a forced-update setting), the crop
must FAIL rather than silently return a plausible but shifted picture.  A
crop that cannot tell those apart would make every later diff meaningless.

Usage:
  python3 -I tools/ares-frame.py WINDOW.png --active-out OUT.png \
      [--block-out BLOCK.png] [--height 224] \
      [--window-width 640 --window-height 263]

`--window-width/--window-height` are the window bounds in points (from
tools/ares-window.swift).  They let the crop handle a Retina capture: the
PNG is in pixels, so scale = capture_width / window_width (1 on this Mac, 2
on a Retina display), and every geometry number below is multiplied by it.
Without them the capture is assumed to be 1 pixel per point.

Exit: 0 ok, 1 the capture does not have the expected geometry, 2 usage.
"""

import argparse
import importlib.util
import os
import struct
import sys
import zlib


def load_pngread():
    here = os.path.dirname(os.path.abspath(__file__))
    spec = importlib.util.spec_from_file_location(
        "pce_pngread", os.path.join(here, "pngread.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def write_png(path, width, height, pixels):
    """8-bit RGB, filter 0 on every row."""
    raw = b"".join(b"\x00" + bytes(pixels[y * width * 3:(y + 1) * width * 3])
                   for y in range(height))

    def chunk(kind, data):
        return (struct.pack(">I", len(data)) + kind + data +
                struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))

    png = (b"\x89PNG\r\n\x1a\n" +
           chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) +
           chunk(b"IDAT", zlib.compress(raw, 9)) +
           chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)


BLOCK_W = 294          # ares's presented VDC-dot width (1176 / 4)
BLOCK_H = 263          # 263 lines: the frame MacDonald measured as fixed
                       # (pcetech §7).  Mednafen also shows 263 — but only
                       # because $0400 bit 2 is set, which its VCE code
                       # treats as the 262/263-line select; that bit's real
                       # meaning is NOT PROVEN (card #27, docs/DECISIONS.md).
ACTIVE_X = 24          # first active column in the 294-dot grid
ACTIVE_W = 256         # VDC HDW=31 -> 32 characters
ACTIVE_Y = 21          # first line of the renderer's Mednafen window
MAX_ACTIVE_H = 232     # the renderer's own frame height


def uniform(px, width, y, x, n):
    """True iff the n pixels (x..x+n-1) of row y are all the same colour."""
    first = bytes(px[(y * width + x) * 3:(y * width + x) * 3 + 3])
    for i in range(1, n):
        o = (y * width + x + i) * 3
        if bytes(px[o:o + 3]) != first:
            return False, first
    return True, first


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("capture")
    ap.add_argument("--active-out", required=True)
    ap.add_argument("--block-out")
    ap.add_argument("--height", type=int, default=224)
    ap.add_argument("--window-width", type=int)
    ap.add_argument("--window-height", type=int)
    ap.add_argument("--scale", type=int)
    args = ap.parse_args()

    if not (1 <= args.height <= MAX_ACTIVE_H):
        sys.exit(f"--height must be 1..{MAX_ACTIVE_H}")

    width, height, px = load_pngread().read_png(args.capture)

    # Pixels per window point: 1 normally, 2 on a Retina display (capture is
    # in pixels, the window bounds are in points).
    scale = args.scale
    if scale is None:
        if args.window_width:
            if args.window_width <= 0 or width % args.window_width:
                sys.exit(f"{args.capture}: {width}px is not a whole multiple "
                         f"of the {args.window_width}-point window")
            scale = width // args.window_width
        else:
            scale = 1
    if scale < 1 or scale > 4:
        sys.exit(f"unsupported capture scale {scale}")

    bw = BLOCK_W * scale          # ares picture in capture pixels
    bh = BLOCK_H * scale
    active_x = ACTIVE_X * scale
    active_w = ACTIVE_W * scale

    if width < bw or height < bh:
        sys.exit(f"{args.capture}: {width}x{height} too small for a "
                 f"{bw}x{bh} ares picture (scale {scale})")

    # The window is <title bar> + 263 content rows, and the 294-dot picture is
    # centred horizontally.  Both follow from the capture settings, so a
    # mismatch here means the settings were not applied.
    y0 = height - bh
    if (width - bw) % 2:
        sys.exit(f"{args.capture}: window width {width} cannot centre a "
                 f"{bw}-wide picture on a pixel boundary")
    x0 = (width - bw) // 2
    if y0 < 1:
        sys.exit(f"{args.capture}: no title bar above the {bh}-line picture "
                 f"(height {height}); the window was not 263 points high")
    if args.window_height:
        expected = (args.window_height - BLOCK_H) * scale
        if y0 != expected:
            sys.exit(f"{args.capture}: picture starts at pixel row {y0} but "
                     f"a {args.window_height}-point window should put it at "
                     f"{expected}; ares did not draw 263 content lines 1:1 "
                     f"at the window's bottom")

    problems = []
    # The 24 columns left of the active window and the 14 right of it are
    # horizontal blanking: uniform on every line.
    for y in range(0, bh, 8 * scale):
        ok, colour = uniform(px, width, y0 + y, x0, active_x)
        if not ok:
            problems.append(f"line {y // scale}: left {ACTIVE_X} dots are not uniform")
        ok, colour = uniform(px, width, y0 + y,
                             x0 + active_x + active_w, bw - active_x - active_w)
        if not ok:
            problems.append(f"line {y // scale}: right "
                            f"{BLOCK_W - ACTIVE_X - ACTIVE_W} dots are not uniform")

    # The active area must not be one flat colour (a blank or failed capture
    # would otherwise pass every later comparison against a flat reference).
    # Every pixel is sampled: the raster scenes' test pattern (16-dot bars,
    # checker rows) can phase onto a sparse grid and false-positive as flat.
    colours = set()
    for y in range(ACTIVE_Y * scale, ACTIVE_Y * scale + args.height * scale):
        row = ((y0 + y) * width + x0) * 3
        for x in range(active_x, active_x + active_w):
            o = row + x * 3
            colours.add(bytes(px[o:o + 3]))
            if len(colours) > 1:
                break
        if len(colours) > 1:
            break
    if len(colours) < 2:
        problems.append("the 256-wide active area is a single flat colour")

    if problems:
        print(f"{args.capture}: NOT an ares picture at the expected geometry:",
              file=sys.stderr)
        for p in problems[:6]:
            print(f"  {p}", file=sys.stderr)
        print("  check the capture settings in tools/capture-ares.sh",
              file=sys.stderr)
        return 1

    def crop(x, y, w, h, step=scale):
        out = bytearray(w * h * 3)
        for row in range(h):
            src = ((y0 + y + row * step) * width + x0 + x) * 3
            for col in range(w):
                s = src + col * step * 3
                o = (row * w + col) * 3
                out[o:o + 3] = px[s:s + 3]
        return out

    write_png(args.active_out, ACTIVE_W, args.height,
              crop(active_x, ACTIVE_Y * scale, ACTIVE_W, args.height))
    if args.block_out:
        write_png(args.block_out, BLOCK_W, BLOCK_H,
                  crop(0, 0, BLOCK_W, BLOCK_H))

    print(f"ares frame: window {width}x{height} (scale {scale}), picture "
          f"{BLOCK_W}x{BLOCK_H} at ({x0 // scale},{y0 // scale}) points, "
          f"active 256x{args.height} from dot ({ACTIVE_X},{ACTIVE_Y}) "
          f"-> {args.active_out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
