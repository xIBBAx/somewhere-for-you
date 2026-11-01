"""Author the open-front miniature studio used by the live R3F scene.

blender --background --python asset-pipeline/blender/build_studio.py
All geometry is original; coordinates are game X, height, Z.
"""
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector

OUT = Path(__file__).resolve().parents[2] / 'public/assets/environment/little-studio.glb'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)


def xyz(p):
    return (p[0], -p[2], p[1])


def material(name, color, roughness=.85, metal=0):
    rgb = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*linear, 1)
    m.use_nodes = True
    s = m.node_tree.nodes.get('Principled BSDF')
    s.inputs['Base Color'].default_value = (*linear, 1)
    s.inputs['Roughness'].default_value = roughness
    s.inputs['Metallic'].default_value = metal
    return m


M = {
    'plaster': material('Studio_Plaster', '#e8dac7'),
    'wood': material('Studio_Oak', '#b69974'),
    'dark': material('Studio_Walnut', '#70553e'),
    'roof': material('Studio_Slate', '#746f85'),
    'sage': material('Studio_Sage', '#8ba399'),
    'rose': material('Studio_Rose', '#b7847f'),
    'gold': material('Studio_Brass', '#bba06b', .35, .55),
    'paper': material('Studio_Paper', '#f8efdb'),
    'ink': material('Studio_Ink', '#454854'),
    'blue': material('Studio_Blue', '#78939d'),
    'leaf': material('Studio_Leaf', '#688567'),
    'lamp': material('Studio_LampGlow', '#ffedc6', .5),
}
lamp = M['lamp'].node_tree.nodes.get('Principled BSDF')
lamp.inputs['Emission Color'].default_value = (1, .61, .28, 1)
lamp.inputs['Emission Strength'].default_value = .45


def finish(obj, name, mat, bevel=.02, smooth=False):
    obj.name = name
    obj.data.materials.append(M[mat])
    if bevel:
        mod = obj.modifiers.new('Rounded edges', 'BEVEL')
        mod.width, mod.segments = bevel, 2
        bpy.ops.object.modifier_apply(modifier=mod.name)
        mod = obj.modifiers.new('Face normals', 'WEIGHTED_NORMAL')
        mod.keep_sharp = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
    return obj


def box(name, pos, size, mat, bevel=.02):
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(pos))
    obj = bpy.context.object
    obj.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, mat, bevel)


def rod(name, a, b, radius, mat):
    va, vb = Vector(xyz(a)), Vector(xyz(b))
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=radius, depth=(vb - va).length, location=(va + vb) / 2)
    obj = bpy.context.object
    obj.rotation_euler = (vb - va).to_track_quat('Z', 'Y').to_euler()
    return finish(obj, name, mat, .006, True)


