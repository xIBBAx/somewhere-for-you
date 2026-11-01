import { HUB_CENTER } from "./hubLayout"
import { WATER_LEVEL, lakeMask, nRegion, nWarp } from "./climate"
import { fbm, makeSimplex, mix, smax, smooth } from "./noise"
import { WORLD_SEED } from "./worldConfig"

const nMacro = makeSimplex(WORLD_SEED ^ 0x1001)
const nMedium = makeSimplex(WORLD_SEED ^ 0x2002)
const nMicro = makeSimplex(WORLD_SEED ^ 0x3003)

/** Height of the open wilds, before blending into the authored home terrain. */
export const rawWildHeight = (x: number, z: number): number => {
  const d = Math.hypot(x - HUB_CENTER.x, z - HUB_CENTER.z)
  const away = smooth(28, 190, d)
  // Domain warp gives organic, non-grid ridges and valleys.
  const wx = x + nWarp(x / 340, z / 340) * 70
  const wz = z + nWarp(x / 340 - 41.3, z / 340 + 27.9) * 70
  const hillsRegion = smooth(-0.2, 0.55, fbm(nRegion, x / 1100 + 5.5, z / 1100 - 9.1, 2)) * smooth(90, 320, d)
  const macro = fbm(nMacro, wx / 420, wz / 420, 4) // −1…1
  const medium = fbm(nMedium, x / 95, z / 95, 3)
  const micro = nMicro(x / 11, z / 11) * 0.16 + nMicro(x / 4.3 + 9, z / 4.3) * 0.045
  // Rolling meadows near home, broad hills further out, taller hills in hill regions.
  const macroAmp = mix(1.5, 9 + hillsRegion * 11, away)
  const mediumAmp = mix(0.35, 2.1 + hillsRegion * 1.4, away)
  let h = 0.55 + macro * macroAmp + medium * mediumAmp + micro
  // Valleys never dip into accidental puddles: only lake basins hold water.
  h = smax(h, WATER_LEVEL + 0.55, 1.6)
  const lake = lakeMask(x, z)
  if (lake > 0) {
    const bowl = WATER_LEVEL - 0.25 - lake * 2.6
    h = mix(h, Math.min(h, bowl), smooth(0, 0.65, lake))
  }
  return h
}
