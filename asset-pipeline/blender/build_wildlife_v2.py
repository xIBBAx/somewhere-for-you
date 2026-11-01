"""
Far-world wildlife, second generation: horse, monkey, tiger, cheetah, gorilla.

    blender -b --factory-startup --python asset-pipeline/blender/build_wildlife_v2.py
    GAME_ONLY=horse,tiger GAME_OUT=... blender ...   (build a subset)

These five are authored from their own anatomy dictionaries. They are NOT
recolours or resizes of the cat asset in build_animals.py: each has its own
skeleton proportions, limb segmentation, head construction and coat masks, and
the quadrupeds use the same rig contract so QuadrupedAnimator can drive them.

    blender -b --factory-startup --python asset-pipeline/blender/build_wildlife_v2.py

Bone contract (shared with src/world/wildlife/QuadrupedAnimator and
src/game/rig/RigPoser — do not rename):

  root hips spine chest neck head earL earR eyeL eyeR
  legF{L,R}1..3   legB{L,R}1..3     leg{F,B}{L,R}4 digits (optional)
  jaw tongue pupil{L,R} whisker{L,R}   tail1..tailN

<leg>1 -> <leg>2 is the two-bone IK chain and <leg>3's HEAD is the paw target
the runtime plants on the ground, so <leg>3 runs from the joint down to the
toes (cannon/pastern for the horse, metatarsal+toes for the big cats).

Vertex colour masks consumed by src/world/wildlife/animalAssets.ts:
  R shading   G light mask   B pattern mask   A literal flag

Animals face -Y in Blender (= +Z in three.js); origin on the ground between
the feet. Reused helpers come from build_animals.py through its AST so this
file never executes that module's unconditional export main().
"""
import ast
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

_HERE = os.path.dirname(os.path.abspath(__file__))
_BASE = os.path.join(_HERE, "build_animals.py")

OUT_DIR = os.environ.get("GAME_OUT", "public/assets/animals")
PREVIEW_DIR = os.environ.get("GAME_PREVIEW_DIR", "/tmp/explorer-animals-v2-preview")


def _harvest(path):
    """Execute build_animals.py without its `main()`.

    Importing the module would run its whole export at the wrong tri budget
    and overwrite the recovered cat, so only the definitions, the classes and
    the constant tables are replayed. The species dictionaries and the main()
    call are skipped: nothing is defined that we do not ask for and nothing is
    exported from that file.
    """
    src = open(path, "r", encoding="utf-8").read()
    tree = ast.parse(src)
    # Assign nodes carry the tunables (metaball calibration, the rig-part
    # table). The species dictionaries are skipped: they would build five more
    # skinned meshes' worth of data we never ask for and risk shadowing ours.
    skip_assigns = {"CAT", "RABBIT", "DEER", "FOX", "SPECIES", "PREVIEW_COATS", "OUT_TRI"}
    keep = []
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom, ast.FunctionDef, ast.ClassDef)):
            keep.append(node)
        elif isinstance(node, ast.Assign):
            names = {t.id for t in node.targets if isinstance(t, ast.Name)}
            if names & skip_assigns:
                continue
            keep.append(node)
    mod = ast.Module(body=keep, type_ignores=[])
    ns = {"__name__": "explorer_animals_base", "__file__": path}
    exec(compile(mod, path, "exec"), ns)  # noqa: S102 - trusted in-repo source
    return ns


B = _harvest(_BASE)

# object helpers
link = B["link"]
reset_scene = B["reset_scene"]
apply_mods = B["apply_mods"]
smooth = B["smooth"]
join = B["join"]
armature = B["armature"]
# continuous organic mass
metaball = B["metaball"]
# lofted limb / tail sweeps
catmull = B["catmull"]
catmull_scalar = B["catmull_scalar"]
roughen = B["roughen"]
sweep = B["sweep"]
ellipsoid = B["ellipsoid"]
blob = B["blob"]
# ears, eyes, feet
ear_leaf = B["ear_leaf"]
eye_basis = B["eye_basis"]
eyeball = B["eyeball"]
eye_disc = B["eye_disc"]
foot = B["foot"]
digit_paw = B["digit_paw"]
hoof = B["hoof"]
# vertex colour masks
paint = B["paint"]
rig_part = B["rig_part"]
sstep = B["sstep"]
fbm = B["fbm"]
seg_dist = B["seg_dist"]
# assembly
quad_leg = B["quad_leg"]
iris_cap = B["iris_cap"]
lid_ring = B["lid_ring"]
eye_normal = B["eye_normal"]
eye_set = B["eye_set"]
pupil_axis = B["pupil_axis"]
mouth_plane = B["mouth_plane"]
split_mouth = B["split_mouth"]
mouth_parts = B["mouth_parts"]
paint_all = B["paint_all"]
bind = B["bind"]
bones_for = B["bones_for"]
tail_points = B["tail_points"]
base_spec = B["base_spec"]
RIG_PARTS = B["RIG_PARTS"]
mouth_parts = B["mouth_parts"]
export = B["export"]
make_mouth_parts = mouth_parts

UNLIT_COATS = {}

# ---------------------------------------------------------------------------
# generic quadruped assembly
#
# Same skinning/painting contract as build_animals.quadruped, but with hooks
# the five new species need: an optional mane, forelock and heavy tail for the
# horse, and a face/muzzle override for the long equine head, so none of them
# fall back to a cat's short muzzle.
# ---------------------------------------------------------------------------

def anatomical_mass(S):
    """Fuse measured volumes without the additive swelling of metaballs.

    Closely spaced metaball elements inflated the ribs, shoulders and head
    into one ball. A voxel union preserves the authored outline and leaves a
    visible neck, waist and separate shoulder muscles after smoothing.
    """
    pieces = [ellipsoid("volume", centre, radii, segs=(24, 16))
              for centre, radii in S["mass"]]
    body = join(pieces, "body")
    modifier = body.modifiers.new("AnatomicalUnion", "REMESH")
    modifier.mode = "VOXEL"
    modifier.voxel_size = S.get("voxel", 0.014)
    modifier.use_smooth_shade = True
    body = apply_mods(body)
    soften = body.modifiers.new("SoftTissue", "SMOOTH")
    soften.factor = 0.75
    soften.iterations = 3
    body = apply_mods(body)
    if S.get("rough"):
        body = roughen(body, S["rough"], S.get("rough_size", 0.05))
    # Keep fine facial features and limb joints in the total triangle budget.
    count = real_tris(body)
    if count > 5400:
        reduce = body.modifiers.new("BodyBudget", "DECIMATE")
        reduce.ratio = 5400 / count
        body = apply_mods(body)
    return smooth(body)

def build_quadruped(spec):
    """Skin, paint, join and bind one quadruped. Returns (mesh, rig)."""
    S = spec
    body = anatomical_mass(S) if S.get("anatomical_union") else metaball(
        "body", S["mass"], res=S["mres"], rough=S.get("rough", 0.0),
        rough_size=S.get("rough_size", 0.06))
    B["fit_eye_sockets"](S, body)
    S["bones"] = bones_for(S)
    if S.get("mouth"):
        split_mouth(body, S)
    parts = [body]
    if S.get("mouth"):
        make_mouth_parts(S, parts)
    if S.get("whiskers"):
        B["whiskers"](S, parts)
    for side, s in (("L", 1), ("R", -1)):
        eye_set(S, side, s, parts)
        if S.get("face_rig"):
            # the iris rides with the pupil, so turning the pupil bone about
            # the eye centre moves the whole coloured eye: a real gaze
            for o in parts:
                if o.name.startswith("iris" + side):
                    retag(o, 10 if s > 0 else 11)
    if S.get("nose"):
        parts.append(blob("nose", Vector(S["nose"]), S["nose_r"],
                          jag=S.get("nose_jag", 0.0), segs=(12, 8)))
        rig_part(parts[-1], 1)
    coat = S["coat_fn"](S) if S.get("coat_fn") else None
    for side, s in (("L", 1), ("R", -1)):
        e = ear_leaf("ear" + side,
                     Vector(S["head"]) + Vector((s * S["ear_x"], S["ear_y"], S["ear_z"])),
                     S["ear_h"], S["ear_w"], S["ear_d"], S["ear_tilt"], s,
                     cup=S.get("ear_cup", 0.5), tip=S.get("ear_tip", 0.0),
                     point=S.get("ear_point", 0.0))
        rig_part(e, 2 if s > 0 else 3)
        parts.append(e)
    for side, s in (("L", 1), ("R", -1)):
        for tag in ("F", "B"):
            pts = [Vector((p[0] * s, p[1], p[2])) for p in S["fl" if tag == "F" else "bl"]]
            g = S["fl_g" if tag == "F" else "bl_g"]
            fk = S["fl_foot" if tag == "F" else "bl_foot"]
            parts.append(quad_leg_v2("leg%s%s" % (tag, side), pts, g, fk,
                                     rough=S.get("leg_rough", 0.0),
                                     bulge=S.get("hock_bulge") if tag == "B" else None))
    if S.get("tail"):
        tw = S["tail"]
        path = [Vector(p) for p in tw["path"]]
        radii = list(tw["r"]) if len(tw["r"]) == len(path) else [tw["r"][0]] * len(path)
        parts.append(sweep("tail", path, radii, segs=tw.get("segs", 8), samples=2, subdiv=0,
                           rough=tw.get("rough", 0.0), rough_size=tw["r"][0] * 2.4))
    if S.get("extras"):
        parts += S["extras"](S, coat) or []

    paint_all_v2(parts, S, fn=coat)
    mesh = join(parts, "body")
    return mesh, bind(mesh, S["bones"], S)


