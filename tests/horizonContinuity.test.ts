import { afterEach, expect, it, vi } from "vitest"

const hooks = vi.hoisted(() => ({ frames: [] as (() => void)[], cleanup: [] as (() => void)[] }))
vi.mock("@react-three/fiber", () => ({ useFrame: (frame: () => void) => hooks.frames.push(frame) }))
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useMemo: (build: () => unknown) => build(),
  useEffect: (effect: () => (() => void)) => { hooks.cleanup.push(effect()) },
}))
vi.mock("../src/game/celestial/render/earthMaps", () => ({
  EARTH_UV_GLSL: "", earthCloudShift: { value: 0 }, earthTexture: () => null,
}))

import { HorizonLands, landsRT } from "../src/world/render/HorizonLands"
import { spaceRT } from "../src/game/celestial/spaceState"
import { LANDS_RINGS, LANDS_SEGMENTS } from "../src/world/horizonLands"

const originalSpace = { realm: spaceRT.realm, mode: spaceRT.mode, earthAltitude: spaceRT.earthAltitude, skyAltitude: spaceRT.skyAltitude }
afterEach(() => {
  for (const cleanup of hooks.cleanup.splice(0)) cleanup()
  hooks.frames.length = 0
  Object.assign(spaceRT, originalSpace)
  vi.unstubAllGlobals()
})

it("warms the hidden horizon before takeoff and rebuilds after a scene remount", () => {
  const workers: { postMessage: ReturnType<typeof vi.fn>; onmessage: ((event: { data: unknown }) => void) | null }[] = []
  vi.stubGlobal("Worker", class {
    postMessage = vi.fn()
    onmessage = null
    terminate = vi.fn()
    constructor() { workers.push(this) }
  })
  Object.assign(spaceRT, { realm: "earth", mode: "local", earthAltitude: 0, skyAltitude: 0 })
  HorizonLands()
  hooks.frames[0]()
  expect(workers[0].postMessage).toHaveBeenCalledOnce()
  expect(landsRT.visible).toBe(false)
  hooks.frames[0]()
  expect(workers[0].postMessage).toHaveBeenCalledOnce() // only one pending build
  const request = workers[0].postMessage.mock.calls[0][0]
  const n = LANDS_RINGS * LANDS_SEGMENTS
  workers[0].onmessage!({ data: { id: request.id, data: {
    cx: request.cx, cz: request.cz,
    positions: new Float32Array(n * 3), colors: new Float32Array(n * 3), kinds: new Float32Array(n * 2),
  } } })
  spaceRT.earthAltitude = 520
  spaceRT.skyAltitude = 520
  hooks.frames[0]()
  expect(landsRT.visible).toBe(true)
  expect(workers[0].postMessage).toHaveBeenCalledOnce() // reuse the prepared mesh
  HorizonLands()
  hooks.frames[1]()
  expect(landsRT.visible).toBe(false) // old diagnostic coordinates are not readiness
  expect(workers[1].postMessage).toHaveBeenCalledOnce()
})
