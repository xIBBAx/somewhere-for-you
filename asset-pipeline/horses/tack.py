"""Riding tack fitted to each breed's own body (Blender side).

A general-purpose leather saddle on a quilted pad, sitting just behind the
withers where the rider's weight is carried by the back muscles over the
ribs (never on the withers or the loin), a girth behind the elbows, stirrup
leathers and irons, and a snaffle bridle: crownpiece behind the ears,
browband, cheekpieces down to the bit rings at the corners of the mouth,
noseband and throatlatch. Every strap is projected onto the horse's own
signed distance field, so the same code fits a 14.2 hh Arabian and a 17 hh
draft. Reins are drawn at runtime between the bit rings and the rider's hands.

META records rider anchors in three.js model space (metres): the seat, the
stirrup treads, the bit rings and where the reins cross the withers.
"""
import math

import numpy as np

import anatomy as A

META = {}


def project(prims, pts, offset, iters=8):
    """Pull points onto the surface at `offset` along the SDF gradient."""
    from hair import sdf_grad
    X = np.array(pts, float)
    for _ in range(iters):
        d, g = sdf_grad(prims, X)
        X -= g * (d - offset)[:, None]
    _, g = sdf_grad(prims, X)
    return X, g


def strap(prims, path, width, offset, thick=0.004):
    """A flat leather strap along a projected path: a closed thin box."""
    X, N = project(prims, path, offset)
    verts, faces = [], []
    K = len(X)
    for k in range(K):
        t = X[min(k + 1, K - 1)] - X[max(k - 1, 0)]
        t /= max(1e-9, np.linalg.norm(t))
        s = np.cross(t, N[k])
        s /= max(1e-9, np.linalg.norm(s))
        for a, b in ((-0.5, 0), (0.5, 0), (0.5, 1), (-0.5, 1)):
            verts.append(X[k] + s * width * a + N[k] * thick * b)
    for k in range(K - 1):
        for j in range(4):
            a = 4 * k + j
            b = 4 * k + (j + 1) % 4
            faces.append((a, b, b + 4, a + 4))
    faces.append((0, 1, 2, 3))
    faces.append((4 * (K - 1) + 3, 4 * (K - 1) + 2, 4 * (K - 1) + 1, 4 * (K - 1)))
    return np.array(verts), faces


def ring(center, normal, radius, tube, seg=12, tseg=5):
    """A small torus (bit rings, stirrup treads)."""
    n = A.norm(np.asarray(normal, float))
    u = A.norm(np.cross(n, [0, 1, 0] if abs(n[1]) < 0.9 else [1, 0, 0]))
    w = np.cross(n, u)
    verts, faces = [], []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        c = center + (u * math.cos(a) + w * math.sin(a)) * radius
        r = A.norm(c - center)
        for j in range(tseg):
            b = 2 * math.pi * j / tseg
            verts.append(c + (r * math.cos(b) + n * math.sin(b)) * tube)
    for i in range(seg):
        for j in range(tseg):
            a = i * tseg + j
            b = i * tseg + (j + 1) % tseg
            c = ((i + 1) % seg) * tseg + (j + 1) % tseg
            d = ((i + 1) % seg) * tseg + j
            faces.append((a, b, c, d))
    return np.array(verts), faces


