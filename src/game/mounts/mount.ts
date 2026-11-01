import type * as THREE from "three"
import type { CharacterId } from "../runtime"
import type { HorsePose } from "../horses/HorseAnimator"

/** The contact/locomotion contract shared by horses and wild ungulates.
 * Species own simulation, permission and sounds; the rider owns one set of
 * controls, contact IK, mount transitions and camera outputs. */
export type MountBody = {
  kind: "horse" | "deer"
  ident: { id: string; name: string; seed: number; scale: number; saddled: boolean }
  x: number
  y: number
  z: number
  heading: number
  speed: number
  targetSpeed: number
  steer: number
  turnRate: number
  accel: number
  stamina: number
  jumpT: number
  /** seconds the current (or last) jump's arc lasts */
  jumpDur: number
  jumpY: number
  jumpCool: number
  wade: number
  lead: number
  rider: CharacterId | null
  reservedBy: CharacterId | null
  pose: HorsePose
  model: {
    meta: {
      height: number
      tack: {
        seat: number[]
        stirrupL: number[]
        stirrupR: number[]
        pommel?: number[]
        bitL: number[]
        bitR: number[]
        reinRest: number[]
        seat2?: number[]
        stirrupL2?: number[]
        stirrupR2?: number[]
      }
    }
  } | null
  animator: { seat: THREE.Vector3; stride: number; gaitW: number[]; gait: number | string } | null
}
export type MountDriver = {
  permission: (id: CharacterId) => "accept" | "reject" | "small"
  motion: (dt: number, turn: number | null) => void
  probe: (heading: number, distance: number) => number
  jump: () => "ok" | "refuse" | "busy"
  rest: () => void
  attempt: (id: CharacterId, accepted: boolean) => void
  reject: (id: CharacterId) => void
  pat: (id: CharacterId) => void
}
export const mountDrivers = new WeakMap<MountBody, MountDriver>()
export const mountInteractions: { wildlife: ((pat: boolean) => string | null) | null } = { wildlife: null }
