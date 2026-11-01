"""Mane, forelock, tail and feathering as alpha hair cards (Blender side).

Each lock of hair is a chain of points simulated under gravity with Verlet
integration and collided against the horse's own signed distance field, so
the mane falls over the crest onto the off (right) side of the neck the way
a trained mane lies, the forelock drops over the forehead between the eyes,
and the tail hangs from the dock clear of the quarters. The settled chains
become ribbons ("cards") whose width lies along the coat. The strand texture
is generated at runtime; cards carry v = 0 at the root and 1 at the tip, so
the shader can let the tips move more than the roots.
"""
import math

import numpy as np

import anatomy as A


def sdf_grad(prims, X, e=0.004):
    d = A.evaluate(prims, X)
    g = np.zeros_like(X)
    for i in range(3):
        o = np.zeros(3)
        o[i] = e
        g[:, i] = (A.evaluate(prims, X + o) - A.evaluate(prims, X - o)) / (2 * e)
    n = np.linalg.norm(g, axis=1, keepdims=True)
    return d, g / np.maximum(n, 1e-9)


def near(prims, X, margin=0.25):
    """Only the masses whose bounds come near the hair can touch it."""
    lo = X.reshape(-1, 3).min(0) - margin
    hi = X.reshape(-1, 3).max(0) + margin
    res = []
    for pr in prims:
        a, b = pr.bounds()
        if np.all(b >= lo) and np.all(a <= hi):
            res.append(pr)
    return res


def simulate(prims, roots, dirs, lengths, K, offset, iters=55, stiff=0.0, wave=None, rng=None):
    """Hang N chains of K points from `roots`, initially along `dirs`."""
    N = len(roots)
    seg = (lengths / (K - 1))[:, None]
    X = roots[:, None, :] + dirs[:, None, :] * (np.arange(K)[None, :, None] * seg[:, :, None])
    if wave is not None:
        X += wave
    local = near(prims, np.concatenate([X.reshape(-1, 3), (roots[:, None, :] + np.array([0, -1, 0]) * lengths[:, None, None]).reshape(-1, 3)]))
    prev = X.copy()
    g = np.array([0, -9.8, 0]) * (1 / 60) ** 2
    for it in range(iters):
        V = (X - prev) * 0.9
        prev = X.copy()
        X = X + V + g * 3
        X[:, 0] = roots
        for _ in range(3):
            for k in range(1, K):
                d = X[:, k] - X[:, k - 1]
                ln = np.linalg.norm(d, axis=1, keepdims=True)
                X[:, k] = X[:, k - 1] + d / np.maximum(ln, 1e-9) * seg
            # gentle stiffness keeps short manes standing off the crest
            if stiff > 0:
                for k in range(2, K):
                    want = 2 * X[:, k - 1] - X[:, k - 2]
                    X[:, k] += (want - X[:, k]) * stiff
        # collide with the body
        flat = X.reshape(-1, 3)
        dd, gg = sdf_grad(local, flat)
        flat -= gg * np.minimum(0, dd - offset)[:, None]
        X = flat.reshape(N, K, 3)
        X[:, 0] = roots
    return X


def surface_point(prims, start, direction, max_dist=0.6, offset=0.0):
    """March from `start` along `direction` until the SDF changes sign."""
    pts = start[None, :] + direction[None, :] * np.linspace(0, max_dist, 240)[:, None]
    d = A.evaluate(prims, pts)
    inside = np.nonzero(d < offset)[0]
    if len(inside) == 0:
        return None
    return pts[inside[0]]


def ribbons(X, widths, normals_fn, uvx):
    """Cards along chains: width across (tangent x surface normal)."""
    verts, faces, uvs, nrm = [], [], [], []
    N, K, _ = X.shape
    for i in range(N):
        base = len(verts)
        for k in range(K):
            t = X[i, min(k + 1, K - 1)] - X[i, max(k - 1, 0)]
            t /= max(1e-9, np.linalg.norm(t))
            n = normals_fn(X[i, k])
            side = np.cross(t, n)
            side /= max(1e-9, np.linalg.norm(side))
            w = widths[i] * (1.0 - 0.45 * (k / (K - 1)) ** 2)
            for s in (-0.5, 0.5):
                verts.append(X[i, k] + side * w * s + n * 0.002)
                uvs.append((uvx[i][0] + (s + 0.5) * (uvx[i][1] - uvx[i][0]), k / (K - 1)))
                nrm.append(n)
        for k in range(K - 1):
            a = base + 2 * k
            faces.append((a, a + 1, a + 3, a + 2))
    return np.array(verts), faces, np.array(uvs), np.array(nrm)


