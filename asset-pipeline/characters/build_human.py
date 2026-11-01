"""Build a rigged, game-ready human (GLB) from a JSON profile with MPFB.

    blender --background --factory-startup --python asset-pipeline/characters/build_human.py -- \
        asset-pipeline/characters/profiles/explorer.json [--out FILE.glb] [--preview-dir DIR] [--report FILE.json]

MPFB (MakeHuman for Blender) and its CC0 asset packs supply the body, skin,
eyes, brows, lashes, teeth, hair and clothes. Nothing here uses photographs:
every look comes from the profile's numbers.

Requires the MPFB extension, the MakeHuman CC0 "system assets" pack and the
CC0 "faceunits01" (ARKit) target pack — see docs/CHARACTER_ASSETS.md.

Pipeline (order matters):
  body from macro + detail targets -> standard "game_engine" skeleton -> skin
  (tinted to the profile's tone), eyes, brows, lashes, teeth, hair, clothes
  -> garment recolours by body region -> modelling targets baked -> arms
  lowered and applied as the rest pose the animator expects -> ARKit face
  units on the body, interpolated onto brows/lashes/teeth -> MPFB's export
  service bakes helper/clothes masks keeping shape keys -> eye bones for gaze
  and two "cape" bones whose weights swing the garment's back hem -> bones and
  vertex groups renamed to the animator's names -> scaled to the profile's
  height -> simple glTF materials -> GLB (no animations: the game animates
  the skeleton procedurally).

The animator works in model space (+X the character's left, +Y up, +Z forward
in three.js), so it needs the bone names, the arms-down rest pose and the
palms facing the thighs, not any particular bone roll.
"""
import json, math, os, sys
import addon_utils
import bmesh
import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if not ARGS or ARGS[0].startswith("--"):
    raise SystemExit("usage: blender --background --python build_human.py -- <profile.json> [--out FILE] [--preview-dir DIR] [--report FILE]")
PROFILE_PATH = os.path.abspath(ARGS[0])
OPT = lambda k: ARGS[ARGS.index(k) + 1] if k in ARGS else None  # noqa: E731
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
with open(PROFILE_PATH) as fh:
    P = json.load(fh)
WHO = P["id"]
OUT = OPT("--out") or os.path.join(ROOT, "public", "assets", "characters", f"{WHO}.glb")
PREVIEW_DIR = OPT("--preview-dir")
REPORT = OPT("--report")

addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)
from bl_ext.user_default.mpfb.services.exportservice import ExportService  # noqa: E402
from bl_ext.user_default.mpfb.services.faceservice import FaceService  # noqa: E402
from bl_ext.user_default.mpfb.services.humanservice import HumanService  # noqa: E402
from bl_ext.user_default.mpfb.services.locationservice import LocationService  # noqa: E402
from bl_ext.user_default.mpfb.services.targetservice import TargetService  # noqa: E402

DATA = LocationService.get_user_data()
RNG = np.random.default_rng(int(P.get("seed", 1)))

# MPFB "game_engine" bone -> the animator's name (three.js strips the dots).
BONE_NAMES = {
    "pelvis": "hips", "spine_01": "spine", "spine_02": "spine2", "spine_03": "chest", "neck_01": "neck", "head": "head",
    "clavicle_l": "shoulder.L", "upperarm_l": "upperarm.L", "lowerarm_l": "forearm.L", "hand_l": "hand.L",
    "clavicle_r": "shoulder.R", "upperarm_r": "upperarm.R", "lowerarm_r": "forearm.R", "hand_r": "hand.R",
    "thigh_l": "thigh.L", "calf_l": "shin.L", "foot_l": "foot.L", "ball_l": "toe.L",
    "thigh_r": "thigh.R", "calf_r": "shin.R", "foot_r": "foot.R", "ball_r": "toe.R",
    "Root": "root",
}
for side in ("l", "r"):
    for f in ("index", "middle", "ring", "pinky", "thumb"):
        for k in (1, 2, 3):
            BONE_NAMES[f"{f}_0{k}_{side}"] = f"{f}{k}.{side.upper()}"

