import { navigationSnapshot } from "../navigation/navigationState"
import { useNavigation } from "../../state/navigationStore"
import { useObservation } from "../../state/observationStore"
import { observationJourney, observationPoint } from "./observations"
import { registerDevTool } from "../../dev/devTools"
import { postRT } from "../render/PostFX"
import { spaceRT } from "./spaceState"
import { universe } from "./universe"
import { landsRT } from "../../world/render/HorizonLands"
import { celestialDrawRT } from "./render/drawState"
import { formatRealDistance } from "./scale"
import { skyCommands } from "../../state/skyStore"
import { sailRT } from "./starSail"
import * as THREE from "three"
import { worldRT } from "../runtime"
import { KM } from "./scale"
import { ridingCelestial } from "./CelestialController"
import { flightOf } from "../pegasus/flight"
import { placeInSpace } from "./starSail"
import { SITE_BY_ID, siteDirection, siteUniverse } from "./realm/lunarSites"
import { realmLocalOf, realmRT } from "./realm/realmState"
import { lunarSceneRT } from "./realm/LunarScene"
import { realmGround } from "../../world/realmHook"
import { groundHeight } from "../world-layout"
import { avatarRT } from "../runtime"
import { lightingRT } from "../environment/Lighting"
import { spaceCatsRT } from "./spaceCats/catsRuntime"
import { l1Point } from "./spaceCats/journey"
import { CAT_STAGES, saveVoyage, voyage, type CatJourney } from "./voyageMemory"
import { travelInfo, travelRT } from "./cosmicTravel"
import { ringRT } from "./rings/ringPhysics"
import { travelCommands } from "../../state/travelStore"

/**
 * `?debug` helpers for the sky beyond the air:
 *   __worldDev.space()        mode, realm, the camera's universe position, height, nearest world
 *   __worldDev.lands()        the horizon lands' build state
 *   __worldDev.bodies()       every body's distance from the eye (real units)
 *   __worldDev.skyGo("moon")  set a destination and let Starborn sail there
 *   __worldDev.skyHome()      homeward
 *   __worldDev.spaceView("saturn", 400000, 0.3)  free deep-space camera: a world seen from a
 *                            height (real km) over its sunlit side, tilted off the nadir
 *                            (0 at its centre … 1 at its limb); spaceView(null) ends it
 *   __worldDev.cats()         the space cats: stage, phase, distance, each cat's place and doing
 *   __worldDev.catsJump(300)  riding Starborn: into deep space this far (m) from the crew, facing them
 *   __worldDev.catStage("met", 1)  set the cats' stage (and Moon landings) and re-read it
 *   __worldDev.catLook("pixel", 1.4, 40, 0.3)  a camera on one cat: distance, bearing (deg), height
 */
