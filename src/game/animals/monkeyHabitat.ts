import * as THREE from "three"
import { groundHeight, TREES } from "../world-layout"

export type MonkeyBranch = {
  id: number
  tree: number
  trunk: THREE.Vector3
  base: THREE.Vector3
  tip: THREE.Vector3
  approach: THREE.Vector3
}

// Existing groves, including the two quiet monkey discoveries in the west.
const TREE_IDS = [36, 38, 39, 42, 43, 46, 47, 49, 50, 51, 53, 55]
export const MONKEY_BRANCHES: MonkeyBranch[] = TREE_IDS.flatMap((treeIndex) => {
  const tree = TREES[treeIndex]
  const ground = groundHeight(tree.x, tree.z)
  const height = tree.s * (0.9 + tree.variant * 0.08 + ((treeIndex * 11) % 5) * 0.035)
  return [0, 1].map((side) => {
    const angle = treeIndex * 1.73 + side * Math.PI
    const direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle))
    const trunk = new THREE.Vector3(tree.x, ground, tree.z)
    const base = trunk.clone().addScaledVector(direction, 0.20 * tree.s)
    base.y += height * 0.69
    // The old tips were inside the dense crown, hiding the monkeys from every
    // approach. Extend the same attached limb to an exposed perch at its edge.
    const tip = trunk.clone().addScaledVector(direction, tree.s * 2.0)
    tip.y += height * 0.90
    const approach = trunk.clone().addScaledVector(direction, tree.s * 0.55 + 0.25)
    approach.y = groundHeight(approach.x, approach.z)
    return { id: TREE_IDS.indexOf(treeIndex) * 2 + side, tree: treeIndex, trunk, base, tip, approach }
  })
})

export const monkeySpawnBranch = (index: number): MonkeyBranch => {
  const tree = [42, 43, 39, 36, 46][index % 5]
  return MONKEY_BRANCHES.find((branch) => branch.tree === tree)!
}

/** Body contact points are above the rendered wood, not arbitrary altitudes. */
export const branchFootPoint = (branch: MonkeyBranch, t: number, out: THREE.Vector3): THREE.Vector3 => {
  out.copy(branch.base).lerp(branch.tip, t)
  out.y += 0.055 - branchDrop(branch, t)
  return out
}

export const nearbyBranches = (branch: MonkeyBranch): MonkeyBranch[] =>
  MONKEY_BRANCHES.filter((other) => {
    if (other.tree === branch.tree) return false
    const distance = other.tip.distanceTo(branch.tip)
    return distance >= 0.6 && distance <= 3.2 && Math.abs(other.tip.y - branch.tip.y) <= 0.6
  })

/**
 * Boughs that give under a monkey's weight.
 *
 * Each habitat bough is a tapered cantilever, clamped at the trunk. Its
 * deflection is carried by one modal coordinate, the tip drop `q` (m, + down),
 * with the static tip-load shape phi(t) = t^2 (3 - t) / 2, so a monkey at
 * fraction t of the length drops the bough by phi(t) * q and the tip drops q.
 * A sitting monkey pulls it toward its static sag; a landing or a take-off
 * kicks the bough's velocity, and it rings at about 2 Hz, lightly damped like
 * green wood with leaves, until it settles. The same phi carries the drawn
 * bough and the contact point the feet are planted on, so the monkey rides
 * the bough it bends.
 */
export type BranchSpring = {
  q: number
  v: number
  /** sum of phi(t) * weight of everything resting on it this frame */
  load: number
  /** tip drop per macaque-weight at the tip (m): stiffer for a short bough */
  compliance: number
  omega: number
}

const BRANCH_DAMPING = 0.11
export const branchShape = (t: number): number => {
  const u = t < 0 ? 0 : t > 1 ? 1 : t
  return u * u * (3 - u) * 0.5
}

export const BRANCH_SPRINGS: BranchSpring[] = MONKEY_BRANCHES.map((branch) => {
  const length = branch.base.distanceTo(branch.tip)
  // A cantilever's tip deflection grows with the cube of its length and its
  // frequency falls with its square: a 2.5 m macaque bough drops ~7 cm under
  // a 6 kg monkey at the tip and rings near 2 Hz.
  const k = length / 2.5
  return {
    q: 0, v: 0, load: 0,
    compliance: Math.min(0.16, Math.max(0.025, 0.07 * k * k * k)),
    omega: 2 * Math.PI * Math.min(3.2, Math.max(1.3, 2.0 / (k * k))),
  }
})

/** Something rests on this bough at fraction t (weight 1 = one macaque). */
export const loadBranch = (branch: MonkeyBranch, t: number, weight = 1): void => {
  BRANCH_SPRINGS[branch.id].load += branchShape(t) * weight
}

/** A landing (+ down) or a push-off kicks the bough at fraction t (m/s at the body). */
export const kickBranch = (branch: MonkeyBranch, t: number, velocity: number): void => {
  const s = BRANCH_SPRINGS[branch.id]
  // a macaque is light against the bough's modal mass, so a fraction of its
  // vertical speed reaches the wood, scaled by how far out it lands
  s.v += velocity * 0.35 * branchShape(t)
}

/** Integrate every bough once per frame (semi-implicit, stable at 20 Hz). */
export const stepBranches = (dt: number, wind = 0, time = 0): void => {
  for (let i = 0; i < BRANCH_SPRINGS.length; i++) {
    const s = BRANCH_SPRINGS[i]
    // wind works the bough a little on its own, so a sitting monkey sways with it
    const gust = wind * 0.012 * (Math.sin(time * 1.3 + i * 1.7) + 0.5 * Math.sin(time * 3.1 + i * 0.6))
    const rest = s.compliance * s.load + gust
    const steps = dt > 1 / 45 ? 2 : 1
    const h = dt / steps
    for (let n = 0; n < steps; n++) {
      s.v += (-s.omega * s.omega * (s.q - rest) - 2 * BRANCH_DAMPING * s.omega * s.v) * h
      s.q += s.v * h
    }
    // a bough bends, it does not snap or fold back on itself
    s.q = Math.max(-0.08, Math.min(0.3, s.q))
    s.load = 0
  }
}

/** Current drop of the bough at fraction t (m). */
export const branchDrop = (branch: MonkeyBranch, t: number): number =>
  BRANCH_SPRINGS[branch.id].q * branchShape(t)

/** Reset every bough to rest (tests, QA). */
export const resetBranches = (): void => {
  for (const s of BRANCH_SPRINGS) { s.q = 0; s.v = 0; s.load = 0 }
}
