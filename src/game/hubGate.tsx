import { useFrame, type RootState } from "@react-three/fiber"
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react"
import * as THREE from "three"
import { HUB_CENTER } from "../world/hubLayout"
import { avatarRT, worldRT } from "./runtime"
import { StaticMerger, hasDynamicAncestor } from "./staticMerge"

/**
 * Simulation tiers for the explorer's home region.
 *
 * Home holds thousands of authored objects. Out in the endless world they
 * are far beyond the fog, so the whole subtree is hidden, skipped by the
 * scene's matrix update, and every home system's per-frame logic pauses.
 * Coming back re-enables everything a little before it can be seen.
 */
export const HUB_ACTIVE_RADIUS = 330
const HYSTERESIS = 25

export const hubRT = { active: true, distance: 0 }

/** useFrame that only runs while home is active. */
export const useHubFrame = (callback: (state: RootState, delta: number) => void, priority?: number): void => {
  useFrame((state, delta) => {
    if (hubRT.active) callback(state, delta)
  }, priority)
}

type FreezeRec = { object: THREE.Object3D; still: number; frozen: boolean; snapshot: Float64Array }
export const freezeStats = { tracked: 0, frozen: 0, thawed: 0 }

const _m = new THREE.Matrix4()
const _scale = new THREE.Vector3()
const SMALL_CASTER_RADIUS = 0.09
const sameMatrix = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => {
  for (let i = 0; i < 16; i++) if (Math.abs(a[i] - b[i]) > 1e-7) return false
  return true
}

/**
 * Freezes transforms that never change (most authored scenery) so the scene
 * graph skips their per-frame matrix work. A rolling re-check composes a
 * slice of frozen objects each frame; anything that starts moving later
 * (memory performances, finale) is thawed within a few frames.
 */
const useAutoFreeze = (group: React.RefObject<THREE.Group | null>): void => {
  const recs = useRef<FreezeRec[]>([])
  const merger = useRef<StaticMerger | null>(null)
  const cursor = useRef(0)
  const scanned = useRef(0)
  useEffect(() => () => {
    merger.current?.dispose(); merger.current = null
    for (const r of recs.current) r.object.matrixAutoUpdate = true
    recs.current.length = 0; scanned.current = 0
  }, [])
  useFrame(() => {
    const g = group.current
    if (!g || !hubRT.active) return
    // (re)scan the subtree every ~4 s to pick up newly mounted objects
    if (scanned.current-- <= 0) {
      scanned.current = 240
      if (!merger.current) merger.current = new StaticMerger(g)
      // merge everything that has stayed frozen since the last scan
      for (const r of recs.current) if (r.frozen && (r.object as THREE.Mesh).isMesh) merger.current.add(r.object as THREE.Mesh)
      merger.current.flush()
      const known = new Set(recs.current.map((r) => r.object))
      g.traverse((o) => {
        if (o === g || known.has(o) || o.userData.staticMerged || hasDynamicAncestor(o, g)) return
        recs.current.push({ object: o, still: 0, frozen: false, snapshot: new Float64Array(16) })
        // tiny props (petals, pebbles, bolts) cast sub-texel shadows but each
        // costs a shadow-pass draw call; only the explorer-scale objects cast
        const mesh = o as THREE.Mesh
        if (mesh.isMesh && mesh.castShadow && !(mesh as THREE.SkinnedMesh).isSkinnedMesh) {
          if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere()
          o.getWorldScale(_scale)
          const r = (mesh.geometry.boundingSphere?.radius ?? 1) * Math.max(_scale.x, _scale.y, _scale.z)
          if (r < SMALL_CASTER_RADIUS) mesh.castShadow = false
        }
      })
      recs.current = recs.current.filter((r) => r.object.parent)
      freezeStats.tracked = recs.current.length
    }
    const list = recs.current
    // performances move authored props: keep everything live while they run
    const busy = worldRT.performingMemoryId !== null || worldRT.finaleActive || worldRT.introActive
    let frozen = 0
    for (let i = 0; i < list.length; i++) {
      const r = list[i]
      if (!r.frozen) {
        // matrix was refreshed by last frame's scene update (matrixAutoUpdate)
        if (sameMatrix(r.object.matrix.elements, r.snapshot)) r.still++
        else {
          r.still = 0
          r.snapshot.set(r.object.matrix.elements)
        }
        if (r.still > 90 && !busy) {
          r.frozen = true
          r.object.matrixAutoUpdate = false
        }
      } else frozen++
    }
    // rolling validation of frozen objects
    const slice = Math.max(20, Math.ceil(list.length / 8))
    let released = false
    for (let k = 0; k < slice && list.length; k++) {
      const r = list[cursor.current++ % list.length]
      if (!r.frozen) continue
      _m.compose(r.object.position, r.object.quaternion, r.object.scale)
      if (busy || !sameMatrix(_m.elements, r.snapshot)) {
        r.frozen = false
        r.still = 0
        r.object.matrixAutoUpdate = true
        r.object.matrixWorldNeedsUpdate = true
        freezeStats.thawed++
        // a moving object (or any moving ancestor) leaves its merged batch
        r.object.traverse((o) => {
          if (merger.current?.owns(o)) { merger.current.release(o as THREE.Mesh); released = true }
        })
      }
    }
    // Restore moving props in this frame, not at the next four-second rescan.
    if (released) merger.current?.flush()
    freezeStats.frozen = frozen
  })
}

export const HubGate = ({ children }: { children: ReactNode }): React.ReactElement => {
  const group = useRef<THREE.Group>(null)
  useLayoutEffect(() => {
    const g = group.current
    if (!g) return
    const update = g.updateMatrixWorld
    // Object3D still traverses children when matrixWorldAutoUpdate is false.
    // Skip the dormant subtree itself; restore it before the return journey.
    g.updateMatrixWorld = function (force?: boolean): void { if (hubRT.active) update.call(this, force) }
    return () => { g.updateMatrixWorld = update; hubRT.active = true }
  }, [])
  useAutoFreeze(group)
  useFrame(() => {
    const d = Math.hypot(avatarRT().pos.x - HUB_CENTER.x, avatarRT().pos.z - HUB_CENTER.z)
    hubRT.distance = d
    // the opening journey and finale always happen at home
    const force = worldRT.introActive || worldRT.finaleActive
    const next = force || (hubRT.active ? d < HUB_ACTIVE_RADIUS + HYSTERESIS : d < HUB_ACTIVE_RADIUS)
    const g = group.current
    if (!g) return
    if (next !== hubRT.active || g.visible !== next) {
      hubRT.active = next
      g.visible = next
      g.matrixWorldAutoUpdate = next
      if (next) g.updateMatrixWorld(true)
    }
  }, -80)
  return (
    <group ref={group} name="home-region">
      {children}
    </group>
  )
}
