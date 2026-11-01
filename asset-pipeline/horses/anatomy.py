"""Equine anatomy for the procedural horse builder.

Pure numpy, so the same module runs inside the scikit-image venv (meshing)
and inside Blender (rigging and skin weights).

Coordinates are three.js model space in metres: +x is the horse's LEFT
(near side), +y up, +z forward. The ground is y = 0 and the girth sits
roughly over z = 0.

Every landmark is derived from withers height H and body length L using
conformation ratios: body length ~ withers
height ("square" horse), head ~ 2/3 of the neck topline, chest depth ~ half
the height, elbow ~0.56 H, carpus ~0.29 H, hock ~0.34 H, fetlock ~0.11 H.
Breeds change those ratios and the muscle masses, not just the scale.

Each mass is a primitive tagged with the bone that carries it, so skin
weights fall out of the anatomy instead of being guessed afterwards.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

# --------------------------------------------------------------------------
# breeds

BREEDS: dict[str, dict] = {
    # Lean, tall racing conformation: long sloping shoulder, high withers,
    # long neck carried fairly low, refined bone, long legs.
    "thoroughbred": dict(H=1.63, body=1.02, barrel_w=0.92, barrel_d=0.98, leg=1.04, bone=0.95,
                         hind=1.0, shoulder=0.92, neck_len=1.06, neck_set=40, crest=0.9,
                         head=1.0, profile=0.0, muzzle=0.95, jowl=1.0, tail_set=1.0, croup=1.0,
                         withers=1.3, feather=0.0, mane_len=0.15, mane_wave=0.0, mane_vol=0.8,
                         tail_len=0.86, tail_vol=0.9, forelock=0.12, ear=1.0, chest=0.95),
    # Small refined head with a dished face, large eyes, arched neck set high,
    # short back, flat croup and a high, flagged tail carriage.
    "arabian": dict(H=1.50, body=0.97, barrel_w=0.94, barrel_d=0.95, leg=1.02, bone=0.88,
                    hind=0.94, shoulder=0.95, neck_len=1.02, neck_set=50, crest=0.95,
                    head=0.86, profile=-1.0, muzzle=0.82, jowl=1.08, tail_set=1.35, croup=0.65,
                    withers=1.0, feather=0.0, mane_len=0.27, mane_wave=0.05, mane_vol=0.95,
                    tail_len=0.86, tail_vol=1.0, forelock=0.2, ear=0.85, chest=0.92),
    # Compact and powerful: heavily muscled hindquarters and forearms, short
    # broad head with big jowls, shorter neck carried low, low withers.
    "quarter": dict(H=1.52, body=0.99, barrel_w=1.08, barrel_d=1.02, leg=0.97, bone=1.02,
                    hind=1.28, shoulder=1.0, neck_len=0.9, neck_set=31, crest=1.05,
                    head=0.9, profile=0.0, muzzle=0.92, jowl=1.2, tail_set=0.88, croup=1.08,
                    withers=0.8, feather=0.0, mane_len=0.11, mane_wave=0.0, mane_vol=0.8,
                    tail_len=0.8, tail_vol=0.95, forelock=0.1, ear=0.92, chest=1.12),
    # Baroque build: upright, arched neck with a thick crest, long wavy mane
    # and tail, feathering on the lower legs, substantial bone.
    "friesian": dict(H=1.62, body=1.0, barrel_w=1.07, barrel_d=1.04, leg=1.0, bone=1.12,
                     hind=1.1, shoulder=1.05, neck_len=1.0, neck_set=55, crest=1.32,
                     head=1.02, profile=0.15, muzzle=1.0, jowl=1.0, tail_set=1.0, croup=1.05,
                     withers=0.95, feather=0.6, mane_len=0.6, mane_wave=0.35, mane_vol=1.5,
                     tail_len=1.22, tail_vol=1.55, forelock=0.32, ear=1.0, chest=1.08),
    # Draft (Clydesdale type): heavy frame and bone, deep body, slightly
    # Roman nose, upright shoulder, and long silky feathering.
    "draft": dict(H=1.75, body=1.05, barrel_w=1.26, barrel_d=1.1, leg=0.96, bone=1.48,
                  hind=1.24, shoulder=1.1, neck_len=0.94, neck_set=45, crest=1.38,
                  head=1.08, profile=0.75, muzzle=1.15, jowl=1.1, tail_set=0.95, croup=1.12,
                  withers=0.78, feather=1.0, mane_len=0.3, mane_wave=0.1, mane_vol=1.15,
                  tail_len=0.78, tail_vol=1.15, forelock=0.2, ear=1.05, chest=1.28),
    # Iberian: powerful, short-coupled and round, high arched neck with a thick
    # crest, a slightly convex profile and a long, abundant mane.
    "andalusian": dict(H=1.57, body=0.98, barrel_w=1.06, barrel_d=1.02, leg=0.99, bone=1.04,
                       hind=1.14, shoulder=1.02, neck_len=0.97, neck_set=54, crest=1.35,
                       head=1.0, profile=0.35, muzzle=0.95, jowl=1.0, tail_set=0.92, croup=1.1,
                       withers=0.9, feather=0.0, mane_len=0.48, mane_wave=0.55, mane_vol=1.35,
                       tail_len=1.1, tail_vol=1.3, forelock=0.28, ear=0.95, chest=1.08),
    # Hardy feral type: practical, medium frame, strong hooves, shaggy
    # untrimmed mane and tail.
    "mustang": dict(H=1.46, body=1.0, barrel_w=1.0, barrel_d=1.0, leg=0.99, bone=1.02,
                    hind=1.04, shoulder=1.0, neck_len=0.95, neck_set=36, crest=1.0,
                    head=1.0, profile=0.2, muzzle=1.0, jowl=1.02, tail_set=0.95, croup=1.08,
                    withers=0.95, feather=0.08, mane_len=0.34, mane_wave=0.3, mane_vol=1.3,
                    tail_len=1.0, tail_vol=1.25, forelock=0.3, ear=0.98, chest=1.0),
    # ---- winged horses ---------------------------------
    # A flying horse needs a flight engine: the chest is deeper and the pectoral
    # V heavier, and the wing roots sit on raised muscle over the scapulae, in
    # front of the saddle. `wing` sets the semispan (m), the arm and feather
    # proportions and the planform type: "soar" (high aspect, pointed, swan /
    # albatross), "slot" (broad, emarginated fingered tips, eagle) or "swan".
    # Ivory, the explorer's: a light, refined pearl mare with long gliding wings.
    "ivory": dict(H=1.58, body=1.0, barrel_w=0.96, barrel_d=0.98, leg=1.03, bone=0.92,
                 hind=1.02, shoulder=0.95, neck_len=1.06, neck_set=52, crest=1.1,
                 head=0.9, profile=-0.45, muzzle=0.86, jowl=1.05, tail_set=1.15, croup=0.8,
                 withers=1.05, feather=0.0, mane_len=0.55, mane_wave=0.45, mane_vol=1.35,
                 tail_len=1.2, tail_vol=1.4, forelock=0.3, ear=0.9, chest=1.12,
                 wing=dict(semi=3.15, kind="soar", chord=0.2, prim=0.37, root=1.0)),
    # Onyx, the companion's: a powerful dark stallion with broad, fingered eagle wings.
    "onyx": dict(H=1.68, body=1.03, barrel_w=1.04, barrel_d=1.02, leg=1.02, bone=1.05,
                    hind=1.15, shoulder=0.98, neck_len=1.02, neck_set=48, crest=1.25,
                    head=1.0, profile=0.1, muzzle=0.98, jowl=1.05, tail_set=1.0, croup=1.0,
                    withers=1.1, feather=0.0, mane_len=0.42, mane_wave=0.25, mane_vol=1.3,
                    tail_len=1.1, tail_vol=1.35, forelock=0.25, ear=1.0, chest=1.2,
                    wing=dict(semi=3.35, kind="slot", chord=0.25, prim=0.34, root=1.08)),
    # Starborn: the star-born celestial mare, long in the back to carry two riders,
    # with swan-broad wings and a pearl horn that holds her starlight.
    "starborn": dict(H=1.84, body=1.14, barrel_w=1.1, barrel_d=1.05, leg=1.02, bone=1.12,
                   hind=1.18, shoulder=1.0, neck_len=1.04, neck_set=52, crest=1.3,
                   head=1.0, profile=0.0, muzzle=0.95, jowl=1.0, tail_set=1.05, croup=1.0,
                   withers=1.0, feather=0.3, mane_len=0.75, mane_wave=0.5, mane_vol=1.6,
                   tail_len=1.35, tail_vol=1.6, forelock=0.38, ear=0.95, chest=1.28,
                   wing=dict(semi=4.1, kind="swan", chord=0.25, prim=0.35, root=1.12),
                   horn=0.46, tandem=True),
}


# --------------------------------------------------------------------------
# small vector helpers

def v(*a) -> np.ndarray:
    return np.array(a, dtype=np.float64)


def lerp(a, b, t):
    return a + (b - a) * t


def norm(a):
    return a / max(1e-9, float(np.linalg.norm(a)))


# --------------------------------------------------------------------------
# landmarks and skeleton

@dataclass
class Skeleton:
    breed: str
    p: dict
    H: float
    L: float
    joints: dict = field(default_factory=dict)   # bone name -> head position
    tails: dict = field(default_factory=dict)    # bone name -> tail position
    parents: dict = field(default_factory=dict)  # bone name -> parent
    head_frame: dict = field(default_factory=dict)
    marks: dict = field(default_factory=dict)    # extra named landmarks


def skeleton(breed: str) -> Skeleton:
    p = BREEDS[breed]
    H = p["H"]
    # point of shoulder to point of buttock ~ withers height in a "square" horse
    L = H * p["body"] * 0.92
    S = Skeleton(breed, p, H, L)
    J, T, P, M = S.joints, S.tails, S.parents, S.marks
    leg = p["leg"]
    # legs scale from the ground up; the body above sits on them
    body_lift = (leg - 1.0) * 0.56 * H

    def y(f):  # body heights move with the leg length
        return f * H + body_lift if f > 0.5 else f * H * leg

    # ---- trunk -----------------------------------------------------------
    J["root"] = v(0, 0, 0)
    J["hips"] = v(0, y(0.86), -0.30 * L)
    J["spine1"] = v(0, y(0.855), -0.12 * L)
    J["spine2"] = v(0, y(0.84), 0.08 * L)
    J["chest"] = v(0, y(0.83), 0.27 * L)
    T["chest"] = v(0, y(0.86), 0.42 * L)
    T["hips"] = J["spine1"]
    T["spine1"] = J["spine2"]
    T["spine2"] = J["chest"]
    P.update(hips="root", spine1="hips", spine2="spine1", chest="spine2")

    # ---- neck & head -----------------------------------------------------
    theta = math.radians(p["neck_set"])
    base = v(0, y(0.86), 0.43 * L)
    neck_len = 0.56 * H * p["neck_len"]
    poll = base + v(0, math.sin(theta), math.cos(theta)) * neck_len
    # an S-curve: the cervical spine dips low at the base and rises steeply
    mid1 = lerp(base, poll, 0.36) + v(0, -0.035 * H, 0.025 * H)
    mid2 = lerp(base, poll, 0.70) + v(0, -0.01 * H, 0.02 * H)
    J["neck1"], J["neck2"], J["neck3"] = base, mid1, mid2
    T["neck1"], T["neck2"], T["neck3"] = mid1, mid2, poll
    P.update(neck1="chest", neck2="neck1", neck3="neck2")
    # head hangs from the poll, nose ~40-50 deg ahead of the vertical
    head_len = 0.37 * H * p["head"]
    phi = math.radians(44 + (p["neck_set"] - 40) * 0.25)
    axis = v(0, -math.cos(phi), math.sin(phi))          # poll -> muzzle
    dorsal = v(0, math.sin(phi), math.cos(phi))         # forehead/nasal side
    J["head"] = poll.copy()
    T["head"] = poll + axis * head_len
    P["head"] = "neck3"
    S.head_frame = dict(origin=poll, axis=axis, dorsal=dorsal, length=head_len)

    def hp(s, t=0.0, x=0.0):
        """Point in the head frame: s along poll->muzzle (0..1 of length),
        t towards the forehead/nasal bone (metres), x lateral (metres)."""
        return poll + axis * (s * head_len) + dorsal * t + v(x, 0, 0)

    S.hp = hp
    J["jaw"] = hp(0.24, -0.06)
    T["jaw"] = hp(0.9, -0.075)
    P["jaw"] = "head"
    ear = 0.15 * p["ear"] * (H / 1.6)
    for side, sx in (("L", 1), ("R", -1)):
        base_e = hp(0.02, 0.055, sx * 0.055 * p["head"])
        J[f"ear{side}"] = base_e
        T[f"ear{side}"] = base_e + norm(v(sx * 0.32, 0.9, 0.22)) * ear
        P[f"ear{side}"] = "head"
        M[f"eye{side}"] = hp(0.35, -0.035, sx * 0.086 * (0.9 + 0.1 * p["head"]))
    M["poll"] = poll
    M["muzzle"] = hp(1.0)

    # ---- forelimbs -------------------------------------------------------
    sh = p["shoulder"]  # >1 = more upright shoulder
    for side, sx in (("L", 1), ("R", -1)):
        top = v(sx * 0.085 * H, y(0.93), (0.27 - 0.02 * (sh - 1)) * L)
        point = v(sx * 0.125 * H * p["chest"] ** 0.4, y(0.675), (0.50 - 0.04 * (sh - 1)) * L)
        elbow = v(sx * 0.13 * H * p["barrel_w"] ** 0.35, y(0.565), 0.37 * L)
        knee = v(sx * 0.11 * H * p["chest"] ** 0.3, 0.29 * H * leg, 0.375 * L)
        fet = v(sx * 0.105 * H * p["chest"] ** 0.3, 0.11 * H * leg, 0.372 * L)
        coffin = v(fet[0], 0.05 * H, fet[2] + 0.036 * H)
        toe = v(fet[0], 0.0, coffin[2] + 0.04 * H)
        names = [f"scapula{side}", f"humerus{side}", f"radius{side}", f"cannonF{side}", f"pasternF{side}", f"hoofF{side}"]
        pts = [top, point, elbow, knee, fet, coffin, toe]
        for i, n in enumerate(names):
            J[n] = pts[i]
            T[n] = pts[i + 1]
            P[n] = "chest" if i == 0 else names[i - 1]

    # ---- hindlimbs -------------------------------------------------------
    for side, sx in (("L", 1), ("R", -1)):
        hipj = v(sx * 0.12 * H * p["barrel_w"] ** 0.3, y(0.82), -0.39 * L)
        stifle = v(sx * 0.15 * H * p["barrel_w"] ** 0.4, y(0.60), -0.265 * L)
        hock = v(sx * 0.098 * H, 0.34 * H * leg, -0.415 * L)
        fet = v(sx * 0.096 * H, 0.115 * H * leg, -0.41 * L)
        coffin = v(fet[0], 0.05 * H, fet[2] + 0.03 * H)
        toe = v(fet[0], 0.0, coffin[2] + 0.038 * H)
        names = [f"femur{side}", f"tibia{side}", f"cannonB{side}", f"pasternB{side}", f"hoofB{side}"]
        pts = [hipj, stifle, hock, fet, coffin, toe]
        for i, n in enumerate(names):
            J[n] = pts[i]
            T[n] = pts[i + 1]
            P[n] = "hips" if i == 0 else names[i - 1]
        M[f"hockPoint{side}"] = hock + v(0, 0.035 * H, -0.04 * H)

    # ---- tail (dock, then the hair carried by it) --------------------------
    tail_head = v(0, y(0.925 + 0.02 * (p["tail_set"] - 1)), -0.50 * L)
    hang = norm(v(0, -1.0, -0.38 * p["tail_set"]))
    seg = [0.0, 0.09, 0.2, 0.34, 0.52, 0.72, 0.95]
    tail_total = 0.36 * H + p["tail_len"] * 0.55
    prev = "hips"
    pts = []
    for i, f in enumerate(seg):
        # the dock leaves the croup backwards, then hangs
        bend = min(1.0, f / 0.25)
        d = norm(lerp(norm(v(0, -0.2, -1.0 * p["tail_set"])), hang, bend))
        pts.append(tail_head if i == 0 else pts[-1] + d * (seg[i] - seg[i - 1]) * tail_total)
    for i in range(6):
        n = f"tail{i + 1}"
        J[n] = pts[i]
        T[n] = pts[i + 1]
        P[n] = prev
        prev = n
    M["dock_end"] = pts[2]
    if p.get("wing"):
        wing_skeleton(S, y)
    return S


WING_BONES = ["wingRoot", "wingHum", "wingFore", "wingHand", "wingTip"]


def wing_skeleton(S: Skeleton, y) -> None:
    """The wing chain on each side, in the spread (gliding) rest pose:
    shoulder girdle at the withers, humerus, forearm, hand and digits. The
    arm itself spans ~70 % of the semispan and the primaries carry the rest.
    Each segment keeps a bird's slight sweep (humerus back, forearm forward,
    hand back) and a few degrees of dihedral. Humerus and forearm are nearly
    equal, as in a swan (~1 : 0.93): that is what lets the folded Z close
    with the wrist just ahead of the shoulder instead of up by the neck."""
    p, H, L = S.p, S.H, S.L
    w = p["wing"]
    s = w["semi"]
    J, T, P, M = S.joints, S.tails, S.parents, S.marks
    for side, sx in (("L", 1), ("R", -1)):
        root = v(sx * 0.07 * H, y(0.955), 0.31 * L)
        shoulder = v(sx * 0.15 * H * w["root"], y(1.0), 0.295 * L)
        pts = [root, shoulder]
        # (fraction of the semispan, sweep forward in degrees, dihedral)
        for frac, sweep, dih in ((0.215, -16, 7), (0.205, 9, 4), (0.14, -10, 2), (0.08, -18, 0)):
            a, d = math.radians(sweep), math.radians(dih)
            step = v(sx * math.cos(a) * math.cos(d), math.sin(d), math.sin(a) * math.cos(d)) * frac * s
            pts.append(pts[-1] + step)
        prev = "chest"
        for i, n in enumerate(WING_BONES):
            name = f"{n}{side}"
            J[name] = pts[i]
            T[name] = pts[i + 1]
            P[name] = prev
            prev = name
        M[f"wingTipEnd{side}"] = pts[-1]


BONE_ORDER = [
    "root", "hips", "spine1", "spine2", "chest", "neck1", "neck2", "neck3", "head", "jaw", "earL", "earR",
    "scapulaL", "humerusL", "radiusL", "cannonFL", "pasternFL", "hoofFL",
    "scapulaR", "humerusR", "radiusR", "cannonFR", "pasternFR", "hoofFR",
    "femurL", "tibiaL", "cannonBL", "pasternBL", "hoofBL",
    "femurR", "tibiaR", "cannonBR", "pasternBR", "hoofBR",
    "tail1", "tail2", "tail3", "tail4", "tail5", "tail6",
]


def bone_order(S: Skeleton) -> list[str]:
    """The equine rig, plus the two wing chains on a winged build (appended,
    so every horse bone keeps its index)."""
    if not S.p.get("wing"):
        return BONE_ORDER
    return BONE_ORDER + [f"{n}{side}" for side in ("L", "R") for n in WING_BONES]

# --------------------------------------------------------------------------
# signed distance primitives (vectorised over (..., 3) arrays)


def sd_ellipsoid(P, c, r, R=None):
    q = P - c
    if R is not None:
        q = q @ R  # columns of R are the local axes
    k0 = np.linalg.norm(q / r, axis=-1)
    k1 = np.linalg.norm(q / (r * r), axis=-1)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


def sd_round_cone(P, a, b, r1, r2, sx=1.0):
    """IQ's exact round cone; `sx` < 1 flattens it laterally (x)."""
    if sx != 1.0:
        cx = 0.5 * (a[0] + b[0])
        P = P.copy()
        P[..., 0] = cx + (P[..., 0] - cx) / sx
    ba = b - a
    l2 = float(ba @ ba)
    rr = r1 - r2
    a2 = l2 - rr * rr
    il2 = 1.0 / l2
    pa = P - a
    yv = pa @ ba
    z = yv - l2
    xv = pa * l2 - yv[..., None] * ba
    x2 = np.einsum("...i,...i->...", xv, xv)
    y2 = yv * yv * l2
    z2 = z * z * l2
    k = np.sign(rr) * rr * rr * x2
    out = np.empty_like(yv)
    m1 = np.sign(z) * a2 * z2 > k
    m2 = np.sign(yv) * a2 * y2 < k
    out[m1] = np.sqrt(x2[m1] + z2[m1]) * il2 - r2
    sel = m2 & ~m1
    out[sel] = np.sqrt(x2[sel] + y2[sel]) * il2 - r1
    rest = ~(m1 | m2)
    out[rest] = (np.sqrt(x2[rest] * a2 * il2) + yv[rest] * rr) * il2 - r1
    d = out
    return d * (sx if sx < 1.0 else 1.0)


