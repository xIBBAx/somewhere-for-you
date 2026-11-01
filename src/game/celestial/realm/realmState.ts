import * as THREE from "three"
import { REALM_ORIGIN, realmGround } from "../../../world/realmHook"
import { earthFrame, type SurfaceFrame } from "../frames"
import { spaceRT } from "../spaceState"
import { universe, type BodyState } from "../universe"
import { BODY, LANDABLE_IDS } from "../bodies"
import { REALM_LOOKS, loadElevation, surfaceHeight, type CalmSpot, type ElevationGrid, type RealmLook } from "./realmTerrain"

/**
 * Standing on another world. Its ground is laid out in the local world far
 * from home (REALM_ORIGIN), so nothing of home — no tree, wall or pond — is
 * anywhere near, and home's chunks simply wait. The surface frame is set
 * where you come down; from then on every height under a foot or a hoof is
 * that world's (realmGround), and so is gravity.
 */
export { REALM_ORIGIN }
/** Local y of the world's mean radius. */
export const REALM_DATUM = 0

export const realmRT = {
  /** the world being stood on (or flown low over), null at home and in deep space */
  body: null as BodyState | null,
  look: null as RealmLook | null,
  grid: null as ElevationGrid | null,
  /** local axes at the frame origin → the body's own fixed axes */
  localToBody: new THREE.Matrix3(),
  /** ground kept clear of craters (the historic sites), body-fixed */
  calm: [] as CalmSpot[],
  version: 0,
  /** QA: the last few "up" directions the frame was laid under */
  trail: [] as string[],
}

/** Calm ground per world, registered by its sites (lunarSites.ts). */
export const CALM_BY_BODY: Record<string, CalmSpot[]> = {}

const grids = new Map<string, Promise<ElevationGrid>>()
const ready = new Map<string, ElevationGrid>()

/** Start loading a world's elevation (before arriving). */
export const prepareRealm = (id: string): void => {
  const look = REALM_LOOKS[id]
  if (!look?.elevation || grids.has(look.elevation)) return
  const name = look.elevation
  const p = loadElevation(name)
  grids.set(name, p)
  void p.then((g) => ready.set(name, g)).catch((e) => console.warn("[realm] elevation", e))
}

/** Whether the world's ground is ready to stand on. */
export const realmReady = (id: string): boolean => {
  const look = REALM_LOOKS[id]
  if (!look) return false
  if (!look.elevation) return true
  prepareRealm(id)
  return ready.has(look.elevation)
}

/**
 * Whether a world's ground can be stood on as a realm: the Moon, and nothing
 * else (Earth is home itself, never a realm). Every caller that could switch
 * the ground goes through here, so a stale flag or a debug call cannot put
 * anyone on Mars.
 */
export const canLand = (b: BodyState | string): boolean => {
  const id = typeof b === "string" ? b : b.def.id
  return id !== "earth" && LANDABLE_IDS.includes(id) && !!BODY[id]?.landable && !!REALM_LOOKS[id]
}

const _dir = new THREE.Vector3()
const _basis = new THREE.Matrix3()
const _m4 = new THREE.Matrix4()
const _rot = new THREE.Matrix3()
const _x = new THREE.Vector3(), _y = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _t = new THREE.Matrix3()

/** game → body-fixed axes (rows), as the globe is drawn (CelestialSky bodyBasis). */
export const bodyAxes = (b: BodyState, out: THREE.Matrix3): THREE.Matrix3 => {
  const z = b.pole
  if (b.def.id === "moon") {
    _x.copy(universe.byId.get("earth")!.pos).sub(b.pos)
    _x.addScaledVector(z, -_x.dot(z)).normalize()
  } else {
    _x.set(1, 0, 0)
    if (Math.abs(z.x) > 0.9) _x.set(0, 1, 0)
    _x.addScaledVector(z, -_x.dot(z)).normalize()
    _q.setFromAxisAngle(z, b.spin)
    _x.applyQuaternion(_q)
  }
  _y.crossVectors(z, _x)
  return out.set(_x.x, _x.y, _x.z, _y.x, _y.y, _y.z, z.x, z.y, z.z)
}

