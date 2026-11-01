import { story } from "../../content/story"
import { useFrame, useThree } from "@react-three/fiber"
import { create } from "zustand"
import * as THREE from "three"
import { useAdventures } from "../../state/adventureStore"
import { sfx } from "../audio/audio"
import { postRT } from "../render/PostFX"
import { avatarRT, cameraRT, characterRT, companionRT, playerRT, takeAction, worldRT, type CharacterId } from "../runtime"
import { togetherRT } from "../together/togetherState"
import { endCoupleAction } from "../together/Together"
import { aiIntents } from "../characters/controller/avatarController"
import { useActivityUI } from "./activityState"
import { forwardOf, rightOf } from "./context"
import { useGame } from "../../state/gameStore"
import { originRT } from "../../world/origin"

/**
 * Photo mode (P): the world holds still for a portrait. Drag to orbit, wheel
 * to zoom, pick a film look and a pose, then take the picture. Photos go into
 * the album in the journal and can be downloaded.
 */
export const FILTERS = {
  natural: { label: "Natural", css: "none" },
  film: { label: "Film", css: "contrast(1.06) saturate(0.86) sepia(0.14) brightness(1.03)" },
  golden: { label: "Golden", css: "sepia(0.32) saturate(1.25) hue-rotate(-8deg) brightness(1.05)" },
  dreamy: { label: "Dreamy", css: "brightness(1.08) saturate(1.12) contrast(0.92) blur(0.4px)" },
  mono: { label: "Mono", css: "grayscale(1) contrast(1.12)" },
} as const
export type FilterId = keyof typeof FILTERS
export const POSES = {
  natural: "Natural",
  wave: "Wave",
  heart: "Heart",
  cheer: "Cheer",
  look: "Look here",
  hug: "Together",
} as const
export type PoseId = keyof typeof POSES

type PhotoUI = {
  open: boolean
  filter: FilterId
  pose: PoseId
  flash: number
  last: string | null
  setFilter: (f: FilterId) => void
  setPose: (p: PoseId) => void
  request: () => void
  close: () => void
}

export const photoRT = { requested: false, closeRequested: false, saved: { distance: 0, pitch: 0 } }

export const usePhoto = create<PhotoUI>((set) => ({
  open: false,
  filter: "natural",
  pose: "natural",
  flash: 0,
  last: null,
  setFilter: (filter) => set({ filter }),
  setPose: (pose) => set({ pose }),
  request: () => { photoRT.requested = true },
  close: () => { photoRT.closeRequested = true },
}))

const canOpen = (): boolean => {
  const game = useGame.getState()
  const body = avatarRT()
  return game.started && !worldRT.introActive && !worldRT.finaleActive && !game.activeMemoryId && !game.activeSecretId &&
    !characterRT.switching && body.gesture === "none" && !body.paused && useActivityUI.getState().mode === "none"
}

const _f = new THREE.Vector3()
const _r = new THREE.Vector3()
const _cam = new THREE.Vector3()
const bodyOf = (id: CharacterId): typeof playerRT => (id === "explorer" ? playerRT : companionRT)

const open = (): void => {
  const body = avatarRT()
  body.paused = true
  body.vel.set(0, 0, 0)
  cameraRT.photo = true
  photoRT.saved.distance = cameraRT.targetDistance
  photoRT.saved.pitch = cameraRT.targetPitch
  cameraRT.targetDistance = Math.min(cameraRT.targetDistance, 6)
  if (document.pointerLockElement) document.exitPointerLock()
  useActivityUI.getState().setMode("photo")
  usePhoto.setState({ open: true, pose: "natural", flash: 0 })
}

const close = (gl: THREE.WebGLRenderer): void => {
  avatarRT().paused = false
  cameraRT.photo = false
  cameraRT.targetDistance = photoRT.saved.distance
  cameraRT.targetPitch = photoRT.saved.pitch
  gl.domElement.style.filter = ""
  if (togetherRT.action !== "none") endCoupleAction()
  useActivityUI.getState().setMode("none")
  usePhoto.setState({ open: false })
}

/** Render the current frame (with post) and keep a filtered, captioned copy. */
const capture = (gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, filter: FilterId): string => {
  if (postRT.composer) postRT.composer.render()
  else gl.render(scene, camera)
  const source = gl.domElement
  const width = 1280
  const height = Math.round(width * source.height / source.width)
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")!
  ctx.filter = FILTERS[filter].css
  ctx.drawImage(source, 0, 0, width, height)
  ctx.filter = "none"
  // a soft vignette and a small handwritten-style stamp
  const g = ctx.createRadialGradient(width / 2, height / 2, height * 0.45, width / 2, height / 2, height * 0.95)
  g.addColorStop(0, "rgba(0,0,0,0)")
  g.addColorStop(1, "rgba(20,12,8,0.28)")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, width, height)
  const stamp = `${story.title} · ${new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`
  ctx.font = "italic 500 20px Fraunces, Georgia, serif"
  ctx.fillStyle = "rgba(255, 246, 232, 0.86)"
  ctx.textAlign = "right"
  ctx.shadowColor = "rgba(0,0,0,0.35)"
  ctx.shadowBlur = 6
  ctx.fillText(stamp, width - 26, height - 24)
  return canvas.toDataURL("image/jpeg", 0.82)
}