# ARKit units kept for the runtime face adapter (src/game/characters/faceRig.ts).
FACE_UNITS = [
    "eyeBlinkLeft", "eyeBlinkRight", "eyeSquintLeft", "eyeSquintRight", "eyeWideLeft", "eyeWideRight",
    "eyeLookInLeft", "eyeLookInRight", "eyeLookOutLeft", "eyeLookOutRight", "eyeLookUpLeft", "eyeLookUpRight",
    "eyeLookDownLeft", "eyeLookDownRight", "jawOpen", "mouthClose", "mouthSmileLeft", "mouthSmileRight",
    "mouthFrownLeft", "mouthFrownRight", "mouthFunnel", "mouthPucker", "browInnerUp", "browDownLeft",
    "browDownRight", "browOuterUpLeft", "browOuterUpRight", "cheekSquintLeft", "cheekSquintRight",
]
TEETH_UNITS = {"jawOpen", "mouthClose", "mouthFunnel", "mouthPucker"}
REPORT_DATA = {"profile": WHO, "steps": []}


def note(step, **kw):
    REPORT_DATA["steps"].append({"step": step, **kw})
    print("BUILD", step, json.dumps(kw)[:400])


def asset_file(kind, name, ext):
    folder = os.path.join(DATA, kind, name)
    for f in sorted(os.listdir(folder)):
        if f.endswith(ext):
            return os.path.join(folder, f)
    raise FileNotFoundError(f"{kind}/{name}/*{ext}")


def mhmat_texture(mhmat, key="diffuseTexture"):
    """Image a .mhmat actually references (not a guess from its folder name)."""
    with open(mhmat) as fh:
        for line in fh:
            parts = line.split(None, 1)
            if len(parts) == 2 and parts[0] == key:
                return os.path.join(os.path.dirname(mhmat), parts[1].strip())
    return None


def mesh_objects():
    return [o for o in bpy.data.objects if o.type == "MESH"]


def set_active(obj):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------- body + assets
bpy.ops.wm.read_factory_settings(use_empty=True)
addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)

basemesh = HumanService.create_human(macro_detail_dict=P["macro"], feet_on_ground=True, scale=0.1)
basemesh.name = f"{WHO}_body"
for cat, target, weight in P.get("detail", []):
    TargetService.load_target(basemesh, os.path.join(LocationService.get_mpfb_data("targets"), cat, f"{target}.target.gz"),
                              weight=weight, name=target)
note("detail_targets", n=len(P.get("detail", [])))
rig = HumanService.add_builtin_rig(basemesh, "game_engine", import_weights=True)
rig.name = f"{WHO}_rig"
skin_mhmat = asset_file("skins", P["skin"], ".mhmat")
HumanService.set_character_skin(skin_mhmat, basemesh, skin_type="MAKESKIN")


def add(kind, name, asset_type):
    path = asset_file(kind, name, ".mhclo")
    return HumanService.add_mhclo_asset(path, basemesh, asset_type=asset_type, subdiv_levels=0, material_type="MAKESKIN")


eyes = add("eyes", "high-poly", "Eyes")
brows = add("eyebrows", P["eyebrows"], "Eyebrows")
lashes = add("eyelashes", P["eyelashes"], "Eyelashes")
teeth = add("teeth", "teeth_base", "Teeth")
hair = add("hair", P["hair"], "Hair") if P.get("hair") else None
outfit = add("clothes", P["outfit"], "Clothes")
shoes = add("clothes", P["shoes"], "Clothes")
note("assets", meshes=[o.name for o in mesh_objects()])

