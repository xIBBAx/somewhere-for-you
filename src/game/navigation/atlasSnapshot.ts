import * as THREE from "three"
import { useGame } from "../../state/gameStore"
import { avatarRT, characterRT } from "../runtime"
import { discoveriesNear, discoveryRT, textFor } from "../../world/discoveries"
import { MEMORIES } from "../../content/memories"
import { BENCH_ID, BENCH_NAME, HIGHVALE_NAME } from "../../world/highvale/highvaleNames"
import { HIGHVALE_ARRIVAL } from "../../world/highvale/highvaleLayout"
import { BENCH_WORLD } from "../../world/highvale/highvaleStructures"
import { STAR_NOOK } from "../../world/starNookLayout"
import { SITES } from "../../world/sites/siteLayout"
import { localAxes, localToUniverse } from "../celestial/frames"
import { spaceRT } from "../celestial/spaceState"
import { bodyById, universe } from "../celestial/universe"
import { riderRT } from "../horses/riding"
import { groundHeight } from "../world-layout"
import { realmLocalOf } from "../celestial/realm/realmState"
import { siteDirection } from "../celestial/realm/lunarSites"
import { HOME, useNavigation, type Destination } from "../../state/navigationStore"
import { siteUniverse, LUNAR_SITES } from "../celestial/realm/lunarSites"
import { voyage } from "../celestial/voyageMemory"
import { l1Point, waitingInSpace } from "../celestial/spaceCats/journey"
import { skyPoint } from "./atlasMath"
import { horseRT, type HorseState } from "../horses/horseState"
import { pegasusRT } from "../pegasus/pegasi"

export type AtlasMarker = { destination: Destination; x: number; z: number; found: boolean; glyph: string }
/** What a place not yet found is called on a map: that something is there, never what. */
export const UNFOUND_NAME = "Somewhere yet to find"
/**
 * Every Earth marker around (x, z): home, the memories, the real places, the
 * generated landmarks within `range`, the little finds near `near` (where the explorer
 * is: finds are only sensed close by), and her own marks. A landmark not yet
 * found shows that it is there, not what it is.
 */
export const earthMarkers = (x: number, z: number, range: number, near: { x: number; z: number } = { x, z }): AtlasMarker[] => {
  const markers: AtlasMarker[] = [{ destination: HOME, x: HOME.x, z: HOME.z, found: true, glyph: "home" },
    { destination: { kind: "earth", id: "star-nook", name: "Star Nook", ...STAR_NOOK }, ...STAR_NOOK, found: voyage.cats === "settled", glyph: "star" }]
  for (const memory of MEMORIES) markers.push({ destination: { kind: "earth", id: memory.id, name: memory.title, x: memory.worldPosition[0], z: memory.worldPosition[2] }, x: memory.worldPosition[0], z: memory.worldPosition[2], found: !!useGame.getState().visited[memory.id], glyph: "memory" })
  for (const site of SITES) markers.push({ destination: { kind: "earth", id: site.id, name: site.id, x: site.x, z: site.z }, x: site.x, z: site.z, found: true, glyph: "place" })
  // Highvale: the village, and the bench on the meadow above the river
  markers.push({ destination: { kind: "earth", id: "highvale", name: HIGHVALE_NAME, ...HIGHVALE_ARRIVAL }, ...HIGHVALE_ARRIVAL, found: true, glyph: "place" })
  markers.push({ destination: { kind: "earth", id: BENCH_ID, name: BENCH_NAME, ...BENCH_WORLD }, ...BENCH_WORLD, found: true, glyph: "place" })
  const add = (d: ReturnType<typeof discoveriesNear>[number]): void => {
    const found = discoveryRT.found.has(d.id), landmark = d.category === "landmark"
    const name = landmark && !found ? UNFOUND_NAME : textFor(d).text.title
    markers.push({ destination: { kind: "earth", id: d.id, name, x: d.x, z: d.z }, x: d.x, z: d.z, found, glyph: landmark ? found ? "place" : "unknown" : "find" })
  }
  for (const d of discoveriesNear(x, z, range, 0, [])) if (d.category === "landmark") add(d)
  for (const d of discoveriesNear(near.x, near.z, 0, Math.min(range, 100), [])) if (d.category === "find") add(d)
  for (const mark of useNavigation.getState().marks) markers.push({ destination: mark, x: mark.x, z: mark.z, found: false, glyph: "mark" })
  return markers
}

