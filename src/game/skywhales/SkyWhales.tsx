import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo, useRef, useState } from "react"
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js"
import { homeGroundHidden } from "../celestial/spaceState"
import { originRT } from "../../world/origin"
import { nightBlend } from "../environment/celestialLighting"
import { avatarRT, characterRT, worldRT } from "../runtime"
import { riderRT } from "../horses/riding"
import type { HorseState } from "../horses/horseState"
import { dragonRT } from "../dragon/dragonState"
import { groundHeight } from "../world-layout"
import { useGame } from "../../state/gameStore"
import { qualityRT } from "../../state/qualityStore"
import { emit, rand, Shape } from "../vfx/lumenCore"
import { registerDevTool } from "../../dev/devTools"

/**
 * The sky whales: a mother and her calves who swim through the air high over
 * home, slow and enormous, slate-backed with pale bellies and a faint
 * bioluminescence that only shows at night, vapour streaming off their flukes
 * and, now and then, the mother's blow hanging in the air.
 * Fly up to them (Starborn, any pegasus, or the dragon) and the pod turns and swims
 * beside her for as long as she keeps flying.
 *
 * Model: "Whale" by Quaternius, CC0 1.0 (public domain), from poly.pizza
 *. 447 triangles with its own Swim cycle.
 */

const URL = "/assets/skywhales/whale.glb"
type Mode = "away" | "arrive" | "wander" | "escort"

export const skyWhaleRT = {
  loaded: false,
  mode: "away" as Mode,
  x: 0, y: 0, z: 0,
  /** distance from the active character to the mother (m) */
  distance: Infinity,
  /** the pod has been close enough to be noticed this visit */
  seen: false,
}

type Whale = {
  root: THREE.Object3D
  mixer: THREE.AnimationMixer
  action: THREE.AnimationAction | null
  pos: THREE.Vector3
  vel: THREE.Vector3
  heading: number
  pitch: number
  roll: number
  scale: number
  /** formation offset from the mother (right, up, back), in metres */
  slot: THREE.Vector3
  trail: number
  spout: number
}

/** where she is and how fast she is going, read from whatever carries her */
const carrier = (): { x: number; y: number; z: number; flying: boolean; heading: number } => {
  const id = characterRT.active
  const body = avatarRT()
  if (dragonRT.riding) return { x: dragonRT.x, y: dragonRT.y, z: dragonRT.z, flying: true, heading: body.facing }
  const r = riderRT[id]
  const h = r.phase === "riding" ? (r.horse as HorseState | null) : null
  if (h && h.kind === "horse") {
    const flying = !!h.flight && h.flight.mode !== "ground" && h.flight.mode !== "sail"
    return { x: h.x, y: h.y, z: h.z, flying, heading: body.facing }
  }
  return { x: body.pos.x, y: body.pos.y, z: body.pos.z, flying: false, heading: body.facing }
}

// ---------------------------------------------------------------- the skin

type SkinUniforms = { uTime: { value: number }; uGlow: { value: number } }

/**
 * The model has no UVs, so the markings are drawn from the bind-pose position
 * (they ride on the skin as it bends): lantern spots in rows along the flanks
 * with a wave of light running head to tail, and glowing throat pleats.
 */
