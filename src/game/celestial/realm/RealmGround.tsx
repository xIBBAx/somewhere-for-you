import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { avatarRT } from "../../runtime"
import { originRT } from "../../../world/origin"
import { spaceRT } from "../spaceState"
import { realmRT } from "./realmState"
import { REALM_GLSL } from "./realmGlsl"
import { CALM_MAX, type ElevationGrid } from "./realmTerrain"

/**
 * The ground of another world, drawn as nested grids round the player
 * (a geometry clipmap): eleven rings of 64 × 64 quads, each twice as coarse
 * as the one inside it, from half-metre cells at your feet to 512 m cells
 * near the horizon ~16 km off. Every vertex is lifted on the GPU by the same
 * height function the physics uses (realmGlsl.ts) and bent down over the
 * world's curve, so it meets the globe drawn beyond it.
 */

const LEVELS = 11
const N = 64
const BASE = 0.5

const elevationTexture = (g: ElevationGrid): THREE.DataTexture => {
  const half = new Uint16Array(g.data.length)
  for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(g.data[i])
  const t = new THREE.DataTexture(half, g.w, g.h, THREE.RedFormat, THREE.HalfFloatType)
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.ClampToEdgeWrapping
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearFilter
  t.needsUpdate = true
  return t
}

const BLANK = new THREE.DataTexture(new Uint16Array([0]), 1, 1, THREE.RedFormat, THREE.HalfFloatType)
BLANK.needsUpdate = true
const GREY = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1)
GREY.needsUpdate = true

/** Uniforms every level shares (the world), and each level's own. */
const shared = {
  uLocalToBody: { value: new THREE.Matrix3() },
  uRealmR: { value: 1 },
  uRealmO: { value: new THREE.Vector2() },
  uElev: { value: BLANK as THREE.Texture },
  uHasElev: { value: 0 },
  uCraters: { value: 0 },
  uCraterDepth: { value: 0.2 },
  uHills: { value: 0 },
  uDatum: { value: 0 },
  uCalm: { value: Array.from({ length: CALM_MAX }, () => new THREE.Vector4()) },
  uCalmN: { value: 0 },
  uPlayer: { value: new THREE.Vector2() },
  uAlbedo: { value: GREY as THREE.Texture },
  uHasAlbedo: { value: 0 },
  uGrey: { value: 0 },
  uTint: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
}

