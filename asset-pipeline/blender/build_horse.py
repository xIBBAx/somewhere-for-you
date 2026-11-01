"""Build one realistic horse breed as a rigged, game-ready GLB.

    blender -b --python asset-pipeline/blender/build_horse.py -- <breed> <work_dir> <out_dir> [--fast]

Inputs come from asset-pipeline/horses (see asset-pipeline/horses/build.sh):
  <work>/<breed>_high.ply       marching-cubes mesh of the anatomy SDF
  <work>/<breed>_skeleton.json  landmarks, joints and the head frame

Steps: retopologise the high mesh (QuadriFlow), shrink-wrap it back onto the
sculpt, UV it, bake a tangent-space normal map and ambient occlusion from the
high mesh, build the 40-bone equine armature, assign skin weights from the
anatomy (each muscle mass carries its bone), then grow the hair (mane,
forelock, tail and feathering as alpha cards simulated against the body SDF),
the ears and eyes, and the tack (saddle, stirrups, bridle). Exports
<out>/<breed>.glb and a decimated <breed>-lod1.glb on the same skeleton.

Everything is original and generated here; nothing is downloaded.
"""
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "horses"))
import anatomy as A  # noqa: E402
import hair as HAIR  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
BREED, WORK, OUT = argv[0], argv[1], argv[2]
FAST = "--fast" in argv
os.makedirs(OUT, exist_ok=True)
P = A.BREEDS[BREED]
SK = json.load(open(os.path.join(WORK, f"{BREED}_skeleton.json")))
S = A.skeleton(BREED)
PRIMS = A.build_prims(S)
ORDER = A.bone_order(S)
WINGED = bool(P.get("wing"))
H = S.H
TEX = 512 if FAST else 1024


# three.js (x left, y up, z forward) <-> Blender (x, -z, y)
def tb(p):
    return Vector((p[0], -p[2], p[1]))


def bt(v):
    return np.array([v[0], v[2], -v[1]])


def bt_arr(a):
    return np.stack([a[:, 0], a[:, 2], -a[:, 1]], axis=1)