def sd_capped_cone(P, a, b, ra, rb):
    """IQ's exact capped cone between a (radius ra) and b (radius rb)."""
    rba = rb - ra
    ba = b - a
    baba = float(ba @ ba)
    pa = P - a
    papa = np.einsum("...i,...i->...", pa, pa)
    paba = (pa @ ba) / baba
    x = np.sqrt(np.maximum(papa - paba * paba * baba, 0))
    cax = np.maximum(0.0, x - np.where(paba < 0.5, ra, rb))
    cay = np.abs(paba - 0.5) - 0.5
    k = rba * rba + baba
    f = np.clip((rba * (x - ra) + paba * baba) / k, 0.0, 1.0)
    cbx = x - ra - f * rba
    cby = paba - f
    sgn = np.where((cbx < 0.0) & (cay < 0.0), -1.0, 1.0)
    return sgn * np.sqrt(np.minimum(cax * cax + cay * cay * baba, cbx * cbx + cby * cby * baba))


def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1.0 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def frame_from(direction, up=v(0, 1, 0)):
    """Orthonormal axes (columns) with local y along `direction`."""
    yy = norm(direction)
    xx = np.cross(yy, up if abs(float(norm(up) @ yy)) < 0.95 else v(0, 0, 1))
    xx = norm(xx)
    if xx[0] < 0:
        xx = -xx
    zz = np.cross(xx, yy)
    return np.stack([xx, yy, zz], axis=1)


