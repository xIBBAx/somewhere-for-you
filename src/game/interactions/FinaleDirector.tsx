import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { useGame } from "../../state/gameStore"
import { smoothstep } from "../../utils/math"
import { catRT, characterRT, companionRT, playerRT, worldRT } from "../runtime"
import { sfx } from "../audio/audio"
import { buildColliders, groundHeight } from "../world-layout"
import { resolveCollisions } from "../movement"
import { explorationTimeTarget, isMorning } from "../timeOfDay"
import { makeRng } from "../../utils/math"
import { softStarTexture } from "../../utils/canvasTexture"
import { getCompanionVisibility, COMPANION_REVEAL_START, COMPANION_REVEAL_END } from "./companionVisibility"
import { weatherTimeContext } from "../weather/weatherState"
import { gardenBloom } from "../vfx/signatures"
import { names } from "../../personalization"

const GARDEN = { x: 0, z: -30.5 }
const STAR_COUNT = 46
const FINALE_COLLIDERS = buildColliders()
const HUMAN_RADIUS = 0.38
const tmpCompanion = { x: 0, z: 0 }

/**
 * The garden finale:
 * twilight deepens → cat runs ahead → lanterns light one by one →
 * The companion walks in and waves → collected stars rise into a heart constellation →
 * final message → the companion walks over → closing line → gentle free roam.
 */
