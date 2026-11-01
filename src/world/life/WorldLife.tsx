import { useEffect, useRef } from "react"
import { Birds } from "./Birds"
import { GroundLife } from "./ground/GroundLife"
import { type BirdsSimState } from "./birdsSim"
import { Insects } from "./Insects"
import { type InsectsSimState } from "./insectsSim"
import { registerLifeDebug } from "./lifeDebug"
import { useCrickets } from "./useCrickets"

/**
 * Top-level life system for the endless procedural world:
 * 1. BIRDS: distant flocks, perched/ground taking-off birds, lake birds (1 draw call).
 * 2. INSECTS: butterflies, moths, bees, gnats, and night fireflies (3 draw calls).
 * 3. CRICKETS: environmental audio-only state hook.
 * 4. GROUND LIFE: ants, beetles, grasshoppers, crickets, woodlice, millipedes,
 *    snails, worms and harvestmen on the ground (5 draw calls, see ground/).
 * 5. DEBUG: window.__worldDev (forceBirds, lifeStats, groundLife) under ?debug.
 */
export const WorldLife = (): React.ReactElement => {
  const birdsSimRef = useRef<BirdsSimState | null>(null)
  const insectsSimRef = useRef<InsectsSimState | null>(null)

  // Audio crickets hook
  useCrickets()

  // Debug API registration under ?debug
  useEffect(() => {
    return registerLifeDebug(
      () => birdsSimRef.current,
      () => insectsSimRef.current,
    )
  }, [])

  return (
    <group name="world-life">
      <Birds simRef={birdsSimRef} />
      <Insects simRef={insectsSimRef} />
      <GroundLife />
    </group>
  )
}
