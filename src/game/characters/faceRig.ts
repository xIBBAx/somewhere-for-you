import * as THREE from "three"
import type { FaceUniforms } from "./human/humanAsset"

/**
 * Face adapter for the realistic (MPFB) characters.
 *
 * HumanAnimator speaks in the stylised rig's atlas codes: an eye cell
 * (0 open, 1 half, 2 closed, 3 happy ^ ^, 4 hearts, 5 wide, 6 look left,
 * 7 look right), a mouth cell (8 smile, 9 laugh, 10 "o", 11 soft, 12 rest,
 * 13 grin, 14 pout) and a 0..1 blush. Painting those cells over a real face
 * would look wrong, so this adapter turns the same codes into ARKit face-unit
 * morph weights, eye-bone gaze and a cheek flush. Every channel is damped, so
 * expressions blend the way faces do instead of snapping between cells.
 */

export type MorphWeights = Partial<Record<FaceUnit, number>>
export type FaceUnit =
  | "eyeBlinkLeft" | "eyeBlinkRight" | "eyeSquintLeft" | "eyeSquintRight" | "eyeWideLeft" | "eyeWideRight"
  | "eyeLookInLeft" | "eyeLookInRight" | "eyeLookOutLeft" | "eyeLookOutRight" | "eyeLookUpLeft" | "eyeLookUpRight"
  | "eyeLookDownLeft" | "eyeLookDownRight" | "jawOpen" | "mouthClose" | "mouthSmileLeft" | "mouthSmileRight"
  | "mouthFrownLeft" | "mouthFrownRight" | "mouthFunnel" | "mouthPucker" | "browInnerUp" | "browDownLeft"
  | "browDownRight" | "browOuterUpLeft" | "browOuterUpRight" | "cheekSquintLeft" | "cheekSquintRight"

export const FACE_UNITS: readonly FaceUnit[] = [
  "eyeBlinkLeft", "eyeBlinkRight", "eyeSquintLeft", "eyeSquintRight", "eyeWideLeft", "eyeWideRight",
  "eyeLookInLeft", "eyeLookInRight", "eyeLookOutLeft", "eyeLookOutRight", "eyeLookUpLeft", "eyeLookUpRight",
  "eyeLookDownLeft", "eyeLookDownRight", "jawOpen", "mouthClose", "mouthSmileLeft", "mouthSmileRight",
  "mouthFrownLeft", "mouthFrownRight", "mouthFunnel", "mouthPucker", "browInnerUp", "browDownLeft",
  "browDownRight", "browOuterUpLeft", "browOuterUpRight", "cheekSquintLeft", "cheekSquintRight",
]

const both = (left: FaceUnit, right: FaceUnit, v: number, out: MorphWeights): void => {
  out[left] = (out[left] ?? 0) + v
  out[right] = (out[right] ?? 0) + v
}

/** Gaze for the look-left/right cells, in radians of eye yaw (+ = her left). */
export const gazeForEyes = (eyes: number): number => (eyes === 6 ? 0.32 : eyes === 7 ? -0.32 : 0)

