"""Builds public/assets/vegetation/foliage-atlas.png from photographed leaves.

The atlas keeps the original 4 x 2 layout of 512 px cells used by the
Blender vegetation library (asset-pipeline/blender/build_vegetation.py), so every
existing leaf card keeps its UVs; only the pixels become photographic:

  (0,0) broadleaf cluster   island_tree_01/02 leaves
  (1,0) blossom cluster     periwinkle flowers (five-petalled, sakura-like)
  (2,0) conifer sprigs      fir_tree_01 / pine_sapling_small twigs
  (3,0) willow strands      shrub_02 lanceolate leaves on hanging lines
  (0,1) small-leaf cluster  periwinkle leaves
  (1,1) fern frond          fern_02
  (2,1) serrated cluster    nettle_plant leaves
  (3,1) loose magic leaves  shrub_04 leaves with tiny bright motes

All sources are CC0 scans from Poly Haven (ASSET_LICENSES.md).
The shader tints the atlas per vertex, so leaves are stored as warm-neutral
luminance with a little of their own colour variation. Transparent texels
carry bled leaf colour, so distant mip levels never fade crowns to white.

Usage: python3 asset-pipeline/textures/build_foliage_atlas.py <source-dir> <out.png>
The source dir holds <asset>__<map>.png downloads from api.polyhaven.com.
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

SRC, OUT = sys.argv[1], sys.argv[2]
CELL = 512
rng = np.random.default_rng(20261009)


def load(asset, diff, alpha, pick=None, min_area=900, pixel_green=False):
    rgb = np.asarray(Image.open(f"{SRC}/{asset}__{diff}.png").convert("RGB")).astype(np.float32) / 255
    a_img = Image.open(f"{SRC}/{asset}__{alpha}.png")
    a = np.asarray(a_img).astype(np.float32)
    a = a / (65535.0 if a.max() > 255 else 255.0)
    if a.ndim == 3:
        a = a[..., 0]
    if pixel_green:
        # drop non-leaf texels (padding stripes, stems) inside a component
        hsv = np.asarray(Image.fromarray((rgb * 255).astype(np.uint8)).convert("HSV")).astype(np.float32)
        hue, sat = hsv[..., 0] * 360 / 255, hsv[..., 1] / 255
        leaf = (hue > 58) & (hue < 160) & (sat > 0.28)
        a = a * ndimage.binary_opening(leaf, iterations=3)
    labels, n = ndimage.label(a > 0.5)
    sprites = []
    for i, sl in enumerate(ndimage.find_objects(labels), 1):
        if sl is None:
            continue
        mask = labels[sl] == i
        area = mask.sum()
        if area < min_area:
            continue
        crop_rgb = rgb[sl]
        crop_a = a[sl] * ndimage.binary_dilation(mask, iterations=2)
        mean = crop_rgb[mask].mean(0)
        if pick and not pick(mean, mask):
            continue
        sprites.append(np.dstack([crop_rgb, crop_a]))
    print(asset, len(sprites), "sprites")
    return sprites


def rotate(sprite, deg, scale):
    im = Image.fromarray((np.clip(sprite, 0, 1) * 255).astype(np.uint8), "RGBA")
    w, h = im.size
    im = im.resize((max(2, int(w * scale)), max(2, int(h * scale))), Image.LANCZOS)
    im = im.rotate(deg, resample=Image.BICUBIC, expand=True)
    return np.asarray(im).astype(np.float32) / 255


def paste(canvas, sprite, cx, cy, shade):
    h, w = sprite.shape[:2]
    x0, y0 = int(cx - w / 2), int(cy - h / 2)
    x1, y1 = x0 + w, y0 + h
    sx0, sy0 = max(0, -x0), max(0, -y0)
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(CELL, x1), min(CELL, y1)
    if x1 <= x0 or y1 <= y0:
        return
    s = sprite[sy0:sy0 + (y1 - y0), sx0:sx0 + (x1 - x0)]
    a = s[..., 3:4]
    region = canvas[y0:y1, x0:x1]
    region[..., :3] = region[..., :3] * (1 - a) + s[..., :3] * shade * a
    region[..., 3:4] = np.maximum(region[..., 3:4], a)


def longest(sprite):
    return max(sprite.shape[0], sprite.shape[1])


def cluster(sprites, count, radius, size, outward=True, jitter=40):
    """Leaves radiate from the twig centre; back leaves are darker."""
    c = np.zeros((CELL, CELL, 4), np.float32)
    items = []
    for k in range(count):
        s = sprites[rng.integers(len(sprites))]
        r = radius * np.sqrt(rng.random()) * CELL
        ang = rng.random() * 2 * np.pi
        cx, cy = CELL / 2 + np.cos(ang) * r, CELL / 2 + np.sin(ang) * r
        depth = rng.random()
        # leaf tips point away from the centre of the cluster
        deg = (-np.degrees(ang) - 90 if outward else rng.random() * 360) + rng.normal(0, jitter)
        scale = size * CELL / longest(s) * (0.7 + rng.random() * 0.5)
        items.append((depth, s, cx, cy, deg, scale, r / (radius * CELL + 1e-5)))
    for depth, s, cx, cy, deg, scale, rim in sorted(items, key=lambda t: t[0]):
        paste(c, rotate(s, deg, scale), cx, cy, 0.62 + 0.38 * depth * (0.75 + 0.25 * rim))
    return c


def sprigs(sprites, count):
    c = np.zeros((CELL, CELL, 4), np.float32)
    big = sorted(sprites, key=lambda s: -s[..., 3].sum())[:6]
    for k in range(count):
        s = big[k % len(big)]
        scale = 0.95 * CELL / longest(s) * (0.85 + rng.random() * 0.25)
        deg = 45 + rng.normal(0, 18) + (k - count / 2) * 12
        paste(c, rotate(s, deg, scale), CELL * (0.45 + rng.normal(0, 0.05)), CELL * (0.5 + rng.normal(0, 0.05)), 0.7 + 0.3 * k / max(1, count - 1))
    return c


def strands(sprites, lines, per_line, size):
    c = np.zeros((CELL, CELL, 4), np.float32)
    for li in range(lines):
        x = (li + 0.5) / lines * CELL + rng.normal(0, 6)
        sway = rng.normal(0, 10)
        for k in range(per_line):
            t = (k + rng.random() * 0.4) / per_line
            s = sprites[rng.integers(len(sprites))]
            side = 1 if k % 2 else -1
            deg = 180 + side * (28 + rng.normal(0, 8))
            scale = size * CELL / longest(s) * (0.75 + rng.random() * 0.4)
            paste(c, rotate(s, deg, scale), x + sway * t + side * 6, t * CELL * 0.97 + 8, 0.66 + 0.34 * rng.random())
    return c


def frond(sprites):
    c = np.zeros((CELL, CELL, 4), np.float32)
    s = max(sprites, key=lambda s: s[..., 3].sum())
    h, w = s.shape[:2]
    deg = 0 if h >= w else 90
    scale = 0.98 * CELL / longest(s)
    paste(c, rotate(s, deg, scale), CELL / 2, CELL / 2, 1.0)
    return c


def neutralise(cell, target, motes=0):
    """Warm-neutral luminance with 30% of the leaf's own colour variation."""
    rgb, a = cell[..., :3], cell[..., 3]
    m = a > 0.5
    lum = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
    ratio = rgb / np.maximum(lum[..., None], 1e-3)
    mean_ratio = ratio[m].mean(0)
    lum_n = lum / max(lum[m].mean(), 1e-3) * target
    tint = np.array([1.0, 0.985, 0.925], np.float32)
    out = lum_n[..., None] * tint * (1 + 0.2 * (ratio / mean_ratio - 1))
    out = np.clip(out, 0, 0.965)
    if motes:
        ys, xs = np.nonzero(m)
        for i in rng.choice(len(ys), motes, replace=False):
            y, x = ys[i], xs[i]
            out[max(0, y - 2):y + 3, max(0, x - 2):x + 3] = 1.0
    return np.dstack([out, a])


