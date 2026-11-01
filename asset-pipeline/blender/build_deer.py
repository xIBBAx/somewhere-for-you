"""Original cervid/bovid anatomy, deform rigs, antlers and browser LODs.

blender -b --python asset-pipeline/blender/build_deer.py -- chital sambar moose yak
Uses our existing organic mesh/skin helpers without executing their exporters.
Bodies/rigs/antlers are original; cloven hooves adapt Innerscene's CC0 model.
See asset-pipeline/deer/sources/innerscene/LICENSE.md. Metres, +Z forward after export.
"""
import ast
import copy
import json
import math
import os
import re
import sys
import tempfile
import subprocess
import faulthandler
from array import array
faulthandler.enable()
faulthandler.dump_traceback_later(90,repeat=True)
import bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
OUT = os.environ.get("DEER_OUT", os.path.join(ROOT, "public/assets/deer"))
os.makedirs(OUT, exist_ok=True)
base_path = os.path.join(ROOT, "asset-pipeline/blender/build_animals.py")
tree = ast.parse(open(base_path).read())
nodes = [n for n in tree.body if isinstance(n, (ast.Import, ast.ImportFrom, ast.FunctionDef, ast.ClassDef, ast.Assign))]
B = {"__file__": base_path, "__name__": "deer_geometry_helpers"}
exec(compile(ast.Module(body=nodes, type_ignores=[]), base_path, "exec"), B)

MESH_PYTHON=os.environ.get("DEER_MESH_PYTHON",os.path.expanduser("~/.local/share/explorer-horse-tools/venv/bin/python"))
ACTIVE_HEIGHT=1
def organic_body(name,elements,res=.017,sub=0,rough=0,rough_size=.08):
    with tempfile.TemporaryDirectory(prefix="deer-mesh-") as tmp:
        spec=os.path.join(tmp,"body.json");ply=os.path.join(tmp,"body.ply")
        json.dump({"height":ACTIVE_HEIGHT,"masses":elements},open(spec,"w"))
        subprocess.run([MESH_PYTHON,os.path.join(ROOT,"asset-pipeline/deer/mesh_body.py"),spec,ply],check=True)
        print("[body] importing surface",flush=True)
        bpy.ops.wm.ply_import(filepath=ply)
    ob=bpy.context.object;ob.name=name
    print("[body] smoothing",len(ob.data.vertices),flush=True)
    m=ob.modifiers.new("anatomical_surface","SMOOTH");m.factor=.55;m.iterations=3
    ob=B["apply_mods"](ob)
    print("[body] simplifying",flush=True)
    m=ob.modifiers.new("surface_budget","DECIMATE");m.ratio=.40
    ob=B["apply_mods"](ob)
    print("[body] ready",len(ob.data.vertices),flush=True)
    return B["smooth"](ob)
B["metaball"]=organic_body

def paint_cached(obj,fn):
    # Snapshot normals BEFORE writing attributes. Blender invalidates its
    # normal cache on attribute writes; fetching v.normal inside that loop
    # turned an offline 15-species build into quadratic work.
    me=obj.data
    coords=[v.co.copy() for v in me.vertices]
    normals=[v.normal.copy() for v in me.vertices]
    colors=[fn(c,n) for c,n in zip(coords,normals)]
    for a in list(me.color_attributes): me.color_attributes.remove(a)
    a=me.color_attributes.new(name="Color",type="FLOAT_COLOR",domain="CORNER")
    flat=array('f',(v for loop in me.loops for v in colors[loop.vertex_index]))
    a.data.foreach_set("color",flat)
    me.color_attributes.active_color=a
    return obj
def paint_deer(obj,fn):
    if obj.name.startswith("ear"):
        # Pale inner pinna and a coated rim make ear rotations readable.
        fn=lambda co,n:(.91,.52*max(0,-n.y),0,0)
    return paint_cached(obj,fn)
B["paint"]=paint_deer

