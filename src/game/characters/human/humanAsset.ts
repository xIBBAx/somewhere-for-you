import * as THREE from "three"
import { characterModelUrl, CHARACTER_PRESETS } from "../../../content/assets"
import type { FaceRig } from "../faceRig"
import { loadRealHuman, type BodyMeasure, type CharacterStyle } from "../realHuman"

/**
 * The two people of the world share one rig contract and one animator
 * (HumanAnimator). Each role loads its personalized model if there is one
 * (a custom GLB, docs/CHARACTER_ASSETS.md) or its built-in preset.
 */

export type CharacterRole = "explorer" | "companion"

/** Expression codes HumanAnimator writes each frame; FaceRig turns them into ARKit morphs. */
export type FaceUniforms = {
  uAtlas: { value: THREE.Texture | null }
  /** expression code for the eyes (0..7) */
  uEyes: { value: number }
  /** expression code for the mouth (8..14) */
  uMouth: { value: number }
  /** 0..1 extra blush */
  uBlush: { value: number }
  uSkin: { value: THREE.Color }
}

export type HumanAsset = {
  root: THREE.Group
  skinned: THREE.SkinnedMesh[]
  bones: Map<string, THREE.Bone>
  face: FaceUniforms
  /** ARKit morphs and eye gaze driven by the same codes */
  faceRig?: FaceRig
  style?: CharacterStyle
  /** rest-pose heights read from the rig */
  measure?: BodyMeasure
}

/** Why a custom model was not used, for the Personalize screen and the console. */
export const customModelProblem: Partial<Record<CharacterRole, string>> = {}

const pending: Partial<Record<CharacterRole, Promise<HumanAsset>>> = {}

export const loadHuman = (role: CharacterRole): Promise<HumanAsset> => {
  const cached = pending[role]
  if (cached) return cached
  const promise = (async () => {
    const choice = characterModelUrl(role)
    if (choice.custom) {
      try {
        return await loadRealHuman(role, choice.url, false)
      } catch (error) {
        // a model that does not fit the rig never leaves the world without its character
        customModelProblem[role] = error instanceof Error ? error.message : String(error)
        console.warn(`[characters] the custom ${role} model could not be used; showing the built-in one instead.`, error)
      }
    }
    try {
      return await loadRealHuman(role, choice.custom ? CHARACTER_PRESETS[role].url : choice.url)
    } catch (error) {
      if (choice.url === CHARACTER_PRESETS[role].url) throw error
      console.warn(`[characters] preset for the ${role} is unavailable; using the default.`, error)
      return loadRealHuman(role, CHARACTER_PRESETS[role].url)
    }
  })()
  pending[role] = promise
  promise.catch(() => { delete pending[role] })
  return promise
}

export const loadExplorer = (): Promise<HumanAsset> => loadHuman("explorer")
export const loadCompanion = (): Promise<HumanAsset> => loadHuman("companion")