const makeSkin = (part: "top" | "bottom", u: SkinUniforms): THREE.MeshStandardMaterial => {
  const m = new THREE.MeshStandardMaterial({
    // a real whale's colouring: slate back, pale mottled belly, a wet sheen
    color: part === "top" ? "#3a4450" : "#c3c9ce",
    roughness: part === "top" ? 0.38 : 0.55,
    metalness: 0,
    emissive: "#000000",
    emissiveIntensity: 1,
  })
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = u.uTime
    shader.uniforms.uGlow = u.uGlow
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWhale;")
      // the mesh is authored Z-up at 1/100 under a x100 node: bring the bind
      // pose into the whale's own frame (x right, y up, z head-forward, metres)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWhale = vec3(position.x, position.z, -position.y) * 100.0;")
    const glow = part === "top" ? `
      {
        // lantern spots: rows along each flank, every 0.5 units head to tail
        float cell = vWhale.z / 0.5;
        float id = floor(cell);
        float f = (fract(cell) - 0.5) * 0.5;
        float side = abs(vWhale.x);
        float row1 = vWhale.y - (0.05 + 0.08 * sin(id * 1.7));
        float row2 = vWhale.y - (-0.45 + 0.06 * cos(id * 2.3));
        float d1 = length(vec2(f, row1));
        float d2 = length(vec2(f, row2));
        float spot = max(smoothstep(0.12, 0.035, d1), 0.8 * smoothstep(0.1, 0.03, d2));
        spot *= smoothstep(0.35, 0.75, side) * smoothstep(-6.2, -4.8, vWhale.z) * (1.0 - smoothstep(2.6, 3.3, vWhale.z));
        float wave = 0.5 + 0.5 * sin(vWhale.z * 1.15 - uTime * 2.1);
        float twinkle = 0.7 + 0.3 * sin(uTime * 2.7 + id * 2.39);
        vec3 lantern = mix(vec3(0.45, 0.85, 0.95), vec3(0.6, 0.75, 1.0), 0.5 + 0.5 * sin(id * 0.93));
        // the ridge of the back catches a faint line of light
        float ridge = smoothstep(0.18, 0.0, side) * smoothstep(0.6, 1.0, vWhale.y) * 0.35;
        totalEmissiveRadiance += (lantern * spot * (0.3 + 0.7 * wave) * twinkle + vec3(0.55, 0.8, 1.0) * ridge * wave) * uGlow;
      }` : `
      {
        // throat pleats: fine grooves under the head that glow like moonlit water
        float pleat = smoothstep(0.82, 1.0, abs(sin(vWhale.x * 9.0)));
        float throat = smoothstep(-2.6, -0.4, vWhale.z) * (1.0 - smoothstep(2.4, 3.4, vWhale.z));
        float wave = 0.55 + 0.45 * sin(vWhale.z * 1.4 - uTime * 1.6);
        totalEmissiveRadiance += vec3(0.42, 0.95, 0.9) * pleat * throat * wave * uGlow * 0.6;
      }`
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWhale;\nuniform float uTime;\nuniform float uGlow;")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${glow}`)
  }
  m.customProgramCacheKey = () => `sky-whale-${part}`
  return m
}

type Rig = { scene: THREE.Group; clip: THREE.AnimationClip | null; skins: THREE.MeshStandardMaterial[]; uniforms: SkinUniforms }

const loadRig = async (): Promise<Rig> => {
  const gltf = await new GLTFLoader().loadAsync(URL)
  const uniforms: SkinUniforms = { uTime: { value: 0 }, uGlow: { value: 0.3 } }
  const top = makeSkin("top", uniforms), bottom = makeSkin("bottom", uniforms)
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const old = mesh.material as THREE.Material
    mesh.material = old.name === "Bottom" ? bottom : top
    old.dispose()
    mesh.castShadow = false
    mesh.receiveShadow = false
    // the swim cycle bends the tail past the bind-pose bounds; they are small and few
    mesh.frustumCulled = false
  })
  const clip = gltf.animations.find((a) => /swim/i.test(a.name)) ?? gltf.animations[0] ?? null
  return { scene: gltf.scene, clip, skins: [top, bottom], uniforms }
}

// ---------------------------------------------------------------- motion

const MOTHER_SCALE = 2.3
const PODS: { scale: number; slot: [number, number, number] }[] = [
  { scale: MOTHER_SCALE, slot: [0, 0, 0] },
  // both calves on the mother's far side, so beside a rider the way ahead stays clear
  { scale: 1.25, slot: [8, -4, 9] },
  { scale: 1.05, slot: [16, 3, 16] },
]
const CRUISE = 7.5
const ORBIT = 135
const ESCORT_RANGE = 240
const _v = new THREE.Vector3()
const _t = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()

const angleTo = (from: number, to: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from))
const cruiseHeight = (x: number, z: number, t: number): number => groundHeight(x, z) + 82 + Math.sin(t * 0.06) * 14

/** a point in a whale's own space, in logical world space */
const localToWorld = (w: Whale, lx: number, ly: number, lz: number, out: THREE.Vector3): THREE.Vector3 => {
  _e.set(-w.pitch, w.heading, -w.roll, "YXZ")
  _q.setFromEuler(_e)
  return out.set(lx, ly, lz).multiplyScalar(w.scale).applyQuaternion(_q).add(w.pos)
}