# --------------------------------------------- bake shape, lower the arms
TargetService.bake_targets(basemesh)
set_active(rig)
bpy.ops.object.mode_set(mode="POSE")
for side, sx in (("l", 1), ("r", -1)):
    # Rotate each arm segment about its joint toward an arms-down direction;
    # rotating the A-pose arm down about the forward axis turns the palm to
    # face the thigh, which is what the animator's hand rig assumes.
    for bone, want in ((f"upperarm_{side}", (sx * 0.25, -0.03, -0.967)), (f"lowerarm_{side}", (sx * 0.08, -0.12, -0.99))):
        pb = rig.pose.bones[bone]
        head = Vector(pb.head)
        rot = (Vector(pb.tail) - head).normalized().rotation_difference(Vector(want).normalized()).to_matrix().to_4x4()
        pb.matrix = Matrix.Translation(head) @ rot @ Matrix.Translation(-head) @ pb.matrix
        bpy.context.view_layer.update()
bpy.ops.object.mode_set(mode="OBJECT")
for obj in mesh_objects():
    for mod in list(obj.modifiers):
        if mod.type == "ARMATURE":
            with bpy.context.temp_override(object=obj, active_object=obj):
                bpy.ops.object.modifier_apply(modifier=mod.name)
set_active(rig)
bpy.ops.object.mode_set(mode="POSE")
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode="OBJECT")
for obj in mesh_objects():
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    obj.parent = rig
note("rest_pose", arms="lowered and applied")

# ------------------------------------------------------------ face units
FaceService.load_targets(basemesh, load_microsoft_visemes=False, load_meta_visemes=False, load_arkit_faceunits=True)


def bare_unit(name):
    flat = name.replace("_", "").lower()
    return next((u for u in FACE_UNITS if flat.endswith(u.lower())), None)


keys = basemesh.data.shape_keys
loaded = []
for kb in list(keys.key_blocks):
    if kb == keys.reference_key:
        continue
    unit = bare_unit(kb.name)
    if unit:
        kb.name = unit
        loaded.append(unit)
    else:
        basemesh.shape_key_remove(kb)
missing = [u for u in FACE_UNITS if u not in loaded]
if missing:
    raise RuntimeError(f"face units missing after load (is faceunits01 installed?): {missing}")
# children (brows, lashes, teeth, eyes, clothes) get the same keys through
# the MHCLO correspondence, while their topology still matches the MHCLO
FaceService.interpolate_targets(basemesh)


def prune_keys(obj, keep):
    sk = obj.data.shape_keys
    if not sk:
        return
    for kb in list(sk.key_blocks):
        if kb != sk.reference_key and kb.name not in keep:
            obj.shape_key_remove(kb)
    if len(obj.data.shape_keys.key_blocks) <= 1:
        obj.shape_key_clear()


# Eyeballs turn with eye bones instead (a shape key cannot rotate them);
# clothes, shoes and hair keep their shape.
for obj in [eyes, outfit, shoes] + ([hair] if hair else []):
    prune_keys(obj, set())
prune_keys(teeth, TEETH_UNITS)


def key_delta(obj, name):
    sk = obj.data.shape_keys
    if not sk or name not in sk.key_blocks:
        return 0.0
    kb = sk.key_blocks[name]
    base = np.array([v.co for v in sk.reference_key.data])
    co = np.array([v.co for v in kb.data])
    return float(np.abs(co - base).max())


deltas = {u: round(key_delta(basemesh, u) * 1000, 2) for u in FACE_UNITS}
flat_units = [u for u, d in deltas.items() if d < 0.05]
if flat_units:
    raise RuntimeError(f"face units without deformation: {flat_units}")
note("face_units", count=len(loaded), max_delta_mm=deltas)

# ------------------------------------------------- helpers and hidden body
ExportService.bake_modifiers_remove_helpers(basemesh, bake_masks=True, bake_subdiv=False, remove_helpers=True, also_proxy=False)
for obj in mesh_objects():
    for mod in list(obj.modifiers):
        if mod.type != "ARMATURE":
            obj.modifiers.remove(mod)
note("helpers_removed", body_vertices=len(basemesh.data.vertices))

