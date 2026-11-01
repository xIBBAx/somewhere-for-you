"""Build the game's café in Blender; export a compact, material-batched GLB.

Run from the repository: blender --background --python asset-pipeline/blender/build_cafe.py
Coordinates below use the game's X / height / Z convention. No external assets.
"""
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/assets/environment/corner-cafe.glb'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)


def point(x, y, z):
    return (x, -z, y)


def material(name, color, roughness=.8, metal=0):
    values = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in values]
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*linear, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*linear, 1)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metal
    return mat


M = {
    'plaster': material('Cafe_Limewash', '#efdfc6', .94),
    'stone': material('Cafe_Sandstone', '#b7a58a', .94),
    'wood': material('Cafe_Walnut', '#674b38', .8),
    'oak': material('Cafe_HoneyOak', '#b48a5d', .8),
    'roof': material('Cafe_Terracotta', '#9d6150', .88),
    'tile': material('Cafe_TileVariation', '#bd8066', .88),
    'sage': material('Cafe_Sage', '#799485', .82),
    'cloth': material('Cafe_WovenRose', '#ad7880', .93),
    'cream': material('Cafe_Canvas', '#f2e8d5', .94),
    'brass': material('Cafe_AgedBrass', '#bd975b', .33, .65),
    'glass': material('Cafe_WindowGlow', '#526c6b', .32),
    'bulb': material('Cafe_BulbGlow', '#fff0d0', .4),
    'pastry': material('Cafe_BakedPastry', '#d7a162', .85),
    'coffee': material('Cafe_Coffee', '#402b22', .28),
    'leaf': material('Cafe_Leaves', '#5f8058', .9),
}
for key in ('glass', 'bulb'):
    bsdf = M[key].node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Emission Color'].default_value = (1, .52, .19, 1)
    bsdf.inputs['Emission Strength'].default_value = .05


def finish(obj, name, mat, bevel=0, smooth=False):
    obj.name = name
    obj.data.materials.append(M[mat])
    if bevel:
        mod = obj.modifiers.new('Soft crafted edges', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
        normal = obj.modifiers.new('Weighted surface normals', 'WEIGHTED_NORMAL')
        normal.keep_sharp = True
        bpy.ops.object.modifier_apply(modifier=normal.name)
    if smooth:
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    return obj


def box(name, pos, size, mat, bevel=.025):
    bpy.ops.mesh.primitive_cube_add(size=1, location=point(*pos))
    obj = bpy.context.object
    obj.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, mat, bevel)


def mesh(name, vertices, faces, mat, bevel=0, recalculate=True):
    geo = bpy.data.meshes.new(name)
    geo.from_pydata([point(*v) for v in vertices], [], faces)
    geo.update()
    obj = bpy.data.objects.new(name, geo)
    bpy.context.collection.objects.link(obj)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    if recalculate:
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.object.mode_set(mode='OBJECT')
    return finish(obj, name, mat, bevel)


def tube(name, points, radius, mat, segments=6):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.resolution_u = 1
    curve.bevel_depth = radius
    curve.bevel_resolution = 1
    curve.resolution_u = segments
    spline = curve.splines.new('POLY')
    spline.points.add(len(points) - 1)
    for p, v in zip(spline.points, points):
        p.co = (*point(*v), 1)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(M[mat])
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH')
    return bpy.context.object


