import { useFrame } from "@react-three/fiber"
import { awayFromEarth } from "../realmHook"
import { useEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { avatarRT, worldRT } from "../../game/runtime"
import { weatherRT } from "../../game/weather/weatherState"
import { createBirdGeometry } from "./birdsGeometry"
import { birdUniforms, createBirdMaterial } from "./birdsMaterial"
import {
  createBirdsSimulation,
  stepBirdsSimulation,
  TOTAL_BIRDS,
  type BirdsSimState,
} from "./birdsSim"

export type BirdsRef = {
  sim: BirdsSimState
}

export const Birds = ({ simRef }: { simRef?: React.MutableRefObject<BirdsSimState | null> }): React.ReactElement => {
  const meshRef = useRef<THREE.InstancedMesh>(null)

  const sim = useMemo(() => createBirdsSimulation(), [])

  useEffect(() => {
    if (simRef) {
      simRef.current = sim
    }
  }, [sim, simRef])

  const geometry = useMemo(() => createBirdGeometry(), [])
  const material = useMemo(() => createBirdMaterial(), [])

  const paramsAttr = useMemo(() => {
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(TOTAL_BIRDS * 4), 4)
    attr.setUsage(THREE.DynamicDrawUsage)
    return attr
  }, [])

  // Pre-allocated math objects to avoid per-frame allocations
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const euler = useMemo(() => new THREE.Euler(0, 0, 0, "YXZ"), [])
  const anchor = useMemo(() => new THREE.Vector2(0, 0), [])

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    mesh.geometry.setAttribute("aBirdParams", paramsAttr)

    return () => {
      geometry.dispose()
      material.dispose()
    }
  }, [geometry, material, paramsAttr])

  useFrame((state, rawDt) => {
    // on the Moon: home's life waits, paused, for the riders to come back
    if (awayFromEarth(avatarRT().pos)) return
    const mesh = meshRef.current
    if (!mesh) return

    const dt = Math.min(rawDt, 0.1)
    const time = state.clock.elapsedTime
    birdUniforms.uBirdTime.value = time

    const body = avatarRT()
    const px = body.pos.x
    const py = body.pos.y
    const pz = body.pos.z
    const pSpeed = body.speed
    const tod = worldRT.timeOfDay
    const rain = weatherRT.rain

    stepBirdsSimulation(sim, dt, { x: px, y: py, z: pz }, pSpeed, tod, rain)

    // Re-anchor when player moves > 80m from current anchor for float32 precision
    if (Math.hypot(px - anchor.x, pz - anchor.y) > 80) {
      anchor.set(Math.floor(px / 50) * 50, Math.floor(pz / 50) * 50)
      mesh.position.set(anchor.x, 0, anchor.y)
    }

    const paramsArray = paramsAttr.array as Float32Array

    for (let i = 0; i < TOTAL_BIRDS; i++) {
      const bird = sim.birds[i]

      const pIdx = i * 4
      paramsArray[pIdx] = bird.phaseOffset
      paramsArray[pIdx + 1] = bird.flapSpeed
      paramsArray[pIdx + 2] = bird.flapAmp
      paramsArray[pIdx + 3] = bird.glideDihedral

      if (!bird.active) {
        dummy.position.set(0, -999, 0)
        dummy.scale.setScalar(0.0001)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
        continue
      }

      // Position relative to floating anchor
      dummy.position.set(bird.x - anchor.x, bird.y, bird.z - anchor.y)

      // Orientation: YXZ rotation (heading around Y, pitch around X, bank around Z)
      euler.set(bird.pitch, bird.heading, bird.bank)
      dummy.quaternion.setFromEuler(euler)
      dummy.scale.setScalar(bird.scale)

      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }

    mesh.instanceMatrix.needsUpdate = true
    paramsAttr.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, TOTAL_BIRDS]}
      frustumCulled={false}
      renderOrder={1}
      name="endless-birds"
    />
  )
}
