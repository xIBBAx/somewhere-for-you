import type { Relationship, RelationshipPair } from "./relationships"
import { relationships } from "./relationships"

export const DEER_MEMORY_KEY = "gift-world/deer/v1"
export const MAX_DEER_MEMORIES = 384
export type DeerMemory = { id: string; relationships: RelationshipPair; x: number; z: number; updated: number }
export const deerMemories = new Map<string, DeerMemory>()
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x)
const clamp = (x: number): number => Math.max(0, Math.min(1, x))
const readRelation = (value: unknown): Relationship | null => {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  if (![v.trust, v.fear, v.encounters, v.kindness, v.scares, v.lastSeen, v.lastKind].every(finite)) return null
  return {
    trust: clamp(v.trust as number),
    fear: clamp(v.fear as number),
    encounters: Math.max(0, Math.min(10000, v.encounters as number)),
    kindness: Math.max(0, Math.min(10000, v.kindness as number)),
    scares: Math.max(0, Math.min(10000, v.scares as number)),
    accepted: v.accepted === true,
    lastSeen: v.lastSeen as number,
    lastKind: v.lastKind as number,
    calm: 0,
    space: 0,
  }
}
export const parseDeerMemories = (raw: string | null): Map<string, DeerMemory> => {
  const out = new Map<string, DeerMemory>()
  try {
    if (!raw || raw.length > 350000) return out
    const data = JSON.parse(raw)
    if (data.v !== 1 || !Array.isArray(data.animals)) return out
    for (const a of data.animals.slice(-MAX_DEER_MEMORIES)) {
      if (
        !a ||
        typeof a.id !== "string" ||
        !/^deer:-?\d+,-?\d+:\d+$/.test(a.id) ||
        a.id.length > 80 ||
        ![a.x, a.z, a.updated].every(finite)
      )
        continue
      const m = readRelation(a.relationships?.explorer),
        i = readRelation(a.relationships?.companion)
      if (m && i)
        out.set(a.id, { id: a.id, x: a.x, z: a.z, updated: a.updated, relationships: { explorer: m, companion: i } })
    }
  } catch {
    /* A corrupt save must never prevent wildlife from loading. */
  }
  return out
}
export const rememberDeer = (memory: DeerMemory): void => {
  if (memory.id.startsWith("deer:90000,")) return // development scenarios never enter a save
  // Only deliberately encountered individuals consume persistent storage.
  if (memory.relationships.explorer.lastSeen === 0 && memory.relationships.companion.lastSeen === 0) return
  deerMemories.delete(memory.id)
  deerMemories.set(memory.id, {
    ...memory,
    relationships: { explorer: { ...memory.relationships.explorer }, companion: { ...memory.relationships.companion } },
  })
  while (deerMemories.size > MAX_DEER_MEMORIES) deerMemories.delete(deerMemories.keys().next().value!)
}
export const restoreRelationship = (id: string): RelationshipPair => {
  const r = deerMemories.get(id)?.relationships
  return r ? { explorer: { ...r.explorer }, companion: { ...r.companion } } : relationships()
}
export const loadDeerMemories = (): void => {
  try {
    for (const [id, m] of parseDeerMemories(localStorage.getItem(DEER_MEMORY_KEY))) deerMemories.set(id, m)
  } catch {
    /* storage unavailable */
  }
}
export const saveDeerMemories = (): void => {
  try {
    localStorage.setItem(DEER_MEMORY_KEY, JSON.stringify({ v: 1, animals: [...deerMemories.values()] }))
  } catch {
    /* bounded in-memory relationships still work */
  }
}
