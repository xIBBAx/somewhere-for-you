/// <reference types="node" />
import { readFileSync } from "node:fs"
import { withoutTextures } from "./glbHelpers"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { HumanAnimator, type HumanPoseInput } from "../src/game/characters/human/HumanAnimator"
import { expressionTargets, FACE_UNITS, FaceRig, gazeForEyes } from "../src/game/characters/faceRig"
import { measureBody, REAL_REQUIRED_BONES } from "../src/game/characters/realHuman"
import { bodyMetricsRT, setBodyMetrics, swimTuningFor } from "../src/game/characters/bodyMetrics"

type Loaded = { root: THREE.Group; bones: Map<string, THREE.Bone>; skinned: THREE.SkinnedMesh[] }

const quiet = (): void => { vi.spyOn(console, "warn").mockImplementation(() => {}) }


const load = async (who: "explorer" | "companion"): Promise<Loaded> => {
  const bytes = readFileSync(`public/assets/characters/${who}.glb`)
  const gltf = await new GLTFLoader().parseAsync(withoutTextures(bytes), "")
  const root = new THREE.Group(), bones = new Map<string, THREE.Bone>(), skinned: THREE.SkinnedMesh[] = []
  root.add(gltf.scene)
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone)
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh)
  })
  root.updateMatrixWorld(true)
  return { root, bones, skinned }
}

const pose = (over: Partial<HumanPoseInput> = {}): HumanPoseInput => ({
  dt: 1 / 60, time: 0, speed: 0, turnRate: 0, forwardAccel: 0, groundLeft: 0, groundRight: 0, slope: 0,
  airborne: false, jumpPhase: "grounded", jumpTime: 0, idleTime: 0, petting: 0, petSide: 1, celebrate: 0,
  training: { stance: 0, jab: 0, cross: 0 }, fear: 0, greeting: 0, lookYaw: 0, lookPitch: 0, wind: 0,
  sit: 0, paint: 0, wish: 0, ...over,
})

const face = () => ({ uAtlas: { value: null }, uEyes: { value: 0 }, uMouth: { value: 8 }, uBlush: { value: 0 }, uSkin: { value: new THREE.Color() } })

