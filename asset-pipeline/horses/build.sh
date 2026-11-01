#!/bin/bash
# Build realistic horse breeds: anatomy SDF -> marching cubes (venv with
# scikit-image) -> Blender (retopology, bakes, rig, hair, tack) -> glTF
# Transform (quantise, compress textures) -> public/assets/horses/.
#
#   asset-pipeline/horses/build.sh [breed ...]      (default: every breed)
#   FAST=1 asset-pipeline/horses/build.sh arabian   (quick low-res preview build)
#
# PY: a Python with numpy + scikit-image (default ~/.local/share/explorer-horse-tools/venv)
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PY=${PY:-$HOME/.local/share/explorer-horse-tools/venv/bin/python}
WORK=${WORK:-$HOME/explorer-horse-work/build}
OUT=$ROOT/public/assets/horses
mkdir -p "$WORK" "$OUT"
BREEDS=${*:-thoroughbred arabian quarter friesian draft andalusian mustang}
for b in $BREEDS; do
  echo "== $b"
  "$PY" "$ROOT/asset-pipeline/horses/mesh_sdf.py" "$b" "$WORK" ${VOX:-0.0075}
  blender -b --python "$ROOT/asset-pipeline/blender/build_horse.py" -- "$b" "$WORK" "$WORK/glb" ${FAST:+--fast} 2>&1 \
    | grep -E "^\[horse\]|^\[hair\]|Error|Traceback|line [0-9]+" || true
  for f in "$b" "$b-lod1"; do
    "$ROOT/asset-pipeline/horses/pack.sh" "$WORK/glb/$f.glb" "$OUT/$f.glb"
  done
  ls -la "$OUT/$b.glb" "$OUT/$b-lod1.glb"
done
