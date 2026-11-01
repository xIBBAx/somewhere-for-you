import { useFrame } from "@react-three/fiber"
import { useMemo, useRef } from "react"
import * as THREE from "three"
import { damp, smoothstep } from "../../utils/math"
import { catRT } from "../runtime"

/**
 * The companion cat built from primitives.
 *
 * This is the fallback used only when the rigged GLB cannot be loaded, so the
 * game still shows a cat rather than an empty space. It is a cut-down version
 * of the rigged cat: the navigation, the state machine and everything
 * that reacts to them live in `CompanionCat` and are unaffected by which
 * representation is mounted.
 */
export const PrimitiveCat = (): React.ReactElement => {
  const body = useRef<THREE.Group>(null)
  const head = useRef<THREE.Group>(null)
  const tailA = useRef<THREE.Group>(null)
  const tailB = useRef<THREE.Group>(null)
  const tailC = useRef<THREE.Group>(null)
  const legFL = useRef<THREE.Mesh>(null)
  const legFR = useRef<THREE.Mesh>(null)
  const legBL = useRef<THREE.Mesh>(null)
  const legBR = useRef<THREE.Mesh>(null)
  const eyes = useRef<THREE.Group>(null)

  const fur = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#d98b45", roughness: 0.88 }),
    [],
  )
  const furDark = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#a9531e", roughness: 0.86 }),
    [],
  )
  const cream = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#f7e5c9", roughness: 0.9 }),
    [],
  )
  const eyeWhite = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#c4c27a", roughness: 0.22 }),
    [],
  )
  const eyeIris = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#7d8a2e",
        emissive: "#000000",
        emissiveIntensity: 0.2,
        roughness: 0.16,
      }),
    [],
  )
  const eyePupil = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#0b0d0c", roughness: 0.12 }),
    [],
  )
  const eyeCatchlight = useMemo(
    () => new THREE.MeshBasicMaterial({ color: "#ffffff" }),
    [],
  )
  const whiskersMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#d8d2c8", roughness: 0.45 }),
    [],
  )
  const nose = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#e08a72", roughness: 0.65 }),
    [],
  )
  const innerEar = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#d99a8c", roughness: 0.82 }),
    [],
  )
  const collarMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#c62828", roughness: 0.52, metalness: 0.06 }),
    [],
  )

  useFrame((state, rawDt) => {
    const dt = Math.min(Math.max(rawDt, 1e-4), 1 / 20)
    const b = body.current
    if (!b) return
    // Placement and visibility belong to the parent group in CompanionCat; this
    // only poses the body within it.

    const s = catRT.state
    const jumping = catRT.navMode === "jump"
    const preparingJump = catRT.navMode === "jumpApproach"
    const running = catRT.speed > 3.6 && !jumping
    const walking = catRT.speed > 0.25 && !jumping
    const wp = catRT.walkPhase
    const affectionPose =
      s === "affection"
        ? smoothstep(0.12, 0.55, catRT.stateTime) *
          (1 - smoothstep(2.85, 3.4, catRT.stateTime))
        : 0
    const nuzzle =
      catRT.affectionKind === "nuzzle"
        ? Math.sin(catRT.stateTime * 5.2) * 0.035 * affectionPose
        : 0
    const pawLift =
      catRT.affectionKind === "paw"
        ? affectionPose * (0.82 + Math.sin(catRT.stateTime * 4.5) * 0.12)
        : 0

    let bodyY = 0.16 + (walking ? Math.abs(Math.sin(wp)) * 0.03 : 0)
    let bodyRotX = 0
    let bodyScaleY = 1
    let bodyScaleZ = 1
    let legSwing = Math.sin(wp) * 0.55

    if (jumping) {
      bodyRotX = -0.12
      bodyY = 0.13
      bodyScaleY = 0.9
      bodyScaleZ = 1.1
      legSwing = 0
    } else if (preparingJump) {
      bodyRotX = 0.16
      bodyY = 0.11
      bodyScaleY = 0.76
      bodyScaleZ = 1.08
      legSwing *= 0.55
    } else if (s === "sit") {
      bodyRotX = -0.45
      bodyY = 0.2
      bodyScaleY = 1.02
      legSwing = 0
    } else if (s === "sleep") {
      bodyScaleY = 0.55
      bodyScaleZ = 1.15
      bodyY = 0.09
      legSwing = 0
    } else if (s === "stretch") {
      bodyRotX = 0.32
      bodyScaleZ = 1.12
      legSwing = 0
    } else if (s === "crouch") {
      bodyScaleY = 0.72
      bodyY = 0.12
      legSwing = 0
    } else if (running) {
      bodyScaleZ = 1.08
      legSwing = Math.sin(wp) * 0.9
    }

    b.position.y = damp(b.position.y, bodyY, 10, dt)
    b.position.x = damp(b.position.x, nuzzle, 9, dt)
    b.position.z = damp(b.position.z, affectionPose * 0.045, 9, dt)
    b.rotation.x = damp(b.rotation.x, bodyRotX, 8, dt)
    b.rotation.z = damp(b.rotation.z, nuzzle * 3.5, 9, dt)
    b.scale.y = damp(b.scale.y, bodyScaleY, 8, dt)
    b.scale.z = damp(b.scale.z, bodyScaleZ, 8, dt)

    if (head.current) {
      const lookRoll =
        s === "lookAround" ? Math.sin(state.clock.elapsedTime * 1.4) * 0.7 : s === "sleep" ? 0.35 : 0
      head.current.rotation.y = damp(head.current.rotation.y, lookRoll, 6, dt)
      head.current.position.y = damp(head.current.position.y, s === "sit" ? 0.2 : 0.16, 8, dt)
      head.current.position.z = damp(
        head.current.position.z,
        0.2 + affectionPose * (catRT.affectionKind === "nuzzle" ? 0.085 : 0.025),
        9,
        dt,
      )
    }

    if (legFL.current && legFR.current && legBL.current && legBR.current) {
      const amp = s === "sit" || s === "sleep" || s === "stretch" ? 0 : legSwing
      legFL.current.rotation.x = jumping ? -0.85 : amp - pawLift * 1.15
      legFL.current.position.y = damp(legFL.current.position.y, -0.09 + pawLift * 0.12, 12, dt)
      legFL.current.position.z = damp(legFL.current.position.z, 0.12 + pawLift * 0.09, 12, dt)
      legBR.current.rotation.x = jumping ? 0.78 : amp
      legFR.current.rotation.x = jumping ? -0.85 : -amp
      legBL.current.rotation.x = jumping ? 0.78 : -amp
    }

    const tailWiggleSide = Math.sin(catRT.tailPhase * 2.4) * (running ? 0.55 : 0.35)
    const tailWiggleUp = Math.cos(catRT.tailPhase * 1.8) * 0.16
    const tailWave =
      Math.sin(catRT.tailPhase) * (jumping ? 0.18 : running ? 0.5 : affectionPose ? 0.48 : 0.28)
    const tailLift =
      jumping ? 0.28 : s === "sit" ? 1.9 : s === "sleep" ? 2.6 : affectionPose ? 0.45 : running ? 0.7 : 1.15
    if (tailA.current && tailB.current && tailC.current) {
      tailA.current.rotation.x = damp(tailA.current.rotation.x, -tailLift + tailWave * 0.4 + tailWiggleUp, 6, dt)
      tailA.current.rotation.y = damp(tailA.current.rotation.y, tailWiggleSide * 0.45, 8, dt)
      tailB.current.rotation.x = damp(tailB.current.rotation.x, -0.45 + tailWave * 0.5 + tailWiggleUp, 6, dt)
      tailB.current.rotation.y = damp(tailB.current.rotation.y, tailWiggleSide * 0.75, 8, dt)
      tailC.current.rotation.x = damp(tailC.current.rotation.x, -0.3 + tailWave * 0.6 + tailWiggleUp, 6, dt)
      tailC.current.rotation.y = damp(tailC.current.rotation.y, tailWiggleSide * 1.15, 8, dt)
    }

    if (eyes.current) {
      const closed =
        s === "sleep"
          ? 0.12
          : affectionPose && catRT.affectionKind === "nuzzle"
            ? 0.45
            : s === "sit" && Math.sin(state.clock.elapsedTime * 0.7) > 0.92
              ? 0.15
              : 1
      eyes.current.scale.y = damp(eyes.current.scale.y, closed, 12, dt)
    }
  })
  return (
    <group ref={body} scale={1.04}>
      <mesh rotation-x={Math.PI / 2} material={fur} castShadow>
        <capsuleGeometry args={[0.125, 0.25, 6, 12]} />
      </mesh>
      <mesh position={[0, 0.02, 0.14]} scale={[0.8, 0.8, 0.9]} material={cream}>
        <sphereGeometry args={[0.09, 10, 8]} />
      </mesh>
      <group ref={head} position={[0, 0.16, 0.2]}>
        <mesh material={fur} castShadow>
          <sphereGeometry args={[0.145, 14, 12]} />
        </mesh>
        <mesh position={[-0.036, -0.035, 0.118]} scale={[1, 0.78, 0.62]} material={cream}>
          <sphereGeometry args={[0.055, 10, 8]} />
        </mesh>
        <mesh position={[0.036, -0.035, 0.118]} scale={[1, 0.78, 0.62]} material={cream}>
          <sphereGeometry args={[0.055, 10, 8]} />
        </mesh>
        <mesh position={[-0.07, 0.11, 0]} rotation-z={0.25} material={furDark}>
          <coneGeometry args={[0.052, 0.105, 6]} />
        </mesh>
        <mesh position={[0.07, 0.11, 0]} rotation-z={-0.25} material={furDark}>
          <coneGeometry args={[0.052, 0.105, 6]} />
        </mesh>
        <mesh position={[-0.07, 0.112, 0.012]} rotation-z={0.25} material={innerEar} scale={0.55}>
          <coneGeometry args={[0.052, 0.105, 6]} />
        </mesh>
        <mesh position={[0.07, 0.112, 0.012]} rotation-z={-0.25} material={innerEar} scale={0.55}>
          <coneGeometry args={[0.052, 0.105, 6]} />
        </mesh>
        <group ref={eyes} position={[0, 0.028, 0.134]}>
          {[-1, 1].map((side) => (
            <group key={side} position={[side * 0.056, 0, 0]} rotation-y={side * 0.22}>
              <mesh scale={[1.1, 1.25, 0.6]} material={eyeWhite}>
                <sphereGeometry args={[0.026, 10, 8]} />
              </mesh>
              <mesh position={[0, 0, 0.014]} scale={[0.88, 1.05, 0.5]} material={eyeIris}>
                <sphereGeometry args={[0.023, 10, 8]} />
              </mesh>
              <mesh position={[0, 0, 0.023]} scale={[0.38, 0.95, 0.3]} material={eyePupil}>
                <sphereGeometry args={[0.016, 8, 6]} />
              </mesh>
              <mesh position={[side * -0.005 + 0.005, 0.007, 0.026]} material={eyeCatchlight}>
                <sphereGeometry args={[0.0055, 6, 5]} />
              </mesh>
            </group>
          ))}
        </group>
        <mesh position={[0, -0.015, 0.125]} rotation-x={Math.PI} material={nose}>
          <coneGeometry args={[0.016, 0.02, 5]} />
        </mesh>
        {[-1, 1].flatMap((side) =>
          [-0.035, 0.025].map((dy, index) => (
            <mesh
              key={`${side}:${index}`}
              position={[side * 0.105, -0.045 + dy, 0.118]}
              rotation-z={side * (1.28 + index * 0.08)}
              material={whiskersMat}
            >
              <cylinderGeometry args={[0.003, 0.003, 0.12, 4]} />
            </mesh>
          )),
        )}
      </group>
      <mesh position={[0, 0.11, 0.145]} material={collarMat}>
        <torusGeometry args={[0.105, 0.012, 6, 18]} />
      </mesh>
      <group ref={tailA} position={[0, 0.1, -0.2]}>
        <mesh position={[0, 0.07, 0]} material={fur}>
          <capsuleGeometry args={[0.03, 0.1, 4, 8]} />
        </mesh>
        <group ref={tailB} position={[0, 0.15, 0]}>
          <mesh position={[0, 0.06, 0]} material={fur}>
            <capsuleGeometry args={[0.027, 0.09, 4, 8]} />
          </mesh>
          <group ref={tailC} position={[0, 0.13, 0]}>
            <mesh position={[0, 0.05, 0]} material={furDark}>
              <capsuleGeometry args={[0.024, 0.08, 4, 8]} />
            </mesh>
          </group>
        </group>
      </group>
      <mesh ref={legFL} position={[-0.075, -0.09, 0.12]} material={fur}>
        <capsuleGeometry args={[0.032, 0.09, 4, 8]} />
      </mesh>
      <mesh ref={legFR} position={[0.075, -0.09, 0.12]} material={fur}>
        <capsuleGeometry args={[0.032, 0.09, 4, 8]} />
      </mesh>
      <mesh ref={legBL} position={[-0.075, -0.09, -0.1]} material={fur}>
        <capsuleGeometry args={[0.032, 0.09, 4, 8]} />
      </mesh>
      <mesh ref={legBR} position={[0.075, -0.09, -0.1]} material={fur}>
        <capsuleGeometry args={[0.032, 0.09, 4, 8]} />
      </mesh>
      {[
        [-0.075, 0.13],
        [0.075, 0.13],
        [-0.075, -0.1],
        [0.075, -0.1],
      ].map(([x, z]) => (
        <mesh key={`paw:${x}:${z}`} position={[x, -0.16, z + 0.025]} scale={[1.15, 0.55, 1.35]} material={cream}>
          <sphereGeometry args={[0.037, 8, 6]} />
        </mesh>
      ))}
    </group>
  )
}
