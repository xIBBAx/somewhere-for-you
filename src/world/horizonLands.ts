import { WATER_LEVEL } from "./climate"
import { farLook } from "./farTerrain"
import { worldHeight } from "./terrain"
import { rawWildHeight } from "./baseTerrain"
import { hubWeight } from "./hubLayout"
import { highvaleWeight } from "./highvale/highvaleLayout"
import { BIOME_COUNT } from "./climate"

/**
 * The land seen from high in the sky: rings of the real world (the same
 * height and biome functions as every chunk) from just inside the far
 * terrain out past the horizon, bent down over Earth's curve.
 *
 * The explorer-scale Earth is 100 km round (celestial/scale.ts), so from 1 km up the
 * horizon is 14 km off and the ground 10 km out has already fallen 500 m
 * below level. Each vertex sits where the sphere really is, seen from the
 * grid's centre: an arc ρ out along the ground becomes R·sin(ρ/R) across and
 * R·(1 − cos(ρ/R)) down. Worker-safe and deterministic.
 */
/** rings of a cap under the streamed world, out from the centre to LANDS_INNER */
export const LANDS_CAP = 5
export const LANDS_RINGS = 64 + LANDS_CAP
export const LANDS_SEGMENTS = 192
/** Where the logarithmic rings start: under the far terrain, well inside
 * where it hands over (FAR_EDGE_FROM, 480 m from the player; the lands
 * re-centre within 136 m of the player). A cap of plain rings fills the
 * middle, so from high up the lands alone can be the whole ground. */
export const LANDS_INNER = 400
export const LANDS_OUTER = 52_000
export const LANDS_SNAP = 192
/** tucked under the far terrain where both are drawn */
export const LANDS_DROP = 3.2

export type HorizonLandsData = {
  cx: number
  cz: number
  /** xyz relative to the centre (metres) */
  positions: Float32Array
  /** linear rgb */
  colors: Float32Array
  /** x = canopy, y = share of the cell that is water */
  kinds: Float32Array
}

/**
 * Height for the far view: the wild terrain before erosion (its gullies are
 * far below a pixel from up here, and eroding a new region costs ~0.2 ms a
 * sample); the authored home terrain near home.
 */
const landsHeight = (x: number, z: number): number => (hubWeight(x, z) > 0.001 || highvaleWeight(x, z) > 0 ? worldHeight(x, z) : rawWildHeight(x, z))

export const landsRing = (i: number): number => i < LANDS_CAP
  ? (LANDS_INNER * i) / LANDS_CAP
  : LANDS_INNER * Math.pow(LANDS_OUTER / LANDS_INNER, (i - LANDS_CAP) / (LANDS_RINGS - 1 - LANDS_CAP))

export const landsCentre = (v: number): number => Math.round(v / LANDS_SNAP) * LANDS_SNAP

export const buildHorizonLands = (cx: number, cz: number, radius: number): HorizonLandsData => {
  const n = LANDS_RINGS * LANDS_SEGMENTS
  const positions = new Float32Array(n * 3)
  const colors = new Float32Array(n * 3)
  const kinds = new Float32Array(n * 2)
  const w = new Float32Array(BIOME_COUNT)
  const col: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < LANDS_RINGS; i++) {
    const rho = landsRing(i)
    const across = radius * Math.sin(rho / radius)
    const down = radius * (1 - Math.cos(rho / radius))
    // the inner rings tuck under the far terrain; further out the drop is the curve
    const tuck = LANDS_DROP * (1 + Math.max(0, i - LANDS_CAP) / 8)
    for (let j = 0; j < LANDS_SEGMENTS; j++) {
      const a = (j / LANDS_SEGMENTS) * Math.PI * 2
      const dx = Math.cos(a), dz = Math.sin(a)
      const x = cx + dx * rho, z = cz + dz * rho
      const h = landsHeight(x, z)
      const water = h < WATER_LEVEL - 0.05
      // a vertex stands for a cell hundreds of metres wide: average its look
      // over the cell so small woods and ponds blend instead of flickering.
      // The land's colour comes from its dry samples only; how much of the
      // cell is water is kept apart, for the shader to draw a clean shore
      // (render/aerialLook.ts) rather than a pond-blue polygon.
      const cell = rho * 0.035
      let canopy = 0, r = 0, g = 0, b = 0, dry = 0, wet = 0
      for (let s = 0; s < 5; s++) {
        const ox = s === 0 ? 0 : s === 1 ? cell : s === 2 ? -cell : 0
        const oz = s === 3 ? cell : s === 4 ? -cell : 0
        const sx = x + ox * -dz + oz * dx, sz = z + ox * dx + oz * dz
        const sh = s === 0 ? h : landsHeight(sx, sz)
        canopy += farLook(sx, sz, sh, w, col) / 5
        if (sh < WATER_LEVEL - 0.05) { wet += 0.2; continue }
        r += col[0]; g += col[1]; b += col[2]; dry++
      }
      if (dry > 0) { col[0] = r / dry; col[1] = g / dry; col[2] = b / dry }
      // all water: the biome's own land colour, so no blue bleeds ashore
      else farLook(x, z, WATER_LEVEL, w, col)
      const k = i * LANDS_SEGMENTS + j
      positions[k * 3] = dx * across
      positions[k * 3 + 1] = (water ? WATER_LEVEL - 0.25 : h) - down - tuck
      positions[k * 3 + 2] = dz * across
      colors[k * 3] = col[0]; colors[k * 3 + 1] = col[1]; colors[k * 3 + 2] = col[2]
      kinds[k * 2] = canopy; kinds[k * 2 + 1] = wet
    }
  }
  return { cx, cz, positions, colors, kinds }
}

export const landsTransfers = (d: HorizonLandsData): Transferable[] => [d.positions.buffer, d.colors.buffer, d.kinds.buffer]
