import * as THREE from "three"
import type { FormationDef } from "./Clouds"

/**
 * The cloud deck's placement as drawn this frame, so other effects (a
 * Pegasus flying into cloud, the vapour she trails) can find the puffs without
 * a second copy of the layout. Clouds.tsx writes the same wind offset, domain
 * centre and altitude it gives its shader; `formations` is set once.
 */
export const cloudFieldRT = {
  /** the shader's uWindOffset (render space, wrapped) */
  wind: new THREE.Vector2(),
  /** the shader's uDomainCenter: the camera's render xz */
  domain: new THREE.Vector2(),
  /** the shader's uAltitude: the terrain height the deck hangs above */
  altitude: 0,
  formations: [] as FormationDef[],
  /** 0..1 how far inside the cloud the nearest flying Pegasus is (CloudWakeFX writes it, smoothed) */
  cover: 0,
}
