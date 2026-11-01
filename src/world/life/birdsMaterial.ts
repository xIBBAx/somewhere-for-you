import * as THREE from "three"

export const birdUniforms = {
  uBirdTime: { value: 0 },
}

/**
 * Creates a MeshStandardMaterial with onBeforeCompile hook to deform
 * wings on the GPU according to per-instance flap parameters.
 *
 * The wing articulates at two hinges driven by the `aWingFactor` ramp baked
 * into the geometry: the inner panel turns about the shoulder, and the fold
 * ramps in past the elbow so the separated primaries swing furthest (root 0 →
 * hinge 0.5 → tip 1). It is one rigid rotation about the shoulder whose angle
 * grows along the span, which keeps every vertex a true rotation of its rest
 * position — no stretching, and no vertex can drift away from its pivot.
 *
 * A single rotation matrix drives positions AND normals, so a folded wing can
 * never disagree with its own shading.
 *
 * Flapping is a rotation about +Z (the bird's forward axis), which lifts both
 * wings together; the shoulder pivot x is signed so the two halves stay exact
 * mirrors. With `aBirdParams.z` (flap amplitude) at zero the wing settles into
 * the glide dihedral instead of flapping.
 *
 * The mirrored pivot, the rigid arc length and the per-vertex hinge blend are
 * verified by tests/birdsGeometry.test.ts.
 */
export const createBirdMaterial = (): THREE.MeshStandardMaterial => {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.82,
    metalness: 0,
    side: THREE.DoubleSide,
  })

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBirdTime = birdUniforms.uBirdTime

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float aWingFactor;
attribute float aWingSpan;
attribute float aWingElbow;
attribute vec4 aBirdParams; // x: phaseOffset, y: flapSpeed, z: flapAmp, w: glideDihedral
uniform float uBirdTime;

// Wing chain state, resolved once per vertex and shared by both stages.
float birdShoulderAngle = 0.0;
float birdElbow = 0.0;

// Rotation about +Z (the bird's forward axis): lifts both wings together.
mat3 birdRotZ(float ang) {
  float c = cos(ang);
  float s = sin(ang);
  return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0);
}

// Angles for this vertex. birdElbow is 0 at the shoulder and 1 at the primary
// tips, so the hinge blend is baked straight into the geometry's ramp.
void birdWingAngles() {
  float amp = clamp(aBirdParams.z, 0.0, 1.0);
  float phase = uBirdTime * aBirdParams.y + aBirdParams.x;
  float flap = sin(phase) * (amp * 0.62) + (1.0 - amp) * aBirdParams.w;
  birdShoulderAngle = flap;
  birdElbow = clamp((aWingFactor - 0.5) * 2.0, 0.0, 1.0);
}
`,
      )
      // Normal stage: same matrix as the position, so shading follows the fold.
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
if (aWingFactor > 0.001) {
  birdWingAngles();
  float normalSide = position.x < 0.0 ? -1.0 : 1.0;
  objectNormal = birdRotZ(normalSide * birdShoulderAngle * (1.0 + birdElbow * 0.9)) * objectNormal;
}
`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
if (aWingFactor > 0.001) {
  birdWingAngles();
  float ang = birdShoulderAngle * (1.0 + birdElbow * 0.9);
  float side = position.x < 0.0 ? -1.0 : 1.0;
  // Signed pivot: rotating the left wing about the right wing's pivot point
  // would shear the bird, so each half turns about its own shoulder.
  vec2 arm = vec2(abs(position.x) - 0.055, position.y - 0.045);
  float c = cos(ang);
  float s = sin(ang);
  transformed = vec3(
    side * (0.055 + arm.x * c - arm.y * s),
    0.045 + arm.x * s + arm.y * c,
    position.z
  );
  // The downstroke drives the bird forward, so the wing sweeps back with it.
  transformed.z -= cos(uBirdTime * aBirdParams.y + aBirdParams.x) * clamp(aBirdParams.z, 0.0, 1.0) * 0.05 * aWingFactor;
}
`,
      )
  }

  mat.customProgramCacheKey = () => "world-bird-v3-mirrored-normals"
  return mat
}
