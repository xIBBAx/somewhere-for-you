"""Lit, textured previews (Cycles, CPU) of a built horse or Pegasus GLB,
for judging coat, hair and feathers rather than just the shape.

    blender -b --python asset-pipeline/horses/preview_lit.py -- in.glb out_prefix [views] [--samples N]

Views: side, front3q, back3q, top, below, front, head, rider (a three-quarter
view from above the saddle). Each is framed on the whole model.
"""
import math
import sys

import bpy
import mathutils

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
views = (argv[2] if len(argv) > 2 and not argv[2].startswith("--") else "front3q,side,top").split(",")
samples = int(argv[argv.index("--samples") + 1]) if "--samples" in argv else 24
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
bpy.context.view_layer.update()
objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
mn = mathutils.Vector((1e9,) * 3)
mx = -mn
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(c)
        mn = mathutils.Vector(map(min, mn, w))
        mx = mathutils.Vector(map(max, mx, w))
ctr = (mn + mx) / 2
size = max(mx - mn)
scn = bpy.context.scene
scn.render.engine = "CYCLES"
scn.cycles.device = "CPU"
scn.cycles.samples = samples
scn.cycles.use_denoising = True
scn.render.resolution_x = 1100
scn.render.resolution_y = 760
# a pale sky and a warm low sun
world = bpy.data.worlds.new("w")
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.62, 0.74, 0.9, 1)
bg.inputs[1].default_value = 0.9
scn.world = world
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 4.2
sun.data.angle = 0.05
sun.rotation_euler = (math.radians(50), 0, math.radians(35))
scn.collection.objects.link(sun)
# ground
bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
ground = bpy.context.active_object
gm = bpy.data.materials.new("ground")
gm.use_nodes = True
gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.24, 0.3, 0.16, 1)
ground.data.materials.append(gm)
# glTF alpha cards: make sure the feather alpha reaches the BSDF
for o in objs:
    for slot in o.material_slots:
        m = slot.material
        if not m or not m.use_nodes:
            continue
        nt = m.node_tree
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        tex = next((n for n in nt.nodes if n.type == "TEX_IMAGE"), None)
        if bsdf and tex and m.name.startswith("Feathers") and not bsdf.inputs["Alpha"].is_linked:
            nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
        if bsdf and m.name.startswith("HorseCoat"):
            bsdf.inputs["Base Color"].default_value = (0.82, 0.8, 0.77, 1)
            bsdf.inputs["Roughness"].default_value = 0.5
        if bsdf and m.name.startswith("HorseHair"):
            bsdf.inputs["Base Color"].default_value = (0.86, 0.85, 0.83, 1)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scn.collection.objects.link(cam)
scn.camera = cam
cam.data.lens = 50
dirs = {"side": (1, 0, 0.08), "front3q": (0.75, -0.75, 0.35), "back3q": (-0.6, 0.75, 0.4), "front": (0, -1, 0.1),
        "top": (0.001, 0.15, 1), "below": (0.3, -0.2, -0.45), "head": (0.8, -0.6, 0.15), "rider": (0.5, 0.6, 0.75),
        "wing": (0.35, 0.55, 0.75)}
for name in views:
    d = mathutils.Vector(dirs[name]).normalized()
    c = ctr.copy()
    dist = size * 1.95
    if name == "head":
        c = mathutils.Vector((0, mn.y + (mx.y - mn.y) * 0.3, mx.z - (mx.z - mn.z) * 0.15))
        dist = size * 0.5
    if name == "wing":
        c = mathutils.Vector((mx.x * 0.45, ctr.y, mx.z - (mx.z - mn.z) * 0.25))
        dist = size * 0.42
    if name == "rider":
        c = mathutils.Vector((ctr.x, ctr.y, mn.z + (mx.z - mn.z) * 0.75))
        dist = size * 0.8
    cam.location = c + d * dist
    cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
    scn.render.filepath = f"{out}_{name}.jpg"
    scn.render.image_settings.file_format = "JPEG"
    bpy.ops.render.render(write_still=True)
    print("[preview]", scn.render.filepath)
