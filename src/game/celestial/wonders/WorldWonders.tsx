import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { useDiscoveries } from "../../../state/discoveryStore"
import { useGame } from "../../../state/gameStore"
import { ridingCelestial } from "../CelestialController"
import { travelling } from "../cosmicTravel"
import { mountUniverse } from "../starSail"
import { spaceRT } from "../spaceState"
import { createStarMantas } from "./starMantas"
import { createWishingLights } from "./wishingLights"
import { constellationDone, gatheredCount, gatherWish, wishDone } from "./wishes"
import { chime, fanfare } from "./wonderSound"
import { createWorldMoments } from "./worldMoments"
import { approachRadii, makeSite, WORDS, wonderFor, type WonderSite, type WonderTick } from "./wonderWorlds"

/**
 * Starborn's wonders at the worlds (see wonders/). Only the world she has come
 * to is active: when she arrives beside one (within its approach ring and
 * near stopped, whether by a corridor, the autopilot or her own hand), its
 * wishing lights, creatures and moments are laid out round where she is, and
 * a hint says what there is to find. Nothing is drawn or simulated for the
 * other worlds, and the site is put away again once she has sailed well off.
 */

type State = {
  site: WonderSite | null
  mount: THREE.Vector3
  prev: THREE.Vector3
  hasPrev: boolean
  calm: boolean
  lights: ReturnType<typeof createWishingLights>
  mantas: ReturnType<typeof createStarMantas>
  moments: ReturnType<typeof createWorldMoments>
  root: THREE.Group
  tick: WonderTick
}

const hint = (text: string): void => useGame.getState().showHint(text)
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
const reducedMotion = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null

/** A light was flown through: remember it, and say so (or finish the constellation). */
const onGathered = (s: WonderSite, i: number): void => {
  const n = s.world.lights
  const r = gatherWish(s.world.id, i, n)
  const got = gatheredCount(s.world.id)
  if (r.complete) {
    fanfare(s.world)
    useDiscoveries.getState().showToast({
      title: `${s.body.def.name}: constellation complete`,
      line: `All ${WORDS[n]} wishing lights are gathered. They keep glowing when you visit ${s.body.def.name} again.`,
      kind: "sky",
    })
    hint(`The ${s.body.def.name} constellation is whole.`)
  } else if (r.fresh) {
    hint(`Light ${got} of ${n} gathered.`)
  }
}

/** Starborn has come to rest beside a world: say what is here. */
const arrived = (s: WonderSite): void => {
  const n = s.world.lights
  const got = gatheredCount(s.world.id)
  if (constellationDone(s.world.id)) {
    hint(`The ${s.body.def.name} constellation is whole, and its lights still glow. ${s.world.line}`)
    return
  }
  const lead = got > 0 ? `${got} of ${n} wishing lights gathered; fly through the rest.` : `${cap(WORDS[n])} wishing lights drift ahead: fly through them.`
  hint(`${lead} ${s.world.line}`)
}

export const WorldWonders = (): React.ReactElement => {
  const st: State = useMemo(() => {
    const root = new THREE.Group()
    root.name = "world-wonders"
    const calm = reducedMotion?.matches ?? false
    const lights = createWishingLights(onGathered)
    const mantas = createStarMantas()
    const moments = createWorldMoments((freq, pan) => chime(freq, pan, 0.02, 0.7))
    root.add(lights.root, mantas.root, moments.root)
    const mount = new THREE.Vector3(), prev = new THREE.Vector3()
    const tick: WonderTick = { dt: 0, time: 0, calm, halfH: 540, mount, prev, speed: 0 }
    return { site: null, mount, prev, hasPrev: false, calm, lights, mantas, moments, root, tick }
  }, [])

  useEffect(() => () => {
    st.lights.dispose()
    st.mantas.dispose()
    st.moments.dispose()
  }, [st])

  const setSite = (s: WonderSite | null): void => {
    st.site = s
    st.lights.bind(s)
    st.mantas.bind(s)
    st.moments.bind(s)
    // Stable debug readback for checking real arrival-frame placement and
    // musical encounters without duplicating the universe module in QA.
    st.root.userData.site = s ? { world: s.world.id, at: s.at.toArray(), right: s.right.toArray(), up: s.up.toArray(), fwd: s.fwd.toArray() } : null
    if (s) arrived(s)
  }

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const h = ridingCelestial()
    if (!h || travelling()) {
      if (st.site) setSite(null)
      st.hasPrev = false
      return
    }
    mountUniverse(h, st.mount)
    if (!st.hasPrev) st.prev.copy(st.mount)
    const speed = dt > 0 ? st.mount.distanceTo(st.prev) / dt : 0
    const near = spaceRT.nearest

    if (!st.site) {
      // a world she has come to: near its approach ring and almost stopped (never mid-corridor)
      const w = near ? wonderFor(near.def.id) : null
      if (near && w && !travelling() && speed < 30) {
        const d = st.mount.distanceTo(near.pos)
        const stand = near.radius * approachRadii(near.def)
        if (d < stand * 1.4 && d > near.radius * 1.05) {
          const gathered = (i: number): boolean => wishDone(w.id, i)
          setSite(makeSite(w, near, st.mount, gathered))
        }
      }
    } else {
      // well off, or on to another world: put this one away until she comes back
      const s = st.site
      if (near !== s.body || st.mount.distanceTo(s.body.pos) > s.stand * 4) setSite(null)
    }

    const tick = st.tick
    st.calm = reducedMotion?.matches ?? false
    tick.calm = st.calm
    tick.dt = dt
    tick.time = state.clock.elapsedTime
    tick.halfH = state.size.height / 2
    tick.speed = speed
    st.lights.update(tick)
    st.mantas.update(tick)
    st.moments.update(tick)
    st.prev.copy(st.mount)
    st.hasPrev = true
  })

  return <primitive object={st.root} />
}
