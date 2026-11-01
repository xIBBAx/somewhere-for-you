import { useFrame } from "@react-three/fiber"
import { useEffect, useRef, useState } from "react"
import { avatarRT } from "../../../game/runtime"
import { registerDevTool } from "../../../dev/devTools"
import { loadHighvaleVegetation } from "../../render/vegetationLibrary"
import { loadHighvaleMaps, highvaleMaps } from "../highvaleData"
import { HIGHVALE_CENTER, toWorld } from "../highvaleLayout"
import { HighvaleRange } from "./HighvaleRange"
import { HighvaleRiver } from "./HighvaleRiver"
import { HighvaleVillage } from "./HighvaleVillage"
import { HIGHVALE_MEADOW, HIGHVALE_SQUARE } from "../highvale.layout"

/**
 * Highvale in the world (world/highvale): its maps and trees arrive in the
 * background once the game has settled (or at once when the player heads
 * that way), and then its renderers mount.
 */
const SETTLE_MS = 12_000
/** Start at once within this distance (m) of the valley, or high in the sky. */
const NEAR = 14_000

export const startHighvale = (): Promise<boolean> =>
  Promise.all([loadHighvaleMaps(), loadHighvaleVegetation()]).then(([maps]) => maps !== null, (error) => {
    console.warn("[highvale] the valley could not load", error)
    return false
  })

export const HighvaleRoot = (): React.ReactElement | null => {
  const [ready, setReady] = useState(!!highvaleMaps.data)
  const started = useRef(false)
  useEffect(() => {
    let live = true
    const go = (): void => { void startHighvale().then((ok) => { if (live && ok) setReady(true) }) }
    const timer = window.setTimeout(go, SETTLE_MS)
    registerDevTool("highvale", ((place: "square" | "meadow" = "square") => {
      const spot = place === "meadow" ? HIGHVALE_MEADOW : HIGHVALE_SQUARE
      const [x, z] = toWorld(spot.e, spot.n)
      return startHighvale().then(() => {
        const dev = (window as unknown as { __worldDev: { goto: (x: number, z: number) => unknown } }).__worldDev
        return dev.goto(x, z)
      })
    }) as never)
    return () => { live = false; window.clearTimeout(timer) }
  }, [])
  useFrame(() => {
    if (ready || started.current) return
    const p = avatarRT().pos
    if (Math.hypot(p.x - HIGHVALE_CENTER.x, p.z - HIGHVALE_CENTER.z) < NEAR || p.y > 220) {
      started.current = true
      void startHighvale().then((ok) => ok && setReady(true))
    }
  })
  if (!ready) return null
  return (
    <group name="highvale">
      <HighvaleRange />
      <HighvaleRiver />
      <HighvaleVillage />
    </group>
  )
}
