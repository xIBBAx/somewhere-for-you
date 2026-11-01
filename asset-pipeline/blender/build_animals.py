"""
Wildlife for the explorer's endless world — realistic anatomy, skinned and exportable.

    blender -b --factory-startup --python asset-pipeline/blender/build_animals.py
    GAME_PREVIEW=1 ...   (also writes /tmp/explorer-animals-preview/<species>.png)

Exports public/assets/animals/<species>.glb for cat, rabbit, deer, fox, duck.
One armature + one skinned body mesh per file.

Bone names/hierarchy are a hard contract with src/world/wildlife/QuadrupedAnimator
and src/game/rig/RigPoser and must not change:

  root hips spine chest neck head earL earR eyeL eyeR tail1 tail2 tail3
  legF{L,R}1..3  legB{L,R}1..3          duck: wingL wingR, no front legs

Optional bones (added for expression; the runtime checks for them):
  jaw tongue            lower jaw split along the mouth line + tongue
  pupil{L,R}            child of eye{L,R}; scale X to narrow, X/Z to dilate
  whisker{L,R}          mystacial whiskers per side (cat, fox, rabbit)
  leg{F,B}{L,R}4        digits; flex, spread, knead (digitigrade species)
  tail4..tailN          longer tails (cat, fox: 6 segments)

Leg convention (unchanged): the two-bone IK chain is <leg>1 -> <leg>2 and
<leg>3's HEAD is the paw target that the runtime plants on the ground, so
<leg>3 is the pastern/cannon running from the joint down to the toes.

Vertex colour masks (consumed by src/world/wildlife/animalAssets.ts):
  R = shading      (darker along the spine, paler ventrally)
  G = light mask   (belly, chest bib, throat, muzzle, socks, tail tip)
  B = pattern mask (mackerel stripes, flank spots, blaze, wing bars)
  A = literal flag (1 -> use mask.rgb; eyes, nose, beak, claws, hooves)

Animals face -Y in Blender (= +Z in three.js); origin on the ground between
the feet.
"""
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector, noise
from mathutils.bvhtree import BVHTree

OUT_DIR = os.environ.get("GAME_OUT", "public/assets/animals")
PREVIEW_DIR = os.environ.get("GAME_PREVIEW_DIR", "/tmp/explorer-animals-preview")

# Metaball calibration: element_size == radius * MB_K reproduces `radius` at
# threshold 0.6 / stiffness 2.0 (verified empirically for all three axes).
MB_K = 1.74
MB_THR = 0.6
MB_STIFF = 2.0


# ---------------------------------------------------------------------------
# object helpers
# ---------------------------------------------------------------------------

def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"


def mesh_from_bm(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return smooth(link(bpy.data.objects.new(name, me)))


def apply_mods(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg), depsgraph=dg)
    name = obj.name
    old = obj.data
    bpy.data.objects.remove(obj, do_unlink=True)
    if old.users == 0:
        try:
            bpy.data.meshes.remove(old)
        except TypeError:
            bpy.data.metaballs.remove(old)
    me.name = name
    return link(bpy.data.objects.new(name, me))


def smooth(obj):
    for p in obj.data.polygons:
        p.use_smooth = True
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


def armature(bones, up=()):
    """`up`: bones whose roll is set so their local Z is world up. A bone
    pointing almost straight down -Y has an unstable roll-0 frame, which
    tilts the pupil slit the runtime makes by scaling the pupil bone's X."""
    data = bpy.data.armatures.new("rig")
    rig = link(bpy.data.objects.new("rig", data))
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for name, (h, t, parent) in bones.items():
        b = data.edit_bones.new(name)
        b.head = Vector(h)
        b.tail = Vector(t)
        b.roll = 0.0
        if name in up:
            b.align_roll(Vector((0, 0, 1)))
        if parent:
            b.parent = data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


# ---------------------------------------------------------------------------
# continuous body mass
# ---------------------------------------------------------------------------

def metaball(name, elements, res=0.017, sub=0, rough=0.0, rough_size=0.08):
    """One continuous organic mass from overlapping ellipsoidal elements.

    elements: [(Vector centre, (rx, ry, rz)), ...] in final model units.
    rough:    amplitude of a noise displacement that breaks the glassy
              metaball surface into fur clumps (0 disables).
    """
    mb = bpy.data.metaballs.new(name)
    mb.resolution = res
    mb.render_resolution = res
    mb.threshold = MB_THR
    obj = link(bpy.data.objects.new(name, mb))
    for c, r in elements:
        e = mb.elements.new()
        e.co = Vector(c)
        e.type = "ELLIPSOID"
        e.size_x, e.size_y, e.size_z = (r[i] * MB_K for i in range(3))
        e.radius = 1.0
        e.stiffness = MB_STIFF
    obj.update_tag()
    obj = apply_mods(obj)
    if rough > 0.0:
        tex = bpy.data.textures.new(name + "_noise", type="CLOUDS")
        tex.noise_scale = rough_size
        m = obj.modifiers.new("fur", "DISPLACE")
        m.texture = tex
        m.texture_coords = "LOCAL"
        m.mid_level = 0.5
        m.strength = rough
        obj = apply_mods(obj)
    if sub > 0:
        m = obj.modifiers.new("sub", "SUBSURF")
        m.levels = sub
        m.render_levels = sub
        obj = apply_mods(obj)
    return smooth(obj)


# ---------------------------------------------------------------------------
# lofted limb / tail sweeps
# ---------------------------------------------------------------------------

