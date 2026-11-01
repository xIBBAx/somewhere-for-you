/// <reference lib="webworker" />
import { generateChunk, payloadTransfers } from "./chunkGen"
import { CHUNK_SIZE } from "./worldConfig"
import { loadHighvaleMaps, highvaleMaps } from "./highvale/highvaleData"
import { rectTouchesHighvale } from "./highvale/highvaleLayout"

export type ChunkRequest = { id: number; cx: number; cz: number }

const scope = self as unknown as DedicatedWorkerGlobalScope

scope.onmessage = async (event: MessageEvent<ChunkRequest>) => {
  const { id, cx, cz } = event.data
  try {
    // Highvale's ground comes from its baked maps: wait for them there
    const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE
    if (!highvaleMaps.data && !highvaleMaps.failed && rectTouchesHighvale(x0 - 2, z0 - 2, x0 + CHUNK_SIZE + 2, z0 + CHUNK_SIZE + 2)) await loadHighvaleMaps()
    const payload = generateChunk(cx, cz)
    scope.postMessage({ id, payload }, payloadTransfers(payload))
  } catch (error) {
    scope.postMessage({ id, error: String(error) })
  }
}