# --------------------------------------------------------- measurements
bones = rig.data.bones


def bone_head(name):
    return bones[name].head_local.copy()


eye_co = np.array([v.co for v in eyes.data.vertices])
eyeL = Vector(eye_co[eye_co[:, 0] > 0].mean(0))
eyeR = Vector(eye_co[eye_co[:, 0] < 0].mean(0))
neck_base = bone_head("neck_01")
note("landmarks", eyeL=[round(x, 4) for x in eyeL], eyeR=[round(x, 4) for x in eyeR], neck=[round(x, 4) for x in neck_base])


# ------------------------------------------------------------ painting
def image_of(obj):
    for slot in obj.material_slots:
        if slot.material and slot.material.use_nodes:
            for node in slot.material.node_tree.nodes:
                if node.type == "TEX_IMAGE" and node.image:
                    return node.image
    return None


def load_px(img):
    w, h = img.size
    return np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)


def store_px(img, px):
    img.pixels.foreach_set(np.clip(px, 0, 1).ravel())
    img.update()


def paint_by_3d(obj, img, px, face_ok, shade, done=None):
    """Rasterise each accepted polygon into UV space; `shade(p3d, rgb)` returns
    the new colour per texel from its interpolated 3D position, so a recolour
    stays continuous across UV seams."""
    h, w = px.shape[:2]
    if done is None:
        done = np.zeros((h, w), bool)
    uv = obj.data.uv_layers.active.data
    co = [v.co for v in obj.data.vertices]
    count = 0
    for poly in obj.data.polygons:
        if not face_ok(poly):
            continue
        loops = list(poly.loop_indices)
        for k in range(1, len(loops) - 1):
            tri = (loops[0], loops[k], loops[k + 1])
            uvs = np.array([uv[i].uv for i in tri]) * [w, h]
            pts = np.array([co[obj.data.loops[i].vertex_index] for i in tri])
            x0, y0 = np.floor(uvs.min(0)).astype(int)
            x1, y1 = np.ceil(uvs.max(0)).astype(int)
            x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, w - 1), min(y1, h - 1)
            if x1 < x0 or y1 < y0:
                continue
            gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            a, b, c = uvs
            den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(den) < 1e-12:
                continue
            l1 = ((b[1] - c[1]) * (gx - c[0]) + (c[0] - b[0]) * (gy - c[1])) / den
            l2 = ((c[1] - a[1]) * (gx - c[0]) + (a[0] - c[0]) * (gy - c[1])) / den
            l3 = 1 - l1 - l2
            inside = (l1 >= -0.02) & (l2 >= -0.02) & (l3 >= -0.02)
            inside &= ~done[y0:y1 + 1, x0:x1 + 1]
            if not inside.any():
                continue
            p3 = l1[inside, None] * pts[0] + l2[inside, None] * pts[1] + l3[inside, None] * pts[2]
            ys, xs = np.nonzero(inside)
            ys, xs = ys + y0, xs + x0
            px[ys, xs, :3] = shade(p3, px[ys, xs, :3])
            done[ys, xs] = True
            count += int(inside.sum())
    return count


LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)


def recolor_rgb(rgb, rules):
    """Luminance-preserving recolour: texels near a rule's `from` colour take
    its `to` colour, scaled by how light or dark they were relative to `from`,
    so seams, folds, stitching and the AO stay in the fabric."""
    out = rgb.copy()
    for rule in rules:
        src = np.array(rule["from"], np.float32) / 255.0
        dst = np.array(rule["to"], np.float32) / 255.0
        radius = float(rule.get("radius", 0.25))
        d = np.linalg.norm(rgb - src, axis=-1) / math.sqrt(3)
        w = np.clip((radius - d) / max(radius * 0.4, 1e-4), 0, 1)
        w = w * w * (3 - 2 * w)
        ratio = np.clip((rgb @ LUMA) / max(float(src @ LUMA), 0.05), 0, 2.5)
        moved = np.clip(dst[None, :] * ratio[:, None], 0, 1)
        out = out * (1 - w[:, None]) + moved * w[:, None]
    return out


