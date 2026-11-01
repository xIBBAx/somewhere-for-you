import type { CharacterId } from "../runtime"
import type { LocomotionTuning } from "./controller/locomotion"
import type { HumanAsset } from "./human/humanAsset"
import { measureBody, type BodyMeasure } from "./realHuman"

/**
 * Standing heights (m above the soles) of whichever rig each character is
 * wearing. Shared actions place hands, speech and sparkles from these instead
 * of fixed numbers, so the realistic rigs and the storybook fallback rigs
 * both line up. Each character records its own once its model has loaded;
 * the defaults are the measured realistic rigs, so nothing waits on a load.
 */
export const bodyMetricsRT: Record<CharacterId, BodyMeasure> = {
  explorer: { top: 1.568, eye: 1.445, shoulder: 1.224, chest: 1.111, waist: 0.872, hand: 0.801 },
  companion: { top: 1.732, eye: 1.605, shoulder: 1.373, chest: 1.245, waist: 1.012, hand: 0.872 },
}

const sane = (m: BodyMeasure): boolean =>
  [m.top, m.shoulder, m.chest, m.waist, m.hand].every((v) => Number.isFinite(v) && v > 0.2 && v < 2.6) &&
  m.top > m.shoulder && m.shoulder > m.chest && m.chest > m.waist

/** Record a rig's measurements; implausible values (a broken rig) are ignored. */
export const setBodyMetrics = (id: CharacterId, m: BodyMeasure): boolean => {
  if (!sane(m)) return false
  // rigs without eye bones (the storybook ones) look out from just below the crown
  const eye = m.eye > m.shoulder && m.eye < m.top ? m.eye : m.top - 0.11
  bodyMetricsRT[id] = { ...m, eye }
  return true
}

/** Swim thresholds for a realistic body: it floats with the chest at the waterline. */
export const swimTuningFor = (m: BodyMeasure): { floatDraft: number; swimEnter: number; swimExit: number } => ({
  floatDraft: m.chest,
  swimEnter: m.chest + 0.13,
  swimExit: m.chest - 0.09,
})

/**
 * Called when a character's rig has loaded: records its heights and, for a
 * realistic rig, sets the swim thresholds from its own chest. The storybook
 * rigs keep the swim tuning they were authored and tested with.
 */
export const adoptRigMetrics = (id: CharacterId, asset: HumanAsset, tuning: LocomotionTuning): BodyMeasure => {
  const m = asset.measure ?? measureBody(asset.root, asset.bones, asset.skinned)
  setBodyMetrics(id, m)
  if (asset.style === "real") Object.assign(tuning, swimTuningFor(m))
  return bodyMetricsRT[id]
}
