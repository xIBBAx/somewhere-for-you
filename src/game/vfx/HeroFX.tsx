import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { cameraRT } from "../runtime"
import { weatherRT, rainReach } from "../weather/weatherState"
import { spaceRT } from "../celestial/spaceState"
import { sampleGround } from "../environment/ground/groundSurface"
import { surfaceAt } from "../audio/footsteps"
import { waterSurfaceAt } from "../../world/waterSurface"
import { inRealm } from "../../world/realmHook"
import { SHELTER_VOLUMES } from "../environment/water/waterSim"
import { qualityRT } from "../../state/qualityStore"
import { emitHero, heroCount, heroLook, heroPool, heroTracks, heroWet, HeroKind, HERO_POOL, type HeroId, type HeroTrack } from "./heroRuntime"

/**
 * The playable characters' physical effects (heroRuntime.ts): footfall debris,
 * jump and landing bursts, splashes, rain on the shoulders, drips, breath,
 * and the shared rim and wetness of their materials.
 *
 * Every particle is born once on the CPU and flown on the GPU: ballistic
 * motion with linear air drag (a puff of dust stalls in the air and billows,
 * a grain or a droplet keeps its arc), coming to rest on the ground or the
 * water it fell toward. A puff is shaded as a small ball of dust lit by the
 * sun and the sky (and glows when backlit, as dust does), a grain or a
 * clipping as a tumbling card, a droplet as a bead with a sun glint, a ripple
 * as a ring of reflected sky lying on the water. Alpha blended, one draw.
 */

