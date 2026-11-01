import { useFrame, useThree } from "@react-three/fiber"
import { useLayoutEffect, useRef, type ReactNode } from "react"
import * as THREE from "three"
import { avatarRT, worldRT } from "../../game/runtime"
import { weatherRT } from "../../game/weather/weatherState"
import { updateWind } from "../wind"
import { vegetationUniforms } from "./vegetationMaterials"
import { originRT, updateOrigin } from "../origin"
import { nightBlend, skyLightLevel } from "../../game/environment/celestialLighting"
import { groundResources } from "../../game/environment/ground/groundMaterial"

/**
 * Root of everything rendered in the world. Its position is `-origin`, and
 * the camera is parented here, so logical coordinates can be used everywhere
 * while the GPU only ever sees small render-space numbers.
 *
 * Must be mounted before any other world content so its frame callback
 * (origin update) runs first.
 */
export const WorldRoot = ({ children }: { children: ReactNode }): React.ReactElement => {
  const group = useRef<THREE.Group>(null)
  const camera = useThree((s) => s.camera)

  useLayoutEffect(() => {
    const root = group.current
    if (!root) return
    const previousParent = camera.parent
    root.add(camera)
    return () => {
      root.remove(camera)
      if (previousParent) previousParent.add(camera)
    }
  }, [camera])

  useFrame((_, rawDt) => {
    const dt = Math.min(Math.max(rawDt, 1e-4), 0.1)
    const body = avatarRT()
    updateOrigin(body.pos.x, body.pos.z)
    updateWind(dt)
    vegetationUniforms.uWetness.value = weatherRT.wetness
    groundResources().snow.value = weatherRT.snowCover
    vegetationUniforms.uPlayerRender.value.set(body.pos.x - originRT.x, body.pos.y + 1.1, body.pos.z - originRT.z)
    vegetationUniforms.uNight.value = nightBlend(worldRT.timeOfDay)
    vegetationUniforms.uLeafGlow.value = 0.12 * skyLightLevel(worldRT.timeOfDay, weatherRT.cloud, weatherRT.rain)
    const root = group.current
    if (root && (root.position.x !== -originRT.x || root.position.z !== -originRT.z)) {
      root.position.set(-originRT.x, 0, -originRT.z)
      root.updateMatrixWorld(true)
    }
  }, -100)

  return (
    <group ref={group} name="world-root">
      {children}
    </group>
  )
}

const lookMatrix = new THREE.Matrix4()
const eye = new THREE.Vector3()
const target = new THREE.Vector3()

/**
 * Orient an object toward a logical-space target. Object3D.lookAt expects a
 * world (render-space) target, which differs from logical space whenever the
 * origin is not zero; this helper works purely in the shared parent space.
 */
export const lookAtLogical = (object: THREE.Object3D, x: number, y: number, z: number): void => {
  eye.copy(object.position)
  target.set(x, y, z)
  if ((object as THREE.Camera).isCamera) lookMatrix.lookAt(eye, target, object.up)
  else lookMatrix.lookAt(target, eye, object.up)
  object.quaternion.setFromRotationMatrix(lookMatrix)
}
