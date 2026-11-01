import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { captureWaterSplash, writeWaterDropPositions, writeWaterRingMatrix } from "../src/world/render/waterEffectState"

describe("water contact effects", () => {
  it("keeps a queued stone contact at its own water level when the player stands ashore", () => {
    let waterLevel = -0.34
    const sampleSurface = (x: number, z: number): number | null => x > 20 && z < 0 ? waterLevel : null
    const player = { x: 19, y: 1.8, z: -7 }
    expect(sampleSurface(player.x, player.z)).toBeNull()
    const splash = captureWaterSplash(24, -7, 0.22, sampleSurface)!
    // The queued contact remains fixed even if body/surface state changes
    // before the render loop consumes it.
    player.y = 3
    waterLevel = 0.2
    expect(splash).toEqual({ x: 24, y: -0.34, z: -7, strength: 0.22 })
    expect(captureWaterSplash(player.x, player.z, 1, sampleSurface)).toBeNull()
  })

  it("preserves small waves and moving droplets through positive and negative origin rebases", () => {
    for (const sign of [-1, 1]) {
      const anchor = sign * 10_000_000
      const ring = new Float64Array([anchor + 0.125, -0.328, anchor - 0.1875])
      const drops = new Float64Array([anchor + 0.1875, -0.19, anchor - 0.125])
      const rendered = new Float32Array(3), matrix = new THREE.Matrix4()
      const camera = new THREE.Vector3(anchor + 2, 1.5, anchor + 3)
      const before = { ring: new THREE.Vector3(), drop: new THREE.Vector3() }
      let first = true
      for (const offset of [0, 1024, -1024, 0]) {
        const originX = anchor + offset, originZ = anchor - offset
        writeWaterRingMatrix(matrix, ring, 0, originX, originZ)
        // setMatrixAt uploads float32 elements, as does the point attribute.
        const packedMatrix = new Float32Array(matrix.elements)
        writeWaterDropPositions(drops, rendered, originX, originZ)
        const cameraRender = camera.clone().sub(new THREE.Vector3(originX, 0, originZ))
        const visibleRing = new THREE.Vector3(packedMatrix[12], packedMatrix[13], packedMatrix[14]).sub(cameraRender)
        const visibleDrop = new THREE.Vector3(rendered[0], rendered[1], rendered[2]).sub(cameraRender)
        if (first) { before.ring.copy(visibleRing); before.drop.copy(visibleDrop); first = false }
        expect(visibleRing.distanceTo(before.ring)).toBeLessThan(0.0001)
        expect(visibleDrop.distanceTo(before.drop)).toBeLessThan(0.0001)
        expect(visibleDrop.x - visibleRing.x).toBeCloseTo(0.0625, 6)
      }
      // Integration occurs before packing, so centimeter motion still advances
      // even when absolute float32 positions would round to whole metres.
      drops[0] += 0.01
      writeWaterDropPositions(drops, rendered, anchor, anchor)
      expect(rendered[0]).toBeCloseTo(0.1975, 6)
      expect(ring[0]).toBe(anchor + 0.125)
    }
  })
})