# Extract only the paired fore-hoof from the downloaded, original CC0 mesh.
# Rotate its +X-forward convention into this project's -Y-forward convention.
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,"asset-pipeline/deer/sources/innerscene/deer-standing.glb"))
hoof_v=[];hoof_f=[]
for key in ("Cloven tapered hoof","Cloven tapered hoof.001"):
    ob=bpy.data.objects[key];start=len(hoof_v)
    hoof_v.extend([tuple(ob.matrix_world@v.co) for v in ob.data.vertices])
    hoof_f.extend([tuple(i+start for i in p.vertices) for p in ob.data.polygons])
lo=[min(v[i] for v in hoof_v) for i in range(3)];hi=[max(v[i] for v in hoof_v) for i in range(3)]
hoof_v=[((v[1]-(lo[1]+hi[1])*.5)/(hi[1]-lo[1]),-(v[0]-(lo[0]+hi[0])*.5)/(hi[0]-lo[0]),v[2]/hi[2]) for v in hoof_v]
def cloven_hoof(name,joint,toe_dir,span=0,width=.035,height=.04,**_):
    verts=[(joint[0]+v[0]*width*1.55,joint[1]+v[1]*height*1.7-height*.12,max(0,joint[2]-height*.80)+v[2]*height) for v in hoof_v]
    me=bpy.data.meshes.new(name);me.from_pydata(verts,[],hoof_f);me.update()
    return B["smooth"](B["link"](bpy.data.objects.new(name,me)))
B["hoof"]=cloven_hoof

# Body conformation: withers, length, depth/width, relative leg length,
# neck length/bulk, muzzle, ears, rear height, tail, antler form. These change
# anatomical landmarks and the deform rig, not an object's uniform scale.
ART = {
 "chital":      (0.96, 1.16, .94, 1.04, 1.04, .88, .92, 1.06, 1.00, .16, "three"),
 "sambar":      (1.48, 1.15, 1.22, 1.00, .95, 1.35, 1.08, 1.38, 1.00, .18, "three"),
 "barasingha":  (1.25, 1.17, 1.05, 1.04, 1.02, 1.00, 1.02, 1.05, 1.00, .14, "many"),
 "muntjac":     (.55,  1.40, 1.08, .86, .68, .93, .76, .86, 1.09, .20, "short"),
 "hog":         (.67,  1.43, 1.20, .78, .62, 1.12, 1.00, .91, 1.10, .17, "three"),
 "red":         (1.35, 1.14, 1.07, 1.03, 1.10, 1.27, 1.13, .98, .99, .13, "many"),
 "fallow":      (.98,  1.20, 1.03, 1.03, 1.00, .95, .86, 1.10, 1.00, .27, "palm"),
 "sika":        (.95,  1.14, 1.05, .98, .93, 1.12, .88, .99, 1.01, .15, "beam"),
 "roe":         (.69,  1.08, .98, 1.12, .88, .85, .71, 1.11, 1.03, .055, "short"),
 "whitetail":   (1.03, 1.20, .98, 1.04, 1.03, 1.01, 1.04, 1.06, 1.02, .28, "beam"),
 "mule":        (1.07, 1.18, 1.04, 1.10, .96, 1.05, 1.04, 1.70, 1.04, .16, "fork"),
 "elk":         (1.58, 1.15, 1.15, 1.05, 1.10, 1.45, 1.17, 1.00, .98, .10, "many"),
 "moose":       (1.93, 1.04, 1.20, 1.26, .70, 1.17, 1.77, 1.15, .88, .07, "moose"),
 "reindeer":    (1.20, 1.25, 1.25, .96, .84, 1.35, .91, .82, 1.01, .14, "reindeer"),
 "yak":         (1.55, 1.40, 1.72, .78, .53, 1.65, 1.25, .62, .94, .56, "horns"),
}

