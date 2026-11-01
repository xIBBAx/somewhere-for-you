import { describe, expect, it } from "vitest"
import { MAX_REMEMBERED_DISCOVERIES, readDiscoveryMemory, rememberDiscovery, serializeDiscoveryMemory } from "../src/world/discoveryMemory"

describe("discovery progress", () => {
  it("reads the existing save format and remembers discoveries exactly once", () => {
    const memory = readDiscoveryMemory('["find:1:-2","lm:2:4","find:1:-2",42,null]')
    expect(memory.total).toBe(2)
    expect(rememberDiscovery(memory, "lm:2:4")).toBe(false)
    expect(rememberDiscovery(memory, "friend:cat:calico")).toBe(true)
    expect(readDiscoveryMemory(serializeDiscoveryMemory(memory))).toEqual(memory)
  })

  it("bounds both saves and live state during a very long exploration", () => {
    const memory = readDiscoveryMemory(null)
    for (let i = 0; i < 14000; i++) rememberDiscovery(memory, `find:${i}:0`)
    expect(memory.found.size).toBe(MAX_REMEMBERED_DISCOVERIES)
    expect(memory.total).toBe(14000)
    expect(memory.found.has("find:13999:0")).toBe(true)
    const reloaded = readDiscoveryMemory(serializeDiscoveryMemory(memory))
    expect(reloaded).toEqual(memory)
    expect(rememberDiscovery(reloaded, "find:13999:0")).toBe(false)
    expect(serializeDiscoveryMemory(memory).length).toBeLessThan(120000)
  })

  it("rejects malformed or oversized storage without breaking the world", () => {
    for (const raw of ["{", '"unexpected"', '{"ids":{},"total":-3}', " ".repeat(750001)]) {
      expect(readDiscoveryMemory(raw)).toEqual({ found: new Set(), total: 0 })
    }
  })
})