export type CompanionMarker = { id: string; name: string; kind: "own" | "starborn"; x: number; z: number }
const STARBORN_ID = "pegasus:starborn"
/** Your own Pegasus and Starborn, read from the live herd. A winged horse someone
 * is riding sits under that rider's own arrow, so it is not drawn twice. */
export const companionMarkers = (): CompanionMarker[] => {
  const out: CompanionMarker[] = []
  const own = horseRT.horses.get(pegasusRT.own[characterRT.active]), star = horseRT.horses.get(STARBORN_ID)
  const add = (h: HorseState | undefined, kind: CompanionMarker["kind"]): void => {
    if (h && !h.rider) out.push({ id: h.ident.id, name: h.ident.name, kind, x: h.x, z: h.z })
  }
  add(own, "own"); add(star, "starborn")
  return out
}

export const navigatorActor = () => {
  const body = avatarRT(), rider = riderRT[characterRT.active], mount = rider.phase === "riding" ? rider.horse : null
  return { x: mount?.x ?? body.pos.x, y: mount ? mount.y + mount.jumpY : body.pos.y, z: mount?.z ?? body.pos.z, heading: mount?.heading ?? body.facing, mounted: !!mount,
    airborne: (mount?.jumpY ?? 0) > 0.15 || !!(mount && "flight" in mount && mount.flight && (mount.flight as { mode: string }).mode !== "ground") || body.jumpHeight > 0.15 }
}
const point = new THREE.Vector3(), delta = new THREE.Vector3(), axes = new THREE.Quaternion()
export const navigatorPosition = (out: THREE.Vector3): THREE.Vector3 => {
  if (spaceRT.mode === "deep") return out.copy(spaceRT.pos)
  const actor = navigatorActor()
  return localToUniverse(spaceRT.frame, actor.x, actor.y, actor.z, out)
}
export const navigatorAxes = (out: THREE.Quaternion): THREE.Quaternion => {
  if (spaceRT.mode === "deep") return out.copy(spaceRT.park)
  const actor = navigatorActor()
  return localAxes(spaceRT.frame, actor.x, actor.z, out)
}

export type SkyMarker = ReturnType<typeof skyPoint> & { destination: Destination; color: string; surfaceDistance: number; meanAltitude: number }
export const celestialMarkers = (): SkyMarker[] => {
  const position = navigatorPosition(point)
  navigatorAxes(axes).invert()
  const entries = universe.bodies.map(b => ({ destination: { kind: "body", id: b.def.id, name: b.def.name } as Destination, point: b.pos, radius: b.radius, color: new THREE.Color().fromArray(b.def.color).getStyle() }))
  const moon = bodyById("moon")
  if (moon && spaceRT.realm === "moon") for (const site of LUNAR_SITES) {
    const p = new THREE.Vector3()
    const local = realmLocalOf(siteDirection(site, new THREE.Vector3()), p)
    if (local) localToUniverse(spaceRT.frame, local.x, groundHeight(local.x, local.z), local.z, p)
    else if (!siteUniverse(site.id, moon, 0, p)) continue
    if (local) entries.push({ destination: { kind: "site", id: site.id, name: site.title }, point: p, radius: 0, color: "#ecce8e" })
  }
  if (waitingInSpace(voyage)) {
    const p = new THREE.Vector3()
    if (l1Point(p)) entries.push({ destination: { kind: "cats", id: "space-cats", name: voyage.cats === "unseen" ? "Five little lights" : "The space cats" }, point: p, radius: 0, color: "#e8bd82" })
  }
  const far = Math.max(1, ...entries.map(e => e.point.distanceTo(position)))
  return entries.map(e => {
    delta.copy(e.point).sub(position).applyQuaternion(axes)
    const projected = skyPoint(delta.x, delta.y, delta.z, far)
    const meanAltitude = projected.distance - e.radius
    return { ...projected, destination: e.destination, color: e.color, surfaceDistance: Math.max(0, meanAltitude), meanAltitude }
  })
}
