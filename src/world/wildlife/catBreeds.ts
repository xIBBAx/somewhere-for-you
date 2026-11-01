import * as THREE from "three"
import type { AnimalModel, CatBuild, Coat } from "./animalAssets"

/**
 * Wild cats of real breeds and everyday moggies, all drawn from the one rigged
 * cat (The cat's) with their own coat, eyes and build:
 *
 * - `look` adds what the baked tabby mask cannot: solid coats with only
 *   ghost bars, spotted and rosetted torsos, tortoiseshell blotches,
 *   colourpoints (Siamese, Ragdoll, Birman), white spotting from mitts to
 *   bicolour, and the Van pattern.
 * - `build` changes head, ear and tail proportions on the instance's own
 *   skeleton; `size` multiplies the spawn scale (a Maine Coon is a big cat).
 * - `eye` multiplies the baked olive iris (0.22, 0.22, 0.04): high blue for
 *   sapphire, high red for copper, green-heavy for gooseberry.
 *
 * The cat's coat is not here: she stays last in `COATS.cat` and is never rolled
 * for a wild cat. Names double as discovery ids (`friend:cat:<name>`), so
 * keep them unique and stable.
 */
const BLUE_EYES: [number, number, number] = [1.1, 2.0, 16]
const COPPER_EYES: [number, number, number] = [1.9, 1.05, 0.4]
const GOLD_EYES: [number, number, number] = [1.65, 1.35, 0.55]
const GREEN_EYES: [number, number, number] = [0.75, 1.45, 1.5]

