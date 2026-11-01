import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { X } from "lucide-react"
import { giftMedia } from "virtual:gift-media"
import {
  gift, normalizeGift, personalizationWarnings, hasBuildGift, PLACEHOLDERS, LIMITS,
  type GiftConfig, type PhotoRef, type MemoryText,
} from "../../personalization"
import { clearPersonalData, clearProgress, deleteMedia, getMedia, listMedia, writePersonalText } from "../../personalization/localData"
import { importAudio, importImage, readModelFile, storeModel, MediaError } from "../../personalization/media"
import { exportBundle, importBundle } from "../../personalization/bundle"
import { checkCharacterModel, type ModelReport } from "../../personalization/modelCheck"
import { CHARACTER_PRESETS } from "../../content/assets"
import { allowLeave } from "../../game/travel/cosmicRefresh"
import { resetInputControls } from "../../game/input"
import { usePersonalizeUI } from "./personalizeStore"
import "./personalize.css"

/**
 * The Personalize screen: everything a person can change about the world
 * without touching code. It saves only in this browser (localStorage for the
 * words, IndexedDB for photos, music and models) and restarts the world once
 * to apply. Nothing is uploaded anywhere. See docs/CUSTOMIZATION.md.
 */

type Tab = "people" | "letter" | "memories" | "ending" | "characters" | "world" | "data"
const TABS: { id: Tab; label: string }[] = [
  { id: "people", label: "People" },
  { id: "letter", label: "Letter" },
  { id: "memories", label: "Memories" },
  { id: "ending", label: "Ending" },
  { id: "characters", label: "Characters" },
  { id: "world", label: "World" },
  { id: "data", label: "Your data" },
]
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

/** Preview URLs for local photos (object URLs, revoked when the screen closes). */
const useLocalUrls = (): [Map<string, string>, (id: string) => void] => {
  const [urls, setUrls] = useState(() => new Map<string, string>())
  const pending = useRef(new Set<string>())
  const want = useCallback((id: string) => {
    if (!id.startsWith("local:") || pending.current.has(id)) return
    pending.current.add(id)
    void getMedia(id).then((r) => {
      if (!r) return
      const url = URL.createObjectURL(r.thumb ?? r.bytes)
      setUrls((m) => new Map(m).set(id, url))
    }).catch(() => undefined)
  }, [])
  useEffect(() => () => { for (const u of urls.values()) URL.revokeObjectURL(u) }, [urls])
  return [urls, want]
}

const thumbOf = (src: string, local: Map<string, string>): string | null => {
  if (src.startsWith("placeholder:")) return `/assets/placeholders/thumbs/${src.slice(12)}.jpg`
  if (src.startsWith("media:")) return giftMedia[src.slice(6)]?.url ?? null
  return local.get(src) ?? null
}

