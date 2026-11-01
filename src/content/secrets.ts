import { gift, resolvePhoto, type MemoryPhoto } from "../personalization"

/**
 * Hidden paw-trail secrets. The cat discovers them; the player follows.
 * Each one can keep a photo tucked away at the end of the trail
 * (personalization: `secrets`).
 */
export type Secret = {
  id: string
  title: string
  text: string
  /** where the cat first notices something */
  trailStart: [number, number]
  /** where the trail leads */
  trailEnd: [number, number]
  photo?: MemoryPhoto
}

const TRAILS: Pick<Secret, "id" | "trailStart" | "trailEnd">[] = [
  { id: "hidden-note", trailStart: [4.4, 7.2], trailEnd: [9.6, 4.6] },
  { id: "hidden-sketch", trailStart: [-8.6, 1.2], trailEnd: [-15.4, -1.6] },
]

export const SECRETS: Secret[] = TRAILS.map((trail, i) => {
  const s = gift().secrets[i]
  return { ...trail, title: s.title, text: s.text, photo: resolvePhoto(s.photo) ?? undefined }
})

export const getSecret = (id: string): Secret | undefined => SECRETS.find((s) => s.id === id)
