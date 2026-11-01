import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { avatarRT, cameraRT } from "../../runtime"
import { groundHeight } from "../../world-layout"
import { realmColliders } from "../../../world/realmHook"
import type { CircleCollider } from "../../world-layout"
import { useGame } from "../../../state/gameStore"
import { useSky } from "../../../state/skyStore"
import { spaceRT } from "../spaceState"
import { rememberSite } from "../voyageMemory"
import { realmDirection, realmLocalOf, realmRT } from "./realmState"
import { calmFactor } from "./realmTerrain"
import { ALL_SITES, siteDirection, type LunarSite } from "./lunarSites"
import { LAYOUTS, siteReach, type LayoutItem } from "./lunarLayout"
import * as HW from "./lunarHardware"
import { LunarDust } from "./LunarDust"

/**
 * The Moon at life size, round the riders: the historic sites with their
 * hardware, footpaths and wheel tracks, the bright blast zones LRO sees
 * round the landers, and a field of boulders over the regolith. Sites are
 * built when the riders come within a kilometre or so and let go when they
 * leave; standing near one opens its card (SkyHud) and remembers it.
 *
 * Placement: each site's anchor is its real selenographic position on the
 * Moon (lunarSites.ts) read in the current local frame (realmLocalOf);
 * everything at the site is offset from it in true metres east and north.
 * Built models use +x east, −z north, +y up.
 */

/** QA (`?debug`): where each site lies in the current frame, and what is built. */
export const lunarSceneRT = {
  placed: new Map<string, { x: number; z: number; nx: number; nz: number } | null>(),
  built: [] as string[],
  rocks: 0,
}

const BUILD_AT = 1400
const DROP_AT = 2000
const DISCOVER_AT = 34

type Placed = { site: LunarSite; x: number; z: number; nx: number; nz: number }
type Built = { group: THREE.Group; colliders: CircleCollider[] }

const _d = new THREE.Vector3()
const _p = new THREE.Vector3()
const _q = new THREE.Vector3()

/** The site's anchor and north in the current frame, or null if it is round the far side. */
const place = (site: LunarSite): Placed | null => {
  siteDirection(site, _d)
  const a = realmLocalOf(_d, _p)
  if (!a) return null
  const x = a.x, z = a.z
  siteDirection({ lat: site.lat + (site.lat > 89 ? -0.01 : 0.01), lon: site.lon }, _d)
  const b = realmLocalOf(_d, _q)
  if (!b) return null
  let nx = b.x - x, nz = b.z - z
  if (site.lat > 89) { nx = -nx; nz = -nz }
  const l = Math.hypot(nx, nz) || 1
  return { site, x, z, nx: nx / l, nz: nz / l }
}

/** A point `e` east and `n` north of a placed site. */
const offset = (p: Placed, e: number, n: number): [number, number] => [p.x - p.nz * e + p.nx * n, p.z + p.nx * e + p.nz * n]

// ---- ground marks: footprints, wheel tracks, patches ---------------------------------