/** Target morph weights for an animator expression (pure; unit-tested). */
export const expressionTargets = (eyes: number, mouth: number, out: MorphWeights = {}): MorphWeights => {
  for (const k of FACE_UNITS) delete out[k]
  switch (eyes) {
    case 1: both("eyeBlinkLeft", "eyeBlinkRight", 0.55, out); break
    case 2: both("eyeBlinkLeft", "eyeBlinkRight", 1, out); break
    case 3: // happy: smiling eyes, lower lids up, a soft squeeze
      both("eyeBlinkLeft", "eyeBlinkRight", 0.42, out)
      both("eyeSquintLeft", "eyeSquintRight", 0.85, out)
      both("cheekSquintLeft", "cheekSquintRight", 0.65, out)
      break
    case 4: // adoring: warm squint with lifted brows
      both("eyeBlinkLeft", "eyeBlinkRight", 0.25, out)
      both("eyeSquintLeft", "eyeSquintRight", 0.6, out)
      both("cheekSquintLeft", "cheekSquintRight", 0.55, out)
      out.browInnerUp = 0.45
      break
    case 5: // wide, a little startled
      both("eyeWideLeft", "eyeWideRight", 0.75, out)
      out.browInnerUp = 0.55
      both("browOuterUpLeft", "browOuterUpRight", 0.4, out)
      break
    case 6: // looking to her left: the left eye turns out, the right eye in
      out.eyeLookOutLeft = 0.6
      out.eyeLookInRight = 0.6
      break
    case 7:
      out.eyeLookOutRight = 0.6
      out.eyeLookInLeft = 0.6
      break
  }
  switch (mouth) {
    case 8: // the resting look: a closed, gentle smile that reaches the cheeks and, just, the eyes
      both("mouthSmileLeft", "mouthSmileRight", 0.48, out)
      both("cheekSquintLeft", "cheekSquintRight", 0.2, out)
      both("eyeSquintLeft", "eyeSquintRight", 0.14, out)
      break
    case 9: // laugh
      both("mouthSmileLeft", "mouthSmileRight", 0.85, out)
      out.jawOpen = 0.24
      both("cheekSquintLeft", "cheekSquintRight", 0.3, out)
      break
    case 10: out.mouthFunnel = 0.55; out.jawOpen = 0.17; break
    case 11: both("mouthSmileLeft", "mouthSmileRight", 0.2, out); break
    case 13: // grin
      both("mouthSmileLeft", "mouthSmileRight", 1, out)
      out.jawOpen = 0.07
      both("cheekSquintLeft", "cheekSquintRight", 0.45, out)
      break
    case 14:
      out.mouthPucker = 0.7
      both("mouthFrownLeft", "mouthFrownRight", 0.18, out)
      out.browInnerUp = Math.max(out.browInnerUp ?? 0, 0.25)
      break
  }
  for (const k of FACE_UNITS) if (out[k] !== undefined) out[k] = Math.min(1, out[k]!)
  return out
}

type MorphSlot = { mesh: THREE.Mesh; index: number }
type EyeRig = { bone: THREE.Bone; restQ: THREE.Quaternion; parentQ: THREE.Quaternion; parentQInv: THREE.Quaternion }

const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _m = new THREE.Matrix4()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()

/** Per-channel response (s to ~95%): blinks are quick, smiles bloom slowly. */
const RATE: Partial<Record<FaceUnit, number>> = {
  // the two lids never move as one: the right trails the left by a hair
  eyeBlinkLeft: 32, eyeBlinkRight: 26, jawOpen: 14, mouthFunnel: 12, mouthPucker: 10,
}


export class FaceRig {
  private slots = new Map<FaceUnit, MorphSlot[]>()
  private value = new Map<FaceUnit, number>()
  private target: MorphWeights = {}
  private eyes: EyeRig[] = []
  private gazeYaw = 0
  private gazePitch = 0
  private saccadeYaw = 0
  private saccadePitch = 0
  private saccadeTimer = 1.2
  private seed = 1
  private clock = 0
  /** a blink that comes with a large shift of gaze (s left) */
  private gazeBlink = 0
  private readonly live: MorphWeights = {}
  /** 0..1 cheek flush the skin material reads */
  readonly blush = { value: 0 }

