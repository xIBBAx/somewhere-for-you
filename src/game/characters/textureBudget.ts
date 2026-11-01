import * as THREE from "three"

/**
 * GPU memory budget for the realistic characters. Their skin maps are 2048²
 * so faces stay sharp in close-ups on a desktop GPU (~21 MB each with
 * mipmaps). On the Low preset they are halved to 1024² when the rig loads,
 * saving ~32 MB for the pair; every other texture is already 1024² or smaller.
 */
export const CHARACTER_TEXTURE_MAX = { full: 2048, light: 1024 } as const

export const characterTextureMax = (level: string): number =>
  level === "low" ? CHARACTER_TEXTURE_MAX.light : CHARACTER_TEXTURE_MAX.full

/** The largest size within `max` that keeps the aspect ratio. */
export const cappedSize = (width: number, height: number, max: number): [number, number] => {
  const scale = Math.min(1, max / Math.max(width, height, 1))
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))]
}

type Drawable = HTMLImageElement | HTMLCanvasElement | ImageBitmap

/** Downscale a texture's image in place, before its first GPU upload. */
export const capTexture = (texture: THREE.Texture | null | undefined, max: number): boolean => {
  const image = texture?.image as Drawable | undefined
  if (!texture || !image || typeof document === "undefined") return false
  const [w, h] = cappedSize(image.width, image.height, max)
  if (w === image.width && h === image.height) return false
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  if (!ctx) return false
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(image, 0, 0, w, h)
  if ("close" in image && typeof image.close === "function") image.close()
  texture.image = canvas
  texture.needsUpdate = true
  return true
}