def sphere(name, pos, scale, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, location=point(*pos))
    obj = bpy.context.object
    obj.scale = (scale[0], scale[2], scale[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, mat, smooth=True)


def lathe(name, pos, profile, mat, segments=24):
    vertices = []
    for radius, y in profile:
        for i in range(segments):
            a = i * math.tau / segments
            vertices.append((pos[0] + math.cos(a) * radius, pos[1] + y, pos[2] + math.sin(a) * radius))
    faces = []
    for row in range(len(profile) - 1):
        for i in range(segments):
            n = (i + 1) % segments
            a, b = row * segments, (row + 1) * segments
            faces.append((a + i, a + n, b + n, b + i))
    obj = mesh(name, vertices, faces, mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


# A shell with actual window recesses and a separate doorway, sized to the
# existing building collider. The step remains inside that footprint.
box('Foundation', (0, .13, 0), (7.35, .26, 3.54), 'stone', .055)
box('Back wall', (0, 1.55, -1.58), (7.2, 2.65, .24), 'plaster', .04)
for x in (-3.48, 3.48):
    box('Side wall', (x, 1.55, 0), (.24, 2.65, 3.4), 'plaster', .045)
    # Cream triangular end-gables beneath the pitched roof.
    mesh('Gable', [(x, 2.84, -1.7), (x, 2.84, 1.7), (x, 3.8, 0)], [(0, 1, 2)], 'plaster')
box('Front upper wall', (0, 2.51, 1.57), (7.05, .72, .26), 'plaster', .035)
box('Front sill wall', (-.77, .47, 1.57), (5.55, .54, .26), 'plaster', .035)
for x, w in [(-3.32, .5), (-.94, .68), (1.34, .56), (3.24, .55)]:
    box('Front pier', (x, 1.49, 1.57), (w, 1.55, .26), 'plaster')
for x in (-3.56, 3.56):
    box('Corner oak post', (x, 1.5, 1.73), (.10, 2.6, .10), 'oak', .018)
box('Skirting', (0, .27, 1.74), (7.24, .14, .14), 'stone', .02)

# Recessed shop windows: dark depth, sill, mullions, little shelves and pastries.
for wx in (-2.18, .20):
    box('Window pane', (wx, 1.43, 1.535), (1.72, 1.42, .055), 'glass', .025)
    for dx in (-.9, .9):
        box('Window frame', (wx + dx, 1.43, 1.735), (.11, 1.6, .22), 'wood', .017)
    for yy in (.67, 2.19):
        box('Window lintel', (wx, yy, 1.735), (1.9, .10, .23), 'wood', .017)
    box('Window sill', (wx, .64, 1.84), (1.99, .10, .38), 'oak', .025)
    box('Window mullion', (wx, 1.43, 1.67), (.055, 1.42, .09), 'oak', .012)
    box('Window transom', (wx, 1.77, 1.67), (1.72, .055, .09), 'oak', .012)
    box('Display shelf', (wx, .88, 1.72), (1.62, .055, .28), 'oak', .015)
    for j in range(3):
        sphere('Pastry', (wx - .48 + j * .43, .98, 1.76), (.16, .08 + (j % 2) * .035, .1), 'pastry')
        tube('Pastry score', [(wx - .54 + j * .43, 1.045, 1.77), (wx - .43 + j * .43, 1.045, 1.78)], .009, 'cream')
    # Narrow shutter boards sit outside the frame without masking the glazing.
    for sx in (-1, 1):
        box('Shutter', (wx + sx * 1.05, 1.40, 1.78), (.18, 1.44, .08), 'sage', .012)

# An arched, inset sage door with a glass fanlight and a brass handle.
door_x = 2.40
box('Door', (door_x, 1.20, 1.66), (1.05, 1.98, .12), 'sage', .035)
for yy in (.55, 1.03):
    box('Raised door panel', (door_x, yy, 1.745), (.77, .34, .035), 'sage', .022)
box('Door glazing', (door_x, 1.71, 1.745), (.69, .55, .035), 'glass', .035)
arch = [(door_x - .60, .25, 1.77), (door_x - .60, 1.96, 1.77)]
arch += [(door_x + math.cos(a) * .60, 1.96 + math.sin(a) * .38, 1.77)
         for a in [math.pi - i * math.pi / 16 for i in range(17)]]
arch += [(door_x + .60, .25, 1.77)]
tube('Arched door casing', arch, .055, 'wood')
tube('Brass door pull', [(door_x + .35, 1.04, 1.86), (door_x + .35, 1.28, 1.86)], .025, 'brass')

# A curved fabric awning with scalloped valance, all geometry rather than glow.
for stripe in range(13):
    x0 = -3.47 + stripe * 6.94 / 13
    x1 = x0 + 6.94 / 13
    verts = []
    for row in range(9):
        t = row / 8
        z = 1.76 + t * 1.03
        y = 2.61 - .50 * t * t
        verts.extend([(x0, y, z), (x1, y, z)])
    faces = [(i * 2, i * 2 + 1, i * 2 + 3, i * 2 + 2) for i in range(8)]
    cloth = 'cloth' if stripe % 2 == 0 else 'cream'
    awning = mesh('Curved awning', verts, faces, cloth)
    for polygon in awning.data.polygons:
        polygon.use_smooth = True
    solid = awning.modifiers.new('Woven fabric thickness', 'SOLIDIFY')
    solid.thickness = .015
    bpy.ops.object.modifier_apply(modifier=solid.name)
    verts = [(x0, 2.11, 2.79), (x1, 2.11, 2.79)]
    for i in range(9):
        t = i / 8
        verts.append((x1 - (x1 - x0) * t, 1.99 - math.sin(t * math.pi) * .11, 2.79))
    mesh('Scalloped valance', verts, [tuple(range(len(verts)))], cloth)
tube('Awning front piping', [(-3.49, 2.115, 2.79), (3.49, 2.115, 2.79)], .017, 'cream')
for x in (-3.38, 3.38):
    tube('Awning bracket', [(x, 1.96, 1.78), (x, 2.07, 2.75), (x, 2.54, 1.78)], .022, 'brass')

# Pitched terracotta roof, overlapping rounded tiles and a finished ridge.
for side in (-1, 1):
    vertices = [(-3.85, 3.91, 0), (3.85, 3.91, 0), (3.85, 2.87, side * 2.03), (-3.85, 2.87, side * 2.03)]
    # Explicit thickness below the surface. Recalculating normals on a single
    # open face can invert Solidify and push the substrate through the tiles.
    vertices += [(x, y - .10, z) for x, y, z in vertices]
    mesh('Roof base', vertices,
         [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1),
          (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], 'wood')
    for row in range(5):
        for col in range(17):
            x0 = -3.82 + col * .45
            z0 = row * .4
            verts = []
            for r in range(2):
                z = min(2.08, z0 + r * .46)
                for c in range(5):
                    u = c / 4
                    lift = math.sin(u * math.pi) * .045
                    verts.append((x0 + u * .44, 3.96 - z * .51 + lift + .014 * (4 - row), side * z))
            faces = [(c + 5, c + 6, c + 1, c) if side == 1 else (c, c + 1, c + 6, c + 5) for c in range(4)]
            mesh('Roof tile', verts, faces, 'tile' if (col + row * 3) % 7 == 0 else 'roof', recalculate=False)
    tube('Eave fascia', [(-3.87, 2.88, side * 2.04), (3.87, 2.88, side * 2.04)], .06, 'wood')
tube('Ridge cap', [(-3.89, 3.99, 0), (3.89, 3.99, 0)], .09, 'roof')
for x in (-3.83, 3.83):
    tube('Gable edge', [(x, 2.87, -2.03), (x, 3.95, 0), (x, 2.87, 2.03)], .065, 'wood')

# The café's cup motif is a hollow, glazed ceramic vessel with a real handle.
lathe('Roof cup', (0, 4.01, 0), [(0, 0), (.21, 0), (.24, .05), (.29, .39), (.28, .43), (.24, .43), (.22, .08), (0, .08)], 'cream')
tube('Cup handle', [(.25 + math.sin(i / 16 * math.pi) * .18, 4.08 + i / 16 * .30, 0) for i in range(17)], .04, 'cream')
lathe('Roof coffee', (0, 4.36, 0), [(0, 0), (.245, 0)], 'coffee')
for x in (-.12, .12):
    mesh('Cup cat ear', [(x - .065, 4.43, 0), (x, 4.59, 0), (x + .065, 4.43, 0), (x, 4.43, -.065)],
         [(0, 1, 2), (0, 3, 1), (1, 3, 2), (0, 2, 3)], 'cloth', .009)

# String and bulbs use local storefront coordinates, avoiding the old double
# world-position offset. Bulbs are grouped into one emissive draw call.
wire = []
for i in range(25):
    t = i / 24
    wire.append((-3.30 + t * 6.60, 2.81 - math.sin(t * math.pi) * .15, 1.93))
tube('Fairy light cord', wire, .009, 'wood')
for i in range(11):
    t = i / 10
    x, y = -3.30 + t * 6.60, 2.81 - math.sin(t * math.pi) * .15
    tube('Bulb stem', [(x, y, 1.93), (x, y - .08, 1.93)], .013, 'brass')
    sphere('Fairy bulb', (x, y - .12, 1.93), (.045, .06, .045), 'bulb')

# Static parts sharing a material are merged so authored detail does not turn
# into hundreds of runtime objects or draw calls.
for mat in M.values():
    objects = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.data.materials and o.data.materials[0] == mat]
    if not objects:
        continue
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects) > 1:
        bpy.ops.object.join()
    bpy.context.object.name = mat.name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

OUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(OUT), export_format='GLB', export_yup=True,
                          export_animations=False, export_cameras=False, export_lights=False)
triangles = sum(len(o.data.loop_triangles) for o in bpy.context.scene.objects if o.type == 'MESH')
print(json.dumps({'asset': str(OUT), 'bytes': OUT.stat().st_size, 'meshes': len(bpy.context.scene.objects), 'triangles': triangles}))
