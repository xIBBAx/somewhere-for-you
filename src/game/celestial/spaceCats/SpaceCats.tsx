import { useFrame } from "@react-three/fiber"
import { useDiscoveries } from "../../../state/discoveryStore"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { avatarRT, takeAction, worldRT } from "../../runtime"
import { groundHeight } from "../../world-layout"
import { horseRT, type HorseState } from "../../horses/horseState"
import { useGame } from "../../../state/gameStore"
import { catVoice, sfx } from "../../audio/audio"
import { spawnBurst } from "../../particles/sparkles"
import { makeAnimalModel, disposeAnimalModel, type AnimalModel } from "../../../world/wildlife/animalAssets"
import { applyCatBuild } from "../../../world/wildlife/catBreeds"
import { QuadrupedAnimator, type AnimalPose } from "../../../world/wildlife/QuadrupedAnimator"
import { homeGroundHidden, spaceRT, sunFromEye, universeDirToLocal, universeToView } from "../spaceState"
import { universe } from "../universe"
import { sailRT, mountUniverse } from "../starSail"
import { ridingCelestial } from "../CelestialController"
import { advanceCats, voyage } from "../voyageMemory"
import { spaceCatsRT, type CatPhase } from "./catsRuntime"
import { CREW, crewCoatIndex, crewNames, type CrewId, type CrewMember } from "./crew"
import { dressCat, glassUniforms, setVisor, wearKit, disposeKit, HELMET, type CatKit } from "./catSuit"
import { names } from "../../../personalization"
import {
  CATS_TARGET, GATHER_RANGE, MEET_RANGE, NOOK_DECK, NOOK_RACK, NOOK_SPOTS, NOTICE_RANGE, STAR_NOOK,
  cruiseHeight, l1Point, onNookDeck, rackPeg, slotOffset, waitingInSpace, type NookSpotKind,
} from "./journey"

/**
 * The five space cats, one crew through their whole journey:
 *
 *   waiting  drifting at the Earth–Moon L1 point (after a first Moon landing), met on approach
 *   escort   gathered round Starborn: a loose V behind her, lagging into turns,
 *            through deep space, over the Moon, down through Earth's air
 *   landing  Starborn's hooves are on home's grass: they glide down beside her
 *   flying   they rise on their little thrusters and fly to Star Nook
 *   homing   touching down there, the kit comes off: helmets onto the rack
 *   nook     at home for good: cushions, the lookout, the telescope, the tower
 *
 * There is only ever this one crew, moved from stage to stage, so nothing can
 * be duplicated; where they are is always derived from something that exists
 * now (the L1 point from the Earth and the Moon, the mount they follow, Star
 * Nook), so no frame change, origin rebase or reload can strand them.
 */

/** Distance (game m) from the camera beyond which a phase is not drawn. */
const DRAW_WAITING = 5000
const DRAW_NEAR = 1500
const DRAW_NOOK = 140

/** The model's pivot sits this far over the paws: floating cats turn about their middle. */
const BODY_MID = 0.2

/** Where the crew floats round the L1 point: (toward Earth, across, up), metres. */
const CLUSTER: Record<CrewId, [number, number, number]> = {
  captain: [1.0, 0, 0.3],
  marmalade: [-0.3, -1.25, 0.15],
  comet: [0.25, 1.15, -0.45],
  cloud: [-0.7, 0.35, 1.15],
  orbit: [0.05, 0.7, -1.35],
}

/** Each cat's first place at Star Nook. */
const FIRST_SPOT: Record<CrewId, number> = { captain: 3, marmalade: 6, comet: 4, cloud: 1, orbit: 7 }
/** How much each likes each kind of spot. */
const LIKES: Record<CrewId, Partial<Record<NookSpotKind, number>>> = {
  captain: { rail: 6, tower: 2, cushion: 1, bowl: 1, lawn: 1 },
  marmalade: { bowl: 4, cushion: 4, lawn: 1 },
  comet: { telescope: 6, tower: 3, lawn: 1, rail: 1 },
  cloud: { cushion: 9, bowl: 1 },
  orbit: { lawn: 6, tower: 3, cushion: 1 },
}

type Activity = "idle" | "walk" | "sleep" | "loaf" | "knead" | "sit" | "watch" | "stargaze" | "eat" | "play" | "groom" | "roll" | "greet"

type Cat = {
  def: CrewMember
  index: number
  size: number
  holder: THREE.Group
  model: AnimalModel | null
  kit: CatKit | null
  anim: QuadrupedAnimator | null
  pose: AnimalPose
  /** logical position of the body's middle */
  pos: THREE.Vector3
  vel: THREE.Vector3
  /** escort: offset from the mount in its own axes (right, up, ahead) */
  off: THREE.Vector3
  yaw: number
  pitch: number
  roll: number
  /** a somersault in progress (radians left to turn) */
  flip: number
  /** 0 floating … 1 on the ground */
  ground: number
  doze: number
  dozeT: number
  /** greeting: tail up, a look and a meow */
  greetT: number
  greetAt: THREE.Vector3
  // ---- the nook ----
  spot: number
  act: Activity
  actT: number
  /** when a walk ends: the activity to begin there */
  next: Activity
  lineAt: number
  /** landing/flying staging */
  stage: number
  delay: number
  cruise: number
  // ---- the kit on its way to the rack ----
  rackT: number
  rackFrom: THREE.Vector3
  peg: THREE.Group | null
  packPeg: THREE.Group | null
  blend: Record<"leap" | "swim" | "sleep" | "knead" | "sit" | "loaf" | "graze" | "groom" | "crouch" | "wiggle" | "roll" | "tail" | "look" | "alert", number>
}

const rand = (seed: number): (() => number) => {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const damp = (a: number, b: number, k: number, dt: number): number => a + (b - a) * (1 - Math.exp(-k * dt))
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a))
const dampAngle = (a: number, b: number, k: number, dt: number): number => a + wrap(b - a) * (1 - Math.exp(-k * dt))
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)

