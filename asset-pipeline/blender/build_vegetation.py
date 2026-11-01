"""
Procedural vegetation library for the explorer's endless world.

    blender -b --factory-startup --python asset-pipeline/blender/build_vegetation.py [-- --preview]

Exports public/assets/vegetation/vegetation.glb containing one mesh per
species / variant / LOD, e.g. "tree_oak_0_lod0", "tree_oak_0_lod0_leaves".
Conventions consumed by src/world/render/vegetationLibrary.ts:

  * Trunks/props: vertex colour RGB = albedo, A = wind weight (0 rooted … 1 free).
  * Leaves: UVs address one cell of foliage-atlas.png (4x2 cells), vertex
    colour RGB = species colour × crown shading, A = wind weight.
    Normals are transferred from the crown volume (sphere/cone), giving the
    soft, painterly light response of hand-made stylised trees.
  * Units are metres, +Y up after export, origin at the ground contact.

Trunks are built with the Skin modifier on a branching skeleton, so limbs
merge smoothly into the trunk instead of intersecting as separate tubes.
"""
import bpy
import bmesh
import math
import random
import sys
import os
from mathutils import Vector, Matrix, noise

OUT = "public/assets/vegetation/vegetation.glb"
PREVIEW = "--preview" in sys.argv

ATLAS = {
    "broad": 0, "blossom": 1, "needle": 2, "willow": 3,
    "small": 4, "fern": 5, "maple": 6, "glow": 7,
}


def atlas_uv(cell):
    cx, cy = cell % 4, cell // 4
    u0, u1 = cx / 4, (cx + 1) / 4
    # PIL row 0 is the top of the image; glTF/three flipY handles orientation
    v1 = 1 - cy / 2
    v0 = 1 - (cy + 1) / 2
    return u0, v0, u1, v1


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


# --------------------------------------------------------------------------
# scene helpers
# --------------------------------------------------------------------------

def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def mesh_object(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    return link(obj)


def evaluated_copy(obj, name):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, depsgraph=dg)
    old_mesh = obj.data
    bpy.data.objects.remove(obj, do_unlink=True)
    if old_mesh.users == 0:
        bpy.data.meshes.remove(old_mesh)
    me.name = name
    new = bpy.data.objects.new(name, me)
    link(new)
    return new


def set_colors(obj, fn):
    """fn(co: Vector, normal: Vector) -> (r, g, b, a) in sRGB-ish 0..1 (exported as-is)."""
    me = obj.data
    if "Color" in me.color_attributes:
        me.color_attributes.remove(me.color_attributes["Color"])
    attr = me.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="CORNER")
    for poly in me.polygons:
        for li in poly.loop_indices:
            v = me.loops[li].vertex_index
            attr.data[li].color = fn(me.vertices[v].co, me.vertices[v].normal)
    me.color_attributes.active_color = attr


def decimate(obj, ratio):
    mod = obj.modifiers.new("dec", "DECIMATE")
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    out = evaluated_copy(obj, obj.name)
    bm = bmesh.new()
    bm.from_mesh(out.data)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-5, edges=bm.edges)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_area() < 1e-9], context="FACES")
    bm.to_mesh(out.data)
    bm.free()
    out.data.validate(clean_customdata=False)
    return out


def shade_smooth(obj):
    for p in obj.data.polygons:
        p.use_smooth = True


# --------------------------------------------------------------------------
# skeleton → skin trunk
# --------------------------------------------------------------------------

class Skeleton:
    def __init__(self):
        self.verts = []  # (Vector, radius)
        self.edges = []
        self.tips = []  # (position, direction, radius, depth)

    def add(self, co, r):
        self.verts.append((Vector(co), r))
        return len(self.verts) - 1

    def chain(self, start_idx, direction, length, segments, r0, r1, bend=Vector((0, 0, 0)), wobble=0.0, rnd=None, droop=0.0):
        idx = start_idx
        pos = self.verts[start_idx][0].copy()
        d = direction.normalized()
        for s in range(1, segments + 1):
            t = s / segments
            d = (d + bend * (1.0 / segments) + Vector((0, 0, -droop * t / segments))).normalized()
            if rnd and wobble:
                d = (d + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.3, 0.3))) * wobble).normalized()
            pos = pos + d * (length / segments)
            r = r0 + (r1 - r0) * t
            new = self.add(pos, r)
            self.edges.append((idx, new))
            idx = new
        return idx, d

    def build(self, name, subsurf=1):
        bm = bmesh.new()
        for co, _ in self.verts:
            bm.verts.new(co)
        bm.verts.ensure_lookup_table()
        for a, b in self.edges:
            bm.edges.new((bm.verts[a], bm.verts[b]))
        obj = mesh_object(name, bm)
        skin = obj.data.skin_vertices[""].data if "" in obj.data.skin_vertices else None
        if skin is None:
            obj.modifiers.new("skin", "SKIN")
            skin = obj.data.skin_vertices[0].data
        else:
            obj.modifiers.new("skin", "SKIN")
        for i, (_, r) in enumerate(self.verts):
            skin[i].radius = (r, r)
        skin[0].use_root = True
        sm = obj.modifiers["skin"]
        sm.use_smooth_shade = True
        sm.branch_smoothing = 0.6
        if subsurf:
            ss = obj.modifiers.new("sub", "SUBSURF")
            ss.levels = subsurf
            ss.render_levels = subsurf
        obj = evaluated_copy(obj, name)
        shade_smooth(obj)
        return obj


# --------------------------------------------------------------------------
# foliage cards
# --------------------------------------------------------------------------