def recolor_object(obj, rules_by_region, name):
    """`rules_by_region`: {"all"|"upper"|"lower": [rule...]}. Upper/lower
    split the garment at the hips, so a shirt and trousers that share one
    texture can take different colours."""
    img = image_of(obj)
    if img is None or not rules_by_region:
        return
    img.pack()
    px = load_px(img)
    hips_z = bone_head("pelvis").z
    # A face belongs to the legs when its skin weights do: the thighs, calves
    # and feet carry it (sleeve cuffs hang below the hips with the arms down,
    # and a trouser's outer seam lies wider than the hip joint, so neither
    # height nor width alone can tell them apart).
    leg_groups = {obj.vertex_groups[g].index for g in ("thigh_l", "thigh_r", "calf_l", "calf_r", "foot_l", "foot_r", "ball_l", "ball_r") if g in obj.vertex_groups}
    arm_groups = {obj.vertex_groups[g].index for g in ("upperarm_l", "upperarm_r", "lowerarm_l", "lowerarm_r", "hand_l", "hand_r") if g in obj.vertex_groups}
    leg_w = np.zeros(len(obj.data.vertices), np.float32)
    arm_w = np.zeros(len(obj.data.vertices), np.float32)
    for v in obj.data.vertices:
        for g in v.groups:
            if g.group in leg_groups:
                leg_w[v.index] += g.weight
            elif g.group in arm_groups:
                arm_w[v.index] += g.weight

    def is_leg(p):
        lw = float(np.mean([leg_w[i] for i in p.vertices]))
        aw = float(np.mean([arm_w[i] for i in p.vertices]))
        # the waistband sits a little above the hip joints
        return lw > 0.25 or (p.center.z < hips_z + 0.06 and aw < 0.2)

    painted = 0
    done = np.zeros(px.shape[:2], bool)
    for region in ("upper", "lower"):
        rules = rules_by_region.get(region)
        if not rules:
            continue
        legs = region == "lower"
        painted += paint_by_3d(obj, img, px, lambda p, want=legs: is_leg(p) == want,
                               lambda p3, rgb, r=rules: recolor_rgb(rgb, r), done)
    if rules_by_region.get("all"):
        # everything not already painted by a region rule
        rest = ~done & (px[..., 3] > 0.01)
        px[..., :3][rest] = recolor_rgb(px[..., :3][rest], rules_by_region["all"])
        painted += int(rest.sum())
    store_px(img, px)
    img.name = f"{WHO}_{name}_color"
    note("recolor", part=name, texels=painted)


# skin: resolve the texture the .mhmat names, tint it to a target mean tone
skin_img = image_of(basemesh)
want_skin = mhmat_texture(skin_mhmat)
if skin_img is None or not want_skin or os.path.basename(skin_img.filepath) != os.path.basename(want_skin):
    raise RuntimeError(f"skin texture mismatch: material {skin_img and skin_img.filepath} vs mhmat {want_skin}")
skin_img.pack()
spx = load_px(skin_img)
if P.get("tone"):
    opaque = spx[..., 3] > 0.5
    bright = spx[..., :3].mean(-1)
    sample = opaque & (bright > 0.12) & (bright < 0.95)
    mean = spx[..., :3][sample].mean(0)
    target = np.array(P["tone"], np.float32) / 255.0
    # match the mean in linear light; keeps pores, veins and shading
    gain = (target ** 2.2) / np.maximum(mean ** 2.2, 1e-4)
    spx[..., :3] = np.clip(spx[..., :3] ** 2.2 * gain, 0, 1) ** (1 / 2.2)
    note("skin_tone", texture=os.path.basename(want_skin), before=[round(float(x) * 255) for x in mean],
         after=[round(float(x) * 255) for x in spx[..., :3][sample].mean(0)], target=list(P["tone"]))
store_px(skin_img, spx)
skin_img.name = f"{WHO}_skin_color"

