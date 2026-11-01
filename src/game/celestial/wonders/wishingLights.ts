import * as THREE from "three"
import { universeToView } from "../spaceState"
import { chime } from "./wonderSound"
import { passedThrough } from "./wishes"
import { LIGHT_FS, LIGHT_VS, RIPPLE_FS, RIPPLE_VS } from "./wonderShaders"
import { MAX_LIGHTS, sitePoint, toneOf, type WonderSite, type WonderTick } from "./wonderWorlds"

/**
 * The wishing lights: a loose cloud of glowing motes just ahead of where
 * Starborn arrives. Flying through one (within GATHER_RADIUS) chimes its note,
 * leaves a ripple of light, and gathers it; the others go on pulsing. The
 * cloud drifts slowly in its place, and the nearest light not yet gathered
 * has a faint guiding shimmer toward it. Once every light is gathered, the
 * constellation is drawn as a thread through them in the order they were
 * found. All of it is one draw call each for points, ripples and lines.
 */

/** Starborn gathers a light when her path passes within this many game metres of it. */
export const GATHER_RADIUS = 34
const RIPPLES = 16
const RIPPLE_LIFE = 1.8
const GUIDE_RANGE = 1800
const DRIFT = 4.5

export type WishingLights = {
  root: THREE.Group
  bind: (s: WonderSite | null) => void
  update: (t: WonderTick) => void
  dispose: () => void
}

