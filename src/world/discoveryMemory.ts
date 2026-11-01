/** Only deliberate discoveries are saved. Both the parsed input and resident
 * ID set are bounded; exploring new terrain alone never adds entries. */
export const MAX_REMEMBERED_DISCOVERIES = 5000
export type DiscoveryMemory = { found: Set<string>; total: number }

const validId = (value: unknown): value is string => typeof value === "string" && value.length <= 100 && /^(find:|lm:|friend:)/.test(value)

export const readDiscoveryMemory = (raw: string | null): DiscoveryMemory => {
  try {
    if (!raw || raw.length > 750_000) return { found: new Set(), total: 0 }
    const data: unknown = JSON.parse(raw)
    const record = data && typeof data === "object" ? data as { ids?: unknown; total?: unknown } : {}
    const entries = Array.isArray(data) ? data : Array.isArray(record.ids) ? record.ids : []
    const found = new Set(entries.slice(-MAX_REMEMBERED_DISCOVERIES).filter(validId))
    const total = typeof record.total === "number" && Number.isSafeInteger(record.total) ? Math.max(found.size, record.total) : found.size
    return { found, total }
  } catch { return { found: new Set(), total: 0 } }
}

export const rememberDiscovery = (memory: DiscoveryMemory, id: string): boolean => {
  if (!validId(id) || memory.found.has(id)) return false
  memory.found.add(id)
  memory.total = Math.min(Number.MAX_SAFE_INTEGER, memory.total + 1)
  while (memory.found.size > MAX_REMEMBERED_DISCOVERIES) memory.found.delete(memory.found.values().next().value!)
  return true
}

export const serializeDiscoveryMemory = (memory: DiscoveryMemory): string => JSON.stringify({ version: 2, ids: [...memory.found], total: memory.total })
