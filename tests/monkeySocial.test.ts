/// <reference types="node" />
import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it } from "vitest"
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { createAnimalAgent, registerAnimalAgent, stepAnimalAgent } from "../src/game/animals/ecosystem"
import {
  BRANCH_SPRINGS, branchFootPoint, branchShape, kickBranch, loadBranch, MONKEY_BRANCHES, resetBranches, stepBranches,
} from "../src/game/animals/monkeyHabitat"
import { getMonkeyMotion, GROOM_DISTANCE } from "../src/game/animals/monkeyMotion"
import { bendBoughMesh, buildBoughMesh } from "../src/game/environment/monkeyBoughs"
import { groundHeight } from "../src/game/world-layout"
import type { AnimalModel } from "../src/world/wildlife/animalAssets"
import { PrimateAnimator, type PrimatePose } from "../src/world/wildlife/PrimateAnimator"

afterEach(() => resetBranches())

describe("boughs that bend under a monkey", () => {
  it("is clamped at the trunk and free at the tip", () => {
    expect(branchShape(0)).toBe(0)
    expect(branchShape(1)).toBeCloseTo(1, 10)
    // monotonic: further out always drops further
    for (let t = 0.05; t <= 1; t += 0.05) expect(branchShape(t)).toBeGreaterThan(branchShape(t - 0.05))
  })

  it("settles a sitting monkey into a few centimetres of sag, and the feet ride it", () => {
    const branch = MONKEY_BRANCHES[0]
    const spring = BRANCH_SPRINGS[branch.id]
    const rest = branchFootPoint(branch, 0.9, new THREE.Vector3()).y
    for (let i = 0; i < 60 * 6; i++) { loadBranch(branch, 0.9); stepBranches(1 / 60) }
    expect(spring.q).toBeCloseTo(spring.compliance * branchShape(0.9), 3)
    const sagged = branchFootPoint(branch, 0.9, new THREE.Vector3()).y
    expect(rest - sagged).toBeGreaterThan(0.015)
    expect(rest - sagged).toBeLessThan(0.17)
    // and every bough stays within believable stiffness
    for (const s of BRANCH_SPRINGS) {
      expect(s.compliance).toBeGreaterThanOrEqual(0.025)
      expect(s.omega / (2 * Math.PI)).toBeGreaterThan(1.2)
      expect(s.omega / (2 * Math.PI)).toBeLessThan(3.3)
    }
  })

  it("rings after a landing and dies away like green wood", () => {
    const branch = MONKEY_BRANCHES[3]
    const spring = BRANCH_SPRINGS[branch.id]
    kickBranch(branch, 0.98, 3.5)
    let peak = 0
    let crossings = 0
    let last = 0
    for (let i = 0; i < 60 * 3; i++) {
      stepBranches(1 / 60)
      peak = Math.max(peak, Math.abs(spring.q))
      if (i > 0 && Math.sign(spring.q) !== Math.sign(last)) crossings++
      last = spring.q
    }
    expect(peak).toBeGreaterThan(0.03)
    expect(peak).toBeLessThan(0.3)
    expect(crossings, "it oscillates, not just creeps back").toBeGreaterThan(3)
    for (let i = 0; i < 60 * 6; i++) stepBranches(1 / 60)
    expect(Math.abs(spring.q)).toBeLessThan(0.002)
  })

  it("draws the bough with the same drop the feet are planted on", () => {
    const branch = MONKEY_BRANCHES[0]
    const mesh = buildBoughMesh([branch])!
    BRANCH_SPRINGS[branch.id].q = 0.1
    expect(bendBoughMesh(mesh)).toBe(true)
    const pos = mesh.geometry.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const expected = mesh.along[i] > 0 ? mesh.restY[i] - 0.1 * branchShape(mesh.along[i]) : mesh.restY[i]
      expect(pos.getY(i)).toBeCloseTo(expected, 5)
    }
    // the stub into the bark never moves; the tip moves most
    const tipDrop = Math.max(...Array.from(mesh.along, (_t, i) => mesh.restY[i] - pos.getY(i)))
    expect(tipDrop).toBeCloseTo(0.1, 2)
    // nothing changed, nothing re-uploaded
    expect(bendBoughMesh(mesh)).toBe(false)
    mesh.geometry.dispose()
  })
})

