"""
Cozy props for discoveries in the explorer's endless world.

    blender -b --factory-startup --python asset-pipeline/blender/build_props.py

Exports public/assets/props/props.glb. Every mesh is vertex coloured
(RGB = albedo) with its origin at the ground contact point (or hanging point
for lanterns/ribbons). Meshes whose names end in "_glow" are given an
emissive material at runtime (lamps, lanterns, star runes). "easel_canvas"
carries 0..1 UVs so the game can paint a fresh picture on it.
"""
import bpy
import bmesh
import math
import random
from mathutils import Vector, Matrix, noise

OUT = "public/assets/props/props.glb"


def hexcol(h, a=1.0):
    h = h.lstrip("#")
    return (int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255, a)


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def mesh_from_bm(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return link(bpy.data.objects.new(name, me))


def apply_mods(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, depsgraph=dg)
    name = obj.name
    old = obj.data
    bpy.data.objects.remove(obj, do_unlink=True)
    if old.users == 0:
        bpy.data.meshes.remove(old)
    me.name = name
    return link(bpy.data.objects.new(name, me))


def paint(obj, fn):
    me = obj.data
    for a in list(me.color_attributes):
        me.color_attributes.remove(a)
    attr = me.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="CORNER")
    for poly in me.polygons:
        c = poly.center
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index]
            attr.data[li].color = fn(v.co, poly.normal, c)
    me.color_attributes.active_color = attr
    return obj


def solid(obj, color):
    return paint(obj, lambda co, n, c: hexcol(color) if isinstance(color, str) else color)


def smooth(obj, on=True):
    for p in obj.data.polygons:
        p.use_smooth = on
    return obj


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    obj.data.name = name
    return obj


def box(size, loc=(0, 0, 0), bevel=0.01, color="#ffffff", name="box", rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    obj = mesh_from_bm(name, bm)
    if bevel > 0:
        m = obj.modifiers.new("bev", "BEVEL")
        m.width = bevel
        m.segments = 2
        m.limit_method = "ANGLE"
        obj = apply_mods(obj)
    obj.data.transform(Matrix.LocRotScale(Vector(loc), Matrix.Rotation(rot[2], 3, "Z") @ Matrix.Rotation(rot[1], 3, "Y") @ Matrix.Rotation(rot[0], 3, "X"), None).to_4x4() if False else Matrix.Identity(4))
    obj.data.transform(Matrix.Rotation(rot[0], 4, "X"))
    obj.data.transform(Matrix.Rotation(rot[1], 4, "Y"))
    obj.data.transform(Matrix.Rotation(rot[2], 4, "Z"))
    obj.data.transform(Matrix.Translation(loc))
    smooth(obj, False)
    return solid(obj, color)


def cyl(r1, r2, depth, loc=(0, 0, 0), segs=16, color="#ffffff", name="cyl", rot=(0, 0, 0), smooth_on=True, caps=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, segments=segs, radius1=r1, radius2=r2, depth=depth)
    obj = mesh_from_bm(name, bm)
    obj.data.transform(Matrix.Rotation(rot[0], 4, "X"))
    obj.data.transform(Matrix.Rotation(rot[1], 4, "Y"))
    obj.data.transform(Matrix.Rotation(rot[2], 4, "Z"))
    obj.data.transform(Matrix.Translation(loc))
    smooth(obj, smooth_on)
    return solid(obj, color)


def sphere(r, loc=(0, 0, 0), scale=(1, 1, 1), color="#ffffff", name="sph", segs=(16, 10)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs[0], v_segments=segs[1], radius=r)
    for v in bm.verts:
        v.co = Vector((v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2]))
    obj = mesh_from_bm(name, bm)
    obj.data.transform(Matrix.Translation(loc))
    smooth(obj)
    return solid(obj, color)


def tube(points, radius, color="#ffffff", name="tube", r_end=None):
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in points]
    for a, b in zip(vs, vs[1:]):
        bm.edges.new((a, b))
    obj = mesh_from_bm(name, bm)
    obj.modifiers.new("skin", "SKIN")
    data = obj.data.skin_vertices[0].data
    n = len(points)
    for i in range(n):
        r = radius if r_end is None else radius + (r_end - radius) * i / max(1, n - 1)
        data[i].radius = (r, r)
    obj.modifiers["skin"].use_smooth_shade = True
    sub = obj.modifiers.new("sub", "SUBSURF")
    sub.levels = 1
    obj = apply_mods(obj)
    smooth(obj)
    return solid(obj, color)


