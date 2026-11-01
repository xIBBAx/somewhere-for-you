import { useEffect } from "react"
import { X } from "lucide-react"
import { useGame } from "../state/gameStore"
import { getMemory } from "../content/memories"
import { getSecret } from "../content/secrets"
import { story } from "../content/story"
import { memoryStory, storyText } from "../content/storyCopy"
import { useDialogFocus } from "./useDialogFocus"
import { MemoryPhotos } from "./MemoryPhotos"
import { registerDevTool } from "../dev/devTools"

/**
 * Memory UI as a physical postcard — never a generic modal.
 * Shared memories carry the companion's stamp; personal areas carry the explorer's.
 * Each card carries the stop's real photographs (content/memories.ts).
 */
export const MemoryCard = (): React.ReactElement | null => {
  const memoryId = useGame((s) => s.activeMemoryId)
  const secretId = useGame((s) => s.activeSecretId)
  const closeMemory = useGame((s) => s.closeMemory)
  const closeSecret = useGame((s) => s.closeSecret)
  const dialog = useDialogFocus(Boolean(memoryId || secretId), memoryId ? closeMemory : closeSecret)

  // QA: open a postcard directly (`card("corner-cafe")`, `card("hidden-note", true)`)
  useEffect(() => {
    registerDevTool("card", ((id: string, secret = false) => {
      const g = useGame.getState()
      if (secret) g.openSecret(id)
      else g.openMemory(id)
      return id
    }) as (...args: never[]) => unknown)
    registerDevTool("finaleCard", ((on = true) => useGame.getState().setFinaleMessage(on)) as (...args: never[]) => unknown)
  }, [])

  if (memoryId) {
    const m = getMemory(memoryId)
    if (!m) return null
    const line =
      m.sceneType === "studio" ? story.studioLine : m.sceneType === "cafe" && m.id === "corner-cafe" ? story.cafeLine : null
    // never sign off with the same words the card has just said
    const extra = line && line !== memoryStory(m) ? line : null
    return (
      <div ref={dialog} className="card-veil" onClick={closeMemory} role="dialog" aria-modal="true" aria-label={m.title}>
        <div className={m.photos?.length ? "postcard has-photo" : "postcard"} onClick={(e) => e.stopPropagation()}>
          <button className="postcard-close" onClick={closeMemory} aria-label="Close">
            <X size={17} />
          </button>
          <div className="postcard-stamp" aria-hidden="true">
            <svg viewBox="0 0 64 64" role="presentation">
              <circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 3" />
              <path d="M32 14l4.4 12.6L49 31l-12.6 4.4L32 48l-4.4-12.6L15 31l12.6-4.4z" fill="currentColor" />
            </svg>
          </div>
          <h2>{m.title}</h2>
          <div className="meta">
            {m.subtitle}
            {storyText(m.locationName) ? ` · ${m.locationName}` : ""}
            {storyText(m.dateLabel) ? ` · ${m.dateLabel}` : ""}
          </div>
          {m.photos?.length ? <MemoryPhotos key={m.id} photos={m.photos} tilt={m.order % 2 ? 1.6 : -1.3} /> : null}
          <div className="body">{memoryStory(m)}</div>
          {storyText(m.longText) && <div className="body more">{m.longText}</div>}
          {extra && <div className="signature">“{extra}”</div>}
          <button className="postcard-keep" onClick={closeMemory}>
            keep this star ✦
          </button>
        </div>
      </div>
    )
  }

  if (secretId) {
    const s = getSecret(secretId)
    if (!s) return null
    return (
      <div ref={dialog} className="card-veil" onClick={closeSecret} role="dialog" aria-modal="true" aria-label={s.title}>
        <div className={s.photo ? "postcard has-photo" : "postcard"} onClick={(e) => e.stopPropagation()}>
          <button className="postcard-close" onClick={closeSecret} aria-label="Close">
            <X size={17} />
          </button>
          <div className="postcard-stamp">
            <span style={{ fontSize: 30 }}>🐾</span>
          </div>
          <h2>{s.title}</h2>
          <div className="meta">a secret, found by the cat</div>
          {s.photo && <MemoryPhotos key={s.id} photos={[s.photo]} tilt={-1.8} />}
          {storyText(s.text) && <div className="body">{s.text}</div>}
          <button className="postcard-keep" onClick={closeSecret}>
            tuck it away
          </button>
        </div>
      </div>
    )
  }

  return null
}
