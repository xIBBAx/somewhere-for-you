#!/usr/bin/env bash
# Provisions the offline authoring toolchain for this project's asset
# pipelines on Linux x86_64. The game itself only needs `npm ci`; nothing here
# becomes a runtime dependency. The asset pipelines need only the stages
# base python blender mpfb node; the others are optional extras.
#
#   asset-pipeline/setup/bootstrap-authoring-tools.sh [stage...]
#
# Stages (default: all, in this order): base python blender mpfb cad node
# craft remotion blendermcp. Every stage is idempotent: a stage whose pinned
# result is already present is skipped. Downloads are checked against the
# pinned SHA-256 in authoring-tools.lock.json, or (for the MakeHuman packs,
# which publish no checksums) against HTTP status, ZIP signature and
# `unzip -t` before anything is installed.
#
# Everything lands in $WORLD_TOOLS (default /opt/world-tools); Blender user
# data goes to Blender's own per-user config. Nothing is written into the
# repository. Large stages exceed a five-minute setup-script budget, so run
# them in-session rather than from the environment's startup script.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCK="$ROOT/asset-pipeline/setup/authoring-tools.lock.json"
T="${WORLD_TOOLS:-/opt/world-tools}"
DL="$T/downloads"
mkdir -p "$T" "$DL" "$T/bin"

pin() { python3 -c "import json,sys; d=json.load(open('$LOCK')); v=d; [v:=v[k] for k in sys.argv[1].split('.')]; print(v)" "$1"; }
log() { printf '\n== %s\n' "$*"; }

fetch_sha() { # url out sha256
  local url=$1 out=$2 sha=$3
  if [[ -f $out ]] && echo "$sha  $out" | sha256sum -c --quiet 2>/dev/null; then return 0; fi
  curl -fsSL --retry 3 -o "$out.part" "$url"
  echo "$sha  $out.part" | sha256sum -c --quiet
  mv "$out.part" "$out"
}

fetch_zip() { # url out — for hosts that publish no checksum
  local url=$1 out=$2 code
  [[ -f $out ]] && unzip -tq "$out" >/dev/null 2>&1 && return 0
  code=$(curl -sSL --retry 3 -o "$out.part" -w '%{http_code}' "$url")
  [[ $code == 200 && $(head -c 2 "$out.part") == PK ]] || { echo "refusing $url: HTTP $code / not a ZIP" >&2; rm -f "$out.part"; return 1; }
  unzip -tq "$out.part" >/dev/null
  mv "$out.part" "$out"
  sha256sum "$out"
}

