import * as THREE from "three"
import { DATUM_Y, EARTH_CENTER, EARTH_R } from "./scale"

/**
 * Two ways of saying where you are, joined without a seam.
 *
 * Local: the game's flat world coordinates, for walking, riding and flying
 * near a surface. Universe: the game frame extended as one straight-lined
 * space in which Earth is a ball 100 km in radius below home (universe.ts).
 *
 * A local point maps onto the ball with the azimuthal-equidistant ("exponential")
 * map around its local origin: its distance from that origin becomes an arc
 * on the surface and its height a height over the surface. Near the origin
 * the two agree to a fraction of a millimetre, so the world you ride over and
 * the planet you see from orbit are the same place; far from it the flat
 * world simply wraps round the globe.
 *
 * A surface frame names its sphere (centre, radius and datum). Earth's is
 * home; on another world the frame is set where you came down.
 */

export type SurfaceFrame = {
  /** sphere centre (universe) */
  center: THREE.Vector3
  radius: number
  /** local y of the sphere's surface */
  datum: number
  /** the rotation taking local axes to universe axes at the local origin */
  orient: THREE.Quaternion
  /** local coordinates of the frame's origin (another world's ground is laid far from home's) */
  ox: number
  oz: number
}

export const earthFrame = (): SurfaceFrame => ({
  center: new THREE.Vector3(EARTH_CENTER.x, EARTH_CENTER.y, EARTH_CENTER.z),
  radius: EARTH_R,
  datum: DATUM_Y,
  orient: new THREE.Quaternion(),
  ox: 0,
  oz: 0,
})

const UP = new THREE.Vector3(0, 1, 0)
const _n = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _axis = new THREE.Vector3()

/**
 * The rotation from the local origin's axes to the axes of the local point
 * (x, z): a tilt of arc/R about the horizontal axis square to the way out.
 */
export const surfaceTilt = (x: number, z: number, radius: number, out: THREE.Quaternion): THREE.Quaternion => {
  const d = Math.hypot(x, z)
  if (d < 1e-9) return out.identity()
  _axis.set(z / d, 0, -x / d)
  return out.setFromAxisAngle(_axis, d / radius)
}

/** Local point → universe point. */
export const localToUniverse = (f: SurfaceFrame, x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 => {
  surfaceTilt(x - f.ox, z - f.oz, f.radius, _q)
  _n.copy(UP).applyQuaternion(_q).applyQuaternion(f.orient)
  return out.copy(f.center).addScaledVector(_n, f.radius + (y - f.datum))
}

/** The full local-axes → universe-axes rotation at a local point. */
export const localAxes = (f: SurfaceFrame, x: number, z: number, out: THREE.Quaternion): THREE.Quaternion =>
  out.copy(f.orient).multiply(surfaceTilt(x - f.ox, z - f.oz, f.radius, _q))

/** Universe point → local point (the inverse map). */
export const universeToLocal = (f: SurfaceFrame, p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 => {
  _n.copy(p).sub(f.center)
  const r = _n.length()
  _q.copy(f.orient).invert()
  _n.divideScalar(r).applyQuaternion(_q)
  const cos = THREE.MathUtils.clamp(_n.y, -1, 1)
  const angle = Math.acos(cos)
  const h = Math.hypot(_n.x, _n.z)
  const arc = angle * f.radius
  if (h < 1e-12) return out.set(f.ox, f.datum + r - f.radius, f.oz)
  return out.set(f.ox + (_n.x / h) * arc, f.datum + r - f.radius, f.oz + (_n.z / h) * arc)
}
