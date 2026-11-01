"""Bounded offline SDF mesher for cervid anatomy. No runtime dependency.

Run with the project's existing horse-tools Python (numpy/scikit-image).
Unlike additive metaballs, a smooth minimum preserves authored body dimensions.
"""
import json
import sys
sys.dont_write_bytecode = True
from pathlib import Path
import numpy as np
from skimage.measure import marching_cubes

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "horses"))
from anatomy import sd_ellipsoid, smin

spec = json.load(open(sys.argv[1]))
masses = [(np.array(c), np.array(r)) for c, r in spec["masses"]]
h, k = spec["height"] * .009, spec["height"] * .053
lo = np.min([c-r for c,r in masses], axis=0)-k*2
hi = np.max([c+r for c,r in masses], axis=0)+k*2
n = np.ceil((hi-lo)/h).astype(int)+1
xs = [lo[i]+np.arange(n[i])*h for i in range(3)]
d = np.full(n, 100, dtype=np.float32)
for c,r in masses:
    i0 = np.maximum(0,np.floor((c-r-k*2-lo)/h).astype(int))
    i1 = np.minimum(n,np.ceil((c+r+k*2-lo)/h).astype(int)+1)
    sl = tuple(slice(int(a),int(b)) for a,b in zip(i0,i1))
    p = np.stack(np.meshgrid(*[x[s] for x,s in zip(xs,sl)], indexing="ij"),-1)
    d[sl] = smin(d[sl],sd_ellipsoid(p,c,r),k)
v,f,_,_ = marching_cubes(d,0,spacing=(h,h,h))
v += lo
with open(sys.argv[2],"wb") as out:
    out.write((f"ply\nformat binary_little_endian 1.0\nelement vertex {len(v)}\n"
      f"property float x\nproperty float y\nproperty float z\nelement face {len(f)}\n"
      "property list uchar int vertex_indices\nend_header\n").encode())
    out.write(v.astype("<f4").tobytes())
    # skimage's default descent winding is outward for this field. Verified
    # with positive signed mesh volume and outward flank normals in Blender.
    rec=np.empty(len(f),dtype=[("n","u1"),("v","<i4",(3,))]);rec["n"]=3;rec["v"]=f
    out.write(rec.tobytes())
print("deer SDF:",len(v),"vertices",len(f),"triangles",flush=True)
