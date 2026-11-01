import { horseRT, makeHorseState } from "./horseState"
import { makeIdentity, type BreedId } from "./breeds"
import { subscribeChunks } from "../../world/worldRuntime"
import { B, BIOME_COUNT, biomeWeights } from "../../world/climate"
import { hash3, rng } from "../../world/noise"
import { CHUNK_SIZE, WORLD_SEED } from "../../world/worldConfig"
import { HUB_CENTER } from "../../world/hubLayout"
import { standable } from "./horseMotion"
import { disposeHorseModel } from "./horseAssets"
import { qualityRT } from "../../state/qualityStore"
import { territoryPhase } from "../../world/wildlife/territoryClock"

/**
 * Wild herds in the endless world. Open meadows beyond home may
 * hold a small band (a mare-led group of three to six), deterministic per
 * chunk so the same horses with the same coats and temperaments are there
 * every visit. Bands stream in and out with the chunks; a horse is never
 * dropped while someone is riding it.
 */
type Spawn = { id: string; seed: number; breed: BreedId; x: number; z: number; chunk: string }
const byChunk = new Map<string, Spawn[]>()

/** Unloaded wild bands continue a slow, shared grazing circuit. Bonded and
 * home horses retain their existing saved position and active controller. */
export const wildHorsePosition = (s: Spawn, time: number): { x: number; z: number } => {
  const [cx,cz]=s.chunk.split(",").map(Number)
  const seed=hash3(WORLD_SEED ^ 0x4f5e,cx,cz)
  const phase=territoryPhase(seed%720,time,720+seed%120)*Math.PI*2
  const x=s.x+Math.sin(phase)*7,z=s.z+Math.cos(phase)*5
  return standable(x,z,.9)?{x,z}:{x:s.x,z:s.z}
}

export const herdFor = (cx: number, cz: number): Spawn[] => {
  const out: Spawn[] = []
  const ox = cx * CHUNK_SIZE + CHUNK_SIZE / 2
  const oz = cz * CHUNK_SIZE + CHUNK_SIZE / 2
  if (Math.hypot(ox - HUB_CENTER.x, oz - HUB_CENTER.z) < 150) return out
  const r = rng(hash3(WORLD_SEED ^ 0x4f5e, cx, cz))
  const w = biomeWeights(ox, oz, new Float32Array(BIOME_COUNT))
  const open = w[B.meadow] + w[B.flowerMeadow] * 0.8 + w[B.lakeside] * 0.5
  if (r() > open * 0.16) return out
  // most bands are mustangs; a few are mixed ranch horses turned out to graze
  const ranch = r() < 0.3
  const pool: BreedId[] = ranch ? ["quarter", "arabian", "thoroughbred", "andalusian", "draft"] : ["mustang"]
  const count = 3 + Math.floor(r() * 4)
  let cxh = 0
  let czh = 0
  for (let tries = 0; tries < 8; tries++) {
    cxh = ox + (r() - 0.5) * CHUNK_SIZE * 0.6
    czh = oz + (r() - 0.5) * CHUNK_SIZE * 0.6
    if (standable(cxh, czh, 0.9)) break
  }
  for (let i = 0; i < count; i++) {
    for (let t = 0; t < 6; t++) {
      const x = cxh + (r() - 0.5) * 14
      const z = czh + (r() - 0.5) * 14
      if (!standable(x, z)) continue
      const seed = hash3(WORLD_SEED ^ 0x77aa, cx * 31 + i, cz * 17 + i)
      out.push({ id: `wild:${cx}:${cz}:${i}`, seed, breed: pool[Math.floor(r() * pool.length)], x, z, chunk: `${cx},${cz}` })
      break
    }
  }
  return out
}

export const spawnWildHerds = (): (() => void) => {
  const unsub = subscribeChunks({
    onChunkReady: (chunk) => { if (!byChunk.has(chunk.key)) byChunk.set(chunk.key, herdFor(chunk.cx, chunk.cz)) },
    onChunkUnload: (chunk) => { byChunk.delete(chunk.key) },
  })
  return () => {
    unsub()
    byChunk.clear()
  }
}

let refresh = 0
/** Keep the nearest bands live within the quality budget. */
export const wildHorsesTick = (dt: number, px: number, pz: number): void => {
  refresh -= dt
  if (refresh > 0) return
  refresh = 0.75
  const limit = Math.max(4, Math.round(qualityRT.profile.animals * 0.6))
  const range = qualityRT.profile.animalRange + 30
  const wanted: Spawn[] = []
  for (const list of byChunk.values()) for (const s of list) if (Math.hypot(s.x - px, s.z - pz) < range) wanted.push(s)
  wanted.sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz))
  const keep = new Set(wanted.slice(0, limit).map((s) => s.id))
  for (const [id, h] of horseRT.horses) {
    if (h.persistent || h.rider || h.reservedBy) continue
    if (!keep.has(id)) {
      if (h.model) disposeHorseModel(h.model)
      horseRT.horses.delete(id)
    }
  }
  const bands = new Map<string, ReturnType<typeof makeHorseState>[]>()
  for (const s of wanted.slice(0, limit)) {
    if (horseRT.horses.has(s.id)) continue
    const ident = makeIdentity(s.seed, s.breed)
    ident.id = s.id
    const at = wildHorsePosition(s, Date.now()/1000)
    const h = makeHorseState(ident, at.x, at.z, false, s.chunk)
    h.homeX=s.x;h.homeZ=s.z
    horseRT.horses.set(s.id, h)
    const band = bands.get(s.chunk) ?? []
    band.push(h)
    bands.set(s.chunk, band)
  }
  for (const band of bands.values()) for (let i = 0; i < band.length; i++) band[i].buddy = band[(i + 1) % band.length]
}