def tb_arr(a):
    return np.stack([a[:, 0], -a[:, 2], a[:, 1]], axis=1)


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def select_only(*objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def mesh_obj(name, verts, faces, uvs=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    if uvs is not None:
        layer = me.uv_layers.new(name="UVMap")
        for li, loop in enumerate(me.loops):
            layer.data[li].uv = uvs[loop.vertex_index]
    me.update()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob


# ---------------------------------------------------------------- high mesh
bpy.ops.wm.ply_import(filepath=os.path.join(WORK, f"{BREED}_high.ply"))
high = bpy.context.selected_objects[0]
high.name = "high"
high.data.transform(Matrix.Rotation(math.pi / 2, 4, "X"))
for poly in high.data.polygons:
    poly.use_smooth = True

# ---------------------------------------------------------------- low mesh
low = high.copy()
low.data = high.data.copy()
low.name = "body"
scene.collection.objects.link(low)
select_only(low)
# QuadriFlow is far faster and more reliable on a pre-decimated input
dec = low.modifiers.new("dec", "DECIMATE")
dec.ratio = 0.25
bpy.ops.object.modifier_apply(modifier="dec")
target_quads = 4200 if FAST else 8800
try:
    bpy.ops.object.quadriflow_remesh(target_faces=target_quads, use_mesh_symmetry=True, use_preserve_sharp=False,
                                     use_preserve_boundary=False, smooth_normals=False, seed=7)
except Exception as e:  # pragma: no cover - fallback keeps the build going
    print("[horse] quadriflow failed, decimating instead:", e)
    dec = low.modifiers.new("dec", "DECIMATE")
    dec.ratio = (target_quads * 2) / max(1, len(low.data.polygons))
    bpy.ops.object.modifier_apply(modifier="dec")
# QuadriFlow can also give up without raising (non-manifold input): check
if len(low.data.polygons) > target_quads * 1.6:
    print(f"[horse] quadriflow left {len(low.data.polygons)} faces; decimating instead")
    select_only(low)
    dec = low.modifiers.new("dec", "DECIMATE")
    dec.ratio = (target_quads * 2) / max(1, len(low.data.polygons))
    bpy.ops.object.modifier_apply(modifier="dec")
sw = low.modifiers.new("sw", "SHRINKWRAP")
sw.target = high
sw.wrap_method = "NEAREST_SURFACEPOINT"
bpy.ops.object.modifier_apply(modifier="sw")
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.quads_convert_to_tris(quad_method="BEAUTY", ngon_method="BEAUTY")
bpy.ops.object.mode_set(mode="OBJECT")
for poly in low.data.polygons:
    poly.use_smooth = True


def outward(obj):
    select_only(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")


outward(high)
outward(low)
print(f"[horse] {BREED}: low body {len(low.data.polygons)} tris")

# ---------------------------------------------------------------- UVs
select_only(low)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0, scale_to_bounds=True)
bpy.ops.object.mode_set(mode="OBJECT")


# ---------------------------------------------------------------- bake
def bake(kind, image_name, size, samples):
    img = bpy.data.images.new(image_name, size, size, alpha=False, float_buffer=False)
    if kind == "NORMAL":
        img.colorspace_settings.name = "Non-Color"
    mat = low.active_material
    if mat is None:
        mat = bpy.data.materials.new("HorseCoat")
        mat.use_nodes = True
        low.data.materials.append(mat)
    nodes = mat.node_tree.nodes
    node = nodes.new("ShaderNodeTexImage")
    node.image = img
    nodes.active = node
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    select_only(high)
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    scene.render.bake.use_selected_to_active = True
    scene.render.bake.cage_extrusion = 0.015
    scene.render.bake.max_ray_distance = 0.04
    scene.render.bake.margin = 6
    scene.render.bake.normal_space = "TANGENT"
    bpy.ops.object.bake(type=kind)
    nodes.remove(node)
    return img


normal_img = bake("NORMAL", f"{BREED}_normal", TEX, 1)


def save_jpeg(img, path, quality=88):
    img.filepath_raw = path
    img.file_format = "JPEG"
    scene.render.image_settings.quality = quality
    img.save_render(path)


os.makedirs(WORK, exist_ok=True)
normal_path = os.path.join(WORK, f"{BREED}_normal.jpg")
save_jpeg(normal_img, normal_path, 90)

# ---------------------------------------------------------------- armature
arm_data = bpy.data.armatures.new("horseRig")
rig = bpy.data.objects.new("horse", arm_data)
scene.collection.objects.link(rig)
select_only(rig)
bpy.ops.object.mode_set(mode="EDIT")
eb = arm_data.edit_bones
for name in ORDER:
    b = eb.new(name)
    head = tb(SK["joints"][name])
    tail = tb(SK["tails"].get(name, list(np.array(SK["joints"][name]) + np.array([0, 0.1, 0]))))
    if name == "root":
        tail = head + Vector((0, -0.2, 0))
    if (tail - head).length < 1e-3:
        tail = head + Vector((0, 0, 0.05))
    b.head, b.tail = head, tail
    b.roll = 0
for name in ORDER:
    parent = SK["parents"].get(name)
    if parent:
        eb[name].parent = eb[parent]
        eb[name].use_connect = False
bpy.ops.object.mode_set(mode="OBJECT")


def skin(obj, weights_fn=None, fixed=None):
    """Bind `obj` to the rig: anatomical weights by default, or `fixed`
    {bone: weight} / a callable returning (idx, w) for the vertices."""
    vs = np.array([v.co[:] for v in obj.data.vertices])
    for name in ORDER:
        if name not in obj.vertex_groups:
            obj.vertex_groups.new(name=name)
    if fixed is not None:
        for bname, w in fixed.items():
            obj.vertex_groups[bname].add(list(range(len(vs))), w, "REPLACE")
    else:
        idx, w = (weights_fn or (lambda P: A.bone_weights(S, PRIMS, P)))(bt_arr(vs))
        groups = [obj.vertex_groups[n] for n in ORDER]
        for vi in range(len(vs)):
            for k in range(idx.shape[1]):
                if w[vi, k] > 1e-3:
                    groups[idx[vi, k]].add([vi], float(w[vi, k]), "REPLACE")
    obj.parent = rig
    mod = obj.modifiers.new("rig", "ARMATURE")
    mod.object = rig


skin(low)

# ---------------------------------------------------------------- eyes & ears
hf = SK["head"]
axis = np.array(hf["axis"])
dorsal = np.array(hf["dorsal"])
sc = hf["length"] / 0.6
eyes = []
for side in ("L", "R"):
    c = tb(SK["marks"][f"eye{side}"])
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=10, radius=0.0215 * sc)
    for v in bm.verts:
        # a horse's eye is wider than it is tall and set looking outwards
        v.co.x *= 0.72
        v.co.z *= 0.86
        v.co += c
    me_e = bpy.data.meshes.new(f"eye{side}")
    bm.to_mesh(me_e)
    bm.free()
    ob = bpy.data.objects.new(f"eye{side}", me_e)
    scene.collection.objects.link(ob)
    for poly in me_e.polygons:
        poly.use_smooth = True
    eyes.append(ob)
eye_obj = eyes[0]
select_only(*eyes)
bpy.ops.object.join()
eye_obj = bpy.context.view_layer.objects.active
eye_obj.name = "eyes"
eye_obj.data.materials.append(bpy.data.materials.new("HorseEye"))
skin(eye_obj, fixed={"head": 1.0})


def build_ear(side):
    """A cupped, pointed ear: a C-shaped section open towards the front that
    narrows to a tip, given thickness with a solidify."""
    base = np.array(SK["joints"][f"ear{side}"])
    tip = np.array(SK["tails"][f"ear{side}"])
    up = tip - base
    length = np.linalg.norm(up)
    up /= length
    fwd = A.norm(np.array([0.0, 0.0, 1.0]) - up * up[2])
    lat = np.cross(up, fwd)
    verts, faces = [], []
    rings, seg = 9, 9
    for i in range(rings):
        u = i / (rings - 1)
        w = 0.042 * sc * P["ear"] * math.sin(math.pi * (0.2 + 0.8 * u)) ** 0.7 * (1 - u) ** 0.35 + 0.002
        depth = w * 0.8
        for j in range(seg):
            a = math.pi * (-0.62 + 1.24 * j / (seg - 1))  # opening faces forward
            p = base + up * (u * length) + lat * (math.sin(a) * w) - fwd * (math.cos(a) * depth) + fwd * depth * 0.55
            verts.append(tb(p))
    for i in range(rings - 1):
        for j in range(seg - 1):
            a, b = i * seg + j, i * seg + j + 1
            faces.append((a, b, b + seg, a + seg))
    ob = mesh_obj(f"ear{side}", verts, faces)
    sol = ob.modifiers.new("s", "SOLIDIFY")
    sol.thickness = 0.006 * sc
    sol.offset = 1
    select_only(ob)
    bpy.ops.object.modifier_apply(modifier="s")
    for poly in ob.data.polygons:
        poly.use_smooth = True
    # base blends into the head, the rest swivels with the ear bone
    vs = bt_arr(np.array([v.co[:] for v in ob.data.vertices]))
    t = np.clip(((vs - base) @ up) / length, 0, 1)
    idx = np.zeros((len(vs), 2), dtype=int)
    idx[:, 0] = A.BONE_ORDER.index(f"ear{side}")
    idx[:, 1] = A.BONE_ORDER.index("head")
    wv = np.stack([np.clip(t * 4, 0.3, 1), 1 - np.clip(t * 4, 0.3, 1)], axis=1)
    skin(ob, weights_fn=lambda _P: (idx, wv))
    return ob


ears = [build_ear("L"), build_ear("R")]
for e in ears:
    e.data.materials.append(low.active_material)

# ---------------------------------------------------------------- hair
hair_objs = HAIR.grow(S, PRIMS, P, tb_arr, mesh_obj, skin, quality=0 if FAST else 1)
hair_mat = bpy.data.materials.new("HorseHair")
for ob in hair_objs:
    ob.data.materials.append(hair_mat)

# ---------------------------------------------------------------- tack
import tack as TACK  # noqa: E402

tack_objs = TACK.build(S, PRIMS, P, tb, tb_arr, bt_arr, mesh_obj, skin, select_only, low)

# ---------------------------------------------------------------- wings, horn
wing_objs, wing_lod = [], []
if WINGED:
    import wings as WINGS  # noqa: E402

    atlas_path = os.path.join(WORK, f"{BREED}_feathers.png")
    atlas = WINGS.atlas_image(BREED, atlas_path)
    feather_mat = bpy.data.materials.new("Feathers")
    feather_mat.use_nodes = True
    fnt = feather_mat.node_tree
    fb = fnt.nodes.get("Principled BSDF")
    ftex = fnt.nodes.new("ShaderNodeTexImage")
    ftex.image = bpy.data.images.load(atlas_path)
    fnt.links.new(ftex.outputs["Color"], fb.inputs["Base Color"])
    fnt.links.new(ftex.outputs["Alpha"], fb.inputs["Alpha"])
    try:
        feather_mat.blend_method = "CLIP"
    except (AttributeError, TypeError):
        pass
    w0 = WINGS.build(S, P, tb_arr, mesh_obj, skin, ORDER, lod=0)
    w0.data.materials.append(feather_mat)
    wing_objs.append(w0)
    if P.get("horn"):
        hn = WINGS.horn(S, tb_arr, mesh_obj, skin)
        hn.data.materials.append(bpy.data.materials.new("HornPearl"))
        wing_objs.append(hn)
    print(f"[horse] wings: {len(w0.data.polygons)} faces")

# merge the ears into the body so the coat is one draw call
select_only(low, *ears)
bpy.context.view_layer.objects.active = low
bpy.ops.object.join()


def sdf_ao(obj):
    """Ambient occlusion from the anatomy's distance field: march a few steps
    along each normal and measure how much of the body crowds the point. The
    creases at the elbow, throat, stifle fold and between the legs darken;
    ears and other parts outside the field stay open."""
    me = obj.data
    vs = bt_arr(np.array([v.co[:] for v in me.vertices]))
    # a retopology/decimation fault can leave non-finite vertices (seen once on
    # a Onyx build: streaks of geometry to the origin); never ship that
    bad = ~np.isfinite(vs).all(axis=1)
    if bad.any():
        raise SystemExit(f"[horse] ERROR: {int(bad.sum())} non-finite body vertices; rebuild")
    from hair import sdf_grad
    _, ns = sdf_grad(PRIMS, vs)
    occ = np.zeros(len(vs))
    for i, dist in enumerate((0.015, 0.04, 0.08, 0.15)):
        d = A.evaluate(PRIMS, vs + ns * dist)
        occ += np.clip(dist - d, 0, None) / dist * (0.55 ** i)
    ao = np.clip(1.0 - occ * 0.55, 0.3, 1.0)
    col = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    vco = np.zeros((len(vs), 4))
    vco[:, 0] = vco[:, 1] = vco[:, 2] = ao
    vco[:, 3] = 1.0
    col.data.foreach_set("color", vco.ravel())
    me.color_attributes.active_color = col
    print(f"[horse] AO min {ao.min():.2f} mean {ao.mean():.2f}")


sdf_ao(low)


def join(name, objs):
    objs = [o for o in objs if o is not None]
    if not objs:
        return None
    select_only(*objs)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    return ob


# fewer draw calls: all hair in one mesh, the tack in one mesh per material
hair_one = join("hair", hair_objs)
hair_objs = [hair_one] if hair_one else []
by = {o.name: o for o in tack_objs}
leather = join("tack_leather", [by.get(n) for n in ("tack_saddle", "tack_girth", "tack_leatherL", "tack_leatherR", "tack_leatherL2", "tack_leatherR2", "tack_bridle")])
metal = join("tack_metal", [by.get(n) for n in ("tack_ironL", "tack_ironR", "tack_ironL2", "tack_ironR2")])
tack_objs = [o for o in (by.get("tack_pad"), leather, metal) if o is not None]

# ---------------------------------------------------------------- metadata
meta = dict(
    breed=BREED, height=H, length=S.L, params=P,
    hooves={k: SK["tails"][k] for k in ("hoofFL", "hoofFR", "hoofBL", "hoofBR")},
    head=hf, marks=SK["marks"], tack=TACK.META,
)
if WINGED:
    meta["wing"] = dict(P["wing"], bones=[n for n in ORDER if n.startswith("wing")],
                        groups={str(g): v for g, v in sorted(WINGS.GROUPS.items())})
rig["horse"] = json.dumps(meta)


# ---------------------------------------------------------------- export
def export(path, objs):
    select_only(rig, *objs)
    opts = dict(filepath=path, export_format="GLB", use_selection=True, export_normals=True,
                export_tangents=True, export_vertex_color="ACTIVE", export_all_vertex_colors=False,
                export_materials="EXPORT", export_image_format="AUTO" if WINGED else "JPEG", export_jpeg_quality=88,
                export_skins=True, export_animations=False, export_yup=True, export_extras=True,
                export_texcoords=True, export_attributes=True)
    while True:
        try:
            bpy.ops.export_scene.gltf(**opts)
            return
        except TypeError as e:  # an option this exporter version does not know
            bad = [k for k in opts if f'"{k}"' in str(e) or f"'{k}'" in str(e)]
            if not bad:
                raise
            print("[horse] exporter ignores", bad)
            for k in bad:
                opts.pop(k)


# the coat material carries the baked normal map
mat = low.active_material
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes.get("Principled BSDF")
tex = nt.nodes.new("ShaderNodeTexImage")
tex.image = bpy.data.images.load(normal_path)
tex.image.colorspace_settings.name = "Non-Color"
nmap = nt.nodes.new("ShaderNodeNormalMap")
nt.links.new(tex.outputs["Color"], nmap.inputs["Color"])
nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
bpy.data.objects.remove(high, do_unlink=True)
parts = [low, eye_obj] + hair_objs + tack_objs + wing_objs
export(os.path.join(OUT, f"{BREED}.glb"), parts)

# LOD1: the same skeleton with a decimated body, fewer hair cards, no eyes
for ob in [low]:
    select_only(ob)
    d = ob.modifiers.new("lod", "DECIMATE")
    d.ratio = 0.24
    ob.modifiers.move(len(ob.modifiers) - 1, 0)
    bpy.ops.object.modifier_apply(modifier="lod")
lod_hair = HAIR.lod(hair_objs, select_only)
if WINGED:
    for o in wing_objs:
        bpy.data.objects.remove(o, do_unlink=True)
    w1 = WINGS.build(S, P, tb_arr, mesh_obj, skin, ORDER, lod=1)
    # the game draws the far wings with the near wings' material: no second atlas
    w1.data.materials.append(bpy.data.materials.new("Feathers_lod"))
    wing_lod = [w1]
export(os.path.join(OUT, f"{BREED}-lod1.glb"), [low] + lod_hair + [o for o in tack_objs if o.name != "tack_metal"] + wing_lod)
print(f"[horse] exported {BREED}")
