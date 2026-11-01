import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { MemoryPhoto } from "../personalization"
import { PHOTO_SIZES, photoSrcSet } from "./photoSources"

/**
 * A real photograph on the postcard, as a print that develops once it has
 * arrived: never a blank frame, never cropped (the frame takes the photo's own
 * aspect ratio). With more than one, small prints underneath swap it.
 * Tapping the print shows it large.
 */
export const MemoryPhotos = ({ photos, tilt = 1.4 }: { photos: MemoryPhoto[]; tilt?: number }): React.ReactElement | null => {
  const [index, setIndex] = useState(0)
  const [large, setLarge] = useState(false)
  const p = photos[Math.min(index, photos.length - 1)]
  if (!p) return null
  return (
    <div className="memory-photos">
      <button className="memory-print" style={{ rotate: `${tilt}deg` }} onClick={() => setLarge(true)} aria-label={`${p.alt}. Show it larger`}>
        <DevelopingImage key={p.src} photo={p} />
        {p.taken && <span className="memory-print-date">{p.taken}</span>}
      </button>
      {photos.length > 1 && (
        <div className="memory-prints" role="group" aria-label="More photos">
          {photos.map((q, i) => (
            <button key={q.src} className={i === index ? "on" : ""} aria-pressed={i === index} aria-label={q.alt} onClick={() => setIndex(i)}>
              <img src={q.thumb} alt="" width={q.w} height={q.h} loading="lazy" decoding="async" />
            </button>
          ))}
        </div>
      )}
      {/* the postcard is transformed, so a fixed overlay must live outside it */}
      {large && createPortal(
        <div className="memory-photo-large" onClick={(e) => { e.stopPropagation(); setLarge(false) }} role="presentation">
          <img src={p.src} alt={p.alt} width={p.w} height={p.h} />
        </div>,
        document.body,
      )}
    </div>
  )
}

const sizer = (p: MemoryPhoto): string =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${p.w}" height="${p.h}"/>`)}`

const DevelopingImage = ({ photo }: { photo: MemoryPhoto }): React.ReactElement => {
  const ref = useRef<HTMLImageElement>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (ref.current?.complete && ref.current.naturalWidth > 0) setReady(true)
  }, [])
  // the small copy arrives first and stands in as the pale exposure, so the
  // print is never an empty frame while the full photo is still on its way
  return (
    <span className="memory-print-photo">
      {/* an empty image of the photo's exact size holds the frame's shape before anything arrives */}
      <img className="memory-print-sizer" src={sizer(photo)} alt="" aria-hidden />
      <img className="memory-print-exposure" src={photo.thumb} alt="" aria-hidden />
      <img
        ref={ref}
        className={ready ? "developed" : ""}
        srcSet={photoSrcSet(photo)}
        sizes={PHOTO_SIZES}
        src={photo.src}
        width={photo.w}
        height={photo.h}
        alt={photo.alt}
        decoding="async"
        onLoad={() => setReady(true)}
      />
    </span>
  )
}