def single_hoof(name, joint, toe_dir, width=0.088, height=0.115, toe=0.05):
    """One solid keratin hoof with a heel and a slightly flared wall.

    A horse's foot is a single hoof, unlike the deer's cloven pair, so this is
    its own primitive: a truncated cone widening toward the ground, a rounded
    toe, and a heel behind it. Bottom sits on z = 0 relative to `joint`.
    """
    joint = Vector(joint)
    d = Vector(toe_dir).normalized()
    side = Vector((-d.z, 0, d.x)).normalized()
    w = width * 0.5
    parts = [
        # wall: coronet at the top, flares to a wider ground surface
        sweep(name + "_wall",
              [joint - Vector((0, 0, height * 0.62)),
               joint - d * (toe * 0.42) - Vector((0, 0, height * 0.22)),
               joint - d * (toe * 0.86) - Vector((0, 0, height * 0.02))],
              [w * 0.62, w * 0.88, w * 0.94], segs=10, samples=2, subdiv=1),
        # heel: the back of the foot, rounded and slightly lower
        blob(name + "_heel", joint + d * (toe * 0.52) - Vector((0, 0, height * 0.36)),
             (w * 0.80, w * 0.80, w * 0.62), segs=(9, 6)),
        # toe: the rounded front of the hoof
        blob(name + "_toe", joint - d * (toe * 0.98) - Vector((0, 0, height * 0.30)),
             (w * 0.86, w * 0.70, w * 0.60), segs=(9, 6)),
    ]
    return join(parts, name)


def mane(S, coat):
    """The horse's crest mane, forelock and cheek tufts.

    Strand locks along the crest of the neck (rooted at the neck_base -> head
    line), a forelock falling over the poll, and a tuft behind each ear. This
    is what separates a horse silhouette from a deer at distance.
    """
    parts = []
    nk = Vector(S["neck_base"])
    head = Vector(S["head"])
    crest = S.get("mane_crest", 0.052)
    along = (head - nk).normalized()
    n = 7
    for i in range(n):
        t = (i + 0.5) / n
        p = nk.lerp(head, t * 0.92) + Vector((0, 0.012, crest * (1.0 - t * 0.35)))
        # mane falls down the side of the neck, not straight out
        d = (Vector((0, 0.10, -1.0)) * (0.55 + 0.45 * (1 - t))).normalized()
        L = 0.115 + 0.075 * (1.0 - abs(t - 0.32) / 0.7)
        parts.append(sweep("mane%d" % i, [p, p + d * (L * 0.55) + along * (L * 0.10),
                                          p + d * L + along * (L * 0.22)],
                           [0.030, 0.024, 0.007], segs=4, samples=2, subdiv=0,
                           rough=0.0022, rough_size=0.03))
    # forelock over the poll, falling forward between the ears
    for j, sx in enumerate((-0.014, 0.014)):
        p = head + Vector((sx, 0.030, 0.086))
        d = Vector((sx * 6, -1.0, -0.55)).normalized()
        parts.append(sweep("forelock%d" % j, [p, p + d * 0.07, p + d * 0.145],
                           [0.020, 0.015, 0.004], segs=4, samples=2, subdiv=0,
                           rough=0.0018, rough_size=0.02))
    return parts


def horse_extras(S, coat):
    parts = mane(S, coat)
    # muzzle: a pale, wide muzzle with two flared nostrils and a dark lip line
    muz = Vector(S["muzzle_centre"])
    for s in (1, -1):
        # nostril: a dark recessed ellipse on the side of the muzzle
        parts.append(blob("nostril%d" % (s > 0), muz + Vector((s * 0.062, -0.030, -0.012)),
                          (0.017, 0.030, 0.020), segs=(9, 6)))
    # the thick upper lip
    parts.append(blob("lip", muz + Vector((0, -0.052, -0.030)), (0.062, 0.030, 0.024),
                      segs=(10, 7)))
    return parts


def horse_coat_fn(S):
    """Bay/chestnut horse markings: dark dorsal line, pale muzzle and belly,
    pale socks, and a blaze down the face (pattern channel).

    G (light): muzzle, eye rings, belly, inner legs, socks, tail flash.
    B (pattern): dorsal stripe, leg barring, blaze.
    R (shade): darker along the spine.
    """
    head = Vector(S["head"])
    belly_z = S["belly_z"]
    sock_z = S.get("sock_z", 0.0)
    legs = []
    for s in (1, -1):
        for key in ("fl", "bl"):
            pts = [Vector((p[0] * s, p[1], p[2])) for p in S[key]]
            legs.append((pts, s, key == "fl"))
    eyes = [head + Vector((s * S["eye_x"], S["eye_y"], S["eye_z"])) for s in (1, -1)]

    def fn(co, n):
        j = fbm(co * 24.0, freq=1.0, octaves=2, seed=3.0) * 0.010
        dorsal = max(0.0, n.z) ** 1.2
        ventral = max(0.0, -n.z) ** 1.05
        shade = 1.0 - 0.09 * dorsal - 0.03 * ventral
        shade *= 1.0 + 0.03 * fbm(co * 40.0, freq=1.0, seed=9.0)
        light = 0.0
        pattern = 0.0

        # pale ventral field along the barrel
        light = sstep(belly_z + 0.30 + j, belly_z - 0.02, co.z) * (0.20 + 0.80 * ventral)
        # dorsal stripe
        spine = sstep(0.030, 0.0, abs(co.x)) * sstep(0.35, 0.8, n.z)
        pattern = max(pattern, spine * 0.7)

        # legs: pale socks at the bottom, faint barring higher up
        on_leg = False
        for pts, s, front in legs:
            d = min(seg_dist(co, pts[i], pts[i + 1]) for i in range(3))
            if d < 0.055 and co.z < pts[0].z - 0.05:
                on_leg = True
                light = max(light, sstep(sock_z + 0.10 + j, sock_z, co.z) * 0.9)
                light = max(light, 0.4 * sstep(0.0, -0.1, co.y * 0.0) * (1 - dorsal))
                break
        # muzzle + eye rings + blaze
        muz = Vector(S["muzzle_centre"])
        if (co - muz).length < 0.19 and co.y < muz.y + 0.06:
            light = max(light, 0.85 * sstep(0.20, 0.09, (co - muz).length + j))
        for e in eyes:
            de = (co - e).length
            light = max(light, 0.45 * sstep(0.036, 0.042, de) * sstep(0.055, 0.046, de))
        # blaze: a narrow white stripe down the face (pattern channel)
        rel = co - head
        if rel.length < 0.42 and rel.y > -0.30:
            w = sstep(S.get("blaze_w", 0.030), 0.006, abs(rel.x + 0.012))
            w *= sstep(-0.34, -0.26, rel.y) * sstep(0.16, 0.08, abs(rel.z - 0.01))
            pattern = max(pattern, w)
        # leg barring
        if not on_leg:
            rings = 0.5 + 0.5 * math.sin(co.z * 2 * math.pi / 0.11 + 3.0 * j)
            pattern = max(pattern, sstep(0.66, 0.90, rings) * 0.35 * sstep(0.2, 0.6, dorsal))
        return (max(0.04, shade), min(1.0, light), min(1.0, pattern), 0.0)
    return fn