const VERT = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
attribute vec4 iA;
attribute vec4 iB;
attribute vec4 iC;
attribute vec4 iD;
attribute vec4 iE;
varying vec2 vUv;
varying vec4 vCol;
varying float vKind;
varying float vAge;
varying float vSeed;
varying vec3 vSunV;
varying float vLanded;
void main() {
  float age = uTime - iA.w;
  float life = max(iB.w, 1e-3);
  vKind = iD.w;
  vCol = iC;
  vSeed = iE.w;
  vUv = position.xy;
  vSunV = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
  if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAge = 2.0; vLanded = 0.0; return; }
  vAge = age / life;
  // ballistic flight with linear drag k: x = x0 + v0 (1 - e^-kt) / k, gravity's terminal drift on top
  float k = max(iD.z, 1e-3);
  float ek = exp(-k * age);
  float reach = (1.0 - ek) / k;
  vec3 p = iA.xyz + iB.xyz * reach;
  p.y -= iE.x / k * (age - reach);
  float landed = 0.0;
  if (p.y < iE.y) { p.y = iE.y; landed = 1.0; }
  vLanded = landed;
  float size = iD.x * (1.0 + iD.y * (1.0 - exp(-3.0 * vAge)));
  if (vKind > 2.5 && vKind < 3.5) {
    // a ripple lies flat on the surface it was born on
    gl_Position = projectionMatrix * viewMatrix * vec4(p + vec3(position.x, 0.0, position.y) * size, 1.0);
    return;
  }
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vec2 dir = vec2(1.0, 0.0);
  float len = size;
  if (vKind > 1.5 && vKind < 2.5 && landed < 0.5) {
    // a droplet is drawn out along its flight (the eye's and the camera's blur)
    vec3 vel = iB.xyz * ek;
    vel.y -= iE.x * reach;
    vec3 vv = (viewMatrix * vec4(vel, 0.0)).xyz;
    float sp = length(vv.xy);
    if (sp > 1e-3) { dir = vv.xy / sp; len = size + sp * 0.012; }
  } else if (vKind > 0.5 && vKind < 1.5) {
    // grains and clippings tumble; at rest they lie still
    float a = iE.z * (landed > 0.5 ? 0.0 : age) + iE.w * 6.2832;
    dir = vec2(cos(a), sin(a));
    len = size * (1.4 + iE.w * 1.4);
  }
  vec2 side = vec2(-dir.y, dir.x);
  mv.xy += dir * position.x * len + side * position.y * size;
  gl_Position = projectionMatrix * mv;
}
`

const FRAG = /* glsl */ `
uniform vec3 uSunCol;
uniform vec3 uSkyCol;
uniform vec3 uGndCol;
varying vec2 vUv;
varying vec4 vCol;
varying float vKind;
varying float vAge;
varying float vSeed;
varying vec3 vSunV;
varying float vLanded;
void main() {
  if (vAge > 1.0) discard;
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  float r = sqrt(r2);
  vec3 base = vCol.rgb;
  vec3 col;
  float alpha;
  if (vKind < 0.5 || vKind > 3.5) {
    // a ball of dust, snow powder or breath: lit as a soft sphere, wrapped
    // round by the light it scatters, and bright when the sun is behind it
    vec3 n = vec3(vUv, sqrt(1.0 - r2));
    float wrap = clamp(dot(n, vSunV) * 0.6 + 0.4, 0.0, 1.0);
    float back = pow(clamp(-vSunV.z, 0.0, 1.0), 3.0) * (1.0 - r);
    vec3 amb = mix(uGndCol, uSkyCol, n.y * 0.5 + 0.5);
    col = base * (amb * 0.75 + uSunCol * wrap * 0.8) + uSunCol * base * back * 0.9;
    float soft = 1.0 - smoothstep(0.15, 1.0, r);
    float fade = smoothstep(0.0, 0.07, vAge) * (1.0 - smoothstep(0.3, 1.0, vAge));
    alpha = vCol.a * soft * soft * fade;
  } else if (vKind < 1.5) {
    // a grain, a clod or a blade of grass: a small lit card turning in the light
    float facing = 0.55 + 0.45 * sin(vSeed * 37.0 + vAge * 9.0 * (1.0 - vLanded));
    col = base * (uSkyCol * 0.55 + uGndCol * 0.1 + uSunCol * facing * 0.85);
    alpha = vCol.a * (1.0 - smoothstep(0.7, 1.0, vAge)) * (1.0 - smoothstep(0.75, 1.0, r));
  } else if (vKind < 2.5) {
    // a bead of water: the sky bent through it, darker at its rim, and a pin of sun
    vec3 n = vec3(vUv, sqrt(1.0 - r2));
    float spec = pow(clamp(dot(n, normalize(vSunV + vec3(0.0, 0.0, 1.0))), 0.0, 1.0), 24.0);
    col = (uSkyCol * 0.85 + uGndCol * 0.1) * base * mix(1.0, 0.55, r2) + uSunCol * spec * 2.2;
    alpha = vCol.a * (1.0 - smoothstep(0.55, 1.0, r)) * (1.0 - smoothstep(0.8, 1.0, vAge)) * (1.0 - vLanded);
  } else {
    // a ripple: a thin ring of reflected sky, thinning as it spreads
    float ring = smoothstep(0.72, 0.88, r) * (1.0 - smoothstep(0.9, 1.0, r));
    float inner = smoothstep(0.35, 0.6, r) * (1.0 - smoothstep(0.6, 0.75, r)) * 0.35;
    col = uSkyCol * 1.05 + uSunCol * 0.12;
    alpha = vCol.a * (ring + inner) * (1.0 - vAge) * (1.0 - vAge);
  }
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

const rand = (a: number, b: number): number => a + Math.random() * (b - a)
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
const C = (hex: string): THREE.Color => new THREE.Color(hex)

const DUST = C("#a88d70")
const DUST_SNOW = C("#f6f9fd")
const SAND = C("#dbc69c")
const SOIL = C("#6e5339")
const MUD = C("#4b3826")
const GRIT = C("#8e8a82")
const GRASS_A = C("#4f8028")
const GRASS_DARK = C("#355d1c")
const GRASS_B = C("#8db24a")
const SNOW = C("#f5f8fc")
const FOAM = C("#e9f2f4")
const WATER = C("#d4e6ec")
const VAPOUR = C("#f1f4f7")
const _c = new THREE.Color()
const tint = (base: THREE.Color, j = 0.08): THREE.Color => _c.copy(base).multiplyScalar(1 + rand(-j, j))

type Ground = "soil" | "sand" | "mud" | "grass" | "hard" | "snow" | "water"

const _fl = new THREE.Vector3()
const _fr = new THREE.Vector3()
const _foot = new THREE.Vector3()
const _head = new THREE.Vector3()
const _v = new THREE.Vector3()

const bonePos = (t: HeroTrack, name: string, out: THREE.Vector3): boolean => {
  const b = t.bones?.get(name)
  if (!b) return false
  b.getWorldPosition(out)
  return Number.isFinite(out.x + out.y + out.z)
}

const sheltered = (x: number, y: number, z: number): boolean =>
  SHELTER_VOLUMES.some(s => Math.hypot(x - s.x, z - s.z) < s.radius && y < s.roofY)

const groundUnder = (x: number, z: number): Ground => {
  if (weatherRT.snowCover > 0.3) {
    const s = surfaceAt(x, z, false)
    if (s === "grass") return "snow"
  }
  const surf = surfaceAt(x, z, false)
  if (surf === "concrete" || surf === "wood") return "hard"
  const g = sampleGround(x, z, weatherRT.wetness)
  switch (g.kind) {
    case "sand": return "sand"
    case "mud": return "mud"
    case "soil": return "soil"
    case "water": return "water"
    case "rock": case "built": return "hard"
    default: return "grass"
  }
}

/** Water kicked up: droplets on ballistic arcs and a ring spreading on the surface. */
const splash = (x: number, y: number, z: number, fx: number, fz: number, speed: number, power: number, rings = 2): void => {
  const n = heroCount(6 + 16 * power)
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    const out = rand(0.2, 1.1) * (0.6 + power)
    emitHero({
      x: x + Math.cos(a) * 0.06, y: y + 0.02, z: z + Math.sin(a) * 0.06,
      vx: Math.cos(a) * out + fx * speed * rand(0.15, 0.45), vy: rand(1.1, 3.0) * (0.55 + power * 0.75), vz: Math.sin(a) * out + fz * speed * rand(0.15, 0.45),
      life: 1.1, color: WATER, alpha: rand(0.65, 0.95), size: rand(0.011, 0.022), drag: 0.35, gravity: 9.8, floor: y, kind: HeroKind.Drop,
    })
  }
  for (let i = 0; i < rings; i++) {
    emitHero({ x, y: y + 0.006, z, life: rand(0.9, 1.3) + i * 0.2, color: FOAM, alpha: 0.5 - i * 0.12, size: 0.1 + i * 0.06, grow: rand(4, 6.5) + power * 3, kind: HeroKind.Ripple, delay: i * 0.12 })
  }
  const foam = heroCount(1 + 2 * power)
  for (let i = 0; i < foam; i++) {
    emitHero({ x: x + rand(-0.06, 0.06), y: y + 0.04, z: z + rand(-0.06, 0.06), vx: fx * speed * 0.2, vy: rand(0.1, 0.4), vz: fz * speed * 0.2, life: rand(0.5, 0.8), color: FOAM, alpha: 0.32, size: rand(0.08, 0.14), grow: 1.6, drag: 3, kind: HeroKind.Puff })
  }
}

