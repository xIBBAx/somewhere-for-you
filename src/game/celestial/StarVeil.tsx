import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { catRT, characterRT, companionRT, playerRT, type CharacterId } from "../runtime"
import { riderRT } from "../horses/riding"
import type { HorseState } from "../horses/horseState"
import { originRT } from "../../world/origin"
import { inRealm } from "../../world/realmHook"
import { useGame } from "../../state/gameStore"
import { spaceRT } from "./spaceState"
import { sunFromEye } from "./spaceState"
import { names } from "../../personalization"

/**
 * The star-veil: how the explorer and the companion live where there is no air.
 *
 * Nobody could breathe above the sky or on the Moon, and a helmet alone
 * would not keep out the cold, the heat or the radiation. So when Starborn
 * carries her riders out of the air, her starlight closes round each of
 * them: a clear bubble about the head, holding air and warmth, and a faint
 * glow over the body that turns the rest aside. It is magic, and looks it:
 * a glass-clear sphere with a rim of starlight and a few slow flecks of
 * light drifting in it, catching the real Sun as a helmet visor would.
 *
 * It opens as the sky turns black (spaceState.thin) or on the Moon, and
 * closes again in Earth's air.
 *
 * The cat rides too, and gets her own: a smaller sphere round a cat's head,
 * centred a little above and ahead of the skull so it holds her tall ears
 * and her whiskers without touching them. Glass-clear face-on, so her eyes,
 * ears and whiskers still say everything she feels.
 */

