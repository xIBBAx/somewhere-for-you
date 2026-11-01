import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { registerDevTool } from "../../dev/devTools"
import { useAdventures } from "../../state/adventureStore"
import { waterDepthAt } from "../../world/waterSurface"
import { nearbyWorldColliders } from "../../world/colliders"
import { renderedGroundHeight } from "../environment/ground/groundSurface"
import { aiIntents } from "../characters/controller/avatarController"
import { sfx } from "../audio/audio"
import { cameraRT, catRaceRT, catRT, characterRT, companionRT, playerRT, type AvatarBody, type CharacterId } from "../runtime"
import { togetherRT } from "../together/togetherState"
import { say } from "../together/Together"
import type { NavPoint } from "../navigation/catNavigation"
import { buildColliders } from "../world-layout"
import { activityRT, useActivityUI } from "./activityState"
import type { ActivityContext } from "./context"
import { chooseRaceCourse, obstaclesNear, routeCursor, type RaceCourse } from "./raceCourse"
import { confettiCelebration } from "../vfx/signatures"
import { names } from "../../personalization"

/**
 * Races (R): a beam of light appears a little way ahead; after a 3-2-1 the
 * first one there wins. The cat always joins in when she is close by, and
 * after the finale so does the other one of you. Opponents run a fair race:
 * slightly slower than a perfect sprint, a touch faster when far behind.
 * The course keeps clear of trees, buildings, rocks and lakes, and the rival
 * walks its route round them.
 */
const DISTANCE = 55
/** Shorter courses to try when the full distance has no clear way round. */
const COURSE_DISTANCES = [DISTANCE, 40, 28]
/** Obstacles this close to the runner shape the course. */
const COURSE_REACH = 80
const COUNTDOWN = 3
const LIMIT = 45
type Racer = "cat" | CharacterId
export const raceRT = {
  phase: "idle" as "idle" | "countdown" | "running" | "done",
  finish: new THREE.Vector3(),
  start: new THREE.Vector3(),
  runner: "explorer" as CharacterId,
  rivals: [] as Racer[],
  winner: null as Racer | null,
  pace: 0.95,
  doneTime: 0,
  /** the course from the start to the finish, and each rival's place along it */
  route: [] as NavPoint[],
  cursor: { cat: 0, explorer: 0, companion: 0 } as Record<Racer, number>,
}
const bodyOf = (id: CharacterId): AvatarBody => (id === "explorer" ? playerRT : companionRT)
const NAMES: Record<Racer, string> = { cat: `${names.cat}`, explorer: `${names.explorer}`, companion: `${names.companion}` }
/** The authored home colliders; the streamed wilds join them in planCourse. */
const home = buildColliders()

/** A rival who has finished, or whose race was called off, stops chasing the light. */
const releaseRivals = (): void => {
  for (const rival of raceRT.rivals) if (rival !== "cat") aiIntents[rival] = null
}

/** The cat's point of interest is the next waypoint, so she routes round what is in the way. */
const steerCat = (): void => {
  raceRT.cursor.cat = routeCursor(raceRT.route, catRT.pos, raceRT.cursor.cat)
  const goal = raceRT.route[raceRT.cursor.cat]
  catRT.poi ??= new THREE.Vector3()
  catRT.poi.set(goal.x, renderedGroundHeight(goal.x, goal.z), goal.z)
  // keep it the race's, so it is cleared when the race ends
  catRT.poiKind = "race"
}

/** The course ahead of the runner, round trees, buildings, rocks and lakes. */
const planCourse = (body: AvatarBody): RaceCourse | null => {
  const near = obstaclesNear(body.pos, COURSE_REACH, [...home.circles, ...nearbyWorldColliders], home.rects)
  return chooseRaceCourse(body.pos, body.facing, COURSE_DISTANCES, near.circles, near.rects, (x, z) => waterDepthAt(x, z) > 0)
}

