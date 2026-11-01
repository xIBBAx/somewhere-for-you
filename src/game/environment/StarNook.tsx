import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { useHubFrame } from "../hubGate"
import { groundHeight } from "../world-layout"
import { worldRT } from "../runtime"
import { PALETTE, SignBoard } from "./props"
import { moonPosition, nightBlend } from "./celestialLighting"
import { voyage } from "../celestial/voyageMemory"
import {
  NOOK_DECK, NOOK_RACK, NOOK_SPOTS, NOOK_TELESCOPE, NOOK_TOWER, NOOK_WALL, STAR_NOOK, rackPeg,
} from "../../world/starNookLayout"

/**
 * Star Nook: a stargazing deck on the east side of home, sheltered on the
 * south-east by a low crescent of dry stone under a sailcloth sewn with
 * stars, open to the north-west toward home and the pond, with a brass
 * telescope that follows the Moon.
 *
 * It is there from the start, a quiet place to watch the sky. When the space
 * cats come home it becomes theirs: cushions in their colours, bowls, a cat
 * tower and a rack for the five helmets they will not need again
 * (spaceCats/SpaceCats.tsx hangs the helmets on its pegs).
 */

const polar = (deg: number, r: number): [number, number] => [Math.cos((deg * Math.PI) / 180) * r, Math.sin((deg * Math.PI) / 180) * r]

const plankTexture = (): THREE.CanvasTexture => {
  const c = document.createElement("canvas")
  c.width = c.height = 512
  const g = c.getContext("2d")!
  const planks = 14
  for (let i = 0; i < planks; i++) {
    const tone = 0.86 + ((i * 37) % 11) / 70
    g.fillStyle = `rgb(${Math.round(181 * tone)}, ${Math.round(129 * tone)}, ${Math.round(82 * tone)})`
    g.fillRect(0, (i * 512) / planks, 512, 512 / planks)
    // grain
    g.strokeStyle = "rgba(90, 58, 30, 0.18)"
    g.lineWidth = 1
    for (let k = 0; k < 5; k++) {
      const y = (i * 512) / planks + 4 + k * 6.5
      g.beginPath()
      g.moveTo(0, y)
      for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i * 3 + k) * 1.4)
      g.stroke()
    }
    // the seam
    g.fillStyle = "rgba(60, 38, 20, 0.55)"
    g.fillRect(0, ((i + 1) * 512) / planks - 2, 512, 2)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