def random_unit(rnd):
    while True:
        v = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1)))
        if 0.05 < v.length <= 1:
            return v.normalized()


def add_card(bm, uv_layer, center, normal, up_hint, size, cell, aspect=1.0, data=None, rnd=None):
    n = normal.normalized()
    t = up_hint.cross(n)
    if t.length < 1e-3:
        t = Vector((1, 0, 0)).cross(n)
    t.normalize()
    b = n.cross(t).normalized()
    # random spin around the normal
    if rnd:
        a = rnd.uniform(0, math.pi * 2)
        t, b = (t * math.cos(a) + b * math.sin(a)), (b * math.cos(a) - t * math.sin(a))
    hw = size * 0.5
    hh = size * 0.5 * aspect
    corners = [center - t * hw - b * hh, center + t * hw - b * hh, center + t * hw + b * hh, center - t * hw + b * hh]
    vs = [bm.verts.new(c) for c in corners]
    f = bm.faces.new(vs)
    u0, v0, u1, v1 = atlas_uv(cell)
    uvs = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    for loop, uv in zip(f.loops, uvs):
        loop[uv_layer].uv = uv
    if data is not None:
        data.append(f)
    return f


def hanging_card(bm, uv_layer, top, facing, width, length, cell):
    """Vertical strand card hanging from `top` (willow)."""
    side = Vector((0, 0, 1)).cross(facing).normalized()
    corners = [top + side * width * 0.5 + Vector((0, 0, -length)), top - side * width * 0.5 + Vector((0, 0, -length)),
               top - side * width * 0.5, top + side * width * 0.5]
    vs = [bm.verts.new(c) for c in corners]
    f = bm.faces.new(vs)
    u0, v0, u1, v1 = atlas_uv(cell)
    for loop, uv in zip(f.loops, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]):
        loop[uv_layer].uv = uv
    return f


def finish_foliage(obj, normal_fn, color_fn, double_sided=True):
    """Assign transferred crown normals + vertex colours to a card mesh."""
    me = obj.data
    shade_smooth(obj)
    normals = []
    for v in me.vertices:
        normals.append(normal_fn(v.co))
    me.normals_split_custom_set_from_vertices(normals)
    set_colors(obj, lambda co, n: color_fn(co))


# --------------------------------------------------------------------------
# species definitions
# --------------------------------------------------------------------------

SPECIES = {
    # name: trunk/limb/crown parameters
    "oak": dict(h=(3.0, 3.6), r0=0.26, limbs=(5, 7), limb_len=(1.7, 2.4), limb_up=0.45, crown=(2.6, 2.1), cell="broad",
                leaf=hexcol("#5f8f3a"), bark=hexcol("#5b4334"), cards=520, card=(0.9, 1.25), clumps=16),
    "linden": dict(h=(3.4, 4.0), r0=0.22, limbs=(5, 6), limb_len=(1.3, 1.8), limb_up=0.75, crown=(2.0, 2.6), cell="small",
                   leaf=hexcol("#6ea044"), bark=hexcol("#5d4a3c"), cards=480, card=(0.8, 1.1), clumps=14),
    "birch": dict(h=(4.4, 5.4), r0=0.13, limbs=(5, 7), limb_len=(1.0, 1.5), limb_up=0.95, crown=(1.35, 2.4), cell="small",
                  leaf=hexcol("#9cbf4e"), bark=hexcol("#ece6da"), cards=300, card=(0.65, 0.9), clumps=12),
    "sakura": dict(h=(2.2, 2.7), r0=0.2, limbs=(5, 6), limb_len=(1.8, 2.4), limb_up=0.35, crown=(2.7, 1.7), cell="blossom",
                   leaf=hexcol("#f3b3c9"), bark=hexcol("#4d3532"), cards=560, card=(0.9, 1.2), clumps=18),
    "maple": dict(h=(3.0, 3.6), r0=0.21, limbs=(5, 7), limb_len=(1.5, 2.0), limb_up=0.6, crown=(2.3, 2.3), cell="maple",
                  leaf=hexcol("#e07a2c"), bark=hexcol("#574034"), cards=500, card=(0.85, 1.15), clumps=15),
    "glow": dict(h=(3.0, 3.5), r0=0.2, limbs=(5, 6), limb_len=(1.4, 1.9), limb_up=0.6, crown=(2.2, 2.2), cell="glow",
                 leaf=hexcol("#7fd6c4"), bark=hexcol("#4a4152"), cards=440, card=(0.85, 1.15), clumps=14),
}