def bleed(cell):
    """Progressive fill: transparent texels take the nearest leaf colour."""
    rgb = cell[..., :3].copy()
    known = cell[..., 3] > 0.05
    for sigma in (2, 4, 8, 16, 32, 64, 128):
        k = known.astype(np.float32)
        num = ndimage.gaussian_filter(rgb * k[..., None], (sigma, sigma, 0))
        den = ndimage.gaussian_filter(k, sigma)
        newly = (~known) & (den > 1e-4)
        rgb[newly] = num[newly] / den[newly][..., None]
        known |= newly
    rgb[~known] = rgb[known].mean(0)
    return np.dstack([rgb, cell[..., 3]])


# leaves fill 30–85% of their box; opaque padding blocks in the scans fill ~100%
leafy = lambda m, mask: m[1] > m[2] * 1.08 and m[1] > m[0] * 0.85 and 0.3 < mask.mean() < 0.85
twiggy = lambda m, mask: m[1] > m[2] * 1.05 and mask.mean() < 0.6
pink = lambda m, mask: m[0] > m[1] + 0.15 and m[2] > m[1]

broad = load("island_tree_01", "leaves_diff", "leaves_alpha", leafy) + load("island_tree_02", "leaves_diff", "leaves_alpha", leafy)
flowers = load("periwinkle", "Diffuse", "Alpha", pink, 2500)
twigs = load("fir_tree_01", "twig_diff", "twig_alpha", twiggy, 4000) + load("pine_sapling_small", "twig_diff", "twig_alpha", twiggy, 4000)
narrow = load("shrub_02", "Diffuse", "Alpha", leafy, 600)
small = load("periwinkle", "Diffuse", "Alpha", leafy, 2500)
fern = load("fern_02", "Diffuse", "Alpha", twiggy, 5000)
nettle = load("nettle_plant", "Diffuse", "Alpha", leafy, 9000, pixel_green=True)
loose = load("shrub_04", "Diffuse", "Alpha", leafy, 600)

cells = [
    [neutralise(cluster(broad, 72, 0.37, 0.2), 0.81), neutralise(cluster(flowers, 70, 0.38, 0.105, outward=False, jitter=180), 0.89),
     neutralise(sprigs(twigs, 3), 0.66), neutralise(strands(narrow, 13, 15, 0.14), 0.72)],
    [neutralise(cluster(small, 95, 0.37, 0.14), 0.77), neutralise(frond(fern), 0.72),
     neutralise(cluster(nettle, 56, 0.36, 0.2), 0.75), neutralise(cluster(loose, 26, 0.38, 0.17, outward=False, jitter=180), 0.76, motes=14)],
]
atlas = np.zeros((CELL * 2, CELL * 4, 4), np.float32)
for r in range(2):
    for c in range(4):
        cell = bleed(cells[r][c])
        print("cell", r, c, "coverage", round(float((cell[..., 3] > 0.5).mean()), 3))
        atlas[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL] = cell
Image.fromarray((np.clip(atlas, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(OUT, optimize=True)
print("wrote", OUT)
