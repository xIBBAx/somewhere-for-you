import { registerDevTool } from "../../dev/devTools"
import { avatarRT, characterRT, worldRT } from "../runtime"
import { groundHeight } from "../world-layout"
import { horseRT, type HorseState } from "../horses/horseState"
import { riderRT, startMount, requestDismount } from "../horses/riding"
import { setMode } from "../horses/horseBrain"
import { flightQA, groundNow, startTakeoff, type FlightIntent } from "./flight"
import type { WingPose } from "./WingAnimator"
import { pegasusRT } from "./pegasi"
import { flightCamRT } from "./flightCamera"
import { ascentRT } from "./AscentFX"
import { spaceCatsRT } from "../celestial/spaceCats/catsRuntime"
import * as THREE from "three"
const _s = new THREE.Vector3()
import { cameraRT } from "../runtime"

/**
 * `?debug` helpers for the Pegasi:
 *   __worldDev.pegasi()                      every Pegasus with its flight state
 *   __worldDev.pegasusHere("Ivory")           bring a Pegasus beside the active character
 *   __worldDev.ridePegasus("Ivory")           bring it here and get on
 *   __worldDev.takeoff()                     the active rider's Pegasus takes off
 *   __worldDev.flyIntent({ thrust, turn, climb, boost, land })   hold flight controls (null releases)
 *   __worldDev.flight()                      the active rider's flight state
 *   __worldDev.wingPose("Ivory", { spread: 1, flap: 0.3, power: 1 })  freeze the wings (null releases)
 *   __worldDev.flyTo("Ivory", alt)            put a Pegasus in level flight at a height (QA framing)
 *   __worldDev.starHill()                    where Starborn waits
 *   __worldDev.lookAvatar(az, d, height)     frame the active character (az 0 = in front of them)
 *   __worldDev.lookFree()                    hand the camera back to the game
 */
const find = (name: string): HorseState | undefined =>
  [...horseRT.horses.values()].find((h) => h.flight && (h.ident.name.toLowerCase() === name.toLowerCase() || h.ident.id === name || h.ident.breed === name))

const flightInfo = (h: HorseState) => {
  const f = h.flight!
  return {
    name: h.ident.name, x: +h.x.toFixed(1), y: +h.y.toFixed(1), z: +h.z.toFixed(1), heading: +h.heading.toFixed(2), speed: +h.speed.toFixed(2),
    mode: f.mode, alt: +f.alt.toFixed(1), vy: +f.vy.toFixed(2), pitch: +f.pitch.toFixed(2), roll: +f.roll.toFixed(2), spread: +f.spread.toFixed(2),
    flap: +f.flap.toFixed(2), power: +f.power.toFixed(2), glide: +f.glide.toFixed(2), rider: h.rider, passenger: h.passenger, stats: { ...f.stats },
    visible: h.visible, loaded: !!h.model,
    tuck: +f.tuck.toFixed(2), dashT: +f.boostT.toFixed(1), stoop: +f.stoop.toFixed(2), spin: +f.spin.toFixed(2), lift: +f.lift.toFixed(2),
    overdrive: +f.overdrive.toFixed(3), odT: +f.odT.toFixed(2),
    trick: { kind: f.trick.kind, u: f.trick.kind ? +(f.trick.t / f.trick.T).toFixed(2) : 0, grip: f.trick.kind ? +f.trick.grip.toFixed(2) : 0, brace: f.trick.kind ? +Math.max(0, Math.min(1, (f.trick.g - 2) / 2)).toFixed(2) : 0 },
    stamina: +h.stamina.toFixed(2), skill: f.skills?.title ?? null,
    landing: { ...f.landing }, targetSpeed: +h.targetSpeed.toFixed(2), accel: +h.accel.toFixed(2),
    wing: { mode: h.pose.wing.mode, personality: h.pose.wing.personality, stride: h.pose.wing.stride, flapHz: +f.flapHz.toFixed(2) },
  }
}

const here = (h: HorseState): void => {
  const me = avatarRT()
  const a = me.facing + 0.9
  h.x = me.pos.x + Math.sin(a) * 4.2
  h.z = me.pos.z + Math.cos(a) * 4.2
  groundNow(h)
  h.y = groundHeight(h.x, h.z)
  h.heading = me.facing
  h.speed = 0
  h.targetSpeed = 0
  setMode(h, "wait", 30)
}