def build_trunk(name, sp, rnd, height, lod):
    sk = Skeleton()
    base = sk.add((0, 0, -0.25), sp["r0"] * 1.25)
    # root flare
    for k in range(4):
        a = k * math.pi / 2 + rnd.uniform(-0.4, 0.4)
        ri = sk.add((math.cos(a) * sp["r0"] * 1.7, math.sin(a) * sp["r0"] * 1.7, -0.12), sp["r0"] * 0.45)
        sk.edges.append((base, ri))
    lean = Vector((rnd.uniform(-0.12, 0.12), rnd.uniform(-0.12, 0.12), 1)).normalized()
    top, _ = sk.chain(base, lean, height + 0.25, 6, sp["r0"], sp["r0"] * 0.45, bend=Vector((rnd.uniform(-0.2, 0.2), rnd.uniform(-0.2, 0.2), 0)), wobble=0.06, rnd=rnd)
    trunk_pts = [sk.verts[i][0] for i in range(len(sk.verts))]
    clump_centers = []
    nl = rnd.randint(*sp["limbs"])
    golden = math.pi * (3 - math.sqrt(5))
    trunk_chain = list(range(5, len(sk.verts)))
    for i in range(nl):
        t = 0.5 + 0.5 * (i / max(1, nl - 1))
        idx = trunk_chain[min(len(trunk_chain) - 1, int(t * (len(trunk_chain) - 1)))]
        az = i * golden + rnd.uniform(-0.3, 0.3)
        up = sp["limb_up"] + rnd.uniform(-0.15, 0.15)
        d = Vector((math.cos(az), math.sin(az), up)).normalized()
        L = rnd.uniform(*sp["limb_len"])
        tip, td = sk.chain(idx, d, L, 3, sk.verts[idx][1] * 0.6, 0.035, bend=Vector((0, 0, 0.25)), wobble=0.12, rnd=rnd,
                           droop=0.35 if name.startswith("tree_sakura") else 0.0)
        clump_centers.append(sk.verts[tip][0].copy())
        # secondary fork
        if lod == 0 or i % 2 == 0:
            mid = len(sk.verts) - 2
            d2 = (td + Vector((rnd.uniform(-0.8, 0.8), rnd.uniform(-0.8, 0.8), 0.3))).normalized()
            tip2, _ = sk.chain(mid, d2, L * 0.55, 2, sk.verts[mid][1] * 0.6, 0.025, wobble=0.1, rnd=rnd)
            clump_centers.append(sk.verts[tip2][0].copy())
    clump_centers.append(sk.verts[top][0].copy())
    obj = sk.build(name, subsurf=1 if lod == 0 else 0)
    obj = decimate(obj, 0.2 if lod == 0 else 0.1)
    bark = sp["bark"]
    H = height

    def bark_color(co, n):
        moss = max(0.0, 1 - co.z / 1.2) * max(0.0, n.z * 0.5 + 0.5) * 0.25
        shade = 0.82 + 0.18 * min(1.0, max(0.0, co.z / H))
        r, g, b = bark
        r, g, b = r * shade, g * shade, b * shade
        r, g, b = r + (0.22 - r) * moss, g + (0.32 - g) * moss, b + (0.12 - b) * moss
        wind = min(1.0, max(0.0, co.z / (H + 2.5))) ** 2 * 0.6 + min(1.0, Vector((co.x, co.y)).length / 3.0) * 0.4
        return (r, g, b, wind)

    set_colors(obj, bark_color)
    return obj, clump_centers, trunk_pts


def build_crown(name, sp, rnd, clumps, height, lod):
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    cw, ch = sp["crown"]
    centre = Vector((0, 0, height + ch * 0.15))
    # extra clump centres fill the crown volume evenly
    centres = list(clumps)
    while len(centres) < sp["clumps"]:
        v = random_unit(rnd)
        v = Vector((v.x * cw * 0.75, v.y * cw * 0.75, v.z * ch * 0.55))
        centres.append(centre + v)
    count = sp["cards"] if lod == 0 else sp["cards"] // 5
    size_mul = 1.0 if lod == 0 else 1.9
    cell = ATLAS[sp["cell"]]
    for i in range(count):
        c = centres[i % len(centres)]
        p = c + random_unit(rnd) * rnd.uniform(0.15, 0.85) * (0.75 if lod == 0 else 1.0)
        # keep cards inside the crown ellipsoid
        rel = p - centre
        q = Vector((rel.x / cw, rel.y / cw, rel.z / ch))
        if q.length > 1.05:
            p = centre + Vector((q.x * cw, q.y * cw, q.z * ch)) / q.length * 1.0
        n = (p - centre).normalized() + random_unit(rnd) * 0.6
        add_card(bm, uv, p, n, Vector((0, 0, 1)), rnd.uniform(*sp["card"]) * size_mul * 1.25, cell, rnd=rnd)
    obj = mesh_object(name, bm)
    leaf = sp["leaf"]

    def nfn(co):
        rel = co - centre
        q = Vector((rel.x / cw, rel.y / cw, (rel.z / ch) * 0.9 + 0.12))
        return q.normalized()

    def cfn(co):
        rel = co - centre
        q = Vector((rel.x / cw, rel.y / cw, rel.z / ch))
        outer = min(1.0, q.length)
        top = min(1.0, max(0.0, q.z * 0.5 + 0.5))
        shade = 0.5 + 0.32 * outer + 0.25 * top
        hue = 1 + noise.noise(co * 0.9) * 0.08
        wind = 0.45 + 0.55 * min(1.0, Vector((co.x, co.y)).length / max(0.5, cw))
        return (leaf[0] * shade * hue, leaf[1] * shade, leaf[2] * shade / hue, wind)

    finish_foliage(obj, nfn, cfn)
    return obj


def build_tree(species, variant, lod):
    sp = SPECIES[species]
    rnd = random.Random(hash((species, variant)) & 0xFFFFFFFF)
    height = rnd.uniform(*sp["h"])
    trunk, clumps, _ = build_trunk(f"tree_{species}_{variant}_lod{lod}", sp, rnd, height, lod)
    crown = build_crown(f"tree_{species}_{variant}_lod{lod}_leaves", sp, random.Random(variant * 977 + lod), clumps, height, lod)
    return [trunk, crown]


