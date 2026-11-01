import { formatRealDistance, EARTH_SCALE } from "../celestial/scale"
import type { SkyMarker } from "./atlasSnapshot"

/** Sky distances use the universe's one scale. Keep nearby waypoints in metres
 * so a real, nonzero separation never rounds down to a fictitious 0.0 km. */
export const formatNavigationDistance = (distance: number): string => {
  const metres = Math.abs(distance) * EARTH_SCALE
  if (metres >= 1000) return formatRealDistance(Math.abs(distance))
  if (metres === 0) return "0 m"
  if (metres < 0.1) return "<0.1 m"
  return `${metres < 10 ? metres.toFixed(1) : Math.round(metres).toLocaleString()} m`
}

/** A mean radius is a spherical reference, not a promise about local terrain. */
export const formatMeanRadiusAltitude = (altitude: number): string => altitude === 0
  ? "At mean radius"
  : `${formatNavigationDistance(altitude)} ${altitude < 0 ? "below" : "above"} mean radius`

export const skyRangeLabel = (marker: SkyMarker): string => marker.destination.kind === "body"
  ? formatMeanRadiusAltitude(marker.meanAltitude)
  : `${formatNavigationDistance(marker.distance)}${marker.destination.kind === "earth" ? " to Earth landmark" : marker.destination.kind === "cats" ? " to signal" : " to site"}`