const _v = new THREE.Vector3()
const _w = new THREE.Vector3()
const _e = new THREE.Euler(0, 0, 0, "YXZ")
const _q = new THREE.Quaternion()
const _sun = new THREE.Vector3()
const _b1 = new THREE.Vector3(), _b2 = new THREE.Vector3(), _b3 = new THREE.Vector3()
/** dedicated scratch for arguments that outlive a helper call */
const _pod = new THREE.Vector3()
const _face = new THREE.Vector3()
const _look = new THREE.Vector3()
const _la = new THREE.Vector3()
const _dir = new THREE.Vector3()

const makePose = (): AnimalPose => ({
  dt: 0, time: 0, speed: 0, turnRate: 0, sit: 0, sleep: 0, graze: 0, happy: 0, swim: 0,
  lookYaw: 0, lookPitch: 0, slope: 0, crossSlope: 0, fullIK: true,
})

/** The ground (or deck, or tower) under a point at the nook. */
const nookFloor = (x: number, z: number, spot?: number): number => {
  const s = spot !== undefined ? NOOK_SPOTS[spot] : null
  if (s?.y && Math.hypot(x - (STAR_NOOK.x + s.x), z - (STAR_NOOK.z + s.z)) < 0.35) return groundHeight(x, z) + s.y
  return groundHeight(x, z) + (onNookDeck(x, z) ? NOOK_DECK.h : 0)
}

/** The local yaw/pitch of a direction (local axes) for a cat's head, relative to its body. */
const lookAngles = (c: Cat, dir: THREE.Vector3): [number, number] => {
  _q.copy(c.holder.quaternion).invert()
  _la.copy(dir).applyQuaternion(_q)
  return [clamp(Math.atan2(_la.x, _la.z), -1.1, 1.1), clamp(Math.atan2(_la.y, Math.hypot(_la.x, _la.z)), -0.7, 0.8)]
}

const setFrom = (c: Cat): void => {
  c.holder.position.copy(c.pos)
  _e.set(-c.pitch - c.flip, c.yaw, c.roll, "YXZ")
  c.holder.quaternion.setFromEuler(_e)
}

/** The world (logical) position and rotation of a rack peg. */
const pegWorld = (i: number, shelf: boolean, out: THREE.Vector3): THREE.Vector3 => {
  const p = rackPeg(i)
  const s = Math.sin(NOOK_RACK.yaw), c = Math.cos(NOOK_RACK.yaw)
  // rack axes: x along the rack (its right), z out of it (its facing)
  const ax = -c * p.x + s * p.z, az = s * p.x + c * p.z
  const x = STAR_NOOK.x + NOOK_RACK.x + ax, z = STAR_NOOK.z + NOOK_RACK.z + az
  return out.set(x, groundHeight(x, z) + NOOK_DECK.h + (shelf ? NOOK_RACK.shelfY + 0.05 : p.y), z)
}