/** What one footfall throws up, by what is underfoot and how fast she is going. */
const footfall = (t: HeroTrack): void => {
  const body = t.body!
  if (inRealm(body.pos.x, body.pos.z)) return
  const fx = Math.sin(body.facing), fz = Math.cos(body.facing)
  const hasL = bonePos(t, "footL", _fl), hasR = bonePos(t, "footR", _fr)
  if (hasL && hasR) _foot.copy(_fl.y < _fr.y ? _fl : _fr)
  else {
    t.side = -t.side
    _foot.set(body.pos.x + fz * 0.1 * t.side, body.pos.y, body.pos.z - fx * 0.1 * t.side)
  }
  const x = _foot.x, z = _foot.z
  const floor = body.pos.y
  const speed = body.speed
  const power = clamp01((speed - 1.6) / 4.6)
  const sideX = fz, sideZ = -fx
  if (t.water === "wade") {
    const w = waterSurfaceAt(x, z) ?? floor + 0.2
    splash(x, w, z, fx, fz, speed, 0.3 + power * 0.7)
    return
  }
  const ground = groundUnder(x, z)
  const exposed = !sheltered(x, floor + 1, z)
  const puddles = exposed && (weatherRT.surfaceWater > 0.12 || weatherRT.rain > 0.45) && ground !== "snow"
  const kick = (n: number, color: THREE.Color, opts: { alpha: number; up: [number, number]; back: [number, number]; size: [number, number]; gravity?: number; drag?: number; life?: number; spin?: number }): void => {
    const c = heroCount(n)
    for (let i = 0; i < c; i++) {
      const back = rand(opts.back[0], opts.back[1]) * (0.4 + power)
      const lat = rand(-0.5, 0.5) * (0.4 + power * 0.6)
      emitHero({
        x: x + rand(-0.04, 0.04), y: floor + 0.03, z: z + rand(-0.04, 0.04),
        vx: -fx * back + sideX * lat, vy: rand(opts.up[0], opts.up[1]) * (0.5 + power * 0.8), vz: -fz * back + sideZ * lat,
        life: (opts.life ?? 1.0) * rand(0.8, 1.2), color: tint(color), alpha: opts.alpha, size: rand(opts.size[0], opts.size[1]),
        drag: opts.drag ?? 0.5, gravity: opts.gravity ?? 9.8, floor: floor + 0.004, spin: rand(-1, 1) * (opts.spin ?? 14), kind: HeroKind.Chip,
      })
    }
  }
  const puff = (n: number, color: THREE.Color, alpha: number, size: number, grow = 2.8, life = 1.3): void => {
    const c = heroCount(n)
    for (let i = 0; i < c; i++) {
      const back = rand(0.2, 1.1) * (0.3 + power)
      emitHero({
        x: x - fx * 0.05 + rand(-0.05, 0.05), y: floor + rand(0.03, 0.08), z: z - fz * 0.05 + rand(-0.05, 0.05),
        vx: -fx * back + sideX * rand(-0.35, 0.35), vy: rand(0.12, 0.45) * (0.6 + power), vz: -fz * back + sideZ * rand(-0.35, 0.35),
        life: life * rand(0.75, 1.25) * (0.8 + power * 0.5), color: tint(color, 0.05), alpha: alpha * rand(0.75, 1.1),
        size: size * rand(0.8, 1.25) * (0.8 + power * 0.7), grow: grow * rand(0.8, 1.2), drag: 2.6, gravity: -0.04, floor: floor + 0.02, kind: HeroKind.Puff,
      })
    }
  }
  const dry = 1 - clamp01(weatherRT.wetness * 1.2)
  switch (ground) {
    case "soil":
      if (dry > 0.2) puff(2 + 4 * power, DUST, (0.3 + 0.3 * power) * dry, 0.1)
      kick(4 + 9 * power, Math.random() < 0.5 ? SOIL : GRIT, { alpha: 0.95, up: [0.7, 1.9], back: [0.5, 2.0], size: [0.012, 0.024] })
      break
    case "sand":
      if (dry > 0.2) puff(1 + power * 3, SAND, (0.16 + 0.2 * power) * dry, 0.09)
      kick(6 + 14 * power, SAND, { alpha: 0.92, up: [0.8, 2.3], back: [0.6, 2.4], size: [0.009, 0.016], life: 0.9 })
      break
    case "mud":
      kick(4 + 8 * power, MUD, { alpha: 0.97, up: [0.6, 1.7], back: [0.4, 1.5], size: [0.014, 0.03], drag: 0.3 })
      break
    case "snow":
      puff(3 + 5 * power, DUST_SNOW, 0.4 + 0.26 * power, 0.12, 3.2, 1.6)
      kick(5 + 10 * power, SNOW, { alpha: 0.98, up: [0.8, 2.1], back: [0.5, 2.0], size: [0.016, 0.038], drag: 0.7 })
      break
    case "grass":
      // clippings flick up and flutter down; a breath of dust only when running hard
      // torn blades and a little earth from under the turf
      kick(3 + 8 * power, Math.random() < 0.45 ? GRASS_A : Math.random() < 0.5 ? GRASS_B : GRASS_DARK, { alpha: 0.96, up: [1.0, 2.5], back: [0.5, 1.7], size: [0.016, 0.03], gravity: 5.5, drag: 1.8, life: 1.4, spin: 10 })
      if (power > 0.3) kick(1 + 3 * power, SOIL, { alpha: 0.95, up: [0.8, 1.8], back: [0.4, 1.4], size: [0.01, 0.018] })
      if (power > 0.25 && dry > 0.5) puff(1 + power * 2, DUST, 0.12 * power, 0.09)
      break
    case "hard":
      if (power > 0.4) kick(1 + 3 * power, GRIT, { alpha: 0.85, up: [0.5, 1.2], back: [0.3, 1.0], size: [0.006, 0.011] })
      break
    case "water":
      splash(x, floor + 0.01, z, fx, fz, speed, 0.25 + power * 0.6, 1)
      return
  }
  if (puddles) splash(x, floor + 0.005, z, fx, fz, speed, 0.15 + power * 0.55, 1)
}

