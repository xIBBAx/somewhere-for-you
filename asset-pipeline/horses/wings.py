"""Feathered wings, and Starborn's horn, for the winged builds (Blender side).

Each wing is built in its spread (gliding) rest pose on the five-bone wing
chain from anatomy.wing_skeleton: shoulder girdle, humerus, forearm, hand and
digits. The game folds, flaps and fans it procedurally (WingAnimator).

The wing follows a bird's feather topography:

  primaries      10 on the hand and digits, fanning from the trailing edge
                 to the tip; on the eagle-type "slot" wing the outer six are
                 emarginated (they narrow abruptly), so the spread tip opens
                 into fingers
  secondaries    along the forearm, the trailing edge of the inner wing
  tertials       on the distal humerus, closing the gap to the body
  coverts        greater, median and lesser (marginal) rows shingled over the
                 bases of the flight feathers, primary coverts over the hand,
                 a row of underwing coverts beneath
  alula          the bastard wing at the wrist's leading edge
  scapulars      long contour feathers over the wing root, hiding the joint
                 with the body

Every feather is a cambered card with a central rachis ridge, rigidly bound
to the bone it grows from (blended across a joint near it), so folding the
hand slides the primaries under the secondaries as in a real wing. The
feather atlas is painted here in numpy: vane outline (narrow outer vane on
flight feathers), rachis, barbs with the odd split, barring and tip colours
for each Pegasus. Nothing is downloaded.
"""
import math

import numpy as np

import anatomy as A

# atlas columns (each 256 px wide, 1024 px tall; the feather base at v = 0)
COLS = ["primary", "slotted", "secondary", "tertial", "covert", "small", "contour", "arm"]
ATLAS_W, ATLAS_H = 256 * len(COLS), 1024

# vane half-widths (units of the card's half-width): inner, outer
VANE = {"primary": (1.0, 0.38), "slotted": (1.0, 0.38), "secondary": (1.0, 0.62), "tertial": (1.0, 0.8),
        "covert": (1.0, 0.9), "small": (1.0, 1.0), "contour": (1.0, 1.0)}

# Pegasus palettes (sRGB 0..1): flight feathers, coverts, contour, rachis,
# tip colour and how far up the feather it runs, barring strength, edge
# colour and width, star specks
PALETTES = {
    "ivory": dict(flight=(0.93, 0.925, 0.915), flight2=(0.84, 0.86, 0.9), covert=(0.95, 0.94, 0.925), contour=(0.95, 0.94, 0.93),
                 rachis=(0.8, 0.8, 0.82), tip=(0.84, 0.77, 0.6), tip_len=0.16, bars=0.0, edge=(0.99, 0.985, 0.97), edge_w=0.0,
                 stars=0.0, arm=(0.94, 0.93, 0.92)),
    "onyx": dict(flight=(0.14, 0.095, 0.07), flight2=(0.2, 0.15, 0.11), covert=(0.42, 0.28, 0.15), contour=(0.56, 0.39, 0.2),
                    rachis=(0.32, 0.26, 0.2), tip=(0.06, 0.045, 0.04), tip_len=0.22, bars=0.55, edge=(0.3, 0.22, 0.15), edge_w=0.0,
                    stars=0.0, arm=(0.36, 0.24, 0.13)),
    # Starborn, the star-born: moon-silver wings on her midnight coat, each
    # feather dusking through violet into the night sky at its tip, where
    # her stars are; silver-cyan margins and bright shafts (the runtime runs
    # her light up them, horseAssets.ts)
    "starborn": dict(flight=(0.8, 0.8, 0.9), flight2=(0.89, 0.89, 0.95), covert=(0.9, 0.9, 0.95), contour=(0.92, 0.91, 0.96),
                   rachis=(0.98, 0.98, 1.0), tip=(0.1, 0.07, 0.28), dusk=(0.52, 0.38, 0.8), tip_len=0.5, bars=0.0,
                   edge=(0.8, 0.9, 1.0), edge_w=0.04, stars=1.0, arm=(0.87, 0.87, 0.94)),
}