# ---- horse: a compact riding horse ---------------------------------------
# Real equine landmarks, in metres. The four things that make a horse read as a
# horse rather than a scaled deer:
#   1. a long, downward muzzle and higher poll;
#   2. a neck that blends into the shoulder (the neck elements overlap the
#      scapula mass, so there is no seam) and runs up at ~55 deg;
#   3. columnar legs with a single solid hoof, not a cloven or digitigrade paw;
#   4. withers ABOVE the croup by ~0.04 m and a deep oval barrel.
HORSE = base_spec(
    anatomical_union=True, voxel=0.014,
    hips=(0, 0.420, 0.880), spine=(0, 0.090, 0.905), chest=(0, -0.290, 0.935),
    neck_base=(0, -0.400, 1.045), head=(0, -0.560, 1.330), snout=(0, -0.700, 1.180),
    mass=[
        ((0, 0.250, 0.905), (0.215, 0.260, 0.230)),    # haunches / croup
        ((0, 0.080, 0.905), (0.230, 0.240, 0.230)),    # loin
        ((0, -0.110, 0.930), (0.245, 0.255, 0.245)),   # barrel (deep oval)
        ((0, -0.290, 0.960), (0.230, 0.230, 0.235)),   # chest / brisket
        ((0, -0.395, 1.075), (0.150, 0.165, 0.190)),  # neck root at the shoulder
        ((0, -0.470, 1.215), (0.115, 0.140, 0.160)),  # neck, tapering up
        ((0, -0.545, 1.330), (0.085, 0.135, 0.115)),  # skull
        ((0, -0.620, 1.240), (0.070, 0.140, 0.098)),  # long face / jowl
        ((0.058, -0.585, 1.300), (0.052, 0.075, 0.058)),  # cheeks
        ((-0.058, -0.585, 1.300), (0.052, 0.075, 0.058)),
        ((0, -0.700, 1.190), (0.060, 0.105, 0.070)),  # muzzle mass
        ((0.090, -0.290, 0.930), (0.080, 0.140, 0.110)),  # upper arm
        ((0.098, 0.240, 0.880), (0.098, 0.180, 0.140)),   # thigh
        ((0, -0.060, 0.660), (0.185, 0.230, 0.120)),  # belly
    ],
    mres=0.034, rough=0.0036, rough_size=0.080, leg_rough=0.0018,
    # fore: scapula/humerus -> elbow -> carpus (knee) -> fetlock target
    fl=[(0.170, -0.290, 0.930), (0.176, -0.268, 0.560), (0.176, -0.292, 0.230), (0.176, -0.300, 0.075)],
    fl_g=(0.082, 0.048, 0.038, 0.036),
    fl_foot=dict(single=True),
    # hind: femur -> stifle -> hock (tarsus) -> fetlock target
    bl=[(0.175, 0.245, 0.905), (0.180, 0.020, 0.545), (0.180, 0.235, 0.235), (0.180, 0.215, 0.075)],
    bl_g=(0.108, 0.058, 0.040, 0.036),
    bl_foot=dict(single=True),
    hock_bulge=1.22,
    tail=dict(path=[(0, 0.560, 0.900), (0.030, 0.700, 0.855), (0.055, 0.820, 0.760),
                    (0.070, 0.905, 0.640), (0.075, 0.945, 0.520), (0.070, 0.940, 0.420)],
              r=(0.055, 0.070, 0.078, 0.076, 0.062, 0.040), rough=0.0035, rough_size=0.05,
              flash_r=0.0, segments=6, segs=6),
    mouth=dict(front=(0, -0.760, 1.150), corner=(0, -0.660, 1.168), hinge=(0, -0.585, 1.205),
               chin=(0, -0.745, 1.100), half_w=0.040, band=0.024, fade=0.030, depth=0.06,
               throat_r=0.020),
    tongue_col=(0.62, 0.30, 0.34), gum_col=(0.32, 0.14, 0.15),
    nose=(0, -0.775, 1.185), nose_r=(0.038, 0.020, 0.020), nose_col=(0.09, 0.07, 0.07),
    claw_col=(0.075, 0.065, 0.060),   # horn hoof wall
    muzzle_centre=(0, -0.735, 1.155), mane_crest=0.060,
    eye_x=0.078, eye_y=-0.020, eye_z=0.020, eye_r=0.026, eye_fwd=1.0, eye_sink=0.14,
    eye_n=(0.72, -0.66, 0.10), gaze_bias=(0, -0.20, 0.06),
    pupil=0.86, eye_squash=1.0, pupil_squash=0.72, eye_dark=True,
    iris=(0.10, 0.065, 0.040), eye_segs=10, eye_rings=8, pupil_segs=8, lid_thick=0.055,
    ear_x=0.058, ear_y=0.028, ear_z=0.100, ear_h=0.135, ear_w=0.036, ear_d=0.018,
    ear_tilt=(0.10, 0.30, 0.22), ear_cup=0.55, ear_tip=0.012,
    belly_z=0.760, sock_z=0.190, leg_x=0.150, muzzle_r=0.075, snout_len=0.230,
    blaze_w=0.032, grain=30.0, counter=0.09,
    coat_fn=horse_coat_fn, extras=horse_extras,
    # mane, tail and the dark lip/nostril leather are literal colours
    literals={"mane": (0.055, 0.028, 0.014), "forelock": (0.055, 0.028, 0.014),
              "tail": (0.055, 0.028, 0.014), "lip": (0.10, 0.055, 0.050),
              "nostril": (0.035, 0.026, 0.024)},
    paint=dict(belly=0.45, bib=0.30, muzzle=0.0, socks=0.0, counter=0.09),
)
HORSE["nose_taper"] = False


# ---------------------------------------------------------------------------
# thin wrappers over the base helpers
#
# build_animals.py must not change, so the two species-specific pieces (a
# single solid hoof, and literal mane/lip colours the base painter does not
# know) are dispatched here instead.
# ---------------------------------------------------------------------------

def quad_leg_v2(name, pts, girth, foot_kw, rough=0.0, bulge=None):
    """quad_leg() plus the single-hoof foot type, which a horse needs."""
    pts = [Vector(p) for p in pts]
    controls = [pts[0], pts[0].lerp(pts[1], 0.38), pts[1], pts[1].lerp(pts[2], 0.55), pts[2], pts[3]]
    pastern = (girth[2] * 1.05 if len(girth) < 4 else girth[3] * 1.08)
    radii = [girth[0], girth[0] * 0.80, girth[1], girth[1] * 0.70, girth[2], pastern]
    oval = [(r, r * 1.05) for r in radii]
    # segs=6 with no subsurf: the sweep already carries 6 rings per segment,
    # which is smooth enough on a limb column and costs a quarter of the
    # subsurfed version (the legs were 31 % of this species' triangles).
    limb = sweep(name, controls, [0.0] * len(controls), segs=8, samples=2, subdiv=0,
                 oval=oval, rough=rough, rough_size=girth[0] * 2.0)
    parts = [limb]
    if foot_kw.get("single"):
        parts.append(single_hoof(name + "_hoof", pts[3], (pts[3] - pts[2]).normalized(),
                                 width=foot_kw.get("width", 0.088),
                                 height=foot_kw.get("height", 0.115),
                                 toe=foot_kw.get("toe", 0.05)))
    elif foot_kw.get("digit"):
        kw = {k: v for k, v in foot_kw.items() if k != "digit"}
        parts.append(digit_paw(name + "_foot", pts[3], **kw))
    else:
        parts.append(foot(name + "_foot", pts[3], (pts[3] - pts[2]).normalized(), **foot_kw))
    return join(parts, name)


def paint_all_v2(parts, S, fn=None):
    """paint_all() with a per-species table of literal colours.

    Parts whose name starts with a key in `S['literals']` are painted one flat
    colour and marked prepainted, so the base painter leaves them alone. That is
    how the horse gets a black mane and tail and dark nostrils while the coat
    shader still handles the body.
    """
    literals = S.get("literals") or {}
    for p in parts:
        for key, col in literals.items():
            if p.name.startswith(key):
                paint(p, lambda co, nv, c=tuple(col): c + (1.0,))
                p["prepainted"] = True
                break
    paint_all(parts, S, fn=fn)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------



