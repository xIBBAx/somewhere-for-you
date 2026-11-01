import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { BookHeart, Download, Trash2, X } from "lucide-react"
import { ACHIEVEMENTS, BOOK_COMPLETE, type AchievementId } from "../content/adventures"
import { storyText } from "../content/storyCopy"
import { useAdventures, type Photo } from "../state/adventureStore"
import { GROUND_CLASSES, GROUND_LIFE_LIST } from "../content/groundLife"
import { fieldGuideCount, useFieldGuide } from "../state/fieldGuideStore"
import { takeAction } from "../game/runtime"
import { useDialogFocus } from "./useDialogFocus"
import { useGame } from "../state/gameStore"
import { MEMORIES } from "../content/memories"
import { SECRETS } from "../content/secrets"
import type { MemoryPhoto } from "../personalization"

type Tab = "pages" | "album" | "records" | "guide"
const GROUPS = ["Together", "Lakes", "Meadows", "Night", "Moments"] as const

/** the journal: pages to fill, little records and the photo album. */
export const Journal = (): React.ReactElement => {
  const open = useAdventures((s) => s.open)
  const setOpen = useAdventures((s) => s.setOpen)
  const unlocked = useAdventures((s) => s.unlocked)
  const records = useAdventures((s) => s.records)
  const album = useAdventures((s) => s.album)
  const removePhoto = useAdventures((s) => s.removePhoto)
  const guideMet = useFieldGuide((s) => fieldGuideCount(s.seen))
  const [tab, setTab] = useState<Tab>("pages")
  const [viewing, setViewing] = useState<Photo | null>(null)
  const [keepsake, setKeepsake] = useState<MemoryPhoto | null>(null)
  const visited = useGame((s) => s.visited)
  const foundSecrets = useGame((s) => s.secrets)
  // the real photographs she has uncovered: kept stops first, then the cat's secrets
  const keepsakes = [
    ...MEMORIES.filter((m) => visited[m.id]).flatMap((m) => m.photos ?? []),
    ...SECRETS.filter((x) => foundSecrets.includes(x.id)).flatMap((x) => (x.photo ? [x.photo] : [])),
  ]
  const dialog = useDialogFocus(open, () => setOpen(false))

  useEffect(() => {
    let frame = 0
    const tick = (): void => {
      if (takeAction("journal")) setOpen(!useAdventures.getState().open)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [setOpen])

  const total = Object.keys(ACHIEVEMENTS).length
  const done = unlocked.length
  return (
    <>
      <button className="hud-book" onClick={() => setOpen(true)} aria-label={`The journal, ${done} of ${total} pages`} title="The journal (L)">
        <BookHeart size={18} />
        <span>{done}/{total}</span>
      </button>
      {open && createPortal(
        <div className="journal-backdrop" onClick={() => setOpen(false)}>
          <div className="journal" ref={dialog} role="dialog" aria-modal="true" aria-label="The journal" onClick={(e) => e.stopPropagation()}>
            <header>
              <h2>The Journal</h2>
              <span className="journal-progress">{done} of {total} pages</span>
              <button className="journal-close" onClick={() => setOpen(false)} aria-label="Close the book"><X size={18} /></button>
            </header>
            <nav role="tablist">
              {(["pages", "album", "records", "guide"] as Tab[]).map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
                  {t === "pages" ? "Pages" : t === "album" ? `Album (${album.length + keepsakes.length})` : t === "records" ? "Little records" : `Field guide (${guideMet}/${GROUND_LIFE_LIST.length})`}
                </button>
              ))}
            </nav>
            <div className="journal-body">
              {tab === "pages" && (
                <>
                  {done === total && (
                    <div className="journal-complete">
                      <h3>{BOOK_COMPLETE.title}</h3>
                      {BOOK_COMPLETE.lines.map(storyText).filter(Boolean).map((line) => <p key={line}>{line}</p>)}
                    </div>
                  )}
                  {GROUPS.map((group) => (
                    <section key={group}>
                      <h3>{group}</h3>
                      <ul className="journal-pages">
                        {(Object.entries(ACHIEVEMENTS) as [AchievementId, (typeof ACHIEVEMENTS)[AchievementId]][]).filter(([, p]) => p.group === group).map(([id, page]) => {
                          const got = unlocked.includes(id)
                          return (
                            <li key={id} className={got ? "got" : ""}>
                              <span className="journal-mark" aria-hidden>{got ? "✦" : "·"}</span>
                              <div>
                                <div className="journal-title">{page.title}</div>
                                <div className="journal-line">{got ? page.line : page.hint}</div>
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    </section>
                  ))}
                </>
              )}
              {tab === "album" && (
                <>
                  {keepsakes.length > 0 && (
                    <section>
                      <h3>From the memories</h3>
                      <div className="journal-keepsakes">
                        {keepsakes.map((p) => (
                          <button key={p.src} onClick={() => setKeepsake(p)} aria-label={p.alt}>
                            <img src={p.thumb} alt="" width={p.w} height={p.h} loading="lazy" decoding="async" />
                          </button>
                        ))}
                      </div>
                      {album.length > 0 && <h3>Taken in this world</h3>}
                    </section>
                  )}
                  {album.length === 0 ? <p className="journal-empty">No photos yet. Press P anywhere to open the camera.</p> : (
                    <div className="journal-album">
                      {[...album].reverse().map((photo) => (
                        <button key={photo.id} onClick={() => setViewing(photo)} aria-label={`Photo from ${new Date(photo.time).toLocaleString()}`}>
                          <img src={photo.data} alt="" loading="lazy" />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              {tab === "records" && (
                <dl className="journal-records">
                  <div><dt>Best stone skip</dt><dd>{records.bestSkips}</dd></div>
                  <div><dt>Stones skipped</dt><dd>{records.stonesThrown}</dd></div>
                  <div><dt>Sky lanterns</dt><dd>{records.lanterns}</dd></div>
                  <div><dt>Fireflies caught</dt><dd>{records.fireflies}</dd></div>
                  <div><dt>Flowers picked</dt><dd>{records.flowers}</dd></div>
                  <div><dt>Bouquets given</dt><dd>{records.bouquets}</dd></div>
                  <div><dt>Races won</dt><dd>{records.raceWins} of {records.races}</dd></div>
                  <div><dt>Fastest race</dt><dd>{records.bestRace ? `${records.bestRace.toFixed(1)} s` : "—"}</dd></div>
                  <div><dt>Constellations</dt><dd>{records.constellations.length ? records.constellations.join(", ") : "—"}</dd></div>
                  <div><dt>Hugs</dt><dd>{records.hugs}</dd></div>
                  <div><dt>High fives</dt><dd>{records.highFives}</dd></div>
                  <div><dt>Hand in hand</dt><dd>{Math.round(records.handInHand)} m</dd></div>
                  <div><dt>Dancing</dt><dd>{Math.round(records.danceSeconds)} s</dd></div>
                  <div><dt>Photos taken</dt><dd>{records.photos}</dd></div>
                </dl>
              )}
              {tab === "guide" && <FieldGuidePage />}
            </div>
          </div>
          {keepsake && (
            <div className="memory-photo-large" onClick={(e) => { e.stopPropagation(); setKeepsake(null) }} role="presentation">
              <img src={keepsake.src} alt={keepsake.alt} width={keepsake.w} height={keepsake.h} />
            </div>
          )}
          {viewing && (
            <div className="journal-viewer" onClick={(e) => { e.stopPropagation(); setViewing(null) }}>
              <img src={viewing.data} alt="A photo taken in this world" onClick={(e) => e.stopPropagation()} />
              <div className="journal-viewer-actions" onClick={(e) => e.stopPropagation()}>
                <a href={viewing.data} download={`explorer-${new Date(viewing.time).toISOString().slice(0, 10)}-${viewing.id}.jpg`}><Download size={16} /> Save</a>
                <button onClick={() => { removePhoto(viewing.id); setViewing(null) }}><Trash2 size={16} /> Remove</button>
                <button onClick={() => setViewing(null)}><X size={16} /> Close</button>
              </div>
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}

/** Little ground neighbours met up close (see src/world/life/ground). */
const FieldGuidePage = (): React.ReactElement => {
  const seen = useFieldGuide((s) => s.seen)
  const met = fieldGuideCount(seen)
  return (
    <>
      <p className="field-guide-intro">
        {met === 0
          ? "Little creatures live on the ground everywhere. Stay close and still beside one for a moment to add it here."
          : `${met} of ${GROUND_LIFE_LIST.length} little neighbours met up close.`}
      </p>
      <ul className="journal-pages field-guide">
        {GROUND_LIFE_LIST.map((info) => {
          const entry = seen[info.id]
          const cls = GROUND_CLASSES[info.cls]
          return (
            <li key={info.id} className={entry ? "got" : ""}>
              <span className="journal-mark" aria-hidden>{entry ? "✦" : "·"}</span>
              <div>
                <div className="journal-title">
                  {entry ? info.name : "Someone small, not met yet"}
                  <span className={`field-guide-class field-guide-${info.cls}`}>{cls.label}</span>
                </div>
                {entry && <div className="field-guide-latin"><i>{info.scientific}</i> · {info.group}</div>}
                <div className="journal-line">{entry ? info.note : info.hint}</div>
                {entry && (
                  <div className="field-guide-meta">
                    {info.where} · {info.when} · legs: {info.legs}{entry.times > 1 ? ` · met ${entry.times} times` : ""}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      <p className="field-guide-footnote">In the world they are drawn a little larger than life, so they are easier to spot.</p>
    </>
  )
}