# feather groups (0 tertials, 1-2 inner/outer secondaries, 3-4 inner/outer
# primaries): the range of flight-feather angles in each, filled by build_wing
# and written to the GLB so the game can fold every feather about its base
GROUPS: dict[int, list[float]] = {}

PRIMARY_LENGTHS = {
    "soar": [0.62, 0.68, 0.74, 0.8, 0.86, 0.91, 0.96, 1.0, 0.99, 0.93],
    "slot": [0.66, 0.72, 0.79, 0.86, 0.92, 0.97, 1.0, 0.98, 0.92, 0.8],
    "swan": [0.64, 0.71, 0.78, 0.85, 0.92, 0.98, 1.03, 1.07, 1.05, 0.95],
}
# primary fan: angle out from straight back (deg) of P1 and P10
PRIMARY_FAN = {"soar": (16, 72), "slot": (18, 90), "swan": (17, 80)}


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _hash(*a):
    x = np.zeros_like(a[0], dtype=np.float64)
    for i, ai in enumerate(a):
        x = x + ai * (12.9898 + 61.7 * i)
    return np.modf(np.sin(x) * 43758.5453)[0] % 1.0


# --------------------------------------------------------------------------
# the feather atlas


def paint_atlas(breed: str) -> np.ndarray:
    """RGBA float atlas, rows bottom-up (Blender's pixel order)."""
    pal = PALETTES[breed]
    img = np.zeros((ATLAS_H, ATLAS_W, 4), dtype=np.float32)
    H, W = ATLAS_H, 256
    t = (np.arange(H)[:, None] + 0.5) / H                       # along, 0 base .. 1 tip
    c = ((np.arange(W)[None, :] + 0.5) / W) * 2 - 1             # across, -1 inner .. +1 outer
    t = np.broadcast_to(t, (H, W))
    c = np.broadcast_to(c, (H, W))
    rng = np.random.default_rng({"ivory": 11, "onyx": 23, "starborn": 37}[breed])
    for ci, kind in enumerate(COLS):
        x0 = ci * W
        if kind == "arm":
            img[:, x0:x0 + W] = _paint_arm(pal, t, c)
            continue
        wi, wo = VANE[kind]
        flight = kind in ("primary", "slotted", "secondary", "tertial")
        # envelope: a quick rise from the calamus, a long parallel vane and a
        # rounded (coverts) or tapering (primaries) tip
        rise = smooth(0.03, 0.2 if flight else 0.3, t) ** 0.6
        if kind in ("primary", "slotted"):
            tip = (1 - smooth(0.66, 1.0, t)) ** 0.5
        elif kind in ("covert", "small", "contour"):
            tip = np.sqrt(np.clip(1 - ((t - 0.42) / 0.58) ** 2, 0, 1)) * (t > 0.42) + (t <= 0.42)
        else:
            # secondaries and tertials end blunt and rounded
            tip = np.sqrt(np.clip(1 - ((t - 0.8) / 0.2) ** 2, 0, 1)) * (t > 0.8) + (t <= 0.8)
        env = rise * tip
        win = wi * env
        wout = wo * env
        if kind == "slotted":
            # emargination: both vanes narrow abruptly beyond the notch
            win = win * (1 - 0.48 * smooth(0.44, 0.56, t))
            wout = wout * (1 - 0.62 * smooth(0.38, 0.5, t))
        # the rachis curves a touch towards the inner vane at the tip
        rx = -0.05 * t ** 2
        du = c - rx
        lim = np.where(du < 0, win, wout)
        a = np.abs(du)
        edge = 0.025
        alpha = smooth(lim + edge * 0.5, lim - edge * 0.5, a)
        # barbs run out from the rachis towards the tip
        barb = t * (H / W) * 3.6 - a * 1.25
        lines = np.sin(barb * 2 * math.pi * 9.0)
        # the odd split between barbs: rare, and only in the outer half of the
        # vane where real ones open (frequent splits read as a comb)
        splitc = np.floor(barb * 9.0 * 0.5)
        split = (_hash(splitc, np.sign(du)) > (0.986 if flight else 0.993)) & (a > 0.5 * lim) & (t > 0.3)
        alpha = alpha * np.where(split, smooth(0.5, 1.0, np.abs(np.modf(barb * 4.5)[0] - 0.5) * 2) * 0.0 + 0.0, 1.0)
        # downy base: thin, translucent afterfeather near the calamus
        down = (1 - smooth(0.05, 0.16, t)) * smooth(lim * 1.4, 0, a) * 0.55
        alpha = np.maximum(alpha, down * (a > 0.06))
        rachis_w = 0.035 * (1 - t) + 0.01
        rach = smooth(rachis_w, rachis_w * 0.4, a) * (t < 0.985)
        alpha = np.maximum(alpha, rach * (t < 0.96))
        # colour
        base = np.array(pal["covert"] if kind in ("covert", "small") else pal["contour"] if kind == "contour" else pal["flight"])
        inner2 = np.array(pal["flight2"])
        col = np.broadcast_to(base, (H, W, 3)).copy()
        if flight:
            # inner vane carries the second tone, shading off along the feather
            m = (du < 0) * smooth(0.2, 0.9, a / np.maximum(lim, 1e-3)) * 0.55
            col = col * (1 - m[..., None]) + inner2 * m[..., None]
        if kind in ("covert", "small"):
            col = col * (1 - 0.35 * smooth(0.6, 0.0, t)[..., None]) + np.array(pal["flight"]) * (0.35 * smooth(0.6, 0.0, t))[..., None]
        # tips
        tl = pal["tip_len"] * (1.0 if flight else 0.6)
        tm = smooth(1 - tl, 1 - tl * 0.25, t)[..., None]
        if "dusk" in pal:
            # a dusk between: the feather passes through violet into night
            dm = smooth(1 - tl, 1 - tl * 0.55, t)[..., None]
            col = col * (1 - dm) + np.array(pal["dusk"]) * dm
            tm = smooth(1 - tl * 0.6, 1 - tl * 0.1, t)[..., None]
        col = col * (1 - tm) + np.array(pal["tip"]) * tm
        # barring across the vane (eagle)
        if pal["bars"] > 0 and kind != "small":
            # uneven spacing and mottled strength: an eagle's bars are never a ruler
            phase = t * 7.5 + 0.45 * np.sin(t * 9.3 + 1.7 + ci) + a * 0.35 * (1 if kind != "contour" else 0)
            bars = 0.5 + 0.5 * np.sin(phase * 2 * math.pi)
            mott = 0.7 + 0.3 * np.sin(t * 3.1 + c * 1.9 + ci * 2.3) * np.sin(t * 5.3 - c * 0.7)
            bars = smooth(0.35, 0.8, bars) * mott * pal["bars"] * (1 - tm[..., 0] * 0.6) * smooth(0.12, 0.3, t)
            light = col * 1.65 + 0.03
            col = col * (1 - bars[..., None]) + light * bars[..., None]
        # pale edge (Starborn's silver margins)
        if pal["edge_w"] > 0:
            em = smooth(lim - pal["edge_w"] * (1.6 if flight else 1.0), lim - 0.004, a) * (t > 0.12)
            col = col * (1 - em[..., None]) + np.array(pal["edge"]) * em[..., None]
        # barb ripples and a little tonal noise
        n = rng.normal(0, 1, (H // 8 + 1, W // 8 + 1)).repeat(8, 0).repeat(8, 1)[:H, :W]
        col = col * (1 + 0.05 * lines[..., None] + 0.03 * n[..., None])
        # the rachis
        col = col * (1 - rach[..., None]) + np.array(pal["rachis"]) * rach[..., None]
        # star specks (Starborn): tiny bright points scattered through the vane
        if pal["stars"] > 0:
            sp = rng.random((H, W)) > 0.994
            sp = sp & (a < lim * 0.92) & (t > 0.15) & (tm[..., 0] > 0.35)
            col[sp] = np.array([0.92, 0.95, 1.0])
        img[:, x0:x0 + W, :3] = np.clip(col, 0, 1)
        img[:, x0:x0 + W, 3] = np.clip(alpha, 0, 1)
    return img


def _paint_arm(pal, t, c):
    """The wing arm's covering of tiny marginal coverts: soft, small,
    irregular scallops in staggered rows, so the leading edge reads as
    feathered rather than skin (or a quilt)."""
    H, W = t.shape
    out = np.zeros((H, W, 4), dtype=np.float32)
    rows = t * 150.0
    k = np.floor(rows)
    jit = _hash(k, k * 0.37) * 0.6
    cols = (c * 0.5 + 0.5) * 24.0 + jit + (k % 2) * 0.5
    ci = np.floor(cols)
    fx = np.modf(cols)[0] - 0.5
    fy = np.modf(rows)[0]
    size = 0.75 + 0.5 * _hash(ci, k)
    scallop = np.clip(1 - (fx * 2 / size) ** 2 - (1 - fy) * 0.7, 0, 1)
    tone = 0.93 + 0.07 * _hash(ci + 3.1, k + 7.7)
    col = np.array(pal["arm"]) * (tone * (0.92 + 0.1 * scallop))[..., None]
    out[..., :3] = np.clip(col, 0, 1)
    out[..., 3] = 1.0
    return out


# --------------------------------------------------------------------------
# geometry


class Chain:
    """Points along the wing chain by parameter q in [0, 5] (bone index + t)."""

    def __init__(self, S, side):
        J = S.joints
        self.names = [f"{n}{side}" for n in A.WING_BONES]
        self.pts = [np.array(J[n]) for n in self.names] + [np.array(S.marks[f"wingTipEnd{side}"])]
        self.sx = 1 if side == "L" else -1
        self.up = A.v(0, 1, 0)

    def point(self, q):
        i = int(min(4, max(0, math.floor(q))))
        return A.lerp(self.pts[i], self.pts[i + 1], q - i)

    def frame(self, q):
        """Outward direction d (blended across joints), up u and forward f."""
        i = int(min(4, max(0, math.floor(q))))
        f_ = q - i
        d = A.norm(self.pts[i + 1] - self.pts[i])
        if f_ > 0.8 and i < 4:
            d = A.norm(A.lerp(d, A.norm(self.pts[i + 2] - self.pts[i + 1]), (f_ - 0.8) / 0.4))
        elif f_ < 0.2 and i > 0:
            d = A.norm(A.lerp(A.norm(self.pts[i] - self.pts[i - 1]), d, 0.5 + f_ / 0.4))
        u = A.norm(self.up - d * float(self.up @ d))
        f = A.norm(np.cross(d, u)) * self.sx
        return d, u, f

    def weights(self, q):
        """(bone indices into the chain, weights) for a point at q."""
        i = int(min(4, max(0, math.floor(q))))
        f_ = q - i
        if f_ > 0.8 and i < 4:
            t = float(smooth(0.8, 1.2, f_))
            return [i, i + 1], [1 - t * 0.5, t * 0.5]
        if f_ < 0.2 and i > 0:
            t = float(smooth(-0.2, 0.2, f_))
            return [i - 1, i], [0.5 * (1 - t), 0.5 + 0.5 * t]
        return [i], [1.0]


def chord_at(S, chain, q):
    """Forward and back half-chord and thickness of the wing arm at q."""
    H = S.H
    #        root   shoulder elbow   wrist   digit   tip
    cf = [0.06, 0.08, 0.08, 0.045, 0.028, 0.01]
    cb = [0.055, 0.07, 0.07, 0.04, 0.024, 0.008]
    ct = [0.055, 0.046, 0.032, 0.022, 0.014, 0.007]
    i = int(min(4, max(0, math.floor(q))))
    t = q - i
    lerp = lambda a: (a[i] + (a[i + 1] - a[i]) * t) * H
    fwd = lerp(cf)
    # the propatagium: the leading edge runs straight from shoulder to wrist,
    # well in front of the elbow
    if 1.0 <= q <= 3.0:
        a, b = chain.pts[1], chain.pts[3]
        u = (q - 1.0) / 2.0
        line = A.lerp(a, b, u)
        _, _, f = chain.frame(q)
        ahead = float((line - chain.point(q)) @ f) + 0.03 * H
        fwd = max(fwd, ahead)
    return fwd, lerp(cb), lerp(ct)


def arm_mesh(S, chain, uv_col):
    """A lofted, airfoil-like tube along the chain (rounded leading edge,
    flat underside), mapped to the atlas's covert-scallop column."""
    qs = np.concatenate([np.linspace(i, i + 1, 6, endpoint=False) for i in range(5)] + [[5.0 - 1e-4]])
    ring = 12
    verts, uvs, bw = [], [], []
    length = 0.0
    prev = None
    for q in qs:
        p = chain.point(q)
        if prev is not None:
            length += float(np.linalg.norm(p - prev))
        prev = p
        d, u, f = chain.frame(q)
        fwd, back, th = chord_at(S, chain, q)
        for j in range(ring):
            a = 2 * math.pi * j / ring
            ca, sa = math.cos(a), math.sin(a)
            # forward of centre: round nose; behind: tapering to the trailing feathers
            x = (fwd if ca > 0 else back) * ca
            y = th * sa * (1.0 if sa > 0 else 0.55) * (1 - 0.35 * max(0.0, -ca))
            verts.append(p + f * x + u * y)
            uvs.append((uv_col[0] + (uv_col[1] - uv_col[0]) * (j / ring), min(0.999, length / 3.2)))
        bw.append(chain.weights(q))
    faces = []
    n = len(qs)
    for i in range(n - 1):
        for j in range(ring):
            a = i * ring + j
            b = i * ring + (j + 1) % ring
            faces.append((a, b, b + ring, a + ring))
    # caps
    faces.append(tuple(range(ring - 1, -1, -1)))
    faces.append(tuple((n - 1) * ring + j for j in range(ring)))
    vw = [bw[k // ring] for k in range(len(verts))]
    return np.array(verts), faces, uvs, vw


def card(base, along, up, sx, length, half_w, kind, col_uv, lift, camber, rows=8):
    """One feather card. `along` points from the calamus to the tip, `up` is
    the dorsal side. Returns verts, faces, uvs (per vertex)."""
    along = A.norm(along)
    across = A.norm(np.cross(along, up)) * sx           # towards the outer vane
    up2 = A.norm(np.cross(across, along)) * sx
    wi, wo = VANE[kind]
    verts, uvs = [], []
    u0, u1 = col_uv
    for r in range(rows + 1):
        t = r / rows
        # geometry follows the vane envelope (less overdraw), padded a little;
        # only the primaries narrow towards the tip
        taper = max(0.5, 1 - (t - 0.66) / 0.68) if kind in ("primary", "slotted") and t > 0.66 else 1.0
        env = min(1.0, (t + 0.08) / 0.3) ** 0.5 * taper
        for k, cc in enumerate((-1.0, 0.0, 1.0)):
            vane = (wi if cc < 0 else wo) * env * 1.08 + 0.02
            x = cc * vane
            # rachis ridge: the vanes fall away slightly on each side; the
            # feather is cambered (curves down towards the tip)
            y = lift + (0.012 * (1 - abs(cc)) - 0.006 * abs(cc)) * half_w * 4 - camber * length * t * t
            verts.append(base + along * (t * length) + across * (x * half_w) + up2 * y)
            uvs.append((u0 + (u1 - u0) * (0.5 + 0.5 * x), t * 0.999))
    faces = []
    for r in range(rows):
        for k in range(2):
            a = r * 3 + k
            faces.append((a, a + 1, a + 4, a + 3))
    return verts, faces, uvs


def build_wing(S, side, lod=0):
    """Feather cards and the arm for one wing. Returns a list of parts:
    (verts, faces, uvs, per-vertex (chain bones, weights))."""
    p = S.p["wing"]
    s = p["semi"]
    kind_w = p["kind"]
    chain = Chain(S, side)
    sx = chain.sx
    Ls = p["chord"] * s
    Lp = p["prim"] * s
    colw = 1.0 / len(COLS)
    col = {k: (i * colw + 0.004, (i + 1) * colw - 0.004) for i, k in enumerate(COLS)}
    parts = []

    def group_of(q):
        return 0 if q < 2.0 else 1 if q < 2.5 else 2 if q < 3.0 else 3 if q < 3.98 else 4

    def add(q, theta_deg, length, half_w, kind, lift, camber=0.04, fwd=0.0, depth=None, rows=8, group=None, flight=False):
        d, u, f = chain.frame(q)
        _, back, th = chord_at(S, chain, q)
        base = chain.point(q) - f * (back * 0.6 - fwd) + u * (th * 0.3 if depth is None else depth)
        th_r = math.radians(theta_deg)
        along = -f * math.cos(th_r) + d * math.sin(th_r)
        v, fc, uv = card(base, along, u, sx, length, half_w, kind, col[kind], lift, camber, rows)
        g = group_of(q) if group is None else group
        parts.append((v, fc, uv, [chain.weights(q)] * len(v), [(base, g, theta_deg)] * len(v)))
        if flight and g >= 0:
            lo, hi = GROUPS.setdefault(g, [1e9, -1e9])
            GROUPS[g] = [min(lo, theta_deg), max(hi, theta_deg)]

    # ---- flight feathers --------------------------------------------------------
    n_sec = 16 if p["chord"] >= 0.24 else 14
    for k in range(n_sec):
        u_ = k / (n_sec - 1)
        q = 2.04 + 0.92 * u_
        add(q, -4 + 14 * u_, Ls * (0.97 + 0.03 * math.sin(u_ * math.pi)), Ls * 0.115, "secondary",
            lift=0.003 * k, camber=0.035, flight=True)
    for k in range(5):
        u_ = k / 4
        add(1.45 + 0.5 * u_, -26 + 20 * u_, Ls * (0.74 + 0.22 * u_), Ls * 0.12, "tertial", lift=0.004 * k - 0.004, camber=0.03,
            group=0, flight=True)
    for k in range(4):
        u_ = k / 3
        add(1.0 + 0.4 * u_, -38 + 10 * u_, Ls * (0.58 + 0.12 * u_), Ls * 0.12, "tertial", lift=0.003 * k - 0.012, camber=0.03,
            group=0, flight=True)
    lens = PRIMARY_LENGTHS[kind_w]
    f0, f1 = PRIMARY_FAN[kind_w]
    for k in range(10):
        u_ = k / 9
        q = 3.05 + 1.88 * u_
        th = f0 + (f1 - f0) * u_ ** 0.85
        kind = "slotted" if kind_w == "slot" and k >= 4 else "primary"
        # inner primaries lie over the outer ones (dorsal view), so P1 is highest
        add(q, th, Lp * lens[k], Lp * 0.085, kind, lift=0.003 * (9 - k) - 0.02, camber=0.05, group=3 if k < 5 else 4, flight=True)
    # ---- coverts ------------------------------------------------------------------
    for k in range(10 if lod == 0 else 6):
        u_ = k / (9 if lod == 0 else 5)
        q = 3.08 + 1.75 * u_
        th = f0 + (f1 - f0) * u_ ** 0.85
        add(q, th, Lp * (0.34 - 0.08 * u_), Lp * 0.1, "covert", lift=0.02 + 0.002 * (9 - k), camber=0.04, fwd=0.01,
            group=3 if u_ < 0.5 else 4)
    n_g = n_sec if lod == 0 else n_sec // 2
    for k in range(n_g):
        u_ = k / (n_g - 1)
        add(2.02 + 0.95 * u_, -2 + 14 * u_, Ls * 0.5, Ls * 0.16, "covert", lift=0.018 + 0.002 * k, camber=0.04, fwd=Ls * 0.08)
        add(1.1 + 0.85 * u_, -30 + 26 * u_, Ls * 0.45, Ls * 0.16, "covert", lift=0.012 + 0.002 * k, camber=0.03, fwd=Ls * 0.06)
    if lod == 0:
        for k in range(13):
            u_ = k / 12
            add(1.2 + 1.85 * u_, -12 + 22 * u_, Ls * 0.3, Ls * 0.14, "small", lift=0.03 + 0.0015 * k, camber=0.03, fwd=Ls * 0.14)
        for k in range(12):
            u_ = k / 11
            add(1.05 + 2.4 * u_, -6 + 26 * u_, Ls * 0.18, Ls * 0.12, "small", lift=0.038 + 0.0012 * k, camber=0.02, fwd=Ls * 0.2)
        # underwing coverts
        for k in range(n_sec):
            u_ = k / (n_sec - 1)
            add(1.4 + 1.6 * u_, -10 + 20 * u_, Ls * 0.46, Ls * 0.16, "covert", lift=-0.035, camber=-0.02, fwd=Ls * 0.06, depth=0.0)
        # alula at the wrist's leading edge
        for k in range(3):
            d, u, f = chain.frame(3.0)
            fwd, back, th = chord_at(S, chain, 3.0)
            base = chain.point(2.98) + f * fwd * 0.6 + u * th * 0.4
            ang = math.radians(112 + 8 * k)
            along = -f * math.cos(ang) + d * math.sin(ang)
            v, fc, uv = card(base, along, u, sx, Lp * (0.13 + 0.03 * k), Lp * 0.05, "covert", col["covert"], 0.006 * k + 0.01, 0.02)
            parts.append((v, fc, uv, [chain.weights(3.0)] * len(v), [(base, -1, 0.0)] * len(v)))
        # scapulars over the wing root, lying back along the body. They grow on
        # the body, not the wing, so they ride the shoulder girdle alone: bound
        # to the humerus they would roll up with it when the wing folds and
        # stand over the withers like a fin
        for k in range(7):
            u_ = k / 6
            q = 0.25 + 0.95 * u_
            d, u, f = chain.frame(q)
            base = chain.point(q) + u * (0.05 * S.H) + f * 0.02 * S.H
            ang = math.radians(-8 - 14 * u_)
            along = -f * math.cos(ang) + d * math.sin(ang)
            v, fc, uv = card(base, along, A.v(0, 1, 0), sx, s * (0.13 + 0.09 * u_), s * 0.045, "contour", col["contour"],
                             0.01 * k, 0.03)
            parts.append((v, fc, uv, [([0], [1.0])] * len(v), [(base, -1, 0.0)] * len(v)))
    # ---- the arm --------------------------------------------------------------------
    av, af, auv, aw = arm_mesh(S, chain, col["arm"])
    parts.append((list(av), af, auv, aw, [(np.zeros(3), -1, 0.0)] * len(av)))
    return chain, parts


def build(S, P, tb_arr, mesh_obj, skin, order, lod=0):
    """Blender objects for both wings (one mesh, one material)."""
    import bpy

    allv, allf, alluv, allbi, allbw, fdata = [], [], [], [], [], []
    for side in ("L", "R"):
        chain, parts = build_wing(S, side, lod)
        bone_idx = [order.index(n) for n in chain.names]
        for v, fc, uv, w, fd in parts:
            base = len(allv)
            allv += list(v)
            alluv += list(uv)
            allf += [tuple(i + base for i in f) for f in fc]
            fdata += [(b, g, th, side) for b, g, th in fd]
            for bones, ws in w:
                bi = [bone_idx[b] for b in bones] + [0] * (4 - len(bones))
                bw = list(ws) + [0.0] * (4 - len(ws))
                allbi.append(bi)
                allbw.append(bw)
    ob = mesh_obj("wings" if lod == 0 else "wings_lod1", tb_arr(np.array(allv)), allf)
    layer = ob.data.uv_layers.new(name="UVMap")
    for li, loop in enumerate(ob.data.loops):
        layer.data[li].uv = alluv[loop.vertex_index]
    for poly in ob.data.polygons:
        poly.use_smooth = True
    idx = np.array(allbi)
    wts = np.array(allbw)
    skin(ob, weights_fn=lambda _P: (idx, wts))
    # per-vertex feather data for the game's fold/fan shader: the insertion
    # point (three.js model space) and group + fan position, as
    # code = group + 0.9 k (+10 on the right wing), or -1 for no rotation
    bases, codes = [], []
    for b, g, th, side in fdata:
        bases.append(np.asarray(b, float))
        if g < 0:
            codes.append(-1.0)
            continue
        lo, hi = GROUPS.get(g, [th, th + 1])
        k = min(1.0, max(0.0, (th - lo) / max(1e-3, hi - lo)))
        codes.append(g + 0.9 * k + (10 if side == "R" else 0))
    me = ob.data
    ab = me.attributes.new("_fbase", "FLOAT_VECTOR", "POINT")
    ab.data.foreach_set("vector", np.array(bases).ravel())
    ag = me.attributes.new("_fgroup", "FLOAT", "POINT")
    ag.data.foreach_set("value", np.array(codes))
    return ob


def atlas_image(breed, path):
    """Paint the atlas and save it as a PNG (alpha kept for the cards)."""
    import bpy

    px = paint_atlas(breed)
    img = bpy.data.images.new(f"{breed}_feathers", ATLAS_W, ATLAS_H, alpha=True)
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    return img


# --------------------------------------------------------------------------
# Starborn's horn


def horn(S, tb_arr, mesh_obj, skin):
    """A slender spiralled horn from the forehead between the eyes, angled
    forward and up (about 35 deg above the face line)."""
    hf = S.head_frame
    sc = hf["length"] / 0.6
    length = S.p["horn"] * sc
    base = S.hp(0.2, 0.085 * sc)
    axis = np.array(hf["axis"])
    dorsal = np.array(hf["dorsal"])
    d = A.norm(dorsal + axis * 0.22)
    side = A.v(1, 0, 0)
    w = A.norm(np.cross(d, side))
    rings, seg = 26, 14
    verts, faces = [], []
    for i in range(rings + 1):
        t = i / rings
        r = (0.03 * sc) * (1 - t) ** 0.85 + 0.0015
        for j in range(seg):
            a = 2 * math.pi * j / seg
            # the spiral groove winds three and a half turns to the tip
            groove = 1 + 0.1 * math.sin(2 * a + t * 7 * 2 * math.pi) * (1 - t * 0.6)
            verts.append(base + d * (t * length) + (side * math.cos(a) + w * math.sin(a)) * r * groove)
    for i in range(rings):
        for j in range(seg):
            a = i * seg + j
            b = i * seg + (j + 1) % seg
            faces.append((a, b, b + seg, a + seg))
    tip = len(verts)
    verts.append(base + d * (length * 1.01))
    for j in range(seg):
        faces.append((rings * seg + j, rings * seg + (j + 1) % seg, tip))
    ob = mesh_obj("horn", tb_arr(np.array(verts)), faces)
    for poly in ob.data.polygons:
        poly.use_smooth = True
    skin(ob, fixed={"head": 1.0})
    return ob