S_LOD_RATIO = {"horse": 0.24, "tiger": 0.24, "cheetah": 0.24,
               "monkey": 0.34, "gorilla": 0.26}


def export_v2(species, mesh, rig, budget=12000):
    """export() from build_animals, with a decimated LOD and a tri report that
    separates triangles from the quads the sweeps are built from.

    A quad renders as two triangles, so len(verts) - 2 is already the honest
    render count; what is not obvious from it is WHERE the weight sits. Printing
    the split shows immediately that a swept limb (subsurf quads) dominates a
    metaball body, which is what to tune.
    """
    tris = real_tris(mesh)
    nb = len(rig.data.bones)
    flag = "OK " if tris <= budget else "OVER"
    print(f"  {species:8s} {len(mesh.data.vertices):6d} verts {tris:6d} tris {nb:2d} bones  [{flag} {budget}]")
    # The glTF exporter writes a skin only when the armature object is in the
    # selection alongside the mesh (use_selection=True), so select exactly both.
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT_DIR, f"{species}.glb"), export_format="GLB",
                              use_selection=True, export_normals=True, export_vertex_color="ACTIVE",
                              export_materials="NONE", export_skins=True, export_animations=False,
                              export_yup=True)
    low = mesh.copy()
    low.data = mesh.data.copy()
    low.name = "body_lod1"
    low.data.name = "body_lod1"
    link(low)
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
    # Ratio is per species: a small model (monkey 5.9k) needs far less
    # decimation than a large one (horse 10.8k) to land in the 2-4k band.
    target = os.environ.get("GAME_LOD_RATIO", "")
    d.ratio = float(target) if target else S_LOD_RATIO.get(species, 0.24)
    bpy.ops.object.modifier_apply(modifier=d.name)
    rig.select_set(True)
    low_tris = real_tris(low)
    weights = len(low.data.vertices[0].groups) if len(low.data.vertices) else 0
    print(f"  {species:8s} far LOD {low_tris:6d} tris vgroups={len(low.vertex_groups)} weights/vtx={weights}")
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT_DIR, f"{species}-lod1.glb"), export_format="GLB",
                              use_selection=True, export_normals=True, export_vertex_color="ACTIVE",
                              export_materials="NONE", export_skins=True, export_animations=False,
                              export_yup=True)
    return tris, low_tris


def real_tris(obj):
    """Render triangles, with the tri/quad split reported alongside so the
    sweep-dominated regions are obvious when trimming a species."""
    t = sum(1 for p in obj.data.polygons if len(p.vertices) == 3)
    q = sum(1 for p in obj.data.polygons if len(p.vertices) == 4)
    return t + 2 * q




def felid_coat_fn(S):
    """Stripe or spot masks for the two big cats, authored separately.

    Shared skeleton family, distinct coats: a tiger's marks are VERTICAL bars
    that fork on the shoulder and ring the tail; a cheetah's are solid round
    spots over a pale ground with a black tear line from eye to muzzle and a
    dorsal crest. G is the white field (cheeks, belly, inner legs, muzzle), B
    the markings, R the spine shading.
    """
    head = Vector(S["head"])
    belly_z = S["belly_z"]
    muzzle = Vector(S["muzzle"]) if S.get("muzzle") else head + Vector((0, -0.05, -0.02))
    tail = [Vector(p) for p in catmull([Vector(q) for q in S["tail"]["path"]], 8)]
    tail_acc = [0.0]
    for a, b in zip(tail, tail[1:]):
        tail_acc.append(tail_acc[-1] + (b - a).length)
    eyes = [head + Vector((s * S["eye_x"], S["eye_y"], S["eye_z"])) for s in (1, -1)]
    legs = []
    for s in (1, -1):
        for key in ("fl", "bl"):
            legs.append(([Vector((p[0] * s, p[1], p[2])) for p in S[key]], s))
    kind = S["coat_kind"]

    def fn(co, n):
        j = fbm(co * 30.0, freq=1.0, octaves=2, seed=11.0) * S.get("edge", 0.010)
        dorsal = max(0.0, n.z) ** 1.25
        ventral = max(0.0, -n.z) ** 1.05
        shade = 1.0 - S.get("counter", 0.18) * dorsal - 0.05 * ventral
        shade *= 1.0 + 0.05 * fbm(co * 38.0, freq=1.0, seed=4.0)
        light = 0.0
        pattern = 0.0

        # ---- tail -------------------------------------------------------------
        if co.y > tail[0].y - 0.02:
            best, bi = 1e9, 0
            for i, q in enumerate(tail):
                dd = (co - q).length_squared
                if dd < best:
                    best, bi = dd, i
            if best < 0.045 ** 2:
                u = tail_acc[bi]
                if kind == "stripe":
                    rings = 0.5 + 0.5 * math.sin(u * 2 * math.pi / 0.032 + 5.0 * j)
                    pattern = sstep(0.55, 0.85, rings) * 0.95
                    light = max(light, 0.35 * sstep(0.010, 0.0, u - tail_acc[-1] + 0.03))
                else:  # cheetah: solid tip with dark spots, then a dark end
                    light = max(light, sstep(0.030, 0.0, abs(u - tail_acc[-1]) - 0.03) * 0.6)
                    sp = fbm(co * 46.0, freq=1.0, seed=17.0)
                    pattern = max(pattern, sstep(0.10, 0.28, sp) * 0.9)
                return (max(0.04, shade), min(1.0, light), min(1.0, pattern), 0.0)

        # ---- ventral white field: belly, chest, inner legs --------------------
        light = sstep(belly_z + 0.05 + j, belly_z - 0.02, co.z) * ventral
        # ---- muzzle / cheek ruff ---------------------------------------------
        rel = co - head
        if rel.length < S["muzzle_r"] * 2.6 and co.y < head.y + 0.03:
            pale = sstep(S["muzzle_r"] * 2.6, S["muzzle_r"] * 0.7, rel.length + j)
            if kind == "spot":
                # Cheetahs have a tawny forehead and cheeks; only the chin and
                # lower muzzle are pale, so the eye tear lines remain readable.
                pale *= sstep(head.z + 0.004, head.z - 0.040, co.z)
            light = max(light, pale)
        # ---- legs -------------------------------------------------------------
        on_leg = False
        for pts, s in legs:
            d = min(seg_dist(co, pts[i], pts[i + 1]) for i in range(3))
            if d < 0.028 and co.z < pts[0].z - 0.02:
                on_leg = True
                medial = -n.x * s
                light = max(light, sstep(-0.2, 0.5, medial) * 0.9)
                break

        if not on_leg and rel.length < S["muzzle_r"] * 3.4 and co.y < head.y + 0.03:
            # ---- forehead M / brow ------------------------------------------
            if rel.z > 0.012 and abs(rel.x) < 0.032:
                v = math.cos(rel.x * 2 * math.pi / 0.016)
                pattern = max(pattern, sstep(0.25, 0.7, v + 0.5 * j) * sstep(0.030, 0.018, abs(rel.x)))
            # ---- cheek lines running back from the eye -----------------------
            for e in eyes:
                dz = rel.z - (S["eye_z"] - 0.006)
                dy = rel.y - S["eye_y"]
                line = sstep(0.0055, 0.002, abs(dz + 0.30 * dy + j * 0.02))
                pattern = max(pattern, line * sstep(-0.030, -0.014, dy) * (1.0 - sstep(0.006, 0.026, dy)))
            # ---- pale ring round each eye -------------------------------------
            for e in eyes:
                de = (co - e).length
                light = max(light, 0.5 * sstep(0.0175, 0.0190, de) * sstep(0.0230, 0.0205, de))

        # ---- body markings ----------------------------------------------------
        if kind == "stripe":
            # vertical bars, angled forward on the shoulder, absent on the belly
            phase = (co.y * 0.75 - (co.z - belly_z) * 0.55) * 2 * math.pi / 0.040 + 4.0 * j
            v = 0.5 + 0.5 * math.sin(phase)
            flank = sstep(belly_z - 0.005, belly_z + 0.045, co.z)
            pattern = max(pattern, sstep(0.60, 0.88, v) * flank)
            spine = sstep(0.012, 0.002, abs(co.x)) * sstep(0.4, 0.8, n.z)
            pattern = max(pattern, spine * 0.85)
            # leg rings
            if on_leg:
                rings = 0.5 + 0.5 * math.sin(co.z * 2 * math.pi / 0.026 + 3.0 * j)
                pattern = max(pattern, sstep(0.58, 0.86, rings) * 0.9)
        else:  # cheetah: discrete solid spots
            sp = fbm(co * S.get("spot_freq", 15.0), freq=1.0, octaves=2, seed=5.0)
            flank = sstep(0.02, 0.35, abs(n.z)) * sstep(belly_z + 0.05, belly_z - 0.01, co.z)
            pattern = max(pattern, sstep(0.16, 0.34, sp) * flank)
            # tear mark: a solid black line from the inner eye down the muzzle
            if rel.length < S["muzzle_r"] * 3.0 and co.y < head.y + 0.02:
                tear = sstep(0.0040, 0.0014, abs(abs(rel.x) - 0.020 + 0.9 * (co.y - head.y) + j * 0.02))
                tear *= sstep(S["eye_z"], S["eye_z"] - 0.03, rel.z) * sstep(head.y + 0.005, head.y - 0.02, co.y)
                pattern = max(pattern, tear)
        return (max(0.04, shade), min(1.0, light), min(1.0, pattern), 0.0)
    return fn



