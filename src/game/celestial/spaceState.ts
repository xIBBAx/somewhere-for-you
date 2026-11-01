import { cloudLift, skyLift } from "../../world/highvale/highvaleSky"
import * as THREE from "three"
import { earthFrame, localAxes, localToUniverse, type SurfaceFrame } from "./frames"
import { airDensity } from "./scale"
import { nearestBody, universe, type BodyState } from "./universe"

/**
 * Where the player is in the universe and how the view is drawn.
 *
 * Near a surface ("local" mode) the Pegasus flies in the ordinary world
 * coordinates of that surface's frame: on Earth, the game world itself. Far
 * from every surface ("deep" mode) its position lives here in float64
 * universe metres while the riders and the camera stay parked at a fixed
 * local anchor, so the GPU only ever sees small numbers and nothing jitters
 * however far out they sail. The two meet without a seam: the universe point
 * of the anchor is exactly where the local flight left off.
 */

export type SpaceMode = "local" | "deep"

export const spaceRT = {
  mode: "local" as SpaceMode,
  /** the world whose surface frame is the local world ("earth" is home) */
  realm: "earth",
  frame: earthFrame() as SurfaceFrame,
  /** deep mode: the mount's universe position and the local→universe rotation of the parked anchor */
  pos: new THREE.Vector3(),
  park: new THREE.Quaternion(),
  anchor: new THREE.Vector3(),
  /** deep mode: the mount's velocity in universe metres per second */
  vel: new THREE.Vector3(),

  // ---- the view, refreshed every frame -------------------------------------
  /** the camera's universe position */
  eye: new THREE.Vector3(),
  /** local axes → universe axes at the camera */
  rot: new THREE.Quaternion(),
  rotInv: new THREE.Quaternion(),
  /** the camera's logical (local) position */
  camLocal: new THREE.Vector3(),
  /** the world nearest the camera and the height over it (game metres) */
  nearest: null as BodyState | null,
  altitude: 0,
  /** height of the camera over Earth's datum while on Earth (local) */
  earthAltitude: 0,
  /**
   * the camera's height in the air's terms: over the datum, less the lift of
   * the air over Highvale's ridges (world/highvale/highvaleSky.ts skyLift). The
   * thinning toward space, the aerial haze and the horizon read this one.
   */
  skyAltitude: 0,
  /**
   * the camera's height over the weather's floor: the datum, or over Highvale
   * the mountains' mean surface (highvaleSky.ts cloudLift). Rain, the storm's
   * dark and the cloud deck's fade read this one, as the clouds themselves do.
   */
  weatherAltitude: 0,
  /** 0 in the air of home … 1 in space: how much the sky has thinned */
  thin: 0,
  /** the selected destination */
  target: null as string | null,
  /** frozen story time while away from home (the planets stand still) */
  frozenTime: null as number | null,
  /** surfaced in the HUD: current speed (game m/s) */
  speed: 0,
}

const _q = new THREE.Quaternion()
const _v = new THREE.Vector3()

/** Refresh the view from the camera's logical position. */
export const updateSpaceView = (camLogical: THREE.Vector3): void => {
  spaceRT.camLocal.copy(camLogical)
  if (spaceRT.mode === "local") {
    localToUniverse(spaceRT.frame, camLogical.x, camLogical.y, camLogical.z, spaceRT.eye)
    localAxes(spaceRT.frame, camLogical.x, camLogical.z, spaceRT.rot)
  } else {
    _v.copy(camLogical).sub(spaceRT.anchor).applyQuaternion(spaceRT.park)
    spaceRT.eye.copy(spaceRT.pos).add(_v)
    spaceRT.rot.copy(spaceRT.park)
  }
  spaceRT.rotInv.copy(spaceRT.rot).invert()
  if (!universe.bodies.length) return
  const near = nearestBody(spaceRT.eye)
  spaceRT.nearest = near.body
  spaceRT.altitude = near.altitude
  const earth = universe.byId.get("earth")!
  spaceRT.earthAltitude = spaceRT.eye.distanceTo(earth.pos) - earth.radius
  spaceRT.skyAltitude = spaceRT.mode === "local" && spaceRT.realm === "earth"
    ? spaceRT.earthAltitude - skyLift(camLogical.x, camLogical.z) : spaceRT.earthAltitude
  spaceRT.weatherAltitude = spaceRT.mode === "local" && spaceRT.realm === "earth"
    ? spaceRT.earthAltitude - cloudLift(camLogical.x, camLogical.z) : spaceRT.earthAltitude
  // only Earth's own air hides the stars (Mars, Titan: their realms tint the sky)
  spaceRT.thin = spaceRT.realm === "earth" ? 1 - airDensity(spaceRT.skyAltitude) : 1
}

/** A universe point as a logical position seen from the camera (no compression). */
export const universeToView = (p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 =>
  out.copy(p).sub(spaceRT.eye).applyQuaternion(spaceRT.rotInv).add(spaceRT.camLocal)

/** A universe direction in local axes. */
export const universeDirToLocal = (d: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 =>
  out.copy(d).applyQuaternion(_q.copy(spaceRT.rotInv))

/**
 * Home's ground is drawn only while it can be seen as ground: from orbit it
 * is part of the globe, and on another world it is not there at all.
 */
export const homeGroundHidden = (): boolean =>
  spaceRT.realm !== "earth" || spaceRT.mode === "deep" || spaceRT.earthAltitude > 15_000

const _s = new THREE.Vector3()
const _c = new THREE.Vector3()
/**
 * The real Sun seen from the eye, in local axes, and how much of it is
 * visible: 0 while a world stands in front of it (night side of Earth, the
 * Moon's shadow), with a soft edge for the penumbra.
 */
export const sunFromEye = (out: THREE.Vector3): number => {
  const sun = universe.byId.get("sun")
  if (!sun) { out.set(0, 1, 0); return 1 }
  _s.copy(sun.pos).sub(spaceRT.eye)
  const dist = _s.length()
  _s.divideScalar(dist)
  let lit = 1
  for (const b of universe.bodies) {
    if (b === sun) continue
    _c.copy(b.pos).sub(spaceRT.eye)
    const along = _c.dot(_s)
    if (along <= 0 || along > dist) continue
    const miss = Math.sqrt(Math.max(0, _c.lengthSq() - along * along))
    // the Sun's own angular size softens the shadow's edge
    const soft = Math.max(b.radius * 0.02, along * (sun.radius / dist))
    lit = Math.min(lit, THREE.MathUtils.smoothstep(miss, b.radius - soft, b.radius + soft))
  }
  out.copy(_s).applyQuaternion(spaceRT.rotInv)
  return lit
}
