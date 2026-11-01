import * as THREE from "three"
import { createCloseEncounters } from "./closeEncounters"
import { useGame } from "../../../state/gameStore"
import { qualityRT } from "../../../state/qualityStore"
import { universeDirToLocal, universeToView } from "../spaceState"
import { AURORA_FS, AURORA_VS, ICE_FS, ICE_VS } from "./wonderShaders"
import { passedThrough } from "./wishes"
import { rng, toneOf, type WonderSite, type WonderTick } from "./wonderWorlds"
import { names } from "../../../personalization"

/**
 * Two moments of the worlds that are not lights:
 *
 * Saturn: a drift of ice motes lying in a plane parallel to the rings, just
 * ahead of her (the ring plane itself is far off by then; this patch is
 * lifted to where she can reach it). Skim one and it flares into a cross of
 * sparkles with a glint, then settles.
 *
 * Jupiter: three faint curtains of aurora hanging in the air ahead, green at
 * the foot and violet above, breathing slowly. They are light only.
 */

const ICE_MAX = 220
const ICE_REACH = 26
const ICE_SOUND_GAP = 0.22
const ICE_DECAY = 2.2
/** the ring-parallel patch sits this far ahead of her (game m) and this wide */
const ICE_AHEAD = 420
const AURORA_AHEAD = 900
const AURORA_W = 1100
const AURORA_H = 640

export type WorldMoments = {
  root: THREE.Group
  bind: (s: WonderSite | null) => void
  update: (t: WonderTick) => void
  dispose: () => void
}

