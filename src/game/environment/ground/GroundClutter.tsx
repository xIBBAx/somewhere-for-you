import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { makeRng } from "../../../utils/math"
import { ROCKS, TREES } from "../../world-layout"
import { groundHash, groundNoise, groundObstacle, groundDetailHeight, sampleGround } from "./groundSurface"
import { groundResources } from "./groundMaterial"

type Item = { x: number; z: number; scale: number; rotation: number; color: THREE.Color }
const detailMaterial = (): THREE.MeshStandardMaterial => {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.95, side: THREE.DoubleSide })
  material.onBeforeCompile = shader => {
    shader.uniforms.gHistory = groundResources().history
    shader.uniforms.gGardenOpen = groundResources().gardenOpen
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nuniform sampler2D gHistory;\nuniform float gGardenOpen;")
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      vec3 root=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xyz;
      vec4 traffic=texture2D(gHistory,(root.xz+vec2(48.,54.))/vec2(96.,104.));
      float distanceToEye=length(cameraPosition.xz-root.xz);
      float variation=fract(sin(dot(root.xz,vec2(12.98,78.23)))*43758.54);
      float lod=1.-smoothstep(10.+variation*5.,19.+variation*7.,distanceToEye);
      transformed*=lod*(1.-traffic.r*.65);
      if(length(root.xz-vec2(0.,-30.5))<6.45) transformed.y+=max(0.,.055-root.y)*gGardenOpen/length(instanceMatrix[1].xyz);
    `)
  }
  material.customProgramCacheKey = () => "ground-clutter-v1"
  return material
}

/** Deposition follows canopy, exposed soil, shore sediment and rock contacts. */
export const GroundClutter = (): React.ReactElement => {
  const assets = useMemo(() => {
    const rng = makeRng(751302)
    const stones: Item[] = [], leaves: Item[] = [], twigs: Item[] = []
    const stoneLight = new THREE.Color("#aa9c80"), stoneDark = new THREE.Color("#736d56")
    for (let i = 0; i < 26000; i++) {
      const x = rng() * 65 - 32.5, z = rng() * 65 - 34.5
      if (Math.hypot(x, z + 2) > 33 || groundObstacle(x, z)) continue
      const surface = sampleGround(x, z)
      if (["water", "built", "rock"].includes(surface.kind)) continue
      const nearRock = ROCKS.some(r => Math.hypot(x - r.x, z - r.z) < r.s * 1.3)
      const patch = groundNoise(x * 1.5, z * 1.5)
      const sediment = (surface.sand * 0.15 + surface.soil * 0.10 + (nearRock ? 0.7 : 0.004)) * patch
      if (rng() < sediment) stones.push({ x, z, scale: 0.02 + rng() ** 2 * (nearRock ? 0.13 : 0.075), rotation: rng() * 6.28, color: stoneDark.clone().lerp(stoneLight, rng()) })
    }
    TREES.forEach((tree, index) => {
      for (let i = 0; i < 55; i++) {
        // Prevailing deposit bias and irregular canopy reach avoid litter rings.
        const angle = rng() * 6.28, radius = Math.sqrt(rng()) * tree.s * 2.5
        const x = tree.x + Math.cos(angle) * radius + 0.35, z = tree.z + Math.sin(angle) * radius * 0.75
        if (groundObstacle(x, z)) continue
        const surface = sampleGround(x, z)
        if (surface.softness === 0 || surface.slope > 0.55 || rng() > 0.3 + groundNoise(x * 1.4, z * 1.4) * 0.6) continue
        const color = new THREE.Color().setHSL(0.10 + rng() * 0.08, 0.2 + rng() * 0.22, 0.20 + rng() * 0.15)
        const item = { x, z, scale: 0.035 + rng() * 0.06, rotation: angle + groundHash(index, i), color }
        if (i % 11 === 0) twigs.push(item)
        else leaves.push(item)
      }
    })
    const stoneGeometry = new THREE.IcosahedronGeometry(1, 0)
    const leafShape = new THREE.Shape()
    leafShape.moveTo(0, -1); leafShape.quadraticCurveTo(-0.75, -0.1, 0, 1); leafShape.quadraticCurveTo(0.7, 0.05, 0, -1)
    const leafGeometry = new THREE.ShapeGeometry(leafShape, 4)
    leafGeometry.rotateX(-Math.PI / 2)
    const twigGeometry = new THREE.CylinderGeometry(0.07, 0.09, 2.4, 5)
    twigGeometry.rotateX(Math.PI / 2)
    const material = detailMaterial()
    const dummy = new THREE.Object3D()
    const meshes = [stones, leaves, twigs].map((items, category) => {
      const mesh = new THREE.InstancedMesh([stoneGeometry, leafGeometry, twigGeometry][category], material, items.length)
      mesh.name = ["ground-pebbles", "ground-leaf-litter", "ground-twigs"][category]
      items.forEach((item, i) => {
        dummy.position.set(item.x, groundDetailHeight(item.x, item.z) + (category === 0 ? -item.scale * 0.24 : 0.009), item.z)
        dummy.rotation.set(category === 0 ? i * 0.37 : 0.05 * Math.sin(i), item.rotation, category === 0 ? i * 0.63 : 0)
        dummy.scale.set(item.scale, item.scale * (category === 0 ? 0.55 : 1), item.scale * (category === 0 ? 0.8 : 1))
        dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); mesh.setColorAt(i, item.color)
      })
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere(); mesh.receiveShadow = true
      return mesh
    })
    return { meshes, stoneGeometry, leafGeometry, twigGeometry, material }
  }, [])
  useEffect(() => () => {
    assets.meshes.forEach(m => m.dispose()); assets.stoneGeometry.dispose(); assets.leafGeometry.dispose(); assets.twigGeometry.dispose(); assets.material.dispose()
  }, [assets])
  return <group name="ground-clutter">{assets.meshes.map(mesh => <primitive key={mesh.name} object={mesh} />)}</group>
}