if hair and P.get("hairTint"):
    himg = image_of(hair)
    himg.pack()
    hpx = load_px(himg)
    tint = np.array(P["hairTint"], np.float32) / 255.0
    lum = hpx[..., :3] @ LUMA
    mean_lum = max(float(lum[hpx[..., 3] > 0.5].mean()), 0.02)
    # the tint is the colour of an average strand; lighter and darker strands
    # keep a compressed share of their contrast, so highlights stay hair and
    # never bleach toward a pale sheen
    ratio = np.clip((lum / mean_lum) ** 0.6, 0.25, 1.8)
    hpx[..., :3] = np.clip(tint[None, None, :] * ratio[..., None], 0, 1)
    store_px(himg, hpx)
    himg.name = f"{WHO}_hair_color"
    note("hair_tint", tint=P["hairTint"])

recolor_object(outfit, P.get("outfitColors", {}), "outfit")
recolor_object(shoes, P.get("shoeColors", {}), "shoes")

eye_png = os.path.join(DATA, "eyes", "materials", f"{P['eyes']}_eye.png")
eye_img = image_of(eyes)
if eye_img and os.path.exists(eye_png):
    eye_img.filepath = eye_png
    eye_img.reload()

# the clear cornea shell would hide the iris behind a grey film in three.js
epx = load_px(image_of(eyes))
e_uv = eyes.data.uv_layers.active.data
eh, ew = epx.shape[:2]
cornea = [p.index for p in eyes.data.polygons
          if epx[min(eh - 1, int(np.mean([e_uv[i].uv[1] for i in p.loop_indices]) * eh)),
                 min(ew - 1, int(np.mean([e_uv[i].uv[0] for i in p.loop_indices]) * ew)), 3] < 0.5]
set_active(eyes)
bpy.ops.object.mode_set(mode="EDIT")
bme = bmesh.from_edit_mesh(eyes.data)
bme.faces.ensure_lookup_table()
bmesh.ops.delete(bme, geom=[bme.faces[i] for i in cornea], context="FACES")
bmesh.update_edit_mesh(eyes.data)
bpy.ops.object.mode_set(mode="OBJECT")
note("cornea_removed", faces=len(cornea))

# ------------------------------------------------ eye and cape bones
set_active(rig)
bpy.ops.object.mode_set(mode="EDIT")
eb = rig.data.edit_bones
for e, s in ((eyeL, "l"), (eyeR, "r")):
    b = eb.new(f"eye_{s}")
    b.head = e
    b.tail = e + Vector((0, -0.03, 0))
    b.parent = eb["head"]
spine3 = eb["spine_03"]
# The two cape bones hang down the back from the lower spine: the garment's
# back hem (a shirt tail, a jacket's skirt, the bib of dungarees) swings on
# them when the character runs, turns or lands.
hips_z = bone_head("pelvis").z
c_head = Vector((0, bone_head("spine_02").y + 0.13, bone_head("spine_01").z))
c_mid = Vector((0, c_head.y + 0.01, hips_z - 0.02))
c_tail = Vector((0, c_head.y + 0.02, hips_z - 0.12))
cape = eb.new("cape")
cape.head, cape.tail, cape.parent = c_head, c_mid, spine3
cape2 = eb.new("cape2")
cape2.head, cape2.tail, cape2.parent = c_mid, c_tail, cape
cape2.use_connect = True
bpy.ops.object.mode_set(mode="OBJECT")
for e, s in (("eye_l", 1), ("eye_r", -1)):
    g = eyes.vertex_groups.get(e) or eyes.vertex_groups.new(name=e)
    idx = [v.index for v in eyes.data.vertices if v.co.x * s > 0]
    hg = eyes.vertex_groups.get("head")
    if hg:
        hg.remove(idx)
    g.add(idx, 1.0, "REPLACE")