export const startRace = (ctx: ActivityContext): boolean => {
  if (raceRT.phase !== "idle" || ctx.water !== "land") return false
  const course = planCourse(ctx.body)
  if (!course) {
    useActivityUI.getState().showResult("No room to race here", "Try somewhere more open, away from lakes and buildings.")
    return false
  }
  raceRT.finish.set(course.finish.x, renderedGroundHeight(course.finish.x, course.finish.z), course.finish.z)
  raceRT.route = course.route
  raceRT.cursor = { cat: 0, explorer: 0, companion: 0 }
  raceRT.runner = ctx.id
  raceRT.start.copy(ctx.body.pos)
  raceRT.rivals = []
  if (characterRT.active === "explorer" && catRT.pos.distanceTo(playerRT.pos) < 8) raceRT.rivals.push("cat")
  if (characterRT.companionPresent && togetherRT.distance < 12) raceRT.rivals.push(ctx.id === "explorer" ? "companion" : "explorer")
  if (raceRT.rivals.length === 0) raceRT.rivals.push("cat")
  raceRT.winner = null
  raceRT.pace = 0.9 + Math.random() * 0.08
  raceRT.phase = "countdown"
  activityRT.countdown = COUNTDOWN
  activityRT.raceTime = 0
  ctx.body.paused = true
  ctx.body.vel.set(0, 0, 0)
  // face the light
  ctx.body.facing = Math.atan2(raceRT.finish.x - ctx.body.pos.x, raceRT.finish.z - ctx.body.pos.z)
  // the camera swings round behind, so "forward" points at the light
  cameraRT.targetYaw = ctx.body.facing + Math.PI
  cameraRT.targetPitch = Math.min(cameraRT.targetPitch, 0.32)
  useActivityUI.getState().setMode("race")
  const partner = raceRT.rivals.find((r) => r !== "cat") as CharacterId | undefined
  if (partner) say(partner, partner === "companion" ? "You're going down." : "Last one there buys ice cream!", 2.6)
  sfx.pop()
  return true
}

export const cancelRace = (): void => {
  if (raceRT.phase === "idle") return
  bodyOf(raceRT.runner).paused = false
  releaseRivals()
  catRaceRT.active = false
  if (catRT.poiKind === "race") { catRT.poi = null; catRT.poiKind = "" }
  raceRT.phase = "idle"
  useActivityUI.getState().setMode("none")
}

const finishRace = (winner: Racer): void => {
  raceRT.winner = winner
  raceRT.phase = "done"
  raceRT.doneTime = 0
  releaseRivals()
  catRaceRT.active = false
  const runner = raceRT.runner
  const adventures = useAdventures.getState()
  adventures.bump("races", 1)
  const won = winner === runner
  const ui = useActivityUI.getState()
  if (won) {
    adventures.bump("raceWins", 1)
    const best = adventures.records.bestRace
    if (!best || activityRT.raceTime < best) adventures.setRecord("bestRace", activityRT.raceTime)
    ui.showResult("You won!", `${activityRT.raceTime.toFixed(1)} seconds. ${raceRT.rivals.includes("cat") ? `${names.cat} demands a rematch.` : "Champion of the meadow."}`)
    bodyOf(runner).celebrate = 1.4
    sfx.fanfare()
    const partner = raceRT.rivals.find((r) => r !== "cat") as CharacterId | undefined
    if (partner) say(partner, "Okay, okay, you're fast.", 3)
  } else {
    ui.showResult(`${NAMES[winner]} won`, winner === "cat" ? "Four legs is honestly cheating." : "So close! Press R for a rematch.")
    if (winner !== "cat") { bodyOf(winner).celebrate = 1.4; say(winner, "Ha! Again?", 2.6) }
  }
  confettiCelebration(raceRT.finish.clone().setY(raceRT.finish.y + 1.5), won)
}