  constructor(root: THREE.Object3D, bones: Map<string, THREE.Bone>) {
    root.updateMatrixWorld(true)
    root.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh || !mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return
      for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) {
        const unit = name as FaceUnit
        if (!FACE_UNITS.includes(unit)) continue
        const list = this.slots.get(unit) ?? []
        list.push({ mesh, index })
        this.slots.set(unit, list)
      }
    })
    const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert()
    for (const name of ["eyeL", "eyeR"]) {
      const bone = bones.get(name)
      if (!bone) continue
      const parentQ = new THREE.Quaternion()
      _m.multiplyMatrices(rootInv, bone.parent ? bone.parent.matrixWorld : new THREE.Matrix4()).decompose(_p, parentQ, _s)
      this.eyes.push({ bone, restQ: bone.quaternion.clone(), parentQ, parentQInv: parentQ.clone().invert() })
    }
  }

  /** Units this face can actually show (for QA). */
  get units(): FaceUnit[] {
    return [...this.slots.keys()]
  }

  /**
   * Called once per frame after HumanAnimator has posed the skeleton (its
   * apply() resets every bone, eyes included, to the posed/rest state).
   * `headYaw` is the head's turn relative to the body; the eyes lead it.
   */
  update(face: FaceUniforms, dt: number, headYaw = 0, headPitch = 0): void {
    if (!(dt > 0)) return
    const eyes = Math.round(face.uEyes.value)
    const mouth = Math.round(face.uMouth.value)
    expressionTargets(eyes, mouth, this.target)
    this.clock += dt
    this.liveliness(dt)
    for (const unit of FACE_UNITS) {
      const want = Math.min(1, (this.target[unit] ?? 0) + (this.live[unit] ?? 0))
      const rate = RATE[unit] ?? 7
      const now = this.value.get(unit) ?? 0
      const next = now + (want - now) * (1 - Math.exp(-rate * dt))
      this.value.set(unit, next)
      const slots = this.slots.get(unit)
      if (slots) for (const s of slots) s.mesh.morphTargetInfluences![s.index] = next
    }
    this.blush.value += (face.uBlush.value - this.blush.value) * (1 - Math.exp(-3 * dt))

    // Gaze: the eyes lead a head turn, then settle; small saccades keep a
    // resting face alive. Lids follow through the eyeLook morphs above.
    this.saccadeTimer -= dt
    if (this.saccadeTimer <= 0) {
      this.seed = (this.seed * 16807) % 2147483647
      const r1 = this.seed / 2147483647
      this.seed = (this.seed * 16807) % 2147483647
      const r2 = this.seed / 2147483647
      this.saccadeTimer = 0.7 + r1 * 2.4
      const yaw = (r1 - 0.5) * 0.12
      // a bigger shift of gaze often carries a blink with it, as real ones do
      if (Math.abs(yaw - this.saccadeYaw) > 0.07 && r2 > 0.45 && eyes === 0) this.gazeBlink = 0.13
      this.saccadeYaw = yaw
      this.saccadePitch = (r2 - 0.5) * 0.06
    }
    const yaw = THREE.MathUtils.clamp(gazeForEyes(eyes) + headYaw * 0.35 + this.saccadeYaw, -0.45, 0.45)
    const pitch = THREE.MathUtils.clamp(headPitch * 0.3 + this.saccadePitch, -0.3, 0.3)
    this.gazeYaw += (yaw - this.gazeYaw) * (1 - Math.exp(-18 * dt))
    this.gazePitch += (pitch - this.gazePitch) * (1 - Math.exp(-18 * dt))
    // the lids and lid folds follow where the eyes point (next frame's targets)
    const lidYaw = THREE.MathUtils.clamp(this.gazeYaw / 0.45, -1, 1) * 0.35
    const lidPitch = THREE.MathUtils.clamp(this.gazePitch / 0.3, -1, 1) * 0.4
    const live = this.live
    live.eyeLookOutLeft = Math.max(0, lidYaw); live.eyeLookInRight = Math.max(0, lidYaw)
    live.eyeLookOutRight = Math.max(0, -lidYaw); live.eyeLookInLeft = Math.max(0, -lidYaw)
    live.eyeLookUpLeft = live.eyeLookUpRight = Math.max(0, -lidPitch)
    live.eyeLookDownLeft = live.eyeLookDownRight = Math.max(0, lidPitch)
    _e.set(this.gazePitch, this.gazeYaw, 0, "YXZ")
    _q.setFromEuler(_e)
    for (const eye of this.eyes) {
      // model-space delta → local, as HumanAnimator.apply() does
      eye.bone.quaternion.copy(eye.parentQInv).multiply(_q).multiply(eye.parentQ).multiply(eye.restQ)
    }
  }

  /**
   * Small continuous life on top of the expression cells: a slow drift in
   * the smile and brows (two incommensurate rates, so it never loops
   * visibly) and the gaze-evoked blink. Kept to a few percent of each unit,
   * so every cell still reads as itself.
   */
  private liveliness(dt: number): void {
    const t = this.clock
    const live = this.live
    const drift = Math.sin(t * 0.37 + 1.3) * 0.6 + Math.sin(t * 0.83) * 0.4
    const smiling = (this.target.mouthSmileLeft ?? 0) > 0.3
    live.mouthSmileLeft = smiling ? 0.05 * drift + 0.012 * Math.sin(t * 1.9) : 0
    live.mouthSmileRight = smiling ? 0.05 * drift - 0.012 * Math.sin(t * 1.9) : 0
    live.browInnerUp = 0.035 * Math.max(0, Math.sin(t * 0.29 + 0.4))
    live.browOuterUpLeft = live.browOuterUpRight = smiling ? 0.03 * Math.max(0, drift) : 0
    this.gazeBlink = Math.max(0, this.gazeBlink - dt)
    const g = this.gazeBlink > 0 ? Math.sin(Math.PI * (1 - this.gazeBlink / 0.13)) * 0.85 : 0
    live.eyeBlinkLeft = live.eyeBlinkRight = g
  }
}