def make_spec(name, young=False):
    H, L, bulk, leg, neck, neck_bulk, muzzle, ear, rear, tail, antler = ART[name]
    # Fawns have a short barrel, long fine legs and a proportionately larger
    # cranium/ears. The asset is normalized to adult height; identity scales it.
    if young:
        L *= .85; bulk *= .83; neck *= .84; neck_bulk *= .73; muzzle *= .68; ear *= 1.09
    length = L / 1.16
    width = .15 * bulk
    chest_y = -.32 * length
    hip_y = .31 * length
    body_z = .79 + (leg - 1) * .15
    neck0 = (0, chest_y - .08, .83)
    skull = (0, chest_y - .21 - .22 * neck, .94 + .32 * neck)
    snout = (0, skull[1] - .175 * muzzle, skull[2] - .095 * (1.3 if name == "moose" else 1))
    def q(v): return tuple(x * H for x in v)
    def mass(c, r): return (q(c), q(r))
    masses = [
        mass((0, hip_y, body_z * rear), (width * 1.06, .23 * length, .22 * bulk ** .3)),
        mass((0, .02 * length, body_z-.018), (width, .44 * length, .205 * bulk ** .3)),
        mass((0, chest_y, body_z + .03), (width * 1.02, .18, .22)),
        mass((0, chest_y - .03, body_z + .13), (.10 * bulk, .12, .085)),
        # A tapered diagonal neck, with a broad attachment at the brisket.
        # Several overlapping cross-sections avoid a vertical oval or an
        # hourglass throat when the alert pose raises the head.
        *[mass((0, neck0[1]+(skull[1]-neck0[1])*t, neck0[2]+(skull[2]-neck0[2])*t),
               ((.094-.037*t)*neck_bulk, .115-.037*t, .13-.039*t)) for t in (0,.25,.5,.75)],
        mass(skull, (.066 * (1.14 if young else 1), .096, .071)),
        mass((0, (skull[1] + snout[1]) * .5, (skull[2] + snout[2]) * .5), (.041 * muzzle ** .35, .099 * muzzle, .039)),
        mass(snout, (.032 * (1.75 if name == "moose" else 1), .033, .028)),
        mass((0, snout[1] + .062, snout[2] - .025), (.028, .070, .018)),
        *[mass((side*width*.66, chest_y+.03, body_z-.075),(.075*bulk,.13,.17)) for side in (-1,1)],
        *[mass((side*width*.64, hip_y-.015, body_z-.06),(.081*bulk,.145,.17)) for side in (-1,1)],
    ]
    if name == "moose":
        masses += [mass((0, chest_y + .07, .97), (.12, .20, .11)), mass((0, skull[1] + .05, skull[2] - .19), (.055, .07, .12))]
    if name == "yak":
        masses += [mass((0, chest_y + .07, .96), (.24, .25, .18)), mass((0, .06, .50), (.24, .48, .14))]
    fl = [(width * .73, chest_y + .045, body_z), (width * .77, chest_y + .10, .56), (width * .75, chest_y + .008, .285), (width * .75, chest_y - .005, .034)]
    bl = [(width * .80, hip_y - .04, body_z * rear), (width * .83, hip_y - .19, .55), (width * .82, hip_y + .04, .255), (width * .79, hip_y, .034)]
    S = copy.deepcopy(B["DEER"])
    S.update(hips=q((0, hip_y + .05, body_z * rear)), spine=q((0, .03, body_z + .045)), chest=q((0, chest_y, body_z + .08)), neck_base=q(neck0), head=q(skull), snout=q(snout), mass=masses,
        fl=[q(v) for v in fl], bl=[q(v) for v in bl], fl_g=(.054*H*bulk, .030*H, .021*H), bl_g=(.075*H*bulk, .034*H, .022*H),
        fl_foot=dict(hoof=True, width=.035*H*(1.35 if name in ("barasingha", "reindeer", "yak") else 1), height=.037*H, span=0),
        bl_foot=dict(hoof=True, width=.033*H, height=.037*H, span=0),
        mres=H*.019, rough=H*.0018*(2 if name in ("sambar", "reindeer", "yak") else 1), rough_size=H*.04, leg_rough=H*.0007,
        fit_eyes=True, eye_x=H*.060, eye_y=-H*.026, eye_z=H*.019, eye_r=H*.018*(1.17 if young else 1), eye_sink=.17,
        nose=q((0, snout[1]-.027, snout[2]+.003)), nose_r=q((.043 if name=="moose" else .030, .020, .020)),
        ear_x=H*.064, ear_y=H*.048, ear_z=H*.053, ear_h=H*.156*ear, ear_w=H*.063*ear**.5, ear_d=H*.014,
        ear_tilt=(.12, .91 if name in ("sambar","moose") else .72, .16), ear_tip=H*.008,
        eye_gloss=True, eye_n=(1,-.35,.03), gaze_bias=(0,-.12,0), pupil_squash=.48, eye_rings=12, eye_segs=18,
        belly_z=H*(body_z-.17), leg_x=width*H, muzzle_r=H*.072, snout_len=H*.19*muzzle, hoof_z=H*.06,
        tail=dict(path=[q((0, hip_y+.23*length, body_z*rear)), q((0, hip_y+.23*length+tail*.45, body_z*rear-tail*.3)), q((0, hip_y+.23*length+tail*.6, body_z*rear-tail*.6))], r=(H*.030, H*.026, H*.016), rough=H*.0015, flash_r=H*.045, segments=3),
        mouth=dict(front=q((0,snout[1]-.035,snout[2]-.028)), corner=q((0,snout[1]+.053,snout[2]-.033)), hinge=q((0,skull[1]-.02,skull[2]-.04)), chin=q((0,snout[1]-.03,snout[2]-.052)), half_w=H*.029, band=H*.026, fade=H*.027, depth=H*.05, throat_r=H*.014),
        paint=dict(belly=.25 if name in ("sambar","moose","yak") else .55, bib=.08 if name in ("sambar","moose","yak") else .25, muzzle=.16 if name in ("sambar","moose","yak","elk") else .42, spots=0, tail_flash=1 if name in ("whitetail","fallow","mule","roe") else .3, counter=.15),
        falloff=5.5)
    S["bones"] = B["bones_for"](S)
    return S

