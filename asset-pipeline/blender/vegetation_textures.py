"""
Foliage atlas for the explorer's world (2048x1024, 4x2 cells of 512 px).

Cells hold *luminance* detail (near-neutral colour) plus alpha; the final
hue comes from per-vertex species colours baked in Blender and per-instance
tints at runtime. That lets one atlas serve every species and season.

  0 broadleaf cluster   1 blossom cluster   2 pine needles   3 willow strands
  4 small round leaves  5 fern frond        6 maple leaves   7 glow leaves

Run:  python3 asset-pipeline/blender/vegetation_textures.py
"""
import math
import random
from PIL import Image, ImageDraw, ImageFilter

CELL = 512
SS = 3  # supersampling
W, H = CELL * 4, CELL * 2
OUT = "public/assets/vegetation/foliage-atlas.png"


def leaf_poly(cx, cy, length, width, angle, tip=0.9, n=18, lobes=0, lobe_depth=0.0):
    pts_l, pts_r = [], []
    for i in range(n + 1):
        t = i / n
        w = math.sin(math.pi * t) ** tip * width
        if lobes:
            w *= 1 - lobe_depth * (0.5 + 0.5 * math.cos(t * math.pi * 2 * lobes))
        pts_l.append((t * length, w))
        pts_r.append((t * length, -w))
    pts = pts_l + pts_r[::-1]
    ca, sa = math.cos(angle), math.sin(angle)
    return [(cx + x * ca - y * sa, cy + x * sa + y * ca) for x, y in pts]


def shade(v, jitter=0.0):
    v = max(0, min(255, int(v + jitter)))
    # very slightly warm highlights / cool shadows
    return (min(255, int(v * 1.02)), v, max(0, int(v * 0.94)), 255)


def cluster(draw, ox, oy, rnd, count, leaf_len, leaf_w, spread, tip=0.85, lobes=0, lobe_depth=0.0, vein=True):
    s = CELL * SS
    cx, cy = ox + s / 2, oy + s / 2
    leaves = []
    for _ in range(count):
        a = rnd.uniform(0, math.pi * 2)
        r = (rnd.random() ** 0.6) * spread * s
        px, py = cx + math.cos(a) * r, cy + math.sin(a) * r
        ang = a + rnd.uniform(-0.6, 0.6)
        depth = rnd.random()
        leaves.append((depth, px, py, ang))
    leaves.sort()
    for depth, px, py, ang in leaves:
        L = leaf_len * s * rnd.uniform(0.8, 1.15)
        Wd = leaf_w * s * rnd.uniform(0.85, 1.15)
        # start leaf slightly toward the centre so it reads as attached
        sx, sy = px - math.cos(ang) * L * 0.5, py - math.sin(ang) * L * 0.5
        base = 120 + depth * 120
        poly = leaf_poly(sx, sy, L, Wd, ang, tip, lobes=lobes, lobe_depth=lobe_depth)
        draw.polygon(poly, fill=shade(base, rnd.uniform(-10, 10)))
        if vein:
            ex, ey = sx + math.cos(ang) * L * 0.92, sy + math.sin(ang) * L * 0.92
            draw.line([(sx, sy), (ex, ey)], fill=shade(base * 0.82), width=max(1, int(SS * 2.2)))


def blossom_cluster(draw, ox, oy, rnd):
    """Dense sakura spray: many small, pale five-petal flowers with notched
    petals and a soft pink-white centre (stamens as tiny darker dots), over a
    few young leaves, like a real flowering branch tip."""
    s = CELL * SS
    cx, cy = ox + s / 2, oy + s / 2
    cluster(draw, ox, oy, rnd, 8, 0.15, 0.05, 0.3, vein=False)
    flowers = []
    for _ in range(110):
        a = rnd.uniform(0, math.pi * 2)
        r = (rnd.random() ** 0.5) * 0.38 * s
        flowers.append((rnd.random(), cx + math.cos(a) * r, cy + math.sin(a) * r))
    flowers.sort()
    for depth, px, py in flowers:
        pr = s * rnd.uniform(0.024, 0.034)
        rot = rnd.uniform(0, math.pi)
        base = 205 + depth * 50
        for k in range(5):
            ang = rot + k * math.pi * 2 / 5
            poly = leaf_poly(px, py, pr * 1.15, pr * 0.6, ang, tip=0.5, n=12, lobes=1, lobe_depth=0.18)
            draw.polygon(poly, fill=shade(base, rnd.uniform(-6, 6)))
        cr = pr * 0.2
        draw.ellipse([px - cr, py - cr, px + cr, py + cr], fill=shade(base * 0.9))
        for k in range(5):
            ang = rot + (k + 0.5) * math.pi * 2 / 5
            sx, sy = px + math.cos(ang) * pr * 0.32, py + math.sin(ang) * pr * 0.32
            dr = max(1.0, pr * 0.06)
            draw.ellipse([sx - dr, sy - dr, sx + dr, sy + dr], fill=shade(base * 0.7))


