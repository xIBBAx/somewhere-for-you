import { test } from "vitest"
import { writeFileSync } from "node:fs"
import { biomeWeights, BIOME_COUNT, WATER_LEVEL } from "../src/world/climate"
import { worldHeight, slopeAt } from "../src/world/terrain"

const COLORS: Array<[number, number, number]> = [
  [110, 170, 70], [190, 200, 80], [40, 110, 50], [240, 160, 200], [210, 120, 40], [40, 90, 90], [150, 90, 220], [80, 200, 200],
]
test("world map", () => {
  const S = Number(process.env.MAP_SIZE ?? 512), span = Number(process.env.MAP_SPAN ?? 4096)
  const w = new Float32Array(BIOME_COUNT)
  const buf = Buffer.alloc(S * S * 3)
  const t0 = performance.now()
  let minH = 1e9, maxH = -1e9, maxSlope = 0
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const x = (i / S - 0.5) * span, z = (j / S - 0.5) * span
    const h = worldHeight(x, z)
    minH = Math.min(minH, h); maxH = Math.max(maxH, h)
    biomeWeights(x, z, w)
    let r = 0, g = 0, b = 0
    for (let k = 0; k < BIOME_COUNT; k++) { r += COLORS[k][0] * w[k]; g += COLORS[k][1] * w[k]; b += COLORS[k][2] * w[k] }
    const shade = 0.75 + Math.max(-0.25, Math.min(0.25, (worldHeight(x + 2, z + 2) - h) * 0.6))
    if (h < WATER_LEVEL) { r = 40; g = 90; b = 180 }
    const o = (j * S + i) * 3
    buf[o] = Math.min(255, r * shade); buf[o + 1] = Math.min(255, g * shade); buf[o + 2] = Math.min(255, b * shade)
  }
  const dt = performance.now() - t0
  for (let k = 0; k < 2000; k++) maxSlope = Math.max(maxSlope, slopeAt(Math.random() * 4000 - 2000, Math.random() * 4000 - 2000))
  writeFileSync("/tmp/qa/worldmap.ppm", Buffer.concat([Buffer.from(`P6 ${S} ${S} 255\n`), buf]))
  console.warn(`samples ${S * S} in ${dt.toFixed(0)}ms (${(dt * 1000 / (S * S)).toFixed(2)}µs/sample incl. biome) h ${minH.toFixed(2)}..${maxH.toFixed(2)} maxSlope ${maxSlope.toFixed(2)}`)
})
