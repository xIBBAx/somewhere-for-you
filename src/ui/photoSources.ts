import type { MemoryPhoto } from "../personalization"

export const PHOTO_SIZES = "(max-width: 600px) 78vw, 420px"

// thumbs are 480 px on the long edge (placeholders and photos added in the game)
const thumbWidth = (p: MemoryPhoto): number => Math.round(p.w * Math.min(1, 480 / Math.max(p.w, p.h)))

export const photoSrcSet = (p: MemoryPhoto): string =>
  thumbWidth(p) < p.w ? `${p.thumb} ${thumbWidth(p)}w, ${p.src} ${p.w}w` : `${p.src} ${p.w}w`

const fetched = new Set<string>()
/** Warm the browser cache as the explorer walks up, so the photo develops instead of loading. */
export const prefetchPhoto = (p?: MemoryPhoto): void => {
  if (!p || fetched.has(p.src) || typeof Image === "undefined") return
  fetched.add(p.src)
  // the small copy first: it is what the print shows while the photo develops
  new Image().src = p.thumb
  const img = new Image()
  img.sizes = PHOTO_SIZES
  img.srcset = photoSrcSet(p)
  img.src = p.src
}