const bootTexture = (): THREE.CanvasTexture => {
  const c = document.createElement("canvas")
  c.width = 64
  c.height = 128
  const g = c.getContext("2d")!
  g.fillStyle = "#000"
  g.fillRect(0, 0, 64, 128)
  // the sole of an Apollo overboot, and its ribbed tread
  g.fillStyle = "#fff"
  g.beginPath()
  g.ellipse(32, 38, 24, 34, 0, 0, Math.PI * 2)
  g.ellipse(32, 98, 20, 26, 0, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = "#6a6a6a"
  for (let y = 8; y < 124; y += 9) g.fillRect(6, y, 52, 3.4)
  const t = new THREE.CanvasTexture(c)
  return t
}

const trackTexture = (): THREE.CanvasTexture => {
  const c = document.createElement("canvas")
  c.width = 32
  c.height = 64
  const g = c.getContext("2d")!
  g.fillStyle = "#000"
  g.fillRect(0, 0, 32, 64)
  g.fillStyle = "#fff"
  // chevrons of a wire-mesh tyre's tread
  for (let y = 0; y < 64; y += 10) {
    g.beginPath()
    g.moveTo(2, y + 6); g.lineTo(16, y); g.lineTo(30, y + 6); g.lineTo(30, y + 10); g.lineTo(16, y + 4); g.lineTo(2, y + 10)
    g.fill()
  }
  g.globalAlpha = 0.45
  g.fillRect(0, 0, 32, 64)
  const t = new THREE.CanvasTexture(c)
  t.wrapT = THREE.RepeatWrapping
  return t
}

const radialTexture = (): THREE.CanvasTexture => {
  const c = document.createElement("canvas")
  c.width = 128
  c.height = 128
  const g = c.getContext("2d")!
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, "#fff")
  grad.addColorStop(0.55, "#bbb")
  grad.addColorStop(1, "#000")
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

type Marks = { boot: THREE.CanvasTexture; track: THREE.CanvasTexture; radial: THREE.CanvasTexture }

const groundNormal = (x: number, z: number, out: THREE.Vector3): THREE.Vector3 => {
  const e = 0.35
  return out.set(groundHeight(x - e, z) - groundHeight(x + e, z), 2 * e, groundHeight(x, z - e) - groundHeight(x, z + e)).normalize()
}

const UP = new THREE.Vector3(0, 1, 0)
const _n = new THREE.Vector3()
const _qa = new THREE.Quaternion()
const _qb = new THREE.Quaternion()
const _m = new THREE.Matrix4()
const _s = new THREE.Vector3(1, 1, 1)

/** Lay instanced marks along polylines (dark disturbed regolith on lighter dust). */
const markLine = (
  p: Placed, lines: Array<Array<[number, number]>>, mesh: THREE.InstancedMesh, step: number, pair: number, seed: number,
): void => {
  // instance matrices are float32: positions are kept relative to the site's anchor
  let n = mesh.count
  let flip = seed
  for (const line of lines) {
    for (let k = 0; k + 1 < line.length; k++) {
      const [ax, az] = offset(p, line[k][0], line[k][1])
      const [bx, bz] = offset(p, line[k + 1][0], line[k + 1][1])
      const len = Math.hypot(bx - ax, bz - az)
      const yaw = Math.atan2(bx - ax, bz - az)
      for (let t = 0; t < len && n < mesh.instanceMatrix.count; t += step) {
        flip++
        // two tracks (left, right), or the left and right boots
        for (const side of pair > 0 ? [-1, 1] : [flip % 2 ? -1 : 1]) {
          const off = (pair > 0 ? pair : 0.13) * side
          const x = ax + (bx - ax) * (t / len) + Math.cos(yaw) * off
          const z = az + (bz - az) * (t / len) - Math.sin(yaw) * off
          const y = groundHeight(x, z) + 0.012
          _qa.setFromUnitVectors(UP, groundNormal(x, z, _n))
          _qb.setFromAxisAngle(UP, yaw + (pair > 0 ? 0 : Math.sin(flip * 7.3) * 0.12))
          _m.compose(_q.set(x - p.x, y, z - p.z), _qa.multiply(_qb), _s)
          if (n < mesh.instanceMatrix.count) mesh.setMatrixAt(n++, _m)
        }
      }
    }
  }
  mesh.count = n
  mesh.instanceMatrix.needsUpdate = true
}

/** A disc of ground tone that follows the terrain (a blast zone, trampled dust, an impact scar). */
const groundPatch = (x: number, z: number, r: number, tone: "bright" | "dark", radial: THREE.Texture, ox: number, oz: number): THREE.Mesh => {
  const N = 18
  const geo = new THREE.PlaneGeometry(r * 2, r * 2, N, N)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) pos.setY(i, groundHeight(x + pos.getX(i), z + pos.getZ(i)) + (tone === "dark" ? 0.02 : 0.016))
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: tone === "dark" ? "#3a362f" : "#d9d3c6", alphaMap: radial, transparent: true, depthWrite: false,
    opacity: tone === "dark" ? 0.42 : 0.2, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }))
  mesh.position.set(x - ox, 0, z - oz)
  mesh.receiveShadow = true
  mesh.renderOrder = 1
  return mesh
}

const buildItem = (it: LayoutItem): THREE.Group => {
  switch (it.kind) {
    case "lm": return HW.buildDescentStage(!!it.plaque)
    case "flag": return HW.buildFlag(it.standing !== false, it.lean ?? 0)
    case "lrrr": return HW.buildRetroreflector()
    case "psep": return HW.buildSeismometer()
    case "alsep": return HW.buildAlsep()
    case "lrv": return HW.buildRover()
    case "vikram": return HW.buildVikram()
    case "pragyan": return HW.buildPragyan()
    case "debris": return HW.buildDebris(911)
  }
}