def needles(draw, ox, oy, rnd):
    s = CELL * SS
    cx, cy = ox + s / 2, oy + s * 0.5
    for b in range(9):
        ang = -math.pi / 2 + rnd.uniform(-1.3, 1.3)
        L = s * rnd.uniform(0.32, 0.46)
        bx, by = cx + rnd.uniform(-0.05, 0.05) * s, cy + rnd.uniform(-0.02, 0.1) * s
        for i in range(46):
            t = i / 46
            px, py = bx + math.cos(ang) * L * t, by + math.sin(ang) * L * t
            for side in (-1, 1):
                na = ang + side * (0.75 + rnd.uniform(-0.15, 0.15))
                nl = s * 0.075 * (1 - t * 0.55)
                base = 110 + rnd.random() * 120
                draw.line([(px, py), (px + math.cos(na) * nl, py + math.sin(na) * nl)], fill=shade(base), width=int(SS * 2.4))
        draw.line([(bx, by), (bx + math.cos(ang) * L, by + math.sin(ang) * L)], fill=shade(90), width=int(SS * 3))


def willow(draw, ox, oy, rnd):
    s = CELL * SS
    for k in range(13):
        x0 = ox + s * (0.1 + 0.8 * k / 12 + rnd.uniform(-0.03, 0.03))
        y0 = oy + s * 0.04
        L = s * rnd.uniform(0.75, 0.94)
        for i in range(40):
            t = i / 40
            px = x0 + math.sin(t * 3 + k) * s * 0.02
            py = y0 + L * t
            for side in (-1, 1):
                ang = math.pi / 2 + side * 0.5
                base = 120 + rnd.random() * 120
                poly = leaf_poly(px, py, s * 0.06, s * 0.011, ang, tip=0.7, n=8)
                draw.polygon(poly, fill=shade(base))


def fern(draw, ox, oy, rnd):
    s = CELL * SS
    bx, by = ox + s * 0.5, oy + s * 0.96
    L = s * 0.9
    for i in range(34):
        t = i / 34
        px, py = bx + math.sin(t * 1.4) * s * 0.06, by - L * t
        pl = s * 0.2 * math.sin(math.pi * min(1, t * 1.15 + 0.08)) ** 0.8
        for side in (-1, 1):
            ang = -math.pi / 2 + side * (1.2 - t * 0.5)
            base = 120 + rnd.random() * 100 + t * 30
            draw.polygon(leaf_poly(px, py, pl, s * 0.018, ang, tip=0.6, n=10, lobes=4, lobe_depth=0.35), fill=shade(base))
    draw.line([(bx, by), (bx + math.sin(1.4) * s * 0.06, by - L)], fill=shade(100), width=int(SS * 4))


def glow(draw, ox, oy, rnd):
    cluster(draw, ox, oy, rnd, 26, 0.16, 0.055, 0.34, tip=0.7)
    s = CELL * SS
    # bright motes stored as near-white specks: the runtime treats very bright
    # texels in this cell as emissive.
    for _ in range(40):
        px, py = ox + s * rnd.uniform(0.15, 0.85), oy + s * rnd.uniform(0.15, 0.85)
        r = s * rnd.uniform(0.006, 0.012)
        draw.ellipse([px - r, py - r, px + r, py + r], fill=(255, 255, 255, 255))


def main():
    rnd = random.Random(20260525)
    img = Image.new("RGBA", (W * SS, H * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cs = CELL * SS
    cluster(d, 0, 0, rnd, 64, 0.165, 0.06, 0.34)  # broadleaf
    blossom_cluster(d, cs, 0, rnd)
    needles(d, cs * 2, 0, rnd)
    willow(d, cs * 3, 0, rnd)
    cluster(d, 0, cs, rnd, 84, 0.11, 0.05, 0.37, tip=0.6)  # small round leaves
    fern(d, cs, cs, rnd)
    cluster(d, cs * 2, cs, rnd, 26, 0.2, 0.1, 0.32, tip=0.75, lobes=3, lobe_depth=0.45)  # maple
    glow(d, cs * 3, cs, rnd)
    # box filter: Lanczos rings at alpha edges and left a bright fringe on
    # every leaf card where the cutout lands
    img = img.resize((W, H), Image.BOX)
    # dilate colour into transparent texels (alpha-weighted blur pyramid) so
    # mip levels and alpha-to-coverage edges never pick up a halo
    rgba = img
    base = Image.new("RGB", img.size, (150, 150, 140))
    filled = rgba.convert("RGB")
    alpha = rgba.getchannel("A")
    mask = alpha.point(lambda a: 255 if a > 128 else 0)
    acc = Image.composite(filled, Image.new("RGB", img.size, (0, 0, 0)), mask)
    from PIL import ImageChops, ImageMath
    for radius in (2, 4, 8, 16, 32):
        blur_c = acc.filter(ImageFilter.GaussianBlur(radius))
        blur_m = mask.filter(ImageFilter.GaussianBlur(radius))
        bands = []
        for band in blur_c.split():
            # colour normalised by coverage = average of nearby opaque texels
            bands.append(ImageMath.lambda_eval(
                lambda a: a["convert"](a["min"](a["float"](a["c"]) * 255.0 / a["max"](a["float"](a["m"]), 1.0), 255.0), "L"),
                c=band, m=blur_m))
        norm = Image.merge("RGB", bands)
        # only trust the normalised colour where enough opaque texels contributed
        reliable = blur_m.point(lambda v: 255 if v > 48 else 0)
        grow = ImageChops.subtract(reliable, mask)
        acc = Image.composite(norm, acc, grow)
        mask = ImageChops.lighter(mask, reliable)
    blurred = Image.composite(acc, base, mask)
    blurred.putalpha(alpha)
    blurred.save(OUT, optimize=True)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