describe.each([
  ["explorer", 1.64, 1.7] as const,
  ["companion", 1.74, 1.8] as const,
])("realistic %s rig", (who, minTop, maxTop) => {
  let rig: Loaded
  beforeAll(async () => { quiet(); rig = await load(who) })

  it("carries every bone the animator, face rig and fabric sway need", () => {
    const missing = REAL_REQUIRED_BONES.filter((b) => !rig.bones.has(b))
    expect(missing).toEqual([])
  })

  it("stands at its design height, feet on the ground, facing +Z with its left on +X", () => {
    const m = measureBody(rig.root, rig.bones, rig.skinned)
    expect(m.top).toBeGreaterThan(minTop)
    expect(m.top).toBeLessThan(maxTop)
    const box = new THREE.Box3().setFromObject(rig.root)
    expect(Math.abs(box.min.y)).toBeLessThan(0.03)
    const world = (n: string) => new THREE.Vector3().setFromMatrixPosition(rig.bones.get(n)!.matrixWorld)
    expect(world("eyeL").z).toBeGreaterThan(world("head").z) // eyes in front of the skull
    expect(world("handL").x).toBeGreaterThan(0.1) // her/his left on +X
    expect(world("handL").y).toBeLessThan(m.waist) // arms down at rest
    // shoulders, chest and waist in human order
    expect(m.shoulder).toBeGreaterThan(m.chest)
    expect(m.chest).toBeGreaterThan(m.waist)
    expect(m.eye).toBeGreaterThan(m.shoulder)
  })

  it("has every ARKit face unit on the face with real deformation, and blinks on the lashes too", () => {
    const body = rig.skinned.find((s) => s.name === "body")!
    const dict = body.morphTargetDictionary!
    for (const unit of FACE_UNITS) {
      expect(dict[unit], unit).toBeTypeOf("number")
      const attr = body.geometry.morphAttributes.position![dict[unit]]
      let max = 0
      for (let i = 0; i < attr.count; i++) max = Math.max(max, Math.abs(attr.getX(i)), Math.abs(attr.getY(i)), Math.abs(attr.getZ(i)))
      // eyelid follow-through for gaze is subtle (~1 mm); everything else is larger
      expect(max, unit).toBeGreaterThan(0.0008)
    }
    for (const part of ["lashes", "brows"]) {
      const mesh = rig.skinned.find((s) => s.name === part)!
      expect(mesh.morphTargetDictionary?.eyeBlinkLeft, part).toBeTypeOf("number")
    }
  })

  it("is driven end to end: walking poses the legs, the face blinks, smiles and looks around", () => {
    const f = face()
    const faceRig = new FaceRig(rig.root, rig.bones)
    const animator = new HumanAnimator({ root: rig.root, bones: rig.bones, skinned: rig.skinned, face: f, faceRig })
    const thigh = rig.bones.get("thighL")!
    const rest = thigh.quaternion.clone()
    for (let i = 0; i < 90; i++) animator.update(pose({ time: i / 60, speed: 1.8 }))
    expect(thigh.quaternion.angleTo(rest)).toBeGreaterThan(0.05)
    const body = rig.skinned.find((s) => s.name === "body")!
    const blink = body.morphTargetDictionary!.eyeBlinkLeft
    const smile = body.morphTargetDictionary!.mouthSmileLeft
    f.uEyes.value = 2
    f.uMouth.value = 13
    faceRig.update(f, 0.2)
    expect(body.morphTargetInfluences![blink]).toBeGreaterThan(0.9)
    expect(body.morphTargetInfluences![smile]).toBeGreaterThan(0.6)
    const eye = rig.bones.get("eyeL")!
    const before = eye.quaternion.clone()
    f.uEyes.value = 6
    for (let i = 0; i < 20; i++) faceRig.update(f, 1 / 60)
    expect(eye.quaternion.angleTo(before)).toBeGreaterThan(0.15)
  })
})

describe.each(["explorer", "companion"] as const)("realistic %s in the water and in shared actions", (who) => {
  it("keeps the chin above the waterline while treading and swimming at its own float draft", async () => {
    quiet()
    for (const speed of [0, 1.4, 2.3]) {
      const rig = await load(who)
      const body = rig.skinned.find((s) => s.name === "body")!
      // the jaw's lowest-moving point: if the chin is dry, so is the mouth
      const jaw = body.geometry.morphAttributes.position![body.morphTargetDictionary!.jawOpen]
      let chin = 0, most = 0
      for (let i = 0; i < jaw.count; i++) {
        const d = Math.hypot(jaw.getX(i), jaw.getY(i), jaw.getZ(i))
        if (d > most) { most = d; chin = i }
      }
      const draft = swimTuningFor(measureBody(rig.root, rig.bones, rig.skinned)).floatDraft
      const animator = new HumanAnimator({ root: rig.root, bones: rig.bones, skinned: rig.skinned, face: face(), style: "real" })
      rig.root.position.y = -draft // the water surface at y = 0
      const p = new THREE.Vector3()
      const y = (n: string) => new THREE.Vector3().setFromMatrixPosition(rig.bones.get(n)!.matrixWorld).y
      let handLow = 9, handHigh = -9, shoulders = 0
      for (let f = 0; f < 240; f++) animator.update(pose({ time: f / 60, swim: 1, swimSpeed: speed }))
      for (let f = 0; f < 120; f++) {
        animator.update(pose({ time: 4 + f / 60, swim: 1, swimSpeed: speed }))
        rig.root.updateMatrixWorld(true)
        body.skeleton.update()
        p.fromBufferAttribute(body.geometry.getAttribute("position"), chin)
        body.applyBoneTransform(chin, p).applyMatrix4(body.matrixWorld)
        expect(p.y, `${who} at ${speed} m/s`).toBeGreaterThan(0.04)
        handLow = Math.min(handLow, y("handL"), y("handR"))
        handHigh = Math.max(handHigh, y("handL"), y("handR"))
        shoulders += (y("upperarmL") + y("upperarmR")) / 2 / 120
      }
      if (speed > 0) {
        // a real breaststroke: shoulders at the surface, the pull under the
        // water and the recovery skimming it, never the whole stroke in the air
        expect(Math.abs(shoulders), `${who} shoulders at ${speed} m/s`).toBeLessThan(0.06)
        expect(handLow, `${who} pull at ${speed} m/s`).toBeLessThan(-0.05)
        expect(handHigh, `${who} recovery at ${speed} m/s`).toBeLessThan(0.12)
      }
    }
  })

  it("reports heights the shared actions can use", async () => {
    const rig = await load(who)
    const m = measureBody(rig.root, rig.bones, rig.skinned)
    expect(setBodyMetrics(who, m)).toBe(true)
    const b = bodyMetricsRT[who]
    // hand-holding height sits between the two bodies' hands; a high five above both shoulders
    expect(b.hand).toBeGreaterThan(0.6)
    expect(b.hand).toBeLessThan(b.waist)
    expect(b.top - b.eye).toBeGreaterThan(0.08)
    expect(b.top - b.eye).toBeLessThan(0.2)
  })
})

