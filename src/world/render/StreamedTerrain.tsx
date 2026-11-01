import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { inRealm } from "../realmHook"
import { avatarRT } from "../../game/runtime"
import { WorldStreamer, type ChunkState } from "../streamer"
import { broadcast, subscribeChunks, worldStreamRT } from "../worldRuntime"
import { CHUNK_SIZE } from "../worldConfig"
import { buildTerrainGeometry, releaseTerrainGeometry } from "./terrainGeometry"
import { terrainDepthMaterial, terrainMaterial } from "./terrainMaterial"

/**
 * Owns the world streamer and renders the terrain chunk meshes. Other
 * systems subscribe to the same chunk events through worldRuntime.
 */
export const StreamedTerrain = (): React.ReactElement => {
  const group = useMemo(() => {
    const g = new THREE.Group()
    g.name = "streamed-terrain"
    return g
  }, [])

  useEffect(() => {
    const material = terrainMaterial()
    const meshes = new Map<string, THREE.Mesh>()
    const build = (chunk: ChunkState): void => {
      if (!chunk.payload) return
      const geometry = buildTerrainGeometry(chunk.payload, chunk.lod)
      let mesh = meshes.get(chunk.key)
      if (mesh) {
        releaseTerrainGeometry(mesh.geometry)
        mesh.geometry = geometry
      } else {
        mesh = new THREE.Mesh(geometry, material)
        mesh.name = `terrain:${chunk.key}`
        mesh.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE)
        mesh.matrixAutoUpdate = false
        mesh.updateMatrix()
        mesh.receiveShadow = true
        mesh.customDepthMaterial = terrainDepthMaterial()
        meshes.set(chunk.key, mesh)
        group.add(mesh)
      }
      // only nearby terrain casts shadows (hills shading their own valleys)
      mesh.castShadow = chunk.lod === 0
    }
    const unsubscribe = subscribeChunks({
      onChunkReady: build,
      onChunkLodChange: build,
      onChunkUnload: (chunk) => {
        const mesh = meshes.get(chunk.key)
        if (!mesh) return
        group.remove(mesh)
        releaseTerrainGeometry(mesh.geometry)
        meshes.delete(chunk.key)
      },
    })
    const streamer = new WorldStreamer(broadcast)
    worldStreamRT.streamer = streamer
    return () => {
      unsubscribe()
      streamer.dispose()
      worldStreamRT.streamer = null
      for (const mesh of meshes.values()) {
        group.remove(mesh)
        mesh.geometry.dispose()
      }
      meshes.clear()
    }
  }, [group])

  useFrame(() => {
    const streamer = worldStreamRT.streamer
    // on another world home's chunks stay as they are, waiting
    const body = avatarRT()
    if (!streamer || inRealm(body.pos.x, body.pos.z)) return
    streamer.update(body.pos.x, body.pos.z, body.vel.x, body.vel.z)
    if (!worldStreamRT.spawnReady && streamer.isAreaReady(body.pos.x, body.pos.z, 120)) {
      worldStreamRT.spawnReady = true
    }
  }, -90)

  return <primitive object={group} />
}
