import { test } from "vitest"
import { generateChunk, SCATTER_STRIDE } from "../src/world/chunkGen"

test("chunk timing", () => {
  const coords = [[0, 0], [5, 3], [-12, 40], [100, -100], [3000, 2000], [-1, -1]]
  for (const [cx, cz] of coords) {
    const p = generateChunk(cx, cz)
    const kinds: Record<number, number> = {}
    for (let i = 0; i < p.scatterCount; i++) { const k = p.scatter[i * SCATTER_STRIDE + 5]; kinds[k] = (kinds[k] ?? 0) + 1 }
    console.warn(`chunk ${cx},${cz} ${p.genMs.toFixed(1)}ms h ${p.minH.toFixed(1)}..${p.maxH.toFixed(1)} water ${p.hasWater} biome ${p.biome} scatter ${p.scatterCount} ${JSON.stringify(kinds)}`)
  }
})
