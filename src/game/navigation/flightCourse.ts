import * as THREE from "three"
import type { HorseState } from "../horses/horseState"
import { useObservation } from "../../state/observationStore"
import { groundHeight } from "../world-layout"
import { autopilotGoal, mountUniverse, sailRT, type SailAutopilot } from "../celestial/starSail"
import { bodyById } from "../celestial/universe"
import { spaceRT } from "../celestial/spaceState"
import { observationJourney } from "../celestial/observations"
import { SITE_BY_ID } from "../celestial/realm/lunarSites"
import { earthFrame, localToUniverse } from "../celestial/frames"
import { homeLanding } from "../horses/riding"

export const flightCourseName = (ap: SailAutopilot): string | null => {
  if (!ap) return null
  if (ap.kind === "home") return "Homeward"
  if (ap.kind === "observation") return observationJourney(ap.journey)?.stops[ap.stop]?.title ?? null
  if (ap.kind === "site") return SITE_BY_ID.get(ap.id)?.title ?? null
  if (ap.kind === "cats") return "Space cats · rendezvous"
  return bodyById(ap.id)?.def.name ?? null
}

/** Read the very waypoint flown by the solver, including its live stand-off.
 * Home's final low-air landing uses the riding controller's own safe spot. */
export const activeFlightCourse = (mount: HorseState | null) => {
  const ap = sailRT.autopilot
  if (!mount || !ap) return null
  const goal = autopilotGoal(mount), name = flightCourseName(ap)
  if (!goal || !name) return null
  const point = goal.point.clone()
  const landing = ap.kind === "home" && spaceRT.mode === "local" && spaceRT.realm === "earth" && mount.flight?.mode !== "sail"
  if (landing) {
    const spot = homeLanding()
    localToUniverse(earthFrame(), spot.x, groundHeight(spot.x, spot.z), spot.z, point)
  }
  const position = mountUniverse(mount, new THREE.Vector3()), distance = point.distanceTo(position)
  const observation = useObservation.getState()
  const holding = ap.kind === "observation" && observation.journey === ap.journey && observation.stop === ap.stop && observation.ready
  return { point, name, distance, kind: ap.kind, holding, landing, arrive: goal.arrive,
    stage: holding ? "Holding viewpoint" : ap.kind === "home" ? landing ? "Safe meadow landing" : "Upper-air approach" : ap.kind === "site" ? "Site approach waypoint" : ap.kind === "observation" ? "Observation waypoint" : ap.kind === "cats" ? "Rendezvous waypoint" : "Safe approach waypoint" }
}
