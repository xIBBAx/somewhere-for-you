import { registerDevTool } from "../../dev/devTools"
import { avatarRT, catRT, worldRT } from "../../game/runtime"
import { hash3 } from "../noise"
import { COATS, WILD_CAT_COATS, type Species } from "./animalAssets"
import type { AnimalAgent } from "./behavior"
import { breedSize } from "./population"
import { wildlifeRT } from "./runtime"

/**
 * QA helpers for the wildlife (only with ?debug in development):
 *
 *   __worldDev.cats()                     the wild cats around, with breed and state
 *   __worldDev.catParade()                every wild breed sitting in rows ahead, facing her
 *   __worldDev.catParade(["Siamese", 9])  just these (names or coat indices)
 *   __worldDev.catParade(null)            clear the parade
 *   __worldDev.catLook("Siamese", az, d)  frame the nearest cat of that breed (az: radians off its nose);
 *                                        "cat" frames the explorer's own cat (read only)
 *   __worldDev.animalLook("duck", az, d, "white duck")  frame the nearest animal of a species (optionally of one coat)
 */
export const installWildlifeDev = (): void => {
  registerDevTool("cats", (() =>
    [...wildlifeRT.walkers.values()].filter((a) => a.species === "cat").map((a) => ({
      id: a.id, breed: COATS.cat[a.coat % COATS.cat.length].name, state: a.state,
      x: +a.x.toFixed(1), y: +a.y.toFixed(2), z: +a.z.toFixed(1), scale: +a.scale.toFixed(2),
      distance: +Math.hypot(a.x - avatarRT().pos.x, a.z - avatarRT().pos.z).toFixed(1),
    }))) as never)

  registerDevTool("catParade", ((which?: Array<string | number> | null) => {
    if (which === null) { wildlifeRT.extra = []; return [] }
    const all = Array.from({ length: WILD_CAT_COATS }, (_, i) => i)
    const coats = which === undefined ? all : which.map((w) => typeof w === "number" ? w : COATS.cat.findIndex((c) => c.name === w))
      .filter((i) => i >= 0 && i < WILD_CAT_COATS)
    const body = avatarRT()
    const fx = Math.sin(body.facing), fz = Math.cos(body.facing)
    const columns = 6
    wildlifeRT.extra = coats.map((coat, n) => {
      const col = n % columns - (columns - 1) / 2, row = Math.floor(n / columns)
      const ahead = 3 + row * 1.4, side = col * 1.05
      return {
        id: `parade:${n}`, species: "cat" as const, coat, seed: hash3(n, coat, 77), scale: breedSize("cat", coat),
        x: body.pos.x + fx * ahead + fz * side, z: body.pos.z + fz * ahead - fx * side,
      }
    })
    return wildlifeRT.extra.map((s) => ({ breed: COATS.cat[s.coat].name, x: +s.x.toFixed(1), z: +s.z.toFixed(1) }))
  }) as never)

  registerDevTool("catLook", ((breed: string, az = 0.5, distance = 1.1) => {
    let best: { x: number; y: number; z: number; heading: number; scale: number } | null = null, bestD = Infinity
    if (breed === "cat") best = { x: catRT.pos.x, y: catRT.pos.y, z: catRT.pos.z, heading: catRT.facing, scale: 1 }
    else for (const a of wildlifeRT.walkers.values()) {
      if (a.species !== "cat" || COATS.cat[a.coat % COATS.cat.length].name !== breed) continue
      const d = Math.hypot(a.x - avatarRT().pos.x, a.z - avatarRT().pos.z)
      if (d < bestD) { bestD = d; best = a }
    }
    if (!best) return null
    frame(best, az, distance)
    return { breed, x: +best.x.toFixed(2), z: +best.z.toFixed(2), scale: +best.scale.toFixed(2) }
  }) as never)

  registerDevTool("animalLook", ((species: Species, az = 0.5, distance = 1.1, coat?: string) => {
    let best: AnimalAgent | null = null, bestD = Infinity
    for (const a of wildlifeRT.walkers.values()) {
      if (a.species !== species) continue
      if (coat && COATS[species][a.coat % COATS[species].length].name !== coat) continue
      const d = Math.hypot(a.x - avatarRT().pos.x, a.z - avatarRT().pos.z)
      if (d < bestD) { bestD = d; best = a }
    }
    if (!best) return null
    frame(best, az, distance)
    return { species, coat: COATS[species][best.coat % COATS[species].length].name, x: +best.x.toFixed(2), z: +best.z.toFixed(2) }
  }) as never)
}

/** The inspection camera on an animal's front quarter, at its own scale. */
const frame = (a: { x: number; y: number; z: number; heading: number; scale: number }, az: number, distance: number): void => {
  const yaw = a.heading + az, k = a.scale
  Object.assign(worldRT.inspectionCamera, {
    active: true, follow: false,
    px: a.x + Math.sin(yaw) * distance * k, py: a.y + 0.32 * k, pz: a.z + Math.cos(yaw) * distance * k,
    tx: a.x + Math.sin(a.heading) * 0.06 * k, ty: a.y + 0.2 * k, tz: a.z + Math.cos(a.heading) * 0.06 * k,
  })
}