describe("body metrics", () => {
  it("ignores an implausible rig and keeps the last good heights", () => {
    const before = { ...bodyMetricsRT.explorer }
    expect(setBodyMetrics("explorer", { top: 0, eye: 0, shoulder: 0, chest: 0, waist: 0, hand: 0 })).toBe(false)
    expect(setBodyMetrics("explorer", { top: 1.2, eye: 1.1, shoulder: 1.3, chest: 1.0, waist: 0.8, hand: 0.6 })).toBe(false)
    expect(bodyMetricsRT.explorer).toEqual(before)
  })
  it("gives rigs without eye bones a sensible eye line", () => {
    const before = { ...bodyMetricsRT.companion }
    setBodyMetrics("companion", { top: 1.62, eye: 0, shoulder: 1.12, chest: 1.06, waist: 0.87, hand: 0.67 })
    expect(bodyMetricsRT.companion.eye).toBeCloseTo(1.51, 2)
    setBodyMetrics("companion", before)
  })
  it("floats a realistic body with its chest at the waterline", () => {
    const t = swimTuningFor(bodyMetricsRT.companion)
    expect(t.floatDraft).toBeCloseTo(bodyMetricsRT.companion.chest, 5)
    expect(t.swimEnter).toBeGreaterThan(t.floatDraft)
    expect(t.swimExit).toBeLessThan(t.floatDraft)
  })
})

describe("expression mapping", () => {
  it("maps every animator cell to bounded weights", () => {
    for (let eyes = 0; eyes <= 7; eyes++) for (let mouth = 8; mouth <= 14; mouth++) {
      const w = expressionTargets(eyes, mouth)
      for (const [k, v] of Object.entries(w)) {
        expect(FACE_UNITS).toContain(k)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })
  it("keeps the meaning of the cells", () => {
    expect(expressionTargets(2, 12).eyeBlinkLeft).toBe(1)
    expect(expressionTargets(0, 12).eyeBlinkLeft).toBeUndefined()
    expect(expressionTargets(3, 9).mouthSmileRight).toBeGreaterThan(0.7)
    expect(expressionTargets(5, 10).eyeWideLeft).toBeGreaterThan(0.5)
    expect(expressionTargets(0, 14).mouthPucker).toBeGreaterThan(0.5)
    // looking to her left: left eye out, right eye in, and the eyeballs turn left
    const left = expressionTargets(6, 8)
    expect(left.eyeLookOutLeft).toBeGreaterThan(0)
    expect(left.eyeLookInRight).toBeGreaterThan(0)
    expect(gazeForEyes(6)).toBeGreaterThan(0)
    expect(gazeForEyes(7)).toBeLessThan(0)
  })
  it("reuses its output object without leaking old weights", () => {
    const out = expressionTargets(2, 13)
    expressionTargets(0, 12, out)
    expect(Object.keys(out)).toEqual([])
  })
})