stage_base() {
  log "system packages (OpenSCAD, Xvfb, FFmpeg, ImageMagick, fonts)"
  local need=()
  for p in openscad xvfb ffmpeg imagemagick fonts-dejavu-core; do dpkg -s "$p" >/dev/null 2>&1 || need+=("$p"); done
  if ((${#need[@]})); then
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${need[@]}"
  fi
  openscad --version
}

stage_python() {
  log "imaging/audio Python venv ($T/img-venv)"
  [[ -x $T/img-venv/bin/python ]] || uv venv --python 3.12 "$T/img-venv"
  uv pip install --python "$T/img-venv/bin/python" -q $(pin python.img_venv)
  "$T/img-venv/bin/python" -c "import numpy, PIL, cv2, scipy, pyloudnorm, soundfile; print('img-venv ok')"
}

stage_blender() {
  local v; v=$(pin blender.version)
  log "Blender $v"
  if [[ ! -x $T/blender/blender ]] || ! "$T/blender/blender" --version 2>/dev/null | grep -q "Blender $v"; then
    fetch_sha "$(pin blender.url)" "$DL/blender-$v.tar.xz" "$(pin blender.sha256)"
    rm -rf "$T/blender" && mkdir -p "$T/blender"
    tar -xJf "$DL/blender-$v.tar.xz" -C "$T/blender" --strip-components=1
  fi
  "$T/blender/blender" --version | head -1
}

stage_mpfb() {
  log "MPFB extension + MakeHuman CC0 assets + ARKit face units"
  local B="$T/blender/blender" mh="$DL/mh"; mkdir -p "$mh"
  fetch_sha "$(pin mpfb.url)" "$mh/mpfb.zip" "$(pin mpfb.sha256)"
  "$B" --background --factory-startup --command extension install-file -r user_default -e "$mh/mpfb.zip" >/dev/null
  "$B" --background --python-expr "import addon_utils, bpy; addon_utils.enable('bl_ext.user_default.mpfb', default_set=True); bpy.ops.wm.save_userpref()" >/dev/null
  local data; data=$("$B" --background --python-expr "import addon_utils; addon_utils.enable('bl_ext.user_default.mpfb'); from bl_ext.user_default.mpfb.services.locationservice import LocationService as L; print('DATA='+L.get_user_data())" 2>/dev/null | sed -n 's/^DATA=//p')
  mkdir -p "$data"
  python3 - "$LOCK" <<'PY' > "$mh/packs.txt"
import json, sys
for name, url in json.load(open(sys.argv[1]))["mpfb"]["packs"].items(): print(name, url)
PY
  while read -r name url; do
    fetch_zip "$url" "$mh/$name.zip"
    unzip -oq "$mh/$name.zip" -d "$data"
  done < "$mh/packs.txt"
  ls "$data/targets/faceunits" | wc -l | xargs echo "face unit targets:"
}

stage_cad() {
  log "FreeCAD AppImage (extracted) + CadQuery/CQ-editor venv"
  local v; v=$(pin freecad.version)
  if [[ ! -x $T/freecad/squashfs-root/usr/bin/freecadcmd ]]; then
    fetch_sha "$(pin freecad.url)" "$DL/freecad.AppImage" "$(pin freecad.sha256)"
    chmod +x "$DL/freecad.AppImage"
    rm -rf "$T/freecad" && mkdir -p "$T/freecad"
    (cd "$T/freecad" && "$DL/freecad.AppImage" --appimage-extract >/dev/null)
  fi
  [[ -x $T/cq-venv/bin/python ]] || uv venv --python 3.12 "$T/cq-venv"
  uv pip install --python "$T/cq-venv/bin/python" -q "cadquery==$(pin cadquery.version)"
  if [[ ! -d $T/src/CQ-editor ]]; then
    git clone -q https://github.com/CadQuery/CQ-editor "$T/src/CQ-editor"
  fi
  git -C "$T/src/CQ-editor" fetch -q --depth 1 origin "$(pin cq_editor.commit)" && git -C "$T/src/CQ-editor" checkout -q "$(pin cq_editor.commit)"
  uv pip install --python "$T/cq-venv/bin/python" -q "$T/src/CQ-editor"
  "$T/cq-venv/bin/python" -c "import cadquery; print('cadquery', cadquery.__version__)"
}

stage_node() {
  log "Node authoring CLIs ($T/node)"
  mkdir -p "$T/node" && cd "$T/node"
  [[ -f package.json ]] || npm init -y >/dev/null
  npm install --no-fund --no-audit -s $(pin node.packages)
  ./node_modules/.bin/gltf-transform --version
  ./node_modules/.bin/playwright-cli --version
}

stage_craft() {
  log "ArtCraft PhotoCraft / EffectCraft / DesignCraft"
  python3 - "$LOCK" <<'PY' > "$DL/craft.txt"
import json, sys
for name, c in json.load(open(sys.argv[1]))["craft"].items(): print(name, c["url"], c["sha256"], c["version"])
PY
  while read -r name url sha ver; do
    if ! "$T/$name/bin/$name-cli" --version 2>/dev/null | grep -q "$ver"; then
      fetch_sha "$url" "$DL/$name.tar.gz" "$sha"
      rm -rf "${T:?}/$name" && mkdir -p "$T/$name"
      tar -xzf "$DL/$name.tar.gz" -C "$T/$name" --strip-components=1
    fi
    "$T/$name/bin/$name-cli" --version
  done < "$DL/craft.txt"
}

stage_remotion() {
  log "Remotion authoring workspace ($T/remotion)"
  mkdir -p "$T/remotion" && cd "$T/remotion"
  [[ -f package.json ]] || echo '{ "name": "explorer-remotion-authoring", "private": true, "type": "module" }' > package.json
  npm install --no-fund --no-audit -s $(pin remotion.packages)
}

stage_blendermcp() {
  log "MCP for Blender server + add-on"
  UV_TOOL_DIR="$T/uv-tools" UV_TOOL_BIN_DIR="$T/bin" uv tool install -q "mcp-for-blender==$(pin blender_mcp.version)"
  if [[ ! -d $T/src/mcp-for-blender ]]; then git clone -q https://github.com/ahujasid/mcp-for-blender "$T/src/mcp-for-blender"; fi
  git -C "$T/src/mcp-for-blender" fetch -q --depth 1 origin "$(pin blender_mcp.addon_commit)" && git -C "$T/src/mcp-for-blender" checkout -q "$(pin blender_mcp.addon_commit)"
  local addons; addons=$("$T/blender/blender" --background --python-expr "import bpy; print('ADDONS='+bpy.utils.user_resource('SCRIPTS', path='addons', create=True))" 2>/dev/null | sed -n 's/^ADDONS=//p')
  cp "$T/src/mcp-for-blender/addon.py" "$addons/blendermcp_addon.py"
  "$T/blender/blender" --background --python-expr "import addon_utils, bpy; addon_utils.enable('blendermcp_addon', default_set=True); bpy.ops.wm.save_userpref()" >/dev/null
  # Chrome refuses to run as root; QA browsers run as this unprivileged user.
  id worldqa >/dev/null 2>&1 || useradd -m -s /bin/bash worldqa
}

STAGES=("$@")
((${#STAGES[@]})) || STAGES=(base python blender mpfb cad node craft remotion blendermcp)
for s in "${STAGES[@]}"; do "stage_$s"; done
log "done: ${STAGES[*]}"
