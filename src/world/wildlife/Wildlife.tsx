import { useFrame } from "@react-three/fiber"
import { awayFromEarth } from "../realmHook"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { sfx } from "../../game/audio/audio"
import { input, avatarRT, worldRT } from "../../game/runtime"
import { useDiscoveries } from "../../state/discoveryStore"
import { useGame } from "../../state/gameStore"
import { qualityRT } from "../../state/qualityStore"
import { collidersForChunk } from "../colliders"
import { discoveriesNear, discoveryRT, markFound, type Discovery } from "../discoveries"
import { hash3 } from "../noise"
import { subscribeChunks } from "../worldRuntime"
import { COATS, WILD_CAT_COATS, disposeAnimalModel, isPrimate, makeAnimalModel, preloadAnimals, type AnimalModel, type Species } from "./animalAssets"
import { createAnimalAgent, moveAnimal, separateAnimals, spreadAlarm, spreadWaterVisits, thinkAnimal, type AnimalAgent } from "./behavior"
import { WATER_WAYS } from "../creatureWater"
import type { AnimalEnv } from "./rhythm"
import { weatherRT } from "../../game/weather/weatherState"
import { windRT } from "../wind"
import { breedSize, selectWithCats, spawnsForChunk, wildlifeTier, type AnimalSpawn, type WildlifeTier } from "./population"
import { applyCatBuild } from "./catBreeds"
import { installWildlifeDev } from "./wildlifeDev"
import { QuadrupedAnimator, type AnimalPose } from "./QuadrupedAnimator"
import { PrimateAnimator, type PrimatePose } from "./PrimateAnimator"
import { wildlifeRT, wildlifeStats } from "./runtime"
import { groundHeight } from "../../game/world-layout"
import { glideTo, makeGlide, type Glide } from "../../utils/renderGlide"
import { fadeByDistance, makeFadeable } from "../render/aerialFog"
import { affectionDrift } from "../../game/vfx/signatures"

const VERBS: Record<Species, string> = {
  cat: "pet the cat",
  rabbit: "say hi to the bunny",
  deer: "greet the deer gently",
  fox: "wave at the fox",
  duck: "toss some crumbs",
  horse: "greet the horse",
  monkey: "wave to the monkey",
  tiger: "greet the tiger from here",
  cheetah: "wave to the cheetah",
  gorilla: "say hello to the gorilla",
}

const FRIEND_LINES: Record<Species, string[]> = {
  cat: ["Purring at maximum volume. You have a new best friend.", "A slow blink: in cat, that means I love you.", "The cat has decided to follow you for a while."],
  rabbit: ["The bunny did a happy little binky.", "Nose wiggles of approval."],
  deer: ["The deer let you come close. A very gentle hello.", "Soft eyes, softer steps. The forest trusts you."],
  fox: ["The fox did a playful little pounce for you.", "A curious fox, a curious visitor. Instant friends."],
  duck: ["Quack. (That's a thank-you.)", "The ducks would like you to visit every day."],
  horse: ["A soft nicker and a curious ear. Hello, meadow friend."],
  monkey: ["The monkey pauses to look your way, then goes back to exploring."],
  tiger: ["The tiger gives a slow blink beneath the trees. A quiet forest hello."],
  cheetah: ["Spotted fur, bright eyes, and a peaceful moment in the meadow."],
  gorilla: ["A thoughtful glance from the silverback. You share the shade for a moment."],
}

type Agent = AnimalAgent & {
  models: Array<AnimalModel | null>; animators: Array<QuadrupedAnimator | PrimateAnimator | null>; loading: boolean[]
  simTime: number; animationTime: number; visualX: number; visualY: number; visualZ: number; visualHeading: number; tier: WildlifeTier
  /** 0..1 how present it is: it fades in when it joins the nearest few and out
   * when it leaves them (`leaving`), rather than popping */
  appear: number; leaving: boolean; glide: Glide
}
const disposeAgent = (a: Agent): void => { for (const m of a.models) if (m) disposeAnimalModel(m) }