export const updateRace = (ctx: ActivityContext): void => {
  if (raceRT.phase === "idle") return
  const runner = bodyOf(raceRT.runner)
  if (raceRT.phase === "countdown") {
    const before = Math.ceil(activityRT.countdown)
    activityRT.countdown -= ctx.dt
    if (Math.ceil(activityRT.countdown) !== before && activityRT.countdown > 0) sfx.pop()
    if (activityRT.countdown <= 0) {
      raceRT.phase = "running"
      runner.paused = false
      sfx.bell()
      if (raceRT.rivals.includes("cat")) {
        catRaceRT.active = true
        catRT.poi = raceRT.finish.clone()
        catRT.poiKind = "race"
      }
    }
    return
  }
  if (raceRT.phase === "running") {
    activityRT.raceTime += ctx.dt
    const toGo = (p: THREE.Vector3): number => Math.hypot(raceRT.finish.x - p.x, raceRT.finish.z - p.z)
    const mine = toGo(runner.pos)
    for (const rival of raceRT.rivals) {
      if (rival === "cat") {
        // stays within reach: a little faster when far behind, slower when far ahead
        const lead = mine - toGo(catRT.pos)
        catRaceRT.speed = THREE.MathUtils.clamp(6.25 - lead * 0.06, 5.2, 7.4) * (0.97 + raceRT.pace * 0.03)
        steerCat()
        if (toGo(catRT.pos) < 1.4) { finishRace("cat"); return }
      } else {
        const body = bodyOf(rival)
        const d = toGo(body.pos)
        const lead = mine - d
        const effort = THREE.MathUtils.clamp(raceRT.pace - lead * 0.008, 0.82, 1)
        // walk the course's waypoints, so a tree or building in the way is rounded
        const cursor = routeCursor(raceRT.route, body.pos, raceRT.cursor[rival])
        raceRT.cursor[rival] = cursor
        const goal = raceRT.route[cursor]
        const gd = Math.max(Math.hypot(goal.x - body.pos.x, goal.z - body.pos.z), 1e-3)
        aiIntents[rival] = { move: { x: (goal.x - body.pos.x) / gd * effort, y: (goal.z - body.pos.z) / gd * effort }, sprint: true, jump: false }
        if (d < 1.4) { finishRace(rival); return }
      }
    }
    if (mine < 1.4) { finishRace(raceRT.runner); return }
    if (activityRT.raceTime > LIMIT) { useActivityUI.getState().showResult("Time's up", "The light got bored and went home."); cancelRace() }
    return
  }
  if (raceRT.phase === "done") {
    raceRT.doneTime += ctx.dt
    if (raceRT.doneTime > 1.5) {
      if (catRT.poiKind === "race") { catRT.poi = null; catRT.poiKind = "" }
      raceRT.phase = "idle"
      useActivityUI.getState().setMode("none")
    }
  }
}

const spot = (p: { x: number; z: number }): { x: number; z: number } => ({ x: +p.x.toFixed(2), z: +p.z.toFixed(2) })
/** `__worldDev.race()`: the course, and where each racer is along it. */
const raceDevState = (): object => ({
  phase: raceRT.phase,
  runner: raceRT.runner,
  rivals: raceRT.rivals,
  winner: raceRT.winner,
  finish: spot(raceRT.finish),
  route: raceRT.route.map(spot),
  cursor: { ...raceRT.cursor },
  at: { explorer: spot(playerRT.pos), companion: spot(companionRT.pos), cat: spot(catRT.pos) },
})

/** The finish: a tall soft beam of light and a ring on the grass. */
export const RaceVisual = (): React.ReactElement => {
  const group = useRef<THREE.Group>(null)
  const beam = useMemo(() => new THREE.MeshBasicMaterial({ color: "#ffd98a", transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }), [])
  const ring = useMemo(() => new THREE.MeshBasicMaterial({ color: "#fff1c4", transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), [])
  useEffect(() => {
    if (import.meta.env.DEV) registerDevTool("race", raceDevState)
  }, [])
  useFrame((state) => {
    const g = group.current
    if (!g) return
    g.visible = raceRT.phase !== "idle"
    if (!g.visible) return
    g.position.copy(raceRT.finish)
    const pulse = 0.8 + Math.sin(state.clock.elapsedTime * 4) * 0.2
    beam.opacity = 0.32 * pulse
    ring.opacity = 0.75 * pulse
    g.rotation.y += 0.01
  })
  return (
    <group ref={group} visible={false}>
      <mesh material={beam} position={[0, 9, 0]}>
        <cylinderGeometry args={[0.55, 0.9, 18, 24, 1, true]} />
      </mesh>
      <mesh material={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
        <ringGeometry args={[1.25, 1.45, 48]} />
      </mesh>
    </group>
  )
}
