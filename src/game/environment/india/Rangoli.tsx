import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { groundHeight } from "../../world-layout"
import { RANGOLI } from "./indiaLayout"

const COLOURS = ["#e8381d", "#f7a01c", "#ffd34d", "#d81b60", "#1b8a5a", "#2546b8", "#fff4e0", "#7b2cbf"]

/** A rangoli drawn in coloured powder: rings of petals and dots, never the same twice. */
const drawRangoli = (seed: number): HTMLCanvasElement => {
  const size = 1024
  const c = document.createElement("canvas")
  c.width = c.height = size
  const ctx = c.getContext("2d")!
  let n = seed * 9301 + 49297
  const r = (): number => ((n = (n * 9301 + 49297) % 233280) / 233280)
  const pick = (): string => COLOURS[Math.floor(r() * COLOURS.length)]
  ctx.translate(size / 2, size / 2)
  const R = size * 0.49

  // the white outline a rangoli is first drawn in, then the fill
  ctx.fillStyle = pick()
  ctx.beginPath()
  ctx.arc(0, 0, R * 0.14, 0, Math.PI * 2)
  ctx.fill()

  const rings = 5
  for (let k = 0; k < rings; k++) {
    const inner = R * (0.14 + (k / rings) * 0.82)
    const outer = R * (0.14 + ((k + 1) / rings) * 0.82)
    const petals = [8, 12, 16, 16, 24][k]
    const fill = pick()
    const edge = pick()
    for (let i = 0; i < petals; i++) {
      ctx.save()
      ctx.rotate((i / petals) * Math.PI * 2 + (k % 2 ? Math.PI / petals : 0))
      const w = ((outer - inner) * 0.62 + inner * Math.PI / petals) * 0.5
      ctx.beginPath()
      ctx.moveTo(inner, 0)
      ctx.quadraticCurveTo((inner + outer) / 2, -w, outer, 0)
      ctx.quadraticCurveTo((inner + outer) / 2, w, inner, 0)
      ctx.closePath()
      ctx.fillStyle = fill
      ctx.fill()
      ctx.lineWidth = 7
      ctx.strokeStyle = "#fff4e0"
      ctx.stroke()
      ctx.lineWidth = 3
      ctx.strokeStyle = edge
      ctx.stroke()
      ctx.restore()
    }
    // a band of dots between the rings
    const dots = petals * 2
    ctx.fillStyle = "#fff4e0"
    for (let i = 0; i < dots; i++) {
      const a = (i / dots) * Math.PI * 2
      ctx.beginPath()
      ctx.arc(Math.cos(a) * outer, Math.sin(a) * outer, 6.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  // powder is uneven: a little grain, so it reads as powder and not print
  ctx.globalCompositeOperation = "destination-out"
  for (let i = 0; i < 9000; i++) {
    const a = r() * Math.PI * 2
    const d = Math.sqrt(r()) * R
    ctx.globalAlpha = 0.1 + r() * 0.32
    ctx.fillRect(Math.cos(a) * d, Math.sin(a) * d, 1 + r() * 2.6, 1 + r() * 2.6)
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = "source-over"
  return c
}

/** A disc that follows the ground under it, so the powder never floats or sinks. */
const rangoliGeometry = (x: number, z: number, radius: number): THREE.BufferGeometry => {
  const g = new THREE.CircleGeometry(radius, 32, 0, Math.PI * 2)
  // a circle fan is too coarse for gentle slopes: use a grid clipped by the texture's alpha
  const grid = new THREE.PlaneGeometry(radius * 2, radius * 2, 14, 14)
  g.dispose()
  grid.rotateX(-Math.PI / 2)
  const pos = grid.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const wx = x + pos.getX(i)
    const wz = z + pos.getZ(i)
    pos.setY(i, groundHeight(wx, wz) + 0.03)
    pos.setX(i, wx)
    pos.setZ(i, wz)
  }
  grid.computeVertexNormals()
  return grid
}

/** Rangoli at the thresholds of home. */
export const Rangoli = (): React.ReactElement => {
  const items = useMemo(() => RANGOLI.map((r) => {
    const map = new THREE.CanvasTexture(drawRangoli(r.seed))
    map.colorSpace = THREE.SRGBColorSpace
    map.anisotropy = 8
    return {
      key: `${r.x}:${r.z}`,
      geometry: rangoliGeometry(r.x, r.z, r.radius),
      material: new THREE.MeshStandardMaterial({
        map,
        transparent: true,
        alphaTest: 0.06,
        depthWrite: false,
        roughness: 0.96,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    }
  }), [])

  useEffect(() => () => {
    for (const i of items) {
      i.geometry.dispose()
      i.material.map?.dispose()
      i.material.dispose()
    }
  }, [items])

  return (
    <group name="rangoli">
      {items.map((i) => <mesh key={i.key} geometry={i.geometry} material={i.material} receiveShadow renderOrder={1} />)}
    </group>
  )
}