def make_antlers(name, S, rig):
    H, *_, kind = ART[name]
    head = Vector(S["head"])
    parts=[]
    def tube(points, radius=.021):
        path=[head + Vector((x*H,y*H,z*H)) for x,y,z in points]
        n=len(path)
        ob=B["sweep"]("antler", path, [H*radius*(1-i/(n-1)*.94) for i in range(n)], segs=9, samples=3, subdiv=1, rough=H*.001, rough_size=H*.045)
        parts.append(ob)
    for side in (1,-1):
        def P(x,y,z): return (x*side,y,z)
        if kind=="horns":
            tube([P(.10,.05,.04),P(.28,.04,.06),P(.40,.045,.25),P(.36,.0,.42)],.039)
            continue
        if kind=="short":
            l=.25 if name=="roe" else .14
            tube([P(.05,.018,.057),P(.067,.008,.15),P(.09,.045,l+.1)],.018)
            tube([P(.07,.013,.15),P(.07,-.07,.22)],.010)
            if name=="roe": tube([P(.08,.028,.22),P(.13,.04,.28)],.010)
            continue
        if kind in ("moose","palm"):
            # A solid webbed palm, with a thick tapered base and separate tines.
            moose=kind=="moose"
            tube([P(.065,.02,.075),P(.18,.07,.18),P(.32,.15,.24 if moose else .38)],.031)
            verts=[]; faces=[]
            for j in range(9):
                t=j/8
                centre=Vector(P(.24+.28*t if moose else .20+.10*t,.10+.12*t,.20+.12*t if moose else .25+.42*t))
                width=math.sin(math.pi*(.12+.78*t))*(.19 if moose else .13)
                for k in range(10):
                    a=2*math.pi*k/10
                    v=centre+Vector((0,math.cos(a)*width,math.sin(a)*.022))
                    verts.append(head+v*H)
            for j in range(8):
                for k in range(10): faces.append((j*10+k,j*10+(k+1)%10,(j+1)*10+(k+1)%10,(j+1)*10+k))
            faces.extend([tuple(reversed(range(10))),tuple(range(80,90))])
            me=bpy.data.meshes.new("palm");me.from_pydata(verts,[],faces);me.update()
            ob=bpy.data.objects.new("palm",me);bpy.context.scene.collection.objects.link(ob);B["smooth"](ob);parts.append(ob)
            for j in range(6):
                t=.2+j*.14
                x=.24+.28*t if moose else .20+.10*t
                z=.20+.12*t if moose else .25+.42*t
                y=.10+.12*t
                tube([P(x,y-.12,z),P(x+.075,y-.21,z+.09),P(x+.11,y-.23,z+.15)],.015)
            continue
        if kind=="reindeer":
            tube([P(.055,.018,.06),P(.16,.20,.32),P(.20,.31,.68),P(.18,.18,.93),P(.14,-.07,1.02)],.027)
            for x,y,z in [( .15,.15,.35),(.19,.29,.59),(.19,.25,.80)]: tube([P(x,y,z),P(x+.12,y-.08,z+.13),P(x+.14,y-.16,z+.23)],.015)
            tube([P(.07,.05,.10),P(.065,-.18,.19),P(.07,-.35,.15)],.021)
            for j in range(3): tube([P(.065,-.20-j*.05,.17),P(.09,-.24-j*.05,.29)],.012)
            continue
        if kind=="fork":
            tube([P(.05,.015,.06),P(.16,.03,.29),P(.28,.08,.51)],.025)
            for y in (-.10,.16):
                tube([P(.16,.03,.28),P(.26,y,.46),P(.30,y-.06,.64)],.017)
                tube([P(.25,y,.45),P(.36,y+.09,.57)],.013)
            continue
        # Three-tined chital/sambar; multi-tined red/elk/barasingha;
        # forward-curving white-tail beam; four-point sika.
        sweep_forward=kind=="beam" and name=="whitetail"
        tall=1.10 if name=="elk" else .88 if name=="barasingha" else .73
        beam=[P(.05,.018,.06),P(.14,.07,.23),P(.23,.18,.44),P(.27,.23,tall*.81),P(.24,-.04 if sweep_forward else .20,tall)]
        tube(beam,.028 if name in ("sambar","elk") else .021)
        tube([P(.09,.04,.14),P(.09,-.10,.23),P(.07,-.18,.31)],.016)
        if kind=="three": tube([P(.23,.18,.44),P(.37,.22,tall*.85),P(.39,.18,tall)],.015)
        else:
            count=5 if kind=="many" else 3
            for j in range(count):
                t=j/max(1,count-1)
                z=.30+t*(tall*.70-.30)
                tube([P(.18+t*.09,.13+t*.08,z),P(.24+t*.11,-.015,z+.15),P(.25+t*.12,-.06,z+.26)],.015*(1-t*.35))
    obj=B["join"](parts,"antlers")
    mat=bpy.data.materials.new("Antler");mat.diffuse_color=(.32,.25,.16,1);mat.use_nodes=True
    mat.node_tree.nodes.get("Principled BSDF").inputs["Roughness"].default_value=.82
    obj.data.materials.append(mat)
    group=obj.vertex_groups.new(name="head");group.add(list(range(len(obj.data.vertices))),1,"REPLACE")
    obj.parent=rig;mod=obj.modifiers.new("skin","ARMATURE");mod.object=rig
    obj.shape_key_add(name="Basis")
    for label in ("Growth","Asymmetry"):
        key=obj.shape_key_add(name=label)
        for v in key.data:
            rel=v.co-head
            if label=="Growth":v.co=head+Vector((rel.x*.72,rel.y*.76,rel.z*.53))
            elif v.co.x>0:v.co=head+Vector((rel.x*1.07,rel.y+.04*rel.z,rel.z*.94))
    return obj