const buildSite = (p: Placed, marks: Marks): Built => {
  const group = new THREE.Group()
  group.name = `site-${p.site.id}`
  // the group sits at the anchor (a large logical coordinate, kept in float64
  // by the scene graph); everything in it is a small offset from there
  group.position.set(p.x, 0, p.z)
  const layout = LAYOUTS[p.site.id]
  const colliders: CircleCollider[] = []
  if (!layout) return { group, colliders }
  // facing: the model's −z to north
  const base = Math.atan2(-p.nx, -p.nz)
  for (const it of layout.items) {
    const [x, z] = offset(p, it.e, it.n)
    const model = buildItem(it)
    // sit on the lowest of the ground under its middle and round it, so nothing floats
    const y = Math.min(groundHeight(x, z), groundHeight(x + 1, z), groundHeight(x - 1, z), groundHeight(x, z + 1), groundHeight(x, z - 1))
    model.position.set(x - p.x, y, z - p.z)
    model.rotation.y = base + (it.yaw ?? 0)
    group.add(model)
    if (it.r) colliders.push({ x, z, r: it.r, height: it.kind === "lm" ? 3.2 : 1.2, jumpable: it.r < 0.7, standable: false })
  }
  const boots = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.15, 0.33).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({
    color: "#2f2c27", alphaMap: marks.boot, transparent: true, opacity: 0.55, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  }), 1600)
  boots.count = 0
  boots.frustumCulled = false
  boots.receiveShadow = true
  boots.renderOrder = 2
  markLine(p, layout.walks ?? [], boots, 0.62, 0, 1)
  // round the lander the ground is trodden every which way
  if (p.site.kind === "apollo") {
    const loops: Array<Array<[number, number]>> = []
    for (let k = 0; k < 7; k++) {
      const a = k * 0.9, r = 3.2 + (k % 3) * 1.6
      loops.push([[Math.cos(a) * r, Math.sin(a) * r], [Math.cos(a + 1.3) * (r + 1.2), Math.sin(a + 1.3) * (r + 1.2)], [Math.cos(a + 2.4) * r, Math.sin(a + 2.4) * r]])
    }
    markLine(p, loops, boots, 0.7, 0, 5)
  }
  group.add(boots)
  if (layout.tracks?.length) {
    const tracks = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.23, 0.62).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({
      color: "#2c2924", alphaMap: marks.track, transparent: true, opacity: 0.5, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }), 2400)
    tracks.count = 0
    tracks.frustumCulled = false
    tracks.renderOrder = 2
    // the LRV runs 1.83 m between its wheels; Pragyan about 0.8 m
    markLine(p, layout.tracks, tracks, 0.55, p.site.kind === "chandrayaan3" ? 0.4 : 0.915, 3)
    group.add(tracks)
  }
  for (const patch of layout.patches ?? []) {
    const [x, z] = offset(p, patch.e, patch.n)
    group.add(groundPatch(x, z, patch.r, patch.tone, marks.radial, p.x, p.z))
  }
  return { group, colliders }
}

const disposeGroup = (g: THREE.Object3D): void => {
  g.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.geometry.dispose()
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture && v !== undefined) v.dispose()
      mat.dispose()
    }
  })
}

// ---- boulders ------------------------------------------------------------------------

const ROCK_VARIANTS = 4
const MAX_ROCKS = 900
const ROCK_REACH = 70
const CELL = 4

const hash = (a: number, b: number, c: number): number => {
  let h = Math.imul(a ^ 0x5bd1e995, 0x27d4eb2d)
  h = Math.imul(h ^ (h >>> 15) ^ b, 0x165667b1)
  h = Math.imul(h ^ (h >>> 13) ^ c, 0x27d4eb2d)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const rockGeometry = (seed: number): THREE.BufferGeometry => {
  const g = new THREE.IcosahedronGeometry(1, 2)
  const pos = g.attributes.position
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i)
    const n = 1 + 0.22 * Math.sin(_p.x * 3.1 + seed) * Math.cos(_p.y * 2.7 + seed * 1.7) + 0.12 * Math.sin(_p.z * 5.3 + seed * 2.3)
    // a flatter top and base: rocks settle, and the dust buries their feet
    pos.setXYZ(i, _p.x * n * (1 + 0.15 * Math.sin(seed)), _p.y * n * 0.62, _p.z * n)
  }
  g.computeVertexNormals()
  return g
}

type RockField = { meshes: THREE.InstancedMesh[]; at: THREE.Vector2; version: number }