/** React owns one group; the bounded population, simulation and skeletal poses
 * mutate outside React. No visited region retains a live animal instance. */
export const Wildlife = (): React.ReactElement => {
  const root = useMemo(() => { const g = new THREE.Group(); g.name = "wildlife"; return g }, [])
  const sys = useMemo(() => ({
    byChunk: new Map<string, AnimalSpawn[]>(), agents: new Map<string, Agent>(), scratch: [] as Discovery[], refresh: 0,
    player: { x: 0, z: 0, facing: 0, speed: 0 },
    env: { tod: 0, rain: 0, windX: 1, windZ: 0 } as AnimalEnv,
    pose: { dt: 0, time: 0, speed: 0, turnRate: 0, sit: 0, sleep: 0, graze: 0, happy: 0, swim: 0, lookYaw: 0, lookPitch: 0, slope: 0, crossSlope: 0, fullIK: true } as AnimalPose,
    primate: { dt: 0, time: 0, speed: 0, turnRate: 0, sit: 0, sleep: 0, climb: 0, air: 0, crouch: 0,
      lookYaw: 0, lookPitch: 0, eat: 0, groom: 0, happy: 0, alert: 0, fullIK: true } as PrimatePose,
  }), [])

  useEffect(() => {
    void preloadAnimals()
    wildlifeRT.walkers = sys.agents
    if (import.meta.env.DEV) installWildlifeDev()
    const unsubscribe = subscribeChunks({
      onChunkReady: (chunk) => {
        if (chunk.payload && !sys.byChunk.has(chunk.key)) sys.byChunk.set(chunk.key, spawnsForChunk(chunk.cx, chunk.cz, chunk.payload.hasWater, collidersForChunk(chunk.payload)))
      },
      onChunkUnload: chunk => { sys.byChunk.delete(chunk.key) },
    })
    wildlifeRT.snapshots = () => [...sys.agents.values()].map(a => ({ id: a.id, species: a.species, coat: a.coat, x: a.x, y: a.y, z: a.z,
      state: a.state, act: a.act, thirst: a.thirst, sheltered: a.sheltered, speed: a.speed, travelled: a.travelled, heading: a.heading, tier: a.tier, rendered: a.models.some(m => m?.root.visible),
      homeX: a.homeX, homeZ: a.homeZ, scale: a.scale, groundOffset: a.groundOffset ?? 0,
      bath: a.bathKind, swim: a.swim, wet: a.water.wet, inWater: a.water.inWater, depth: a.water.depth }))
    return () => {
      unsubscribe()
      for (const a of sys.agents.values()) disposeAgent(a)
      sys.agents.clear(); sys.byChunk.clear(); root.clear()
      if (wildlifeRT.walkers === sys.agents) wildlifeRT.walkers = new Map()
      wildlifeRT.snapshots = () => []; wildlifeRT.nearAnimal = null; discoveryRT.animalPrompt = null
    }
  }, [sys, root])

  const interact = (a: Agent): void => {
    sfx.sparkle()
    affectionDrift(new THREE.Vector3(a.x, a.y + 0.5, a.z))
    a.happy = 1; a.friendTime = a.species === "cat" ? 60 : 8
    a.state = a.species === "cat" || a.species === "fox" ? "sit" : a.species === "duck" ? "swim" : "watch"
    a.timer = 5; a.targetSpeed = 0
    avatarRT().facing = Math.atan2(a.x - avatarRT().pos.x, a.z - avatarRT().pos.z)
    avatarRT().gesture = a.species === "cat" ? "pet" : a.species === "deer" ? "wish" : "cheer"
    avatarRT().gestureTime = 0
    avatarRT().paused = a.species === "cat" || a.species === "deer"
    avatarRT().vel.set(0, 0, 0)
    const coat = COATS[a.species][a.coat % COATS[a.species].length]
    const fresh = markFound(`friend:${a.species}:${coat.name}`)
    const lines = coat.lines ?? FRIEND_LINES[a.species]
    const full = coat.name.includes(a.species) ? coat.name : `${coat.name} ${a.species}`
    useDiscoveries.getState().refreshCount()
    useDiscoveries.getState().showToast({ title: fresh ? `New friend: ${/^[aeiou]/i.test(full) ? "an" : "a"} ${full}` : `Hello again, ${coat.name}`,
      line: lines[Math.floor(a.random() * lines.length)], kind: a.species })
  }

  useFrame((state, rawDt) => {
    // on the Moon: home's life waits, paused, for the riders to come back
    if (awayFromEarth(avatarRT().pos)) return
    const started = performance.now(), dt = Math.min(rawDt, 0.1)
    const px = avatarRT().pos.x, pz = avatarRT().pos.z
    Object.assign(sys.player, { x: px, z: pz, speed: avatarRT().speed, facing: avatarRT().facing })
    Object.assign(sys.env, { tod: worldRT.timeOfDay, rain: weatherRT.rain, windX: windRT.dirX, windZ: windRT.dirZ })
    sys.refresh -= dt
    if (sys.refresh <= 0) {
      sys.refresh = 0.5
      const candidates: AnimalSpawn[] = []
      for (const list of sys.byChunk.values()) for (const s of list) if (s.species !== "deer") candidates.push(s)
      for (const d of discoveriesNear(px, pz, qualityRT.profile.animalRange, 0, sys.scratch)) {
        if (d.kind !== "catNap") continue
        for (let i = 0; i < 3; i++) {
          const angle = i / 3 * Math.PI * 2 + 0.4, lx = Math.cos(angle) * 1.3, lz = Math.sin(angle) * 1.3
          const coat = (d.seed + i * 3) % WILD_CAT_COATS
          candidates.push({ id: `nap:${d.id}:${i}`, species: "cat", coat,
            seed: hash3(d.seed, i, 17), scale: (0.94 + i * 0.04) * breedSize("cat", coat), x: d.x + lx * Math.cos(d.rot) + lz * Math.sin(d.rot),
            z: d.z - lx * Math.sin(d.rot) + lz * Math.cos(d.rot), sleeper: true, groundOffset: 0.061 })
        }
      }
      // Rank existing animals at their current position, including a following
      // friend. They still consume slots within the same hard limit.
      for (const a of sys.agents.values()) if (Math.hypot(a.x - px, a.z - pz) < qualityRT.profile.animalRange) candidates.push(a)
      const selected = selectWithCats(candidates, px, pz, qualityRT.profile.animals, qualityRT.profile.cats, qualityRT.profile.animalRange)
      // QA only (__worldDev.catParade): always present, outside the budget
      selected.push(...wildlifeRT.extra)
      const keep = new Set(selected.map(s => s.id))
      for (const [id, a] of sys.agents) a.leaving = !keep.has(id)
      for (const s of selected) if (!sys.agents.has(s.id)) {
        const a = createAnimalAgent(s)
        if (s.id.startsWith("parade:")) { a.state = "sit"; a.timer = 1e5; a.heading = Math.atan2(px - a.x, pz - a.z) }
        sys.agents.set(s.id, { ...a, models: [null, null], animators: [null, null], loading: [false, false], simTime: 0,
          animationTime: 1, visualX: a.x, visualY: a.y, visualZ: a.z, visualHeading: a.heading, tier: "near",
          glide: makeGlide(), appear: s.id.startsWith("parade:") ? 1 : 0, leaving: false })
      }
      wildlifeStats.known = candidates.length; wildlifeStats.active = sys.agents.size
    }
    let nearest: Agent | null = null, nearestD = Infinity
    wildlifeStats.near = 0; wildlifeStats.middle = 0; wildlifeStats.far = 0; wildlifeStats.rendered = 0
    for (const [id, a] of sys.agents) {
      a.appear = Math.min(1, Math.max(0, a.appear + (a.leaving ? -dt : dt) * 1.6))
      if (a.leaving && a.appear <= 0) { disposeAgent(a); sys.agents.delete(id); continue }
      const dist = Math.hypot(a.x - px, a.z - pz)
      a.tier = wildlifeTier(dist, qualityRT.profile.animalRange)
      if (a.tier === "off") { for (const m of a.models) if (m) m.root.visible = false; continue }
      wildlifeStats[a.tier]++
      const period = a.tier === "near" ? 0 : a.tier === "middle" ? 0.1 : 0.5
      a.simTime += dt; a.animationTime += dt
      if (a.simTime >= period) {
        thinkAnimal(a, sys.player, a.simTime, a.tier === "near", sys.env)
        moveAnimal(a, sys.player, a.simTime)
        a.simTime = 0
      }
      const lod = a.tier === "far" ? 1 : 0
      if (!a.models[lod] && !a.loading[lod]) {
        a.loading[lod] = true
        void makeAnimalModel(a.species, a.coat, lod).then(m => {
          a.loading[lod] = false
          if (!m) return
          if (sys.agents.get(a.id) !== a) { disposeAnimalModel(m); return }
          m.root.name = `${a.id}:lod${lod}`
          // A breed's head, ears and fold belong to the rest pose the animator captures.
          const coat = COATS[a.species][a.coat % COATS[a.species].length]
          if (a.species === "cat") applyCatBuild(m, coat.build)
          // Capture rig rest transforms at identity before applying instance scale.
          const animator = isPrimate(a.species) ? new PrimateAnimator(a.species, m, a.seed) : new QuadrupedAnimator(a.species, m, a.seed)
          if (animator instanceof QuadrupedAnimator) { animator.tailSize = coat.build?.tail ?? 1; animator.plantPaws = true }
          a.animators[lod] = animator
          m.root.scale.setScalar(a.scale)
          if (!a.models.some(Boolean)) a.appear = 0
          m.root.userData.fade = 1
          m.root.visible = false
          makeFadeable(m.root)
          a.models[lod] = m; root.add(m.root); a.animationTime = 1
        }).catch(() => { a.loading[lod] = false })
      }
      const selected = a.models[lod] ? lod : 1 - lod
      const m = a.models[selected], animator = a.animators[selected]
      for (let i = 0; i < a.models.length; i++) if (a.models[i]) a.models[i]!.root.visible = i === selected
      const g = glideTo(a.glide, a.x, a.z, a.heading, a.speed, a.turnRate, a.simTime, a.tier === "near", dt)
      a.visualX = g.x; a.visualZ = g.z; a.visualHeading = g.heading
      // afloat, the body keeps to the surface rather than the bed under it
      a.visualY = a.swim > 0.5 ? a.y : a.y + groundHeight(g.x, g.z) - groundHeight(a.x, a.z)
      if (m && animator) {
        wildlifeStats.rendered++
        m.root.position.set(a.visualX, a.visualY, a.visualZ); m.root.rotation.y = a.visualHeading
        // dissolves in and out (range edge, joining or leaving the few drawn): aerialFog.ts
        m.root.userData.fade = 1 - (1 - fadeByDistance(dist, qualityRT.profile.animalRange)) * a.appear
        for (const mesh of m.meshes) mesh.castShadow = a.tier === "near"
        if (a.animationTime >= period) {
          const pose = sys.pose
          pose.dt = a.animationTime; pose.time = state.clock.elapsedTime + (a.seed % 997) * 0.13
          pose.speed = a.speed / a.scale; pose.turnRate = a.turnRate; pose.sit = a.sit; pose.sleep = a.sleep; pose.graze = a.graze
          pose.happy = Math.max(a.happy, a.friendTime > 0 ? 0.5 : 0); pose.swim = a.swim
          pose.stroke = WATER_WAYS[a.species].stroke
          pose.lookYaw = dist < 8 && a.sleep < 0.5 ? THREE.MathUtils.clamp(Math.atan2(Math.sin(Math.atan2(px - a.x, pz - a.z) - a.heading), Math.cos(Math.atan2(px - a.x, pz - a.z) - a.heading)), -1.0, 1.0) : 0
          // a swimmer holds its head high, chin and nostrils clear of the water
          pose.lookPitch = (dist < 3 ? -0.2 : 0) - (a.species === "duck" ? 0 : a.swim * 0.4)
          // species behaviours: yawn, groom, preen, rear, thump, alarm
          pose.groom = a.act === "groom" ? a.actW : 0
          pose.yawn = a.act === "yawn" ? a.actW : 0
          pose.scratch = a.act === "scratch" ? a.actW : 0
          pose.stretch = a.act === "stretch" ? a.actW : 0
          pose.shake = a.act === "shake" ? a.actW : 0
          // a fox's mousing pounce: rise on the haunches, then nose into the grass
          const pounce = a.act === "pounce" ? a.actW : 0
          const rise = pounce * (1 - THREE.MathUtils.smoothstep(a.actTime, 0.7, 0.95))
          const dive = pounce * THREE.MathUtils.smoothstep(a.actTime, 0.85, 1.15)
          pose.rear = a.act === "rear" ? a.actW : rise
          pose.graze = Math.max(a.graze, dive)
          pose.preen = a.act === "preen" ? a.actW : 0
          pose.flap = a.act === "flap" ? a.actW : 0
          pose.dabble = a.act === "dabble" ? a.actW : 0
          pose.actSide = a.actSide
          pose.alert = a.alert * (a.species === "duck" ? 0 : 1)
          pose.thump = a.thump
          pose.earSwivel = dist < 12 ? pose.lookYaw * 0.6 : 0
          pose.tailUp = a.species === "cat" && a.friendTime > 0 && a.speed > 0.1 ? 0.8 : 0
          pose.pupil = a.species === "cat" || a.species === "fox" ? 0.2 + a.alert * 0.4 : 0.5
          pose.slope = (a.groundDx * Math.sin(a.heading) + a.groundDz * Math.cos(a.heading)) * (1 - a.swim)
          pose.crossSlope = (a.groundDx * Math.cos(a.heading) - a.groundDz * Math.sin(a.heading)) * (1 - a.swim)
          pose.fullIK = a.tier === "near"
          if (animator instanceof PrimateAnimator) {
            const p = sys.primate
            p.dt = pose.dt; p.time = pose.time; p.speed = pose.speed; p.turnRate = pose.turnRate
            p.sit = pose.sit; p.sleep = pose.sleep; p.climb = p.air = p.crouch = 0
            p.lookYaw = pose.lookYaw; p.lookPitch = pose.lookPitch; p.eat = pose.graze
            p.groom = Math.max(pose.groom ?? 0, pose.scratch ?? 0)
            p.happy = pose.happy; p.alert = pose.alert ?? 0; p.fullIK = pose.fullIK
            animator.update(p)
          } else animator.update(pose)
          a.animationTime = 0
        }
      }
      const reach = ["tiger", "cheetah", "gorilla"].includes(a.species) ? 4.5 : a.species === "horse" ? 3 : a.species === "deer" ? 2.3 : a.species === "duck" ? 3.5 : 1.6
      if (m && dist < reach && dist < nearestD && a.state !== "flee" && avatarRT().speed < 3.3) { nearest = a; nearestD = dist }
    }
    const live = [...sys.agents.values()]
    spreadAlarm(live)
    spreadWaterVisits(live)
    separateAnimals(live, dt)
    wildlifeRT.nearAnimal = nearest?.id ?? null
    const game = useGame.getState()
    const ready = game.started && !worldRT.introActive && !worldRT.finaleActive && avatarRT().gesture === "none" && worldRT.nearMemoryId === null && worldRT.nearSecretId === null
    discoveryRT.animalPrompt = nearest && ready ? `E — ${VERBS[nearest.species]}` : null
    if (nearest && ready && input.interact && !avatarRT().paused) { input.interact = false; interact(nearest) }
    wildlifeStats.simulationMs = performance.now() - started
  })
  return <primitive object={root} />
}