# ---- tiger: Bengal tiger, ~1.02 m at the shoulder --------------------------
# Distinct from the cat in build_animals.py by: MUCH broader shoulders and a
# deep chest, a massive head with heavy cheek jowls, round ears, and thick
# forearms. Long striped tail, white cheeks/belly/inner legs.
TIGER = base_spec(
    anatomical_union=True, voxel=0.012,
    hips=(0, 0.430, 0.760), spine=(0, 0.100, 0.780), chest=(0, -0.230, 0.795),
    neck_base=(0, -0.400, 0.840), head=(0, -0.590, 0.930), snout=(0, -0.700, 0.905),
    mass=[
        ((0, 0.230, 0.790), (0.195, 0.285, 0.215)),   # haunches
        ((0, 0.020, 0.780), (0.175, 0.285, 0.180)),   # long, tucked waist
        ((0, -0.190, 0.800), (0.215, 0.295, 0.230)),  # deep ribcage
        ((0, -0.310, 0.830), (0.185, 0.190, 0.200)),  # muscular shoulders
        ((0, -0.455, 0.875), (0.130, 0.145, 0.130)),  # connecting neck
        ((0, -0.600, 0.940), (0.145, 0.135, 0.130)),  # broad feline skull
        ((0.075, -0.630, 0.905), (0.055, 0.065, 0.060)),  # jowls
        ((-0.075, -0.630, 0.905), (0.055, 0.065, 0.060)),
        ((0, -0.690, 0.900), (0.080, 0.053, 0.052)),  # broad muzzle
        ((0.045, -0.708, 0.880), (0.041, 0.039, 0.036)),  # whisker pads
        ((-0.045, -0.708, 0.880), (0.041, 0.039, 0.036)),
        ((0, -0.690, 0.868), (0.057, 0.041, 0.024)),  # chin
        ((0.115, -0.290, 0.700), (0.062, 0.088, 0.075)),  # THICK forearm
        ((0.120, 0.210, 0.740), (0.068, 0.110, 0.088)),  # thigh
        ((0, -0.070, 0.640), (0.150, 0.190, 0.095)),  # deep belly
    ],
    mres=0.030, rough=0.0018, rough_size=0.050, leg_rough=0.0010,
    # fore: shoulder -> elbow -> carpus -> paw (carpus folds back)
    fl=[(0.115, -0.300, 0.760), (0.122, -0.270, 0.470), (0.122, -0.310, 0.180), (0.122, -0.325, 0.062)],
    fl_g=(0.078, 0.048, 0.036, 0.033),
    fl_foot=dict(digit=True, width=0.075, length=0.115, height=0.033, toes=4),
    # hind: femur -> stifle -> hock -> paw
    bl=[(0.122, 0.220, 0.760), (0.128, 0.090, 0.470), (0.126, 0.210, 0.180), (0.124, 0.190, 0.062)],
    bl_g=(0.085, 0.051, 0.036, 0.032),
    bl_foot=dict(digit=True, width=0.070, length=0.112, height=0.031, toes=4),
    hock_bulge=1.16,
    toe_len=0.048, toe_z=0.020,
    # long thick striped tail, carried low with a lifted tip
    tail=dict(path=[(0, 0.450, 0.780), (0.020, 0.620, 0.820), (0.045, 0.790, 0.830),
                    (0.070, 0.930, 0.800), (0.090, 1.010, 0.740), (0.100, 1.040, 0.690)],
              r=(0.038, 0.046, 0.048, 0.044, 0.036, 0.022), rough=0.0020, rough_size=0.035,
              flash_r=0.0, segments=6, segs=8),
    mouth=dict(front=(0, -0.744, 0.888), corner=(0, -0.666, 0.887), hinge=(0, -0.590, 0.900),
               chin=(0, -0.738, 0.863), half_w=0.030, fangs=0.009, band=0.018, fade=0.018,
               depth=0.045, throat_r=0.012),
    whiskers=dict(pad=(0.038, -0.738, 0.891), len=0.100, r=0.0007, rows=3, per_row=2,
                  col=(0.94, 0.93, 0.90)),
    tongue_col=(0.80, 0.36, 0.42), gum_col=(0.42, 0.12, 0.15),
    nose=(0, -0.750, 0.906), nose_r=(0.020, 0.011, 0.012), nose_col=(0.72, 0.28, 0.22),
    claw_col=(0.10, 0.08, 0.07),
    eye_x=0.054, eye_dx=1.0, eye_y=-0.055, eye_z=0.025, eye_r=0.022, eye_fwd=1.0,
    eye_sink=0.12, pupil=0.52, eye_squash=1.0, pupil_squash=1.28, eye_dark=False,
    iris=(0.30, 0.22, 0.05), eye_segs=16, eye_rings=12, pupil_segs=16, lid_thick=0.055,
    ear_x=0.110, ear_y=0.025, ear_z=0.098, ear_h=0.060, ear_w=0.037, ear_d=0.012,
    ear_tilt=(-0.10, 0.30, 0.26), ear_cup=0.5, ear_tip=0.004,
    belly_z=0.640, sock_z=0.0, leg_x=0.110, muzzle_r=0.065, muzzle=(0, -0.700, 0.900),
    coat_kind="stripe", counter=0.20, grain=34.0, edge=0.010,
    coat_fn=felid_coat_fn,
    paint=dict(belly=0.55, bib=0.5, muzzle=0.0, counter=0.20),
)