class Loft:
    """A tube swept along a polyline in the sagittal plane. Each control point
    has a cross-section: half-width `rx`, dorsal and ventral radii `rd`/`rv`
    (about the point shifted by `off` along the dorsal normal) and a
    superellipse exponent `n` (2 = ellipse, larger = boxier)."""

    def __init__(self, pts, rx, rd, rv, off=None, n=None, dense=6):
        pts = np.asarray(pts, float)
        K = len(pts)
        cols = [np.asarray(rx, float), np.asarray(rd, float), np.asarray(rv, float),
                np.zeros(K) if off is None else np.asarray(off, float),
                np.full(K, 2.0) if n is None else np.asarray(n, float)]
        # Catmull-Rom resampling: sections and the centre line vary smoothly,
        # so the swept surface has no creases at the authored control points.
        data = np.concatenate([pts, np.stack(cols, axis=1)], axis=1)
        if dense > 1 and K > 2:
            ext = np.concatenate([2 * data[:1] - data[1:2], data, 2 * data[-1:] - data[-2:-1]])
            rows = []
            for i in range(K - 1):
                p0, p1, p2, p3 = ext[i], ext[i + 1], ext[i + 2], ext[i + 3]
                for t in np.linspace(0, 1, dense, endpoint=False):
                    rows.append(0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                                       + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
            rows.append(data[-1])
            data = np.array(rows)
        self.pts = data[:, :3]
        self.rx, self.rd, self.rv, self.off, self.n = (data[:, 3 + i] for i in range(5))

    def project(self, P, soft=0.012):
        """Global curve parameter u in [0, K-1] of the nearest point. A soft
        arg-min over segments keeps u continuous on the concave side of a bend
        (where the swept radius exceeds the curvature radius)."""
        K = len(self.pts)
        shape = P.shape[:-1]
        m = np.full(shape, np.inf)      # running minimum distance
        Ssum = np.zeros(shape)          # streaming soft-min (log-sum-exp)
        SU = np.zeros(shape)
        uhard = np.zeros(shape)
        raw = np.zeros(shape)
        jmin = np.zeros(shape, dtype=np.int32)
        for j in range(K - 1):
            a, b = self.pts[j], self.pts[j + 1]
            ab = b - a
            t = ((P - a) @ ab) / float(ab @ ab)
            tc = np.clip(t, 0, 1)
            d = np.linalg.norm(P - (a + tc[..., None] * ab), axis=-1)
            uj = j + tc
            better = d < m
            if soft > 0:
                newm = np.minimum(m, d)
                scale = np.where(np.isfinite(m), np.exp(-(m - newm) / soft), 0.0)
                w = np.exp(-(d - newm) / soft)
                Ssum = Ssum * scale + w
                SU = SU * scale + w * uj
                m = newm
            else:
                m = np.where(better, d, m)
            uhard = np.where(better, uj, uhard)
            raw = np.where(better, t, raw)
            jmin = np.where(better, j, jmin)
        u = SU / Ssum if soft > 0 else uhard
        seg = np.clip(np.floor(u).astype(np.int32), 0, K - 2)
        return seg, u - seg, raw, jmin

    def sdf(self, P):
        seg, t, raw, jmin = self.project(P)
        a = self.pts[seg]
        ab = self.pts[seg + 1] - a
        # interpolate the tangent between neighbouring segments as well
        tan = ab / np.linalg.norm(ab, axis=-1, keepdims=True)
        dor = np.stack([np.zeros_like(tan[..., 0]), tan[..., 2], -tan[..., 1]], axis=-1)

        def lerp_(arr):
            return arr[seg] * (1 - t) + arr[seg + 1] * t

        q = P - (a + t[..., None] * ab + dor * lerp_(self.off)[..., None])
        lx = q[..., 0]
        ld = np.einsum("...i,...i->...", q, dor)
        rho = np.sqrt(lx * lx + ld * ld) + 1e-9
        ry = np.where(ld > 0, lerp_(self.rd), lerp_(self.rv))
        n = lerp_(self.n)
        rdir = (np.abs(lx / rho / lerp_(self.rx)) ** n + np.abs(ld / rho / ry) ** n) ** (-1.0 / n)
        d = rho - rdir
        # flat caps beyond the ends (rounded off by the masses around them)
        L0 = np.linalg.norm(self.pts[1] - self.pts[0])
        L1 = np.linalg.norm(self.pts[-1] - self.pts[-2])
        over = np.where((jmin == 0) & (raw < 0), -raw * L0, -1e9)
        over = np.where((jmin == len(self.pts) - 2) & (raw > 1), (raw - 1) * L1, over)
        return np.maximum(d, over)

    def bounds(self):
        m = float(max(self.rx.max(), self.rd.max(), self.rv.max()) + np.abs(self.off).max())
        return self.pts.min(axis=0) - m, self.pts.max(axis=0) + m


@dataclass
class Prim:
    kind: str
    args: tuple
    k: float                 # smooth-union radius into the body
    bones: tuple             # one bone, two blended along `seg`, or one per loft point
    sub: bool = False        # smooth subtraction (nostrils, eye sockets)
    pad: float = 0.0
    seg: tuple | None = None  # anchor points for multi-bone blending

    def sdf(self, P):
        if self.kind == "ell":
            return sd_ellipsoid(P, *self.args)
        if self.kind == "loft":
            return self.args[0].sdf(P)
        if self.kind == "capcone":
            return sd_capped_cone(P, *self.args[:4]) - self.args[4]
        return sd_round_cone(P, *self.args)

    def bounds(self):
        if self.kind == "ell":
            c, r = self.args[0], self.args[1]
            m = float(np.max(r))
            return c - m, c + m
        if self.kind == "loft":
            return self.args[0].bounds()
        a, b, r1, r2 = self.args[:4]
        m = max(r1, r2) + (self.args[4] if self.kind == "capcone" else 0)
        return np.minimum(a, b) - m, np.maximum(a, b) + m


# --------------------------------------------------------------------------
# the horse body

# Trunk profile of a riding horse, from side and top views of conformation
# photographs: z (fraction of body length), topline and underline heights
# and half-width (fractions of withers height), superellipse exponent.
TRUNK = [
    # z      top    bottom  half-w   n
    (0.53, 0.775, 0.665, 0.055, 2.0),   # point of the breast
    (0.47, 0.86, 0.6, 0.12, 2.1),
    (0.40, 0.935, 0.55, 0.155, 2.2),    # shoulders
    (0.30, 0.985, 0.51, 0.172, 2.3),    # withers / girth
    (0.17, 0.975, 0.495, 0.19, 2.35),
    (0.03, 0.952, 0.49, 0.2, 2.4),      # barrel
    (-0.10, 0.958, 0.505, 0.199, 2.4),
    (-0.21, 0.982, 0.57, 0.192, 2.3),   # loin, point of hip
    (-0.31, 0.99, 0.61, 0.182, 2.25),   # hindquarters
    (-0.40, 0.975, 0.615, 0.165, 2.2),
    (-0.47, 0.935, 0.645, 0.135, 2.1),
    (-0.52, 0.87, 0.7, 0.085, 2.0),     # point of buttock
    (-0.545, 0.81, 0.755, 0.035, 2.0),
]

# Head sections from poll (s=0) to the lips (s=1) of a 0.6 m head: half-width,
# dorsal and ventral radii, centre offset towards the forehead, exponent.
HEAD = [
    (-0.04, 0.072, 0.065, 0.075, 0.0, 2.0),
    (0.06, 0.092, 0.075, 0.13, -0.02, 2.2),
    (0.18, 0.105, 0.08, 0.19, -0.045, 2.3),
    (0.3, 0.108, 0.08, 0.2, -0.06, 2.4),       # eyes, widest of the jowls
    (0.42, 0.092, 0.075, 0.14, -0.045, 2.5),
    (0.55, 0.078, 0.07, 0.095, -0.03, 2.6),
    (0.7, 0.07, 0.064, 0.078, -0.025, 2.6),
    (0.83, 0.068, 0.062, 0.075, -0.028, 2.4),
    (0.93, 0.07, 0.06, 0.075, -0.03, 2.2),
    (0.99, 0.055, 0.05, 0.06, -0.035, 2.0),
]


def build_prims(S: Skeleton) -> list[Prim]:
    p, H, L, J = S.p, S.H, S.L, S.joints
    hp = S.hp
    out: list[Prim] = []
    bw, bd = p["barrel_w"], p["barrel_d"]
    bone = p["bone"]
    hind = p["hind"]
    lift = (p["leg"] - 1.0) * 0.56 * H

    def E(c, r, k, bones, R=None, seg=None, sub=False):
        out.append(Prim("ell", (np.asarray(c, float), np.asarray(r, float), R), k, bones, sub=sub, seg=seg))

    def C(a, b, r1, r2, k, bones, sx=1.0, sub=False):
        a = np.asarray(a, float)
        b = np.asarray(b, float)
        out.append(Prim("cone", (a, b, r1, r2, sx), k, bones, sub=sub, seg=(a, b) if len(bones) == 2 else None))

    # ---- trunk loft ----------------------------------------------------------
    pts, rx, rd, n_, bones_ = [], [], [], [], []
    for z, top, bot, w, n in TRUNK:
        # breed: deeper/wider barrel, stronger quarters, withers, croup slope
        if z < -0.25:
            w *= hind ** 0.45
            top -= (p["croup"] - 1.0) * 0.06 * max(0.0, -z - 0.3) / 0.25
        if 0.2 < z < 0.38:
            top += (p["withers"] - 1.0) * 0.022
        if z > 0.38:
            w *= p["chest"] ** 0.6
        bot = top - (top - bot) * (bd if -0.3 < z < 0.45 else bd ** 0.5)
        pts.append(v(0, (top + bot) / 2 * H + lift, z * L))
        rx.append(w * H * (bw if -0.3 < z < 0.45 else bw ** 0.6))
        rd.append((top - bot) / 2 * H)
        n_.append(n)
        bones_.append("chest" if z > 0.22 else "spine2" if z > 0.0 else "spine1" if z > -0.18 else "hips")
    out.append(Prim("loft", (Loft(pts, rx, rd, rd, n=n_),), 0.0, tuple(bones_), seg=tuple(pts)))
    yb = J["spine2"][1]
    wy = J["chest"][1] + 0.15 * H

    # withers ridge and the pectoral "V" between the forelegs
    C(v(0, wy - 0.035 * H, 0.38 * L), v(0, wy - 0.028 * H, 0.2 * L), 0.028 * H, 0.03 * H, 0.03 * H, ("chest",), sx=0.6)
    for sx in (1, -1):
        E(v(sx * 0.06 * H * p["chest"], yb - 0.215 * H, 0.46 * L), v(0.062 * H * p["chest"], 0.095 * H, 0.05 * L),
          0.045 * H, ("chest",))

    # ---- flight engine (winged builds) ----------------------------------------
    # The wing is driven from a raised mound of muscle over each scapula (the
    # elevators and depressors, as a bird's supracoracoideus and pectoralis),
    # and the breast carries a deep keel between the forelegs.
    if p.get("wing"):
        wr = p["wing"]["root"]
        for side, sx in (("L", 1), ("R", -1)):
            root = J[f"wingRoot{side}"]
            E(v(sx * 0.115 * H * wr, root[1] - 0.012 * H, root[2] - 0.01 * L), v(0.062 * H, 0.07 * H, 0.12 * H),
              0.07 * H, ("chest",), R=frame_from(v(0, 0.35, 1)))
            E(v(sx * 0.1 * H * wr, root[1] - 0.09 * H, 0.36 * L), v(0.055 * H, 0.1 * H, 0.09 * H), 0.06 * H,
              (f"scapula{side}",), R=frame_from(v(0, 1, 0.5)))
        E(v(0, yb - 0.25 * H, 0.42 * L), v(0.085 * H * p["chest"], 0.09 * H, 0.13 * L), 0.06 * H, ("chest",))

    # ---- shoulder relief and forelegs --------------------------------------
    for side, sx in (("L", 1), ("R", -1)):
        top, point, elbow = J[f"scapula{side}"], J[f"humerus{side}"], J[f"radius{side}"]
        mid = lerp(top, point, 0.5)
        mid[0] = sx * 0.125 * H * bw
        E(mid, v(0.03 * H, 0.19 * H, 0.09 * H), 0.09 * H, (f"scapula{side}",), R=frame_from(point - top))
        pt = point.copy()
        pt[0] = sx * 0.1 * H * p["chest"] ** 0.5
        E(pt, v(0.04 * H, 0.05 * H, 0.05 * H), 0.05 * H, (f"humerus{side}",))
        tri = lerp(point, elbow, 0.55) + v(0, 0.035 * H, -0.07 * L)
        tri[0] = sx * 0.135 * H * bw ** 0.6
        E(tri, v(0.05 * H, 0.1 * H, 0.09 * H), 0.05 * H, (f"humerus{side}",), R=frame_from(v(0, 1, 0.45)))

        knee, fet, coffin = J[f"cannonF{side}"], J[f"pasternF{side}"], J[f"hoofF{side}"]
        toe = S.tails[f"hoofF{side}"]
        b = bone
        el = elbow + v(-sx * 0.012 * H, 0.04 * H, 0.0)
        # forearm: muscular at the top (extensors in front), tapering into the knee
        C(el, knee + v(0, 0.03 * H, 0), 0.07 * H * b ** 0.5, 0.037 * H * b, 0.05 * H, (f"radius{side}",), sx=0.85)
        E(lerp(elbow, knee, 0.28) + v(0, 0, 0.016 * H), v(0.05 * H * b ** 0.5, 0.12 * H, 0.055 * H * b ** 0.5), 0.03 * H,
          (f"radius{side}",))
        # elbow point (olecranon) tucked against the ribs
        E(elbow + v(0, 0.025 * H, -0.04 * H), v(0.04 * H, 0.05 * H, 0.04 * H), 0.04 * H, (f"humerus{side}", f"radius{side}"),
          seg=(elbow + v(0, 0.06 * H, 0), elbow - v(0, 0.04 * H, 0)))
        # knee (carpus): flat in front, the accessory carpal bone behind
        E(knee + v(0, 0.0, 0.002 * H), v(0.033 * H * b, 0.036 * H, 0.03 * H * b), 0.022 * H, (f"radius{side}", f"cannonF{side}"),
          seg=(knee + v(0, 0.03 * H, 0), knee - v(0, 0.03 * H, 0)))
        E(knee + v(0, 0.014 * H, -0.028 * H * b), v(0.018 * H * b, 0.024 * H, 0.018 * H * b), 0.014 * H, (f"radius{side}",))
        # cannon: the bone in front, the flexor tendons standing out behind
        C(knee - v(0, 0.03 * H, 0), fet + v(0, 0.02 * H, 0.005 * H), 0.025 * H * b, 0.023 * H * b, 0.016 * H, (f"cannonF{side}",), sx=0.88)
        C(knee - v(0, 0.035 * H, 0.026 * H * b), fet + v(0, 0.026 * H, -0.02 * H * b), 0.016 * H * b, 0.017 * H * b, 0.012 * H,
          (f"cannonF{side}",), sx=0.82)
        # fetlock with the ergot behind it, pastern, coronet, hoof
        E(fet + v(0, -0.002 * H, -0.006 * H), v(0.028 * H * b, 0.029 * H * b, 0.032 * H * b), 0.02 * H,
          (f"cannonF{side}", f"pasternF{side}"), seg=(fet + v(0, 0.03 * H, 0), fet - v(0, 0.03 * H, 0)))
        C(fet, coffin + v(0, 0.006 * H, 0), 0.023 * H * b, 0.025 * H * b, 0.012 * H, (f"pasternF{side}",), sx=0.9)
        hoof(out, coffin, toe, H, b, f"hoofF{side}", front=True)

    # ---- hindquarters and hindlegs -----------------------------------------
    for side, sx in (("L", 1), ("R", -1)):
        hipj, stifle, hock = J[f"femur{side}"], J[f"tibia{side}"], J[f"cannonB{side}"]
        fet, coffin = J[f"pasternB{side}"], J[f"hoofB{side}"]
        toe = S.tails[f"hoofB{side}"]
        hm = hind
        # point of hip (tuber coxae)
        E(v(sx * 0.15 * H * bw ** 0.7, wy - 0.085 * H, -0.235 * L), v(0.03 * H, 0.035 * H, 0.04 * H), 0.05 * H, ("hips",))
        # thigh: from the croup down over the stifle, flush with the quarters
        thigh_top = v(sx * 0.12 * H * bw ** 0.5, hipj[1] - 0.02 * H, -0.37 * L)
        thigh_bot = stifle + v(-sx * 0.02 * H, 0.015 * H, -0.03 * H)
        C(thigh_top, thigh_bot, 0.12 * H * hm ** 0.5, 0.075 * H, 0.07 * H, (f"femur{side}",), sx=0.82)
        # hamstrings: the back of the quarters curving down into the gaskin
        ham_top = v(sx * 0.075 * H, hipj[1] - 0.02 * H, -0.48 * L)
        ham_bot = lerp(stifle, hock, 0.55) + v(-sx * 0.02 * H, 0, -0.045 * H)
        C(ham_top, ham_bot, 0.09 * H * hm ** 0.5, 0.06 * H, 0.08 * H, (f"femur{side}", f"tibia{side}"), sx=0.8)
        E(stifle + v(sx * 0.004 * H, 0, 0.012 * H), v(0.045 * H, 0.05 * H, 0.045 * H), 0.04 * H, (f"femur{side}", f"tibia{side}"),
          seg=(stifle + v(0, 0.05 * H, 0), stifle - v(0, 0.05 * H, 0)))
        # gaskin (second thigh) and the Achilles tendon to the point of hock
        C(stifle + v(0, -0.02 * H, -0.035 * H), hock + v(0, 0.05 * H, -0.005 * H), 0.075 * H * hm ** 0.5, 0.038 * H * bone, 0.04 * H,
          (f"tibia{side}",), sx=0.7)
        C(lerp(stifle, hock, 0.4) + v(0, 0, -0.05 * H), S.marks[f"hockPoint{side}"], 0.028 * H, 0.017 * H * bone, 0.03 * H,
          (f"tibia{side}",), sx=0.7)
        # hock: wide front to back
        E(hock + v(0, 0.01 * H, -0.004 * H), v(0.034 * H * bone, 0.05 * H, 0.044 * H * bone), 0.018 * H,
          (f"tibia{side}", f"cannonB{side}"), seg=(hock + v(0, 0.04 * H, 0), hock - v(0, 0.04 * H, 0)))
        C(hock - v(0, 0.035 * H, 0), fet + v(0, 0.02 * H, 0.005 * H), 0.026 * H * bone, 0.023 * H * bone, 0.016 * H,
          (f"cannonB{side}",), sx=0.88)
        C(hock - v(0, 0.045 * H, 0.026 * H * bone), fet + v(0, 0.026 * H, -0.02 * H * bone), 0.016 * H * bone,
          0.017 * H * bone, 0.012 * H, (f"cannonB{side}",), sx=0.82)
        E(fet + v(0, -0.002 * H, -0.006 * H), v(0.028 * H * bone, 0.029 * H * bone, 0.032 * H * bone), 0.02 * H,
          (f"cannonB{side}", f"pasternB{side}"), seg=(fet + v(0, 0.03 * H, 0), fet - v(0, 0.03 * H, 0)))
        C(fet, coffin + v(0, 0.006 * H, 0), 0.022 * H * bone, 0.024 * H * bone, 0.012 * H, (f"pasternB{side}",), sx=0.9)
        hoof(out, coffin, toe, H, bone * 0.95, f"hoofB{side}", front=False)

    # ---- tail dock ---------------------------------------------------------
    t1, t2 = J["tail1"], J["tail2"]
    C(t1 + v(0, -0.005 * H, 0.03 * H), t2, 0.042 * H, 0.036 * H, 0.03 * H, ("tail1",), sx=0.85)
    C(t2, S.marks["dock_end"], 0.036 * H, 0.024 * H, 0.012 * H, ("tail2", "tail3"), sx=0.9)

    # ---- neck loft -----------------------------------------------------------
    n1, n2, n3, poll = J["neck1"], J["neck2"], J["neck3"], J["head"]
    cr = p["crest"]
    ax = S.head_frame["axis"]
    base_in = v(0, n1[1] - 0.04 * H, 0.3 * L)
    npts = [base_in, n1, lerp(n1, n2, 0.5), n2, lerp(n2, n3, 0.5), n3, lerp(n3, poll, 0.6), poll + ax * 0.04 * H]
    nrx = np.array([0.15, 0.14, 0.11, 0.09, 0.075, 0.065, 0.056, 0.05]) * H * np.array([bw ** 0.5] * 3 + [1] * 5)
    nrd = np.array([0.13, 0.13, 0.11, 0.092, 0.075, 0.062, 0.05, 0.04]) * H
    nrd[1:6] *= cr ** 0.6
    nrv = np.array([0.21, 0.21, 0.17, 0.12, 0.085, 0.065, 0.05, 0.045]) * H
    noff = np.array([0.0, 0.01, 0.01, 0.01, 0.005, -0.004, -0.014, -0.028]) * H
    nbones = ("neck1", "neck1", "neck1", "neck2", "neck2", "neck3", "neck3", "head")
    out.append(Prim("loft", (Loft(npts, nrx, nrd, nrv, off=noff, n=[2.0, 2.0, 2.05, 2.1, 2.1, 2.1, 2.15, 2.2]),),
                    0.06 * H, nbones, seg=tuple(npts)))
    hl = S.head_frame["length"]
    sc = hl / 0.6       # a 0.6 m head is the metric reference
    # windpipe line under the neck up to the throatlatch
    C(v(0, yb - 0.09 * H, 0.47 * L), hp(0.05, -0.08 * sc), 0.035 * H, 0.02 * H, 0.03 * H, ("neck1", "neck3"), sx=0.8)

    # ---- head loft -------------------------------------------------------------
    jw, prof, mz = p["jowl"], p["profile"], p["muzzle"]
    hpts, hrx, hrd, hrv, hoff, hn = [], [], [], [], [], []
    for s_, wx, dd, vv, off, n in HEAD:
        f = mz if s_ > 0.75 else 1.0
        jowl = jw if 0.1 < s_ < 0.5 else 1.0
        # dished (Arabian) or Roman (draft) profile between the eyes and nostrils
        bump = prof * 0.012 * math.sin(math.pi * min(1, max(0, (s_ - 0.35) / 0.45)))
        hpts.append(hp(s_, 0.0))
        hrx.append(wx * sc * f * jowl ** 0.5)
        hrd.append(dd * sc * f + bump * sc)
        hrv.append(vv * sc * f * jowl)
        hoff.append(off * sc)
        hn.append(n)
    out.append(Prim("loft", (Loft(hpts, hrx, hrd, hrv, off=hoff, n=hn),), 0.06 * sc, ("head",) * len(hpts), seg=tuple(hpts)))
    HR = _head_R(S)
    for sx in (1, -1):
        # the round, flat cheek (masseter over the mandible)
        E(hp(0.27, -0.11 * sc, sx * 0.072 * sc * jw), v(0.024 * sc, 0.08 * sc * jw, 0.08 * sc * jw), 0.03 * sc, ("head",), R=HR)
        # orbit rim and the facial crest running forward under the eye
        E(hp(0.33, -0.018 * sc, sx * 0.08 * sc), v(0.018, 0.026, 0.03) * sc, 0.02 * sc, ("head",), R=HR)
        C(hp(0.36, -0.01 * sc, sx * 0.087 * sc), hp(0.56, -0.03 * sc, sx * 0.064 * sc), 0.01 * sc, 0.007 * sc, 0.012 * sc, ("head",))
    # muzzle: the soft round nose, upper lip and chin
    E(hp(0.94, -0.015 * sc), v(0.055, 0.05, 0.05) * sc * mz, 0.02 * sc, ("head",), R=HR)
    E(hp(0.95, -0.058 * sc), v(0.042, 0.026, 0.045) * sc * mz, 0.012 * sc, ("jaw",), R=HR)
    E(hp(0.84, -0.082 * sc), v(0.03, 0.028, 0.045) * sc * mz, 0.018 * sc, ("jaw",), R=HR)
    # ---- subtractions: nostrils, eye sockets, the line of the mouth ------------
    for sx in (1, -1):
        E(hp(0.935, 0.025 * sc * mz, sx * 0.045 * sc * mz), v(0.01, 0.03, 0.016) * sc * mz, 0.01 * sc, ("head",),
          R=_head_R(S, roll=sx * 0.45), sub=True)
        E(S.marks[f"eye{'L' if sx > 0 else 'R'}"], v(0.022, 0.022, 0.022) * sc, 0.008 * sc, ("head",), sub=True)
        C(hp(0.84, -0.046 * sc, sx * 0.032 * sc), hp(0.985, -0.044 * sc, sx * 0.032 * sc), 0.004 * sc, 0.005 * sc, 0.006 * sc,
          ("jaw",), sub=True)
    return out


def _head_R(S: Skeleton, roll: float = 0.0):
    """Columns: lateral x, dorsal, axis (so ellipsoid radii read x, t, s)."""
    ax = S.head_frame["axis"]
    do = S.head_frame["dorsal"]
    xx = v(1, 0, 0)
    if roll:
        c, s_ = math.cos(roll), math.sin(roll)
        xx, do = xx * c + do * s_, do * c - xx * s_
    return np.stack([xx, do, ax], axis=1)


def hoof(out, coffin, toe, H, b, bone, front):
    """A hoof: a horn cone from the coronet to the ground. Its axis leans back
    so the dorsal wall slopes ~50-55 deg while the heels stay steep and low;
    it is wider at the ground than at the coronet. Front hooves are rounder,
    hind ones a little narrower."""
    w = (0.046 if front else 0.042) * H * b ** 0.6
    hh = 0.055 * H
    base = v(coffin[0], 0.0, (coffin[2] + toe[2]) * 0.5 + 0.004 * H)
    top = base + v(0, hh, -0.032 * H)
    out.append(Prim("capcone", (base, top, w, w * 0.78, 0.004 * H), 0.006 * H, (bone,)))


# --------------------------------------------------------------------------
# evaluation


def evaluate(prims: list[Prim], P: np.ndarray, groups: bool = False):
    """Smooth union of all body primitives, then smooth subtractions.
    `P` is (..., 3). The ground plane trims the hoof soles flat."""
    d = np.full(P.shape[:-1], 1e3, dtype=np.float64)
    for pr in prims:
        if pr.sub:
            continue
        d = smin(d, pr.sdf(P), pr.k)
    for pr in prims:
        if pr.sub:
            d = smax(d, -pr.sdf(P), pr.k)
    return np.maximum(d, -P[..., 1])


def bone_weights(S: Skeleton, prims: list[Prim], P: np.ndarray, tau: float | None = None):
    """Skin weights from anatomy: each vertex belongs softly to the masses
    nearest its surface (temperature `tau`), and each mass carries one bone or
    blends two along its own axis. Returns (indices[N,4], weights[N,4])."""
    tau = tau or 0.012 * S.H
    body = [pr for pr in prims if not pr.sub]
    D = np.stack([pr.sdf(P) for pr in body], axis=1)  # N x M
    dmin = D.min(axis=1, keepdims=True)
    W = np.exp(-(D - dmin) / tau)
    W[D - dmin > 6 * tau] = 0
    names = bone_order(S)
    idx = {n: i for i, n in enumerate(names)}
    acc = np.zeros((P.shape[0], len(names)))
    for j, pr in enumerate(body):
        w = W[:, j]
        if len(pr.bones) == 1:
            acc[:, idx[pr.bones[0]]] += w
        elif len(pr.bones) > 2:
            # one bone per anchor of a loft: blend along the nearest segment
            seg, t, _, _ = Loft(pr.seg, *([np.ones(len(pr.seg))] * 3), dense=1).project(P, soft=0)
            t = t * t * (3 - 2 * t)
            bn = np.array([idx[b] for b in pr.bones])
            np.add.at(acc, (np.arange(len(P)), bn[seg]), w * (1 - t))
            np.add.at(acc, (np.arange(len(P)), bn[seg + 1]), w * t)
        else:
            a, b = pr.seg if pr.seg is not None else (pr.args[0], pr.args[1])
            ab = b - a
            t = np.clip(((P - a) @ ab) / max(1e-9, float(ab @ ab)), 0, 1)
            t = t * t * (3 - 2 * t)
            acc[:, idx[pr.bones[0]]] += w * (1 - t)
            acc[:, idx[pr.bones[1]]] += w * t
    order = np.argsort(-acc, axis=1)[:, :4]
    wts = np.take_along_axis(acc, order, axis=1)
    wts = wts / np.maximum(wts.sum(axis=1, keepdims=True), 1e-9)
    return order, wts


def bounds(S: Skeleton, prims: list[Prim]):
    lo = np.full(3, 1e9)
    hi = np.full(3, -1e9)
    for pr in prims:
        a, b = pr.bounds()
        lo = np.minimum(lo, a)
        hi = np.maximum(hi, b)
    lo[1] = -0.01
    return lo - 0.03, hi + 0.03