/** `onGlint` plays a glint at this pitch (Hz) and pan (-1..1). */
export const createWorldMoments = (onGlint: (freq: number, pan: number) => void): WorldMoments => {
  const root = new THREE.Group()
  root.name = "world-moments"
  root.visible = false
  let site: WonderSite | null = null
  const encounters = createCloseEncounters((world, i) => {
    const frequency = world === "sun" ? 196 * (i + 2) : world === "venus" ? 392 * 2 ** (i / 3) : 293.66 * 2 ** (i / 4)
    const pan = (i - 1) * 0.4
    onGlint(frequency, pan)
    root.userData.encounter = { world, index: i, frequency, pan, count: Number(root.userData.encounter?.count ?? 0) + 1 }
    useGame.getState().showHint(world === "venus" ? `The golden cloud silk parts for ${names.starborn}, then drifts together again.`
      : world === "mars" ? "A little dust dancer unfurls in your wake. Circle back and dance with it."
      : "The filaments ripple in your wake and sing a chord of sunlight. Circle gently to hear another voice.")
  })

  // ---- Saturn's ice
  const ig = new THREE.BufferGeometry()
  const ipos = new THREE.BufferAttribute(new Float32Array(ICE_MAX * 3), 3)
  const isize = new THREE.BufferAttribute(new Float32Array(ICE_MAX), 1)
  const iburst = new THREE.BufferAttribute(new Float32Array(ICE_MAX), 1)
  const iseed = new THREE.BufferAttribute(new Float32Array(ICE_MAX), 1)
  ig.setAttribute("position", ipos)
  ig.setAttribute("aSize", isize)
  ig.setAttribute("aBurst", iburst)
  ig.setAttribute("aSeed", iseed)
  const imat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uHalfH: { value: 540 }, uColor: { value: new THREE.Color("#e4f6ff") } },
    vertexShader: ICE_VS, fragmentShader: ICE_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  const ice = new THREE.Points(ig, imat)
  ice.frustumCulled = false
  ice.visible = false
  root.add(ice)
  const iBase = Array.from({ length: ICE_MAX }, () => new THREE.Vector3())
  let iceCount = 0
  let lastGlint = -10

  // ---- Jupiter's aurora: three curtains, flat ribbons facing back toward her
  const curtainGeo = new THREE.PlaneGeometry(1, 1)
  const curtains: THREE.Mesh[] = []
  for (let k = 0; k < 3; k++) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uSeed: { value: k * 0.31 }, uStrength: { value: 0.42 },
        uLow: { value: new THREE.Color(0.35, 1.0, 0.7) }, uHigh: { value: new THREE.Color(0.78, 0.45, 1.0) },
      },
      vertexShader: AURORA_VS, fragmentShader: AURORA_FS,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    })
    const m = new THREE.Mesh(curtainGeo, mat)
    m.name = `aurora-curtain-${k}`
    m.visible = false
    m.frustumCulled = false
    root.add(m)
    curtains.push(m)
  }

  root.add(encounters.root)

  const _u = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3()
  const _m = new THREE.Matrix4(), _d = new THREE.Vector3()

  const bind = (s: WonderSite | null): void => {
    site = s
    encounters.bind(s)
    root.visible = !!s
    ice.visible = !!s && s.world.ice
    for (const c of curtains) c.visible = !!s && s.world.aurora
    if (!s || !s.world.ice) return
    const scale = qualityRT.level === "low" ? 0.5 : qualityRT.level === "medium" ? 0.75 : 1
    iceCount = Math.round(ICE_MAX * scale)
    ig.setDrawRange(0, iceCount)
    imat.uniforms.uColor.value.set(s.world.color)
    // the patch lies in a plane parallel to the ring plane (the world's pole is its normal)
    const pole = s.body.pole
    const t1 = new THREE.Vector3().crossVectors(pole, s.right).normalize()
    const t2 = new THREE.Vector3().crossVectors(pole, t1).normalize()
    const rand = rng(`ice:${s.world.id}`)
    const centre = new THREE.Vector3().copy(s.at).addScaledVector(s.fwd, ICE_AHEAD)
    for (let i = 0; i < iceCount; i++) {
      const a = rand() * Math.PI * 2
      const r = 90 + 950 * Math.sqrt(rand())
      const j = (rand() - 0.5) * 16
      iBase[i].copy(centre).addScaledVector(t1, Math.cos(a) * r).addScaledVector(t2, Math.sin(a) * r).addScaledVector(pole, j)
      isize.array[i] = 0.7 + rand() * 1.1
      iseed.array[i] = rand()
      iburst.array[i] = 0
    }
    isize.needsUpdate = true
    iseed.needsUpdate = true
  }

  const update = (t: WonderTick): void => {
    const s = site
    if (!s) return
    encounters.update(t)
    if (s.world.ice) {
      imat.uniforms.uTime.value = t.time
      imat.uniforms.uHalfH.value = t.halfH
      for (let i = 0; i < iceCount; i++) {
        universeToView(iBase[i], _u)
        ipos.setXYZ(i, _u.x, _u.y, _u.z)
        // a flare decays; her path through a mote sets it off again
        let b = iburst.array[i] * Math.exp(-ICE_DECAY * t.dt)
        if (passedThrough(t.prev, t.mount, iBase[i], ICE_REACH)) {
          b = 1
          if (t.time - lastGlint > ICE_SOUND_GAP && !t.calm) {
            lastGlint = t.time
            _d.subVectors(iBase[i], t.mount)
            const pan = Math.max(-0.8, Math.min(0.8, _d.dot(s.right) / 60))
            onGlint(toneOf(s.world, 7 + (i % 5)), pan)
          }
        }
        iburst.array[i] = b
      }
      ipos.needsUpdate = true
      iburst.needsUpdate = true
    }
    if (s.world.aurora) {
      // the curtains hang in the sky ahead, facing back toward her, and breathe
      _u.copy(s.at).addScaledVector(s.fwd, AURORA_AHEAD)
      for (let k = 0; k < curtains.length; k++) {
        const m = curtains[k]
        ;(m.material as THREE.ShaderMaterial).uniforms.uTime.value = t.time
        _d.copy(_u).addScaledVector(s.right, (k - 1) * 680).addScaledVector(s.up, 40 + 70 * (k % 2))
        universeToView(_d, m.position)
        // the ribbon's width is its right, its height its up, its face the way back to her: a right-handed basis
        universeDirToLocal(s.right, _x)
        universeDirToLocal(s.up, _y)
        universeDirToLocal(_d.copy(s.fwd).negate(), _z)
        _m.makeBasis(_x, _y, _z)
        m.quaternion.setFromRotationMatrix(_m)
        m.scale.set(AURORA_W, AURORA_H, 1)
      }
    }
  }

  const dispose = (): void => {
    encounters.dispose()
    ig.dispose()
    imat.dispose()
    curtainGeo.dispose()
    for (const c of curtains) (c.material as THREE.ShaderMaterial).dispose()
  }

  return { root, bind, update, dispose }
}