def ellipsoid(name, pos, scale, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, location=xyz(pos))
    obj = bpy.context.object
    obj.scale = (scale[0], scale[2], scale[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, mat, 0, True)


# An open-front dollhouse section: the desk and cat remain visible from the
# actual elevated gameplay camera. Roof covers only the back of the workshop.
box('Bevelled plinth', (0, .12, 0), (3.56, .24, 3.15), 'dark', .055)
for i in range(12):
    box('Floorboard', (-1.57 + i * .286, .255, 0), (.274, .045, 2.95), 'wood', .008)
box('Back wall', (0, 1.22, -1.41), (3.4, 1.92, .17), 'plaster', .045)
for side in (-1, 1):
    box('Low side wall', (side * 1.62, .62, 0), (.16, .73, 2.87), 'plaster', .03)
    box('Side sill', (side * 1.62, 1.005, 0), (.24, .075, 2.94), 'wood')
    for z in (-1.40, 1.40):
        box('Frame post', (side * 1.62, 1.27, z), (.10, 2.08, .10), 'sage', .012)
    box('Top rail', (side * 1.62, 2.30, 0), (.13, .11, 2.94), 'sage', .015)
    # Two roof slopes run to a centre ridge; front rafters stay open.
    roof = box('Rear slate roof', (side * .86, 2.55, -1.0), (1.91, .11, 1.23), 'roof', .025)
    roof.rotation_euler.y = side * math.atan2(.65, 1.72)
    for i in range(7):
        z = -1.55 + i * .18
        rod('Standing seam', (0, 2.90, z), (side * 1.78, 2.23, z), .014, 'roof')
    rod('Open gable rafter', (0, 2.89, 1.42), (side * 1.69, 2.25, 1.42), .055, 'sage')
rod('Ridge beam', (0, 2.87, -1.55), (0, 2.87, 1.47), .05, 'sage')

# Desk with chamfered top, drawer bank, monitor and deliberately readable tools.
box('Desk top', (.16, .91, .37), (2.33, .11, .91), 'wood', .045)
for x in (-.88, 1.15):
    box('Desk trestle', (x, .57, .38), (.12, .65, .68), 'dark', .018)
box('Drawer bank', (1.02, .64, .36), (.40, .51, .71), 'sage', .028)
for y in (.48, .67, .84):
    box('Drawer face', (1.02, y, .733), (.35, .13, .025), 'sage', .013)
    rod('Drawer handle', (.96, y, .76), (1.08, y, .76), .012, 'gold')
box('Monitor base', (.06, .988, .19), (.46, .035, .28), 'ink', .024)
rod('Monitor neck', (.06, 1.0, .14), (.06, 1.27, .14), .035, 'ink')
box('Monitor bezel', (.06, 1.41, .15), (.91, .61, .072), 'ink', .04)
box('Keyboard', (.09, .99, .59), (.68, .035, .20), 'paper', .02)
for row in range(3):
    for col in range(10):
        box('Key', (-.205 + col * .064, 1.012, .526 + row * .057), (.046, .012, .037), 'ink', .003)
box('Sketchbook cover', (.72, .991, .57), (.35, .055, .42), 'rose', .015)
box('Sketchbook pages', (.72, 1.025, .56), (.31, .015, .39), 'paper', .006)
rod('Stylus', (.49, 1.055, .50), (.56, 1.055, .78), .012, 'ink')
rod('Stylus nib', (.56, 1.055, .78), (.569, 1.055, .814), .006, 'gold')

# Articulated task lamp; ceramic mug and a few finished sheets tell the story.
box('Task lamp foot', (-.75, .992, .19), (.24, .035, .24), 'sage', .045)
rod('Lamp lower arm', (-.75, 1.02, .19), (-.90, 1.40, .19), .024, 'gold')
rod('Lamp upper arm', (-.90, 1.40, .19), (-.66, 1.58, .28), .024, 'gold')
for p in [(-.75, 1.02, .19), (-.90, 1.40, .19), (-.66, 1.58, .28)]:
    ellipsoid('Lamp hinge', p, (.041, .041, .041), 'sage')
bpy.ops.mesh.primitive_cone_add(vertices=20, radius1=.14, radius2=.065, depth=.14, location=xyz((-.62, 1.54, .33)))
finish(bpy.context.object, 'Lamp shade', 'sage', .012, True)
ellipsoid('Lamp diffuser', (-.62, 1.47, .33), (.125, .025, .125), 'lamp')
rod('Ceramic mug', (-.69, 1.00, .65), (-.69, 1.17, .65), .074, 'rose')
rod('Tea surface', (-.69, 1.166, .65), (-.69, 1.174, .65), .062, 'dark')
for i in range(9):
    a, b = i / 9 * math.pi, (i + 1) / 9 * math.pi
    rod('Mug handle', (-.76 - math.sin(a) * .058, 1.024 + i / 9 * .118, .65),
        (-.76 - math.sin(b) * .058, 1.024 + (i + 1) / 9 * .118, .65), .013, 'rose')

# Pinboard, completed layouts and a modest textile swatch rack.
box('Pinboard frame', (-.40, 1.58, -1.295), (1.56, .86, .055), 'dark', .02)
box('Pinboard linen', (-.40, 1.58, -1.257), (1.47, .77, .025), 'wood', .008)
for i, mat in enumerate(('paper', 'blue', 'rose', 'sage')):
    x, y = -.92 + i * .34, 1.62 - (i % 2) * .15
    box('Pinned layout', (x, y, -1.226), (.26, .33, .015), mat, .006)
    ellipsoid('Brass pin', (x, y + .125, -1.21), (.014, .014, .009), 'gold')
    for line in range(3):
        box('Layout rule', (x, y + .065 - line * .062, -1.215), (.18, .010, .007), 'ink', .002)
box('Bookshelf', (1.02, 1.35, -1.17), (.73, .07, .38), 'wood', .016)
for i, mat in enumerate(('blue', 'rose', 'paper', 'sage')):
    box('Design book', (.78 + i * .145, 1.55, -1.18), (.112, .32 + (i % 2) * .045, .24), mat, .014)
rod('Swatch rail', (-1.45, 1.70, -.75), (-1.45, 1.70, .15), .018, 'gold')
for i, mat in enumerate(('paper', 'rose', 'blue', 'sage')):
    box('Draped fabric swatch', (-1.45, 1.46, -.67 + i * .23), (.025, .43, .18), mat, .009)

# Leafy plant with distinct leaves, instead of a single faceted ball.
bpy.ops.mesh.primitive_cone_add(vertices=16, radius1=.15, radius2=.21, depth=.32, location=xyz((1.32, .43, -.91)))
finish(bpy.context.object, 'Ceramic plant pot', 'rose', .02, True)
rod('Plant stem', (1.32, .55, -.91), (1.32, 1.30, -.91), .012, 'dark')
for i in range(7):
    a, y = i * 2.4, .67 + i * .087
    leaf = ellipsoid('Plant leaf', (1.32 + math.cos(a) * .13, y, -.91 + math.sin(a) * .13), (.17, .025, .075), 'leaf')
    leaf.rotation_euler.z = -a
    leaf.rotation_euler.y = .28

# Material batches keep the authored details cheap to draw.
for mat in M.values():
    parts = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.data.materials and o.data.materials[0] == mat]
    if not parts:
        continue
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    if len(parts) > 1:
        bpy.ops.object.join()
    bpy.context.object.name = mat.name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

OUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(OUT), export_format='GLB', export_yup=True,
                          export_animations=False, export_cameras=False, export_lights=False)
print(json.dumps({'asset': str(OUT), 'bytes': OUT.stat().st_size,
                  'meshes': len(bpy.context.scene.objects),
                  'triangles': sum(len(o.data.loop_triangles) for o in bpy.context.scene.objects if o.type == 'MESH')}))