const levelMaterial = (level: number): { material: THREE.MeshStandardMaterial; own: Record<string, THREE.IUniform> } => {
  const own = {
    uCenter: { value: new THREE.Vector2() },
    uSpacing: { value: BASE * Math.pow(2, level) },
    uHoleCenter: { value: new THREE.Vector2() },
    uHoleHalf: { value: 0 },
  }
  const material = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, metalness: 0 })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, own)
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
${REALM_GLSL}
uniform vec2 uCenter;
uniform float uSpacing;
uniform vec2 uPlayer;
varying vec3 vRealmDir;
varying vec2 vRealmXZ;
vec2 rxz;
float rDrop;
float rH;`)
      .replace("#include <beginnormal_vertex>", `
  rxz = uCenter + position.xz * uSpacing;
  vec3 rdir = realmDir(rxz);
  rH = realmHeightDir(rdir);
  float e = uSpacing;
  float hx = realmHeightDir(realmDir(rxz + vec2(e, 0.0)));
  float hz = realmHeightDir(realmDir(rxz + vec2(0.0, e)));
  vec3 objectNormal = normalize(vec3(rH - hx, e, rH - hz));
  // the ground falls away over the world's curve, seen from the player
  vec2 fromPlayer = rxz - uPlayer;
  float pd = length(fromPlayer);
  rDrop = uRealmR * (1.0 - cos(pd / uRealmR));
  if (pd > 1e-3) objectNormal = normalize(objectNormal + vec3(fromPlayer / pd * sin(pd / uRealmR), 0.0).xzy * vec3(1.0, 0.0, 1.0));
  vRealmDir = rdir;
  vRealmXZ = rxz;`)
      .replace("#include <begin_vertex>", "vec3 transformed = vec3(rxz.x, rH - rDrop, rxz.y);")
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
uniform vec2 uHoleCenter;
uniform float uHoleHalf;
uniform sampler2D uAlbedo;
uniform float uHasAlbedo;
uniform float uGrey;
uniform vec3 uTint;
uniform float uRealmR;
varying vec3 vRealmDir;
varying vec2 vRealmXZ;
float rgHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float rgNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(rgHash(i), rgHash(i + vec3(1, 0, 0)), f.x), mix(rgHash(i + vec3(0, 1, 0)), rgHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(rgHash(i + vec3(0, 0, 1)), rgHash(i + vec3(1, 0, 1)), f.x), mix(rgHash(i + vec3(0, 1, 1)), rgHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`)
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
  // the finer ring inside owns its square
  if (uHoleHalf > 0.0 && max(abs(vRealmXZ.x - uHoleCenter.x), abs(vRealmXZ.y - uHoleCenter.y)) < uHoleHalf) discard;`)
      .replace("#include <color_fragment>", `#include <color_fragment>
  vec2 ruv = vec2(atan(vRealmDir.y, vRealmDir.x) / 6.2831853 + 0.5, asin(clamp(vRealmDir.z, -1.0, 1.0)) / 3.14159265 + 0.5);
  vec3 albedo = uHasAlbedo > 0.5 ? pow(texture2D(uAlbedo, ruv).rgb, vec3(2.2)) : uTint;
  if (uGrey > 0.5) { float g = dot(albedo, vec3(0.333)); albedo = mix(vec3(g), g * uTint / max(dot(uTint, vec3(0.333)), 1e-3), 0.55); }
  // regolith up close: grain and pebbles in the dust, a few metres to centimetres
  vec3 rq = vRealmDir * uRealmR;
  float grain = rgNoise(rq * 0.9) * 0.5 + rgNoise(rq * 4.3) * 0.3 + rgNoise(rq * 19.0) * 0.2;
  albedo *= 0.78 + grain * 0.44;
  diffuseColor.rgb = albedo * 1.6;`)
  }
  material.customProgramCacheKey = () => "realm-ground-v1"
  return { material, own }
}

export const RealmGround = (): React.ReactElement => {
  const sys = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(N, N, N, N)
    geometry.rotateX(-Math.PI / 2)
    const group = new THREE.Group()
    group.name = "realm-ground"
    group.visible = false
    const levels = Array.from({ length: LEVELS }, (_, i) => {
      const { material, own } = levelMaterial(i)
      const mesh = new THREE.Mesh(geometry, material)
      mesh.frustumCulled = false
      mesh.receiveShadow = true
      mesh.castShadow = false
      mesh.matrixAutoUpdate = false
      // finest first, so the coarse rings fill in only round them
      mesh.renderOrder = -0.5 + i * 0.01
      group.add(mesh)
      return { mesh, own }
    })
    return { group, levels, geometry, version: -1, elevation: null as THREE.DataTexture | null }
  }, [])

  useEffect(() => () => {
    sys.geometry.dispose()
    for (const l of sys.levels) (l.mesh.material as THREE.Material).dispose()
    sys.elevation?.dispose()
  }, [sys])

  useFrame(() => {
    const b = realmRT.body
    const on = !!b && spaceRT.mode === "local" && spaceRT.realm === b.def.id
    sys.group.visible = on
    if (!on || !b || !realmRT.look) return
    if (sys.version !== realmRT.version) {
      sys.version = realmRT.version
      const look = realmRT.look
      shared.uLocalToBody.value.copy(realmRT.localToBody)
      shared.uRealmR.value = b.radius
      shared.uHasElev.value = realmRT.grid ? 1 : 0
      sys.elevation?.dispose()
      sys.elevation = realmRT.grid ? elevationTexture(realmRT.grid) : null
      shared.uElev.value = sys.elevation ?? BLANK
      shared.uCraters.value = look.craters
      shared.uCraterDepth.value = look.depth
      shared.uHills.value = look.hills
      shared.uDatum.value = spaceRT.frame.datum
      shared.uCalmN.value = Math.min(CALM_MAX, realmRT.calm.length)
      realmRT.calm.forEach((c, i) => { if (i < CALM_MAX) shared.uCalm.value[i].set(c.dir.x, c.dir.y, c.dir.z, c.r) })
      shared.uTint.value.set(...b.def.color)
      shared.uGrey.value = ["io", "europa", "callisto", "enceladus", "titan"].includes(b.def.id) ? 1 : 0
      shared.uHasAlbedo.value = 0
      if (b.def.map) {
        new THREE.TextureLoader().load(`/assets/${b.def.map}`, (t) => {
          t.wrapS = THREE.RepeatWrapping
          t.anisotropy = 8
          shared.uAlbedo.value = t
          shared.uHasAlbedo.value = 1
        })
      }
    }
    // everything in render space (logical minus the floating origin)
    shared.uRealmO.value.set(spaceRT.frame.ox - originRT.x, spaceRT.frame.oz - originRT.z)
    const p = avatarRT().pos
    const px = p.x - originRT.x, pz = p.z - originRT.z
    shared.uPlayer.value.set(px, pz)
    sys.group.position.set(originRT.x, 0, originRT.z)
    sys.group.updateMatrixWorld()
    let innerX = 0, innerZ = 0, innerHalf = 0
    for (let i = 0; i < LEVELS; i++) {
      const l = sys.levels[i]
      const s = BASE * Math.pow(2, i)
      const snap = s * 2
      const cx = Math.floor(px / snap) * snap, cz = Math.floor(pz / snap) * snap
      l.own.uCenter.value.set(cx, cz)
      l.own.uHoleCenter.value.set(innerX, innerZ)
      // a cell of overlap hides the seam between rings
      l.own.uHoleHalf.value = i === 0 ? 0 : Math.max(0, innerHalf - s * 0.5)
      innerX = cx; innerZ = cz; innerHalf = (N / 2) * s
    }
  })

  return <primitive object={sys.group} />
}
