import { HIGHVALE_ARRIVAL, highvaleWeight } from "../../world/highvale/highvaleLayout"
import { waterDepthAt } from "../../world/waterSurface"
import { HIGHVALE_NAME } from "../../world/highvale/highvaleNames"
import { DATUM_Y } from "../celestial/scale"
import { groundHeight } from "../world-layout"
import { beyondReach } from "../travel/safety"
import { MAP_HOME } from "./mapTiles"
import { compassPoint, groundBearing, groundDistance } from "./atlasMath"

/**
 * What a spot the explorer marks on the World map is: a name that says where it is
 * (by the places she knows, never a made-up one), and the ground there, so
 * the card can say whether one can stand on it or fast travel to it.
 */

/** The player's own marks, and only they, are this rose: nothing else on any map shares it. */
export const MARK_COLOUR = "#ff6f91"

const REFERENCES = [
  { name: HIGHVALE_NAME, x: HIGHVALE_ARRIVAL.x, z: HIGHVALE_ARRIVAL.z },
  { name: "home", x: MAP_HOME.x, z: MAP_HOME.z },
]

export const markName = (x: number, z: number): string => {
  if (highvaleWeight(x, z) > 0.5) return `Marked spot in the hills of ${HIGHVALE_NAME}`
  let best = REFERENCES[REFERENCES.length - 1], d = Infinity
  for (const r of REFERENCES) {
    const here = Math.hypot(x - r.x, z - r.z)
    if (here < d) { d = here; best = r }
  }
  if (d < 40) return `Marked spot by ${best.name}`
  return `Marked spot · ${groundDistance(d)} ${compassPoint(groundBearing(x - best.x, z - best.z))} of ${best.name}`
}

export type SpotGround = { height: number; water: boolean; uncharted: boolean }
export const spotGround = (x: number, z: number): SpotGround => ({
  height: Math.round(groundHeight(x, z) - DATUM_Y),
  water: waterDepthAt(x, z) > 0.25,
  uncharted: beyondReach(x, z, MAP_HOME),
})

/** The card's line about the ground: height, and water or the uncharted wilds. */
export const groundNote = (g: SpotGround): string =>
  `${g.height} m up${g.water ? " · on the water" : ""}${g.uncharted ? " · uncharted" : ""}`
