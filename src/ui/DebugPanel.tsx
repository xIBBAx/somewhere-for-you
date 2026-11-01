import { debugEnabled } from "../dev/debugFlag"
import { useCallback, useEffect, useState } from "react"
import { gpuLabel } from "../game/render/gpuInfo"
import { useGame } from "../state/gameStore"
import { MEMORIES, FINALE_STOP } from "../content/memories"
import { avatarRT, cameraRT, catRT, characterRT, companionRT, input, playerRT, worldRT, resetRuntime, selectAvatar } from "../game/runtime"
import { companionMotionRT } from "../game/characters/CompanionCharacter"
import { getAudioDiagnostics, setAmbient, sfx } from "../game/audio/audio"
import { getEffectiveWeather, setWeatherOverride, weatherRT } from "../game/weather/weatherState"
import type { WeatherOverride } from "../game/weather/weatherTypes"
import { animalEcosystemRT } from "../game/animals/ecosystem"
import { worldStreamRT } from "../world/worldRuntime"
import { scatterStats } from "../world/render/WorldScatter"
import { originRT } from "../world/origin"
import { windRT } from "../world/wind"
import { discoveriesNear, discoveryRT } from "../world/discoveries"
import { wildlifeRT, wildlifeStats } from "../world/wildlife/runtime"
import { explorerMotionRT } from "../game/characters/ExplorerCharacter"

const isDebug = (): boolean => debugEnabled()

const COLLAPSE_KEY = "gift-world:debug-panel-collapsed"

const createRawDebugApi = () => ({
  playerRT,
  companionRT,
  companionMotionRT,
  characterRT,
  avatarRT,
  input,
  resetRuntime,
  game: useGame,
  setWeatherOverride,
  catRT,
  cameraRT,
  worldRT,
  weatherRT,
  animalEcosystemRT,
  audioDiagnostics: getAudioDiagnostics,
  worldStreamRT,
  scatterStats,
  originRT,
  windRT,
  discoveryRT,
  wildlifeRT,
  wildlifeStats,
  discoveriesNear: (x: number, z: number, r: number) => discoveriesNear(x, z, r, r, []),
  explorerMotionRT,
})

/** The browser-test contract is inferred from the object actually exposed. */
export type WorldRawApi = ReturnType<typeof createRawDebugApi>

interface DebugWindow {
  __world?: {
    teleport: (id: string) => void
    teleportTo: (x: number, z: number) => void
    unlockAll: () => void
    jumpToFinale: () => void
    catFenceTest: () => void
    catJumpTest: () => void
    animalThreatTest: () => void
    animalForceDecision: () => void
    airplane: () => void
    aircraft?: (type?: string) => void
    reset: () => void
  }
  __worldRaw?: WorldRawApi
}

/**
 * ?debug=1 — coordinates, FPS, teleports, unlock-all, finale jump, reset.
 * Hidden unless explicitly requested; also exposes window.__world for
 * Playwright and for personalization testing.
 */
