export const normalizedDegrees = (degrees: number): number => ((degrees % 360) + 360) % 360
export const formatBearing = (degrees: number): string => `${String(Math.round(normalizedDegrees(degrees)) % 360).padStart(3, "0")}°`
export const rotateMapPoint = (x: number, y: number, heading: number) => {
  const angle = heading * Math.PI / 180, dx = x - 100, dy = y - 100
  return { x: 100 + dx * Math.cos(angle) + dy * Math.sin(angle), y: 100 - dx * Math.sin(angle) + dy * Math.cos(angle) }
}
export const groundArrived = (distance: number, heightAboveGround: number, airborne: boolean): boolean => distance < 4 && Math.abs(heightAboveGround) < 3 && !airborne

/** Logical world coordinates, never render-origin coordinates. North is -z. */
export const groundBearing = (dx: number, dz: number): number =>
  (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360
export const compassPoint = (degrees: number): string =>
  ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(normalizedDegrees(degrees) / 45) % 8]
export const groundDistance = (metres: number): string =>
  metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(Math.max(0, metres))} m`

export const mapPoint = (x: number, z: number, cx: number, cz: number, range: number, radius = 82, heading = 0) => rotateMapPoint(100 + (x - cx) / range * radius, 100 + (z - cz) / range * radius, heading)
export const unmapPoint = (x: number, y: number, cx: number, cz: number, range: number, radius = 82, heading = 0) => {
  const p = rotateMapPoint(x, y, -heading)
  return { x: cx + (p.x - 100) / radius * range, z: cz + (p.y - 100) / radius * range }
}

/** Horizontal direction and true elevation; radius only compresses distance.
 * Zenith/nadir have no meaningful azimuth and are explicitly flagged. */
export const skyPoint = (x: number, y: number, z: number, maxDistance: number) => {
  const distance = Math.hypot(x, y, z), horizontal = Math.hypot(x, z)
  const radius = distance > 0 ? 18 + 62 * Math.log1p(distance) / Math.log1p(Math.max(distance, maxDistance)) : 0
  return {
    x: 100 + (horizontal > distance * 1e-8 ? x / horizontal * radius : 0),
    y: 100 + (horizontal > distance * 1e-8 ? z / horizontal * radius : 0),
    elevation: Math.atan2(y, horizontal) * 180 / Math.PI,
    vertical: distance > 0 && horizontal <= distance * 1e-8,
    coincident: distance < 1e-7,
    distance,
  }
}