const Field = ({ label, value, onChange, max, multiline, hint, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; max: number; multiline?: boolean; hint?: string; placeholder?: string
}): React.ReactElement => (
  <label className="pz-field">
    <span className="pz-label">{label}</span>
    {multiline
      ? <textarea value={value} maxLength={max} placeholder={placeholder} rows={4} onChange={(e) => onChange(e.target.value)} />
      : <input type="text" value={value} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
    {hint && <span className="pz-hint">{hint}</span>}
  </label>
)

/**
 * A text box holding a list. What is typed stays as typed (spaces, blank lines)
 * while the parsed list goes to the draft; it only follows the draft when the
 * list changes from outside, such as an import.
 */
const ListField = ({ items, separator, parse, onItems, ...field }: {
  items: string[]; separator: string; parse: (text: string) => string[]; onItems: (items: string[]) => void
  label: string; max: number; multiline?: boolean; hint?: string
}): React.ReactElement => {
  const joined = items.join(separator)
  const [text, setText] = useState(joined)
  const [seen, setSeen] = useState(joined)
  if (seen !== joined) {
    setSeen(joined)
    if (parse(text).join(separator) !== joined) setText(joined)
  }
  return <Field {...field} value={text} onChange={(v) => { setText(v); onItems(parse(v)) }} />
}

const PhotoList = ({ photos, max, onChange, local, want, busy, setBusy, report }: {
  photos: PhotoRef[]; max: number; onChange: (p: PhotoRef[]) => void
  local: Map<string, string>; want: (id: string) => void
  busy: boolean; setBusy: (b: boolean) => void; report: (msg: string, bad?: boolean) => void
}): React.ReactElement => {
  useEffect(() => { for (const p of photos) want(p.src) }, [photos, want])
  const add = async (files: FileList | null): Promise<void> => {
    if (!files?.length) return
    setBusy(true)
    const next = [...photos]
    try {
      for (const f of Array.from(files).slice(0, max - photos.length)) {
        const record = await importImage(f)
        next.push({ src: record.id, alt: "A photo" })
        want(record.id)
      }
      onChange(next)
      report("Photo added. Describe it in a few words for screen readers.")
    } catch (error) {
      report(error instanceof MediaError ? error.message : "That photo could not be added.", true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="pz-photos">
      {photos.map((p, i) => (
        <div className="pz-photo" key={`${p.src}-${i}`}>
          {thumbOf(p.src, local) ? <img src={thumbOf(p.src, local)!} alt="" /> : <span className="pz-missing">missing</span>}
          <input type="text" aria-label="Describe this photo" value={p.alt} maxLength={LIMITS.short}
            onChange={(e) => onChange(photos.map((q, j) => (j === i ? { ...q, alt: e.target.value } : q)))} />
          <input type="text" aria-label="Caption (optional)" placeholder="caption" value={p.caption ?? ""} maxLength={LIMITS.short}
            onChange={(e) => onChange(photos.map((q, j) => (j === i ? { ...q, caption: e.target.value } : q)))} />
          <button type="button" className="pz-remove" aria-label="Remove this photo" onClick={() => onChange(photos.filter((_, j) => j !== i))}><X size={14} /></button>
        </div>
      ))}
      {photos.length < max && (
        <div className="pz-photo-add">
          <label className="pz-button">
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={(e) => { void add(e.target.files); e.target.value = "" }} />
            Add photo
          </label>
          <select aria-label="Or use built-in artwork" value="" onChange={(e) => { if (e.target.value) onChange([...photos, { src: `placeholder:${e.target.value}`, alt: `Artwork: ${e.target.value}` }]) }}>
            <option value="">or built-in artwork…</option>
            {PLACEHOLDERS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      )}
    </div>
  )
}

const LetterPreview = ({ g }: { g: GiftConfig }): React.ReactElement => (
  <div className="pz-letter-preview" aria-label="Letter preview">
    <small>For {g.recipient.name}{g.creator.name ? ` · from ${g.creator.name}` : ""}</small>
    <h3>{g.letter.heading || "Before you begin"}</h3>
    {g.letter.greeting && <p className="pz-greeting">{g.letter.greeting}</p>}
    {g.letter.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
    {g.letter.signoff && <p className="pz-signoff">{g.letter.signoff}</p>}
    <span className="pz-enter">{g.letter.enter || "Enter the world"} →</span>
  </div>
)

const MemoryPreview = ({ m, n, local }: { m: MemoryText; n: number; local: Map<string, string> }): React.ReactElement => {
  const first = m.photos[0] ? thumbOf(m.photos[0].src, local) : null
  return (
    <div className="pz-postcard" aria-label="Memory card preview">
      <small>Star {n}</small>
      <h3>{m.title}</h3>
      <div className="pz-meta">{[m.subtitle, m.place, m.date].filter(Boolean).join(" · ")}</div>
      {first && <img src={first} alt="" />}
      <p>{m.text}</p>
      {m.more && <p className="pz-more">{m.more}</p>}
    </div>
  )
}

export const PersonalizeScreen = (): React.ReactElement | null => {
  const open = usePersonalizeUI((s) => s.open)
  const setOpen = usePersonalizeUI((s) => s.setOpen)
  if (!open) return null
  return <PersonalizeDialog close={() => setOpen(false)} />
}

const PersonalizeDialog = ({ close }: { close: () => void }): React.ReactElement => {
  const [draft, setDraft] = useState<GiftConfig>(() => structuredClone(gift()))
  const [tab, setTab] = useState<Tab>("people")
  const [memory, setMemory] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null)
  const [reports, setReports] = useState<Partial<Record<"explorer" | "companion", ModelReport>>>({})
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [local, want] = useLocalUrls()
  const dialog = useRef<HTMLDivElement>(null)
  const report = useCallback((text: string, bad = false) => setMessage({ text, bad }), [])
  const update = (fn: (g: GiftConfig) => void): void => setDraft((d) => { const n = structuredClone(d); fn(n); return n })
  const warnings = useMemo(() => personalizationWarnings(), [])

  // the latest close, so a parent re-render never moves focus out of a field being typed in
  const closeRef = useRef(close)
  useEffect(() => { closeRef.current = close })
  useEffect(() => {
    resetInputControls()
    const el = dialog.current
    el?.querySelector<HTMLElement>("button, input, select, textarea")?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") { e.preventDefault(); closeRef.current() }
      // keep the world's keys out of the form
      e.stopPropagation()
    }
    el?.addEventListener("keydown", onKey)
    return () => el?.removeEventListener("keydown", onKey)
  }, [])

  const save = async (): Promise<void> => {
    setBusy(true)
    const { gift: clean, warnings: w } = normalizeGift(draft)
    if (!writePersonalText(clean)) {
      setBusy(false)
      report("This browser would not save. Is storage blocked for this site?", true)
      return
    }
    // drop stored files nothing refers to any more
    try {
      const json = JSON.stringify(clean)
      for (const r of await listMedia()) if (!json.includes(r.id)) await deleteMedia(r.id)
    } catch { /* storage cleanup is best effort */ }
    if (w.length) console.warn("[personalize]", w)
    allowLeave()
    window.location.replace(window.location.pathname)
  }

  const reset = async (): Promise<void> => {
    setBusy(true)
    await clearPersonalData()
    allowLeave()
    window.location.replace(window.location.pathname)
  }

  const startOver = (): void => {
    clearProgress()
    allowLeave()
    window.location.replace(window.location.pathname)
  }

  const addModel = async (role: "explorer" | "companion", file: File | undefined): Promise<void> => {
    if (!file) return
    setBusy(true)
    try {
      const buffer = await readModelFile(file)
      const r = await checkCharacterModel(buffer)
      setReports((x) => ({ ...x, [role]: r }))
      if (!r.ok) { report("That model cannot be used yet. See the notes below it.", true); return }
      const record = await storeModel(file, buffer)
      update((g) => { g.characters[role].model = record.id })
      report("Model checked and added. It appears after you save.")
    } catch (error) {
      report(error instanceof MediaError ? error.message : "That model could not be read.", true)
    } finally {
      setBusy(false)
    }
  }

  const addMusic = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setBusy(true)
    try {
      const record = await importAudio(file)
      update((g) => { g.music = { src: record.id, title: record.label, credit: "" } })
      report("Track added.")
    } catch (error) {
      report(error instanceof MediaError ? error.message : "That track could not be added.", true)
    } finally {
      setBusy(false)
    }
  }

  const doExport = async (): Promise<void> => {
    setBusy(true)
    try {
      const blob = await exportBundle(normalizeGift(draft).gift)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "my-world.zip"
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      report("Exported. Keep the file safe: it contains your photos.")
    } catch {
      report("Export failed.", true)
    } finally {
      setBusy(false)
    }
  }

  const doImport = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setBusy(true)
    try {
      const r = await importBundle(file)
      setDraft(r.gift)
      report(r.warnings.length ? `Imported with ${r.warnings.length} note(s): ${r.warnings.slice(0, 3).join("; ")}` : "Imported. Review it, then save.", r.warnings.length > 0)
    } catch (error) {
      report(error instanceof Error ? error.message : "That file could not be imported.", true)
    } finally {
      setBusy(false)
    }
  }

  const m = draft.memories[memory]
  const setMemoryField = (k: keyof MemoryText, v: string | PhotoRef[]): void => update((g) => { (g.memories[memory] as Record<string, unknown>)[k] = v })

  return (
    <div className="pz-scrim">
      <div ref={dialog} className="pz-card" role="dialog" aria-modal="true" aria-labelledby="pz-title">
        <header className="pz-head">
          <div>
            <small>Personalize</small>
            <h2 id="pz-title">Make this world for someone</h2>
            <p>Everything here stays in this browser. Nothing is uploaded. Save to restart the world with your changes.</p>
          </div>
          <button className="pz-close" onClick={close} aria-label="Close without saving"><X /></button>
        </header>
        <nav className="pz-tabs" role="tablist" aria-label="Sections">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </nav>
        <div className="pz-body">
          {warnings.length > 0 && tab === "people" && (
            <div className="pz-note bad" role="status">Some saved values were not valid and fell back to defaults: {warnings.slice(0, 4).join("; ")}</div>
          )}
          {tab === "people" && (
            <section className="pz-grid">
              <Field label="Who is this world for?" value={draft.recipient.name} max={LIMITS.name} onChange={(v) => update((g) => { g.recipient.name = v })} hint="They play as the explorer." />
              <Field label="Who made it?" value={draft.creator.name} max={LIMITS.name} onChange={(v) => update((g) => { g.creator.name = v })} hint="You appear as the companion." />
              <label className="pz-field">
                <span className="pz-label">They are your…</span>
                <select value={draft.relationship.kind} onChange={(e) => update((g) => { g.relationship.kind = e.target.value as GiftConfig["relationship"]["kind"] })}>
                  <option value="friend">friend</option><option value="partner">partner</option><option value="family">family</option><option value="other">someone else</option>
                </select>
              </label>
              <Field label="In your own words (optional)" value={draft.relationship.label} max={LIMITS.name} placeholder="best friend, sister, grandad…" onChange={(v) => update((g) => { g.relationship.label = v })} />
              <label className="pz-field">
                <span className="pz-label">Occasion</span>
                <select value={draft.occasion.kind} onChange={(e) => update((g) => { g.occasion.kind = e.target.value as GiftConfig["occasion"]["kind"] })}>
                  <option value="celebration">a celebration</option><option value="birthday">a birthday</option><option value="anniversary">an anniversary</option><option value="diwali">Diwali</option><option value="holi">Holi</option><option value="eid">Eid</option><option value="christmas">Christmas</option><option value="navratri">Navratri</option><option value="onam">Onam</option><option value="pongal">Pongal</option><option value="baisakhi">Baisakhi</option><option value="raksha-bandhan">Raksha Bandhan</option><option value="gurpurab">Gurpurab</option><option value="none">no occasion</option>
                </select>
              </label>
              <div className="pz-field">
                <span className="pz-label">Fireworks on this day every year (optional)</span>
                <div className="pz-inline">
                  <select aria-label="Month" value={draft.occasion.month} onChange={(e) => update((g) => { g.occasion.month = +e.target.value })}>
                    <option value={0}>no date</option>
                    {MONTHS.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
                  </select>
                  <input aria-label="Day" type="number" min={0} max={31} value={draft.occasion.day} onChange={(e) => update((g) => { g.occasion.day = Math.max(0, Math.min(31, Math.round(+e.target.value) || 0)) })} />
                </div>
              </div>
              <Field label="Title card (optional)" value={draft.title.heading} max={LIMITS.short} placeholder={`A world for ${draft.recipient.name}`} onChange={(v) => update((g) => { g.title.heading = v })} />
              <Field label="Title card subtitle (optional)" value={draft.title.subtitle} max={LIMITS.short} placeholder={`Made by ${draft.creator.name}.`} onChange={(v) => update((g) => { g.title.subtitle = v })} />
            </section>
          )}
          {tab === "letter" && (
            <section className="pz-split">
              <div>
                <Field label="Heading" value={draft.letter.heading} max={LIMITS.short} onChange={(v) => update((g) => { g.letter.heading = v })} />
                <Field label="Greeting" value={draft.letter.greeting} max={LIMITS.short} onChange={(v) => update((g) => { g.letter.greeting = v })} />
                <ListField label="The letter" multiline items={draft.letter.paragraphs} separator={"\n\n"} max={LIMITS.paragraph * LIMITS.paragraphs}
                  hint="Leave an empty line between paragraphs."
                  parse={(v) => v.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).slice(0, LIMITS.paragraphs)}
                  onItems={(items) => update((g) => { g.letter.paragraphs = items })} />
                <Field label="Sign-off" value={draft.letter.signoff} max={LIMITS.short} onChange={(v) => update((g) => { g.letter.signoff = v })} />
                <Field label="Button" value={draft.letter.enter} max={LIMITS.name} onChange={(v) => update((g) => { g.letter.enter = v })} />
              </div>
              <LetterPreview g={draft} />
            </section>
          )}
          {tab === "memories" && (
            <section className="pz-split">
              <div>
                <div className="pz-stars" role="tablist" aria-label="Memory places">
                  {draft.memories.map((x, i) => (
                    <button key={i} role="tab" aria-selected={memory === i} className={memory === i ? "on" : ""} onClick={() => setMemory(i)} title={x.title}>{i + 1}</button>
                  ))}
                </div>
                <Field label="Title" value={m.title} max={LIMITS.short} onChange={(v) => setMemoryField("title", v)} />
                <Field label="A few words under the title" value={m.subtitle} max={LIMITS.short} onChange={(v) => setMemoryField("subtitle", v)} />
                <Field label="What happened, or what it means" multiline value={m.text} max={LIMITS.paragraph} onChange={(v) => setMemoryField("text", v)} />
                <Field label="More (optional)" multiline value={m.more} max={LIMITS.paragraph} onChange={(v) => setMemoryField("more", v)} />
                <div className="pz-inline">
                  <Field label="Where (optional)" value={m.place} max={LIMITS.short} onChange={(v) => setMemoryField("place", v)} />
                  <Field label="When (optional)" value={m.date} max={LIMITS.short} onChange={(v) => setMemoryField("date", v)} />
                </div>
                <span className="pz-label">Photos (the first develops on the card)</span>
                <PhotoList photos={m.photos} max={LIMITS.photosPerMemory} onChange={(p) => setMemoryField("photos", p)} local={local} want={want} busy={busy} setBusy={setBusy} report={report} />
              </div>
              <MemoryPreview m={m} n={memory + 1} local={local} />
            </section>
          )}
          {tab === "ending" && (
            <section className="pz-grid">
              <Field label="Closing card heading" value={draft.ending.heading} max={LIMITS.short} placeholder={`For ${draft.recipient.name}`} onChange={(v) => update((g) => { g.ending.heading = v })} />
              <ListField label="Closing card words" multiline items={draft.ending.lines} separator={"\n"} max={LIMITS.line * LIMITS.lines} hint="One line per row."
                parse={(v) => v.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, LIMITS.lines)}
                onItems={(items) => update((g) => { g.ending.lines = items })} />
              <Field label="The last line" value={draft.ending.closing} max={LIMITS.line} onChange={(v) => update((g) => { g.ending.closing = v })} />
              <Field label="When the fireworks start (optional)" value={draft.ending.fireworksLine} max={LIMITS.line} placeholder="Look up." onChange={(v) => update((g) => { g.ending.fireworksLine = v })} />
              <div className="pz-field pz-wide">
                <span className="pz-label">Photos on the closing card</span>
                <PhotoList photos={draft.ending.photos} max={LIMITS.endingPhotos} onChange={(p) => update((g) => { g.ending.photos = p })} local={local} want={want} busy={busy} setBusy={setBusy} report={report} />
              </div>
              {draft.secrets.map((s, i) => (
                <div className="pz-field pz-wide" key={i}>
                  <span className="pz-label">Hidden find {i + 1} (the cat leads you to it)</span>
                  <div className="pz-inline">
                    <Field label="Title" value={s.title} max={LIMITS.short} onChange={(v) => update((g) => { g.secrets[i].title = v })} />
                    <Field label="Words" value={s.text} max={LIMITS.line} onChange={(v) => update((g) => { g.secrets[i].text = v })} />
                  </div>
                  <PhotoList photos={s.photo ? [s.photo] : []} max={1} onChange={(p) => update((g) => { g.secrets[i].photo = p[0] ?? null })} local={local} want={want} busy={busy} setBusy={setBusy} report={report} />
                </div>
              ))}
            </section>
          )}
          {tab === "characters" && (
            <section className="pz-grid">
              {(["explorer", "companion"] as const).map((role) => (
                <div className="pz-field pz-character" key={role}>
                  <span className="pz-label">{role === "explorer" ? `The explorer (${draft.recipient.name} plays as them)` : `The companion (${draft.creator.name})`}</span>
                  <Field label="Name shown in the world" value={draft.characters[role].name} max={LIMITS.name} placeholder={role === "explorer" ? draft.recipient.name : draft.creator.name}
                    onChange={(v) => update((g) => { g.characters[role].name = v })} />
                  <label className="pz-field">
                    <span className="pz-label">Look</span>
                    <select value={draft.characters[role].preset} onChange={(e) => update((g) => { g.characters[role].preset = e.target.value })}>
                      {Object.entries(CHARACTER_PRESETS).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}
                    </select>
                  </label>
                  <div className="pz-inline">
                    <label className="pz-button">
                      <input type="file" accept=".glb,model/gltf-binary" disabled={busy} onChange={(e) => { void addModel(role, e.target.files?.[0]); e.target.value = "" }} />
                      Use my own model (.glb)
                    </label>
                    {draft.characters[role].model && <button type="button" className="pz-link" onClick={() => update((g) => { g.characters[role].model = "" })}>remove custom model</button>}
                  </div>
                  {reports[role] && (
                    <ul className={`pz-report${reports[role]!.ok ? "" : " bad"}`}>
                      {reports[role]!.problems.map((p) => <li key={p}>{p}</li>)}
                      {reports[role]!.notes.map((p) => <li key={p} className="note">{p}</li>)}
                    </ul>
                  )}
                  {role === "companion" && (
                    <>
                      <label className="pz-check"><input type="checkbox" checked={draft.characters.companion.follows} onChange={(e) => update((g) => { g.characters.companion.follows = e.target.checked })} /> Follows the explorer around</label>
                      <label className="pz-field">
                        <span className="pz-label">Talks</span>
                        <select value={draft.characters.companion.chatter} onChange={(e) => update((g) => { g.characters.companion.chatter = e.target.value as "often" | "sometimes" | "rarely" })}>
                          <option value="often">often</option><option value="sometimes">sometimes</option><option value="rarely">rarely</option>
                        </select>
                      </label>
                    </>
                  )}
                </div>
              ))}
              <p className="pz-note pz-wide">A custom model must be a rigged humanoid with the game's skeleton (docs/CHARACTER_ASSETS.md). Photos are never turned into 3D models: a picture of someone stays a picture.</p>
              <ListField label="Things the explorer says" multiline items={draft.chatter.explorer} separator={"\n"} max={LIMITS.short * LIMITS.chatter} hint="One line per row."
                parse={(v) => v.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, LIMITS.chatter)}
                onItems={(items) => update((g) => { g.chatter.explorer = items })} />
              <ListField label="Things the companion says" multiline items={draft.chatter.companion} separator={"\n"} max={LIMITS.short * LIMITS.chatter} hint="One line per row."
                parse={(v) => v.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, LIMITS.chatter)}
                onItems={(items) => update((g) => { g.chatter.companion = items })} />
            </section>
          )}
          {tab === "world" && (
            <section className="pz-grid">
              <Field label="The star-born Pegasus" value={draft.creatures.starborn} max={LIMITS.name} onChange={(v) => update((g) => { g.creatures.starborn = v })} />
              <Field label="The explorer's Pegasus" value={draft.creatures.explorerPegasus} max={LIMITS.name} onChange={(v) => update((g) => { g.creatures.explorerPegasus = v })} />
              <Field label="The companion's Pegasus" value={draft.creatures.companionPegasus} max={LIMITS.name} onChange={(v) => update((g) => { g.creatures.companionPegasus = v })} />
              <Field label="The golden dragon" value={draft.creatures.dragon} max={LIMITS.name} onChange={(v) => update((g) => { g.creatures.dragon = v })} />
              <Field label="The cat" value={draft.creatures.cat} max={LIMITS.name} onChange={(v) => update((g) => { g.creatures.cat = v })} />
              <ListField label="The space cats (captain first, commas between)" items={[...draft.creatures.spaceCats]} separator=", " max={LIMITS.name * 5}
                parse={(v) => { const n = v.split(",").map((x) => x.trim()); return draft.creatures.spaceCats.map((d, i) => n[i] || d) }}
                  onItems={(items) => update((g) => { g.creatures.spaceCats = items as GiftConfig["creatures"]["spaceCats"] })} />
              <Field label="The mountain valley" value={draft.places.valleyName} max={LIMITS.name} onChange={(v) => update((g) => { g.places.valleyName = v })} />
              <Field label="The bench above the valley" value={draft.places.benchName} max={LIMITS.name} onChange={(v) => update((g) => { g.places.benchName = v })} />
              <Field label="Café sign" value={draft.places.cafeSign} max={16} onChange={(v) => update((g) => { g.places.cafeSign = v })} />
              <Field label="Home's name (optional)" value={draft.world.home.label} max={LIMITS.name} placeholder="e.g. a town" onChange={(v) => update((g) => { g.world.home.label = v })} />
              <div className="pz-field">
                <span className="pz-label">Home on the globe (latitude, longitude)</span>
                <div className="pz-inline">
                  <input aria-label="Latitude" type="number" step={0.01} min={-85} max={85} value={draft.world.home.latitude} onChange={(e) => update((g) => { g.world.home.latitude = Math.max(-85, Math.min(85, +e.target.value || 0)) })} />
                  <input aria-label="Longitude" type="number" step={0.01} min={-180} max={180} value={draft.world.home.longitude} onChange={(e) => update((g) => { g.world.home.longitude = Math.max(-180, Math.min(180, +e.target.value || 0)) })} />
                </div>
                <span className="pz-hint">Where the opening journey lands, and the latitude of the night sky. A rough place is enough.</span>
              </div>
              <label className="pz-check pz-wide">
                <input type="checkbox" checked={draft.world.liveWeather} onChange={(e) => update((g) => { g.world.liveWeather = e.target.checked })} />
                Live weather: ask this browser for its location and fetch the local weather from Open-Meteo (coordinates rounded to about 1 km). Off by default.
              </label>
              <div className="pz-field">
                <span className="pz-label">Music</span>
                <select value={["default", "none"].includes(draft.music.src) ? draft.music.src : "custom"} onChange={(e) => update((g) => { if (e.target.value !== "custom") g.music = { src: e.target.value, title: "", credit: "" } })}>
                  <option value="default">the built-in track</option><option value="none">no music</option>
                  {!["default", "none"].includes(draft.music.src) && <option value="custom">your track: {draft.music.title || "added"}</option>}
                </select>
                <label className="pz-button">
                  <input type="file" accept="audio/mpeg,audio/ogg,audio/mp4,audio/wav,.mp3,.ogg,.m4a,.wav" disabled={busy} onChange={(e) => { void addMusic(e.target.files?.[0]); e.target.value = "" }} />
                  Add your own track
                </label>
                <span className="pz-hint">Only use music you have the right to share with the person you send this to.</span>
              </div>
              <label className="pz-field">
                <span className="pz-label">Accent colour</span>
                <input type="color" value={draft.theme.accent} onChange={(e) => update((g) => { g.theme.accent = e.target.value })} />
              </label>
            </section>
          )}
          {tab === "data" && (
            <section className="pz-grid">
              <div className="pz-note pz-wide">
                <p>Your words are kept in this browser's local storage and your photos, music and models in its IndexedDB, for this site only. They are not uploaded, and they stay on this device until you delete them (or clear this site's data). Someone using another browser or computer will not see them.</p>
                <p>To give this world to someone, export it and either send them the file to import here, or build your own copy with it (docs/CUSTOMIZATION.md).{hasBuildGift ? " This copy was built with its own personalization; what you save here is layered on top of it in this browser only." : ""}</p>
              </div>
              <button type="button" className="pz-button" disabled={busy} onClick={() => void doExport()}>Export this world (.zip)</button>
              <label className="pz-button">
                <input type="file" accept=".zip,application/zip" disabled={busy} onChange={(e) => { void doImport(e.target.files?.[0]); e.target.value = "" }} />
                Import a world (.zip)
              </label>
              <button type="button" className="pz-button" disabled={busy} onClick={startOver} title="Clears the stars, journal, photos taken in the game and map marks; keeps everything you personalized">Start the journey over</button>
              {!confirmDelete
                ? <button type="button" className="pz-button danger" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete everything personal from this browser</button>
                : <div className="pz-confirm pz-wide" role="alert">
                    <p>This removes every name, letter, photo, track and model saved here, then restarts with the built-in world. It cannot be undone.</p>
                    <button type="button" className="pz-button danger" disabled={busy} onClick={() => void reset()}>Yes, delete it all</button>
                    <button type="button" className="pz-link" onClick={() => setConfirmDelete(false)}>Keep it</button>
                  </div>}
            </section>
          )}
        </div>
        <footer className="pz-foot">
          <span className={`pz-message${message?.bad ? " bad" : ""}`} role="status" aria-live="polite">{busy ? "Working…" : message?.text ?? ""}</span>
          <button type="button" className="pz-link" onClick={close}>Close without saving</button>
          <button type="button" className="pz-primary" disabled={busy} onClick={() => void save()}>Save and restart the world</button>
        </footer>
      </div>
    </div>
  )
}
