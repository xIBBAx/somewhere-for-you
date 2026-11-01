import { useFrame } from "@react-three/fiber"
import { useRef } from "react"
import { useGame, type GameState } from "../../state/gameStore"
import { useExplorationUI } from "../../state/explorationUIStore"
import { companionUnlocked } from "../../state/storyProgress"
import { worldStreamRT } from "../../world/worldRuntime"
import { waterSurfaceAt } from "../../world/waterSurface"
import { resolveCollisions } from "../movement"
import { avatarRT, characterRT, clearInputActions, companionRT, input, playerRT, selectAvatar, worldRT, type CharacterId } from "../runtime"
import { buildColliders, groundHeight } from "../world-layout"
import { isRiding, riderRT, restoreRiderSeat } from "../horses/riding"
import type { HorseState } from "../horses/horseState"
import { spaceRT } from "../celestial/spaceState"
import { names } from "../../personalization"

const colliders = buildColliders()

/** Ownership and cinematic state are independent of which body is selected. */
export const canSwitchCharacter = (game: Pick<GameState, "started" | "stars" | "visitOrder" | "activeMemoryId" | "activeSecretId" | "finaleMessage" | "finale">): boolean =>
  game.started && companionUnlocked(game) && !game.activeMemoryId && !game.activeSecretId && !game.finaleMessage &&
  !worldRT.introActive && !worldRT.finaleActive && !worldRT.performingMemoryId && !characterRT.switching &&
  !worldRT.relocating && useExplorationUI.getState().panel !== "controls" &&
  !avatarRT().paused && avatarRT().gesture === "none" && (avatarRT().rideY === null || isRiding(characterRT.active))

/** Recover a safe companion position after the finale if needed. */
export const inviteCompanion = (): boolean => {
  if (characterRT.companionPresent) return true
  const p = playerRT.pos
  for (let i = 0; i < 32; i++) {
    const angle = playerRT.facing + Math.PI / 2 + (i % 8) * Math.PI / 4
    const distance = 1.5 + Math.floor(i / 8) * 0.65
    const x = p.x + Math.sin(angle) * distance
    const z = p.z + Math.cos(angle) * distance
    const spot = { x, z }
    const ground = groundHeight(x, z)
    const surface = waterSurfaceAt(x, z)
    const y = surface !== null && surface - ground > 1.25 ? surface - 1.2 : ground
    resolveCollisions(spot, 0.36, colliders.circles, colliders.rects, { feetY: y, canSwim: true })
    if (Math.hypot(spot.x - x, spot.z - z) > 0.2 || Math.hypot(spot.x - p.x, spot.z - p.z) < 0.9) continue
    if (Math.abs(ground - groundHeight(spot.x + 0.3, spot.z)) > 0.65 || Math.abs(ground - groundHeight(spot.x, spot.z + 0.3)) > 0.65) continue
    companionRT.pos.set(spot.x, y, spot.z)
    companionRT.facing = playerRT.facing
    companionRT.vel.set(0, 0, 0)
    companionRT.revision++
    characterRT.companionPresent = true
    return true
  }
  return false
}

/** Runs before the floating origin and streamer, so selection is atomic for a frame. */
export const CharacterSwitch = (): null => {
  const transition = useRef<{ target: CharacterId; elapsed: number; selected: boolean; hold: number } | null>(null)
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const pending = transition.current
    if (pending) {
      clearInputActions()
      if (!characterRT.switching) {
        transition.current = null
        characterRT.switchFade = 0
        return
      }
      pending.elapsed += dt
      if (!pending.selected) {
        characterRT.switchFade = Math.min(1, pending.elapsed / 0.16)
        if (pending.elapsed >= 0.16) {
          selectAvatar(pending.target)
          worldRT.snapCamera = true
          pending.selected = true
          pending.elapsed = 0
        }
      } else {
        const p = avatarRT().pos
        const ready = worldStreamRT.streamer?.isAreaReady(p.x, p.z, 48) ?? true
        if (!ready && pending.hold < 3) {
          pending.hold += dt
          pending.elapsed = 0
        }
        characterRT.switchFade = Math.max(0, 1 - pending.elapsed / 0.24)
        if (pending.elapsed >= 0.24) {
          characterRT.switching = false
          transition.current = null
        }
      }
      return
    }
    if (!input.switchCharacter) return
    input.switchCharacter = false
    const game = useGame.getState()
    if (!canSwitchCharacter(game)) return
    const target: CharacterId = characterRT.active === "explorer" ? "companion" : "explorer"
    if (target === "companion" && !characterRT.companionReady) {
      game.showHint(`${names.companion} is getting ready…`)
      return
    }
    if (!inviteCompanion()) {
      game.showHint("Find a little more space to switch characters.")
      return
    }
    const destination = target === "explorer" ? playerRT : companionRT
    // Both characters must share the same frame beyond Earth. A far-away
    // companion joins Starborn's empty rear saddle instead of switching the
    // camera to an Earth body inside the deep-space renderer.
    if ((spaceRT.mode === "deep" || spaceRT.realm !== "earth") && avatarRT().pos.distanceToSquared(destination.pos) > 18 * 18) {
      const horse = riderRT[characterRT.active].horse as HorseState | null
      if (horse?.ident.breed === "starborn" && horse.rider && !horse.passenger && riderRT[target].phase === "none") {
        restoreRiderSeat(target, horse, 1)
        game.showHint(`${target === "explorer" ? `${names.explorer}` : `${names.companion}`} joins you in ${names.starborn}'s rear saddle.`)
      } else {
        game.showHint("Stay together beyond Earth. Return home to switch to someone waiting there.")
        return
      }
    }
    if (avatarRT().pos.distanceToSquared(destination.pos) > 18 * 18) {
      characterRT.switching = true
      transition.current = { target, elapsed: 0, selected: false, hold: 0 }
    } else {
      selectAvatar(target)
    }
  }, -110)
  return null
}
