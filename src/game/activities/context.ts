import * as THREE from "three"
import { useGame } from "../../state/gameStore"
import { useDiscoveries } from "../../state/discoveryStore"
import { discoveryRT } from "../../world/discoveries"
import { avatarRT, characterRT, worldRT, type AvatarBody, type CharacterId } from "../runtime"
import { explorerMotionRT } from "../characters/ExplorerCharacter"
import { companionMotionRT } from "../characters/CompanionCharacter"
import { togetherRT } from "../together/togetherState"

/** What every activity needs to know about the moment. */
export type ActivityContext = {
  body: AvatarBody
  id: CharacterId
  dt: number
  time: number
  night: boolean
  water: "land" | "wade" | "swim"
  /** true when nothing else (memory, secret, discovery, animal, card) wants E */
  free: boolean
}

export const makeContext = (dt: number, time: number): ActivityContext => {
  const game = useGame.getState()
  const body = avatarRT()
  const id = characterRT.active
  const water = id === "explorer" ? explorerMotionRT.water : companionMotionRT.water
  const free = game.started && !worldRT.introActive && !worldRT.finaleActive && !worldRT.performingMemoryId &&
    !game.activeMemoryId && !game.activeSecretId && !game.finaleMessage && !characterRT.switching &&
    !worldRT.nearMemoryId && !worldRT.nearSecretId && !useDiscoveries.getState().prompt && !discoveryRT.animalPrompt && !discoveryRT.horsePrompt &&
    body.gesture === "none" && body.rideY === null && (togetherRT.action === "none" || togetherRT.action === "holdHands")
  return { body, id, dt, time, night: worldRT.timeOfDay > 0.8, water, free }
}

export const forwardOf = (facing: number, out = new THREE.Vector3()): THREE.Vector3 => out.set(Math.sin(facing), 0, Math.cos(facing))
export const rightOf = (facing: number, out = new THREE.Vector3()): THREE.Vector3 => out.set(-Math.cos(facing), 0, Math.sin(facing))
