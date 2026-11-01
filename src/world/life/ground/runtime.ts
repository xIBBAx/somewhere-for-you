import { GROUND_KINDS, type GroundKindId } from "../../../content/groundLife"

/**
 * Tiny read-only runtime view of ground life for other systems (photo mode,
 * journal, QA). Updated in place every frame by GroundLife; never allocate a
 * replacement object, consumers may hold the reference.
 */
export const groundLifeRT = {
  /** set false to hide and pause the whole system */
  enabled: true,
  /** nearest visible creature to the active avatar (horizontal metres) */
  nearestKind: null as GroundKindId | null,
  nearestDistance: Infinity,
  nearestX: 0,
  nearestY: 0,
  nearestZ: 0,
  /** creatures drawn this frame, per kind (ants counted individually) */
  visible: Object.fromEntries(GROUND_KINDS.map((id) => [id, 0])) as Record<GroundKindId, number>,
  instances: 0,
  drawCalls: 0,
  colonies: 0,
  /** smoothed ground dampness used for snails and worms (0…1) */
  dampness: 0,
}

export type GroundLifeRT = typeof groundLifeRT
