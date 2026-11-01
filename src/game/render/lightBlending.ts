import * as THREE from "three"

/**
 * Blending for emitted light (glows, beams, sparks): colour is added as is,
 * and the shaders write alpha 0. N8AO's transparency-aware pass reads a
 * transparent object's alpha as how much it hides the ground behind it, so
 * additive light written with alpha 1 erased the contact shadows inside its
 * silhouette and showed as a crisp hazy disc on the grass.
 */
export const LIGHT_BLENDING = {
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
} as const

/**
 * Three's AdditiveBlending is (SrcAlpha, One) for colour and alpha alike, so
 * a faded additive sprite still writes alpha and N8AO reads it as cover.
 * This keeps the colour equation exactly and leaves destination alpha alone.
 */
export const asLightBlending = (m: THREE.Material): boolean => {
  if (m.blending !== THREE.AdditiveBlending) return false
  m.blending = THREE.CustomBlending
  m.blendEquation = THREE.AddEquation
  m.blendSrc = THREE.SrcAlphaFactor
  m.blendDst = THREE.OneFactor
  m.blendEquationAlpha = THREE.AddEquation
  m.blendSrcAlpha = THREE.ZeroFactor
  m.blendDstAlpha = THREE.OneFactor
  return true
}

const scanned = new WeakSet<THREE.Material>()
/** Convert every additive material in a scene (cheap: each material is visited once). */
export const lightBlendScene = (scene: THREE.Object3D): number => {
  let n = 0
  scene.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
    if (!mat) return
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      if (scanned.has(m)) continue
      scanned.add(m)
      if (asLightBlending(m)) n++
    }
  })
  return n
}
