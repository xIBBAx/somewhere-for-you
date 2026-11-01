/// <reference lib="webworker" />
import { FAR_HALF, buildFarTerrain, farTransfers } from "./farTerrain"
import { loadHighvaleMaps, highvaleMaps } from "./highvale/highvaleData"
import { rectTouchesHighvale } from "./highvale/highvaleLayout"

export type FarRequest = { id: number; cx: number; cz: number }

const scope = self as unknown as DedicatedWorkerGlobalScope

scope.onmessage = async (event: MessageEvent<FarRequest>) => {
  const { id, cx, cz } = event.data
  try {
    if (!highvaleMaps.data && !highvaleMaps.failed && rectTouchesHighvale(cx - FAR_HALF - 64, cz - FAR_HALF - 64, cx + FAR_HALF + 64, cz + FAR_HALF + 64)) await loadHighvaleMaps()
    const data = buildFarTerrain(cx, cz)
    scope.postMessage({ id, data }, farTransfers(data))
  } catch (error) {
    scope.postMessage({ id, error: String(error) })
  }
}
