"""Fill the no-data holes (pure black) of a greyscale planetary mosaic by
diffusing the surrounding values into them (coarse to fine), so a gap in
spacecraft coverage reads as soft, featureless terrain instead of a hole.

Usage: python fill_nodata.py in.jpg out.jpg
"""
import sys
import numpy as np
from PIL import Image

src, dst = sys.argv[1:3]
img = np.asarray(Image.open(src).convert("L")).astype(np.float32)
hole = img < 6


def fill(a, mask, iters):
    a = a.copy()
    a[mask] = a[~mask].mean() if (~mask).any() else 128
    for _ in range(iters):
        n = (np.roll(a, 1, 1) + np.roll(a, -1, 1) + np.vstack([a[:1], a[:-1]]) + np.vstack([a[1:], a[-1:]])) / 4
        a[mask] = n[mask]
    return a


# coarse pass seeds the large holes, fine pass smooths the seams
small = np.asarray(Image.fromarray(img).resize((img.shape[1] // 8, img.shape[0] // 8), Image.BILINEAR), dtype=np.float32)
small_hole = np.asarray(Image.fromarray((hole * 255).astype(np.uint8)).resize(small.shape[::-1], Image.BILINEAR)) > 200
coarse = fill(small, small_hole, 400)
up = np.asarray(Image.fromarray(coarse).resize(img.shape[::-1], Image.BILINEAR), dtype=np.float32)
seeded = np.where(hole, up, img)
out = fill(seeded, hole, 200) if hole.any() else img
out[hole] = np.where(np.isfinite(out[hole]), out[hole], 128)
Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(dst, quality=88)
print(src, int(hole.sum()), "pixels filled")