export const FinaleDirector = (): React.ReactElement => {
  const stars = useRef<THREE.Points>(null)
  const initialised = useRef(false)
  const messageShown = useRef(false)
  const closingShown = useRef(false)
  const doneInitialised = useRef(false)
  const walkStart = useRef(0)

  // constellation targets: heart curve above the garden
  const { startPositions, endPositions, geo } = useMemo(() => {
    const starts = new Float32Array(STAR_COUNT * 3)
    const ends = new Float32Array(STAR_COUNT * 3)
    const current = new Float32Array(STAR_COUNT * 3)
    const rng = makeRng(270826)
    for (let i = 0; i < STAR_COUNT; i++) {
      const t = (i / STAR_COUNT) * Math.PI * 2
      const hx = 16 * Math.pow(Math.sin(t), 3)
      const hy =
        13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
      ends[i * 3] = GARDEN.x + hx * 0.1 + (rng() - 0.5) * 0.08
      ends[i * 3 + 1] = 4.6 + hy * 0.1 + (rng() - 0.5) * 0.08
      ends[i * 3 + 2] = GARDEN.z + (rng() - 0.5) * 0.08
      starts[i * 3] = 0.4 + (rng() - 0.5) * 2
      starts[i * 3 + 1] = 0.8 + rng() * 0.6
      starts[i * 3 + 2] = -29.5 + (rng() - 0.5) * 2
    }
    current.set(starts)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute("position", new THREE.BufferAttribute(current, 3))
    return { startPositions: starts, endPositions: ends, geo }
  }, [])
  const starMap = useMemo(() => softStarTexture(), [])

  const starMat = useMemo(
    () =>
      new THREE.PointsMaterial({
        color: "#ffe9b8",
        size: 0.3,
        map: starMap,
        alphaTest: 0.02,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    [starMap],
  )
  useEffect(() => () => { geo.dispose(); starMat.dispose() }, [geo, starMat])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.22)
    const status = useGame.getState().finale
    if (status !== "playing" && status !== "done") {
      initialised.current = messageShown.current = closingShown.current = doneInitialised.current = false
      starMat.opacity = 0
      return
    }
    if (status === "done") {
      // Keep the ending tableau, while ordinary movement and time-of-day regain
      // ownership. Re-entering this choreography used to zero walking velocity.
      if (!doneInitialised.current) {
        doneInitialised.current = true
        const attr = geo.attributes.position as THREE.BufferAttribute
        attr.copyArray(endPositions)
        attr.needsUpdate = true
        starMat.opacity = 0.95
        if (!characterRT.companionPresent) {
          companionRT.pos.set(GARDEN.x + 0.2, groundHeight(GARDEN.x + 0.2, GARDEN.z), GARDEN.z)
          companionRT.revision++
          characterRT.companionPresent = true
        }
        characterRT.companionScale = 1
        characterRT.finaleWave = 0
      }
      return
    }
    if (!initialised.current) {
      initialised.current = true
      companionRT.pos.set(GARDEN.x + 0.2, groundHeight(GARDEN.x + 0.2, GARDEN.z), GARDEN.z)
      companionRT.vel.set(0, 0, 0)
      companionRT.facing = Math.PI * 0.9
      companionRT.revision++
    }

    // choreography runs on wall-clock time so pacing stays right even if
    // physics dt is clamped on slow frames
    worldRT.finaleTime += Math.min(rawDt, 0.5)
    const t = worldRT.finaleTime

    // twilight deepens
    worldRT.timeOfDayTarget = Math.min(1, worldRT.timeOfDayTarget + dt * 0.08)
    worldRT.morningTarget = 0

    // phases
    if (t > 1.4) worldRT.finalePhase = Math.max(worldRT.finalePhase, 1) // lanterns
    if (t > 4.2) worldRT.finalePhase = Math.max(worldRT.finalePhase, 3) // companion + arch
    if (t > 5.2) worldRT.finalePhase = Math.max(worldRT.finalePhase, 4) // stars rise

    // lantern chimes
    for (let i = 0; i < 7; i++) {
      const lt = 1.4 + i * 0.38
      if (t - dt < lt && t >= lt) sfx.sparkle()
    }

    // The explorer walks herself into the garden during the opening of the sequence
    // — physics matters: never clip through garden furniture or fence.
    if (t < 6.5) {
      const target = new THREE.Vector3(0.9, 0, -30.1)
      const dx = target.x - playerRT.pos.x
      const dz = target.z - playerRT.pos.z
      const d = Math.hypot(dx, dz)
      if (d > 0.25) {
        const spd = Math.min(1.7, d * 1.4)
        playerRT.vel.set((dx / d) * spd, 0, (dz / d) * spd)
        const next = { x: playerRT.pos.x + playerRT.vel.x * dt, z: playerRT.pos.z + playerRT.vel.z * dt }
        resolveCollisions(next, HUMAN_RADIUS, FINALE_COLLIDERS.circles, FINALE_COLLIDERS.rects)
        // also keep a little person-to-person distance if the companion already visible
        if (characterRT.companionPresent) {
          const dxI = next.x - companionRT.pos.x
          const dzI = next.z - companionRT.pos.z
          const distI = Math.hypot(dxI, dzI)
          if (distI < 0.75 && distI > 1e-4) {
            const push = (0.75 - distI) / distI
            next.x += dxI * push * 0.6
            next.z += dzI * push * 0.6
            resolveCollisions(next, HUMAN_RADIUS, FINALE_COLLIDERS.circles, FINALE_COLLIDERS.rects)
          }
        }
        playerRT.vel.x = (next.x - playerRT.pos.x) / dt
        playerRT.vel.z = (next.z - playerRT.pos.z) / dt
        playerRT.pos.x = next.x
        playerRT.pos.z = next.z
        playerRT.pos.y = groundHeight(playerRT.pos.x, playerRT.pos.z)
        playerRT.facing = Math.atan2(dx, dz)
      } else {
        playerRT.vel.set(0, 0, 0)
      }
    } else {
      playerRT.vel.set(0, 0, 0)
    }

    // camera keyframes
    if (t < 5.2) {
      const k = smoothstep(0, 5.2, t)
      worldRT.finaleCam = {
        px: THREE.MathUtils.lerp(-4.8, 9.4, k),
        py: THREE.MathUtils.lerp(7.8, 5.8, k),
        pz: THREE.MathUtils.lerp(-21.0, -33.8, k),
        tx: 0,
        ty: THREE.MathUtils.lerp(1.6, 2.15, k),
        tz: THREE.MathUtils.lerp(-27.0, -30.4, k),
      }
    } else if (t < 12) {
      // Once inside, the entrance becomes a backdrop instead of an obstruction.
      worldRT.finaleCam = { px: 9.4, py: 5.8, pz: -33.8, tx: 0, ty: 2.15, tz: -30.4 }
    } else {
      // settle into the final composition: 3/4 view of the two of them
      worldRT.finaleCam = { px: 7.2, py: 4.25, pz: -32.5, tx: 0.2, ty: 1.55, tz: -30.3 }
    }

    // stars rise into the heart
    const rise = smoothstep(5.2, 9.2, t)
    if (stars.current) {
      starMat.opacity = rise * 0.95
      const attr = stars.current.geometry.attributes.position as THREE.BufferAttribute
      const arr = attr.array as Float32Array
      for (let i = 0; i < STAR_COUNT; i++) {
        const stagger = smoothstep(0, 1, Math.min(1, Math.max(0, rise * 1.35 - (i / STAR_COUNT) * 0.35)))
        arr[i * 3] = THREE.MathUtils.lerp(startPositions[i * 3], endPositions[i * 3], stagger)
        arr[i * 3 + 1] = THREE.MathUtils.lerp(
          startPositions[i * 3 + 1],
          endPositions[i * 3 + 1],
          stagger,
        )
        arr[i * 3 + 2] = THREE.MathUtils.lerp(startPositions[i * 3 + 2], endPositions[i * 3 + 2], stagger)
      }
      attr.needsUpdate = true
    }

    // The companion: revealed at 4.2s, walks to the explorer after the message closes
    {
      const presence = getCompanionVisibility(status, t)
      characterRT.companionPresent = presence.visible
      characterRT.companionScale = presence.scale
      const messageDone = messageShown.current && !useGame.getState().activeMemoryId && closingShown.current
      if (messageDone) {
        // walk to her side — physically, never through benches or cake table.
        const walkT = smoothstep(0, 2.4, t - walkStart.current)
        const rawTx = THREE.MathUtils.lerp(GARDEN.x + 0.2, playerRT.pos.x + 0.9, walkT)
        const rawTz = THREE.MathUtils.lerp(GARDEN.z, playerRT.pos.z + 0.2, walkT)
        tmpCompanion.x = rawTx
        tmpCompanion.z = rawTz
        resolveCollisions(tmpCompanion, HUMAN_RADIUS, FINALE_COLLIDERS.circles, FINALE_COLLIDERS.rects)
        // keep distance from the explorer herself — no intersecting planes
        const dxM = tmpCompanion.x - playerRT.pos.x
        const dzM = tmpCompanion.z - playerRT.pos.z
        const distM = Math.hypot(dxM, dzM)
        if (distM < 0.78 && distM > 1e-4) {
          const push = (0.78 - distM) / distM
          tmpCompanion.x += dxM * push
          tmpCompanion.z += dzM * push
          resolveCollisions(tmpCompanion, HUMAN_RADIUS, FINALE_COLLIDERS.circles, FINALE_COLLIDERS.rects)
        }
        companionRT.vel.set((tmpCompanion.x - companionRT.pos.x) / dt, 0, (tmpCompanion.z - companionRT.pos.z) / dt)
        companionRT.pos.set(tmpCompanion.x, groundHeight(tmpCompanion.x, tmpCompanion.z), tmpCompanion.z)
        if (companionRT.vel.lengthSq() > 0.01) companionRT.facing = Math.atan2(companionRT.vel.x, companionRT.vel.z)
        characterRT.finaleWave = walkT < 1 ? 1 : 0
      } else {
        const entrance = smoothstep(COMPANION_REVEAL_START, COMPANION_REVEAL_END, t)
        tmpCompanion.x = THREE.MathUtils.lerp(GARDEN.x - 1.4, GARDEN.x + 0.2, entrance)
        tmpCompanion.z = THREE.MathUtils.lerp(GARDEN.z - 3.1, GARDEN.z, entrance)
        resolveCollisions(tmpCompanion, HUMAN_RADIUS, FINALE_COLLIDERS.circles, FINALE_COLLIDERS.rects)
        companionRT.vel.set(presence.visible ? (tmpCompanion.x - companionRT.pos.x) / dt : 0, 0,
          presence.visible ? (tmpCompanion.z - companionRT.pos.z) / dt : 0)
        companionRT.pos.set(tmpCompanion.x, groundHeight(tmpCompanion.x, tmpCompanion.z), tmpCompanion.z)
        if (companionRT.vel.lengthSq() > 0.01) companionRT.facing = Math.atan2(companionRT.vel.x, companionRT.vel.z)
        else if (presence.visible) companionRT.facing = Math.atan2(playerRT.pos.x - companionRT.pos.x, playerRT.pos.z - companionRT.pos.z)
        characterRT.finaleWave = presence.visible ? 0.45 : 0
      }
    }

    // message trigger (the DOM overlay reads finaleMessage from the store)
    if (t > 9.6 && !messageShown.current) {
      messageShown.current = true
      useGame.getState().setFinaleMessage(true)
      sfx.chime()
    }

    if (t > 9.6 && worldRT.finalePhase < 5) worldRT.finalePhase = 5

    // after the message is dismissed, the companion walks over, then free roam
    if (messageShown.current && !useGame.getState().finaleMessage && !closingShown.current) {
      closingShown.current = true
      walkStart.current = worldRT.finaleTime
    }
    if (closingShown.current && t - walkStart.current >= 2.6) {
      useGame.getState().setFinale("done")
      playerRT.paused = false
      worldRT.finaleActive = false
      companionRT.vel.set(0, 0, 0)
      characterRT.finaleWave = 0
      const state = useGame.getState()
      state.showHint(`Explore together · switch between ${names.explorer} and ${names.companion} whenever you like.`)
      worldRT.timeOfDayTarget = explorationTimeTarget(state.timeMode, weatherTimeContext())
      worldRT.morningTarget = isMorning(state.timeMode, weatherTimeContext()) ? 1 : 0
      gardenBloom(new THREE.Vector3(GARDEN.x, 1.5, GARDEN.z), groundHeight(GARDEN.x, GARDEN.z))
    }

    // the cat sits between them once everyone is in place
    if (closingShown.current && catRT.state !== "sit") {
      catRT.poi = null
      catRT.state = "sit"
    }
  }, -30)

  return <points ref={stars} geometry={geo} material={starMat} frustumCulled={false} />
}