export const installCelestialDev = (): void => {
  registerDevTool("navigation", () => {
    const s = navigationSnapshot(useNavigation.getState().destination, 70)
    return { actor: { x: s.x, y: s.y, z: s.z, heading: s.heading, airborne: s.airborne },
      realm: spaceRT.realm, deep: spaceRT.mode === "deep", sky: s.sky, north: s.north, reference: s.reference,
      destination: useNavigation.getState().destination, name: s.name, detail: s.detail, arrived: s.arrived,
      bearing: s.bearing, bearingText: s.bearingText, elevation: s.elevation,
      course: s.flight ? { ...s.flight, point: s.flight.point.toArray() } : null }
  })
  // Canonical live state for the existing cloud-driver. Importing arbitrary
  // Vite URLs in a QA page can instantiate a second HMR-versioned store.
  registerDevTool("observation", () => {
    const s = useObservation.getState(), h = ridingCelestial()
    return { journey: s.journey, stop: s.stop, ready: s.ready, progress: s.progress, completed: s.completed,
      holding: s.holding, reading: s.reading, memories: [...(voyage.observations ?? [])],
      mounted: h?.ident.name ?? null, autopilot: sailRT.autopilot, mode: spaceRT.mode }
  })
  registerDevTool("observationPlace", () => {
    const state = useObservation.getState(), h = ridingCelestial()
    const journey = state.journey ? observationJourney(state.journey) : undefined
    const body = journey ? universe.byId.get(journey.body) : undefined, sun = universe.byId.get("sun")
    if (!h || !journey || !body || !sun) return { placed: false, reason: "Mount the star-born Pegasus and choose a journey with its actual UI button first." }
    const point = observationPoint(journey, state.stop, body, sun, new THREE.Vector3())
    placeInSpace(h, point, point.clone().sub(body.pos))
    worldRT.inspectionCamera.active = false
    return { placed: true, journey: journey.id, stop: state.stop }
  })
  registerDevTool("space", () => ({
    mode: spaceRT.mode, realm: spaceRT.realm, eye: spaceRT.eye.toArray().map((v) => +v.toFixed(1)),
    altitude: +spaceRT.altitude.toFixed(1), earthAltitude: +spaceRT.earthAltitude.toFixed(1), skyAltitude: +spaceRT.skyAltitude.toFixed(1), weatherAltitude: +spaceRT.weatherAltitude.toFixed(1), nearest: spaceRT.nearest?.def.id,
    thin: +spaceRT.thin.toFixed(3), target: spaceRT.target, speed: +spaceRT.speed.toFixed(1), stars: celestialDrawRT.stars, drawn: celestialDrawRT.visible,
  }))
  registerDevTool("lands", () => ({ ...landsRT }))
  // render forensics (the ascent blackout was found this way): three itself, and the HDR chain
  registerDevTool("THREE", () => THREE)
  registerDevTool("composer", () => postRT.composer)
  registerDevTool("skyGo", ((id: string) => { skyCommands.target = id; skyCommands.travel = true; return id }) as never)
  registerDevTool("skyHome", () => { skyCommands.home = true; return true })
  // cosmic travel: journey("mars") / journey("earth", "quick"), and its state
  registerDevTool("journey", ((id: string, style: "cinematic" | "quick" = "cinematic") => {
    travelCommands.go = { dest: id === "earth" ? { kind: "earth" } : id === "cats" ? { kind: "cats" } : id === "rings" ? { kind: "rings" } : { kind: "body", id }, style }
    return id
  }) as never)
  registerDevTool("rings", () => ({ ...ringRT }))
  // QA: move her straight up or down through Saturn's ring plane by dy game metres
  registerDevTool("ringNudge", ((dy: number) => {
    const sat = universe.byId.get("saturn")
    if (!sat) return false
    spaceRT.pos.addScaledVector(sat.pole, dy)
    return true
  }) as never)
  registerDevTool("travel", () => ({ ...travelInfo(), intensity: +travelRT.intensity.toFixed(2), heat: +travelRT.heat.toFixed(2), pull: +travelRT.pull.toFixed(2), mode: spaceRT.mode, realm: spaceRT.realm, nearest: spaceRT.nearest?.def.id, altitude: Math.round(spaceRT.altitude) }))
  registerDevTool("spaceView", ((id: string | null, km = 1000, tilt = 0.6) => {
    if (id === null) {
      spaceRT.mode = "local"
      spaceRT.frozenTime = null
      worldRT.inspectionCamera.active = false
      return false
    }
    const b = universe.byId.get(id)
    if (!b) return null
    const sun = universe.byId.get("sun")!
    // over the sunlit side, a little toward the terminator for relief
    const n = b === sun ? new THREE.Vector3(0.3, 0.8, 0.5).normalize() : sun.pos.clone().sub(b.pos).normalize()
    const side = new THREE.Vector3(0, 1, 0).cross(n).normalize()
    n.applyAxisAngle(side, 0.7).normalize()
    spaceRT.frozenTime = spaceRT.frozenTime ?? worldRT.timeOfDay
    spaceRT.mode = "deep"
    spaceRT.pos.copy(b.pos).addScaledVector(n, b.radius + km * KM)
    spaceRT.park.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n)
    spaceRT.anchor.set(0, 5000, 0)
    // the camera looks at the world's centre, tilted toward its limb
    // (tilt 0 = straight down, 1 = at the limb)
    const limb = Math.asin(b.radius / (b.radius + km * KM))
    const a = limb * tilt
    const look = new THREE.Vector3(0, -Math.cos(a), -Math.sin(a))
    Object.assign(worldRT.inspectionCamera, { active: true, follow: false, px: 0, py: 5000, pz: 0, tx: look.x * 10, ty: 5000 + look.y * 10, tz: look.z * 10 })
    return { id, km }
  }) as never)
  registerDevTool("sail", () => ({ autopilot: sailRT.autopilot, notice: sailRT.notice, descending: sailRT.descending, touchdowns: sailRT.touchdowns }))
  // over a lunar site (real km above it), riding Starborn: the Moon's ground takes over on the way down
  registerDevTool("moonJump", ((site = "apollo11", km = 60, east = 0) => {
    const h = ridingCelestial()
    const moon = universe.byId.get("moon")
    if (!h || !moon) return "ride the star-born Pegasus first (__worldDev.ridePegasus('starborn'))"
    flightOf(h)
    const p = new THREE.Vector3()
    if (!siteUniverse(site, moon, km * KM, p)) return `unknown site ${site}`
    // a few metres to one side (east of the site, along the Moon's east), so as not to land on the hardware
    if (east) p.add(moon.pole.clone().cross(p.clone().sub(moon.pos)).normalize().multiplyScalar(east))
    placeInSpace(h, p, p.clone().sub(moon.pos))
    return { site, km }
  }) as never)
  registerDevTool("realm", () => {
    const h = ridingCelestial()
    return {
      body: realmRT.body?.def.id ?? null, version: realmRT.version, grid: !!realmRT.grid, gravity: realmGround.gravityScale,
      frame: [spaceRT.frame.ox, spaceRT.frame.oz], mount: h ? [+h.x.toFixed(2), +h.y.toFixed(2), +h.z.toFixed(2)] : null,
      ground: h ? +groundHeight(h.x, h.z).toFixed(3) : null, mode: h?.flight?.mode ?? null, trail: realmRT.trail,
    }
  })
  registerDevTool("sites", () => ({
    built: lunarSceneRT.built, rocks: lunarSceneRT.rocks,
    placed: Object.fromEntries([...lunarSceneRT.placed].filter(([, v]) => v).map(([k, v]) => [k, [+v!.x.toFixed(1), +v!.z.toFixed(1), +v!.nx.toFixed(3), +v!.nz.toFixed(3)]])),
  }))
  // a camera on a site: `dist` m off its anchor on a compass bearing, `up` m above the dust, looking at it
  registerDevTool("siteView", ((id: string, dist = 14, up = 3, bearing = 120, lookUp = 1) => {
    const pl = lunarSceneRT.placed.get(id)
    if (!pl) return null
    const b = (bearing * Math.PI) / 180
    const e = Math.sin(b) * dist, n = Math.cos(b) * dist
    const x = pl.x - pl.nz * e + pl.nx * n, z = pl.z + pl.nx * e + pl.nz * n
    const y = groundHeight(x, z) + up
    Object.assign(worldRT.inspectionCamera, { active: true, follow: false, px: x, py: y, pz: z, tx: pl.x, ty: groundHeight(pl.x, pl.z) + lookUp, tz: pl.z })
    return [x, y, z]
  }) as never)
  // QA: record the call stack of any jump of the ridden mount's x by over a kilometre
  registerDevTool("watchMount", () => {
    const h = ridingCelestial() as unknown as Record<string, number> | null
    if (!h) return false
    let x = h.x
    Object.defineProperty(h, "x", {
      get: () => x,
      set: (v: number) => {
        if (Math.abs(v - x) > 1000) realmRT.trail.push(`x ${x.toFixed(0)}→${v.toFixed(0)} ${(new Error().stack ?? "").split("\n").slice(2, 7).map((l) => l.trim().replace(/https?:\/\/[^/]+/g, "").replace(/\?[^:)]*/g, "")).join(" | ")}`)
        x = v
      },
      configurable: true,
    })
    return true
  })
  registerDevTool("lights", () => ({ ...lightingRT }))
  registerDevTool("uniPos", () => {
    const m = universe.byId.get("moon")!, e = universe.byId.get("earth")!
    return { moon: m.pos.toArray().map((v) => Math.round(v)), earth: e.pos.toArray().map((v) => Math.round(v)), mode: spaceRT.mode, frozen: spaceRT.frozenTime, tod: +worldRT.timeOfDay.toFixed(5), override: worldRT.timeOverride }
  })
  registerDevTool("siteLocal", ((id: string) => {
    const s = SITE_BY_ID.get(id)
    if (!s) return null
    const d = siteDirection(s, new THREE.Vector3())
    const l = realmLocalOf(d, new THREE.Vector3())
    return { d: d.toArray(), local: l?.toArray() ?? null, frame: [spaceRT.frame.ox, spaceRT.frame.oz, spaceRT.frame.radius], m: realmRT.localToBody.elements.map((v) => +v.toFixed(4)) }
  }) as never)
  registerDevTool("realmHeights", ((n = 8) => {
    // CPU heights on a ring round the avatar (GPU agreement is checked in tests)
    const p = avatarRT().pos
    return Array.from({ length: n }, (_, i) => +groundHeight(p.x + Math.cos(i) * 5, p.z + Math.sin(i) * 5).toFixed(3))
  }) as never)
  registerDevTool("bodies", () => universe.bodies.map((b) => ({ id: b.def.id, distance: formatRealDistance(b.pos.distanceTo(spaceRT.eye)) })))
  registerDevTool("cats", () => ({
    stage: voyage.cats, landings: voyage.moonLandings, phase: spaceCatsRT.phase, following: spaceCatsRT.following,
    distance: Number.isFinite(spaceCatsRT.mountDistance) ? +spaceCatsRT.mountDistance.toFixed(1) : null, canGather: spaceCatsRT.canGather,
    noticed: spaceCatsRT.noticed, target: spaceRT.target,
    cats: spaceCatsRT.cats.map((c) => ({ id: c.id, at: [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)], act: c.act, visible: c.visible, loaded: c.loaded })),
  }))
  registerDevTool("catProbe", () => ({ cats: spaceCatsRT.probe(), eye: spaceRT.camLocal.toArray().map((v) => +v.toFixed(2)) }))
  // every space-cat model and rack helmet in the whole scene (a duplicate would show here)
  registerDevTool("catCount", (() => {
    let models = 0, racked = 0
    spaceCatsRT.scene?.traverse((o) => { if (o.name.startsWith("space-cat-model-")) models++; if (o.name.startsWith("rack-helmet-")) racked++ })
    return { models, racked }
  }) as never)
  registerDevTool("catsJump", ((dist = 300) => {
    const h = ridingCelestial()
    if (!h) return "ride the star-born Pegasus first (__worldDev.ridePegasus('starborn'))"
    flightOf(h)
    const pod = new THREE.Vector3()
    if (!l1Point(pod)) return "no universe yet"
    const moon = universe.byId.get("moon")!
    // on the Moon's side of them, a little off the line, so they are seen against the stars
    const away = moon.pos.clone().sub(pod).normalize()
    const side = moon.pole.clone().cross(away).normalize()
    const p = pod.clone().addScaledVector(away, dist * 0.94).addScaledVector(side, dist * 0.34)
    placeInSpace(h, p, side.clone().cross(away).normalize())
    // face them
    const d = pod.clone().sub(p).applyQuaternion(spaceRT.park.clone().invert()).normalize()
    h.heading = Math.atan2(d.x, d.z)
    h.flight!.pitch = Math.asin(Math.max(-1, Math.min(1, d.y)))
    h.flight!.throttle = 0.1
    return { dist, at: p.toArray().map((v) => Math.round(v)) }
  }) as never)
  registerDevTool("catStage", ((stage: CatJourney, landings?: number) => {
    if (!CAT_STAGES.includes(stage)) return `stage is one of ${CAT_STAGES.join(", ")}`
    voyage.cats = stage
    if (landings !== undefined) voyage.moonLandings = landings
    saveVoyage()
    spaceCatsRT.reset = true
    return { stage: voyage.cats, landings: voyage.moonLandings }
  }) as never)
  // a camera kept on one cat until catLook(null) (or look(null), which frees the camera)
  registerDevTool("catLook", ((id: string | null, dist = 1.4, bearing = 40, up = 0.3) => {
    if (id === null) { spaceCatsRT.look = null; worldRT.inspectionCamera.active = false; return null }
    const c = spaceCatsRT.cats.find((x) => x.id === id)
    if (!c) return null
    spaceCatsRT.look = { id: c.id, dist, bearing, up }
    return [c.x, c.y, c.z]
  }) as never)
}