/** The kick of a jump's take-off. */
const takeoff = (t: HeroTrack): void => {
  const body = t.body!
  if (inRealm(body.pos.x, body.pos.z)) return
  const x = body.pos.x, z = body.pos.z, floor = body.pos.y
  const fx = Math.sin(body.facing), fz = Math.cos(body.facing)
  if (t.water !== "land") { splash(x, waterSurfaceAt(x, z) ?? floor, z, fx, fz, body.speed, 0.7, 2); return }
  const ground = groundUnder(x, z)
  if (ground === "water") { splash(x, floor, z, fx, fz, body.speed, 0.7, 2); return }
  const color = ground === "snow" ? DUST_SNOW : ground === "sand" ? SAND : DUST
  const alpha = ground === "grass" ? 0.1 : ground === "hard" ? 0.06 : ground === "snow" ? 0.4 : 0.26
  const n = heroCount(4)
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    emitHero({ x: x + Math.cos(a) * 0.12, y: floor + 0.05, z: z + Math.sin(a) * 0.12, vx: Math.cos(a) * rand(0.4, 1.1) - fx * 0.6, vy: rand(0.1, 0.3), vz: Math.sin(a) * rand(0.4, 1.1) - fz * 0.6, life: rand(0.9, 1.4), color, alpha, size: rand(0.08, 0.13), grow: 2.4, drag: 3, gravity: -0.03, floor, kind: HeroKind.Puff })
  }
  const chips = heroCount(ground === "hard" ? 2 : 6)
  const chip = ground === "grass" ? GRASS_A : ground === "snow" ? SNOW : ground === "sand" ? SAND : SOIL
  for (let i = 0; i < chips; i++) {
    const a = Math.random() * Math.PI * 2
    emitHero({ x, y: floor + 0.03, z, vx: Math.cos(a) * rand(0.3, 1.0) - fx * rand(0.4, 1.2), vy: rand(1.0, 2.2), vz: Math.sin(a) * rand(0.3, 1.0) - fz * rand(0.4, 1.2), life: 1.0, color: tint(chip), alpha: 0.95, size: rand(0.01, 0.022), drag: ground === "grass" ? 1.8 : 0.5, gravity: ground === "grass" ? 5.5 : 9.8, floor: floor + 0.004, spin: rand(-12, 12), kind: HeroKind.Chip })
  }
}

