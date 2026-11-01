import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { setBarkDetail, setFoliageAtlas } from "./vegetationMaterials"

/**
 * Loads the Blender-authored vegetation library (asset-pipeline/blender/build_vegetation.py)
 * and exposes its geometries by name. Fails soft: if the asset cannot be
 * loaded, scatter simply stays empty and the world remains playable.
 */
export type VegetationLibrary = {
  geometries: Map<string, THREE.BufferGeometry>
}

let pending: Promise<VegetationLibrary> | null = null

export const loadVegetationLibrary = (): Promise<VegetationLibrary> => {
  if (pending) return pending
  pending = (async () => {
    const geometries = new Map<string, THREE.BufferGeometry>()
    const texLoader = new THREE.TextureLoader()
    try {
      const atlas = await texLoader.loadAsync("/assets/vegetation/foliage-atlas.png")
      atlas.colorSpace = THREE.SRGBColorSpace
      // glTF UVs assume an unflipped image; flipY swapped the atlas rows
      // (gulmohar sampled fern fronds, oak sampled linden, willow sampled glow).
      atlas.flipY = false
      atlas.anisotropy = 4
      atlas.generateMipmaps = true
      atlas.minFilter = THREE.LinearMipmapLinearFilter
      setFoliageAtlas(atlas)
    } catch (error) {
      console.warn("[world] foliage atlas failed to load; leaves will render untextured", error)
    }
    void texLoader.loadAsync("/assets/textures/bark-detail.jpg").then((bark) => {
      bark.wrapS = bark.wrapT = THREE.RepeatWrapping
      bark.anisotropy = 4
      setBarkDetail(bark)
    }).catch((error) => console.warn("[world] bark scan failed to load; keeping procedural bark", error))
    const collect = (scene: THREE.Object3D): void => scene.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      const geometry = mesh.geometry
      // bake node transforms (export_apply leaves identity, but be safe)
      mesh.updateWorldMatrix(true, false)
      geometry.applyMatrix4(mesh.matrixWorld)
      geometry.computeBoundingSphere()
      geometry.computeBoundingBox()
      geometries.get(mesh.name)?.dispose()
      geometries.set(mesh.name, geometry)
    })
    const loader = new GLTFLoader()
    try {
      collect((await loader.loadAsync("/assets/vegetation/vegetation.glb")).scene)
    } catch (error) {
      console.error("[world] vegetation library failed to load; the wilds will be bare", error)
    }
    // meadow flower clumps are authored separately and replace the simple stems
    try {
      collect((await loader.loadAsync("/assets/vegetation/flowers.glb")).scene)
    } catch (error) {
      console.warn("[world] flower clumps failed to load; using single-stem flowers", error)
    }
    return { geometries }
  })()
  return pending
}

/**
 * Highvale's cedars and their kin (built offline), loaded
 * only when the valley is (world/highvale): never part of the first load.
 * Resolves true once their geometries are in the library.
 */
let highvalePending: Promise<boolean> | null = null
export const highvaleVegetationRT = { ready: false, version: 0 }
export const loadHighvaleVegetation = (): Promise<boolean> => {
  if (highvalePending) return highvalePending
  highvalePending = (async () => {
    const lib = await loadVegetationLibrary()
    try {
      const gltf = await new GLTFLoader().loadAsync("/assets/highvale/highvale-vegetation.glb")
      gltf.scene.traverse((object) => {
        const mesh = object as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.updateWorldMatrix(true, false)
        mesh.geometry.applyMatrix4(mesh.matrixWorld)
        mesh.geometry.computeBoundingSphere()
        mesh.geometry.computeBoundingBox()
        lib.geometries.set(mesh.name, mesh.geometry)
      })
      highvaleVegetationRT.ready = true
      highvaleVegetationRT.version++
      return true
    } catch (error) {
      console.warn("[highvale] the valley's trees failed to load; pines stand in for the cedars", error)
      return false
    }
  })()
  return highvalePending
}
