import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useGame } from "../src/state/gameStore"
import { avatarRT, characterRT, companionRT, playerRT, resetRuntime, worldRT } from "../src/game/runtime"
import { horseRT } from "../src/game/horses/horseState"
import { resetRider, restoreRiderSeat, riderRT } from "../src/game/horses/riding"
import { spawnPegasi } from "../src/game/pegasus/pegasi"
import { callStarborn, STARBORN_ID } from "../src/game/pegasus/starbornCall"
import { groundNow } from "../src/game/pegasus/flight"
import { spaceRT } from "../src/game/celestial/spaceState"
import { earthFrame } from "../src/game/celestial/frames"
import { sailRT } from "../src/game/celestial/starSail"
import { resetTravelState } from "../src/game/celestial/cosmicTravel"
import { fastTravelRT, fastTravelTo, HOME_SPOT, recoverToSafety, stepFastTravel } from "../src/game/travel/fastTravel"
import { groundHeight } from "../src/game/world-layout"
import { StuckTimer } from "../src/game/travel/safety"
import { LOCATION_KEY, locationRT, readLocationCheckpoint, restoreLocationCheckpoint, saveLocationCheckpoint } from "../src/game/travel/locationMemory"

const store = new Map<string, string>()
const finishFade = (): void => { stepFastTravel(0.35); stepFastTravel(0.35) }

beforeEach(() => {
  vi.stubGlobal("localStorage", { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) })
  resetRider("explorer"); resetRider("companion")
  characterRT.active = "explorer"
  resetRuntime(HOME_SPOT)
  spawnPegasi()
  for (const h of horseRT.horses.values()) if (h.flight) groundNow(h)
  resetTravelState()
  sailRT.autopilot = null
  spaceRT.mode = "local"; spaceRT.realm = "earth"; spaceRT.frame = earthFrame()
  worldRT.relocating = false; worldRT.introActive = false; worldRT.finaleActive = false
  fastTravelRT.pending = null
  useGame.setState({ started: true })
  locationRT.restored = true
  locationRT.saved = false
})
afterEach(() => {
  resetRider("explorer"); resetRider("companion")
  worldRT.relocating = false
  fastTravelRT.pending = null
  spaceRT.mode = "local"; spaceRT.realm = "earth"
  store.clear()
  vi.unstubAllGlobals()
})

describe("recovery reaches the placement system", () => {
  it("repairs a fall detected below dry ground", () => {
    playerRT.pos.y = groundHeight(playerRT.pos.x, playerRT.pos.z) - 20
    expect(recoverToSafety(false, () => {})).toBe("nearby")
    finishFade()
    expect(playerRT.pos.y).toBeCloseTo(groundHeight(playerRT.pos.x, playerRT.pos.z))
    expect(fastTravelRT.pending).toBeNull()
    expect(worldRT.relocating).toBe(false)
  })
  it("moves an explicitly stuck player to different safe ground", () => {
    const start = playerRT.pos.clone()
    expect(recoverToSafety(true, () => {})).toBe("nearby")
    finishFade()
    expect(Math.hypot(playerRT.pos.x - start.x, playerRT.pos.z - start.z)).toBeGreaterThanOrEqual(3.9)
  })
  it("repairs a broken off-world position even without a mount", () => {
    spaceRT.mode = "deep"
    playerRT.pos.x = NaN
    expect(recoverToSafety(false, () => {})).toBe("home")
    finishFade()
    expect(spaceRT.mode).toBe("local")
    expect(spaceRT.realm).toBe("earth")
    expect(Number.isFinite(playerRT.pos.x)).toBe(true)
  })
  it("rescues an unmounted traveller instead of suggesting an unavailable action", () => {
    spaceRT.mode = "deep"
    expect(recoverToSafety(false, () => {})).toBe("space")
    finishFade()
    expect(spaceRT.mode).toBe("local")
    expect(avatarRT().rideY).toBeNull()
  })
  it("does not repeat the stuck hint until there is real progress", () => {
    const timer = new StuckTimer(4, 1)
    let hints = 0
    for (let i = 0; i < 300; i++) if (timer.update(0.1, 0, 0, true)) hints++
    expect(hints).toBe(1)
    timer.update(0.1, 3, 0, true)
    for (let i = 0; i < 50; i++) if (timer.update(0.1, 3, 0, true)) hints++
    expect(hints).toBe(2)
  })
})

describe("party travel", () => {
  it("preserves both tandem seats and the request-time caller through a fade", () => {
    const h = horseRT.horses.get(STARBORN_ID)!
    restoreRiderSeat("explorer", h, 0)
    restoreRiderSeat("companion", h, 1)
    expect(fastTravelTo({ ...HOME_SPOT, name: "home" }, () => {})).toBeNull()
    characterRT.active = "companion" // even an external selection cannot retarget this request
    finishFade()
    expect(characterRT.active).toBe("explorer")
    expect(h.rider).toBe("explorer")
    expect(h.passenger).toBe("companion")
    for (const id of ["explorer", "companion"] as const) {
      expect(riderRT[id].phase).toBe("riding")
      expect(riderRT[id].horse).toBe(h)
    }
    expect(playerRT.rideY).not.toBeNull()
    expect(companionRT.rideY).not.toBeNull()
  })
  it("keeps a flying rider airborne after Earth fast travel", () => {
    const h = horseRT.horses.get(STARBORN_ID)!
    h.flight!.mode = "air"
    restoreRiderSeat("explorer", h, 0)
    expect(fastTravelTo({ ...HOME_SPOT, name: "home" }, () => {})).toBeNull()
    finishFade()
    expect(h.flight!.mode).toBe("air")
    expect(h.y - groundHeight(h.x, h.z)).toBeGreaterThan(40)
    expect(riderRT.explorer.phase).toBe("riding")
  })
  it("lets Starborn catch an unmounted rider in deep space", () => {
    spaceRT.mode = "deep"
    expect(callStarborn("explorer", () => {})).toBe(true)
    const h = horseRT.horses.get(STARBORN_ID)!
    expect(riderRT.explorer.horse).toBe(h)
    expect(riderRT.explorer.phase).toBe("riding")
    expect(h.flight!.mode).toBe("sail")
    expect(horseRT.horses.get(STARBORN_ID)).toBe(h)
  })
})

describe("safe Earth reload checkpoint", () => {
  it("saves a safe stop and restores it without reviving a stale saddle", () => {
    playerRT.pos.set(0, groundHeight(0, 22.5), 22.5)
    expect(saveLocationCheckpoint()).toBe(true)
    playerRT.pos.set(100, 0, 100)
    locationRT.restored = false
    expect(restoreLocationCheckpoint()).toBe(true)
    expect(playerRT.pos.x).toBeCloseTo(0)
    expect(playerRT.pos.z).toBeCloseTo(22.5)
    expect(playerRT.rideY).toBeNull()
  })
  it("retains the safe checkpoint while in space and rejects malformed coordinates", () => {
    store.set(LOCATION_KEY, "old checkpoint")
    spaceRT.mode = "deep"
    expect(saveLocationCheckpoint()).toBe(false)
    expect(store.get(LOCATION_KEY)).toBe("old checkpoint")
    expect(readLocationCheckpoint('{"v":1,"x":1e99,"z":0,"facing":0,"active":"explorer"}')).toBeNull()
    expect(readLocationCheckpoint("{broken")).toBeNull()
  })
})
