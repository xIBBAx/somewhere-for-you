import { useFrame } from "@react-three/fiber"
import { awayFromEarth } from "../realmHook"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { sfx } from "../../game/audio/audio"
import { cameraRT, catRT, characterRT, input, avatarRT, worldRT, type AvatarBody, type PlayerGesture } from "../../game/runtime"
import { useDiscoveries } from "../../state/discoveryStore"
import { useGame } from "../../state/gameStore"
import { discoveriesNear, discoveryRT, markFound, textFor, type Discovery } from "../discoveries"
import { rng } from "../noise"
import { worldHeight } from "../terrain"
import { windRT } from "../wind"
import { loadVegetationLibrary } from "./vegetationLibrary"
import { barkMaterial, foliageMaterial, propsMaterial } from "./vegetationMaterials"
import { discoveryPillar } from "../../game/vfx/signatures"

/**
 * Discoveries in the endless world: landmarks every few hundred metres,
 * small finds in between, soft light beacons over places not yet visited,
 * and a little interaction at each (sit, paint, pet cats, make a wish,
 * throw a jab, ride the balloon…). Counts and toasts go to the HUD store.
 */

const LANDMARK_RANGE = 260
const FIND_RANGE = 150
const BEACON_RANGE = 520

type PropLib = Map<string, THREE.BufferGeometry>

let propsPromise: Promise<PropLib> | null = null
const loadProps = (): Promise<PropLib> => {
  if (propsPromise) return propsPromise
  propsPromise = new GLTFLoader()
    .loadAsync("/assets/props/props.glb")
    .then((gltf) => {
      const map: PropLib = new Map()
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.isMesh) {
          m.updateWorldMatrix(true, false)
          m.geometry.applyMatrix4(m.matrixWorld)
          m.geometry.computeBoundingSphere()
          map.set(m.name, m.geometry)
        }
      })
      return map
    })
    .catch((error) => {
      console.error("[world] props failed to load; discoveries will be invisible but still work", error)
      return new Map()
    })
  return propsPromise
}

const propMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 })
const glowMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, emissive: "#ffffff", emissiveIntensity: 0.4 })
glowMaterial.onBeforeCompile = (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <emissivemap_fragment>",
    "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= diffuseColor.rgb;",
  )
}
glowMaterial.customProgramCacheKey = () => "discovery-glow-v1"

