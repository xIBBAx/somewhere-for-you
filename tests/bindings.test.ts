import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { resolveKeyAction } from "../src/game/input"
import { BINDINGS, codesOf, legendItems, isLive, FADE_AFTER, signatureLabel, type Binding, type Context } from "../src/game/controls/bindings"

// ACTION_KEYS is not exported from input.ts, so the keyboard map is read as text.
const inputSource = readFileSync(new URL("../src/game/input.ts", import.meta.url), "utf8")
const actionKeys = [...inputSource.matchAll(/\b(Key[A-Z]|Slash)\s*:\s*"(\w+)"/g)].map(m => ({ code: m[1], action: m[2] }))

describe("controls bindings", () => {
  it("every key a binding names is handled by input.ts", () => {
    const missing = BINDINGS.flatMap(b => codesOf(b).filter(code => !new RegExp(`\\b${code}\\b`).test(inputSource)).map(code => `${b.id}: ${code}`))
    expect(missing).toEqual([])
  })

  it("every action a binding names is the one input.ts maps the key to", () => {
    for (const b of BINDINGS.filter(x => x.action)) {
      for (const code of b.keys) {
        const flight = b.action === "landGallop" ? { mode: b.contexts.includes("landingRun") ? "ground" : "air", landing: { run: b.contexts.includes("landingRun") } } : undefined
        expect(resolveKeyAction(code, flight), `${b.id} (${code})`).toBe(b.action)
      }
    }
  })

  it("every key input.ts maps to an action is listed in the bindings", () => {
    const unlisted = actionKeys.filter(a => !BINDINGS.some(b => b.action === a.action && b.keys.includes(a.code)))
    expect(unlisted).toEqual([])
  })

  it("no two bindings share a key within a context", () => {
    const seen = new Map<string, string>()
    const clashes: string[] = []
    for (const b of BINDINGS) {
      for (const sig of b.keys) {
        for (const ctx of b.contexts as Context[]) {
          const k = `${ctx}:${sig}`
          const other = seen.get(k)
          if (other && other !== b.id) clashes.push(`${k} is both ${other} and ${b.id}`)
          seen.set(k, b.id)
        }
      }
    }
    expect(clashes).toEqual([])
  })

  it("ids are unique and every group has at least one live row", () => {
    const ids = BINDINGS.map(b => b.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const g of ["foot", "horse", "flight", "sail", "journey", "together", "camera", "help"] as const) {
      expect(BINDINGS.some(b => b.group === g && !b.pending), g).toBe(true)
    }
  })

  it("exposes integrated help and tricks, the star pirouette on the sails among them", () => {
    for (const id of ["callStarborn", "recover", "barrelRoll", "loop", "diveFlip", "corkscrew", "pirouette", "starPirouette", "launch", "worldMap"]) expect(isLive(id), id).toBe(true)
    expect(BINDINGS.some(b => b.pending)).toBe(false)
    expect(BINDINGS.find(b => b.id === "recover")?.action).toBe("recover")
  })

  it("renders key labels in plain language", () => {
    expect(signatureLabel("ShiftLeft+KeyC")).toBe("Shift+C")
    expect(signatureLabel("KeyA KeyA")).toBe("A A")
    expect(signatureLabel("Escape")).toBe("Esc")
  })

  it("the legend shows at most four live items per context, and drops items the player has learned", () => {
    const ctxs = ["footHorse", "horse", "flight", "sail", "journey", "pegasusGround", "landing", "landingRun"] as const
    for (const c of ctxs) {
      const items = legendItems(c, {})
      expect(items.length).toBeGreaterThan(0)
      expect(items.length).toBeLessThanOrEqual(4)
      expect(items.every((b: Binding) => !b.pending)).toBe(true)
    }
    const flight = legendItems("flight", {})
    const learned = Object.fromEntries(flight.map(b => [b.id, FADE_AFTER]))
    expect(legendItems("flight", learned).some(b => b.id === flight[0]!.id)).toBe(false)
  })
})
