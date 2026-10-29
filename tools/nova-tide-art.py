"""NOVA TIDE art: sprite sheet (15 cells of 16x16, 240x16) and a looping background (256x224).
Everything is drawn here with plain shapes; nothing comes from any other game."""
import math, sys
from PIL import Image, ImageDraw

OUT = sys.argv[1]
T = (0, 0, 0, 0)
def C(r, g, b): return (r, g, b, 255)
NAVY, DB, BL, CY, WH = C(18, 24, 64), C(36, 70, 170), C(70, 130, 240), C(150, 235, 255), C(255, 255, 255)
GR, DG, LG = C(130, 140, 165), C(60, 66, 90), C(190, 198, 215)
YE, OR, RD, DR = C(255, 230, 90), C(255, 140, 40), C(230, 50, 60), C(140, 20, 40)
MG, PU, GN = C(240, 90, 200), C(130, 60, 190), C(110, 230, 110)

sheet = Image.new("RGBA", (16 * 8, 16 * 2), T)

def cell(i):
    im = Image.new("RGBA", (16, 16), T)
    return im, ImageDraw.Draw(im)

def put(i, im): sheet.paste(im, ((i % 8) * 16, (i // 8) * 16))

# 0, 1  the player's ship: a long slim hull, nose to the right, two flame frames
for i in (0, 1):
    im, d = cell(i)
    d.polygon([(2, 6), (3, 2), (6, 2), (7, 5)], fill=DB, outline=NAVY)          # the fin on top
    d.polygon([(2, 9), (3, 13), (5, 13), (6, 10)], fill=DB, outline=NAVY)       # a stub below
    d.polygon([(2, 6), (10, 5), (15, 7), (15, 8), (10, 10), (2, 9)], fill=LG, outline=NAVY)
    d.rectangle([4, 8, 10, 8], fill=RD)
    d.ellipse([7, 3, 12, 7], fill=CY, outline=WH)                                # the canopy
    d.polygon([(11, 7), (15, 7), (15, 8), (11, 8)], fill=WH)
    d.rectangle([0, 6, 2, 9], fill=DG, outline=NAVY)
    d.point([(9, 3)], fill=WH)
    if i == 0: d.rectangle([0, 7, 0, 8], fill=YE); d.point([(0, 6), (0, 9)], fill=OR)
    else:      d.rectangle([0, 6, 0, 9], fill=OR); d.point([(1, 5), (1, 10)], fill=YE)
    put(i, im)

# 2  the player's shot: a bolt
im, d = cell(2)
d.rectangle([2, 7, 13, 8], fill=YE)
d.rectangle([9, 7, 15, 8], fill=WH)
d.point([(1, 7), (1, 8), (4, 6), (4, 9), (7, 6), (7, 9)], fill=OR)
put(2, im)

# 3, 4  a drone: saucer with a red dome, lights that alternate
for i in (3, 4):
    im, d = cell(i)
    d.ellipse([1, 6, 14, 12], fill=GR, outline=DG)
    d.ellipse([4, 3, 11, 9], fill=RD, outline=DR)
    d.point([(6, 5), (7, 4)], fill=WH)
    for k, x in enumerate((3, 6, 9, 12)):
        d.point([(x, 10)], fill=YE if (k + i) % 2 else DG)
    d.point([(7, 2)], fill=LG) if i == 3 else d.point([(8, 2)], fill=LG)
    put(i, im)

# 5  a gunship: armoured hull, the cannon points left
im, d = cell(5)
d.polygon([(4, 3), (13, 2), (15, 5), (15, 10), (13, 13), (4, 12)], fill=DG, outline=NAVY)
d.polygon([(6, 4), (12, 4), (13, 7), (13, 8), (12, 11), (6, 11)], fill=GR, outline=DG)
d.rectangle([0, 6, 6, 9], fill=OR, outline=DR)
d.rectangle([0, 7, 2, 8], fill=YE)
d.ellipse([8, 6, 11, 9], fill=RD, outline=DR)
d.point([(9, 7)], fill=WH)
put(5, im)

# 6  an enemy shot: a glowing orb
im, d = cell(6)
d.ellipse([5, 5, 10, 10], fill=MG, outline=PU)
d.ellipse([6, 6, 9, 9], fill=WH)
put(6, im)

# 7  a weapon capsule
im, d = cell(7)
d.rounded_rectangle([2, 4, 13, 11], radius=3, fill=YE, outline=OR)
d.rectangle([3, 5, 12, 6], fill=WH)
for p in [(6, 6), (6, 7), (6, 8), (6, 9), (7, 6), (8, 6), (9, 7), (8, 8), (7, 8)]:
    d.point([p], fill=DR)
put(7, im)

# 8, 9, 10  an explosion in three steps
for i, (r, cols) in zip((8, 9, 10), ((3, (YE, WH, OR)), (6, (OR, YE, RD)), (7, (RD, OR, DR)))):
    im, d = cell(i)
    d.ellipse([8 - r, 8 - r, 7 + r, 7 + r], fill=cols[0])
    d.ellipse([8 - r + 2, 8 - r + 2, 7 + r - 2, 7 + r - 2], fill=cols[1])
    if r > 4:
        for a in range(0, 360, 45):
            x, y = 8 + int(math.cos(math.radians(a)) * (r + 0)), 8 + int(math.sin(math.radians(a)) * (r + 0))
            if 0 <= x < 16 and 0 <= y < 16: d.point([(x, y)], fill=cols[2])
    else:
        d.ellipse([6, 6, 9, 9], fill=cols[2] if i == 8 else cols[1])
    put(i, im)

# 11..14  the boss: an armoured fish, 32x32 drawn at once and cut into four cells (TL, TR, BL, BR); it faces left
boss = Image.new("RGBA", (32, 32), T)
b = ImageDraw.Draw(boss)
b.polygon([(26, 11), (31, 3), (31, 29), (26, 21)], fill=DB, outline=NAVY)       # the tail
b.polygon([(11, 7), (16, 0), (23, 7)], fill=BL, outline=NAVY)                    # the dorsal fin
b.polygon([(12, 25), (16, 31), (22, 25)], fill=BL, outline=NAVY)                 # the belly fin
b.ellipse([3, 6, 29, 26], fill=DG, outline=NAVY)                                 # the body
b.ellipse([5, 9, 27, 24], fill=GR)
for x in (12, 16, 20, 24):                                                       # armour plates
    b.arc([x - 6, 8, x + 4, 24], 300, 60, fill=DG)
b.polygon([(0, 14), (7, 10), (7, 22), (0, 18)], fill=GR, outline=NAVY)          # the jaw
b.rectangle([0, 15, 5, 17], fill=OR, outline=DR)                                 # the mouth cannon
b.rectangle([0, 16, 2, 16], fill=YE)
b.ellipse([8, 11, 12, 15], fill=WH, outline=NAVY); b.point([(9, 13), (10, 13)], fill=RD)   # the eye
b.ellipse([15, 14, 22, 21], fill=DR, outline=NAVY); b.ellipse([16, 15, 21, 20], fill=RD)    # the core
b.point([(18, 17), (19, 17)], fill=WH)
b.rectangle([13, 24, 17, 26], fill=OR, outline=DR)                               # a belly gun
for k, (x, y) in enumerate(((0, 0), (16, 0), (0, 16), (16, 16))):
    sheet.paste(boss.crop((x, y, x + 16, y + 16)), (((11 + k) % 8) * 16, ((11 + k) // 8) * 16))

sheet.save(OUT + "/sheet.png")

# the background: 256 x 224, seamless left to right (every shape repeats every 256 px).
# Four bands: stars and clouds (y 0-63), far hills (64-127), a city skyline (128-175), the sea (176-223).
W, H = 256, 224
bg = Image.new("RGB", (W, H))
p = bg.load()
def band_color(y):  # the night sky, banded so the importer needs few tiles
    k = y // 16
    return [(8, 8, 40), (14, 12, 56), (24, 16, 72), (38, 22, 84)][min(k, 3)]
def hash2(x, y): return (x * 73856093 ^ y * 19349663) & 0xFFFF
for y in range(H):
    for x in range(W):
        if y < 64:
            c = band_color(y)
            if hash2(x // 1, y // 1) % 211 == 0 and y < 56: c = (230, 230, 255)
            cx = 40 + 128 * ((x // 128))                       # two cloud banks, period 128
            if (x % 128 - 40) ** 2 / 26 ** 2 + (y - 52) ** 2 / 7 ** 2 < 1: c = (70, 44, 112)
            p[x, y] = c
        elif y < 128:
            ridge = 96 - int(14 * (1 + math.sin(2 * math.pi * x / 128 * 1) ) / 2 * 1) - int(8 * (1 + math.sin(2 * math.pi * x / 64 + 1)) / 2)
            p[x, y] = (50, 30, 96) if y >= ridge else band_color(63)
            if y < ridge: p[x, y] = (38, 22, 84)
        elif y < 176:
            bw = 16
            bi = x // bw
            top = 140 + (hash2(bi % 16, 7) % 24)
            if y >= top:
                c = (22, 30, 70)
                if (x % bw) in (3, 4, 9, 10) and (y - top) % 8 in (3, 4) and hash2(bi % 16, y // 8) % 3: c = (255, 220, 110)
                p[x, y] = c
            else:
                p[x, y] = (50, 30, 96) if y >= 128 + 6 else (38, 22, 84)
        else:
            wave = int(2 * math.sin(2 * math.pi * x / 64 + (y - 176) * 0.6))
            base = (20, 70, 130) if (y - 176) // 8 % 2 == 0 else (14, 54, 108)
            c = base
            if (y + wave) % 8 == 0 and (x // 4) % 2 == 0: c = (110, 190, 230)
            p[x, y] = c
bg.save(OUT + "/bg.png")
print("ok")
