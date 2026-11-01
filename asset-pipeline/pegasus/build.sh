#!/bin/bash
# Build the winged horses (Ivory, Onyx, Starborn) through the horse pipeline:
# anatomy SDF (with flight muscles) -> marching cubes -> Blender (retopology,
# bakes, 50-bone rig with feathered wings, hair, tack, Starborn's horn and
# tandem saddle) -> glTF Transform -> public/assets/horses/.
#
#   asset-pipeline/pegasus/build.sh [ivory onyx starborn]
#   FAST=1 asset-pipeline/pegasus/build.sh ivory     (quick low-detail build)
#
# The feather atlas (2048x1024 RGBA) keeps its resolution; everything else is
# packed as the horses are (asset-pipeline/horses/pack.sh). Previews: PREVIEW=1.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PY=${PY:-$HOME/.local/share/explorer-horse-tools/venv/bin/python}
WORK=${WORK:-$HOME/explorer-horse-work/pegasus}
OUT=$ROOT/public/assets/horses
mkdir -p "$WORK/glb" "$OUT"
for b in ${*:-ivory onyx starborn}; do
  echo "== $b"
  "$PY" "$ROOT/asset-pipeline/horses/mesh_sdf.py" "$b" "$WORK" ${VOX:-$([ -n "${FAST:-}" ] && echo 0.012 || echo 0.0075)}
  stamp="$WORK/.build-$b"
  touch "$stamp"
  blender -b --python "$ROOT/asset-pipeline/blender/build_horse.py" -- "$b" "$WORK" "$WORK/glb" ${FAST:+--fast} 2>&1 \
    | grep -E "^\[horse\]|^\[hair\]|Error|Traceback|line [0-9]+" || true
  # Blender's exit status is lost in the pipe: insist on a fresh export
  if [ ! "$WORK/glb/$b.glb" -nt "$stamp" ]; then echo "!! $b: Blender did not export a new model" >&2; exit 1; fi
  for f in "$b" "$b-lod1"; do
    tmp="$WORK/glb/$f.q.glb"
    npx --yes @gltf-transform/cli@4 quantize "$WORK/glb/$f.glb" "$tmp" --pattern "{NORMAL,TANGENT,TEXCOORD_*,COLOR_*,JOINTS_*,WEIGHTS_*}" >/dev/null
    npx --yes @gltf-transform/cli@4 resize "$tmp" "$tmp.r.glb" --width 2048 --height 2048 >/dev/null
    # the feather atlas keeps its alpha as lossy WebP (EXT_texture_webp); the
    # baked normal map stays JPEG
    npx --yes @gltf-transform/cli@4 webp "$tmp.r.glb" "$OUT/$f.glb" --slots "baseColorTexture" --quality 88 >/dev/null
    rm -f "$tmp" "$tmp.r.glb"
  done
  ls -la "$OUT/$b.glb" "$OUT/$b-lod1.glb"
  if [ -n "${PREVIEW:-}" ]; then
    mkdir -p "$WORK/prev"
    blender -b --python "$ROOT/asset-pipeline/horses/preview_lit.py" -- "$OUT/$b.glb" "$WORK/prev/$b" front3q,side,top,wing,head --samples 16 2>&1 | grep -E "^\[preview\]" || true
  fi
done