def build_pine(variant, lod):
    rnd = random.Random(4242 + variant)
    H = rnd.uniform(6.0, 7.6)
    sk = Skeleton()
    base = sk.add((0, 0, -0.25), 0.3)
    for k in range(4):
        a = k * math.pi / 2 + rnd.uniform(-0.3, 0.3)
        ri = sk.add((math.cos(a) * 0.45, math.sin(a) * 0.45, -0.1), 0.1)
        sk.edges.append((base, ri))
    sk.chain(base, Vector((0, 0, 1)), H + 0.25, 7, 0.24, 0.04, wobble=0.02, rnd=rnd)
    trunk = sk.build(f"tree_pine_{variant}_lod{lod}", subsurf=1 if lod == 0 else 0)
    trunk = decimate(trunk, 0.3 if lod == 0 else 0.12)
    set_colors(trunk, lambda co, n: (0.36, 0.25, 0.19, min(1.0, co.z / (H + 1)) ** 2 * 0.5))
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    tiers = 9 if lod == 0 else 5
    cell = ATLAS["needle"]
    for t in range(tiers):
        f = t / (tiers - 1)
        z = 1.4 + f * (H - 1.6)
        radius = (1 - f) * 2.0 + 0.35
        n_cards = int((26 if lod == 0 else 9) * (1 - f * 0.6)) + 3
        for i in range(n_cards):
            a = i / n_cards * math.pi * 2 + rnd.uniform(-0.2, 0.2) + t * 0.7
            r = radius * rnd.uniform(0.45, 1.0)
            p = Vector((math.cos(a) * r, math.sin(a) * r, z - r * 0.25 + rnd.uniform(-0.15, 0.15)))
            outward = Vector((math.cos(a), math.sin(a), 0.55))
            s = (1.3 + (1 - f) * 0.9) * (1.0 if lod == 0 else 1.6)
            add_card(bm, uv, p, outward + random_unit(rnd) * 0.4, Vector((0, 0, 1)), s, cell, rnd=rnd)
    crown = mesh_object(f"tree_pine_{variant}_lod{lod}_leaves", bm)
    leaf = hexcol("#2f5f3e")

    def nfn(co):
        return Vector((co.x, co.y, 0.6 + (co.z / H) * 0.6)).normalized()

    def cfn(co):
        rr = Vector((co.x, co.y)).length
        maxr = (1 - min(1, (co.z - 1.4) / (H - 1.6))) * 2.0 + 0.35
        outer = min(1.0, rr / max(0.3, maxr))
        shade = 0.55 + 0.35 * outer + 0.2 * (co.z / H)
        return (leaf[0] * shade, leaf[1] * shade, leaf[2] * shade, 0.35 + 0.65 * outer)

    finish_foliage(crown, nfn, cfn)
    return [trunk, crown]


def build_willow(variant, lod):
    rnd = random.Random(777 + variant)
    sk = Skeleton()
    base = sk.add((0, 0, -0.25), 0.36)
    for k in range(5):
        a = k * math.pi * 2 / 5 + rnd.uniform(-0.3, 0.3)
        ri = sk.add((math.cos(a) * 0.6, math.sin(a) * 0.6, -0.1), 0.12)
        sk.edges.append((base, ri))
    top, _ = sk.chain(base, Vector((0.05, 0, 1)), 2.6, 4, 0.32, 0.18, wobble=0.08, rnd=rnd)
    arcs = []
    for i in range(7):
        az = i / 7 * math.pi * 2 + rnd.uniform(-0.3, 0.3)
        d = Vector((math.cos(az), math.sin(az), 1.2)).normalized()
        start = 3 + rnd.randint(0, 2)
        tip, _ = sk.chain(start, d, rnd.uniform(2.2, 2.8), 4, 0.12, 0.03, bend=Vector((math.cos(az) * 1.2, math.sin(az) * 1.2, -1.6)), rnd=rnd, wobble=0.05)
        arcs.append([sk.verts[j][0].copy() for j in range(len(sk.verts) - 4, len(sk.verts))])
    trunk = sk.build(f"tree_willow_{variant}_lod{lod}", subsurf=1 if lod == 0 else 0)
    trunk = decimate(trunk, 0.22 if lod == 0 else 0.1)
    set_colors(trunk, lambda co, n: (0.33, 0.27, 0.2, min(1.0, co.z / 5) ** 2 * 0.7))
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    cell = ATLAS["willow"]
    per = 16 if lod == 0 else 6
    for arc in arcs:
        for k in range(per):
            t = k / per
            seg = arc[min(len(arc) - 1, int(t * (len(arc) - 1)))]
            top_p = seg + random_unit(rnd) * 0.5
            facing = Vector((top_p.x, top_p.y, 0)).normalized() if Vector((top_p.x, top_p.y)).length > 0.1 else Vector((1, 0, 0))
            facing.rotate(Matrix.Rotation(rnd.uniform(-0.8, 0.8), 3, "Z"))
            length = min(top_p.z - 0.3, rnd.uniform(2.2, 3.4))
            hanging_card(bm, uv, top_p, facing, rnd.uniform(0.9, 1.3) * (1 if lod == 0 else 1.8), length, cell)
    crown = mesh_object(f"tree_willow_{variant}_lod{lod}_leaves", bm)
    leaf = hexcol("#86ad4c")

    def nfn(co):
        return Vector((co.x, co.y, 0.5 + co.z * 0.08)).normalized()

    def cfn(co):
        rr = min(1.0, Vector((co.x, co.y)).length / 3.2)
        shade = 0.55 + 0.35 * rr + 0.12 * min(1, co.z / 5)
        return (leaf[0] * shade, leaf[1] * shade, leaf[2] * shade, 0.4 + 0.6 * (1 - min(1, co.z / 5.5)))

    finish_foliage(crown, nfn, cfn)
    return [trunk, crown]