def add_fur(name,S,rig):
    if name not in ("yak","sambar","elk","reindeer","moose"): return None
    H=ART[name][0]; parts=[]
    # Tapered coarse locks form a silhouette. Surface micro-fur is a shader;
    # these are reserved for the yak skirt, elk mane and reindeer throat.
    rows=20 if name=="yak" else 9
    for side in (-1,1):
        for j in range(rows):
            t=j/(rows-1)
            if name=="yak":
                c=Vector((side*H*(.20+.025*math.sin(t*6)),H*(-.40+t*.92),H*(.64+.02*math.sin(t*5))))
                length=H*(.29+.09*math.sin(t*11)**2)
            else:
                head=Vector(S["head"]);base=Vector(S["neck_base"])
                c=base.lerp(head,t*.75)+Vector((side*H*.055,H*.05,-H*.03))
                length=H*(.09+.035*math.sin(t*8)**2)
            path=[c,c+Vector((side*.008, .01,-length*.5)),c+Vector((side*.017,.025,-length))]
            ob=B["sweep"]("ruff",path,[H*.026,H*.022,H*.001],segs=5,samples=2,subdiv=0)
            parts.append(ob)
    ob=B["join"](parts,"fur")
    B["paint"](ob,lambda co,n:(.64,0,0,0))
    g=ob.vertex_groups.new(name="spine" if name=="yak" else "neck");g.add(list(range(len(ob.data.vertices))),1,"REPLACE")
    ob.parent=rig;mod=ob.modifiers.new("skin","ARMATURE");mod.object=rig
    return ob

