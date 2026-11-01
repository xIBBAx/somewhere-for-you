import * as THREE from "three"
import { RigPoser, type LegSpec } from "../rig/RigPoser"
import type { DeerModel } from "./assets"
import type { DeerState } from "./state"

const TAU = Math.PI * 2
const ease = (a: number, b: number, v: number): number => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const walk = [0, 0.5, 0.75, 0.25],
  trot = [0, 0.5, 0.5, 0],
  gallop = [0.08, 0.18, 0.58, 0.68]
type Leg = { spec: LegSpec; rest: THREE.Vector3; front: boolean; side: number }

/** Cervid gait layers: four-beat walk, diagonal trot, gathered gallop and
 * mule-deer stot. Runtime IK uses the existing anatomical RigPoser. */
export class DeerAnimator {
  readonly poser: RigPoser
  readonly seat = new THREE.Vector3()
  readonly gaitW = [1, 0, 0, 0]
  stride = 0
  gait = 0
  private legs: Leg[] = []
  private graze = 0
  private lie = 0
  private alert = 0
  private move = 0
  private target = new THREE.Vector3()
  private hip = new THREE.Vector3()
  private quat = new THREE.Quaternion()
  private distal = new THREE.Quaternion()
  private distalEuler = new THREE.Euler()
  private seatRest = new THREE.Vector3()
  private spineRest = new THREE.Vector3()
  constructor(
    readonly model: DeerModel,
    readonly seed: number,
  ) {
    this.poser = new RigPoser(model.root, model.bones)
    for (const [n, front, side] of [
      ["legFL", true, 1],
      ["legFR", true, -1],
      ["legBL", false, 1],
      ["legBR", false, -1],
    ] as const) {
      const spec = this.poser.leg(n + "1", n + "2", n + "3")
      this.legs.push({ spec, front, side, rest: this.poser.pos(n + "3").clone() })
    }
    this.seatRest.fromArray(model.meta.tack.seat)
    this.spineRest.copy(this.poser.pos("spine"))
    this.stride = (seed % 100) / 100
    this.seat.copy(this.seatRest)
  }
  update(d: DeerState, dt: number, time: number): void {
    const P = this.poser,
      H = this.model.meta.height,
      v = Math.abs(d.speed) / d.ident.scale
    // a deer turning where she stands steps round (light, quick little steps),
    // never spins on still hooves: the turn counts as movement for the legs
    const pivot = Math.abs(d.turnRate) * 0.75
    const blend = 1 - Math.exp(-dt * 4),
      moving = ease(0.03, 0.4, Math.max(v, pivot))
    this.move += (moving - this.move) * blend
    const tw = ease(d.pose.speeds[0] * 1.05, d.pose.speeds[1] * 0.85, Math.abs(d.speed))
    const gw = ease(d.pose.speeds[1] * 1.4, d.pose.speeds[2], Math.abs(d.speed))
    this.gaitW[0] = (1 - tw) * (1 - gw)
    this.gaitW[1] = tw * (1 - gw)
    this.gaitW[2] = gw * 0.35
    this.gaitW[3] = gw * 0.65
    this.gait = gw > 0.5 ? 3 : tw > 0.5 ? 1 : 0
    const cadence = (0.85 + tw * 0.7 + gw * 0.65 + Math.min(0.6, pivot * 0.5) * (1 - tw) * (1 - gw)) / Math.sqrt(H)
    this.stride = (this.stride + dt * cadence * this.move) % 1
    const ph = this.stride * TAU,
      w = this.move,
      stot = d.ident.species === "mule" && gw > 0.35
    const resting = ["rest", "sleep", "hide"].includes(d.mode) && !d.rider
    this.lie += ((resting ? 1 : 0) - this.lie) * (1 - Math.exp(-dt * 1.7))
    this.graze += ((["graze", "drink"].includes(d.mode) && !d.rider ? 1 : 0) - this.graze) * (1 - Math.exp(-dt * 2.4))
    this.alert += ((d.mode === "alert" || d.mode === "protect" ? 1 : Math.min(1, d.alarm)) - this.alert) * blend
    const jolt =
      d.react > 0
        ? Math.sin((1.25 - d.react) * (11 + (this.seed % 7))) *
          Math.min(1, d.react * 3) *
          (0.65 + d.ident.traits.shy * 0.45)
        : 0
    const bob = (Math.sin(ph * 2) * 0.009 * (1 - gw) + Math.max(0, Math.sin(ph)) * 0.075 * gw) * H * w
    const breathe = Math.sin(time * (1.6 + v * 0.05) + this.seed) * 0.0035 * H
    const sleep = d.mode === "sleep" ? this.lie : 0
    P.reset()
    const grazeDrop = this.graze * H * (d.ident.species === "yak" ? 0.13 : 0.055)
    P.offset("hips", 0, bob + breathe - this.lie * H * 0.49 - grazeDrop + Math.abs(jolt) * H * 0.065, 0)
    P.euler(
      "hips",
      Math.sin(ph) * 0.08 * gw * w + jolt * 0.13,
      Math.sin(ph) * 0.025 * w,
      -d.turnRate * v * 0.008 + jolt * 0.1,
    )
    P.euler("spine", Math.sin(ph) * 0.07 * gw * w + this.lie * 0.06, Math.sin(ph) * 0.025 * w, 0)
    P.euler("chest", -Math.sin(ph) * 0.045 * gw * w + jolt * 0.12, 0, 0)
    const bearing = Math.atan2(
      Math.sin(Math.atan2(d.watchX - d.x, d.watchZ - d.z) - d.heading),
      Math.cos(Math.atan2(d.watchX - d.x, d.watchZ - d.z) - d.heading),
    )
    const look =
      Math.max(-0.9, Math.min(0.9, bearing)) *
      (d.mode === "alert" || d.mode === "curious" || d.mode === "protect" ? 0.8 : 0.1)
    const browse = d.mode === "browse" ? Math.sin(time * 0.5) * 0.05 - 0.14 : 0
    P.euler(
      "neck",
      this.graze * 2.3 - this.alert * 0.18 + browse + sleep * 0.45 + jolt * 0.24 - d.swim * 0.5,
      look * 0.55 + (d.mode === "groom" ? 0.55 : 0) + Math.max(-0.35, Math.min(0.35, d.turnRate * 0.22)),
      0,
    )
    P.euler(
      "head",
      -this.graze * 0.9 - this.alert * 0.05 - Math.sin(ph) * 0.045 * gw * w + sleep * 0.24 + d.swim * 0.25,
      look * 0.45,
      Math.sin(time * 0.8 + this.seed) * 0.023,
    )
    P.euler("jaw", this.graze > 0.5 || d.mode === "browse" ? 0.04 + 0.035 * Math.sin(time * 5) : 0, 0, 0)
    const blink = Math.max(0, 1 - Math.abs(((time + this.seed * 0.17) % 4.7) - 0.1) / 0.1)
    for (const [name, side] of [
      ["L", 1],
      ["R", -1],
    ] as const) {
      const flick = Math.max(0, Math.sin(time * 1.1 + this.seed + side * 1.7)) ** 14 * Math.sin(time * 30) * 0.28
      P.euler(
        "ear" + name,
        this.alert * 0.2 + flick - d.alarm * 0.35,
        look * 0.35,
        side * (d.alarm * 0.22 + 0.07 * Math.sin(time * 0.47 + side)),
      )
      P.scale("ear" + name, d.ident.ears, d.ident.ears, d.ident.ears)
      P.scale("eye" + name, 1, 1 - Math.max(blink, sleep * 0.93) * 0.94, 1)
      if (P.has("pupil" + name)) P.scale("pupil" + name, 1, 1, 0.58)
    }
    for (let i = 1; i <= 3; i++)
      if (P.has("tail" + i))
        P.euler(
          "tail" + i,
          -(d.ident.species === "whitetail" ? d.alarm * 0.9 : 0.15),
          Math.sin(time * 1.4 - i * 0.5 + this.seed) * 0.12,
          0,
        )
    const jump = d.jumpT >= 0 ? Math.sin(d.jumpT * Math.PI) : 0
    const cycleLen = Math.min(H * 1.8, v / Math.max(0.5, cadence))
    for (let i = 0; i < 4; i++) {
      const leg = this.legs[i]
      let z = 0,
        x = 0,
        y = 0
      // the turn's own sweep: a planted hoof travels across the body as it
      // rotates over it (ω × r), and the swing carries it back
      const turnSweep = d.turnRate * leg.rest.z / Math.max(0.5, cadence)
      for (const [off, duty, weight, lift] of [
        [walk, 0.66, (1 - tw) * (1 - gw), 0.1],
        [trot, 0.48, tw * (1 - gw), 0.16],
        [stot ? [0, 0, 0.06, 0.06] : gallop, 0.34, gw, 0.28],
      ] as const) {
        const phase = (this.stride + off[i]) % 1
        const swing = phase < duty ? 0 : (phase - duty) / (1 - duty)
        const sweep = cycleLen * duty
        const along = phase < duty ? 0.5 - phase / duty : -0.5 + ease(0, 1, swing)
        z += along * sweep * weight
        x += along * turnSweep * duty * weight
        y += Math.sin(swing * Math.PI) * H * lift * weight * (v < 0.3 ? 0.7 : 1)
      }
      this.target.copy(leg.rest)
      this.target.z += z * w + (leg.front ? -0.16 : 0.13) * H * this.lie
      this.target.x += Math.max(-0.25 * H, Math.min(0.25 * H, x)) * w
      this.target.y += y * w + Math.max(-0.18, Math.min(0.22, d.pose.ground(this.target.x, this.target.z)))
      this.target.y -= this.lie * H * 0.2
      this.target.y += jump * H * (leg.front ? 0.3 : 0.22) + Math.abs(jolt) * H * (leg.front ? 0.05 : 0.18)
      if (d.swim > 0.01) {
        // swimming: a trot under water, diagonal pairs reaching and pulling
        // in long round strokes, forelegs folding high under the chest
        const sp = time * TAU * 1.2 + (leg.front === (leg.side > 0) ? 0 : Math.PI)
        const recover = Math.max(0, Math.cos(sp))
        const tz = leg.rest.z + Math.sin(sp) * H * (leg.front ? 0.2 : 0.15) + (leg.front ? 0.05 : -0.06) * H
        const ty = leg.rest.y + H * ((leg.front ? 0.2 : 0.1) + recover * 0.17)
        this.target.z += (tz - this.target.z) * d.swim
        this.target.y += (ty - this.target.y) * d.swim
      }
      if (d.mode === "protect" && i === 0) this.target.y += Math.max(0, Math.sin(time * 4)) * H * 0.1
      P.accumulated(P.recs.get(leg.spec.upper)!.bone.parent!.name, this.quat)
      P.posedHead(leg.spec.upper, this.hip)
      P.solveLeg(leg.spec, this.hip, this.target, this.quat)
      // The IK target is the ankle. Stabilize the distal cannon to plant the
      // actual hoof, then fold it forward when bedding down or bounding.
      P.accumulated(leg.spec.lower, this.quat).invert()
      this.distal.setFromEuler(this.distalEuler.set(-this.lie * 1.27 - jump * 0.6, 0, 0))
      P.setDelta(leg.spec.end, this.quat.multiply(this.distal))
    }
    // Contact follows the posed spine, including breath, turns and recoil.
    P.accumulated("spine", this.quat)
    this.seat.copy(this.seatRest).sub(this.spineRest).applyQuaternion(this.quat).add(P.posedHead("spine", this.target))
    P.apply()
    d.pose.lie = this.lie
    d.pose.graze = this.graze
  }
}