# --------------------------------------------------------------------------
# bushes, ferns
# --------------------------------------------------------------------------

def build_bush(name, cell, color, variant, lod, radius=0.85, height=0.75, cards=110):
    rnd = random.Random(hash((name, variant)) & 0xFFFF)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    centre = Vector((0, 0, height * 0.55))
    n = cards if lod == 0 else cards // 4
    for i in range(n):
        v = random_unit(rnd)
        v.z = abs(v.z) * 0.9 - 0.1
        p = centre + Vector((v.x * radius, v.y * radius, v.z * height * 0.7)) * rnd.uniform(0.35, 1.0)
        add_card(bm, uv, p, (p - centre) + random_unit(rnd) * 0.5, Vector((0, 0, 1)), rnd.uniform(0.55, 0.8) * (1 if lod == 0 else 1.7), cell, rnd=rnd)
    obj = mesh_object(f"{name}_{variant}_lod{lod}_leaves", bm)

    def nfn(co):
        rel = co - centre
        return Vector((rel.x / radius, rel.y / radius, rel.z / height + 0.3)).normalized()

    def cfn(co):
        rel = co - centre
        outer = min(1.0, Vector((rel.x / radius, rel.y / radius, rel.z / height)).length)
        shade = 0.5 + 0.35 * outer + 0.2 * min(1, co.z / height)
        return (color[0] * shade, color[1] * shade, color[2] * shade, 0.25 + 0.6 * outer)

    finish_foliage(obj, nfn, cfn)
    return [obj]


def build_fern(variant, lod):
    rnd = random.Random(31 + variant)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    fronds = 9 if lod == 0 else 5
    u0, v0, u1, v1 = atlas_uv(ATLAS["fern"])
    for i in range(fronds):
        a = i / fronds * math.pi * 2 + rnd.uniform(-0.2, 0.2)
        L = rnd.uniform(0.75, 1.05)
        w = L * 0.42
        d = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((0, 0, 1)).cross(d)
        segs = 4
        rows = []
        for s in range(segs + 1):
            t = s / segs
            pos = d * L * t * 0.95 + Vector((0, 0, math.sin(t * math.pi * 0.8) * L * 0.55 - t * t * 0.15))
            rows.append((bm.verts.new(pos - side * w * 0.5), bm.verts.new(pos + side * w * 0.5), t))
        for s in range(segs):
            a0, b0, t0 = rows[s]
            a1, b1, t1 = rows[s + 1]
            f = bm.faces.new((a0, b0, b1, a1))
            for loop in f.loops:
                vv = loop.vert
                t = t0 if vv in (a0, b0) else t1
                left = vv in (a0, a1)
                loop[uv].uv = (u0 if left else u1, v0 + (v1 - v0) * t)
    obj = mesh_object(f"fern_{variant}_lod{lod}_leaves", bm)
    col = hexcol("#4f8a3a")
    finish_foliage(obj, lambda co: Vector((co.x, co.y, 1.2)).normalized(),
                   lambda co: (col[0] * (0.6 + co.z * 0.6), col[1] * (0.6 + co.z * 0.6), col[2] * (0.6 + co.z * 0.5), min(1, Vector((co.x, co.y)).length)))
    return [obj]


# --------------------------------------------------------------------------
# rocks, logs, mushrooms, reeds, lilies
# --------------------------------------------------------------------------

def build_boulder(variant, lod, name="rock_boulder", scale=(1.0, 0.8, 0.62), detail=4):
    rnd = random.Random(900 + variant)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=detail if lod == 0 else 2, radius=1.0)
    seed = Vector((rnd.uniform(0, 50), rnd.uniform(0, 50), rnd.uniform(0, 50)))
    for v in bm.verts:
        d = v.co.normalized()
        n = noise.fractal(d * 1.3 + seed, 0.6, 2.2, 4) * 0.28 + noise.noise(d * 4 + seed) * 0.06
        v.co = d * (1 + n)
        v.co.x *= scale[0] * rnd.uniform(0.85, 1.15)
        v.co.y *= scale[1] * rnd.uniform(0.85, 1.15)
        v.co.z = v.co.z * scale[2] if v.co.z > 0 else v.co.z * 0.25
    # flatten facets a little for a chiselled read
    obj = mesh_object(f"{name}_{variant}_lod{lod}", bm)
    shade_smooth(obj)
    obj.data.update()

    def rc(co, n):
        moss = max(0.0, n.z - 0.45) * 1.4
        grey = 0.3 + noise.noise(co * 2.5 + seed) * 0.05 + max(0, co.z) * 0.05
        r, g, b = grey * 1.02, grey, grey * 0.95
        return (r + (0.24 - r) * min(1, moss), g + (0.36 - g) * min(1, moss), b + (0.12 - b) * min(1, moss), 0.0)

    set_colors(obj, rc)
    return [obj]


def build_stones(variant, lod):
    parts = []
    rnd = random.Random(1300 + variant)
    for k in range(4):
        o = build_boulder(variant * 10 + k, lod, name=f"stone_tmp{k}", scale=(rnd.uniform(0.25, 0.4), rnd.uniform(0.2, 0.35), rnd.uniform(0.15, 0.25)), detail=3)[0]
        o.location = (rnd.uniform(-0.5, 0.5), rnd.uniform(-0.5, 0.5), 0)
        o.rotation_euler = (0, 0, rnd.uniform(0, 6.28))
        parts.append(o)
    return [join(parts, f"rock_stones_{variant}_lod{lod}")]


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    obj.data.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return obj