def torus(R, r, loc=(0, 0, 0), color="#ffffff", name="torus", segs=(24, 8)):
    bm = bmesh.new()
    verts = []
    for i in range(segs[0]):
        a = i / segs[0] * math.pi * 2
        ring = []
        for j in range(segs[1]):
            b = j / segs[1] * math.pi * 2
            ring.append(bm.verts.new(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b))))
        verts.append(ring)
    for i in range(segs[0]):
        for j in range(segs[1]):
            a, b = verts[i][j], verts[(i + 1) % segs[0]][j]
            c, d = verts[(i + 1) % segs[0]][(j + 1) % segs[1]], verts[i][(j + 1) % segs[1]]
            bm.faces.new((a, b, c, d))
    obj = mesh_from_bm(name, bm)
    obj.data.transform(Matrix.Translation(loc))
    smooth(obj)
    return solid(obj, color)


WOOD = "#9b6b47"
WOOD_DARK = "#5b4033"
CREAM = "#f5ecdc"
PINK = "#f2a7bd"
MINT = "#a9dcc7"
LILAC = "#c3a8e0"
GOLD = "#e3b65a"


def wood_grain(base):
    b = hexcol(base)

    def f(co, n, c):
        g = 0.88 + noise.noise(Vector((co.x * 2, co.y * 2, co.z * 18))) * 0.12
        return (b[0] * g, b[1] * g, b[2] * g, 1)

    return f


# ---------------------------------------------------------------------------
# props
# ---------------------------------------------------------------------------

def bench():
    parts = []
    for i in range(3):
        parts.append(box((1.5, 0.12, 0.04), (0, -0.14 + i * 0.14, 0.45), 0.012, WOOD))
    for i in range(2):
        parts.append(box((1.5, 0.11, 0.035), (0, 0.22, 0.62 + i * 0.16), 0.012, WOOD, rot=(0.18, 0, 0)))
    for sx in (-0.62, 0.62):
        parts.append(box((0.06, 0.48, 0.06), (sx, 0, 0.42), 0.01, WOOD_DARK))
        parts.append(box((0.06, 0.06, 0.44), (sx, -0.2, 0.22), 0.01, WOOD_DARK))
        parts.append(box((0.06, 0.06, 0.86), (sx, 0.21, 0.43), 0.01, WOOD_DARK, rot=(0.12, 0, 0)))
        parts.append(box((0.07, 0.42, 0.04), (sx, -0.02, 0.66), 0.012, WOOD))
    obj = join(parts, "bench")
    return paint(obj, wood_grain(WOOD)) if False else obj


def lantern_post():
    parts = [
        cyl(0.05, 0.04, 1.7, (0, 0, 0.85), 10, WOOD_DARK),
        cyl(0.14, 0.14, 0.04, (0, 0, 0.02), 12, "#6b5a4c"),
        box((0.22, 0.22, 0.03), (0, 0, 1.72), 0.01, WOOD_DARK),
        cyl(0.17, 0.02, 0.14, (0, 0, 2.0), 4, WOOD_DARK, rot=(0, 0, math.pi / 4), smooth_on=False),
    ]
    for sx, sy in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        parts.append(box((0.02, 0.02, 0.2), (sx * 0.09, sy * 0.09, 1.83), 0, WOOD_DARK))
    post = join(parts, "lantern_post")
    glass = box((0.16, 0.16, 0.18), (0, 0, 1.83), 0.02, "#ffd894", name="lantern_post_glow")
    return [post, glass]


