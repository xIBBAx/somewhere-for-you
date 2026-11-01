"""Write <out>/<breed>_skeleton.json from the anatomy alone (no meshing), the
same record mesh_sdf.py writes, for quick rig checks (tests/wingFold.test.ts):

    python3 asset-pipeline/pegasus/skeleton_json.py ivory [out_dir]
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "horses"))
import anatomy as A  # noqa: E402

breed = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else "."
S = A.skeleton(breed)
sk = dict(breed=breed, H=S.H, L=S.L, params=S.p,
          joints={k: list(map(float, v)) for k, v in S.joints.items()},
          tails={k: list(map(float, v)) for k, v in S.tails.items()},
          parents=S.parents, marks={k: list(map(float, v)) for k, v in S.marks.items()})
os.makedirs(out, exist_ok=True)
json.dump(sk, open(os.path.join(out, f"{breed}_skeleton.json"), "w"), indent=1)
