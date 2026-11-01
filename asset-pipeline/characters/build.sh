#!/usr/bin/env bash
# Rebuild the built-in characters (public/assets/characters/<profile>.glb)
# from their profiles. Needs Blender 5.x with the MPFB extension and the
# MakeHuman CC0 asset packs (docs/CHARACTER_ASSETS.md).
#
#   asset-pipeline/characters/build.sh               # every profile
#   asset-pipeline/characters/build.sh explorer      # one profile
#   PREVIEW=1 asset-pipeline/characters/build.sh     # also render previews to dist/character-previews/
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BLENDER="${BLENDER:-blender}"
PROFILES=("$@")
if ((${#PROFILES[@]} == 0)); then
  for p in "$ROOT"/asset-pipeline/characters/profiles/*.json; do PROFILES+=("$(basename "$p" .json)"); done
fi
for id in "${PROFILES[@]}"; do
  args=(--out "$ROOT/public/assets/characters/$id.glb")
  [[ "${PREVIEW:-0}" == 1 ]] && args+=(--preview-dir "$ROOT/dist/character-previews")
  "$BLENDER" --background --factory-startup --python "$ROOT/asset-pipeline/characters/build_human.py" -- \
    "$ROOT/asset-pipeline/characters/profiles/$id.json" "${args[@]}" | grep -E '^(BUILD|EXPORTED)' || true
  ls -la "$ROOT/public/assets/characters/$id.glb"
done