def picnic():
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=22, y_segments=16, size=1.0)
    for v in bm.verts:
        v.co.x *= 1.15
        v.co.y *= 0.82
        v.co.z = 0.012 + noise.noise(Vector((v.co.x * 2.2, v.co.y * 2.2, 0.5))) * 0.012
    blanket = mesh_from_bm("blanket", bm)
    smooth(blanket)

    def check(co, n, c):
        a = int(math.floor((c.x + 2) / 0.23)) % 2
        b = int(math.floor((c.y + 2) / 0.23)) % 2
        if a and b:
            return hexcol("#e98ba4")
        if a or b:
            return hexcol("#f6c9d4")
        return hexcol("#fff7f0")

    paint(blanket, check)
    basket = join([
        box((0.42, 0.3, 0.22), (0.62, 0.32, 0.13), 0.04, "#c49058"),
        box((0.44, 0.32, 0.03), (0.62, 0.32, 0.25), 0.015, "#a87543"),
        tube([Vector((0.44, 0.32, 0.26)), Vector((0.5, 0.32, 0.42)), Vector((0.62, 0.32, 0.47)), Vector((0.74, 0.32, 0.42)), Vector((0.8, 0.32, 0.26))], 0.012, "#a87543"),
    ], "basket")
    paint(basket, lambda co, n, c: (lambda g: (0.77 * g, 0.56 * g, 0.34 * g, 1))(0.85 + 0.15 * ((math.floor(co.z * 40) + math.floor((co.x + co.y) * 40)) % 2)))
    cushions = [
        sphere(0.26, (-0.55, -0.25, 0.07), (1, 1, 0.28), PINK, "c1"),
        sphere(0.26, (-0.05, -0.38, 0.07), (1, 1, 0.28), LILAC, "c2"),
    ]
    plate = cyl(0.13, 0.11, 0.02, (0.1, 0.2, 0.03), 20, CREAM)
    cake = join([cyl(0.075, 0.075, 0.08, (0.1, 0.2, 0.08), 20, "#f7d9c4"), cyl(0.077, 0.077, 0.02, (0.1, 0.2, 0.13), 20, "#f5b8c8"), sphere(0.018, (0.1, 0.2, 0.15), (1, 1, 1), "#d83a4b")], "cake")
    cups = [cyl(0.035, 0.03, 0.07, (0.32 + i * 0.1, 0.05, 0.05), 12, "#ffffff") for i in range(2)]
    return [join([blanket, basket] + cushions + [plate, cake] + cups, "picnic")]


def kiosk():
    parts = []
    # counter
    parts.append(box((1.7, 0.7, 0.95), (0, 0, 0.5), 0.03, MINT))
    parts.append(box((1.8, 0.8, 0.06), (0, 0, 1.0), 0.02, WOOD))
    for i in range(7):
        parts.append(box((0.03, 0.72, 0.85), (-0.75 + i * 0.25, 0.0, 0.48), 0.0, "#8fcab3"))
    # posts + awning
    for sx in (-0.82, 0.82):
        parts.append(cyl(0.035, 0.035, 2.2, (sx, 0.35, 1.1), 8, CREAM))
    bm = bmesh.new()
    stripes = 9
    for i in range(stripes):
        x0 = -1.0 + i * 2.0 / stripes
        x1 = x0 + 2.0 / stripes
        vs = [bm.verts.new(v) for v in [(x0, -0.6, 2.0), (x1, -0.6, 2.0), (x1, 0.55, 2.35), (x0, 0.55, 2.35)]]
        bm.faces.new(vs)
        # scalloped valance
        vs2 = [bm.verts.new(v) for v in [(x0, -0.6, 2.0), (x1, -0.6, 2.0), ((x0 + x1) / 2, -0.62, 1.86)]]
        bm.faces.new(vs2)
    awning = mesh_from_bm("awning", bm)
    sol = awning.modifiers.new("s", "SOLIDIFY")
    sol.thickness = 0.02
    awning = apply_mods(awning)
    paint(awning, lambda co, n, c: hexcol(PINK) if int(math.floor((c.x + 1.0) / (2.0 / stripes))) % 2 == 0 else hexcol("#fff6f2"))
    parts.append(awning)
    # sign
    parts.append(box((0.9, 0.05, 0.28), (0, 0.4, 2.55), 0.02, CREAM))
    parts.append(sphere(0.06, (-0.3, 0.37, 2.55), (1, 0.4, 1), "#d97a8d"))
    # espresso machine + cups
    parts.append(box((0.32, 0.26, 0.3), (-0.45, 0.12, 1.18), 0.03, "#c9c5c0"))
    parts.append(cyl(0.035, 0.03, 0.08, (-0.45, -0.05, 1.07), 10, "#3b2a24"))
    for i in range(3):
        parts.append(cyl(0.04, 0.034, 0.09, (0.15 + i * 0.16, -0.12, 1.08), 12, "#ffffff"))
    # jar of cookies
    parts.append(cyl(0.09, 0.09, 0.18, (0.6, 0.1, 1.12), 14, "#e8f3f2"))
    for i in range(4):
        parts.append(cyl(0.05, 0.05, 0.015, (0.6, 0.1, 1.06 + i * 0.03), 12, "#c88a52"))
    stools = []
    for sx in (-0.5, 0.5):
        stools.append(cyl(0.18, 0.18, 0.06, (sx, -0.85, 0.62), 16, PINK))
        stools.append(cyl(0.025, 0.025, 0.6, (sx, -0.85, 0.3), 8, WOOD_DARK))
        stools.append(cyl(0.16, 0.16, 0.02, (sx, -0.85, 0.01), 14, WOOD_DARK))
    return [join(parts + stools, "kiosk")]