# ---- cheetah: ~0.86 m at the shoulder, lean and long-legged -----------------
# Deliberately NOT a tiger shape: a narrow chest, a small flat head with a long
# thin muzzle, very long thin legs, small paws. Pale tawny coat with solid
# black spots and the black tear line.
CHEETAH = base_spec(
    anatomical_union=True, voxel=0.010,
    hips=(0, 0.400, 0.640), spine=(0, 0.090, 0.660), chest=(0, -0.190, 0.675),
    neck_base=(0, -0.310, 0.730), head=(0, -0.490, 0.800), snout=(0, -0.563, 0.772),
    mass=[
        ((0, 0.220, 0.665), (0.160, 0.170, 0.160)),   # haunches
        ((0, 0.030, 0.660), (0.115, 0.160, 0.135)),   # narrow waist
        ((0, -0.160, 0.680), (0.155, 0.175, 0.155)),  # deep, narrow chest
        ((0, -0.270, 0.700), (0.160, 0.170, 0.160)),  # shoulders
        ((0, -0.400, 0.760), (0.090, 0.110, 0.100)),  # slender neck
        ((0, -0.494, 0.810), (0.083, 0.077, 0.078)),  # small round skull
        ((0.037, -0.515, 0.786), (0.032, 0.039, 0.033)),  # cheeks
        ((-0.037, -0.515, 0.786), (0.032, 0.039, 0.033)),
        ((0, -0.563, 0.772), (0.043, 0.038, 0.033)),  # short muzzle
        ((0, -0.558, 0.747), (0.038, 0.030, 0.020)),  # jaw
        ((0.092, -0.240, 0.600), (0.038, 0.062, 0.045)),  # slender forearm
        ((0.096, 0.200, 0.640), (0.044, 0.075, 0.058)),   # slim thigh
        ((0, -0.050, 0.560), (0.110, 0.150, 0.070)),  # tucked belly
    ],
    mres=0.022, rough=0.0012, rough_size=0.040, leg_rough=0.0008,
    fl=[(0.092, -0.250, 0.665), (0.096, -0.230, 0.395), (0.096, -0.268, 0.135), (0.096, -0.280, 0.048)],
    fl_g=(0.040, 0.026, 0.021, 0.020),
    fl_foot=dict(digit=True, width=0.036, length=0.070, height=0.021, toes=4),
    bl=[(0.096, 0.200, 0.665), (0.100, 0.085, 0.395), (0.098, 0.195, 0.135), (0.096, 0.175, 0.048)],
    bl_g=(0.048, 0.031, 0.023, 0.020),
    bl_foot=dict(digit=True, width=0.035, length=0.074, height=0.020, toes=4),
    hock_bulge=1.14,
    toe_len=0.042, toe_z=0.016,
    tail=dict(path=[(0, 0.415, 0.660), (0.014, 0.560, 0.700), (0.030, 0.700, 0.720),
                    (0.044, 0.820, 0.700), (0.052, 0.890, 0.655)],
              r=(0.024, 0.026, 0.025, 0.022, 0.014), rough=0.0014, rough_size=0.03,
              flash_r=0.0, segments=5, segs=7),
    mouth=dict(front=(0, -0.600, 0.763), corner=(0, -0.544, 0.763), hinge=(0, -0.500, 0.783),
               chin=(0, -0.590, 0.743), half_w=0.020, fangs=0.006, band=0.014, fade=0.014,
               depth=0.030, throat_r=0.008),
    tongue_col=(0.78, 0.34, 0.40), gum_col=(0.36, 0.12, 0.14),
    nose=(0, -0.608, 0.790), nose_r=(0.013, 0.008, 0.007), nose_col=(0.10, 0.08, 0.08),
    claw_col=(0.10, 0.08, 0.07),
    eye_x=0.042, eye_dx=1.0, eye_y=-0.040, eye_z=0.020, eye_r=0.017, eye_fwd=1.0,
    eye_sink=0.12, pupil=0.62, eye_squash=1.0, pupil_squash=1.0, eye_dark=True,
    iris=(0.26, 0.18, 0.05), eye_segs=16, eye_rings=12, pupil_segs=14, lid_thick=0.050,
    ear_x=0.062, ear_y=0.019, ear_z=0.065, ear_h=0.042, ear_w=0.026, ear_d=0.010,
    ear_tilt=(-0.06, 0.26, 0.22), ear_cup=0.5, ear_tip=0.003,
    belly_z=0.560, sock_z=0.0, leg_x=0.086, muzzle_r=0.052, muzzle=(0, -0.563, 0.772),
    coat_kind="spot", spot_freq=15.5, counter=0.14, grain=34.0, edge=0.008,
    coat_fn=felid_coat_fn,
    paint=dict(belly=0.75, bib=0.45, muzzle=0.0, counter=0.14),
)



# ---------------------------------------------------------------------------
# primates: monkey and gorilla
#
# Primates are NOT quadrupeds: they have a long spine, a long prehensile-ish
# tail (monkey) or none at all (gorilla), long arms that reach the ground in a
# knuckle-walk, and short hind legs. The skeleton reuses the runtime's naming
# so one animator can drive both, but adds shoulder/elbow and hip/knee chains:
#
#   root hips spine chest neck head earL earR eyeL eyeR pupilL pupilR jaw
#   tail1..tailN (monkey only)
#   arm{L,R}1 (upper) arm{L,R}2 (fore) hand{L,R} (3-finger mitt)
#   leg{L,R}1 (thigh) leg{L,R}2 (shin) foot{L,R}
#
# arms are bound to chest, legs to hips, exactly like a quadruped's fore/hind
# so RigPoser's two-bone IK (upper -> lower, target = end bone head) works.
# ---------------------------------------------------------------------------

def primate_hand(S, joint, s, forward, scale, knuckle):
    """A five-fingered hand mitt, posed as a knuckle fist on the ground."""
    joint = Vector(joint)
    d = Vector(forward).normalized()
    parts = []
    # palm
    parts.append(blob("hand_palm", joint + d * (scale * 0.34) - Vector((0, 0, scale * 0.30)),
                      (scale * 0.72, scale * 1.15, scale * 0.52), segs=(9, 6)))
    side = Vector((1, 0, 0))
    # knuckles (the curled fingers resting on the ground)
    for i in range(4):
        f = (i - 1.5) / 1.5
        c = joint + d * (scale * 0.66) + side * (f * scale * 0.42)
        parts.append(blob("knuckle%d" % i, c, (scale * 0.26, scale * 0.42, scale * 0.26), segs=(7, 5)))
    # thumb, offset to the inner side
    parts.append(sweep("thumb", [joint + d * (scale * 0.2) - side * (s * scale * 0.5),
                                 joint + d * (scale * 0.55) - side * (s * scale * 0.42)],
                       [scale * 0.20, scale * 0.16], segs=5, samples=2, subdiv=0))
    return join(parts, "hand")


def primate_foot(S, joint, s, forward, scale):
    """An opposable-appearing flat foot: long sole, big heel, splayed toes."""
    joint = Vector(joint)
    d = Vector(forward).normalized()
    side = Vector((1, 0, 0))
    parts = [sweep("foot_sole", [joint - d * (scale * 0.2) + Vector((0, 0, scale * 0.42)),
                                 joint + d * (scale * 0.8) + Vector((0, 0, scale * 0.30))],
                   [scale * 0.55, scale * 0.50], segs=6, samples=2, subdiv=0,
                   oval=[(scale * 0.60, scale * 0.85), (scale * 0.42, scale * 0.55)])]
    for i in range(4):
        f = (i - 1.5) / 1.5
        c = joint + d * (scale * (0.9 + 0.16 * (1 - abs(f)))) + side * (f * scale * 0.34)
        c.z = scale * 0.22
        parts.append(blob("toe%d" % i, c, (scale * 0.20, scale * 0.30, scale * 0.20), segs=(6, 5)))
    return join(parts, "foot")



def build_primates(spec):
    """Skin, paint, join and bind one primate. Returns (mesh, rig).

    The torso is one metaball mass; the arms and legs are swept limbs with a
    real joint between the two bones so the two-bone IK can bend them, and each
    limb ends in a hand or foot that is the runtime's planted target.
    """
    S = spec
    reset_scene()
    body = anatomical_mass(S)
    B["fit_eye_sockets"](S, body)
    S["bones"] = primate_bones(S)
    if S.get("mouth"):
        split_mouth(body, S)
    parts = [body]
    if S.get("mouth"):
        B["mouth_parts"](S, parts)
    for side, s in (("L", 1), ("R", -1)):
        eye_set(S, side, s, parts)
        if S.get("face_rig"):
            # the iris rides with the pupil, so turning the pupil bone about
            # the eye centre moves the whole coloured eye: a real gaze
            for o in parts:
                if o.name.startswith("iris" + side):
                    retag(o, 10 if s > 0 else 11)
    if S.get("nose"):
        parts.append(blob("nose", Vector(S["nose"]), S["nose_r"], segs=(10, 7)))
        rig_part(parts[-1], 1)
    for side, s in (("L", 1), ("R", -1)):
        # small rounded ear on the side of the skull
        c = Vector(S["head"]) + Vector((s * S["ear_x"], S["ear_y"], S["ear_z"]))
        e = blob("ear" + side, c, (S["ear_w"], S["ear_d"], S["ear_h"]), segs=(9, 6))
        rig_part(e, 2 if s > 0 else 3)
        parts.append(e)
    coat = S.get("coat_fn", primate_coat_fn)(S)
    for side, s in (("L", 1), ("R", -1)):
        # arms: shoulder -> elbow -> hand
        a = [Vector((p[0] * s, p[1], p[2])) for p in S["arm"]]
        parts.append(prim_limb("arm" + side, a, S["arm_g"], limb_end="hand",
                               rough=S.get("leg_rough", 0.0)))
        # legs: hip -> knee -> foot
        l = [Vector((p[0] * s, p[1], p[2])) for p in S["leg"]]
        parts.append(prim_limb("leg" + side, l, S["leg_g"], limb_end="foot",
                               rough=S.get("leg_rough", 0.0)))
    if S.get("tail"):
        tw = S["tail"]
        parts.append(sweep("tail", [Vector(p) for p in tw["path"]], list(tw["r"]),
                           segs=tw.get("segs", 7), samples=3, subdiv=1,
                           rough=tw.get("rough", 0.0), rough_size=tw["r"][0] * 2.0))
    if S.get("extras"):
        parts += S["extras"](S, coat) or []
    paint_all_v2(parts, S, fn=coat)
    mesh = join(parts, "body")
    rig = bind(mesh, S["bones"], S)
    if S.get("face_rig"):
        face_weights(mesh, S)
    return mesh, rig


