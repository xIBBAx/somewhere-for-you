import { highvaleMaps } from "../highvaleData"
import { highvaleWeight } from "../highvaleLayout"

let clarity = 0
/** 0..1, eased: how much the player is in Highvale's clear mountain air. */
export const highvaleClarity = (x: number, z: number, dt: number): number => {
  const want = highvaleMaps.data ? highvaleWeight(x, z) : 0
  clarity += (want - clarity) * (1 - Math.exp(-dt * 1.5))
  if (Math.abs(clarity - want) < 1e-4) clarity = want
  return clarity
}

/**
 * While the Highvale range is drawn (HighvaleRange.tsx) the horizon lands leave
 * the massif to it: their coarse rings would otherwise stand in front.
 */
export const highvaleHole = { value: 0 }