/** A landing: a ring of dust running out over the ground, or a crown of water. */
const landing = (t: HeroTrack, peak: number, airTime: number): void => {
  const body = t.body!
  if (inRealm(body.pos.x, body.pos.z)) return
  const x = body.pos.x, z = body.pos.z, floor = body.pos.y
  const impact = clamp01(Math.max(peak / 1.1, airTime / 0.8))
  const fx = Math.sin(body.facing), fz = Math.cos(body.facing)
  const ground = t.water !== "land" ? "water" : groundUnder(x, z)
  if (ground === "water") {
    const w = waterSurfaceAt(x, z) ?? floor
    const n = heroCount(22 + 34 * impact)
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(1, n)) * Math.PI * 2 + rand(-0.15, 0.15)
      const out = rand(0.6, 1.6) * (0.7 + impact * 0.6)
      emitHero({ x: x + Math.cos(a) * 0.16, y: w + 0.02, z: z + Math.sin(a) * 0.16, vx: Math.cos(a) * out + fx * body.speed * 0.25, vy: rand(1.8, 4.0) * (0.6 + impact * 0.6), vz: Math.sin(a) * out + fz * body.speed * 0.25, life: 1.4, color: WATER, alpha: rand(0.7, 0.95), size: rand(0.013, 0.028), drag: 0.3, gravity: 9.8, floor: w, kind: HeroKind.Drop })
    }
    for (let i = 0; i < 3; i++) emitHero({ x, y: w + 0.006, z, life: 1.5 + i * 0.35, color: FOAM, alpha: 0.55 - i * 0.12, size: 0.2 + i * 0.1, grow: 6 + i * 2.5 + impact * 4, kind: HeroKind.Ripple, delay: i * 0.14 })
    const foam = heroCount(6)
    for (let i = 0; i < foam; i++) {
      const a = (i / foam) * Math.PI * 2
      emitHero({ x: x + Math.cos(a) * 0.2, y: w + 0.05, z: z + Math.sin(a) * 0.2, vx: Math.cos(a) * 0.6, vy: rand(0.2, 0.6), vz: Math.sin(a) * 0.6, life: rand(0.7, 1.1), color: FOAM, alpha: 0.38, size: rand(0.12, 0.18), grow: 2, drag: 3.2, kind: HeroKind.Puff })
    }
    return
  }
  const color = ground === "snow" ? DUST_SNOW : ground === "sand" ? SAND : DUST
  const dry = 1 - clamp01(weatherRT.wetness * 1.2)
  const alpha = (ground === "grass" ? 0.22 : ground === "hard" ? 0.12 : ground === "snow" ? 0.55 : 0.42) * (ground === "snow" ? 1 : Math.max(0.3, dry))
  const n = heroCount(12 + 18 * impact)
  for (let i = 0; i < n; i++) {
    const a = (i / Math.max(1, n)) * Math.PI * 2 + rand(-0.2, 0.2)
    const out = rand(1.3, 3.0) * (0.55 + impact * 0.7)
    emitHero({ x: x + Math.cos(a) * 0.14, y: floor + rand(0.03, 0.09), z: z + Math.sin(a) * 0.14, vx: Math.cos(a) * out, vy: rand(0.05, 0.4), vz: Math.sin(a) * out, life: rand(1.3, 2.2), color: tint(color, 0.05), alpha: alpha * rand(0.8, 1.1), size: rand(0.1, 0.17), grow: rand(3, 4.5), drag: 3.4, gravity: -0.02, floor: floor + 0.02, kind: HeroKind.Puff })
  }
  const chip = ground === "grass" ? GRASS_A : ground === "snow" ? SNOW : ground === "sand" ? SAND : ground === "mud" ? MUD : SOIL
  const chips = heroCount((ground === "hard" ? 4 : 12) + 16 * impact)
  for (let i = 0; i < chips; i++) {
    const a = Math.random() * Math.PI * 2
    const out = rand(0.5, 1.8) * (0.6 + impact * 0.6)
    emitHero({ x: x + Math.cos(a) * 0.1, y: floor + 0.03, z: z + Math.sin(a) * 0.1, vx: Math.cos(a) * out, vy: rand(1.0, 2.6) * (0.6 + impact * 0.5), vz: Math.sin(a) * out, life: 1.2, color: tint(Math.random() < 0.5 || ground !== "grass" ? chip : GRASS_B), alpha: 0.95, size: rand(0.01, 0.024), drag: ground === "grass" ? 1.8 : 0.5, gravity: ground === "grass" ? 5.5 : 9.8, floor: floor + 0.004, spin: rand(-12, 12), kind: HeroKind.Chip })
  }
  if (weatherRT.surfaceWater > 0.12 || weatherRT.rain > 0.45) splash(x, floor + 0.005, z, fx, fz, body.speed, 0.4 + impact * 0.5, 2)
}

