import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"
import { CORE_BONES, REAL_REQUIRED_BONES } from "../game/characters/realHuman"
import { FACE_UNITS } from "../game/characters/faceRig"

/**
 * Checks a custom character model in the browser before it is used: it must
 * be a skinned glTF with the core skeleton HumanAnimator drives
 * (docs/CHARACTER_ASSETS.md). Optional extras (ARKit face units, eye and cape
 * bones, fingers) are reported so the Personalize screen can say what will
 * and will not move.
 */
export type ModelReport = {
  ok: boolean
  problems: string[]
  notes: string[]
  height: number
  meshes: number
  bones: number
}

export const checkCharacterModel = async (buffer: ArrayBuffer): Promise<ModelReport> => {
  const problems: string[] = []
  const notes: string[] = []
  let gltf: Awaited<ReturnType<GLTFLoader["parseAsync"]>>
  try {
    gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, "")
  } catch (error) {
    return { ok: false, problems: [`The file could not be read as glTF: ${error instanceof Error ? error.message : String(error)}`], notes, height: 0, meshes: 0, bones: 0 }
  }
  const bones = new Set<string>()
  let skinned = 0
  const morphs = new Set<string>()
  gltf.scene.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.add(o.name)
    const mesh = o as THREE.SkinnedMesh
    if (mesh.isSkinnedMesh) skinned++
    if ((mesh as THREE.Mesh).isMesh && mesh.morphTargetDictionary) for (const k of Object.keys(mesh.morphTargetDictionary)) morphs.add(k)
  })
  gltf.scene.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(gltf.scene)
  const height = box.isEmpty() ? 0 : box.max.y - box.min.y
  if (skinned === 0) problems.push("It has no skinned mesh, so it cannot be animated.")
  const missing = CORE_BONES.filter((b) => !bones.has(b))
  if (missing.length) problems.push(`It is missing ${missing.length} bone${missing.length > 1 ? "s" : ""} the game moves: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? "…" : ""}.`)
  if (height < 0.6 || height > 3) problems.push(`It is ${height.toFixed(2)} m tall; characters should be between 0.6 and 3 m (one unit is one metre).`)
  const faceUnits = FACE_UNITS.filter((u) => morphs.has(u)).length
  notes.push(faceUnits >= FACE_UNITS.length ? "Facial expressions: all face units present." : faceUnits > 0 ? `Facial expressions: ${faceUnits} of ${FACE_UNITS.length} face units.` : "No face units: the face will not change expression.")
  if (!bones.has("eyeL") || !bones.has("eyeR")) notes.push("No eye bones: the eyes will not follow what the character looks at.")
  if (!bones.has("cape") || !bones.has("cape2")) notes.push("No cape bones: clothing will not sway.")
  const extras = REAL_REQUIRED_BONES.filter((b) => !CORE_BONES.includes(b) && !bones.has(b) && /^(index|middle|ring|pinky|thumb)/.test(b))
  if (extras.length) notes.push("Some finger bones are missing: hands will not curl fully.")
  // free the parsed copy: the game loads its own when the world restarts
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry?.dispose()
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose()
      m.dispose()
    }
  })
  return { ok: problems.length === 0, problems, notes, height, meshes: skinned, bones: bones.size }
}
