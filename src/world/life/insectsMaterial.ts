import * as THREE from "three"

export const insectUniforms = {
  uInsectTime: { value: 0 },
}

/**
 * Material for butterflies & moths with GPU vertex wing flapping.
 */
export const createButterflyMaterial = (): THREE.MeshStandardMaterial => {
  const mat = new THREE.MeshStandardMaterial({
    roughness: 0.55,
    metalness: 0.1,
    side: THREE.DoubleSide,
  })

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uInsectTime = insectUniforms.uInsectTime

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float aWing;
attribute float aFlutterPhase;
uniform float uInsectTime;
`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
if (aWing > 0.5) {
  float flap = sin(uInsectTime * 22.0 + aFlutterPhase);
  transformed.y += abs(flap) * abs(position.x) * 2.0;
  transformed.x *= 1.0 - abs(flap) * 0.3;
}
`,
      )
  }

  mat.customProgramCacheKey = () => "world-butterfly-v1"
  return mat
}

/**
 * Material for bees and glinting gnats.
 */
export const createMicroInsectMaterial = (): THREE.MeshStandardMaterial => {
  return new THREE.MeshStandardMaterial({
    roughness: 0.45,
    metalness: 0.3,
    side: THREE.DoubleSide,
  })
}

/**
 * Bloom-friendly warm emissive material for fireflies.
 */
export const createFireflyMaterial = (): THREE.MeshStandardMaterial => {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color("#ffe9a8"),
    emissive: new THREE.Color("#ff9e22"),
    emissiveIntensity: 2.2,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
}