const rebuildRocks = (field: RockField, px: number, pz: number, colliders: CircleCollider[]): void => {
  const b = realmRT.body
  if (!b) return
  const R = b.radius
  const seen = new Set<string>()
  const counts = new Array(ROCK_VARIANTS).fill(0)
  const step = 2.6
  for (let ix = -ROCK_REACH; ix <= ROCK_REACH; ix += step) for (let iz = -ROCK_REACH; iz <= ROCK_REACH; iz += step) {
    if (ix * ix + iz * iz > ROCK_REACH * ROCK_REACH) continue
    // the cell is fixed to the Moon itself, so the field never shifts when the frame does
    realmDirection(px + ix, pz + iz, _d)
    const cx = Math.floor((_d.x * R) / CELL), cy = Math.floor((_d.y * R) / CELL), cz = Math.floor((_d.z * R) / CELL)
    const key = `${cx},${cy},${cz}`
    if (seen.has(key)) continue
    seen.add(key)
    const u = hash(cx, cy, cz)
    if (u > 0.5) continue
    // a power law of sizes: many pebbles, some stones, a rare boulder
    const s = Math.min(2.4, 0.07 / Math.pow(Math.max(1e-3, 1 - hash(cy, cz, cx)), 0.95) + 0.03)
    _q.set((cx + hash(cz, cx, cy)) * CELL, (cy + hash(cx + 7, cy, cz)) * CELL, (cz + hash(cx, cy + 7, cz)) * CELL).normalize()
    if (calmFactor(_q, R, realmRT.calm) < 0.6) continue
    const local = realmLocalOf(_q, _p)
    if (!local) continue
    const v = Math.floor(hash(cz + 3, cy, cx) * ROCK_VARIANTS)
    const mesh = field.meshes[v]
    if (counts[v] >= MAX_ROCKS) continue
    const y = groundHeight(local.x, local.z) - s * 0.28
    _qa.setFromAxisAngle(UP, hash(cx, cz, cy + 3) * Math.PI * 2)
    _m.compose(_n.set(local.x - px, y, local.z - pz), _qa, _q.set(s, s * (0.7 + 0.5 * hash(cy, cx, cz + 9)), s))
    mesh.setMatrixAt(counts[v]++, _m)
    if (s > 0.38) colliders.push({ x: local.x, z: local.z, r: s * 0.85, height: s * 0.9, jumpable: s < 0.9, standable: true })
  }
  field.meshes.forEach((m, i) => {
    m.position.set(px, 0, pz)
    m.updateMatrixWorld()
    m.count = counts[i]
    m.instanceMatrix.needsUpdate = true
    m.computeBoundingSphere()
  })
  field.at.set(px, pz)
  field.version = realmRT.version
}

// ---- the scene ------------------------------------------------------------------------