export const installPegasusDev = (): void => {
  registerDevTool("pegasi", () => [...horseRT.horses.values()].filter((h) => h.flight).map(flightInfo))
  registerDevTool("pegasusHere", ((name: string) => {
    const h = find(name)
    if (!h) return null
    here(h)
    return flightInfo(h)
  }) as never)
  registerDevTool("ridePegasus", ((name: string) => {
    const h = find(name)
    if (!h) return null
    here(h)
    return startMount(characterRT.active, h)
  }) as never)
  registerDevTool("takeoff", (() => {
    const h = riderRT[characterRT.active].horse as HorseState | null
    return h?.flight ? startTakeoff(h) : null
  }) as never)
  registerDevTool("flyIntent", ((intent: Partial<FlightIntent> | null) => {
    flightQA.override = intent
    return intent
  }) as never)
  registerDevTool("flight", (() => {
    const h = riderRT[characterRT.active].horse as HorseState | null
    return h?.flight ? flightInfo(h) : null
  }) as never)
  registerDevTool("cam", (() => ({
    pitch: +cameraRT.pitch.toFixed(3), targetPitch: +cameraRT.targetPitch.toFixed(3), yaw: +cameraRT.yaw.toFixed(3), targetYaw: +cameraRT.targetYaw.toFixed(3),
    look: +flightCamRT.look.toFixed(2), dir: flightCamRT.dir.toArray().map((v) => +v.toFixed(3)), fov: +cameraRT.fovBoost.toFixed(1),
    pos: flightCamRT.pos.toArray().map((v) => Math.round(v)), near: +flightCamRT.near.toFixed(2), far: Math.round(flightCamRT.far),
    mount: (() => { const h = riderRT[characterRT.active].horse; return h ? [Math.round(h.x), Math.round(h.y), Math.round(h.z)] : null })(),
    boom: +cameraRT.distance.toFixed(2), boomTarget: +cameraRT.targetDistance.toFixed(2), focus: worldRT.focus.active,
    toBody: +flightCamRT.pos.distanceTo(avatarRT().pos).toFixed(2), mounted: +cameraRT.mountedDistance.toFixed(2), flying: +cameraRT.flightDistance.toFixed(2),
  })) as never)
  registerDevTool("release", ((soft = false, hide: Partial<typeof ascentRT.qaHide> = {}) => {
    Object.assign(ascentRT.qaHide, { rings: false, flash: false, sparks: false }, hide)
    ascentRT.qa = soft
    return true
  }) as never)
  // scene bisecting: every visible drawable with its world distance from the camera; hide by uuid prefix
  registerDevTool("drawn", ((minSize = 0) => {
    const scene = spaceCatsRT.scene
    if (!scene) return null
    const out: Array<[string, string, number, number]> = []
    scene.traverseVisible((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh && !(o as THREE.Points).isPoints && !(o as THREE.Line).isLine) return
      if (!m.geometry?.boundingSphere) m.geometry?.computeBoundingSphere()
      const r = (m.geometry?.boundingSphere?.radius ?? 0) * o.getWorldScale(_s).x
      if (r < minSize) return
      out.push([o.uuid.slice(0, 6), `${o.type}:${o.name || (o.parent?.name ?? "")}`, Math.round(r), o.renderOrder])
    })
    return out
  }) as never)
  registerDevTool("hide", ((uuid: string, on = false) => {
    spaceCatsRT.scene?.traverse((o) => { if (o.uuid.startsWith(uuid)) o.visible = on })
    return uuid
  }) as never)
  registerDevTool("land", (() => requestDismount(characterRT.active)) as never)
  registerDevTool("wingPose", ((name: string, pose: (Partial<WingPose> & { fly?: number; legReach?: number }) | null) => {
    const h = find(name)
    if (!h) return null
    if (pose) flightQA.wing.set(h.ident.id, pose)
    else flightQA.wing.delete(h.ident.id)
    return pose
  }) as never)
  registerDevTool("flyTo", ((name: string, alt = 60) => {
    const h = find(name)
    if (!h?.flight) return null
    const f = h.flight
    f.mode = "air"
    f.t = 0
    f.spread = 1
    h.y = groundHeight(h.x, h.z) + alt
    h.speed = f.spec.cruise
    return flightInfo(h)
  }) as never)
  registerDevTool("shock", ((heat: number | null) => { ascentRT.qaHeat = heat; return heat }) as never)
  registerDevTool("featherFold", ((on: boolean) => { flightQA.noFeatherFold = !on; return on }) as never)
  registerDevTool("starHill", (() => ({ ...pegasusRT.starHill, starbornMet: pegasusRT.starbornMet })) as never)
  registerDevTool("lookPegasus", ((name: string, az = 120, d = 9, height = 2.5) => {
    const h = find(name)
    if (!h) return null
    const a = h.heading + (az * Math.PI) / 180
    const cam = worldRT.inspectionCamera
    cam.active = true
    cam.follow = false
    cam.px = h.x + Math.sin(a) * d
    cam.pz = h.z + Math.cos(a) * d
    cam.py = h.y + height
    cam.tx = h.x
    cam.ty = h.y + 1.3
    cam.tz = h.z
    return { x: h.x, y: h.y, z: h.z }
  }) as never)
  registerDevTool("lookAvatar", ((az = 0, d = 2.4, height = 1.5) => {
    const me = avatarRT()
    const a = me.facing + (az * Math.PI) / 180
    const cam = worldRT.inspectionCamera
    cam.active = true
    cam.follow = false
    cam.px = me.pos.x + Math.sin(a) * d
    cam.pz = me.pos.z + Math.cos(a) * d
    cam.py = me.pos.y + height
    cam.tx = me.pos.x
    cam.ty = me.pos.y + 1.25
    cam.tz = me.pos.z
    return { x: me.pos.x, z: me.pos.z, facing: me.facing, gesture: me.gesture }
  }) as never)
  registerDevTool("lookFree", (() => { worldRT.inspectionCamera.active = false; return true }) as never)
}