def build_log(variant, lod):
    rnd = random.Random(1500 + variant)
    sk = Skeleton()
    a = sk.add((-1.1, 0, 0.22), 0.22)
    sk.chain(a, Vector((1, rnd.uniform(-0.1, 0.1), 0)), 2.2, 4, 0.22, 0.17, wobble=0.04, rnd=rnd)
    obj = sk.build(f"prop_log_{variant}_lod{lod}", subsurf=1 if lod == 0 else 0)

    def lc(co, n):
        top = max(0.0, n.z - 0.3)
        end = max(0.0, abs(n.x) - 0.75) * 3
        r, g, b = 0.33, 0.24, 0.17
        if end > 0.3:
            return (0.62, 0.48, 0.32, 0.0)
        return (r + (0.25 - r) * top * 0.8, g + (0.38 - g) * top * 0.8, b + (0.13 - b) * top * 0.8, 0.0)

    set_colors(obj, lc)
    return [obj]


def build_mushrooms(variant, lod):
    rnd = random.Random(1700 + variant)
    parts = []
    cap_col = [hexcol("#c8402f"), hexcol("#b98a5a"), hexcol("#e6d3b8")][variant % 3]
    for k in range(5 if lod == 0 else 3):
        h = rnd.uniform(0.08, 0.2)
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.022, radius2=0.016, depth=h)
        bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, h / 2))
        stem = mesh_object(f"mush_stem{k}", bm)
        set_colors(stem, lambda co, n: (0.92, 0.88, 0.8, 0.0))
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=5, radius=rnd.uniform(0.05, 0.09))
        for v in bm.verts:
            if v.co.z < 0:
                v.co.z *= 0.15
            v.co.z *= 0.75
        bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, h))
        cap = mesh_object(f"mush_cap{k}", bm)
        spots = variant % 3 == 0

        def cc(co, n, h=h):
            spot = spots and noise.noise(co * 60) > 0.35 and co.z > h + 0.01
            c = (0.97, 0.95, 0.9) if spot else cap_col
            return (c[0], c[1], c[2], 0.0)

        set_colors(cap, cc)
        piece = join([stem, cap], f"mush{k}")
        piece.location = (rnd.uniform(-0.25, 0.25), rnd.uniform(-0.25, 0.25), 0)
        parts.append(piece)
    obj = join(parts, f"prop_mushrooms_{variant}_lod{lod}")
    shade_smooth(obj)
    return [obj]


def build_reeds(variant, lod):
    rnd = random.Random(1900 + variant)
    bm = bmesh.new()
    blades = 16 if lod == 0 else 7
    for i in range(blades):
        a = rnd.uniform(0, 6.28)
        r = rnd.uniform(0, 0.25)
        base = Vector((math.cos(a) * r, math.sin(a) * r, -0.05))
        h = rnd.uniform(0.7, 1.35)
        lean = Vector((rnd.uniform(-0.2, 0.2), rnd.uniform(-0.2, 0.2), 1)).normalized()
        side = lean.cross(Vector((math.cos(a + 1.57), math.sin(a + 1.57), 0))).normalized() * 0.025
        prev = None
        for s in range(5):
            t = s / 4
            c = base + lean * h * t + Vector((lean.x, lean.y, 0)) * t * t * 0.3
            w = (1 - t * 0.85)
            pair = (bm.verts.new(c - side * w), bm.verts.new(c + side * w))
            if prev:
                bm.faces.new((prev[0], prev[1], pair[1], pair[0]))
            prev = pair
        if i % 4 == 0:
            # cattail head
            top = base + lean * h * 0.92
            ret = bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.03, radius2=0.03, depth=0.16)
            bmesh.ops.translate(bm, verts=ret["verts"], vec=top)
    obj = mesh_object(f"prop_reeds_{variant}_lod{lod}", bm)
    shade_smooth(obj)

    def rcf(co, n):
        t = min(1, max(0, co.z / 1.3))
        head = False
        return (0.28 + t * 0.25, 0.4 + t * 0.12, 0.16, t)

    set_colors(obj, rcf)
    return [obj]


def build_lily(variant, lod):
    rnd = random.Random(2100 + variant)
    parts = []
    for k in range(3):
        bm = bmesh.new()
        r = rnd.uniform(0.18, 0.3)
        segs = 20
        centre = bm.verts.new((0, 0, 0))
        ring = []
        notch = rnd.uniform(0, 6.28)
        for s in range(segs + 1):
            a = notch + 0.35 + s / segs * (math.pi * 2 - 0.7)
            ring.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, 0)))
        for s in range(segs):
            bm.faces.new((centre, ring[s], ring[s + 1]))
        pad = mesh_object(f"lily_pad{k}", bm)
        set_colors(pad, lambda co, n: (0.22 + Vector((co.x, co.y)).length * 0.3, 0.42, 0.16, 0.0))
        pad.location = (rnd.uniform(-0.4, 0.4), rnd.uniform(-0.4, 0.4), 0.012)
        parts.append(pad)
    if variant % 2 == 0:
        bm = bmesh.new()
        for p in range(8):
            a = p / 8 * math.pi * 2
            ret = bmesh.ops.create_uvsphere(bm, u_segments=6, v_segments=4, radius=0.05)
            for v in ret["verts"]:
                v.co.x *= 1.7
                v.co.z *= 0.6
            bmesh.ops.rotate(bm, verts=ret["verts"], cent=(0, 0, 0), matrix=Matrix.Rotation(-0.6, 3, "Y"))
            bmesh.ops.translate(bm, verts=ret["verts"], vec=(0.07, 0, 0.05))
            bmesh.ops.rotate(bm, verts=ret["verts"], cent=(0, 0, 0), matrix=Matrix.Rotation(a, 3, "Z"))
        flower = mesh_object("lily_flower", bm)
        set_colors(flower, lambda co, n: (0.98, 0.82, 0.88, 0.0))
        parts.append(flower)
    obj = join(parts, f"prop_lily_{variant}_lod{lod}")
    shade_smooth(obj)
    return [obj]