def grow(S, prims, P, tb_arr, mesh_obj, skin, quality=1):
    rng = np.random.default_rng(abs(hash(S.breed)) % (2 ** 32))
    H = S.H
    J = S.joints
    out = []
    hf = S.head_frame
    sc = hf["length"] / 0.6

    def normals_fn(p):
        _, g = sdf_grad(prims, p[None, :])
        return g[0]

    def make(name, X, widths, bones_fn):
        uvx = []
        for _ in range(len(X)):
            u0 = rng.uniform(0, 0.75)
            uvx.append((u0, u0 + 0.25))
        verts, faces, uvs, nrm = ribbons(X, widths, normals_fn, uvx)
        ob = mesh_obj(name, tb_arr(verts), faces, uvs)
        me = ob.data
        for poly in me.polygons:
            poly.use_smooth = True
        # light the cards like the mass of hair they belong to, not as planes
        try:
            me.normals_split_custom_set_from_vertices([tuple(v) for v in tb_arr(nrm)])
        except Exception as e:  # pragma: no cover
            print("[hair] custom normals unavailable:", e)
        skin(ob, weights_fn=lambda Pts: bones_fn(Pts, verts))
        out.append(ob)
        return ob

    def body_weights_at_roots(K):
        def fn(_pts, verts):
            # every vertex of a strand takes its root's weights
            roots = verts[::2 * K]
            idx, w = A.bone_weights(S, prims, roots)
            per = 2 * K
            return np.repeat(idx, per, axis=0)[:len(verts)], np.repeat(w, per, axis=0)[:len(verts)]
        return fn

    # ---- mane -------------------------------------------------------------
    n1, n2, n3, poll = J["neck1"], J["neck2"], J["neck3"], J["head"]
    crest = [A.lerp(n1, n2, t) for t in np.linspace(0.15, 1, 5)] + [A.lerp(n2, n3, t) for t in np.linspace(0.2, 1, 4)] + \
        [A.lerp(n3, poll, t) for t in np.linspace(0.25, 0.92, 4)]
    crest = np.array(crest)
    # densify the crest line
    ts = np.linspace(0, len(crest) - 1, int((44 if quality else 26) * P["mane_vol"] ** 0.5))
    line = np.array([A.lerp(crest[int(min(t, len(crest) - 2))], crest[int(min(t, len(crest) - 2)) + 1], t - int(min(t, len(crest) - 2)))
                     for t in ts])
    roots, dirs, lens = [], [], []
    for i, c in enumerate(line):
        tan = line[min(i + 1, len(line) - 1)] - line[max(i - 1, 0)]
        tan /= np.linalg.norm(tan)
        dor = np.array([0, tan[2], -tan[1]])
        hit = surface_point(prims, c + dor * 0.45, -dor, 0.6, -0.004)
        if hit is None:
            continue
        for layer in range(3 if quality else 2):
            jitter = np.array([rng.normal(0, 0.006), 0, 0])
            roots.append(hit + jitter + np.array([0.004 * (1 - 2 * layer), 0, 0]))
            # trained to lie on the off side, standing up a little at the root
            d = A.norm(dor * 0.55 + np.array([-1.0, 0, 0]) * 0.8 - tan * 0.15)
            dirs.append(d)
            u = i / max(1, len(line) - 1)
            # shorter at the withers and poll, longest mid-neck
            taper = 0.75 + 0.35 * math.sin(math.pi * min(1, u * 1.2))
            lens.append(P["mane_len"] * taper * rng.uniform(0.8, 1.15) * (0.75 + 0.125 * layer) + 0.03)
    roots, dirs, lens = np.array(roots), np.array(dirs), np.array(lens)
    K = 7 if P["mane_len"] < 0.3 else 9
    wave = None
    if P["mane_wave"] > 0:
        ks = np.arange(K)[None, :, None] / (K - 1)
        phase = rng.uniform(0, 6.28, len(roots))[:, None, None]
        wave = np.sin(ks * 9 + phase) * P["mane_wave"] * 0.025 * ks * np.array([0, 0, 1])[None, None, :]
    X = simulate(prims, roots, dirs, lens, K, 0.012, stiff=0.25 if P["mane_len"] < 0.2 else 0.05, wave=wave)
    widths = rng.uniform(0.055, 0.085, len(roots)) * P["mane_vol"] ** 0.4
    make("mane", X, widths, body_weights_at_roots(K))

    # ---- forelock ------------------------------------------------------------
    roots, dirs, lens = [], [], []
    for i in range(6 if quality else 3):
        x = (i / 5 - 0.5) * 0.06 * sc if quality else (i / 2 - 0.5) * 0.05 * sc
        c = S.hp(0.0, 0.12 * sc, x)
        hit = surface_point(prims, c, -np.array(hf["dorsal"]) * 0.6 - np.array(hf["axis"]) * 0.4, 0.4, -0.003)
        if hit is None:
            continue
        roots.append(hit)
        dirs.append(A.norm(np.array(hf["axis"]) * 0.9 + np.array(hf["dorsal"]) * 0.4))
        lens.append(P["forelock"] * rng.uniform(0.8, 1.1) + 0.04)
    if roots:
        X = simulate(prims, np.array(roots), np.array(dirs), np.array(lens), 6, 0.008, stiff=0.1)
        idxw = lambda Pts, verts: (np.tile([A.BONE_ORDER.index("head"), 0, 0, 0], (len(verts), 1)),
                                   np.tile([1.0, 0, 0, 0], (len(verts), 1)))
        make("forelock", X, rng.uniform(0.04, 0.055, len(roots)), idxw)

    # ---- tail -------------------------------------------------------------------
    t1, t2, t3 = J["tail1"], J["tail2"], J["tail3"]
    dock = [A.lerp(t1, t2, 0.5), t2, A.lerp(t2, t3, 0.5), t3]
    roots, dirs, lens = [], [], []
    ring = 12 if quality else 7
    for di, c in enumerate(dock):
        for j in range(ring):
            a = 2 * math.pi * j / ring + di * 0.4
            off = np.array([math.cos(a), math.sin(a) * 0.5, 0]) * 0.03 * H / 1.6
            roots.append(c + off)
            dirs.append(A.norm(np.array([math.cos(a) * 0.25, -1.0, -0.35])))
            reach = c[1] - 0.06  # never longer than reaching the ground
            lens.append(min(reach, P["tail_len"] * rng.uniform(0.82, 1.05) * (1 - di * 0.08)))
    roots, dirs, lens = np.array(roots), np.array(dirs), np.array(lens)
    K = 10
    X = simulate(prims, roots, dirs, lens, K, 0.02, stiff=0.0)
    # the tail fans a little towards its end and is fuller on baroque breeds
    widths = rng.uniform(0.07, 0.1, len(roots)) * P["tail_vol"] ** 0.6
    tail_chain = np.array([J[f"tail{i}"] for i in range(1, 7)] + [S.tails["tail6"]])

    def tail_weights(_pts, verts):
        vs = verts
        best = np.full(len(vs), np.inf)
        idx = np.zeros((len(vs), 4), dtype=int)
        w = np.zeros((len(vs), 4))
        segs = []
        for i in range(6):
            a, b = tail_chain[i], tail_chain[i + 1]
            ab = b - a
            t = np.clip(((vs - a) @ ab) / (ab @ ab), 0, 1)
            d = np.linalg.norm(vs - (a + t[:, None] * ab), axis=1)
            segs.append((d, t))
        D = np.stack([s[0] for s in segs], 1)
        j = np.argmin(D, 1)
        t = np.array([segs[jj][1][k] for k, jj in enumerate(j)])
        b0 = np.array([A.BONE_ORDER.index(f"tail{jj + 1}") for jj in j])
        b1 = np.array([A.BONE_ORDER.index(f"tail{min(6, jj + 2)}") for jj in j])
        idx[:, 0], idx[:, 1] = b0, b1
        w[:, 0], w[:, 1] = 1 - t * 0.5, t * 0.5
        return idx, w

    make("tail", X, widths, tail_weights)

    # ---- feathering (Friesian, draft) -----------------------------------------
    if P["feather"] > 0.05:
        roots, dirs, lens = [], [], []
        for leg in ("FL", "FR", "BL", "BR"):
            fet = J[f"pastern{leg}"]
            cannon = J[f"cannon{leg}"]
            for i in range(8 if quality else 4):
                hgt = A.lerp(fet, cannon, rng.uniform(-0.05, 0.45) * P["feather"])
                a = rng.uniform(-2.2, 2.2)  # mostly behind and to the sides
                dirn = np.array([math.sin(a), 0, -math.cos(a)])
                hit = surface_point(prims, hgt + dirn * 0.15, -dirn, 0.2, -0.002)
                if hit is None:
                    continue
                roots.append(hit)
                dirs.append(A.norm(dirn * 0.4 + np.array([0, -1, 0])))
                lens.append(min(hit[1] - 0.005, 0.1 + 0.2 * P["feather"] * rng.uniform(0.7, 1.1)))
        if roots:
            K = 5
            X = simulate(prims, np.array(roots), np.array(dirs), np.array(lens), K, 0.008)
            make("feather", X, rng.uniform(0.04, 0.06, len(roots)), body_weights_at_roots(K))
    return out


def lod(objs, select_only):
    """Far tier: decimate the cards (keeps silhouettes of mane and tail)."""
    import bpy
    res = []
    for ob in objs:
        select_only(ob)
        d = ob.modifiers.new("lod", "DECIMATE")
        d.ratio = 0.4
        ob.modifiers.move(len(ob.modifiers) - 1, 0)
        bpy.ops.object.modifier_apply(modifier="lod")
        res.append(ob)
    return res
