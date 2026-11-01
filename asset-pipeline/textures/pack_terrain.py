"""Packs Poly Haven ground scans into the terrain layers in public/assets/textures/terrain.

Usage: python3 asset-pipeline/textures/pack_terrain.py <out-dir> 1024 rocky_terrain_02 leafy_grass forest_ground_04 forest_leaves_02 aerial_rocks_02 coast_sand_01 grass_path_2
Run from a directory holding <asset>/{diff,ao,nor,arm}.jpg downloads (api.polyhaven.com, CC0).
Writes <asset>_albedo.jpg (sRGB, AO-darkened cavities) and <asset>_nr.jpg (normal XY + roughness).
"""
from PIL import Image
import numpy as np, json, sys
def pack(layers, out, size=1024, prefix=""):
    means = []
    for i, n in enumerate(layers):
        a = Image.open(f"{n}/diff.jpg").convert("RGB").resize((size,size), Image.LANCZOS)
        ao = Image.open(f"{n}/ao.jpg").convert("L").resize((size,size), Image.LANCZOS)
        A = np.asarray(a).astype(np.float32)/255.0
        O = np.asarray(ao).astype(np.float32)/255.0
        A = A * (0.6 + 0.4*O)[...,None]
        Image.fromarray((np.clip(A,0,1)*255+0.5).astype(np.uint8)).save(f"{out}/{prefix}{n}_albedo.jpg", quality=86, optimize=True)
        means.append([round(float(x),4) for x in np.power(A, 2.2).reshape(-1,3).mean(0)])
        nrm = np.asarray(Image.open(f"{n}/nor.jpg").convert("RGB").resize((size,size), Image.LANCZOS))
        arm = np.asarray(Image.open(f"{n}/arm.jpg").convert("RGB").resize((size,size), Image.LANCZOS))
        Image.fromarray(np.stack([nrm[...,0], nrm[...,1], arm[...,1]], -1)).save(f"{out}/{prefix}{n}_nr.jpg", quality=90, optimize=True)
    return means
if __name__ == "__main__":
    out = sys.argv[1]; size = int(sys.argv[2]); layers = sys.argv[3:]
    m = pack(layers, out, size)
    json.dump({"layers": layers, "linearMeans": m}, open(f"{out}/layers.json","w"), indent=1)
    print(m)
