import { VirtualLight } from "../lightPool"
import { useMemo } from "react"
import { signTexture } from "../../utils/canvasTexture"

/** Shared warm, vibrant palette — rich storybook visual language for every area. */
export const PALETTE = {
  wood: "#b58152",
  woodDark: "#7e5233",
  cream: "#fcf2e3",
  sand: "#fae8c4",
  stone: "#d2ccc0",
  leaf: "#679b65",
  leafDeep: "#366951",
  trunk: "#8b6348",
  lantern: "#ffba4d",
  accent: "#ff7088",
  lavender: "#b48df6",
  gold: "#f5c842",
}

export const wood = { color: PALETTE.wood, roughness: 0.82 }
export const woodDark = { color: PALETTE.woodDark, roughness: 0.85 }
export const creamMat = { color: PALETTE.cream, roughness: 0.9 }
export const stoneMat = { color: PALETTE.stone, roughness: 0.95 }

export const SignBoard = ({
  text,
  position,
  rotationY = 0,
  width = 1.1,
  bg,
  fg,
}: {
  text: string
  position: [number, number, number]
  rotationY?: number
  width?: number
  bg?: string
  fg?: string
}): React.ReactElement => {
  const tex = useMemo(() => signTexture(text, bg, fg), [text, bg, fg])
  return (
    <group position={position} rotation-y={rotationY}>
      <mesh position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.035, 0.045, 0.6, 8]} />
        <meshStandardMaterial {...woodDark} />
      </mesh>
      <mesh position={[0, 0.68, 0]} rotation-x={-0.08}>
        <boxGeometry args={[width, width * 0.44, 0.06]} />
        <meshStandardMaterial map={tex} roughness={0.85} />
      </mesh>
    </group>
  )
}

export const Bench = ({
  position,
  rotationY = 0,
}: {
  position: [number, number, number]
  rotationY?: number
}): React.ReactElement => (
  <group position={position} rotation-y={rotationY}>
    <mesh position={[0, 0.32, 0]}>
      <boxGeometry args={[1.5, 0.07, 0.5]} />
      <meshStandardMaterial {...wood} />
    </mesh>
    <mesh position={[0, 0.55, -0.22]} rotation-x={-0.15}>
      <boxGeometry args={[1.5, 0.4, 0.06]} />
      <meshStandardMaterial {...wood} />
    </mesh>
    {[-0.62, 0.62].map((x) => (
      <mesh key={x} position={[x, 0.15, 0]}>
        <boxGeometry args={[0.09, 0.3, 0.42]} />
        <meshStandardMaterial {...woodDark} />
      </mesh>
    ))}
  </group>
)

export const Lantern = ({
  position,
  lit,
  scale = 1,
}: {
  position: [number, number, number]
  lit: number // 0..1 emissive strength
  scale?: number
}): React.ReactElement => (
  <group position={position} scale={scale}>
    <mesh position={[0, 0.55, 0]}>
      <cylinderGeometry args={[0.035, 0.05, 1.1, 8]} />
      <meshStandardMaterial color={PALETTE.woodDark} roughness={0.9} />
    </mesh>
    <mesh position={[0, 1.18, 0]}>
      <sphereGeometry args={[0.14, 12, 10]} />
      <meshStandardMaterial
        color="#fff1d6"
        emissive={PALETTE.lantern}
        emissiveIntensity={lit * 2.2}
        roughness={0.6}
      />
    </mesh>
    <mesh position={[0, 1.32, 0]}>
      <coneGeometry args={[0.13, 0.12, 8]} />
      <meshStandardMaterial color={PALETTE.woodDark} roughness={0.9} />
    </mesh>
    {lit > 0.05 && <VirtualLight position={[0, 1.18, 0]} color={PALETTE.lantern} intensity={lit * 2.4} distance={7} decay={2} />}
  </group>
)

/** Tiny round table with two stools and cups — used by café areas. */
export const TableSet = ({
  position,
  rotationY = 0,
  cups = 2,
}: {
  position: [number, number, number]
  rotationY?: number
  cups?: number
}): React.ReactElement => (
  <group position={position} rotation-y={rotationY}>
    <mesh position={[0, 0.42, 0]}>
      <cylinderGeometry args={[0.42, 0.42, 0.05, 14]} />
      <meshStandardMaterial {...creamMat} />
    </mesh>
    <mesh position={[0, 0.2, 0]}>
      <cylinderGeometry args={[0.05, 0.08, 0.4, 8]} />
      <meshStandardMaterial {...woodDark} />
    </mesh>
    {[-0.75, 0.75].map((x) => (
      <group key={x} position={[x, 0, 0.1]}>
        <mesh position={[0, 0.24, 0]}>
          <cylinderGeometry args={[0.2, 0.2, 0.05, 10]} />
          <meshStandardMaterial {...wood} />
        </mesh>
        <mesh position={[0, 0.1, 0]}>
          <cylinderGeometry args={[0.04, 0.06, 0.2, 8]} />
          <meshStandardMaterial {...woodDark} />
        </mesh>
      </group>
    ))}
    {Array.from({ length: cups }, (_, i) => (
      <mesh key={i} position={[(i - 0.5) * 0.3, 0.48, (i % 2 === 0 ? 0.08 : -0.08)]}>
        <cylinderGeometry args={[0.05, 0.04, 0.07, 8]} />
        <meshStandardMaterial color="#fff" roughness={0.4} />
      </mesh>
    ))}
  </group>
)