/** A small cheerful painting for each easel, different per place. */
const paintingTexture = (seed: number): THREE.CanvasTexture => {
  const r = rng(seed)
  const c = document.createElement("canvas")
  c.width = 256
  c.height = 192
  const g = c.getContext("2d")!
  const skies = [["#ffd6c9", "#ffeedd"], ["#bfe3f7", "#f2f9ff"], ["#d9c8f3", "#fde9f1"], ["#ffcf9e", "#ffe9c6"]]
  const sky = skies[Math.floor(r() * skies.length)]
  const grad = g.createLinearGradient(0, 0, 0, 192)
  grad.addColorStop(0, sky[0])
  grad.addColorStop(1, sky[1])
  g.fillStyle = grad
  g.fillRect(0, 0, 256, 192)
  g.fillStyle = "#fff4c2"
  g.beginPath()
  g.arc(60 + r() * 140, 40 + r() * 30, 16 + r() * 10, 0, Math.PI * 2)
  g.fill()
  const hills = ["#9fcf88", "#7fb874", "#b9d98f", "#8cc39a"]
  for (let i = 0; i < 3; i++) {
    g.fillStyle = hills[(i + Math.floor(r() * 4)) % 4]
    g.beginPath()
    g.moveTo(0, 192)
    for (let x = 0; x <= 256; x += 16) g.lineTo(x, 110 + i * 22 + Math.sin(x * 0.03 + r() * 6) * 12)
    g.lineTo(256, 192)
    g.fill()
  }
  const motif = Math.floor(r() * 3)
  if (motif === 0) {
    // a little cat silhouette on the hill
    g.fillStyle = "#4a3b3b"
    g.beginPath()
    g.ellipse(170, 132, 18, 12, 0, 0, Math.PI * 2)
    g.ellipse(186, 118, 9, 8, 0, 0, Math.PI * 2)
    g.fill()
    g.beginPath()
    g.moveTo(180, 112); g.lineTo(183, 102); g.lineTo(187, 111)
    g.moveTo(188, 111); g.lineTo(193, 102); g.lineTo(194, 113)
    g.fill()
  } else if (motif === 1) {
    for (let i = 0; i < 14; i++) {
      g.fillStyle = ["#f27b9b", "#f7c95c", "#ffffff", "#b58ce6"][i % 4]
      g.beginPath()
      g.arc(20 + r() * 216, 150 + r() * 36, 4 + r() * 3, 0, Math.PI * 2)
      g.fill()
    }
  } else {
    g.fillStyle = "#f2809b"
    const hx = 128
    const hy = 120
    g.beginPath()
    g.moveTo(hx, hy + 20)
    g.bezierCurveTo(hx - 40, hy - 6, hx - 20, hy - 34, hx, hy - 14)
    g.bezierCurveTo(hx + 20, hy - 34, hx + 40, hy - 6, hx, hy + 20)
    g.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

const sparkleTexture = (): THREE.CanvasTexture => {
  const c = document.createElement("canvas")
  c.width = c.height = 64
  const g = c.getContext("2d")!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, "rgba(255,255,255,1)")
  grad.addColorStop(0.25, "rgba(255,236,190,0.8)")
  grad.addColorStop(1, "rgba(255,220,160,0)")
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  g.strokeStyle = "rgba(255,255,255,0.9)"
  g.lineWidth = 2
  g.beginPath()
  g.moveTo(32, 4); g.lineTo(32, 60); g.moveTo(4, 32); g.lineTo(60, 32)
  g.stroke()
  return new THREE.CanvasTexture(c)
}

const beaconMaterial = (): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color("#ffe1a8") }, uAlpha: { value: 1 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uAlpha; uniform float uTime;
      varying vec2 vUv;
      void main() {
        float edge = pow(1.0 - abs(vUv.x - 0.5) * 2.0, 2.0);
        float fade = smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.35, 1.0, vUv.y));
        float shimmer = 0.85 + 0.15 * sin(vUv.y * 40.0 - uTime * 2.0);
        gl_FragColor = vec4(uColor * shimmer, edge * fade * uAlpha * 0.5);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  })

type Active = {
  d: Discovery
  group: THREE.Group
  glows: THREE.Mesh[]
  sparkle: THREE.Sprite | null
  beacon: THREE.Mesh | null
  balloon: THREE.Object3D | null
  ribbons: THREE.Object3D[]
  baseY: number
  texture: THREE.Texture | null
  ownedMaterials: THREE.Material[]
}

const GESTURE: Record<string, PlayerGesture> = {
  flowerHeart: "wish",
  picnic: "sit",
  bench: "sit",
  catNap: "pet",
  kiosk: "cheer",
  easel: "paint",
  umbrella: "sit",
  trainingPost: "train",
  gulmoharArch: "cheer",
  starStones: "wish",
  wishTree: "wish",
  balloon: "ride",
  gift: "cheer",
  cupcake: "cheer",
  letter: "wish",
}

const BURST_COLOR: Record<string, string> = {
  flowerHeart: "#ff9cc0", gulmoharArch: "#ffc4d8", starStones: "#a8dcff", wishTree: "#ffe7a3", gift: "#ffd27a",
  cupcake: "#ffb3c7", letter: "#fff1d6", kiosk: "#f5d0a0", catNap: "#ffc0d4",
}

export const discoveryStats = { active: 0, beacons: 0 }

