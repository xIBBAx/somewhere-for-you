/**
 * Three third-person views, as in GTA V: Far, Medium (the default) and
 * Close, cycled with Tab or the camera button on touch screens.
 *
 * A view only sets the boom's length; everything else about the framing
 * (the pivot height, a slight over-the-shoulder offset, the lens) is read
 * off one continuous curve of that length, so the wheel and a pinch zoom in
 * between the presets and still frame well, and a switch glides from one
 * to the next with the boom (FollowCamera damps it). Mounts and wings add
 * their own length on top (cameraRT.mountedDistance, flightDistance), so a
 * horse, a deer, two riders or a Pegasus's span stay in the frame.
 */

export type CameraView = "far" | "medium" | "close"

export const VIEW_ORDER: CameraView[] = ["far", "medium", "close"]

export const CAMERA_VIEWS: Record<CameraView, { label: string; distance: number }> = {
  // the whole figure with the place round it, still clearly a person
  far: { label: "Far", distance: 8.4 },
  // full body and the way ahead: the everyday view
  medium: { label: "Medium", distance: 5.6 },
  // face, clothes and every movement, from the hips up: genuinely close
  // (3.2 m at this lens still framed the whole figure and more)
  close: { label: "Close", distance: 1.9 },
}

export const DEFAULT_VIEW: CameraView = "medium"

const STORE_KEY = "gift-world.cameraView"

export const viewRT = {
  view: DEFAULT_VIEW as CameraView,
  /** the boom length the framing follows (smoothed toward the target, not cut short by walls) */
  framing: CAMERA_VIEWS[DEFAULT_VIEW].distance,
}

export type Framing = {
  /** pivot lift over the default chest-height anchor (m): toward the face as the view closes in */
  pivot: number
  /** how far right of the figure the camera sits (m): the figure a little left of centre */
  shoulder: number
  /** vertical field of view (degrees) */
  fov: number
  /** how much of a mount's or a wingspan's own extra boom length this view keeps */
  extra: number
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** The framing for a boom of this length (on foot; mounts add their own length). */
export const framingAt = (distance: number): Framing => {
  const c = CAMERA_VIEWS.close.distance, m = CAMERA_VIEWS.medium.distance, f = CAMERA_VIEWS.far.distance
  if (distance <= m) {
    const t = clamp01((distance - c) / (m - c))
    return { pivot: lerp(0.3, 0.1, t), shoulder: lerp(0.3, 0.16, t), fov: lerp(40, 41, t), extra: lerp(0.5, 0.82, t) }
  }
  const t = clamp01((distance - m) / (f - m))
  return { pivot: lerp(0.1, 0, t), shoulder: lerp(0.16, 0, t), fov: lerp(41, 43, t), extra: lerp(0.82, 1, t) }
}

/** The preset nearest a boom length (what the player is in after zooming by hand). */
export const nearestView = (distance: number): CameraView => {
  let best: CameraView = DEFAULT_VIEW
  let gap = Infinity
  for (const v of VIEW_ORDER) {
    const d = Math.abs(CAMERA_VIEWS[v].distance - distance)
    if (d < gap) { gap = d; best = v }
  }
  return best
}

/** The next view in the cycle Far → Medium → Close → Far (or back), from where the boom is now. */
export const nextView = (distance: number, step = 1): CameraView => {
  const i = VIEW_ORDER.indexOf(nearestView(distance))
  const n = VIEW_ORDER.length
  return VIEW_ORDER[(((i + step) % n) + n) % n]
}

export const loadView = (): CameraView => {
  try {
    const v = localStorage.getItem(STORE_KEY)
    if (v === "far" || v === "medium" || v === "close") return v
  } catch {
    // storage blocked: the default
  }
  return DEFAULT_VIEW
}

export const saveView = (view: CameraView): void => {
  try {
    localStorage.setItem(STORE_KEY, view)
  } catch {
    // storage blocked: the choice lasts this visit
  }
}

viewRT.view = loadView()
viewRT.framing = CAMERA_VIEWS[viewRT.view].distance

/** The boom length of the chosen view. */
export const viewDistance = (): number => CAMERA_VIEWS[viewRT.view].distance