/** Rain bursting on the head and shoulders, and once soaked, dripping from the hands. */
const rainOn = (t: HeroTrack, dt: number, rain: number): void => {
  const body = t.body!
  t.rainAcc += dt * rain * 30 * heroPool.scale
  let guard = 8
  while (t.rainAcc >= 1 && guard-- > 0) {
    t.rainAcc -= 1
    const head = Math.random() < 0.42
    const ok = head ? bonePos(t, "head", _head) : bonePos(t, Math.random() < 0.5 ? "upperarmL" : "upperarmR", _head)
    if (!ok) continue
    _head.y += head ? 0.12 : 0.05
    _head.x += rand(-0.06, 0.06); _head.z += rand(-0.06, 0.06)
    const n = 2 + (Math.random() < 0.5 ? 1 : 0)
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(0.4, 1.2)
      emitHero({ x: _head.x, y: _head.y, z: _head.z, vx: Math.cos(a) * s, vy: rand(0.4, 1.3), vz: Math.sin(a) * s, life: 0.55, color: WATER, alpha: 0.85, size: rand(0.007, 0.012), drag: 0.6, gravity: 9.8, floor: body.pos.y, kind: HeroKind.Drop })
    }
    if (Math.random() < 0.3) emitHero({ x: _head.x, y: _head.y, z: _head.z, vy: 0.2, life: 0.35, color: VAPOUR, alpha: 0.08 + rain * 0.06, size: 0.035, grow: 2.2, drag: 3, kind: HeroKind.Puff })
  }
  if (t.rainAcc > 4) t.rainAcc = 0
}

