import type * as THREE from "three"
import { Lumen } from "../vfx/Lumen"
import { celebrate } from "../vfx/signatures"

/**
 * A celebration of light at a world position (collectibles, pets, the
 * smaller moments). Safe to call from anywhere: it is Lumen's general
 * celebration now (glints, rising motes and a ring); the bigger moments have
 * their own choreography in vfx/signatures.ts.
 */
export const spawnBurst = (at: THREE.Vector3, count = 14, color = "#ffd9a0", spread = 1.6): void => {
  celebrate(at, count, color, spread)
}

/** Everything Lumen draws (one draw call of light, one of lit petals). */
export const Sparkles = (): React.ReactElement => <Lumen />
