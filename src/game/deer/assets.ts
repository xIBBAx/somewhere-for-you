import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"
import { SPECIES, hasAntlers, type DeerIdentity } from "./species"
import { disposeFadeable } from "../../world/render/aerialFog"

export type DeerModel = {
  root: THREE.Group
  bones: Map<string, THREE.Bone>
  meshes: THREE.SkinnedMesh[]
  material: THREE.MeshStandardMaterial
  antlerMaterial: THREE.MeshStandardMaterial
  wet: { value: number }
  winter: { value: number }
  lod: 0 | 1
  meta: {
    height: number
    tack: {
      seat: number[]
      stirrupL: number[]
      stirrupR: number[]
      pommel: number[]
      bitL: number[]
      bitR: number[]
      reinRest: number[]
    }
  }
}
type Template = { scene: THREE.Group; height: number; head: THREE.Vector3 }
const templates = new Map<string, Promise<Template>>()
export const deerAssetUrl = (i: DeerIdentity, lod: 0 | 1): string =>
  `/assets/deer/${i.species}${i.age === "fawn" ? "-fawn" : ""}${lod ? "-lod1" : ""}.glb`
export const makeDeerModel = async (i: DeerIdentity, lod: 0 | 1): Promise<DeerModel> => {
  const url = deerAssetUrl(i, lod) + "?v=5"
  let pending = templates.get(url)
  if (!pending) {
    pending = new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .loadAsync(url)
      .then((g) => {
        let height = 0
        const head = new THREE.Vector3()
        g.scene.traverse((o) => {
          if (o.userData.deer) {
            const meta = JSON.parse(o.userData.deer)
            height = meta.height
            head.set(meta.head[0], meta.head[2], -meta.head[1]).divideScalar(height)
          }
        })
        if (!height || !g.animations.length) throw new Error(`Invalid deer rig/animation: ${url}`)
        return { scene: g.scene, height, head }
      })
    templates.set(url, pending)
    pending.catch(() => templates.delete(url))
  }
  const t = await pending,
    profile = SPECIES[i.species]
  const root = cloneSkeleton(t.scene) as THREE.Group
  const bones = new Map<string, THREE.Bone>(),
    meshes: THREE.SkinnedMesh[] = []
  const body = new THREE.Color(profile.coat).multiplyScalar(0.91 + i.coat * 0.18)
  const cold = new THREE.Color(profile.winter)
  const wet = { value: 0 },
    winter = { value: 0 }
  const mat = new THREE.MeshStandardMaterial({ color: "white", roughness: 0.87, metalness: 0, vertexColors: true })
  const uniforms = {
    deerBody: { value: body },
    deerCold: { value: cold },
    deerWet: wet,
    deerWinter: winter,
    deerSeed: { value: i.markingSeed / 97 },
    deerHeight: { value: t.height },
    deerHead: { value: t.head },
    deerRare: { value: i.rare ? 1 : 0 },
    deerSpots: {
      value: profile.spots || (i.age === "fawn" && !["sambar", "moose", "reindeer", "yak"].includes(i.species)) ? 1 : 0,
    },
    deerMane: { value: ["elk", "sambar", "red"].includes(i.species) && i.sex === "male" ? 1 : 0 },
    deerRump: { value: ["elk", "reindeer", "mule", "roe"].includes(i.species) ? 1 : 0 },
  }
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 deerRest; varying vec3 deerNormal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\ndeerRest = position; deerNormal = normal;")
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 deerRest, deerNormal;
uniform vec3 deerBody, deerCold, deerHead;
uniform float deerWet, deerWinter, deerSeed, deerHeight, deerSpots, deerMane, deerRump, deerRare;
float dh(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)) + deerSeed)*43758.5453); }
float dn(vec2 p){ vec2 q=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(dh(q),dh(q+vec2(1,0)),f.x),mix(dh(q+vec2(0,1)),dh(q+vec2(1,1)),f.x),f.y); }
float deerFur(vec3 p){
  vec2 uv=mix(p.zy,p.xy,smoothstep(.35,.8,abs(deerNormal.z)));
  float close=1.-smoothstep(.004,.014,max(length(dFdx(p)),length(dFdy(p))));
  return mix(.5,dn(uv*vec2(290.,48.))+dn(uv*vec2(670.,105.))*.27,close);
}
`,
      )
      .replace(
        "#include <color_fragment>",
        `
