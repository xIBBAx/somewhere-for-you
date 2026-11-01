"""Quick shape previews (Workbench) of a PLY (three.js axes) or GLB.

    blender -b --python asset-pipeline/horses/preview.py -- in.ply|in.glb out_prefix [views]
"""
import math
import sys

import bpy
import mathutils

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
views = (argv[2] if len(argv) > 2 else "side,front3q,back3q,front,head").split(",")
bpy.ops.wm.read_factory_settings(use_empty=True)
if src.endswith(".ply"):
    bpy.ops.wm.ply_import(filepath=src)
    for o in bpy.context.selected_objects:
        o.rotation_euler[0] = math.pi / 2
else:
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
scn.render.engine = "BLENDER_WORKBENCH"
scn.display.shading.light = "STUDIO"
scn.display.shading.color_type = "SINGLE"
scn.display.shading.single_color = (0.55, 0.36, 0.22)
scn.display.shading.show_cavity = True
scn.display.shading.cavity_type = "BOTH"
scn.display.shading.show_shadows = True
scn.render.resolution_x = 1000
scn.render.resolution_y = 750
scn.render.film_transparent = False
w = bpy.data.worlds.new("w")
scn.world = w
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scn.collection.objects.link(cam)
scn.camera = cam
cam.data.type = "ORTHO"
for o in objs:
    for p in o.data.polygons:
        p.use_smooth = True
# horse faces -Y in Blender (three +Z)
dirs = {"side": (1, 0, 0.05), "front3q": (0.75, -0.75, 0.3), "back3q": (-0.6, 0.75, 0.3), "front": (0, -1, 0.08),
        "back": (0, 1, 0.1), "top": (0.001, 0, 1), "rside": (-1, 0, 0.05)}
for name in views:
    if name == "headside":
        c = mathutils.Vector((0, mn.y + (mx.y - mn.y) * 0.13, mx.z - (mx.z - mn.z) * 0.2))
        cam.location = c + mathutils.Vector((3, 0, 0))
        cam.data.ortho_scale = size * 0.38
    elif name == "head":
        hz = mx.z - (mx.z - mn.z) * 0.18
        hy = mn.y + (mx.y - mn.y) * 0.1
        c = mathutils.Vector((0, hy, hz))
        d = mathutils.Vector((0.8, -0.6, 0.15)).normalized()
        cam.location = c + d * 3
        cam.data.ortho_scale = size * 0.33
    else:
        d = mathutils.Vector(dirs[name]).normalized()
        cam.location = ctr + d * size * 3
        cam.data.ortho_scale = size * 1.08
        c = ctr
    cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
    scn.render.filepath = f"{out}_{name}.png"
    bpy.ops.render.render(write_still=True)