# --------------------------------------------------------------------------
# flowers (stem + leaves + species head), all vertex coloured
# --------------------------------------------------------------------------

FLOWERS = {
    "daisy": dict(petal=hexcol("#fbf7ee"), centre=hexcol("#f2c230"), petals=12, plen=0.055, pw=0.016, cup=0.05, h=0.32),
    "poppy": dict(petal=hexcol("#e2382c"), centre=hexcol("#2a1d1d"), petals=4, plen=0.05, pw=0.042, cup=0.55, h=0.42),
    "buttercup": dict(petal=hexcol("#f6cf2a"), centre=hexcol("#e7a41c"), petals=5, plen=0.03, pw=0.022, cup=0.6, h=0.26),
    "cosmos": dict(petal=hexcol("#ef8fbd"), centre=hexcol("#f2c230"), petals=8, plen=0.06, pw=0.024, cup=0.15, h=0.5),
    "cornflower": dict(petal=hexcol("#4f7fe0"), centre=hexcol("#2c3f8c"), petals=10, plen=0.036, pw=0.012, cup=0.4, h=0.38),
    "lavender": dict(petal=hexcol("#9a7ad8"), centre=hexcol("#7c5cc0"), petals=0, plen=0, pw=0, cup=0, h=0.48),
    "tulip": dict(petal=hexcol("#f06a8a"), centre=hexcol("#f06a8a"), petals=6, plen=0.07, pw=0.035, cup=1.3, h=0.36),
}


def flower_bloom(f, rnd, base, hk, size, lean, lod):
    """One stem + bloom. base: root offset, hk: height factor, size: head scale."""
    parts = []
    h = f["h"] * hk
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=5 if lod == 0 else 3, radius1=0.0055, radius2=0.0035, depth=h)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, h / 2))
    bend = rnd.uniform(0.6, 1.4)
    for v in bm.verts:
        t = v.co.z / h
        v.co.x += math.sin(t * 1.3) * 0.03 * bend + lean.x * t * t
        v.co.y += lean.y * t * t
        v.co += base
    stem = mesh_object("f_stem", bm)
    set_colors(stem, lambda co, n: (0.22, 0.42, 0.13, min(1, (co.z) / h)))
    parts.append(stem)
    top = base + Vector((math.sin(1.3) * 0.03 * bend + lean.x, lean.y, h))
    # the bloom faces outward/up like a real flower turning to the light
    tilt = Matrix.Rotation(rnd.uniform(0.15, 0.45), 3, Vector((-lean.y, lean.x, 0)).normalized() if lean.length > 1e-4 else Vector((1, 0, 0)))
    if f["petals"] == 0:
        bm = bmesh.new()
        n = 8 if lod == 0 else 5
        for k in range(n):
            t = k / (n - 1)
            ret = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.013 * size * (1 - t * 0.45))
            ang = k * 2.4
            bmesh.ops.translate(bm, verts=ret["verts"], vec=top + Vector((math.cos(ang) * 0.009 * size, math.sin(ang) * 0.009 * size, -0.05 * size + t * 0.14 * size)))
        head = mesh_object("f_head", bm)
        col = f["petal"]
        set_colors(head, lambda co, n_: (col[0] * rnd.uniform(0.9, 1.05), col[1], col[2], 1.0))
        parts.append(head)
        return parts
    bm = bmesh.new()
    n_p = f["petals"]
    L, W = f["plen"] * size, f["pw"] * size
    for k in range(n_p):
        a = k / n_p * math.pi * 2
        rows = []
        for st in range(4 if lod == 0 else 3):
            t = st / (3 if lod == 0 else 2)
            w = math.sin(min(1, t * 1.1 + 0.1) * math.pi) ** 0.7 * W
            lift = t * t * f["cup"] * L
            rows.append((bm.verts.new(Vector((t * L, w, lift))), bm.verts.new(Vector((t * L, -w, lift)))))
        for st in range(len(rows) - 1):
            bm.faces.new((rows[st][0], rows[st][1], rows[st + 1][1], rows[st + 1][0]))
        vs = [v for r in rows for v in r]
        bmesh.ops.rotate(bm, verts=vs, cent=(0, 0, 0), matrix=Matrix.Rotation(a + rnd.uniform(-0.12, 0.12), 3, "Z"))
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=tilt)
    bmesh.ops.translate(bm, verts=bm.verts, vec=top)
    petals = mesh_object("f_petals", bm)
    col = f["petal"]
    shade = rnd.uniform(0.9, 1.04)
    # petals: slightly deeper colour at the base, lit edges
    set_colors(petals, lambda co, n_: (min(1, col[0] * shade * (0.8 + 0.2 * min(1, (co - top).length / L))), min(1, col[1] * shade * (0.82 + 0.18 * min(1, (co - top).length / L))), min(1, col[2] * shade), 1.0))
    parts.append(petals)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=6, v_segments=4, radius=(0.012 if f["cup"] < 1 else 0.017) * size)
    for v in bm.verts:
        v.co.z *= 0.6
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=tilt)
    bmesh.ops.translate(bm, verts=bm.verts, vec=top + Vector((0, 0, 0.004)))
    centre = mesh_object("f_centre", bm)
    cc = f["centre"]
    set_colors(centre, lambda co, n_: (cc[0], cc[1], cc[2], 1.0))
    parts.append(centre)
    return parts