def export_asset(name,young):
    global ACTIVE_HEIGHT
    ACTIVE_HEIGHT=ART[name][0]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    S=make_spec(name,young)
    body,rig=B["quadruped"](S)
    body.name="coat"
    mat=bpy.data.materials.new("DeerCoat");mat.use_nodes=True
    mat.node_tree.nodes.get("Principled BSDF").inputs["Roughness"].default_value=.88
    body.data.materials.clear();body.data.materials.append(mat)
    parts=[body]
    if not young:
        parts.append(make_antlers(name,S,rig))
        fur=add_fur(name,S,rig)
        if fur: fur.data.materials.append(mat);parts.append(fur)
    # Individual build/facial morphs leave joint positions unchanged and are
    # restricted to small anatomical differences compatible with the skin.
    body.shape_key_add(name="Basis")
    for label in ("Build","Muzzle","Female"):
        key=body.shape_key_add(name=label)
        H=ART[name][0]
        for v in key.data:
            if label=="Build" and .51*H<v.co.z<1.01*H and v.co.y>S["neck_base"][1]: v.co.x*=1.12
            elif label=="Muzzle" and v.co.y<S["head"][1]-.035*H: v.co.y-=.016*H
            elif label=="Female" and v.co.y<S["chest"][1] and v.co.z>.80*H: v.co.x*=.88
    meta={"species":name,"age":"fawn" if young else "adult","height":ART[name][0],"head":list(S["head"]),"seat":[0,ART[name][0]*1.015,0],"bones":len(rig.data.bones)}
    rig["deer"]=json.dumps(meta)
    # Include a real exportable idle clip, while runtime procedural IK poses
    # the same deform skeleton against terrain. No object-level locomotion.
    bpy.context.scene.frame_start=1;bpy.context.scene.frame_end=49
    for frame in (1,13,25,37,49):
        for bn in ("neck","earL","earR"):
            bone=rig.pose.bones[bn];bone.rotation_mode="XYZ"
            bone.rotation_euler=(math.sin((frame-1)/48*math.tau)*(.014 if bn=="neck" else .06),0,0)
            bone.keyframe_insert("rotation_euler",frame=frame,group=bn)
    if rig.animation_data and rig.animation_data.action: rig.animation_data.action.name="Quiet breathing"
    bpy.context.scene.frame_set(1)
    stem=name+("-fawn" if young else "")
    for lod in (0,1):
        if lod:
            for ob in parts:
                bpy.context.view_layer.objects.active=ob
                ob.select_set(True)
                # Blender cannot apply decimation to a mesh with shape keys;
                # bake its base for the far LOD, which never uses those keys.
                if ob.data.shape_keys: ob.shape_key_clear()
                m=ob.modifiers.new("distance_budget","DECIMATE");m.ratio=.30
                bpy.ops.object.modifier_apply(modifier=m.name)
                ob.select_set(False)
        bpy.ops.object.select_all(action="DESELECT")
        for ob in [rig]+parts: ob.select_set(True)
        path=os.path.join(OUT,stem+("-lod1" if lod else "")+".glb")
        bpy.ops.export_scene.gltf(filepath=path,export_format="GLB",use_selection=True,export_extras=True,export_skins=True,export_animations=True,export_morph=not lod,export_vertex_color="ACTIVE",export_all_vertex_colors=False,export_yup=True)
        print("[deer]",stem,"LOD",lod,"bones",len(rig.data.bones),"faces",sum(len(ob.data.polygons) for ob in parts),"bytes",os.path.getsize(path),flush=True)

args=sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else list(ART)
for name in args:
    if name not in ART: raise ValueError(name)
    for young in (False,True): export_asset(name,young)