const drip = (t: HeroTrack, dt: number, rate: number): void => {
  const body = t.body!
  t.dripAcc += dt * rate
  let guard = 4
  while (t.dripAcc >= 1 && guard-- > 0) {
    t.dripAcc -= 1
    const where = Math.random()
    const ok = where < 0.7 ? bonePos(t, where < 0.35 ? "handL" : "handR", _v) : bonePos(t, "hips", _v)
    if (!ok) continue
    if (where < 0.7) _v.y -= 0.07
    else { _v.y -= 0.32; const a = Math.random() * Math.PI * 2; _v.x += Math.cos(a) * 0.16; _v.z += Math.sin(a) * 0.16 }
    emitHero({ x: _v.x, y: _v.y, z: _v.z, vx: body.vel.x * 0.3, vy: -0.25, vz: body.vel.z * 0.3, life: 0.9, color: WATER, alpha: 0.85, size: rand(0.009, 0.014), drag: 0.2, gravity: 9.8, floor: body.pos.y, kind: HeroKind.Drop })
  }
  if (t.dripAcc > 3) t.dripAcc = 0
}

/** Breath condensing in cold air: a few puffs carried forward from the mouth. */
const exhale = (t: HeroTrack): void => {
  const body = t.body!
  if (!bonePos(t, "head", _head)) return
  const fx = Math.sin(body.facing), fz = Math.cos(body.facing)
  const n = heroCount(4)
  for (let i = 0; i < n; i++) {
    emitHero({
      x: _head.x + fx * 0.1, y: _head.y - 0.03, z: _head.z + fz * 0.1,
      vx: fx * rand(0.35, 0.75) + body.vel.x * 0.55, vy: rand(-0.02, 0.08), vz: fz * rand(0.35, 0.75) + body.vel.z * 0.55,
      life: rand(1.3, 1.9), color: VAPOUR, alpha: rand(0.1, 0.16), size: rand(0.03, 0.05), grow: 4, drag: 2.2, gravity: -0.03, kind: HeroKind.Breath, delay: i * 0.08,
    })
  }
}

const coldAir = (): boolean => {
  const temp = weatherRT.data.temperatureC
  return weatherRT.snow > 0.12 || weatherRT.snowCover > 0.35 || (temp !== null && temp < 6)
}

const sunOf = { light: null as THREE.DirectionalLight | null, hemi: null as THREE.HemisphereLight | null }