vec3 p=deerRest/deerHeight;
vec3 coat=mix(deerBody,deerCold,deerWinter);
float grain=dh(floor(p.zy*vec2(450.,900.)));
coat *= .82 + .26*deerFur(p);
// White ventral countershading is authored into the skin, not painted onto
// an axis-aligned bounding box that would whiten raised limbs.
coat=mix(coat,vec3(.71,.65,.54),clamp(vColor.g,0.,1.)*.82);
vec2 grid=vec2(p.z*15.,p.y*21.);
grid.x+=mod(floor(grid.y),2.)*.47;
vec2 cell=floor(grid), f=fract(grid)-.5;
f+=vec2(dh(cell),dh(cell+19.))*.20-.10;
float spotSize=.18+dh(cell+7.)*.07;
float spots=(1.-smoothstep(spotSize-.05,spotSize+.02+grain*.018,length(f)))*step(.11,dh(cell+38.))*step(.20,abs(deerNormal.x))*smoothstep(.48,.65,p.y)*(1.-smoothstep(1.02,1.15,p.y))*(1.-smoothstep(.44,.68,p.z));
coat=mix(coat,vec3(.82,.77,.64),spots*deerSpots*(1.-deerWinter*.6));
float dorsal=(1.-smoothstep(.015,.065,abs(p.x)))*smoothstep(.94,1.03,p.y)*(1.-smoothstep(.4,.6,p.z));
coat*=1.-dorsal*.20;
float mane=smoothstep(.30,.55,p.z)*smoothstep(.70,1.00,p.y)*deerMane;
coat*=1.-mane*.24;
float rump=smoothstep(.25,.44,-p.z)*smoothstep(.6,.8,p.y)*deerRump;
coat=mix(coat,vec3(.52,.44,.31),rump*.7);
float brow=(1.-smoothstep(.008,.022,abs(p.x)))*(1.-smoothstep(.025,.095,abs(p.y-deerHead.y+.025)))*(1.-smoothstep(.03,.09,abs(p.z-deerHead.z-.045)));
coat=mix(coat,vec3(.64,.55,.39),brow*deerRare*.7);
coat*=1.-deerWet*.24;
coat=mix(coat,vec3(.048,.040,.033),1.-smoothstep(.038,.063,p.y));
// Nose, cloven hooves and eyes carry literal vertex colours.
diffuseColor.rgb=mix(coat*clamp(vColor.r,.45,1.15),vColor.rgb,step(.65,vColor.a));
diffuseColor.a=opacity;
`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,.61,deerWet); if(vColor.a>.65 && vColor.a<.85) roughnessFactor=.13;",
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
// A surface-gradient bump follows the skinned view-space surface while its
// strand coordinates remain attached to the rest skin. No extra draw pass.
vec3 dq0=dFdx(-vViewPosition),dq1=dFdy(-vViewPosition);
vec3 dr1=cross(dq1,normal),dr2=cross(normal,dq0);
float determinant=dot(dq0,dr1),fur=deerFur(deerRest/deerHeight);
vec3 furGradient=sign(determinant)*(dFdx(fur)*dr1+dFdy(fur)*dr2);
normal=normalize(abs(determinant)*normal-furGradient*deerHeight*.0014*(1.-step(.65,vColor.a)));
`,
      )
  }
  mat.customProgramCacheKey = () => "living-deer-coat-v2"
  const antlerMaterial = new THREE.MeshStandardMaterial({
    color: i.species === "yak" ? "#4b443b" : i.antlerStage === "velvet" ? "#65513e" : "#aa906b",
    roughness: 0.85,
  })
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone)
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) {
      const m = o as THREE.SkinnedMesh
      meshes.push(m)
      m.castShadow = lod === 0
      m.receiveShadow = true
      m.frustumCulled = false // the owning animal is culled by its posed bounds
      const antler = m.name.toLowerCase().includes("antler")
      m.visible = !antler || hasAntlers(i)
      m.material = antler ? antlerMaterial : mat
      if (m.morphTargetDictionary && m.morphTargetInfluences) {
        const set = (key: string, value: number): void => {
          const index = m.morphTargetDictionary![key]
          if (index !== undefined) m.morphTargetInfluences![index] = value
        }
        set("Build", (i.build - 0.9) * 5)
        set("Muzzle", (i.muzzle - 0.94) / 0.12)
        set("Female", i.sex === "female" ? 1 : 0)
        set("Growth", Math.max(i.rare ? -0.2 : 0, Math.min(1, (1.2 - i.antlerScale) / 0.7)))
        set("Asymmetry", Math.max(0, Math.min(1, 0.5 + i.asymmetry * 12)))
      }
    }
  })
  const H = t.height,
    width = H * (i.species === "yak" ? 0.31 : 0.23)
  return {
    root,
    bones,
    meshes,
    material: mat,
    antlerMaterial,
    wet,
    winter,
    lod,
    meta: {
      height: H,
      tack: {
        seat: [0, H * 1.015, 0],
        stirrupL: [width, H * 0.56, 0.02],
        stirrupR: [-width, H * 0.56, 0.02],
        pommel: [0, H * 1.04, 0.18],
        bitL: [0.05, H * 1.19, 0.6],
        bitR: [-0.05, H * 1.19, 0.6],
        reinRest: [0, H * 1.06, 0.25],
      },
    },
  }
}
export const disposeDeerModel = (m: DeerModel): void => {
  disposeFadeable(m.root)
  m.root.removeFromParent()
  const skeletons = new Set(m.meshes.map((x) => x.skeleton))
  for (const s of skeletons) s.dispose()
  m.material.dispose()
  m.antlerMaterial.dispose()
}
