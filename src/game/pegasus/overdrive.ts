import * as THREE from "three"
import type { HorseState } from "../horses/horseState"
import { fwdX, fwdZ } from "../horses/horseState"
import { aberrationRT } from "../celestial/render/aberration"
import { travelling } from "../celestial/cosmicTravel"
import { spaceRT } from "../celestial/spaceState"
import { flightReducedMotion } from "./flightCamera"
import { originRT } from "../../world/origin"

/**
 * Starborn's overdrive as everything that shows it reads it (flight.ts does the
 * flying): how far into it she is, which way she is going, and what the air
 * round her is like, so the world can answer in its own way: streaks of the
 * air itself and a vapour cone in the low sky, spray off the water, mist torn
 * past in a cloud, the screen drawn toward where she is going (PostFX,
 * High), and beyond the air, the starbow: the real aberration of the sky
 * (render/aberration.ts) that a journey between worlds shows, here while she
 * runs on her sails.
 *
 * `beta` (the sky's v/c) is presentation only; a journey (cosmicTravel.ts)
 * owns the sky while it runs and this leaves it be.
 */
export const overdriveRT = {
  /** 0..1 eased, for the active rider's mount only */
  level: 0,
  /** the direction of her motion, local (unit) */
  dir: new THREE.Vector3(0, 0, 1),
  /** her speed along it (m/s) */
  speed: 0,
  /** 0..1 how strongly the screen is drawn toward where she is going (PostFX) */
  blur: 0,
  /** that point on the screen (0..1, y up), and whether it is ahead of the view at all */
  centre: new THREE.Vector2(0.5, 0.5),
  /** where she herself is on the screen (0..1, y up): the speed effect keeps her sharp */
  subject: new THREE.Vector2(0.5, 0.4),
  /** the starbow's v/c while she runs on the sails (0 in the air) */
  beta: 0,
}

/** The sky's most at the height of her overdrive on the sails (a journey goes to ~0.9). */
const SAIL_BETA = 0.55
const _p = new THREE.Vector3()

/** Once a frame, from the active rider's mount (or null) and the view. */
export const syncOverdrive = (h: HorseState | null, camera: THREE.Camera, dt: number): void => {
  const f = h?.flight
  const level = f && f.mode !== "ground" ? f.overdrive : 0
  overdriveRT.level = level
  if (h && f) {
    if (f.mode === "sail") overdriveRT.dir.set(Math.sin(h.heading) * Math.cos(f.pitch), Math.sin(f.pitch), Math.cos(h.heading) * Math.cos(f.pitch))
    else overdriveRT.dir.set(fwdX(h.heading) * h.speed, f.vy, fwdZ(h.heading) * h.speed)
    if (overdriveRT.dir.lengthSq() < 1e-6) overdriveRT.dir.set(fwdX(h.heading), 0, fwdZ(h.heading))
    overdriveRT.dir.normalize()
    overdriveRT.speed = f.mode === "air" ? Math.hypot(h.speed, f.vy) : h.speed
  }
  const calm = flightReducedMotion()
  if (h) {
    _p.set(h.x - originRT.x, h.y + 1.4, h.z - originRT.z).project(camera)
    if (_p.z < 1) overdriveRT.subject.set(_p.x * 0.5 + 0.5, _p.y * 0.5 + 0.5)
  }
  // the screen drawn toward the point she is flying at, only when it is in front of the view
  _p.copy(camera.position).addScaledVector(overdriveRT.dir, 1000).project(camera)
  const ahead = _p.z < 1 && Math.abs(_p.x) < 1.6 && Math.abs(_p.y) < 1.6
  overdriveRT.centre.set(THREE.MathUtils.clamp(_p.x * 0.5 + 0.5, -0.3, 1.3), THREE.MathUtils.clamp(_p.y * 0.5 + 0.5, -0.3, 1.3))
  const blurT = ahead && spaceRT.mode !== "deep" ? level * (calm ? 0.25 : 1) : 0
  overdriveRT.blur += (blurT - overdriveRT.blur) * (1 - Math.exp(-dt * (blurT > overdriveRT.blur ? 3 : 5)))
  // the starbow, beyond the air, unless a journey has the sky
  const sailing = f?.mode === "sail" && (spaceRT.mode === "deep" || spaceRT.thin > 0.5)
  const betaT = sailing ? level * SAIL_BETA * (calm ? 0.5 : 1) : 0
  overdriveRT.beta += (betaT - overdriveRT.beta) * (1 - Math.exp(-dt * (betaT > overdriveRT.beta ? 1.2 : 2)))
  if (overdriveRT.beta < 1e-3) overdriveRT.beta = 0
  if (!travelling() && (overdriveRT.beta > 0 || aberrationRT.beta > 0)) {
    aberrationRT.beta = overdriveRT.beta
    aberrationRT.dir.copy(overdriveRT.dir)
  }
}