export const HeroFX = (): React.ReactElement => {
  const scene = useThree(s => s.scene)
  const camera = useThree(s => s.camera)
  const { mesh, material, geometry } = useMemo(() => {
    const geometry = new THREE.InstancedBufferGeometry()
    const quad = new THREE.PlaneGeometry(2, 2)
    geometry.index = quad.index
    geometry.setAttribute("position", quad.getAttribute("position"))
    const add = (name: string, arr: Float32Array): void => {
      const attr = new THREE.InstancedBufferAttribute(arr, 4)
      attr.setUsage(THREE.DynamicDrawUsage)
      geometry.setAttribute(name, attr)
    }
    add("iA", heroPool.a); add("iB", heroPool.b); add("iC", heroPool.c); add("iD", heroPool.d); add("iE", heroPool.e)
    geometry.instanceCount = HERO_POOL
    // particles live anywhere the two of them walk: never cull the pool
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7)
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunCol: { value: new THREE.Color(1, 1, 1) }, uSkyCol: { value: new THREE.Color(0.5, 0.6, 0.7) }, uGndCol: { value: new THREE.Color(0.3, 0.3, 0.2) },
      },
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = "hero-fx"
    mesh.frustumCulled = false
    // over the water surface (renderOrder 1), so splashes and ripples sit on it
    mesh.renderOrder = 2
    return { mesh, material, geometry }
  }, [])
  useEffect(() => () => { geometry.dispose(); material.dispose() }, [geometry, material])

  useFrame((_, rawDt) => {
    const dt = Math.min(Math.max(rawDt, 0), 0.1)
    heroPool.clock += dt
    heroPool.scale = qualityRT.level === "high" ? 1 : qualityRT.level === "medium" ? 0.75 : 0.5
    const u = material.uniforms
    u.uTime.value = heroPool.clock
    // light the particles like the world, and give both characters their rim
    if (!sunOf.light || !sunOf.light.parent) sunOf.light = scene.getObjectByName("celestial-key") as THREE.DirectionalLight | null
    if (!sunOf.hemi || !sunOf.hemi.parent) sunOf.hemi = scene.getObjectByName("sky-fill") as THREE.HemisphereLight | null
    const sun = sunOf.light, hemi = sunOf.hemi
    if (sun) {
      const d = (u.uSunDir.value as THREE.Vector3).subVectors(sun.position, sun.target.position)
      if (d.lengthSq() > 1e-8) d.normalize()
      heroLook.uHeroSun.value.copy(d)
      ;(u.uSunCol.value as THREE.Color).copy(sun.color).multiplyScalar(sun.intensity * 0.55)
      heroLook.uHeroSunRim.value.copy(sun.color).multiplyScalar(Math.min(3, sun.intensity) * 0.5)
    }
    if (hemi) {
      ;(u.uSkyCol.value as THREE.Color).copy(hemi.color).multiplyScalar(hemi.intensity * 0.9 + scene.environmentIntensity * 0.35)
      ;(u.uGndCol.value as THREE.Color).copy(hemi.groundColor).multiplyScalar(hemi.intensity * 0.7)
      heroLook.uHeroRim.value.copy(hemi.color).multiplyScalar(0.2 + hemi.intensity * 0.26)
    }

    const onEarth = spaceRT.realm === "earth"
    for (const id of ["explorer", "companion"] as HeroId[]) {
      const t = heroTracks[id]
      const body = t.body
      if (!body) continue
      const near = camera.position.distanceToSquared(_v.set(body.pos.x, body.pos.y, body.pos.z)) < 90 * 90 || cameraRT.distance < 30
      // ---- footfalls
      while (t.steps > 0) {
        t.steps--
        if (near && !t.mounted && t.water !== "swim") footfall(t)
      }
      // ---- jumps: take-off, the highest point, the landing
      const phase = body.jumpPhase
      const wasAir = t.lastPhase === "rising" || t.lastPhase === "falling"
      const isAir = phase === "rising" || phase === "falling"
      if (!t.mounted && near) {
        if (!wasAir && phase === "rising") takeoff(t)
        if (wasAir && !isAir) landing(t, t.airPeak, t.airTime)
      }
      if (isAir) { t.airPeak = Math.max(t.airPeak, body.jumpHeight); t.airTime += dt } else { t.airPeak = 0; t.airTime = 0 }
      t.lastPhase = phase
      // ---- rain on them, wet clothes, drips
      const roofed = sheltered(body.pos.x, body.pos.y + 1.2, body.pos.z)
      const rain = onEarth && !roofed && !inRealm(body.pos.x, body.pos.z) ? weatherRT.rain * rainReach(body.pos.y, onEarth) : 0
      if (near && rain > 0.08) rainOn(t, dt, rain)
      if (t.water === "swim") { t.wet = 1; t.line = 2.5 }
      else {
        t.wet = clamp01(t.wet + dt * rain * 0.045 - dt * (1 - rain) * (0.006 + weatherRT.heat * 0.01))
        if (t.water === "wade") {
          const w = waterSurfaceAt(body.pos.x, body.pos.z)
          if (w !== null) t.line = Math.max(t.line, Math.min(1.3, w - body.pos.y + 0.12))
        } else t.line = Math.max(-1, t.line - dt * 0.01)
      }
      heroWet[id].value.set(t.wet, t.line)
      if (near && (t.wet > 0.35 || t.line > 0.4) && t.water === "land") drip(t, dt, t.wet * 2.2 + rain * 3 + (t.line > 0.4 ? 1.5 : 0))
      // ---- breath in the cold
      if (near && coldAir()) {
        t.breath -= dt * (1 + clamp01(body.speed / 6) * 1.6)
        if (t.breath <= 0) { t.breath = rand(3.1, 3.9); exhale(t) }
      }
    }

    // upload only what was born this frame
    if (heroPool.dirtyTo >= 0) {
      const from = heroPool.dirtyFrom, count = heroPool.dirtyTo - from + 1
      for (const name of ["iA", "iB", "iC", "iD", "iE"]) {
        const attr = geometry.getAttribute(name) as THREE.InstancedBufferAttribute
        attr.clearUpdateRanges()
        attr.addUpdateRange(from * 4, count * 4)
        attr.needsUpdate = true
      }
      heroPool.dirtyFrom = Infinity
      heroPool.dirtyTo = -1
    }
  })
  return <primitive object={mesh} />
}