def build_flower(name, f, lod):
    """A natural clump: a basal rosette and several blooms of varied height
    and age leaning outward, instead of one lone stem."""
    rnd = random.Random(sum(ord(c) * (i + 1) for i, c in enumerate(name)) + lod * 7919)
    parts = []
    blooms = 4 if lod == 0 else 3
    for k in range(blooms):
        a = k / blooms * math.pi * 2 + rnd.uniform(-0.5, 0.5)
        r = 0.0 if k == 0 else rnd.uniform(0.03, 0.09)
        base = Vector((math.cos(a) * r, math.sin(a) * r, 0))
        lean = Vector((math.cos(a), math.sin(a), 0)) * rnd.uniform(0.02, 0.07)
        hk = 1.0 if k == 0 else rnd.uniform(0.7, 1.05)
        size = 1.75 if k == 0 else rnd.uniform(1.35, 1.7)
        parts += flower_bloom(f, rnd, base, hk, size, lean, lod)
    # basal rosette of strap leaves
    leaves = 5 if lod == 0 else 4
    for k in range(leaves):
        bm = bmesh.new()
        a = k / leaves * math.pi * 2 + rnd.uniform(-0.3, 0.3)
        L = f["h"] * rnd.uniform(0.35, 0.55)
        pts = []
        for st in range(6):
            t = st / 5
            w = math.sin(t * math.pi) ** 0.8 * 0.016
            z = t * L * 0.55 - t * t * L * 0.38
            pts.append((Vector((t * L, w, z)), Vector((t * L, -w, z))))
        rows = [(bm.verts.new(p_[0]), bm.verts.new(p_[1])) for p_ in pts]
        for st in range(5):
            bm.faces.new((rows[st][0], rows[st][1], rows[st + 1][1], rows[st + 1][0]))
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(a, 3, "Z"))
        leaf = mesh_object("f_leaf", bm)
        g = rnd.uniform(0.85, 1.1)
        set_colors(leaf, lambda co, n_: (0.17 * g, 0.38 * g, 0.11 * g, min(1, co.z / f["h"]) * 0.5))
        parts.append(leaf)
    obj = join(parts, f"flower_{name}_lod{lod}")
    shade_smooth(obj)
    return [obj]


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

ONLY_FLOWERS = os.environ.get("ONLY_FLOWERS") == "1"


def main():
    clear_scene()
    built = []
    for lod in (() if ONLY_FLOWERS else (0, 1)):
        for species in ("oak", "linden", "birch", "sakura", "maple", "glow"):
            for variant in (0, 1):
                built += build_tree(species, variant, lod)
        for variant in (0, 1):
            built += build_pine(variant, lod)
            built += build_willow(variant, lod)
            built += build_bush("bush", ATLAS["broad"], hexcol("#4f7f33"), variant, lod)
            built += build_bush("blossombush", ATLAS["blossom"], hexcol("#f2b6cf"), variant, lod, radius=0.8, height=0.85)
            built += build_fern(variant, lod)
            built += build_boulder(variant, lod)
            built += build_stones(variant, lod)
        built += build_log(0, lod)
        for variant in range(3):
            built += build_mushrooms(variant, lod)
        built += build_reeds(0, lod)
        built += build_lily(0, lod)
        built += build_lily(1, lod)
    for name, f in FLOWERS.items():
        built += build_flower(name, f, 0)

    # one placeholder material per kind so the exporter keeps vertex colours
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        obj.data.materials.clear()
        tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        obj["tris"] = tris

    total = sum(o["tris"] for o in bpy.context.scene.objects if o.type == "MESH")
    for o in sorted(bpy.context.scene.objects, key=lambda o: o.name):
        if o.type == "MESH":
            print(f"  {o.name:36s} {o['tris']:6d} tris")
    print("TOTAL tris", total, "objects", len(bpy.context.scene.objects))

    bpy.ops.export_scene.gltf(
        filepath=OUT.replace("vegetation.glb", "flowers.glb") if ONLY_FLOWERS else OUT,
        export_format="GLB",
        export_normals=True,
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_materials="NONE",
        export_yup=True,
        export_apply=True,
        export_extras=False,
    )
    print("exported", OUT.replace("vegetation.glb", "flowers.glb") if ONLY_FLOWERS else OUT)

    if PREVIEW:
        preview()


def preview():
    """Quick turntable-free lineup render for visual QA (workbench, vertex colours)."""
    scene = bpy.context.scene
    x = 0
    for o in sorted([o for o in scene.objects if o.type == "MESH" and "_lod0" in o.name and not o.name.startswith("flower")], key=lambda o: o.name):
        base = o.name.replace("_leaves", "")
        o.location.x = sorted(set(p.name.replace("_leaves", "") for p in scene.objects if "_lod0" in p.name and not p.name.startswith("flower"))).index(base) * 5.5
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    link(cam)
    scene.camera = cam
    cam.location = (60, -95, 22)
    cam.rotation_euler = (math.radians(78), 0, math.radians(0))
    cam.data.lens = 24
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "VERTEX"
    scene.render.resolution_x = 2400
    scene.render.resolution_y = 900
    scene.render.filepath = "/tmp/qa/vegetation_preview.png"
    bpy.ops.render.render(write_still=True)


main()
