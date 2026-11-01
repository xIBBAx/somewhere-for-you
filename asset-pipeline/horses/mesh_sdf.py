"""Mesh a breed's anatomy SDF with marching cubes (run in a venv with
scikit-image): writes <out>/<breed>_high.ply and <breed>_skeleton.json.

    python asset-pipeline/horses/mesh_sdf.py thoroughbred out_dir [voxel_m]
"""
import json
import os
import sys
import time

import numpy as np
from skimage.measure import marching_cubes

sys.path.insert(0, os.path.dirname(__file__))
import anatomy as A  # noqa: E402


def grid_sdf(prims, lo, hi, h):
    n = np.ceil((hi - lo) / h).astype(int) + 1
    xs = [lo[i] + np.arange(n[i]) * h for i in range(3)]
    d = np.full(n, 1e3, dtype=np.float32)

    def sub(pr):
        a, b = pr.bounds()
        m = pr.k + 2 * h
        i0 = np.clip(np.floor((a - m - lo) / h).astype(int), 0, n - 1)
        i1 = np.clip(np.ceil((b + m - lo) / h).astype(int) + 1, 1, n)
        return (slice(i0[0], i1[0]), slice(i0[1], i1[1]), slice(i0[2], i1[2])), None

    def apply(pr, op):
        (sx, sy, sz), _ = sub(pr)
        # evaluate in x-slabs of at most ~600k points to bound memory
        nx = sx.stop - sx.start
        per = max(1, int(6e5 // max(1, (sy.stop - sy.start) * (sz.stop - sz.start))))
        for x0 in range(sx.start, sx.stop, per):
            x1 = min(sx.stop, x0 + per)
            X, Y, Z = np.meshgrid(xs[0][x0:x1], xs[1][sy], xs[2][sz], indexing="ij")
            P = np.stack([X, Y, Z], -1)
            cur = d[x0:x1, sy, sz].astype(np.float64)
            d[x0:x1, sy, sz] = op(cur, pr.sdf(P), pr.k)

    for pr in prims:
        if not pr.sub:
            apply(pr, A.smin)
    for pr in prims:
        if pr.sub:
            apply(pr, lambda c, e, k: A.smax(c, -e, k))
    Y = (lo[1] + np.arange(n[1]) * h)[None, :, None]
    d = np.maximum(d, -Y)
    return d


def main():
    breed, out = sys.argv[1], sys.argv[2]
    h = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0075
    os.makedirs(out, exist_ok=True)
    t0 = time.time()
    S = A.skeleton(breed)
    prims = A.build_prims(S)
    lo, hi = A.bounds(S, prims)
    h *= S.H / 1.6
    d = grid_sdf(prims, lo, hi, h)
    verts, faces, normals, _ = marching_cubes(d, 0.0, spacing=(h, h, h))
    verts += lo
    print(f"{breed}: grid {d.shape}, {len(verts)} verts {len(faces)} tris in {time.time() - t0:.1f}s")
    with open(os.path.join(out, f"{breed}_high.ply"), "wb") as f:
        f.write(f"ply\nformat binary_little_endian 1.0\nelement vertex {len(verts)}\nproperty float x\nproperty float y\nproperty float z\n"
                f"element face {len(faces)}\nproperty list uchar int vertex_indices\nend_header\n".encode())
        f.write(verts.astype("<f4").tobytes())
        rec = np.empty(len(faces), dtype=[("n", "u1"), ("i", "<i4", (3,))])
        rec["n"] = 3
        # marching_cubes winds faces inward for an SDF that is negative inside
        rec["i"] = faces[:, ::-1]
        f.write(rec.tobytes())
    sk = dict(breed=breed, H=S.H, L=S.L, params=S.p,
              joints={k: list(map(float, v)) for k, v in S.joints.items()},
              tails={k: list(map(float, v)) for k, v in S.tails.items()},
              parents=S.parents, marks={k: list(map(float, v)) for k, v in S.marks.items()},
              head={k: (list(map(float, v)) if hasattr(v, "__len__") else float(v)) for k, v in S.head_frame.items()})
    json.dump(sk, open(os.path.join(out, f"{breed}_skeleton.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