export const SkyWhales = (): React.ReactElement | null => {
  const [rig, setRig] = useState<Rig | null>(null)
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const group = useRef<THREE.Group>(null)
  const ctl = useRef({ time: 0, playTime: 0, centre: new THREE.Vector3(), angle: 0, nextSpout: 14, last: new THREE.Vector3(), speed: 0, hinted: false, ready: false })

  useEffect(() => {
    let alive = true
    loadRig().then((r) => { if (alive) setRig(r) }).catch((error) => console.error("The sky whales could not load", error))
    return () => { alive = false }
  }, [])

  const whales = useMemo<Whale[]>(() => {
    if (!rig) return []
    const count = qualityRT.level === "low" ? 1 : PODS.length
    return PODS.slice(0, count).map((p, i) => {
      const root = cloneSkinned(rig.scene)
      const mixer = new THREE.AnimationMixer(root)
      const action = rig.clip ? mixer.clipAction(rig.clip) : null
      if (action) { action.play(); action.time = (i * 0.83) % (rig.clip?.duration ?? 3) }
      return { root, mixer, action, pos: new THREE.Vector3(), vel: new THREE.Vector3(), heading: 0, pitch: 0, roll: 0, scale: p.scale, slot: new THREE.Vector3(...p.slot), trail: 0, spout: 0 }
    })
  }, [rig])

  useEffect(() => {
    const g = group.current
    if (!g || !rig || !whales.length) return
    for (const w of whales) { w.root.visible = false; g.add(w.root) }
    // compile the two skins now, not on the frame they first swim into view
    const compile = (gl as unknown as { compileAsync?: (o: THREE.Object3D, c: THREE.Camera) => Promise<unknown> }).compileAsync
    if (compile) void compile.call(gl, g, camera).catch(() => {})
    skyWhaleRT.loaded = true
    skyWhaleRT.mode = "away"
    ctl.current.ready = false
    return () => {
      for (const w of whales) { w.mixer.stopAllAction(); g.remove(w.root) }
      skyWhaleRT.loaded = false
    }
  }, [rig, whales, gl, camera])

  useEffect(() => () => { rig?.skins.forEach((m) => m.dispose()) }, [rig])

  /** start the pod far out ahead of where she is looking, already swimming in */
  const arrive = (from: { x: number; z: number }, heading: number, distance = 520): void => {
    const c = ctl.current
    c.centre.set(from.x, 0, from.z)
    const ax = from.x + Math.sin(heading) * distance, az = from.z + Math.cos(heading) * distance
    for (const w of whales) {
      w.pos.set(ax + w.slot.x, cruiseHeight(ax, az, c.time) + 25 + w.slot.y, az + w.slot.z)
      w.heading = heading + Math.PI
      w.vel.set(Math.sin(w.heading), 0, Math.cos(w.heading)).multiplyScalar(CRUISE * 1.6)
      w.pitch = w.roll = 0
    }
    c.angle = Math.atan2(ax - from.x, az - from.z)
    skyWhaleRT.mode = "arrive"
    c.ready = true
  }

  useEffect(() => {
    registerDevTool("whales", ((mode?: string) => {
      const b = carrier()
      if (mode === "near") {
        // QA: the pod 70 m ahead of the camera's view, high enough to see against the sky
        arrive({ x: b.x, z: b.z }, b.heading, 90)
        for (const w of whales) w.pos.y = b.y + 26 + w.slot.y
      }
      if (mode === "arrive") arrive({ x: b.x, z: b.z }, b.heading)
      return { ...skyWhaleRT, count: whales.length, pos: whales.map((w) => w.pos.toArray().map((n) => Math.round(n))) }
    }) as never)
  }, [whales]) // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, rawDt) => {
    const g = group.current
    if (!g || !rig || !whales.length) return
    const dt = Math.min(Math.max(rawDt, 0), 0.1)
    const c = ctl.current
    c.time += dt
    const game = useGame.getState()
    const earth = !homeGroundHidden()
    const playing = game.started && !worldRT.introActive && earth
    g.visible = playing && c.ready
    rig.uniforms.uTime.value = c.time
    const night = nightBlend(worldRT.timeOfDay)
    // nothing by day; at night a faint bioluminescence along the flanks
    rig.uniforms.uGlow.value = 1.1 * night
    if (!playing) return
    c.playTime += dt
    const me = carrier()
    // her speed, smoothed, so an escort can match it
    const step = Math.hypot(me.x - c.last.x, me.z - c.last.z, me.y - c.last.y)
    if (step < 60) c.speed = THREE.MathUtils.damp(c.speed, step / Math.max(dt, 1e-3), 3, dt)
    c.last.set(me.x, me.y, me.z)

    // they come the first time a little while after she arrives, from the far sky ahead
    if (!c.ready) {
      if (c.playTime > 18) arrive(me, me.heading)
      else return
    }
    const mother = whales[0]
    const away = Math.hypot(mother.pos.x - me.x, mother.pos.z - me.z)
    // after a fast journey or a long ride elsewhere, they find her again
    if (away > 1400) arrive(me, me.heading)

    // the home they circle drifts after her, slowly
    c.centre.x = THREE.MathUtils.damp(c.centre.x, me.x, 0.025, dt)
    c.centre.z = THREE.MathUtils.damp(c.centre.z, me.z, 0.025, dt)
    // any time she is really in the air (Starborn often skims low over the meadow)
    const escort = me.flying && away < ESCORT_RANGE && me.y - groundHeight(me.x, me.z) > 3
    if (escort) skyWhaleRT.mode = "escort"
    else if (skyWhaleRT.mode === "escort" || (skyWhaleRT.mode === "arrive" && Math.hypot(mother.pos.x - c.centre.x, mother.pos.z - c.centre.z) < ORBIT * 1.4)) skyWhaleRT.mode = "wander"

    // the mother's goal
    if (skyWhaleRT.mode === "escort") {
      // ahead and off to one side, inside the chase view, so she sees them swim with her
      const right = me.heading - Math.PI / 2
      _t.set(me.x + Math.sin(right) * 12 + Math.sin(me.heading) * 34, Math.max(me.y + 5, groundHeight(me.x, me.z) + 20), me.z + Math.cos(right) * 12 + Math.cos(me.heading) * 34)
    } else if (skyWhaleRT.mode === "arrive") {
      _t.set(c.centre.x + Math.sin(c.angle) * ORBIT, 0, c.centre.z + Math.cos(c.angle) * ORBIT)
      _t.y = cruiseHeight(_t.x, _t.z, c.time)
    } else {
      c.angle += dt * CRUISE / ORBIT
      const a = c.angle + 0.45
      _t.set(c.centre.x + Math.sin(a) * ORBIT, 0, c.centre.z + Math.cos(a) * ORBIT)
      _t.y = cruiseHeight(_t.x, _t.z, c.time)
    }

    const particles = qualityRT.profile.particles
    whales.forEach((w, i) => {
      // calves keep their place beside and behind their mother
      if (i > 0) {
        const h = mother.heading
        _t.set(
          mother.pos.x + Math.cos(h) * -w.slot.x - Math.sin(h) * w.slot.z,
          mother.pos.y + w.slot.y + Math.sin(c.time * 0.4 + i) * 2,
          mother.pos.z - Math.sin(h) * -w.slot.x - Math.cos(h) * w.slot.z,
        )
      }
      const toward = _v.subVectors(_t, w.pos)
      const dist = toward.length()
      const want = skyWhaleRT.mode === "escort"
        ? THREE.MathUtils.clamp(c.speed + (dist - 4) * 0.45, 5, 52)
        : skyWhaleRT.mode === "arrive" ? CRUISE * 2.2 : THREE.MathUtils.clamp(CRUISE + (i > 0 ? (dist - 3) * 0.3 : 0), 4, 16)
      toward.multiplyScalar(want / Math.max(dist, 0.001))
      // big animals turn wide: velocity eases toward the wish
      const agility = skyWhaleRT.mode === "escort" ? 1.4 : i > 0 ? 0.9 : 0.45
      w.vel.x = THREE.MathUtils.damp(w.vel.x, toward.x, agility, dt)
      w.vel.y = THREE.MathUtils.damp(w.vel.y, toward.y, agility, dt)
      w.vel.z = THREE.MathUtils.damp(w.vel.z, toward.z, agility, dt)
      w.pos.addScaledVector(w.vel, dt)
      // never through a hill or a tree
      const floor = groundHeight(w.pos.x, w.pos.z) + (skyWhaleRT.mode === "escort" ? 16 : 38)
      if (w.pos.y < floor) { w.pos.y = THREE.MathUtils.damp(w.pos.y, floor, 4, dt); w.vel.y = Math.max(w.vel.y, 0) }
      const horizontal = Math.hypot(w.vel.x, w.vel.z)
      if (horizontal > 0.3) {
        const heading = Math.atan2(w.vel.x, w.vel.z)
        const turn = angleTo(w.heading, heading)
        w.heading += turn * (1 - Math.exp(-2.2 * dt))
        w.roll = THREE.MathUtils.damp(w.roll, THREE.MathUtils.clamp(turn * 1.4, -0.42, 0.42), 2, dt)
      }
      w.pitch = THREE.MathUtils.damp(w.pitch, THREE.MathUtils.clamp(Math.atan2(w.vel.y, Math.max(horizontal, 0.5)), -0.45, 0.45), 2, dt)
      // the stroke quickens with speed
      if (w.action) w.action.timeScale = 0.42 + Math.min(1.4, horizontal / 22)
      w.mixer.update(dt)
      _e.set(-w.pitch, w.heading, -w.roll, "YXZ")
      w.root.quaternion.setFromEuler(_e)
      w.root.position.set(w.pos.x - originRT.x, w.pos.y, w.pos.z - originRT.z)
      w.root.scale.setScalar(w.scale)
      w.root.visible = true

      // vapour streaming off the flukes, like a wingtip trail in damp air (logical space)
      w.trail += dt * 4 * particles * (skyWhaleRT.mode === "escort" ? 1.5 : 1)
      while (w.trail > 1) {
        w.trail -= 1
        localToWorld(w, rand(-1.4, 1.4), rand(-0.1, 0.2), -6.4, _v)
        emit({ x: _v.x, y: _v.y, z: _v.z, vx: -w.vel.x * 0.1 + rand(-0.3, 0.3), vy: rand(-0.1, 0.2), vz: -w.vel.z * 0.1 + rand(-0.3, 0.3), life: rand(2.5, 4), color: VAPOUR, intensity: 0.35 + 0.35 * night, size: rand(0.3, 0.6) * w.scale * 0.5, drag: 0.5, gravity: -0.02, shape: Shape.Mote, curl: 0.5 })
      }
    })

    // now and then the mother breathes out a fountain of light
    c.nextSpout -= dt
    if (c.nextSpout <= 0 && skyWhaleRT.mode !== "arrive") {
      c.nextSpout = rand(16, 30)
      localToWorld(mother, 0, 1.05, 2.0, _v)
      // the blow: a column of vapour and fine droplets that hangs, then drifts
      const n = Math.round(60 * particles)
      for (let k = 0; k < n; k++) {
        const a = rand(0, Math.PI * 2), s = rand(0.2, 1.1)
        const mist = k % 3 !== 0
        emit({ x: _v.x, y: _v.y, z: _v.z, vx: Math.cos(a) * s + mother.vel.x * 0.7, vy: mist ? rand(5, 9) : rand(7, 11), vz: Math.sin(a) * s + mother.vel.z * 0.7, life: mist ? rand(2.4, 3.6) : rand(1.2, 1.8), color: SPRAY, intensity: mist ? 0.45 : 0.8, size: mist ? rand(0.35, 0.7) : rand(0.04, 0.08), drag: mist ? 1.1 : 0.4, gravity: mist ? 0.6 : 6, shape: mist ? Shape.Mote : Shape.Glow, curl: mist ? 0.6 : 0.1, delay: k * 0.01 })
      }
    }

    skyWhaleRT.x = mother.pos.x; skyWhaleRT.y = mother.pos.y; skyWhaleRT.z = mother.pos.z
    skyWhaleRT.distance = Math.hypot(mother.pos.x - me.x, mother.pos.y - me.y, mother.pos.z - me.z)
    // the first time they come close, a word about them (once a visit)
    if (!c.hinted && skyWhaleRT.mode !== "arrive" && skyWhaleRT.distance < 230 && !game.activeMemoryId && !game.activeSecretId && !worldRT.finaleActive) {
      c.hinted = true
      skyWhaleRT.seen = true
      game.showHint(me.flying ? "The whales are keeping pace with you." : "Whales, overhead.")
    }
  })

  return <group ref={group} name="sky-whales" visible={false} />
}

const SPRAY = new THREE.Color("#eef3f6")
const VAPOUR = new THREE.Color("#e6ecf0")
