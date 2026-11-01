import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { horseRT, type HorseState } from "./horseState"
import { riderRT } from "./riding"

/**
 * Reins: one leather loop per saddled horse, from the left bit ring to the
 * rider's hands and back to the right ring, sagging under its own weight; when
 * nobody holds them they lie over the crest in front of the withers. Updated
 * in place every frame (no allocation), only for horses near enough to see.
 */
const SEG = 28
const RADIAL = 4
const RADIUS = 0.007

type Rein = { mesh: THREE.Mesh; pos: Float32Array; pts: THREE.Vector3[] }

const _t = new THREE.Vector3()
const _n = new THREE.Vector3()
const _b = new THREE.Vector3()
const _p = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)

const makeRein = (material: THREE.Material): Rein => {
  const verts = SEG * RADIAL
  const pos = new Float32Array(verts * 3)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage))
  const idx: number[] = []
  for (let i = 0; i < SEG - 1; i++) {
    for (let j = 0; j < RADIAL; j++) {
      const a = i * RADIAL + j
      const b = i * RADIAL + ((j + 1) % RADIAL)
      idx.push(a, a + RADIAL, b, b, a + RADIAL, b + RADIAL)
    }
  }
  geo.setIndex(idx)
  const mesh = new THREE.Mesh(geo, material)
  mesh.frustumCulled = false
  mesh.castShadow = false
  return { mesh, pos, pts: Array.from({ length: SEG }, () => new THREE.Vector3()) }
}

/** Quadratic Bézier with a sag (a cheap catenary) between two points. */
const sagCurve = (a: THREE.Vector3, b: THREE.Vector3, sag: number, out: THREE.Vector3[], from: number, to: number): void => {
  const n = to - from
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const p = out[from + i]
    p.lerpVectors(a, b, t)
    p.y -= Math.sin(Math.PI * t) * sag
  }
}

const writeTube = (r: Rein): void => {
  const pts = r.pts
  for (let i = 0; i < SEG; i++) {
    _t.subVectors(pts[Math.min(SEG - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize()
    _n.crossVectors(_t, UP)
    if (_n.lengthSq() < 1e-6) _n.set(1, 0, 0)
    _n.normalize()
    _b.crossVectors(_n, _t).normalize()
    for (let j = 0; j < RADIAL; j++) {
      const a = (j / RADIAL) * Math.PI * 2
      // flat leather: wider than it is thick
      _p.copy(pts[i]).addScaledVector(_n, Math.cos(a) * RADIUS * 1.6).addScaledVector(_b, Math.sin(a) * RADIUS * 0.6)
      const k = (i * RADIAL + j) * 3
      r.pos[k] = _p.x
      r.pos[k + 1] = _p.y
      r.pos[k + 2] = _p.z
    }
  }
  const attr = r.mesh.geometry.getAttribute("position") as THREE.BufferAttribute
  attr.needsUpdate = true
  r.mesh.geometry.computeVertexNormals()
}

export const Reins = (): React.ReactElement => {
  const group = useMemo(() => new THREE.Group(), [])
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: "#3b2113", roughness: 0.6 }), [])
  const reins = useMemo(() => new Map<string, Rein>(), [])
  useEffect(() => () => {
    for (const r of reins.values()) r.mesh.geometry.dispose()
    material.dispose()
  }, [reins, material])

  useFrame(() => {
    const seen = new Set<string>()
    for (const h of horseRT.horses.values()) {
      if (!h.ident.saddled || !h.visible || !h.model || h.model.level !== 0 || !h.animator) continue
      seen.add(h.ident.id)
      let r = reins.get(h.ident.id)
      if (!r) {
        r = makeRein(material)
        reins.set(h.ident.id, r)
        group.add(r.mesh)
      }
      r.mesh.visible = true
      layout(h, r)
      writeTube(r)
    }
    for (const [id, r] of reins) if (!seen.has(id)) r.mesh.visible = false
  })
  return <primitive object={group} />
}

const _hand = new THREE.Vector3()
const _hand2 = new THREE.Vector3()

const layout = (h: HorseState, r: Rein): void => {
  const half = SEG / 2
  const rider = h.rider ? riderRT[h.rider] : null
  if (rider && rider.handW > 0.2) {
    // bit -> hand (left), hand -> hand (the bight between the hands), hand -> bit (right)
    _hand.copy(rider.handL)
    _hand2.copy(rider.handR)
    const slack = 0.05 + Math.max(0, 0.6 - Math.abs(h.speed) * 0.05) * 0.06
    sagCurve(h.bitL, _hand, slack, r.pts, 0, half - 3)
    sagCurve(_hand, _hand2, 0.12, r.pts, half - 3, half + 2)
    sagCurve(_hand2, h.bitR, slack, r.pts, half + 2, SEG - 1)
  } else {
    // lying over the crest: bit -> neck (left), over the top, neck -> bit (right)
    const rest = h.reinRest
    _hand.copy(rest).addScaledVector(_t.set(Math.cos(h.heading), 0, -Math.sin(h.heading)), 0.1)
    _hand2.copy(rest).addScaledVector(_t, -0.2)
    sagCurve(h.bitL, _hand, 0.1, r.pts, 0, half - 2)
    sagCurve(_hand, _hand2, -0.03, r.pts, half - 2, half + 1)
    sagCurve(_hand2, h.bitR, 0.1, r.pts, half + 1, SEG - 1)
  }
}