/** Body-fixed unit direction of a local point on the current world. */
export const realmDirection = (x: number, z: number, out: THREE.Vector3): THREE.Vector3 => {
  const f = spaceRT.frame
  const dx = x - f.ox, dz = z - f.oz
  const d = Math.hypot(dx, dz)
  const th = d / f.radius
  if (d < 1e-9) out.set(0, 1, 0)
  else out.set((Math.sin(th) * dx) / d, Math.cos(th), (Math.sin(th) * dz) / d)
  return out.applyMatrix3(realmRT.localToBody).normalize()
}

/** The ground height at a local point on the current world. */
export const realmHeight = (x: number, z: number): number => {
  const b = realmRT.body, look = realmRT.look
  if (!b || !look) return REALM_DATUM
  realmDirection(x, z, _dir)
  return REALM_DATUM + surfaceHeight(_dir, b.radius, look, realmRT.grid, realmRT.calm)
}

/**
 * Come down to a world: lay its surface frame under the universe point `p`
 * (straight below it is the frame's origin) and switch the ground over.
 */
export const enterRealm = (b: BodyState, p: THREE.Vector3): SurfaceFrame | null => {
  if (!canLand(b)) return null
  const look = REALM_LOOKS[b.def.id]
  const up = _dir.copy(p).sub(b.pos).normalize()
  const frame: SurfaceFrame = {
    center: b.pos.clone(),
    radius: b.radius,
    datum: REALM_DATUM,
    orient: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up),
    ox: REALM_ORIGIN.x,
    oz: REALM_ORIGIN.z,
  }
  realmRT.trail.push(up.toArray().map((v) => +v.toFixed(3)).join(","))
  if (realmRT.trail.length > 6) realmRT.trail.shift()
  realmRT.body = b
  realmRT.look = look
  realmRT.grid = look.elevation ? ready.get(look.elevation) ?? null : null
  realmRT.calm = CALM_BY_BODY[b.def.id] ?? []
  // local axes → body axes = (game → body) · (local → game at the origin)
  _rot.setFromMatrix4(_m4.makeRotationFromQuaternion(frame.orient))
  realmRT.localToBody.multiplyMatrices(bodyAxes(b, _basis), _rot)
  realmRT.version++
  spaceRT.frame = frame
  spaceRT.realm = b.def.id
  realmGround.fn = realmHeight
  realmGround.gravityScale = look.gravity / 9.81
  return frame
}

/**
 * Lay the current world's frame again, under the universe point `p` (she has
 * sailed far across the old one). Returns false when no world is underfoot.
 */
export const recentreRealm = (p: THREE.Vector3): boolean => {
  const b = realmRT.body
  return !!b && !!enterRealm(b, p)
}

/** The local point (on the current world's frame) of a body-fixed direction, or null beyond the frame's reach. */
export const realmLocalOf = (dirBody: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 | null => {
  const f = spaceRT.frame
  // body → local axes at the frame origin is the transpose of localToBody
  _t.copy(realmRT.localToBody).transpose()
  const d = _dir.copy(dirBody).applyMatrix3(_t).normalize()
  const th = Math.acos(Math.max(-1, Math.min(1, d.y)))
  const h = Math.hypot(d.x, d.z)
  if (th > 1.2) return null
  const arc = th * f.radius
  return h < 1e-12 ? out.set(f.ox, 0, f.oz) : out.set(f.ox + (d.x / h) * arc, 0, f.oz + (d.z / h) * arc)
}

/** Leave a world's ground (back to deep space, or home). */
export const leaveRealm = (): void => {
  realmRT.body = null
  realmRT.look = null
  realmRT.grid = null
  realmRT.calm = []
  realmRT.version++
  realmGround.fn = null
  realmGround.gravityScale = 1
  spaceRT.frame = earthFrame()
  spaceRT.realm = "earth"
}