export const CAT_BREEDS: Coat[] = [
  // --- everyday cats -------------------------------------------------------
  { name: "ginger tabby", base: "#c07a37", light: "#f2e3ca", pattern: "#8a4718", eye: [1.55, 1.15, 0.55] },
  { name: "grey tabby", base: "#8a8892", light: "#e9e6e2", pattern: "#474650" },
  { name: "tuxedo", base: "#211e1e", light: "#f2eee7", pattern: "#1a1817", eye: [1.7, 1.3, 0.45], look: { solid: 1, white: 0.3 } },
  { name: "cream", base: "#d9bd94", light: "#f8f0e1", pattern: "#bb9a68", eye: [1.9, 1.05, 0.5] },
  { name: "black", base: "#232020", light: "#39332f", pattern: "#171514", eye: [1.8, 1.25, 0.35], look: { solid: 0.9 } },
  { name: "calico", base: "#2c2420", light: "#f7f2ea", pattern: "#1b1614", eye: [1.3, 1.1, 0.8],
    look: { solid: 0.75, tortie: 0.55, patch: "#c46f2c", white: 0.55 } },
  { name: "brown tabby", base: "#836349", light: "#e2d5c3", pattern: "#422f21", eye: [1.45, 1.1, 0.7] },
  { name: "tortoiseshell", base: "#2a211d", light: "#4a3c33", pattern: "#1a1513", eye: [1.75, 1.25, 0.45],
    look: { solid: 0.8, tortie: 0.6, patch: "#b4652a" },
    lines: ["A tortie with opinions. Several of them. All at once.", "Black and ginger and absolutely certain she is in charge."] },
  { name: "orange and white", base: "#c97c3c", light: "#f6efe4", pattern: "#8f4a1a", eye: [1.6, 1.2, 0.55], look: { white: 0.5 } },
  // --- breeds ----------------------------------------------------------------
  { name: "British Shorthair", base: "#8a8d92", light: "#a2a5a9", pattern: "#777a80", eye: COPPER_EYES,
    look: { solid: 0.92 }, build: { size: 1.1, head: 1.12, ears: 0.86, tail: 1.05 },
    lines: ["Round copper eyes, a teddy-bear face and zero intention of being picked up.", "The British Shorthair accepts one polite stroke. Exactly one."] },
  { name: "Russian Blue", base: "#868a91", light: "#a3a7ac", pattern: "#73777e", eye: GREEN_EYES,
    look: { solid: 0.95 }, build: { size: 0.95, head: 0.94, ears: 1.12, tail: 0.95 },
    lines: ["Silver-tipped blue fur and green eyes. Shy, then suddenly your shadow."] },
  { name: "Siamese", base: "#e9dcc4", light: "#f5ede0", pattern: "#3b2a20", eye: BLUE_EYES,
    look: { solid: 1, point: 1 }, build: { size: 0.92, head: 0.92, ears: 1.22, tail: 0.92 },
    lines: ["The Siamese has a great deal to say about how late you are.", "Sapphire eyes, dark points and a very loud opinion."] },
  { name: "Ragdoll", base: "#e4d6c0", light: "#f7f2ea", pattern: "#4a3628", eye: BLUE_EYES,
    look: { solid: 1, point: 0.9, white: 0.35 }, build: { size: 1.17, head: 1.05, ears: 0.95, tail: 1.15 },
    lines: ["The Ragdoll goes completely floppy in your arms. Total trust.", "Big, soft and blue-eyed. It would like to be carried everywhere now."] },
  { name: "Birman", base: "#e6d3b3", light: "#fbf8f2", pattern: "#3e2b1f", eye: BLUE_EYES,
    look: { solid: 1, point: 1, white: 0.15 }, build: { size: 1.04, head: 1.02 },
    lines: ["Four perfect white gloves. The Birman would like you to notice them."] },
  { name: "Maine Coon", base: "#7a5a3e", light: "#ece2d2", pattern: "#2e2118", eye: GOLD_EYES,
    look: { white: 0.3 }, build: { size: 1.27, head: 1.05, ears: 1.12, tail: 1.28 },
    lines: ["A gentle giant with a tail like a feather duster.", "The Maine Coon chirps instead of meowing. Adorable and enormous."] },
  { name: "Norwegian Forest", base: "#9a9c9f", light: "#f1f0ec", pattern: "#3b3d42", eye: [1.2, 1.4, 0.9],
    look: { white: 0.4 }, build: { size: 1.19, ears: 1.02, tail: 1.24 },
    lines: ["Built for snowy forests: a thick ruff and a tail to wrap round its nose."] },
  { name: "Bengal", base: "#c79a52", light: "#f1e4c8", pattern: "#2d1d10", eye: [1.45, 1.35, 0.7],
    look: { spots: 26 }, build: { size: 1.05, head: 0.95, ears: 0.95 },
    lines: ["Rosettes like a tiny leopard. The Bengal would like to go swimming. Now.", "A Bengal: all muscle, curiosity and climbing plans."] },
  { name: "Egyptian Mau", base: "#b3b4b0", light: "#ebe9e2", pattern: "#2f2f30", eye: [0.8, 1.6, 1.4],
    look: { spots: 32 }, build: { size: 0.98, ears: 1.06 },
    lines: ["Silver with real spots, and gooseberry-green eyes. The fastest little cat there is."] },
  { name: "Abyssinian", base: "#a8673a", light: "#e8c9a2", pattern: "#6b3a1c", eye: [1.7, 1.3, 0.55],
    look: { solid: 0.85 }, build: { size: 0.96, head: 0.94, ears: 1.24 },
    lines: ["Warm ticked fur and huge ears. Already curious about your pockets."] },
  { name: "Persian", base: "#f1ede6", light: "#faf8f4", pattern: "#e3ddd3", eye: COPPER_EYES,
    look: { solid: 1 }, build: { size: 1.06, head: 1.12, ears: 0.78, tail: 1.2 },
    lines: ["A cloud of white fur and a very dignified face.", "The Persian allows you to admire it. From a respectful distance."] },
  { name: "Scottish Fold", base: "#a7a8ab", light: "#ebe9e5", pattern: "#3a3b3f", eye: [1.7, 1.2, 0.5],
    build: { size: 1.02, head: 1.08, ears: 0.82, earFold: 1.55 },
    lines: ["Folded ears, round owl eyes, unfolded love.", "The Scottish Fold sits like a little person, legs out, waiting for you."] },
  { name: "Turkish Van", base: "#b8622a", light: "#f6f3ee", pattern: "#8a4318", eye: [1.7, 1.2, 0.5],
    look: { van: 1 }, build: { size: 1.1, tail: 1.12 },
    lines: ["White all over, with an auburn cap and tail. It wants to play in the water."] },
  { name: "Bombay", base: "#141213", light: "#1d1a1a", pattern: "#0e0c0c", eye: [2.0, 1.15, 0.35],
    look: { solid: 1 }, build: { size: 1.0, head: 1.04 },
    lines: ["A tiny glossy panther with new-penny eyes."] },
]

const _parent = new THREE.Quaternion()
const _root = new THREE.Quaternion()
const _fold = new THREE.Quaternion()
const LATERAL = new THREE.Vector3(1, 0, 0)

/**
 * Give one wild cat its breed's proportions before its animator captures the
 * rest pose, so every later pose keeps them. Head and ears scale uniformly
 * (their children follow without shear); a fold turns each ear's rest about
 * the cat's lateral axis, tipping it forward and down over the skull. The
 * tail is sized by the animator (`QuadrupedAnimator.tailSize`), which owns
 * the tail root's scale for its fluff.
 */
export const applyCatBuild = (model: AnimalModel, build: CatBuild | undefined): void => {
  if (!build) return
  const head = model.bones.get("head")
  if (head && build.head) head.scale.setScalar(build.head)
  model.root.updateMatrixWorld(true)
  model.root.getWorldQuaternion(_root).invert()
  for (const name of ["earL", "earR"]) {
    const ear = model.bones.get(name)
    if (!ear) continue
    if (build.ears) ear.scale.setScalar(build.ears)
    if (build.earFold && ear.parent) {
      // local' = P⁻¹·R·P·local, with P the parent's rotation in the cat's own frame
      ear.parent.getWorldQuaternion(_parent).premultiply(_root)
      _fold.setFromAxisAngle(LATERAL, build.earFold)
      ear.quaternion.premultiply(_parent.clone().invert().multiply(_fold).multiply(_parent))
    }
  }
  model.root.updateMatrixWorld(true)
}