def prim_limb(name, pts, girth, limb_end, rough=0.0):
    """Upper + fore limb as one continuous sweep with a real joint between."""
    pts = [Vector(p) for p in pts]
    controls = [pts[0], pts[0].lerp(pts[1], 0.42), pts[1], pts[1].lerp(pts[2], 0.55), pts[2]]
    radii = [girth[0], girth[0] * 0.86, girth[1], girth[1] * 0.82, girth[2]]
    oval = [(r, r * 1.05) for r in radii]
    limb = sweep(name, controls, [0.0] * len(controls), segs=7, samples=2, subdiv=0,
                 oval=oval, rough=rough, rough_size=girth[0] * 2.0)
    parts = [limb]
    d = (pts[2] - pts[1]).normalized()
    if limb_end == "hand":
        parts.append(primate_hand(None, pts[2], 1.0 if pts[2].x > 0 else -1.0, d,
                                  girth[2] * 1.5, True))
    else:
        parts.append(primate_foot(None, pts[2], 1.0 if pts[2].x > 0 else -1.0, d,
                                  girth[2] * 1.5))
    return join(parts, name)


def primate_coat_fn(S):
    """Dark dorsal coat with a paler face/limbs/underside (silverback or macaque).

    G (light): face, chest, belly, hands, feet, muzzle.
    B (pattern): a darker saddle over the back (gorilla silverback is the
    reverse: the back is LIGHTER). R (shade): darker along the spine.
    """
    head = Vector(S["head"])
    belly_z = S["belly_z"]
    face = S["face_r"]

    def fn(co, n):
        j = fbm(co * 34.0, freq=1.0, octaves=2, seed=13.0) * 0.008
        dorsal = max(0.0, n.z) ** 1.2
        ventral = max(0.0, -n.z) ** 1.0
        shade = 1.0 - S.get("counter", 0.14) * dorsal
        shade *= 1.0 + 0.04 * fbm(co * 40.0, freq=1.0, seed=8.0)
        light = 0.0
        pattern = 0.0
        rel = co - head
        # Facial skin is distinct from the fur hood, even where metaballs blend.
        if rel.length < face * 1.45:
            front = sstep(head.y - 0.012, head.y - 0.045, co.y)
            light = max(light, front * sstep(face * 1.45, face * 1.05, rel.length))
        # pale chest / belly
        if co.z < belly_z + 0.10 + j:
            light = max(light, sstep(belly_z + 0.10, belly_z - 0.05, co.z) * (0.3 + 0.7 * ventral))
        # darker saddle on the back
        if S.get("saddle"):
            saddle = sstep(0.70, 0.91, co.z) * sstep(0.0, 0.55, n.z) * sstep(-0.10, 0.12, co.y)
            pattern = max(pattern, saddle * S["saddle"])
        # pale hands and feet (low z)
        if co.z < S.get("pale_z", 0.10) + j:
            light = max(light, sstep(S.get("pale_z", 0.10), 0.0, co.z) * 0.8)
        return (max(0.04, shade), min(1.0, light), min(1.0, pattern), 0.0)
    return fn



def primate_bones(S):
    """Arms and legs on the runtime's two-bone naming, plus a short tail."""
    head = Vector(S["head"])
    snout = Vector(S["snout"])
    spine = Vector(S["spine"])
    chest = Vector(S["chest"])
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
        ec = head + Vector((s * S["eye_x"], S["eye_y"], S["eye_z"]))
        bones["eye" + side] = (tuple(ec), tuple(ec + Vector((0, 0, 0.02))), "head")
        bones["pupil" + side] = (tuple(ec), tuple(ec + pupil_axis(S, s) * 0.015), "eye" + side)
        a = [Vector((p[0] * s, p[1], p[2])) for p in S["arm"]]
        l = [Vector((p[0] * s, p[1], p[2])) for p in S["leg"]]
        bones["arm" + side + "1"] = (tuple(a[0]), tuple(a[1]), "chest")
        bones["arm" + side + "2"] = (tuple(a[1]), tuple(a[2]), "arm" + side + "1")
        bones["hand" + side] = (tuple(a[2]), tuple(a[2] + Vector((0, -0.03, -0.01))), "arm" + side + "2")
        bones["leg" + side + "1"] = (tuple(l[0]), tuple(l[1]), "hips")
        bones["leg" + side + "2"] = (tuple(l[1]), tuple(l[2]), "leg" + side + "1")
        bones["foot" + side] = (tuple(l[2]), tuple(l[2] + Vector((0, -0.04, -0.01))), "leg" + side + "2")
    if S.get("tail"):
        p = tail_points(S)
        for i in range(len(p) - 1):
            bones[f"tail{i + 1}"] = (tuple(p[i]), tuple(p[i + 1]), "hips" if i == 0 else f"tail{i}")
    if S.get("face_rig"):
        # a face that can talk: the split mouth gets its jaw and tongue (the
        # mouth parts are already tagged for them), a muzzle bone purses the
        # lips forward for the coo and the lip-smack, and one brow bone over
        # each eye lifts or knits the forehead
        m = S["mouth"]
        F, C, n = B["mouth_plane"](S)
        bones["jaw"] = (tuple(m["hinge"]), tuple(m["chin"]), "head")
        t0 = Vector((0, C.y - 0.002, (F.z + C.z) * 0.5 - 0.002))
        bones["tongue"] = (tuple(t0), tuple(Vector((0, F.y + 0.004, F.z - 0.002))), "jaw")
        fr = S["face_rig"]
        mz = Vector(fr["muzzle"])
        bones["muzzle"] = (tuple(mz), tuple(mz + Vector((0, -0.012, 0))), "head")
        for side, s in (("L", 1), ("R", -1)):
            b = Vector((s * fr["brow"][0], fr["brow"][1], fr["brow"][2]))
            bones["brow" + side] = (tuple(b), tuple(b + Vector((0, 0, 0.010))), "head")
    return bones


def face_weights(mesh, S):
    """Blend the brow and muzzle bones into the skin around them.

    Like the baked jaw weight, each is a smooth falloff from its centre that
    takes its share from whatever the distance binding gave the vertex, so the
    forehead and lips move as skin rather than as rigid patches. Only the
    face (the front of the head, untagged body skin) is touched: the eyes,
    ears and mouth parts keep their rigid ownership.
    """
    fr = S["face_rig"]
    head = Vector(S["head"])
    groups = {g.name: g for g in mesh.vertex_groups}
    parts = mesh.data.attributes["rig_part"].data
    centres = [("muzzle", Vector(fr["muzzle"]), fr["muzzle_r"])]
    for side, s in (("L", 1), ("R", -1)):
        centres.append(("brow" + side, Vector((s * fr["brow"][0], fr["brow"][1], fr["brow"][2])), fr["brow_r"]))
    for v in mesh.data.vertices:
        if parts[v.index].value or v.co.y > head.y - 0.015:
            continue
        for name, c, r in centres:
            d = (v.co - c).length
            k = sstep(r, r * 0.35, d) * fr.get("k", 0.85)
            if k <= 1e-3:
                continue
            for ge in list(v.groups):
                g = mesh.vertex_groups[ge.group]
                g.add([v.index], ge.weight * (1.0 - k), "REPLACE")
            groups[name].add([v.index], k, "REPLACE")


def retag(obj, part):
    """Move an already-tagged part to another rig part."""
    for a in obj.data.attributes["rig_part"].data:
        a.value = part


