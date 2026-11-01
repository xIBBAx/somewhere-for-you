import { registerDevTool } from "../../dev/devTools"
import { avatarRT, characterRT, resetRuntime, worldRT } from "../runtime"
import { startMount } from "../horses/riding"
import { groundHeight } from "../world-layout"
import { canCarryRider, deerIdentity, SPECIES, SPECIES_IDS, type DeerSpecies } from "./species"
import { territoryAt } from "./population"
import { deerRT, makeDeer, type DeerMode, type DeerState } from "./state"
import { registerDeerMount } from "./interactions"
import { standable } from "../horses/horseMotion"
import { disposeDeerModel } from "./assets"
import { beginDeerAffection } from "./affection"

/** Entire installation is behind import.meta.env.DEV. Repro scenarios use
 * normal controllers and inputs; they never unlock trust in production. */
export const installDeerDev = (): void => {
  registerDevTool("deer", (() =>
    [...deerRT.animals.values()].map((d) => ({
      id: d.ident.id,
      name: d.ident.name,
      species: d.ident.species,
      age: d.ident.age,
      sex: d.ident.sex,
      rare: d.ident.rare,
      x: d.x,
      y: d.y,
      z: d.z,
      heading: d.heading,
      mode: d.mode,
      alarm: d.alarm,
      trust: d.relationships,
      visible: d.visible,
      loaded: !!d.model,
      rider: d.rider,
    }))) as never)
  registerDevTool("deerStats", (() => deerRT.stats) as never)
  // QA: ride the nearest rideable deer (trust granted, rider set beside her)
  registerDevTool("mountDeer", (() => {
    const me = avatarRT()
    const id = characterRT.active
    let best: DeerState | null = null, bestD = Infinity
    for (const d of deerRT.animals.values()) {
      if (d.rider || !canCarryRider(d.ident)) continue
      const dist = Math.hypot(d.x - me.pos.x, d.z - me.pos.z)
      if (dist < bestD) { bestD = dist; best = d }
    }
    if (!best) return null
    const r = best.relationships[id]
    Object.assign(r, { trust: 1, fear: 0, kindness: Math.max(4, r.kindness), encounters: Math.max(2, r.encounters) })
    // bring the deer to the rider: teleporting the rider instead bumps her
    // placement revision, and riding then cancels the mount on its next step
    const a = me.facing + Math.PI / 2
    best.x = me.pos.x + Math.sin(a) * 1.4
    best.z = me.pos.z + Math.cos(a) * 1.4
    best.y = groundHeight(best.x, best.z)
    best.heading = me.facing
    best.speed = 0
    best.targetSpeed = 0
    return { name: best.ident.name, species: best.ident.species, result: startMount(id, best) }
  }) as never)
  // QA: the nearest deer is stroked by the active character (the gentle-touch path, trust aside)
  registerDevTool("deerPet", (() => {
    const me = avatarRT()
    let best: DeerState | null = null
    for (const d of deerRT.animals.values()) if (!d.rider && (!best || Math.hypot(d.x - me.pos.x, d.z - me.pos.z) < Math.hypot(best.x - me.pos.x, best.z - me.pos.z))) best = d
    if (!best) return null
    beginDeerAffection(characterRT.active, best)
    return { name: best.ident.name, x: best.x, y: best.y, z: best.z, distance: Math.hypot(best.x - me.pos.x, best.z - me.pos.z) }
  }) as never)
  registerDevTool("deerScenario", ((species: DeerSpecies = "sambar", seed = 2038) => {
    if (!SPECIES_IDS.includes(species)) return null
    for (const [id, d] of deerRT.animals)
      if (id.startsWith("deer:90000,") && !d.rider) {
        if (d.model) disposeDeerModel(d.model)
        deerRT.animals.delete(id)
      }
    const me = avatarRT(),
      homeX = me.pos.x + 6,
      homeZ = me.pos.z + 3
    let x = homeX,
      z = homeZ
    for (let n = 0; n < 32; n++) {
      const a = n * 0.63
      x = homeX + Math.sin(a) * n * 0.28
      z = homeZ + Math.cos(a) * n * 0.28
      if (standable(x, z, 0.9)) break
    }
    const out = []
    for (let n = 0; n < 3; n++) {
      const id = `deer:90000,${seed}:${n}`,
        ident = deerIdentity(
          id,
          seed + n * 127,
          species,
          `qa:${seed}`,
          n === 0 ? "female" : "male",
          n === 2 ? "fawn" : "adult",
          n === 2 ? `deer:90000,${seed}:0` : null,
        )
      const hx = x + n * 3,
        hz = z
      const home = { ident, x: hx, z: hz, shelterX: hx + 4, shelterZ: hz - 4, waterX: hx, waterZ: hz, hasWater: false }
      const d = makeDeer(home, Date.now() / 1000)
      d.x = hx
      d.z = hz
      d.y = groundHeight(hx, hz)
      d.heading = Math.PI / 2
      d.debugMode = "graze"
      deerRT.animals.set(id, d)
      registerDeerMount(d)
      out.push(id)
    }
    return { ids: out, x, z, height: SPECIES[species].height }
  }) as never)
  registerDevTool("deerLook", ((id: string, az = 90, dist = 5) => {
    const d = deerRT.animals.get(id)
    if (!d) return null
    const a = d.heading + (az * Math.PI) / 180,
      H = SPECIES[d.ident.species].height * d.ident.scale
    Object.assign(worldRT.inspectionCamera, {
      active: true,
      follow: false,
      px: d.x + Math.sin(a) * dist,
      py: d.y + H * 0.9,
      pz: d.z + Math.cos(a) * dist,
      tx: d.x,
      ty: d.y + H * 0.8,
      tz: d.z,
    })
    return true
  }) as never)
  registerDevTool("deerMode", ((id: string, mode: DeerMode | null) => {
    const d = deerRT.animals.get(id)
    if (d) {
      d.debugMode = mode
      d.modeTime = 0
    }
    return d?.mode
  }) as never)
  registerDevTool("deerFind", ((species: DeerSpecies) => {
    const me = avatarRT(),
      tx = Math.floor(me.pos.x / 192),
      tz = Math.floor(me.pos.z / 192)
    for (let radius = 0; radius < 45; radius++)
      for (let z = -radius; z <= radius; z++)
        for (let x = -radius; x <= radius; x++) {
          if (Math.max(Math.abs(x), Math.abs(z)) !== radius) continue
          const t = territoryAt(tx + x, tz + z)
          if (t?.species === species) {
            const h = t.members[0]
            resetRuntime({ x: h.x - 7, z: h.z })
            return { id: h.ident.id, x: h.x, z: h.z }
          }
        }
    return null
  }) as never)
}