def easel():
    legs = [
        tube([Vector((-0.32, 0.12, 0)), Vector((0, 0.02, 1.55))], 0.022, WOOD),
        tube([Vector((0.32, 0.12, 0)), Vector((0, 0.02, 1.55))], 0.022, WOOD),
        tube([Vector((0, 0.5, 0)), Vector((0, 0.05, 1.45))], 0.02, WOOD),
        box((0.7, 0.06, 0.04), (0, 0.0, 0.62), 0.01, WOOD),
    ]
    frame = box((0.66, 0.035, 0.52), (0, -0.02, 0.95), 0.01, "#f3eadb")
    stool = join([cyl(0.17, 0.17, 0.05, (0.62, -0.25, 0.52), 14, WOOD), cyl(0.02, 0.02, 0.5, (0.62, -0.25, 0.25), 6, WOOD_DARK)], "stool")
    palette = sphere(0.14, (0.62, -0.25, 0.56), (1.2, 0.85, 0.08), "#e6c49d")
    dabs = [sphere(0.025, (0.62 + math.cos(a) * 0.09, -0.25 + math.sin(a) * 0.06, 0.575), (1, 1, 0.4), c) for a, c in zip([0.3, 1.4, 2.5, 3.6, 4.7], ["#e65a6f", "#f4c14b", "#5aa8e6", "#7cc576", "#b38ae0"])]
    body = join(legs + [frame, stool, palette] + dabs, "easel")
    # canvas with UVs (painted procedurally at runtime)
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
    uv = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for loop in f.loops:
            loop[uv].uv = (loop.vert.co.x + 0.5, loop.vert.co.y + 0.5)
    canvas = mesh_from_bm("easel_canvas", bm)
    canvas.data.transform(Matrix.Diagonal((0.6 * 2 / 2, 0.46 * 2 / 2, 1, 1)))
    canvas.data.transform(Matrix.Rotation(math.pi / 2, 4, "X"))
    canvas.data.transform(Matrix.Translation((0, -0.04, 0.95)))
    solid(canvas, "#ffffff")
    return [body, canvas]


def umbrella():
    bm = bmesh.new()
    n = 16
    apex = bm.verts.new((0, 0, 2.05))
    ring = []
    for i in range(n):
        a = i / n * math.pi * 2
        ring.append(bm.verts.new((math.cos(a) * 1.05, math.sin(a) * 1.05, 1.68)))
    mids = []
    for i in range(n):
        a = (i + 0.5) / n * math.pi * 2
        mids.append(bm.verts.new((math.cos(a) * 1.0, math.sin(a) * 1.0, 1.74)))
    for i in range(n):
        bm.faces.new((apex, ring[i], mids[i]))
        bm.faces.new((apex, mids[i], ring[(i + 1) % n]))
    can = mesh_from_bm("canopy", bm)
    sol = can.modifiers.new("s", "SOLIDIFY")
    sol.thickness = 0.015
    can = apply_mods(can)
    smooth(can)
    paint(can, lambda co, n_, c: hexcol(["#f6a6b9", "#fff3e3", "#bfa4e6", "#fff3e3"][int((math.atan2(c.y, c.x) + math.pi) / (math.pi * 2) * 8) % 4]))
    pole = cyl(0.022, 0.022, 2.05, (0, 0, 1.02), 8, "#d9d2c7")
    handle = tube([Vector((0, 0, 0.1)), Vector((0, 0, -0.02)), Vector((0.08, 0, -0.06)), Vector((0.12, 0, 0.02))], 0.02, WOOD_DARK)
    tip = sphere(0.03, (0, 0, 2.08), (1, 1, 1), GOLD)
    return [join([can, pole, handle, tip], "umbrella")]