def base_primate(**kw):
    S = dict(mres=0.020, rough=0.0010, rough_size=0.040, leg_rough=0.0007,
             counter=0.14, grain=34.0, belly_z=0.0, face_r=0.09,
             nose_col=(0.10, 0.08, 0.08), claw_col=(0.10, 0.08, 0.08),
             iris=(0.20, 0.14, 0.08), falloff=4.0, eye_sink=0.10,
             eye_segs=14, eye_rings=10, pupil_segs=12, lid_thick=0.05,
             tongue_col=(0.70, 0.32, 0.36), gum_col=(0.40, 0.14, 0.16),
             paint={}, saddle=0.0, pale_z=0.10)
    S.update(kw)
    tails = [f"tail{i}" for i in range(1, S["tail"].get("segments", 4) + 1)] if S.get("tail") else []
    S["bind"] = ["hips", "spine", "chest", "neck", "head"] + tails + ["root"] + \
                [f"{p}{s}{i}" for p in ("arm", "leg") for s in ("L", "R") for i in ("1", "2")] + \
                [f"{p}{s}" for p in ("hand", "foot") for s in ("L", "R")]
    S["bones"] = primate_bones(S)
    return S


# ---- monkey: rhesus macaque, ~0.36 m at the hip ---------------------------
# macaque build: slim limbs, long prehensile tail with a curled tip, pale face
# and rump patch, hands that read as hands.
MONKEY = base_primate(
    voxel=0.006,
    hips=(0, 0.070, 0.300), spine=(0, 0.010, 0.318), chest=(0, -0.070, 0.330),
    neck_base=(0, -0.120, 0.352), head=(0, -0.160, 0.402), snout=(0, -0.215, 0.392),
    mass=[
        ((0, 0.070, 0.310), (0.070, 0.085, 0.080)),   # pelvis
        ((0, 0.010, 0.316), (0.070, 0.082, 0.076)),   # belly
        ((0, -0.070, 0.336), (0.078, 0.086, 0.080)),  # chest
        ((0, -0.120, 0.360), (0.058, 0.058, 0.058)),  # neck
        ((0, -0.155, 0.412), (0.068, 0.063, 0.067)),  # rounded fur hood
        ((0.030, -0.150, 0.390), (0.026, 0.026, 0.024)),  # cheek
        ((-0.030, -0.150, 0.390), (0.026, 0.026, 0.024)),
        ((0, -0.205, 0.392), (0.026, 0.040, 0.020)),  # short muzzle
    ],
    mres=0.018, rough=0.0008, rough_size=0.03,
    # arm: shoulder -> elbow -> hand (long, slim)
    arm=[(0.062, -0.075, 0.340), (0.070, -0.090, 0.220), (0.062, -0.105, 0.070)],
    arm_g=(0.026, 0.019, 0.016),
    # leg: hip -> knee -> foot (shorter than the arms)
    leg=[(0.048, 0.060, 0.300), (0.050, 0.075, 0.165), (0.048, 0.055, 0.048)],
    leg_g=(0.030, 0.023, 0.019),
    # long prehensile tail curling up at the tip
    tail=dict(path=[(0, 0.085, 0.300), (0.010, 0.170, 0.270), (0.020, 0.250, 0.230),
                    (0.026, 0.320, 0.220), (0.020, 0.360, 0.250), (0.006, 0.352, 0.290)],
              r=(0.020, 0.019, 0.017, 0.015, 0.012, 0.008), segments=5, segs=7),
    mouth=dict(front=(0, -0.228, 0.386), corner=(0, -0.180, 0.386), hinge=(0, -0.160, 0.398),
               chin=(0, -0.222, 0.372), half_w=0.016, band=0.012, fade=0.012, depth=0.024,
               throat_r=0.006),
    nose=(0, -0.232, 0.396), nose_r=(0.008, 0.006, 0.005), nose_col=(0.12, 0.09, 0.09),
    eye_x=0.029, eye_y=-0.040, eye_z=0.013, eye_r=0.014, eye_fwd=1.0,
    eye_n=(0.35, -0.93, 0.08),
    pupil=0.80, eye_squash=1.0, pupil_squash=1.0, eye_dark=True,
    iris=(0.18, 0.12, 0.06),
    ear_x=0.067, ear_y=0.012, ear_z=0.007, ear_h=0.023, ear_w=0.023, ear_d=0.010,
    belly_z=0.250, face_r=0.085, pale_z=0.09,
    # brow ridge over each eye and the lips under the nose
    face_rig=dict(brow=(0.026, -0.203, 0.432), brow_r=0.020, muzzle=(0, -0.226, 0.386), muzzle_r=0.022),
    coat_fn=primate_coat_fn,
)
MONKEY["mask_fur"] = True


# ---- gorilla: silverback, ~1.1 m standing, but knuckle-walks ---------------
# Deliberately DIFFERENT from the monkey: enormous broad chest and heavy
# shoulders, a visible brow and projecting jaw, very long heavy forearms,
# SHORT hind legs, NO tail, and a silverback saddle that is LIGHTER than the
# black body. Heavy brow ridge, big jaw, small ears.
GORILLA = base_primate(
    voxel=0.014,
    hips=(0, 0.190, 0.570), spine=(0, 0.030, 0.690), chest=(0, -0.140, 0.815),
    neck_base=(0, -0.300, 0.960), head=(0, -0.405, 1.035), snout=(0, -0.490, 0.990),
    mass=[
        ((0, 0.190, 0.590), (0.155, 0.190, 0.170)),  # compact pelvis
        ((0, 0.020, 0.690), (0.190, 0.230, 0.205)),  # taper into the waist
        ((0, -0.150, 0.820), (0.245, 0.255, 0.225)),  # broad chest
        ((0.205, -0.200, 0.850), (0.145, 0.145, 0.150)),  # deltoid muscles
        ((-0.205, -0.200, 0.850), (0.145, 0.145, 0.150)),
        ((0, -0.300, 0.960), (0.125, 0.105, 0.115)),  # short thick neck
        ((0, -0.405, 1.035), (0.130, 0.115, 0.130)),  # domed skull
        ((0, -0.485, 1.070), (0.105, 0.055, 0.028)),  # brow ridge
        ((0, -0.495, 0.990), (0.095, 0.063, 0.065)),  # broad jaw
        ((0, -0.490, 0.965), (0.046, 0.046, 0.030)),  # chin
    ],
    mres=0.028, rough=0.0014, rough_size=0.05,
    # VERY long heavy arms (the knuckle-walk limbs)
    arm=[(0.250, -0.160, 0.820), (0.290, -0.200, 0.430), (0.270, -0.230, 0.080)],
    arm_g=(0.140, 0.105, 0.080),
    # SHORT hind legs
    leg=[(0.130, 0.180, 0.570), (0.140, 0.260, 0.300), (0.130, 0.200, 0.070)],
    leg_g=(0.105, 0.075, 0.055),
    # NO TAIL — that is the clearest gorilla read against a monkey
    mouth=dict(front=(0, -0.520, 0.982), corner=(0, -0.455, 1.000), hinge=(0, -0.415, 1.018),
               chin=(0, -0.510, 0.955), half_w=0.040, band=0.024, fade=0.024, depth=0.05,
               throat_r=0.012),
    nose=(0, -0.553, 1.014), nose_r=(0.038, 0.020, 0.017), nose_col=(0.12, 0.10, 0.09),
    eye_x=0.057, eye_y=-0.090, eye_z=0.028, eye_r=0.019, eye_fwd=1.0,
    eye_n=(0.28, -0.96, 0.04),
    pupil=0.70, eye_squash=1.0, pupil_squash=1.0, eye_dark=True,
    iris=(0.14, 0.10, 0.06),
    ear_x=0.130, ear_y=0.008, ear_z=0.005, ear_h=0.023, ear_w=0.026, ear_d=0.009,
    belly_z=0.510, face_r=0.135, pale_z=0.12, saddle=1.0,
    coat_fn=primate_coat_fn,
)

ALL_V2 = [
    ("horse", HORSE),
    ("tiger", TIGER),
    ("cheetah", CHEETAH),
    ("monkey", MONKEY),
    ("gorilla", GORILLA),
]


BUILDERS = {"horse": build_quadruped, "tiger": build_quadruped, "cheetah": build_quadruped,
            "monkey": build_primates, "gorilla": build_primates}


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    only = [s for s in os.environ.get("GAME_ONLY", "").split(",") if s]
    table = ALL_V2
    budget = int(os.environ.get("GAME_BUDGET", "12000"))
    results = {}
    for species, S in table:
        if only and species not in only:
            continue
        reset_scene()
        mesh, rig = BUILDERS[species](S)
        results[species] = export_v2(species, mesh, rig, budget=budget)
    print("exported wildlife v2")
    print("SUMMARY " + " ".join(f"{k}={v[0]}/{v[1]}" for k, v in results.items()))
main()