export const createWishingLights = (onGather: (s: WonderSite, i: number) => void): WishingLights => {
  const root = new THREE.Group()
  root.name = "wishing-lights"
  root.visible = false

  const uniforms = {
    uTime: { value: 0 }, uHalfH: { value: 540 }, uCalm: { value: 0 }, uColor: { value: new THREE.Color("#ffffff") },
  }

  // ---- the lights
  const lg = new THREE.BufferGeometry()
  const lpos = new THREE.BufferAttribute(new Float32Array(MAX_LIGHTS * 3), 3)
  const lseed = new THREE.BufferAttribute(new Float32Array(MAX_LIGHTS), 1)
  const lgot = new THREE.BufferAttribute(new Float32Array(MAX_LIGHTS), 1)
  for (let i = 0; i < MAX_LIGHTS; i++) lseed.array[i] = (i * 0.618034) % 1
  lg.setAttribute("position", lpos)
  lg.setAttribute("aSeed", lseed)
  lg.setAttribute("aGot", lgot)
  const lmat = new THREE.ShaderMaterial({
    uniforms, vertexShader: LIGHT_VS, fragmentShader: LIGHT_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  const lights = new THREE.Points(lg, lmat)
  lights.frustumCulled = false
  root.add(lights)

  // ---- ripples
  const rg = new THREE.BufferGeometry()
  const rpos = new THREE.BufferAttribute(new Float32Array(RIPPLES * 3), 3)
  const rage = new THREE.BufferAttribute(new Float32Array(RIPPLES).fill(-1), 1)
  rg.setAttribute("position", rpos)
  rg.setAttribute("aAge", rage)
  const rmat = new THREE.ShaderMaterial({
    uniforms, vertexShader: RIPPLE_VS, fragmentShader: RIPPLE_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  const ripples = new THREE.Points(rg, rmat)
  ripples.frustumCulled = false
  root.add(ripples)
  const rAt = Array.from({ length: RIPPLES }, () => new THREE.Vector3())
  let nextRipple = 0

  // ---- the constellation's thread, and the guiding shimmer
  const tg = new THREE.BufferGeometry()
  const tpos = new THREE.BufferAttribute(new Float32Array(MAX_LIGHTS * 2 * 3), 3)
  tg.setAttribute("position", tpos)
  const tmat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
  const thread = new THREE.LineSegments(tg, tmat)
  thread.frustumCulled = false
  root.add(thread)

  const gg = new THREE.BufferGeometry()
  const gpos = new THREE.BufferAttribute(new Float32Array(6), 3)
  gg.setAttribute("position", gpos)
  const gmat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
  const guide = new THREE.LineSegments(gg, gmat)
  guide.frustumCulled = false
  guide.visible = false
  root.add(guide)

  let site: WonderSite | null = null
  const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Vector3()

  /** one segment of the thread, between two lights (their view positions are already set); returns the count */
  const thread2 = (k: number, a: number, b: number): number => {
    tpos.setXYZ(k * 2, lpos.getX(a), lpos.getY(a), lpos.getZ(a))
    tpos.setXYZ(k * 2 + 1, lpos.getX(b), lpos.getY(b), lpos.getZ(b))
    return k + 1
  }

  const spawnRipple = (at: THREE.Vector3): void => {
    rAt[nextRipple].copy(at)
    rage.array[nextRipple] = 0
    nextRipple = (nextRipple + 1) % RIPPLES
  }

  const bind = (s: WonderSite | null): void => {
    site = s
    root.visible = !!s
    if (!s) return
    uniforms.uColor.value.set(s.world.color)
    tmat.color.set(s.world.color)
    gmat.color.set(s.world.color)
    lg.setDrawRange(0, s.world.lights)
    for (let i = 0; i < MAX_LIGHTS; i++) lgot.array[i] = s.got[i]
    lgot.needsUpdate = true
    rage.array.fill(-1)
    rage.needsUpdate = true
  }

  const update = (t: WonderTick): void => {
    if (!site) return
    const s = site, n = s.world.lights
    const drift = t.calm ? DRIFT * 0.3 : DRIFT
    uniforms.uTime.value = t.time
    uniforms.uHalfH.value = t.halfH
    uniforms.uCalm.value = t.calm ? 1 : 0

    let guideI = -1, guideD = GUIDE_RANGE
    for (let i = 0; i < n; i++) {
      const o = s.offsets[i]
      // each light bobs slowly in its own rhythm, so the cloud breathes
      const ts = t.time * 0.05, ph = i * 1.37
      sitePoint(s,
        o[0] + Math.sin(ts * 1.3 + ph) * drift,
        o[1] + Math.cos(ts + ph * 0.7) * drift * 0.6,
        o[2] + Math.sin(ts * 0.9 + ph * 1.9) * drift * 0.5,
        s.live[i])
      if (!s.got[i]) {
        if (passedThrough(t.prev, t.mount, s.live[i], GATHER_RADIUS)) {
          s.got[i] = 1
          lgot.array[i] = 1
          spawnRipple(s.live[i])
          _d.subVectors(s.live[i], t.mount)
          const pan = Math.max(-0.8, Math.min(0.8, _d.dot(s.right) / 40))
          chime(toneOf(s.world, i), pan, 0.05, 2.2)
          onGather(s, i)
        } else {
          const dist = s.live[i].distanceTo(t.mount)
          if (dist < guideD) { guideD = dist; guideI = i }
        }
      }
      universeToView(s.live[i], _v)
      lpos.setXYZ(i, _v.x, _v.y, _v.z)
    }
    lpos.needsUpdate = true
    lgot.needsUpdate = true

    // ripples grow and fade
    for (let k = 0; k < RIPPLES; k++) {
      if (rage.array[k] < 0) continue
      rage.array[k] += t.dt / (RIPPLE_LIFE * (t.calm ? 1.6 : 1))
      if (rage.array[k] >= 1) { rage.array[k] = -1; continue }
      universeToView(rAt[k], _v)
      rpos.setXYZ(k, _v.x, _v.y, _v.z)
    }
    rpos.needsUpdate = true
    rage.needsUpdate = true

    // the thread through gathered lights, in the order they were found; closed once all are
    let segs = 0
    for (let i = 0; i + 1 < n; i++) if (s.got[i] && s.got[i + 1]) segs = thread2(segs, i, i + 1)
    let all = true
    for (let i = 0; i < n; i++) all = all && !!s.got[i]
    if (all && n > 2) segs = thread2(segs, n - 1, 0)
    thread.geometry.setDrawRange(0, segs * 2)
    tpos.needsUpdate = true
    tmat.opacity = all ? 0.55 : 0.28

    // a faint shimmer from Starborn to the nearest light still to find
    guide.visible = guideI >= 0
    if (guideI >= 0) {
      universeToView(t.mount, _m)
      _v.set(lpos.getX(guideI), lpos.getY(guideI), lpos.getZ(guideI))
      _d.subVectors(_v, _m)
      const L = _d.length()
      if (L > 1e-3) _d.multiplyScalar(1 / L)
      // from just off Starborn, to just short of the light
      const from = 10, to = Math.max(from + 2, L - GATHER_RADIUS)
      gpos.setXYZ(0, _m.x + _d.x * from, _m.y + _d.y * from, _m.z + _d.z * from)
      gpos.setXYZ(1, _m.x + _d.x * to, _m.y + _d.y * to, _m.z + _d.z * to)
      gpos.needsUpdate = true
      gmat.opacity = (t.calm ? 0.16 : 0.2) + (t.calm ? 0 : 0.14) * (0.5 + 0.5 * Math.sin(t.time * 3.2))
    }
  }

  const dispose = (): void => {
    lg.dispose(); lmat.dispose(); rg.dispose(); rmat.dispose()
    tg.dispose(); tmat.dispose(); gg.dispose(); gmat.dispose()
  }

  return { root, bind, update, dispose }
}