def training_post():
    parts = [cyl(0.12, 0.12, 1.5, (0, 0, 0.75), 16, WOOD)]
    for i in range(14):
        parts.append(torus(0.125, 0.018, (0, 0, 0.55 + i * 0.045), "#d8c39b", "rope", (20, 6)))
    parts.append(box((1.4, 1.4, 0.04), (0, 0.2, 0.02), 0.03, "#6f8fbf"))
    for sx in (-0.18, 0.18):
        parts.append(sphere(0.085, (sx, -0.2, 1.42), (0.9, 1.1, 1), "#d84a4a"))
        parts.append(cyl(0.05, 0.05, 0.07, (sx, -0.2, 1.32), 10, CREAM))
    parts.append(tube([Vector((-0.18, -0.2, 1.48)), Vector((0, -0.15, 1.6)), Vector((0.18, -0.2, 1.48))], 0.006, CREAM))
    return [join(parts, "training_post")]


def paper_lantern():
    body = sphere(0.16, (0, 0, -0.2), (1, 1, 1.2), "#ffd1a6", "paper_lantern_glow", (14, 10))
    caps = join([cyl(0.07, 0.07, 0.03, (0, 0, -0.01), 10, "#b5413f"), cyl(0.07, 0.07, 0.03, (0, 0, -0.39), 10, "#b5413f"), cyl(0.004, 0.004, 0.2, (0, 0, 0.09), 4, "#5a3a2a")], "paper_lantern")
    return [caps, body]


def arch():
    parts = []
    for sx in (-1.4, 1.4):
        parts.append(cyl(0.12, 0.13, 3.0, (sx, 0, 1.5), 12, "#c2554c"))
        parts.append(cyl(0.18, 0.18, 0.18, (sx, 0, 0.09), 12, "#3e3331"))
    parts.append(box((3.6, 0.22, 0.18), (0, 0, 2.6), 0.03, "#c2554c"))
    top = tube([Vector((-2.1, 0, 3.08)), Vector((-1.0, 0, 3.0)), Vector((0, 0, 2.97)), Vector((1.0, 0, 3.0)), Vector((2.1, 0, 3.08))], 0.1, "#3e3331")
    parts.append(top)
    parts.append(box((0.5, 0.06, 0.42), (0, -0.08, 2.82), 0.02, "#f3e3c6"))
    return [join(parts, "sakura_arch")]


def star_stone():
    rnd = random.Random(7)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
    for v in bm.verts:
        d = v.co.normalized()
        v.co = Vector((d.x * 0.32, d.y * 0.22, d.z * 0.8)) * (1 + noise.noise(d * 2.3) * 0.12)
        if v.co.z < 0:
            v.co.z *= 0.3
    stone = mesh_from_bm("star_stone", bm)
    smooth(stone)
    stone.data.transform(Matrix.Translation((0, 0, 0.62)))
    paint(stone, lambda co, n, c: (lambda g: (g * 0.92, g * 0.95, g, 1))(0.42 + noise.noise(co * 4) * 0.05) if n.z < 0.6 else hexcol("#6f8a54"))
    # carved star rune on the front face (glows at night)
    pts = []
    for i in range(10):
        a = i / 10 * math.pi * 2 + math.pi / 2
        r = 0.11 if i % 2 == 0 else 0.045
        pts.append(Vector((math.cos(a) * r, -0.215, 0.85 + math.sin(a) * r)))
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in pts]
    bm.faces.new(vs)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    rune = mesh_from_bm("star_stone_glow", bm)
    solid(rune, "#9fd9ff")
    return [stone, rune]


