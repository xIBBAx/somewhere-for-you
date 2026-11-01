import { useFrame } from "@react-three/fiber"
import { awayFromEarth } from "../realmHook"
import { useEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { avatarRT, worldRT } from "../../game/runtime"
import { weatherRT } from "../../game/weather/weatherState"
import {
  createButterflyGeometry,
  createFireflyGeometry,
  createMicroInsectGeometry,
} from "./insectsGeometry"
import {
  createButterflyMaterial,
  createFireflyMaterial,
  createMicroInsectMaterial,
  insectUniforms,
} from "./insectsMaterial"
import {
  BUTTERFLY_COUNT,
  createInsectsSimulation,
  FIREFLY_COUNT,
  MICRO_COUNT,
  stepInsectsSimulation,
  type InsectsSimState,
} from "./insectsSim"

export const Insects = ({
  simRef,
}: {
  simRef?: React.MutableRefObject<InsectsSimState | null>
}): React.ReactElement => {
  const butterflyMeshRef = useRef<THREE.InstancedMesh>(null)
  const microMeshRef = useRef<THREE.InstancedMesh>(null)
  const fireflyMeshRef = useRef<THREE.InstancedMesh>(null)

  const sim = useMemo(() => createInsectsSimulation(), [])

  useEffect(() => {
    if (simRef) {
      simRef.current = sim
    }
  }, [sim, simRef])

  // Geometries
  const bGeom = useMemo(() => createButterflyGeometry(), [])
  const mGeom = useMemo(() => createMicroInsectGeometry(), [])
  const fGeom = useMemo(() => createFireflyGeometry(), [])

  // Materials
  const bMat = useMemo(() => createButterflyMaterial(), [])
  const mMat = useMemo(() => createMicroInsectMaterial(), [])
  const fMat = useMemo(() => createFireflyMaterial(), [])

  // Instanced attributes
  const bFlutterAttr = useMemo(() => {
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(BUTTERFLY_COUNT), 1)
    attr.setUsage(THREE.DynamicDrawUsage)
    return attr
  }, [])

  const bColorAttr = useMemo(() => {
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(BUTTERFLY_COUNT * 3), 3)
    attr.setUsage(THREE.DynamicDrawUsage)
    return attr
  }, [])

  const mColorAttr = useMemo(() => {
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(MICRO_COUNT * 3), 3)
    attr.setUsage(THREE.DynamicDrawUsage)
    return attr
  }, [])

  // Pre-allocated math objects
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const anchor = useMemo(() => new THREE.Vector2(0, 0), [])

  useEffect(() => {
    if (butterflyMeshRef.current) {
      butterflyMeshRef.current.geometry.setAttribute("aFlutterPhase", bFlutterAttr)
      butterflyMeshRef.current.instanceColor = bColorAttr
    }
    if (microMeshRef.current) {
      microMeshRef.current.instanceColor = mColorAttr
    }

    return () => {
      bGeom.dispose()
      mGeom.dispose()
      fGeom.dispose()
      bMat.dispose()
      mMat.dispose()
      fMat.dispose()
    }
  }, [bGeom, mGeom, fGeom, bMat, mMat, fMat, bFlutterAttr, bColorAttr, mColorAttr])

  useFrame((state, rawDt) => {
    // on the Moon: home's life waits, paused, for the riders to come back
    if (awayFromEarth(avatarRT().pos)) return
    const bMesh = butterflyMeshRef.current
    const mMesh = microMeshRef.current
    const fMesh = fireflyMeshRef.current
    if (!bMesh || !mMesh || !fMesh) return

    const dt = Math.min(rawDt, 0.1)
    const time = state.clock.elapsedTime
    insectUniforms.uInsectTime.value = time

    const px = avatarRT().pos.x
    const pz = avatarRT().pos.z
    const tod = worldRT.timeOfDay
    const rain = weatherRT.rain

    stepInsectsSimulation(sim, dt, time, px, pz, tod, rain)

    // Re-anchor when player moves > 80m
    if (Math.hypot(px - anchor.x, pz - anchor.y) > 80) {
      anchor.set(Math.floor(px / 50) * 50, Math.floor(pz / 50) * 50)
      bMesh.position.set(anchor.x, 0, anchor.y)
      mMesh.position.set(anchor.x, 0, anchor.y)
      fMesh.position.set(anchor.x, 0, anchor.y)
    }

    // 1) Butterflies & Moths
    const flutterArray = bFlutterAttr.array as Float32Array
    const bColorArray = bColorAttr.array as Float32Array

    for (let i = 0; i < BUTTERFLY_COUNT; i++) {
      const b = sim.butterflies[i]
      flutterArray[i] = b.flutterPhase

      const cIdx = i * 3
      bColorArray[cIdx] = b.color.r
      bColorArray[cIdx + 1] = b.color.g
      bColorArray[cIdx + 2] = b.color.b

      if (!b.active) {
        dummy.position.set(0, -999, 0)
        dummy.scale.setScalar(0.0001)
      } else {
        dummy.position.set(b.x - anchor.x, b.y, b.z - anchor.y)
        dummy.rotation.set(0, b.heading, 0)
        dummy.scale.setScalar(b.scale)
      }
      dummy.updateMatrix()
      bMesh.setMatrixAt(i, dummy.matrix)
    }
    bMesh.instanceMatrix.needsUpdate = true
    bColorAttr.needsUpdate = true
    bFlutterAttr.needsUpdate = true

    // 2) Bees & Gnats
    const mColorArray = mColorAttr.array as Float32Array

    for (let i = 0; i < MICRO_COUNT; i++) {
      const m = sim.micros[i]
      const cIdx = i * 3
      mColorArray[cIdx] = m.color.r
      mColorArray[cIdx + 1] = m.color.g
      mColorArray[cIdx + 2] = m.color.b

      if (!m.active) {
        dummy.position.set(0, -999, 0)
        dummy.scale.setScalar(0.0001)
      } else {
        dummy.position.set(m.x - anchor.x, m.y, m.z - anchor.y)
        dummy.rotation.set(0, m.heading, 0)
        dummy.scale.setScalar(m.scale)
      }
      dummy.updateMatrix()
      mMesh.setMatrixAt(i, dummy.matrix)
    }
    mMesh.instanceMatrix.needsUpdate = true
    mColorAttr.needsUpdate = true

    // 3) Fireflies
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      const f = sim.fireflies[i]
      if (!f.active) {
        dummy.position.set(0, -999, 0)
        dummy.scale.setScalar(0.0001)
      } else {
        dummy.position.set(f.x - anchor.x, f.y, f.z - anchor.y)
        dummy.rotation.set(0, 0, 0)
        dummy.scale.setScalar(f.scale)
      }
      dummy.updateMatrix()
      fMesh.setMatrixAt(i, dummy.matrix)
    }
    fMesh.instanceMatrix.needsUpdate = true
  })

  return (
    <group name="endless-insects">
      <instancedMesh
        ref={butterflyMeshRef}
        args={[bGeom, bMat, BUTTERFLY_COUNT]}
        frustumCulled={false}
        renderOrder={2}
        name="endless-butterflies"
      />
      <instancedMesh
        ref={microMeshRef}
        args={[mGeom, mMat, MICRO_COUNT]}
        frustumCulled={false}
        renderOrder={2}
        name="endless-micros"
      />
      <instancedMesh
        ref={fireflyMeshRef}
        args={[fGeom, fMat, FIREFLY_COUNT]}
        frustumCulled={false}
        renderOrder={3}
        name="endless-fireflies"
      />
    </group>
  )
}
