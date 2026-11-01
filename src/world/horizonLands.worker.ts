/// <reference lib="webworker" />
import { LANDS_OUTER, buildHorizonLands, landsTransfers } from "./horizonLands"
import { loadHighvaleMaps, highvaleMaps } from "./highvale/highvaleData"
import { rectTouchesHighvale } from "./highvale/highvaleLayout"

export type LandsRequest = { id: number; cx: number; cz: number; radius: number }

const scope = self as unknown as DedicatedWorkerGlobalScope

scope.onmessage = async (event: MessageEvent<LandsRequest>) => {
  const { id, cx, cz, radius } = event.data
  try {
    if (!highvaleMaps.data && !highvaleMaps.failed && rectTouchesHighvale(cx - LANDS_OUTER, cz - LANDS_OUTER, cx + LANDS_OUTER, cz + LANDS_OUTER)) await loadHighvaleMaps()
    const data = buildHorizonLands(cx, cz, radius)
    scope.postMessage({ id, data }, landsTransfers(data))
  } catch (error) {
    scope.postMessage({ id, error: String(error) })
  }
}
