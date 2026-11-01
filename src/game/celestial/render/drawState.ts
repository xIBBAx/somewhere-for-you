import * as THREE from "three"

/** Shared state of the celestial drawing (QA counters, the date, the galactic offset). */
export const celestialDrawRT = {
  /** the calendar date the planets are placed for (fixed per session) */
  date: new Date(),
  /** the observer's offset from the Sun among the stars (parsecs, equatorial) */
  galactic: new THREE.Vector3(),
  stars: 0,
  frame: 0,
  visible: 0,
}
