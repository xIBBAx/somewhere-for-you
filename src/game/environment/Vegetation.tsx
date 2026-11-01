import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { BUSHES, FLOWERS, ROCKS, groundHeight } from "../world-layout"
import { GroundClutter } from "./ground/GroundClutter"
import { DeciduousTreeSystem } from "./trees/DeciduousTreeSystem"
import { loadVegetationLibrary } from "../../world/render/vegetationLibrary"
import { foliageDepthMaterial, foliageMaterial, propsMaterial, rockMaterial } from "../../world/render/vegetationMaterials"

const FLOWER_SPECIES = ["cosmos", "buttercup", "poppy", "lavender", "cornflower", "daisy", "tulip"]

/** Keep the garden layout and collision footprints while sharing the botanical
 * meshes, textures and instanced materials used by the surrounding wilds. */
const GardenScatter = (): React.ReactElement => {
  const root = useMemo(() => new THREE.Group(), [])
  useEffect(() => {
    let disposed = false
    const meshes: THREE.InstancedMesh[] = []
    void loadVegetationLibrary().then(({ geometries }) => {
      if (disposed) return
      const batches = new Map<string, { matrix: THREE.Matrix4; color: THREE.Color }[]>()
      const up = new THREE.Vector3(0, 1, 0)
      const add = (name: string, x: number, z: number, scale: THREE.Vector3, yaw: number, tint: number): void => {
        const matrix = new THREE.Matrix4().compose(
          new THREE.Vector3(x, groundHeight(x, z), z),
          new THREE.Quaternion().setFromAxisAngle(up, yaw), scale,
        )
        const batch = batches.get(name) ?? []
        batch.push({ matrix, color: new THREE.Color().setRGB(tint, tint, tint) })
        batches.set(name, batch)
      }
      BUSHES.forEach((b, i) => add(`bush_${i % 2}_lod0_leaves`, b.x, b.z,
        new THREE.Vector3(0.45 * b.s, 0.48 * b.s, 0.45 * b.s), i * 1.3, 0.88 + (i % 5) * 0.035))
      FLOWERS.forEach((f, i) => {
        const name = `flower_${FLOWER_SPECIES[f.variant % FLOWER_SPECIES.length]}_lod0`
        const height = geometries.get(name)?.boundingBox?.max.y ?? 0.4
        const scale = f.s * (0.29 + (i % 4) * 0.025) / height
        add(name, f.x, f.z, new THREE.Vector3(scale, scale, scale), i * 2.39996, 1)
      })
      ROCKS.forEach((r, i) => add(`rock_boulder_${i % 2}_lod0`, r.x, r.z,
        new THREE.Vector3(0.25 * r.s, 0.4 * r.s, 0.25 * r.s), i * 2.1, 0.9 + (i % 3) * 0.06))
      for (const [name, batch] of batches) {
        const geometry = geometries.get(name)
        if (!geometry) continue
        const leaves = name.endsWith("_leaves")
        const material = leaves ? foliageMaterial() : name.startsWith("rock_") ? rockMaterial() : propsMaterial()
        const mesh = new THREE.InstancedMesh(geometry, material, batch.length)
        mesh.name = `garden-${name}`
        mesh.castShadow = leaves || name.startsWith("rock_")
        mesh.receiveShadow = true
        if (leaves) mesh.customDepthMaterial = foliageDepthMaterial()
        batch.forEach(({ matrix, color }, i) => { mesh.setMatrixAt(i, matrix); mesh.setColorAt(i, color) })
        mesh.instanceMatrix.needsUpdate = true
        mesh.instanceColor!.needsUpdate = true
        mesh.computeBoundingSphere()
        root.add(mesh)
        meshes.push(mesh)
      }
    })
    return () => {
      disposed = true
      for (const mesh of meshes) { root.remove(mesh); mesh.dispose() }
      // Geometry, textures and materials belong to the shared vegetation library.
    }
  }, [root])
  return <primitive object={root} dispose={null} />
}

export const Vegetation = (): React.ReactElement => (
  <group>
    <DeciduousTreeSystem />
    <GardenScatter />
    <GroundClutter />
  </group>
)
