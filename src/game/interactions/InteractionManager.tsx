import { useEffect, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"
import { useGame } from "../../state/gameStore"
import { finaleReady } from "../../state/storyProgress"
import { MEMORIES, FINALE_STOP } from "../../content/memories"
import { SECRETS } from "../../content/secrets"
import { story } from "../../content/story"
import { avatarRT, characterRT, input, catRT, playerRT, worldRT, type AvatarBody } from "../runtime"
import { sfx } from "../audio/audio"
import { spawnBurst } from "../particles/sparkles"
import { discoveryRT } from "../../world/discoveries"
import { prefetchPhoto } from "../../ui/photoSources"

/**
 * Per-frame proximity + interaction orchestration:
 * detect → hint → interact → world performs → card opens → resume.
 */
export const InteractionManager = (): null => {
  const performing = useRef(false)
  const pausedBody = useRef<AvatarBody | null>(null)

  useEffect(() => {
    const unsub = useGame.subscribe((state, prev) => {
      // card just closed → release the player, celebrate the star
      if (prev.activeMemoryId && !state.activeMemoryId) {
        const body = pausedBody.current ?? avatarRT()
        performing.current = false
        worldRT.performingMemoryId = null
        worldRT.performanceTime = 0
        body.paused = false
        pausedBody.current = null
        worldRT.focus.active = false
        const id = prev.activeMemoryId
        const m = MEMORIES.find((x) => x.id === id)
        if (m) {
          // the stop's wisp streams into her (wisps/MemoryWisp.tsx); she reacts as it arrives
          sfx.sparkle()
          body.celebrate = 1.4
        }
      }
      if (prev.activeSecretId && !state.activeSecretId) {
        ;(pausedBody.current ?? avatarRT()).paused = false
        pausedBody.current = null
        const id = prev.activeSecretId
        const s = SECRETS.find((x) => x.id === id)
        if (s) {
          spawnBurst(new THREE.Vector3(s.trailEnd[0], 1, s.trailEnd[1]), 16, "#cfa9e8")
          sfx.sparkle()
        }
      }
    })
    return unsub
  }, [])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    const current = useGame.getState()
    const body = avatarRT()
    if (!current.started || worldRT.introActive) return
    if (input.cancel) {
      input.cancel = false
      if (current.activeMemoryId) current.closeMemory()
      else if (current.activeSecretId) current.closeSecret()
    }
    // A debug reset or a new journey cancels a pending performance.
    if (performing.current && worldRT.performingMemoryId === null) {
      performing.current = false
    }
    // Advance on the same simulation clock as landmark animation, so a slow
    // frame or background tab cannot show the card before the scene performs.
    if (performing.current && !current.activeMemoryId) {
      worldRT.performanceTime += dt
      const memory = MEMORIES.find(m => m.id === worldRT.performingMemoryId)
      if (memory && worldRT.performanceTime >= (memory.performDelay ?? 1.2)) current.openMemory(memory.id)
    }
    if (worldRT.finaleActive) {
      worldRT.nearMemoryId = null
      return
    }

    // nearest memory within its radius
    let nearId: string | null = null
    let bestD = Infinity
    for (const m of MEMORIES) {
      const d = Math.hypot(body.pos.x - m.worldPosition[0], body.pos.z - m.worldPosition[2])
      if (d < 14) prefetchPhoto(m.photos?.[0])
      if (d < m.radius && d < bestD) {
        bestD = d
        nearId = m.id
      }
    }
    worldRT.nearMemoryId = nearId

    // nearest unfound secret start
    let nearSecret: string | null = null
    for (const s of SECRETS) {
      if (useGame.getState().secrets.includes(s.id)) continue
      const d = Math.hypot(body.pos.x - s.trailStart[0], body.pos.z - s.trailStart[1])
      if (d < 3.2) {
        nearSecret = s.id
        prefetchPhoto(s.photo)
      }
    }
    if (nearSecret !== worldRT.nearSecretId) {
      worldRT.nearSecretId = nearSecret
      if (nearSecret && characterRT.active === catRT.owner) {
        const s = SECRETS.find((x) => x.id === nearSecret)
        if (s) {
          catRT.poi = new THREE.Vector3(s.trailEnd[0], 0, s.trailEnd[1])
          catRT.poiKind = "secret"
        }
      }
    }

    // Trail ends are several metres beyond their discovery radii. Pickup must
    // remain possible after the explorer has followed the cat away from the start.
    if (!current.activeMemoryId && !current.activeSecretId && !performing.current) {
      const s = SECRETS.find(s => !current.secrets.includes(s.id) &&
        Math.hypot(body.pos.x - s.trailEnd[0], body.pos.z - s.trailEnd[1]) < 1.3)
      if (s) {
        body.paused = true
        pausedBody.current = body
        current.openSecret(s.id)
        sfx.chime()
      }
    }

    // interact → begin performance. A memory she has already kept steps aside
    // when a ride is offered here: the prompt on screen says "ride", so E rides.
    const yieldToRide = !!nearId && !!discoveryRT.horsePrompt && !!current.visited[nearId]
    if (input.interact && !yieldToRide) {
      input.interact = false
      const st = useGame.getState()
      if (!st.activeMemoryId && !st.activeSecretId && !performing.current && nearId) {
        const m = MEMORIES.find((x) => x.id === nearId)
        if (m) {
          performing.current = true
          worldRT.performingMemoryId = m.id
          worldRT.performanceTime = 0
          body.paused = true
          pausedBody.current = body
          worldRT.focus.active = true
          worldRT.focus.x = m.worldPosition[0]
          worldRT.focus.z = m.worldPosition[2]
          worldRT.focus.yaw = m.id === "training-corner" ? 1.15 : null
          worldRT.focus.pitch = m.id === "training-corner" ? 0.44 : null
          worldRT.focus.distance = m.id === "training-corner" ? 7.8 : null
          // the cat investigates first
          if (characterRT.active === catRT.owner) {
            catRT.poi = new THREE.Vector3(m.worldPosition[0] + 0.9, 0, m.worldPosition[2] + 0.9)
            catRT.poiKind = "memory"
          }
          sfx.chime()
        }
      }
    }
    input.cancel = false
  })

  return null
}

/** Gate + finale entry check, run every frame. */
export const FinaleGate = (): null => {
  const hintCooldown = useRef(0)
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    hintCooldown.current -= dt
    if (characterRT.active !== "explorer" || worldRT.introActive || !useGame.getState().started || worldRT.finaleActive || useGame.getState().finale === "done") return
    const crossed = playerRT.pos.z < FINALE_STOP.worldPosition[2] + 3.4 && Math.abs(playerRT.pos.x) < 3.2
    if (crossed) {
      if (finaleReady(useGame.getState())) {
        useGame.getState().setFinale("playing")
        worldRT.finaleActive = true
        worldRT.finalePhase = 0
        worldRT.finaleTime = 0
        playerRT.paused = true
        // cat runs ahead — the finale director takes it from here
        catRT.poi = new THREE.Vector3(0, 0, -30.5)
        catRT.poiKind = "finale"
      } else if (hintCooldown.current <= 0) {
        hintCooldown.current = 4
        spawnBurst(new THREE.Vector3(playerRT.pos.x, 1.4, playerRT.pos.z - 1), 6, "#cbb4a0")
        useGame.getState().showHint(story.gateLockedHint)
      }
    }
  })
  return null
}