def catmull(points, per_seg=4):
    """Catmull-Rom polyline through `points`."""
    pts = [Vector(p) for p in points]
    if len(pts) < 3:
        return pts
    pts = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
    out = []
    for i in range(len(pts) - 3):
        p0, p1, p2, p3 = pts[i], pts[i + 1], pts[i + 2], pts[i + 3]
        for s in range(per_seg):
            t = s / per_seg
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t +
                              (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
                              (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(Vector(points[-1]))
    return out


def catmull_scalar(values, per_seg=4):
    if len(values) < 3:
        values = list(values) * 3
    pts = [values[0] * 2 - values[1]] + list(values) + [values[-1] * 2 - values[-2]]
    out = []
    for i in range(len(pts) - 3):
        p0, p1, p2, p3 = pts[i], pts[i + 1], pts[i + 2], pts[i + 3]
        for s in range(per_seg):
            t = s / per_seg
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t +
                              (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
                              (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(values[-1])
    return out


def roughen(obj, amount, size=0.05, seed=0.0):
    """Displace with clouds noise so a lofted tube reads as fur, not plastic."""
    if amount <= 0.0:
        return obj
    tex = bpy.data.textures.new(obj.name + "_fur", type="CLOUDS")
    tex.noise_scale = size
    m = obj.modifiers.new("fur", "DISPLACE")
    m.texture = tex
    m.texture_coords = "LOCAL"
    m.mid_level = 0.5
    m.strength = amount * (1.0 + 0.3 * seed)
    return apply_mods(obj)


def sweep(name, controls, radii, segs=10, samples=4, subdiv=1, oval=None, cap=True,
          rough=0.0, rough_size=0.05):
    """Loft an elliptical tube through a spline with a varying radius."""
    path = catmull(controls, samples)
    rads = catmull_scalar(radii, samples)
    if oval:
        rx = catmull_scalar([o[0] for o in oval], samples)
        ry = catmull_scalar([o[1] for o in oval], samples)
        oval = [(rx[i], ry[i]) for i in range(len(path))]
    n = len(path)
    frames = []
    prev = None
    for i, p in enumerate(path):
        if i == 0:
            t = path[1] - path[0]
        elif i == n - 1:
            t = path[-1] - path[-2]
        else:
            t = path[i + 1] - path[i - 1]
        if t.length < 1e-9:
            t = Vector((0, 0, -1))
        t.normalize()
        u = prev if prev is not None else Vector((1, 0, 0))
        u = u - t * u.dot(t)
        if u.length < 1e-6:
            u = Vector((0, 0, 1)) - t * t.z
            if u.length < 1e-6:
                u = Vector((1, 0, 0))
        u.normalize()
        frames.append((p, u, t.cross(u), t))
        prev = u
    bm = bmesh.new()
    rows = []
    for i, (c, u, v, t) in enumerate(frames):
        rx, ry = oval[i] if oval else (rads[i], rads[i])
        row = [bm.verts.new(c + u * (math.cos(2 * math.pi * k / segs) * rx) +
                            v * (math.sin(2 * math.pi * k / segs) * ry)) for k in range(segs)]
        rows.append(row)
    bm.verts.ensure_lookup_table()
    for a, b in zip(rows, rows[1:]):
        for k in range(segs):
            j = (k + 1) % segs
            try:
                bm.faces.new((a[k], a[j], b[j], b[k]))
            except ValueError:
                pass
    if cap:
        for end, rev in ((rows[0], True), (rows[-1], False)):
            try:
                bm.faces.new(list(reversed(end)) if rev else end)
            except ValueError:
                pass
    obj = mesh_from_bm(name, bm)
    if subdiv:
        m = obj.modifiers.new("sub", "SUBSURF")
        m.levels = subdiv
        m.render_levels = subdiv
        obj = apply_mods(obj)
    return smooth(roughen(obj, rough, rough_size))


def ellipsoid(name, center, radii, segs=(16, 10)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs[0], v_segments=segs[1], radius=1.0)
    c = Vector(center)
    for v in bm.verts:
        v.co = Vector((v.co.x * radii[0], v.co.y * radii[1], v.co.z * radii[2])) + c
    return mesh_from_bm(name, bm)


def blob(name, center, radii, jag=0.0, seed=0.0, freq=26.0, segs=(16, 10)):
    """Ellipsoid with low-frequency lumpiness — fur clumps, haunches, cheeks."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs[0], v_segments=segs[1], radius=1.0)
    c = Vector(center)
    off = Vector((seed * 2.7, seed * 1.3, -seed * 0.9))
    for v in bm.verts:
        p = Vector((v.co.x * radii[0], v.co.y * radii[1], v.co.z * radii[2]))
        if jag:
            p *= 1.0 + jag * noise.noise(p * freq + off)
        v.co = p + c
    return mesh_from_bm(name, bm)


# ---------------------------------------------------------------------------
# ears, eyes, feet
# ---------------------------------------------------------------------------

def ear_leaf(name, base, height, width, depth, tilt, side, cup=0.5, rows=8, ring=12, tip=0.0, point=0.0):
    """Cupped leaf ear: rounded base, tapered tip, hollow front, thin rim.

    `point` (0..1) blends the leaf toward a broad-based triangle, the shape
    of a cat's or fox's pinna.
    """
    bm = bmesh.new()
    rings = []
    for r in range(rows + 1):
        t = r / rows
        shape = math.sin(math.pi * min(1.0, (1.0 - t) * 0.72 + 0.28)) ** 0.55
        leaf = shape * (1.0 - t * 0.86)
        tri = (1.0 - t) ** 1.15 * (0.92 + 0.08 * math.sin(math.pi * t))
        w = width * (leaf * (1.0 - point) + tri * point) + width * (0.10 - 0.05 * point)
        d = depth * (1.0 - t * 0.72)
        z = t * height - tip * t * t
        row = []
        for k in range(ring):
            a = 2 * math.pi * k / ring
            yy = math.sin(a) * d
            if yy < 0:
                yy *= (1.0 - cup)
            row.append(bm.verts.new((math.cos(a) * w, yy, z)))
        rings.append(row)
    bm.verts.ensure_lookup_table()
    for a, b in zip(rings, rings[1:]):
        for k in range(ring):
            j = (k + 1) % ring
            try:
                bm.faces.new((a[k], a[j], b[j], b[k]))
            except ValueError:
                pass
    apex = bm.verts.new((0, -depth * 0.2 * cup, height * 1.04 - tip))
    root = bm.verts.new((0, 0, -height * 0.05))
    for k in range(ring):
        j = (k + 1) % ring
        for tri in ((rings[-1][k], rings[-1][j], apex), (rings[0][j], rings[0][k], root)):
            try:
                bm.faces.new(tri)
            except ValueError:
                pass
    obj = mesh_from_bm(name, bm)
    obj.data.transform(Matrix.Rotation(tilt[0], 4, "X"))
    obj.data.transform(Matrix.Rotation(side * tilt[1], 4, "Y"))
    obj.data.transform(Matrix.Rotation(side * tilt[2], 4, "Z"))
    obj.data.transform(Matrix.Translation(base))
    return obj


def eye_basis(normal):
    n = Vector(normal).normalized()
    up = Vector((0, 0, 1))
    if abs(n.dot(up)) > 0.94:
        up = Vector((0, 1, 0))
    u = n.cross(up).normalized()
    return n, u, n.cross(u)


def eyeball(name, centre, radius, normal, segs=14, rings=10):
    """Full sphere; it is pushed into the skull so only a corneal cap shows."""
    n, u, v = eye_basis(normal)
    c = Vector(centre)
    bm = bmesh.new()
    rows = []
    for r in range(rings + 1):
        phi = math.pi * r / rings
        rr = radius * math.sin(phi)
        z = radius * math.cos(phi)
        rows.append([bm.verts.new(c + u * (math.cos(2 * math.pi * k / segs) * rr) +
                                  v * (math.sin(2 * math.pi * k / segs) * rr) + n * z)
                     for k in range(segs)])
    bm.verts.ensure_lookup_table()
    for a, b in zip(rows, rows[1:]):
        for k in range(segs):
            j = (k + 1) % segs
            try:
                bm.faces.new((a[k], a[j], b[j], b[k]))
            except ValueError:
                pass
    return mesh_from_bm(name, bm)


def eye_disc(name, centre, normal, radius, segs=14, squash=1.0):
    n, u, v = eye_basis(normal)
    c = Vector(centre)
    bm = bmesh.new()
    hub = bm.verts.new(c)
    rim = [bm.verts.new(c + u * (math.cos(2 * math.pi * k / segs) * radius) +
                        v * (math.sin(2 * math.pi * k / segs) * radius * squash))
           for k in range(segs)]
    bm.verts.ensure_lookup_table()
    for k in range(segs):
        try:
            bm.faces.new((rim[k], rim[(k + 1) % segs], hub))
        except ValueError:
            pass
    return mesh_from_bm(name, bm)


def foot(name, joint, toe_dir, span, width, height, toe_r, toes=4, claw=None):
    """Compact carnivore/rodent paw: a wrist pad merging into short toes.

    The toes start inside the pad so the paw reads as one continuous mass
    hanging off the pastern rather than a comb of loose digits.
    """
    joint = Vector(joint)
    d = Vector(toe_dir).normalized()
    side = Vector((-d.z, 0, d.x)) if abs(d.x) > 1e-4 else Vector((1, 0, 0))
    side.normalize()
    parts = [blob(name + "_pad", joint + d * (span * 0.14),
                  (width, span * 0.40, max(height, toe_r * 1.25)), segs=(8, 5))]
    for i in range(toes):
        f = (i - (toes - 1) * 0.5) / max(1, (toes - 1) * 0.5) if toes > 1 else 0.0
        off = side * (f * width * 0.50)
        base = joint - d * (span * 0.10) + off
        end = base + d * (span * 0.62)
        r = toe_r * (1.0 - 0.14 * abs(f))
        # the claw is the tapered tail of the same tube: keratin reads as a
        # colour change on the tip rather than another piece of geometry
        ctrl = [base, base.lerp(end, 0.6), end]
        rads = [r, r * 0.94, r * 0.72]
        if claw:
            ctrl.append(end + d * (span * 0.11))
            rads.append(r * 0.06)
        parts.append(sweep(name + "_t%d" % i, ctrl, rads, segs=5, samples=2, subdiv=0))
    return join(parts, name)


def digit_paw(name, ball, width, length, height, toes=4, fwd=(0.0, -1.0, -0.10), claw=False):
    """Digitigrade paw (cat, fox, rabbit): a round palmar pad that the
    pastern stands on, with the toes lying forward along the ground.

    `ball` is the bottom of the pastern. The paw is built so its sole rests
    on z = 0, toes pointing forward (-Y), which is how a cat actually stands;
    the old paw continued the pastern's downward line and read as a hoof.
    """
    ball = Vector(ball)
    d = Vector(fwd).normalized()
    side = Vector((1, 0, 0))
    pad_c = Vector((ball.x, ball.y + d.y * length * 0.10, height * 0.92))
    parts = [blob(name + "_pad", pad_c, (width * 0.98, length * 0.46, height), segs=(10, 6))]
    # pastern joins the pad from above so the leg flows into the paw
    parts.append(sweep(name + "_heel", [ball + Vector((0, 0, height * 0.6)), pad_c + Vector((0, 0, height * 0.25))],
                       [width * 0.62, width * 0.80], segs=6, samples=1, subdiv=0))
    for i in range(toes):
        f = (i - (toes - 1) * 0.5) / max(1, (toes - 1) * 0.5) if toes > 1 else 0.0
        # toes fan on an arc: the outer two sit a little further back
        c = pad_c + side * (f * width * 0.56) + d * (length * (0.40 - 0.10 * f * f))
        c.z = height * 0.62
        bean = blob(name + "_t%d" % i, c, (width * 0.34, length * 0.26, height * 0.68), segs=(8, 5))
        parts.append(bean)
        if claw:
            tip = c + d * (length * 0.24) + Vector((0, 0, -height * 0.3))
            parts.append(sweep(name + "_claw%d" % i, [c + d * (length * 0.12), tip], [width * 0.10, width * 0.02],
                               segs=4, samples=1, subdiv=0))
    return join(parts, name)


def mouth_plane(S):
    """Mouth line on the midline: front (under the nose) and corner points."""
    m = S["mouth"]
    F = Vector(m["front"])
    C = Vector(m["corner"])
    L = C - F
    n = Vector((0.0, -L.z, L.y)).normalized()  # points up out of the lower jaw
    return F, C, n


def split_mouth(body, S):
    """Cut the lips apart along the mouth line and weight the lower jaw.

    The body is one closed metaball skin, so a jaw bone alone would only
    stretch it. Here the faces in front of the mouth corners are bisected on
    the mouth plane and the cut edges are split, so the lower lip separates
    from the upper one and the jaw can actually open. The corners stay joined,
    exactly like a real mouth. A float attribute `jaw_w` carries how much each
    vertex follows the jaw; `bind()` blends it with the distance weights.
    """
    F, C, n = mouth_plane(S)
    m = S["mouth"]
    me = body.data
    bm = bmesh.new()
    bm.from_mesh(me)
    band = m.get("band", 0.014)
    faces = [f for f in bm.faces
             if f.calc_center_median().y < C.y and abs((f.calc_center_median() - F).dot(n)) < band]
    geom = list({v for f in faces for v in f.verts}) + list({e for f in faces for e in f.edges}) + faces
    res = bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=F, plane_no=n)
    cut = [e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge)
           and all(v.co.y < C.y - 1e-5 for v in e.verts)]
    bmesh.ops.split_edges(bm, edges=cut)
    bm.verts.ensure_lookup_table()
    w = []
    behind = m.get("fade", 0.014)
    for v in bm.verts:
        # side of the mouth line: use the linked faces so the duplicated lip
        # verts on the cut itself land on the lip they belong to
        if v.link_faces:
            side = sum((f.calc_center_median() - F).dot(n) for f in v.link_faces) / len(v.link_faces)
        else:
            side = (v.co - F).dot(n)
        below = side < 0.0
        k = sstep(C.y + behind, C.y - 0.004, v.co.y) if below else 0.0
        # the throat under the skull follows the jaw only a little
        if below and (v.co - F).dot(n) < -m.get("depth", 0.03):
            k *= 0.4
        w.append(k)
    bm.to_mesh(me)
    bm.free()
    attr = me.attributes.new(name="jaw_w", type="FLOAT", domain="POINT")
    for i, k in enumerate(w):
        attr.data[i].value = k
    return body


def mouth_parts(S, parts):
    """Palate, mouth floor, throat, tongue and fangs inside the muzzle.

    They are hidden while the mouth is shut and fill the opening when it is
    not, so a yawn or a meow shows a real pink mouth instead of the inside of
    a hollow head.
    """
    F, C, n = mouth_plane(S)
    m = S["mouth"]
    hw = m["half_w"]
    span = C.y - F.y
    mid = (F + C) * 0.5
    up = n
    pal = blob("mouth_palate", mid + up * 0.0025 + Vector((0, span * 0.06, 0)), (hw * 0.72, span * 0.44, 0.0045), segs=(10, 6))
    rig_part(pal, 1)
    floor = blob("mouth_floor", mid - up * 0.0035 + Vector((0, span * 0.08, 0)), (hw * 0.70, span * 0.42, 0.0045), segs=(10, 6))
    rig_part(floor, 6)
    throat = blob("mouth_throat", Vector((0, C.y + 0.002, C.z)) , (hw * 0.55, span * 0.20, m.get("throat_r", 0.008)), segs=(8, 6))
    rig_part(throat, 1)
    tongue = blob("tongue", mid - up * 0.0012 + Vector((0, span * 0.04, 0)), (hw * 0.46, span * 0.40, 0.0026), segs=(10, 6))
    rig_part(tongue, 7)
    parts += [pal, floor, throat, tongue]
    if m.get("fangs"):
        fl = m["fangs"]
        for s in (1, -1):
            top = Vector((s * fl, F.y + span * 0.26, F.z + 0.0030))
            parts.append(sweep("fangU%d" % (s > 0), [top, top - up * 0.0052], [0.0013, 0.0002], segs=5, samples=1, subdiv=0))
            rig_part(parts[-1], 1)
            bot = Vector((s * fl * 0.8, F.y + span * 0.30, F.z - 0.0034))
            parts.append(sweep("fangL%d" % (s > 0), [bot, bot + up * 0.0045], [0.0011, 0.0002], segs=5, samples=1, subdiv=0))
            rig_part(parts[-1], 6)


def whiskers(S, parts):
    """Mystacial whiskers in rows on each whisker pad, plus brow whiskers.

    Each side is rigid to its own whisker bone so the runtime can fan them
    forward (curious, hunting) or flatten them back (fearful, relaxed).
    """
    wk = S["whiskers"]
    pad = Vector(wk["pad"])
    for side, s in (("L", 1), ("R", -1)):
        base = Vector((pad.x * s, pad.y, pad.z))
        for row in range(wk.get("rows", 3)):
            for k in range(wk.get("per_row", 2)):
                elev = 0.30 - row * 0.26 + k * 0.05
                swing = 0.55 + k * 0.32 - row * 0.05
                L = wk["len"] * (1.0 - row * 0.10 - k * 0.12)
                d = Vector((s * math.cos(swing), -math.sin(swing) * 0.8, math.sin(elev))).normalized()
                root = base + Vector((0, row * 0.0022 + k * 0.002, -row * 0.0030))
                droop = Vector((0, 0.15, -0.35)) * L
                ctrl = [root, root + d * (L * 0.5) + droop * 0.18, root + d * L + droop]
                o = sweep("whisker%s%d%d" % (side, row, k), ctrl, [wk["r"], wk["r"] * 0.55, wk["r"] * 0.12],
                          segs=3, samples=2, subdiv=0, cap=False)
                rig_part(o, 8 if s > 0 else 9)
                parts.append(o)


def hoof(name, joint, toe_dir, span=0.0, width=0.030, height=0.0, toe_r=0.0, toes=0,
         claw=None, hoof=True):
    """Cloven ungulate hoof: two keratin claws with a deep cleft between them."""
    joint = Vector(joint)
    d = Vector(toe_dir).normalized()
    side = Vector((-d.z, 0, d.x)).normalized()
    w = width * 0.5
    parts = []
    for s in (1, -1):
        off = side * (s * w * 0.52)
        parts.append(sweep(name + str(s),
                           [joint + off - d * (span * 0.45 + w * 0.5), joint + off,
                            joint + off + d * (span * 0.8 + w * 0.6)],
                           [height * 0.95, w * 0.56, w * 0.30],
                           segs=5, samples=1, subdiv=0))
    return join(parts, name)


# ---------------------------------------------------------------------------
# vertex colour masks
# ---------------------------------------------------------------------------

def paint(obj, fn):
    me = obj.data
    for a in list(me.color_attributes):
        me.color_attributes.remove(a)
    attr = me.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="CORNER")
    for poly in me.polygons:
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index]
            attr.data[li].color = fn(v.co, v.normal)
    me.color_attributes.active_color = attr
    return obj


RIG_PARTS = {1: "head", 2: "earL", 3: "earR", 4: "eyeL", 5: "eyeR", 6: "jaw", 7: "tongue",
             8: "whiskerL", 9: "whiskerR", 10: "pupilL", 11: "pupilR"}


def rig_part(obj, part):
    # Anatomical ownership survives joining. Literal colours also occur on
    # hooves and claws, so colour alpha must never double as a bone flag.
    attr = obj.data.attributes.new(name="rig_part", type="INT", domain="POINT")
    for v in attr.data:
        v.value = part


def sstep(a, b, x):
    if a == b:
        return 0.0 if x < a else 1.0
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def fbm(p, freq=6.0, octaves=3, seed=0.0):
    v, amp, tot = 0.0, 1.0, 0.0
    for o in range(octaves):
        v += amp * noise.noise(p * (freq * (1.9 ** o)) + Vector((seed * 3.1, seed, -seed * 2.0)))
        tot += amp
        amp *= 0.5
    return v / tot


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (a + ab * t - p).length


def weights(obj, bones, allowed=None, falloff=4.0, rigid=None):
    for g in list(obj.vertex_groups):
        obj.vertex_groups.remove(g)
    groups = {b: obj.vertex_groups.new(name=b) for b in bones}
    names = [b for b in (allowed or bones) if b in bones]
    for v in obj.data.vertices:
        if rigid:
            groups[rigid].add([v.index], 1.0, "REPLACE")
            continue
        scores = sorted(((1.0 / (seg_dist(v.co, Vector(h), Vector(t)) + 0.006) ** falloff, b)
                         for b, (h, t, _) in ((n, bones[n]) for n in names)), reverse=True)
        top = scores[:3]
        tot = sum(s for s, _ in top)
        for s, b in top:
            if s / tot > 0.03:
                groups[b].add([v.index], s / tot, "REPLACE")


# ---------------------------------------------------------------------------
# quadruped assembly
# ---------------------------------------------------------------------------

def quad_leg(name, pts, girth, foot_kw, rough=0.0, bulge=None):
    """Upper limb + cannon as one continuous sweep with real joints.

    pts:    (joint, mid-joint, ankle/hock, toe) — toe is the IK paw target.
    girth:  radius at each of those control points.
    bulge:  optional scale for the hock mass; kept small so the joint reads
            as anatomy rather than a bead.
    """
    pts = [Vector(p) for p in pts]
    controls = [pts[0], pts[0].lerp(pts[1], 0.38), pts[1], pts[1].lerp(pts[2], 0.55), pts[2], pts[3]]
    pastern = (girth[2] * 1.05 if len(girth) < 4 else girth[3] * 1.08)
    radii = [girth[0], girth[0] * 0.80, girth[1], girth[1] * 0.70, girth[2], pastern]
    oval = [(r, r * 1.05) for r in radii]
    limb = sweep(name, controls, [0.0] * len(controls), segs=6, samples=2, subdiv=1,
                 oval=oval, rough=rough, rough_size=girth[0] * 2.0)
    parts = [limb]
    if foot_kw.get("hoof"):
        parts.append(hoof(name + "_hoof", pts[3], (pts[3] - pts[2]).normalized(), **foot_kw))
    elif foot_kw.get("digit"):
        kw = {k: v for k, v in foot_kw.items() if k != "digit"}
        parts.append(digit_paw(name + "_foot", pts[3], **kw))
    else:
        parts.append(foot(name + "_foot", pts[3], (pts[3] - pts[2]).normalized(), **foot_kw))
    return join(parts, name)


def iris_cap(name, c, r, look, theta, col, rim_col, segs=16, rings=5, col_fn=None, alpha=1.0):
    """Iris as a spherical cap hugging the front of the eyeball.

    A disc inside the ball (the old build) is hidden by the opaque cornea,
    which is why the eyes read as black buttons. The cap sits just outside
    the ball and is painted with a bright stroma that darkens to a limbal
    ring at its edge.
    """
    n, u, v = eye_basis(look)
    bm = bmesh.new()
    hub = bm.verts.new(c + n * (r * 1.004))
    rows = []
    for k in range(1, rings + 1):
        a = theta * k / rings
        rows.append([bm.verts.new(c + (n * math.cos(a) + (u * math.cos(2 * math.pi * j / segs) +
                                                          v * math.sin(2 * math.pi * j / segs)) * math.sin(a)) * (r * 1.004))
                     for j in range(segs)])
    for j in range(segs):
        bm.faces.new((hub, rows[0][j], rows[0][(j + 1) % segs]))
    for a_, b_ in zip(rows, rows[1:]):
        for j in range(segs):
            jj = (j + 1) % segs
            bm.faces.new((a_[j], b_[j], b_[jj], a_[jj]))
    obj = mesh_from_bm(name, bm)

    def fn(co, nv):
        t = min(1.0, (co - c).normalized().angle(n) / theta)
        if col_fn:
            d = (co - c).normalized()
            ang = math.atan2(d.dot(v), d.dot(u))
            rgb = col_fn(t, ang)
            return (rgb[0], rgb[1], rgb[2], alpha)
        k = (1.18 - 0.45 * t * t) * (1.0 - 0.75 * sstep(0.78, 1.0, t))
        ring = 0.5 + 0.5 * math.sin(((co - c).normalized().dot(u) * 40.0))
        k *= 0.92 + 0.08 * ring
        return (col[0] * k, col[1] * k, col[2] * k, 1.0)
    paint(obj, fn)
    obj["prepainted"] = True
    return obj


def lid_ring(name, c, r, look, theta, squash, col, thick=0.085):
    """Dark lid margin framing the eye: hides the ball's edge, gives the
    almond shape and reads as the black 'eyeliner' cats and foxes have."""
    n, u, v = eye_basis(look)
    pts = []
    seg = 16
    for j in range(seg + 1):
        a = 2 * math.pi * j / seg
        d = n * math.cos(theta) + (u * math.cos(a) + v * math.sin(a) * squash) * math.sin(theta)
        pts.append(c + d.normalized() * (r * 1.02))
    o = sweep(name, pts, [r * thick] * len(pts), segs=5, samples=1, subdiv=0, cap=False)
    paint(o, lambda co, nv: tuple(col) + (1.0,))
    o["prepainted"] = True
    return o


def eye_normal(S, s):
    """Outward axis of the eyeball. `eye_n` decouples it from the eye's
    position (a cat's eyes face forward although they sit wide apart)."""
    if S.get("eye_n"):
        e = S["eye_n"]
        return Vector((s * e[0], e[1], e[2])).normalized()
    return Vector((s * S["eye_x"], -S["eye_fwd"], S["eye_z"])).normalized()


def eye_set(S, side, s, parts):
    """Eye ball seated in the skull socket: iris cap, pupil, catchlight, lids."""
    head = Vector(S["head"])
    n = eye_normal(S, s)
    r = S["eye_r"]
    # sink the ball so only the corneal cap shows; the bone stays put
    c = head + Vector((s * S["eye_x"] * S.get("eye_dx", 1.0), S["eye_y"], S["eye_z"])) - n * (r * S.get("eye_sink", 0.0))
    # wet, glossy eye surfaces carry alpha 0.75: literal colour + low roughness
    gloss = 0.75 if S.get("eye_gloss") else 1.0
    ball = eyeball("eye" + side, c, r, n, segs=S.get("eye_segs", 14), rings=S.get("eye_rings", 10))
    look = pupil_axis(S, s)
    theta = S.get("iris_theta", 0.80)
    if S.get("iris_fn"):
        iris = iris_cap("iris" + side, c, r, look, theta, S["iris"], (0.02, 0.02, 0.02),
                        segs=32, rings=9, col_fn=S["iris_fn"], alpha=gloss)
    else:
        iris = iris_cap("iris" + side, c, r, look, theta, S["iris"], (0.02, 0.02, 0.02))
    # pupil: a flat disc on the corneal pole so its bone can narrow it to a
    # slit (cats in sunlight) or open it wide (dusk, play, fear)
    pupil = eye_disc("pupil" + side, c + look * (r * 1.016), look, r * S["pupil"],
                     segs=S.get("pupil_segs", 14), squash=S.get("pupil_squash", 1.0))
    _, gu, gv = eye_basis(look)
    g = S.get("glint", (0.34, 0.22, 0.15))
    glint = eye_disc("glint" + side, c + look * (r * 1.024) + gv * (r * g[0]) - gu * (s * r * g[1]), look,
                     r * g[2], segs=S.get("glint_segs", 6))
    extra = []
    if S.get("glint2"):
        g2 = S["glint2"]
        extra.append(eye_disc("glint2" + side, c + look * (r * 1.022) + gv * (r * g2[0]) - gu * (s * r * g2[1]), look,
                              r * g2[2], segs=6))
    lids = lid_ring("lid" + side, c, r, look, theta * S.get("lid_k", 1.02), S.get("lid_squash", 0.82),
                    S.get("lid_col", (0.035, 0.028, 0.024)), thick=S.get("lid_thick", 0.085))
    if gloss < 1.0:
        for o in (ball, pupil, glint, *extra):
            o["gloss"] = True
    depth = S.get("eye_depth", 1.0)
    if depth != 1.0:
        for o in (ball, iris, pupil, glint, lids, *extra):
            for v in o.data.vertices:
                rel = v.co - c
                v.co = c + rel + n * (rel.dot(n) * (depth - 1.0))
    for o in (ball, iris, glint, lids, *extra):
        rig_part(o, 4 if s > 0 else 5)
        parts.append(o)
    # the pupil has its own bone so it can dilate and contract in its disc
    rig_part(pupil, 10 if s > 0 else 11)
    parts.append(pupil)
    return c


def pupil_axis(S, s):
    """Gaze direction of the iris/pupil discs (also the pupil bone's axis)."""
    n = eye_normal(S, s)
    return (n + Vector(S.get("gaze_bias", (0, -0.5, 0.10)))).normalized()


def fit_eye_sockets(S, body):
    """Seat the cornea against the generated skull, including mass blending.

    Metaball shoulders/cheeks enlarge the final surface beyond individual
    ellipsoids. Ray fitting prevents an apparently valid eye bone from leaving
    the entire eye underneath that surface. The ball remains mostly recessed.
    """
    head = Vector(S["head"])
    n, look = eye_normal(S, 1), pupil_axis(S, 1)
    target = head + Vector((S["eye_x"] * S.get("eye_dx", 1.0), S["eye_y"], S["eye_z"]))
    hit, point, _, _ = body.ray_cast(target + look * 0.6, -look, distance=1.2)
    if not hit:
        raise RuntimeError("Eye socket ray missed the skull")
    centre = point - look * (S["eye_r"] * 0.55)
    rel = centre - head
    S.update(eye_x=rel.x, eye_y=rel.y, eye_z=rel.z, eye_dx=1.0, eye_sink=0.0,
             eye_n=tuple(n))


def quadruped(spec):
    S = spec
    body = metaball("body", S["mass"], res=S["mres"], rough=S.get("rough", 0.0),
                    rough_size=S.get("rough_size", 0.06))
    if S.get("fit_eyes"):
        fit_eye_sockets(S, body)
        S["bones"] = bones_for(S)
    if S.get("mouth"):
        split_mouth(body, S)
    parts = [body]
    if S.get("mouth"):
        mouth_parts(S, parts)
    if S.get("whiskers"):
        whiskers(S, parts)
    for side, s in (("L", 1), ("R", -1)):
        eye_set(S, side, s, parts)
    if S.get("nose_taper"):
        parts.append(cat_nose(S))
    else:
        parts.append(blob("nose", Vector(S["nose"]), S["nose_r"], jag=S.get("nose_jag", 0.0), segs=(10, 7)))
    # nose + ears are rigid to the head bone
    for o in parts:
        if o.name in ("nose",):
            rig_part(o, 1)
    coat = S["coat_fn"](S) if S.get("coat_fn") else None
    for side, s in (("L", 1), ("R", -1)):
        if S.get("pinna"):
            parts += cat_ear(S, side, s, coat)
            continue
        e = ear_leaf("ear" + side,
                     Vector(S["head"]) + Vector((s * S["ear_x"], S["ear_y"], S["ear_z"])),
                     S["ear_h"], S["ear_w"], S["ear_d"], S["ear_tilt"], s,
                     cup=S.get("ear_cup", 0.5), tip=S.get("ear_tip", 0.0), point=S.get("ear_point", 0.0))
        rig_part(e, 2 if s > 0 else 3)
        parts.append(e)
    for side, s in (("L", 1), ("R", -1)):
        for tag in ("F", "B"):
            pts = [Vector((p[0] * s, p[1], p[2])) for p in S["fl" if tag == "F" else "bl"]]
            g = S["fl_g" if tag == "F" else "bl_g"]
            fk = S["fl_foot" if tag == "F" else "bl_foot"]
            parts.append(quad_leg("leg%s%s" % (tag, side), pts, g, fk,
                                  rough=S.get("leg_rough", 0.0),
                                  bulge=S.get("hock_bulge") if tag == "B" else None))
    if S.get("tail"):
        tw = S["tail"]
        path = [Vector(p) for p in tw["path"]]
        if len(path) == 1:  # scut (rabbit): a single stuffed puff
            path = [path[0] + Vector((0, -0.006, -0.004)), path[0]]
        radii = list(tw["r"]) if len(tw["r"]) == len(path) else [tw["r"][0]] * len(path)
        parts.append(sweep("tail", path, radii, segs=tw.get("segs", 7), samples=3, subdiv=1,
                           rough=tw.get("rough", 0.0), rough_size=tw["r"][0] * 2.4))
    if S.get("tufts"):
        # long-hair silhouette: clumps rooted on the finished skin
        tail = next((o for o in parts if o.name == "tail"), None)
        parts += S["tufts"](S, body, tail, coat)

    paint_all(parts, S, fn=coat)
    mesh = join(parts, "body")
    return mesh, bind(mesh, S["bones"], S)


# ---------------------------------------------------------------------------
# The cat: pinnae, nose leather, long-hair clumps and the tabby coat
#
# Only CAT uses these (through spec hooks), so the other species build exactly
# as before.
# ---------------------------------------------------------------------------

def set_point_attr(obj, name, kind, value):
    a = obj.data.attributes.get(name) or obj.data.attributes.new(name=name, type=kind, domain="POINT")
    for d in a.data:
        if kind == "FLOAT_VECTOR":
            d.vector = value
        else:
            d.value = value


def cat_nose(S):
    """Nose leather: a rounded triangle, broad on top and drawn to a point
    over the philtrum, with a soft bevel instead of a ball."""
    c = Vector(S["nose"])
    rx, ry, rz = S["nose_r"]
    o = blob("nose", c, (rx, ry, rz), segs=(14, 9))
    for v in o.data.vertices:
        rel = v.co - c
        k = max(-1.0, min(1.0, rel.z / rz))
        taper = 0.42 + 0.58 * ((k + 1.0) * 0.5) ** 0.7
        v.co.x = c.x + rel.x * taper
        # flatter on top, the leather tilts forward and down
        if k > 0.2:
            v.co.z = c.z + rz * (0.2 + (k - 0.2) * 0.65)
        v.co.y = c.y + rel.y - (k * 0.0012)
    return o


def cat_ear(S, side, s, coat):
    """A cat's pinna: a thin cupped shell, broad at the base and drawn to a
    gently rounded tip, opening forward. The inner skin is pink, the rim
    and back are coat; pale furnishings fan out of the cup and a lynx tuft
    tips the ear (the cat is a semi-long-haired tabby)."""
    head = Vector(S["head"])
    base = head + Vector((s * S["ear_x"], S["ear_y"], S["ear_z"]))
    H, W, D, th = S["ear_h"], S["ear_w"], S["ear_d"], S.get("ear_th", 0.0016)
    tilt = S["ear_tilt"]
    NV, NU = 12, 11

    def outer(t, u):
        w = W * (1.0 - t) ** 0.78 * (1.0 - 0.10 * t) + W * 0.05
        d = D * (1.0 - t) ** 0.55 + 0.0012
        y = d * (1.0 - u * u) ** 0.9 - 0.20 * d * u ** 4
        return Vector((w * u, y, -0.006 + t * (H + 0.006)))

    def inner(t, u):
        p = outer(t, u)
        w = W * (1.0 - t) ** 0.78 * (1.0 - 0.10 * t) + W * 0.05
        q = Vector((p.x * max(0.0, (w - th * 0.9)) / w, p.y - th, p.z))
        return q

    xf = (Matrix.Translation(base) @ Matrix.Rotation(s * tilt[2], 4, "Z") @
          Matrix.Rotation(s * tilt[1], 4, "Y") @ Matrix.Rotation(tilt[0], 4, "X"))
    ts = [i / NV for i in range(NV + 1)]
    us = [-1.0 + 2.0 * j / NU for j in range(NU + 1)]

    bm = bmesh.new()
    O = [[bm.verts.new(xf @ outer(t, u)) for u in us] for t in ts]
    Ir = [[bm.verts.new(xf @ inner(t, u)) for u in us] for t in ts]
    for i in range(NV):
        for j in range(NU):
            bm.faces.new((O[i][j], O[i + 1][j], O[i + 1][j + 1], O[i][j + 1]))
    for i in range(NV):
        bm.faces.new((O[i][0], Ir[i][0], Ir[i + 1][0], O[i + 1][0]))
        bm.faces.new((O[i][NU], O[i + 1][NU], Ir[i + 1][NU], Ir[i][NU]))
    for j in range(NU):
        bm.faces.new((O[NV][j], Ir[NV][j], Ir[NV][j + 1], O[NV][j + 1]))
    shell = mesh_from_bm("pinnaO" + side, bm)
    paint(shell, coat)
    shell["prepainted"] = True

    bm = bmesh.new()
    I2 = [[bm.verts.new(xf @ inner(t, u)) for u in us] for t in ts]
    for i in range(NV):
        for j in range(NU):
            bm.faces.new((I2[i][j], I2[i][j + 1], I2[i + 1][j + 1], I2[i + 1][j]))
    cup = mesh_from_bm("pinnaI" + side, bm)
    skin = S.get("ear_skin", (0.60, 0.30, 0.24))
    # the skin is pinkest deep in the cup and picks up coat colour at the rim
    rim_tint = S.get("ear_rim", (0.55, 0.24, 0.12))

    def cup_col(co, nv):
        loc = xf.inverted() @ co
        t = max(0.0, min(1.0, loc.z / H))
        w = W * (1.0 - t) ** 0.78 * (1.0 - 0.10 * t) + W * 0.05
        u = abs(loc.x) / max(1e-6, w)
        k = sstep(0.55, 1.0, max(u, t * 0.9))
        return tuple(skin[i] * (1 - k) + rim_tint[i] * k for i in range(3)) + (1.0,)
    paint(cup, cup_col)
    cup["prepainted"] = True

    parts = [shell, cup]
    pale = S.get("furnish_mask", (0.92, 0.80, 0.0, 0.0))
    # furnishings: fine pale hair that fans out of the cup
    k = 0
    for t, u, L in ((0.10, -0.55, 0.026), (0.12, -0.15, 0.030), (0.12, 0.25, 0.028), (0.16, 0.6, 0.024),
                    (0.26, -0.40, 0.024), (0.28, 0.05, 0.026), (0.30, 0.45, 0.022), (0.42, -0.2, 0.018),
                    (0.44, 0.25, 0.017)):
        b = inner(t, u) + Vector((0, -0.0006, 0))
        d = Vector((u * 0.30, -0.22, 1.0)).normalized()
        L *= 0.62
        ctrl = [b, b + d * (L * 0.5) + Vector((0, -0.0015, 0)), b + d * L + Vector((u * 0.002, -0.003, 0))]
        f = sweep("furn%s%d" % (side, k), [xf @ c for c in ctrl], [0.0010, 0.0006, 0.0001],
                  segs=4, samples=2, subdiv=0)
        paint(f, lambda co, nv: pale)
        f["prepainted"] = True
        set_point_attr(f, "lod_drop", "INT", 1)
        parts.append(f)
        k += 1
    # lynx tip
    for j, (u, lean, L) in enumerate(((-0.25, -0.35, 0.011), (0.0, 0.0, 0.014), (0.25, 0.35, 0.010))):
        b = outer(0.86, u * 0.6)
        d = Vector((lean * 0.5, 0.12, 1.0)).normalized()
        ctrl = [b, b + d * (L * 0.55), b + d * L + Vector((lean * 0.002, 0.002, 0))]
        f = sweep("tuft%s%d" % (side, j), [xf @ c for c in ctrl], [0.0012, 0.0008, 0.0001],
                  segs=4, samples=2, subdiv=0)
        paint(f, lambda co, nv: S.get("lynx_mask", (0.95, 0.75, 0.0, 0.0)))
        f["prepainted"] = True
        set_point_attr(f, "lod_drop", "INT", 1)
        parts.append(f)
    for o in parts:
        rig_part(o, 2 if s > 0 else 3)
    return parts


class Rand:
    """Tiny deterministic LCG so the build is reproducible."""
    def __init__(self, seed):
        self.s = seed & 0x7FFFFFFF

    def __call__(self):
        self.s = (self.s * 1103515245 + 12345) & 0x7FFFFFFF
        return self.s / 0x7FFFFFFF


def lock(name, base, t, nrm, L, W, lift, droop=0.10):
    """One lock of long fur: a flat, leaf-shaped strand group lying along
    the skin (wide near the root, thin edge-on, drawn to a soft point).
    Flat locks layered over each other read as fur; round cones read as
    spikes."""
    side = t.cross(nrm).normalized()
    up = side.cross(t).normalized()
    rows, ring = 5, 6
    bm = bmesh.new()
    rings = []
    root = base - nrm * (W * 0.5)
    for i in range(rows + 1):
        u = i / rows
        c = root + t * (L * u) + up * (L * lift * u * (1.2 - u) + W * 0.45 * min(1.0, u * 4.0)) + \
            Vector((0, 0, -droop * L * u * u))
        w = W * (0.70 + 0.45 * math.sin(math.pi * min(1.0, u * 1.5))) * (1.0 - u) ** 0.65 + W * 0.04
        h = w * 0.32
        rings.append([bm.verts.new(c + side * (math.cos(2 * math.pi * k / ring) * w) +
                                   up * (math.sin(2 * math.pi * k / ring) * h)) for k in range(ring)])
    tip = bm.verts.new(root + t * (L * 1.06) + up * (W * 0.45) + Vector((0, 0, -droop * L * 1.1)))
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(ring):
            j = (k + 1) % ring
            bm.faces.new((r0[k], r0[j], r1[j], r1[k]))
    for k in range(ring):
        bm.faces.new((rings[-1][k], rings[-1][(k + 1) % ring], tip))
    bm.faces.new(list(reversed(rings[0])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    o = mesh_from_bm(name, bm)
    skin_normals(o, nrm, 0.9)
    return o


def skin_normals(o, nrm, k):
    """Bend a fur lock's shading normals toward the skin normal at its root,
    so a ruff shades as one soft mass and only its silhouette is broken up
    (separate normals make every lock read as a scale or a spike)."""
    me = o.data
    ns = [(Vector(v.normal) * (1.0 - k) + nrm * k).normalized() for v in me.vertices]
    me.normals_split_custom_set_from_vertices([tuple(n) for n in ns])


def tuft_set(target, seeds, name, coat, lift_tip=0.5):
    """Fur locks rooted on `target`'s surface.

    seed: (point, flow, length, width, lift[, rig part]). The point is
    projected onto the skin and the lock lies back along `flow` (projected
    onto the skin), lifting by `lift`. Each lock is coloured and skinned
    from its root so it moves and reads as one piece of coat.
    """
    if target is None:
        return []
    dg = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(target, dg)
    out = []
    for k, sd in enumerate(seeds):
        p, flow, L, r, lift = sd[:5]
        loc, nrm, _, _ = bvh.find_nearest(Vector(p))
        if loc is None:
            continue
        nrm = nrm.normalized()
        flow = Vector(flow)
        t = flow - nrm * flow.dot(nrm)
        if t.length < 1e-6:
            continue
        t.normalize()
        o = lock("%s%d" % (name, k), loc, t, nrm, L, r, lift)
        col = coat(loc, nrm)
        o_col = (min(1.0, col[0] * 1.03), col[1], col[2], 0.0)
        paint(o, lambda co, nv, c=o_col: c)
        o["prepainted"] = True
        set_point_attr(o, "bind_co", "FLOAT_VECTOR", loc)
        if len(sd) > 5 and sd[5]:
            rig_part(o, sd[5])
        out.append(o)
    return out


def cat_tufts(S, body, tail, coat):
    """Where a semi-long-haired cat is fluffy: cheek ruff framing the face,
    a deep chest ruff, belly fringe, britches on the hind legs, feathered
    elbows and a plumed tail. Everything else lies smooth."""
    rnd = Rand(1234)
    head = Vector(S["head"])
    seeds = []
    # cheek ruff: a ring behind the cheeks from the ear base round under the jaw
    for s in (1, -1):
        for k in range(10):
            a = math.radians(62 - k * 16.5)
            c = head + Vector((0, 0.010, -0.012))
            p = c + Vector((s * math.cos(a) * 0.050, 0.004 + rnd() * 0.004, math.sin(a) * 0.046))
            flow = Vector((s * 0.55 * math.cos(a), 0.85, -0.45 + 0.5 * math.sin(a) * 0.3))
            L = 0.016 + 0.005 * rnd() + (0.006 if a < 0 else 0.0)
            seeds.append((p, flow, L, 0.0060, 0.06, 1))
    # chest ruff (the mane): cascading locks from the throat down the chest
    for row in range(6):
        z = 0.240 - row * 0.014
        n = 5 + (row % 2)
        for j in range(n):
            x = (j - (n - 1) * 0.5) * 0.013 + (rnd() - 0.5) * 0.004
            p = (x, -0.175 + row * 0.005, z)
            flow = (x * 3.0, -0.20, -1.0)
            seeds.append((p, flow, 0.024 + 0.006 * rnd() - row * 0.001, 0.0100, 0.07))
    # belly fringe
    for s in (1, -1):
        for k in range(7):
            y = -0.060 + k * 0.022
            seeds.append(((s * 0.034, y, 0.140), (s * 0.35, 0.45, -1.0), 0.020 + 0.006 * rnd(), 0.0080, 0.12))
    # britches: the trousers on the back of the thighs
    for s in (1, -1):
        for k in range(6):
            z = 0.128 + k * 0.014
            seeds.append(((s * 0.052, 0.140, z), (s * 0.25, 0.65, -1.0), 0.022 + 0.006 * rnd(), 0.0085, 0.15))
    # feathered elbows / back of the forearm
    for s in (1, -1):
        for k in range(3):
            seeds.append(((s * 0.050, -0.040, 0.150 - k * 0.020), (0, 0.6, -1.0), 0.016, 0.0060, 0.12))
    out = tuft_set(body, seeds, "tuft", coat)
    # the plume: locks all round the tail, longest mid-tail
    if tail is not None:
        tp = [Vector(p) for p in catmull([Vector(q) for q in S["tail"]["path"]], 8)]
        tseeds = []
        n = len(tp)
        for m in range(44):
            # scattered, overlapping locks; regular rings read as a pine cone
            fi = 2 + rnd() * (n - 5)
            i = int(fi)
            u = fi / (n - 1)
            tan = (tp[i + 1] - tp[i - 1]).normalized()
            side = tan.cross(Vector((0, 0, 1)))
            if side.length < 1e-4:
                side = Vector((1, 0, 0))
            side.normalize()
            up = side.cross(tan).normalized()
            a = 2 * math.pi * rnd()
            rad = side * math.cos(a) + up * math.sin(a)
            L = 0.026 + 0.012 * math.sin(math.pi * min(1.0, u * 1.1)) + 0.006 * rnd()
            tseeds.append((tp[i].lerp(tp[i + 1], fi - i) + rad * 0.05, tan * 1.0 + rad * 0.15, L, 0.0095, 0.10))
        out += tuft_set(tail, tseeds, "tailtuft", coat, lift_tip=0.6)
    return out


def cat_iris(t, ang):
    """Olive-green iris (linear RGB): a golden ring round the pupil, olive
    stroma with radial fibres and a dark limbal ring."""
    gold = Vector((0.36, 0.30, 0.045))
    olive = Vector((0.20, 0.25, 0.045))
    limbal = Vector((0.035, 0.045, 0.012))
    c = gold.lerp(olive, sstep(0.18, 0.62, t))
    c = c.lerp(limbal, sstep(0.80, 1.0, t))
    fib = 0.86 + 0.14 * math.sin(ang * 23.0 + 2.5 * math.sin(ang * 7.0)) * (1.0 - sstep(0.85, 1.0, t))
    return tuple(c * fib)


def tabby_fn(S):
    """Classic/mackerel tabby masks for the cat (consumed by coatMaterial).

    G (light): muzzle, whisker pads, chin, throat, chest ruff, belly, inner
               legs, the pale rim round the eyes, ear furnishings.
    B (pattern): the forehead "M" and crown lines, the cheek swirls running
               back from the outer eye corner, mackerel stripes down the
               flanks, a dorsal line, rings on the legs and the tail.
    R (shade): a darker spine and a slightly paler underside.
    """
    head = Vector(S["head"])
    belly_z = S["belly_z"]
    legs = []
    for s in (1, -1):
        for key in ("fl", "bl"):
            pts = [Vector((p[0] * s, p[1], p[2])) for p in S[key]]
            legs.append((pts, s, key == "fl"))
    tail = [Vector(p) for p in catmull([Vector(q) for q in S["tail"]["path"]], 8)]
    tail_acc = [0.0]
    for a, b in zip(tail, tail[1:]):
        tail_acc.append(tail_acc[-1] + (b - a).length)
    eyes = [head + Vector((s * S["eye_x"] * S.get("eye_dx", 1.0), S["eye_y"], S["eye_z"])) for s in (1, -1)]
    pads = [Vector((s * S["whiskers"]["pad"][0], S["whiskers"]["pad"][1] + 0.002, S["whiskers"]["pad"][2])) for s in (1, -1)]
    chin = Vector(S["mouth"]["chin"])
    mouth_f, mouth_c, mouth_n = mouth_plane(S)
    nose = Vector(S["nose"])
    TWO_PI = 2 * math.pi

    def fn(co, n):
        j = fbm(co * 26.0, freq=1.0, octaves=2, seed=7.0)
        dorsal = max(0.0, n.z) ** 1.25
        ventral = max(0.0, -n.z) ** 1.05
        shade = 1.0 - 0.10 * dorsal - 0.04 * ventral
        shade *= 1.0 + 0.05 * fbm(co * 34.0, freq=1.0, seed=1.0)
        light = 0.0
        pattern = 0.0
        rel = co - head

        # ---- legs -------------------------------------------------------------
        on_leg = False
        for pts, s, front in legs:
            d = min(seg_dist(co, pts[i], pts[i + 1]) for i in range(3))
            top = pts[0].z - (0.03 if front else 0.05)
            if d < 0.030 and co.z < top:
                on_leg = True
                medial = -n.x * s
                back = n.y if front else -n.y
                light = max(light, sstep(-0.1, 0.45, medial) * 0.85, sstep(0.3, 0.9, back) * 0.5 * (1 if front else 0.4))
                rings = 0.5 + 0.5 * math.sin(co.z * TWO_PI / 0.024 + 1.2 * j * 10.0 + (0.8 if front else 0.0))
                pattern = sstep(0.58, 0.86, rings) * (1.0 - sstep(-0.2, 0.4, medial)) * sstep(0.022, 0.045, co.z)
                if co.z < 0.030:
                    light = max(light, 0.45 * sstep(0.030, 0.012, co.z))
                break

        # ---- tail -------------------------------------------------------------
        if not on_leg and co.y > S["tail"]["path"][0][1] - 0.01:
            best, bi = 1e9, 0
            for i, q in enumerate(tail):
                dd = (co - q).length_squared
                if dd < best:
                    best, bi = dd, i
            if best < 0.06 ** 2:
                u = tail_acc[bi]
                rings = 0.5 + 0.5 * math.sin(u * TWO_PI / 0.034 + 6.0 * j)
                pattern = sstep(0.55, 0.85, rings) * 0.95
                light = max(light, 0.30 * ventral)
                return (max(0.04, shade), min(1.0, light), min(1.0, pattern), 0.0)

        if not on_leg:
            # ---- torso: mackerel stripes and dorsal line ------------------------
            if rel.y > 0.02 or co.z < head.z - 0.035:
                phase = (co.y + 0.40 * (0.235 - co.z)) * TWO_PI / 0.034 + 5.0 * j
                v = 0.5 + 0.5 * math.sin(phase)
                flank = sstep(belly_z - 0.004, belly_z + 0.040, co.z)
                pattern = max(pattern, sstep(0.62, 0.88, v) * flank)
                spine = sstep(0.013, 0.003, abs(co.x)) * sstep(0.4, 0.8, n.z)
                pattern = max(pattern, spine * 0.8)
            # ---- belly, chest ruff, throat -------------------------------------
            if co.z < belly_z + j * 0.02:
                light = max(light, sstep(belly_z + 0.01, belly_z - 0.02, co.z) * (0.45 + 0.55 * ventral))
            if co.y < -0.085:
                front = max(0.0, -n.y)
                light = max(light, sstep(0.272, 0.240, co.z + j * 0.012) * (0.35 + 0.65 * front) *
                            sstep(-0.085, -0.120, co.y))
            # ---- head --------------------------------------------------------------
            if rel.length < 0.075 and co.y < head.y + 0.035:
                # crown lines: four narrow stripes from the brow back over the
                # skull, bending into the "M" above the eyes
                if rel.z > 0.013 + 0.25 * max(0.0, -rel.y - 0.02) and abs(rel.x) < 0.030:
                    v = math.cos(rel.x * TWO_PI / 0.0145)
                    pattern = max(pattern, sstep(0.30, 0.75, v + j * 0.5) * sstep(0.028, 0.019, abs(rel.x)))
                # cheek swirls running back from the outer eye corner
                if abs(rel.x) > 0.018 and -0.040 < rel.y < 0.030:
                    ez = S["eye_z"]
                    ey = S["eye_y"]
                    z1 = ez - 0.006 - 0.32 * (rel.y - ey)
                    z2 = z1 - 0.012 + 0.10 * (rel.y - ey)
                    line = max(sstep(0.0042, 0.0016, abs(rel.z - z1 + j * 0.003)),
                               sstep(0.0038, 0.0014, abs(rel.z - z2 + j * 0.003)) * 0.85)
                    pattern = max(pattern, line * sstep(-0.026, -0.012, rel.y - ey) * (1.0 - sstep(0.010, 0.030, rel.y - ey)))
                # pale rim round each eye ("mascara")
                for e in eyes:
                    de = (co - e).length
                    light = max(light, 0.50 * sstep(0.0146, 0.0158, de) * sstep(0.0192, 0.0170, de))
                # muzzle: whisker pads, chin, upper lip and throat
                for pc in pads:
                    light = max(light, sstep(0.0205, 0.0125, (co - pc).length + j * 0.004))
                light = max(light, sstep(0.020, 0.010, (co - chin).length))
                if rel.z < -0.020 and co.y < head.y + 0.01:
                    light = max(light, sstep(-0.020, -0.034, rel.z))
                # nose bridge stays warm orange
                bridge = sstep(0.009, 0.004, abs(rel.x)) * sstep(nose.z - 0.002, nose.z + 0.004, co.z) * sstep(head.y - 0.020, head.y - 0.036, co.y)
                light *= 1.0 - bridge
                # philtrum and the closed mouth line
                if co.y < mouth_c.y and abs(co.x) < 0.011:
                    dm = (co - mouth_f).dot(mouth_n)
                    lip = 0.7 * sstep(0.0016, 0.0004, abs(dm)) * sstep(mouth_c.y - 0.012, mouth_c.y - 0.020, co.y) * sstep(0.011, 0.006, abs(co.x))
                    phil = sstep(0.0014, 0.0005, abs(co.x)) * sstep(nose.z - 0.004, nose.z - 0.007, co.z) * \
                        sstep(mouth_f.z - 0.002, mouth_f.z + 0.001, co.z) * sstep(-0.3, -0.7, n.y)
                    if max(lip, phil) > 0.0:
                        light *= 1.0 - max(lip, phil)
                        pattern = max(pattern, max(lip, phil))
                        shade *= 1.0 - 0.45 * max(lip, phil)
        return (max(0.04, shade), min(1.0, light), min(1.0, pattern), 0.0)
    return fn


# ---------------------------------------------------------------------------
# coat masks
# ---------------------------------------------------------------------------

def coat_fn(S):
    head = Vector(S["head"])
    pal = S["paint"]
    belly_z = S["belly_z"]
    sock_z = S.get("sock_z", -1.0)
    ground = S.get("paw_z", 0.014)
    leg_x = S.get("leg_x", 0.05)
    tail = S.get("tail")
    chest = Vector(S["chest"])
    belly_y = S.get("belly_y", 0.0)

    edge = S.get("edge", 0.012)

    def fn(co, n):
        # jitter the mask thresholds per-vertex so boundaries break into fur
        j = fbm(co * 22.0, freq=1.0, octaves=2, seed=7.0) * edge
        # countershading along the body axis: darker spine, pale ventral
        dorsal = max(0.0, n.z) ** 1.25
        ventral = max(0.0, -n.z) ** 1.05
        shade = 1.0 - S.get("counter", 0.20) * dorsal - 0.06 * ventral
        shade *= 1.0 + 0.055 * fbm(co * S.get("grain", 34.0), freq=1.0, seed=1.0)

        # ventral pale field
        light = sstep(S["belly_z"] + 0.08 + j, belly_z - 0.01, co.z) * (0.30 + 0.70 * ventral)
        light *= pal.get("belly", 1.0)
        if abs(co.x) > leg_x * 0.75:
            light *= 0.25  # limbs stay coated down to the pastern
        # chest bib / throat
        if co.y < chest.y + 0.07 and co.z < chest.z + 0.03:
            light = max(light, pal.get("bib", 0.0) *
                        sstep(chest.z + 0.05, chest.z - 0.10, co.z) *
                        (0.35 + 0.65 * max(0.0, -n.y)))
        # muzzle / chin / eye surround
        rel = co - head
        if co.y < head.y + 0.02 and rel.length < S["muzzle_r"] * 2.8:
            light = max(light, pal.get("muzzle", 0.0) *
                        sstep(S["muzzle_r"] * 2.8, S["muzzle_r"] * 0.8, rel.length + j))
        # eye rings stay dark
        if S.get("eye_dark") and rel.length < S["muzzle_r"] * 3.2 and co.y < head.y + 0.02:
            light *= 0.35
        # socks
        if sock_z > 0 and co.z < sock_z + j:
            light = max(light, pal.get("socks", 0.0) * sstep(sock_z, ground + 0.012, co.z))
        # tail flash
        if tail is not None and pal.get("tail_flash"):
            d = min((co - Vector(p)).length for p in tail["path"])
            if d < tail["flash_r"]:
                light = max(light, sstep(tail["flash_r"], tail["flash_r"] * 0.5, d + j) *
                            pal.get("tail_flash", 0.0))

        pattern = 0.0
        if pal.get("stripes"):
            v = 0.5 + 0.5 * math.sin(co.y * pal["stripe_freq"] + 1.4 * fbm(co * 8.0, seed=2.0) + n.z * 2.2)
            pattern = max(pattern, sstep(0.54, 0.88, v) * pal["stripes"] * (1.0 - 0.75 * ventral))
        if pal.get("spine_stripe"):
            w = sstep(S.get("stripe_w", 0.012), 0.0, abs(co.x))
            pattern = max(pattern, w * pal["spine_stripe"] *
                          sstep(S["belly_z"] + 0.12, S["belly_z"] + 0.01, co.z))
        if pal.get("spots"):
            sp = fbm(co * pal.get("spot_freq", 13.0), freq=1.0, octaves=2, seed=5.0)
            flank = sstep(0.05, 0.4, abs(n.z)) * sstep(S["belly_z"] + 0.06, S["belly_z"], co.z)
            pattern = max(pattern, sstep(0.13, 0.32, sp) * pal["spots"] * flank)
        if pal.get("blaze"):
            w = sstep(S.get("blaze_w", 0.016), 0.002, abs(co.x)) * sstep(head.y + 0.03, head.y - S["snout_len"], co.y)
            pattern = max(pattern, w * pal["blaze"])
        return (max(0.04, shade), min(1.0, light), min(1.0, pattern), 0.0)
    return fn


def paint_all(parts, S, fn=None):
    fn = fn or coat_fn(S)
    literal = {id(p): p.name for p in parts}
    for p in parts:
        n = p.name
        if p.get("prepainted"):
            continue
        if p.get("gloss"):
            # wet eye surfaces: alpha 0.75 marks a literal colour that the
            # runtime renders glossy (a real catchlight from the sun)
            base_col = tuple(S.get("eye_col", (0.085, 0.06, 0.045))) if n.startswith("eye") else \
                (0.012, 0.010, 0.009) if n.startswith("pupil") else (0.97, 0.97, 0.98)
            paint(p, lambda co, nv, c=base_col: c + (0.75,))
            continue
        if n.startswith("eye") or n.startswith("iris"):
            paint(p, lambda co, nv: (0.085, 0.06, 0.045, 1.0))
        elif n.startswith("pupil"):
            paint(p, lambda co, nv: (0.02, 0.018, 0.016, 1.0))
        elif n.startswith("glint"):
            paint(p, lambda co, nv: (0.96, 0.96, 0.97, 1.0))
        elif n == "nose":
            paint(p, lambda co, nv: tuple(S["nose_col"]) + (1.0,))
        elif n == "tongue":
            paint(p, lambda co, nv: tuple(S.get("tongue_col", (0.72, 0.30, 0.34))) + (1.0,))
        elif n.startswith("mouth_throat"):
            paint(p, lambda co, nv: (0.10, 0.025, 0.03, 1.0))
        elif n.startswith("mouth"):
            paint(p, lambda co, nv: tuple(S.get("gum_col", (0.36, 0.10, 0.12))) + (1.0,))
        elif n.startswith("fang"):
            paint(p, lambda co, nv: (0.86, 0.82, 0.72, 1.0))
        elif n.startswith("whisker"):
            paint(p, lambda co, nv: tuple(S["whiskers"].get("col", (0.80, 0.78, 0.74))) + (1.0,))
        elif n.endswith("_web"):
            paint(p, lambda co, nv: (0.42, 0.10, 0.0, 1.0))
        elif n.endswith("_bill"):
            paint(p, lambda co, nv: (0.52, 0.08, 0.0, 1.0))
        elif n.startswith("ear"):
            # feathered inner ear: pale cup, darker furry rim
            paint(p, lambda co, nv: (0.95, 0.0, 0.0, 0.0) if sstep(0.15, -0.55, nv.y) > 0.5
                  else (0.88, 0.0, 0.0, 0.0))
        elif n.startswith("hoof") or n.endswith("_web"):
            paint(p, lambda co, nv: tuple(S["claw_col"]) + (1.0,))
        else:
            paint(p, fn)


# ---------------------------------------------------------------------------
# binding + export
# ---------------------------------------------------------------------------

def bind(mesh, bones, S):
    rig = armature(bones, S.get("up_bones", ()))
    groups = {b: mesh.vertex_groups.new(name=b) for b in bones}
    allow = S["bind"]
    falloff = S.get("falloff", 4.0)
    # fur clumps bind by their root, so a whole tuft follows one blend of
    # bones instead of its tip being captured by a nearby leg
    bco = mesh.data.attributes["bind_co"].data if "bind_co" in mesh.data.attributes else None
    for v in mesh.data.vertices:
        co = v.co
        if bco is not None and bco[v.index].vector.length_squared > 1e-12:
            co = bco[v.index].vector
        scores = []
        for b in allow:
            h, t, _ = bones[b]
            d = seg_dist(co, Vector(h), Vector(t))
            scores.append((1.0 / (d + 0.005) ** falloff, b))
        scores.sort(reverse=True)
        top = scores[:3]
        tot = sum(s for s, _ in top)
        for s, b in top:
            if s / tot > 0.02:
                groups[b].add([v.index], s / tot, "REPLACE")
    # lower jaw: blend toward the jaw bone by the baked mouth weight
    if "jaw_w" in mesh.data.attributes and "jaw" in groups:
        jw = mesh.data.attributes["jaw_w"].data
        for v in mesh.data.vertices:
            k = jw[v.index].value
            if k <= 1e-4:
                continue
            for ge in list(v.groups):
                name = mesh.vertex_groups[ge.group].name
                groups[name].add([v.index], ge.weight * (1.0 - k), "REPLACE")
            groups["jaw"].add([v.index], k, "REPLACE")
    parts = mesh.data.attributes["rig_part"]
    for vi, p in enumerate(parts.data):
        if not p.value:
            continue
        for g in groups.values():
            g.remove([vi])
        bone = RIG_PARTS[p.value]
        if bone not in groups:
            bone = "head"
        groups[bone].add([vi], 1.0, "REPLACE")
    mesh.parent = rig
    mod = mesh.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    return rig


def export(species, mesh, rig, budget=6000):
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    mesh.select_set(True)
    tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
    nb = len(rig.data.bones)
    flag = "OK " if tris <= budget else "OVER"
    print(f"  {species:8s} {len(mesh.data.vertices):6d} verts {tris:6d} tris {nb:2d} bones  [{flag} {budget}]")
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT_DIR, f"{species}.glb"), export_format="GLB",
                              use_selection=True, export_normals=True, export_vertex_color="ACTIVE",
                              export_materials="NONE", export_skins=True, export_animations=False,
                              export_yup=True)
    # Far mesh: same skeleton, same coat masks, decimated silhouette.
    # Decimation interpolates vertex groups, so the Armature modifier stays in
    # the stack; removing it drops JOINTS_0/WEIGHTS_0 and the LOD would load as
    # a static mesh. Baking skinning here would do the same damage.
    low = mesh.copy()
    low.data = mesh.data.copy()
    low.name = "body_lod1"
    low.data.name = "body_lod1"
    link(low)
    # whiskers are sub-pixel at LOD distance and would only shred under
    # decimation
    rp = low.data.attributes["rig_part"].data
    fine = low.data.attributes["lod_drop"].data if "lod_drop" in low.data.attributes else None
    drop = [i for i in range(len(low.data.vertices)) if rp[i].value in (8, 9) or (fine is not None and fine[i].value)]
    if drop:
        bm = bmesh.new()
        bm.from_mesh(low.data)
        bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.verts[i] for i in drop], context="VERTS")
        bm.to_mesh(low.data)
        bm.free()
    bpy.ops.object.select_all(action="DESELECT")
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    d = low.modifiers.new("DistanceLOD", "DECIMATE")
    d.ratio = 0.20
    bpy.ops.object.modifier_apply(modifier=d.name)
    rig.select_set(True)
    low_tris = sum(len(p.vertices) - 2 for p in low.data.polygons)
    weights = len(low.data.vertices[0].groups) if len(low.data.vertices) else 0
    print(f"  {species:8s} far LOD {low_tris:6d} tris vgroups={len(low.vertex_groups)} weights/vtx={weights}")
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT_DIR, f"{species}-lod1.glb"), export_format="GLB",
                              use_selection=True, export_normals=True, export_vertex_color="ACTIVE",
                              export_materials="NONE", export_skins=True, export_animations=False,
                              export_yup=True)
    return tris, low_tris


# ---------------------------------------------------------------------------
# species definitions
#
# Proportions are real: body length / shoulder height / neck length follow the
# live animal, and the IK legs keep L1 > L2 with the joint bending backwards
# (elbow/carpus for front legs, stifle/hock for hind) exactly as in the
# rest-pose skeleton the runtime captures.
# ---------------------------------------------------------------------------

def bones_for(S):
    """Build the exported skeleton straight from the anatomy dict."""
    head = Vector(S["head"])
    snout = Vector(S["snout"])
    chest = Vector(S["chest"])
    spine = Vector(S["spine"])
    hips = Vector(S["hips"])
    bones = {
        "root": ((0, 0, 0), (0, 0, 0.05), None),
        "hips": (tuple(hips), tuple(spine), "root"),
        "spine": (tuple(spine), tuple(chest), "hips"),
        "chest": (tuple(chest), tuple(S["neck_base"]), "spine"),
        "neck": (tuple(S["neck_base"]), tuple(head), "chest"),
        "head": (tuple(head), tuple(snout), "neck"),
        "earL": (tuple(head + Vector((S["ear_x"], S["ear_y"], S["ear_z"]))),
                 tuple(head + Vector((S["ear_x"], S["ear_y"], S["ear_z"] + S["ear_h"]))), "head"),
        "earR": (tuple(head + Vector((-S["ear_x"], S["ear_y"], S["ear_z"]))),
                 tuple(head + Vector((-S["ear_x"], S["ear_y"], S["ear_z"] + S["ear_h"]))), "head"),
    }
    for side, s in (("L", 1), ("R", -1)):
        ec = Vector(S["head"]) + Vector((s * S["eye_x"] * S.get("eye_dx", 1.0), S["eye_y"], S["eye_z"]))
        bones["eye" + side] = (tuple(ec), tuple(ec + Vector((0, 0, 0.02))), "head")
        # pupil bone points along the gaze, so scaling its X/Z dilates the disc
        bones["pupil" + side] = (tuple(ec), tuple(ec + pupil_axis(S, s) * 0.015), "eye" + side)
        f = [Vector((p[0] * s, p[1], p[2])) for p in S["fl"]]
        b = [Vector((p[0] * s, p[1], p[2])) for p in S["bl"]]
        bones[f"legF{side}1"] = (tuple(f[0]), tuple(f[1]), "chest")
        bones[f"legF{side}2"] = (tuple(f[1]), tuple(f[2]), f"legF{side}1")
        bones[f"legF{side}3"] = (tuple(f[2]), tuple(f[3]), f"legF{side}2")
        bones[f"legB{side}1"] = (tuple(b[0]), tuple(b[1]), "hips")
        bones[f"legB{side}2"] = (tuple(b[1]), tuple(b[2]), f"legB{side}1")
        bones[f"legB{side}3"] = (tuple(b[2]), tuple(b[3]), f"legB{side}2")
        if S.get("toe_len"):
            # digits: flex when the paw lifts, spread and knead
            for tag, pts in (("F", f), ("B", b)):
                ball = Vector((pts[3].x, pts[3].y, S.get("toe_z", 0.008)))
                bones[f"leg{tag}{side}4"] = (tuple(ball), tuple(ball + Vector((0, -S["toe_len"], -0.002))),
                                             f"leg{tag}{side}3")
        if S.get("whiskers"):
            pad = Vector(S["whiskers"]["pad"])
            wb = Vector((s * pad.x, pad.y, pad.z))
            bones["whisker" + side] = (tuple(wb), tuple(wb + Vector((s * 0.02, 0.0, 0.0))), "head")
    if S.get("mouth"):
        m = S["mouth"]
        hinge = Vector(m["hinge"])
        chin = Vector(m["chin"])
        bones["jaw"] = (tuple(hinge), tuple(chin), "head")
        F, C, n = mouth_plane(S)
        t0 = Vector((0, C.y - 0.002, (F.z + C.z) * 0.5 - 0.002))
        bones["tongue"] = (tuple(t0), tuple(Vector((0, F.y + 0.004, F.z - 0.002))), "jaw")
    if S.get("tail"):
        p = tail_points(S)
        for i in range(len(p) - 1):
            bones[f"tail{i + 1}"] = (tuple(p[i]), tuple(p[i + 1]), "hips" if i == 0 else f"tail{i}")
    return bones


def tail_points(S):
    """Tail joints: the authored path resampled to `segments` equal pieces."""
    path = [Vector(t) for t in S["tail"]["path"]]
    n = S["tail"].get("segments", 3)
    if len(path) < 2:
        path = [path[0], path[0] + Vector((0, 0.006, 0.004))]
    dense = catmull(path, 8) if len(path) >= 3 else [path[0].lerp(path[1], i / 16) for i in range(17)]
    acc = [0.0]
    for a, b in zip(dense, dense[1:]):
        acc.append(acc[-1] + (b - a).length)
    total = acc[-1]
    out = []
    j = 0
    for i in range(n + 1):
        t = total * i / n
        while j < len(acc) - 2 and acc[j + 1] < t:
            j += 1
        seg = max(1e-9, acc[j + 1] - acc[j])
        out.append(dense[j].lerp(dense[j + 1], (t - acc[j]) / seg))
    return out


def base_spec(**kw):
    S = dict(
        mres=0.024, rough=0.0, rough_size=0.05, leg_rough=0.0,
        counter=0.20, grain=34.0, belly_z=0.0, belly_y=0.0, sock_z=0.0,
        leg_x=0.05, paw_z=0.014, muzzle_r=0.03, snout_len=0.05,
        eye_dx=1.0, eye_fwd=1.0, eye_squash=1.0, pupil_squash=1.0, pupil=0.5,
        ear_cup=0.5, ear_tip=0.0, hock_bulge=None, nose_jag=0.0,
        nose_col=(0.10, 0.08, 0.08), claw_col=(0.10, 0.08, 0.08),
        iris=(0.30, 0.24, 0.10), eye_dark=False,
        falloff=4.0, bind=None,
        paint={},
    )
    S.update(kw)
    toes = ["legFL4", "legFR4", "legBL4", "legBR4"] if S.get("toe_len") else []
    tails = [f"tail{i + 1}" for i in range(S["tail"].get("segments", 3))] if S.get("tail") else []
    S["bind"] = S["bind"] or [
        "hips", "spine", "chest", "neck", "head",
        "legFL1", "legFL2", "legFL3", "legFR1", "legFR2", "legFR3",
        "legBL1", "legBL2", "legBL3", "legBR1", "legBR2", "legBR3",
    ] + toes + tails + ["root"]
    S["bones"] = bones_for(S)
    return S


# ---- cat: the cat, a semi-long-haired ginger tabby, ~0.25 m at the shoulder --
# The skeleton (every bone head/tail) is the one the runtime was tuned on; the
# skin around it is a cat's: a round skull with a short muzzle and plump
# whisker pads, big forward-facing eyes, tall cupped ears with furnishings,
# a deep chest under a ruff, and a plumed tail about as long as the body.
CAT = base_spec(
    hips=(0, 0.115, 0.212), spine=(0, 0.018, 0.222), chest=(0, -0.088, 0.216),
    neck_base=(0, -0.140, 0.244), head=(0, -0.182, 0.288), snout=(0, -0.222, 0.272),
    mass=[
        ((0, -0.068, 0.212), (0.064, 0.084, 0.078)),    # ribcage: deep chest
        ((0, 0.010, 0.224), (0.052, 0.072, 0.060)),     # loin
        ((0, 0.078, 0.220), (0.060, 0.070, 0.070)),     # haunches
        ((0, 0.122, 0.222), (0.050, 0.050, 0.056)),     # rump
        ((0, -0.112, 0.238), (0.054, 0.048, 0.056)),    # scapulae
        ((0, -0.148, 0.258), (0.042, 0.038, 0.046)),    # neck (thick with ruff)
        ((0, -0.156, 0.224), (0.040, 0.030, 0.046)),    # chest ruff mass
        ((0, -0.179, 0.292), (0.038, 0.038, 0.034)),    # cranium: round and broad
        ((0, -0.194, 0.300), (0.022, 0.018, 0.023)),    # brow
        ((0.025, -0.195, 0.278), (0.025, 0.025, 0.023)),  # cheeks
        ((-0.025, -0.195, 0.278), (0.025, 0.025, 0.023)),
        ((0.019, -0.205, 0.268), (0.016, 0.017, 0.013)),  # jowls
        ((-0.019, -0.205, 0.268), (0.016, 0.017, 0.013)),
        ((0.0098, -0.2205, 0.2665), (0.0118, 0.0112, 0.0102)),  # whisker pads
        ((-0.0098, -0.2205, 0.2665), (0.0118, 0.0112, 0.0102)),
        ((0, -0.214, 0.281), (0.0115, 0.016, 0.0105)),  # short nasal bridge
        ((0, -0.213, 0.2545), (0.0112, 0.0120, 0.0070)),  # chin / lower jaw
        ((0.047, -0.076, 0.172), (0.027, 0.036, 0.048)),  # upper arm, in the skin to the elbow
        ((-0.047, -0.076, 0.172), (0.027, 0.036, 0.048)),
        ((0.053, 0.060, 0.168), (0.034, 0.050, 0.058)),   # thigh: broad, down to the stifle
        ((-0.053, 0.060, 0.168), (0.034, 0.050, 0.058)),
        ((0, -0.038, 0.170), (0.042, 0.056, 0.030)),    # brisket
        ((0, 0.034, 0.182), (0.038, 0.050, 0.024)),     # belly / primordial pouch
    ],
    mres=0.0105, rough=0.0006, rough_size=0.026, leg_rough=0.0005,
    # front: scapula/humerus -> elbow -> carpus -> paw (carpus bends back)
    fl=[(0.046, -0.086, 0.204), (0.050, -0.062, 0.128), (0.048, -0.076, 0.060), (0.048, -0.090, 0.022)],
    fl_g=(0.0262, 0.0182, 0.0142, 0.0128),
    fl_foot=dict(digit=True, width=0.0190, length=0.034, height=0.0094, toes=4),
    # hind: femur -> stifle (forward) -> hock (back) -> paw
    bl=[(0.050, 0.076, 0.198), (0.054, 0.040, 0.122), (0.052, 0.098, 0.052), (0.050, 0.086, 0.022)],
    bl_g=(0.0310, 0.0215, 0.0140, 0.0128),
    bl_foot=dict(digit=True, width=0.0180, length=0.036, height=0.0090, toes=4),
    hock_bulge=1.13,
    toe_len=0.022, toe_z=0.008,
    # tail about as long as the body, carried low with a lifted tip
    tail=dict(path=[(0, 0.140, 0.226), (0.010, 0.214, 0.246), (0.026, 0.282, 0.248),
                    (0.046, 0.334, 0.222), (0.062, 0.358, 0.188), (0.070, 0.364, 0.166)],
              r=(0.0175, 0.0170, 0.0160, 0.0150, 0.0130, 0.0095), rough=0.0016, rough_size=0.03,
              flash_r=0.0, segments=6, segs=9),
    mouth=dict(front=(0, -0.2262, 0.2588), corner=(0, -0.2005, 0.2560), hinge=(0, -0.188, 0.264),
               chin=(0, -0.2220, 0.2500), half_w=0.018, fangs=0.0068, band=0.013, fade=0.012,
               depth=0.03, throat_r=0.008),
    whiskers=dict(pad=(0.0125, -0.2255, 0.2640), len=0.088, r=0.00065, rows=4, per_row=3,
                  col=(0.93, 0.92, 0.89)),
    tongue_col=(0.80, 0.36, 0.42), gum_col=(0.42, 0.12, 0.15),
    nose=(0, -0.2345, 0.2735), nose_r=(0.0072, 0.0040, 0.0050), nose_taper=True,
    # pink-orange nose leather (linear RGB)
    nose_col=(0.74, 0.27, 0.19),
    claw_col=(0.09, 0.07, 0.06),
    eye_x=0.0245, eye_dx=1.0, eye_y=-0.0295, eye_z=0.0085, eye_r=0.0150, eye_fwd=1.0, eye_sink=0.10, eye_depth=0.72,
    eye_n=(0.22, -1.0, 0.04), gaze_bias=(0, -0.25, 0.0), eye_segs=20, eye_rings=14,
    pupil=0.50, eye_squash=1.0, pupil_squash=1.30, pupil_segs=20, eye_dark=False,
    iris=(0.20, 0.25, 0.045), iris_fn=cat_iris, iris_theta=1.12, eye_gloss=True, eye_col=(0.030, 0.034, 0.010),
    glint=(-0.36, 0.28, 0.17), glint2=(0.34, -0.30, 0.075), glint_segs=10, up_bones=("pupilL", "pupilR"),
    lid_squash=0.92, lid_k=1.03, lid_thick=0.045, lid_col=(0.13, 0.05, 0.018),
    ear_x=0.0255, ear_y=0.010, ear_z=0.020, ear_h=0.050, ear_w=0.0185, ear_d=0.0095, ear_th=0.0017,
    ear_tilt=(-0.16, 0.36, 0.30), pinna=True,
    belly_z=0.180, sock_z=0.0, leg_x=0.046, muzzle_r=0.030, snout_len=0.050,
    coat_fn=tabby_fn, tufts=cat_tufts,
    paint=dict(),
)

# ---- rabbit: European hare, compact, huge hind legs ----------------------
RABBIT = base_spec(
    hips=(0, 0.086, 0.118), spine=(0, 0.014, 0.122), chest=(0, -0.062, 0.118),
    neck_base=(0, -0.100, 0.132), head=(0, -0.140, 0.160), snout=(0, -0.170, 0.150),
    mass=[
        ((0, 0.052, 0.122), (0.058, 0.070, 0.062)),    # haunches (huge)
        ((0, -0.010, 0.120), (0.050, 0.055, 0.050)),   # loin
        ((0, -0.058, 0.120), (0.048, 0.048, 0.047)),   # chest
        ((0, -0.090, 0.130), (0.034, 0.030, 0.036)),   # neck
        ((0, -0.136, 0.164), (0.032, 0.030, 0.030)),   # skull
        ((0.026, -0.140, 0.158), (0.022, 0.024, 0.021)),  # cheeks
        ((0, -0.162, 0.152), (0.019, 0.020, 0.017)),   # muzzle
        ((0, -0.160, 0.137), (0.012, 0.014, 0.0065)),  # chin
        ((0, -0.030, 0.086), (0.036, 0.048, 0.026)),   # belly
        ((0.044, -0.044, 0.100), (0.022, 0.030, 0.026)),  # foreleg
        ((0.048, 0.040, 0.098), (0.030, 0.042, 0.036)),   # thigh
    ],
    mres=0.0135, rough=0.0011, rough_size=0.028, leg_rough=0.0006, eye_sink=0.30,
    fl=[(0.038, -0.058, 0.104), (0.040, -0.048, 0.062), (0.040, -0.052, 0.032), (0.040, -0.058, 0.014)],
    fl_g=(0.0170, 0.0125, 0.0105),
    fl_foot=dict(digit=True, width=0.0125, length=0.022, height=0.0060, toes=4),
    bl=[(0.044, 0.060, 0.100), (0.048, 0.018, 0.062), (0.046, 0.072, 0.028), (0.046, 0.064, 0.014)],
    bl_g=(0.0270, 0.0185, 0.0130),
    # a hare's long hind foot lies along the ground
    bl_foot=dict(digit=True, width=0.0145, length=0.044, height=0.0066, toes=4),
    toe_len=0.016, toe_z=0.006,
    mouth=dict(front=(0, -0.178, 0.1425), corner=(0, -0.161, 0.139), hinge=(0, -0.151, 0.143),
               chin=(0, -0.174, 0.134), half_w=0.011, band=0.010, fade=0.010, depth=0.02, throat_r=0.006),
    whiskers=dict(pad=(0.009, -0.174, 0.148), len=0.052, r=0.0006, rows=3, per_row=2,
                  col=(0.30, 0.27, 0.24)),
    tongue_col=(0.78, 0.40, 0.44), gum_col=(0.46, 0.18, 0.20),
    hock_bulge=1.12,
    tail=dict(path=[(0, 0.104, 0.122)], r=(0.021,),
              rough=0.0018, rough_size=0.02, flash_r=0.030),
    nose=(0, -0.181, 0.150), nose_r=(0.0062, 0.0045, 0.0042), nose_col=(0.42, 0.24, 0.28),
    claw_col=(0.12, 0.09, 0.08),
    eye_x=0.026, eye_dx=1.0, eye_y=-0.018, eye_z=0.008, eye_r=0.0110, eye_fwd=1.0,
    pupil=0.92, eye_squash=1.0, pupil_squash=1.0, eye_dark=True,
    iris=(0.10, 0.055, 0.035),
    ear_x=0.017, ear_y=0.024, ear_z=0.018, ear_h=0.115, ear_w=0.020, ear_d=0.009,
    ear_tilt=(0.14, 0.14, 0.05), ear_cup=0.5, ear_tip=0.004,
    belly_z=0.092, sock_z=0.0, leg_x=0.040, muzzle_r=0.024, snout_len=0.042,
    paint=dict(belly=0.95, bib=0.7, muzzle=1.0, tail_flash=1.0, counter=0.14),
)

# ---- deer: fallow deer doe, ~1.1 m at the withers -------------------------
DEER = base_spec(
    fit_eyes=True, eye_n=(0.75, -0.64, 0.16), gaze_bias=(0, -0.15, 0.04),
    hips=(0, 0.316, 0.612), spine=(0, 0.055, 0.624), chest=(0, -0.238, 0.652),
    neck_base=(0, -0.352, 0.742), head=(0, -0.478, 0.908), snout=(0, -0.582, 0.866),
    mass=[
        ((0, 0.190, 0.642), (0.142, 0.172, 0.154)),   # haunches / rump
        ((0, 0.060, 0.624), (0.128, 0.150, 0.134)),   # loin
        ((0, -0.118, 0.642), (0.136, 0.152, 0.144)),  # barrel
        ((0, -0.266, 0.664), (0.130, 0.140, 0.134)),  # chest / brisket
        ((0, -0.340, 0.736), (0.078, 0.084, 0.080)),  # neck base
        ((0, -0.412, 0.828), (0.058, 0.062, 0.062)),  # neck
        ((0, -0.482, 0.912), (0.060, 0.072, 0.064)),  # skull
        ((0.046, -0.484, 0.896), (0.040, 0.044, 0.038)),  # cheeks
        ((0, -0.548, 0.876), (0.036, 0.048, 0.034)),  # muzzle
        ((0, -0.540, 0.846), (0.026, 0.040, 0.014)),  # lower jaw
        ((0, -0.020, 0.510), (0.112, 0.162, 0.076)),  # belly / brisket
        ((0.088, -0.212, 0.602), (0.050, 0.088, 0.058)),  # upper arm
        ((0.098, 0.150, 0.586), (0.060, 0.110, 0.076)),   # thigh
    ],
    mres=0.027, rough=0.0024, rough_size=0.07, leg_rough=0.0010, eye_sink=0.22,
    fl=[(0.086, -0.212, 0.618), (0.088, -0.152, 0.428), (0.086, -0.202, 0.226), (0.086, -0.216, 0.030)],
    fl_g=(0.044, 0.0235, 0.0185),
    fl_foot=dict(hoof=True, width=0.028, height=0.026, span=0.0),
    bl=[(0.098, 0.152, 0.610), (0.102, 0.038, 0.410), (0.100, 0.168, 0.208), (0.100, 0.156, 0.030)],
    bl_g=(0.058, 0.030, 0.0205),
    bl_foot=dict(hoof=True, width=0.028, height=0.026, span=0.0),
    hock_bulge=1.18,
    hooves=True,
    mouth=dict(front=(0, -0.588, 0.850), corner=(0, -0.536, 0.848), hinge=(0, -0.500, 0.864),
               chin=(0, -0.578, 0.832), half_w=0.024, band=0.022, fade=0.026, depth=0.05, throat_r=0.014),
    tongue_col=(0.62, 0.30, 0.34), gum_col=(0.30, 0.14, 0.15),
    tail=dict(path=[(0, 0.334, 0.612), (0, 0.370, 0.602)], r=(0.028, 0.024),
              rough=0.0015, rough_size=0.03, flash_r=0.034),
    nose=(0, -0.590, 0.866), nose_r=(0.022, 0.015, 0.014), nose_col=(0.06, 0.05, 0.05),
    claw_col=(0.09, 0.08, 0.07),
    eye_x=0.048, eye_dx=1.0, eye_y=-0.026, eye_z=0.018, eye_r=0.0175, eye_fwd=1.0,
    pupil=0.80, eye_squash=1.0, pupil_squash=1.0, eye_dark=True,
    iris=(0.12, 0.07, 0.045),
    ear_x=0.054, ear_y=0.032, ear_z=0.052, ear_h=0.126, ear_w=0.044, ear_d=0.015,
    ear_tilt=(0.30, 1.15, 0.30), ear_cup=0.55, ear_tip=0.010,
    belly_z=0.542, sock_z=0.0, leg_x=0.098, muzzle_r=0.048, snout_len=0.115,
    hoof_z=0.048,
    paint=dict(belly=0.55, bib=0.45, muzzle=0.85, spots=0.55, spot_freq=11.0,
               tail_flash=1.0, counter=0.10),
)

# ---- fox: red fox, ~0.38 m at the shoulder --------------------------------
FOX = base_spec(
    hips=(0, 0.140, 0.246), spine=(0, 0.020, 0.252), chest=(0, -0.100, 0.250),
    neck_base=(0, -0.166, 0.284), head=(0, -0.224, 0.330), snout=(0, -0.302, 0.308),
    mass=[
        ((0, 0.082, 0.254), (0.060, 0.070, 0.066)),   # haunches
        ((0, 0.010, 0.248), (0.052, 0.058, 0.052)),   # loin
        ((0, -0.090, 0.254), (0.058, 0.070, 0.058)),  # barrel
        ((0, -0.142, 0.264), (0.050, 0.044, 0.050)),  # scapulae
        ((0, -0.172, 0.294), (0.040, 0.036, 0.042)),  # neck
        ((0, -0.232, 0.334), (0.036, 0.034, 0.036)),  # skull
        ((0.026, -0.234, 0.328), (0.024, 0.026, 0.024)),  # cheeks
        ((0, -0.282, 0.314), (0.019, 0.028, 0.016)),  # long narrow muzzle
        ((0, -0.270, 0.297), (0.015, 0.030, 0.0075)), # lower jaw
        ((0.044, -0.082, 0.226), (0.026, 0.040, 0.030)),  # upper arm
        ((0.048, 0.070, 0.220), (0.030, 0.044, 0.038)),   # thigh
        ((0, -0.030, 0.206), (0.040, 0.055, 0.026)),  # throat
    ],
    mres=0.0145, rough=0.0013, rough_size=0.030, leg_rough=0.0008,
    fl=[(0.042, -0.096, 0.234), (0.046, -0.070, 0.150), (0.044, -0.084, 0.076), (0.044, -0.096, 0.026)],
    fl_g=(0.0225, 0.0160, 0.0128),
    fl_foot=dict(digit=True, width=0.0150, length=0.030, height=0.0080, toes=4, claw=True),
    bl=[(0.046, 0.092, 0.228), (0.050, 0.050, 0.146), (0.048, 0.112, 0.060), (0.046, 0.100, 0.026)],
    bl_g=(0.0275, 0.0190, 0.0138),
    bl_foot=dict(digit=True, width=0.0145, length=0.030, height=0.0078, toes=4, claw=True),
    toe_len=0.020, toe_z=0.008,
    mouth=dict(front=(0, -0.309, 0.302), corner=(0, -0.246, 0.300), hinge=(0, -0.234, 0.307),
               chin=(0, -0.301, 0.292), half_w=0.016, fangs=0.0066, band=0.012, fade=0.016,
               depth=0.03, throat_r=0.008),
    whiskers=dict(pad=(0.011, -0.298, 0.307), len=0.062, r=0.0007, rows=3, per_row=2,
                  col=(0.12, 0.10, 0.09)),
    tongue_col=(0.80, 0.34, 0.40), gum_col=(0.20, 0.07, 0.08), ear_point=0.9, eye_sink=0.2,
    hock_bulge=1.16,
    tail=dict(path=[(0, 0.162, 0.258), (0.010, 0.234, 0.286), (0.024, 0.292, 0.298),
                    (0.042, 0.334, 0.276), (0.056, 0.344, 0.238)],
              r=(0.030, 0.048, 0.054, 0.048, 0.030), rough=0.0022, rough_size=0.035,
              flash_r=0.036, segments=6),
    nose=(0, -0.314, 0.312), nose_r=(0.0072, 0.005, 0.005), nose_col=(0.08, 0.07, 0.07),
    claw_col=(0.08, 0.07, 0.06),
    eye_x=0.028, eye_dx=0.94, eye_y=-0.026, eye_z=0.014, eye_r=0.0115, eye_fwd=1.0,
    pupil=0.52, eye_squash=0.55, pupil_squash=1.7, eye_dark=False,
    iris=(0.34, 0.22, 0.07),
    ear_x=0.030, ear_y=0.008, ear_z=0.036, ear_h=0.076, ear_w=0.032, ear_d=0.011,
    ear_tilt=(-0.06, 0.24, 0.14), ear_cup=0.5, ear_tip=0.006,
    belly_z=0.208, sock_z=0.088, leg_x=0.044, muzzle_r=0.030, snout_len=0.098,
    paint=dict(belly=0.6, bib=0.95, muzzle=1.0, socks=0.85, tail_flash=1.0, counter=0.0),
)


# ---------------------------------------------------------------------------
# duck: mallard drake
# ---------------------------------------------------------------------------

def build_duck():
    parts = []
    body = metaball("body", [
        ((0, 0.010, 0.150), (0.090, 0.140, 0.082)),   # breast/barrel
        ((0, 0.084, 0.156), (0.078, 0.090, 0.074)),   # belly
        ((0, 0.150, 0.176), (0.052, 0.060, 0.054)),   # tail wedge
        ((0, -0.086, 0.178), (0.068, 0.058, 0.062)),  # back/shoulder
        ((0, -0.132, 0.212), (0.038, 0.036, 0.044)),  # neck base
        ((0, -0.166, 0.262), (0.028, 0.027, 0.030)),  # neck
        ((0, -0.196, 0.310), (0.033, 0.036, 0.034)),  # head
        ((0, -0.238, 0.300), (0.026, 0.031, 0.011)),  # bill
        ((0.072, 0.012, 0.180), (0.024, 0.098, 0.046)),  # folded wing L
    ], res=0.0115, rough=0.0007, rough_size=0.03)
    DM = dict(mouth=dict(front=(0, -0.267, 0.2995), corner=(0, -0.215, 0.3015), hinge=(0, -0.209, 0.304),
                         chin=(0, -0.262, 0.293), half_w=0.013, band=0.008, fade=0.008, depth=0.02,
                         throat_r=0.005),
              tongue_col=(0.72, 0.42, 0.40), gum_col=(0.55, 0.30, 0.18))
    split_mouth(body, DM)
    parts.append(body)
    mouth_parts(DM, parts)
    for side, s in (("L", 1), ("R", -1)):
        parts.append(sweep("wing" + side,
                           [(s * 0.082, -0.052, 0.200), (s * 0.090, 0.030, 0.188),
                            (s * 0.078, 0.110, 0.176)],
                           [0.024, 0.030, 0.014], segs=7, samples=2, subdiv=1,
                           rough=0.0012, rough_size=0.03))
        # webbed foot: three forward toes joined by webbing
        parts.append(duck_foot("legB" + side, s))
        n = Vector((s * 0.75, -0.62, 0.16)).normalized()
        c = Vector((s * 0.025, -0.216, 0.318))
        ball = eyeball("eye" + side, c, 0.0088, n, segs=10, rings=7)
        iris = iris_cap("iris" + side, c, 0.0088, n, 0.75, (0.16, 0.07, 0.02), (0, 0, 0), segs=12, rings=4)
        pupil = eye_disc("pupil" + side, c + n * (0.0088 * 1.016), n, 0.0040, segs=10)
        glint = eye_disc("glint" + side, c + n * (0.0088 * 1.024) + Vector((0, 0, 0.0028)), n, 0.0014, segs=6)
        for o in (ball, iris, glint):
            rig_part(o, 4 if s > 0 else 5)
            parts.append(o)
        rig_part(pupil, 10 if s > 0 else 11)
        parts.append(pupil)

    D = dict(head=(0, -0.186, 0.276), chest=(0, -0.082, 0.176), belly_z=0.130,
             leg_x=0.0, snout_len=0.05, muzzle_r=0.03, claw_col=(0.46, 0.14, 0.02),
             tongue_col=DM["tongue_col"], gum_col=DM["gum_col"])
    paint_all(parts, D, fn=duck_paint)
    bones = {
        "root": ((0, 0, 0), (0, 0, 0.05), None),
        "hips": ((0, 0.078, 0.156), (0, -0.018, 0.162), "root"),
        "chest": ((0, -0.018, 0.162), (0, -0.098, 0.196), "hips"),
        "neck": ((0, -0.098, 0.196), (0, -0.174, 0.298), "chest"),
        "head": ((0, -0.174, 0.298), (0, -0.228, 0.300), "neck"),
        "tail1": ((0, 0.128, 0.170), (0, 0.196, 0.186), "hips"),
        "wingL": ((0.066, -0.052, 0.198), (0.084, 0.114, 0.174), "chest"),
        "wingR": ((-0.066, -0.052, 0.198), (-0.084, 0.114, 0.174), "chest"),
        "legBL1": ((0.040, 0.030, 0.122), (0.040, 0.024, 0.062), "hips"),
        "legBL2": ((0.040, 0.024, 0.062), (0.040, 0.018, 0.014), "legBL1"),
        "legBL3": ((0.040, 0.018, 0.014), (0.040, -0.034, 0.006), "legBL2"),
        "legBR1": ((-0.040, 0.030, 0.122), (-0.040, 0.024, 0.062), "hips"),
        "legBR2": ((-0.040, 0.024, 0.062), (-0.040, 0.018, 0.014), "legBR1"),
        "legBR3": ((-0.040, 0.018, 0.014), (-0.040, -0.034, 0.006), "legBR2"),
        "jaw": (DM["mouth"]["hinge"], DM["mouth"]["chin"], "head"),
        "tongue": ((0, -0.218, 0.299), (0, -0.258, 0.298), "jaw"),
    }
    for side, s in (("L", 1), ("R", -1)):
        c = Vector((s * 0.025, -0.216, 0.318))
        n = Vector((s * 0.75, -0.62, 0.16)).normalized()
        bones["eye" + side] = (tuple(c), tuple(c + Vector((0, 0, 0.012))), "head")
        bones["pupil" + side] = (tuple(c), tuple(c + n * 0.012), "eye" + side)
    S = dict(bind=["hips", "chest", "neck", "head", "tail1", "wingL", "wingR",
                   "legBL1", "legBL2", "legBL3", "legBR1", "legBR2", "legBR3", "root"],
             belly_z=0.130, leg_x=0.0, snout_len=0.05, muzzle_r=0.03, falloff=4.0)
    return join(parts, "body"), bones, S


def duck_foot(name, s):
    """Tarsus + three forward toes splayed across a webbed paddle."""
    leg = sweep(name, [(s * 0.040, 0.030, 0.118), (s * 0.040, 0.024, 0.064),
                       (s * 0.040, 0.020, 0.030), (s * 0.040, 0.016, 0.013)],
                [0.017, 0.013, 0.011, 0.010], segs=6, samples=2, subdiv=1)
    web = blob(name + "_web", (s * 0.040, -0.020, 0.009), (0.030, 0.040, 0.0055),
               segs=(10, 6))
    toes = []
    for i, ang in enumerate((-0.55, 0.0, 0.55)):
        a = ang
        tip = Vector((s * 0.040 + math.sin(a) * 0.030 * s, 0.014 - math.cos(a) * 0.046, 0.007))
        base = Vector((s * 0.040, 0.010, 0.010))
        toes.append(sweep(name + "_t%d" % i, [base, base.lerp(tip, 0.6) + Vector((0, 0, 0.002)), tip],
                          [0.009, 0.007, 0.004], segs=5, samples=2, subdiv=1))
    return join([leg, web] + toes, name)


def duck_paint(co, n):
    z, y = co.z, co.y
    edge = 0.006
    if z > 0.276 - edge:  # mallard head + speculum-green neck
        return (1.0, 0.0, 1.0, 0.0)
    if z > 0.256 and co.y < -0.13:
        return (1.0, 0.0, 1.0, 0.0)
    # the white neck ring follows the throat, not a flat band
    ring = sstep(0.238, 0.250, z) * sstep(0.268, 0.254, z)
    if ring > 0.05 and co.y < -0.12:
        return (1.0, ring * 0.9, 0.0, 0.0)
    if z < 0.030:
        return (1.0, 0.0, 0.0, 0.0)
    if y > 0.105:
        return (0.55, 0.25, 0.35, 0.0)  # dark tail wedge
    if abs(co.x) > 0.060 and z > 0.150:
        return (0.72, 0.0, 0.85, 0.0)  # wing coverts / speculum
    if z < 0.136:
        return (1.0, 0.55, 0.0, 0.0)   # pale flanks
    return (0.62, 0.0, 0.30, 0.0)     # warm brown chest


# ---------------------------------------------------------------------------
# preview rendering (Workbench — fast, deterministic, no GPU required)
# ---------------------------------------------------------------------------

PREVIEW_COATS = {
    # mirrors src/world/wildlife/animalAssets.ts so previews show real coats
    "cat": ("#d88a45", "#f7e6cc", "#a5521f"),
    "rabbit": ("#9a7856", "#eee3d1", "#9a7856"),
    "deer": ("#a4703f", "#f0e4d4", "#f3e8d8"),
    "fox": ("#cf5f21", "#f6efe6", "#241a15"),
    "duck": ("#8b7250", "#d8cec0", "#1f4f34"),
}


def srgb_lin(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def preview_colors(obj, species):
    """Bake the runtime coat shader into a colour layer for Workbench."""
    base, light, pat = (Vector(srgb_lin(h)) for h in PREVIEW_COATS[species])
    me = obj.data
    src = me.color_attributes["Color"]
    dst = me.color_attributes.get("Preview") or me.color_attributes.new(name="Preview", type="FLOAT_COLOR", domain="CORNER")
    for i, d in enumerate(src.data):
        r, g, b, a = d.color
        if a > 0.5:
            dst.data[i].color = (r, g, b, 1.0)
            continue
        c = base.lerp(light, g)
        c = c.lerp(pat, b * (1.0 - g * 0.7)) * r
        dst.data[i].color = (c.x, c.y, c.z, 1.0)
    # Workbench draws the first colour layer regardless of the active one, so
    # the preview overwrites the mask layer (the GLB is already exported)
    for i, d in enumerate(dst.data):
        src.data[i].color = d.color
    me.color_attributes.active_color = dst
    me.color_attributes.active_color_name = dst.name
    me.color_attributes.default_color_name = dst.name
    vals = [d.color[:3] for d in dst.data]
    print("preview colours", len(vals), [round(min(v[i] for v in vals), 3) for i in range(3)],
          [round(max(v[i] for v in vals), 3) for i in range(3)], [a.name for a in me.color_attributes])
    me.color_attributes.render_color_index = list(me.color_attributes).index(dst)


def pose_rig(rig, pose):
    """Apply {bone: (x, y, z) euler} in each bone's local frame."""
    for pb in rig.pose.bones:
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)
        pb.location = (0, 0, 0)
    for name, v in pose.items():
        pb = rig.pose.bones.get(name)
        if not pb:
            continue
        if name.endswith("@s"):
            continue
        pb.rotation_euler = v
    for name, v in pose.items():
        if name.endswith("@s") and rig.pose.bones.get(name[:-2]):
            rig.pose.bones[name[:-2]].scale = v
    bpy.context.view_layer.update()


def head_preview(species, obj, S, tag, res=(720, 660)):
    """Close three-quarter view of the head (mouth, whiskers, eyes)."""
    sc = bpy.context.scene
    cam = sc.camera
    head = Vector(S["head"]) + Vector((0, -0.01, -0.005))
    r = max(0.05, (Vector(S["snout"]) - Vector(S["head"])).length * 2.6)
    for i, az in enumerate((-0.9, -0.15)):
        cam.location = head + Vector((math.sin(az) * r * 2.4, -math.cos(az) * r * 2.4, r * 0.5))
        cam.rotation_euler = (head - cam.location).to_track_quat("-Z", "Y").to_euler()
        cam.data.clip_start = 0.002
        sc.render.resolution_x, sc.render.resolution_y = res
        sc.render.filepath = os.path.join(PREVIEW_DIR, f"_{species}_{tag}{i}.png")
        bpy.ops.render.render(write_still=True)


def preview(species, obj, azs=(-0.7, 2.3), res=(720, 660), dist_mult=3.2):
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    preview_colors(obj, species)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.studio_light = "Default"
    sh.color_type = "VERTEX"
    sh.show_cavity = True
    sh.cavity_type = "BOTH"
    sh.curvature_ridge_factor = 1.2
    sh.curvature_valley_factor = 1.2
    sh.show_shadows = True
    sh.shadow_intensity = 0.4
    sc.display.render_aa = "8"
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = False
    sc.world = bpy.data.worlds.new("W")
    sc.world.color = (0.05, 0.06, 0.07)

    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 55.0
    cam = link(bpy.data.objects.new("cam", cam_data))
    sc.camera = cam
    bb = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    lo = Vector((min(p.x for p in bb), min(p.y for p in bb), min(p.z for p in bb)))
    hi = Vector((max(p.x for p in bb), max(p.y for p in bb), max(p.z for p in bb)))
    ctr = (lo + hi) * 0.5
    rad = (hi - lo).length * 0.5
    dist = rad * dist_mult
    cam.data.clip_start = max(0.002, dist * 0.01)
    cam.data.clip_end = dist * 6
    for i, az in enumerate(azs):
        cam.location = ctr + Vector((math.sin(az) * dist, -math.cos(az) * dist, rad * 0.30))
        d = ctr - cam.location
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = os.path.join(PREVIEW_DIR, f"_{species}_{i}.png")
        bpy.ops.render.render(write_still=True)
    return cam


def read_png(path):
    import struct
    import zlib
    with open(path, "rb") as f:
        data = f.read()
    pos, w, h, idat = 8, 0, 0, b""
    while pos < len(data):
        ln = int.from_bytes(data[pos:pos + 4], "big")
        typ = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            w = int.from_bytes(chunk[0:4], "big")
            h = int.from_bytes(chunk[4:8], "big")
        elif typ == b"IDAT":
            idat += chunk
        pos += 12 + ln
    raw = zlib.decompress(idat)
    bpp, stride = 4, w * 4
    out = bytearray(w * h * bpp)
    prev = bytearray(stride)
    o = 0
    for y in range(h):
        ft = raw[o]
        line = bytearray(raw[o + 1:o + 1 + stride])
        o += 1 + stride
        for x in range(stride):
            a = line[x - 4] if x >= 4 else 0
            b = prev[x]
            c = prev[x - 4] if x >= 4 else 0
            if ft == 1:
                line[x] = (line[x] + a) & 255
            elif ft == 2:
                line[x] = (line[x] + b) & 255
            elif ft == 3:
                line[x] = (line[x] + (a + b) // 2) & 255
            elif ft == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, bpp, bytes(out)


def montage(paths, out):
    import struct
    import zlib
    imgs = [read_png(p) for p in paths]
    h = max(i[1] for i in imgs)
    w = sum(i[0] for i in imgs)
    bpp = 4
    canvas = bytearray(w * h * bpp)
    xoff = 0
    for (iw, ih, _, px) in imgs:
        for y in range(ih):
            canvas[(y * w + xoff) * bpp:(y * w + xoff + iw) * bpp] = px[y * iw * bpp:(y + 1) * iw * bpp]
        xoff += iw

    def chunk(t, d):
        return (len(d).to_bytes(4, "big") + t + d +
                (zlib.crc32(t + d) & 0xFFFFFFFF).to_bytes(4, "big"))

    raw = b"".join(b"\x00" + bytes(canvas[y * w * bpp:(y + 1) * w * bpp]) for y in range(h))
    png = (b"\x89PNG\r\n\x1a\n" +
           chunk(b"IHDR", w.to_bytes(4, "big") + h.to_bytes(4, "big") + b"\x08\x06\x00\x00\x00") +
           chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))
    with open(out, "wb") as f:
        f.write(png)
    for p in paths:
        try:
            os.remove(p)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

SPECIES = [("cat", CAT), ("rabbit", RABBIT), ("deer", DEER), ("fox", FOX)]

OUT_TRI = {}


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    want_preview = os.environ.get("GAME_PREVIEW", "1") != "0"
    only = [s for s in os.environ.get("GAME_ONLY", "").split(",") if s]
    jaw_open = float(os.environ.get("GAME_JAW", "0.55"))
    results = {}
    for species, S in SPECIES:
        if only and species not in only:
            continue
        reset_scene()
        mesh, rig = quadruped(S)
        results[species] = export(species, mesh, rig)
        if want_preview:
            preview(species, mesh)
            if S.get("mouth"):
                head_preview(species, mesh, S, "h")
                pose_rig(rig, {"jaw": (jaw_open, 0, 0), "tongue": (0.0, 0, 0)})
                head_preview(species, mesh, S, "o")
                pose_rig(rig, {})
            shots = sorted(os.path.join(PREVIEW_DIR, f) for f in os.listdir(PREVIEW_DIR)
                           if f.startswith("_%s_" % species))
            montage(shots[:2], os.path.join(PREVIEW_DIR, f"{species}.png"))
            if len(shots) > 2:
                montage(shots[2:], os.path.join(PREVIEW_DIR, f"{species}-head.png"))

    if only and "duck" not in only:
        print("SUMMARY " + " ".join(f"{k}={v[0]}/{v[1]}" for k, v in results.items()))
        return
    reset_scene()
    mesh, bones, S = build_duck()
    rig = bind(mesh, bones, S)
    results["duck"] = export("duck", mesh, rig)
    if want_preview:
        preview("duck", mesh)
        shots = sorted(os.path.join(PREVIEW_DIR, f) for f in os.listdir(PREVIEW_DIR)
                       if f.startswith("_duck_"))
        montage(shots, os.path.join(PREVIEW_DIR, "duck.png"))

    print("exported animals")
    print("SUMMARY " + " ".join(f"{k}={v[0]}/{v[1]}" for k, v in results.items()))


main()
