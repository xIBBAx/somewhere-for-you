import { dashFxRT } from "./DashFX"
import { travelFovBoost } from "../celestial/WarpCorridor"
import { travelRT } from "../celestial/cosmicTravel"
import * as THREE from "three"
import { cameraAutoAllowed, cameraRT } from "../runtime"
import { spaceRT } from "../celestial/spaceState"
import { observationView } from "../celestial/observations"
import { bodyById } from "../celestial/universe"
import { localAxes, localToUniverse } from "../celestial/frames"
import { EARTH_R } from "../celestial/scale"
import type { MountBody } from "../mounts/mount"
import type { HorseState } from "../horses/horseState"

/**
 * The camera on the wing.
 *
 * Comfort first: the view never rolls more than a fifth of the Pegasus's bank
 * (and not at all when the system asks for reduced motion), there is no shake
 * or wingbeat bob, and every change is eased. The boom pulls back to frame the
 * whole wingspan and rises a little; after a moment without a manual look it
 * swings in behind and tilts down over the wings, lower in a climb and higher
 * in a dive, so the horizon and where you are going stay in view. The field
 * of view opens with speed (the strongest cue to it). The far plane grows with
 * altitude so the land below stays drawn, and the near plane with it so depth
 * precision holds.
 */

const reduced = typeof window !== "undefined" && typeof window.matchMedia === "function"
  ? window.matchMedia("(prefers-reduced-motion: reduce)")
  : null

export const flightReducedMotion = (): boolean => reduced?.matches ?? false

export const flightCamRT = {
  /** 0 on the ground … 1 flying (eased) */
  w: 0,
  /** height of the flying mount over the surface below (m) */
  alt: 0,
  /** 0..1 how far the view has turned to look back down at Earth on the climb out */
  look: 0,
  /** QA: where the view looks (world direction), as of the last frame */
  dir: new THREE.Vector3(),
  pos: new THREE.Vector3(),
  near: 0,
  far: 0,
  /** the boom's eased length before a journey's launch kick is added */
  base: 0,
  /** a Pegasus launch (flight.ts, Shift with Space) as the camera takes it: eased 0..1, and its onset kick */
  launch: 0,
  launchKick: 0,
  beat: 0,
  /** Starborn's overdrive (flight.ts) as the camera takes it: eased 0..1, and its onset (the view left behind, then reeled in) */
  od: 0,
  odKick: 0,
}

/** The look back down at Earth comes in between these heights over the datum (~65 and ~180 km). */
const observationPosition = new THREE.Vector3(), observationDirection = new THREE.Vector3()
const observationAxes = new THREE.Quaternion()
const SAIL_LOOK_FROM = 1020
const SAIL_LOOK_TO = 2800

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)
const damp = (a: number, b: number, k: number, dt: number): number => a + (b - a) * (1 - Math.exp(-k * dt))
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