def build(S, prims, P, tb, tb_arr, bt_arr, mesh_obj, skin, select_only, body):
    import bpy

    H, L, J = S.H, S.L, S.joints
    hf = S.head_frame
    sc = hf["length"] / 0.6
    objs = []
    leather = bpy.data.materials.new("TackLeather")
    cloth = bpy.data.materials.new("TackCloth")
    metal = bpy.data.materials.new("TackMetal")

    def surface_y(x, z, off):
        """Top of the back at (x, z), marching down from above."""
        ys = np.linspace(H * 1.25, H * 0.3, 400)
        pts = np.stack([np.full_like(ys, x), ys, np.full_like(ys, z)], 1)
        d = A.evaluate(prims, pts)
        i = np.nonzero(d < off)[0]
        return ys[i[0]] if len(i) else None

    torso_bones = lambda pts: _torso_weights(S, prims, pts)

    # ---- saddle pad: draped over the back from behind the withers ----------
    tandem = bool(P.get("tandem"))
    # a tandem (two-seat) saddle runs back over the loin of a long-backed build
    z_front, z_back = 0.26 * L, (-0.31 if tandem else -0.07) * L
    nx, nz = 15, 11
    pad_v = []
    for iz in range(nz):
        z = z_front + (z_back - z_front) * iz / (nz - 1)
        for ix in range(nx):
            u = ix / (nx - 1) * 2 - 1
            # arc length across the back: the pad hangs ~0.33 H down each side
            ang = u * 1.25
            pad_v.append([math.sin(ang) * 0.6, H * 1.3, z, ang])
    pad = []
    top = surface_y(0, 0.08 * L, 0.0)
    for x, y, z, ang in pad_v:
        # start above the spine and wrap around the barrel at a fixed offset
        dirn = np.array([math.sin(ang), math.cos(ang), 0])
        start = np.array([0, top - 0.15 * H, z]) + dirn * 0.6
        pts = start[None] - dirn[None] * np.linspace(0, 0.6, 300)[:, None]
        d = A.evaluate(prims, pts)
        i = np.nonzero(d < 0.014)[0]
        pad.append(pts[i[0]] if len(i) else start)
    pad = np.array(pad)
    faces = []
    for iz in range(nz - 1):
        for ix in range(nx - 1):
            a = iz * nx + ix
            faces.append((a, a + nx, a + nx + 1, a + 1))
    ob = mesh_obj("tack_pad", tb_arr(pad), faces)
    sol = ob.modifiers.new("s", "SOLIDIFY")
    sol.thickness = 0.012
    sol.offset = 1
    select_only(ob)
    bpy.ops.object.modifier_apply(modifier="s")
    ob.data.materials.append(cloth)
    for poly in ob.data.polygons:
        poly.use_smooth = True
    skin(ob, weights_fn=lambda pts: torso_bones(pts))
    objs.append(ob)

    # ---- saddle: tree, seat dipping between pommel and cantle, flaps --------
    zf, zb = 0.21 * L, (-0.27 if tandem else -0.03) * L
    nx, nz = 13, (22 if tandem else 12)
    sad = []
    for iz in range(nz):
        v = iz / (nz - 1)
        z = zf + (zb - zf) * v
        # pommel in front, a deep seat, a raised cantle behind
        rise = 0.035 * math.exp(-((v - 0.0) / 0.12) ** 2) + 0.055 * math.exp(-((v - 1.0) / 0.14) ** 2) + 0.01
        if tandem:
            # pommel, front seat, a low cantle-and-pommel between the riders, rear seat, cantle
            rise = (0.035 * math.exp(-(v / 0.07) ** 2) + 0.03 * math.exp(-((v - 0.5) / 0.06) ** 2)
                    + 0.055 * math.exp(-((v - 1.0) / 0.08) ** 2) + 0.01)
        for ix in range(nx):
            u = ix / (nx - 1) * 2 - 1
            ang = u * (0.95 if 0.15 < v < 0.85 else 0.75)
            dirn = np.array([math.sin(ang), math.cos(ang), 0])
            start = np.array([0, top - 0.15 * H, z]) + dirn * 0.6
            pts = start[None] - dirn[None] * np.linspace(0, 0.6, 300)[:, None]
            d = A.evaluate(prims, pts)
            i = np.nonzero(d < 0.03)[0]
            p = pts[i[0]] if len(i) else start
            # the seat is raised over the spine (gullet) and shaped by the rise
            p = p + dirn * (rise * max(0, math.cos(ang * 1.4)) + 0.006)
            sad.append(p)
    sad = np.array(sad)
    faces = []
    for iz in range(nz - 1):
        for ix in range(nx - 1):
            a = iz * nx + ix
            faces.append((a, a + nx, a + nx + 1, a + 1))
    ob = mesh_obj("tack_saddle", tb_arr(sad), faces)
    sol = ob.modifiers.new("s", "SOLIDIFY")
    sol.thickness = 0.022
    sol.offset = -1
    select_only(ob)
    bpy.ops.object.modifier_apply(modifier="s")
    for poly in ob.data.polygons:
        poly.use_smooth = True
    ob.data.materials.append(leather)
    skin(ob, weights_fn=lambda pts: torso_bones(pts))
    objs.append(ob)
    seat = sad[(nz // 2) * nx + nx // 2] + np.array([0, 0.012, -0.02 * L])
    if tandem:
        seat = sad[int(nz * 0.27) * nx + nx // 2] + np.array([0, 0.012, 0])
        seat2 = sad[int(nz * 0.76) * nx + nx // 2] + np.array([0, 0.012, 0])
        META["seat2"] = seat2.tolist()
    META["seat"] = seat.tolist()
    META["seatBone"] = "spine2"
    META["pommel"] = sad[nx // 2].tolist()
    META["cantle"] = sad[(nz - 1) * nx + nx // 2].tolist()

    # ---- girth, stirrup leathers and irons ---------------------------------
    zg = 0.27 * L
    path = []
    for a in np.linspace(-1.05, 1.05, 24):
        dirn = np.array([math.sin(math.pi - a * 1.0) * 1.0, math.cos(math.pi - a), 0])
        path.append(np.array([0, (top + 0.49 * H) / 2 * 0.98, zg]) + dirn * 0.5)
    v, f = strap(prims, path, 0.07, 0.006, 0.008)
    girth = mesh_obj("tack_girth", tb_arr(v), f)
    girth.data.materials.append(leather)
    skin(girth, weights_fn=lambda pts: torso_bones(pts))
    objs.append(girth)
    stirrups = [("L", 1, 0.15, ""), ("R", -1, 0.15, "")]
    if tandem:
        stirrups += [("L", 1, -0.12, "2"), ("R", -1, -0.12, "2")]
    for side, sx, zbar, tag in stirrups:
        # leathers hang from the stirrup bar under the skirt, irons at about
        # the bottom of the barrel where a rider's foot rests
        bar = np.array([sx * 0.0, top - 0.03, zbar * L])
        bar, _ = project(prims, [bar + np.array([sx * 0.4, 0, 0])], 0.04)
        bar = bar[0]
        iron_y = J["spine2"][1] - 0.36 * H
        foot = np.array([bar[0] + sx * 0.07, iron_y, (zbar - 0.02) * L])
        pts = [A.lerp(bar, foot, t) for t in np.linspace(0, 1, 8)]
        verts = []
        faces = []
        for k, p in enumerate(pts):
            for a, b in ((-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)):
                verts.append(p + np.array([0, 0, 0.032 * a]) + np.array([sx, 0, 0]) * 0.004 * b)
        for k in range(len(pts) - 1):
            for j in range(4):
                a = 4 * k + j
                b = 4 * k + (j + 1) % 4
                faces.append((a, b, b + 4, a + 4))
        ob = mesh_obj(f"tack_leather{side}{tag}", tb_arr(np.array(verts)), faces)
        ob.data.materials.append(leather)
        skin(ob, fixed={"spine2": 0.6, "chest": 0.4})
        objs.append(ob)
        iv, ifc = ring(foot - np.array([0, 0.06, 0]), [sx, 0, 0], 0.055, 0.008)
        ob = mesh_obj(f"tack_iron{side}{tag}", tb_arr(iv), ifc)
        ob.data.materials.append(metal)
        skin(ob, fixed={"spine2": 0.6, "chest": 0.4})
        objs.append(ob)
        META[f"stirrup{side}{tag}"] = (foot - np.array([0, 0.105, 0])).tolist()

    # ---- bridle ---------------------------------------------------------------
    hp = S.hp
    off = 0.004
    paths = []
    for sx in (1, -1):
        # cheekpiece: from behind the ear down the side of the face to the bit
        paths.append([hp(0.02 + 0.84 * t, 0.07 * sc * (1 - t) - 0.035 * sc * t, sx * (0.09 - 0.025 * t) * sc) for t in np.linspace(0, 1, 16)])
    # crownpiece over the poll behind the ears
    paths.append([hp(0.0, 0.0, 0) + np.array([math.sin(a), 0, 0]) * 0.11 * sc + np.array(hf["dorsal"]) * math.cos(a) * 0.09 * sc
                  for a in np.linspace(-1.6, 1.6, 14)])
    # browband in front of the ears
    paths.append([hp(0.07, 0.0, 0) + np.array([math.sin(a), 0, 0]) * 0.1 * sc + np.array(hf["dorsal"]) * math.cos(a) * 0.08 * sc
                  for a in np.linspace(-1.4, 1.4, 12)])
    # noseband two thirds of the way down the face, all the way round
    paths.append([hp(0.68, 0.0, 0) + np.array([math.sin(a), 0, 0]) * 0.09 * sc + np.array(hf["dorsal"]) * math.cos(a) * 0.09 * sc
                  for a in np.linspace(-math.pi, math.pi, 22)])
    # throatlatch under the jaw
    paths.append([hp(0.08, -0.04 * sc, 0) + np.array([math.sin(a), 0, 0]) * 0.1 * sc - np.array(hf["dorsal"]) * math.cos(a) * 0.17 * sc
                  for a in np.linspace(-1.5, 1.5, 14)])
    allv, allf = [], []
    for path in paths:
        v, f = strap(prims, [np.asarray(p) for p in path], 0.02 * sc, off)
        base = sum(len(x) for x in allv)
        allv.append(v)
        allf += [tuple(i + base for i in face) for face in f]
    for sx, side in ((1, "L"), (-1, "R")):
        c = hp(0.9, -0.045 * sc, sx * 0.062 * sc)
        c, _ = project(prims, [c], 0.012)
        rv, rf = ring(c[0], [sx, 0, 0], 0.024 * sc, 0.004)
        base = sum(len(x) for x in allv)
        allv.append(rv)
        allf += [tuple(i + base for i in face) for face in rf]
        META[f"bit{side}"] = c[0].tolist()
    bridle = mesh_obj("tack_bridle", tb_arr(np.concatenate(allv)), allf)
    bridle.data.materials.append(leather)
    skin(bridle, fixed={"head": 1.0})
    objs.append(bridle)
    for o in objs:
        for poly in o.data.polygons:
            poly.use_smooth = True
    # reins rest on the neck just in front of the withers when nobody holds them
    withers_front = A.lerp(J["neck1"], J["neck2"], 0.25)
    w, _ = project(prims, [withers_front + np.array([0, 0.4, 0])], 0.02)
    META["reinRest"] = w[0].tolist()
    return objs


def _torso_weights(S, prims, pts):
    """Tack rides with the back: weights from the trunk bones only."""
    names = ["hips", "spine1", "spine2", "chest"]
    zs = np.array([S.joints[n][2] for n in names])
    idx = np.zeros((len(pts), 4), dtype=int)
    w = np.zeros((len(pts), 4))
    z = pts[:, 2]
    for i in range(len(pts)):
        j = int(np.clip(np.searchsorted(zs, z[i]) - 1, 0, 2))
        t = float(np.clip((z[i] - zs[j]) / (zs[j + 1] - zs[j]), 0, 1))
        idx[i, 0] = A.BONE_ORDER.index(names[j])
        idx[i, 1] = A.BONE_ORDER.index(names[j + 1])
        w[i, 0], w[i, 1] = 1 - t, t
    return idx, w


def lod(objs):
    return [o for o in objs if o.name in ("tack_saddle", "tack_pad", "tack_bridle")]
