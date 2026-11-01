#!/bin/bash
# Compress a built horse GLB for the web: quantise normals, UVs, colours and
# skin attributes (positions stay in metres: the coat shader reads the rest
# pose to place markings) and cap textures at 1024 px.
#   asset-pipeline/horses/pack.sh in.glb out.glb
set -euo pipefail
tmp="${2%.glb}.tmp.glb"
npx --yes @gltf-transform/cli@4 quantize "$1" "$tmp" --pattern "{NORMAL,TANGENT,TEXCOORD_*,COLOR_*,JOINTS_*,WEIGHTS_*}" >/dev/null
npx --yes @gltf-transform/cli@4 resize "$tmp" "$2" --width 1024 --height 1024 >/dev/null
rm -f "$tmp"
