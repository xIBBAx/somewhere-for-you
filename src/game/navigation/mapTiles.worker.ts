/// <reference lib="webworker" />
import { loadHighvaleMaps, highvaleMaps } from "../../world/highvale/highvaleData"
import { rectTouchesHighvale } from "../../world/highvale/highvaleLayout"
import { rasterTile, tileMetres, type TileRequest } from "./mapTiles"

const scope = self as unknown as DedicatedWorkerGlobalScope

scope.onmessage = async (event: MessageEvent<TileRequest>) => {
  const req = event.data
  try {
    // Highvale's ground and heights come from its baked maps: wait for them there
    const s = tileMetres(req.level), x0 = req.tx * s, z0 = req.tz * s
    if (!highvaleMaps.data && !highvaleMaps.failed && rectTouchesHighvale(x0, z0, x0 + s, z0 + s)) await loadHighvaleMaps()
    const tile = rasterTile(req)
    scope.postMessage(tile, [tile.rgba.buffer])
  } catch (error) {
    scope.postMessage({ ...req, error: String(error) })
  }
}