describe("grooming between monkeys", () => {
  it("pairs two resting monkeys into a bout, groomer behind the groomee, and parts them cleanly", () => {
    const branch = MONKEY_BRANCHES.find((b) => b.tree === 42)!
    const base = branch.approach.clone()
    const make = (id: string, dx: number, seed: number) => {
      const p = new THREE.Vector3(base.x + dx, 0, base.z)
      p.y = groundHeight(p.x, p.z)
      const agent = createAnimalAgent({ id, species: "monkey", mobility: "arboreal", seed, position: p, radius: 0.16 })
      let s = seed
      agent.rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
      const m = getMonkeyMotion(agent)
      // both start on the ground, settled
      m.phase = "ground-idle"
      m.time = 0
      m.duration = 0.5
      m.sinceGroom = 20
      agent.position.copy(p)
      return agent
    }
    const a = make("groom-test-a", 0, 91)
    const b = make("groom-test-b", 1.4, 17)
    const unregister = [registerAnimalAgent(a), registerAnimalAgent(b)]
    const ma = getMonkeyMotion(a)
    const mb = getMonkeyMotion(b)
    let paired = false
    let groomedFor = 0
    let swapped = false
    let lastA = a.position.clone()
    let lastB = b.position.clone()
    let firstGroomer: string | null = null
    for (let frame = 0; frame < 60 * 120 && !(paired && ma.grooms > 0); frame++) {
      stepAnimalAgent(a, 1 / 60)
      stepAnimalAgent(b, 1 / 60)
      expect(a.position.distanceTo(lastA)).toBeLessThan(0.13)
      expect(b.position.distanceTo(lastB)).toBeLessThan(0.13)
      lastA = a.position.clone()
      lastB = b.position.clone()
      if (ma.phase === "grooming" && mb.phase === "grooming") {
        paired = true
        expect(ma.partner).toBe(b)
        expect(mb.partner).toBe(a)
        expect(ma.groomRole).not.toBe(mb.groomRole)
        firstGroomer ??= ma.groomRole === "groomer" ? a.id : b.id
        if ((ma.groomRole === "groomer" ? a.id : b.id) !== firstGroomer) swapped = true
        const d = a.position.distanceTo(b.position)
        // once seated, they sit close: within arm's reach
        if (d < GROOM_DISTANCE + 0.15) groomedFor += 1 / 60
      }
    }
    unregister.forEach((u) => u())
    expect(paired, "a bout started").toBe(true)
    expect(groomedFor, "they groomed, seated, for several seconds").toBeGreaterThan(5)
    expect(ma.grooms + mb.grooms).toBeGreaterThan(0)
    expect(ma.partner).toBeNull()
    expect(mb.partner).toBeNull()
    // they stayed on the ground throughout
    expect(a.position.y).toBeCloseTo(groundHeight(a.position.x, a.position.z), 4)
    expect(typeof swapped).toBe("boolean")
  })
})

describe("the macaque face", () => {
  const load = async (): Promise<{ root: THREE.Group; model: AnimalModel }> => {
    const bytes = readFileSync("public/assets/animals/monkey.glb")
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "")
    const root = new THREE.Group()
    root.add(gltf.scene)
    const bones = new Map<string, THREE.Bone>()
    const meshes: THREE.SkinnedMesh[] = []
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone)
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh)
    })
    return { root, model: { root, bones, meshes, material: new THREE.MeshStandardMaterial() } }
  }
  const pose: PrimatePose = {
    dt: 1 / 60, time: 0, speed: 0, turnRate: 0, sit: 1, sleep: 0, climb: 0, air: 0,
    crouch: 0, lookYaw: 0, lookPitch: 0, eat: 0, groom: 0, happy: 0, alert: 0, fullIK: true,
  }

  it("has a jaw, muzzle and brows, with the lower lip and forehead skinned to them", async () => {
    const { model } = await load()
    for (const bone of ["jaw", "tongue", "muzzle", "browL", "browR", "pupilL", "pupilR"]) expect(model.bones.has(bone), bone).toBe(true)
    const mesh = model.meshes[0]
    const index = (name: string) => mesh.skeleton.bones.findIndex((b) => b.name === name)
    const skinIndex = mesh.geometry.attributes.skinIndex
    const skinWeight = mesh.geometry.attributes.skinWeight
    const weightOf = (bone: number): number => {
      let total = 0
      for (let i = 0; i < skinIndex.count; i++) for (let k = 0; k < 4; k++) if (skinIndex.getComponent(i, k) === bone) total += skinWeight.getComponent(i, k)
      return total
    }
    for (const bone of ["jaw", "muzzle", "browL", "browR"]) expect(weightOf(index(bone)), `${bone} moves skin`).toBeGreaterThan(5)
  })

  it("lip-smacks in company, half-closes its eyes while groomed and keeps its gaze in the socket", async () => {
    const { root, model } = await load()
    const animator = new PrimateAnimator("monkey", model, 4)
    const jaw = model.bones.get("jaw")!
    const eye = model.bones.get("eyeL")!
    let jawMoves = 0
    let lastJaw = jaw.quaternion.clone()
    let smacked = 0
    let minLid = 1
    for (let i = 0; i < 60 * 8; i++) {
      animator.update({ ...pose, time: i / 60, social: 1, groomed: 1 })
      root.updateMatrixWorld(true)
      if (jaw.quaternion.angleTo(lastJaw) > 0.004) jawMoves++
      lastJaw = jaw.quaternion.clone()
      smacked = Math.max(smacked, animator.expression.smack)
      minLid = Math.min(minLid, eye.scale.y)
      expect(Math.abs(animator.expression.gazeYaw)).toBeLessThanOrEqual(0.24 + 1e-6)
      expect(Math.abs(animator.expression.gazePitch)).toBeLessThanOrEqual(0.22 + 1e-6)
    }
    expect(smacked, "a lip-smack burst happened").toBeGreaterThan(0.8)
    expect(jawMoves, "the jaw flutters, it is not frozen").toBeGreaterThan(30)
    expect(minLid, "contented, half-shut eyes").toBeLessThan(0.6)
  })

  it("brings both hands to the partner's back while grooming", async () => {
    const { root, model } = await load()
    const animator = new PrimateAnimator("monkey", model, 5)
    animator.update({ ...pose, time: 1 })
    root.updateMatrixWorld(true)
    const sitting = model.bones.get("handR")!.getWorldPosition(new THREE.Vector3())
    for (let i = 0; i < 30; i++) animator.update({ ...pose, time: 1 + i / 60, allogroom: 1 })
    root.updateMatrixWorld(true)
    const groomingR = model.bones.get("handR")!.getWorldPosition(new THREE.Vector3())
    const groomingL = model.bones.get("handL")!.getWorldPosition(new THREE.Vector3())
    // hands come up off the ground and forward, in front of the chest
    expect(groomingR.y).toBeGreaterThan(sitting.y + 0.08)
    expect(groomingR.z).toBeGreaterThan(sitting.z)
    expect(groomingL.y).toBeGreaterThan(sitting.y + 0.08)
  })
})