export const flightCamera = (camera: THREE.PerspectiveCamera, h: MountBody | null, dt: number): void => {
  const hs = h?.kind === "horse" ? h as HorseState : null
  const f = hs?.flight ?? null
  const flying = !!f && f.mode !== "ground"
  const runout = !flying ? f?.landing.settle ?? 0 : 0
  flightCamRT.w = damp(flightCamRT.w, flying ? 1 : runout * 0.6, flying ? 1.6 : 0.9, dt)
  flightCamRT.alt = flying ? f!.alt : damp(flightCamRT.alt, 0, 2, dt)
  camera.getWorldDirection(flightCamRT.dir)
  flightCamRT.pos.copy(camera.position)
  flightCamRT.near = camera.near
  flightCamRT.far = camera.far
  const semi = hs?.model?.meta.wing?.semi ?? 3.2
  // a Pegasus on the ground: a little further back for the folded wings
  const wantD = flying ? semi * 1.35 + 1.5 : f ? 1.2 + runout * semi * 0.8 : 0
  flightCamRT.base = damp(flightCamRT.base, wantD, 1.1, dt)
  // a journey's launch: she surges away and the view is left behind for a
  // breath, then catches her (none under reduced motion)
  const kick = flightReducedMotion() ? 0 : travelRT.launch * 6
  // a launch (flight.ts): she tears away up the frame and the view is left a
  // beat behind, then reels in, a little further back to take in the climb
  const launch = flying && f!.mode === "air" ? f!.launch : 0
  const rising = launch > flightCamRT.launch + 1e-4
  flightCamRT.launch = damp(flightCamRT.launch, launch, rising ? 5 : 1.6, dt)
  const onset = f && f.launchT > 0 && f.launchT < 0.9 ? Math.sin(Math.PI * Math.min(1, f.launchT / 0.9)) : 0
  flightCamRT.launchKick = damp(flightCamRT.launchKick, flightReducedMotion() ? 0 : onset, 6, dt)
  // each power stroke of a launch pulls her a little further up the frame
  flightCamRT.beat = damp(flightCamRT.beat, flightReducedMotion() ? 0 : (f?.strokeSurge ?? 0) * flightCamRT.launch, 8, dt)
  // her overdrive: the shove leaves the view behind for a breath, then it closes in
  // tight and low behind her, the world pouring past a wide lens
  const od = flying ? f!.overdrive : 0
  flightCamRT.od = damp(flightCamRT.od, od, od > flightCamRT.od ? 2.4 : 1.2, dt)
  const odOnset = f && f.odT > 0 && f.odT < 1.1 ? Math.sin(Math.PI * Math.min(1, f.odT / 1.1)) : 0
  flightCamRT.odKick = damp(flightCamRT.odKick, flightReducedMotion() ? 0 : odOnset, 5, dt)
  // (held close enough that the explorer and her wings stay the subject: the climb is told by the angle and the sky, not by distance)
  cameraRT.flightDistance = flightCamRT.base + kick + flightCamRT.launch * 1.2 + flightCamRT.launchKick * 2.4 + flightCamRT.beat * 0.7 + flightCamRT.odKick * 2.4 - flightCamRT.od * 0.9 * (1 - flightCamRT.launch)
  cameraRT.flightLift = damp(cameraRT.flightLift, flying ? 0.9 : runout * 0.5, 1.1, dt)
  if (flying && hs && f) {
    const s = f.spec
    const fast = clamp((hs.speed - s.minSpeed) / (s.boost - s.minSpeed), 0, 1)
    // the field of view opens with speed and with Starborn's star corridor; a
    // dash's onset adds a short kick that eases straight out (DashFX)
    const comfort = flightReducedMotion()
    cameraRT.fovBoost = damp(cameraRT.fovBoost, comfort ? 2 + flightCamRT.od * 4 : 2 + fast * 10 + travelFovBoost() + travelRT.launch * 7 + flightCamRT.launch * 5 + flightCamRT.launchKick * 4 + flightCamRT.od * 9 + flightCamRT.odKick * 5, flightCamRT.launch > 0.1 || flightCamRT.odKick > 0.05 ? 3 : 1.4, dt)
    if (!comfort) cameraRT.fovBoost += dashFxRT.punch * (dashFxRT.kind === "starfall" ? 30 : 22) * dt
    cameraRT.speedBob = 0
    // (carving in the overdrive the horizon leans with her a little more)
    const roll = reduced?.matches ? 0 : clamp(-f.roll * (0.2 + 0.1 * flightCamRT.od), -0.12 - 0.06 * flightCamRT.od, 0.12 + 0.06 * flightCamRT.od)
    cameraRT.speedRoll = damp(cameraRT.speedRoll, roll, 2.2, dt)
    if (cameraAutoAllowed(1400) && travelRT.phase !== "idle" && travelRT.phase !== "reentry") {
      // A journey is directed, gently, until the explorer looks herself: from her
      // side as she rears and gathers the light; behind her on the run, drifting
      // slowly so the blazing sky ahead and her wings share the frame; swinging
      // out to her side on the arrival so the world she came for opens up
      // beside her rather than hidden behind her body.
      const ph = travelRT.phase
      const off = ph === "gather" ? 0.8 * smooth(0, 0.6, travelRT.u)
        : ph === "corridor" ? 0.8 * (1 - smooth(0, 0.25, travelRT.u)) + 0.28 * Math.sin(travelRT.t * 0.33) * smooth(0.1, 0.35, travelRT.u)
          : 0.6 * smooth(0, 0.5, travelRT.u)
      const want = hs.heading + Math.PI + off
      const d = Math.atan2(Math.sin(want - cameraRT.targetYaw), Math.cos(want - cameraRT.targetYaw))
      cameraRT.targetYaw += d * (1 - Math.exp(-dt * 1.6))
      const pitchT = ph === "gather" ? 0.04 : ph === "corridor" ? 0.12 + 0.04 * Math.sin(travelRT.t * 0.21) : 0.1
      cameraRT.targetPitch = damp(cameraRT.targetPitch, pitchT, 1.4, dt)
    } else if (cameraAutoAllowed(700)) {
      // in a launch the view swings a little off her tail, so the line of her body,
      // nose to the sky, shows against it rather than foreshortened from straight behind
      const behind = hs.heading + Math.PI + 0.85 * flightCamRT.launch * (flightReducedMotion() ? 0 : 1)
      const d = Math.atan2(Math.sin(behind - cameraRT.targetYaw), Math.cos(behind - cameraRT.targetYaw))
      // A corkscrew or pirouette turns her a whole circle and back to her
      // course: the view holds still and lets her spin inside the frame,
      // rather than chasing each turn and swinging the world round the explorer.
      // After a dive flip (she comes out the other way) it comes round a
      // little quicker, so the long whip is shorter.
      const spinning = f.trick.kind === "corkscrew" || f.trick.kind === "pirouette"
      // close behind her through quick turns, so a sharp correction never fights the view
      const rate = spinning ? 0 : Math.abs(d) > 1.6 ? 3.6 : 3.0
      cameraRT.targetYaw += d * (1 - Math.exp(-dt * rate))
      // in a trick the body may be past the vertical: the view follows the sine of its
      // pitch (continuous through a loop, never upside down), and stays a little above the horizon
      let pitchT = f.trick.kind !== null
        ? clamp(0.28 - 0.22 * Math.sin(f.pitch), 0.08, 0.5)
        : clamp(0.24 - f.pitch * 0.45 + (f.mode === "landing" ? 0.12 : 0), 0.02, 0.6)
      // a hard climb is seen from below and behind, looking up along it: the
      // nose up, the wings driving, the sky she is climbing into (well clear
      // of the ground only)
      if (f.trick.kind === null && f.mode === "air" && f.pitch > 0.3) {
        const up = smooth(0.3, 0.85, f.pitch) * smooth(12, 30, f.alt)
        pitchT += (-0.26 - pitchT) * up
      }
      // a launch is seen from well below, looking up the climb as she tears
      // away into the sky (near the ground, only as low as leaves the land in view)
      if (f.trick.kind === null && flightCamRT.launch > 0.01) {
        const low = 0.3 + 0.7 * smooth(6, 26, f.alt)
        // (from below and to her side, not under her belly: the riders on her back stay in the frame)
        pitchT += (-0.42 * low - pitchT) * flightCamRT.launch * smooth(0.25, 0.8, f.pitch)
      }
      // A star fills much more of the forward view than a distant horizon.
      // Raise the sight line gently so its limb fits above Starborn's wings.
      if (f.mode === "sail" && spaceRT.mode === "deep" && spaceRT.nearest?.def.kind === "star") {
        pitchT = clamp(0.08 - f.pitch * 0.45, -0.12, 0.35)
      }
      // climbing away from Earth on the sails: look back down over her, so the
      // world she leaves (the clouds, the curve, then the whole blue ball) stays
      // in view, as the opening film looks down on the way in
      const leaving = f.mode === "sail" && spaceRT.realm === "earth" && f.pitch > 0.15
      flightCamRT.look = damp(flightCamRT.look, leaving ? smooth(SAIL_LOOK_FROM, SAIL_LOOK_TO, spaceRT.earthAltitude) : 0, 0.8, dt)
      // framed on the horizon, not the ground: the curve of the limb a little
      // above the middle, black sky and stars over it (Earth's horizon dips
      // arccos(R / (R + h)) below level: 10° at 100 km, 20° at 400 km)
      const h = Math.max(0, spaceRT.earthAltitude)
      const dip = Math.acos(EARTH_R / (EARTH_R + h))
      pitchT += (clamp(dip + 0.2, 0.3, 0.75) - pitchT) * flightCamRT.look
      // At a guided viewpoint, frame the actual world rather than the
      // tangent we arrived along. Manual looking retains its normal priority.
      const observed = observationView.body ? bodyById(observationView.body) : null
      if (observed) {
        if (spaceRT.mode === "deep") { observationPosition.copy(spaceRT.pos); observationAxes.copy(spaceRT.park).invert() }
        else { localToUniverse(spaceRT.frame, hs.x, hs.y, hs.z, observationPosition); localAxes(spaceRT.frame, hs.x, hs.z, observationAxes).invert() }
        observationDirection.copy(observed.pos).sub(observationPosition).applyQuaternion(observationAxes)
        const horizontal = Math.hypot(observationDirection.x, observationDirection.z)
        if (horizontal > observationDirection.length() * 1e-7) {
          const yaw = Math.atan2(-observationDirection.x, -observationDirection.z)
          const delta = Math.atan2(Math.sin(yaw - cameraRT.targetYaw), Math.cos(yaw - cameraRT.targetYaw))
          cameraRT.targetYaw += delta * (1 - Math.exp(-dt * 1.4))
        }
        pitchT = clamp(Math.atan2(-observationDirection.y, horizontal), -0.3, 1.38)
      }
      cameraRT.targetPitch = damp(cameraRT.targetPitch, pitchT, 1.2 + 2.4 * flightCamRT.launch, dt)
    }
  }
  // far and near planes follow the height over the ground; from high in the
  // sky they reach past the horizon (the curved lands, HorizonLands), while
  // the near plane stays inside the riders' few metres
  const alt = flightCamRT.alt
  const high = Math.max(0, spaceRT.realm === "earth" && spaceRT.mode === "local" ? spaceRT.earthAltitude : 0)
  const horizon = Math.sqrt(high * (2 * EARTH_R + high))
  const far = Math.max(520 + smooth(8, 420, alt) * 2400, Math.min(130_000, horizon * 1.3 + 2500))
  const near = Math.min(2, 0.3 + smooth(25, 420, alt) * 0.9 + smooth(600, 4000, high) * 0.8)
  if (Math.abs(camera.far - far) > far * 0.015 || Math.abs(camera.near - near) > 0.02) {
    camera.far = far
    camera.near = near
    camera.updateProjectionMatrix()
  }
}