def ribbon():
    bm = bmesh.new()
    rows = []
    for i in range(7):
        t = i / 6
        x = math.sin(t * 2.4) * 0.04
        rows.append((bm.verts.new((x - 0.025, 0, -t * 0.6)), bm.verts.new((x + 0.025, 0, -t * 0.6))))
    for a, b in zip(rows, rows[1:]):
        bm.faces.new((a[0], a[1], b[1], b[0]))
    r = mesh_from_bm("ribbon", bm)
    return [paint(r, lambda co, n, c: (1, 1, 1, 1))]


def balloon():
    # lathe profile for a classic envelope
    prof = [(0.0, 7.6), (1.2, 7.45), (2.1, 6.9), (2.55, 6.0), (2.6, 5.0), (2.3, 4.0), (1.7, 3.1), (1.0, 2.45), (0.55, 2.15)]
    n = 24
    bm = bmesh.new()
    rings = []
    for r, z in prof:
        rings.append([bm.verts.new((math.cos(i / n * math.pi * 2) * r, math.sin(i / n * math.pi * 2) * r, z)) for i in range(n)])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    env = mesh_from_bm("envelope", bm)
    smooth(env)
    cols = ["#f4a6b8", "#fff2e0", "#bca5e8", "#fff2e0", "#a9dcc7", "#fff2e0"]
    paint(env, lambda co, n_, c: hexcol(cols[int((math.atan2(c.y, c.x) + math.pi) / (math.pi * 2) * n) % len(cols)]))
    basket = box((0.9, 0.9, 0.7), (0, 0, 0.35), 0.06, "#b9864e", "basket")
    paint(basket, lambda co, n, c: (lambda g: (0.73 * g, 0.53 * g, 0.31 * g, 1))(0.85 + 0.15 * ((math.floor(co.z * 22) + math.floor((co.x + co.y) * 22)) % 2)))
    rim = box((0.96, 0.96, 0.06), (0, 0, 0.72), 0.03, "#7a5536")
    ropes = []
    for sx, sy in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        ropes.append(tube([Vector((sx * 0.42, sy * 0.42, 0.72)), Vector((sx * 0.4, sy * 0.4, 2.2))], 0.012, "#d6c4a5"))
    burner = cyl(0.12, 0.16, 0.2, (0, 0, 1.6), 12, "#5d5d63")
    return [join([env, basket, rim, burner] + ropes, "balloon")]


def gift(name, box_col, ribbon_col):
    parts = [box((0.36, 0.36, 0.3), (0, 0, 0.15), 0.015, box_col), box((0.39, 0.39, 0.07), (0, 0, 0.31), 0.012, box_col)]
    parts.append(box((0.4, 0.06, 0.37), (0, 0, 0.18), 0, ribbon_col))
    parts.append(box((0.06, 0.4, 0.37), (0, 0, 0.18), 0, ribbon_col))
    for s in (1, -1):
        parts.append(sphere(0.07, (s * 0.06, 0, 0.39), (1.1, 0.5, 0.65), ribbon_col))
    parts.append(sphere(0.03, (0, 0, 0.38), (1, 1, 1), ribbon_col))
    return [join(parts, name)]


def cupcake():
    wrap = cyl(0.07, 0.09, 0.08, (0, 0, 0.04), 18, "#e9a6c1", caps=True)
    paint(wrap, lambda co, n, c: hexcol("#e9a6c1") if int(math.atan2(c.y, c.x) * 6) % 2 else hexcol("#f6cddd"))
    frost = []
    for i in range(3):
        frost.append(sphere(0.09 - i * 0.024, (0, 0, 0.1 + i * 0.035), (1, 1, 0.55), "#fff3f6"))
    cherry = sphere(0.022, (0, 0, 0.2), (1, 1, 1), "#d32f45")
    sprinkles = [box((0.012, 0.004, 0.004), (math.cos(a) * 0.06, math.sin(a) * 0.06, 0.13), 0, c, rot=(0, 0, a)) for a, c in zip([0.3, 1.2, 2.2, 3.3, 4.2, 5.3], ["#7ec4f0", "#f7c948", "#8fd18a", "#c49af0", "#7ec4f0", "#f7c948"])]
    return [join([wrap] + frost + [cherry] + sprinkles, "cupcake")]