export const Discoveries = (): React.ReactElement => {
  const root = useMemo(() => {
    const g = new THREE.Group()
    g.name = "discoveries"
    return g
  }, [])

  const sys = useMemo(() => {
    const sparkleTex = sparkleTexture()
    const sparkleMat = new THREE.SpriteMaterial({ map: sparkleTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: "#ffe4b0" })
    const beaconGeo = new THREE.CylinderGeometry(1.6, 1.6, 70, 12, 1, true)
    beaconGeo.translate(0, 35, 0)
    return {
      props: null as PropLib | null,
      veg: null as Map<string, THREE.BufferGeometry> | null,
      active: new Map<string, Active>(),
      scratch: [] as Discovery[],
      timer: 0,
      sparkleMat,
      beaconGeo,
      beaconMat: beaconMaterial(),
      ride: null as null | { a: Active; body: AvatarBody; t: number; x: number; z: number; ground: number; yaw: number; pitch: number; distance: number },
    }
  }, [])

  useEffect(() => {
    let alive = true
    Promise.all([loadProps(), loadVegetationLibrary()]).then(([props, veg]) => {
      if (!alive) return
      sys.props = props
      sys.veg = veg.geometries
      sys.timer = 0
    })
    return () => {
      alive = false
      for (const a of sys.active.values()) {
        for (const child of a.group.children) if ((child as THREE.InstancedMesh).isInstancedMesh) (child as THREE.InstancedMesh).dispose()
        a.texture?.dispose()
        for (const material of a.ownedMaterials) material.dispose()
      }
      sys.active.clear()
      root.clear()
      sys.sparkleMat.map?.dispose()
      sys.sparkleMat.dispose()
      sys.beaconGeo.dispose()
      sys.beaconMat.dispose()
      if (sys.ride) finishRide(sys.ride, false)
    }
  }, [sys, root])

  const place = (group: THREE.Group, geo: string, x: number, z: number, rotY = 0, scale = 1, yOffset = 0, material?: THREE.Material): THREE.Mesh | null => {
    const g = sys.props?.get(geo) ?? sys.veg?.get(geo)
    if (!g) return null
    const isGlow = geo.endsWith("_glow")
    const mat = material ?? (isGlow ? glowMaterial : geo.startsWith("tree_") ? (geo.endsWith("_leaves") ? foliageMaterial() : barkMaterial()) : geo.startsWith("flower_") ? propsMaterial() : propMaterial)
    const mesh = new THREE.Mesh(g, mat)
    mesh.position.set(x, yOffset, z)
    mesh.rotation.y = rotY
    mesh.scale.setScalar(scale)
    mesh.castShadow = !isGlow
    mesh.receiveShadow = true
    group.add(mesh)
    return mesh
  }

  const build = (d: Discovery): Active => {
    const group = new THREE.Group()
    group.name = d.id
    const baseY = worldHeight(d.x, d.z)
    const a: Active = { d, group, glows: [], sparkle: null, beacon: null, balloon: null, ribbons: [], baseY, texture: null, ownedMaterials: [] }
    const r = rng(d.seed)
    // child meshes sit on the terrain under their own footprint
    const at = (lx: number, lz: number): number => {
      const c = Math.cos(d.rot)
      const s = Math.sin(d.rot)
      return worldHeight(d.x + lx * c + lz * s, d.z - lx * s + lz * c) - baseY
    }
    const put = (geo: string, lx: number, lz: number, rot = 0, scale = 1, lift = 0): THREE.Mesh | null => {
      const m = place(group, geo, lx, lz, rot, scale, at(lx, lz) + lift)
      if (m && geo.endsWith("_glow")) a.glows.push(m)
      return m
    }
    switch (d.kind) {
      case "flowerHeart": {
        put("heart_hedge", 0, 0, Math.PI)
        const species = ["flower_poppy_lod0", "flower_cosmos_lod0", "flower_tulip_lod0", "flower_daisy_lod0"]
        for (let i = 0; i < 70; i++) {
          const t = r() * Math.PI * 2
          const k = Math.sqrt(r()) * 0.85
          const hx = 16 * Math.sin(t) ** 3 * 0.22 * k
          const hz = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * 0.22 * k - 0.6
          put(species[i % (i < 40 ? 2 : 4)], hx, hz, r() * 6.28, 1.1 + r() * 0.4)
        }
        put("bench", 0, 5.2, Math.PI)
        break
      }
      case "picnic":
        put("picnic", 0, 0, 0)
        put("lantern_post", 1.9, -1.2)
        put("lantern_post_glow", 1.9, -1.2)
        put("cupcake", 0.1, 0.25, 0, 0.8, 0.02)
        break
      case "bench":
        put("bench", 0, 0, 0)
        put("lantern_post", 1.15, 0.25)
        put("lantern_post_glow", 1.15, 0.25)
        put("signpost", -1.5, 0.6, 0.6)
        break
      case "catNap":
        for (let i = 0; i < 3; i++) {
          const ang = (i / 3) * Math.PI * 2 + 0.4
          put("cushion", Math.cos(ang) * 1.3, Math.sin(ang) * 1.3)
        }
        put("signpost", 2.6, -1.4, 2.4)
        put("gift_lilac", -0.2, 0.1, 0.3, 0.6)
        break
      case "kiosk":
        put("kiosk", 0, 0, 0)
        put("lantern_post", -1.6, -1.5)
        put("lantern_post_glow", -1.6, -1.5)
        put("lantern_post", 1.6, -1.5)
        put("lantern_post_glow", 1.6, -1.5)
        break
      case "easel": {
        put("easel", 0, 0, Math.PI)
        const tex = paintingTexture(d.seed)
        a.texture = tex
        const canvasMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 })
        a.ownedMaterials.push(canvasMat)
        const canvas = place(group, "easel_canvas", 0, 0, Math.PI, 1, at(0, 0), canvasMat)
        if (canvas) canvas.material = canvasMat
        put("picnic", 2.2, 1.4, 0.8, 0.7)
        break
      }
      case "umbrella":
        put("bench", 0, 0, 0)
        put("umbrella", 0, 0.45, 0.4)
        break
      case "trainingPost":
        put("training_post", 0, 0, 0)
        put("signpost", -2, 1, 0.3)
        break
      case "gulmoharArch": {
        put("sakura_arch", 0, 0, 0)
        for (const lx of [-0.8, 0.8]) {
          const l = put("paper_lantern", lx, -0.05, 0, 1, 2.6)
          const g = put("paper_lantern_glow", lx, -0.05, 0, 1, 2.6)
          if (l && g) a.ribbons.push(l, g)
        }
        for (const [lx, lz] of [[-3.8, -1.6], [3.9, -1.4], [-3.4, 2.4]]) {
          const rotation = r() * 6
          put("tree_sakura_0_lod0", lx, lz, rotation, 1.05)
          put("tree_sakura_0_lod0_leaves", lx, lz, rotation, 1.05)
        }
        break
      }
      case "starStones":
        for (let i = 0; i < 7; i++) {
          const ang = (i / 7) * Math.PI * 2
          const sx = Math.cos(ang) * 4
          const sz = Math.sin(ang) * 4
          const face = Math.atan2(-sx, -sz) + Math.PI
          const scale = 0.9 + r() * 0.4
          put("star_stone", sx, sz, face, scale)
          put("star_stone_glow", sx, sz, face, scale)
        }
        break
      case "wishTree": {
        put("tree_oak_1_lod0", 0, 0, 0, 1.8)
        put("tree_oak_1_lod0_leaves", 0, 0, 0, 1.8)
        const colors = ["#f48fb1", "#ffffff", "#ce93d8", "#ffe082", "#80deea"]
        for (let i = 0; i < 16; i++) {
          const ang = r() * Math.PI * 2
          const rad = 1.8 + r() * 1.8
          const m = put("ribbon", Math.cos(ang) * rad, Math.sin(ang) * rad, r() * 6, 1, 3.4 + r() * 1.4)
          if (m) {
            m.material = new THREE.MeshStandardMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide, roughness: 0.6 })
            a.ownedMaterials.push(m.material)
            a.ribbons.push(m)
          }
        }
        for (let i = 0; i < 6; i++) {
          const ang = (i / 6) * Math.PI * 2
          put("paper_lantern", Math.cos(ang) * 2.6, Math.sin(ang) * 2.6, 0, 0.8, 4.2)
          put("paper_lantern_glow", Math.cos(ang) * 2.6, Math.sin(ang) * 2.6, 0, 0.8, 4.2)
        }
        put("bench", 0, 6, Math.PI)
        break
      }
      case "balloon": {
        const b = put("balloon", 0, 0, 0, 0.85)
        a.balloon = b
        put("signpost", 3, 1.5, 2)
        break
      }
      case "gift":
        put(["gift_pink", "gift_lilac", "gift_mint"][d.seed % 3], 0, 0, d.rot, 1)
        break
      case "cupcake":
        put("cushion", 0, 0, 0, 0.45)
        put("cupcake", 0, 0, 0, 1.1, 0.1)
        break
      case "letter":
        put("letter", 0, 0, d.rot, 1.1, 0.02)
        break
    }
    // flower beds: one instanced draw per species instead of a mesh each
    // (the heart garden alone placed 70), and no sub-texel shadow casters
    const beds = new Map<THREE.BufferGeometry, THREE.Mesh[]>()
    for (const child of group.children) {
      const m = child as THREE.Mesh
      if (m.isMesh && m.material === propsMaterial() && !a.glows.includes(m)) {
        const list = beds.get(m.geometry) ?? []
        list.push(m)
        beds.set(m.geometry, list)
      }
    }
    for (const [geometry, list] of beds) {
      if (list.length < 3) continue
      const bed = new THREE.InstancedMesh(geometry, propsMaterial(), list.length)
      bed.receiveShadow = true
      list.forEach((m, i) => {
        m.updateMatrix()
        bed.setMatrixAt(i, m.matrix)
        group.remove(m)
      })
      bed.computeBoundingSphere()
      group.add(bed)
    }
    group.position.set(d.x, baseY, d.z)
    group.rotation.y = d.rot
    if (d.category === "find" && !discoveryRT.found.has(d.id)) {
      const sp = new THREE.Sprite(sys.sparkleMat)
      sp.scale.setScalar(0.7)
      sp.position.set(0, 0.9, 0)
      group.add(sp)
      a.sparkle = sp
    }
    root.add(group)
    group.updateMatrixWorld(true)
    return a
  }

  const dispose = (a: Active): void => {
    root.remove(a.group)
    // instanced flower beds own their instance buffers (geometry is shared)
    for (const child of a.group.children) if ((child as THREE.InstancedMesh).isInstancedMesh) (child as THREE.InstancedMesh).dispose()
    a.texture?.dispose()
    for (const material of a.ownedMaterials) material.dispose()
    if (a.beacon) root.remove(a.beacon)
  }

  const interact = (a: Active): void => {
    const d = a.d
    const fresh = markFound(d.id)
    const { text, line } = textFor(d)
    useDiscoveries.getState().refreshCount()
    useDiscoveries.getState().showToast({ title: text.title, line, kind: d.kind })
    sfx.sparkle()
    const burst = new THREE.Vector3(d.x, a.baseY + 1.2, d.z)
    discoveryPillar(burst, a.baseY, BURST_COLOR[d.kind] ?? "#ffe7b0", fresh)
    const gesture = GESTURE[d.kind] ?? "cheer"
    // face the discovery
    avatarRT().facing = Math.atan2(d.x - avatarRT().pos.x, d.z - avatarRT().pos.z)
    if (d.category === "find") {
      a.group.visible = false
      avatarRT().gesture = "cheer"
      avatarRT().gestureTime = 0
      return
    }
    if (gesture === "ride" && a.balloon) {
      startRide(a)
      return
    }
    avatarRT().gesture = gesture
    avatarRT().gestureTime = 0
    avatarRT().paused = gesture === "sit" || gesture === "paint" || gesture === "wish" || gesture === "pet"
    avatarRT().vel.set(0, 0, 0)
    if (gesture === "sit" && (d.kind === "bench" || d.kind === "umbrella")) {
      // settle onto the bench seat
      const c = Math.cos(d.rot)
      const s = Math.sin(d.rot)
      avatarRT().pos.x = d.x + 0 * c + 0.05 * s
      avatarRT().pos.z = d.z - 0 * s + 0.05 * c
      avatarRT().facing = d.rot
      // the seat is ~0.45 m up: lift her onto it while seated
      avatarRT().rideY = a.baseY + at0(a, 0, 0.05) + 0.14
    }
    if (d.kind === "catNap" && characterRT.active === catRT.owner) {
      catRT.affectionCooldown = 0
    }
  }

  const startRide = (a: Active): void => {
    sys.ride = { a, body: avatarRT(), t: 0, x: a.d.x, z: a.d.z, ground: a.baseY, yaw: cameraRT.targetYaw, pitch: cameraRT.targetPitch, distance: cameraRT.targetDistance }
    avatarRT().gesture = "ride"
    avatarRT().gestureTime = 0
    avatarRT().paused = true
    avatarRT().vel.set(0, 0, 0)
    avatarRT().pos.x = a.d.x
    avatarRT().pos.z = a.d.z
    cameraRT.targetDistance = Math.max(cameraRT.targetDistance, 13)
    cameraRT.targetPitch = 0.25
  }

  useFrame((state, rawDt) => {
    // on the Moon: home's life waits, paused, for the riders to come back
    if (awayFromEarth(avatarRT().pos)) return
    const dt = Math.min(rawDt, 0.1)
    if (!sys.props) return
    const px = avatarRT().pos.x
    const pz = avatarRT().pos.z
    const night = Math.max(0, Math.min(1, (worldRT.timeOfDay - 0.62) / 0.3))
    glowMaterial.emissiveIntensity = 0.35 + night * 1.6
    sys.beaconMat.uniforms.uTime.value = state.clock.elapsedTime
    root.position.set(0, 0, 0)

    // refresh the active set ~4x per second
    sys.timer -= dt
    if (sys.timer <= 0) {
      sys.timer = 0.25
      const near = discoveriesNear(px, pz, BEACON_RANGE, FIND_RANGE, sys.scratch)
      const wanted = new Set<string>()
      for (const d of near) {
        const dist = Math.hypot(d.x - px, d.z - pz)
        if (d.category === "find" && discoveryRT.found.has(d.id)) continue
        if (d.category === "landmark" && dist > LANDMARK_RANGE && discoveryRT.found.has(d.id)) continue
        wanted.add(d.id)
        let a = sys.active.get(d.id)
        if (!a) {
          // far landmarks only show their beacon; build scenery when close
          if (dist <= LANDMARK_RANGE || d.category === "find") {
            a = build(d)
          } else {
            const g = new THREE.Group()
            root.add(g)
            a = { d, group: g, glows: [], sparkle: null, beacon: null, balloon: null, ribbons: [], baseY: worldHeight(d.x, d.z), texture: null, ownedMaterials: [] }
            g.position.set(d.x, a.baseY, d.z)
            ;(a as Active & { stub?: boolean }).stub = true
          }
          sys.active.set(d.id, a)
        } else if ((a as Active & { stub?: boolean }).stub && dist <= LANDMARK_RANGE) {
          dispose(a)
          a = build(d)
          sys.active.set(d.id, a)
        }
        // beacon over undiscovered landmarks
        if (d.category === "landmark" && !discoveryRT.found.has(d.id)) {
          if (!a.beacon) {
            const b = new THREE.Mesh(sys.beaconGeo, sys.beaconMat)
            b.frustumCulled = false
            b.renderOrder = 5
            b.position.set(d.x, a.baseY, d.z)
            root.add(b)
            a.beacon = b
          }
        } else if (a.beacon) {
          root.remove(a.beacon)
          a.beacon = null
        }
      }
      for (const [id, a] of sys.active) {
        if (!wanted.has(id) && sys.ride?.a !== a) {
          dispose(a)
          sys.active.delete(id)
        }
      }
      let beacons = 0
      for (const a of sys.active.values()) if (a.beacon) beacons++
      discoveryStats.active = sys.active.size
      discoveryStats.beacons = beacons
    }

    // animate: sparkles bob, beacons fade near, ribbons sway, balloon bobs
    const t = state.clock.elapsedTime
    for (const a of sys.active.values()) {
      if (a.sparkle) {
        a.sparkle.position.y = 0.9 + Math.sin(t * 2 + a.d.seed) * 0.12
        a.sparkle.material.rotation = t * 0.6
      }
      if (a.beacon) {
        const dist = Math.hypot(a.d.x - px, a.d.z - pz)
        a.beacon.visible = dist > 18
        a.beacon.scale.set(1, 1, 1)
      }
      for (let i = 0; i < a.ribbons.length; i++) {
        const phase = a.d.x * 0.037 + a.d.z * 0.021 + i * 1.71
        a.ribbons[i].rotation.z = (windRT.dirX * 0.12 + Math.sin(t * 2.3 + phase) * 0.08) * (0.3 + windRT.strength + windRT.gust)
      }
      if (a.balloon && sys.ride?.a !== a) a.balloon.position.y = a.balloon.userData.baseY ?? (a.balloon.userData.baseY = a.balloon.position.y)
    }
    if (sys.beaconMat) sys.beaconMat.uniforms.uAlpha.value = 0.75 + Math.sin(t * 1.3) * 0.15

    // balloon ride: rise, drift, return
    const ride = sys.ride
    if (ride) {
      if (avatarRT().gesture !== "ride" || Math.hypot(px - ride.x, pz - ride.z) > 10) {
        finishRide(ride, false)
        sys.ride = null
        return
      }
      ride.t += dt
      const T_UP = 7
      const T_HOLD = 14
      const T_DOWN = 7
      const k = ride.t < T_UP ? smooth01(ride.t / T_UP) : ride.t < T_UP + T_HOLD ? 1 : 1 - smooth01((ride.t - T_UP - T_HOLD) / T_DOWN)
      const alt = k * 38
      const balloon = ride.a.balloon
      if (balloon) balloon.position.y = (balloon.userData.baseY ?? 0) + alt
      avatarRT().rideY = ride.ground + alt + 0.62
      avatarRT().pos.x = ride.x + Math.sin(ride.t * 0.3) * 0.05
      avatarRT().pos.z = ride.z
      avatarRT().facing += dt * 0.12
      if (!cameraRT.userHold) cameraRT.targetYaw += dt * 0.1
      if (ride.t > T_UP + T_HOLD + T_DOWN || (ride.t > 2 && (input.interact || input.cancel) && ride.t < T_UP + T_HOLD)) {
        if (ride.t <= T_UP + T_HOLD + T_DOWN && (input.interact || input.cancel)) {
          // skip ahead to the descent
          ride.t = T_UP + T_HOLD
          input.interact = false
          input.cancel = false
        } else {
          finishRide(ride, true)
          sys.ride = null
        }
      }
      useDiscoveries.getState().setPrompt(ride.t < T_UP + T_HOLD ? "E — float back down" : null)
      return
    }

    // nearest interactable discovery
    if (!useGame.getState().started || worldRT.introActive || worldRT.finaleActive) {
      discoveryRT.near = null
      useDiscoveries.getState().setPrompt(null)
      return
    }
    let best: Active | null = null
    let bestD = Infinity
    for (const a of sys.active.values()) {
      if ((a as Active & { stub?: boolean }).stub || !a.group.visible) continue
      const dist = Math.hypot(a.d.x - px, a.d.z - pz)
      if (dist < a.d.radius + 0.6 && dist < bestD) {
        best = a
        bestD = dist
      }
    }
    discoveryRT.near = best?.d ?? null
    const memoryNearby = worldRT.nearMemoryId !== null || worldRT.nearSecretId !== null
    const busy = avatarRT().gesture !== "none"
    useDiscoveries.getState().setPrompt(discoveryRT.horsePrompt ?? (!memoryNearby && !busy ? discoveryRT.animalPrompt ?? (best ? `E — ${textFor(best.d).text.verb}` : null) : null))
    if (best && !discoveryRT.animalPrompt && !discoveryRT.horsePrompt && !memoryNearby && !busy && input.interact && !avatarRT().paused) {
      input.interact = false
      interact(best)
    }
  })

  return <primitive object={root} />
}

const finishRide = (ride: { a: Active; body: AvatarBody; x: number; z: number; yaw: number; pitch: number; distance: number }, land: boolean): void => {
  if (ride.a.balloon) ride.a.balloon.position.y = ride.a.balloon.userData.baseY ?? 0
  cameraRT.targetYaw = ride.yaw
  cameraRT.targetPitch = ride.pitch
  cameraRT.targetDistance = ride.distance
  ride.body.rideY = null
  ride.body.gesture = "none"
  ride.body.paused = false
  if (land) {
    ride.body.pos.set(ride.x + 1.6, worldHeight(ride.x + 1.6, ride.z), ride.z)
    ride.body.vel.set(0, 0, 0)
    ride.body.revision++
  }
}

const at0 = (a: Active, lx: number, lz: number): number => {
  const c = Math.cos(a.d.rot)
  const s = Math.sin(a.d.rot)
  return worldHeight(a.d.x + lx * c + lz * s, a.d.z - lx * s + lz * c) - a.baseY
}

const smooth01 = (x: number): number => {
  const t = Math.max(0, Math.min(1, x))
  return t * t * (3 - 2 * t)
}