/** Indigo sailcloth sewn with small gold stars. */
const sailTexture = (): THREE.CanvasTexture => {
  const c = document.createElement("canvas")
  c.width = c.height = 256
  const g = c.getContext("2d")!
  g.fillStyle = "#26305c"
  g.fillRect(0, 0, 256, 256)
  let s = 7
  const r = (): number => ((s = (s * 16807) % 2147483647) / 2147483647)
  g.fillStyle = "#e9c768"
  for (let i = 0; i < 34; i++) {
    const x = r() * 256, y = r() * 256, a = 1.5 + r() * 2.6
    g.beginPath()
    for (let k = 0; k < 10; k++) {
      const rr = k % 2 ? a * 0.42 : a
      const th = (k / 10) * Math.PI * 2 - Math.PI / 2
      g.lineTo(x + Math.cos(th) * rr, y + Math.sin(th) * rr)
    }
    g.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(2, 2)
  return t
}

const _moon = new THREE.Vector3()
const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const UP = new THREE.Vector3(0, 1, 0)

export const StarNook = (): React.ReactElement => {
  const nx = STAR_NOOK.x, nz = STAR_NOOK.z
  const gy = groundHeight(nx, nz)
  const deckY = gy + NOOK_DECK.h

  const sys = useMemo(() => {
    const disposables: Array<{ dispose: () => void }> = []
    const keep = <T extends { dispose: () => void }>(x: T): T => { disposables.push(x); return x }
    const root = new THREE.Group()
    root.name = "star-nook"
    const woodMat = keep(new THREE.MeshStandardMaterial({ color: PALETTE.wood, roughness: 0.82 }))
    const woodDark = keep(new THREE.MeshStandardMaterial({ color: PALETTE.woodDark, roughness: 0.85 }))
    const brass = keep(new THREE.MeshStandardMaterial({ color: "#c79a46", metalness: 0.85, roughness: 0.32 }))
    const stoneMat = keep(new THREE.MeshStandardMaterial({ color: PALETTE.stone, roughness: 0.96 }))

    // ---- the deck: planks, a rim and short legs into the ground ----------------
    const planks = keep(plankTexture())
    const deckTop = keep(new THREE.MeshStandardMaterial({ map: planks, roughness: 0.8 }))
    const deck = new THREE.Mesh(keep(new THREE.CylinderGeometry(NOOK_DECK.r, NOOK_DECK.r, 0.3, 56)), [woodDark, deckTop, woodDark])
    deck.position.set(nx, deckY - 0.15, nz)
    deck.receiveShadow = true
    deck.castShadow = true
    root.add(deck)
    const rim = new THREE.Mesh(keep(new THREE.TorusGeometry(NOOK_DECK.r - 0.02, 0.035, 6, 72)), woodDark)
    rim.rotation.x = Math.PI / 2
    rim.position.set(nx, deckY + 0.005, nz)
    root.add(rim)

    // ---- the crescent wall: two courses of dry stone and cap stones -------------
    const stoneGeo = keep(new THREE.DodecahedronGeometry(0.5, 0))
    const stones = new THREE.InstancedMesh(stoneGeo, stoneMat, 90)
    let n = 0
    let seed = 11
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let course = 0; course < 3; course++) {
      const count = course === 2 ? 22 : 28
      for (let i = 0; i < count; i++) {
        const deg = NOOK_WALL.from + ((NOOK_WALL.to - NOOK_WALL.from) * (i + (course % 2) * 0.5)) / (count - 0.5)
        const [px, pz] = polar(deg, NOOK_WALL.r + (rnd() - 0.5) * 0.06)
        const x = nx + px, z = nz + pz
        const w = 0.34 + rnd() * 0.1, h = course === 2 ? 0.12 : 0.2 + rnd() * 0.04
        _q.setFromAxisAngle(UP, -((deg * Math.PI) / 180) + (rnd() - 0.5) * 0.3)
        _m.compose(new THREE.Vector3(x, groundHeight(x, z) + 0.09 + course * 0.19, z), _q, new THREE.Vector3(w * 1.25, h, 0.3 + rnd() * 0.06))
        stones.setMatrixAt(n++, _m)
      }
    }
    stones.count = n
    stones.castShadow = stones.receiveShadow = true
    root.add(stones)

    // ---- the canopy: a shade sail between three posts ---------------------------
    const postGeo = keep(new THREE.CylinderGeometry(0.05, 0.06, 1, 8))
    const corners: THREE.Vector3[] = []
    for (const [deg, r, h] of [[NOOK_WALL.from + 4, NOOK_WALL.r + 0.25, 2.25], [45, NOOK_WALL.r + 0.3, 2.75], [NOOK_WALL.to - 4, NOOK_WALL.r + 0.25, 2.25]] as const) {
      const [px, pz] = polar(deg, r)
      const x = nx + px, z = nz + pz, y = groundHeight(x, z)
      const post = new THREE.Mesh(postGeo, woodDark)
      post.scale.y = h
      post.position.set(x, y + h / 2, z)
      post.castShadow = true
      root.add(post)
      corners.push(new THREE.Vector3(x, y + h - 0.05, z))
    }
    // the sail sags toward its middle, over the cushions
    const sailGeo = keep(new THREE.BufferGeometry())
    const seg = 10
    const verts: number[] = [], uvs: number[] = [], idx: number[] = []
    const [A, B, C] = corners
    const sagAt = new THREE.Vector3(nx, 0, nz)
    for (let i = 0; i <= seg; i++) for (let j = 0; j <= seg - i; j++) {
      const a = i / seg, b = j / seg, c = 1 - a - b
      const p = new THREE.Vector3().addScaledVector(A, c).addScaledVector(B, a).addScaledVector(C, b)
      p.y -= 0.45 * 27 * a * b * c
      // pulled in a little toward the deck
      p.lerp(sagAt.setY(p.y), 0.08 * 27 * a * b * c)
      verts.push(p.x, p.y, p.z)
      uvs.push(p.x * 0.35, p.z * 0.35)
    }
    const at = (i: number, j: number): number => {
      let k = 0
      for (let q = 0; q < i; q++) k += seg - q + 1
      return k + j
    }
    for (let i = 0; i < seg; i++) for (let j = 0; j < seg - i; j++) {
      idx.push(at(i, j), at(i + 1, j), at(i, j + 1))
      if (j + 1 < seg - i) idx.push(at(i + 1, j), at(i + 1, j + 1), at(i, j + 1))
    }
    sailGeo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3))
    sailGeo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))
    sailGeo.setIndex(idx)
    sailGeo.computeVertexNormals()
    const sailMap = keep(sailTexture())
    const sail = new THREE.Mesh(sailGeo, keep(new THREE.MeshStandardMaterial({ map: sailMap, side: THREE.DoubleSide, roughness: 0.9 })))
    sail.castShadow = true
    sail.receiveShadow = true
    root.add(sail)
    // little warm lights along the sail's open edge
    const bulbs = new THREE.InstancedMesh(keep(new THREE.SphereGeometry(0.03, 8, 6)), keep(new THREE.MeshStandardMaterial({ color: "#fff1cf", emissive: "#ffc56b", emissiveIntensity: 0.4 })), 24)
    let b = 0
    for (const [P, Q] of [[A, C]] as const) {
      for (let i = 1; i < 12; i++) {
        const u = i / 12
        const p = new THREE.Vector3().lerpVectors(P, Q, u)
        p.y -= Math.sin(u * Math.PI) * 0.35 + 0.06
        p.lerp(new THREE.Vector3(nx, p.y, nz), Math.sin(u * Math.PI) * 0.1)
        bulbs.setMatrixAt(b++, _m.makeTranslation(p.x, p.y, p.z))
      }
    }
    bulbs.count = b
    root.add(bulbs)

    // ---- the telescope: a tripod and a brass tube that follows the Moon ---------
    const scope = new THREE.Group()
    const [tx, tz] = [nx + NOOK_TELESCOPE.x, nz + NOOK_TELESCOPE.z]
    scope.position.set(tx, groundHeight(tx, tz), tz)
    const legGeo = keep(new THREE.CylinderGeometry(0.018, 0.022, 1.2, 6))
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2
      const leg = new THREE.Mesh(legGeo, woodDark)
      leg.position.set(Math.cos(a) * 0.22, 0.56, Math.sin(a) * 0.22)
      leg.rotation.set(Math.sin(a) * 0.36, 0, -Math.cos(a) * 0.36)
      leg.castShadow = true
      scope.add(leg)
    }
    const head = new THREE.Group()
    head.position.y = 1.14
    scope.add(head)
    const lacquer = keep(new THREE.MeshStandardMaterial({ color: "#1f2a48", metalness: 0.3, roughness: 0.38 }))
    const tube = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.052, 0.062, 0.86, 20).rotateX(Math.PI / 2)), lacquer)
    tube.position.z = 0.16
    tube.castShadow = true
    head.add(tube)
    // brass at the objective, the middle and the focuser
    const band = keep(new THREE.CylinderGeometry(0.066, 0.066, 0.05, 20).rotateX(Math.PI / 2))
    for (const z of [0.56, 0.16, -0.24]) {
      const ring = new THREE.Mesh(band, brass)
      ring.position.z = z
      ring.scale.setScalar(z > 0.5 ? 1.06 : z < 0 ? 0.92 : 1)
      head.add(ring)
    }
    const mount = new THREE.Mesh(keep(new THREE.SphereGeometry(0.05, 12, 8)), brass)
    mount.position.y = 1.12
    scope.add(mount)
    const eyepiece = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.02, 0.025, 0.12, 10).rotateX(Math.PI / 2)), woodDark)
    eyepiece.position.z = -0.34
    head.add(eyepiece)
    root.add(scope)

    // ---- for the cats: cushions, bowls, a tower and the helmet rack -------------
    const catsOnly = new THREE.Group()
    catsOnly.name = "star-nook-for-cats"
    const cushionGeo = keep(new THREE.SphereGeometry(0.34, 20, 10))
    const colours = ["#e2832e", "#e79bb4", "#2fb3c9"]
    NOOK_SPOTS.filter((s) => s.kind === "cushion").forEach((s, i) => {
      const c = new THREE.Mesh(cushionGeo, keep(new THREE.MeshStandardMaterial({ color: colours[i % colours.length], roughness: 0.95 })))
      c.scale.set(1, 0.22, 1)
      c.position.set(nx + s.x, deckY + 0.06, nz + s.z)
      c.castShadow = c.receiveShadow = true
      catsOnly.add(c)
    })
    const bowl = NOOK_SPOTS.find((s) => s.kind === "bowl")!
    const bowlGeo = keep(new THREE.CylinderGeometry(0.1, 0.075, 0.06, 16, 1, true))
    for (const [dx, col] of [[-0.14, "#9bb7d6"], [0.14, "#e6b6c8"]] as const) {
      const m = new THREE.Mesh(bowlGeo, keep(new THREE.MeshStandardMaterial({ color: col, roughness: 0.4, side: THREE.DoubleSide })))
      const fwd = [Math.sin(bowl.facing), Math.cos(bowl.facing)]
      m.position.set(nx + bowl.x + fwd[0] * 0.3 + fwd[1] * dx, deckY + 0.03, nz + bowl.z + fwd[1] * 0.3 - fwd[0] * dx)
      catsOnly.add(m)
    }
    // the cat tower: a sisal post, a base and a round platform, with a dangling star
    const towerX = nx + NOOK_TOWER.x, towerZ = nz + NOOK_TOWER.z, towerY = groundHeight(towerX, towerZ)
    const sisal = keep(new THREE.MeshStandardMaterial({ color: "#c9ad7c", roughness: 1 }))
    const base = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.36, 0.38, 0.06, 20)), woodMat)
    base.position.set(towerX, towerY + 0.03, towerZ)
    const pole = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.07, 0.07, NOOK_TOWER.h, 12)), sisal)
    pole.position.set(towerX, towerY + NOOK_TOWER.h / 2, towerZ)
    const top = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.32, 0.32, 0.05, 22)), keep(new THREE.MeshStandardMaterial({ color: "#7f8fb8", roughness: 1 })))
    top.position.set(towerX, towerY + NOOK_TOWER.h - 0.02, towerZ)
    for (const m of [base, pole, top]) { m.castShadow = m.receiveShadow = true; catsOnly.add(m) }
    const toy = new THREE.Group()
    toy.position.set(towerX + 0.28, towerY + NOOK_TOWER.h - 0.03, towerZ)
    const string = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.002, 0.002, 0.26, 4)), woodDark)
    string.position.y = -0.13
    const star = new THREE.Mesh(keep(new THREE.OctahedronGeometry(0.035, 0)), keep(new THREE.MeshStandardMaterial({ color: "#f2c84b", emissive: "#a8741a", emissiveIntensity: 0.3, roughness: 0.5 })))
    star.position.y = -0.27
    toy.add(string, star)
    catsOnly.add(toy)
    // the helmet rack against the wall: two uprights, a rail with five pegs, a shelf for the packs
    const rack = new THREE.Group()
    const rx = nx + NOOK_RACK.x, rz = nz + NOOK_RACK.z
    rack.position.set(rx, groundHeight(rx, rz) + NOOK_DECK.h, rz)
    rack.rotation.y = NOOK_RACK.yaw
    for (const sx of [-1, 1]) {
      const up = new THREE.Mesh(keep(new THREE.BoxGeometry(0.06, 1.05, 0.06)), woodDark)
      up.position.set(sx * (NOOK_RACK.width / 2 + 0.04), 0.525, 0)
      up.castShadow = true
      rack.add(up)
    }
    const rail = new THREE.Mesh(keep(new THREE.BoxGeometry(NOOK_RACK.width + 0.16, 0.08, 0.05)), woodMat)
    rail.position.set(0, NOOK_RACK.pegY - 0.12, 0)
    rack.add(rail)
    const shelf = new THREE.Mesh(keep(new THREE.BoxGeometry(NOOK_RACK.width + 0.08, 0.035, 0.24)), woodMat)
    shelf.position.set(0, NOOK_RACK.shelfY, 0.08)
    shelf.castShadow = shelf.receiveShadow = true
    rack.add(shelf)
    const pegGeo = keep(new THREE.CylinderGeometry(0.014, 0.014, 0.14, 8).rotateX(Math.PI / 2))
    for (let i = 0; i < 5; i++) {
      const p = rackPeg(i)
      const peg = new THREE.Mesh(pegGeo, brass)
      peg.position.set(p.x, p.y - 0.12, 0.07)
      rack.add(peg)
    }
    catsOnly.add(rack)
    catsOnly.visible = false
    root.add(catsOnly)
    return { root, catsOnly, head, bulbs, star, toy, disposables }
  }, [nx, nz, deckY])

  useEffect(() => () => { for (const d of sys.disposables) d.dispose() }, [sys])

  useHubFrame((state) => {
    sys.catsOnly.visible = voyage.cats === "arrived" || voyage.cats === "settled"
    // the telescope follows the Moon (the game's own moon path, as seen from home)
    moonPosition(worldRT.timeOfDay, _moon).normalize()
    // with the Moon down, it rests at 30° on the Moon's bearing, ready for moonrise
    if (_moon.y < 0.17) {
      const h = Math.hypot(_moon.x, _moon.z) || 1
      _moon.set((_moon.x / h) * 0.866, 0.5, (_moon.z / h) * 0.866)
    }
    sys.head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _moon)
    // the sail's lights come on as the day goes
    const m = sys.bulbs.material as THREE.MeshStandardMaterial
    m.emissiveIntensity = 0.25 + 1.8 * Math.max(nightBlend(worldRT.timeOfDay), Math.max(0, (worldRT.timeOfDay - 0.6) * 2.5))
    // the toy star turns on its string
    sys.star.rotation.y = state.clock.elapsedTime * 0.8
    sys.toy.rotation.z = Math.sin(state.clock.elapsedTime * 1.3) * 0.08
  })

  const [sx, sz] = polar(-150, NOOK_DECK.r + 1.05)
  return (
    <group>
      <primitive object={sys.root} />
      <SignBoard text="Star Nook" position={[nx + sx, groundHeight(nx + sx, nz + sz), nz + sz]} rotationY={Math.atan2(-sx, -sz) + Math.PI} width={1.2} />
    </group>
  )
}