export const LunarScene = (): React.ReactElement => {
  const sys = useMemo(() => {
    const root = new THREE.Group()
    root.name = "lunar-scene"
    root.visible = false
    const marks: Marks = { boot: bootTexture(), track: trackTexture(), radial: radialTexture() }
    const rockMat = new THREE.MeshStandardMaterial({ color: "#837d73", roughness: 0.96, metalness: 0 })
    const meshes = Array.from({ length: ROCK_VARIANTS }, (_, i) => {
      const m = new THREE.InstancedMesh(rockGeometry(i * 1.7 + 0.4), rockMat, MAX_ROCKS)
      m.count = 0
      m.castShadow = true
      m.receiveShadow = true
      m.frustumCulled = false
      root.add(m)
      return m
    })
    return {
      root, marks, rockMat,
      rocks: { meshes, at: new THREE.Vector2(Infinity, Infinity), version: -1 } as RockField,
      built: new Map<string, Built>(),
      placed: new Map<string, Placed | null>(),
      placedVersion: -1,
      rockColliders: [] as CircleCollider[],
      timer: 0,
      shown: null as string | null,
    }
  }, [])

  useEffect(() => () => {
    for (const b of sys.built.values()) disposeGroup(b.group)
    for (const m of sys.rocks.meshes) m.geometry.dispose()
    sys.rockMat.dispose()
    sys.marks.boot.dispose(); sys.marks.track.dispose(); sys.marks.radial.dispose()
  }, [sys])

  const syncColliders = (): void => {
    realmColliders.list = [...sys.rockColliders, ...[...sys.built.values()].flatMap((b) => b.colliders)]
    realmColliders.version++
  }

  useFrame((_, dt) => {
    const on = spaceRT.realm === "moon" && spaceRT.mode === "local" && !!realmRT.body
    sys.root.visible = on
    if (!on) {
      if (sys.built.size || sys.rockColliders.length) {
        for (const b of sys.built.values()) { sys.root.remove(b.group); disposeGroup(b.group) }
        sys.built.clear()
        sys.rockColliders = []
        for (const m of sys.rocks.meshes) m.count = 0
        sys.rocks.version = -1
        syncColliders()
      }
      if (sys.shown) {
        sys.shown = null
        useSky.getState().setSite(null)
      }
      // off the Moon, the way to its sites is no longer shown (the setter is a no-op when clear)
      useSky.getState().setLunarHint(null)
      return
    }
    const p = avatarRT().pos
    // the frame was laid again: every site's place and the boulders move with it
    if (sys.placedVersion !== realmRT.version) {
      sys.placedVersion = realmRT.version
      sys.placed.clear()
      for (const s of ALL_SITES) sys.placed.set(s.id, place(s))
      lunarSceneRT.placed = sys.placed
      for (const b of sys.built.values()) { sys.root.remove(b.group); disposeGroup(b.group) }
      sys.built.clear()
      sys.rocks.version = -1
    }
    if (sys.rocks.version !== realmRT.version || Math.hypot(p.x - sys.rocks.at.x, p.z - sys.rocks.at.y) > 14) {
      // the boulders matter only near the dust (from high up they are too small to see)
      const agl = p.y - groundHeight(p.x, p.z)
      if (agl < 120) {
        sys.rockColliders = []
        rebuildRocks(sys.rocks, p.x, p.z, sys.rockColliders)
        syncColliders()
      }
    }
    sys.timer -= dt
    if (sys.timer > 0) return
    sys.timer = 0.4
    let nearest: { placed: Placed; d: number } | null = null
    let changed = false
    for (const s of ALL_SITES) {
      const pl = sys.placed.get(s.id)
      if (!pl) continue
      const d = Math.hypot(pl.x - p.x, pl.z - p.z)
      if (!nearest || d < nearest.d) nearest = { placed: pl, d }
      const built = sys.built.get(s.id)
      if (!built && d < BUILD_AT) {
        const b = buildSite(pl, sys.marks)
        sys.root.add(b.group)
        sys.built.set(s.id, b)
        changed = true
      } else if (built && d > DROP_AT) {
        sys.root.remove(built.group)
        disposeGroup(built.group)
        sys.built.delete(s.id)
        changed = true
      }
    }
    if (changed) syncColliders()
    lunarSceneRT.built = [...sys.built.keys()]
    lunarSceneRT.rocks = sys.rocks.meshes.reduce((n, m) => n + m.count, 0)
    // ---- standing by a site: its card; further off, which way it lies
    const sky = useSky.getState()
    if (nearest && nearest.d < Math.max(DISCOVER_AT, Math.min(60, siteReach(nearest.placed.site.id) * 0.35))) {
      const s = nearest.placed.site
      if (sys.shown !== s.id) {
        sys.shown = s.id
        sky.setSite({ id: s.id, title: s.title, mission: s.mission, date: s.date, lines: s.lines, credit: s.credit, historical: s.historical })
        if (rememberSite(s.id)) useGame.getState().showHint(s.historical ? `You found ${s.name}.` : `${s.name} — a tribute, not a relic.`)
      }
      sky.setLunarHint(null)
    } else {
      if (sys.shown && (!nearest || nearest.placed.site.id !== sys.shown || nearest.d > 90)) {
        sys.shown = null
        sky.setSite(null)
      }
      if (nearest && nearest.d < 9000) {
        // which way, seen from the camera
        const bearing = Math.atan2(nearest.placed.x - p.x, nearest.placed.z - p.z)
        const rel = Math.atan2(Math.sin(bearing - cameraRT.viewYaw), Math.cos(bearing - cameraRT.viewYaw))
        const dir = Math.abs(rel) < 0.4 ? "ahead" : Math.abs(rel) > 2.6 ? "behind you" : rel > 0 ? "to the left" : "to the right"
        const dist = nearest.d < 1000 ? `${Math.round(nearest.d / 10) * 10} m` : `${(nearest.d / 1000).toFixed(1)} km`
        sky.setLunarHint(`${nearest.placed.site.title} — ${dist} ${dir}`)
      } else sky.setLunarHint(null)
    }
  })

  return (
    <>
      <primitive object={sys.root} />
      <LunarDust />
    </>
  )
}