hem = float(P.get("hemSway", 0.45))
if hem > 0:
    gc = outfit.vertex_groups.new(name="cape")
    gc2 = outfit.vertex_groups.new(name="cape2")
    swung = 0
    for v in outfit.data.vertices:
        co = v.co
        if co.y < bone_head("spine_02").y + 0.03 or abs(co.x) > 0.17 or co.z > bone_head("spine_01").z + 0.02 or co.z < hips_z - 0.16:
            continue
        w = smoothstep(bone_head("spine_01").z, hips_z - 0.12, co.z) * hem
        if w <= 0:
            continue
        for g in v.groups:
            g.weight *= 1 - w
        (gc2 if co.z < hips_z - 0.04 else gc).add([v.index], w, "REPLACE")
        swung += 1
    note("hem_sway", vertices=swung, strength=hem)

# ------------------------------------------------------------ rename
for b in rig.data.bones:
    if b.name in BONE_NAMES:
        b.name = BONE_NAMES[b.name]  # vertex groups follow bone renames
for b, n in (("eye_l", "eye.L"), ("eye_r", "eye.R")):
    rig.data.bones[b].name = n
names = {b.name for b in rig.data.bones}
for obj in mesh_objects():
    for g in obj.vertex_groups:
        if g.name in BONE_NAMES:
            g.name = BONE_NAMES[g.name]
        elif g.name in ("eye_l", "eye_r"):
            g.name = "eye.L" if g.name == "eye_l" else "eye.R"
    # drop vertex groups that are not bones (MPFB's helper/mask groups)
    for g in list(obj.vertex_groups):
        if g.name not in names:
            obj.vertex_groups.remove(g)

# --------------------------------------------------------- names, materials
# Meshes are named by role only ("body", "hair", "outfit"...): the game picks
# each part's material from that role, for this rig and for imported ones.
ROLES = {basemesh: "body", eyes: "eyes", brows: "brows", lashes: "lashes", teeth: "teeth", outfit: "outfit", shoes: "shoes"}
if hair:
    ROLES[hair] = "hair"
for obj, role in ROLES.items():
    obj.name = role
    obj.data.name = role
rig.name = "rig"
rig.data.name = "rig"