def letter():
    env = box((0.32, 0.22, 0.012), (0, 0, 0.006), 0.004, "#fdf6ea")
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in [(-0.16, 0.11, 0.013), (0.16, 0.11, 0.013), (0, -0.02, 0.013)]]
    bm.faces.new(vs)
    flap = solid(mesh_from_bm("flap", bm), "#f2e4cf")
    pts = []
    for i in range(30):
        t = i / 30 * math.pi * 2
        pts.append(Vector((16 * math.sin(t) ** 3 * 0.0026, (13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)) * 0.0026 - 0.02, 0.016)))
    bm = bmesh.new()
    hv = [bm.verts.new(p) for p in pts]
    bm.faces.new(hv)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    seal = solid(mesh_from_bm("seal", bm), "#d64a62")
    return [join([env, flap, seal], "letter")]


def cushion():
    return [join([torus(0.3, 0.09, (0, 0, 0.09), "#f2b8c6", "rim", (28, 10)), cyl(0.3, 0.3, 0.05, (0, 0, 0.04), 24, "#fbe3ea")], "cushion")]


def signpost():
    parts = [cyl(0.05, 0.05, 1.8, (0, 0, 0.9), 8, WOOD_DARK)]
    for i, (z, rot) in enumerate([(1.55, 0.3), (1.25, -0.5)]):
        bm = bmesh.new()
        vs = [bm.verts.new(v) for v in [(0, -0.1, 0), (0.6, -0.1, 0), (0.72, 0, 0), (0.6, 0.1, 0), (0, 0.1, 0)]]
        bm.faces.new(vs)
        arrow = mesh_from_bm("arrow", bm)
        sol = arrow.modifiers.new("s", "SOLIDIFY")
        sol.thickness = 0.04
        arrow = apply_mods(arrow)
        arrow.data.transform(Matrix.Rotation(math.pi / 2, 4, "X"))
        arrow.data.transform(Matrix.Rotation(rot, 4, "Z"))
        arrow.data.transform(Matrix.Translation((0, 0, z)))
        solid(arrow, "#e9d3ae" if i == 0 else "#d9b88a")
        parts.append(arrow)
    return [join(parts, "signpost")]


def heart_hedge():
    pts = []
    for i in range(36):
        t = i / 36 * math.pi * 2
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append(Vector((x * 0.24, y * 0.24 + 0.6, 0.12)))
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in pts]
    for a, b in zip(vs, vs[1:] + vs[:1]):
        bm.edges.new((a, b))
    hedge = mesh_from_bm("heart_hedge", bm)
    hedge.modifiers.new("skin", "SKIN")
    for d in hedge.data.skin_vertices[0].data:
        d.radius = (0.22, 0.22)
    sub = hedge.modifiers.new("sub", "SUBSURF")
    sub.levels = 1
    disp_tex = bpy.data.textures.new("n", "CLOUDS")
    disp_tex.noise_scale = 0.12
    disp = hedge.modifiers.new("d", "DISPLACE")
    disp.texture = disp_tex
    disp.strength = 0.06
    hedge = apply_mods(hedge)
    smooth(hedge)
    paint(hedge, lambda co, n, c: (lambda g: (0.24 * g, 0.42 * g, 0.18 * g, 1))(0.8 + max(0, n.z) * 0.35 + noise.noise(co * 6) * 0.08))
    return [hedge]


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objs = []
    objs += [bench()]
    objs += lantern_post()
    objs += picnic()
    objs += kiosk()
    objs += easel()
    objs += umbrella()
    objs += training_post()
    objs += paper_lantern()
    objs += arch()
    objs += star_stone()
    objs += ribbon()
    objs += balloon()
    objs += gift("gift_pink", PINK, "#ffffff")
    objs += gift("gift_lilac", LILAC, GOLD)
    objs += gift("gift_mint", MINT, "#f28aa5")
    objs += cupcake()
    objs += letter()
    objs += cushion()
    objs += signpost()
    objs += heart_hedge()
    for o in bpy.context.scene.objects:
        if o.type == "MESH":
            o.data.materials.clear()
            tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
            print(f"  {o.name:22s} {tris:6d} tris")
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_normals=True, export_vertex_color="ACTIVE",
                              export_materials="NONE", export_yup=True, export_apply=True)
    print("exported", OUT)


main()