const VERT = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vViewW;
varying vec3 vLocal;
void main() {
  vLocal = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vViewW = normalize(cameraPosition - w.xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

const FRAG = /* glsl */ `
uniform float uOpen;
uniform float uTime;
uniform vec3 uSun;
uniform float uSunLit;
uniform vec3 uTint;
varying vec3 vNormalW;
varying vec3 vViewW;
varying vec3 vLocal;
float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
void main() {
  vec3 n = normalize(vNormalW);
  if (!gl_FrontFacing) n = -n;
  float facing = abs(dot(n, vViewW));
  // glass: almost nothing face-on, a bright rim at grazing angles
  float rim = pow(1.0 - facing, 3.0);
  // a visor's glint of the real Sun
  vec3 h = normalize(uSun + vViewW);
  float glint = pow(max(dot(n, h), 0.0), 180.0) * uSunLit * 3.0;
  // slow flecks of starlight drifting over the sphere
  vec3 q = vLocal * 34.0 + vec3(0.0, uTime * 0.35, 0.0);
  vec3 cell = floor(q);
  float fleck = 0.0;
  float r = h31(cell);
  if (r > 0.86) {
    vec3 c = cell + vec3(h31(cell + 7.1), h31(cell + 3.3), h31(cell + 1.7));
    fleck = smoothstep(0.32, 0.0, length(q - c)) * (0.5 + 0.5 * sin(uTime * 2.0 + r * 40.0));
  }
  vec3 col = uTint * (rim * 0.9 + 0.035) + vec3(1.0, 0.96, 0.88) * glint + uTint * fleck * 1.4;
  float a = (rim * 0.55 + 0.04 + fleck * 0.6 + glint) * uOpen;
  gl_FragColor = vec4(col * uOpen, a);
}
`

type Veil = { mesh: THREE.Mesh; open: number; head: THREE.Object3D | null; group: string }

const _p = new THREE.Vector3()
const _sun = new THREE.Vector3()

export const StarVeil = (): React.ReactElement => {
  const scene = useThree((s) => s.scene)
  const sys = useMemo(() => {
    const geo = new THREE.SphereGeometry(1, 40, 28)
    const make = (group: string, tint: string): Veil => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uOpen: { value: 0 }, uTime: { value: 0 }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunLit: { value: 1 }, uTint: { value: new THREE.Color(tint) } },
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.name = `star-veil-${group}`
      mesh.visible = false
      mesh.frustumCulled = false
      mesh.renderOrder = 6
      return { mesh, open: 0, head: null, group }
    }
    const group = new THREE.Group()
    const veils: Record<CharacterId, Veil> = { explorer: make("explorer", "#bcd6ff"), companion: make("companion-character", "#cfe0ff") }
    const cat = make("cat", "#d4e2ff")
    group.add(veils.explorer.mesh, veils.companion.mesh, cat.mesh)
    return { group, veils, cat, geo, told: false, toldCat: false }
  }, [])

  useEffect(() => () => {
    sys.geo.dispose()
    for (const v of Object.values(sys.veils)) (v.mesh.material as THREE.Material).dispose()
    ;(sys.cat.mesh.material as THREE.Material).dispose()
  }, [sys])

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    // the real Sun from where the riders are (the visor's glint)
    const lit = sunFromEye(_sun)
    // local axes → render space is the identity up to the floating origin
    for (const id of ["explorer", "companion"] as const) {
      const v = sys.veils[id]
      const body = id === "explorer" ? playerRT : companionRT
      const r = riderRT[id]
      const h = r.horse as HorseState | null
      const present = id === "explorer" || characterRT.companionPresent
      // out of the air: on the Moon, or under the sails where the sky is black
      const off = present && (inRealm(body.pos.x, body.pos.z) || (r.phase === "riding" && !!h?.flight?.spec.celestial && spaceRT.thin > 0.88))
      v.open += ((off ? 1 : 0) - v.open) * (1 - Math.exp(-(off ? 2.2 : 3.5) * dt))
      v.mesh.visible = v.open > 0.01
      if (!v.mesh.visible) continue
      if (!v.head || !v.head.parent) {
        const root = scene.getObjectByName(v.group)
        v.head = root?.getObjectByName("head") ?? null
      }
      if (v.head) {
        v.head.getWorldPosition(_p)
        // render space → the logical space this group lives in
        _p.x += originRT.x
        _p.z += originRT.z
        _p.y += 0.07
      } else _p.set(body.pos.x, body.pos.y + 1.5, body.pos.z)
      v.mesh.position.copy(_p)
      // the bubble grows open from the crown
      v.mesh.scale.setScalar(0.215 * (0.6 + 0.4 * v.open))
      const m = v.mesh.material as THREE.ShaderMaterial
      m.uniforms.uOpen.value = v.open
      m.uniforms.uTime.value = state.clock.elapsedTime
      m.uniforms.uSun.value.copy(_sun)
      m.uniforms.uSunLit.value = lit
    }
    // The cat's: aboard Starborn out of the air, or on the Moon with her people
    {
      const v = sys.cat
      const r = riderRT.explorer
      const h = r.horse as HorseState | null
      const off = inRealm(catRT.pos.x, catRT.pos.z) || (catRT.aboard && !!h?.flight?.spec.celestial && spaceRT.thin > 0.88)
      // it closes round her a breath after her riders' (she is lower, nearer the starlight)
      v.open += ((off ? 1 : 0) - v.open) * (1 - Math.exp(-(off ? 2.0 : 3.5) * dt))
      v.mesh.visible = v.open > 0.01
      if (v.mesh.visible) {
        // headWorld is in render space; this group lives in logical space
        _p.copy(catRT.headWorld)
        _p.x += originRT.x
        _p.z += originRT.z
        _p.y += 0.035
        v.mesh.position.copy(_p)
        v.mesh.scale.setScalar(0.125 * (0.6 + 0.4 * v.open))
        const m = v.mesh.material as THREE.ShaderMaterial
        m.uniforms.uOpen.value = v.open
        m.uniforms.uTime.value = state.clock.elapsedTime
        m.uniforms.uSun.value.copy(_sun)
        m.uniforms.uSunLit.value = lit
      }
      if (!sys.toldCat && v.open > 0.5 && sys.told) {
        sys.toldCat = true
        useGame.getState().showHint(`And round ${names.cat} too — a little bubble of air, just her size.`)
      }
    }
    // the first time: say what it is
    if (!sys.told && sys.veils[characterRT.active].open > 0.5) {
      sys.told = true
      useGame.getState().showHint(`${names.starborn}'s starlight closes round you — a veil of air and warmth.`)
    }
  })

  return <primitive object={sys.group} />
}