def make_material(name, image=None, color=(1, 1, 1, 1), rough=0.6, metal=0.0, alpha=False, normal=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        if alpha:
            nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    if normal is not None:
        nm = nt.nodes.new("ShaderNodeTexImage")
        nm.image = normal
        normal.colorspace_settings.name = "Non-Color"
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(nm.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    if alpha:
        m.surface_render_method = "DITHERED"
    return m


def one_material(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.material_index = 0


def sized(img, size):
    """Downscale in memory; packing first keeps the scaled pixels (packing a
    file-backed image later would re-read the full-size original)."""
    if img is None:
        return None
    if not img.packed_file:
        img.pack()
    if max(img.size) > size:
        img.scale(size, size)
    return img


def outfit_normal():
    path = mhmat_texture(asset_file("clothes", P["outfit"], ".mhmat"), "normalmapTexture")
    if path and os.path.exists(path):
        img = bpy.data.images.load(path)
        img.name = f"{WHO}_outfit_normal"
        return sized(img, 1024)
    return None


one_material(basemesh, make_material("skin", sized(skin_img, 2048), rough=0.55))
one_material(eyes, make_material("eyes", sized(image_of(eyes), 512), rough=0.15))
one_material(brows, make_material("brows", sized(image_of(brows), 512), alpha=True, rough=0.8))
one_material(lashes, make_material("lashes", sized(image_of(lashes), 512), alpha=True, rough=0.8))
one_material(teeth, make_material("teeth", sized(image_of(teeth), 512), rough=0.35))
one_material(outfit, make_material("outfit", sized(image_of(outfit), 1024), rough=0.85, normal=outfit_normal()))
one_material(shoes, make_material("shoes", sized(image_of(shoes), 1024), rough=0.7))
if hair:
    one_material(hair, make_material("hair", sized(image_of(hair), 1024), alpha=True, rough=0.7))
# images keep neutral names: no source file paths travel into the GLB
for img in bpy.data.images:
    if img.users and not img.name.startswith(WHO):
        img.name = f"{WHO}_{os.path.splitext(img.name)[0]}"

# --------------------------------------------------------------- scale
top = max((rig.matrix_world @ v.co).z for v in basemesh.data.vertices)
factor = P["height"] / top
for obj in [rig] + mesh_objects():
    if obj.parent is None or obj is rig:
        obj.scale = (factor, factor, factor)
for obj in [rig] + mesh_objects():
    set_active(obj)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
note("scale", factor=round(factor, 4), height=P["height"], before=round(top, 4))

# ------------------------------------------------------------- preview
if PREVIEW_DIR:
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 720, 960
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.2
    sun.rotation_euler = Euler((math.radians(55), math.radians(10), math.radians(25)))
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.62, 0.7, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.9
    scene.world = world
    h = P["height"]
    views = {
        "front": ((0, -3.3 * h / 1.7, h * 0.55), (90, 0, 0), 50),
        "side": ((3.3 * h / 1.7, 0, h * 0.55), (90, 0, 90), 50),
        "back": ((0, 3.3 * h / 1.7, h * 0.55), (90, 0, 180), 50),
        "face": ((0.25, -0.75, h - 0.1), (90, 0, 18), 85),
    }
    for name, (loc, rot, lens) in views.items():
        cam.location = loc
        cam.rotation_euler = Euler([math.radians(r) for r in rot])
        cam.data.lens = lens
        scene.render.filepath = os.path.join(PREVIEW_DIR, f"{WHO}-{name}.png")
        bpy.ops.render.render(write_still=True)
    # an expression check: smile + squint on every mesh that has the keys
    for obj in mesh_objects():
        sk = obj.data.shape_keys
        if sk:
            for k in ("mouthSmileLeft", "mouthSmileRight", "cheekSquintLeft", "cheekSquintRight", "eyeSquintLeft", "eyeSquintRight"):
                if k in sk.key_blocks:
                    sk.key_blocks[k].value = 0.8
    cam.location, cam.rotation_euler, cam.data.lens = views["face"][0], Euler([math.radians(r) for r in views["face"][1]]), 85
    scene.render.filepath = os.path.join(PREVIEW_DIR, f"{WHO}-smile.png")
    bpy.ops.render.render(write_still=True)
    for obj in mesh_objects():
        sk = obj.data.shape_keys
        if sk:
            for kb in sk.key_blocks:
                kb.value = 0.0
    for o in (cam, sun):
        bpy.data.objects.remove(o)

# --------------------------------------------------------------- export
os.makedirs(os.path.dirname(OUT), exist_ok=True)
for obj in bpy.data.objects:
    obj.select_set(obj is rig or obj.type == "MESH")
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format="GLB", use_selection=True, export_yup=True,
    export_skins=True, export_morph=True, export_morph_normal=False, export_try_sparse_sk=True,
    export_animations=False, export_def_bones=False, export_rest_position_armature=True,
    export_image_format="WEBP", export_image_quality=82, export_materials="EXPORT",
    export_texcoords=True, export_normals=True, export_tangents=False, export_attributes=True,
    export_extras=False, export_apply=False, export_copyright="CC0-1.0",
)
REPORT_DATA["glb"] = {"file": os.path.basename(OUT), "bytes": os.path.getsize(OUT)}
REPORT_DATA["bones"] = sorted(b.name for b in rig.data.bones)
REPORT_DATA["meshes"] = {o.name: {"vertices": len(o.data.vertices), "keys": [k.name for k in o.data.shape_keys.key_blocks[1:]] if o.data.shape_keys else []} for o in mesh_objects()}
print("EXPORTED", OUT, REPORT_DATA["glb"]["bytes"])
if REPORT:
    with open(REPORT, "w") as fh:
        json.dump(REPORT_DATA, fh, indent=1)
