import { debugEnabled } from "../../dev/debugFlag"
import { avatarRT, worldRT } from "../../game/runtime"
import { weatherRT } from "../../game/weather/weatherState"
import { forceFlockDebug, type BirdsSimState } from "./birdsSim"
import { type InsectsSimState } from "./insectsSim"
import { calculateCricketState, type CricketState } from "./useCrickets"

export type LifeStats = {
  birds: {
    distantFlocks: number
    distantBirds: number
    groundBirds: number
    takingOff: number
    lakeBirds: number
    drawCalls: number
  }
  insects: {
    butterflies: number
    moths: number
    bees: number
    gnats: number
    fireflies: number
    activeSpecies: string[]
    drawCalls: number
  }
  crickets: CricketState
  drawCallsTotal: number
}

export type WorldDevApi = {
  forceBirds: () => void
  lifeStats: () => LifeStats
}


export const registerLifeDebug = (
  getBirdsSim: () => BirdsSimState | null,
  getInsectsSim: () => InsectsSimState | null,
): (() => void) => {
  if (typeof window === "undefined") return () => {}
  const isDebug = debugEnabled()
  if (!isDebug) return () => {}

  const api: WorldDevApi = {
    forceBirds: () => {
      const sim = getBirdsSim()
      if (sim) {
        forceFlockDebug(sim, avatarRT().pos.x, avatarRT().pos.z)
      }
    },
    lifeStats: (): LifeStats => {
      const bSim = getBirdsSim()
      const iSim = getInsectsSim()
      const crickets = calculateCricketState(
        avatarRT().pos.x,
        avatarRT().pos.z,
        worldRT.timeOfDay,
        weatherRT.rain,
      )

      return {
        birds: {
          distantFlocks: bSim?.stats.distantFlocks ?? 0,
          distantBirds: bSim?.stats.distantBirds ?? 0,
          groundBirds: bSim?.stats.groundBirds ?? 0,
          takingOff: bSim?.stats.takingOff ?? 0,
          lakeBirds: bSim?.stats.lakeBirds ?? 0,
          drawCalls: 1,
        },
        insects: {
          butterflies: iSim?.stats.butterflies ?? 0,
          moths: iSim?.stats.moths ?? 0,
          bees: iSim?.stats.bees ?? 0,
          gnats: iSim?.stats.gnats ?? 0,
          fireflies: iSim?.stats.fireflies ?? 0,
          activeSpecies: iSim?.stats.activeSpecies ?? [],
          drawCalls: 3,
        },
        crickets,
        drawCallsTotal: 4, // 1 bird + 3 insect = 4 total draw calls
      }
    },
  }

  window.__worldDev = Object.assign(window.__worldDev ?? {}, api)

  return () => {
    if (window.__worldDev) {
      delete window.__worldDev.forceBirds
      delete window.__worldDev.lifeStats
    }
  }
}