const applyPose = (pose: PoseId, time: number): void => {
  const camera = { x: _cam.x, z: _cam.z }
  for (const id of ["explorer", "companion"] as const) {
    if (id === "companion" && !characterRT.companionPresent) continue
    const body = bodyOf(id)
    if (body.pos.distanceTo(avatarRT().pos) > 4) continue
    const req = togetherRT.pose[id]
    forwardOf(body.facing, _f)
    rightOf(body.facing, _r)
    if (pose !== "natural" && pose !== "hug") {
      // everyone in the picture turns towards the camera
      const want = Math.atan2(camera.x - body.pos.x, camera.z - body.pos.z)
      body.facing += Math.atan2(Math.sin(want - body.facing), Math.cos(want - body.facing)) * 0.12
    }
    const h = id === "explorer" ? 0 : 0.12
    if (pose === "wave") {
      req.reachR.target.copy(body.pos).addScaledVector(_r, 0.32 + Math.sin(time * 7) * 0.08).addScaledVector(_f, 0.12)
      req.reachR.target.y += 1.52 + h
      req.reachR.fingers.set(0, 1, 0)
      req.reachR.palm.copy(_f)
      req.reachR.weight = 1
      req.reachR.grip = 0
      req.love = 0.4
    } else if (pose === "heart") {
      // hands meet above the head in a heart
      for (const [goal, side] of [[req.reachL, -1], [req.reachR, 1]] as const) {
        goal.target.copy(body.pos).addScaledVector(_r, 0.06 * side).addScaledVector(_f, 0.06)
        goal.target.y += 1.72 + h
        goal.fingers.copy(_r).multiplyScalar(-side).addScaledVector(new THREE.Vector3(0, -1, 0), 0.6).normalize()
        goal.palm.copy(_f).multiplyScalar(-1)
        goal.weight = 1
        goal.grip = 0.4
      }
      req.love = 1
    } else if (pose === "cheer") {
      body.celebrate = Math.max(body.celebrate, 0.6)
    } else if (pose === "look") {
      req.love = 0.5
    } else if (pose === "hug" && characterRT.companionPresent && togetherRT.distance < 4) {
      // side by side, holding hands, heads tilted together
      const mate = bodyOf(id === "explorer" ? "companion" : "explorer")
      if (id !== characterRT.active) {
        // step in beside the one being photographed
        const lead = avatarRT()
        const side = id === "companion" ? 1 : -1
        rightOf(lead.facing, _r)
        const tx = lead.pos.x + _r.x * 0.6 * side, tz = lead.pos.z + _r.z * 0.6 * side
        const dx = tx - body.pos.x, dz = tz - body.pos.z, d = Math.hypot(dx, dz)
        aiIntents[id] = d > 0.08 ? { move: { x: dx / d * Math.min(1, d / 0.6), y: dz / d * Math.min(1, d / 0.6) }, sprint: false, jump: false } : null
        if (d > 0.3) continue
        rightOf(body.facing, _r)
      }
      const mid = new THREE.Vector3().copy(body.pos).add(mate.pos).multiplyScalar(0.5)
      mid.y = (body.pos.y + mate.pos.y) / 2 + 0.84
      const towards = new THREE.Vector3(mate.pos.x - body.pos.x, 0, mate.pos.z - body.pos.z).normalize()
      const goal = id === "explorer" ? req.reachR : req.reachL
      goal.target.copy(mid)
      goal.fingers.set(0, -1, 0)
      goal.palm.copy(towards)
      goal.weight = 1
      goal.grip = 0.8
      req.love = 0.9
      const want = Math.atan2(camera.x - body.pos.x, camera.z - body.pos.z)
      body.facing += Math.atan2(Math.sin(want - body.facing), Math.cos(want - body.facing)) * 0.12
    }
  }
}

/** Photo mode logic inside the canvas. */
export const PhotoMode = (): null => {
  const { gl, scene, camera } = useThree()
  useFrame((state) => {
    const ui = usePhoto.getState()
    const ext = photoRT
    if (takeAction("photo")) {
      if (ui.open) ext.closeRequested = true
      else if (canOpen()) open()
    }
    if (!ui.open) return
    // camera position in logical world coordinates (floating origin)
    camera.getWorldPosition(_cam)
    _cam.x += originRT.x
    _cam.z += originRT.z
    gl.domElement.style.filter = FILTERS[ui.filter].css
    applyPose(ui.pose, state.clock.elapsedTime)
    if (photoRT.requested) {
      photoRT.requested = false
      gl.domElement.style.filter = ""
      const data = capture(gl, scene, camera, ui.filter)
      gl.domElement.style.filter = FILTERS[ui.filter].css
      sfx.shutter()
      useAdventures.getState().addPhoto({ id: `p${Date.now()}`, time: Date.now(), data, who: characterRT.active })
      usePhoto.setState({ flash: Date.now(), last: data })
    }
    if (ext.closeRequested) {
      ext.closeRequested = false
      close(gl)
    }
  }, -34)
  return null
}