export const DebugPanel = ({ visible = true }: { visible?: boolean }): React.ReactElement | null => {
  const [show] = useState(isDebug)
  const [frameRate, setFrameRate] = useState("measuring fps")
  const [pos, setPos] = useState("0, 0")
  const [weatherLine, setWeatherLine] = useState("reading weather")
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.sessionStorage.getItem(COLLAPSE_KEY) === "1"
    } catch {
      return false
    }
  })
  useEffect(() => {
    const onWheel = (event: WheelEvent): void => {
      // The camera zooms on canvas wheel events; stop it hijacking the panel.
      if (event.target instanceof Element && event.target.closest(".debug-panel") !== null) {
        event.stopPropagation()
      }
    }
    window.addEventListener("wheel", onWheel, { capture: true, passive: true })
    return () => window.removeEventListener("wheel", onWheel, { capture: true })
  }, [])

  const toggleCollapsed = useCallback((): void => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        window.sessionStorage.setItem(COLLAPSE_KEY, next ? "1" : "0")
      } catch {
        // private mode — collapse stays session-only
      }
      return next
    })
  }, [])

  useEffect(() => {
    if (!show || !visible) return
    const iv = window.setInterval(() => {
      const w = getEffectiveWeather()
      setPos(
        `${avatarRT().pos.x.toFixed(1)}, ${avatarRT().pos.z.toFixed(1)} · ${characterRT.active} · ` +
          `cam ${cameraRT.yaw.toFixed(2)} / ${cameraRT.distance.toFixed(1)} · ` +
          `cat ${catRT.state}/${catRT.navMode} ${catRT.navIndex}:${catRT.navPath.length} · ` +
          `tod ${worldRT.timeOfDay.toFixed(2)} · ` +
          `weather ${weatherRT.status}/${w.condition} ${w.temperatureC ?? "?"}°C cloud ${Math.round(weatherRT.cloud * 100)}% rain ${weatherRT.rain.toFixed(2)} wind ${Math.round((weatherRT.wind + weatherRT.gust) * 100)}%`,
      )
      const render = window.__worldRenderInfo?.()
      const gpu = render ? ` · ${gpuLabel(render.gpu)}${render.softwareGpu ? ": no GPU!" : ""}` : ""
      setFrameRate((render?.captureStepping ? "capture mode" : `${(render?.fps ?? 0).toFixed(1)} fps`) + gpu)
      setWeatherLine(
        `${w.source} · ${w.condition} · ${w.temperatureC ?? "?"}°C feels ${w.apparentTemperatureC ?? "?"}°C · ` +
          `cloud ${w.cloudCover}% · wind ${w.windSpeed.toFixed(1)} · ${w.locationLabel ?? ""}`,
      )
    }, 300)
    return () => clearInterval(iv)
  }, [show, visible])

  useEffect(() => {
    if (!isDebug()) return
    ;(window as DebugWindow).__worldRaw = createRawDebugApi()
    const api: NonNullable<DebugWindow["__world"]> = {
      teleport: (id: string) => {
        const m = MEMORIES.find((x) => x.id === id)
        if (!m) return
        resetRuntime({ x: m.worldPosition[0] + 0.8, z: m.worldPosition[2] + 1.2 })
      },
      unlockAll: () => useGame.getState().unlockAll(),
      teleportTo: (x: number, z: number) => resetRuntime({ x, z }),
      jumpToFinale: () => {
        selectAvatar("explorer")
        useGame.getState().unlockAll()
        // just past the gate so the finale trigger fires
        resetRuntime({ x: 0, z: -27.6 })
      },
      catFenceTest: () => {
        resetRuntime({ x: 12.4, z: -1.4 })
        catRT.pos.set(16.8, 0, -1.4)
        catRT.affectionTarget.set(12.4, 0, -1.4)
        catRT.poi = catRT.affectionTarget
        catRT.poiKind = "nav-qa"
        catRT.state = "investigate"
      },
      catJumpTest: () => {
        resetRuntime({ x: 11.8, z: -1.6 })
        catRT.pos.set(9.4, 0, 0)
        catRT.affectionTarget.set(11.8, 0, 0)
        catRT.poi = catRT.affectionTarget
        catRT.poiKind = "jump-qa"
        catRT.state = "investigate"
      },
      animalThreatTest: () => {
        const rabbit = Array.from(animalEcosystemRT.agents.values()).find(
          (animal) => animal.species === "rabbit",
        )
        if (!rabbit) return
        resetRuntime({ x: rabbit.position.x - 4.2, z: rabbit.position.z + 0.8 })
        catRT.pos.set(rabbit.position.x - 1.25, rabbit.position.y, rabbit.position.z)
        catRT.poi = rabbit.position.clone()
        catRT.poiKind = "autonomy-chase"
        catRT.state = "crouch"
        catRT.stateTime = 0
        animalEcosystemRT.forceDecision(rabbit.id)
      },
      animalForceDecision: () => animalEcosystemRT.forceDecision(),
      // air traffic is switched off in SkyLife, so these requests are ignored
      airplane: () => {
        worldRT.airplaneRequested = true
        worldRT.aircraftRequestedType = "commercial_jet"
      },
      aircraft: (type?: string) => {
        worldRT.airplaneRequested = true
        worldRT.aircraftRequestedType = type ?? null
      },
      reset: () => {
        useGame.getState().resetProgress()
        window.location.reload()
      },
    }
    ;(window as DebugWindow).__world = api
    return () => {
      delete (window as DebugWindow).__world
    }
  }, [show])

  if (!show || !visible) return null

  return (
    <div className="debug-panel" data-collapsed={collapsed ? "true" : "false"}>
      <div className="debug-panel-head">
        <h3>debug · {frameRate}</h3>
        <button
          className="debug-panel-toggle"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand debug panel" : "Collapse debug panel"}
        >
          {collapsed ? "+" : "–"}
        </button>
      </div>
      {!collapsed && (
        <div className="debug-panel-body">
          <div className="debug-panel-content">
            <div className="debug-panel-pos">{pos}</div>

            <div className="debug-panel-label">memories</div>
            {MEMORIES.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  ;(window as DebugWindow).__world?.teleport(m.id)
                  sfx.pop()
                }}
              >
                → {m.title}
              </button>
            ))}
            <button onClick={() => (window as DebugWindow).__world?.jumpToFinale()}>
              → finale ({FINALE_STOP.id})
            </button>

            <div className="debug-panel-label">actions</div>
            <button onClick={() => (window as DebugWindow).__world?.unlockAll()}>unlock all</button>
            <button onClick={() => (window as DebugWindow).__world?.catFenceTest()}>cat nav · fence</button>
            <button onClick={() => (window as DebugWindow).__world?.catJumpTest()}>cat nav · jump</button>
            <button onClick={() => (window as DebugWindow).__world?.animalThreatTest()}>animals · threat</button>
            <button onClick={() => (window as DebugWindow).__world?.animalForceDecision()}>animals · decide</button>
            <button onClick={() => (window as DebugWindow).__world?.airplane()}>sky · airplane</button>
            <button
              onClick={() => {
                ;(window as DebugWindow).__world?.reset()
                setAmbient(false)
              }}
            >
              reset progress
            </button>

            <div className="debug-panel-label">weather override</div>
            <div className="debug-panel-weather">
              {(["clear", "hot", "cloudy", "rain", "heavy-rain", "thunderstorm", "cloudburst", "wind", null] as Array<
                WeatherOverride | null
              >).map((preset) => (
                <button
                  key={String(preset)}
                  className={weatherRT.override === preset ? "on" : undefined}
                  onClick={() => setWeatherOverride(preset)}
                >
                  {preset ?? "live"}
                </button>
              ))}
            </div>
            <div className="debug-panel-weather-detail">{weatherLine}</div>
          </div>
        </div>
      )}
    </div>
  )
}
