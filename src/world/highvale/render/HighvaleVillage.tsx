import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo, useState } from "react"
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { nightBlend } from "../../../game/environment/celestialLighting"
import { worldRT } from "../../../game/runtime"
import { worldHeight } from "../../terrain"
import { HIGHVALE_PLACED } from "../highvaleStructures"

/**
 * Highvale's village (built offline by the valley's authoring script): timber-and-stone
 * houses on their pads above the square, the footbridge over the river, the
 * cedar temple in its grove and the bench on the meadow. One model of each
 * kind, shared by every copy; each copy drawn only near the eye.
 * Children of WorldRoot: logical world coordinates.
 */
const DRAW = 1400

let pending: Promise<THREE.Group | null> | null = null
const litWindows: THREE.MeshStandardMaterial[] = []
const loadVillage = (): Promise<THREE.Group | null> => {
  pending ??= new GLTFLoader().loadAsync("/assets/highvale/highvale-village.glb").then((gltf) => {
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of materials as THREE.MeshStandardMaterial[]) {
        if (m.map) m.map.anisotropy = 8
        // the roofs, tiers and cone are open shells whose winding Blender's
        // normal recalculation cannot settle: draw both faces (lit correctly)
        m.side = THREE.DoubleSide
        if (m.name === "highvale_railing") {
          m.alphaTest = 0.5
          m.alphaToCoverage = true
          m.side = THREE.DoubleSide
          m.transparent = false
        }
        if (m.name === "highvale_flag") m.side = THREE.DoubleSide
        if (m.name === "highvale_window_lit") { m.emissive.set("#ffb468"); m.emissiveIntensity = 0; litWindows.push(m) }
      }
    })
    return gltf.scene
  }).catch((error) => {
    console.warn("[highvale] the village could not load", error)
    return null
  })
  return pending
}

export const HighvaleVillage = (): React.ReactElement | null => {
  const { camera } = useThree()
  const [model, setModel] = useState<THREE.Group | null>(null)
  useEffect(() => {
    let live = true
    void loadVillage().then((m) => { if (live) setModel(m) })
    return () => { live = false }
  }, [])
  const copies = useMemo(() => {
    if (!model) return null
    const root = new THREE.Group()
    root.name = "highvale-village"
    const out: THREE.Object3D[] = []
    for (const p of HIGHVALE_PLACED) {
      const src = model.getObjectByName(p.name)
      if (!src) continue
      const copy = src.clone()
      copy.position.set(p.x, Number.isNaN(p.y) ? worldHeight(p.x, p.z) : p.y, p.z)
      copy.rotation.set(0, p.rotation, 0)
      copy.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.castShadow = p.name !== "bench"
        mesh.receiveShadow = true
      })
      copy.updateMatrixWorld(true)
      root.add(copy)
      out.push(copy)
    }
    return { root, out }
  }, [model])
  useFrame(() => {
    if (!copies) return
    // lamps behind the windows from dusk (worldRT.timeOfDay: 0.65 dusk .. 0.97 deep night)
    const glow = THREE.MathUtils.smoothstep(nightBlend(worldRT.timeOfDay), 0.15, 0.6) * 1.6
    for (const m of litWindows) m.emissiveIntensity = glow
    const c = camera.position
    for (const o of copies.out) o.visible = Math.hypot(o.position.x - c.x, o.position.z - c.z) < DRAW
  })
  return copies ? <primitive object={copies.root} /> : null
}