export const SpaceCats = (): React.ReactElement => {
  const sys = useMemo(() => {
    const root = new THREE.Group()
    root.name = "space-cats"
    const cats: Cat[] = CREW.map((def, index) => {
      const holder = new THREE.Group()
      holder.name = `space-cat-${def.id}`
      holder.visible = false
      root.add(holder)
      return {
        def, index, size: def.build.size ?? 1, holder, model: null, kit: null, anim: null, pose: makePose(),
        pos: new THREE.Vector3(), vel: new THREE.Vector3(), off: new THREE.Vector3(...def.slot),
        yaw: index * 1.3, pitch: 0, roll: 0, flip: 0, ground: 0, doze: 0, dozeT: 4 + index * 3, greetT: 0, greetAt: new THREE.Vector3(),
        spot: FIRST_SPOT[def.id], act: "idle", actT: 0, next: "idle", lineAt: 0, stage: 0, delay: 0, cruise: 0,
        rackT: -1, rackFrom: new THREE.Vector3(), peg: null, packPeg: null,
        blend: { leap: 0, swim: 0, sleep: 0, knead: 0, sit: 0, loaf: 0, graze: 0, groom: 0, crouch: 0, wiggle: 0, roll: 0, tail: 0, look: 0, alert: 0 },
      }
    })
    spaceCatsRT.cats = cats.map((c) => ({ id: c.def.id, name: c.def.name, x: 0, y: 0, z: 0, act: "idle", visible: false, loaded: false }))
    return {
      root, cats, random: rand(97531),
      phase: "none" as CatPhase,
      phaseT: 0,
      lastHeading: 0,
      frameKey: "",
      toldChart: false,
      toldMeet: false,
      placed: false,
      lineIndex: 0,
      camera: null as THREE.Camera | null,
      /** the escort's character beats: the next cat to show, and when */
      beat: -1,
      beatT: 0,
    }
  }, [])

  useEffect(() => {
    spaceCatsRT.probe = () => sys.cats.map((c) => {
      const w = c.holder.getWorldPosition(new THREE.Vector3())
      let shown = 0, meshes = 0
      c.holder.traverse((o) => { if ((o as THREE.Mesh).isMesh) { meshes++; let v = true; for (let q: THREE.Object3D | null = o; q; q = q.parent) v = v && q.visible; if (v) shown++ } })
      const ndc = sys.camera ? w.clone().project(sys.camera).toArray().map((v) => +v.toFixed(3)) : null
      return { id: c.def.id, visible: c.holder.visible, render: w.toArray().map((v) => +v.toFixed(2)), ndc, meshes, shown, scale: c.holder.scale.x }
    })
    return () => { spaceCatsRT.probe = () => null }
  }, [sys])

  // ---- load and dress the five ---------------------------------------------------
  useEffect(() => {
    let alive = true
    for (const c of sys.cats) {
      void makeAnimalModel("cat", crewCoatIndex(c.def), 0).then((m) => {
        if (!m) return
        if (!alive) { disposeAnimalModel(m); return }
        // the kit is fitted in the rest pose, then the breed's build is applied over it
        const kit = dressCat(m, c.def)
        applyCatBuild(m, c.def.build)
        m.root.name = `space-cat-model-${c.def.id}`
        m.root.position.y = -BODY_MID
        c.anim = new QuadrupedAnimator("cat", m, 4100 + c.index * 37)
        c.anim.tailSize = c.def.build.tail ?? 1
        c.anim.plantPaws = true
        setVisor(kit, c.def.visor)
        c.model = m
        c.kit = kit
        c.holder.add(m.root)
        c.holder.scale.setScalar(c.size)
        if (sys.phase === "nook") undress(c, true)
      })
    }
    return () => {
      alive = false
      for (const c of sys.cats) {
        if (c.kit) disposeKit(c.kit)
        if (c.model) disposeAnimalModel(c.model)
        c.peg?.removeFromParent()
        c.packPeg?.removeFromParent()
        c.model = null
        c.kit = null
        c.anim = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sys])

  /** The kit comes off: helmet and pack onto the rack (at once, or flown there). */
  const undress = (c: Cat, instant: boolean): void => {
    const kit = c.kit
    if (!kit || c.peg) return
    // the helmet on its peg, opening down; the pack on the shelf below
    const peg = new THREE.Group()
    peg.name = `rack-helmet-${c.def.id}`
    const turn = new THREE.Group()
    turn.quaternion.setFromUnitVectors(HELMET.opening, new THREE.Vector3(0, -1, 0))
    peg.add(turn)
    turn.add(kit.helmet)
    kit.helmet.position.copy(HELMET.centre).negate()
    kit.helmet.quaternion.identity()
    kit.helmet.scale.setScalar(1)
    peg.scale.setScalar(c.size)
    peg.rotation.y = NOOK_RACK.yaw
    sys.root.add(peg)
    c.peg = peg
    const packPeg = new THREE.Group()
    packPeg.name = `rack-pack-${c.def.id}`
    packPeg.add(kit.pack)
    kit.pack.position.set(0, -0.318 + 0.025, 0)
    kit.pack.quaternion.identity()
    kit.pack.scale.setScalar(1)
    packPeg.scale.setScalar(c.size)
    packPeg.rotation.y = NOOK_RACK.yaw
    pegWorld(c.index, true, packPeg.position)
    sys.root.add(packPeg)
    c.packPeg = packPeg
    kit.suit.visible = false
    kit.boots.visible = false
    kit.collar.visible = true
    kit.helmet.visible = true
    kit.pack.visible = true
    for (const p of kit.puffs) (p.material as THREE.MeshBasicMaterial).opacity = 0
    if (instant) {
      pegWorld(c.index, false, peg.position)
      c.rackT = -1
    } else {
      c.rackFrom.copy(c.pos).add(_v.set(0, 0.12 * c.size, 0))
      peg.position.copy(c.rackFrom)
      c.rackT = 0
    }
  }

  /** Back into the kit (a replay): helmet and pack off the rack, onto their bones again. */
  const redress = (c: Cat): void => {
    const kit = c.kit
    c.rackT = -1
    if (!kit || !c.model) return
    for (const [obj, home] of [[kit.helmet, kit.homes.helmet], [kit.pack, kit.homes.pack]] as const) {
      home.parent.add(obj)
      obj.position.copy(home.position)
      obj.quaternion.copy(home.quaternion)
      obj.scale.copy(home.scale)
    }
    c.peg?.removeFromParent()
    c.packPeg?.removeFromParent()
    c.peg = c.packPeg = null
    wearKit(kit, true)
  }

  // ---- the phase from the voyage ----------------------------------------------------
  const phaseFromVoyage = (): CatPhase => {
    if (voyage.cats === "settled" || voyage.cats === "arrived") return "nook"
    // an escort with no mount in this session waits where it was found
    return waitingInSpace(voyage) || voyage.cats === "escorting" ? "waiting" : "none"
  }

  const setPhase = (p: CatPhase): void => {
    if (sys.phase === p) return
    sys.phase = p
    sys.phaseT = 0
    spaceCatsRT.phase = p
  }

  const hint = (t: string): void => useGame.getState().showHint(t)

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const time = state.clock.elapsedTime
    sys.camera = state.camera
    spaceCatsRT.scene = state.scene
    sys.phaseT += dt
    if (spaceCatsRT.reset) {
      // QA or a replay: the crew back in their kit, and the voyage read afresh
      spaceCatsRT.reset = false
      for (const c of sys.cats) redress(c)
      sys.placed = false
      spaceCatsRT.following = null
      spaceCatsRT.noticed = false
      sys.toldChart = sys.toldMeet = false
      setPhase("none")
    }
    // the voyage decides where the crew is whenever nothing in this session has
    if (sys.phase === "none" || (sys.phase === "waiting" && !waitingInSpace(voyage))) {
      const p = phaseFromVoyage()
      if (p !== sys.phase) setPhase(p)
      if ((sys.phase as CatPhase) === "nook" && !sys.placed) placeAtNook()
    }
    spaceCatsRT.podReady = l1Point(spaceCatsRT.pod)
    const rider = ridingCelestial()
    if (rider && spaceCatsRT.podReady) {
      mountUniverse(rider, _v)
      spaceCatsRT.mountDistance = _v.distanceTo(spaceCatsRT.pod)
    } else spaceCatsRT.mountDistance = Infinity
    const lit = sunFromEye(_sun)
    glassUniforms.uSun.value.copy(_sun)
    glassUniforms.uSunLit.value = lit
    glassUniforms.uSky.value = (1 - spaceRT.thin) * 0.85

    const gather = takeAction("gather")
    spaceCatsRT.canGather = false
    switch (sys.phase) {
      case "waiting": stepWaiting(dt, time, rider, gather); break
      case "escort": stepEscort(dt, time); break
      case "landing": case "flying": case "homing": stepArrival(dt, time); break
      case "nook": stepNook(dt, time); break
      default:
        if (gather) hint("There's nobody out here to gather.")
        for (const c of sys.cats) c.holder.visible = false
    }
    const look = spaceCatsRT.look
    if (look) {
      const c = sys.cats.find((x) => x.def.id === look.id)
      if (c) {
        const b = (look.bearing * Math.PI) / 180
        Object.assign(worldRT.inspectionCamera, {
          active: true, follow: false, px: c.pos.x + Math.sin(b) * look.dist, py: c.pos.y + look.up, pz: c.pos.z + Math.cos(b) * look.dist,
          tx: c.pos.x, ty: c.pos.y + 0.04 * c.size, tz: c.pos.z,
        })
      }
    }
    for (let i = 0; i < sys.cats.length; i++) {
      const c = sys.cats[i], r = spaceCatsRT.cats[i]
      r.x = c.pos.x; r.y = c.pos.y; r.z = c.pos.z; r.act = c.act; r.visible = c.holder.visible; r.loaded = !!c.model
    }
  })

  // ---- waiting at L1 ----------------------------------------------------------------
  const stepWaiting = (dt: number, time: number, rider: HorseState | null, gather: boolean): void => {
    if (!spaceCatsRT.podReady) return
    const moon = universe.byId.get("moon")!, earth = universe.byId.get("earth")!
    // the crew's own axes: toward Earth, across, and up out of the orbit's plane
    _b1.copy(earth.pos).sub(moon.pos).normalize()
    _b2.copy(moon.pole).cross(_b1).normalize()
    _b3.copy(_b1).cross(_b2)
    universeToView(spaceCatsRT.pod, _pod)
    const eyeD = spaceRT.eye.distanceTo(spaceCatsRT.pod)
    const near = eyeD < DRAW_WAITING
    const d = spaceCatsRT.mountDistance
    const met = voyage.cats === "met"

    // crossing between the Moon and Earth: Starborn hears them, and turns her head
    if (rider && !spaceCatsRT.noticed && spaceRT.mode === "deep" && d < NOTICE_RANGE) {
      spaceCatsRT.noticed = true
      if (sailRT.autopilot && sailRT.autopilot.kind !== "cats") sailRT.autopilot = null
      spaceRT.target = CATS_TARGET
      hint(met
        ? "The space cats still wait at the L1 point. Press N to go to them."
        : `${names.starborn} pricks her ears: something small is calling from the L1 point. Press N.`)
    }
    // out in deep space with them waiting: they show on the star chart
    if (rider && !sys.toldChart && !spaceCatsRT.noticed && spaceRT.mode === "deep" && voyage.cats === "unseen") {
      sys.toldChart = true
      hint("Five tiny lights blink in a row, far out toward Earth — not stars. Star chart: M.")
    }
    if (rider && d < MEET_RANGE && !met) {
      if (advanceCats("met")) {
        sfx.twinkle()
        // the whole story in a card that wraps; the hint line stays short
        useDiscoveries.getState().showToast({
          title: "Five cats in little spacesuits!",
          line: `${crewNames()}, adrift at the Earth–Moon L1 point, where the two worlds' pulls nearly cancel. Their tiny thrusters have been carrying them home very, very slowly.`,
          kind: "space-cats",
        })
      }
    }
    if (rider && d < MEET_RANGE * 2 && !sys.toldMeet && voyage.cats === "met") {
      sys.toldMeet = true
      setTimeout(() => { if (voyage.cats === "met") hint("Come alongside (within 40 m) and press O to bring them home.") }, 5200)
    }
    spaceCatsRT.canGather = !!rider && d < GATHER_RANGE
    if (gather) {
      if (spaceCatsRT.canGather && rider) { startEscort(rider); return }
      hint(rider ? `Come closer first: ${Math.round(d)} m away (within ${GATHER_RANGE} m).` : `Only ${names.starborn} can carry the cats home.`)
    }
    const greet = rider && d < MEET_RANGE ? 1 : 0
    // the rider's head, seen from here
    const mount = rider ? _look.set(rider.x, rider.y + 1.6, rider.z) : null
    for (const c of sys.cats) {
      const o = CLUSTER[c.def.id]
      const sway = 0.35
      _v.copy(_b1).multiplyScalar(o[0] + Math.sin(time * 0.21 + c.index) * sway)
        .addScaledVector(_b2, o[1] + Math.sin(time * 0.17 + c.index * 2.1) * sway)
        .addScaledVector(_b3, o[2] + Math.cos(time * 0.19 + c.index * 1.3) * sway)
      universeDirToLocal(_v, _v)
      c.pos.copy(_pod).add(_v)
      c.holder.visible = near && !!c.model
      if (!c.holder.visible) continue
      // face Earth, paddling; turn to the riders when they come
      universeDirToLocal(_face.copy(_b1), _face)
      if (mount && greet) _face.lerp(_dir.copy(mount).sub(c.pos).normalize(), 0.85).normalize()
      floatStep(c, dt, time, _face, greet, mount)
      setFrom(c)
    }
  }

  const startEscort = (h: HorseState): void => {
    advanceCats("escorting")
    spaceCatsRT.following = h.ident.id
    setPhase("escort")
    sys.lastHeading = h.heading
    sys.frameKey = frameKey()
    for (const c of sys.cats) {
      // keep them where they are: their offset from the mount in its own axes
      _v.copy(c.pos).sub(_w.set(h.x, h.y, h.z))
      const s = Math.sin(h.heading), co = Math.cos(h.heading)
      c.off.set(-co * _v.x + s * _v.z, _v.y, s * _v.x + co * _v.z)
    }
    spaceRT.target = "earth"
    sys.beat = -1
    sys.beatT = 14
    sfx.chime()
    hint(`The crew falls in round ${h.ident.name}. Take them home: Homeward (K).`)
  }

  const frameKey = (): string => `${spaceRT.mode}|${spaceRT.realm}|${spaceRT.frame.ox}|${spaceRT.frame.oz}|${spaceRT.frame.center.x}`

  // ---- following Starborn ------------------------------------------------------------
  const stepEscort = (dt: number, time: number): void => {
    const h = spaceCatsRT.following ? horseRT.horses.get(spaceCatsRT.following) : undefined
    if (!h) {
      // the mount they followed is gone: back to waiting where they were found
      advanceCats("met")
      spaceCatsRT.following = null
      setPhase("waiting")
      return
    }
    const key = frameKey()
    let turn = wrap(h.heading - sys.lastHeading)
    // a new frame re-expresses the heading: that is not a turn
    if (key !== sys.frameKey || Math.abs(turn) > 0.6) turn = 0
    sys.frameKey = key
    sys.lastHeading = h.heading
    const speed = Math.abs(h.speed)
    const stream = clamp(speed / 300, 0, 1)
    const local = spaceRT.mode === "local"
    const camD = _w.set(h.x, h.y, h.z).distanceTo(spaceRT.camLocal)
    // home: Starborn's hooves are on home's grass
    const earthGround = spaceRT.realm === "earth" && local && h.flight?.mode === "ground" && h.y - groundHeight(h.x, h.z) < 0.6
    if (earthGround) {
      if (advanceCats("arrived")) {
        setPhase("landing")
        sfx.chime()
        hint("Home! The crew touches down on real grass — follow their lights.")
        sys.cats.forEach((c, i) => { c.stage = 0; c.delay = 0.4 + i * 0.35 })
        return
      }
    }
    // on the long way home, one of them at a time shows who they are
    sys.beatT -= dt
    if (sys.beatT <= 0 && sys.beat < sys.cats.length) {
      if (sys.beat >= 0) hint(sys.cats[sys.beat].def.space)
      sys.beat++
      sys.beatT = 22
    }
    for (const c of sys.cats) {
      const T = c.def.temperament
      // they keep their place in the world as she turns, so they swing out behind
      if (turn !== 0) {
        const s = Math.sin(-turn), co = Math.cos(-turn)
        const r = c.off.x, a = c.off.z
        c.off.x = co * r + s * a
        c.off.z = -s * r + co * a
      }
      const k = 1.1 + T.quick * 1.4
      c.off.x = damp(c.off.x, c.def.slot[0] * (1 + stream * 0.25), k, dt)
      c.off.y = damp(c.off.y, c.def.slot[1], k, dt)
      c.off.z = damp(c.off.z, c.def.slot[2] * (1 + stream * 0.6), k, dt)
      slotOffset([c.off.x, c.off.y, c.off.z], h.heading, _v)
      c.pos.set(h.x, h.y, h.z).add(_v)
      c.pos.x += Math.sin(time * 0.9 + c.index * 1.7) * 0.12
      c.pos.y += Math.sin(time * 1.1 + c.index * 2.3) * 0.15
      // over ground (home or the Moon): never through it
      if (local) c.pos.y = Math.max(c.pos.y, groundHeight(c.pos.x, c.pos.z) + 0.32)
      c.holder.visible = !!c.model && camD < DRAW_NEAR
      if (!c.holder.visible) continue
      // facing on with her, nose into the travel at speed
      _face.set(Math.sin(h.heading), 0, Math.cos(h.heading))
      if (h.flight) _face.y = Math.sin(h.flight.pitch) * 0.8
      _face.normalize()
      const lookAt = _look.set(h.x, h.y + 1.6, h.z)
      floatStep(c, dt, time, _face, 0.4, speed < 20 ? lookAt : null, stream + Math.min(1, Math.abs(turn) * 40))
      setFrom(c)
    }
  }

  /**
   * One floating cat: body turned toward `facing` (local axes), legs reaching
   * and paddling, each in their own way; `greet` 0..1 is how glad they are to
   * see someone, `effort` 0..1 how hard their thrusters work.
   */
  const floatStep = (c: Cat, dt: number, time: number, facing: THREE.Vector3, greet: number, lookAt: THREE.Vector3 | null, effort = 0): void => {
    const T = c.def.temperament, id = c.def.id
    const b = c.blend, p = c.pose
    c.ground = damp(c.ground, 0, 3, dt)
    // dozing comes and goes (the sleepy one hardly ever wakes)
    c.dozeT -= dt
    if (c.dozeT <= 0) {
      c.doze = sys.random() < T.doze ? 1 : 0
      c.dozeT = c.doze ? 8 + sys.random() * 14 : 6 + sys.random() * 10
    }
    const dozing = c.doze > 0 && greet < 0.5 ? 1 : 0
    // somersaults (the Bengal loves them)
    if (c.flip <= 0 && greet < 0.5 && sys.random() < T.tumble * 0.08 * dt) c.flip = Math.PI * 2
    if (c.flip > 0) c.flip = Math.max(0, c.flip - dt * 4.6)
    const yawT = Math.atan2(facing.x, facing.z)
    const pitchT = Math.asin(clamp(facing.y, -1, 1)) * 0.7
    c.yaw = dampAngle(c.yaw, yawT + Math.sin(time * 0.3 + c.index) * 0.25 * T.fidget, 0.8 + T.quick * 1.2, dt)
    c.pitch = damp(c.pitch, pitchT + Math.sin(time * 0.23 + c.index * 2) * 0.12, 1.2, dt)
    c.roll = damp(c.roll, Math.sin(time * 0.31 + c.index * 1.4) * (0.18 + 0.4 * dozing), 1, dt)
    b.sleep = damp(b.sleep, dozing * 0.9 + (c.flip > 0 ? 0.55 : 0), 2, dt)
    b.leap = damp(b.leap, (1 - dozing) * (0.42 + 0.45 * effort) * (c.flip > 0 ? 0.3 : 1), 2.5, dt)
    b.swim = damp(b.swim, (1 - dozing) * (0.1 + 0.12 * T.fidget) * (1 - effort * 0.7), 2, dt)
    b.knead = damp(b.knead, id === "marmalade" && !dozing ? 0.8 : 0, 2, dt)
    b.tail = damp(b.tail, greet * 0.85, 3, dt)
    b.sit = damp(b.sit, 0, 3, dt); b.loaf = damp(b.loaf, 0, 3, dt); b.graze = damp(b.graze, 0, 3, dt)
    b.groom = damp(b.groom, 0, 3, dt); b.crouch = damp(b.crouch, 0, 3, dt); b.wiggle = damp(b.wiggle, 0, 3, dt)
    b.roll = damp(b.roll, 0, 3, dt); b.alert = damp(b.alert, greet * (id === "captain" ? 0.8 : 0.3), 3, dt)
    let ly = Math.sin(time * (0.4 + T.fidget) + c.index * 3) * 0.5 * T.fidget, lp = Math.sin(time * 0.35 + c.index) * 0.2
    if (lookAt && greet > 0) {
      setFrom(c)
      ;[ly, lp] = lookAngles(c, _dir.copy(lookAt).sub(c.pos))
    }
    b.look = damp(b.look, 1, 3, dt)
    pose(c, dt, time, 0, ly, lp)
    p.pupil = 0.85
    p.whisker = greet * 0.7 - dozing * 0.3
    p.earSwivel = Math.sin(time * (0.8 + T.fidget * 2) + c.index) * 0.4 * T.fidget
    p.headTilt = greet * Math.sin(time * 0.7 + c.index) * 0.25 + (id === "comet" ? 0.15 : 0)
    p.lids = dozing * 0.9
    c.anim?.update(p)
    if (id === "captain" && greet > 0.5 && c.model) salute(c, time)
    kitLights(c, time, 0.25 + effort * 0.6 + (c.flip > 0 ? 0.5 : 0))
  }

  /** Fill the shared pose fields from the blends. */
  const pose = (c: Cat, dt: number, time: number, speed: number, lookYaw: number, lookPitch: number): void => {
    const p = c.pose, b = c.blend
    p.dt = dt; p.time = time + c.index * 13; p.speed = speed; p.turnRate = 0
    p.sit = b.sit; p.sleep = b.sleep; p.graze = b.graze; p.swim = b.swim; p.happy = 0.3 + b.tail * 0.4
    p.leap = b.leap; p.knead = b.knead; p.loaf = b.loaf; p.groom = b.groom; p.crouch = b.crouch; p.wiggle = b.wiggle
    p.roll = b.roll; p.alert = b.alert; p.tailUp = b.tail
    p.lookYaw = lookYaw * b.look; p.lookPitch = lookPitch * b.look
    p.slope = 0; p.crossSlope = 0; p.fullIK = true
    p.mouth = 0; p.tongue = 0; p.yawn = 0; p.actSide = c.index % 2 ? 1 : -1
    if (c.greetT > 0) {
      c.greetT -= dt
      const u = c.greetT
      p.mouth = u > 1.1 && u < 1.8 ? Math.sin(((1.8 - u) / 0.7) * Math.PI) * 0.8 : 0
      p.tailUp = Math.max(p.tailUp ?? 0, 0.9)
    }
  }

  /** The captain's salute: the right forepaw raised to the helmet. */
  const salute = (c: Cat, time: number): void => {
    const leg = c.model!.bones.get("legFR1")
    if (!leg) return
    const w = clamp(Math.sin(time * 0.6) * 2 - 0.6, 0, 1)
    if (w <= 0) return
    _q.setFromAxisAngle(_v.set(1, 0, 0), -1.5 * w)
    leg.quaternion.multiply(_q)
  }

  /** The antenna's status light, the helmet lamps and the thrusters' cold-gas puffs. */
  const kitLights = (c: Cat, time: number, thrust: number): void => {
    const kit = c.kit
    if (!kit) return
    const rate = c.def.id === "comet" ? 3.1 : 0.8 + c.index * 0.07
    const on = Math.sin(time * rate * Math.PI * 2 + c.index) > 0.55
    ;(kit.beacon.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 3 : 0.25
    // little bursts: they are always nudging themselves along
    const burst = Math.max(0, Math.sin(time * 1.7 + c.index * 2.2)) ** 6
    const o = clamp(thrust * 0.45 + burst * 0.35, 0, 0.75) * (0.75 + 0.25 * Math.sin(time * 37 + c.index))
    for (const puff of kit.puffs) {
      ;(puff.material as THREE.MeshBasicMaterial).opacity = o
      puff.scale.set(1, 1, 0.6 + o * 1.4)
    }
  }

  // ---- home: down beside Starborn, then to Star Nook --------------------------------------
  const stepArrival = (dt: number, time: number): void => {
    const h = spaceCatsRT.following ? horseRT.horses.get(spaceCatsRT.following) : undefined
    let done = 0
    for (const c of sys.cats) {
      const spot = NOOK_SPOTS[FIRST_SPOT[c.def.id]]
      const nx = STAR_NOOK.x + spot.x, nz = STAR_NOOK.z + spot.z
      c.delay -= dt
      if (c.stage === 0) {
        // glide down to a place on the grass round her
        const a = c.index * 1.256 + (h?.heading ?? 0) + Math.PI
        const tx = (h?.x ?? c.pos.x) + Math.sin(a) * 2.6, tz = (h?.z ?? c.pos.z) + Math.cos(a) * 2.6
        const ty = groundHeight(tx, tz) + BODY_MID * c.size
        moveToward(c, tx, ty, tz, 2.2, dt)
        if (c.pos.distanceTo(_v.set(tx, ty, tz)) < 0.08) { c.stage = 1; c.delay = 3.2 + c.index * 0.5 }
        settle(c, dt, time, c.stage === 1 ? 1 : 0)
      } else if (c.stage === 1) {
        // on the ground: a look round at home
        settle(c, dt, time, 1)
        if (c.delay <= 0) {
          c.stage = 2
          c.cruise = cruiseHeight(c.pos.x, c.pos.z, nx, nz, groundHeight)
          sfx.whoosh()
        }
      } else if (c.stage === 2) {
        // up on the thrusters, across home at a height over the trees
        const far = Math.hypot(nx - c.pos.x, nz - c.pos.z)
        const v = clamp(far / 18, 4.5, 45)
        const low = far < 6
        const ty = low ? nookFloor(nx, nz, FIRST_SPOT[c.def.id]) + BODY_MID * c.size : c.cruise
        moveToward(c, nx, ty, nz, low ? 2.4 : v, dt, c.pos.y < c.cruise - 0.5 && !low)
        _face.copy(c.vel)
        if (_face.lengthSq() < 1e-6) _face.set(Math.sin(c.yaw), 0, Math.cos(c.yaw))
        floatStep(c, dt, time, _face.normalize(), 0, null, 0.9)
        if (low && c.pos.distanceTo(_w.set(nx, ty, nz)) < 0.1) { c.stage = 3; c.delay = 1.2 }
      } else {
        settle(c, dt, time, 1)
        if (c.stage === 3 && c.delay <= 0) {
          c.stage = 4
          undress(c, false)
          spawnBurst(_v.copy(c.pos).add(_w.set(0, 0.25, 0)), 12, c.def.accent)
          sfx.sparkle()
        }
        if (c.stage === 4) done++
      }
      setFrom(c)
      c.holder.visible = !!c.model && c.pos.distanceTo(spaceRT.camLocal) < DRAW_NEAR
      tickRack(c, dt)
    }
    if (sys.phase === "landing" && sys.cats.some((c) => c.stage >= 2)) setPhase("flying")
    if (sys.phase === "flying" && sys.cats.every((c) => c.stage >= 3)) setPhase("homing")
    if (done === sys.cats.length && sys.cats.every((c) => c.rackT < 0)) {
      advanceCats("settled")
      spaceCatsRT.following = null
      for (const c of sys.cats) { c.spot = FIRST_SPOT[c.def.id]; c.act = startAt(c); c.actT = 6 + c.index * 2 }
      sys.placed = true
      setPhase("nook")
      sfx.fanfare()
      useDiscoveries.getState().showToast({
        title: "Star Nook",
        line: `${crewNames()} have made Star Nook their home, east of the pond. Their helmets hang on the rack — they won't need them here.`,
        kind: "space-cats",
      })
    }
  }

  /** Steer a floating cat toward a point at `speed` (m/s), easing in. */
  const moveToward = (c: Cat, x: number, y: number, z: number, speed: number, dt: number, climbFirst = false): void => {
    _v.set(x - c.pos.x, y - c.pos.y, z - c.pos.z)
    if (climbFirst) { _v.x *= 0.15; _v.z *= 0.15 }
    const d = _v.length()
    const v = Math.min(speed, d * 1.6 + 0.05)
    if (d > 1e-4) _v.multiplyScalar(v / d)
    c.vel.lerp(_v, 1 - Math.exp(-4 * dt))
    c.pos.addScaledVector(c.vel, dt)
    if (d < 0.02) c.pos.set(x, y, z)
  }

  /** On the ground, standing or about its business (the walk speed given). */
  const settle = (c: Cat, dt: number, time: number, grounded: number, speed = 0, act: Activity = "idle"): void => {
    const b = c.blend, T = c.def.temperament
    c.ground = damp(c.ground, grounded, 4, dt)
    c.flip = 0
    c.pitch = damp(c.pitch, 0, 5, dt)
    c.roll = damp(c.roll, 0, 5, dt)
    const w = (a: Activity): number => (c.act === a || act === a ? 1 : 0)
    b.leap = damp(b.leap, (1 - c.ground) * 0.5, 4, dt)
    b.swim = damp(b.swim, 0, 4, dt)
    b.sleep = damp(b.sleep, w("sleep"), 1.5, dt)
    b.loaf = damp(b.loaf, w("loaf"), 2, dt)
    b.knead = damp(b.knead, w("knead"), 2, dt)
    b.sit = damp(b.sit, Math.max(w("sit"), w("watch"), w("stargaze"), w("greet") * 0.6), 2.5, dt)
    b.graze = damp(b.graze, w("eat"), 3, dt)
    b.groom = damp(b.groom, w("groom") * (Math.sin(time * 0.5 + c.index) > -0.3 ? 1 : 0), 2, dt)
    b.crouch = damp(b.crouch, w("play") * (Math.sin(time * 0.8 + c.index) > 0 ? 1 : 0.3), 3, dt)
    b.wiggle = damp(b.wiggle, w("play") * (Math.sin(time * 0.8 + c.index) > 0.5 ? 1 : 0), 4, dt)
    b.roll = damp(b.roll, w("roll"), 2, dt)
    b.alert = damp(b.alert, w("watch") * 0.7, 2, dt)
    b.tail = damp(b.tail, speed > 0.1 ? 0.7 : c.greetT > 0 ? 1 : 0.15, 3, dt)
    b.look = damp(b.look, 1, 3, dt)
    let ly = Math.sin(time * (0.3 + T.fidget * 0.6) + c.index * 3) * 0.5, lp = w("stargaze") * 0.75 + Math.sin(time * 0.2 + c.index) * 0.1
    // a look at whoever is near (or the one who just said hello)
    const av = avatarRT().pos
    const near = Math.hypot(av.x - c.pos.x, av.z - c.pos.z) < 3.2
    if ((near || c.greetT > 0) && w("sleep") < 1) {
      setFrom(c)
      ;[ly, lp] = lookAngles(c, _dir.set(av.x, av.y + 1.2, av.z).sub(c.pos))
    }
    pose(c, dt, time, speed, ly, lp)
    c.pose.pupil = 0.4
    c.pose.lids = w("sleep") * 0.9 + w("loaf") * 0.4
    c.pose.whisker = c.greetT > 0 ? 0.6 : 0
    c.pose.earSwivel = Math.sin(time * (0.6 + T.fidget) + c.index) * 0.5 * T.fidget
    c.anim?.update(c.pose)
    kitLights(c, time, 0)
  }

  /** The helmet's flight to its peg (a little arc), then it rests there. */
  const tickRack = (c: Cat, dt: number): void => {
    if (c.rackT < 0 || !c.peg) return
    c.rackT = Math.min(1, c.rackT + dt / 1.4)
    const u = c.rackT, e = u * u * (3 - 2 * u)
    pegWorld(c.index, false, _w)
    c.peg.position.lerpVectors(c.rackFrom, _w, e)
    c.peg.position.y += Math.sin(u * Math.PI) * 0.8
    if (u >= 1) { c.rackT = -1; spawnBurst(_w.clone(), 6, "#fff3d8") }
  }

  // ---- Star Nook ------------------------------------------------------------------------
  const placeAtNook = (): void => {
    sys.placed = true
    for (const c of sys.cats) {
      c.spot = FIRST_SPOT[c.def.id]
      const s = NOOK_SPOTS[c.spot]
      c.pos.set(STAR_NOOK.x + s.x, 0, STAR_NOOK.z + s.z)
      c.pos.y = nookFloor(c.pos.x, c.pos.z, c.spot) + BODY_MID * c.size
      c.yaw = s.facing
      c.ground = 1
      c.act = startAt(c)
      c.actT = 4 + sys.random() * 10
      if (c.kit) undress(c, true)
    }
  }

  /** What a cat does on arriving at its spot. */
  const startAt = (c: Cat): Activity => {
    const kind = NOOK_SPOTS[c.spot].kind
    const id = c.def.id, r = sys.random()
    switch (kind) {
      case "cushion": return id === "cloud" ? "sleep" : id === "marmalade" ? (r < 0.6 ? "knead" : "loaf") : r < 0.4 ? "loaf" : r < 0.7 ? "groom" : "sleep"
      case "rail": return "watch"
      case "telescope": return "stargaze"
      case "tower": return r < 0.6 ? "loaf" : "watch"
      case "bowl": return "eat"
      case "lawn": return id === "orbit" ? (r < 0.6 ? "play" : "roll") : r < 0.5 ? "groom" : "sit"
    }
  }

  /** Choose somewhere else to go, as the cat likes it, not where another is. */
  const pickSpot = (c: Cat): number => {
    const taken = new Set(sys.cats.filter((o) => o !== c).map((o) => o.spot))
    const likes = LIKES[c.def.id]
    let total = 0
    const w = NOOK_SPOTS.map((s, i) => (taken.has(i) || i === c.spot ? 0 : likes[s.kind] ?? 0.2))
    for (const x of w) total += x
    if (total <= 0) return c.spot
    let r = sys.random() * total
    for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i }
    return c.spot
  }

  const stepNook = (dt: number, time: number): void => {
    if (!sys.placed) placeAtNook()
    const home = spaceRT.realm === "earth" && !homeGroundHidden()
    const camD = Math.hypot(spaceRT.camLocal.x - STAR_NOOK.x, spaceRT.camLocal.z - STAR_NOOK.z)
    const show = home && camD < DRAW_NOOK
    // a hello asked for at the nook (StarNookPrompt)
    const greet = spaceCatsRT.greet
    spaceCatsRT.greet = null
    const av = avatarRT().pos
    for (const c of sys.cats) {
      tickRack(c, dt)
      c.holder.visible = show && !!c.model
      if (greet === c.def.id) {
        c.greetT = 2.6
        if (c.act === "sleep") c.act = "loaf"
        catVoice[c.def.id === "cloud" ? "mew" : c.def.id === "comet" ? "chatter" : c.def.id === "orbit" ? "trill" : "meow"](0.8)
        spawnBurst(_v.copy(c.pos).add(_w.set(0, 0.35, 0)), 6, "#f2c6d0")
        hint(c.def.lines[c.lineAt++ % c.def.lines.length])
      }
      if (!show) continue
      const s = NOOK_SPOTS[c.spot]
      const tx = STAR_NOOK.x + s.x, tz = STAR_NOOK.z + s.z
      if (c.act === "walk") {
        const dx = tx - c.pos.x, dz = tz - c.pos.z
        const d = Math.hypot(dx, dz)
        const v = Math.min(0.75 + c.def.temperament.quick * 0.45, d * 1.5)
        c.yaw = dampAngle(c.yaw, Math.atan2(dx, dz), 5, dt)
        // walk the way it faces, so the paws keep to the ground
        c.pos.x += Math.sin(c.yaw) * v * dt
        c.pos.z += Math.cos(c.yaw) * v * dt
        c.pos.y = damp(c.pos.y, nookFloor(c.pos.x, c.pos.z, d < 0.4 ? c.spot : undefined) + BODY_MID * c.size, 10, dt)
        settle(c, dt, time, 1, v / c.size, "walk")
        if (d < 0.08) { c.act = c.next; c.actT = (c.def.id === "cloud" ? 40 : 14) + sys.random() * 26 }
      } else {
        c.yaw = dampAngle(c.yaw, s.facing, 2, dt)
        c.pos.y = damp(c.pos.y, nookFloor(c.pos.x, c.pos.z, c.spot) + BODY_MID * c.size, 6, dt)
        // somebody close by and calling: they come and sit in front of them
        c.actT -= dt * (Math.hypot(av.x - c.pos.x, av.z - c.pos.z) < 2 && c.act === "sleep" ? 0.3 : 1)
        settle(c, dt, time, 1, 0)
        if (c.actT <= 0) {
          const to = pickSpot(c)
          if (to !== c.spot) {
            c.spot = to
            c.next = startAt(c)
            c.act = "walk"
          } else c.actT = 8
        }
      }
      setFrom(c)
    }
  }

  return <primitive object={sys.root} />
}
