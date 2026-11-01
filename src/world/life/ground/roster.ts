import { GROUND_KINDS, GROUND_LIFE, type GroundKindId } from "../../../content/groundLife"

/**
 * Numeric tables for the ground-life hot paths. Kinds are small integers
 * (their index in GROUND_KINDS) so the per-frame code never touches strings.
 */
export const K = {
  gardenAnt: 0,
  woodAnt: 1,
  ladybird: 2,
  groundBeetle: 3,
  stagBeetle: 4,
  grasshopper: 5,
  fieldCricket: 6,
  harvestman: 7,
  woodlouse: 8,
  millipede: 9,
  snail: 10,
  earthworm: 11,
} as const satisfies Record<GroundKindId, number>

export const KIND_COUNT = GROUND_KINDS.length

/**
 * Five instanced batches, one draw call each. Kinds that share a batch live
 * in one combined geometry; the vertex shader collapses the parts that do not
 * belong to an instance's kind (the same technique the aquatic shore life uses).
 */
export const BATCH = { ants: 0, beetles: 1, walkers: 2, crawlers: 3, nests: 4 } as const
export const BATCH_COUNT = 5
export const BATCH_NAMES = ["ants", "beetles", "walkers", "crawlers", "nests"] as const

/** batch of each kind */
export const KIND_BATCH: readonly number[] = [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3]
/** sub-kind (part selector) inside its batch geometry */
export const KIND_SUB: readonly number[] = [0, 1, 0, 1, 2, 0, 1, 2, 2, 3, 0, 1]

/** nest batch sub-kinds */
export const NEST = { woodMound: 0, gardenNest: 1, burrow: 2 } as const

/** Display metres per model unit (real length × readability enlargement). */
export const KIND_SCALE: readonly number[] = GROUND_KINDS.map((id) => (GROUND_LIFE[id].modelMm * GROUND_LIFE[id].displayScale) / 1000)

/**
 * Instance pools for wandering creatures (ants are bounded separately by the
 * colony pool). The total is the hard upper bound of simulated creatures.
 */
export const KIND_CAP: readonly number[] = [0, 0, 14, 10, 4, 16, 10, 10, 16, 8, 14, 14]
export const WALKER_CAP = KIND_CAP.reduce((a, b) => a + b, 0)

export const COLONY_MAX = 5
export const ANTS_PER_COLONY = 28
export const ANT_CAP = COLONY_MAX * ANTS_PER_COLONY
/** mounds + one burrow per possible cricket */
export const NEST_CAP = COLONY_MAX + KIND_CAP[K.fieldCricket]

/** Batch capacities (instances per draw). */
export const BATCH_CAP: readonly number[] = [
  ANT_CAP,
  KIND_CAP[K.ladybird] + KIND_CAP[K.groundBeetle] + KIND_CAP[K.stagBeetle],
  KIND_CAP[K.grasshopper] + KIND_CAP[K.fieldCricket] + KIND_CAP[K.harvestman],
  KIND_CAP[K.woodlouse] + KIND_CAP[K.millipede] + KIND_CAP[K.snail] + KIND_CAP[K.earthworm],
  NEST_CAP,
]

/**
 * Render distance per kind (m). Beyond it a creature is a sub-pixel speck, so
 * it is simulated but not drawn. Bigger creatures stay visible further out.
 */
export const KIND_VIEW: readonly number[] = [14, 16, 15, 22, 28, 20, 20, 20, 16, 20, 24, 26]
export const NEST_VIEW = 34

/**
 * Gentle reaction radius (m) to a nearby avatar or cat. Standing still (or
 * sneaking) lets the player get roughly twice as close before anything stirs.
 */
export const KIND_ALERT: readonly number[] = [0.55, 0.55, 1.0, 1.5, 1.3, 1.7, 1.8, 1.2, 1.0, 1.0, 0.9, 1.3]

/** Gait cycles per metre walked, per model unit of body length. */
export const KIND_STRIDE: readonly number[] = [2.4, 2.4, 2.2, 2.0, 1.8, 2.0, 2.0, 0.6, 2.6, 3.0, 1.0, 1.5]

export const kindId = (k: number): GroundKindId => GROUND_KINDS[k]
